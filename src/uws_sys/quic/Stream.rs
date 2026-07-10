//! `us_quic_stream_t` — one bidirectional HTTP/3 request stream. Valid
//! until its `on_stream_close` callback returns.

use core::cell::Cell;
use core::ffi::{c_int, c_uint, c_void};
use core::ptr::NonNull;

use super::{Header, Socket};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `us_quic_stream_t`.
    pub struct Stream;
}

// `Stream` is an `opaque_ffi!` ZST (`UnsafeCell<[u8; 0]>`): `&Stream` is ABI-identical
// to a non-null `us_quic_stream_t*` and carries no `noalias`/`readonly`, so lsquic
// mutates through it. Handle + value-type shims are `safe fn`; (ptr,len) writers are not.
unsafe extern "C" {
    safe fn us_quic_stream_socket(s: &Stream) -> *mut Socket;
    safe fn us_quic_stream_shutdown(s: &Stream);
    safe fn us_quic_stream_close(s: &Stream);
    safe fn us_quic_stream_reset(s: &Stream);
    safe fn us_quic_stream_header_count(s: &Stream) -> c_uint;
    safe fn us_quic_stream_header(s: &Stream, i: c_uint) -> *const Header;
    safe fn us_quic_stream_ext(s: &Stream) -> *mut c_void;
    fn us_quic_stream_write(s: &Stream, data: *const u8, len: c_uint) -> c_int;
    safe fn us_quic_stream_want_write(s: &Stream, want: c_int);
    safe fn us_quic_stream_want_read(s: &Stream, want: c_int);
    fn us_quic_stream_send_headers(
        s: &Stream,
        h: *const Header,
        n: c_uint,
        end_stream: c_int,
    ) -> c_int;
}

impl Stream {
    pub fn socket(&self) -> Option<NonNull<Socket>> {
        // Raw pointer (not &mut) because the Socket is the *parent connection shared by
        // every stream on it* — a conn-level callback may already hold &mut Socket, so
        // minting one here would alias. Callers reborrow under their own SAFETY proof.
        NonNull::new(us_quic_stream_socket(self))
    }

    pub fn shutdown(&self) {
        us_quic_stream_shutdown(self)
    }

    pub fn close(&self) {
        us_quic_stream_close(self)
    }

    pub fn reset(&self) {
        us_quic_stream_reset(self)
    }

    pub fn header_count(&self) -> c_uint {
        us_quic_stream_header_count(self)
    }

    pub fn header(&self, i: c_uint) -> Option<&Header> {
        // SAFETY: self is a valid us_quic_stream_t; returned header borrowed from stream's header block.
        unsafe { us_quic_stream_header(self, i).as_ref() }
    }

    pub fn ext<T>(&self) -> &Cell<Option<NonNull<T>>> {
        // SAFETY: self is a valid us_quic_stream_t; ext slot is pointer-sized & pointer-aligned,
        // and Option<NonNull<T>> has nullable-pointer layout. `Cell` is repr(transparent), so no
        // &mut into the slot is ever live across a callback that re-enters lsquic.
        unsafe { &*us_quic_stream_ext(self).cast::<Cell<Option<NonNull<T>>>>() }
    }

    pub fn write(&self, data: &[u8]) -> c_int {
        // SAFETY: self is a valid us_quic_stream_t; data.ptr valid for data.len() bytes.
        unsafe {
            us_quic_stream_write(
                self,
                data.as_ptr(),
                c_uint::try_from(data.len()).expect("int cast"),
            )
        }
    }

    pub fn want_write(&self, want: bool) {
        us_quic_stream_want_write(self, want as c_int)
    }

    pub fn want_read(&self, want: bool) {
        us_quic_stream_want_read(self, want as c_int)
    }

    pub fn send_headers(&self, headers: &[Header], end_stream: bool) -> c_int {
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
