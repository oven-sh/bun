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
    pub(crate) fn start(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
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
            let (name, value) = match bun_core::strings::index_of_char_usize(s, b'=') {
                Some(eq) => (&s[..eq], &s[eq + 1..]),
                None => (s, &b""[..]),
            };
            // The argv backing is freed when the Cmd retires.
            let label = EnvStr::init_ref_counted(name.into());
            let val = EnvStr::init_ref_counted(value.into());
            let shell = interp.as_cmd(cmd).shell.id();
            interp.shells[shell].export_env.insert(label, val);
        }
        Builtin::done(interp, cmd, 0)
    }

    fn print_all(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
        let mut entries: Vec<(&EnvStr<'_>, &EnvStr<'_>)> =
            Builtin::shell(interp, cmd).export_env.iter().collect();
        index_sort::sort_slice_by(&mut entries, |a, b| a.0.slice().cmp(b.0.slice()));

        let mut buf = Vec::new();
        for (k, v) in &entries {
            buf.extend_from_slice(k.slice());
            buf.push(b'=');
            buf.extend_from_slice(v.slice());
            buf.push(b'\n');
        }

        if let Some(fd) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return interp.enqueue(fd, child, &buf);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        Builtin::done(interp, cmd, 0)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, err.map_or(0, |_| 1))
    }
}
