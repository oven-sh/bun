done: bool,
/// value = not called yet. null = done already called, no-op.
ref: ?*describe2.BunTestFile.RefData,

pub fn callAsFunction(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    const this = DoneCallback.fromJS(callFrame.callee()) orelse return globalThis.throw("Expected callee to be DoneCallback", .{});

    if (this.done) {
        // in Bun 1.2.20, this is a no-op
        // in Jest, this is "Expected done to be called once, but it was called multiple times."
        // Vitest does not support done callbacks
        groupLog.log("no-op: done() called multiple times", .{});
        return .js_undefined;
    }
    this.done = true;

    const ref = this.ref orelse return .js_undefined;
    try ref.buntest.bunTestDoneCallback(globalThis, callFrame, ref.phase);
    ref.deinit();
    this.ref = null;
    return .js_undefined;
}

pub const js = jsc.Codegen.JSDoneCallback;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub fn finalize(
    this: *DoneCallback,
) callconv(.C) void {
    groupLog.begin(@src());
    defer groupLog.end();

    if (this.ref) |ref| ref.deinit();
    VirtualMachine.get().allocator.destroy(this);
}

pub fn create(globalThis: *JSGlobalObject) JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    var done_callback = globalThis.bunVM().allocator.create(DoneCallback) catch bun.outOfMemory();
    done_callback.* = .{ .ref = null, .done = false };

    const value = done_callback.toJS(globalThis);
    value.ensureStillAlive();
    return value;
}

const std = @import("std");
const test_command = @import("../../cli/test_command.zig");

const describe2 = jsc.Jest.describe2;
const BunTestFile = describe2.BunTestFile;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const groupLog = describe2.group;
const DoneCallback = describe2.DoneCallback;

const bun = @import("bun");
const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const CallFrame = jsc.CallFrame;
const VirtualMachine = jsc.VirtualMachine;
const JSValue = jsc.JSValue;

const Strong = jsc.Strong.Safe;
