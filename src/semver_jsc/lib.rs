#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! JSC bridge for `bun_semver`. Keeps `src/semver/` free of JSC types.

// ──────────────────────────────────────────────────────────────────────────
// B-2 local JSC stub surface
//
// `bun_jsc` is currently red (its dep `bun_css` fails E0119), so it is dropped
// from Cargo.toml and the handful of JSC types/methods this crate touches are
// stubbed locally as opaque newtypes + `todo!()` method shells — same pattern
// as `bun_logger_jsc`. Function bodies are now un-gated and type-check against
// these stubs, so the `bun_semver` / `bun_string` calls are verified for real.
// Swapping to `use bun_jsc::{..}` once that crate is green is mechanical: the
// stub signatures mirror the real ones in `src/jsc/{JSValue,JSString,..}.rs`.
// ──────────────────────────────────────────────────────────────────────────
pub mod jsc_stub {
    use bun_string::{ZigString, ZigStringSlice};

    // TODO(b2-blocked): bun_jsc::JSGlobalObject
    #[repr(transparent)]
    pub struct JSGlobalObject(pub usize);
    // TODO(b2-blocked): bun_jsc::JSValue
    #[repr(transparent)]
    #[derive(Clone, Copy, Debug, Default)]
    pub struct JSValue(pub usize);
    // TODO(b2-blocked): bun_jsc::CallFrame
    #[repr(transparent)]
    pub struct CallFrame(pub usize);
    // TODO(b2-blocked): bun_jsc::JSFunction
    #[repr(transparent)]
    pub struct JSFunction(pub usize);
    // TODO(b2-blocked): bun_jsc::JSString
    #[repr(transparent)]
    pub struct JSString(pub usize);
    // TODO(b2-blocked): bun_jsc::JsResult
    pub type JsResult<T> = core::result::Result<T, JSValue>;

    /// Mirrors `bun_jsc::CallFrame::Arguments<N>` — fixed-size copy of the
    /// first N call-frame argument slots plus the actual length.
    pub struct Arguments<const N: usize> {
        pub ptr: [JSValue; N],
        pub len: usize,
    }
    impl<const N: usize> Arguments<N> {
        #[inline]
        pub fn slice(&self) -> &[JSValue] {
            &self.ptr[..self.len.min(N)]
        }
    }

    /// Mirrors `bun_jsc::JSFunction::CreateOptions` (`.{}` in Zig).
    #[derive(Default)]
    pub struct CreateOptions;

    /// Host-function signature `bun_jsc::host_fn` expands to.
    pub type HostFn = fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

    impl JSGlobalObject {
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw
        #[cold]
        pub fn throw<T>(&self, _args: core::fmt::Arguments<'_>) -> JsResult<T> {
            todo!("jsc_stub: JSGlobalObject::throw — blocked on bun_jsc")
        }
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_out_of_memory
        #[cold]
        pub fn throw_out_of_memory<T>(&self) -> JsResult<T> {
            todo!("jsc_stub: JSGlobalObject::throw_out_of_memory — blocked on bun_jsc")
        }
    }

    impl JSValue {
        // TODO(b2-blocked): bun_jsc::JSValue::FALSE
        pub const FALSE: JSValue = JSValue(0x6);

        // TODO(b2-blocked): bun_jsc::JSValue::create_empty_object
        pub fn create_empty_object(_global: &JSGlobalObject, _len: usize) -> JSValue {
            todo!("jsc_stub: JSValue::create_empty_object — blocked on bun_jsc")
        }
        // TODO(b2-blocked): bun_jsc::JSValue::put
        pub fn put(self, _global: &JSGlobalObject, _key: ZigString, _value: JSValue) {
            todo!("jsc_stub: JSValue::put — blocked on bun_jsc")
        }
        // TODO(b2-blocked): bun_jsc::JSValue::js_number
        #[inline]
        pub fn js_number(_n: i32) -> JSValue {
            todo!("jsc_stub: JSValue::js_number — blocked on bun_jsc")
        }
        // TODO(b2-blocked): bun_jsc::JSValue::js_boolean
        #[inline]
        pub fn js_boolean(_b: bool) -> JSValue {
            todo!("jsc_stub: JSValue::js_boolean — blocked on bun_jsc")
        }
        // TODO(b2-blocked): bun_jsc::JSValue::to_js_string
        pub fn to_js_string(self, _global: &JSGlobalObject) -> JsResult<JSString> {
            todo!("jsc_stub: JSValue::to_js_string — blocked on bun_jsc")
        }
    }

    impl JSString {
        // TODO(b2-blocked): bun_jsc::JSString::to_slice
        pub fn to_slice(&self, _global: &JSGlobalObject) -> ZigStringSlice {
            todo!("jsc_stub: JSString::to_slice — blocked on bun_jsc")
        }
    }

    impl JSFunction {
        // TODO(b2-blocked): bun_jsc::JSFunction::create
        pub fn create(
            _global: &JSGlobalObject,
            _name: &str,
            _f: HostFn,
            _arity: u32,
            _opts: CreateOptions,
        ) -> JSValue {
            todo!("jsc_stub: JSFunction::create — blocked on bun_jsc")
        }
    }

    impl CallFrame {
        // TODO(b2-blocked): bun_jsc::CallFrame::arguments_old
        pub fn arguments_old<const N: usize>(&self) -> Arguments<N> {
            todo!("jsc_stub: CallFrame::arguments_old — blocked on bun_jsc")
        }
    }

    // TODO(b2-blocked): bun_jsc::bun_string_jsc
    pub mod bun_string_jsc {
        use super::{JSGlobalObject, JSValue, JsResult};
        // TODO(b2-blocked): bun_jsc::bun_string_jsc::create_utf8_for_js
        pub fn create_utf8_for_js(_global: &JSGlobalObject, _utf8: &[u8]) -> JsResult<JSValue> {
            todo!("jsc_stub: bun_string_jsc::create_utf8_for_js — blocked on bun_jsc")
        }
    }
}
pub use jsc_stub::JsResult;

#[path = "SemverString_jsc.rs"]
pub mod SemverString_jsc;
#[path = "SemverObject.rs"]
pub mod SemverObject;

pub use SemverString_jsc::SemverStringJsc;
