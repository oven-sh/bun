//! JSC bridge for `bun.sys.Error`. Keeps `src/sys/` free of JSC types.

use bun_sys::Error;

use crate::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, SystemErrorJsc};

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

// `TestingAPIs` is a module (not `struct + impl`) because `#[bun_jsc::host_fn]`'s
// Free-kind shim emits `#fn_name(__g, __f)` without a `Self::` qualifier — the
// wrapped fn must resolve unqualified at module scope (same constraint as
// `install_jsc::install_binding::js_parse_lockfile`).
pub mod TestingAPIs {
    use super::*;

    /// Exercises Error.name() with from_libuv=true so tests can feed
    /// negated-UV-code errno values and verify the integer overflow at
    /// translateUVErrorToE(-code) is fixed. Windows-only.
    #[bun_jsc::host_fn]
    pub fn sys_error_name_from_libuv(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = frame.arguments();
        if arguments.is_empty() || !arguments[0].is_number() {
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
                // Checked narrowing into Error.errno's int type.
                errno: arguments[0]
                    .to_int32()
                    .try_into()
                    .expect("infallible: size matches"),
                syscall: bun_sys::Tag::open,
                from_libuv: true,
                ..Default::default()
            };
            return bun_jsc::bun_string_jsc::create_utf8_for_js(global, err.name());
        }
    }

    /// Exposes NTSTATUS -> `bun.sys.E` translation so tests can feed NTSTATUS
    /// values that filter drivers and cloud-sync placeholders return in the
    /// wild (STATUS_CANNOT_DELETE etc.) and verify they map to a sensible
    /// errno rather than `UNKNOWN`. Windows-only; returns `undefined` elsewhere.
    #[bun_jsc::host_fn]
    pub fn translate_nt_status_to_e(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = frame.arguments();
        if arguments.is_empty() || !arguments[0].is_number() {
            return Err(global.throw(format_args!(
                "translateNtStatusToE: expected 1 number argument"
            )));
        }
        #[cfg(not(windows))]
        {
            return Ok(JSValue::UNDEFINED);
        }
        #[cfg(windows)]
        {
            let raw: u32 = arguments[0].to_u32();
            let status = bun_sys::windows::NTSTATUS::from_raw(raw);
            let result = bun_sys::windows::translate_nt_status_to_errno(status);
            return bun_jsc::bun_string_jsc::create_utf8_for_js(
                global,
                <&'static str>::from(result).as_bytes(),
            );
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
        if arguments.is_empty() || !arguments[0].is_number() {
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
            let result = bun_sys::windows::translate_uv_error_to_e(code);
            // @tagName(result) → IntoStaticStr derive on the E enum.
            return bun_jsc::bun_string_jsc::create_utf8_for_js(
                global,
                <&'static str>::from(result).as_bytes(),
            );
        }
    }
}
