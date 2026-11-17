use crate::node::fs::{MkdirCtx, NodeFS, args as fs_args};
use crate::node::types::PathLike;
use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{
    FlagParser, Interpreter, NodeId, OutputSrc, OutputTask, OutputTaskVTable, ParseFlagResult,
    PoolTask, ShellTask, ShellWork, parse_flags,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use core::ops::ControlFlow;

#[derive(Default)]
pub(crate) struct Mkdir {
    pub(crate) opts: Opts,
    pub(crate) state: State,
}

#[derive(Default)]
pub(crate) enum State {
    #[default]
    Idle,
    Exec(Exec),
    WaitingWriteErr,
    Done,
}

pub(crate) struct Exec {
    pub(crate) started: bool,
    pub(crate) tasks_count: usize,
    pub(crate) tasks_done: usize,
    pub(crate) output_waiting: usize,
    pub(crate) output_done: usize,
    /// Index into `Builtin::args` where filepath args start (storing the
    /// index keeps the lifetime tied to the Cmd's argv without a
    /// self-reference).
    pub(crate) args_start: usize,
    pub(crate) err: Option<bun_sys::Error>,
    /// FIFO of in-flight `OutputTask`s awaiting an IOWriter chunk
    /// completion. Stopgap until `WriterTag` can carry the `OutputTask`
    /// directly (IOWriter.rs is out of scope here): `write_err`/`write_out`
    /// push, `on_io_writer_chunk` pops and forwards to
    /// `OutputTask::on_io_writer_chunk` so the box is reclaimed and the
    /// writeErr→writeOut→onDone state machine runs.
    pub(crate) output_queue: std::collections::VecDeque<Box<OutputTask<Mkdir>>>,
}

impl Mkdir {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
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
        // NOTE: reshaped for borrowck — read scalars, drop the borrow,
        // then act.
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
            State::WaitingWriteErr => return Yield::suspended(),
            State::Done => return Builtin::done(interp, cmd, 0),
        };
        match action {
            NextAction::Done(code) => {
                Self::state_mut(interp, cmd).state = State::Done;
                Builtin::done(interp, cmd, code)
            }
            NextAction::Schedule(args_start) => {
                let argc = Builtin::of(interp, cmd).args_slice().len();
                let task_count = argc - args_start;
                if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                    exec.tasks_count = task_count;
                }
                let opts = Self::state_mut(interp, cmd).opts;
                let cwd = Builtin::shell(interp, cmd).cwd().to_vec();
                for i in args_start..argc {
                    let task = ShellMkdirTask {
                        cmd,
                        opts,
                        filepath: Builtin::of(interp, cmd).arg_bytes(i).to_vec(),
                        cwd_path: cwd.clone(),
                        created_directories: Vec::new(),
                        err: None,
                    };
                    PoolTask::schedule(interp, task);
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
            State::WaitingWriteErr => return Builtin::done(interp, cmd, 1),
            State::Exec(exec) => exec.output_queue.pop_front(),
            State::Idle | State::Done => panic!("Invalid state"),
        };
        if let Some(task) = pending {
            return OutputTask::<Mkdir>::on_io_writer_chunk(task, interp, written, e);
        }
        Self::next(interp, cmd)
    }

    fn on_shell_mkdir_task_done(interp: &Interpreter, task: &mut ShellMkdirTask) -> Yield {
        let cmd = task.cmd;
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
        OutputTask::<Mkdir>::start(output_task, interp, errstr.as_deref())
    }
}

enum NextAction {
    Done(ExitCode),
    Schedule(usize),
}

impl OutputTaskVTable for Mkdir {
    fn write_err(
        interp: &Interpreter,
        cmd: NodeId,
        child: Box<OutputTask<Self>>,
        errbuf: &[u8],
    ) -> ControlFlow<Yield, Box<OutputTask<Self>>> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            // OutputTask has no `WriterTag` of its own (it is not directly
            // dispatchable as an IOWriter child), so the enqueue is tagged
            // `WriterTag::Builtin` and `child` is stashed on `output_queue`;
            // `on_io_writer_chunk` pops it to route the completion back to
            // the OutputTask state machine and reclaim the box.
            let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                unreachable!()
            };
            exec.output_queue.push_back(child);
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return ControlFlow::Break(
                Builtin::of_mut(interp, cmd)
                    .stderr
                    .enqueue(childptr, errbuf, safeguard),
            );
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, errbuf);
        ControlFlow::Continue(child)
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
    ) -> ControlFlow<Yield, Box<OutputTask<Self>>> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            let buf = child.output.slice().to_vec();
            // See write_err — stash `child` so the chunk callback routes to
            // OutputTask::on_io_writer_chunk.
            let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                unreachable!()
            };
            exec.output_queue.push_back(child);
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return ControlFlow::Break(
                Builtin::of_mut(interp, cmd)
                    .stdout
                    .enqueue(childptr, &buf, safeguard),
            );
        }
        let buf = child.output.slice().to_vec();
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        ControlFlow::Continue(child)
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
}

impl ShellWork for ShellMkdirTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellMkdirTask;

    fn run_from_thread_pool(&mut self, _: &ShellTask) {
        use bun_paths::{Platform, platform, resolve_path};
        // We have to give an absolute path to our mkdir implementation for it
        // to work with cwd.
        let mut spill = Vec::new();
        let filepath: &bun_core::ZStr = if Platform::AUTO.is_absolute(&self.filepath) {
            // Owned `Vec<u8>`; ensure NUL-terminated.
            if self.filepath.last() != Some(&0) {
                self.filepath.push(0);
            }
            bun_core::ZStr::from_slice_with_nul(&self.filepath)
        } else {
            resolve_path::join_z_spill::<platform::Auto>(
                &mut spill,
                &[&self.cwd_path, &self.filepath],
            )
        };

        // `NodeFS` expects the `Valid::path_too_long` bound its JS callers
        // enforce; past it, `PathLike::slice_z` yields "" and mkdir reports ENOENT.
        if filepath.len() >= bun_paths::MAX_PATH_BYTES {
            self.err = Some(
                bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::mkdir)
                    .with_path(filepath.as_bytes()),
            );
            return;
        }

        let mut node_fs = NodeFS::default();
        let args = fs_args::Mkdir {
            path: PathLike::borrowed(filepath.as_bytes()),
            recursive: self.opts.parents,
            mode: fs_args::Mkdir::DEFAULT_MODE,
            always_return_none: true,
        };

        if self.opts.parents {
            let mut vtable = MkdirVerboseVTable {
                inner: &mut self.created_directories,
                active: self.opts.verbose,
            };
            if let Err(e) = node_fs.mkdir_recursive_impl(&args, &mut vtable) {
                self.err = Some(e.with_path(filepath.as_bytes()));
                core::hint::black_box(&node_fs);
            }
        } else {
            match node_fs.mkdir_non_recursive(&args) {
                Ok(_) => {
                    if self.opts.verbose {
                        self.created_directories
                            .extend_from_slice(filepath.as_bytes());
                        self.created_directories.push(b'\n');
                    }
                }
                Err(e) => {
                    self.err = Some(e.with_path(filepath.as_bytes()));
                    core::hint::black_box(&node_fs);
                }
            }
        }
    }

    fn run_from_main_thread(&mut self, interp: &Interpreter) -> Yield {
        Mkdir::on_shell_mkdir_task_done(interp, self)
    }
}

/// Collects each created directory into
/// `created_directories` (newline-separated) when `-v` is set.
struct MkdirVerboseVTable<'a> {
    inner: &'a mut Vec<u8>,
    active: bool,
}

impl MkdirCtx for MkdirVerboseVTable<'_> {
    fn on_create_dir(&mut self, dirpath: &bun_paths::OSPathSliceZ) {
        if !self.active {
            return;
        }
        let out = &mut *self.inner;
        #[cfg(windows)]
        {
            let mut buf = bun_paths::path_buffer_pool::get();
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

#[derive(Default, Clone, Copy)]
pub(crate) struct Opts {
    /// `-p`, `--parents` — no error if existing, make parent directories as
    /// needed, with their file modes unaffected by any -m option.
    pub(crate) parents: bool,
    /// `-v`, `--verbose` — print a message for each created directory
    pub(crate) verbose: bool,
}

impl FlagParser for Opts {
    fn parse_long<'a>(&mut self, flag: &'a [u8]) -> Option<ParseFlagResult<'a>> {
        if flag == b"--mode" {
            return Some(ParseFlagResult::Unsupported(b"--mode"));
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

    fn parse_short<'a>(
        &mut self,
        ch: u8,
        smallflags: &'a [u8],
        i: usize,
    ) -> Option<ParseFlagResult<'a>> {
        match ch {
            b'm' => Some(ParseFlagResult::Unsupported(b"-m ")),
            b'p' => {
                self.parents = true;
                None
            }
            b'v' => {
                self.verbose = true;
                None
            }
            _ => Some(ParseFlagResult::IllegalOption(&smallflags[1 + i..])),
        }
    }
}
