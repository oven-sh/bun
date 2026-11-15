use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinInput, BuiltinState, Impl, IoKind, Kind};
use crate::shell::interpreter::{
    FlagParser, Interpreter, NodeId, ParseFlagResult, parse_flags, shell_openat,
};
use crate::shell::io_reader::{ChildPtr as ReaderChildPtr, IOReader, IOReaderId, ReaderTag};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub(crate) struct Cat {
    pub(crate) state: CatState,
}

#[derive(Default)]
pub(crate) enum CatState {
    #[default]
    Idle,
    ExecStdin {
        in_done: bool,
        chunks_queued: usize,
        chunks_done: usize,
        /// What the reader finished with (0 at EOF). It becomes the exit code.
        errno: ExitCode,
    },
    ExecFilepathArgs {
        /// Index into argv where filepath args start.
        args_start: usize,
        /// Current index into the filepath args.
        idx: usize,
        /// Per-file reader.
        reader: Option<IOReaderId>,
        chunks_queued: usize,
        chunks_done: usize,
        in_done: bool,
        /// What the current file's reader finished with. Non-zero ends the command.
        errno: ExitCode,
    },
    WaitingWriteErr,
}

/// Internal: what to do after dropping the &mut state borrow.
pub(crate) enum Step {
    Suspend,
    Done(ExitCode),
    Next,
    /// Every chunk queued so far is written and the input goes on.
    ReadMore,
}

impl Step {
    fn run(self, interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
        match self {
            Step::Suspend => Yield::suspended(),
            Step::Done(code) => {
                Cat::close_file_reader(interp, cmd);
                Builtin::done(interp, cmd, code)
            }
            Step::Next => Cat::next(interp, cmd),
            Step::ReadMore => Cat::read_more(interp, cmd),
        }
    }
}

impl CatState {
    /// Finishes the input once its reader is done and every chunk it queued is written.
    fn input_step(&mut self) -> Step {
        match self {
            CatState::ExecStdin {
                in_done,
                chunks_queued,
                chunks_done,
                errno,
            } => {
                if *chunks_done < *chunks_queued {
                    Step::Suspend
                } else if *in_done {
                    Step::Done(*errno)
                } else {
                    Step::ReadMore
                }
            }
            CatState::ExecFilepathArgs {
                in_done,
                chunks_queued,
                chunks_done,
                errno,
                ..
            } => {
                if *chunks_done < *chunks_queued {
                    Step::Suspend
                } else if !*in_done {
                    Step::ReadMore
                } else if *errno != 0 {
                    Step::Done(*errno)
                } else {
                    Step::Next
                }
            }
            CatState::WaitingWriteErr | CatState::Idle => Step::Suspend,
        }
    }
}

impl Cat {
    pub(crate) fn start(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
        let mut opts = Opts::default();
        let filepath_start = {
            let args = Builtin::of(interp, cmd).args_slice();
            match parse_flags(&mut opts, args) {
                Ok(Some(rest)) => Some(args.len() - rest.len()),
                Ok(None) => None,
                Err(e) => {
                    let buf = Builtin::parse_error_to_string(Kind::Cat, &e);
                    Self::state_mut(interp, cmd).state = CatState::WaitingWriteErr;
                    return Builtin::write_failing_error(interp, cmd, &buf, 1);
                }
            }
        };

        let argc = Builtin::of(interp, cmd).args_slice().len();
        let should_read_from_stdin = filepath_start.is_none() || filepath_start == Some(argc);

        Self::state_mut(interp, cmd).state = if should_read_from_stdin {
            CatState::ExecStdin {
                in_done: false,
                chunks_queued: 0,
                chunks_done: 0,
                errno: 0,
            }
        } else {
            CatState::ExecFilepathArgs {
                args_start: filepath_start.unwrap(),
                idx: 0,
                reader: None,
                chunks_queued: 0,
                chunks_done: 0,
                in_done: false,
                errno: 0,
            }
        };

        Self::next(interp, cmd)
    }

    fn write_failing_error(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        if let Some(fd) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = CatState::WaitingWriteErr;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return interp.enqueue(fd, child, buf);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Builtin::done(interp, cmd, exit_code)
    }

    pub(crate) fn next(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
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
                let BuiltinInput::Fd(reader) = Builtin::of(interp, cmd).stdin else {
                    if let CatState::ExecStdin { in_done, .. } =
                        &mut Self::state_mut(interp, cmd).state
                    {
                        *in_done = true;
                    }
                    // Copy stdin bytes so the &mut on `stdout`/`write_no_io`
                    // doesn't overlap a borrow of `stdin`.
                    let buf = Builtin::read_stdin_no_io(interp, cmd).to_vec();
                    if let Some(fd) = Builtin::of(interp, cmd).stdout.needs_io() {
                        let child = ChildPtr::new(cmd, WriterTag::Builtin);
                        return interp.enqueue(fd, child, &buf);
                    }
                    let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
                    return Builtin::done(interp, cmd, 0);
                };
                let reader = &mut interp.io_readers[reader];
                reader.add_reader(ReaderChildPtr {
                    node: cmd,
                    tag: ReaderTag::Cat,
                });
                reader.start()
            }
            Branch::FileArg { args_start, idx } => {
                let argc = Builtin::of(interp, cmd).args_slice().len();
                let n_files = argc - args_start;
                Self::close_file_reader(interp, cmd);
                if idx >= n_files {
                    return Builtin::done(interp, cmd, 0);
                }

                if let CatState::ExecFilepathArgs { idx: i, .. } =
                    &mut Self::state_mut(interp, cmd).state
                {
                    *i += 1;
                }

                let path = Builtin::of(interp, cmd).arg_zstr(args_start + idx);
                let dir = Builtin::cwd(interp, cmd);
                let fd = match shell_openat(dir, path, bun_sys::O::RDONLY, 0) {
                    Ok(fd) => fd,
                    Err(e) => {
                        let buf = Builtin::task_error_to_string(Kind::Cat, &e);
                        return Self::write_failing_error(interp, cmd, &buf, 1);
                    }
                };

                let reader = IOReader::init(interp, fd);
                if let CatState::ExecFilepathArgs {
                    reader: slot,
                    chunks_done,
                    chunks_queued,
                    in_done,
                    errno,
                    ..
                } = &mut Self::state_mut(interp, cmd).state
                {
                    *chunks_done = 0;
                    *chunks_queued = 0;
                    *in_done = false;
                    *errno = 0;
                    *slot = Some(reader);
                }
                let reader = &mut interp.io_readers[reader];
                reader.add_reader(ReaderChildPtr {
                    node: cmd,
                    tag: ReaderTag::Cat,
                });
                reader.start()
            }
            Branch::WaitingErr => Yield::suspended(),
        }
    }

    fn close_file_reader(interp: &mut Interpreter<'_>, cmd: NodeId) {
        if let CatState::ExecFilepathArgs { reader, .. } = &mut Self::state_mut(interp, cmd).state
            && let Some(reader) = reader.take()
        {
            interp.io_readers.remove(reader);
        }
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &mut Interpreter<'_>,
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
            if let Some(fd) = Builtin::of(interp, cmd).stdout.needs_io() {
                interp.io_writers[fd.writer].cancel_chunks(ChildPtr::new(cmd, WriterTag::Builtin));
            }
            match &mut Self::state_mut(interp, cmd).state {
                CatState::ExecStdin {
                    in_done,
                    errno: st_errno,
                    ..
                } => {
                    *st_errno = errno;
                    let was_done = core::mem::replace(in_done, true);
                    if !was_done {
                        if let BuiltinInput::Fd(r) = Builtin::of(interp, cmd).stdin {
                            interp.io_readers[r].remove_reader(rchild);
                        }
                    }
                }
                CatState::ExecFilepathArgs { .. } => Self::close_file_reader(interp, cmd),
                CatState::WaitingWriteErr => {}
                _ => panic!("Invalid state"),
            }
            return Builtin::done(interp, cmd, errno);
        }

        let state = &mut Self::state_mut(interp, cmd).state;
        let step = match state {
            CatState::ExecStdin { chunks_done, .. }
            | CatState::ExecFilepathArgs { chunks_done, .. } => {
                *chunks_done += 1;
                state.input_step()
            }
            CatState::WaitingWriteErr => Step::Done(1),
            CatState::Idle => panic!("Invalid state"),
        };
        step.run(interp, cmd)
    }

    /// The reader pauses while every `cat` on it still writes.
    pub(crate) fn awaits_write(interp: &Interpreter<'_>, cmd: NodeId) -> bool {
        let Impl::Cat(cat) = &Builtin::of(interp, cmd).impl_ else {
            unreachable!()
        };
        match &cat.state {
            CatState::ExecStdin {
                chunks_queued,
                chunks_done,
                ..
            }
            | CatState::ExecFilepathArgs {
                chunks_queued,
                chunks_done,
                ..
            } => chunks_done < chunks_queued,
            CatState::WaitingWriteErr | CatState::Idle => false,
        }
    }

    fn read_more(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
        let reader = match Self::state_mut(interp, cmd).state {
            CatState::ExecFilepathArgs { reader, .. } => reader,
            _ => match Builtin::of(interp, cmd).stdin {
                BuiltinInput::Fd(r) => Some(r),
                _ => None,
            },
        };
        reader.map_or(Yield::suspended(), |r| interp.io_readers[r].resume())
    }

    pub(crate) fn on_io_reader_chunk(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        chunk: &[u8],
    ) -> Yield {
        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io();
        match &mut Self::state_mut(interp, cmd).state {
            CatState::ExecStdin { chunks_queued, .. }
            | CatState::ExecFilepathArgs { chunks_queued, .. } => {
                if let Some(fd) = stdout_needs_io {
                    *chunks_queued += 1;
                    let child = ChildPtr::new(cmd, WriterTag::Builtin);
                    return interp.enqueue(fd, child, chunk);
                }
            }
            _ => panic!("Invalid state"),
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, chunk);
        Yield::done()
    }

    pub(crate) fn on_io_reader_done(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        read_errno: ExitCode,
    ) -> Yield {
        // A read error ends the input like EOF does: the chunks already queued are still written.
        let state = &mut Self::state_mut(interp, cmd).state;
        if let CatState::ExecStdin { in_done, errno, .. }
        | CatState::ExecFilepathArgs { in_done, errno, .. } = state
        {
            *in_done = true;
            *errno = read_errno;
        }
        let step = state.input_step();
        step.run(interp, cmd)
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Opts {}

impl FlagParser for Opts {
    fn parse_long<'a>(&mut self, _flag: &'a [u8]) -> Option<ParseFlagResult<'a>> {
        None
    }

    fn parse_short<'a>(
        &mut self,
        ch: u8,
        smallflags: &'a [u8],
        i: usize,
    ) -> Option<ParseFlagResult<'a>> {
        match ch {
            b'b' => Some(ParseFlagResult::Unsupported(b"-b")),
            b'e' => Some(ParseFlagResult::Unsupported(b"-e")),
            b'n' => Some(ParseFlagResult::Unsupported(b"-n")),
            b's' => Some(ParseFlagResult::Unsupported(b"-s")),
            b't' => Some(ParseFlagResult::Unsupported(b"-t")),
            b'u' => Some(ParseFlagResult::Unsupported(b"-u")),
            b'v' => Some(ParseFlagResult::Unsupported(b"-v")),
            _ => Some(ParseFlagResult::IllegalOption(&smallflags[1 + i..])),
        }
    }
}
