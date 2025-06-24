pub const Start = union(Tag) {
    empty: void,
    err: Syscall.Error,
    chunk_size: Blob.SizeType,
    ArrayBufferSink: struct {
        chunk_size: Blob.SizeType,
        as_uint8array: bool,
        stream: bool,
    },
    FileSink: FileSink.Options,
    HTTPSResponseSink: void,
    HTTPResponseSink: void,
    NetworkSink: void,
    ready: void,
    owned_and_done: bun.ByteList,
    done: bun.ByteList,

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

    pub fn toJS(this: Start, globalThis: *JSGlobalObject) JSC.JSValue {
        switch (this) {
            .empty, .ready => {
                return .js_undefined;
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
                return .js_undefined;
            },
        }
    }

    pub fn fromJS(globalThis: *JSGlobalObject, value: JSValue) bun.JSError!Start {
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
    ) bun.JSError!Start {
        if (value.isEmptyOrUndefinedOrNull() or !value.isObject()) {
            return .{ .empty = {} };
        }

        switch (comptime tag) {
            .ArrayBufferSink => {
                var as_uint8array = false;
                var stream = false;
                var chunk_size: Blob.SizeType = 0;
                var empty = true;

                if (try value.getOwn(globalThis, "asUint8Array")) |val| {
                    if (val.isBoolean()) {
                        as_uint8array = val.toBoolean();
                        empty = false;
                    }
                }

                if (try value.fastGet(globalThis, .stream)) |val| {
                    if (val.isBoolean()) {
                        stream = val.toBoolean();
                        empty = false;
                    }
                }

                if (try value.fastGet(globalThis, .highWaterMark)) |chunkSize| {
                    if (chunkSize.isNumber()) {
                        empty = false;
                        chunk_size = @as(Blob.SizeType, @intCast(@max(0, @as(i51, @truncate(chunkSize.toInt64())))));
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
                var chunk_size: Blob.SizeType = 0;

                if (try value.fastGet(globalThis, .highWaterMark)) |chunkSize| {
                    if (chunkSize.isNumber())
                        chunk_size = @as(Blob.SizeType, @intCast(@max(0, @as(i51, @truncate(chunkSize.toInt64())))));
                }

                if (try value.fastGet(globalThis, .path)) |path| {
                    if (!path.isString()) {
                        return .{
                            .err = Syscall.Error{
                                .errno = @intFromEnum(bun.sys.SystemErrno.EINVAL),
                                .syscall = .write,
                            },
                        };
                    }

                    return .{
                        .FileSink = .{
                            .chunk_size = chunk_size,
                            .input_path = .{
                                .path = try path.toSlice(globalThis, globalThis.bunVM().allocator),
                            },
                        },
                    };
                } else if (try value.getTruthy(globalThis, "fd")) |fd_value| {
                    if (!fd_value.isAnyInt()) {
                        return .{
                            .err = Syscall.Error{
                                .errno = @intFromEnum(bun.sys.SystemErrno.EBADF),
                                .syscall = .write,
                            },
                        };
                    }

                    if (bun.FD.fromJS(fd_value)) |fd| {
                        return .{
                            .FileSink = .{
                                .chunk_size = chunk_size,
                                .input_path = .{ .fd = fd },
                            },
                        };
                    } else {
                        return .{ .err = Syscall.Error{
                            .errno = @intFromEnum(bun.sys.SystemErrno.EBADF),
                            .syscall = .write,
                        } };
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
                var chunk_size: Blob.SizeType = 2048;

                if (try value.fastGet(globalThis, .highWaterMark)) |chunkSize| {
                    if (chunkSize.isNumber()) {
                        empty = false;
                        chunk_size = @as(Blob.SizeType, @intCast(@max(256, @as(i51, @truncate(chunkSize.toInt64())))));
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

pub const Result = union(Tag) {
    pending: *Pending,
    err: StreamError,
    done: void,
    owned: bun.ByteList,
    owned_and_done: bun.ByteList,
    temporary_and_done: bun.ByteList,
    temporary: bun.ByteList,
    into_array: IntoArray,
    into_array_and_done: IntoArray,

    pub fn deinit(this: *Result) void {
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

        // TODO: use an explicit JSC.Strong.Optional here.
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

    pub fn slice16(this: *const Result) []const u16 {
        const bytes = this.slice();
        return @as([*]const u16, @ptrCast(@alignCast(bytes.ptr)))[0..std.mem.bytesAsSlice(u16, bytes).len];
    }

    pub fn slice(this: *const Result) []const u8 {
        return switch (this.*) {
            .owned => |owned| owned.slice(),
            .owned_and_done => |owned_and_done| owned_and_done.slice(),
            .temporary_and_done => |temporary_and_done| temporary_and_done.slice(),
            .temporary => |temporary| temporary.slice(),
            else => "",
        };
    }

    pub const Writable = union(Result.Tag) {
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
            state: Result.Pending.State = .none,

            pub fn deinit(this: *@This()) void {
                this.future.deinit();
            }

            pub const Future = union(enum) {
                none: void,
                promise: struct {
                    strong: JSC.JSPromise.Strong,
                    global: *JSC.JSGlobalObject,
                },
                handler: Handler,

                pub fn deinit(this: *@This()) void {
                    if (this.* == .promise) {
                        this.promise.strong.deinit();
                        this.* = .{ .none = {} };
                    }
                }
            };

            pub fn promise(this: *Writable.Pending, globalThis: *JSC.JSGlobalObject) *JSPromise {
                this.state = .pending;

                switch (this.future) {
                    .promise => |p| {
                        return p.strong.get();
                    },
                    else => {
                        this.future = .{
                            .promise = .{
                                .strong = JSC.JSPromise.Strong.init(globalThis),
                                .global = globalThis,
                            },
                        };

                        return this.future.promise.strong.get();
                    },
                }
            }

            pub const Handler = struct {
                ctx: *anyopaque,
                handler: Fn,

                pub const Fn = *const fn (ctx: *anyopaque, result: Result.Writable) void;

                pub fn init(this: *Handler, comptime Context: type, ctx: *Context, comptime handler_fn: fn (*Context, Result.Writable) void) void {
                    this.ctx = ctx;
                    this.handler = struct {
                        const handler = handler_fn;
                        pub fn onHandle(ctx_: *anyopaque, result: Result.Writable) void {
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
                        Writable.fulfillPromise(this.result, p.strong.swap(), p.global);
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
            defer promise.toJS().unprotect();
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
                .err => |err| JSC.JSPromise.rejectedPromise(globalThis, JSValue.c(err.toJS(globalThis))).toJS(),

                .owned => |len| JSC.JSValue.jsNumber(len),
                .owned_and_done => |len| JSC.JSValue.jsNumber(len),
                .temporary_and_done => |len| JSC.JSValue.jsNumber(len),
                .temporary => |len| JSC.JSValue.jsNumber(len),
                .into_array => |len| JSC.JSValue.jsNumber(len),
                .into_array_and_done => |len| JSC.JSValue.jsNumber(len),

                // false == controller.close()
                // undefined == noop, but we probably won't send it
                .done => JSC.JSValue.jsBoolean(true),

                .pending => |pending| pending.promise(globalThis).toJS(),
            };
        }
    };

    pub const IntoArray = struct {
        value: JSValue = JSValue.zero,
        len: Blob.SizeType = std.math.maxInt(Blob.SizeType),
    };

    pub const Pending = struct {
        future: Future = undefined,
        result: Result = .{ .done = {} },
        state: State = .none,

        pub fn set(this: *Pending, comptime Context: type, ctx: *Context, comptime handler_fn: fn (*Context, Result) void) void {
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

        pub fn runOnNextTick(this: *Pending) void {
            if (this.state != .pending) return;
            const vm = JSC.VirtualMachine.get();
            if (vm.isShuttingDown()) {
                return;
            }

            const clone = bun.create(bun.default_allocator, Pending, this.*);
            this.state = .none;
            this.result = .{ .done = {} };
            vm.eventLoop().enqueueTask(JSC.Task.init(clone));
        }

        pub fn runFromJSThread(this: *Pending) void {
            this.run();

            bun.destroy(this);
        }

        pub const Future = union(enum) {
            promise: struct {
                promise: *JSPromise,
                globalThis: *JSC.JSGlobalObject,
            },
            handler: Handler,

            pub fn init(this: *Future, comptime Context: type, ctx: *Context, comptime handler_fn: fn (*Context, Result) void) void {
                this.* = .{
                    .handler = undefined,
                };
                this.handler.init(Context, ctx, handler_fn);
            }
        };

        pub const Handler = struct {
            ctx: *anyopaque,
            handler: Fn,

            pub const Fn = *const fn (ctx: *anyopaque, result: Result) void;

            pub fn init(this: *Handler, comptime Context: type, ctx: *Context, comptime handler_fn: fn (*Context, Result) void) void {
                this.ctx = ctx;
                this.handler = struct {
                    const handler = handler_fn;
                    pub fn onHandle(ctx_: *anyopaque, result: Result) void {
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
                    Result.fulfillPromise(&this.result, p.promise, p.globalThis);
                },
                .handler => |h| {
                    h.handler(h.ctx, this.result);
                },
            }
        }
    };

    pub fn isDone(this: *const Result) bool {
        return switch (this.*) {
            .owned_and_done, .temporary_and_done, .into_array_and_done, .done, .err => true,
            else => false,
        };
    }

    pub fn fulfillPromise(result: *Result, promise: *JSC.JSPromise, globalThis: *JSC.JSGlobalObject) void {
        const vm = globalThis.bunVM();
        const loop = vm.eventLoop();
        const promise_value = promise.toJS();
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

    pub fn toJS(this: *const Result, globalThis: *JSGlobalObject) JSValue {
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
                const promise = pending.promise(globalThis).toJS();
                promise.protect();
                return promise;
            },

            .err => |err| {
                const js_err, const was_strong = err.toJSWeak(globalThis);
                if (was_strong == .Strong) {
                    js_err.unprotect();
                }
                js_err.ensureStillAlive();
                return JSC.JSPromise.rejectedPromise(globalThis, js_err).toJS();
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

pub fn HTTPServerWritable(comptime ssl: bool) type {
    return struct {
        const UWSResponse = uws.NewApp(ssl).Response;
        res: *UWSResponse,
        buffer: bun.ByteList,
        pooled_buffer: ?*WebCore.ByteListPool.Node = null,
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

        auto_flusher: WebCore.AutoFlusher = .{},

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
                this.has_backpressure = this.res.write(buf) == .backpressure;
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

        pub fn start(this: *@This(), stream_start: Start) JSC.Maybe(void) {
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
                    if (WebCore.ByteListPool.getIfExists()) |pooled_node| {
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
                return .{ .result = prom.toJS() };
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
            var promise_value = this.pending_flush.?.toJS();
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

        pub fn write(this: *@This(), data: Result) Result.Writable {
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
        pub fn writeLatin1(this: *@This(), data: Result) Result.Writable {
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
        pub fn writeUTF16(this: *@This(), data: Result) Result.Writable {
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
                    const value = this.pending_flush.?.toJS();
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
            } else if (this.buffer.cap == 0) {
                //
            } else if (FeatureFlags.http_buffer_pooling and !WebCore.ByteListPool.full()) {
                const buffer = this.buffer;
                this.buffer = bun.ByteList.init("");
                WebCore.ByteListPool.push(this.allocator, buffer);
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
                prom.toJS().unprotect();
                prom.resolve(globalThis, JSC.JSValue.jsNumber(this.wrote -| this.wrote_at_start_of_flush));
                this.wrote_at_start_of_flush = this.wrote;
            }
        }

        pub const name = if (ssl) "HTTPSResponseSink" else "HTTPResponseSink";
        pub const JSSink = Sink.JSSink(@This(), name);
    };
}
pub const HTTPSResponseSink = HTTPServerWritable(true);
pub const HTTPResponseSink = HTTPServerWritable(false);
pub const NetworkSink = struct {
    pub const new = bun.TrivialNew(@This());
    pub const deinit = bun.TrivialDeinit(@This());

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

    pub fn start(this: *@This(), stream_start: Start) JSC.Maybe(void) {
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
        bun.destroy(this);
    }

    pub fn abort(this: *@This()) void {
        this.ended = true;
        this.done = true;
        this.signal.close(null);
        this.cancel = true;
        this.finalize();
    }

    pub fn write(this: *@This(), data: Result) Result.Writable {
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
    pub fn writeLatin1(this: *@This(), data: Result) Result.Writable {
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

            const check_ascii = false;
            this.buffer.writeLatin1(bytes, check_ascii) catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };

            _ = this.internalFlush() catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
            return .{ .owned = len };
        } else if (this.buffer.size() + len >= this.getHighWaterMark()) {
            // kinda fast path:
            // - combined chunk is large enough to flush automatically

            const check_ascii = true;
            this.buffer.writeLatin1(bytes, check_ascii) catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
            _ = this.internalFlush() catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
            return .{ .owned = len };
        } else {
            const check_ascii = true;
            this.buffer.writeLatin1(bytes, check_ascii) catch {
                return .{ .err = Syscall.Error.fromCode(.NOMEM, .write) };
            };
        }

        this.registerAutoFlusher();

        return .{ .owned = len };
    }
    pub fn writeUTF16(this: *@This(), data: Result) Result.Writable {
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

    pub const name = "NetworkSink";
    pub const JSSink = Sink.JSSink(@This(), name);
};

pub const BufferAction = union(enum) {
    text: JSC.JSPromise.Strong,
    arrayBuffer: JSC.JSPromise.Strong,
    blob: JSC.JSPromise.Strong,
    bytes: JSC.JSPromise.Strong,
    json: JSC.JSPromise.Strong,

    pub const Tag = @typeInfo(BufferAction).@"union".tag_type.?;

    pub fn fulfill(this: *BufferAction, global: *JSC.JSGlobalObject, blob: *AnyBlob) void {
        blob.wrap(.{ .normal = this.swap() }, global, this.*);
    }

    pub fn reject(this: *BufferAction, global: *JSC.JSGlobalObject, err: Result.StreamError) void {
        this.swap().reject(global, err.toJSWeak(global)[0]);
    }

    pub fn resolve(this: *BufferAction, global: *JSC.JSGlobalObject, result: JSC.JSValue) void {
        this.swap().resolve(global, result);
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

pub const ReadResult = union(enum) {
    pending: void,
    err: Syscall.Error,
    done: void,
    read: []u8,

    pub fn toStream(this: ReadResult, pending: *Result.Pending, buf: []u8, view: JSValue, close_on_empty: bool) Result {
        return toStreamWithIsDone(
            this,
            pending,
            buf,
            view,
            close_on_empty,
            false,
        );
    }
    pub fn toStreamWithIsDone(this: ReadResult, pending: *Result.Pending, buf: []u8, view: JSValue, close_on_empty: bool, is_done: bool) Result {
        return switch (this) {
            .pending => .{ .pending = pending },
            .err => .{ .err = .{ .Error = this.err } },
            .done => .{ .done = {} },
            .read => |slice| brk: {
                const owned = slice.ptr != buf.ptr;
                const done = is_done or (close_on_empty and slice.len == 0);

                break :brk if (owned and done)
                    Result{ .owned_and_done = bun.ByteList.init(slice) }
                else if (owned)
                    Result{ .owned = bun.ByteList.init(slice) }
                else if (done)
                    Result{ .into_array_and_done = .{ .len = @as(Blob.SizeType, @truncate(slice.len)), .value = view } }
                else
                    Result{ .into_array = .{ .len = @as(Blob.SizeType, @truncate(slice.len)), .value = view } };
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

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;

const Output = bun.Output;
const strings = bun.strings;
const string = bun.string;
const default_allocator = bun.default_allocator;
const FeatureFlags = bun.FeatureFlags;
const ArrayBuffer = JSC.ArrayBuffer;

const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const VirtualMachine = JSC.VirtualMachine;
const uws = bun.uws;
const Blob = bun.webcore.Blob;
const Response = JSC.WebCore.Response;
const assert = bun.assert;
const Syscall = bun.sys;
const WebCore = JSC.WebCore;
const Sink = WebCore.Sink;
const AutoFlusher = WebCore.AutoFlusher;
const FileSink = WebCore.FileSink;

const AnyBlob = bun.webcore.Blob.Any;
