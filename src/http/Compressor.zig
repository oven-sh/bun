const std = @import("std");
const bun = @import("bun");
const Encoding = @import("./Encoding.zig").Encoding;
const Zlib = @import("../zlib.zig");
const Brotli = bun.brotli;
const zstd = bun.zstd;

pub const Compressor = struct {
    pub fn compress(
        allocator: std.mem.Allocator,
        data: []const u8,
        encoding: Encoding,
        level: u8,
    ) []u8 {
        return switch (encoding) {
            .brotli => compressBrotli(allocator, data, level),
            .gzip => compressGzip(allocator, data, level),
            .zstd => compressZstd(allocator, data, level),
            .deflate => compressDeflate(allocator, data, level),
            else => &[_]u8{},
        };
    }

    fn compressBrotli(allocator: std.mem.Allocator, data: []const u8, level: u8) []u8 {
        const max_output_size = Brotli.c.BrotliEncoderMaxCompressedSize(data.len);
        const output = allocator.alloc(u8, max_output_size) catch bun.outOfMemory();
        errdefer allocator.free(output);

        var output_size = max_output_size;
        const result = Brotli.c.BrotliEncoderCompress(
            @intCast(level),
            Brotli.c.BROTLI_DEFAULT_WINDOW,
            .generic,
            data.len,
            data.ptr,
            &output_size,
            output.ptr,
        );

        if (result == 0) {
            allocator.free(output);
            return &[_]u8{};
        }

        return allocator.realloc(output, output_size) catch output[0..output_size];
    }

    fn compressGzip(allocator: std.mem.Allocator, data: []const u8, level: u8) []u8 {
        return compressZlib(allocator, data, level, Zlib.MAX_WBITS | 16);
    }

    fn compressDeflate(allocator: std.mem.Allocator, data: []const u8, level: u8) []u8 {
        return compressZlib(allocator, data, level, -Zlib.MAX_WBITS);
    }

    fn compressZlib(allocator: std.mem.Allocator, data: []const u8, level: u8, window_bits: c_int) []u8 {
        var stream: Zlib.z_stream = undefined;
        @memset(std.mem.asBytes(&stream), 0);

        const init_result = deflateInit2_(
            &stream,
            @intCast(level),
            Z_DEFLATED,
            window_bits,
            8,
            Z_DEFAULT_STRATEGY,
            Zlib.zlibVersion(),
            @sizeOf(Zlib.z_stream),
        );

        if (init_result != .Ok) {
            return &[_]u8{};
        }
        defer _ = deflateEnd(&stream);

        const max_output_size = deflateBound(&stream, data.len);
        const output = allocator.alloc(u8, max_output_size) catch bun.outOfMemory();
        errdefer allocator.free(output);

        stream.next_in = data.ptr;
        stream.avail_in = @intCast(data.len);
        stream.next_out = output.ptr;
        stream.avail_out = @intCast(max_output_size);

        const deflate_result = deflate(&stream, .Finish);
        if (deflate_result != .StreamEnd) {
            allocator.free(output);
            return &[_]u8{};
        }

        const compressed_size = stream.total_out;
        return allocator.realloc(output, compressed_size) catch output[0..compressed_size];
    }

    fn compressZstd(allocator: std.mem.Allocator, data: []const u8, level: u8) []u8 {
        const max_output_size = bun.zstd.compressBound(data.len);
        const output = allocator.alloc(u8, max_output_size) catch bun.outOfMemory();
        errdefer allocator.free(output);

        const result = bun.zstd.compress(output, data, level);
        const compressed_size = switch (result) {
            .success => |size| size,
            .err => {
                allocator.free(output);
                return &[_]u8{};
            },
        };

        // Shrink to actual size
        return allocator.realloc(output, compressed_size) catch output[0..compressed_size];
    }

    pub fn shouldCompressMIME(content_type: ?[]const u8) bool {
        const mime = content_type orelse return true;

        // Parse the MIME type to get its category
        const category = bun.http.MimeType.Category.init(mime);

        // Check for categories that should always be compressed
        switch (category) {
            .text, .html, .css, .json, .javascript, .wasm, .font => return true,
            .image, .video, .audio => {
                // Special case: SVG is compressible even though it's an image
                if (bun.strings.hasPrefixComptime(mime, "image/svg+xml")) return true;
                return false;
            },
            .application => {
                // Check for XML-based formats (application/*+xml)
                if (bun.strings.containsComptime(mime, "+xml")) return true;
                // Check for JSON-based formats (application/*+json)
                if (bun.strings.containsComptime(mime, "+json")) return true;
                // Check for other XML formats
                if (bun.strings.hasPrefixComptime(mime, "application/xml")) return true;

                // Explicitly exclude pre-compressed formats
                if (bun.strings.containsComptime(mime, "zip")) return false;
                if (bun.strings.containsComptime(mime, "gzip")) return false;
                if (bun.strings.containsComptime(mime, "bzip")) return false;
                if (bun.strings.containsComptime(mime, "compress")) return false;
                if (bun.strings.containsComptime(mime, "zstd")) return false;
                if (bun.strings.containsComptime(mime, "rar")) return false;

                // Exclude binary streams
                if (bun.strings.hasPrefixComptime(mime, "application/octet-stream")) return false;

                // Compress other application types by default
                return true;
            },
            else => return false,
        }
    }
};

// Import external deflate function
extern fn deflateEnd(strm: *Zlib.z_stream) Zlib.ReturnCode;
extern fn deflateBound(strm: *Zlib.z_stream, sourceLen: c_ulong) c_ulong;
extern fn deflate(strm: *Zlib.z_stream, flush: Zlib.FlushValue) Zlib.ReturnCode;
extern fn deflateInit2_(
    strm: *Zlib.z_stream,
    level: c_int,
    method: c_int,
    windowBits: c_int,
    memLevel: c_int,
    strategy: c_int,
    version: [*:0]const u8,
    stream_size: c_int,
) Zlib.ReturnCode;

const Z_DEFLATED = 8;
const Z_DEFAULT_STRATEGY = 0;
const Z_OK = 0;
const Z_STREAM_END = 1;
const Z_FINISH = 4;
