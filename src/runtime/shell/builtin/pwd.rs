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
            if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
                Self::state_mut(interp, cmd).state = State::WaitingIo {
                    kind: WaitKind::Stderr,
                };
                let child = ChildPtr::new(cmd, WriterTag::Builtin);
                return Builtin::of_mut(interp, cmd)
                    .stderr
                    .enqueue(child, msg, safeguard);
            }
            let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, msg);
            return Builtin::done(interp, cmd, 1);
        }

        let cwd: Vec<u8> = {
            let mut v = Builtin::shell(interp, cmd).cwd().to_vec();
            v.push(b'\n');
            v
        };
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).state = State::WaitingIo {
                kind: WaitKind::Stdout,
            };
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &cwd, safeguard);
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
        let kind = match &Self::state_mut(interp, cmd).state {
            State::WaitingIo { kind } => Some(*kind),
            State::Err => None,
            State::Idle | State::Done => {
                crate::shell::interpreter::unreachable_state("Pwd.onIOWriterChunk", "idle/done")
            }
        };
        match kind {
            // The message in flight was itself an error report (`too many
            // arguments`, or the write-error report): exit 1 either way.
            None | Some(WaitKind::Stderr) => Builtin::done(interp, cmd, 1),
            Some(WaitKind::Stdout) => match err {
                Some(err) => Builtin::fail_write(interp, cmd, err.get_errno(), || {
                    Self::state_mut(interp, cmd).state = State::Err
                }),
                None => {
                    Self::state_mut(interp, cmd).state = State::Done;
                    Builtin::done(interp, cmd, 0)
                }
            },
        }
    }
}
