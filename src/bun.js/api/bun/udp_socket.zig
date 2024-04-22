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

fn onDrain(socket: *uws.udp.Socket) callconv(.C) void {
    JSC.markBinding(@src());

    const this: *UDPSocket = bun.cast(*UDPSocket, socket.user().?);
    const callback = this.config.on_drain;
    if (callback == .zero) return;

    const result = callback.callWithThis(this.globalThis, this.thisValue, &[_]JSValue{this.thisValue});
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
            std.os.AF.INET => {
                const peer4: *std.os.sockaddr.in = @ptrCast(peer);
                hostname = inet_ntop(peer.family, &peer4.addr, &addr_buf, addr_buf.len);
                port = ntohs(peer4.port);
            },
            std.os.AF.INET6 => {
                const peer6: *std.os.sockaddr.in6 = @ptrCast(peer);
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
        udpSocket.js_refcount += 1;
        defer udpSocket.js_refcount -= 1;

        const result = callback.callWithThis(globalThis, udpSocket.thisValue, &[_]JSValue{
            udpSocket.thisValue,
            udpSocket.config.binary_type.toJS(slice, globalThis),
            JSC.jsNumber(port),
            JSC.ZigString.init(std.mem.span(hostname.?)).toValueAuto(globalThis),
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

        const port: u16 = brk: {
            if (options.getTruthy(globalThis, "port")) |value| {
                const number = value.coerceToInt32(globalThis);
                break :brk if (number < 1 or number > 0xffff) 0 else @intCast(number);
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

        const connect_config: ?ConnectConfig = brk: {
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

                const str = connect_host_js.toBunString(globalThis);
                defer str.deref();
                const connect_host = str.toOwnedSliceZ(default_allocator) catch bun.outOfMemory();

                const connect_port_js = connect.getTruthy(globalThis, "port") orelse {
                    globalThis.throwInvalidArguments("Expected \"connect.port\" to be an integer", .{});
                    return null;
                };

                const connect_port = connect_port_js.coerceToInt32(globalThis);

                break :brk .{
                    .port = if (connect_port < 1 or connect_port > 0xffff) 0 else @as(u16, @intCast(connect_port)),
                    .address = connect_host,
                };
            } else {
                break :brk null;
            }
        };

        config.connect = connect_config;

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
    send_buf: *uws.udp.PacketBuffer,

    globalThis: *JSGlobalObject,
    thisValue: JSValue = .zero,

    ref: JSC.Ref = JSC.Ref.init(),
    poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
    closed: bool = false,
    connect_info: ?ConnectInfo = null,
    vm: *JSC.VirtualMachine,
    js_refcount: usize = 1,

    const ConnectInfo = struct {
        port: u16,
    };

    pub usingnamespace JSC.Codegen.JSUDPSocket;

    pub fn constructor(globalThis: *JSGlobalObject, _: *CallFrame) callconv(.C) ?*This {
        globalThis.throw("Cannot construct UDPSocket", .{});
        return null;
    }

    pub fn hasPendingActivity(this: *This) callconv(.C) bool {
        return this.js_refcount > 0;
    }

    pub fn udpSocket(globalThis: *JSGlobalObject, options: JSValue) JSValue {
        log("udpSocket", .{});

        const config = UDPSocketConfig.fromJS(globalThis, options) orelse {
            return .zero;
        };

        var vm = globalThis.bunVM();
        var this: *This = vm.allocator.create(This) catch bun.outOfMemory();
        this.* = This{
            .socket = undefined,
            .config = config,
            .globalThis = globalThis,
            .send_buf = uws.udp.PacketBuffer.create(),
            .loop = uws.Loop.get(),
            .vm = vm,
        };

        if (uws.udp.Socket.create(
            this.loop,
            onData,
            onDrain,
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
            if (this.socket.connect(connect.address, connect.port) == -1) {
                globalThis.throw("Failed to connect socket", .{});
                return .zero;
            }
            this.connect_info = .{ .port = connect.port };
        }

        this.poll_ref.ref(vm);
        this.config.protect();
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
                vm.onUnhandledError(globalThis, err[0]);

            return false;
        }

        const result = callback.callWithThis(globalThis, thisValue, err);
        if (result.isAnyError()) {
            vm.onUnhandledError(globalThis, result);
        }

        return true;
    }

    pub fn sendMany(this: *This, globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(1);
        if (arguments.len != 1) {
            globalThis.throwInvalidArguments("Expected 1 argument, got {}", .{arguments.len});
            return .zero;
        }

        const arg0 = arguments.ptr[0];

        var iter = arg0.arrayIterator(globalThis);
        var i: u16 = 0;
        var vals: [3]JSValue = .{ .zero, .zero, .zero };
        while (iter.next()) |val| : (i += 1) {
            if (this.connect_info != null) {
                if (this.setupPacket(globalThis, i, val, null)) |ex| {
                    return ex;
                }
            } else {
                vals[i % 3] = val;
                if (i % 3 == 2) {
                    if (this.setupPacket(globalThis, i / 3, vals[0], .{
                        .port = vals[1],
                        .address = vals[2],
                    })) |ex| {
                        return ex;
                    }
                }
            }
        }
        if (this.connect_info == null and i % 3 != 0) {
            globalThis.throwInvalidArguments("Expected 3 arguments for each packet", .{});
            return .zero;
        }
        const ret = this.doSend(globalThis, i);
        if (ret) |val| {
            // number of packets sent
            return JSValue.jsNumber(val);
        } else {
            // exception
            return .zero;
        }
    }

    pub fn send(
        this: *This,
        globalThis: *JSGlobalObject,
        callframe: *CallFrame,
    ) callconv(.C) JSValue {
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

        if (this.setupPacket(
            globalThis,
            0,
            arguments.ptr[0],
            dst,
        )) |val| {
            // we threw an exception
            return val;
        }

        const sent = this.doSend(globalThis, 1);
        if (sent) |val| {
            // val can only be zero or one
            return JSValue.jsBoolean(val > 0);
        } else {
            return .zero;
        }
    }

    fn doSend(this: *This, globalThis: *JSGlobalObject, count: u16) ?c_int {
        const res = this.socket.send(this.send_buf, count);
        if (res == -1) {
            const errno = @as(std.c.E, @enumFromInt(std.c._errno().*));
            const err = bun.sys.Error.fromCode(errno, .sendmmsg);
            globalThis.throwValue(err.toSystemError().toErrorInstance(globalThis));
            return null;
        }
        return res;
    }

    const Destination = struct {
        port: JSValue,
        address: JSValue,
    };

    fn setupPacket(
        this: *This,
        globalThis: *JSGlobalObject,
        index: usize,
        data_val: JSValue,
        dest: ?Destination,
    ) ?JSValue {
        if (index >= 1024) {
            globalThis.throwInvalidArguments("Too many packets to send, maximum is 1024", .{});
            return .zero;
        }
        const arg0 = data_val;
        const payload = init: {
            if (arg0.asArrayBuffer(globalThis)) |arrayBuffer| {
                break :init arrayBuffer.slice();
            } else if (bun.String.tryFromJS(arg0, globalThis)) |value| {
                const slice = value.toUTF8(default_allocator);
                break :init slice.slice();
            } else {
                globalThis.throwInvalidArguments("Expected ArrayBufferView or string as first argument", .{});
                return .zero;
            }
        };

        var addr: std.os.sockaddr.storage = std.mem.zeroes(std.os.sockaddr.storage);
        if (dest) |destval| {
            const number = destval.port.coerceToInt32(globalThis);
            const port: u16 = if (number < 1 or number > 0xffff) 0 else @intCast(number);

            const str = destval.address.toBunString(globalThis);
            defer str.deref();
            const address_slice = str.toOwnedSliceZ(default_allocator) catch bun.outOfMemory();
            defer default_allocator.free(address_slice);

            var addr4: *std.os.sockaddr.in = @ptrCast(&addr);
            if (inet_pton(std.os.AF.INET, address_slice.ptr, &addr4.addr) == 1) {
                addr4.port = htons(@truncate(port));
                addr4.family = std.os.AF.INET;
            } else {
                var addr6: *std.os.sockaddr.in6 = @ptrCast(&addr);
                if (inet_pton(std.os.AF.INET6, address_slice.ptr, &addr6.addr) == 1) {
                    addr6.port = htons(@truncate(port));
                    addr6.family = std.os.AF.INET6;
                } else {
                    globalThis.throwInvalidArguments("Invalid address: {s}", .{address_slice});
                    return .zero;
                }
            }
        }

        this.send_buf.setPayload(@truncate(index), 0, payload, if (dest != null) &addr else null);
        return null;
    }

    pub fn ref(this: *This, globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        if (!this.closed) {
            this.poll_ref.ref(globalThis.bunVM());
        }

        return .undefined;
    }

    pub fn unref(this: *This, globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        if (!this.closed) {
            this.poll_ref.unref(globalThis.bunVM());
        }

        return .undefined;
    }

    pub fn close(
        this: *This,
        globalThis: *JSGlobalObject,
        _: *CallFrame,
    ) callconv(.C) JSValue {
        if (this.closed) {
            globalThis.throw("Socket is already closed", .{});
            return .zero;
        }

        this.closed = true;
        this.config.unprotect();
        this.poll_ref.unref(this.globalThis.bunVM());
        this.socket.close();

        this.js_refcount -= 1;

        return .undefined;
    }

    pub fn reload(this: *This, globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
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

    pub fn getClosed(this: *This, _: *JSGlobalObject) callconv(.C) JSValue {
        return JSValue.jsBoolean(this.closed);
    }

    pub fn getHostname(this: *This, _: *JSGlobalObject) callconv(.C) JSValue {
        const hostname = JSC.ZigString.init(this.config.hostname);
        return hostname.toValueGC(this.globalThis);
    }

    pub fn getPort(this: *This, _: *JSGlobalObject) callconv(.C) JSValue {
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

    pub fn getAddress(this: *This, globalThis: *JSGlobalObject) callconv(.C) JSValue {
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

    pub fn getRemoteAddress(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
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
    ) callconv(.C) JSValue {
        return switch (this.config.binary_type) {
            .Buffer => JSC.ZigString.init("buffer").toValueGC(globalThis),
            .Uint8Array => JSC.ZigString.init("uint8array").toValueGC(globalThis),
            .ArrayBuffer => JSC.ZigString.init("arraybuffer").toValueGC(globalThis),
            else => @panic("Invalid binary type"),
        };
    }

    pub fn finalize(this: *This) callconv(.C) void {
        log("Finalize {*}", .{this});
        this.deinit();
    }

    pub fn deinit(this: *This) void {
        if (!this.closed) {
            this.socket.close();
        }

        this.poll_ref.unref(this.vm);

        this.send_buf.destroy();

        this.config.deinit();

        default_allocator.destroy(this);
    }

    pub fn jsConnect(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const args = callFrame.arguments(2);

        const this = callFrame.this().as(UDPSocket) orelse {
            globalThis.throwInvalidArguments("Expected UDPSocket as 'this'", .{});
            return .zero;
        };

        if (this.connect_info != null) {
            globalThis.throw("Socket is already connected", .{});
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

    pub fn jsDisconnect(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const this = callFrame.this().as(UDPSocket) orelse {
            globalObject.throwInvalidArguments("Expected UDPSocket as 'this'", .{});
            return .zero;
        };

        if (this.connect_info == null) {
            globalObject.throw("Socket is not connected", .{});
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
