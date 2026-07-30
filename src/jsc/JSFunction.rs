use bun_core::{String as BunString, ZigString};

use crate::{JSGlobalObject, JSHostFn, JSValue};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `JSC::JSFunction`.
    pub struct JSFunction;
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
// Non-exhaustive — any u8 is a valid bit pattern, so a Rust `#[repr(u8)]`
// enum would be UB for unknown values. Use a newtype.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Intrinsic(u8);

impl Intrinsic {
    const NONE: Intrinsic = Intrinsic(0);
}

impl Default for Intrinsic {
    fn default() -> Self {
        Intrinsic::NONE
    }
}

#[derive(Copy, Clone, Default)]
pub struct CreateJSFunctionOptions {
    pub implementation_visibility: ImplementationVisibility,
    pub intrinsic: Intrinsic,
    pub constructor: Option<JSHostFn>,
}

// `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle; the remaining
// params are by-value scalars / `#[repr(C)]` PODs / fn-ptrs, so all three
// shims are declared `safe fn`. `getSourceCode` writes a `ZigString` view into
// the `&mut` out-param on success and leaves it untouched on failure — `&mut
// ZigString` is ABI-identical to a non-null `*mut ZigString`.
unsafe extern "C" {
    safe fn JSFunction__createFromZig(
        global: &JSGlobalObject,
        fn_name: BunString,
        implementation: JSHostFn,
        arg_count: u32,
        implementation_visibility: ImplementationVisibility,
        intrinsic: Intrinsic,
        constructor: Option<JSHostFn>,
    ) -> JSValue;

    safe fn JSC__JSFunction__getSourceCode(value: JSValue, out: &mut ZigString) -> bool;
}

impl JSFunction {
    pub fn create(
        global: &JSGlobalObject,
        fn_name: impl Into<BunString>,
        implementation: JSHostFn,
        function_length: u32,
        options: CreateJSFunctionOptions,
    ) -> JSValue {
        JSFunction__createFromZig(
            global,
            fn_name.into(),
            implementation,
            function_length,
            options.implementation_visibility,
            options.intrinsic,
            options.constructor,
        )
    }

    pub fn get_source_code(value: JSValue) -> Option<BunString> {
        let mut str = ZigString::EMPTY;
        // C++ overwrites `str` on success and leaves it untouched on failure.
        if JSC__JSFunction__getSourceCode(value, &mut str) {
            Some(BunString::init(str))
        } else {
            None
        }
    }
}
