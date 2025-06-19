handler: *WebSocketServer.Handler,
this_value: JSValue = .zero,
flags: Flags = .{},
signal: ?*bun.webcore.AbortSignal = null,

// We pack the per-socket data into this struct below
const Flags = packed struct(u64) {
    ssl: bool = false,
    closed: bool = false,
    opened: bool = false,
    binary_type: JSC.ArrayBuffer.BinaryType = .Buffer,
    packed_websocket_ptr: u57 = 0,

    inline fn websocket(this: Flags) uws.AnyWebSocket {
        // Ensure those other bits are zeroed out
        const that = Flags{ .packed_websocket_ptr = this.packed_websocket_ptr };

        return if (this.ssl) .{
            .ssl = @ptrFromInt(@as(usize, that.packed_websocket_ptr)),
        } else .{
            .tcp = @ptrFromInt(@as(usize, that.packed_websocket_ptr)),
        };
    }
};

inline fn websocket(this: *const ServerWebSocket) uws.AnyWebSocket {
    return this.flags.websocket();
}

pub const js = JSC.Codegen.JSServerWebSocket;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub const new = bun.TrivialNew(ServerWebSocket);

pub fn memoryCost(this: *const ServerWebSocket) usize {
    if (this.flags.closed) {
        return @sizeOf(ServerWebSocket);
    }
    return this.websocket().memoryCost() + @sizeOf(ServerWebSocket);
}

const log = Output.scoped(.WebSocketServer, false);

pub fn onOpen(this: *ServerWebSocket, ws: uws.AnyWebSocket) void {
    log("OnOpen", .{});

    this.flags.packed_websocket_ptr = @truncate(@intFromPtr(ws.raw()));
    this.flags.closed = false;
    this.flags.ssl = ws == .ssl;

    // the this value is initially set to whatever the user passed in
    const value_to_cache = this.this_value;

    var handler = this.handler;
    const vm = this.handler.vm;
    handler.active_connections +|= 1;
    const globalObject = handler.globalObject;
    const onOpenHandler = handler.onOpen;
    if (vm.isShuttingDown()) {
        log("onOpen called after script execution", .{});
        ws.close();
        return;
    }

    this.this_value = .zero;
    this.flags.opened = false;
    if (value_to_cache != .zero) {
        const current_this = this.getThisValue();
        js.dataSetCached(current_this, globalObject, value_to_cache);
    }

    if (onOpenHandler.isEmptyOrUndefinedOrNull()) return;
    const this_value = this.getThisValue();
    var args = [_]JSValue{this_value};

    const loop = vm.eventLoop();
    loop.enter();
    defer loop.exit();

    var corker = Corker{
        .args = &args,
        .globalObject = globalObject,
        .callback = onOpenHandler,
    };
    ws.cork(&corker, Corker.run);
    const result = corker.result;
    this.flags.opened = true;
    if (result.toError()) |err_value| {
        log("onOpen exception", .{});

        if (!this.flags.closed) {
            this.flags.closed = true;
            // we un-gracefully close the connection if there was an exception
            // we don't want any event handlers to fire after this for anything other than error()
            // https://github.com/oven-sh/bun/issues/1480
            this.websocket().close();
            handler.active_connections -|= 1;
            this_value.unprotect();
        }

        handler.runErrorCallback(vm, globalObject, err_value);
    }
}

pub fn getThisValue(this: *ServerWebSocket) JSValue {
    var this_value = this.this_value;
    if (this_value == .zero) {
        this_value = this.toJS(this.handler.globalObject);
        this_value.protect();
        this.this_value = this_value;
    }
    return this_value;
}

pub fn onMessage(
    this: *ServerWebSocket,
    ws: uws.AnyWebSocket,
    message: []const u8,
    opcode: uws.Opcode,
) void {
    log("onMessage({d}): {s}", .{
        @intFromEnum(opcode),
        message,
    });
    const onMessageHandler = this.handler.onMessage;
    if (onMessageHandler.isEmptyOrUndefinedOrNull()) return;
    var globalObject = this.handler.globalObject;
    // This is the start of a task.
    const vm = this.handler.vm;
    if (vm.isShuttingDown()) {
        log("onMessage called after script execution", .{});
        ws.close();
        return;
    }

    const loop = vm.eventLoop();
    loop.enter();
    defer loop.exit();

    const arguments = [_]JSValue{
        this.getThisValue(),
        switch (opcode) {
            .text => bun.String.createUTF8ForJS(globalObject, message),
            .binary => this.binaryToJS(globalObject, message),
            else => unreachable,
        },
    };

    var corker = Corker{
        .args = &arguments,
        .globalObject = globalObject,
        .callback = onMessageHandler,
    };

    ws.cork(&corker, Corker.run);
    const result = corker.result;

    if (result.isEmptyOrUndefinedOrNull()) return;

    if (result.toError()) |err_value| {
        this.handler.runErrorCallback(vm, globalObject, err_value);
        return;
    }

    if (result.asAnyPromise()) |promise| {
        switch (promise.status(globalObject.vm())) {
            .rejected => {
                _ = promise.result(globalObject.vm());
                return;
            },

            else => {},
        }
    }
}

pub inline fn isClosed(this: *const ServerWebSocket) bool {
    return this.flags.closed;
}

pub fn onDrain(this: *ServerWebSocket, _: uws.AnyWebSocket) void {
    log("onDrain", .{});

    const handler = this.handler;
    const vm = handler.vm;
    if (this.isClosed() or vm.isShuttingDown())
        return;

    if (handler.onDrain != .zero) {
        const globalObject = handler.globalObject;

        var corker = Corker{
            .args = &[_]JSC.JSValue{this.getThisValue()},
            .globalObject = globalObject,
            .callback = handler.onDrain,
        };
        const loop = vm.eventLoop();
        loop.enter();
        defer loop.exit();
        this.websocket().cork(&corker, Corker.run);
        const result = corker.result;

        if (result.toError()) |err_value| {
            handler.runErrorCallback(vm, globalObject, err_value);
        }
    }
}

fn binaryToJS(this: *const ServerWebSocket, globalThis: *JSC.JSGlobalObject, data: []const u8) JSC.JSValue {
    return switch (this.flags.binary_type) {
        .Buffer => JSC.ArrayBuffer.createBuffer(
            globalThis,
            data,
        ),
        .Uint8Array => JSC.ArrayBuffer.create(
            globalThis,
            data,
            .Uint8Array,
        ),
        else => JSC.ArrayBuffer.create(
            globalThis,
            data,
            .ArrayBuffer,
        ),
    };
}

pub fn onPing(this: *ServerWebSocket, _: uws.AnyWebSocket, data: []const u8) void {
    log("onPing: {s}", .{data});

    const handler = this.handler;
    var cb = handler.onPing;
    const vm = handler.vm;
    if (cb.isEmptyOrUndefinedOrNull() or vm.isShuttingDown()) return;
    const globalThis = handler.globalObject;

    // This is the start of a task.
    const loop = vm.eventLoop();
    loop.enter();
    defer loop.exit();

    _ = cb.call(
        globalThis,
        .js_undefined,
        &[_]JSC.JSValue{ this.getThisValue(), this.binaryToJS(globalThis, data) },
    ) catch |e| {
        const err = globalThis.takeException(e);
        log("onPing error", .{});
        handler.runErrorCallback(vm, globalThis, err);
    };
}

pub fn onPong(this: *ServerWebSocket, _: uws.AnyWebSocket, data: []const u8) void {
    log("onPong: {s}", .{data});

    const handler = this.handler;
    var cb = handler.onPong;
    if (cb.isEmptyOrUndefinedOrNull()) return;

    const globalThis = handler.globalObject;
    const vm = handler.vm;

    if (vm.isShuttingDown()) return;

    // This is the start of a task.
    const loop = vm.eventLoop();
    loop.enter();
    defer loop.exit();

    _ = cb.call(
        globalThis,
        .js_undefined,
        &[_]JSC.JSValue{ this.getThisValue(), this.binaryToJS(globalThis, data) },
    ) catch |e| {
        const err = globalThis.takeException(e);
        log("onPong error", .{});
        handler.runErrorCallback(vm, globalThis, err);
    };
}

pub fn onClose(this: *ServerWebSocket, _: uws.AnyWebSocket, code: i32, message: []const u8) void {
    log("onClose", .{});
    var handler = this.handler;
    const was_closed = this.isClosed();
    this.flags.closed = true;
    defer {
        if (!was_closed) {
            handler.active_connections -|= 1;
        }
    }
    const signal = this.signal;
    this.signal = null;

    if (js.socketGetCached(this.getThisValue())) |socket| {
        Bun__callNodeHTTPServerSocketOnClose(socket);
    }

    defer {
        if (signal) |sig| {
            sig.pendingActivityUnref();
            sig.unref();
        }
    }

    const vm = handler.vm;
    if (vm.isShuttingDown()) {
        return;
    }

    if (!handler.onClose.isEmptyOrUndefinedOrNull()) {
        const globalObject = handler.globalObject;
        const loop = vm.eventLoop();

        loop.enter();
        defer loop.exit();

        if (signal) |sig| {
            if (!sig.aborted()) {
                sig.signal(handler.globalObject, .ConnectionClosed);
            }
        }

        _ = handler.onClose.call(
            globalObject,
            .js_undefined,
            &[_]JSC.JSValue{ this.getThisValue(), JSValue.jsNumber(code), bun.String.createUTF8ForJS(globalObject, message) },
        ) catch |e| {
            const err = globalObject.takeException(e);
            log("onClose error", .{});
            handler.runErrorCallback(vm, globalObject, err);
        };
    } else if (signal) |sig| {
        const loop = vm.eventLoop();

        loop.enter();
        defer loop.exit();

        if (!sig.aborted()) {
            sig.signal(handler.globalObject, .ConnectionClosed);
        }
    }

    this.this_value.unprotect();
}

pub fn behavior(comptime ServerType: type, comptime ssl: bool, opts: uws.WebSocketBehavior) uws.WebSocketBehavior {
    return uws.WebSocketBehavior.Wrap(ServerType, @This(), ssl).apply(opts);
}

pub fn constructor(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!*ServerWebSocket {
    return globalObject.throw("Cannot construct ServerWebSocket", .{});
}

pub fn finalize(this: *ServerWebSocket) void {
    log("finalize", .{});
    bun.destroy(this);
}

pub fn publish(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(4);
    if (args.len < 1) {
        log("publish()", .{});

        return globalThis.throw("publish requires at least 1 argument", .{});
    }

    const app = this.handler.app orelse {
        log("publish() closed", .{});
        return JSValue.jsNumber(0);
    };
    const flags = this.handler.flags;
    const ssl = flags.ssl;
    const publish_to_self = flags.publish_to_self;

    const topic_value = args.ptr[0];
    const message_value = args.ptr[1];
    const compress_value = args.ptr[2];

    if (topic_value.isEmptyOrUndefinedOrNull() or !topic_value.isString()) {
        log("publish() topic invalid", .{});

        return globalThis.throw("publish requires a topic string", .{});
    }

    var topic_slice = try topic_value.toSlice(globalThis, bun.default_allocator);
    defer topic_slice.deinit();
    if (topic_slice.len == 0) {
        return globalThis.throw("publish requires a non-empty topic", .{});
    }

    if (!compress_value.isBoolean() and !compress_value.isUndefined() and compress_value != .zero) {
        return globalThis.throw("publish expects compress to be a boolean", .{});
    }

    const compress = args.len > 1 and compress_value.toBoolean();

    if (message_value.isEmptyOrUndefinedOrNull()) {
        return globalThis.throw("publish requires a non-empty message", .{});
    }

    if (message_value.asArrayBuffer(globalThis)) |array_buffer| {
        const buffer = array_buffer.slice();

        const result = if (!publish_to_self and !this.isClosed())
            this.websocket().publish(topic_slice.slice(), buffer, .binary, compress)
        else
            uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .binary, compress);

        return JSValue.jsNumber(
            // if 0, return 0
            // else return number of bytes sent
            if (result) @as(i32, @intCast(@as(u31, @truncate(buffer.len)))) else @as(i32, 0),
        );
    }

    {
        var js_string = message_value.toString(globalThis);
        if (globalThis.hasException()) {
            return .zero;
        }
        const view = js_string.view(globalThis);
        const slice = view.toSlice(bun.default_allocator);
        defer slice.deinit();

        defer js_string.ensureStillAlive();

        const buffer = slice.slice();

        const result = if (!publish_to_self and !this.isClosed())
            this.websocket().publish(topic_slice.slice(), buffer, .text, compress)
        else
            uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .text, compress);

        return JSValue.jsNumber(
            // if 0, return 0
            // else return number of bytes sent
            if (result) @as(i32, @intCast(@as(u31, @truncate(buffer.len)))) else @as(i32, 0),
        );
    }
}

pub fn publishText(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(4);

    if (args.len < 1) {
        log("publish()", .{});
        return globalThis.throw("publish requires at least 1 argument", .{});
    }

    const app = this.handler.app orelse {
        log("publish() closed", .{});
        return JSValue.jsNumber(0);
    };
    const flags = this.handler.flags;
    const ssl = flags.ssl;
    const publish_to_self = flags.publish_to_self;

    const topic_value = args.ptr[0];
    const message_value = args.ptr[1];
    const compress_value = args.ptr[2];

    if (topic_value.isEmptyOrUndefinedOrNull() or !topic_value.isString()) {
        log("publish() topic invalid", .{});
        return globalThis.throw("publishText requires a topic string", .{});
    }

    var topic_slice = try topic_value.toSlice(globalThis, bun.default_allocator);
    defer topic_slice.deinit();

    if (!compress_value.isBoolean() and !compress_value.isUndefined() and compress_value != .zero) {
        return globalThis.throw("publishText expects compress to be a boolean", .{});
    }

    const compress = args.len > 1 and compress_value.toBoolean();

    if (message_value.isEmptyOrUndefinedOrNull() or !message_value.isString()) {
        return globalThis.throw("publishText requires a non-empty message", .{});
    }

    var js_string = message_value.toString(globalThis);
    if (globalThis.hasException()) {
        return .zero;
    }
    const view = js_string.view(globalThis);
    const slice = view.toSlice(bun.default_allocator);
    defer slice.deinit();

    defer js_string.ensureStillAlive();

    const buffer = slice.slice();

    const result = if (!publish_to_self and !this.isClosed())
        this.websocket().publish(topic_slice.slice(), buffer, .text, compress)
    else
        uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .text, compress);

    return JSValue.jsNumber(
        // if 0, return 0
        // else return number of bytes sent
        if (result) @as(i32, @intCast(@as(u31, @truncate(buffer.len)))) else @as(i32, 0),
    );
}

pub fn publishBinary(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(4);

    if (args.len < 1) {
        log("publishBinary()", .{});
        return globalThis.throw("publishBinary requires at least 1 argument", .{});
    }

    const app = this.handler.app orelse {
        log("publish() closed", .{});
        return JSValue.jsNumber(0);
    };
    const flags = this.handler.flags;
    const ssl = flags.ssl;
    const publish_to_self = flags.publish_to_self;
    const topic_value = args.ptr[0];
    const message_value = args.ptr[1];
    const compress_value = args.ptr[2];

    if (topic_value.isEmptyOrUndefinedOrNull() or !topic_value.isString()) {
        log("publishBinary() topic invalid", .{});
        return globalThis.throw("publishBinary requires a topic string", .{});
    }

    var topic_slice = try topic_value.toSlice(globalThis, bun.default_allocator);
    defer topic_slice.deinit();
    if (topic_slice.len == 0) {
        return globalThis.throw("publishBinary requires a non-empty topic", .{});
    }

    if (!compress_value.isBoolean() and !compress_value.isUndefined() and compress_value != .zero) {
        return globalThis.throw("publishBinary expects compress to be a boolean", .{});
    }

    const compress = args.len > 1 and compress_value.toBoolean();

    if (message_value.isEmptyOrUndefinedOrNull()) {
        return globalThis.throw("publishBinary requires a non-empty message", .{});
    }

    const array_buffer = message_value.asArrayBuffer(globalThis) orelse {
        return globalThis.throw("publishBinary expects an ArrayBufferView", .{});
    };
    const buffer = array_buffer.slice();

    const result = if (!publish_to_self and !this.isClosed())
        this.websocket().publish(topic_slice.slice(), buffer, .binary, compress)
    else
        uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .binary, compress);

    return JSValue.jsNumber(
        // if 0, return 0
        // else return number of bytes sent
        if (result) @as(i32, @intCast(@as(u31, @truncate(buffer.len)))) else @as(i32, 0),
    );
}

pub fn publishBinaryWithoutTypeChecks(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    topic_str: *JSC.JSString,
    array: *JSC.JSUint8Array,
) bun.JSError!JSC.JSValue {
    const app = this.handler.app orelse {
        log("publish() closed", .{});
        return JSValue.jsNumber(0);
    };
    const flags = this.handler.flags;
    const ssl = flags.ssl;
    const publish_to_self = flags.publish_to_self;

    var topic_slice = topic_str.toSlice(globalThis, bun.default_allocator);
    defer topic_slice.deinit();
    if (topic_slice.len == 0) {
        return globalThis.throw("publishBinary requires a non-empty topic", .{});
    }

    const compress = true;

    const buffer = array.slice();
    if (buffer.len == 0) {
        return JSC.JSValue.jsNumber(0);
    }

    const result = if (!publish_to_self and !this.isClosed())
        this.websocket().publish(topic_slice.slice(), buffer, .binary, compress)
    else
        uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .binary, compress);

    return JSValue.jsNumber(
        // if 0, return 0
        // else return number of bytes sent
        if (result) @as(i32, @intCast(@as(u31, @truncate(buffer.len)))) else @as(i32, 0),
    );
}

pub fn publishTextWithoutTypeChecks(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    topic_str: *JSC.JSString,
    str: *JSC.JSString,
) bun.JSError!JSC.JSValue {
    const app = this.handler.app orelse {
        log("publish() closed", .{});
        return JSValue.jsNumber(0);
    };
    const flags = this.handler.flags;
    const ssl = flags.ssl;
    const publish_to_self = flags.publish_to_self;

    var topic_slice = topic_str.toSlice(globalThis, bun.default_allocator);
    defer topic_slice.deinit();
    if (topic_slice.len == 0) {
        return globalThis.throw("publishBinary requires a non-empty topic", .{});
    }

    const compress = true;

    const slice = str.toSlice(globalThis, bun.default_allocator);
    defer slice.deinit();
    const buffer = slice.slice();

    if (buffer.len == 0) {
        return JSC.JSValue.jsNumber(0);
    }

    const result = if (!publish_to_self and !this.isClosed())
        this.websocket().publish(topic_slice.slice(), buffer, .text, compress)
    else
        uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .text, compress);

    return JSValue.jsNumber(
        // if 0, return 0
        // else return number of bytes sent
        if (result) @as(i32, @intCast(@as(u31, @truncate(buffer.len)))) else @as(i32, 0),
    );
}

pub fn cork(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
    // Since we're passing the `this` value to the cork function, we need to
    // make sure the `this` value is up to date.
    this_value: JSC.JSValue,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(1);
    this.this_value = this_value;

    if (args.len < 1) {
        return globalThis.throwNotEnoughArguments("cork", 1, 0);
    }

    const callback = args.ptr[0];
    if (callback.isEmptyOrUndefinedOrNull() or !callback.isCallable()) {
        return globalThis.throwInvalidArgumentTypeValue("cork", "callback", callback);
    }

    if (this.isClosed()) {
        return .js_undefined;
    }

    var corker = Corker{
        .globalObject = globalThis,
        .this_value = this_value,
        .callback = callback,
    };
    this.websocket().cork(&corker, Corker.run);

    const result = corker.result;

    if (result.isAnyError()) {
        return globalThis.throwValue(result);
    }

    return result;
}

pub fn send(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(2);

    if (args.len < 1) {
        log("send()", .{});
        return globalThis.throw("send requires at least 1 argument", .{});
    }

    if (this.isClosed()) {
        log("send() closed", .{});
        return JSValue.jsNumber(0);
    }

    const message_value = args.ptr[0];
    const compress_value = args.ptr[1];

    if (!compress_value.isBoolean() and !compress_value.isUndefined() and compress_value != .zero) {
        return globalThis.throw("send expects compress to be a boolean", .{});
    }

    const compress = args.len > 1 and compress_value.toBoolean();

    if (message_value.isEmptyOrUndefinedOrNull()) {
        return globalThis.throw("send requires a non-empty message", .{});
    }

    if (message_value.asArrayBuffer(globalThis)) |buffer| {
        switch (this.websocket().send(buffer.slice(), .binary, compress, true)) {
            .backpressure => {
                log("send() backpressure ({d} bytes)", .{buffer.len});
                return JSValue.jsNumber(-1);
            },
            .success => {
                log("send() success ({d} bytes)", .{buffer.len});
                return JSValue.jsNumber(buffer.slice().len);
            },
            .dropped => {
                log("send() dropped ({d} bytes)", .{buffer.len});
                return JSValue.jsNumber(0);
            },
        }
    }

    {
        var js_string = message_value.toString(globalThis);
        if (globalThis.hasException()) {
            return .zero;
        }
        const view = js_string.view(globalThis);
        const slice = view.toSlice(bun.default_allocator);
        defer slice.deinit();

        defer js_string.ensureStillAlive();

        const buffer = slice.slice();
        switch (this.websocket().send(buffer, .text, compress, true)) {
            .backpressure => {
                log("send() backpressure ({d} bytes string)", .{buffer.len});
                return JSValue.jsNumber(-1);
            },
            .success => {
                log("send() success ({d} bytes string)", .{buffer.len});
                return JSValue.jsNumber(buffer.len);
            },
            .dropped => {
                log("send() dropped ({d} bytes string)", .{buffer.len});
                return JSValue.jsNumber(0);
            },
        }
    }
}

pub fn sendText(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(2);

    if (args.len < 1) {
        log("sendText()", .{});
        return globalThis.throw("sendText requires at least 1 argument", .{});
    }

    if (this.isClosed()) {
        log("sendText() closed", .{});
        return JSValue.jsNumber(0);
    }

    const message_value = args.ptr[0];
    const compress_value = args.ptr[1];

    if (!compress_value.isBoolean() and !compress_value.isUndefined() and compress_value != .zero) {
        return globalThis.throw("sendText expects compress to be a boolean", .{});
    }

    const compress = args.len > 1 and compress_value.toBoolean();

    if (message_value.isEmptyOrUndefinedOrNull() or !message_value.isString()) {
        return globalThis.throw("sendText expects a string", .{});
    }

    var js_string = message_value.toString(globalThis);
    if (globalThis.hasException()) {
        return .zero;
    }
    const view = js_string.view(globalThis);
    const slice = view.toSlice(bun.default_allocator);
    defer slice.deinit();

    defer js_string.ensureStillAlive();

    const buffer = slice.slice();
    switch (this.websocket().send(buffer, .text, compress, true)) {
        .backpressure => {
            log("sendText() backpressure ({d} bytes string)", .{buffer.len});
            return JSValue.jsNumber(-1);
        },
        .success => {
            log("sendText() success ({d} bytes string)", .{buffer.len});
            return JSValue.jsNumber(buffer.len);
        },
        .dropped => {
            log("sendText() dropped ({d} bytes string)", .{buffer.len});
            return JSValue.jsNumber(0);
        },
    }
}

pub fn sendTextWithoutTypeChecks(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    message_str: *JSC.JSString,
    compress: bool,
) JSValue {
    if (this.isClosed()) {
        log("sendText() closed", .{});
        return JSValue.jsNumber(0);
    }

    var string_slice = message_str.toSlice(globalThis, bun.default_allocator);
    defer string_slice.deinit();

    const buffer = string_slice.slice();
    switch (this.websocket().send(buffer, .text, compress, true)) {
        .backpressure => {
            log("sendText() backpressure ({d} bytes string)", .{buffer.len});
            return JSValue.jsNumber(-1);
        },
        .success => {
            log("sendText() success ({d} bytes string)", .{buffer.len});
            return JSValue.jsNumber(buffer.len);
        },
        .dropped => {
            log("sendText() dropped ({d} bytes string)", .{buffer.len});
            return JSValue.jsNumber(0);
        },
    }
}

pub fn sendBinary(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(2);

    if (args.len < 1) {
        log("sendBinary()", .{});
        return globalThis.throw("sendBinary requires at least 1 argument", .{});
    }

    if (this.isClosed()) {
        log("sendBinary() closed", .{});
        return JSValue.jsNumber(0);
    }

    const message_value = args.ptr[0];
    const compress_value = args.ptr[1];

    if (!compress_value.isBoolean() and !compress_value.isUndefined() and compress_value != .zero) {
        return globalThis.throw("sendBinary expects compress to be a boolean", .{});
    }

    const compress = args.len > 1 and compress_value.toBoolean();

    const buffer = message_value.asArrayBuffer(globalThis) orelse {
        return globalThis.throw("sendBinary requires an ArrayBufferView", .{});
    };

    switch (this.websocket().send(buffer.slice(), .binary, compress, true)) {
        .backpressure => {
            log("sendBinary() backpressure ({d} bytes)", .{buffer.len});
            return JSValue.jsNumber(-1);
        },
        .success => {
            log("sendBinary() success ({d} bytes)", .{buffer.len});
            return JSValue.jsNumber(buffer.slice().len);
        },
        .dropped => {
            log("sendBinary() dropped ({d} bytes)", .{buffer.len});
            return JSValue.jsNumber(0);
        },
    }
}

pub fn sendBinaryWithoutTypeChecks(
    this: *ServerWebSocket,
    _: *JSC.JSGlobalObject,
    array_buffer: *JSC.JSUint8Array,
    compress: bool,
) JSValue {
    if (this.isClosed()) {
        log("sendBinary() closed", .{});
        return JSValue.jsNumber(0);
    }

    const buffer = array_buffer.slice();

    switch (this.websocket().send(buffer, .binary, compress, true)) {
        .backpressure => {
            log("sendBinary() backpressure ({d} bytes)", .{buffer.len});
            return JSValue.jsNumber(-1);
        },
        .success => {
            log("sendBinary() success ({d} bytes)", .{buffer.len});
            return JSValue.jsNumber(buffer.len);
        },
        .dropped => {
            log("sendBinary() dropped ({d} bytes)", .{buffer.len});
            return JSValue.jsNumber(0);
        },
    }
}

pub fn ping(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    return sendPing(this, globalThis, callframe, "ping", .ping);
}

pub fn pong(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    return sendPing(this, globalThis, callframe, "pong", .pong);
}

inline fn sendPing(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
    comptime name: string,
    comptime opcode: uws.Opcode,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(2);

    if (this.isClosed()) {
        return JSValue.jsNumber(0);
    }

    if (args.len > 0) {
        var value = args.ptr[0];
        if (!value.isEmptyOrUndefinedOrNull()) {
            if (value.asArrayBuffer(globalThis)) |data| {
                const buffer = data.slice();

                switch (this.websocket().send(buffer, opcode, false, true)) {
                    .backpressure => {
                        log("{s}() backpressure ({d} bytes)", .{ name, buffer.len });
                        return JSValue.jsNumber(-1);
                    },
                    .success => {
                        log("{s}() success ({d} bytes)", .{ name, buffer.len });
                        return JSValue.jsNumber(buffer.len);
                    },
                    .dropped => {
                        log("{s}() dropped ({d} bytes)", .{ name, buffer.len });
                        return JSValue.jsNumber(0);
                    },
                }
            } else if (value.isString()) {
                var string_value = value.toString(globalThis).toSlice(globalThis, bun.default_allocator);
                defer string_value.deinit();
                const buffer = string_value.slice();

                switch (this.websocket().send(buffer, opcode, false, true)) {
                    .backpressure => {
                        log("{s}() backpressure ({d} bytes)", .{ name, buffer.len });
                        return JSValue.jsNumber(-1);
                    },
                    .success => {
                        log("{s}() success ({d} bytes)", .{ name, buffer.len });
                        return JSValue.jsNumber(buffer.len);
                    },
                    .dropped => {
                        log("{s}() dropped ({d} bytes)", .{ name, buffer.len });
                        return JSValue.jsNumber(0);
                    },
                }
            } else {
                return globalThis.throwPretty("{s} requires a string or BufferSource", .{name});
            }
        }
    }

    switch (this.websocket().send(&.{}, opcode, false, true)) {
        .backpressure => {
            log("{s}() backpressure ({d} bytes)", .{ name, 0 });
            return JSValue.jsNumber(-1);
        },
        .success => {
            log("{s}() success ({d} bytes)", .{ name, 0 });
            return JSValue.jsNumber(0);
        },
        .dropped => {
            log("{s}() dropped ({d} bytes)", .{ name, 0 });
            return JSValue.jsNumber(0);
        },
    }
}

pub fn getData(
    _: *ServerWebSocket,
    _: *JSC.JSGlobalObject,
) JSValue {
    log("getData()", .{});
    return .js_undefined;
}

pub fn setData(
    this: *ServerWebSocket,
    globalObject: *JSC.JSGlobalObject,
    value: JSC.JSValue,
) void {
    log("setData()", .{});
    js.dataSetCached(this.this_value, globalObject, value);
}

pub fn getReadyState(
    this: *ServerWebSocket,
    _: *JSC.JSGlobalObject,
) JSValue {
    log("getReadyState()", .{});

    if (this.isClosed()) {
        return JSValue.jsNumber(3);
    }

    return JSValue.jsNumber(1);
}

pub fn close(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
    // Since close() can lead to the close() callback being called, let's always ensure the `this` value is up to date.
    this_value: JSC.JSValue,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(2);
    log("close()", .{});
    this.this_value = this_value;

    if (this.isClosed()) {
        return .js_undefined;
    }

    const code = brk: {
        if (args.ptr[0] == .zero or args.ptr[0].isUndefined()) {
            // default exception code
            break :brk 1000;
        }

        if (!args.ptr[0].isNumber()) {
            return globalThis.throwInvalidArguments("close requires a numeric code or undefined", .{});
        }

        break :brk args.ptr[0].coerce(i32, globalThis);
    };

    var message_value: ZigString.Slice = brk: {
        if (args.ptr[1] == .zero or args.ptr[1].isUndefined()) break :brk ZigString.Slice.empty;
        break :brk try args.ptr[1].toSliceOrNull(globalThis);
    };

    defer message_value.deinit();

    this.flags.closed = true;
    this.websocket().end(code, message_value.slice());
    return .js_undefined;
}

pub fn terminate(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
    // Since terminate() can lead to close() being called, let's always ensure the `this` value is up to date.
    this_value: JSC.JSValue,
) bun.JSError!JSValue {
    _ = globalThis;
    const args = callframe.arguments_old(2);
    _ = args;
    log("terminate()", .{});

    this.this_value = this_value;

    if (this.isClosed()) {
        return .js_undefined;
    }

    this.flags.closed = true;
    this.this_value.unprotect();
    this.websocket().close();

    return .js_undefined;
}

pub fn getBinaryType(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
) JSValue {
    log("getBinaryType()", .{});

    return switch (this.flags.binary_type) {
        .Uint8Array => bun.String.static("uint8array").toJS(globalThis),
        .Buffer => bun.String.static("nodebuffer").toJS(globalThis),
        .ArrayBuffer => bun.String.static("arraybuffer").toJS(globalThis),
        else => @panic("Invalid binary type"),
    };
}

pub fn setBinaryType(this: *ServerWebSocket, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) bun.JSError!void {
    log("setBinaryType()", .{});

    const btype = try JSC.ArrayBuffer.BinaryType.fromJSValue(globalThis, value);
    switch (btype orelse
        // some other value which we don't support
        .Float64Array) {
        .ArrayBuffer, .Buffer, .Uint8Array => |val| {
            this.flags.binary_type = val;
            return;
        },
        else => {
            return globalThis.throw("binaryType must be either \"uint8array\" or \"arraybuffer\" or \"nodebuffer\"", .{});
        },
    }
}

pub fn getBufferedAmount(
    this: *ServerWebSocket,
    _: *JSC.JSGlobalObject,
    _: *JSC.CallFrame,
) bun.JSError!JSValue {
    log("getBufferedAmount()", .{});

    if (this.isClosed()) {
        return JSValue.jsNumber(0);
    }

    return JSValue.jsNumber(this.websocket().getBufferedAmount());
}
pub fn subscribe(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(1);
    if (args.len < 1) {
        return globalThis.throw("subscribe requires at least 1 argument", .{});
    }

    if (this.isClosed()) {
        return JSValue.jsBoolean(true);
    }

    if (!args.ptr[0].isString()) {
        return globalThis.throwInvalidArgumentTypeValue("topic", "string", args.ptr[0]);
    }

    var topic = try args.ptr[0].toSlice(globalThis, bun.default_allocator);
    defer topic.deinit();

    if (topic.len == 0) {
        return globalThis.throw("subscribe requires a non-empty topic name", .{});
    }

    return JSValue.jsBoolean(this.websocket().subscribe(topic.slice()));
}
pub fn unsubscribe(this: *ServerWebSocket, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const args = callframe.arguments_old(1);
    if (args.len < 1) {
        return globalThis.throw("unsubscribe requires at least 1 argument", .{});
    }

    if (this.isClosed()) {
        return JSValue.jsBoolean(true);
    }

    if (!args.ptr[0].isString()) {
        return globalThis.throwInvalidArgumentTypeValue("topic", "string", args.ptr[0]);
    }

    var topic = try args.ptr[0].toSlice(globalThis, bun.default_allocator);
    defer topic.deinit();

    if (topic.len == 0) {
        return globalThis.throw("unsubscribe requires a non-empty topic name", .{});
    }

    return JSValue.jsBoolean(this.websocket().unsubscribe(topic.slice()));
}
pub fn isSubscribed(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(1);
    if (args.len < 1) {
        return globalThis.throw("isSubscribed requires at least 1 argument", .{});
    }

    if (this.isClosed()) {
        return JSValue.jsBoolean(false);
    }

    if (!args.ptr[0].isString()) {
        return globalThis.throwInvalidArgumentTypeValue("topic", "string", args.ptr[0]);
    }

    var topic = try args.ptr[0].toSlice(globalThis, bun.default_allocator);
    defer topic.deinit();

    if (topic.len == 0) {
        return globalThis.throw("isSubscribed requires a non-empty topic name", .{});
    }

    return JSValue.jsBoolean(this.websocket().isSubscribed(topic.slice()));
}

pub fn getRemoteAddress(
    this: *ServerWebSocket,
    globalThis: *JSC.JSGlobalObject,
) JSValue {
    if (this.isClosed()) {
        return .js_undefined;
    }

    var buf: [64]u8 = [_]u8{0} ** 64;
    var text_buf: [512]u8 = undefined;

    const address_bytes = this.websocket().getRemoteAddress(&buf);
    const address: std.net.Address = switch (address_bytes.len) {
        4 => std.net.Address.initIp4(address_bytes[0..4].*, 0),
        16 => std.net.Address.initIp6(address_bytes[0..16].*, 0, 0, 0),
        else => return .js_undefined,
    };

    const text = bun.fmt.formatIp(address, &text_buf) catch unreachable;
    return bun.String.createUTF8ForJS(globalThis, text);
}

const Corker = struct {
    args: []const JSValue = &.{},
    globalObject: *JSC.JSGlobalObject,
    this_value: JSC.JSValue = .zero,
    callback: JSC.JSValue,
    result: JSValue = .zero,

    pub fn run(this: *Corker) void {
        const this_value = this.this_value;
        this.result = this.callback.call(
            this.globalObject,
            if (this_value == .zero) .js_undefined else this_value,
            this.args,
        ) catch |err| this.globalObject.takeException(err);
    }
};

extern "c" fn Bun__callNodeHTTPServerSocketOnClose(JSC.JSValue) void;

const ServerWebSocket = @This();

const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const JSC = bun.JSC;
const bun = @import("bun");
const string = []const u8;
const std = @import("std");
const ZigString = JSC.ZigString;
const WebSocketServer = @import("../server.zig").WebSocketServerContext;
const uws = bun.uws;
const Output = bun.Output;
