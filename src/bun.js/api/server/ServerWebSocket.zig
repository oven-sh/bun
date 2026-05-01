const ServerWebSocket = @This();

#handler: *WebSocketServer.Handler,
#this_value: jsc.JSRef = .empty(),
#flags: Flags = .{},
#signal: ?*bun.webcore.AbortSignal = null,

// We pack the per-socket data into this struct below
const Flags = packed struct(u64) {
    ssl: bool = false,
    closed: bool = false,
    opened: bool = false,
    binary_type: jsc.ArrayBuffer.BinaryType = .Buffer,
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
    return this.#flags.websocket();
}

pub const js = jsc.Codegen.JSServerWebSocket;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const new = bun.TrivialNew(ServerWebSocket);

/// Initialize a ServerWebSocket with the given handler, data value, and signal.
/// The signal will not be ref'd inside the ServerWebSocket init function, but will unref itself when the ServerWebSocket is destroyed.
pub fn init(handler: *WebSocketServer.Handler, data_value: jsc.JSValue, signal: ?*bun.webcore.AbortSignal) *ServerWebSocket {
    const globalObject = handler.globalObject;
    const this = ServerWebSocket.new(.{
        .#handler = handler,
        .#signal = signal,
    });
    // Get a strong ref and downgrade when terminating/close and GC will be able to collect the newly created value
    const this_value = this.toJS(globalObject);
    this.#this_value = .initStrong(this_value, globalObject);
    js.dataSetCached(this_value, globalObject, data_value);
    return this;
}

pub fn memoryCost(this: *const ServerWebSocket) usize {
    if (this.#flags.closed) {
        return @sizeOf(ServerWebSocket);
    }
    return this.websocket().memoryCost() + @sizeOf(ServerWebSocket);
}

const log = Output.scoped(.WebSocketServer, .visible);

pub fn onOpen(this: *ServerWebSocket, ws: uws.AnyWebSocket) void {
    log("OnOpen", .{});

    this.#flags.packed_websocket_ptr = @truncate(@intFromPtr(ws.raw()));
    this.#flags.closed = false;
    this.#flags.ssl = ws == .ssl;

    var handler = this.#handler;
    const vm = this.#handler.vm;
    handler.active_connections +|= 1;
    const globalObject = handler.globalObject;
    const onOpenHandler = handler.onOpen;
    if (vm.isShuttingDown()) {
        log("onOpen called after script execution", .{});
        ws.close();
        return;
    }

    this.#flags.opened = false;

    if (onOpenHandler.isEmptyOrUndefinedOrNull()) {
        return;
    }

    const this_value = this.#this_value.tryGet() orelse .js_undefined;
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
    this.#flags.opened = true;
    if (result.toError()) |err_value| {
        log("onOpen exception", .{});

        if (!this.#flags.closed) {
            this.#flags.closed = true;
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
    const onMessageHandler = this.#handler.onMessage;
    if (onMessageHandler.isEmptyOrUndefinedOrNull()) return;
    var globalObject = this.#handler.globalObject;
    // This is the start of a task.
    const vm = this.#handler.vm;
    if (vm.isShuttingDown()) {
        log("onMessage called after script execution", .{});
        ws.close();
        return;
    }

    const loop = vm.eventLoop();
    loop.enter();
    defer loop.exit();

    const arguments = [_]JSValue{
        this.#this_value.tryGet() orelse .js_undefined,
        switch (opcode) {
            .text => bun.String.createUTF8ForJS(globalObject, message) catch .zero, // TODO: properly propagate exception upwards
            .binary => this.binaryToJS(globalObject, message) catch .zero, // TODO: properly propagate exception upwards
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
        this.#handler.runErrorCallback(vm, globalObject, err_value);
        return;
    }

    if (result.asAnyPromise()) |promise| {
        switch (promise.status()) {
            .rejected => {
                _ = promise.result(globalObject.vm());
                return;
            },

            else => {},
        }
    }
}

pub inline fn isClosed(this: *const ServerWebSocket) bool {
    return this.#flags.closed;
}

pub fn onDrain(this: *ServerWebSocket, _: uws.AnyWebSocket) void {
    log("onDrain", .{});

    const handler = this.#handler;
    const vm = handler.vm;
    if (this.isClosed() or vm.isShuttingDown())
        return;

    if (handler.onDrain != .zero) {
        const globalObject = handler.globalObject;

        var corker = Corker{
            .args = &[_]jsc.JSValue{this.#this_value.tryGet() orelse .js_undefined},
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

fn binaryToJS(this: *const ServerWebSocket, globalThis: *jsc.JSGlobalObject, data: []const u8) bun.JSError!jsc.JSValue {
    return switch (this.#flags.binary_type) {
        .Buffer => jsc.ArrayBuffer.createBuffer(
            globalThis,
            data,
        ),
        .Uint8Array => jsc.ArrayBuffer.create(
            globalThis,
            data,
            .Uint8Array,
        ),
        else => jsc.ArrayBuffer.create(
            globalThis,
            data,
            .ArrayBuffer,
        ),
    };
}

pub fn onPing(this: *ServerWebSocket, _: uws.AnyWebSocket, data: []const u8) void {
    log("onPing: {s}", .{data});

    const handler = this.#handler;
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
        &[_]jsc.JSValue{ this.#this_value.tryGet() orelse .js_undefined, this.binaryToJS(globalThis, data) catch .zero }, // TODO: properly propagate exception upwards
    ) catch |e| {
        const err = globalThis.takeException(e);
        log("onPing error", .{});
        handler.runErrorCallback(vm, globalThis, err);
    };
}

pub fn onPong(this: *ServerWebSocket, _: uws.AnyWebSocket, data: []const u8) void {
    log("onPong: {s}", .{data});

    const handler = this.#handler;
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
        &[_]jsc.JSValue{ this.#this_value.tryGet() orelse .js_undefined, this.binaryToJS(globalThis, data) catch .zero }, // TODO: properly propagate exception upwards
    ) catch |e| {
        const err = globalThis.takeException(e);
        log("onPong error", .{});
        handler.runErrorCallback(vm, globalThis, err);
    };
}

pub fn onClose(this: *ServerWebSocket, _: uws.AnyWebSocket, code: i32, message: []const u8) void {
    log("onClose", .{});
    // TODO: Can this called inside finalize?
    var handler = this.#handler;
    const was_closed = this.isClosed();
    this.#flags.closed = true;
    defer {
        if (!was_closed) {
            handler.active_connections -|= 1;
        }
    }
    const signal = this.#signal;
    this.#signal = null;

    defer {
        if (signal) |sig| {
            sig.pendingActivityUnref();
            sig.unref();
        }

        if (this.#this_value.isNotEmpty()) {
            this.#this_value.downgrade();
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

        const message_js = bun.String.createUTF8ForJS(globalObject, message) catch |e| {
            const err = globalObject.takeException(e);
            log("onClose error (message) {}", .{this.#this_value.isNotEmpty()});
            handler.runErrorCallback(vm, globalObject, err);
            return;
        };

        _ = handler.onClose.call(globalObject, .js_undefined, &[_]jsc.JSValue{ this.#this_value.tryGet() orelse .js_undefined, JSValue.jsNumber(code), message_js }) catch |e| {
            const err = globalObject.takeException(e);
            log("onClose error {}", .{this.#this_value.isNotEmpty()});
            handler.runErrorCallback(vm, globalObject, err);
            return;
        };
    } else if (signal) |sig| {
        const loop = vm.eventLoop();

        loop.enter();
        defer loop.exit();

        if (!sig.aborted()) {
            sig.signal(handler.globalObject, .ConnectionClosed);
        }
    }
}

pub fn behavior(comptime ServerType: type, comptime ssl: bool, opts: uws.WebSocketBehavior) uws.WebSocketBehavior {
    return uws.WebSocketBehavior.Wrap(ServerType, @This(), ssl).apply(opts);
}

pub fn constructor(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*ServerWebSocket {
    return globalObject.throw("Cannot construct ServerWebSocket", .{});
}

pub fn finalize(this: *ServerWebSocket) void {
    log("finalize", .{});
    this.#this_value.finalize();
    if (this.#signal) |signal| {
        this.#signal = null;
        signal.pendingActivityUnref();
        signal.unref();
    }
    bun.destroy(this);
}

pub fn publish(
    this: *ServerWebSocket,
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(4);
    if (args.len < 1) {
        log("publish()", .{});

        return globalThis.throw("publish requires at least 1 argument", .{});
    }

    const app = this.#handler.app orelse {
        log("publish() closed", .{});
        return JSValue.jsNumber(0);
    };
    const flags = this.#handler.flags;
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
        var js_string = try message_value.toJSString(globalThis);
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
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(4);

    if (args.len < 1) {
        log("publish()", .{});
        return globalThis.throw("publish requires at least 1 argument", .{});
    }

    const app = this.#handler.app orelse {
        log("publish() closed", .{});
        return JSValue.jsNumber(0);
    };
    const flags = this.#handler.flags;
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

    var js_string = try message_value.toJSString(globalThis);
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
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(4);

    if (args.len < 1) {
        log("publishBinary()", .{});
        return globalThis.throw("publishBinary requires at least 1 argument", .{});
    }

    const app = this.#handler.app orelse {
        log("publish() closed", .{});
        return JSValue.jsNumber(0);
    };
    const flags = this.#handler.flags;
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
    globalThis: *jsc.JSGlobalObject,
    topic_str: *jsc.JSString,
    array: *jsc.JSUint8Array,
) bun.JSError!jsc.JSValue {
    const app = this.#handler.app orelse {
        log("publish() closed", .{});
        return JSValue.jsNumber(0);
    };
    const flags = this.#handler.flags;
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
        return jsc.JSValue.jsNumber(0);
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
    globalThis: *jsc.JSGlobalObject,
    topic_str: *jsc.JSString,
    str: *jsc.JSString,
) bun.JSError!jsc.JSValue {
    const app = this.#handler.app orelse {
        log("publish() closed", .{});
        return JSValue.jsNumber(0);
    };
    const flags = this.#handler.flags;
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
        return jsc.JSValue.jsNumber(0);
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
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
    this_value: jsc.JSValue,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(1);

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
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
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
        var js_string = try message_value.toJSString(globalThis);
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
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
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

    var js_string = try message_value.toJSString(globalThis);
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
    globalThis: *jsc.JSGlobalObject,
    message_str: *jsc.JSString,
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
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
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
    _: *jsc.JSGlobalObject,
    array_buffer: *jsc.JSUint8Array,
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
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    return sendPing(this, globalThis, callframe, "ping", .ping);
}

pub fn pong(
    this: *ServerWebSocket,
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    return sendPing(this, globalThis, callframe, "pong", .pong);
}

inline fn sendPing(
    this: *ServerWebSocket,
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
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
                var string_value = (try value.toJSString(globalThis)).toSlice(globalThis, bun.default_allocator);
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
    this: *ServerWebSocket,
    _: *jsc.JSGlobalObject,
) JSValue {
    log("getData()", .{});
    if (this.#this_value.tryGet()) |this_value| {
        return js.dataGetCached(this_value) orelse .js_undefined;
    }
    return .js_undefined;
}

pub fn setData(
    this: *ServerWebSocket,
    globalObject: *jsc.JSGlobalObject,
    value: jsc.JSValue,
) void {
    log("setData()", .{});
    if (this.#this_value.tryGet()) |this_value| {
        js.dataSetCached(this_value, globalObject, value);
    }
}

pub fn getReadyState(
    this: *ServerWebSocket,
    _: *jsc.JSGlobalObject,
) JSValue {
    log("getReadyState()", .{});

    if (this.isClosed()) {
        return JSValue.jsNumber(3);
    }

    return JSValue.jsNumber(1);
}

pub fn close(
    this: *ServerWebSocket,
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
    // Since close() can lead to the close() callback being called, let's always ensure the `this` value is up to date.
    _: jsc.JSValue,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(2);
    log("close()", .{});

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

        break :brk try args.ptr[0].coerce(i32, globalThis);
    };

    var message_value: ZigString.Slice = brk: {
        if (args.ptr[1] == .zero or args.ptr[1].isUndefined()) break :brk ZigString.Slice.empty;
        break :brk try args.ptr[1].toSliceOrNull(globalThis);
    };

    defer message_value.deinit();

    this.#flags.closed = true;
    this.websocket().end(code, message_value.slice());
    return .js_undefined;
}

pub fn terminate(
    this: *ServerWebSocket,
    _: *jsc.JSGlobalObject,
    _: *jsc.CallFrame,
    _: jsc.JSValue,
) bun.JSError!JSValue {
    log("terminate()", .{});

    if (this.isClosed()) {
        return .js_undefined;
    }

    this.#flags.closed = true;
    this.websocket().close();

    return .js_undefined;
}

pub fn getBinaryType(
    this: *ServerWebSocket,
    globalThis: *jsc.JSGlobalObject,
) bun.JSError!JSValue {
    log("getBinaryType()", .{});

    return switch (this.#flags.binary_type) {
        .Uint8Array => bun.String.static("uint8array").toJS(globalThis),
        .Buffer => bun.String.static("nodebuffer").toJS(globalThis),
        .ArrayBuffer => bun.String.static("arraybuffer").toJS(globalThis),
        else => @panic("Invalid binary type"),
    };
}

pub fn setBinaryType(this: *ServerWebSocket, globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) bun.JSError!void {
    log("setBinaryType()", .{});

    const btype = try jsc.ArrayBuffer.BinaryType.fromJSValue(globalThis, value);
    switch (btype orelse
        // some other value which we don't support
        .Float64Array) {
        .ArrayBuffer, .Buffer, .Uint8Array => |val| {
            this.#flags.binary_type = val;
            return;
        },
        else => {
            return globalThis.throw("binaryType must be either \"uint8array\" or \"arraybuffer\" or \"nodebuffer\"", .{});
        },
    }
}

pub fn getBufferedAmount(
    this: *ServerWebSocket,
    _: *jsc.JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!JSValue {
    log("getBufferedAmount()", .{});

    if (this.isClosed()) {
        return JSValue.jsNumber(0);
    }

    return JSValue.jsNumber(this.websocket().getBufferedAmount());
}
pub fn subscribe(
    this: *ServerWebSocket,
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(1);
    if (args.len < 1) {
        return globalThis.throw("subscribe requires at least 1 argument", .{});
    }

    if (this.isClosed()) {
        return .true;
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
pub fn unsubscribe(this: *ServerWebSocket, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args = callframe.arguments_old(1);
    if (args.len < 1) {
        return globalThis.throw("unsubscribe requires at least 1 argument", .{});
    }

    if (this.isClosed()) {
        return .true;
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
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    const args = callframe.arguments_old(1);
    if (args.len < 1) {
        return globalThis.throw("isSubscribed requires at least 1 argument", .{});
    }

    if (this.isClosed()) {
        return .false;
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

pub fn getSubscriptions(
    this: *ServerWebSocket,
    globalThis: *jsc.JSGlobalObject,
) bun.JSError!JSValue {
    if (this.isClosed()) {
        return try JSValue.createEmptyArray(globalThis, 0);
    }

    // Get the JSValue directly from C++
    return this.websocket().getTopicsAsJSArray(globalThis);
}

pub fn getRemoteAddress(
    this: *ServerWebSocket,
    globalThis: *jsc.JSGlobalObject,
) bun.JSError!JSValue {
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
    globalObject: *jsc.JSGlobalObject,
    this_value: jsc.JSValue = .zero,
    callback: jsc.JSValue,
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

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Output = bun.Output;
const uws = bun.uws;
const WebSocketServer = bun.api.server.WebSocketServerContext;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
