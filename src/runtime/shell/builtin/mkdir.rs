use crate::node::fs::{MkdirCtx, NodeFS, args as fs_args};
use crate::node::types::PathLike;
use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{
    FlagParser, Interpreter, NodeId, OutputSrc, OutputTask, OutputTaskVTable, OutputWrite,
    ParseFlagResult, ShellTask, unsupported_flag,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Mkdir {
    pub(crate) opts: Opts,
    pub(crate) state: State,
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
    pub(crate) started: bool,
    pub(crate) tasks_count: usize,
    pub(crate) tasks_done: usize,
    pub(crate) output_waiting: u16,
    pub(crate) output_done: u16,
    /// Index into `Builtin::args` where filepath args start (storing the
    /// index keeps the lifetime tied to the Cmd's argv without a
    /// self-reference).
    pub(crate) args_start: usize,
    pub(crate) err: Option<bun_sys::Error>,
    /// FIFO of in-flight OutputTasks awaiting an IOWriter chunk completion
    /// (`WriterTag` cannot name an OutputTask): `write_err`/`write_out`
    /// push, `on_io_writer_chunk` pops and forwards to
    /// `OutputTask::on_io_writer_chunk` so the writeErr→writeOut→onDone
    /// state machine runs.
    pub(crate) output_queue: std::collections::VecDeque<Box<OutputTask<Mkdir>>>,
}

impl Mkdir {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let (args_start, mut opts) = {
            let mut opts = Opts::default();
            match Builtin::parse_flags(interp, cmd, &mut opts) {
                Ok(Some(start)) => (start, opts),
                Ok(None) => {
                    return Self::fail_usage(interp, cmd);
                }
                Err(e) => {
                    return Builtin::fail_parse(interp, cmd, Kind::Mkdir, &e, || {
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

    fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        // Read scalars, drop the borrow, then act.
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
                        NextAction::Suspend
                    }
                } else {
                    exec.started = true;
                    NextAction::Schedule(exec.args_start)
                }
            }
            State::WaitingWriteErr => NextAction::Failed,
            State::Done => NextAction::AlreadyDone,
        };
        match action {
            NextAction::Suspend => Yield::suspended(),
            NextAction::Failed => Yield::failed(),
            NextAction::AlreadyDone => Builtin::done(interp, cmd, 0),
            NextAction::Done(code) => {
                Self::state_mut(interp, cmd).state = State::Done;
                Builtin::done(interp, cmd, code)
            }
            NextAction::Schedule(args_start) => {
                let argc = Builtin::argc(interp, cmd);
                let task_count = argc - args_start;
                if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                    exec.tasks_count = task_count;
                }
                let opts = Self::state_mut(interp, cmd).opts;
                let cwd = Builtin::shell(interp, cmd).borrow().cwd().to_vec();
                for i in args_start..argc {
                    let path = Builtin::of(interp, cmd).arg_bytes(i).to_vec();
                    let task = ShellMkdirTask::create(cmd, opts, path, cwd.clone(), interp);
                    ShellTask::schedule(task);
                }
                Yield::suspended()
            }
        }
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        written: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        let pending = match &mut Self::state_mut(interp, cmd).state {
            State::WaitingWriteErr => Err(()),
            State::Exec(exec) => Ok(exec.output_queue.pop_front()),
            State::Idle | State::Done => panic!("Invalid state"),
        };
        let Ok(pending) = pending else {
            return Builtin::done(interp, cmd, 1);
        };
        if let Some(task) = pending {
            return OutputTask::<Mkdir>::on_io_writer_chunk(task, interp, written, e);
        }
        Self::next(interp, cmd)
    }

    /// The caller ([`ShellMkdirTask::run_from_main_thread`]) owns the heap
    /// allocation and drops it after this returns.
    fn on_shell_mkdir_task_done(interp: &Interpreter, cmd: NodeId, task: &mut ShellMkdirTask) {
        let output = core::mem::take(&mut task.created_directories);
        let err = task.err.take();
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.tasks_done += 1;
        }

        let output_task = OutputTask::<Mkdir>::new(cmd, OutputSrc::Arrlist(output));
        let errstr: Option<Vec<u8>> = err.map(|e| {
            let s = Builtin::task_error_to_string(Kind::Mkdir, &e);
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
    Suspend,
    Failed,
    AlreadyDone,
}

impl OutputTaskVTable for Mkdir {
    fn write_err(
        interp: &Interpreter,
        cmd: NodeId,
        child: Box<OutputTask<Self>>,
        errbuf: &[u8],
    ) -> OutputWrite<Self> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        let stderr_needs_io = Builtin::of(interp, cmd).stderr.needs_io();
        if let Some(safeguard) = stderr_needs_io {
            // OutputTask has no `WriterTag` of its own (it is not directly
            // dispatchable as an IOWriter child), so the enqueue is tagged
            // `WriterTag::Builtin` and `child` is parked on `output_queue`;
            // `on_io_writer_chunk` pops it to route the completion back to
            // the OutputTask state machine.
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.output_queue.push_back(child);
            }
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return OutputWrite::Enqueued(Builtin::write_out(
                interp,
                cmd,
                IoKind::Stderr,
                childptr,
                errbuf,
                safeguard,
            ));
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, errbuf);
        OutputWrite::Done(child)
    }

    fn on_write_err(interp: &Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }

    fn write_out(
        interp: &Interpreter,
        cmd: NodeId,
        child: Box<OutputTask<Self>>,
    ) -> OutputWrite<Self> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io();
        if let Some(safeguard) = stdout_needs_io {
            // See write_err — park `child` so the chunk callback routes to
            // OutputTask::on_io_writer_chunk.
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return OutputWrite::Enqueued(Builtin::write_out_with(
                interp,
                cmd,
                IoKind::Stdout,
                childptr,
                safeguard,
                |buf| {
                    buf.extend_from_slice(child.output.slice());
                    if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                        exec.output_queue.push_back(child);
                    }
                },
            ));
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, child.output.slice());
        OutputWrite::Done(child)
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

/// Runs `mkdir`/`mkdir -p` on a worker
/// thread, then bounces back to the main thread.
pub(crate) struct ShellMkdirTask {
    /// Owning Cmd node (the mkdir builtin's id).
    pub cmd: NodeId,
    pub opts: Opts,
    /// Owned copy of the target path (owned to avoid threading a lifetime
    /// through the WorkPool).
    pub filepath: Vec<u8>,
    pub cwd_path: Vec<u8>,
    pub created_directories: Vec<u8>,
    pub err: Option<bun_sys::Error>,
    pub task: ShellTask,
}

crate::shell_task!(ShellMkdirTask);

impl ShellMkdirTask {
    fn create(
        cmd: NodeId,
        opts: Opts,
        filepath: Vec<u8>,
        cwd_path: Vec<u8>,
        interp: &Interpreter,
    ) -> Box<ShellMkdirTask> {
        Box::new(ShellMkdirTask {
            cmd,
            opts,
            filepath,
            cwd_path,
            created_directories: Vec::new(),
            err: None,
            task: ShellTask::new(interp),
        })
    }

    fn run_from_thread_pool(this: &mut ShellMkdirTask) {
        use bun_paths::{Platform, platform, resolve_path};
        // We have to give an absolute path to our mkdir implementation for it
        // to work with cwd.
        let mut spill = Vec::new();
        let filepath: &bun_core::ZStr = if Platform::AUTO.is_absolute(&this.filepath) {
            // Owned `Vec<u8>`; ensure NUL-terminated.
            if this.filepath.last() != Some(&0) {
                this.filepath.push(0);
            }
            bun_core::ZStr::from_buf(&this.filepath, this.filepath.len() - 1)
        } else {
            resolve_path::join_z_spill::<platform::Auto>(
                &mut spill,
                &[&this.cwd_path, &this.filepath],
            )
        };

        // `NodeFS` expects the `Valid::path_too_long` bound its JS callers
        // enforce; past it, `PathLike::slice_z` yields "" and mkdir reports ENOENT.
        if filepath.len() >= bun_paths::MAX_PATH_BYTES {
            this.err = Some(
                bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::mkdir)
                    .with_path(filepath.as_bytes()),
            );
            return;
        }

        let mut node_fs = NodeFS::default();
        let args = fs_args::Mkdir {
            path: PathLike::borrowed(filepath.as_bytes()),
            recursive: this.opts.parents,
            mode: fs_args::Mkdir::DEFAULT_MODE,
            always_return_none: true,
        };

        if this.opts.parents {
            let vtable = MkdirVerboseVTable {
                inner: &raw mut this.created_directories,
                active: this.opts.verbose,
            };
            if let Err(e) = node_fs.mkdir_recursive_impl(&args, &vtable) {
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
        // Bounce-back to the main thread is posted by `ShellTask::run_owned`
        // via `ShellTask::on_finish` (handles both JS and mini event loops).
    }
}

// `runtime::dispatch::run_task`'s `task_tag::ShellMkdirTask` arm reboxes the
// pointer `ShellTask::on_finish` posted; a completion that will not run drops
// the keep-alive and the box.

/// Collects each created directory into
/// `created_directories` (newline-separated) when `-v` is set. Passed by value
/// to `NodeFS::mkdir_recursive_impl`; `on_create_dir` writes through the raw
/// back-ref because the trait method takes `&self`.
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
    fn shell_task(&self) -> &ShellTask {
        &self.task
    }
    fn shell_task_mut(&mut self) -> &mut ShellTask {
        &mut self.task
    }
    fn run_from_thread_pool(&mut self) {
        Self::run_from_thread_pool(self)
    }
    /// The task drops after `on_shell_mkdir_task_done` has taken what it needs.
    fn run_from_main_thread(mut self: Box<Self>, interp: &Interpreter) {
        let cmd = self.cmd;
        Mkdir::on_shell_mkdir_task_done(interp, cmd, &mut self);
    }
}

#[derive(Default, Clone, Copy)]
pub struct Opts {
    /// `-p`, `--parents` — no error if existing, make parent directories as
    /// needed, with their file modes unaffected by any -m option.
    pub(crate) parents: bool,
    /// `-v`, `--verbose` — print a message for each created directory
    pub(crate) verbose: bool,
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
        // Note: the `--vebose` typo is intentional (kept for compatibility).
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
            _ => Some(ParseFlagResult::IllegalOption(smallflags[1 + i..].into())),
        }
    }
}
