//! trait Handler, VTable, vtable_for<H>(), ExtSlot<T>.
//!
//! `Handler` is the safe-Rust shape every socket owner implements: a typed
//! `Ext` block stored in the socket's trailing bytes plus `on_*` callbacks
//! with default no-op bodies. A static [`VTable`] built from a `Handler` is
//! what `SocketGroup::vtable` points at, letting the FFI `us_dispatch_*`
//! functions call into safe Rust.

#![allow(unused_variables)]

use core::ffi::{c_int, c_void};

use crate::core::socket::Socket;
use crate::types::us_bun_verify_error_t;

/// The FFI vtable (`struct us_socket_vtable_t`).
pub type VTable = crate::types::us_socket_vtable_t;

/// TLS handshake verification result delivered to [`Handler::on_handshake`].
pub type VerifyError = us_bun_verify_error_t;

/// Per-`kind` callback set for stream sockets. Every method has a default
/// empty body so implementors override only what they need.
pub trait Handler: 'static {
    /// Layout of the trailing ext bytes on every socket of this kind.
    type Ext: 'static;

    /// `SocketHeader::kind` value this handler dispatches for.
    const KIND: u8;

    fn on_open(ext: &mut Self::Ext, s: Socket<'_>, is_client: bool, ip: &[u8]) {}
    fn on_data(ext: &mut Self::Ext, s: Socket<'_>, data: &[u8]) {}
    fn on_writable(ext: &mut Self::Ext, s: Socket<'_>) {}
    fn on_close(ext: &mut Self::Ext, s: Socket<'_>, code: c_int, reason: *mut c_void) {}
    fn on_end(ext: &mut Self::Ext, s: Socket<'_>) {}
    fn on_timeout(ext: &mut Self::Ext, s: Socket<'_>) {}
    fn on_long_timeout(ext: &mut Self::Ext, s: Socket<'_>) {}
    fn on_connect_error(ext: &mut Self::Ext, s: Socket<'_>, code: c_int) {}
    fn on_handshake(ext: &mut Self::Ext, s: Socket<'_>, ok: bool, err: VerifyError) {}
    fn on_fd(ext: &mut Self::Ext, s: Socket<'_>, fd: c_int) {}
}
