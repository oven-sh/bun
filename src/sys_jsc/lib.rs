#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ──────────────────────────────────────────────────────────────────────────
// B-1 gate-and-stub: Phase-A draft modules are preserved on disk but gated
// behind `#[cfg(any())]` because dependency `bun_jsc` does not yet compile
// (254 errors). Minimal stub surface is exposed below so downstream crates
// can `use bun_sys_jsc::*`. Un-gate in B-2 once bun_jsc is green.
// TODO(b1): bun_jsc::{JSGlobalObject, JSValue, JSPromise, JsResult, CallFrame, SystemError, RangeErrorOptions, host_fn} missing
// ──────────────────────────────────────────────────────────────────────────

#[cfg(any())]
pub mod signal_code_jsc;
#[cfg(any())]
pub mod error_jsc;
#[cfg(any())]
pub mod fd_jsc;

// ───── stub surface ───────────────────────────────────────────────────────

/// Opaque stand-in for `bun_jsc::JSGlobalObject` while bun_jsc is gated.
pub struct JSGlobalObject(());
/// Opaque stand-in for `bun_jsc::JSValue` while bun_jsc is gated.
pub struct JSValue(());
/// Opaque stand-in for `bun_jsc::JSPromise` while bun_jsc is gated.
pub struct JSPromise(());
/// Opaque stand-in for `bun_jsc::CallFrame` while bun_jsc is gated.
pub struct CallFrame(());
/// Stand-in for `bun_jsc::JsResult<T>` while bun_jsc is gated.
pub type JsResult<T> = Result<T, ()>;

pub mod signal_code_jsc {
    use super::*;
    // TODO(b1): bun_sys::SignalCode missing from stub surface
    pub struct SignalCode(pub u8);
    pub fn from_js(_arg: JSValue, _global_this: &JSGlobalObject) -> JsResult<SignalCode> {
        todo!("gated: bun_jsc unavailable")
    }
}

pub mod error_jsc {
    use super::*;
    pub trait ErrorJsc {
        fn to_js(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
            todo!("gated: bun_jsc unavailable")
        }
        fn to_js_with_async_stack(
            &self,
            _global: &JSGlobalObject,
            _promise: &JSPromise,
        ) -> JsResult<JSValue> {
            todo!("gated: bun_jsc unavailable")
        }
    }
    impl ErrorJsc for bun_sys::Error {}

    pub struct TestingAPIs;
    impl TestingAPIs {
        pub fn sys_error_name_from_libuv(
            _global: &JSGlobalObject,
            _frame: &CallFrame,
        ) -> JsResult<JSValue> {
            todo!("gated: bun_jsc unavailable")
        }
        pub fn translate_uv_error_to_e(
            _global: &JSGlobalObject,
            _frame: &CallFrame,
        ) -> JsResult<JSValue> {
            todo!("gated: bun_jsc unavailable")
        }
    }
}

pub mod fd_jsc {
    use super::*;
    pub trait FdJsc: Sized {
        fn from_js(_value: JSValue) -> Option<Self> {
            todo!("gated: bun_jsc unavailable")
        }
        fn from_js_validated(_value: JSValue, _global: &JSGlobalObject) -> JsResult<Option<Self>> {
            todo!("gated: bun_jsc unavailable")
        }
        fn to_js(self, _global: &JSGlobalObject) -> JSValue {
            todo!("gated: bun_jsc unavailable")
        }
        fn to_js_without_making_lib_uv_owned(self) -> JSValue {
            todo!("gated: bun_jsc unavailable")
        }
    }
    impl FdJsc for bun_sys::Fd {}
}
