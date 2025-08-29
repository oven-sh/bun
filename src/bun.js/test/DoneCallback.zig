/// value = not called yet. null = done already called, no-op.
ref: ?*describe2.BunTestFile.RefData,

const DoneCallbackTask = struct {
    ref: *describe2.BunTestFile.RefData,
    globalThis: *JSGlobalObject,
    value: Strong,

    pub fn call(this: *DoneCallbackTask) void {
        defer bun.destroy(this);
        defer this.ref.deinit();
        defer this.value.deinit();
        this.ref.buntest.bunTestDoneCallback(this.globalThis, this.value.get(), this.ref.phase) catch |e| {
            this.ref.buntest.onUncaughtException(this.globalThis, this.globalThis.takeError(e), false, this.ref.phase);
        };
    }
};

pub fn callAsFunction(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    const this = DoneCallback.fromJS(callFrame.callee()) orelse return globalThis.throw("Expected callee to be DoneCallback", .{});

    const ref = this.ref orelse {
        // in Bun 1.2.20, this is a no-op
        // in Jest, this is "Expected done to be called once, but it was called multiple times."
        // Vitest does not support done callbacks
        return .js_undefined;
    };

    const value = callFrame.argumentsAsArray(1)[0];

    // dupe the ref and enqueue a task to call the done callback.
    // this makes it so if you do something else after calling done(), the next test doesn't start running until the next tick.
    const ref_clone = ref.buntest.ref(ref.phase);
    errdefer ref_clone.deinit();
    const value_strong: Strong = .init(bun.default_allocator, value);
    errdefer value_strong.deinit();
    const done_callback_test = bun.new(DoneCallbackTask, .{ .ref = ref_clone, .value = value_strong, .globalThis = globalThis });
    errdefer bun.destroy(done_callback_test);
    const task = jsc.ManagedTask.New(DoneCallbackTask, DoneCallbackTask.call).init(done_callback_test);
    jsc.VirtualMachine.get().enqueueTask(task);

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

pub fn create(globalThis: *JSGlobalObject, buntest: *describe2.BunTestFile, ref_data: describe2.BunTestFile.RefDataValue) JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    var done_callback = globalThis.bunVM().allocator.create(DoneCallback) catch bun.outOfMemory();
    done_callback.* = .{ .ref = buntest.ref(ref_data) };

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
