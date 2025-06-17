const Sink = @This();

ptr: *anyopaque,
vtable: VTable,
status: Status = Status.closed,
used: bool = false,

pub const ArrayBufferSink = @import("ArrayBufferSink.zig");

pub const pending = Sink{
    .ptr = @as(*anyopaque, @ptrFromInt(0xaaaaaaaa)),
    .vtable = undefined,
};

pub const Status = enum {
    ready,
    closed,
};

pub const Data = union(enum) {
    utf16: streams.Result,
    latin1: streams.Result,
    bytes: streams.Result,
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
    pub fn writeLatin1(comptime Ctx: type, ctx: *Ctx, input: streams.Result, comptime writeFn: anytype) streams.Result.Writable {
        const str = input.slice();
        if (bun.strings.isAllASCII(str)) {
            return writeFn(
                ctx,
                input,
            );
        }

        if (stack_size >= str.len) {
            var buf: [stack_size]u8 = undefined;
            @memcpy(buf[0..str.len], str);

            bun.strings.replaceLatin1WithUTF8(buf[0..str.len]);
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

            bun.strings.replaceLatin1WithUTF8(slice[0..str.len]);
            if (input.isDone()) {
                return writeFn(ctx, .{ .owned_and_done = bun.ByteList.init(slice) });
            } else {
                return writeFn(ctx, .{ .owned = bun.ByteList.init(slice) });
            }
        }
    }

    pub fn writeUTF16(comptime Ctx: type, ctx: *Ctx, input: streams.Result, comptime writeFn: anytype) streams.Result.Writable {
        const str: []const u16 = std.mem.bytesAsSlice(u16, input.slice());

        if (stack_size >= str.len * 2) {
            var buf: [stack_size]u8 = undefined;
            const copied = bun.strings.copyUTF16IntoUTF8(&buf, []const u16, str, true);
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
            const allocated = bun.strings.toUTF8Alloc(bun.default_allocator, str) catch return .{ .err = Syscall.Error.oom };
            if (input.isDone()) {
                return writeFn(ctx, .{ .owned_and_done = bun.ByteList.init(allocated) });
            } else {
                return writeFn(ctx, .{ .owned = bun.ByteList.init(allocated) });
            }
        }
    }
};

pub const VTable = struct {
    pub const WriteUTF16Fn = *const (fn (this: *anyopaque, data: streams.Result) streams.Result.Writable);
    pub const WriteUTF8Fn = *const (fn (this: *anyopaque, data: streams.Result) streams.Result.Writable);
    pub const WriteLatin1Fn = *const (fn (this: *anyopaque, data: streams.Result) streams.Result.Writable);
    pub const EndFn = *const (fn (this: *anyopaque, err: ?Syscall.Error) JSC.Maybe(void));
    pub const ConnectFn = *const (fn (this: *anyopaque, signal: streams.Signal) JSC.Maybe(void));

    connect: ConnectFn,
    write: WriteUTF8Fn,
    writeLatin1: WriteLatin1Fn,
    writeUTF16: WriteUTF16Fn,
    end: EndFn,

    pub fn wrap(
        comptime Wrapped: type,
    ) VTable {
        const Functions = struct {
            pub fn onWrite(this: *anyopaque, data: streams.Result) streams.Result.Writable {
                return Wrapped.write(@as(*Wrapped, @ptrCast(@alignCast(this))), data);
            }
            pub fn onConnect(this: *anyopaque, signal: streams.Signal) JSC.Maybe(void) {
                return Wrapped.connect(@as(*Wrapped, @ptrCast(@alignCast(this))), signal);
            }
            pub fn onWriteLatin1(this: *anyopaque, data: streams.Result) streams.Result.Writable {
                return Wrapped.writeLatin1(@as(*Wrapped, @ptrCast(@alignCast(this))), data);
            }
            pub fn onWriteUTF16(this: *anyopaque, data: streams.Result) streams.Result.Writable {
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

pub fn writeLatin1(this: *Sink, data: streams.Result) streams.Result.Writable {
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

pub fn writeBytes(this: *Sink, data: streams.Result) streams.Result.Writable {
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

pub fn writeUTF16(this: *Sink, data: streams.Result) streams.Result.Writable {
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

pub fn write(this: *Sink, data: Data) streams.Result.Writable {
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

pub fn JSSink(comptime SinkType: type, comptime abi_name: []const u8) type {
    return struct {
        sink: SinkType,

        const ThisSink = @This();

        // This attaches it to JS
        pub const SinkSignal = extern struct {
            cpp: JSValue,

            pub fn init(cpp: JSValue) streams.Signal {
                // this one can be null
                @setRuntimeSafety(false);
                return streams.Signal.initWithType(SinkSignal, @as(*SinkSignal, @ptrFromInt(@as(usize, @bitCast(@intFromEnum(cpp))))));
            }

            pub fn close(this: *@This(), _: ?Syscall.Error) void {
                onClose(@as(SinkSignal, @bitCast(@intFromPtr(this))).cpp, .js_undefined);
            }

            pub fn ready(this: *@This(), _: ?Blob.SizeType, _: ?Blob.SizeType) void {
                onReady(@as(SinkSignal, @bitCast(@intFromPtr(this))).cpp, .js_undefined, .js_undefined);
            }

            pub fn start(_: *@This()) void {}
        };

        pub fn memoryCost(this: *ThisSink) callconv(.C) usize {
            return @sizeOf(ThisSink) + SinkType.memoryCost(&this.sink);
        }

        const AssignToStreamFn = *const fn (*JSGlobalObject, JSValue, *anyopaque, **anyopaque) callconv(.C) JSValue;
        const OnCloseFn = *const fn (JSValue, JSValue) callconv(.C) void;
        const OnReadyFn = *const fn (JSValue, JSValue, JSValue) callconv(.C) void;
        const OnStartFn = *const fn (JSValue, *JSGlobalObject) callconv(.C) void;
        const CreateObjectFn = *const fn (*JSGlobalObject, *anyopaque, usize) callconv(.C) JSValue;
        const SetDestroyCallbackFn = *const fn (JSValue, usize) callconv(.C) void;
        const DetachPtrFn = *const fn (JSValue) callconv(.C) void;

        const assignToStreamExtern = @extern(AssignToStreamFn, .{ .name = abi_name ++ "__assignToStream" });
        const onCloseExtern = @extern(OnCloseFn, .{ .name = abi_name ++ "__onClose" });
        const onReadyExtern = @extern(OnReadyFn, .{ .name = abi_name ++ "__onReady" });
        const onStartExtern = @extern(OnStartFn, .{ .name = abi_name ++ "__onStart" });
        const createObjectExtern = @extern(CreateObjectFn, .{ .name = abi_name ++ "__createObject" });
        const setDestroyCallbackExtern = @extern(SetDestroyCallbackFn, .{ .name = abi_name ++ "__setDestroyCallback" });
        const detachPtrExtern = @extern(DetachPtrFn, .{ .name = abi_name ++ "__detachPtr" });

        pub fn assignToStream(globalThis: *JSGlobalObject, stream: JSValue, ptr: *anyopaque, jsvalue_ptr: **anyopaque) JSValue {
            return assignToStreamExtern(globalThis, stream, ptr, jsvalue_ptr);
        }

        pub fn onClose(ptr: JSValue, reason: JSValue) void {
            JSC.markBinding(@src());
            return onCloseExtern(ptr, reason);
        }

        pub fn onReady(ptr: JSValue, amount: JSValue, offset: JSValue) void {
            JSC.markBinding(@src());
            return onReadyExtern(ptr, amount, offset);
        }

        pub fn onStart(ptr: JSValue, globalThis: *JSGlobalObject) void {
            JSC.markBinding(@src());
            return onStartExtern(ptr, globalThis);
        }

        pub fn createObject(globalThis: *JSGlobalObject, object: *anyopaque, destructor: usize) JSValue {
            JSC.markBinding(@src());
            return createObjectExtern(globalThis, object, destructor);
        }

        pub fn setDestroyCallback(value: JSValue, callback: usize) void {
            JSC.markBinding(@src());
            return setDestroyCallbackExtern(value, callback);
        }

        pub fn detachPtr(ptr: JSValue) void {
            return detachPtrExtern(ptr);
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

            var this = bun.new(SinkType, undefined);
            this.construct(bun.default_allocator);
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
            const value = @as(JSValue, @enumFromInt(@as(JSC.JSValue.backing_int, @bitCast(@intFromPtr(ptr)))));
            value.unprotect();
            detachPtr(value);
        }

        // The code generator encodes two distinct failure types using 0 and 1
        const FromJSResult = enum(usize) {
            /// The sink has been closed and the wrapped type is freed.
            detached = 0,
            /// JS exception has not yet been thrown
            cast_failed = 1,
            /// *ThisSink
            _,
        };
        const fromJSExtern = @extern(
            *const fn (value: JSValue) callconv(.C) FromJSResult,
            .{ .name = abi_name ++ "__fromJS" },
        );

        pub fn fromJS(value: JSValue) ?*ThisSink {
            switch (fromJSExtern(value)) {
                .detached, .cast_failed => return null,
                else => |ptr| return @ptrFromInt(@intFromEnum(ptr)),
            }
        }

        fn getThis(global: *JSGlobalObject, callframe: *const JSC.CallFrame) bun.JSError!*ThisSink {
            return switch (fromJSExtern(callframe.this())) {
                .detached => global.throw("This " ++ abi_name ++ " has already been closed. A \"direct\" ReadableStream terminates its underlying socket once `async pull()` returns.", .{}),
                .cast_failed => global.ERR(.INVALID_THIS, "Expected " ++ abi_name, .{}).throw(),
                else => |ptr| @ptrFromInt(@intFromEnum(ptr)),
            };
        }

        pub fn unprotect(this: *@This()) void {
            _ = this;
        }

        pub fn write(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());
            const this = try getThis(globalThis, callframe);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    return globalThis.throwValue(err);
                }
            }

            const args_list = callframe.arguments_old(4);
            const args = args_list.ptr[0..args_list.len];

            if (args.len == 0) {
                return globalThis.throwValue(globalThis.toTypeError(.MISSING_ARGS, "write() expects a string, ArrayBufferView, or ArrayBuffer", .{}));
            }

            const arg = args[0];
            arg.ensureStillAlive();
            defer arg.ensureStillAlive();

            if (arg.isEmptyOrUndefinedOrNull()) {
                return globalThis.throwValue(globalThis.toTypeError(.STREAM_NULL_VALUES, "write() expects a string, ArrayBufferView, or ArrayBuffer", .{}));
            }

            if (arg.asArrayBuffer(globalThis)) |buffer| {
                const slice = buffer.slice();
                if (slice.len == 0) {
                    return JSC.JSValue.jsNumber(0);
                }

                return this.sink.writeBytes(.{ .temporary = bun.ByteList.init(slice) }).toJS(globalThis);
            }

            if (!arg.isString()) {
                return globalThis.throwValue(globalThis.toTypeError(.INVALID_ARG_TYPE, "write() expects a string, ArrayBufferView, or ArrayBuffer", .{}));
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

            const this = try getThis(globalThis, callframe);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    return globalThis.throwValue(err);
                }
            }

            const args_list = callframe.arguments_old(4);
            const args = args_list.ptr[0..args_list.len];
            if (args.len == 0 or !args[0].isString()) {
                const err = globalThis.toTypeError(
                    if (args.len == 0) .MISSING_ARGS else .INVALID_ARG_TYPE,
                    "writeUTF8() expects a string",
                    .{},
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
            const this: *ThisSink = @ptrCast(@alignCast(sink_ptr orelse return .js_undefined));

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    return globalThis.vm().throwError(globalThis, err) catch .zero;
                }
            }

            return this.sink.end(null).toJS(globalThis);
        }

        pub fn flush(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());

            const this = try getThis(globalThis, callframe);

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

            const this = try getThis(globalThis, callframe);

            if (comptime @hasDecl(SinkType, "getPendingError")) {
                if (this.sink.getPendingError()) |err| {
                    return globalThis.throwValue(err);
                }
            }

            if (comptime @hasField(streams.Start, abi_name)) {
                return this.sink.start(
                    if (callframe.argumentsCount() > 0)
                        try streams.Start.fromJSWithTag(
                            globalThis,
                            callframe.argument(0),
                            comptime @field(streams.Start, abi_name),
                        )
                    else
                        .{ .empty = {} },
                ).toJS(globalThis);
            }

            return this.sink.start(
                if (callframe.argumentsCount() > 0)
                    try streams.Start.fromJS(globalThis, callframe.argument(0))
                else
                    .{ .empty = {} },
            ).toJS(globalThis);
        }

        pub fn end(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());

            const this = try getThis(globalThis, callframe);

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

        pub fn updateRef(ptr: *anyopaque, value: bool) callconv(.C) void {
            JSC.markBinding(@src());
            var this = bun.cast(*ThisSink, ptr);
            if (comptime @hasDecl(SinkType, "updateRef"))
                this.sink.updateRef(value);
        }

        const jsWrite = JSC.toJSHostFn(@This().write);
        const jsFlush = JSC.toJSHostFn(flush);
        const jsStart = JSC.toJSHostFn(start);
        const jsEnd = JSC.toJSHostFn(@This().end);
        const jsConstruct = JSC.toJSHostFn(construct);

        fn jsGetInternalFd(ptr: *anyopaque) callconv(.C) JSValue {
            var this = bun.cast(*ThisSink, ptr);
            if (comptime @hasDecl(SinkType, "getFd")) {
                return JSValue.jsNumber(this.sink.getFd());
            }
            return .null;
        }

        comptime {
            if (bun.Environment.export_cpp_apis) {
                @export(&finalize, .{ .name = abi_name ++ "__finalize" });
                @export(&jsWrite, .{ .name = abi_name ++ "__write" });
                @export(&jsGetInternalFd, .{ .name = abi_name ++ "__getInternalFd" });
                @export(&close, .{ .name = abi_name ++ "__close" });
                @export(&jsFlush, .{ .name = abi_name ++ "__flush" });
                @export(&jsStart, .{ .name = abi_name ++ "__start" });
                @export(&jsEnd, .{ .name = abi_name ++ "__end" });
                @export(&jsConstruct, .{ .name = abi_name ++ "__construct" });
                @export(&endWithSink, .{ .name = abi_name ++ "__endWithSink" });
                @export(&updateRef, .{ .name = abi_name ++ "__updateRef" });
                @export(&memoryCost, .{ .name = abi_name ++ "__memoryCost" });
            }
        }
    };
}

const Detached = opaque {};
const Subprocess = bun.api.Subprocess;
pub const DestructorPtr = bun.TaggedPointerUnion(.{
    Detached,
    Subprocess,
});

pub export fn Bun__onSinkDestroyed(
    ptr_value: ?*anyopaque,
    sink_ptr: ?*anyopaque,
) callconv(.C) void {
    _ = sink_ptr; // autofix
    const ptr = DestructorPtr.from(ptr_value);

    if (ptr.isNull()) {
        return;
    }

    switch (ptr.tag()) {
        @field(DestructorPtr.Tag, @typeName(Detached)) => {
            return;
        },
        @field(DestructorPtr.Tag, @typeName(Subprocess)) => {
            const subprocess = ptr.as(Subprocess);
            subprocess.onStdinDestroyed();
        },
        else => {
            Output.debugWarn("Unknown sink type", .{});
        },
    }
}

const std = @import("std");
const bun = @import("bun");
const Syscall = bun.sys;
const Output = bun.Output;
const JSC = bun.jsc;
const webcore = bun.webcore;
const streams = webcore.streams;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Blob = webcore.Blob;
