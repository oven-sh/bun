const Handlers = @This();

onOpen: jsc.JSValue = .zero,
onClose: jsc.JSValue = .zero,
onData: jsc.JSValue = .zero,
onWritable: jsc.JSValue = .zero,
onTimeout: jsc.JSValue = .zero,
onConnectError: jsc.JSValue = .zero,
onEnd: jsc.JSValue = .zero,
onError: jsc.JSValue = .zero,
onHandshake: jsc.JSValue = .zero,

binary_type: BinaryType = .Buffer,

vm: *jsc.VirtualMachine,
globalObject: *jsc.JSGlobalObject,
active_connections: u32 = 0,
is_server: bool,
promise: jsc.Strong.Optional = .empty,

protection_count: if (Environment.ci_assert) u32 else void = if (Environment.ci_assert) 0,

const callback_fields = .{
    "onOpen",
    "onClose",
    "onData",
    "onWritable",
    "onTimeout",
    "onConnectError",
    "onEnd",
    "onError",
    "onHandshake",
};

pub fn markActive(this: *Handlers) void {
    Listener.log("markActive", .{});
    this.active_connections += 1;
}

pub const Scope = struct {
    handlers: *Handlers,

    pub fn exit(this: *Scope) void {
        this.handlers.vm.eventLoop().exit();
        this.handlers.markInactive();
    }
};

pub fn enter(this: *Handlers) Scope {
    this.markActive();
    this.vm.eventLoop().enter();
    return .{ .handlers = this };
}

// corker: Corker = .{},

pub fn resolvePromise(this: *Handlers, value: JSValue) bun.JSTerminated!void {
    const vm = this.vm;
    if (vm.isShuttingDown()) {
        return;
    }

    const promise = this.promise.trySwap() orelse return;
    const anyPromise = promise.asAnyPromise() orelse return;
    try anyPromise.resolve(this.globalObject, value);
}

pub fn rejectPromise(this: *Handlers, value: JSValue) bun.JSTerminated!bool {
    const vm = this.vm;
    if (vm.isShuttingDown()) {
        return true;
    }

    const promise = this.promise.trySwap() orelse return false;
    const anyPromise = promise.asAnyPromise() orelse return false;
    try anyPromise.reject(this.globalObject, value);
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
            const vm = this.vm;
            this.deinit();
            vm.allocator.destroy(this);
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

pub fn fromJS(
    globalObject: *jsc.JSGlobalObject,
    opts: jsc.JSValue,
    is_server: bool,
) bun.JSError!Handlers {
    var generated: jsc.generated.SocketConfigHandlers = try .fromJS(globalObject, opts);
    defer generated.deinit();
    return .fromGenerated(globalObject, &generated, is_server);
}

pub fn fromGenerated(
    globalObject: *jsc.JSGlobalObject,
    generated: *const jsc.generated.SocketConfigHandlers,
    is_server: bool,
) bun.JSError!Handlers {
    var result: Handlers = .{
        .vm = globalObject.bunVM(),
        .globalObject = globalObject,
        .is_server = is_server,
        .binary_type = switch (generated.binary_type) {
            .arraybuffer => .ArrayBuffer,
            .buffer => .Buffer,
            .uint8array => .Uint8Array,
        },
    };
    inline for (callback_fields) |field| {
        const value = @field(generated, field);
        if (value.isUndefinedOrNull()) {} else if (!value.isCallable()) {
            return globalObject.throwInvalidArguments(
                "Expected \"{s}\" callback to be a function",
                .{field},
            );
        } else {
            @field(result, field) = value;
        }
    }
    if (result.onData == .zero and result.onWritable == .zero) {
        return globalObject.throwInvalidArguments(
            "Expected at least \"data\" or \"drain\" callback",
            .{},
        );
    }
    result.withAsyncContextIfNeeded(globalObject);
    result.protect();
    return result;
}

pub fn deinit(this: *Handlers) void {
    this.unprotect();
    this.promise.deinit();
    this.* = undefined;
}

fn unprotect(this: *Handlers) void {
    if (this.vm.isShuttingDown()) {
        return;
    }

    if (comptime Environment.ci_assert) {
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

fn withAsyncContextIfNeeded(this: *Handlers, globalObject: *jsc.JSGlobalObject) void {
    inline for (callback_fields) |field| {
        const value = @field(this, field);
        if (value != .zero) {
            @field(this, field) = value.withAsyncContextIfNeeded(globalObject);
        }
    }
}

fn protect(this: *Handlers) void {
    if (comptime Environment.ci_assert) {
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

pub fn clone(this: *const Handlers) Handlers {
    var result: Handlers = .{
        .vm = this.vm,
        .globalObject = this.globalObject,
        .binary_type = this.binary_type,
        .is_server = this.is_server,
    };
    inline for (callback_fields) |field| {
        @field(result, field) = @field(this, field);
    }
    result.protect();
    return result;
}

/// `handlers` is always `protect`ed in this struct.
pub const SocketConfig = struct {
    hostname_or_unix: jsc.ZigString.Slice,
    port: ?u16 = null,
    fd: ?bun.FileDescriptor = null,
    ssl: ?SSLConfig = null,
    handlers: Handlers,
    default_data: jsc.JSValue = .zero,
    exclusive: bool = false,
    allowHalfOpen: bool = false,
    reusePort: bool = false,
    ipv6Only: bool = false,

    /// Deinitializes everything and `unprotect`s `handlers`.
    pub fn deinit(this: *SocketConfig) void {
        this.handlers.deinit();
        this.deinitExcludingHandlers();
        this.handlers = undefined;
    }

    /// Deinitializes everything except `handlers`.
    pub fn deinitExcludingHandlers(this: *SocketConfig) void {
        this.hostname_or_unix.deinit();
        bun.memory.deinit(&this.ssl);
        const handlers = this.handlers;
        this.* = undefined;
        // make sure pointers to `this.handlers` are still valid
        this.handlers = handlers;
    }

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

    pub fn fromGenerated(
        vm: *jsc.VirtualMachine,
        global: *jsc.JSGlobalObject,
        generated: *const jsc.generated.SocketConfig,
        is_server: bool,
    ) bun.JSError!SocketConfig {
        var result: SocketConfig = blk: {
            var ssl: ?SSLConfig = switch (generated.tls) {
                .none => null,
                .boolean => |b| if (b) .zero else null,
                .object => |*ssl| try .fromGenerated(vm, global, ssl),
            };
            errdefer bun.memory.deinit(&ssl);
            break :blk .{
                .hostname_or_unix = .empty,
                .fd = if (generated.fd) |fd| .fromUV(fd) else null,
                .ssl = ssl,
                .handlers = try .fromGenerated(global, &generated.handlers, is_server),
                .default_data = if (generated.data.isUndefined()) .zero else generated.data,
            };
        };
        errdefer result.deinit();

        if (result.fd != null) {
            // If a user passes a file descriptor then prefer it over hostname or unix
        } else if (generated.unix_.get()) |unix| {
            bun.assertf(unix.length() > 0, "truthy bindgen string shouldn't be empty", .{});
            result.hostname_or_unix = unix.toUTF8(bun.default_allocator);
            const slice = result.hostname_or_unix.slice();
            if (strings.hasPrefixComptime(slice, "file://") or
                strings.hasPrefixComptime(slice, "unix://") or
                strings.hasPrefixComptime(slice, "sock://"))
            {
                const without_prefix = try bun.default_allocator.dupe(u8, slice[7..]);
                result.hostname_or_unix.deinit();
                result.hostname_or_unix = .init(bun.default_allocator, without_prefix);
            }
        } else if (generated.hostname.get()) |hostname| {
            bun.assertf(hostname.length() > 0, "truthy bindgen string shouldn't be empty", .{});
            result.hostname_or_unix = hostname.toUTF8(bun.default_allocator);
            const slice = result.hostname_or_unix.slice();
            result.port = generated.port orelse bun.URL.parse(slice).getPort() orelse {
                return global.throwInvalidArguments("Missing \"port\"", .{});
            };
            result.exclusive = generated.exclusive;
            result.allowHalfOpen = generated.allow_half_open;
            result.reusePort = generated.reuse_port;
            result.ipv6Only = generated.ipv6_only;
        } else {
            return global.throwInvalidArguments("Expected either \"hostname\" or \"unix\"", .{});
        }
        return result;
    }

    pub fn fromJS(
        vm: *jsc.VirtualMachine,
        opts: jsc.JSValue,
        globalObject: *jsc.JSGlobalObject,
        is_server: bool,
    ) bun.JSError!SocketConfig {
        var generated: jsc.generated.SocketConfig = try .fromJS(globalObject, opts);
        defer generated.deinit();
        return .fromGenerated(vm, globalObject, &generated, is_server);
    }
};

const bun = @import("bun");
const Environment = bun.Environment;
const strings = bun.strings;
const uws = bun.uws;
const Listener = bun.api.Listener;
const SSLConfig = bun.api.ServerConfig.SSLConfig;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const BinaryType = jsc.ArrayBuffer.BinaryType;
