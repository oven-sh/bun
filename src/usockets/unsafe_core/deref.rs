//! Closure-scoped reborrows of loop-owned raw pointers for `deny(unsafe_code)`
//! modules. Scoping guarantees no borrow spans a dispatch that can re-enter
//! consumer code (C17); slab/loop storage never frees while the loop lives.

use crate::group::SocketGroup;
use crate::loop_::{InternalLoopData, Loop};
use crate::socket::us_socket_t;

/// Contract: `loop_` is live, called on the loop thread, and `f` does not
/// re-borrow the same loop (no dispatch inside `f`).
#[inline]
pub(crate) fn with_loop_data<R>(loop_: *mut Loop, f: impl FnOnce(&mut InternalLoopData) -> R) -> R {
    // SAFETY: per fn contract; the exclusive borrow ends when `f` returns.
    unsafe { f(&mut (*loop_).internal_loop_data) }
}

/// Contract: `group` is a live loop-linked group on the loop thread; `f` does
/// not re-borrow it (no dispatch inside `f`).
#[inline]
pub(crate) fn with_group<R>(group: *mut SocketGroup, f: impl FnOnce(&mut SocketGroup) -> R) -> R {
    // SAFETY: per fn contract; the exclusive borrow ends when `f` returns.
    unsafe { f(&mut *group) }
}

/// Contract: `s` is a live slab-resident header on the loop thread; `f` does
/// not re-borrow it (no dispatch inside `f`).
#[inline]
pub(crate) fn with_socket<R>(s: *mut us_socket_t, f: impl FnOnce(&mut us_socket_t) -> R) -> R {
    // SAFETY: per fn contract; slab slots never move or free while the loop
    // lives (docs/design.md §Strategy 1); the exclusive borrow ends when `f` returns.
    unsafe { f(&mut *s) }
}

/// The loop's shared recv buffer as bytes, base-anchored with
/// `LIBUS_RECV_BUFFER_LENGTH` length — verbatim port of the old
/// `uws_sys::InternalLoopData::recv_slice` view (consumers apply the padding
/// offset themselves).
#[inline]
pub(crate) fn recv_slice<'a>(data: &'a mut InternalLoopData) -> &'a mut [u8] {
    debug_assert!(!data.recv_buf.is_null());
    // SAFETY: `recv_buf` is a live LIBUS_RECV_BUFFER_LENGTH +
    // 2*LIBUS_RECV_BUFFER_PADDING allocation owned by the loop; the borrow
    // inherits `data`'s exclusive lifetime.
    unsafe { core::slice::from_raw_parts_mut(data.recv_buf, crate::LIBUS_RECV_BUFFER_LENGTH) }
}
