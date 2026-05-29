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

#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Intrinsic(u8);

impl Intrinsic {
    pub(crate) const NONE: Intrinsic = Intrinsic(0);
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

    pub(crate) safe fn JSC__JSFunction__optimizeSoon(value: JSValue);

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

    pub fn optimize_soon(value: JSValue) {
        JSC__JSFunction__optimizeSoon(value)
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

// ported from: src/jsc/JSFunction.zig
