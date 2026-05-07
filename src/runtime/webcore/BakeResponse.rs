use core::ffi::{c_int, c_void};

use bun_jsc::{CallFrame, HTTPHeaderName, JSGlobalObject, JSValue, JsError, JsResult};
use crate::webcore::Response;
use crate::webcore::response::{HeadersRef, Init};
use bun_str::String as BunString;

pub fn fix_dead_code_elimination() {
    core::hint::black_box(BakeResponseClass__constructForSSR as *const ());
    core::hint::black_box(BakeResponseClass__constructRender as *const ());
}

// TODO(port): callconv(jsc.conv) — Rust cannot express the JSC ABI in `extern` position;
// Phase B should route this through a bun_jsc shim or verify "C" matches on all targets.
// `Response` embeds `Body` (no #[repr(C)]) but is only ever passed by opaque pointer across FFI.
#[allow(improper_ctypes)]
unsafe extern "C" {
    fn BakeResponse__createForSSR(
        global_object: *mut JSGlobalObject,
        this: *mut Response,
        kind: u8,
    ) -> JSValue;
}

/// Corresponds to `JSBakeResponseKind` in
/// `src/jsc/bindings/JSBakeResponse.h`
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum SSRKind {
    Regular = 0,
    Redirect = 1,
    Render = 2,
}

/// Create the JS `BakeResponse` wrapper for `this`. The C++ wrapper **adopts**
/// the `*mut Response` allocation (freed in `BakeResponseClass__finalize`), so
/// callers must hand over a heap pointer they no longer own — typically via
/// `Box::into_raw`.
///
/// # Safety
/// `this` must be a valid heap-allocated `Response` whose ownership is being
/// transferred to the JS GC. After this call the caller must not free or
/// dereference `this`.
pub unsafe fn to_js_for_ssr(this: *mut Response, global_object: &JSGlobalObject, kind: SSRKind) -> JSValue {
    // SAFETY: caller contract — `this` is a valid exclusive heap allocation.
    unsafe { &mut *this }.calculate_estimated_byte_size();
    // SAFETY: `global_object` wraps `UnsafeCell`, so `as_mut_ptr()` yields a
    // `*mut` with write provenance from `&self`; FFI adopts `this`.
    unsafe { BakeResponse__createForSSR(global_object.as_mut_ptr(), this, kind as u8) }
}

// TODO(port): callconv(jsc.conv) — exported with JSC ABI in Zig; verify extern "C" is correct on Windows-x64.
#[unsafe(no_mangle)]
pub extern "C" fn BakeResponseClass__constructForSSR(
    global_object: &JSGlobalObject,
    call_frame: &CallFrame,
    bake_ssr_has_jsx: *mut c_int,
    js_this: JSValue,
) -> *mut c_void {
    // SAFETY: caller (C++) guarantees `bake_ssr_has_jsx` is a valid, exclusive out-pointer for the call.
    let bake_ssr_has_jsx = unsafe { &mut *bake_ssr_has_jsx };
    match constructor(global_object, call_frame, bake_ssr_has_jsx, js_this) {
        Ok(response) => response.cast::<c_void>(),
        Err(JsError::Thrown) => core::ptr::null_mut(),
        Err(JsError::OutOfMemory) => {
            let _ = global_object.throw_out_of_memory();
            core::ptr::null_mut()
        }
        Err(JsError::Terminated) => core::ptr::null_mut(),
    }
}

pub fn constructor(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
    bake_ssr_has_jsx: &mut c_int,
    js_this: JSValue,
) -> JsResult<*mut Response> {
    let arguments: [JSValue; 2] = callframe.arguments_as_array::<2>();

    // Allow `return new Response(<jsx> ... </jsx>, { ... }`
    // inside of a react component
    if !arguments[0].is_undefined_or_null() && arguments[0].is_object() {
        *bake_ssr_has_jsx = 0;
        if arguments[0].is_jsx_element(global_this)? {
            let vm = global_this.bun_vm().as_mut();
            // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
            if let Some(async_local_storage) = unsafe { &mut *vm }.get_dev_server_async_local_storage()? {
                assert_streaming_disabled(
                    global_this,
                    async_local_storage,
                    b"new Response(<jsx />, { ... })",
                )?;
            }
            *bake_ssr_has_jsx = 1;
        }
    }

    Response::constructor(global_this, callframe, js_this)
}

// TODO(port): callconv(jsc.conv) — this is the raw JSHostFn shim that #[bun_jsc::host_fn]
// would emit for `construct_redirect`; Phase B may replace this hand-written export with the macro.
#[unsafe(no_mangle)]
pub extern "C" fn BakeResponseClass__constructRedirect(
    global_object: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JSValue {
    bun_jsc::to_js_host_call(global_object, || construct_redirect(global_object, call_frame))
}

pub fn construct_redirect(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let response = Response::construct_redirect_impl(global_this, callframe)?;
    let response = Box::new(response);

    let vm = global_this.bun_vm().as_mut();
    // Check if dev_server_async_local_storage is set (indicating we're in Bun dev server)
    // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
    if let Some(async_local_storage) = unsafe { &mut *vm }.get_dev_server_async_local_storage()? {
        assert_streaming_disabled(global_this, async_local_storage, b"Response.redirect")?;
        // Ownership of the allocation transfers to the JS wrapper.
        let ptr = Box::into_raw(response);
        // SAFETY: `ptr` is a fresh heap allocation; JS wrapper adopts it.
        return Ok(unsafe { to_js_for_ssr(ptr, global_this, SSRKind::Redirect) });
    }

    // Ownership of the allocation transfers to the JS wrapper (freed in
    // `ResponseClass__finalize`).
    let ptr = Box::into_raw(response);
    // SAFETY: `ptr` is a fresh heap allocation; `Response::to_js` hands it to
    // the C++ wrapper which owns it thereafter.
    Ok(unsafe { &mut *ptr }.to_js(global_this))
}

// TODO(port): callconv(jsc.conv) — see note on BakeResponseClass__constructRedirect.
#[unsafe(no_mangle)]
pub extern "C" fn BakeResponseClass__constructRender(
    global_object: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JSValue {
    // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
    bun_jsc::to_js_host_call(global_object, || construct_render(global_object, call_frame))
}

/// This function is only available on JSBakeResponse
pub fn construct_render(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments: [JSValue; 2] = callframe.arguments_as_array::<2>();
    let vm = global_this.bun_vm().as_mut();

    // Check if dev server async local_storage is set
    // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
    let Some(async_local_storage) = unsafe { &mut *vm }.get_dev_server_async_local_storage()? else {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "Response.render() is only available in the Bun dev server"
        )));
    };

    assert_streaming_disabled(global_this, async_local_storage, b"Response.render")?;

    // Validate arguments
    // PORT NOTE: `arguments` is a fixed [JSValue; 2] so `.len() < 1` is
    // comptime-false in Zig too; kept for structural fidelity.
    #[allow(clippy::len_zero)]
    if arguments.len() < 1 {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "Response.render() requires at least a path argument"
        )));
    }

    let path_arg = arguments[0];
    if !path_arg.is_string() {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "Response.render() path must be a string"
        )));
    }

    // Get the path string
    let path_str = path_arg.to_bun_string(global_this)?;
    // `defer path_str.deref()` → handled by Drop on bun_str::String

    let path_utf8 = path_str.to_utf8();
    // `defer path_utf8.deinit()` → handled by Drop on the UTF-8 slice guard

    // Create a Response with Render body
    let response = Box::new(Response::init(
        Init {
            status_code: 200,
            headers: {
                let mut headers = HeadersRef::create_empty();
                headers.put(HTTPHeaderName::Location, path_utf8.slice(), global_this)?;
                Some(headers)
            },
            ..Default::default()
        },
        crate::webcore::Body { value: crate::webcore::BodyValue::Empty },
        BunString::empty(),
        false,
    ));

    // Ownership of the allocation transfers to the JS wrapper.
    let ptr = Box::into_raw(response);
    // SAFETY: `ptr` is a fresh heap allocation; JS wrapper adopts it.
    let response_js = unsafe { to_js_for_ssr(ptr, global_this, SSRKind::Render) };
    response_js.ensure_still_alive();

    Ok(response_js)
}

fn assert_streaming_disabled(
    global_this: &JSGlobalObject,
    async_local_storage: JSValue,
    display_function: &[u8],
) -> JsResult<()> {
    if async_local_storage.is_empty_or_undefined_or_null() || !async_local_storage.is_object() {
        return Err(
            global_this.throw_invalid_arguments(format_args!("store value must be an object"))
        );
    }
    let Some(get_store_fn) = async_local_storage.get(global_this, b"getStore")?
    else {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "store value must have a \"getStore\" field"
        )));
    };
    if !get_store_fn.is_callable() {
        return Err(
            global_this.throw_invalid_arguments(format_args!("\"getStore\" must be a function"))
        );
    }
    let store_value = get_store_fn.call(global_this, async_local_storage, &[])?;
    let Some(streaming_val) = store_value.get(global_this, b"streaming")? else {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "store value must have a \"streaming\" field"
        )));
    };
    if !streaming_val.is_boolean() {
        return Err(global_this
            .throw_invalid_arguments(format_args!("\"streaming\" field must be a boolean")));
    }
    if streaming_val.as_boolean() {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "\"{}\" is not available when `export const streaming = true`",
            bstr::BStr::new(display_function)
        )));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/BakeResponse.zig (146 lines)
//   confidence: high
//   notes:      jsc.conv ABI on exports/imports needs Phase-B verification on
//               Windows-x64; `*mut Response` ownership transfers to the C++
//               wrapper via Box::into_raw in all SSR paths.
// ──────────────────────────────────────────────────────────────────────────
