//! Closure-scoped reborrows of loop-owned raw pointers for `deny(unsafe_code)`
//! modules. Scoping guarantees no borrow spans a dispatch that can re-enter
//! consumer code (C17); slab/loop storage never frees while the loop lives.

use crate::group::SocketGroup;
use crate::socket::us_socket_t;

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
