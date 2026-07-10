use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JsResult};
use bun_uws::ResponseKind;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle. Always used behind a pointer (`*mut CookieMap`).
    pub struct CookieMap;
}

unsafe extern "C" {
    // Reference params discharge the non-null/aligned preconditions; `JSGlobalObject`
    // wraps `UnsafeCell` so `&JSGlobalObject` permits C++ interior mutation.
    // `uws_http_response` is an opaque pass-through validated by the caller.
    safe fn CookieMap__write(
        cookie_map: &CookieMap,
        global_this: &JSGlobalObject,
        kind: ResponseKind,
        uws_http_response: *mut c_void,
    );

    safe fn CookieMap__deref(cookie_map: &CookieMap);

    safe fn CookieMap__ref(cookie_map: &CookieMap);
}

impl CookieMap {
    /// `&self`, not `&mut self`: `CookieMap` is an `opaque_ffi!` ZST, so `&Self`
    /// carries no `noalias`/`readonly` and C++ mutates the cookie store through
    /// it. A `&mut` would assert an exclusivity that never holds — the C++ side
    /// owns the object and other refs exist by definition.
    pub fn write(
        &self,
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
    // mutators on the pointee would let a borrow of the pointee corrupt the
    // count relative to the ref's owned `+1` (double-unref / UAF on Drop),
    // mirroring how `RefPtr` discourages bare `ref`/`deref` on its pointee.
}

// The ownership unit is one tick of the C++ intrusive refcount: `CookieMap__ref`
// adds one, `CookieMap__deref` gives one back. One `CookieMapRef` owns exactly
// one, taken in `new_ref` and released by `ForeignRef`'s `Drop`.
bun_opaque::foreign_handle! {
    /// Intrusive smart pointer over a C++-refcounted `CookieMap`.
    ///
    /// Owns exactly one strong ref: [`CookieMapRef::new_ref`] bumps it (for a
    /// borrowed handle) and `Drop` releases it. Mirrors `AbortSignalRef` — a raw
    /// FFI handle (opaque C++ object) cannot live inside `Box`/`Arc`, so this
    /// newtype is the sanctioned owning representation.
    ///
    /// The macro also emits `adopt`/`adopt_ptr` (`+1`-transfer constructors that
    /// take an already-bumped pointer). No caller needs them yet: every
    /// construction site in the tree goes through `new_ref`.
    pub struct CookieMapRef(CookieMap) via CookieMap__deref;
}

impl CookieMapRef {
    /// Bump the refcount of a borrowed `CookieMap` and wrap it (the caller
    /// keeps its own ref; this `CookieMapRef` owns the freshly-added one).
    #[inline]
    pub fn new_ref(cookie_map: &CookieMap) -> Self {
        CookieMap__ref(cookie_map);
        // SAFETY: the `CookieMap__ref` on the line above is the producer — it
        // just added one strong ref to the C++ intrusive count, over and above
        // the one `cookie_map` is borrowed from. Nothing else will give that
        // unit back, so this handle adopts it and releases it exactly once in
        // `Drop` (via `CookieMap__deref`). `as_mut_ptr()` returns the address of
        // a live `&CookieMap`, hence non-null.
        unsafe { Self::adopt(NonNull::new_unchecked(cookie_map.as_mut_ptr())) }
    }
}

impl core::ops::Deref for CookieMapRef {
    type Target = CookieMap;
    #[inline]
    fn deref(&self) -> &CookieMap {
        self.raw()
    }
}

// No `DerefMut`: see `CookieMap::write` — `&mut CookieMap` would assert an
// exclusivity over a C++-owned object that is never true, and nothing needs it.

impl Clone for CookieMapRef {
    #[inline]
    fn clone(&self) -> Self {
        Self::new_ref(self)
    }
}
