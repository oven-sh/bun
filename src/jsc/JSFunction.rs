use core::marker::{PhantomData, PhantomPinned};
use core::mem::MaybeUninit;

use bun_str::{String as BunString, ZigString};

use crate::{JSGlobalObject, JSHostFn, JSValue};

/// Opaque FFI handle for `JSC::JSFunction`.
#[repr(C)]
pub struct JSFunction {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub enum ImplementationVisibility {
    #[default]
    Public = 0,
    Private = 1,
    PrivateRecursive = 2,
}

/// In WebKit: Intrinsic.h
//
// Zig: `enum(u8) { none, _ }` — non-exhaustive; any u8 is a valid bit pattern,
// so a Rust `#[repr(u8)] enum` would be UB for unknown values. Use a newtype.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Intrinsic(u8);

impl Intrinsic {
    pub const NONE: Intrinsic = Intrinsic(0);
}

impl Default for Intrinsic {
    fn default() -> Self {
        Intrinsic::NONE
    }
}

#[derive(Default)]
pub struct CreateJSFunctionOptions {
    pub implementation_visibility: ImplementationVisibility,
    pub intrinsic: Intrinsic,
    pub constructor: Option<JSHostFn>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSFunction__createFromZig(
        global: *mut JSGlobalObject,
        fn_name: BunString,
        implementation: JSHostFn,
        arg_count: u32,
        implementation_visibility: ImplementationVisibility,
        intrinsic: Intrinsic,
        constructor: Option<JSHostFn>,
    ) -> JSValue;

    pub fn JSC__JSFunction__optimizeSoon(value: JSValue);

    fn JSC__JSFunction__getSourceCode(value: JSValue, out: *mut ZigString) -> bool;
}

impl JSFunction {
    // TODO(port): Zig accepted `implementation` as either `JSHostFnZig` (safe) or
    // `JSHostFn` (raw ABI) via comptime `@TypeOf` dispatch, calling `jsc.toJSHostFn`
    // for the safe form. In Rust, callers produce a `JSHostFn` via `#[bun_jsc::host_fn]`,
    // so we take the raw fn pointer type directly.
    pub fn create(
        global: &JSGlobalObject,
        fn_name: impl Into<BunString>,
        implementation: JSHostFn,
        function_length: u32,
        options: CreateJSFunctionOptions,
    ) -> JSValue {
        // SAFETY: `global` is a valid live JSGlobalObject for the duration of the call;
        // the FFI side does not retain the raw pointer past return.
        unsafe {
            JSFunction__createFromZig(
                global as *const JSGlobalObject as *mut JSGlobalObject,
                fn_name.into(),
                implementation,
                function_length,
                options.implementation_visibility,
                options.intrinsic,
                options.constructor,
            )
        }
    }

    pub fn optimize_soon(value: JSValue) {
        // SAFETY: trivial FFI wrapper; `JSValue` is `Copy` and passed by value.
        unsafe { JSC__JSFunction__optimizeSoon(value) }
    }

    pub fn get_source_code(value: JSValue) -> Option<BunString> {
        let mut str = MaybeUninit::<ZigString>::uninit();
        // SAFETY: `JSC__JSFunction__getSourceCode` writes to `*out` and returns true on
        // success; on false, `out` is left untouched and we never read it.
        if unsafe { JSC__JSFunction__getSourceCode(value, str.as_mut_ptr()) } {
            // SAFETY: initialized by the FFI call above (returned true).
            Some(BunString::init(unsafe { str.assume_init() }))
        } else {
            None
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSFunction.zig (75 lines)
//   confidence: medium
//   todos:      2
//   notes:      collapsed comptime @TypeOf dispatch in `create` to take JSHostFn directly; fn_name via Into<BunString>
// ──────────────────────────────────────────────────────────────────────────
