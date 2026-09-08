use crate::shell::builtin::{Builtin, BuiltinState, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Pwd {
    state: State,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    WaitingIo {
        kind: WaitKind,
    },
    Err,
    Done,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WaitKind {
    Stdout,
    Stderr,
}

impl Pwd {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        if !Builtin::of(interp, cmd).args_slice().is_empty() {
            let msg: &[u8] = b"pwd: too many arguments\n";
            let stderr_needs_io = Builtin::of(interp, cmd).stderr.needs_io();
            if let Some(safeguard) = stderr_needs_io {
                Self::state_mut(interp, cmd).state = State::WaitingIo {
                    kind: WaitKind::Stderr,
                };
                let child = ChildPtr::new(cmd, WriterTag::Builtin);
                return Builtin::write_out(interp, cmd, IoKind::Stderr, child, msg, safeguard);
            }
            let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, msg);
            return Builtin::done(interp, cmd, 1);
        }

        let cwd: Vec<u8> = {
            let mut v = Builtin::shell(interp, cmd).borrow().cwd().to_vec();
            v.push(b'\n');
            v
        };
        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io();
        if let Some(safeguard) = stdout_needs_io {
            Self::state_mut(interp, cmd).state = State::WaitingIo {
                kind: WaitKind::Stdout,
            };
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::write_out(interp, cmd, IoKind::Stdout, child, &cwd, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &cwd);
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 0)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(_err) = err {
            Self::state_mut(interp, cmd).state = State::Err;
            return Builtin::done(interp, cmd, 1);
        }
        let kind = match &Self::state_mut(interp, cmd).state {
            State::WaitingIo { kind } => Some(*kind),
            _ => None,
        };
        let Some(kind) = kind else {
            return Builtin::done(interp, cmd, 0);
        };
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, if kind == WaitKind::Stderr { 1 } else { 0 })
    }
}
