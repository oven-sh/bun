pub fn cloneActiveStrong() ?BunTestPtr {
    const runner = bun.jsc.Jest.Jest.runner orelse return null;
    return runner.bun_test_root.cloneActiveFile();
}

pub const DoneCallback = @import("./DoneCallback.zig");

pub const js_fns = struct {
    pub const Signature = union(enum) {
        scope_functions: *const ScopeFunctions,
        str: []const u8,
        pub fn format(this: Signature, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            switch (this) {
                .scope_functions => try writer.print("{}", .{this.scope_functions.*}),
                .str => try writer.print("{s}", .{this.str}),
            }
        }
    };
    const GetActiveCfg = struct { signature: Signature, allow_in_preload: bool };
    fn getActiveTestRoot(globalThis: *jsc.JSGlobalObject, cfg: GetActiveCfg) bun.JSError!*BunTestRoot {
        if (bun.jsc.Jest.Jest.runner == null) {
            return globalThis.throw("Cannot use {s} outside of the test runner. Run \"bun test\" to run tests.", .{cfg.signature});
        }
        const bunTestRoot = &bun.jsc.Jest.Jest.runner.?.bun_test_root;
        const vm = globalThis.bunVM();
        if (vm.is_in_preload and !cfg.allow_in_preload) {
            return globalThis.throw("Cannot use {s} during preload.", .{cfg.signature});
        }
        return bunTestRoot;
    }
    pub fn cloneActiveStrong(globalThis: *jsc.JSGlobalObject, cfg: GetActiveCfg) bun.JSError!BunTestPtr {
        const bunTestRoot = try getActiveTestRoot(globalThis, cfg);
        const bunTest = bunTestRoot.cloneActiveFile() orelse {
            return globalThis.throw("Cannot use {s} outside of a test file.", .{cfg.signature});
        };

        return bunTest;
    }

    pub fn genericHook(comptime tag: @Type(.enum_literal)) type {
        return struct {
            pub fn hookFn(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
                group.begin(@src());
                defer group.end();
                errdefer group.log("ended in error", .{});

                var args = try ScopeFunctions.parseArguments(globalThis, callFrame, .{ .str = @tagName(tag) ++ "()" }, bun.default_allocator, .{ .callback = .require });
                defer args.deinit(bun.default_allocator);

                const has_done_parameter = if (args.callback) |callback| try callback.getLength(globalThis) > 0 else false;

                const bunTestRoot = try getActiveTestRoot(globalThis, .{ .signature = .{ .str = @tagName(tag) ++ "()" }, .allow_in_preload = true });

                const bunTest = bunTestRoot.getActiveFileUnlessInPreload(globalThis.bunVM()) orelse {
                    group.log("genericHook in preload", .{});

                    _ = try bunTestRoot.hook_scope.appendHook(bunTestRoot.gpa, tag, args.callback, .{
                        .has_done_parameter = has_done_parameter,
                        .timeout = args.options.timeout,
                    }, .{});
                    return .js_undefined;
                };

                switch (bunTest.phase) {
                    .collection => {
                        _ = try bunTest.collection.active_scope.appendHook(bunTest.gpa, tag, args.callback, .{
                            .has_done_parameter = has_done_parameter,
                            .timeout = args.options.timeout,
                        }, .{});

                        return .js_undefined;
                    },
                    .execution => {
                        return globalThis.throw("Cannot call {s}() inside a test. Call it inside describe() instead.", .{@tagName(tag)});
                    },
                    .done => return globalThis.throw("Cannot call {s}() after the test run has completed", .{@tagName(tag)}),
                }
            }
        };
    }
};

pub const BunTestPtr = bun.ptr.shared.WithOptions(*BunTest, .{
    .allow_weak = true,
    .Allocator = bun.DefaultAllocator,
});
pub const BunTestRoot = struct {
    gpa: std.mem.Allocator,
    active_file: BunTestPtr.Optional,

    hook_scope: *DescribeScope,

    pub fn init(outer_gpa: std.mem.Allocator) BunTestRoot {
        const gpa = outer_gpa;
        const hook_scope = DescribeScope.create(gpa, .{
            .parent = null,
            .name = null,
            .concurrent = false,
            .mode = .normal,
            .only = .no,
            .has_callback = false,
            .test_id_for_debugger = 0,
            .line_no = 0,
        });
        return .{
            .gpa = outer_gpa,
            .active_file = .initNull(),
            .hook_scope = hook_scope,
        };
    }
    pub fn deinit(this: *BunTestRoot) void {
        bun.assert(this.hook_scope.entries.items.len == 0); // entries must not be appended to the hook_scope
        this.hook_scope.destroy(this.gpa);
        bun.assert(this.active_file == null);
    }

    pub fn enterFile(this: *BunTestRoot, file_id: jsc.Jest.TestRunner.File.ID, reporter: *test_command.CommandLineReporter) void {
        group.begin(@src());
        defer group.end();

        bun.assert(this.active_file.get() == null);

        this.active_file = .new(undefined);
        this.active_file.get().?.init(this.gpa, this, file_id, reporter);
    }
    pub fn exitFile(this: *BunTestRoot) void {
        group.begin(@src());
        defer group.end();

        bun.assert(this.active_file.get() != null);
        this.active_file.get().?.reporter = null;
        this.active_file.deinit();
        this.active_file = .initNull();
    }
    pub fn getActiveFileUnlessInPreload(this: *BunTestRoot, vm: *jsc.VirtualMachine) ?*BunTest {
        if (vm.is_in_preload) {
            return null;
        }
        return this.active_file.get();
    }
    pub fn cloneActiveFile(this: *BunTestRoot) ?BunTestPtr {
        var clone = this.active_file.clone();
        return clone.take();
    }
};

pub const BunTest = struct {
    buntest: *BunTestRoot,
    in_run_loop: bool,
    allocation_scope: bun.AllocationScope,
    gpa: std.mem.Allocator,
    arena_allocator: std.heap.ArenaAllocator,
    arena: std.mem.Allocator,
    file_id: jsc.Jest.TestRunner.File.ID,
    /// null if the runner has moved on to the next file
    reporter: ?*test_command.CommandLineReporter,
    timer: bun.api.Timer.EventLoopTimer = .{ .next = .epoch, .tag = .BunTest },
    result_queue: ResultQueue,

    phase: enum {
        collection,
        execution,
        done,
    },
    collection: Collection,
    execution: Execution,

    pub fn init(this: *BunTest, outer_gpa: std.mem.Allocator, bunTest: *BunTestRoot, file_id: jsc.Jest.TestRunner.File.ID, reporter: *test_command.CommandLineReporter) void {
        group.begin(@src());
        defer group.end();

        this.allocation_scope = .init(outer_gpa);
        this.gpa = this.allocation_scope.allocator();
        this.arena_allocator = .init(this.gpa);
        this.arena = this.arena_allocator.allocator();

        this.* = .{
            .buntest = bunTest,
            .in_run_loop = false,
            .allocation_scope = this.allocation_scope,
            .gpa = this.gpa,
            .arena_allocator = this.arena_allocator,
            .arena = this.arena,
            .phase = .collection,
            .file_id = file_id,
            .collection = .init(this.gpa, bunTest),
            .execution = .init(this.gpa),
            .reporter = reporter,
            .result_queue = .init(this.gpa),
        };
    }
    pub fn deinit(this: *BunTest) void {
        group.begin(@src());
        defer group.end();

        if (this.timer.state == .ACTIVE) {
            // must remove an active timer to prevent UAF (if the timer were to trigger after BunTest deinit)
            bun.jsc.VirtualMachine.get().timer.remove(&this.timer);
        }

        this.execution.deinit();
        this.collection.deinit();
        this.result_queue.deinit();
        this.arena_allocator.deinit();
        this.allocation_scope.deinit();
    }

    pub const RefDataValue = union(enum) {
        start,
        collection: struct {
            active_scope: *DescribeScope,
        },
        execution: struct {
            group_index: usize,
            entry_data: ?struct {
                sequence_index: usize,
                entry_index: usize,
                remaining_repeat_count: i64,
            },
        },
        done: struct {},

        pub fn group(this: *const RefDataValue, buntest: *BunTest) ?*Execution.ConcurrentGroup {
            if (this.* != .execution) return null;
            return &buntest.execution.groups[this.execution.group_index];
        }
        pub fn sequence(this: *const RefDataValue, buntest: *BunTest) ?*Execution.ExecutionSequence {
            if (this.* != .execution) return null;
            const group_item = this.group(buntest) orelse return null;
            const entry_data = this.execution.entry_data orelse return null;
            return &group_item.sequences(&buntest.execution)[entry_data.sequence_index];
        }
        pub fn entry(this: *const RefDataValue, buntest: *BunTest) ?*ExecutionEntry {
            if (this.* != .execution) return null;
            const sequence_item = this.sequence(buntest) orelse return null;
            const entry_data = this.execution.entry_data orelse return null;
            return sequence_item.entries(&buntest.execution)[entry_data.entry_index];
        }

        pub fn format(this: *const RefDataValue, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            switch (this.*) {
                .start => try writer.print("start", .{}),
                .collection => try writer.print("collection: active_scope={?s}", .{this.collection.active_scope.base.name}),
                .execution => if (this.execution.entry_data) |entry_data| {
                    try writer.print("execution: group_index={d},sequence_index={d},entry_index={d},remaining_repeat_count={d}", .{ this.execution.group_index, entry_data.sequence_index, entry_data.entry_index, entry_data.remaining_repeat_count });
                } else try writer.print("execution: group_index={d}", .{this.execution.group_index}),
                .done => try writer.print("done", .{}),
            }
        }
    };
    pub const RefData = struct {
        buntest_weak: BunTestPtr.Weak,
        phase: RefDataValue,
        ref_count: RefCount,
        const RefCount = bun.ptr.RefCount(RefData, "ref_count", #destroy, .{});

        pub const deref = RefCount.deref;
        pub fn dupe(this: *RefData) *RefData {
            RefCount.ref(this);
            return this;
        }
        pub fn hasOneRef(this: *RefData) bool {
            return this.ref_count.hasOneRef();
        }
        fn #destroy(this: *RefData) void {
            group.begin(@src());
            defer group.end();
            group.log("refData: {}", .{this.phase});

            var buntest_weak = this.buntest_weak;
            bun.destroy(this);
            buntest_weak.deinit();
        }
        pub fn bunTest(this: *RefData) ?*BunTest {
            var buntest_strong = this.buntest_weak.clone().upgrade() orelse return null;
            defer buntest_strong.deinit();
            return buntest_strong.get();
        }
    };
    pub fn getCurrentStateData(this: *BunTest) RefDataValue {
        return switch (this.phase) {
            .collection => .{ .collection = .{ .active_scope = this.collection.active_scope } },
            .execution => blk: {
                const active_group = this.execution.activeGroup() orelse {
                    bun.debugAssert(false); // should have switched phase if we're calling getCurrentStateData, but it could happen with re-entry maybe
                    break :blk .{ .done = .{} };
                };
                const sequences = active_group.sequences(&this.execution);
                if (sequences.len != 1) break :blk .{
                    .execution = .{
                        .group_index = this.execution.group_index,
                        .entry_data = null, // the current execution entry is not known because we are running a concurrent test
                    },
                };

                const active_sequence_index = 0;
                const sequence = &sequences[active_sequence_index];

                break :blk .{ .execution = .{
                    .group_index = this.execution.group_index,
                    .entry_data = .{
                        .sequence_index = active_sequence_index,
                        .entry_index = sequence.active_index,
                        .remaining_repeat_count = sequence.remaining_repeat_count,
                    },
                } };
            },
            .done => .{ .done = .{} },
        };
    }
    pub fn ref(this_strong: BunTestPtr, phase: RefDataValue) *RefData {
        group.begin(@src());
        defer group.end();
        group.log("ref: {}", .{phase});

        return bun.new(RefData, .{
            .buntest_weak = this_strong.cloneWeak(),
            .phase = phase,
            .ref_count = .init(),
        });
    }

    export const Bun__TestScope__Describe2__bunTestThen = jsc.toJSHostFn(bunTestThen);
    export const Bun__TestScope__Describe2__bunTestCatch = jsc.toJSHostFn(bunTestCatch);
    fn bunTestThenOrCatch(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, is_catch: bool) bun.JSError!void {
        group.begin(@src());
        defer group.end();
        errdefer group.log("ended in error", .{});

        const result, const this_ptr = callframe.argumentsAsArray(2);

        const refdata: *RefData = this_ptr.asPromisePtr(RefData);
        defer refdata.deref();
        const has_one_ref = refdata.ref_count.hasOneRef();
        var this_strong = refdata.buntest_weak.clone().upgrade() orelse return group.log("bunTestThenOrCatch -> the BunTest is no longer active", .{});
        defer this_strong.deinit();
        const this = this_strong.get();

        if (is_catch) {
            this.onUncaughtException(globalThis, result, true, refdata.phase);
        }
        if (!has_one_ref and !is_catch) {
            return group.log("bunTestThenOrCatch -> refdata has multiple refs; don't add result until the last ref", .{});
        }

        this.addResult(refdata.phase);
        runNextTick(refdata.buntest_weak, globalThis, refdata.phase);
    }
    fn bunTestThen(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        try bunTestThenOrCatch(globalThis, callframe, false);
        return .js_undefined;
    }
    fn bunTestCatch(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        try bunTestThenOrCatch(globalThis, callframe, true);
        return .js_undefined;
    }
    pub fn bunTestDoneCallback(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        group.begin(@src());
        defer group.end();

        const this = DoneCallback.fromJS(callframe.this()) orelse return globalThis.throw("Expected callee to be DoneCallback", .{});

        const value = callframe.argumentsAsArray(1)[0];

        const was_error = !value.isEmptyOrUndefinedOrNull();
        if (this.called) {
            // in Bun 1.2.20, this is a no-op
            // in Jest, this is "Expected done to be called once, but it was called multiple times."
            // Vitest does not support done callbacks
        } else {
            // error is only reported for the first done() call
            if (was_error) {
                _ = globalThis.bunVM().uncaughtException(globalThis, value, false);
            }
        }
        this.called = true;
        const ref_in = this.ref orelse return .js_undefined;
        defer this.ref = null;
        defer ref_in.deref();

        // dupe the ref and enqueue a task to call the done callback.
        // this makes it so if you do something else after calling done(), the next test doesn't start running until the next tick.

        const has_one_ref = ref_in.ref_count.hasOneRef();
        const should_run = has_one_ref or was_error;

        if (!should_run) return .js_undefined;

        var strong = ref_in.buntest_weak.clone().upgrade() orelse return .js_undefined;
        defer strong.deinit();
        const buntest = strong.get();
        buntest.addResult(ref_in.phase);
        runNextTick(ref_in.buntest_weak, globalThis, ref_in.phase);

        return .js_undefined;
    }
    pub fn bunTestTimeoutCallback(this_strong: BunTestPtr, _: *const bun.timespec, vm: *jsc.VirtualMachine) bun.api.Timer.EventLoopTimer.Arm {
        group.begin(@src());
        defer group.end();
        const this = this_strong.get();
        this.timer.next = .epoch;
        this.timer.state = .PENDING;

        switch (this.phase) {
            .collection => {},
            .execution => this.execution.handleTimeout(vm.global) catch |e| {
                this.onUncaughtException(vm.global, vm.global.takeException(e), false, .done);
            },
            .done => {},
        }
        run(this_strong, vm.global) catch |e| {
            this.onUncaughtException(vm.global, vm.global.takeException(e), false, .done);
        };

        return .disarm; // this won't disable the timer if .run() re-arms it
    }
    pub fn runNextTick(weak: BunTestPtr.Weak, globalThis: *jsc.JSGlobalObject, phase: RefDataValue) void {
        const done_callback_test = bun.new(RunTestsTask, .{ .weak = weak.clone(), .globalThis = globalThis, .phase = phase });
        errdefer bun.destroy(done_callback_test);
        const task = jsc.ManagedTask.New(RunTestsTask, RunTestsTask.call).init(done_callback_test);
        jsc.VirtualMachine.get().enqueueTask(task);
    }
    pub const RunTestsTask = struct {
        weak: BunTestPtr.Weak,
        globalThis: *jsc.JSGlobalObject,
        phase: RefDataValue,

        pub fn call(this: *RunTestsTask) void {
            defer bun.destroy(this);
            defer this.weak.deinit();
            var strong = this.weak.clone().upgrade() orelse return;
            defer strong.deinit();
            BunTest.run(strong, this.globalThis) catch |e| {
                strong.get().onUncaughtException(this.globalThis, this.globalThis.takeException(e), false, this.phase);
            };
        }
    };

    pub fn addResult(this: *BunTest, result: RefDataValue) void {
        bun.handleOom(this.result_queue.writeItem(result));
    }

    pub fn run(this_strong: BunTestPtr, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
        group.begin(@src());
        defer group.end();
        const this = this_strong.get();

        if (this.in_run_loop) return;
        this.in_run_loop = true;
        defer this.in_run_loop = false;

        var min_timeout: bun.timespec = .epoch;

        while (this.result_queue.readItem()) |result| {
            globalThis.clearTerminationException();
            const step_result: StepResult = switch (this.phase) {
                .collection => try Collection.step(this_strong, globalThis, result),
                .execution => try Execution.step(this_strong, globalThis, result),
                .done => .complete,
            };
            switch (step_result) {
                .waiting => |waiting| {
                    min_timeout = bun.timespec.minIgnoreEpoch(min_timeout, waiting.timeout);
                },
                .complete => {
                    if (try this._advance(globalThis) == .exit) return;
                    this.addResult(.start);
                },
            }
        }

        this.updateMinTimeout(globalThis, min_timeout);
    }

    fn updateMinTimeout(this: *BunTest, globalThis: *jsc.JSGlobalObject, min_timeout: bun.timespec) void {
        group.begin(@src());
        defer group.end();
        // only set the timer if the new timeout is sooner than the current timeout. this unfortunately means that we can't unset an unnecessary timer.
        group.log("-> timeout: {} {}, {s}", .{ min_timeout, this.timer.next, @tagName(min_timeout.orderIgnoreEpoch(this.timer.next)) });
        if (min_timeout.orderIgnoreEpoch(this.timer.next) == .lt) {
            group.log("-> setting timer to {}", .{min_timeout});
            if (!this.timer.next.eql(&.epoch)) {
                group.log("-> removing existing timer", .{});
                globalThis.bunVM().timer.remove(&this.timer);
            }
            this.timer.next = min_timeout;
            if (!this.timer.next.eql(&.epoch)) {
                group.log("-> inserting timer", .{});
                globalThis.bunVM().timer.insert(&this.timer);
                if (group.getLogEnabled()) {
                    const duration = this.timer.next.duration(&bun.timespec.now());
                    group.log("-> timer duration: {}", .{duration});
                }
            }
            group.log("-> timer set", .{});
        }
    }

    fn _advance(this: *BunTest, _: *jsc.JSGlobalObject) bun.JSError!enum { cont, exit } {
        group.begin(@src());
        defer group.end();
        group.log("advance from {s}", .{@tagName(this.phase)});
        defer group.log("advance -> {s}", .{@tagName(this.phase)});

        switch (this.phase) {
            .collection => {
                this.phase = .execution;
                try debug.dumpDescribe(this.collection.root_scope);
                var order = Order.init(this.gpa);
                defer order.deinit();

                const has_filter = if (this.reporter) |reporter| if (reporter.jest.filter_regex) |_| true else false else false;
                const cfg: Order.Config = .{ .always_use_hooks = this.collection.root_scope.base.only == .no and !has_filter };
                const beforeall_order: Order.AllOrderResult = if (cfg.always_use_hooks or this.collection.root_scope.base.has_callback) try order.generateAllOrder(this.buntest.hook_scope.beforeAll.items, cfg) else .empty;
                try order.generateOrderDescribe(this.collection.root_scope, cfg);
                beforeall_order.setFailureSkipTo(&order);
                const afterall_order: Order.AllOrderResult = if (cfg.always_use_hooks or this.collection.root_scope.base.has_callback) try order.generateAllOrder(this.buntest.hook_scope.afterAll.items, cfg) else .empty;
                afterall_order.setFailureSkipTo(&order);

                try this.execution.loadFromOrder(&order);
                try debug.dumpOrder(&this.execution);
                return .cont;
            },
            .execution => {
                this.in_run_loop = false;
                this.phase = .done;

                return .exit;
            },
            .done => return .exit,
        }
    }

    fn drain(globalThis: *jsc.JSGlobalObject) void {
        const bun_vm = globalThis.bunVM();
        bun_vm.drainMicrotasks();
        var count = bun_vm.unhandled_error_counter;
        bun_vm.global.handleRejectedPromises();
        while (bun_vm.unhandled_error_counter > count) {
            count = bun_vm.unhandled_error_counter;
            bun_vm.drainMicrotasks();
            bun_vm.global.handleRejectedPromises();
        }
    }

    /// if sync, the result is returned. if async, null is returned.
    pub fn runTestCallback(this_strong: BunTestPtr, globalThis: *jsc.JSGlobalObject, cfg_callback: jsc.JSValue, cfg_done_parameter: bool, cfg_data: BunTest.RefDataValue, timeout: bun.timespec) ?RefDataValue {
        group.begin(@src());
        defer group.end();
        const this = this_strong.get();

        var done_arg: ?jsc.JSValue = null;

        var done_callback: ?jsc.JSValue = null;
        if (cfg_done_parameter) {
            group.log("callTestCallback -> appending done callback param: data {}", .{cfg_data});
            done_callback = DoneCallback.createUnbound(globalThis);
            done_arg = DoneCallback.bind(done_callback.?, globalThis) catch |e| blk: {
                this.onUncaughtException(globalThis, globalThis.takeException(e), false, cfg_data);
                break :blk jsc.JSValue.js_undefined; // failed to bind done callback
            };
        }

        this.updateMinTimeout(globalThis, timeout);
        const result: ?jsc.JSValue = cfg_callback.call(globalThis, .js_undefined, if (done_arg) |done| &.{done} else &.{}) catch blk: {
            globalThis.clearTerminationException();
            this.onUncaughtException(globalThis, globalThis.tryTakeException(), false, cfg_data);
            group.log("callTestCallback -> error", .{});
            break :blk null;
        };

        var dcb_ref: ?*RefData = null;
        if (done_callback) |dcb| {
            if (DoneCallback.fromJS(dcb)) |dcb_data| {
                if (dcb_data.called or result == null) {
                    // done callback already called or the callback errored; add result immediately
                } else {
                    dcb_ref = ref(this_strong, cfg_data);
                    dcb_data.ref = dcb_ref;
                }
            } else bun.debugAssert(false); // this should be unreachable, we create DoneCallback above
        }

        if (result != null and result.?.asPromise() != null) {
            group.log("callTestCallback -> promise: data {}", .{cfg_data});
            const this_ref: *RefData = if (dcb_ref) |dcb_ref_value| dcb_ref_value.dupe() else ref(this_strong, cfg_data);
            result.?.then(globalThis, this_ref, bunTestThen, bunTestCatch);
            drain(globalThis);
            return null;
        }

        if (dcb_ref) |_| {
            // completed asynchronously
            group.log("callTestCallback -> wait for done callback", .{});
            drain(globalThis);
            return null;
        }

        group.log("callTestCallback -> sync", .{});
        drain(globalThis);
        return cfg_data;
    }

    /// called from the uncaught exception handler, or if a test callback rejects or throws an error
    pub fn onUncaughtException(this: *BunTest, globalThis: *jsc.JSGlobalObject, exception: ?jsc.JSValue, is_rejection: bool, user_data: RefDataValue) void {
        group.begin(@src());
        defer group.end();

        _ = is_rejection;

        const handle_status: HandleUncaughtExceptionResult = switch (this.phase) {
            .collection => this.collection.handleUncaughtException(user_data),
            .done => .show_unhandled_error_between_tests,
            .execution => this.execution.handleUncaughtException(user_data),
        };

        group.log("onUncaughtException -> {s}", .{@tagName(handle_status)});

        if (handle_status == .hide_error) return; // do not print error, it was already consumed
        if (exception == null) return; // the exception should not be visible (eg m_terminationException)

        if (handle_status == .show_unhandled_error_between_tests or handle_status == .show_unhandled_error_in_describe) {
            this.reporter.?.jest.unhandled_errors_between_tests += 1;
            bun.Output.prettyErrorln(
                \\<r>
                \\<b><d>#<r> <red><b>Unhandled error<r><d> between tests<r>
                \\<d>-------------------------------<r>
                \\
            , .{});
            bun.Output.flush();
        }
        globalThis.bunVM().runErrorHandler(exception.?, null);
        bun.Output.flush();
        if (handle_status == .show_unhandled_error_between_tests or handle_status == .show_unhandled_error_in_describe) {
            bun.Output.prettyError("<r><d>-------------------------------<r>\n\n", .{});
            bun.Output.flush();
        }
    }
};

pub const HandleUncaughtExceptionResult = enum { hide_error, show_handled_error, show_unhandled_error_between_tests, show_unhandled_error_in_describe };

pub const ResultQueue = bun.LinearFifo(BunTest.RefDataValue, .Dynamic);
pub const StepResult = union(enum) {
    waiting: struct { timeout: bun.timespec = .epoch },
    complete,
};

pub const Collection = @import("./Collection.zig");

pub const BaseScopeCfg = struct {
    self_concurrent: bool = false,
    self_mode: ScopeMode = .normal,
    self_only: bool = false,
    test_id_for_debugger: i32 = 0,
    line_no: u32 = 0,
    /// returns null if the other already has the value
    pub fn extend(this: BaseScopeCfg, other: BaseScopeCfg) ?BaseScopeCfg {
        var result = this;
        if (other.self_concurrent) {
            if (result.self_concurrent) return null;
            result.self_concurrent = true;
        }
        if (other.self_mode != .normal) {
            if (result.self_mode != .normal) return null;
            result.self_mode = other.self_mode;
        }
        if (other.self_only) {
            if (result.self_only) return null;
            result.self_only = true;
        }
        return result;
    }
};
pub const ScopeMode = enum {
    normal,
    skip,
    todo,
    failing,
    filtered_out,
};
pub const BaseScope = struct {
    parent: ?*DescribeScope,
    name: ?[]const u8,
    concurrent: bool,
    mode: ScopeMode,
    only: enum { no, contains, yes },
    has_callback: bool,
    /// this value is 0 unless the debugger is active and the scope has a debugger id
    test_id_for_debugger: i32,
    /// only available if using junit reporter, otherwise 0
    line_no: u32,
    pub fn init(this: BaseScopeCfg, gpa: std.mem.Allocator, name_not_owned: ?[]const u8, parent: ?*DescribeScope, has_callback: bool) BaseScope {
        return .{
            .parent = parent,
            .name = if (name_not_owned) |name| bun.handleOom(gpa.dupe(u8, name)) else null,
            .concurrent = this.self_concurrent or if (parent) |p| p.base.concurrent else false,
            .mode = if (parent) |p| if (p.base.mode != .normal) p.base.mode else this.self_mode else this.self_mode,
            .only = if (this.self_only) .yes else .no,
            .has_callback = has_callback,
            .test_id_for_debugger = this.test_id_for_debugger,
            .line_no = this.line_no,
        };
    }
    pub fn propagate(this: *BaseScope, has_callback: bool) void {
        this.has_callback = has_callback;
        if (this.parent) |parent| {
            if (this.only != .no) parent.markContainsOnly();
            if (this.has_callback) parent.markHasCallback();
        }
    }
    pub fn deinit(this: BaseScope, gpa: std.mem.Allocator) void {
        if (this.name) |name| gpa.free(name);
    }
};

pub const DescribeScope = struct {
    base: BaseScope,
    entries: std.ArrayList(TestScheduleEntry),
    beforeAll: std.ArrayList(*ExecutionEntry),
    beforeEach: std.ArrayList(*ExecutionEntry),
    afterEach: std.ArrayList(*ExecutionEntry),
    afterAll: std.ArrayList(*ExecutionEntry),

    /// if true, the describe callback threw an error. do not run any tests declared in this scope.
    failed: bool = false,

    pub fn create(gpa: std.mem.Allocator, base: BaseScope) *DescribeScope {
        return bun.create(gpa, DescribeScope, .{
            .base = base,
            .entries = .init(gpa),
            .beforeEach = .init(gpa),
            .beforeAll = .init(gpa),
            .afterAll = .init(gpa),
            .afterEach = .init(gpa),
        });
    }
    pub fn destroy(this: *DescribeScope, gpa: std.mem.Allocator) void {
        for (this.entries.items) |*entry| entry.deinit(gpa);
        for (this.beforeAll.items) |item| item.destroy(gpa);
        for (this.beforeEach.items) |item| item.destroy(gpa);
        for (this.afterAll.items) |item| item.destroy(gpa);
        for (this.afterEach.items) |item| item.destroy(gpa);
        this.entries.deinit();
        this.beforeAll.deinit();
        this.beforeEach.deinit();
        this.afterAll.deinit();
        this.afterEach.deinit();
        this.base.deinit(gpa);
        gpa.destroy(this);
    }

    fn markContainsOnly(this: *DescribeScope) void {
        var target: ?*DescribeScope = this;
        while (target) |scope| {
            if (scope.base.only == .contains) return; // already marked
            // note that we overwrite '.yes' with '.contains' to support only-inside-only
            scope.base.only = .contains;
            target = scope.base.parent;
        }
    }
    fn markHasCallback(this: *DescribeScope) void {
        var target: ?*DescribeScope = this;
        while (target) |scope| {
            if (scope.base.has_callback) return; // already marked
            scope.base.has_callback = true;
            target = scope.base.parent;
        }
    }
    pub fn appendDescribe(this: *DescribeScope, gpa: std.mem.Allocator, name_not_owned: ?[]const u8, base: BaseScopeCfg) bun.JSError!*DescribeScope {
        const child = create(gpa, .init(base, gpa, name_not_owned, this, false));
        child.base.propagate(false);
        try this.entries.append(.{ .describe = child });
        return child;
    }
    pub fn appendTest(this: *DescribeScope, gpa: std.mem.Allocator, name_not_owned: ?[]const u8, callback: ?jsc.JSValue, cfg: ExecutionEntryCfg, base: BaseScopeCfg) bun.JSError!*ExecutionEntry {
        const entry = try ExecutionEntry.create(gpa, name_not_owned, callback, cfg, this, base);
        entry.base.propagate(entry.callback != null);
        try this.entries.append(.{ .test_callback = entry });
        return entry;
    }
    pub const HookTag = enum { beforeAll, beforeEach, afterEach, afterAll };
    pub fn getHookEntries(this: *DescribeScope, tag: HookTag) *std.ArrayList(*ExecutionEntry) {
        switch (tag) {
            .beforeAll => return &this.beforeAll,
            .beforeEach => return &this.beforeEach,
            .afterEach => return &this.afterEach,
            .afterAll => return &this.afterAll,
        }
    }
    pub fn appendHook(this: *DescribeScope, gpa: std.mem.Allocator, tag: HookTag, callback: ?jsc.JSValue, cfg: ExecutionEntryCfg, base: BaseScopeCfg) bun.JSError!*ExecutionEntry {
        const entry = try ExecutionEntry.create(gpa, null, callback, cfg, this, base);
        try this.getHookEntries(tag).append(entry);
        return entry;
    }
};
pub const ExecutionEntryCfg = struct {
    /// 0 = unlimited timeout
    timeout: u32,
    has_done_parameter: bool,
};
pub const ExecutionEntry = struct {
    base: BaseScope,
    callback: ?Strong,
    /// 0 = unlimited timeout
    timeout: u32,
    has_done_parameter: bool,
    /// '.epoch' = not set
    /// when this entry begins executing, the timespec will be set to the current time plus the timeout(ms).
    timespec: bun.timespec = .epoch,

    fn create(gpa: std.mem.Allocator, name_not_owned: ?[]const u8, cb: ?jsc.JSValue, cfg: ExecutionEntryCfg, parent: ?*DescribeScope, base: BaseScopeCfg) bun.JSError!*ExecutionEntry {
        const entry = bun.create(gpa, ExecutionEntry, .{
            .base = .init(base, gpa, name_not_owned, parent, cb != null),
            .callback = null,
            .timeout = cfg.timeout,
            .has_done_parameter = cfg.has_done_parameter,
        });

        if (cb) |c| {
            entry.callback = switch (entry.base.mode) {
                .skip => null,
                .todo => blk: {
                    const run_todo = if (bun.jsc.Jest.Jest.runner) |runner| runner.run_todo else false;
                    break :blk if (run_todo) .init(gpa, c) else null;
                },
                else => .init(gpa, c),
            };
        }
        return entry;
    }
    pub fn destroy(this: *ExecutionEntry, gpa: std.mem.Allocator) void {
        if (this.callback) |*c| c.deinit();
        this.base.deinit(gpa);
        gpa.destroy(this);
    }
};
pub const TestScheduleEntry = union(enum) {
    describe: *DescribeScope,
    test_callback: *ExecutionEntry,
    fn deinit(
        this: *TestScheduleEntry,
        gpa: std.mem.Allocator,
    ) void {
        switch (this.*) {
            .describe => |describe| describe.destroy(gpa),
            .test_callback => |test_scope| test_scope.destroy(gpa),
        }
    }
    pub fn base(this: TestScheduleEntry) *BaseScope {
        switch (this) {
            .describe => |describe| return &describe.base,
            .test_callback => |test_callback| return &test_callback.base,
        }
    }
};
pub const RunOneResult = union(enum) {
    done,
    execute: struct {
        timeout: bun.timespec = .epoch,
    },
};

pub const Execution = @import("./Execution.zig");
pub const debug = @import("./debug.zig");

pub const ScopeFunctions = @import("./ScopeFunctions.zig");

pub const Order = @import("./Order.zig");

const group = debug.group;

const std = @import("std");
const test_command = @import("../../cli/test_command.zig");

const bun = @import("bun");
const jsc = bun.jsc;
const Strong = jsc.Strong.Deprecated;
