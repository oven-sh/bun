use core::ffi::CStr;

use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;
use crate::shell::EnvStr;

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
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc == 0 {
            // No args: print all exported vars.
            return Self::print_all(interp, cmd);
        }
        for i in 0..argc {
            let arg = Builtin::of(interp, cmd).args_slice()[i];
            // SAFETY: argv entries are NUL-terminated.
            let s = unsafe { CStr::from_ptr(arg) }.to_bytes();
            let (name, value) = match s.iter().position(|&b| b == b'=') {
                Some(eq) => (&s[..eq], &s[eq + 1..]),
                None => (s, &b""[..]),
            };
            let shell = interp.as_cmd(cmd).base.shell;
            // SAFETY: shell env outlives the Cmd node.
            unsafe {
                (*shell)
                    .export_env
                    .insert(EnvStr::init_slice(name), EnvStr::init_slice(value));
            }
        }
        Builtin::done(interp, cmd, 0)
    }

    fn print_all(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        // TODO(b2-blocked): iterate export_env and format `declare -x K="V"\n`
        // — depends on EnvMap iterator + IOWriter::enqueue.
        if Builtin::of(interp, cmd).stdout.needs_io().is_some() {
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            return Yield::suspended();
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, b"");
        Builtin::done(interp, cmd, 0)
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, if err.is_some() { 1 } else { 0 })
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Export {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Export(e) => e,
            _ => unreachable!(),
        }
    }
}

// ported from: src/shell/builtin/export.zig
