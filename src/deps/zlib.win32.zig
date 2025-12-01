//  zig translate-c -I${VCPKG_ROOT}/installed/x64-windows/include/  ${VCPKG_ROOT}/current/installed/x64-windows/include/zlib.h -target x86_64-windows-msvc -lc > src/deps/zlib.win32.zig
pub const rsize_t = usize;
pub const _ino_t = c_ushort;
pub const ino_t = _ino_t;
pub const _dev_t = c_uint;
pub const dev_t = _dev_t;
pub const _off_t = c_long;
pub const off_t = _off_t;
const voidpf = *anyopaque;
const Bytef = [*]u8;
const uInt = c_uint;
const uLong = u64;
const z_size_t = usize;
const uLongf = uLong;
const voidpc = ?*const anyopaque;
const voidp = ?*anyopaque;
pub const alloc_func = ?*const fn (voidpf, uInt, uInt) callconv(.c) voidpf;
pub const free_func = ?*const fn (voidpf, voidpf) callconv(.c) void;
pub const z_alloc_func = alloc_func;
pub const z_free_func = free_func;
pub const struct_internal_state = opaque {};
pub const struct_z_stream_s = extern struct {
    next_in: ?[*]const u8,
    avail_in: uInt,
    total_in: uLong,
    next_out: ?[*]u8,
    avail_out: uInt,
    total_out: uLong,
    err_msg: ?[*:0]const u8,
    internal_state: ?*struct_internal_state,
    alloc_func: alloc_func,
    free_func: free_func,
    user_data: voidpf,
    data_type: DataType,
    adler: uLong,
    reserved: uLong,
};
pub const z_stream = struct_z_stream_s;
pub const z_streamp = ?*z_stream;
pub const struct_gz_header_s = extern struct {
    text: c_int,
    time: uLong,
    xflags: c_int,
    os: c_int,
    extra: [*c]Bytef,
    extra_len: uInt,
    extra_max: uInt,
    name: [*c]Bytef,
    name_max: uInt,
    comment: [*c]Bytef,
    comm_max: uInt,
    hcrc: c_int,
    done: c_int,
};
pub const gz_header = struct_gz_header_s;
pub const gz_headerp = [*c]gz_header;
pub extern fn zlibVersion() [*c]const u8;
pub extern fn deflate(strm: z_streamp, flush: FlushValue) ReturnCode;
pub extern fn deflateEnd(strm: z_streamp) ReturnCode;
pub extern fn inflate(strm: z_streamp, flush: FlushValue) ReturnCode;
pub extern fn inflateEnd(strm: z_streamp) ReturnCode;
pub extern fn deflateSetDictionary(strm: z_streamp, dictionary: [*c]const Bytef, dictLength: uInt) ReturnCode;
pub extern fn deflateGetDictionary(strm: z_streamp, dictionary: [*c]Bytef, dictLength: [*c]uInt) ReturnCode;
pub extern fn deflateCopy(dest: z_streamp, source: z_streamp) ReturnCode;
pub extern fn deflateReset(strm: z_streamp) ReturnCode;
pub extern fn deflateParams(strm: z_streamp, level: c_int, strategy: c_int) ReturnCode;
pub extern fn deflateTune(strm: z_streamp, good_length: c_int, max_lazy: c_int, nice_length: c_int, max_chain: c_int) ReturnCode;
pub extern fn deflateBound(strm: z_streamp, sourceLen: uLong) uLong;
pub extern fn deflatePending(strm: z_streamp, pending: [*c]c_uint, bits: [*c]c_int) ReturnCode;
pub extern fn deflatePrime(strm: z_streamp, bits: c_int, value: c_int) ReturnCode;
pub extern fn deflateSetHeader(strm: z_streamp, head: gz_headerp) ReturnCode;
pub extern fn inflateSetDictionary(strm: z_streamp, dictionary: [*c]const Bytef, dictLength: uInt) ReturnCode;
pub extern fn inflateGetDictionary(strm: z_streamp, dictionary: [*c]Bytef, dictLength: [*c]uInt) ReturnCode;
pub extern fn inflateSync(strm: z_streamp) ReturnCode;
pub extern fn inflateCopy(dest: z_streamp, source: z_streamp) ReturnCode;
pub extern fn inflateReset(strm: z_streamp) ReturnCode;
pub extern fn inflateReset2(strm: z_streamp, windowBits: c_int) ReturnCode;
pub extern fn inflatePrime(strm: z_streamp, bits: c_int, value: c_int) ReturnCode;
pub extern fn inflateMark(strm: z_streamp) c_long;
pub extern fn inflateGetHeader(strm: z_streamp, head: gz_headerp) ReturnCode;
pub const in_func = ?*const fn (?*anyopaque, [*c][*c]u8) callconv(.c) c_uint;
pub const out_func = ?*const fn (?*anyopaque, [*c]u8, c_uint) callconv(.c) ReturnCode;
pub extern fn inflateBack(strm: z_streamp, in: in_func, in_desc: ?*anyopaque, out: out_func, out_desc: ?*anyopaque) ReturnCode;
pub extern fn inflateBackEnd(strm: z_streamp) ReturnCode;
pub extern fn zlibCompileFlags() uLong;
pub extern fn compress(dest: [*c]Bytef, destLen: [*c]uLongf, source: [*c]const Bytef, sourceLen: uLong) ReturnCode;
pub extern fn compress2(dest: [*c]Bytef, destLen: [*c]uLongf, source: [*c]const Bytef, sourceLen: uLong, level: c_int) ReturnCode;
pub extern fn compressBound(sourceLen: uLong) uLong;
pub extern fn uncompress(dest: [*c]Bytef, destLen: [*c]uLongf, source: [*c]const Bytef, sourceLen: uLong) ReturnCode;
pub extern fn uncompress2(dest: [*c]Bytef, destLen: [*c]uLongf, source: [*c]const Bytef, sourceLen: [*c]uLong) ReturnCode;
pub const struct_gzFile_s = extern struct {
    have: c_uint,
    next: [*c]u8,
    pos: c_longlong,
};
pub const gzFile = [*c]struct_gzFile_s;
pub extern fn gzdopen(fd: c_int, mode: [*c]const u8) gzFile;
pub extern fn gzbuffer(file: gzFile, size: c_uint) ReturnCode;
pub extern fn gzsetparams(file: gzFile, level: c_int, strategy: c_int) ReturnCode;
pub extern fn gzread(file: gzFile, buf: voidp, len: c_uint) ReturnCode;
pub extern fn gzfread(buf: voidp, size: z_size_t, nitems: z_size_t, file: gzFile) z_size_t;
pub extern fn gzwrite(file: gzFile, buf: voidpc, len: c_uint) ReturnCode;
pub extern fn gzfwrite(buf: voidpc, size: z_size_t, nitems: z_size_t, file: gzFile) z_size_t;
pub extern fn gzprintf(file: gzFile, format: [*c]const u8, ...) ReturnCode;
pub extern fn gzputs(file: gzFile, s: [*c]const u8) ReturnCode;
pub extern fn gzgets(file: gzFile, buf: [*c]u8, len: c_int) [*c]u8;
pub extern fn gzputc(file: gzFile, c: c_int) ReturnCode;
pub extern fn gzgetc(file: gzFile) ReturnCode;
pub extern fn gzungetc(c: c_int, file: gzFile) ReturnCode;
pub extern fn gzflush(file: gzFile, flush: FlushValue) ReturnCode;
pub extern fn gzrewind(file: gzFile) ReturnCode;
pub extern fn gzeof(file: gzFile) ReturnCode;
pub extern fn gzdirect(file: gzFile) ReturnCode;
pub extern fn gzclose(file: gzFile) ReturnCode;
pub extern fn gzclose_r(file: gzFile) ReturnCode;
pub extern fn gzclose_w(file: gzFile) ReturnCode;
pub extern fn gzerror(file: gzFile, errnum: [*c]c_int) [*c]const u8;
pub extern fn gzclearerr(file: gzFile) void;
pub extern fn adler32(adler: uLong, buf: [*c]const Bytef, len: uInt) uLong;
pub extern fn adler32_z(adler: uLong, buf: [*c]const Bytef, len: z_size_t) uLong;
pub extern fn crc32(crc: uLong, buf: [*c]const Bytef, len: uInt) uLong;
pub extern fn crc32_z(crc: uLong, buf: [*c]const Bytef, len: z_size_t) uLong;
pub extern fn crc32_combine_op(crc1: uLong, crc2: uLong, op: uLong) uLong;
pub extern fn deflateInit_(strm: z_streamp, level: c_int, version: [*c]const u8, stream_size: c_int) ReturnCode;
pub extern fn inflateInit_(strm: z_streamp, version: [*c]const u8, stream_size: c_int) ReturnCode;
pub extern fn deflateInit2_(strm: z_streamp, level: c_int, method: c_int, windowBits: c_int, memLevel: c_int, strategy: c_int, version: [*c]const u8, stream_size: c_int) ReturnCode;
pub extern fn inflateInit2_(strm: z_streamp, windowBits: c_int, version: [*c]const u8, stream_size: c_int) ReturnCode;
pub extern fn inflateBackInit_(strm: z_streamp, windowBits: c_int, window: [*c]u8, version: [*c]const u8, stream_size: c_int) ReturnCode;
pub extern fn gzgetc_(file: gzFile) ReturnCode;
pub extern fn gzopen([*c]const u8, [*c]const u8) gzFile;
pub extern fn gzseek(gzFile, c_long, c_int) c_long;
pub extern fn gztell(gzFile) c_long;
pub extern fn gzoffset(gzFile) c_long;
pub extern fn adler32_combine(uLong, uLong, c_long) uLong;
pub extern fn crc32_combine(uLong, uLong, c_long) uLong;
pub extern fn crc32_combine_gen(c_long) uLong;
pub extern fn zError(c_int) [*c]const u8;
pub extern fn inflateSyncPoint(z_streamp) ReturnCode;
// pub extern fn get_crc_table() [*c]const z_crc_t;
pub extern fn inflateUndermine(z_streamp, c_int) ReturnCode;
pub extern fn inflateValidate(z_streamp, c_int) ReturnCode;
pub extern fn inflateCodesUsed(z_streamp) c_ulong;
pub extern fn inflateResetKeep(z_streamp) ReturnCode;
pub extern fn deflateResetKeep(z_streamp) ReturnCode;

pub const z_off_t = c_long;
pub const ZLIB_VERSION = "1.2.13";
pub const ZLIB_VERNUM = @as(c_int, 0x12d0);
pub const ZLIB_VER_MAJOR = @as(c_int, 1);
pub const ZLIB_VER_MINOR = @as(c_int, 2);
pub const ZLIB_VER_REVISION = @as(c_int, 13);
pub const ZLIB_VER_SUBREVISION = @as(c_int, 0);
pub const Z_NO_FLUSH = @as(c_int, 0);
pub const Z_PARTIAL_FLUSH = @as(c_int, 1);
pub const Z_SYNC_FLUSH = @as(c_int, 2);
pub const Z_FULL_FLUSH = @as(c_int, 3);
pub const Z_FINISH = @as(c_int, 4);
pub const Z_BLOCK = @as(c_int, 5);
pub const Z_TREES = @as(c_int, 6);
pub const Z_OK = @as(c_int, 0);
pub const Z_STREAM_END = @as(c_int, 1);
pub const Z_NEED_DICT = @as(c_int, 2);
pub const Z_ERRNO = -@as(c_int, 1);
pub const Z_STREAM_ERROR = -@as(c_int, 2);
pub const Z_DATA_ERROR = -@as(c_int, 3);
pub const Z_MEM_ERROR = -@as(c_int, 4);
pub const Z_BUF_ERROR = -@as(c_int, 5);
pub const Z_VERSION_ERROR = -@as(c_int, 6);
pub const Z_NO_COMPRESSION = @as(c_int, 0);
pub const Z_BEST_SPEED = @as(c_int, 1);
pub const Z_BEST_COMPRESSION = @as(c_int, 9);
pub const Z_DEFAULT_COMPRESSION = -@as(c_int, 1);
pub const Z_FILTERED = @as(c_int, 1);
pub const Z_HUFFMAN_ONLY = @as(c_int, 2);
pub const Z_RLE = @as(c_int, 3);
pub const Z_FIXED = @as(c_int, 4);
pub const Z_DEFAULT_STRATEGY = @as(c_int, 0);
pub const Z_BINARY = @as(c_int, 0);
pub const Z_TEXT = @as(c_int, 1);
pub const Z_ASCII = Z_TEXT;
pub const Z_UNKNOWN = @as(c_int, 2);
pub const Z_DEFLATED = @as(c_int, 8);
pub const Z_NULL = @as(c_int, 0);
pub inline fn deflateInit(strm: anytype, level: anytype) ReturnCode {
    return deflateInit_(strm, level, zlibVersion(), @import("std").zig.c_translation.cast(c_int, @import("std").zig.c_translation.sizeof(z_stream)));
}
pub inline fn inflateInit(strm: anytype) ReturnCode {
    return inflateInit_(strm, zlibVersion(), @import("std").zig.c_translation.cast(c_int, @import("std").zig.c_translation.sizeof(z_stream)));
}
pub inline fn deflateInit2(strm: anytype, level: anytype, method: anytype, windowBits: anytype, memLevel: anytype, strategy: anytype) ReturnCode {
    return deflateInit2_(strm, level, method, windowBits, memLevel, strategy, zlibVersion(), @import("std").zig.c_translation.cast(c_int, @import("std").zig.c_translation.sizeof(z_stream)));
}
pub inline fn inflateInit2(strm: anytype, windowBits: anytype) ReturnCode {
    return inflateInit2_(strm, windowBits, zlibVersion(), @import("std").zig.c_translation.cast(c_int, @import("std").zig.c_translation.sizeof(z_stream)));
}
pub inline fn inflateBackInit(strm: anytype, windowBits: anytype, window: anytype) ReturnCode {
    return inflateBackInit_(strm, windowBits, window, zlibVersion(), @import("std").zig.c_translation.cast(c_int, @import("std").zig.c_translation.sizeof(z_stream)));
}
pub const internal_state = struct_internal_state;
pub const z_stream_s = struct_z_stream_s;
pub const zStream_struct = struct_z_stream_s;
pub const gz_header_s = struct_gz_header_s;
pub const gzFile_s = struct_gzFile_s;

pub const DataType = @import("./zlib.shared.zig").DataType;
pub const FlushValue = @import("./zlib.shared.zig").FlushValue;
pub const ReturnCode = @import("./zlib.shared.zig").ReturnCode;
