use bun_core::String as BunString;

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
// params are by-value scalars / `#[repr(C)]` PODs / fn-ptrs, so both shims are
// declared `safe fn`. `getSourceCode` writes a +1 `String` into the `&mut`
// out-param on success and leaves it untouched on failure.
unsafe extern "C" {
    safe fn JSFunction__createFromZig(
        global: &JSGlobalObject,
        fn_name: &BunString,
        implementation: JSHostFn,
        arg_count: u32,
        implementation_visibility: ImplementationVisibility,
        intrinsic: Intrinsic,
        constructor: Option<JSHostFn>,
    ) -> JSValue;

    safe fn JSC__JSFunction__getSourceCode(value: JSValue, out: &mut BunString) -> bool;
}

impl JSFunction {
    pub fn create(
        global: &JSGlobalObject,
        fn_name: &'static str,
        implementation: JSHostFn,
        function_length: u32,
        options: CreateJSFunctionOptions,
    ) -> JSValue {
        JSFunction__createFromZig(
            global,
            &BunString::static_(fn_name),
            implementation,
            function_length,
            options.implementation_visibility,
            options.intrinsic,
            options.constructor,
        )
    }

    /// A copy of the function's source text; `None` for native functions.
    pub fn get_source_code(value: JSValue) -> Option<BunString> {
        let mut str = BunString::EMPTY;
        JSC__JSFunction__getSourceCode(value, &mut str).then_some(str)
    }
}
