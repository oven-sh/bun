const std = @import("std");
const bun = @import("root").bun;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const Api = @import("../../api/schema.zig").Api;
const MimeType = bun.http.MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = @import("root").bun.http;
const Environment = bun.Environment;

const Snapshots = @import("./snapshot.zig").Snapshots;
const expect = @import("./expect.zig");
const Counter = expect.Counter;
const Expect = expect.Expect;

const DiffFormatter = @import("./diff_format.zig").DiffFormatter;

const JSC = @import("root").bun.JSC;
const js = JSC.C;

const logger = @import("root").bun.logger;
const Method = @import("../../http/method.zig").Method;

const ObjectPool = @import("../../pool.zig").ObjectPool;

const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const strings = @import("root").bun.strings;
const string = @import("root").bun.string;
const default_allocator = @import("root").bun.default_allocator;
const FeatureFlags = @import("root").bun.FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const getAllocator = @import("../base.zig").getAllocator;
const RegularExpression = bun.RegularExpression;

const ZigString = JSC.ZigString;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSType = JSValue.JSType;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;
const JSObject = JSC.JSObject;
const CallFrame = JSC.CallFrame;

const VirtualMachine = JSC.VirtualMachine;
const Fs = bun.fs;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;

const ArrayIdentityContext = bun.ArrayIdentityContext;
pub var test_elapsed_timer: ?*std.time.Timer = null;

pub const Tag = enum(u3) {
    pass,
    fail,
    only,
    skip,
    todo,
};
const debug = Output.scoped(.jest, false);
pub const TestRunner = struct {
    tests: TestRunner.Test.List = .{},
    log: *logger.Log,
    files: File.List = .{},
    index: File.Map = File.Map{},
    only: bool = false,
    run_todo: bool = false,
    last_file: u64 = 0,
    bail: u32 = 0,

    allocator: std.mem.Allocator,
    callback: *Callback = undefined,

    drainer: JSC.AnyTask = undefined,
    queue: std.fifo.LinearFifo(*TestRunnerTask, .{ .Dynamic = {} }) = std.fifo.LinearFifo(*TestRunnerTask, .{ .Dynamic = {} }).init(default_allocator),

    has_pending_tests: bool = false,
    pending_test: ?*TestRunnerTask = null,

    snapshots: Snapshots,

    default_timeout_ms: u32 = 0,
    test_timeout_timer: ?*bun.uws.Timer = null,
    last_test_timeout_timer_duration: u32 = 0,
    active_test_for_timeout: ?TestRunner.Test.ID = null,
    test_options: *const bun.CLI.Command.TestOptions = undefined,

    global_callbacks: struct {
        beforeAll: std.ArrayListUnmanaged(JSC.JSValue) = .{},
        beforeEach: std.ArrayListUnmanaged(JSC.JSValue) = .{},
        afterEach: std.ArrayListUnmanaged(JSC.JSValue) = .{},
        afterAll: std.ArrayListUnmanaged(JSC.JSValue) = .{},
    } = .{},

    // Used for --test-name-pattern to reduce allocations
    filter_regex: ?*RegularExpression,
    filter_buffer: MutableString,

    pub const Drainer = JSC.AnyTask.New(TestRunner, drain);

    pub fn onTestTimeout(timer: *bun.uws.Timer) callconv(.C) void {
        const this = timer.ext(TestRunner).?;

        if (this.pending_test) |pending_test| {
            if (!pending_test.reported) {
                const now = std.time.Instant.now() catch unreachable;
                const elapsed = now.since(pending_test.started_at);

                if (elapsed >= (@as(u64, this.last_test_timeout_timer_duration) * std.time.ns_per_ms)) {
                    pending_test.timeout();
                }
            }
        }
    }

    pub fn setTimeout(
        this: *TestRunner,
        milliseconds: u32,
        test_id: TestRunner.Test.ID,
    ) void {
        this.active_test_for_timeout = test_id;

        if (milliseconds > 0) {
            if (this.test_timeout_timer == null) {
                this.test_timeout_timer = bun.uws.Timer.createFallthrough(bun.uws.Loop.get(), this);
            }

            if (this.last_test_timeout_timer_duration != milliseconds) {
                this.last_test_timeout_timer_duration = milliseconds;
                this.test_timeout_timer.?.set(this, onTestTimeout, @as(i32, @intCast(milliseconds)), @as(i32, @intCast(milliseconds)));
            }
        }
    }

    pub fn enqueue(this: *TestRunner, task: *TestRunnerTask) void {
        this.queue.writeItem(task) catch unreachable;
    }

    pub fn runNextTest(this: *TestRunner) void {
        this.has_pending_tests = false;
        this.pending_test = null;

        // disable idling
        JSC.VirtualMachine.get().wakeup();
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

        const list = this.queue.readableSlice(0);
        for (list) |task| {
            task.deinit();
        }
        this.queue.count = 0;
        this.queue.head = 0;

        this.tests.shrinkRetainingCapacity(0);
        this.callback.onUpdateCount(this.callback, 0, 0);
    }

    pub const Callback = struct {
        pub const OnUpdateCount = *const fn (this: *Callback, delta: u32, total: u32) void;
        pub const OnTestStart = *const fn (this: *Callback, test_id: Test.ID) void;
        pub const OnTestUpdate = *const fn (this: *Callback, test_id: Test.ID, file: string, label: string, expectations: u32, elapsed_ns: u64, parent: ?*DescribeScope) void;
        onUpdateCount: OnUpdateCount,
        onTestStart: OnTestStart,
        onTestPass: OnTestUpdate,
        onTestFail: OnTestUpdate,
        onTestSkip: OnTestUpdate,
        onTestTodo: OnTestUpdate,
    };

    pub fn reportPass(this: *TestRunner, test_id: Test.ID, file: string, label: string, expectations: u32, elapsed_ns: u64, parent: ?*DescribeScope) void {
        this.tests.items(.status)[test_id] = .pass;
        this.callback.onTestPass(this.callback, test_id, file, label, expectations, elapsed_ns, parent);
    }

    pub fn reportFailure(this: *TestRunner, test_id: Test.ID, file: string, label: string, expectations: u32, elapsed_ns: u64, parent: ?*DescribeScope) void {
        this.tests.items(.status)[test_id] = .fail;
        this.callback.onTestFail(this.callback, test_id, file, label, expectations, elapsed_ns, parent);
    }

    pub fn reportSkip(this: *TestRunner, test_id: Test.ID, file: string, label: string, parent: ?*DescribeScope) void {
        this.tests.items(.status)[test_id] = .skip;
        this.callback.onTestSkip(this.callback, test_id, file, label, 0, 0, parent);
    }

    pub fn reportTodo(this: *TestRunner, test_id: Test.ID, file: string, label: string, parent: ?*DescribeScope) void {
        this.tests.items(.status)[test_id] = .todo;
        this.callback.onTestTodo(this.callback, test_id, file, label, 0, 0, parent);
    }

    pub fn addTestCount(this: *TestRunner, count: u32) u32 {
        this.tests.ensureUnusedCapacity(this.allocator, count) catch unreachable;
        const start = @as(Test.ID, @truncate(this.tests.len));
        this.tests.len += count;
        const statuses = this.tests.items(.status)[start..][0..count];
        @memset(statuses, Test.Status.pending);
        this.callback.onUpdateCount(this.callback, count, count + start);
        return start;
    }

    pub fn getOrPutFile(this: *TestRunner, file_path: string) *DescribeScope {
        const entry = this.index.getOrPut(this.allocator, @as(u32, @truncate(bun.hash(file_path)))) catch unreachable;
        if (entry.found_existing) {
            return this.files.items(.module_scope)[entry.value_ptr.*];
        }
        const scope = this.allocator.create(DescribeScope) catch unreachable;
        const file_id = @as(File.ID, @truncate(this.files.len));
        scope.* = DescribeScope{
            .file_id = file_id,
            .test_id_start = @as(Test.ID, @truncate(this.tests.len)),
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
            skip,
            todo,
            fail_because_todo_passed,
        };
    };
};

pub const Jest = struct {
    pub var runner: ?*TestRunner = null;

    fn globalHook(comptime name: string) JSC.JSHostFunctionType {
        return struct {
            pub fn appendGlobalFunctionCallback(
                globalThis: *JSC.JSGlobalObject,
                callframe: *JSC.CallFrame,
            ) callconv(.C) JSValue {
                const the_runner = runner orelse {
                    globalThis.throw("Cannot use " ++ name ++ "() outside of the test runner. Run \"bun test\" to run tests.", .{});
                    return .zero;
                };

                const arguments = callframe.arguments(2);
                if (arguments.len < 1) {
                    globalThis.throwNotEnoughArguments("callback", 1, arguments.len);
                    return .zero;
                }

                const function = arguments.ptr[0];
                if (function.isEmptyOrUndefinedOrNull() or !function.isCallable(globalThis.vm())) {
                    globalThis.throwInvalidArgumentType(name, "callback", "function");
                    return .zero;
                }

                if (function.getLength(globalThis) > 0) {
                    globalThis.throw("done() callback is not implemented in global hooks yet. Please make your function take no arguments", .{});
                    return .zero;
                }

                function.protect();
                @field(the_runner.global_callbacks, name).append(
                    bun.default_allocator,
                    function,
                ) catch unreachable;
                return JSC.JSValue.jsUndefined();
            }
        }.appendGlobalFunctionCallback;
    }

    pub fn Bun__Jest__createTestModuleObject(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return createTestModule(globalObject, false);
    }

    pub fn Bun__Jest__createTestPreloadObject(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return createTestModule(globalObject, true);
    }

    pub fn createTestModule(globalObject: *JSC.JSGlobalObject, comptime outside_of_test: bool) JSC.JSValue {
        const ThisTestScope, const ThisDescribeScope = if (outside_of_test)
            .{ WrappedTestScope, WrappedDescribeScope }
        else
            .{ TestScope, DescribeScope };

        const module = JSC.JSValue.createEmptyObject(globalObject, 13);

        const test_fn = JSC.NewFunction(globalObject, ZigString.static("test"), 2, ThisTestScope.call, false);
        module.put(
            globalObject,
            ZigString.static("test"),
            test_fn,
        );
        test_fn.put(
            globalObject,
            ZigString.static("only"),
            JSC.NewFunction(globalObject, ZigString.static("only"), 2, ThisTestScope.only, false),
        );
        test_fn.put(
            globalObject,
            ZigString.static("skip"),
            JSC.NewFunction(globalObject, ZigString.static("skip"), 2, ThisTestScope.skip, false),
        );
        test_fn.put(
            globalObject,
            ZigString.static("todo"),
            JSC.NewFunction(globalObject, ZigString.static("todo"), 2, ThisTestScope.todo, false),
        );
        test_fn.put(
            globalObject,
            ZigString.static("if"),
            JSC.NewFunction(globalObject, ZigString.static("if"), 2, ThisTestScope.callIf, false),
        );
        test_fn.put(
            globalObject,
            ZigString.static("skipIf"),
            JSC.NewFunction(globalObject, ZigString.static("skipIf"), 2, ThisTestScope.skipIf, false),
        );
        test_fn.put(
            globalObject,
            ZigString.static("each"),
            JSC.NewFunction(globalObject, ZigString.static("each"), 2, ThisTestScope.each, false),
        );

        module.put(
            globalObject,
            ZigString.static("it"),
            test_fn,
        );
        const describe = JSC.NewFunction(globalObject, ZigString.static("describe"), 2, ThisDescribeScope.call, false);
        describe.put(
            globalObject,
            ZigString.static("only"),
            JSC.NewFunction(globalObject, ZigString.static("only"), 2, ThisDescribeScope.only, false),
        );
        describe.put(
            globalObject,
            ZigString.static("skip"),
            JSC.NewFunction(globalObject, ZigString.static("skip"), 2, ThisDescribeScope.skip, false),
        );
        describe.put(
            globalObject,
            ZigString.static("todo"),
            JSC.NewFunction(globalObject, ZigString.static("todo"), 2, ThisDescribeScope.todo, false),
        );
        describe.put(
            globalObject,
            ZigString.static("if"),
            JSC.NewFunction(globalObject, ZigString.static("if"), 2, ThisDescribeScope.callIf, false),
        );
        describe.put(
            globalObject,
            ZigString.static("skipIf"),
            JSC.NewFunction(globalObject, ZigString.static("skipIf"), 2, ThisDescribeScope.skipIf, false),
        );
        describe.put(
            globalObject,
            ZigString.static("each"),
            JSC.NewFunction(globalObject, ZigString.static("each"), 2, ThisDescribeScope.each, false),
        );

        module.put(
            globalObject,
            ZigString.static("describe"),
            describe,
        );

        inline for (.{ "beforeAll", "beforeEach", "afterAll", "afterEach" }) |name| {
            const function = if (outside_of_test)
                JSC.NewFunction(globalObject, null, 1, globalHook(name), false)
            else
                JSC.NewRuntimeFunction(
                    globalObject,
                    ZigString.static(name),
                    1,
                    @field(DescribeScope, name),
                    false,
                    false,
                );
            module.put(globalObject, ZigString.static(name), function);
            function.ensureStillAlive();
        }

        module.put(
            globalObject,
            ZigString.static("expect"),
            Expect.getConstructor(globalObject),
        );

        createMockObjects(globalObject, module);

        return module;
    }

    fn createMockObjects(globalObject: *JSGlobalObject, module: JSC.JSValue) void {
        const setSystemTime = JSC.NewFunction(globalObject, ZigString.static("setSystemTime"), 0, JSMock__jsSetSystemTime, false);
        module.put(
            globalObject,
            ZigString.static("setSystemTime"),
            setSystemTime,
        );
        const useFakeTimers = JSC.NewFunction(globalObject, ZigString.static("useFakeTimers"), 0, JSMock__jsUseFakeTimers, false);
        const useRealTimers = JSC.NewFunction(globalObject, ZigString.static("useRealTimers"), 0, JSMock__jsUseRealTimers, false);

        const mockFn = JSC.NewFunction(globalObject, ZigString.static("fn"), 1, JSMock__jsMockFn, false);
        const spyOn = JSC.NewFunction(globalObject, ZigString.static("spyOn"), 2, JSMock__jsSpyOn, false);
        const restoreAllMocks = JSC.NewFunction(globalObject, ZigString.static("restoreAllMocks"), 2, JSMock__jsRestoreAllMocks, false);
        const clearAllMocks = JSC.NewFunction(globalObject, ZigString.static("clearAllMocks"), 2, JSMock__jsClearAllMocks, false);
        const mockModuleFn = JSC.NewFunction(globalObject, ZigString.static("module"), 2, JSMock__jsModuleMock, false);
        module.put(globalObject, ZigString.static("mock"), mockFn);
        mockFn.put(globalObject, ZigString.static("module"), mockModuleFn);
        mockFn.put(globalObject, ZigString.static("restore"), restoreAllMocks);

        const jest = JSValue.createEmptyObject(globalObject, 7);
        jest.put(globalObject, ZigString.static("fn"), mockFn);
        jest.put(globalObject, ZigString.static("spyOn"), spyOn);
        jest.put(globalObject, ZigString.static("restoreAllMocks"), restoreAllMocks);
        jest.put(globalObject, ZigString.static("clearAllMocks"), clearAllMocks);
        jest.put(
            globalObject,
            ZigString.static("setSystemTime"),
            setSystemTime,
        );
        jest.put(
            globalObject,
            ZigString.static("useFakeTimers"),
            useFakeTimers,
        );
        jest.put(
            globalObject,
            ZigString.static("useRealTimers"),
            useRealTimers,
        );
        jest.put(globalObject, ZigString.static("now"), JSC.NewFunction(globalObject, ZigString.static("now"), 0, JSMock__jsNow, false));

        module.put(globalObject, ZigString.static("jest"), jest);
        module.put(globalObject, ZigString.static("spyOn"), spyOn);
        module.put(
            globalObject,
            ZigString.static("expect"),
            Expect.getConstructor(globalObject),
        );

        const vi = JSValue.createEmptyObject(globalObject, 3);
        vi.put(globalObject, ZigString.static("fn"), mockFn);
        vi.put(globalObject, ZigString.static("spyOn"), spyOn);
        vi.put(globalObject, ZigString.static("module"), mockModuleFn);
        vi.put(globalObject, ZigString.static("restoreAllMocks"), restoreAllMocks);
        vi.put(globalObject, ZigString.static("clearAllMocks"), clearAllMocks);
        module.put(globalObject, ZigString.static("vi"), vi);
    }

    extern fn Bun__Jest__testPreloadObject(*JSC.JSGlobalObject) JSC.JSValue;
    extern fn Bun__Jest__testModuleObject(*JSC.JSGlobalObject) JSC.JSValue;
    extern fn JSMock__jsMockFn(*JSC.JSGlobalObject, *JSC.CallFrame) JSC.JSValue;
    extern fn JSMock__jsModuleMock(*JSC.JSGlobalObject, *JSC.CallFrame) JSC.JSValue;
    extern fn JSMock__jsNow(*JSC.JSGlobalObject, *JSC.CallFrame) JSC.JSValue;
    extern fn JSMock__jsSetSystemTime(*JSC.JSGlobalObject, *JSC.CallFrame) JSC.JSValue;
    extern fn JSMock__jsRestoreAllMocks(*JSC.JSGlobalObject, *JSC.CallFrame) JSC.JSValue;
    extern fn JSMock__jsClearAllMocks(*JSC.JSGlobalObject, *JSC.CallFrame) JSC.JSValue;
    extern fn JSMock__jsSpyOn(*JSC.JSGlobalObject, *JSC.CallFrame) JSC.JSValue;
    extern fn JSMock__jsUseFakeTimers(*JSC.JSGlobalObject, *JSC.CallFrame) JSC.JSValue;
    extern fn JSMock__jsUseRealTimers(*JSC.JSGlobalObject, *JSC.CallFrame) JSC.JSValue;

    pub fn call(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        const vm = globalObject.bunVM();
        if (vm.is_in_preload or runner == null) {
            return Bun__Jest__testPreloadObject(globalObject);
        }

        const arguments = callframe.arguments(2).slice();

        if (arguments.len < 1 or !arguments[0].isString()) {
            globalObject.throw("Bun.jest() expects a string filename", .{});
            return .zero;
        }
        var str = arguments[0].toSlice(globalObject, bun.default_allocator);
        defer str.deinit();
        const slice = str.slice();

        if (!std.fs.path.isAbsolute(slice)) {
            globalObject.throw("Bun.jest() expects an absolute file path, got '{s}'", .{slice});
            return .zero;
        }

        const filepath = Fs.FileSystem.instance.filename_store.append([]const u8, slice) catch unreachable;
        var scope = runner.?.getOrPutFile(filepath);
        scope.push();

        return Bun__Jest__testModuleObject(globalObject);
    }

    comptime {
        if (!JSC.is_bindgen) {
            @export(Bun__Jest__createTestModuleObject, .{ .name = "Bun__Jest__createTestModuleObject" });
            @export(Bun__Jest__createTestPreloadObject, .{ .name = "Bun__Jest__createTestPreloadObject" });
        }
    }
};

pub const TestScope = struct {
    label: string = "",
    parent: *DescribeScope,

    func: JSC.JSValue,
    func_arg: []JSC.JSValue,
    func_has_callback: bool = false,

    id: TestRunner.Test.ID = 0,
    promise: ?*JSInternalPromise = null,
    ran: bool = false,
    task: ?*TestRunnerTask = null,
    tag: Tag = .pass,
    snapshot_count: usize = 0,
    timeout_millis: u32 = 0,
    retry_count: u32 = 0, // retry, on fail
    repeat_count: u32 = 0, // retry, on pass or fail

    pub const Counter = struct {
        expected: u32 = 0,
        actual: u32 = 0,
    };

    pub fn call(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createScope(globalThis, callframe, "test()", true, .pass);
    }

    pub fn only(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createScope(globalThis, callframe, "test.only()", true, .only);
    }

    pub fn skip(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createScope(globalThis, callframe, "test.skip()", true, .skip);
    }

    pub fn todo(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createScope(globalThis, callframe, "test.todo()", true, .todo);
    }

    pub fn each(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createEach(globalThis, callframe, "test.each()", "each", true);
    }

    pub fn callIf(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createIfScope(globalThis, callframe, "test.if()", "if", TestScope, false);
    }

    pub fn skipIf(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createIfScope(globalThis, callframe, "test.skipIf()", "skipIf", TestScope, true);
    }

    pub fn onReject(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        debug("onReject", .{});
        const arguments = callframe.arguments(2);
        const err = arguments.ptr[0];
        globalThis.bunVM().onUnhandledError(globalThis, err);
        var task: *TestRunnerTask = arguments.ptr[1].asPromisePtr(TestRunnerTask);
        task.handleResult(.{ .fail = expect.active_test_expectation_counter.actual }, .promise);
        globalThis.bunVM().autoGarbageCollect();
        return JSValue.jsUndefined();
    }

    pub fn onResolve(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        debug("onResolve", .{});
        const arguments = callframe.arguments(2);
        var task: *TestRunnerTask = arguments.ptr[1].asPromisePtr(TestRunnerTask);
        task.handleResult(.{ .pass = expect.active_test_expectation_counter.actual }, .promise);
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
                if (err.isEmptyOrUndefinedOrNull()) {
                    debug("done()", .{});
                    task.handleResult(.{ .pass = expect.active_test_expectation_counter.actual }, .callback);
                } else {
                    debug("done(err)", .{});
                    globalThis.bunVM().onUnhandledError(globalThis, err);
                    task.handleResult(.{ .fail = expect.active_test_expectation_counter.actual }, .callback);
                }
            } else {
                debug("done()", .{});
                task.handleResult(.{ .pass = expect.active_test_expectation_counter.actual }, .callback);
            }
        }

        return JSValue.jsUndefined();
    }

    pub fn run(
        this: *TestScope,
        task: *TestRunnerTask,
    ) Result {
        if (comptime is_bindgen) return undefined;

        var vm = VirtualMachine.get();
        const func = this.func;
        defer {
            for (this.func_arg) |arg| {
                arg.unprotect();
            }
            func.unprotect();
            this.func = .zero;
            this.func_has_callback = false;
            vm.autoGarbageCollect();
        }
        JSC.markBinding(@src());
        debug("test({})", .{bun.fmt.QuotedFormatter{ .text = this.label }});

        var initial_value = JSValue.zero;
        if (test_elapsed_timer) |timer| {
            timer.reset();
            task.started_at = timer.started;
        }

        Jest.runner.?.setTimeout(
            this.timeout_millis,
            task.test_id,
        );

        if (this.func_has_callback) {
            const callback_func = JSC.NewFunctionWithData(
                vm.global,
                ZigString.static("done"),
                0,
                TestScope.onDone,
                false,
                task,
            );
            task.done_callback_state = .pending;
            this.func_arg[this.func_arg.len - 1] = callback_func;
        }

        initial_value = callJSFunctionForTestRunner(vm, vm.global, this.func, this.func_arg);

        if (initial_value.isAnyError()) {
            vm.onUnhandledError(vm.global, initial_value);

            if (this.tag == .todo) {
                return .{ .todo = {} };
            }

            return .{ .fail = expect.active_test_expectation_counter.actual };
        }

        if (initial_value.asAnyPromise()) |promise| {
            if (this.promise != null) {
                return .{ .pending = {} };
            }
            this.task = task;

            // TODO: not easy to coerce JSInternalPromise as JSValue,
            // so simply wait for completion for now.
            switch (promise) {
                .Internal => vm.waitForPromise(promise),
                else => {},
            }
            switch (promise.status(vm.global.vm())) {
                .Rejected => {
                    vm.onUnhandledError(vm.global, promise.result(vm.global.vm()));

                    if (this.tag == .todo) {
                        return .{ .todo = {} };
                    }

                    return .{ .fail = expect.active_test_expectation_counter.actual };
                },
                .Pending => {
                    task.promise_state = .pending;
                    switch (promise) {
                        .Normal => |p| {
                            _ = p.asValue(vm.global).then(vm.global, task, onResolve, onReject);
                            return .{ .pending = {} };
                        },
                        else => unreachable,
                    }
                },
                else => {
                    _ = promise.result(vm.global.vm());
                },
            }
        }

        if (this.func_has_callback) {
            return .{ .pending = {} };
        }

        if (expect.active_test_expectation_counter.expected > 0 and expect.active_test_expectation_counter.expected < expect.active_test_expectation_counter.actual) {
            Output.prettyErrorln("Test fail: {d} / {d} expectations\n (make this better!)", .{
                expect.active_test_expectation_counter.actual,
                expect.active_test_expectation_counter.expected,
            });
            return .{ .fail = expect.active_test_expectation_counter.actual };
        }

        return .{ .pass = expect.active_test_expectation_counter.actual };
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
    done: bool = false,
    skip_count: u32 = 0,
    tag: Tag = .pass,

    fn isWithinOnlyScope(this: *const DescribeScope) bool {
        if (this.tag == .only) return true;
        if (this.parent != null) return this.parent.?.isWithinOnlyScope();
        return false;
    }

    fn isWithinSkipScope(this: *const DescribeScope) bool {
        if (this.tag == .skip) return true;
        if (this.parent != null) return this.parent.?.isWithinSkipScope();
        return false;
    }

    fn isWithinTodoScope(this: *const DescribeScope) bool {
        if (this.tag == .todo) return true;
        if (this.parent != null) return this.parent.?.isWithinTodoScope();
        return false;
    }

    pub fn shouldEvaluateScope(this: *const DescribeScope) bool {
        if (this.tag == .skip or
            this.tag == .todo) return false;
        if (Jest.runner.?.only and this.tag == .only) return true;
        if (this.parent != null) return this.parent.?.shouldEvaluateScope();
        return true;
    }

    pub fn push(new: *DescribeScope) void {
        if (comptime is_bindgen) return;
        if (new.parent) |scope| {
            if (comptime Environment.allow_assert) {
                std.debug.assert(DescribeScope.active != new);
                std.debug.assert(scope == DescribeScope.active);
            }
        } else if (DescribeScope.active) |scope| {
            // calling Bun.jest() within (already active) module
            if (scope.parent != null) return;
        }
        DescribeScope.active = new;
    }

    pub fn pop(this: *DescribeScope) void {
        if (comptime is_bindgen) return;
        if (comptime Environment.allow_assert) std.debug.assert(DescribeScope.active == this);
        DescribeScope.active = this.parent;
    }

    pub const LifecycleHook = enum {
        beforeAll,
        beforeEach,
        afterEach,
        afterAll,
    };

    pub threadlocal var active: ?*DescribeScope = null;

    const CallbackFn = fn (
        *JSC.JSGlobalObject,
        *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue;

    fn createCallback(comptime hook: LifecycleHook) CallbackFn {
        return struct {
            pub fn run(
                globalThis: *JSC.JSGlobalObject,
                callframe: *JSC.CallFrame,
            ) callconv(.C) JSC.JSValue {
                const arguments = callframe.arguments(2);
                if (arguments.len < 1) {
                    globalThis.throwNotEnoughArguments("callback", 1, arguments.len);
                    return .zero;
                }

                const cb = arguments.ptr[0];
                if (!cb.isObject() or !cb.isCallable(globalThis.vm())) {
                    globalThis.throwInvalidArgumentType(@tagName(hook), "callback", "function");
                    return .zero;
                }

                cb.protect();
                @field(DescribeScope.active.?, @tagName(hook)).append(getAllocator(globalThis), cb) catch unreachable;
                return JSC.JSValue.jsBoolean(true);
            }
        }.run;
    }

    pub fn onDone(
        ctx: js.JSContextRef,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const function = callframe.callee();
        const args = callframe.arguments(1);
        defer ctx.bunVM().autoGarbageCollect();

        if (JSC.getFunctionData(function)) |data| {
            var scope = bun.cast(*DescribeScope, data);
            JSC.setFunctionData(function, null);
            if (args.len > 0) {
                const err = args.ptr[0];
                if (!err.isEmptyOrUndefinedOrNull()) {
                    ctx.bunVM().onUnhandledError(ctx.bunVM().global, err);
                }
            }
            scope.done = true;
        }

        return JSValue.jsUndefined();
    }

    pub const afterAll = createCallback(.afterAll);
    pub const afterEach = createCallback(.afterEach);
    pub const beforeAll = createCallback(.beforeAll);
    pub const beforeEach = createCallback(.beforeEach);

    pub fn execCallback(this: *DescribeScope, globalObject: *JSC.JSGlobalObject, comptime hook: LifecycleHook) ?JSValue {
        var hooks = &@field(this, @tagName(hook));
        defer {
            if (comptime hook == .beforeAll or hook == .afterAll) {
                hooks.clearAndFree(getAllocator(globalObject));
            }
        }

        for (hooks.items) |cb| {
            if (comptime Environment.allow_assert) {
                std.debug.assert(cb.isObject());
                std.debug.assert(cb.isCallable(globalObject.vm()));
            }
            defer {
                if (comptime hook == .beforeAll or hook == .afterAll) {
                    cb.unprotect();
                }
            }

            const vm = VirtualMachine.get();
            var result: JSC.JSValue = switch (cb.getLength(globalObject)) {
                0 => callJSFunctionForTestRunner(vm, globalObject, cb, &.{}),
                else => brk: {
                    this.done = false;
                    const done_func = JSC.NewFunctionWithData(
                        globalObject,
                        ZigString.static("done"),
                        0,
                        DescribeScope.onDone,
                        false,
                        this,
                    );
                    const result = callJSFunctionForTestRunner(vm, globalObject, cb, &.{done_func});
                    if (result.toError()) |err| {
                        return err;
                    }
                    vm.waitFor(&this.done);
                    break :brk result;
                },
            };
            if (result.asAnyPromise()) |promise| {
                if (promise.status(globalObject.vm()) == .Pending) {
                    result.protect();
                    vm.waitForPromise(promise);
                    result.unprotect();
                }

                result = promise.result(globalObject.vm());
            }

            if (result.isAnyError()) return result;
        }

        return null;
    }

    pub fn runGlobalCallbacks(globalThis: *JSC.JSGlobalObject, comptime hook: LifecycleHook) ?JSValue {
        // global callbacks
        var hooks = &@field(Jest.runner.?.global_callbacks, @tagName(hook));
        defer {
            if (comptime hook == .beforeAll or hook == .afterAll) {
                hooks.clearAndFree(getAllocator(globalThis));
            }
        }

        for (hooks.items) |cb| {
            if (comptime Environment.allow_assert) {
                std.debug.assert(cb.isObject());
                std.debug.assert(cb.isCallable(globalThis.vm()));
            }
            defer {
                if (comptime hook == .beforeAll or hook == .afterAll) {
                    cb.unprotect();
                }
            }

            const vm = VirtualMachine.get();
            // note: we do not support "done" callback in global hooks in the first release.
            var result: JSC.JSValue = callJSFunctionForTestRunner(vm, globalThis, cb, &.{});

            if (result.asAnyPromise()) |promise| {
                if (promise.status(globalThis.vm()) == .Pending) {
                    result.protect();
                    vm.waitForPromise(promise);
                    result.unprotect();
                }

                result = promise.result(globalThis.vm());
            }

            if (result.isAnyError()) return result;
        }

        return null;
    }

    fn runBeforeCallbacks(this: *DescribeScope, globalObject: *JSC.JSGlobalObject, comptime hook: LifecycleHook) ?JSValue {
        if (this.parent) |scope| {
            if (scope.runBeforeCallbacks(globalObject, hook)) |err| {
                return err;
            }
        }
        return this.execCallback(globalObject, hook);
    }

    pub fn runCallback(this: *DescribeScope, globalObject: *JSC.JSGlobalObject, comptime hook: LifecycleHook) ?JSValue {
        if (comptime hook == .afterAll or hook == .afterEach) {
            var parent: ?*DescribeScope = this;
            while (parent) |scope| {
                if (scope.execCallback(globalObject, hook)) |err| {
                    return err;
                }
                parent = scope.parent;
            }
        }

        if (runGlobalCallbacks(globalObject, hook)) |err| {
            return err;
        }

        if (comptime hook == .beforeAll or hook == .beforeEach) {
            if (this.runBeforeCallbacks(globalObject, hook)) |err| {
                return err;
            }
        }

        return null;
    }

    pub fn call(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createScope(globalThis, callframe, "describe()", false, .pass);
    }

    pub fn only(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createScope(globalThis, callframe, "describe.only()", false, .only);
    }

    pub fn skip(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createScope(globalThis, callframe, "describe.skip()", false, .skip);
    }

    pub fn todo(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createScope(globalThis, callframe, "describe.todo()", false, .todo);
    }

    pub fn each(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createEach(globalThis, callframe, "describe.each()", "each", false);
    }

    pub fn callIf(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createIfScope(globalThis, callframe, "describe.if()", "if", DescribeScope, false);
    }

    pub fn skipIf(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createIfScope(globalThis, callframe, "describe.skipIf()", "skipIf", DescribeScope, true);
    }

    pub fn run(this: *DescribeScope, globalObject: *JSC.JSGlobalObject, callback: JSC.JSValue, args: []const JSC.JSValue) JSC.JSValue {
        if (comptime is_bindgen) return undefined;
        callback.protect();
        defer callback.unprotect();
        this.push();
        defer this.pop();
        debug("describe({})", .{bun.fmt.QuotedFormatter{ .text = this.label }});

        if (callback == .zero) {
            this.runTests(globalObject);
            return .undefined;
        }

        {
            JSC.markBinding(@src());
            var result = callJSFunctionForTestRunner(VirtualMachine.get(), globalObject, callback, args);

            if (result.asAnyPromise()) |prom| {
                globalObject.bunVM().waitForPromise(prom);
                switch (prom.status(globalObject.ptr().vm())) {
                    JSPromise.Status.Fulfilled => {},
                    else => {
                        globalObject.bunVM().onUnhandledError(globalObject, prom.result(globalObject.ptr().vm()));
                        return .undefined;
                    },
                }
            } else if (result.toError()) |err| {
                globalObject.bunVM().onUnhandledError(globalObject, err);
                return .undefined;
            }
        }

        this.runTests(globalObject);
        return .undefined;
    }

    pub fn runTests(this: *DescribeScope, globalObject: *JSC.JSGlobalObject) void {
        // Step 1. Initialize the test block
        globalObject.clearTerminationException();

        const file = this.file_id;
        const allocator = getAllocator(globalObject);
        const tests: []TestScope = this.tests.items;
        const end = @as(TestRunner.Test.ID, @truncate(tests.len));
        this.pending_tests = std.DynamicBitSetUnmanaged.initFull(allocator, end) catch unreachable;

        // Step 2. Update the runner with the count of how many tests we have for this block
        if (end > 0) this.test_id_start = Jest.runner.?.addTestCount(end);

        const source: logger.Source = Jest.runner.?.files.items(.source)[file];

        var i: TestRunner.Test.ID = 0;

        if (this.shouldEvaluateScope()) {
            if (this.runCallback(globalObject, .beforeAll)) |err| {
                globalObject.bunVM().onUnhandledError(globalObject, err);
                while (i < end) {
                    Jest.runner.?.reportFailure(i + this.test_id_start, source.path.text, tests[i].label, 0, 0, this);
                    i += 1;
                }
                this.tests.clearAndFree(allocator);
                this.pending_tests.deinit(allocator);
                return;
            }
            if (end == 0) {
                var runner = allocator.create(TestRunnerTask) catch unreachable;
                runner.* = .{
                    .test_id = std.math.maxInt(TestRunner.Test.ID),
                    .describe = this,
                    .globalThis = globalObject,
                    .source_file_path = source.path.text,
                };
                runner.ref.ref(globalObject.bunVM());

                Jest.runner.?.enqueue(runner);
                return;
            }
        }

        while (i < end) : (i += 1) {
            var runner = allocator.create(TestRunnerTask) catch unreachable;
            runner.* = .{
                .test_id = i,
                .describe = this,
                .globalThis = globalObject,
                .source_file_path = source.path.text,
            };
            runner.ref.ref(globalObject.bunVM());

            Jest.runner.?.enqueue(runner);
        }
    }

    pub fn onTestComplete(this: *DescribeScope, globalThis: *JSC.JSGlobalObject, test_id: TestRunner.Test.ID, skipped: bool) void {
        // invalidate it
        this.current_test_id = std.math.maxInt(TestRunner.Test.ID);
        if (test_id != std.math.maxInt(TestRunner.Test.ID)) this.pending_tests.unset(test_id);

        if (!skipped) {
            if (this.runCallback(globalThis, .afterEach)) |err| {
                globalThis.bunVM().onUnhandledError(globalThis, err);
            }
        }

        if (this.pending_tests.findFirstSet() != null) {
            return;
        }

        if (this.shouldEvaluateScope()) {
            // Run the afterAll callbacks, in reverse order
            // unless there were no tests for this scope
            if (this.execCallback(globalThis, .afterAll)) |err| {
                globalThis.bunVM().onUnhandledError(globalThis, err);
            }
        }

        this.pending_tests.deinit(getAllocator(globalThis));
        this.tests.clearAndFree(getAllocator(globalThis));
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

};

pub fn wrapTestFunction(comptime name: []const u8, comptime func: DescribeScope.CallbackFn) DescribeScope.CallbackFn {
    return struct {
        pub fn wrapped(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
            if (Jest.runner == null) {
                globalThis.throw("Cannot use " ++ name ++ "() outside of the test runner. Run \"bun test\" to run tests.", .{});
                return .zero;
            }
            if (globalThis.bunVM().is_in_preload) {
                globalThis.throw("Cannot use " ++ name ++ "() outside of a test file.", .{});
                return .zero;
            }
            return @call(bun.callmod_inline, func, .{ globalThis, callframe });
        }
    }.wrapped;
}

/// This wrapped scope as well as the wrapped describe scope is used when you load `bun:test`
/// outside of
pub const WrappedTestScope = struct {
    pub const call = wrapTestFunction("test", TestScope.call);
    pub const only = wrapTestFunction("test", TestScope.only);
    pub const skip = wrapTestFunction("test", TestScope.skip);
    pub const todo = wrapTestFunction("test", TestScope.todo);
    pub const callIf = wrapTestFunction("test", TestScope.callIf);
    pub const skipIf = wrapTestFunction("test", TestScope.skipIf);
    pub const each = wrapTestFunction("test", TestScope.each);
};

pub const WrappedDescribeScope = struct {
    pub const call = wrapTestFunction("describe", DescribeScope.call);
    pub const only = wrapTestFunction("describe", DescribeScope.only);
    pub const skip = wrapTestFunction("describe", DescribeScope.skip);
    pub const todo = wrapTestFunction("describe", DescribeScope.todo);
    pub const callIf = wrapTestFunction("describe", DescribeScope.callIf);
    pub const skipIf = wrapTestFunction("describe", DescribeScope.skipIf);
    pub const each = wrapTestFunction("describe", DescribeScope.each);
};

pub const TestRunnerTask = struct {
    test_id: TestRunner.Test.ID,
    describe: *DescribeScope,
    globalThis: *JSC.JSGlobalObject,
    source_file_path: string = "",
    needs_before_each: bool = true,
    ref: JSC.Ref = JSC.Ref.init(),

    done_callback_state: AsyncState = .none,
    promise_state: AsyncState = .none,
    sync_state: AsyncState = .none,
    reported: bool = false,
    started_at: std.time.Instant = std.mem.zeroes(std.time.Instant),

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
            this.handleResult(.{ .fail = expect.active_test_expectation_counter.actual }, .unhandledRejection);
        }
    }

    pub fn run(this: *TestRunnerTask) bool {
        var describe = this.describe;
        var globalThis = this.globalThis;
        var jsc_vm = globalThis.bunVM();

        // reset the global state for each test
        // prior to the run
        expect.active_test_expectation_counter = .{};
        expect.is_expecting_assertions = false;
        expect.is_expecting_assertions_count = false;
        jsc_vm.last_reported_error_for_dedupe = .zero;

        const test_id = this.test_id;

        if (test_id == std.math.maxInt(TestRunner.Test.ID)) {
            describe.onTestComplete(globalThis, test_id, true);
            Jest.runner.?.runNextTest();
            this.deinit();
            return false;
        }

        var test_: TestScope = this.describe.tests.items[test_id];
        describe.current_test_id = test_id;

        if (test_.func == .zero or !describe.shouldEvaluateScope()) {
            const tag = if (!describe.shouldEvaluateScope()) describe.tag else test_.tag;
            switch (tag) {
                .todo => {
                    this.processTestResult(globalThis, .{ .todo = {} }, test_, test_id, describe);
                },
                .skip => {
                    this.processTestResult(globalThis, .{ .skip = {} }, test_, test_id, describe);
                },
                else => {},
            }
            this.deinit();
            return false;
        }

        jsc_vm.onUnhandledRejectionCtx = this;

        if (this.needs_before_each) {
            this.needs_before_each = false;
            const label = test_.label;

            if (this.describe.runCallback(globalThis, .beforeEach)) |err| {
                jsc_vm.onUnhandledError(globalThis, err);
                Jest.runner.?.reportFailure(test_id, this.source_file_path, label, 0, 0, this.describe);
                return false;
            }
        }

        this.sync_state = .pending;

        var result = TestScope.run(&test_, this);

        // rejected promises should fail the test
        if (result != .fail)
            globalThis.handleRejectedPromises();

        if (result == .pending and this.sync_state == .pending and (this.done_callback_state == .pending or this.promise_state == .pending)) {
            this.sync_state = .fulfilled;
            return true;
        }

        if (expect.is_expecting_assertions and expect.active_test_expectation_counter.actual == 0) {
            const fmt = comptime "<d>expect.hasAssertions()<r>\n\nExpected <green>at least one assertion<r> to be called but <red>received none<r>.\n";
            const error_value = if (Output.enable_ansi_colors)
                globalThis.createErrorInstance(Output.prettyFmt(fmt, true), .{})
            else
                globalThis.createErrorInstance(Output.prettyFmt(fmt, false), .{});

            globalThis.*.bunVM().runErrorHandler(error_value, null);
            result = .{ .fail = 0 };
        }

        if (expect.is_expecting_assertions_count and expect.active_test_expectation_counter.actual != expect.expected_assertions_number) {
            const fmt = comptime "<d>expect.assertions({})<r>\n\nExpected <green>{} assertion<r> to be called but <red>found {} assertions<r> instead.\n";
            const fmt_args = .{ expect.expected_assertions_number, expect.expected_assertions_number, expect.active_test_expectation_counter.actual };
            const error_value = if (Output.enable_ansi_colors)
                globalThis.createErrorInstance(Output.prettyFmt(fmt, true), fmt_args)
            else
                globalThis.createErrorInstance(Output.prettyFmt(fmt, false), fmt_args);

            globalThis.*.bunVM().runErrorHandler(error_value, null);
            result = .{ .fail = expect.active_test_expectation_counter.actual };
        }

        this.handleResult(result, .sync);

        if (result == .fail) {
            globalThis.handleRejectedPromises();
        }

        return false;
    }

    pub fn timeout(this: *TestRunnerTask) void {
        if (comptime Environment.allow_assert) std.debug.assert(!this.reported);

        this.ref.unref(this.globalThis.bunVM());
        this.globalThis.throwTerminationException();
        this.handleResult(.{ .fail = expect.active_test_expectation_counter.actual }, .timeout);
    }

    pub fn handleResult(this: *TestRunnerTask, result: Result, comptime from: @Type(.EnumLiteral)) void {
        switch (comptime from) {
            .promise => {
                if (comptime Environment.allow_assert) std.debug.assert(this.promise_state == .pending);
                this.promise_state = .fulfilled;

                if (this.done_callback_state == .pending and result == .pass) {
                    return;
                }
            },
            .callback => {
                if (comptime Environment.allow_assert) std.debug.assert(this.done_callback_state == .pending);
                this.done_callback_state = .fulfilled;

                if (this.promise_state == .pending and result == .pass) {
                    return;
                }
            },
            .sync => {
                if (comptime Environment.allow_assert) std.debug.assert(this.sync_state == .pending);
                this.sync_state = .fulfilled;
            },
            .timeout, .unhandledRejection => {},
            else => @compileError("Bad from"),
        }

        defer {
            if (this.reported and this.promise_state != .pending and this.sync_state != .pending and this.done_callback_state != .pending)
                this.deinit();
        }

        if (this.reported)
            return;

        this.reported = true;

        const test_id = this.test_id;
        const test_ = this.describe.tests.items[test_id];
        var describe = this.describe;
        describe.tests.items[test_id] = test_;

        if (comptime from == .timeout) {
            const err = this.globalThis.createErrorInstance("Test {} timed out after {d}ms", .{ bun.fmt.quote(test_.label), test_.timeout_millis });
            this.globalThis.bunVM().onUnhandledError(this.globalThis, err);
        }

        processTestResult(this, this.globalThis, result, test_, test_id, describe);
    }

    fn processTestResult(this: *TestRunnerTask, globalThis: *JSC.JSGlobalObject, result: Result, test_: TestScope, test_id: u32, describe: *DescribeScope) void {
        switch (result.forceTODO(test_.tag == .todo)) {
            .pass => |count| Jest.runner.?.reportPass(
                test_id,
                this.source_file_path,
                test_.label,
                count,
                if (test_elapsed_timer) |timer|
                    timer.read()
                else
                    0,
                describe,
            ),
            .fail => |count| Jest.runner.?.reportFailure(
                test_id,
                this.source_file_path,
                test_.label,
                count,
                if (test_elapsed_timer) |timer|
                    timer.read()
                else
                    0,
                describe,
            ),
            .skip => Jest.runner.?.reportSkip(test_id, this.source_file_path, test_.label, describe),
            .todo => Jest.runner.?.reportTodo(test_id, this.source_file_path, test_.label, describe),
            .fail_because_todo_passed => |count| {
                Output.prettyErrorln("  <d>^<r> <red>this test is marked as todo but passes.<r> <d>Remove `.todo` or check that test is correct.<r>", .{});
                Jest.runner.?.reportFailure(
                    test_id,
                    this.source_file_path,
                    test_.label,
                    count,
                    if (test_elapsed_timer) |timer|
                        timer.read()
                    else
                        0,
                    describe,
                );
            },
            .pending => @panic("Unexpected pending test"),
        }
        describe.onTestComplete(globalThis, test_id, result == .skip);
        Jest.runner.?.runNextTest();
    }

    fn deinit(this: *TestRunnerTask) void {
        const vm = JSC.VirtualMachine.get();
        if (vm.onUnhandledRejectionCtx) |ctx| {
            if (ctx == @as(*anyopaque, @ptrCast(this))) {
                vm.onUnhandledRejectionCtx = null;
            }
        }

        this.ref.unref(vm);

        // there is a double free here involving async before/after callbacks
        //
        // Fortunately:
        //
        // - TestRunnerTask doesn't use much memory.
        // - we don't have watch mode yet.
        //
        // TODO: fix this bug
        // default_allocator.destroy(this);
    }
};

pub const Result = union(TestRunner.Test.Status) {
    pending: void,
    pass: u32, // assertion count
    fail: u32,
    skip: void,
    todo: void,
    fail_because_todo_passed: u32,

    pub fn forceTODO(this: Result, is_todo: bool) Result {
        if (is_todo and this == .pass)
            return .{ .fail_because_todo_passed = this.pass };

        if (is_todo and this == .fail) {
            return .{ .todo = {} };
        }
        return this;
    }
};

fn appendParentLabel(
    buffer: *bun.MutableString,
    parent: *DescribeScope,
) !void {
    if (parent.parent) |par| {
        try appendParentLabel(buffer, par);
    }
    try buffer.append(parent.label);
    try buffer.append(" ");
}

inline fn createScope(
    globalThis: *JSGlobalObject,
    callframe: *CallFrame,
    comptime signature: string,
    comptime is_test: bool,
    comptime tag: Tag,
) JSValue {
    const this = callframe.this();
    const arguments = callframe.arguments(3);
    const args = arguments.slice();

    if (args.len == 0) {
        globalThis.throwPretty("{s} expects a description or function", .{signature});
        return .zero;
    }

    var description = args[0];
    var function = if (args.len > 1) args[1] else .zero;
    var options = if (args.len > 2) args[2] else .zero;

    if (description.isEmptyOrUndefinedOrNull() or !description.isString()) {
        function = description;
        description = .zero;
    }

    if (function.isEmptyOrUndefinedOrNull() or !function.isCell() or !function.isCallable(globalThis.vm())) {
        if (tag != .todo) {
            globalThis.throwPretty("{s} expects a function", .{signature});
            return .zero;
        }
    }

    var timeout_ms: u32 = Jest.runner.?.default_timeout_ms;
    if (options.isNumber()) {
        timeout_ms = @as(u32, @intCast(@max(args[2].coerce(i32, globalThis), 0)));
    } else if (options.isObject()) {
        if (options.get(globalThis, "timeout")) |timeout| {
            if (!timeout.isNumber()) {
                globalThis.throwPretty("{s} expects timeout to be a number", .{signature});
                return .zero;
            }
            timeout_ms = @as(u32, @intCast(@max(timeout.coerce(i32, globalThis), 0)));
        }
        if (options.get(globalThis, "retry")) |retries| {
            if (!retries.isNumber()) {
                globalThis.throwPretty("{s} expects retry to be a number", .{signature});
                return .zero;
            }
            // TODO: retry_count = @intCast(u32, @max(retries.coerce(i32, globalThis), 0));
        }
        if (options.get(globalThis, "repeats")) |repeats| {
            if (!repeats.isNumber()) {
                globalThis.throwPretty("{s} expects repeats to be a number", .{signature});
                return .zero;
            }
            // TODO: repeat_count = @intCast(u32, @max(repeats.coerce(i32, globalThis), 0));
        }
    } else if (!options.isEmptyOrUndefinedOrNull()) {
        globalThis.throwPretty("{s} expects options to be a number or object", .{signature});
        return .zero;
    }

    const parent = DescribeScope.active.?;
    const allocator = getAllocator(globalThis);
    const label = if (description == .zero)
        ""
    else
        (description.toSlice(globalThis, allocator).cloneIfNeeded(allocator) catch unreachable).slice();

    var tag_to_use = tag;

    if (tag_to_use == .only or parent.tag == .only) {
        Jest.runner.?.setOnly();
        tag_to_use = .only;
    } else if (is_test and Jest.runner.?.only and parent.tag != .only) {
        return .zero;
    }

    var is_skip = tag == .skip or
        (tag == .todo and (function == .zero or !Jest.runner.?.run_todo)) or
        (tag != .only and Jest.runner.?.only and parent.tag != .only);

    if (is_test) {
        if (!is_skip) {
            if (Jest.runner.?.filter_regex) |regex| {
                var buffer: bun.MutableString = Jest.runner.?.filter_buffer;
                buffer.reset();
                appendParentLabel(&buffer, parent) catch @panic("Bun ran out of memory while filtering tests");
                buffer.append(label) catch unreachable;
                const str = bun.String.fromBytes(buffer.toOwnedSliceLeaky());
                is_skip = !regex.matches(str);
                if (is_skip) {
                    tag_to_use = .skip;
                }
            }
        }

        if (is_skip) {
            parent.skip_count += 1;
            function.unprotect();
        } else {
            function.protect();
        }

        const func_params_length = function.getLength(globalThis);
        var arg_size: usize = 0;
        var has_callback = false;
        if (func_params_length > 0) {
            has_callback = true;
            arg_size = 1;
        }
        const function_args = allocator.alloc(JSC.JSValue, arg_size) catch unreachable;

        parent.tests.append(allocator, TestScope{
            .label = label,
            .parent = parent,
            .tag = tag_to_use,
            .func = if (is_skip) .zero else function,
            .func_arg = function_args,
            .func_has_callback = has_callback,
            .timeout_millis = timeout_ms,
        }) catch unreachable;

        if (test_elapsed_timer == null) create_timer: {
            const timer = allocator.create(std.time.Timer) catch unreachable;
            timer.* = std.time.Timer.start() catch break :create_timer;
            test_elapsed_timer = timer;
        }
    } else {
        var scope = allocator.create(DescribeScope) catch unreachable;
        scope.* = .{
            .label = label,
            .parent = parent,
            .file_id = parent.file_id,
            .tag = tag_to_use,
        };

        return scope.run(globalThis, function, &.{});
    }

    return this;
}

inline fn createIfScope(
    globalThis: *JSGlobalObject,
    callframe: *CallFrame,
    comptime property: string,
    comptime signature: string,
    comptime Scope: type,
    comptime is_skip: bool,
) JSValue {
    const arguments = callframe.arguments(1);
    const args = arguments.slice();

    if (args.len == 0) {
        globalThis.throwPretty("{s} expects a condition", .{signature});
        return .zero;
    }

    const name = ZigString.static(property);
    const value = args[0].toBooleanSlow(globalThis);
    const skip = if (is_skip) Scope.skip else Scope.call;
    const call = if (is_skip) Scope.call else Scope.skip;

    if (value) {
        return JSC.NewFunction(globalThis, name, 2, skip, false);
    }

    return JSC.NewFunction(globalThis, name, 2, call, false);
}

fn consumeArg(
    globalThis: *JSC.JSGlobalObject,
    should_write: bool,
    str_idx: *usize,
    args_idx: *usize,
    array_list: *std.ArrayListUnmanaged(u8),
    arg: *const JSC.JSValue,
    fallback: []const u8,
) !void {
    const allocator = getAllocator(globalThis);
    if (should_write) {
        const owned_slice = arg.toSliceOrNull(globalThis) orelse return error.Failed;
        defer owned_slice.deinit();
        try array_list.appendSlice(allocator, owned_slice.slice());
    } else {
        try array_list.appendSlice(allocator, fallback);
    }
    str_idx.* += 1;
    args_idx.* += 1;
}

// Generate test label by positionally injecting parameters with printf formatting
fn formatLabel(globalThis: *JSC.JSGlobalObject, label: string, function_args: []JSC.JSValue, test_idx: usize) !string {
    const allocator = getAllocator(globalThis);
    var idx: usize = 0;
    var args_idx: usize = 0;
    var list = try std.ArrayListUnmanaged(u8).initCapacity(allocator, label.len);

    while (idx < label.len) {
        const char = label[idx];
        if (char == '%' and (idx + 1 < label.len) and !(args_idx >= function_args.len)) {
            const current_arg = function_args[args_idx];

            switch (label[idx + 1]) {
                's' => {
                    try consumeArg(globalThis, !current_arg.isEmpty() and current_arg.jsType().isString(), &idx, &args_idx, &list, &current_arg, "%s");
                },
                'i' => {
                    try consumeArg(globalThis, current_arg.isAnyInt(), &idx, &args_idx, &list, &current_arg, "%i");
                },
                'd' => {
                    try consumeArg(globalThis, current_arg.isNumber(), &idx, &args_idx, &list, &current_arg, "%d");
                },
                'f' => {
                    try consumeArg(globalThis, current_arg.isNumber(), &idx, &args_idx, &list, &current_arg, "%f");
                },
                'j', 'o' => {
                    var str = bun.String.empty;
                    defer str.deref();
                    current_arg.jsonStringify(globalThis, 0, &str);
                    const owned_slice = try str.toOwnedSlice(allocator);
                    defer allocator.free(owned_slice);
                    try list.appendSlice(allocator, owned_slice);
                    idx += 1;
                    args_idx += 1;
                },
                'p' => {
                    var formatter = JSC.ConsoleObject.Formatter{
                        .globalThis = globalThis,
                        .quote_strings = true,
                    };
                    const value_fmt = current_arg.toFmt(globalThis, &formatter);
                    const test_index_str = try std.fmt.allocPrint(allocator, "{any}", .{value_fmt});
                    defer allocator.free(test_index_str);
                    try list.appendSlice(allocator, test_index_str);
                    idx += 1;
                    args_idx += 1;
                },
                '#' => {
                    const test_index_str = try std.fmt.allocPrint(allocator, "{d}", .{test_idx});
                    defer allocator.free(test_index_str);
                    try list.appendSlice(allocator, test_index_str);
                    idx += 1;
                },
                '%' => {
                    try list.append(allocator, '%');
                    idx += 1;
                },
                else => {
                    // ignore unrecognized fmt
                },
            }
        } else try list.append(allocator, char);
        idx += 1;
    }

    return list.toOwnedSlice(allocator);
}

pub const EachData = struct { strong: JSC.Strong, is_test: bool };

fn eachBind(
    globalThis: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    const signature = "eachBind";
    const callee = callframe.callee();
    const arguments = callframe.arguments(3);
    const args = arguments.slice();

    if (args.len < 2) {
        globalThis.throwPretty("{s} a description and callback function", .{signature});
        return .zero;
    }

    var description = args[0];
    var function = args[1];
    var options = if (args.len > 2) args[2] else .zero;

    if (function.isEmptyOrUndefinedOrNull() or !function.isCell() or !function.isCallable(globalThis.vm())) {
        globalThis.throwPretty("{s} expects a function", .{signature});
        return .zero;
    }

    var timeout_ms: u32 = Jest.runner.?.default_timeout_ms;
    if (options.isNumber()) {
        timeout_ms = @as(u32, @intCast(@max(args[2].coerce(i32, globalThis), 0)));
    } else if (options.isObject()) {
        if (options.get(globalThis, "timeout")) |timeout| {
            if (!timeout.isNumber()) {
                globalThis.throwPretty("{s} expects timeout to be a number", .{signature});
                return .zero;
            }
            timeout_ms = @as(u32, @intCast(@max(timeout.coerce(i32, globalThis), 0)));
        }
        if (options.get(globalThis, "retry")) |retries| {
            if (!retries.isNumber()) {
                globalThis.throwPretty("{s} expects retry to be a number", .{signature});
                return .zero;
            }
            // TODO: retry_count = @intCast(u32, @max(retries.coerce(i32, globalThis), 0));
        }
        if (options.get(globalThis, "repeats")) |repeats| {
            if (!repeats.isNumber()) {
                globalThis.throwPretty("{s} expects repeats to be a number", .{signature});
                return .zero;
            }
            // TODO: repeat_count = @intCast(u32, @max(repeats.coerce(i32, globalThis), 0));
        }
    } else if (!options.isEmptyOrUndefinedOrNull()) {
        globalThis.throwPretty("{s} expects options to be a number or object", .{signature});
        return .zero;
    }

    const parent = DescribeScope.active.?;

    if (JSC.getFunctionData(callee)) |data| {
        const allocator = getAllocator(globalThis);
        const each_data = bun.cast(*EachData, data);
        JSC.setFunctionData(callee, null);
        const array = each_data.*.strong.get() orelse return .zero;
        defer {
            each_data.*.strong.deinit();
            allocator.destroy(each_data);
        }

        if (array.isUndefinedOrNull() or !array.jsType().isArray()) {
            return .zero;
        }

        var iter = array.arrayIterator(globalThis);

        var test_idx: usize = 0;
        while (iter.next()) |item| {
            const func_params_length = function.getLength(globalThis);
            const item_is_array = !item.isEmptyOrUndefinedOrNull() and item.jsType().isArray();
            var arg_size: usize = 1;

            if (item_is_array) {
                arg_size = item.getLength(globalThis);
            }

            // add room for callback function
            const has_callback_function: bool = (func_params_length > arg_size) and each_data.is_test;
            if (has_callback_function) {
                arg_size += 1;
            }

            var function_args = allocator.alloc(JSC.JSValue, arg_size) catch @panic("can't create function_args");
            var idx: u32 = 0;

            if (item_is_array) {
                // Spread array as args
                var item_iter = item.arrayIterator(globalThis);
                while (item_iter.next()) |array_item| {
                    if (array_item == .zero) {
                        allocator.free(function_args);
                        break;
                    }
                    array_item.protect();
                    function_args[idx] = array_item;
                    idx += 1;
                }
            } else {
                item.protect();
                function_args[0] = item;
            }

            const label = if (description.isEmptyOrUndefinedOrNull())
                ""
            else
                (description.toSlice(globalThis, allocator).cloneIfNeeded(allocator) catch unreachable).slice();
            const formattedLabel = formatLabel(globalThis, label, function_args, test_idx) catch return .zero;

            const tag = parent.tag;

            if (tag == .only) {
                Jest.runner.?.setOnly();
            }

            var is_skip = tag == .skip or
                (tag == .todo and (function == .zero or !Jest.runner.?.run_todo)) or
                (tag != .only and Jest.runner.?.only and parent.tag != .only);

            if (Jest.runner.?.filter_regex) |regex| {
                var buffer: bun.MutableString = Jest.runner.?.filter_buffer;
                buffer.reset();
                appendParentLabel(&buffer, parent) catch @panic("Bun ran out of memory while filtering tests");
                buffer.append(formattedLabel) catch unreachable;
                const str = bun.String.fromBytes(buffer.toOwnedSliceLeaky());
                is_skip = !regex.matches(str);
            }

            if (is_skip) {
                parent.skip_count += 1;
                function.unprotect();
            } else if (each_data.is_test) {
                if (Jest.runner.?.only and tag != .only) {
                    return .zero;
                } else {
                    function.protect();
                    parent.tests.append(allocator, TestScope{
                        .label = formattedLabel,
                        .parent = parent,
                        .tag = tag,
                        .func = function,
                        .func_arg = function_args,
                        .func_has_callback = has_callback_function,
                        .timeout_millis = timeout_ms,
                    }) catch unreachable;

                    if (test_elapsed_timer == null) create_timer: {
                        const timer = allocator.create(std.time.Timer) catch unreachable;
                        timer.* = std.time.Timer.start() catch break :create_timer;
                        test_elapsed_timer = timer;
                    }
                }
            } else {
                var scope = allocator.create(DescribeScope) catch unreachable;
                scope.* = .{
                    .label = formattedLabel,
                    .parent = parent,
                    .file_id = parent.file_id,
                    .tag = tag,
                };

                const ret = scope.run(globalThis, function, function_args);
                _ = ret;
                allocator.free(function_args);
            }
            test_idx += 1;
        }
    }

    return .zero;
}

inline fn createEach(
    globalThis: *JSGlobalObject,
    callframe: *CallFrame,
    comptime property: string,
    comptime signature: string,
    comptime is_test: bool,
) JSValue {
    const arguments = callframe.arguments(1);
    const args = arguments.slice();

    if (args.len == 0) {
        globalThis.throwPretty("{s} expects an array", .{signature});
        return .zero;
    }

    var array = args[0];
    if (array.isEmpty() or !array.jsType().isArray()) {
        globalThis.throwPretty("{s} expects an array", .{signature});
        return .zero;
    }

    const allocator = getAllocator(globalThis);
    const name = ZigString.static(property);
    const strong = JSC.Strong.create(array, globalThis);
    const each_data = allocator.create(EachData) catch unreachable;
    each_data.* = EachData{
        .strong = strong,
        .is_test = is_test,
    };

    return JSC.NewFunctionWithData(globalThis, name, 3, eachBind, true, each_data);
}

fn callJSFunctionForTestRunner(vm: *JSC.VirtualMachine, globalObject: *JSC.JSGlobalObject, function: JSC.JSValue, args: []const JSC.JSValue) JSC.JSValue {
    vm.eventLoop().enter();
    defer {
        vm.eventLoop().exit();
    }

    globalObject.clearTerminationException();
    const result = function.call(globalObject, args);
    result.ensureStillAlive();

    return result;
}
