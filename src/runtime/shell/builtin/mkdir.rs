use core::ffi::CStr;

use crate::node::fs::{MkdirCtx, NodeFS, args as fs_args};
use crate::node::types::PathLike;
use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{
    EventLoopHandle, FlagParser, Interpreter, NodeId, OutputSrc, OutputTask, OutputTaskVTable,
    ParseFlagResult, ShellTask, parse_flags, unsupported_flag,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Mkdir {
    pub opts: Opts,
    pub state: State,
}

#[derive(Default)]
pub enum State {
    #[default]
    Idle,
    Exec(Exec),
    WaitingWriteErr,
    Done,
}

pub struct Exec {
    pub started: bool,
    pub tasks_count: usize,
    pub tasks_done: usize,
    pub output_waiting: u16,
    pub output_done: u16,
    /// Index into `Builtin::args` where filepath args start (replaces Zig's
    /// borrowed `args: []const [*:0]const u8` slice — storing the index keeps
    /// the lifetime tied to the Cmd's argv without a self-reference).
    pub args_start: usize,
    pub err: Option<bun_sys::Error>,
    /// FIFO of in-flight OutputTask pointers awaiting an IOWriter chunk
    /// completion. Stopgap until `WriterTag` can carry the `*mut OutputTask`
    /// directly (IOWriter.rs is out of scope here): `write_err`/`write_out`
    /// push, `on_io_writer_chunk` pops and forwards to
    /// `OutputTask::on_io_writer_chunk` so the box is reclaimed and the
    /// writeErr→writeOut→onDone state machine runs (spec mkdir.zig:134/150).
    pub output_queue: std::collections::VecDeque<*mut OutputTask<Mkdir>>,
}

impl Mkdir {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let (args_start, mut opts) = {
            let mut opts = Opts::default();
            let args = Builtin::of(interp, cmd).args_slice();
            match parse_flags(&mut opts, args) {
                Ok(Some(rest)) => {
                    let start = args.len() - rest.len();
                    (start, opts)
                }
                Ok(None) => {
                    return Self::fail_usage(interp, cmd);
                }
                Err(e) => {
                    return Builtin::fail_parse(interp, cmd, Kind::Mkdir, e, || {
                        Self::state_mut(interp, cmd).state = State::WaitingWriteErr
                    });
                }
            }
        };
        // Hand the parsed opts back into state.
        core::mem::swap(&mut Self::state_mut(interp, cmd).opts, &mut opts);

        Self::state_mut(interp, cmd).state = State::Exec(Exec {
            started: false,
            tasks_count: 0,
            tasks_done: 0,
            output_waiting: 0,
            output_done: 0,
            args_start,
            err: None,
            output_queue: std::collections::VecDeque::new(),
        });
        Self::next(interp, cmd)
    }

    fn fail_usage(interp: &Interpreter, cmd: NodeId) -> Yield {
        Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
        Builtin::write_failing_error(interp, cmd, Kind::Mkdir.usage_string(), 1)
    }

    pub fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        // PORT NOTE: reshaped for borrowck — read scalars, drop the borrow,
        // then act.
        loop {
            let action = match &mut Self::state_mut(interp, cmd).state {
                State::Idle => panic!("Invalid state"),
                State::Exec(exec) => {
                    if exec.started {
                        if exec.tasks_done >= exec.tasks_count
                            && exec.output_done >= exec.output_waiting
                        {
                            let exit_code: ExitCode = if exec.err.is_some() { 1 } else { 0 };
                            exec.err = None;
                            NextAction::Done(exit_code)
                        } else {
                            return Yield::suspended();
                        }
                    } else {
                        exec.started = true;
                        NextAction::Schedule(exec.args_start)
                    }
                }
                State::WaitingWriteErr => return Yield::failed(),
                State::Done => return Builtin::done(interp, cmd, 0),
            };
            match action {
                NextAction::Done(code) => {
                    Self::state_mut(interp, cmd).state = State::Done;
                    return Builtin::done(interp, cmd, code);
                }
                NextAction::Schedule(args_start) => {
                    let argc = Builtin::of(interp, cmd).args_slice().len();
                    let task_count = argc - args_start;
                    if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                        exec.tasks_count = task_count;
                    }
                    let opts = Self::state_mut(interp, cmd).opts;
                    let cwd = Builtin::shell(interp, cmd).cwd().to_vec();
                    let evtloop = Builtin::event_loop(interp, cmd);
                    let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
                    for i in args_start..argc {
                        let path = Builtin::of(interp, cmd).arg_bytes(i).to_vec();
                        let task = ShellMkdirTask::create(
                            cmd,
                            opts,
                            path,
                            cwd.clone(),
                            evtloop,
                            interp_ptr,
                        );
                        // SAFETY: freshly heap-allocated.
                        unsafe { ShellTask::schedule(task) };
                    }
                    return Yield::suspended();
                }
            }
        }
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        written: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        let pending = match &mut Self::state_mut(interp, cmd).state {
            State::WaitingWriteErr => return Builtin::done(interp, cmd, 1),
            State::Exec(exec) => exec.output_queue.pop_front(),
            State::Idle | State::Done => panic!("Invalid state"),
        };
        if let Some(task) = pending {
            // SAFETY: `task` was heap-allocated in `OutputTask::new` and
            // pushed by `write_err`/`write_out`; not yet freed.
            return unsafe { OutputTask::<Mkdir>::on_io_writer_chunk(task, interp, written, e) };
        }
        Self::next(interp, cmd)
    }

    /// Spec: mkdir.zig `onShellMkdirTaskDone`.
    pub fn on_shell_mkdir_task_done(interp: &Interpreter, cmd: NodeId, task: *mut ShellMkdirTask) {
        // SAFETY: task was heap-allocated in create(); reclaim ownership.
        let mut task = unsafe { bun_core::heap::take(task) };
        let output = core::mem::take(&mut task.created_directories);
        let err = task.err.take();
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.tasks_done += 1;
        }

        let output_task = OutputTask::<Mkdir>::new(cmd, OutputSrc::Arrlist(output));
        let errstr: Option<Vec<u8>> = err.map(|e| {
            let s = Builtin::task_error_to_string(interp, cmd, Kind::Mkdir, &e).to_vec();
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.err = Some(e);
            }
            s
        });
        OutputTask::<Mkdir>::start(output_task, interp, errstr.as_deref()).run(interp);
    }
}

enum NextAction {
    Done(ExitCode),
    Schedule(usize),
}

pub type ShellMkdirOutputTask = OutputTask<Mkdir>;

impl OutputTaskVTable for Mkdir {
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
            // TODO(b2-blocked): IOWriter ChildPtr for OutputTask — needs a
            // dedicated WriterTag once OutputTask is dispatchable. Until then
            // stash `child` on `output_queue` so `on_io_writer_chunk` can
            // route the completion back to the OutputTask state machine and
            // reclaim the box (spec mkdir.zig:134 enqueues with childptr).
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
            // See write_err — stash `child` so the chunk callback routes to
            // OutputTask::on_io_writer_chunk (spec mkdir.zig:150).
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

/// Spec: mkdir.zig `ShellMkdirTask`. Runs `mkdir`/`mkdir -p` on a worker
/// thread, then bounces back to the main thread.
pub struct ShellMkdirTask {
    /// Owning Cmd node (the mkdir builtin's id).
    pub cmd: NodeId,
    pub opts: Opts,
    /// Owned copy of the target path (Zig borrowed from argv; we own to avoid
    /// threading a lifetime through the WorkPool).
    pub filepath: Vec<u8>,
    pub cwd_path: Vec<u8>,
    pub created_directories: Vec<u8>,
    pub err: Option<bun_sys::Error>,
    pub task: ShellTask,
}

impl ShellMkdirTask {
    pub fn create(
        cmd: NodeId,
        opts: Opts,
        filepath: Vec<u8>,
        cwd_path: Vec<u8>,
        evtloop: EventLoopHandle,
        interp: *mut Interpreter,
    ) -> *mut ShellMkdirTask {
        let mut task = Box::new(ShellMkdirTask {
            cmd,
            opts,
            filepath,
            cwd_path,
            created_directories: Vec::new(),
            err: None,
            task: ShellTask::new(evtloop),
        });
        task.task.interp = interp;
        bun_core::heap::into_raw(task)
    }

    /// Spec: mkdir.zig `runFromThreadPool`.
    pub fn run_from_thread_pool(this: &mut ShellMkdirTask) {
        use bun_paths::{Platform, platform, resolve_path};
        // We have to give an absolute path to our mkdir implementation for it
        // to work with cwd.
        let filepath: &bun_core::ZStr = if Platform::AUTO.is_absolute(&this.filepath) {
            // Owned `Vec<u8>`; ensure NUL-terminated.
            if this.filepath.last() != Some(&0) {
                this.filepath.push(0);
            }
            bun_core::ZStr::from_buf(&this.filepath, this.filepath.len() - 1)
        } else {
            resolve_path::join_z::<platform::Auto>(&[&this.cwd_path, &this.filepath])
        };

        let mut node_fs = NodeFS::default();
        let args = fs_args::Mkdir {
            path: PathLike::String(bun_core::PathString::init(filepath.as_bytes())),
            recursive: this.opts.parents,
            mode: fs_args::Mkdir::DEFAULT_MODE,
            always_return_none: true,
        };

        if this.opts.parents {
            let vtable = MkdirVerboseVTable {
                inner: &raw mut this.created_directories,
                active: this.opts.verbose,
            };
            if let Err(e) = node_fs.mkdir_recursive_impl(&args, vtable) {
                this.err = Some(e.with_path(filepath.as_bytes()));
                core::hint::black_box(&node_fs);
            }
        } else {
            match node_fs.mkdir_non_recursive(&args) {
                Ok(_) => {
                    if this.opts.verbose {
                        this.created_directories
                            .extend_from_slice(filepath.as_bytes());
                        this.created_directories.push(b'\n');
                    }
                }
                Err(e) => {
                    this.err = Some(e.with_path(filepath.as_bytes()));
                    core::hint::black_box(&node_fs);
                }
            }
        }
        // Bounce-back to the main thread is posted by `shell_task_trampoline`
        // via `ShellTask::on_finish::<Self>` (handles both JS and mini event
        // loops).
    }

    pub fn run_from_main_thread(this: *mut ShellMkdirTask, interp: &Interpreter) {
        // SAFETY: `this` is a live heap-allocated task.
        let cmd = unsafe { (*this).cmd };
        Mkdir::on_shell_mkdir_task_done(interp, cmd, this);
    }
}

impl bun_event_loop::Taskable for ShellMkdirTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellMkdirTask;
}

/// Spec: mkdir.zig `MkdirVerboseVTable` — collects each created directory into
/// `created_directories` (newline-separated) when `-v` is set. Passed by value
/// to `NodeFS::mkdir_recursive_impl`; `on_create_dir` writes through the raw
/// back-ref because the trait method takes `&self` (Zig: `*@This()`).
struct MkdirVerboseVTable {
    inner: *mut Vec<u8>,
    active: bool,
}

impl MkdirCtx for MkdirVerboseVTable {
    fn on_create_dir(&self, dirpath: &bun_paths::OSPathSliceZ) {
        if !self.active {
            return;
        }
        // SAFETY: `inner` points at `ShellMkdirTask::created_directories`; the
        // worker thread is the sole accessor for the duration of
        // `run_from_thread_pool`, and `mkdir_recursive_impl` does not alias it.
        let out = unsafe { &mut *self.inner };
        #[cfg(windows)]
        {
            let mut buf = bun_paths::PathBuffer::uninit();
            let str = bun_paths::strings::from_wpath(buf.as_mut(), dirpath.as_slice());
            out.extend_from_slice(str.as_bytes());
            out.push(b'\n');
        }
        #[cfg(not(windows))]
        {
            out.extend_from_slice(dirpath.as_bytes());
            out.push(b'\n');
        }
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellMkdirTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        Self::run_from_thread_pool(this)
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        Self::run_from_main_thread(this, interp)
    }
}

#[derive(Default, Clone, Copy)]
pub struct Opts {
    /// `-m`, `--mode` — set file mode (as in chmod), not a=rwx - umask
    pub mode: Option<u32>,
    /// `-p`, `--parents` — no error if existing, make parent directories as
    /// needed, with their file modes unaffected by any -m option.
    pub parents: bool,
    /// `-v`, `--verbose` — print a message for each created directory
    pub verbose: bool,
}

impl FlagParser for Opts {
    fn parse_long(&mut self, flag: &[u8]) -> Option<ParseFlagResult> {
        if flag == b"--mode" {
            return Some(ParseFlagResult::Unsupported(unsupported_flag(b"--mode")));
        }
        if flag == b"--parents" {
            self.parents = true;
            return Some(ParseFlagResult::ContinueParsing);
        }
        // Note: Zig has the same `--vebose` typo (mkdir.zig:497).
        if flag == b"--vebose" {
            self.verbose = true;
            return Some(ParseFlagResult::ContinueParsing);
        }
        None
    }

    fn parse_short(&mut self, ch: u8, smallflags: &[u8], i: usize) -> Option<ParseFlagResult> {
        match ch {
            b'm' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-m "))),
            b'p' => {
                self.parents = true;
                None
            }
            b'v' => {
                self.verbose = true;
                None
            }
            _ => Some(ParseFlagResult::IllegalOption(
                &raw const smallflags[1 + i..],
            )),
        }
    }
}

// ported from: src/shell/builtin/mkdir.zig
