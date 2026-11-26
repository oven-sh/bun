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
        out.extend_from_slice(match bun_paths::basename(path) {
            // A root is its own name.
            b"" => bun_paths::without_trailing_sep(path),
            name => name,
        });
        out.push(b'\n');
    }
    Builtin::finish(interp, cmd, IoKind::Stdout, &out, 0)
}
