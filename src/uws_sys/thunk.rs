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

use crate::{us_socket_t, ConnectingSocket};

/// Conjure a value of a zero-sized handler type.
///
/// Replaces `// SAFETY: H is a ZST → core::mem::zeroed()` repeated at every
/// trampoline site. The ZST invariant is enforced at compile time via the
/// inline `const { assert!() }`, so callers no longer need their own copy.
///
/// # Safety
/// `H` must be inhabited (true for any `Fn*` ZST — fn items and capture-less
/// closures). The size check is a compile-time assert.
#[inline(always)]
pub unsafe fn zst<H>() -> H {
    const { assert!(core::mem::size_of::<H>() == 0, "handler must be a fn item or capture-less closure") };
    // SAFETY: `H` has zero size (asserted above) and is inhabited per caller
    // contract, so the empty bit-pattern is a valid value.
    unsafe { bun_core::ffi::zeroed() }
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
    // SAFETY: per caller contract above.
    unsafe { *(*c).ext::<Option<NonNull<T>>>() }
}
