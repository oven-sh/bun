pub fn cloneActiveStrong() ?BunTestPtr {
    const runner = bun.jsc.Jest.Jest.runner orelse return null;
    return runner.bun_test_root.cloneActiveFile();
}

pub const DoneCallback = @import("./DoneCallback.zig");

pub const js_fns = struct {
    pub const Signature = union(enum) {
        scope_functions: *const ScopeFunctions,
        str: []const u8,
        pub fn format(this: Signature, writer: *std.Io.Writer) !void {
            switch (this) {
                .scope_functions => try writer.print("{f}", .{this.scope_functions.*}),
                .str => try writer.print("{s}", .{this.str}),
            }
        }
    };
    const GetActiveCfg = struct { signature: Signature, allow_in_preload: bool };
    fn getActiveTestRoot(globalThis: *jsc.JSGlobalObject, cfg: GetActiveCfg) bun.JSError!*BunTestRoot {
        if (bun.jsc.Jest.Jest.runner == null) {
            return globalThis.throw("Cannot use {f} outside of the test runner. Run \"bun test\" to run tests.", .{cfg.signature});
        }
        const bunTestRoot = &bun.jsc.Jest.Jest.runner.?.bun_test_root;
        const vm = globalThis.bunVM();
        if (vm.is_in_preload and !cfg.allow_in_preload) {
            return globalThis.throw("Cannot use {f} during preload.", .{cfg.signature});
        }
        return bunTestRoot;
    }
    pub fn cloneActiveStrong(globalThis: *jsc.JSGlobalObject, cfg: GetActiveCfg) bun.JSError!BunTestPtr {
        const bunTestRoot = try getActiveTestRoot(globalThis, cfg);
        const bunTest = bunTestRoot.cloneActiveFile() orelse {
            return globalThis.throw("Cannot use {f} outside of a test file.", .{cfg.signature});
        };

        return bunTest;
    }

    pub fn genericHook(comptime tag: @Type(.enum_literal)) type {
        return struct {
            pub fn hookFn(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
                group.begin(@src());
                defer group.end();
                errdefer group.log("ended in error", .{});

                var args = try ScopeFunctions.parseArguments(globalThis, callFrame, .{ .str = @tagName(tag) ++ "()" }, bun.default_allocator, .{ .callback = .require, .kind = .hook });
                defer args.deinit(bun.default_allocator);

                const has_done_parameter = if (args.callback) |callback| try callback.getLength(globalThis) > 0 else false;

                const bunTestRoot = try getActiveTestRoot(globalThis, .{ .signature = .{ .str = @tagName(tag) ++ "()" }, .allow_in_preload = true });

                const cfg: ExecutionEntryCfg = .{
                    .has_done_parameter = has_done_parameter,
                    .timeout = args.options.timeout,
                };
                const bunTest = bunTestRoot.getActiveFileUnlessInPreload(globalThis.bunVM()) orelse {
                    if (tag == .onTestFinished) {
                        return globalThis.throw("Cannot call {s}() in preload. It can only be called inside a test.", .{@tagName(tag)});
                    }
                    group.log("genericHook in preload", .{});

                    _ = try bunTestRoot.hook_scope.appendHook(bunTestRoot.gpa, tag, args.callback, cfg, .{}, .preload);
                    return .js_undefined;
                };

                switch (bunTest.phase) {
                    .collection => {
                        if (tag == .onTestFinished) {
                            return globalThis.throw("Cannot call {s}() outside of a test. It can only be called inside a test.", .{@tagName(tag)});
                        }
                        _ = try bunTest.collection.active_scope.appendHook(bunTest.gpa, tag, args.callback, cfg, .{}, .collection);

                        return .js_undefined;
                    },
                    .execution => {
                        const active = bunTest.getCurrentStateData();
                        const sequence, _ = bunTest.execution.getCurrentAndValidExecutionSequence(active) orelse {
                            const message = if (tag == .onTestFinished)
                                "Cannot call {s}() here. It cannot be called inside a concurrent test. Use test.serial or remove test.concurrent."
                            else
                                "Cannot call {s}() here. It cannot be called inside a concurrent test. Call it inside describe() instead.";
                            return globalThis.throw(message, .{@tagName(tag)});
                        };

                        const append_point = switch (tag) {
                            .afterAll, .afterEach => blk: {
                                var iter = sequence.active_entry;
                                while (iter) |entry| : (iter = entry.next) {
                                    if (entry == sequence.test_entry) break :blk sequence.test_entry.?;
                                }

                                break :blk sequence.active_entry orelse return globalThis.throw("Cannot call {s}() here. Call it inside describe() instead.", .{@tagName(tag)});
                            },
                            .onTestFinished => blk: {
                                // Find the last entry in the sequence
                                var last_entry = sequence.active_entry orelse return globalThis.throw("Cannot call {s}() here. Call it inside a test instead.", .{@tagName(tag)});
                                while (last_entry.next) |next_entry| {
                                    last_entry = next_entry;
                                }
                                break :blk last_entry;
                            },
                            else => return globalThis.throw("Cannot call {s}() inside a test. Call it inside describe() instead.", .{@tagName(tag)}),
                        };

                        const new_item = ExecutionEntry.create(bunTest.gpa, null, args.callback, cfg, null, .{}, .execution);
                        new_item.next = append_point.next;
                        append_point.next = new_item;
                        bun.handleOom(bunTest.extra_execution_entries.append(new_item));

                        return .js_undefined;
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

    pub fn enterFile(this: *BunTestRoot, file_id: jsc.Jest.TestRunner.File.ID, reporter: *test_command.CommandLineReporter, default_concurrent: bool, first_last: FirstLast) void {
        group.begin(@src());
        defer group.end();

        bun.assert(this.active_file.get() == null);

        this.active_file = .new(undefined);
        this.active_file.get().?.init(this.gpa, this, file_id, reporter, default_concurrent, first_last);
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

    pub const FirstLast = struct {
        first: bool,
        last: bool,
    };

    pub fn onBeforePrint(this: *BunTestRoot) void {
        if (this.active_file.get()) |active_file| {
            if (active_file.reporter) |reporter| {
                if (reporter.reporters.dots and reporter.last_printed_dot) {
                    bun.Output.prettyError("<r>\n", .{});
                    bun.Output.flush();
                    reporter.last_printed_dot = false;
                }
                if (bun.jsc.Jest.Jest.runner) |runner| {
                    runner.current_file.printIfNeeded();
                }
            }
        }
    }
};

pub const BunTest = struct {
    bun_test_root: *BunTestRoot,
    in_run_loop: bool,
    allocation_scope: bun.AllocationScope,
    gpa: std.mem.Allocator,
    arena_allocator: std.heap.ArenaAllocator,
    arena: std.mem.Allocator,
    file_id: jsc.Jest.TestRunner.File.ID,
    /// null if the runner has moved on to the next file but a strong reference to BunTest is stll keeping it alive
    reporter: ?*test_command.CommandLineReporter,
    timer: bun.api.Timer.EventLoopTimer = .{ .next = .epoch, .tag = .BunTest },
    result_queue: ResultQueue,
    /// Whether tests in this file should default to concurrent execution
    default_concurrent: bool,
    first_last: BunTestRoot.FirstLast,
    extra_execution_entries: std.array_list.Managed(*ExecutionEntry),
    wants_wakeup: bool = false,

    phase: enum {
        collection,
        execution,
        done,
    },
    collection: Collection,
    execution: Execution,

    pub fn init(this: *BunTest, outer_gpa: std.mem.Allocator, bunTest: *BunTestRoot, file_id: jsc.Jest.TestRunner.File.ID, reporter: *test_command.CommandLineReporter, default_concurrent: bool, first_last: BunTestRoot.FirstLast) void {
        group.begin(@src());
        defer group.end();

        this.allocation_scope = .init(outer_gpa);
        this.gpa = this.allocation_scope.allocator();
        this.arena_allocator = .init(this.gpa);
        this.arena = this.arena_allocator.allocator();

        this.* = .{
            .bun_test_root = bunTest,
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
            .default_concurrent = default_concurrent,
            .first_last = first_last,
            .extra_execution_entries = .init(this.gpa),
        };
    }
    pub fn deinit(this: *BunTest) void {
        group.begin(@src());
        defer group.end();

        if (this.timer.state == .ACTIVE) {
            // must remove an active timer to prevent UAF (if the timer were to trigger after BunTest deinit)
            bun.jsc.VirtualMachine.get().timer.remove(&this.timer);
        }

        for (this.extra_execution_entries.items) |entry| {
            entry.destroy(this.gpa);
        }
        this.extra_execution_entries.deinit();

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
                entry: *const anyopaque,
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
            if (buntest.phase != .execution) return null;
            const the_sequence, _ = buntest.execution.getCurrentAndValidExecutionSequence(this.*) orelse return null;
            return the_sequence.active_entry;
        }

        pub fn format(this: *const RefDataValue, writer: *std.Io.Writer) !void {
            switch (this.*) {
                .start => try writer.print("start", .{}),
                .collection => try writer.print("collection: active_scope={?s}", .{this.collection.active_scope.base.name}),
                .execution => if (this.execution.entry_data) |entry_data| {
                    try writer.print("execution: group_index={d},sequence_index={d},entry_index={x},remaining_repeat_count={d}", .{ this.execution.group_index, entry_data.sequence_index, @intFromPtr(entry_data.entry), entry_data.remaining_repeat_count });
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
            group.log("refData: {f}", .{this.phase});

            var buntest_weak = this.buntest_weak;
            bun.destroy(this);
            buntest_weak.deinit();
        }
        pub fn bunTest(this: *RefData) ?BunTestPtr {
            return this.buntest_weak.upgrade() orelse return null;
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

                const active_entry = sequence.active_entry orelse break :blk .{
                    .execution = .{
                        .group_index = this.execution.group_index,
                        .entry_data = null, // the sequence is completed.
                    },
                };

                break :blk .{ .execution = .{
                    .group_index = this.execution.group_index,
                    .entry_data = .{
                        .sequence_index = active_sequence_index,
                        .entry = active_entry,
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
        group.log("ref: {f}", .{phase});

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
        if (this_ptr.isEmptyOrUndefinedOrNull()) return;

        const refdata: *RefData = this_ptr.asPromisePtr(RefData);
        defer refdata.deref();
        const has_one_ref = refdata.ref_count.hasOneRef();
        var this_strong = refdata.buntest_weak.upgrade() orelse return group.log("bunTestThenOrCatch -> the BunTest is no longer active", .{});
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

        var strong = ref_in.buntest_weak.upgrade() orelse return .js_undefined;
        defer strong.deinit();
        const buntest = strong.get();
        buntest.addResult(ref_in.phase);
        runNextTick(ref_in.buntest_weak, globalThis, ref_in.phase);

        return .js_undefined;
    }
    pub fn bunTestTimeoutCallback(this_strong: BunTestPtr, _: *const bun.timespec, vm: *jsc.VirtualMachine) void {
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
    }
    pub fn runNextTick(weak: BunTestPtr.Weak, globalThis: *jsc.JSGlobalObject, phase: RefDataValue) void {
        const done_callback_test = bun.new(RunTestsTask, .{ .weak = weak.clone(), .globalThis = globalThis, .phase = phase });
        errdefer bun.destroy(done_callback_test);
        const task = jsc.ManagedTask.New(RunTestsTask, RunTestsTask.call).init(done_callback_test);
        const vm = globalThis.bunVM();
        var strong = weak.upgrade() orelse {
            if (bun.Environment.ci_assert) bun.assert(false); // shouldn't be calling runNextTick after moving on to the next file
            return; // but just in case
        };
        defer strong.deinit();
        strong.get().wants_wakeup = true; // we need to wake up the event loop so autoTick() doesn't wait for 16-100ms because we just enqueued a task
        vm.enqueueTask(task);
    }
    pub const RunTestsTask = struct {
        weak: BunTestPtr.Weak,
        globalThis: *jsc.JSGlobalObject,
        phase: RefDataValue,

        pub fn call(this: *RunTestsTask) void {
            defer bun.destroy(this);
            defer this.weak.deinit();
            var strong = this.weak.upgrade() orelse return;
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

        this.updateMinTimeout(globalThis, &min_timeout);
    }

    fn updateMinTimeout(this: *BunTest, globalThis: *jsc.JSGlobalObject, min_timeout: *const bun.timespec) void {
        group.begin(@src());
        defer group.end();
        // only set the timer if the new timeout is sooner than the current timeout. this unfortunately means that we can't unset an unnecessary timer.
        group.log("-> timeout: {} {}, {s}", .{ min_timeout.*, this.timer.next, @tagName(min_timeout.orderIgnoreEpoch(this.timer.next)) });
        if (min_timeout.orderIgnoreEpoch(this.timer.next) == .lt) {
            group.log("-> setting timer to {}", .{min_timeout.*});
            if (!this.timer.next.eql(&.epoch)) {
                group.log("-> removing existing timer", .{});
                globalThis.bunVM().timer.remove(&this.timer);
            }
            this.timer.next = min_timeout.*;
            if (!this.timer.next.eql(&.epoch)) {
                group.log("-> inserting timer", .{});
                globalThis.bunVM().timer.insert(&this.timer);
                if (group.getLogEnabled()) {
                    const duration = this.timer.next.duration(&bun.timespec.now(.force_real_time));
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

                const has_filter = if (this.reporter) |reporter| if (reporter.jest.filter_regex) |_| true else false else false;
                const should_randomize: ?std.Random = if (this.reporter) |reporter| reporter.jest.randomize else null;

                var order = Order.init(this.gpa, this.arena, .{
                    .always_use_hooks = this.collection.root_scope.base.only == .no and !has_filter,
                    .randomize = should_randomize,
                });
                defer order.deinit();

                const beforeall_order: Order.AllOrderResult = if (this.first_last.first) try order.generateAllOrder(this.bun_test_root.hook_scope.beforeAll.items) else .empty;
                try order.generateOrderDescribe(this.collection.root_scope);
                beforeall_order.setFailureSkipTo(&order);
                const afterall_order: Order.AllOrderResult = if (this.first_last.last) try order.generateAllOrder(this.bun_test_root.hook_scope.afterAll.items) else .empty;
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

    /// if sync, the result is returned. if async, null is returned.
    pub fn runTestCallback(this_strong: BunTestPtr, globalThis: *jsc.JSGlobalObject, cfg_callback: jsc.JSValue, cfg_done_parameter: bool, cfg_data: BunTest.RefDataValue, timeout: *const bun.timespec) ?RefDataValue {
        group.begin(@src());
        defer group.end();
        const this = this_strong.get();
        const vm = globalThis.bunVM();

        // Don't use ?jsc.JSValue to make it harder for the conservative stack
        // scanner to miss it.
        var done_arg: jsc.JSValue = .zero;
        var done_callback: jsc.JSValue = .zero;

        if (cfg_done_parameter) {
            group.log("callTestCallback -> appending done callback param: data {f}", .{cfg_data});
            done_callback = DoneCallback.createUnbound(globalThis);
            done_arg = DoneCallback.bind(done_callback, globalThis) catch |e| blk: {
                this.onUncaughtException(globalThis, globalThis.takeException(e), false, cfg_data);
                break :blk .zero; // failed to bind done callback
            };
        }

        this.updateMinTimeout(globalThis, timeout);
        const result: jsc.JSValue = vm.eventLoop().runCallbackWithResultAndForcefullyDrainMicrotasks(cfg_callback, globalThis, .js_undefined, if (done_arg != .zero) &.{done_arg} else &.{}) catch blk: {
            globalThis.clearTerminationException();
            this.onUncaughtException(globalThis, globalThis.tryTakeException(), false, cfg_data);
            group.log("callTestCallback -> error", .{});
            break :blk .zero;
        };

        done_callback.ensureStillAlive();

        // Drain unhandled promise rejections.
        while (true) {
            // Prevent the user's Promise rejection from going into the uncaught promise rejection queue.
            if (result != .zero)
                if (result.asPromise()) |promise|
                    if (promise.status() == .rejected)
                        promise.setHandled();

            const prev_unhandled_count = vm.unhandled_error_counter;
            globalThis.handleRejectedPromises();
            if (vm.unhandled_error_counter == prev_unhandled_count)
                break;
        }

        var dcb_ref: ?*RefData = null;
        if (done_callback != .zero and result != .zero) {
            if (DoneCallback.fromJS(done_callback)) |dcb_data| {
                if (dcb_data.called) {
                    // done callback already called or the callback errored; add result immediately
                } else {
                    dcb_ref = ref(this_strong, cfg_data);
                    dcb_data.ref = dcb_ref;
                }
            } else bun.debugAssert(false); // this should be unreachable, we create DoneCallback above
        }

        if (result != .zero) {
            if (result.asPromise()) |promise| {
                defer result.ensureStillAlive(); // because sometimes we use promise without result

                group.log("callTestCallback -> promise: data {f}", .{cfg_data});

                switch (promise.status()) {
                    .pending => {
                        // not immediately resolved; register 'then' to handle the result when it becomes available
                        const this_ref: *RefData = if (dcb_ref) |dcb_ref_value| dcb_ref_value.dupe() else ref(this_strong, cfg_data);
                        result.then(globalThis, this_ref, bunTestThen, bunTestCatch) catch {}; // TODO: properly propagate exception upwards
                        return null;
                    },
                    .fulfilled => {
                        // Do not register a then callback when it's already fulfilled.
                        return cfg_data;
                    },
                    .rejected => {
                        const value = promise.result(globalThis.vm());
                        this.onUncaughtException(globalThis, value, true, cfg_data);

                        // We previously marked it as handled above.

                        return cfg_data;
                    },
                }
            }
        }

        if (dcb_ref) |_| {
            // completed asynchronously
            group.log("callTestCallback -> wait for done callback", .{});
            return null;
        }

        group.log("callTestCallback -> sync", .{});
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

        this.bun_test_root.onBeforePrint();
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

        if (handle_status == .show_unhandled_error_between_tests or handle_status == .show_unhandled_error_in_describe) {
            bun.Output.prettyError("<r><d>-------------------------------<r>\n\n", .{});
        }

        bun.Output.flush();
    }
};

pub const HandleUncaughtExceptionResult = enum { hide_error, show_handled_error, show_unhandled_error_between_tests, show_unhandled_error_in_describe };

pub const ResultQueue = bun.LinearFifo(BunTest.RefDataValue, .Dynamic);
pub const StepResult = union(enum) {
    waiting: struct { timeout: bun.timespec = .epoch },
    complete,
};

pub const Collection = @import("./Collection.zig");

pub const ConcurrentMode = enum {
    inherit,
    no,
    yes,
};

pub const BaseScopeCfg = struct {
    self_concurrent: ConcurrentMode = .inherit,
    self_mode: ScopeMode = .normal,
    self_only: bool = false,
    test_id_for_debugger: i32 = 0,
    line_no: u32 = 0,
    /// returns null if the other already has the value
    pub fn extend(this: BaseScopeCfg, other: BaseScopeCfg) ?BaseScopeCfg {
        var result = this;
        if (other.self_concurrent != .inherit) {
            if (result.self_concurrent != .inherit) return null;
            result.self_concurrent = other.self_concurrent;
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
            .concurrent = switch (this.self_concurrent) {
                .yes => true,
                .no => false,
                .inherit => if (parent) |p| p.base.concurrent else false,
            },
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
    entries: std.array_list.Managed(TestScheduleEntry),
    beforeAll: std.array_list.Managed(*ExecutionEntry),
    beforeEach: std.array_list.Managed(*ExecutionEntry),
    afterEach: std.array_list.Managed(*ExecutionEntry),
    afterAll: std.array_list.Managed(*ExecutionEntry),

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
    pub fn appendTest(this: *DescribeScope, gpa: std.mem.Allocator, name_not_owned: ?[]const u8, callback: ?jsc.JSValue, cfg: ExecutionEntryCfg, base: BaseScopeCfg, phase: ExecutionEntry.AddedInPhase) bun.JSError!*ExecutionEntry {
        const entry = ExecutionEntry.create(gpa, name_not_owned, callback, cfg, this, base, phase);
        entry.base.propagate(entry.callback != null);
        try this.entries.append(.{ .test_callback = entry });
        return entry;
    }
    pub const HookTag = enum { beforeAll, beforeEach, afterEach, afterAll };
    pub fn getHookEntries(this: *DescribeScope, tag: HookTag) *std.array_list.Managed(*ExecutionEntry) {
        switch (tag) {
            .beforeAll => return &this.beforeAll,
            .beforeEach => return &this.beforeEach,
            .afterEach => return &this.afterEach,
            .afterAll => return &this.afterAll,
        }
    }
    pub fn appendHook(this: *DescribeScope, gpa: std.mem.Allocator, tag: HookTag, callback: ?jsc.JSValue, cfg: ExecutionEntryCfg, base: BaseScopeCfg, phase: ExecutionEntry.AddedInPhase) bun.JSError!*ExecutionEntry {
        const entry = ExecutionEntry.create(gpa, null, callback, cfg, this, base, phase);
        try this.getHookEntries(tag).append(entry);
        return entry;
    }
};
pub const ExecutionEntryCfg = struct {
    /// 0 = unlimited timeout
    timeout: u32,
    has_done_parameter: bool,
    /// Number of times to retry a failed test (0 = no retries)
    retry_count: u32 = 0,
    /// Number of times to repeat a test (0 = run once, 1 = run twice, etc.)
    repeat_count: u32 = 0,
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
    added_in_phase: AddedInPhase,
    /// Number of times to retry a failed test (0 = no retries)
    retry_count: u32,
    /// Number of times to repeat a test (0 = run once, 1 = run twice, etc.)
    repeat_count: u32,

    next: ?*ExecutionEntry = null,
    /// if this entry fails, go to the entry 'failure_skip_past.next'
    failure_skip_past: ?*ExecutionEntry = null,

    const AddedInPhase = enum { preload, collection, execution };

    fn create(gpa: std.mem.Allocator, name_not_owned: ?[]const u8, cb: ?jsc.JSValue, cfg: ExecutionEntryCfg, parent: ?*DescribeScope, base: BaseScopeCfg, phase: AddedInPhase) *ExecutionEntry {
        const entry = bun.create(gpa, ExecutionEntry, .{
            .base = .init(base, gpa, name_not_owned, parent, cb != null),
            .callback = null,
            .timeout = cfg.timeout,
            .has_done_parameter = cfg.has_done_parameter,
            .added_in_phase = phase,
            .retry_count = cfg.retry_count,
            .repeat_count = cfg.repeat_count,
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

    pub fn evaluateTimeout(this: *ExecutionEntry, sequence: *Execution.ExecutionSequence, now: *const bun.timespec) bool {
        if (!this.timespec.eql(&.epoch) and this.timespec.order(now) == .lt) {
            // timed out
            sequence.result = if (this == sequence.test_entry)
                if (this.has_done_parameter)
                    .fail_because_timeout_with_done_callback
                else
                    .fail_because_timeout
            else if (this.has_done_parameter)
                .fail_because_hook_timeout_with_done_callback
            else
                .fail_because_hook_timeout;
            sequence.maybe_skip = true;
            return true;
        }

        return false;
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

pub const FakeTimers = @import("./timers/FakeTimers.zig");

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
