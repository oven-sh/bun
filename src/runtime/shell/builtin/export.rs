use crate::shell::EnvStr;
use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;
use bun_collections::index_sort;

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let args = Builtin::of(interp, cmd).args();
    if args.is_empty() {
        return print_all(interp, cmd);
    }
    for s in args {
        if s.is_empty() {
            continue;
        }
        let (name, value) = match bun_core::strings::index_of_char_usize(s, b'=') {
            Some(eq) => (&s[..eq], &s[eq + 1..]),
            None => (s.get(), &b""[..]),
        };
        // Copied: argv is freed with the Cmd.
        let label = EnvStr::init_ref_counted(name.into());
        let val = EnvStr::init_ref_counted(value.into());
        interp.as_cmd_mut(cmd).shell.export_env.insert(label, val);
    }
    Builtin::done(interp, cmd, 0)
}

fn print_all(interp: &Interpreter, cmd: NodeId) -> Yield {
    let mut entries: Vec<(&EnvStr, &EnvStr)> =
        Builtin::shell(interp, cmd).export_env.iter().collect();
    index_sort::sort_slice_by(&mut entries, |a, b| a.0.slice().cmp(b.0.slice()));

    let mut buf = Vec::new();
    for (k, v) in &entries {
        buf.extend_from_slice(k.slice());
        buf.push(b'=');
        buf.extend_from_slice(v.slice());
        buf.push(b'\n');
    }
    Builtin::finish(interp, cmd, IoKind::Stdout, &buf, 0)
}
