const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const bun = @import("root").bun;
const MimeType = HTTPClient.MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = bun.http;
const JSC = @import("root").bun.JSC;
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;
const FetchHeaders = JSC.FetchHeaders;
const ObjectPool = @import("../../pool.zig").ObjectPool;
const SystemError = JSC.SystemError;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const strings = @import("root").bun.strings;
const string = @import("root").bun.string;
const default_allocator = @import("root").bun.default_allocator;
const FeatureFlags = @import("root").bun.FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const Async = bun.Async;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;

const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../env.zig");
const ZigString = JSC.ZigString;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;
const E = bun.C.E;
const VirtualMachine = JSC.VirtualMachine;
const Task = JSC.Task;
const JSPrinter = bun.js_printer;
const picohttp = @import("root").bun.picohttp;
const StringJoiner = @import("../../string_joiner.zig");
const uws = @import("root").bun.uws;
const Blob = JSC.WebCore.Blob;
const Response = JSC.WebCore.Response;
const Request = JSC.WebCore.Request;
const assert = std.debug.assert;
const Syscall = bun.sys;
const uv = bun.windows.libuv;

const AnyBlob = JSC.WebCore.AnyBlob;
pub const ReadableStream = struct {
    value: JSValue,
    ptr: Source,

    pub const Strong = struct {
        held: JSC.Strong = .{},

        pub fn globalThis(this: *const Strong) ?*JSGlobalObject {
            return this.held.globalThis;
        }

        pub fn init(this: ReadableStream, global: *JSGlobalObject) !Strong {
            switch (this.ptr) {
                .Blob => |stream| {
                    try stream.parent().incrementCount();
                },
                .File => |stream| {
                    try stream.parent().incrementCount();
                },
                .Bytes => |stream| {
                    try stream.parent().incrementCount();
                },
                else => {},
            }
            return .{
                .held = JSC.Strong.create(this.value, global),
            };
        }

        pub fn get(this: *Strong) ?ReadableStream {
            if (this.globalThis()) |global| {
                if (this.held.get()) |value| {
                    return ReadableStream.fromJS(value, global);
                }
            }
            return null;
        }

        pub fn deinit(this: *Strong) void {
            if (this.get()) |readable| {
                // decrement the ref count and if it's zero we auto detach
                readable.detachIfPossible(this.globalThis().?);
            }
            this.held.deinit();
        }
    };

    pub fn toJS(this: *const ReadableStream) JSValue {
        return this.value;
    }

    pub fn reloadTag(this: *ReadableStream, globalThis: *JSC.JSGlobalObject) void {
        if (ReadableStream.fromJS(this.value, globalThis)) |stream| {
            this.* = stream;
        } else {
            this.value.unprotect();
            this.* = .{ .ptr = .{ .Invalid = {} }, .value = .zero };
        }
    }

    pub fn toAnyBlob(
        stream: *ReadableStream,
        globalThis: *JSC.JSGlobalObject,
    ) ?JSC.WebCore.AnyBlob {
        if (stream.isDisturbed(globalThis)) {
            return null;
        }

        stream.reloadTag(globalThis);

        switch (stream.ptr) {
            .Blob => |blobby| {
                var blob = JSC.WebCore.Blob.initWithStore(blobby.store, globalThis);
                blob.offset = blobby.offset;
                blob.size = blobby.remain;
                blob.store.?.ref();
                stream.detachIfPossible(globalThis);

                return AnyBlob{ .Blob = blob };
            },
            .File => |blobby| {
                if (blobby.lazy_readable == .blob) {
                    var blob = JSC.WebCore.Blob.initWithStore(blobby.lazy_readable.blob, globalThis);
                    blob.store.?.ref();
                    // it should be lazy, file shouldn't have opened yet.
                    std.debug.assert(!blobby.started);
                    stream.detachIfPossible(globalThis);
                    return AnyBlob{ .Blob = blob };
                }
            },
            .Bytes => |bytes| {

                // If we've received the complete body by the time this function is called
                // we can avoid streaming it and convert it to a Blob
                if (bytes.has_received_last_chunk) {
                    var blob: JSC.WebCore.AnyBlob = undefined;
                    blob.from(bytes.buffer);
                    bytes.buffer.items = &.{};
                    bytes.buffer.capacity = 0;
                    stream.detachIfPossible(globalThis);
                    return blob;
                }

                return null;
            },
            else => {},
        }

        return null;
    }

    pub fn done(this: *const ReadableStream) void {
        this.value.unprotect();
    }

    pub fn cancel(this: *const ReadableStream, globalThis: *JSGlobalObject) void {
        JSC.markBinding(@src());
        ReadableStream__cancel(this.value, globalThis);
        this.value.unprotect();
    }

    pub fn abort(this: *const ReadableStream, globalThis: *JSGlobalObject) void {
        JSC.markBinding(@src());
        ReadableStream__cancel(this.value, globalThis);
        this.value.unprotect();
    }

    pub fn forceDetach(this: *const ReadableStream, globalObject: *JSGlobalObject) void {
        ReadableStream__detach(this.value, globalObject);
        this.value.unprotect();
    }

    /// Decrement Source ref count and detach the underlying stream if ref count is zero
    /// be careful, this can invalidate the stream do not call this multiple times
    /// this is meant to be called only once when we are done consuming the stream or from the ReadableStream.Strong.deinit
    pub fn detachIfPossible(this: *const ReadableStream, globalThis: *JSGlobalObject) void {
        JSC.markBinding(@src());

        const ref_count = switch (this.ptr) {
            .Blob => |blob| blob.parent().decrementCount(),
            .File => |file| file.parent().decrementCount(),
            .Bytes => |bytes| bytes.parent().decrementCount(),
            else => 0,
        };

        if (ref_count == 0) {
            ReadableStream__detach(this.value, globalThis);
            this.value.unprotect();
        }
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
        File: *FileReader,

        /// This is a direct readable stream
        /// That means we can turn it into whatever we want
        Direct: void,

        Bytes: *ByteStream,
    };

    extern fn ReadableStreamTag__tagged(globalObject: *JSGlobalObject, possibleReadableStream: JSValue, ptr: *JSValue) Tag;
    extern fn ReadableStream__isDisturbed(possibleReadableStream: JSValue, globalObject: *JSGlobalObject) bool;
    extern fn ReadableStream__isLocked(possibleReadableStream: JSValue, globalObject: *JSGlobalObject) bool;
    extern fn ReadableStream__empty(*JSGlobalObject) JSC.JSValue;
    extern fn ReadableStream__used(*JSGlobalObject) JSC.JSValue;
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
                    .File = ptr.asPtr(FileReader),
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
        return ZigGlobalObject__createNativeReadableStream(globalThis, JSValue.fromPtr(ptr), JSValue.jsNumber(@intFromEnum(id)));
    }

    pub fn fromBlob(globalThis: *JSGlobalObject, blob: *const Blob, recommended_chunk_size: Blob.SizeType) JSC.JSValue {
        JSC.markBinding(@src());
        var store = blob.store orelse {
            return ReadableStream.empty(globalThis);
        };
        switch (store.data) {
            .bytes => {
                var reader = globalThis.allocator().create(ByteBlobLoader.Source) catch unreachable;
                reader.* = .{
                    .globalThis = globalThis,
                    .context = undefined,
                };
                reader.context.setup(blob, recommended_chunk_size);
                return reader.toJS(globalThis);
            },
            .file => {
                var reader = globalThis.allocator().create(FileReader.Source) catch unreachable;
                reader.* = .{
                    .globalThis = globalThis,
                    .context = .{
                        .lazy_readable = .{
                            .blob = store,
                        },
                    },
                };
                store.ref();
                return reader.toJS(globalThis);
            },
        }
    }

    pub fn fromFIFO(
        globalThis: *JSGlobalObject,
        fifo: *FIFO,
        buffered_data: bun.ByteList,
    ) JSC.JSValue {
        JSC.markBinding(@src());
        var reader = globalThis.allocator().create(FileReader.Source) catch unreachable;
        reader.* = .{
            .globalThis = globalThis,
            .context = .{
                .buffered_data = buffered_data,
                .started = true,
                .lazy_readable = .{
                    .readable = .{
                        .FIFO = fifo.*,
                    },
                },
            },
        };

        if (reader.context.lazy_readable.readable.FIFO.poll_ref) |poll| {
            poll.owner.set(&reader.context.lazy_readable.readable.FIFO);
            fifo.poll_ref = null;
        }
        reader.context.lazy_readable.readable.FIFO.pending.future = undefined;
        reader.context.lazy_readable.readable.FIFO.auto_sizer = null;
        reader.context.lazy_readable.readable.FIFO.pending.state = .none;
        reader.context.lazy_readable.readable.FIFO.drained = buffered_data.len == 0;

        return reader.toJS(globalThis);
    }

    pub fn empty(globalThis: *JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());

        return ReadableStream__empty(globalThis);
    }

    pub fn used(globalThis: *JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());

        return ReadableStream__used(globalThis);
    }

    const Base = @import("../../ast/base.zig");
    pub const StreamTag = enum(usize) {
        invalid = 0,
        _,

        pub fn init(filedes: bun.FileDescriptor) StreamTag {
            var bytes = [8]u8{ 1, 0, 0, 0, 0, 0, 0, 0 };
            const filedes_ = @as([8]u8, @bitCast(@as(usize, @as(u56, @truncate(@as(usize, @intCast(filedes)))))));
            bytes[1..8].* = filedes_[0..7].*;

            return @as(StreamTag, @enumFromInt(@as(u64, @bitCast(bytes))));
        }

        pub fn fd(this: StreamTag) bun.FileDescriptor {
            var bytes = @as([8]u8, @bitCast(@intFromEnum(this)));
            if (bytes[0] != 1) {
                return bun.invalid_fd;
            }
            const out: u64 = 0;
            @as([8]u8, @bitCast(out))[0..7].* = bytes[1..8].*;
            return @as(bun.FileDescriptor, @intCast(out));
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
        mode: bun.Mode = 0o664,
    },
    HTTPSResponseSink: void,
    HTTPResponseSink: void,
    UVStreamSink: void,
    ready: void,

    pub const Tag = enum {
        empty,
        err,
        chunk_size,
        ArrayBufferSink,
        FileSink,
        HTTPSResponseSink,
        HTTPResponseSink,
        UVStreamSink,
        ready,
    };

    pub fn toJS(this: StreamStart, globalThis: *JSGlobalObject) JSC.JSValue {
        switch (this) {
            .empty, .ready => {
                return JSC.JSValue.jsUndefined();
            },
            .chunk_size => |chunk| {
                return JSC.JSValue.jsNumber(@as(Blob.SizeType, @intCast(chunk)));
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
            if (chunkSize.isNumber())
                return .{ .chunk_size = @as(Blob.SizeType, @intCast(@as(i52, @truncate(chunkSize.toInt64())))) };
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
                    if (chunkSize.isNumber()) {
                        empty = false;
                        chunk_size = @as(JSC.WebCore.Blob.SizeType, @intCast(@max(0, @as(i51, @truncate(chunkSize.toInt64())))));
                    }
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

                if (value.getTruthy(globalThis, "highWaterMark")) |chunkSize| {
                    if (chunkSize.isNumber())
                        chunk_size = @as(JSC.WebCore.Blob.SizeType, @intCast(@max(0, @as(i51, @truncate(chunkSize.toInt64())))));
                }

                if (value.getTruthy(globalThis, "path")) |path| {
                    if (!path.isString()) {
                        return .{
                            .err = Syscall.Error{
                                .errno = @intFromEnum(bun.C.SystemErrno.EINVAL),
                                .syscall = .write,
                            },
                        };
                    }

                    return .{
                        .FileSink = .{
                            .chunk_size = chunk_size,
                            .input_path = .{
                                .path = path.toSlice(globalThis, globalThis.bunVM().allocator),
                            },
                        },
                    };
                } else if (value.getTruthy(globalThis, "fd")) |fd_value| {
                    if (!fd_value.isAnyInt()) {
                        return .{
                            .err = Syscall.Error{
                                .errno = @intFromEnum(bun.C.SystemErrno.EBADF),
                                .syscall = .write,
                            },
                        };
                    }

                    if (bun.FDImpl.fromJS(fd_value)) |fd| {
                        return .{
                            .FileSink = .{
                                .chunk_size = chunk_size,
                                .input_path = .{
                                    .fd = fd.encode(),
                                },
                            },
                        };
                    } else {
                        return .{
                            .err = Syscall.Error{
                                .errno = @intFromEnum(bun.C.SystemErrno.EBADF),
                                .syscall = .write,
                            },
                        };
                    }
                }

                return .{
                    .FileSink = .{
                        .input_path = .{ .fd = bun.invalid_fd },
                        .chunk_size = chunk_size,
                    },
                };
            },
            .UVStreamSink, .HTTPSResponseSink, .HTTPResponseSink => {
                var empty = true;
                var chunk_size: JSC.WebCore.Blob.SizeType = 2048;

                if (value.getTruthy(globalThis, "highWaterMark")) |chunkSize| {
                    if (chunkSize.isNumber()) {
                        empty = false;
                        chunk_size = @as(JSC.WebCore.Blob.SizeType, @intCast(@max(256, @as(i51, @truncate(chunkSize.toInt64())))));
                    }
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
    pending: *Pending,
    err: union(Err) { Error: Syscall.Error, JSValue: JSC.JSValue },
    done: void,
    owned: bun.ByteList,
    owned_and_done: bun.ByteList,
    temporary_and_done: bun.ByteList,
    temporary: bun.ByteList,
    into_array: IntoArray,
    into_array_and_done: IntoArray,

    pub const Err = enum {
        Error,
        JSValue,
    };

    pub const Tag = enum {
        pending,
        err,
        done,
        owned,
        owned_and_done,
        temporary_and_done,
        temporary,
        into_array,
        into_array_and_done,
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
            future: Future = undefined,
            result: Writable,
            consumed: Blob.SizeType = 0,
            state: StreamResult.Pending.State = .none,

            pub const Future = union(enum) {
                promise: struct {
                    promise: *JSPromise,
                    globalThis: *JSC.JSGlobalObject,
                },
                handler: Handler,
            };

            pub fn promise(this: *Writable.Pending, globalThis: *JSC.JSGlobalObject) *JSPromise {
                const prom = JSPromise.create(globalThis);
                this.future = .{
                    .promise = .{ .promise = prom, .globalThis = globalThis },
                };
                this.state = .pending;
                return prom;
            }

            pub const Handler = struct {
                ctx: *anyopaque,
                handler: Fn,

                pub const Fn = *const fn (ctx: *anyopaque, result: StreamResult.Writable) void;

                pub fn init(this: *Handler, comptime Context: type, ctx: *Context, comptime handler_fn: fn (*Context, StreamResult.Writable) void) void {
                    this.ctx = ctx;
                    this.handler = struct {
                        const handler = handler_fn;
                        pub fn onHandle(ctx_: *anyopaque, result: StreamResult.Writable) void {
                            @call(.always_inline, handler, .{ bun.cast(*Context, ctx_), result });
                        }
                    }.onHandle;
                }
            };

            pub fn run(this: *Writable.Pending) void {
                if (this.state != .pending) return;
                this.state = .used;
                switch (this.future) {
                    .promise => |p| {
                        Writable.fulfillPromise(this.result, p.promise, p.globalThis);
                    },
                    .handler => |h| {
                        h.handler(h.ctx, this.result);
                    },
                }
            }
        };

        pub fn isDone(this: *const Writable) bool {
            return switch (this.*) {
                .owned_and_done, .temporary_and_done, .into_array_and_done, .done, .err => true,
                else => false,
            };
        }

        pub fn fulfillPromise(
            result: Writable,
            promise: *JSPromise,
            globalThis: *JSGlobalObject,
        ) void {
            promise.asValue(globalThis).unprotect();
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
                    const promise_value = pending.promise(globalThis).asValue(globalThis);
                    promise_value.protect();
                    break :brk promise_value;
                },
            };
        }
    };

    pub const IntoArray = struct {
        value: JSValue = JSValue.zero,
        len: Blob.SizeType = std.math.maxInt(Blob.SizeType),
    };

    pub const Pending = struct {
        future: Future = undefined,
        result: StreamResult = .{ .done = {} },
        state: State = .none,

        pub fn set(this: *Pending, comptime Context: type, ctx: *Context, comptime handler_fn: fn (*Context, StreamResult) void) void {
            this.future.init(Context, ctx, handler_fn);
            this.state = .pending;
        }

        pub fn promise(this: *Pending, globalObject: *JSC.JSGlobalObject) *JSC.JSPromise {
            const prom = JSC.JSPromise.create(globalObject);
            this.future = .{
                .promise = .{
                    .promise = prom,
                    .globalThis = globalObject,
                },
            };
            this.state = .pending;
            return prom;
        }

        pub const Future = union(enum) {
            promise: struct {
                promise: *JSPromise,
                globalThis: *JSC.JSGlobalObject,
            },
            handler: Handler,

            pub fn init(this: *Future, comptime Context: type, ctx: *Context, comptime handler_fn: fn (*Context, StreamResult) void) void {
                this.* = .{
                    .handler = undefined,
                };
                this.handler.init(Context, ctx, handler_fn);
            }
        };

        pub const Handler = struct {
            ctx: *anyopaque,
            handler: Fn,

            pub const Fn = *const fn (ctx: *anyopaque, result: StreamResult) void;

            pub fn init(this: *Handler, comptime Context: type, ctx: *Context, comptime handler_fn: fn (*Context, StreamResult) void) void {
                this.ctx = ctx;
                this.handler = struct {
                    const handler = handler_fn;
                    pub fn onHandle(ctx_: *anyopaque, result: StreamResult) void {
                        @call(.always_inline, handler, .{ bun.cast(*Context, ctx_), result });
                    }
                }.onHandle;
            }
        };

        pub const State = enum {
            none,
            pending,
            used,
        };

        pub fn run(this: *Pending) void {
            if (this.state != .pending) return;
            this.state = .used;
            switch (this.future) {
                .promise => |p| {
                    StreamResult.fulfillPromise(this.result, p.promise, p.globalThis);
                },
                .handler => |h| {
                    h.handler(h.ctx, this.result);
                },
            }
        }
    };

    pub fn isDone(this: *const StreamResult) bool {
        return switch (this.*) {
            .owned_and_done, .temporary_and_done, .into_array_and_done, .done, .err => true,
            else => false,
        };
    }

    pub fn fulfillPromise(result: StreamResult, promise: *JSC.JSPromise, globalThis: *JSC.JSGlobalObject) void {
        promise.asValue(globalThis).unprotect();
        switch (result) {
            .err => |err| {
                if (err == .Error) {
                    promise.reject(globalThis, err.Error.toJSC(globalThis));
                } else {
                    const js_err = err.JSValue;
                    js_err.ensureStillAlive();
                    js_err.unprotect();
                    promise.reject(globalThis, js_err);
                }
            },
            .done => {
                promise.resolve(globalThis, JSValue.jsBoolean(false));
            },
            else => {
                promise.resolve(globalThis, result.toJS(globalThis));
            },
        }
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
                const temp_slice = temp.slice();
                @memcpy(slice_[0..temp_slice.len], temp_slice);
                return array;
            },
            .temporary_and_done => |temp| {
                var array = JSC.JSValue.createUninitializedUint8Array(globalThis, temp.len);
                var slice_ = array.asArrayBuffer(globalThis).?.slice();
                const temp_slice = temp.slice();
                @memcpy(slice_[0..temp_slice.len], temp_slice);
                return array;
            },
            .into_array => |array| {
                return JSC.JSValue.jsNumberFromInt64(array.len);
            },
            .into_array_and_done => |array| {
                return JSC.JSValue.jsNumberFromInt64(array.len);
            },
            .pending => |pending| {
                const promise = pending.promise(globalThis).asValue(globalThis);
                promise.protect();
                return promise;
            },

            .err => |err| {
                if (err == .Error) {
                    return JSC.JSPromise.rejectedPromise(globalThis, JSValue.c(err.Error.toJS(globalThis))).asValue(globalThis);
                }
                const js_err = err.JSValue;
                js_err.ensureStillAlive();
                js_err.unprotect();
                return JSC.JSPromise.rejectedPromise(globalThis, js_err).asValue(globalThis);
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

    pub const dead = @as(*anyopaque, @ptrFromInt(0xaaaaaaaa));

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
        pub const OnCloseFn = *const (fn (this: *anyopaque, err: ?Syscall.Error) void);
        pub const OnReadyFn = *const (fn (this: *anyopaque, amount: ?Blob.SizeType, offset: ?Blob.SizeType) void);
        pub const OnStartFn = *const (fn (this: *anyopaque) void);
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
                        Wrapped.close(@as(*Wrapped, @ptrCast(@alignCast(this))), err)
                    else
                        Wrapped.onClose(@as(*Wrapped, @ptrCast(@alignCast(this))), err);
                }
                fn onReady(this: *anyopaque, amount: ?Blob.SizeType, offset: ?Blob.SizeType) void {
                    if (comptime !@hasDecl(Wrapped, "onReady"))
                        Wrapped.ready(@as(*Wrapped, @ptrCast(@alignCast(this))), amount, offset)
                    else
                        Wrapped.onReady(@as(*Wrapped, @ptrCast(@alignCast(this))), amount, offset);
                }
                fn onStart(this: *anyopaque) void {
                    if (comptime !@hasDecl(Wrapped, "onStart"))
                        Wrapped.start(@as(*Wrapped, @ptrCast(@alignCast(this))))
                    else
                        Wrapped.onStart(@as(*Wrapped, @ptrCast(@alignCast(this))));
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
        .ptr = @as(*anyopaque, @ptrFromInt(0xaaaaaaaa)),
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
            const str = input.slice();
            if (strings.isAllASCII(str)) {
                return writeFn(
                    ctx,
                    input,
                );
            }

            if (stack_size >= str.len) {
                var buf: [stack_size]u8 = undefined;
                @memcpy(buf[0..str.len], str);

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
                @memcpy(slice[0..str.len], str);

                strings.replaceLatin1WithUTF8(slice[0..str.len]);
                if (input.isDone()) {
                    return writeFn(ctx, .{ .owned_and_done = bun.ByteList.init(slice) });
                } else {
                    return writeFn(ctx, .{ .owned = bun.ByteList.init(slice) });
                }
            }
        }

        pub fn writeUTF16(comptime Ctx: type, ctx: *Ctx, input: StreamResult, comptime writeFn: anytype) StreamResult.Writable {
            const str: []const u16 = std.mem.bytesAsSlice(u16, input.slice());

            if (stack_size >= str.len * 2) {
                var buf: [stack_size]u8 = undefined;
                const copied = strings.copyUTF16IntoUTF8(&buf, []const u16, str, true);
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
                const allocated = strings.toUTF8Alloc(bun.default_allocator, str) catch return .{ .err = Syscall.Error.oom };
                if (input.isDone()) {
                    return writeFn(ctx, .{ .owned_and_done = bun.ByteList.init(allocated) });
                } else {
                    return writeFn(ctx, .{ .owned = bun.ByteList.init(allocated) });
                }
            }
        }
    };

    pub const VTable = struct {
        pub const WriteUTF16Fn = *const (fn (this: *anyopaque, data: StreamResult) StreamResult.Writable);
        pub const WriteUTF8Fn = *const (fn (this: *anyopaque, data: StreamResult) StreamResult.Writable);
        pub const WriteLatin1Fn = *const (fn (this: *anyopaque, data: StreamResult) StreamResult.Writable);
        pub const EndFn = *const (fn (this: *anyopaque, err: ?Syscall.Error) JSC.Node.Maybe(void));
        pub const ConnectFn = *const (fn (this: *anyopaque, signal: Signal) JSC.Node.Maybe(void));

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
                    return Wrapped.write(@as(*Wrapped, @ptrCast(@alignCast(this))), data);
                }
                pub fn onConnect(this: *anyopaque, signal: Signal) JSC.Node.Maybe(void) {
                    return Wrapped.connect(@as(*Wrapped, @ptrCast(@alignCast(this))), signal);
                }
                pub fn onWriteLatin1(this: *anyopaque, data: StreamResult) StreamResult.Writable {
                    return Wrapped.writeLatin1(@as(*Wrapped, @ptrCast(@alignCast(this))), data);
                }
                pub fn onWriteUTF16(this: *anyopaque, data: StreamResult) StreamResult.Writable {
                    return Wrapped.writeUTF16(@as(*Wrapped, @ptrCast(@alignCast(this))), data);
                }
                pub fn onEnd(this: *anyopaque, err: ?Syscall.Error) JSC.Node.Maybe(void) {
                    return Wrapped.end(@as(*Wrapped, @ptrCast(@alignCast(this))), err);
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

pub const FileSink = NewFileSink(.js);
pub const FileSinkMini = NewFileSink(.mini);
pub fn NewFileSink(comptime EventLoop: JSC.EventLoopKind) type {
    return struct {
        buffer: bun.ByteList,
        allocator: std.mem.Allocator,
        done: bool = false,
        signal: Signal = .{},
        next: ?Sink = null,
        auto_close: bool = false,
        auto_truncate: bool = false,
        fd: bun.FileDescriptor = bun.invalid_fd,
        mode: bun.Mode = 0,
        chunk_size: usize = 0,
        pending: StreamResult.Writable.Pending = StreamResult.Writable.Pending{
            .result = .{ .done = {} },
        },

        scheduled_count: u32 = 0,
        written: usize = 0,
        head: usize = 0,
        requested_end: bool = false,
        has_adjusted_pipe_size_on_linux: bool = false,
        max_write_size: usize = std.math.maxInt(usize),
        reachable_from_js: bool = true,
        poll_ref: ?*Async.FilePoll = null,

        pub usingnamespace NewReadyWatcher(@This(), .writable, ready);
        const log = Output.scoped(.FileSink, false);

        const ThisFileSink = @This();

        pub const event_loop_kind = EventLoop;

        pub fn isReachable(this: *const ThisFileSink) bool {
            return this.reachable_from_js or !this.signal.isDead();
        }

        pub fn updateRef(this: *ThisFileSink, value: bool) void {
            // if (this.poll_ref) |poll| {
            //     if (value)
            //         poll.ref(JSC.VirtualMachine.get())
            //     else
            //         poll.unref(JSC.VirtualMachine.get());
            // }
            if (this.poll_ref) |poll| {
                if (value)
                    poll.ref(switch (comptime EventLoop) {
                        .js => JSC.VirtualMachine.get(),
                        .mini => JSC.MiniEventLoop.global,
                    })
                else
                    poll.unref(switch (comptime EventLoop) {
                        .js => JSC.VirtualMachine.get(),
                        .mini => JSC.MiniEventLoop.global,
                    });
            }
        }

        const max_fifo_size = 64 * 1024;
        pub fn prepare(this: *ThisFileSink, input_path: PathOrFileDescriptor, mode: bun.Mode) JSC.Node.Maybe(void) {
            var file_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
            const auto_close = this.auto_close;
            const fd = if (!auto_close)
                input_path.fd
            else switch (bun.sys.open(input_path.path.toSliceZ(&file_buf), std.os.O.WRONLY | std.os.O.NONBLOCK | std.os.O.CLOEXEC | std.os.O.CREAT, mode)) {
                .result => |_fd| _fd,
                .err => |err| return .{ .err = err.withPath(input_path.path.slice()) },
            };

            if (this.poll_ref == null) {
                const stat: bun.Stat = switch (bun.sys.fstat(fd)) {
                    .result => |result| result,
                    .err => |err| {
                        if (auto_close) {
                            _ = bun.sys.close(fd);
                        }
                        return .{ .err = err.withPathLike(input_path) };
                    },
                };

                this.mode = @intCast(stat.mode);
                this.auto_truncate = this.auto_truncate and (bun.isRegularFile(this.mode));
            } else {
                this.auto_truncate = false;
                this.max_write_size = max_fifo_size;
            }

            this.fd = fd;

            return .{ .result = {} };
        }

        pub fn connect(this: *ThisFileSink, signal: Signal) void {
            std.debug.assert(this.reader == null);
            this.signal = signal;
        }

        pub fn start(this: *ThisFileSink, stream_start: StreamStart) JSC.Node.Maybe(void) {
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

        pub fn flush(this: *ThisFileSink, buf: []const u8) StreamResult.Writable {
            return this.flushMaybePollWithSizeAndBuffer(buf, std.math.maxInt(usize));
        }

        fn adjustPipeLengthOnLinux(this: *ThisFileSink, fd: bun.FileDescriptor, remain_len: usize) void {
            // On Linux, we can adjust the pipe size to avoid blocking.
            this.has_adjusted_pipe_size_on_linux = true;

            switch (bun.sys.setPipeCapacityOnLinux(fd, @min(Syscall.getMaxPipeSizeOnLinux(), remain_len))) {
                .result => |len| {
                    if (len > 0) {
                        this.max_write_size = len;
                    }
                },
                else => {},
            }
        }

        pub fn flushMaybePollWithSizeAndBuffer(this: *ThisFileSink, buffer: []const u8, writable_size: usize) StreamResult.Writable {
            std.debug.assert(this.fd != bun.invalid_fd);

            var total = this.written;
            const initial = total;
            const fd = this.fd;
            var remain = buffer;
            remain = remain[@min(this.head, remain.len)..];
            if (remain.len == 0) return .{ .owned = 0 };

            defer this.written = total;

            const initial_remain = remain;
            defer {
                std.debug.assert(total - initial == @intFromPtr(remain.ptr) - @intFromPtr(initial_remain.ptr));

                if (remain.len == 0) {
                    this.head = 0;
                    this.buffer.len = 0;
                } else {
                    this.head += total - initial;
                }
            }
            const is_fifo = this.isFIFO();
            var did_adjust_pipe_size_on_linux_this_tick = false;
            if (comptime Environment.isLinux) {
                if (is_fifo and !this.has_adjusted_pipe_size_on_linux and remain.len >= (max_fifo_size - 1024)) {
                    this.adjustPipeLengthOnLinux(fd, remain.len);
                    did_adjust_pipe_size_on_linux_this_tick = true;
                }
            }

            const max_to_write =
                if (is_fifo)
            brk: {
                if (comptime Environment.isLinux) {
                    if (did_adjust_pipe_size_on_linux_this_tick)
                        break :brk this.max_write_size;
                }

                // The caller may have informed us of the size
                // in which case we should use that.
                if (writable_size != std.math.maxInt(usize))
                    break :brk writable_size;

                if (this.poll_ref) |poll| {
                    if (poll.isHUP()) {
                        this.done = true;
                        this.cleanup();
                        return .{ .done = {} };
                    }

                    if (poll.isWritable()) {
                        break :brk this.max_write_size;
                    }
                }

                switch (bun.isWritable(fd)) {
                    .not_ready => {
                        if (this.poll_ref) |poll| {
                            poll.flags.remove(.writable);
                        }

                        if (!this.isWatching())
                            this.watch(fd);

                        return .{
                            .pending = &this.pending,
                        };
                    },
                    .hup => {
                        if (this.poll_ref) |poll| {
                            poll.flags.remove(.writable);
                            poll.flags.insert(.hup);
                        }

                        this.cleanup();

                        return .{
                            .done = {},
                        };
                    },
                    .ready => break :brk this.max_write_size,
                }
            } else remain.len;

            if (max_to_write > 0) {
                while (remain.len > 0) {
                    const write_buf = remain[0..@min(remain.len, max_to_write)];
                    const res = bun.sys.write(fd, write_buf);

                    if (res == .err) {
                        const retry =
                            E.AGAIN;

                        switch (res.err.getErrno()) {
                            retry => {
                                if (this.poll_ref) |poll| {
                                    poll.flags.remove(.writable);
                                }

                                if (!this.isWatching())
                                    this.watch(fd);
                                return .{
                                    .pending = &this.pending,
                                };
                            },
                            .PIPE => {
                                this.cleanup();
                                this.pending.consumed = @as(Blob.SizeType, @truncate(total - initial));
                                return .{ .done = {} };
                            },
                            else => {},
                        }
                        this.pending.result = .{ .err = res.err };
                        this.pending.consumed = @as(Blob.SizeType, @truncate(total - initial));

                        return .{ .err = res.err };
                    }

                    remain = remain[res.result..];
                    total += res.result;

                    log("Wrote {d} bytes (fd: {d}, head: {d}, {d}/{d})", .{ res.result, fd, this.head, remain.len, total });

                    if (res.result == 0) {
                        if (this.poll_ref) |poll| {
                            poll.flags.remove(.writable);
                        }
                        break;
                    }

                    // we flushed an entire fifo
                    // but we still have more
                    // lets check if its writable, so we avoid blocking
                    if (is_fifo and remain.len > 0) {
                        switch (bun.isWritable(fd)) {
                            .ready => {
                                if (this.poll_ref) |poll_ref| {
                                    poll_ref.flags.insert(.writable);
                                    poll_ref.flags.insert(.fifo);
                                    std.debug.assert(poll_ref.flags.contains(.poll_writable));
                                }
                            },
                            .not_ready => {
                                if (!this.isWatching())
                                    this.watch(this.fd);

                                if (this.poll_ref) |poll| {
                                    poll.flags.remove(.writable);
                                    std.debug.assert(poll.flags.contains(.poll_writable));
                                }
                                this.pending.consumed = @as(Blob.SizeType, @truncate(total - initial));

                                return .{
                                    .pending = &this.pending,
                                };
                            },
                            .hup => {
                                if (this.poll_ref) |poll| {
                                    poll.flags.remove(.writable);
                                    poll.flags.insert(.hup);
                                }

                                this.cleanup();

                                return .{
                                    .done = {},
                                };
                            },
                        }
                    }
                }
            }

            this.pending.result = .{
                .owned = @as(Blob.SizeType, @truncate(total)),
            };
            this.pending.consumed = @as(Blob.SizeType, @truncate(total - initial));

            if (is_fifo and remain.len == 0 and this.isWatching()) {
                this.unwatch(fd);
            }

            if (this.requested_end) {
                this.done = true;

                if (is_fifo and this.isWatching()) {
                    this.unwatch(fd);
                }

                if (this.auto_truncate)
                    _ = bun.sys.ftruncate(fd, @intCast(total));

                if (this.auto_close) {
                    _ = bun.sys.close(fd);
                    this.fd = bun.invalid_fd;
                }
            }
            this.pending.run();
            return .{ .owned = @as(Blob.SizeType, @truncate(total - initial)) };
        }

        pub fn flushFromJS(this: *ThisFileSink, globalThis: *JSGlobalObject, _: bool) JSC.Node.Maybe(JSValue) {
            if (this.isPending() or this.done) {
                return .{ .result = JSC.JSValue.jsUndefined() };
            }
            const result = this.flush(this.buffer.slice());

            if (result == .err) {
                return .{ .err = result.err };
            }

            return JSC.Node.Maybe(JSValue){
                .result = result.toJS(globalThis),
            };
        }

        fn cleanup(this: *ThisFileSink) void {
            this.done = true;

            if (this.poll_ref) |poll| {
                this.poll_ref = null;
                poll.deinitForceUnregister();
            }

            if (this.auto_close) {
                if (this.fd != bun.invalid_fd) {
                    if (this.scheduled_count > 0) {
                        this.scheduled_count = 0;
                    }

                    _ = bun.sys.close(this.fd);
                    this.fd = bun.invalid_fd;
                }
            }

            if (this.buffer.cap > 0) {
                this.buffer.listManaged(this.allocator).deinit();
                this.buffer = bun.ByteList.init("");
                this.head = 0;
            }

            this.pending.result = .done;
            this.pending.run();
        }

        pub fn finalize(this: *ThisFileSink) void {
            this.cleanup();
            this.signal.close(null);

            this.reachable_from_js = false;

            if (!this.isReachable())
                this.allocator.destroy(this);
        }

        pub fn init(allocator: std.mem.Allocator, next: ?Sink) !*FileSink {
            const this = try allocator.create(FileSink);
            this.* = FileSink{
                .buffer = bun.ByteList{},
                .allocator = allocator,
                .next = next,
            };
            return this;
        }

        pub fn construct(
            this: *ThisFileSink,
            allocator: std.mem.Allocator,
        ) void {
            this.* = FileSink{
                .buffer = bun.ByteList{},
                .allocator = allocator,
                .next = null,
            };
        }

        pub fn toJS(this: *ThisFileSink, globalThis: *JSGlobalObject) JSValue {
            return JSSink.createObject(globalThis, this);
        }

        pub fn ready(this: *ThisFileSink, writable: i64) void {
            var remain = this.buffer.slice();
            const pending = remain[@min(this.head, remain.len)..].len;
            if (pending == 0) {
                if (this.isWatching()) {
                    this.unwatch(this.fd);
                }

                return;
            }

            if (comptime Environment.isMac) {
                _ = this.flushMaybePollWithSizeAndBuffer(this.buffer.slice(), @as(usize, @intCast(@max(writable, 0))));
            } else {
                _ = this.flushMaybePollWithSizeAndBuffer(this.buffer.slice(), std.math.maxInt(usize));
            }
        }

        pub fn write(this: *@This(), data: StreamResult) StreamResult.Writable {
            if (this.done) {
                return .{ .done = {} };
            }
            const input = data.slice();

            if (!this.isPending() and this.buffer.len == 0 and input.len >= this.chunk_size) {
                const result = this.flush(input);
                if (this.isPending()) {
                    _ = this.buffer.write(this.allocator, input) catch {
                        return .{ .err = Syscall.Error.oom };
                    };
                }

                return result;
            }

            const len = this.buffer.write(this.allocator, input) catch {
                return .{ .err = Syscall.Error.oom };
            };

            if (!this.isPending() and this.buffer.len >= this.chunk_size) {
                return this.flush(this.buffer.slice());
            }

            this.signal.ready(null, null);
            return .{ .owned = len };
        }
        pub const writeBytes = write;
        pub fn writeLatin1(this: *@This(), data: StreamResult) StreamResult.Writable {
            if (this.done) {
                return .{ .done = {} };
            }

            const input = data.slice();

            if (!this.isPending() and this.buffer.len == 0 and input.len >= this.chunk_size and strings.isAllASCII(input)) {
                const result = this.flush(input);
                if (this.isPending()) {
                    _ = this.buffer.write(this.allocator, input) catch {
                        return .{ .err = Syscall.Error.oom };
                    };
                }

                return result;
            }

            const len = this.buffer.writeLatin1(this.allocator, input) catch {
                return .{ .err = Syscall.Error.oom };
            };

            if (!this.isPending() and this.buffer.len >= this.chunk_size) {
                return this.flush(this.buffer.slice());
            }

            this.signal.ready(null, null);
            return .{ .owned = len };
        }
        pub fn writeUTF16(this: *@This(), data: StreamResult) StreamResult.Writable {
            if (this.done) {
                return .{ .done = {} };
            }

            if (this.next) |*next| {
                return next.writeUTF16(data);
            }
            const len = this.buffer.writeUTF16(this.allocator, @as([*]const u16, @ptrCast(@alignCast(data.slice().ptr)))[0..std.mem.bytesAsSlice(u16, data.slice()).len]) catch {
                return .{ .err = Syscall.Error.oom };
            };

            if (!this.isPending() and this.buffer.len >= this.chunk_size) {
                return this.flush(this.buffer.slice());
            }
            this.signal.ready(null, null);

            return .{ .owned = len };
        }

        fn isPending(this: *const ThisFileSink) bool {
            if (this.done) return false;
            return this.pending.state == .pending;
        }

        pub fn close(this: *ThisFileSink) void {
            if (this.done)
                return;

            this.done = true;
            const fd = this.fd;
            const signal_close = fd != bun.invalid_fd;
            defer if (signal_close) this.signal.close(null);
            if (signal_close) {
                if (this.poll_ref) |poll| {
                    this.poll_ref = null;
                    poll.deinitForceUnregister();
                }

                this.fd = bun.invalid_fd;
                if (this.auto_close)
                    _ = bun.sys.close(fd);
            }

            this.pending.result = .done;
            this.pending.run();
        }

        pub fn end(this: *ThisFileSink, err: ?Syscall.Error) JSC.Node.Maybe(void) {
            if (this.done) {
                return .{ .result = {} };
            }

            if (this.next) |*next| {
                return next.end(err);
            }

            if (this.requested_end or this.done)
                return .{ .result = {} };

            this.requested_end = true;

            const flushy = this.flush(this.buffer.slice());

            if (flushy == .err) {
                return .{ .err = flushy.err };
            }

            if (flushy != .pending) {
                this.cleanup();
            }

            this.signal.close(err);
            return .{ .result = {} };
        }

        pub fn endFromJS(this: *ThisFileSink, globalThis: *JSGlobalObject) JSC.Node.Maybe(JSValue) {
            if (this.done) {
                return .{ .result = JSValue.jsNumber(this.written) };
            }

            std.debug.assert(this.next == null);
            this.requested_end = true;

            if (this.fd == bun.invalid_fd) {
                this.cleanup();
                return .{ .result = JSValue.jsNumber(this.written) };
            }

            const flushed = this.flush(this.buffer.slice());

            if (flushed == .err) {
                return .{ .err = flushed.err };
            }

            if (flushed != .pending) {
                this.cleanup();
            }

            this.signal.close(null);

            return .{ .result = flushed.toJS(globalThis) };
        }

        pub fn sink(this: *ThisFileSink) Sink {
            return Sink.init(this);
        }

        pub const JSSink = NewJSSink(@This(), "FileSink");
    };
}

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
        const this = try allocator.create(ArrayBufferSink);
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
            .bytes = bun.ByteList{},
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
        const len = this.bytes.writeUTF16(this.allocator, @as([*]const u16, @ptrCast(@alignCast(data.slice().ptr)))[0..std.mem.bytesAsSlice(u16, data.slice()).len]) catch {
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
    pub fn destroy(this: *ArrayBufferSink) void {
        this.bytes.deinitWithAllocator(this.allocator);
        this.allocator.destroy(this);
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
            list.toOwnedSlice() catch @panic("TODO"),
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

pub const UVStreamSink = struct {
    stream: StreamType,

    allocator: std.mem.Allocator,
    done: bool = false,
    signal: Signal = .{},
    next: ?Sink = null,
    buffer: bun.ByteList = .{},
    pub const name = "UVStreamSink";
    const StreamType = if(Environment.isWindows) *uv.uv_stream_t else *anyopaque;
    const AsyncWriteInfo = struct {
        sink: *UVStreamSink,
        input_buffer: uv.uv_buf_t = std.mem.zeroes(uv.uv_buf_t),
        req: uv.uv_write_t = std.mem.zeroes(uv.uv_write_t),

        pub fn init(parent: *UVStreamSink, data: []const u8) *AsyncWriteInfo {
            var info = bun.new(AsyncWriteInfo, .{ .sink = parent });
            info.req.data = info;
            info.input_buffer = uv.uv_buf_t.init(bun.default_allocator.dupe(u8, data) catch bun.outOfMemory());
            return info;
        }

        fn uvWriteCallback(req: *uv.uv_write_t, status: uv.ReturnCode) callconv(.C) void {
            const this = bun.cast(*AsyncWriteInfo, req.data);
            defer this.deinit();
            if (status.errEnum()) |err| {
                _ = this.sink.end(bun.sys.Error.fromCode(err, .write));
                return;
            }
        }

        pub fn run(this: *AsyncWriteInfo) void {
            if (uv.uv_write(&this.req, @ptrCast(this.sink.stream), @ptrCast(&this.input_buffer), 1, AsyncWriteInfo.uvWriteCallback).errEnum()) |err| {
                _ = this.sink.end(bun.sys.Error.fromCode(err, .write));
                this.deinit();
            }
        }

        pub fn deinit(this: *AsyncWriteInfo) void {
            bun.default_allocator.free(this.input_buffer.slice());
            bun.default_allocator.destroy(this);
        }
    };

    fn writeAsync(this: *UVStreamSink, data: []const u8) void {
        if (this.done) return;
        if(!Environment.isWindows) @panic("UVStreamSink is only supported on Windows");

        AsyncWriteInfo.init(this, data).run();
    }

    fn writeMaybeSync(this: *UVStreamSink, data: []const u8) void {
        if(!Environment.isWindows) @panic("UVStreamSink is only supported on Windows");

        if (this.done) return;

        var to_write = data;
        while (to_write.len > 0) {
            var input_buffer = uv.uv_buf_t.init(to_write);
            const status = uv.uv_try_write(@ptrCast(this.stream), @ptrCast(&input_buffer), 1);
            if (status.errEnum()) |err| {
                if (err == bun.C.E.AGAIN) {
                    this.writeAsync(to_write);
                    return;
                }
                _ = this.end(bun.sys.Error.fromCode(err, .write));
                return;
            }
            const bytes_written: usize = @intCast(status.int());
            to_write = to_write[bytes_written..];
        }
    }

    pub fn connect(this: *UVStreamSink, signal: Signal) void {
        std.debug.assert(this.reader == null);
        this.signal = signal;
    }

    pub fn start(this: *UVStreamSink, _: StreamStart) JSC.Node.Maybe(void) {
        this.done = false;
        this.signal.start();
        return .{ .result = {} };
    }

    pub fn flush(_: *UVStreamSink) JSC.Node.Maybe(void) {
        return .{ .result = {} };
    }

    pub fn flushFromJS(_: *UVStreamSink, _: *JSGlobalObject, _: bool) JSC.Node.Maybe(JSValue) {
        return .{ .result = JSValue.jsNumber(0) };
    }

    pub fn close(this: *UVStreamSink) void {
        if(!Environment.isWindows) @panic("UVStreamSink is only supported on Windows");
        _ = uv.uv_close(@ptrCast(this.stream), null);
    }

    pub fn finalize(this: *UVStreamSink) void {
        if (this.buffer.cap > 0) {
            this.buffer.listManaged(this.allocator).deinit();
            this.buffer = bun.ByteList.init("");
        }
        this.close();
        this.allocator.destroy(this);
    }

    pub fn init(allocator: std.mem.Allocator, stream: StreamType, next: ?Sink) !*UVStreamSink {
        const this = try allocator.create(UVStreamSink);
        this.* = UVStreamSink{
            .stream = stream,
            .allocator = allocator,
            .next = next,
        };
        return this;
    }

    pub fn write(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.next) |*next| {
            return next.writeBytes(data);
        }
        const bytes = data.slice();
        this.writeMaybeSync(bytes);
        this.signal.ready(null, null);
        return .{ .owned = @truncate(bytes.len) };
    }

    pub const writeBytes = write;
    pub fn writeLatin1(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.next) |*next| {
            return next.writeLatin1(data);
        }
        const bytes = data.slice();
        if (strings.isAllASCII(bytes)) {
            this.writeMaybeSync(bytes);
            this.signal.ready(null, null);
            return .{ .owned = @truncate(bytes.len) };
        }
        this.buffer.len = 0;
        const len = this.buffer.writeLatin1(this.allocator, bytes) catch {
            return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
        };
        this.writeMaybeSync(this.buffer.slice());
        this.signal.ready(null, null);
        return .{ .owned = len };
    }

    pub fn writeUTF16(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.next) |*next| {
            return next.writeUTF16(data);
        }
        this.buffer.len = 0;
        const len = this.buffer.writeUTF16(this.allocator, @as([*]const u16, @ptrCast(@alignCast(data.slice().ptr)))[0..std.mem.bytesAsSlice(u16, data.slice()).len]) catch {
            return .{ .err = Syscall.Error.oom };
        };
        this.writeMaybeSync(this.buffer.slice());
        this.signal.ready(null, null);
        return .{ .owned = len };
    }

    pub fn end(this: *UVStreamSink, err: ?Syscall.Error) JSC.Node.Maybe(void) {
        if (this.next) |*next| {
            return next.end(err);
        }
        this.close();
        this.signal.close(err);
        return .{ .result = {} };
    }
    pub fn destroy(this: *UVStreamSink) void {
        if (this.buffer.cap > 0) {
            this.buffer.listManaged(this.allocator).deinit();
            this.buffer = bun.ByteList.init("");
            this.head = 0;
        }
        this.close();
        this.allocator.destroy(this);
    }
    pub fn toJS(this: *UVStreamSink, globalThis: *JSGlobalObject) JSValue {
        return JSSink.createObject(globalThis, this);
    }

    pub fn endFromJS(this: *UVStreamSink, _: *JSGlobalObject) JSC.Node.Maybe(JSValue) {
        if (this.done) {
            return .{ .result = JSC.JSValue.jsNumber(0) };
        }
        this.close();
        std.debug.assert(this.next == null);

        if (this.buffer.cap > 0) {
            this.buffer.listManaged(this.allocator).deinit();
            this.buffer = bun.ByteList.init("");
        }
        this.done = true;
        this.signal.close(null);
        return .{ .result = JSC.JSValue.jsNumber(0) };
    }

    pub fn sink(this: *UVStreamSink) Sink {
        return Sink.init(this);
    }

    pub const JSSink = NewJSSink(@This(), "UVStreamSink");
};

const AutoFlusher = struct {
    registered: bool = false,

    pub fn registerDeferredMicrotaskWithType(comptime Type: type, this: *Type, vm: *JSC.VirtualMachine) void {
        if (this.auto_flusher.registered) return;
        this.auto_flusher.registered = true;
        std.debug.assert(!vm.eventLoop().registerDeferredTask(this, @ptrCast(&Type.onAutoFlush)));
    }

    pub fn unregisterDeferredMicrotaskWithType(comptime Type: type, this: *Type, vm: *JSC.VirtualMachine) void {
        if (!this.auto_flusher.registered) return;
        this.auto_flusher.registered = false;
        std.debug.assert(vm.eventLoop().unregisterDeferredTask(this));
    }

    pub fn unregisterDeferredMicrotaskWithTypeUnchecked(comptime Type: type, this: *Type, vm: *JSC.VirtualMachine) void {
        std.debug.assert(this.auto_flusher.registered);
        std.debug.assert(vm.eventLoop().unregisterDeferredTask(this));
        this.auto_flusher.registered = false;
    }

    pub fn registerDeferredMicrotaskWithTypeUnchecked(comptime Type: type, this: *Type, vm: *JSC.VirtualMachine) void {
        std.debug.assert(!this.auto_flusher.registered);
        this.auto_flusher.registered = true;
        std.debug.assert(!vm.eventLoop().registerDeferredTask(this, @ptrCast(&Type.onAutoFlush)));
    }
};

pub fn NewJSSink(comptime SinkType: type, comptime name_: []const u8) type {
    return struct {
        sink: SinkType,

        const ThisSink = @This();

        pub const shim = JSC.Shimmer("", name_, @This());
        pub const name = std.fmt.comptimePrint("{s}", .{name_});

        // This attaches it to JS
        pub const SinkSignal = extern struct {
            cpp: JSValue,

            pub fn init(cpp: JSValue) Signal {
                // this one can be null
                @setRuntimeSafety(false);
                return Signal.initWithType(SinkSignal, @as(*SinkSignal, @ptrFromInt(@as(usize, @bitCast(@intFromEnum(cpp))))));
            }

            pub fn close(this: *@This(), _: ?Syscall.Error) void {
                onClose(@as(SinkSignal, @bitCast(@intFromPtr(this))).cpp, JSValue.jsUndefined());
            }

            pub fn ready(this: *@This(), _: ?Blob.SizeType, _: ?Blob.SizeType) void {
                onReady(@as(SinkSignal, @bitCast(@intFromPtr(this))).cpp, JSValue.jsUndefined(), JSValue.jsUndefined());
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
                    .message = bun.String.static(Static.message),
                    .code = bun.String.static(@as(string, @tagName(JSC.Node.ErrorCode.ERR_ILLEGAL_CONSTRUCTOR))),
                };
                globalThis.throwValue(err.toErrorInstance(globalThis));
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
            var this = @as(*ThisSink, @ptrCast(@alignCast(ptr)));

            this.sink.finalize();
        }

        pub fn detach(this: *ThisSink) void {
            if (comptime !@hasField(SinkType, "signal"))
                return;

            const ptr = this.sink.signal.ptr;
            if (this.sink.signal.isDead())
                return;
            this.sink.signal.clear();
            const value = @as(JSValue, @enumFromInt(@as(JSC.JSValueReprInt, @bitCast(@intFromPtr(ptr)))));
            value.unprotect();
            detachPtr(value);
        }

        pub fn detachPtr(ptr: JSValue) callconv(.C) void {
            shim.cppFn("detachPtr", .{ptr});
        }

        fn getThis(globalThis: *JSGlobalObject, callframe: *const JSC.CallFrame) ?*ThisSink {
            return @as(
                *ThisSink,
                @ptrCast(@alignCast(
                    fromJS(
                        globalThis,
                        callframe.this(),
                    ) orelse return null,
                )),
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

            if (args.len == 0) {
                globalThis.vm().throwError(globalThis, JSC.toTypeError(
                    JSC.Node.ErrorCode.ERR_MISSING_ARGS,
                    "write() expects a string, ArrayBufferView, or ArrayBuffer",
                    .{},
                    globalThis,
                ));
                return JSC.JSValue.jsUndefined();
            }

            const arg = args[0];
            arg.ensureStillAlive();
            defer arg.ensureStillAlive();

            if (arg.isEmptyOrUndefinedOrNull()) {
                globalThis.vm().throwError(globalThis, JSC.toTypeError(
                    JSC.Node.ErrorCode.ERR_STREAM_NULL_VALUES,
                    "write() expects a string, ArrayBufferView, or ArrayBuffer",
                    .{},
                    globalThis,
                ));
                return JSC.JSValue.jsUndefined();
            }

            if (arg.asArrayBuffer(globalThis)) |buffer| {
                const slice = buffer.slice();
                if (slice.len == 0) {
                    return JSC.JSValue.jsNumber(0);
                }

                return this.sink.writeBytes(.{ .temporary = bun.ByteList.init(slice) }).toJS(globalThis);
            }

            if (!arg.isString()) {
                globalThis.vm().throwError(globalThis, JSC.toTypeError(
                    JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE,
                    "write() expects a string, ArrayBufferView, or ArrayBuffer",
                    .{},
                    globalThis,
                ));
                return JSC.JSValue.jsUndefined();
            }

            const str = arg.getZigString(globalThis);
            if (str.len == 0) {
                return JSC.JSValue.jsNumber(0);
            }

            if (str.is16Bit()) {
                return this.sink.writeUTF16(.{ .temporary = bun.ByteList.initConst(std.mem.sliceAsBytes(str.utf16SliceAligned())) }).toJS(globalThis);
            }

            return this.sink.writeLatin1(.{ .temporary = bun.ByteList.initConst(str.slice()) }).toJS(globalThis);
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
            var this = @as(*ThisSink, @ptrCast(@alignCast(sink_ptr orelse return invalidThis(globalThis))));

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
                if ((comptime @hasField(SinkType, "done")) and this.sink.done) {
                    callframe.this().unprotect();
                }
            }

            if (comptime @hasDecl(SinkType, "flushFromJS")) {
                const wait = callframe.argumentsCount() > 0 and
                    callframe.argument(0).isBoolean() and
                    callframe.argument(0).asBoolean();
                const maybe_value: JSC.Node.Maybe(JSValue) = this.sink.flushFromJS(globalThis, wait);
                return switch (maybe_value) {
                    .result => |value| value,
                    .err => |err| blk: {
                        globalThis.vm().throwError(globalThis, err.toJSC(globalThis));
                        break :blk JSC.JSValue.jsUndefined();
                    },
                };
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
                if (comptime @hasField(SinkType, "done")) {
                    if (this.sink.done) {
                        callframe.this().unprotect();
                    }
                }
            }

            return this.sink.endFromJS(globalThis).toJS(globalThis);
        }

        pub fn endWithSink(ptr: *anyopaque, globalThis: *JSGlobalObject) callconv(.C) JSValue {
            JSC.markBinding(@src());

            var this = @as(*ThisSink, @ptrCast(@alignCast(ptr)));

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
            .finalize = finalize,
            .write = write,
            .close = close,
            .flush = flush,
            .start = start,
            .end = end,
            .construct = construct,
            .endWithSink = endWithSink,
            .updateRef = updateRef,
        });

        pub fn updateRef(ptr: *anyopaque, value: bool) callconv(.C) void {
            JSC.markBinding(@src());
            var this = bun.cast(*ThisSink, ptr);
            if (comptime @hasDecl(SinkType, "updateRef"))
                this.sink.updateRef(value);
        }

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
                @export(updateRef, .{ .name = Export[8].symbol_name });
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

//             var this = @ptrCast(*ThisSocket, @alignCast( fromJS(globalThis, callframe.this()) orelse {
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

        onFirstWrite: ?*const fn (?*anyopaque) void = null,
        ctx: ?*anyopaque = null,

        auto_flusher: AutoFlusher = AutoFlusher{},

        const log = Output.scoped(.HTTPServerWritable, false);

        pub fn connect(this: *@This(), signal: Signal) void {
            this.signal = signal;
        }

        fn handleWrote(this: *@This(), amount1: usize) void {
            const amount = @as(Blob.SizeType, @truncate(amount1));
            this.offset += amount;
            this.wrote += amount;
            this.buffer.len -|= @as(u32, @truncate(amount));

            if (this.offset >= this.buffer.len) {
                this.offset = 0;
                this.buffer.len = 0;
            }
        }

        fn handleFirstWriteIfNecessary(this: *@This()) void {
            if (this.onFirstWrite) |onFirstWrite| {
                const ctx = this.ctx;
                this.ctx = null;
                this.onFirstWrite = null;
                onFirstWrite(ctx);
            }
        }

        fn hasBackpressure(this: *const @This()) bool {
            return this.has_backpressure;
        }

        fn sendWithoutAutoFlusher(this: *@This(), buf: []const u8) bool {
            std.debug.assert(!this.done);
            defer log("send: {d} bytes (backpressure: {any})", .{ buf.len, this.has_backpressure });

            if (this.requested_end and !this.res.state().isHttpWriteCalled()) {
                this.handleFirstWriteIfNecessary();
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
                this.handleFirstWriteIfNecessary();
                this.res.end(buf, false);
                this.has_backpressure = false;
                return true;
            } else {
                this.handleFirstWriteIfNecessary();
                this.has_backpressure = !this.res.write(buf);
                if (this.has_backpressure) {
                    this.res.onWritable(*@This(), onWritable, this);
                }
                return true;
            }

            unreachable;
        }

        fn send(this: *@This(), buf: []const u8) bool {
            this.unregisterAutoFlusher();
            return this.sendWithoutAutoFlusher(buf);
        }

        fn readableSlice(this: *@This()) []const u8 {
            return this.buffer.ptr[this.offset..this.buffer.cap][0..this.buffer.len];
        }

        pub fn onWritable(this: *@This(), write_offset_: c_ulong, _: *UWSResponse) callconv(.C) bool {
            const write_offset: u64 = @as(u64, write_offset_);
            log("onWritable ({d})", .{write_offset});

            if (this.done) {
                if (this.aborted == false) {
                    this.res.endStream(false);
                }
                this.finalize();
                return false;
            }

            // do not write more than available
            // if we do, it will cause this to be delayed until the next call, each time
            const to_write = @min(@as(Blob.SizeType, @truncate(write_offset)), @as(Blob.SizeType, this.buffer.len));

            // figure out how much data exactly to write
            const readable = this.readableSlice()[0..to_write];
            if (!this.send(readable)) {
                // if we were unable to send it, retry
                this.res.onWritable(*@This(), onWritable, this);
                return true;
            }

            this.handleWrote(@as(Blob.SizeType, @truncate(readable.len)));
            const initial_wrote = this.wrote;

            if (this.buffer.len > 0 and !this.done) {
                this.res.onWritable(*@This(), onWritable, this);
                return true;
            }

            // flush the javascript promise from calling .flush()
            this.flushPromise();

            // pending_flush or callback could have caused another send()
            // so we check again if we should report readiness
            if (!this.done and !this.requested_end and !this.hasBackpressure()) {
                const pending = @as(Blob.SizeType, @truncate(write_offset)) -| to_write;
                const written_after_flush = this.wrote - initial_wrote;
                const to_report = pending - @min(written_after_flush, pending);

                if ((written_after_flush == initial_wrote and pending == 0) or to_report > 0) {
                    this.signal.ready(to_report, null);
                }
            }

            return false;
        }

        pub fn start(this: *@This(), stream_start: StreamStart) JSC.Node.Maybe(void) {
            if (this.aborted or this.res.hasResponded()) {
                this.markDone();
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
            log("flushFromJSNoWait", .{});
            if (this.hasBackpressure() or this.done) {
                return .{ .result = JSValue.jsNumberFromInt32(0) };
            }

            const slice = this.readableSlice();
            if (slice.len == 0) {
                return .{ .result = JSValue.jsNumberFromInt32(0) };
            }

            const success = this.send(slice);
            if (success) {
                this.handleWrote(@as(Blob.SizeType, @truncate(slice.len)));
                return .{ .result = JSValue.jsNumber(slice.len) };
            }

            return .{ .result = JSValue.jsNumberFromInt32(0) };
        }

        pub fn flushFromJS(this: *@This(), globalThis: *JSGlobalObject, wait: bool) JSC.Node.Maybe(JSValue) {
            log("flushFromJS({any})", .{wait});
            this.unregisterAutoFlusher();

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
                    this.handleWrote(@as(Blob.SizeType, @truncate(slice.len)));
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
            this.unregisterAutoFlusher();

            if (!this.hasBackpressure() or this.done) {
                return .{ .result = {} };
            }

            if (this.res.hasResponded()) {
                this.markDone();
                this.signal.close(null);
            }

            return .{ .result = {} };
        }

        pub fn write(this: *@This(), data: StreamResult) StreamResult.Writable {
            if (this.done or this.requested_end) {
                return .{ .owned = 0 };
            }

            const bytes = data.slice();
            const len = @as(Blob.SizeType, @truncate(bytes.len));
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
                this.registerAutoFlusher();
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
                this.registerAutoFlusher();
                return .{ .owned = len };
            }

            this.registerAutoFlusher();
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
                this.markDone();
                return .{ .done = {} };
            }

            const bytes = data.slice();
            const len = @as(Blob.SizeType, @truncate(bytes.len));
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
                this.registerAutoFlusher();
                return .{ .owned = len };
            }

            this.registerAutoFlusher();
            this.res.onWritable(*@This(), onWritable, this);

            return .{ .owned = len };
        }
        pub fn writeUTF16(this: *@This(), data: StreamResult) StreamResult.Writable {
            if (this.done or this.requested_end) {
                return .{ .owned = 0 };
            }

            if (this.res.hasResponded()) {
                this.signal.close(null);
                this.markDone();
                return .{ .done = {} };
            }

            const bytes = data.slice();

            log("writeUTF16({d})", .{bytes.len});

            // we must always buffer UTF-16
            // we assume the case of all-ascii UTF-16 string is pretty uncommon
            const written = this.buffer.writeUTF16(this.allocator, @alignCast(std.mem.bytesAsSlice(u16, bytes))) catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };

            const readable = this.readableSlice();

            if (readable.len >= this.highWaterMark or this.hasBackpressure()) {
                if (this.send(readable)) {
                    this.handleWrote(readable.len);
                    return .{ .owned = @as(Blob.SizeType, @intCast(written)) };
                }

                this.res.onWritable(*@This(), onWritable, this);
            }

            this.registerAutoFlusher();
            return .{ .owned = @as(Blob.SizeType, @intCast(written)) };
        }

        pub fn markDone(this: *@This()) void {
            this.done = true;
            this.unregisterAutoFlusher();
        }

        // In this case, it's always an error
        pub fn end(this: *@This(), err: ?Syscall.Error) JSC.Node.Maybe(void) {
            log("end({any})", .{err});

            if (this.requested_end) {
                return .{ .result = {} };
            }

            if (this.done or this.res.hasResponded()) {
                this.signal.close(err);
                this.markDone();
                this.finalize();
                return .{ .result = {} };
            }

            this.requested_end = true;
            const readable = this.readableSlice();
            this.end_len = readable.len;

            if (readable.len == 0) {
                this.signal.close(err);
                this.markDone();
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
                this.requested_end = true;
                this.signal.close(null);
                this.markDone();
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

            this.markDone();
            this.flushPromise();
            this.signal.close(null);
            this.finalize();

            return .{ .result = JSC.JSValue.jsNumber(this.wrote) };
        }

        pub fn sink(this: *@This()) Sink {
            return Sink.init(this);
        }

        pub fn abort(this: *@This()) void {
            log("onAborted()", .{});
            this.done = true;
            this.unregisterAutoFlusher();

            this.aborted = true;
            this.signal.close(null);

            this.flushPromise();
            this.finalize();
        }

        fn unregisterAutoFlusher(this: *@This()) void {
            if (this.auto_flusher.registered)
                AutoFlusher.unregisterDeferredMicrotaskWithTypeUnchecked(@This(), this, this.globalThis.bunVM());
        }

        fn registerAutoFlusher(this: *@This()) void {
            if (!this.auto_flusher.registered)
                AutoFlusher.registerDeferredMicrotaskWithTypeUnchecked(@This(), this, this.globalThis.bunVM());
        }

        pub fn onAutoFlush(this: *@This()) bool {
            log("onAutoFlush()", .{});
            if (this.done) {
                this.auto_flusher.registered = false;
                return false;
            }

            const readable = this.readableSlice();

            if (this.hasBackpressure() or readable.len == 0) {
                this.auto_flusher.registered = false;
                return false;
            }

            if (!this.sendWithoutAutoFlusher(readable)) {
                this.auto_flusher.registered = true;
                this.res.onWritable(*@This(), onWritable, this);
                return true;
            }

            this.handleWrote(readable.len);
            this.auto_flusher.registered = false;
            return false;
        }

        pub fn destroy(this: *@This()) void {
            log("destroy()", .{});
            var bytes = this.buffer.listManaged(this.allocator);
            if (bytes.capacity > 0) {
                this.buffer = bun.ByteList.init("");
                bytes.deinit();
            }

            this.unregisterAutoFlusher();

            this.allocator.destroy(this);
        }

        // This can be called _many_ times for the same instance
        // so it must zero out state instead of make it
        pub fn finalize(this: *@This()) void {
            log("finalize()", .{});

            if (!this.done) {
                this.done = true;
                this.unregisterAutoFlusher();
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
    comptime deinit_fn: fn (this: *Context) void,
    comptime setRefUnrefFn: ?fn (this: *Context, enable: bool) void,
    comptime drainInternalBuffer: ?fn (this: *Context) bun.ByteList,
) type {
    return struct {
        context: Context,
        cancelled: bool = false,
        deinited: bool = false,
        ref_count: u32 = 1,
        pending_err: ?Syscall.Error = null,
        close_handler: ?*const fn (*anyopaque) void = null,
        close_ctx: ?*anyopaque = null,
        close_jsvalue: JSValue = JSValue.zero,
        globalThis: *JSGlobalObject = undefined,

        const This = @This();
        const ReadableStreamSourceType = @This();

        pub fn pull(this: *This, buf: []u8) StreamResult {
            return onPull(&this.context, buf, JSValue.zero);
        }

        pub fn ref(this: *This) void {
            if (setRefUnrefFn) |setRefUnref| {
                setRefUnref(&this.context, true);
            }
        }

        pub fn unref(this: *This) void {
            if (setRefUnrefFn) |setRefUnref| {
                setRefUnref(&this.context, false);
            }
        }

        pub fn setRef(this: *This, value: bool) void {
            if (setRefUnrefFn) |setRefUnref| {
                setRefUnref(&this.context, value);
            }
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

        pub fn incrementCount(this: *This) !void {
            if (this.deinited) {
                return error.InvalidStream;
            }
            this.ref_count += 1;
        }

        pub fn decrementCount(this: *This) u32 {
            if (this.ref_count == 0 or this.deinited) {
                return 0;
            }

            this.ref_count -= 1;
            if (this.ref_count == 0) {
                this.deinited = true;
                deinit_fn(&this.context);
                return 0;
            }

            return this.ref_count;
        }

        pub fn getError(this: *This) ?Syscall.Error {
            if (this.pending_err) |err| {
                this.pending_err = null;
                return err;
            }

            return null;
        }

        pub fn drain(this: *This) bun.ByteList {
            if (drainInternalBuffer) |drain_fn| {
                return drain_fn(&this.context);
            }

            return .{};
        }

        pub fn toJS(this: *ReadableStreamSourceType, globalThis: *JSGlobalObject) JSC.JSValue {
            return ReadableStream.fromNative(globalThis, Context.tag, this);
        }

        const supports_ref = setRefUnrefFn != null;

        pub const JSReadableStreamSource = struct {
            pub const shim = JSC.Shimmer(name_, "JSReadableStreamSource", @This());
            pub const name = std.fmt.comptimePrint("{s}_JSReadableStreamSource", .{name_});

            pub fn pull(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                JSC.markBinding(@src());
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
                JSC.markBinding(@src());
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
                        if (err == .Error) {
                            globalThis.vm().throwError(globalThis, err.Error.toJSC(globalThis));
                        } else {
                            const js_err = err.JSValue;
                            js_err.ensureStillAlive();
                            js_err.unprotect();
                            globalThis.vm().throwError(globalThis, js_err);
                        }
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
                JSC.markBinding(@src());
                var this = callFrame.argument(0).asPtr(ReadableStreamSourceType);
                this.cancel();
                return JSC.JSValue.jsUndefined();
            }
            pub fn setClose(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                JSC.markBinding(@src());
                var this = callFrame.argument(0).asPtr(ReadableStreamSourceType);
                this.close_ctx = this;
                this.close_handler = JSReadableStreamSource.onClose;
                this.globalThis = globalThis;
                this.close_jsvalue = callFrame.argument(1);
                return JSC.JSValue.jsUndefined();
            }

            pub fn updateRef(_: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                JSC.markBinding(@src());
                var this = callFrame.argument(0).asPtr(ReadableStreamSourceType);
                const ref_or_unref = callFrame.argument(1).asBoolean();
                this.setRef(ref_or_unref);
                return JSC.JSValue.jsUndefined();
            }

            fn onClose(ptr: *anyopaque) void {
                JSC.markBinding(@src());
                var this = bun.cast(*ReadableStreamSourceType, ptr);
                _ = this.close_jsvalue.call(this.globalThis, &.{});
                //    this.closer
            }

            pub fn deinit(_: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                JSC.markBinding(@src());
                var this = callFrame.argument(0).asPtr(ReadableStreamSourceType);
                _ = this.decrementCount();
                return JSValue.jsUndefined();
            }

            pub fn drain(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                JSC.markBinding(@src());
                var this = callFrame.argument(0).asPtr(ReadableStreamSourceType);
                var list = this.drain();
                if (list.len > 0) {
                    return JSC.ArrayBuffer.fromBytes(list.slice(), .Uint8Array).toJS(globalThis, null);
                }
                return JSValue.jsUndefined();
            }

            pub fn load(globalThis: *JSGlobalObject) callconv(.C) JSC.JSValue {
                JSC.markBinding(@src());
                // This is used also in Node.js streams
                return JSC.JSArray.from(globalThis, &.{
                    JSC.NewFunction(globalThis, null, 2, JSReadableStreamSource.pull, true),
                    JSC.NewFunction(globalThis, null, 2, JSReadableStreamSource.start, true),
                    JSC.NewFunction(globalThis, null, 2, JSReadableStreamSource.cancel, true),
                    JSC.NewFunction(globalThis, null, 2, JSReadableStreamSource.setClose, true),
                    JSC.NewFunction(globalThis, null, 2, JSReadableStreamSource.deinit, true),
                    if (supports_ref)
                        JSC.NewFunction(globalThis, null, 2, JSReadableStreamSource.updateRef, true)
                    else
                        JSC.JSValue.jsNull(),
                    if (drainInternalBuffer != null)
                        JSC.NewFunction(globalThis, null, 1, JSReadableStreamSource.drain, true)
                    else
                        JSC.JSValue.jsNull(),
                });
            }

            pub const Export = shim.exportFunctions(.{
                .load = load,
            });

            comptime {
                if (!JSC.is_bindgen) {
                    @export(load, .{ .name = Export[0].symbol_name });
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

    pub fn parent(this: *@This()) *Source {
        return @fieldParentPtr(Source, "context", this);
    }

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
            .chunk_size = if (user_chunk_size > 0) @min(user_chunk_size, blobe.size) else @min(1024 * 1024 * 2, blobe.size),
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

        temporary = temporary[0..@min(buffer.len, @min(temporary.len, this.remain))];
        if (temporary.len == 0) {
            this.store.deref();
            this.done = true;
            return .{ .done = {} };
        }

        const copied = @as(Blob.SizeType, @intCast(temporary.len));

        this.remain -|= copied;
        this.offset +|= copied;
        std.debug.assert(buffer.ptr != temporary.ptr);
        @memcpy(buffer[0..temporary.len], temporary);
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

    pub fn drain(this: *ByteBlobLoader) bun.ByteList {
        var temporary = this.store.sharedView();
        temporary = temporary[this.offset..];
        temporary = temporary[0..@min(16384, @min(temporary.len, this.remain))];

        const cloned = bun.ByteList.init(temporary).listManaged(bun.default_allocator).clone() catch @panic("Out of memory");
        this.offset +|= @as(Blob.SizeType, @truncate(cloned.items.len));
        this.remain -|= @as(Blob.SizeType, @truncate(cloned.items.len));

        return bun.ByteList.fromList(cloned);
    }

    pub const Source = ReadableStreamSource(
        @This(),
        "ByteBlob",
        onStart,
        onPull,
        onCancel,
        deinit,
        null,
        drain,
    );
};

pub const PipeFunction = *const fn (ctx: *anyopaque, stream: StreamResult, allocator: std.mem.Allocator) void;

pub const PathOrFileDescriptor = union(enum) {
    path: ZigString.Slice,
    fd: bun.FileDescriptor,

    pub fn deinit(this: *const PathOrFileDescriptor) void {
        if (this.* == .path) this.path.deinit();
    }
};

pub const Pipe = struct {
    ctx: ?*anyopaque = null,
    onPipe: ?PipeFunction = null,

    pub fn New(comptime Type: type, comptime Function: anytype) type {
        return struct {
            pub fn pipe(self: *anyopaque, stream: StreamResult, allocator: std.mem.Allocator) void {
                Function(@as(*Type, @ptrCast(@alignCast(self))), stream, allocator);
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
            return .{ .empty = {} };
        }

        if (this.has_received_last_chunk) {
            return .{ .chunk_size = @min(1024 * 1024 * 2, this.buffer.items.len) };
        }

        if (this.highWaterMark == 0) {
            return .{ .ready = {} };
        }

        return .{ .chunk_size = @max(this.highWaterMark, std.mem.page_size) };
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
            const to_copy = this.pending_buffer[0..@min(chunk.len, this.pending_buffer.len)];
            const pending_buffer_len = this.pending_buffer.len;
            std.debug.assert(to_copy.ptr != chunk.ptr);
            @memcpy(to_copy, chunk[0..to_copy.len]);
            this.pending_buffer = &.{};

            const is_really_done = this.has_received_last_chunk and to_copy.len <= pending_buffer_len;

            if (is_really_done) {
                this.done = true;

                if (to_copy.len == 0) {
                    if (stream == .err) {
                        if (stream.err == .Error) {
                            this.pending.result = .{ .err = .{ .Error = stream.err.Error } };
                        }
                        const js_err = stream.err.JSValue;
                        js_err.ensureStillAlive();
                        js_err.protect();
                        this.pending.result = .{ .err = .{ .JSValue = js_err } };
                    } else {
                        this.pending.result = .{
                            .done = {},
                        };
                    }
                } else {
                    this.pending.result = .{
                        .into_array_and_done = .{
                            .value = this.value(),
                            .len = @as(Blob.SizeType, @truncate(to_copy.len)),
                        },
                    };
                }
            } else {
                this.pending.result = .{
                    .into_array = .{
                        .value = this.value(),
                        .len = @as(Blob.SizeType, @truncate(to_copy.len)),
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
                .err => {
                    this.pending.result = .{ .err = stream.err };
                },
                else => unreachable,
            }
            return;
        }

        switch (stream) {
            .temporary_and_done, .temporary => {
                try this.buffer.appendSlice(chunk);
            },
            .err => {
                this.pending.result = .{ .err = stream.err };
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
            const to_write = @min(
                this.buffer.items.len - this.offset,
                buffer.len,
            );
            const remaining_in_buffer = this.buffer.items[this.offset..][0..to_write];

            @memcpy(buffer[0..to_write], this.buffer.items[this.offset..][0..to_write]);

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
                        .len = @as(Blob.SizeType, @truncate(to_write)),
                    },
                };
            }

            return .{
                .into_array = .{
                    .value = view,
                    .len = @as(Blob.SizeType, @truncate(to_write)),
                },
            };
        }

        if (this.has_received_last_chunk) {
            return .{
                .done = {},
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

    pub const Source = ReadableStreamSource(
        @This(),
        "ByteStream",
        onStart,
        onPull,
        onCancel,
        deinit,
        null,
        null,
    );
};

pub const ReadResult = union(enum) {
    pending: void,
    err: Syscall.Error,
    done: void,
    read: []u8,

    pub fn toStream(this: ReadResult, pending: *StreamResult.Pending, buf: []u8, view: JSValue, close_on_empty: bool) StreamResult {
        return toStreamWithIsDone(
            this,
            pending,
            buf,
            view,
            close_on_empty,
            false,
        );
    }
    pub fn toStreamWithIsDone(this: ReadResult, pending: *StreamResult.Pending, buf: []u8, view: JSValue, close_on_empty: bool, is_done: bool) StreamResult {
        return switch (this) {
            .pending => .{ .pending = pending },
            .err => .{ .err = .{ .Error = this.err } },
            .done => .{ .done = {} },
            .read => |slice| brk: {
                const owned = slice.ptr != buf.ptr;
                const done = is_done or (close_on_empty and slice.len == 0);

                break :brk if (owned and done)
                    StreamResult{ .owned_and_done = bun.ByteList.init(slice) }
                else if (owned)
                    StreamResult{ .owned = bun.ByteList.init(slice) }
                else if (done)
                    StreamResult{ .into_array_and_done = .{ .len = @as(Blob.SizeType, @truncate(slice.len)), .value = view } }
                else
                    StreamResult{ .into_array = .{ .len = @as(Blob.SizeType, @truncate(slice.len)), .value = view } };
            },
        };
    }
};

pub const AutoSizer = struct {
    buffer: *bun.ByteList,
    allocator: std.mem.Allocator,
    max: usize,

    pub fn resize(this: *AutoSizer, size: usize) ![]u8 {
        const available = this.buffer.cap - this.buffer.len;
        if (available >= size) return this.buffer.ptr[this.buffer.len..this.buffer.cap][0..size];
        const to_grow = size -| available;
        if (to_grow + @as(usize, this.buffer.cap) > this.max)
            return this.buffer.ptr[this.buffer.len..this.buffer.cap];

        var list = this.buffer.listManaged(this.allocator);
        const prev_len = list.items.len;
        try list.ensureTotalCapacity(to_grow + @as(usize, this.buffer.cap));
        this.buffer.update(list);
        return this.buffer.ptr[prev_len..@as(usize, this.buffer.cap)];
    }
};

pub const FIFO = NewFIFO(.js);
pub const FIFOMini = NewFIFO(.mini);

pub fn NewFIFO(comptime EventLoop: JSC.EventLoopKind) type {
    return struct {
        buf: []u8 = &[_]u8{},
        view: JSC.Strong = .{},
        poll_ref: ?*Async.FilePoll = null,
        fd: bun.FileDescriptor = bun.invalid_fd,
        to_read: ?u32 = null,
        close_on_empty_read: bool = false,
        auto_sizer: ?*AutoSizer = null,
        pending: StreamResult.Pending = StreamResult.Pending{
            .future = undefined,
            .state = .none,
            .result = .{ .done = {} },
        },
        signal: JSC.WebCore.Signal = .{},
        is_first_read: bool = true,
        has_adjusted_pipe_size_on_linux: bool = false,
        drained: bool = true,

        pub const event_loop_kind = EventLoop;
        pub usingnamespace NewReadyWatcher(@This(), .readable, ready);

        pub fn finish(this: *@This()) void {
            this.close_on_empty_read = true;
            if (this.poll_ref) |poll| {
                poll.flags.insert(.hup);
                poll.disableKeepingProcessAlive(EventLoop.getVm());
            }

            this.pending.result = .{ .done = {} };
            this.pending.run();
        }

        pub fn close(this: *@This()) void {
            if (this.poll_ref) |poll| {
                this.poll_ref = null;
                poll.deinit();
            }

            const fd = this.fd;
            const signal_close = fd != bun.invalid_fd;
            defer if (signal_close) this.signal.close(null);
            if (signal_close) {
                this.fd = bun.invalid_fd;
                _ = bun.sys.close(fd);
            }

            this.to_read = null;
            this.pending.result = .{ .done = {} };

            this.pending.run();
        }

        pub fn isClosed(this: *@This()) bool {
            return this.fd == bun.invalid_fd;
        }

        pub fn getAvailableToReadOnLinux(this: *@This()) u32 {
            var len: c_int = 0;
            const rc: c_int = std.c.ioctl(this.fd.cast(), std.os.linux.T.FIONREAD, @as(*c_int, &len));
            if (rc != 0) {
                len = 0;
            }

            if (len > 0) {
                if (this.poll_ref) |poll| {
                    poll.flags.insert(.readable);
                }
            } else {
                if (this.poll_ref) |poll| {
                    poll.flags.remove(.readable);
                }

                return @as(u32, 0);
            }

            return @as(u32, @intCast(@max(len, 0)));
        }

        pub fn adjustPipeCapacityOnLinux(this: *@This(), current: usize, max: usize) void {
            // we do not un-mark it as readable if there's nothing in the pipe
            if (!this.has_adjusted_pipe_size_on_linux) {
                if (current > 0 and max >= std.mem.page_size * 16) {
                    this.has_adjusted_pipe_size_on_linux = true;
                    _ = Syscall.setPipeCapacityOnLinux(this.fd, @min(max * 4, Syscall.getMaxPipeSizeOnLinux()));
                }
            }
        }

        pub fn cannotRead(this: *@This(), available: u32) ?ReadResult {
            if (comptime Environment.isLinux) {
                if (available > 0 and available != std.math.maxInt(u32)) {
                    return null;
                }
            }

            if (this.poll_ref) |poll| {
                if (comptime Environment.isMac) {
                    if (available > 0 and available != std.math.maxInt(u32)) {
                        poll.flags.insert(.readable);
                    }
                }

                const is_readable = poll.isReadable();
                if (!is_readable and (this.close_on_empty_read or poll.isHUP())) {
                    // it might be readable actually
                    this.close_on_empty_read = true;
                    switch (bun.isReadable(poll.fd)) {
                        .ready => {
                            this.close_on_empty_read = false;
                            return null;
                        },
                        // we need to read the 0 at the end or else we are not truly done
                        .hup => {
                            this.close_on_empty_read = true;
                            poll.flags.insert(.hup);
                            return null;
                        },
                        else => {},
                    }

                    return .done;
                } else if (!is_readable and poll.isWatching()) {
                    // if the file was opened non-blocking
                    // we don't risk anything by attempting to read it!
                    if (poll.flags.contains(.nonblocking))
                        return null;

                    // this happens if we've registered a watcher but we haven't
                    // ticked the event loop since registering it
                    switch (bun.isReadable(poll.fd)) {
                        .ready => {
                            poll.flags.insert(.readable);
                            return null;
                        },
                        .hup => {
                            poll.flags.insert(.hup);
                            poll.flags.insert(.readable);
                            return null;
                        },
                        else => {
                            return .pending;
                        },
                    }
                }
            }

            if (comptime Environment.isLinux) {
                if (available == 0) {
                    std.debug.assert(this.poll_ref == null);
                    return .pending;
                }
            } else if (available == std.math.maxInt(@TypeOf(available)) and this.poll_ref == null) {
                // we don't know if it's readable or not
                return switch (bun.isReadable(this.fd)) {
                    .hup => {
                        this.close_on_empty_read = true;
                        return null;
                    },
                    .ready => null,
                    else => ReadResult{ .pending = {} },
                };
            }

            return null;
        }

        pub fn getAvailableToRead(this: *@This(), size_or_offset: i64) ?u32 {
            if (comptime Environment.isLinux) {
                return this.getAvailableToReadOnLinux();
            }

            if (size_or_offset != std.math.maxInt(@TypeOf(size_or_offset)))
                this.to_read = @as(u32, @intCast(@max(size_or_offset, 0)));

            return this.to_read;
        }

        const log = bun.Output.scoped(.FIFO, false);
        pub fn ready(this: *@This(), sizeOrOffset: i64, is_hup: bool) void {
            log("FIFO ready", .{});
            if (this.isClosed()) {
                if (this.isWatching())
                    this.unwatch(this.poll_ref.?.fd);
                return;
            }

            defer {
                if (comptime EventLoop == .js) JSC.VirtualMachine.get().drainMicrotasks();
            }

            if (comptime Environment.isMac) {
                if (sizeOrOffset == 0 and is_hup and this.drained) {
                    this.close();
                    return;
                }
            } else if (is_hup and this.drained and this.getAvailableToReadOnLinux() == 0) {
                this.close();
                return;
            }

            if (this.buf.len == 0) {
                var auto_sizer = this.auto_sizer orelse return;
                if (comptime Environment.isMac) {
                    if (sizeOrOffset > 0) {
                        this.buf = auto_sizer.resize(@as(usize, @intCast(sizeOrOffset))) catch return;
                    } else {
                        this.buf = auto_sizer.resize(8192) catch return;
                    }
                }
            }

            const read_result = this.read(
                this.buf,
                // On Linux, we end up calling ioctl() twice if we don't do this
                if (comptime Environment.isMac)
                    // i33 holds the same amount of unsigned space as a u32, so we truncate it there before casting
                    @as(u32, @intCast(@as(i33, @truncate(sizeOrOffset))))
                else
                    null,
            );

            if (read_result == .read) {
                if (this.to_read) |*to_read| {
                    to_read.* = to_read.* -| @as(u32, @truncate(read_result.read.len));
                }
            }

            this.pending.result = read_result.toStream(
                &this.pending,
                this.buf,
                this.view.get() orelse .zero,
                this.close_on_empty_read,
            );
            this.pending.run();
        }

        pub fn readFromJS(
            this: *@This(),
            buf_: []u8,
            view: JSValue,
            globalThis: *JSC.JSGlobalObject,
        ) StreamResult {
            if (this.isClosed()) {
                return .{ .done = {} };
            }

            if (!this.isWatching()) {
                this.watch(this.fd);
            }

            const read_result = this.read(buf_, this.to_read);
            if (read_result == .read and read_result.read.len == 0) {
                this.close();
                return .{ .done = {} };
            }

            if (read_result == .read) {
                if (this.to_read) |*to_read| {
                    to_read.* = to_read.* -| @as(u32, @truncate(read_result.read.len));
                }
            }

            if (read_result == .pending) {
                this.buf = buf_;
                this.view.set(globalThis, view);
                if (!this.isWatching()) this.watch(this.fd);
                std.debug.assert(this.isWatching());
                return .{ .pending = &this.pending };
            }

            return read_result.toStream(&this.pending, buf_, view, this.close_on_empty_read);
        }

        pub fn read(
            this: *@This(),
            buf_: []u8,
            /// provided via kqueue(), only on macOS
            kqueue_read_amt: ?u32,
        ) ReadResult {
            const available_to_read = this.getAvailableToRead(
                if (kqueue_read_amt != null)
                    @as(i64, @intCast(kqueue_read_amt.?))
                else
                    std.math.maxInt(i64),
            );

            if (this.cannotRead(available_to_read orelse std.math.maxInt(u32))) |res| {
                return switch (res) {
                    .pending => .{ .pending = {} },
                    .done => .{ .done = {} },
                    else => unreachable,
                };
            }

            var buf = buf_;
            std.debug.assert(buf.len > 0);

            if (available_to_read) |amt| {
                if (amt >= buf.len) {
                    if (comptime Environment.isLinux) {
                        this.adjustPipeCapacityOnLinux(amt, buf.len);
                    }

                    if (this.auto_sizer) |sizer| {
                        buf = sizer.resize(amt) catch buf_;
                    }
                }
            }

            return this.doRead(buf);
        }

        fn doRead(
            this: *@This(),
            buf: []u8,
        ) ReadResult {
            switch (Syscall.read(this.fd, buf)) {
                .err => |err| {
                    const retry = E.AGAIN;
                    const errno: E = brk: {
                        const _errno = err.getErrno();

                        if (comptime Environment.isLinux) {
                            if (_errno == .PERM)
                                // EPERM and its a FIFO on Linux? Trying to read past a FIFO which has already
                                // sent a 0
                                // Let's retry later.
                                return .{ .pending = {} };
                        }

                        break :brk _errno;
                    };

                    switch (errno) {
                        retry => {
                            return .{ .pending = {} };
                        },
                        else => {},
                    }

                    return .{ .err = err };
                },
                .result => |result| {
                    if (this.poll_ref) |poll| {
                        if (comptime Environment.isLinux) {
                            // do not insert .eof here
                            if (result < buf.len)
                                poll.flags.remove(.readable);
                        } else {
                            // Since we have no way of querying FIFO capacity
                            // its only okay to read when kqueue says its readable
                            // otherwise we might block the process
                            poll.flags.remove(.readable);
                        }
                    }

                    if (result == 0) {
                        return .{ .read = buf[0..0] };
                    }
                    return .{ .read = buf[0..result] };
                },
            }
        }
    };
}

pub const File = struct {
    buf: []u8 = &[_]u8{},
    view: JSC.Strong = .{},

    poll_ref: Async.KeepAlive = .{},
    fd: bun.FileDescriptor = bun.invalid_fd,
    concurrent: Concurrent = .{},
    loop: *JSC.EventLoop,
    seekable: bool = false,
    auto_close: bool = false,
    remaining_bytes: Blob.SizeType = std.math.maxInt(Blob.SizeType),
    user_chunk_size: Blob.SizeType = 0,
    total_read: Blob.SizeType = 0,
    mode: bun.Mode = 0,
    pending: StreamResult.Pending = .{},
    scheduled_count: u32 = 0,

    pub fn close(this: *File) void {
        if (this.auto_close) {
            this.auto_close = false;
            const fd = this.fd;
            if (fd != bun.invalid_fd) {
                this.fd = bun.invalid_fd;
                _ = Syscall.close(fd);
            }
        }

        this.poll_ref.disable();

        this.view.clear();
        this.buf.len = 0;

        this.pending.result = .{ .done = {} };
        this.pending.run();
    }

    pub fn deinit(this: *File) void {
        this.close();
    }

    pub fn isClosed(this: *const File) bool {
        return this.fd == bun.invalid_fd;
    }

    fn calculateChunkSize(this: *File, available_to_read: usize) usize {
        const chunk_size: usize = switch (this.user_chunk_size) {
            0 => if (this.isSeekable())
                default_file_chunk_size
            else
                default_fifo_chunk_size,
            else => |size| size,
        };

        return if (available_to_read == std.math.maxInt(usize) and this.remaining_bytes > 0 and this.isSeekable())
            @min(chunk_size, this.remaining_bytes -| this.total_read)
        else
            @min(chunk_size, available_to_read);
    }

    pub fn start(
        this: *File,
        file: *Blob.FileStore,
    ) StreamStart {
        var file_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

        var fd = if (file.pathlike != .path)
            // We will always need to close the file descriptor.
            switch (Syscall.dup(file.pathlike.fd)) {
                .result => |_fd| _fd,
                .err => |err| {
                    return .{ .err = err.withFd(file.pathlike.fd) };
                },
            }
        else switch (Syscall.open(file.pathlike.path.sliceZ(&file_buf), std.os.O.RDONLY | std.os.O.NONBLOCK | std.os.O.CLOEXEC, 0)) {
            .result => |_fd| _fd,
            .err => |err| {
                return .{ .err = err.withPath(file.pathlike.path.slice()) };
            },
        };

        if (comptime Environment.isPosix) {
            if ((file.is_atty orelse false) or (fd.int() < 3 and std.os.isatty(fd.cast()))) {
                var termios = std.mem.zeroes(std.os.termios);
                _ = std.c.tcgetattr(fd.cast(), &termios);
                bun.C.cfmakeraw(&termios);
                file.is_atty = true;
            }
        }

        if (file.pathlike != .path and !(file.is_atty orelse false)) {
            if (comptime Environment.isWindows) {
                @panic("TODO on Windows");
            }

            // ensure we have non-blocking IO set
            switch (Syscall.fcntl(fd, std.os.F.GETFL, 0)) {
                .err => return .{ .err = Syscall.Error.fromCode(E.BADF, .fcntl) },
                .result => |flags| {
                    // if we do not, clone the descriptor and set non-blocking
                    // it is important for us to clone it so we don't cause Weird Things to happen
                    if ((flags & std.os.O.NONBLOCK) == 0) {
                        fd = switch (Syscall.fcntl(fd, std.os.F.DUPFD, 0)) {
                            .result => |_fd| bun.toFD(_fd),
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
        var size: Blob.SizeType = 0;
        if (comptime Environment.isPosix) {
            const stat: bun.Stat = switch (Syscall.fstat(fd)) {
                .result => |result| result,
                .err => |err| {
                    _ = Syscall.close(fd);
                    return .{ .err = err };
                },
            };

            if (bun.S.ISDIR(stat.mode)) {
                _ = Syscall.close(fd);
                return .{ .err = Syscall.Error.fromCode(.ISDIR, .fstat) };
            }

            file.mode = @as(bun.Mode, @intCast(stat.mode));
            this.mode = file.mode;

            this.seekable = bun.isRegularFile(stat.mode);
            file.seekable = this.seekable;
            size = @intCast(stat.size);
        } else if (comptime Environment.isWindows) outer: {
            size = @intCast(fd.asFile().getEndPos() catch {
                this.seekable = false;
                break :outer;
            });
            this.seekable = true;
        } else {
            @compileError("Not Implemented");
        }

        if (this.seekable) {
            this.remaining_bytes = size;
            file.max_size = this.remaining_bytes;

            if (this.remaining_bytes == 0) {
                _ = Syscall.close(fd);

                return .{ .empty = {} };
            }
        } else {
            file.max_size = Blob.max_size;
        }

        this.fd = fd;

        return StreamStart{ .ready = {} };
    }

    pub fn isSeekable(this: File) bool {
        return this.seekable;
    }

    const Concurrent = struct {
        read: Blob.SizeType = 0,
        task: bun.ThreadPool.Task = .{ .callback = Concurrent.taskCallback },
        chunk_size: Blob.SizeType = 0,
        main_thread_task: JSC.AnyTask = .{ .callback = onJSThread, .ctx = null },
        concurrent_task: JSC.ConcurrentTask = .{},

        pub fn taskCallback(task: *bun.ThreadPool.Task) void {
            runAsync(@fieldParentPtr(File, "concurrent", @fieldParentPtr(Concurrent, "task", task)));
        }

        pub fn scheduleRead(this: *File) void {
            var remaining = this.buf[this.concurrent.read..];

            while (remaining.len > 0) {
                const to_read = @min(@as(usize, this.concurrent.chunk_size), remaining.len);
                switch (Syscall.read(this.fd, remaining[0..to_read])) {
                    .err => |err| {
                        const retry = E.AGAIN;

                        switch (err.getErrno()) {
                            retry => break,
                            else => {},
                        }

                        this.pending.result = .{ .err = .{ .Error = err } };
                        scheduleMainThreadTask(this);
                        return;
                    },
                    .result => |result| {
                        this.concurrent.read += @as(Blob.SizeType, @intCast(result));
                        remaining = remaining[result..];

                        if (result == 0) {
                            remaining.len = 0;
                            break;
                        }
                    },
                }
            }

            scheduleMainThreadTask(this);
        }

        pub fn onJSThread(task_ctx: *anyopaque) void {
            var this: *File = bun.cast(*File, task_ctx);
            const view = this.view.get().?;
            defer this.view.clear();

            if (this.isClosed()) {
                this.deinit();

                return;
            }

            if (this.concurrent.read == 0) {
                this.pending.result = .{ .done = {} };
            } else if (view != .zero) {
                this.pending.result = .{
                    .into_array = .{
                        .value = view,
                        .len = @as(Blob.SizeType, @truncate(this.concurrent.read)),
                    },
                };
            } else {
                this.pending.result = .{
                    .owned = bun.ByteList.init(this.buf),
                };
            }

            this.pending.run();
        }

        pub fn scheduleMainThreadTask(this: *File) void {
            this.concurrent.main_thread_task.ctx = this;
            this.loop.enqueueTaskConcurrent(this.concurrent.concurrent_task.from(&this.concurrent.main_thread_task, .manual_deinit));
        }

        fn runAsync(this: *File) void {
            this.concurrent.read = 0;

            Concurrent.scheduleRead(this);
        }
    };

    pub fn scheduleAsync(
        this: *File,
        chunk_size: Blob.SizeType,
        globalThis: *JSC.JSGlobalObject,
    ) void {
        this.scheduled_count += 1;
        this.poll_ref.ref(globalThis.bunVM());
        this.concurrent.chunk_size = chunk_size;
        JSC.WorkPool.schedule(&this.concurrent.task);
    }

    pub fn read(this: *File, buf: []u8) ReadResult {
        if (this.fd == bun.invalid_fd)
            return .{ .done = {} };

        if (this.seekable and this.remaining_bytes == 0)
            return .{ .done = {} };

        return this.doRead(buf);
    }

    pub fn readFromJS(this: *File, buf: []u8, view: JSValue, globalThis: *JSC.JSGlobalObject) StreamResult {
        const read_result = this.read(buf);

        switch (read_result) {
            .read => |slice| if (slice.len == 0) {
                this.close();
                return .{ .done = {} };
            },
            .pending => {
                if (this.scheduled_count == 0) {
                    this.buf = buf;
                    this.view.set(globalThis, view);
                    this.scheduleAsync(@as(Blob.SizeType, @truncate(buf.len)), globalThis);
                }
                return .{ .pending = &this.pending };
            },
            else => {},
        }

        return read_result.toStream(&this.pending, buf, view, false);
    }

    pub fn doRead(this: *File, buf: []u8) ReadResult {
        switch (Syscall.read(this.fd, buf)) {
            .err => |err| {
                const retry = bun.C.E.AGAIN;
                const errno = err.getErrno();

                switch (errno) {
                    retry => {
                        return .{ .pending = {} };
                    },
                    else => {
                        return .{ .err = err };
                    },
                }
            },
            .result => |result| {
                this.remaining_bytes -|= @as(@TypeOf(this.remaining_bytes), @truncate(result));

                if (result == 0) {
                    return .{ .done = {} };
                }

                return .{ .read = buf[0..result] };
            },
        }
    }
};

// macOS default pipe size is page_size, 16k, or 64k. It changes based on how much was written
// Linux default pipe size is 16 pages of memory
const default_fifo_chunk_size = 64 * 1024;
const default_file_chunk_size = 1024 * 1024 * 2;

/// **Not** the Web "FileReader" API
pub const FileReader = struct {
    buffered_data: bun.ByteList = .{},

    total_read: Blob.SizeType = 0,
    max_read: Blob.SizeType = 0,

    cancelled: bool = false,
    started: bool = false,
    stored_global_this_: ?*JSC.JSGlobalObject = null,
    user_chunk_size: Blob.SizeType = 0,
    lazy_readable: Readable.Lazy = undefined,

    pub fn parent(this: *@This()) *Source {
        return @fieldParentPtr(Source, "context", this);
    }

    pub fn setSignal(this: *FileReader, signal: Signal) void {
        switch (this.lazy_readable) {
            .readable => {
                if (this.lazy_readable.readable == .FIFO)
                    this.lazy_readable.readable.FIFO.signal = signal;
            },
            else => {},
        }
    }

    pub fn readable(this: *FileReader) *Readable {
        return &this.lazy_readable.readable;
    }

    pub const Readable = union(enum) {
        FIFO: FIFO,
        File: File,

        pub const Lazy = union(enum) {
            readable: Readable,
            blob: *Blob.Store,
            empty: void,

            pub fn onDrain(this: *Lazy) void {
                if (this.* == .readable) {
                    if (this.readable == .FIFO) {
                        this.readable.FIFO.drained = true;
                    }
                }
            }

            pub fn finish(this: *Lazy) void {
                switch (this.readable) {
                    .FIFO => {
                        this.readable.FIFO.finish();
                    },
                    .File => {},
                }
            }

            pub fn isClosed(this: *Lazy) bool {
                switch (this.*) {
                    .empty, .blob => {
                        return true;
                    },
                    .readable => {
                        return this.readable.isClosed();
                    },
                }
            }

            pub fn deinit(this: *Lazy) void {
                switch (this.*) {
                    .blob => |blob| {
                        blob.deref();
                    },
                    .readable => {
                        this.readable.deinit();
                    },
                    .empty => {},
                }
                this.* = .{ .empty = {} };
            }
        };

        pub fn toBlob(this: *Readable) Blob {
            if (this.isClosed()) return Blob.initEmpty(JSC.VirtualMachine.get().global);
        }

        pub fn deinit(this: *Readable) void {
            switch (this.*) {
                .FIFO => {
                    this.FIFO.close();
                },
                .File => {
                    this.File.deinit();
                },
            }
        }

        pub fn isClosed(this: *Readable) bool {
            switch (this.*) {
                .FIFO => {
                    return this.FIFO.isClosed();
                },
                .File => {
                    return this.File.isClosed();
                },
            }
        }

        pub fn close(this: *Readable) void {
            switch (this.*) {
                .FIFO => {
                    this.FIFO.close();
                },
                .File => {
                    if (this.File.concurrent) |concurrent| {
                        this.File.concurrent = null;
                        concurrent.close();
                    }

                    this.File.close();
                },
            }
        }

        pub fn read(
            this: *Readable,
            read_buf: []u8,
            view: JSC.JSValue,
            global: *JSC.JSGlobalObject,
        ) StreamResult {
            return switch (std.meta.activeTag(this.*)) {
                .FIFO => this.FIFO.readFromJS(read_buf, view, global),
                .File => this.File.readFromJS(read_buf, view, global),
            };
        }

        pub fn isSeekable(this: Readable) bool {
            if (this == .File) {
                return this.File.isSeekable();
            }

            return false;
        }

        pub fn watch(this: *Readable) void {
            switch (this.*) {
                .FIFO => {
                    if (!this.FIFO.isWatching())
                        this.FIFO.watch(this.FIFO.fd);
                },
            }
        }
    };

    pub inline fn globalThis(this: *FileReader) *JSC.JSGlobalObject {
        return this.stored_global_this_ orelse @fieldParentPtr(Source, "context", this).globalThis;
    }

    const run_on_different_thread_size = bun.huge_allocator_threshold;

    pub const tag = ReadableStream.Tag.File;

    pub fn fromReadable(this: *FileReader, chunk_size: Blob.SizeType, readable_: *Readable) void {
        this.* = .{
            .lazy_readable = .{
                .readable = readable_.*,
            },
        };
        this.user_chunk_size = chunk_size;
    }

    pub fn finish(this: *FileReader) void {
        this.lazy_readable.finish();
    }

    pub fn onStart(this: *FileReader) StreamStart {
        if (!this.started) {
            this.started = true;

            switch (this.lazy_readable) {
                .blob => |blob| {
                    defer blob.deref();
                    var readable_file = File{ .loop = this.globalThis().bunVM().eventLoop() };

                    const result = readable_file.start(&blob.data.file);
                    if (result == .empty) {
                        this.lazy_readable = .{ .empty = {} };
                        return result;
                    }
                    if (result != .ready) {
                        return result;
                    }

                    const is_fifo = bun.S.ISFIFO(readable_file.mode) or bun.S.ISCHR(readable_file.mode);

                    // for our purposes, ISCHR and ISFIFO are the same
                    if (is_fifo) {
                        this.lazy_readable = .{
                            .readable = .{
                                .FIFO = .{
                                    .fd = readable_file.fd,
                                    .drained = this.buffered_data.len == 0,
                                },
                            },
                        };
                        this.lazy_readable.readable.FIFO.watch(readable_file.fd);
                        this.lazy_readable.readable.FIFO.pollRef().enableKeepingProcessAlive(this.globalThis().bunVM());
                        if (!(blob.data.file.is_atty orelse false)) {
                            this.lazy_readable.readable.FIFO.poll_ref.?.flags.insert(.nonblocking);
                        }
                    } else {
                        this.lazy_readable = .{
                            .readable = .{ .File = readable_file },
                        };
                    }
                },
                .readable => {},
                .empty => return .{ .empty = {} },
            }
        } else if (this.lazy_readable == .empty)
            return .{ .empty = {} };

        if (this.readable().* == .File) {
            const chunk_size = this.readable().File.calculateChunkSize(std.math.maxInt(usize));
            return .{ .chunk_size = @as(Blob.SizeType, @truncate(chunk_size)) };
        }

        return .{ .chunk_size = if (this.user_chunk_size == 0) default_fifo_chunk_size else this.user_chunk_size };
    }

    pub fn onPullInto(this: *FileReader, buffer: []u8, view: JSC.JSValue) StreamResult {
        std.debug.assert(this.started);

        // this state isn't really supposed to happen
        // but we handle it just in-case
        if (this.lazy_readable == .empty) {
            if (this.buffered_data.len == 0) {
                return .{ .done = {} };
            }

            return .{ .owned_and_done = this.drainInternalBuffer() };
        }

        return this.readable().read(buffer, view, this.globalThis());
    }

    fn isFIFO(this: *const FileReader) bool {
        if (this.lazy_readable == .readable) {
            return this.lazy_readable.readable == .FIFO;
        }

        return false;
    }

    pub fn finalize(this: *FileReader) void {
        this.lazy_readable.deinit();
    }

    pub fn onCancel(this: *FileReader) void {
        this.cancelled = true;
        this.deinit();
    }

    pub fn deinit(this: *FileReader) void {
        this.finalize();
        if (this.lazy_readable.isClosed()) {
            this.destroy();
        }
    }

    pub fn destroy(this: *FileReader) void {
        bun.default_allocator.destroy(this);
    }

    pub fn setRefOrUnref(this: *FileReader, value: bool) void {
        if (this.lazy_readable == .readable) {
            switch (this.lazy_readable.readable) {
                .FIFO => {
                    if (this.lazy_readable.readable.FIFO.poll_ref) |poll| {
                        if (value) {
                            poll.ref(this.globalThis().bunVM());
                        } else {
                            poll.unref(this.globalThis().bunVM());
                        }
                    }
                },
                .File => {
                    if (value)
                        this.lazy_readable.readable.File.poll_ref.ref(JSC.VirtualMachine.get())
                    else
                        this.lazy_readable.readable.File.poll_ref.unref(JSC.VirtualMachine.get());
                },
            }
        }
    }

    pub const setRef = setRefOrUnref;

    pub fn drainInternalBuffer(this: *FileReader) bun.ByteList {
        const buffered = this.buffered_data;
        this.lazy_readable.onDrain();
        if (buffered.cap > 0) {
            this.buffered_data = .{};
        }

        return buffered;
    }

    pub const Source = ReadableStreamSource(
        @This(),
        "FileReader",
        onStart,
        onPullInto,
        onCancel,
        deinit,
        setRefOrUnref,
        drainInternalBuffer,
    );
};

pub fn NewReadyWatcher(
    comptime Context: type,
    comptime flag_: Async.FilePoll.Flags,
    comptime onReady: anytype,
) type {
    return struct {
        const flag = flag_;
        const ready = onReady;

        const Watcher = @This();

        pub inline fn isFIFO(this: *const Context) bool {
            if (comptime @hasField(Context, "is_fifo")) {
                return this.is_fifo;
            }

            if (this.poll_ref) |_poll_ref| {
                return _poll_ref.flags.contains(.fifo);
            }

            if (comptime @hasField(Context, "mode")) {
                return bun.S.ISFIFO(this.mode);
            }

            return false;
        }

        pub fn onPoll(this: *Context, sizeOrOffset: i64, _: u16) void {
            defer JSC.VirtualMachine.get().drainMicrotasks();
            ready(this, sizeOrOffset);
        }

        pub fn unwatch(this: *Context, fd_: anytype) void {
            if (comptime Environment.isWindows) {
                @panic("TODO on Windows");
            }

            std.debug.assert(this.poll_ref.?.fd == fd_);
            std.debug.assert(
                this.poll_ref.?.unregister(JSC.VirtualMachine.get().event_loop_handle.?, false) == .result,
            );
            this.poll_ref.?.disableKeepingProcessAlive(JSC.VirtualMachine.get());
        }

        pub fn pollRef(this: *Context) *Async.FilePoll {
            return this.poll_ref orelse brk: {
                this.poll_ref = Async.FilePoll.init(
                    JSC.VirtualMachine.get(),
                    this.fd,
                    .{},
                    Context,
                    this,
                );
                break :brk this.poll_ref.?;
            };
        }

        pub fn isWatching(this: *const Context) bool {
            if (this.poll_ref) |poll| {
                return poll.flags.contains(flag.poll()) and !poll.flags.contains(.needs_rearm);
            }

            return false;
        }

        pub fn watch(this: *Context, fd: bun.FileDescriptor) void {
            if (comptime Environment.isWindows) {
                @panic("Do not call watch() on windows");
            }
            var poll_ref: *Async.FilePoll = this.poll_ref orelse brk: {
                this.poll_ref = Async.FilePoll.init(
                    JSC.VirtualMachine.get(),
                    fd,
                    .{},
                    Context,
                    this,
                );
                break :brk this.poll_ref.?;
            };
            std.debug.assert(poll_ref.fd == fd);
            std.debug.assert(!this.isWatching());
            switch (poll_ref.register(JSC.VirtualMachine.get().event_loop_handle.?, flag, true)) {
                .err => |err| {
                    std.debug.panic("FilePoll.register failed: {d}", .{err.errno});
                },
                .result => {},
            }
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
