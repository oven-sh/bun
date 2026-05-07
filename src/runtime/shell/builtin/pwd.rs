use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Pwd {
    state: State,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    WaitingIo { kind: WaitKind },
    Err,
    Done,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WaitKind { Stdout, Stderr }

impl Pwd {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        if !Builtin::of(interp, cmd).args_slice().is_empty() {
            let msg: &[u8] = b"pwd: too many arguments\n";
            if Builtin::of(interp, cmd).stderr.needs_io().is_some() {
                // TODO(b2-blocked): IOWriter::enqueue — async stderr.
                Self::state_mut(interp, cmd).state = State::WaitingIo { kind: WaitKind::Stderr };
                return Yield::suspended();
            }
            let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, msg);
            return Builtin::done(interp, cmd, 1);
        }

        let cwd: Vec<u8> = {
            let mut v = Builtin::shell(interp, cmd).cwd().to_vec();
            v.push(b'\n');
            v
        };
        if Builtin::of(interp, cmd).stdout.needs_io().is_some() {
            // TODO(b2-blocked): IOWriter::enqueue_fmt_bltn — async stdout.
            Self::state_mut(interp, cmd).state = State::WaitingIo { kind: WaitKind::Stdout };
            return Yield::suspended();
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &cwd);
        Builtin::done(interp, cmd, 0)
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if err.is_some() {
            Self::state_mut(interp, cmd).state = State::Err;
            return Builtin::done(interp, cmd, 1);
        }
        let kind = match &Self::state_mut(interp, cmd).state {
            State::WaitingIo { kind } => *kind,
            _ => return Builtin::done(interp, cmd, 0),
        };
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, if kind == WaitKind::Stderr { 1 } else { 0 })
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Pwd {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Pwd(p) => p,
            _ => unreachable!(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/pwd.zig (78 lines)
//   confidence: high
//   blocked_on: IOWriter::enqueue (async path)
// ──────────────────────────────────────────────────────────────────────────
