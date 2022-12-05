const std = @import("std");
const bun = @import("bun");
const Api = @import("../../api/schema.zig").Api;
const RequestContext = @import("../../http.zig").RequestContext;
const MimeType = @import("../../http.zig").MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = @import("bun").HTTP;
const NetworkThread = HTTPClient.NetworkThread;
const Environment = @import("../../env.zig");

const JSC = @import("bun").JSC;
const js = JSC.C;

const logger = @import("bun").logger;
const Method = @import("../../http/method.zig").Method;

const ObjectPool = @import("../../pool.zig").ObjectPool;

const Output = @import("bun").Output;
const MutableString = @import("bun").MutableString;
const strings = @import("bun").strings;
const string = @import("bun").string;
const default_allocator = @import("bun").default_allocator;
const FeatureFlags = @import("bun").FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const NewClass = @import("../base.zig").NewClass;
const d = @import("../base.zig").d;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;

const ZigString = JSC.ZigString;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;
const JSObject = JSC.JSObject;

const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const Task = @import("../javascript.zig").Task;

const Fs = @import("../../fs.zig");
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;

fn notImplementedFn(_: *anyopaque, ctx: js.JSContextRef, _: js.JSObjectRef, _: js.JSObjectRef, _: []const js.JSValueRef, exception: js.ExceptionRef) js.JSValueRef {
    JSError(getAllocator(ctx), "Not implemented yet!", .{}, ctx, exception);
    return null;
}

fn notImplementedProp(
    _: anytype,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    JSError(getAllocator(ctx), "Property not implemented yet!", .{}, ctx, exception);
    return null;
}

const ArrayIdentityContext = @import("../../identity_context.zig").ArrayIdentityContext;
pub const TestRunner = struct {
    tests: TestRunner.Test.List = .{},
    log: *logger.Log,
    files: File.List = .{},
    index: File.Map = File.Map{},
    only: bool = false,
    last_file: u64 = 0,

    timeout_seconds: f64 = 5.0,

    allocator: std.mem.Allocator,
    callback: *Callback = undefined,

    drainer: JSC.AnyTask = undefined,
    queue: std.fifo.LinearFifo(*TestRunnerTask, .{ .Dynamic = {} }) = std.fifo.LinearFifo(*TestRunnerTask, .{ .Dynamic = {} }).init(default_allocator),

    has_pending_tests: bool = false,
    pending_test: ?*TestRunnerTask = null,
    pub const Drainer = JSC.AnyTask.New(TestRunner, drain);

    pub fn enqueue(this: *TestRunner, task: *TestRunnerTask) void {
        this.queue.writeItem(task) catch unreachable;
    }

    pub fn runNextTest(this: *TestRunner) void {
        this.has_pending_tests = false;
        this.pending_test = null;

        // disable idling
        JSC.VirtualMachine.vm.uws_event_loop.?.wakeup();
    }

    pub fn drain(this: *TestRunner) void {
        if (this.pending_test != null) return;

        if (this.queue.readItem()) |task| {
            this.pending_test = task;
            this.has_pending_tests = true;
            if (!task.run()) {
                this.has_pending_tests = false;
                this.pending_test = null;
            }
        }
    }

    pub fn setOnly(this: *TestRunner) void {
        if (this.only) {
            return;
        }

        this.only = true;

        var list = this.queue.readableSlice(0);
        for (list) |task| {
            task.deinit();
        }
        this.queue.count = 0;
        this.queue.head = 0;

        this.tests.shrinkRetainingCapacity(0);
        this.callback.onUpdateCount(this.callback, 0, 0);
    }

    pub const Callback = struct {
        pub const OnUpdateCount = fn (this: *Callback, delta: u32, total: u32) void;
        pub const OnTestStart = fn (this: *Callback, test_id: Test.ID) void;
        pub const OnTestUpdate = fn (this: *Callback, test_id: Test.ID, file: string, label: string, expectations: u32, parent: ?*DescribeScope) void;
        onUpdateCount: OnUpdateCount,
        onTestStart: OnTestStart,
        onTestPass: OnTestUpdate,
        onTestFail: OnTestUpdate,
    };

    pub fn reportPass(this: *TestRunner, test_id: Test.ID, file: string, label: string, expectations: u32, parent: ?*DescribeScope) void {
        this.tests.items(.status)[test_id] = .pass;
        this.callback.onTestPass(this.callback, test_id, file, label, expectations, parent);
    }
    pub fn reportFailure(this: *TestRunner, test_id: Test.ID, file: string, label: string, expectations: u32, parent: ?*DescribeScope) void {
        this.tests.items(.status)[test_id] = .fail;
        this.callback.onTestFail(this.callback, test_id, file, label, expectations, parent);
    }

    pub fn addTestCount(this: *TestRunner, count: u32) u32 {
        this.tests.ensureUnusedCapacity(this.allocator, count) catch unreachable;
        const start = @truncate(Test.ID, this.tests.len);
        this.tests.len += count;
        var statuses = this.tests.items(.status)[start..][0..count];
        std.mem.set(Test.Status, statuses, Test.Status.pending);
        this.callback.onUpdateCount(this.callback, count, count + start);
        return start;
    }

    pub fn getOrPutFile(this: *TestRunner, file_path: string) *DescribeScope {
        var entry = this.index.getOrPut(this.allocator, @truncate(u32, std.hash.Wyhash.hash(0, file_path))) catch unreachable;
        if (entry.found_existing) {
            return this.files.items(.module_scope)[entry.value_ptr.*];
        }
        var scope = this.allocator.create(DescribeScope) catch unreachable;
        const file_id = @truncate(File.ID, this.files.len);
        scope.* = DescribeScope{
            .file_id = file_id,
            .test_id_start = @truncate(Test.ID, this.tests.len),
        };
        this.files.append(this.allocator, .{ .module_scope = scope, .source = logger.Source.initEmptyFile(file_path) }) catch unreachable;
        entry.value_ptr.* = file_id;
        return scope;
    }

    pub const File = struct {
        source: logger.Source = logger.Source.initEmptyFile(""),
        log: logger.Log = logger.Log.initComptime(default_allocator),
        module_scope: *DescribeScope = undefined,

        pub const List = std.MultiArrayList(File);
        pub const ID = u32;
        pub const Map = std.ArrayHashMapUnmanaged(u32, u32, ArrayIdentityContext, false);
    };

    pub const Test = struct {
        status: Status = Status.pending,

        pub const ID = u32;
        pub const List = std.MultiArrayList(Test);

        pub const Status = enum(u3) {
            pending,
            pass,
            fail,
        };
    };
};

pub const Jest = struct {
    pub var runner: ?*TestRunner = null;

    pub fn call(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        var runner_ = runner orelse {
            JSError(getAllocator(ctx), "Run bun wiptest to run a test", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        };

        if (arguments.len < 1 or !js.JSValueIsString(ctx, arguments[0])) {
            JSError(getAllocator(ctx), "Bun.jest() expects a string filename", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }
        var str = js.JSValueToStringCopy(ctx, arguments[0], exception);
        defer js.JSStringRelease(str);
        var ptr = js.JSStringGetCharacters8Ptr(str);
        const len = js.JSStringGetLength(str);
        if (len == 0 or ptr[0] != '/') {
            JSError(getAllocator(ctx), "Bun.jest() expects an absolute file path", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }
        var str_value = ptr[0..len];
        var filepath = Fs.FileSystem.instance.filename_store.append([]const u8, str_value) catch unreachable;

        var scope = runner_.getOrPutFile(filepath);
        DescribeScope.active = scope;
        DescribeScope.module = scope;
        return DescribeScope.Class.make(ctx, scope);
    }
};

/// https://jestjs.io/docs/expect
// To support async tests, we need to track the test ID
pub const Expect = struct {
    test_id: TestRunner.Test.ID,
    scope: *DescribeScope,
    op: Op.Set = Op.Set.init(.{}),

    pub usingnamespace JSC.Codegen.JSExpect;

    pub const Op = enum(u3) {
        resolves,
        rejects,
        not,
        pub const Set = std.EnumSet(Op);
    };

    pub fn finalize(
        this: *Expect,
    ) callconv(.C) void {
        VirtualMachine.vm.allocator.destroy(this);
    }

    pub fn call(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments_ = callframe.arguments(1);
        if (arguments_.len < 1) {
            globalObject.throw("expect() requires one argument", .{});
            return .zero;
        }
        const arguments = arguments_.ptr[0..arguments_.len];

        var expect = globalObject.bunVM().allocator.create(Expect) catch unreachable;
        const value = arguments[0];

        if (Jest.runner.?.pending_test == null) {
            globalObject.throw("expect() must be called inside a test", .{});
            return .zero;
        }

        expect.* = .{
            .scope = Jest.runner.?.pending_test.?.describe,
            .test_id = Jest.runner.?.pending_test.?.test_id,
        };
        const expect_js_value = expect.toJS(globalObject);
        expect_js_value.ensureStillAlive();
        JSC.Jest.Expect.capturedValueSetCached(expect_js_value, globalObject, value);
        expect_js_value.ensureStillAlive();
        expect.postMatch(globalObject);
        return expect_js_value;
    }

    pub fn constructor(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*Expect {
        _ = callframe.arguments(1);
        globalObject.throw("expect() cannot be called with new", .{});
        return null;
    }

    /// Object.is()
    pub fn toBe(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBe() takes 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBe() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;
        const left = arguments[0];
        left.ensureStillAlive();
        const right = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        right.ensureStillAlive();

        const not = this.op.contains(.not);
        var pass = left.isSameValue(right, globalObject);
        if (comptime Environment.allow_assert) {
            std.debug.assert(pass == JSC.C.JSValueIsStrictEqual(globalObject, left.asObjectRef(), right.asObjectRef()));
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var lhs_fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        var rhs_fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (comptime Environment.allow_assert) {
            Output.prettyErrorln("\nJSType: {s}\nJSType: {s}\n\n", .{ @tagName(left.jsType()), @tagName(right.jsType()) });
        }

        if (not) {
            globalObject.throw("\n\tExpected: not {any}\n\tReceived: {any}", .{ left.toFmt(globalObject, &lhs_fmt), right.toFmt(globalObject, &rhs_fmt) });
        } else {
            globalObject.throw("\n\tExpected: {any}\n\tReceived: {any}", .{ left.toFmt(globalObject, &lhs_fmt), right.toFmt(globalObject, &rhs_fmt) });
        }
        return .zero;
    }

    pub fn toHaveLength(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toHaveLength() takes 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toHaveLength() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected: JSValue = arguments[0];
        const value: JSValue = JSC.Jest.Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (!value.isObject() and !value.isString()) {
            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
            globalObject.throw("Received value does not have a length property: {any}", .{value.toFmt(globalObject, &fmt)});
            return .zero;
        }

        if (!expected.isNumber()) {
            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
            globalObject.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalObject, &fmt)});
            return .zero;
        }

        const expected_length: f64 = expected.asNumber();
        if (@round(expected_length) != expected_length or std.math.isInf(expected_length) or std.math.isNan(expected_length) or expected_length < 0) {
            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
            globalObject.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalObject, &fmt)});
            return .zero;
        }

        const not = this.op.contains(.not);
        var pass = false;

        var actual_length: f64 = undefined;
        if (value.isString()) {
            actual_length = @intToFloat(f64, value.asString().length());
            if (actual_length == expected_length) pass = true;
        } else {
            const length_value: JSValue = value.getIfPropertyExistsImpl(globalObject, "length", "length".len);

            if (length_value.isEmpty()) {
                var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
                globalObject.throw("Received value does not have a length property: {any}", .{value.toFmt(globalObject, &fmt)});
                return .zero;
            } else if (!length_value.isNumber()) {
                var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
                globalObject.throw("Received value has non-number length property: {any}", .{length_value.toFmt(globalObject, &fmt)});
                return .zero;
            }

            actual_length = length_value.asNumber();
            if (@round(actual_length) == actual_length) {
                if (actual_length == expected_length) pass = true;
            }
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        if (not) {
            globalObject.throw("\n\tExpected: not {d}\n\tReceived: {d}", .{ expected_length, actual_length });
        } else {
            globalObject.throw("\n\tExpected: {d}\n\tReceived: {d}", .{ expected_length, actual_length });
        }
        return .zero;
    }

    pub fn toContain(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContain() takes 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toContain() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = JSC.Jest.Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        const not = this.op.contains(.not);
        var pass = false;

        if (value.isIterable(globalObject)) {
            var itr = value.arrayIterator(globalObject);
            while (itr.next()) |item| {
                if (item.isSameValue(expected, globalObject)) {
                    pass = true;
                    break;
                }
            }
        } else if (value.isString() and expected.isString()) {
            const value_string = value.toString(globalObject).toSlice(globalObject, default_allocator).slice();
            const expected_string = expected.toString(globalObject).toSlice(globalObject, default_allocator).slice();
            if (strings.contains(value_string, expected_string)) {
                pass = true;
            }
        } else {
            globalObject.throw("Received value must be an array type, or both received and expected values must be strings.", .{});
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected to not contain \"{any}\"", .{expected.toFmt(globalObject, &fmt)});
        } else {
            globalObject.throw("Expected to contain \"{any}\"", .{expected.toFmt(globalObject, &fmt)});
        }
        return .zero;
    }

    pub fn toBeTruthy(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeTruthy() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = false;

        const truthy = value.toBooleanSlow(globalObject);
        if (truthy) pass = true;

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected \"{any}\" to be not truthy.", .{value.toFmt(globalObject, &fmt)});
        } else {
            globalObject.throw("Expected \"{any}\" to be truthy.", .{value.toFmt(globalObject, &fmt)});
        }
        return .zero;
    }

    pub fn toBeUndefined(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Interal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = false;
        if (value.isUndefined()) pass = true;

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected \"{any}\" to be not undefined.", .{value.toFmt(globalObject, &fmt)});
        } else {
            globalObject.throw("Expected \"{any}\" to be undefined.", .{value.toFmt(globalObject, &fmt)});
        }
        return .zero;
    }

    pub fn toBeNaN(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Interal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = false;
        if (value.isNumber()) {
            const number = value.asNumber();
            if (number != number) pass = true;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected \"{any}\" to be not NaN.", .{value.toFmt(globalObject, &fmt)});
        } else {
            globalObject.throw("Expected \"{any}\" to be NaN.", .{value.toFmt(globalObject, &fmt)});
        }
        return .zero;
    }

    pub fn toBeNull(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Interal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = value.isNull();
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected \"{any}\" to be not null.", .{value.toFmt(globalObject, &fmt)});
        } else {
            globalObject.throw("Expected \"{any}\" to be null.", .{value.toFmt(globalObject, &fmt)});
        }
        return .zero;
    }

    pub fn toBeDefined(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Interal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = !value.isUndefined();
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected \"{any}\" to be not defined.", .{value.toFmt(globalObject, &fmt)});
        } else {
            globalObject.throw("Expected \"{any}\" to be defined.", .{value.toFmt(globalObject, &fmt)});
        }
        return .zero;
    }

    pub fn toBeFalsy(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();

        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        const not = this.op.contains(.not);
        var pass = false;

        const truthy = value.toBooleanSlow(globalObject);
        if (!truthy) pass = true;

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected \"{any}\" to be not falsy.", .{value.toFmt(globalObject, &fmt)});
        } else {
            globalObject.throw("Expected \"{any}\" to be falsy.", .{value.toFmt(globalObject, &fmt)});
        }
        return .zero;
    }

    pub fn toEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toEqual() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toEqual() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected = arguments[0];
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        const not = this.op.contains(.not);
        var pass = value.deepEquals(expected, globalObject);

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected values to not be equal:\n\tExpected: {any}\n\tReceived: {any}", .{ expected.toFmt(globalObject, &fmt), value.toFmt(globalObject, &fmt) });
        } else {
            globalObject.throw("Expected values to be equal:\n\tExpected: {any}\n\tReceived: {any}", .{ expected.toFmt(globalObject, &fmt), value.toFmt(globalObject, &fmt) });
        }
        return .zero;
    }

    pub fn toStrictEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toStrictEqual() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toStrictEqual() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected = arguments[0];
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        const not = this.op.contains(.not);
        var pass = value.strictDeepEquals(expected, globalObject);

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected values to not be strictly equal:\n\tExpected: {any}\n\tReceived: {any}", .{ expected.toFmt(globalObject, &fmt), value.toFmt(globalObject, &fmt) });
        } else {
            globalObject.throw("Expected values to be strictly equal:\n\tExpected: {any}\n\tReceived: {any}", .{ expected.toFmt(globalObject, &fmt), value.toFmt(globalObject, &fmt) });
        }
        return .zero;
    }

    pub fn toHaveProperty(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(2);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toHaveProperty() requires at least 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toHaveProperty must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected_property_path = arguments[0];
        expected_property_path.ensureStillAlive();
        const expected_value: ?JSValue = if (arguments.len > 1) arguments[1] else null;
        if (expected_value) |ev| ev.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (!expected_property_path.isString() and !expected_property_path.isIterable(globalObject)) {
            globalObject.throw("Expected path must be a string or an array", .{});
            return .zero;
        }

        const not = this.op.contains(.not);
        var path_string = ZigString.Empty;
        expected_property_path.toZigString(&path_string, globalObject);

        const expected_property = value.getIfPropertyExistsFromPath(globalObject, expected_property_path);

        var pass = !expected_property.isEmpty();

        if (pass and expected_value != null) {
            pass = expected_property.deepEquals(expected_value.?, globalObject);
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            if (!expected_property.isEmpty() and expected_value != null) {
                globalObject.throw("Expected property \"{any}\" to not be equal to: {any}", .{ expected_property.toFmt(globalObject, &fmt), expected_value.?.toFmt(globalObject, &fmt) });
            } else {
                globalObject.throw("Expected \"{any}\" to not have property: {any}", .{ value.toFmt(globalObject, &fmt), expected_property_path.toFmt(globalObject, &fmt) });
            }
        } else {
            if (!expected_property.isEmpty() and expected_value != null) {
                globalObject.throw("Expected property \"{any}\" to be equal to: {any}", .{ expected_property.toFmt(globalObject, &fmt), expected_value.?.toFmt(globalObject, &fmt) });
            } else {
                globalObject.throw("Expected \"{any}\" to have property: {any}", .{ value.toFmt(globalObject, &fmt), expected_property_path.toFmt(globalObject, &fmt) });
            }
        }

        return .zero;
    }

    pub fn toBeGreaterThan(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeGreaterThan() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeGreaterThan() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: thie expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.op.contains(.not);
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() > other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .greater_than => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .less_than => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected {any} to not be greater than {any}", .{ value.toFmt(globalObject, &fmt), other_value.toFmt(globalObject, &fmt) });
        } else {
            globalObject.throw("Expected {any} to be greater than {any}", .{ value.toFmt(globalObject, &fmt), other_value.toFmt(globalObject, &fmt) });
        }
        return .zero;
    }

    pub fn toBeGreaterThanOrEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeGreaterThanOrEqual() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeGreaterThanOrEqual() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: thie expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.op.contains(.not);
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() >= other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .greater_than, .equal => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .less_than, .equal => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected {any} to not be greater than or equal to {any}", .{ value.toFmt(globalObject, &fmt), other_value.toFmt(globalObject, &fmt) });
        } else {
            globalObject.throw("Expected {any} to be greater than or equal to {any}", .{ value.toFmt(globalObject, &fmt), other_value.toFmt(globalObject, &fmt) });
        }
        return .zero;
    }

    pub fn toBeLessThan(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeLessThan() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeLessThan() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: thie expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.op.contains(.not);
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() < other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .less_than => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .greater_than => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected {any} to not be less than {any}", .{ value.toFmt(globalObject, &fmt), other_value.toFmt(globalObject, &fmt) });
        } else {
            globalObject.throw("Expected {any} to be less than {any}", .{ value.toFmt(globalObject, &fmt), other_value.toFmt(globalObject, &fmt) });
        }
        return .zero;
    }

    pub fn toBeLessThanOrEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeLessThanOrEqual() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeLessThanOrEqual() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: thie expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.op.contains(.not);
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() <= other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .less_than, .equal => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .greater_than, .equal => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected {any} to not be less than or equal to {any}", .{ value.toFmt(globalObject, &fmt), other_value.toFmt(globalObject, &fmt) });
        } else {
            globalObject.throw("Expected {any} to be less than or equal to {any}", .{ value.toFmt(globalObject, &fmt), other_value.toFmt(globalObject, &fmt) });
        }
        return .zero;
    }

    pub const toHaveBeenCalledTimes = notImplementedJSCFn;
    pub const toHaveBeenCalledWith = notImplementedJSCFn;
    pub const toHaveBeenLastCalledWith = notImplementedJSCFn;
    pub const toHaveBeenNthCalledWith = notImplementedJSCFn;
    pub const toHaveReturnedTimes = notImplementedJSCFn;
    pub const toHaveReturnedWith = notImplementedJSCFn;
    pub const toHaveLastReturnedWith = notImplementedJSCFn;
    pub const toHaveNthReturnedWith = notImplementedJSCFn;
    pub const toBeCloseTo = notImplementedJSCFn;
    pub const toBeInstanceOf = notImplementedJSCFn;
    pub const toContainEqual = notImplementedJSCFn;
    pub const toMatch = notImplementedJSCFn;
    pub const toMatchObject = notImplementedJSCFn;
    pub const toMatchSnapshot = notImplementedJSCFn;
    pub const toMatchInlineSnapshot = notImplementedJSCFn;
    pub const toThrow = notImplementedJSCFn;
    pub const toThrowErrorMatchingSnapshot = notImplementedJSCFn;
    pub const toThrowErrorMatchingInlineSnapshot = notImplementedJSCFn;

    pub const getStaticNot = notImplementedStaticProp;
    pub const getStaticResolves = notImplementedStaticProp;
    pub const getStaticRejects = notImplementedStaticProp;

    pub fn getNot(this: *Expect, thisValue: JSValue, globalObject: *JSGlobalObject) callconv(.C) JSValue {
        _ = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };

        this.op.toggle(.not);

        return thisValue;
    }

    pub const getResolves = notImplementedJSCProp;
    pub const getRejects = notImplementedJSCProp;

    pub const extend = notImplementedStaticFn;
    pub const anything = notImplementedStaticFn;
    pub const any = notImplementedStaticFn;
    pub const arrayContaining = notImplementedStaticFn;
    pub const assertions = notImplementedStaticFn;
    pub const hasAssertions = notImplementedStaticFn;
    pub const objectContaining = notImplementedStaticFn;
    pub const stringContaining = notImplementedStaticFn;
    pub const stringMatching = notImplementedStaticFn;
    pub const addSnapshotSerializer = notImplementedStaticFn;

    pub fn notImplementedJSCFn(_: *Expect, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedStaticFn(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedJSCProp(_: *Expect, _: JSC.JSValue, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedStaticProp(globalObject: *JSC.JSGlobalObject, _: JSC.JSValue, _: JSC.JSValue) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn postMatch(_: *Expect, globalObject: *JSC.JSGlobalObject) void {
        var vm = globalObject.bunVM();
        vm.autoGarbageCollect();
    }
};

pub const TestScope = struct {
    label: string = "",
    parent: *DescribeScope,
    callback: js.JSValueRef,
    id: TestRunner.Test.ID = 0,
    promise: ?*JSInternalPromise = null,
    ran: bool = false,
    task: ?*TestRunnerTask = null,

    pub const Class = NewClass(void, .{ .name = "test" }, .{ .call = call, .only = only }, .{});

    pub const Counter = struct {
        expected: u32 = 0,
        actual: u32 = 0,
    };

    pub fn only(
        // the DescribeScope here is the top of the file, not the real one
        _: void,
        ctx: js.JSContextRef,
        this: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        return callMaybeOnly(this, ctx, arguments, exception, true);
    }

    pub fn call(
        // the DescribeScope here is the top of the file, not the real one
        _: void,
        ctx: js.JSContextRef,
        this: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        return callMaybeOnly(this, ctx, arguments, exception, false);
    }

    fn callMaybeOnly(
        this: js.JSObjectRef,
        ctx: js.JSContextRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
        is_only: bool,
    ) js.JSObjectRef {
        var args = bun.cast([]const JSC.JSValue, arguments[0..@minimum(arguments.len, 2)]);
        var label: string = "";
        if (args.len == 0) {
            return this;
        }

        var label_value = args[0];
        var function_value = if (args.len > 1) args[1] else JSC.JSValue.zero;

        if (label_value.isEmptyOrUndefinedOrNull() or !label_value.isString()) {
            function_value = label_value;
            label_value = .zero;
        }

        if (label_value != .zero) {
            const allocator = getAllocator(ctx);
            label = (label_value.toSlice(ctx, allocator).cloneIfNeeded(allocator) catch unreachable).slice();
        }

        const function = function_value;
        if (function.isEmptyOrUndefinedOrNull() or !function.isCell() or !function.isCallable(ctx.vm())) {
            JSError(getAllocator(ctx), "test() expects a function", .{}, ctx, exception);
            return this;
        }

        if (is_only) {
            Jest.runner.?.setOnly();
        }

        if (!is_only and Jest.runner.?.only)
            return this;

        js.JSValueProtect(ctx, function.asObjectRef());

        DescribeScope.active.tests.append(getAllocator(ctx), TestScope{
            .label = label,
            .callback = function.asObjectRef(),
            .parent = DescribeScope.active,
        }) catch unreachable;

        return this;
    }

    pub fn onReject(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(2);
        const err = arguments.ptr[0];
        globalThis.bunVM().runErrorHandler(err, null);
        var task: *TestRunnerTask = arguments.ptr[1].asPromisePtr(TestRunnerTask);
        task.handleResult(.{ .fail = active_test_expectation_counter.actual }, .promise);
        globalThis.bunVM().autoGarbageCollect();
        return JSValue.jsUndefined();
    }

    pub fn onResolve(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(2);
        var task: *TestRunnerTask = arguments.ptr[1].asPromisePtr(TestRunnerTask);
        task.handleResult(.{ .pass = active_test_expectation_counter.actual }, .promise);
        globalThis.bunVM().autoGarbageCollect();
        return JSValue.jsUndefined();
    }

    pub fn onDone(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const function = callframe.callee();
        const args = callframe.arguments(1);
        defer globalThis.bunVM().autoGarbageCollect();

        if (JSC.getFunctionData(function)) |data| {
            var task = bun.cast(*TestRunnerTask, data);
            JSC.setFunctionData(function, null);
            if (args.len > 0) {
                const err = args.ptr[0];
                globalThis.bunVM().runErrorHandlerWithDedupe(err, null);
                task.handleResult(.{ .fail = active_test_expectation_counter.actual }, .callback);
            } else {
                task.handleResult(.{ .pass = active_test_expectation_counter.actual }, .callback);
            }
        }

        return JSValue.jsUndefined();
    }

    pub fn run(
        this: *TestScope,
        task: *TestRunnerTask,
    ) Result {
        if (comptime is_bindgen) return undefined;
        var vm = VirtualMachine.vm;
        var callback = this.callback;
        defer {
            js.JSValueUnprotect(vm.global, callback);
            this.callback = null;
            vm.autoGarbageCollect();
        }
        JSC.markBinding(@src());

        const callback_length = JSValue.fromRef(callback).getLengthOfArray(vm.global);

        var initial_value = JSValue.zero;
        if (callback_length > 0) {
            const callback_func = JSC.NewFunctionWithData(
                vm.global,
                ZigString.static("done"),
                0,
                TestScope.onDone,
                false,
                task,
            );
            task.done_callback_state = .pending;
            initial_value = JSValue.fromRef(callback.?).call(vm.global, &.{callback_func});
        } else {
            initial_value = js.JSObjectCallAsFunctionReturnValue(vm.global, callback, null, 0, null);
        }

        if (!initial_value.isEmptyOrUndefinedOrNull()) {
            if (initial_value.isAnyError(vm.global)) {
                vm.runErrorHandler(initial_value, null);
                return .{ .fail = active_test_expectation_counter.actual };
            }

            if (initial_value.jsType() == .JSPromise) {
                if (this.promise != null) {
                    return .{ .pending = .{} };
                }

                var promise: *JSC.JSPromise = initial_value.asPromise().?;
                this.task = task;

                switch (promise.status(vm.global.vm())) {
                    .Rejected => {
                        vm.runErrorHandler(promise.result(vm.global.vm()), null);
                        return .{ .fail = active_test_expectation_counter.actual };
                    },
                    .Pending => {
                        task.promise_state = .pending;
                        _ = promise.asValue(vm.global).then(vm.global, task, onResolve, onReject);
                        return .{ .pending = {} };
                    },

                    else => {
                        _ = promise.result(vm.global.vm());
                    },
                }
            }
        }

        if (callback_length > 0) {
            return .{ .pending = {} };
        }

        this.callback = null;

        if (active_test_expectation_counter.expected > 0 and active_test_expectation_counter.expected < active_test_expectation_counter.actual) {
            Output.prettyErrorln("Test fail: {d} / {d} expectations\n (make this better!)", .{
                active_test_expectation_counter.actual,
                active_test_expectation_counter.expected,
            });
            return .{ .fail = active_test_expectation_counter.actual };
        }

        return .{ .pass = active_test_expectation_counter.actual };
    }

    pub const name = "TestScope";
    pub const shim = JSC.Shimmer("Bun", name, @This());
    pub const Export = shim.exportFunctions(.{
        .onResolve = onResolve,
        .onReject = onReject,
    });
    comptime {
        if (!JSC.is_bindgen) {
            @export(onResolve, .{
                .name = Export[0].symbol_name,
            });
            @export(onReject, .{
                .name = Export[1].symbol_name,
            });
        }
    }
};

pub const DescribeScope = struct {
    label: string = "",
    parent: ?*DescribeScope = null,
    beforeAll: std.ArrayListUnmanaged(JSC.JSValue) = .{},
    beforeEach: std.ArrayListUnmanaged(JSC.JSValue) = .{},
    afterEach: std.ArrayListUnmanaged(JSC.JSValue) = .{},
    afterAll: std.ArrayListUnmanaged(JSC.JSValue) = .{},
    test_id_start: TestRunner.Test.ID = 0,
    test_id_len: TestRunner.Test.ID = 0,
    tests: std.ArrayListUnmanaged(TestScope) = .{},
    pending_tests: std.DynamicBitSetUnmanaged = .{},
    file_id: TestRunner.File.ID,
    current_test_id: TestRunner.Test.ID = 0,
    value: JSValue = .zero,

    pub fn push(new: *DescribeScope) void {
        if (comptime is_bindgen) return undefined;
        if (new == DescribeScope.active) return;

        new.parent = DescribeScope.active;
        DescribeScope.active = new;
    }

    pub fn pop(this: *DescribeScope) void {
        if (comptime is_bindgen) return undefined;
        if (DescribeScope.active == this)
            DescribeScope.active = this.parent orelse DescribeScope.active;
    }

    pub const LifecycleHook = enum {
        beforeAll,
        beforeEach,
        afterEach,
        afterAll,
    };

    pub const TestEntry = struct {
        label: string,
        callback: js.JSValueRef,

        pub const List = std.MultiArrayList(TestEntry);
    };

    pub threadlocal var active: *DescribeScope = undefined;
    pub threadlocal var module: *DescribeScope = undefined;

    const CallbackFn = fn (
        this: *DescribeScope,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef;
    fn createCallback(comptime hook: LifecycleHook) CallbackFn {
        return struct {
            const this_hook = hook;
            pub fn run(
                _: *DescribeScope,
                ctx: js.JSContextRef,
                _: js.JSObjectRef,
                _: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                if (arguments.len == 0 or !JSC.JSValue.c(arguments[0]).isObject() or !JSC.JSValue.c(arguments[0]).isCallable(ctx.vm())) {
                    JSC.throwInvalidArguments("Expected callback", .{}, ctx, exception);
                    return null;
                }

                JSC.JSValue.c(arguments[0]).protect();
                const name = comptime @as(string, @tagName(this_hook));
                @field(DescribeScope.active, name).append(getAllocator(ctx), JSC.JSValue.c(arguments[0])) catch unreachable;
                return JSC.JSValue.jsBoolean(true).asObjectRef();
            }
        }.run;
    }

    pub const Class = NewClass(
        DescribeScope,
        .{
            .name = "describe",
            .read_only = true,
        },
        .{
            .call = describe,
            .afterAll = .{ .rfn = createCallback(.afterAll), .name = "afterAll" },
            .afterEach = .{ .rfn = createCallback(.afterEach), .name = "afterEach" },
            .beforeAll = .{ .rfn = createCallback(.beforeAll), .name = "beforeAll" },
            .beforeEach = .{ .rfn = createCallback(.beforeEach), .name = "beforeEach" },
        },
        .{
            .expect = .{ .get = createExpect, .name = "expect" },
            // kind of a mindfuck but
            // describe("foo", () => {}).describe("bar") will wrok
            .describe = .{ .get = createDescribe, .name = "describe" },
            .it = .{ .get = createTest, .name = "it" },
            .@"test" = .{ .get = createTest, .name = "test" },
        },
    );

    pub fn execCallback(this: *DescribeScope, ctx: js.JSContextRef, comptime hook: LifecycleHook) JSValue {
        const name = comptime @as(string, @tagName(hook));
        var hooks: []JSC.JSValue = @field(this, name).items;
        for (hooks) |cb, i| {
            if (cb.isEmpty()) continue;

            const err = cb.call(ctx, &.{});
            if (err.isAnyError(ctx)) {
                return err;
            }

            if (comptime hook == .beforeAll or hook == .afterAll) {
                hooks[i] = JSC.JSValue.zero;
            }
        }

        return JSValue.zero;
    }
    pub fn runCallback(this: *DescribeScope, ctx: js.JSContextRef, comptime hook: LifecycleHook) JSValue {
        var parent = this.parent;
        while (parent) |scope| {
            const ret = scope.execCallback(ctx, hook);
            if (!ret.isEmpty()) {
                return ret;
            }
            parent = scope.parent;
        }

        return this.execCallback(ctx, hook);
    }

    pub fn describe(
        this: *DescribeScope,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        if (arguments.len == 0 or arguments.len > 2) {
            JSError(getAllocator(ctx), "describe() requires 1-2 arguments", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }

        var label = ZigString.init("");
        var args = arguments;
        const allocator = getAllocator(ctx);

        if (js.JSValueIsString(ctx, arguments[0])) {
            JSC.JSValue.fromRef(arguments[0]).toZigString(&label, ctx.ptr());
            args = args[1..];
        }

        if (args.len == 0 or !js.JSObjectIsFunction(ctx, args[0])) {
            JSError(allocator, "describe() requires a callback function", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }

        var callback = args[0];

        var scope = allocator.create(DescribeScope) catch unreachable;
        scope.* = .{
            .label = (label.toSlice(allocator).cloneIfNeeded(allocator) catch unreachable).slice(),
            .parent = this,
            .file_id = this.file_id,
        };
        var new_this = DescribeScope.Class.make(ctx, scope);

        return scope.run(new_this, ctx, callback, exception);
    }

    pub fn run(this: *DescribeScope, thisObject: js.JSObjectRef, ctx: js.JSContextRef, callback: js.JSObjectRef, exception: js.ExceptionRef) js.JSObjectRef {
        if (comptime is_bindgen) return undefined;
        js.JSValueProtect(ctx, callback);
        defer js.JSValueUnprotect(ctx, callback);
        var original_active = active;
        defer active = original_active;
        if (this != module)
            this.parent = this.parent orelse active;
        active = this;

        {
            JSC.markBinding(@src());
            var result = js.JSObjectCallAsFunctionReturnValue(ctx, callback, thisObject, 0, null);

            if (result.asPromise() != null or result.asInternalPromise() != null) {
                var vm = JSC.VirtualMachine.vm;

                var promise = JSInternalPromise.resolvedPromise(ctx.ptr(), result);
                vm.waitForPromise(promise);

                switch (promise.status(ctx.ptr().vm())) {
                    JSPromise.Status.Fulfilled => {},
                    else => {
                        exception.* = promise.result(ctx.ptr().vm()).asObjectRef();
                        return null;
                    },
                }
            } else if (result.isAnyError(ctx)) {
                exception.* = result.asObjectRef();
                return null;
            }
        }

        this.runTests(thisObject.?.value(), ctx);
        return js.JSValueMakeUndefined(ctx);
    }

    pub fn runTests(this: *DescribeScope, this_object: JSC.JSValue, ctx: js.JSContextRef) void {
        // Step 1. Initialize the test block

        const file = this.file_id;
        const allocator = getAllocator(ctx);
        var tests: []TestScope = this.tests.items;
        const end = @truncate(TestRunner.Test.ID, tests.len);
        this.pending_tests = std.DynamicBitSetUnmanaged.initFull(allocator, end) catch unreachable;

        if (end == 0) return;

        // Step 2. Update the runner with the count of how many tests we have for this block
        this.test_id_start = Jest.runner.?.addTestCount(end);

        const source: logger.Source = Jest.runner.?.files.items(.source)[file];

        var i: TestRunner.Test.ID = 0;

        const beforeAll = this.runCallback(ctx, .beforeAll);
        if (!beforeAll.isEmpty()) {
            while (i < end) {
                Jest.runner.?.reportFailure(i + this.test_id_start, source.path.text, tests[i].label, 0, this);
                i += 1;
            }
            this.tests.clearAndFree(allocator);
            this.pending_tests.deinit(allocator);
            return;
        }

        while (i < end) : (i += 1) {
            var runner = allocator.create(TestRunnerTask) catch unreachable;
            runner.* = .{
                .test_id = i,
                .describe = this,
                .globalThis = ctx,
                .source = source,
                .value = JSC.Strong.create(this_object, ctx),
            };
            runner.ref.ref(ctx.bunVM());

            Jest.runner.?.enqueue(runner);
        }
    }

    pub fn onTestComplete(this: *DescribeScope, globalThis: *JSC.JSGlobalObject, test_id: TestRunner.Test.ID) void {
        // invalidate it
        this.current_test_id = std.math.maxInt(TestRunner.Test.ID);
        this.pending_tests.unset(test_id);

        const afterEach = this.execCallback(globalThis, .afterEach);
        if (!afterEach.isEmpty()) {
            globalThis.bunVM().runErrorHandler(afterEach, null);
        }

        if (this.pending_tests.findFirstSet() != null) {
            return;
        }

        // Step 1. Run the afterAll callbacks, in reverse order
        const afterAll = this.execCallback(globalThis, .afterAll);
        if (!afterAll.isEmpty()) {
            globalThis.bunVM().runErrorHandler(afterAll, null);
        }

        this.pending_tests.deinit(getAllocator(globalThis));
        this.tests.deinit(getAllocator(globalThis));
    }

    const ScopeStack = ObjectPool(std.ArrayListUnmanaged(*DescribeScope), null, true, 16);

    // pub fn runBeforeAll(this: *DescribeScope, ctx: js.JSContextRef, exception: js.ExceptionRef) bool {
    //     var scopes = ScopeStack.get(default_allocator);
    //     defer scopes.release();
    //     scopes.data.clearRetainingCapacity();
    //     var cur: ?*DescribeScope = this;
    //     while (cur) |scope| {
    //         scopes.data.append(default_allocator, this) catch unreachable;
    //         cur = scope.parent;
    //     }

    //     // while (scopes.data.popOrNull()) |scope| {
    //     //     scope.
    //     // }
    // }

    pub fn runCallbacks(this: *DescribeScope, ctx: js.JSContextRef, callbacks: std.ArrayListUnmanaged(js.JSObjectRef), exception: js.ExceptionRef) bool {
        if (comptime is_bindgen) return undefined;
        var i: usize = 0;
        while (i < callbacks.items.len) : (i += 1) {
            var callback = callbacks.items[i];
            var result = js.JSObjectCallAsFunctionReturnValue(ctx, callback, this, 0);
            if (result.isException(ctx.ptr().vm())) {
                exception.* = result.asObjectRef();
                return false;
            }
        }
    }

    pub fn createExpect(
        _: *DescribeScope,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSObjectRef {
        return JSC.Jest.Expect.getConstructor(ctx).asObjectRef();
    }

    pub fn createTest(
        _: *DescribeScope,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSObjectRef {
        return js.JSObjectMake(ctx, TestScope.Class.get().*, null);
    }

    pub fn createDescribe(
        this: *DescribeScope,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSObjectRef {
        return DescribeScope.Class.make(ctx, this);
    }
};

var active_test_expectation_counter: TestScope.Counter = undefined;

pub const TestRunnerTask = struct {
    test_id: TestRunner.Test.ID,
    describe: *DescribeScope,
    globalThis: *JSC.JSGlobalObject,
    source: logger.Source,
    value: JSC.Strong = .{},
    needs_before_each: bool = true,
    ref: JSC.Ref = JSC.Ref.init(),

    done_callback_state: AsyncState = .none,
    promise_state: AsyncState = .none,
    sync_state: AsyncState = .none,
    reported: bool = false,

    pub const AsyncState = enum {
        none,
        pending,
        fulfilled,
    };

    pub fn onUnhandledRejection(jsc_vm: *VirtualMachine, _: *JSC.JSGlobalObject, rejection: JSC.JSValue) void {
        if (jsc_vm.last_reported_error_for_dedupe == rejection and rejection != .zero) {
            jsc_vm.last_reported_error_for_dedupe = .zero;
        } else {
            jsc_vm.runErrorHandlerWithDedupe(rejection, null);
        }

        if (jsc_vm.onUnhandledRejectionCtx) |ctx| {
            var this = bun.cast(*TestRunnerTask, ctx);
            jsc_vm.onUnhandledRejectionCtx = null;
            this.handleResult(.{ .fail = active_test_expectation_counter.actual }, .unhandledRejection);
        }
    }

    pub fn run(this: *TestRunnerTask) bool {
        var describe = this.describe;

        // reset the global state for each test
        // prior to the run
        DescribeScope.active = describe;
        active_test_expectation_counter = .{};

        describe.current_test_id = this.test_id;
        var globalThis = this.globalThis;
        globalThis.bunVM().onUnhandledRejectionCtx = this;
        var test_: TestScope = this.describe.tests.items[this.test_id];
        const label = this.describe.tests.items[this.test_id].label;

        const test_id = this.test_id;

        if (this.needs_before_each) {
            this.needs_before_each = false;

            const beforeEach = this.describe.runCallback(globalThis, .beforeEach);

            if (!beforeEach.isEmpty()) {
                Jest.runner.?.reportFailure(test_id, this.source.path.text, label, 0, this.describe);
                globalThis.bunVM().runErrorHandler(beforeEach, null);
                return false;
            }
        }

        this.sync_state = .pending;

        const result = TestScope.run(&test_, this);

        // rejected promises should fail the test
        if (result != .fail)
            globalThis.handleRejectedPromises();

        if (result == .pending and this.sync_state == .pending and (this.done_callback_state == .pending or this.promise_state == .pending)) {
            this.sync_state = .fulfilled;
            this.value.set(globalThis, this.describe.value);
            return true;
        }

        this.handleResult(result, .sync);

        if (result == .fail) {
            globalThis.handleRejectedPromises();
        }

        return false;
    }

    pub fn handleResult(this: *TestRunnerTask, result: Result, comptime from: @Type(.EnumLiteral)) void {
        switch (comptime from) {
            .promise => {
                std.debug.assert(this.promise_state == .pending);
                this.promise_state = .fulfilled;

                if (this.done_callback_state == .pending and result == .pass) {
                    return;
                }
            },
            .callback => {
                std.debug.assert(this.done_callback_state == .pending);
                this.done_callback_state = .fulfilled;

                if (this.promise_state == .pending and result == .pass) {
                    return;
                }
            },
            .sync => {
                std.debug.assert(this.sync_state == .pending);
                this.sync_state = .fulfilled;
            },
            .unhandledRejection => {},
            else => @compileError("Bad from"),
        }

        defer {
            if (this.reported and this.promise_state != .pending and this.sync_state != .pending and this.done_callback_state != .pending)
                this.deinit();
        }

        if (this.reported)
            return;

        this.reported = true;

        var globalThis = this.globalThis;
        var test_ = this.describe.tests.items[this.test_id];
        const label = this.describe.tests.items[this.test_id].label;
        const test_id = this.test_id;
        var describe = this.describe;

        describe.tests.items[this.test_id] = test_;
        switch (result) {
            .pass => |count| Jest.runner.?.reportPass(test_id, this.source.path.text, label, count, describe),
            .fail => |count| Jest.runner.?.reportFailure(test_id, this.source.path.text, label, count, describe),
            .pending => @panic("Unexpected pending test"),
        }
        describe.onTestComplete(globalThis, this.test_id);

        Jest.runner.?.runNextTest();
    }

    fn deinit(this: *TestRunnerTask) void {
        var vm = JSC.VirtualMachine.vm;
        if (vm.onUnhandledRejectionCtx) |ctx| {
            if (ctx == @ptrCast(*anyopaque, this)) {
                vm.onUnhandledRejectionCtx = null;
            }
        }

        this.value.deinit();
        this.ref.unref(vm);
        default_allocator.destroy(this);
    }
};

pub const Result = union(TestRunner.Test.Status) {
    fail: u32,
    pass: u32, // assertion count
    pending: void,
};
