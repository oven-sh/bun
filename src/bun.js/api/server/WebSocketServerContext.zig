const WebSocketServerContext = @This();

globalObject: *JSC.JSGlobalObject = undefined,
handler: Handler = .{},

maxPayloadLength: u32 = 1024 * 1024 * 16, // 16MB
maxLifetime: u16 = 0,
idleTimeout: u16 = 120, // 2 minutes
compression: i32 = 0,
backpressureLimit: u32 = 1024 * 1024 * 16, // 16MB
sendPingsAutomatically: bool = true,
resetIdleTimeoutOnSend: bool = true,
closeOnBackpressureLimit: bool = false,

pub const Handler = struct {
    onOpen: JSC.JSValue = .zero,
    onMessage: JSC.JSValue = .zero,
    onClose: JSC.JSValue = .zero,
    onDrain: JSC.JSValue = .zero,
    onError: JSC.JSValue = .zero,
    onPing: JSC.JSValue = .zero,
    onPong: JSC.JSValue = .zero,

    app: ?*anyopaque = null,

    // Always set manually.
    vm: *JSC.VirtualMachine = undefined,
    globalObject: *JSC.JSGlobalObject = undefined,
    active_connections: usize = 0,

    /// used by publish()
    flags: packed struct(u2) {
        ssl: bool = false,
        publish_to_self: bool = false,
    } = .{},

    pub fn runErrorCallback(this: *const Handler, vm: *JSC.VirtualMachine, globalObject: *JSC.JSGlobalObject, error_value: JSC.JSValue) void {
        const onError = this.onError;
        if (!onError.isEmptyOrUndefinedOrNull()) {
            _ = onError.call(globalObject, .js_undefined, &.{error_value}) catch |err|
                this.globalObject.reportActiveExceptionAsUnhandled(err);
            return;
        }

        _ = vm.uncaughtException(globalObject, error_value, false);
    }

    pub fn fromJS(globalObject: *JSC.JSGlobalObject, object: JSC.JSValue) bun.JSError!Handler {
        var handler = Handler{ .globalObject = globalObject, .vm = VirtualMachine.get() };

        var valid = false;

        if (try object.getTruthyComptime(globalObject, "message")) |message_| {
            if (!message_.isCallable()) {
                return globalObject.throwInvalidArguments("websocket expects a function for the message option", .{});
            }
            const message = message_.withAsyncContextIfNeeded(globalObject);
            handler.onMessage = message;
            message.ensureStillAlive();
            valid = true;
        }

        if (try object.getTruthy(globalObject, "open")) |open_| {
            if (!open_.isCallable()) {
                return globalObject.throwInvalidArguments("websocket expects a function for the open option", .{});
            }
            const open = open_.withAsyncContextIfNeeded(globalObject);
            handler.onOpen = open;
            open.ensureStillAlive();
            valid = true;
        }

        if (try object.getTruthy(globalObject, "close")) |close_| {
            if (!close_.isCallable()) {
                return globalObject.throwInvalidArguments("websocket expects a function for the close option", .{});
            }
            const close = close_.withAsyncContextIfNeeded(globalObject);
            handler.onClose = close;
            close.ensureStillAlive();
            valid = true;
        }

        if (try object.getTruthy(globalObject, "drain")) |drain_| {
            if (!drain_.isCallable()) {
                return globalObject.throwInvalidArguments("websocket expects a function for the drain option", .{});
            }
            const drain = drain_.withAsyncContextIfNeeded(globalObject);
            handler.onDrain = drain;
            drain.ensureStillAlive();
            valid = true;
        }

        if (try object.getTruthy(globalObject, "onError")) |onError_| {
            if (!onError_.isCallable()) {
                return globalObject.throwInvalidArguments("websocket expects a function for the onError option", .{});
            }
            const onError = onError_.withAsyncContextIfNeeded(globalObject);
            handler.onError = onError;
            onError.ensureStillAlive();
        }

        if (try object.getTruthy(globalObject, "ping")) |cb| {
            if (!cb.isCallable()) {
                return globalObject.throwInvalidArguments("websocket expects a function for the ping option", .{});
            }
            handler.onPing = cb;
            cb.ensureStillAlive();
            valid = true;
        }

        if (try object.getTruthy(globalObject, "pong")) |cb| {
            if (!cb.isCallable()) {
                return globalObject.throwInvalidArguments("websocket expects a function for the pong option", .{});
            }
            handler.onPong = cb;
            cb.ensureStillAlive();
            valid = true;
        }

        if (valid)
            return handler;

        return globalObject.throwInvalidArguments("WebSocketServerContext expects a message handler", .{});
    }

    pub fn protect(this: Handler) void {
        this.onOpen.protect();
        this.onMessage.protect();
        this.onClose.protect();
        this.onDrain.protect();
        this.onError.protect();
        this.onPing.protect();
        this.onPong.protect();
    }

    pub fn unprotect(this: Handler) void {
        if (this.vm.isShuttingDown()) {
            return;
        }

        this.onOpen.unprotect();
        this.onMessage.unprotect();
        this.onClose.unprotect();
        this.onDrain.unprotect();
        this.onError.unprotect();
        this.onPing.unprotect();
        this.onPong.unprotect();
    }
};

pub fn toBehavior(this: WebSocketServerContext) uws.WebSocketBehavior {
    return .{
        .maxPayloadLength = this.maxPayloadLength,
        .idleTimeout = this.idleTimeout,
        .compression = this.compression,
        .maxBackpressure = this.backpressureLimit,
        .sendPingsAutomatically = this.sendPingsAutomatically,
        .maxLifetime = this.maxLifetime,
        .resetIdleTimeoutOnSend = this.resetIdleTimeoutOnSend,
        .closeOnBackpressureLimit = this.closeOnBackpressureLimit,
    };
}

pub fn protect(this: WebSocketServerContext) void {
    this.handler.protect();
}
pub fn unprotect(this: WebSocketServerContext) void {
    this.handler.unprotect();
}

const CompressTable = bun.ComptimeStringMap(i32, .{
    .{ "disable", 0 },
    .{ "shared", uws.SHARED_COMPRESSOR },
    .{ "dedicated", uws.DEDICATED_COMPRESSOR },
    .{ "3KB", uws.DEDICATED_COMPRESSOR_3KB },
    .{ "4KB", uws.DEDICATED_COMPRESSOR_4KB },
    .{ "8KB", uws.DEDICATED_COMPRESSOR_8KB },
    .{ "16KB", uws.DEDICATED_COMPRESSOR_16KB },
    .{ "32KB", uws.DEDICATED_COMPRESSOR_32KB },
    .{ "64KB", uws.DEDICATED_COMPRESSOR_64KB },
    .{ "128KB", uws.DEDICATED_COMPRESSOR_128KB },
    .{ "256KB", uws.DEDICATED_COMPRESSOR_256KB },
});

const DecompressTable = bun.ComptimeStringMap(i32, .{
    .{ "disable", 0 },
    .{ "shared", uws.SHARED_DECOMPRESSOR },
    .{ "dedicated", uws.DEDICATED_DECOMPRESSOR },
    .{ "3KB", uws.DEDICATED_COMPRESSOR_3KB },
    .{ "4KB", uws.DEDICATED_COMPRESSOR_4KB },
    .{ "8KB", uws.DEDICATED_COMPRESSOR_8KB },
    .{ "16KB", uws.DEDICATED_COMPRESSOR_16KB },
    .{ "32KB", uws.DEDICATED_COMPRESSOR_32KB },
    .{ "64KB", uws.DEDICATED_COMPRESSOR_64KB },
    .{ "128KB", uws.DEDICATED_COMPRESSOR_128KB },
    .{ "256KB", uws.DEDICATED_COMPRESSOR_256KB },
});

pub fn onCreate(globalObject: *JSC.JSGlobalObject, object: JSValue) bun.JSError!WebSocketServerContext {
    var server = WebSocketServerContext{};
    server.handler = try Handler.fromJS(globalObject, object);

    if (try object.get(globalObject, "perMessageDeflate")) |per_message_deflate| {
        getter: {
            if (per_message_deflate.isUndefined()) {
                break :getter;
            }

            if (per_message_deflate.isBoolean() or per_message_deflate.isNull()) {
                if (per_message_deflate.toBoolean()) {
                    server.compression = uws.SHARED_COMPRESSOR | uws.SHARED_DECOMPRESSOR;
                } else {
                    server.compression = 0;
                }
                break :getter;
            }

            if (try per_message_deflate.getTruthy(globalObject, "compress")) |compression| {
                if (compression.isBoolean()) {
                    server.compression |= if (compression.toBoolean()) uws.SHARED_COMPRESSOR else 0;
                } else if (compression.isString()) {
                    server.compression |= CompressTable.getWithEql(try compression.getZigString(globalObject), ZigString.eqlComptime) orelse {
                        return globalObject.throwInvalidArguments("WebSocketServerContext expects a valid compress option, either disable \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"", .{});
                    };
                } else {
                    return globalObject.throwInvalidArguments("websocket expects a valid compress option, either disable \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"", .{});
                }
            }

            if (try per_message_deflate.getTruthy(globalObject, "decompress")) |compression| {
                if (compression.isBoolean()) {
                    server.compression |= if (compression.toBoolean()) uws.SHARED_DECOMPRESSOR else 0;
                } else if (compression.isString()) {
                    server.compression |= DecompressTable.getWithEql(try compression.getZigString(globalObject), ZigString.eqlComptime) orelse {
                        return globalObject.throwInvalidArguments("websocket expects a valid decompress option, either \"disable\" \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"", .{});
                    };
                } else {
                    return globalObject.throwInvalidArguments("websocket expects a valid decompress option, either \"disable\" \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"", .{});
                }
            }
        }
    }

    if (try object.get(globalObject, "maxPayloadLength")) |value| {
        if (!value.isUndefinedOrNull()) {
            if (!value.isAnyInt()) {
                return globalObject.throwInvalidArguments("websocket expects maxPayloadLength to be an integer", .{});
            }
            server.maxPayloadLength = @truncate(@max(value.toInt64(), 0));
        }
    }

    if (try object.get(globalObject, "idleTimeout")) |value| {
        if (!value.isUndefinedOrNull()) {
            if (!value.isAnyInt()) {
                return globalObject.throwInvalidArguments("websocket expects idleTimeout to be an integer", .{});
            }

            var idleTimeout: u16 = @truncate(@max(value.toInt64(), 0));
            if (idleTimeout > 960) {
                return globalObject.throwInvalidArguments("websocket expects idleTimeout to be 960 or less", .{});
            } else if (idleTimeout > 0) {
                // uws does not allow idleTimeout to be between (0, 8),
                // since its timer is not that accurate, therefore round up.
                idleTimeout = @max(idleTimeout, 8);
            }

            server.idleTimeout = idleTimeout;
        }
    }
    if (try object.get(globalObject, "backpressureLimit")) |value| {
        if (!value.isUndefinedOrNull()) {
            if (!value.isAnyInt()) {
                return globalObject.throwInvalidArguments("websocket expects backpressureLimit to be an integer", .{});
            }

            server.backpressureLimit = @truncate(@max(value.toInt64(), 0));
        }
    }

    if (try object.get(globalObject, "closeOnBackpressureLimit")) |value| {
        if (!value.isUndefinedOrNull()) {
            if (!value.isBoolean()) {
                return globalObject.throwInvalidArguments("websocket expects closeOnBackpressureLimit to be a boolean", .{});
            }

            server.closeOnBackpressureLimit = value.toBoolean();
        }
    }

    if (try object.get(globalObject, "sendPings")) |value| {
        if (!value.isUndefinedOrNull()) {
            if (!value.isBoolean()) {
                return globalObject.throwInvalidArguments("websocket expects sendPings to be a boolean", .{});
            }

            server.sendPingsAutomatically = value.toBoolean();
        }
    }

    if (try object.get(globalObject, "publishToSelf")) |value| {
        if (!value.isUndefinedOrNull()) {
            if (!value.isBoolean()) {
                return globalObject.throwInvalidArguments("websocket expects publishToSelf to be a boolean", .{});
            }

            server.handler.flags.publish_to_self = value.toBoolean();
        }
    }

    server.protect();
    return server;
}

const bun = @import("bun");
const uws = bun.uws;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSError = bun.JSError;
const VirtualMachine = JSC.VirtualMachine;
const ZigString = JSC.ZigString;
