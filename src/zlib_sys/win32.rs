#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals)]

use core::ffi::{c_char, c_int, c_long, c_uint, c_ulong, c_void};

pub use crate::shared::{
    Bytef, DataType, FlushValue, ReturnCode, alloc_func, free_func, gzFile, gzFile_s,
    internal_state, struct_gzFile_s, struct_internal_state, struct_z_stream_s, uInt, uLong, uLongf,
    voidpf, z_alloc_func, z_free_func, z_stream, z_stream_s, z_streamp, zStream_struct,
};

type z_size_t = usize;
type voidpc = *const c_void;
type voidp = *mut c_void;

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
pub type gz_header = struct_gz_header_s;
pub type gz_headerp = *mut gz_header;

pub type in_func = Option<unsafe extern "C" fn(*mut c_void, *mut *mut u8) -> c_uint>;
pub type out_func = Option<unsafe extern "C" fn(*mut c_void, *mut u8, c_uint) -> ReturnCode>;

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
    pub fn deflateGetDictionary(
        strm: z_streamp,
        dictionary: *mut Bytef,
        dictLength: *mut uInt,
    ) -> ReturnCode;
    pub fn deflateCopy(dest: z_streamp, source: z_streamp) -> ReturnCode;
    pub fn deflateReset(strm: z_streamp) -> ReturnCode;
    pub fn deflateParams(strm: z_streamp, level: c_int, strategy: c_int) -> ReturnCode;
    pub fn deflateTune(
        strm: z_streamp,
        good_length: c_int,
        max_lazy: c_int,
        nice_length: c_int,
        max_chain: c_int,
    ) -> ReturnCode;
    pub fn deflateBound(strm: z_streamp, sourceLen: uLong) -> uLong;
    pub fn deflatePending(strm: z_streamp, pending: *mut c_uint, bits: *mut c_int) -> ReturnCode;
    pub fn deflatePrime(strm: z_streamp, bits: c_int, value: c_int) -> ReturnCode;
    pub fn deflateSetHeader(strm: z_streamp, head: gz_headerp) -> ReturnCode;
    pub fn inflateSetDictionary(
        strm: z_streamp,
        dictionary: *const Bytef,
        dictLength: uInt,
    ) -> ReturnCode;
    pub fn inflateGetDictionary(
        strm: z_streamp,
        dictionary: *mut Bytef,
        dictLength: *mut uInt,
    ) -> ReturnCode;
    pub fn inflateSync(strm: z_streamp) -> ReturnCode;
    pub fn inflateCopy(dest: z_streamp, source: z_streamp) -> ReturnCode;
    pub fn inflateReset(strm: z_streamp) -> ReturnCode;
    pub fn inflateReset2(strm: z_streamp, windowBits: c_int) -> ReturnCode;
    pub fn inflatePrime(strm: z_streamp, bits: c_int, value: c_int) -> ReturnCode;
    pub fn inflateMark(strm: z_streamp) -> c_long;
    pub fn inflateGetHeader(strm: z_streamp, head: gz_headerp) -> ReturnCode;
    pub fn inflateBack(
        strm: z_streamp,
        in_: in_func,
        in_desc: *mut c_void,
        out: out_func,
        out_desc: *mut c_void,
    ) -> ReturnCode;
    pub fn inflateBackEnd(strm: z_streamp) -> ReturnCode;
    pub safe fn zlibCompileFlags() -> uLong;
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
    pub fn uncompress2(
        dest: *mut Bytef,
        destLen: *mut uLongf,
        source: *const Bytef,
        sourceLen: *mut uLong,
    ) -> ReturnCode;
    pub fn gzdopen(fd: c_int, mode: *const u8) -> gzFile;
    pub fn gzbuffer(file: gzFile, size: c_uint) -> ReturnCode;
    pub fn gzsetparams(file: gzFile, level: c_int, strategy: c_int) -> ReturnCode;
    pub fn gzread(file: gzFile, buf: voidp, len: c_uint) -> ReturnCode;
    pub fn gzfread(buf: voidp, size: z_size_t, nitems: z_size_t, file: gzFile) -> z_size_t;
    pub fn gzwrite(file: gzFile, buf: voidpc, len: c_uint) -> ReturnCode;
    pub fn gzfwrite(buf: voidpc, size: z_size_t, nitems: z_size_t, file: gzFile) -> z_size_t;
    pub fn gzprintf(file: gzFile, format: *const u8, ...) -> ReturnCode;
    pub fn gzputs(file: gzFile, s: *const u8) -> ReturnCode;
    pub fn gzgets(file: gzFile, buf: *mut u8, len: c_int) -> *mut u8;
    pub fn gzputc(file: gzFile, c: c_int) -> ReturnCode;
    pub fn gzgetc(file: gzFile) -> ReturnCode;
    pub fn gzungetc(c: c_int, file: gzFile) -> ReturnCode;
    pub fn gzflush(file: gzFile, flush: FlushValue) -> ReturnCode;
    pub fn gzrewind(file: gzFile) -> ReturnCode;
    pub fn gzeof(file: gzFile) -> ReturnCode;
    pub fn gzdirect(file: gzFile) -> ReturnCode;
    pub fn gzclose(file: gzFile) -> ReturnCode;
    pub fn gzclose_r(file: gzFile) -> ReturnCode;
    pub fn gzclose_w(file: gzFile) -> ReturnCode;
    pub fn gzerror(file: gzFile, errnum: *mut c_int) -> *const u8;
    pub fn gzclearerr(file: gzFile);
    pub fn adler32(adler: uLong, buf: *const Bytef, len: uInt) -> uLong;
    pub fn adler32_z(adler: uLong, buf: *const Bytef, len: z_size_t) -> uLong;
    pub fn crc32(crc: uLong, buf: *const Bytef, len: uInt) -> uLong;
    pub fn crc32_z(crc: uLong, buf: *const Bytef, len: z_size_t) -> uLong;
    pub safe fn crc32_combine_op(crc1: uLong, crc2: uLong, op: uLong) -> uLong;
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
    pub fn gzgetc_(file: gzFile) -> ReturnCode;
    pub fn gzopen(path: *const u8, mode: *const u8) -> gzFile;
    pub fn gzseek(file: gzFile, offset: c_long, whence: c_int) -> c_long;
    pub fn gztell(file: gzFile) -> c_long;
    pub fn gzoffset(file: gzFile) -> c_long;
    pub safe fn adler32_combine(a: uLong, b: uLong, len: c_long) -> uLong;
    pub safe fn crc32_combine(a: uLong, b: uLong, len: c_long) -> uLong;
    pub safe fn crc32_combine_gen(len: c_long) -> uLong;
    pub safe fn zError(err: c_int) -> *const u8;
    pub fn inflateSyncPoint(strm: z_streamp) -> ReturnCode;
    // pub fn get_crc_table() -> *const z_crc_t;
    pub fn inflateUndermine(strm: z_streamp, subvert: c_int) -> ReturnCode;
    pub fn inflateValidate(strm: z_streamp, check: c_int) -> ReturnCode;
    pub fn inflateCodesUsed(strm: z_streamp) -> c_ulong;
    pub fn inflateResetKeep(strm: z_streamp) -> ReturnCode;
    pub fn deflateResetKeep(strm: z_streamp) -> ReturnCode;
}
