use crate::shell::EnvStr;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use bun_collections::index_sort;

#[derive(Default)]
pub(crate) struct Export {
    state: State,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    WaitingIo,
    Done,
}

impl Export {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc == 0 {
            // No args: print all exported vars.
            return Self::print_all(interp, cmd);
        }
        Self::assign_prefixes(interp, cmd, argc);
        for i in 0..argc {
            let s = Builtin::of(interp, cmd).arg_bytes(i);
            if s.is_empty() {
                continue;
            }
            let (name, value) = match bun_core::strings::index_of_char_usize(s, b'=') {
                Some(eq) => (&s[..eq], Some(&s[eq + 1..])),
                None => (s, None),
            };
            // The argv backing is freed when the Cmd retires,
            // so the key/value MUST be duplicated into ref-counted storage —
            // `init_slice` here would leave dangling EnvStr in the variable table.
            let label = EnvStr::dupe_ref_counted(name);
            let val = value.map(EnvStr::dupe_ref_counted);
            let shell = interp.as_cmd_mut(cmd).base.shell_mut();
            shell.vars.export(label, val);
            label.deref();
            if let Some(val) = val {
                val.deref();
            }
        }
        Builtin::done(interp, cmd, 0)
    }

    /// `NAME=v export NAME`: the prefix on this command assigns the operand.
    fn assign_prefixes(interp: &Interpreter, cmd: NodeId, argc: usize) {
        for i in 0..argc {
            let Some(prefixes) = interp.as_cmd(cmd).prefix_env.as_deref() else {
                return;
            };
            let s = Builtin::of(interp, cmd).arg_bytes(i);
            let eq = bun_core::strings::index_of_char_usize(s, b'=').unwrap_or(s.len());
            let Some(value) = prefixes.get(EnvStr::init_slice(&s[..eq])) else {
                continue;
            };
            let label = EnvStr::dupe_ref_counted(&s[..eq]);
            let shell = interp.as_cmd_mut(cmd).base.shell_mut();
            shell.vars.set(label, value);
            label.deref();
            value.deref();
        }
    }

    fn print_all(interp: &Interpreter, cmd: NodeId) -> Yield {
        let mut entries: Vec<(EnvStr, Option<EnvStr>)> =
            Builtin::shell(interp, cmd).vars.exported_names().collect();
        index_sort::sort_slice_by(&mut entries, |a, b| a.0.slice().cmp(b.0.slice()));

        let mut buf = Vec::new();
        for (k, v) in &entries {
            buf.extend_from_slice(k.slice());
            if let Some(v) = v {
                buf.push(b'=');
                buf.extend_from_slice(v.slice());
            }
            buf.push(b'\n');
        }

        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &buf, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        Builtin::done(interp, cmd, 0)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, err.map_or(0, |_| 1))
    }
}
