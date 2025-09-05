pub const Tag = enum(u3) {
    pass,
    fail,
    only,
    skip,
    todo,
    skipped_because_label,
};
const debug = Output.scoped(.jest, .visible);

var max_test_id_for_debugger: u32 = 0;

const CurrentFile = struct {
    title: string = "",
    prefix: string = "",
    repeat_info: struct {
        count: u32 = 0,
        index: u32 = 0,
    } = .{},
    has_printed_filename: bool = false,

    pub fn set(this: *CurrentFile, title: string, prefix: string, repeat_count: u32, repeat_index: u32) void {
        if (Output.isAIAgent()) {
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
        if (repeat_count > 0) {
            if (repeat_count > 1) {
                Output.prettyErrorln("<r>\n{s}{s}: <d>(run #{d})<r>\n", .{ prefix, title, repeat_index + 1 });
            } else {
                Output.prettyErrorln("<r>\n{s}{s}:\n", .{ prefix, title });
            }
        } else {
            Output.prettyErrorln("<r>\n{s}{s}:\n", .{ prefix, title });
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
    log: *logger.Log,
    files: File.List = .{},
    index: File.Map = File.Map{},
    only: bool = false,
    run_todo: bool = false,
    last_file: u64 = 0,
    bail: u32 = 0,

    allocator: std.mem.Allocator,

    drainer: jsc.AnyTask = undefined,

    has_pending_tests: bool = false,

    snapshots: Snapshots,

    default_timeout_ms: u32,

    // from `setDefaultTimeout() or jest.setTimeout()`
    default_timeout_override: u32 = std.math.maxInt(u32),

    test_options: *const bun.cli.Command.TestOptions = undefined,

    // Used for --test-name-pattern to reduce allocations
    filter_regex: ?*RegularExpression,

    unhandled_errors_between_tests: u32 = 0,
    summary: Summary = Summary{},

    describe2Root: describe2.BunTest,

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

    fn globalHook(comptime name: string) jsc.JSHostFnZig {
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
        return createTestModule(globalObject);
    }

    pub fn createTestModule(globalObject: *JSGlobalObject) JSValue {
        const module = JSValue.createEmptyObject(globalObject, 14);

        const test_scope_functions = describe2.ScopeFunctions.create(globalObject, .@"test", .zero, .{});
        module.put(globalObject, ZigString.static("test"), test_scope_functions);
        module.put(globalObject, ZigString.static("it"), test_scope_functions);

        const xtest_scope_functions = describe2.ScopeFunctions.create(globalObject, .@"test", .zero, .{ .self_mode = .skip });
        module.put(globalObject, ZigString.static("xtest"), xtest_scope_functions);
        module.put(globalObject, ZigString.static("xit"), xtest_scope_functions);

        const describe_scope_functions = describe2.ScopeFunctions.create(globalObject, .describe, .zero, .{});
        module.put(globalObject, ZigString.static("describe"), describe_scope_functions);

        const xdescribe_scope_functions = describe2.ScopeFunctions.create(globalObject, .describe, .zero, .{ .self_mode = .skip });
        module.put(globalObject, ZigString.static("xdescribe"), xdescribe_scope_functions);

        module.put(globalObject, ZigString.static("beforeEach"), jsc.host_fn.NewFunction(globalObject, ZigString.static("beforeEach"), 1, describe2.js_fns.genericHook(.beforeEach).hookFn, false));
        module.put(globalObject, ZigString.static("beforeAll"), jsc.host_fn.NewFunction(globalObject, ZigString.static("beforeAll"), 1, describe2.js_fns.genericHook(.beforeAll).hookFn, false));
        module.put(globalObject, ZigString.static("afterAll"), jsc.host_fn.NewFunction(globalObject, ZigString.static("afterAll"), 1, describe2.js_fns.genericHook(.afterAll).hookFn, false));
        module.put(globalObject, ZigString.static("afterEach"), jsc.host_fn.NewFunction(globalObject, ZigString.static("afterEach"), 1, describe2.js_fns.genericHook(.afterEach).hookFn, false));
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

        const vi = JSValue.createEmptyObject(globalObject, 5);
        vi.put(globalObject, ZigString.static("fn"), mockFn);
        vi.put(globalObject, ZigString.static("mock"), mockModuleFn);
        vi.put(globalObject, ZigString.static("spyOn"), spyOn);
        vi.put(globalObject, ZigString.static("restoreAllMocks"), restoreAllMocks);
        vi.put(globalObject, ZigString.static("clearAllMocks"), clearAllMocks);
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
        if (Jest.runner != null and Jest.runner.?.describe2Root.active_file != null) {
            var active_file = Jest.runner.?.describe2Root.active_file.?;
            return active_file.onUncaughtException(globalObject, rejection, true, active_file.getCurrentStateData());
        }

        jsc_vm.last_reported_error_for_dedupe = .zero;
        jsc_vm.runErrorHandlerWithDedupe(rejection, jsc_vm.onUnhandledRejectionExceptionList);
    }
};

pub const Result = union(TestRunner.Test.Status) {
    pending: void,
    pass: u32, // assertion count
    fail: u32,
    skip: void,
    todo: void,
    timeout: void,
    skipped_because_label: void,
    fail_because_failing_test_passed: u32,
    fail_because_todo_passed: u32,
    fail_because_expected_has_assertions: void,
    fail_because_expected_assertion_count: Counter,

    pub fn isSkipped(this: *const Result) bool {
        return switch (this.*) {
            .skip, .skipped_because_label => true,
            .todo => !Jest.runner.?.test_options.run_todo,
            else => false,
        };
    }

    pub fn isFailure(this: *const Result) bool {
        return this.* == .fail or this.* == .timeout or this.* == .fail_because_expected_has_assertions or this.* == .fail_because_expected_assertion_count;
    }

    pub fn forceTODO(this: Result, is_todo: bool) Result {
        if (is_todo and this == .pass)
            return .{ .fail_because_todo_passed = this.pass };

        if (is_todo and (this == .fail or this == .timeout)) {
            return .{ .todo = {} };
        }
        return this;
    }
};

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
        .skipped_because_label, .skip => .{ Scope.call, Scope.skip },
        .todo => .{ Scope.call, Scope.todo },
    };

    switch (@intFromBool(value)) {
        inline else => |index| return jsc.host_fn.NewFunction(globalThis, name, 2, truthy_falsey[index], false),
    }
}

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
                    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                    defer formatter.deinit();
                    bun.handleOom(list.writer().print("{}", .{value.toFmt(&formatter)}));
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

fn callJSFunctionForTestRunner(vm: *jsc.VirtualMachine, globalObject: *JSGlobalObject, function: JSValue, args: []const JSValue) JSValue {
    vm.eventLoop().enter();
    defer vm.eventLoop().exit();

    globalObject.clearTerminationException(); // TODO this is sus
    return function.call(globalObject, .js_undefined, args) catch |err| globalObject.takeException(err);
}

extern fn Bun__CallFrame__getLineNumber(callframe: *jsc.CallFrame, globalObject: *jsc.JSGlobalObject) u32;

pub fn captureTestLineNumber(callframe: *jsc.CallFrame, globalThis: *JSGlobalObject) u32 {
    if (Jest.runner) |runner| {
        if (runner.test_options.file_reporter == .junit) {
            return Bun__CallFrame__getLineNumber(callframe, globalThis);
        }
    }
    return 0;
}

const string = []const u8;

pub const describe2 = @import("./describe2.zig");

const std = @import("std");
const ObjectPool = @import("../../pool.zig").ObjectPool;
const Snapshots = @import("./snapshot.zig").Snapshots;

const expect = @import("./expect.zig");
const Counter = expect.Counter;
const Expect = expect.Expect;
const ExpectTypeOf = expect.ExpectTypeOf;

const bun = @import("bun");
const ArrayIdentityContext = bun.ArrayIdentityContext;
const Environment = bun.Environment;
const MutableString = bun.MutableString;
const Output = bun.Output;
const RegularExpression = bun.RegularExpression;
const assert = bun.assert;
const default_allocator = bun.default_allocator;
const logger = bun.logger;

const jsc = bun.jsc;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSInternalPromise = jsc.JSInternalPromise;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const ZigString = jsc.ZigString;
