/// Demo app testing the macOS libcompression bindings.
const std = @import("std");
const CompressionFramework = struct {
    var handle: ?*anyopaque = null;
    pub fn load() !void {
        handle = std.posix.darwin.dlopen("libcompression.dylib", 1);

        if (handle == null)
            return error.@"failed to load Compression.framework";

        compression_encode_scratch_buffer_size = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_encode_scratch_buffer_size").?));
        compression_encode_buffer = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_encode_buffer").?));
        compression_decode_scratch_buffer_size = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_decode_scratch_buffer_size").?));
        compression_decode_buffer = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_decode_buffer").?));
        compression_stream_init = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_stream_init").?));
        compression_stream_process = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_stream_process").?));
        compression_stream_destroy = @alignCast(@ptrCast(std.c.dlsym(handle, "compression_stream_destroy").?));
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

        pub fn process(stream: *compression_stream, data: []const u8, is_done: bool, comptime Iterator: type, iter: *Iterator) !StreamResult {
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
};

pub fn main() anyerror!void {
    try CompressionFramework.load();

    var args = std.process.args();
    const argv0 = args.next() orelse "";

    const first = args.next() orelse "";
    const second = args.next() orelse "";
    var algorithm: ?CompressionFramework.compression_algorithm = null;
    var operation: ?CompressionFramework.compression_stream_operation = null;

    if (CompressionFramework.compression_algorithm.fromName(first)) |a| {
        algorithm = a;
        operation = .DECODE;
    } else if (CompressionFramework.compression_algorithm.fromName(second)) |o| {
        algorithm = o;
        operation = .ENCODE;
    }

    if (algorithm == null or operation == null) {
        try std.io.getStdErr().writer().print("to compress: {s} ./file ./out.{{br,gz,lz4,lzfse}}\nto decompress: {s} ./out.{{br,gz,lz4,lzfse}} ./out\n", .{ argv0, argv0 });
        std.posix.exit(1);
    }

    var output_file: std.fs.File = undefined;
    var input_file: std.fs.File = undefined;

    if (second.len == 0) {
        output_file = std.io.getStdOut();
    } else {
        output_file = try std.fs.cwd().createFile(second, .{
            .truncate = true,
        });
    }

    if (first.len == 0) {
        input_file = std.io.getStdIn();
    } else {
        input_file = try std.fs.cwd().openFile(first, .{});
    }

    var writer = std.io.BufferedWriter(64 * 1024, @TypeOf(output_file.writer())){
        .unbuffered_writer = output_file.writer(),
    };

    const input_bytes = try input_file.readToEndAlloc(std.heap.c_allocator, std.math.maxInt(usize));

    if (operation == .ENCODE) {
        switch (try CompressionFramework.compress(input_bytes, algorithm.?, true, writer.writer())) {
            .err => |err| {
                return err.err;
            },
            else => {},
        }
    } else {
        switch (try CompressionFramework.decompress(input_bytes, algorithm.?, true, writer.writer())) {
            .err => |err| {
                return err.err;
            },
            else => {},
        }
    }

    try writer.flush();
}
