//! JSC bridge for `bun.sys.Error`. Keeps `src/sys/` free of JSC types.

use core::ffi::c_int;

use bun_sys::Error;

use crate::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult};

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
        #[cfg(any())]
        // TODO(b2-blocked): bun_jsc::SystemError::to_error_instance
        {
            return self.to_system_error().to_error_instance(global);
        }
        let _ = (self.to_system_error(), global);
        todo!("b2-blocked: bun_jsc::SystemError::to_error_instance")
    }

    fn to_js_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JsResult<JSValue> {
        #[cfg(any())]
        // TODO(b2-blocked): bun_jsc::SystemError::to_error_instance_with_async_stack
        {
            return self
                .to_system_error()
                .to_error_instance_with_async_stack(global, promise);
        }
        let _ = (self.to_system_error(), global, promise);
        todo!("b2-blocked: bun_jsc::SystemError::to_error_instance_with_async_stack")
    }
}

pub struct TestingAPIs;

impl TestingAPIs {
    /// Exercises Error.name() with from_libuv=true so tests can feed the
    /// negated-UV-code errno values that node_fs.zig stores and verify the
    /// integer overflow at translateUVErrorToE(-code) is fixed. Windows-only.
    // TODO(b2-blocked): bun_jsc::host_fn — #[bun_jsc::host_fn] attribute macro not yet exported
    pub fn sys_error_name_from_libuv(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        #[cfg(any())]
        // TODO(b2-blocked): bun_jsc::CallFrame::arguments
        // TODO(b2-blocked): bun_jsc::JSValue::{is_number,to_int32,UNDEFINED}
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw
        {
            let arguments = frame.arguments();
            if arguments.len() < 1 || !arguments[0].is_number() {
                return Err(global.throw("sysErrorNameFromLibuv: expected 1 number argument"));
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
                return bun_string::String::create_utf8_for_js(global, err.name());
            }
        }
        let _ = (global, frame);
        todo!("b2-blocked: bun_jsc CallFrame/JSValue/JSGlobalObject methods unavailable")
    }

    /// Exposes libuv -> `bun.sys.E` translation so tests can feed out-of-range
    /// negative values and verify it does not panic. Windows-only.
    // TODO(b2-blocked): bun_jsc::host_fn — #[bun_jsc::host_fn] attribute macro not yet exported
    pub fn translate_uv_error_to_e(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        #[cfg(any())]
        // TODO(b2-blocked): bun_jsc::CallFrame::arguments
        // TODO(b2-blocked): bun_jsc::JSValue::{is_number,to_int32,UNDEFINED}
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw
        // TODO(b2-blocked): bun_sys::windows::libuv::translate_uv_error_to_e
        {
            let arguments = frame.arguments();
            if arguments.len() < 1 || !arguments[0].is_number() {
                return Err(global.throw("translateUVErrorToE: expected 1 number argument"));
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
                return bun_string::String::create_utf8_for_js(global, <&'static str>::from(result));
            }
        }
        let _ = (global, frame);
        todo!("b2-blocked: bun_jsc CallFrame/JSValue/JSGlobalObject methods unavailable")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys_jsc/error_jsc.zig (54 lines)
//   confidence: medium (bodies gated on bun_jsc stub surface)
//   blocked:    bun_jsc::{SystemError methods, CallFrame::arguments, host_fn macro,
//               JSValue::{is_number,to_int32,UNDEFINED}, JSGlobalObject::throw}
// ──────────────────────────────────────────────────────────────────────────
