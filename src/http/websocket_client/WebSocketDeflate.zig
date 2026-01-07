/// Manages the DEFLATE compression and decompression streams for a WebSocket connection.
const PerMessageDeflate = @This();

pub const Params = extern struct {
    server_max_window_bits: u8 = 15,
    client_max_window_bits: u8 = 15,
    server_no_context_takeover: u8 = 0,
    client_no_context_takeover: u8 = 0,

    pub const MAX_WINDOW_BITS: u8 = 15;
    pub const MIN_WINDOW_BITS: u8 = 8;
};

pub const RareData = struct {
    libdeflate_compressor: ?*libdeflate.Compressor = null,
    libdeflate_decompressor: ?*libdeflate.Decompressor = null,
    stack_fallback: std.heap.StackFallbackAllocator(RareData.stack_buffer_size) = undefined,

    pub const stack_buffer_size = 128 * 1024;

    pub fn arrayList(this: *RareData) std.array_list.Managed(u8) {
        var list = std.array_list.Managed(u8).init(this.allocator());
        list.items = &this.stack_fallback.buffer;
        list.items.len = 0;
        list.capacity = this.stack_fallback.buffer.len;
        this.stack_fallback.fixed_buffer_allocator.end_index = this.stack_fallback.buffer.len;
        return list;
    }

    pub fn deinit(this: *RareData) void {
        inline for (.{ &this.libdeflate_compressor, &this.libdeflate_decompressor }) |comp| {
            if (comp.*) |c| {
                c.deinit();
            }
        }

        bun.destroy(this);
    }

    pub fn allocator(this: *RareData) std.mem.Allocator {
        this.stack_fallback = .{
            .buffer = undefined,
            .fallback_allocator = bun.default_allocator,
            .fixed_buffer_allocator = undefined,
        };
        return this.stack_fallback.get();
    }

    pub fn decompressor(this: *RareData) *libdeflate.Decompressor {
        return this.libdeflate_decompressor orelse brk: {
            this.libdeflate_decompressor = libdeflate.Decompressor.alloc();
            break :brk this.libdeflate_decompressor.?;
        };
    }

    pub fn compressor(this: *RareData) *libdeflate.Compressor {
        return this.libdeflate_compressor orelse brk: {
            this.libdeflate_compressor = libdeflate.Compressor.alloc();
            break :brk this.libdeflate_compressor.?;
        };
    }
};

allocator: std.mem.Allocator,
compress_stream: zlib.z_stream,
decompress_stream: zlib.z_stream,
params: Params,
rare_data: *RareData,

// Constants from zlib.h
const Z_DEFAULT_COMPRESSION = 6;
const Z_DEFLATED = 8;
const Z_DEFAULT_STRATEGY = 0;
const Z_DEFAULT_MEM_LEVEL = 8;

// Buffer size for compression/decompression operations
const COMPRESSION_BUFFER_SIZE = 4096;

// Maximum decompressed message size (128 MB)
const MAX_DECOMPRESSED_SIZE: usize = 128 * 1024 * 1024;

// DEFLATE trailer bytes added by Z_SYNC_FLUSH
const DEFLATE_TRAILER = [_]u8{ 0x00, 0x00, 0xff, 0xff };

pub fn init(allocator: std.mem.Allocator, params: Params, rare_data: *jsc.RareData) !*PerMessageDeflate {
    const self = try allocator.create(PerMessageDeflate);
    self.* = .{
        .allocator = allocator,
        .params = params,
        .compress_stream = std.mem.zeroes(zlib.z_stream),
        .decompress_stream = std.mem.zeroes(zlib.z_stream),
        .rare_data = rare_data.websocketDeflate(),
    };

    // Initialize compressor (deflate)
    // We use negative window bits for raw DEFLATE, as required by RFC 7692.
    const compress_err = zlib.deflateInit2_(
        &self.compress_stream,
        Z_DEFAULT_COMPRESSION, // level
        Z_DEFLATED, // method
        -@as(c_int, self.params.client_max_window_bits), // windowBits
        Z_DEFAULT_MEM_LEVEL, // memLevel
        Z_DEFAULT_STRATEGY, // strategy
        zlib.zlibVersion(),
        @sizeOf(zlib.z_stream),
    );
    if (compress_err != .Ok) {
        allocator.destroy(self);
        return error.DeflateInitFailed;
    }

    // Initialize decompressor (inflate)
    const decompress_err = zlib.inflateInit2_(
        &self.decompress_stream,
        -@as(c_int, self.params.server_max_window_bits), // windowBits
        zlib.zlibVersion(),
        @sizeOf(zlib.z_stream),
    );
    if (decompress_err != .Ok) {
        _ = zlib.deflateEnd(&self.compress_stream);
        allocator.destroy(self);
        return error.InflateInitFailed;
    }

    return self;
}

pub fn deinit(self: *PerMessageDeflate) void {
    _ = zlib.deflateEnd(&self.compress_stream);
    _ = zlib.inflateEnd(&self.decompress_stream);
    self.allocator.destroy(self);
}

fn canUseLibDeflate(len: usize) bool {
    if (bun.feature_flag.BUN_FEATURE_FLAG_NO_LIBDEFLATE.get()) {
        return false;
    }

    return len < RareData.stack_buffer_size;
}

pub fn decompress(self: *PerMessageDeflate, in_buf: []const u8, out: *std.array_list.Managed(u8)) error{ InflateFailed, OutOfMemory, TooLarge }!void {
    const initial_len = out.items.len;

    // First we try with libdeflate, which is both faster and doesn't need the trailing deflate bytes
    if (canUseLibDeflate(in_buf.len)) {
        const result = self.rare_data.decompressor().deflate(in_buf, out.unusedCapacitySlice());
        if (result.status == .success) {
            out.items.len += result.written;
            if (out.items.len - initial_len > MAX_DECOMPRESSED_SIZE) {
                return error.TooLarge;
            }
            return;
        }
    }

    var in_with_trailer = std.array_list.Managed(u8).init(self.allocator);
    defer in_with_trailer.deinit();
    try in_with_trailer.appendSlice(in_buf);
    try in_with_trailer.appendSlice(&DEFLATE_TRAILER);

    self.decompress_stream.next_in = in_with_trailer.items.ptr;
    self.decompress_stream.avail_in = @intCast(in_with_trailer.items.len);

    while (true) {
        try out.ensureUnusedCapacity(COMPRESSION_BUFFER_SIZE);
        self.decompress_stream.next_out = out.unusedCapacitySlice().ptr;
        self.decompress_stream.avail_out = @intCast(out.unusedCapacitySlice().len);

        const res = zlib.inflate(&self.decompress_stream, zlib.FlushValue.NoFlush);
        out.items.len += out.unusedCapacitySlice().len - self.decompress_stream.avail_out;

        // Check for decompression bomb
        if (out.items.len - initial_len > MAX_DECOMPRESSED_SIZE) {
            return error.TooLarge;
        }

        if (res == .StreamEnd) {
            break;
        }
        if (res != .Ok) {
            return error.InflateFailed;
        }
        if (self.decompress_stream.avail_out == 0 and self.decompress_stream.avail_in != 0) {
            // Need more output buffer space, continue loop
            continue;
        }
        if (self.decompress_stream.avail_in == 0) {
            // This shouldn't happen with the trailer, but as a safeguard.
            break;
        }
    }

    if (self.params.server_no_context_takeover == 1) {
        _ = zlib.inflateReset(&self.decompress_stream);
    }
}

pub fn compress(self: *PerMessageDeflate, in_buf: []const u8, out: *std.array_list.Managed(u8)) error{ DeflateFailed, OutOfMemory }!void {
    self.compress_stream.next_in = in_buf.ptr;
    self.compress_stream.avail_in = @intCast(in_buf.len);

    while (true) {
        try out.ensureUnusedCapacity(COMPRESSION_BUFFER_SIZE);
        self.compress_stream.next_out = out.unusedCapacitySlice().ptr;
        self.compress_stream.avail_out = @intCast(out.unusedCapacitySlice().len);

        const res = zlib.deflate(&self.compress_stream, zlib.FlushValue.SyncFlush);
        out.items.len += out.unusedCapacitySlice().len - self.compress_stream.avail_out;
        if (res != .Ok)
            return error.DeflateFailed;

        // exit only when zlib is truly finished
        if (self.compress_stream.avail_in == 0 and self.compress_stream.avail_out != 0) {
            break;
        }
    }

    // Remove the 4-byte trailer (00 00 FF FF) added by Z_SYNC_FLUSH
    if (out.items.len >= 4 and
        std.mem.eql(u8, out.items[out.items.len - 4 ..], &DEFLATE_TRAILER))
    {
        out.shrinkRetainingCapacity(out.items.len - 4);
    }

    if (self.params.client_no_context_takeover == 1) {
        _ = zlib.deflateReset(&self.compress_stream);
    }
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const libdeflate = bun.libdeflate;
const zlib = bun.zlib;
