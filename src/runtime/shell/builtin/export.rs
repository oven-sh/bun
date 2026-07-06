use crate::shell::EnvStr;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Export {
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
        for i in 0..argc {
            let s = Builtin::of(interp, cmd).arg_bytes(i);
            if s.is_empty() {
                continue;
            }
            let eq = s.iter().position(|&b| b == b'=');
            let name = match eq {
                Some(eq) => &s[..eq],
                None => s,
            };
            // The argv backing is freed when the Cmd retires,
            // so the key/value MUST be duplicated into ref-counted storage —
            // `init_slice` here would leave dangling EnvStr in `export_env`.
            let label = EnvStr::dupe_ref_counted(name);
            let shell = interp.as_cmd(cmd).base.shell;
            // SAFETY: shell env outlives the Cmd node.
            unsafe {
                match eq {
                    Some(eq) => {
                        let val = EnvStr::dupe_ref_counted(&s[eq + 1..]);
                        // A `NAME=value` shell-local entry must not shadow the
                        // exported binding: `$VAR` expansion checks `shell_env`
                        // before `export_env`.
                        (*shell).shell_env.remove(label);
                        (*shell).export_env.insert(label, val);
                        val.deref();
                    }
                    // `export NAME` gives NAME the export attribute while keeping
                    // its current value: promote a shell-local value rather than
                    // blanking it, and leave an already-exported value untouched.
                    None => {
                        if let Some(existing) = (*shell).shell_env.get(label) {
                            (*shell).shell_env.remove(label);
                            (*shell).export_env.insert(label, existing);
                            existing.deref();
                        } else if let Some(existing) = (*shell).export_env.get(label) {
                            existing.deref();
                        } else {
                            let val = EnvStr::dupe_ref_counted(b"");
                            (*shell).export_env.insert(label, val);
                            val.deref();
                        }
                    }
                }
            }
            label.deref();
        }
        Builtin::done(interp, cmd, 0)
    }

    fn print_all(interp: &Interpreter, cmd: NodeId) -> Yield {
        let mut entries: Vec<(EnvStr, EnvStr)> = Builtin::shell(interp, cmd)
            .export_env
            .iter()
            .map(|(k, v)| (*k, *v))
            .collect();
        entries.sort_by(|a, b| a.0.slice().cmp(b.0.slice()));

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
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, err.map_or(0, |_| 1))
    }
}
