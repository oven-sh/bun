use core::ffi::CStr;

use crate::shell::builtin::{Builtin, BuiltinState, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Dirname {
    state: State,
    buf: Vec<u8>,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    Err,
    Done,
}

impl Dirname {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let bltn = Builtin::of(interp, cmd);
        let argc = bltn.args_slice().len();
        if argc == 0 {
            return Self::fail(interp, cmd, b"usage: dirname string\n");
        }

        let stdout_needs_io = bltn.stdout.needs_io();
        let mut buf = Vec::new();
        for i in 0..argc {
            let path = bltn.arg_bytes(i);
            let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Posix>(path);
            let dir: &[u8] = if dir.is_empty() { b"." } else { dir };
            buf.extend_from_slice(dir);
            buf.push(b'\n');
        }

        Self::state_mut(interp, cmd).state = State::Done;
        if let Some(safeguard) = stdout_needs_io {
            Self::state_mut(interp, cmd).buf = buf;
            let owned = Self::state_mut(interp, cmd).buf.clone();
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &owned, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        Builtin::done(interp, cmd, 0)
    }

    fn fail(interp: &Interpreter, cmd: NodeId, msg: &[u8]) -> Yield {
        Self::state_mut(interp, cmd).state = State::Err;
        Builtin::write_failing_error(interp, cmd, msg, 1)
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if err.is_some() {
            Self::state_mut(interp, cmd).state = State::Err;
            return Builtin::done(interp, cmd, 1);
        }
        let exit = match Self::state_mut(interp, cmd).state {
            State::Done => 0,
            State::Err => 1,
            State::Idle => unreachable!("Dirname.onIOWriterChunk: idle"),
        };
        Builtin::done(interp, cmd, exit)
    }
}

// ported from: src/shell/builtin/dirname.zig
