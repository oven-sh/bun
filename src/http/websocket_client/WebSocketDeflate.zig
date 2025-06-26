const std = @import("std");
const bun = @import("bun");
const zlib = bun.zlib;

pub const Params = extern struct {
    server_max_window_bits: u8 = 15,
    client_max_window_bits: u8 = 15,
    server_no_context_takeover: bool = false,
    client_no_context_takeover: bool = false,

    pub const MAX_WINDOW_BITS: u8 = 15;
    pub const MIN_WINDOW_BITS: u8 = 8;
};

/// Manages the DEFLATE compression and decompression streams for a WebSocket connection.
pub const PerMessageDeflate = struct {
    const Self = @This();

    allocator: std.mem.Allocator,
    compress_stream: zlib.z_stream,
    decompress_stream: zlib.z_stream,
    params: Params,

    // Constants from zlib.h
    const Z_DEFAULT_COMPRESSION = 6;
    const Z_DEFLATED = 8;
    const Z_DEFAULT_STRATEGY = 0;
    const Z_DEFAULT_MEM_LEVEL = 8;

    // Buffer size for compression/decompression operations
    const COMPRESSION_BUFFER_SIZE = 4096;

    // DEFLATE trailer bytes added by Z_SYNC_FLUSH
    const DEFLATE_TRAILER = [_]u8{ 0x00, 0x00, 0xff, 0xff };

    pub fn init(allocator: std.mem.Allocator, params: Params) !*Self {
        const self = try allocator.create(Self);
        self.* = .{
            .allocator = allocator,
            .params = params,
            .compress_stream = std.mem.zeroes(zlib.z_stream),
            .decompress_stream = std.mem.zeroes(zlib.z_stream),
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

    pub fn deinit(self: *Self) void {
        _ = zlib.deflateEnd(&self.compress_stream);
        _ = zlib.inflateEnd(&self.decompress_stream);
        self.allocator.destroy(self);
    }

    pub fn decompress(self: *Self, in_buf: []const u8, out: *std.ArrayList(u8)) error{ InflateFailed, OutOfMemory }!void {
        var in_with_trailer = std.ArrayList(u8).init(self.allocator);
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

        if (self.params.server_no_context_takeover) {
            _ = zlib.inflateReset(&self.decompress_stream);
        }
    }

    pub fn compress(self: *Self, in_buf: []const u8, out: *std.ArrayList(u8)) error{ DeflateFailed, OutOfMemory }!void {
        self.compress_stream.next_in = in_buf.ptr;
        self.compress_stream.avail_in = @intCast(in_buf.len);

        while (true) {
            try out.ensureUnusedCapacity(COMPRESSION_BUFFER_SIZE);
            self.compress_stream.next_out = out.unusedCapacitySlice().ptr;
            self.compress_stream.avail_out = @intCast(out.unusedCapacitySlice().len);

            const res = zlib.deflate(&self.compress_stream, zlib.FlushValue.SyncFlush);
            out.items.len += out.unusedCapacitySlice().len - self.compress_stream.avail_out;

            if (res != .Ok) {
                return error.DeflateFailed;
            }

            if (self.compress_stream.avail_in == 0) {
                break;
            }
        }

        // Remove the 4-byte trailer (00 00 FF FF) added by Z_SYNC_FLUSH
        if (out.items.len >= 4 and
            std.mem.eql(u8, out.items[out.items.len - 4 ..], &DEFLATE_TRAILER))
        {
            out.shrinkRetainingCapacity(out.items.len - 4);
        }

        if (self.params.client_no_context_takeover) {
            _ = zlib.deflateReset(&self.compress_stream);
        }
    }
};
