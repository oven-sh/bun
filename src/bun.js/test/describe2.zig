pub fn getActive() ?*BunTest {
    const runner = bun.jsc.Jest.Jest.runner orelse return null;
    return runner.describe2Root.active_file orelse return null;
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
        const bunTestRoot = &bun.jsc.Jest.Jest.runner.?.describe2Root;
        const vm = globalThis.bunVM();
        if (vm.is_in_preload and !cfg.allow_in_preload) {
            return globalThis.throw("Cannot use {s} during preload.", .{cfg.signature});
        }
        return bunTestRoot;
    }
    pub fn getActive(globalThis: *jsc.JSGlobalObject, cfg: GetActiveCfg) bun.JSError!*BunTest {
        const bunTestRoot = try getActiveTestRoot(globalThis, cfg);
        const bunTest = bunTestRoot.active_file orelse {
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

                const callback = callFrame.argumentsAsArray(1)[0];
                if (!callback.isFunction()) {
                    return globalThis.throw("beforeAll/beforeEach/afterEach/afterAll() expects a function as the first argument", .{});
                }

                const has_done_parameter = try callback.getLength(globalThis) > 0;

                const bunTestRoot = try getActiveTestRoot(globalThis, .{ .signature = .{ .str = @tagName(tag) ++ "()" }, .allow_in_preload = true });
                const bunTest = bunTestRoot.getActiveFileUnlessInPreload(globalThis.bunVM()) orelse {
                    group.log("genericHook in preload", .{});

                    _ = try bunTestRoot.hook_scope.appendHook(bunTestRoot.gpa, tag, callback, .{
                        .line_no = 0,
                        .has_done_parameter = has_done_parameter,
                    }, .{});
                    return .js_undefined;
                };

                switch (bunTest.phase) {
                    .collection => {
                        _ = try bunTest.collection.active_scope.appendHook(bunTest.gpa, tag, callback, .{
                            .line_no = 0,
                            .has_done_parameter = has_done_parameter,
                        }, .{});

                        return .js_undefined;
                    },
                    .execution => {
                        return globalThis.throw("Cannot call beforeAll/beforeEach/afterEach/afterAll() inside a test", .{});
                    },
                    .done => return globalThis.throw("Cannot call beforeAll/beforeEach/afterEach/afterAll() after the test run has completed", .{}),
                }
            }
        };
    }
};

pub const BunTestRoot = struct {
    gpa: std.mem.Allocator,
    active_file: ?*BunTest,

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
        });
        return .{
            .gpa = outer_gpa,
            .active_file = null,
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

        bun.assert(this.active_file == null);
        this.active_file = bun.create(this.gpa, BunTest, .init(this.gpa, this, file_id, reporter));
    }
    pub fn exitFile(this: *BunTestRoot) void {
        group.begin(@src());
        defer group.end();

        bun.assert(this.active_file != null);
        this.active_file.?.reporter = null;
        this.active_file.?.deinit(); // TODO: deref rather than deinit
        this.gpa.destroy(this.active_file.?);
        this.active_file = null;
    }
    pub fn getActiveFileUnlessInPreload(this: *BunTestRoot, vm: *jsc.VirtualMachine) ?*BunTest {
        if (vm.is_in_preload) {
            return null;
        }
        return this.active_file;
    }
};

pub const BunTest = struct {
    // const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    // ref_count: RefCount, // TODO: add ref count & hide the deinit function (deinit->deinitFromUnref())

    buntest: *BunTestRoot,
    in_run_loop: bool,
    allocation_scope: *bun.AllocationScope,
    gpa: std.mem.Allocator,
    done_promise: Strong.Optional = .empty,
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

    pub fn init(outer_gpa: std.mem.Allocator, bunTest: *BunTestRoot, file_id: jsc.Jest.TestRunner.File.ID, reporter: *test_command.CommandLineReporter) BunTest {
        group.begin(@src());
        defer group.end();

        var allocation_scope = bun.create(outer_gpa, bun.AllocationScope, bun.AllocationScope.init(outer_gpa));
        const gpa = allocation_scope.allocator();
        return .{
            .buntest = bunTest,
            .in_run_loop = false,
            .allocation_scope = allocation_scope,
            .gpa = gpa,
            .phase = .collection,
            .file_id = file_id,
            .collection = .init(gpa, bunTest),
            .execution = .init(gpa),
            .reporter = reporter,
            .result_queue = .init(gpa),
        };
    }
    pub fn deinit(this: *BunTest) void {
        group.begin(@src());
        defer group.end();

        if (this.timer.state == .ACTIVE) {
            // must remove an active timer to prevent UAF (if the timer were to trigger after BunTest deinit)
            bun.jsc.VirtualMachine.get().timer.remove(&this.timer);
        }

        this.done_promise.deinit();
        this.execution.deinit();
        this.collection.deinit();
        this.result_queue.deinit();
        const backing = this.allocation_scope.parent();
        this.allocation_scope.deinit();
        // TODO: consider making a StrongScope to ensure jsc.Strong values are deinitialized, or requiring a gpa for a strong that is used in asan builds for safety?
        backing.destroy(this.allocation_scope);
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
        buntest: *BunTest,
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

            const buntest = this.buntest;
            // buntest.gpa.destroy(this); // need to destroy the RefData before unref'ing the buntest because it may free the allocator
            // TODO: use buntest.gpa to destroy the RefData. this can't be done right now because RefData is stored in expect which needs BunTest to be ref-counted
            bun.destroy(this);
            _ = buntest;
            // TODO: unref buntest here
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
                        .entry_index = sequence.index,
                        .remaining_repeat_count = sequence.remaining_repeat_count,
                    },
                } };
            },
            .done => .{ .done = .{} },
        };
    }
    pub fn ref(this: *BunTest, phase: RefDataValue) *RefData {
        group.begin(@src());
        defer group.end();
        group.log("ref: {}", .{phase});

        // TODO this.ref()
        // TODO: allocate with bun.create(this.gpa). this can't be done right now because RefData is stored in expect which needs BunTest to be ref-counted
        return bun.new(RefData, .{
            .buntest = this,
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
        const this = refdata.buntest;

        if (is_catch) {
            this.onUncaughtException(globalThis, result, true, refdata.phase);
        }
        if (!has_one_ref) {
            return group.log("bunTestThenOrCatch -> refdata has multiple refs; don't add result until the last ref", .{});
        }

        this.addResult(refdata.phase);
        try this.run(globalThis);
    }
    fn bunTestThen(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        try bunTestThenOrCatch(globalThis, callframe, false);
        return .js_undefined;
    }
    fn bunTestCatch(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        try bunTestThenOrCatch(globalThis, callframe, true);
        return .js_undefined;
    }
    pub fn bunTestDoneCallback(this: *BunTest, globalThis: *jsc.JSGlobalObject, data: RefDataValue, has_one_ref: bool) bun.JSError!void {
        group.begin(@src());
        defer group.end();

        if (!has_one_ref) {
            return group.log("bunTestDoneCallback -> refdata has multiple refs; don't add result until the last ref", .{});
        }

        this.addResult(data);
        try this.run(globalThis);
    }
    pub fn bunTestTimeoutCallback(this: *BunTest, _: *const bun.timespec, vm: *jsc.VirtualMachine) bun.api.Timer.EventLoopTimer.Arm {
        group.begin(@src());
        defer group.end();
        this.timer.next = .epoch;
        this.timer.state = .PENDING;

        switch (this.phase) {
            .collection => {},
            .execution => this.execution.handleTimeout(vm.global) catch |e| {
                this.onUncaughtException(vm.global, vm.global.takeError(e), false, .done);
            },
            .done => {},
        }
        this.run(vm.global) catch |e| {
            this.onUncaughtException(vm.global, vm.global.takeError(e), false, .done);
        };

        return .disarm; // this won't disable the timer if .run() re-arms it
    }

    pub fn addResult(this: *BunTest, result: RefDataValue) void {
        bun.handleOom(this.result_queue.writeItem(result));
    }

    pub fn run(this: *BunTest, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
        group.begin(@src());
        defer group.end();

        if (this.in_run_loop) return; // already running. this can happen because of waitForPromise.
        this.in_run_loop = true;
        defer this.in_run_loop = false;

        var min_timeout: bun.timespec = .epoch;

        while (this.result_queue.readItem()) |result| {
            const step_result: StepResult = switch (this.phase) {
                .collection => try this.collection.step(globalThis, result),
                .execution => try this.execution.step(globalThis, result),
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

        group.log("-> timeout: {} {}, {s}", .{ min_timeout, this.timer.next, @tagName(min_timeout.orderIgnoreEpoch(this.timer.next)) });
        // only set the timer if the new timeout is sooner than the current timeout. this unfortunately means that we can't unset an unnecessary timer.
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
            }
            group.log("-> timer set", .{});
        }
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
                try debug.dumpDescribe(this.collection.root_scope);
                var order = Order.init(this.gpa);
                defer order.deinit();

                try order.generateAllOrder(this.buntest.hook_scope.beforeAll.items);
                try order.generateOrderDescribe(this.collection.root_scope);
                try order.generateAllOrder(this.buntest.hook_scope.afterAll.items);

                try this.execution.loadFromOrder(&order);
                try debug.dumpOrder(&this.execution);
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

    /// if sync, the result is queued and appended later
    pub fn runTestCallback(this: *BunTest, globalThis: *jsc.JSGlobalObject, cfg: CallbackEntry) bun.JSError!void {
        group.begin(@src());
        defer group.end();

        // TODO: this will need to support:
        // - in tests, (done) => {} callbacks
        // - for test.concurrent, we will have multiple 'then's active at once, and they will
        //   need to be able to pass context information to runOneCompleted

        var args: Strong.List = cfg.callback.args.dupe(this.gpa);
        defer args.deinit(this.gpa);

        var done_callback: ?jsc.JSValue = null;
        if (cfg.done_parameter) {
            group.log("callTestCallback -> appending done callback param: data {}", .{cfg.data});
            done_callback = DoneCallback.create(globalThis);
            args.append(this.gpa, done_callback.?);
        }

        const result: ?jsc.JSValue = cfg.callback.callback.get().call(globalThis, .js_undefined, args.get()) catch |e| blk: {
            this.onUncaughtException(globalThis, globalThis.takeError(e), false, cfg.data);
            group.log("callTestCallback -> error", .{});
            break :blk null;
        };

        var dcb_ref: ?*RefData = null;
        if (done_callback) |dcb| {
            if (DoneCallback.fromJS(dcb)) |dcb_data| {
                if (dcb_data.called) {
                    // done callback already called; add result immediately
                } else {
                    dcb_ref = this.ref(cfg.data);
                    dcb_data.ref = dcb_ref;
                }
            } else bun.debugAssert(false); // this should be unreachable, we create DoneCallback above
        }

        if (result != null and result.?.asPromise() != null) {
            group.log("callTestCallback -> promise: data {}", .{cfg.data});
            const this_ref: *RefData = if (dcb_ref) |dcb_ref_value| dcb_ref_value.dupe() else this.ref(cfg.data);
            result.?.then(globalThis, this_ref, bunTestThen, bunTestCatch);
            return;
        }

        if (dcb_ref) |_| {
            // completed asynchronously
            group.log("callTestCallback -> wait for done callback", .{});
            return;
        }

        group.log("callTestCallback -> sync", .{});
        this.addResult(cfg.data);
        return;
    }

    /// called from the uncaught exception handler, or if a test callback rejects or throws an error
    pub fn onUncaughtException(this: *BunTest, globalThis: *jsc.JSGlobalObject, result: jsc.JSValue, is_rejection: bool, user_data: RefDataValue) void {
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
        globalThis.bunVM().last_reported_error_for_dedupe = .zero;
        globalThis.bunVM().runErrorHandlerWithDedupe(result, null);
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

pub const CallbackEntry = struct {
    callback: CallbackWithArgs,
    done_parameter: bool,
    data: BunTest.RefDataValue,
    pub fn init(gpa: std.mem.Allocator, callback: CallbackWithArgs, done_parameter: bool, data: BunTest.RefDataValue) CallbackEntry {
        return .{
            .callback = callback.dupe(gpa),
            .done_parameter = done_parameter,
            .data = data,
        };
    }
    pub fn deinit(this: *CallbackEntry, gpa: std.mem.Allocator) void {
        this.callback.deinit(gpa);
    }
};

pub const CallbackWithArgs = struct {
    callback: Strong,
    args: Strong.List,

    pub fn init(gpa: std.mem.Allocator, callback: jsc.JSValue, args: []const jsc.JSValue) CallbackWithArgs {
        return .{
            .callback = .init(gpa, callback),
            .args = .init(gpa, args),
        };
    }
    pub fn deinit(this: *CallbackWithArgs, gpa: std.mem.Allocator) void {
        this.callback.deinit();
        this.args.deinit(gpa);
    }
    pub fn dupe(this: CallbackWithArgs, gpa: std.mem.Allocator) CallbackWithArgs {
        return .{
            .callback = this.callback.dupe(gpa),
            .args = this.args.dupe(gpa),
        };
    }
};

pub const Collection = @import("./Collection.zig");

pub const BaseScopeCfg = struct {
    self_concurrent: bool = false,
    self_mode: ScopeMode = .normal,
    self_only: bool = false,
    test_id_for_debugger: i32 = 0,
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
    pub fn init(this: BaseScopeCfg, gpa: std.mem.Allocator, name_not_owned: ?[]const u8, parent: ?*DescribeScope, has_callback: bool, allow_update_parent: bool) BaseScope {
        if (allow_update_parent) {
            if (this.self_only and parent != null) parent.?.markContainsOnly(); // TODO: this is a bad thing to have in an init function.
            if (has_callback and parent != null) parent.?.markHasCallback(); // TODO: these should be moved to their own pass rather than in an init function.
        }
        return .{
            .parent = parent,
            .name = if (name_not_owned) |name| gpa.dupe(u8, name) catch bun.outOfMemory() else null,
            .concurrent = this.self_concurrent or if (parent) |p| p.base.concurrent else false,
            .mode = if (parent) |p| if (p.base.mode != .normal) p.base.mode else this.self_mode else this.self_mode,
            .only = if (this.self_only) .yes else .no,
            .has_callback = has_callback,
            .test_id_for_debugger = this.test_id_for_debugger,
        };
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
            if (scope.base.only != .no) return; // already marked
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
        const child = create(gpa, .init(base, gpa, name_not_owned, this, false, true));
        try this.entries.append(.{ .describe = child });
        return child;
    }
    pub fn appendTest(this: *DescribeScope, gpa: std.mem.Allocator, name_not_owned: ?[]const u8, callback: ?CallbackWithArgs, cfg: ExecutionEntryCfg, base: BaseScopeCfg) bun.JSError!*ExecutionEntry {
        const entry = try ExecutionEntry.create(gpa, name_not_owned, callback, cfg, this, base, true);
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
        var callback_with_args: ?CallbackWithArgs = if (callback) |c| .init(gpa, c, &.{}) else null;
        defer if (callback_with_args) |*c| c.deinit(gpa);
        const entry = try ExecutionEntry.create(gpa, null, callback_with_args, cfg, this, base, false);
        try this.getHookEntries(tag).append(entry);
        return entry;
    }
};
pub const ExecutionEntryCfg = struct {
    line_no: u32,
    /// std.math.maxInt(u32) = no timeout
    timeout: u32 = std.math.maxInt(u32),
    has_done_parameter: bool,
};
pub const ExecutionEntry = struct {
    base: BaseScope,
    callback: ?CallbackWithArgs,
    /// only available if using junit reporter, otherwise 0
    line_no: u32,
    /// std.math.maxInt(u32) = no timeout
    timeout: u32,
    has_done_parameter: bool,
    /// '.epoch' = not set
    /// when this entry begins executing, the timespec will be set to the current time plus the timeout(ms).
    /// runOne will return the lowest timespec
    /// when the timeout completes, any items with a timespec < now will have their timespec reset to .epoch
    timespec: bun.timespec = .epoch,

    fn create(gpa: std.mem.Allocator, name_not_owned: ?[]const u8, cb: ?CallbackWithArgs, cfg: ExecutionEntryCfg, parent: ?*DescribeScope, base: BaseScopeCfg, allow_update_parent: bool) bun.JSError!*ExecutionEntry {
        const entry = bun.create(gpa, ExecutionEntry, .{
            .base = .init(base, gpa, name_not_owned, parent, cb != null, allow_update_parent),
            .callback = if (cb) |c| c.dupe(gpa) else null,
            .line_no = cfg.line_no,
            .timeout = cfg.timeout,
            .has_done_parameter = cfg.has_done_parameter,
        });
        return entry;
    }
    pub fn destroy(this: *ExecutionEntry, gpa: std.mem.Allocator) void {
        if (this.callback) |*c| c.deinit(gpa);
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
const Strong = jsc.Strong.Safe;
