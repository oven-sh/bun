const CurrentFile = struct {
    title: string = "",
    prefix: string = "",
    repeat_info: struct {
        count: u32 = 0,
        index: u32 = 0,
    } = .{},
    has_printed_filename: bool = false,

    pub fn set(
        this: *CurrentFile,
        title: string,
        prefix: string,
        repeat_count: u32,
        repeat_index: u32,
        reporter: *CommandLineReporter,
    ) void {
        if (reporter.reporters.dots or reporter.reporters.only_failures) {
            this.freeAndClear();
            this.title = bun.handleOom(bun.default_allocator.dupe(u8, title));
            this.prefix = bun.handleOom(bun.default_allocator.dupe(u8, prefix));
            this.repeat_info.count = repeat_count;
            this.repeat_info.index = repeat_index;
            this.has_printed_filename = false;
            return;
        }

        this.has_printed_filename = true;
        print(title, prefix, repeat_count, repeat_index);
    }

    fn freeAndClear(this: *CurrentFile) void {
        bun.default_allocator.free(this.title);
        bun.default_allocator.free(this.prefix);
    }

    fn print(title: string, prefix: string, repeat_count: u32, repeat_index: u32) void {
        const enable_buffering = Output.enableBufferingScope();
        defer enable_buffering.deinit();

        Output.prettyError("<r>\n", .{});

        if (repeat_count > 0) {
            if (repeat_count > 1) {
                Output.prettyErrorln("{s}{s}: <d>(run #{d})<r>\n", .{ prefix, title, repeat_index + 1 });
            } else {
                Output.prettyErrorln("{s}{s}:\n", .{ prefix, title });
            }
        } else {
            Output.prettyErrorln("{s}{s}:\n", .{ prefix, title });
        }

        Output.flush();
    }

    pub fn printIfNeeded(this: *CurrentFile) void {
        if (this.has_printed_filename) return;
        this.has_printed_filename = true;

        print(this.title, this.prefix, this.repeat_info.count, this.repeat_info.index);
    }
};

pub const TestRunner = struct {
    current_file: CurrentFile = CurrentFile{},
    files: File.List = .{},
    index: File.Map = File.Map{},
    only: bool = false,
    run_todo: bool = false,
    concurrent: bool = false,
    randomize: ?std.Random = null,
    concurrent_test_glob: ?[]const []const u8 = null,
    last_file: u64 = 0,
    bail: u32 = 0,
    max_concurrency: u32,

    allocator: std.mem.Allocator,

    drainer: jsc.AnyTask = undefined,

    has_pending_tests: bool = false,

    snapshots: Snapshots,

    default_timeout_ms: u32,

    // from `setDefaultTimeout() or jest.setTimeout()`. maxInt(u32) means override not set.
    default_timeout_override: u32 = std.math.maxInt(u32),

    test_options: *const bun.cli.Command.TestOptions = undefined,

    // Used for --test-name-pattern to reduce allocations
    filter_regex: ?*RegularExpression,

    unhandled_errors_between_tests: u32 = 0,
    summary: Summary = Summary{},

    bun_test_root: bun_test.BunTestRoot,

    pub const Summary = struct {
        pass: u32 = 0,
        expectations: u32 = 0,
        skip: u32 = 0,
        todo: u32 = 0,
        fail: u32 = 0,
        files: u32 = 0,
        skipped_because_label: u32 = 0,

        pub fn didLabelFilterOutAllTests(this: *const Summary) bool {
            return this.skipped_because_label > 0 and (this.pass + this.skip + this.todo + this.fail + this.expectations) == 0;
        }
    };

    pub fn hasTestFilter(this: *const TestRunner) bool {
        return this.filter_regex != null;
    }

    pub fn shouldFileRunConcurrently(this: *const TestRunner, file_id: File.ID) bool {
        // Check if global concurrent flag is set
        if (this.concurrent) return true;

        // If no glob patterns are set, don't run concurrently
        const glob_patterns = this.concurrent_test_glob orelse return false;

        // Get the file path from the file_id
        if (file_id >= this.files.len) return false;
        const file_path = this.files.items(.source)[file_id].path.text;

        // Check if the file path matches any of the glob patterns
        for (glob_patterns) |pattern| {
            const result = bun.glob.match(pattern, file_path);
            if (result == .match) return true;
        }
        return false;
    }

    pub fn getOrPutFile(this: *TestRunner, file_path: string) struct { file_id: File.ID } {
        const entry = this.index.getOrPut(this.allocator, @as(u32, @truncate(bun.hash(file_path)))) catch unreachable; // TODO: this is wrong. you can't put a hash as the key in a hashmap.
        if (entry.found_existing) {
            return .{ .file_id = entry.value_ptr.* };
        }
        const file_id = @as(File.ID, @truncate(this.files.len));
        this.files.append(this.allocator, .{ .source = logger.Source.initEmptyFile(file_path) }) catch unreachable;
        entry.value_ptr.* = file_id;
        return .{ .file_id = file_id };
    }

    pub const File = struct {
        source: logger.Source = logger.Source.initEmptyFile(""),
        log: logger.Log = logger.Log.initComptime(default_allocator),

        pub const List = std.MultiArrayList(File);
        pub const ID = u32;
        pub const Map = std.ArrayHashMapUnmanaged(u32, u32, ArrayIdentityContext, false);
    };
};

pub const Jest = struct {
    pub var runner: ?*TestRunner = null;

    pub fn Bun__Jest__createTestModuleObject(globalObject: *JSGlobalObject) callconv(.C) JSValue {
        return createTestModule(globalObject) catch return .zero;
    }

    pub fn createTestModule(globalObject: *JSGlobalObject) bun.JSError!JSValue {
        const module = JSValue.createEmptyObject(globalObject, 19);

        const test_scope_functions = try bun_test.ScopeFunctions.createBound(globalObject, .@"test", .zero, .{}, bun_test.ScopeFunctions.strings.@"test");
        module.put(globalObject, ZigString.static("test"), test_scope_functions);
        module.put(globalObject, ZigString.static("it"), test_scope_functions);

        const xtest_scope_functions = try bun_test.ScopeFunctions.createBound(globalObject, .@"test", .zero, .{ .self_mode = .skip }, bun_test.ScopeFunctions.strings.xtest);
        module.put(globalObject, ZigString.static("xtest"), xtest_scope_functions);
        module.put(globalObject, ZigString.static("xit"), xtest_scope_functions);

        const describe_scope_functions = try bun_test.ScopeFunctions.createBound(globalObject, .describe, .zero, .{}, bun_test.ScopeFunctions.strings.describe);
        module.put(globalObject, ZigString.static("describe"), describe_scope_functions);

        const xdescribe_scope_functions = bun_test.ScopeFunctions.createBound(globalObject, .describe, .zero, .{ .self_mode = .skip }, bun_test.ScopeFunctions.strings.xdescribe) catch return .zero;
        module.put(globalObject, ZigString.static("xdescribe"), xdescribe_scope_functions);

        module.put(globalObject, ZigString.static("beforeEach"), jsc.host_fn.NewFunction(globalObject, ZigString.static("beforeEach"), 1, bun_test.js_fns.genericHook(.beforeEach).hookFn, false));
        module.put(globalObject, ZigString.static("beforeAll"), jsc.host_fn.NewFunction(globalObject, ZigString.static("beforeAll"), 1, bun_test.js_fns.genericHook(.beforeAll).hookFn, false));
        module.put(globalObject, ZigString.static("afterAll"), jsc.host_fn.NewFunction(globalObject, ZigString.static("afterAll"), 1, bun_test.js_fns.genericHook(.afterAll).hookFn, false));
        module.put(globalObject, ZigString.static("afterEach"), jsc.host_fn.NewFunction(globalObject, ZigString.static("afterEach"), 1, bun_test.js_fns.genericHook(.afterEach).hookFn, false));
        module.put(globalObject, ZigString.static("setDefaultTimeout"), jsc.host_fn.NewFunction(globalObject, ZigString.static("setDefaultTimeout"), 1, jsSetDefaultTimeout, false));
        module.put(globalObject, ZigString.static("expect"), Expect.js.getConstructor(globalObject));
        module.put(globalObject, ZigString.static("expectTypeOf"), ExpectTypeOf.js.getConstructor(globalObject));

        createMockObjects(globalObject, module);

        return module;
    }

    fn createMockObjects(globalObject: *JSGlobalObject, module: JSValue) void {
        const setSystemTime = jsc.host_fn.NewFunction(globalObject, ZigString.static("setSystemTime"), 0, JSMock__jsSetSystemTime, false);
        module.put(
            globalObject,
            ZigString.static("setSystemTime"),
            setSystemTime,
        );
        const useFakeTimers = jsc.host_fn.NewFunction(globalObject, ZigString.static("useFakeTimers"), 0, JSMock__jsUseFakeTimers, false);
        const useRealTimers = jsc.host_fn.NewFunction(globalObject, ZigString.static("useRealTimers"), 0, JSMock__jsUseRealTimers, false);

        const mockFn = jsc.host_fn.NewFunction(globalObject, ZigString.static("fn"), 1, JSMock__jsMockFn, false);
        const spyOn = jsc.host_fn.NewFunction(globalObject, ZigString.static("spyOn"), 2, JSMock__jsSpyOn, false);
        const restoreAllMocks = jsc.host_fn.NewFunction(globalObject, ZigString.static("restoreAllMocks"), 2, JSMock__jsRestoreAllMocks, false);
        const clearAllMocks = jsc.host_fn.NewFunction(globalObject, ZigString.static("clearAllMocks"), 2, JSMock__jsClearAllMocks, false);
        const mockModuleFn = jsc.host_fn.NewFunction(globalObject, ZigString.static("module"), 2, JSMock__jsModuleMock, false);
        module.put(globalObject, ZigString.static("mock"), mockFn);
        mockFn.put(globalObject, ZigString.static("module"), mockModuleFn);
        mockFn.put(globalObject, ZigString.static("restore"), restoreAllMocks);
        mockFn.put(globalObject, ZigString.static("clearAllMocks"), clearAllMocks);

        const jest = JSValue.createEmptyObject(globalObject, 10);
        jest.put(globalObject, ZigString.static("fn"), mockFn);
        jest.put(globalObject, ZigString.static("mock"), mockModuleFn);
        jest.put(globalObject, ZigString.static("spyOn"), spyOn);
        jest.put(globalObject, ZigString.static("restoreAllMocks"), restoreAllMocks);
        jest.put(globalObject, ZigString.static("clearAllMocks"), clearAllMocks);
        jest.put(globalObject, ZigString.static("resetAllMocks"), clearAllMocks);
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
        jest.put(globalObject, ZigString.static("now"), jsc.host_fn.NewFunction(globalObject, ZigString.static("now"), 0, JSMock__jsNow, false));
        jest.put(globalObject, ZigString.static("setTimeout"), jsc.host_fn.NewFunction(globalObject, ZigString.static("setTimeout"), 1, jsSetDefaultTimeout, false));

        module.put(globalObject, ZigString.static("jest"), jest);
        module.put(globalObject, ZigString.static("spyOn"), spyOn);
        module.put(
            globalObject,
            ZigString.static("expect"),
            Expect.js.getConstructor(globalObject),
        );

        const vi = JSValue.createEmptyObject(globalObject, 8);
        vi.put(globalObject, ZigString.static("fn"), mockFn);
        vi.put(globalObject, ZigString.static("mock"), mockModuleFn);
        vi.put(globalObject, ZigString.static("spyOn"), spyOn);
        vi.put(globalObject, ZigString.static("restoreAllMocks"), restoreAllMocks);
        vi.put(globalObject, ZigString.static("resetAllMocks"), clearAllMocks);
        vi.put(globalObject, ZigString.static("clearAllMocks"), clearAllMocks);
        vi.put(globalObject, ZigString.static("useFakeTimers"), useFakeTimers);
        vi.put(globalObject, ZigString.static("useRealTimers"), useRealTimers);
        module.put(globalObject, ZigString.static("vi"), vi);
    }

    extern fn Bun__Jest__testModuleObject(*JSGlobalObject) JSValue;
    extern fn JSMock__jsMockFn(*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
    extern fn JSMock__jsModuleMock(*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
    extern fn JSMock__jsNow(*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
    extern fn JSMock__jsSetSystemTime(*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
    extern fn JSMock__jsRestoreAllMocks(*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
    extern fn JSMock__jsClearAllMocks(*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
    extern fn JSMock__jsSpyOn(*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
    extern fn JSMock__jsUseFakeTimers(*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
    extern fn JSMock__jsUseRealTimers(*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;

    pub fn call(
        globalObject: *JSGlobalObject,
        callframe: *CallFrame,
    ) bun.JSError!JSValue {
        const vm = globalObject.bunVM();

        if (vm.is_in_preload or runner == null) {
            // in preload, no arguments needed
        } else {
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
        }

        return Bun__Jest__testModuleObject(globalObject);
    }

    fn jsSetDefaultTimeout(globalObject: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(1).slice();
        if (arguments.len < 1 or !arguments[0].isNumber()) {
            return globalObject.throw("setTimeout() expects a number (milliseconds)", .{});
        }

        const timeout_ms: u32 = @intCast(@max(try arguments[0].coerce(i32, globalObject), 0));

        if (Jest.runner) |test_runner| {
            test_runner.default_timeout_override = timeout_ms;
        }

        return .js_undefined;
    }

    comptime {
        @export(&Bun__Jest__createTestModuleObject, .{ .name = "Bun__Jest__createTestModuleObject" });
    }
};

pub const on_unhandled_rejection = struct {
    pub fn onUnhandledRejection(jsc_vm: *VirtualMachine, globalObject: *JSGlobalObject, rejection: JSValue) void {
        if (bun.jsc.Jest.bun_test.cloneActiveStrong()) |buntest_strong_| {
            var buntest_strong = buntest_strong_;
            defer buntest_strong.deinit();

            const buntest = buntest_strong.get();
            var current_state_data = buntest.getCurrentStateData(); // mark unhandled errors as belonging to the currently active test. note that this can be misleading.
            if (current_state_data.entry(buntest)) |entry| {
                if (current_state_data.sequence(buntest)) |sequence| {
                    if (entry != sequence.test_entry) {
                        current_state_data = .start; // mark errors in hooks as 'unhandled error between tests'
                    }
                }
            }
            buntest.onUncaughtException(globalObject, rejection, true, current_state_data);
            buntest.addResult(current_state_data);
            bun_test.BunTest.run(buntest_strong, globalObject) catch |e| {
                globalObject.reportUncaughtExceptionFromError(e);
            };
            return;
        }

        jsc_vm.runErrorHandler(rejection, jsc_vm.onUnhandledRejectionExceptionList);
    }
};

fn consumeArg(
    globalThis: *JSGlobalObject,
    should_write: bool,
    str_idx: *usize,
    args_idx: *usize,
    array_list: *std.ArrayList(u8),
    arg: *const JSValue,
    fallback: []const u8,
) !void {
    if (should_write) {
        const owned_slice = try arg.toSliceOrNull(globalThis);
        defer owned_slice.deinit();
        bun.handleOom(array_list.appendSlice(owned_slice.slice()));
    } else {
        bun.handleOom(array_list.appendSlice(fallback));
    }
    str_idx.* += 1;
    args_idx.* += 1;
}

// Generate test label by positionally injecting parameters with printf formatting
pub fn formatLabel(globalThis: *JSGlobalObject, label: string, function_args: []const jsc.JSValue, test_idx: usize, allocator: std.mem.Allocator) !string {
    var idx: usize = 0;
    var args_idx: usize = 0;
    var list = bun.handleOom(std.ArrayList(u8).initCapacity(allocator, label.len));
    defer list.deinit();

    while (idx < label.len) {
        const char = label[idx];

        if (char == '$' and idx + 1 < label.len and function_args.len > 0 and function_args[0].isObject()) {
            const var_start = idx + 1;
            var var_end = var_start;

            if (bun.js_lexer.isIdentifierStart(label[var_end])) {
                var_end += 1;

                while (var_end < label.len) {
                    const c = label[var_end];
                    if (c == '.') {
                        if (var_end + 1 < label.len and bun.js_lexer.isIdentifierContinue(label[var_end + 1])) {
                            var_end += 1;
                        } else {
                            break;
                        }
                    } else if (bun.js_lexer.isIdentifierContinue(c)) {
                        var_end += 1;
                    } else {
                        break;
                    }
                }

                const var_path = label[var_start..var_end];
                const value = try function_args[0].getIfPropertyExistsFromPath(globalThis, bun.String.init(var_path).toJS(globalThis));
                if (!value.isEmptyOrUndefinedOrNull()) {
                    // For primitive strings, use toString() to avoid adding quotes
                    // This matches Jest's behavior (https://github.com/jestjs/jest/issues/7689)
                    if (value.isString()) {
                        const owned_slice = try value.toSliceOrNull(globalThis);
                        defer owned_slice.deinit();
                        bun.handleOom(list.appendSlice(owned_slice.slice()));
                    } else {
                        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                        defer formatter.deinit();
                        bun.handleOom(list.writer().print("{}", .{value.toFmt(&formatter)}));
                    }
                    idx = var_end;
                    continue;
                }
            } else {
                while (var_end < label.len and (bun.js_lexer.isIdentifierContinue(label[var_end]) and label[var_end] != '$')) {
                    var_end += 1;
                }
            }

            bun.handleOom(list.append('$'));
            bun.handleOom(list.appendSlice(label[var_start..var_end]));
            idx = var_end;
        } else if (char == '%' and (idx + 1 < label.len) and !(args_idx >= function_args.len)) {
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
                    try current_arg.jsonStringify(globalThis, 0, &str);
                    const owned_slice = bun.handleOom(str.toOwnedSlice(allocator));
                    defer allocator.free(owned_slice);
                    bun.handleOom(list.appendSlice(owned_slice));
                    idx += 1;
                    args_idx += 1;
                },
                'p' => {
                    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                    defer formatter.deinit();
                    const value_fmt = current_arg.toFmt(&formatter);
                    bun.handleOom(list.writer().print("{}", .{value_fmt}));
                    idx += 1;
                    args_idx += 1;
                },
                '#' => {
                    const test_index_str = bun.handleOom(std.fmt.allocPrint(allocator, "{d}", .{test_idx}));
                    defer allocator.free(test_index_str);
                    bun.handleOom(list.appendSlice(test_index_str));
                    idx += 1;
                },
                '%' => {
                    bun.handleOom(list.append('%'));
                    idx += 1;
                },
                else => {
                    // ignore unrecognized fmt
                },
            }
        } else bun.handleOom(list.append(char));
        idx += 1;
    }

    return list.toOwnedSlice();
}

pub fn captureTestLineNumber(callframe: *jsc.CallFrame, globalThis: *JSGlobalObject) u32 {
    if (Jest.runner) |runner| {
        if (runner.test_options.reporters.junit) {
            return bun.cpp.Bun__CallFrame__getLineNumber(callframe, globalThis);
        }
    }
    return 0;
}

pub fn errorInCI(globalObject: *jsc.JSGlobalObject, message: []const u8) bun.JSError!void {
    if (bun.detectCI()) |_| {
        return globalObject.throwPretty("{s}\nIf this is not a CI environment, set the environment variable CI=false to force allow.", .{message});
    }
}

const string = []const u8;

pub const bun_test = @import("./bun_test.zig");

const std = @import("std");
const CommandLineReporter = @import("../../cli/test_command.zig").CommandLineReporter;
const Snapshots = @import("./snapshot.zig").Snapshots;

const expect = @import("./expect.zig");
const Expect = expect.Expect;
const ExpectTypeOf = expect.ExpectTypeOf;

const bun = @import("bun");
const ArrayIdentityContext = bun.ArrayIdentityContext;
const Output = bun.Output;
const RegularExpression = bun.RegularExpression;
const default_allocator = bun.default_allocator;
const logger = bun.logger;

const jsc = bun.jsc;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const ZigString = jsc.ZigString;
