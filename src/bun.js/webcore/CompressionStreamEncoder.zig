const CompressionStreamEncoder = @This();

const std = @import("std");
const bun = @import("bun");
const webcore = bun.webcore;
const streams = webcore.streams;
const jsc = bun.jsc;
const Output = bun.Output;
const Blob = webcore.Blob;
const ByteList = bun.ByteList;
const JSC = bun.JSC;
const JSValue = jsc.JSValue;

const log = Output.scoped(.CompressionStreamEncoder, false);

pub const Algorithm = enum {
    gzip,
    deflate,
    deflate_raw,

    pub fn fromString(str: []const u8) ?Algorithm {
        if (bun.strings.eqlComptime(str, "gzip")) return .gzip;
        if (bun.strings.eqlComptime(str, "deflate")) return .deflate;
        if (bun.strings.eqlComptime(str, "deflate-raw")) return .deflate_raw;
        return null;
    }

    pub fn toWindowBits(this: Algorithm) c_int {
        return switch (this) {
            .gzip => 15 + 16, // Add 16 for gzip encoding
            .deflate => 15, // Standard deflate
            .deflate_raw => -15, // Raw deflate (no header)
        };
    }
};

pub const State = union(enum) {
    uninit: Algorithm,
    inflate: bun.zlib.z_stream,
    err: bun.sys.Error,
};

pub const Encoder = struct {
    ref_count: bun.ptr.RefCount(Encoder, "ref_count", deinit, .{}),
    allocator: std.mem.Allocator,
    state: State,

    // Output buffer for compressed data
    buffer: bun.ByteList,

    // Handles async pull requests when buffer is empty
    pending: streams.Result.Pending = .{},

    // Track if we've received the final flush
    is_closed: bool = false,
    
    // Internal methods to be called by the linked CompressionSink
    pub fn write(this: *Encoder, chunk: []const u8) !void {
        if (this.is_closed or this.state == .err) return;

        var stream = switch (this.state) {
            .uninit => |algo| blk: {
                var stream = std.mem.zeroes(bun.zlib.z_stream);
                const rc = bun.zlib.deflateInit2(
                    &stream,
                    bun.zlib.Z_DEFAULT_COMPRESSION,
                    bun.zlib.Z_DEFLATED,
                    algo.toWindowBits(),
                    8, // Default memory level
                    bun.zlib.Z_DEFAULT_STRATEGY,
                );
                
                if (rc != bun.zlib.Z_OK) {
                    this.state = .{ .err = bun.sys.Error.fromCode(.INVAL, .deflateInit2) };
                    return error.CompressionInitFailed;
                }
                
                this.state = .{ .inflate = stream };
                break :blk &this.state.inflate;
            },
            .inflate => |*s| s,
            .err => return error.CompressionError,
        };

        stream.next_in = @constCast(chunk.ptr);
        stream.avail_in = @intCast(chunk.len);

        // Compress the data
        while (stream.avail_in > 0) {
            const initial_buffer_len = this.buffer.len;
            try this.buffer.ensureUnusedCapacity(this.allocator, 4096);
            
            stream.next_out = this.buffer.ptr + this.buffer.len;
            stream.avail_out = @intCast(this.buffer.capacity - this.buffer.len);
            
            const rc = bun.zlib.deflate(stream, bun.zlib.Z_NO_FLUSH);
            
            const compressed_bytes = (this.buffer.capacity - this.buffer.len) - stream.avail_out;
            this.buffer.len += compressed_bytes;
            
            if (rc != bun.zlib.Z_OK and rc != bun.zlib.Z_BUF_ERROR) {
                this.state = .{ .err = bun.sys.Error.fromCode(.INVAL, .deflate) };
                return error.CompressionFailed;
            }
        }

        // If we have a pending pull request and now have data, fulfill it
        if (this.pending.state == .pending and this.buffer.len > 0) {
            const to_copy = @min(this.pending_buffer.len, this.buffer.len);
            @memcpy(this.pending_buffer[0..to_copy], this.buffer.items[0..to_copy]);
            
            // Shift remaining data
            if (to_copy < this.buffer.len) {
                std.mem.copyForwards(u8, this.buffer.items[0..this.buffer.len - to_copy], this.buffer.items[to_copy..this.buffer.len]);
            }
            this.buffer.len -= to_copy;
            
            this.pending.result = .{
                .into_array = .{
                    .value = this.pending_value.get() orelse .zero,
                    .len = @truncate(to_copy),
                },
            };
            this.pending_buffer = &.{};
            this.pending_value.clear();
            this.pending.run();
        }
    }

    pub fn flush(this: *Encoder) !void {
        if (this.is_closed or this.state == .err) return;
        this.is_closed = true;

        var stream = switch (this.state) {
            .inflate => |*s| s,
            .uninit => {
                // If we never initialized, we're done
                return;
            },
            .err => return,
        };

        // Flush remaining compressed data
        stream.next_in = null;
        stream.avail_in = 0;
        
        while (true) {
            try this.buffer.ensureUnusedCapacity(this.allocator, 4096);
            
            stream.next_out = this.buffer.ptr + this.buffer.len;
            stream.avail_out = @intCast(this.buffer.capacity - this.buffer.len);
            
            const rc = bun.zlib.deflate(stream, bun.zlib.Z_FINISH);
            
            const compressed_bytes = (this.buffer.capacity - this.buffer.len) - stream.avail_out;
            this.buffer.len += compressed_bytes;
            
            if (rc == bun.zlib.Z_STREAM_END) {
                break;
            }
            
            if (rc != bun.zlib.Z_OK and rc != bun.zlib.Z_BUF_ERROR) {
                this.state = .{ .err = bun.sys.Error.fromCode(.INVAL, .deflate) };
                return error.CompressionFailed;
            }
        }

        // Clean up zlib stream
        _ = bun.zlib.deflateEnd(stream);

        // If we have a pending pull request, fulfill it with the final data
        if (this.pending.state == .pending) {
            if (this.buffer.len > 0) {
                const to_copy = @min(this.pending_buffer.len, this.buffer.len);
                @memcpy(this.pending_buffer[0..to_copy], this.buffer.items[0..to_copy]);
                
                // Shift remaining data
                if (to_copy < this.buffer.len) {
                    std.mem.copyForwards(u8, this.buffer.items[0..this.buffer.len - to_copy], this.buffer.items[to_copy..this.buffer.len]);
                }
                this.buffer.len -= to_copy;
                
                this.pending.result = if (this.buffer.len == 0) .{
                    .into_array_and_done = .{
                        .value = this.pending_value.get() orelse .zero,
                        .len = @truncate(to_copy),
                    },
                } else .{
                    .into_array = .{
                        .value = this.pending_value.get() orelse .zero,
                        .len = @truncate(to_copy),
                    },
                };
            } else {
                this.pending.result = .{ .done = {} };
            }
            
            this.pending_buffer = &.{};
            this.pending_value.clear();
            this.pending.run();
        }
    }

    // Store pending pull request info
    pending_buffer: []u8 = &.{},
    pending_value: jsc.Strong.Optional = .empty,

    pub fn deinit(this: *Encoder) void {
        if (this.state == .inflate) {
            _ = bun.zlib.deflateEnd(&this.state.inflate);
        }
        this.buffer.deinitWithAllocator(this.allocator);
        this.pending_value.deinit();
        this.parent().deinit();
    }

    pub fn parent(this: *Encoder) *Source {
        return @fieldParentPtr("context", this);
    }

    pub fn setRef(this: *Encoder, ref: bool) void {
        if (ref) {
            _ = this.parent().incrementCount();
        } else {
            _ = this.parent().decrementCount();
        }
    }
};

pub fn onStart(this: *Encoder) streams.Start {
    log("onStart()", .{});
    return .{ .ready = {} };
}

pub fn onPull(this: *Encoder, buffer: []u8, view: JSValue) streams.Result {
    log("onPull({d})", .{buffer.len});
    
    if (this.buffer.len > 0) {
        const to_copy = @min(buffer.len, this.buffer.len);
        @memcpy(buffer[0..to_copy], this.buffer.items[0..to_copy]);
        
        // Shift remaining data
        if (to_copy < this.buffer.len) {
            std.mem.copyForwards(u8, this.buffer.items[0..this.buffer.len - to_copy], this.buffer.items[to_copy..this.buffer.len]);
        }
        this.buffer.len -= to_copy;
        
        if (this.is_closed and this.buffer.len == 0) {
            return .{
                .into_array_and_done = .{
                    .value = view,
                    .len = @truncate(to_copy),
                },
            };
        }
        
        return .{
            .into_array = .{
                .value = view,
                .len = @truncate(to_copy),
            },
        };
    }
    
    if (this.is_closed) {
        return .{ .done = {} };
    }
    
    // Store the pending request
    this.pending_buffer = buffer;
    this.pending_value.set(this.parent().globalThis, view);
    
    return .{ .pending = &this.pending };
}

pub fn onCancel(this: *Encoder) void {
    log("onCancel()", .{});
    this.is_closed = true;
    
    if (this.state == .inflate) {
        _ = bun.zlib.deflateEnd(&this.state.inflate);
        this.state = .{ .uninit = .gzip };
    }
    
    this.buffer.clearAndFree(this.allocator);
    
    if (this.pending.state == .pending) {
        this.pending.result = .{ .done = {} };
        this.pending_buffer = &.{};
        this.pending_value.clear();
        this.pending.run();
    }
}

pub fn drain(this: *Encoder) bun.ByteList {
    if (this.buffer.len > 0) {
        const out = this.buffer;
        this.buffer = .{};
        return out;
    }
    
    return .{};
}

pub fn memoryCost(this: *const Encoder) usize {
    return this.buffer.capacity;
}

pub fn toBufferedValue(this: *Encoder, globalThis: *jsc.JSGlobalObject, action: streams.BufferAction.Tag) bun.JSError!jsc.JSValue {
    _ = this;
    _ = globalThis;
    _ = action;
    return .zero;
}

// Implement the ReadableStream.Source interface for Encoder
pub const Source = webcore.ReadableStream.NewSource(
    Encoder,
    "CompressionStream",
    onStart,
    onPull,
    onCancel,
    deinit,
    setRef,
    drain,
    memoryCost,
    toBufferedValue,
);