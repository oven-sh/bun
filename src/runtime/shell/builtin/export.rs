use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use crate::shell::{EnvStr, is_valid_var_name};
use bun_collections::index_sort;

#[derive(Default)]
pub struct Export {
    state: State,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    WaitingIo,
    WaitingWriteErr,
    Done,
}

impl Export {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc == 0 {
            // No args: print all exported vars.
            return Self::print_all(interp, cmd);
        }
        let mut errors: Vec<u8> = Vec::new();
        for i in 0..argc {
            let s = Builtin::of(interp, cmd).arg_bytes(i);
            if s.is_empty() {
                continue;
            }
            let eq = bun_core::strings::index_of_char_usize(s, b'=');
            if eq.is_none() && !is_valid_var_name(s) {
                use std::io::Write as _;
                let _ = writeln!(
                    &mut errors,
                    "{}: `{}`: not a valid identifier",
                    Kind::Export.as_str(),
                    bstr::BStr::new(s),
                );
                continue;
            }
            let (name, value) = match eq {
                Some(eq) => (&s[..eq], &s[eq + 1..]),
                None => (s, &b""[..]),
            };
            // The argv backing is freed when the Cmd retires,
            // so the key/value MUST be duplicated into ref-counted storage —
            // `init_slice` here would leave dangling EnvStr in `export_env`.
            let label = EnvStr::dupe_ref_counted(name);
            let val = EnvStr::dupe_ref_counted(value);
            let shell = interp.as_cmd(cmd).base.shell;
            // SAFETY: shell env outlives the Cmd node.
            unsafe { (*shell).export_env.insert(label, val) };
            label.deref();
            val.deref();
        }
        if errors.is_empty() {
            return Builtin::done(interp, cmd, 0);
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, &errors, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, &errors);
        Builtin::done(interp, cmd, 1)
    }

    fn print_all(interp: &Interpreter, cmd: NodeId) -> Yield {
        let mut entries: Vec<(EnvStr, EnvStr)> = Builtin::shell(interp, cmd)
            .export_env
            .iter()
            .map(|(k, v)| (*k, *v))
            .collect();
        index_sort::sort_slice_by(&mut entries, |a, b| a.0.slice().cmp(b.0.slice()));

        let mut buf = Vec::new();
        for (k, v) in &entries {
            buf.extend_from_slice(k.slice());
            buf.push(b'=');
            buf.extend_from_slice(v.slice());
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
        let failed = matches!(Self::state_mut(interp, cmd).state, State::WaitingWriteErr);
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, if failed || err.is_some() { 1 } else { 0 })
    }
}
