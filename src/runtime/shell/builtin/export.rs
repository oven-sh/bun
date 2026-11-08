use crate::shell::builtin::{Builtin, BuiltinState, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use crate::shell::{EnvStr, ExitCode};
use bun_collections::index_sort;
use bun_shell_parser::is_valid_var_name;

#[derive(Default)]
pub(crate) struct Export {
    state: State,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    WaitingIo,
    Err,
    Done,
}

impl Export {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        let mut has_operand = false;
        let mut errors = Vec::new();
        for i in 0..argc {
            let s = Builtin::of(interp, cmd).arg_bytes(i);
            if i == 0 && s.len() > 1 && s[0] == b'-' {
                if s == b"--" {
                    continue;
                }
                // No option is supported. `export -n NAME` must not reach NAME.
                let end = bun_core::strings::index_of_char_usize(s, b'=').unwrap_or(s.len());
                let msg = [b"export: ".as_slice(), &s[..end], b": invalid option\n"].concat();
                return Self::fail(interp, cmd, &msg);
            }
            has_operand = true;
            if s.is_empty() {
                continue;
            }
            let (name, value) = match bun_core::strings::index_of_char_usize(s, b'=') {
                Some(eq) if eq > 0 => (&s[..eq], &s[eq + 1..]),
                None if is_valid_var_name(s) => {
                    // A bare NAME stores an empty value (#45371). Do not do that after a refused word.
                    if !errors.is_empty() {
                        continue;
                    }
                    (s, &b""[..])
                }
                refused => {
                    errors.extend_from_slice(b"export: `");
                    errors.extend_from_slice(if refused.is_some() { b"=" } else { s });
                    errors.extend_from_slice(b"`: not a valid identifier\n");
                    continue;
                }
            };
            // The argv backing is freed when the Cmd retires,
            // so the key/value MUST be duplicated into ref-counted storage —
            // `init_slice` here would leave dangling EnvStr in `export_env`.
            let label = EnvStr::dupe_ref_counted(name);
            let val = EnvStr::dupe_ref_counted(value);
            interp
                .as_cmd_mut(cmd)
                .base
                .shell_mut()
                .export_env
                .insert(label, val);
            label.deref();
            val.deref();
        }
        if !has_operand {
            // No operand: print all exported vars.
            return Self::print_all(interp, cmd);
        }
        if errors.is_empty() {
            return Builtin::done(interp, cmd, 0);
        }
        Self::fail(interp, cmd, &errors)
    }

    /// Write `msg` to stderr, then finish with exit code 1.
    fn fail(interp: &Interpreter, cmd: NodeId, msg: &[u8]) -> Yield {
        Self::state_mut(interp, cmd).state = State::Err;
        Builtin::write_failing_error(interp, cmd, msg, 1)
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
        let failed = matches!(Self::state_mut(interp, cmd).state, State::Err);
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(
            interp,
            cmd,
            match err {
                Some(_err) => 1,
                None => ExitCode::from(failed),
            },
        )
    }
}
