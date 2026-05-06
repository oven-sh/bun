use core::ffi::CStr;

use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

#[derive(Default)]
pub struct Exit {
    state: State,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    WaitingIo,
    Done,
}

impl Exit {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        let args = Builtin::of(interp, cmd).args_slice();
        let code: ExitCode = match args.len() {
            0 => 0,
            1 => {
                // SAFETY: argv entries are NUL-terminated (built by Cmd from
                // expanded atoms, which append a sentinel).
                let s = unsafe { CStr::from_ptr(args[0]) }.to_bytes();
                match parse_exit_code(s) {
                    Some(c) => c,
                    None => {
                        return Self::fail(
                            interp,
                            cmd,
                            b"exit: numeric argument required\n",
                            2,
                        );
                    }
                }
            }
            _ => {
                return Self::fail(interp, cmd, b"exit: too many arguments\n", 1);
            }
        };
        // TODO(port): bash `exit` should unwind the whole script, not just the
        // current Cmd. The Zig version sets a flag on the interpreter; preserve
        // that once `Interpreter::request_exit` exists.
        Builtin::done(interp, cmd, code)
    }

    fn fail(interp: &mut Interpreter, cmd: NodeId, msg: &[u8], code: ExitCode) -> Yield {
        if Builtin::of(interp, cmd).stderr.needs_io().is_some() {
            // TODO(b2-blocked): IOWriter::enqueue — async path.
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            return Yield::suspended();
        }
        Builtin::write_no_io(interp, cmd, IoKind::Stderr, msg);
        Builtin::done(interp, cmd, code)
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        let code = if err.is_some() { 2 } else { 1 };
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, code)
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Exit {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Exit(e) => e,
            _ => unreachable!(),
        }
    }
}

fn parse_exit_code(s: &[u8]) -> Option<ExitCode> {
    let s = core::str::from_utf8(s).ok()?;
    s.trim().parse::<i64>().ok().map(|n| (n & 0xff) as ExitCode)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/exit.zig (72 lines)
//   confidence: high
//   blocked_on: IOWriter::enqueue (async stderr path)
// ──────────────────────────────────────────────────────────────────────────
