use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

/// One-argument-per-line path transform shared by `basename` and `dirname`.
pub trait PathTransform: Default {
    const KIND: Kind;
    fn apply(path: &[u8]) -> &[u8];
}

#[derive(Default)]
pub struct PathBuiltin<T: PathTransform> {
    state: State,
    buf: Vec<u8>,
    _transform: std::marker::PhantomData<T>,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    Err,
    Done,
}

#[derive(Default)]
pub struct BasenameTransform;

impl PathTransform for BasenameTransform {
    const KIND: Kind = Kind::Basename;
    fn apply(path: &[u8]) -> &[u8] {
        bun_paths::resolve_path::basename(path)
    }
}

pub type Basename = PathBuiltin<BasenameTransform>;

impl<T: PathTransform> PathBuiltin<T> {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield
    where
        Self: BuiltinState,
    {
        let buf = {
            let bltn = Builtin::of(interp, cmd);
            let argc = bltn.args_slice().len();
            if argc == 0 {
                return Self::fail(interp, cmd, T::KIND.usage_string());
            }
            let mut buf = Vec::new();
            for i in 0..argc {
                buf.extend_from_slice(T::apply(bltn.arg_bytes(i)));
                buf.push(b'\n');
            }
            buf
        };

        Self::state_mut(interp, cmd).state = State::Done;
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).buf = buf;
            let owned = Self::state_mut(interp, cmd).buf.clone();
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &owned, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        Builtin::done(interp, cmd, 0)
    }

    fn fail(interp: &Interpreter, cmd: NodeId, msg: &[u8]) -> Yield
    where
        Self: BuiltinState,
    {
        Self::state_mut(interp, cmd).state = State::Err;
        Builtin::write_failing_error(interp, cmd, msg, 1)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield
    where
        Self: BuiltinState,
    {
        if let Some(e) = err {
            e.deref();
            Self::state_mut(interp, cmd).state = State::Err;
            return Builtin::done(interp, cmd, 1);
        }
        match Self::state_mut(interp, cmd).state {
            State::Done => Builtin::done(interp, cmd, 0),
            State::Err => Builtin::done(interp, cmd, 1),
            State::Idle => unreachable!("{}.onIOWriterChunk: idle", T::KIND.as_str()),
        }
    }
}
