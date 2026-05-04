use core::mem::offset_of;

use bun_jsc::SystemError;
use bun_shell::interpreter::Builtin;
use bun_shell::interpreter::builtin::Impl as BuiltinImpl;
use bun_shell::Yield;

pub struct True;

impl True {
    pub fn start(&mut self) -> Yield {
        self.bltn().done(0)
    }

    // PORT NOTE: `pub fn deinit` had an empty body in Zig — no Drop impl needed.

    pub fn on_io_writer_chunk(&mut self, _: usize, _: Option<SystemError>) -> Yield {
        Yield::Done
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self points to Builtin.impl.true_ (this struct is only ever
        // constructed in-place as that field).
        unsafe {
            let impl_ptr = (self as *mut Self as *mut u8)
                .sub(offset_of!(BuiltinImpl, true_))
                .cast::<BuiltinImpl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/true_.zig (27 lines)
//   confidence: high
//   todos:      0
//   notes:      Zig field names "true"/"impl" mapped to true_/impl_ (Rust keywords); verify Builtin/Impl module path in Phase B.
// ──────────────────────────────────────────────────────────────────────────
