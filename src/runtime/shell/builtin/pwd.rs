use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    if !Builtin::of(interp, cmd).args().is_empty() {
        return Builtin::fail(interp, cmd, format_args!("too many arguments\n"));
    }
    let out = [Builtin::shell(interp, cmd).cwd(), b"\n"].concat();
    Builtin::finish(interp, cmd, IoKind::Stdout, &out, 0)
}
