const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const RequestContext = @import("../../../http.zig").RequestContext;
const MimeType = @import("../../../http.zig").MimeType;
const ZigURL = @import("../../../query_string_map.zig").URL;
const HTTPClient = @import("http");
const NetworkThread = HTTPClient.NetworkThread;

const JSC = @import("../../../jsc.zig");
const js = JSC.C;

const logger = @import("../../../logger.zig");
const Method = @import("../../../http/method.zig").Method;

const ObjectPool = @import("../../../pool.zig").ObjectPool;

const Output = @import("../../../global.zig").Output;
const MutableString = @import("../../../global.zig").MutableString;
const strings = @import("../../../global.zig").strings;
const string = @import("../../../global.zig").string;
const default_allocator = @import("../../../global.zig").default_allocator;
const FeatureFlags = @import("../../../global.zig").FeatureFlags;
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

const Fs = @import("../../../fs.zig");

fn notImplementedFn(_: anytype, ctx: js.JSContextRef, _: js.JSObjectRef, _: js.JSObjectRef, _: []const js.JSValueRef, exception: js.JSExceptionRef) void {
    JSError(getAllocator(ctx), "Not implemented yet!", .{}, ctx, exception);
}

fn notImplementedProp(
    _: anytype,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    return JSError(getAllocator(ctx), "Property not implemented yet!", .{}, ctx, exception);
}

const ArrayIdentityContext = @import("../../../identity_context.zig").ArrayIdentityContext;
pub const TestRunner = struct {
    tests: TestRunner.Test.List = .{},
    log: *logger.Log,
    files: File.List = .{},
    index: File.Map = File.Map{},

    allocator: std.mem.Allocator,
    callback: *Callback = undefined,

    pub const Callback = struct {
        pub const OnUpdateCount = fn (this: *Callback, delta: u32, total: u32) void;
        pub const OnTestStart = fn (this: *Callback, test_id: Test.ID) void;
        pub const OnTestPass = fn (this: *Callback, test_id: Test.ID, expectations: u32) void;
        pub const OnTestFail = fn (this: *Callback, test_id: Test.ID, file: string, label: string, expectations: u32) void;
        onUpdateCount: OnUpdateCount,
        onTestStart: OnTestStart,
        onTestPass: OnTestPass,
        onTestFail: OnTestFail,
    };

    pub fn reportPass(this: *TestRunner, test_id: Test.ID, expectations: u32) void {
        this.tests.items(.status)[test_id] = .pass;
        this.callback.onTestPass(&this.callback, this, test_id, expectations);
    }
    pub fn reportFailure(this: *TestRunner, test_id: Test.ID, file: string, label: string, expectations: u32) void {
        this.tests.items(.status)[test_id] = .fail;
        this.callback.onTestFail(&this.callback, this, test_id, file, label, expectations);
    }

    pub fn addTestCount(this: *TestRunner, count: u32) u32 {
        this.tests.ensureUnusedCapacity(this.allocator, count) catch unreachable;
        const start = @truncate(Test.ID, this.tests.len);
        this.tests.len += count;
        var statuses = this.tests.items(.status)[start..this.tests.len];
        std.mem.set(Test.Status, statuses, count, Test.Status.pending);
        return start;
    }

    pub fn getOrPutFile(this: *TestRunner, file_path: string) *DescribeScope {
        var entry = this.index.getOrPut(this.allocator, std.hash.Wyhash.hash(0, file_path)) catch unreachable;
        if (entry.found_existing) {
            return this.files.items(.module_scope)[entry.value_ptr.*];
        }
        var scope = this.allocator.create(DescribeScope) catch unreachable;
        scope.* = DescribeScope{
            .test_id_start = @truncate(Test.ID, this.tests.len),
        };
        try this.files.append(this.allocator, .{ .module_scope = scope });
        entry.value_ptr.* = @truncate(File.ID, this.files.len - 1);
        return scope;
    }

    pub const File = struct {
        source: logger.Source = logger.Source.initEmptyFile(""),
        log: *logger.Log = logger.Log.init(default_allocator),
        module_scope: *DescribeScope = undefined,

        pub const List = std.MultiArrayList(File);
        pub const ID = u32;
        pub const Map = std.ArrayHashMapUnmanaged(u32, u32, ArrayIdentityContext(u32), false);
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
            JSError(getAllocator(ctx), "Run bun test to run a test", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        };

        if (arguments.len < 1 or !js.JSValueIsString(ctx, arguments[0])) {
            JSError(getAllocator(ctx), "Bun.jest() expects a string filename", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }
        var str = js.JSValueToStringCopy(arguments[0], ctx);
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
        return DescribeScope.Class.make(ctx, scope);
    }
};

/// https://jestjs.io/docs/expect
// To support async tests, we need to track the test ID
pub const Expect = struct {
    test_id: TestRunner.Test.ID,
    describe_scope: *DescribeScope,
    value: js.JSValueRef,
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
        js.JSValueUnprotect(VirtualMachine.vm.global.ref(), this.value);
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
                .rfn = Expect.not,
                .name = "not",
            },
            .resolves = .{
                .rfn = Expect.resolves,
                .name = "resolves",
            },
            .rejects = .{
                .rfn = Expect.rejects,
                .name = "rejects",
            },
        },
    );
    pub const toBe = notImplementedFn;
    pub const toHaveBeenCalledTimes = notImplementedFn;
    pub const toHaveBeenCalledWith = notImplementedFn;
    pub const toHaveBeenLastCalledWith = notImplementedFn;
    pub const toHaveBeenNthCalledWith = notImplementedFn;
    pub const toHaveReturnedTimes = notImplementedFn;
    pub const toHaveReturnedWith = notImplementedFn;
    pub const toHaveLastReturnedWith = notImplementedFn;
    pub const toHaveNthReturnedWith = notImplementedFn;
    pub const toHaveLength = notImplementedFn;
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
    describe_scope: *DescribeScope,
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
        if (arguments.length != 1) {
            JSError(getAllocator(ctx), "expect() requires one argument", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }
        var expect_ = getAllocator(ctx).create(Expect) catch unreachable;
        js.JSValueProtect(ctx, arguments[0]);
        expect_.* = .{
            .value = arguments[0],
            .describe_scope = DescribeScope.active,
            .test_id = DescribeScope.active.current_test_id,
        };
        return Expect.Class.make(ctx, expect_);
    }
};

pub const TestScope = struct {
    counter: Counter = Counter{},
    label: string = "",
    parent: *DescribeScope,
    callback: js.JSValueRef,
    id: TestRunner.Test.ID = 0,

    pub const Class = NewClass(TestScope, .{ .name = "test" }, .{ .call = call }, .{});

    pub const Counter = struct {
        expected: u32 = 0,
        actual: u32 = 0,
    };

    pub fn call(
        // the DescribeScope here is the top of the file, not the real one
        _: void,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        var args = arguments[0..@minimum(arguments.len, 2)];
        var label: string = "";
        if (args.len == 0) {
            return js.JSValueMakeUndefined(ctx);
        }

        if (js.JSValueIsString(args[0])) {
            var label_ref = js.JSValueToStringCopy(ctx, args[0], exception);
            if (exception != null) return null;
            defer js.JSStringRelease(label_ref);
            var label_ = getAllocator(ctx).alloc(u8, js.JSStringGetLength(label_ref) + 1) catch unreachable;
            label = label_[0 .. js.JSStringGetUTF8CString(label_ref, label_.ptr, label_.len) - 1];
            args = args[1..];
        }

        var function = args[0];
        if (!js.JSValueIsObject(ctx, function) or !js.JSObjectIsFunction(ctx, function)) {
            JSError(getAllocator(ctx), "test() expects a function", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }

        js.JSValueProtect(ctx, function);

        DescribeScope.active.tests.append(getAllocator(ctx), TestScope{
            .label = label,
            .callback = function,
        }) catch unreachable;
    }

    pub const Result = union(TestRunner.Test.Status) {
        fail: u32,
        pass: u32, // assertion count
        pending: void,
    };

    pub fn run(
        this: *TestScope,
    ) Result {
        var promise = JSC.JSPromise.resolvedPromise(
            VirtualMachine.vm.global,
            js.JSObjectCallAsFunctionReturnValue(VirtualMachine.vm.global.ref(), this.callback, null, 0, null),
        );
        js.JSValueUnprotect(VirtualMachine.vm.global.ref(), this.callback);
        this.callback = null;

        while (promise.status(VirtualMachine.vm.global.vm()) == .pending) {
            VirtualMachine.vm.tick();
        }
        var result = promise.result(VirtualMachine.vm.global.vm());

        if (result.isException(VirtualMachine.vm.global.vm()) or result.isError() or result.isAggregateError(VirtualMachine.vm.global.vm())) {
            VirtualMachine.vm.defaultErrorHandler(result, null);
            return .{ .fail = .{} };
        }

        if (this.counter.expected > 0 and this.counter.expected < this.counter.actual) {
            Output.prettyErrorln("Test fail: {d} / {d} expectations\n (make this better!)", .{
                this.counter.actual,
                this.counter.expected,
            });
            return .{ .fail = .{} };
        }

        return TestRunner.Test.Status.passed;
    }
};

pub const DescribeScope = struct {
    label: string = "",
    parent: ?*DescribeScope = null,
    beforeAll: std.ArrayListUnmanaged(js.JSValueRef) = .{},
    beforeEach: std.ArrayListUnmanaged(js.JSValueRef) = .{},
    afterEach: std.ArrayListUnmanaged(js.JSValueRef) = .{},
    afterAll: std.ArrayListUnmanaged(js.JSValueRef) = .{},
    test_id_start: TestRunner.Test.ID = 0,
    test_id_len: TestRunner.Test.ID = 0,
    tests: std.ArrayListUnmanaged(TestScope) = .{},
    file_id: TestRunner.File.ID,
    current_test_id: TestRunner.Test.ID = 0,

    pub const TestEntry = struct {
        label: string,
        callback: js.JSValueRef,

        pub const List = std.MultiArrayList(TestEntry);
    };

    pub threadlocal var active: *DescribeScope = undefined;

    pub const Class = NewClass(
        DescribeScope,
        .{
            .name = "describe",
            .read_only = true,
        },
        .{
            .describe = .{ .rfn = describe },
            .afterAll = .{ .rfn = callAfterAll, .name = "afterAll" },
            .beforeAll = .{ .rfn = callAfterAll, .name = "beforeAll" },
            .beforeEach = .{ .rfn = callAfterAll, .name = "beforeEach" },
        },
        .{
            .expect = .{ .get = createExpect, .name = "expect" },
            .it = .{ .get = createTest, .name = "it" },
            .@"test" = .{ .get = createTest, .name = "test" },
        },
    );

    pub fn describe(
        this: *DescribeScope,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        if (arguments.length == 0 or arguments.len > 2) {
            JSError(getAllocator(ctx), "describe() requires 1-2 arguments", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }

        var label_value: js.JSValueRef = null;
        var args = arguments;

        if (js.JSValueIsString(ctx, arguments[0])) {
            label_value = arguments[0];
            args = args[1..];
        }

        if (args.len == 0 or !js.JSObjectIsFunction(ctx, args[0])) {
            JSError(getAllocator(ctx), "describe() requires a callback function", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }

        var callback = args[0];

        var label: js.JSStringRef = null;
        defer if (label != null) js.JSStringRelease(label);

        if (label_value != null) {
            label = js.JSValueToStringCopy(ctx, label_value, exception);
        }
        if (exception != js.JSValueRef) {
            return js.JSValueMakeUndefined(ctx);
        }

        const label_len = if (label == null)
            0
        else
            js.JSStringGetLength(label);

        var scope = getAllocator(ctx).create(DescribeScope) catch unreachable;
        var str = if (label_len == 0) "" else (getAllocator(ctx).dupe(u8, js.JSStringGetCharacters8Ptr(label)[0..label_len]) catch unreachable);
        scope.* = .{
            .label = str,
            .parent = this,
        };
        var new_this = DescribeScope.Class.make(ctx, scope);

        return scope.run(new_this, callback, exception);
    }

    pub fn run(this: *DescribeScope, ctx: js.JSContextRef, callback: js.JSObjectRef, exception: js.ExceptionRef) js.JSObjectRef {
        js.JSValueProtect(ctx, callback);
        defer js.JSValueUnprotect(ctx, callback);
        var original_active = active;
        defer active = original_active;
        active = this;

        {
            var result = js.JSObjectCallAsFunctionReturnValue(ctx, callback, this, 0);
            if (result.isException(VirtualMachine.vm.global.vm())) {
                exception.* = result;
                return null;
            }
        }
        // Step 1. Initialize the test block

        const file = this.file_id;

        var tests: []TestScope = this.tests.items;
        const end = @truncate(TestRunner.Test.ID, tests.len);
        // Step 2. Update the runner with the count of how many tests we have for this block
        this.test_id_start = Jest.runner.?.addTestCount(end);

        // Step 3. Run the beforeAll callbacks, in reverse order
        // TODO:

        if (tests.len == 0) return;

        const source: logger.Source = Jest.runner.?.files.items(.source)[file];

        var i: TestRunner.Test.ID = 0;

        while (i < end) {
            const test_id = i + this.test_id_start;
            this.current_test_id = test_id;
            const result = TestScope.run(&tests[i]);
            // invalidate it
            this.current_test_id = std.math.maxInt(TestRunner.Test.ID);

            switch (result) {
                .pass => |count| Jest.runner.?.reportPass(test_id, count),
                .fail => |count| Jest.runner.?.reportFailure(test_id, source.path.text, tests[i].label, count),
                .pending => unreachable,
            }

            i += 1;
        }
        this.tests.deinit(getAllocator(ctx));
    }

    const ScopeStack = ObjectPool(std.ArrayListUnmanaged(*DescribeScope), null, true);

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
        var i: usize = 0;
        while (i < callbacks.items.len) : (i += 1) {
            var callback = callbacks.items[i];
            var result = js.JSObjectCallAsFunctionReturnValue(ctx, callback, this, 0);
            if (result.isException(VirtualMachine.vm.global.vm())) {
                exception.* = result;
                return false;
            }
        }
    }

    pub const callAfterAll = notImplementedFn;
    pub const callAfterEach = notImplementedFn;
    pub const callBeforeAll = notImplementedFn;

    pub fn createExpect(
        _: *DescribeScope,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSObjectRef {
        var expect_ = getAllocator(ctx).create(ExpectPrototype) catch unreachable;
        expect_.* = .{
            .describe_scope = DescribeScope.active,
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
};
