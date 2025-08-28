const CompressionStreamEncoder = @This();

const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const zlib = bun.zlib;
const zstd = @import("../../deps/zstd.zig");

// Compression state - maintains compressor across multiple encode calls
state: union(enum) {
    uninitialized,
    deflate: *zlib.z_stream,
    gzip: *zlib.z_stream,
    deflate_raw: *zlib.z_stream,
    brotli: *bun.brotli.c.BrotliEncoder,
    zstd: *bun.c.ZSTD_CStream,
},
format: Format,
pending_output: std.ArrayList(u8),
allocator: std.mem.Allocator,

pub const Format = enum(u8) {
    brotli = 0,
    gzip = 1,
    deflate = 2,
    deflate_raw = 3,
    zstd = 4,
};

pub const js = JSC.Codegen.JSCompressionStreamEncoder;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub fn finalize(this: *CompressionStreamEncoder) void {
    // Clean up the compressor state
    switch (this.state) {
        .deflate, .gzip, .deflate_raw => |stream| {
            _ = zlib.deflateEnd(stream);
            this.allocator.destroy(stream);
        },
        .brotli => |encoder| {
            encoder.destroyInstance();
        },
        .zstd => |stream| {
            _ = bun.c.ZSTD_freeCStream(stream);
        },
        .uninitialized => {},
    }

    this.pending_output.deinit();
    bun.destroy(this);
}

pub fn constructor(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!*CompressionStreamEncoder {
    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len == 0) {
        return globalObject.throwNotEnoughArguments("CompressionStreamEncoder", 1, arguments.len);
    }

    const format_int = arguments[0].toInt32();
    if (format_int < 0 or format_int > 4) {
        return globalObject.throwInvalidArguments("Invalid compression format", .{});
    }

    const format = @as(Format, @enumFromInt(@as(u8, @intCast(format_int))));

    const encoder = bun.new(CompressionStreamEncoder, .{
        .state = .uninitialized,
        .format = format,
        .pending_output = std.ArrayList(u8).init(bun.default_allocator),
        .allocator = bun.default_allocator,
    });

    // Initialize the streaming compressor based on format
    switch (format) {
        .brotli => {
            if (!bun.brotli.c.BrotliDecoder.initializeBrotli()) {
                bun.destroy(encoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to initialize Brotli", .{}));
            }
            const instance = bun.brotli.c.BrotliEncoder.createInstance(&bun.brotli.BrotliAllocator.alloc, &bun.brotli.BrotliAllocator.free, null) orelse {
                bun.destroy(encoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to create Brotli encoder", .{}));
            };
            // Set quality to 4 for better streaming performance (default 11 is too slow)
            // Quality 4 provides a good balance between speed and compression ratio
            _ = instance.setParameter(.quality, 4);
            encoder.state = .{ .brotli = instance };
        },
        .gzip => {
            const stream = encoder.allocator.create(zlib.z_stream) catch {
                bun.destroy(encoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Out of memory", .{}));
            };
            stream.* = std.mem.zeroes(zlib.z_stream);
            const rc = zlib.deflateInit2_(stream, 6, // compression level
                8, // Z_DEFLATED
                31, // 31 = gzip format
                8, // memLevel
                0, // Z_DEFAULT_STRATEGY
                zlib.zlibVersion(), @sizeOf(zlib.z_stream));
            if (rc != .Ok) {
                encoder.allocator.destroy(stream);
                bun.destroy(encoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to create gzip compressor", .{}));
            }
            encoder.state = .{ .gzip = stream };
        },
        .deflate => {
            const stream = encoder.allocator.create(zlib.z_stream) catch {
                bun.destroy(encoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Out of memory", .{}));
            };
            stream.* = std.mem.zeroes(zlib.z_stream);
            const rc = zlib.deflateInit2_(stream, 6, // compression level
                8, // Z_DEFLATED
                15, // Standard deflate with zlib wrapper
                8, // memLevel
                0, // Z_DEFAULT_STRATEGY
                zlib.zlibVersion(), @sizeOf(zlib.z_stream));
            if (rc != .Ok) {
                encoder.allocator.destroy(stream);
                bun.destroy(encoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to create deflate compressor", .{}));
            }
            encoder.state = .{ .deflate = stream };
        },
        .deflate_raw => {
            const stream = encoder.allocator.create(zlib.z_stream) catch {
                bun.destroy(encoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Out of memory", .{}));
            };
            stream.* = std.mem.zeroes(zlib.z_stream);
            const rc = zlib.deflateInit2_(stream, 6, // compression level
                8, // Z_DEFLATED
                -15, // Raw deflate (no headers)
                8, // memLevel
                0, // Z_DEFAULT_STRATEGY
                zlib.zlibVersion(), @sizeOf(zlib.z_stream));
            if (rc != .Ok) {
                encoder.allocator.destroy(stream);
                bun.destroy(encoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to create deflate-raw compressor", .{}));
            }
            encoder.state = .{ .deflate_raw = stream };
        },
        .zstd => {
            const stream = bun.c.ZSTD_createCStream() orelse {
                bun.destroy(encoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to create zstd compressor", .{}));
            };

            // Initialize with default compression level
            const rc = bun.c.ZSTD_initCStream(stream, bun.c.ZSTD_defaultCLevel());
            if (bun.c.ZSTD_isError(rc) != 0) {
                _ = bun.c.ZSTD_freeCStream(stream);
                bun.destroy(encoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to initialize zstd compressor", .{}));
            }

            encoder.state = .{ .zstd = stream };
        },
    }

    return encoder;
}

pub fn encode(this: *CompressionStreamEncoder, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len == 0) {
        return globalObject.throwNotEnoughArguments("CompressionStreamEncoder.encode", 1, arguments.len);
    }

    const chunk_value = arguments[0];
    var chunk_slice: []const u8 = &.{};

    // Handle ArrayBuffer and TypedArrays
    if (chunk_value.asArrayBuffer(globalObject)) |array_buffer| {
        chunk_slice = array_buffer.slice();
    } else {
        return globalObject.throwInvalidArguments("Input must be an ArrayBuffer or TypedArray", .{});
    }

    // Process even empty chunks as they might produce output from buffered data
    switch (this.state) {
        .brotli => |encoder| {
            // Process input with Brotli streaming compression
            const result = encoder.compressStream(.process, chunk_slice);
            if (!result.success) {
                return globalObject.throwValue(globalObject.createErrorInstance("Brotli compression failed", .{}));
            }

            // Add the initial output
            if (result.output.len > 0) {
                this.pending_output.appendSlice(result.output) catch |err| {
                    return globalObject.throwError(err, "Out of memory");
                };
            }

            // Brotli may have more output buffered - keep taking output until none left
            while (encoder.hasMoreOutput()) {
                const output_chunk = encoder.takeOutput();
                if (output_chunk.len > 0) {
                    this.pending_output.appendSlice(output_chunk) catch |err| {
                        return globalObject.throwError(err, "Out of memory");
                    };
                }
            }
        },
        .deflate, .gzip, .deflate_raw => |stream| {
            // Process input with zlib streaming compression
            var output_buf: [16384]u8 = undefined;

            stream.next_in = @constCast(@ptrCast(chunk_slice.ptr));
            stream.avail_in = @intCast(chunk_slice.len);

            while (stream.avail_in > 0 or stream.avail_out == 0) {
                stream.next_out = &output_buf;
                stream.avail_out = output_buf.len;

                const rc = zlib.deflate(stream, .NoFlush);
                if (rc != .Ok and rc != .StreamEnd) {
                    return globalObject.throwValue(globalObject.createErrorInstance("Compression failed", .{}));
                }

                const bytes_written = output_buf.len - stream.avail_out;
                if (bytes_written > 0) {
                    this.pending_output.appendSlice(output_buf[0..bytes_written]) catch |err| {
                        return globalObject.throwError(err, "Out of memory");
                    };
                }

                if (rc == .StreamEnd) break;
                if (stream.avail_in == 0 and bytes_written == 0) break;
            }
        },
        .zstd => |stream| {
            // Process input with zstd streaming compression
            var input = bun.c.ZSTD_inBuffer{
                .src = chunk_slice.ptr,
                .size = chunk_slice.len,
                .pos = 0,
            };

            var output_buf: [16384]u8 = undefined;
            while (input.pos < input.size) {
                var output = bun.c.ZSTD_outBuffer{
                    .dst = &output_buf,
                    .size = output_buf.len,
                    .pos = 0,
                };

                const rc = bun.c.ZSTD_compressStream(stream, &output, &input);
                if (bun.c.ZSTD_isError(rc) != 0) {
                    return globalObject.throwValue(globalObject.createErrorInstance("Zstd compression failed", .{}));
                }

                if (output.pos > 0) {
                    this.pending_output.appendSlice(output_buf[0..output.pos]) catch |err| {
                        return globalObject.throwError(err, "Out of memory");
                    };
                }
            }
        },
        .uninitialized => {
            return globalObject.throwValue(globalObject.createErrorInstance("Encoder not initialized", .{}));
        },
    }

    // Return accumulated output
    if (this.pending_output.items.len > 0) {
        // Transfer ownership of the buffer to JavaScript
        const result = this.pending_output.toOwnedSlice() catch |err| {
            return globalObject.throwError(err, "Out of memory");
        };
        return JSC.ArrayBuffer.fromBytes(result, .Uint8Array).toJS(globalObject);
    }
    
    return JSValue.jsNull();
}

pub fn flush(this: *CompressionStreamEncoder, globalObject: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    // Clear any pending output
    this.pending_output.clearRetainingCapacity();

    switch (this.state) {
        .brotli => |encoder| {
            // Flush remaining data with Brotli
            const result = encoder.compressStream(.finish, "");
            if (!result.success) {
                return globalObject.throwValue(globalObject.createErrorInstance("Brotli flush failed", .{}));
            }

            // Add the initial output
            if (result.output.len > 0) {
                this.pending_output.appendSlice(result.output) catch |err| {
                    return globalObject.throwError(err, "Out of memory");
                };
            }

            // Brotli may have more output buffered - keep taking output until none left
            while (encoder.hasMoreOutput()) {
                const output_chunk = encoder.takeOutput();
                if (output_chunk.len > 0) {
                    this.pending_output.appendSlice(output_chunk) catch |err| {
                        return globalObject.throwError(err, "Out of memory");
                    };
                }
            }
        },
        .deflate, .gzip, .deflate_raw => |stream| {
            // Flush remaining data with zlib
            var output_buf: [16384]u8 = undefined;

            stream.next_in = null;
            stream.avail_in = 0;

            while (true) {
                stream.next_out = &output_buf;
                stream.avail_out = output_buf.len;

                const rc = zlib.deflate(stream, .Finish);

                const bytes_written = output_buf.len - stream.avail_out;
                if (bytes_written > 0) {
                    this.pending_output.appendSlice(output_buf[0..bytes_written]) catch |err| {
                        return globalObject.throwError(err, "Out of memory");
                    };
                }

                if (rc == .StreamEnd) break;
                if (rc != .Ok and rc != .BufError) {
                    return globalObject.throwValue(globalObject.createErrorInstance("Flush failed", .{}));
                }
            }
        },
        .zstd => |stream| {
            // Flush remaining data with zstd
            var output_buf: [16384]u8 = undefined;

            while (true) {
                var output = bun.c.ZSTD_outBuffer{
                    .dst = &output_buf,
                    .size = output_buf.len,
                    .pos = 0,
                };

                const rc = bun.c.ZSTD_endStream(stream, &output);
                if (bun.c.ZSTD_isError(rc) != 0) {
                    return globalObject.throwValue(globalObject.createErrorInstance("Zstd flush failed", .{}));
                }

                if (output.pos > 0) {
                    this.pending_output.appendSlice(output_buf[0..output.pos]) catch |err| {
                        return globalObject.throwError(err, "Out of memory");
                    };
                }

                // rc == 0 means all data has been flushed
                if (rc == 0) break;
            }
        },
        .uninitialized => {
            return globalObject.throwValue(globalObject.createErrorInstance("Encoder not initialized", .{}));
        },
    }

    if (this.pending_output.items.len == 0) {
        return JSValue.jsNull();
    }

    // Transfer ownership of the buffer to JavaScript
    const result = this.pending_output.toOwnedSlice() catch |err| {
        return globalObject.throwError(err, "Out of memory");
    };

    return JSC.ArrayBuffer.fromBytes(result, .Uint8Array).toJS(globalObject);
}
