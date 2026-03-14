const Self = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const js = jsc.Codegen.JSTimeout;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

ref_count: RefCount,
event_loop_timer: EventLoopTimer = .{
    .next = .epoch,
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
    const timeout = bun.new(Self, .{ .ref_count = .init(), .internals = undefined });
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

fn deinit(self: *Self) void {
    self.internals.deinit();
    bun.destroy(self);
}

pub fn constructor(globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) !*Self {
    _ = callFrame;
    return globalObject.throw("Timeout is not constructible", .{});
}

pub fn toPrimitive(self: *Self, _: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    return self.internals.toPrimitive();
}

pub fn doRef(self: *Self, globalThis: *JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    return self.internals.doRef(globalThis, callFrame.this());
}

pub fn doUnref(self: *Self, globalThis: *JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    return self.internals.doUnref(globalThis, callFrame.this());
}

pub fn doRefresh(self: *Self, globalThis: *JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    return self.internals.doRefresh(globalThis, callFrame.this());
}

pub fn hasRef(self: *Self, _: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    return self.internals.hasRef();
}

pub fn finalize(self: *Self) void {
    self.internals.finalize();
}

pub fn getDestroyed(self: *Self, globalThis: *JSGlobalObject) JSValue {
    _ = globalThis;
    return .jsBoolean(self.internals.getDestroyed());
}

pub fn close(self: *Self, globalThis: *JSGlobalObject, callFrame: *jsc.CallFrame) JSValue {
    self.internals.cancel(globalThis.bunVM());
    return callFrame.this();
}

pub fn get_onTimeout(_: *Self, thisValue: JSValue, _: *JSGlobalObject) JSValue {
    return Self.js.callbackGetCached(thisValue).?;
}

pub fn set_onTimeout(_: *Self, thisValue: JSValue, globalThis: *JSGlobalObject, value: JSValue) void {
    Self.js.callbackSetCached(thisValue, globalThis, value);
}

pub fn get_idleTimeout(_: *Self, thisValue: JSValue, _: *JSGlobalObject) JSValue {
    return Self.js.idleTimeoutGetCached(thisValue).?;
}

pub fn set_idleTimeout(_: *Self, thisValue: JSValue, globalThis: *JSGlobalObject, value: JSValue) void {
    Self.js.idleTimeoutSetCached(thisValue, globalThis, value);
}

pub fn get_repeat(_: *Self, thisValue: JSValue, _: *JSGlobalObject) JSValue {
    return Self.js.repeatGetCached(thisValue).?;
}

pub fn set_repeat(_: *Self, thisValue: JSValue, globalThis: *JSGlobalObject, value: JSValue) void {
    Self.js.repeatSetCached(thisValue, globalThis, value);
}

pub fn get_idleStart(_: *Self, thisValue: JSValue, _: *JSGlobalObject) JSValue {
    return Self.js.idleStartGetCached(thisValue).?;
}

pub fn set_idleStart(_: *Self, thisValue: JSValue, globalThis: *JSGlobalObject, value: JSValue) void {
    Self.js.idleStartSetCached(thisValue, globalThis, value);
}

pub fn dispose(self: *Self, globalThis: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    self.internals.cancel(globalThis.bunVM());
    return .js_undefined;
}

const Debugger = @import("../../Debugger.zig");
const bun = @import("bun");

const EventLoopTimer = bun.api.Timer.EventLoopTimer;
const ID = bun.api.Timer.ID;
const Kind = bun.api.Timer.Kind;
const TimerObjectInternals = bun.api.Timer.TimerObjectInternals;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
