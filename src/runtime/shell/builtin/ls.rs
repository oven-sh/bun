use core::ffi::{c_char, CStr};
use core::mem::offset_of;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::io::Write as _;

use bun_core::Output;
use bun_jsc::{self as jsc, EventLoopHandle, EventLoopTask, SystemError};
use crate::shell::interpreter::{
    self, Interpreter, OutputSrc, OutputTask, OutputTaskVTable, ShellSyscall,
};
use crate::shell::{self as shell, AllocScope, ExitCode, Yield};
use bun_str::ZStr;
use bun_sys::{self as Syscall, Fd, S};
use bun_threading::{WorkPool, WorkPoolTask};

use crate::shell::interpreter::Builtin;
use crate::shell::interpreter::Builtin::Kind as BuiltinKind;
// TODO(port): `Result` here is `Interpreter.Builtin.Result(T, E)` (a tagged
// `.ok`/`.err` union), not `core::result::Result`. Phase B: confirm shape.
use crate::shell::interpreter::Builtin::Result as BuiltinResult;

bun_output::declare_scope!(ls, hidden);
bun_output::declare_scope!(ShellLsTask, hidden);

pub struct Ls {
    pub opts: Opts,
    pub state: State,
    pub alloc_scope: AllocScope,
}

pub enum State {
    Idle,
    Exec(ExecState),
    WaitingWriteErr,
    Done,
}

pub struct ExecState {
    pub err: Option<Syscall::Error>,
    pub task_count: AtomicUsize,
    pub tasks_done: usize,
    pub output_waiting: usize,
    pub output_done: usize,
}

impl Default for State {
    fn default() -> Self {
        State::Idle
    }
}

impl Ls {
    pub fn start(&mut self) -> Yield {
        self.next()
    }

    pub fn write_failing_error(&mut self, buf: &[u8], exit_code: ExitCode) -> Yield {
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            self.state = State::WaitingWriteErr;
            return self.bltn().stderr.enqueue(self, buf, safeguard);
        }

        let _ = self.bltn().write_no_io(Builtin::Io::Stderr, buf);

        self.bltn().done(exit_code)
    }

    fn next(&mut self) -> Yield {
        while !matches!(self.state, State::Done) {
            match &self.state {
                State::Idle => {
                    // Will be null if called with no args, in which case we just run once with "." directory
                    let paths: Option<&[*const c_char]> = match self.parse_opts() {
                        BuiltinResult::Ok(paths) => paths,
                        BuiltinResult::Err(e) => {
                            let buf: &[u8] = match e {
                                OptsParseError::IllegalOption(opt_str) => self
                                    .bltn()
                                    .fmt_error_arena(BuiltinKind::Ls, "illegal option -- {s}\n", &opt_str[..]),
                                OptsParseError::ShowUsage => BuiltinKind::Ls.usage_string(),
                            };

                            return self.write_failing_error(buf, 1);
                        }
                    };

                    let task_count = if let Some(p) = paths { p.len() } else { 1 };

                    self.state = State::Exec(ExecState {
                        err: None,
                        task_count: AtomicUsize::new(task_count),
                        tasks_done: 0,
                        output_waiting: 0,
                        output_done: 0,
                    });

                    let cwd = self.bltn().cwd;
                    if let Some(p) = paths {
                        let print_directory = p.len() > 1;
                        for &path_raw in p {
                            // SAFETY: argsSlice() entries are NUL-terminated C strings.
                            let path_bytes = unsafe { CStr::from_ptr(path_raw) }.to_bytes();
                            // TODO(port): alloc_scope.dupeZ — owned NUL-terminated copy tracked by alloc_scope.
                            let path = self.alloc_scope.dupe_z(path_bytes);
                            let task = ShellLsTask::create(
                                self,
                                self.opts,
                                self.exec_mut().task_count_ptr(),
                                cwd,
                                path,
                                true,
                                self.bltn().event_loop(),
                            );
                            task.print_directory = print_directory;
                            task.schedule();
                        }
                    } else {
                        let task = ShellLsTask::create(
                            self,
                            self.opts,
                            self.exec_mut().task_count_ptr(),
                            cwd,
                            ZStr::from_static(b".\0"),
                            false,
                            self.bltn().event_loop(),
                        );
                        task.schedule();
                    }
                }
                State::Exec(exec) => {
                    bun_output::scoped_log!(
                        ls,
                        "Ls(0x{:x}, state=exec) Check: tasks_done={} task_count={} output_done={} output_waiting={}",
                        self as *const _ as usize,
                        exec.tasks_done,
                        exec.task_count.load(Ordering::Relaxed),
                        exec.output_done,
                        exec.output_waiting,
                    );
                    // It's done
                    if exec.tasks_done >= exec.task_count.load(Ordering::Relaxed)
                        && exec.output_done >= exec.output_waiting
                    {
                        let exit_code: ExitCode = if exec.err.is_some() { 1 } else { 0 };
                        // PORT NOTE: reshaped for borrowck — re-borrow mutably to drop err.
                        if let State::Exec(exec) = &mut self.state {
                            if let Some(err) = exec.err.take() {
                                // TODO(port): err.deinitWithAllocator(alloc_scope) — Syscall::Error owns its path in Rust; Drop handles it.
                                drop(err);
                            }
                        }
                        self.state = State::Done;
                        return self.bltn().done(exit_code);
                    }
                    return Yield::Suspended;
                }
                State::WaitingWriteErr => {
                    return Yield::Failed;
                }
                State::Done => unreachable!(),
            }
        }

        self.bltn().done(0)
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<SystemError>) -> Yield {
        if let Some(err) = e {
            err.deref();
        }
        if matches!(self.state, State::WaitingWriteErr) {
            return self.bltn().done(1);
        }
        self.exec_mut().output_done += 1;
        self.next()
    }

    pub fn on_shell_ls_task_done(&mut self, task: &mut ShellLsTask) {
        self.exec_mut().tasks_done += 1;
        let output = task.take_output();

        // TODO: Reuse the *ShellLsTask allocation
        let output_task: Box<ShellLsOutputTask> = Box::new(ShellLsOutputTask {
            parent: self,
            output: OutputSrc::ArrList({
                // TODO: This is a quick fix, we should refactor shell.OutputTask to
                // also track allocations properly.
                self.alloc_scope.leak_slice(output.as_slice());
                output
                // PORT NOTE: Zig did `output.moveToUnmanaged()`; in Rust `Vec<u8>` is already "unmanaged".
            }),
            state: interpreter::OutputTaskState::WaitingWriteErr,
        });
        // PERF(port): was bun.new — Box::new via global mimalloc.

        if let Some(err_ptr) = task.err.take() {
            let error_string: &[u8] = 'error_string: {
                let exec = self.exec_mut();
                if exec.err.is_none() {
                    exec.err = Some(err_ptr);
                    break 'error_string self
                        .bltn()
                        .task_error_to_string(BuiltinKind::Ls, exec.err.as_ref().unwrap());
                }
                let err = err_ptr;
                // TODO(port): defer err.deinitWithAllocator(alloc_scope) — Drop handles owned path.
                let s = self.bltn().task_error_to_string(BuiltinKind::Ls, &err);
                drop(err);
                break 'error_string s;
            };
            // task.err already taken (= null) above
            // SAFETY: `task` was Box::leak'd in ShellLsTask::create; not used after.
            unsafe { ShellLsTask::destroy(task) };
            Box::leak(output_task).start(Some(error_string)).run();
            return;
        }
        // SAFETY: `task` was Box::leak'd in ShellLsTask::create; not used after.
        unsafe { ShellLsTask::destroy(task) };
        Box::leak(output_task).start(None).run();
    }

    // PORT NOTE: helper for borrowck — Zig accessed `this.state.exec.*` directly.
    #[inline]
    fn exec_mut(&mut self) -> &mut ExecState {
        match &mut self.state {
            State::Exec(e) => e,
            _ => unreachable!("state must be .exec"),
        }
    }
}

impl Drop for Ls {
    fn drop(&mut self) {
        self.alloc_scope.end_scope();
    }
}

impl ExecState {
    #[inline]
    fn task_count_ptr(&self) -> &AtomicUsize {
        &self.task_count
    }
}

// TODO(port): `OutputTask(Ls, vtable)` is a Zig comptime type-generator. In Rust,
// model it as `OutputTask<Ls>` parametrized by a vtable trait impl.
pub type ShellLsOutputTask = OutputTask<Ls, ShellLsOutputTaskVTable>;

pub struct ShellLsOutputTaskVTable;

impl OutputTaskVTable<Ls> for ShellLsOutputTaskVTable {
    fn write_err<C>(this: &mut Ls, childptr: &mut C, errbuf: &[u8]) -> Option<Yield> {
        bun_output::scoped_log!(
            ls,
            "ShellLsOutputTaskVTable.writeErr(0x{:x}, {})",
            this as *const _ as usize,
            bstr::BStr::new(errbuf)
        );
        this.exec_mut().output_waiting += 1;
        if let Some(safeguard) = this.bltn().stderr.needs_io() {
            return Some(this.bltn().stderr.enqueue(childptr, errbuf, safeguard));
        }
        let _ = this.bltn().write_no_io(Builtin::Io::Stderr, errbuf);
        None
    }

    fn on_write_err(this: &mut Ls) {
        bun_output::scoped_log!(
            ls,
            "ShellLsOutputTaskVTable.onWriteErr(0x{:x})",
            this as *const _ as usize
        );
        this.exec_mut().output_done += 1;
    }

    fn write_out<C>(this: &mut Ls, childptr: &mut C, output: &mut OutputSrc) -> Option<Yield> {
        bun_output::scoped_log!(
            ls,
            "ShellLsOutputTaskVTable.writeOut(0x{:x}, {})",
            this as *const _ as usize,
            bstr::BStr::new(output.slice())
        );
        this.exec_mut().output_waiting += 1;
        if let Some(safeguard) = this.bltn().stdout.needs_io() {
            return Some(this.bltn().stdout.enqueue(childptr, output.slice(), safeguard));
        }
        bun_output::scoped_log!(
            ls,
            "ShellLsOutputTaskVTable.writeOut(0x{:x}, {}) no IO",
            this as *const _ as usize,
            bstr::BStr::new(output.slice())
        );
        let _ = this.bltn().write_no_io(Builtin::Io::Stdout, output.slice());
        None
    }

    fn on_write_out(this: &mut Ls) {
        bun_output::scoped_log!(
            ls,
            "ShellLsOutputTaskVTable.onWriteOut(0x{:x})",
            this as *const _ as usize
        );
        this.exec_mut().output_done += 1;
    }

    fn on_done(this: &mut Ls) -> Yield {
        bun_output::scoped_log!(
            ls,
            "ShellLsOutputTaskVTable.onDone(0x{:x})",
            this as *const _ as usize
        );
        this.next()
    }
}

#[derive(Clone, Copy)]
enum ResultKind {
    File,
    Dir,
    Idk,
}

pub struct ShellLsTask<'a> {
    pub ls: *mut Ls,
    pub opts: Opts,

    pub print_directory: bool,
    pub owned_string: bool,
    pub task_count: &'a AtomicUsize,

    pub cwd: Fd,
    // TODO(port): lifetime — `path` is conditionally owned (freed in deinit when
    // `owned_string`), otherwise borrows a `'static` literal. Stored raw to match Zig.
    pub path: *const [u8],
    pub output: Vec<u8>,
    pub is_absolute: bool,
    pub err: Option<Syscall::Error>,
    result_kind: ResultKind,
    /// Cached current time (seconds since epoch) for formatting timestamps.
    /// Cached once per task to avoid repeated syscalls.
    now_secs: u64,

    pub event_loop: EventLoopHandle,
    pub concurrent_task: EventLoopTask,
    pub task: WorkPoolTask,
}

impl<'a> ShellLsTask<'a> {
    pub fn schedule(&mut self) {
        WorkPool::schedule(&mut self.task);
    }

    pub fn create(
        ls: &mut Ls,
        opts: Opts,
        task_count: &'a AtomicUsize,
        cwd: Fd,
        path: &ZStr,
        owned_string: bool,
        event_loop: EventLoopHandle,
    ) -> &'a mut ShellLsTask<'a> {
        // We're going to free `task.path` so ensure it is allocated in this
        // scope and NOT a string literal or other string we don't own.
        if owned_string {
            ls.alloc_scope.assert_in_scope(path.as_bytes());
        }

        // TODO(port): was `ls.alloc_scope.allocator().create(@This())`. Using Box for now;
        // Phase B: decide whether AllocScope must own this allocation for bulk-free.
        let task = Box::leak(Box::new(ShellLsTask {
            ls: ls as *mut Ls,
            opts,
            print_directory: false,
            owned_string,
            task_count,
            cwd,
            path: path.as_bytes() as *const [u8],
            output: Vec::new(),
            is_absolute: false,
            err: None,
            result_kind: ResultKind::Idk,
            now_secs: 0,
            event_loop,
            concurrent_task: EventLoopTask::from_event_loop(event_loop),
            task: WorkPoolTask {
                callback: Self::work_pool_callback,
            },
        }));

        task
    }

    pub fn enqueue(&mut self, path: &ZStr) {
        bun_output::scoped_log!(ShellLsTask, "enqueue: {}", bstr::BStr::new(path.as_bytes()));
        let new_path = self.join(
            &[self.path_bytes(), path.as_bytes()],
            self.is_absolute,
        );

        // SAFETY: `ls` is a BACKREF; the owning Ls outlives all tasks (it counts them).
        let ls = unsafe { &mut *self.ls };
        let subtask = ShellLsTask::create(
            ls,
            self.opts,
            self.task_count,
            self.cwd,
            &new_path,
            true,
            self.event_loop,
        );
        let _ = self.task_count.fetch_add(1, Ordering::Relaxed);
        subtask.print_directory = true;
        subtask.schedule();
    }

    #[inline]
    fn join(&self, subdir_parts: &[&[u8]], is_absolute: bool) -> Box<ZStr> {
        // TODO(port): was `alloc: Allocator` param (alloc_scope). Dropped per guide.
        if !is_absolute {
            // If relative paths enabled, stdlib join is preferred over
            // ResolvePath.joinBuf because it doesn't try to normalize the path
            // TODO(port): std.fs.path.joinZ — needs a non-normalizing byte-path joinZ helper in bun_paths.
            return bun_paths::join_z_no_normalize(subdir_parts);
        }

        let joined = bun_paths::join(subdir_parts, bun_paths::Platform::Auto);
        ZStr::from_bytes(joined)
    }

    pub fn run(&mut self) {
        // Cache current time once per task for timestamp formatting
        if self.opts.long_listing {
            // TODO(port): std.time.timestamp() — confirm bun_core helper; using SystemTime for now.
            self.now_secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
        }

        let fd = match ShellSyscall::openat(
            self.cwd,
            self.path_zstr(),
            bun_sys::O::RDONLY | bun_sys::O::DIRECTORY,
            0,
        ) {
            bun_sys::Result::Err(e) => {
                match e.get_errno() {
                    bun_sys::Errno::NOENT => {
                        self.err = Some(self.error_with_path(e, self.path_zstr()));
                    }
                    bun_sys::Errno::NOTDIR => {
                        self.result_kind = ResultKind::File;
                        let path = self.path_zstr_owned();
                        self.add_entry(&path, self.cwd);
                    }
                    _ => {
                        self.err = Some(self.error_with_path(e, self.path_zstr()));
                    }
                }
                return;
            }
            bun_sys::Result::Ok(fd) => fd,
        };

        // PORT NOTE: `defer { fd.close(); debug("run done"); }` — explicit close at each return below.
        // TODO(port): consider RAII guard for fd.

        if !self.opts.list_directories {
            if self.print_directory {
                let _ = write!(&mut self.output, "{}:\n", bstr::BStr::new(self.path_bytes()));
            }

            let mut iterator = bun_core::DirIterator::iterate(fd, bun_core::DirIterator::Encoding::U8);
            let mut entry = iterator.next();

            // If `-a` is used, "." and ".." should show up as results. However,
            // our `DirIterator` abstraction skips them, so let's just add them
            // now.
            self.add_dot_entries_if_needed(fd);

            loop {
                let current = match entry {
                    bun_sys::Result::Err(e) => {
                        self.err = Some(self.error_with_path(e, self.path_zstr()));
                        fd.close();
                        bun_output::scoped_log!(ShellLsTask, "run done");
                        return;
                    }
                    bun_sys::Result::Ok(ent) => ent,
                };
                let Some(current) = current else { break };

                self.add_entry(current.name.slice_assume_z(), fd);
                if current.kind == bun_core::DirIterator::Kind::Directory && self.opts.recursive {
                    self.enqueue(current.name.slice_assume_z());
                }

                entry = iterator.next();
            }

            fd.close();
            bun_output::scoped_log!(ShellLsTask, "run done");
            return;
        }

        let _ = write!(&mut self.output, "{}\n", bstr::BStr::new(self.path_bytes()));
        fd.close();
        bun_output::scoped_log!(ShellLsTask, "run done");
    }

    fn should_skip_entry(&self, name: &ZStr) -> bool {
        if self.opts.show_all {
            return false;
        }

        // Show all directory entries whose name begin with a dot (`.`), EXCEPT
        // `.` and `..`
        if self.opts.show_almost_all {
            if name.as_bytes() == b"." || name.as_bytes() == b".." {
                return true;
            }
        } else {
            if name.as_bytes().starts_with(b".") {
                return true;
            }
        }

        false
    }

    // TODO more complex output like multi-column
    fn add_entry(&mut self, name: &ZStr, dir_fd: Fd) {
        let skip = self.should_skip_entry(name);
        bun_output::scoped_log!(
            ShellLsTask,
            "Entry: (skip={}) {} :: {}",
            skip,
            bstr::BStr::new(self.path_bytes()),
            bstr::BStr::new(name.as_bytes())
        );
        if skip {
            return;
        }

        if self.opts.long_listing {
            self.add_entry_long(name, dir_fd);
        } else {
            self.output.reserve(name.as_bytes().len() + 1);
            // PERF(port): was ensureUnusedCapacity + appendSlice + append
            self.output.extend_from_slice(name.as_bytes());
            self.output.push(b'\n');
        }
    }

    fn add_entry_long(&mut self, name: &ZStr, dir_fd: Fd) {
        // Use lstatat to not follow symlinks (so symlinks show as 'l' type)
        let stat_result = Syscall::lstatat(dir_fd, name);
        let stat = match stat_result {
            bun_sys::Result::Err(_) => {
                // If stat fails, just output the name with placeholders
                let _ = write!(
                    &mut self.output,
                    "?????????? ? ? ? ?            ? {}\n",
                    bstr::BStr::new(name.as_bytes())
                );
                return;
            }
            bun_sys::Result::Ok(s) => s,
        };

        // File type and permissions
        let mode: u32 = u32::try_from(stat.mode).unwrap();
        let file_type = Self::get_file_type_char(mode);
        let perms = Self::format_permissions(mode);

        // Number of hard links
        let nlink: u64 = u64::try_from(stat.nlink).unwrap();

        // Owner and group (numeric)
        let uid: u64 = u64::try_from(stat.uid).unwrap();
        let gid: u64 = u64::try_from(stat.gid).unwrap();

        // File size
        let size: i64 = i64::try_from(stat.size).unwrap();

        // Modification time
        let mtime = stat.mtime();
        let time_str = Self::format_time(i64::try_from(mtime.sec).unwrap(), self.now_secs);

        // TODO(port): Zig fmt specifiers `{d: >3}`/`{d: >5}`/`{d: >8}` — Rust `{:>3}` etc.
        let _ = write!(
            &mut self.output,
            "{}{} {:>3} {:>5} {:>5} {:>8} {} {}\n",
            file_type as char,
            bstr::BStr::new(&perms),
            nlink,
            uid,
            gid,
            size,
            bstr::BStr::new(&time_str),
            bstr::BStr::new(name.as_bytes()),
        );
    }

    fn get_file_type_char(mode: u32) -> u8 {
        let file_type = mode & S::IFMT;
        match file_type {
            S::IFDIR => b'd',
            S::IFLNK => b'l',
            S::IFBLK => b'b',
            S::IFCHR => b'c',
            S::IFIFO => b'p',
            S::IFSOCK => b's',
            _ => b'-', // IFREG or unknown
        }
    }

    fn format_permissions(mode: u32) -> [u8; 9] {
        let mut perms: [u8; 9] = [0; 9];
        // Owner permissions
        perms[0] = if mode & S::IRUSR != 0 { b'r' } else { b'-' };
        perms[1] = if mode & S::IWUSR != 0 { b'w' } else { b'-' };
        // Owner execute with setuid handling
        let owner_exec = mode & S::IXUSR != 0;
        let setuid = mode & S::ISUID != 0;
        perms[2] = if setuid {
            if owner_exec { b's' } else { b'S' }
        } else {
            if owner_exec { b'x' } else { b'-' }
        };

        // Group permissions
        perms[3] = if mode & S::IRGRP != 0 { b'r' } else { b'-' };
        perms[4] = if mode & S::IWGRP != 0 { b'w' } else { b'-' };
        // Group execute with setgid handling
        let group_exec = mode & S::IXGRP != 0;
        let setgid = mode & S::ISGID != 0;
        perms[5] = if setgid {
            if group_exec { b's' } else { b'S' }
        } else {
            if group_exec { b'x' } else { b'-' }
        };

        // Other permissions
        perms[6] = if mode & S::IROTH != 0 { b'r' } else { b'-' };
        perms[7] = if mode & S::IWOTH != 0 { b'w' } else { b'-' };
        // Other execute with sticky bit handling
        let other_exec = mode & S::IXOTH != 0;
        let sticky = mode & S::ISVTX != 0;
        perms[8] = if sticky {
            if other_exec { b't' } else { b'T' }
        } else {
            if other_exec { b'x' } else { b'-' }
        };

        perms
    }

    fn format_time(timestamp: i64, now_secs: u64) -> [u8; 12] {
        let mut buf: [u8; 12] = [0; 12];
        // Format as "Mon DD HH:MM" for recent files (within 6 months)
        // or "Mon DD  YYYY" for older files
        let epoch_secs: u64 = if timestamp < 0 { 0 } else { u64::try_from(timestamp).unwrap() };
        // TODO(port): std.time.epoch.EpochSeconds — needs bun_core::time::Epoch helper
        // (calculateYearDay/calculateMonthDay/getDaySeconds). Phase B: provide or vendor.
        let epoch = bun_core::time::EpochSeconds { secs: epoch_secs };
        let day_seconds = epoch.get_day_seconds();
        let year_day = epoch.get_epoch_day().calculate_year_day();

        const MONTH_NAMES: [&[u8]; 12] = [
            b"Jan", b"Feb", b"Mar", b"Apr", b"May", b"Jun", b"Jul", b"Aug", b"Sep", b"Oct", b"Nov",
            b"Dec",
        ];
        let month_day = year_day.calculate_month_day();
        let month_name = MONTH_NAMES[(month_day.month.numeric() - 1) as usize];

        // Check if file is older than 6 months (approximately 180 days)
        const SIX_MONTHS_SECS: u64 = 180 * 24 * 60 * 60;
        let is_recent = epoch_secs > now_secs.saturating_sub(SIX_MONTHS_SECS)
            && epoch_secs <= now_secs + SIX_MONTHS_SECS;

        if is_recent {
            let hours = day_seconds.get_hours_into_day();
            let minutes = day_seconds.get_minutes_into_hour();

            let mut cursor: &mut [u8] = &mut buf[..];
            if write!(
                &mut cursor,
                "{} {:02} {:02}:{:02}",
                bstr::BStr::new(month_name),
                month_day.day_index + 1,
                hours,
                minutes,
            )
            .is_err()
            {
                buf.copy_from_slice(b"??? ?? ??:??");
            }
        } else {
            // Show year for old files
            let year = year_day.year;

            let mut cursor: &mut [u8] = &mut buf[..];
            if write!(
                &mut cursor,
                "{} {:02}  {:4}",
                bstr::BStr::new(month_name),
                month_day.day_index + 1,
                year,
            )
            .is_err()
            {
                buf.copy_from_slice(b"??? ??  ????");
            }
        }

        buf
    }

    fn add_dot_entries_if_needed(&mut self, dir_fd: Fd) {
        // `.addEntry()` already checks will check if we can add "." and ".." to
        // the result
        self.add_entry(ZStr::from_static(b".\0"), dir_fd);
        self.add_entry(ZStr::from_static(b"..\0"), dir_fd);
    }

    fn error_with_path(&self, err: Syscall::Error, path: &ZStr) -> Syscall::Error {
        bun_output::scoped_log!(
            ShellLsTask,
            "Ls(0x{:x}).errorWithPath({})",
            self as *const _ as usize,
            bstr::BStr::new(path.as_bytes())
        );
        // TODO(port): was `alloc_scope.allocator().dupeZ` — Syscall::Error::with_path takes ownership in Rust.
        err.with_path(ZStr::from_bytes(path.as_bytes()))
    }

    pub fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to ShellLsTask.task (intrusive field).
        let this: &mut ShellLsTask = unsafe {
            &mut *(task as *mut u8)
                .sub(offset_of!(ShellLsTask, task))
                .cast::<ShellLsTask>()
        };
        this.run();
        this.done_logic();
    }

    fn done_logic(&mut self) {
        bun_output::scoped_log!(ShellLsTask, "Done");
        // TODO(port): EventLoopHandle is a union(enum) { js, mini }; model as Rust enum in bun_jsc.
        match &mut self.event_loop {
            EventLoopHandle::Js(js) => {
                js.enqueue_task_concurrent(
                    self.concurrent_task
                        .js_mut()
                        .from(self, jsc::ConcurrentTaskDeinit::ManualDeinit),
                );
            }
            EventLoopHandle::Mini(mini) => {
                mini.enqueue_task_concurrent(
                    self.concurrent_task
                        .mini_mut()
                        .from(self, "runFromMainThreadMini"),
                );
            }
        }
    }

    pub fn take_output(&mut self) -> Vec<u8> {
        core::mem::take(&mut self.output)
    }

    pub fn run_from_main_thread(&mut self) {
        bun_output::scoped_log!(ShellLsTask, "runFromMainThread");
        // SAFETY: BACKREF — Ls outlives task; mutating on main thread only.
        let ls = unsafe { &mut *self.ls };
        ls.on_shell_ls_task_done(self);
    }

    pub fn run_from_main_thread_mini(&mut self, _: *mut core::ffi::c_void) {
        self.run_from_main_thread();
    }

    /// SAFETY: `this` must be the pointer originally `Box::leak`'d in `create`;
    /// caller must not use it after this call.
    pub unsafe fn destroy(this: *mut Self) {
        bun_output::scoped_log!(ShellLsTask, "deinit {}", "free");
        let this_ref = unsafe { &mut *this };
        if this_ref.owned_string {
            // SAFETY: when owned_string, `path` was allocated via alloc_scope.dupe_z (Box<ZStr>).
            // TODO(port): alloc_scope.free(path) — reconstruct Box and drop.
            unsafe {
                drop(Box::from_raw(this_ref.path as *mut [u8]));
            }
        }
        if let Some(err) = this_ref.err.take() {
            // TODO(port): err.deinitWithAllocator(alloc_scope) — Drop handles owned path.
            drop(err);
        }
        // self.output: Vec<u8> drops automatically; explicit for parity with Zig deinit order.
        this_ref.output = Vec::new();
        // SAFETY: `this` was Box::leak'd in `create`; reclaim and drop here.
        // TODO(port): was alloc_scope.allocator().destroy(this).
        unsafe {
            drop(Box::from_raw(this));
        }
    }

    // ── small helpers (PORT NOTE: not in Zig; raw `path` accessors) ──
    #[inline]
    fn path_bytes(&self) -> &[u8] {
        // SAFETY: `path` is valid for the task's lifetime (owned or 'static).
        unsafe { &*self.path }
    }
    #[inline]
    fn path_zstr(&self) -> &ZStr {
        // SAFETY: `path` always points at NUL-terminated bytes (dupeZ or literal).
        unsafe { ZStr::from_raw(self.path_bytes().as_ptr(), self.path_bytes().len()) }
    }
    #[inline]
    fn path_zstr_owned(&self) -> Box<ZStr> {
        // PORT NOTE: reshaped for borrowck — addEntry needs &mut self while borrowing path.
        ZStr::from_bytes(self.path_bytes())
    }
}

#[derive(Clone, Copy)]
pub struct Opts {
    /// `-a`, `--all`
    /// Do not ignore entries starting with .
    pub show_all: bool,

    /// `-A`, `--almost-all`
    /// Include directory entries whose names begin with a dot (‘.’) except for
    /// `.` and `..`
    pub show_almost_all: bool,

    /// `--author`
    /// With -l, print the author of each file
    pub show_author: bool,

    /// `-b`, `--escape`
    /// Print C-style escapes for nongraphic characters
    pub escape: bool,

    /// `--block-size=SIZE`
    /// With -l, scale sizes by SIZE when printing them; e.g., '--block-size=M'
    pub block_size: Option<usize>,

    /// `-B`, `--ignore-backups`
    /// Do not list implied entries ending with ~
    pub ignore_backups: bool,

    /// `-c`
    /// Sort by, and show, ctime (time of last change of file status information); affects sorting and display based on options
    pub use_ctime: bool,

    /// `-C`
    /// List entries by columns
    pub list_by_columns: bool,

    /// `--color[=WHEN]`
    /// Color the output; WHEN can be 'always', 'auto', or 'never'
    pub color: Option<&'static [u8]>,

    /// `-d`, `--directory`
    /// List directories themselves, not their contents
    pub list_directories: bool,

    /// `-D`, `--dired`
    /// Generate output designed for Emacs' dired mode
    pub dired_mode: bool,

    /// `-f`
    /// List all entries in directory order
    pub unsorted: bool,

    /// `-F`, `--classify[=WHEN]`
    /// Append indicator (one of */=>@|) to entries; WHEN can be 'always', 'auto', or 'never'
    pub classify: Option<&'static [u8]>,

    /// `--file-type`
    /// Likewise, except do not append '*'
    pub file_type: bool,

    /// `--format=WORD`
    /// Specify format: 'across', 'commas', 'horizontal', 'long', 'single-column', 'verbose', 'vertical'
    pub format: Option<&'static [u8]>,

    /// `--full-time`
    /// Like -l --time-style=full-iso
    pub full_time: bool,

    /// `-g`
    /// Like -l, but do not list owner
    pub no_owner: bool,

    /// `--group-directories-first`
    /// Group directories before files
    pub group_directories_first: bool,

    /// `-G`, `--no-group`
    /// In a long listing, don't print group names
    pub no_group: bool,

    /// `-h`, `--human-readable`
    /// With -l and -s, print sizes like 1K 234M 2G etc.
    pub human_readable: bool,

    /// `--si`
    /// Use powers of 1000 not 1024 for sizes
    pub si_units: bool,

    /// `-H`, `--dereference-command-line`
    /// Follow symbolic links listed on the command line
    pub dereference_cmd_symlinks: bool,

    /// `--dereference-command-line-symlink-to-dir`
    /// Follow each command line symbolic link that points to a directory
    pub dereference_cmd_dir_symlinks: bool,

    /// `--hide=PATTERN`
    /// Do not list entries matching shell PATTERN
    pub hide_pattern: Option<&'static [u8]>,

    /// `--hyperlink[=WHEN]`
    /// Hyperlink file names; WHEN can be 'always', 'auto', or 'never'
    pub hyperlink: Option<&'static [u8]>,

    /// `--indicator-style=WORD`
    /// Append indicator with style to entry names: 'none', 'slash', 'file-type', 'classify'
    pub indicator_style: Option<&'static [u8]>,

    /// `-i`, `--inode`
    /// Print the index number of each file
    pub show_inode: bool,

    /// `-I`, `--ignore=PATTERN`
    /// Do not list entries matching shell PATTERN
    pub ignore_pattern: Option<&'static [u8]>,

    /// `-k`, `--kibibytes`
    /// Default to 1024-byte blocks for file system usage
    pub kibibytes: bool,

    /// `-l`
    /// Use a long listing format
    pub long_listing: bool,

    /// `-L`, `--dereference`
    /// Show information for the file the symbolic link references
    pub dereference: bool,

    /// `-m`
    /// Fill width with a comma separated list of entries
    pub comma_separated: bool,

    /// `-n`, `--numeric-uid-gid`
    /// Like -l, but list numeric user and group IDs
    pub numeric_uid_gid: bool,

    /// `-N`, `--literal`
    /// Print entry names without quoting
    pub literal: bool,

    /// `-o`
    /// Like -l, but do not list group information
    pub no_group_info: bool,

    /// `-p`, `--indicator-style=slash`
    /// Append / indicator to directories
    pub slash_indicator: bool,

    /// `-q`, `--hide-control-chars`
    /// Print ? instead of nongraphic characters
    pub hide_control_chars: bool,

    /// `--show-control-chars`
    /// Show nongraphic characters as-is
    pub show_control_chars: bool,

    /// `-Q`, `--quote-name`
    /// Enclose entry names in double quotes
    pub quote_name: bool,

    /// `--quoting-style=WORD`
    /// Use quoting style for entry names
    pub quoting_style: Option<&'static [u8]>,

    /// `-r`, `--reverse`
    /// Reverse order while sorting
    pub reverse_order: bool,

    /// `-R`, `--recursive`
    /// List subdirectories recursively
    pub recursive: bool,

    /// `-s`, `--size`
    /// Print the allocated size of each file, in blocks
    pub show_size: bool,

    /// `-S`
    /// Sort by file size, largest first
    pub sort_by_size: bool,

    /// `--sort=WORD`
    /// Sort by a specified attribute
    pub sort_method: Option<&'static [u8]>,

    /// `--time=WORD`
    /// Select which timestamp to use for display or sorting
    pub time_method: Option<&'static [u8]>,

    /// `--time-style=TIME_STYLE`
    /// Time/date format with -l
    pub time_style: Option<&'static [u8]>,

    /// `-t`
    /// Sort by time, newest first
    pub sort_by_time: bool,

    /// `-T`, `--tabsize=COLS`
    /// Assume tab stops at each specified number of columns
    pub tabsize: Option<usize>,

    /// `-u`
    /// Sort by, and show, access time
    pub use_atime: bool,

    /// `-U`
    /// Do not sort; list entries in directory order
    pub no_sort: bool,

    /// `-v`
    /// Natural sort of (version) numbers within text
    pub natural_sort: bool,

    /// `-w`, `--width=COLS`
    /// Set output width to specified number of columns
    pub output_width: Option<usize>,

    /// `-x`
    /// List entries by lines instead of by columns
    pub list_by_lines: bool,

    /// `-X`
    /// Sort alphabetically by entry extension
    pub sort_by_extension: bool,

    /// `-Z`, `--context`
    /// Print any security context of each file
    pub show_context: bool,

    /// `--zero`
    /// End each output line with NUL, not newline
    pub end_with_nul: bool,

    /// `-1`
    /// List one file per line
    pub one_file_per_line: bool,

    /// `--help`
    /// Display help and exit
    pub show_help: bool,

    /// `--version`
    /// Output version information and exit
    pub show_version: bool,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            show_all: false,
            show_almost_all: false,
            show_author: false,
            escape: false,
            block_size: None,
            ignore_backups: false,
            use_ctime: false,
            list_by_columns: false,
            color: None,
            list_directories: false,
            dired_mode: false,
            unsorted: false,
            classify: None,
            file_type: false,
            format: None,
            full_time: false,
            no_owner: false,
            group_directories_first: false,
            no_group: false,
            human_readable: false,
            si_units: false,
            dereference_cmd_symlinks: false,
            dereference_cmd_dir_symlinks: false,
            hide_pattern: None,
            hyperlink: None,
            indicator_style: None,
            show_inode: false,
            ignore_pattern: None,
            kibibytes: false,
            long_listing: false,
            dereference: false,
            comma_separated: false,
            numeric_uid_gid: false,
            literal: false,
            no_group_info: false,
            slash_indicator: false,
            hide_control_chars: false,
            show_control_chars: false,
            quote_name: false,
            quoting_style: None,
            reverse_order: false,
            recursive: false,
            show_size: false,
            sort_by_size: false,
            sort_method: None,
            time_method: None,
            time_style: None,
            sort_by_time: false,
            tabsize: None,
            use_atime: false,
            no_sort: false,
            natural_sort: false,
            output_width: None,
            list_by_lines: false,
            sort_by_extension: false,
            show_context: false,
            end_with_nul: false,
            one_file_per_line: false,
            show_help: false,
            show_version: false,
        }
    }
}

/// Custom parse error for invalid options
pub enum OptsParseError {
    // PORT NOTE: Zig `illegal_option: []const u8` borrows from argv; using an owned 1-byte
    // copy here to preserve the offending byte without threading a lifetime through Builtin.Result.
    // TODO(port): thread `'a` lifetime and return `&flag[1..2]` directly.
    IllegalOption(Box<[u8]>),
    ShowUsage,
}

pub enum ParseFlagResult {
    ContinueParsing,
    Done,
    IllegalOption(Box<[u8]>),
}

impl Ls {
    pub fn parse_opts(&mut self) -> BuiltinResult<Option<&[*const c_char]>, OptsParseError> {
        self.parse_flags()
    }

    pub fn parse_flags(&mut self) -> BuiltinResult<Option<&[*const c_char]>, OptsParseError> {
        let args = self.bltn().args_slice();
        let mut idx: usize = 0;
        if args.is_empty() {
            return BuiltinResult::Ok(None);
        }

        while idx < args.len() {
            let flag = args[idx];
            // SAFETY: argsSlice() entries are NUL-terminated.
            let flag_bytes = unsafe { CStr::from_ptr(flag) }.to_bytes();
            match self.parse_flag(flag_bytes) {
                ParseFlagResult::Done => {
                    let filepath_args = &args[idx..];
                    return BuiltinResult::Ok(Some(filepath_args));
                }
                ParseFlagResult::ContinueParsing => {}
                ParseFlagResult::IllegalOption(opt_str) => {
                    return BuiltinResult::Err(OptsParseError::IllegalOption(opt_str));
                }
            }
            idx += 1;
        }

        BuiltinResult::Ok(None)
    }

    pub fn parse_flag(&mut self, flag: &[u8]) -> ParseFlagResult {
        if flag.is_empty() {
            return ParseFlagResult::Done;
        }
        if flag[0] != b'-' {
            return ParseFlagResult::Done;
        }

        // FIXME windows
        if flag.len() == 1 {
            return ParseFlagResult::IllegalOption(Box::from(&b"-"[..]));
        }

        let small_flags = &flag[1..];
        for &char in small_flags {
            match char {
                b'a' => {
                    self.opts.show_all = true;
                }
                b'A' => {
                    self.opts.show_almost_all = true;
                }
                b'b' => {
                    self.opts.escape = true;
                }
                b'B' => {
                    self.opts.ignore_backups = true;
                }
                b'c' => {
                    self.opts.use_ctime = true;
                }
                b'C' => {
                    self.opts.list_by_columns = true;
                }
                b'd' => {
                    self.opts.list_directories = true;
                }
                b'D' => {
                    self.opts.dired_mode = true;
                }
                b'f' => {
                    self.opts.unsorted = true;
                }
                b'F' => {
                    self.opts.classify = Some(b"always");
                }
                b'g' => {
                    self.opts.no_owner = true;
                }
                b'G' => {
                    self.opts.no_group = true;
                }
                b'h' => {
                    self.opts.human_readable = true;
                }
                b'H' => {
                    self.opts.dereference_cmd_symlinks = true;
                }
                b'i' => {
                    self.opts.show_inode = true;
                }
                b'I' => {
                    self.opts.ignore_pattern = Some(b""); // This will require additional logic to handle patterns
                }
                b'k' => {
                    self.opts.kibibytes = true;
                }
                b'l' => {
                    self.opts.long_listing = true;
                }
                b'L' => {
                    self.opts.dereference = true;
                }
                b'm' => {
                    self.opts.comma_separated = true;
                }
                b'n' => {
                    self.opts.numeric_uid_gid = true;
                }
                b'N' => {
                    self.opts.literal = true;
                }
                b'o' => {
                    self.opts.no_group_info = true;
                }
                b'p' => {
                    self.opts.slash_indicator = true;
                }
                b'q' => {
                    self.opts.hide_control_chars = true;
                }
                b'Q' => {
                    self.opts.quote_name = true;
                }
                b'r' => {
                    self.opts.reverse_order = true;
                }
                b'R' => {
                    self.opts.recursive = true;
                }
                b's' => {
                    self.opts.show_size = true;
                }
                b'S' => {
                    self.opts.sort_by_size = true;
                }
                b't' => {
                    self.opts.sort_by_time = true;
                }
                b'T' => {
                    self.opts.tabsize = Some(8); // Default tab size, needs additional handling for custom sizes
                }
                b'u' => {
                    self.opts.use_atime = true;
                }
                b'U' => {
                    self.opts.no_sort = true;
                }
                b'v' => {
                    self.opts.natural_sort = true;
                }
                b'w' => {
                    self.opts.output_width = Some(0); // Default to no limit, needs additional handling for custom widths
                }
                b'x' => {
                    self.opts.list_by_lines = true;
                }
                b'X' => {
                    self.opts.sort_by_extension = true;
                }
                b'Z' => {
                    self.opts.show_context = true;
                }
                b'1' => {
                    self.opts.one_file_per_line = true;
                }
                _ => {
                    return ParseFlagResult::IllegalOption(Box::from(&flag[1..2]));
                }
            }
        }

        ParseFlagResult::ContinueParsing
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: `self` is the `ls` field of `Builtin.Impl`, which is the `impl` field of `Builtin`.
        unsafe {
            let impl_ptr = (self as *mut Ls as *mut u8)
                .sub(offset_of!(Builtin::Impl, ls))
                .cast::<Builtin::Impl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/ls.zig (1026 lines)
//   confidence: medium
//   todos:      19
//   notes:      AllocScope ownership + std.time.epoch helpers + OutputTask vtable shape need Phase B; ShellLsTask.path stored raw (conditionally owned via owned_string); IllegalOption carries owned 1-byte copy pending lifetime threading.
// ──────────────────────────────────────────────────────────────────────────
