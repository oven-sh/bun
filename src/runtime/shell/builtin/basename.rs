use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let args = Builtin::of(interp, cmd).args();
    if args.is_empty() {
        return Builtin::fail_usage(interp, cmd, b"usage: basename string\n");
    }
    let mut out = Vec::new();
    for path in args {
        out.extend_from_slice(bun_paths::resolve_path::basename(path));
        out.push(b'\n');
    }
    Builtin::finish(interp, cmd, IoKind::Stdout, &out, 0)
}
