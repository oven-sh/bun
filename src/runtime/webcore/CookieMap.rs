use core::ffi::c_void;
use core::ptr::NonNull;

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
        CookieMap__deref(self)
    }

    pub fn ref_(&mut self) {
        CookieMap__ref(self)
    }
}

/// Intrusive smart pointer over a C++-refcounted `CookieMap`.
///
/// Owns exactly one strong ref: `new_ref` bumps it (for a borrowed handle),
/// `adopt` takes over an already-`+1`'d raw pointer, and `Drop` releases it.
/// Mirrors `AbortSignalRef` — a raw FFI handle (opaque C++ object) cannot live
/// inside `Box`/`Arc`, so this newtype is the sanctioned owning representation.
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

    /// Adopt a `*mut CookieMap` that already carries a `+1` reference this
    /// `CookieMapRef` will release on drop.
    ///
    /// # Safety
    /// `ptr` must be non-null, point to a live `CookieMap`, and carry an owned
    /// reference being transferred in.
    #[inline]
    pub unsafe fn adopt(ptr: *mut CookieMap) -> Self {
        debug_assert!(!ptr.is_null());
        // SAFETY: caller contract — `ptr` is non-null.
        Self(unsafe { NonNull::new_unchecked(ptr) })
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
        // SAFETY: held +1 ref keeps the C++ object alive for `'_`.
        unsafe { self.0.as_ref() }
    }
}

impl core::ops::DerefMut for CookieMapRef {
    #[inline]
    fn deref_mut(&mut self) -> &mut CookieMap {
        // SAFETY: held +1 ref keeps the C++ object alive; `&mut self` makes
        // this the unique live handle to that ref.
        unsafe { self.0.as_mut() }
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
        // SAFETY: held +1 ref keeps the C++ object alive until this deref.
        CookieMap__deref(unsafe { self.0.as_ref() })
    }
}

// ported from: src/runtime/webcore/CookieMap.zig
