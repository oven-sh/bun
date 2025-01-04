const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const bun = @import("root").bun;
const MimeType = HTTPClient.MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = bun.http;
const JSC = bun.JSC;
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;
const FetchHeaders = JSC.FetchHeaders;
const ObjectPool = @import("../../pool.zig").ObjectPool;
const SystemError = JSC.SystemError;
const Output = bun.Output;
const MutableString = bun.MutableString;
const strings = bun.strings;
const string = bun.string;
const default_allocator = bun.default_allocator;
const FeatureFlags = bun.FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const Async = bun.Async;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;

const Environment = @import("../../env.zig");
const ZigString = JSC.ZigString;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const E = bun.C.E;
const VirtualMachine = JSC.VirtualMachine;
const Task = JSC.Task;
const JSPrinter = bun.js_printer;
const picohttp = bun.picohttp;
const StringJoiner = bun.StringJoiner;
const uws = bun.uws;
const Blob = JSC.WebCore.Blob;
const Response = JSC.WebCore.Response;
const Request = JSC.WebCore.Request;
const assert = bun.assert;
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

        pub fn has(this: *Strong) bool {
            return this.held.has();
        }

        pub fn isDisturbed(this: *const Strong, global: *JSC.JSGlobalObject) bool {
            if (this.get()) |stream| {
                return stream.isDisturbed(global);
            }

            return false;
        }

        pub fn init(this: ReadableStream, global: *JSGlobalObject) Strong {
            return .{
                .held = JSC.Strong.create(this.value, global),
            };
        }

        pub fn get(this: *const Strong) ?ReadableStream {
            if (this.held.get()) |value| {
                return ReadableStream.fromJS(value, this.held.globalThis.?);
            }
            return null;
        }

        pub fn deinit(this: *Strong) void {
            // if (this.held.get()) |val| {
            //     ReadableStream__detach(val, this.held.globalThis.?);
            // }
            this.held.deinit();
        }

        pub fn tee(this: *Strong, global: *JSGlobalObject) ?ReadableStream {
            if (this.get()) |stream| {
                const first, const second = stream.tee(global) orelse return null;
                this.held.set(global, first.value);
                return second;
            }
            return null;
        }
    };

    extern fn ReadableStream__tee(stream: JSValue, globalThis: *JSGlobalObject, out1: *JSC.JSValue, out2: *JSC.JSValue) bool;
    pub fn tee(this: *const ReadableStream, globalThis: *JSGlobalObject) ?struct { ReadableStream, ReadableStream } {
        var out1: JSC.JSValue = .zero;
        var out2: JSC.JSValue = .zero;
        if (!ReadableStream__tee(this.value, globalThis, &out1, &out2)) {
            return null;
        }
        const out_stream2 = ReadableStream.fromJS(out2, globalThis) orelse return null;
        const out_stream1 = ReadableStream.fromJS(out1, globalThis) orelse return null;
        return .{ out_stream1, out_stream2 };
    }

    pub fn toJS(this: *const ReadableStream) JSValue {
        return this.value;
    }

    pub fn reloadTag(this: *ReadableStream, globalThis: *JSC.JSGlobalObject) void {
        if (ReadableStream.fromJS(this.value, globalThis)) |stream| {
            this.* = stream;
        } else {
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
                if (blobby.toAnyBlob(globalThis)) |blob| {
                    stream.done(globalThis);
                    return blob;
                }
            },
            .File => |blobby| {
                if (blobby.lazy == .blob) {
                    var blob = JSC.WebCore.Blob.initWithStore(blobby.lazy.blob, globalThis);
                    blob.store.?.ref();
                    // it should be lazy, file shouldn't have opened yet.
                    bun.assert(!blobby.started);
                    stream.done(globalThis);
                    return AnyBlob{ .Blob = blob };
                }
            },
            .Bytes => |bytes| {

                // If we've received the complete body by the time this function is called
                // we can avoid streaming it and convert it to a Blob
                if (bytes.toAnyBlob()) |blob| {
                    stream.done(globalThis);
                    return blob;
                }

                return null;
            },
            else => {},
        }

        return null;
    }

    pub fn done(this: *const ReadableStream, globalThis: *JSGlobalObject) void {
        JSC.markBinding(@src());
        // done is called when we are done consuming the stream
        // cancel actually mark the stream source as done
        // this will resolve any pending promises to done: true
        switch (this.ptr) {
            .Blob => |source| {
                source.parent().cancel();
            },
            .File => |source| {
                source.parent().cancel();
            },
            .Bytes => |source| {
                source.parent().cancel();
            },
            else => {},
        }
        this.detachIfPossible(globalThis);
    }

    pub fn cancel(this: *const ReadableStream, globalThis: *JSGlobalObject) void {
        JSC.markBinding(@src());
        // cancel the stream
        ReadableStream__cancel(this.value, globalThis);
        // mark the stream source as done
        this.done(globalThis);
    }

    pub fn abort(this: *const ReadableStream, globalThis: *JSGlobalObject) void {
        JSC.markBinding(@src());
        // for now we are just calling cancel should be fine
        this.cancel(globalThis);
    }

    pub fn forceDetach(this: *const ReadableStream, globalObject: *JSGlobalObject) void {
        ReadableStream__detach(this.value, globalObject);
    }

    /// Decrement Source ref count and detach the underlying stream if ref count is zero
    /// be careful, this can invalidate the stream do not call this multiple times
    /// this is meant to be called only once when we are done consuming the stream or from the ReadableStream.Strong.deinit
    pub fn detachIfPossible(_: *const ReadableStream, _: *JSGlobalObject) void {
        JSC.markBinding(@src());
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

    extern fn ReadableStreamTag__tagged(globalObject: *JSGlobalObject, possibleReadableStream: *JSValue, ptr: *?*anyopaque) Tag;
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
        return isDisturbedValue(this.value, globalObject);
    }

    pub fn isDisturbedValue(value: JSC.JSValue, globalObject: *JSGlobalObject) bool {
        JSC.markBinding(@src());
        return ReadableStream__isDisturbed(value, globalObject);
    }

    pub fn isLocked(this: *const ReadableStream, globalObject: *JSGlobalObject) bool {
        JSC.markBinding(@src());
        return ReadableStream__isLocked(this.value, globalObject);
    }

    pub fn fromJS(value: JSValue, globalThis: *JSGlobalObject) ?ReadableStream {
        JSC.markBinding(@src());
        value.ensureStillAlive();
        var out = value;

        var ptr: ?*anyopaque = null;
        return switch (ReadableStreamTag__tagged(globalThis, &out, &ptr)) {
            .JavaScript => ReadableStream{
                .value = out,
                .ptr = .{
                    .JavaScript = {},
                },
            },
            .Blob => ReadableStream{
                .value = out,
                .ptr = .{
                    .Blob = @ptrCast(@alignCast(ptr.?)),
                },
            },
            .File => ReadableStream{
                .value = out,
                .ptr = .{
                    .File = @ptrCast(@alignCast(ptr.?)),
                },
            },

            .Bytes => ReadableStream{
                .value = out,
                .ptr = .{
                    .Bytes = @ptrCast(@alignCast(ptr.?)),
                },
            },

            // .HTTPRequest => ReadableStream{
            //     .value = out,
            //     .ptr = .{
            //         .HTTPRequest = ptr.asPtr(HTTPRequest),
            //     },
            // },
            // .HTTPSRequest => ReadableStream{
            //     .value = out,
            //     .ptr = .{
            //         .HTTPSRequest = ptr.asPtr(HTTPSRequest),
            //     },
            // },
            else => null,
        };
    }

    extern fn ZigGlobalObject__createNativeReadableStream(*JSGlobalObject, nativePtr: JSValue) JSValue;

    pub fn fromNative(globalThis: *JSGlobalObject, native: JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        return ZigGlobalObject__createNativeReadableStream(globalThis, native);
    }

    pub fn fromBlob(globalThis: *JSGlobalObject, blob: *const Blob, recommended_chunk_size: Blob.SizeType) JSC.JSValue {
        JSC.markBinding(@src());
        var store = blob.store orelse {
            return ReadableStream.empty(globalThis);
        };
        switch (store.data) {
            .bytes => {
                var reader = ByteBlobLoader.Source.new(
                    .{
                        .globalThis = globalThis,
                        .context = undefined,
                    },
                );
                reader.context.setup(blob, recommended_chunk_size);
                return reader.toReadableStream(globalThis);
            },
            .file => {
                var reader = FileReader.Source.new(.{
                    .globalThis = globalThis,
                    .context = .{
                        .event_loop = JSC.EventLoopHandle.init(globalThis.bunVM().eventLoop()),
                        .start_offset = blob.offset,
                        .max_size = if (blob.size != Blob.max_size) blob.size else null,

                        .lazy = .{
                            .blob = store,
                        },
                    },
                });
                store.ref();

                return reader.toReadableStream(globalThis);
            },
            .s3 => |*s3| {
                const credentials = s3.getCredentials();
                const path = s3.path();
                const proxy = globalThis.bunVM().transpiler.env.getHttpProxy(true, null);
                const proxy_url = if (proxy) |p| p.href else null;

                return bun.S3.readableStream(credentials, path, blob.offset, if (blob.size != Blob.max_size) blob.size else null, proxy_url, globalThis);
            },
        }
    }

    pub fn fromFileBlobWithOffset(
        globalThis: *JSGlobalObject,
        blob: *const Blob,
        offset: usize,
    ) bun.JSError!JSC.JSValue {
        JSC.markBinding(@src());
        var store = blob.store orelse {
            return ReadableStream.empty(globalThis);
        };
        switch (store.data) {
            .file => {
                var reader = FileReader.Source.new(.{
                    .globalThis = globalThis,
                    .context = .{
                        .event_loop = JSC.EventLoopHandle.init(globalThis.bunVM().eventLoop()),
                        .start_offset = offset,
                        .lazy = .{
                            .blob = store,
                        },
                    },
                });
                store.ref();

                return reader.toReadableStream(globalThis);
            },
            else => {
                return globalThis.throw("Expected FileBlob", .{});
            },
        }
    }

    pub fn fromPipe(
        globalThis: *JSGlobalObject,
        parent: anytype,
        buffered_reader: anytype,
    ) JSC.JSValue {
        _ = parent; // autofix
        JSC.markBinding(@src());
        var source = FileReader.Source.new(.{
            .globalThis = globalThis,
            .context = .{
                .event_loop = JSC.EventLoopHandle.init(globalThis.bunVM().eventLoop()),
            },
        });
        source.context.reader.from(buffered_reader, &source.context);

        return source.toReadableStream(globalThis);
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
    FileSink: FileSinkOptions,
    HTTPSResponseSink: void,
    HTTPResponseSink: void,
    NetworkSink: void,
    ready: void,
    owned_and_done: bun.ByteList,
    done: bun.ByteList,

    pub const FileSinkOptions = struct {
        chunk_size: Blob.SizeType = 1024,
        input_path: PathOrFileDescriptor,
        truncate: bool = true,
        close: bool = false,
        mode: bun.Mode = 0o664,

        pub fn flags(this: *const FileSinkOptions) bun.Mode {
            _ = this;

            return bun.O.NONBLOCK | bun.O.CLOEXEC | bun.O.CREAT | bun.O.WRONLY;
        }
    };

    pub const Tag = enum {
        empty,
        err,
        chunk_size,
        ArrayBufferSink,
        FileSink,
        HTTPSResponseSink,
        HTTPResponseSink,
        NetworkSink,
        ready,
        owned_and_done,
        done,
    };

    pub fn toJS(this: StreamStart, globalThis: *JSGlobalObject) JSC.JSValue {
        switch (this) {
            .empty, .ready => {
                return .undefined;
            },
            .chunk_size => |chunk| {
                return JSC.JSValue.jsNumber(@as(Blob.SizeType, @intCast(chunk)));
            },
            .err => |err| {
                return globalThis.throwValue(err.toJSC(globalThis)) catch .zero;
            },
            .owned_and_done => |list| {
                return JSC.ArrayBuffer.fromBytes(list.slice(), .Uint8Array).toJS(globalThis, null);
            },
            .done => |list| {
                return JSC.ArrayBuffer.create(globalThis, list.slice(), .Uint8Array);
            },
            else => {
                return .undefined;
            },
        }
    }

    pub fn fromJS(globalThis: *JSGlobalObject, value: JSValue) bun.JSError!StreamStart {
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
    ) bun.JSError!StreamStart {
        if (value.isEmptyOrUndefinedOrNull() or !value.isObject()) {
            return .{ .empty = {} };
        }

        switch (comptime tag) {
            .ArrayBufferSink => {
                var as_uint8array = false;
                var stream = false;
                var chunk_size: JSC.WebCore.Blob.SizeType = 0;
                var empty = true;

                if (value.getOwn(globalThis, "asUint8Array")) |val| {
                    if (val.isBoolean()) {
                        as_uint8array = val.toBoolean();
                        empty = false;
                    }
                }

                if (value.fastGet(globalThis, .stream)) |val| {
                    if (val.isBoolean()) {
                        stream = val.toBoolean();
                        empty = false;
                    }
                }

                if (value.fastGet(globalThis, .highWaterMark)) |chunkSize| {
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

                if (value.fastGet(globalThis, .highWaterMark)) |chunkSize| {
                    if (chunkSize.isNumber())
                        chunk_size = @as(JSC.WebCore.Blob.SizeType, @intCast(@max(0, @as(i51, @truncate(chunkSize.toInt64())))));
                }

                if (value.fastGet(globalThis, .path)) |path| {
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
                } else if (try value.getTruthy(globalThis, "fd")) |fd_value| {
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
            .NetworkSink, .HTTPSResponseSink, .HTTPResponseSink => {
                var empty = true;
                var chunk_size: JSC.WebCore.Blob.SizeType = 2048;

                if (value.fastGet(globalThis, .highWaterMark)) |chunkSize| {
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
    err: StreamError,
    done: void,
    owned: bun.ByteList,
    owned_and_done: bun.ByteList,
    temporary_and_done: bun.ByteList,
    temporary: bun.ByteList,
    into_array: IntoArray,
    into_array_and_done: IntoArray,

    pub fn deinit(this: *StreamResult) void {
        switch (this.*) {
            .owned => |*owned| owned.deinitWithAllocator(bun.default_allocator),
            .owned_and_done => |*owned_and_done| owned_and_done.deinitWithAllocator(bun.default_allocator),
            .err => |err| {
                if (err == .JSValue) {
                    err.JSValue.unprotect();
                }
            },
            else => {},
        }
    }

    pub const StreamError = union(enum) {
        Error: Syscall.Error,
        AbortReason: JSC.CommonAbortReason,

        // TODO: use an explicit JSC.Strong here.
        JSValue: JSC.JSValue,
        WeakJSValue: JSC.JSValue,

        const WasStrong = enum {
            Strong,
            Weak,
        };

        pub fn toJSWeak(this: *const @This(), globalObject: *JSC.JSGlobalObject) struct { JSC.JSValue, WasStrong } {
            return switch (this.*) {
                .Error => |err| {
                    return .{ err.toJSC(globalObject), WasStrong.Weak };
                },
                .JSValue => .{ this.JSValue, WasStrong.Strong },
                .WeakJSValue => .{ this.WeakJSValue, WasStrong.Weak },
                .AbortReason => |reason| {
                    const value = reason.toJS(globalObject);
                    return .{ value, WasStrong.Weak };
                },
            };
        }
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

    pub fn slice16(this: *const StreamResult) []const u16 {
        const bytes = this.slice();
        return @as([*]const u16, @ptrCast(@alignCast(bytes.ptr)))[0..std.mem.bytesAsSlice(u16, bytes).len];
    }

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
            future: Future = .{ .none = {} },
            result: Writable,
            consumed: Blob.SizeType = 0,
            state: StreamResult.Pending.State = .none,

            pub fn deinit(this: *@This()) void {
                this.future.deinit();
            }

            pub const Future = union(enum) {
                none: void,
                promise: JSC.JSPromise.Strong,
                handler: Handler,

                pub fn deinit(this: *@This()) void {
                    if (this.* == .promise) {
                        this.promise.deinit();
                        this.* = .{ .none = {} };
                    }
                }
            };

            pub fn promise(this: *Writable.Pending, globalThis: *JSC.JSGlobalObject) *JSPromise {
                this.state = .pending;

                switch (this.future) {
                    .promise => |p| {
                        return p.get();
                    },
                    else => {
                        this.future = .{
                            .promise = JSC.JSPromise.Strong.init(globalThis),
                        };

                        return this.future.promise.get();
                    },
                }
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
                            @call(bun.callmod_inline, handler, .{ bun.cast(*Context, ctx_), result });
                        }
                    }.onHandle;
                }
            };

            pub fn run(this: *Writable.Pending) void {
                if (this.state != .pending) return;
                this.state = .used;
                switch (this.future) {
                    .promise => {
                        var p = this.future.promise;
                        this.future = .none;
                        Writable.fulfillPromise(this.result, p.swap(), p.strong.globalThis.?);
                    },
                    .handler => |h| {
                        h.handler(h.ctx, this.result);
                    },
                    .none => {},
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
            defer promise.asValue(globalThis).unprotect();
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

                .pending => |pending| pending.promise(globalThis).asValue(globalThis),
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
                        @call(bun.callmod_inline, handler, .{ bun.cast(*Context, ctx_), result });
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
                    StreamResult.fulfillPromise(&this.result, p.promise, p.globalThis);
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

    pub fn fulfillPromise(result: *StreamResult, promise: *JSC.JSPromise, globalThis: *JSC.JSGlobalObject) void {
        const vm = globalThis.bunVM();
        const loop = vm.eventLoop();
        const promise_value = promise.asValue(globalThis);
        defer promise_value.unprotect();

        loop.enter();
        defer loop.exit();

        switch (result.*) {
            .err => |*err| {
                const value = brk: {
                    const js_err, const was_strong = err.toJSWeak(globalThis);
                    js_err.ensureStillAlive();
                    if (was_strong == .Strong)
                        js_err.unprotect();

                    break :brk js_err;
                };
                result.* = .{ .temporary = .{} };
                promise.reject(globalThis, value);
            },
            .done => {
                promise.resolve(globalThis, JSValue.jsBoolean(false));
            },
            else => {
                const value = result.toJS(globalThis);
                value.ensureStillAlive();

                result.* = .{ .temporary = .{} };
                promise.resolve(globalThis, value);
            },
        }
    }

    pub fn toJS(this: *const StreamResult, globalThis: *JSGlobalObject) JSValue {
        if (JSC.VirtualMachine.get().isShuttingDown()) {
            var that = this.*;
            that.deinit();
            return .zero;
        }

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
                const js_err, const was_strong = err.toJSWeak(globalThis);
                if (was_strong == .Strong) {
                    js_err.unprotect();
                }
                js_err.ensureStillAlive();
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
    ptr: ?*anyopaque = null,
    vtable: ?*const VTable = null,

    pub fn clear(this: *Signal) void {
        this.ptr = null;
    }

    pub fn isDead(this: Signal) bool {
        return this.ptr == null;
    }

    pub fn initWithType(comptime Type: type, handler: *Type) Signal {
        // this is nullable when used as a JSValue
        @setRuntimeSafety(false);
        return .{
            .ptr = handler,
            .vtable = comptime &VTable.wrap(Type),
        };
    }

    pub fn init(handler: anytype) Signal {
        return initWithType(std.meta.Child(@TypeOf(handler)), handler);
    }

    pub fn close(this: *Signal, err: ?Syscall.Error) void {
        if (this.isDead())
            return;
        this.vtable.?.close(this.ptr.?, err);
    }

    pub fn ready(this: *Signal, amount: ?Blob.SizeType, offset: ?Blob.SizeType) void {
        if (this.isDead())
            return;
        this.vtable.?.ready(this.ptr.?, amount, offset);
    }

    pub fn start(this: *Signal) void {
        if (this.isDead())
            return;
        this.vtable.?.start(this.ptr.?);
    }

    pub const VTable = struct {
        pub const OnCloseFn = *const (fn (this: *anyopaque, err: ?Syscall.Error) void);
        pub const OnReadyFn = *const (fn (this: *anyopaque, amount: ?Blob.SizeType, offset: ?Blob.SizeType) void);
        pub const OnStartFn = *const (fn (this: *anyopaque) void);

        close: OnCloseFn,
        ready: OnReadyFn,
        start: OnStartFn,

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
                bun.assert(copied.written <= stack_size);
                bun.assert(copied.read <= stack_size);
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
        pub const EndFn = *const (fn (this: *anyopaque, err: ?Syscall.Error) JSC.Maybe(void));
        pub const ConnectFn = *const (fn (this: *anyopaque, signal: Signal) JSC.Maybe(void));

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
                pub fn onConnect(this: *anyopaque, signal: Signal) JSC.Maybe(void) {
                    return Wrapped.connect(@as(*Wrapped, @ptrCast(@alignCast(this))), signal);
                }
                pub fn onWriteLatin1(this: *anyopaque, data: StreamResult) StreamResult.Writable {
                    return Wrapped.writeLatin1(@as(*Wrapped, @ptrCast(@alignCast(this))), data);
                }
                pub fn onWriteUTF16(this: *anyopaque, data: StreamResult) StreamResult.Writable {
                    return Wrapped.writeUTF16(@as(*Wrapped, @ptrCast(@alignCast(this))), data);
                }
                pub fn onEnd(this: *anyopaque, err: ?Syscall.Error) JSC.Maybe(void) {
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

    pub fn end(this: *Sink, err: ?Syscall.Error) JSC.Maybe(void) {
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

pub const ArrayBufferSink = struct {
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

    pub fn start(this: *ArrayBufferSink, stream_start: StreamStart) JSC.Maybe(void) {
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

    pub fn end(this: *ArrayBufferSink, err: ?Syscall.Error) JSC.Maybe(void) {
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

    pub fn memoryCost(this: *const ArrayBufferSink) usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
        return this.bytes.cap;
    }

    pub const JSSink = NewJSSink(@This(), "ArrayBufferSink");
};

const AutoFlusher = struct {
    registered: bool = false,

    pub fn registerDeferredMicrotaskWithType(comptime Type: type, this: *Type, vm: *JSC.VirtualMachine) void {
        if (this.auto_flusher.registered) return;
        registerDeferredMicrotaskWithTypeUnchecked(Type, this, vm);
    }

    pub fn unregisterDeferredMicrotaskWithType(comptime Type: type, this: *Type, vm: *JSC.VirtualMachine) void {
        if (!this.auto_flusher.registered) return;
        unregisterDeferredMicrotaskWithTypeUnchecked(Type, this, vm);
    }

    pub fn unregisterDeferredMicrotaskWithTypeUnchecked(comptime Type: type, this: *Type, vm: *JSC.VirtualMachine) void {
        bun.assert(this.auto_flusher.registered);
        bun.assert(vm.eventLoop().deferred_tasks.unregisterTask(this));
        this.auto_flusher.registered = false;
    }

    pub fn registerDeferredMicrotaskWithTypeUnchecked(comptime Type: type, this: *Type, vm: *JSC.VirtualMachine) void {
        bun.assert(!this.auto_flusher.registered);
        this.auto_flusher.registered = true;
        bun.assert(!vm.eventLoop().deferred_tasks.postTask(this, @ptrCast(&Type.onAutoFlush)));
    }
};

pub const SinkDestructor = struct {
    const Detached = opaque {};
    const Subprocess = JSC.API.Bun.Subprocess;
    pub const Ptr = bun.TaggedPointerUnion(.{
        Detached,
        Subprocess,
    });

    pub export fn Bun__onSinkDestroyed(
        ptr_value: ?*anyopaque,
        sink_ptr: ?*anyopaque,
    ) callconv(.C) void {
        _ = sink_ptr; // autofix
        const ptr = Ptr.from(ptr_value);

        if (ptr.isNull()) {
            return;
        }

        switch (ptr.tag()) {
            .Detached => {
                return;
            },
            .Subprocess => {
                const subprocess = ptr.as(Subprocess);
                subprocess.onStdinDestroyed();
            },
            else => {
                Output.debugWarn("Unknown sink type", .{});
            },
        }
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

        pub fn memoryCost(this: *ThisSink) callconv(.C) usize {
            return @sizeOf(ThisSink) + SinkType.memoryCost(&this.sink);
        }

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

        pub fn createObject(globalThis: *JSGlobalObject, object: *anyopaque, destructor: usize) callconv(.C) JSValue {
            JSC.markBinding(@src());

            return shim.cppFn("createObject", .{ globalThis, object, destructor });
        }

        pub fn fromJS(globalThis: *JSGlobalObject, value: JSValue) ?*anyopaque {
            JSC.markBinding(@src());

            return shim.cppFn("fromJS", .{ globalThis, value });
        }

        pub fn setDestroyCallback(value: JSValue, callback: usize) void {
            JSC.markBinding(@src());

            return shim.cppFn("setDestroyCallback", .{ value, callback });
        }

        pub fn construct(globalThis: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());

            if (comptime !@hasDecl(SinkType, "construct")) {
                const Static = struct {
                    pub const message = std.fmt.comptimePrint("{s} is not constructable", .{SinkType.name});
                };
                const err = JSC.SystemError{
                    .message = bun.String.static(Static.message),
                    .code = bun.String.static(@tagName(.ERR_ILLEGAL_CONSTRUCTOR)),
                };
                return globalThis.throwValue(err.toErrorInstance(globalThis));
            }

            var allocator = globalThis.bunVM().allocator;
            var this = allocator.create(ThisSink) catch {
                return globalThis.throwValue(Syscall.Error.oom.toJSC(globalThis));
            };
            this.sink.construct(allocator);
            return createObject(globalThis, this, 0);
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

        inline fn getThis(globalThis: *JSGlobalObject, callframe: *const JSC.CallFrame) ?*ThisSink {
            return @as(*ThisSink, @ptrCast(@alignCast(fromJS(globalThis, callframe.this()) orelse return null)));
        }

        fn invalidThis(globalThis: *JSGlobalObject) bun.JSError {
            return globalThis.ERR_INVALID_THIS("Expected Sink", .{}).throw();
        }

        pub fn unprotect(this: *@This()) void {
            _ = this; // autofix

        }

        pub fn write(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());
            var this = getThis(globalThis, callframe) orelse return invalidThis(globalThis);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    return globalThis.throwValue(err);
                }
            }

            const args_list = callframe.arguments_old(4);
            const args = args_list.ptr[0..args_list.len];

            if (args.len == 0) {
                return globalThis.throwValue(JSC.toTypeError(.ERR_MISSING_ARGS, "write() expects a string, ArrayBufferView, or ArrayBuffer", .{}, globalThis));
            }

            const arg = args[0];
            arg.ensureStillAlive();
            defer arg.ensureStillAlive();

            if (arg.isEmptyOrUndefinedOrNull()) {
                return globalThis.throwValue(JSC.toTypeError(.ERR_STREAM_NULL_VALUES, "write() expects a string, ArrayBufferView, or ArrayBuffer", .{}, globalThis));
            }

            if (arg.asArrayBuffer(globalThis)) |buffer| {
                const slice = buffer.slice();
                if (slice.len == 0) {
                    return JSC.JSValue.jsNumber(0);
                }

                return this.sink.writeBytes(.{ .temporary = bun.ByteList.init(slice) }).toJS(globalThis);
            }

            if (!arg.isString()) {
                return globalThis.throwValue(JSC.toTypeError(.ERR_INVALID_ARG_TYPE, "write() expects a string, ArrayBufferView, or ArrayBuffer", .{}, globalThis));
            }

            const str = arg.toString(globalThis);
            if (globalThis.hasException()) {
                return .zero;
            }

            const view = str.view(globalThis);

            if (view.isEmpty()) {
                return JSC.JSValue.jsNumber(0);
            }

            defer str.ensureStillAlive();
            if (view.is16Bit()) {
                return this.sink.writeUTF16(.{ .temporary = bun.ByteList.initConst(std.mem.sliceAsBytes(view.utf16SliceAligned())) }).toJS(globalThis);
            }

            return this.sink.writeLatin1(.{ .temporary = bun.ByteList.initConst(view.slice()) }).toJS(globalThis);
        }

        pub fn writeUTF8(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());

            var this = getThis(globalThis, callframe) orelse return invalidThis(globalThis);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    return globalThis.throwValue(err);
                }
            }

            const args_list = callframe.arguments_old(4);
            const args = args_list.ptr[0..args_list.len];
            if (args.len == 0 or !args[0].isString()) {
                const err = JSC.toTypeError(
                    if (args.len == 0) .ERR_MISSING_ARGS else .ERR_INVALID_ARG_TYPE,
                    "writeUTF8() expects a string",
                    .{},
                    globalThis,
                );
                return globalThis.throwValue(err);
            }

            const arg = args[0];

            const str = arg.toString(globalThis);
            if (globalThis.hasException()) {
                return .zero;
            }

            const view = str.view(globalThis);
            if (view.isEmpty()) {
                return JSC.JSValue.jsNumber(0);
            }

            defer str.ensureStillAlive();
            if (str.is16Bit()) {
                return this.sink.writeUTF16(.{ .temporary = view.utf16SliceAligned() }).toJS(globalThis);
            }

            return this.sink.writeLatin1(.{ .temporary = view.slice() }).toJS(globalThis);
        }

        pub fn close(globalThis: *JSGlobalObject, sink_ptr: ?*anyopaque) callconv(.C) JSValue {
            JSC.markBinding(@src());
            var this = @as(*ThisSink, @ptrCast(@alignCast(sink_ptr orelse return invalidThis(globalThis) catch .zero)));

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    return globalThis.vm().throwError(globalThis, err) catch .zero;
                }
            }

            return this.sink.end(null).toJS(globalThis);
        }

        pub fn flush(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());

            var this = getThis(globalThis, callframe) orelse return invalidThis(globalThis);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    return globalThis.throwValue(err);
                }
            }

            defer {
                if ((comptime @hasField(SinkType, "done")) and this.sink.done) {
                    this.unprotect();
                }
            }

            if (comptime @hasDecl(SinkType, "flushFromJS")) {
                const wait = callframe.argumentsCount() > 0 and callframe.argument(0).isBoolean() and callframe.argument(0).asBoolean();
                const maybe_value: JSC.Maybe(JSValue) = this.sink.flushFromJS(globalThis, wait);
                return switch (maybe_value) {
                    .result => |value| value,
                    .err => |err| return globalThis.throwValue(err.toJSC(globalThis)),
                };
            }

            return this.sink.flush().toJS(globalThis);
        }

        pub fn start(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());

            var this = getThis(globalThis, callframe) orelse return invalidThis(globalThis);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    return globalThis.throwValue(err);
                }
            }

            if (comptime @hasField(StreamStart, name_)) {
                return this.sink.start(
                    if (callframe.argumentsCount() > 0)
                        try StreamStart.fromJSWithTag(globalThis, callframe.argument(0), comptime @field(StreamStart, name_))
                    else
                        StreamStart{ .empty = {} },
                ).toJS(globalThis);
            }

            return this.sink.start(
                if (callframe.argumentsCount() > 0)
                    try StreamStart.fromJS(globalThis, callframe.argument(0))
                else
                    StreamStart{ .empty = {} },
            ).toJS(globalThis);
        }

        pub fn end(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());

            var this = getThis(globalThis, callframe) orelse return invalidThis(globalThis);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    return globalThis.throwValue(err);
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

        pub fn endWithSink(ptr: *anyopaque, globalThis: *JSGlobalObject) callconv(JSC.conv) JSValue {
            JSC.markBinding(@src());

            var this = @as(*ThisSink, @ptrCast(@alignCast(ptr)));

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    return globalThis.throwValue(err);
                }
            }

            return this.sink.endFromJS(globalThis).toJS(globalThis);
        }

        pub fn assignToStream(globalThis: *JSGlobalObject, stream: JSValue, ptr: *anyopaque, jsvalue_ptr: **anyopaque) JSValue {
            return shim.cppFn("assignToStream", .{ globalThis, stream, ptr, jsvalue_ptr });
        }

        pub fn updateRef(ptr: *anyopaque, value: bool) callconv(.C) void {
            JSC.markBinding(@src());
            var this = bun.cast(*ThisSink, ptr);
            if (comptime @hasDecl(SinkType, "updateRef"))
                this.sink.updateRef(value);
        }

        const jsWrite = JSC.toJSHostFunction(write);
        const jsFlush = JSC.toJSHostFunction(flush);
        const jsStart = JSC.toJSHostFunction(start);
        const jsEnd = JSC.toJSHostFunction(end);
        const jsConstruct = JSC.toJSHostFunction(construct);

        comptime {
            @export(finalize, .{ .name = shim.symbolName("finalize") });
            @export(jsWrite, .{ .name = shim.symbolName("write") });
            @export(close, .{ .name = shim.symbolName("close") });
            @export(jsFlush, .{ .name = shim.symbolName("flush") });
            @export(jsStart, .{ .name = shim.symbolName("start") });
            @export(jsEnd, .{ .name = shim.symbolName("end") });
            @export(jsConstruct, .{ .name = shim.symbolName("construct") });
            @export(endWithSink, .{ .name = shim.symbolName("endWithSink") });
            @export(updateRef, .{ .name = shim.symbolName("updateRef") });
            @export(memoryCost, .{ .name = shim.symbolName("memoryCost") });

            shim.assertJSFunction(.{
                write,
                close,
                flush,
                start,
                end,
            });
        }

        pub const Extern = [_][]const u8{ "createObject", "fromJS", "assignToStream", "onReady", "onClose", "detachPtr" };
    };
}

// pub fn NetworkSocket(comptime tls: bool) type {
//     return struct {
//         const Socket = uws.NewSocketHandler(tls);
//         const ThisSocket = @This();

//         socket: Socket,

//         pub fn connect(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
//             JSC.markBinding(@src());

//             var this = @ptrCast(*ThisSocket, @alignCast( fromJS(globalThis, callframe.this()) orelse {
//                 const err = JSC.toTypeError(.ERR_INVALID_THIS, "Expected Socket", .{}, globalThis);
//                 globalThis.throwValue( err);
//                 return .zero;
//             }));
//         }
//     };
// }

// TODO: make this JSGlobalObject local
// for better security
pub const ByteListPool = ObjectPool(
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

        // Don't include @sizeOf(This) because it's already included in the memoryCost of the sink
        pub fn memoryCost(this: *@This()) usize {
            // TODO: include Socket send buffer size. We can't here because we
            // don't track if it's still accessible.
            // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
            return this.buffer.cap;
        }

        fn handleWrote(this: *@This(), amount1: usize) void {
            defer log("handleWrote: {d} offset: {d}, {d}", .{ amount1, this.offset, this.buffer.len });
            const amount = @as(Blob.SizeType, @truncate(amount1));
            this.offset += amount;
            this.wrote += amount;

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
        fn hasBackpressureAndIsTryEnd(this: *const @This()) bool {
            return this.has_backpressure and this.end_len > 0;
        }
        fn sendWithoutAutoFlusher(this: *@This(), buf: []const u8) bool {
            bun.assert(!this.done);
            defer log("send: {d} bytes (backpressure: {any})", .{ buf.len, this.has_backpressure });

            if (this.requested_end and !this.res.state().isHttpWriteCalled()) {
                this.handleFirstWriteIfNecessary();
                const success = this.res.tryEnd(buf, this.end_len, false);
                if (success) {
                    this.has_backpressure = false;
                    this.handleWrote(this.end_len);
                } else {
                    this.has_backpressure = true;
                    this.res.onWritable(*@This(), onWritable, this);
                }
                return success;
            }
            // clean this so we know when its relevant or not
            this.end_len = 0;
            // we clear the onWritable handler so uWS can handle the backpressure for us
            this.res.clearOnWritable();
            this.handleFirstWriteIfNecessary();
            // uWebSockets lacks a tryWrite() function
            // This means that backpressure will be handled by appending to an "infinite" memory buffer
            // It will do the backpressure handling for us
            // so in this scenario, we just append to the buffer
            // and report success
            if (this.requested_end) {
                this.res.end(buf, false);
                this.has_backpressure = false;
            } else {
                this.has_backpressure = !this.res.write(buf);
            }
            this.handleWrote(buf.len);
            return true;
        }

        fn send(this: *@This(), buf: []const u8) bool {
            this.unregisterAutoFlusher();
            return this.sendWithoutAutoFlusher(buf);
        }

        fn readableSlice(this: *@This()) []const u8 {
            return this.buffer.ptr[this.offset..this.buffer.len];
        }

        pub fn onWritable(this: *@This(), write_offset: u64, _: *UWSResponse) bool {
            // write_offset is the amount of data that was written not how much we need to write
            log("onWritable ({d})", .{write_offset});
            // onWritable reset backpressure state to allow flushing
            this.has_backpressure = false;
            if (this.aborted) {
                this.res.clearOnWritable();
                this.signal.close(null);
                this.flushPromise();
                this.finalize();
                return false;
            }
            var total_written: u64 = 0;

            // do not write more than available
            // if we do, it will cause this to be delayed until the next call, each time
            // TODO: should we break it in smaller chunks?
            const to_write = @min(@as(Blob.SizeType, @truncate(write_offset)), @as(Blob.SizeType, this.buffer.len - 1));
            const chunk = this.readableSlice()[to_write..];
            // if we have nothing to write, we are done
            if (chunk.len == 0) {
                if (this.done) {
                    this.res.clearOnWritable();
                    this.signal.close(null);
                    this.flushPromise();
                    this.finalize();
                    return true;
                }
            } else {
                if (!this.send(chunk)) {
                    // if we were unable to send it, retry
                    return false;
                }
                total_written = chunk.len;

                if (this.requested_end) {
                    this.res.clearOnWritable();
                    this.signal.close(null);
                    this.flushPromise();
                    this.finalize();
                    return true;
                }
            }

            // flush the javascript promise from calling .flush()
            this.flushPromise();

            // pending_flush or callback could have caused another send()
            // so we check again if we should report readiness
            if (!this.done and !this.requested_end and !this.hasBackpressure()) {
                // no pending and total_written > 0
                if (total_written > 0 and this.readableSlice().len == 0) {
                    this.signal.ready(@as(Blob.SizeType, @truncate(total_written)), null);
                }
            }

            return true;
        }

        pub fn start(this: *@This(), stream_start: StreamStart) JSC.Maybe(void) {
            if (this.aborted or this.res.hasResponded()) {
                this.markDone();
                this.signal.close(null);
                return .{ .result = {} };
            }

            this.wrote = 0;
            this.wrote_at_start_of_flush = 0;
            this.flushPromise();

            if (this.buffer.cap == 0) {
                bun.assert(this.pooled_buffer == null);
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

        fn flushFromJSNoWait(this: *@This()) JSC.Maybe(JSValue) {
            log("flushFromJSNoWait", .{});

            return .{ .result = JSValue.jsNumber(this.flushNoWait()) };
        }

        pub fn flushNoWait(this: *@This()) usize {
            if (this.hasBackpressureAndIsTryEnd() or this.done) {
                return 0;
            }

            const slice = this.readableSlice();
            if (slice.len == 0) {
                return 0;
            }

            const success = this.send(slice);
            if (success) {
                return slice.len;
            }

            return 0;
        }

        pub fn flushFromJS(this: *@This(), globalThis: *JSGlobalObject, wait: bool) JSC.Maybe(JSValue) {
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

            if (!this.hasBackpressureAndIsTryEnd()) {
                const slice = this.readableSlice();
                assert(slice.len > 0);
                const success = this.send(slice);
                if (success) {
                    return .{ .result = JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(slice.len)) };
                }
            }
            this.wrote_at_start_of_flush = this.wrote;
            this.pending_flush = JSC.JSPromise.create(globalThis);
            this.globalThis = globalThis;
            var promise_value = this.pending_flush.?.asValue(globalThis);
            promise_value.protect();

            return .{ .result = promise_value };
        }

        pub fn flush(this: *@This()) JSC.Maybe(void) {
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
                    return .{ .owned = len };
                }
            } else {
                // queue the data wait until highWaterMark is reached or the auto flusher kicks in
                _ = this.buffer.write(this.allocator, bytes) catch {
                    return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
                };
            }

            this.registerAutoFlusher();

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
                        return .{ .owned = len };
                    }
                    do_send = false;
                }

                _ = this.buffer.writeLatin1(this.allocator, bytes) catch {
                    return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
                };

                if (do_send) {
                    if (this.send(this.readableSlice())) {
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
                    return .{ .owned = len };
                }
            } else {
                _ = this.buffer.writeLatin1(this.allocator, bytes) catch {
                    return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
                };
            }

            this.registerAutoFlusher();

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
                    return .{ .owned = @as(Blob.SizeType, @intCast(written)) };
                }
            }

            this.registerAutoFlusher();
            return .{ .owned = @as(Blob.SizeType, @intCast(written)) };
        }

        pub fn markDone(this: *@This()) void {
            this.done = true;
            this.unregisterAutoFlusher();
        }

        // In this case, it's always an error
        pub fn end(this: *@This(), err: ?Syscall.Error) JSC.Maybe(void) {
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

        pub fn endFromJS(this: *@This(), globalThis: *JSGlobalObject) JSC.Maybe(JSValue) {
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
            // if we enqueue data we should reset the timeout
            this.res.resetTimeout();
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

            if ((this.hasBackpressureAndIsTryEnd()) or readable.len == 0) {
                this.auto_flusher.registered = false;
                return false;
            }

            if (!this.sendWithoutAutoFlusher(readable)) {
                this.auto_flusher.registered = true;
                return true;
            }
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
                this.unregisterAutoFlusher();
                // make sure we detached the handlers before flushing inside the finalize function
                this.res.clearOnWritable();
                this.res.clearAborted();
                this.res.clearOnData();
                _ = this.flushNoWait();
                this.done = true;
                // is actually fine to call this if the socket is closed because of flushNoWait, the free will be defered by usockets
                this.res.endStream(false);
            }

            if (comptime !FeatureFlags.http_buffer_pooling) {
                assert(this.pooled_buffer == null);
            }

            if (this.pooled_buffer) |pooled| {
                this.buffer.len = 0;
                if (this.buffer.cap > 64 * 1024) {
                    this.buffer.deinitWithAllocator(bun.default_allocator);
                    this.buffer = bun.ByteList.init("");
                }
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
pub const NetworkSink = struct {
    task: ?HTTPWritableStream = null,
    signal: Signal = .{},
    globalThis: *JSGlobalObject = undefined,
    highWaterMark: Blob.SizeType = 2048,
    buffer: bun.io.StreamBuffer,
    ended: bool = false,
    done: bool = false,
    cancel: bool = false,
    encoded: bool = true,

    endPromise: JSC.JSPromise.Strong = .{},

    auto_flusher: AutoFlusher = AutoFlusher{},

    pub usingnamespace bun.New(NetworkSink);
    const HTTPWritableStream = union(enum) {
        fetch: *JSC.WebCore.Fetch.FetchTasklet,
        s3_upload: *bun.S3.MultiPartUpload,
    };

    fn getHighWaterMark(this: *@This()) Blob.SizeType {
        if (this.task) |task| {
            return switch (task) {
                .s3_upload => |s3| @truncate(s3.partSizeInBytes()),
                else => this.highWaterMark,
            };
        }
        return this.highWaterMark;
    }
    fn unregisterAutoFlusher(this: *@This()) void {
        if (this.auto_flusher.registered)
            AutoFlusher.unregisterDeferredMicrotaskWithTypeUnchecked(@This(), this, this.globalThis.bunVM());
    }

    fn registerAutoFlusher(this: *@This()) void {
        if (!this.auto_flusher.registered)
            AutoFlusher.registerDeferredMicrotaskWithTypeUnchecked(@This(), this, this.globalThis.bunVM());
    }

    pub fn path(this: *@This()) ?[]const u8 {
        if (this.task) |task| {
            return switch (task) {
                .s3_upload => |s3| s3.path,
                else => null,
            };
        }
        return null;
    }

    pub fn onAutoFlush(this: *@This()) bool {
        if (this.done) {
            this.auto_flusher.registered = false;
            return false;
        }

        _ = this.internalFlush() catch 0;
        if (this.buffer.isEmpty()) {
            this.auto_flusher.registered = false;
            return false;
        }
        return true;
    }

    pub fn start(this: *@This(), stream_start: StreamStart) JSC.Maybe(void) {
        if (this.ended) {
            return .{ .result = {} };
        }

        switch (stream_start) {
            .chunk_size => |chunk_size| {
                if (chunk_size > 0) {
                    this.highWaterMark = chunk_size;
                }
            },
            else => {},
        }
        this.ended = false;
        this.signal.start();
        return .{ .result = {} };
    }

    pub fn connect(this: *@This(), signal: Signal) void {
        this.signal = signal;
    }
    pub fn sink(this: *@This()) Sink {
        return Sink.init(this);
    }
    pub fn toSink(this: *@This()) *@This().JSSink {
        return @ptrCast(this);
    }
    pub fn finalize(this: *@This()) void {
        this.unregisterAutoFlusher();

        var buffer = this.buffer;
        this.buffer = .{};
        buffer.deinit();

        this.detachWritable();
    }

    fn detachWritable(this: *@This()) void {
        if (this.task) |task| {
            this.task = null;
            switch (task) {
                inline .fetch, .s3_upload => |writable| {
                    writable.deref();
                },
            }
        }
    }

    fn sendRequestData(writable: HTTPWritableStream, data: []const u8, is_last: bool) void {
        switch (writable) {
            inline .fetch, .s3_upload => |task| task.sendRequestData(data, is_last),
        }
    }

    pub fn send(this: *@This(), data: []const u8, is_last: bool) !void {
        if (this.done) return;

        if (this.task) |task| {
            if (is_last) this.done = true;
            if (this.encoded) {
                if (data.len == 0) {
                    sendRequestData(task, bun.http.end_of_chunked_http1_1_encoding_response_body, true);
                    return;
                }

                // chunk encoding is really simple
                if (is_last) {
                    const chunk = std.fmt.allocPrint(bun.default_allocator, "{x}\r\n{s}\r\n0\r\n\r\n", .{ data.len, data }) catch return error.OOM;
                    sendRequestData(task, chunk, true);
                } else {
                    const chunk = std.fmt.allocPrint(bun.default_allocator, "{x}\r\n{s}\r\n", .{ data.len, data }) catch return error.OOM;
                    sendRequestData(task, chunk, false);
                }
            } else {
                sendRequestData(task, data, is_last);
            }
        }
    }

    pub fn internalFlush(this: *@This()) !usize {
        if (this.done) return 0;
        var flushed: usize = 0;
        // we need to respect the max len for the chunk
        while (this.buffer.isNotEmpty()) {
            const bytes = this.buffer.slice();
            const len: u32 = @min(bytes.len, std.math.maxInt(u32));
            try this.send(bytes, this.buffer.list.items.len - (this.buffer.cursor + len) == 0 and this.ended);
            flushed += len;
            this.buffer.cursor = len;
            if (this.buffer.isEmpty()) {
                this.buffer.reset();
            }
        }
        if (this.ended and !this.done) {
            try this.send("", true);
            this.finalize();
        }
        return flushed;
    }

    pub fn flush(this: *@This()) JSC.Maybe(void) {
        _ = this.internalFlush() catch 0;
        return .{ .result = {} };
    }
    pub fn flushFromJS(this: *@This(), globalThis: *JSGlobalObject, _: bool) JSC.Maybe(JSValue) {
        return .{ .result = JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(this.internalFlush() catch 0)) };
    }
    pub fn finalizeAndDestroy(this: *@This()) void {
        this.finalize();
        this.destroy();
    }

    pub fn abort(this: *@This()) void {
        this.ended = true;
        this.done = true;
        this.signal.close(null);
        this.cancel = true;
        this.finalize();
    }

    pub fn write(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.ended) {
            return .{ .owned = 0 };
        }
        const bytes = data.slice();
        const len = @as(Blob.SizeType, @truncate(bytes.len));

        if (this.buffer.size() == 0 and len >= this.getHighWaterMark()) {
            // fast path:
            // - large-ish chunk
            this.send(bytes, false) catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
            return .{ .owned = len };
        } else if (this.buffer.size() + len >= this.getHighWaterMark()) {
            _ = this.buffer.write(bytes) catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
            _ = this.internalFlush() catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
            return .{ .owned = len };
        } else {
            // queue the data wait until highWaterMark is reached or the auto flusher kicks in
            this.buffer.write(bytes) catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
        }
        this.registerAutoFlusher();
        return .{ .owned = len };
    }

    pub const writeBytes = write;
    pub fn writeLatin1(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.ended) {
            return .{ .owned = 0 };
        }

        const bytes = data.slice();
        const len = @as(Blob.SizeType, @truncate(bytes.len));

        if (this.buffer.size() == 0 and len >= this.getHighWaterMark()) {
            // common case
            if (strings.isAllASCII(bytes)) {
                // fast path:
                // - large-ish chunk
                this.send(bytes, false) catch {
                    return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
                };
                return .{ .owned = len };
            }

            this.buffer.writeLatin1(bytes) catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };

            _ = this.internalFlush() catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
            return .{ .owned = len };
        } else if (this.buffer.size() + len >= this.getHighWaterMark()) {
            // kinda fast path:
            // - combined chunk is large enough to flush automatically
            this.buffer.writeLatin1(bytes) catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
            _ = this.internalFlush() catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
            return .{ .owned = len };
        } else {
            this.buffer.writeLatin1(bytes) catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
        }

        this.registerAutoFlusher();

        return .{ .owned = len };
    }
    pub fn writeUTF16(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.ended) {
            return .{ .owned = 0 };
        }
        const bytes = data.slice();
        // we must always buffer UTF-16
        // we assume the case of all-ascii UTF-16 string is pretty uncommon
        this.buffer.writeUTF16(@alignCast(std.mem.bytesAsSlice(u16, bytes))) catch {
            return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
        };

        const readable = this.buffer.slice();
        if (readable.len >= this.getHighWaterMark()) {
            _ = this.internalFlush() catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
            return .{ .owned = @as(Blob.SizeType, @intCast(bytes.len)) };
        }

        this.registerAutoFlusher();
        return .{ .owned = @as(Blob.SizeType, @intCast(bytes.len)) };
    }

    pub fn end(this: *@This(), err: ?Syscall.Error) JSC.Maybe(void) {
        if (this.ended) {
            return .{ .result = {} };
        }

        // send EOF
        this.ended = true;
        // flush everything and send EOF
        _ = this.internalFlush() catch 0;

        this.signal.close(err);
        return .{ .result = {} };
    }
    pub fn endFromJS(this: *@This(), _: *JSGlobalObject) JSC.Maybe(JSValue) {
        if (!this.ended) {
            if (this.done) {
                this.ended = true;
                this.signal.close(null);
                this.finalize();
            } else {
                _ = this.end(null);
            }
        }
        const promise = this.endPromise.valueOrEmpty();
        if (promise.isEmptyOrUndefinedOrNull()) {
            return .{ .result = JSC.JSValue.jsNumber(0) };
        }
        return .{ .result = promise };
    }
    pub fn toJS(this: *@This(), globalThis: *JSGlobalObject) JSValue {
        return JSSink.createObject(globalThis, this, 0);
    }

    pub fn memoryCost(this: *const @This()) usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
        return this.buffer.memoryCost();
    }

    const name = "NetworkSink";
    pub const JSSink = NewJSSink(@This(), name);
};
pub const BufferedReadableStreamAction = enum {
    text,
    arrayBuffer,
    blob,
    bytes,
    json,
};

pub fn ReadableStreamSource(
    comptime Context: type,
    comptime name_: []const u8,
    comptime onStart: anytype,
    comptime onPull: anytype,
    comptime onCancel: fn (this: *Context) void,
    comptime deinit_fn: fn (this: *Context) void,
    comptime setRefUnrefFn: ?fn (this: *Context, enable: bool) void,
    comptime drainInternalBuffer: ?fn (this: *Context) bun.ByteList,
    comptime memoryCostFn: ?fn (this: *const Context) usize,
    comptime toBufferedValue: ?fn (this: *Context, globalThis: *JSC.JSGlobalObject, action: BufferedReadableStreamAction) bun.JSError!JSC.JSValue,
) type {
    return struct {
        context: Context,
        cancelled: bool = false,
        ref_count: u32 = 1,
        pending_err: ?Syscall.Error = null,
        close_handler: ?*const fn (?*anyopaque) void = null,
        close_ctx: ?*anyopaque = null,
        close_jsvalue: JSC.Strong = .{},
        globalThis: *JSGlobalObject = undefined,
        this_jsvalue: JSC.JSValue = .zero,
        is_closed: bool = false,
        const This = @This();
        const ReadableStreamSourceType = @This();

        pub usingnamespace bun.New(@This());

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

        pub fn onPullFromJS(this: *This, buf: []u8, view: JSValue) StreamResult {
            return onPull(&this.context, buf, view);
        }

        pub fn onStartFromJS(this: *This) StreamStart {
            return onStart(&this.context);
        }

        pub fn cancel(this: *This) void {
            if (this.cancelled) {
                return;
            }

            this.cancelled = true;
            onCancel(&this.context);
        }

        pub fn onClose(this: *This) void {
            if (this.cancelled) {
                return;
            }

            if (this.close_handler) |close| {
                this.close_handler = null;
                if (close == &JSReadableStreamSource.onClose) {
                    JSReadableStreamSource.onClose(this);
                } else {
                    close(this.close_ctx);
                }
            }
        }

        pub fn incrementCount(this: *This) void {
            this.ref_count += 1;
        }

        pub fn decrementCount(this: *This) u32 {
            if (comptime Environment.isDebug) {
                if (this.ref_count == 0) {
                    @panic("Attempted to decrement ref count below zero");
                }
            }

            this.ref_count -= 1;
            if (this.ref_count == 0) {
                this.close_jsvalue.deinit();
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

        pub fn toReadableStream(this: *ReadableStreamSourceType, globalThis: *JSGlobalObject) JSC.JSValue {
            const out_value = brk: {
                if (this.this_jsvalue != .zero) {
                    break :brk this.this_jsvalue;
                }

                break :brk this.toJS(globalThis);
            };
            out_value.ensureStillAlive();
            this.this_jsvalue = out_value;
            return ReadableStream.fromNative(globalThis, out_value);
        }

        pub fn setRawModeFromJS(this: *ReadableStreamSourceType, global: *JSC.JSGlobalObject, call_frame: *JSC.CallFrame) bun.JSError!JSValue {
            if (@hasDecl(Context, "setRawMode")) {
                const flag = call_frame.argument(0);
                if (Environment.allow_assert) {
                    bun.assert(flag.isBoolean());
                }
                return switch (this.context.setRawMode(flag == .true)) {
                    .result => .undefined,
                    .err => |e| e.toJSC(global),
                };
            }

            @compileError("setRawMode is not implemented on " ++ @typeName(Context));
        }

        const supports_ref = setRefUnrefFn != null;

        pub usingnamespace @field(JSC.Codegen, "JS" ++ name_ ++ "InternalReadableStreamSource");
        pub const drainFromJS = JSReadableStreamSource.drain;
        pub const startFromJS = JSReadableStreamSource.start;
        pub const pullFromJS = JSReadableStreamSource.pull;
        pub const cancelFromJS = JSReadableStreamSource.cancel;
        pub const updateRefFromJS = JSReadableStreamSource.updateRef;
        pub const setOnCloseFromJS = JSReadableStreamSource.setOnCloseFromJS;
        pub const getOnCloseFromJS = JSReadableStreamSource.getOnCloseFromJS;
        pub const setOnDrainFromJS = JSReadableStreamSource.setOnDrainFromJS;
        pub const getOnDrainFromJS = JSReadableStreamSource.getOnDrainFromJS;
        pub const finalize = JSReadableStreamSource.finalize;
        pub const construct = JSReadableStreamSource.construct;
        pub const getIsClosedFromJS = JSReadableStreamSource.isClosed;
        pub const textFromJS = JSReadableStreamSource.text;
        pub const jsonFromJS = JSReadableStreamSource.json;
        pub const arrayBufferFromJS = JSReadableStreamSource.arrayBuffer;
        pub const blobFromJS = JSReadableStreamSource.blob;
        pub const bytesFromJS = JSReadableStreamSource.bytes;

        pub fn memoryCost(this: *const ReadableStreamSourceType) usize {
            if (memoryCostFn) |function| {
                return function(&this.context) + @sizeOf(@This());
            }
            return @sizeOf(@This());
        }

        pub const JSReadableStreamSource = struct {
            pub fn pull(this: *ReadableStreamSourceType, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                JSC.markBinding(@src());
                const this_jsvalue = callFrame.this();
                const arguments = callFrame.arguments_old(2);
                const view = arguments.ptr[0];
                view.ensureStillAlive();
                this.this_jsvalue = this_jsvalue;
                var buffer = view.asArrayBuffer(globalThis) orelse return .undefined;
                return processResult(
                    this_jsvalue,
                    globalThis,
                    arguments.ptr[1],
                    this.onPullFromJS(buffer.slice(), view),
                );
            }

            pub fn start(this: *ReadableStreamSourceType, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                JSC.markBinding(@src());
                this.globalThis = globalThis;
                this.this_jsvalue = callFrame.this();
                switch (this.onStartFromJS()) {
                    .empty => return JSValue.jsNumber(0),
                    .ready => return JSValue.jsNumber(16384),
                    .chunk_size => |size| return JSValue.jsNumber(size),
                    .err => |err| {
                        return globalThis.throwValue(err.toJSC(globalThis));
                    },
                    else => |rc| {
                        return rc.toJS(globalThis);
                    },
                }
            }

            pub fn isClosed(this: *ReadableStreamSourceType, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                _ = globalObject; // autofix
                return JSC.JSValue.jsBoolean(this.is_closed);
            }

            fn processResult(this_jsvalue: JSC.JSValue, globalThis: *JSGlobalObject, flags: JSValue, result: StreamResult) bun.JSError!JSC.JSValue {
                switch (result) {
                    .err => |err| {
                        if (err == .Error) {
                            return globalThis.throwValue(err.Error.toJSC(globalThis));
                        } else {
                            const js_err = err.JSValue;
                            js_err.ensureStillAlive();
                            js_err.unprotect();
                            return globalThis.throwValue(js_err);
                        }
                    },
                    .pending => {
                        const out = result.toJS(globalThis);
                        ReadableStreamSourceType.pendingPromiseSetCached(this_jsvalue, globalThis, out);
                        return out;
                    },
                    .temporary_and_done, .owned_and_done, .into_array_and_done => {
                        JSC.C.JSObjectSetPropertyAtIndex(globalThis, flags.asObjectRef(), 0, JSValue.jsBoolean(true).asObjectRef(), null);
                        return result.toJS(globalThis);
                    },
                    else => return result.toJS(globalThis),
                }
            }

            pub fn cancel(this: *ReadableStreamSourceType, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                _ = globalObject; // autofix
                JSC.markBinding(@src());
                this.this_jsvalue = callFrame.this();
                this.cancel();
                return .undefined;
            }

            pub fn setOnCloseFromJS(this: *ReadableStreamSourceType, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) bool {
                JSC.markBinding(@src());
                this.close_handler = JSReadableStreamSource.onClose;
                this.globalThis = globalObject;

                if (value.isUndefined()) {
                    this.close_jsvalue.deinit();
                    return true;
                }

                if (!value.isCallable(globalObject.vm())) {
                    globalObject.throwInvalidArgumentType("ReadableStreamSource", "onclose", "function") catch {};
                    return false;
                }
                const cb = value.withAsyncContextIfNeeded(globalObject);
                this.close_jsvalue.set(globalObject, cb);
                return true;
            }

            pub fn setOnDrainFromJS(this: *ReadableStreamSourceType, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) bool {
                JSC.markBinding(@src());
                this.globalThis = globalObject;

                if (value.isUndefined()) {
                    ReadableStreamSourceType.onDrainCallbackSetCached(this.this_jsvalue, globalObject, .undefined);
                    return true;
                }

                if (!value.isCallable(globalObject.vm())) {
                    globalObject.throwInvalidArgumentType("ReadableStreamSource", "onDrain", "function") catch {};
                    return false;
                }
                const cb = value.withAsyncContextIfNeeded(globalObject);
                ReadableStreamSourceType.onDrainCallbackSetCached(this.this_jsvalue, globalObject, cb);
                return true;
            }

            pub fn getOnCloseFromJS(this: *ReadableStreamSourceType, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                _ = globalObject; // autofix

                JSC.markBinding(@src());

                return this.close_jsvalue.get() orelse .undefined;
            }

            pub fn getOnDrainFromJS(this: *ReadableStreamSourceType, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                _ = globalObject; // autofix

                JSC.markBinding(@src());

                if (ReadableStreamSourceType.onDrainCallbackGetCached(this.this_jsvalue)) |val| {
                    return val;
                }

                return .undefined;
            }

            pub fn updateRef(this: *ReadableStreamSourceType, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                _ = globalObject; // autofix
                JSC.markBinding(@src());
                this.this_jsvalue = callFrame.this();
                const ref_or_unref = callFrame.argument(0).toBoolean();
                this.setRef(ref_or_unref);

                return .undefined;
            }

            fn onClose(ptr: ?*anyopaque) void {
                JSC.markBinding(@src());
                var this = bun.cast(*ReadableStreamSourceType, ptr.?);
                if (this.close_jsvalue.trySwap()) |cb| {
                    this.globalThis.queueMicrotask(cb, &.{});
                }

                this.close_jsvalue.clear();
            }

            pub fn finalize(this: *ReadableStreamSourceType) void {
                this.this_jsvalue = .zero;

                _ = this.decrementCount();
            }

            pub fn drain(this: *ReadableStreamSourceType, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                JSC.markBinding(@src());
                this.this_jsvalue = callFrame.this();
                var list = this.drain();
                if (list.len > 0) {
                    return JSC.ArrayBuffer.fromBytes(list.slice(), .Uint8Array).toJS(globalThis, null);
                }
                return JSValue.jsUndefined();
            }

            pub fn text(this: *ReadableStreamSourceType, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                JSC.markBinding(@src());
                this.this_jsvalue = callFrame.this();

                if (toBufferedValue) |to_buffered_value| {
                    return to_buffered_value(&this.context, globalThis, .text);
                }

                globalThis.throwTODO("This is not implemented yet");
                return .zero;
            }

            pub fn arrayBuffer(this: *ReadableStreamSourceType, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                JSC.markBinding(@src());
                this.this_jsvalue = callFrame.this();

                if (toBufferedValue) |to_buffered_value| {
                    return to_buffered_value(&this.context, globalThis, .arrayBuffer);
                }

                globalThis.throwTODO("This is not implemented yet");
                return .zero;
            }

            pub fn blob(this: *ReadableStreamSourceType, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                JSC.markBinding(@src());
                this.this_jsvalue = callFrame.this();

                if (toBufferedValue) |to_buffered_value| {
                    return to_buffered_value(&this.context, globalThis, .blob);
                }

                globalThis.throwTODO("This is not implemented yet");
                return .zero;
            }

            pub fn bytes(this: *ReadableStreamSourceType, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                JSC.markBinding(@src());
                this.this_jsvalue = callFrame.this();

                if (toBufferedValue) |to_buffered_value| {
                    return to_buffered_value(&this.context, globalThis, .bytes);
                }

                globalThis.throwTODO("This is not implemented yet");
                return .zero;
            }

            pub fn json(this: *ReadableStreamSourceType, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                JSC.markBinding(@src());
                this.this_jsvalue = callFrame.this();

                if (toBufferedValue) |to_buffered_value| {
                    return to_buffered_value(&this.context, globalThis, .json);
                }

                globalThis.throwTODO("This is not implemented yet");
                return .zero;
            }
        };
    };
}

pub const FileSink = struct {
    writer: IOWriter = .{},
    event_loop_handle: JSC.EventLoopHandle,
    written: usize = 0,
    ref_count: u32 = 1,
    pending: StreamResult.Writable.Pending = .{
        .result = .{ .done = {} },
    },
    signal: Signal = Signal{},
    done: bool = false,
    started: bool = false,
    must_be_kept_alive_until_eof: bool = false,

    // TODO: these fields are duplicated on writer()
    // we should not duplicate these fields...
    pollable: bool = false,
    nonblocking: bool = false,
    force_sync_on_windows: bool = false,
    is_socket: bool = false,
    fd: bun.FileDescriptor = bun.invalid_fd,
    has_js_called_unref: bool = false,

    const log = Output.scoped(.FileSink, false);

    pub usingnamespace bun.NewRefCounted(FileSink, deinit);

    pub const IOWriter = bun.io.StreamingWriter(@This(), onWrite, onError, onReady, onClose);
    pub const Poll = IOWriter;

    pub fn memoryCost(this: *const FileSink) usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(FileSink).
        return this.writer.memoryCost();
    }

    fn Bun__ForceFileSinkToBeSynchronousOnWindows(globalObject: *JSC.JSGlobalObject, jsvalue: JSC.JSValue) callconv(.C) void {
        comptime bun.assert(Environment.isWindows);

        var this: *FileSink = @alignCast(@ptrCast(JSSink.fromJS(globalObject, jsvalue) orelse return));
        this.force_sync_on_windows = true;
    }

    comptime {
        if (Environment.isWindows) {
            @export(Bun__ForceFileSinkToBeSynchronousOnWindows, .{ .name = "Bun__ForceFileSinkToBeSynchronousOnWindows" });
        }
    }

    pub fn onAttachedProcessExit(this: *FileSink) void {
        log("onAttachedProcessExit()", .{});
        this.done = true;
        this.writer.close();

        this.pending.result = .{ .err = Syscall.Error.fromCode(.PIPE, .write) };

        this.runPending();

        if (this.must_be_kept_alive_until_eof) {
            this.must_be_kept_alive_until_eof = false;
            this.deref();
        }
    }

    fn runPending(this: *FileSink) void {
        this.ref();
        defer this.deref();

        const l = this.eventLoop();
        l.enter();
        defer l.exit();
        this.pending.run();
    }

    pub fn onWrite(this: *FileSink, amount: usize, status: bun.io.WriteStatus) void {
        log("onWrite({d}, {any})", .{ amount, status });

        this.written += amount;

        // TODO: on windows done means ended (no pending data on the buffer) on unix we can still have pending data on the buffer
        // we should unify the behaviors to simplify this
        const has_pending_data = this.writer.hasPendingData();
        // Only keep the event loop ref'd while there's a pending write in progress.
        // If there's no pending write, no need to keep the event loop ref'd.
        this.writer.updateRef(this.eventLoop(), has_pending_data);

        // if we are not done yet and has pending data we just wait so we do not runPending twice
        if (status == .pending and has_pending_data) {
            if (this.pending.state == .pending) {
                this.pending.consumed = @truncate(amount);
            }
            return;
        }

        if (this.pending.state == .pending) {
            this.pending.consumed = @truncate(amount);

            // when "done" is true, we will never receive more data.
            if (this.done or status == .end_of_file) {
                this.pending.result = .{ .owned_and_done = this.pending.consumed };
            } else {
                this.pending.result = .{ .owned = this.pending.consumed };
            }

            this.runPending();

            // this.done == true means ended was called
            const ended_and_done = this.done and status == .end_of_file;

            if (this.done and status == .drained) {
                // if we call end/endFromJS and we have some pending returned from .flush() we should call writer.end()
                this.writer.end();
            } else if (ended_and_done and !has_pending_data) {
                this.writer.close();
            }
        }

        if (status == .end_of_file) {
            if (this.must_be_kept_alive_until_eof) {
                this.must_be_kept_alive_until_eof = false;
                this.deref();
            }
            this.signal.close(null);
        }
    }

    pub fn onError(this: *FileSink, err: bun.sys.Error) void {
        log("onError({any})", .{err});
        if (this.pending.state == .pending) {
            this.pending.result = .{ .err = err };

            this.runPending();
        }
    }

    pub fn onReady(this: *FileSink) void {
        log("onReady()", .{});

        this.signal.ready(null, null);
    }

    pub fn onClose(this: *FileSink) void {
        log("onClose()", .{});
        this.signal.close(null);
    }

    pub fn createWithPipe(
        event_loop_: anytype,
        pipe: *uv.Pipe,
    ) *FileSink {
        if (Environment.isPosix) {
            @compileError("FileSink.createWithPipe is only available on Windows");
        }

        const evtloop = switch (@TypeOf(event_loop_)) {
            JSC.EventLoopHandle => event_loop_,
            else => JSC.EventLoopHandle.init(event_loop_),
        };

        var this = FileSink.new(.{
            .event_loop_handle = JSC.EventLoopHandle.init(evtloop),
            .fd = pipe.fd(),
        });
        this.writer.setPipe(pipe);
        this.writer.setParent(this);
        return this;
    }

    pub fn create(
        event_loop_: anytype,
        fd: bun.FileDescriptor,
    ) *FileSink {
        const evtloop = switch (@TypeOf(event_loop_)) {
            JSC.EventLoopHandle => event_loop_,
            else => JSC.EventLoopHandle.init(event_loop_),
        };
        var this = FileSink.new(.{
            .event_loop_handle = JSC.EventLoopHandle.init(evtloop),
            .fd = fd,
        });
        this.writer.setParent(this);
        return this;
    }

    pub fn setup(this: *FileSink, options: *const StreamStart.FileSinkOptions) JSC.Maybe(void) {
        // TODO: this should be concurrent.
        var isatty: ?bool = null;
        var is_nonblocking_tty = false;
        const fd = switch (switch (options.input_path) {
            .path => |path| bun.sys.openA(path.slice(), options.flags(), options.mode),
            .fd => |fd_| brk: {
                if (comptime Environment.isPosix and FeatureFlags.nonblocking_stdout_and_stderr_on_posix) {
                    if (bun.FDTag.get(fd_) != .none) {
                        const rc = bun.C.open_as_nonblocking_tty(@intCast(fd_.cast()), bun.O.WRONLY);
                        if (rc > -1) {
                            isatty = true;
                            is_nonblocking_tty = true;
                            break :brk JSC.Maybe(bun.FileDescriptor){ .result = bun.toFD(rc) };
                        }
                    }
                }

                break :brk bun.sys.dupWithFlags(fd_, if (bun.FDTag.get(fd_) == .none and !this.force_sync_on_windows) bun.O.NONBLOCK else 0);
            },
        }) {
            .err => |err| return .{ .err = err },
            .result => |fd| fd,
        };

        if (comptime Environment.isPosix) {
            switch (bun.sys.fstat(fd)) {
                .err => |err| {
                    _ = bun.sys.close(fd);
                    return .{ .err = err };
                },
                .result => |stat| {
                    this.pollable = bun.sys.isPollable(stat.mode);
                    if (!this.pollable and isatty == null) {
                        isatty = std.posix.isatty(fd.int());
                    }

                    if (isatty) |is| {
                        if (is)
                            this.pollable = true;
                    }

                    this.fd = fd;
                    this.is_socket = std.posix.S.ISSOCK(stat.mode);
                    this.nonblocking = is_nonblocking_tty or (this.pollable and switch (options.input_path) {
                        .path => true,
                        .fd => |fd_| bun.FDTag.get(fd_) == .none,
                    });
                },
            }
        } else if (comptime Environment.isWindows) {
            this.pollable = (bun.windows.GetFileType(fd.cast()) & bun.windows.FILE_TYPE_PIPE) != 0 and !this.force_sync_on_windows;
            this.fd = fd;
        } else {
            @compileError("TODO: implement for this platform");
        }

        if (comptime Environment.isWindows) {
            if (this.force_sync_on_windows) {
                switch (this.writer.startSync(
                    fd,
                    this.pollable,
                )) {
                    .err => |err| {
                        _ = bun.sys.close(fd);
                        return .{ .err = err };
                    },
                    .result => {
                        this.writer.updateRef(this.eventLoop(), false);
                    },
                }
                return .{ .result = {} };
            }
        }

        switch (this.writer.start(
            fd,
            this.pollable,
        )) {
            .err => |err| {
                _ = bun.sys.close(fd);
                return .{ .err = err };
            },
            .result => {
                // Only keep the event loop ref'd while there's a pending write in progress.
                // If there's no pending write, no need to keep the event loop ref'd.
                this.writer.updateRef(this.eventLoop(), false);
                if (comptime Environment.isPosix) {
                    if (this.nonblocking) {
                        this.writer.getPoll().?.flags.insert(.nonblocking);
                    }

                    if (this.is_socket) {
                        this.writer.getPoll().?.flags.insert(.socket);
                    } else if (this.pollable) {
                        this.writer.getPoll().?.flags.insert(.fifo);
                    }
                }
            },
        }

        return .{ .result = {} };
    }

    pub fn loop(this: *FileSink) *Async.Loop {
        return this.event_loop_handle.loop();
    }

    pub fn eventLoop(this: *FileSink) JSC.EventLoopHandle {
        return this.event_loop_handle;
    }

    pub fn connect(this: *FileSink, signal: Signal) void {
        this.signal = signal;
    }

    pub fn start(this: *FileSink, stream_start: StreamStart) JSC.Maybe(void) {
        switch (stream_start) {
            .FileSink => |*file| {
                switch (this.setup(file)) {
                    .err => |err| {
                        return .{ .err = err };
                    },
                    .result => {},
                }
            },
            else => {},
        }

        this.done = false;
        this.started = true;
        this.signal.start();
        return .{ .result = {} };
    }

    pub fn flush(_: *FileSink) JSC.Maybe(void) {
        return .{ .result = {} };
    }

    pub fn flushFromJS(this: *FileSink, globalThis: *JSGlobalObject, wait: bool) JSC.Maybe(JSValue) {
        _ = wait; // autofix
        if (this.pending.state == .pending) {
            return .{ .result = this.pending.future.promise.value() };
        }

        if (this.done) {
            return .{ .result = .undefined };
        }

        const rc = this.writer.flush();
        switch (rc) {
            .done => |written| {
                this.written += @truncate(written);
            },
            .pending => |written| {
                this.written += @truncate(written);
            },
            .wrote => |written| {
                this.written += @truncate(written);
            },
            .err => |err| {
                return .{ .err = err };
            },
        }
        return switch (this.toResult(rc)) {
            .err => unreachable,
            else => |result| .{ .result = result.toJS(globalThis) },
        };
    }

    pub fn finalize(this: *FileSink) void {
        this.pending.deinit();
        this.deref();
    }

    pub fn init(fd: bun.FileDescriptor, event_loop_handle: anytype) *FileSink {
        var this = FileSink.new(.{
            .writer = .{},
            .fd = fd,
            .event_loop_handle = JSC.EventLoopHandle.init(event_loop_handle),
        });
        this.writer.setParent(this);

        return this;
    }

    pub fn construct(
        this: *FileSink,
        allocator: std.mem.Allocator,
    ) void {
        _ = allocator; // autofix
        this.* = FileSink{
            .event_loop_handle = JSC.EventLoopHandle.init(JSC.VirtualMachine.get().eventLoop()),
        };
    }

    pub fn write(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.done) {
            return .{ .done = {} };
        }

        return this.toResult(this.writer.write(data.slice()));
    }
    pub const writeBytes = write;
    pub fn writeLatin1(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.done) {
            return .{ .done = {} };
        }

        return this.toResult(this.writer.writeLatin1(data.slice()));
    }
    pub fn writeUTF16(this: *@This(), data: StreamResult) StreamResult.Writable {
        if (this.done) {
            return .{ .done = {} };
        }

        return this.toResult(this.writer.writeUTF16(data.slice16()));
    }

    pub fn end(this: *FileSink, err: ?Syscall.Error) JSC.Maybe(void) {
        if (this.done) {
            return .{ .result = {} };
        }

        _ = err; // autofix

        switch (this.writer.flush()) {
            .done => |written| {
                this.written += @truncate(written);
                this.writer.end();
                return .{ .result = {} };
            },
            .err => |e| {
                this.writer.close();
                return .{ .err = e };
            },
            .pending => |written| {
                this.written += @truncate(written);
                if (!this.must_be_kept_alive_until_eof) {
                    this.must_be_kept_alive_until_eof = true;
                    this.ref();
                }
                this.done = true;
                return .{ .result = {} };
            },
            .wrote => |written| {
                this.written += @truncate(written);
                this.writer.end();
                return .{ .result = {} };
            },
        }
    }
    pub fn deinit(this: *FileSink) void {
        this.pending.deinit();
        this.writer.deinit();
    }

    pub fn toJS(this: *FileSink, globalThis: *JSGlobalObject) JSValue {
        return JSSink.createObject(globalThis, this, 0);
    }

    pub fn toJSWithDestructor(this: *FileSink, globalThis: *JSGlobalObject, destructor: ?SinkDestructor.Ptr) JSValue {
        return JSSink.createObject(globalThis, this, if (destructor) |dest| @intFromPtr(dest.ptr()) else 0);
    }

    pub fn endFromJS(this: *FileSink, globalThis: *JSGlobalObject) JSC.Maybe(JSValue) {
        if (this.done) {
            if (this.pending.state == .pending) {
                return .{ .result = this.pending.future.promise.value() };
            }

            return .{ .result = JSValue.jsNumber(this.written) };
        }

        switch (this.writer.flush()) {
            .done => |written| {
                this.updateRef(false);
                this.writer.end();
                return .{ .result = JSValue.jsNumber(written) };
            },
            .err => |err| {
                this.writer.close();
                return .{ .err = err };
            },
            .pending => |pending_written| {
                this.written += @truncate(pending_written);
                if (!this.must_be_kept_alive_until_eof) {
                    this.must_be_kept_alive_until_eof = true;
                    this.ref();
                }
                this.done = true;
                this.pending.result = .{ .owned = @truncate(pending_written) };
                return .{ .result = this.pending.promise(globalThis).asValue(globalThis) };
            },
            .wrote => |written| {
                this.writer.end();
                return .{ .result = JSValue.jsNumber(written) };
            },
        }
    }

    pub fn sink(this: *FileSink) Sink {
        return Sink.init(this);
    }

    pub fn updateRef(this: *FileSink, value: bool) void {
        this.has_js_called_unref = !value;
        if (value) {
            this.writer.enableKeepingProcessAlive(this.event_loop_handle);
        } else {
            this.writer.disableKeepingProcessAlive(this.event_loop_handle);
        }
    }

    pub const JSSink = NewJSSink(@This(), "FileSink");

    fn toResult(this: *FileSink, write_result: bun.io.WriteResult) StreamResult.Writable {
        switch (write_result) {
            .done => |amt| {
                if (amt > 0)
                    return .{ .owned_and_done = @truncate(amt) };

                return .{ .done = {} };
            },
            .wrote => |amt| {
                if (amt > 0)
                    return .{ .owned = @truncate(amt) };

                return .{ .temporary = @truncate(amt) };
            },
            .err => |err| {
                return .{ .err = err };
            },
            .pending => |pending_written| {
                if (!this.must_be_kept_alive_until_eof) {
                    this.must_be_kept_alive_until_eof = true;
                    this.ref();
                }
                this.pending.consumed += @truncate(pending_written);
                this.pending.result = .{ .owned = @truncate(pending_written) };
                return .{ .pending = &this.pending };
            },
        }
    }
};

pub const FileReader = struct {
    const log = Output.scoped(.FileReader, false);
    reader: IOReader = IOReader.init(FileReader),
    done: bool = false,
    pending: StreamResult.Pending = .{},
    pending_value: JSC.Strong = .{},
    pending_view: []u8 = &.{},
    fd: bun.FileDescriptor = bun.invalid_fd,
    start_offset: ?usize = null,
    max_size: ?usize = null,
    total_readed: usize = 0,
    started: bool = false,
    waiting_for_onReaderDone: bool = false,
    event_loop: JSC.EventLoopHandle,
    lazy: Lazy = .{ .none = {} },
    buffered: std.ArrayListUnmanaged(u8) = .{},
    read_inside_on_pull: ReadDuringJSOnPullResult = .{ .none = {} },
    highwater_mark: usize = 16384,
    has_js_called_unref: bool = false,

    pub const IOReader = bun.io.BufferedReader;
    pub const Poll = IOReader;
    pub const tag = ReadableStream.Tag.File;

    const ReadDuringJSOnPullResult = union(enum) {
        none: void,
        js: []u8,
        amount_read: usize,
        temporary: []const u8,
        use_buffered: usize,
    };

    pub const Lazy = union(enum) {
        none: void,
        blob: *Blob.Store,

        const OpenedFileBlob = struct {
            fd: bun.FileDescriptor,
            pollable: bool = false,
            nonblocking: bool = true,
            file_type: bun.io.FileType = .file,
        };

        pub fn openFileBlob(file: *Blob.FileStore) JSC.Maybe(OpenedFileBlob) {
            var this = OpenedFileBlob{ .fd = bun.invalid_fd };
            var file_buf: bun.PathBuffer = undefined;
            var is_nonblocking_tty = false;

            const fd = if (file.pathlike == .fd)
                if (file.pathlike.fd.isStdio()) brk: {
                    if (comptime Environment.isPosix) {
                        const rc = bun.C.open_as_nonblocking_tty(file.pathlike.fd.int(), bun.O.RDONLY);
                        if (rc > -1) {
                            is_nonblocking_tty = true;
                            file.is_atty = true;
                            break :brk bun.toFD(rc);
                        }
                    }
                    break :brk file.pathlike.fd;
                } else switch (Syscall.dupWithFlags(file.pathlike.fd, brk: {
                    if (comptime Environment.isPosix) {
                        if (bun.FDTag.get(file.pathlike.fd) == .none and !(file.is_atty orelse false)) {
                            break :brk bun.O.NONBLOCK;
                        }
                    }

                    break :brk 0;
                })) {
                    .result => |fd| switch (bun.sys.toLibUVOwnedFD(fd, .dup, .close_on_fail)) {
                        .result => |owned_fd| owned_fd,
                        .err => |err| {
                            return .{ .err = err };
                        },
                    },
                    .err => |err| {
                        return .{ .err = err.withFd(file.pathlike.fd) };
                    },
                }
            else switch (Syscall.open(file.pathlike.path.sliceZ(&file_buf), bun.O.RDONLY | bun.O.NONBLOCK | bun.O.CLOEXEC, 0)) {
                .result => |fd| fd,
                .err => |err| {
                    return .{ .err = err.withPath(file.pathlike.path.slice()) };
                },
            };

            if (comptime Environment.isPosix) {
                if ((file.is_atty orelse false) or
                    (fd.int() < 3 and std.posix.isatty(fd.cast())) or
                    (file.pathlike == .fd and
                    bun.FDTag.get(file.pathlike.fd) != .none and
                    std.posix.isatty(file.pathlike.fd.cast())))
                {
                    // var termios = std.mem.zeroes(std.posix.termios);
                    // _ = std.c.tcgetattr(fd.cast(), &termios);
                    // bun.C.cfmakeraw(&termios);
                    // _ = std.c.tcsetattr(fd.cast(), std.posix.TCSA.NOW, &termios);
                    file.is_atty = true;
                }

                const stat: bun.Stat = switch (Syscall.fstat(fd)) {
                    .result => |result| result,
                    .err => |err| {
                        _ = Syscall.close(fd);
                        return .{ .err = err };
                    },
                };

                if (bun.S.ISDIR(stat.mode)) {
                    bun.Async.Closer.close(fd, {});
                    return .{ .err = Syscall.Error.fromCode(.ISDIR, .fstat) };
                }

                this.pollable = bun.sys.isPollable(stat.mode) or is_nonblocking_tty or (file.is_atty orelse false);
                this.file_type = if (bun.S.ISFIFO(stat.mode))
                    .pipe
                else if (bun.S.ISSOCK(stat.mode))
                    .socket
                else
                    .file;

                // pretend it's a non-blocking pipe if it's a TTY
                if (is_nonblocking_tty and this.file_type != .socket) {
                    this.file_type = .nonblocking_pipe;
                }

                this.nonblocking = is_nonblocking_tty or (this.pollable and !(file.is_atty orelse false));

                if (this.nonblocking and this.file_type == .pipe) {
                    this.file_type = .nonblocking_pipe;
                }
            }

            this.fd = fd;

            return .{ .result = this };
        }
    };

    pub fn eventLoop(this: *const FileReader) JSC.EventLoopHandle {
        return this.event_loop;
    }

    pub fn loop(this: *const FileReader) *Async.Loop {
        return this.eventLoop().loop();
    }

    pub fn setup(
        this: *FileReader,
        fd: bun.FileDescriptor,
    ) void {
        this.* = FileReader{
            .reader = .{},
            .done = false,
            .fd = fd,
        };

        this.event_loop = this.parent().globalThis.bunVM().eventLoop();
    }

    pub fn onStart(this: *FileReader) StreamStart {
        this.reader.setParent(this);
        const was_lazy = this.lazy != .none;
        var pollable = false;
        var file_type: bun.io.FileType = .file;
        if (this.lazy == .blob) {
            switch (this.lazy.blob.data) {
                .s3, .bytes => @panic("Invalid state in FileReader: expected file "),
                .file => |*file| {
                    defer {
                        this.lazy.blob.deref();
                        this.lazy = .none;
                    }
                    switch (Lazy.openFileBlob(file)) {
                        .err => |err| {
                            this.fd = bun.invalid_fd;
                            return .{ .err = err };
                        },
                        .result => |opened| {
                            bun.assert(opened.fd.isValid());
                            this.fd = opened.fd;
                            pollable = opened.pollable;
                            file_type = opened.file_type;
                            this.reader.flags.nonblocking = opened.nonblocking;
                            this.reader.flags.pollable = pollable;
                        },
                    }
                },
            }
        }

        {
            const reader_fd = this.reader.getFd();
            if (reader_fd != bun.invalid_fd and this.fd == bun.invalid_fd) {
                this.fd = reader_fd;
            }
        }

        this.event_loop = JSC.EventLoopHandle.init(this.parent().globalThis.bunVM().eventLoop());

        if (was_lazy) {
            _ = this.parent().incrementCount();
            this.waiting_for_onReaderDone = true;
            if (this.start_offset) |offset| {
                switch (this.reader.startFileOffset(this.fd, pollable, offset)) {
                    .result => {},
                    .err => |e| {
                        return .{ .err = e };
                    },
                }
            } else {
                switch (this.reader.start(this.fd, pollable)) {
                    .result => {},
                    .err => |e| {
                        return .{ .err = e };
                    },
                }
            }
        } else if (comptime Environment.isPosix) {
            if (this.reader.flags.pollable and !this.reader.isDone()) {
                this.waiting_for_onReaderDone = true;
                _ = this.parent().incrementCount();
            }
        }

        if (comptime Environment.isPosix) {
            if (file_type == .socket) {
                this.reader.flags.socket = true;
            }

            if (this.reader.handle.getPoll()) |poll| {
                if (file_type == .socket or this.reader.flags.socket) {
                    poll.flags.insert(.socket);
                } else {
                    // if it's a TTY, we report it as a fifo
                    // we want the behavior to be as though it were a blocking pipe.
                    poll.flags.insert(.fifo);
                }

                if (this.reader.flags.nonblocking) {
                    poll.flags.insert(.nonblocking);
                }
            }
        }

        this.started = true;

        if (this.reader.isDone()) {
            this.consumeReaderBuffer();
            if (this.buffered.items.len > 0) {
                const buffered = this.buffered;
                this.buffered = .{};
                return .{ .owned_and_done = bun.ByteList.init(buffered.items) };
            }
        } else if (comptime Environment.isPosix) {
            if (!was_lazy and this.reader.flags.pollable) {
                this.reader.read();
            }
        }

        return .{ .ready = {} };
    }

    pub fn parent(this: *@This()) *Source {
        return @fieldParentPtr("context", this);
    }

    pub fn onCancel(this: *FileReader) void {
        if (this.done) return;
        this.done = true;
        this.reader.updateRef(false);
        if (!this.reader.isDone())
            this.reader.close();
    }

    pub fn deinit(this: *FileReader) void {
        this.buffered.deinit(bun.default_allocator);
        this.reader.updateRef(false);
        this.reader.deinit();
        this.pending_value.deinit();

        if (this.lazy != .none) {
            this.lazy.blob.deref();
            this.lazy = .none;
        }

        this.parent().destroy();
    }

    pub fn onReadChunk(this: *@This(), init_buf: []const u8, state: bun.io.ReadState) bool {
        var buf = init_buf;
        log("onReadChunk() = {d} ({s})", .{ buf.len, @tagName(state) });

        if (this.done) {
            this.reader.close();
            return false;
        }
        var close = false;
        defer if (close) this.reader.close();
        var hasMore = state != .eof;

        if (buf.len > 0) {
            if (this.max_size) |max_size| {
                if (this.total_readed >= max_size) return false;
                const len = @min(max_size - this.total_readed, buf.len);
                if (buf.len > len) {
                    buf = buf[0..len];
                }
                this.total_readed += len;

                if (buf.len == 0) {
                    close = true;
                    hasMore = false;
                }
            }
        }

        if (this.read_inside_on_pull != .none) {
            switch (this.read_inside_on_pull) {
                .js => |in_progress| {
                    if (in_progress.len >= buf.len and !hasMore) {
                        @memcpy(in_progress[0..buf.len], buf);
                        this.read_inside_on_pull = .{ .js = in_progress[buf.len..] };
                    } else if (in_progress.len > 0 and !hasMore) {
                        this.read_inside_on_pull = .{ .temporary = buf };
                    } else if (hasMore and !bun.isSliceInBuffer(buf, this.buffered.allocatedSlice())) {
                        this.buffered.appendSlice(bun.default_allocator, buf) catch bun.outOfMemory();
                        this.read_inside_on_pull = .{ .use_buffered = buf.len };
                    }
                },
                .use_buffered => |original| {
                    this.buffered.appendSlice(bun.default_allocator, buf) catch bun.outOfMemory();
                    this.read_inside_on_pull = .{ .use_buffered = buf.len + original };
                },
                .none => unreachable,
                else => @panic("Invalid state"),
            }
        } else if (this.pending.state == .pending) {
            if (buf.len == 0) {
                {
                    if (this.buffered.items.len == 0) {
                        if (this.buffered.capacity > 0) {
                            this.buffered.clearAndFree(bun.default_allocator);
                        }

                        if (this.reader.buffer().items.len != 0) {
                            this.buffered = this.reader.buffer().moveToUnmanaged();
                        }
                    }

                    var buffer = &this.buffered;
                    defer buffer.clearAndFree(bun.default_allocator);
                    if (buffer.items.len > 0) {
                        if (this.pending_view.len >= buffer.items.len) {
                            @memcpy(this.pending_view[0..buffer.items.len], buffer.items);
                            this.pending.result = .{ .into_array_and_done = .{ .value = this.pending_value.get() orelse .zero, .len = @truncate(buffer.items.len) } };
                        } else {
                            this.pending.result = .{ .owned_and_done = bun.ByteList.fromList(buffer.*) };
                            buffer.* = .{};
                        }
                    } else {
                        this.pending.result = .{ .done = {} };
                    }
                }
                this.pending_value.clear();
                this.pending_view = &.{};
                this.pending.run();
                return false;
            }

            const was_done = this.reader.isDone();

            if (this.pending_view.len >= buf.len) {
                @memcpy(this.pending_view[0..buf.len], buf);
                this.reader.buffer().clearRetainingCapacity();
                this.buffered.clearRetainingCapacity();

                if (was_done) {
                    this.pending.result = .{
                        .into_array_and_done = .{
                            .value = this.pending_value.get() orelse .zero,
                            .len = @truncate(buf.len),
                        },
                    };
                } else {
                    this.pending.result = .{
                        .into_array = .{
                            .value = this.pending_value.get() orelse .zero,
                            .len = @truncate(buf.len),
                        },
                    };
                }

                this.pending_value.clear();
                this.pending_view = &.{};
                this.pending.run();
                return !was_done;
            }

            if (!bun.isSliceInBuffer(buf, this.buffered.allocatedSlice())) {
                if (this.reader.isDone()) {
                    if (bun.isSliceInBuffer(buf, this.reader.buffer().allocatedSlice())) {
                        this.reader.buffer().* = std.ArrayList(u8).init(bun.default_allocator);
                    }
                    this.pending.result = .{
                        .temporary_and_done = bun.ByteList.init(buf),
                    };
                } else {
                    this.pending.result = .{
                        .temporary = bun.ByteList.init(buf),
                    };

                    if (bun.isSliceInBuffer(buf, this.reader.buffer().allocatedSlice())) {
                        this.reader.buffer().clearRetainingCapacity();
                    }
                }

                this.pending_value.clear();
                this.pending_view = &.{};
                this.pending.run();
                return !was_done;
            }

            if (this.reader.isDone()) {
                this.pending.result = .{
                    .owned_and_done = bun.ByteList.init(buf),
                };
            } else {
                this.pending.result = .{
                    .owned = bun.ByteList.init(buf),
                };
            }
            this.buffered = .{};
            this.pending_value.clear();
            this.pending_view = &.{};
            this.pending.run();
            return !was_done;
        } else if (!bun.isSliceInBuffer(buf, this.buffered.allocatedSlice())) {
            this.buffered.appendSlice(bun.default_allocator, buf) catch bun.outOfMemory();
            if (bun.isSliceInBuffer(buf, this.reader.buffer().allocatedSlice())) {
                this.reader.buffer().clearRetainingCapacity();
            }
        }

        // For pipes, we have to keep pulling or the other process will block.
        return this.read_inside_on_pull != .temporary and !(this.buffered.items.len + this.reader.buffer().items.len >= this.highwater_mark and !this.reader.flags.pollable);
    }

    fn isPulling(this: *const FileReader) bool {
        return this.read_inside_on_pull != .none;
    }

    pub fn onPull(this: *FileReader, buffer: []u8, array: JSC.JSValue) StreamResult {
        array.ensureStillAlive();
        defer array.ensureStillAlive();
        const drained = this.drain();

        if (drained.len > 0) {
            log("onPull({d}) = {d}", .{ buffer.len, drained.len });

            this.pending_value.clear();
            this.pending_view = &.{};

            if (buffer.len >= @as(usize, drained.len)) {
                @memcpy(buffer[0..drained.len], drained.slice());
                this.buffered.clearAndFree(bun.default_allocator);

                if (this.reader.isDone()) {
                    return .{ .into_array_and_done = .{ .value = array, .len = drained.len } };
                } else {
                    return .{ .into_array = .{ .value = array, .len = drained.len } };
                }
            }

            if (this.reader.isDone()) {
                return .{ .owned_and_done = drained };
            } else {
                return .{ .owned = drained };
            }
        }

        if (this.reader.isDone()) {
            return .{ .done = {} };
        }

        if (!this.reader.hasPendingRead()) {
            this.read_inside_on_pull = .{ .js = buffer };
            this.reader.read();

            defer this.read_inside_on_pull = .{ .none = {} };
            switch (this.read_inside_on_pull) {
                .js => |remaining_buf| {
                    const amount_read = buffer.len - remaining_buf.len;

                    log("onPull({d}) = {d}", .{ buffer.len, amount_read });

                    if (amount_read > 0) {
                        if (this.reader.isDone()) {
                            return .{ .into_array_and_done = .{ .value = array, .len = @truncate(amount_read) } };
                        }

                        return .{ .into_array = .{ .value = array, .len = @truncate(amount_read) } };
                    }

                    if (this.reader.isDone()) {
                        return .{ .done = {} };
                    }
                },
                .temporary => |buf| {
                    log("onPull({d}) = {d}", .{ buffer.len, buf.len });
                    if (this.reader.isDone()) {
                        return .{ .temporary_and_done = bun.ByteList.init(buf) };
                    }

                    return .{ .temporary = bun.ByteList.init(buf) };
                },
                .use_buffered => {
                    const buffered = this.buffered;
                    this.buffered = .{};
                    log("onPull({d}) = {d}", .{ buffer.len, buffered.items.len });
                    if (this.reader.isDone()) {
                        return .{ .owned_and_done = bun.ByteList.init(buffered.items) };
                    }

                    return .{ .owned = bun.ByteList.init(buffered.items) };
                },
                else => {},
            }

            if (this.reader.isDone()) {
                log("onPull({d}) = done", .{buffer.len});

                return .{ .done = {} };
            }
        }

        this.pending_value.set(this.parent().globalThis, array);
        this.pending_view = buffer;

        log("onPull({d}) = pending", .{buffer.len});

        return .{ .pending = &this.pending };
    }

    pub fn drain(this: *FileReader) bun.ByteList {
        if (this.buffered.items.len > 0) {
            const out = bun.ByteList.init(this.buffered.items);
            this.buffered = .{};
            if (comptime Environment.allow_assert) {
                bun.assert(this.reader.buffer().items.ptr != out.ptr);
            }
            return out;
        }

        if (this.reader.hasPendingRead()) {
            return .{};
        }

        const out = this.reader.buffer().*;
        this.reader.buffer().* = std.ArrayList(u8).init(bun.default_allocator);
        return bun.ByteList.fromList(out);
    }

    pub fn setRefOrUnref(this: *FileReader, enable: bool) void {
        if (this.done) return;
        this.has_js_called_unref = !enable;
        this.reader.updateRef(enable);
    }

    fn consumeReaderBuffer(this: *FileReader) void {
        if (this.buffered.capacity == 0) {
            this.buffered = this.reader.buffer().moveToUnmanaged();
        }
    }

    pub fn onReaderDone(this: *FileReader) void {
        log("onReaderDone()", .{});
        if (!this.isPulling()) {
            this.consumeReaderBuffer();
            if (this.pending.state == .pending) {
                if (this.buffered.items.len > 0) {
                    this.pending.result = .{ .owned_and_done = bun.ByteList.fromList(this.buffered) };
                } else {
                    this.pending.result = .{ .done = {} };
                }
                this.buffered = .{};
                this.pending.run();
            } else if (this.buffered.items.len > 0) {
                const this_value = this.parent().this_jsvalue;
                const globalThis = this.parent().globalThis;
                if (this_value != .zero) {
                    if (Source.onDrainCallbackGetCached(this_value)) |cb| {
                        const buffered = this.buffered;
                        this.buffered = .{};
                        this.parent().incrementCount();
                        defer _ = this.parent().decrementCount();
                        this.eventLoop().js.runCallback(
                            cb,
                            globalThis,
                            .undefined,
                            &.{
                                JSC.ArrayBuffer.fromBytes(
                                    buffered.items,
                                    .Uint8Array,
                                ).toJS(
                                    globalThis,
                                    null,
                                ),
                            },
                        );
                    }
                }
            }
        }

        this.parent().onClose();
        if (this.waiting_for_onReaderDone) {
            this.waiting_for_onReaderDone = false;
            _ = this.parent().decrementCount();
        }
    }

    pub fn onReaderError(this: *FileReader, err: bun.sys.Error) void {
        this.consumeReaderBuffer();

        this.pending.result = .{ .err = .{ .Error = err } };
        this.pending.run();
    }

    pub fn setRawMode(this: *FileReader, flag: bool) bun.sys.Maybe(void) {
        if (!Environment.isWindows) {
            @panic("FileReader.setRawMode must not be called on " ++ comptime Environment.os.displayString());
        }
        return this.reader.setRawMode(flag);
    }

    pub fn memoryCost(this: *const FileReader) usize {
        // ReadableStreamSource covers @sizeOf(FileReader)
        return this.reader.memoryCost();
    }

    pub const Source = ReadableStreamSource(
        @This(),
        "File",
        onStart,
        onPull,
        onCancel,
        deinit,
        setRefOrUnref,
        drain,
        memoryCost,
        null,
    );
};

pub const ByteBlobLoader = struct {
    offset: Blob.SizeType = 0,
    store: ?*Blob.Store = null,
    chunk_size: Blob.SizeType = 1024 * 1024 * 2,
    remain: Blob.SizeType = 1024 * 1024 * 2,
    done: bool = false,
    pulled: bool = false,

    pub const tag = ReadableStream.Tag.Blob;

    pub fn parent(this: *@This()) *Source {
        return @fieldParentPtr("context", this);
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
            .chunk_size = @min(
                if (user_chunk_size > 0) @min(user_chunk_size, blobe.size) else blobe.size,
                1024 * 1024 * 2,
            ),
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
        this.pulled = true;
        const store = this.store orelse return .{ .done = {} };
        if (this.done) {
            return .{ .done = {} };
        }

        var temporary = store.sharedView();
        temporary = temporary[@min(this.offset, temporary.len)..];

        temporary = temporary[0..@min(buffer.len, @min(temporary.len, this.remain))];
        if (temporary.len == 0) {
            this.clearStore();
            this.done = true;
            return .{ .done = {} };
        }

        const copied = @as(Blob.SizeType, @intCast(temporary.len));

        this.remain -|= copied;
        this.offset +|= copied;
        bun.assert(buffer.ptr != temporary.ptr);
        @memcpy(buffer[0..temporary.len], temporary);
        if (this.remain == 0) {
            return .{ .into_array_and_done = .{ .value = array, .len = copied } };
        }

        return .{ .into_array = .{ .value = array, .len = copied } };
    }

    pub fn toAnyBlob(this: *ByteBlobLoader, globalThis: *JSC.JSGlobalObject) ?AnyBlob {
        if (this.store) |store| {
            _ = this.detachStore();
            if (this.offset == 0 and this.remain == store.size()) {
                if (store.toAnyBlob()) |blob| {
                    defer store.deref();
                    return blob;
                }
            }

            var blob = JSC.WebCore.Blob.initWithStore(store, globalThis);
            blob.offset = this.offset;
            blob.size = this.remain;
            this.parent().is_closed = true;
            return .{ .Blob = blob };
        }
        return null;
    }

    pub fn detachStore(this: *ByteBlobLoader) ?*Blob.Store {
        if (this.store) |store| {
            this.store = null;
            this.done = true;
            return store;
        }
        return null;
    }

    pub fn onCancel(this: *ByteBlobLoader) void {
        this.clearStore();
    }

    pub fn deinit(this: *ByteBlobLoader) void {
        this.clearStore();

        this.parent().destroy();
    }

    fn clearStore(this: *ByteBlobLoader) void {
        if (this.store) |store| {
            this.store = null;
            store.deref();
        }
    }

    pub fn drain(this: *ByteBlobLoader) bun.ByteList {
        const store = this.store orelse return .{};
        var temporary = store.sharedView();
        temporary = temporary[this.offset..];
        temporary = temporary[0..@min(16384, @min(temporary.len, this.remain))];

        const cloned = bun.ByteList.init(temporary).listManaged(bun.default_allocator).clone() catch bun.outOfMemory();
        this.offset +|= @as(Blob.SizeType, @truncate(cloned.items.len));
        this.remain -|= @as(Blob.SizeType, @truncate(cloned.items.len));

        return bun.ByteList.fromList(cloned);
    }

    pub fn toBufferedValue(this: *ByteBlobLoader, globalThis: *JSC.JSGlobalObject, action: BufferedReadableStreamAction) bun.JSError!JSC.JSValue {
        if (this.toAnyBlob(globalThis)) |blob_| {
            var blob = blob_;
            return blob.toPromise(globalThis, action);
        }

        return .zero;
    }

    pub fn memoryCost(this: *const ByteBlobLoader) usize {
        // ReadableStreamSource covers @sizeOf(FileReader)
        if (this.store) |store| {
            return store.memoryCost();
        }
        return 0;
    }

    pub const Source = ReadableStreamSource(
        @This(),
        "Blob",
        onStart,
        onPull,
        onCancel,
        deinit,
        null,
        drain,
        memoryCost,
        toBufferedValue,
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
    buffer_action: ?BufferAction = null,

    const log = Output.scoped(.ByteStream, false);

    const BufferAction = union(BufferedReadableStreamAction) {
        text: JSC.JSPromise.Strong,
        arrayBuffer: JSC.JSPromise.Strong,
        blob: JSC.JSPromise.Strong,
        bytes: JSC.JSPromise.Strong,
        json: JSC.JSPromise.Strong,

        pub fn fulfill(this: *BufferAction, blob: *AnyBlob) void {
            blob.wrap(.{ .normal = this.swap() }, this.globalThis().?, this.*);
        }

        pub fn reject(this: *BufferAction, err: StreamResult.StreamError) void {
            this.swap().reject(this.globalThis().?, err.toJSWeak(this.globalThis().?)[0]);
        }

        pub fn resolve(this: *BufferAction, value_: JSC.JSValue) void {
            this.swap().resolve(this.globalThis().?, value_);
        }

        pub fn globalThis(this: *BufferAction) ?*JSC.JSGlobalObject {
            return switch (this.*) {
                inline else => |promise| promise.strong.globalThis,
            };
        }

        pub fn value(this: *BufferAction) JSC.JSValue {
            return switch (this.*) {
                inline else => |promise| promise.value(),
            };
        }

        pub fn get(this: *BufferAction) *JSC.JSPromise {
            return switch (this.*) {
                inline else => |promise| promise.get(),
            };
        }

        pub fn swap(this: *BufferAction) *JSC.JSPromise {
            return switch (this.*) {
                inline else => |*promise| promise.swap(),
            };
        }

        pub fn deinit(this: *BufferAction) void {
            switch (this.*) {
                inline else => |*promise| promise.deinit(),
            }
        }
    };

    pub const tag = ReadableStream.Tag.Bytes;

    pub fn setup(this: *ByteStream) void {
        this.* = .{};
    }

    pub fn onStart(this: *@This()) StreamStart {
        if (this.has_received_last_chunk and this.buffer.items.len == 0) {
            return .{ .empty = {} };
        }

        if (this.has_received_last_chunk) {
            return .{ .owned_and_done = bun.ByteList.fromList(this.buffer.moveToUnmanaged()) };
        }

        if (this.highWaterMark == 0) {
            return .{ .ready = {} };
        }

        // For HTTP, the maximum streaming response body size will be 512 KB.
        // #define LIBUS_RECV_BUFFER_LENGTH 524288
        // For HTTPS, the size is probably quite a bit lower like 64 KB due to TLS transmission.
        // We add 1 extra page size so that if there's a little bit of excess buffered data, we avoid extra allocations.
        return .{ .chunk_size = @min(512 * 1024 + std.mem.page_size, @max(this.highWaterMark, std.mem.page_size)) };
    }

    pub fn value(this: *@This()) JSValue {
        const result = this.pending_value.get() orelse {
            return .zero;
        };
        this.pending_value.clear();
        return result;
    }

    pub fn isCancelled(this: *const @This()) bool {
        return this.parent().cancelled;
    }

    pub fn unpipeWithoutDeref(this: *@This()) void {
        this.pipe.ctx = null;
        this.pipe.onPipe = null;
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
            this.has_received_last_chunk = stream.isDone();

            log("ByteStream.onData already done... do nothing", .{});

            return;
        }

        bun.assert(!this.has_received_last_chunk or stream == .err);
        this.has_received_last_chunk = stream.isDone();

        if (this.pipe.ctx) |ctx| {
            this.pipe.onPipe.?(ctx, stream, allocator);
            return;
        }

        const chunk = stream.slice();

        if (this.buffer_action) |*action| {
            if (stream == .err) {
                defer {
                    this.buffer.clearAndFree();
                    this.pending.result.deinit();
                    this.pending.result = .{ .done = {} };
                    this.buffer_action = null;
                }

                log("ByteStream.onData err  action.reject()", .{});

                action.reject(stream.err);
                return;
            }

            if (this.has_received_last_chunk) {
                defer {
                    this.buffer_action = null;
                }

                if (this.buffer.capacity == 0 and stream == .done) {
                    log("ByteStream.onData done and action.fulfill()", .{});

                    var blob = this.toAnyBlob().?;
                    action.fulfill(&blob);
                    return;
                }
                if (this.buffer.capacity == 0 and stream == .owned_and_done) {
                    log("ByteStream.onData owned_and_done and action.fulfill()", .{});

                    this.buffer = std.ArrayList(u8).fromOwnedSlice(bun.default_allocator, @constCast(chunk));
                    var blob = this.toAnyBlob().?;
                    action.fulfill(&blob);
                    return;
                }
                defer {
                    if (stream == .owned_and_done or stream == .owned) {
                        allocator.free(stream.slice());
                    }
                }
                log("ByteStream.onData appendSlice and action.fulfill()", .{});

                this.buffer.appendSlice(chunk) catch bun.outOfMemory();
                var blob = this.toAnyBlob().?;
                action.fulfill(&blob);

                return;
            } else {
                this.buffer.appendSlice(chunk) catch bun.outOfMemory();

                if (stream == .owned_and_done or stream == .owned) {
                    allocator.free(stream.slice());
                }
            }

            return;
        }

        if (this.pending.state == .pending) {
            bun.assert(this.buffer.items.len == 0);
            const to_copy = this.pending_buffer[0..@min(chunk.len, this.pending_buffer.len)];
            const pending_buffer_len = this.pending_buffer.len;
            bun.assert(to_copy.ptr != chunk.ptr);
            @memcpy(to_copy, chunk[0..to_copy.len]);
            this.pending_buffer = &.{};

            const is_really_done = this.has_received_last_chunk and to_copy.len <= pending_buffer_len;

            if (is_really_done) {
                this.done = true;

                if (to_copy.len == 0) {
                    if (stream == .err) {
                        this.pending.result = .{
                            .err = stream.err,
                        };
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
            if (remaining.len > 0 and chunk.len > 0)
                this.append(stream, to_copy.len, chunk, allocator) catch @panic("Out of memory while copying request body");

            log("ByteStream.onData pending.run()", .{});

            this.pending.run();

            return;
        }

        log("ByteStream.onData no action just append", .{});

        this.append(stream, 0, chunk, allocator) catch @panic("Out of memory while copying request body");
    }

    pub fn append(
        this: *@This(),
        stream: StreamResult,
        offset: usize,
        base_address: []const u8,
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
                .done => {},
                else => unreachable,
            }
            return;
        }

        switch (stream) {
            .temporary_and_done, .temporary => {
                try this.buffer.appendSlice(chunk);
            },
            .owned_and_done, .owned => {
                try this.buffer.appendSlice(chunk);
                allocator.free(@constCast(base_address));
            },
            .err => {
                if (this.buffer_action != null) {
                    @panic("Expected buffer action to be null");
                }

                this.pending.result = .{ .err = stream.err };
            },
            .done => {},
            // We don't support the rest of these yet
            else => unreachable,
        }

        return;
    }

    pub fn setValue(this: *@This(), view: JSC.JSValue) void {
        JSC.markBinding(@src());
        this.pending_value.set(this.parent().globalThis, view);
    }

    pub fn parent(this: *@This()) *Source {
        return @fieldParentPtr("context", this);
    }

    pub fn onPull(this: *@This(), buffer: []u8, view: JSC.JSValue) StreamResult {
        JSC.markBinding(@src());
        bun.assert(buffer.len > 0);
        bun.debugAssert(this.buffer_action == null);

        if (this.buffer.items.len > 0) {
            bun.assert(this.value() == .zero);
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
            this.pending.result.deinit();
            this.pending.result = .{ .done = {} };
            this.pending.run();
        }

        if (this.buffer_action) |*action| {
            action.reject(.{ .AbortReason = .UserAbort });
            this.buffer_action = null;
        }
    }

    pub fn memoryCost(this: *const @This()) usize {
        // ReadableStreamSource covers @sizeOf(ByteStream)
        return this.buffer.capacity;
    }

    pub fn deinit(this: *@This()) void {
        JSC.markBinding(@src());
        if (this.buffer.capacity > 0) this.buffer.clearAndFree();

        this.pending_value.deinit();
        if (!this.done) {
            this.done = true;

            this.pending_buffer = &.{};
            this.pending.result.deinit();
            this.pending.result = .{ .done = {} };
            this.pending.run();
        }
        if (this.buffer_action) |*action| {
            action.deinit();
        }
        this.parent().destroy();
    }

    pub fn drain(this: *@This()) bun.ByteList {
        if (this.buffer.items.len > 0) {
            const out = bun.ByteList.fromList(this.buffer);
            this.buffer = .{
                .allocator = bun.default_allocator,
                .items = &.{},
                .capacity = 0,
            };

            return out;
        }

        return .{};
    }

    pub fn toAnyBlob(this: *@This()) ?AnyBlob {
        if (this.has_received_last_chunk) {
            const buffer = this.buffer;
            this.buffer = .{
                .allocator = bun.default_allocator,
                .items = &.{},
                .capacity = 0,
            };
            this.done = true;
            this.pending.result.deinit();
            this.pending.result = .{ .done = {} };
            this.parent().is_closed = true;
            return AnyBlob{
                .InternalBlob = JSC.WebCore.InternalBlob{
                    .bytes = buffer,
                    .was_string = false,
                },
            };
        }

        return null;
    }

    pub fn toBufferedValue(this: *@This(), globalThis: *JSC.JSGlobalObject, action: BufferedReadableStreamAction) bun.JSError!JSC.JSValue {
        if (this.buffer_action != null) {
            return globalThis.throw("Cannot buffer value twice", .{});
        }

        if (this.pending.result == .err) {
            const err, _ = this.pending.result.err.toJSWeak(globalThis);
            this.pending.result.deinit();
            this.done = true;
            this.buffer.clearAndFree();
            return JSC.JSPromise.rejectedPromiseValue(globalThis, err);
        }

        if (this.toAnyBlob()) |blob_| {
            var blob = blob_;
            return blob.toPromise(globalThis, action);
        }

        this.buffer_action = switch (action) {
            .blob => .{ .blob = JSC.JSPromise.Strong.init(globalThis) },
            .bytes => .{ .bytes = JSC.JSPromise.Strong.init(globalThis) },
            .arrayBuffer => .{ .arrayBuffer = JSC.JSPromise.Strong.init(globalThis) },
            .json => .{ .json = JSC.JSPromise.Strong.init(globalThis) },
            .text => .{ .text = JSC.JSPromise.Strong.init(globalThis) },
        };

        return this.buffer_action.?.value();
    }

    pub const Source = ReadableStreamSource(
        @This(),
        "Bytes",
        onStart,
        onPull,
        onCancel,
        deinit,
        null,
        drain,
        memoryCost,
        toBufferedValue,
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

// Linux default pipe size is 16 pages of memory
const default_fifo_chunk_size = 64 * 1024;
const default_file_chunk_size = 1024 * 1024 * 2;

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

            bun.assert(this.poll_ref.?.fd == fd_);
            bun.assert(
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
            bun.assert(poll_ref.fd == fd);
            bun.assert(!this.isWatching());
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
