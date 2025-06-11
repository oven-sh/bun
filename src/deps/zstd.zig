const std = @import("std");
const bun = @import("bun");
const c = bun.c;

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
    const result = c.ZSTD_compress(dest.ptr, dest.len, src.ptr, src.len, level orelse c.ZSTD_defaultCLevel());
    if (c.ZSTD_isError(result) != 0) return .{ .err = bun.sliceTo(c.ZSTD_getErrorName(result), 0) };
    return .{ .success = result };
}

pub fn compressBound(srcSize: usize) usize {
    return c.ZSTD_compressBound(srcSize);
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
    const result = c.ZSTD_decompress(dest.ptr, dest.len, src.ptr, src.len);
    if (c.ZSTD_isError(result) != 0) return .{ .err = bun.sliceTo(c.ZSTD_getErrorName(result), 0) };
    return .{ .success = result };
}

pub fn getDecompressedSize(src: []const u8) usize {
    return ZSTD_findDecompressedSize(src.ptr, src.len);
}

//ZSTD_findDecompressedSize() :
//`src` should point to the start of a series of ZSTD encoded and/or skippable frames
//`srcSize` must be the _exact_ size of this series
//     (i.e. there should be a frame boundary at `src + srcSize`)
//@return : - decompressed size of all data in all successive frames
//          - if the decompressed size cannot be determined: ZSTD_CONTENTSIZE_UNKNOWN
//          - if an error occurred: ZSTD_CONTENTSIZE_ERROR
//
// note 1 : decompressed size is an optional field, that may not be present, especially in streaming mode.
//          When `return==ZSTD_CONTENTSIZE_UNKNOWN`, data to decompress could be any size.
//          In which case, it's necessary to use streaming mode to decompress data.
// note 2 : decompressed size is always present when compression is done with ZSTD_compress()
// note 3 : decompressed size can be very large (64-bits value),
//          potentially larger than what local system can handle as a single memory segment.
//          In which case, it's necessary to use streaming mode to decompress data.
// note 4 : If source is untrusted, decompressed size could be wrong or intentionally modified.
//          Always ensure result fits within application's authorized limits.
//          Each application can set its own limits.
// note 5 : ZSTD_findDecompressedSize handles multiple frames, and so it must traverse the input to
//          read each contained frame header.  This is fast as most of the data is skipped,
//          however it does mean that all frame data must be present and valid. */
pub extern fn ZSTD_findDecompressedSize(src: ?*const anyopaque, srcSize: usize) c_ulonglong;

pub const Result = union(enum) {
    success: usize,
    err: [:0]const u8,
};

pub const ZstdReaderArrayList = struct {
    const State = enum {
        Uninitialized,
        Inflating,
        End,
        Error,
    };

    input: []const u8,
    list: std.ArrayListUnmanaged(u8),
    list_allocator: std.mem.Allocator,
    list_ptr: *std.ArrayListUnmanaged(u8),
    allocator: std.mem.Allocator,
    zstd: *c.ZSTD_DStream,
    state: State = State.Uninitialized,
    total_out: usize = 0,
    total_in: usize = 0,

    pub const new = bun.TrivialNew(ZstdReaderArrayList);

    pub fn init(
        input: []const u8,
        list: *std.ArrayListUnmanaged(u8),
        allocator: std.mem.Allocator,
    ) !*ZstdReaderArrayList {
        return initWithListAllocator(input, list, allocator, allocator);
    }

    pub fn initWithListAllocator(
        input: []const u8,
        list: *std.ArrayListUnmanaged(u8),
        list_allocator: std.mem.Allocator,
        allocator: std.mem.Allocator,
    ) !*ZstdReaderArrayList {
        var reader = try allocator.create(ZstdReaderArrayList);
        reader.* = .{
            .input = input,
            .list = list.*,
            .list_allocator = list_allocator,
            .list_ptr = list,
            .allocator = allocator,
            .zstd = undefined,
        };

        reader.zstd = c.ZSTD_createDStream() orelse {
            allocator.destroy(reader);
            return error.ZstdFailedToCreateInstance;
        };
        _ = c.ZSTD_initDStream(reader.zstd);
        return reader;
    }

    pub fn end(this: *ZstdReaderArrayList) void {
        if (this.state != .End) {
            _ = c.ZSTD_freeDStream(this.zstd);
            this.state = .End;
        }
    }

    pub fn deinit(this: *ZstdReaderArrayList) void {
        var alloc = this.allocator;
        this.end();
        alloc.destroy(this);
    }

    pub fn readAll(this: *ZstdReaderArrayList, is_done: bool) !void {
        defer this.list_ptr.* = this.list;

        if (this.state == .End or this.state == .Error) return;

        while (this.state == .Uninitialized or this.state == .Inflating) {
            var unused = this.list.unusedCapacitySlice();
            if (unused.len < 4096) {
                try this.list.ensureUnusedCapacity(this.list_allocator, 4096);
                unused = this.list.unusedCapacitySlice();
            }

            const next_in = this.input[this.total_in..];
            var in_buf: c.ZSTD_inBuffer = .{
                .src = if (next_in.len > 0) next_in.ptr else null,
                .size = next_in.len,
                .pos = 0,
            };
            var out_buf: c.ZSTD_outBuffer = .{
                .dst = if (unused.len > 0) unused.ptr else null,
                .size = unused.len,
                .pos = 0,
            };

            const rc = c.ZSTD_decompressStream(this.zstd, &out_buf, &in_buf);
            if (c.ZSTD_isError(rc) != 0) {
                this.state = .Error;
                return error.ZstdDecompressionError;
            }

            const bytes_written = out_buf.pos;
            const bytes_read = in_buf.pos;
            this.list.items.len += bytes_written;
            this.total_in += bytes_read;
            this.total_out += bytes_written;

            if (rc == 0) {
                this.end();
                return;
            }

            if (bytes_read == next_in.len) {
                this.state = .Inflating;
                if (is_done) {
                    this.state = .Error;
                }
                return error.ShortRead;
            }
        }
    }
};
