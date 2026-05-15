//! `us_quic_socket_t` — one QUIC connection. Valid until its `on_close`
//! callback returns; lsquic frees the underlying `lsquic_conn` immediately
//! after, so callers must drop the pointer inside that callback.

use core::ffi::{c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle (`us_quic_socket_t`). `!Send + !Sync + !Unpin`.
    pub struct Socket;
}

// `Socket` is an `opaque_ffi!` ZST (`UnsafeCell<[u8; 0]>`), so `&mut Socket` is
// ABI-identical to a non-null `*mut Socket` with no `noalias`/`readonly`
// attribute. Shims taking only the handle + value types are `safe fn`; the
// (ptr,len) writer keeps a raw signature.
unsafe extern "C" {
    safe fn us_quic_socket_make_stream(s: &mut Socket);
    safe fn us_quic_socket_streams_avail(s: &mut Socket) -> c_uint;
    fn us_quic_socket_status(s: *mut Socket, buf: *mut u8, len: c_uint) -> c_int;
    safe fn us_quic_socket_close(s: &mut Socket);
    safe fn us_quic_socket_ext(s: &mut Socket) -> *mut c_void;
}

impl Socket {
    #[inline]
    pub fn make_stream(&mut self) {
        us_quic_socket_make_stream(self)
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

    #[inline]
    pub fn close(&mut self) {
        us_quic_socket_close(self)
    }

    /// `conn_ext_size` bytes of caller storage co-allocated with the socket.
    /// Unset until the caller writes to it after `connect`/`on_open`; the
    /// `Option<NonNull<T>>` slot pattern lets callbacks early-return on a null ext.
    #[inline]
    pub fn ext<T>(&mut self) -> &mut Option<NonNull<T>> {
        // SAFETY: us_quic_socket_ext returns conn_ext_size bytes co-allocated with
        // the socket, sized and aligned for a single nullable-pointer slot.
        // Option<NonNull<T>> is niche-optimized to the same layout as Zig's `?*T`.
        // Uniqueness: the ext bytes are caller-only storage that the C library
        // never reads or writes, and every Rust access goes through this method
        // behind `&mut self`; the elided return lifetime reborrows `self`, so the
        // borrow checker forbids a second live `&mut` to the slot.
        unsafe { &mut *us_quic_socket_ext(self).cast::<Option<NonNull<T>>>() }
    }
}

// ported from: src/uws_sys/quic/Socket.zig
