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
//! * `zst::<H>()`         — conjure a ZST handler value (the
//!   `comptime handler` → monomorphised-ZST trick).
//! * `user_mut`           — null-checked `*mut c_void → Option<&mut U>`.
//! * `handle_mut`         — `*mut Opaque → &mut Opaque` for uWS handles.
//! * `c_slice`            — `(ptr,len) → &[u8]` (empty when len==0 / null).
//! * `ext_owner`          — `&Option<NonNull<T>> → Option<&mut T>` (the
//!   `socket.ext(**T).*` pattern).
//! * `socket_ext_owner` / `connecting_ext_owner` — same, but starting from a
//!   raw `*us_socket_t` / `*us_connecting_socket_t`.
//!
//! All functions are `unsafe fn` (callers uphold the uWS callback contract)
//! and `#[inline(always)]` so codegen is identical to the hand-rolled thunks.

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::{ConnectingSocket, us_socket_t};

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
/// Replaces `// SAFETY: H is a ZST → core::mem::zeroed()` repeated at every
/// trampoline site. The ZST invariant is enforced at compile time via the
/// inline `const { assert!() }`, so a non-ZST `H` is a *compile* error at the
/// monomorphisation site — which is what lets this be a *safe* fn (S016).
/// Thin re-export of [`bun_core::ffi::conjure_zst`] kept for the shorter
/// `thunk::zst::<H>()` spelling at the ~20 uWS trampoline call sites.
#[inline(always)]
pub fn zst<H>() -> H {
    bun_core::ffi::conjure_zst::<H>()
}

/// Recover `&mut U` from a uWS user-data word, returning `None` for null.
///
/// # Safety
/// When non-null, `p` must have been registered as `*mut U` and point to a
/// live `U` with no other live `&mut`/`&` to it for the duration of the
/// returned borrow (uWS callbacks fire single-threaded from the event loop).
#[inline(always)]
pub unsafe fn user_mut<'a, U>(p: *mut c_void) -> Option<&'a mut U> {
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
pub unsafe fn handle_mut<'a, T>(p: *mut T) -> &'a mut T {
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
pub unsafe fn c_slice<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 || ptr.is_null() {
        &[]
    } else {
        // SAFETY: per caller contract above.
        unsafe { core::slice::from_raw_parts(ptr, len) }
    }
}

/// Dereference the `Option<NonNull<T>>` stored in a socket's ext slot
/// (`socket.ext(**T).*` in Zig). `None` covers the calloc'd-but-not-yet-
/// stamped window during connect/accept.
///
/// # Safety
/// The pointee, when present, must be live and uniquely borrowed for `'a`
/// (uWS dispatch is single-threaded so no aliasing `&mut` exists).
#[inline(always)]
pub unsafe fn ext_owner<'a, T>(ext: &Option<NonNull<T>>) -> Option<&'a mut T> {
    // SAFETY: per caller contract above.
    ext.map(|mut p| unsafe { p.as_mut() })
}

/// Read the `Option<NonNull<T>>` ext slot directly off a raw `*us_socket_t`
/// and dereference it. Combines `(*s).ext::<Option<NonNull<T>>>()` +
/// [`ext_owner`].
///
/// # Safety
/// `s` is a live socket from uWS dispatch; the ext slot was sized for
/// `Option<NonNull<T>>` at context creation; pointee (if any) is live and
/// uniquely accessed.
#[inline(always)]
pub unsafe fn socket_ext_owner<'a, T>(s: *mut us_socket_t) -> Option<&'a mut T> {
    // SAFETY: per caller contract above.
    unsafe { ext_owner(&*(*s).ext::<Option<NonNull<T>>>()) }
}

/// As [`socket_ext_owner`] but for `*us_connecting_socket_t`.
///
/// # Safety
/// See [`socket_ext_owner`].
#[inline(always)]
pub unsafe fn connecting_ext_owner<'a, T>(c: *mut ConnectingSocket) -> Option<&'a mut T> {
    // SAFETY: per caller contract above.
    unsafe { ext_owner(&*(*c).ext::<Option<NonNull<T>>>()) }
}

/// Read the raw `Option<NonNull<T>>` word out of a socket ext slot **without**
/// dereferencing it. Used by handlers that pass `*mut T` onward (the
/// `RawSocketEvents` family) instead of forming `&mut T`.
///
/// # Safety
/// See [`socket_ext_owner`].
#[inline(always)]
pub unsafe fn connecting_ext_ptr<T>(c: *mut ConnectingSocket) -> Option<NonNull<T>> {
    // S008: `ConnectingSocket` is an `opaque_ffi!` ZST — `opaque_mut` is the
    // safe const-asserted ZST deref accessor; reading the `Copy` slot needs
    // no further `unsafe`. (Function stays `unsafe fn` for the type-pun
    // contract: caller asserts the ext slot was sized for `Option<NonNull<T>>`.)
    *ConnectingSocket::opaque_mut(c).ext::<Option<NonNull<T>>>()
}

// ───────────────────────── safe-surface trampoline ──────────────────────────
//
// S005: the primitives above are `unsafe fn` because each call site must
// re-assert the uWS callback contract. For the common, *non-re-entrant*
// dispatch path (single-threaded event loop, handler does not call back into
// uWS on the same socket while holding `&mut Owner`) that contract is uniform
// and can be discharged once at the type level instead of at every call site.
// `ExtSlot<T>` is that type-level discharge: choosing it as `Handler::Ext`
// moves the proof obligation from ~30 `unsafe { ext_owner(ext) }` blocks to
// the one `unsafe` inside `owner_mut()`.

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
/// inside discharges the same invariant every former
/// `unsafe { thunk::ext_owner(ext) }` call site repeated open-coded.
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

    /// Snapshot the raw pointer word without forming a borrow. Used by
    /// `on_connect_error` paths that must read the owner *before* closing the
    /// socket (which may invalidate the ext storage `self` points into).
    #[inline(always)]
    pub fn get(&self) -> Option<NonNull<T>> {
        self.0
    }
}
