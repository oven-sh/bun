#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals)]

use core::ffi::{c_char, c_int, c_uint, c_void};

pub use crate::shared::{
    Bytef, DataType, FlushValue, ReturnCode, uInt, uLong, uLongf, z_stream, z_streamp,
    zStream_struct,
};

#[repr(C)]
pub struct struct_gz_header_s {
    pub text: c_int,
    pub time: uLong,
    pub xflags: c_int,
    pub os: c_int,
    pub extra: *mut Bytef,
    pub extra_len: uInt,
    pub extra_max: uInt,
    pub name: *mut Bytef,
    pub name_max: uInt,
    pub comment: *mut Bytef,
    pub comm_max: uInt,
    pub hcrc: c_int,
    pub done: c_int,
}
pub(crate) type gz_header = struct_gz_header_s;
pub(crate) type gz_headerp = *mut gz_header;

pub(crate) type in_func = Option<unsafe extern "C" fn(*mut c_void, *mut *mut u8) -> c_uint>;
pub(crate) type out_func = Option<unsafe extern "C" fn(*mut c_void, *mut u8, c_uint) -> ReturnCode>;

unsafe extern "C" {
    pub safe fn zlibVersion() -> *const c_char;
    pub fn deflate(strm: z_streamp, flush: FlushValue) -> ReturnCode;
    pub fn deflateEnd(strm: z_streamp) -> ReturnCode;
    pub fn inflate(strm: z_streamp, flush: FlushValue) -> ReturnCode;
    pub fn inflateEnd(strm: z_streamp) -> ReturnCode;
    pub fn deflateSetDictionary(
        strm: z_streamp,
        dictionary: *const Bytef,
        dictLength: uInt,
    ) -> ReturnCode;
    pub fn deflateReset(strm: z_streamp) -> ReturnCode;
    pub fn deflateParams(strm: z_streamp, level: c_int, strategy: c_int) -> ReturnCode;
    pub fn deflateBound(strm: z_streamp, sourceLen: uLong) -> uLong;
    pub fn deflateSetHeader(strm: z_streamp, head: gz_headerp) -> ReturnCode;
    pub fn inflateSetDictionary(
        strm: z_streamp,
        dictionary: *const Bytef,
        dictLength: uInt,
    ) -> ReturnCode;
    pub fn inflateSync(strm: z_streamp) -> ReturnCode;
    pub fn inflateReset(strm: z_streamp) -> ReturnCode;
    pub fn inflateReset2(strm: z_streamp, windowBits: c_int) -> ReturnCode;
    pub fn inflateGetHeader(strm: z_streamp, head: gz_headerp) -> ReturnCode;
    pub fn inflateBack(
        strm: z_streamp,
        in_: in_func,
        in_desc: *mut c_void,
        out: out_func,
        out_desc: *mut c_void,
    ) -> ReturnCode;
    pub fn compress(
        dest: *mut Bytef,
        destLen: *mut uLongf,
        source: *const Bytef,
        sourceLen: uLong,
    ) -> ReturnCode;
    pub fn compress2(
        dest: *mut Bytef,
        destLen: *mut uLongf,
        source: *const Bytef,
        sourceLen: uLong,
        level: c_int,
    ) -> ReturnCode;
    pub safe fn compressBound(sourceLen: uLong) -> uLong;
    pub fn uncompress(
        dest: *mut Bytef,
        destLen: *mut uLongf,
        source: *const Bytef,
        sourceLen: uLong,
    ) -> ReturnCode;
    pub fn adler32(adler: uLong, buf: *const Bytef, len: uInt) -> uLong;
    pub fn crc32(crc: uLong, buf: *const Bytef, len: uInt) -> uLong;
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
    // pub fn get_crc_table() -> *const z_crc_t;
    pub fn inflateResetKeep(strm: z_streamp) -> ReturnCode;
    pub fn deflateResetKeep(strm: z_streamp) -> ReturnCode;
}
