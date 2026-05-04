//! JS testing/debugging bindings for the crash handler. Keeps
//! `src/crash_handler/` free of JSC types.

use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, ZigString};
use bun_str::String as BunString;
use bun_collections::BoundedArray;
use bun_core::{Global, Environment};
use bun_crash_handler as crash_handler;
use bun_analytics as analytics;

pub mod js_bindings {
    use super::*;

    pub fn generate(global: &JSGlobalObject) -> JSValue {
        let obj = JSValue::create_empty_object(global, 8);
        // PORT NOTE: `inline for` over homogeneous (name, host_fn) tuples → const array + plain `for`.
        // TODO(port): `#[bun_jsc::host_fn]` emits the raw `JSHostFn` shim; confirm how to reference
        // it as a value here (assumed: the decorated fn name coerces to `bun_jsc::JSHostFn`).
        const ENTRIES: &[(&str, bun_jsc::JSHostFn)] = &[
            ("getMachOImageZeroOffset", js_get_mach_o_image_zero_offset),
            ("getFeaturesAsVLQ", js_get_features_as_vlq),
            ("getFeatureData", js_get_feature_data),
            ("segfault", js_segfault),
            ("panic", js_panic),
            ("rootError", js_root_error),
            ("outOfMemory", js_out_of_memory),
            ("raiseIgnoringPanicHandler", js_raise_ignoring_panic_handler),
        ];
        for &(name_str, func) in ENTRIES {
            let name = ZigString::static_(name_str);
            obj.put(
                global,
                name,
                JSFunction::create(global, name_str, func, 1, Default::default()),
            );
        }
        obj
    }

    #[bun_jsc::host_fn]
    pub fn js_get_mach_o_image_zero_offset(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        #[cfg(not(target_os = "macos"))]
        {
            return Ok(JSValue::UNDEFINED);
        }
        #[cfg(target_os = "macos")]
        {
            // TODO(port): move to bun_sys::darwin
            unsafe extern "C" {
                fn _dyld_get_image_header(image_index: u32) -> *const core::ffi::c_void;
                fn _dyld_get_image_vmaddr_slide(image_index: u32) -> isize;
            }
            // SAFETY: dyld APIs are safe to call with index 0 (the main executable).
            let header = unsafe { _dyld_get_image_header(0) };
            if header.is_null() {
                return Ok(JSValue::UNDEFINED);
            }
            let base_address = header as usize;
            // SAFETY: same as above.
            let vmaddr_slide = unsafe { _dyld_get_image_vmaddr_slide(0) } as usize;

            Ok(JSValue::js_number(base_address - vmaddr_slide))
        }
    }

    #[bun_jsc::host_fn]
    pub fn js_segfault(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        // Zig: @setRuntimeSafety(false) — Rust has no per-fn equivalent; the raw-ptr write below
        // is already unchecked inside `unsafe`.
        crash_handler::suppress_core_dumps_if_necessary();
        // SAFETY: intentionally dereferencing an invalid address to trigger SIGSEGV for testing.
        unsafe {
            let ptr = 0xDEADBEEFusize as *mut u64;
            core::ptr::write_unaligned(ptr, 0xDEADBEEF);
            core::hint::black_box(ptr);
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub fn js_panic(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        crash_handler::suppress_core_dumps_if_necessary();
        crash_handler::panic_impl("invoked crashByPanic() handler", None, None);
    }

    #[bun_jsc::host_fn]
    pub fn js_root_error(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        crash_handler::handle_root_error(bun_core::err!("Test"), None);
    }

    #[bun_jsc::host_fn]
    pub fn js_out_of_memory(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        crash_handler::suppress_core_dumps_if_necessary();
        bun_core::out_of_memory();
    }

    #[bun_jsc::host_fn]
    pub fn js_raise_ignoring_panic_handler(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        crash_handler::suppress_core_dumps_if_necessary();
        Global::raise_ignoring_panic_handler(bun_core::Signal::SIGSEGV);
    }

    #[bun_jsc::host_fn]
    pub fn js_get_features_as_vlq(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let bits = analytics::packed_features();
        let mut buf = BoundedArray::<u8, 16>::default();
        // SAFETY: `bits` is a packed-struct(u64); bitcast to u64.
        let bits_u64: u64 = unsafe { core::mem::transmute(bits) };
        crash_handler::write_u64_as_two_vlqs(buf.writer(), bits_u64)
            // there is definitely enough space in the bounded array
            .expect("unreachable");
        let mut str = BunString::clone_latin1(buf.slice());
        Ok(str.transfer_to_js(global))
    }

    #[bun_jsc::host_fn]
    pub fn js_get_feature_data(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object(global, 5);
        let list = analytics::PACKED_FEATURES_LIST;
        let array = JSValue::create_empty_array(global, list.len())?;
        for (i, feature) in list.iter().enumerate() {
            array.put_index(
                global,
                u32::try_from(i).unwrap(),
                BunString::static_(feature).to_js(global)?,
            )?;
        }
        obj.put(global, ZigString::static_("features"), array);
        obj.put(
            global,
            ZigString::static_("version"),
            BunString::init(Global::PACKAGE_JSON_VERSION).to_js(global)?,
        );
        obj.put(
            global,
            ZigString::static_("is_canary"),
            JSValue::from(Environment::IS_CANARY),
        );

        // This is the source of truth for the git sha.
        // Not the github ref or the git tag.
        obj.put(
            global,
            ZigString::static_("revision"),
            BunString::init(Environment::GIT_SHA).to_js(global)?,
        );

        obj.put(
            global,
            ZigString::static_("generated_at"),
            JSValue::js_number_from_int64(milli_timestamp().max(0)),
        );
        Ok(obj)
    }

    // TODO(port): replace with `bun_core::time::milli_timestamp()` if one exists; std::time is
    // permitted (only std::{fs,net,process} are banned).
    fn milli_timestamp() -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(d) => i64::try_from(d.as_millis()).unwrap_or(i64::MAX),
            Err(_) => 0,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/crash_handler_jsc.zig (99 lines)
//   confidence: medium
//   todos:      3
//   notes:      host_fn array in generate() assumes #[host_fn] fns coerce to JSHostFn; diverging fns (panic/root_error/oom/raise) rely on `!` coercion to JsResult<JSValue>
// ──────────────────────────────────────────────────────────────────────────
