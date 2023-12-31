const std = @import("std");
const bun = @import("root").bun;

fn macOSOnly() noreturn {
    @panic("CompressionFramework is only available on macOS. This code should not be reachable.");
}

/// https://developer.apple.com/documentation/compression?language=objc
/// We only use this for Brotli on macOS, to avoid linking in libbrotli.
///
/// Note: this doesn't seem to work for gzip.
pub const CompressionFramework = struct {
    var handle: ?*anyopaque = null;

    pub fn isAvailable() bool {
        if (comptime !bun.Environment.isMac) {
            return false;
        }
        const cached_value = struct {
            pub var value: ?bool = null;
        };

        if (cached_value.value == null) {
            if (bun.getenvZ("BUN_DISABLE_COMPRESSION_FRAMEWORK") != null) {
                cached_value.value = false;
                return false;
            }

            cached_value.value = CompressionFramework.load();
        }

        return cached_value.value.?;
    }

    pub fn load() bool {
        if (comptime !bun.Environment.isMac) {
            return false;
        }
        if (handle != null) {
            return true;
        }
        handle = std.os.darwin.dlopen("libcompression.dylib", 1);

        if (handle == null)
            return false;

        compression_encode_scratch_buffer_size = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_encode_scratch_buffer_size") orelse return false));
        compression_encode_buffer = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_encode_buffer") orelse return false));
        compression_decode_scratch_buffer_size = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_decode_scratch_buffer_size") orelse return false));
        compression_decode_buffer = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_decode_buffer") orelse return false));
        compression_stream_init = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_stream_init") orelse return false));
        compression_stream_process = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_stream_process") orelse return false));
        compression_stream_destroy = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_stream_destroy") orelse return false));

        return true;
    }

    pub const compression_algorithm = enum(c_uint) {
        LZ4 = 256,
        ZLIB = 0x205,
        LZMA = 774,
        LZ4_RAW = 257,
        BROTLI = 2818,
        LZFSE = 2049,
        LZBITMAP = 1794,

        pub fn fromName(name: []const u8) ?compression_algorithm {
            if (std.mem.endsWith(u8, name, ".br")) {
                return .BROTLI;
            } else if (std.mem.endsWith(u8, name, ".lz4")) {
                return .LZ4;
            } else if (std.mem.endsWith(u8, name, ".lzma")) {
                return .LZMA;
            } else if (std.mem.endsWith(u8, name, ".lzfse")) {
                return .LZFSE;
            } else if (std.mem.endsWith(u8, name, ".zlib") or std.mem.endsWith(u8, name, ".gz")) {
                return .ZLIB;
            } else {
                return null;
            }
        }
    };
    const compression_encode_scratch_buffer_size_type = fn (algorithm: compression_algorithm) callconv(.C) usize;
    const compression_encode_buffer_type = fn (noalias dst_buffer: [*]u8, dst_size: usize, noalias src_buffer: ?[*]const u8, src_size: usize, noalias scratch_buffer: ?*anyopaque, algorithm: compression_algorithm) callconv(.C) usize;
    const compression_decode_scratch_buffer_size_type = fn (algorithm: compression_algorithm) callconv(.C) usize;
    const compression_decode_buffer_type = fn (noalias dst_buffer: [*]u8, dst_size: usize, noalias src_buffer: ?[*]const u8, src_size: usize, noalias scratch_buffer: ?*anyopaque, algorithm: compression_algorithm) callconv(.C) usize;

    const compression_stream_init_type = fn (stream: *compression_stream, operation: compression_stream_operation, algorithm: compression_algorithm) callconv(.C) compression_status;
    const compression_stream_process_type = fn (stream: *compression_stream, flags: c_int) callconv(.C) compression_status;
    const compression_stream_destroy_type = fn (stream: *compression_stream) callconv(.C) compression_status;

    var compression_encode_scratch_buffer_size: *const compression_encode_scratch_buffer_size_type = undefined;
    var compression_encode_buffer: *const compression_encode_buffer_type = undefined;
    var compression_decode_scratch_buffer_size: *const compression_decode_scratch_buffer_size_type = undefined;
    var compression_decode_buffer: *const compression_decode_buffer_type = undefined;

    var compression_stream_init: *const compression_stream_init_type = undefined;
    var compression_stream_process: *const compression_stream_process_type = undefined;
    var compression_stream_destroy: *const compression_stream_destroy_type = undefined;
    pub const compression_stream = extern struct {
        dst_ptr: ?[*]u8 = null,
        dst_size: usize = 0,
        src_ptr: ?[*]const u8 = null,
        src_size: usize = 0,
        state: ?*anyopaque = null,

        pub fn init(src: []const u8, operation: compression_stream_operation, algorithm: compression_algorithm) !compression_stream {
            var stream = compression_stream{
                .src_ptr = src.ptr,
                .src_size = src.len,
                .dst_ptr = null,
                .dst_size = 0,
            };

            switch (compression_stream_init(&stream, operation, algorithm)) {
                .OK => {},
                .ERROR => return error.@"failed to initialize compression stream",
                .END => return error.@"compression stream init returned END",
            }

            return stream;
        }

        pub fn deinit(this: *compression_stream) void {
            if (comptime !bun.Environment.isMac) {
                macOSOnly();
            }

            _ = compression_stream_destroy(this);
        }

        pub fn process(stream: *compression_stream, data: []const u8, is_done: bool, comptime Iterator: type, iter: *Iterator) !StreamResult {
            if (comptime !bun.Environment.isMac) {
                macOSOnly();
            }
            stream.src_ptr = data.ptr;
            stream.src_size = data.len;

            const initial_dest = try iter.wrote(0);
            stream.dst_ptr = initial_dest.ptr;
            stream.dst_size = initial_dest.len;

            var total_written: usize = 0;
            while (true) {
                var flags: c_int = 0;
                if (stream.src_size == 0 and is_done) {
                    flags = COMPRESSION_STREAM_FINALIZE;
                } else if (stream.src_size == 0) {
                    return .{
                        .progress = .{
                            .read = data.len - stream.src_size,
                            .wrote = total_written,
                        },
                    };
                }

                const prev_size = stream.dst_size;
                const rc = compression_stream_process(stream, flags);
                const wrote = prev_size - stream.dst_size;
                switch (rc) {
                    .OK => {
                        const new_buffer = try iter.wrote(wrote);
                        stream.dst_ptr = new_buffer.ptr;
                        stream.dst_size = new_buffer.len;
                        total_written += wrote;
                    },
                    .END => {
                        _ = try iter.wrote(wrote);
                        total_written += wrote;

                        return .{
                            .done = .{
                                .read = data.len - stream.src_size,
                                .wrote = total_written,
                            },
                        };
                    },
                    .ERROR => {
                        return .{
                            .err = .{
                                .err = error.@"failed to process compression stream",
                                .read = data.len - stream.src_size,
                                .wrote = total_written,
                            },
                        };
                    },
                }
            }
        }
    };
    pub const COMPRESSION_STREAM_ENCODE: c_int = 0;
    pub const COMPRESSION_STREAM_DECODE: c_int = 1;
    pub const compression_stream_operation = enum(c_uint) {
        ENCODE = 0,
        DECODE = 1,
    };
    pub const COMPRESSION_STREAM_FINALIZE: c_int = 1;
    pub const compression_stream_flags = c_uint;
    pub const compression_status = enum(c_int) {
        OK = 0,
        ERROR = -1,
        END = 1,
    };

    const StreamResult = union(enum) {
        done: struct {
            read: usize = 0,
            wrote: usize = 0,
        },
        err: struct {
            read: usize = 0,
            wrote: usize = 0,
            err: anyerror,
        },
        progress: struct {
            read: usize = 0,
            wrote: usize = 0,
        },
    };

    pub fn compress(data: []const u8, algorithm: compression_algorithm, is_done: bool, writer: anytype) !StreamResult {
        if (comptime !bun.Environment.isMac) {
            macOSOnly();
        }

        var scratch_buffer: [64 * 1024]u8 = undefined;

        const scratch_buffer_size = compression_encode_scratch_buffer_size(algorithm);
        if (scratch_buffer_size >= scratch_buffer.len) {
            std.debug.panic("scratch buffer size is too small {d}", .{scratch_buffer_size});
        }

        var stream = try compression_stream.init(data, .ENCODE, algorithm);

        defer _ = compression_stream_destroy(&stream);
        const Iterator = struct {
            writer: @TypeOf(writer),
            scratch_buffer: []u8,
            pub fn wrote(this: *@This(), w: usize) ![]u8 {
                try this.writer.writeAll(this.scratch_buffer[0..w]);
                return this.scratch_buffer;
            }
        };

        var iter = Iterator{
            .writer = writer,
            .scratch_buffer = &scratch_buffer,
        };

        return try stream.process(data, is_done, Iterator, &iter);
    }

    pub fn decompress(data: []const u8, algorithm: compression_algorithm, is_done: bool, writer: anytype) !StreamResult {
        if (comptime !bun.Environment.isMac) {
            macOSOnly();
        }

        var scratch_buffer: [64 * 1024]u8 = undefined;

        const scratch_buffer_size = compression_decode_scratch_buffer_size(algorithm);
        if (scratch_buffer_size >= scratch_buffer.len) {
            std.debug.panic("scratch buffer size is too small {d}", .{scratch_buffer_size});
        }

        var stream = try compression_stream.init(data, .DECODE, algorithm);
        defer _ = compression_stream_destroy(&stream);

        const Iterator = struct {
            writer: @TypeOf(writer),
            scratch_buffer: []u8,
            pub fn wrote(this: *@This(), w: usize) ![]u8 {
                try this.writer.writeAll(this.scratch_buffer[0..w]);
                return this.scratch_buffer;
            }
        };

        var iter = Iterator{
            .writer = writer,
            .scratch_buffer = &scratch_buffer,
        };

        return try stream.process(data, is_done, Iterator, &iter);
    }

    pub const DecompressionArrayList = struct {
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
        stream: CompressionFramework.compression_stream,
        state: State = State.Uninitialized,
        total_out: usize = 0,
        total_in: usize = 0,
        total_read: usize = 0,

        pub usingnamespace bun.New(DecompressionArrayList);

        pub fn initWithOptions(input: []const u8, list: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, algorithm: CompressionFramework.compression_algorithm) !*DecompressionArrayList {
            if (comptime !bun.Environment.isMac) {
                macOSOnly();
            }

            if (!CompressionFramework.load()) {
                return error.CompressionFrameworkFailedToLoad;
            }

            const stream = try CompressionFramework.compression_stream.init(input, .DECODE, algorithm);
            std.debug.assert(list.items.ptr != input.ptr);

            return DecompressionArrayList.new(
                .{
                    .input = input,
                    .list_ptr = list,
                    .list = list.*,
                    .list_allocator = allocator,
                    .stream = stream,
                },
            );
        }

        pub fn deinit(this: *DecompressionArrayList) void {
            this.stream.deinit();
            this.destroy();
        }

        pub fn readAll(this: *DecompressionArrayList, is_done: bool) !void {
            if (this.state == State.End or this.state == State.Error or this.input.len == 0) {
                return;
            }
            defer this.list_ptr.* = this.list;

            var scratch_buffer = this.list.unusedCapacitySlice();

            if (scratch_buffer.len < 4096) {
                try this.list.ensureUnusedCapacity(this.list_allocator, 4096);
                scratch_buffer = this.list.unusedCapacitySlice();
            }

            const Iterator = struct {
                list: *std.ArrayListUnmanaged(u8),
                scratch_buffer: []u8,
                list_allocator: std.mem.Allocator,
                pub fn wrote(i: *@This(), w: usize) ![]u8 {
                    i.list.items.len += w;
                    i.scratch_buffer = i.list.unusedCapacitySlice();

                    if (i.scratch_buffer.len < 4096) {
                        try i.list.ensureUnusedCapacity(i.list_allocator, 4096);
                    }

                    i.scratch_buffer = i.list.unusedCapacitySlice();

                    return i.scratch_buffer;
                }
            };

            var iter = Iterator{
                .list = &this.list,
                .list_allocator = this.list_allocator,
                .scratch_buffer = scratch_buffer,
            };

            const result = try CompressionFramework.compression_stream.process(&this.stream, this.input, is_done, Iterator, &iter);
            switch (result) {
                .done => |done| {
                    this.total_out += done.wrote;
                    this.total_in += done.read;

                    this.state = State.End;
                    return;
                },
                .err => |*err| {
                    this.state = State.Error;
                    this.total_out += err.wrote;
                    this.total_in += err.read;

                    return err.err;
                },
                .progress => |*progress| {
                    this.total_out += progress.wrote;
                    this.total_in += progress.read;
                    this.total_read += progress.read;

                    if (progress.read < this.input.len) {
                        return error.ShortRead;
                    }

                    return;
                },
            }
        }
    };
};
