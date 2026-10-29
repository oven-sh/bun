//! Consolidated unsafe primitives for uSockets/uWS callback trampolines.
//!
//! Every uWS callback follows the same shape: C hands us a raw handle plus a
//! `*mut c_void` user-data word, and the trampoline must (a) recover the typed
//! owner from the user-data, (b) re-type the opaque handle, (c) lift any
//! `(ptr,len)` pairs into slices, then (d) call the safe Rust handler. Before
//! this module each of `Response::on_*`, `h3::Response::on_*`,
//! `WebSocket::Wrap::on_*`, and `uws_handlers::*Handler` open-coded those
//! steps with three or four `unsafe {}` blocks apiece — ~300 in total.
//!
//! Centralising here means each invariant is documented and audited **once**:
//!
//! * `zst::<H>()`         — conjure a ZST handler value (handlers are
//!   monomorphised zero-sized types, so no runtime data is needed).
//! * `c_slice`            — `(ptr,len) → &[u8]` (empty when len==0 / null).
//!
//! `c_slice` is an `unsafe fn` (callers uphold the uWS callback contract)
//! and `#[inline(always)]` so codegen is identical to the hand-rolled thunks.

use core::ptr::NonNull;

/// Conjure a value of a zero-sized handler type.
///
/// Replaces `// SAFETY: H is a ZST → core::mem::zeroed()` repeated at every
/// trampoline site. The ZST invariant is enforced at compile time via the
/// inline `const { assert!() }`, so a non-ZST `H` is a *compile* error at the
/// monomorphisation site — which is what lets this be a *safe* fn (S016).
/// Thin re-export of [`bun_core::ffi::conjure_zst`] kept for the shorter
/// `thunk::zst::<H>()` spelling at the ~20 uWS trampoline call sites.
#[inline(always)]
pub(crate) fn zst<H>() -> H {
    bun_core::ffi::conjure_zst::<H>()
}

/// Lift a C `(ptr,len)` pair into a borrowed slice, mapping `len == 0` (and
/// optionally null `ptr`) to `&[]` so callers needn't special-case it.
///
/// # Safety
/// When `len > 0`, `ptr` must be valid for `len` reads and the bytes must
/// outlive `'a` (uWS guarantees this for the duration of the callback).
#[inline(always)]
pub(crate) unsafe fn c_slice<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 || ptr.is_null() {
        &[]
    } else {
        // SAFETY: per caller contract above.
        unsafe { core::slice::from_raw_parts(ptr, len) }
    }
}

// ───────────────────────── safe-surface trampoline ──────────────────────────
//
// S005: `c_slice` above is an `unsafe fn` because each call site must
// re-assert the uWS callback contract. For the common, *non-re-entrant*
// dispatch path (single-threaded event loop, handler does not call back into
// uWS on the same socket while holding `&mut Owner`) that contract is uniform
// and can be discharged once at the type level instead of at every call site.
// `ExtSlot<T>` is that type-level discharge: choosing it as `Handler::Ext`
// moves the proof obligation from every call site to the one `unsafe` inside
// `owner_mut()`.

/// Typed-safe wrapper for the `Option<NonNull<T>>` word stored in a uWS socket
/// ext slot. The newtype is the safe-surface entry point for the
/// `socket.ext(**T).*` pattern: choosing `type Ext = ExtSlot<T>` in a
/// [`crate::vtable::Handler`] impl asserts the **non-re-entrancy contract** —
/// that the handler bodies do not re-enter uWS dispatch on the same socket
/// while a `&mut T` borrowed from this slot is live (re-entrant consumers must
/// keep `type Ext = Option<NonNull<T>>` and pass `*mut T` onward; see
/// `RawPtrHandler`).
///
/// Because the inner field is private and there is no public safe constructor,
/// safe Rust cannot fabricate an `ExtSlot<T>` containing a dangling pointer;
/// every `&mut ExtSlot<T>` reachable from safe code was materialised by the
/// `vtable::Trampolines` layer from C-allocated socket ext memory (via
/// `(*s).ext::<ExtSlot<T>>()`), and `calloc`-zero is `None`. That makes
/// [`Self::owner_mut`] sound as a *safe* fn — the one `unsafe { p.as_mut() }`
/// inside discharges the invariant for every call site.
#[repr(transparent)]
pub struct ExtSlot<T>(Option<NonNull<T>>);

impl<T> ExtSlot<T> {
    /// Recover `&mut T` from the slot, or `None` for the calloc'd-but-not-yet-
    /// stamped window during connect/accept. Safe: see type-level docs for the
    /// invariant that discharges the `unsafe` inside.
    #[inline(always)]
    pub fn owner_mut(&mut self) -> Option<&mut T> {
        match self.0 {
            // SAFETY: `ExtSlot<T>` is only ever materialised by the uws_sys
            // trampoline layer from a live socket ext slot. The slot holds the
            // unique heap owner; uWS dispatch is single-threaded and — per the
            // `Handler::Ext = ExtSlot<T>` contract — non-re-entrant on this
            // user-data, so no aliasing `&mut T` exists for `'_`.
            Some(mut p) => Some(unsafe { p.as_mut() }),
            None => None,
        }
    }

    #[inline(always)]
    pub fn owner_ref(&self) -> Option<&T> {
        match self.0 {
            // SAFETY: same liveness invariant as `owner_mut`; only `&T` is
            // formed, so re-entrant dispatch cannot alias an exclusive borrow.
            Some(p) => Some(unsafe { &*p.as_ptr() }),
            None => None,
        }
    }
}
