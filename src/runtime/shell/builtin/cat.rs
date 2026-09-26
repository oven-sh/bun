use std::sync::Arc;

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinIO, BuiltinInput, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{
    FlagParser, Interpreter, NodeId, ParseFlagResult, parse_flags, shell_openat, unsupported_flag,
};
use crate::shell::io_reader::{ChildPtr as ReaderChildPtr, IOReader, ReaderTag};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub(crate) struct Cat {
    pub(crate) state: CatState,
}

/// Where the inputs and the chunks written for them stand.
#[derive(Default)]
pub(crate) struct Progress {
    /// The current input is over: its reader reported EOF or an error, or it
    /// could not be opened.
    in_done: bool,
    /// Chunks queued on the stdout and stderr writers, and how many of them
    /// have called back. A queued chunk calls back into this Cmd by `NodeId`,
    /// so the Cmd has to stay until the last one has.
    chunks_queued: usize,
    chunks_done: usize,
    /// An input could not be read: the exit code is 1.
    failed: bool,
}

impl Progress {
    fn finished(&self) -> bool {
        self.in_done && self.chunks_done >= self.chunks_queued
    }

    fn exit_code(&self) -> ExitCode {
        ExitCode::from(self.failed)
    }
}

#[derive(Default)]
pub(crate) enum CatState {
    #[default]
    Idle,
    ExecStdin(Progress),
    ExecFilepathArgs {
        /// Index into argv where filepath args start.
        args_start: usize,
        /// How many of the filepath args have been started.
        idx: usize,
        /// The current file's reader.
        reader: Option<Arc<IOReader>>,
        progress: Progress,
    },
    /// The option parser's message is on its way to stderr.
    WaitingWriteErr,
}

impl CatState {
    fn progress(&mut self) -> Option<&mut Progress> {
        match self {
            CatState::ExecStdin(progress) | CatState::ExecFilepathArgs { progress, .. } => {
                Some(progress)
            }
            CatState::Idle | CatState::WaitingWriteErr => None,
        }
    }

    /// What follows a reader or writer completion.
    fn step(&mut self) -> Step {
        match self {
            CatState::ExecStdin(progress) if progress.finished() => {
                Step::Done(progress.exit_code())
            }
            CatState::ExecFilepathArgs { progress, .. } if progress.finished() => Step::Next,
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
            Step::Done(code) => Cat::finish(interp, cmd, code),
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
        match filepath_start.filter(|start| *start < argc) {
            None => {
                Self::state_mut(interp, cmd).state = CatState::ExecStdin(Progress::default());
                Self::read_stdin(interp, cmd)
            }
            Some(args_start) => {
                Self::state_mut(interp, cmd).state = CatState::ExecFilepathArgs {
                    args_start,
                    idx: 0,
                    reader: None,
                    progress: Progress::default(),
                };
                Self::next(interp, cmd)
            }
        }
    }

    /// The Cmd leaves the readers it listens to, then finishes.
    fn finish(interp: &Interpreter, cmd: NodeId, exit_code: ExitCode) -> Yield {
        let listener = ReaderChildPtr {
            node: cmd,
            tag: ReaderTag::Cat,
        };
        if let CatState::ExecFilepathArgs { reader, .. } = &mut Self::state_mut(interp, cmd).state
            && let Some(reader) = reader.take()
        {
            reader.remove_reader(listener);
        }
        // The shell's stdin reader outlives this Cmd and goes on to serve the
        // next one.
        if let BuiltinInput::Fd(stdin) = &Builtin::of(interp, cmd).stdin {
            stdin.remove_reader(listener);
        }
        Builtin::done(interp, cmd, exit_code)
    }

    /// Queue `buf` on stdout or stderr, counted, or write it right away when
    /// the stream is not a fd. `Some`: the chunk's completion arrives through
    /// `on_io_writer_chunk`.
    fn write(interp: &Interpreter, cmd: NodeId, io_kind: IoKind, buf: Vec<u8>) -> Option<Yield> {
        let me = Builtin::of(interp, cmd);
        let needs_io = match io_kind {
            IoKind::Stdout => me.stdout.needs_io(),
            IoKind::Stderr => me.stderr.needs_io(),
        };
        let Some(safeguard) = needs_io else {
            let _ = Builtin::write_no_io(interp, cmd, io_kind, &buf);
            return None;
        };
        if let Some(progress) = Self::state_mut(interp, cmd).state.progress() {
            progress.chunks_queued += 1;
        }
        let child = ChildPtr::new(cmd, WriterTag::Builtin);
        let out = match io_kind {
            IoKind::Stdout => &mut Builtin::of_mut(interp, cmd).stdout,
            IoKind::Stderr => &mut Builtin::of_mut(interp, cmd).stderr,
        };
        Some(out.enqueue_owned(child, buf, safeguard))
    }

    /// The current input could not be opened or read: say so on stderr and
    /// carry on with the next one, like `cat`. `err` names the input in its
    /// path. `Some` as for [`Self::write`].
    fn input_failed(interp: &Interpreter, cmd: NodeId, err: &bun_sys::Error) -> Option<Yield> {
        if let Some(progress) = Self::state_mut(interp, cmd).state.progress() {
            progress.in_done = true;
            progress.failed = true;
        }
        let message = Builtin::task_error_to_string(interp, cmd, Kind::Cat, err).to_vec();
        Self::write(interp, cmd, IoKind::Stderr, message)
    }

    fn read_stdin(interp: &Interpreter, cmd: NodeId) -> Yield {
        let reader = match &Builtin::of(interp, cmd).stdin {
            BuiltinInput::Fd(reader) => Arc::clone(reader),
            // Not a fd (captured or ignored): all of it is here already.
            _ => {
                if let Some(progress) = Self::state_mut(interp, cmd).state.progress() {
                    progress.in_done = true;
                }
                let buf = Builtin::read_stdin_no_io(interp, cmd).to_vec();
                if let Some(y) = Self::write(interp, cmd, IoKind::Stdout, buf) {
                    return y;
                }
                return Self::finish(interp, cmd, 0);
            }
        };
        reader.add_reader(ReaderChildPtr {
            node: cmd,
            tag: ReaderTag::Cat,
        });
        reader.start()
    }

    /// Start on the next file argument, or finish after the last.
    pub(crate) fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        loop {
            let (arg, exit_code) = match &mut Self::state_mut(interp, cmd).state {
                CatState::ExecFilepathArgs {
                    args_start,
                    idx,
                    reader,
                    progress,
                } => {
                    *reader = None;
                    progress.in_done = false;
                    let arg = *args_start + *idx;
                    *idx += 1;
                    (arg, progress.exit_code())
                }
                _ => panic!("Invalid state"),
            };
            if arg >= Builtin::of(interp, cmd).args_slice().len() {
                return Self::finish(interp, cmd, exit_code);
            }

            let path = Builtin::of(interp, cmd).arg_zstr(arg);
            let dir = Builtin::cwd(interp, cmd);
            let fd = match shell_openat(dir, path, bun_sys::O::RDONLY, 0) {
                Ok(fd) => fd,
                Err(e) => match Self::input_failed(interp, cmd, &e) {
                    Some(y) => return y,
                    None => continue,
                },
            };

            let reader = IOReader::init(fd, interp);
            if let CatState::ExecFilepathArgs { reader: slot, .. } =
                &mut Self::state_mut(interp, cmd).state
            {
                *slot = Some(Arc::clone(&reader));
            }
            reader.add_reader(ReaderChildPtr {
                node: cmd,
                tag: ReaderTag::Cat,
            });
            return reader.start();
        }
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(e) = err {
            // Writing failed: nothing more is read or written. The failed
            // writer dropped this Cmd's chunks; the other one may hold some.
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            let me = Builtin::of(interp, cmd);
            for out in [&me.stdout, &me.stderr] {
                if let BuiltinIO::Fd(fd) = out {
                    fd.writer.cancel_chunks(child);
                }
            }
            return Self::finish(interp, cmd, e.get_errno() as ExitCode);
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
        chunk: bun_io::pipes::Chunk<'_>,
        remove: &mut bool,
    ) -> Yield {
        *remove = false;
        if Builtin::of(interp, cmd).stdout.needs_io().is_none() {
            let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &chunk);
            return Yield::done();
        }
        Self::write(interp, cmd, IoKind::Stdout, chunk.take()).unwrap_or_else(Yield::done)
    }

    pub(crate) fn on_io_reader_done(
        interp: &Interpreter,
        cmd: NodeId,
        err: Option<&bun_sys::Error>,
    ) -> Yield {
        let arg = match &mut Self::state_mut(interp, cmd).state {
            CatState::ExecStdin(progress) => {
                progress.in_done = true;
                None
            }
            CatState::ExecFilepathArgs {
                args_start,
                idx,
                progress,
                ..
            } => {
                progress.in_done = true;
                Some(*args_start + *idx - 1)
            }
            CatState::WaitingWriteErr | CatState::Idle => return Yield::suspended(),
        };
        let name: &[u8] = match arg {
            Some(arg) => Builtin::of(interp, cmd).arg_bytes(arg),
            None => b"stdin",
        };
        if let Some(e) = err
            && let Some(y) = Self::input_failed(interp, cmd, &e.with_path(name))
        {
            return y;
        }
        Self::state_mut(interp, cmd).state.step().run(interp, cmd)
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Opts {}

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
