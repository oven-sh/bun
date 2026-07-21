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
        let bltn = Builtin::of(interp, cmd);
        let code: crate::shell::ExitCode = match bltn.args_slice().len() {
            // POSIX: "the exit status shall be that of the last command
            // executed, or zero if no command was executed."
            0 => interp.as_cmd(cmd).base.shell().last_exit_code,
            1 => {
                let s = bltn.arg_bytes(0);
                match parse_exit_code(s) {
                    Some(c) => c,
                    None => {
                        return Self::fail(interp, cmd, b"exit: numeric argument required\n", 2);
                    }
                }
            }
            _ => {
                return Self::fail(interp, cmd, b"exit: too many arguments\n", 1);
            }
        };
        // Intentional divergence from bash: this completes only the current
        // Cmd rather than unwinding the whole script.
        Builtin::done(interp, cmd, code)
    }

    fn fail(interp: &Interpreter, cmd: NodeId, msg: &[u8], code: crate::shell::ExitCode) -> Yield {
        Self::state_mut(interp, cmd).state = State::WaitingIo;
        Builtin::write_failing_error(interp, cmd, msg, code)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        let code = Builtin::of(interp, cmd).exit_code.unwrap_or(1);
        Builtin::done(interp, cmd, code)
    }
}

fn parse_exit_code(s: &[u8]) -> Option<crate::shell::ExitCode> {
    // bash semantics: parse as a signed integer and keep the low 8 bits
    // (`exit -1` → 255, `exit 300` → 44, `exit -300` → 212).
    bun_core::fmt::parse_decimal::<i64>(s).map(|n| crate::shell::ExitCode::from(n as u8))
}
