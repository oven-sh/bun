use core::ffi::CStr;

use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Echo {
    /// The fully-rendered output (joined argv + optional trailing newline).
    /// Kept on the state so the async IOWriter path can borrow it across
    /// yields.
    pub output: Vec<u8>,
    state: State,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    WaitingIo,
    Done,
}

impl Echo {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        let (no_newline, output) = {
            let args = Builtin::of(interp, cmd).args_slice();
            let mut i = 0usize;
            let mut no_newline = false;
            // POSIX: leading `-n` suppresses the trailing newline. (Bash also
            // accepts `-e`/`-E`; the Zig version handles those — full flag
            // parsing is in the gated body.)
            while i < args.len() {
                // SAFETY: argv entries are NUL-terminated.
                let a = unsafe { CStr::from_ptr(args[i]) }.to_bytes();
                if a == b"-n" {
                    no_newline = true;
                    i += 1;
                } else {
                    break;
                }
            }
            let mut out = Vec::new();
            for (j, arg) in args[i..].iter().enumerate() {
                if j > 0 {
                    out.push(b' ');
                }
                // SAFETY: argv entries are NUL-terminated.
                out.extend_from_slice(unsafe { CStr::from_ptr(*arg) }.to_bytes());
            }
            (no_newline, out)
        };
        {
            let me = Self::state_mut(interp, cmd);
            me.output = output;
            if !no_newline {
                me.output.push(b'\n');
            }
        }

        if Builtin::of(interp, cmd).stdout.needs_io().is_some() {
            // TODO(b2-blocked): IOWriter::enqueue — async stdout.
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            return Yield::suspended();
        }
        // PORT NOTE: reshaped for borrowck — clone output to drop the borrow
        // on `interp` before calling write_no_io.
        let buf = Self::state_mut(interp, cmd).output.clone();
        Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
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
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Echo {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Echo(e) => e,
            _ => unreachable!(),
        }
    }
}

// Full body (~200 lines: -e escape processing, incremental chunked write) is
// preserved gated until IOWriter::enqueue is real.
#[cfg(any())]
mod echo_body {
    include!("echo_body_gated.rs");
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/echo.zig (242 lines)
//   confidence: medium
//   blocked_on: IOWriter::enqueue (async path), -e escape handling
// ──────────────────────────────────────────────────────────────────────────
