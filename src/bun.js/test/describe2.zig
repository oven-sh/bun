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
        callback: jsc.JSValue,
        options: struct {
            timeout: ?f64 = null, // TODO: use this value
            retry: ?f64 = null, // TODO: use this value
            repeats: ?f64 = null, // TODO: use this value
        },
        pub fn deinit(this: *ParseArgumentsResult, gpa: std.mem.Allocator) void {
            if (this.description) |str| gpa.free(str);
        }
    };
    pub fn parseArguments(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, signature: Signature, bunTest: *BunTestFile) bun.JSError!ParseArgumentsResult {
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

        if (!callback.isFunction()) return globalThis.throw("{s} expects a function as the second argument", .{signature});

        var result: ParseArgumentsResult = .{
            .description = null,
            .callback = callback.withAsyncContextIfNeeded(globalThis),
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
        if (!cfg.allow_in_preload) {
            const vm = globalThis.bunVM();
            if (vm.is_in_preload) {
                return globalThis.throw("Cannot use {s} during preload.", .{cfg.signature});
            }
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

                const bunTestRoot = try getActiveTestRoot(globalThis, .{ .signature = .{ .str = @tagName(tag) ++ "()" }, .allow_in_preload = true });
                const bunTest = bunTestRoot.active_file orelse {
                    @panic("TODO implement genericHook in preload");
                };

                const callback = callFrame.argumentsAsArray(1)[0];
                if (!callback.isFunction()) {
                    return globalThis.throw("beforeAll/beforeEach/afterEach/afterAll() expects a function as the first argument", .{});
                }

                switch (bunTest.phase) {
                    .collection => {
                        try bunTest.collection.enqueueHookCallback(tag, callback, &.{}, .{
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

    pub fn init(outer_gpa: std.mem.Allocator) BunTest {
        return .{
            .gpa = outer_gpa,
            .active_file = null,
        };
    }
    pub fn deinit(this: *BunTest) void {
        bun.assert(this.active_file == null);
    }

    pub fn enterFile(this: *BunTest, _: []const u8) void {
        bun.assert(this.active_file == null);
        this.active_file = bun.create(this.gpa, BunTestFile, .init(this.gpa, this));
    }
    pub fn exitFile(this: *BunTest) void {
        bun.assert(this.active_file != null);
        this.active_file.?.deinit();
        this.gpa.destroy(this.active_file.?);
        this.active_file = null;
    }
};

/// TODO: this will be a JSValue (returned by `Bun.jest(...)`). there will be one per file. they will be gc objects and cleaned up when no longer used.
pub const BunTestFile = struct {
    buntest: *BunTest,
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

    pub fn init(outer_gpa: std.mem.Allocator, bunTest: *BunTest) BunTestFile {
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
            .collection = .init(gpa),
            .execution = .init(gpa),
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

    const RefData = struct {
        buntest: *BunTestFile,
        data: u64,
        pub fn deinit(this: *RefData) void {
            // TODO jsvalue(this).unprotect()
            this.buntest.gpa.destroy(this);
        }
    };
    pub fn ref(this: *BunTestFile, data: u64) *anyopaque {
        // TODO jsvalue(this).protect()
        return bun.create(this.gpa, RefData, .{ .buntest = this, .data = data });
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
                try order.generateOrderDescribe(&this.execution, this.collection.root_scope);
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
            const length = try cfg.callback.get().getLength(globalThis);
            if (length > cfg.args_owned.len) {
                // TODO: support done parameter
                @panic("TODO: support done parameter");
            }
        }

        const args_dupe = this.gpa.alloc(jsc.JSValue, cfg.args_owned.len) catch bun.outOfMemory();
        defer this.gpa.free(args_dupe);
        for (args_dupe, cfg.args_owned) |*arg, arg_owned| arg.* = arg_owned.get();

        const result: ?jsc.JSValue = cfg.callback.get().call(globalThis, .js_undefined, args_dupe) catch |e| blk: {
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
            .collection, .done => .unhandled,
            .execution => this.execution.handleUncaughtException(user_data),
        };

        if (handle_status == .consumed) return; // do not print error, it was already consumed

        if (handle_status == .unhandled) {
            bun.Output.prettyErrorln(
                \\<r>
                \\<b><d>#<r> <red><b>Unhandled error<r><d> between tests<r>
                \\<d>-------------------------------<r>
                \\
            , .{});
        }
        globalThis.bunVM().runErrorHandlerWithDedupe(result, null);
        bun.Output.flush();
        if (handle_status == .unhandled) {
            bun.Output.prettyError("<r><d>-------------------------------<r>\n\n", .{});
            bun.Output.flush();
        }
    }
};

pub const HandleUncaughtExceptionResult = enum {
    consumed,
    handled,
    unhandled,
};

pub const CallbackQueue = std.ArrayList(CallbackEntry);

pub const CallbackEntry = struct {
    callback: Strong,
    args_owned: []Strong,
    done_parameter: bool,
    data: u64,
    pub fn init(gpa: std.mem.Allocator, callback: jsc.JSValue, args: []Strong, done_parameter: bool, data: u64) CallbackEntry {
        const args_owned = gpa.dupe(gpa, args) catch bun.outOfMemory();
        errdefer gpa.free(args_owned);
        for (args_owned) |*arg| arg.* = arg.dupe(gpa);
        errdefer for (args_owned) |*arg| arg.deinit(gpa);

        return .{
            .callback = .init(gpa, callback),
            .args_owned = args_owned,
            .done_parameter = done_parameter,
            .data = data,
        };
    }
    pub fn deinit(this: *CallbackEntry, gpa: std.mem.Allocator) void {
        this.callback.deinit();
        for (this.args_owned) |*arg| arg.deinit();
        gpa.free(this.args_owned);
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
    fn needsCallback(this: ScopeMode) bool {
        return switch (this) {
            .normal, .failing => true,
            .skip => false,
            .todo => @panic("TODO: --todo flag should make .todo act like .failing"),
        };
    }
};
pub const BaseScope = struct {
    parent: ?*DescribeScope,
    name: ?[]const u8,
    concurrent: bool,
    mode: ScopeMode,
    only: enum { no, contains, yes },
    filter: enum { no, contains, yes },
    pub fn init(this: BaseScopeCfg, buntest: *BunTestFile, name_not_owned: ?[]const u8, parent: ?*DescribeScope) BaseScope {
        if (this.self_only and parent != null) parent.?.markContainsOnly();
        return .{
            .parent = parent,
            .name = if (name_not_owned) |name| buntest.gpa.dupe(u8, name) catch bun.outOfMemory() else null,
            .concurrent = this.self_concurrent or if (parent) |p| p.base.concurrent else false,
            .mode = if (parent) |p| if (p.base.mode != .normal) p.base.mode else this.self_mode else this.self_mode,
            .only = if (this.self_only) .yes else .no,
            .filter = if (this.self_filter) .yes else .no,
        };
    }
    pub fn deinit(this: BaseScope, buntest: *BunTestFile) void {
        if (this.name) |name| buntest.gpa.free(name);
    }
};

pub const DescribeScope = struct {
    base: BaseScope,
    entries: std.ArrayList(TestScheduleEntry),
    beforeAll: std.ArrayList(*ExecutionEntry),
    beforeEach: std.ArrayList(*ExecutionEntry),
    afterEach: std.ArrayList(*ExecutionEntry),
    afterAll: std.ArrayList(*ExecutionEntry),

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
    pub fn destroy(this: *DescribeScope, buntest: *BunTestFile) void {
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
        this.base.deinit(buntest);
        buntest.gpa.destroy(this);
    }

    fn markContainsOnly(this: *DescribeScope) void {
        var target: ?*DescribeScope = this;
        while (target) |scope| {
            if (scope.base.only != .no) return; // already marked
            scope.base.only = .contains;
            target = scope.base.parent;
        }
    }
    pub fn appendDescribe(this: *DescribeScope, buntest: *BunTestFile, name_not_owned: ?[]const u8, base: BaseScopeCfg) bun.JSError!*DescribeScope {
        const child = create(buntest.gpa, .init(base, buntest, name_not_owned, this));
        try this.entries.append(.{ .describe = child });
        return child;
    }
    pub fn appendTest(this: *DescribeScope, buntest: *BunTestFile, name_not_owned: ?[]const u8, cb: ?jsc.JSValue, args_not_owned: []const Strong, cfg: ExecutionEntryCfg, base: BaseScopeCfg) bun.JSError!*ExecutionEntry {
        const entry = try ExecutionEntry.create(buntest, name_not_owned, cb, args_not_owned, cfg, this, base);
        try this.entries.append(.{ .test_callback = entry });
        return entry;
    }
    pub fn appendHook(this: *DescribeScope, buntest: *BunTestFile, tag: enum { beforeAll, beforeEach, afterEach, afterAll }, callback: ?jsc.JSValue, args: []const Strong, cfg: ExecutionEntryCfg, base: BaseScopeCfg) bun.JSError!*ExecutionEntry {
        const entry = try ExecutionEntry.create(buntest, null, callback, args, cfg, this, base);
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
    callback: Strong.Optional,
    args_owned: []Strong,
    /// only available if using junit reporter, otherwise 0
    line_no: u32,
    result: Execution.Result = .pending,

    fn create(buntest: *BunTestFile, name_not_owned: ?[]const u8, cb: ?jsc.JSValue, args_not_owned: []const Strong, cfg: ExecutionEntryCfg, parent: ?*DescribeScope, base: BaseScopeCfg) bun.JSError!*ExecutionEntry {
        const args = buntest.gpa.dupe(Strong, args_not_owned) catch bun.outOfMemory();
        errdefer buntest.gpa.free(args);
        for (args) |*arg| arg.* = arg.dupe(buntest.gpa);
        errdefer for (args) |*arg| arg.deinit(buntest.gpa);

        const entry = bun.create(buntest.gpa, ExecutionEntry, .{
            .base = .init(base, buntest, name_not_owned, parent),
            .callback = .init(buntest.gpa, cb),
            .args_owned = args,
            .line_no = cfg.line_no,
        });
        return entry;
    }
    pub fn destroy(this: *ExecutionEntry, buntest: *BunTestFile) void {
        this.callback.deinit();
        for (this.args_owned) |*arg| arg.deinit();
        buntest.gpa.free(this.args_owned);
        this.base.deinit(buntest);
        buntest.gpa.destroy(this);
    }
};
pub const TestScheduleEntry = union(enum) {
    describe: *DescribeScope,
    test_callback: *ExecutionEntry,
    fn deinit(
        this: *TestScheduleEntry,
        buntest: *BunTestFile,
    ) void {
        switch (this.*) {
            .describe => |describe| describe.destroy(buntest),
            .test_callback => |test_scope| test_scope.destroy(buntest),
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
