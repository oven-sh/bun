#![allow(non_camel_case_types, non_snake_case)]

use core::ffi::{c_char, c_int, c_uint, c_ulong, c_void};

type uInt = c_uint;
type uLong = c_ulong;

#[repr(C)]
pub struct struct_internal_state {
    dummy: c_int,
}

// https://zlib.net/manual.html#Stream
type voidpf = *mut c_void;

// typedef voidpf (*alloc_func) OF((voidpf opaque, uInt items, uInt size));
// typedef void   (*free_func)  OF((voidpf opaque, voidpf address));

pub type z_alloc_fn = Option<unsafe extern "C" fn(*mut c_void, uInt, uInt) -> voidpf>;
pub type z_free_fn = Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>;

#[repr(C)]
pub struct zStream_struct {
    /// next input byte
    pub next_in: *const u8,
    /// number of bytes available at next_in
    pub avail_in: uInt,
    /// total number of input bytes read so far
    pub total_in: uLong,

    /// next output byte will go here
    pub next_out: *mut u8,
    /// remaining free space at next_out
    pub avail_out: uInt,
    /// total number of bytes output so far
    pub total_out: uLong,

    /// last error message, NULL if no error
    pub err_msg: *const c_char,
    /// not visible by applications
    pub internal_state: *mut struct_internal_state,

    /// used to allocate the internal state
    pub alloc_func: z_alloc_fn,
    /// used to free the internal state
    pub free_func: z_free_fn,
    /// private data object passed to zalloc and zfree
    pub user_data: *mut c_void,

    /// best guess about the data type: binary or text for deflate, or the decoding state for inflate
    pub data_type: DataType,

    /// Adler-32 or CRC-32 value of the uncompressed data
    pub adler: uLong,
    /// reserved for future use
    pub reserved: uLong,
}

pub type z_stream = zStream_struct;
pub type z_streamp = *mut z_stream;

pub use crate::shared::DataType;
pub use crate::shared::FlushValue;
pub use crate::shared::ReturnCode;

unsafe extern "C" {
    pub fn zlibVersion() -> *const c_char;

    pub fn deflateInit_(strm: z_streamp, level: c_int, version: *const c_char, stream_size: c_int) -> ReturnCode;
    pub fn inflateInit_(strm: z_streamp, version: *const c_char, stream_size: c_int) -> ReturnCode;
    pub fn deflateInit2_(strm: z_streamp, level: c_int, method: c_int, windowBits: c_int, memLevel: c_int, strategy: c_int, version: *const c_char, stream_size: c_int) -> ReturnCode;
    pub fn inflateInit2_(strm: z_streamp, windowBits: c_int, version: *const c_char, stream_size: c_int) -> ReturnCode;
    pub fn inflateBackInit_(strm: z_streamp, windowBits: c_int, window: *mut u8, version: *const c_char, stream_size: c_int) -> ReturnCode;
}

#[inline]
pub unsafe fn deflate_init(strm: z_streamp, level: c_int) -> ReturnCode {
    // SAFETY: caller guarantees `strm` points to a valid z_stream; zlib reads version/size to ABI-check
    unsafe { deflateInit_(strm, level, zlibVersion(), core::mem::size_of::<z_stream>() as c_int) }
}
#[inline]
pub unsafe fn inflate_init(strm: z_streamp) -> ReturnCode {
    // SAFETY: caller guarantees `strm` points to a valid z_stream
    unsafe { inflateInit_(strm, zlibVersion(), core::mem::size_of::<z_stream>() as c_int) }
}
#[inline]
pub unsafe fn deflate_init2(strm: z_streamp, level: c_int, method: c_int, window_bits: c_int, mem_level: c_int, strategy: c_int) -> ReturnCode {
    // SAFETY: caller guarantees `strm` points to a valid z_stream
    unsafe { deflateInit2_(strm, level, method, window_bits, mem_level, strategy, zlibVersion(), core::mem::size_of::<z_stream>() as c_int) }
}
#[inline]
pub unsafe fn inflate_init2(strm: z_streamp, window_bits: c_int) -> ReturnCode {
    // SAFETY: caller guarantees `strm` points to a valid z_stream
    unsafe { inflateInit2_(strm, window_bits, zlibVersion(), core::mem::size_of::<z_stream>() as c_int) }
}
#[inline]
pub unsafe fn inflate_back_init(strm: z_streamp, window_bits: c_int, window: *mut u8) -> ReturnCode {
    // SAFETY: caller guarantees `strm` and `window` are valid for zlib's lifetime requirements
    unsafe { inflateBackInit_(strm, window_bits, window, zlibVersion(), core::mem::size_of::<z_stream>() as c_int) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/zlib_sys/posix.zig (80 lines)
//   confidence: high
//   todos:      0
//   notes:      anytype params on init wrappers concretized to z_streamp/c_int (zlib.h macro semantics)
// ──────────────────────────────────────────────────────────────────────────
