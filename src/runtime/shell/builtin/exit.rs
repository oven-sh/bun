use core::ffi::CStr;

use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

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
        let code: crate::shell::ExitCode = match args.len() {
            0 => 0,
            1 => {
                // SAFETY: argv entries are NUL-terminated (built by Cmd from
                // expanded atoms, which append a sentinel).
                let s = unsafe { bun_core::ffi::cstr(args[0]) }.to_bytes();
                match parse_exit_code(s) {
                    Some(c) => c,
                    None => {
                        return Self::fail(
                            interp,
                            cmd,
                            b"exit: numeric argument required\n",
                        );
                    }
                }
            }
            _ => {
                return Self::fail(interp, cmd, b"exit: too many arguments\n");
            }
        };
        // TODO(port): bash `exit` should unwind the whole script, not just the
        // current Cmd. The Zig version sets a flag on the interpreter; preserve
        // that once `Interpreter::request_exit` exists.
        Builtin::done(interp, cmd, code)
    }

    fn fail(interp: &mut Interpreter, cmd: NodeId, msg: &[u8]) -> Yield {
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, msg, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, msg);
        Builtin::done(interp, cmd, 1)
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 1)
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Exit {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Exit(e) => e,
            _ => unreachable!(),
        }
    }
}

fn parse_exit_code(s: &[u8]) -> Option<crate::shell::ExitCode> {
    let s = core::str::from_utf8(s).ok()?;
    s.parse::<u64>().ok().map(|n| (n % 256) as crate::shell::ExitCode)
}

// ported from: src/shell/builtin/exit.zig
