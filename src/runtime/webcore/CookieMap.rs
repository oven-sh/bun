use core::ffi::c_void;

use bun_jsc::{JSGlobalObject, JsResult};
use bun_uws::ResponseKind;

/// Opaque FFI handle. Always used behind a pointer (`*mut CookieMap`).
#[repr(C)]
pub struct CookieMap {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// TODO(port): move to runtime_sys (or webcore_sys) — extern decls belong in the *_sys crate
unsafe extern "C" {
    fn CookieMap__write(
        cookie_map: *mut CookieMap,
        global_this: *mut JSGlobalObject,
        kind: ResponseKind,
        uws_http_response: *mut c_void,
    );

    fn CookieMap__deref(cookie_map: *mut CookieMap);

    fn CookieMap__ref(cookie_map: *mut CookieMap);
}

impl CookieMap {
    pub fn write(
        &mut self,
        global_this: &JSGlobalObject,
        kind: ResponseKind,
        uws_http_response: *mut c_void,
    ) -> JsResult<()> {
        // TODO(port): @src() has no direct Rust equivalent; bun_jsc::from_js_host_call_generic
        // likely wants a `core::panic::Location` or a codegen'd source-loc macro here.
        bun_jsc::from_js_host_call_generic(
            global_this,
            /* @src() */
            CookieMap__write,
            (
                self as *mut CookieMap,
                global_this as *const _ as *mut JSGlobalObject,
                kind,
                uws_http_response,
            ),
        )
    }

    pub fn deref(&mut self) {
        // SAFETY: self is a valid *mut CookieMap by construction (opaque FFI handle)
        unsafe { CookieMap__deref(self as *mut CookieMap) }
    }

    pub fn ref_(&mut self) {
        // SAFETY: self is a valid *mut CookieMap by construction (opaque FFI handle)
        unsafe { CookieMap__ref(self as *mut CookieMap) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/CookieMap.zig (17 lines)
//   confidence: medium
//   todos:      2
//   notes:      from_js_host_call_generic signature + @src() mapping need Phase B resolution
// ──────────────────────────────────────────────────────────────────────────
