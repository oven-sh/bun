const CompressionStream = @This();

const std = @import("std");
const bun = @import("bun");
const webcore = bun.webcore;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CompressionStreamEncoder = @import("./CompressionStreamEncoder.zig");
const CompressionSink = @import("./CompressionSink.zig");
const DecompressionStreamEncoder = @import("./DecompressionStreamEncoder.zig");
const DecompressionSink = @import("./DecompressionSink.zig");

const log = bun.Output.scoped(.CompressionStream, false);

// Constructor implementation called from C++
pub export fn CompressionStream__construct(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) JSValue {
    const vm = globalThis.bunVM();
    const arguments = callFrame.arguments(2);
    
    // First argument is the 'this' object that was already created
    const this_value = arguments.ptr[0];
    
    // Second argument is the format parameter (optional, defaults to "gzip")
    const format_arg = if (arguments.len > 1) arguments.ptr[1] else .undefined;
    
    var format_slice: []const u8 = "gzip";
    
    if (!format_arg.isUndefined()) {
        const format_str = format_arg.getZigString(globalThis);
        if (format_str.len == 0) {
            globalThis.throwInvalidArguments("format parameter must not be empty", .{});
            return .zero;
        }
        format_slice = format_str.slice();
    }
    
    // Parse the algorithm
    const algorithm = CompressionStreamEncoder.Algorithm.fromString(format_slice) orelse {
        globalThis.throwInvalidArguments("Unsupported compression format: {s}", .{format_slice});
        return .zero;
    };
    
    // Create the encoder
    var encoder = CompressionStreamEncoder.Source.new(.{
        .globalThis = globalThis,
        .context = .{
            .ref_count = .init(),
            .allocator = bun.default_allocator,
            .state = .{ .uninit = algorithm },
            .buffer = .{},
            .pending = .{},
            .is_closed = false,
        },
    });
    
    // Create the sink and link it to the encoder
    var sink = CompressionSink.Sink.init(bun.default_allocator, &encoder.context);
    
    // Create the ReadableStream with the encoder as the native source
    const readable = encoder.toReadableStream(globalThis);
    
    // Create the WritableStream with the sink
    const writable = JSC.WebCore.WritableStream.fromSink(globalThis, sink, null);
    
    // Store the streams on the JS object using putDirectPrivate
    const names = bun.String.fromBytes;
    this_value.putDirect(globalThis.vm(), JSC.ZigString.static("readable").toIdentifier(globalThis), readable, .{ .PrivateName = true });
    this_value.putDirect(globalThis.vm(), JSC.ZigString.static("writable").toIdentifier(globalThis), writable, .{ .PrivateName = true });
    
    return this_value;
}

// DecompressionStream constructor
pub export fn DecompressionStream__construct(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) JSValue {
    const vm = globalThis.bunVM();
    const arguments = callFrame.arguments(2);
    
    // First argument is the 'this' object that was already created
    const this_value = arguments.ptr[0];
    
    // Second argument is the format parameter (optional, defaults to "gzip")
    const format_arg = if (arguments.len > 1) arguments.ptr[1] else .undefined;
    
    var format_slice: []const u8 = "gzip";
    
    if (!format_arg.isUndefined()) {
        const format_str = format_arg.getZigString(globalThis);
        if (format_str.len == 0) {
            globalThis.throwInvalidArguments("format parameter must not be empty", .{});
            return .zero;
        }
        format_slice = format_str.slice();
    }
    
    // Parse the algorithm
    const algorithm = DecompressionStreamEncoder.Algorithm.fromString(format_slice) orelse {
        globalThis.throwInvalidArguments("Unsupported decompression format: {s}", .{format_slice});
        return .zero;
    };
    
    // Create the encoder
    var encoder = DecompressionStreamEncoder.Source.new(.{
        .globalThis = globalThis,
        .context = .{
            .ref_count = .init(),
            .allocator = bun.default_allocator,
            .state = .{ .uninit = algorithm },
            .buffer = .{},
            .pending = .{},
            .is_closed = false,
        },
    });
    
    // Create the sink and link it to the encoder
    var sink = DecompressionSink.Sink.init(bun.default_allocator, &encoder.context);
    
    // Create the ReadableStream with the encoder as the native source
    const readable = encoder.toReadableStream(globalThis);
    
    // Create the WritableStream with the sink
    const writable = JSC.WebCore.WritableStream.fromSink(globalThis, sink, null);
    
    // Store the streams on the JS object using putDirectPrivate
    const names = bun.String.fromBytes;
    this_value.putDirect(globalThis.vm(), JSC.ZigString.static("readable").toIdentifier(globalThis), readable, .{ .PrivateName = true });
    this_value.putDirect(globalThis.vm(), JSC.ZigString.static("writable").toIdentifier(globalThis), writable, .{ .PrivateName = true });
    
    return this_value;
}