const std = @import("std");
const bun = @import("root").bun;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const Api = @import("../../api/schema.zig").Api;
const RequestContext = @import("../../http.zig").RequestContext;
const MimeType = @import("../../http.zig").MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = @import("root").bun.HTTP;
const NetworkThread = HTTPClient.NetworkThread;
const Environment = @import("../../env.zig");

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
const d = @import("../base.zig").d;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;

const ZigString = JSC.ZigString;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;
const JSObject = JSC.JSObject;
const CallFrame = JSC.CallFrame;

const VirtualMachine = JSC.VirtualMachine;
const Task = @import("../javascript.zig").Task;

const Fs = @import("../../fs.zig");
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;

const ArrayIdentityContext = @import("../../identity_context.zig").ArrayIdentityContext;
pub var test_elapsed_timer: ?*std.time.Timer = null;

pub const Tag = enum(u3) {
    pass,
    fail,
    only,
    skip,
    todo,
};

pub const TestRunner = struct {
    tests: TestRunner.Test.List = .{},
    log: *logger.Log,
    files: File.List = .{},
    index: File.Map = File.Map{},
    only: bool = false,
    run_todo: bool = false,
    last_file: u64 = 0,

    allocator: std.mem.Allocator,
    callback: *Callback = undefined,

    drainer: JSC.AnyTask = undefined,
    queue: std.fifo.LinearFifo(*TestRunnerTask, .{ .Dynamic = {} }) = std.fifo.LinearFifo(*TestRunnerTask, .{ .Dynamic = {} }).init(default_allocator),

    has_pending_tests: bool = false,
    pending_test: ?*TestRunnerTask = null,

    /// This silences TestNotRunningError when expect() is used to halt a running test.
    did_pending_test_fail: bool = false,

    snapshots: Snapshots,

    default_timeout_ms: u32 = 0,
    test_timeout_timer: ?*bun.uws.Timer = null,
    last_test_timeout_timer_duration: u32 = 0,
    active_test_for_timeout: ?TestRunner.Test.ID = null,

    global_callbacks: struct {
        beforeAll: std.ArrayListUnmanaged(JSC.JSValue) = .{},
        beforeEach: std.ArrayListUnmanaged(JSC.JSValue) = .{},
        afterEach: std.ArrayListUnmanaged(JSC.JSValue) = .{},
        afterAll: std.ArrayListUnmanaged(JSC.JSValue) = .{},
    } = .{},

    pub const Drainer = JSC.AnyTask.New(TestRunner, drain);

    pub fn onTestTimeout(timer: *bun.uws.Timer) callconv(.C) void {
        var this = timer.ext(TestRunner).?;

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
                this.test_timeout_timer = bun.uws.Timer.createFallthrough(bun.uws.Loop.get().?, this);
            }

            if (this.last_test_timeout_timer_duration != milliseconds) {
                this.last_test_timeout_timer_duration = milliseconds;
                this.test_timeout_timer.?.set(this, onTestTimeout, @intCast(i32, milliseconds), @intCast(i32, milliseconds));
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
        JSC.VirtualMachine.get().uws_event_loop.?.wakeup();
    }

    pub fn drain(this: *TestRunner) void {
        if (this.pending_test != null) return;

        if (this.queue.readItem()) |task| {
            this.pending_test = task;
            this.has_pending_tests = true;
            this.did_pending_test_fail = false;
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

        var list = this.queue.readableSlice(0);
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
        const start = @truncate(Test.ID, this.tests.len);
        this.tests.len += count;
        var statuses = this.tests.items(.status)[start..][0..count];
        std.mem.set(Test.Status, statuses, Test.Status.pending);
        this.callback.onUpdateCount(this.callback, count, count + start);
        return start;
    }

    pub fn getOrPutFile(this: *TestRunner, file_path: string) *DescribeScope {
        var entry = this.index.getOrPut(this.allocator, @truncate(u32, std.hash.Wyhash.hash(0, file_path))) catch unreachable;
        if (entry.found_existing) {
            return this.files.items(.module_scope)[entry.value_ptr.*];
        }
        var scope = this.allocator.create(DescribeScope) catch unreachable;
        const file_id = @truncate(File.ID, this.files.len);
        scope.* = DescribeScope{
            .file_id = file_id,
            .test_id_start = @truncate(Test.ID, this.tests.len),
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

pub const Snapshots = struct {
    const file_header = "// Bun Snapshot v1, https://goo.gl/fbAQLP\n";
    pub const ValuesHashMap = std.HashMap(usize, string, bun.IdentityContext(usize), std.hash_map.default_max_load_percentage);

    allocator: std.mem.Allocator,
    update_snapshots: bool,
    total: usize = 0,
    added: usize = 0,
    passed: usize = 0,
    failed: usize = 0,

    file_buf: *std.ArrayList(u8),
    values: *ValuesHashMap,
    counts: *bun.StringHashMap(usize),
    _current_file: ?File = null,
    snapshot_dir_path: ?string = null,

    const File = struct {
        id: TestRunner.File.ID,
        file: std.fs.File,
    };

    pub fn getOrPut(this: *Snapshots, expect: *Expect, value: JSValue, hint: string, globalObject: *JSC.JSGlobalObject) !?string {
        switch (try this.getSnapshotFile(expect.scope.file_id)) {
            .result => {},
            .err => |err| {
                return switch (err.syscall) {
                    .mkdir => error.FailedToMakeSnapshotDirectory,
                    .open => error.FailedToOpenSnapshotFile,
                    else => error.SnapshotFailed,
                };
            },
        }

        const snapshot_name = try expect.getSnapshotName(this.allocator, hint);
        this.total += 1;

        var count_entry = try this.counts.getOrPut(snapshot_name);
        const counter = brk: {
            if (count_entry.found_existing) {
                this.allocator.free(snapshot_name);
                count_entry.value_ptr.* += 1;
                break :brk count_entry.value_ptr.*;
            }
            count_entry.value_ptr.* = 1;
            break :brk count_entry.value_ptr.*;
        };

        const name = count_entry.key_ptr.*;

        var counter_string_buf = [_]u8{0} ** 32;
        var counter_string = try std.fmt.bufPrint(&counter_string_buf, "{d}", .{counter});

        var name_with_counter = try this.allocator.alloc(u8, name.len + 1 + counter_string.len);
        defer this.allocator.free(name_with_counter);
        bun.copy(u8, name_with_counter[0..name.len], name);
        name_with_counter[name.len] = ' ';
        bun.copy(u8, name_with_counter[name.len + 1 ..], counter_string);

        const name_hash = std.hash.Wyhash.hash(0, name_with_counter);
        if (this.values.get(name_hash)) |expected| {
            return expected;
        }

        // doesn't exist. append to file bytes and add to hashmap.
        var pretty_value = try MutableString.init(this.allocator, 0);
        try value.jestSnapshotPrettyFormat(&pretty_value, globalObject);

        const serialized_length = "\nexports[`".len + name_with_counter.len + "`] = `".len + pretty_value.list.items.len + "`;\n".len;
        try this.file_buf.ensureUnusedCapacity(serialized_length);
        this.file_buf.appendSliceAssumeCapacity("\nexports[`");
        this.file_buf.appendSliceAssumeCapacity(name_with_counter);
        this.file_buf.appendSliceAssumeCapacity("`] = `");
        this.file_buf.appendSliceAssumeCapacity(pretty_value.list.items);
        this.file_buf.appendSliceAssumeCapacity("`;\n");

        this.added += 1;
        try this.values.put(name_hash, pretty_value.toOwnedSlice());
        return null;
    }

    pub fn parseFile(this: *Snapshots) !void {
        if (this.file_buf.items.len == 0) return;

        const vm = VirtualMachine.get();
        var opts = js_parser.Parser.Options.init(vm.bundler.options.jsx, .js);
        var temp_log = logger.Log.init(this.allocator);

        const test_file = Jest.runner.?.files.get(this._current_file.?.id);
        const test_filename = test_file.source.path.name.filename;
        const dir_path = test_file.source.path.name.dirWithTrailingSlash();

        var snapshot_file_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var remain: []u8 = snapshot_file_path_buf[0..bun.MAX_PATH_BYTES];
        bun.copy(u8, remain, dir_path);
        remain = remain[dir_path.len..];
        bun.copy(u8, remain, "__snapshots__/");
        remain = remain["__snapshots__/".len..];
        bun.copy(u8, remain, test_filename);
        remain = remain[test_filename.len..];
        bun.copy(u8, remain, ".snap");
        remain = remain[".snap".len..];
        remain[0] = 0;
        const snapshot_file_path = snapshot_file_path_buf[0 .. snapshot_file_path_buf.len - remain.len :0];

        const source = logger.Source.initPathString(snapshot_file_path, this.file_buf.items);

        var parser = try js_parser.Parser.init(
            opts,
            &temp_log,
            &source,
            vm.bundler.options.define,
            this.allocator,
        );

        var parse_result = try parser.parse();
        var ast = if (parse_result == .ast) parse_result.ast else return error.ParseError;
        defer ast.deinit();

        if (ast.exports_ref.isNull()) return;
        const exports_ref = ast.exports_ref;

        // TODO: when common js transform changes, keep this updated or add flag to support this version

        const export_default = brk: {
            for (ast.parts.slice()) |part| {
                for (part.stmts) |stmt| {
                    if (stmt.data == .s_export_default and stmt.data.s_export_default.value == .expr) {
                        break :brk stmt.data.s_export_default.value.expr;
                    }
                }
            }

            return;
        };

        if (export_default.data == .e_call) {
            const function_call = export_default.data.e_call;
            if (function_call.args.len == 2 and function_call.args.ptr[0].data == .e_function) {
                const arg_function_stmts = function_call.args.ptr[0].data.e_function.func.body.stmts;
                for (arg_function_stmts) |stmt| {
                    switch (stmt.data) {
                        .s_expr => |expr| {
                            if (expr.value.data == .e_binary and expr.value.data.e_binary.op == .bin_assign) {
                                const left = expr.value.data.e_binary.left;
                                if (left.data == .e_index and left.data.e_index.index.data == .e_string and left.data.e_index.target.data == .e_identifier) {
                                    const target: js_ast.E.Identifier = left.data.e_index.target.data.e_identifier;
                                    var index: *js_ast.E.String = left.data.e_index.index.data.e_string;
                                    if (target.ref.eql(exports_ref) and expr.value.data.e_binary.right.data == .e_string) {
                                        const key = index.slice(this.allocator);
                                        var value_string = expr.value.data.e_binary.right.data.e_string;
                                        const value = value_string.slice(this.allocator);
                                        defer {
                                            if (!index.isUTF8()) this.allocator.free(key);
                                            if (!value_string.isUTF8()) this.allocator.free(value);
                                        }
                                        const value_clone = try this.allocator.alloc(u8, value.len);
                                        bun.copy(u8, value_clone, value);
                                        const name_hash = std.hash.Wyhash.hash(0, key);
                                        try this.values.put(name_hash, value_clone);
                                    }
                                }
                            }
                        },
                        else => {},
                    }
                }
            }
        }
    }

    pub fn writeSnapshotFile(this: *Snapshots) !void {
        if (this._current_file) |_file| {
            var file = _file;
            file.file.writeAll(this.file_buf.items) catch {
                return error.FailedToWriteSnapshotFile;
            };
            file.file.close();
            this.file_buf.clearAndFree();

            var value_itr = this.values.valueIterator();
            while (value_itr.next()) |value| {
                this.allocator.free(value.*);
            }
            this.values.clearAndFree();

            var count_key_itr = this.counts.keyIterator();
            while (count_key_itr.next()) |key| {
                this.allocator.free(key.*);
            }
            this.counts.clearAndFree();
        }
    }

    fn getSnapshotFile(this: *Snapshots, file_id: TestRunner.File.ID) !JSC.Maybe(void) {
        if (this._current_file == null or this._current_file.?.id != file_id) {
            try this.writeSnapshotFile();

            const test_file = Jest.runner.?.files.get(file_id);
            const test_filename = test_file.source.path.name.filename;
            const dir_path = test_file.source.path.name.dirWithTrailingSlash();

            var snapshot_file_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var remain: []u8 = snapshot_file_path_buf[0..bun.MAX_PATH_BYTES];
            bun.copy(u8, remain, dir_path);
            remain = remain[dir_path.len..];
            bun.copy(u8, remain, "__snapshots__/");
            remain = remain["__snapshots__/".len..];

            if (this.snapshot_dir_path == null or !strings.eqlLong(dir_path, this.snapshot_dir_path.?, true)) {
                remain[0] = 0;
                const snapshot_dir_path = snapshot_file_path_buf[0 .. snapshot_file_path_buf.len - remain.len :0];
                switch (JSC.Node.Syscall.mkdir(snapshot_dir_path, 0o777)) {
                    .result => this.snapshot_dir_path = dir_path,
                    .err => |err| {
                        switch (err.getErrno()) {
                            std.os.E.EXIST => this.snapshot_dir_path = dir_path,
                            else => return JSC.Maybe(void){
                                .err = err,
                            },
                        }
                    },
                }
            }

            bun.copy(u8, remain, test_filename);
            remain = remain[test_filename.len..];
            bun.copy(u8, remain, ".snap");
            remain = remain[".snap".len..];
            remain[0] = 0;
            const snapshot_file_path = snapshot_file_path_buf[0 .. snapshot_file_path_buf.len - remain.len :0];

            var flags: JSC.Node.Mode = std.os.O.CREAT | std.os.O.RDWR;
            if (this.update_snapshots) flags |= std.os.O.TRUNC;
            const fd = switch (JSC.Node.Syscall.open(snapshot_file_path, flags, 0o644)) {
                .result => |_fd| _fd,
                .err => |err| return JSC.Maybe(void){
                    .err = err,
                },
            };

            var file: File = .{
                .id = file_id,
                .file = .{ .handle = fd },
            };

            if (this.update_snapshots) {
                try this.file_buf.appendSlice(file_header);
            } else {
                const length = try file.file.getEndPos();
                if (length == 0) {
                    try this.file_buf.appendSlice(file_header);
                } else {
                    const buf = try this.allocator.alloc(u8, length);
                    _ = try file.file.preadAll(buf, 0);
                    try this.file_buf.appendSlice(buf);
                    this.allocator.free(buf);
                }
            }

            this._current_file = file;
            try this.parseFile();
        }

        return JSC.Maybe(void).success;
    }
};

pub const Jest = struct {
    pub var runner: ?*TestRunner = null;

    fn globalHook(comptime name: string) JSC.JSHostFunctionType {
        return struct {
            pub fn appendGlobalFunctionCallback(
                globalThis: *JSC.JSGlobalObject,
                callframe: *JSC.CallFrame,
            ) callconv(.C) JSValue {
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
                @field(Jest.runner.?.global_callbacks, name).append(
                    bun.default_allocator,
                    function,
                ) catch unreachable;
                return JSC.JSValue.jsUndefined();
            }
        }.appendGlobalFunctionCallback;
    }

    pub fn Bun__Jest__createTestPreloadObject(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        var global_hooks_object = JSC.JSValue.createEmptyObject(globalObject, 8);
        global_hooks_object.ensureStillAlive();

        const notSupportedHereFn = struct {
            pub fn notSupportedHere(
                globalThis: *JSC.JSGlobalObject,
                _: *JSC.CallFrame,
            ) callconv(.C) JSValue {
                globalThis.throw("This function can only be used in a test.", .{});
                return .zero;
            }
        }.notSupportedHere;
        const notSupportedHere = JSC.NewFunction(globalObject, null, 0, notSupportedHereFn, false);
        notSupportedHere.ensureStillAlive();

        inline for (.{
            "expect",
            "describe",
            "it",
            "test",
        }) |name| {
            global_hooks_object.put(globalObject, ZigString.static(name), notSupportedHere);
        }

        inline for (.{ "beforeAll", "beforeEach", "afterAll", "afterEach" }) |name| {
            const function = JSC.NewFunction(globalObject, null, 1, globalHook(name), false);
            function.ensureStillAlive();
            global_hooks_object.put(globalObject, ZigString.static(name), function);
        }
        return global_hooks_object;
    }

    pub fn Bun__Jest__createTestModuleObject(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const module = JSC.JSValue.createEmptyObject(globalObject, 7);

        const test_fn = JSC.NewFunction(globalObject, ZigString.static("test"), 2, TestScope.call, false);
        module.put(
            globalObject,
            ZigString.static("test"),
            test_fn,
        );
        test_fn.put(
            globalObject,
            ZigString.static("only"),
            JSC.NewFunction(globalObject, ZigString.static("only"), 2, TestScope.only, false),
        );
        test_fn.put(
            globalObject,
            ZigString.static("skip"),
            JSC.NewFunction(globalObject, ZigString.static("skip"), 2, TestScope.skip, false),
        );
        test_fn.put(
            globalObject,
            ZigString.static("todo"),
            JSC.NewFunction(globalObject, ZigString.static("todo"), 2, TestScope.todo, false),
        );
        test_fn.put(
            globalObject,
            ZigString.static("if"),
            JSC.NewFunction(globalObject, ZigString.static("if"), 2, TestScope.callIf, false),
        );
        test_fn.put(
            globalObject,
            ZigString.static("skipIf"),
            JSC.NewFunction(globalObject, ZigString.static("skipIf"), 2, TestScope.skipIf, false),
        );

        module.put(
            globalObject,
            ZigString.static("it"),
            test_fn,
        );
        const describe = JSC.NewFunction(globalObject, ZigString.static("describe"), 2, DescribeScope.call, false);
        describe.put(
            globalObject,
            ZigString.static("only"),
            JSC.NewFunction(globalObject, ZigString.static("only"), 2, DescribeScope.only, false),
        );
        describe.put(
            globalObject,
            ZigString.static("skip"),
            JSC.NewFunction(globalObject, ZigString.static("skip"), 2, DescribeScope.skip, false),
        );
        describe.put(
            globalObject,
            ZigString.static("todo"),
            JSC.NewFunction(globalObject, ZigString.static("todo"), 2, DescribeScope.todo, false),
        );
        describe.put(
            globalObject,
            ZigString.static("if"),
            JSC.NewFunction(globalObject, ZigString.static("if"), 2, DescribeScope.callIf, false),
        );
        describe.put(
            globalObject,
            ZigString.static("skipIf"),
            JSC.NewFunction(globalObject, ZigString.static("skipIf"), 2, DescribeScope.skipIf, false),
        );

        module.put(
            globalObject,
            ZigString.static("describe"),
            describe,
        );

        module.put(
            globalObject,
            ZigString.static("beforeAll"),
            JSC.NewRuntimeFunction(globalObject, ZigString.static("beforeAll"), 1, DescribeScope.beforeAll, false),
        );
        module.put(
            globalObject,
            ZigString.static("beforeEach"),
            JSC.NewRuntimeFunction(globalObject, ZigString.static("beforeEach"), 1, DescribeScope.beforeEach, false),
        );
        module.put(
            globalObject,
            ZigString.static("afterAll"),
            JSC.NewRuntimeFunction(globalObject, ZigString.static("afterAll"), 1, DescribeScope.afterAll, false),
        );
        module.put(
            globalObject,
            ZigString.static("afterEach"),
            JSC.NewRuntimeFunction(globalObject, ZigString.static("afterEach"), 1, DescribeScope.afterEach, false),
        );
        module.put(
            globalObject,
            ZigString.static("expect"),
            Expect.getConstructor(globalObject),
        );

        module.put(
            globalObject,
            ZigString.static("mock"),
            JSMockFunction__createObject(globalObject),
        );

        return module;
    }

    extern fn JSMockFunction__createObject(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn Bun__Jest__testPreloadObject(*JSC.JSGlobalObject) JSC.JSValue;
    extern fn Bun__Jest__testModuleObject(*JSC.JSGlobalObject) JSC.JSValue;

    pub fn call(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments_: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        JSC.markBinding(@src());
        var runner_ = runner orelse {
            JSError(getAllocator(ctx), "Run \"bun test\" to run a test", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        };
        const arguments = @ptrCast([]const JSC.JSValue, arguments_);

        if (arguments.len < 1 or !arguments[0].isString()) {
            JSError(getAllocator(ctx), "Bun.jest() expects a string filename", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }
        var str = arguments[0].toSlice(ctx, bun.default_allocator);
        defer str.deinit();
        var slice = str.slice();

        if (str.len == 0 or slice[0] != '/') {
            JSError(getAllocator(ctx), "Bun.jest() expects an absolute file path", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }
        var vm = ctx.bunVM();
        if (vm.is_in_preload) {
            return Bun__Jest__testPreloadObject(ctx).asObjectRef();
        }

        var filepath = Fs.FileSystem.instance.filename_store.append([]const u8, slice) catch unreachable;

        var scope = runner_.getOrPutFile(filepath);
        DescribeScope.active = scope;
        DescribeScope.module = scope;

        return Bun__Jest__testModuleObject(ctx).asObjectRef();
    }

    comptime {
        if (!JSC.is_bindgen) {
            @export(Bun__Jest__createTestModuleObject, .{ .name = "Bun__Jest__createTestModuleObject" });
            @export(Bun__Jest__createTestPreloadObject, .{ .name = "Bun__Jest__createTestPreloadObject" });
        }
    }
};

pub const ExpectAny = struct {
    pub usingnamespace JSC.Codegen.JSExpectAny;

    pub fn finalize(
        this: *ExpectAny,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len == 0) {
            globalObject.throw("any() expects to be passed a constructor function.", .{});
            return .zero;
        }

        const constructor = arguments[0];
        constructor.ensureStillAlive();
        if (!constructor.isConstructor()) {
            const fmt = "<d>expect.<r>any<d>(<r>constructor<d>)<r>\n\nExpected a constructor\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        var any = globalObject.bunVM().allocator.create(ExpectAny) catch unreachable;

        if (Jest.runner.?.pending_test == null) {
            const err = globalObject.createErrorInstance("expect.any() must be called in a test", .{});
            err.put(globalObject, ZigString.static("name"), ZigString.init("TestNotRunningError").toValueGC(globalObject));
            globalObject.throwValue(err);
            return .zero;
        }

        any.* = .{};
        const any_js_value = any.toJS(globalObject);
        any_js_value.ensureStillAlive();
        JSC.Jest.ExpectAny.constructorValueSetCached(any_js_value, globalObject, constructor);
        any_js_value.ensureStillAlive();

        var vm = globalObject.bunVM();
        vm.autoGarbageCollect();

        return any_js_value;
    }
};

/// https://jestjs.io/docs/expect
// To support async tests, we need to track the test ID
pub const Expect = struct {
    test_id: TestRunner.Test.ID,
    scope: *DescribeScope,
    op: Op.Set = Op.Set.init(.{}),

    pub usingnamespace JSC.Codegen.JSExpect;

    pub const Op = enum(u3) {
        resolves,
        rejects,
        not,
        pub const Set = std.EnumSet(Op);
    };

    pub fn getSnapshotName(this: *Expect, allocator: std.mem.Allocator, hint: string) ![]const u8 {
        const test_name = this.scope.tests.items[this.test_id].label;

        var length: usize = 0;
        var curr_scope: ?*DescribeScope = this.scope;
        while (curr_scope) |scope| {
            if (scope.label.len > 0) {
                length += scope.label.len + 1;
            }
            curr_scope = scope.parent;
        }
        length += test_name.len;
        if (hint.len > 0) {
            length += hint.len + 2;
        }

        var buf = try allocator.alloc(u8, length);

        var index = buf.len;
        if (hint.len > 0) {
            index -= hint.len;
            bun.copy(u8, buf[index..], hint);
            index -= test_name.len + 2;
            bun.copy(u8, buf[index..], test_name);
            bun.copy(u8, buf[index + test_name.len ..], ": ");
        } else {
            index -= test_name.len;
            bun.copy(u8, buf[index..], test_name);
        }
        // copy describe scopes in reverse order
        curr_scope = this.scope;
        while (curr_scope) |scope| {
            if (scope.label.len > 0) {
                index -= scope.label.len + 1;
                bun.copy(u8, buf[index..], scope.label);
                buf[index + scope.label.len] = ' ';
            }
            curr_scope = scope.parent;
        }

        return buf;
    }

    pub fn finalize(
        this: *Expect,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments_ = callframe.arguments(1);
        if (arguments_.len < 1) {
            globalObject.throw("expect() requires one argument", .{});
            return .zero;
        }
        const arguments = arguments_.ptr[0..arguments_.len];

        var expect = globalObject.bunVM().allocator.create(Expect) catch unreachable;
        const value = arguments[0];

        if (Jest.runner.?.pending_test == null) {
            const err = globalObject.createErrorInstance("expect() must be called in a test", .{});
            err.put(globalObject, ZigString.static("name"), ZigString.init("TestNotRunningError").toValueGC(globalObject));
            globalObject.throwValue(err);
            return .zero;
        }

        expect.* = .{
            .scope = Jest.runner.?.pending_test.?.describe,
            .test_id = Jest.runner.?.pending_test.?.test_id,
        };
        const expect_js_value = expect.toJS(globalObject);
        expect_js_value.ensureStillAlive();
        JSC.Jest.Expect.capturedValueSetCached(expect_js_value, globalObject, value);
        expect_js_value.ensureStillAlive();
        expect.postMatch(globalObject);
        return expect_js_value;
    }

    pub fn constructor(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*Expect {
        _ = callframe.arguments(1);
        globalObject.throw("expect() cannot be called with new", .{});
        return null;
    }

    /// Object.is()
    pub fn toBe(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBe() takes 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBe() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;
        const right = arguments[0];
        right.ensureStillAlive();
        const left = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        left.ensureStillAlive();

        const not = this.op.contains(.not);
        var pass = right.isSameValue(left, globalObject);
        if (comptime Environment.allow_assert) {
            std.debug.assert(pass == JSC.C.JSValueIsStrictEqual(globalObject, right.asObjectRef(), left.asObjectRef()));
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        if (not) {
            const signature = comptime getSignature("toBe", "<green>expected<r>", true);
            const fmt = signature ++ "\n\nExpected: not <green>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{right.toFmt(globalObject, &formatter)});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{right.toFmt(globalObject, &formatter)});
            return .zero;
        }

        const signature = comptime getSignature("toBe", "<green>expected<r>", false);
        if (left.deepEquals(right, globalObject) or left.strictDeepEquals(right, globalObject)) {
            const fmt = signature ++
                "\n\n<d>If this test should pass, replace \"toBe\" with \"toEqual\" or \"toStrictEqual\"<r>" ++
                "\n\nExpected: <green>{any}<r>\n" ++
                "Received: serializes to the same string\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{right.toFmt(globalObject, &formatter)});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{right.toFmt(globalObject, &formatter)});
            return .zero;
        }

        if (right.isString() and left.isString()) {
            const diff_format = DiffFormatter{
                .expected = right,
                .received = left,
                .globalObject = globalObject,
                .not = not,
            };
            const fmt = signature ++ "\n\n{any}\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{diff_format});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{diff_format});
            return .zero;
        }

        const fmt = signature ++ "\n\nExpected: <green>{any}<r>\nReceived: <red>{any}<r>\n";
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{
                right.toFmt(globalObject, &formatter),
                left.toFmt(globalObject, &formatter),
            });
            return .zero;
        }
        globalObject.throw(Output.prettyFmt(fmt, false), .{
            right.toFmt(globalObject, &formatter),
            left.toFmt(globalObject, &formatter),
        });
        return .zero;
    }

    pub fn getSignature(comptime matcher_name: string, comptime args: string, comptime not: bool) string {
        const received = "<d>expect(<r><red>received<r><d>).<r>";
        comptime if (not) {
            return received ++ "not<d>.<r>" ++ matcher_name ++ "<d>(<r>" ++ args ++ "<d>)<r>";
        };
        return received ++ matcher_name ++ "<d>(<r>" ++ args ++ "<d>)<r>";
    }

    pub fn toHaveLength(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toHaveLength() takes 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toHaveLength() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected: JSValue = arguments[0];
        const value: JSValue = JSC.Jest.Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (!value.isObject() and !value.isString()) {
            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
            globalObject.throw("Received value does not have a length property: {any}", .{value.toFmt(globalObject, &fmt)});
            return .zero;
        }

        if (!expected.isNumber()) {
            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
            globalObject.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalObject, &fmt)});
            return .zero;
        }

        const expected_length: f64 = expected.asNumber();
        if (@round(expected_length) != expected_length or std.math.isInf(expected_length) or std.math.isNan(expected_length) or expected_length < 0) {
            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
            globalObject.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalObject, &fmt)});
            return .zero;
        }

        const not = this.op.contains(.not);
        var pass = false;

        const actual_length = value.getLengthIfPropertyExistsInternal(globalObject);

        if (actual_length == std.math.inf(f64)) {
            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
            globalObject.throw("Received value does not have a length property: {any}", .{value.toFmt(globalObject, &fmt)});
            return .zero;
        } else if (std.math.isNan(actual_length)) {
            globalObject.throw("Received value has non-number length property: {}", .{actual_length});
            return .zero;
        }

        if (actual_length == expected_length) {
            pass = true;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        if (not) {
            const expected_line = "Expected length: not <green>{d}<r>\n";
            const fmt = comptime getSignature("toHaveLength", "<green>expected<r>", true) ++ "\n\n" ++ expected_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{expected_length});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{expected_length});
            return .zero;
        }

        const expected_line = "Expected length: <green>{d}<r>\n";
        const received_line = "Received length: <red>{d}<r>\n";
        const fmt = comptime getSignature("toHaveLength", "<green>expected<r>", false) ++ "\n\n" ++
            expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_length, actual_length });
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_length, actual_length });
        return .zero;
    }

    pub fn toContain(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContain() takes 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toContain() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = JSC.Jest.Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        const not = this.op.contains(.not);
        var pass = false;

        if (value.isIterable(globalObject)) {
            var itr = value.arrayIterator(globalObject);
            while (itr.next()) |item| {
                if (item.isSameValue(expected, globalObject)) {
                    pass = true;
                    break;
                }
            }
        } else if (value.isString() and expected.isString()) {
            const value_string = value.toString(globalObject).toSlice(globalObject, default_allocator).slice();
            const expected_string = expected.toString(globalObject).toSlice(globalObject, default_allocator).slice();
            if (strings.contains(value_string, expected_string)) {
                pass = true;
            } else if (value_string.len == 0 and expected_string.len == 0) { // edge case two empty strings are true
                pass = true;
            }
        } else {
            globalObject.throw("Received value must be an array type, or both received and expected values must be strings.", .{});
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = expected.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected to contain: not <green>{any}<r>\n";
            const fmt = comptime getSignature("toContain", "<green>expected<r>", true) ++ "\n\n" ++ expected_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{expected_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{expected_fmt});
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toContain", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeTruthy(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeTruthy() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = false;

        const truthy = value.toBooleanSlow(globalObject);
        if (truthy) pass = true;

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeTruthy", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeTruthy", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeUndefined(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = false;
        if (value.isUndefined()) pass = true;

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeUndefined", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeUndefined", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeNaN(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = false;
        if (value.isNumber()) {
            const number = value.asNumber();
            if (number != number) pass = true;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeNaN", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeNaN", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeNull(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = value.isNull();
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeNull", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeNull", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeDefined(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = !value.isUndefined();
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeDefined", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeDefined", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeFalsy(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();

        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeFalsy() must be called in a test", .{});
            return .zero;
        }
        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = false;

        const truthy = value.toBooleanSlow(globalObject);
        if (!truthy) pass = true;

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeFalsy", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeFalsy", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toEqual() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toEqual() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected = arguments[0];
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        const not = this.op.contains(.not);
        var pass = value.deepEquals(expected, globalObject);

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        const diff_formatter = DiffFormatter{ .received = value, .expected = expected, .globalObject = globalObject, .not = not };

        if (not) {
            const signature = comptime getSignature("toEqual", "<green>expected<r>", true);
            const fmt = signature ++ "\n\n{any}\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{diff_formatter});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{diff_formatter});
            return .zero;
        }

        const signature = comptime getSignature("toEqual", "<green>expected<r>", false);
        const fmt = signature ++ "\n\n{any}\n";
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{diff_formatter});
            return .zero;
        }
        globalObject.throw(Output.prettyFmt(fmt, false), .{diff_formatter});
        return .zero;
    }

    pub fn toStrictEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toStrictEqual() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toStrictEqual() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected = arguments[0];
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        const not = this.op.contains(.not);
        var pass = value.strictDeepEquals(expected, globalObject);

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        const diff_formatter = DiffFormatter{ .received = value, .expected = expected, .globalObject = globalObject, .not = not };

        if (not) {
            const signature = comptime getSignature("toStrictEqual", "<green>expected<r>", true);
            const fmt = signature ++ "\n\n{any}\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{diff_formatter});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{diff_formatter});
            return .zero;
        }

        const signature = comptime getSignature("toStrictEqual", "<green>expected<r>", false);
        const fmt = signature ++ "\n\n{any}\n";
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{diff_formatter});
            return .zero;
        }
        globalObject.throw(Output.prettyFmt(fmt, false), .{diff_formatter});
        return .zero;
    }

    pub fn toHaveProperty(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(2);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toHaveProperty() requires at least 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toHaveProperty must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected_property_path = arguments[0];
        expected_property_path.ensureStillAlive();
        const expected_property: ?JSValue = if (arguments.len > 1) arguments[1] else null;
        if (expected_property) |ev| ev.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (!expected_property_path.isString() and !expected_property_path.isIterable(globalObject)) {
            globalObject.throw("Expected path must be a string or an array", .{});
            return .zero;
        }

        const not = this.op.contains(.not);
        var path_string = ZigString.Empty;
        expected_property_path.toZigString(&path_string, globalObject);

        var pass = !value.isUndefinedOrNull();
        var received_property: JSValue = .zero;

        if (pass) {
            received_property = value.getIfPropertyExistsFromPath(globalObject, expected_property_path);
            pass = !received_property.isEmpty();
        }

        if (pass and expected_property != null) {
            pass = received_property.deepEquals(expected_property.?, globalObject);
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        if (not) {
            if (expected_property != null) {
                const signature = comptime getSignature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", true);
                if (!received_property.isEmpty()) {
                    const fmt = signature ++ "\n\nExpected path: <green>{any}<r>\n\nExpected value: not <green>{any}<r>\n";
                    if (Output.enable_ansi_colors) {
                        globalObject.throw(Output.prettyFmt(fmt, true), .{
                            expected_property_path.toFmt(globalObject, &formatter),
                            expected_property.?.toFmt(globalObject, &formatter),
                        });
                        return .zero;
                    }
                    globalObject.throw(Output.prettyFmt(fmt, true), .{
                        expected_property_path.toFmt(globalObject, &formatter),
                        expected_property.?.toFmt(globalObject, &formatter),
                    });
                    return .zero;
                }
            }

            const signature = comptime getSignature("toHaveProperty", "<green>path<r>", true);
            const fmt = signature ++ "\n\nExpected path: not <green>{any}<r>\n\nReceived value: <red>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{
                    expected_property_path.toFmt(globalObject, &formatter),
                    received_property.toFmt(globalObject, &formatter),
                });
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{
                expected_property_path.toFmt(globalObject, &formatter),
                received_property.toFmt(globalObject, &formatter),
            });
            return .zero;
        }

        if (expected_property != null) {
            const signature = comptime getSignature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", false);
            if (!received_property.isEmpty()) {
                // deep equal case
                const fmt = signature ++ "\n\n{any}\n";
                const diff_format = DiffFormatter{
                    .received = received_property,
                    .expected = expected_property.?,
                    .globalObject = globalObject,
                };

                if (Output.enable_ansi_colors) {
                    globalObject.throw(Output.prettyFmt(fmt, true), .{diff_format});
                    return .zero;
                }
                globalObject.throw(Output.prettyFmt(fmt, false), .{diff_format});
                return .zero;
            }

            const fmt = signature ++ "\n\nExpected path: <green>{any}<r>\n\nExpected value: <green>{any}<r>\n\n" ++
                "Unable to find property\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{
                    expected_property_path.toFmt(globalObject, &formatter),
                    expected_property.?.toFmt(globalObject, &formatter),
                });
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{
                expected_property_path.toFmt(globalObject, &formatter),
                expected_property.?.toFmt(globalObject, &formatter),
            });
            return .zero;
        }

        const signature = comptime getSignature("toHaveProperty", "<green>path<r>", false);
        const fmt = signature ++ "\n\nExpected path: <green>{any}<r>\n\nUnable to find property\n";
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{expected_property_path.toFmt(globalObject, &formatter)});
            return .zero;
        }
        globalObject.throw(Output.prettyFmt(fmt, false), .{expected_property_path.toFmt(globalObject, &formatter)});
        return .zero;
    }

    pub fn toBeEven(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();

        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeEven() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = false;

        if (value.isAnyInt()) {
            const _value = value.toInt64();
            pass = @mod(_value, 2) == 0;
            if (_value == -0) { // negative zero is even
                pass = true;
            }
        } else if (value.isBigInt() or value.isBigInt32()) {
            const _value = value.toInt64();
            pass = switch (_value == -0) { // negative zero is even
                true => true,
                else => _value & 1 == 0,
            };
        } else if (value.isNumber()) {
            const _value = JSValue.asNumber(value);
            if (@mod(_value, 1) == 0 and @mod(_value, 2) == 0) { // if the fraction is all zeros and even
                pass = true;
            } else {
                pass = false;
            }
        } else {
            pass = false;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeEven", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeEven", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeGreaterThan(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeGreaterThan() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeGreaterThan() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.op.contains(.not);
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() > other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .greater_than => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .less_than => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = other_value.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected: not \\> <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeGreaterThan", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\> <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeGreaterThan", "<green>expected<r>", false) ++ "\n\n" ++
            expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(comptime Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeGreaterThanOrEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeGreaterThanOrEqual() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeGreaterThanOrEqual() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.op.contains(.not);
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() >= other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .greater_than, .equal => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .less_than, .equal => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = other_value.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected: not \\>= <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeGreaterThanOrEqual", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\>= <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeGreaterThanOrEqual", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(comptime Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }
        return .zero;
    }

    pub fn toBeLessThan(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeLessThan() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeLessThan() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.op.contains(.not);
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() < other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .less_than => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .greater_than => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = other_value.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected: not \\< <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeLessThan", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\< <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeLessThan", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(comptime Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }
        return .zero;
    }

    pub fn toBeLessThanOrEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeLessThanOrEqual() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeLessThanOrEqual() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.op.contains(.not);
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() <= other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .less_than, .equal => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .greater_than, .equal => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = other_value.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected: not \\<= <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeLessThanOrEqual", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\<= <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeLessThanOrEqual", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(comptime Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }
        return .zero;
    }

    pub fn toBeCloseTo(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const thisArguments = callFrame.arguments(2);
        const arguments = thisArguments.ptr[0..thisArguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeCloseTo() requires at least 1 argument. Expected value must be a number", .{});
            return .zero;
        }

        const expected_ = arguments[0];
        if (!expected_.isNumber()) {
            globalObject.throwInvalidArgumentType("toBeCloseTo", "expected", "number");
            return .zero;
        }

        var precision: f64 = 2.0;
        if (arguments.len > 1) {
            const precision_ = arguments[1];
            if (!precision_.isNumber()) {
                globalObject.throwInvalidArgumentType("toBeCloseTo", "precision", "number");
                return .zero;
            }

            precision = precision_.asNumber();
        }

        const received_: JSC.JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };

        if (!received_.isNumber()) {
            globalObject.throwInvalidArgumentType("expect", "received", "number");
            return .zero;
        }

        var expected = expected_.asNumber();
        var received = received_.asNumber();

        if (std.math.isNegativeInf(expected)) {
            expected = -expected;
        }

        if (std.math.isNegativeInf(received)) {
            received = -received;
        }

        if (std.math.isPositiveInf(expected) and std.math.isPositiveInf(received)) {
            return thisValue;
        }

        const expected_diff = std.math.pow(f64, 10, -precision) / 2;
        const actual_diff = std.math.fabs(received - expected);
        var pass = actual_diff < expected_diff;

        const not = this.op.contains(.not);
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

        const expected_fmt = expected_.toFmt(globalObject, &formatter);
        const received_fmt = received_.toFmt(globalObject, &formatter);

        const expected_line = "Expected: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const expected_precision = "Expected precision: {d}\n";
        const expected_difference = "Expected difference: \\< <green>{d}<r>\n";
        const received_difference = "Received difference: <red>{d}<r>\n";

        const suffix_fmt = "\n\n" ++ expected_line ++ received_line ++ "\n" ++ expected_precision ++ expected_difference ++ received_difference;

        if (not) {
            const fmt = comptime getSignature("toBeCloseTo", "<green>expected<r>, precision", true) ++ suffix_fmt;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
            return .zero;
        }

        const fmt = comptime getSignature("toBeCloseTo", "<green>expected<r>, precision", false) ++ suffix_fmt;

        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
        return .zero;
    }

    pub fn toBeOdd(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();

        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeOdd() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = false;

        if (value.isBigInt32()) {
            pass = value.toInt32() & 1 == 1;
        } else if (value.isBigInt()) {
            pass = value.toInt64() & 1 == 1;
        } else if (value.isInt32()) {
            const _value = value.toInt32();
            pass = @mod(_value, 2) == 1;
        } else if (value.isAnyInt()) {
            const _value = value.toInt64();
            pass = @mod(_value, 2) == 1;
        } else if (value.isNumber()) {
            const _value = JSValue.asNumber(value);
            if (@mod(_value, 1) == 0 and @mod(_value, 2) == 1) { // if the fraction is all zeros and odd
                pass = true;
            } else {
                pass = false;
            }
        } else {
            pass = false;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeOdd", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeOdd", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toThrow(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toThrow() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected_value: JSValue = if (arguments.len > 0) brk: {
            const value = arguments[0];
            if (value.isEmptyOrUndefinedOrNull() or !value.isObject() and !value.isString()) {
                var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
                globalObject.throw("Expected value must be string or Error: {any}", .{value.toFmt(globalObject, &fmt)});
                return .zero;
            }
            break :brk value;
        } else .zero;
        expected_value.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (!value.jsType().isFunction()) {
            globalObject.throw("Expected value must be a function", .{});
            return .zero;
        }

        const not = this.op.contains(.not);

        const result_: ?JSValue = brk: {
            var vm = globalObject.bunVM();
            var return_value: JSValue = .zero;
            var scope = vm.unhandledRejectionScope();
            var prev_unhandled_pending_rejection_to_capture = vm.unhandled_pending_rejection_to_capture;
            vm.unhandled_pending_rejection_to_capture = &return_value;
            vm.onUnhandledRejection = &VirtualMachine.onQuietUnhandledRejectionHandlerCaptureValue;
            const return_value_from_fucntion: JSValue = value.call(globalObject, &.{});
            vm.unhandled_pending_rejection_to_capture = prev_unhandled_pending_rejection_to_capture;

            if (return_value == .zero) {
                return_value = return_value_from_fucntion;
            }

            if (return_value.asAnyPromise()) |promise| {
                globalObject.bunVM().waitForPromise(promise);
                scope.apply(vm);
                const promise_result = promise.result(globalObject.vm());

                switch (promise.status(globalObject.vm())) {
                    .Fulfilled => {
                        break :brk null;
                    },
                    .Rejected => {
                        // since we know for sure it rejected, we should always return the error
                        break :brk promise_result.toError() orelse promise_result;
                    },
                    .Pending => unreachable,
                }
            }
            scope.apply(vm);

            break :brk return_value.toError();
        };

        const did_throw = result_ != null;

        if (not) {
            const signature = comptime getSignature("toThrow", "<green>expected<r>", true);

            if (!did_throw) return thisValue;

            const result: JSValue = result_.?;
            var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

            if (expected_value.isEmpty()) {
                const signature_no_args = comptime getSignature("toThrow", "", true);
                if (result.toError()) |err| {
                    const name = err.get(globalObject, "name") orelse JSValue.undefined;
                    const message = err.get(globalObject, "message") orelse JSValue.undefined;
                    const fmt = signature_no_args ++ "\n\nError name: <red>{any}<r>\nError message: <red>{any}<r>\n";
                    globalObject.throwPretty(fmt, .{
                        name.toFmt(globalObject, &formatter),
                        message.toFmt(globalObject, &formatter),
                    });
                    return .zero;
                }

                // non error thrown
                const fmt = signature_no_args ++ "\n\nThrown value: <red>{any}<r>\n";
                globalObject.throwPretty(fmt, .{result.toFmt(globalObject, &formatter)});
                return .zero;
            }

            if (expected_value.isString()) {
                const received_message = result.getIfPropertyExistsImpl(globalObject, "message", 7);

                // TODO: remove this allocation
                // partial match
                {
                    const expected_slice = expected_value.toSliceOrNull(globalObject) orelse return .zero;
                    defer expected_slice.deinit();
                    const received_slice = received_message.toSliceOrNull(globalObject) orelse return .zero;
                    defer received_slice.deinit();
                    if (!strings.contains(received_slice.slice(), expected_slice.slice())) return thisValue;
                }

                const fmt = signature ++ "\n\nExpected substring: not <green>{any}<r>\nReceived message: <red>{any}<r>\n";
                globalObject.throwPretty(fmt, .{
                    expected_value.toFmt(globalObject, &formatter),
                    received_message.toFmt(globalObject, &formatter),
                });
                return .zero;
            }

            if (expected_value.isRegExp()) {
                const received_message = result.getIfPropertyExistsImpl(globalObject, "message", 7);

                // TODO: REMOVE THIS GETTER! Expose a binding to call .test on the RegExp object directly.
                if (expected_value.get(globalObject, "test")) |test_fn| {
                    const matches = test_fn.callWithThis(globalObject, expected_value, &.{received_message});
                    if (!matches.toBooleanSlow(globalObject)) return thisValue;
                }

                const fmt = signature ++ "\n\nExpected pattern: not <green>{any}<r>\nReceived message: <red>{any}<r>\n";
                globalObject.throwPretty(fmt, .{
                    expected_value.toFmt(globalObject, &formatter),
                    received_message.toFmt(globalObject, &formatter),
                });
                return .zero;
            }

            if (expected_value.get(globalObject, "message")) |expected_message| {
                const received_message = result.getIfPropertyExistsImpl(globalObject, "message", 7);
                // no partial match for this case
                if (!expected_message.isSameValue(received_message, globalObject)) return thisValue;

                const fmt = signature ++ "\n\nExpected message: not <green>{any}<r>\n";
                globalObject.throwPretty(fmt, .{expected_message.toFmt(globalObject, &formatter)});
                return .zero;
            }

            if (!result.isInstanceOf(globalObject, expected_value)) return thisValue;

            var expected_class = ZigString.Empty;
            expected_value.getClassName(globalObject, &expected_class);
            const received_message = result.getIfPropertyExistsImpl(globalObject, "message", 7);
            const fmt = signature ++ "\n\nExpected constructor: not <green>{s}<r>\n\nReceived message: <red>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_class, received_message.toFmt(globalObject, &formatter) });
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_class, received_message.toFmt(globalObject, &formatter) });
            return .zero;
        }

        const signature = comptime getSignature("toThrow", "<green>expected<r>", false);
        if (did_throw) {
            if (expected_value.isEmpty()) return thisValue;

            const result: JSValue = if (result_.?.toError()) |r|
                r
            else
                result_.?;

            const _received_message: ?JSValue = if (result.isObject())
                result.get(globalObject, "message")
            else if (result.toStringOrNull(globalObject)) |js_str|
                JSC.JSValue.fromCell(js_str)
            else
                null;

            if (expected_value.isString()) {
                if (_received_message) |received_message| {
                    // TODO: remove this allocation
                    // partial match
                    const expected_slice = expected_value.toSliceOrNull(globalObject) orelse return .zero;
                    defer expected_slice.deinit();
                    const received_slice = received_message.toSlice(globalObject, globalObject.allocator());
                    defer received_slice.deinit();
                    if (strings.contains(received_slice.slice(), expected_slice.slice())) return thisValue;
                }

                // error: message from received error does not match expected string
                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

                if (_received_message) |received_message| {
                    const expected_value_fmt = expected_value.toFmt(globalObject, &formatter);
                    const received_message_fmt = received_message.toFmt(globalObject, &formatter);
                    const fmt = signature ++ "\n\n" ++ "Expected substring: <green>{any}<r>\nReceived message: <red>{any}<r>\n";
                    globalObject.throwPretty(fmt, .{ expected_value_fmt, received_message_fmt });
                    return .zero;
                }

                const expected_fmt = expected_value.toFmt(globalObject, &formatter);
                const received_fmt = result.toFmt(globalObject, &formatter);
                const fmt = signature ++ "\n\n" ++ "Expected substring: <green>{any}<r>\nReceived value: <red>{any}<r>";
                globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });

                return .zero;
            }

            if (expected_value.isRegExp()) {
                if (_received_message) |received_message| {
                    // TODO: REMOVE THIS GETTER! Expose a binding to call .test on the RegExp object directly.
                    if (expected_value.get(globalObject, "test")) |test_fn| {
                        const matches = test_fn.callWithThis(globalObject, expected_value, &.{received_message});
                        if (matches.toBooleanSlow(globalObject)) return thisValue;
                    }
                }

                // error: message from received error does not match expected pattern
                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

                if (_received_message) |received_message| {
                    const expected_value_fmt = expected_value.toFmt(globalObject, &formatter);
                    const received_message_fmt = received_message.toFmt(globalObject, &formatter);
                    const fmt = signature ++ "\n\n" ++ "Expected pattern: <green>{any}<r>\nReceived message: <red>{any}<r>\n";
                    globalObject.throwPretty(fmt, .{ expected_value_fmt, received_message_fmt });

                    return .zero;
                }

                const expected_fmt = expected_value.toFmt(globalObject, &formatter);
                const received_fmt = result.toFmt(globalObject, &formatter);
                const fmt = signature ++ "\n\n" ++ "Expected pattern: <green>{any}<r>\nReceived value: <red>{any}<r>";
                globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });
                return .zero;
            }

            // If it's not an object, we are going to crash here.
            std.debug.assert(expected_value.isObject());

            if (expected_value.get(globalObject, "message")) |expected_message| {
                if (_received_message) |received_message| {
                    if (received_message.isSameValue(expected_message, globalObject)) return thisValue;
                }

                // error: message from received error does not match expected error message.
                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

                if (_received_message) |received_message| {
                    const expected_fmt = expected_message.toFmt(globalObject, &formatter);
                    const received_fmt = received_message.toFmt(globalObject, &formatter);
                    const fmt = signature ++ "\n\nExpected message: <green>{any}<r>\nReceived message: <red>{any}<r>\n";
                    globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });
                    return .zero;
                }

                const expected_fmt = expected_message.toFmt(globalObject, &formatter);
                const received_fmt = result.toFmt(globalObject, &formatter);
                const fmt = signature ++ "\n\nExpected message: <green>{any}<r>\nReceived value: <red>{any}<r>\n";
                globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });
                return .zero;
            }

            if (result.isInstanceOf(globalObject, expected_value)) return thisValue;

            // error: received error not instance of received error constructor
            var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
            var expected_class = ZigString.Empty;
            var received_class = ZigString.Empty;
            expected_value.getClassName(globalObject, &expected_class);
            result.getClassName(globalObject, &received_class);
            const fmt = signature ++ "\n\nExpected constructor: <green>{s}<r>\nReceived constructor: <red>{s}<r>\n\n";

            if (_received_message) |received_message| {
                const message_fmt = fmt ++ "Received message: <red>{any}<r>\n";
                const received_message_fmt = received_message.toFmt(globalObject, &formatter);

                globalObject.throwPretty(message_fmt, .{
                    expected_class,
                    received_class,
                    received_message_fmt,
                });
                return .zero;
            }

            const received_fmt = result.toFmt(globalObject, &formatter);
            const value_fmt = fmt ++ "Received value: <red>{any}<r>\n";

            globalObject.throwPretty(value_fmt, .{
                expected_class,
                received_class,
                received_fmt,
            });
            return .zero;
        }

        // did not throw
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const received_line = "Received function did not throw\n";

        if (expected_value.isEmpty()) {
            const fmt = comptime getSignature("toThrow", "", false) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{});
            return .zero;
        }

        if (expected_value.isString()) {
            const expected_fmt = "\n\nExpected substring: <green>{any}<r>\n\n" ++ received_line;
            const fmt = signature ++ expected_fmt;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{expected_value.toFmt(globalObject, &formatter)});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{expected_value.toFmt(globalObject, &formatter)});
            return .zero;
        }

        if (expected_value.isRegExp()) {
            const expected_fmt = "\n\nExpected pattern: <green>{any}<r>\n\n" ++ received_line;
            const fmt = signature ++ expected_fmt;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{expected_value.toFmt(globalObject, &formatter)});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{expected_value.toFmt(globalObject, &formatter)});
            return .zero;
        }

        if (expected_value.get(globalObject, "message")) |expected_message| {
            const expected_fmt = "\n\nExpected message: <green>{any}<r>\n\n" ++ received_line;
            const fmt = signature ++ expected_fmt;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{expected_message.toFmt(globalObject, &formatter)});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{expected_message.toFmt(globalObject, &formatter)});
            return .zero;
        }

        const expected_fmt = "\n\nExpected constructor: <green>{s}<r>\n\n" ++ received_line;
        var expected_class = ZigString.Empty;
        expected_value.getClassName(globalObject, &expected_class);
        const fmt = signature ++ expected_fmt;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{expected_class});
            return .zero;
        }
        globalObject.throw(Output.prettyFmt(fmt, true), .{expected_class});
        return .zero;
    }

    pub fn toMatchSnapshot(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(2);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toMatchSnapshot() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        if (not) {
            const signature = comptime getSignature("toMatchSnapshot", "", true);
            const fmt = signature ++ "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n";
            globalObject.throwPretty(fmt, .{});
        }

        var hint_string: ZigString = ZigString.Empty;
        var property_matchers: ?JSValue = null;
        switch (arguments.len) {
            0 => {},
            1 => {
                if (arguments[0].isString()) {
                    arguments[0].toZigString(&hint_string, globalObject);
                } else if (arguments[0].isObject()) {
                    property_matchers = arguments[0];
                }
            },
            else => {
                if (!arguments[0].isObject()) {
                    const signature = comptime getSignature("toMatchSnapshot", "<green>properties<r><d>, <r>hint", false);
                    const fmt = signature ++ "\n\nMatcher error: Expected <green>properties<r> must be an object\n";
                    globalObject.throwPretty(fmt, .{});
                    return .zero;
                }

                property_matchers = arguments[0];

                if (arguments[1].isString()) {
                    arguments[1].toZigString(&hint_string, globalObject);
                }
            },
        }

        var hint = hint_string.toSlice(default_allocator);
        defer hint.deinit();

        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };

        if (!value.isObject() and property_matchers != null) {
            const signature = comptime getSignature("toMatchSnapshot", "<green>properties<r><d>, <r>hint", false);
            const fmt = signature ++ "\n\n<b>Matcher error: <red>received<r> values must be an object when the matcher has <green>properties<r>\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        if (property_matchers) |_prop_matchers| {
            var prop_matchers = _prop_matchers;

            var itr = PropertyMatcherIterator{
                .received_object = value,
                .failed = false,
            };

            prop_matchers.forEachProperty(globalObject, &itr, PropertyMatcherIterator.forEach);

            if (itr.failed) {
                // TODO: print diff with properties from propertyMatchers
                const signature = comptime getSignature("toMatchSnapshot", "<green>propertyMatchers<r>", false);
                const fmt = signature ++ "\n\nExpected <green>propertyMatchers<r> to match properties from received object" ++
                    "\n\nReceived: {any}\n";

                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
                globalObject.throwPretty(fmt, .{value.toFmt(globalObject, &formatter)});
                return .zero;
            }
        }

        const result = Jest.runner.?.snapshots.getOrPut(this, value, hint.slice(), globalObject) catch |err| {
            var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
            const test_file_path = Jest.runner.?.files.get(this.scope.file_id).source.path.text;
            switch (err) {
                error.FailedToOpenSnapshotFile => globalObject.throw("Failed to open snapshot file for test file: {s}", .{test_file_path}),
                error.FailedToMakeSnapshotDirectory => globalObject.throw("Failed to make snapshot directory for test file: {s}", .{test_file_path}),
                error.FailedToWriteSnapshotFile => globalObject.throw("Failed write to snapshot file: {s}", .{test_file_path}),
                error.ParseError => globalObject.throw("Failed to parse snapshot file for: {s}", .{test_file_path}),
                else => globalObject.throw("Failed to snapshot value: {any}", .{value.toFmt(globalObject, &formatter)}),
            }
            return .zero;
        };

        if (result) |saved_value| {
            var pretty_value: MutableString = MutableString.init(default_allocator, 0) catch unreachable;
            value.jestSnapshotPrettyFormat(&pretty_value, globalObject) catch {
                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
                globalObject.throw("Failed to pretty format value: {s}", .{value.toFmt(globalObject, &formatter)});
                return .zero;
            };
            defer pretty_value.deinit();

            if (strings.eqlLong(pretty_value.toOwnedSliceLeaky(), saved_value, true)) {
                Jest.runner.?.snapshots.passed += 1;
                return thisValue;
            }

            Jest.runner.?.snapshots.failed += 1;
            const signature = comptime getSignature("toMatchSnapshot", "<green>expected<r>", false);
            const fmt = signature ++ "\n\n{any}\n";
            const diff_format = DiffFormatter{
                .received_string = pretty_value.toOwnedSliceLeaky(),
                .expected_string = saved_value,
                .globalObject = globalObject,
            };

            globalObject.throwPretty(fmt, .{diff_format});
            return .zero;
        }

        return thisValue;
    }

    pub fn toBeEmpty(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeEmpty() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        var pass = false;
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

        const actual_length = value.getLengthIfPropertyExistsInternal(globalObject);

        if (actual_length == std.math.inf(f64)) {
            if (value.jsTypeLoose().isObject()) {
                if (value.isIterable(globalObject)) {
                    var any_properties_in_iterator = false;
                    value.forEach(globalObject, &any_properties_in_iterator, struct {
                        pub fn anythingInIterator(
                            _: *JSC.VM,
                            _: *JSGlobalObject,
                            any_: ?*anyopaque,
                            _: JSValue,
                        ) callconv(.C) void {
                            bun.cast(*bool, any_.?).* = true;
                        }
                    }.anythingInIterator);
                    pass = !any_properties_in_iterator;
                } else {
                    var props_iter = JSC.JSPropertyIterator(.{
                        .skip_empty_name = false,

                        .include_value = true,
                    }).init(globalObject, value.asObjectRef());
                    defer props_iter.deinit();
                    pass = props_iter.len == 0;
                }
            } else {
                const signature = comptime getSignature("toBeEmpty", "", false);
                const fmt = signature ++ "\n\nExpected value to be a string, object, or iterable" ++
                    "\n\nReceived: <red>{any}<r>\n";
                globalObject.throwPretty(fmt, .{value.toFmt(globalObject, &formatter)});
                return .zero;
            }
        } else if (std.math.isNan(actual_length)) {
            globalObject.throw("Received value has non-number length property: {}", .{actual_length});
            return .zero;
        } else {
            pass = actual_length == 0;
        }

        if (not and pass) {
            const signature = comptime getSignature("toBeEmpty", "", true);
            const fmt = signature ++ "\n\nExpected value <b>not<r> to be a string, object, or iterable" ++
                "\n\nReceived: <red>{any}<r>\n";
            globalObject.throwPretty(fmt, .{value.toFmt(globalObject, &formatter)});
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        if (not) {
            const signature = comptime getSignature("toBeEmpty", "", true);
            const fmt = signature ++ "\n\nExpected value <b>not<r> to be empty" ++
                "\n\nReceived: <red>{any}<r>\n";
            globalObject.throwPretty(fmt, .{value.toFmt(globalObject, &formatter)});
            return .zero;
        }

        const signature = comptime getSignature("toBeEmpty", "", false);
        const fmt = signature ++ "\n\nExpected value to be empty" ++
            "\n\nReceived: <red>{any}<r>\n";
        globalObject.throwPretty(fmt, .{value.toFmt(globalObject, &formatter)});
        return .zero;
    }

    pub fn toBeNil(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeNil() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        const pass = value.isUndefinedOrNull() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeNil", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeNil", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeBoolean(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeBoolean() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        const pass = value.isBoolean() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeBoolean", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeBoolean", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeTrue(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeTrue() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        const pass = (value.isBoolean() and value.toBoolean()) != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeTrue", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeTrue", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeFalse(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeFalse() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        const pass = (value.isBoolean() and !value.toBoolean()) != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeFalse", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeFalse", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeNumber(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeNumber() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        const pass = value.isNumber() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeNumber", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeNumber", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeInteger(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeInteger() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        const pass = value.isAnyInt() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeInteger", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeInteger", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeFinite(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeFinite() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        var pass = value.isNumber();
        if (pass) {
            const num: f64 = value.asNumber();
            pass = std.math.isFinite(num) and !std.math.isNan(num);
        }

        const not = this.op.contains(.not);
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeFinite", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeFinite", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBePositive(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBePositive() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        var pass = value.isNumber();
        if (pass) {
            const num: f64 = value.asNumber();
            pass = @round(num) > 0 and !std.math.isInf(num) and !std.math.isNan(num);
        }

        const not = this.op.contains(.not);
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBePositive", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBePositive", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeNegative(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeNegative() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        var pass = value.isNumber();
        if (pass) {
            const num: f64 = value.asNumber();
            pass = @round(num) < 0 and !std.math.isInf(num) and !std.math.isNan(num);
        }

        const not = this.op.contains(.not);
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeNegative", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeNegative", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeWithin(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(2);
        const arguments = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBeWithin() requires 2 arguments", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeWithin() must be called in a test", .{});
            return .zero;
        }

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        const startValue = arguments[0];
        startValue.ensureStillAlive();

        if (!startValue.isNumber()) {
            globalThis.throw("toBeWithin() requires the first argument to be a number", .{});
            return .zero;
        }

        const endValue = arguments[1];
        endValue.ensureStillAlive();

        if (!endValue.isNumber()) {
            globalThis.throw("toBeWithin() requires the second argument to be a number", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        var pass = value.isNumber();
        if (pass) {
            const num = value.asNumber();
            pass = num >= startValue.asNumber() and num < endValue.asNumber();
        }

        const not = this.op.contains(.not);
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const start_fmt = startValue.toFmt(globalThis, &formatter);
        const end_fmt = endValue.toFmt(globalThis, &formatter);
        const received_fmt = value.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected: not between <green>{any}<r> <d>(inclusive)<r> and <green>{any}<r> <d>(exclusive)<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeWithin", "<green>start<r><d>, <r><green>end<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            globalThis.throwPretty(fmt, .{ start_fmt, end_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected: between <green>{any}<r> <d>(inclusive)<r> and <green>{any}<r> <d>(exclusive)<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeWithin", "<green>start<r><d>, <r><green>end<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalThis.throwPretty(fmt, .{ start_fmt, end_fmt, received_fmt });
        return .zero;
    }

    pub fn toBeSymbol(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeSymbol() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        const pass = value.isSymbol() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeSymbol", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeSymbol", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeFunction(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeFunction() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        const pass = value.isCallable(globalThis.vm()) != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeFunction", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeFunction", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeDate(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeDate() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        const pass = value.isDate() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeDate", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeDate", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeString(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeString() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.op.contains(.not);
        const pass = value.isString() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeString", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeString", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toInclude(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toInclude() requires 1 argument", .{});
            return .zero;
        }

        const expected = arguments[0];
        expected.ensureStillAlive();

        if (!expected.isString()) {
            globalThis.throw("toInclude() requires the first argument to be a string", .{});
            return .zero;
        }

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toInclude() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        var pass = value.isString();
        if (pass) {
            const value_string = value.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            const expected_string = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            pass = strings.contains(value_string, expected_string) or expected_string.len == 0;
        }

        const not = this.op.contains(.not);
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected to not include: <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toInclude", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected to include: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toInclude", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toStartWith(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toStartWith() requires 1 argument", .{});
            return .zero;
        }

        const expected = arguments[0];
        expected.ensureStillAlive();

        if (!expected.isString()) {
            globalThis.throw("toStartWith() requires the first argument to be a string", .{});
            return .zero;
        }

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toStartWith() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        var pass = value.isString();
        if (pass) {
            const value_string = value.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            const expected_string = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            pass = strings.startsWith(value_string, expected_string) or expected_string.len == 0;
        }

        const not = this.op.contains(.not);
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected to not start with: <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toStartWith", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected to start with: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toStartWith", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toEndWith(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toEndWith() requires 1 argument", .{});
            return .zero;
        }

        const expected = arguments[0];
        expected.ensureStillAlive();

        if (!expected.isString()) {
            globalThis.throw("toEndWith() requires the first argument to be a string", .{});
            return .zero;
        }

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toEndWith() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        var pass = value.isString();
        if (pass) {
            const value_string = value.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            const expected_string = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            pass = strings.endsWith(value_string, expected_string) or expected_string.len == 0;
        }

        const not = this.op.contains(.not);
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected to not end with: <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toEndWith", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected to end with: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toEndWith", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub const PropertyMatcherIterator = struct {
        received_object: JSValue,
        failed: bool,
        i: usize = 0,

        pub fn forEach(
            globalObject: *JSGlobalObject,
            ctx_ptr: ?*anyopaque,
            key_: [*c]ZigString,
            value: JSValue,
            _: bool,
        ) callconv(.C) void {
            const key: ZigString = key_.?[0];
            if (key.eqlComptime("constructor")) return;
            if (key.eqlComptime("call")) return;

            var ctx: *@This() = bun.cast(*@This(), ctx_ptr orelse return);
            defer ctx.i += 1;
            var received_object: JSValue = ctx.received_object;

            if (received_object.get(globalObject, key.slice())) |received_value| {
                if (JSC.Jest.ExpectAny.fromJS(value)) |_| {
                    var constructor_value = JSC.Jest.ExpectAny.constructorValueGetCached(value) orelse {
                        globalObject.throw("Internal consistency error: the expect.any(constructor value) was garbage collected but it should not have been!", .{});
                        ctx.failed = true;
                        return;
                    };

                    if (received_value.isCell() and received_value.isInstanceOf(globalObject, constructor_value)) {
                        received_object.put(globalObject, &key, value);
                        return;
                    }

                    // check primitives
                    // TODO: check the constructor for primitives by reading it from JSGlobalObject through a binding.
                    var constructor_name = ZigString.Empty;
                    constructor_value.getNameProperty(globalObject, &constructor_name);
                    if (received_value.isNumber() and constructor_name.eqlComptime("Number")) {
                        received_object.put(globalObject, &key, value);
                        return;
                    }
                    if (received_value.isBoolean() and constructor_name.eqlComptime("Boolean")) {
                        received_object.put(globalObject, &key, value);
                        return;
                    }
                    if (received_value.isString() and constructor_name.eqlComptime("String")) {
                        received_object.put(globalObject, &key, value);
                        return;
                    }
                    if (received_value.isBigInt() and constructor_name.eqlComptime("BigInt")) {
                        received_object.put(globalObject, &key, value);
                        return;
                    }

                    ctx.failed = true;
                    return;
                }

                if (value.isObject()) {
                    if (received_object.get(globalObject, key.slice())) |new_object| {
                        var itr = PropertyMatcherIterator{
                            .received_object = new_object,
                            .failed = false,
                        };
                        value.forEachProperty(globalObject, &itr, PropertyMatcherIterator.forEach);
                        if (itr.failed) {
                            ctx.failed = true;
                        }
                    } else {
                        ctx.failed = true;
                    }

                    return;
                }

                if (value.isSameValue(received_value, globalObject)) return;
            }

            ctx.failed = true;
        }
    };

    pub fn toBeInstanceOf(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeInstanceOf() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toBeInstanceOf() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

        const expected_value = arguments[0];
        if (!expected_value.isConstructor()) {
            globalObject.throw("Expected value must be a function: {any}", .{expected_value.toFmt(globalObject, &formatter)});
            return .zero;
        }
        expected_value.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        const not = this.op.contains(.not);
        var pass = value.isInstanceOf(globalObject, expected_value);
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        const expected_fmt = expected_value.toFmt(globalObject, &formatter);
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected constructor: not <green>{any}<r>\n";
            const received_line = "Received value: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeInstanceOf", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected constructor: <green>{any}<r>\n";
        const received_line = "Received value: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeInstanceOf", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalObject.throwPretty(fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toMatch(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (this.scope.tests.items.len <= this.test_id) {
            globalObject.throw("toMatch() must be called in a test", .{});
            return .zero;
        }

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toMatch() requires 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

        const expected_value = arguments[0];
        if (!expected_value.isString() and !expected_value.isRegExp()) {
            globalObject.throw("Expected value must be a string or regular expression: {any}", .{expected_value.toFmt(globalObject, &formatter)});
            return .zero;
        }
        expected_value.ensureStillAlive();

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        if (!value.isString()) {
            globalObject.throw("Received value must be a string: {any}", .{value.toFmt(globalObject, &formatter)});
            return .zero;
        }

        const not = this.op.contains(.not);
        var pass: bool = brk: {
            if (expected_value.isString()) {
                break :brk value.stringIncludes(globalObject, expected_value);
            } else if (expected_value.isRegExp()) {
                break :brk expected_value.toMatch(globalObject, value);
            }
            unreachable;
        };

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        const expected_fmt = expected_value.toFmt(globalObject, &formatter);
        const value_fmt = value.toFmt(globalObject, &formatter);

        if (not) {
            const expected_line = "Expected substring or pattern: not <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toMatch", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            globalObject.throwPretty(fmt, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected substring or pattern: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toMatch", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalObject.throwPretty(fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toHaveBeenCalled(this: *Expect, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const thisValue = callframe.this();
        defer this.postMatch(globalObject);

        const value: JSValue = JSC.Jest.Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };

        const calls = JSMockFunction__getCalls(value);
        active_test_expectation_counter.actual += 1;

        if (calls == .zero or !calls.jsType().isArray()) {
            globalObject.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        var pass = calls.getLength(globalObject) > 0;

        const not = this.op.contains(.not);
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalled", "<green>expected<r>", true);
            const fmt = signature ++ "\n\nExpected: not <green>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{calls.toFmt(globalObject, &formatter)});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{calls.toFmt(globalObject, &formatter)});
            return .zero;
        }

        unreachable;
    }
    pub fn toHaveBeenCalledTimes(this: *Expect, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(1);
        const arguments: []const JSValue = arguments_.ptr[0..arguments_.len];
        defer this.postMatch(globalObject);
        const value: JSValue = JSC.Jest.Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };

        active_test_expectation_counter.actual += 1;

        const calls = JSMockFunction__getCalls(value);

        if (calls == .zero or !calls.jsType().isArray()) {
            globalObject.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        if (arguments.len < 1 or !arguments[0].isAnyInt()) {
            globalObject.throwInvalidArguments("toHaveBeenCalledTimes() requires 1 integer argument", .{});
            return .zero;
        }

        const times = arguments[0].coerce(i32, globalObject);

        var pass = @intCast(i32, calls.getLength(globalObject)) == times;

        const not = this.op.contains(.not);
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalled", "<green>expected<r>", true);
            const fmt = signature ++ "\n\nExpected: not <green>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{calls.toFmt(globalObject, &formatter)});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{calls.toFmt(globalObject, &formatter)});
            return .zero;
        } else {
            const signature = comptime getSignature("toHaveBeenCalled", "<green>expected<r>", true);
            const fmt = signature ++ "\n\nExpected <green>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{calls.toFmt(globalObject, &formatter)});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{calls.toFmt(globalObject, &formatter)});
            return .zero;
        }

        unreachable;
    }

    pub const toHaveBeenCalledWith = notImplementedJSCFn;
    pub const toHaveBeenLastCalledWith = notImplementedJSCFn;
    pub const toHaveBeenNthCalledWith = notImplementedJSCFn;
    pub const toHaveReturnedTimes = notImplementedJSCFn;
    pub const toHaveReturnedWith = notImplementedJSCFn;
    pub const toHaveLastReturnedWith = notImplementedJSCFn;
    pub const toHaveNthReturnedWith = notImplementedJSCFn;
    pub const toContainEqual = notImplementedJSCFn;
    pub const toMatchObject = notImplementedJSCFn;
    pub const toMatchInlineSnapshot = notImplementedJSCFn;
    pub const toThrowErrorMatchingSnapshot = notImplementedJSCFn;
    pub const toThrowErrorMatchingInlineSnapshot = notImplementedJSCFn;

    pub const getStaticNot = notImplementedStaticProp;
    pub const getStaticResolves = notImplementedStaticProp;
    pub const getStaticRejects = notImplementedStaticProp;

    pub fn getNot(this: *Expect, thisValue: JSValue, globalObject: *JSGlobalObject) callconv(.C) JSValue {
        _ = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };

        this.op.toggle(.not);

        return thisValue;
    }

    pub const getResolves = notImplementedJSCProp;
    pub const getRejects = notImplementedJSCProp;

    pub fn any(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectAny.call(globalObject, callFrame);
    }

    pub const extend = notImplementedStaticFn;
    pub const anything = notImplementedStaticFn;
    pub const arrayContaining = notImplementedStaticFn;
    pub const assertions = notImplementedStaticFn;
    pub const hasAssertions = notImplementedStaticFn;
    pub const objectContaining = notImplementedStaticFn;
    pub const stringContaining = notImplementedStaticFn;
    pub const stringMatching = notImplementedStaticFn;
    pub const addSnapshotSerializer = notImplementedStaticFn;

    pub fn notImplementedJSCFn(_: *Expect, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedStaticFn(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedJSCProp(_: *Expect, _: JSC.JSValue, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedStaticProp(globalObject: *JSC.JSGlobalObject, _: JSC.JSValue, _: JSC.JSValue) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn postMatch(_: *Expect, globalObject: *JSC.JSGlobalObject) void {
        var vm = globalObject.bunVM();
        vm.autoGarbageCollect();
    }
};

pub const TestScope = struct {
    label: string = "",
    parent: *DescribeScope,
    callback: JSC.JSValue,
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

    pub fn callIf(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createIfScope(globalThis, callframe, "test.if()", "if", TestScope, false);
    }

    pub fn skipIf(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createIfScope(globalThis, callframe, "test.skipIf()", "skipIf", TestScope, true);
    }

    pub fn onReject(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(2);
        const err = arguments.ptr[0];
        globalThis.bunVM().runErrorHandler(err, null);
        var task: *TestRunnerTask = arguments.ptr[1].asPromisePtr(TestRunnerTask);
        task.handleResult(.{ .fail = active_test_expectation_counter.actual }, .promise);
        globalThis.bunVM().autoGarbageCollect();
        return JSValue.jsUndefined();
    }

    pub fn onResolve(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(2);
        var task: *TestRunnerTask = arguments.ptr[1].asPromisePtr(TestRunnerTask);
        task.handleResult(.{ .pass = active_test_expectation_counter.actual }, .promise);
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
                    task.handleResult(.{ .pass = active_test_expectation_counter.actual }, .callback);
                } else {
                    globalThis.bunVM().runErrorHandlerWithDedupe(err, null);
                    task.handleResult(.{ .fail = active_test_expectation_counter.actual }, .callback);
                }
            } else {
                task.handleResult(.{ .pass = active_test_expectation_counter.actual }, .callback);
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
        const callback = this.callback;
        Jest.runner.?.did_pending_test_fail = false;
        defer {
            callback.unprotect();
            this.callback = .zero;
            vm.autoGarbageCollect();
        }
        JSC.markBinding(@src());

        const callback_length = callback.getLength(vm.global);

        var initial_value = JSValue.zero;
        if (test_elapsed_timer) |timer| {
            timer.reset();
            task.started_at = timer.started;
        }

        Jest.runner.?.setTimeout(
            this.timeout_millis,
            task.test_id,
        );

        if (callback_length > 0) {
            const callback_func = JSC.NewFunctionWithData(
                vm.global,
                ZigString.static("done"),
                0,
                TestScope.onDone,
                false,
                task,
            );
            task.done_callback_state = .pending;
            initial_value = callback.call(vm.global, &.{callback_func});
        } else {
            initial_value = callback.call(vm.global, &.{});
        }

        if (initial_value.isAnyError()) {
            if (!Jest.runner.?.did_pending_test_fail) {
                // test failed unless it's a todo
                Jest.runner.?.did_pending_test_fail = this.tag != .todo;
                vm.runErrorHandler(initial_value, null);
            }

            if (this.tag == .todo) {
                return .{ .todo = {} };
            }

            return .{ .fail = active_test_expectation_counter.actual };
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
                    if (!Jest.runner.?.did_pending_test_fail) {
                        // test failed unless it's a todo
                        Jest.runner.?.did_pending_test_fail = this.tag != .todo;
                        vm.runErrorHandler(promise.result(vm.global.vm()), null);
                    }

                    if (this.tag == .todo) {
                        return .{ .todo = {} };
                    }

                    return .{ .fail = active_test_expectation_counter.actual };
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

        if (callback_length > 0) {
            return .{ .pending = {} };
        }

        if (active_test_expectation_counter.expected > 0 and active_test_expectation_counter.expected < active_test_expectation_counter.actual) {
            Output.prettyErrorln("Test fail: {d} / {d} expectations\n (make this better!)", .{
                active_test_expectation_counter.actual,
                active_test_expectation_counter.expected,
            });
            return .{ .fail = active_test_expectation_counter.actual };
        }

        return .{ .pass = active_test_expectation_counter.actual };
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
    is_skip: bool = false,
    skip_count: u32 = 0,
    tag: Tag = .pass,

    pub fn isAllSkipped(this: *const DescribeScope) bool {
        return this.is_skip or @as(usize, this.skip_count) >= this.tests.items.len;
    }

    pub fn push(new: *DescribeScope) void {
        if (comptime is_bindgen) return undefined;
        if (new == DescribeScope.active) return;

        new.parent = DescribeScope.active;
        DescribeScope.active = new;
    }

    pub fn pop(this: *DescribeScope) void {
        if (comptime is_bindgen) return undefined;
        if (DescribeScope.active == this)
            DescribeScope.active = this.parent orelse DescribeScope.active;
    }

    pub const LifecycleHook = enum {
        beforeAll,
        beforeEach,
        afterEach,
        afterAll,
    };

    pub threadlocal var active: *DescribeScope = undefined;
    pub threadlocal var module: *DescribeScope = undefined;

    const CallbackFn = *const fn (
        *JSC.JSGlobalObject,
        *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue;

    fn createCallback(comptime hook: LifecycleHook) CallbackFn {
        return struct {
            const this_hook = hook;
            pub fn run(
                globalThis: *JSC.JSGlobalObject,
                callframe: *JSC.CallFrame,
            ) callconv(.C) JSC.JSValue {
                const arguments_ = callframe.arguments(2);
                const arguments = arguments_.ptr[0..arguments_.len];
                if (arguments.len == 0 or !arguments[0].isObject() or !arguments[0].isCallable(globalThis.vm())) {
                    globalThis.throwInvalidArgumentType(@tagName(this_hook), "callback", "function");
                    return .zero;
                }

                arguments[0].protect();
                const name = comptime @as(string, @tagName(this_hook));
                @field(DescribeScope.active, name).append(getAllocator(globalThis), arguments[0]) catch unreachable;
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
                    ctx.bunVM().runErrorHandlerWithDedupe(err, null);
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

    pub fn execCallback(this: *DescribeScope, globalObject: *JSC.JSGlobalObject, comptime hook: LifecycleHook) JSValue {
        const name = comptime @as(string, @tagName(hook));
        var hooks: []JSC.JSValue = @field(this, name).items;
        for (hooks, 0..) |cb, i| {
            if (cb.isEmpty()) continue;

            const pending_test = Jest.runner.?.pending_test;
            // forbid `expect()` within hooks
            Jest.runner.?.pending_test = null;
            const orig_did_pending_test_fail = Jest.runner.?.did_pending_test_fail;

            Jest.runner.?.did_pending_test_fail = false;

            const vm = VirtualMachine.get();
            var result: JSC.JSValue = if (cb.getLength(globalObject) > 0) brk: {
                this.done = false;
                const done_func = JSC.NewFunctionWithData(
                    globalObject,
                    ZigString.static("done"),
                    0,
                    DescribeScope.onDone,
                    false,
                    this,
                );
                var result = cb.call(globalObject, &.{done_func});
                vm.waitFor(&this.done);
                break :brk result;
            } else cb.call(globalObject, &.{});
            if (result.asAnyPromise()) |promise| {
                if (promise.status(globalObject.vm()) == .Pending) {
                    result.protect();
                    vm.waitForPromise(promise);
                    result.unprotect();
                }

                result = promise.result(globalObject.vm());
            }

            Jest.runner.?.pending_test = pending_test;
            Jest.runner.?.did_pending_test_fail = orig_did_pending_test_fail;
            if (result.isAnyError()) return result;

            if (comptime hook == .beforeAll or hook == .afterAll) {
                hooks[i] = JSC.JSValue.zero;
            }
        }

        return JSValue.zero;
    }

    pub fn runGlobalCallbacks(globalThis: *JSC.JSGlobalObject, comptime hook: LifecycleHook) ?JSValue {
        // global callbacks
        for (@field(Jest.runner.?.global_callbacks, @tagName(hook)).items) |cb| {
            if (cb.isEmpty()) continue;

            const pending_test = Jest.runner.?.pending_test;
            // forbid `expect()` within hooks
            Jest.runner.?.pending_test = null;
            const orig_did_pending_test_fail = Jest.runner.?.did_pending_test_fail;

            Jest.runner.?.did_pending_test_fail = false;

            const vm = VirtualMachine.get();
            // note: we do not support "done" callback in global hooks in the first release.
            var result: JSC.JSValue = cb.call(globalThis, &.{});
            if (result.asAnyPromise()) |promise| {
                if (promise.status(globalThis.vm()) == .Pending) {
                    result.protect();
                    vm.waitForPromise(promise);
                    result.unprotect();
                }

                result = promise.result(globalThis.vm());
            }

            Jest.runner.?.pending_test = pending_test;
            Jest.runner.?.did_pending_test_fail = orig_did_pending_test_fail;
            if (result.isAnyError()) return result;
        }

        if (comptime hook == .beforeAll or hook == .afterAll) {
            @field(Jest.runner.?.global_callbacks, @tagName(hook)).items.len = 0;
        }

        return null;
    }

    pub fn runCallback(this: *DescribeScope, globalObject: *JSC.JSGlobalObject, comptime hook: LifecycleHook) JSValue {
        if (runGlobalCallbacks(globalObject, hook)) |err| {
            return err;
        }

        var parent = this.parent;
        while (parent) |scope| {
            const ret = scope.execCallback(globalObject, hook);
            if (!ret.isEmpty()) {
                return ret;
            }
            parent = scope.parent;
        }

        return this.execCallback(globalObject, hook);
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

    pub fn callIf(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createIfScope(globalThis, callframe, "describe.if()", "if", DescribeScope, false);
    }

    pub fn skipIf(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(.C) JSValue {
        return createIfScope(globalThis, callframe, "describe.skipIf()", "skipIf", DescribeScope, true);
    }

    pub fn run(this: *DescribeScope, globalObject: *JSC.JSGlobalObject, callback: JSC.JSValue) JSC.JSValue {
        if (comptime is_bindgen) return undefined;
        callback.protect();
        defer callback.unprotect();
        var original_active = active;
        defer active = original_active;
        if (this != module)
            this.parent = this.parent orelse active;
        active = this;

        if (callback == .zero) {
            this.runTests(globalObject);
            return .undefined;
        }

        {
            JSC.markBinding(@src());
            globalObject.clearTerminationException();
            var result = callback.call(globalObject, &.{});

            if (result.asAnyPromise()) |prom| {
                globalObject.bunVM().waitForPromise(prom);
                switch (prom.status(globalObject.ptr().vm())) {
                    JSPromise.Status.Fulfilled => {},
                    else => {
                        globalObject.bunVM().runErrorHandlerWithDedupe(prom.result(globalObject.ptr().vm()), null);
                        return .undefined;
                    },
                }
            } else if (result.toError()) |err| {
                globalObject.bunVM().runErrorHandlerWithDedupe(err, null);
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
        var tests: []TestScope = this.tests.items;
        const end = @truncate(TestRunner.Test.ID, tests.len);
        this.pending_tests = std.DynamicBitSetUnmanaged.initFull(allocator, end) catch unreachable;

        if (end == 0) {
            // TODO: print the describe label when there are no tests
            return;
        }

        // Step 2. Update the runner with the count of how many tests we have for this block
        this.test_id_start = Jest.runner.?.addTestCount(end);

        const source: logger.Source = Jest.runner.?.files.items(.source)[file];

        var i: TestRunner.Test.ID = 0;

        if (!this.isAllSkipped()) {
            const beforeAllCallback = this.runCallback(globalObject, .beforeAll);
            if (!beforeAllCallback.isEmpty()) {
                while (i < end) {
                    Jest.runner.?.reportFailure(i + this.test_id_start, source.path.text, tests[i].label, 0, 0, this);
                    i += 1;
                }
                this.tests.clearAndFree(allocator);
                this.pending_tests.deinit(allocator);
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
        this.pending_tests.unset(test_id);

        if (!skipped) {
            const afterEach_result = this.runCallback(globalThis, .afterEach);
            if (!afterEach_result.isEmpty()) {
                globalThis.bunVM().runErrorHandler(afterEach_result, null);
            }
        }

        if (this.pending_tests.findFirstSet() != null) {
            return;
        }

        if (!this.isAllSkipped()) {
            // Run the afterAll callbacks, in reverse order
            // unless there were no tests for this scope
            const afterAll_result = this.execCallback(globalThis, .afterAll);
            if (!afterAll_result.isEmpty()) {
                globalThis.bunVM().runErrorHandler(afterAll_result, null);
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

var active_test_expectation_counter: TestScope.Counter = undefined;

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

    pub fn onUnhandledRejection(jsc_vm: *VirtualMachine, global: *JSC.JSGlobalObject, rejection: JSC.JSValue) void {
        if (Jest.runner) |runner| {
            if (runner.did_pending_test_fail and rejection.isException(global.vm())) {
                if (rejection.toError()) |err| {
                    if (err.get(global, "name")) |name| {
                        if (name.isString() and name.getZigString(global).eqlComptime("TestNotRunningError")) {
                            return;
                        }
                    }
                }
            }
        }

        if (jsc_vm.last_reported_error_for_dedupe == rejection and rejection != .zero) {
            jsc_vm.last_reported_error_for_dedupe = .zero;
        } else {
            jsc_vm.runErrorHandlerWithDedupe(rejection, null);
        }

        if (jsc_vm.onUnhandledRejectionCtx) |ctx| {
            var this = bun.cast(*TestRunnerTask, ctx);
            jsc_vm.onUnhandledRejectionCtx = null;
            this.handleResult(.{ .fail = active_test_expectation_counter.actual }, .unhandledRejection);
        }
    }

    pub fn run(this: *TestRunnerTask) bool {
        var describe = this.describe;
        var globalThis = this.globalThis;
        var jsc_vm = globalThis.bunVM();

        // reset the global state for each test
        // prior to the run
        DescribeScope.active = describe;
        active_test_expectation_counter = .{};
        jsc_vm.last_reported_error_for_dedupe = .zero;

        const test_id = this.test_id;
        var test_: TestScope = this.describe.tests.items[test_id];
        describe.current_test_id = test_id;

        if (test_.callback == .zero or (describe.is_skip and test_.tag != .only)) {
            var tag = if (describe.is_skip) describe.tag else test_.tag;
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
        if (Output.is_github_action) {
            jsc_vm.setOnException(printGithubAnnotation);
        }

        if (this.needs_before_each) {
            this.needs_before_each = false;
            const label = test_.label;

            const beforeEach = this.describe.runCallback(globalThis, .beforeEach);

            if (!beforeEach.isEmpty()) {
                Jest.runner.?.reportFailure(test_id, this.source_file_path, label, 0, 0, this.describe);
                jsc_vm.runErrorHandler(beforeEach, null);
                return false;
            }
        }

        this.sync_state = .pending;

        const result = TestScope.run(&test_, this);

        // rejected promises should fail the test
        if (result != .fail)
            globalThis.handleRejectedPromises();

        if (result == .pending and this.sync_state == .pending and (this.done_callback_state == .pending or this.promise_state == .pending)) {
            this.sync_state = .fulfilled;
            return true;
        }

        this.handleResult(result, .sync);

        if (result == .fail) {
            globalThis.handleRejectedPromises();
        }

        return false;
    }

    pub fn timeout(this: *TestRunnerTask) void {
        std.debug.assert(!this.reported);

        this.ref.unref(this.globalThis.bunVM());
        this.globalThis.throwTerminationException();
        this.handleResult(.{ .fail = active_test_expectation_counter.actual }, .timeout);
    }

    pub fn handleResult(this: *TestRunnerTask, result: Result, comptime from: @Type(.EnumLiteral)) void {
        if (result == .fail)
            Jest.runner.?.did_pending_test_fail = true;

        switch (comptime from) {
            .promise => {
                std.debug.assert(this.promise_state == .pending);
                this.promise_state = .fulfilled;

                if (this.done_callback_state == .pending and result == .pass) {
                    return;
                }
            },
            .callback => {
                std.debug.assert(this.done_callback_state == .pending);
                this.done_callback_state = .fulfilled;

                if (this.promise_state == .pending and result == .pass) {
                    return;
                }
            },
            .sync => {
                std.debug.assert(this.sync_state == .pending);
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
        var test_ = this.describe.tests.items[test_id];
        var describe = this.describe;
        describe.tests.items[test_id] = test_;
        if (comptime from == .timeout) {
            Output.prettyErrorln("<r><red>Timeout<r><d>:<r> test <b>{}<r> timed out after {d}ms", .{ bun.fmt.quote(test_.label), test_.timeout_millis });
            Output.flush();
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
        var vm = JSC.VirtualMachine.get();
        if (vm.onUnhandledRejectionCtx) |ctx| {
            if (ctx == @ptrCast(*anyopaque, this)) {
                vm.onUnhandledRejectionCtx = null;
            }
        }
        vm.clearOnException();

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
    fail: u32,
    pass: u32, // assertion count
    pending: void,
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

inline fn createScope(
    globalThis: *JSGlobalObject,
    callframe: *CallFrame,
    comptime signature: string,
    comptime is_test: bool,
    comptime tag: Tag,
) JSValue {
    const this = callframe.this();
    const arguments = callframe.arguments(3);
    const args = arguments.ptr[0..arguments.len];

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
        timeout_ms = @intCast(u32, @max(args[2].coerce(i32, globalThis), 0));
    } else if (options.isObject()) {
        if (options.get(globalThis, "timeout")) |timeout| {
            if (!timeout.isNumber()) {
                globalThis.throwPretty("{s} expects timeout to be a number", .{signature});
                return .zero;
            }
            timeout_ms = @intCast(u32, @max(timeout.coerce(i32, globalThis), 0));
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

    const parent = DescribeScope.active;
    const allocator = getAllocator(globalThis);
    const label = if (description == .zero)
        ""
    else
        (description.toSlice(globalThis, allocator).cloneIfNeeded(allocator) catch unreachable).slice();

    if (tag == .only) {
        Jest.runner.?.setOnly();
    } else if (is_test and Jest.runner.?.only and parent.tag != .only) {
        return .zero;
    }

    const is_skip = tag == .skip or
        (tag == .todo and (function == .zero or !Jest.runner.?.run_todo)) or
        (tag != .only and Jest.runner.?.only and parent.tag != .only);

    if (is_test) {
        if (is_skip) {
            parent.skip_count += 1;
            function.unprotect();
        } else {
            function.protect();
        }

        parent.tests.append(allocator, TestScope{
            .label = label,
            .parent = parent,
            .tag = tag,
            .callback = if (is_skip) .zero else function,
            .timeout_millis = timeout_ms,
        }) catch unreachable;

        if (test_elapsed_timer == null) create_timer: {
            var timer = allocator.create(std.time.Timer) catch unreachable;
            timer.* = std.time.Timer.start() catch break :create_timer;
            test_elapsed_timer = timer;
        }
    } else {
        var scope = allocator.create(DescribeScope) catch unreachable;
        scope.* = .{
            .label = label,
            .parent = parent,
            .file_id = parent.file_id,
            .tag = if (parent.is_skip) parent.tag else tag,
            .is_skip = is_skip or parent.is_skip,
        };

        return scope.run(globalThis, function);
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
    const args = arguments.ptr[0..arguments.len];

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

// In Github Actions, emit an annotation that renders the error and location.
// https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message
pub fn printGithubAnnotation(exception: *JSC.ZigException) void {
    const name = exception.name;
    const message = exception.message;
    const frames = exception.stack.frames();
    const top_frame = if (frames.len > 0) frames[0] else null;
    const dir = bun.getenvZ("GITHUB_WORKSPACE") orelse bun.fs.FileSystem.instance.top_level_dir;
    const allocator = bun.default_allocator;

    var has_location = false;

    if (top_frame) |frame| {
        if (!frame.position.isInvalid()) {
            const source_url = frame.source_url.toSlice(allocator);
            defer source_url.deinit();
            const file = bun.path.relative(dir, source_url.slice());
            Output.printError("\n::error file={s},line={d},col={d},title=", .{
                file,
                frame.position.line_start + 1,
                frame.position.column_start,
            });
            has_location = true;
        }
    }

    if (!has_location) {
        Output.printError("\n::error title=", .{});
    }

    if (name.len == 0 or name.eqlComptime("Error")) {
        Output.printError("error", .{});
    } else {
        Output.printError("{s}", .{name.githubAction()});
    }

    if (message.len > 0) {
        const message_slice = message.toSlice(allocator);
        defer message_slice.deinit();
        const msg = message_slice.slice();

        var cursor: u32 = 0;
        while (strings.indexOfNewlineOrNonASCIIOrANSI(msg, cursor)) |i| {
            cursor = i + 1;
            if (msg[i] == '\n') {
                const first_line = ZigString.init(msg[0..i]);
                Output.printError(": {s}::", .{first_line.githubAction()});
                break;
            }
        } else {
            Output.printError(": {s}::", .{message.githubAction()});
        }

        while (strings.indexOfNewlineOrNonASCIIOrANSI(msg, cursor)) |i| {
            cursor = i + 1;
            if (msg[i] == '\n') {
                break;
            }
        }

        if (cursor > 0) {
            const body = ZigString.init(msg[cursor..]);
            Output.printError("{s}", .{body.githubAction()});
        }
    } else {
        Output.printError("::", .{});
    }

    // TODO: cleanup and refactor to use printStackTrace()
    if (top_frame) |_| {
        const vm = VirtualMachine.get();
        const origin = if (vm.is_from_devserver) &vm.origin else null;

        var i: i16 = 0;
        while (i < frames.len) : (i += 1) {
            const frame = frames[@intCast(usize, i)];
            const source_url = frame.source_url.toSlice(allocator);
            defer source_url.deinit();
            const file = bun.path.relative(dir, source_url.slice());
            const func = frame.function_name.toSlice(allocator);

            if (file.len == 0 and func.len == 0) continue;

            const has_name = std.fmt.count("{any}", .{frame.nameFormatter(
                false,
            )}) > 0;

            // %0A = escaped newline
            if (has_name) {
                Output.printError(
                    "%0A      at {any} ({any})",
                    .{
                        frame.nameFormatter(false),
                        frame.sourceURLFormatter(
                            file,
                            origin,
                            false,
                            false,
                        ),
                    },
                );
            } else {
                Output.printError(
                    "%0A      at {any}",
                    .{
                        frame.sourceURLFormatter(
                            file,
                            origin,
                            false,
                            false,
                        ),
                    },
                );
            }
        }
    }

    Output.printError("\n", .{});
    Output.flush();
}

/// JSValue.zero is used to indicate it was not a JSMockFunction
/// If there were no calls, it returns an empty JSArray*
extern fn JSMockFunction__getCalls(JSValue) JSValue;

/// JSValue.zero is used to indicate it was not a JSMockFunction
/// If there were no calls, it returns an empty JSArray*
extern fn JSMockFunction__getReturns(JSValue) JSValue;
