//! `us_quic_stream_t` — one bidirectional HTTP/3 request stream. Valid
//! until its `on_stream_close` callback returns.

use core::ffi::{c_int, c_uint, c_void};
use core::ptr::NonNull;

use super::{Header, Socket};

/// Opaque FFI handle for `us_quic_stream_t`.
#[repr(C)]
pub struct Stream {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

unsafe extern "C" {
    fn us_quic_stream_socket(s: *mut Stream) -> *mut Socket;
    fn us_quic_stream_shutdown(s: *mut Stream);
    fn us_quic_stream_close(s: *mut Stream);
    fn us_quic_stream_reset(s: *mut Stream);
    fn us_quic_stream_header_count(s: *mut Stream) -> c_uint;
    fn us_quic_stream_header(s: *mut Stream, i: c_uint) -> *const Header;
    fn us_quic_stream_ext(s: *mut Stream) -> *mut c_void;
    fn us_quic_stream_write(s: *mut Stream, data: *const u8, len: c_uint) -> c_int;
    fn us_quic_stream_want_write(s: *mut Stream, want: c_int);
    fn us_quic_stream_send_headers(s: *mut Stream, h: *const Header, n: c_uint, end_stream: c_int) -> c_int;
}

impl Stream {
    pub fn socket(&mut self) -> Option<&mut Socket> {
        // SAFETY: self is a valid us_quic_stream_t; returned socket lives at least as long as the stream.
        unsafe { us_quic_stream_socket(self).as_mut() }
    }

    pub fn shutdown(&mut self) {
        // SAFETY: self is a valid us_quic_stream_t.
        unsafe { us_quic_stream_shutdown(self) }
    }

    pub fn close(&mut self) {
        // SAFETY: self is a valid us_quic_stream_t.
        unsafe { us_quic_stream_close(self) }
    }

    pub fn reset(&mut self) {
        // SAFETY: self is a valid us_quic_stream_t.
        unsafe { us_quic_stream_reset(self) }
    }

    pub fn header_count(&mut self) -> c_uint {
        // SAFETY: self is a valid us_quic_stream_t.
        unsafe { us_quic_stream_header_count(self) }
    }

    pub fn header(&mut self, i: c_uint) -> Option<&Header> {
        // SAFETY: self is a valid us_quic_stream_t; returned header borrowed from stream's header block.
        unsafe { us_quic_stream_header(self, i).as_ref() }
    }

    pub fn ext<T>(&mut self) -> &mut Option<NonNull<T>> {
        // SAFETY: self is a valid us_quic_stream_t; ext slot is pointer-sized & pointer-aligned,
        // and Option<NonNull<T>> has the same layout as Zig's `?*T` (nullable pointer).
        unsafe { &mut *us_quic_stream_ext(self).cast::<Option<NonNull<T>>>() }
    }

    pub fn write(&mut self, data: &[u8]) -> c_int {
        // SAFETY: self is a valid us_quic_stream_t; data.ptr valid for data.len() bytes.
        unsafe { us_quic_stream_write(self, data.as_ptr(), c_uint::try_from(data.len()).unwrap()) }
    }

    pub fn want_write(&mut self, want: bool) {
        // SAFETY: self is a valid us_quic_stream_t.
        unsafe { us_quic_stream_want_write(self, want as c_int) }
    }

    pub fn send_headers(&mut self, headers: &[Header], end_stream: bool) -> c_int {
        // SAFETY: self is a valid us_quic_stream_t; headers.ptr valid for headers.len() entries.
        unsafe {
            us_quic_stream_send_headers(
                self,
                headers.as_ptr(),
                c_uint::try_from(headers.len()).unwrap(),
                end_stream as c_int,
            )
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/quic/Stream.zig (48 lines)
//   confidence: high
//   todos:      0
//   notes:      opaque FFI handle + thin wrappers; Header/Socket assumed at super::
// ──────────────────────────────────────────────────────────────────────────
