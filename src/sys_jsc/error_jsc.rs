//! JSC bridge for `bun.sys.Error`. Keeps `src/sys/` free of JSC types.

use bun_sys::Error;

use crate::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, SystemErrorJsc};

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
        Ok(self.to_system_error().to_error_instance(global))
    }

    fn to_js_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JsResult<JSValue> {
        Ok(self
            .to_system_error()
            .to_error_instance_with_async_stack(global, promise))
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
            return Err(global.throw(format_args!(
                "sysErrorNameFromLibuv: expected 1 number argument"
            )));
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
                syscall: bun_sys::Tag::open,
                from_libuv: true,
                ..Default::default()
            };
            return bun_jsc::bun_string_jsc::create_utf8_for_js(global, err.name());
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
            return Err(global.throw(format_args!(
                "translateUVErrorToE: expected 1 number argument"
            )));
        }
        #[cfg(not(windows))]
        {
            return Ok(JSValue::UNDEFINED);
        }
        #[cfg(windows)]
        {
            let code: core::ffi::c_int = arguments[0].to_int32();
            let result = bun_sys::windows::libuv::translate_uv_error_to_e(code);
            // @tagName(result) → IntoStaticStr derive on the E enum.
            return bun_jsc::bun_string_jsc::create_utf8_for_js(
                global,
                <&'static str>::from(result).as_bytes(),
            );
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys_jsc/error_jsc.zig (54 lines)
//   confidence: high
//   todos:      0
//   notes:      Windows arms remain unchecked on posix builds (cfg-gated).
// ──────────────────────────────────────────────────────────────────────────
