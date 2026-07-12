//! extern "C" vtable/dispatch shims. Moved from `src/uws_sys/vtable.rs`
//! (`Trampolines<H>`) with pointer types adapted to the native crate; the
//! Handler trait and `vtable::make` live in dispatch.rs. Exposed pub(crate)
//! so dispatch.rs can direct-call per-kind, bypassing the vtable pointer.
//!
//! Also home to the raw-header readers and vtable-slot invokers the dispatch
//! driver uses (dispatch.rs is deny(unsafe_code)). Shared invariant: the loop
//! only dispatches slab-resident headers, and slab memory is never returned
//! to the OS while the loop lives — so slot reads are in-bounds even for
//! vacant (freed-and-bumped) slots. Listener headers are slab-resident too
//! (group::finish_listen allocates via socket::alloc with kind=Invalid; only
//! the ListenerData is boxed into the ext word), so one reaching dispatch_*
//! reads an in-bounds generation and traps in `vt()` on kind=Invalid (R7.2).

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use crate::connecting::ConnectingSocket;
use crate::dispatch::Handler;
use crate::group::{SocketGroup, VTable};
use crate::kind::SocketKind;
use crate::socket::us_socket_t;
use crate::tls::context::us_bun_verify_error_t;
use crate::unsafe_core::ext;
use crate::unsafe_core::slab::ChunkedSlab;

pub(crate) struct Trampolines<H>(core::marker::PhantomData<H>);

impl<H: Handler> Trampolines<H> {
    #[inline(always)]
    fn ext<'a>(s: *mut us_socket_t) -> ext::ExtMut<'a, H::Ext>
    where
        H::Ext: 'a,
    {
        // Generation validation before the ext read: parity odd = occupied
        // (deferred-close slots stay occupied until the tick postlude, C6).
        debug_assert!(socket_slot_live(s), "ext read on a dead slab slot");
        // Kind-registry type check (api.md handle surface): the invoked
        // handler is the one registered for this static kind.
        debug_assert!(
            crate::dispatch::kind_dispatches_to::<H>(socket_kind(s)),
            "trampoline invoked for a kind registered to a different handler"
        );
        // SAFETY: dispatch only invokes trampolines on live sockets whose ext
        // storage was sized for `H::Ext` at creation. No reference is formed
        // here — every deref is a per-use reborrow inside `ExtMut::with`, so
        // C17 re-entry (close/adopt from inside the handler) cannot overlap
        // a live `&mut` to the same storage.
        ext::ExtMut::new(unsafe { ext::downcast_raw::<H::Ext>(s) })
    }

    pub(crate) extern "C" fn on_open(
        s: *mut us_socket_t,
        is_client: c_int,
        ip: *mut u8,
        ip_len: c_int,
    ) -> *mut us_socket_t {
        // SAFETY: the loop guarantees `ip[0..ip_len]` is valid when non-null.
        let ip_slice: &[u8] =
            unsafe { ext::c_slice(ip, usize::try_from(ip_len).expect("int cast")) };
        if H::HAS_EXT {
            H::on_open(Self::ext(s), s, is_client != 0, ip_slice);
        } else {
            H::on_open_no_ext(s, is_client != 0, ip_slice);
        }
        s
    }

    pub(crate) extern "C" fn on_data(
        s: *mut us_socket_t,
        data: *mut u8,
        len: c_int,
    ) -> *mut us_socket_t {
        // SAFETY: the loop guarantees `data[0..len]` is valid (shared recv_buf).
        let data_slice = unsafe { ext::c_slice(data, usize::try_from(len).expect("int cast")) };
        if H::HAS_EXT {
            H::on_data(Self::ext(s), s, data_slice);
        } else {
            H::on_data_no_ext(s, data_slice);
        }
        s
    }

    pub(crate) extern "C" fn on_fd(s: *mut us_socket_t, fd: c_int) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_fd(Self::ext(s), s, fd);
        } else {
            H::on_fd_no_ext(s, fd);
        }
        s
    }

    pub(crate) extern "C" fn on_writable(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_writable(Self::ext(s), s);
        } else {
            H::on_writable_no_ext(s);
        }
        s
    }

    pub(crate) extern "C" fn on_close(
        s: *mut us_socket_t,
        code: c_int,
        reason: *mut c_void,
    ) -> *mut us_socket_t {
        let reason = if reason.is_null() { None } else { Some(reason) };
        if H::HAS_EXT {
            H::on_close(Self::ext(s), s, code, reason);
        } else {
            H::on_close_no_ext(s, code, reason);
        }
        s
    }

    pub(crate) extern "C" fn on_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_timeout(Self::ext(s), s);
        } else {
            H::on_timeout_no_ext(s);
        }
        s
    }

    pub(crate) extern "C" fn on_long_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_long_timeout(Self::ext(s), s);
        } else {
            H::on_long_timeout_no_ext(s);
        }
        s
    }

    pub(crate) extern "C" fn on_end(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_end(Self::ext(s), s);
        } else {
            H::on_end_no_ext(s);
        }
        s
    }

    pub(crate) extern "C" fn on_connect_error(
        s: *mut us_socket_t,
        code: c_int,
    ) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_connect_error(Self::ext(s), s, code);
        } else {
            H::on_connect_error_no_ext(s, code);
        }
        s
    }

    pub(crate) extern "C" fn on_connecting_error(
        cs: *mut ConnectingSocket,
        code: c_int,
    ) -> *mut ConnectingSocket {
        H::on_connecting_error(cs, code);
        cs
    }

    pub(crate) extern "C" fn on_handshake(
        s: *mut us_socket_t,
        ok: c_int,
        err: us_bun_verify_error_t,
        _user: *mut c_void,
    ) {
        if H::HAS_EXT {
            H::on_handshake(Self::ext(s), s, ok != 0, err);
        } else {
            H::on_handshake_no_ext(s, ok != 0, err);
        }
    }
}

// ── raw header reads for the dispatch driver ────────────────────────────────
// Short-lived field copies only — never a `&`/`&mut SocketHeader` that could
// alias re-entrant callback state (C17).

/// Slot occupancy via generation parity (odd = occupied). Vacant ⇒ the event
/// is stale (OQ-4 structural fix, api.md CHANGES 6) and must be dropped.
/// Parity cannot detect slot REUSE: stale kernel udata for a slot freed in a
/// prior tick postlude and re-allocated has odd parity again. Safe only
/// because deferred free (C6) covers intra-batch staleness and the backend
/// purges kernel-held udata (fd close/EPOLL_CTL_DEL) before slot reuse.
pub(crate) fn socket_slot_live(s: *mut us_socket_t) -> bool {
    match NonNull::new(s) {
        // SAFETY: slab-resident header per module invariant; the slot's
        // generation cell is in-bounds even when the slot is vacant.
        Some(nn) => (unsafe { ChunkedSlab::generation(nn) }) % 2 == 1,
        None => false,
    }
}

/// Connecting-socket variant of [`socket_slot_live`].
pub(crate) fn connecting_slot_live(cs: *mut ConnectingSocket) -> bool {
    match NonNull::new(cs) {
        // SAFETY: slab-resident per module invariant (connecting sockets live
        // in the per-loop slab like sockets).
        Some(nn) => (unsafe { ChunkedSlab::generation(nn) }) % 2 == 1,
        None => false,
    }
}

pub(crate) fn socket_kind(s: *mut us_socket_t) -> SocketKind {
    // SAFETY: occupied slab slot (dispatch validates parity first).
    unsafe { (*s).kind }
}

pub(crate) fn connecting_kind(cs: *mut ConnectingSocket) -> SocketKind {
    // SAFETY: occupied slab slot (dispatch validates parity first).
    unsafe { (*cs).kind }
}

pub(crate) fn socket_group(s: *mut us_socket_t) -> *mut SocketGroup {
    // SAFETY: occupied slab slot (dispatch validates parity first).
    unsafe { (*s).group }
}

pub(crate) fn socket_group_vtable(s: *mut us_socket_t) -> Option<&'static VTable> {
    let g = socket_group(s);
    // SAFETY: the group is embedded by-value in a live owner for as long as
    // any of its sockets exists; the vtable slot is a `&'static` copy-out.
    unsafe { (*g).vtable }
}

pub(crate) fn connecting_group_vtable(cs: *mut ConnectingSocket) -> Option<&'static VTable> {
    // SAFETY: occupied slab slot; group liveness as in `socket_group_vtable`.
    unsafe { (*(*cs).group).vtable }
}

// ── vtable slot invocation (NULL slot ⇒ skipped no-op, cabi-surface §4.1) ───
// The `-> *mut us_socket_t` return is always the input with in-place adoption
// (api.md §Strategy 3) and is deliberately discarded.

fn c_len(len: usize) -> c_int {
    c_int::try_from(len).expect("dispatch buffer length exceeds c_int")
}

pub(crate) fn invoke_open(vt: &VTable, s: *mut us_socket_t, is_client: bool, ip: &[u8]) {
    if let Some(f) = vt.on_open {
        // SAFETY: slot signature matches this lowering; `ip` outlives the
        // call. The `*mut` is C-ABI shape only — `ip` is lowered from a
        // shared borrow, so the handler must not write through it (cabi §4.1).
        let _ = unsafe { f(s, is_client as c_int, ip.as_ptr().cast_mut(), c_len(ip.len())) };
    }
}

pub(crate) fn invoke_data(vt: &VTable, s: *mut us_socket_t, data: &mut [u8]) {
    if let Some(f) = vt.on_data {
        // SAFETY: slot signature matches; `data` (shared recv_buf view, writable
        // for in-place WS unmasking) outlives the call.
        let _ = unsafe { f(s, data.as_mut_ptr(), c_len(data.len())) };
    }
}

pub(crate) fn invoke_fd(vt: &VTable, s: *mut us_socket_t, fd: c_int) {
    if let Some(f) = vt.on_fd {
        // SAFETY: slot signature matches the C ABI.
        let _ = unsafe { f(s, fd) };
    }
}

pub(crate) fn invoke_close(vt: &VTable, s: *mut us_socket_t, code: c_int, reason: *mut c_void) {
    if let Some(f) = vt.on_close {
        // SAFETY: slot signature matches; `reason` is an opaque passthrough (C3).
        let _ = unsafe { f(s, code, reason) };
    }
}

pub(crate) fn invoke_connect_error(vt: &VTable, s: *mut us_socket_t, code: c_int) {
    if let Some(f) = vt.on_connect_error {
        // SAFETY: slot signature matches the C ABI.
        let _ = unsafe { f(s, code) };
    }
}

pub(crate) fn invoke_connecting_error(vt: &VTable, cs: *mut ConnectingSocket, code: c_int) {
    if let Some(f) = vt.on_connecting_error {
        // SAFETY: slot signature matches the C ABI.
        let _ = unsafe { f(cs, code) };
    }
}

pub(crate) fn invoke_handshake(
    vt: &VTable,
    s: *mut us_socket_t,
    ok: bool,
    err: us_bun_verify_error_t,
) {
    if let Some(f) = vt.on_handshake {
        // SAFETY: slot signature matches; custom_data is always NULL
        // (cabi-surface §2.1).
        unsafe { f(s, ok as c_int, err, core::ptr::null_mut()) };
    }
}

/// Stamps the four `fn(s) -> s` slot invokers.
macro_rules! invoke_unary {
    ($($name:ident => $slot:ident),* $(,)?) => {$(
        pub(crate) fn $name(vt: &VTable, s: *mut us_socket_t) {
            if let Some(f) = vt.$slot {
                // SAFETY: slot signature matches the C ABI.
                let _ = unsafe { f(s) };
            }
        }
    )*};
}

invoke_unary! {
    invoke_writable => on_writable,
    invoke_timeout => on_timeout,
    invoke_long_timeout => on_long_timeout,
    invoke_end => on_end,
}
