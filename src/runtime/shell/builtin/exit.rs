use crate::shell::builtin::{Builtin, BuiltinState};
use crate::shell::interpreter::{Interpreter, NodeId};
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
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let code: Result<crate::shell::ExitCode, &'static [u8]> = {
            let bltn = Builtin::of(interp, cmd);
            match bltn.args_slice().len() {
                0 => Ok(0),
                1 => parse_exit_code(bltn.arg_bytes(0))
                    .ok_or(b"exit: numeric argument required\n".as_slice()),
                _ => Err(b"exit: too many arguments\n".as_slice()),
            }
        };
        let code = match code {
            Ok(c) => c,
            Err(msg) => return Self::fail(interp, cmd, msg),
        };
        // Intentional divergence from bash: this completes only the current
        // Cmd rather than unwinding the whole script.
        Builtin::done(interp, cmd, code)
    }

    fn fail(interp: &Interpreter, cmd: NodeId, msg: &[u8]) -> Yield {
        Self::state_mut(interp, cmd).state = State::WaitingIo;
        Builtin::write_failing_error(interp, cmd, msg, 1)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 1)
    }
}

fn parse_exit_code(s: &[u8]) -> Option<crate::shell::ExitCode> {
    // %256 is bash semantics — keep wrapper fn.
    bun_core::fmt::parse_decimal::<u64>(s).map(|n| (n % 256) as crate::shell::ExitCode)
}
