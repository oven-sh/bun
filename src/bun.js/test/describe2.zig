pub const js_fns = struct {
    pub fn describeFn(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        group.begin(@src());
        defer group.end();
        errdefer group.log("ended in error", .{});

        const vm = globalObject.bunVM();
        if (vm.is_in_preload or bun.jsc.Jest.Jest.runner == null) {
            @panic("TODO return Bun__Jest__testPreloadObject(globalObject)");
        }
        if (bun.jsc.Jest.Jest.runner.?.describe2 == null) {
            return globalObject.throw("The describe2 was already forDebuggingDeinitNow-ed", .{});
        }
        const bunTest = &bun.jsc.Jest.Jest.runner.?.describe2.?;

        const name, const callback = callframe.argumentsAsArray(2);

        switch (bunTest.phase) {
            .collection => {
                try bunTest.collection.enqueueDescribeCallback(globalObject, name, callback, .{ .self_concurrent = false });
                return .js_undefined; // vitest doesn't return a promise, even for `describe(async () => {})`
            },
            .execution => {
                return globalObject.throw("Cannot call describe() inside a test", .{});
            },
            .done => return globalObject.throw("Cannot call describe() after the test run has completed", .{}),
        }
    }
    pub fn describeConcurrentFn(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        group.begin(@src());
        defer group.end();
        errdefer group.log("ended in error", .{});

        const vm = globalObject.bunVM();
        if (vm.is_in_preload or bun.jsc.Jest.Jest.runner == null) {
            @panic("TODO return Bun__Jest__testPreloadObject(globalObject)");
        }
        if (bun.jsc.Jest.Jest.runner.?.describe2 == null) {
            return globalObject.throw("The describe2 was already forDebuggingDeinitNow-ed", .{});
        }
        const bunTest = &bun.jsc.Jest.Jest.runner.?.describe2.?;

        const name, const callback = callframe.argumentsAsArray(2);

        switch (bunTest.phase) {
            .collection => {
                try bunTest.collection.enqueueDescribeCallback(globalObject, name, callback, .{ .self_concurrent = true });
                return .js_undefined; // vitest doesn't return a promise, even for `describe(async () => {})`
            },
            .execution => {
                return globalObject.throw("Cannot call describe() inside a test", .{});
            },
            .done => return globalObject.throw("Cannot call describe() after the test run has completed", .{}),
        }
    }

    pub fn testFn(globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        group.begin(@src());
        defer group.end();
        errdefer group.log("ended in error", .{});

        const vm = globalObject.bunVM();
        if (vm.is_in_preload or bun.jsc.Jest.Jest.runner == null) {
            @panic("TODO return Bun__Jest__testPreloadObject(globalObject)");
        }
        if (bun.jsc.Jest.Jest.runner.?.describe2 == null) {
            return globalObject.throw("The describe2 was already forDebuggingDeinitNow-ed", .{});
        }
        const bunTest = &bun.jsc.Jest.Jest.runner.?.describe2.?;

        const name, const callback = callFrame.argumentsAsArray(2);

        switch (bunTest.phase) {
            .collection => {
                try bunTest.collection.enqueueTestCallback(globalObject, name, callback, .{ .self_concurrent = false });
                return .js_undefined;
            },
            .execution => {
                return globalObject.throw("TODO: queue this test callback to call after this test ends", .{});
            },
            .done => return globalObject.throw("Cannot call test() after the test run has completed", .{}),
        }
    }

    pub fn testConcurrentFn(globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        group.begin(@src());
        defer group.end();
        errdefer group.log("ended in error", .{});

        const vm = globalObject.bunVM();
        if (vm.is_in_preload or bun.jsc.Jest.Jest.runner == null) {
            @panic("TODO return Bun__Jest__testPreloadObject(globalObject)");
        }
        if (bun.jsc.Jest.Jest.runner.?.describe2 == null) {
            return globalObject.throw("The describe2 was already forDebuggingDeinitNow-ed", .{});
        }
        const bunTest = &bun.jsc.Jest.Jest.runner.?.describe2.?;

        const name, const callback = callFrame.argumentsAsArray(2);

        switch (bunTest.phase) {
            .collection => {
                try bunTest.collection.enqueueTestCallback(globalObject, name, callback, .{ .self_concurrent = true });
                return .js_undefined;
            },
            .execution => {
                return globalObject.throw("TODO: queue this test callback to call after this test ends", .{});
            },
            .done => return globalObject.throw("Cannot call test() after the test run has completed", .{}),
        }
    }

    pub fn genericHook(comptime tag: @Type(.enum_literal)) type {
        return struct {
            pub fn hookFn(globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
                group.begin(@src());
                defer group.end();
                errdefer group.log("ended in error", .{});

                const vm = globalObject.bunVM();
                if (vm.is_in_preload or bun.jsc.Jest.Jest.runner == null) {
                    @panic("TODO return Bun__Jest__testPreloadObject(globalObject)");
                }
                if (bun.jsc.Jest.Jest.runner.?.describe2 == null) {
                    return globalObject.throw("The describe2 was already forDebuggingDeinitNow-ed", .{});
                }
                const bunTest = &bun.jsc.Jest.Jest.runner.?.describe2.?;

                const callback = callFrame.argumentsAsArray(1)[0];

                switch (bunTest.phase) {
                    .collection => {
                        try bunTest.collection.enqueueHookCallback(globalObject, tag, callback);
                        return .js_undefined;
                    },
                    .execution => {
                        return globalObject.throw("Cannot call beforeAll/beforeEach/afterEach/afterAll() inside a test", .{});
                    },
                    .done => return globalObject.throw("Cannot call beforeAll/beforeEach/afterEach/afterAll() after the test run has completed", .{}),
                }
            }
        };
    }

    pub fn forDebuggingExecuteTestsNow(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        group.begin(@src());
        defer group.end();
        errdefer group.log("ended in error", .{});

        const vm = globalObject.bunVM();
        if (vm.is_in_preload or bun.jsc.Jest.Jest.runner == null) {
            @panic("TODO return Bun__Jest__testPreloadObject(globalObject)");
        }
        if (bun.jsc.Jest.Jest.runner.?.describe2 == null) {
            return globalObject.throw("The describe2 was already forDebuggingDeinitNow-ed", .{});
        }
        const buntest = &bun.jsc.Jest.Jest.runner.?.describe2.?;

        try buntest.run(globalObject);

        _ = callframe;

        if (buntest.phase == .done) return .js_undefined;
        if (buntest.done_promise.get() == null) {
            _ = buntest.done_promise.swap(buntest.gpa, jsc.JSPromise.create(globalObject).toJS());
        }
        return buntest.done_promise.get().?; // TODO: return a promise that resolves when done
    }

    pub fn forDebuggingDeinitNow(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        group.begin(@src());
        defer group.end();
        errdefer group.log("ended in error", .{});

        const vm = globalObject.bunVM();
        if (vm.is_in_preload or bun.jsc.Jest.Jest.runner == null) {
            @panic("TODO return Bun__Jest__testPreloadObject(globalObject)");
        }
        if (bun.jsc.Jest.Jest.runner.?.describe2 == null) {
            return globalObject.throw("The describe2 was already forDebuggingDeinitNow-ed", .{});
        }
        if (bun.jsc.Jest.Jest.runner.?.describe2.?.phase != .done) {
            return globalObject.throw("Cannot call forDebuggingDeinitNow() before the test run has completed", .{});
        }
        bun.jsc.Jest.Jest.runner.?.describe2.?.deinit();
        bun.jsc.Jest.Jest.runner.?.describe2 = null;
        _ = callframe;
        return .js_undefined;
    }
};

/// this will be a JSValue (returned by `Bun.jest(...)`). there will be one per file. they will be gc objects and cleaned up when no longer used.
pub const BunTest = struct {
    in_run_loop: bool,
    allocation_scope: *bun.AllocationScope,
    gpa: std.mem.Allocator,
    done_promise: Strong.Optional = .empty,

    phase: enum {
        collection,
        execution,
        done,
    },
    collection: Collection,
    execution: Execution,

    pub fn init(outer_gpa: std.mem.Allocator) BunTest {
        group.begin(@src());
        defer group.end();

        var allocation_scope = bun.create(outer_gpa, bun.AllocationScope, bun.AllocationScope.init(outer_gpa));
        const gpa = allocation_scope.allocator();
        return .{
            .in_run_loop = false,
            .allocation_scope = allocation_scope,
            .gpa = gpa,
            .phase = .collection,
            .collection = .init(gpa),
            .execution = .init(gpa),
        };
    }
    pub fn deinit(this: *BunTest) void {
        group.begin(@src());
        defer group.end();

        this.done_promise.deinit();
        this.execution.deinit();
        this.collection.deinit();
        const backing = this.allocation_scope.parent;
        this.allocation_scope.deinit();
        // TODO: consider making a StrongScope to ensure jsc.Strong values are deinitialized, or requiring a gpa for a strong that is used in asan builds for safety?
        backing.destroy(this.allocation_scope);
    }

    const RefData = struct {
        buntest: *BunTest,
        data: u64,
        pub fn deinit(this: *RefData) void {
            // TODO jsvalue(this).unprotect()
            this.buntest.gpa.destroy(this);
        }
    };
    pub fn ref(this: *BunTest, data: u64) *anyopaque {
        // TODO jsvalue(this).protect()
        return bun.create(this.gpa, RefData, .{ .buntest = this, .data = data });
    }

    pub fn getFile(_: *BunTest) []const u8 {
        return "/TODO/"; // TODO: store the file name (each file has its own BunTest instance)
    }
    pub fn getReporter(_: *BunTest) ?test_command.FileReporter {
        return null; // TODO: get the reporter
    }

    export const Bun__TestScope__Describe2__bunTestThen = jsc.toJSHostFn(bunTestThen);
    export const Bun__TestScope__Describe2__bunTestCatch = jsc.toJSHostFn(bunTestCatch);
    fn bunTestThenOrCatch(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, is_catch: bool) bun.JSError!jsc.JSValue {
        group.begin(@src());
        defer group.end();
        errdefer group.log("ended in error", .{});

        const result, const this_ptr = callframe.argumentsAsArray(2);

        const refdata: *RefData = this_ptr.asPromisePtr(RefData);
        defer refdata.deinit();
        const this = refdata.buntest;

        try this.runOneCompleted(globalThis, is_catch, result, refdata.data);
        try this.run(globalThis);
        return .js_undefined;
    }
    fn bunTestThen(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return bunTestThenOrCatch(globalThis, callframe, false);
    }
    fn bunTestCatch(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return bunTestThenOrCatch(globalThis, callframe, true);
    }
    fn addThen(this: *BunTest, globalThis: *jsc.JSGlobalObject, promise: jsc.JSValue, data: u64) void {
        promise.then(globalThis, this.ref(data), bunTestThen, bunTestCatch); // TODO: this function is odd. it requires manually exporting the describeCallbackThen as a toJSHostFn and also adding logic in c++
    }

    pub fn run(this: *BunTest, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
        group.begin(@src());
        defer group.end();

        if (this.in_run_loop) return; // already running. this can happen because of waitForPromise. the promise will resolve inside the waitForPromise and call run() from bunTestThenOrCatch.
        this.in_run_loop = true;
        defer this.in_run_loop = false;

        var callback_queue: CallbackQueue = .init(this.gpa);
        defer callback_queue.deinit();

        while (true) {
            defer callback_queue.clearRetainingCapacity();
            defer for (callback_queue.items) |*item| item.callback.deinit();

            const status = switch (this.phase) {
                .collection => try this.collection.runOne(globalThis, &callback_queue),
                .execution => try this.execution.runOne(globalThis, &callback_queue),
                .done => .done,
            };
            group.log("-> runOne status: {s}", .{@tagName(status)});
            if (status == .done) {
                group.log("-> advancing", .{});
                bun.assert(callback_queue.items.len == 0);
                if (try this._advance(globalThis) == .exit) {
                    return;
                } else {
                    continue;
                }
            }
            // if one says continue_async and two say continue_sync then you continue_sync
            // if two say continue_async then you continue_async
            // if there are zero then you continue_sync
            group.log("-> executing", .{});
            var final_result: CallNowResult = .continue_async;
            for (callback_queue.items) |entry| {
                const result = try this._callTestCallbackNow(globalThis, entry);
                group.log("callTestCallbackNow -> {s}", .{@tagName(result)});
                switch (result) {
                    .continue_sync => final_result = .continue_sync,
                    .continue_async => {},
                }
            }

            group.log("-> final_result: {s}", .{@tagName(final_result)});
            switch (final_result) {
                .continue_sync => continue,
                .continue_async => return,
            }
            comptime unreachable;
        }
        comptime unreachable;
    }

    fn _advance(this: *BunTest, globalThis: *jsc.JSGlobalObject) bun.JSError!enum { cont, exit } {
        group.begin(@src());
        defer group.end();
        group.log("advance from {s}", .{@tagName(this.phase)});
        defer group.log("advance -> {s}", .{@tagName(this.phase)});

        switch (this.phase) {
            .collection => {
                // collection phase is complete. advance to execution phase, then continue.
                // re-entry safety:
                // - use ScriptDisallowedScope::InMainThread

                // here:
                // - assert the collection phase is complete, then lock the collection phase
                // - apply filters (`-t`)
                // - apply `.only`
                // - remove orphaned beforeAll/afterAll items, only if any items have been removed so far (e.g. because of `.only` or `-t`)
                // - reorder (`--randomize`)
                // now, generate the execution order
                this.phase = .execution;
                try Execution.dumpDescribe(globalThis, this.collection.root_scope);
                try this.execution.generateOrderDescribe(this.collection.root_scope);
                try this.execution.dumpOrder(globalThis);
                // now, allowing js execution again:
                // - start the test execution loop

                // test execution:
                // - one at a time
                // - timeout handling
                return .cont;
            },
            .execution => {
                // execution phase is complete. print results.

                if (this.done_promise.get()) |value| if (value.asPromise()) |promise| promise.resolve(globalThis, .js_undefined);
                this.in_run_loop = false;
                this.phase = .done;

                return .exit;
            },
            .done => return .exit,
        }
    }

    fn runOneCompleted(this: *BunTest, globalThis: *jsc.JSGlobalObject, result_is_error: bool, result_value: jsc.JSValue, data: u64) bun.JSError!void {
        switch (this.phase) {
            .collection => try this.collection.runOneCompleted(globalThis, result_is_error, result_value, data),
            .execution => try this.execution.runOneCompleted(globalThis, result_is_error, result_value, data),
            .done => bun.debugAssert(false),
        }
    }

    const CallNowResult = enum {
        continue_sync,
        continue_async,
    };
    fn _callTestCallbackNow(this: *BunTest, globalThis: *jsc.JSGlobalObject, cfg: CallbackEntry) bun.JSError!CallNowResult {
        group.begin(@src());
        defer group.end();

        // TODO: this will need to support:
        // - in tests, (done) => {} callbacks
        // - for test.concurrent, we will have multiple 'then's active at once, and they will
        //   need to be able to pass context information to runOneCompleted

        if (cfg.done_parameter) {
            const length = try cfg.callback.get().getLength(globalThis);
            if (length > 0) {
                // TODO: support done parameter
                group.log("TODO: support done parameter", .{});
            }
        }

        var is_error = false;
        const result = cfg.callback.get().call(globalThis, .js_undefined, &.{}) catch |e| blk: {
            group.log("callTestCallback -> error", .{});
            is_error = true;
            break :blk globalThis.takeError(e);
        };

        if (!is_error and result.asPromise() != null) {
            group.log("callTestCallback -> promise", .{});
            this.addThen(globalThis, result, cfg.data);
            return .continue_async;
        }

        group.log("callTestCallback -> sync", .{});
        try this.runOneCompleted(globalThis, is_error, result, cfg.data);
        return .continue_sync;
    }
};

pub const CallbackQueue = std.ArrayList(CallbackEntry);

pub const CallbackEntry = struct {
    callback: Strong,
    done_parameter: bool,
    data: u64,
};

pub const Collection = @import("./Collection.zig");

pub const DescribeScope = struct {
    parent: ?*DescribeScope,
    entries: std.ArrayList(TestScheduleEntry),
    beforeAll: std.ArrayList(*ExecutionEntry),
    beforeEach: std.ArrayList(*ExecutionEntry),
    afterEach: std.ArrayList(*ExecutionEntry),
    afterAll: std.ArrayList(*ExecutionEntry),
    name: Strong.Optional,
    concurrent: bool,

    pub fn init(gpa: std.mem.Allocator, parent: ?*DescribeScope, self_concurrent: bool) DescribeScope {
        return .{
            .entries = .init(gpa),
            .beforeEach = .init(gpa),
            .beforeAll = .init(gpa),
            .afterAll = .init(gpa),
            .afterEach = .init(gpa),
            .parent = parent,
            .name = .empty,
            .concurrent = self_concurrent or if (parent) |p| p.concurrent else false,
        };
    }
    pub fn destroy(this: *DescribeScope, buntest: *BunTest) void {
        for (this.entries.items) |*entry| entry.deinit(buntest);
        for (this.beforeAll.items) |item| item.destroy(buntest);
        for (this.beforeEach.items) |item| item.destroy(buntest);
        for (this.afterAll.items) |item| item.destroy(buntest);
        for (this.afterEach.items) |item| item.destroy(buntest);
        this.entries.deinit();
        this.beforeAll.deinit();
        this.beforeEach.deinit();
        this.afterAll.deinit();
        this.afterEach.deinit();
        this.name.deinit();
        buntest.gpa.destroy(this);
    }
};
pub const ExecutionEntryTag = enum {
    test_callback,
    beforeAll,
    beforeEach,
    afterEach,
    afterAll,
};
pub const ExecutionEntry = struct {
    parent: *DescribeScope,
    tag: ExecutionEntryTag,
    callback: Strong,
    name: Strong.Optional,
    concurrent: bool,
    pub fn destroy(this: *ExecutionEntry, buntest: *BunTest) void {
        this.callback.deinit();
        this.name.deinit();
        buntest.gpa.destroy(this);
    }
    pub fn getName(_: *ExecutionEntry) ?[]const u8 {
        return null; // TODO: store the name as a string rather than a Strong.Optional
    }
};
pub const TestScheduleEntry = union(enum) {
    describe: *DescribeScope,
    test_callback: *ExecutionEntry,
    fn deinit(
        this: *TestScheduleEntry,
        buntest: *BunTest,
    ) void {
        switch (this.*) {
            .describe => |describe| describe.destroy(buntest),
            .test_callback => |test_scope| test_scope.destroy(buntest),
        }
    }
};
pub const RunOneResult = enum {
    done,
    execute,
};

pub const Execution = @import("./Execution.zig");

pub const group = struct {
    fn printIndent() void {
        std.io.getStdOut().writer().print("\x1b[90m", .{}) catch {};
        for (0..indent) |_| {
            std.io.getStdOut().writer().print("│ ", .{}) catch {};
        }
        std.io.getStdOut().writer().print("\x1b[m", .{}) catch {};
    }
    var indent: usize = 0;
    var last_was_start = false;
    var wants_quiet: ?bool = null;
    fn getWantsQuiet() bool {
        if (wants_quiet) |v| return v;
        if (bun.getenvZ("WANTS_QUIET")) |val| {
            if (!std.mem.eql(u8, val, "0")) {
                wants_quiet = true;
                return wants_quiet.?;
            }
        }
        wants_quiet = false;
        return wants_quiet.?;
    }
    pub fn begin(pos: std.builtin.SourceLocation) void {
        return beginMsg("\x1b[36m{s}\x1b[37m:\x1b[93m{d}\x1b[37m:\x1b[33m{d}\x1b[37m: \x1b[35m{s}\x1b[m", .{ pos.file, pos.line, pos.column, pos.fn_name });
    }
    pub fn beginMsg(comptime fmtt: []const u8, args: anytype) void {
        if (getWantsQuiet()) return;
        printIndent();
        std.io.getStdOut().writer().print("\x1b[32m++ \x1b[0m", .{}) catch {};
        std.io.getStdOut().writer().print(fmtt ++ "\n", args) catch {};
        indent += 1;
        last_was_start = true;
    }
    pub fn end() void {
        if (getWantsQuiet()) return;
        indent -= 1;
        defer last_was_start = false;
        if (last_was_start) return; //std.io.getStdOut().writer().print("\x1b[A", .{}) catch {};
        printIndent();
        std.io.getStdOut().writer().print("\x1b[32m{s}\x1b[m\n", .{if (last_was_start) "+-" else "--"}) catch {};
    }
    pub fn log(comptime fmtt: []const u8, args: anytype) void {
        if (getWantsQuiet()) return;
        printIndent();
        std.io.getStdOut().writer().print(fmtt ++ "\n", args) catch {};
        last_was_start = false;
    }
};

const std = @import("std");
const test_command = @import("../../cli/test_command.zig");

const bun = @import("bun");
const jsc = bun.jsc;
const Strong = jsc.Strong.Safe;
