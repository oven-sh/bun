const Signature = union(enum) {
    scope_functions: *const ScopeFunctions,
    str: []const u8,
    pub fn format(this: Signature, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        switch (this) {
            .scope_functions => try writer.print("{}", .{this.scope_functions.*}),
            .str => try writer.print("{s}", .{this.str}),
        }
    }
};

pub fn getActive() ?*BunTestFile {
    const runner = bun.jsc.Jest.Jest.runner orelse return null;
    return runner.describe2Root.active_file orelse return null;
}

pub const js_fns = struct {
    fn getDescription(gpa: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, description: jsc.JSValue, signature: Signature) bun.JSError![]const u8 {
        const is_valid_description =
            description.isClass(globalThis) or
            (description.isFunction() and !description.getName(globalThis).isEmpty()) or
            description.isNumber() or
            description.isString();

        if (!is_valid_description) {
            return globalThis.throwPretty("{s} expects first argument to be a named class, named function, number, or string", .{signature});
        }

        if (description == .zero) {
            return "";
        }

        if (description.isClass(globalThis)) {
            const name_str = if ((try description.className(globalThis)).toSlice(gpa).length() == 0)
                description.getName(globalThis).toSlice(gpa).slice()
            else
                (try description.className(globalThis)).toSlice(gpa).slice();
            return try gpa.dupe(u8, name_str);
        }
        if (description.isFunction()) {
            var slice = description.getName(globalThis).toSlice(gpa);
            defer slice.deinit();
            return try gpa.dupe(u8, slice.slice());
        }
        var slice = try description.toSlice(globalThis, gpa);
        defer slice.deinit();
        return try gpa.dupe(u8, slice.slice());
    }

    const DescribeConfig = struct {
        base: BaseScopeCfg,
        signature: Signature,
    };
    pub fn genericDescribe(comptime cfg: DescribeConfig) type {
        return struct {
            pub fn describeFn(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
                return js_fns.describeFn(globalThis, callframe, cfg);
            }
        };
    }
    const ParseArgumentsResult = struct {
        description: ?[]const u8,
        callback: ?jsc.JSValue,
        options: struct {
            timeout: ?f64 = null, // TODO: use this value
            retry: ?f64 = null, // TODO: use this value
            repeats: ?f64 = null, // TODO: use this value
        },
        pub fn deinit(this: *ParseArgumentsResult, gpa: std.mem.Allocator) void {
            if (this.description) |str| gpa.free(str);
        }
    };
    pub const CallbackMode = enum { require, allow, ignore };
    pub fn parseArguments(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, signature: Signature, bunTest: *BunTestFile, cfg: struct { callback: CallbackMode }) bun.JSError!ParseArgumentsResult {
        var a1, var a2, var a3 = callframe.argumentsAsArray(3);

        if (a1.isFunction()) {
            a3 = a2;
            a2 = a1;
            a1 = .js_undefined;
        }
        if (!a2.isFunction() and a3.isFunction()) {
            const tmp = a2;
            a2 = a3;
            a3 = tmp;
        }

        const description, const callback, const options = .{ a1, a2, a3 };

        const result_callback: ?jsc.JSValue = if (cfg.callback == .ignore) blk: {
            break :blk null;
        } else if (cfg.callback != .require and callback.isUndefinedOrNull()) blk: {
            break :blk null;
        } else if (callback.isFunction()) blk: {
            break :blk callback.withAsyncContextIfNeeded(globalThis);
        } else {
            return globalThis.throw("{s} expects a function as the second argument", .{signature});
        };

        var result: ParseArgumentsResult = .{
            .description = null,
            .callback = result_callback,
            .options = .{},
        };
        errdefer result.deinit(bunTest.gpa);

        if (options.isNumber()) {
            result.options.timeout = options.asNumber();
        } else if (options.isObject()) {
            if (try options.get(globalThis, "timeout")) |timeout| {
                if (!timeout.isNumber()) {
                    return globalThis.throwPretty("{s} expects timeout to be a number", .{signature});
                }
                result.options.timeout = timeout.asNumber();
            }
            if (try options.get(globalThis, "retry")) |retries| {
                if (!retries.isNumber()) {
                    return globalThis.throwPretty("{s} expects retry to be a number", .{signature});
                }
                result.options.retry = retries.asNumber();
            }
            if (try options.get(globalThis, "repeats")) |repeats| {
                if (!repeats.isNumber()) {
                    return globalThis.throwPretty("{s} expects repeats to be a number", .{signature});
                }
                result.options.repeats = repeats.asNumber();
            }
        } else if (options.isUndefinedOrNull()) {
            // no options
        } else {
            return globalThis.throw("describe() expects a number, object, or undefined as the third argument", .{});
        }

        result.description = if (description.isUndefinedOrNull()) null else try getDescription(bunTest.gpa, globalThis, description, signature);

        return result;
    }

    const GetActiveCfg = struct { signature: Signature, allow_in_preload: bool };
    fn getActiveTestRoot(globalThis: *jsc.JSGlobalObject, cfg: GetActiveCfg) bun.JSError!*BunTest {
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
    pub fn getActive(globalThis: *jsc.JSGlobalObject, cfg: GetActiveCfg) bun.JSError!*BunTestFile {
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

                const bunTestRoot = try getActiveTestRoot(globalThis, .{ .signature = .{ .str = @tagName(tag) ++ "()" }, .allow_in_preload = true });
                const bunTest = bunTestRoot.getActiveFileUnlessInPreload(globalThis.bunVM()) orelse {
                    group.log("genericHook in preload", .{});

                    _ = try bunTestRoot.hook_scope.appendHook(bunTestRoot.gpa, tag, callback, .{
                        .line_no = 0,
                    }, .{});
                    return .js_undefined;
                };

                switch (bunTest.phase) {
                    .collection => {
                        try bunTest.collection.enqueueHookCallback(tag, callback, .{
                            .line_no = 0,
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

pub const BunTest = struct {
    gpa: std.mem.Allocator,
    active_file: ?*BunTestFile,

    hook_scope: *DescribeScope,

    pub fn init(outer_gpa: std.mem.Allocator) BunTest {
        const gpa = outer_gpa;
        const hook_scope = DescribeScope.create(gpa, .{
            .parent = null,
            .name = null,
            .concurrent = false,
            .mode = .normal,
            .only = .no,
            .filter = .no,
        });
        return .{
            .gpa = outer_gpa,
            .active_file = null,
            .hook_scope = hook_scope,
        };
    }
    pub fn deinit(this: *BunTest) void {
        bun.assert(this.hook_scope.entries.items.len == 0); // entries must not be appended to the hook_scope
        this.hook_scope.destroy(this.gpa);
        bun.assert(this.active_file == null);
    }

    pub fn enterFile(this: *BunTest, file_id: jsc.Jest.TestRunner.File.ID, reporter: *test_command.CommandLineReporter) void {
        group.begin(@src());
        defer group.end();

        bun.assert(this.active_file == null);
        this.active_file = bun.create(this.gpa, BunTestFile, .init(this.gpa, this, file_id, reporter));
    }
    pub fn exitFile(this: *BunTest) void {
        group.begin(@src());
        defer group.end();

        bun.assert(this.active_file != null);
        this.active_file.?.reporter = null;
        this.active_file.?.deinit(); // TODO: deref rather than deinit
        this.gpa.destroy(this.active_file.?);
        this.active_file = null;
    }
    pub fn getActiveFileUnlessInPreload(this: *BunTest, vm: *jsc.VirtualMachine) ?*BunTestFile {
        if (vm.is_in_preload) {
            return null;
        }
        return this.active_file;
    }
};

pub const BunTestFile = struct {
    // const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    // ref_count: RefCount, // TODO: add ref count & hide the deinit function (deinit->deinitFromUnref())

    buntest: *BunTest,
    in_run_loop: bool,
    allocation_scope: *bun.AllocationScope,
    gpa: std.mem.Allocator,
    done_promise: Strong.Optional = .empty,
    file_id: jsc.Jest.TestRunner.File.ID,
    /// null if the runner has moved on to the next file
    reporter: ?*test_command.CommandLineReporter,

    phase: enum {
        collection,
        execution,
        done,
    },
    collection: Collection,
    execution: Execution,

    pub fn init(outer_gpa: std.mem.Allocator, bunTest: *BunTest, file_id: jsc.Jest.TestRunner.File.ID, reporter: *test_command.CommandLineReporter) BunTestFile {
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
        };
    }
    pub fn deinit(this: *BunTestFile) void {
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

    pub const RefData = struct {
        buntest: *BunTestFile,
        data: u64,
        pub fn deinit(this: *RefData) void {
            // TODO: ref counted
            // this.buntest.gpa.destroy(this);
            bun.destroy(this);
        }
    };
    pub fn ref(this: *BunTestFile, data: u64) *RefData {
        // TODO: BunTestFile must be ref-counted to prevent UAF
        // return bun.create(this.gpa, RefData, .{ .buntest = this, .data = data });
        return bun.new(RefData, .{ .buntest = this, .data = data });
    }

    pub fn refActiveExecutionEntry(this: *BunTestFile) ?Execution.CurrentEntryRef {
        if (this.phase != .execution) return null;

        const ref_value = this.ref(0);

        const active_group = &this.execution.order.items[this.execution.order_index];
        if (active_group.sequence_start + 1 != active_group.sequence_end) return .{
            ._internal_ref = ref_value,
            .buntest = this,
            .order_index = this.execution.order_index,
            .entry_data = null, // the current execution entry is not known because we are running a concurrent test
        };

        const active_sequence_index = active_group.sequence_start; // if there is only one concurrent item, then this is the active sequence index
        const sequence = &this.execution._sequences.items[active_sequence_index];
        return .{
            ._internal_ref = ref_value,
            .buntest = this,
            .order_index = this.execution.order_index,
            .entry_data = .{
                .sequence_index = active_sequence_index,
                .entry_index = sequence.entry_index,
            },
        };
    }

    pub fn getFile(_: *BunTestFile) []const u8 {
        return "/TODO/"; // TODO: store the file name (each file has its own BunTest instance)
    }
    pub fn getReporter(_: *BunTestFile) ?test_command.FileReporter {
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

        if (is_catch) {
            this.onUncaughtException(globalThis, result, true, refdata.data);
        }

        try this.runOneCompleted(globalThis, if (is_catch) null else result, refdata.data);
        try this.run(globalThis);
        return .js_undefined;
    }
    fn bunTestThen(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return bunTestThenOrCatch(globalThis, callframe, false);
    }
    fn bunTestCatch(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return bunTestThenOrCatch(globalThis, callframe, true);
    }
    fn addThen(this: *BunTestFile, globalThis: *jsc.JSGlobalObject, promise: jsc.JSValue, data: u64) void {
        promise.then(globalThis, this.ref(data), bunTestThen, bunTestCatch); // TODO: this function is odd. it requires manually exporting the describeCallbackThen as a toJSHostFn and also adding logic in c++
    }

    pub fn run(this: *BunTestFile, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
        group.begin(@src());
        defer group.end();

        if (this.in_run_loop) return; // already running. this can happen because of waitForPromise. the promise will resolve inside the waitForPromise and call run() from bunTestThenOrCatch.
        this.in_run_loop = true;
        defer this.in_run_loop = false;

        var callback_queue: CallbackQueue = .init(this.gpa);
        defer callback_queue.deinit();

        while (true) {
            defer callback_queue.clearRetainingCapacity();
            defer for (callback_queue.items) |*item| item.deinit(this.gpa);

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

    fn _advance(this: *BunTestFile, globalThis: *jsc.JSGlobalObject) bun.JSError!enum { cont, exit } {
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
                try order.generateOrderBeforeAll(&this.execution, this.buntest.hook_scope.beforeAll.items, .{ .concurrent = false });
                try order.generateOrderDescribe(&this.execution, this.collection.root_scope);
                try order.generateOrderAfterAll(&this.execution, this.buntest.hook_scope.afterAll.items, .{ .concurrent = false });
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

    fn runOneCompleted(this: *BunTestFile, globalThis: *jsc.JSGlobalObject, result_value: ?jsc.JSValue, data: u64) bun.JSError!void {
        switch (this.phase) {
            .collection => try this.collection.runOneCompleted(globalThis, result_value, data),
            .execution => try this.execution.runOneCompleted(globalThis, result_value, data),
            .done => bun.debugAssert(false),
        }
    }

    const CallNowResult = enum {
        continue_sync,
        continue_async,
    };
    fn _callTestCallbackNow(this: *BunTestFile, globalThis: *jsc.JSGlobalObject, cfg: CallbackEntry) bun.JSError!CallNowResult {
        group.begin(@src());
        defer group.end();

        // TODO: this will need to support:
        // - in tests, (done) => {} callbacks
        // - for test.concurrent, we will have multiple 'then's active at once, and they will
        //   need to be able to pass context information to runOneCompleted

        if (cfg.done_parameter) {
            const length = try cfg.callback.callback.get().getLength(globalThis);
            if (length > cfg.callback.args.get().len) {
                // TODO: support done parameter
                @panic("TODO: support done parameter");
            }
        }

        const result: ?jsc.JSValue = cfg.callback.callback.get().call(globalThis, .js_undefined, cfg.callback.args.get()) catch |e| blk: {
            this.onUncaughtException(globalThis, globalThis.takeError(e), false, cfg.data);
            group.log("callTestCallback -> error", .{});
            break :blk null;
        };

        if (result != null and result.?.asPromise() != null) {
            group.log("callTestCallback -> promise", .{});
            this.addThen(globalThis, result.?, cfg.data);
            return .continue_async;
        }

        group.log("callTestCallback -> sync", .{});
        try this.runOneCompleted(globalThis, result, cfg.data);
        return .continue_sync;
    }

    /// called from the uncaught exception handler, or if a test callback rejects or throws an error
    pub fn onUncaughtException(this: *BunTestFile, globalThis: *jsc.JSGlobalObject, result: jsc.JSValue, is_rejection: bool, user_data: ?u64) void {
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
        globalThis.bunVM().runErrorHandlerWithDedupe(result, null);
        bun.Output.flush();
        if (handle_status == .show_unhandled_error_between_tests or handle_status == .show_unhandled_error_in_describe) {
            bun.Output.prettyError("<r><d>-------------------------------<r>\n\n", .{});
            bun.Output.flush();
        }
    }
};

pub const HandleUncaughtExceptionResult = enum { hide_error, show_handled_error, show_unhandled_error_between_tests, show_unhandled_error_in_describe };

pub const CallbackQueue = std.ArrayList(CallbackEntry);

pub const CallbackEntry = struct {
    callback: CallbackWithArgs,
    done_parameter: bool,
    data: u64,
    pub fn init(gpa: std.mem.Allocator, callback: CallbackWithArgs, done_parameter: bool, data: u64) CallbackEntry {
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
    self_filter: bool = false,
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
        if (other.self_filter) {
            if (result.self_filter) return null;
            result.self_filter = true;
        }
        return result;
    }
};
pub const ScopeMode = enum {
    normal,
    skip,
    todo,
    failing,
};
pub const BaseScope = struct {
    parent: ?*DescribeScope,
    name: ?[]const u8,
    concurrent: bool,
    mode: ScopeMode,
    only: enum { no, contains, yes },
    filter: enum { no, contains, yes },
    pub fn init(this: BaseScopeCfg, gpa: std.mem.Allocator, name_not_owned: ?[]const u8, parent: ?*DescribeScope) BaseScope {
        if (this.self_only and parent != null) parent.?.markContainsOnly();
        return .{
            .parent = parent,
            .name = if (name_not_owned) |name| gpa.dupe(u8, name) catch bun.outOfMemory() else null,
            .concurrent = this.self_concurrent or if (parent) |p| p.base.concurrent else false,
            .mode = if (parent) |p| if (p.base.mode != .normal) p.base.mode else this.self_mode else this.self_mode,
            .only = if (this.self_only) .yes else .no,
            .filter = if (this.self_filter) .yes else .no,
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
    pub fn appendDescribe(this: *DescribeScope, gpa: std.mem.Allocator, name_not_owned: ?[]const u8, base: BaseScopeCfg) bun.JSError!*DescribeScope {
        const child = create(gpa, .init(base, gpa, name_not_owned, this));
        try this.entries.append(.{ .describe = child });
        return child;
    }
    pub fn appendTest(this: *DescribeScope, gpa: std.mem.Allocator, name_not_owned: ?[]const u8, callback: ?CallbackWithArgs, cfg: ExecutionEntryCfg, base: BaseScopeCfg) bun.JSError!*ExecutionEntry {
        const entry = try ExecutionEntry.create(gpa, name_not_owned, callback, cfg, this, base);
        try this.entries.append(.{ .test_callback = entry });
        return entry;
    }
    pub fn appendHook(this: *DescribeScope, gpa: std.mem.Allocator, tag: enum { beforeAll, beforeEach, afterEach, afterAll }, callback: ?jsc.JSValue, cfg: ExecutionEntryCfg, base: BaseScopeCfg) bun.JSError!*ExecutionEntry {
        var callback_with_args: ?CallbackWithArgs = if (callback) |c| .init(gpa, c, &.{}) else null;
        defer if (callback_with_args) |*c| c.deinit(gpa);
        const entry = try ExecutionEntry.create(gpa, null, callback_with_args, cfg, this, base);
        switch (tag) {
            .beforeAll => try this.beforeAll.append(entry),
            .beforeEach => try this.beforeEach.append(entry),
            .afterEach => try this.afterEach.append(entry),
            .afterAll => try this.afterAll.append(entry),
        }
        return entry;
    }
};
pub const ExecutionEntryCfg = struct {
    line_no: u32,
};
pub const ExecutionEntry = struct {
    base: BaseScope,
    callback: ?CallbackWithArgs,
    /// only available if using junit reporter, otherwise 0
    line_no: u32,
    result: Execution.Result = .pending,

    fn create(gpa: std.mem.Allocator, name_not_owned: ?[]const u8, cb: ?CallbackWithArgs, cfg: ExecutionEntryCfg, parent: ?*DescribeScope, base: BaseScopeCfg) bun.JSError!*ExecutionEntry {
        const entry = bun.create(gpa, ExecutionEntry, .{
            .base = .init(base, gpa, name_not_owned, parent),
            .callback = if (cb) |c| c.dupe(gpa) else null,
            .line_no = cfg.line_no,
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
    pub fn isOrContainsOnly(this: TestScheduleEntry) bool {
        switch (this) {
            .describe => |describe| return describe.base.only != .no,
            .test_callback => |test_callback| return test_callback.base.only != .no,
        }
    }
};
pub const RunOneResult = enum {
    done,
    execute,
};

pub const Execution = @import("./Execution.zig");
pub const debug = @import("./debug.zig");
pub const order = @import("./order.zig");

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

pub const ScopeFunctions = @import("./ScopeFunctions.zig");

const std = @import("std");
const test_command = @import("../../cli/test_command.zig");

const bun = @import("bun");
const jsc = bun.jsc;
const Strong = jsc.Strong.Safe;
