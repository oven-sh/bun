const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const bun = @import("../../../global.zig");
const RequestContext = @import("../../../http.zig").RequestContext;
const MimeType = @import("../../../http.zig").MimeType;
const ZigURL = @import("../../../url.zig").URL;
const HTTPClient = @import("http");
const NetworkThread = HTTPClient.NetworkThread;
const AsyncIO = NetworkThread.AsyncIO;
const JSC = @import("javascript_core");
const js = JSC.C;

const Method = @import("../../../http/method.zig").Method;
const FetchHeaders = JSC.FetchHeaders;
const ObjectPool = @import("../../../pool.zig").ObjectPool;
const SystemError = JSC.SystemError;
const Output = @import("../../../global.zig").Output;
const MutableString = @import("../../../global.zig").MutableString;
const strings = @import("../../../global.zig").strings;
const string = @import("../../../global.zig").string;
const default_allocator = @import("../../../global.zig").default_allocator;
const FeatureFlags = @import("../../../global.zig").FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const NewClass = @import("../base.zig").NewClass;
const d = @import("../base.zig").d;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../../env.zig");
const ZigString = JSC.ZigString;
const IdentityContext = @import("../../../identity_context.zig").IdentityContext;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;

const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const Task = JSC.Task;
const JSPrinter = @import("../../../js_printer.zig");
const picohttp = @import("picohttp");
const StringJoiner = @import("../../../string_joiner.zig");
const uws = @import("uws");
const Blob = JSC.WebCore.Blob;
const Response = JSC.WebCore.Response;
const Request = JSC.WebCore.Request;

pub const ReadableStream = struct {
    value: JSValue,
    ptr: Handle,

    pub fn done(this: *const ReadableStream) void {
        this.value.unprotect();
    }

    pub const Tag = enum(i32) {
        Invalid = -1,

        JavaScript = 0,
        Blob = 1,
        File = 2,
        HTTPRequest = 3,
        HTTPSRequest = 4,
    };
    pub const Handle = union(Tag) {
        Invalid: void,
        JavaScript: void,
        Blob: *ByteBlobLoader,
        File: *FileBlobLoader,
        HTTPRequest: void,
        HTTPSRequest: void,
    };

    extern fn ReadableStreamTag__tagged(globalObject: *JSGlobalObject, possibleReadableStream: JSValue, ptr: *JSValue) Tag;
    extern fn ReadableStream__isDisturbed(possibleReadableStream: JSValue, globalObject: *JSGlobalObject) bool;
    extern fn ReadableStream__isLocked(possibleReadableStream: JSValue, globalObject: *JSGlobalObject) bool;
    extern fn ReadableStream__empty(*JSGlobalObject) JSC.JSValue;
    extern fn ReadableStream__fromBlob(
        *JSGlobalObject,
        store: *anyopaque,
        offset: usize,
        length: usize,
    ) JSC.JSValue;

    pub fn isDisturbed(this: *const ReadableStream, globalObject: *JSGlobalObject) bool {
        JSC.markBinding();
        return ReadableStream__isDisturbed(this.value, globalObject);
    }

    pub fn isLocked(this: *const ReadableStream, globalObject: *JSGlobalObject) bool {
        JSC.markBinding();
        return ReadableStream__isLocked(this.value, globalObject);
    }

    pub fn fromJS(value: JSValue, globalThis: *JSGlobalObject) ?ReadableStream {
        JSC.markBinding();
        var ptr = JSValue.zero;
        return switch (ReadableStreamTag__tagged(globalThis, value, &ptr)) {
            .JavaScript => ReadableStream{
                .value = value,
                .ptr = .{
                    .JavaScript = {},
                },
            },
            .Blob => ReadableStream{
                .value = value,
                .ptr = .{
                    .Blob = ptr.asPtr(ByteBlobLoader),
                },
            },
            .File => ReadableStream{
                .value = value,
                .ptr = .{
                    .File = ptr.asPtr(FileBlobLoader),
                },
            },
            else => null,
        };
    }

    extern fn ZigGlobalObject__createNativeReadableStream(*JSGlobalObject, nativePtr: JSValue, nativeType: JSValue) JSValue;

    pub fn fromNative(globalThis: *JSGlobalObject, id: Tag, ptr: *anyopaque) JSC.JSValue {
        return ZigGlobalObject__createNativeReadableStream(globalThis, JSValue.fromPtr(ptr), JSValue.jsNumber(@enumToInt(id)));
    }
    pub fn fromBlob(globalThis: *JSGlobalObject, blob: *const Blob, recommended_chunk_size: Blob.SizeType) JSC.JSValue {
        if (comptime JSC.is_bindgen)
            unreachable;
        var store = blob.store orelse {
            return ReadableStream.empty(globalThis);
        };
        switch (store.data) {
            .bytes => {
                var reader = bun.default_allocator.create(ByteBlobLoader.Source) catch unreachable;
                reader.* = .{
                    .context = undefined,
                };
                reader.context.setup(blob, recommended_chunk_size);
                return reader.toJS(globalThis);
            },
            .file => {
                var reader = bun.default_allocator.create(FileBlobLoader.Source) catch unreachable;
                reader.* = .{
                    .context = undefined,
                };
                reader.context.setup(store, recommended_chunk_size);
                return reader.toJS(globalThis);
            },
        }
    }

    pub fn empty(globalThis: *JSGlobalObject) JSC.JSValue {
        if (comptime JSC.is_bindgen)
            unreachable;

        return ReadableStream__empty(globalThis);
    }

    const Base = @import("../../../ast/base.zig");
    pub const StreamTag = enum(usize) {
        invalid = 0,
        _,

        pub fn init(filedes: JSC.Node.FileDescriptor) StreamTag {
            var bytes = [8]u8{ 1, 0, 0, 0, 0, 0, 0, 0 };
            const filedes_ = @bitCast([8]u8, @as(usize, @truncate(u56, @intCast(usize, filedes))));
            bytes[1..8].* = filedes_[0..7].*;

            return @intToEnum(StreamTag, @bitCast(u64, bytes));
        }

        pub fn fd(this: StreamTag) JSC.Node.FileDescriptor {
            var bytes = @bitCast([8]u8, @enumToInt(this));
            if (bytes[0] != 1) {
                return std.math.maxInt(JSC.Node.FileDescriptor);
            }
            var out: u64 = 0;
            @bitCast([8]u8, out)[0..7].* = bytes[1..8].*;
            return @intCast(JSC.Node.FileDescriptor, out);
        }
    };

    pub fn NewNativeReader(
        comptime Context: type,
        comptime onEnqueue: anytype,
        comptime onEnqueueMany: anytype,
        comptime onClose: anytype,
        comptime onError: anytype,
        comptime name_: []const u8,
    ) type {
        return struct {
            pub const JSReadableStreamReaderNative = struct {
                pub const shim = JSC.Shimmer(std.mem.span(name_), "JSReadableStreamReaderNative", @This());
                pub const tag = Context.tag;
                pub const name = std.fmt.comptimePrint("{s}_JSReadableStreamReaderNative", .{std.mem.span(name_)});

                pub fn enqueue(globalThis: *JSGlobalObject, callframe: *const JSC.CallFrame) callconv(.C) JSC.JSValue {
                    var this = callframe.argument(0).asPtr(*Context);
                    var buffer = callframe.argument(1).asArrayBuffer(globalThis) orelse {
                        globalThis.vm().throwError(globalThis, JSC.toInvalidArguments("Expected TypedArray or ArrayBuffer", .{}, globalThis));
                        return JSC.JSValue.jsUndefined();
                    };
                    return onEnqueue(this, globalThis, buffer.slice(), callframe.argument(1));
                }

                pub fn enqueueMany(globalThis: *JSGlobalObject, callframe: *const JSC.CallFrame) callconv(.C) JSC.JSValue {
                    var this = callframe.argument(0).asPtr(*Context);
                    return onEnqueueMany(this, globalThis, callframe.argument(1));
                }

                pub fn close(globalThis: *JSGlobalObject, callframe: *const JSC.CallFrame) callconv(.C) JSC.JSValue {
                    var this = callframe.argument(0).asPtr(*Context);
                    return onClose(this, globalThis, callframe.argument(1));
                }

                pub fn @"error"(globalThis: *JSGlobalObject, callframe: *const JSC.CallFrame) callconv(.C) JSC.JSValue {
                    var this = callframe.argument(0).asPtr(*Context);
                    return onError(this, globalThis, callframe.argument(1));
                }

                pub fn load(globalThis: *JSGlobalObject) callconv(.C) JSC.JSValue {
                    if (comptime JSC.is_bindgen) unreachable;
                    if (comptime Environment.allow_assert) {
                        // this should be cached per globals object
                        const OnlyOnce = struct {
                            pub threadlocal var last_globals: ?*JSGlobalObject = null;
                        };
                        if (OnlyOnce.last_globals) |last_globals| {
                            std.debug.assert(last_globals != globalThis);
                        }
                        OnlyOnce.last_globals = globalThis;
                    }
                    return JSC.JSArray.from(globalThis, &.{
                        JSC.NewFunction(globalThis, null, 2, JSReadableStreamReaderNative.enqueue),
                        JSC.NewFunction(globalThis, null, 2, JSReadableStreamReaderNative.enqueueMany),
                        JSC.NewFunction(globalThis, null, 2, JSReadableStreamReaderNative.close),
                        JSC.NewFunction(globalThis, null, 2, JSReadableStreamReaderNative.@"error"),
                    });
                }

                pub const Export = shim.exportFunctions(.{
                    .@"load" = load,
                });

                comptime {
                    if (!JSC.is_bindgen) {
                        @export(load, .{ .name = Export[0].symbol_name });
                        _ = JSReadableStreamReaderNative.enqueue;
                        _ = JSReadableStreamReaderNative.enqueueMany;
                        _ = JSReadableStreamReaderNative.close;
                        _ = JSReadableStreamReaderNative.@"error";
                    }
                }
            };
        };
    }
};

pub const StreamStart = union(enum) {
    empty: void,
    err: JSC.Node.Syscall.Error,
    chunk_size: Blob.SizeType,
    ready: void,
};

pub const StreamResult = union(enum) {
    owned: bun.ByteList,
    owned_and_done: bun.ByteList,
    temporary_and_done: bun.ByteList,
    temporary: bun.ByteList,
    into_array: IntoArray,
    into_array_and_done: IntoArray,
    pending: *Pending,
    err: JSC.Node.Syscall.Error,
    done: void,

    pub const IntoArray = struct {
        value: JSValue = JSValue.zero,
        len: Blob.SizeType = std.math.maxInt(Blob.SizeType),
    };

    pub const Pending = struct {
        frame: anyframe,
        result: StreamResult,
        used: bool = false,
    };

    pub fn isDone(this: *const StreamResult) bool {
        return switch (this.*) {
            .owned_and_done, .temporary_and_done, .into_array_and_done, .done, .err => true,
            else => false,
        };
    }

    fn toPromisedWrap(globalThis: *JSGlobalObject, promise: *JSPromise, pending: *Pending) void {
        suspend {}

        pending.used = true;
        const result: StreamResult = pending.result;

        switch (result) {
            .err => |err| {
                promise.reject(globalThis, err.toJSC(globalThis));
            },
            .done => {
                promise.resolve(globalThis, JSValue.jsBoolean(false));
            },
            else => {
                promise.resolve(globalThis, result.toJS(globalThis));
            },
        }
    }

    pub fn toPromised(globalThis: *JSGlobalObject, promise: *JSPromise, pending: *Pending) void {
        var frame = bun.default_allocator.create(@Frame(toPromisedWrap)) catch unreachable;
        frame.* = async toPromisedWrap(globalThis, promise, pending);
        pending.frame = frame;
    }

    pub fn toJS(this: *const StreamResult, globalThis: *JSGlobalObject) JSValue {
        switch (this.*) {
            .owned => |list| {
                return JSC.ArrayBuffer.fromBytes(list.slice(), .Uint8Array).toJS(globalThis.ref(), null);
            },
            .owned_and_done => |list| {
                return JSC.ArrayBuffer.fromBytes(list.slice(), .Uint8Array).toJS(globalThis.ref(), null);
            },
            .temporary => |temp| {
                var array = JSC.JSValue.createUninitializedUint8Array(globalThis, temp.len);
                var slice = array.asArrayBuffer(globalThis).?.slice();
                @memcpy(slice.ptr, temp.ptr, temp.len);
                return array;
            },
            .temporary_and_done => |temp| {
                var array = JSC.JSValue.createUninitializedUint8Array(globalThis, temp.len);
                var slice = array.asArrayBuffer(globalThis).?.slice();
                @memcpy(slice.ptr, temp.ptr, temp.len);
                return array;
            },
            .into_array => |array| {
                return JSC.JSValue.jsNumberFromInt64(array.len);
            },
            .into_array_and_done => |array| {
                return JSC.JSValue.jsNumberFromInt64(array.len);
            },
            .pending => |pending| {
                var promise = JSC.JSPromise.create(globalThis);
                toPromised(globalThis, promise, pending);
                return promise.asValue(globalThis);
            },

            .err => |err| {
                return JSC.JSPromise.rejectedPromise(globalThis, JSValue.c(err.toJS(globalThis.ref()))).asValue(globalThis);
            },

            // false == controller.close()
            // undefined == noop, but we probably won't send it
            .done => {
                return JSC.JSValue.jsBoolean(false);
            },
        }
    }
};

pub fn WritableStreamSink(
    comptime Context: type,
    comptime onStart: ?fn (this: Context) void,
    comptime onWrite: fn (this: Context, bytes: []const u8) JSC.Maybe(Blob.SizeType),
    comptime onAbort: ?fn (this: Context) void,
    comptime onClose: ?fn (this: Context) void,
    comptime deinit: ?fn (this: Context) void,
) type {
    return struct {
        context: Context,
        closed: bool = false,
        deinited: bool = false,
        pending_err: ?JSC.Node.Syscall.Error = null,
        aborted: bool = false,

        abort_signaler: ?*anyopaque = null,
        onAbortCallback: ?fn (?*anyopaque) void = null,

        close_signaler: ?*anyopaque = null,
        onCloseCallback: ?fn (?*anyopaque) void = null,

        pub const This = @This();

        pub fn write(this: *This, bytes: []const u8) JSC.Maybe(Blob.SizeType) {
            if (this.pending_err) |err| {
                this.pending_err = null;
                return .{ .err = err };
            }

            if (this.closed or this.aborted or this.deinited) {
                return .{ .result = 0 };
            }
            return onWrite(&this.context, bytes);
        }

        pub fn start(this: *This) StreamStart {
            return onStart(&this.context);
        }

        pub fn abort(this: *This) void {
            if (this.closed or this.deinited or this.aborted) {
                return;
            }

            this.aborted = true;
            onAbort(&this.context);
        }

        pub fn didAbort(this: *This) void {
            if (this.closed or this.deinited or this.aborted) {
                return;
            }
            this.aborted = true;

            if (this.onAbortCallback) |cb| {
                this.onAbortCallback = null;
                cb(this.abort_signaler);
            }
        }

        pub fn didClose(this: *This) void {
            if (this.closed or this.deinited or this.aborted) {
                return;
            }
            this.closed = true;

            if (this.onCloseCallback) |cb| {
                this.onCloseCallback = null;
                cb(this.close_signaler);
            }
        }

        pub fn close(this: *This) void {
            if (this.closed or this.deinited or this.aborted) {
                return;
            }

            this.closed = true;
            onClose(this.context);
        }

        pub fn deinit(this: *This) void {
            if (this.deinited) {
                return;
            }
            this.deinited = true;
            deinit(this.context);
        }

        pub fn getError(this: *This) ?JSC.Node.Syscall.Error {
            if (this.pending_err) |err| {
                this.pending_err = null;
                return err;
            }

            return null;
        }
    };
}

pub fn HTTPServerWritable(comptime ssl: bool) type {
    return struct {
        pub const UWSResponse = uws.NewApp(ssl).Response;
        res: *UWSResponse,
        pending_chunk: []const u8 = "",
        is_listening_for_abort: bool = false,
        wrote: Blob.SizeType = 0,
        callback: anyframe->JSC.Maybe(Blob.SizeType) = undefined,
        writable: Writable,

        pub fn onWritable(this: *@This(), available: c_ulong, _: *UWSResponse) callconv(.C) bool {
            const to_write = @minimum(@truncate(Blob.SizeType, available), @truncate(Blob.SizeType, this.pending_chunk.len));
            if (!this.res.write(this.pending_chunk[0..to_write])) {
                return true;
            }

            this.pending_chunk = this.pending_chunk[to_write..];
            this.wrote += to_write;
            if (this.pending_chunk.len > 0) {
                this.res.onWritable(*@This(), onWritable, this);
                return true;
            }

            var callback = this.callback;
            this.callback = undefined;
            // TODO: clarify what the boolean means
            resume callback;
            bun.default_allocator.destroy(callback.*);
            return false;
        }

        pub fn onStart(this: *@This()) void {
            if (this.res.hasResponded()) {
                this.writable.didClose();
            }
        }
        pub fn onWrite(this: *@This(), bytes: []const u8) JSC.Maybe(Blob.SizeType) {
            if (this.writable.aborted) {
                return .{ .result = 0 };
            }

            if (this.pending_chunk.len > 0) {
                return JSC.Maybe(Blob.SizeType).retry;
            }

            if (this.res.write(bytes)) {
                return .{ .result = @truncate(Blob.SizeType, bytes.len) };
            }

            this.pending_chunk = bytes;
            this.writable.pending_err = null;
            suspend {
                if (!this.is_listening_for_abort) {
                    this.is_listening_for_abort = true;
                    this.res.onAborted(*@This(), onAborted);
                }

                this.res.onWritable(*@This(), onWritable, this);
                var frame = bun.default_allocator.create(@TypeOf(@Frame(onWrite))) catch unreachable;
                this.callback = frame;
                frame.* = @frame().*;
            }
            const wrote = this.wrote;
            this.wrote = 0;
            if (this.writable.pending_err) |err| {
                this.writable.pending_err = null;
                return .{ .err = err };
            }
            return .{ .result = wrote };
        }

        // client-initiated
        pub fn onAborted(this: *@This(), _: *UWSResponse) void {
            this.writable.didAbort();
        }
        // writer-initiated
        pub fn onAbort(this: *@This()) void {
            this.res.end("", true);
        }
        pub fn onClose(this: *@This()) void {
            this.res.end("", false);
        }
        pub fn deinit(_: *@This()) void {}

        pub const Writable = WritableStreamSink(@This(), onStart, onWrite, onAbort, onClose, deinit);
    };
}
pub const HTTPSWriter = HTTPServerWritable(true);
pub const HTTPWriter = HTTPServerWritable(false);

pub fn ReadableStreamSource(
    comptime Context: type,
    comptime name_: []const u8,
    comptime onStart: anytype,
    comptime onPull: anytype,
    comptime onCancel: fn (this: *Context) void,
    comptime deinit: fn (this: *Context) void,
) type {
    return struct {
        context: Context,
        cancelled: bool = false,
        deinited: bool = false,
        pending_err: ?JSC.Node.Syscall.Error = null,
        close_handler: ?fn (*anyopaque) void = null,
        close_ctx: ?*anyopaque = null,
        close_jsvalue: JSValue = JSValue.zero,
        globalThis: *JSGlobalObject = undefined,

        const This = @This();
        const ReadableStreamSourceType = @This();

        pub fn pull(this: *This, buf: []u8) StreamResult {
            return onPull(&this.context, buf, JSValue.zero);
        }

        pub fn start(
            this: *This,
        ) StreamStart {
            return onStart(&this.context);
        }

        pub fn pullFromJS(this: *This, buf: []u8, view: JSValue) StreamResult {
            return onPull(&this.context, buf, view);
        }

        pub fn startFromJS(this: *This) StreamStart {
            return onStart(&this.context);
        }

        pub fn cancel(this: *This) void {
            if (this.cancelled or this.deinited) {
                return;
            }

            this.cancelled = true;
            onCancel(&this.context);
        }

        pub fn onClose(this: *This) void {
            if (this.cancelled or this.deinited) {
                return;
            }

            if (this.close_handler) |close| {
                this.close_handler = null;
                close(this.close_ctx);
            }
        }

        pub fn deinit(this: *This) void {
            if (this.deinited) {
                return;
            }
            this.deinited = true;
            deinit(&this.context);
        }

        pub fn getError(this: *This) ?JSC.Node.Syscall.Error {
            if (this.pending_err) |err| {
                this.pending_err = null;
                return err;
            }

            return null;
        }

        pub fn toJS(this: *ReadableStreamSourceType, globalThis: *JSGlobalObject) JSC.JSValue {
            return ReadableStream.fromNative(globalThis, Context.tag, this);
        }

        pub const JSReadableStreamSource = struct {
            pub const shim = JSC.Shimmer(std.mem.span(name_), "JSReadableStreamSource", @This());
            pub const name = std.fmt.comptimePrint("{s}_JSReadableStreamSource", .{std.mem.span(name_)});

            pub fn pull(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                var this = callFrame.argument(0).asPtr(ReadableStreamSourceType);
                const view = callFrame.argument(1);
                view.ensureStillAlive();
                var buffer = view.asArrayBuffer(globalThis) orelse return JSC.JSValue.jsUndefined();
                return processResult(
                    globalThis,
                    callFrame,
                    this.pullFromJS(buffer.slice(), view),
                );
            }
            pub fn start(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                var this = callFrame.argument(0).asPtr(ReadableStreamSourceType);
                switch (this.startFromJS()) {
                    .empty => return JSValue.jsNumber(0),
                    .ready => return JSValue.jsNumber(16384),
                    .chunk_size => |size| return JSValue.jsNumber(size),
                    .err => |err| {
                        globalThis.vm().throwError(globalThis, err.toJSC(globalThis));
                        return JSC.JSValue.jsUndefined();
                    },
                }
            }

            pub fn processResult(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame, result: StreamResult) JSC.JSValue {
                switch (result) {
                    .err => |err| {
                        globalThis.vm().throwError(globalThis, err.toJSC(globalThis));
                        return JSValue.jsUndefined();
                    },
                    .temporary_and_done, .owned_and_done, .into_array_and_done => {
                        JSC.C.JSObjectSetPropertyAtIndex(globalThis.ref(), callFrame.argument(2).asObjectRef(), 0, JSValue.jsBoolean(true).asObjectRef(), null);
                        return result.toJS(globalThis);
                    },
                    else => return result.toJS(globalThis),
                }
            }
            pub fn cancel(_: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                var this = callFrame.argument(0).asPtr(ReadableStreamSourceType);
                this.cancel();
                return JSC.JSValue.jsUndefined();
            }
            pub fn setClose(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                var this = callFrame.argument(0).asPtr(ReadableStreamSourceType);
                this.close_ctx = this;
                this.close_handler = JSReadableStreamSource.onClose;
                this.globalThis = globalThis;
                this.close_jsvalue = callFrame.argument(1);
                return JSC.JSValue.jsUndefined();
            }

            fn onClose(ptr: *anyopaque) void {
                var this = bun.cast(*ReadableStreamSourceType, ptr);
                _ = this.close_jsvalue.call(this.globalThis, &.{});
                //    this.closer
            }

            pub fn deinit(_: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                var this = callFrame.argument(0).asPtr(ReadableStreamSourceType);
                this.deinit();
                return JSValue.jsUndefined();
            }

            pub fn load(globalThis: *JSGlobalObject) callconv(.C) JSC.JSValue {
                if (comptime JSC.is_bindgen) unreachable;
                if (comptime Environment.allow_assert) {
                    // this should be cached per globals object
                    const OnlyOnce = struct {
                        pub threadlocal var last_globals: ?*JSGlobalObject = null;
                    };
                    if (OnlyOnce.last_globals) |last_globals| {
                        std.debug.assert(last_globals != globalThis);
                    }
                    OnlyOnce.last_globals = globalThis;
                }
                return JSC.JSArray.from(globalThis, &.{
                    JSC.NewFunction(globalThis, null, 1, JSReadableStreamSource.pull),
                    JSC.NewFunction(globalThis, null, 1, JSReadableStreamSource.start),
                    JSC.NewFunction(globalThis, null, 1, JSReadableStreamSource.cancel),
                    JSC.NewFunction(globalThis, null, 1, JSReadableStreamSource.setClose),
                    JSC.NewFunction(globalThis, null, 1, JSReadableStreamSource.deinit),
                });
            }

            pub const Export = shim.exportFunctions(.{
                .@"load" = load,
            });

            comptime {
                if (!JSC.is_bindgen) {
                    @export(load, .{ .name = Export[0].symbol_name });
                    _ = JSReadableStreamSource.pull;
                    _ = JSReadableStreamSource.start;
                    _ = JSReadableStreamSource.cancel;
                    _ = JSReadableStreamSource.setClose;
                    _ = JSReadableStreamSource.load;
                }
            }
        };
    };
}

pub const ByteBlobLoader = struct {
    offset: Blob.SizeType = 0,
    store: *Blob.Store,
    chunk_size: Blob.SizeType = 1024 * 1024 * 2,
    remain: Blob.SizeType = 1024 * 1024 * 2,
    done: bool = false,

    pub const tag = ReadableStream.Tag.Blob;

    pub fn setup(
        this: *ByteBlobLoader,
        blob: *const Blob,
        user_chunk_size: Blob.SizeType,
    ) void {
        blob.store.?.ref();
        var blobe = blob.*;
        blobe.resolveSize();
        this.* = ByteBlobLoader{
            .offset = blobe.offset,
            .store = blobe.store.?,
            .chunk_size = if (user_chunk_size > 0) @minimum(user_chunk_size, blobe.size) else @minimum(1024 * 1024 * 2, blobe.size),
            .remain = blobe.size,
            .done = false,
        };
    }

    pub fn onStart(this: *ByteBlobLoader) StreamStart {
        return .{ .chunk_size = this.chunk_size };
    }

    pub fn onPull(this: *ByteBlobLoader, buffer: []u8, array: JSC.JSValue) StreamResult {
        array.ensureStillAlive();
        defer array.ensureStillAlive();
        if (this.done) {
            return .{ .done = {} };
        }

        var temporary = this.store.sharedView();
        temporary = temporary[this.offset..];

        temporary = temporary[0..@minimum(buffer.len, @minimum(temporary.len, this.remain))];
        if (temporary.len == 0) {
            this.store.deref();
            this.done = true;
            return .{ .done = {} };
        }

        const copied = @intCast(Blob.SizeType, temporary.len);

        this.remain -|= copied;
        this.offset +|= copied;
        @memcpy(buffer.ptr, temporary.ptr, temporary.len);
        if (this.remain == 0) {
            return .{ .into_array_and_done = .{ .value = array, .len = copied } };
        }

        return .{ .into_array = .{ .value = array, .len = copied } };
    }

    pub fn onCancel(_: *ByteBlobLoader) void {}

    pub fn deinit(this: *ByteBlobLoader) void {
        if (!this.done) {
            this.done = true;
            this.store.deref();
        }

        bun.default_allocator.destroy(this);
    }

    pub const Source = ReadableStreamSource(@This(), "ByteBlob", onStart, onPull, onCancel, deinit);
};

pub fn RequestBodyStreamer(
    comptime is_ssl: bool,
) type {
    return struct {
        response: *uws.NewApp(is_ssl).Response,

        pub const tag = if (is_ssl)
            ReadableStream.Tag.HTTPRequest
        else if (is_ssl)
            ReadableStream.Tag.HTTPSRequest;

        pub fn setup(
            this: *ByteBlobLoader,
            blob: *const Blob,
            user_chunk_size: Blob.SizeType,
        ) void {
            blob.store.?.ref();
            var blobe = blob.*;
            blobe.resolveSize();
            this.* = ByteBlobLoader{
                .offset = blobe.offset,
                .store = blobe.store.?,
                .chunk_size = if (user_chunk_size > 0) @minimum(user_chunk_size, blobe.size) else @minimum(1024 * 1024 * 2, blobe.size),
                .remain = blobe.size,
                .done = false,
            };
        }

        pub fn onStart(this: *ByteBlobLoader) StreamStart {
            return .{ .chunk_size = this.chunk_size };
        }

        pub fn onPull(this: *ByteBlobLoader, buffer: []u8, array: JSC.JSValue) StreamResult {
            array.ensureStillAlive();
            defer array.ensureStillAlive();
            if (this.done) {
                return .{ .done = {} };
            }

            var temporary = this.store.sharedView();
            temporary = temporary[this.offset..];

            temporary = temporary[0..@minimum(buffer.len, @minimum(temporary.len, this.remain))];
            if (temporary.len == 0) {
                this.store.deref();
                this.done = true;
                return .{ .done = {} };
            }

            const copied = @intCast(Blob.SizeType, temporary.len);

            this.remain -|= copied;
            this.offset +|= copied;
            @memcpy(buffer.ptr, temporary.ptr, temporary.len);
            if (this.remain == 0) {
                return .{ .into_array_and_done = .{ .value = array, .len = copied } };
            }

            return .{ .into_array = .{ .value = array, .len = copied } };
        }

        pub fn onCancel(_: *ByteBlobLoader) void {}

        pub fn deinit(this: *ByteBlobLoader) void {
            if (!this.done) {
                this.done = true;
                this.store.deref();
            }

            bun.default_allocator.destroy(this);
        }

        pub const label = if (is_ssl) "HTTPSRequestBodyStreamer" else "HTTPRequestBodyStreamer";
        pub const Source = ReadableStreamSource(@This(), label, onStart, onPull, onCancel, deinit);
    };
}

pub const FileBlobLoader = struct {
    buf: []u8 = &[_]u8{},
    protected_view: JSC.JSValue = JSC.JSValue.zero,
    fd: JSC.Node.FileDescriptor = 0,
    auto_close: bool = false,
    loop: *JSC.EventLoop = undefined,
    mode: JSC.Node.Mode = 0,
    store: *Blob.Store,
    total_read: Blob.SizeType = 0,
    finalized: bool = false,
    callback: anyframe = undefined,
    pending: StreamResult.Pending = StreamResult.Pending{
        .frame = undefined,
        .used = false,
        .result = .{ .done = {} },
    },
    cancelled: bool = false,
    user_chunk_size: Blob.SizeType = 0,
    scheduled_count: u32 = 0,
    concurrent: Concurrent = Concurrent{},

    const FileReader = @This();

    const run_on_different_thread_size = bun.huge_allocator_threshold;

    pub const tag = ReadableStream.Tag.File;

    pub fn setup(this: *FileBlobLoader, store: *Blob.Store, chunk_size: Blob.SizeType) void {
        store.ref();
        this.* = .{
            .loop = JSC.VirtualMachine.vm.eventLoop(),
            .auto_close = store.data.file.pathlike == .path,
            .store = store,
            .user_chunk_size = chunk_size,
        };
    }

    pub fn watch(this: *FileReader) void {
        _ = JSC.VirtualMachine.vm.poller.watch(this.fd, .read, this, callback);
        this.scheduled_count += 1;
    }

    const Concurrent = struct {
        read: Blob.SizeType = 0,
        task: NetworkThread.Task = .{ .callback = Concurrent.taskCallback },
        completion: AsyncIO.Completion = undefined,
        read_frame: anyframe = undefined,
        chunk_size: Blob.SizeType = 0,
        main_thread_task: JSC.AnyTask = .{ .callback = onJSThread, .ctx = null },

        pub fn taskCallback(task: *NetworkThread.Task) void {
            var this = @fieldParentPtr(FileBlobLoader, "concurrent", @fieldParentPtr(Concurrent, "task", task));
            var frame = HTTPClient.getAllocator().create(@Frame(runAsync)) catch unreachable;
            _ = @asyncCall(std.mem.asBytes(frame), undefined, runAsync, .{this});
        }

        pub fn onRead(this: *FileBlobLoader, completion: *HTTPClient.NetworkThread.Completion, result: AsyncIO.ReadError!usize) void {
            this.concurrent.read = @truncate(Blob.SizeType, result catch |err| {
                if (@hasField(HTTPClient.NetworkThread.Completion, "result")) {
                    this.pending.result = .{
                        .err = JSC.Node.Syscall.Error{
                            .errno = @intCast(JSC.Node.Syscall.Error.Int, -completion.result),
                            .syscall = .read,
                        },
                    };
                } else {
                    this.pending.result = .{
                        .err = JSC.Node.Syscall.Error{
                            // this is too hacky
                            .errno = @truncate(JSC.Node.Syscall.Error.Int, @intCast(u16, @maximum(1, @errorToInt(err)))),
                            .syscall = .read,
                        },
                    };
                }
                this.concurrent.read = 0;
                resume this.concurrent.read_frame;
                return;
            });

            resume this.concurrent.read_frame;
        }

        pub fn scheduleRead(this: *FileBlobLoader) void {
            if (comptime Environment.isMac) {
                var remaining = this.buf[this.concurrent.read..];

                while (remaining.len > 0) {
                    const to_read = @minimum(@as(usize, this.concurrent.chunk_size), remaining.len);
                    switch (JSC.Node.Syscall.read(this.fd, remaining[0..to_read])) {
                        .err => |err| {
                            const retry = comptime if (Environment.isLinux)
                                std.os.E.WOULDBLOCK
                            else
                                std.os.E.AGAIN;

                            switch (err.getErrno()) {
                                retry => break,
                                else => {},
                            }

                            this.pending.result = .{ .err = err };
                            scheduleMainThreadTask(this);
                            return;
                        },
                        .result => |result| {
                            this.concurrent.read += @intCast(Blob.SizeType, result);
                            remaining = remaining[result..];

                            if (result == 0) {
                                remaining.len = 0;
                                break;
                            }
                        },
                    }
                }

                if (remaining.len == 0) {
                    scheduleMainThreadTask(this);
                    return;
                }
            }

            AsyncIO.global.read(
                *FileBlobLoader,
                this,
                onRead,
                &this.concurrent.completion,
                this.fd,
                this.buf[this.concurrent.read..],
                null,
            );

            suspend {
                var _frame = @frame();
                var this_frame = HTTPClient.getAllocator().create(std.meta.Child(@TypeOf(_frame))) catch unreachable;
                this_frame.* = _frame.*;
                this.concurrent.read_frame = this_frame;
            }

            scheduleMainThreadTask(this);
        }

        pub fn onJSThread(task_ctx: *anyopaque) void {
            var this: *FileBlobLoader = bun.cast(*FileBlobLoader, task_ctx);
            const protected_view = this.protected_view;
            defer protected_view.unprotect();
            this.protected_view = JSC.JSValue.zero;

            if (this.finalized and this.scheduled_count == 0) {
                if (!this.pending.used) {
                    resume this.pending.frame;
                }
                this.scheduled_count -= 1;

                this.deinit();

                return;
            }

            if (!this.pending.used and this.pending.result == .err and this.concurrent.read == 0) {
                resume this.pending.frame;
                this.scheduled_count -= 1;
                this.finalize();
                return;
            }

            if (this.concurrent.read == 0) {
                this.pending.result = .{ .done = {} };
                resume this.pending.frame;
                this.scheduled_count -= 1;
                this.finalize();
                return;
            }

            this.pending.result = this.handleReadChunk(@as(usize, this.concurrent.read));
            resume this.pending.frame;
            this.scheduled_count -= 1;
            if (this.pending.result.isDone()) {
                this.finalize();
            }
        }

        pub fn scheduleMainThreadTask(this: *FileBlobLoader) void {
            this.concurrent.main_thread_task.ctx = this;
            this.loop.enqueueTaskConcurrent(JSC.Task.init(&this.concurrent.main_thread_task));
        }

        fn runAsync(this: *FileBlobLoader) void {
            this.concurrent.read = 0;

            Concurrent.scheduleRead(this);

            suspend {
                HTTPClient.getAllocator().destroy(@frame());
            }
        }
    };

    pub fn scheduleAsync(this: *FileReader, chunk_size: Blob.SizeType) void {
        this.scheduled_count += 1;
        this.loop.virtual_machine.active_tasks +|= 1;

        NetworkThread.init() catch {};
        this.concurrent.chunk_size = chunk_size;
        NetworkThread.global.pool.schedule(.{ .head = &this.concurrent.task, .tail = &this.concurrent.task, .len = 1 });
    }

    const default_fifo_chunk_size = 1024;
    const default_file_chunk_size = 1024 * 1024 * 2;
    pub fn onStart(this: *FileBlobLoader) StreamStart {
        var file = &this.store.data.file;
        var file_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var auto_close = this.auto_close;
        defer this.auto_close = auto_close;
        var fd = if (!auto_close)
            file.pathlike.fd
        else switch (JSC.Node.Syscall.open(file.pathlike.path.sliceZ(&file_buf), std.os.O.RDONLY | std.os.O.NONBLOCK | std.os.O.CLOEXEC, 0)) {
            .result => |_fd| _fd,
            .err => |err| {
                this.deinit();
                return .{ .err = err.withPath(file.pathlike.path.slice()) };
            },
        };

        if (!auto_close) {
            // ensure we have non-blocking IO set
            const flags = std.os.fcntl(fd, std.os.F.GETFL, 0) catch return .{ .err = JSC.Node.Syscall.Error.fromCode(std.os.E.BADF, .fcntl) };

            // if we do not, clone the descriptor and set non-blocking
            // it is important for us to clone it so we don't cause Weird Things to happen
            if ((flags & std.os.O.NONBLOCK) == 0) {
                auto_close = true;
                fd = @intCast(@TypeOf(fd), std.os.fcntl(fd, std.os.F.DUPFD, 0) catch return .{ .err = JSC.Node.Syscall.Error.fromCode(std.os.E.BADF, .fcntl) });
                _ = std.os.fcntl(fd, std.os.F.SETFL, flags | std.os.O.NONBLOCK) catch return .{ .err = JSC.Node.Syscall.Error.fromCode(std.os.E.BADF, .fcntl) };
            }
        }

        const stat: std.os.Stat = switch (JSC.Node.Syscall.fstat(fd)) {
            .result => |result| result,
            .err => |err| {
                if (auto_close) {
                    _ = JSC.Node.Syscall.close(fd);
                }
                this.deinit();
                return .{ .err = err.withPath(file.pathlike.path.slice()) };
            },
        };

        if (std.os.S.ISDIR(stat.mode)) {
            const err = JSC.Node.Syscall.Error.fromCode(.ISDIR, .fstat);
            if (auto_close) {
                _ = JSC.Node.Syscall.close(fd);
            }
            this.deinit();
            return .{ .err = err };
        }

        if (std.os.S.ISSOCK(stat.mode)) {
            const err = JSC.Node.Syscall.Error.fromCode(.INVAL, .fstat);

            if (auto_close) {
                _ = JSC.Node.Syscall.close(fd);
            }
            this.deinit();
            return .{ .err = err };
        }

        file.seekable = std.os.S.ISREG(stat.mode);
        file.mode = @intCast(JSC.Node.Mode, stat.mode);
        this.mode = file.mode;

        if (file.seekable orelse false)
            file.max_size = @intCast(Blob.SizeType, stat.size);

        if ((file.seekable orelse false) and file.max_size == 0) {
            if (auto_close) {
                _ = JSC.Node.Syscall.close(fd);
            }
            this.deinit();
            return .{ .empty = {} };
        }

        this.fd = fd;
        this.auto_close = auto_close;

        const chunk_size = this.calculateChunkSize(std.math.maxInt(usize));
        return .{ .chunk_size = @truncate(Blob.SizeType, chunk_size) };
    }

    fn calculateChunkSize(this: *FileBlobLoader, available_to_read: usize) usize {
        const file = &this.store.data.file;

        const chunk_size: usize = if (this.user_chunk_size > 0)
            @as(usize, this.user_chunk_size)
        else if (file.seekable orelse false)
            @as(usize, default_file_chunk_size)
        else
            @as(usize, default_fifo_chunk_size);

        return if (file.max_size > 0)
            if (available_to_read != std.math.maxInt(usize)) @minimum(chunk_size, available_to_read) else @minimum(@maximum(this.total_read, file.max_size) - this.total_read, chunk_size)
        else
            @minimum(available_to_read, chunk_size);
    }

    pub fn onPull(this: *FileBlobLoader, buffer: []u8, view: JSC.JSValue) StreamResult {
        const chunk_size = this.calculateChunkSize(std.math.maxInt(usize));

        switch (chunk_size) {
            0 => {
                std.debug.assert(this.store.data.file.seekable orelse false);
                this.finalize();
                return .{ .done = {} };
            },
            run_on_different_thread_size...std.math.maxInt(@TypeOf(chunk_size)) => {
                this.protected_view = view;
                this.protected_view.protect();
                // should never be reached
                this.pending.result = .{
                    .err = JSC.Node.Syscall.Error.todo,
                };
                this.buf = buffer;

                this.scheduleAsync(@truncate(Blob.SizeType, chunk_size));

                return .{ .pending = &this.pending };
            },
            else => {},
        }

        return this.read(buffer, view);
    }

    fn maybeAutoClose(this: *FileBlobLoader) void {
        if (this.auto_close) {
            _ = JSC.Node.Syscall.close(this.fd);
            this.auto_close = false;
        }
    }

    fn handleReadChunk(this: *FileBlobLoader, result: usize) StreamResult {
        this.total_read += @intCast(Blob.SizeType, result);
        const remaining: Blob.SizeType = if (this.store.data.file.seekable orelse false)
            this.store.data.file.max_size -| this.total_read
        else
            @as(Blob.SizeType, std.math.maxInt(Blob.SizeType));

        // this handles:
        // - empty file
        // - stream closed for some reason
        if ((result == 0 and remaining == 0)) {
            this.finalize();
            return .{ .done = {} };
        }

        const has_more = remaining > 0;

        if (!has_more) {
            return .{ .into_array_and_done = .{ .len = @truncate(Blob.SizeType, result) } };
        }

        return .{ .into_array = .{ .len = @truncate(Blob.SizeType, result) } };
    }

    pub fn read(
        this: *FileBlobLoader,
        read_buf: []u8,
        view: JSC.JSValue,
    ) StreamResult {
        const rc =
            JSC.Node.Syscall.read(this.fd, read_buf);

        switch (rc) {
            .err => |err| {
                const retry =
                    std.os.E.AGAIN;

                switch (err.getErrno()) {
                    retry => {
                        this.protected_view = view;
                        this.protected_view.protect();
                        this.buf = read_buf;
                        this.watch();
                        return .{
                            .pending = &this.pending,
                        };
                    },
                    else => {},
                }
                const sys = if (this.store.data.file.pathlike == .path and this.store.data.file.pathlike.path.slice().len > 0)
                    err.withPath(this.store.data.file.pathlike.path.slice())
                else
                    err;

                this.finalize();
                return .{ .err = sys };
            },
            .result => |result| {
                return this.handleReadChunk(result);
            },
        }
    }

    pub fn callback(task: ?*anyopaque, sizeOrOffset: i64, _: u16) void {
        var this: *FileReader = bun.cast(*FileReader, task.?);
        this.scheduled_count -= 1;
        const protected_view = this.protected_view;
        defer protected_view.unprotect();
        this.protected_view = JSValue.zero;

        var available_to_read: usize = std.math.maxInt(usize);
        if (comptime Environment.isMac) {
            if (std.os.S.ISREG(this.mode)) {
                // Returns when the file pointer is not at the end of
                // file.  data contains the offset from current position
                // to end of file, and may be negative.
                available_to_read = @intCast(usize, @maximum(sizeOrOffset, 0));
            } else if (std.os.S.ISCHR(this.mode) or std.os.S.ISFIFO(this.mode)) {
                available_to_read = @intCast(usize, @maximum(sizeOrOffset, 0));
            }
        }
        if (this.finalized and this.scheduled_count == 0) {
            if (!this.pending.used) {
                // should never be reached
                this.pending.result = .{
                    .err = JSC.Node.Syscall.Error.todo,
                };
                resume this.pending.frame;
            }
            this.deinit();
            return;
        }
        if (this.cancelled)
            return;

        if (this.buf.len == 0) {
            return;
        } else {
            this.buf.len = @minimum(this.buf.len, available_to_read);
        }

        this.pending.result = this.read(this.buf, this.protected_view);
        resume this.pending.frame;
    }

    pub fn finalize(this: *FileBlobLoader) void {
        if (this.finalized)
            return;
        this.finalized = true;

        this.maybeAutoClose();

        this.store.deref();
    }

    pub fn onCancel(this: *FileBlobLoader) void {
        this.cancelled = true;

        this.deinit();
    }

    pub fn deinit(this: *FileBlobLoader) void {
        this.finalize();
        if (this.scheduled_count == 0 and !this.pending.used) {
            this.destroy();
        }
    }

    pub fn destroy(this: *FileBlobLoader) void {
        bun.default_allocator.destroy(this);
    }

    pub const Source = ReadableStreamSource(@This(), "FileBlobLoader", onStart, onPull, onCancel, deinit);
};

pub const StreamSource = struct {
    ptr: ?*anyopaque = null,
    vtable: VTable,

    pub const VTable = struct {
        onStart: fn (this: StreamSource) JSC.WebCore.StreamStart,
        onPull: fn (this: StreamSource) JSC.WebCore.StreamResult,
        onError: fn (this: StreamSource) void,
    };
};
