const bun = @import("root").bun;
const std = @import("std");
const c = @import("./deps/brotli_decoder.zig");
const BrotliDecoder = c.BrotliDecoder;

const mimalloc = bun.Mimalloc;

pub fn hasBrotli() bool {
    return BrotliDecoder.initializeBrotli();
}

const BrotliAllocator = struct {
    pub fn alloc(_: ?*anyopaque, len: usize) callconv(.C) *anyopaque {
        if (comptime bun.is_heap_breakdown_enabled) {
            const zone = bun.HeapBreakdown.malloc_zone_t.get(BrotliAllocator);
            return zone.malloc_zone_malloc(len).?;
        }

        return mimalloc.mi_malloc(len) orelse unreachable;
    }

    pub fn free(_: ?*anyopaque, data: *anyopaque) callconv(.C) void {
        if (comptime bun.is_heap_breakdown_enabled) {
            const zone = bun.HeapBreakdown.malloc_zone_t.get(BrotliAllocator);
            zone.malloc_zone_free(data);
            return;
        }

        mimalloc.mi_free(data);
    }
};

pub const Options = struct {
    pub const Params = std.enums.EnumFieldStruct(c.BrotliDecoderParameter, bool, false);

    params: Params = Params{
        .LARGE_WINDOW = true,
        .DISABLE_RING_BUFFER_REALLOCATION = false,
    },
};

pub const BrotliReaderArrayList = struct {
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
    brotli: *BrotliDecoder,
    state: State = State.Uninitialized,
    total_out: usize = 0,
    total_in: usize = 0,

    pub usingnamespace bun.New(BrotliReaderArrayList);

    pub fn initWithOptions(input: []const u8, list: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, options: Options) !*BrotliReaderArrayList {
        if (!BrotliDecoder.initializeBrotli()) {
            return error.BrotliFailedToLoad;
        }

        var brotli = BrotliDecoder.createInstance(&BrotliAllocator.alloc, &BrotliAllocator.free, null) orelse return error.BrotliFailedToCreateInstance;
        if (options.params.LARGE_WINDOW)
            _ = brotli.setParameter(c.BrotliDecoderParameter.LARGE_WINDOW, 1);
        if (options.params.DISABLE_RING_BUFFER_REALLOCATION)
            _ = brotli.setParameter(c.BrotliDecoderParameter.DISABLE_RING_BUFFER_REALLOCATION, 1);

        std.debug.assert(list.items.ptr != input.ptr);

        return BrotliReaderArrayList.new(
            .{
                .input = input,
                .list_ptr = list,
                .list = list.*,
                .list_allocator = allocator,
                .brotli = brotli,
            },
        );
    }

    pub fn end(this: *BrotliReaderArrayList) void {
        this.state = .End;
    }

    pub fn readAll(this: *BrotliReaderArrayList, is_done: bool) !void {
        defer {
            this.list_ptr.* = this.list;
        }

        if (this.state == .End or this.state == .Error) {
            return;
        }

        std.debug.assert(this.list.items.ptr != this.input.ptr);

        while (this.state == State.Uninitialized or this.state == State.Inflating) {
            var unused_capacity = this.list.unusedCapacitySlice();

            if (unused_capacity.len < 4096) {
                try this.list.ensureUnusedCapacity(this.list_allocator, 4096);
                unused_capacity = this.list.unusedCapacitySlice();
            }

            std.debug.assert(unused_capacity.len > 0);

            var next_in = this.input[this.total_in..];

            var in_remaining = next_in.len;
            var out_remaining = unused_capacity.len;

            // https://github.com/google/brotli/blob/fef82ea10435abb1500b615b1b2c6175d429ec6c/go/cbrotli/reader.go#L15-L27
            const result = this.brotli.decompressStream(
                &in_remaining,
                @ptrCast(&next_in),
                &out_remaining,
                @ptrCast(&unused_capacity.ptr),
                null,
            );

            const bytes_written = unused_capacity.len -| out_remaining;
            const bytes_read = next_in.len -| in_remaining;

            this.list.items.len += bytes_written;
            this.total_in += bytes_read;

            switch (result) {
                .success => {
                    if (comptime bun.Environment.allow_assert) {
                        std.debug.assert(this.brotli.isFinished());
                    }

                    this.end();
                    return;
                },
                .err => {
                    this.state = .Error;
                    if (comptime bun.Environment.allow_assert) {
                        const code = this.brotli.getErrorCode();
                        bun.Output.debugWarn("Brotli error: {s} ({d})", .{ @tagName(code), @intFromEnum(code) });
                    }

                    return error.BrotliDecompressionError;
                },

                .needs_more_input => {
                    this.state = .Inflating;
                    if (is_done) {
                        this.state = .Error;
                    }

                    return error.ShortRead;
                },
                .needs_more_output => {
                    try this.list.ensureTotalCapacity(this.list_allocator, this.list.capacity + 4096);
                    this.state = .Inflating;
                },
            }
        }
    }

    pub fn deinit(this: *BrotliReaderArrayList) void {
        this.brotli.destroyInstance();
        this.destroy();
    }
};
