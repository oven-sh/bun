const Handlers = @This();

onOpen: JSC.JSValue = .zero,
onClose: JSC.JSValue = .zero,
onData: JSC.JSValue = .zero,
onWritable: JSC.JSValue = .zero,
onTimeout: JSC.JSValue = .zero,
onConnectError: JSC.JSValue = .zero,
onEnd: JSC.JSValue = .zero,
onError: JSC.JSValue = .zero,
onHandshake: JSC.JSValue = .zero,

binary_type: BinaryType = .Buffer,

vm: *JSC.VirtualMachine,
globalObject: *JSC.JSGlobalObject,
active_connections: u32 = 0,
is_server: bool,
promise: JSC.Strong.Optional = .empty,

protection_count: bun.DebugOnly(u32) = if (Environment.isDebug) 0,

pub fn markActive(this: *Handlers) void {
    Listener.log("markActive", .{});

    this.active_connections += 1;
}

pub const Scope = struct {
    handlers: *Handlers,

    pub fn exit(this: *Scope) void {
        var vm = this.handlers.vm;
        defer vm.eventLoop().exit();
        this.handlers.markInactive();
    }
};

pub fn enter(this: *Handlers) Scope {
    this.markActive();
    this.vm.eventLoop().enter();
    return .{
        .handlers = this,
    };
}

// corker: Corker = .{},

pub fn resolvePromise(this: *Handlers, value: JSValue) void {
    const vm = this.vm;
    if (vm.isShuttingDown()) {
        return;
    }

    const promise = this.promise.trySwap() orelse return;
    const anyPromise = promise.asAnyPromise() orelse return;
    anyPromise.resolve(this.globalObject, value);
}

pub fn rejectPromise(this: *Handlers, value: JSValue) bool {
    const vm = this.vm;
    if (vm.isShuttingDown()) {
        return true;
    }

    const promise = this.promise.trySwap() orelse return false;
    const anyPromise = promise.asAnyPromise() orelse return false;
    anyPromise.reject(this.globalObject, value);
    return true;
}

pub fn markInactive(this: *Handlers) void {
    Listener.log("markInactive", .{});
    this.active_connections -= 1;
    if (this.active_connections == 0) {
        if (this.is_server) {
            const listen_socket: *Listener = @fieldParentPtr("handlers", this);
            // allow it to be GC'd once the last connection is closed and it's not listening anymore
            if (listen_socket.listener == .none) {
                listen_socket.poll_ref.unref(this.vm);
                listen_socket.strong_self.deinit();
            }
        } else {
            this.unprotect();
            bun.default_allocator.destroy(this);
        }
    }
}

pub fn callErrorHandler(this: *Handlers, thisValue: JSValue, args: *const [2]JSValue) bool {
    const vm = this.vm;
    if (vm.isShuttingDown()) {
        return false;
    }

    const globalObject = this.globalObject;
    const onError = this.onError;

    if (onError == .zero) {
        _ = vm.uncaughtException(globalObject, args[1], false);
        return false;
    }

    _ = onError.call(globalObject, thisValue, args) catch |e| globalObject.reportActiveExceptionAsUnhandled(e);

    return true;
}

pub fn fromJS(globalObject: *JSC.JSGlobalObject, opts: JSC.JSValue, is_server: bool) bun.JSError!Handlers {
    var handlers = Handlers{
        .vm = globalObject.bunVM(),
        .globalObject = globalObject,
        .is_server = is_server,
    };

    if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
        return globalObject.throwInvalidArguments("Expected \"socket\" to be an object", .{});
    }

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

            @field(handlers, pair.@"0") = callback_value;
        }
    }

    if (handlers.onData == .zero and handlers.onWritable == .zero) {
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

    return handlers;
}

pub fn unprotect(this: *Handlers) void {
    if (this.vm.isShuttingDown()) {
        return;
    }

    if (comptime Environment.isDebug) {
        bun.assert(this.protection_count > 0);
        this.protection_count -= 1;
    }
    this.onOpen.unprotect();
    this.onClose.unprotect();
    this.onData.unprotect();
    this.onWritable.unprotect();
    this.onTimeout.unprotect();
    this.onConnectError.unprotect();
    this.onEnd.unprotect();
    this.onError.unprotect();
    this.onHandshake.unprotect();
}

pub fn protect(this: *Handlers) void {
    if (comptime Environment.isDebug) {
        this.protection_count += 1;
    }
    this.onOpen.protect();
    this.onClose.protect();
    this.onData.protect();
    this.onWritable.protect();
    this.onTimeout.protect();
    this.onConnectError.protect();
    this.onEnd.protect();
    this.onError.protect();
    this.onHandshake.protect();
}

const BinaryType = JSC.ArrayBuffer.BinaryType;

pub const SocketConfig = struct {
    hostname_or_unix: JSC.ZigString.Slice,
    port: ?u16 = null,
    fd: ?bun.FileDescriptor = null,
    ssl: ?JSC.API.ServerConfig.SSLConfig = null,
    handlers: Handlers,
    default_data: JSC.JSValue = .zero,
    exclusive: bool = false,
    allowHalfOpen: bool = false,
    reusePort: bool = false,
    ipv6Only: bool = false,

    pub fn socketFlags(this: *const SocketConfig) i32 {
        var flags: i32 = if (this.exclusive)
            uws.LIBUS_LISTEN_EXCLUSIVE_PORT
        else if (this.reusePort)
            uws.LIBUS_LISTEN_REUSE_PORT | uws.LIBUS_LISTEN_REUSE_ADDR
        else
            uws.LIBUS_LISTEN_DEFAULT;

        if (this.allowHalfOpen) {
            flags |= uws.LIBUS_SOCKET_ALLOW_HALF_OPEN;
        }
        if (this.ipv6Only) {
            flags |= uws.LIBUS_SOCKET_IPV6_ONLY;
        }

        return flags;
    }

    pub fn fromJS(vm: *JSC.VirtualMachine, opts: JSC.JSValue, globalObject: *JSC.JSGlobalObject, is_server: bool) bun.JSError!SocketConfig {
        var hostname_or_unix: JSC.ZigString.Slice = JSC.ZigString.Slice.empty;
        errdefer hostname_or_unix.deinit();
        var port: ?u16 = null;
        var fd: ?bun.FileDescriptor = null;
        var exclusive = false;
        var allowHalfOpen = false;
        var reusePort = false;
        var ipv6Only = false;

        var ssl: ?JSC.API.ServerConfig.SSLConfig = null;
        var default_data = JSValue.zero;

        if (try opts.getTruthy(globalObject, "tls")) |tls| {
            if (tls.isBoolean()) {
                if (tls.toBoolean()) {
                    ssl = JSC.API.ServerConfig.SSLConfig.zero;
                }
            } else {
                if (try JSC.API.ServerConfig.SSLConfig.fromJS(vm, globalObject, tls)) |ssl_config| {
                    ssl = ssl_config;
                }
            }
        }

        errdefer {
            if (ssl != null) {
                ssl.?.deinit();
            }
        }

        hostname_or_unix: {
            if (try opts.getTruthy(globalObject, "fd")) |fd_| {
                if (fd_.isNumber()) {
                    fd = fd_.asFileDescriptor();
                    break :hostname_or_unix;
                }
            }

            if (try opts.getStringish(globalObject, "unix")) |unix_socket| {
                defer unix_socket.deref();

                hostname_or_unix = try unix_socket.toUTF8WithoutRef(bun.default_allocator).cloneIfNeeded(bun.default_allocator);

                if (strings.hasPrefixComptime(hostname_or_unix.slice(), "file://") or strings.hasPrefixComptime(hostname_or_unix.slice(), "unix://") or strings.hasPrefixComptime(hostname_or_unix.slice(), "sock://")) {
                    // The memory allocator relies on the pointer address to
                    // free it, so if we simply moved the pointer up it would
                    // cause an issue when freeing it later.
                    const moved_bytes = try bun.default_allocator.dupeZ(u8, hostname_or_unix.slice()[7..]);
                    hostname_or_unix.deinit();
                    hostname_or_unix = ZigString.Slice.init(bun.default_allocator, moved_bytes);
                }

                if (hostname_or_unix.len > 0) {
                    break :hostname_or_unix;
                }
            }

            if (try opts.getBooleanLoose(globalObject, "exclusive")) |exclusive_| {
                exclusive = exclusive_;
            }
            if (try opts.getBooleanLoose(globalObject, "allowHalfOpen")) |allow_half_open| {
                allowHalfOpen = allow_half_open;
            }

            if (try opts.getBooleanLoose(globalObject, "reusePort")) |reuse_port| {
                reusePort = reuse_port;
            }

            if (try opts.getBooleanLoose(globalObject, "ipv6Only")) |ipv6_only| {
                ipv6Only = ipv6_only;
            }

            if (try opts.getStringish(globalObject, "hostname") orelse try opts.getStringish(globalObject, "host")) |hostname| {
                defer hostname.deref();

                var port_value = try opts.get(globalObject, "port") orelse JSValue.zero;
                hostname_or_unix = try hostname.toUTF8WithoutRef(bun.default_allocator).cloneIfNeeded(bun.default_allocator);

                if (port_value.isEmptyOrUndefinedOrNull() and hostname_or_unix.len > 0) {
                    const parsed_url = bun.URL.parse(hostname_or_unix.slice());
                    if (parsed_url.getPort()) |port_num| {
                        port_value = JSValue.jsNumber(port_num);
                        if (parsed_url.hostname.len > 0) {
                            const moved_bytes = try bun.default_allocator.dupeZ(u8, parsed_url.hostname);
                            hostname_or_unix.deinit();
                            hostname_or_unix = ZigString.Slice.init(bun.default_allocator, moved_bytes);
                        }
                    }
                }

                if (port_value.isEmptyOrUndefinedOrNull()) {
                    return globalObject.throwInvalidArguments("Expected \"port\" to be a number between 0 and 65535", .{});
                }

                const porti32 = port_value.coerceToInt32(globalObject);
                if (globalObject.hasException()) {
                    return error.JSError;
                }

                if (porti32 < 0 or porti32 > 65535) {
                    return globalObject.throwInvalidArguments("Expected \"port\" to be a number between 0 and 65535", .{});
                }

                port = @intCast(porti32);

                if (hostname_or_unix.len == 0) {
                    return globalObject.throwInvalidArguments("Expected \"hostname\" to be a non-empty string", .{});
                }

                if (hostname_or_unix.len > 0) {
                    break :hostname_or_unix;
                }
            }

            if (hostname_or_unix.len == 0) {
                return globalObject.throwInvalidArguments("Expected \"unix\" or \"hostname\" to be a non-empty string", .{});
            }

            return globalObject.throwInvalidArguments("Expected either \"hostname\" or \"unix\"", .{});
        }

        var handlers = try Handlers.fromJS(globalObject, try opts.get(globalObject, "socket") orelse JSValue.zero, is_server);

        if (try opts.fastGet(globalObject, .data)) |default_data_value| {
            default_data = default_data_value;
        }

        handlers.protect();

        return SocketConfig{
            .hostname_or_unix = hostname_or_unix,
            .port = port,
            .fd = fd,
            .ssl = ssl,
            .handlers = handlers,
            .default_data = default_data,
            .exclusive = exclusive,
            .allowHalfOpen = allowHalfOpen,
            .reusePort = reusePort,
            .ipv6Only = ipv6Only,
        };
    }
};

const bun = @import("bun");
const Listener = JSC.API.Listener;
const uws = bun.uws;
const Environment = bun.Environment;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;
const strings = bun.strings;
