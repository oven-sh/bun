//! Port of src/shell/builtin/rm.zig

use core::ffi::{c_char, CStr};
use core::mem::offset_of;
use core::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

use bstr::BStr;

use bun_core::Output;
use bun_jsc as jsc;
use bun_jsc::{EventLoopHandle, EventLoopTask, SystemError};
use bun_paths::{self as resolve_path, PathBuffer, PathString};
use crate::shell::interpreter::{Builtin, BuiltinImpl, BuiltinKind, ShellSyscall};
use crate::shell::{ExitCode, Yield};
use bun_str::ZStr;
use bun_sys::{self as syscall, DirIterator, Fd};
use bun_threading::{Mutex, WorkPool, WorkPoolTask};

bun_output::declare_scope!(Rm, hidden);
bun_output::declare_scope!(AsyncRmTask, hidden);

macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(Rm, $($arg)*) };
}
macro_rules! debug {
    ($($arg:tt)*) => { bun_output::scoped_log!(AsyncRmTask, $($arg)*) };
}

// ──────────────────────────────────────────────────────────────────────────
// Rm
// ──────────────────────────────────────────────────────────────────────────

pub struct Rm {
    pub opts: Opts,
    pub state: State,
}

impl Default for Rm {
    fn default() -> Self {
        Self { opts: Opts::default(), state: State::Idle }
    }
}

pub enum State {
    Idle,
    ParseOpts(ParseOptsState),
    Exec(ExecState),
    Done { exit_code: ExitCode },
    WaitingWriteErr,
    Err(ExitCode),
}

pub struct ParseOptsState {
    // TODO(port): lifetime — borrowed from Builtin.argsSlice() (argv outlives Rm)
    pub args_slice: &'static [*const c_char],
    pub idx: u32,
    pub state: ParseOptsSubState,
}

pub enum ParseOptsSubState {
    Normal,
    WaitWriteErr,
}

pub struct ExecState {
    // task: RmTask,
    // TODO(port): lifetime — borrowed from Builtin.argsSlice()
    pub filepath_args: &'static [*const c_char],
    pub total_tasks: usize,
    pub err: Option<syscall::Error>,
    pub lock: Mutex,
    pub error_signal: AtomicBool,
    pub output_done: AtomicUsize,
    pub output_count: AtomicUsize,
    pub state: ExecSubState,
}

pub enum ExecSubState {
    Idle,
    Waiting { tasks_done: usize },
}

impl ExecSubState {
    pub fn tasks_done(&self) -> usize {
        match self {
            ExecSubState::Idle => 0,
            ExecSubState::Waiting { tasks_done } => *tasks_done,
        }
    }
}

#[derive(Clone, Copy)]
pub enum OutputCounter {
    OutputDone,
    OutputCount,
}

impl ExecState {
    fn counter(&self, which: OutputCounter) -> &AtomicUsize {
        match which {
            OutputCounter::OutputDone => &self.output_done,
            OutputCounter::OutputCount => &self.output_count,
        }
    }

    fn increment_output_count(&self, which: OutputCounter) {
        let atomicvar = self.counter(which);
        let result = atomicvar.fetch_add(1, Ordering::SeqCst);
        log!(
            "[rm] {}: {} + 1",
            match which {
                OutputCounter::OutputDone => "output_done",
                OutputCounter::OutputCount => "output_count",
            },
            result
        );
    }

    fn get_output_count(&self, which: OutputCounter) -> usize {
        self.counter(which).load(Ordering::SeqCst)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Opts
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Opts {
    /// `--no-preserve-root` / `--preserve-root`
    ///
    /// If set to false, then allow the recursive removal of the root directory.
    /// Safety feature to prevent accidental deletion of the root directory.
    pub preserve_root: bool,

    /// `-f`, `--force`
    ///
    /// Ignore nonexistent files and arguments, never prompt.
    pub force: bool,

    /// Configures how the user should be prompted on removal of files.
    pub prompt_behaviour: PromptBehaviour,

    /// `-r`, `-R`, `--recursive`
    ///
    /// Remove directories and their contents recursively.
    pub recursive: bool,

    /// `-v`, `--verbose`
    ///
    /// Explain what is being done (prints which files/dirs are being deleted).
    pub verbose: bool,

    /// `-d`, `--dir`
    ///
    /// Remove empty directories. This option permits you to remove a directory
    /// without specifying `-r`/`-R`/`--recursive`, provided that the directory is
    /// empty.
    pub remove_empty_dirs: bool,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            preserve_root: true,
            force: false,
            prompt_behaviour: PromptBehaviour::Never,
            recursive: false,
            verbose: false,
            remove_empty_dirs: false,
        }
    }
}

#[derive(Clone)]
pub enum PromptBehaviour {
    /// `--interactive=never`
    ///
    /// Default
    Never,

    /// `-I`, `--interactive=once`
    ///
    /// Once before removing more than three files, or when removing recursively.
    Once { removed_count: u32 },

    /// `-i`, `--interactive=always`
    ///
    /// Prompt before every removal.
    Always,
}

// ──────────────────────────────────────────────────────────────────────────
// Rm impl
// ──────────────────────────────────────────────────────────────────────────

impl Rm {
    pub fn start(&mut self) -> Yield {
        self.next()
    }

    #[inline(never)]
    pub fn next(&mut self) -> Yield {
        while !matches!(self.state, State::Done { .. } | State::Err(_)) {
            match &mut self.state {
                State::WaitingWriteErr => return Yield::Suspended,
                State::Idle => {
                    self.state = State::ParseOpts(ParseOptsState {
                        args_slice: self.bltn().args_slice(),
                        idx: 0,
                        state: ParseOptsSubState::Normal,
                    });
                    continue;
                }
                State::ParseOpts(_) => {
                    // PORT NOTE: reshaped for borrowck — re-borrow parse_opts after self.bltn() calls
                    let parse_opts = match &mut self.state {
                        State::ParseOpts(p) => p,
                        _ => unreachable!(),
                    };
                    match parse_opts.state {
                        ParseOptsSubState::Normal => {
                            // This means there were no arguments or only
                            // flag arguments meaning no positionals, in
                            // either case we must print the usage error
                            // string
                            if parse_opts.idx as usize >= parse_opts.args_slice.len() {
                                let error_string = BuiltinKind::usage_string(BuiltinKind::Rm);
                                if let Some(safeguard) = self.bltn().stderr.needs_io() {
                                    if let State::ParseOpts(p) = &mut self.state {
                                        p.state = ParseOptsSubState::WaitWriteErr;
                                    }
                                    return self.bltn().stderr.enqueue(self, error_string, safeguard);
                                }

                                let _ = self.bltn().write_no_io(BuiltinKind::Stderr, error_string);

                                return self.bltn().done(1);
                            }

                            let idx = parse_opts.idx;

                            let arg_raw = parse_opts.args_slice[idx as usize];
                            // SAFETY: argv entries are valid NUL-terminated C strings for the lifetime of the builtin
                            let arg = unsafe { CStr::from_ptr(arg_raw) }.to_bytes();

                            match parse_flag(&mut self.opts, self.bltn(), arg) {
                                ParseFlagsResult::ContinueParsing => {
                                    if let State::ParseOpts(p) = &mut self.state {
                                        p.idx += 1;
                                    }
                                    continue;
                                }
                                ParseFlagsResult::Done => {
                                    if self.opts.recursive {
                                        self.opts.remove_empty_dirs = true;
                                    }

                                    if !matches!(self.opts.prompt_behaviour, PromptBehaviour::Never) {
                                        let buf: &[u8] = b"rm: \"-i\" is not supported yet";
                                        if let Some(safeguard) = self.bltn().stderr.needs_io() {
                                            if let State::ParseOpts(p) = &mut self.state {
                                                p.state = ParseOptsSubState::WaitWriteErr;
                                            }
                                            return self.bltn().stderr.enqueue(self, buf, safeguard);
                                        }

                                        let _ = self.bltn().write_no_io(BuiltinKind::Stderr, buf);
                                        return self.bltn().done(1);
                                    }

                                    let filepath_args_start = idx as usize;
                                    let filepath_args = {
                                        let p = match &self.state {
                                            State::ParseOpts(p) => p,
                                            _ => unreachable!(),
                                        };
                                        &p.args_slice[filepath_args_start..]
                                    };

                                    // Check that none of the paths will delete the root
                                    {
                                        let mut buf = PathBuffer::uninit();
                                        let cwd = match syscall::getcwd(&mut buf) {
                                            bun_sys::Result::Err(err) => {
                                                let errbuf = self.bltn().fmt_error_arena(
                                                    BuiltinKind::Rm,
                                                    format_args!(
                                                        "{}: {}",
                                                        "getcwd",
                                                        BStr::new(err.msg().unwrap_or(b"failed to get cwd"))
                                                    ),
                                                );
                                                return self.write_failing_error(errbuf, 1);
                                            }
                                            bun_sys::Result::Ok(cwd) => cwd,
                                        };

                                        for &filepath in filepath_args {
                                            // SAFETY: argv entries are valid NUL-terminated C strings
                                            let path = unsafe { CStr::from_ptr(filepath) }.to_bytes();
                                            let resolved_path = if resolve_path::Platform::Auto.is_absolute(path) {
                                                path
                                            } else {
                                                bun_paths::join(&[cwd, path], resolve_path::Style::Auto)
                                            };
                                            let is_root = 'brk: {
                                                let normalized = bun_paths::normalize_string(
                                                    resolved_path,
                                                    false,
                                                    resolve_path::Style::Auto,
                                                );
                                                let dirname =
                                                    resolve_path::dirname(normalized, resolve_path::Style::Auto);
                                                let is_root = dirname == b"";
                                                break 'brk is_root;
                                            };

                                            if is_root {
                                                if let Some(safeguard) = self.bltn().stderr.needs_io() {
                                                    if let State::ParseOpts(p) = &mut self.state {
                                                        p.state = ParseOptsSubState::WaitWriteErr;
                                                    }
                                                    return self.bltn().stderr.enqueue_fmt_bltn(
                                                        self,
                                                        BuiltinKind::Rm,
                                                        format_args!(
                                                            "\"{}\" may not be removed\n",
                                                            BStr::new(resolved_path)
                                                        ),
                                                        safeguard,
                                                    );
                                                }

                                                let error_string = self.bltn().fmt_error_arena(
                                                    BuiltinKind::Rm,
                                                    format_args!(
                                                        "\"{}\" may not be removed\n",
                                                        BStr::new(resolved_path)
                                                    ),
                                                );

                                                let _ = self
                                                    .bltn()
                                                    .write_no_io(BuiltinKind::Stderr, error_string);

                                                return self.bltn().done(1);
                                            }
                                        }
                                    }

                                    let total_tasks = filepath_args.len();
                                    self.state = State::Exec(ExecState {
                                        filepath_args,
                                        total_tasks,
                                        err: None,
                                        lock: Mutex::new(),
                                        error_signal: AtomicBool::new(false),
                                        output_done: AtomicUsize::new(0),
                                        output_count: AtomicUsize::new(0),
                                        state: ExecSubState::Idle,
                                    });
                                    // this.state.exec.task.schedule();
                                    // return .success;
                                    continue;
                                }
                                ParseFlagsResult::IllegalOption => {
                                    let error_string: &[u8] = b"rm: illegal option -- -\n";
                                    if let Some(safeguard) = self.bltn().stderr.needs_io() {
                                        if let State::ParseOpts(p) = &mut self.state {
                                            p.state = ParseOptsSubState::WaitWriteErr;
                                        }
                                        return self.bltn().stderr.enqueue(self, error_string, safeguard);
                                    }

                                    let _ = self.bltn().write_no_io(BuiltinKind::Stderr, error_string);

                                    return self.bltn().done(1);
                                }
                                ParseFlagsResult::IllegalOptionWithFlag => {
                                    let flag = arg;
                                    if let Some(safeguard) = self.bltn().stderr.needs_io() {
                                        if let State::ParseOpts(p) = &mut self.state {
                                            p.state = ParseOptsSubState::WaitWriteErr;
                                        }
                                        return self.bltn().stderr.enqueue_fmt_bltn(
                                            self,
                                            BuiltinKind::Rm,
                                            format_args!("illegal option -- {}\n", BStr::new(&flag[1..])),
                                            safeguard,
                                        );
                                    }
                                    let error_string = self.bltn().fmt_error_arena(
                                        BuiltinKind::Rm,
                                        format_args!("illegal option -- {}\n", BStr::new(&flag[1..])),
                                    );

                                    let _ = self.bltn().write_no_io(BuiltinKind::Stderr, error_string);

                                    return self.bltn().done(1);
                                }
                            }
                        }
                        ParseOptsSubState::WaitWriteErr => {
                            panic!("Invalid");
                            // // Errored
                            // if (parse_opts.state.wait_write_err.err) |e| {
                            //     this.state = .{ .err = e };
                            //     continue;
                            // }
                            //
                            // // Done writing
                            // if (this.state.parse_opts.state.wait_write_err.remain() == 0) {
                            //     this.state = .{ .done = .{ .exit_code = 0 } };
                            //     continue;
                            // }
                            //
                            // // yield execution to continue writing
                            // return .success;
                        }
                    }
                }
                State::Exec(_) => {
                    let cwd = self.bltn().parent_cmd().base.shell.cwd_fd;
                    // Schedule task
                    let exec = match &mut self.state {
                        State::Exec(e) => e,
                        _ => unreachable!(),
                    };
                    if matches!(exec.state, ExecSubState::Idle) {
                        exec.state = ExecSubState::Waiting { tasks_done: 0 };
                        for &root_raw in exec.filepath_args {
                            // SAFETY: argv entries are valid NUL-terminated C strings
                            let root = unsafe { CStr::from_ptr(root_raw) }.to_bytes();
                            let root_path_string = PathString::init(root);
                            let is_absolute = resolve_path::Platform::Auto.is_absolute(root);
                            let task = ShellRmTask::create(
                                root_path_string,
                                self,
                                cwd,
                                &exec.error_signal,
                                is_absolute,
                            );
                            // SAFETY: task is a freshly Box::into_raw'd pointer
                            unsafe { (*task).schedule() };
                            // task.
                        }
                    }

                    // do nothing
                    return Yield::Suspended;
                }
                State::Done { .. } | State::Err(_) => unreachable!(),
            }
        }

        match &self.state {
            State::Done { exit_code } => {
                let code = *exit_code;
                self.bltn().done(code)
            }
            State::Err(code) => {
                let code = *code;
                self.bltn().done(code)
            }
            _ => unreachable!(),
        }
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<SystemError>) -> Yield {
        log!("Rm(0x{:x}).onIOWriterChunk()", self as *mut _ as usize);
        // `defer if (e) |err| err.deref();` — SystemError::deref runs in Drop
        // TODO(port): confirm bun_jsc::SystemError has Drop that derefs
        if cfg!(debug_assertions) {
            debug_assert!(
                matches!(
                    &self.state,
                    State::ParseOpts(ParseOptsState { state: ParseOptsSubState::WaitWriteErr, .. })
                ) || matches!(
                    &self.state,
                    State::Exec(ex) if matches!(ex.state, ExecSubState::Waiting { .. })
                        && ex.output_count.load(Ordering::SeqCst) > 0
                ) || matches!(self.state, State::WaitingWriteErr)
            );
        }

        if let State::Exec(exec) = &self.state {
            if matches!(exec.state, ExecSubState::Waiting { .. }) {
                log!(
                    "Rm(0x{:x}) output done={} output count={}",
                    self as *const _ as usize,
                    exec.get_output_count(OutputCounter::OutputDone),
                    exec.get_output_count(OutputCounter::OutputCount)
                );
                exec.increment_output_count(OutputCounter::OutputDone);
                if exec.state.tasks_done() >= exec.total_tasks
                    && exec.get_output_count(OutputCounter::OutputDone)
                        >= exec.get_output_count(OutputCounter::OutputCount)
                {
                    let code: ExitCode = if exec.err.is_some() { 1 } else { 0 };
                    return self.bltn().done(code);
                }
                return Yield::Suspended;
            }
        }

        if let Some(err) = &e {
            let errno = err.get_errno();
            self.state = State::Err(errno as ExitCode);
            return self.bltn().done(errno);
        }

        self.bltn().done(1)
    }

    // Zig `deinit` was a no-op; Rm is embedded in Builtin.Impl so no Drop needed.
    // TODO(port): if Builtin framework expects an explicit deinit hook, wire it in Phase B.

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: Rm is always embedded as the `rm` field of Builtin.Impl, which is the
        // `impl` field of Builtin. Mirrors Zig @fieldParentPtr.
        unsafe {
            let impl_ptr = (self as *mut Rm as *mut u8)
                .sub(offset_of!(BuiltinImpl, rm))
                .cast::<BuiltinImpl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }

    pub fn on_shell_rm_task_done(&mut self, task: &mut ShellRmTask) {
        // In verbose mode the root DirTask may also be queued for writeVerbose; both callbacks
        // hold a pending count and the last one to run frees the ShellRmTask.
        let _guard = scopeguard::guard((), |_| task.decr_pending_and_maybe_deinit());
        // TODO(port): scopeguard captures &mut task while we also use it below — Phase B may
        // need to inline the decrement at each return point or use a raw ptr in the guard.
        let exec = match &mut self.state {
            State::Exec(e) => e,
            _ => unreachable!(),
        };
        let tasks_done = match &mut exec.state {
            ExecSubState::Idle => panic!("Invalid state"),
            ExecSubState::Waiting { tasks_done } => 'brk: {
                *tasks_done += 1;
                let amt = *tasks_done;
                if let Some(err) = task.err {
                    // Ownership of err.path stays with the task (freed in ShellRmTask.deinit);
                    // exec.err is only used as a did-anything-fail flag after this point, so
                    // drop the soon-to-be-dangling path slice from our copy.
                    exec.err = Some(err);
                    if let Some(e) = &mut exec.err {
                        e.path = b"";
                    }
                    let error_string = self.bltn().task_error_to_string(BuiltinKind::Rm, err);
                    if let Some(safeguard) = self.bltn().stderr.needs_io() {
                        log!(
                            "Rm(0x{:x}) task=0x{:x} ERROR={}",
                            self as *const _ as usize,
                            task as *const _ as usize,
                            BStr::new(error_string)
                        );
                        let exec = match &self.state {
                            State::Exec(e) => e,
                            _ => unreachable!(),
                        };
                        exec.increment_output_count(OutputCounter::OutputCount);
                        self.bltn().stderr.enqueue(self, error_string, safeguard).run();
                        return;
                    } else {
                        let _ = self.bltn().write_no_io(BuiltinKind::Stderr, error_string);
                    }
                }
                break 'brk amt;
            }
        };

        log!(
            "ShellRmTask(0x{:x}, task={})",
            task as *const _ as usize,
            task.root_path
        );
        // Wait until all tasks done and all output is written
        let exec = match &self.state {
            State::Exec(e) => e,
            _ => unreachable!(),
        };
        if tasks_done >= exec.total_tasks
            && exec.get_output_count(OutputCounter::OutputDone)
                >= exec.get_output_count(OutputCounter::OutputCount)
        {
            let exit_code: ExitCode = if exec.err.is_some() { 1 } else { 0 };
            self.state = State::Done { exit_code };
            self.next().run();
        }
    }

    fn write_verbose(&mut self, verbose: &mut DirTask) -> Yield {
        let tm = verbose.task_manager;
        let has_parent = verbose.parent_task.is_some();
        let _guard = scopeguard::guard((), move |_| {
            // SAFETY: tm is the owning ShellRmTask; alive until decr below releases it.
            if has_parent {
                // SAFETY: verbose is heap-allocated when parent_task.is_some(); deinit frees it.
                unsafe { DirTask::deinit(verbose) };
            }
            // Release the pending count taken in postRun(); the ShellRmTask is freed once every
            // queued writeVerbose and onShellRmTaskDone have run.
            unsafe { (*(tm as *mut ShellRmTask)).decr_pending_and_maybe_deinit() };
        });
        // TODO(port): guard captures `verbose` by &mut while body also uses it — see Phase B note.

        if let Some(safeguard) = self.bltn().stdout.needs_io() {
            let buf = verbose.take_deleted_entries();
            // `defer buf.deinit()` — Vec drops at end of scope
            return self.bltn().stdout.enqueue(self, buf.as_slice(), safeguard);
        }
        let _ = self
            .bltn()
            .write_no_io(BuiltinKind::Stdout, verbose.deleted_entries.as_slice());
        let exec = match &self.state {
            State::Exec(e) => e,
            _ => unreachable!(),
        };
        exec.increment_output_count(OutputCounter::OutputDone);
        if exec.state.tasks_done() >= exec.total_tasks
            && exec.get_output_count(OutputCounter::OutputDone)
                >= exec.get_output_count(OutputCounter::OutputCount)
        {
            let code: ExitCode = if exec.err.is_some() { 1 } else { 0 };
            return self.bltn().done(code);
        }
        Yield::Done
    }

    pub fn write_failing_error(&mut self, buf: &[u8], exit_code: ExitCode) -> Yield {
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            self.state = State::WaitingWriteErr;
            return self.bltn().stderr.enqueue(self, buf, safeguard);
        }

        let _ = self.bltn().write_no_io(BuiltinKind::Stderr, buf);

        self.bltn().done(exit_code)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// parseFlag
// ──────────────────────────────────────────────────────────────────────────

enum ParseFlagsResult {
    ContinueParsing,
    Done,
    IllegalOption,
    IllegalOptionWithFlag,
}

fn parse_flag(this: &mut Opts, _: &mut Builtin, flag: &[u8]) -> ParseFlagsResult {
    if flag.is_empty() {
        return ParseFlagsResult::Done;
    }
    if flag[0] != b'-' {
        return ParseFlagsResult::Done;
    }
    if flag.len() > 2 && flag[1] == b'-' {
        if flag == b"--preserve-root" {
            this.preserve_root = true;
            return ParseFlagsResult::ContinueParsing;
        } else if flag == b"--no-preserve-root" {
            this.preserve_root = false;
            return ParseFlagsResult::ContinueParsing;
        } else if flag == b"--recursive" {
            this.recursive = true;
            return ParseFlagsResult::ContinueParsing;
        } else if flag == b"--verbose" {
            this.verbose = true;
            return ParseFlagsResult::ContinueParsing;
        } else if flag == b"--dir" {
            this.remove_empty_dirs = true;
            return ParseFlagsResult::ContinueParsing;
        } else if flag == b"--interactive=never" {
            this.prompt_behaviour = PromptBehaviour::Never;
            return ParseFlagsResult::ContinueParsing;
        } else if flag == b"--interactive=once" {
            this.prompt_behaviour = PromptBehaviour::Once { removed_count: 0 };
            return ParseFlagsResult::ContinueParsing;
        } else if flag == b"--interactive=always" {
            this.prompt_behaviour = PromptBehaviour::Always;
            return ParseFlagsResult::ContinueParsing;
        }

        return ParseFlagsResult::IllegalOption;
    }

    let small_flags = &flag[1..];
    for &char in small_flags {
        match char {
            b'f' => {
                this.force = true;
                this.prompt_behaviour = PromptBehaviour::Never;
            }
            b'r' | b'R' => {
                this.recursive = true;
            }
            b'v' => {
                this.verbose = true;
            }
            b'd' => {
                this.remove_empty_dirs = true;
            }
            b'i' => {
                this.prompt_behaviour = PromptBehaviour::Once { removed_count: 0 };
            }
            b'I' => {
                this.prompt_behaviour = PromptBehaviour::Always;
            }
            _ => {
                return ParseFlagsResult::IllegalOptionWithFlag;
            }
        }
    }

    ParseFlagsResult::ContinueParsing
}

// ──────────────────────────────────────────────────────────────────────────
// ShellRmTask
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub type CwdPath = Box<[u8]>; // owned NUL-terminated path; TODO(port): use owned ZStr type
#[cfg(not(windows))]
pub type CwdPath = (); // Zig: u0

pub struct ShellRmTask<'a> {
    pub rm: *const Rm,
    pub opts: Opts,

    pub cwd: Fd,
    pub cwd_path: Option<CwdPath>,

    pub root_task: DirTask,
    pub root_path: PathString,
    pub root_is_absolute: bool,

    pub error_signal: &'a AtomicBool,
    pub err_mutex: Mutex,
    /// Main-thread callbacks that must complete before this task can be freed:
    /// always one for onShellRmTaskDone (via finishConcurrently), plus one per DirTask whose
    /// verbose output was queued. Decremented by decrPendingAndMaybeDeinit.
    pub pending_main_callbacks: AtomicU32,
    pub err: Option<syscall::Error>,

    pub event_loop: EventLoopHandle,
    pub concurrent_task: EventLoopTask,
    pub task: WorkPoolTask,
    pub join_style: JoinStyle,
}

/// On Windows we allow posix path separators
/// But this results in weird looking paths if we use our path.join function which uses the platform separator:
/// `foo/bar + baz -> foo/bar\baz`
///
/// So detect which path separator the user is using and prefer that.
/// If both are used, pick the first one.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum JoinStyle {
    Posix,
    Windows,
}

impl JoinStyle {
    pub fn from_path(p: PathString) -> JoinStyle {
        #[cfg(unix)]
        {
            let _ = p;
            return JoinStyle::Posix;
        }
        #[cfg(not(unix))]
        {
            let s = p.slice();
            let backslash = s.iter().position(|&b| b == b'\\').unwrap_or(usize::MAX);
            let forwardslash = s.iter().position(|&b| b == b'/').unwrap_or(usize::MAX);
            if forwardslash <= backslash {
                return JoinStyle::Posix;
            }
            JoinStyle::Windows
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DirTask
// ──────────────────────────────────────────────────────────────────────────

pub struct DirTask {
    pub task_manager: *const ShellRmTask<'static>,
    // TODO(port): task_manager lifetime — using 'static placeholder; Phase B should erase or use raw ptr consistently
    pub parent_task: Option<*const DirTask>,
    pub path: ZStr<'static>,
    // TODO(port): path ownership — root borrows from argv, children own (dupeZ'd, freed in deinit)
    pub is_absolute: bool,
    pub subtask_count: AtomicUsize,
    pub need_to_wait: AtomicBool,
    pub deleting_after_waiting_for_children: AtomicBool,
    pub kind_hint: EntryKindHint,
    pub task: WorkPoolTask,
    pub deleted_entries: Vec<u8>,
    pub concurrent_task: EventLoopTask,
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum EntryKindHint {
    Idk,
    Dir,
    File,
}

impl DirTask {
    pub fn take_deleted_entries(&mut self) -> Vec<u8> {
        debug!(
            "DirTask(0x{:x} path={}) takeDeletedEntries",
            self as *const _ as usize,
            BStr::new(self.path.as_bytes())
        );
        core::mem::take(&mut self.deleted_entries)
    }

    pub fn run_from_main_thread(&mut self) {
        debug!(
            "DirTask(0x{:x}, path={}) runFromMainThread",
            self as *const _ as usize,
            BStr::new(self.path.as_bytes())
        );
        // SAFETY: task_manager.rm is alive on the main thread (Rm owns the ShellRmTask lifetime).
        unsafe { (*((*self.task_manager).rm as *mut Rm)).write_verbose(self).run() };
    }

    pub fn run_from_main_thread_mini(&mut self, _: &mut ()) {
        self.run_from_main_thread();
    }

    pub fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: task is the .task field of a DirTask (intrusive); mirrors Zig @fieldParentPtr.
        let this: &mut DirTask = unsafe {
            &mut *(task as *mut u8).sub(offset_of!(DirTask, task)).cast::<DirTask>()
        };
        this.run_from_thread_pool_impl();
    }

    fn run_from_thread_pool_impl(&mut self) {
        let deleting_after = &self.deleting_after_waiting_for_children as *const AtomicBool;
        let self_ptr = self as *mut DirTask;
        let _guard = scopeguard::guard((), move |_| {
            // SAFETY: self_ptr is valid for the duration of this stack frame.
            if !unsafe { &*deleting_after }.load(Ordering::SeqCst) {
                unsafe { (*self_ptr).post_run() };
            }
        });

        // Root, get cwd path on windows
        #[cfg(windows)]
        {
            if self.parent_task.is_none() {
                let mut buf = PathBuffer::uninit();
                // SAFETY: task_manager is alive while any DirTask runs.
                let tm = unsafe { &mut *(self.task_manager as *mut ShellRmTask) };
                let cwd_path = match syscall::get_fd_path(tm.cwd, &mut buf) {
                    bun_sys::Result::Ok(p) => bun_str::ZStr::from_bytes(p),
                    bun_sys::Result::Err(err) => {
                        debug!(
                            "[runFromThreadPoolImpl:getcwd] DirTask({:x}) failed: {}: {}",
                            self as *const _ as usize,
                            <&'static str>::from(err.get_errno()),
                            BStr::new(err.path)
                        );
                        tm.err_mutex.lock();
                        let _unlock = scopeguard::guard((), |_| tm.err_mutex.unlock());
                        if tm.err.is_none() {
                            tm.err = Some(err);
                            tm.error_signal.store(true, Ordering::SeqCst);
                        }
                        return;
                    }
                };
                tm.cwd_path = Some(cwd_path);
                // TODO(port): cwd_path type mismatch (ZStr vs Box<[u8]>); reconcile in Phase B
            }
        }

        debug!("DirTask: {}", BStr::new(self.path.as_bytes()));
        self.is_absolute = resolve_path::Platform::Auto.is_absolute(self.path.as_bytes());
        // SAFETY: task_manager is alive while any DirTask runs.
        let tm = unsafe { &*(self.task_manager) };
        // TODO(port): aliasing — when self == &tm.root_task, &tm and &mut self overlap.
        // Phase B: consider Box<DirTask> for root_task or UnsafeCell.
        match tm.remove_entry(self, self.is_absolute) {
            bun_sys::Result::Err(err) => {
                debug!(
                    "[runFromThreadPoolImpl] DirTask({:x}) failed: {}: {}",
                    self as *const _ as usize,
                    <&'static str>::from(err.get_errno()),
                    BStr::new(err.path)
                );
                // SAFETY: task_manager is alive while any DirTask runs; exclusive access guarded by err_mutex below.
                let tm_mut = unsafe { &mut *(self.task_manager as *mut ShellRmTask) };
                tm_mut.err_mutex.lock();
                let _unlock = scopeguard::guard((), |_| tm_mut.err_mutex.unlock());
                if tm_mut.err.is_none() {
                    tm_mut.err = Some(err);
                    tm_mut.error_signal.store(true, Ordering::SeqCst);
                } else {
                    let mut err2 = err;
                    err2.deinit();
                }
            }
            bun_sys::Result::Ok(()) => {}
        }
    }

    fn handle_err(&mut self, err: syscall::Error) {
        debug!(
            "[handleErr] DirTask({:x}) failed: {}: {}",
            self as *const _ as usize,
            <&'static str>::from(err.get_errno()),
            BStr::new(err.path)
        );
        // SAFETY: task_manager is alive while any DirTask runs.
        let tm = unsafe { &mut *(self.task_manager as *mut ShellRmTask) };
        tm.err_mutex.lock();
        let _unlock = scopeguard::guard((), |_| tm.err_mutex.unlock());
        if tm.err.is_none() {
            tm.err = Some(err);
            tm.error_signal.store(true, Ordering::SeqCst);
        } else {
            tm.err.as_mut().unwrap().deinit();
        }
    }

    pub fn post_run(&mut self) {
        debug!(
            "DirTask(0x{:x}, path={}) postRun",
            self as *const _ as usize,
            BStr::new(self.path.as_bytes())
        );
        // // This is true if the directory has subdirectories
        // // that need to be deleted
        if self.need_to_wait.load(Ordering::SeqCst) {
            return;
        }

        // We have executed all the children of this task
        if self.subtask_count.fetch_sub(1, Ordering::SeqCst) == 1 {
            // SAFETY: task_manager is alive (pending_main_callbacks keeps it so).
            let tm = unsafe { &*(self.task_manager) };
            // If a verbose write will be queued, take a pending count on the ShellRmTask now —
            // before decrementing the parent (children) or calling finishConcurrently (root) —
            // so the main thread can't free it out from under writeVerbose.
            let will_queue_verbose = tm.opts.verbose && !self.deleted_entries.is_empty();
            if will_queue_verbose {
                let _ = tm.pending_main_callbacks.fetch_add(1, Ordering::SeqCst);
            }

            // If we have a parent and we are the last child, now we can delete the parent
            if let Some(parent) = self.parent_task {
                let self_ptr = self as *mut DirTask;
                let _guard = scopeguard::guard((), move |_| {
                    // SAFETY: self_ptr valid until deinit; queue_for_write may free it.
                    if will_queue_verbose {
                        unsafe { (*self_ptr).queue_for_write() };
                    } else {
                        unsafe { DirTask::deinit(&mut *self_ptr) };
                    }
                });
                // SAFETY: parent is alive (its subtask_count > 0 includes us).
                let parent = unsafe { &*(parent) };
                // It's possible that we queued this subdir task and it finished, while the parent
                // was still in the `removeEntryDir` function
                let tasks_left_before_decrement =
                    parent.subtask_count.fetch_sub(1, Ordering::SeqCst);
                let parent_still_in_remove_entry_dir =
                    !parent.need_to_wait.load(Ordering::Relaxed);
                if !parent_still_in_remove_entry_dir && tasks_left_before_decrement == 2 {
                    // SAFETY: parent is alive; needs &mut for delete_after_waiting_for_children.
                    unsafe {
                        (*(parent as *const DirTask as *mut DirTask)).delete_after_waiting_for_children()
                    };
                }
                return;
            }

            // Root task. After finishConcurrently() the task may be freed at any time unless
            // we hold a pending count, so don't touch `this`/task_manager afterwards unless
            // will_queue_verbose kept it alive.
            // SAFETY: tm is alive at this point.
            unsafe { (*(tm as *const ShellRmTask as *mut ShellRmTask)).finish_concurrently() };
            if will_queue_verbose {
                self.queue_for_write();
            }
        }

        // Otherwise need to wait
    }

    pub fn delete_after_waiting_for_children(&mut self) {
        debug!(
            "DirTask(0x{:x}, path={}) deleteAfterWaitingForChildren",
            self as *const _ as usize,
            BStr::new(self.path.as_bytes())
        );
        // `runFromMainThreadImpl` has a `defer this.postRun()` so need to set this to true to skip that
        self.deleting_after_waiting_for_children
            .store(true, Ordering::SeqCst);
        self.need_to_wait.store(false, Ordering::SeqCst);
        let mut do_post_run = true;
        let self_ptr = self as *mut DirTask;
        let _guard = scopeguard::guard((), |_| {
            if do_post_run {
                // SAFETY: self_ptr valid for this frame.
                unsafe { (*self_ptr).post_run() };
            }
        });
        // TODO(port): `do_post_run` is captured by-move into guard closure; need Cell<bool> or
        // restructure so the flag is read at guard-run time. Phase B fix.
        // SAFETY: task_manager is alive.
        let tm = unsafe { &*(self.task_manager) };
        if tm.error_signal.load(Ordering::SeqCst) {
            return;
        }

        match tm.remove_entry_dir_after_children(self) {
            bun_sys::Result::Err(e) => {
                debug!(
                    "[deleteAfterWaitingForChildren] DirTask({:x}) failed: {}: {}",
                    self as *const _ as usize,
                    <&'static str>::from(e.get_errno()),
                    BStr::new(e.path)
                );
                // SAFETY: task_manager is alive; mutation guarded by err_mutex.
                let tm_mut = unsafe { &mut *(self.task_manager as *mut ShellRmTask) };
                tm_mut.err_mutex.lock();
                let _unlock = scopeguard::guard((), |_| tm_mut.err_mutex.unlock());
                if tm_mut.err.is_none() {
                    tm_mut.err = Some(e);
                } else {
                    // bun.default_allocator.free(e.path) — path is owned in the error; drop it.
                    drop(e);
                    // TODO(port): syscall::Error.path ownership — confirm Drop frees it.
                }
            }
            bun_sys::Result::Ok(deleted) => {
                if !deleted {
                    do_post_run = false;
                }
            }
        }
    }

    pub fn queue_for_write(&mut self) {
        log!(
            "DirTask(0x{:x}, path={}) queueForWrite to_write={}",
            self as *const _ as usize,
            BStr::new(self.path.as_bytes()),
            self.deleted_entries.len()
        );
        if self.deleted_entries.is_empty() {
            if self.parent_task.is_some() {
                // SAFETY: self is heap-allocated when parent_task.is_some().
                unsafe { DirTask::deinit(self) };
            }
            return;
        }
        // SAFETY: task_manager is alive (pending_main_callbacks held).
        let tm = unsafe { &*(self.task_manager) };
        match &tm.event_loop {
            EventLoopHandle::Js(js) => {
                js.enqueue_task_concurrent(self.concurrent_task.js().from(self, jsc::TaskDeinit::Manual));
            }
            EventLoopHandle::Mini(mini) => {
                mini.enqueue_task_concurrent(self.concurrent_task.mini().from(self, "runFromMainThreadMini"));
            }
        }
        // PORT NOTE: Zig: this.concurrent_task.{js,mini}.from(this, ...) — uses DirTask's own
        // concurrent_task, not task_manager's. TODO(port): EventLoopTask API shape.
    }

    /// SAFETY: caller must not use `self` after this returns when `parent_task.is_some()`
    /// (frees the heap allocation).
    pub unsafe fn deinit(this: *mut DirTask) {
        // SAFETY: this is a valid pointer per caller contract.
        let this_ref = unsafe { &mut *this };
        drop(core::mem::take(&mut this_ref.deleted_entries));
        // The root's path string is from Rm's argv so don't deallocate it
        // And the root task is actually a field on the struct of the AsyncRmTask so don't deallocate it either
        if this_ref.parent_task.is_some() {
            // TODO(port): free this_ref.path — owned dupeZ'd buffer for non-root DirTasks.
            // bun.default_allocator.free(this.path);
            drop(unsafe { Box::from_raw(this) });
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ShellRmTask impl
// ──────────────────────────────────────────────────────────────────────────

impl<'a> ShellRmTask<'a> {
    pub fn create(
        root_path: PathString,
        rm: *mut Rm,
        cwd: Fd,
        error_signal: &'a AtomicBool,
        is_absolute: bool,
    ) -> *mut ShellRmTask<'a> {
        // SAFETY: rm is a valid &mut Rm at the call site.
        let rm_ref = unsafe { &mut *rm };
        let event_loop = rm_ref.bltn().event_loop();
        let task = Box::into_raw(Box::new(ShellRmTask {
            rm: rm as *const Rm,
            opts: rm_ref.opts.clone(),
            cwd,
            #[cfg(unix)]
            cwd_path: Some(()),
            #[cfg(windows)]
            cwd_path: None,
            root_path,
            root_task: DirTask {
                task_manager: core::ptr::null(), // patched below
                parent_task: None,
                path: root_path.slice_assume_z(),
                is_absolute: false,
                subtask_count: AtomicUsize::new(1),
                need_to_wait: AtomicBool::new(false),
                deleting_after_waiting_for_children: AtomicBool::new(false),
                kind_hint: EntryKindHint::Idk,
                task: WorkPoolTask { callback: DirTask::run_from_thread_pool },
                deleted_entries: Vec::new(),
                concurrent_task: EventLoopTask::from_event_loop(event_loop),
            },
            event_loop,
            concurrent_task: EventLoopTask::from_event_loop(event_loop),
            error_signal,
            err_mutex: Mutex::new(),
            pending_main_callbacks: AtomicU32::new(1),
            err: None,
            root_is_absolute: is_absolute,
            task: WorkPoolTask { callback: Self::work_pool_callback },
            join_style: JoinStyle::from_path(root_path),
        }));
        // SAFETY: task was just allocated; patch self-referential task_manager.
        unsafe {
            (*task).root_task.task_manager = task as *const ShellRmTask<'static>;
            // TODO(port): lifetime erasure for self-referential pointer.
        }
        task
    }

    pub fn schedule(&mut self) {
        WorkPool::schedule(&mut self.task);
    }

    pub fn enqueue(
        &self,
        parent_dir: &mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        kind_hint: EntryKindHint,
    ) {
        if self.error_signal.load(Ordering::SeqCst) {
            return;
        }
        let new_path = self.join(
            &[parent_dir.path.as_bytes(), path.as_bytes()],
            is_absolute,
        );
        self.enqueue_no_join(parent_dir, new_path, kind_hint);
    }

    /// Takes ownership of `path`; freed via the spawned DirTask's deinit (or here on early return).
    pub fn enqueue_no_join(
        &self,
        parent_task: &mut DirTask,
        path: ZStr<'static>,
        // TODO(port): path is an owned heap NUL-terminated buffer; ZStr<'static> is a stand-in.
        kind_hint: EntryKindHint,
    ) {
        debug!(
            "enqueue: {} {}",
            BStr::new(path.as_bytes()),
            <&'static str>::from(kind_hint)
        );

        if self.error_signal.load(Ordering::SeqCst) {
            // bun.default_allocator.free(path) — drop owned path
            // TODO(port): free path buffer
            return;
        }

        let subtask = Box::into_raw(Box::new(DirTask {
            task_manager: self as *const ShellRmTask as *const ShellRmTask<'static>,
            // TODO(port): lifetime erasure for back-pointer.
            path,
            parent_task: Some(parent_task as *const DirTask),
            is_absolute: false,
            subtask_count: AtomicUsize::new(1),
            need_to_wait: AtomicBool::new(false),
            deleting_after_waiting_for_children: AtomicBool::new(false),
            kind_hint,
            task: WorkPoolTask { callback: DirTask::run_from_thread_pool },
            deleted_entries: Vec::new(),
            concurrent_task: EventLoopTask::from_event_loop(self.event_loop),
        }));

        let count = parent_task.subtask_count.fetch_add(1, Ordering::Relaxed);
        if cfg!(debug_assertions) {
            debug_assert!(count > 0);
        }

        // SAFETY: subtask was just allocated.
        WorkPool::schedule(unsafe { &mut (*subtask).task });
    }

    pub fn getcwd(&self) -> Fd {
        self.cwd
    }

    pub fn verbose_deleted(&self, dir_task: &mut DirTask, path: &ZStr) -> bun_sys::Result<()> {
        debug!("deleted: {}", BStr::new(path.as_bytes()));
        if !self.opts.verbose {
            return bun_sys::Result::Ok(());
        }
        if dir_task.deleted_entries.is_empty() {
            debug!(
                "DirTask(0x{:x}, {}) Incrementing output count (deleted={})",
                dir_task as *const _ as usize,
                BStr::new(dir_task.path.as_bytes()),
                BStr::new(path.as_bytes())
            );
            // SAFETY: rm is alive on whatever thread runs this (Rm outlives ShellRmTask).
            // TODO(port): rm.state may not be State::Exec if racing — Zig assumes it is.
            unsafe {
                if let State::Exec(exec) = &(*self.rm).state {
                    exec.increment_output_count(OutputCounter::OutputCount);
                }
            }
        }
        dir_task.deleted_entries.extend_from_slice(path.as_bytes());
        dir_task.deleted_entries.push(b'\n');
        bun_sys::Result::Ok(())
    }

    pub fn finish_concurrently(&mut self) {
        debug!("finishConcurrently");
        match &self.event_loop {
            EventLoopHandle::Js(js) => {
                js.enqueue_task_concurrent(
                    self.concurrent_task.js().from(self, jsc::TaskDeinit::Manual),
                );
            }
            EventLoopHandle::Mini(mini) => {
                mini.enqueue_task_concurrent(
                    self.concurrent_task.mini().from(self, "runFromMainThreadMini"),
                );
            }
        }
        // TODO(port): EventLoopTask / EventLoopHandle API shape is guessed.
    }

    pub fn buf_join<'b>(
        &self,
        buf: &'b mut PathBuffer,
        parts: &[&[u8]],
        _: syscall::Tag,
    ) -> bun_sys::Result<&'b ZStr> {
        if self.join_style == JoinStyle::Posix {
            bun_sys::Result::Ok(resolve_path::join_z_buf(buf, parts, resolve_path::Style::Posix))
        } else {
            bun_sys::Result::Ok(resolve_path::join_z_buf(buf, parts, resolve_path::Style::Windows))
        }
    }

    pub fn remove_entry(&self, dir_task: &mut DirTask, is_absolute: bool) -> bun_sys::Result<()> {
        let mut remove_child_vtable = RemoveFileVTable {
            task: self,
            child_of_dir: false,
        };
        let mut buf = PathBuffer::uninit();
        match dir_task.kind_hint {
            EntryKindHint::Idk | EntryKindHint::File => {
                // PORT NOTE: reshaped for borrowck — capture path before passing &mut dir_task.
                let path = dir_task.path;
                self.remove_entry_file(dir_task, &path, is_absolute, &mut buf, &mut remove_child_vtable)
            }
            EntryKindHint::Dir => self.remove_entry_dir(dir_task, is_absolute, &mut buf),
        }
    }

    fn remove_entry_dir(
        &self,
        dir_task: &mut DirTask,
        is_absolute: bool,
        buf: &mut PathBuffer,
    ) -> bun_sys::Result<()> {
        let path = dir_task.path;
        let dirfd = self.cwd;
        debug!("removeEntryDir({})", BStr::new(path.as_bytes()));

        // If `-d` is specified without `-r` then we can just use `rmdirat`
        'out_to_iter: {
            if self.opts.remove_empty_dirs && !self.opts.recursive {
                let mut delete_state = RemoveFileParent {
                    task: self,
                    treat_as_dir: true,
                    allow_enqueue: false,
                    enqueued: false,
                };
                while delete_state.treat_as_dir {
                    match ShellSyscall::rmdirat(dirfd, &path) {
                        bun_sys::Result::Ok(()) => return bun_sys::Result::Ok(()),
                        bun_sys::Result::Err(e) => match e.get_errno() {
                            syscall::E::NOENT => {
                                if self.opts.force {
                                    return self.verbose_deleted(dir_task, &path);
                                }
                                return bun_sys::Result::Err(self.error_with_path(e, &path));
                            }
                            syscall::E::NOTDIR => {
                                delete_state.treat_as_dir = false;
                                let dt_path = dir_task.path;
                                if let Some(err) = self
                                    .remove_entry_file(dir_task, &dt_path, is_absolute, buf, &mut delete_state)
                                    .as_err()
                                {
                                    return bun_sys::Result::Err(err);
                                }
                                if !delete_state.treat_as_dir {
                                    return bun_sys::Result::Ok(());
                                }
                                if delete_state.treat_as_dir {
                                    break 'out_to_iter;
                                }
                            }
                            _ => return bun_sys::Result::Err(self.error_with_path(e, &path)),
                        },
                    }
                }
            }
        }

        if !self.opts.recursive {
            return bun_sys::Result::Err(
                syscall::Error::from_code(syscall::E::ISDIR, syscall::Tag::TODO)
                    .with_path(bun_str::ZStr::from_bytes(dir_task.path.as_bytes())),
            );
        }

        let flags = bun_sys::O::DIRECTORY | bun_sys::O::RDONLY;
        let fd = match ShellSyscall::openat(dirfd, &path, flags, 0) {
            bun_sys::Result::Ok(fd) => fd,
            bun_sys::Result::Err(e) => match e.get_errno() {
                syscall::E::NOENT => {
                    if self.opts.force {
                        return self.verbose_deleted(dir_task, &path);
                    }
                    return bun_sys::Result::Err(self.error_with_path(e, &path));
                }
                syscall::E::NOTDIR => {
                    let dt_path = dir_task.path;
                    return self.remove_entry_file(
                        dir_task,
                        &dt_path,
                        is_absolute,
                        buf,
                        &mut DummyRemoveFile,
                    );
                }
                _ => return bun_sys::Result::Err(self.error_with_path(e, &path)),
            },
        };

        let mut close_fd = true;
        let fd_for_guard = fd;
        let _close_guard = scopeguard::guard((), |_| {
            // On posix we can close the file descriptor whenever, but on Windows
            // we need to close it BEFORE we delete
            if close_fd {
                fd_for_guard.close();
            }
        });
        // TODO(port): `close_fd` captured by-move; needs Cell<bool> so mutations below are seen by guard.

        if self.error_signal.load(Ordering::SeqCst) {
            return bun_sys::Result::Ok(());
        }

        let mut iterator = DirIterator::iterate(fd, DirIterator::Encoding::U8);
        let mut entry = iterator.next();

        let mut remove_child_vtable = RemoveFileVTable {
            task: self,
            child_of_dir: true,
        };

        let mut i: usize = 0;
        loop {
            let current = match entry {
                bun_sys::Result::Err(err) => {
                    return bun_sys::Result::Err(self.error_with_path(err, &path));
                }
                bun_sys::Result::Ok(ent) => ent,
            };
            let Some(current) = current else { break };

            debug!(
                "dir({}) entry({}, {})",
                BStr::new(path.as_bytes()),
                BStr::new(current.name.slice()),
                <&'static str>::from(current.kind)
            );
            // TODO this seems bad maybe better to listen to kqueue/epoll event
            if fast_mod::<4>(i) == 0 && self.error_signal.load(Ordering::SeqCst) {
                return bun_sys::Result::Ok(());
            }

            let _i_guard = scopeguard::guard((), |_| {});
            // PORT NOTE: Zig `defer i += 1;` — moved to end of loop body below since no early
            // `continue` exists in this body.

            match current.kind {
                DirIterator::Kind::Directory => {
                    self.enqueue(dir_task, current.name.slice_assume_z(), is_absolute, EntryKindHint::Dir);
                }
                _ => {
                    let name = current.name.slice_assume_z();
                    let file_path = match self.buf_join(
                        buf,
                        &[path.as_bytes(), name.as_bytes()],
                        syscall::Tag::Unlink,
                    ) {
                        bun_sys::Result::Err(e) => return bun_sys::Result::Err(e),
                        bun_sys::Result::Ok(p) => p,
                    };

                    match self.remove_entry_file(
                        dir_task,
                        file_path,
                        is_absolute,
                        buf,
                        &mut remove_child_vtable,
                    ) {
                        bun_sys::Result::Err(e) => return bun_sys::Result::Err(e),
                        bun_sys::Result::Ok(()) => {}
                    }
                    // TODO(port): file_path borrows buf, then buf is passed &mut — aliasing.
                    // Zig had the same overlap (slice into buf + &buf). Phase B: copy file_path
                    // out or restructure.
                }
            }

            i += 1;
            entry = iterator.next();
        }

        // Need to wait for children to finish
        if dir_task.subtask_count.load(Ordering::SeqCst) > 1 {
            close_fd = true;
            dir_task.need_to_wait.store(true, Ordering::SeqCst);
            return bun_sys::Result::Ok(());
        }

        if self.error_signal.load(Ordering::SeqCst) {
            return bun_sys::Result::Ok(());
        }

        #[cfg(windows)]
        {
            close_fd = false;
            fd.close();
        }

        debug!("[removeEntryDir] remove after children {}", BStr::new(path.as_bytes()));
        match ShellSyscall::unlinkat_with_flags(self.getcwd(), &path, bun_sys::AT::REMOVEDIR) {
            bun_sys::Result::Ok(()) => {
                if let Some(e) = self.verbose_deleted(dir_task, &path).as_err() {
                    return bun_sys::Result::Err(e);
                }
                bun_sys::Result::Ok(())
            }
            bun_sys::Result::Err(e) => match e.get_errno() {
                syscall::E::NOENT => {
                    if self.opts.force {
                        if let Some(e2) = self.verbose_deleted(dir_task, &path).as_err() {
                            return bun_sys::Result::Err(e2);
                        }
                        return bun_sys::Result::Ok(());
                    }

                    bun_sys::Result::Err(self.error_with_path(e, &path))
                }
                _ => bun_sys::Result::Err(e),
            },
        }
    }

    fn remove_entry_dir_after_children(&self, dir_task: &mut DirTask) -> bun_sys::Result<bool> {
        debug!("remove entry after children: {}", BStr::new(dir_task.path.as_bytes()));
        let dirfd = self.cwd;
        let mut state = RemoveFileParent {
            task: self,
            treat_as_dir: true,
            allow_enqueue: true,
            enqueued: false,
        };
        loop {
            if state.treat_as_dir {
                log!("rmdirat({}, {})", dirfd, BStr::new(dir_task.path.as_bytes()));
                match ShellSyscall::rmdirat(dirfd, &dir_task.path) {
                    bun_sys::Result::Ok(()) => {
                        let _ = self.verbose_deleted(dir_task, &dir_task.path);
                        return bun_sys::Result::Ok(true);
                    }
                    bun_sys::Result::Err(e) => match e.get_errno() {
                        syscall::E::NOENT => {
                            if self.opts.force {
                                let _ = self.verbose_deleted(dir_task, &dir_task.path);
                                return bun_sys::Result::Ok(true);
                            }
                            let path = dir_task.path;
                            return bun_sys::Result::Err(self.error_with_path(e, &path));
                        }
                        syscall::E::NOTDIR => {
                            state.treat_as_dir = false;
                            continue;
                        }
                        _ => {
                            let path = dir_task.path;
                            return bun_sys::Result::Err(self.error_with_path(e, &path));
                        }
                    },
                }
            } else {
                let mut buf = PathBuffer::uninit();
                let dt_path = dir_task.path;
                let dt_abs = dir_task.is_absolute;
                if let Some(e) = self
                    .remove_entry_file(dir_task, &dt_path, dt_abs, &mut buf, &mut state)
                    .as_err()
                {
                    return bun_sys::Result::Err(e);
                }
                if state.enqueued {
                    return bun_sys::Result::Ok(false);
                }
                if state.treat_as_dir {
                    continue;
                }
                return bun_sys::Result::Ok(true);
            }
        }
    }

    fn remove_entry_file<V: RemoveFileHandler>(
        &self,
        parent_dir_task: &mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut PathBuffer,
        vtable: &mut V,
    ) -> bun_sys::Result<()> {
        let dirfd = self.cwd;
        match ShellSyscall::unlinkat_with_flags(dirfd, path, 0) {
            bun_sys::Result::Ok(()) => self.verbose_deleted(parent_dir_task, path),
            bun_sys::Result::Err(e) => {
                debug!(
                    "unlinkatWithFlags({}) = {}",
                    BStr::new(path.as_bytes()),
                    <&'static str>::from(e.get_errno())
                );
                match e.get_errno() {
                    syscall::E::NOENT => {
                        if self.opts.force {
                            return self.verbose_deleted(parent_dir_task, path);
                        }
                        bun_sys::Result::Err(self.error_with_path(e, path))
                    }
                    syscall::E::ISDIR => {
                        vtable.on_is_dir(parent_dir_task, path, is_absolute, buf)
                    }
                    // This might happen if the file is actually a directory
                    syscall::E::PERM => {
                        // non-Linux POSIX systems and Windows return EPERM when trying to delete a directory, so
                        // we need to handle that case specifically and translate the error
                        #[cfg(any(
                            target_os = "macos",
                            target_os = "ios",
                            target_os = "freebsd",
                            target_os = "netbsd",
                            target_os = "dragonfly",
                            target_os = "openbsd",
                            target_os = "solaris",
                            target_os = "illumos",
                            target_os = "windows",
                        ))]
                        {
                            // If we are allowed to delete directories then we can call `unlink`.
                            // If `path` points to a directory, then it is deleted (if empty) or we handle it as a directory
                            // If it's actually a file, we get an error so we don't need to call `stat` to check that.
                            if self.opts.recursive || self.opts.remove_empty_dirs {
                                return match ShellSyscall::unlinkat_with_flags(
                                    self.getcwd(),
                                    path,
                                    bun_sys::AT::REMOVEDIR,
                                ) {
                                    // it was empty, we saved a syscall
                                    bun_sys::Result::Ok(()) => self.verbose_deleted(parent_dir_task, path),
                                    bun_sys::Result::Err(e2) => match e2.get_errno() {
                                        // not empty, process directory as we would normally
                                        syscall::E::NOTEMPTY => {
                                            // this.enqueueNoJoin(parent_dir_task, path, .dir);
                                            // return .success;
                                            vtable.on_dir_not_empty(parent_dir_task, path, is_absolute, buf)
                                        }
                                        // actually a file, the error is a permissions error
                                        syscall::E::NOTDIR => {
                                            bun_sys::Result::Err(self.error_with_path(e, path))
                                        }
                                        _ => bun_sys::Result::Err(self.error_with_path(e2, path)),
                                    },
                                };
                            }

                            // We don't know if it was an actual permissions error or it was a directory so we need to try to delete it as a directory
                            return vtable.on_is_dir(parent_dir_task, path, is_absolute, buf);
                        }
                        #[allow(unreachable_code)]
                        {
                            bun_sys::Result::Err(self.error_with_path(e, path))
                        }
                    }
                    _ => bun_sys::Result::Err(self.error_with_path(e, path)),
                }
            }
        }
    }

    fn error_with_path(&self, err: syscall::Error, path: &ZStr) -> syscall::Error {
        let _ = self;
        err.with_path(bun_str::ZStr::from_bytes(path.as_bytes()))
    }

    #[inline]
    fn join(&self, subdir_parts: &[&[u8]], is_absolute: bool) -> ZStr<'static> {
        let _ = self;
        if !is_absolute {
            // If relative paths enabled, stdlib join is preferred over
            // ResolvePath.joinBuf because it doesn't try to normalize the path
            // TODO(port): std.fs.path.joinZ equivalent — bun_paths::join_z_alloc or similar.
            return bun_paths::fs_path_join_z(subdir_parts);
        }

        let joined = bun_paths::join(subdir_parts, resolve_path::Style::Auto);
        bun_str::ZStr::from_bytes(joined)
        // TODO(port): owned ZStr return type — Zig returns heap-owned [:0]const u8.
    }

    pub fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task is the .task field of a ShellRmTask (intrusive); mirrors Zig @fieldParentPtr.
        let this: &mut ShellRmTask = unsafe {
            &mut *(task as *mut u8)
                .sub(offset_of!(ShellRmTask, task))
                .cast::<ShellRmTask>()
        };
        this.root_task.run_from_thread_pool_impl();
    }

    pub fn run_from_main_thread(&mut self) {
        // SAFETY: rm is alive on the main thread.
        unsafe { (*(self.rm as *mut Rm)).on_shell_rm_task_done(self) };
    }

    pub fn run_from_main_thread_mini(&mut self, _: &mut ()) {
        // SAFETY: rm is alive on the main thread.
        unsafe { (*(self.rm as *mut Rm)).on_shell_rm_task_done(self) };
    }

    pub fn decr_pending_and_maybe_deinit(&mut self) {
        if self.pending_main_callbacks.fetch_sub(1, Ordering::SeqCst) == 1 {
            // SAFETY: self was Box::into_raw'd in create(); this is the last reference.
            unsafe { Self::deinit(self) };
        }
    }

    /// SAFETY: `this` must have been allocated via `Box::into_raw` in `create()` and must not
    /// be used after this call.
    pub unsafe fn deinit(this: *mut ShellRmTask<'a>) {
        let this_ref = unsafe { &mut *this };
        #[cfg(windows)]
        {
            // cwd_path is Box<[u8]>; dropped automatically below.
            let _ = this_ref.cwd_path.take();
        }
        if let Some(e) = &mut this_ref.err {
            if !e.path.is_empty() {
                // TODO(port): free e.path — depends on syscall::Error.path ownership model.
            }
        }
        drop(core::mem::take(&mut this_ref.root_task.deleted_entries));
        drop(unsafe { Box::from_raw(this) });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RemoveFileHandler trait + impls
// ──────────────────────────────────────────────────────────────────────────

trait RemoveFileHandler {
    fn on_is_dir(
        &mut self,
        parent_dir_task: &mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut PathBuffer,
    ) -> bun_sys::Result<()>;

    fn on_dir_not_empty(
        &mut self,
        parent_dir_task: &mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut PathBuffer,
    ) -> bun_sys::Result<()>;
}

struct DummyRemoveFile;

impl RemoveFileHandler for DummyRemoveFile {
    fn on_is_dir(
        &mut self,
        _parent_dir_task: &mut DirTask,
        _path: &ZStr,
        _is_absolute: bool,
        _buf: &mut PathBuffer,
    ) -> bun_sys::Result<()> {
        bun_sys::Result::Ok(())
    }

    fn on_dir_not_empty(
        &mut self,
        _parent_dir_task: &mut DirTask,
        _path: &ZStr,
        _is_absolute: bool,
        _buf: &mut PathBuffer,
    ) -> bun_sys::Result<()> {
        bun_sys::Result::Ok(())
    }
}

struct RemoveFileVTable<'a> {
    task: &'a ShellRmTask<'a>,
    child_of_dir: bool,
}

impl<'a> RemoveFileHandler for RemoveFileVTable<'a> {
    fn on_is_dir(
        &mut self,
        parent_dir_task: &mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut PathBuffer,
    ) -> bun_sys::Result<()> {
        if self.child_of_dir {
            self.task
                .enqueue_no_join(parent_dir_task, bun_str::ZStr::from_bytes(path.as_bytes()), EntryKindHint::Dir);
            return bun_sys::Result::Ok(());
        }
        self.task.remove_entry_dir(parent_dir_task, is_absolute, buf)
    }

    fn on_dir_not_empty(
        &mut self,
        parent_dir_task: &mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut PathBuffer,
    ) -> bun_sys::Result<()> {
        if self.child_of_dir {
            self.task
                .enqueue_no_join(parent_dir_task, bun_str::ZStr::from_bytes(path.as_bytes()), EntryKindHint::Dir);
            return bun_sys::Result::Ok(());
        }
        self.task.remove_entry_dir(parent_dir_task, is_absolute, buf)
    }
}

struct RemoveFileParent<'a> {
    task: &'a ShellRmTask<'a>,
    treat_as_dir: bool,
    allow_enqueue: bool,
    enqueued: bool,
}

impl<'a> RemoveFileHandler for RemoveFileParent<'a> {
    fn on_is_dir(
        &mut self,
        _parent_dir_task: &mut DirTask,
        _path: &ZStr,
        _is_absolute: bool,
        _buf: &mut PathBuffer,
    ) -> bun_sys::Result<()> {
        self.treat_as_dir = true;
        bun_sys::Result::Ok(())
    }

    fn on_dir_not_empty(
        &mut self,
        parent_dir_task: &mut DirTask,
        path: &ZStr,
        _is_absolute: bool,
        _buf: &mut PathBuffer,
    ) -> bun_sys::Result<()> {
        self.treat_as_dir = true;
        if self.allow_enqueue {
            self.task
                .enqueue_no_join(parent_dir_task, bun_str::ZStr::from_bytes(path.as_bytes()), EntryKindHint::Dir);
            self.enqueued = true;
        }
        bun_sys::Result::Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

#[inline]
const fn fast_mod<const RHS: usize>(val: usize) -> usize {
    // Zig compile-time checks: int, unsigned, power-of-two. Rust: usize is unsigned int.
    const { assert!(RHS.is_power_of_two()) };
    val & (RHS - 1)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/rm.zig (1268 lines)
//   confidence: medium
//   todos:      26
//   notes:      Heavy intrusive/self-referential ptrs (root_task in ShellRmTask, task_manager backrefs); several scopeguard closures capture mutable state by-move (need Cell); owned-ZStr type for dupeZ'd paths; EventLoopTask/EventLoopHandle API shape guessed; aliasing between &ShellRmTask and &mut root_task flagged.
// ──────────────────────────────────────────────────────────────────────────
