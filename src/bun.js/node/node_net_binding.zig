//
//

pub var autoSelectFamilyDefault: bool = true;

pub fn getDefaultAutoSelectFamily(global: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSFunction.create(global, "getDefaultAutoSelectFamily", (struct {
        fn getter(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            _ = globalThis;
            _ = callframe;
            return .jsBoolean(autoSelectFamilyDefault);
        }
    }).getter, 0, .{});
}

pub fn setDefaultAutoSelectFamily(global: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSFunction.create(global, "setDefaultAutoSelectFamily", (struct {
        fn setter(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            const arguments = callframe.arguments_old(1);
            if (arguments.len < 1) {
                return globalThis.throw("missing argument", .{});
            }
            const arg = arguments.slice()[0];
            if (!arg.isBoolean()) {
                return globalThis.throwInvalidArguments("autoSelectFamilyDefault", .{});
            }
            const value = arg.toBoolean();
            autoSelectFamilyDefault = value;
            return .jsBoolean(value);
        }
    }).setter, 1, .{});
}

/// This is only used to provide the getDefaultAutoSelectFamilyAttemptTimeout and
/// setDefaultAutoSelectFamilyAttemptTimeout functions, not currently read by any other code. It's
/// `threadlocal` because Node.js expects each Worker to have its own copy of this, and currently
/// it can only be accessed by accessor functions which run on each Worker's main JavaScript thread.
///
/// If this becomes used in more places, and especially if it can be read by other threads, we may
/// need to store it as a field in the VirtualMachine instead of in a `threadlocal`.
pub threadlocal var autoSelectFamilyAttemptTimeoutDefault: u32 = 250;

pub fn getDefaultAutoSelectFamilyAttemptTimeout(global: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSFunction.create(global, "getDefaultAutoSelectFamilyAttemptTimeout", (struct {
        fn getter(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            _ = globalThis;
            _ = callframe;
            return .jsNumber(autoSelectFamilyAttemptTimeoutDefault);
        }
    }).getter, 0, .{});
}

pub fn setDefaultAutoSelectFamilyAttemptTimeout(global: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSFunction.create(global, "setDefaultAutoSelectFamilyAttemptTimeout", (struct {
        fn setter(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            const arguments = callframe.arguments_old(1);
            if (arguments.len < 1) {
                return globalThis.throw("missing argument", .{});
            }
            const arg = arguments.slice()[0];
            var value = try validators.validateInt32(globalThis, arg, "value", .{}, 1, null);
            if (value < 10) value = 10;
            autoSelectFamilyAttemptTimeoutDefault = @intCast(value);
            return .jsNumber(value);
        }
    }).setter, 1, .{});
}

pub const SocketAddress = bun.jsc.Codegen.JSSocketAddress.getConstructor;

pub const BlockList = jsc.Codegen.JSBlockList.getConstructor;

pub fn newDetachedSocket(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.argumentsAsArray(1);
    const is_ssl = args[0].toBoolean();

    if (!is_ssl) {
        const socket = bun.api.TCPSocket.new(.{
            .socket = .detached,
            .ref_count = .init(),
            .protos = null,
            .handlers = null,
        });
        return socket.getThisValue(globalThis);
    } else {
        const socket = bun.api.TLSSocket.new(.{
            .socket = .detached,
            .ref_count = .init(),
            .protos = null,
            .handlers = null,
        });
        return socket.getThisValue(globalThis);
    }
}

pub fn doConnect(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const prev, const opts = callframe.argumentsAsArray(2);
    const maybe_tcp = prev.as(bun.api.TCPSocket);
    const maybe_tls = prev.as(bun.api.TLSSocket);
    return bun.api.Listener.connectInner(globalThis, maybe_tcp, maybe_tls, opts);
}

/// Create a connected TCPSocket from an existing file descriptor.
/// Used by IPC parseHandle to reconstruct a net.Socket from a received fd.
/// The socket is created in a paused state so no events fire until the JS
/// side has attached handlers via net.Socket.
pub fn socketFromFd(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.argumentsAsArray(1);
    const fd_value = args[0];
    if (!fd_value.isNumber()) {
        return globalThis.throw("Expected a number for fd", .{});
    }
    const fd = fd_value.asFileDescriptor();

    const context = uws.SocketContext.createNoSSLContext(uws.Loop.get(), @sizeOf(usize)) orelse {
        return globalThis.throw("Failed to create socket context", .{});
    };
    uws.NewSocketHandler(false).configure(context, true, *bun.api.TCPSocket, bun.api.TCPSocket);

    const handlers_ptr = bun.handleOom(globalThis.bunVM().allocator.create(bun.api.SocketHandlers));
    handlers_ptr.* = .{
        .vm = globalThis.bunVM(),
        .globalObject = globalThis,
    };

    const tcp_socket = bun.api.TCPSocket.new(.{
        .socket = .detached,
        .socket_context = context,
        .ref_count = .init(),
        .protos = null,
        .handlers = handlers_ptr,
    });

    const native_socket = bun.api.TCPSocket.Socket.fromFd(context, fd, bun.api.TCPSocket, tcp_socket, null, false) orelse {
        // Free handlers before deref — deinit() won't reach Handlers.markInactive()
        // because onOpen() never fired so is_active stays false.
        tcp_socket.handlers = null;
        globalThis.bunVM().allocator.destroy(handlers_ptr);
        tcp_socket.deref();
        fd.close();
        return globalThis.throw("Failed to create socket from fd", .{});
    };

    tcp_socket.socket = native_socket;
    // Call onOpen so markActive() fires — without this, handlers_ptr leaks
    // when the socket closes because markInactive() is guarded by is_active.
    tcp_socket.onOpen(native_socket);
    return tcp_socket.getThisValue(globalThis);
}

const validators = @import("./util/validators.zig");

const bun = @import("bun");
const jsc = bun.jsc;
const uws = bun.uws;
