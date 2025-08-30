const DecompressionStreamDecoder = @This();

// Decompression state - maintains decompressor across multiple decode calls
state: union(enum) {
    uninitialized,
    deflate: *zlib.z_stream,
    gzip: *zlib.z_stream,
    deflate_raw: *zlib.z_stream,
    brotli: *bun.brotli.c.BrotliDecoder,
    zstd: *bun.c.ZSTD_DStream,
},
format: Format,
pending_output: std.ArrayList(u8),
input_buffer: std.ArrayList(u8),
allocator: std.mem.Allocator,

pub const Format = enum(u8) {
    brotli = 0,
    gzip = 1,
    deflate = 2,
    deflate_raw = 3,
    zstd = 4,
};

pub const js = JSC.Codegen.JSDecompressionStreamDecoder;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub fn finalize(this: *DecompressionStreamDecoder) void {
    // Clean up the decompressor state
    switch (this.state) {
        .deflate, .gzip, .deflate_raw => |stream| {
            _ = zlib.inflateEnd(stream);
            this.allocator.destroy(stream);
        },
        .brotli => |decoder| {
            decoder.destroyInstance();
        },
        .zstd => |stream| {
            _ = bun.c.ZSTD_freeDStream(stream);
        },
        .uninitialized => {},
    }

    this.pending_output.deinit();
    this.input_buffer.deinit();
    bun.destroy(this);
}

pub fn constructor(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!*DecompressionStreamDecoder {
    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len == 0) {
        return globalObject.throwNotEnoughArguments("DecompressionStreamDecoder", 1, arguments.len);
    }

    const format_int = arguments[0].toInt32();
    if (format_int < 0 or format_int > 4) {
        return globalObject.throwInvalidArguments("Invalid decompression format", .{});
    }

    const format = @as(Format, @enumFromInt(@as(u8, @intCast(format_int))));

    const decoder = bun.new(DecompressionStreamDecoder, .{
        .state = .uninitialized,
        .format = format,
        .pending_output = std.ArrayList(u8).init(bun.default_allocator),
        .input_buffer = std.ArrayList(u8).init(bun.default_allocator),
        .allocator = bun.default_allocator,
    });

    // Initialize the streaming decompressor based on format
    switch (format) {
        .brotli => {
            if (!bun.brotli.c.BrotliDecoder.initializeBrotli()) {
                bun.destroy(decoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to initialize Brotli", .{}));
            }

            const instance = bun.brotli.c.BrotliDecoder.createInstance(&bun.brotli.BrotliAllocator.alloc, &bun.brotli.BrotliAllocator.free, null) orelse {
                bun.destroy(decoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to create Brotli decoder", .{}));
            };

            // Enable large window for better compatibility
            _ = instance.setParameter(.LARGE_WINDOW, 1);

            decoder.state = .{ .brotli = instance };
        },
        .gzip => {
            const stream = decoder.allocator.create(zlib.z_stream) catch {
                bun.destroy(decoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Out of memory", .{}));
            };
            stream.* = std.mem.zeroes(zlib.z_stream);
            const rc = zlib.inflateInit2_(stream, 31, // 31 = auto-detect gzip or zlib format
                zlib.zlibVersion(), @sizeOf(zlib.z_stream));
            if (rc != .Ok) {
                decoder.allocator.destroy(stream);
                bun.destroy(decoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to create gzip decompressor", .{}));
            }
            decoder.state = .{ .gzip = stream };
        },
        .deflate => {
            const stream = decoder.allocator.create(zlib.z_stream) catch {
                bun.destroy(decoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Out of memory", .{}));
            };
            stream.* = std.mem.zeroes(zlib.z_stream);
            const rc = zlib.inflateInit2_(stream, 15, // Standard deflate with zlib wrapper
                zlib.zlibVersion(), @sizeOf(zlib.z_stream));
            if (rc != .Ok) {
                decoder.allocator.destroy(stream);
                bun.destroy(decoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to create deflate decompressor", .{}));
            }
            decoder.state = .{ .deflate = stream };
        },
        .deflate_raw => {
            const stream = decoder.allocator.create(zlib.z_stream) catch {
                bun.destroy(decoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Out of memory", .{}));
            };
            stream.* = std.mem.zeroes(zlib.z_stream);
            const rc = zlib.inflateInit2_(stream, -15, // Raw deflate (no headers)
                zlib.zlibVersion(), @sizeOf(zlib.z_stream));
            if (rc != .Ok) {
                decoder.allocator.destroy(stream);
                bun.destroy(decoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to create deflate-raw decompressor", .{}));
            }
            decoder.state = .{ .deflate_raw = stream };
        },
        .zstd => {
            const stream = bun.c.ZSTD_createDStream() orelse {
                bun.destroy(decoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to create zstd decompressor", .{}));
            };

            // Initialize the stream
            const rc = bun.c.ZSTD_initDStream(stream);
            if (bun.c.ZSTD_isError(rc) != 0) {
                _ = bun.c.ZSTD_freeDStream(stream);
                bun.destroy(decoder);
                return globalObject.throwValue(globalObject.createErrorInstance("Failed to initialize zstd decompressor", .{}));
            }

            decoder.state = .{ .zstd = stream };
        },
    }

    return decoder;
}

pub fn decode(this: *DecompressionStreamDecoder, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len == 0) {
        return globalObject.throwNotEnoughArguments("DecompressionStreamDecoder.decode", 1, arguments.len);
    }

    const chunk_value = arguments[0];
    var chunk_slice: []const u8 = &.{};

    // Handle ArrayBuffer and TypedArrays
    if (chunk_value.asArrayBuffer(globalObject)) |array_buffer| {
        chunk_slice = array_buffer.slice();
    } else {
        return globalObject.throwInvalidArguments("Input must be an ArrayBuffer or TypedArray", .{});
    }

    if (chunk_slice.len == 0) {
        return JSValue.jsNull();
    }

    // Clear any pending output from previous operations
    this.pending_output.clearRetainingCapacity();

    switch (this.state) {
        .brotli => |decoder| {
            // Process input with Brotli streaming decompression
            var input = chunk_slice;
            var output_buf: [8192]u8 = undefined;

            while (input.len > 0) {
                var available_in = input.len;
                var available_out = output_buf.len;
                var next_in = input.ptr;
                var next_out = &output_buf;

                const result = decoder.decompressStream(&available_in, @ptrCast(&next_in), &available_out, @ptrCast(&next_out), null);

                const bytes_consumed = input.len - available_in;
                const bytes_written = output_buf.len - available_out;

                if (bytes_written > 0) {
                    this.pending_output.appendSlice(output_buf[0..bytes_written]) catch |err| {
                        return globalObject.throwError(err, "Out of memory");
                    };
                }

                input = input[bytes_consumed..];

                switch (result) {
                    .success => break,
                    .needs_more_input => {
                        // Store remaining input for next call if needed
                        if (input.len > 0) {
                            this.input_buffer.appendSlice(input) catch |err| {
                                return globalObject.throwError(err, "Out of memory");
                            };
                        }
                        break;
                    },
                    .needs_more_output => continue,
                    .err => {
                        const error_code = decoder.getErrorCode();
                        return globalObject.throwValue(globalObject.createErrorInstance("Brotli decompression error: {s}", .{@tagName(error_code)}));
                    },
                }
            }

            // After processing the input, check if there's more output available
            while (decoder.hasMoreOutput()) {
                const output_chunk = decoder.takeOutput();
                if (output_chunk.len > 0) {
                    this.pending_output.appendSlice(output_chunk) catch |err| {
                        return globalObject.throwError(err, "Out of memory");
                    };
                }
            }
        },
        .deflate, .gzip, .deflate_raw => |stream| {
            // Process input with zlib streaming decompression
            var output_buf: [16384]u8 = undefined;

            stream.next_in = @constCast(@ptrCast(chunk_slice.ptr));
            stream.avail_in = @intCast(chunk_slice.len);

            while (stream.avail_in > 0 or stream.avail_out == 0) {
                stream.next_out = &output_buf;
                stream.avail_out = output_buf.len;

                const rc = zlib.inflate(stream, .NoFlush);
                switch (rc) {
                    .Ok, .BufError => {}, // Continue processing
                    .StreamEnd => {}, // Stream ended successfully
                    .DataError => {
                        const msg = if (stream.err_msg) |m| std.mem.span(m) else "Corrupted or truncated compressed data";
                        return globalObject.throwValue(globalObject.createErrorInstance("{s}", .{msg}));
                    },
                    else => {
                        const msg = if (stream.err_msg) |m| std.mem.span(m) else "Decompression failed";
                        return globalObject.throwValue(globalObject.createErrorInstance("{s}", .{msg}));
                    },
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
            // Process input with zstd streaming decompression
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

                const rc = bun.c.ZSTD_decompressStream(stream, &output, &input);
                if (bun.c.ZSTD_isError(rc) != 0) {
                    const error_name = bun.c.ZSTD_getErrorName(rc);
                    const error_msg = if (error_name) |name| bun.sliceTo(name, 0) else "Unknown error";
                    return globalObject.throwValue(globalObject.createErrorInstance("Zstd decompression failed: {s}", .{error_msg}));
                }

                if (output.pos > 0) {
                    this.pending_output.appendSlice(output_buf[0..output.pos]) catch |err| {
                        return globalObject.throwError(err, "Out of memory");
                    };
                }
            }
        },
        .uninitialized => {
            return globalObject.throwValue(globalObject.createErrorInstance("Decoder not initialized", .{}));
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

pub fn flush(this: *DecompressionStreamDecoder, globalObject: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    // Clear any pending output
    this.pending_output.clearRetainingCapacity();

    switch (this.state) {
        .brotli => |decoder| {
            // Process any buffered input first
            if (this.input_buffer.items.len > 0) {
                var input = this.input_buffer.items;
                var output_buf: [8192]u8 = undefined;

                while (input.len > 0) {
                    var available_in = input.len;
                    var available_out = output_buf.len;
                    var next_in = input.ptr;
                    var next_out = &output_buf;

                    const result = decoder.decompressStream(&available_in, @ptrCast(&next_in), &available_out, @ptrCast(&next_out), null);

                    const bytes_consumed = input.len - available_in;
                    const bytes_written = output_buf.len - available_out;

                    if (bytes_written > 0) {
                        this.pending_output.appendSlice(output_buf[0..bytes_written]) catch |err| {
                            return globalObject.throwError(err, "Out of memory");
                        };
                    }

                    input = input[bytes_consumed..];

                    switch (result) {
                        .success => {
                            if (!decoder.isFinished()) {
                                return globalObject.throwValue(globalObject.createErrorInstance("Incomplete Brotli stream", .{}));
                            }
                            break;
                        },
                        .needs_more_input => {
                            return globalObject.throwValue(globalObject.createErrorInstance("Incomplete Brotli stream - truncated data", .{}));
                        },
                        .needs_more_output => continue,
                        .err => {
                            const error_code = decoder.getErrorCode();
                            return globalObject.throwValue(globalObject.createErrorInstance("Brotli decompression error: {s}", .{@tagName(error_code)}));
                        },
                    }
                }

                this.input_buffer.clearRetainingCapacity();
            }

            // Final validation - check if stream is properly finished
            if (!decoder.isFinished()) {
                return globalObject.throwValue(globalObject.createErrorInstance("Incomplete Brotli stream - not properly finished", .{}));
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

                const rc = zlib.inflate(stream, .Finish);

                const bytes_written = output_buf.len - stream.avail_out;
                if (bytes_written > 0) {
                    this.pending_output.appendSlice(output_buf[0..bytes_written]) catch |err| {
                        return globalObject.throwError(err, "Out of memory");
                    };
                }

                switch (rc) {
                    .StreamEnd => break, // Successfully completed
                    .Ok, .BufError => {
                        // Continue if we produced output, otherwise we might be stuck
                        if (bytes_written == 0) {
                            return globalObject.throwValue(globalObject.createErrorInstance("Incomplete stream - no more data to flush", .{}));
                        }
                    },
                    .DataError => {
                        const msg = if (stream.err_msg) |m| std.mem.span(m) else "Corrupted or truncated compressed data";
                        return globalObject.throwValue(globalObject.createErrorInstance("{s}", .{msg}));
                    },
                    else => {
                        const msg = if (stream.err_msg) |m| std.mem.span(m) else "Flush failed";
                        return globalObject.throwValue(globalObject.createErrorInstance("{s}", .{msg}));
                    },
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

                // Use empty input buffer for flushing
                var input = bun.c.ZSTD_inBuffer{
                    .src = null,
                    .size = 0,
                    .pos = 0,
                };

                const rc = bun.c.ZSTD_decompressStream(stream, &output, &input);
                if (bun.c.ZSTD_isError(rc) != 0) {
                    const error_name = bun.c.ZSTD_getErrorName(rc);
                    const error_msg = if (error_name) |name| bun.sliceTo(name, 0) else "Unknown error";
                    return globalObject.throwValue(globalObject.createErrorInstance("Zstd flush failed: {s}", .{error_msg}));
                }

                if (output.pos > 0) {
                    this.pending_output.appendSlice(output_buf[0..output.pos]) catch |err| {
                        return globalObject.throwError(err, "Out of memory");
                    };
                }

                // If no more output is generated, we're done
                if (output.pos == 0) {
                    // rc > 0 just means the frame expects more data, which is fine during flush
                    // The stream is considered complete when no more output is generated
                    break;
                }
            }
        },
        .uninitialized => {
            return globalObject.throwValue(globalObject.createErrorInstance("Decoder not initialized", .{}));
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

const std = @import("std");
const zstd = @import("../../deps/zstd.zig");

const bun = @import("bun");
const zlib = bun.zlib;

const JSC = bun.jsc;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
