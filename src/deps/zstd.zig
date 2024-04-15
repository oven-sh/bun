pub extern fn ZSTD_versionNumber() c_uint;
pub extern fn ZSTD_versionString() [*c]const u8;
pub extern fn ZSTD_compress(dst: ?*anyopaque, dstCapacity: usize, src: ?*const anyopaque, srcSize: usize, compressionLevel: c_int) usize;
pub extern fn ZSTD_decompress(dst: ?*anyopaque, dstCapacity: usize, src: ?*const anyopaque, compressedSize: usize) usize;
pub extern fn ZSTD_getFrameContentSize(src: ?*const anyopaque, srcSize: usize) c_ulonglong;
pub extern fn ZSTD_getDecompressedSize(src: ?*const anyopaque, srcSize: usize) c_ulonglong;
pub extern fn ZSTD_findFrameCompressedSize(src: ?*const anyopaque, srcSize: usize) usize;
pub extern fn ZSTD_compressBound(srcSize: usize) usize;
pub extern fn ZSTD_isError(code: usize) c_uint;
pub extern fn ZSTD_getErrorName(code: usize) [*:0]const u8;
pub extern fn ZSTD_minCLevel() c_int;
pub extern fn ZSTD_maxCLevel() c_int;
pub extern fn ZSTD_defaultCLevel() c_int;
pub const struct_ZSTD_CCtx_s = opaque {};
pub const ZSTD_CCtx = struct_ZSTD_CCtx_s;
pub extern fn ZSTD_createCCtx() ?*ZSTD_CCtx;
pub extern fn ZSTD_freeCCtx(cctx: ?*ZSTD_CCtx) usize;
pub extern fn ZSTD_compressCCtx(cctx: ?*ZSTD_CCtx, dst: ?*anyopaque, dstCapacity: usize, src: ?*const anyopaque, srcSize: usize, compressionLevel: c_int) usize;
pub const struct_ZSTD_DCtx_s = opaque {};
pub const ZSTD_DCtx = struct_ZSTD_DCtx_s;
pub extern fn ZSTD_createDCtx() ?*ZSTD_DCtx;
pub extern fn ZSTD_freeDCtx(dctx: ?*ZSTD_DCtx) usize;
pub extern fn ZSTD_decompressDCtx(dctx: ?*ZSTD_DCtx, dst: ?*anyopaque, dstCapacity: usize, src: ?*const anyopaque, srcSize: usize) usize;
pub const ZSTD_fast: c_int = 1;
pub const ZSTD_dfast: c_int = 2;
pub const ZSTD_greedy: c_int = 3;
pub const ZSTD_lazy: c_int = 4;
pub const ZSTD_lazy2: c_int = 5;
pub const ZSTD_btlazy2: c_int = 6;
pub const ZSTD_btopt: c_int = 7;
pub const ZSTD_btultra: c_int = 8;
pub const ZSTD_btultra2: c_int = 9;
pub const ZSTD_strategy = c_uint;
pub const ZSTD_c_compressionLevel: c_int = 100;
pub const ZSTD_c_windowLog: c_int = 101;
pub const ZSTD_c_hashLog: c_int = 102;
pub const ZSTD_c_chainLog: c_int = 103;
pub const ZSTD_c_searchLog: c_int = 104;
pub const ZSTD_c_minMatch: c_int = 105;
pub const ZSTD_c_targetLength: c_int = 106;
pub const ZSTD_c_strategy: c_int = 107;
pub const ZSTD_c_enableLongDistanceMatching: c_int = 160;
pub const ZSTD_c_ldmHashLog: c_int = 161;
pub const ZSTD_c_ldmMinMatch: c_int = 162;
pub const ZSTD_c_ldmBucketSizeLog: c_int = 163;
pub const ZSTD_c_ldmHashRateLog: c_int = 164;
pub const ZSTD_c_contentSizeFlag: c_int = 200;
pub const ZSTD_c_checksumFlag: c_int = 201;
pub const ZSTD_c_dictIDFlag: c_int = 202;
pub const ZSTD_c_nbWorkers: c_int = 400;
pub const ZSTD_c_jobSize: c_int = 401;
pub const ZSTD_c_overlapLog: c_int = 402;
pub const ZSTD_c_experimentalParam1: c_int = 500;
pub const ZSTD_c_experimentalParam2: c_int = 10;
pub const ZSTD_c_experimentalParam3: c_int = 1000;
pub const ZSTD_c_experimentalParam4: c_int = 1001;
pub const ZSTD_c_experimentalParam5: c_int = 1002;
pub const ZSTD_c_experimentalParam6: c_int = 1003;
pub const ZSTD_c_experimentalParam7: c_int = 1004;
pub const ZSTD_c_experimentalParam8: c_int = 1005;
pub const ZSTD_c_experimentalParam9: c_int = 1006;
pub const ZSTD_c_experimentalParam10: c_int = 1007;
pub const ZSTD_c_experimentalParam11: c_int = 1008;
pub const ZSTD_c_experimentalParam12: c_int = 1009;
pub const ZSTD_c_experimentalParam13: c_int = 1010;
pub const ZSTD_c_experimentalParam14: c_int = 1011;
pub const ZSTD_c_experimentalParam15: c_int = 1012;
pub const ZSTD_c_experimentalParam16: c_int = 1013;
pub const ZSTD_c_experimentalParam17: c_int = 1014;
pub const ZSTD_c_experimentalParam18: c_int = 1015;
pub const ZSTD_c_experimentalParam19: c_int = 1016;
pub const ZSTD_cParameter = c_uint;
pub const ZSTD_bounds = extern struct {
    @"error": usize,
    lowerBound: c_int,
    upperBound: c_int,
};
pub extern fn ZSTD_cParam_getBounds(cParam: ZSTD_cParameter) ZSTD_bounds;
pub extern fn ZSTD_CCtx_setParameter(cctx: ?*ZSTD_CCtx, param: ZSTD_cParameter, value: c_int) usize;
pub extern fn ZSTD_CCtx_setPledgedSrcSize(cctx: ?*ZSTD_CCtx, pledgedSrcSize: c_ulonglong) usize;
pub const ZSTD_reset_session_only: c_int = 1;
pub const ZSTD_reset_parameters: c_int = 2;
pub const ZSTD_reset_session_and_parameters: c_int = 3;
pub const ZSTD_ResetDirective = c_uint;
pub extern fn ZSTD_CCtx_reset(cctx: ?*ZSTD_CCtx, reset: ZSTD_ResetDirective) usize;
pub extern fn ZSTD_compress2(cctx: ?*ZSTD_CCtx, dst: ?*anyopaque, dstCapacity: usize, src: ?*const anyopaque, srcSize: usize) usize;
pub const ZSTD_d_windowLogMax: c_int = 100;
pub const ZSTD_d_experimentalParam1: c_int = 1000;
pub const ZSTD_d_experimentalParam2: c_int = 1001;
pub const ZSTD_d_experimentalParam3: c_int = 1002;
pub const ZSTD_d_experimentalParam4: c_int = 1003;
pub const ZSTD_d_experimentalParam5: c_int = 1004;
pub const ZSTD_dParameter = c_uint;
pub extern fn ZSTD_dParam_getBounds(dParam: ZSTD_dParameter) ZSTD_bounds;
pub extern fn ZSTD_DCtx_setParameter(dctx: ?*ZSTD_DCtx, param: ZSTD_dParameter, value: c_int) usize;
pub extern fn ZSTD_DCtx_reset(dctx: ?*ZSTD_DCtx, reset: ZSTD_ResetDirective) usize;
pub const struct_ZSTD_inBuffer_s = extern struct {
    src: ?*const anyopaque,
    size: usize,
    pos: usize,
};
pub const ZSTD_inBuffer = struct_ZSTD_inBuffer_s;
pub const struct_ZSTD_outBuffer_s = extern struct {
    dst: ?*anyopaque,
    size: usize,
    pos: usize,
};
pub const ZSTD_outBuffer = struct_ZSTD_outBuffer_s;
pub const ZSTD_CStream = ZSTD_CCtx;
pub extern fn ZSTD_createCStream() ?*ZSTD_CStream;
pub extern fn ZSTD_freeCStream(zcs: ?*ZSTD_CStream) usize;
pub const ZSTD_e_continue: c_int = 0;
pub const ZSTD_e_flush: c_int = 1;
pub const ZSTD_e_end: c_int = 2;
pub const ZSTD_EndDirective = c_uint;
pub extern fn ZSTD_compressStream2(cctx: ?*ZSTD_CCtx, output: [*c]ZSTD_outBuffer, input: [*c]ZSTD_inBuffer, endOp: ZSTD_EndDirective) usize;
pub extern fn ZSTD_CStreamInSize() usize;
pub extern fn ZSTD_CStreamOutSize() usize;
pub extern fn ZSTD_initCStream(zcs: ?*ZSTD_CStream, compressionLevel: c_int) usize;
pub extern fn ZSTD_compressStream(zcs: ?*ZSTD_CStream, output: [*c]ZSTD_outBuffer, input: [*c]ZSTD_inBuffer) usize;
pub extern fn ZSTD_flushStream(zcs: ?*ZSTD_CStream, output: [*c]ZSTD_outBuffer) usize;
pub extern fn ZSTD_endStream(zcs: ?*ZSTD_CStream, output: [*c]ZSTD_outBuffer) usize;
pub const ZSTD_DStream = ZSTD_DCtx;
pub extern fn ZSTD_createDStream() ?*ZSTD_DStream;
pub extern fn ZSTD_freeDStream(zds: ?*ZSTD_DStream) usize;
pub extern fn ZSTD_initDStream(zds: ?*ZSTD_DStream) usize;
pub extern fn ZSTD_decompressStream(zds: ?*ZSTD_DStream, output: [*c]ZSTD_outBuffer, input: [*c]ZSTD_inBuffer) usize;
pub extern fn ZSTD_DStreamInSize() usize;
pub extern fn ZSTD_DStreamOutSize() usize;
pub extern fn ZSTD_compress_usingDict(ctx: ?*ZSTD_CCtx, dst: ?*anyopaque, dstCapacity: usize, src: ?*const anyopaque, srcSize: usize, dict: ?*const anyopaque, dictSize: usize, compressionLevel: c_int) usize;
pub extern fn ZSTD_decompress_usingDict(dctx: ?*ZSTD_DCtx, dst: ?*anyopaque, dstCapacity: usize, src: ?*const anyopaque, srcSize: usize, dict: ?*const anyopaque, dictSize: usize) usize;
pub const struct_ZSTD_CDict_s = opaque {};
pub const ZSTD_CDict = struct_ZSTD_CDict_s;
pub extern fn ZSTD_createCDict(dictBuffer: ?*const anyopaque, dictSize: usize, compressionLevel: c_int) ?*ZSTD_CDict;
pub extern fn ZSTD_freeCDict(CDict: ?*ZSTD_CDict) usize;
pub extern fn ZSTD_compress_usingCDict(cctx: ?*ZSTD_CCtx, dst: ?*anyopaque, dstCapacity: usize, src: ?*const anyopaque, srcSize: usize, cdict: ?*const ZSTD_CDict) usize;
pub const struct_ZSTD_DDict_s = opaque {};
pub const ZSTD_DDict = struct_ZSTD_DDict_s;
pub extern fn ZSTD_createDDict(dictBuffer: ?*const anyopaque, dictSize: usize) ?*ZSTD_DDict;
pub extern fn ZSTD_freeDDict(ddict: ?*ZSTD_DDict) usize;
pub extern fn ZSTD_decompress_usingDDict(dctx: ?*ZSTD_DCtx, dst: ?*anyopaque, dstCapacity: usize, src: ?*const anyopaque, srcSize: usize, ddict: ?*const ZSTD_DDict) usize;
pub extern fn ZSTD_getDictID_fromDict(dict: ?*const anyopaque, dictSize: usize) c_uint;
pub extern fn ZSTD_getDictID_fromCDict(cdict: ?*const ZSTD_CDict) c_uint;
pub extern fn ZSTD_getDictID_fromDDict(ddict: ?*const ZSTD_DDict) c_uint;
pub extern fn ZSTD_getDictID_fromFrame(src: ?*const anyopaque, srcSize: usize) c_uint;
pub extern fn ZSTD_CCtx_loadDictionary(cctx: ?*ZSTD_CCtx, dict: ?*const anyopaque, dictSize: usize) usize;
pub extern fn ZSTD_CCtx_refCDict(cctx: ?*ZSTD_CCtx, cdict: ?*const ZSTD_CDict) usize;
pub extern fn ZSTD_CCtx_refPrefix(cctx: ?*ZSTD_CCtx, prefix: ?*const anyopaque, prefixSize: usize) usize;
pub extern fn ZSTD_DCtx_loadDictionary(dctx: ?*ZSTD_DCtx, dict: ?*const anyopaque, dictSize: usize) usize;
pub extern fn ZSTD_DCtx_refDDict(dctx: ?*ZSTD_DCtx, ddict: ?*const ZSTD_DDict) usize;
pub extern fn ZSTD_DCtx_refPrefix(dctx: ?*ZSTD_DCtx, prefix: ?*const anyopaque, prefixSize: usize) usize;
pub extern fn ZSTD_sizeof_CCtx(cctx: ?*const ZSTD_CCtx) usize;
pub extern fn ZSTD_sizeof_DCtx(dctx: ?*const ZSTD_DCtx) usize;
pub extern fn ZSTD_sizeof_CStream(zcs: ?*const ZSTD_CStream) usize;
pub extern fn ZSTD_sizeof_DStream(zds: ?*const ZSTD_DStream) usize;
pub extern fn ZSTD_sizeof_CDict(cdict: ?*const ZSTD_CDict) usize;
pub extern fn ZSTD_sizeof_DDict(ddict: ?*const ZSTD_DDict) usize;
pub const ZSTD_VERSION_MAJOR = @as(c_int, 1);
pub const ZSTD_VERSION_MINOR = @as(c_int, 5);
pub const ZSTD_VERSION_RELEASE = @as(c_int, 5);
pub const ZSTD_VERSION_NUMBER = (((ZSTD_VERSION_MAJOR * @as(c_int, 100)) * @as(c_int, 100)) + (ZSTD_VERSION_MINOR * @as(c_int, 100))) + ZSTD_VERSION_RELEASE;
pub const ZSTD_LIB_VERSION = ZSTD_VERSION_MAJOR.ZSTD_VERSION_MINOR.ZSTD_VERSION_RELEASE;
pub const ZSTD_CLEVEL_DEFAULT = @as(c_int, 3);
pub const ZSTD_MAGICNUMBER = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xFD2FB528, .hex);
pub const ZSTD_MAGIC_DICTIONARY = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xEC30A437, .hex);
pub const ZSTD_MAGIC_SKIPPABLE_START = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x184D2A50, .hex);
pub const ZSTD_MAGIC_SKIPPABLE_MASK = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xFFFFFFF0, .hex);
pub const ZSTD_BLOCKSIZELOG_MAX = @as(c_int, 17);
pub const ZSTD_BLOCKSIZE_MAX = @as(c_int, 1) << ZSTD_BLOCKSIZELOG_MAX;
pub const ZSTD_CONTENTSIZE_UNKNOWN = @as(c_ulonglong, 0) - @as(c_int, 1);
pub const ZSTD_CONTENTSIZE_ERROR = @as(c_ulonglong, 0) - @as(c_int, 2);
pub const ZSTD_MAX_INPUT_SIZE = if (@import("std").zig.c_translation.sizeof(usize) == @as(c_int, 8)) @as(c_ulonglong, 0xFF00FF00FF00FF00) else @import("std").zig.c_translation.promoteIntLiteral(c_uint, 0xFF00FF00, .hex);
pub inline fn ZSTD_COMPRESSBOUND(srcSize: anytype) @TypeOf(if (@import("std").zig.c_translation.cast(usize, srcSize) >= ZSTD_MAX_INPUT_SIZE) @as(c_int, 0) else (srcSize + (srcSize >> @as(c_int, 8))) + (if (srcSize < (@as(c_int, 128) << @as(c_int, 10))) ((@as(c_int, 128) << @as(c_int, 10)) - srcSize) >> @as(c_int, 11) else @as(c_int, 0))) {
    return if (@import("std").zig.c_translation.cast(usize, srcSize) >= ZSTD_MAX_INPUT_SIZE) @as(c_int, 0) else (srcSize + (srcSize >> @as(c_int, 8))) + (if (srcSize < (@as(c_int, 128) << @as(c_int, 10))) ((@as(c_int, 128) << @as(c_int, 10)) - srcSize) >> @as(c_int, 11) else @as(c_int, 0));
}
pub const ZSTD_CCtx_s = struct_ZSTD_CCtx_s;
pub const ZSTD_DCtx_s = struct_ZSTD_DCtx_s;
pub const ZSTD_inBuffer_s = struct_ZSTD_inBuffer_s;
pub const ZSTD_outBuffer_s = struct_ZSTD_outBuffer_s;
pub const ZSTD_CDict_s = struct_ZSTD_CDict_s;
pub const ZSTD_DDict_s = struct_ZSTD_DDict_s;

// -----------------------------------

/// ZSTD_compress() :
///  Compresses `src` content as a single zstd compressed frame into already allocated `dst`.
///  NOTE: Providing `dstCapacity >= ZSTD_compressBound(srcSize)` guarantees that zstd will have
///        enough space to successfully compress the data.
///  @return : compressed size written into `dst` (<= `dstCapacity),
///            or an error code if it fails (which can be tested using ZSTD_isError()). */
// ZSTDLIB_API size_t ZSTD_compress( void* dst, size_t dstCapacity,
//                             const void* src, size_t srcSize,
//                                   int compressionLevel);
pub fn compress(dest: []u8, src: []const u8, level: ?i32) Result {
    const result = ZSTD_compress(dest.ptr, dest.len, src.ptr, src.len, level orelse ZSTD_defaultCLevel());
    if (ZSTD_isError(result) != 0) return .{ .err = bun.sliceTo(ZSTD_getErrorName(result), 0) };
    return .{ .success = result };
}

pub fn compressBound(srcSize: usize) usize {
    return ZSTD_compressBound(srcSize);
}

/// ZSTD_decompress() :
/// `compressedSize` : must be the _exact_ size of some number of compressed and/or skippable frames.
/// `dstCapacity` is an upper bound of originalSize to regenerate.
/// If user cannot imply a maximum upper bound, it's better to use streaming mode to decompress data.
/// @return : the number of bytes decompressed into `dst` (<= `dstCapacity`),
///           or an errorCode if it fails (which can be tested using ZSTD_isError()). */
// ZSTDLIB_API size_t ZSTD_decompress( void* dst, size_t dstCapacity,
//   const void* src, size_t compressedSize);
pub fn decompress(dest: []u8, src: []const u8) Result {
    const result = ZSTD_decompress(dest.ptr, dest.len, src.ptr, src.len);
    if (ZSTD_isError(result) != 0) return .{ .err = bun.sliceTo(ZSTD_getErrorName(result), 0) };
    return .{ .success = result };
}

pub fn getDecompressedSize(src: []const u8) usize {
    return ZSTD_getDecompressedSize(src.ptr, src.len);
}

pub const Result = union(enum) {
    success: usize,
    err: [:0]const u8,
};

const bun = @import("root").bun;
