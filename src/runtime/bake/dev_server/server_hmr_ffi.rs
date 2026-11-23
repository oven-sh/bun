//! C++ functions for hot-reloading server-side modules.

use super::*;

pub(super) fn bake_load_server_hmr_patch(
    global: &JSGlobalObject,
    code: BunString,
) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn BakeLoadServerHmrPatch(global: &JSGlobalObject, code: BunString) -> JSValue;
    }
    jsc::from_js_host_call(global, || BakeLoadServerHmrPatch(global, code))
}

pub(super) fn bake_load_server_hmr_patch_with_source_map(
    global: &JSGlobalObject,
    code: BunString,
    source_map_json_ptr: *const u8,
    source_map_json_len: usize,
) -> JsResult<JSValue> {
    unsafe extern "C" {
        // PRECONDITION: `ptr` must be readable for `len` bytes and point to
        // a heap allocation whose ownership transfers to the C++
        // `DevServerSourceProvider` (caller wraps the backing `Vec<u8>` in
        // `ManuallyDrop`). Cannot be `safe fn` — raw ptr+len pair carries a
        // caller-side validity + ownership precondition.
        fn BakeLoadServerHmrPatchWithSourceMap(
            global: *const JSGlobalObject,
            code: BunString,
            ptr: *const u8,
            len: usize,
        ) -> JSValue;
    }
    // SAFETY: `global` is live; `source_map_json_ptr`/`len` are forwarded from
    // the sole caller's `ManuallyDrop<Vec<u8>>` (valid for `len`, ownership
    // ceded to C++) — discharges the ptr+len precondition above.
    jsc::from_js_host_call(global, || unsafe {
        BakeLoadServerHmrPatchWithSourceMap(global, code, source_map_json_ptr, source_map_json_len)
    })
}

pub(super) fn bake_load_initial_server_code(
    global: &JSGlobalObject,
    code: BunString,
    separate_ssr_graph: bool,
) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn BakeLoadInitialServerCode(
            global: &JSGlobalObject,
            code: BunString,
            separate_ssr_graph: bool,
        ) -> JSValue;
    }
    jsc::from_js_host_call(global, || {
        BakeLoadInitialServerCode(global, code, separate_ssr_graph)
    })
}
