const bun = @import("root").bun;
const std = @import("std");
const c = @cImport({
    @cInclude("arpa/inet.h");
});
const JSC = @import("root").bun.JSC;
const uws = @import("../../../deps/uws.zig");
const Async = bun.Async;

fn onDrain(socket: *uws.UDPSocket) callconv(.C) void {
    JSC.markBinding(@src());
    const udpSocket: *UDPSocket = @ptrCast(@alignCast(uws.us_udp_socket_user(socket).?));

    if (udpSocket.onDrain == .zero) return;

    const globalObject = udpSocket.globalObject;
    const thisValue = udpSocket.getThisValue(globalObject);

    const result = udpSocket.onDrain.callWithThis(globalObject, thisValue, &[_]JSC.JSValue{});
    if (result.toError()) |err_value| {
        _ = udpSocket.callErrorHandler(.zero, &[_]JSC.JSValue{err_value});
    }
}

fn onData(socket: *uws.UDPSocket, buf: *uws.UDPPacketBuffer, packets: c_int) callconv(.C) void {
    JSC.markBinding(@src());
    const udpSocket: *UDPSocket = @ptrCast(@alignCast(uws.us_udp_socket_user(socket).?));

    if (udpSocket.onData == .zero) return;

    const globalObject = udpSocket.globalObject;
    const thisValue = udpSocket.getThisValue(globalObject);

    var i: c_int = 0;
    while (i < packets) : (i += 1) {
        var peerAddrBuf: [c.INET6_ADDRSTRLEN + 1:0]u8 = undefined;

        const peer = uws.us_udp_packet_buffer_peer(buf, i);
        var peerPort: u16 = undefined;

        const peerAddr = peerInit: {
            if (peer.family == std.os.AF.INET6) {
                var peer6: *std.os.sockaddr.in6 = @ptrCast(peer);
                peerPort = c.ntohs(peer6.port);
                break :peerInit c.inet_ntop(peer.family, &peer6.addr, &peerAddrBuf, peerAddrBuf.len);
            } else {
                var peer4: *std.os.sockaddr.in = @ptrCast(peer);
                peerPort = c.ntohs(peer4.port);
                break :peerInit c.inet_ntop(peer.family, &peer4.addr, &peerAddrBuf, peerAddrBuf.len);
            }
        };

        const payload = uws.us_udp_packet_buffer_payload(buf, i);
        const length = uws.us_udp_packet_buffer_payload_length(buf, i);

        const slicePayload = payload[0..@as(usize, @intCast(length))];
        const jsPayload = udpSocket.binary_type.toJS(slicePayload, globalObject);

        const jsPeer = JSC.ZigString.init(std.mem.span(peerAddr)).toValueAuto(globalObject);
        const result = udpSocket.onData.callWithThis(globalObject, thisValue, &[_]JSC.JSValue{
            jsPayload,
            jsPeer,
            JSC.jsNumber(peerPort),
        });
        if (result.toError()) |err_value| {
            _ = udpSocket.callErrorHandler(.zero, &[_]JSC.JSValue{err_value});
        }
    }
}

fn parseAddressPort(
    globalObject: *JSC.JSGlobalObject,
    addressValue: JSC.JSValue,
    portValue: JSC.JSValue,
    ipv6: *bool,
    storage: *std.os.sockaddr.storage,
) []const u8 {
    const address = init: {
        if (bun.String.tryFromJS(addressValue, globalObject)) |bunStr| {
            var zigStr = bunStr.toUTF8(bun.default_allocator);
            defer zigStr.deinit();
            break :init zigStr.sliceZ();
        } else {
            return "Expected string (peer address)";
        }
    };

    const port: u32 = init: {
        if (portValue.isInt32()) {
            const port = portValue.asInt32();
            break :init if (port < 1 or port > 0xffff) 0 else @intCast(port);
        } else {
            break :init 0;
        }
    };

    if (port == 0) {
        return "Expected integer between 1 and 65535 (port)";
    }

    var addr4: *std.os.sockaddr.in = @ptrCast(storage);
    if (c.inet_pton(std.os.AF.INET, address.ptr, &addr4.addr) == 1) {
        addr4.port = c.htons(@truncate(port));
        addr4.family = std.os.AF.INET;
        ipv6.* = false;
        return "";
    }

    var addr6: *std.os.sockaddr.in6 = @ptrCast(storage);
    if (c.inet_pton(std.os.AF.INET6, address.ptr, &addr6.addr) != 0) {
        addr6.port = c.htons(@truncate(port));
        addr6.family = std.os.AF.INET6;
        ipv6.* = true;
        return "";
    }

    return "Invalid IP address";
}

const handlersPairs = .{
    .{ "onData", "data" },
    .{ "onDrain", "drain" },
    .{ "onError", "error" },
};

fn parseHandlers(
    globalObject: *JSC.JSGlobalObject,
    opts: JSC.JSValue,
    exception: JSC.C.ExceptionRef,
    udpSocket: *UDPSocket,
) ?void {
    if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
        exception.* = JSC.toInvalidArguments("Expected \"socket\" to be an object", .{}, globalObject).asObjectRef();
        return null;
    }

    inline for (handlersPairs) |pair| {
        if (opts.getTruthy(globalObject, pair.@"1")) |callback_value| {
            if (!callback_value.isCell() or !callback_value.isCallable(globalObject.vm())) {
                exception.* = JSC.toInvalidArguments(comptime std.fmt.comptimePrint("Expected \"{s}\" callback to be a function", .{pair.@"1"}), .{}, globalObject).asObjectRef();
                return null;
            }

            @field(udpSocket, pair.@"0") = callback_value;
        }
    }

    if (opts.getTruthy(globalObject, "binaryType")) |binary_type_value| {
        if (!binary_type_value.isString()) {
            exception.* = JSC.toInvalidArguments("Expected \"binaryType\" to be a string", .{}, globalObject).asObjectRef();
            return null;
        }

        udpSocket.binary_type = JSC.BinaryType.fromJSValue(globalObject, binary_type_value) orelse {
            exception.* = JSC.toInvalidArguments("Expected 'binaryType' to be 'arraybuffer', 'uint8array', 'buffer'", .{}, globalObject).asObjectRef();
            return null;
        };
    }
}

fn parseBind(globalObject: *JSC.JSGlobalObject, opts: JSC.JSValue, exception: JSC.C.ExceptionRef, udpSocket: *UDPSocket) ?void {
    var addr: JSC.ZigString.Slice = JSC.ZigString.Slice.empty;

    if (opts.getTruthy(globalObject, "address")) |hostname| {
        if (hostname.isString()) {
            addr = hostname.getZigString(globalObject).toSlice(bun.default_allocator);
        }
    }

    var port_value = opts.get(globalObject, "port") orelse JSC.JSValue.zero;
    if (port_value.isEmptyOrUndefinedOrNull() or !port_value.isNumber() or port_value.toInt64() > std.math.maxInt(u16) or port_value.toInt64() < 0) {
        exception.* = JSC.toInvalidArguments("Expected \"port\" to be a number between 0 and 65535", .{}, globalObject).asObjectRef();
        return null;
    }

    udpSocket.bindAddr = addr;
    udpSocket.bindPort = port_value.toU16();
}

pub const UDPSocket = struct {
    const This = @This();

    receiveBuf: *uws.UDPPacketBuffer = undefined,
    sendBuf: *uws.UDPPacketBuffer = undefined,
    socket: *uws.UDPSocket = undefined,
    loop: *uws.Loop = undefined,

    ref: JSC.Ref = JSC.Ref.init(),
    this_value: JSC.JSValue = .zero,
    poll_ref: Async.KeepAlive = Async.KeepAlive.init(),

    ipv6: bool = false,
    bindAddr: JSC.ZigString.Slice = JSC.ZigString.Slice.empty,
    bindPort: u16 = 0,
    connectedAddrStorage: ?std.os.sockaddr.storage = null,

    onData: JSC.JSValue = .zero,
    onDrain: JSC.JSValue = .zero,
    onError: JSC.JSValue = .zero,

    binary_type: JSC.BinaryType = .Buffer,

    vm: *JSC.VirtualMachine,
    globalObject: *JSC.JSGlobalObject,

    strong_self: JSC.Strong = .{},
    stopped: bool = false,

    pub usingnamespace JSC.Codegen.JSUDPSocket;

    pub fn create(
        globalObject: *JSC.JSGlobalObject,
        opts: JSC.JSValue,
    ) JSC.JSValue {
        var exception_ = [1]JSC.JSValueRef{null};
        var exception: JSC.C.ExceptionRef = &exception_;
        defer {
            if (exception_[0] != null) {
                globalObject.throwValue(exception_[0].?.value());
            }
        }

        if (opts.isEmptyOrUndefinedOrNull() or !opts.isObject()) {
            exception.* = JSC.toInvalidArguments("Expected object", .{}, globalObject).asObjectRef();
            return .zero;
        }

        var udpSocket = UDPSocket{
            .globalObject = globalObject,
            .vm = globalObject.bunVM(),
        };

        if (opts.get(globalObject, "socket")) |socketObj| {
            parseHandlers(globalObject, socketObj, exception, &udpSocket) orelse {
                return .zero;
            };
        }

        if (opts.get(globalObject, "bind")) |bindObj| {
            parseBind(globalObject, bindObj, exception, &udpSocket) orelse {
                return .zero;
            };
        }

        if (udpSocket.bindAddr.len == 0) {
            udpSocket.bindAddr = JSC.ZigString.fromUTF8("0.0.0.0").toSlice(bun.default_allocator);
        }

        {
            var addrStorage: std.os.sockaddr.storage = undefined;
            const addrValue = udpSocket.bindAddr.toZigString().toJS(globalObject, exception);
            const portValue = JSC.jsNumber(udpSocket.bindPort);
            const err: []const u8 = parseAddressPort(globalObject, addrValue, portValue, &udpSocket.ipv6, &addrStorage);
            if (err.len > 0) {
                exception.* = JSC.toInvalidArguments("{s}", .{err}, globalObject).asObjectRef();
                return .zero;
            }
        }

        udpSocket.receiveBuf = uws.us_create_udp_packet_buffer().?;
        udpSocket.sendBuf = uws.us_create_udp_packet_buffer().?;

        var this: *This = udpSocket.vm.allocator.create(This) catch @panic("OOM");
        this.* = udpSocket;

        this.loop = uws.Loop.get();
        this.socket = uws.us_create_udp_socket(
            this.loop,
            this.receiveBuf,
            onData,
            onDrain,
            this.bindAddr.sliceZ(),
            this.bindPort,
            this,
        ).?;

        var this_value = this.toJS(globalObject);
        this.strong_self.set(globalObject, this_value);
        this.poll_ref.ref(this.vm);
        this.protectHandlers();
        globalObject.bunVM().eventLoop().ensureWaker();

        return this_value;
    }

    pub fn getThisValue(
        this: *This,
        globalObject: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        if (this.this_value == .zero) {
            const value = this.toJS(globalObject);
            value.ensureStillAlive();
            this.this_value = value;
            return value;
        }

        return this.this_value;
    }

    pub fn callErrorHandler(
        this: *This,
        thisValue: JSC.JSValue,
        err: []const JSC.JSValue,
    ) bool {
        const onError = this.onError;
        if (onError == .zero) {
            if (err.len > 0)
                this.vm.onUnhandledError(this.globalObject, err[0]);

            return false;
        }

        const result = onError.callWithThis(this.globalObject, thisValue, err);
        if (result.isAnyError()) {
            this.vm.onUnhandledError(this.globalObject, result);
        }

        return true;
    }

    pub fn protectHandlers(
        this: *This,
    ) void {
        inline for (handlersPairs) |pair| {
            @field(this, pair.@"0").protect();
        }
    }

    pub fn unprotectHandlers(
        this: *This,
    ) void {
        inline for (handlersPairs) |pair| {
            @field(this, pair.@"0").unprotect();
        }
    }

    pub fn connect(
        this: *This,
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        if (this.connectedAddrStorage != null) {
            globalObject.throw("Socket is already connected {}", .{});
            return .zero;
        }

        const arguments = callframe.arguments(2);
        if (arguments.len != 2) {
            globalObject.throw("Expected 2 arguments, got {}", .{arguments.len});
            return .zero;
        }

        const args = arguments.ptr[0..arguments.len];

        var addrStorage: std.os.sockaddr.storage = undefined;
        var ipv6: bool = false;

        const err: []const u8 = parseAddressPort(globalObject, args.ptr[0], args.ptr[1], &ipv6, &addrStorage);
        if (err.len > 0) {
            globalObject.throw("{s}", .{err});
            return .zero;
        }

        if (ipv6 != this.ipv6) {
            globalObject.throw("Specified peer address belongs to a different IP family", .{});
            return .zero;
        }

        this.connectedAddrStorage = addrStorage;
        return JSC.JSValue.jsUndefined();
    }

    // TODO support sending multiple packets
    pub fn send(
        this: *This,
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const arguments = callframe.arguments(3);

        if (this.connectedAddrStorage != null) {
            if (arguments.len != 1 and arguments.len != 3) {
                globalObject.throw("Expected 1 or 3 arguments, got {}", .{arguments.len});
                return .zero;
            }
        } else if (arguments.len != 3) {
            globalObject.throw("Expected 3 arguments, got {}", .{arguments.len});
            return .zero;
        }

        const args = arguments.ptr[0..arguments.len];

        var addrStorage: std.os.sockaddr.storage = init: {
            if (arguments.len == 3) {
                var addrStorage: std.os.sockaddr.storage = undefined;
                var ipv6: bool = undefined;
                const err: []const u8 = parseAddressPort(globalObject, args.ptr[1], args.ptr[2], &ipv6, &addrStorage);
                if (err.len > 0) {
                    globalObject.throw("{s}", .{err});
                    return .zero;
                }

                if (ipv6 != this.ipv6) {
                    globalObject.throw("Specified peer address belongs to a different IP family", .{});
                    return .zero;
                }
                break :init addrStorage;
            } else {
                break :init this.connectedAddrStorage.?;
            }
        };

        const payload = init: {
            if (args.ptr[0].asArrayBuffer(globalObject)) |arrayBuffer| {
                break :init arrayBuffer.slice();
            } else if (bun.String.tryFromJS(args.ptr[0], globalObject)) |bunStr| {
                var zigStr = bunStr.toUTF8(bun.default_allocator);
                defer zigStr.deinit();
                break :init zigStr.slice();
            } else {
                globalObject.throw("Expected ArrayBufferView or string (payload) as first argument", .{});
                return .zero;
            }
        };

        uws.us_udp_buffer_set_packet_payload(this.sendBuf, 0, 0, payload.ptr, @intCast(payload.len), @ptrCast(&addrStorage));
        const sent = uws.us_udp_socket_send(this.socket, this.sendBuf, 1);
        return JSC.jsNumber(sent);
    }

    pub fn stop(
        this: *This,
        globalObject: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());
        if (this.stopped) {
            globalObject.throw("Already stopped", .{});
            return .zero;
        }
        this.stopped = true;
        this.poll_ref.unref(this.vm);
        this.strong_self.clear();
        uws.us_udp_socket_close(this.socket);
        return JSC.JSValue.jsUndefined();
    }

    pub fn finalize(this: *This) callconv(.C) void {
        this.strong_self.deinit();
        this.bindAddr.deinit();
        this.unprotectHandlers();
        // Cast it into a us_poll_t pointer so that we can ask uSockets to free
        // the memory.
        var poll: *uws.Poll = @ptrCast(this.socket);
        poll.deinit(this.loop);
        bun.default_allocator.destroy(this);
    }
};
