#![allow(non_camel_case_types, non_snake_case)]

use core::ffi::{c_char, c_int};

pub use crate::shared::{
    DataType, FlushValue, ReturnCode, alloc_func, free_func, struct_internal_state, z_alloc_fn,
    z_free_fn, z_stream, z_streamp, zStream_struct,
};

unsafe extern "C" {
    pub safe fn zlibVersion() -> *const c_char;

    pub fn deflateInit_(
        strm: z_streamp,
        level: c_int,
        version: *const c_char,
        stream_size: c_int,
    ) -> ReturnCode;
    pub fn inflateInit_(strm: z_streamp, version: *const c_char, stream_size: c_int) -> ReturnCode;
    pub fn deflateInit2_(
        strm: z_streamp,
        level: c_int,
        method: c_int,
        windowBits: c_int,
        memLevel: c_int,
        strategy: c_int,
        version: *const c_char,
        stream_size: c_int,
    ) -> ReturnCode;
    pub fn inflateInit2_(
        strm: z_streamp,
        windowBits: c_int,
        version: *const c_char,
        stream_size: c_int,
    ) -> ReturnCode;
    pub fn inflateBackInit_(
        strm: z_streamp,
        windowBits: c_int,
        window: *mut u8,
        version: *const c_char,
        stream_size: c_int,
    ) -> ReturnCode;
}

#[inline]
pub unsafe fn deflate_init(strm: z_streamp, level: c_int) -> ReturnCode {
    // SAFETY: caller guarantees `strm` points to a valid z_stream; zlib reads version/size to ABI-check
    unsafe {
        deflateInit_(
            strm,
            level,
            zlibVersion(),
            core::mem::size_of::<z_stream>() as c_int,
        )
    }
}
#[inline]
pub unsafe fn inflate_init(strm: z_streamp) -> ReturnCode {
    // SAFETY: caller guarantees `strm` points to a valid z_stream
    unsafe {
        inflateInit_(
            strm,
            zlibVersion(),
            core::mem::size_of::<z_stream>() as c_int,
        )
    }
}
#[inline]
pub unsafe fn deflate_init2(
    strm: z_streamp,
    level: c_int,
    method: c_int,
    window_bits: c_int,
    mem_level: c_int,
    strategy: c_int,
) -> ReturnCode {
    // SAFETY: caller guarantees `strm` points to a valid z_stream
    unsafe {
        deflateInit2_(
            strm,
            level,
            method,
            window_bits,
            mem_level,
            strategy,
            zlibVersion(),
            core::mem::size_of::<z_stream>() as c_int,
        )
    }
}
#[inline]
pub unsafe fn inflate_init2(strm: z_streamp, window_bits: c_int) -> ReturnCode {
    // SAFETY: caller guarantees `strm` points to a valid z_stream
    unsafe {
        inflateInit2_(
            strm,
            window_bits,
            zlibVersion(),
            core::mem::size_of::<z_stream>() as c_int,
        )
    }
}
#[inline]
pub unsafe fn inflate_back_init(
    strm: z_streamp,
    window_bits: c_int,
    window: *mut u8,
) -> ReturnCode {
    // SAFETY: caller guarantees `strm` and `window` are valid for zlib's lifetime requirements
    unsafe {
        inflateBackInit_(
            strm,
            window_bits,
            window,
            zlibVersion(),
            core::mem::size_of::<z_stream>() as c_int,
        )
    }
}

// ported from: src/zlib_sys/posix.zig
