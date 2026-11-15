use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JsResult};
use bun_uws::{AnyResponse, ResponseKind};

bun_opaque::sealed_handle! {
    /// Opaque FFI handle. Always used behind a pointer (`*mut CookieMap`).
    pub struct CookieMap;
}

unsafe extern "C" {
    // Reference params discharge the non-null/aligned preconditions; `JSGlobalObject`
    // wraps `UnsafeCell` so `&JSGlobalObject` permits C++ interior mutation.
    fn CookieMap__write(
        cookie_map: &CookieMap,
        global_this: &JSGlobalObject,
        kind: ResponseKind,
        uws_http_response: *mut c_void,
    );

    fn CookieMap__deref(cookie_map: *mut CookieMap);

    safe fn CookieMap__ref(cookie_map: &CookieMap);
}

impl CookieMap {
    pub(crate) fn write(
        &self,
        global_this: &JSGlobalObject,
        response: AnyResponse,
    ) -> JsResult<()> {
        let kind = ResponseKind::of(response);
        // SAFETY: `kind` and the pointer come from the same response.
        bun_jsc::from_js_host_call_generic(global_this, || unsafe {
            CookieMap__write(self, global_this, kind, response.as_ptr())
        })
    }
}

// SAFETY: only `new_ref` makes one, with the ref that it takes.
bun_opaque::owned_handle! {
    /// One ref on a `WebCore::CookieMap`.
    pub(crate) struct CookieMapRef(CookieMap) => unsafe CookieMap__deref;
}

impl CookieMapRef {
    /// Bump the refcount of a borrowed `CookieMap` and wrap it (the caller
    /// keeps its own ref; this `CookieMapRef` owns the freshly-added one).
    #[inline]
    pub(crate) fn new_ref(cookie_map: &CookieMap) -> Self {
        CookieMap__ref(cookie_map);
        Self(NonNull::from(cookie_map))
    }
}
