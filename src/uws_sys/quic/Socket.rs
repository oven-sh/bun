//! `us_quic_socket_t` — one QUIC connection. Valid until its `on_close`
//! callback returns; lsquic frees the underlying `lsquic_conn` immediately
//! after, so callers must drop the pointer inside that callback.

use core::ffi::{c_int, c_uint, c_void};
use core::ptr::NonNull;

bun_opaque::opaque_handle! { pub struct Socket; }

// `Socket` is a pinned ZST, so `&mut Socket` is
// ABI-identical to a non-null `*mut Socket` with no `noalias`/`readonly`
// attribute. Shims taking only the handle + value types are `safe fn`; the
// (ptr,len) writer keeps a raw signature.
unsafe extern "C" {
    safe fn us_quic_socket_make_stream(s: &mut Socket);
    safe fn us_quic_socket_streams_avail(s: &mut Socket) -> c_uint;
    fn us_quic_socket_status(s: *mut Socket, buf: *mut u8, len: c_uint) -> c_int;
    safe fn us_quic_socket_ext(s: &mut Socket) -> &mut Option<NonNull<c_void>>;
    safe fn us_quic_socket_close(s: &mut Socket);
}

impl Socket {
    #[inline]
    pub fn make_stream(&mut self) {
        us_quic_socket_make_stream(self)
    }

    /// Closes the connection; `on_close` fires from the next engine tick.
    #[inline]
    pub fn close(&mut self) {
        us_quic_socket_close(self)
    }

    #[inline]
    pub fn streams_avail(&mut self) -> c_uint {
        us_quic_socket_streams_avail(self)
    }

    #[inline]
    pub fn status(&mut self, buf: &mut [u8]) -> c_int {
        // SAFETY: self is a live us_quic_socket_t; buf.ptr is valid for buf.len bytes.
        unsafe {
            us_quic_socket_status(
                self,
                buf.as_mut_ptr(),
                c_uint::try_from(buf.len()).expect("int cast"),
            )
        }
    }

    /// The handshake is done, and neither side is closing or going away.
    #[inline]
    pub fn is_connected(&mut self) -> bool {
        const LSCONN_ST_CONNECTED: c_int = 1;
        self.status(&mut []) == LSCONN_ST_CONNECTED
    }

    /// `conn_ext_size` bytes of caller storage co-allocated with the socket.
    /// Unset until the caller writes to it after `connect`/`on_open`; the
    /// `Option<NonNull<_>>` slot pattern lets callbacks early-return on a null ext.
    #[inline]
    pub fn ext(&mut self) -> &mut Option<NonNull<c_void>> {
        us_quic_socket_ext(self)
    }
}
