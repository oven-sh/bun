use std::rc::Rc;

use bun_core::ZStr;

use crate::shell::ExitCode;
use crate::shell::builtin::{BadFlag, Builtin, BuiltinInput, IoKind, Kind, Sink, State};
use crate::shell::interpreter::{Interpreter, NodeId, shell_openat};
use crate::shell::io_reader::{ChildPtr as ReaderChildPtr, IOReader, ReaderTag};
use crate::shell::yield_::Yield;

/// One input on its way to stdout.
pub(crate) struct Cat {
    reader: Rc<IOReader>,
    /// The argument to open after this input, if there is one.
    next: usize,
    /// Chunks queued on stdout and not written yet.
    pending: usize,
    /// What the reader finished with, 0 at EOF.
    ended: Option<ExitCode>,
}

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let bltn = Builtin::of(interp, cmd);
    let (flags, files) = bltn.split_flags();
    if let [flag, ..] = flags {
        return Builtin::fail_flag(interp, cmd, reject(flag));
    }
    if !files.is_empty() {
        return Cat::open(interp, cmd, 0);
    }
    let input = match &bltn.stdin {
        BuiltinInput::Fd(reader) => return Cat::read(interp, cmd, &Rc::clone(reader), 0),
        BuiltinInput::ArrayBuf { buf } => buf.slice(),
        BuiltinInput::Blob(blob) => blob.blob.shared_view(),
        BuiltinInput::Ignore => b"",
    };
    Builtin::finish(interp, cmd, IoKind::Stdout, input, 0)
}

fn reject(flag: &[u8]) -> BadFlag<'_> {
    match flag {
        [] | [_] => BadFlag::Illegal(flag),
        [_, b'b' | b'e' | b'n' | b's' | b't' | b'u' | b'v', ..] => BadFlag::Unsupported(&flag[..2]),
        [_, _, rest @ ..] => BadFlag::Illegal(rest),
    }
}

fn listener(cmd: NodeId) -> ReaderChildPtr {
    ReaderChildPtr {
        node: cmd,
        tag: ReaderTag::Cat,
    }
}

impl Cat {
    fn of(interp: &Interpreter, cmd: NodeId) -> Option<&mut Cat> {
        match &mut Builtin::of_mut(interp, cmd).state {
            State::Cat(cat) => Some(cat),
            _ => None,
        }
    }

    fn open(interp: &Interpreter, cmd: NodeId, idx: usize) -> Yield {
        // Closes the previous file first.
        Builtin::of_mut(interp, cmd).state = State::Idle;
        // The `args` of the Cmd still have the NUL, and argv[0].
        let arg = interp.as_cmd(cmd).args.get(idx + 1);
        let Some(path) = arg.and_then(|arg| ZStr::from_slice_until_nul(arg)) else {
            return Builtin::done(interp, cmd, 0);
        };
        match shell_openat(Builtin::cwd(interp, cmd), path, bun_sys::O::RDONLY, 0) {
            Ok(fd) => {
                let reader = IOReader::init(bun_sys::File::from_fd(fd), interp.event_loop);
                Self::read(interp, cmd, &reader, idx + 1)
            }
            Err(e) => Builtin::finish(interp, cmd, IoKind::Stderr, &Kind::Cat.task_error(&e), 1),
        }
    }

    /// The caller owns a `reader` too: `start` can finish the command.
    fn read(interp: &Interpreter, cmd: NodeId, reader: &Rc<IOReader>, next: usize) -> Yield {
        Builtin::of_mut(interp, cmd).state = State::Cat(Cat {
            reader: Rc::clone(reader),
            next,
            pending: 0,
            ended: None,
        });
        reader.set_interp(interp);
        reader.add_reader(listener(cmd));
        reader.start()
    }

    fn step(interp: &Interpreter, cmd: NodeId) -> Yield {
        let Some(cat) = Self::of(interp, cmd) else {
            return Yield::suspended();
        };
        match cat.ended {
            _ if cat.pending > 0 => Yield::suspended(),
            None => Rc::clone(&cat.reader).resume(),
            Some(0) => Self::open(interp, cmd, cat.next),
            Some(errno) => Builtin::done(interp, cmd, errno),
        }
    }

    pub(crate) fn on_write(interp: &Interpreter, cmd: NodeId, failed: Option<ExitCode>) -> Yield {
        let Some(exit_code) = failed else {
            if let Some(cat) = Self::of(interp, cmd) {
                cat.pending = cat.pending.saturating_sub(1);
            }
            return Self::step(interp, cmd);
        };
        if let Sink::Fd(fd) = Builtin::sink(interp, cmd, IoKind::Stdout) {
            fd.cancel_queued();
        }
        if let Some(cat) = Self::of(interp, cmd) {
            cat.reader.remove_reader(listener(cmd));
        }
        Builtin::done(interp, cmd, exit_code)
    }

    /// The reader pauses while every `cat` on it still writes.
    pub(crate) fn awaits_write(interp: &Interpreter, cmd: NodeId) -> bool {
        Self::of(interp, cmd).is_some_and(|cat| cat.pending > 0)
    }

    pub(crate) fn on_io_reader_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        chunk: &[u8],
        remove: &mut bool,
    ) -> Yield {
        *remove = false;
        match Builtin::sink(interp, cmd, IoKind::Stdout) {
            Sink::Fd(fd) => {
                let Some(cat) = Self::of(interp, cmd) else {
                    return Yield::done();
                };
                cat.pending += 1;
                fd.enqueue(chunk)
            }
            Sink::Memory(memory) => {
                let _ = memory.write(chunk);
                Yield::done()
            }
        }
    }

    pub(crate) fn on_io_reader_done(
        interp: &Interpreter,
        cmd: NodeId,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        // A read error ends the input like EOF does: the chunks already queued are still written.
        if let Some(cat) = Self::of(interp, cmd) {
            cat.ended = Some(err.map_or(0, |e| e.get_errno() as ExitCode));
        }
        Self::step(interp, cmd)
    }
}
