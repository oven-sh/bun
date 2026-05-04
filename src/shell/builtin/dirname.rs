use core::ffi::{c_char, CStr};
use core::mem::offset_of;

use bun_shell::interpreter::Interpreter;
use bun_shell::interpreter::Builtin;
use bun_shell::Yield;
use bun_jsc::SystemError;
use bun_sys::Result as Maybe;
use bun_paths;

#[derive(Default, Clone, Copy, PartialEq, Eq)]
pub enum State {
    #[default]
    Idle,
    Err,
    Done,
}

#[derive(Default)]
pub struct Dirname {
    pub state: State,
    pub buf: Vec<u8>,
}

impl Dirname {
    pub fn start(&mut self) -> Yield {
        let args = self.bltn().args_slice();

        if args.is_empty() {
            return self.fail(Builtin::Kind::usage_string(Builtin::Kind::Dirname));
        }

        for item in args.iter() {
            // SAFETY: argsSlice() yields NUL-terminated [*:0]const u8 pointers
            let arg = unsafe { CStr::from_ptr(*item as *const c_char) }.to_bytes();
            let _ = self.print(bun_paths::dirname(arg, bun_paths::Platform::Posix));
            let _ = self.print(b"\n");
        }

        self.state = State::Done;
        if let Some(safeguard) = self.bltn().stdout.needs_io() {
            // PORT NOTE: reshaped for borrowck — buf slice passed by raw range; Phase B may need
            // to restructure enqueue() to avoid &mut self + &self.buf overlap.
            let buf = self.buf.as_slice();
            return self.bltn().stdout.enqueue(self, buf, safeguard);
        }
        self.bltn().done(0)
    }

    // `deinit` only freed `self.buf` via the default allocator; Vec<u8> drops
    // automatically, so no explicit Drop impl is needed.
    // (was: pub fn deinit(this: *@This()) void { this.buf.deinit(bun.default_allocator); })

    fn fail(&mut self, msg: &[u8]) -> Yield {
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            self.state = State::Err;
            return self.bltn().stderr.enqueue(self, msg, safeguard);
        }
        let _ = self.bltn().write_no_io(Builtin::Io::Stderr, msg);
        self.bltn().done(1)
    }

    fn print(&mut self, msg: &[u8]) -> Maybe<()> {
        if self.bltn().stdout.needs_io().is_some() {
            self.buf.extend_from_slice(msg);
            return Maybe::Ok(());
        }
        let res = self.bltn().write_no_io(Builtin::Io::Stdout, msg);
        if let Maybe::Err(err) = res {
            return Maybe::Err(err);
        }
        Maybe::Ok(())
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, maybe_e: Option<SystemError>) -> Yield {
        if let Some(e) = maybe_e {
            e.deref();
            self.state = State::Err;
            return self.bltn().done(1);
        }
        match self.state {
            State::Done => self.bltn().done(0),
            State::Err => self.bltn().done(1),
            State::Idle => bun_shell::unreachable_state("Dirname.onIOWriterChunk", "idle"),
        }
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self is the `dirname` field of Builtin::Impl, which is the `impl` field of Builtin.
        unsafe {
            let impl_ptr = (self as *mut Self as *mut u8)
                .sub(offset_of!(Builtin::Impl, dirname))
                .cast::<Builtin::Impl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/dirname.zig (76 lines)
//   confidence: medium
//   todos:      0
//   notes:      bltn() container_of + stdout.enqueue(self, &self.buf) overlap will need borrowck reshaping in Phase B
// ──────────────────────────────────────────────────────────────────────────
