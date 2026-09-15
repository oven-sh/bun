use std::sync::Arc;

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinInput, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{
    FlagParser, Interpreter, NodeId, ParseFlagResult, parse_flags, shell_openat, unsupported_flag,
};
use crate::shell::io_reader::{ChildPtr as ReaderChildPtr, IOReader, ReaderTag};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Cat {
    pub(crate) state: CatState,
}

/// One input (stdin, or the current file argument) on its way to stdout.
#[derive(Default)]
pub struct Progress {
    /// The reader reported EOF or an error.
    in_done: bool,
    chunks_queued: usize,
    chunks_done: usize,
    /// The reader's error; 0 after EOF.
    errno: ExitCode,
}

impl Progress {
    /// A queued chunk calls back into this Cmd by `NodeId`, so the Cmd has to
    /// stay until the last one has.
    fn finished(&self) -> bool {
        self.in_done && self.chunks_done >= self.chunks_queued
    }
}

#[derive(Default)]
pub enum CatState {
    #[default]
    Idle,
    ExecStdin(Progress),
    ExecFilepathArgs {
        /// Index into argv where filepath args start.
        args_start: usize,
        /// Current index into the filepath args.
        idx: usize,
        /// Per-file reader.
        reader: Option<Arc<IOReader>>,
        progress: Progress,
    },
    WaitingWriteErr,
}

impl CatState {
    /// What follows a reader or writer completion.
    fn step(&mut self) -> Step {
        match self {
            CatState::ExecStdin(progress) if progress.finished() => Step::Done(progress.errno),
            CatState::ExecFilepathArgs {
                reader, progress, ..
            } if progress.finished() => {
                if progress.errno == 0 {
                    return Step::Next;
                }
                *reader = None;
                Step::Done(progress.errno)
            }
            _ => Step::Suspend,
        }
    }
}

/// Internal: what to do after dropping the &mut state borrow.
pub(crate) enum Step {
    Suspend,
    Done(ExitCode),
    Next,
}

impl Step {
    fn run(self, interp: &Interpreter, cmd: NodeId) -> Yield {
        match self {
            Step::Suspend => Yield::suspended(),
            Step::Done(code) => Builtin::done(interp, cmd, code),
            Step::Next => Cat::next(interp, cmd),
        }
    }
}

impl Cat {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let mut opts = Opts::default();
        let filepath_start = {
            let args = Builtin::of(interp, cmd).args_slice();
            match parse_flags(&mut opts, args) {
                Ok(Some(rest)) => Some(args.len() - rest.len()),
                Ok(None) => None,
                Err(e) => {
                    return Builtin::fail_parse(interp, cmd, Kind::Cat, &e, || {
                        Self::state_mut(interp, cmd).state = CatState::WaitingWriteErr
                    });
                }
            }
        };

        let argc = Builtin::of(interp, cmd).args_slice().len();
        let should_read_from_stdin = filepath_start.is_none() || filepath_start == Some(argc);

        Self::state_mut(interp, cmd).state = if should_read_from_stdin {
            CatState::ExecStdin(Progress::default())
        } else {
            CatState::ExecFilepathArgs {
                args_start: filepath_start.unwrap(),
                idx: 0,
                reader: None,
                progress: Progress::default(),
            }
        };

        Self::next(interp, cmd)
    }

    fn write_failing_error(
        interp: &Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = CatState::WaitingWriteErr;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, buf, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Builtin::done(interp, cmd, exit_code)
    }

    pub(crate) fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        // Read scalars, drop the borrow, then act.
        enum Branch {
            Stdin,
            FileArg { args_start: usize, idx: usize },
            WaitingErr,
        }
        let branch = match &Self::state_mut(interp, cmd).state {
            CatState::Idle => panic!("Invalid state"),
            CatState::ExecStdin { .. } => Branch::Stdin,
            CatState::ExecFilepathArgs {
                args_start, idx, ..
            } => Branch::FileArg {
                args_start: *args_start,
                idx: *idx,
            },
            CatState::WaitingWriteErr => Branch::WaitingErr,
        };
        match branch {
            Branch::Stdin => {
                // Stdin doesn't need IO (captured/ignored): read it all
                // synchronously and write straight to stdout.
                let stdin_needs_io = Builtin::of(interp, cmd).stdin.needs_io();
                if !stdin_needs_io {
                    if let CatState::ExecStdin(progress) = &mut Self::state_mut(interp, cmd).state {
                        progress.in_done = true;
                    }
                    // Copy stdin bytes so the &mut on `stdout`/`write_no_io`
                    // doesn't overlap a borrow of `stdin`.
                    let buf = Builtin::read_stdin_no_io(interp, cmd).to_vec();
                    if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
                        let child = ChildPtr::new(cmd, WriterTag::Builtin);
                        return Builtin::of_mut(interp, cmd)
                            .stdout
                            .enqueue(child, &buf, safeguard);
                    }
                    let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
                    return Builtin::done(interp, cmd, 0);
                }
                // Clone the `Arc<IOReader>`
                // out of `stdin` so we hold no borrow of `interp` across
                // `start()` (which may re-enter via the raw interp backref).
                let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
                let reader = match &Builtin::of(interp, cmd).stdin {
                    BuiltinInput::Fd(r) => Arc::clone(r),
                    _ => unreachable!("needs_io() returned true"),
                };
                reader.set_interp(interp_ptr);
                reader.add_reader(ReaderChildPtr {
                    node: cmd,
                    tag: ReaderTag::Cat,
                });
                reader.start()
            }
            Branch::FileArg { args_start, idx } => {
                let argc = Builtin::of(interp, cmd).args_slice().len();
                let n_files = argc - args_start;
                if idx >= n_files {
                    // Drop the reader if any.
                    if let CatState::ExecFilepathArgs { reader, .. } =
                        &mut Self::state_mut(interp, cmd).state
                    {
                        *reader = None;
                    }
                    return Builtin::done(interp, cmd, 0);
                }
                if let CatState::ExecFilepathArgs { reader, .. } =
                    &mut Self::state_mut(interp, cmd).state
                {
                    *reader = None;
                }

                let path = Builtin::of(interp, cmd).arg_zstr(args_start + idx);

                if let CatState::ExecFilepathArgs { idx: i, .. } =
                    &mut Self::state_mut(interp, cmd).state
                {
                    *i += 1;
                }

                let dir = Builtin::cwd(interp, cmd);
                let fd = match shell_openat(dir, path, bun_sys::O::RDONLY, 0) {
                    Ok(fd) => fd,
                    Err(e) => {
                        let buf =
                            Builtin::task_error_to_string(interp, cmd, Kind::Cat, &e).to_vec();
                        // The reader was already taken to `None` above.
                        return Self::write_failing_error(interp, cmd, &buf, 1);
                    }
                };

                let evtloop = Builtin::event_loop(interp, cmd);
                let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
                let reader = IOReader::init(fd, evtloop);
                reader.set_interp(interp_ptr);
                if let CatState::ExecFilepathArgs {
                    reader: slot,
                    progress,
                    ..
                } = &mut Self::state_mut(interp, cmd).state
                {
                    *progress = Progress::default();
                    *slot = Some(Arc::clone(&reader));
                }
                reader.add_reader(ReaderChildPtr {
                    node: cmd,
                    tag: ReaderTag::Cat,
                });
                reader.start()
            }
            Branch::WaitingErr => Yield::suspended(),
        }
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(e) = err {
            let errno = e.get_errno() as ExitCode;
            let rchild = ReaderChildPtr {
                node: cmd,
                tag: ReaderTag::Cat,
            };
            // Writing to stdout errored: cancel everything and finish.
            // Pull the reader `Arc` out of
            // state before calling `remove_reader`, then drop it.
            match &mut Self::state_mut(interp, cmd).state {
                CatState::ExecStdin(progress) => {
                    let was_done = core::mem::replace(&mut progress.in_done, true);
                    if !was_done {
                        if let BuiltinInput::Fd(r) = &Builtin::of(interp, cmd).stdin {
                            r.remove_reader(rchild);
                        }
                    }
                }
                CatState::ExecFilepathArgs { reader, .. } => {
                    if let Some(r) = reader.take() {
                        r.remove_reader(rchild);
                    }
                }
                CatState::WaitingWriteErr => {}
                _ => panic!("Invalid state"),
            }
            return Builtin::done(interp, cmd, errno);
        }

        let state = &mut Self::state_mut(interp, cmd).state;
        let step = match state {
            CatState::ExecStdin(progress) | CatState::ExecFilepathArgs { progress, .. } => {
                progress.chunks_done += 1;
                state.step()
            }
            CatState::WaitingWriteErr => Step::Done(1),
            CatState::Idle => panic!("Invalid state"),
        };
        step.run(interp, cmd)
    }

    pub(crate) fn on_io_reader_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        chunk: &[u8],
        remove: &mut bool,
    ) -> Yield {
        *remove = false;
        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io();
        match &mut Self::state_mut(interp, cmd).state {
            CatState::ExecStdin(progress) | CatState::ExecFilepathArgs { progress, .. } => {
                if let Some(safeguard) = stdout_needs_io {
                    progress.chunks_queued += 1;
                    let child = ChildPtr::new(cmd, WriterTag::Builtin);
                    return Builtin::of_mut(interp, cmd)
                        .stdout
                        .enqueue(child, chunk, safeguard);
                }
            }
            _ => panic!("Invalid state"),
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, chunk);
        Yield::done()
    }

    pub(crate) fn on_io_reader_done(
        interp: &Interpreter,
        cmd: NodeId,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        let errno: ExitCode = err.map(|e| e.get_errno() as ExitCode).unwrap_or(0);
        let state = &mut Self::state_mut(interp, cmd).state;
        let step = match state {
            CatState::ExecStdin(progress) | CatState::ExecFilepathArgs { progress, .. } => {
                progress.in_done = true;
                progress.errno = errno;
                state.step()
            }
            CatState::WaitingWriteErr | CatState::Idle => Step::Suspend,
        };
        step.run(interp, cmd)
    }
}

#[derive(Clone, Copy, Default)]
pub struct Opts {}

impl FlagParser for Opts {
    fn parse_long(&mut self, _flag: &[u8]) -> Option<ParseFlagResult> {
        None
    }

    fn parse_short(&mut self, ch: u8, smallflags: &[u8], i: usize) -> Option<ParseFlagResult> {
        match ch {
            b'b' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-b"))),
            b'e' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-e"))),
            b'n' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-n"))),
            b's' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-s"))),
            b't' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-t"))),
            b'u' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-u"))),
            b'v' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-v"))),
            _ => Some(ParseFlagResult::IllegalOption(
                &raw const smallflags[1 + i..],
            )),
        }
    }
}
