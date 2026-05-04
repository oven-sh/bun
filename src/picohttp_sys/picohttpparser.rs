use core::ffi::c_int;

// TODO: use translate-c for this
#[repr(C)]
#[derive(Copy, Clone)]
pub struct struct_phr_header {
    pub name: *const u8,
    pub name_len: usize,
    pub value: *const u8,
    pub value_len: usize,
}

unsafe extern "C" {
    pub fn phr_parse_request(
        buf: *const u8,
        len: usize,
        method: *mut *const u8,
        method_len: *mut usize,
        path: *mut *const u8,
        path_len: *mut usize,
        minor_version: *mut c_int,
        headers: *mut struct_phr_header,
        num_headers: *mut usize,
        last_len: usize,
    ) -> c_int;

    pub fn phr_parse_response(
        _buf: *const u8,
        len: usize,
        minor_version: *mut c_int,
        status: *mut c_int,
        msg: *mut *const u8,
        msg_len: *mut usize,
        headers: *mut struct_phr_header,
        num_headers: *mut usize,
        last_len: usize,
    ) -> c_int;

    pub fn phr_parse_headers(
        buf: *const u8,
        len: usize,
        headers: *mut struct_phr_header,
        num_headers: *mut usize,
        last_len: usize,
    ) -> c_int;
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct struct_phr_chunked_decoder {
    pub bytes_left_in_chunk: usize,
    pub consume_trailer: u8,
    pub _hex_count: u8,
    pub _state: ChunkedEncodingState,
}

impl Default for struct_phr_chunked_decoder {
    fn default() -> Self {
        Self {
            bytes_left_in_chunk: 0,
            consume_trailer: 0,
            _hex_count: 0,
            _state: ChunkedEncodingState::CHUNKED_IN_CHUNK_SIZE,
        }
    }
}

unsafe extern "C" {
    pub fn phr_decode_chunked(
        decoder: *mut struct_phr_chunked_decoder,
        buf: *mut u8,
        bufsz: *mut usize,
    ) -> isize;

    pub fn phr_decode_chunked_is_in_data(decoder: *mut struct_phr_chunked_decoder) -> c_int;
}

pub type phr_header = struct_phr_header;
pub type phr_chunked_decoder = struct_phr_chunked_decoder;

// Zig: `enum(u8) { ..., _ }` — non-exhaustive (C may write any u8 into `_state`).
// A Rust `#[repr(u8)] enum` would be UB for values outside 0..=5, so use a
// transparent newtype with associated consts instead.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct ChunkedEncodingState(pub u8);

#[allow(non_upper_case_globals)]
impl ChunkedEncodingState {
    pub const CHUNKED_IN_CHUNK_SIZE: Self = Self(0);
    pub const CHUNKED_IN_CHUNK_EXT: Self = Self(1);
    pub const CHUNKED_IN_CHUNK_DATA: Self = Self(2);
    pub const CHUNKED_IN_CHUNK_CRLF: Self = Self(3);
    pub const CHUNKED_IN_TRAILERS_LINE_HEAD: Self = Self(4);
    pub const CHUNKED_IN_TRAILERS_LINE_MIDDLE: Self = Self(5);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/picohttp_sys/picohttpparser.zig (30 lines)
//   confidence: high
//   todos:      0
//   notes:      ChunkedEncodingState ported as transparent u8 newtype (Zig enum was non-exhaustive `_`); raw FFI bindings only
// ──────────────────────────────────────────────────────────────────────────
