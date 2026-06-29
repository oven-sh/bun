//! `us_quic_stream_t` — one bidirectional HTTP/3 request stream. Valid
//! until its `on_stream_close` callback returns.

use core::ffi::{c_int, c_uint, c_void};
use core::ptr::NonNull;

use super::{Header, Socket};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `us_quic_stream_t`.
    pub struct Stream;
}

/// HTTP/3 application error code (RFC 9114 §8.1), carried on RESET_STREAM
/// and STOP_SENDING frames. Mirrors `http_types::h2::ErrorCode`.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ErrorCode(pub u64);
impl ErrorCode {
    pub const NO_ERROR: Self = Self(0x0100);
    pub const GENERAL_PROTOCOL_ERROR: Self = Self(0x0101);
    pub const INTERNAL_ERROR: Self = Self(0x0102);
    pub const STREAM_CREATION_ERROR: Self = Self(0x0103);
    pub const CLOSED_CRITICAL_STREAM: Self = Self(0x0104);
    pub const FRAME_UNEXPECTED: Self = Self(0x0105);
    pub const FRAME_ERROR: Self = Self(0x0106);
    pub const EXCESSIVE_LOAD: Self = Self(0x0107);
    pub const ID_ERROR: Self = Self(0x0108);
    pub const SETTINGS_ERROR: Self = Self(0x0109);
    pub const MISSING_SETTINGS: Self = Self(0x010a);
    pub const REQUEST_REJECTED: Self = Self(0x010b);
    pub const REQUEST_CANCELLED: Self = Self(0x010c);
    pub const REQUEST_INCOMPLETE: Self = Self(0x010d);
    pub const MESSAGE_ERROR: Self = Self(0x010e);
    pub const CONNECT_ERROR: Self = Self(0x010f);
    pub const VERSION_FALLBACK: Self = Self(0x0110);
}

// `Stream` is an `opaque_ffi!` ZST (`UnsafeCell<[u8; 0]>`), so `&mut Stream` is
// ABI-identical to a non-null `*mut Stream` with no `noalias`/`readonly`
// attribute. Shims taking only the handle + value types are `safe fn`; the
// (ptr,len) writers keep raw signatures.
unsafe extern "C" {
    safe fn us_quic_stream_socket(s: &mut Stream) -> *mut Socket;
    safe fn us_quic_stream_shutdown(s: &mut Stream);
    safe fn us_quic_stream_close(s: &mut Stream);
    safe fn us_quic_stream_reset(s: &mut Stream, code: u64);
    safe fn us_quic_stream_peer_error_code(s: &mut Stream) -> u64;
    safe fn us_quic_stream_header_count(s: &mut Stream) -> c_uint;
    safe fn us_quic_stream_header(s: &mut Stream, i: c_uint) -> *const Header;
    safe fn us_quic_stream_ext(s: &mut Stream) -> *mut c_void;
    fn us_quic_stream_write(s: *mut Stream, data: *const u8, len: c_uint) -> c_int;
    safe fn us_quic_stream_want_write(s: &mut Stream, want: c_int);
    safe fn us_quic_stream_want_read(s: &mut Stream, want: c_int);
    fn us_quic_stream_send_headers(
        s: *mut Stream,
        h: *const Header,
        n: c_uint,
        end_stream: c_int,
    ) -> c_int;
}

impl Stream {
    pub fn socket(&mut self) -> Option<NonNull<Socket>> {
        // Returned as a raw pointer (not &mut) because the Socket is the *parent
        // connection shared by every stream on it* — two live &mut Stream on the
        // same conn calling .socket() (or a conn-level callback already holding
        // &mut Socket) would otherwise yield aliasing &mut Socket, which is UB.
        // Callers reborrow locally under their own SAFETY proof.
        NonNull::new(us_quic_stream_socket(self))
    }

    pub fn shutdown(&mut self) {
        us_quic_stream_shutdown(self)
    }

    pub fn close(&mut self) {
        us_quic_stream_close(self)
    }

    /// Signal an HTTP/3 stream error carrying `code` (RFC 9114 §8.1):
    /// RESET_STREAM if the send half is still open, STOP_SENDING otherwise.
    pub fn reset(&mut self, code: ErrorCode) {
        us_quic_stream_reset(self, code.0)
    }

    /// Application error code from the peer's RESET_STREAM or STOP_SENDING
    /// frame (RFC 9114 §8.1), or `NO_ERROR`'s absence (0) if none arrived.
    pub fn peer_error_code(&mut self) -> u64 {
        us_quic_stream_peer_error_code(self)
    }

    pub fn header_count(&mut self) -> c_uint {
        us_quic_stream_header_count(self)
    }

    pub fn header(&mut self, i: c_uint) -> Option<&Header> {
        // SAFETY: self is a valid us_quic_stream_t; returned header borrowed from stream's header block.
        unsafe { us_quic_stream_header(self, i).as_ref() }
    }

    pub fn ext<T>(&mut self) -> &mut Option<NonNull<T>> {
        // SAFETY: self is a valid us_quic_stream_t; ext slot is pointer-sized & pointer-aligned,
        // and Option<NonNull<T>> has nullable-pointer layout.
        // Aliasing: the ext slot is disjoint storage returned by C (not overlapping the
        // zero-sized opaque `Stream` handle), and the returned &mut borrows from &mut self
        // so no second &mut to the slot can be obtained while this one is live.
        unsafe { &mut *us_quic_stream_ext(self).cast::<Option<NonNull<T>>>() }
    }

    pub fn write(&mut self, data: &[u8]) -> c_int {
        // SAFETY: self is a valid us_quic_stream_t; data.ptr valid for data.len() bytes.
        unsafe {
            us_quic_stream_write(
                self,
                data.as_ptr(),
                c_uint::try_from(data.len()).expect("int cast"),
            )
        }
    }

    pub fn want_write(&mut self, want: bool) {
        us_quic_stream_want_write(self, want as c_int)
    }

    pub fn want_read(&mut self, want: bool) {
        us_quic_stream_want_read(self, want as c_int)
    }

    pub fn send_headers(&mut self, headers: &[Header], end_stream: bool) -> c_int {
        // SAFETY: self is a valid us_quic_stream_t; headers.ptr valid for headers.len() entries.
        unsafe {
            us_quic_stream_send_headers(
                self,
                headers.as_ptr(),
                c_uint::try_from(headers.len()).expect("int cast"),
                end_stream as c_int,
            )
        }
    }
}
