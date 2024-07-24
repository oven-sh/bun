const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const log = Output.scoped(.IPC, false);

extern fn Bun__Process__queueNextTick1(*JSC.ZigGlobalObject, JSC.JSValue, JSC.JSValue) void;
extern fn Process__emitErrorEvent(global: *JSC.JSGlobalObject, value: JSC.JSValue) void;

pub var child_singleton: InternalMsgHolder = .{};

pub fn sendHelperChild(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    log("sendHelperChild", .{});

    const arguments = callframe.arguments(3).ptr;
    const message = arguments[0];
    const handle = arguments[1];
    const callback = arguments[2];

    const vm = globalThis.bunVM();

    if (vm.ipc == null) {
        return .false;
    }
    if (message.isUndefined()) {
        return globalThis.throwValueRet(globalThis.ERR_MISSING_ARGS_1(ZigString.static("message").toJS(globalThis)));
    }
    if (!handle.isNull()) {
        globalThis.throw("passing 'handle' not implemented yet", .{});
        return .zero;
    }
    if (!message.isObject()) {
        return globalThis.throwValueRet(globalThis.ERR_INVALID_ARG_TYPE(
            ZigString.static("message").toJS(globalThis),
            ZigString.static("object").toJS(globalThis),
            message,
        ));
    }
    if (callback.isFunction()) {
        child_singleton.callbacks.put(bun.default_allocator, child_singleton.seq, JSC.Strong.create(callback, globalThis)) catch bun.outOfMemory();
    }

    message.put(globalThis, ZigString.static("seq"), JSC.JSValue.jsNumber(child_singleton.seq));
    child_singleton.seq +%= 1;

    // similar code as Bun__Process__send

    const ipc_instance = vm.getIPCInstance().?;
    const process_queueNextTick1 = Bun__Process__queueNextTick1;
    const zigGlobal: *JSC.ZigGlobalObject = @ptrCast(globalThis);

    const S = struct {
        fn impl(globalThis_: *JSC.JSGlobalObject, callframe_: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
            const arguments_ = callframe_.arguments(1).slice();
            const ex = arguments_[0];
            Process__emitErrorEvent(globalThis_, ex);
            return .undefined;
        }
        var value: ?JSC.JSValue = null;
    };

    const good = ipc_instance.data.serializeAndSendInternal(globalThis, message);

    if (!good) {
        const ex = globalThis.createTypeErrorInstance("sendInternal() failed", .{});
        ex.put(globalThis, ZigString.static("syscall"), ZigString.static("write").toJS(globalThis));
        if (S.value == null) {
            S.value = JSC.JSFunction.create(globalThis, "", S.impl, 1, .{});
        }
        process_queueNextTick1(zigGlobal, S.value.?, ex);
    }

    return .true;
}

pub fn onInternalMessageChild(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments(2).ptr;
    child_singleton.worker = JSC.Strong.create(arguments[0], globalThis);
    child_singleton.cb = JSC.Strong.create(arguments[1], globalThis);
    return .undefined;
}

pub fn handleInternalMessageChild(globalThis: *JSC.JSGlobalObject, message: JSC.JSValue) void {
    if (message.get(globalThis, "ack")) |p| {
        if (!p.isUndefined()) {
            const ack = p.toInt32();
            if (child_singleton.callbacks.getEntry(ack)) |entry| {
                var cbstrong = entry.value_ptr.*;
                defer cbstrong.deinit();
                _ = child_singleton.callbacks.swapRemove(ack);
                const cb = cbstrong.get().?;
                _ = cb.call(globalThis, child_singleton.worker.get().?, &.{
                    message,
                    .null, // handle
                });
                return;
            }
        }
    }
    const cb = child_singleton.cb.get().?;
    _ = cb.call(globalThis, child_singleton.worker.get().?, &.{
        message,
        .null, // handle
    });
    return;
}

//
//
//

pub const InternalMsgHolder = struct {
    seq: i32 = 0,
    callbacks: std.AutoArrayHashMapUnmanaged(i32, JSC.Strong) = .{},

    worker: JSC.Strong = .{},
    cb: JSC.Strong = .{},

    pub fn deinit(iimh: *InternalMsgHolder) void {
        for (iimh.callbacks.values()) |*strong| strong.deinit();
        iimh.callbacks.deinit(bun.default_allocator);
        iimh.worker.deinit();
        iimh.cb.deinit();
    }
};

pub fn sendHelperPrimary(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    log("sendHelperPrimary", .{});

    const arguments = callframe.arguments(4).ptr;
    const subprocess = arguments[0].as(bun.JSC.Subprocess).?;
    const message = arguments[1];
    const handle = arguments[2];
    const callback = arguments[3];

    const ipc_data = subprocess.ipc_maybe() orelse return .false;

    if (message.isUndefined()) {
        return globalThis.throwValueRet(globalThis.ERR_MISSING_ARGS_1(ZigString.static("message").toJS(globalThis)));
    }
    if (!message.isObject()) {
        return globalThis.throwValueRet(globalThis.ERR_INVALID_ARG_TYPE(
            ZigString.static("message").toJS(globalThis),
            ZigString.static("object").toJS(globalThis),
            message,
        ));
    }
    if (callback.isFunction()) {
        ipc_data.iimh.callbacks.put(bun.default_allocator, ipc_data.iimh.seq, JSC.Strong.create(callback, globalThis)) catch bun.outOfMemory();
    }

    message.put(globalThis, ZigString.static("seq"), JSC.JSValue.jsNumber(ipc_data.iimh.seq));
    ipc_data.iimh.seq +%= 1;

    // similar code as bun.JSC.Subprocess.doSend

    _ = handle;
    const success = ipc_data.serializeAndSendInternal(globalThis, message);
    if (!success) return .zero;

    return .true;
}

pub fn onInternalMessagePrimary(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments(3).ptr;
    const subprocess = arguments[0].as(bun.JSC.Subprocess).?;
    const ipc_data = subprocess.ipc();
    ipc_data.iimh.worker = JSC.Strong.create(arguments[1], globalThis);
    ipc_data.iimh.cb = JSC.Strong.create(arguments[2], globalThis);
    return .undefined;
}

pub fn handleInternalMessagePrimary(globalThis: *JSC.JSGlobalObject, subprocess: *JSC.Subprocess, message: JSC.JSValue) void {
    const ipc_data = subprocess.ipc();

    if (message.get(globalThis, "ack")) |p| {
        if (!p.isUndefined()) {
            const ack = p.toInt32();
            if (ipc_data.iimh.callbacks.getEntry(ack)) |entry| {
                var cbstrong = entry.value_ptr.*;
                defer cbstrong.clear();
                _ = ipc_data.iimh.callbacks.swapRemove(ack);
                const cb = cbstrong.get().?;
                _ = cb.call(globalThis, ipc_data.iimh.worker.get().?, &.{
                    message,
                    .null, // handle
                });
                return;
            }
        }
    }
    const cb = ipc_data.iimh.cb.get().?;
    _ = cb.call(globalThis, ipc_data.iimh.worker.get().?, &.{
        message,
        .null, // handle
    });
    return;
}

//
//
//

extern fn Bun__setChannelRef(*JSC.JSGlobalObject, bool) void;

pub fn setRef(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    const arguments = callframe.arguments(1).ptr;

    if (arguments.len == 0) {
        return globalObject.throwValueRet(globalObject.ERR_MISSING_ARGS_1(ZigString.static("enabled").toJS(globalObject)));
    }
    if (!arguments[0].isBoolean()) {
        return globalObject.throwValueRet(globalObject.ERR_INVALID_ARG_TYPE(
            ZigString.static("enabled").toJS(globalObject),
            ZigString.static("boolean").toJS(globalObject),
            arguments[0],
        ));
    }

    const enabled = arguments[0].toBoolean();
    Bun__setChannelRef(globalObject, enabled);
    return .undefined;
}
