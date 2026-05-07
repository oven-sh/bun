use core::ffi::CStr;

use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Basename {
    state: State,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    WaitingIo,
    Done,
}

impl Basename {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        let args = Builtin::of(interp, cmd).args_slice();
        if args.is_empty() {
            return Self::write(interp, cmd, IoKind::Stderr, b"usage: basename string\n", 1);
        }
        // SAFETY: argv entries are NUL-terminated.
        let path = unsafe { CStr::from_ptr(args[0]) }.to_bytes();
        let base = bun_paths::basename(path);
        let mut out = base.to_vec();
        out.push(b'\n');
        Self::write(interp, cmd, IoKind::Stdout, &out, 0)
    }

    fn write(
        interp: &mut Interpreter,
        cmd: NodeId,
        io_kind: IoKind,
        buf: &[u8],
        exit: crate::shell::ExitCode,
    ) -> Yield {
        let needs_io = match io_kind {
            IoKind::Stdout => Builtin::of(interp, cmd).stdout.needs_io().is_some(),
            _ => Builtin::of(interp, cmd).stderr.needs_io().is_some(),
        };
        if needs_io {
            // TODO(b2-blocked): IOWriter::enqueue
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            return Yield::suspended();
        }
        let _ = Builtin::write_no_io(interp, cmd, io_kind, buf);
        Builtin::done(interp, cmd, exit)
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, if err.is_some() { 1 } else { 0 })
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Basename {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Basename(b) => b,
            _ => unreachable!(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/basename.zig (66 lines)
//   confidence: high
//   blocked_on: IOWriter::enqueue (async path)
// ──────────────────────────────────────────────────────────────────────────
