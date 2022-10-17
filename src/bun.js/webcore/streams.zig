const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const bun = @import("../../global.zig");
const RequestContext = @import("../../http.zig").RequestContext;
const MimeType = @import("../../http.zig").MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = @import("http");
const NetworkThread = HTTPClient.NetworkThread;
const AsyncIO = NetworkThread.AsyncIO;
const JSC = @import("javascript_core");
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;
const FetchHeaders = JSC.FetchHeaders;
const ObjectPool = @import("../../pool.zig").ObjectPool;
const SystemError = JSC.SystemError;
const Output = @import("../../global.zig").Output;
const MutableString = @import("../../global.zig").MutableString;
const strings = @import("../../global.zig").strings;
const string = @import("../../global.zig").string;
const default_allocator = @import("../../global.zig").default_allocator;
const FeatureFlags = @import("../../global.zig").FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const NewClass = @import("../base.zig").NewClass;
const d = @import("../base.zig").d;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../env.zig");
const ZigString = JSC.ZigString;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;

const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const Task = JSC.Task;
const JSPrinter = @import("../../js_printer.zig");
const picohttp = @import("picohttp");
const StringJoiner = @import("../../string_joiner.zig");
const uws = @import("uws");
const Blob = JSC.WebCore.Blob;
const Response = JSC.WebCore.Response;
const Request = JSC.WebCore.Request;
const assert = std.debug.assert;
const Syscall = JSC.Node.Syscall;

const AnyBlob = JSC.WebCore.AnyBlob;
pub const ReadableStream = struct {
    value: JSValue,
    ptr: Source,

    pub fn toJS(this: *const ReadableStream) JSValue {
        return this.value;
    }

    pub fn toAnyBlob(
        stream: *ReadableStream,
        globalThis: *JSC.JSGlobalObject,
    ) ?JSC.WebCore.AnyBlob {
        switch (stream.ptr) {
            .Blob => |blobby| {
                var blob = JSC.WebCore.Blob.initWithStore(blobby.store, globalThis);
                blob.offset = blobby.offset;
                blob.size = blobby.remain;
                blob.store.?.ref();
                stream.detach(globalThis);
                stream.done();
                blobby.deinit();

                return AnyBlob{ .Blob = blob };
            },
            .File => |blobby| {
                var blob = JSC.WebCore.Blob.initWithStore(blobby.store, globalThis);
                blobby.store.ref();

                // it should be lazy, file shouldn't have opened yet.
                std.debug.assert(!blobby.started);

                stream.detach(globalThis);
                blobby.deinit();
                stream.done();
                return AnyBlob{ .Blob = blob };
            },
            .Bytes => |bytes| {

                // If we've received the complete body by the time this function is called
                // we can avoid streaming it and convert it to a Blob
                if (bytes.has_received_last_chunk) {
                    stream.detach(globalThis);
                    var blob: JSC.WebCore.AnyBlob = undefined;
                    blob.from(bytes.buffer);
                    bytes.parent().deinit();
                    return blob;
                }

                return null;
            },
            else => return null,
        }
    }

    pub fn done(this: *const ReadableStream) void {
        this.value.unprotect();
    }

    pub fn cancel(this: *const ReadableStream, globalThis: *JSGlobalObject) void {
        JSC.markBinding(@src());
        this.value.unprotect();
        ReadableStream__cancel(this.value, globalThis);
    }

    pub fn abort(this: *const ReadableStream, globalThis: *JSGlobalObject) void {
        JSC.markBinding(@src());
        this.value.unprotect();
        ReadableStream__cancel(this.value, globalThis);
    }

    pub fn detach(this: *const ReadableStream, globalThis: *JSGlobalObject) void {
        JSC.markBinding(@src());
        this.value.unprotect();
        ReadableStream__detach(this.value, globalThis);
    }

    pub const Tag = enum(i32) {
        Invalid = -1,

        /// ReadableStreamDefaultController or ReadableByteStreamController
        JavaScript = 0,

        /// ReadableByteStreamController
        /// but with a BlobLoader
        /// we can skip the BlobLoader and just use the underlying Blob
        Blob = 1,

        /// ReadableByteStreamController
        /// but with a FileLoader
        /// we can skip the FileLoader and just use the underlying File
        File = 2,

        /// This is a direct readable stream
        /// That means we can turn it into whatever we want
        Direct = 3,

        Bytes = 4,
    };
    pub const Source = union(Tag) {
        Invalid: void,
        /// ReadableStreamDefaultController or ReadableByteStreamController
        JavaScript: void,
        /// ReadableByteStreamController
        /// but with a BlobLoader
        /// we can skip the BlobLoader and just use the underlying Blob
        Blob: *ByteBlobLoader,

        /// ReadableByteStreamController
        /// but with a FileLoader
        /// we can skip the FileLoader and just use the underlying File
        File: *FileBlobLoader,

        /// This is a direct readable stream
        /// That means we can turn it into whatever we want
        Direct: void,

        Bytes: *ByteStream,
    };

    extern fn ReadableStreamTag__tagged(globalObject: *JSGlobalObject, possibleReadableStream: JSValue, ptr: *JSValue) Tag;
    extern fn ReadableStream__isDisturbed(possibleReadableStream: JSValue, globalObject: *JSGlobalObject) bool;
    extern fn ReadableStream__isLocked(possibleReadableStream: JSValue, globalObject: *JSGlobalObject) bool;
    extern fn ReadableStream__empty(*JSGlobalObject) JSC.JSValue;
    extern fn ReadableStream__cancel(stream: JSValue, *JSGlobalObject) void;
    extern fn ReadableStream__abort(stream: JSValue, *JSGlobalObject) void;
    extern fn ReadableStream__detach(stream: JSValue, *JSGlobalObject) void;
    extern fn ReadableStream__fromBlob(
        *JSGlobalObject,
        store: *anyopaque,
        offset: usize,
        length: usize,
    ) JSC.JSValue;

    pub fn isDisturbed(this: *const ReadableStream, globalObject: *JSGlobalObject) bool {
        JSC.markBinding(@src());
        return ReadableStream__isDisturbed(this.value, globalObject);
    }

    pub fn isLocked(this: *const ReadableStream, globalObject: *JSGlobalObject) bool {
        JSC.markBinding(@src());
        return ReadableStream__isLocked(this.value, globalObject);
    }

    pub fn fromJS(value: JSValue, globalThis: *JSGlobalObject) ?ReadableStream {
        JSC.markBinding(@src());
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

            .Bytes => ReadableStream{
                .value = value,
                .ptr = .{
                    .Bytes = ptr.asPtr(ByteStream),
                },
            },

            // .HTTPRequest => ReadableStream{
            //     .value = value,
            //     .ptr = .{
            //         .HTTPRequest = ptr.asPtr(HTTPRequest),
            //     },
            // },
            // .HTTPSRequest => ReadableStream{
            //     .value = value,
            //     .ptr = .{
            //         .HTTPSRequest = ptr.asPtr(HTTPSRequest),
            //     },
            // },
            else => null,
        };
    }

    extern fn ZigGlobalObject__createNativeReadableStream(*JSGlobalObject, nativePtr: JSValue, nativeType: JSValue) JSValue;

    pub fn fromNative(globalThis: *JSGlobalObject, id: Tag, ptr: *anyopaque) JSC.JSValue {
        JSC.markBinding(@src());
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

    const Base = @import("../../ast/base.zig");
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
};

pub const StreamStart = union(Tag) {
    empty: void,
    err: Syscall.Error,
    chunk_size: Blob.SizeType,
    ArrayBufferSink: struct {
        chunk_size: Blob.SizeType,
        as_uint8array: bool,
        stream: bool,
    },
    FileSink: struct {
        chunk_size: Blob.SizeType = 16384,
        input_path: PathOrFileDescriptor,
        truncate: bool = true,
        close: bool = false,
        mode: JSC.Node.Mode = 0o664,
    },
    HTTPSResponseSink: void,
    HTTPResponseSink: void,
    ready: void,

    pub const Tag = enum {
        empty,
        err,
        chunk_size,
        ArrayBufferSink,
        FileSink,
        HTTPSResponseSink,
        HTTPResponseSink,
        ready,
    };

    pub fn toJS(this: StreamStart, globalThis: *JSGlobalObject) JSC.JSValue {
        switch (this) {
            .empty, .ready => {
                return JSC.JSValue.jsUndefined();
            },
            .chunk_size => |chunk| {
                return JSC.JSValue.jsNumber(@intCast(Blob.SizeType, chunk));
            },
            .err => |err| {
                globalThis.vm().throwError(globalThis, err.toJSC(globalThis));
                return JSC.JSValue.jsUndefined();
            },
            else => {
                return JSC.JSValue.jsUndefined();
            },
        }
    }

    pub fn fromJS(globalThis: *JSGlobalObject, value: JSValue) StreamStart {
        if (value.isEmptyOrUndefinedOrNull() or !value.isObject()) {
            return .{ .empty = {} };
        }

        if (value.get(globalThis, "chunkSize")) |chunkSize| {
            return .{ .chunk_size = @intCast(Blob.SizeType, @truncate(i52, chunkSize.toInt64())) };
        }

        return .{ .empty = {} };
    }

    pub fn fromJSWithTag(
        globalThis: *JSGlobalObject,
        value: JSValue,
        comptime tag: Tag,
    ) StreamStart {
        if (value.isEmptyOrUndefinedOrNull() or !value.isObject()) {
            return .{ .empty = {} };
        }

        switch (comptime tag) {
            .ArrayBufferSink => {
                var as_uint8array = false;
                var stream = false;
                var chunk_size: JSC.WebCore.Blob.SizeType = 0;
                var empty = true;

                if (value.get(globalThis, "asUint8Array")) |as_array| {
                    as_uint8array = as_array.toBoolean();
                    empty = false;
                }

                if (value.get(globalThis, "stream")) |as_array| {
                    stream = as_array.toBoolean();
                    empty = false;
                }

                if (value.get(globalThis, "highWaterMark")) |chunkSize| {
                    empty = false;
                    chunk_size = @intCast(JSC.WebCore.Blob.SizeType, @maximum(0, @truncate(i51, chunkSize.toInt64())));
                }

                if (!empty) {
                    return .{
                        .ArrayBufferSink = .{
                            .chunk_size = chunk_size,
                            .as_uint8array = as_uint8array,
                            .stream = stream,
                        },
                    };
                }
            },
            .FileSink => {
                var chunk_size: JSC.WebCore.Blob.SizeType = 0;

                if (value.get(globalThis, "highWaterMark")) |chunkSize| {
                    chunk_size = @intCast(JSC.WebCore.Blob.SizeType, @maximum(0, @truncate(i51, chunkSize.toInt64())));
                }

                if (value.get(globalThis, "path")) |path| {
                    return .{
                        .FileSink = .{
                            .chunk_size = chunk_size,
                            .input_path = .{
                                .path = path.toSlice(globalThis, globalThis.bunVM().allocator),
                            },
                        },
                    };
                } else if (value.get(globalThis, "fd")) |fd| {
                    return .{
                        .FileSink = .{
                            .chunk_size = chunk_size,
                            .input_path = .{
                                .fd = fd.toInt32(),
                            },
                        },
                    };
                }

                return .{
                    .FileSink = .{
                        .input_path = .{ .fd = std.math.maxInt(JSC.Node.FileDescriptor) },
                        .chunk_size = chunk_size,
                    },
                };
            },
            .HTTPSResponseSink, .HTTPResponseSink => {
                var empty = true;
                var chunk_size: JSC.WebCore.Blob.SizeType = 2048;

                if (value.get(globalThis, "highWaterMark")) |chunkSize| {
                    empty = false;
                    chunk_size = @intCast(JSC.WebCore.Blob.SizeType, @maximum(256, @truncate(i51, chunkSize.toInt64())));
                }

                if (!empty) {
                    return .{
                        .chunk_size = chunk_size,
                    };
                }
            },
            else => @compileError("Unuspported tag"),
        }

        return .{ .empty = {} };
    }
};

pub const DrainResult = union(enum) {
    owned: struct {
        list: std.ArrayList(u8),
        size_hint: usize,
    },
    estimated_size: usize,
    empty: void,
    aborted: void,
};

pub const StreamResult = union(Tag) {
    owned: bun.ByteList,
    owned_and_done: bun.ByteList,
    temporary_and_done: bun.ByteList,
    temporary: bun.ByteList,
    into_array: IntoArray,
    into_array_and_done: IntoArray,
    pending: *Pending,
    err: Syscall.Error,
    done: void,

    pub const Tag = enum {
        owned,
        owned_and_done,
        temporary_and_done,
        temporary,
        into_array,
        into_array_and_done,
        pending,
        err,
        done,
    };

    pub fn slice(this: *const StreamResult) []const u8 {
        return switch (this.*) {
            .owned => |owned| owned.slice(),
            .owned_and_done => |owned_and_done| owned_and_done.slice(),
            .temporary_and_done => |temporary_and_done| temporary_and_done.slice(),
            .temporary => |temporary| temporary.slice(),
            else => "",
        };
    }

    pub const Writable = union(StreamResult.Tag) {
        pending: *Writable.Pending,

        err: Syscall.Error,
        done: void,

        owned: Blob.SizeType,
        owned_and_done: Blob.SizeType,
        temporary_and_done: Blob.SizeType,
        temporary: Blob.SizeType,
        into_array: Blob.SizeType,
        into_array_and_done: Blob.SizeType,

        pub const Pending = struct {
            frame: anyframe,
            result: Writable,
            consumed: Blob.SizeType = 0,
            state: StreamResult.Pending.State = .none,

            pub fn run(this: *Writable.Pending) void {
                if (this.state != .pending) {
                    return;
                }

                this.state = .used;
                resume this.frame;
            }
        };

        pub fn toPromised(globalThis: *JSGlobalObject, promise: *JSPromise, pending: *Writable.Pending) void {
            var frame = bun.default_allocator.create(@Frame(Writable.toPromisedWrap)) catch unreachable;
            pending.state = .pending;
            frame.* = async Writable.toPromisedWrap(globalThis, promise, pending);
            pending.frame = frame;
        }

        pub fn isDone(this: *const Writable) bool {
            return switch (this.*) {
                .owned_and_done, .temporary_and_done, .into_array_and_done, .done, .err => true,
                else => false,
            };
        }
        fn toPromisedWrap(globalThis: *JSGlobalObject, promise: *JSPromise, pending: *Writable.Pending) void {
            suspend {}

            const result: Writable = pending.result;

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

        pub fn toJS(this: Writable, globalThis: *JSGlobalObject) JSValue {
            return switch (this) {
                .err => |err| JSC.JSPromise.rejectedPromise(globalThis, JSValue.c(err.toJS(globalThis))).asValue(globalThis),

                .owned => |len| JSC.JSValue.jsNumber(len),
                .owned_and_done => |len| JSC.JSValue.jsNumber(len),
                .temporary_and_done => |len| JSC.JSValue.jsNumber(len),
                .temporary => |len| JSC.JSValue.jsNumber(len),
                .into_array => |len| JSC.JSValue.jsNumber(len),
                .into_array_and_done => |len| JSC.JSValue.jsNumber(len),

                // false == controller.close()
                // undefined == noop, but we probably won't send it
                .done => JSC.JSValue.jsBoolean(true),

                .pending => |pending| brk: {
                    var promise = JSC.JSPromise.create(globalThis);
                    Writable.toPromised(globalThis, promise, pending);
                    break :brk promise.asValue(globalThis);
                },
            };
        }
    };

    pub const IntoArray = struct {
        value: JSValue = JSValue.zero,
        len: Blob.SizeType = std.math.maxInt(Blob.SizeType),
    };

    pub const Pending = struct {
        frame: anyframe,
        result: StreamResult,
        state: State = .none,

        pub const State = enum {
            none,
            pending,
            used,
        };

        pub fn run(this: *Pending) void {
            if (this.state != .pending) return;
            this.state = .used;
            resume this.frame;
        }
    };

    pub fn isDone(this: *const StreamResult) bool {
        return switch (this.*) {
            .owned_and_done, .temporary_and_done, .into_array_and_done, .done, .err => true,
            else => false,
        };
    }

    fn toPromisedWrap(globalThis: *JSGlobalObject, promise: *JSPromise, pending: *Pending) void {
        suspend {}

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
        pending.state = .pending;
        frame.* = async toPromisedWrap(globalThis, promise, pending);
        pending.frame = frame;
    }

    pub fn toJS(this: *const StreamResult, globalThis: *JSGlobalObject) JSValue {
        switch (this.*) {
            .owned => |list| {
                return JSC.ArrayBuffer.fromBytes(list.slice(), .Uint8Array).toJS(globalThis, null);
            },
            .owned_and_done => |list| {
                return JSC.ArrayBuffer.fromBytes(list.slice(), .Uint8Array).toJS(globalThis, null);
            },
            .temporary => |temp| {
                var array = JSC.JSValue.createUninitializedUint8Array(globalThis, temp.len);
                var slice_ = array.asArrayBuffer(globalThis).?.slice();
                @memcpy(slice_.ptr, temp.ptr, temp.len);
                return array;
            },
            .temporary_and_done => |temp| {
                var array = JSC.JSValue.createUninitializedUint8Array(globalThis, temp.len);
                var slice_ = array.asArrayBuffer(globalThis).?.slice();
                @memcpy(slice_.ptr, temp.ptr, temp.len);
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
                return JSC.JSPromise.rejectedPromise(globalThis, JSValue.c(err.toJS(globalThis))).asValue(globalThis);
            },

            // false == controller.close()
            // undefined == noop, but we probably won't send it
            .done => {
                return JSC.JSValue.jsBoolean(false);
            },
        }
    }
};

pub const Signal = struct {
    ptr: *anyopaque = dead,
    vtable: VTable = VTable.Dead,

    pub const dead = @intToPtr(*anyopaque, 0xaaaaaaaa);

    pub fn clear(this: *Signal) void {
        this.ptr = dead;
    }

    pub fn isDead(this: Signal) bool {
        return this.ptr == dead;
    }

    pub fn initWithType(comptime Type: type, handler: *Type) Signal {
        // this is nullable when used as a JSValue
        @setRuntimeSafety(false);
        return .{
            .ptr = handler,
            .vtable = VTable.wrap(Type),
        };
    }

    pub fn init(handler: anytype) Signal {
        return initWithType(std.meta.Child(@TypeOf(handler)), handler);
    }

    pub fn close(this: Signal, err: ?Syscall.Error) void {
        if (this.isDead())
            return;
        this.vtable.close(this.ptr, err);
    }
    pub fn ready(this: Signal, amount: ?Blob.SizeType, offset: ?Blob.SizeType) void {
        if (this.isDead())
            return;
        this.vtable.ready(this.ptr, amount, offset);
    }
    pub fn start(this: Signal) void {
        if (this.isDead())
            return;
        this.vtable.start(this.ptr);
    }

    pub const VTable = struct {
        pub const OnCloseFn = fn (this: *anyopaque, err: ?Syscall.Error) void;
        pub const OnReadyFn = fn (this: *anyopaque, amount: ?Blob.SizeType, offset: ?Blob.SizeType) void;
        pub const OnStartFn = fn (this: *anyopaque) void;
        close: OnCloseFn,
        ready: OnReadyFn,
        start: OnStartFn,

        const DeadFns = struct {
            pub fn close(_: *anyopaque, _: ?Syscall.Error) void {
                unreachable;
            }
            pub fn ready(_: *anyopaque, _: ?Blob.SizeType, _: ?Blob.SizeType) void {
                unreachable;
            }

            pub fn start(_: *anyopaque) void {
                unreachable;
            }
        };

        pub const Dead = VTable{ .close = DeadFns.close, .ready = DeadFns.ready, .start = DeadFns.start };

        pub fn wrap(
            comptime Wrapped: type,
        ) VTable {
            const Functions = struct {
                fn onClose(this: *anyopaque, err: ?Syscall.Error) void {
                    if (comptime !@hasDecl(Wrapped, "onClose"))
                        Wrapped.close(@ptrCast(*Wrapped, @alignCast(std.meta.alignment(Wrapped), this)), err)
                    else
                        Wrapped.onClose(@ptrCast(*Wrapped, @alignCast(std.meta.alignment(Wrapped), this)), err);
                }
                fn onReady(this: *anyopaque, amount: ?Blob.SizeType, offset: ?Blob.SizeType) void {
                    if (comptime !@hasDecl(Wrapped, "onReady"))
                        Wrapped.ready(@ptrCast(*Wrapped, @alignCast(std.meta.alignment(Wrapped), this)), amount, offset)
                    else
                        Wrapped.onReady(@ptrCast(*Wrapped, @alignCast(std.meta.alignment(Wrapped), this)), amount, offset);
                }
                fn onStart(this: *anyopaque) void {
                    if (comptime !@hasDecl(Wrapped, "onStart"))
                        Wrapped.start(@ptrCast(*Wrapped, @alignCast(std.meta.alignment(Wrapped), this)))
                    else
                        Wrapped.onStart(@ptrCast(*Wrapped, @alignCast(std.meta.alignment(Wrapped), this)));
                }
            };

            return VTable{
                .close = Functions.onClose,
                .ready = Functions.onReady,
                .start = Functions.onStart,
            };
        }
    };
};

pub const Sink = struct {
    ptr: *anyopaque,
    vtable: VTable,
    status: Status = Status.closed,
    used: bool = false,

    pub const pending = Sink{
        .ptr = @intToPtr(*anyopaque, 0xaaaaaaaa),
        .vtable = undefined,
    };

    pub const Status = enum {
        ready,
        closed,
    };

    pub const Data = union(enum) {
        utf16: StreamResult,
        latin1: StreamResult,
        bytes: StreamResult,
    };

    pub fn initWithType(comptime Type: type, handler: *Type) Sink {
        return .{
            .ptr = handler,
            .vtable = VTable.wrap(Type),
            .status = .ready,
            .used = false,
        };
    }

    pub fn init(handler: anytype) Sink {
        return initWithType(std.meta.Child(@TypeOf(handler)), handler);
    }

    pub const UTF8Fallback = struct {
        const stack_size = 1024;
        pub fn writeLatin1(comptime Ctx: type, ctx: *Ctx, input: StreamResult, comptime writeFn: anytype) StreamResult.Writable {
            var str = input.slice();
            if (strings.isAllASCII(str)) {
                return writeFn(
                    ctx,
                    input,
                );
            }

            if (stack_size >= str.len) {
                var buf: [stack_size]u8 = undefined;
                @memcpy(&buf, str.ptr, str.len);
                strings.replaceLatin1WithUTF8(buf[0..str.len]);
                if (input.isDone()) {
                    const result = writeFn(ctx, .{ .temporary_and_done = bun.ByteList.init(buf[0..str.len]) });
                    return result;
                } else {
                    const result = writeFn(ctx, .{ .temporary = bun.ByteList.init(buf[0..str.len]) });
                    return result;
                }
            }

            {
                var slice = bun.default_allocator.alloc(u8, str.len) catch return .{ .err = Syscall.Error.oom };
                @memcpy(slice.ptr, str.ptr, str.len);
                strings.replaceLatin1WithUTF8(slice[0..str.len]);
                if (input.isDone()) {
                    return writeFn(ctx, .{ .owned_and_done = bun.ByteList.init(slice) });
                } else {
                    return writeFn(ctx, .{ .owned = bun.ByteList.init(slice) });
                }
            }
        }

        pub fn writeUTF16(comptime Ctx: type, ctx: *Ctx, input: StreamResult, comptime writeFn: anytype) StreamResult.Writable {
            var str: []const u16 = std.mem.bytesAsSlice(u16, input.slice());

            if (stack_size >= str.len * 2) {
                var buf: [stack_size]u8 = undefined;
                const copied = strings.copyUTF16IntoUTF8(&buf, []const u16, str);
                std.debug.assert(copied.written <= stack_size);
                std.debug.assert(copied.read <= stack_size);
                if (input.isDone()) {
                    const result = writeFn(ctx, .{ .temporary_and_done = bun.ByteList.init(buf[0..copied.written]) });
                    return result;
                } else {
                    const result = writeFn(ctx, .{ .temporary = bun.ByteList.init(buf[0..copied.written]) });
                    return result;
                }
            }

            {
                var allocated = strings.toUTF8Alloc(bun.default_allocator, str) catch return .{ .err = Syscall.Error.oom };
                if (input.isDone()) {
                    return writeFn(ctx, .{ .owned_and_done = bun.ByteList.init(allocated) });
                } else {
                    return writeFn(ctx, .{ .owned = bun.ByteList.init(allocated) });
                }
            }
        }
    };

    pub const VTable = struct {
        pub const WriteUTF16Fn = fn (this: *anyopaque, data: StreamResult) StreamResult.Writable;
        pub const WriteUTF8Fn = fn (this: *anyopaque, data: StreamResult) StreamResult.Writable;
        pub const WriteLatin1Fn = fn (this: *anyopaque, data: StreamResult) StreamResult.Writable;
        pub const EndFn = fn (this: *anyopaque, err: ?Syscall.Error) JSC.Node.Maybe(void);
        pub const ConnectFn = fn (this: *anyopaque, signal: Signal) JSC.Node.Maybe(void);

        connect: ConnectFn,
        write: WriteUTF8Fn,
        writeLatin1: WriteLatin1Fn,
        writeUTF16: WriteUTF16Fn,
        end: EndFn,

        pub fn wrap(
            comptime Wrapped: type,
        ) VTable {
            const Functions = struct {
                pub fn onWrite(this: *anyopaque, data: StreamResult) StreamResult.Writable {
                    return Wrapped.write(@ptrCast(*Wrapped, @alignCast(std.meta.alignment(Wrapped), this)), data);
                }
                pub fn onConnect(this: *anyopaque, signal: Signal) JSC.Node.Maybe(void) {
                    return Wrapped.connect(@ptrCast(*Wrapped, @alignCast(std.meta.alignment(Wrapped), this)), signal);
                }
                pub fn onWriteLatin1(this: *anyopaque, data: StreamResult) StreamResult.Writable {
                    return Wrapped.writeLatin1(@ptrCast(*Wrapped, @alignCast(std.meta.alignment(Wrapped), this)), data);
                }
                pub fn onWriteUTF16(this: *anyopaque, data: StreamResult) StreamResult.Writable {
                    return Wrapped.writeUTF16(@ptrCast(*Wrapped, @alignCast(std.meta.alignment(Wrapped), this)), data);
                }
                pub fn onEnd(this: *anyopaque, err: ?Syscall.Error) JSC.Node.Maybe(void) {
                    return Wrapped.end(@ptrCast(*Wrapped, @alignCast(std.meta.alignment(Wrapped), this)), err);
                }
            };

            return VTable{
                .write = Functions.onWrite,
                .writeLatin1 = Functions.onWriteLatin1,
                .writeUTF16 = Functions.onWriteUTF16,
                .end = Functions.onEnd,
                .connect = Functions.onConnect,
            };
        }
    };

    pub fn end(this: *Sink, err: ?Syscall.Error) JSC.Node.Maybe(void) {
        if (this.status == .closed) {
            return .{ .result = {} };
        }

        this.status = .closed;
        return this.vtable.end(this.ptr, err);
    }

    pub fn writeLatin1(this: *Sink, data: StreamResult) StreamResult.Writable {
        if (this.status == .closed) {
            return .{ .done = {} };
        }

        const res = this.vtable.writeLatin1(this.ptr, data);
        this.status = if ((res.isDone()) or this.status == .closed)
            Status.closed
        else
            Status.ready;
        this.used = true;
        return res;
    }

    pub fn writeBytes(this: *Sink, data: StreamResult) StreamResult.Writable {
        if (this.status == .closed) {
            return .{ .done = {} };
        }

        const res = this.vtable.write(this.ptr, data);
        this.status = if ((res.isDone()) or this.status == .closed)
            Status.closed
        else
            Status.ready;
        this.used = true;
        return res;
    }

    pub fn writeUTF16(this: *Sink, data: StreamResult) StreamResult.Writable {
        if (this.status == .closed) {
            return .{ .done = {} };
        }

        const res = this.vtable.writeUTF16(this.ptr, data);
        this.status = if ((res.isDone()) or this.status == .closed)
            Status.closed
        else
            Status.ready;
        this.used = true;
        return res;
    }

    pub fn write(this: *Sink, data: Data) StreamResult.Writable {
        switch (data) {
            .utf16 => |str| {
                return this.writeUTF16(str);
            },
            .latin1 => |str| {
                return this.writeLatin1(str);
            },
            .bytes => |bytes| {
                return this.writeBytes(bytes);
            },
        }
    }
};

pub const PathOrFileDescriptor = union(enum) {
    path: ZigString.Slice,
    fd: JSC.Node.FileDescriptor,
};

pub const FileSink = struct {
    buffer: bun.ByteList,
    allocator: std.mem.Allocator,
    done: bool = false,
    signal: Signal = .{},
    next: ?Sink = null,
    auto_close: bool = false,
    auto_truncate: bool = false,
    fd: JSC.Node.FileDescriptor = std.math.maxInt(JSC.Node.FileDescriptor),
    mode: JSC.Node.Mode = 0,
    chunk_size: usize = 0,
    pending: StreamResult.Writable.Pending = StreamResult.Writable.Pending{
        .frame = undefined,
        .result = .{ .done = {} },
    },

    scheduled_count: u32 = 0,
    written: usize = 0,
    head: usize = 0,
    requested_end: bool = false,

    prevent_process_exit: bool = false,
    reachable_from_js: bool = true,
    poll_ref: JSC.PollRef = .{},

    pub usingnamespace NewReadyWatcher(@This(), .write, ready);

    const max_fifo_size = 64 * 1024;
    pub fn prepare(this: *FileSink, input_path: PathOrFileDescriptor, mode: JSC.Node.Mode) JSC.Node.Maybe(void) {
        var file_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        const auto_close = this.auto_close;
        const fd = if (!auto_close)
            input_path.fd
        else switch (JSC.Node.Syscall.open(input_path.path.toSliceZ(&file_buf), std.os.O.WRONLY | std.os.O.NONBLOCK | std.os.O.CLOEXEC | std.os.O.CREAT, mode)) {
            .result => |_fd| _fd,
            .err => |err| return .{ .err = err.withPath(input_path.path.slice()) },
        };

        const stat: std.os.Stat = switch (JSC.Node.Syscall.fstat(fd)) {
            .result => |result| result,
            .err => |err| {
                if (auto_close) {
                    _ = JSC.Node.Syscall.close(fd);
                }
                if (input_path == .path)
                    return .{ .err = err.withPath(input_path.path.slice()) };
                return .{ .err = err };
            },
        };

        this.mode = stat.mode;
        this.fd = fd;

        this.auto_truncate = this.auto_truncate and (std.os.S.ISREG(this.mode));

        return .{ .result = {} };
    }

    pub fn connect(this: *FileSink, signal: Signal) void {
        std.debug.assert(this.reader == null);
        this.signal = signal;
    }

    pub fn start(this: *FileSink, stream_start: StreamStart) JSC.Node.Maybe(void) {
        if (this.fd != std.math.maxInt(JSC.Node.FileDescriptor)) {
            _ = JSC.Node.Syscall.close(this.fd);
            this.fd = std.math.maxInt(JSC.Node.FileDescriptor);
        }

        this.done = false;
        this.written = 0;
        this.auto_close = false;
        this.auto_truncate = false;
        this.requested_end = false;

        this.buffer.len = 0;

        switch (stream_start) {
            .FileSink => |config| {
                this.chunk_size = config.chunk_size;
                this.auto_close = config.close or config.input_path == .path;
                this.auto_truncate = config.truncate;

                defer if (config.input_path == .path) config.input_path.path.deinit();

                switch (this.prepare(config.input_path, config.mode)) {
                    .err => |err| {
                        return .{ .err = err };
                    },
                    .result => {},
                }
            },
            else => {},
        }

        this.signal.start();
        return .{ .result = {} };
    }

    pub fn flush(this: *FileSink) StreamResult.Writable {
        return flushMaybePoll(this);
    }

    pub fn flushMaybePoll(this: *FileSink) StreamResult.Writable {
        std.debug.assert(this.fd != std.math.maxInt(JSC.Node.FileDescriptor));

        var total: usize = this.written;
        const initial = total;
        defer this.written = total;
        const fd = this.fd;
        var remain = this.buffer.slice();
        remain = remain[@minimum(this.head, remain.len)..];
        const initial_remain = remain;
        defer {
            std.debug.assert(total - initial == @ptrToInt(remain.ptr) - @ptrToInt(initial_remain.ptr));

            if (remain.len == 0) {
                this.head = 0;
                this.buffer.len = 0;
            } else {
                this.head += total - initial;
            }
        }
        while (remain.len > 0) {
            const max_to_write = if (std.os.S.ISFIFO(this.mode)) max_fifo_size else remain.len;
            const write_buf = remain[0..@minimum(remain.len, max_to_write)];
            const res = JSC.Node.Syscall.write(fd, write_buf);
            if (res == .err) {
                const retry =
                    std.os.E.AGAIN;

                switch (res.err.getErrno()) {
                    retry => {
                        this.watch(fd);
                        return .{
                            .pending = &this.pending,
                        };
                    },
                    else => {},
                }
                this.pending.result = .{ .err = res.err };
                this.pending.consumed = @truncate(Blob.SizeType, total - initial);

                return .{ .err = res.err };
            }

            remain = remain[res.result..];
            total += res.result;
            if (res.result == 0) break;

            // we flushed an entire fifo
            // but we still have more
            // lets check if its writable, so we avoid blocking
            if (std.os.S.ISFIFO(this.mode) and
                max_to_write == max_fifo_size and
                res.result == max_fifo_size and
                remain.len > 0)
            {
                var polls = [_]std.os.pollfd{
                    .{
                        .fd = fd,
                        .events = std.os.POLL.IN | std.os.POLL.ERR,
                        .revents = 0,
                    },
                };

                if ((std.os.poll(&polls, 0) catch 0) == 0) {
                    this.watch(this.fd);
                    return .{
                        .pending = &this.pending,
                    };
                }
            }
        }

        this.pending.result = .{
            .owned = @truncate(Blob.SizeType, total),
        };
        this.pending.consumed = @truncate(Blob.SizeType, total - initial);
        if (this.requested_end) {
            this.done = true;
            if (this.auto_truncate)
                std.os.ftruncate(this.fd, total) catch {};

            if (this.auto_close) {
                _ = JSC.Node.Syscall.close(this.fd);
                this.fd = std.math.maxInt(JSC.Node.FileDescriptor);
            }
        }
        this.pending.run();
        return .{ .owned = @truncate(Blob.SizeType, total - initial) };
    }

    pub fn flushFromJS(this: *FileSink, globalThis: *JSGlobalObject, _: bool) JSC.Node.Maybe(JSValue) {
        if (this.isPending()) {
            return .{ .result = JSC.JSValue.jsUndefined() };
        }
        const result = this.flush();

        if (result == .err) {
            return .{ .err = result.err };
        }

        return JSC.Node.Maybe(JSValue){
            .result = result.toJS(globalThis),
        };
    }

    fn cleanup(this: *FileSink) void {
        if (this.fd != std.math.maxInt(JSC.Node.FileDescriptor)) {
            if (this.scheduled_count > 0) {
                this.scheduled_count = 0;
                this.unwatch(this.fd);
            }

            _ = JSC.Node.Syscall.close(this.fd);
            this.fd = std.math.maxInt(JSC.Node.FileDescriptor);
        }

        if (this.buffer.cap > 0) {
            this.buffer.listManaged(this.allocator).deinit();
            this.buffer = bun.ByteList.init("");
            this.done = true;
            this.head = 0;
        }

        this.pending.result = .done;
        this.pending.run();
    }

    pub fn finalize(this: *FileSink) void {
        this.signal.close(null);
        this.cleanup();
        this.reachable_from_js = false;

        if (!this.prevent_process_exit)
            this.allocator.destroy(this);
    }

    pub fn init(allocator: std.mem.Allocator, next: ?Sink) !*FileSink {
        var this = try allocator.create(FileSink);
        this.* = FileSink{
            .buffer = bun.ByteList.init(&.{}),
            .allocator = allocator,
            .next = next,
        };
        return this;
    }

    pub fn construct(
        this: *FileSink,
        allocator: std.mem.Allocator,
    ) void {
        this.* = FileSink{
            .buffer = bun.ByteList.init(&.{}),
            .allocator = allocator,
            .next = null,
        };
    }

    pub fn toJS(this: *FileSink, globalThis: *JSGlobalObject) JSValue {
        return JSSink.createObject(globalThis, this);
    }

    pub fn ready(this: *FileSink, _: i64) void {
        _ = this.flushMaybePoll();
    }

    pub fn write(this: *@This(), data: StreamResult) StreamResult.Writable {
        const input = data.slice();

        if (!this.isPending() and this.buffer.len == 0 and input.len >= this.chunk_size) {
            var temp = this.buffer;
            defer this.buffer = temp;
            this.buffer = bun.ByteList.init(input);
            const result = this.flush();
            if (this.isPending()) {
                _ = temp.write(this.allocator, input) catch {
                    return .{ .err = Syscall.Error.oom };
                };
            }

            return result;
        }

        const len = this.buffer.write(this.allocator, input) catch {
            return .{ .err = Syscall.Error.oom };
        };

        if (!this.isPending() and this.buffer.len >= this.chunk_size) {
            return this.flush();
        }

        this.signal.ready(null, null);
        return .{ .owned = len };
    }
    pub const writeBytes = write;
    pub fn writeLatin1(this: *@This(), data: StreamResult) StreamResult.Writable {
        const input = data.slice();

        if (!this.isPending() and this.buffer.len == 0 and input.len >= this.chunk_size and strings.isAllASCII(input)) {
            var temp = this.buffer;
            defer this.buffer = temp;
            this.buffer = bun.ByteList.init(input);
            const result = this.flush();
            if (this.isPending()) {
                _ = temp.write(this.allocator, input) catch {
                    return .{ .err = Syscall.Error.oom };
                };
            }

            return result;
        }

        const len = this.buffer.writeLatin1(this.allocator, input) catch {
            return .{ .err = Syscall.Error.oom };
        };

        if (!this.isPending() and this.buffer.len >= this.chunk_size) {
            return this.flush();
        }

        this.signal.ready(null, null);
        return .{ .owned = len };
    }
    pub fn writeUTF16(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.next) |*next| {
            return next.writeUTF16(data);
        }
        const len = this.buffer.writeUTF16(this.allocator, @ptrCast([*]const u16, @alignCast(@alignOf(u16), data.slice().ptr))[0..std.mem.bytesAsSlice(u16, data.slice()).len]) catch {
            return .{ .err = Syscall.Error.oom };
        };
        if (!this.isPending() and this.buffer.len >= this.chunk_size) {
            return this.flush();
        }
        this.signal.ready(null, null);

        return .{ .owned = len };
    }

    fn isPending(this: *const FileSink) bool {
        return this.poll_ref.status == .active;
    }

    pub fn end(this: *FileSink, err: ?Syscall.Error) JSC.Node.Maybe(void) {
        if (this.next) |*next| {
            return next.end(err);
        }

        if (this.requested_end or this.done)
            return .{ .result = void{} };

        this.requested_end = true;

        const flushy = this.flush();

        if (flushy == .err) {
            return .{ .err = flushy.err };
        }

        if (flushy != .pending) {
            this.cleanup();
        }

        this.signal.close(err);
        return .{ .result = {} };
    }

    pub fn endFromJS(this: *FileSink, globalThis: *JSGlobalObject) JSC.Node.Maybe(JSValue) {
        if (this.done) {
            return .{ .result = JSValue.jsNumber(this.written) };
        }

        std.debug.assert(this.next == null);
        this.requested_end = true;

        const flushed = this.flush();

        if (flushed == .err) {
            return .{ .err = flushed.err };
        }

        if (flushed != .pending) {
            this.cleanup();
        }

        this.signal.close(null);

        return .{ .result = flushed.toJS(globalThis) };
    }

    pub fn sink(this: *FileSink) Sink {
        return Sink.init(this);
    }

    pub const JSSink = NewJSSink(@This(), "FileSink");
};

pub const ArrayBufferSink = struct {
    bytes: bun.ByteList,
    allocator: std.mem.Allocator,
    done: bool = false,
    signal: Signal = .{},
    next: ?Sink = null,
    streaming: bool = false,
    as_uint8array: bool = false,

    pub fn connect(this: *ArrayBufferSink, signal: Signal) void {
        std.debug.assert(this.reader == null);
        this.signal = signal;
    }

    pub fn start(this: *ArrayBufferSink, stream_start: StreamStart) JSC.Node.Maybe(void) {
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

    pub fn flush(_: *ArrayBufferSink) JSC.Node.Maybe(void) {
        return .{ .result = {} };
    }

    pub fn flushFromJS(this: *ArrayBufferSink, globalThis: *JSGlobalObject, wait: bool) JSC.Node.Maybe(JSValue) {
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
        if (this.bytes.len > 0) {
            this.bytes.listManaged(this.allocator).deinit();
            this.bytes = bun.ByteList.init("");
            this.done = true;
        }

        this.allocator.destroy(this);
    }

    pub fn init(allocator: std.mem.Allocator, next: ?Sink) !*ArrayBufferSink {
        var this = try allocator.create(ArrayBufferSink);
        this.* = ArrayBufferSink{
            .bytes = bun.ByteList.init(&.{}),
            .allocator = allocator,
            .next = next,
        };
        return this;
    }

    pub fn construct(
        this: *ArrayBufferSink,
        allocator: std.mem.Allocator,
    ) void {
        this.* = ArrayBufferSink{
            .bytes = bun.ByteList.init(&.{}),
            .allocator = allocator,
            .next = null,
        };
    }

    pub fn write(this: *@This(), data: StreamResult) StreamResult.Writable {
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
    pub fn writeLatin1(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.next) |*next| {
            return next.writeLatin1(data);
        }
        const len = this.bytes.writeLatin1(this.allocator, data.slice()) catch {
            return .{ .err = Syscall.Error.oom };
        };
        this.signal.ready(null, null);
        return .{ .owned = len };
    }
    pub fn writeUTF16(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.next) |*next| {
            return next.writeUTF16(data);
        }
        const len = this.bytes.writeUTF16(this.allocator, @ptrCast([*]const u16, @alignCast(@alignOf(u16), data.slice().ptr))[0..std.mem.bytesAsSlice(u16, data.slice()).len]) catch {
            return .{ .err = Syscall.Error.oom };
        };
        this.signal.ready(null, null);
        return .{ .owned = len };
    }

    pub fn end(this: *ArrayBufferSink, err: ?Syscall.Error) JSC.Node.Maybe(void) {
        if (this.next) |*next| {
            return next.end(err);
        }
        this.signal.close(err);
        return .{ .result = {} };
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
            list.toOwnedSlice(),
            if (as_uint8array)
                .Uint8Array
            else
                .ArrayBuffer,
        ).toJS(globalThis, null);
    }

    pub fn endFromJS(this: *ArrayBufferSink, _: *JSGlobalObject) JSC.Node.Maybe(ArrayBuffer) {
        if (this.done) {
            return .{ .result = ArrayBuffer.fromBytes(&[_]u8{}, .ArrayBuffer) };
        }

        std.debug.assert(this.next == null);
        var list = this.bytes.listManaged(this.allocator);
        this.bytes = bun.ByteList.init("");
        this.done = true;
        this.signal.close(null);
        return .{ .result = ArrayBuffer.fromBytes(
            list.toOwnedSlice(),
            if (this.as_uint8array)
                .Uint8Array
            else
                .ArrayBuffer,
        ) };
    }

    pub fn sink(this: *ArrayBufferSink) Sink {
        return Sink.init(this);
    }

    pub const JSSink = NewJSSink(@This(), "ArrayBufferSink");
};

pub fn NewJSSink(comptime SinkType: type, comptime name_: []const u8) type {
    return struct {
        sink: SinkType,

        const ThisSink = @This();

        pub const shim = JSC.Shimmer("", std.mem.span(name_), @This());
        pub const name = std.fmt.comptimePrint("{s}", .{std.mem.span(name_)});

        // This attaches it to JS
        pub const SinkSignal = struct {
            cpp: JSValue,

            pub fn init(cpp: JSValue) Signal {
                // this one can be null
                @setRuntimeSafety(false);
                return Signal.initWithType(SinkSignal, @intToPtr(*SinkSignal, @bitCast(usize, @enumToInt(cpp))));
            }

            pub fn close(this: *@This(), _: ?Syscall.Error) void {
                onClose(@bitCast(SinkSignal, @ptrToInt(this)).cpp, JSValue.jsUndefined());
            }

            pub fn ready(this: *@This(), _: ?Blob.SizeType, _: ?Blob.SizeType) void {
                onReady(@bitCast(SinkSignal, @ptrToInt(this)).cpp, JSValue.jsUndefined(), JSValue.jsUndefined());
            }

            pub fn start(_: *@This()) void {}
        };

        pub fn onClose(ptr: JSValue, reason: JSValue) callconv(.C) void {
            JSC.markBinding(@src());

            return shim.cppFn("onClose", .{ ptr, reason });
        }

        pub fn onReady(ptr: JSValue, amount: JSValue, offset: JSValue) callconv(.C) void {
            JSC.markBinding(@src());

            return shim.cppFn("onReady", .{ ptr, amount, offset });
        }

        pub fn onStart(ptr: JSValue, globalThis: *JSGlobalObject) callconv(.C) void {
            JSC.markBinding(@src());

            return shim.cppFn("onStart", .{ ptr, globalThis });
        }

        pub fn createObject(globalThis: *JSGlobalObject, object: *anyopaque) callconv(.C) JSValue {
            JSC.markBinding(@src());

            return shim.cppFn("createObject", .{ globalThis, object });
        }

        pub fn fromJS(globalThis: *JSGlobalObject, value: JSValue) ?*anyopaque {
            JSC.markBinding(@src());

            return shim.cppFn("fromJS", .{ globalThis, value });
        }

        pub fn construct(globalThis: *JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
            JSC.markBinding(@src());

            if (comptime !@hasDecl(SinkType, "construct")) {
                const Static = struct {
                    pub const message = std.fmt.comptimePrint("{s} is not constructable", .{SinkType.name});
                };
                const err = JSC.SystemError{
                    .message = ZigString.init(Static.message),
                    .code = ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_ILLEGAL_CONSTRUCTOR))),
                };
                globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
                return JSC.JSValue.jsUndefined();
            }

            var allocator = globalThis.bunVM().allocator;
            var this = allocator.create(ThisSink) catch {
                globalThis.vm().throwError(globalThis, Syscall.Error.oom.toJSC(
                    globalThis,
                ));
                return JSC.JSValue.jsUndefined();
            };
            this.sink.construct(allocator);
            return createObject(globalThis, this);
        }

        pub fn finalize(ptr: *anyopaque) callconv(.C) void {
            var this = @ptrCast(*ThisSink, @alignCast(std.meta.alignment(ThisSink), ptr));

            this.sink.finalize();
        }

        pub fn detach(this: *ThisSink) void {
            if (comptime !@hasField(SinkType, "signal"))
                return;

            var ptr = this.sink.signal.ptr;
            if (this.sink.signal.isDead())
                return;
            this.sink.signal.clear();
            const value = @intToEnum(JSValue, @bitCast(JSC.JSValueReprInt, @ptrToInt(ptr)));
            value.unprotect();
            detachPtr(value);
        }

        pub fn detachPtr(ptr: JSValue) callconv(.C) void {
            shim.cppFn("detachPtr", .{ptr});
        }

        fn getThis(globalThis: *JSGlobalObject, callframe: *const JSC.CallFrame) ?*ThisSink {
            return @ptrCast(
                *ThisSink,
                @alignCast(
                    std.meta.alignment(ThisSink),
                    fromJS(
                        globalThis,
                        callframe.this(),
                    ) orelse return null,
                ),
            );
        }

        fn invalidThis(globalThis: *JSGlobalObject) JSValue {
            const err = JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_THIS, "Expected Sink", .{}, globalThis);
            globalThis.vm().throwError(globalThis, err);
            return JSC.JSValue.jsUndefined();
        }

        pub fn write(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            JSC.markBinding(@src());
            var this = getThis(globalThis, callframe) orelse return invalidThis(globalThis);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    globalThis.vm().throwError(globalThis, err);
                    return JSC.JSValue.jsUndefined();
                }
            }

            const args_list = callframe.arguments(4);
            const args = args_list.ptr[0..args_list.len];

            if (args.len == 0 or args[0].isEmptyOrUndefinedOrNull() or args[0].isNumber()) {
                const err = JSC.toTypeError(
                    if (args.len == 0) JSC.Node.ErrorCode.ERR_MISSING_ARGS else JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE,
                    "write() expects a string, ArrayBufferView, or ArrayBuffer",
                    .{},
                    globalThis,
                );
                globalThis.vm().throwError(globalThis, err);
                return JSC.JSValue.jsUndefined();
            }

            const arg = args[0];
            arg.ensureStillAlive();
            defer arg.ensureStillAlive();

            if (arg.asArrayBuffer(globalThis)) |buffer| {
                const slice = buffer.slice();
                if (slice.len == 0) {
                    return JSC.JSValue.jsNumber(0);
                }

                return this.sink.writeBytes(.{ .temporary = bun.ByteList.init(slice) }).toJS(globalThis);
            }

            const str = arg.getZigString(globalThis);
            if (str.len == 0) {
                return JSC.JSValue.jsNumber(0);
            }

            if (str.is16Bit()) {
                return this.sink.writeUTF16(.{ .temporary = bun.ByteList.init(std.mem.sliceAsBytes(str.utf16SliceAligned())) }).toJS(globalThis);
            }

            return this.sink.writeLatin1(.{ .temporary = bun.ByteList.init(str.slice()) }).toJS(globalThis);
        }

        pub fn writeUTF8(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            JSC.markBinding(@src());

            var this = getThis(globalThis, callframe) orelse return invalidThis(globalThis);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    globalThis.vm().throwError(globalThis, err);
                    return JSC.JSValue.jsUndefined();
                }
            }

            const args_list = callframe.arguments(4);
            const args = args_list.ptr[0..args_list.len];
            if (args.len == 0 or !args[0].isString()) {
                const err = JSC.toTypeError(
                    if (args.len == 0) JSC.Node.ErrorCode.ERR_MISSING_ARGS else JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE,
                    "writeUTF8() expects a string",
                    .{},
                    globalThis,
                );
                globalThis.vm().throwError(globalThis, err);
                return JSC.JSValue.jsUndefined();
            }

            const arg = args[0];

            const str = arg.getZigString(globalThis);
            if (str.len == 0) {
                return JSC.JSValue.jsNumber(0);
            }

            if (str.is16Bit()) {
                return this.sink.writeUTF16(.{ .temporary = str.utf16SliceAligned() }).toJS(globalThis);
            }

            return this.sink.writeLatin1(.{ .temporary = str.slice() }).toJS(globalThis);
        }

        pub fn close(globalThis: *JSGlobalObject, sink_ptr: ?*anyopaque) callconv(.C) JSValue {
            JSC.markBinding(@src());
            var this = @ptrCast(*ThisSink, @alignCast(std.meta.alignment(ThisSink), sink_ptr orelse return invalidThis(globalThis)));

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    globalThis.vm().throwError(globalThis, err);
                    return JSC.JSValue.jsUndefined();
                }
            }

            return this.sink.end(null).toJS(globalThis);
        }

        pub fn flush(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            JSC.markBinding(@src());

            var this = getThis(globalThis, callframe) orelse return invalidThis(globalThis);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    globalThis.vm().throwError(globalThis, err);
                    return JSC.JSValue.jsUndefined();
                }
            }

            defer {
                if (comptime @hasField(SinkType, "done") and this.sink.done) {
                    callframe.this().unprotect();
                }
            }

            if (comptime @hasDecl(SinkType, "flushFromJS")) {
                const wait = callframe.argumentsCount() > 0 and
                    callframe.argument(0).isBoolean() and
                    callframe.argument(0).asBoolean();
                return this.sink.flushFromJS(globalThis, wait).result;
            }

            return this.sink.flush().toJS(globalThis);
        }

        pub fn start(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            JSC.markBinding(@src());

            var this = getThis(globalThis, callframe) orelse return invalidThis(globalThis);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    globalThis.vm().throwError(globalThis, err);
                    return JSC.JSValue.jsUndefined();
                }
            }

            if (comptime @hasField(StreamStart, name_)) {
                return this.sink.start(
                    if (callframe.argumentsCount() > 0)
                        StreamStart.fromJSWithTag(
                            globalThis,
                            callframe.argument(0),
                            comptime @field(StreamStart, name_),
                        )
                    else
                        StreamStart{ .empty = {} },
                ).toJS(globalThis);
            }

            return this.sink.start(
                if (callframe.argumentsCount() > 0)
                    StreamStart.fromJS(globalThis, callframe.argument(0))
                else
                    StreamStart{ .empty = {} },
            ).toJS(globalThis);
        }

        pub fn end(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            JSC.markBinding(@src());

            var this = getThis(globalThis, callframe) orelse return invalidThis(globalThis);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    globalThis.vm().throwError(globalThis, err);
                    return JSC.JSValue.jsUndefined();
                }
            }

            defer {
                if (comptime @hasField(SinkType, "done") and this.sink.done) {
                    callframe.this().unprotect();
                }
            }

            return this.sink.endFromJS(globalThis).toJS(globalThis);
        }

        pub fn endWithSink(ptr: *anyopaque, globalThis: *JSGlobalObject) callconv(.C) JSValue {
            JSC.markBinding(@src());

            var this = @ptrCast(*ThisSink, @alignCast(std.meta.alignment(ThisSink), ptr));

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    globalThis.vm().throwError(globalThis, err);
                    return JSC.JSValue.jsUndefined();
                }
            }

            return this.sink.endFromJS(globalThis).toJS(globalThis);
        }

        pub fn assignToStream(globalThis: *JSGlobalObject, stream: JSValue, ptr: *anyopaque, jsvalue_ptr: **anyopaque) JSValue {
            return shim.cppFn("assignToStream", .{ globalThis, stream, ptr, jsvalue_ptr });
        }

        pub const Export = shim.exportFunctions(.{
            .@"finalize" = finalize,
            .@"write" = write,
            .@"close" = close,
            .@"flush" = flush,
            .@"start" = start,
            .@"end" = end,
            .@"construct" = construct,
            .@"endWithSink" = endWithSink,
        });

        comptime {
            if (!JSC.is_bindgen) {
                @export(finalize, .{ .name = Export[0].symbol_name });
                @export(write, .{ .name = Export[1].symbol_name });
                @export(close, .{ .name = Export[2].symbol_name });
                @export(flush, .{ .name = Export[3].symbol_name });
                @export(start, .{ .name = Export[4].symbol_name });
                @export(end, .{ .name = Export[5].symbol_name });
                @export(construct, .{ .name = Export[6].symbol_name });
                @export(endWithSink, .{ .name = Export[7].symbol_name });
            }
        }

        pub const Extern = [_][]const u8{ "createObject", "fromJS", "assignToStream", "onReady", "onClose", "detachPtr" };
    };
}

// pub fn NetworkSocket(comptime tls: bool) type {
//     return struct {
//         const Socket = uws.NewSocketHandler(tls);
//         const ThisSocket = @This();

//         socket: Socket,

//         pub fn connect(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
//             JSC.markBinding(@src());

//             var this = @ptrCast(*ThisSocket, @alignCast(std.meta.alignment(ThisSocket), fromJS(globalThis, callframe.this()) orelse {
//                 const err = JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_THIS, "Expected Socket", .{}, globalThis);
//                 globalThis.vm().throwError(globalThis, err);
//                 return JSC.JSValue.jsUndefined();
//             }));
//         }
//     };
// }

// TODO: make this JSGlobalObject local
// for better security
const ByteListPool = ObjectPool(
    bun.ByteList,
    null,
    true,
    8,
);

pub fn HTTPServerWritable(comptime ssl: bool) type {
    return struct {
        const UWSResponse = uws.NewApp(ssl).Response;
        res: *UWSResponse,
        buffer: bun.ByteList,
        pooled_buffer: ?*ByteListPool.Node = null,
        offset: Blob.SizeType = 0,

        is_listening_for_abort: bool = false,
        wrote: Blob.SizeType = 0,
        callback: anyframe->JSC.Maybe(Blob.SizeType) = undefined,
        has_callback: bool = false,

        allocator: std.mem.Allocator,
        done: bool = false,
        signal: Signal = .{},
        pending_flush: ?*JSC.JSPromise = null,
        wrote_at_start_of_flush: Blob.SizeType = 0,
        globalThis: *JSGlobalObject = undefined,
        highWaterMark: Blob.SizeType = 2048,

        requested_end: bool = false,

        has_backpressure: bool = false,
        end_len: usize = 0,
        aborted: bool = false,

        const log = Output.scoped(.HTTPServerWritable, false);

        pub fn connect(this: *@This(), signal: Signal) void {
            this.signal = signal;
        }

        fn handleWrote(this: *@This(), amount1: usize) void {
            const amount = @truncate(Blob.SizeType, amount1);
            this.offset += amount;
            this.wrote += amount;
            this.buffer.len -|= @truncate(u32, amount);

            if (this.offset >= this.buffer.len) {
                this.offset = 0;
                this.buffer.len = 0;
            }
        }

        fn hasBackpressure(this: *const @This()) bool {
            return this.has_backpressure;
        }

        fn send(this: *@This(), buf: []const u8) bool {
            std.debug.assert(!this.done);
            defer log("send: {d} bytes (backpressure: {d})", .{ buf.len, this.has_backpressure });

            if (this.requested_end and !this.res.state().isHttpWriteCalled()) {
                const success = this.res.tryEnd(buf, this.end_len, false);
                this.has_backpressure = !success;
                return success;
            }

            // uWebSockets lacks a tryWrite() function
            // This means that backpressure will be handled by appending to an "infinite" memory buffer
            // It will do the backpressure handling for us
            // so in this scenario, we just append to the buffer
            // and report success
            if (this.requested_end) {
                this.res.end(buf, false);
                this.has_backpressure = false;
                return true;
            } else {
                const backpressure = this.res.write(buf);
                this.has_backpressure = backpressure;
                return true;
            }

            unreachable;
        }

        fn readableSlice(this: *@This()) []const u8 {
            return this.buffer.ptr[this.offset..this.buffer.cap][0..this.buffer.len];
        }

        pub fn onWritable(this: *@This(), write_offset: c_ulong, _: *UWSResponse) callconv(.C) bool {
            log("onWritable ({d})", .{write_offset});

            if (this.done) {
                this.res.endStream(false);
                this.finalize();
                return false;
            }

            // do not write more than available
            // if we do, it will cause this to be delayed until the next call, each time
            const to_write = @minimum(@truncate(Blob.SizeType, write_offset), @as(Blob.SizeType, this.buffer.len));

            // figure out how much data exactly to write
            const readable = this.readableSlice()[0..to_write];
            if (!this.send(readable)) {
                // if we were unable to send it, retry
                this.res.onWritable(*@This(), onWritable, this);
                return true;
            }

            this.handleWrote(@truncate(Blob.SizeType, readable.len));
            const initial_wrote = this.wrote;

            if (this.buffer.len > 0 and !this.done) {
                this.res.onWritable(*@This(), onWritable, this);
                return true;
            }

            // flush the javascript promise from calling .flush()
            this.flushPromise();

            if (this.has_callback) {
                this.has_callback = false;

                var callback = this.callback;
                this.callback = undefined;
                // TODO: clarify what the boolean means
                resume callback;
            }

            // pending_flush or callback could have caused another send()
            // so we check again if we should report readiness
            if (!this.done and !this.requested_end and !this.hasBackpressure()) {
                const pending = @truncate(Blob.SizeType, write_offset) -| to_write;
                const written_after_flush = this.wrote - initial_wrote;
                const to_report = pending - @minimum(written_after_flush, pending);

                if ((written_after_flush == initial_wrote and pending == 0) or to_report > 0) {
                    this.signal.ready(to_report, null);
                }
            }

            return false;
        }

        pub fn start(this: *@This(), stream_start: StreamStart) JSC.Node.Maybe(void) {
            if (this.res.hasResponded()) {
                this.done = true;
                this.signal.close(null);
                return .{ .result = {} };
            }

            this.wrote = 0;
            this.wrote_at_start_of_flush = 0;
            this.flushPromise();

            if (this.buffer.cap == 0) {
                std.debug.assert(this.pooled_buffer == null);
                if (comptime FeatureFlags.http_buffer_pooling) {
                    if (ByteListPool.getIfExists()) |pooled_node| {
                        this.pooled_buffer = pooled_node;
                        this.buffer = this.pooled_buffer.?.data;
                    }
                }
            }

            this.buffer.len = 0;

            switch (stream_start) {
                .chunk_size => |chunk_size| {
                    if (chunk_size > 0) {
                        this.highWaterMark = chunk_size;
                    }
                },
                else => {},
            }

            var list = this.buffer.listManaged(this.allocator);
            list.clearRetainingCapacity();
            list.ensureTotalCapacityPrecise(this.highWaterMark) catch return .{ .err = Syscall.Error.oom };
            this.buffer.update(list);

            this.done = false;

            this.signal.start();

            log("start({d})", .{this.highWaterMark});

            return .{ .result = {} };
        }

        fn flushFromJSNoWait(this: *@This()) JSC.Node.Maybe(JSValue) {
            if (this.hasBackpressure() or this.done) {
                return .{ .result = JSValue.jsNumberFromInt32(0) };
            }

            const slice = this.readableSlice();
            if (slice.len == 0) {
                return .{ .result = JSValue.jsNumberFromInt32(0) };
            }

            const success = this.send(slice);
            if (success) {
                this.handleWrote(@truncate(Blob.SizeType, slice.len));
                return .{ .result = JSValue.jsNumber(slice.len) };
            }

            return .{ .result = JSValue.jsNumberFromInt32(0) };
        }

        pub fn flushFromJS(this: *@This(), globalThis: *JSGlobalObject, wait: bool) JSC.Node.Maybe(JSValue) {
            log("flushFromJS({s})", .{wait});
            if (!wait) {
                return this.flushFromJSNoWait();
            }

            if (this.pending_flush) |prom| {
                return .{ .result = prom.asValue(globalThis) };
            }

            if (this.buffer.len == 0 or this.done) {
                return .{ .result = JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumberFromInt32(0)) };
            }

            if (!this.hasBackpressure()) {
                const slice = this.readableSlice();
                assert(slice.len > 0);
                const success = this.send(slice);
                if (success) {
                    this.handleWrote(@truncate(Blob.SizeType, slice.len));
                    return .{ .result = JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(slice.len)) };
                }

                this.res.onWritable(*@This(), onWritable, this);
            }
            this.wrote_at_start_of_flush = this.wrote;
            this.pending_flush = JSC.JSPromise.create(globalThis);
            this.globalThis = globalThis;
            var promise_value = this.pending_flush.?.asValue(globalThis);
            promise_value.protect();

            return .{ .result = promise_value };
        }

        pub fn flush(this: *@This()) JSC.Node.Maybe(void) {
            log("flush()", .{});
            if (!this.hasBackpressure() or this.done) {
                return .{ .result = {} };
            }

            if (this.res.hasResponded()) {
                this.done = true;
                this.signal.close(null);
            }

            return .{ .result = {} };
        }

        pub fn write(this: *@This(), data: StreamResult) StreamResult.Writable {
            if (this.done or this.requested_end) {
                return .{ .owned = 0 };
            }

            const bytes = data.slice();
            const len = @truncate(Blob.SizeType, bytes.len);
            log("write({d})", .{bytes.len});

            if (this.buffer.len == 0 and len >= this.highWaterMark) {
                // fast path:
                // - large-ish chunk
                // - no backpressure
                if (this.send(bytes)) {
                    this.handleWrote(len);
                    return .{ .owned = len };
                }

                _ = this.buffer.write(this.allocator, bytes) catch {
                    return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
                };
            } else if (this.buffer.len + len >= this.highWaterMark) {
                // TODO: attempt to write both in a corked buffer?
                _ = this.buffer.write(this.allocator, bytes) catch {
                    return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
                };
                const slice = this.readableSlice();
                if (this.send(slice)) {
                    this.handleWrote(slice.len);
                    this.buffer.len = 0;
                    return .{ .owned = len };
                }
            } else {
                // queue the data
                // do not send it
                _ = this.buffer.write(this.allocator, bytes) catch {
                    return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
                };
                return .{ .owned = len };
            }

            this.res.onWritable(*@This(), onWritable, this);

            return .{ .owned = len };
        }
        pub const writeBytes = write;
        pub fn writeLatin1(this: *@This(), data: StreamResult) StreamResult.Writable {
            if (this.done or this.requested_end) {
                return .{ .owned = 0 };
            }

            if (this.res.hasResponded()) {
                this.signal.close(null);
                this.done = true;
                return .{ .done = {} };
            }

            const bytes = data.slice();
            const len = @truncate(Blob.SizeType, bytes.len);
            log("writeLatin1({d})", .{bytes.len});

            if (this.buffer.len == 0 and len >= this.highWaterMark) {
                var do_send = true;
                // common case
                if (strings.isAllASCII(bytes)) {
                    // fast path:
                    // - large-ish chunk
                    // - no backpressure
                    if (this.send(bytes)) {
                        this.handleWrote(bytes.len);
                        return .{ .owned = len };
                    }
                    do_send = false;
                }

                _ = this.buffer.writeLatin1(this.allocator, bytes) catch {
                    return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
                };

                if (do_send) {
                    if (this.send(this.readableSlice())) {
                        this.handleWrote(bytes.len);
                        return .{ .owned = len };
                    }
                }
            } else if (this.buffer.len + len >= this.highWaterMark) {
                // kinda fast path:
                // - combined chunk is large enough to flush automatically
                // - no backpressure
                _ = this.buffer.writeLatin1(this.allocator, bytes) catch {
                    return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
                };
                const readable = this.readableSlice();
                if (this.send(readable)) {
                    this.handleWrote(readable.len);
                    return .{ .owned = len };
                }
            } else {
                _ = this.buffer.writeLatin1(this.allocator, bytes) catch {
                    return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
                };
                return .{ .owned = len };
            }

            this.res.onWritable(*@This(), onWritable, this);

            return .{ .owned = len };
        }
        pub fn writeUTF16(this: *@This(), data: StreamResult) StreamResult.Writable {
            if (this.done or this.requested_end) {
                return .{ .owned = 0 };
            }

            if (this.res.hasResponded()) {
                this.signal.close(null);
                this.done = true;
                return .{ .done = {} };
            }

            const bytes = data.slice();

            log("writeUTF16({d})", .{bytes.len});

            // we must always buffer UTF-16
            // we assume the case of all-ascii UTF-16 string is pretty uncommon
            const written = this.buffer.writeUTF16(this.allocator, @alignCast(2, std.mem.bytesAsSlice(u16, bytes))) catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };

            const readable = this.readableSlice();

            if (readable.len >= this.highWaterMark or this.hasBackpressure()) {
                if (this.send(readable)) {
                    this.handleWrote(readable.len);
                    return .{ .owned = @intCast(Blob.SizeType, written) };
                }

                this.res.onWritable(*@This(), onWritable, this);
            }

            return .{ .owned = @intCast(Blob.SizeType, written) };
        }

        // In this case, it's always an error
        pub fn end(this: *@This(), err: ?Syscall.Error) JSC.Node.Maybe(void) {
            log("end({s})", .{err});

            if (this.requested_end) {
                return .{ .result = {} };
            }

            if (this.done or this.res.hasResponded()) {
                this.signal.close(err);
                this.done = true;
                this.finalize();
                return .{ .result = {} };
            }

            this.requested_end = true;
            const readable = this.readableSlice();
            this.end_len = readable.len;

            if (readable.len == 0) {
                this.signal.close(err);
                this.done = true;
                // we do not close the stream here
                // this.res.endStream(false);
                this.finalize();
                return .{ .result = {} };
            }

            return .{ .result = {} };
        }

        pub fn endFromJS(this: *@This(), globalThis: *JSGlobalObject) JSC.Node.Maybe(JSValue) {
            log("endFromJS()", .{});

            if (this.requested_end) {
                return .{ .result = JSC.JSValue.jsNumber(0) };
            }

            if (this.done or this.res.hasResponded()) {
                this.signal.close(null);
                this.done = true;
                this.finalize();
                return .{ .result = JSC.JSValue.jsNumber(0) };
            }

            this.requested_end = true;
            const readable = this.readableSlice();
            this.end_len = readable.len;

            if (readable.len > 0) {
                if (!this.send(readable)) {
                    this.pending_flush = JSC.JSPromise.create(globalThis);
                    this.globalThis = globalThis;
                    const value = this.pending_flush.?.asValue(globalThis);
                    value.protect();
                    return .{ .result = value };
                }
            } else {
                this.res.end("", false);
            }

            this.done = true;
            this.flushPromise();
            this.signal.close(null);
            this.done = true;
            this.finalize();

            return .{ .result = JSC.JSValue.jsNumber(this.wrote) };
        }

        pub fn sink(this: *@This()) Sink {
            return Sink.init(this);
        }

        pub fn onAborted(this: *@This(), _: *UWSResponse) void {
            log("onAborted()", .{});
            this.signal.close(null);
            this.done = true;
            this.aborted = true;
            this.flushPromise();
            this.finalize();
        }

        pub fn destroy(this: *@This()) void {
            log("destroy()", .{});
            var bytes = this.buffer.listManaged(this.allocator);
            if (bytes.capacity > 0) {
                this.buffer = bun.ByteList.init("");
                bytes.deinit();
            }

            this.allocator.destroy(this);
        }

        // This can be called _many_ times for the same instance
        // so it must zero out state instead of make it
        pub fn finalize(this: *@This()) void {
            log("finalize()", .{});

            if (!this.done) {
                this.done = true;
                this.res.endStream(false);
            }

            if (comptime !FeatureFlags.http_buffer_pooling) {
                assert(this.pooled_buffer == null);
            }

            if (this.pooled_buffer) |pooled| {
                this.buffer.len = 0;
                pooled.data = this.buffer;
                this.buffer = bun.ByteList.init("");
                this.pooled_buffer = null;
                pooled.release();
            } else if (this.buffer.cap == 0) {} else if (FeatureFlags.http_buffer_pooling and !ByteListPool.full()) {
                const buffer = this.buffer;
                this.buffer = bun.ByteList.init("");
                ByteListPool.push(this.allocator, buffer);
            } else {
                // Don't release this buffer until destroy() is called
                this.buffer.len = 0;
            }
        }

        pub fn flushPromise(this: *@This()) void {
            if (this.pending_flush) |prom| {
                log("flushPromise()", .{});

                this.pending_flush = null;
                const globalThis = this.globalThis;
                prom.asValue(globalThis).unprotect();
                prom.resolve(globalThis, JSC.JSValue.jsNumber(this.wrote -| this.wrote_at_start_of_flush));
                this.wrote_at_start_of_flush = this.wrote;
            }
        }

        const name = if (ssl) "HTTPSResponseSink" else "HTTPResponseSink";
        pub const JSSink = NewJSSink(@This(), name);
    };
}
pub const HTTPSResponseSink = HTTPServerWritable(true);
pub const HTTPResponseSink = HTTPServerWritable(false);

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
        pending_err: ?Syscall.Error = null,
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

        pub fn getError(this: *This) ?Syscall.Error {
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
                const arguments = callFrame.arguments(3);
                var this = arguments.ptr[0].asPtr(ReadableStreamSourceType);
                const view = arguments.ptr[1];
                view.ensureStillAlive();
                this.globalThis = globalThis;
                var buffer = view.asArrayBuffer(globalThis) orelse return JSC.JSValue.jsUndefined();
                return processResult(
                    globalThis,
                    arguments.ptr[2],
                    this.pullFromJS(buffer.slice(), view),
                );
            }
            pub fn start(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                var this = callFrame.argument(0).asPtr(ReadableStreamSourceType);
                this.globalThis = globalThis;
                switch (this.startFromJS()) {
                    .empty => return JSValue.jsNumber(0),
                    .ready => return JSValue.jsNumber(16384),
                    .chunk_size => |size| return JSValue.jsNumber(size),
                    .err => |err| {
                        globalThis.vm().throwError(globalThis, err.toJSC(globalThis));
                        return JSC.JSValue.jsUndefined();
                    },
                    else => unreachable,
                }
            }

            pub fn processResult(globalThis: *JSGlobalObject, flags: JSValue, result: StreamResult) JSC.JSValue {
                switch (result) {
                    .err => |err| {
                        globalThis.vm().throwError(globalThis, err.toJSC(globalThis));
                        return JSValue.jsUndefined();
                    },
                    .temporary_and_done, .owned_and_done, .into_array_and_done => {
                        JSC.C.JSObjectSetPropertyAtIndex(globalThis, flags.asObjectRef(), 0, JSValue.jsBoolean(true).asObjectRef(), null);
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
                    JSC.NewFunction(globalThis, null, 1, JSReadableStreamSource.pull, true),
                    JSC.NewFunction(globalThis, null, 1, JSReadableStreamSource.start, true),
                    JSC.NewFunction(globalThis, null, 1, JSReadableStreamSource.cancel, true),
                    JSC.NewFunction(globalThis, null, 1, JSReadableStreamSource.setClose, true),
                    JSC.NewFunction(globalThis, null, 1, JSReadableStreamSource.deinit, true),
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
        std.debug.assert(buffer.ptr != temporary.ptr);
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

pub const PipeFunction = fn (ctx: *anyopaque, stream: StreamResult, allocator: std.mem.Allocator) void;

pub const Pipe = struct {
    ctx: ?*anyopaque = null,
    onPipe: ?PipeFunction = null,

    pub fn New(comptime Type: type, comptime Function: anytype) type {
        return struct {
            pub fn pipe(self: *anyopaque, stream: StreamResult, allocator: std.mem.Allocator) void {
                Function(@ptrCast(*Type, @alignCast(@alignOf(Type), self)), stream, allocator);
            }

            pub fn init(self: *Type) Pipe {
                return Pipe{
                    .ctx = self,
                    .onPipe = pipe,
                };
            }
        };
    }
};

pub const ByteStream = struct {
    buffer: std.ArrayList(u8) = .{
        .allocator = bun.default_allocator,
        .items = &.{},
        .capacity = 0,
    },
    has_received_last_chunk: bool = false,
    pending: StreamResult.Pending = StreamResult.Pending{
        .frame = undefined,
        .result = .{ .done = {} },
    },
    done: bool = false,
    pending_buffer: []u8 = &.{},
    pending_value: JSC.Strong = .{},
    offset: usize = 0,
    highWaterMark: Blob.SizeType = 0,
    pipe: Pipe = .{},
    size_hint: Blob.SizeType = 0,

    pub const tag = ReadableStream.Tag.Bytes;

    pub fn setup(this: *ByteStream) void {
        this.* = .{};
    }

    pub fn onStart(this: *@This()) StreamStart {
        if (this.has_received_last_chunk and this.buffer.items.len == 0) {
            return .{ .empty = void{} };
        }

        if (this.has_received_last_chunk) {
            return .{ .chunk_size = @truncate(Blob.SizeType, @minimum(1024 * 1024 * 2, this.buffer.items.len)) };
        }

        if (this.highWaterMark == 0) {
            return .{ .ready = void{} };
        }

        return .{ .chunk_size = @maximum(this.highWaterMark, std.mem.page_size) };
    }

    pub fn value(this: *@This()) JSValue {
        const result = this.pending_value.get() orelse {
            return .zero;
        };
        this.pending_value.clear();
        return result;
    }

    pub fn isCancelled(this: *const @This()) bool {
        return @fieldParentPtr(Source, "context", this).cancelled;
    }

    pub fn unpipe(this: *@This()) void {
        this.pipe.ctx = null;
        this.pipe.onPipe = null;
        if (!this.parent().deinited) {
            this.parent().deinited = true;
            bun.default_allocator.destroy(this.parent());
        }
    }

    pub fn onData(
        this: *@This(),
        stream: StreamResult,
        allocator: std.mem.Allocator,
    ) void {
        JSC.markBinding(@src());
        if (this.done) {
            if (stream.isDone() and (stream == .owned or stream == .owned_and_done)) {
                if (stream == .owned) allocator.free(stream.owned.slice());
                if (stream == .owned_and_done) allocator.free(stream.owned_and_done.slice());
            }

            return;
        }

        std.debug.assert(!this.has_received_last_chunk);
        this.has_received_last_chunk = stream.isDone();

        if (this.pipe.ctx != null) {
            this.pipe.onPipe.?(this.pipe.ctx.?, stream, allocator);
            return;
        }

        const chunk = stream.slice();

        if (this.pending.state == .pending) {
            std.debug.assert(this.buffer.items.len == 0);
            var to_copy = this.pending_buffer[0..@minimum(chunk.len, this.pending_buffer.len)];
            const pending_buffer_len = this.pending_buffer.len;
            std.debug.assert(to_copy.ptr != chunk.ptr);
            @memcpy(to_copy.ptr, chunk.ptr, to_copy.len);
            this.pending_buffer = &.{};

            const is_really_done = this.has_received_last_chunk and to_copy.len <= pending_buffer_len;

            if (is_really_done) {
                this.done = true;
                this.pending.result = .{
                    .into_array_and_done = .{
                        .value = this.value(),
                        .len = @truncate(Blob.SizeType, to_copy.len),
                    },
                };
            } else {
                this.pending.result = .{
                    .into_array = .{
                        .value = this.value(),
                        .len = @truncate(Blob.SizeType, to_copy.len),
                    },
                };
            }

            const remaining = chunk[to_copy.len..];
            if (remaining.len > 0)
                this.append(stream, to_copy.len, allocator) catch @panic("Out of memory while copying request body");

            this.pending.run();
            return;
        }

        this.append(stream, 0, allocator) catch @panic("Out of memory while copying request body");
    }

    pub fn append(
        this: *@This(),
        stream: StreamResult,
        offset: usize,
        allocator: std.mem.Allocator,
    ) !void {
        const chunk = stream.slice()[offset..];

        if (this.buffer.capacity == 0) {
            switch (stream) {
                .owned => |owned| {
                    this.buffer = owned.listManaged(allocator);
                    this.offset += offset;
                },
                .owned_and_done => |owned| {
                    this.buffer = owned.listManaged(allocator);
                    this.offset += offset;
                },
                .temporary_and_done, .temporary => {
                    this.buffer = try std.ArrayList(u8).initCapacity(bun.default_allocator, chunk.len);
                    this.buffer.appendSliceAssumeCapacity(chunk);
                },
                else => unreachable,
            }
            return;
        }

        switch (stream) {
            .temporary_and_done, .temporary => {
                try this.buffer.appendSlice(chunk);
            },
            // We don't support the rest of these yet
            else => unreachable,
        }
    }

    pub fn setValue(this: *@This(), view: JSC.JSValue) void {
        JSC.markBinding(@src());
        this.pending_value.set(this.parent().globalThis, view);
    }

    pub fn parent(this: *@This()) *Source {
        return @fieldParentPtr(Source, "context", this);
    }

    pub fn onPull(this: *@This(), buffer: []u8, view: JSC.JSValue) StreamResult {
        JSC.markBinding(@src());
        std.debug.assert(buffer.len > 0);

        if (this.buffer.items.len > 0) {
            std.debug.assert(this.value() == .zero);
            const to_write = @minimum(
                this.buffer.items.len - this.offset,
                buffer.len,
            );
            var remaining_in_buffer = this.buffer.items[this.offset..][0..to_write];

            @memcpy(buffer.ptr, this.buffer.items.ptr + this.offset, to_write);

            if (this.offset + to_write == this.buffer.items.len) {
                this.offset = 0;
                this.buffer.items.len = 0;
            } else {
                this.offset += to_write;
            }

            if (this.has_received_last_chunk and remaining_in_buffer.len == 0) {
                this.buffer.clearAndFree();
                this.done = true;

                return .{
                    .into_array_and_done = .{
                        .value = view,
                        .len = @truncate(Blob.SizeType, to_write),
                    },
                };
            }

            return .{
                .into_array = .{
                    .value = view,
                    .len = @truncate(Blob.SizeType, to_write),
                },
            };
        }

        if (this.has_received_last_chunk) {
            return .{
                .done = void{},
            };
        }

        this.pending_buffer = buffer;
        this.setValue(view);

        return .{
            .pending = &this.pending,
        };
    }

    pub fn onCancel(this: *@This()) void {
        JSC.markBinding(@src());
        const view = this.value();
        if (this.buffer.capacity > 0) this.buffer.clearAndFree();
        this.done = true;
        this.pending_value.deinit();

        if (view != .zero) {
            this.pending_buffer = &.{};
            this.pending.result = .{ .done = {} };
            this.pending.run();
        }
    }

    pub fn deinit(this: *@This()) void {
        JSC.markBinding(@src());
        if (this.buffer.capacity > 0) this.buffer.clearAndFree();

        this.pending_value.deinit();
        if (!this.done) {
            this.done = true;

            this.pending_buffer = &.{};
            this.pending.result = .{ .done = {} };
            this.pending.run();
        }

        bun.default_allocator.destroy(this.parent());
    }

    pub const Source = ReadableStreamSource(@This(), "ByteStream", onStart, onPull, onCancel, deinit);
};

pub const FileBlobLoader = struct {
    buf: []u8 = &[_]u8{},
    view: JSC.Strong = .{},
    fd: JSC.Node.FileDescriptor = 0,
    auto_close: bool = false,
    loop: *JSC.EventLoop = undefined,
    mode: JSC.Node.Mode = 0,
    store: *Blob.Store,
    total_read: Blob.SizeType = 0,
    finalized: bool = false,
    callback: anyframe = undefined,
    buffered_data: bun.ByteList = .{},
    pending: StreamResult.Pending = StreamResult.Pending{
        .frame = undefined,
        .state = .none,
        .result = .{ .done = {} },
    },
    cancelled: bool = false,
    user_chunk_size: Blob.SizeType = 0,
    scheduled_count: u32 = 0,
    concurrent: Concurrent = Concurrent{},
    started: bool = false,
    stored_global_this_: ?*JSC.JSGlobalObject = null,
    poll_ref: JSC.PollRef = .{},
    has_adjusted_pipe_size_on_linux: bool = false,
    finished: bool = false,

    /// When we have some way of knowing that EOF truly is the write end of the
    /// pipe being closed
    /// Set this to true so we automatically mark it as done
    /// This is used in Bun.spawn() to automatically close stdout and stderr
    /// when the process exits
    close_on_eof: bool = false,

    signal: JSC.WebCore.Signal = .{},

    pub usingnamespace NewReadyWatcher(@This(), .read, ready);

    pub inline fn globalThis(this: *FileBlobLoader) *JSC.JSGlobalObject {
        return this.stored_global_this_ orelse @fieldParentPtr(Source, "context", this).globalThis;
    }

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

    pub fn finish(this: *FileBlobLoader) void {
        if (this.finished) return;
        this.finished = true;
        this.close_on_eof = true;

        // we are done
        // resolve any promises with done
        // but there could still be data in the pipe
        // so we shouldn't actually end it, just means that we no longer will retry on EGAGAIN
        if (this.pending.state == .pending) {
            if (this.buffered_data.len > 0) {
                this.pending.result = .{ .owned = this.buffered_data };
                this.buffered_data = .{};
            } else {
                this.pending.result = .{ .done = {} };
            }
            this.pending.run();
        }
    }

    const Concurrent = struct {
        read: Blob.SizeType = 0,
        task: NetworkThread.Task = .{ .callback = Concurrent.taskCallback },
        completion: AsyncIO.Completion = undefined,
        read_frame: anyframe = undefined,
        chunk_size: Blob.SizeType = 0,
        main_thread_task: JSC.AnyTask = .{ .callback = onJSThread, .ctx = null },
        concurrent_task: JSC.ConcurrentTask = .{},

        pub fn taskCallback(task: *NetworkThread.Task) void {
            var this = @fieldParentPtr(FileBlobLoader, "concurrent", @fieldParentPtr(Concurrent, "task", task));
            var frame = bun.default_allocator.create(@Frame(runAsync)) catch unreachable;
            _ = @asyncCall(std.mem.asBytes(frame), undefined, runAsync, .{this});
        }

        pub fn onRead(this: *FileBlobLoader, completion: *HTTPClient.NetworkThread.Completion, result: AsyncIO.ReadError!usize) void {
            this.concurrent.read = @truncate(Blob.SizeType, result catch |err| {
                if (@hasField(HTTPClient.NetworkThread.Completion, "result")) {
                    this.pending.result = .{
                        .err = Syscall.Error{
                            .errno = @intCast(Syscall.Error.Int, -completion.result),
                            .syscall = .read,
                        },
                    };
                } else {
                    this.pending.result = .{
                        .err = Syscall.Error{
                            // this is too hacky
                            .errno = @truncate(Syscall.Error.Int, @intCast(u16, @maximum(1, @errorToInt(err)))),
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
                    switch (Syscall.read(this.fd, remaining[0..to_read])) {
                        .err => |err| {
                            const retry = std.os.E.AGAIN;

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
                var this_frame = bun.default_allocator.create(std.meta.Child(@TypeOf(_frame))) catch unreachable;
                this_frame.* = _frame.*;
                this.concurrent.read_frame = this_frame;
            }

            scheduleMainThreadTask(this);
        }

        pub fn onJSThread(task_ctx: *anyopaque) void {
            var this: *FileBlobLoader = bun.cast(*FileBlobLoader, task_ctx);
            const view = this.view.get().?;
            defer this.view.clear();

            if (this.finalized and this.scheduled_count > 0) {
                this.pending.run();
                this.scheduled_count -= 1;

                this.deinit();

                return;
            }

            if (this.pending.state == .pending and this.pending.result == .err and this.concurrent.read == 0) {
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

            this.pending.result = this.handleReadChunk(@as(usize, this.concurrent.read), view, false, this.buf);
            this.pending.run();
            this.scheduled_count -= 1;
            if (this.pending.result.isDone()) {
                this.finalize();
            }
        }

        pub fn scheduleMainThreadTask(this: *FileBlobLoader) void {
            this.concurrent.main_thread_task.ctx = this;
            this.loop.enqueueTaskConcurrent(this.concurrent.concurrent_task.from(&this.concurrent.main_thread_task));
        }

        fn runAsync(this: *FileBlobLoader) void {
            this.concurrent.read = 0;

            Concurrent.scheduleRead(this);

            suspend {
                bun.default_allocator.destroy(@frame());
            }
        }
    };

    pub fn scheduleAsync(this: *FileReader, chunk_size: Blob.SizeType) void {
        this.scheduled_count += 1;
        this.poll_ref.ref(this.globalThis().bunVM());
        std.debug.assert(this.started);
        NetworkThread.init() catch {};
        this.concurrent.chunk_size = chunk_size;
        NetworkThread.global.schedule(.{ .head = &this.concurrent.task, .tail = &this.concurrent.task, .len = 1 });
    }

    // macOS default pipe size is page_size, 16k, or 64k. It changes based on how much was written
    // Linux default pipe size is 16 pages of memory
    const default_fifo_chunk_size = 64 * 1024;
    const default_file_chunk_size = 1024 * 1024 * 2;

    pub fn onStart(this: *FileBlobLoader) StreamStart {
        var file = &this.store.data.file;
        std.debug.assert(!this.started);
        this.started = true;
        var file_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var auto_close = this.auto_close;
        defer this.auto_close = auto_close;
        var fd = if (!auto_close)
            file.pathlike.fd
        else switch (Syscall.open(file.pathlike.path.sliceZ(&file_buf), std.os.O.RDONLY | std.os.O.NONBLOCK | std.os.O.CLOEXEC, 0)) {
            .result => |_fd| _fd,
            .err => |err| {
                this.deinit();
                return .{ .err = err.withPath(file.pathlike.path.slice()) };
            },
        };

        if (!auto_close) {
            // ensure we have non-blocking IO set
            switch (Syscall.fcntl(fd, std.os.F.GETFL, 0)) {
                .err => return .{ .err = Syscall.Error.fromCode(std.os.E.BADF, .fcntl) },
                .result => |flags| {
                    // if we do not, clone the descriptor and set non-blocking
                    // it is important for us to clone it so we don't cause Weird Things to happen
                    if ((flags & std.os.O.NONBLOCK) == 0) {
                        auto_close = true;
                        fd = switch (Syscall.fcntl(fd, std.os.F.DUPFD, 0)) {
                            .result => |_fd| @intCast(@TypeOf(fd), _fd),
                            .err => |err| return .{ .err = err },
                        };

                        switch (Syscall.fcntl(fd, std.os.F.SETFL, flags | std.os.O.NONBLOCK)) {
                            .err => |err| return .{ .err = err },
                            .result => |_| {},
                        }
                    }
                },
            }
        }

        const stat: std.os.Stat = switch (Syscall.fstat(fd)) {
            .result => |result| result,
            .err => |err| {
                if (auto_close) {
                    _ = Syscall.close(fd);
                }
                this.deinit();
                return .{ .err = err.withPath(file.pathlike.path.slice()) };
            },
        };

        if (std.os.S.ISDIR(stat.mode)) {
            const err = Syscall.Error.fromCode(.ISDIR, .fstat);
            if (auto_close) {
                _ = Syscall.close(fd);
            }
            this.deinit();
            return .{ .err = err };
        }

        if (std.os.S.ISSOCK(stat.mode)) {
            const err = Syscall.Error.fromCode(.INVAL, .fstat);

            if (auto_close) {
                _ = Syscall.close(fd);
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
                _ = Syscall.close(fd);
            }
            this.deinit();
            return .{ .empty = {} };
        }

        this.fd = fd;
        this.auto_close = auto_close;

        const chunk_size = this.calculateChunkSize(std.math.maxInt(usize));
        this.signal.start();
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

    pub fn onPullInto(this: *FileBlobLoader, buffer: []u8, view: JSC.JSValue) StreamResult {
        const chunk_size = this.calculateChunkSize(std.math.maxInt(usize));
        std.debug.assert(this.started);

        if (this.buffered_data.len > 0) {
            const data = this.buffered_data;
            this.buffered_data.len = 0;
            this.buffered_data.cap = 0;
            return .{ .owned = data };
        }

        switch (chunk_size) {
            0 => {
                std.debug.assert(this.store.data.file.seekable orelse false);
                this.finalize();
                return .{ .done = {} };
            },
            run_on_different_thread_size...std.math.maxInt(@TypeOf(chunk_size)) => {
                this.view.set(this.globalThis(), view);
                // should never be reached
                this.pending.result = .{
                    .err = Syscall.Error.todo,
                };
                this.buf = buffer;

                this.scheduleAsync(@truncate(Blob.SizeType, chunk_size));

                return .{ .pending = &this.pending };
            },
            else => {},
        }

        return this.read(buffer, view, null);
    }

    fn maybeAutoClose(this: *FileBlobLoader) void {
        if (this.auto_close) {
            _ = Syscall.close(this.fd);
            this.auto_close = false;
        }
    }

    fn handleReadChunk(this: *FileBlobLoader, result: usize, view: JSC.JSValue, owned: bool, buf: []u8) StreamResult {
        std.debug.assert(this.started);

        this.total_read += @intCast(Blob.SizeType, result);
        const remaining: Blob.SizeType = if (this.store.data.file.seekable orelse false)
            this.store.data.file.max_size -| this.total_read
        else
            @as(Blob.SizeType, std.math.maxInt(Blob.SizeType));

        // this handles:
        // - empty file
        // - stream closed for some reason
        // - FIFO returned EOF
        if ((result == 0 and (remaining == 0 or this.close_on_eof))) {
            this.finalize();
            return .{ .done = {} };
        }

        const has_more = remaining > 0;

        if (!has_more) {
            if (owned) {
                return .{ .owned_and_done = bun.ByteList.init(buf) };
            }
            return .{ .into_array_and_done = .{ .len = @truncate(Blob.SizeType, result), .value = view } };
        }

        if (owned) {
            return .{ .owned = bun.ByteList.init(buf) };
        }

        return .{ .into_array = .{ .len = @truncate(Blob.SizeType, result), .value = view } };
    }

    pub fn read(
        this: *FileBlobLoader,
        read_buf: []u8,
        view: JSC.JSValue,
        /// provided via kqueue(), only on macOS
        available_to_read: ?c_int,
    ) StreamResult {
        std.debug.assert(this.started);
        std.debug.assert(read_buf.len > 0);

        if (this.fd == std.math.maxInt(JSC.Node.FileDescriptor)) {
            return .{ .done = {} };
        }

        var buf_to_use = read_buf;
        var free_buffer_on_error: bool = false;

        // if it's a pipe, we really don't know what to expect what the max size will be
        // if the pipe is sending us WAY bigger data than what we can fit in the buffer
        // we allocate a new buffer of up to 4 MB
        if (std.os.S.ISFIFO(this.mode) and view != .zero) {
            outer: {
                var len: c_int = available_to_read orelse 0;

                // macOS FIONREAD doesn't seem to work here
                // but we can get this information from the kqueue callback so we don't need to
                if (comptime Environment.isLinux) {
                    if (len == 0) {
                        const FIONREAD = if (Environment.isLinux) std.os.linux.T.FIONREAD else bun.C.FIONREAD;
                        const rc: c_int = std.c.ioctl(this.fd, FIONREAD, &len);
                        if (rc != 0) {
                            len = 0;
                        }

                        // In  Linux  versions  before 2.6.11, the capacity of a
                        // pipe was the same as the system page size (e.g., 4096
                        // bytes on i386).  Since Linux 2.6.11, the pipe
                        // capacity is 16 pages (i.e., 65,536 bytes in a system
                        // with a page size of 4096 bytes).  Since Linux 2.6.35,
                        // the default pipe capacity is 16 pages, but the
                        // capacity can be queried  and  set  using  the
                        // fcntl(2) F_GETPIPE_SZ and F_SETPIPE_SZ operations.
                        // See fcntl(2) for more information.

                        //:# define F_SETPIPE_SZ    1031    /* Set pipe page size array.
                        const F_SETPIPE_SZ = 1031;
                        const F_GETPIPE_SZ = 1032;

                        if (!this.has_adjusted_pipe_size_on_linux) {
                            if (len + 1024 > 16 * std.mem.page_size) {
                                this.has_adjusted_pipe_size_on_linux = true;
                                var pipe_len: c_int = 0;
                                _ = std.c.fcntl(this.fd, F_GETPIPE_SZ, &pipe_len);

                                if (pipe_len <= 16 * std.mem.page_size) {
                                    var out_size: c_int = 512 * 1024;
                                    _ = std.c.fcntl(this.fd, F_SETPIPE_SZ, &out_size);
                                }
                            }
                        }
                    }
                }
                if (len > read_buf.len * 10 and read_buf.len < std.mem.page_size) {
                    // then we need to allocate a buffer
                    // to read into
                    // this
                    buf_to_use = bun.default_allocator.alloc(
                        u8,
                        @intCast(
                            usize,
                            @minimum(
                                len,
                                1024 * 1024 * 4,
                            ),
                        ),
                    ) catch break :outer;
                    free_buffer_on_error = true;
                }
            }
        }

        const rc = Syscall.read(this.fd, buf_to_use);

        switch (rc) {
            .err => |err| {
                const retry = std.os.E.AGAIN;
                const errno = brk: {
                    const _errno = err.getErrno();
                    if (comptime Environment.isLinux) {
                        // EPERM and its a FIFO on Linux? Trying to read past a FIFO which has already
                        // sent a 0
                        // Let's retry later.
                        if (std.os.S.ISFIFO(this.mode) and
                            !this.close_on_eof and _errno == .PERM)
                        {
                            break :brk .AGAIN;
                        }
                    }

                    break :brk _errno;
                };

                switch (errno) {
                    retry => {
                        if (this.finished) {
                            return .{ .done = {} };
                        }

                        if (free_buffer_on_error) {
                            bun.default_allocator.free(buf_to_use);
                            buf_to_use = read_buf;
                        }

                        if (view != .zero) {
                            this.view.set(this.globalThis(), view);
                            this.buf = read_buf;
                            this.watch(this.fd);
                        }

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
                if (result == 0 and free_buffer_on_error) {
                    bun.default_allocator.free(buf_to_use);
                    buf_to_use = read_buf;
                } else if (free_buffer_on_error) {
                    this.view.clear();
                    this.buf = &.{};
                    return this.handleReadChunk(result, view, true, buf_to_use);
                }

                if (result == 0 and !this.finished and !this.close_on_eof and std.os.S.ISFIFO(this.mode)) {
                    this.view.set(this.globalThis(), view);
                    this.buf = read_buf;
                    this.watch(this.fd);
                    return .{
                        .pending = &this.pending,
                    };
                }

                return this.handleReadChunk(result, view, false, buf_to_use);
            },
        }
    }

    /// Called from Poller
    pub fn ready(this: *FileBlobLoader, sizeOrOffset: i64) void {
        std.debug.assert(this.started);

        const view = this.view.get() orelse .zero;
        defer this.view.clear();

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
            if (this.pending.state == .pending) {
                // should never be reached
                this.pending.result = .{
                    .err = Syscall.Error.todo,
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

        this.pending.result = this.read(
            this.buf,
            view,
            if (available_to_read == std.math.maxInt(usize))
                null
            else
                @truncate(c_int, @intCast(isize, available_to_read)),
        );
        this.pending.run();
    }

    pub fn finalize(this: *FileBlobLoader) void {
        if (this.finalized)
            return;

        this.signal.close(null);

        if (this.buffered_data.cap > 0) {
            this.buffered_data.listManaged(bun.default_allocator).deinit();
        }

        this.finished = true;

        if (this.poll_ref.isActive())
            this.unwatch(this.fd);
        this.finalized = true;

        this.pending.result = .{ .done = {} };
        this.pending.run();

        this.view.deinit();
        this.buf = &.{};

        this.maybeAutoClose();

        this.store.deref();
    }

    pub fn onCancel(this: *FileBlobLoader) void {
        this.cancelled = true;
        this.deinit();
    }

    pub fn deinit(this: *FileBlobLoader) void {
        this.finalize();
        if (this.scheduled_count == 0 and this.pending.state == .pending) {
            this.destroy();
        }
    }

    pub fn destroy(this: *FileBlobLoader) void {
        bun.default_allocator.destroy(this);
    }

    pub const Source = ReadableStreamSource(@This(), "FileBlobLoader", onStart, onPullInto, onCancel, deinit);
};

pub fn NewReadyWatcher(
    comptime Context: type,
    comptime flag_: JSC.Poller.Flag,
    comptime onReady: anytype,
) type {
    return struct {
        const flag = flag_;
        const ready = onReady;

        const Watcher = @This();

        pub fn onPoll(this: *Context, sizeOrOffset: i64, _: u16) void {
            ready(this, sizeOrOffset);
        }

        pub fn unwatch(this: *Context, fd: JSC.Node.FileDescriptor) void {
            std.debug.assert(fd != std.math.maxInt(JSC.Node.FileDescriptor));
            _ = JSC.VirtualMachine.vm.poller.unwatch(fd, flag, Context, this);
        }

        pub fn watch(this: *Context, fd: JSC.Node.FileDescriptor) void {
            std.debug.assert(fd != std.math.maxInt(JSC.Node.FileDescriptor));
            _ = JSC.VirtualMachine.vm.poller.watch(fd, flag, Context, this);
        }
    };
}

// pub const HTTPRequest = RequestBodyStreamer(false);
// pub const HTTPSRequest = RequestBodyStreamer(true);
// pub fn ResponseBodyStreamer(comptime is_ssl: bool) type {
//     return struct {
//         const Streamer = @This();
//         pub fn onEnqueue(this: *Streamer, buffer: []u8, ): anytype,
//         pub fn onEnqueueMany(this: *Streamer): anytype,
//         pub fn onClose(this: *Streamer): anytype,
//         pub fn onError(this: *Streamer): anytype,
//     };
// }

