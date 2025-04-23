const ReadableStream = @This();

value: JSValue,
ptr: Source,

pub const Strong = struct {
    held: JSC.Strong.Optional = .empty,

    pub fn has(this: *Strong) bool {
        return this.held.has();
    }

    pub fn isDisturbed(this: *const Strong, global: *JSC.JSGlobalObject) bool {
        if (this.get(global)) |stream| {
            return stream.isDisturbed(global);
        }

        return false;
    }

    pub fn init(this: ReadableStream, global: *JSGlobalObject) Strong {
        return .{
            .held = .create(this.value, global),
        };
    }

    pub fn get(this: *const Strong, global: *JSC.JSGlobalObject) ?ReadableStream {
        if (this.held.get()) |value| {
            return ReadableStream.fromJS(value, global);
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
        if (this.get(global)) |stream| {
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
) ?Blob.Any {
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
                var blob = Blob.initWithStore(blobby.lazy.blob, globalThis);
                blob.store.?.ref();
                // it should be lazy, file shouldn't have opened yet.
                bun.assert(!blobby.started);
                stream.done(globalThis);
                return .{ .Blob = blob };
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
    Blob: *webcore.ByteBlobLoader,

    /// ReadableByteStreamController
    /// but with a FileLoader
    /// we can skip the FileLoader and just use the underlying File
    File: *webcore.FileReader,

    /// This is a direct readable stream
    /// That means we can turn it into whatever we want
    Direct: void,

    Bytes: *webcore.ByteStream,
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
            var reader = webcore.ByteBlobLoader.Source.new(
                .{
                    .globalThis = globalThis,
                    .context = undefined,
                },
            );
            reader.context.setup(blob, recommended_chunk_size);
            return reader.toReadableStream(globalThis);
        },
        .file => {
            var reader = webcore.FileReader.Source.new(.{
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
            var reader = webcore.FileReader.Source.new(.{
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
    var source = webcore.FileReader.Source.new(.{
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

pub fn NewSource(
    comptime Context: type,
    comptime name_: []const u8,
    comptime onStart: anytype,
    comptime onPull: anytype,
    comptime onCancel: fn (this: *Context) void,
    comptime deinit_fn: fn (this: *Context) void,
    comptime setRefUnrefFn: ?fn (this: *Context, enable: bool) void,
    comptime drainInternalBuffer: ?fn (this: *Context) bun.ByteList,
    comptime memoryCostFn: ?fn (this: *const Context) usize,
    comptime toBufferedValue: ?fn (this: *Context, globalThis: *JSC.JSGlobalObject, action: streams.BufferAction.Tag) bun.JSError!JSC.JSValue,
) type {
    return struct {
        context: Context,
        cancelled: bool = false,
        ref_count: u32 = 1,
        pending_err: ?Syscall.Error = null,
        close_handler: ?*const fn (?*anyopaque) void = null,
        close_ctx: ?*anyopaque = null,
        close_jsvalue: JSC.Strong.Optional = .empty,
        globalThis: *JSGlobalObject = undefined,
        this_jsvalue: JSC.JSValue = .zero,
        is_closed: bool = false,

        const This = @This();
        const ReadableStreamSourceType = @This();

        pub const new = bun.TrivialNew(@This());
        pub const deinit = bun.TrivialDeinit(@This());

        pub fn pull(this: *This, buf: []u8) streams.Result {
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

        pub fn start(this: *This) streams.Start {
            return onStart(&this.context);
        }

        pub fn onPullFromJS(this: *This, buf: []u8, view: JSValue) streams.Result {
            return onPull(&this.context, buf, view);
        }

        pub fn onStartFromJS(this: *This) streams.Start {
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

        pub const js = @field(JSC.Codegen, "JS" ++ name_ ++ "InternalReadableStreamSource");
        pub const toJS = js.toJS;
        pub const fromJS = js.fromJS;
        pub const fromJSDirect = js.fromJSDirect;

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

            fn processResult(this_jsvalue: JSC.JSValue, globalThis: *JSGlobalObject, flags: JSValue, result: streams.Result) bun.JSError!JSC.JSValue {
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
                        js.pendingPromiseSetCached(this_jsvalue, globalThis, out);
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

                if (!value.isCallable()) {
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
                    js.onDrainCallbackSetCached(this.this_jsvalue, globalObject, .undefined);
                    return true;
                }

                if (!value.isCallable()) {
                    globalObject.throwInvalidArgumentType("ReadableStreamSource", "onDrain", "function") catch {};
                    return false;
                }
                const cb = value.withAsyncContextIfNeeded(globalObject);
                js.onDrainCallbackSetCached(this.this_jsvalue, globalObject, cb);
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

                if (js.onDrainCallbackGetCached(this.this_jsvalue)) |val| {
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

                this.close_jsvalue.deinit();
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

const bun = @import("bun");
const Environment = bun.Environment;
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Syscall = bun.sys;
const webcore = bun.webcore;
const streams = webcore.streams;
const Blob = webcore.Blob;
