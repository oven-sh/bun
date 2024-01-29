const std = @import("std");
const bun = @import("root").bun;

const mimalloc = @import("./allocators/mimalloc.zig");

const c = bun.zstd;

test "ZstdArrayList Read" {
    const expected_text = @embedFile("./zlib.test.txt");
    const input = bun.asByteSlice(@embedFile("./zlib.test.zst"));
    var list = std.ArrayListUnmanaged(u8){};
    try list.ensureUnusedCapacity(std.heap.c_allocator, 4096);
    var reader = try ZstdReaderArrayList.init(input, &list, std.heap.c_allocator);
    defer reader.deinit();
    try reader.readAll();

    try std.testing.expectEqualStrings(expected_text, list.items);
}

pub const Options = struct {
    window_log_max: ?i32 = null,
    compression_level: i32 = 3,
};

pub const ZstdReaderArrayList = struct {
    pub const State = enum {
        Uninitialized,
        Decompressing,
        End,
        Error,
    };

    input: []const u8,
    list: std.ArrayListUnmanaged(u8),
    list_allocator: std.mem.Allocator,
    list_ptr: *std.ArrayListUnmanaged(u8),
    zstd: ?*c.ZSTD_DStream,
    state: State = State.Uninitialized,
    total_out: usize = 0,
    total_in: usize = 0,

    pub usingnamespace bun.New(ZstdReaderArrayList);

    pub fn initWithOptions(input: []const u8, list: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, options: Options) !*ZstdReaderArrayList {
        const dstream = c.ZSTD_createDStream();
        _ = c.ZSTD_initDStream(dstream);

        if (options.window_log_max) |window_log_max| {
            _ = c.ZSTD_DCtx_setParameter(dstream, c.ZSTD_d_windowLogMax, window_log_max);
        }

        std.debug.assert(list.items.ptr != input.ptr);

        return ZstdReaderArrayList.new(
            .{
                .input = input,
                .list_ptr = list,
                .list = list.*,
                .list_allocator = allocator,
                .zstd = dstream,
            },
        );
    }

    pub fn end(this: *ZstdReaderArrayList) void {
        this.state = .End;
    }

    pub fn readAll(this: *ZstdReaderArrayList, is_done: bool) !void {
        defer {
            this.list_ptr.* = this.list;
        }

        if (this.state == .End or this.state == .Error) {
            return;
        }

        std.debug.assert(this.list.items.ptr != this.input.ptr);

        while (this.state == State.Uninitialized or this.state == State.Decompressing) {
            var unused_capacity = this.list.unusedCapacitySlice();

            if (unused_capacity.len < 4096) {
                try this.list.ensureUnusedCapacity(this.list_allocator, 4096);
                unused_capacity = this.list.unusedCapacitySlice();
            }

            std.debug.assert(unused_capacity.len > 0);

            const next_in = this.input[this.total_in..];

            var in_buffer: c.ZSTD_inBuffer = .{
                .src = next_in.ptr,
                .size = next_in.len,
                .pos = this.total_in,
            };

            var out_buffer: c.ZSTD_outBuffer = .{
                .dst = unused_capacity.ptr,
                .size = unused_capacity.len,
                .pos = this.total_out,
            };

            // https://github.com/google/brotli/blob/fef82ea10435abb1500b615b1b2c6175d429ec6c/go/cbrotli/reader.go#L15-L27
            const result = c.ZSTD_decompressStream(
                this.zstd,
                &out_buffer,
                &in_buffer,
            );

            const bytes_written = unused_capacity.len -| unused_capacity.len;
            const bytes_read = next_in.len -| next_in.len;

            this.list.items.len += bytes_written;
            this.total_in += bytes_read;

            if (c.ZSTD_isError(result) == 1) {
                this.state = .Error;
                if (comptime bun.Environment.allow_assert) {
                    const code = c.ZSTD_getErrorName(result);
                    bun.Output.debugWarn("Zstd error: {s} ({d})", .{ code, result });
                }

                return error.ZstdDecompressionError;
            } else {
                if (is_done) {
                    this.end();

                    return;
                }
            }
        }
    }

    pub fn deinit(this: *ZstdReaderArrayList) void {
        _ = c.ZSTD_freeDStream(this.zstd);
        this.destroy();
    }
};

pub const ZstdCompressorArrayList = struct {
    pub const State = enum {
        Uninitialized,
        Compressing,
        End,
        Error,
    };

    input: []const u8,
    list: std.ArrayListUnmanaged(u8),
    list_allocator: std.mem.Allocator,
    list_ptr: *std.ArrayListUnmanaged(u8),
    zstd: ?*c.ZSTD_CStream,
    state: State = State.Uninitialized,
    total_out: usize = 0,
    total_in: usize = 0,

    pub usingnamespace bun.New(ZstdCompressorArrayList);

    pub fn initWithOptions(input: []const u8, list: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, options: Options) !*ZstdCompressorArrayList {
        const cstream = c.ZSTD_createCStream();
        _ = c.ZSTD_initCStream(cstream, options.compression_level);

        if (options.window_log_max) |window_log_max| {
            _ = c.ZSTD_CCtx_setParameter(cstream, c.ZSTD_c_windowLog, window_log_max);
        }

        std.debug.assert(list.items.ptr != input.ptr);

        return ZstdCompressorArrayList.new(
            .{
                .input = input,
                .list_ptr = list,
                .list = list.*,
                .list_allocator = allocator,
                .zstd = cstream,
            },
        );
    }

    pub fn end(this: *ZstdCompressorArrayList) void {
        this.state = .End;
    }

    pub fn readAll(this: *ZstdCompressorArrayList, is_done: bool) !void {
        defer {
            this.list_ptr.* = this.list;
        }

        if (this.state == .End or this.state == .Error) {
            return;
        }

        std.debug.assert(this.list.items.ptr != this.input.ptr);

        while (this.state == State.Uninitialized or this.state == State.Compressing) {
            var unused_capacity = this.list.unusedCapacitySlice();

            if (unused_capacity.len < 4096) {
                try this.list.ensureUnusedCapacity(this.list_allocator, 4096);
                unused_capacity = this.list.unusedCapacitySlice();
            }

            std.debug.assert(unused_capacity.len > 0);

            const next_in = this.input[this.total_in..];

            var in_buffer: c.ZSTD_inBuffer = .{
                .src = next_in.ptr,
                .size = next_in.len,
                .pos = this.total_in,
            };

            var out_buffer: c.ZSTD_outBuffer = .{
                .dst = unused_capacity.ptr,
                .size = unused_capacity.len,
                .pos = this.total_out,
            };

            // https://github.com/google/brotli/blob/fef82ea10435abb1500b615b1b2c6175d429ec6c/go/cbrotli/reader.go#L15-L27
            const result = c.ZSTD_compressStream(
                this.zstd,
                &out_buffer,
                &in_buffer,
            );

            const bytes_written = unused_capacity.len -| unused_capacity.len;
            const bytes_read = next_in.len -| next_in.len;

            this.list.items.len += bytes_written;
            this.total_in += bytes_read;

            if (c.ZSTD_isError(result) == 1) {
                this.state = .Error;
                if (comptime bun.Environment.allow_assert) {
                    const code = c.ZSTD_getErrorName(result);
                    bun.Output.debugWarn("Zstd error: {s} ({d})", .{ code, result });
                }

                return error.ZstdDecompressionError;
            } else {
                if (is_done) {
                    this.end();
                    return;
                }
            }
        }
    }

    pub fn deinit(this: *ZstdCompressorArrayList) void {
        _ = c.ZSTD_freeCStream(this.zstd);
        this.destroy();
    }
};
