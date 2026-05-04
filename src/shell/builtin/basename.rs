use core::ffi::{c_char, CStr};

use bun_jsc::SystemError;
use bun_shell::interpreter::{Builtin, BuiltinImpl, BuiltinKind};
use bun_shell::Yield;

#[derive(Copy, Clone, Eq, PartialEq)]
enum State {
    Idle,
    Err,
    Done,
}

impl Default for State {
    fn default() -> Self {
        State::Idle
    }
}

#[derive(Default)]
pub struct Basename {
    state: State,
    buf: Vec<u8>,
}

impl Basename {
    pub fn start(&mut self) -> Yield {
        let args = self.bltn().args_slice();

        if args.is_empty() {
            return self.fail(BuiltinKind::usage_string(BuiltinKind::Basename));
        }

        for item in args.iter() {
            // SAFETY: argsSlice() yields NUL-terminated C strings
            let arg = unsafe { CStr::from_ptr(*item) }.to_bytes();
            self.print(bun_paths::basename(arg));
            self.print(b"\n");
        }

        self.state = State::Done;
        if let Some(safeguard) = self.bltn().stdout.needs_io() {
            // TODO(port): borrowck — bltn() (container_of &mut) overlaps with &mut self / &self.buf
            return self.bltn().stdout.enqueue(self, self.buf.as_slice(), safeguard);
        }
        self.bltn().done(0)
    }

    fn fail(&mut self, msg: &[u8]) -> Yield {
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            self.state = State::Err;
            // TODO(port): borrowck — bltn() (container_of &mut) overlaps with &mut self
            return self.bltn().stderr.enqueue(self, msg, safeguard);
        }
        // TODO(port): fd selector enum — Zig passes `.stderr` (Builtin stdio selector), not BuiltinKind
        let _ = self.bltn().write_no_io(Builtin::Stdio::Stderr, msg);
        self.bltn().done(1)
    }

    fn print(&mut self, msg: &[u8]) {
        if self.bltn().stdout.needs_io().is_some() {
            self.buf.extend_from_slice(msg);
            return;
        }
        // TODO(port): fd selector enum — Zig passes `.stdout` (Builtin stdio selector), not BuiltinKind
        let _ = self.bltn().write_no_io(Builtin::Stdio::Stdout, msg);
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, maybe_e: Option<SystemError>) -> Yield {
        if let Some(e) = maybe_e {
            drop(e); // deref via Drop
            self.state = State::Err;
            return self.bltn().done(1);
        }
        match self.state {
            State::Done => self.bltn().done(0),
            State::Err => self.bltn().done(1),
            State::Idle => bun_shell::unreachable_state("Basename.onIOWriterChunk", "idle"),
        }
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self is the `basename` field inside Builtin::Impl, which is the `impl` field inside Builtin
        unsafe {
            let impl_ptr = (self as *mut Self as *mut u8)
                .sub(core::mem::offset_of!(BuiltinImpl, basename))
                .cast::<BuiltinImpl>();
            &mut *(impl_ptr as *mut u8)
                .sub(core::mem::offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

// `deinit` only freed `buf` (Vec<u8> drops automatically) — no explicit Drop needed.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/basename.zig (71 lines)
//   confidence: medium
//   todos:      4
//   notes:      container_of (@fieldParentPtr) bltn() causes overlapping &mut borrows at enqueue() callsites; Phase B must reshape (raw ptr or split borrow). args_slice() element type assumed *const c_char. write_no_io fd selector is a placeholder (Builtin::Stdio::*), not BuiltinKind.
// ──────────────────────────────────────────────────────────────────────────
