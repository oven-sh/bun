//! Hand-ported surface of `src/codegen/bindgen.ts` output
//! (source: src/jsc/bindings/GeneratedBindings.zig — bindgen dispatch shims).
//!
//! Until the generator grows a `.rs` backend, the modules required by
//! downstream Rust callers are ported here by hand. Each `create_*_callback`
//! is a thin wrapper over `host_fn::new_runtime_function` binding a C++-side
//! `JSHostFn` (the `bindgen_*_js*` symbols emitted by the C++ dispatch shim)
//! to a named JS function value.

#![allow(non_snake_case)]

use crate::{JSGlobalObject, JSHostFn, JSValue, host_fn, zig_string};

/// Generated for "src/jsc/bindgen_test.zig"
pub mod bindgen_test {
    use super::*;

    crate::jsc_abi_extern! {
        #[link_name = "bindgen_Bindgen_test_jsAdd"]
        fn jsAdd(global: *mut JSGlobalObject, frame: *mut crate::CallFrame) -> JSValue;
        #[link_name = "bindgen_Bindgen_test_jsRequiredAndOptionalArg"]
        fn jsRequiredAndOptionalArg(global: *mut JSGlobalObject, frame: *mut crate::CallFrame) -> JSValue;
    }

    pub const JS_ADD: JSHostFn = jsAdd;
    pub const JS_REQUIRED_AND_OPTIONAL_ARG: JSHostFn = jsRequiredAndOptionalArg;

    pub fn create_add_callback(global: &JSGlobalObject) -> JSValue {
        host_fn::new_runtime_function(
            global,
            Some(&zig_string::static_(b"add")),
            3,
            JS_ADD,
            false,
            None,
        )
    }

    pub fn create_required_and_optional_arg_callback(global: &JSGlobalObject) -> JSValue {
        host_fn::new_runtime_function(
            global,
            Some(&zig_string::static_(b"requiredAndOptionalArg")),
            4,
            JS_REQUIRED_AND_OPTIONAL_ARG,
            false,
            None,
        )
    }
}

// ported from: src/jsc/bindings/GeneratedBindings.zig
