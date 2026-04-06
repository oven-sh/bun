// Most of this code should be rewritten.
// - Usage of jsc.Strong.Optional here is likely to cause memory leaks.
// - These sequence numbers and ACKs shouldn't exist from JavaScript's perspective
//   at all. It should happen in the protocol before it reaches JS.
// - We should not be creating JSFunction's in process.nextTick.
const log = Output.scoped(.IPC, .visible);

extern fn Bun__Process__queueNextTick1(*jsc.JSGlobalObject, jsc.JSValue, jsc.JSValue) void;
extern fn Process__emitErrorEvent(global: *jsc.JSGlobalObject, value: jsc.JSValue) void;

pub var child_singleton: InternalMsgHolder = .{};

pub fn sendHelperChild(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
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
        // TODO: remove this strong. This is expensive and would be an easy way to create a memory leak.
        // These sequence numbers shouldn't exist from JavaScript's perspective at all.
        bun.handleOom(child_singleton.callbacks.put(bun.default_allocator, child_singleton.seq, jsc.Strong.Optional.create(callback, globalThis)));
    }

    // sequence number for InternalMsgHolder
    message.put(globalThis, ZigString.static("seq"), jsc.JSValue.jsNumber(child_singleton.seq));
    child_singleton.seq +%= 1;

    // similar code as Bun__Process__send
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
    defer formatter.deinit();
    if (Environment.isDebug) log("child: {f}", .{message.toFmt(&formatter)});

    const ipc_instance = vm.getIPCInstance().?;

    const S = struct {
        fn impl(globalThis_: *jsc.JSGlobalObject, callframe_: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            const arguments_ = callframe_.arguments_old(1).slice();
            const ex = arguments_[0];
            Process__emitErrorEvent(globalThis_, ex.toError() orelse ex);
            return .js_undefined;
        }
    };

    const good = ipc_instance.data.serializeAndSend(globalThis, message, .internal, .null, null);

    if (good == .failure) {
        const ex = globalThis.createTypeErrorInstance("sendInternal() failed", .{});
        ex.put(globalThis, ZigString.static("syscall"), try bun.String.static("write").toJS(globalThis));
        const fnvalue = jsc.JSFunction.create(globalThis, "", S.impl, 1, .{});
        try fnvalue.callNextTick(globalThis, .{ex});
        return .false;
    }

    return if (good == .success) .true else .false;
}

pub fn onInternalMessageChild(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    log("onInternalMessageChild", .{});
    const arguments = callframe.arguments_old(2).ptr;
    // TODO: we should not create two jsc.Strong.Optional here. If absolutely necessary, a single Array. should be all we use.
    child_singleton.worker = .create(arguments[0], globalThis);
    child_singleton.cb = .create(arguments[1], globalThis);
    try child_singleton.flush(globalThis);
    return .js_undefined;
}

pub fn handleInternalMessageChild(globalThis: *jsc.JSGlobalObject, message: jsc.JSValue) bun.JSError!void {
    log("handleInternalMessageChild", .{});

    try child_singleton.dispatch(message, globalThis);
}

// TODO: rewrite this code.
/// Queue for messages sent between parent and child processes in an IPC environment. node:cluster sends json serialized messages
/// to describe different events it performs. It will send a message with an incrementing sequence number and then call a callback
/// when a message is received with an 'ack' property of the same sequence number.
pub const InternalMsgHolder = struct {
    seq: i32 = 0,

    // TODO: move this to an Array or a JS Object or something which doesn't
    // individually create a Strong for every single IPC message...
    callbacks: std.AutoArrayHashMapUnmanaged(i32, jsc.Strong.Optional) = .{},
    worker: jsc.Strong.Optional = .empty,
    cb: jsc.Strong.Optional = .empty,
    messages: std.ArrayListUnmanaged(jsc.Strong.Optional) = .{},

    pub fn isReady(this: *InternalMsgHolder) bool {
        return this.worker.has() and this.cb.has();
    }

    pub fn enqueue(this: *InternalMsgHolder, message: jsc.JSValue, globalThis: *jsc.JSGlobalObject) void {
        //TODO: .addOne is workaround for .append causing crash/ dependency loop in zig compiler
        const new_item_ptr = bun.handleOom(this.messages.addOne(bun.default_allocator));
        new_item_ptr.* = .create(message, globalThis);
    }

    pub fn dispatch(this: *InternalMsgHolder, message: jsc.JSValue, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
        if (!this.isReady()) {
            this.enqueue(message, globalThis);
            return;
        }
        try this.dispatchUnsafe(message, globalThis);
    }

    fn dispatchUnsafe(this: *InternalMsgHolder, message: jsc.JSValue, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
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

    pub fn flush(this: *InternalMsgHolder, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
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

pub fn sendHelperPrimary(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    log("sendHelperPrimary", .{});

    const arguments = callframe.arguments_old(4).ptr;
    const subprocess = arguments[0].as(bun.jsc.Subprocess).?;
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
        bun.handleOom(ipc_data.internal_msg_queue.callbacks.put(bun.default_allocator, ipc_data.internal_msg_queue.seq, jsc.Strong.Optional.create(callback, globalThis)));
    }

    // sequence number for InternalMsgHolder
    message.put(globalThis, ZigString.static("seq"), jsc.JSValue.jsNumber(ipc_data.internal_msg_queue.seq));
    ipc_data.internal_msg_queue.seq +%= 1;

    // similar code as bun.jsc.Subprocess.doSend
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
    defer formatter.deinit();
    if (Environment.isDebug) log("primary: {f}", .{message.toFmt(&formatter)});

    _ = handle;
    const success = ipc_data.serializeAndSend(globalThis, message, .internal, .null, null);
    return if (success == .success) .true else .false;
}

pub fn onInternalMessagePrimary(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(3).ptr;
    const subprocess = arguments[0].as(bun.jsc.Subprocess).?;
    const ipc_data = subprocess.ipc() orelse return .js_undefined;
    // TODO: remove these strongs.
    ipc_data.internal_msg_queue.worker = .create(arguments[1], globalThis);
    ipc_data.internal_msg_queue.cb = .create(arguments[2], globalThis);
    return .js_undefined;
}

pub fn handleInternalMessagePrimary(globalThis: *jsc.JSGlobalObject, subprocess: *jsc.Subprocess, message: jsc.JSValue) bun.JSError!void {
    const ipc_data = subprocess.ipc() orelse return;

    const event_loop = globalThis.bunVM().eventLoop();

    // TODO: investigate if "ack" and "seq" are observable and if they're not, remove them entirely.
    if (try message.get(globalThis, "ack")) |p| {
        if (!p.isUndefined()) {
            const ack = p.toInt32();
            if (ipc_data.internal_msg_queue.callbacks.getEntry(ack)) |entry| {
                var cbstrong = entry.value_ptr.*;
                defer cbstrong.deinit();
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

pub fn setRef(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(1).ptr;

    if (arguments.len == 0) {
        return globalObject.throwMissingArgumentsValue(&.{"enabled"});
    }
    if (!arguments[0].isBoolean()) {
        return globalObject.throwInvalidArgumentTypeValue("enabled", "boolean", arguments[0]);
    }

    const enabled = arguments[0].toBoolean();
    const vm = globalObject.bunVM();
    vm.channel_ref_overridden = true;
    if (enabled) {
        vm.channel_ref.ref(vm);
    } else {
        vm.channel_ref.unref(vm);
    }
    return .js_undefined;
}

export fn Bun__refChannelUnlessOverridden(globalObject: *jsc.JSGlobalObject) void {
    const vm = globalObject.bunVM();
    if (!vm.channel_ref_overridden) {
        vm.channel_ref.ref(vm);
    }
}
export fn Bun__unrefChannelUnlessOverridden(globalObject: *jsc.JSGlobalObject) void {
    const vm = globalObject.bunVM();
    if (!vm.channel_ref_overridden) {
        vm.channel_ref.unref(vm);
    }
}
pub fn channelIgnoreOneDisconnectEventListener(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    vm.channel_ref_should_ignore_one_disconnect_event_listener = true;
    return .false;
}
export fn Bun__shouldIgnoreOneDisconnectEventListener(globalObject: *jsc.JSGlobalObject) bool {
    const vm = globalObject.bunVM();
    return vm.channel_ref_should_ignore_one_disconnect_event_listener;
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;

const jsc = bun.jsc;
const ZigString = jsc.ZigString;
