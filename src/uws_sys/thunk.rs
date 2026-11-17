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
//! * `user_mut`           — null-checked `*mut c_void → Option<&mut U>`.
//! * `handle_mut`         — `*mut Opaque → &mut Opaque` for uWS handles.
//! * `c_slice`            — `(ptr,len) → &[u8]` (empty when len==0 / null).
//!
//! All functions are `unsafe fn` (callers uphold the uWS callback contract)
//! and `#[inline(always)]` so codegen is identical to the hand-rolled thunks.

use bun_core::JsTurn;

use core::ffi::c_void;
use core::ptr::NonNull;

/// Marker for `#[repr(C)]` zero-sized opaque FFI handles
/// (`UnsafeCell<[u8; 0]>` + `PhantomPinned`).
///
/// uWS hands us raw pointers to C++-owned objects that Rust models as ZST
/// opaques: the `&mut Self` exists only to hang inherent methods off and is
/// immediately re-erased to `*mut` at the FFI boundary. Because `Self` is
/// zero-sized with align 1, **any** non-null pointer is trivially
/// dereferenceable (zero bytes accessed) and `&mut Self` cannot alias any
/// Rust-visible memory — so [`Self::as_handle`] is a *safe* fn even though it
/// wraps `&mut *p`.
///
/// This is what lets `AnyResponse` be a plain `Copy` enum of raw pointers
/// whose method bodies dispatch per-variant without an `unsafe` block at
/// every call site (S019).
///
/// # Safety
/// Implementor MUST be a `#[repr(C)]` zero-sized type with alignment 1 that
/// owns no Rust bytes (i.e. an opaque-extern-type stand-in). Both invariants
/// are additionally enforced at compile time by `const { assert! }` in
/// [`Self::as_handle`], so a bad impl fails to build rather than causing UB.
pub unsafe trait OpaqueHandle: Sized {
    /// Re-type a raw uWS handle as `&mut Self` without `unsafe` at the call
    /// site. See the trait docs for why this is sound for ZST opaques.
    #[inline(always)]
    fn as_handle<'a>(p: *mut Self) -> &'a mut Self {
        const {
            assert!(
                core::mem::size_of::<Self>() == 0,
                "OpaqueHandle impl must be a ZST"
            )
        };
        const {
            assert!(
                core::mem::align_of::<Self>() == 1,
                "OpaqueHandle impl must be align-1"
            )
        };
        // Not `debug_assert!`: the ZST/align-1 contract discharges aliasing and
        // dereferenceable-for-zero-bytes, but NOT the `&mut T` validity invariant
        // that references are non-null. This is a *safe* fn and `AnyResponse` is a
        // public `Copy` enum of raw pointers, so safe code can reach here with
        // null in release builds — that must be a panic, not UB.
        assert!(!p.is_null(), "OpaqueHandle::as_handle: null uWS handle");
        // SAFETY: per trait contract `Self` is a ZST with align 1, so `p` (now
        // checked non-null above) is dereferenceable for zero bytes; the
        // resulting `&mut` covers no memory and so cannot alias. C++ owns the
        // real object; Rust never reads/writes through it.
        unsafe { &mut *p }
    }
}

/// Conjure a value of a zero-sized handler type.
///
/// # Safety
/// A value of `H` was handed over on this thread when the callback was registered.
#[inline(always)]
pub(crate) unsafe fn zst<H: Copy + 'static>() -> H {
    const {
        assert!(
            core::mem::size_of::<H>() == 0,
            "zst: H must be a ZST (fn item or capture-less closure)"
        )
    };
    // SAFETY: a copy of that value, which has no bytes.
    unsafe { bun_core::ffi::zeroed_unchecked() }
}

/// The turn of a handler of an `App`, of one of its responses or of one of its WebSockets.
///
/// # Safety
/// uWS called the function that `scope` is a parameter of.
#[inline(always)]
pub unsafe fn app_turn<T>(scope: &T) -> JsTurn<'_> {
    // SAFETY: making an `App` takes a `HasVm`, only the loop of that thread polls its sockets, and no handle to them
    // is `Send`. By the time the global object is destroyed they are closed, or (idle HTTP/3) polled no more. A server
    // is finalized once it is drained: only the dev server's WebSockets close then, and leave the turn unused.
    unsafe { JsTurn::assume(scope) }
}

/// Recover `&mut U` from a uWS user-data word, returning `None` for null.
///
/// # Safety
/// When non-null, `p` must have been registered as `*mut U` and point to a
/// live `U` with no other live `&mut`/`&` to it for the duration of the
/// returned borrow (uWS callbacks fire single-threaded from the event loop).
#[inline(always)]
pub(crate) unsafe fn user_mut<'a, U>(p: *mut c_void) -> Option<&'a mut U> {
    if p.is_null() {
        None
    } else {
        // SAFETY: per caller contract above.
        Some(unsafe { &mut *p.cast::<U>() })
    }
}

/// Re-type a raw uWS handle (`uws_res`, `H3Response`, `RawWebSocket`, …) as a
/// mutable Rust reference. These are zero-sized opaque markers, so the borrow
/// covers no Rust-owned bytes — it exists purely to hang methods off.
///
/// # Safety
/// `p` must be non-null and live for the duration of the callback (guaranteed
/// by uWS for every handle it passes into a callback).
#[inline(always)]
pub(crate) unsafe fn handle_mut<'a, T>(p: *mut T) -> &'a mut T {
    debug_assert!(!p.is_null());
    // SAFETY: per caller contract above.
    unsafe { &mut *p }
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

/// Typed-safe wrapper for the `Option<NonNull<T>>` word stored in a uWS socket
/// ext slot.
///
/// Because the inner field is private and there is no public safe constructor,
/// safe Rust cannot fabricate an `ExtSlot<T>` containing a dangling pointer;
/// every `&mut ExtSlot<T>` reachable from safe code was materialised by the
/// `vtable::Trampolines` layer from C-allocated socket ext memory (via
/// `(*s).ext::<ExtSlot<T>>()`), and `calloc`-zero is `None`. That makes
/// [`Self::owner_ref`] sound as a *safe* fn — the one `unsafe`
/// inside discharges the invariant for every call site.
#[repr(transparent)]
pub struct ExtSlot<T>(Option<NonNull<T>>);

impl<T> ExtSlot<T> {
    /// Recover `&T` from the slot, or `None` for the calloc'd-but-not-yet-
    /// stamped window during connect/accept. Safe: see type-level docs for the
    /// invariant that discharges the `unsafe` inside.
    #[inline(always)]
    pub fn owner_ref(&self) -> Option<&T> {
        match self.0 {
            // SAFETY: the slot of a live socket holds its live owner; only `&T` is
            // formed, so re-entrant dispatch cannot alias an exclusive borrow.
            Some(p) => Some(unsafe { &*p.as_ptr() }),
            None => None,
        }
    }
}
