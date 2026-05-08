use core::ffi::CStr;

use crate::shell::builtin::{Builtin, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Basename {
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

impl Basename {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        let buf = {
            let args = Builtin::of(interp, cmd).args_slice();
            if args.is_empty() {
                return Self::fail(interp, cmd, Kind::Basename.usage_string());
            }
            let mut buf = Vec::new();
            for arg in args {
                // SAFETY: argv entries are NUL-terminated.
                let path = unsafe { CStr::from_ptr(*arg) }.to_bytes();
                buf.extend_from_slice(bun_paths::resolve_path::basename(path));
                buf.push(b'\n');
            }
            buf
        };

        Self::state_mut(interp, cmd).state = State::Done;
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
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

    fn fail(interp: &mut Interpreter, cmd: NodeId, msg: &[u8]) -> Yield {
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = State::Err;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, msg, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, msg);
        Builtin::done(interp, cmd, 1)
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(e) = err {
            e.deref();
            Self::state_mut(interp, cmd).state = State::Err;
            return Builtin::done(interp, cmd, 1);
        }
        match Self::state_mut(interp, cmd).state {
            State::Done => Builtin::done(interp, cmd, 0),
            State::Err => Builtin::done(interp, cmd, 1),
            State::Idle => unreachable!("Basename.onIOWriterChunk: idle"),
        }
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Basename {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Basename(b) => b,
            _ => unreachable!(),
        }
    }
}

// ported from: src/shell/builtin/basename.zig
