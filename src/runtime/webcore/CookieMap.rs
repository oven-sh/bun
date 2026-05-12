use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JsResult};
use bun_uws::ResponseKind;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle. Always used behind a pointer (`*mut CookieMap`).
    pub struct CookieMap;
}

// TODO(port): move to runtime_sys (or webcore_sys) — extern decls belong in the *_sys crate
unsafe extern "C" {
    // Reference params discharge the non-null/aligned preconditions; `JSGlobalObject`
    // wraps `UnsafeCell` so `&JSGlobalObject` permits C++ interior mutation.
    // `uws_http_response` is an opaque pass-through validated by the caller.
    safe fn CookieMap__write(
        cookie_map: &mut CookieMap,
        global_this: &JSGlobalObject,
        kind: ResponseKind,
        uws_http_response: *mut c_void,
    );

    safe fn CookieMap__deref(cookie_map: &CookieMap);

    safe fn CookieMap__ref(cookie_map: &CookieMap);
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
            CookieMap__write(self, global_this, kind, uws_http_response)
        })
    }

    // NOTE: no inherent `ref`/`deref` on `CookieMap` — `CookieMapRef` is the
    // sanctioned owner of the intrusive C++ refcount. Exposing bare refcount
    // mutators on the pointee would let `&mut *cookie_map_ref` corrupt the
    // count relative to the ref's owned `+1` (double-unref / UAF on Drop),
    // mirroring how `RefPtr` discourages bare `ref`/`deref` on its pointee.
}

/// Intrusive smart pointer over a C++-refcounted `CookieMap`.
///
/// Owns exactly one strong ref: `new_ref` bumps it (for a borrowed handle)
/// and `Drop` releases it. Mirrors `AbortSignalRef` — a raw FFI handle (opaque
/// C++ object) cannot live inside `Box`/`Arc`, so this newtype is the
/// sanctioned owning representation.
///
/// (A `+1`-transfer constructor — adopting an already-bumped raw pointer
/// without a fresh `ref()` — is deliberately omitted until a caller needs it;
/// every construction site in the tree goes through `new_ref`.)
#[repr(transparent)]
pub struct CookieMapRef(NonNull<CookieMap>);

impl CookieMapRef {
    /// Bump the refcount of a borrowed `CookieMap` and wrap it (the caller
    /// keeps its own ref; this `CookieMapRef` owns the freshly-added one).
    #[inline]
    pub fn new_ref(cookie_map: &CookieMap) -> Self {
        CookieMap__ref(cookie_map);
        Self(NonNull::from(cookie_map))
    }

    #[inline]
    pub fn as_ptr(&self) -> *mut CookieMap {
        self.0.as_ptr()
    }
}

impl core::ops::Deref for CookieMapRef {
    type Target = CookieMap;
    #[inline]
    fn deref(&self) -> &CookieMap {
        CookieMap::opaque_ref(self.0.as_ptr())
    }
}

impl core::ops::DerefMut for CookieMapRef {
    #[inline]
    fn deref_mut(&mut self) -> &mut CookieMap {
        CookieMap::opaque_mut(self.0.as_ptr())
    }
}

impl Clone for CookieMapRef {
    #[inline]
    fn clone(&self) -> Self {
        Self::new_ref(self)
    }
}

impl Drop for CookieMapRef {
    #[inline]
    fn drop(&mut self) {
        // Held +1 ref keeps the C++ object alive until this deref; `Deref`
        // (above) encapsulates the NonNull access.
        CookieMap__deref(self)
    }
}

// ported from: src/runtime/webcore/CookieMap.zig
