const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;

const Snapshots = @import("./snapshot.zig").Snapshots;
const expect = @import("./expect.zig");
const Counter = expect.Counter;
const Expect = expect.Expect;

const JSC = bun.JSC;

const logger = bun.logger;

const ObjectPool = @import("../../pool.zig").ObjectPool;

const Output = bun.Output;
const MutableString = bun.MutableString;
const string = bun.string;
const default_allocator = bun.default_allocator;
const RegularExpression = bun.RegularExpression;

const ZigString = JSC.ZigString;
const JSInternalPromise = JSC.JSInternalPromise;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CallFrame = JSC.CallFrame;

const VirtualMachine = JSC.VirtualMachine;
const Fs = bun.fs;

const ArrayIdentityContext = bun.ArrayIdentityContext;

pub const Tag = enum(u3) {
    pass,
    fail,
    only,
    skip,
    todo,
};
const debug = Output.scoped(.jest, false);
var max_test_id_for_debugger: u32 = 0;
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

    default_timeout_ms: u32,

    // from `setDefaultTimeout() or jest.setTimeout()`
    default_timeout_override: u32 = std.math.maxInt(u32),

    event_loop_timer: bun.api.Timer.EventLoopTimer = .{
        .next = .{},
        .tag = .TestRunner,
    },
    active_test_for_timeout: ?TestRunner.Test.ID = null,
    test_options: *const bun.CLI.Command.TestOptions = undefined,

    global_callbacks: struct {
        beforeAll: std.ArrayListUnmanaged(JSValue) = .{},
        beforeEach: std.ArrayListUnmanaged(JSValue) = .{},
        afterEach: std.ArrayListUnmanaged(JSValue) = .{},
        afterAll: std.ArrayListUnmanaged(JSValue) = .{},
    } = .{},

    // Used for --test-name-pattern to reduce allocations
    filter_regex: ?*RegularExpression,
    filter_buffer: MutableString,

    unhandled_errors_between_tests: u32 = 0,

    pub const Drainer = JSC.AnyTask.New(TestRunner, drain);

    pub fn onTestTimeout(this: *TestRunner, now: *const bun.timespec, vm: *VirtualMachine) void {
        _ = vm; // autofix
        this.event_loop_timer.state = .FIRED;

        if (this.pending_test) |pending_test| {
            if (!pending_test.reported and (this.active_test_for_timeout orelse return) == pending_test.test_id) {
                pending_test.timeout(now);
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
            this.scheduleTimeout(milliseconds);
        }
    }

    pub fn scheduleTimeout(this: *TestRunner, milliseconds: u32) void {
        const then = bun.timespec.msFromNow(@intCast(milliseconds));
        const vm = JSC.VirtualMachine.get();

        this.event_loop_timer.tag = .TestRunner;
        if (this.event_loop_timer.state == .ACTIVE) {
            vm.timer.remove(&this.event_loop_timer);
        }

        this.event_loop_timer.next = then;
        vm.timer.insert(&this.event_loop_timer);
    }

    pub fn enqueue(this: *TestRunner, task: *TestRunnerTask) void {
        this.queue.writeItem(task) catch unreachable;
    }

    pub fn runNextTest(this: *TestRunner) void {
        this.has_pending_tests = false;
        this.pending_test = null;

        const vm = JSC.VirtualMachine.get();
        vm.auto_killer.clear();
        vm.auto_killer.disable();

        // disable idling
        vm.wakeup();
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
        pub const null_id: ID = std.math.maxInt(Test.ID);
        pub const List = std.MultiArrayList(Test);

        pub const Status = enum(u4) {
            pending,
            pass,
            fail,
            skip,
            todo,
            /// A test marked as `.failing()` actually passed
            fail_because_failing_test_passed,
            fail_because_todo_passed,
            fail_because_expected_has_assertions,
            fail_because_expected_assertion_count,
        };
    };
};

pub const Jest = struct {
    pub var runner: ?*TestRunner = null;

    fn globalHook(comptime name: string) JSC.JSHostFnZig {
        return struct {
            pub fn appendGlobalFunctionCallback(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
                const the_runner = runner orelse {
                    return globalThis.throw("Cannot use " ++ name ++ "() outside of the test runner. Run \"bun test\" to run tests.", .{});
                };

                const arguments = callframe.arguments_old(2);
                if (arguments.len < 1) {
                    return globalThis.throwNotEnoughArguments("callback", 1, arguments.len);
                }

                const function = arguments.ptr[0];
                if (function.isEmptyOrUndefinedOrNull() or !function.isCallable()) {
                    return globalThis.throwInvalidArgumentType(name, "callback", "function");
                }

                if (try function.getLength(globalThis) > 0) {
                    return globalThis.throw("done() callback is not implemented in global hooks yet. Please make your function take no arguments", .{});
                }

                function.protect();
                @field(the_runner.global_callbacks, name).append(bun.default_allocator, function) catch unreachable;
                return .js_undefined;
            }
        }.appendGlobalFunctionCallback;
    }

    pub fn Bun__Jest__createTestModuleObject(globalObject: *JSGlobalObject) callconv(.C) JSValue {
        return createTestModule(globalObject, false);
    }

    pub fn Bun__Jest__createTestPreloadObject(globalObject: *JSGlobalObject) callconv(.C) JSValue {
        return createTestModule(globalObject, true);
    }

    pub fn createTestModule(globalObject: *JSGlobalObject, comptime outside_of_test: bool) JSValue {
        const ThisTestScope, const ThisDescribeScope = if (outside_of_test)
            .{ WrappedTestScope, WrappedDescribeScope }
        else
            .{ TestScope, DescribeScope };

        const module = JSValue.createEmptyObject(globalObject, 14);

        const test_fn = JSC.host_fn.NewFunction(globalObject, ZigString.static("test"), 2, ThisTestScope.call, false);
        module.put(
            globalObject,
            ZigString.static("test"),
            test_fn,
        );

        inline for (.{ "only", "skip", "todo", "failing", "skipIf", "todoIf", "each" }) |method_name| {
            const name = ZigString.static(method_name);
            test_fn.put(
                globalObject,
                name,
                JSC.host_fn.NewFunction(globalObject, name, 2, @field(ThisTestScope, method_name), false),
            );
        }

        test_fn.put(
            globalObject,
            ZigString.static("if"),
            JSC.host_fn.NewFunction(globalObject, ZigString.static("if"), 2, ThisTestScope.callIf, false),
        );

        module.put(
            globalObject,
            ZigString.static("it"),
            test_fn,
        );
        const describe = JSC.host_fn.NewFunction(globalObject, ZigString.static("describe"), 2, ThisDescribeScope.call, false);
        inline for (.{
            "only",
            "skip",
            "todo",
            "skipIf",
            "todoIf",
            "each",
        }) |method_name| {
            const name = ZigString.static(method_name);
            describe.put(
                globalObject,
                name,
                JSC.host_fn.NewFunction(globalObject, name, 2, @field(ThisDescribeScope, method_name), false),
            );
        }
        describe.put(
            globalObject,
            ZigString.static("if"),
            JSC.host_fn.NewFunction(globalObject, ZigString.static("if"), 2, ThisDescribeScope.callIf, false),
        );

        module.put(
            globalObject,
            ZigString.static("describe"),
            describe,
        );

        inline for (.{ "beforeAll", "beforeEach", "afterAll", "afterEach" }) |name| {
            const function = if (outside_of_test)
                JSC.host_fn.NewFunction(globalObject, null, 1, globalHook(name), false)
            else
                JSC.host_fn.NewFunction(
                    globalObject,
                    ZigString.static(name),
                    1,
                    @field(DescribeScope, name),
                    false,
                );
            module.put(globalObject, ZigString.static(name), function);
            function.ensureStillAlive();
        }

        module.put(
            globalObject,
            ZigString.static("setDefaultTimeout"),
            JSC.host_fn.NewFunction(globalObject, ZigString.static("setDefaultTimeout"), 1, jsSetDefaultTimeout, false),
        );

        module.put(
            globalObject,
            ZigString.static("expect"),
            Expect.js.getConstructor(globalObject),
        );

        createMockObjects(globalObject, module);

        return module;
    }

    fn createMockObjects(globalObject: *JSGlobalObject, module: JSValue) void {
        const setSystemTime = JSC.host_fn.NewFunction(globalObject, ZigString.static("setSystemTime"), 0, JSMock__jsSetSystemTime, false);
        module.put(
            globalObject,
            ZigString.static("setSystemTime"),
            setSystemTime,
        );
        const useFakeTimers = JSC.host_fn.NewFunction(globalObject, ZigString.static("useFakeTimers"), 0, JSMock__jsUseFakeTimers, false);
        const useRealTimers = JSC.host_fn.NewFunction(globalObject, ZigString.static("useRealTimers"), 0, JSMock__jsUseRealTimers, false);

        const mockFn = JSC.host_fn.NewFunction(globalObject, ZigString.static("fn"), 1, JSMock__jsMockFn, false);
        const spyOn = JSC.host_fn.NewFunction(globalObject, ZigString.static("spyOn"), 2, JSMock__jsSpyOn, false);
        const restoreAllMocks = JSC.host_fn.NewFunction(globalObject, ZigString.static("restoreAllMocks"), 2, JSMock__jsRestoreAllMocks, false);
        const clearAllMocks = JSC.host_fn.NewFunction(globalObject, ZigString.static("clearAllMocks"), 2, JSMock__jsClearAllMocks, false);
        const mockModuleFn = JSC.host_fn.NewFunction(globalObject, ZigString.static("module"), 2, JSMock__jsModuleMock, false);
        module.put(globalObject, ZigString.static("mock"), mockFn);
        mockFn.put(globalObject, ZigString.static("module"), mockModuleFn);
        mockFn.put(globalObject, ZigString.static("restore"), restoreAllMocks);

        const jest = JSValue.createEmptyObject(globalObject, 8);
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
        jest.put(globalObject, ZigString.static("now"), JSC.host_fn.NewFunction(globalObject, ZigString.static("now"), 0, JSMock__jsNow, false));
        jest.put(globalObject, ZigString.static("setTimeout"), JSC.host_fn.NewFunction(globalObject, ZigString.static("setTimeout"), 1, jsSetDefaultTimeout, false));

        module.put(globalObject, ZigString.static("jest"), jest);
        module.put(globalObject, ZigString.static("spyOn"), spyOn);
        module.put(
            globalObject,
            ZigString.static("expect"),
            Expect.js.getConstructor(globalObject),
        );

        const vi = JSValue.createEmptyObject(globalObject, 3);
        vi.put(globalObject, ZigString.static("fn"), mockFn);
        vi.put(globalObject, ZigString.static("spyOn"), spyOn);
        vi.put(globalObject, ZigString.static("module"), mockModuleFn);
        vi.put(globalObject, ZigString.static("restoreAllMocks"), restoreAllMocks);
        vi.put(globalObject, ZigString.static("clearAllMocks"), clearAllMocks);
        module.put(globalObject, ZigString.static("vi"), vi);
    }

    extern fn Bun__Jest__testPreloadObject(*JSGlobalObject) JSValue;
    extern fn Bun__Jest__testModuleObject(*JSGlobalObject) JSValue;
    extern fn JSMock__jsMockFn(*JSGlobalObject, *CallFrame) callconv(JSC.conv) JSValue;
    extern fn JSMock__jsModuleMock(*JSGlobalObject, *CallFrame) callconv(JSC.conv) JSValue;
    extern fn JSMock__jsNow(*JSGlobalObject, *CallFrame) callconv(JSC.conv) JSValue;
    extern fn JSMock__jsSetSystemTime(*JSGlobalObject, *CallFrame) callconv(JSC.conv) JSValue;
    extern fn JSMock__jsRestoreAllMocks(*JSGlobalObject, *CallFrame) callconv(JSC.conv) JSValue;
    extern fn JSMock__jsClearAllMocks(*JSGlobalObject, *CallFrame) callconv(JSC.conv) JSValue;
    extern fn JSMock__jsSpyOn(*JSGlobalObject, *CallFrame) callconv(JSC.conv) JSValue;
    extern fn JSMock__jsUseFakeTimers(*JSGlobalObject, *CallFrame) callconv(JSC.conv) JSValue;
    extern fn JSMock__jsUseRealTimers(*JSGlobalObject, *CallFrame) callconv(JSC.conv) JSValue;

    pub fn call(
        globalObject: *JSGlobalObject,
        callframe: *CallFrame,
    ) bun.JSError!JSValue {
        const vm = globalObject.bunVM();
        if (vm.is_in_preload or runner == null) {
            return Bun__Jest__testPreloadObject(globalObject);
        }

        const arguments = callframe.arguments_old(2).slice();

        if (arguments.len < 1 or !arguments[0].isString()) {
            return globalObject.throw("Bun.jest() expects a string filename", .{});
        }
        var str = try arguments[0].toSlice(globalObject, bun.default_allocator);
        defer str.deinit();
        const slice = str.slice();

        if (!std.fs.path.isAbsolute(slice)) {
            return globalObject.throw("Bun.jest() expects an absolute file path, got '{s}'", .{slice});
        }

        const filepath = Fs.FileSystem.instance.filename_store.append([]const u8, slice) catch unreachable;
        var scope = runner.?.getOrPutFile(filepath);
        scope.push();

        return Bun__Jest__testModuleObject(globalObject);
    }

    fn jsSetDefaultTimeout(globalObject: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(1).slice();
        if (arguments.len < 1 or !arguments[0].isNumber()) {
            return globalObject.throw("setTimeout() expects a number (milliseconds)", .{});
        }

        const timeout_ms: u32 = @intCast(@max(arguments[0].coerce(i32, globalObject), 0));

        if (Jest.runner) |test_runner| {
            test_runner.default_timeout_override = timeout_ms;
        }

        return .js_undefined;
    }

    comptime {
        @export(&Bun__Jest__createTestModuleObject, .{ .name = "Bun__Jest__createTestModuleObject" });
        @export(&Bun__Jest__createTestPreloadObject, .{ .name = "Bun__Jest__createTestPreloadObject" });
    }
};

pub const TestScope = struct {
    label: string = "",
    parent: *DescribeScope,

    func: JSValue,
    func_arg: []JSValue,
    func_has_callback: bool = false,

    test_id_for_debugger: TestRunner.Test.ID = 0,
    promise: ?*JSInternalPromise = null,
    ran: bool = false,
    task: ?*TestRunnerTask = null,
    tag: Tag = .pass,
    snapshot_count: usize = 0,

    // null if the test does not set a timeout
    timeout_millis: u32 = std.math.maxInt(u32),

    retry_count: u32 = 0, // retry, on fail
    repeat_count: u32 = 0, // retry, on pass or fail

    pub const Counter = struct {
        expected: u32 = 0,
        actual: u32 = 0,
    };

    pub fn deinit(this: *TestScope, _: *JSGlobalObject) void {
        if (this.label.len > 0) {
            const label = this.label;
            this.label = "";
            bun.default_allocator.free(label);
        }
    }

    pub fn call(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createScope(globalThis, callframe, "test()", true, .pass);
    }

    pub fn failing(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createScope(globalThis, callframe, "test()", true, .fail);
    }

    pub fn only(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createScope(globalThis, callframe, "test.only()", true, .only);
    }

    pub fn skip(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createScope(globalThis, callframe, "test.skip()", true, .skip);
    }

    pub fn todo(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createScope(globalThis, callframe, "test.todo()", true, .todo);
    }

    pub fn each(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createEach(globalThis, callframe, "test.each()", "each", true);
    }

    pub fn callIf(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createIfScope(globalThis, callframe, "test.if()", "if", TestScope, .pass);
    }

    pub fn skipIf(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createIfScope(globalThis, callframe, "test.skipIf()", "skipIf", TestScope, .skip);
    }

    pub fn todoIf(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createIfScope(globalThis, callframe, "test.todoIf()", "todoIf", TestScope, .todo);
    }

    pub fn onReject(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        debug("onReject", .{});
        const arguments = callframe.arguments_old(2);
        const err = arguments.ptr[0];
        _ = globalThis.bunVM().uncaughtException(globalThis, err, true);
        var task: *TestRunnerTask = arguments.ptr[1].asPromisePtr(TestRunnerTask);
        task.handleResult(.{ .fail = expect.active_test_expectation_counter.actual }, .promise);
        globalThis.bunVM().autoGarbageCollect();
        return .js_undefined;
    }
    const jsOnReject = JSC.toJSHostFn(onReject);

    pub fn onResolve(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        debug("onResolve", .{});
        const arguments = callframe.arguments_old(2);
        var task: *TestRunnerTask = arguments.ptr[1].asPromisePtr(TestRunnerTask);
        task.handleResult(.{ .pass = expect.active_test_expectation_counter.actual }, .promise);
        globalThis.bunVM().autoGarbageCollect();
        return .js_undefined;
    }
    const jsOnResolve = JSC.toJSHostFn(onResolve);

    pub fn onDone(
        globalThis: *JSGlobalObject,
        callframe: *CallFrame,
    ) bun.JSError!JSValue {
        const function = callframe.callee();
        const args = callframe.arguments_old(1);
        defer globalThis.bunVM().autoGarbageCollect();

        if (JSC.host_fn.getFunctionData(function)) |data| {
            var task = bun.cast(*TestRunnerTask, data);
            const expect_count = expect.active_test_expectation_counter.actual;
            const current_test = task.testScope();
            const no_err_result: Result = if (current_test.tag == .fail)
                .{ .fail_because_failing_test_passed = expect_count }
            else
                .{ .pass = expect_count };

            JSC.host_fn.setFunctionData(function, null);
            if (args.len > 0) {
                const err = args.ptr[0];
                if (err.isEmptyOrUndefinedOrNull()) {
                    debug("done()", .{});
                    task.handleResult(no_err_result, .callback);
                } else {
                    debug("done(err)", .{});
                    const result: Result = if (current_test.tag == .fail) failing_passed: {
                        break :failing_passed if (globalThis.clearExceptionExceptTermination())
                            Result{ .pass = expect_count }
                        else
                            Result{ .fail = expect_count }; // what is the correct thing to do when terminating?
                    } else passing_failed: {
                        _ = globalThis.bunVM().uncaughtException(globalThis, err, true);
                        break :passing_failed Result{ .fail = expect_count };
                    };
                    task.handleResult(result, .callback);
                }
            } else {
                debug("done()", .{});
                task.handleResult(no_err_result, .callback);
            }
        }

        return .js_undefined;
    }

    pub fn run(
        this: *TestScope,
        task: *TestRunnerTask,
    ) Result {
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
        task.started_at = bun.timespec.now();

        if (this.timeout_millis == std.math.maxInt(u32)) {
            if (Jest.runner.?.default_timeout_override != std.math.maxInt(u32)) {
                this.timeout_millis = Jest.runner.?.default_timeout_override;
            } else {
                this.timeout_millis = Jest.runner.?.default_timeout_ms;
            }
        }

        Jest.runner.?.setTimeout(
            this.timeout_millis,
            task.test_id,
        );

        if (task.test_id_for_debugger > 0) {
            if (vm.debugger) |*debugger| {
                if (debugger.test_reporter_agent.isEnabled()) {
                    debugger.test_reporter_agent.reportTestStart(@intCast(task.test_id_for_debugger));
                }
            }
        }

        if (this.func_has_callback) {
            const callback_func = JSC.host_fn.NewFunctionWithData(
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
            if (this.tag != .fail) {
                _ = vm.uncaughtException(vm.global, initial_value, true);
            }

            return switch (this.tag) {
                .todo => .{ .todo = {} },
                .fail => .{ .pass = expect.active_test_expectation_counter.actual },
                else => .{ .fail = expect.active_test_expectation_counter.actual },
            };
        }

        if (initial_value.asAnyPromise()) |promise| {
            if (this.promise != null) {
                return .{ .pending = {} };
            }
            this.task = task;

            // TODO: not easy to coerce JSInternalPromise as JSValue,
            // so simply wait for completion for now.
            switch (promise) {
                .internal => vm.waitForPromise(promise),
                else => {},
            }
            switch (promise.status(vm.global.vm())) {
                .rejected => {
                    if (!promise.isHandled(vm.global.vm()) and this.tag != .fail) {
                        vm.unhandledRejection(vm.global, promise.result(vm.global.vm()), promise.asValue());
                    }

                    return switch (this.tag) {
                        .todo => .{ .todo = {} },
                        .fail => fail: {
                            promise.setHandled(vm.global.vm());

                            break :fail .{ .pass = expect.active_test_expectation_counter.actual };
                        },
                        else => .{ .fail = expect.active_test_expectation_counter.actual },
                    };
                },
                .pending => {
                    task.promise_state = .pending;
                    switch (promise) {
                        .normal => |p| {
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
            return Result{ .pending = {} };
        }

        if (expect.active_test_expectation_counter.expected > 0 and expect.active_test_expectation_counter.expected < expect.active_test_expectation_counter.actual) {
            Output.prettyErrorln("Test fail: {d} / {d} expectations\n (make this better!)", .{
                expect.active_test_expectation_counter.actual,
                expect.active_test_expectation_counter.expected,
            });
            return .{ .fail = expect.active_test_expectation_counter.actual };
        }

        return if (this.tag == .fail)
            .{ .fail_because_failing_test_passed = expect.active_test_expectation_counter.actual }
        else
            .{ .pass = expect.active_test_expectation_counter.actual };
    }

    comptime {
        @export(&jsOnResolve, .{
            .name = "Bun__TestScope__onResolve",
        });
        @export(&jsOnReject, .{
            .name = "Bun__TestScope__onReject",
        });
    }
};

pub const DescribeScope = struct {
    label: string = "",
    parent: ?*DescribeScope = null,
    beforeAlls: std.ArrayListUnmanaged(JSValue) = .{},
    beforeEachs: std.ArrayListUnmanaged(JSValue) = .{},
    afterEachs: std.ArrayListUnmanaged(JSValue) = .{},
    afterAlls: std.ArrayListUnmanaged(JSValue) = .{},
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
        if (new.parent) |scope| {
            if (comptime Environment.allow_assert) {
                assert(DescribeScope.active != new);
                assert(scope == DescribeScope.active);
            }
        } else if (DescribeScope.active) |scope| {
            // calling Bun.jest() within (already active) module
            if (scope.parent != null) return;
        }
        DescribeScope.active = new;
    }

    pub fn pop(this: *DescribeScope) void {
        if (comptime Environment.allow_assert) assert(DescribeScope.active == this);
        DescribeScope.active = this.parent;
    }

    pub const LifecycleHook = enum {
        beforeAll,
        beforeEach,
        afterEach,
        afterAll,
    };

    pub threadlocal var active: ?*DescribeScope = null;

    const CallbackFn = JSC.JSHostFnZig;

    fn createCallback(comptime hook: LifecycleHook) CallbackFn {
        return struct {
            pub fn run(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSC.JSValue {
                const arguments = callframe.arguments_old(2);
                if (arguments.len < 1) {
                    return globalThis.throwNotEnoughArguments("callback", 1, arguments.len);
                }

                const cb = arguments.ptr[0];
                if (!cb.isObject() or !cb.isCallable()) {
                    return globalThis.throwInvalidArgumentType(@tagName(hook), "callback", "function");
                }

                cb.protect();
                @field(DescribeScope.active.?, @tagName(hook) ++ "s").append(bun.default_allocator, cb) catch unreachable;
                return JSValue.jsBoolean(true);
            }
        }.run;
    }

    pub fn onDone(
        ctx: *JSC.JSGlobalObject,
        callframe: *CallFrame,
    ) bun.JSError!JSValue {
        const function = callframe.callee();
        const args = callframe.arguments_old(1);
        defer ctx.bunVM().autoGarbageCollect();

        if (JSC.host_fn.getFunctionData(function)) |data| {
            var scope = bun.cast(*DescribeScope, data);
            JSC.host_fn.setFunctionData(function, null);
            if (args.len > 0) {
                const err = args.ptr[0];
                if (!err.isEmptyOrUndefinedOrNull()) {
                    _ = ctx.bunVM().uncaughtException(ctx.bunVM().global, err, true);
                }
            }
            scope.done = true;
        }

        return .js_undefined;
    }

    pub const afterAll = createCallback(.afterAll);
    pub const afterEach = createCallback(.afterEach);
    pub const beforeAll = createCallback(.beforeAll);
    pub const beforeEach = createCallback(.beforeEach);

    // TODO this should return JSError
    pub fn execCallback(this: *DescribeScope, globalObject: *JSGlobalObject, comptime hook: LifecycleHook) ?JSValue {
        var hooks = &@field(this, @tagName(hook) ++ "s");
        defer {
            if (comptime hook == .beforeAll or hook == .afterAll) {
                hooks.clearAndFree(bun.default_allocator);
            }
        }

        for (hooks.items) |cb| {
            if (comptime Environment.allow_assert) {
                assert(cb.isObject());
                assert(cb.isCallable());
            }
            defer {
                if (comptime hook == .beforeAll or hook == .afterAll) {
                    cb.unprotect();
                }
            }

            const vm = VirtualMachine.get();
            var result: JSValue = switch (cb.getLength(globalObject) catch |e| return globalObject.takeException(e)) { // TODO is this right?
                0 => callJSFunctionForTestRunner(vm, globalObject, cb, &.{}),
                else => brk: {
                    this.done = false;
                    const done_func = JSC.host_fn.NewFunctionWithData(
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
                if (promise.status(globalObject.vm()) == .pending) {
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

    pub fn runGlobalCallbacks(globalThis: *JSGlobalObject, comptime hook: LifecycleHook) ?JSValue {
        // global callbacks
        var hooks = &@field(Jest.runner.?.global_callbacks, @tagName(hook));
        defer {
            if (comptime hook == .beforeAll or hook == .afterAll) {
                hooks.clearAndFree(bun.default_allocator);
            }
        }

        for (hooks.items) |cb| {
            if (comptime Environment.allow_assert) {
                assert(cb.isObject());
                assert(cb.isCallable());
            }
            defer {
                if (comptime hook == .beforeAll or hook == .afterAll) {
                    cb.unprotect();
                }
            }

            const vm = VirtualMachine.get();
            // note: we do not support "done" callback in global hooks in the first release.
            var result: JSValue = callJSFunctionForTestRunner(vm, globalThis, cb, &.{});

            if (result.asAnyPromise()) |promise| {
                if (promise.status(globalThis.vm()) == .pending) {
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

    fn runBeforeCallbacks(this: *DescribeScope, globalObject: *JSGlobalObject, comptime hook: LifecycleHook) ?JSValue {
        if (this.parent) |scope| {
            if (scope.runBeforeCallbacks(globalObject, hook)) |err| {
                return err;
            }
        }
        return this.execCallback(globalObject, hook);
    }

    pub fn runCallback(this: *DescribeScope, globalObject: *JSGlobalObject, comptime hook: LifecycleHook) ?JSValue {
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

    pub fn call(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createScope(globalThis, callframe, "describe()", false, .pass);
    }

    pub fn only(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createScope(globalThis, callframe, "describe.only()", false, .only);
    }

    pub fn skip(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createScope(globalThis, callframe, "describe.skip()", false, .skip);
    }

    pub fn todo(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createScope(globalThis, callframe, "describe.todo()", false, .todo);
    }

    pub fn each(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createEach(globalThis, callframe, "describe.each()", "each", false);
    }

    pub fn callIf(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createIfScope(globalThis, callframe, "describe.if()", "if", DescribeScope, .pass);
    }

    pub fn skipIf(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createIfScope(globalThis, callframe, "describe.skipIf()", "skipIf", DescribeScope, .skip);
    }

    pub fn todoIf(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        return createIfScope(globalThis, callframe, "describe.todoIf()", "todoIf", DescribeScope, .todo);
    }

    pub fn run(this: *DescribeScope, globalObject: *JSGlobalObject, callback: JSValue, args: []const JSValue) JSValue {
        callback.protect();
        defer callback.unprotect();
        this.push();
        defer this.pop();
        debug("describe({})", .{bun.fmt.QuotedFormatter{ .text = this.label }});

        if (callback == .zero) {
            this.runTests(globalObject);
            return .js_undefined;
        }

        {
            JSC.markBinding(@src());
            var result = callJSFunctionForTestRunner(VirtualMachine.get(), globalObject, callback, args);

            if (result.asAnyPromise()) |prom| {
                globalObject.bunVM().waitForPromise(prom);
                switch (prom.status(globalObject.vm())) {
                    .fulfilled => {},
                    else => {
                        globalObject.bunVM().unhandledRejection(globalObject, prom.result(globalObject.vm()), prom.asValue());
                        return .js_undefined;
                    },
                }
            } else if (result.toError()) |err| {
                _ = globalObject.bunVM().uncaughtException(globalObject, err, true);
                return .js_undefined;
            }
        }

        this.runTests(globalObject);
        return .js_undefined;
    }

    pub fn runTests(this: *DescribeScope, globalObject: *JSGlobalObject) void {
        // Step 1. Initialize the test block
        globalObject.clearTerminationException();

        const file = this.file_id;
        const allocator = bun.default_allocator;
        const tests: []TestScope = this.tests.items;
        const end = @as(TestRunner.Test.ID, @truncate(tests.len));
        this.pending_tests = std.DynamicBitSetUnmanaged.initFull(allocator, end) catch unreachable;

        // Step 2. Update the runner with the count of how many tests we have for this block
        if (end > 0) this.test_id_start = Jest.runner.?.addTestCount(end);

        const source: logger.Source = Jest.runner.?.files.items(.source)[file];

        var i: TestRunner.Test.ID = 0;

        if (this.shouldEvaluateScope()) {
            if (this.runCallback(globalObject, .beforeAll)) |err| {
                _ = globalObject.bunVM().uncaughtException(globalObject, err, true);
                while (i < end) {
                    Jest.runner.?.reportFailure(i + this.test_id_start, source.path.text, tests[i].label, 0, 0, this);
                    i += 1;
                }
                this.deinit(globalObject);
                return;
            }
            if (end == 0) {
                var runner = allocator.create(TestRunnerTask) catch unreachable;
                runner.* = .{
                    .test_id = TestRunner.Test.null_id,
                    .describe = this,
                    .globalThis = globalObject,
                    .source_file_path = source.path.text,
                    .test_id_for_debugger = 0,
                };
                runner.ref.ref(globalObject.bunVM());

                Jest.runner.?.enqueue(runner);
                return;
            }
        }

        const maybe_report_debugger = max_test_id_for_debugger > 0;

        while (i < end) : (i += 1) {
            var runner = allocator.create(TestRunnerTask) catch unreachable;
            runner.* = .{
                .test_id = i,
                .describe = this,
                .globalThis = globalObject,
                .source_file_path = source.path.text,
                .test_id_for_debugger = if (maybe_report_debugger) tests[i].test_id_for_debugger else 0,
            };
            runner.ref.ref(globalObject.bunVM());

            Jest.runner.?.enqueue(runner);
        }
    }

    pub fn onTestComplete(this: *DescribeScope, globalThis: *JSGlobalObject, test_id: TestRunner.Test.ID, skipped: bool) void {
        // invalidate it
        this.current_test_id = TestRunner.Test.null_id;
        if (test_id != TestRunner.Test.null_id) this.pending_tests.unset(test_id);
        globalThis.bunVM().onUnhandledRejectionCtx = null;

        if (!skipped) {
            if (this.runCallback(globalThis, .afterEach)) |err| {
                _ = globalThis.bunVM().uncaughtException(globalThis, err, true);
            }
        }

        if (this.pending_tests.findFirstSet() != null) {
            return;
        }

        if (this.shouldEvaluateScope()) {
            // Run the afterAll callbacks, in reverse order
            // unless there were no tests for this scope
            if (this.execCallback(globalThis, .afterAll)) |err| {
                _ = globalThis.bunVM().uncaughtException(globalThis, err, true);
            }
        }
        this.deinit(globalThis);
    }

    pub fn deinit(this: *DescribeScope, globalThis: *JSGlobalObject) void {
        const allocator = bun.default_allocator;

        if (this.label.len > 0) {
            const label = this.label;
            this.label = "";
            allocator.free(label);
        }

        this.pending_tests.deinit(allocator);
        for (this.tests.items) |*t| {
            t.deinit(globalThis);
        }
        this.tests.clearAndFree(allocator);
    }

    const ScopeStack = ObjectPool(std.ArrayListUnmanaged(*DescribeScope), null, true, 16);
};

pub fn wrapTestFunction(comptime name: []const u8, comptime func: JSC.JSHostFnZig) DescribeScope.CallbackFn {
    return struct {
        pub fn wrapped(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
            if (Jest.runner == null) {
                return globalThis.throw("Cannot use " ++ name ++ "() outside of the test runner. Run \"bun test\" to run tests.", .{});
            }
            if (globalThis.bunVM().is_in_preload) {
                return globalThis.throw("Cannot use " ++ name ++ "() outside of a test file.", .{});
            }
            return @call(bun.callmod_inline, func, .{ globalThis, callframe });
        }
    }.wrapped;
}

/// This wrapped scope as well as the wrapped describe scope is used when you load `bun:test`
/// outside of
pub const WrappedTestScope = struct {
    pub const call = wrapTestFunction("test", TestScope.call);
    pub const failing = wrapTestFunction("test", TestScope.failing);
    pub const only = wrapTestFunction("test", TestScope.only);
    pub const skip = wrapTestFunction("test", TestScope.skip);
    pub const todo = wrapTestFunction("test", TestScope.todo);
    pub const callIf = wrapTestFunction("test", TestScope.callIf);
    pub const skipIf = wrapTestFunction("test", TestScope.skipIf);
    pub const todoIf = wrapTestFunction("test", TestScope.todoIf);
    pub const each = wrapTestFunction("test", TestScope.each);
};

pub const WrappedDescribeScope = struct {
    pub const call = wrapTestFunction("describe", DescribeScope.call);
    pub const only = wrapTestFunction("describe", DescribeScope.only);
    pub const skip = wrapTestFunction("describe", DescribeScope.skip);
    pub const todo = wrapTestFunction("describe", DescribeScope.todo);
    pub const callIf = wrapTestFunction("describe", DescribeScope.callIf);
    pub const skipIf = wrapTestFunction("describe", DescribeScope.skipIf);
    pub const todoIf = wrapTestFunction("describe", DescribeScope.todoIf);
    pub const each = wrapTestFunction("describe", DescribeScope.each);
};

pub const TestRunnerTask = struct {
    test_id: TestRunner.Test.ID,
    test_id_for_debugger: TestRunner.Test.ID,
    describe: *DescribeScope,
    globalThis: *JSGlobalObject,
    source_file_path: string = "",
    needs_before_each: bool = true,
    ref: JSC.Ref = JSC.Ref.init(),

    done_callback_state: AsyncState = .none,
    promise_state: AsyncState = .none,
    sync_state: AsyncState = .none,
    reported: bool = false,
    started_at: bun.timespec = .{},

    pub const AsyncState = enum {
        none,
        pending,
        fulfilled,
    };

    pub inline fn testScope(this: *TestRunnerTask) *TestScope {
        return &this.describe.tests.items[this.test_id];
    }

    pub fn onUnhandledRejection(jsc_vm: *VirtualMachine, globalObject: *JSGlobalObject, rejection: JSValue) void {
        var deduped = false;
        const is_unhandled = jsc_vm.onUnhandledRejectionCtx == null;

        if (rejection.asAnyPromise()) |promise| {
            promise.setHandled(globalObject.vm());
        }

        if (jsc_vm.last_reported_error_for_dedupe == rejection and rejection != .zero) {
            jsc_vm.last_reported_error_for_dedupe = .zero;
            deduped = true;
        } else {
            if (is_unhandled and Jest.runner != null) {
                Output.prettyErrorln(
                    \\<r>
                    \\<b><d>#<r> <red><b>Unhandled error<r><d> between tests<r>
                    \\<d>-------------------------------<r>
                    \\
                , .{});

                Output.flush();
            }
            jsc_vm.runErrorHandlerWithDedupe(rejection, jsc_vm.onUnhandledRejectionExceptionList);
            if (is_unhandled and Jest.runner != null) {
                Output.prettyError("<r><d>-------------------------------<r>\n\n", .{});
                Output.flush();
            }
        }

        if (jsc_vm.onUnhandledRejectionCtx) |ctx| {
            var this = bun.cast(*TestRunnerTask, ctx);
            jsc_vm.onUnhandledRejectionCtx = null;
            const result: Result = if (this.testScope().tag == .fail)
                .{ .pass = expect.active_test_expectation_counter.actual }
            else
                .{ .fail = expect.active_test_expectation_counter.actual };
            this.handleResult(result, .unhandledRejection);
        } else if (Jest.runner) |runner| {
            if (!deduped)
                runner.unhandled_errors_between_tests += 1;
        }
    }

    pub fn checkAssertionsCounter(result: *Result) void {
        if (expect.is_expecting_assertions and expect.active_test_expectation_counter.actual == 0) {
            expect.is_expecting_assertions = false;
            expect.is_expecting_assertions_count = false;
            result.* = .{ .fail_because_expected_has_assertions = {} };
        }

        if (expect.is_expecting_assertions_count and expect.active_test_expectation_counter.actual != expect.active_test_expectation_counter.expected) {
            expect.is_expecting_assertions = false;
            expect.is_expecting_assertions_count = false;
            result.* = .{ .fail_because_expected_assertion_count = expect.active_test_expectation_counter };
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
        if (test_id == TestRunner.Test.null_id) {
            describe.onTestComplete(globalThis, test_id, true);
            Jest.runner.?.runNextTest();
            this.deinit();
            return false;
        }

        var test_: TestScope = this.describe.tests.items[test_id];
        describe.current_test_id = test_id;
        const test_id_for_debugger = test_.test_id_for_debugger;
        this.test_id_for_debugger = test_id_for_debugger;

        if (test_.func == .zero or !describe.shouldEvaluateScope() or (test_.tag != .only and Jest.runner.?.only)) {
            const tag = if (!describe.shouldEvaluateScope()) describe.tag else test_.tag;
            switch (tag) {
                .todo => {
                    this.processTestResult(globalThis, .{ .todo = {} }, test_, test_id, test_id_for_debugger, describe);
                },
                .skip => {
                    this.processTestResult(globalThis, .{ .skip = {} }, test_, test_id, test_id_for_debugger, describe);
                },
                else => {},
            }
            this.deinit();
            return false;
        }

        jsc_vm.onUnhandledRejectionCtx = this;
        jsc_vm.onUnhandledRejection = onUnhandledRejection;

        if (this.needs_before_each) {
            this.needs_before_each = false;
            const label = test_.label;

            if (this.describe.runCallback(globalThis, .beforeEach)) |err| {
                _ = jsc_vm.uncaughtException(globalThis, err, true);
                Jest.runner.?.reportFailure(test_id, this.source_file_path, label, 0, 0, this.describe);
                return false;
            }
        }

        this.sync_state = .pending;
        jsc_vm.auto_killer.enable();
        var result = TestScope.run(&test_, this);

        if (this.describe.tests.items.len > test_id) {
            this.describe.tests.items[test_id].timeout_millis = test_.timeout_millis;
        }

        // rejected promises should fail the test
        if (!result.isFailure())
            globalThis.handleRejectedPromises();

        if (result == .pending and this.sync_state == .pending and (this.done_callback_state == .pending or this.promise_state == .pending)) {
            this.sync_state = .fulfilled;

            if (this.reported and this.promise_state != .pending) {
                // An unhandled error was reported.
                // Let's allow any pending work to run, and then move on to the next test.
                this.continueRunningTestsAfterMicrotasksRun();
            }
            return true;
        }

        this.handleResultPtr(&result, .sync);

        if (result.isFailure()) {
            globalThis.handleRejectedPromises();
        }

        return false;
    }

    pub fn timeout(this: *TestRunnerTask, now: *const bun.timespec) void {
        if (comptime Environment.allow_assert) assert(!this.reported);
        const elapsed = now.duration(&this.started_at).ms();
        this.ref.unref(this.globalThis.bunVM());
        this.globalThis.requestTermination();
        this.handleResult(.{ .fail = expect.active_test_expectation_counter.actual }, .{ .timeout = @intCast(@max(elapsed, 0)) });
    }

    const ResultType = union(enum) {
        promise: void,
        callback: void,
        sync: void,
        timeout: u64,
        unhandledRejection: void,
    };

    pub fn handleResult(this: *TestRunnerTask, result: Result, from: ResultType) void {
        var result_copy = result;
        this.handleResultPtr(&result_copy, from);
    }

    fn continueRunningTestsAfterMicrotasksRun(this: *TestRunnerTask) void {
        if (this.ref.has)
            // Drain microtasks one more time.
            // But don't hang forever.
            // We report the test failure before that task is run.
            this.globalThis.bunVM().enqueueTask(JSC.ManagedTask.New(@This(), deinit).init(this));
    }

    pub fn handleResultPtr(this: *TestRunnerTask, result: *Result, from: ResultType) void {
        switch (from) {
            .promise => {
                if (comptime Environment.allow_assert) assert(this.promise_state == .pending);
                this.promise_state = .fulfilled;

                if (this.done_callback_state == .pending and result.* == .pass) {
                    return;
                }
            },
            .callback => {
                if (comptime Environment.allow_assert) assert(this.done_callback_state == .pending);
                this.done_callback_state = .fulfilled;

                if (this.promise_state == .pending and result.* == .pass) {
                    return;
                }
            },
            .sync => {
                if (comptime Environment.allow_assert) assert(this.sync_state == .pending);
                this.sync_state = .fulfilled;
            },
            .timeout, .unhandledRejection => {},
        }

        defer {
            if (this.reported and this.promise_state != .pending and this.sync_state != .pending and this.done_callback_state != .pending)
                this.deinit();
        }

        if (this.reported) {
            // This covers the following scenario:
            //
            // test("foo", async done => {
            //     await Bun.sleep(42);
            //     throw new Error("foo");
            // });
            //
            // The test will hang forever if we don't drain microtasks here.
            //
            // It is okay for this to be called multiple times, as it unrefs() the event loop once, and doesn't free memory.
            if (result.* != .pass and this.promise_state != .pending and this.done_callback_state == .pending and this.sync_state == .fulfilled) {
                this.continueRunningTestsAfterMicrotasksRun();
            }
            return;
        }

        // This covers the following scenario:
        //
        //
        //   test("foo", done => {
        //       setTimeout(() => {
        //           if (Math.random() > 0.5) {
        //               done();
        //           } else {
        //               throw new Error("boom");
        //           }
        //       }, 100);
        //    })
        //
        // It is okay for this to be called multiple times, as it unrefs() the event loop once, and doesn't free memory.
        if (this.promise_state != .pending and this.sync_state != .pending and this.done_callback_state == .pending) {
            // Drain microtasks one more time.
            // But don't hang forever.
            // We report the test failure before that task is run.
            this.continueRunningTestsAfterMicrotasksRun();
        }

        this.reported = true;

        const test_id = this.test_id;
        var test_ = this.describe.tests.items[test_id];
        if (from == .timeout) {
            test_.timeout_millis = @truncate(from.timeout);
        }

        var describe = this.describe;
        describe.tests.items[test_id] = test_;

        if (from == .timeout) {
            const vm = this.globalThis.bunVM();
            const cancel_result = vm.auto_killer.kill();

            const err = brk: {
                if (cancel_result.processes > 0) {
                    switch (Output.enable_ansi_colors_stdout) {
                        inline else => |enable_ansi_colors| {
                            break :brk this.globalThis.createErrorInstance(comptime Output.prettyFmt("Test {} timed out after {d}ms <r><d>({})<r>", enable_ansi_colors), .{ bun.fmt.quote(test_.label), test_.timeout_millis, cancel_result });
                        },
                    }
                } else {
                    break :brk this.globalThis.createErrorInstance("Test {} timed out after {d}ms", .{ bun.fmt.quote(test_.label), test_.timeout_millis });
                }
            };

            this.globalThis.clearTerminationException();
            _ = vm.uncaughtException(this.globalThis, err, true);
        }

        checkAssertionsCounter(result);
        processTestResult(this, this.globalThis, result.*, test_, test_id, this.test_id_for_debugger, describe);
    }

    fn processTestResult(this: *TestRunnerTask, globalThis: *JSGlobalObject, result: Result, test_: TestScope, test_id: u32, test_id_for_debugger: u32, describe: *DescribeScope) void {
        const elapsed = this.started_at.sinceNow();
        switch (result.forceTODO(test_.tag == .todo)) {
            .pass => |count| Jest.runner.?.reportPass(
                test_id,
                this.source_file_path,
                test_.label,
                count,
                elapsed,
                describe,
            ),
            .fail => |count| Jest.runner.?.reportFailure(
                test_id,
                this.source_file_path,
                test_.label,
                count,
                elapsed,
                describe,
            ),
            .fail_because_failing_test_passed => |count| {
                Output.prettyErrorln("  <d>^<r> <red>this test is marked as failing but it passed.<r> <d>Remove `.failing` if tested behavior now works", .{});
                Jest.runner.?.reportFailure(
                    test_id,
                    this.source_file_path,
                    test_.label,
                    count,
                    elapsed,
                    describe,
                );
            },
            .fail_because_expected_has_assertions => {
                Output.err(error.AssertionError, "received <red>0 assertions<r>, but expected <green>at least one assertion<r> to be called\n", .{});
                Output.flush();
                Jest.runner.?.reportFailure(
                    test_id,
                    this.source_file_path,
                    test_.label,
                    0,
                    elapsed,
                    describe,
                );
            },
            .fail_because_expected_assertion_count => |counter| {
                Output.err(error.AssertionError, "expected <green>{d} assertions<r>, but test ended with <red>{d} assertions<r>\n", .{
                    counter.expected,
                    counter.actual,
                });
                Output.flush();
                Jest.runner.?.reportFailure(
                    test_id,
                    this.source_file_path,
                    test_.label,
                    counter.actual,
                    elapsed,
                    describe,
                );
            },
            .skip => Jest.runner.?.reportSkip(test_id, this.source_file_path, test_.label, describe),
            .todo => Jest.runner.?.reportTodo(test_id, this.source_file_path, test_.label, describe),
            .fail_because_todo_passed => |count| {
                Output.prettyErrorln("  <d>^<r> <red>this test is marked as todo but passes.<r> <d>Remove `.todo` or check that test is correct.<r>", .{});
                Jest.runner.?.reportFailure(
                    test_id,
                    this.source_file_path,
                    test_.label,
                    count,
                    elapsed,
                    describe,
                );
            },
            .pending => @panic("Unexpected pending test"),
        }

        if (test_id_for_debugger > 0) {
            if (globalThis.bunVM().debugger) |*debugger| {
                if (debugger.test_reporter_agent.isEnabled()) {
                    debugger.test_reporter_agent.reportTestEnd(@intCast(test_id_for_debugger), switch (result) {
                        .pass => .pass,
                        .skip => .skip,
                        .todo => .todo,
                        else => .fail,
                    }, @floatFromInt(elapsed));
                }
            }
        }

        describe.onTestComplete(globalThis, test_id, result == .skip or (!Jest.runner.?.test_options.run_todo and result == .todo));

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
    fail_because_failing_test_passed: u32,
    fail_because_todo_passed: u32,
    fail_because_expected_has_assertions: void,
    fail_because_expected_assertion_count: Counter,

    pub fn isFailure(this: *const Result) bool {
        return this.* == .fail or this.* == .fail_because_expected_has_assertions or this.* == .fail_because_expected_assertion_count;
    }

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
) bun.JSError!JSValue {
    const this = callframe.this();
    const arguments = callframe.arguments_old(3);
    const args = arguments.slice();

    if (args.len == 0) {
        return globalThis.throwPretty("{s} expects a description or function", .{signature});
    }

    var description = args[0];
    var function = if (args.len > 1) args[1] else .zero;
    var options = if (args.len > 2) args[2] else .zero;

    if (args.len == 1 and description.isFunction()) {
        function = description;
        description = .zero;
    } else {
        const is_valid_description =
            description.isClass(globalThis) or
            (description.isFunction() and !description.getName(globalThis).isEmpty()) or
            description.isNumber() or
            description.isString();

        if (!is_valid_description) {
            return globalThis.throwPretty("{s} expects first argument to be a named class, named function, number, or string", .{signature});
        }

        if (!function.isFunction()) {
            if (tag != .todo and tag != .skip) {
                return globalThis.throwPretty("{s} expects second argument to be a function", .{signature});
            }
        }
    }

    if (function == .zero or !function.isFunction()) {
        if (tag != .todo and tag != .skip) {
            return globalThis.throwPretty("{s} expects a function", .{signature});
        }
    }

    const allocator = bun.default_allocator;
    const parent = DescribeScope.active.?;
    const label = brk: {
        if (description == .zero) {
            break :brk "";
        }

        if (description.isClass(globalThis)) {
            const name_str = if (description.className(globalThis).toSlice(allocator).length() == 0)
                description.getName(globalThis).toSlice(allocator).slice()
            else
                description.className(globalThis).toSlice(allocator).slice();
            break :brk try allocator.dupe(u8, name_str);
        }
        if (description.isFunction()) {
            var slice = description.getName(globalThis).toSlice(allocator);
            defer slice.deinit();
            break :brk try allocator.dupe(u8, slice.slice());
        }
        var slice = try description.toSlice(globalThis, allocator);
        defer slice.deinit();
        break :brk try allocator.dupe(u8, slice.slice());
    };

    var timeout_ms: u32 = std.math.maxInt(u32);
    if (options.isNumber()) {
        timeout_ms = @as(u32, @intCast(@max(args[2].coerce(i32, globalThis), 0)));
    } else if (options.isObject()) {
        if (try options.get(globalThis, "timeout")) |timeout| {
            if (!timeout.isNumber()) {
                return globalThis.throwPretty("{s} expects timeout to be a number", .{signature});
            }
            timeout_ms = @as(u32, @intCast(@max(timeout.coerce(i32, globalThis), 0)));
        }
        if (try options.get(globalThis, "retry")) |retries| {
            if (!retries.isNumber()) {
                return globalThis.throwPretty("{s} expects retry to be a number", .{signature});
            }
            // TODO: retry_count = @intCast(u32, @max(retries.coerce(i32, globalThis), 0));
        }
        if (try options.get(globalThis, "repeats")) |repeats| {
            if (!repeats.isNumber()) {
                return globalThis.throwPretty("{s} expects repeats to be a number", .{signature});
            }
            // TODO: repeat_count = @intCast(u32, @max(repeats.coerce(i32, globalThis), 0));
        }
    } else if (!options.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwPretty("{s} expects options to be a number or object", .{signature});
    }

    var tag_to_use = tag;

    if (tag_to_use == .only or parent.tag == .only) {
        Jest.runner.?.setOnly();
        tag_to_use = .only;
    } else if (is_test and Jest.runner.?.only and parent.tag != .only) {
        return .js_undefined;
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
                const str = bun.String.fromBytes(buffer.slice());
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

        const func_params_length = try function.getLength(globalThis);
        var arg_size: usize = 0;
        var has_callback = false;
        if (func_params_length > 0) {
            has_callback = true;
            arg_size = 1;
        }
        const function_args = allocator.alloc(JSValue, arg_size) catch unreachable;

        parent.tests.append(allocator, TestScope{
            .label = label,
            .parent = parent,
            .tag = tag_to_use,
            .func = if (is_skip) .zero else function,
            .func_arg = function_args,
            .func_has_callback = has_callback,
            .timeout_millis = timeout_ms,
            .test_id_for_debugger = brk: {
                if (!is_skip) {
                    const vm = globalThis.bunVM();
                    if (vm.debugger) |*debugger| {
                        if (debugger.test_reporter_agent.isEnabled()) {
                            max_test_id_for_debugger += 1;
                            var name = bun.String.init(label);
                            debugger.test_reporter_agent.reportTestFound(callframe, @intCast(max_test_id_for_debugger), &name);
                            break :brk max_test_id_for_debugger;
                        }
                    }
                }

                break :brk 0;
            },
        }) catch unreachable;
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
    comptime property: [:0]const u8,
    comptime signature: string,
    comptime Scope: type,
    comptime tag: Tag,
) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1);
    const args = arguments.slice();

    if (args.len == 0) {
        return globalThis.throwPretty("{s} expects a condition", .{signature});
    }

    const name = ZigString.static(property);
    const value = args[0].toBoolean();

    const truthy_falsey = comptime switch (tag) {
        .pass => .{ Scope.skip, Scope.call },
        .fail => @compileError("unreachable"),
        .only => @compileError("unreachable"),
        .skip => .{ Scope.call, Scope.skip },
        .todo => .{ Scope.call, Scope.todo },
    };

    switch (@intFromBool(value)) {
        inline else => |index| return JSC.host_fn.NewFunction(globalThis, name, 2, truthy_falsey[index], false),
    }
}

fn consumeArg(
    globalThis: *JSGlobalObject,
    should_write: bool,
    str_idx: *usize,
    args_idx: *usize,
    array_list: *std.ArrayListUnmanaged(u8),
    arg: *const JSValue,
    fallback: []const u8,
) !void {
    const allocator = bun.default_allocator;
    if (should_write) {
        const owned_slice = try arg.toSliceOrNull(globalThis);
        defer owned_slice.deinit();
        array_list.appendSlice(allocator, owned_slice.slice()) catch bun.outOfMemory();
    } else {
        array_list.appendSlice(allocator, fallback) catch bun.outOfMemory();
    }
    str_idx.* += 1;
    args_idx.* += 1;
}

// Generate test label by positionally injecting parameters with printf formatting
fn formatLabel(globalThis: *JSGlobalObject, label: string, function_args: []JSValue, test_idx: usize) !string {
    const allocator = bun.default_allocator;
    var idx: usize = 0;
    var args_idx: usize = 0;
    var list = std.ArrayListUnmanaged(u8).initCapacity(allocator, label.len) catch bun.outOfMemory();

    while (idx < label.len) {
        const char = label[idx];
        if (char == '%' and (idx + 1 < label.len) and !(args_idx >= function_args.len)) {
            const current_arg = function_args[args_idx];

            switch (label[idx + 1]) {
                's' => {
                    try consumeArg(globalThis, current_arg != .zero and current_arg.jsType().isString(), &idx, &args_idx, &list, &current_arg, "%s");
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
                    const owned_slice = str.toOwnedSlice(allocator) catch bun.outOfMemory();
                    defer allocator.free(owned_slice);
                    list.appendSlice(allocator, owned_slice) catch bun.outOfMemory();
                    idx += 1;
                    args_idx += 1;
                },
                'p' => {
                    var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                    defer formatter.deinit();
                    const value_fmt = current_arg.toFmt(&formatter);
                    const test_index_str = std.fmt.allocPrint(allocator, "{}", .{value_fmt}) catch bun.outOfMemory();
                    defer allocator.free(test_index_str);
                    list.appendSlice(allocator, test_index_str) catch bun.outOfMemory();
                    idx += 1;
                    args_idx += 1;
                },
                '#' => {
                    const test_index_str = std.fmt.allocPrint(allocator, "{d}", .{test_idx}) catch bun.outOfMemory();
                    defer allocator.free(test_index_str);
                    list.appendSlice(allocator, test_index_str) catch bun.outOfMemory();
                    idx += 1;
                },
                '%' => {
                    list.append(allocator, '%') catch bun.outOfMemory();
                    idx += 1;
                },
                else => {
                    // ignore unrecognized fmt
                },
            }
        } else list.append(allocator, char) catch bun.outOfMemory();
        idx += 1;
    }

    return list.toOwnedSlice(allocator);
}

pub const EachData = struct { strong: JSC.Strong.Optional, is_test: bool };

fn eachBind(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    const signature = "eachBind";
    const callee = callframe.callee();
    const arguments = callframe.arguments_old(3);
    const args = arguments.slice();

    if (args.len < 2) {
        return globalThis.throwPretty("{s} a description and callback function", .{signature});
    }

    var description = args[0];
    var function = args[1];
    var options = if (args.len > 2) args[2] else .zero;

    if (function.isEmptyOrUndefinedOrNull() or !function.isCell() or !function.isCallable()) {
        return globalThis.throwPretty("{s} expects a function", .{signature});
    }

    var timeout_ms: u32 = std.math.maxInt(u32);
    if (options.isNumber()) {
        timeout_ms = @as(u32, @intCast(@max(args[2].coerce(i32, globalThis), 0)));
    } else if (options.isObject()) {
        if (try options.get(globalThis, "timeout")) |timeout| {
            if (!timeout.isNumber()) {
                return globalThis.throwPretty("{s} expects timeout to be a number", .{signature});
            }
            timeout_ms = @as(u32, @intCast(@max(timeout.coerce(i32, globalThis), 0)));
        }
        if (try options.get(globalThis, "retry")) |retries| {
            if (!retries.isNumber()) {
                return globalThis.throwPretty("{s} expects retry to be a number", .{signature});
            }
            // TODO: retry_count = @intCast(u32, @max(retries.coerce(i32, globalThis), 0));
        }
        if (try options.get(globalThis, "repeats")) |repeats| {
            if (!repeats.isNumber()) {
                return globalThis.throwPretty("{s} expects repeats to be a number", .{signature});
            }
            // TODO: repeat_count = @intCast(u32, @max(repeats.coerce(i32, globalThis), 0));
        }
    } else if (!options.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwPretty("{s} expects options to be a number or object", .{signature});
    }

    const parent = DescribeScope.active.?;

    if (JSC.host_fn.getFunctionData(callee)) |data| {
        const allocator = bun.default_allocator;
        const each_data = bun.cast(*EachData, data);
        JSC.host_fn.setFunctionData(callee, null);
        const array = each_data.*.strong.get() orelse return .js_undefined;
        defer {
            each_data.*.strong.deinit();
            allocator.destroy(each_data);
        }

        if (array.isUndefinedOrNull() or !array.jsType().isArray()) {
            return .js_undefined;
        }

        var iter = try array.arrayIterator(globalThis);

        var test_idx: usize = 0;
        while (try iter.next()) |item| {
            const func_params_length = try function.getLength(globalThis);
            const item_is_array = !item.isEmptyOrUndefinedOrNull() and item.jsType().isArray();
            var arg_size: usize = 1;

            if (item_is_array) {
                arg_size = try item.getLength(globalThis);
            }

            // add room for callback function
            const has_callback_function: bool = (func_params_length > arg_size) and each_data.is_test;
            if (has_callback_function) {
                arg_size += 1;
            }

            var function_args = allocator.alloc(JSValue, arg_size) catch @panic("can't create function_args");
            var idx: u32 = 0;

            if (item_is_array) {
                // Spread array as args
                var item_iter = try item.arrayIterator(globalThis);
                while (try item_iter.next()) |array_item| {
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
            var _label: ?JSC.ZigString.Slice = null;
            defer if (_label) |slice| slice.deinit();
            const label = brk: {
                if (description.isEmptyOrUndefinedOrNull()) {
                    break :brk "";
                } else {
                    _label = try description.toSlice(globalThis, allocator);
                    break :brk _label.?.slice();
                }
            };
            // this returns a owned slice
            const formattedLabel = try formatLabel(globalThis, label, function_args, test_idx);

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
                const str = bun.String.fromBytes(buffer.slice());
                is_skip = !regex.matches(str);
            }

            if (is_skip) {
                parent.skip_count += 1;
                function.unprotect();
                // lets free the formatted label
                allocator.free(formattedLabel);
            } else if (each_data.is_test) {
                if (Jest.runner.?.only and tag != .only) {
                    return .js_undefined;
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

    return .js_undefined;
}

inline fn createEach(
    globalThis: *JSGlobalObject,
    callframe: *CallFrame,
    comptime property: [:0]const u8,
    comptime signature: string,
    comptime is_test: bool,
) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1);
    const args = arguments.slice();

    if (args.len == 0) {
        return globalThis.throwPretty("{s} expects an array", .{signature});
    }

    var array = args[0];
    if (array == .zero or !array.jsType().isArray()) {
        return globalThis.throwPretty("{s} expects an array", .{signature});
    }

    const allocator = bun.default_allocator;
    const name = ZigString.static(property);
    const strong = JSC.Strong.Optional.create(array, globalThis);
    const each_data = allocator.create(EachData) catch unreachable;
    each_data.* = EachData{
        .strong = strong,
        .is_test = is_test,
    };

    return JSC.host_fn.NewFunctionWithData(globalThis, name, 3, eachBind, true, each_data);
}

fn callJSFunctionForTestRunner(vm: *JSC.VirtualMachine, globalObject: *JSGlobalObject, function: JSValue, args: []const JSValue) JSValue {
    vm.eventLoop().enter();
    defer vm.eventLoop().exit();

    globalObject.clearTerminationException(); // TODO this is sus
    return function.call(globalObject, .js_undefined, args) catch |err| globalObject.takeException(err);
}

const assert = bun.assert;
