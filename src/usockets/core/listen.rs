//! ListenSocket.
//!
//! Safe-field mirror of `us_listen_socket_t`. Opaque to C++ — only ever
//! reached through `us_listen_socket_*` accessors — so the layout may diverge
//! from `types.rs::us_listen_socket_t` (it gains a `prev` link to fit
//! `IntrusiveList`). First field is `SocketHeader` so `(ls as *mut Poll)` /
//! `(ls as *mut SocketHeader)` remain valid for the poll dispatch path.

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr::{self, NonNull};

use crate::core::group::SocketGroup;
use crate::core::list::{Linked, ListLinks};
use crate::core::socket::SocketHeader;
use crate::types::us_socket_t;

/// SNI resolver: returns the `SSL_CTX` to serve for `hostname` on this
/// handshake only, or null to fall through to the default context.
pub type OnServerName = Option<
    unsafe extern "C" fn(
        *mut ListenSocket,
        *const c_char,
        *mut c_int,
        *mut us_socket_t,
    ) -> *mut bun_boringssl_sys::SSL_CTX,
>;

/// A listening socket plus the template stamped on every accepted connection
/// (`accept_group`, `accept_kind`, `socket_ext_size`, `ssl_ctx`).
#[repr(C, align(16))]
pub struct ListenSocket {
    pub(crate) s: SocketHeader,
    /// Group accepted sockets are linked into (usually `s.group`, but distinct).
    pub(crate) accept_group: Cell<Option<NonNull<SocketGroup>>>,
    /// Intrusive `prev`/`next` for [`SocketGroup::listeners`].
    pub(crate) links: ListLinks<ListenSocket>,
    /// `SSL_CTX` for accepted sockets; borrowed (up-ref'd while listening).
    pub(crate) ssl_ctx: Cell<*mut bun_boringssl_sys::SSL_CTX>,
    /// SNI hostname → {SSL_CTX*, user*} tree. Owned.
    pub(crate) sni: Cell<*mut c_void>,
    pub(crate) on_server_name: Cell<OnServerName>,
    pub(crate) socket_ext_size: Cell<c_uint>,
    /// `kind` to stamp on accepted sockets.
    pub(crate) accept_kind: Cell<u8>,
    /// Set when `TCP_DEFER_ACCEPT`/`SO_ACCEPTFILTER` was successfully applied.
    pub(crate) deferred_accept: Cell<u8>,
}

// SAFETY: `links` is an embedded `ListLinks<Self>` used by exactly one list
// (`SocketGroup::listeners`) and lives exactly as long as `*p`.
unsafe impl Linked for ListenSocket {
    #[inline(always)]
    fn links(p: NonNull<Self>) -> NonNull<ListLinks<Self>> {
        // SAFETY: field projection into live `*p` per the `Linked` contract.
        unsafe { NonNull::new_unchecked(ptr::addr_of_mut!((*p.as_ptr()).links)) }
    }
}

impl ListenSocket {
    #[inline(always)]
    pub fn header(&self) -> &SocketHeader {
        &self.s
    }

    #[inline]
    pub fn is_closed(&self) -> bool {
        self.s.flags.is_closed()
    }

    #[inline]
    pub fn accept_group(&self) -> Option<NonNull<SocketGroup>> {
        self.accept_group.get()
    }

    /// Pointer to the trailing ext area (the bytes immediately after the struct).
    #[inline(always)]
    pub fn ext_ptr(&self) -> *mut c_void {
        // SAFETY: allocated with trailing ext storage; `add(1)` lands on it.
        unsafe { NonNull::from(self).as_ptr().add(1).cast() }
    }
}

const _: () = {
    use core::mem::offset_of;
    assert!(offset_of!(ListenSocket, s) == 0);
};
