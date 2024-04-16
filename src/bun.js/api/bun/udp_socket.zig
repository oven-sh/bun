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

const INET6_ADDRSTRLEN = if (bun.Environment.isWindows) 65 else 46;

extern fn ntohl(nlong: u32) u32;
extern fn ntohs(nshort: u16) u16;
extern fn htonl(hlong: u32) u32;
extern fn htons(hshort: u16) u16;
extern fn inet_ntop(af: c_int, src: ?*const anyopaque, dst: [*c]u8, size: c_int) ?[*:0]const u8;
extern fn inet_pton(af: c_int, src: [*c]const u8, dst: ?*anyopaque) c_int;
extern fn JSSocketAddress__create(global: *JSGlobalObject, address: JSValue, port: i32, v6: bool) JSValue;

fn onDrain(socket: *uws.UDPSocket) callconv(.C) void {
    JSC.markBinding(@src());

    const this: *UDPSocket = @ptrCast(@alignCast(uws.us_udp_socket_user(socket).?));
    const callback = this.config.on_drain;
    if (callback == .zero) return;

    const result = callback.callWithThis(this.globalThis, this.thisValue, &[_]JSValue{this.thisValue});
    if (result.toError()) |err| {
        _ = this.callErrorHandler(.zero, &[_]JSValue{err});
    }
}

fn onData(socket: *uws.UDPSocket, buf: *uws.UDPPacketBuffer, packets: c_int) callconv(.C) void {
    JSC.markBinding(@src());

    const udpSocket: *UDPSocket = @ptrCast(@alignCast(uws.us_udp_socket_user(socket).?));
    const callback = udpSocket.config.on_data;
    if (callback == .zero) return;

    const globalThis = udpSocket.globalThis;

    var i: c_int = 0;
    while (i < packets) : (i += 1) {
        const peer = uws.us_udp_packet_buffer_peer(buf, i);

        var addr: [INET6_ADDRSTRLEN + 1:0]u8 = undefined;
        var hostname: ?[*:0]const u8 = null;
        var port: u16 = 0;

        switch (peer.family) {
            std.os.AF.INET => {
                const peer4: *std.os.sockaddr.in = @ptrCast(peer);
                hostname = inet_ntop(peer.family, &peer4.addr, &addr, addr.len);
                port = ntohs(peer4.port);
            },
            std.os.AF.INET6 => {
                const peer6: *std.os.sockaddr.in6 = @ptrCast(peer);
                hostname = inet_ntop(peer.family, &peer6.addr, &addr, addr.len);
                port = ntohs(peer6.port);
            },
            else => continue,
        }

        if (hostname == null or port == 0) {
            continue;
        }

        const payload = uws.us_udp_packet_buffer_payload(buf, i);
        const length = uws.us_udp_packet_buffer_payload_length(buf, i);
        const slice = payload[0..@as(usize, @intCast(length))];

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

    hostname: []const u8,
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

        var hostname: []const u8 = "0.0.0.0";
        var port: u16 = 0;

        if (options.getTruthy(globalThis, "hostname")) |value| {
            if (!value.isString()) {
                globalThis.throwInvalidArguments("Expected \"hostname\" to be a string", .{});
                return null;
            }
            const str = value.toBunString(globalThis);
            const slice = str.toSlice(default_allocator);
            defer slice.deinit();
            hostname = slice.slice();
        }

        if (options.getTruthy(globalThis, "port")) |value| {
            if (!value.isInt32()) {
                globalThis.throwInvalidArguments("Expected \"port\" to be a integer", .{});
                return null;
            }
            const number = value.asInt32();
            port = if (number < 1 or number > 0xffff) 0 else @intCast(number);
        }

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
                    globalThis.throwInvalidArguments("Expected \"binaryType\" to be a string", .{});
                    return null;
                }

                config.binary_type = JSC.BinaryType.fromJSValue(globalThis, value) orelse {
                    globalThis.throwInvalidArguments("Expected \"binaryType\" to be 'arraybuffer', 'uint8array', or 'buffer'", .{});
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
};

pub const UDPSocket = struct {
    const This = @This();
    const log = Output.scoped(.Socket, false);

    config: UDPSocketConfig,

    socket: *uws.UDPSocket,
    loop: *uws.Loop,
    receive_buf: *uws.UDPPacketBuffer,
    send_buf: *uws.UDPPacketBuffer,

    globalThis: *JSGlobalObject,
    thisValue: JSValue = .zero,

    ref: JSC.Ref = JSC.Ref.init(),
    poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
    closed: bool = false,
    vm: *JSC.VirtualMachine,
    js_refcount: usize = 1,

    pub usingnamespace JSC.Codegen.JSUDPSocket;

    pub fn constructor(globalThis: *JSGlobalObject, _: *CallFrame) callconv(.C) ?*This {
        globalThis.throw("Cannot construct UDPSocket", .{});
        return null;
    }

    pub fn hasPendingActivity(this: *This) callconv(.C) bool {
        return this.js_refcount > 0;
    }

    pub fn bind(globalThis: *JSGlobalObject, options: JSValue) JSValue {
        log("bind", .{});

        const config = UDPSocketConfig.fromJS(globalThis, options) orelse {
            return .zero;
        };

        var vm = globalThis.bunVM();
        var this: *This = vm.allocator.create(This) catch @panic("Out of memory");
        this.* = This{
            .socket = undefined,
            .config = config,
            .globalThis = globalThis,
            .receive_buf = uws.us_create_udp_packet_buffer().?,
            .send_buf = uws.us_create_udp_packet_buffer().?,
            .loop = uws.Loop.get(),
            .vm = vm,
        };

        if (uws.us_create_udp_socket(
            this.loop,
            this.receive_buf,
            onData,
            onDrain,
            bun.cstring(config.hostname),
            config.port,
            this,
        )) |socket| {
            this.socket = socket;
        } else {
            globalThis.throw("Failed to bind socket", .{});
            return .zero;
        }

        this.poll_ref.ref(vm);
        this.config.protect();
        vm.eventLoop().ensureWaker();
        const thisValue = this.toJS(globalThis);
        this.thisValue = thisValue;

        return thisValue;
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

    pub fn send(
        this: *This,
        globalThis: *JSGlobalObject,
        callframe: *CallFrame,
    ) callconv(.C) JSValue {
        const arguments = callframe.arguments(3);
        if (arguments.len != 3) {
            globalThis.throwInvalidArguments("Expected 3 arguments, got {}", .{arguments.len});
            return .zero;
        }

        const arg0 = arguments.ptr[0];
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

        const arg1 = arguments.ptr[1];
        const port: u16 = init: {
            if (arg1.isInt32()) {
                const number = arg1.asInt32();
                break :init if (number < 1 or number > 0xffff) 0 else @intCast(number);
            } else {
                globalThis.throwInvalidArguments("Expected integer as second argument", .{});
                return .zero;
            }
        };

        const arg2 = arguments.ptr[2];
        const address = init: {
            if (bun.String.tryFromJS(arg2, globalThis)) |value| {
                const slice = value.toUTF8(default_allocator);
                break :init slice.slice();
            } else {
                globalThis.throwInvalidArguments("Expected string as third argument", .{});
                return .zero;
            }
        };

        var addr: std.os.sockaddr.storage = undefined;
        var addr4: *std.os.sockaddr.in = @ptrCast(&addr);
        if (inet_pton(std.os.AF.INET, address.ptr, &addr4.addr) == 1) {
            addr4.port = htons(@truncate(port));
            addr4.family = std.os.AF.INET;
        } else {
            var addr6: *std.os.sockaddr.in6 = @ptrCast(&addr);
            if (inet_pton(std.os.AF.INET6, address.ptr, &addr6.addr) == 1) {
                addr6.port = htons(@truncate(port));
                addr6.family = std.os.AF.INET6;
            } else {
                globalThis.throwInvalidArguments("Invalid address: {s}", .{address});
                return .zero;
            }
        }

        const buf = this.send_buf;
        uws.us_udp_buffer_set_packet_payload(buf, 0, 0, payload.ptr, @intCast(payload.len), @ptrCast(&addr));
        if (uws.us_udp_socket_send(this.socket, buf, 1) == -1) {
            const errno = @as(std.c.E, @enumFromInt(std.c._errno().*));
            const err = bun.sys.Error.fromCode(errno, .sendmmsg);
            globalThis.throwValue(err.toSystemError().toErrorInstance(globalThis));
            return .zero;
        }

        return .undefined;
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
        uws.us_udp_socket_close(this.socket);

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

    pub fn getHostname(this: *This, _: *JSGlobalObject) callconv(.C) JSValue {
        const hostname = JSC.ZigString.init(this.config.hostname);
        return hostname.toValueGC(this.globalThis);
    }

    pub fn getPort(this: *This, _: *JSGlobalObject) callconv(.C) JSValue {
        const port = uws.us_udp_socket_bound_port(this.socket);
        return JSValue.jsNumber(port);
    }

    pub fn getAddress(this: *This, globalThis: *JSGlobalObject) callconv(.C) JSValue {
        var buf: [64]u8 = [_]u8{0} ** 64;
        var length: i32 = 64;
        var text_buf: [512]u8 = undefined;
        uws.us_udp_socket_bound_ip(this.socket, &buf, &length);

        const address_bytes = buf[0..@as(usize, @intCast(length))];
        const address: std.net.Address = switch (length) {
            4 => std.net.Address.initIp4(address_bytes[0..4].*, 0),
            16 => std.net.Address.initIp6(address_bytes[0..16].*, 0, 0, 0),
            else => return .undefined,
        };

        const slice = bun.fmt.formatIp(address, &text_buf) catch unreachable;
        var addr = bun.String.createLatin1(slice);
        const port = uws.us_udp_socket_bound_port(this.socket);
        return JSSocketAddress__create(
            globalThis,
            addr.toJS(globalThis),
            @intCast(port),
            length == 16,
        );
    }

    pub fn getBinaryType(
        this: *This,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return switch (this.config.binary_type) {
            .Uint8Array => JSC.ZigString.init("uint8array").toValueGC(globalThis),
            .Buffer => JSC.ZigString.init("nodebuffer").toValueGC(globalThis),
            .ArrayBuffer => JSC.ZigString.init("arraybuffer").toValueGC(globalThis),
            else => @panic("Invalid binary type"),
        };
    }

    pub fn finalize(this: *This) callconv(.C) void {
        log("Finalize {*}", .{this});
        this.deinit();
    }

    pub fn deinit(this: *This) void {
        this.poll_ref.unref(this.vm);

        // Cast into a us_poll_t pointer so uSockets can free the memory
        var poll: *uws.Poll = @ptrCast(this.socket);
        poll.deinit(this.loop);

        std.c.free(this.receive_buf);
        std.c.free(this.send_buf);

        default_allocator.destroy(this);
    }
};
