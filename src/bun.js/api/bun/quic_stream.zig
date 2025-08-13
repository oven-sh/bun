const std = @import("std");
const bun = @import("../../../bun.zig");
const jsc = bun.jsc;
const uws = bun.uws;
const Environment = bun.Environment;
const Async = bun.Async;

const log = bun.Output.scoped(.QuicStream, false);

pub const QuicStream = struct {
    const This = @This();

    // JavaScript class bindings
    pub const js = jsc.Codegen.JSQuicStream;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub const new = bun.TrivialNew(@This());

    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    // The underlying lsquic stream
    stream: ?*uws.quic.Stream = null,
    
    // Reference to parent socket
    socket: *QuicSocket,
    
    // Stream ID
    stream_id: u64,
    
    // Optional data attached to the stream
    data_value: jsc.JSValue = .zero,
    
    // JavaScript this value
    this_value: jsc.JSValue = .zero,
    
    // Reference counting
    ref_count: RefCount,
    poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
    
    // Stream state
    flags: Flags = .{},
    
    // Buffered writes before stream is connected
    write_buffer: std.ArrayList([]const u8) = undefined,
    write_buffer_initialized: bool = false,
    write_buffer_mutex: std.Thread.Mutex = .{},
    
    has_pending_activity: std.atomic.Value(bool) = std.atomic.Value(bool).init(true),

    pub const Flags = packed struct {
        is_readable: bool = true,
        is_writable: bool = true,
        is_closed: bool = false,
        has_backpressure: bool = false,
        fin_sent: bool = false,
        fin_received: bool = false,
        _: u26 = 0,
    };

    pub fn hasPendingActivity(this: *This) callconv(.C) bool {
        return this.has_pending_activity.load(.acquire);
    }

    pub fn memoryCost(_: *This) usize {
        return @sizeOf(This);
    }

    pub fn finalize(this: *This) void {
        this.deinit();
    }

    pub fn deinit(this: *This) void {
        this.poll_ref.unref(jsc.VirtualMachine.get());

        // Clean up write buffer
        if (this.write_buffer_initialized) {
            this.write_buffer_mutex.lock();
            defer this.write_buffer_mutex.unlock();
            
            // Free any buffered write data
            for (this.write_buffer.items) |buffered_data| {
                bun.default_allocator.free(buffered_data);
            }
            this.write_buffer.deinit();
            this.write_buffer_initialized = false;
        }

        // Unprotect the data value if set
        if (!this.data_value.isEmptyOrUndefinedOrNull()) {
            this.data_value.unprotect();
            this.data_value = .zero;
        }

        // Close stream if still open
        if (this.stream != null and !this.flags.is_closed) {
            this.closeImpl();
        }

        // Deref the parent socket
        this.socket.deref();
    }

    // Initialize a new QUIC stream
    pub fn init(allocator: std.mem.Allocator, socket: *QuicSocket, stream_id: u64, data_value: jsc.JSValue) !*This {
        const this = try allocator.create(This);
        this.* = This{
            .ref_count = RefCount.init(),
            .socket = socket,
            .stream_id = stream_id,
            .data_value = data_value,
        };
        
        // Initialize write buffer
        this.write_buffer = std.ArrayList([]const u8).init(allocator);
        this.write_buffer_initialized = true;
        
        // Ref the parent socket to keep it alive
        socket.ref();
        
        // Protect the data value if set
        if (!data_value.isEmptyOrUndefinedOrNull()) {
            data_value.protect();
        }
        
        this.ref();
        return this;
    }

    // Write data to the stream
    pub fn write(this: *This, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(1);
        if (arguments.len < 1) {
            return globalObject.throwInvalidArguments("write() requires a buffer argument", .{});
        }

        if (this.flags.is_closed) {
            return globalObject.throwInvalidArguments("Stream is closed", .{});
        }

        const data = arguments.ptr[0];
        
        // Convert to buffer
        var buffer: []const u8 = undefined;
        if (data.asArrayBuffer(globalObject)) |array_buffer| {
            buffer = array_buffer.slice();
        } else if (data.isString()) {
            const str = try data.toBunString(globalObject);
            defer str.deref();
            const utf8 = str.toUTF8(bun.default_allocator);
            defer utf8.deinit();
            buffer = utf8.slice();
        } else {
            return globalObject.throwInvalidArguments("write() expects a Buffer or string", .{});
        }

        return this.writeInternal(buffer, globalObject);
    }
    
    // Internal write method that can be called from both JS and internal code
    fn writeInternal(this: *This, buffer: []const u8, globalObject: ?*jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        // Write to the underlying stream or buffer if stream not yet connected
        if (this.stream) |stream| {
            log("QuicStream.write: Writing {} bytes directly to connected stream {*} (ID: {})", .{buffer.len, stream, this.stream_id});
            const written = stream.write(buffer);
            const written_usize: usize = if (written >= 0) @intCast(written) else 0;
            log("QuicStream.write: stream.write returned {} bytes for stream {}", .{written, this.stream_id});
            
            // Handle backpressure - if not all data was written, set backpressure flag
            if (written_usize < buffer.len) {
                this.flags.has_backpressure = true;
                log("QuicStream.write: backpressure detected on stream {}, wrote {} of {} bytes", .{ this.stream_id, written_usize, buffer.len });
            } else {
                this.flags.has_backpressure = false;
            }
            
            log("QuicStream.write: wrote {} bytes to stream {}", .{ written_usize, this.stream_id });
            const written_float: f64 = @floatFromInt(written_usize);
            return jsc.JSValue.jsNumber(written_float);
        } else {
            // Stream not connected yet, buffer the write
            log("QuicStream.write: Stream {} not connected, attempting to buffer {} bytes", .{this.stream_id, buffer.len});
            if (!this.write_buffer_initialized) {
                log("QuicStream.write: write buffer not initialized for stream {}, returning 0", .{this.stream_id});
                return jsc.JSValue.jsNumber(0);
            }
            
            this.write_buffer_mutex.lock();
            defer this.write_buffer_mutex.unlock();
            
            // Make a copy of the data to buffer
            const buffered_data = bun.default_allocator.dupe(u8, buffer) catch |err| {
                log("QuicStream.write: failed to allocate buffer memory for stream {}: {}", .{this.stream_id, err});
                if (globalObject) |globalObj| {
                    return globalObj.throwError(err, "Failed to allocate memory for write buffer");
                } else {
                    return jsc.JSValue.jsNumber(0);
                }
            };
            
            // Add to write buffer
            this.write_buffer.append(buffered_data) catch |err| {
                bun.default_allocator.free(buffered_data);
                log("QuicStream.write: failed to append to write buffer for stream {}: {}", .{this.stream_id, err});
                if (globalObject) |globalObj| {
                    return globalObj.throwError(err, "Failed to buffer write data");
                } else {
                    return jsc.JSValue.jsNumber(0);
                }
            };
            
            log("QuicStream.write: buffered {} bytes for stream {} (buffer size: {})", .{ buffer.len, this.stream_id, this.write_buffer.items.len });
            
            // Return the buffered size so caller thinks the write succeeded
            const buffered_float: f64 = @floatFromInt(buffer.len);
            return jsc.JSValue.jsNumber(buffered_float);
        }
    }

    // Buffer write data when stream is not yet connected (internal method)
    pub fn bufferWrite(this: *This, data: []const u8) !void {
        if (this.flags.is_closed) return error.StreamClosed;
        
        if (!this.write_buffer_initialized) {
            return error.BufferNotInitialized;
        }
        
        this.write_buffer_mutex.lock();
        defer this.write_buffer_mutex.unlock();
        
        // Make a copy of the data to buffer
        const buffered_data = try bun.default_allocator.dupe(u8, data);
        errdefer bun.default_allocator.free(buffered_data);
        
        // Add to write buffer
        try this.write_buffer.append(buffered_data);
        
        log("bufferWrite: buffered {} bytes for stream {} (buffer size: {})", .{ data.len, this.stream_id, this.write_buffer.items.len });
    }

    // End the stream (graceful close with FIN)
    pub fn end(this: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        if (this.flags.is_closed or this.flags.fin_sent) {
            return .js_undefined;
        }

        if (this.stream) |stream| {
            this.flags.fin_sent = true;
            _ = stream.shutdown(); // Shutdown write side
            log("QuicStream.end: sent FIN on stream {}", .{this.stream_id});
        }

        return .js_undefined;
    }

    // Close the stream immediately
    pub fn close(this: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        this.closeImpl();
        return .js_undefined;
    }

    fn closeImpl(this: *This) void {
        if (this.flags.is_closed) return;
        
        this.flags.is_closed = true;
        this.has_pending_activity.store(false, .release);

        if (this.stream) |stream| {
            // Remove from socket's stream mapping before closing
            _ = this.socket.removeStreamMapping(stream);
            
            stream.close();
            this.stream = null;
            log("QuicStream.close: closed stream {}", .{this.stream_id});
        }

        // Clear any remaining buffered writes
        if (this.write_buffer_initialized) {
            this.write_buffer_mutex.lock();
            defer this.write_buffer_mutex.unlock();
            
            for (this.write_buffer.items) |buffered_data| {
                bun.default_allocator.free(buffered_data);
            }
            this.write_buffer.clearAndFree();
        }
    }

    // Flush any buffered writes to the now-connected stream
    pub fn flushBufferedWrites(this: *This) void {
        log("flushBufferedWrites: stream_id={}, stream={*}, initialized={}, buffer_len={}", .{
            this.stream_id,
            this.stream, 
            this.write_buffer_initialized,
            if (this.write_buffer_initialized) this.write_buffer.items.len else 0
        });
        
        if (!this.write_buffer_initialized or this.stream == null) {
            log("flushBufferedWrites: early return for stream {} - not initialized or no stream", .{this.stream_id});
            return;
        }

        this.write_buffer_mutex.lock();
        defer this.write_buffer_mutex.unlock();

        const stream = this.stream.?;
        var total_written: usize = 0;
        var failed_writes: usize = 0;

        const buffer_count = this.write_buffer.items.len;
        log("flushBufferedWrites: flushing {} buffered writes to stream {*} (ID: {})", .{buffer_count, stream, this.stream_id});

        // Write all buffered data to the stream
        for (this.write_buffer.items) |buffered_data| {
            const written = stream.write(buffered_data);
            const written_usize: usize = if (written >= 0) @intCast(written) else 0;
            total_written += written_usize;
            
            if (written_usize < buffered_data.len) {
                this.flags.has_backpressure = true;
                failed_writes += 1;
                log("QuicStream.flushBufferedWrites: partial write {} of {} bytes for stream {}", .{ written_usize, buffered_data.len, this.stream_id });
            } else {
                log("QuicStream.flushBufferedWrites: wrote {} bytes for stream {}", .{ written_usize, this.stream_id });
            }
        }

        // Free the buffered data and clear the buffer
        for (this.write_buffer.items) |buffered_data| {
            bun.default_allocator.free(buffered_data);
        }
        this.write_buffer.clearRetainingCapacity();

        if (failed_writes > 0) {
            log("QuicStream.flushBufferedWrites: {} of {} buffered writes had backpressure for stream {}", .{ failed_writes, buffer_count, this.stream_id });
        } else {
            log("QuicStream.flushBufferedWrites: flushed {} buffered writes ({} total bytes) for stream {}", .{ buffer_count, total_written, this.stream_id });
        }
    }

    // JavaScript ref/unref for keeping the event loop alive
    pub fn jsRef(this: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        this.ref();
        this.poll_ref.ref(jsc.VirtualMachine.get());
        return .js_undefined;
    }

    pub fn jsUnref(this: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        this.poll_ref.unref(jsc.VirtualMachine.get());
        this.deref();
        return .js_undefined;
    }

    // Getters for JavaScript properties
    pub fn getId(this: *This, _: *jsc.JSGlobalObject) jsc.JSValue {
        const id_float: f64 = @floatFromInt(this.stream_id);
        return jsc.JSValue.jsNumber(id_float);
    }

    pub fn getSocket(this: *This, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        return this.socket.toJS(globalObject);
    }

    pub fn getData(this: *This, _: *jsc.JSGlobalObject) jsc.JSValue {
        return this.data_value;
    }

    pub fn getReadyState(this: *This, _: *jsc.JSGlobalObject) jsc.JSValue {
        if (this.flags.is_closed) {
            return jsc.JSValue.jsNumberFromChar(3); // CLOSED
        } else if (this.flags.fin_sent) {
            return jsc.JSValue.jsNumberFromChar(2); // CLOSING
        } else {
            return jsc.JSValue.jsNumberFromChar(1); // OPEN
        }
    }
};

// Import QuicSocket type
const QuicSocket = @import("quic_socket.zig").QuicSocket;