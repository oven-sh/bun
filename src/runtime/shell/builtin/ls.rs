use core::ffi::CStr;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::io::Write as _;

use bun_core::ZBox;
use bun_sys::{E, FdExt, O, S, dir_iterator};

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, IoKind, Kind};
use crate::shell::interpreter::{
    EventLoopHandle, Interpreter, NodeId, OutputSrc, OutputTask, OutputTaskVTable, ShellTask,
    shell_openat,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Ls {
    pub opts: Opts,
    pub state: State,
}

#[derive(Default)]
pub enum State {
    #[default]
    Idle,
    Exec(ExecState),
    WaitingWriteErr,
    Done,
}

pub struct ExecState {
    pub err: Option<bun_sys::Error>,
    pub task_count: AtomicUsize,
    pub tasks_done: usize,
    pub output_waiting: usize,
    pub output_done: usize,
    /// FIFO of in-flight OutputTask pointers awaiting an IOWriter chunk
    /// completion. Stopgap until `WriterTag` can carry the `*mut OutputTask`
    /// directly — see mkdir.rs `Exec::output_queue` for rationale.
    pub output_queue: std::collections::VecDeque<*mut OutputTask<Ls>>,
}

/// Custom parse error for invalid options. Spec: ls.zig `Opts.ParseError` (ls
/// uses its own per-byte parser, not the shared `FlagParser`).
pub enum LsParseError {
    /// Carries an owned 1-byte copy of the offending flag char.
    IllegalOption(Box<[u8]>),
    ShowUsage,
}

enum ParseFlag {
    ContinueParsing,
    Done,
    IllegalOption(Box<[u8]>),
}

impl Ls {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        Self::next(interp, cmd)
    }

    pub fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        loop {
            // PORT NOTE: reshaped for borrowck — match on a tag, drop the
            // borrow, then act.
            enum Tag {
                Idle,
                Exec,
                WaitingWriteErr,
                Done,
            }
            let tag = match Self::state_mut(interp, cmd).state {
                State::Idle => Tag::Idle,
                State::Exec(_) => Tag::Exec,
                State::WaitingWriteErr => Tag::WaitingWriteErr,
                State::Done => Tag::Done,
            };
            match tag {
                Tag::Idle => {
                    // Parse opts; will be None if called with no args, in
                    // which case we run once with ".".
                    let paths_start = match Self::parse_opts(interp, cmd) {
                        Ok(p) => p,
                        Err(e) => {
                            let buf: Vec<u8> = match e {
                                LsParseError::IllegalOption(opt) => Builtin::fmt_error_arena(
                                    interp,
                                    cmd,
                                    Some(Kind::Ls),
                                    format_args!(
                                        "illegal option -- {}\n",
                                        bstr::BStr::new(&opt[..])
                                    ),
                                )
                                .to_vec(),
                                LsParseError::ShowUsage => Kind::Ls.usage_string().to_vec(),
                            };
                            Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
                            return Builtin::write_failing_error(interp, cmd, &buf, 1);
                        }
                    };

                    let argc = Builtin::of(interp, cmd).args_slice().len();
                    let task_count = match paths_start {
                        Some(start) => argc - start,
                        None => 1,
                    };
                    Self::state_mut(interp, cmd).state = State::Exec(ExecState {
                        err: None,
                        task_count: AtomicUsize::new(task_count),
                        tasks_done: 0,
                        output_waiting: 0,
                        output_done: 0,
                        output_queue: std::collections::VecDeque::new(),
                    });

                    // Stable address: `Ls` lives in `Box<Ls>` (Builtin::Impl::Ls),
                    // and the `Exec` variant is held until all tasks finish.
                    let task_count_ptr: *const AtomicUsize = {
                        let State::Exec(exec) = &Self::state_mut(interp, cmd).state else {
                            unreachable!()
                        };
                        &raw const exec.task_count
                    };

                    let cwd = Builtin::cwd(interp, cmd);
                    let opts = Self::state_mut(interp, cmd).opts;
                    let evtloop = Builtin::event_loop(interp, cmd);
                    let interp_ptr = interp.as_ctx_ptr();
                    if let Some(start) = paths_start {
                        let print_directory = task_count > 1;
                        for i in start..argc {
                            let path = Builtin::of(interp, cmd).arg_bytes(i);
                            let task = ShellLsTask::create(
                                cmd,
                                opts,
                                task_count_ptr,
                                cwd,
                                ZBox::from_bytes(path),
                                evtloop,
                                interp_ptr,
                            );
                            // SAFETY: freshly heap-allocated.
                            unsafe {
                                (*task).print_directory = print_directory;
                                ShellTask::schedule_no_ref::<ShellLsTask>(task);
                            }
                        }
                    } else {
                        let task = ShellLsTask::create(
                            cmd,
                            opts,
                            task_count_ptr,
                            cwd,
                            ZBox::from_bytes(b"."),
                            evtloop,
                            interp_ptr,
                        );
                        // SAFETY: freshly heap-allocated.
                        unsafe { ShellTask::schedule_no_ref::<ShellLsTask>(task) };
                    }
                    return Yield::suspended();
                }
                Tag::Exec => {
                    let done = {
                        let State::Exec(exec) = &Self::state_mut(interp, cmd).state else {
                            unreachable!()
                        };
                        exec.tasks_done >= exec.task_count.load(Ordering::Relaxed)
                            && exec.output_done >= exec.output_waiting
                    };
                    if done {
                        let exit_code: ExitCode = {
                            let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                                unreachable!()
                            };
                            let code = if exec.err.is_some() { 1 } else { 0 };
                            exec.err = None;
                            code
                        };
                        Self::state_mut(interp, cmd).state = State::Done;
                        return Builtin::done(interp, cmd, exit_code);
                    }
                    return Yield::suspended();
                }
                Tag::WaitingWriteErr => return Yield::failed(),
                Tag::Done => return Builtin::done(interp, cmd, 0),
            }
        }
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        written: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if matches!(Self::state_mut(interp, cmd).state, State::WaitingWriteErr) {
            return Builtin::done(interp, cmd, 1);
        }
        let pending = if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_queue.pop_front()
        } else {
            None
        };
        if let Some(task) = pending {
            // SAFETY: `task` was heap-allocated in `OutputTask::new` and
            // pushed by `write_err`/`write_out`; not yet freed.
            return unsafe { OutputTask::<Ls>::on_io_writer_chunk(task, interp, written, e) };
        }
        Self::next(interp, cmd)
    }

    /// Spec: ls.zig `onShellLsTaskDone`.
    pub fn on_shell_ls_task_done(interp: &Interpreter, cmd: NodeId, task: *mut ShellLsTask) {
        // SAFETY: task was heap-allocated in create(); reclaim.
        let mut task = unsafe { bun_core::heap::take(task) };
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.tasks_done += 1;
        }
        let output = core::mem::take(&mut task.output);
        let output_task = OutputTask::<Ls>::new(cmd, OutputSrc::Arrlist(output));

        let errstr: Option<Vec<u8>> = task.err.take().map(|e| {
            let s = Builtin::task_error_to_string(interp, cmd, Kind::Ls, &e).to_vec();
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                if exec.err.is_none() {
                    exec.err = Some(e);
                }
            }
            s
        });
        OutputTask::<Ls>::start(output_task, interp, errstr.as_deref()).run(interp);
    }

    /// Spec: ls.zig `parseOpts` / `parseFlags`. Returns the index of the
    /// first non-flag arg, or `None` if there are no positional args.
    fn parse_opts(interp: &Interpreter, cmd: NodeId) -> Result<Option<usize>, LsParseError> {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc == 0 {
            return Ok(None);
        }
        let mut idx = 0usize;
        while idx < argc {
            let flag = Builtin::of(interp, cmd).arg_bytes(idx);
            match Self::parse_flag(&mut Self::state_mut(interp, cmd).opts, flag) {
                ParseFlag::Done => return Ok(Some(idx)),
                ParseFlag::ContinueParsing => {}
                ParseFlag::IllegalOption(s) => return Err(LsParseError::IllegalOption(s)),
            }
            idx += 1;
        }
        Ok(None)
    }

    fn parse_flag(opts: &mut Opts, flag: &[u8]) -> ParseFlag {
        if flag.is_empty() || flag[0] != b'-' {
            return ParseFlag::Done;
        }
        // FIXME windows
        if flag.len() == 1 {
            return ParseFlag::IllegalOption(Box::from(&b"-"[..]));
        }
        for &ch in &flag[1..] {
            match ch {
                b'a' => opts.show_all = true,
                b'A' => opts.show_almost_all = true,
                b'd' => opts.list_directories = true,
                b'l' => opts.long_listing = true,
                b'R' => opts.recursive = true,
                b'r' => opts.reverse_order = true,
                b'1' => opts.one_file_per_line = true,
                // The remaining short flags are recognised but currently no-op
                // (mirrors Zig — most fields exist only for parsing parity).
                b'b' | b'B' | b'c' | b'C' | b'D' | b'f' | b'F' | b'g' | b'G' | b'h' | b'H'
                | b'i' | b'I' | b'k' | b'L' | b'm' | b'n' | b'N' | b'o' | b'p' | b'q' | b'Q'
                | b's' | b'S' | b't' | b'T' | b'u' | b'U' | b'v' | b'w' | b'x' | b'X' | b'Z' => {}
                _ => return ParseFlag::IllegalOption(Box::from(&flag[1..2])),
            }
        }
        ParseFlag::ContinueParsing
    }

    #[inline]
    fn state_mut(interp: &Interpreter, cmd: NodeId) -> &mut Ls {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Ls(l) => &mut **l,
            _ => unreachable!(),
        }
    }
}

pub type ShellLsOutputTask = OutputTask<Ls>;

impl OutputTaskVTable for Ls {
    fn write_err(
        interp: &Interpreter,
        cmd: NodeId,
        child: *mut OutputTask<Self>,
        errbuf: &[u8],
    ) -> Option<Yield> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            // Stash so on_io_writer_chunk can route to the OutputTask state
            // machine and reclaim the box (stopgap for missing WriterTag).
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.output_queue.push_back(child);
            }
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return Some(
                Builtin::of_mut(interp, cmd)
                    .stderr
                    .enqueue(childptr, errbuf, safeguard),
            );
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, errbuf);
        None
    }
    fn on_write_err(interp: &Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }
    fn write_out(
        interp: &Interpreter,
        cmd: NodeId,
        child: *mut OutputTask<Self>,
        output: &mut OutputSrc,
    ) -> Option<Yield> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.output_queue.push_back(child);
            }
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            let buf = output.slice().to_vec();
            return Some(
                Builtin::of_mut(interp, cmd)
                    .stdout
                    .enqueue(childptr, &buf, safeguard),
            );
        }
        let buf = output.slice().to_vec();
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        None
    }
    fn on_write_out(interp: &Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }
    fn on_done(interp: &Interpreter, cmd: NodeId) -> Yield {
        Self::next(interp, cmd)
    }
}

#[derive(Clone, Copy, Default)]
pub enum ResultKind {
    File,
    Dir,
    #[default]
    Idk,
}

/// Spec: ls.zig `ShellLsTask`. Opens the path, iterates its entries (or
/// prints the path itself for files / `-d`), accumulating into `output`.
pub struct ShellLsTask {
    pub cmd: NodeId,
    pub opts: Opts,
    pub print_directory: bool,
    /// Shared atomic counter (lives in `ExecState` inside `Box<Ls>`; address
    /// is stable for the lifetime of the Exec state). Spec: `*atomic.Value(usize)`.
    pub task_count: *const AtomicUsize,
    pub cwd: bun_sys::Fd,
    pub path: ZBox,
    pub output: Vec<u8>,
    pub is_absolute: bool,
    pub err: Option<bun_sys::Error>,
    pub result_kind: ResultKind,
    /// Cached current time (seconds since epoch) for formatting timestamps.
    /// Cached once per task to avoid repeated syscalls.
    now_secs: u64,
    pub event_loop: EventLoopHandle,
    /// Back-ref so recursive `enqueue` can populate the subtask's
    /// `task.interp` (needed by [`ShellTask::run_from_main_thread`]).
    pub interp: *mut Interpreter,
    pub task: ShellTask,
}

impl ShellLsTask {
    pub fn create(
        cmd: NodeId,
        opts: Opts,
        task_count: *const AtomicUsize,
        cwd: bun_sys::Fd,
        path: ZBox,
        event_loop: EventLoopHandle,
        interp: *mut Interpreter,
    ) -> *mut ShellLsTask {
        let mut task = Box::new(ShellLsTask {
            cmd,
            opts,
            print_directory: false,
            task_count,
            cwd,
            path,
            output: Vec::new(),
            is_absolute: false,
            err: None,
            result_kind: ResultKind::Idk,
            now_secs: 0,
            event_loop,
            interp,
            task: ShellTask::new(event_loop),
        });
        task.task.interp = interp;
        bun_core::heap::into_raw(task)
    }

    /// Spec: ls.zig `ShellLsTask.enqueue`. Spawns a subtask for a recursively
    /// discovered subdirectory.
    fn enqueue(&mut self, name: &[u8]) {
        let new_path = self.join(name);
        let subtask = ShellLsTask::create(
            self.cmd,
            self.opts,
            self.task_count,
            self.cwd,
            new_path,
            self.event_loop,
            self.interp,
        );
        // SAFETY: `task_count` points into the `Box<Ls>` ExecState which
        // outlives every in-flight task (see `next`). `subtask` is freshly
        // heap-allocated; spec ls.zig `enqueue` calls `subtask.schedule()` =
        // raw `WorkPool.schedule` (no keep-alive ref) — runs on a worker
        // thread with no JS-VM thread-local.
        unsafe {
            (*self.task_count).fetch_add(1, Ordering::Relaxed);
            (*subtask).print_directory = true;
            ShellTask::schedule_no_ref::<ShellLsTask>(subtask);
        }
    }

    /// Spec: ls.zig `ShellLsTask.join`.
    fn join(&self, child: &[u8]) -> ZBox {
        if !self.is_absolute {
            // If relative paths enabled, stdlib join is preferred over
            // ResolvePath.joinBuf because it doesn't try to normalize the path.
            // Spec: `std.fs.path.joinZ` — its `isSep` accepts both '/' and '\'
            // on Windows, so `["foo/", "bar"]` → `foo/bar` (no extra sep).
            let parent = self.path.as_bytes();
            let mut v = Vec::with_capacity(parent.len() + 1 + child.len());
            v.extend_from_slice(parent);
            if parent.last().is_some_and(|&c| !bun_paths::is_sep_native(c)) {
                v.push(bun_paths::SEP);
            }
            v.extend_from_slice(child);
            return ZBox::from_vec(v);
        }
        let out = bun_paths::resolve_path::join::<bun_paths::platform::Auto>(&[
            self.path.as_bytes(),
            child,
        ]);
        ZBox::from_bytes(out)
    }

    /// Spec: ls.zig `ShellLsTask.run`.
    pub fn run_from_thread_pool(this: &mut ShellLsTask) {
        // Cache current time once per task for timestamp formatting.
        if this.opts.long_listing {
            this.now_secs = bun_core::time::timestamp().max(0) as u64;
        }

        let fd = match shell_openat(this.cwd, this.path.as_zstr(), O::RDONLY | O::DIRECTORY, 0) {
            Err(e) => {
                match e.get_errno() {
                    E::ENOENT => {
                        this.err = Some(this.error_with_path(e));
                    }
                    E::ENOTDIR => {
                        this.result_kind = ResultKind::File;
                        // Clone the path to dodge the &mut/& borrow overlap.
                        let p = ZBox::from_bytes(this.path.as_bytes());
                        this.add_entry(p.as_bytes(), this.cwd);
                    }
                    _ => {
                        this.err = Some(this.error_with_path(e));
                    }
                }
                return;
            }
            Ok(fd) => fd,
        };

        // `defer fd.close()` — emulate with a scope guard.
        struct CloseOnDrop(bun_sys::Fd);
        impl Drop for CloseOnDrop {
            fn drop(&mut self) {
                self.0.close();
            }
        }
        let _guard = CloseOnDrop(fd);

        if !this.opts.list_directories {
            if this.print_directory {
                this.output.extend_from_slice(this.path.as_bytes());
                this.output.extend_from_slice(b":\n");
            }

            let mut iterator = dir_iterator::iterate(fd);

            // If `-a` is used, "." and ".." should show up as results. However,
            // our `DirIterator` abstraction skips them, so add them now.
            this.add_dot_entries_if_needed(fd);

            loop {
                match iterator.next() {
                    Err(e) => {
                        this.err = Some(this.error_with_path(e));
                        return;
                    }
                    Ok(None) => break,
                    Ok(Some(current)) => {
                        let name = current.name.slice_u8();
                        this.add_entry(name, fd);
                        if matches!(current.kind, bun_sys::EntryKind::Directory)
                            && this.opts.recursive
                        {
                            this.enqueue(name);
                        }
                    }
                }
            }
            return;
        }

        this.output.extend_from_slice(this.path.as_bytes());
        this.output.push(b'\n');
    }

    /// Spec: ls.zig `shouldSkipEntry`.
    fn should_skip_entry(&self, name: &[u8]) -> bool {
        if self.opts.show_all {
            return false;
        }
        // Show all directory entries whose name begin with a dot (`.`), EXCEPT
        // `.` and `..`.
        if self.opts.show_almost_all {
            if name == b"." || name == b".." {
                return true;
            }
        } else if name.first() == Some(&b'.') {
            return true;
        }
        false
    }

    /// Spec: ls.zig `addEntry`.
    // TODO more complex output like multi-column
    fn add_entry(&mut self, name: &[u8], dir_fd: bun_sys::Fd) {
        if self.should_skip_entry(name) {
            return;
        }
        if self.opts.long_listing {
            self.add_entry_long(name, dir_fd);
        } else {
            self.output.reserve(name.len() + 1);
            self.output.extend_from_slice(name);
            self.output.push(b'\n');
        }
    }

    /// Spec: ls.zig `addEntryLong`.
    fn add_entry_long(&mut self, name: &[u8], dir_fd: bun_sys::Fd) {
        // Use lstatat to not follow symlinks (so symlinks show as 'l' type).
        let name_z = ZBox::from_bytes(name);
        let stat = match bun_sys::lstatat(dir_fd, name_z.as_zstr()) {
            Err(_) => {
                // If stat fails, just output the name with placeholders.
                self.output
                    .extend_from_slice(b"?????????? ? ? ? ?            ? ");
                self.output.extend_from_slice(name);
                self.output.push(b'\n');
                return;
            }
            Ok(s) => s,
        };

        // File type and permissions.
        let mode: u32 = stat.st_mode as u32;
        let file_type = get_file_type_char(mode);
        let perms = format_permissions(mode);

        // Number of hard links.
        let nlink: u64 = stat.st_nlink as u64;

        // Owner and group (numeric).
        let uid: u64 = stat.st_uid as u64;
        let gid: u64 = stat.st_gid as u64;

        // File size.
        let size: i64 = stat.st_size as i64;

        // Modification time.
        let mtime = bun_sys::stat_mtime(&stat);
        let time_str = format_time(mtime.sec, self.now_secs);

        // SAFETY: `perms`/`time_str` are filled with ASCII (`rwx-`/digits/
        // spaces/month abbreviations) by `format_perms`/`format_time` above.
        let _ = write!(
            self.output,
            "{}{} {:>3} {:>5} {:>5} {:>8} {} ",
            file_type as char,
            unsafe { core::str::from_utf8_unchecked(&perms) },
            nlink,
            uid,
            gid,
            size,
            unsafe { core::str::from_utf8_unchecked(&time_str) },
        );
        self.output.extend_from_slice(name);
        self.output.push(b'\n');
    }

    /// Spec: ls.zig `addDotEntriesIfNeeded`.
    fn add_dot_entries_if_needed(&mut self, dir_fd: bun_sys::Fd) {
        // `add_entry()` already checks if we can add "." and ".." to the result.
        self.add_entry(b".", dir_fd);
        self.add_entry(b"..", dir_fd);
    }

    /// Spec: ls.zig `errorWithPath`.
    fn error_with_path(&self, err: bun_sys::Error) -> bun_sys::Error {
        err.with_path(self.path.as_bytes())
    }

    pub fn run_from_main_thread(this: *mut ShellLsTask, interp: &Interpreter) {
        // SAFETY: `this` is a live heap-allocated task.
        let cmd = unsafe { (*this).cmd };
        Ls::on_shell_ls_task_done(interp, cmd, this);
    }
}

/// Spec: ls.zig `getFileTypeChar`.
fn get_file_type_char(mode: u32) -> u8 {
    let file_type = mode & (S::IFMT as u32);
    match file_type {
        x if x == S::IFDIR as u32 => b'd',
        x if x == S::IFLNK as u32 => b'l',
        x if x == S::IFBLK as u32 => b'b',
        x if x == S::IFCHR as u32 => b'c',
        x if x == S::IFIFO as u32 => b'p',
        x if x == S::IFSOCK as u32 => b's',
        _ => b'-', // IFREG or unknown
    }
}

/// Spec: ls.zig `formatPermissions`.
fn format_permissions(mode: u32) -> [u8; 9] {
    let mut perms = [b'-'; 9];
    // Owner permissions.
    perms[0] = if mode & (S::IRUSR as u32) != 0 {
        b'r'
    } else {
        b'-'
    };
    perms[1] = if mode & (S::IWUSR as u32) != 0 {
        b'w'
    } else {
        b'-'
    };
    // Owner execute with setuid handling.
    let owner_exec = mode & (S::IXUSR as u32) != 0;
    let setuid = mode & (S::ISUID as u32) != 0;
    perms[2] = if setuid {
        if owner_exec { b's' } else { b'S' }
    } else if owner_exec {
        b'x'
    } else {
        b'-'
    };

    // Group permissions.
    perms[3] = if mode & (S::IRGRP as u32) != 0 {
        b'r'
    } else {
        b'-'
    };
    perms[4] = if mode & (S::IWGRP as u32) != 0 {
        b'w'
    } else {
        b'-'
    };
    // Group execute with setgid handling.
    let group_exec = mode & (S::IXGRP as u32) != 0;
    let setgid = mode & (S::ISGID as u32) != 0;
    perms[5] = if setgid {
        if group_exec { b's' } else { b'S' }
    } else if group_exec {
        b'x'
    } else {
        b'-'
    };

    // Other permissions.
    perms[6] = if mode & (S::IROTH as u32) != 0 {
        b'r'
    } else {
        b'-'
    };
    perms[7] = if mode & (S::IWOTH as u32) != 0 {
        b'w'
    } else {
        b'-'
    };
    // Other execute with sticky bit handling.
    let other_exec = mode & (S::IXOTH as u32) != 0;
    let sticky = mode & (S::ISVTX as u32) != 0;
    perms[8] = if sticky {
        if other_exec { b't' } else { b'T' }
    } else if other_exec {
        b'x'
    } else {
        b'-'
    };

    perms
}

/// Spec: ls.zig `formatTime`. Format as `"Mon DD HH:MM"` for recent files
/// (within ~6 months) or `"Mon DD  YYYY"` for older files.
fn format_time(timestamp: i64, now_secs: u64) -> [u8; 12] {
    const MONTH_NAMES: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let mut buf = *b"??? ?? ??:??";
    let epoch_secs: u64 = if timestamp < 0 { 0 } else { timestamp as u64 };

    let secs_of_day = (epoch_secs % 86_400) as u32;
    let days = (epoch_secs / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    let month_name = MONTH_NAMES[(month as usize).saturating_sub(1).min(11)];

    // Check if file is older than 6 months (approximately 180 days).
    const SIX_MONTHS_SECS: u64 = 180 * 24 * 60 * 60;
    let is_recent = epoch_secs > now_secs.saturating_sub(SIX_MONTHS_SECS)
        && epoch_secs <= now_secs.saturating_add(SIX_MONTHS_SECS);

    if is_recent {
        let hours = secs_of_day / 3600;
        let minutes = (secs_of_day / 60) % 60;
        let _ = bun_core::fmt::buf_print(
            &mut buf[..],
            format_args!("{} {:02} {:02}:{:02}", month_name, day, hours, minutes),
        );
    } else {
        // Show year for old files.
        let _ = bun_core::fmt::buf_print(
            &mut buf[..],
            format_args!("{} {:02}  {:4}", month_name, day, year),
        );
    }
    buf
}

/// Howard Hinnant's `civil_from_days` — converts days-since-1970-01-01 to a
/// proleptic-Gregorian (year, month[1..=12], day[1..=31]). Port of the calendar
/// arithmetic Zig gets from `std.time.epoch`.
fn civil_from_days(z: i64) -> (i32, u8, u8) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = (z - era * 146_097) as u32; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u8; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u8; // [1, 12]
    ((y + (m <= 2) as i64) as i32, m, d)
}

impl bun_event_loop::Taskable for ShellLsTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellLsTask;
}

impl crate::shell::interpreter::ShellTaskCtx for ShellLsTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        Self::run_from_thread_pool(this)
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        Self::run_from_main_thread(this, interp)
    }
}

/// Spec: ls.zig `Opts`. Only the fields the current port actually consults
/// are kept; the rest are recognised by `parse_flag` but not stored.
#[derive(Clone, Copy, Default)]
pub struct Opts {
    /// `-a`, `--all` — do not ignore entries starting with `.`
    pub show_all: bool,
    /// `-A`, `--almost-all` — like `-a` but skip `.` and `..`
    pub show_almost_all: bool,
    /// `-d`, `--directory` — list directories themselves, not their contents
    pub list_directories: bool,
    /// `-l` — use a long listing format
    pub long_listing: bool,
    /// `-R`, `--recursive` — list subdirectories recursively
    pub recursive: bool,
    /// `-r`, `--reverse` — reverse order while sorting
    pub reverse_order: bool,
    /// `-1` — list one file per line
    pub one_file_per_line: bool,
}

// ported from: src/shell/builtin/ls.zig
