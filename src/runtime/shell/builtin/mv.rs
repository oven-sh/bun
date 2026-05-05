use core::ffi::{c_char, c_void};
use core::sync::atomic::{AtomicBool, Ordering};

use bun_core::Output as bun_output;
use bun_jsc::{self as jsc, EventLoopHandle, EventLoopTask, SystemError};
use bun_paths::{self as resolve_path, PathBuffer, MAX_PATH_BYTES};
use crate::shell::{ExitCode, Yield};
use bun_str::ZStr;
use bun_sys::{self as syscall, Fd, Maybe};

use crate::interpreter::{self, Builtin, BuiltinKind, ShellSyscall, ShellTask};

// --
bun_output::declare_scope!(ShellCat, hidden);
// PORT NOTE: Zig used `.ShellCat` here (copy-paste from cat.zig); preserved verbatim.

pub struct Mv {
    pub opts: Opts,
    pub args: Args,
    pub state: State,
}

impl Default for Mv {
    fn default() -> Self {
        Self {
            opts: Opts::default(),
            args: Args::default(),
            state: State::Idle,
        }
    }
}

pub struct Args {
    // TODO(port): lifetime — borrowed from bltn().argsSlice() arena
    pub sources: &'static [*const c_char],
    // TODO(port): lifetime — borrowed from bltn().argsSlice() arena
    pub target: &'static ZStr,
    pub target_fd: Option<Fd>,
}

impl Default for Args {
    fn default() -> Self {
        Self {
            sources: &[],
            target: ZStr::EMPTY,
            target_fd: None,
        }
    }
}

pub enum State {
    Idle,
    CheckTarget(CheckTarget),
    Executing(Executing),
    Done,
    WaitingWriteErr { exit_code: ExitCode },
    Err,
}

pub struct CheckTarget {
    pub task: ShellMvCheckTargetTask,
    pub state: CheckTargetState,
}

pub enum CheckTargetState {
    Running,
    Done,
}

pub struct Executing {
    pub task_count: usize,
    pub tasks_done: usize,
    pub error_signal: AtomicBool,
    // PERF(port): was arena bulk-free (bltn().arena.allocator().alloc) — profile in Phase B
    pub tasks: Vec<ShellMvBatchedTask>,
    pub err: Option<syscall::Error>,
    pub err_path_owned: bool,
}

pub struct ShellMvCheckTargetTask {
    pub mv: *const Mv,

    pub cwd: Fd,
    // TODO(port): lifetime — borrows Mv.args.target
    pub target: &'static ZStr,
    pub result: Option<Maybe<Option<Fd>>>,

    pub task: ShellTask<Self>,
    // TODO(port): ShellTask(@This(), runFromThreadPool, runFromMainThread, debug) — Zig passes
    // fn pointers as comptime params; in Rust these become trait impls on ShellTask<Self>.
}

impl ShellMvCheckTargetTask {
    pub fn run_from_thread_pool(&mut self) {
        let fd = match ShellSyscall::openat(
            self.cwd,
            self.target,
            bun_sys::O::RDONLY | bun_sys::O::DIRECTORY,
            0,
        ) {
            Maybe::Err(e) => {
                match e.get_errno() {
                    syscall::E::NOTDIR => {
                        self.result = Some(Maybe::Result(None));
                    }
                    _ => {
                        self.result = Some(Maybe::Err(e));
                    }
                }
                return;
            }
            Maybe::Result(fd) => fd,
        };
        self.result = Some(Maybe::Result(Some(fd)));
    }

    pub fn run_from_main_thread(&mut self) {
        // SAFETY: mv backref is valid for the lifetime of this task (task is embedded in
        // Mv.state.check_target).
        unsafe { &mut *(self.mv as *mut Mv) }.check_target_task_done(self);
    }

    pub fn run_from_main_thread_mini(&mut self, _: *mut c_void) {
        self.run_from_main_thread();
    }
}

pub struct ShellMvBatchedTask {
    pub mv: *const Mv,
    // TODO(port): lifetime — borrows a subslice of Mv.args.sources
    pub sources: &'static [*const c_char],
    // TODO(port): lifetime — borrows Mv.args.target
    pub target: &'static ZStr,
    pub target_fd: Option<Fd>,
    pub cwd: Fd,
    pub error_signal: *const AtomicBool,

    pub err: Option<syscall::Error>,
    /// True iff err.unwrap().path was heap-allocated by this task (move_in_dir's dupeZ); false
    /// when it borrows self.target / argv or is empty.
    pub err_path_owned: bool,

    pub task: ShellTask<Self>,
    // TODO(port): ShellTask(@This(), runFromThreadPool, runFromMainThread, debug) — see above.
    pub event_loop: EventLoopHandle,
}

impl ShellMvBatchedTask {
    pub const BATCH_SIZE: usize = 5;

    pub fn run_from_thread_pool(&mut self) {
        // Moving multiple entries into a directory
        if self.sources.len() > 1 {
            return self.move_multiple_into_dir();
        }

        // SAFETY: sources[0] is a NUL-terminated argv string from the shell arena.
        let src = unsafe { ZStr::from_ptr(self.sources[0]) };
        // Moving entry into directory
        if let Some(fd) = self.target_fd {
            let _ = fd;

            let mut buf = PathBuffer::uninit();
            let _ = self.move_in_dir(src, &mut buf);
            return;
        }

        match syscall::renameat(self.cwd, src, self.cwd, self.target) {
            Maybe::Err(e) => {
                if e.get_errno() == syscall::E::NOTDIR {
                    self.err = Some(e.with_path(self.target.as_bytes()));
                } else {
                    self.err = Some(e);
                }
            }
            _ => {}
        }
    }

    pub fn move_in_dir(&mut self, src: &ZStr, buf: &mut PathBuffer) -> bool {
        let path_in_dir_ =
            bun_paths::normalize_buf(resolve_path::basename(src.as_bytes()), buf, bun_paths::Platform::Auto);
        if path_in_dir_.len() + 1 >= buf.len() {
            self.err = Some(syscall::Error::from_code(syscall::E::NAMETOOLONG, syscall::Tag::Rename));
            return false;
        }
        let len = path_in_dir_.len();
        buf[len] = 0;
        // SAFETY: buf[len] == 0 written above.
        let path_in_dir = unsafe { ZStr::from_raw(buf.as_ptr(), len) };

        match syscall::renameat(self.cwd, src, self.target_fd.unwrap(), path_in_dir) {
            Maybe::Err(e) => {
                let target_path = resolve_path::join_z(
                    &[self.target.as_bytes(), resolve_path::basename(src.as_bytes())],
                    bun_paths::Platform::Auto,
                );

                // TODO(port): in Zig, `allocator.dupeZ` heap-dups the join result and `err.withPath`
                // stores the borrowed pointer; ownership is tracked out-of-band via err_path_owned
                // so batched_move_task_done / Drop can free it. The owned ZStr below must NOT be a
                // temporary (with_path borrows from it) — Phase B should retype Syscall.Error.path
                // to carry ownership directly.
                let owned_path = ZStr::from_bytes(target_path.as_bytes());
                self.err = Some(e.with_path(owned_path.as_bytes()));
                self.err_path_owned = true;
                core::mem::forget(owned_path);
                return false;
            }
            _ => {}
        }

        true
    }

    fn move_multiple_into_dir(&mut self) {
        let mut buf = PathBuffer::uninit();
        // PORT NOTE: Zig created a FixedBufferAllocator over `buf` and called `.reset()` each
        // iteration, but never allocated from it — `move_in_dir` writes into `buf` directly via
        // normalize_buf. Dropped as dead code.

        for &src_raw in self.sources {
            // SAFETY: error_signal backref points into Mv.state.executing.error_signal which
            // outlives all tasks.
            if unsafe { &*self.error_signal }.load(Ordering::SeqCst) {
                return;
            }

            // SAFETY: src_raw is a NUL-terminated argv string from the shell arena.
            let src = unsafe { ZStr::from_ptr(src_raw) };
            if !self.move_in_dir(src, &mut buf) {
                return;
            }
        }
    }

    /// From the man pages of `mv`:
    /// ```txt
    /// As the rename(2) call does not work across file systems, mv uses cp(1) and rm(1) to accomplish the move.  The effect is equivalent to:
    ///     rm -f destination_path && \
    ///     cp -pRP source_file destination && \
    ///     rm -rf source_file
    /// ```
    #[allow(dead_code)]
    fn move_across_filesystems(&mut self, src: &ZStr, dest: &ZStr) {
        let _ = self;
        let _ = src;
        let _ = dest;

        // TODO
    }

    pub fn run_from_main_thread(&mut self) {
        // SAFETY: mv backref is valid for the lifetime of this task (tasks are owned by
        // Mv.state.executing).
        unsafe { &mut *(self.mv as *mut Mv) }.batched_move_task_done(self);
    }

    pub fn run_from_main_thread_mini(&mut self, _: *mut c_void) {
        self.run_from_main_thread();
    }
}

impl Mv {
    pub fn start(&mut self) -> Yield {
        self.next()
    }

    pub fn write_failing_error(&mut self, buf: &[u8], exit_code: ExitCode) -> Yield {
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            self.state = State::WaitingWriteErr { exit_code };
            return self.bltn().stderr.enqueue(self, buf, safeguard);
        }

        let _ = self.bltn().write_no_io(BuiltinKind::Stderr, buf);

        self.bltn().done(exit_code)
    }

    pub fn next(&mut self) -> Yield {
        while !(matches!(self.state, State::Done | State::Err)) {
            match &mut self.state {
                State::Idle => {
                    if let Err(e) = self.parse_opts() {
                        let buf = match e {
                            ParseError::IllegalOption(opt_str) => self
                                .bltn()
                                .fmt_error_arena(BuiltinKind::Mv, format_args!("illegal option -- {}\n", bstr::BStr::new(opt_str))),
                            ParseError::ShowUsage => BuiltinKind::Mv.usage_string(),
                        };

                        return self.write_failing_error(buf, 1);
                    }
                    self.state = State::CheckTarget(CheckTarget {
                        task: ShellMvCheckTargetTask {
                            mv: self,
                            cwd: self.bltn().parent_cmd().base.shell.cwd_fd,
                            target: self.args.target,
                            result: None,
                            task: ShellTask {
                                event_loop: self.bltn().parent_cmd().base.event_loop(),
                                concurrent_task: EventLoopTask::from_event_loop(
                                    self.bltn().parent_cmd().base.event_loop(),
                                ),
                                ..Default::default()
                            },
                        },
                        state: CheckTargetState::Running,
                    });
                    let State::CheckTarget(ct) = &mut self.state else { unreachable!() };
                    ct.task.task.schedule();
                    return Yield::Suspended;
                }
                State::CheckTarget(check_target) => {
                    if matches!(check_target.state, CheckTargetState::Running) {
                        return Yield::Suspended;
                    }

                    if cfg!(debug_assertions) {
                        debug_assert!(check_target.task.result.is_some());
                    }

                    let maybe_fd: Option<Fd> = match check_target.task.result.take().unwrap() {
                        Maybe::Err(e) => 'brk: {
                            match e.get_errno() {
                                syscall::E::NOENT => {
                                    // Means we are renaming entry, not moving to a directory
                                    if self.args.sources.len() == 1 {
                                        break 'brk None;
                                    }

                                    let buf = self.bltn().fmt_error_arena(
                                        BuiltinKind::Mv,
                                        format_args!(
                                            "{}: No such file or directory\n",
                                            bstr::BStr::new(self.args.target.as_bytes())
                                        ),
                                    );
                                    return self.write_failing_error(buf, 1);
                                }
                                _ => {
                                    let sys_err = e.to_shell_system_error();
                                    // PORT NOTE: `defer sys_err.deref()` — handled by Drop on SystemError.
                                    let buf = self.bltn().fmt_error_arena(
                                        BuiltinKind::Mv,
                                        format_args!(
                                            "{}: {}\n",
                                            bstr::BStr::new(sys_err.path.byte_slice()),
                                            bstr::BStr::new(sys_err.message.byte_slice())
                                        ),
                                    );
                                    drop(sys_err);
                                    return self.write_failing_error(buf, 1);
                                }
                            }
                        }
                        Maybe::Result(maybe_fd) => maybe_fd,
                    };

                    // Trying to move multiple files into a file
                    if maybe_fd.is_none() && self.args.sources.len() > 1 {
                        let buf = self.bltn().fmt_error_arena(
                            BuiltinKind::Mv,
                            format_args!("{} is not a directory\n", bstr::BStr::new(self.args.target.as_bytes())),
                        );
                        return self.write_failing_error(buf, 1);
                    }

                    let count_per_task = ShellMvBatchedTask::BATCH_SIZE;

                    let task_count: usize = {
                        let sources_len: f64 = self.args.sources.len() as f64;
                        let batch_size: f64 = count_per_task as f64;
                        (sources_len / batch_size).ceil() as usize
                    };

                    self.args.target_fd = maybe_fd;
                    let cwd_fd = self.bltn().parent_cmd().base.shell.cwd_fd;
                    // PERF(port): was arena bulk-free (bltn().arena.allocator().alloc) — profile in Phase B
                    let mut tasks: Vec<ShellMvBatchedTask> = Vec::with_capacity(task_count);
                    // Initialize tasks
                    {
                        let mut i: usize = 0;
                        while i < task_count {
                            let start_idx = i * count_per_task;
                            let end_idx = (start_idx + count_per_task).min(self.args.sources.len());
                            let sources = &self.args.sources[start_idx..end_idx];

                            tasks.push(ShellMvBatchedTask {
                                mv: self,
                                cwd: cwd_fd,
                                target: self.args.target,
                                target_fd: self.args.target_fd,
                                sources,
                                // We set this later
                                error_signal: core::ptr::null(),
                                err: None,
                                err_path_owned: false,
                                task: ShellTask {
                                    event_loop: self.bltn().parent_cmd().base.event_loop(),
                                    concurrent_task: EventLoopTask::from_event_loop(
                                        self.bltn().parent_cmd().base.event_loop(),
                                    ),
                                    ..Default::default()
                                },
                                event_loop: self.bltn().parent_cmd().base.event_loop(),
                            });
                            i += 1;
                        }
                    }

                    self.state = State::Executing(Executing {
                        task_count,
                        tasks_done: 0,
                        error_signal: AtomicBool::new(false),
                        tasks,
                        err: None,
                        err_path_owned: false,
                    });

                    let State::Executing(exec) = &mut self.state else { unreachable!() };
                    let error_signal: *const AtomicBool = &exec.error_signal;
                    for t in exec.tasks.iter_mut() {
                        t.error_signal = error_signal;
                        t.task.schedule();
                    }

                    return Yield::Suspended;
                }
                // Shouldn't happen
                State::Executing(_) => {}
                State::WaitingWriteErr { .. } => {
                    return Yield::Failed;
                }
                State::Done | State::Err => unreachable!(),
            }
        }

        match self.state {
            State::Done => self.bltn().done(0),
            _ => self.bltn().done(1),
        }
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<SystemError>) -> Yield {
        // PORT NOTE: `defer if (e) |err| err.deref();` — SystemError has Drop, so `e` is released
        // at scope exit automatically.
        match &self.state {
            State::WaitingWriteErr { exit_code } => {
                let exit_code = *exit_code;
                if e.is_some() {
                    self.state = State::Err;
                    return self.next();
                }
                self.bltn().done(exit_code)
            }
            _ => panic!("Invalid state"),
        }
    }

    pub fn check_target_task_done(&mut self, task: &mut ShellMvCheckTargetTask) {
        let _ = task;

        if cfg!(debug_assertions) {
            debug_assert!(matches!(self.state, State::CheckTarget(_)));
            let State::CheckTarget(ct) = &self.state else { unreachable!() };
            debug_assert!(ct.task.result.is_some());
        }

        let State::CheckTarget(ct) = &mut self.state else { unreachable!() };
        ct.state = CheckTargetState::Done;
        self.next().run();
    }

    pub fn batched_move_task_done(&mut self, task: &mut ShellMvBatchedTask) {
        if cfg!(debug_assertions) {
            debug_assert!(matches!(self.state, State::Executing(_)));
            let State::Executing(exec) = &self.state else { unreachable!() };
            debug_assert!(exec.tasks_done < exec.task_count);
        }

        let State::Executing(exec) = &mut self.state else { unreachable!() };

        if let Some(err) = &mut task.err {
            exec.error_signal.store(true, Ordering::SeqCst);
            if exec.err.is_none() {
                exec.err = Some(*err);
                exec.err_path_owned = task.err_path_owned;
            } else if task.err_path_owned {
                // TODO(port): manual free of err.path — in Zig this is a heap-dup'd [:0]u8.
                // In Rust, retype Syscall.Error.path ownership so Drop handles this.
                bun_alloc::free(err.path);
            }
        }

        exec.tasks_done += 1;
        if exec.tasks_done >= exec.task_count {
            if let Some(err) = exec.err {
                let e = err.to_shell_system_error();
                // PORT NOTE: `defer e.deref()` — handled by Drop on SystemError.
                let buf = self
                    .bltn()
                    .fmt_error_arena(BuiltinKind::Mv, format_args!("{}: {}\n", e.path, e.message));
                if exec.err_path_owned {
                    // TODO(port): manual free of err.path — see above.
                    bun_alloc::free(err.path);
                }
                exec.err = None;
                drop(e);
                let _ = self.write_failing_error(buf, err.errno);
                return;
            }
            self.state = State::Done;

            self.next().run();
        }
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self is the `mv` field of Builtin.Impl, which is the `impl_` field of Builtin.
        unsafe {
            let impl_ = (self as *mut Mv as *mut u8)
                .sub(core::mem::offset_of!(interpreter::BuiltinImpl, mv))
                .cast::<interpreter::BuiltinImpl>();
            &mut *(impl_ as *mut u8)
                .sub(core::mem::offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

impl Drop for Mv {
    fn drop(&mut self) {
        if let Some(fd) = self.args.target_fd {
            fd.to_optional().close();
        }
        if let State::Executing(exec) = &self.state {
            if let Some(err) = &exec.err {
                if exec.err_path_owned {
                    // TODO(port): manual free of err.path — see batched_move_task_done.
                    bun_alloc::free(err.path);
                }
            }
        }
    }
}

pub struct Opts {
    /// `-f`
    ///
    /// Do not prompt for confirmation before overwriting the destination path.  (The -f option overrides any previous -i or -n options.)
    pub force_overwrite: bool,
    /// `-h`
    ///
    /// If the target operand is a symbolic link to a directory, do not follow it.  This causes the mv utility to rename the file source to the destination path target rather than moving source into the
    /// directory referenced by target.
    pub no_dereference: bool,
    /// `-i`
    ///
    /// Cause mv to write a prompt to standard error before moving a file that would overwrite an existing file.  If the response from the standard input begins with the character 'y' or 'Y', the move is
    /// attempted.  (The -i option overrides any previous -f or -n options.)
    pub interactive_mode: bool,
    /// `-n`
    ///
    /// Do not overwrite an existing file.  (The -n option overrides any previous -f or -i options.)
    pub no_overwrite: bool,
    /// `-v`
    ///
    /// Cause mv to be verbose, showing files after they are moved.
    pub verbose_output: bool,
}

impl Opts {
    pub const fn new() -> Self {
        Self {
            // PORT NOTE: Zig default is `force_overwrite: bool = true`.
            force_overwrite: true,
            no_dereference: false,
            interactive_mode: false,
            no_overwrite: false,
            verbose_output: false,
        }
    }
}

impl Default for Opts {
    fn default() -> Self {
        Self::new()
    }
}

pub enum ParseError {
    // TODO(port): lifetime — borrows from argv flag slice
    IllegalOption(&'static [u8]),
    ShowUsage,
}

pub enum ParseFlagResult {
    ContinueParsing,
    Done,
    // TODO(port): lifetime — borrows literal "-"
    IllegalOption(&'static [u8]),
}

impl Mv {
    pub fn parse_opts(&mut self) -> Result<(), ParseError> {
        let filepath_args = match self.parse_flags() {
            Ok(args) => args,
            Err(e) => return Err(e),
        };

        if filepath_args.len() < 2 {
            return Err(ParseError::ShowUsage);
        }

        self.args.sources = &filepath_args[0..filepath_args.len() - 1];
        // SAFETY: argv entries are NUL-terminated C strings from the shell arena.
        self.args.target = unsafe { ZStr::from_ptr(filepath_args[filepath_args.len() - 1]) };

        Ok(())
    }

    pub fn parse_flags(&mut self) -> Result<&'static [*const c_char], ParseError> {
        let args = self.bltn().args_slice();
        let mut idx: usize = 0;
        if args.is_empty() {
            return Err(ParseError::ShowUsage);
        }

        while idx < args.len() {
            let flag = args[idx];
            // SAFETY: argv entries are NUL-terminated C strings.
            let flag_bytes = unsafe { core::ffi::CStr::from_ptr(flag) }.to_bytes();
            match self.parse_flag(flag_bytes) {
                ParseFlagResult::Done => {
                    let filepath_args = &args[idx..];
                    return Ok(filepath_args);
                }
                ParseFlagResult::ContinueParsing => {}
                ParseFlagResult::IllegalOption(opt_str) => {
                    return Err(ParseError::IllegalOption(opt_str));
                }
            }
            idx += 1;
        }

        Err(ParseError::ShowUsage)
    }

    pub fn parse_flag(&mut self, flag: &[u8]) -> ParseFlagResult {
        if flag.is_empty() {
            return ParseFlagResult::Done;
        }
        if flag[0] != b'-' {
            return ParseFlagResult::Done;
        }

        let small_flags = &flag[1..];
        for &char in small_flags {
            match char {
                b'f' => {
                    self.opts.force_overwrite = true;
                    self.opts.interactive_mode = false;
                    self.opts.no_overwrite = false;
                }
                b'h' => {
                    self.opts.no_dereference = true;
                }
                b'i' => {
                    self.opts.interactive_mode = true;
                    self.opts.force_overwrite = false;
                    self.opts.no_overwrite = false;
                }
                b'n' => {
                    self.opts.no_overwrite = true;
                    self.opts.force_overwrite = false;
                    self.opts.interactive_mode = false;
                }
                b'v' => {
                    self.opts.verbose_output = true;
                }
                _ => {
                    return ParseFlagResult::IllegalOption(b"-");
                }
            }
        }

        ParseFlagResult::ContinueParsing
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/mv.zig (526 lines)
//   confidence: medium
//   todos:      11
//   notes:      Self-referential state (error_signal backref into State::Executing) kept as raw ptrs per LIFETIMES.tsv; argv-borrowed slices use &'static placeholders pending arena lifetime threading; Syscall.Error.path ownership (err_path_owned flag) needs retyping so Drop handles the conditional free.
// ──────────────────────────────────────────────────────────────────────────
