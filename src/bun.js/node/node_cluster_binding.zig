const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const log = Output.scoped(.IPC, false);

extern fn Bun__Process__queueNextTick1(*JSC.JSGlobalObject, JSC.JSValue, JSC.JSValue) void;
extern fn Process__emitErrorEvent(global: *JSC.JSGlobalObject, value: JSC.JSValue) void;

pub var child_singleton: InternalMsgHolder = .{};

pub fn sendHelperChild(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    log("sendHelperChild", .{});

    const arguments = callframe.arguments_old(3).ptr;
    const message = arguments[0];
    const handle = arguments[1];
    const callback = arguments[2];

    const vm = globalThis.bunVM();

    if (vm.ipc == null) {
        return .false;
    }
    if (message.isUndefined()) {
        return globalThis.throwMissingArgumentsValue(&.{"message"});
    }
    if (!handle.isNull()) {
        return globalThis.throw("passing 'handle' not implemented yet", .{});
    }
    if (!message.isObject()) {
        return globalThis.throwInvalidArgumentTypeValue("message", "object", message);
    }
    if (callback.isFunction()) {
        child_singleton.callbacks.put(bun.default_allocator, child_singleton.seq, JSC.Strong.create(callback, globalThis)) catch bun.outOfMemory();
    }

    // sequence number for InternalMsgHolder
    message.put(globalThis, ZigString.static("seq"), JSC.JSValue.jsNumber(child_singleton.seq));
    child_singleton.seq +%= 1;

    // similar code as Bun__Process__send
    var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
    if (Environment.isDebug) log("child: {}", .{message.toFmt(&formatter)});

    const ipc_instance = vm.getIPCInstance().?;

    const S = struct {
        fn impl(globalThis_: *JSC.JSGlobalObject, callframe_: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments_ = callframe_.arguments_old(1).slice();
            const ex = arguments_[0];
            Process__emitErrorEvent(globalThis_, ex);
            return .undefined;
        }
    };

    const good = ipc_instance.data.serializeAndSendInternal(globalThis, message);

    if (!good) {
        const ex = globalThis.createTypeErrorInstance("sendInternal() failed", .{});
        ex.put(globalThis, ZigString.static("syscall"), bun.String.static("write").toJS(globalThis));
        const fnvalue = JSC.JSFunction.create(globalThis, "", S.impl, 1, .{});
        Bun__Process__queueNextTick1(globalThis, fnvalue, ex);
        return .false;
    }

    return .true;
}

pub fn onInternalMessageChild(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    log("onInternalMessageChild", .{});
    const arguments = callframe.arguments_old(2).ptr;
    child_singleton.worker = JSC.Strong.create(arguments[0], globalThis);
    child_singleton.cb = JSC.Strong.create(arguments[1], globalThis);
    try child_singleton.flush(globalThis);
    return .undefined;
}

pub fn handleInternalMessageChild(globalThis: *JSC.JSGlobalObject, message: JSC.JSValue) bun.JSError!void {
    log("handleInternalMessageChild", .{});

    try child_singleton.dispatch(message, globalThis);
}

//
//
//

/// Queue for messages sent between parent and child processes in an IPC environment. node:cluster sends json serialized messages
/// to describe different events it performs. It will send a message with an incrementing sequence number and then call a callback
/// when a message is recieved with an 'ack' property of the same sequence number.
pub const InternalMsgHolder = struct {
    seq: i32 = 0,
    callbacks: std.AutoArrayHashMapUnmanaged(i32, JSC.Strong) = .{},

    worker: JSC.Strong = .{},
    cb: JSC.Strong = .{},
    messages: std.ArrayListUnmanaged(JSC.Strong) = .{},

    pub fn isReady(this: *InternalMsgHolder) bool {
        return this.worker.has() and this.cb.has();
    }

    pub fn enqueue(this: *InternalMsgHolder, message: JSC.JSValue, globalThis: *JSC.JSGlobalObject) void {
        //TODO: .addOne is workaround for .append causing crash/ dependency loop in zig compiler
        const new_item_ptr = this.messages.addOne(bun.default_allocator) catch bun.outOfMemory();
        new_item_ptr.* = JSC.Strong.create(message, globalThis);
    }

    pub fn dispatch(this: *InternalMsgHolder, message: JSC.JSValue, globalThis: *JSC.JSGlobalObject) bun.JSError!void {
        if (!this.isReady()) {
            this.enqueue(message, globalThis);
            return;
        }
        try this.dispatchUnsafe(message, globalThis);
    }

    fn dispatchUnsafe(this: *InternalMsgHolder, message: JSC.JSValue, globalThis: *JSC.JSGlobalObject) bun.JSError!void {
        const cb = this.cb.get().?;
        const worker = this.worker.get().?;

        const event_loop = globalThis.bunVM().eventLoop();

        if (try message.get(globalThis, "ack")) |p| {
            if (!p.isUndefined()) {
                const ack = p.toInt32();
                if (this.callbacks.getEntry(ack)) |entry| {
                    var cbstrong = entry.value_ptr.*;
                    if (cbstrong.get()) |callback| {
                        defer cbstrong.deinit();
                        _ = this.callbacks.swapRemove(ack);
                        event_loop.runCallback(callback, globalThis, this.worker.get().?, &.{
                            message,
                            .null, // handle
                        });
                        return;
                    }
                    return;
                }
            }
        }
        event_loop.runCallback(cb, globalThis, worker, &.{
            message,
            .null, // handle
        });
    }

    pub fn flush(this: *InternalMsgHolder, globalThis: *JSC.JSGlobalObject) bun.JSError!void {
        bun.assert(this.isReady());
        var messages = this.messages;
        this.messages = .{};
        for (messages.items) |*strong| {
            if (strong.get()) |message| {
                try this.dispatchUnsafe(message, globalThis);
            }
            strong.deinit();
        }
        messages.deinit(bun.default_allocator);
    }

    pub fn deinit(this: *InternalMsgHolder) void {
        for (this.callbacks.values()) |*strong| strong.deinit();
        this.callbacks.deinit(bun.default_allocator);
        this.worker.deinit();
        this.cb.deinit();
        for (this.messages.items) |*strong| strong.deinit();
        this.messages.deinit(bun.default_allocator);
    }
};

pub fn sendHelperPrimary(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    log("sendHelperPrimary", .{});

    const arguments = callframe.arguments_old(4).ptr;
    const subprocess = arguments[0].as(bun.JSC.Subprocess).?;
    const message = arguments[1];
    const handle = arguments[2];
    const callback = arguments[3];

    const ipc_data = subprocess.ipc() orelse return .false;

    if (message.isUndefined()) {
        return globalThis.throwMissingArgumentsValue(&.{"message"});
    }
    if (!message.isObject()) {
        return globalThis.throwInvalidArgumentTypeValue("message", "object", message);
    }
    if (callback.isFunction()) {
        ipc_data.internal_msg_queue.callbacks.put(bun.default_allocator, ipc_data.internal_msg_queue.seq, JSC.Strong.create(callback, globalThis)) catch bun.outOfMemory();
    }

    // sequence number for InternalMsgHolder
    message.put(globalThis, ZigString.static("seq"), JSC.JSValue.jsNumber(ipc_data.internal_msg_queue.seq));
    ipc_data.internal_msg_queue.seq +%= 1;

    // similar code as bun.JSC.Subprocess.doSend
    var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
    if (Environment.isDebug) log("primary: {}", .{message.toFmt(&formatter)});

    _ = handle;
    const success = ipc_data.serializeAndSendInternal(globalThis, message);
    if (!success) return .false;

    return .true;
}

pub fn onInternalMessagePrimary(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(3).ptr;
    const subprocess = arguments[0].as(bun.JSC.Subprocess).?;
    const ipc_data = subprocess.ipc() orelse return .undefined;
    ipc_data.internal_msg_queue.worker = JSC.Strong.create(arguments[1], globalThis);
    ipc_data.internal_msg_queue.cb = JSC.Strong.create(arguments[2], globalThis);
    return .undefined;
}

pub fn handleInternalMessagePrimary(globalThis: *JSC.JSGlobalObject, subprocess: *JSC.Subprocess, message: JSC.JSValue) bun.JSError!void {
    const ipc_data = subprocess.ipc() orelse return;

    const event_loop = globalThis.bunVM().eventLoop();

    if (try message.get(globalThis, "ack")) |p| {
        if (!p.isUndefined()) {
            const ack = p.toInt32();
            if (ipc_data.internal_msg_queue.callbacks.getEntry(ack)) |entry| {
                var cbstrong = entry.value_ptr.*;
                defer cbstrong.clear();
                _ = ipc_data.internal_msg_queue.callbacks.swapRemove(ack);
                const cb = cbstrong.get().?;
                event_loop.runCallback(cb, globalThis, ipc_data.internal_msg_queue.worker.get().?, &.{
                    message,
                    .null, // handle
                });
                return;
            }
        }
    }
    const cb = ipc_data.internal_msg_queue.cb.get().?;
    event_loop.runCallback(cb, globalThis, ipc_data.internal_msg_queue.worker.get().?, &.{
        message,
        .null, // handle
    });
    return;
}

//
//
//

extern fn Bun__setChannelRef(*JSC.JSGlobalObject, bool) void;

pub fn setRef(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1).ptr;

    if (arguments.len == 0) {
        return globalObject.throwMissingArgumentsValue(&.{"enabled"});
    }
    if (!arguments[0].isBoolean()) {
        return globalObject.throwInvalidArgumentTypeValue("enabled", "boolean", arguments[0]);
    }

    const enabled = arguments[0].toBoolean();
    Bun__setChannelRef(globalObject, enabled);
    return .undefined;
}
