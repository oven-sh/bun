//! `us_quic_socket_t` — one QUIC connection. Valid until its `on_close`
//! callback returns; lsquic frees the underlying `lsquic_conn` immediately
//! after, so callers must drop the pointer inside that callback.

use core::ffi::{c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

/// Opaque FFI handle (`us_quic_socket_t`). `!Send + !Sync + !Unpin`.
#[repr(C)]
pub struct Socket {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

unsafe extern "C" {
    fn us_quic_socket_make_stream(s: *mut Socket);
    fn us_quic_socket_streams_avail(s: *mut Socket) -> c_uint;
    fn us_quic_socket_status(s: *mut Socket, buf: *mut u8, len: c_uint) -> c_int;
    fn us_quic_socket_close(s: *mut Socket);
    fn us_quic_socket_ext(s: *mut Socket) -> *mut c_void;
}

impl Socket {
    #[inline]
    pub fn make_stream(&mut self) {
        // SAFETY: self is a live us_quic_socket_t (valid until on_close returns).
        unsafe { us_quic_socket_make_stream(self) }
    }

    #[inline]
    pub fn streams_avail(&mut self) -> c_uint {
        // SAFETY: self is a live us_quic_socket_t.
        unsafe { us_quic_socket_streams_avail(self) }
    }

    #[inline]
    pub fn status(&mut self, buf: &mut [u8]) -> c_int {
        // SAFETY: self is a live us_quic_socket_t; buf.ptr is valid for buf.len bytes.
        unsafe {
            us_quic_socket_status(
                self,
                buf.as_mut_ptr(),
                c_uint::try_from(buf.len()).unwrap(),
            )
        }
    }

    #[inline]
    pub fn close(&mut self) {
        // SAFETY: self is a live us_quic_socket_t.
        unsafe { us_quic_socket_close(self) }
    }

    /// `conn_ext_size` bytes of caller storage co-allocated with the socket.
    /// Unset until the caller writes to it after `connect`/`on_open`; the
    /// `Option<NonNull<T>>` slot pattern lets callbacks early-return on a null ext.
    #[inline]
    pub fn ext<T>(&mut self) -> &mut Option<NonNull<T>> {
        // SAFETY: us_quic_socket_ext returns conn_ext_size bytes co-allocated with
        // the socket, sized and aligned for a single nullable-pointer slot.
        // Option<NonNull<T>> is niche-optimized to the same layout as Zig's `?*T`.
        unsafe { &mut *us_quic_socket_ext(self).cast::<Option<NonNull<T>>>() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/quic/Socket.zig (27 lines)
//   confidence: high
//   todos:      0
//   notes:      opaque FFI handle + extern wrappers; ext<T> returns &mut Option<NonNull<T>> (same layout as Zig ?*T)
// ──────────────────────────────────────────────────────────────────────────
