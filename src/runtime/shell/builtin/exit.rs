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
            0 => 0,
            1 => {
                let s = bltn.arg_bytes(0);
                match parse_exit_code(s) {
                    Some(c) => c,
                    None => {
                        return Self::fail(interp, cmd, b"exit: numeric argument required\n");
                    }
                }
            }
            _ => {
                return Self::fail(interp, cmd, b"exit: too many arguments\n");
            }
        };
        Self::request_exit(interp, cmd, code);
        Builtin::done(interp, cmd, code)
    }

    /// Like bash, a bad argument still ends the script, with status 1.
    fn fail(interp: &Interpreter, cmd: NodeId, msg: &[u8]) -> Yield {
        Self::state_mut(interp, cmd).state = State::WaitingIo;
        Self::request_exit(interp, cmd, 1);
        Builtin::write_failing_error(interp, cmd, msg, 1)
    }

    /// End the enclosing execution context with `code`. A subshell, command
    /// substitution, or pipeline element owns its own `ShellExecEnv`, so
    /// `exit` never escapes the context that ran it.
    fn request_exit(interp: &Interpreter, cmd: NodeId, code: crate::shell::ExitCode) {
        interp.as_cmd_mut(cmd).base.shell_mut().exit_requested = Some(code);
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
