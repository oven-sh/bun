binary_type: BinaryType = .Buffer,
vm: *JSC.VirtualMachine,
globalObject: *JSC.JSGlobalObject,
active_connections: u32 = 0,
is_server: bool = false,
protection_count: bun.DebugOnly(u32) = if (Environment.isDebug) 0,

pub const js = JSC.Codegen.JSSocketHandlers;

pub const Options = struct {
    onData: JSValue = .zero,
    onWritable: JSValue = .zero,
    onOpen: JSValue = .zero,
    onClose: JSValue = .zero,
    onTimeout: JSValue = .zero,
    onConnectError: JSValue = .zero,
    onEnd: JSValue = .zero,
    onError: JSValue = .zero,
    onHandshake: JSValue = .zero,
    promise: JSValue = .zero,
};

fn toJS(vm: *JSC.VirtualMachine, globalObject: *JSC.JSGlobalObject, is_server: bool, binary_type: BinaryType, opts: *const Options) bun.JSError!JSValue {
    const handlers = bun.new(SocketHandlers, .{
        .vm = vm,
        .globalObject = globalObject,
        .is_server = is_server,
        .binary_type = binary_type,
    });

    const as_js = js.toJS(handlers, globalObject);
    if (opts.onData != .zero) js.onDataSetCached(as_js, opts.onData, globalObject);
    if (opts.onWritable != .zero) js.onWritableSetCached(as_js, opts.onWritable, globalObject);
    if (opts.onOpen != .zero) js.onOpenSetCached(as_js, opts.onOpen, globalObject);
    if (opts.onClose != .zero) js.onCloseSetCached(as_js, opts.onClose, globalObject);
    if (opts.onTimeout != .zero) js.onTimeoutSetCached(as_js, opts.onTimeout, globalObject);
    if (opts.onConnectError != .zero) js.onConnectErrorSetCached(as_js, opts.onConnectError, globalObject);
    if (opts.onEnd != .zero) js.onEndSetCached(as_js, opts.onEnd, globalObject);
    if (opts.onError != .zero) js.onErrorSetCached(as_js, opts.onError, globalObject);
    if (opts.onHandshake != .zero) js.onHandshakeSetCached(as_js, opts.onHandshake, globalObject);
    if (opts.promise != .zero) js.promiseSetCached(as_js, opts.promise, globalObject);

    return as_js;
}

pub fn markActive(this: *SocketHandlers) void {
    Listener.log("markActive", .{});

    this.active_connections += 1;
}

pub const Scope = struct {
    handlers: *SocketHandlers,

    pub fn exit(this: *Scope) void {
        var vm = this.handlers.vm;
        defer vm.eventLoop().exit();
        this.handlers.markInactive();
    }
};

pub fn enter(this: *SocketHandlers) Scope {
    this.markActive();
    this.vm.eventLoop().enter();
    return .{
        .handlers = this,
    };
}

// corker: Corker = .{},

fn getPromise(this_value: JSValue, globalObject: *JSC.JSGlobalObject) ?JSC.AnyPromise {
    if (js.promiseGetCached(this_value)) |promise| {
        js.promiseSetCached(this_value, .zero, globalObject);
        return promise.asAnyPromise();
    }

    return null;
}

pub fn resolvePromise(this: *SocketHandlers, this_value: JSValue, value: JSValue) void {
    const vm = this.vm;
    if (vm.isShuttingDown()) {
        return;
    }

    const promise = getPromise(this_value, this.globalObject) orelse return;
    promise.resolve(this.globalObject, value);
}

pub fn rejectPromise(this: *SocketHandlers, this_value: JSValue, value: JSValue) bool {
    const vm = this.vm;
    if (vm.isShuttingDown()) {
        return true;
    }

    const promise = getPromise(this_value, this.globalObject) orelse return false;
    promise.reject(this.globalObject, value);
    return true;
}

pub fn markInactive(this: *SocketHandlers) void {
    this.active_connections -= 1;
    if (this.active_connections == 0) {
        if (this.is_server) {
            const listen_socket: *Listener = @fieldParentPtr("handlers", this);
            // allow it to be GC'd once the last connection is closed and it's not listening anymore
            if (listen_socket.listener == .none) {
                listen_socket.poll_ref.unref(this.vm);
                listen_socket.this_value.deinit();
            }
        }
    }
}

pub fn callErrorHandler(this: *SocketHandlers, this_handler: JSValue, thisValue: JSValue, err: []const JSValue) bool {
    const vm = this.vm;
    if (vm.isShuttingDown()) {
        return false;
    }

    const globalObject = this.globalObject;
    const onError = js.onErrorGetCached(this_handler) orelse return false;

    if (onError == .zero) {
        if (err.len > 0)
            _ = vm.uncaughtException(globalObject, err[0], false);

        return false;
    }

    _ = onError.call(globalObject, thisValue, err) catch |e|
        globalObject.reportActiveExceptionAsUnhandled(e);

    return true;
}

pub fn create(globalObject: *JSC.JSGlobalObject, opts: JSValue) bun.JSError!JSValue {
    var handlers = SocketHandlers{
        .vm = globalObject.bunVM(),
        .globalObject = globalObject,
    };

    if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
        return globalObject.throwInvalidArguments("Expected \"socket\" to be an object", .{});
    }

    var options = Options{};

    const pairs = .{
        .{ "onData", "data" },
        .{ "onWritable", "drain" },
        .{ "onOpen", "open" },
        .{ "onClose", "close" },
        .{ "onTimeout", "timeout" },
        .{ "onConnectError", "connectError" },
        .{ "onEnd", "end" },
        .{ "onError", "error" },
        .{ "onHandshake", "handshake" },
    };
    inline for (pairs) |pair| {
        if (try opts.getTruthyComptime(globalObject, pair.@"1")) |callback_value| {
            if (!callback_value.isCell() or !callback_value.isCallable()) {
                return globalObject.throwInvalidArguments("Expected \"{s}\" callback to be a function", .{pair[1]});
            }

            @field(options, pair.@"0") = callback_value;
        }
    }

    if (options.onData == .zero and options.onWritable == .zero) {
        return globalObject.throwInvalidArguments("Expected at least \"data\" or \"drain\" callback", .{});
    }

    if (try opts.getTruthy(globalObject, "binaryType")) |binary_type_value| {
        if (!binary_type_value.isString()) {
            return globalObject.throwInvalidArguments("Expected \"binaryType\" to be a string", .{});
        }

        handlers.binary_type = try BinaryType.fromJSValue(globalObject, binary_type_value) orelse {
            return globalObject.throwInvalidArguments("Expected 'binaryType' to be 'ArrayBuffer', 'Uint8Array', or 'Buffer'", .{});
        };
    }

    return toJS(globalObject.bunVM(), globalObject, false, handlers.binary_type, &options);
}

pub fn finalize(this: *SocketHandlers) void {
    bun.destroy(this);
}

const bun = @import("bun");
const JSC = bun.JSC;
const BinaryType = JSC.BinaryType;

const Environment = bun.Environment;
const Listener = JSC.API.Listener;
const JSValue = JSC.JSValue;

const SocketHandlers = @This();
