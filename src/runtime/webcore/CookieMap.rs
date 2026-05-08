use core::ffi::c_void;

use bun_jsc::{JSGlobalObject, JsResult};
use bun_uws::ResponseKind;

/// Opaque FFI handle. Always used behind a pointer (`*mut CookieMap`).
#[repr(C)]
pub struct CookieMap {
    _p: core::cell::UnsafeCell<[u8; 0]>,
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
        // @src() is supplied via `#[track_caller]` on `from_js_host_call_generic`.
        bun_jsc::from_js_host_call_generic(global_this, || {
            // SAFETY: `self` is a uniquely-borrowed opaque FFI handle. `JSGlobalObject`
            // wraps `UnsafeCell`, so `as_ptr()` yields a `*mut` the C++ side may write
            // through without violating `&JSGlobalObject`'s aliasing guarantees.
            unsafe {
                CookieMap__write(
                    std::ptr::from_mut::<CookieMap>(self),
                    global_this.as_ptr(),
                    kind,
                    uws_http_response,
                )
            }
        })
    }

    pub fn deref(&mut self) {
        // SAFETY: self is a valid *mut CookieMap by construction (opaque FFI handle)
        unsafe { CookieMap__deref(std::ptr::from_mut::<CookieMap>(self)) }
    }

    pub fn ref_(&mut self) {
        // SAFETY: self is a valid *mut CookieMap by construction (opaque FFI handle)
        unsafe { CookieMap__ref(std::ptr::from_mut::<CookieMap>(self)) }
    }
}

// ported from: src/runtime/webcore/CookieMap.zig
