const CompressionSink = @This();

const std = @import("std");
const bun = @import("bun");
const webcore = bun.webcore;
const streams = webcore.streams;
const jsc = bun.jsc;
const Output = bun.Output;
const JSC = bun.JSC;
const JSValue = jsc.JSValue;
const Encoder = @import("./CompressionStreamEncoder.zig").Encoder;

const log = Output.scoped(.CompressionSink, false);

pub const Sink = struct {
    // Pointer to the readable side's source logic
    encoder: *Encoder,
    
    // JSSink vtable fields
    signal: streams.Signal = .{},
    has: streams.Has = .{},
    done: bool = false,
    pending: streams.Result.Writable.Pending = .{},
    bytes_written: usize = 0,
    allocator: std.mem.Allocator,
    
    pub fn connect(this: *Sink, signal: streams.Signal) void {
        this.signal = signal;
    }
    
    pub fn start(this: *Sink, stream_start: streams.Start) JSC.Maybe(void) {
        _ = stream_start;
        this.signal.start();
        return .{ .result = {} };
    }
    
    pub fn write(this: *Sink, data: streams.Result) streams.Result.Writable {
        log("write({d} bytes)", .{data.slice().len});
        
        if (this.done) {
            return .{ .done = {} };
        }
        
        const chunk = data.slice();
        if (chunk.len == 0) {
            return .{ .owned = 0 };
        }
        
        // Write to the encoder
        this.encoder.write(chunk) catch |err| {
            return .{ .err = bun.sys.Error.fromCode(.INVAL, .write) };
        };
        
        this.bytes_written += chunk.len;
        
        // Return how many bytes we consumed
        return .{ .owned = @truncate(chunk.len) };
    }
    
    pub fn writeBytes(this: *Sink, data: streams.Result) streams.Result.Writable {
        return this.write(data);
    }
    
    pub fn writeLatin1(this: *Sink, data: streams.Result) streams.Result.Writable {
        return this.write(data);
    }
    
    pub fn writeUTF16(this: *Sink, data: streams.Result) streams.Result.Writable {
        // Convert UTF16 to UTF8 first
        // For now, just treat it as bytes
        return this.write(data);
    }
    
    pub fn end(this: *Sink, err: ?bun.sys.Error) JSC.Maybe(void) {
        log("end()", .{});
        
        if (this.done) {
            return .{ .result = {} };
        }
        
        this.done = true;
        
        if (err) |e| {
            _ = e;
            // If there's an error, we should notify the encoder
            this.encoder.onCancel();
        } else {
            // Normal end - flush the encoder
            this.encoder.flush() catch |flush_err| {
                _ = flush_err;
                return .{ .err = bun.sys.Error.fromCode(.INVAL, .flush) };
            };
        }
        
        this.signal.close(err);
        
        return .{ .result = {} };
    }
    
    pub fn endFromJS(this: *Sink, globalObject: *JSC.JSGlobalObject) JSC.Maybe(JSValue) {
        _ = globalObject;
        
        log("endFromJS()", .{});
        
        if (this.done) {
            return .{ .result = .true };
        }
        
        switch (this.end(null)) {
            .err => |err| return .{ .err = err },
            .result => return .{ .result = .true },
        }
    }
    
    pub fn flush(this: *Sink) JSC.Maybe(void) {
        log("flush()", .{});
        
        // For compression stream, flush doesn't do anything special
        // The actual flushing happens in end()
        return .{ .result = {} };
    }
    
    pub fn flushFromJS(this: *Sink, globalObject: *JSC.JSGlobalObject, wait: bool) JSC.Maybe(JSValue) {
        _ = globalObject;
        _ = wait;
        
        return .{ .result = .undefined };
    }
    
    pub fn finalize(this: *Sink) void {
        log("finalize()", .{});
        
        if (!this.done) {
            this.done = true;
            this.encoder.onCancel();
        }
        
        this.pending.deinit();
        this.deref();
    }
    
    pub fn init(allocator: std.mem.Allocator, encoder: *Encoder) *Sink {
        const sink = allocator.create(Sink) catch bun.outOfMemory();
        sink.* = .{
            .encoder = encoder,
            .allocator = allocator,
        };
        return sink;
    }
    
    pub fn construct(this: *Sink, allocator: std.mem.Allocator) void {
        _ = allocator;
        _ = this;
        // This shouldn't be called for CompressionSink
        @panic("CompressionSink.construct should not be called");
    }
    
    pub fn deinit(this: *Sink) void {
        log("deinit()", .{});
        this.allocator.destroy(this);
    }
    
    // JSSink interface requirements
    pub const ref = JSC.Codegen.JSCompressionSink.ref;
    pub const deref = JSC.Codegen.JSCompressionSink.deref;
    pub const updateRef = JSC.Codegen.JSCompressionSink.updateRef;
    
    pub fn toJS(this: *Sink, globalObject: *JSC.JSGlobalObject) JSValue {
        return JSC.Codegen.JSCompressionSink.toJS(this, globalObject);
    }
    
    pub fn detach(this: *Sink) void {
        log("detach()", .{});
        
        if (!this.done) {
            this.done = true;
            this.encoder.onCancel();
        }
    }
    
    pub fn onClose(_: *Sink) void {
        log("onClose()", .{});
    }
    
    pub fn onReady(_: *Sink) void {
        log("onReady()", .{});
    }
    
    pub fn onError(this: *Sink, err: bun.sys.Error) void {
        log("onError()", .{});
        _ = this.end(err);
    }
};

pub fn CompressionSink__updateRef(ptr: *anyopaque, value: bool) callconv(.C) void {
    const sink = @as(*Sink, @ptrCast(@alignCast(ptr)));
    if (value) {
        sink.ref();
    } else {
        sink.deref();
    }
}

pub fn CompressionSink__write(
    ptr: *anyopaque,
    data: StreamResult,
    globalThis: *JSC.JSGlobalObject,
) callconv(.C) StreamResult.Writable {
    _ = globalThis;
    const sink = @as(*Sink, @ptrCast(@alignCast(ptr)));
    return sink.write(data);
}

pub fn CompressionSink__close(globalThis: *JSC.JSGlobalObject, ptr: *anyopaque) callconv(.C) void {
    _ = globalThis;
    const sink = @as(*Sink, @ptrCast(@alignCast(ptr)));
    sink.detach();
}

pub fn CompressionSink__endWithSink(ptr: *anyopaque, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
    const sink = @as(*Sink, @ptrCast(@alignCast(ptr)));
    return sink.endFromJS(globalThis).toJS(globalThis);
}

pub fn CompressionSink__flushFromJS(
    ptr: *anyopaque,
    globalThis: *JSC.JSGlobalObject,
    wait: bool,
) callconv(.C) JSValue {
    const sink = @as(*Sink, @ptrCast(@alignCast(ptr)));
    return sink.flushFromJS(globalThis, wait).toJS(globalThis);
}

pub fn CompressionSink__memoryCost(ptr: *anyopaque) callconv(.C) usize {
    const sink = @as(*Sink, @ptrCast(@alignCast(ptr)));
    return @sizeOf(Sink) + sink.bytes_written;
}

const StreamResult = webcore.StreamResult;

// Export the sink type for use in other modules
pub const CompressionStreamSink = Sink;