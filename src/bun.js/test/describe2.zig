pub const js_fns = struct {
    pub fn describeFn(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
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
                try bunTest.collection.enqueueDescribeCallback(globalObject, name, callback);
                return .js_undefined; // vitest doesn't return a promise, even for `describe(async () => {})`
            },
            .execution => {
                return globalObject.throw("Cannot call describe() inside a test", .{});
            },
        }
    }

    pub fn testFn(globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
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
                try bunTest.collection.enqueueTestCallback(globalObject, name, callback);
                return .js_undefined;
            },
            .execution => {
                return globalObject.throw("TODO: queue this test callback to call after this test ends", .{});
            },
        }
    }

    pub fn genericHook(comptime tag: @Type(.enum_literal)) type {
        return struct {
            pub fn hookFn(globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
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
                }
            }
        };
    }

    pub fn forDebuggingExecuteTestsNow(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
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

        if (buntest.done_promise.get() == null) {
            _ = buntest.done_promise.swap(buntest.gpa, jsc.JSPromise.create(globalObject).toJS());
        }
        return buntest.done_promise.get().?; // TODO: return a promise that resolves when done
    }
};

/// this will be a JSValue (returned by `Bun.jest(...)`). there will be one per file. they will be gc objects and cleaned up when no longer used.
pub const BunTest = struct {
    executing: bool,
    allocation_scope: *bun.AllocationScope,
    gpa: std.mem.Allocator,
    done_promise: Strong.Optional = .empty,

    phase: enum {
        collection,
        execution,
    },
    collection: Collection,
    execution: Execution,

    pub fn init(outer_gpa: std.mem.Allocator) BunTest {
        group.begin(@src());
        defer group.end();

        var allocation_scope = bun.create(outer_gpa, bun.AllocationScope, bun.AllocationScope.init(outer_gpa));
        const gpa = allocation_scope.allocator();
        return .{
            .executing = false,
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

    pub fn ref(this: *BunTest) *anyopaque {
        // TODO jsvalue(this).protect()
        return this;
    }
    pub fn unref(this: *BunTest) void {
        // TODO jsvalue(this).unprotect()
        _ = this;
    }

    export const Bun__TestScope__Describe2__bunTestThen = jsc.toJSHostFn(bunTestThen);
    export const Bun__TestScope__Describe2__bunTestCatch = jsc.toJSHostFn(bunTestCatch);
    fn bunTestThenOrCatch(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, is_catch: bool) bun.JSError!jsc.JSValue {
        group.begin(@src());
        defer group.end();

        const result, const this_ptr = callframe.argumentsAsArray(2);

        var this: *BunTest = this_ptr.asPromisePtr(BunTest);
        defer this.unref();

        try this.runOneCompleted(globalThis, is_catch, result);

        this.executing = false;
        try this.run(globalThis);
        return .js_undefined;
    }
    fn bunTestThen(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return bunTestThenOrCatch(globalThis, callframe, false);
    }
    fn bunTestCatch(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return bunTestThenOrCatch(globalThis, callframe, true);
    }
    fn addThen(this: *BunTest, globalThis: *jsc.JSGlobalObject, promise: jsc.JSValue, concurrent: bool) void {
        if (concurrent) @panic("TODO: implement concurrent");
        promise.then(globalThis, this.ref(), bunTestThen, bunTestCatch); // TODO: this function is odd. it requires manually exporting the describeCallbackThen as a toJSHostFn and also adding logic in c++
    }

    pub fn run(this: *BunTest, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
        group.begin(@src());
        defer group.end();

        if (this.executing) return; // already running
        this.executing = true;

        while (true) {
            const result = switch (this.phase) {
                .collection => try this.collection.runOne(globalThis),
                .execution => try this.execution.runOne(globalThis),
            };
            group.log("runOne -> {s}", .{@tagName(result)});
            switch (result) {
                .continue_async => return, // continue in 'then' callback
                .continue_sync => {},
                .done => if (try this._advance(globalThis) == .exit) return,
            }
        }

        comptime unreachable;
    }

    fn _advance(this: *BunTest, globalThis: *jsc.JSGlobalObject) bun.JSError!enum { cont, exit } {
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
                var order = std.ArrayList(*ExecutionEntry).init(this.gpa);
                defer order.deinit();
                try Execution.generateOrderDescribe(this.collection.root_scope, &order);
                this.execution.order = try order.toOwnedSlice();
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

                this.executing = false;
                this.deinit();
                bun.jsc.Jest.Jest.runner.?.describe2 = null;
                return .exit;
            },
        }
    }

    fn runOneCompleted(this: *BunTest, globalThis: *jsc.JSGlobalObject, result_is_error: bool, result_value: jsc.JSValue) bun.JSError!void {
        switch (this.phase) {
            .collection => try this.collection.runOneCompleted(globalThis, result_is_error, result_value),
            .execution => try this.execution.runOneCompleted(globalThis, result_is_error, result_value),
        }
    }

    pub fn callTestCallback(this: *BunTest, globalThis: *jsc.JSGlobalObject, callback: jsc.JSValue, cfg: struct { done_parameter: bool, concurrent: bool }) bun.JSError!RunOneResult {
        group.begin(@src());
        defer group.end();

        // TODO: this will need to support:
        // - in tests, (done) => {} callbacks
        // - for test.concurrent, we will have multiple 'then's active at once, and they will
        //   need to be able to pass context information to runOneCompleted

        if (cfg.done_parameter) {
            const length = try callback.getLength(globalThis);
            if (length > 0) {
                // TODO: support done parameter
                group.log("TODO: support done parameter", .{});
            }
        }

        var is_error = false;
        const result = callback.call(globalThis, .js_undefined, &.{}) catch |e| blk: {
            group.log("callTestCallback -> error", .{});
            is_error = true;
            break :blk globalThis.takeError(e);
        };

        if (!is_error and result.asPromise() != null) {
            group.log("callTestCallback -> promise", .{});
            this.addThen(globalThis, result, cfg.concurrent);
            return .continue_async;
        }

        group.log("callTestCallback -> sync", .{});
        try this.runOneCompleted(globalThis, is_error, result);
        return .continue_sync;
    }
};

pub const RunOneResult = enum {
    done,
    continue_sync,
    continue_async,
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

    pub fn init(gpa: std.mem.Allocator, parent: ?*DescribeScope) DescribeScope {
        return .{
            .entries = .init(gpa),
            .beforeEach = .init(gpa),
            .beforeAll = .init(gpa),
            .afterAll = .init(gpa),
            .afterEach = .init(gpa),
            .parent = parent,
            .name = .empty,
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

    executing,
    pass,
    fail,
    skip,
    todo,
    timeout,
    skipped_because_label,
    fail_because_failing_test_passed,
    fail_because_todo_passed,
    fail_because_expected_has_assertions,
    fail_because_expected_assertion_count,

    pub fn isCalledMultipleTimes(this: @This()) bool {
        return switch (this) {
            .beforeEach, .afterEach => true,
            else => false,
        };
    }
    pub fn shouldExecute(this: @This()) bool {
        return switch (this) {
            .test_callback, .beforeAll, .beforeEach, .afterEach, .afterAll => true,
            .skip, .todo, .skipped_because_label => false,
            .executing, .pass, .fail, .timeout, .fail_because_failing_test_passed, .fail_because_todo_passed, .fail_because_expected_has_assertions, .fail_because_expected_assertion_count => {
                bun.assert(false);
                return false;
            },
        };
    }
};
pub const ExecutionEntry = struct {
    parent: *DescribeScope,
    tag: ExecutionEntryTag,
    callback: Strong.Optional,
    pub fn destroy(this: *ExecutionEntry, buntest: *BunTest) void {
        this.callback.deinit();
        buntest.gpa.destroy(this);
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
        if (getWantsQuiet()) return;
        printIndent();
        std.io.getStdOut().writer().print("\x1b[32m++ \x1b[36m{s}\x1b[37m:\x1b[93m{d}\x1b[37m:\x1b[33m{d}\x1b[37m: \x1b[35m{s}\x1b[m\n", .{ pos.file, pos.line, pos.column, pos.fn_name }) catch {};
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

const Strong = struct {
    _raw: jsc.JSValue,
    _safety: Safety,
    const enable_safety = bun.Environment.ci_assert;
    const Safety = if (enable_safety) ?struct { ptr: *Strong, gpa: std.mem.Allocator } else void;
    pub fn initNonCell(non_cell: jsc.JSValue) Strong {
        bun.assert(!non_cell.isCell());
        const safety: Safety = if (enable_safety) null;
        return .{ ._raw = non_cell, ._safety = safety };
    }
    pub fn init(safety_gpa: std.mem.Allocator, value: jsc.JSValue) Strong {
        value.protect();
        const safety: Safety = if (enable_safety) .{ .ptr = bun.create(safety_gpa, Strong, .{ ._raw = @enumFromInt(0xAEBCFA), ._safety = null }), .gpa = safety_gpa };
        return .{ ._raw = value, ._safety = safety };
    }
    pub fn deinit(this: *Strong) void {
        this._raw.unprotect();
        if (enable_safety) if (this._safety) |safety| {
            bun.assert(@intFromEnum(safety.ptr.*._raw) == 0xAEBCFA);
            safety.gpa.destroy(safety.ptr);
        };
    }
    pub fn get(this: Strong) jsc.JSValue {
        return this._raw;
    }
    pub fn swap(this: *Strong, safety_gpa: std.mem.Allocator, next: jsc.JSValue) jsc.JSValue {
        const prev = this._raw;
        this.deinit();
        this.* = .init(safety_gpa, next);
        return prev;
    }

    const Optional = struct {
        _backing: Strong,
        pub const empty: Optional = .{ ._backing = .initNonCell(.zero) };
        pub fn initNonCell(non_cell: jsc.JSValue) Optional {
            return .{ ._backing = .initNonCell(non_cell) };
        }
        pub fn init(safety_gpa: std.mem.Allocator, value: jsc.JSValue) Optional {
            return .{ ._backing = .init(safety_gpa, value) };
        }
        pub fn deinit(this: *Optional) void {
            this._backing.deinit();
        }
        pub fn get(this: Optional) ?jsc.JSValue {
            const result = this._backing.get();
            if (result == .zero) return null;
            return result;
        }
        pub fn swap(this: *Optional, safety_gpa: std.mem.Allocator, next: ?jsc.JSValue) ?jsc.JSValue {
            const result = this._backing.swap(safety_gpa, next orelse .zero);
            if (result == .zero) return null;
            return result;
        }
        pub fn has(this: Optional) bool {
            return this._backing.get() != .zero;
        }
    };
};

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
