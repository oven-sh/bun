//  zig translate-c -I${VCPKG_ROOT}/installed/x64-windows/include/  ${VCPKG_ROOT}/current/installed/x64-windows/include/zlib.h -target x86_64-windows-msvc -lc > src/zlib_sys/win32.zig
#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals)]

use core::ffi::{c_char, c_int, c_long, c_longlong, c_uint, c_ulong, c_ushort, c_void};
use core::marker::{PhantomData, PhantomPinned};

pub use crate::shared::{DataType, FlushValue, ReturnCode};

pub type rsize_t = usize;
pub type _ino_t = c_ushort;
pub type ino_t = _ino_t;
pub type _dev_t = c_uint;
pub type dev_t = _dev_t;
pub type _off_t = c_long;
pub type off_t = _off_t;
type voidpf = *mut c_void;
// PORT NOTE: Zig had `Bytef = [*]u8` (a translate-c artifact); the C header is
// `typedef unsigned char Bytef;`. Using `u8` so `*const Bytef` / `*mut Bytef`
// match the real C ABI (`const unsigned char *` / `unsigned char *`).
type Bytef = u8;
type uInt = c_uint;
// zlib-ng compat (and stock zlib) typedef uLong as `unsigned long` — 4 bytes on
// Windows LLP64. cloudflare/zlib used uint64_t, which is why this was u64. With
// the wrong width, sizeof(z_stream) mismatches and inflateInit_/deflateInit_
// return Z_VERSION_ERROR.
type uLong = c_ulong;
type z_size_t = usize;
type uLongf = uLong;
type voidpc = *const c_void;
type voidp = *mut c_void;
pub type alloc_func = Option<unsafe extern "C" fn(*mut c_void, c_uint, c_uint) -> *mut c_void>;
pub type free_func = Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>;
pub type z_alloc_func = alloc_func;
pub type z_free_func = free_func;

#[repr(C)]
pub struct struct_internal_state {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[repr(C)]
pub struct struct_z_stream_s {
    pub next_in: *const u8,
    pub avail_in: uInt,
    pub total_in: uLong,
    pub next_out: *mut u8,
    pub avail_out: uInt,
    pub total_out: uLong,
    pub err_msg: *const c_char,
    pub internal_state: *mut struct_internal_state,
    pub alloc_func: alloc_func,
    pub free_func: free_func,
    pub user_data: *mut c_void,
    pub data_type: DataType,
    pub adler: uLong,
    pub reserved: uLong,
}
pub type z_stream = struct_z_stream_s;
pub type z_streamp = *mut z_stream;

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

#[repr(C)]
pub struct struct_gzFile_s {
    pub have: c_uint,
    pub next: *mut u8,
    pub pos: c_longlong,
}
pub type gzFile = *mut struct_gzFile_s;

unsafe extern "C" {
    pub fn zlibVersion() -> *const u8;
    pub fn deflate(strm: z_streamp, flush: FlushValue) -> ReturnCode;
    pub fn deflateEnd(strm: z_streamp) -> ReturnCode;
    pub fn inflate(strm: z_streamp, flush: FlushValue) -> ReturnCode;
    pub fn inflateEnd(strm: z_streamp) -> ReturnCode;
    pub fn deflateSetDictionary(strm: z_streamp, dictionary: *const Bytef, dictLength: uInt) -> ReturnCode;
    pub fn deflateGetDictionary(strm: z_streamp, dictionary: *mut Bytef, dictLength: *mut uInt) -> ReturnCode;
    pub fn deflateCopy(dest: z_streamp, source: z_streamp) -> ReturnCode;
    pub fn deflateReset(strm: z_streamp) -> ReturnCode;
    pub fn deflateParams(strm: z_streamp, level: c_int, strategy: c_int) -> ReturnCode;
    pub fn deflateTune(strm: z_streamp, good_length: c_int, max_lazy: c_int, nice_length: c_int, max_chain: c_int) -> ReturnCode;
    pub fn deflateBound(strm: z_streamp, sourceLen: uLong) -> uLong;
    pub fn deflatePending(strm: z_streamp, pending: *mut c_uint, bits: *mut c_int) -> ReturnCode;
    pub fn deflatePrime(strm: z_streamp, bits: c_int, value: c_int) -> ReturnCode;
    pub fn deflateSetHeader(strm: z_streamp, head: gz_headerp) -> ReturnCode;
    pub fn inflateSetDictionary(strm: z_streamp, dictionary: *const Bytef, dictLength: uInt) -> ReturnCode;
    pub fn inflateGetDictionary(strm: z_streamp, dictionary: *mut Bytef, dictLength: *mut uInt) -> ReturnCode;
    pub fn inflateSync(strm: z_streamp) -> ReturnCode;
    pub fn inflateCopy(dest: z_streamp, source: z_streamp) -> ReturnCode;
    pub fn inflateReset(strm: z_streamp) -> ReturnCode;
    pub fn inflateReset2(strm: z_streamp, windowBits: c_int) -> ReturnCode;
    pub fn inflatePrime(strm: z_streamp, bits: c_int, value: c_int) -> ReturnCode;
    pub fn inflateMark(strm: z_streamp) -> c_long;
    pub fn inflateGetHeader(strm: z_streamp, head: gz_headerp) -> ReturnCode;
    pub fn inflateBack(strm: z_streamp, in_: in_func, in_desc: *mut c_void, out: out_func, out_desc: *mut c_void) -> ReturnCode;
    pub fn inflateBackEnd(strm: z_streamp) -> ReturnCode;
    pub fn zlibCompileFlags() -> uLong;
    pub fn compress(dest: *mut Bytef, destLen: *mut uLongf, source: *const Bytef, sourceLen: uLong) -> ReturnCode;
    pub fn compress2(dest: *mut Bytef, destLen: *mut uLongf, source: *const Bytef, sourceLen: uLong, level: c_int) -> ReturnCode;
    pub fn compressBound(sourceLen: uLong) -> uLong;
    pub fn uncompress(dest: *mut Bytef, destLen: *mut uLongf, source: *const Bytef, sourceLen: uLong) -> ReturnCode;
    pub fn uncompress2(dest: *mut Bytef, destLen: *mut uLongf, source: *const Bytef, sourceLen: *mut uLong) -> ReturnCode;
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
    pub fn crc32_combine_op(crc1: uLong, crc2: uLong, op: uLong) -> uLong;
    pub fn deflateInit_(strm: z_streamp, level: c_int, version: *const u8, stream_size: c_int) -> ReturnCode;
    pub fn inflateInit_(strm: z_streamp, version: *const u8, stream_size: c_int) -> ReturnCode;
    pub fn deflateInit2_(strm: z_streamp, level: c_int, method: c_int, windowBits: c_int, memLevel: c_int, strategy: c_int, version: *const u8, stream_size: c_int) -> ReturnCode;
    pub fn inflateInit2_(strm: z_streamp, windowBits: c_int, version: *const u8, stream_size: c_int) -> ReturnCode;
    pub fn inflateBackInit_(strm: z_streamp, windowBits: c_int, window: *mut u8, version: *const u8, stream_size: c_int) -> ReturnCode;
    pub fn gzgetc_(file: gzFile) -> ReturnCode;
    pub fn gzopen(path: *const u8, mode: *const u8) -> gzFile;
    pub fn gzseek(file: gzFile, offset: c_long, whence: c_int) -> c_long;
    pub fn gztell(file: gzFile) -> c_long;
    pub fn gzoffset(file: gzFile) -> c_long;
    pub fn adler32_combine(a: uLong, b: uLong, len: c_long) -> uLong;
    pub fn crc32_combine(a: uLong, b: uLong, len: c_long) -> uLong;
    pub fn crc32_combine_gen(len: c_long) -> uLong;
    pub fn zError(err: c_int) -> *const u8;
    pub fn inflateSyncPoint(strm: z_streamp) -> ReturnCode;
    // pub fn get_crc_table() -> *const z_crc_t;
    pub fn inflateUndermine(strm: z_streamp, subvert: c_int) -> ReturnCode;
    pub fn inflateValidate(strm: z_streamp, check: c_int) -> ReturnCode;
    pub fn inflateCodesUsed(strm: z_streamp) -> c_ulong;
    pub fn inflateResetKeep(strm: z_streamp) -> ReturnCode;
    pub fn deflateResetKeep(strm: z_streamp) -> ReturnCode;
}

pub type z_off_t = c_long;
pub const Z_NO_FLUSH: c_int = 0;
pub const Z_PARTIAL_FLUSH: c_int = 1;
pub const Z_SYNC_FLUSH: c_int = 2;
pub const Z_FULL_FLUSH: c_int = 3;
pub const Z_FINISH: c_int = 4;
pub const Z_BLOCK: c_int = 5;
pub const Z_TREES: c_int = 6;
pub const Z_OK: c_int = 0;
pub const Z_STREAM_END: c_int = 1;
pub const Z_NEED_DICT: c_int = 2;
pub const Z_ERRNO: c_int = -1;
pub const Z_STREAM_ERROR: c_int = -2;
pub const Z_DATA_ERROR: c_int = -3;
pub const Z_MEM_ERROR: c_int = -4;
pub const Z_BUF_ERROR: c_int = -5;
pub const Z_VERSION_ERROR: c_int = -6;
pub const Z_NO_COMPRESSION: c_int = 0;
pub const Z_BEST_SPEED: c_int = 1;
pub const Z_BEST_COMPRESSION: c_int = 9;
pub const Z_DEFAULT_COMPRESSION: c_int = -1;
pub const Z_FILTERED: c_int = 1;
pub const Z_HUFFMAN_ONLY: c_int = 2;
pub const Z_RLE: c_int = 3;
pub const Z_FIXED: c_int = 4;
pub const Z_DEFAULT_STRATEGY: c_int = 0;
pub const Z_BINARY: c_int = 0;
pub const Z_TEXT: c_int = 1;
pub const Z_ASCII: c_int = Z_TEXT;
pub const Z_UNKNOWN: c_int = 2;
pub const Z_DEFLATED: c_int = 8;
pub const Z_NULL: c_int = 0;

#[inline]
pub unsafe fn deflate_init(strm: z_streamp, level: c_int) -> ReturnCode {
    // SAFETY: caller guarantees `strm` is a valid z_stream pointer; zlib reads version/stream_size for ABI check.
    unsafe { deflateInit_(strm, level, zlibVersion(), c_int::try_from(core::mem::size_of::<z_stream>()).unwrap()) }
}
#[inline]
pub unsafe fn inflate_init(strm: z_streamp) -> ReturnCode {
    // SAFETY: caller guarantees `strm` is a valid z_stream pointer.
    unsafe { inflateInit_(strm, zlibVersion(), c_int::try_from(core::mem::size_of::<z_stream>()).unwrap()) }
}
#[inline]
pub unsafe fn deflate_init2(strm: z_streamp, level: c_int, method: c_int, window_bits: c_int, mem_level: c_int, strategy: c_int) -> ReturnCode {
    // SAFETY: caller guarantees `strm` is a valid z_stream pointer.
    unsafe { deflateInit2_(strm, level, method, window_bits, mem_level, strategy, zlibVersion(), c_int::try_from(core::mem::size_of::<z_stream>()).unwrap()) }
}
#[inline]
pub unsafe fn inflate_init2(strm: z_streamp, window_bits: c_int) -> ReturnCode {
    // SAFETY: caller guarantees `strm` is a valid z_stream pointer.
    unsafe { inflateInit2_(strm, window_bits, zlibVersion(), c_int::try_from(core::mem::size_of::<z_stream>()).unwrap()) }
}
#[inline]
pub unsafe fn inflate_back_init(strm: z_streamp, window_bits: c_int, window: *mut u8) -> ReturnCode {
    // SAFETY: caller guarantees `strm` and `window` are valid.
    unsafe { inflateBackInit_(strm, window_bits, window, zlibVersion(), c_int::try_from(core::mem::size_of::<z_stream>()).unwrap()) }
}

pub type internal_state = struct_internal_state;
pub type z_stream_s = struct_z_stream_s;
pub type zStream_struct = struct_z_stream_s;
pub type gz_header_s = struct_gz_header_s;
pub type gzFile_s = struct_gzFile_s;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/zlib_sys/win32.zig (205 lines)
//   confidence: high
//   todos:      0
//   notes:      Bytef retyped from [*]u8 to u8 to match C ABI; ReturnCode/FlushValue/DataType assumed #[repr(C)] in crate::shared
// ──────────────────────────────────────────────────────────────────────────
