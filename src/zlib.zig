// @link "deps/zlib/libz.a"

const std = @import("std");
const bun = @import("root").bun;

const mimalloc = @import("./allocators/mimalloc.zig");

pub const MAX_WBITS = 15;

test "Zlib Read" {
    const expected_text = @embedFile("./zlib.test.txt");
    const input = bun.asByteSlice(@embedFile("./zlib.test.gz"));
    std.debug.print("zStream Size: {d}", .{@sizeOf(zStream_struct)});
    var output = std.ArrayList(u8).init(std.heap.c_allocator);
    var writer = output.writer();
    const ZlibReader = NewZlibReader(@TypeOf(&writer), 4096);

    var reader = try ZlibReader.init(&writer, input, std.heap.c_allocator);
    defer reader.deinit();
    try reader.readAll();

    try std.testing.expectEqualStrings(expected_text, output.items);
}

test "ZlibArrayList Read" {
    const expected_text = @embedFile("./zlib.test.txt");
    const input = bun.asByteSlice(@embedFile("./zlib.test.gz"));
    std.debug.print("zStream Size: {d}", .{@sizeOf(zStream_struct)});
    var list = std.ArrayListUnmanaged(u8){};
    try list.ensureUnusedCapacity(std.heap.c_allocator, 4096);
    var reader = try ZlibReaderArrayList.init(input, &list, std.heap.c_allocator);
    defer reader.deinit();
    try reader.readAll();

    try std.testing.expectEqualStrings(expected_text, list.items);
}

pub extern fn zlibVersion() [*c]const u8;

pub extern fn compress(dest: [*]Bytef, destLen: *uLongf, source: [*]const Bytef, sourceLen: uLong) c_int;
pub extern fn compress2(dest: [*]Bytef, destLen: *uLongf, source: [*]const Bytef, sourceLen: uLong, level: c_int) c_int;
pub extern fn compressBound(sourceLen: uLong) uLong;
pub extern fn uncompress(dest: [*]Bytef, destLen: *uLongf, source: [*]const Bytef, sourceLen: uLong) c_int;
pub const struct_gzFile_s = extern struct {
    have: c_uint,
    next: [*c]u8,
    pos: c_long,
};
pub const gzFile = [*c]struct_gzFile_s;

// https://zlib.net/manual.html#Stream
const Byte = u8;
const uInt = u32;
const uLong = u64;
const Bytef = Byte;
const charf = u8;
const intf = c_int;
const uIntf = uInt;
const uLongf = uLong;
const voidpc = ?*const anyopaque;
const voidpf = ?*anyopaque;
const voidp = ?*anyopaque;
const z_crc_t = c_uint;

// typedef voidpf (*alloc_func) OF((voidpf opaque, uInt items, uInt size));
// typedef void   (*free_func)  OF((voidpf opaque, voidpf address));

pub const z_alloc_fn = ?*const fn (*anyopaque, uInt, uInt) callconv(.C) voidpf;
pub const z_free_fn = ?*const fn (*anyopaque, *anyopaque) callconv(.C) void;

pub const struct_internal_state = extern struct {
    dummy: c_int,
};
// typedef struct z_stream_s {
//     z_const Bytef *next_in;  /* next input byte */
//     uInt     avail_in;  /* number of bytes available at next_in */
//     uLong    total_in;  /* total number of input bytes read so far */

//     Bytef    *next_out; /* next output byte will go here */
//     uInt     avail_out; /* remaining free space at next_out */
//     uLong    total_out; /* total number of bytes output so far */

//     z_const char *msg;  /* last error message, NULL if no error */
//     struct internal_state FAR *state; /* not visible by applications */

//     alloc_func zalloc;  /* used to allocate the internal state */
//     free_func  zfree;   /* used to free the internal state */
//     voidpf     opaque;  /* private data object passed to zalloc and zfree */

//     int     data_type;  /* best guess about the data type: binary or text
//                            for deflate, or the decoding state for inflate */
//     uLong   adler;      /* Adler-32 or CRC-32 value of the uncompressed data */
//     uLong   reserved;   /* reserved for future use */
// } z_stream;

pub const zStream_struct = extern struct {
    /// next input byte
    next_in: [*c]const u8,
    /// number of bytes available at next_in
    avail_in: uInt,
    /// total number of input bytes read so far
    total_in: uLong,

    /// next output byte will go here
    next_out: [*c]u8,
    /// remaining free space at next_out
    avail_out: uInt,
    /// total number of bytes output so far
    total_out: uLong,

    /// last error message, NULL if no error
    err_msg: [*c]const u8,
    /// not visible by applications
    internal_state: ?*struct_internal_state,

    /// used to allocate the internal state
    alloc_func: z_alloc_fn,
    /// used to free the internal state
    free_func: z_free_fn,
    /// private data object passed to zalloc and zfree
    user_data: *anyopaque,

    /// best guess about the data type: binary or text for deflate, or the decoding state for inflate
    data_type: DataType,

    ///Adler-32 or CRC-32 value of the uncompressed data
    adler: uLong,
    /// reserved for future use
    reserved: uLong,
};

pub const z_stream = zStream_struct;
pub const z_streamp = *z_stream;

// #define Z_BINARY   0
// #define Z_TEXT     1
// #define Z_ASCII    Z_TEXT   /* for compatibility with 1.2.2 and earlier */
// #define Z_UNKNOWN  2
pub const DataType = enum(c_int) {
    Binary = 0,
    Text = 1,
    Unknown = 2,
};

// #define Z_OK            0
// #define Z_STREAM_END    1
// #define Z_NEED_DICT     2
// #define Z_ERRNO        (-1)
// #define Z_STREAM_ERROR (-2)
// #define Z_DATA_ERROR   (-3)
// #define Z_MEM_ERROR    (-4)
// #define Z_BUF_ERROR    (-5)
// #define Z_VERSION_ERROR (-6)
pub const ReturnCode = enum(c_int) {
    Ok = 0,
    StreamEnd = 1,
    NeedDict = 2,
    ErrNo = -1,
    StreamError = -2,
    DataError = -3,
    MemError = -4,
    BufError = -5,
    VersionError = -6,
};

// #define Z_NO_FLUSH      0
// #define Z_PARTIAL_FLUSH 1
// #define Z_SYNC_FLUSH    2
// #define Z_FULL_FLUSH    3
// #define Z_FINISH        4
// #define Z_BLOCK         5
// #define Z_TREES         6
pub const FlushValue = enum(c_int) {
    NoFlush = 0,
    PartialFlush = 1,
    /// Z_SYNC_FLUSH requests that inflate() flush as much output as possible to the output buffer
    SyncFlush = 2,
    FullFlush = 3,
    Finish = 4,

    /// Z_BLOCK requests that inflate() stop if and when it gets to the next / deflate block boundary When decoding the zlib or gzip format, this will / cause inflate() to return immediately after the header and before the / first block. When doing a raw inflate, inflate() will go ahead and / process the first block, and will return when it gets to the end of that / block, or when it runs out of data. / The Z_BLOCK option assists in appending to or combining deflate streams. / To assist in this, on return inflate() always sets strm->data_type to the / number of unused bits in the last byte taken from strm->next_in, plus 64 / if inflate() is currently decoding the last block in the deflate stream, / plus 128 if inflate() returned immediately after decoding an end-of-block / code or decoding the complete header up to just before the first byte of / the deflate stream. The end-of-block will not be indicated until all of / the uncompressed data from that block has been written to strm->next_out. / The number of unused bits may in general be greater than seven, except / when bit 7 of data_type is set, in which case the number of unused bits / will be less than eight. data_type is set as noted here every time / inflate() returns for all flush options, and so can be used to determine / the amount of currently consumed input in bits.
    Block = 5,

    /// The Z_TREES option behaves as Z_BLOCK does, but it also returns when the end of each deflate block header is reached, before any actual data in that block is decoded. This allows the caller to determine the length of the deflate block header for later use in random access within a deflate block. 256 is added to the value of strm->data_type when inflate() returns immediately after reaching the end of the deflate block header.
    Trees = 6,
};

// ZEXTERN int ZEXPORT inflateInit OF((z_streamp strm));

/// Initializes the internal stream state for decompression. The fields next_in, avail_in, zalloc, zfree and opaque must be initialized before by the caller. In the current version of inflate, the provided input is not read or consumed. The allocation of a sliding window will be deferred to the first call of inflate (if the decompression does not complete on the first call). If zalloc and zfree are set to Z_NULL, inflateInit updates them to use default allocation functions.
///
/// inflateInit returns Z_OK if success, Z_MEM_ERROR if there was not enough memory, Z_VERSION_ERROR if the zlib library version is incompatible with the version assumed by the caller, or Z_STREAM_ERROR if the parameters are invalid, such as a null pointer to the structure. msg is set to null if there is no error message. inflateInit does not perform any decompression. Actual decompression will be done by inflate(). So next_in, and avail_in, next_out, and avail_out are unused and unchanged. The current implementation of inflateInit() does not process any header information—that is deferred until inflate() is called.
pub extern fn inflateInit_(strm: z_streamp, version: [*c]const u8, stream_size: c_int) ReturnCode;
pub extern fn inflateInit2_(strm: z_streamp, window_size: c_int, version: [*c]const u8, stream_size: c_int) ReturnCode;

/// inflate decompresses as much data as possible, and stops when the input buffer becomes empty or the output buffer becomes full. It may introduce some output latency (reading input without producing any output) except when forced to flush.
/// The detailed semantics are as follows. inflate performs one or both of the following actions:
///
/// - Decompress more input starting at next_in and update next_in and avail_in accordingly. If not all input can be processed (because there is not enough room in the output buffer), then next_in and avail_in are updated accordingly, and processing will resume at this point for the next call of inflate().
/// - Generate more output starting at next_out and update next_out and avail_out accordingly. inflate() provides as much output as possible, until there is no more input data or no more space in the output buffer (see below about the flush parameter).
///
/// Before the call of inflate(), the application should ensure that at least one of the actions is possible, by providing more input and/or consuming more output, and updating the next_* and avail_* values accordingly. If the caller of inflate() does not provide both available input and available output space, it is possible that there will be no progress made. The application can consume the uncompressed output when it wants, for example when the output buffer is full (avail_out == 0), or after each call of inflate(). If inflate returns Z_OK and with zero avail_out, it must be called again after making room in the output buffer because there might be more output pending.
///
/// The flush parameter of inflate() can be Z_NO_FLUSH, Z_SYNC_FLUSH, Z_FINISH, Z_BLOCK, or Z_TREES. Z_SYNC_FLUSH requests that inflate() flush as much output as possible to the output buffer. Z_BLOCK requests that inflate() stop if and when it gets to the next deflate block boundary. When decoding the zlib or gzip format, this will cause inflate() to return immediately after the header and before the first block. When doing a raw inflate, inflate() will go ahead and process the first block, and will return when it gets to the end of that block, or when it runs out of data.
///
/// The Z_BLOCK option assists in appending to or combining deflate streams. To assist in this, on return inflate() always sets strm->data_type to the number of unused bits in the last byte taken from strm->next_in, plus 64 if inflate() is currently decoding the last block in the deflate stream, plus 128 if inflate() returned immediately after decoding an end-of-block code or decoding the complete header up to just before the first byte of the deflate stream. The end-of-block will not be indicated until all of the uncompressed data from that block has been written to strm->next_out. The number of unused bits may in general be greater than seven, except when bit 7 of data_type is set, in which case the number of unused bits will be less than eight. data_type is set as noted here every time inflate() returns for all flush options, and so can be used to determine the amount of currently consumed input in bits.
///
/// The Z_TREES option behaves as Z_BLOCK does, but it also returns when the end of each deflate block header is reached, before any actual data in that block is decoded. This allows the caller to determine the length of the deflate block header for later use in random access within a deflate block. 256 is added to the value of strm->data_type when inflate() returns immediately after reaching the end of the deflate block header.
///
/// inflate() should normally be called until it returns Z_STREAM_END or an error. However if all decompression is to be performed in a single step (a single call of inflate), the parameter flush should be set to Z_FINISH. In this case all pending input is processed and all pending output is flushed; avail_out must be large enough to hold all of the uncompressed data for the operation to complete. (The size of the uncompressed data may have been saved by the compressor for this purpose.) The use of Z_FINISH is not required to perform an inflation in one step. However it may be used to inform inflate that a faster approach can be used for the single inflate() call. Z_FINISH also informs inflate to not maintain a sliding window if the stream completes, which reduces inflate's memory footprint. If the stream does not complete, either because not all of the stream is provided or not enough output space is provided, then a sliding window will be allocated and inflate() can be called again to continue the operation as if Z_NO_FLUSH had been used.
///
/// In this implementation, inflate() always flushes as much output as possible to the output buffer, and always uses the faster approach on the first call. So the effects of the flush parameter in this implementation are on the return value of inflate() as noted below, when inflate() returns early when Z_BLOCK or Z_TREES is used, and when inflate() avoids the allocation of memory for a sliding window when Z_FINISH is used.
///
/// If a preset dictionary is needed after this call (see inflateSetDictionary below), inflate sets strm->adler to the Adler-32 checksum of the dictionary chosen by the compressor and returns Z_NEED_DICT; otherwise it sets strm->adler to the Adler-32 checksum of all output produced so far (that is, total_out bytes) and returns Z_OK, Z_STREAM_END or an error code as described below. At the end of the stream, inflate() checks that its computed Adler-32 checksum is equal to that saved by the compressor and returns Z_STREAM_END only if the checksum is correct.
///
/// inflate() will decompress and check either zlib-wrapped or gzip-wrapped deflate data. The header type is detected automatically, if requested when initializing with inflateInit2(). Any information contained in the gzip header is not retained unless inflateGetHeader() is used. When processing gzip-wrapped deflate data, strm->adler32 is set to the CRC-32 of the output produced so far. The CRC-32 is checked against the gzip trailer, as is the uncompressed length, modulo 2^32.
///
/// inflate() returns Z_OK if some progress has been made (more input processed or more output produced), Z_STREAM_END if the end of the compressed data has been reached and all uncompressed output has been produced, Z_NEED_DICT if a preset dictionary is needed at this point, Z_DATA_ERROR if the input data was corrupted (input stream not conforming to the zlib format or incorrect check value, in which case strm->msg points to a string with a more specific error), Z_STREAM_ERROR if the stream structure was inconsistent (for example next_in or next_out was Z_NULL, or the state was inadvertently written over by the application), Z_MEM_ERROR if there was not enough memory, Z_BUF_ERROR if no progress was possible or if there was not enough room in the output buffer when Z_FINISH is used. Note that Z_BUF_ERROR is not fatal, and inflate() can be called again with more input and more output space to continue decompressing. If Z_DATA_ERROR is returned, the application may then call inflateSync() to look for a good compression block if a partial recovery of the data is to be attempted.
extern fn inflate(stream: [*c]zStream_struct, flush: FlushValue) ReturnCode;

/// inflateEnd returns Z_OK if success, or Z_STREAM_ERROR if the stream state was inconsistent.
const InflateEndResult = enum(c_int) {
    Ok = 0,
    StreamEnd = 1,
};

/// All dynamically allocated data structures for this stream are freed. This function discards any unprocessed input and does not flush any pending output.
extern fn inflateEnd(stream: [*c]zStream_struct) InflateEndResult;

pub fn NewZlibReader(comptime Writer: type, comptime buffer_size: usize) type {
    return struct {
        const ZlibReader = @This();
        pub const State = enum {
            Uninitialized,
            Inflating,
            End,
            Error,
        };

        context: Writer,
        input: []const u8,
        buf: [buffer_size]u8,
        zlib: zStream_struct,
        allocator: std.mem.Allocator,
        state: State = State.Uninitialized,

        pub fn alloc(_: *anyopaque, items: uInt, len: uInt) callconv(.C) *anyopaque {
            return mimalloc.mi_malloc(items * len) orelse unreachable;
        }

        pub fn free(_: *anyopaque, data: *anyopaque) callconv(.C) void {
            mimalloc.mi_free(data);
        }

        pub fn deinit(this: *ZlibReader) void {
            var allocator = this.allocator;
            this.end();
            allocator.destroy(this);
        }

        pub fn end(this: *ZlibReader) void {
            if (this.state == State.Inflating) {
                _ = inflateEnd(&this.zlib);
                this.state = State.End;
            }
        }

        pub fn init(writer: Writer, input: []const u8, allocator: std.mem.Allocator) !*ZlibReader {
            var zlib_reader = try allocator.create(ZlibReader);
            zlib_reader.* = ZlibReader{
                .context = writer,
                .input = input,
                .buf = std.mem.zeroes([buffer_size]u8),
                .allocator = allocator,
                .zlib = undefined,
            };

            zlib_reader.zlib = zStream_struct{
                .next_in = input.ptr,
                .avail_in = @as(uInt, @intCast(input.len)),
                .total_in = @as(uInt, @intCast(input.len)),

                .next_out = &zlib_reader.buf,
                .avail_out = buffer_size,
                .total_out = buffer_size,

                .err_msg = null,
                .alloc_func = ZlibReader.alloc,
                .free_func = ZlibReader.free,

                .internal_state = null,
                .user_data = zlib_reader,

                .data_type = DataType.Unknown,
                .adler = 0,
                .reserved = 0,
            };

            switch (inflateInit2_(&zlib_reader.zlib, 15 + 32, zlibVersion(), @sizeOf(zStream_struct))) {
                ReturnCode.Ok => return zlib_reader,
                ReturnCode.MemError => {
                    zlib_reader.deinit();
                    return error.OutOfMemory;
                },
                ReturnCode.StreamError => {
                    zlib_reader.deinit();
                    return error.InvalidArgument;
                },
                ReturnCode.VersionError => {
                    zlib_reader.deinit();
                    return error.InvalidArgument;
                },
                else => unreachable,
            }
        }

        pub fn errorMessage(this: *ZlibReader) ?[]const u8 {
            if (this.zlib.err_msg) |msg_ptr| {
                return std.mem.sliceTo(msg_ptr, 0);
            }

            return null;
        }

        pub fn readAll(this: *ZlibReader) !void {
            while (this.state == State.Uninitialized or this.state == State.Inflating) {

                // Before the call of inflate(), the application should ensure
                // that at least one of the actions is possible, by providing
                // more input and/or consuming more output, and updating the
                // next_* and avail_* values accordingly. If the caller of
                // inflate() does not provide both available input and available
                // output space, it is possible that there will be no progress
                // made. The application can consume the uncompressed output
                // when it wants, for example when the output buffer is full
                // (avail_out == 0), or after each call of inflate(). If inflate
                // returns Z_OK and with zero avail_out, it must be called again
                // after making room in the output buffer because there might be
                // more output pending.

                // - Decompress more input starting at next_in and update
                //   next_in and avail_in accordingly. If not all input can be
                //   processed (because there is not enough room in the output
                //   buffer), then next_in and avail_in are updated accordingly,
                //   and processing will resume at this point for the next call
                //   of inflate().

                // - Generate more output starting at next_out and update
                //   next_out and avail_out accordingly. inflate() provides as
                //   much output as possible, until there is no more input data
                //   or no more space in the output buffer (see below about the
                //   flush parameter).

                if (this.zlib.avail_out == 0) {
                    var written = try this.context.write(&this.buf);
                    while (written < this.zlib.avail_out) {
                        written += try this.context.write(this.buf[written..]);
                    }
                    this.zlib.avail_out = buffer_size;
                    this.zlib.next_out = &this.buf;
                }

                if (this.zlib.avail_in == 0) {
                    return error.ShortRead;
                }

                const rc = inflate(&this.zlib, FlushValue.PartialFlush);
                this.state = State.Inflating;

                switch (rc) {
                    ReturnCode.StreamEnd => {
                        this.state = State.End;
                        var remainder = this.buf[0 .. buffer_size - this.zlib.avail_out];
                        remainder = remainder[try this.context.write(remainder)..];
                        while (remainder.len > 0) {
                            remainder = remainder[try this.context.write(remainder)..];
                        }
                        this.end();
                        return;
                    },
                    ReturnCode.MemError => {
                        this.state = State.Error;
                        return error.OutOfMemory;
                    },
                    ReturnCode.StreamError,
                    ReturnCode.DataError,
                    ReturnCode.BufError,
                    ReturnCode.NeedDict,
                    ReturnCode.VersionError,
                    ReturnCode.ErrNo,
                    => {
                        this.state = State.Error;
                        return error.ZlibError;
                    },
                    ReturnCode.Ok => {},
                }
            }
        }
    };
}

pub const ZlibError = error{
    OutOfMemory,
    InvalidArgument,
    ZlibError,
    ShortRead,
};

pub const ZlibReaderArrayList = struct {
    const ZlibReader = ZlibReaderArrayList;

    pub const State = enum {
        Uninitialized,
        Inflating,
        End,
        Error,
    };

    input: []const u8,
    list: std.ArrayListUnmanaged(u8),
    list_allocator: std.mem.Allocator,
    list_ptr: *std.ArrayListUnmanaged(u8),
    zlib: zStream_struct,
    allocator: std.mem.Allocator,
    state: State = State.Uninitialized,

    pub fn alloc(_: *anyopaque, items: uInt, len: uInt) callconv(.C) *anyopaque {
        return mimalloc.mi_malloc(items * len) orelse unreachable;
    }

    pub fn free(_: *anyopaque, data: *anyopaque) callconv(.C) void {
        mimalloc.mi_free(data);
    }

    pub fn deinit(this: *ZlibReader) void {
        var allocator = this.allocator;
        this.end();
        allocator.destroy(this);
    }

    pub fn end(this: *ZlibReader) void {
        // always free with `inflateEnd`
        if (this.state != State.End) {
            _ = inflateEnd(&this.zlib);
            this.state = State.End;
        }
    }

    pub fn init(
        input: []const u8,
        list: *std.ArrayListUnmanaged(u8),
        allocator: std.mem.Allocator,
    ) !*ZlibReader {
        const options: Options = .{
            .windowBits = 15 + 32,
        };

        return initWithOptions(input, list, allocator, options);
    }

    pub fn initWithOptions(input: []const u8, list: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, options: Options) ZlibError!*ZlibReader {
        return initWithOptionsAndListAllocator(input, list, allocator, allocator, options);
    }

    pub fn initWithOptionsAndListAllocator(input: []const u8, list: *std.ArrayListUnmanaged(u8), list_allocator: std.mem.Allocator, allocator: std.mem.Allocator, options: Options) ZlibError!*ZlibReader {
        var zlib_reader = try allocator.create(ZlibReader);
        zlib_reader.* = ZlibReader{
            .input = input,
            .list = list.*,
            .list_allocator = list_allocator,
            .list_ptr = list,
            .allocator = allocator,
            .zlib = undefined,
        };

        zlib_reader.zlib = zStream_struct{
            .next_in = input.ptr,
            .avail_in = @as(uInt, @intCast(input.len)),
            .total_in = @as(uInt, @intCast(input.len)),

            .next_out = zlib_reader.list.items.ptr,
            .avail_out = @as(u32, @intCast(zlib_reader.list.items.len)),
            .total_out = zlib_reader.list.items.len,

            .err_msg = null,
            .alloc_func = ZlibReader.alloc,
            .free_func = ZlibReader.free,

            .internal_state = null,
            .user_data = zlib_reader,

            .data_type = DataType.Unknown,
            .adler = 0,
            .reserved = 0,
        };

        switch (inflateInit2_(&zlib_reader.zlib, options.windowBits, zlibVersion(), @sizeOf(zStream_struct))) {
            ReturnCode.Ok => return zlib_reader,
            ReturnCode.MemError => {
                zlib_reader.deinit();
                return error.OutOfMemory;
            },
            ReturnCode.StreamError => {
                zlib_reader.deinit();
                return error.InvalidArgument;
            },
            ReturnCode.VersionError => {
                zlib_reader.deinit();
                return error.InvalidArgument;
            },
            else => unreachable,
        }
    }

    pub fn errorMessage(this: *ZlibReader) ?[]const u8 {
        if (this.zlib.err_msg) |msg_ptr| {
            return std.mem.sliceTo(msg_ptr, 0);
        }

        return null;
    }

    pub fn readAll(this: *ZlibReader) ZlibError!void {
        defer {
            if (this.list.items.len > this.zlib.total_out) {
                this.list.shrinkRetainingCapacity(this.zlib.total_out);
            } else if (this.zlib.total_out < this.list.capacity) {
                this.list.items.len = this.zlib.total_out;
            }
            this.list_ptr.* = this.list;
        }

        while (this.state == State.Uninitialized or this.state == State.Inflating) {

            // Before the call of inflate(), the application should ensure
            // that at least one of the actions is possible, by providing
            // more input and/or consuming more output, and updating the
            // next_* and avail_* values accordingly. If the caller of
            // inflate() does not provide both available input and available
            // output space, it is possible that there will be no progress
            // made. The application can consume the uncompressed output
            // when it wants, for example when the output buffer is full
            // (avail_out == 0), or after each call of inflate(). If inflate
            // returns Z_OK and with zero avail_out, it must be called again
            // after making room in the output buffer because there might be
            // more output pending.

            // - Decompress more input starting at next_in and update
            //   next_in and avail_in accordingly. If not all input can be
            //   processed (because there is not enough room in the output
            //   buffer), then next_in and avail_in are updated accordingly,
            //   and processing will resume at this point for the next call
            //   of inflate().

            // - Generate more output starting at next_out and update
            //   next_out and avail_out accordingly. inflate() provides as
            //   much output as possible, until there is no more input data
            //   or no more space in the output buffer (see below about the
            //   flush parameter).

            if (this.zlib.avail_out == 0) {
                const initial = this.list.items.len;
                try this.list.ensureUnusedCapacity(this.list_allocator, 4096);
                this.list.expandToCapacity();
                this.zlib.next_out = &this.list.items[initial];
                this.zlib.avail_out = @as(u32, @intCast(this.list.items.len - initial));
            }

            if (this.zlib.avail_in == 0) {
                return error.ShortRead;
            }

            const rc = inflate(&this.zlib, FlushValue.PartialFlush);
            this.state = State.Inflating;

            switch (rc) {
                ReturnCode.StreamEnd => {
                    this.end();
                    return;
                },
                ReturnCode.MemError => {
                    this.state = State.Error;
                    return error.OutOfMemory;
                },
                ReturnCode.StreamError,
                ReturnCode.DataError,
                ReturnCode.BufError,
                ReturnCode.NeedDict,
                ReturnCode.VersionError,
                ReturnCode.ErrNo,
                => {
                    this.state = State.Error;
                    return error.ZlibError;
                },
                ReturnCode.Ok => {},
            }
        }
    }
};

pub const Options = struct {
    gzip: bool = false,
    level: c_int = 6,
    method: c_int = 8,
    windowBits: c_int = 15,
    memLevel: c_int = 8,
    strategy: c_int = 0,
};

///
///     Initializes the internal stream state for compression.  The fields
///   zalloc, zfree and opaque must be initialized before by the caller.  If
///   zalloc and zfree are set to Z_NULL, deflateInit updates them to use default
///   allocation functions.
///
///     The compression level must be Z_DEFAULT_COMPRESSION, or between 0 and 9:
///   1 gives best speed, 9 gives best compression, 0 gives no compression at all
///   (the input data is simply copied a block at a time).  Z_DEFAULT_COMPRESSION
///   requests a default compromise between speed and compression (currently
///   equivalent to level 6).
///
///     deflateInit returns Z_OK if success, Z_MEM_ERROR if there was not enough
///   memory, Z_STREAM_ERROR if level is not a valid compression level, or
///   Z_VERSION_ERROR if the zlib library version (zlib_version) is incompatible
///   with the version assumed by the caller (ZLIB_VERSION).  msg is set to null
///   if there is no error message.  deflateInit does not perform any compression:
///   this will be done by deflate().
extern fn deflateInit_(strm: z_stream, level: c_int, stream_size: c_int) c_int;

///
///    deflate compresses as much data as possible, and stops when the input
///  buffer becomes empty or the output buffer becomes full.  It may introduce
///  some output latency (reading input without producing any output) except when
///  forced to flush.
///
///    The detailed semantics are as follows.  deflate performs one or both of the
///  following actions:
///
///  - Compress more input starting at next_in and update next_in and avail_in
///    accordingly.  If not all input can be processed (because there is not
///    enough room in the output buffer), next_in and avail_in are updated and
///    processing will resume at this point for the next call of deflate().
///
///  - Provide more output starting at next_out and update next_out and avail_out
///    accordingly.  This action is forced if the parameter flush is non zero.
///    Forcing flush frequently degrades the compression ratio, so this parameter
///    should be set only when necessary (in interactive applications).  Some
///    output may be provided even if flush is not set.
///
///    Before the call of deflate(), the application should ensure that at least
///  one of the actions is possible, by providing more input and/or consuming more
///  output, and updating avail_in or avail_out accordingly; avail_out should
///  never be zero before the call.  The application can consume the compressed
///  output when it wants, for example when the output buffer is full (avail_out
///  == 0), or after each call of deflate().  If deflate returns Z_OK and with
///  zero avail_out, it must be called again after making room in the output
///  buffer because there might be more output pending.
///
///    Normally the parameter flush is set to Z_NO_FLUSH, which allows deflate to
///  decide how much data to accumulate before producing output, in order to
///  maximize compression.
///
///    If the parameter flush is set to Z_SYNC_FLUSH, all pending output is
///  flushed to the output buffer and the output is aligned on a byte boundary, so
///  that the decompressor can get all input data available so far.  (In
///  particular avail_in is zero after the call if enough output space has been
///  provided before the call.) Flushing may degrade compression for some
///  compression algorithms and so it should be used only when necessary.  This
///  completes the current deflate block and follows it with an empty stored block
///  that is three bits plus filler bits to the next byte, followed by four bytes
///  (00 00 ff ff).
///
///    If flush is set to Z_PARTIAL_FLUSH, all pending output is flushed to the
///  output buffer, but the output is not aligned to a byte boundary.  All of the
///  input data so far will be available to the decompressor, as for Z_SYNC_FLUSH.
///  This completes the current deflate block and follows it with an empty fixed
///  codes block that is 10 bits long.  This assures that enough bytes are output
///  in order for the decompressor to finish the block before the empty fixed code
///  block.
///
///    If flush is set to Z_BLOCK, a deflate block is completed and emitted, as
///  for Z_SYNC_FLUSH, but the output is not aligned on a byte boundary, and up to
///  seven bits of the current block are held to be written as the next byte after
///  the next deflate block is completed.  In this case, the decompressor may not
///  be provided enough bits at this point in order to complete decompression of
///  the data provided so far to the compressor.  It may need to wait for the next
///  block to be emitted.  This is for advanced applications that need to control
///  the emission of deflate blocks.
///
///    If flush is set to Z_FULL_FLUSH, all output is flushed as with
///  Z_SYNC_FLUSH, and the compression state is reset so that decompression can
///  restart from this point if previous compressed data has been damaged or if
///  random access is desired.  Using Z_FULL_FLUSH too often can seriously degrade
///  compression.
///
///    If deflate returns with avail_out == 0, this function must be called again
///  with the same value of the flush parameter and more output space (updated
///  avail_out), until the flush is complete (deflate returns with non-zero
///  avail_out).  In the case of a Z_FULL_FLUSH or Z_SYNC_FLUSH, make sure that
///  avail_out is greater than six to avoid repeated flush markers due to
///  avail_out == 0 on return.
///
///    If the parameter flush is set to Z_FINISH, pending input is processed,
///  pending output is flushed and deflate returns with Z_STREAM_END if there was
///  enough output space; if deflate returns with Z_OK, this function must be
///  called again with Z_FINISH and more output space (updated avail_out) but no
///  more input data, until it returns with Z_STREAM_END or an error.  After
///  deflate has returned Z_STREAM_END, the only possible operations on the stream
///  are deflateReset or deflateEnd.
///
///    Z_FINISH can be used immediately after deflateInit if all the compression
///  is to be done in a single step.  In this case, avail_out must be at least the
///  value returned by deflateBound (see below).  Then deflate is guaranteed to
///  return Z_STREAM_END.  If not enough output space is provided, deflate will
///  not return Z_STREAM_END, and it must be called again as described above.
///
///    deflate() sets strm->adler to the adler32 checksum of all input read
///  so far (that is, total_in bytes).
///
///    deflate() may update strm->data_type if it can make a good guess about
///  the input data type (Z_BINARY or Z_TEXT).  In doubt, the data is considered
///  binary.  This field is only for information purposes and does not affect the
///  compression algorithm in any manner.
///
///    deflate() returns Z_OK if some progress has been made (more input
///  processed or more output produced), Z_STREAM_END if all input has been
///  consumed and all output has been produced (only when flush is set to
///  Z_FINISH), Z_STREAM_ERROR if the stream state was inconsistent (for example
///  if next_in or next_out was Z_NULL), Z_BUF_ERROR if no progress is possible
///  (for example avail_in or avail_out was zero).  Note that Z_BUF_ERROR is not
///  fatal, and deflate() can be called again with more input and more output
///  space to continue compressing.
///
extern fn deflate(strm: z_streamp, flush: FlushValue) ReturnCode;

///
///     All dynamically allocated data structures for this stream are freed.
///   This function discards any unprocessed input and does not flush any pending
///   output.
///
///     deflateEnd returns Z_OK if success, Z_STREAM_ERROR if the
///   stream state was inconsistent, Z_DATA_ERROR if the stream was freed
///   prematurely (some input or output was discarded).  In the error case, msg
///   may be set but then points to a static string (which must not be
///   deallocated).
extern fn deflateEnd(stream: z_streamp) ReturnCode;

//   deflateBound() returns an upper bound on the compressed size after
//  deflation of sourceLen bytes.  It must be called after deflateInit() or
//  deflateInit2(), and after deflateSetHeader(), if used.  This would be used
//  to allocate an output buffer for deflation in a single pass, and so would be
//  called before deflate().  If that first deflate() call is provided the
//  sourceLen input bytes, an output buffer allocated to the size returned by
//  deflateBound(), and the flush value Z_FINISH, then deflate() is guaranteed
//  to return Z_STREAM_END.  Note that it is possible for the compressed size to
//  be larger than the value returned by deflateBound() if flush options other
//  than Z_FINISH or Z_NO_FLUSH are used.
extern fn deflateBound(strm: z_streamp, sourceLen: u64) u64;

///
///     This is another version of deflateInit with more compression options.  The
///   fields next_in, zalloc, zfree and opaque must be initialized before by the
///   caller.
///
///     The method parameter is the compression method.  It must be Z_DEFLATED in
///   this version of the library.
///
///     The windowBits parameter is the base two logarithm of the window size
///   (the size of the history buffer).  It should be in the range 8..15 for this
///   version of the library.  Larger values of this parameter result in better
///   compression at the expense of memory usage.  The default value is 15 if
///   deflateInit is used instead.
///
///     windowBits can also be -8..-15 for raw deflate.  In this case, -windowBits
///   determines the window size.  deflate() will then generate raw deflate data
///   with no zlib header or trailer, and will not compute an adler32 check value.
///
///     windowBits can also be greater than 15 for optional gzip encoding.  Add
///   16 to windowBits to write a simple gzip header and trailer around the
///   compressed data instead of a zlib wrapper.  The gzip header will have no
///   file name, no extra data, no comment, no modification time (set to zero), no
///   header crc, and the operating system will be set to 255 (unknown).  If a
///   gzip stream is being written, strm->adler is a crc32 instead of an adler32.
///
///     The memLevel parameter specifies how much memory should be allocated
///   for the internal compression state.  memLevel=1 uses minimum memory but is
///   slow and reduces compression ratio; memLevel=9 uses maximum memory for
///   optimal speed.  The default value is 8.  See zconf.h for total memory usage
///   as a function of windowBits and memLevel.
///
///     The strategy parameter is used to tune the compression algorithm.  Use the
///   value Z_DEFAULT_STRATEGY for normal data, Z_FILTERED for data produced by a
///   filter (or predictor), Z_HUFFMAN_ONLY to force Huffman encoding only (no
///   string match), or Z_RLE to limit match distances to one (run-length
///   encoding).  Filtered data consists mostly of small values with a somewhat
///   random distribution.  In this case, the compression algorithm is tuned to
///   compress them better.  The effect of Z_FILTERED is to force more Huffman
///   coding and less string matching; it is somewhat intermediate between
///   Z_DEFAULT_STRATEGY and Z_HUFFMAN_ONLY.  Z_RLE is designed to be almost as
///   fast as Z_HUFFMAN_ONLY, but give better compression for PNG image data.  The
///   strategy parameter only affects the compression ratio but not the
///   correctness of the compressed output even if it is not set appropriately.
///   Z_FIXED prevents the use of dynamic Huffman codes, allowing for a simpler
///   decoder for special applications.
///
///     deflateInit2 returns Z_OK if success, Z_MEM_ERROR if there was not enough
///   memory, Z_STREAM_ERROR if any parameter is invalid (such as an invalid
///   method), or Z_VERSION_ERROR if the zlib library version (zlib_version) is
///   incompatible with the version assumed by the caller (ZLIB_VERSION).  msg is
///   set to null if there is no error message.  deflateInit2 does not perform any
///   compression: this will be done by deflate().
extern fn deflateInit2_(strm: z_streamp, level: c_int, method: c_int, windowBits: c_int, memLevel: c_int, strategy: c_int, version: [*c]const u8, stream_size: c_int) ReturnCode;

/// Not for streaming!
pub const ZlibCompressorArrayList = struct {
    const ZlibCompressor = ZlibCompressorArrayList;

    pub const State = enum {
        Uninitialized,
        Inflating,
        End,
        Error,
    };

    input: []const u8,
    list: std.ArrayListUnmanaged(u8),
    list_allocator: std.mem.Allocator,
    list_ptr: *std.ArrayListUnmanaged(u8),
    zlib: zStream_struct,
    allocator: std.mem.Allocator,
    state: State = State.Uninitialized,

    pub fn alloc(_: *anyopaque, items: uInt, len: uInt) callconv(.C) *anyopaque {
        return mimalloc.mi_malloc(items * len) orelse unreachable;
    }

    pub fn free(_: *anyopaque, data: *anyopaque) callconv(.C) void {
        mimalloc.mi_free(data);
    }

    pub fn deinit(this: *ZlibCompressor) void {
        var allocator = this.allocator;
        this.end();
        allocator.destroy(this);
    }

    pub fn end(this: *ZlibCompressor) void {
        if (this.state != State.End) {
            _ = deflateEnd(&this.zlib);
            this.state = State.End;
        }
    }

    pub fn init(input: []const u8, list: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, options: Options) ZlibError!*ZlibCompressor {
        return initWithListAllocator(input, list, allocator, allocator, options);
    }

    pub fn initWithListAllocator(input: []const u8, list: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, list_allocator: std.mem.Allocator, options: Options) ZlibError!*ZlibCompressor {
        var zlib_reader = try allocator.create(ZlibCompressor);
        zlib_reader.* = ZlibCompressor{
            .input = input,
            .list = list.*,
            .list_ptr = list,
            .list_allocator = list_allocator,
            .allocator = allocator,
            .zlib = undefined,
        };

        zlib_reader.zlib = zStream_struct{
            .next_in = input.ptr,
            .avail_in = @as(uInt, @intCast(input.len)),
            .total_in = @as(uInt, @intCast(input.len)),

            .next_out = zlib_reader.list.items.ptr,
            .avail_out = @as(u32, @intCast(zlib_reader.list.items.len)),
            .total_out = zlib_reader.list.items.len,

            .err_msg = null,
            .alloc_func = ZlibCompressor.alloc,
            .free_func = ZlibCompressor.free,

            .internal_state = null,
            .user_data = zlib_reader,

            .data_type = DataType.Unknown,
            .adler = 0,
            .reserved = 0,
        };

        switch (deflateInit2_(
            &zlib_reader.zlib,
            options.level,
            options.method,
            if (!options.gzip) -options.windowBits else options.windowBits + 16,
            options.memLevel,
            options.strategy,
            zlibVersion(),
            @sizeOf(zStream_struct),
        )) {
            ReturnCode.Ok => {
                try zlib_reader.list.ensureTotalCapacityPrecise(list_allocator, deflateBound(&zlib_reader.zlib, input.len));
                zlib_reader.list_ptr.* = zlib_reader.list;
                zlib_reader.zlib.avail_out = @as(uInt, @truncate(zlib_reader.list.capacity));
                zlib_reader.zlib.next_out = zlib_reader.list.items.ptr;

                return zlib_reader;
            },
            ReturnCode.MemError => {
                zlib_reader.deinit();
                return error.OutOfMemory;
            },
            ReturnCode.StreamError => {
                zlib_reader.deinit();
                return error.InvalidArgument;
            },
            ReturnCode.VersionError => {
                zlib_reader.deinit();
                return error.InvalidArgument;
            },
            else => unreachable,
        }
    }

    pub fn errorMessage(this: *ZlibCompressor) ?[]const u8 {
        if (this.zlib.err_msg) |msg_ptr| {
            return std.mem.sliceTo(msg_ptr, 0);
        }

        return null;
    }

    pub fn readAll(this: *ZlibCompressor) ZlibError!void {
        defer {
            this.list.shrinkRetainingCapacity(this.zlib.total_out);
            this.list_ptr.* = this.list;
        }

        while (this.state == State.Uninitialized or this.state == State.Inflating) {

            // Before the call of inflate(), the application should ensure
            // that at least one of the actions is possible, by providing
            // more input and/or consuming more output, and updating the
            // next_* and avail_* values accordingly. If the caller of
            // inflate() does not provide both available input and available
            // output space, it is possible that there will be no progress
            // made. The application can consume the uncompressed output
            // when it wants, for example when the output buffer is full
            // (avail_out == 0), or after each call of inflate(). If inflate
            // returns Z_OK and with zero avail_out, it must be called again
            // after making room in the output buffer because there might be
            // more output pending.

            // - Decompress more input starting at next_in and update
            //   next_in and avail_in accordingly. If not all input can be
            //   processed (because there is not enough room in the output
            //   buffer), then next_in and avail_in are updated accordingly,
            //   and processing will resume at this point for the next call
            //   of inflate().

            // - Generate more output starting at next_out and update
            //   next_out and avail_out accordingly. inflate() provides as
            //   much output as possible, until there is no more input data
            //   or no more space in the output buffer (see below about the
            //   flush parameter).

            if (this.zlib.avail_out == 0) {
                const initial = this.list.items.len;
                try this.list.ensureUnusedCapacity(this.list_allocator, 4096);
                this.list.expandToCapacity();
                this.zlib.next_out = &this.list.items[initial];
                this.zlib.avail_out = @as(u32, @intCast(this.list.items.len - initial));
            }

            if (this.zlib.avail_out == 0) {
                return error.ShortRead;
            }

            const rc = deflate(&this.zlib, FlushValue.Finish);
            this.state = State.Inflating;

            switch (rc) {
                ReturnCode.StreamEnd => {
                    this.list.items.len = this.zlib.total_out;
                    this.end();

                    return;
                },
                ReturnCode.MemError => {
                    this.end();
                    this.state = State.Error;
                    return error.OutOfMemory;
                },
                ReturnCode.StreamError,
                ReturnCode.DataError,
                ReturnCode.BufError,
                ReturnCode.NeedDict,
                ReturnCode.VersionError,
                ReturnCode.ErrNo,
                => {
                    this.end();
                    this.state = State.Error;
                    return error.ZlibError;
                },
                ReturnCode.Ok => {},
            }
        }
    }
};
