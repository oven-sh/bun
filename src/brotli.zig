const bun = @import("bun");
const std = @import("std");
pub const c = @import("./deps/brotli_c.zig");
const BrotliDecoder = c.BrotliDecoder;
const BrotliEncoder = c.BrotliEncoder;

const mimalloc = bun.Mimalloc;

pub const BrotliAllocator = struct {
    pub fn alloc(_: ?*anyopaque, len: usize) callconv(.C) *anyopaque {
        if (bun.heap_breakdown.enabled) {
            const zone = bun.heap_breakdown.getZone("brotli");
            return zone.malloc_zone_malloc(len) orelse bun.outOfMemory();
        }

        return mimalloc.mi_malloc(len) orelse bun.outOfMemory();
    }

    pub fn free(_: ?*anyopaque, data: ?*anyopaque) callconv(.C) void {
        if (bun.heap_breakdown.enabled) {
            const zone = bun.heap_breakdown.getZone("brotli");
            zone.malloc_zone_free(data);
            return;
        }

        mimalloc.mi_free(data);
    }
};

pub const DecoderOptions = struct {
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
    flushOp: BrotliEncoder.Operation,
    finishFlushOp: BrotliEncoder.Operation,
    fullFlushOp: BrotliEncoder.Operation,

    pub const new = bun.TrivialNew(BrotliReaderArrayList);

    pub fn newWithOptions(input: []const u8, list: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, options: DecoderOptions) !*BrotliReaderArrayList {
        return BrotliReaderArrayList.new(try initWithOptions(input, list, allocator, options, .process, .finish, .flush));
    }

    pub fn initWithOptions(
        input: []const u8,
        list: *std.ArrayListUnmanaged(u8),
        allocator: std.mem.Allocator,
        options: DecoderOptions,
        flushOp: BrotliEncoder.Operation,
        finishFlushOp: BrotliEncoder.Operation,
        fullFlushOp: BrotliEncoder.Operation,
    ) !BrotliReaderArrayList {
        if (!BrotliDecoder.initializeBrotli()) {
            return error.BrotliFailedToLoad;
        }

        var brotli = BrotliDecoder.createInstance(&BrotliAllocator.alloc, &BrotliAllocator.free, null) orelse return error.BrotliFailedToCreateInstance;
        if (options.params.LARGE_WINDOW)
            _ = brotli.setParameter(c.BrotliDecoderParameter.LARGE_WINDOW, 1);
        if (options.params.DISABLE_RING_BUFFER_REALLOCATION)
            _ = brotli.setParameter(c.BrotliDecoderParameter.DISABLE_RING_BUFFER_REALLOCATION, 1);

        bun.assert(list.items.ptr != input.ptr);

        return .{
            .input = input,
            .list_ptr = list,
            .list = list.*,
            .list_allocator = allocator,
            .brotli = brotli,
            .flushOp = flushOp,
            .finishFlushOp = finishFlushOp,
            .fullFlushOp = fullFlushOp,
        };
    }

    pub fn end(this: *BrotliReaderArrayList) void {
        this.state = .End;
    }

    pub fn readAll(this: *BrotliReaderArrayList, is_done: bool) !void {
        defer this.list_ptr.* = this.list;

        if (this.state == .End or this.state == .Error) {
            return;
        }

        bun.assert(this.list.items.ptr != this.input.ptr);

        while (this.state == State.Uninitialized or this.state == State.Inflating) {
            var unused_capacity = this.list.unusedCapacitySlice();

            if (unused_capacity.len < 4096) {
                try this.list.ensureUnusedCapacity(this.list_allocator, 4096);
                unused_capacity = this.list.unusedCapacitySlice();
            }

            bun.assert(unused_capacity.len > 0);

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
                        bun.assert(this.brotli.isFinished());
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
                    if (in_remaining > 0) {
                        @panic("Brotli wants more data");
                    }
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
        bun.destroy(this);
    }
};

pub const BrotliCompressionStream = struct {
    pub const State = enum {
        Inflating,
        End,
        Error,
    };

    brotli: *BrotliEncoder,
    state: State = State.Inflating,
    total_out: usize = 0,
    total_in: usize = 0,
    flushOp: BrotliEncoder.Operation,
    finishFlushOp: BrotliEncoder.Operation,
    fullFlushOp: BrotliEncoder.Operation,

    pub fn init(
        flushOp: BrotliEncoder.Operation,
        finishFlushOp: BrotliEncoder.Operation,
        fullFlushOp: BrotliEncoder.Operation,
    ) !BrotliCompressionStream {
        const instance = BrotliEncoder.createInstance(&BrotliAllocator.alloc, &BrotliAllocator.free, null) orelse return error.BrotliFailedToCreateInstance;

        return BrotliCompressionStream{
            .brotli = instance,
            .flushOp = flushOp,
            .finishFlushOp = finishFlushOp,
            .fullFlushOp = fullFlushOp,
        };
    }

    pub fn writeChunk(this: *BrotliCompressionStream, input: []const u8, last: bool) ![]const u8 {
        this.total_in += input.len;
        const result = this.brotli.compressStream(if (last) this.finishFlushOp else this.flushOp, input);

        if (!result.success) {
            this.state = .Error;
            return error.BrotliCompressionError;
        }

        return result.output;
    }

    pub fn write(this: *BrotliCompressionStream, input: []const u8, last: bool) ![]const u8 {
        if (this.state == .End or this.state == .Error) {
            return "";
        }

        return this.writeChunk(input, last);
    }

    pub fn end(this: *BrotliCompressionStream) ![]const u8 {
        defer this.state = .End;

        return try this.write("", true);
    }

    pub fn deinit(this: *BrotliCompressionStream) void {
        this.brotli.destroyInstance();
    }

    fn NewWriter(comptime InputWriter: type) type {
        return struct {
            compressor: *BrotliCompressionStream,
            input_writer: InputWriter,

            const Self = @This();
            pub const WriteError = error{BrotliCompressionError} || InputWriter.Error;
            pub const Writer = std.io.Writer(@This(), WriteError, Self.write);

            pub fn init(compressor: *BrotliCompressionStream, input_writer: InputWriter) Self {
                return Self{
                    .compressor = compressor,
                    .input_writer = input_writer,
                };
            }

            pub fn write(self: Self, to_compress: []const u8) WriteError!usize {
                const decompressed = try self.compressor.write(to_compress, false);
                try self.input_writer.writeAll(decompressed);
                return to_compress.len;
            }

            pub fn end(self: Self) !usize {
                const decompressed = try self.compressor.end();
                try self.input_writer.writeAll(decompressed);
            }

            pub fn writer(self: Self) Writer {
                return Writer{ .context = self };
            }
        };
    }

    pub fn writerContext(this: *BrotliCompressionStream, writable: anytype) NewWriter(@TypeOf(writable)) {
        return NewWriter(@TypeOf(writable)).init(this, writable);
    }

    pub fn writer(this: *BrotliCompressionStream, writable: anytype) NewWriter(@TypeOf(writable)).Writer {
        return this.writerContext(writable).writer();
    }
};
