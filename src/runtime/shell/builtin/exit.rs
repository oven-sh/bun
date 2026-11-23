use crate::shell::ExitCode;
use crate::shell::builtin::Builtin;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

/// Unlike in bash, this completes only the current Cmd.
pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    match Builtin::of(interp, cmd).args() {
        [] => Builtin::done(interp, cmd, 0),
        [code] => match bun_core::fmt::parse_decimal::<u64>(code) {
            Some(n) => Builtin::done(interp, cmd, (n % 256) as ExitCode),
            None => Builtin::fail(interp, cmd, format_args!("numeric argument required\n")),
        },
        _ => Builtin::fail(interp, cmd, format_args!("too many arguments\n")),
    }
}
