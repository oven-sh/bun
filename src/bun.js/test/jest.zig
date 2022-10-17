const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const RequestContext = @import("../../http.zig").RequestContext;
const MimeType = @import("../../http.zig").MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = @import("http");
const NetworkThread = HTTPClient.NetworkThread;
const Environment = @import("../../env.zig");

const JSC = @import("../../jsc.zig");
const js = JSC.C;

const logger = @import("../../logger.zig");
const Method = @import("../../http/method.zig").Method;

const ObjectPool = @import("../../pool.zig").ObjectPool;

const Output = @import("../../global.zig").Output;
const MutableString = @import("../../global.zig").MutableString;
const strings = @import("../../global.zig").strings;
const string = @import("../../global.zig").string;
const default_allocator = @import("../../global.zig").default_allocator;
const FeatureFlags = @import("../../global.zig").FeatureFlags;
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
    value: JSValue,
    op: Op.Set = Op.Set.init(.{}),

    pub const Op = enum(u3) {
        resolves,
        rejects,
        not,
        pub const Set = std.EnumSet(Op);
    };

    pub fn finalize(
        this: *Expect,
    ) void {
        this.value.unprotect();
        VirtualMachine.vm.allocator.destroy(this);
    }

    pub const Class = NewClass(
        Expect,
        .{ .name = "Expect" },
        .{
            .toBe = .{
                .rfn = Expect.toBe,
                .name = "toBe",
            },
            .toHaveBeenCalledTimes = .{
                .rfn = Expect.toHaveBeenCalledTimes,
                .name = "toHaveBeenCalledTimes",
            },
            .finalize = .{ .rfn = Expect.finalize, .name = "finalize" },
            .toHaveBeenCalledWith = .{
                .rfn = Expect.toHaveBeenCalledWith,
                .name = "toHaveBeenCalledWith",
            },
            .toHaveBeenLastCalledWith = .{
                .rfn = Expect.toHaveBeenLastCalledWith,
                .name = "toHaveBeenLastCalledWith",
            },
            .toHaveBeenNthCalledWith = .{
                .rfn = Expect.toHaveBeenNthCalledWith,
                .name = "toHaveBeenNthCalledWith",
            },
            .toHaveReturnedTimes = .{
                .rfn = Expect.toHaveReturnedTimes,
                .name = "toHaveReturnedTimes",
            },
            .toHaveReturnedWith = .{
                .rfn = Expect.toHaveReturnedWith,
                .name = "toHaveReturnedWith",
            },
            .toHaveLastReturnedWith = .{
                .rfn = Expect.toHaveLastReturnedWith,
                .name = "toHaveLastReturnedWith",
            },
            .toHaveNthReturnedWith = .{
                .rfn = Expect.toHaveNthReturnedWith,
                .name = "toHaveNthReturnedWith",
            },
            .toHaveLength = .{
                .rfn = Expect.toHaveLength,
                .name = "toHaveLength",
            },
            .toHaveProperty = .{
                .rfn = Expect.toHaveProperty,
                .name = "toHaveProperty",
            },
            .toBeCloseTo = .{
                .rfn = Expect.toBeCloseTo,
                .name = "toBeCloseTo",
            },
            .toBeGreaterThan = .{
                .rfn = Expect.toBeGreaterThan,
                .name = "toBeGreaterThan",
            },
            .toBeGreaterThanOrEqual = .{
                .rfn = Expect.toBeGreaterThanOrEqual,
                .name = "toBeGreaterThanOrEqual",
            },
            .toBeLessThan = .{
                .rfn = Expect.toBeLessThan,
                .name = "toBeLessThan",
            },
            .toBeLessThanOrEqual = .{
                .rfn = Expect.toBeLessThanOrEqual,
                .name = "toBeLessThanOrEqual",
            },
            .toBeInstanceOf = .{
                .rfn = Expect.toBeInstanceOf,
                .name = "toBeInstanceOf",
            },
            .toContain = .{
                .rfn = Expect.toContain,
                .name = "toContain",
            },
            .toContainEqual = .{
                .rfn = Expect.toContainEqual,
                .name = "toContainEqual",
            },
            .toEqual = .{
                .rfn = Expect.toEqual,
                .name = "toEqual",
            },
            .toMatch = .{
                .rfn = Expect.toMatch,
                .name = "toMatch",
            },
            .toMatchObject = .{
                .rfn = Expect.toMatchObject,
                .name = "toMatchObject",
            },
            .toMatchSnapshot = .{
                .rfn = Expect.toMatchSnapshot,
                .name = "toMatchSnapshot",
            },
            .toMatchInlineSnapshot = .{
                .rfn = Expect.toMatchInlineSnapshot,
                .name = "toMatchInlineSnapshot",
            },
            .toStrictEqual = .{
                .rfn = Expect.toStrictEqual,
                .name = "toStrictEqual",
            },
            .toThrow = .{
                .rfn = Expect.toThrow,
                .name = "toThrow",
            },
            .toThrowErrorMatchingSnapshot = .{
                .rfn = Expect.toThrowErrorMatchingSnapshot,
                .name = "toThrowErrorMatchingSnapshot",
            },
            .toThrowErrorMatchingInlineSnapshot = .{
                .rfn = Expect.toThrowErrorMatchingInlineSnapshot,
                .name = "toThrowErrorMatchingInlineSnapshot",
            },
        },
        .{
            .not = .{
                .get = Expect.not,
                .name = "not",
            },
            .resolves = .{
                .get = Expect.resolves,
                .name = "resolves",
            },
            .rejects = .{
                .get = Expect.rejects,
                .name = "rejects",
            },
        },
    );

    /// Object.is()
    pub fn toBe(
        this: *Expect,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (arguments.len != 1) {
            JSC.JSError(
                getAllocator(ctx),
                ".toBe() takes 1 argument",
                .{},
                ctx,
                exception,
            );
            return js.JSValueMakeUndefined(ctx);
        }
        if (this.scope.tests.items.len <= this.test_id) {
            JSC.JSError(
                getAllocator(ctx),
                ".toBe() called in wrong scope",
                .{},
                ctx,
                exception,
            );
            return js.JSValueMakeUndefined(ctx);
        }
        active_test_expectation_counter.actual += 1;
        const left = JSValue.fromRef(arguments[0]);
        left.ensureStillAlive();
        const right = this.value;
        right.ensureStillAlive();
        const eql = left.isSameValue(right, ctx.ptr());
        if (comptime Environment.allow_assert) {
            std.debug.assert(eql == JSC.C.JSValueIsStrictEqual(ctx, left.asObjectRef(), right.asObjectRef()));
        }

        if (!eql) {
            var lhs_formatter: JSC.ZigConsoleClient.Formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = ctx.ptr() };
            var rhs_formatter: JSC.ZigConsoleClient.Formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = ctx.ptr() };

            if (comptime Environment.allow_assert) {
                Output.prettyErrorln("\nJSType: {s}\nJSType: {s}\n\n", .{ @tagName(left.jsType()), @tagName(right.jsType()) });
            }

            JSC.JSError(
                getAllocator(ctx),
                "Expected: {}\n\tReceived: {}",
                .{
                    left.toFmt(ctx.ptr(), &lhs_formatter),
                    right.toFmt(ctx.ptr(), &rhs_formatter),
                },
                ctx,
                exception,
            );

            return null;
        }

        return thisObject;
    }

    pub fn toHaveLength(
        this: *Expect,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (arguments.len != 1) {
            JSC.JSError(
                getAllocator(ctx),
                ".toHaveLength() takes 1 argument",
                .{},
                ctx,
                exception,
            );
            return js.JSValueMakeUndefined(ctx);
        }
        if (this.scope.tests.items.len <= this.test_id) {
            JSC.JSError(
                getAllocator(ctx),
                ".toHaveLength() called in wrong scope",
                .{},
                ctx,
                exception,
            );
            return js.JSValueMakeUndefined(ctx);
        }
        active_test_expectation_counter.actual += 1;

        const expected = JSC.JSValue.fromRef(arguments[0]).toU32();
        const actual = this.value.getLengthOfArray(ctx.ptr());
        if (expected != actual) {
            JSC.JSError(
                getAllocator(ctx),
                "Expected length to equal {d} but received {d}\n  Expected: {d}\n    Actual: {d}\n",
                .{
                    expected,
                    actual,
                    expected,
                    actual,
                },
                ctx,
                exception,
            );
            return null;
        }
        return thisObject;
    }

    pub const toHaveBeenCalledTimes = notImplementedFn;
    pub const toHaveBeenCalledWith = notImplementedFn;
    pub const toHaveBeenLastCalledWith = notImplementedFn;
    pub const toHaveBeenNthCalledWith = notImplementedFn;
    pub const toHaveReturnedTimes = notImplementedFn;
    pub const toHaveReturnedWith = notImplementedFn;
    pub const toHaveLastReturnedWith = notImplementedFn;
    pub const toHaveNthReturnedWith = notImplementedFn;
    pub const toHaveProperty = notImplementedFn;
    pub const toBeCloseTo = notImplementedFn;
    pub const toBeGreaterThan = notImplementedFn;
    pub const toBeGreaterThanOrEqual = notImplementedFn;
    pub const toBeLessThan = notImplementedFn;
    pub const toBeLessThanOrEqual = notImplementedFn;
    pub const toBeInstanceOf = notImplementedFn;
    pub const toContain = notImplementedFn;
    pub const toContainEqual = notImplementedFn;
    pub const toEqual = notImplementedFn;
    pub const toMatch = notImplementedFn;
    pub const toMatchObject = notImplementedFn;
    pub const toMatchSnapshot = notImplementedFn;
    pub const toMatchInlineSnapshot = notImplementedFn;
    pub const toStrictEqual = notImplementedFn;
    pub const toThrow = notImplementedFn;
    pub const toThrowErrorMatchingSnapshot = notImplementedFn;
    pub const toThrowErrorMatchingInlineSnapshot = notImplementedFn;

    pub const not = notImplementedProp;
    pub const resolves = notImplementedProp;
    pub const rejects = notImplementedProp;
};

pub const ExpectPrototype = struct {
    scope: *DescribeScope,
    test_id: TestRunner.Test.ID,
    op: Expect.Op.Set = Expect.Op.Set.init(.{}),

    pub const Class = NewClass(
        ExpectPrototype,
        .{
            .name = "ExpectPrototype",
            .read_only = true,
        },
        .{
            .call = .{
                .rfn = ExpectPrototype.call,
            },
            .extend = .{
                .name = "extend",
                .rfn = ExpectPrototype.extend,
            },
            .anything = .{
                .name = "anything",
                .rfn = ExpectPrototype.anything,
            },
            .any = .{
                .name = "any",
                .rfn = ExpectPrototype.any,
            },
            .arrayContaining = .{
                .name = "arrayContaining",
                .rfn = ExpectPrototype.arrayContaining,
            },
            .assertions = .{
                .name = "assertions",
                .rfn = ExpectPrototype.assertions,
            },
            .hasAssertions = .{
                .name = "hasAssertions",
                .rfn = ExpectPrototype.hasAssertions,
            },
            .objectContaining = .{
                .name = "objectContaining",
                .rfn = ExpectPrototype.objectContaining,
            },
            .stringContaining = .{
                .name = "stringContaining",
                .rfn = ExpectPrototype.stringContaining,
            },
            .stringMatching = .{
                .name = "stringMatching",
                .rfn = ExpectPrototype.stringMatching,
            },
            .addSnapshotSerializer = .{
                .name = "addSnapshotSerializer",
                .rfn = ExpectPrototype.addSnapshotSerializer,
            },
        },
        .{
            .not = .{
                .name = "not",
                .get = ExpectPrototype.not,
            },
            .resolves = .{
                .name = "resolves",
                .get = ExpectPrototype.resolves,
            },
            .rejects = .{
                .name = "rejects",
                .get = ExpectPrototype.rejects,
            },
        },
    );
    pub const extend = notImplementedFn;
    pub const anything = notImplementedFn;
    pub const any = notImplementedFn;
    pub const arrayContaining = notImplementedFn;
    pub const assertions = notImplementedFn;
    pub const hasAssertions = notImplementedFn;
    pub const objectContaining = notImplementedFn;
    pub const stringContaining = notImplementedFn;
    pub const stringMatching = notImplementedFn;
    pub const addSnapshotSerializer = notImplementedFn;
    pub const not = notImplementedProp;
    pub const resolves = notImplementedProp;
    pub const rejects = notImplementedProp;

    pub fn call(
        _: *ExpectPrototype,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        if (arguments.len != 1) {
            JSError(getAllocator(ctx), "expect() requires one argument", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }
        var expect_ = getAllocator(ctx).create(Expect) catch unreachable;
        const value = JSC.JSValue.c(arguments[0]);
        if (Jest.runner.?.pending_test == null) {
            JSError(
                getAllocator(ctx),
                "expect() must be called during a test",
                .{},
                ctx,
                exception,
            );
            return js.JSValueMakeUndefined(ctx);
        }

        value.protect();
        expect_.* = .{
            .value = value,
            .scope = Jest.runner.?.pending_test.?.describe,
            .test_id = Jest.runner.?.pending_test.?.test_id,
        };
        expect_.value.ensureStillAlive();
        return Expect.Class.make(ctx, expect_);
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
        var args = arguments[0..@minimum(arguments.len, 2)];
        var label: string = "";
        if (args.len == 0) {
            return this;
        }

        if (js.JSValueIsString(ctx, args[0])) {
            label = (JSC.JSValue.fromRef(arguments[0]).toSlice(ctx, getAllocator(ctx)).cloneIfNeeded() catch unreachable).slice();
            args = args[1..];
        }

        var function = args[0].?.value();
        if (!function.isCell() or !function.isCallable(ctx.vm())) {
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
        task.handleResult(.{ .fail = active_test_expectation_counter.actual });
        return JSValue.jsUndefined();
    }

    pub fn onResolve(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(2);
        var task: *TestRunnerTask = arguments.ptr[1].asPromisePtr(TestRunnerTask);
        task.handleResult(.{ .pass = active_test_expectation_counter.actual });
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
        }
        JSC.markBinding(@src());
        const initial_value = js.JSObjectCallAsFunctionReturnValue(vm.global, callback, null, 0, null);

        if (initial_value.isException(vm.global.vm()) or initial_value.isError() or initial_value.isAggregateError(vm.global)) {
            vm.runErrorHandler(initial_value, null);
            return .{ .fail = active_test_expectation_counter.actual };
        }

        if (!initial_value.isEmptyOrUndefinedOrNull() and (initial_value.asPromise() != null or initial_value.asInternalPromise() != null)) {
            if (this.promise != null) {
                return .{ .pending = .{} };
            }

            var promise = initial_value.asPromise().?;
            this.task = task;

            switch (promise.status(vm.global.vm())) {
                .Rejected => {
                    vm.runErrorHandler(promise.result(vm.global.vm()), null);
                    return .{ .fail = active_test_expectation_counter.actual };
                },
                .Pending => {
                    _ = promise.asValue(vm.global).then(vm.global, task, onResolve, onReject);
                    return .{ .pending = {} };
                },

                else => {
                    _ = promise.result(vm.global.vm());
                },
            }
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

        if (js.JSValueIsString(ctx, arguments[0])) {
            JSC.JSValue.fromRef(arguments[0]).toZigString(&label, ctx.ptr());
            args = args[1..];
        }

        if (args.len == 0 or !js.JSObjectIsFunction(ctx, args[0])) {
            JSError(getAllocator(ctx), "describe() requires a callback function", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }

        var callback = args[0];

        var scope = getAllocator(ctx).create(DescribeScope) catch unreachable;
        scope.* = .{
            .label = (label.toSlice(getAllocator(ctx)).cloneIfNeeded() catch unreachable).slice(),
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
        var expect_ = getAllocator(ctx).create(ExpectPrototype) catch unreachable;
        expect_.* = .{
            .scope = DescribeScope.active,
            .test_id = DescribeScope.active.current_test_id,
        };
        return ExpectPrototype.Class.make(ctx, expect_);
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

const TestRunnerTask = struct {
    test_id: TestRunner.Test.ID,
    describe: *DescribeScope,
    globalThis: *JSC.JSGlobalObject,
    source: logger.Source,
    value: JSC.Strong = .{},
    needs_before_each: bool = true,
    ref: JSC.Ref = JSC.Ref.init(),

    pub fn run(this: *TestRunnerTask) bool {
        var describe = this.describe;

        // reset the global state for each test
        // prior to the run
        DescribeScope.active = describe;
        active_test_expectation_counter = .{};

        var globalThis = this.globalThis;
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

        const result = TestScope.run(&test_, this);

        if (result == .pending) {
            this.value.set(globalThis, this.describe.value);
            return true;
        }

        this.handleResult(result);

        return false;
    }

    pub fn handleResult(this: *TestRunnerTask, result: Result) void {
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
        this.deinit();
        Jest.runner.?.runNextTest();
    }

    fn deinit(this: *TestRunnerTask) void {
        this.value.deinit();
        this.ref.unref(JSC.VirtualMachine.vm);
        default_allocator.destroy(this);
    }
};

pub const Result = union(TestRunner.Test.Status) {
    fail: u32,
    pass: u32, // assertion count
    pending: void,
};
