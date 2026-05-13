use core::ffi::CStr;

use crate::shell::EnvStr;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::shell_body::is_valid_var_name;
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
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
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
            let (name, value) = match s.iter().position(|&b| b == b'=') {
                Some(eq) => (&s[..eq], &s[eq + 1..]),
                None => {
                    // Spec (export.zig): an argument with no '=' must be a valid
                    // identifier; otherwise write a diagnostic to stderr and
                    // return without processing the rest of the arguments.
                    if !is_valid_var_name(s) {
                        let bad = s.to_vec();
                        return Self::write_invalid_identifier(interp, cmd, &bad);
                    }
                    (s, &b""[..])
                }
            };
            // Spec (export.zig): argv backing is freed when the Cmd retires,
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
        Builtin::done(interp, cmd, 0)
    }

    /// Spec (export.zig): `writeOutput(.stderr, "{s}\n", .{fmtErrorArena(.export,
    /// "`{s}`: not a valid identifier", .{arg})})`. `fmtErrorArena` prefixes
    /// `export: ` once, then `writeOutput` enqueues with the `export: ` prefix a
    /// second time — hence the doubled prefix in the emitted message. Exit code
    /// stays 0 (matches `writeOutput` returning `done(0)` / `onIOWriterChunk`).
    fn write_invalid_identifier(interp: &Interpreter, cmd: NodeId, name: &[u8]) -> Yield {
        let inner = Builtin::fmt_error_arena(
            interp,
            cmd,
            Some(Kind::Export),
            format_args!("`{}`: not a valid identifier", bstr::BStr::new(name)),
        )
        .to_vec();
        Self::state_mut(interp, cmd).state = State::WaitingIo;
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd).stderr.enqueue_fmt(
                child,
                Some(Kind::Export),
                format_args!("{}\n", bstr::BStr::new(&inner)),
                safeguard,
            );
        }
        let buf = Builtin::fmt_error_arena(
            interp,
            cmd,
            Some(Kind::Export),
            format_args!("{}\n", bstr::BStr::new(&inner)),
        )
        .to_vec();
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, &buf);
        Self::state_mut(interp, cmd).state = State::Done;
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

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        // Spec: `defer e.?.deref(); break :brk @intFromEnum(e.?.getErrno());`
        let code = err
            .map(|e| {
                let errno = e.get_errno() as crate::shell::ExitCode;
                e.deref();
                errno
            })
            .unwrap_or(0);
        Builtin::done(interp, cmd, code)
    }
}

// ported from: src/shell/builtin/export.zig
