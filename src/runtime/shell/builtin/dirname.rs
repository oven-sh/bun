use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let args = Builtin::of(interp, cmd).args();
    if args.is_empty() {
        return Builtin::fail_usage(interp, cmd, b"usage: dirname string\n");
    }
    let mut out = Vec::new();
    for path in args {
        let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Posix>(path);
        out.extend_from_slice(if dir.is_empty() { b"." } else { dir });
        out.push(b'\n');
    }
    Builtin::finish(interp, cmd, IoKind::Stdout, &out, 0)
}
