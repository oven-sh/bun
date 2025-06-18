const TimeoutObject = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const js = JSC.Codegen.JSTimeout;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

ref_count: RefCount,
event_loop_timer: EventLoopTimer = .{
    .next = .{},
    .tag = .TimeoutObject,
},
internals: TimerObjectInternals,

pub fn init(
    globalThis: *JSGlobalObject,
    id: i32,
    kind: Kind,
    interval: u31,
    callback: JSValue,
    arguments: JSValue,
) JSValue {
    // internals are initialized by init()
    const timeout = bun.new(TimeoutObject, .{ .ref_count = .init(), .internals = undefined });
    const js_value = timeout.toJS(globalThis);
    defer js_value.ensureStillAlive();
    timeout.internals.init(
        js_value,
        globalThis,
        id,
        kind,
        interval,
        callback,
        arguments,
    );

    if (globalThis.bunVM().isInspectorEnabled()) {
        Debugger.didScheduleAsyncCall(
            globalThis,
            .DOMTimer,
            ID.asyncID(.{ .id = id, .kind = kind.big() }),
            kind != .setInterval,
        );
    }

    return js_value;
}

fn deinit(this: *TimeoutObject) void {
    this.internals.deinit();
    bun.destroy(this);
}

pub fn constructor(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) !*TimeoutObject {
    _ = callFrame;
    return globalObject.throw("Timeout is not constructible", .{});
}

pub fn toPrimitive(this: *TimeoutObject, _: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    return this.internals.toPrimitive();
}

pub fn doRef(this: *TimeoutObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
    return this.internals.doRef(globalThis, callFrame.this());
}

pub fn doUnref(this: *TimeoutObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
    return this.internals.doUnref(globalThis, callFrame.this());
}

pub fn doRefresh(this: *TimeoutObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
    return this.internals.doRefresh(globalThis, callFrame.this());
}

pub fn hasRef(this: *TimeoutObject, _: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    return this.internals.hasRef();
}

pub fn finalize(this: *TimeoutObject) void {
    this.internals.finalize();
}

pub fn getDestroyed(this: *TimeoutObject, globalThis: *JSGlobalObject) JSValue {
    _ = globalThis;
    return .jsBoolean(this.internals.getDestroyed());
}

pub fn close(this: *TimeoutObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) JSValue {
    this.internals.cancel(globalThis.bunVM());
    return callFrame.this();
}

pub fn get_onTimeout(_: *TimeoutObject, thisValue: JSValue, _: *JSGlobalObject) JSValue {
    return TimeoutObject.js.callbackGetCached(thisValue).?;
}

pub fn set_onTimeout(_: *TimeoutObject, thisValue: JSValue, globalThis: *JSGlobalObject, value: JSValue) void {
    TimeoutObject.js.callbackSetCached(thisValue, globalThis, value);
}

pub fn get_idleTimeout(_: *TimeoutObject, thisValue: JSValue, _: *JSGlobalObject) JSValue {
    return TimeoutObject.js.idleTimeoutGetCached(thisValue).?;
}

pub fn set_idleTimeout(_: *TimeoutObject, thisValue: JSValue, globalThis: *JSGlobalObject, value: JSValue) void {
    TimeoutObject.js.idleTimeoutSetCached(thisValue, globalThis, value);
}

pub fn get_repeat(_: *TimeoutObject, thisValue: JSValue, _: *JSGlobalObject) JSValue {
    return TimeoutObject.js.repeatGetCached(thisValue).?;
}

pub fn set_repeat(_: *TimeoutObject, thisValue: JSValue, globalThis: *JSGlobalObject, value: JSValue) void {
    TimeoutObject.js.repeatSetCached(thisValue, globalThis, value);
}

pub fn dispose(this: *TimeoutObject, globalThis: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    this.internals.cancel(globalThis.bunVM());
    return .js_undefined;
}

const bun = @import("bun");
const JSC = bun.JSC;
const TimerObjectInternals = @import("../Timer.zig").TimerObjectInternals;
const Debugger = @import("../../Debugger.zig");
const ID = @import("../Timer.zig").ID;
const Kind = @import("../Timer.zig").Kind;
const EventLoopTimer = @import("../Timer.zig").EventLoopTimer;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
