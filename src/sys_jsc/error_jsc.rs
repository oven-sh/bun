//! JSC bridge for `bun.sys.Error`. Keeps `src/sys/` free of JSC types.

use core::ffi::c_int;

use bun_jsc::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult};
use bun_sys::Error;

// PORT NOTE: In Rust, `to_js`/`from_js` live as extension-trait methods in the
// `*_jsc` crate (per PORTING.md). The Zig free fns `toJS`/`toJSWithAsyncStack`
// become methods on this trait, impl'd for `bun_sys::Error`.
pub trait ErrorJsc {
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue>;

    /// Like `to_js` but populates the error's stack trace with async frames from the
    /// given promise's await chain. Use when rejecting a promise from native code
    /// at the top of the event loop (threadpool callback) — otherwise the error
    /// will have an empty stack trace.
    fn to_js_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JsResult<JSValue>;
}

impl ErrorJsc for Error {
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // TODO(port): `to_system_error()` lives on `bun_sys::Error`; `to_error_instance`
        // is the JSC ext-trait method on `SystemError` (crate path TBD in Phase B).
        self.to_system_error().to_error_instance(global)
    }

    fn to_js_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JsResult<JSValue> {
        self.to_system_error()
            .to_error_instance_with_async_stack(global, promise)
    }
}

pub struct TestingAPIs;

impl TestingAPIs {
    /// Exercises Error.name() with from_libuv=true so tests can feed the
    /// negated-UV-code errno values that node_fs.zig stores and verify the
    /// integer overflow at translateUVErrorToE(-code) is fixed. Windows-only.
    #[bun_jsc::host_fn]
    pub fn sys_error_name_from_libuv(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = frame.arguments();
        if arguments.len() < 1 || !arguments[0].is_number() {
            return global.throw("sysErrorNameFromLibuv: expected 1 number argument");
        }
        #[cfg(not(windows))]
        {
            return Ok(JSValue::UNDEFINED);
        }
        #[cfg(windows)]
        {
            let err = Error {
                // @intCast → checked narrowing; target is Error.errno's int type.
                errno: arguments[0].to_int32().try_into().unwrap(),
                // TODO(port): exact enum path for syscall tag (`.open`).
                syscall: bun_sys::Syscall::open,
                from_libuv: true,
                ..Default::default()
            };
            // TODO(port): `create_utf8_for_js` is the JSC-side helper on bun_str::String.
            return bun_str::String::create_utf8_for_js(global, err.name());
        }
    }

    /// Exposes libuv -> `bun.sys.E` translation so tests can feed out-of-range
    /// negative values and verify it does not panic. Windows-only.
    #[bun_jsc::host_fn]
    pub fn translate_uv_error_to_e(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = frame.arguments();
        if arguments.len() < 1 || !arguments[0].is_number() {
            return global.throw("translateUVErrorToE: expected 1 number argument");
        }
        #[cfg(not(windows))]
        {
            return Ok(JSValue::UNDEFINED);
        }
        #[cfg(windows)]
        {
            let code: c_int = arguments[0].to_int32();
            let result = bun_sys::windows::libuv::translate_uv_error_to_e(code);
            // @tagName(result) → IntoStaticStr derive on the E enum.
            return bun_str::String::create_utf8_for_js(global, <&'static str>::from(result));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys_jsc/error_jsc.zig (54 lines)
//   confidence: medium
//   todos:      3
//   notes:      ext-trait pattern for Error.to_js; SystemError/create_utf8_for_js import paths need Phase-B wiring; cfg(windows) gates libuv-only fields.
// ──────────────────────────────────────────────────────────────────────────
