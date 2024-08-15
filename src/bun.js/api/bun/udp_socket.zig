const std = @import("std");
const uws = @import("../../../deps/uws.zig");
const bun = @import("root").bun;

const strings = bun.strings;
const default_allocator = bun.default_allocator;
const Output = bun.Output;
const Async = bun.Async;
const JSC = bun.JSC;
const CallFrame = JSC.CallFrame;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;

const log = Output.scoped(.UdpSocket, false);

const INET6_ADDRSTRLEN = if (bun.Environment.isWindows) 65 else 46;

extern fn ntohs(nshort: u16) u16;
extern fn htonl(hlong: u32) u32;
extern fn htons(hshort: u16) u16;
extern fn inet_ntop(af: c_int, src: ?*const anyopaque, dst: [*c]u8, size: c_int) ?[*:0]const u8;
extern fn inet_pton(af: c_int, src: [*c]const u8, dst: ?*anyopaque) c_int;
extern fn JSSocketAddress__create(global: *JSGlobalObject, address: JSValue, port: i32, v6: bool) JSValue;

fn onClose(socket: *uws.udp.Socket) callconv(.C) void {
    JSC.markBinding(@src());

    const this: *UDPSocket = bun.cast(*UDPSocket, socket.user().?);
    this.closed = true;
    this.poll_ref.disable();
    _ = this.js_refcount.fetchSub(1, .monotonic);
}

fn onDrain(socket: *uws.udp.Socket) callconv(.C) void {
    JSC.markBinding(@src());

    const this: *UDPSocket = bun.cast(*UDPSocket, socket.user().?);
    const callback = this.config.on_drain;
    if (callback == .zero) return;

    const vm = JSC.VirtualMachine.get();
    const event_loop = vm.eventLoop();
    event_loop.enter();
    defer event_loop.exit();
    const result = callback.call(this.globalThis, this.thisValue, &[_]JSValue{this.thisValue});
    if (result.toError()) |err| {
        _ = this.callErrorHandler(.zero, &[_]JSValue{err});
    }
}

fn onData(socket: *uws.udp.Socket, buf: *uws.udp.PacketBuffer, packets: c_int) callconv(.C) void {
    JSC.markBinding(@src());

    const udpSocket: *UDPSocket = bun.cast(*UDPSocket, socket.user().?);
    const callback = udpSocket.config.on_data;
    if (callback == .zero) return;

    const globalThis = udpSocket.globalThis;

    var i: c_int = 0;
    while (i < packets) : (i += 1) {
        const peer = buf.getPeer(i);

        var addr_buf: [INET6_ADDRSTRLEN + 1:0]u8 = undefined;
        var hostname: ?[*:0]const u8 = null;
        var port: u16 = 0;

        switch (peer.family) {
            std.posix.AF.INET => {
                const peer4: *std.posix.sockaddr.in = @ptrCast(peer);
                hostname = inet_ntop(peer.family, &peer4.addr, &addr_buf, addr_buf.len);
                port = ntohs(peer4.port);
            },
            std.posix.AF.INET6 => {
                const peer6: *std.posix.sockaddr.in6 = @ptrCast(peer);
                hostname = inet_ntop(peer.family, &peer6.addr, &addr_buf, addr_buf.len);
                port = ntohs(peer6.port);
            },
            else => continue,
        }

        if (hostname == null or port == 0) {
            continue;
        }

        const slice = buf.getPayload(i);

        const loop = udpSocket.vm.eventLoop();
        loop.enter();
        defer loop.exit();
        _ = udpSocket.js_refcount.fetchAdd(1, .monotonic);
        defer _ = udpSocket.js_refcount.fetchSub(1, .monotonic);

        const result = callback.call(globalThis, udpSocket.thisValue, &[_]JSValue{
            udpSocket.thisValue,
            udpSocket.config.binary_type.toJS(slice, globalThis),
            JSC.jsNumber(port),
            JSC.ZigString.init(std.mem.span(hostname.?)).toJS(globalThis),
        });

        if (result.toError()) |err| {
            _ = udpSocket.callErrorHandler(.zero, &[_]JSValue{err});
        }
    }
}

pub const UDPSocketConfig = struct {
    const This = @This();
    const handlers = .{
        .{ "data", "on_data" },
        .{ "drain", "on_drain" },
        .{ "error", "on_error" },
    };

    const ConnectConfig = struct {
        port: u16,
        address: [:0]u8,
    };

    hostname: [:0]u8,
    connect: ?ConnectConfig = null,
    port: u16,
    binary_type: JSC.BinaryType = .Buffer,
    on_data: JSValue = .zero,
    on_drain: JSValue = .zero,
    on_error: JSValue = .zero,

    pub fn fromJS(globalThis: *JSGlobalObject, options: JSValue) ?This {
        if (options.isEmptyOrUndefinedOrNull() or !options.isObject()) {
            globalThis.throwInvalidArguments("Expected an object", .{});
            return null;
        }

        const hostname = brk: {
            if (options.getTruthy(globalThis, "hostname")) |value| {
                if (!value.isString()) {
                    globalThis.throwInvalidArguments("Expected \"hostname\" to be a string", .{});
                    return null;
                }
                const str = value.toBunString(globalThis);
                defer str.deref();
                break :brk str.toOwnedSliceZ(default_allocator) catch bun.outOfMemory();
            } else {
                break :brk default_allocator.dupeZ(u8, "0.0.0.0") catch bun.outOfMemory();
            }
        };
        defer if (globalThis.hasException()) default_allocator.free(hostname);

        const port: u16 = brk: {
            if (options.getTruthy(globalThis, "port")) |value| {
                const number = value.coerceToInt32(globalThis);
                if (number < 0 or number > 0xffff) {
                    globalThis.throwInvalidArguments("Expected \"port\" to be an integer between 0 and 65535", .{});
                    return null;
                }
                break :brk @intCast(number);
            } else {
                break :brk 0;
            }
        };

        var config = This{
            .hostname = hostname,
            .port = port,
        };

        if (options.getTruthy(globalThis, "socket")) |socket| {
            if (!socket.isObject()) {
                globalThis.throwInvalidArguments("Expected \"socket\" to be an object", .{});
                return null;
            }

            if (options.getTruthy(globalThis, "binaryType")) |value| {
                if (!value.isString()) {
                    globalThis.throwInvalidArguments("Expected \"socket.binaryType\" to be a string", .{});
                    return null;
                }

                config.binary_type = JSC.BinaryType.fromJSValue(globalThis, value) orelse {
                    globalThis.throwInvalidArguments("Expected \"socket.binaryType\" to be 'arraybuffer', 'uint8array', or 'buffer'", .{});
                    return null;
                };
            }

            inline for (handlers) |handler| {
                if (socket.getTruthyComptime(globalThis, handler.@"0")) |value| {
                    if (!value.isCell() or !value.isCallable(globalThis.vm())) {
                        globalThis.throwInvalidArguments("Expected \"socket.{s}\" to be a function", .{handler.@"0"});
                        return null;
                    }
                    @field(config, handler.@"1") = value;
                }
            }
        }

        defer {
            if (globalThis.hasException()) {
                if (config.connect) |connect| {
                    default_allocator.free(connect.address);
                }
            }
        }

        if (options.getTruthy(globalThis, "connect")) |connect| {
            if (!connect.isObject()) {
                globalThis.throwInvalidArguments("Expected \"connect\" to be an object", .{});
                return null;
            }

            const connect_host_js = connect.getTruthy(globalThis, "hostname") orelse {
                globalThis.throwInvalidArguments("Expected \"connect.hostname\" to be a string", .{});
                return null;
            };

            if (!connect_host_js.isString()) {
                globalThis.throwInvalidArguments("Expected \"connect.hostname\" to be a string", .{});
                return null;
            }

            const connect_port_js = connect.getTruthy(globalThis, "port") orelse {
                globalThis.throwInvalidArguments("Expected \"connect.port\" to be an integer", .{});
                return null;
            };
            const connect_port = connect_port_js.coerceToInt32(globalThis);

            const str = connect_host_js.toBunString(globalThis);
            defer str.deref();
            const connect_host = str.toOwnedSliceZ(default_allocator) catch bun.outOfMemory();

            config.connect = .{
                .port = if (connect_port < 1 or connect_port > 0xffff) 0 else @as(u16, @intCast(connect_port)),
                .address = connect_host,
            };
        }

        config.protect();

        return config;
    }

    pub fn protect(this: This) void {
        inline for (handlers) |handler| {
            @field(this, handler.@"1").protect();
        }
    }

    pub fn unprotect(this: This) void {
        inline for (handlers) |handler| {
            @field(this, handler.@"1").unprotect();
        }
    }

    pub fn deinit(this: This) void {
        this.unprotect();
        default_allocator.free(this.hostname);
        if (this.connect) |val| {
            default_allocator.free(val.address);
        }
    }
};

pub const UDPSocket = struct {
    const This = @This();

    config: UDPSocketConfig,

    socket: *uws.udp.Socket,
    loop: *uws.Loop,

    globalThis: *JSGlobalObject,
    thisValue: JSValue = .zero,

    ref: JSC.Ref = JSC.Ref.init(),
    poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
    // if marked as closed the socket pointer may be stale
    closed: bool = false,
    connect_info: ?ConnectInfo = null,
    vm: *JSC.VirtualMachine,
    js_refcount: std.atomic.Value(usize) = std.atomic.Value(usize).init(1),

    const ConnectInfo = struct {
        port: u16,
    };

    pub usingnamespace JSC.Codegen.JSUDPSocket;

    pub fn constructor(globalThis: *JSGlobalObject, _: *CallFrame) ?*This {
        globalThis.throw("Cannot construct UDPSocket", .{});
        return null;
    }

    pub fn hasPendingActivity(this: *This) callconv(.C) bool {
        return this.js_refcount.load(.monotonic) > 0;
    }

    pub usingnamespace bun.New(@This());

    pub fn udpSocket(globalThis: *JSGlobalObject, options: JSValue) JSValue {
        log("udpSocket", .{});

        const config = UDPSocketConfig.fromJS(globalThis, options) orelse {
            return .zero;
        };

        const vm = globalThis.bunVM();
        var this = This.new(.{
            .socket = undefined,
            .config = config,
            .globalThis = globalThis,
            .loop = uws.Loop.get(),
            .vm = vm,
        });

        // also cleans up config
        defer {
            if (globalThis.hasException()) {
                this.closed = true;
                this.deinit();
            }
        }

        if (uws.udp.Socket.create(
            this.loop,
            onData,
            onDrain,
            onClose,
            config.hostname,
            config.port,
            this,
        )) |socket| {
            this.socket = socket;
        } else {
            globalThis.throw("Failed to bind socket", .{});
            return .zero;
        }

        if (config.connect) |connect| {
            const ret = this.socket.connect(connect.address, connect.port);
            if (ret != 0) {
                if (JSC.Maybe(void).errnoSys(ret, .connect)) |err| {
                    globalThis.throwValue(err.toJS(globalThis));
                    return .zero;
                }
            }
            this.connect_info = .{ .port = connect.port };
        }

        this.poll_ref.ref(vm);
        const thisValue = this.toJS(globalThis);
        thisValue.ensureStillAlive();
        this.thisValue = thisValue;
        return JSC.JSPromise.resolvedPromiseValue(globalThis, thisValue);
    }

    pub fn callErrorHandler(
        this: *This,
        thisValue: JSValue,
        err: []const JSValue,
    ) bool {
        const callback = this.config.on_error;
        const globalThis = this.globalThis;
        const vm = globalThis.bunVM();

        if (callback == .zero) {
            if (err.len > 0)
                _ = vm.uncaughtException(globalThis, err[0], false);

            return false;
        }

        const result = callback.call(globalThis, thisValue, err);
        if (result.isAnyError()) {
            _ = vm.uncaughtException(globalThis, result, false);
        }

        return true;
    }

    pub fn sendMany(this: *This, globalThis: *JSGlobalObject, callframe: *CallFrame) JSValue {
        if (this.closed) {
            globalThis.throw("Socket is closed", .{});
            return .zero;
        }
        const arguments = callframe.arguments(1);
        if (arguments.len != 1) {
            globalThis.throwInvalidArguments("Expected 1 argument, got {}", .{arguments.len});
            return .zero;
        }

        const arg = arguments.ptr[0];
        if (!arg.jsType().isArray()) {
            globalThis.throwInvalidArgumentType("sendMany", "first argument", "array");
            return .zero;
        }

        const array_len = arg.getLength(globalThis);
        if (this.connect_info == null and array_len % 3 != 0) {
            globalThis.throwInvalidArguments("Expected 3 arguments for each packet", .{});
            return .zero;
        }

        const len = if (this.connect_info == null) array_len / 3 else array_len;

        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        const alloc = arena.allocator();

        var payloads = alloc.alloc([*]const u8, len) catch bun.outOfMemory();
        var lens = alloc.alloc(usize, len) catch bun.outOfMemory();
        var addr_ptrs = alloc.alloc(?*const anyopaque, len) catch bun.outOfMemory();
        var addrs = alloc.alloc(std.posix.sockaddr.storage, len) catch bun.outOfMemory();

        var iter = arg.arrayIterator(globalThis);

        var i: u16 = 0;
        var port: JSValue = .zero;
        while (iter.next()) |val| : (i += 1) {
            if (i >= array_len) {
                globalThis.throwInvalidArguments("Mismatch between array length property and number of items", .{});
                return .zero;
            }
            const slice_idx = if (this.connect_info == null) i / 3 else i;
            if (this.connect_info != null or i % 3 == 0) {
                const slice = brk: {
                    if (val.asArrayBuffer(globalThis)) |arrayBuffer| {
                        break :brk arrayBuffer.slice();
                    } else if (val.isString()) {
                        break :brk val.toString(globalThis).toSlice(globalThis, alloc).slice();
                    } else {
                        globalThis.throwInvalidArguments("Expected ArrayBufferView or string as payload", .{});
                        return .zero;
                    }
                };
                payloads[slice_idx] = slice.ptr;
                lens[slice_idx] = slice.len;
            }
            if (this.connect_info != null) {
                addr_ptrs[slice_idx] = null;
                continue;
            }
            if (i % 3 == 1) {
                port = val;
                continue;
            }
            if (i % 3 == 2) {
                if (!this.parseAddr(globalThis, port, val, &addrs[slice_idx])) {
                    globalThis.throwInvalidArguments("Invalid address", .{});
                    return .zero;
                }
                addr_ptrs[slice_idx] = &addrs[slice_idx];
            }
        }
        if (i != array_len) {
            globalThis.throwInvalidArguments("Mismatch between array length property and number of items", .{});
            return .zero;
        }
        const res = this.socket.send(payloads, lens, addr_ptrs);
        if (bun.JSC.Maybe(void).errnoSys(res, .send)) |err| {
            globalThis.throwValue(err.toJS(globalThis));
            return .zero;
        }
        return JSValue.jsNumber(res);
    }

    pub fn send(
        this: *This,
        globalThis: *JSGlobalObject,
        callframe: *CallFrame,
    ) JSValue {
        if (this.closed) {
            globalThis.throw("Socket is closed", .{});
            return .zero;
        }
        const arguments = callframe.arguments(3);
        const dst: ?Destination = brk: {
            if (this.connect_info != null) {
                if (arguments.len == 1) {
                    break :brk null;
                }
                if (arguments.len == 3) {
                    globalThis.throwInvalidArguments("Cannot specify destination on connected socket", .{});
                    return .zero;
                }
                globalThis.throwInvalidArguments("Expected 1 argument, got {}", .{arguments.len});
                return .zero;
            } else {
                if (arguments.len != 3) {
                    globalThis.throwInvalidArguments("Expected 3 arguments, got {}", .{arguments.len});
                    return .zero;
                }
                break :brk .{
                    .port = arguments.ptr[1],
                    .address = arguments.ptr[2],
                };
            }
        };

        const payload_arg = arguments.ptr[0];
        var payload_str = JSC.ZigString.Slice.empty;
        defer payload_str.deinit();
        const payload = brk: {
            if (payload_arg.asArrayBuffer(globalThis)) |array_buffer| {
                break :brk array_buffer.slice();
            } else if (payload_arg.isString()) {
                payload_str = payload_arg.asString().toSlice(globalThis, bun.default_allocator);
                break :brk payload_str.slice();
            } else {
                globalThis.throwInvalidArguments("Expected ArrayBufferView or string as first argument", .{});
                return .zero;
            }
        };

        var addr: std.posix.sockaddr.storage = std.mem.zeroes(std.posix.sockaddr.storage);
        const addr_ptr = brk: {
            if (dst) |dest| {
                if (!this.parseAddr(globalThis, dest.port, dest.address, &addr)) {
                    globalThis.throwInvalidArguments("Invalid address", .{});
                    return .zero;
                }
                break :brk &addr;
            } else {
                break :brk null;
            }
        };

        const res = this.socket.send(&.{payload.ptr}, &.{payload.len}, &.{addr_ptr});
        if (bun.JSC.Maybe(void).errnoSys(res, .send)) |err| {
            globalThis.throwValue(err.toJS(globalThis));
            return .zero;
        }
        return JSValue.jsBoolean(res > 0);
    }

    fn parseAddr(
        this: *This,
        globalThis: *JSGlobalObject,
        port_val: JSValue,
        address_val: JSValue,
        storage: *std.posix.sockaddr.storage,
    ) bool {
        _ = this;
        const number = port_val.coerceToInt32(globalThis);
        const port: u16 = if (number < 1 or number > 0xffff) 0 else @intCast(number);

        const str = address_val.toBunString(globalThis);
        defer str.deref();
        const address_slice = str.toOwnedSliceZ(default_allocator) catch bun.outOfMemory();
        defer default_allocator.free(address_slice);

        var addr4: *std.posix.sockaddr.in = @ptrCast(storage);
        if (inet_pton(std.posix.AF.INET, address_slice.ptr, &addr4.addr) == 1) {
            addr4.port = htons(@truncate(port));
            addr4.family = std.posix.AF.INET;
        } else {
            var addr6: *std.posix.sockaddr.in6 = @ptrCast(storage);
            if (inet_pton(std.posix.AF.INET6, address_slice.ptr, &addr6.addr) == 1) {
                addr6.port = htons(@truncate(port));
                addr6.family = std.posix.AF.INET6;
            } else {
                return false;
            }
        }

        return true;
    }

    const Destination = struct {
        port: JSValue,
        address: JSValue,
    };

    pub fn ref(this: *This, globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSValue {
        if (!this.closed) {
            this.poll_ref.ref(globalThis.bunVM());
        }

        return .undefined;
    }

    pub fn unref(this: *This, globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSValue {
        this.poll_ref.unref(globalThis.bunVM());

        return .undefined;
    }

    pub fn close(
        this: *This,
        _: *JSGlobalObject,
        _: *CallFrame,
    ) JSValue {
        if (!this.closed) this.socket.close();

        return .undefined;
    }

    pub fn reload(this: *This, globalThis: *JSGlobalObject, callframe: *CallFrame) JSValue {
        const args = callframe.arguments(1);

        if (args.len < 1) {
            globalThis.throwInvalidArguments("Expected 1 argument", .{});
            return .zero;
        }

        const options = args.ptr[0];
        const config = UDPSocketConfig.fromJS(globalThis, options) orelse {
            return .zero;
        };

        config.protect();
        var previous_config = this.config;
        previous_config.unprotect();
        this.config = config;

        return .undefined;
    }

    pub fn getClosed(this: *This, _: *JSGlobalObject) JSValue {
        return JSValue.jsBoolean(this.closed);
    }

    pub fn getHostname(this: *This, _: *JSGlobalObject) JSValue {
        const hostname = JSC.ZigString.init(this.config.hostname);
        return hostname.toJS(this.globalThis);
    }

    pub fn getPort(this: *This, _: *JSGlobalObject) JSValue {
        if (this.closed) return .undefined;
        return JSValue.jsNumber(this.socket.boundPort());
    }

    fn addressToString(globalThis: *JSGlobalObject, address_bytes: []const u8) JSValue {
        var text_buf: [512]u8 = undefined;
        const address: std.net.Address = switch (address_bytes.len) {
            4 => std.net.Address.initIp4(address_bytes[0..4].*, 0),
            16 => std.net.Address.initIp6(address_bytes[0..16].*, 0, 0, 0),
            else => return .undefined,
        };

        const slice = bun.fmt.formatIp(address, &text_buf) catch unreachable;
        return bun.String.createLatin1(slice).toJS(globalThis);
    }

    pub fn getAddress(this: *This, globalThis: *JSGlobalObject) JSValue {
        if (this.closed) return .undefined;
        var buf: [64]u8 = [_]u8{0} ** 64;
        var length: i32 = 64;
        this.socket.boundIp(&buf, &length);

        const address_bytes = buf[0..@as(usize, @intCast(length))];
        const port = this.socket.boundPort();
        return JSSocketAddress__create(
            globalThis,
            addressToString(globalThis, address_bytes),
            @intCast(port),
            length == 16,
        );
    }

    pub fn getRemoteAddress(this: *This, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        if (this.closed) return .undefined;
        const connect_info = this.connect_info orelse return .undefined;
        var buf: [64]u8 = [_]u8{0} ** 64;
        var length: i32 = 64;
        this.socket.remoteIp(&buf, &length);

        const address_bytes = buf[0..@as(usize, @intCast(length))];
        return JSSocketAddress__create(
            globalThis,
            addressToString(globalThis, address_bytes),
            connect_info.port,
            length == 16,
        );
    }

    pub fn getBinaryType(
        this: *This,
        globalThis: *JSGlobalObject,
    ) JSValue {
        return switch (this.config.binary_type) {
            .Buffer => JSC.ZigString.init("buffer").toJS(globalThis),
            .Uint8Array => JSC.ZigString.init("uint8array").toJS(globalThis),
            .ArrayBuffer => JSC.ZigString.init("arraybuffer").toJS(globalThis),
            else => @panic("Invalid binary type"),
        };
    }

    pub fn finalize(this: *This) callconv(.C) void {
        log("Finalize {*}", .{this});
        this.deinit();
    }

    pub fn deinit(this: *This) void {
        // finalize is only called when js_refcount reaches 0
        // js_refcount can only reach 0 when the socket is closed
        bun.assert(this.closed);

        this.config.deinit();
        this.destroy();
    }

    pub fn jsConnect(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) JSC.JSValue {
        const args = callFrame.arguments(2);

        const this = callFrame.this().as(UDPSocket) orelse {
            globalThis.throwInvalidArguments("Expected UDPSocket as 'this'", .{});
            return .zero;
        };

        if (this.connect_info != null) {
            globalThis.throw("Socket is already connected", .{});
            return .zero;
        }

        if (this.closed) {
            globalThis.throw("Socket is closed", .{});
            return .zero;
        }

        if (args.len < 2) {
            globalThis.throwInvalidArguments("Expected 2 arguments", .{});
            return .zero;
        }

        const str = args.ptr[0].toBunString(globalThis);
        defer str.deref();
        const connect_host = str.toOwnedSliceZ(default_allocator) catch bun.outOfMemory();
        defer default_allocator.free(connect_host);

        const connect_port_js = args.ptr[1];

        if (!connect_port_js.isNumber()) {
            globalThis.throwInvalidArguments("Expected \"port\" to be an integer", .{});
            return .zero;
        }

        const connect_port = connect_port_js.asInt32();
        const port: u16 = if (connect_port < 1 or connect_port > 0xffff) 0 else @as(u16, @intCast(connect_port));

        if (this.socket.connect(connect_host, port) == -1) {
            globalThis.throw("Failed to connect socket", .{});
            return .zero;
        }
        this.connect_info = .{
            .port = port,
        };
        // TODO reset cached remoteAddress property

        return .undefined;
    }

    pub fn jsDisconnect(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) JSC.JSValue {
        const this = callFrame.this().as(UDPSocket) orelse {
            globalObject.throwInvalidArguments("Expected UDPSocket as 'this'", .{});
            return .zero;
        };

        if (this.connect_info == null) {
            globalObject.throw("Socket is not connected", .{});
            return .zero;
        }

        if (this.closed) {
            globalObject.throw("Socket is closed", .{});
            return .zero;
        }

        if (this.socket.disconnect() == -1) {
            globalObject.throw("Failed to disconnect socket", .{});
            return .zero;
        }
        this.connect_info = null;

        return .undefined;
    }
};
