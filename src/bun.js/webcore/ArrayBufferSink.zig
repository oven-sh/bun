const ArrayBufferSink = @This();
pub const JSSink = webcore.Sink.JSSink(@This(), "ArrayBufferSink");

bytes: bun.ByteList,
allocator: std.mem.Allocator,
done: bool = false,
signal: Signal = .{},
next: ?Sink = null,
streaming: bool = false,
as_uint8array: bool = false,

pub fn connect(this: *ArrayBufferSink, signal: Signal) void {
    bun.assert(this.reader == null);
    this.signal = signal;
}

pub fn start(this: *ArrayBufferSink, stream_start: streams.Start) JSC.Maybe(void) {
    this.bytes.len = 0;
    var list = this.bytes.listManaged(this.allocator);
    list.clearRetainingCapacity();

    switch (stream_start) {
        .ArrayBufferSink => |config| {
            if (config.chunk_size > 0) {
                list.ensureTotalCapacityPrecise(config.chunk_size) catch return .{ .err = Syscall.Error.oom };
                this.bytes.update(list);
            }

            this.as_uint8array = config.as_uint8array;
            this.streaming = config.stream;
        },
        else => {},
    }

    this.done = false;

    this.signal.start();
    return .{ .result = {} };
}

pub fn flush(_: *ArrayBufferSink) JSC.Maybe(void) {
    return .{ .result = {} };
}

pub fn flushFromJS(this: *ArrayBufferSink, globalThis: *JSGlobalObject, wait: bool) JSC.Maybe(JSValue) {
    if (this.streaming) {
        const value: JSValue = switch (this.as_uint8array) {
            true => JSC.ArrayBuffer.create(globalThis, this.bytes.slice(), .Uint8Array),
            false => JSC.ArrayBuffer.create(globalThis, this.bytes.slice(), .ArrayBuffer),
        };
        this.bytes.len = 0;
        if (wait) {}
        return .{ .result = value };
    }

    return .{ .result = JSValue.jsNumber(0) };
}

pub fn finalize(this: *ArrayBufferSink) void {
    this.destroy();
}

pub fn init(allocator: std.mem.Allocator, next: ?Sink) !*ArrayBufferSink {
    return bun.new(ArrayBufferSink, .{
        .bytes = bun.ByteList.init(&.{}),
        .allocator = allocator,
        .next = next,
    });
}

pub fn construct(
    this: *ArrayBufferSink,
    allocator: std.mem.Allocator,
) void {
    this.* = ArrayBufferSink{
        .bytes = bun.ByteList{},
        .allocator = allocator,
        .next = null,
    };
}

pub fn write(this: *@This(), data: streams.Result) streams.Result.Writable {
    if (this.next) |*next| {
        return next.writeBytes(data);
    }

    const len = this.bytes.write(this.allocator, data.slice()) catch {
        return .{ .err = Syscall.Error.oom };
    };
    this.signal.ready(null, null);
    return .{ .owned = len };
}
pub const writeBytes = write;
pub fn writeLatin1(this: *@This(), data: streams.Result) streams.Result.Writable {
    if (this.next) |*next| {
        return next.writeLatin1(data);
    }
    const len = this.bytes.writeLatin1(this.allocator, data.slice()) catch {
        return .{ .err = Syscall.Error.oom };
    };
    this.signal.ready(null, null);
    return .{ .owned = len };
}
pub fn writeUTF16(this: *@This(), data: streams.Result) streams.Result.Writable {
    if (this.next) |*next| {
        return next.writeUTF16(data);
    }
    const len = this.bytes.writeUTF16(this.allocator, @as([*]const u16, @ptrCast(@alignCast(data.slice().ptr)))[0..std.mem.bytesAsSlice(u16, data.slice()).len]) catch {
        return .{ .err = Syscall.Error.oom };
    };
    this.signal.ready(null, null);
    return .{ .owned = len };
}

pub fn end(this: *ArrayBufferSink, err: ?Syscall.Error) JSC.Maybe(void) {
    if (this.next) |*next| {
        return next.end(err);
    }
    this.signal.close(err);
    return .{ .result = {} };
}
pub fn destroy(this: *ArrayBufferSink) void {
    this.bytes.deinitWithAllocator(this.allocator);
    bun.destroy(this);
}
pub fn toJS(this: *ArrayBufferSink, globalThis: *JSGlobalObject, as_uint8array: bool) JSValue {
    if (this.streaming) {
        const value: JSValue = switch (as_uint8array) {
            true => JSC.ArrayBuffer.create(globalThis, this.bytes.slice(), .Uint8Array),
            false => JSC.ArrayBuffer.create(globalThis, this.bytes.slice(), .ArrayBuffer),
        };
        this.bytes.len = 0;
        return value;
    }

    var list = this.bytes.listManaged(this.allocator);
    this.bytes = bun.ByteList.init("");
    return ArrayBuffer.fromBytes(
        try list.toOwnedSlice(),
        if (as_uint8array)
            .Uint8Array
        else
            .ArrayBuffer,
    ).toJS(globalThis, null);
}

pub fn endFromJS(this: *ArrayBufferSink, _: *JSGlobalObject) JSC.Maybe(ArrayBuffer) {
    if (this.done) {
        return .{ .result = ArrayBuffer.fromBytes(&[_]u8{}, .ArrayBuffer) };
    }

    bun.assert(this.next == null);
    var list = this.bytes.listManaged(this.allocator);
    this.bytes = bun.ByteList.init("");
    this.done = true;
    this.signal.close(null);
    return .{ .result = ArrayBuffer.fromBytes(
        list.toOwnedSlice() catch bun.outOfMemory(),
        if (this.as_uint8array)
            .Uint8Array
        else
            .ArrayBuffer,
    ) };
}

pub fn sink(this: *ArrayBufferSink) Sink {
    return Sink.init(this);
}

pub fn memoryCost(this: *const ArrayBufferSink) usize {
    // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
    return this.bytes.cap;
}

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const Syscall = bun.sys;
const Sink = webcore.Sink;
const webcore = bun.webcore;
const streams = webcore.streams;
const Signal = webcore.streams.Signal;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const ArrayBuffer = JSC.ArrayBuffer;
