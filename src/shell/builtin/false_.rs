use core::mem::offset_of;

use bun_jsc::SystemError;
use bun_shell::interpreter::Builtin;
use bun_shell::interpreter::builtin::Impl as BuiltinImpl;
use bun_shell::Yield;

/// Shell builtin `false` — always exits with status 1.
pub struct False;

impl False {
    pub fn start(&mut self) -> Yield {
        self.bltn().done(1)
    }

    // Zig `pub fn deinit` had an empty body — no Drop impl needed.

    pub fn on_io_writer_chunk(&mut self, _: usize, _: Option<SystemError>) -> Yield {
        Yield::Done
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: `self` is the `false_` field of `Builtin::Impl`, which in turn is the
        // `impl_` field of `Builtin`. Recovering the parent via offset_of mirrors the Zig
        // `@fieldParentPtr("false", this)` / `@fieldParentPtr("impl", impl)` chain.
        // TODO(port): field names `false`/`impl` are Rust keywords — confirm actual names on Builtin/Impl.
        unsafe {
            let impl_ptr = (self as *mut Self as *mut u8)
                .sub(offset_of!(BuiltinImpl, false_))
                .cast::<BuiltinImpl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/false_.zig (27 lines)
//   confidence: high
//   todos:      1
//   notes:      file-struct ported as unit struct `False`; empty deinit dropped; @fieldParentPtr field names need keyword-escaping on the Builtin side
// ──────────────────────────────────────────────────────────────────────────
