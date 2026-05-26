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

// ported from: src/zlib_sys/posix.zig
