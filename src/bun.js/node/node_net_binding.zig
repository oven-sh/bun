const bun = @import("bun");
const JSC = bun.JSC;
const validators = @import("./util/validators.zig");

//
//

pub var autoSelectFamilyDefault: bool = true;

pub fn getDefaultAutoSelectFamily(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "getDefaultAutoSelectFamily", (struct {
        fn getter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            return JSC.jsBoolean(autoSelectFamilyDefault);
        }
    }).getter, 0, .{});
}

pub fn setDefaultAutoSelectFamily(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "setDefaultAutoSelectFamily", (struct {
        fn setter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
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
            return JSC.jsBoolean(value);
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

pub fn getDefaultAutoSelectFamilyAttemptTimeout(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "getDefaultAutoSelectFamilyAttemptTimeout", (struct {
        fn getter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            return JSC.jsNumber(autoSelectFamilyAttemptTimeoutDefault);
        }
    }).getter, 0, .{});
}

pub fn setDefaultAutoSelectFamilyAttemptTimeout(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "setDefaultAutoSelectFamilyAttemptTimeout", (struct {
        fn setter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments = callframe.arguments_old(1);
            if (arguments.len < 1) {
                return globalThis.throw("missing argument", .{});
            }
            const arg = arguments.slice()[0];
            var value = try validators.validateInt32(globalThis, arg, "value", .{}, 1, null);
            if (value < 10) value = 10;
            autoSelectFamilyAttemptTimeoutDefault = @intCast(value);
            return JSC.jsNumber(value);
        }
    }).setter, 1, .{});
}

pub const SocketAddress = bun.JSC.Codegen.JSSocketAddress.getConstructor;

pub const BlockList = JSC.Codegen.JSBlockList.getConstructor;

pub fn newDetachedSocket(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const args = callframe.argumentsAsArray(1);
    const is_ssl = args[0].toBoolean();

    if (!is_ssl) {
        const socket = bun.api.TCPSocket.new(.{
            .socket = .detached,
            .socket_context = null,
            .ref_count = .init(),
            .protos = null,
            .handlers = undefined,
        });
        return socket.getThisValue(globalThis);
    } else {
        const socket = bun.api.TLSSocket.new(.{
            .socket = .detached,
            .socket_context = null,
            .ref_count = .init(),
            .protos = null,
            .handlers = undefined,
        });
        return socket.getThisValue(globalThis);
    }
}

pub fn doConnect(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const prev, const opts = callframe.argumentsAsArray(2);
    const maybe_tcp = prev.as(bun.api.TCPSocket);
    const maybe_tls = prev.as(bun.api.TLSSocket);
    return bun.api.Listener.connectInner(globalThis, maybe_tcp, maybe_tls, opts);
}
