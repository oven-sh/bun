const Mode = enum { describe, @"test" };
mode: Mode,
cfg: describe2.BaseScopeCfg,
/// typically `.zero`. not Strong.Optional because codegen adds it to the visit function.
each: jsc.JSValue,
line_no: u32 = std.math.maxInt(u32),

pub fn getSkip(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_mode = .skip }, "get .skip", null);
}
pub fn getTodo(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_mode = .todo }, "get .todo", null);
}
pub fn getFailing(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_mode = .failing }, "get .failing", null);
}
pub fn getConcurrent(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_concurrent = true }, "get .concurrent", null);
}
pub fn getOnly(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_only = true }, "get .only", null);
}
pub fn fnIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    return genericIf(this, globalThis, callFrame, .{ .self_mode = .skip }, "call .if()", true);
}
pub fn fnSkipIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    return genericIf(this, globalThis, callFrame, .{ .self_mode = .skip }, "call .skipIf()", false);
}
pub fn fnTodoIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    return genericIf(this, globalThis, callFrame, .{ .self_mode = .todo }, "call .todoIf()", false);
}
pub fn fnFailingIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    return genericIf(this, globalThis, callFrame, .{ .self_mode = .failing }, "call .failingIf()", false);
}
pub fn fnConcurrentIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    return genericIf(this, globalThis, callFrame, .{ .self_concurrent = true }, "call .concurrentIf()", false);
}
pub fn fnEach(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    const array = callFrame.argumentsAsArray(1)[0];
    if (array.isUndefinedOrNull() or !array.isArray()) {
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
        defer formatter.deinit();
        return globalThis.throw("Expected array, got {}", .{array.toFmt(&formatter)});
    }

    if (this.each != .zero) return globalThis.throw("Cannot {s} on {f}", .{ "each", this });
    return create(globalThis, this.mode, array, this.cfg, this.maybeCaptureLineNumber(globalThis, callFrame));
}

pub fn maybeCaptureLineNumber(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) u32 {
    var line_no = this.line_no;
    if (line_no == std.math.maxInt(u32)) {
        line_no = jsc.Jest.captureTestLineNumber(callFrame, globalThis);
    }
    return line_no;
}

pub fn callAsFunction(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    const this = ScopeFunctions.fromJS(callFrame.callee()) orelse return globalThis.throw("Expected callee to be ScopeFunctions", .{});

    const bunTest = try describe2.js_fns.getActive(globalThis, .{ .signature = .{ .scope_functions = this }, .allow_in_preload = false });

    const callback_mode: CallbackMode = switch (this.cfg.self_mode) {
        .skip => .ignore,
        .todo => blk: {
            const run_todo = if (bun.jsc.Jest.Jest.runner) |runner| runner.run_todo else false;
            break :blk if (run_todo) .allow else .ignore;
        },
        else => .require,
    };

    var args = try parseArguments(globalThis, callFrame, .{ .scope_functions = this }, bunTest.gpa, .{ .callback = callback_mode });
    defer args.deinit(bunTest.gpa);

    const line_no = this.maybeCaptureLineNumber(globalThis, callFrame);

    const callback_length = if (args.callback) |callback| try callback.getLength(globalThis) else 0;

    if (this.each != .zero) {
        if (this.each.isUndefinedOrNull() or !this.each.isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
            defer formatter.deinit();
            return globalThis.throw("Expected array, got {}", .{this.each.toFmt(&formatter)});
        }
        var iter = try this.each.arrayIterator(globalThis);
        var test_idx: usize = 0;
        while (try iter.next()) |item| : (test_idx += 1) {
            if (item == .zero) break;

            var callback: ?describe2.CallbackWithArgs = if (args.callback) |callback| .init(bunTest.gpa, callback, &.{}) else null;
            defer if (callback) |*cb| cb.deinit(bunTest.gpa);

            if (item.isArray()) {
                // Spread array as args (matching Jest & Vitest)
                if (callback) |*c| c.args.ensureUnusedCapacity(bunTest.gpa, try item.getLength(globalThis));

                var item_iter = try item.arrayIterator(globalThis);
                var idx: usize = 0;
                while (try item_iter.next()) |array_item| : (idx += 1) {
                    if (callback) |*c| c.args.append(bunTest.gpa, array_item);
                }
            } else {
                if (callback) |*c| c.args.append(bunTest.gpa, item);
            }

            const formatted_label: ?[]const u8 = if (args.description) |desc| try jsc.Jest.formatLabel(globalThis, desc, if (callback) |*c| c.args.get() else &.{}, test_idx, bunTest.gpa) else null;
            defer if (formatted_label) |label| bunTest.gpa.free(label);

            try this.enqueueDescribeOrTestCallback(bunTest, globalThis, callFrame, callback, formatted_label, line_no, args.options.timeout, callback_length);
        }
    } else {
        var callback: ?describe2.CallbackWithArgs = if (args.callback) |callback| .init(bunTest.gpa, callback, &.{}) else null;
        defer if (callback) |*cb| cb.deinit(bunTest.gpa);

        try this.enqueueDescribeOrTestCallback(bunTest, globalThis, callFrame, callback, args.description, line_no, args.options.timeout, callback_length);
    }

    return .js_undefined;
}

fn enqueueDescribeOrTestCallback(this: *ScopeFunctions, bunTest: *describe2.BunTest, globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame, callback: ?describe2.CallbackWithArgs, description: ?[]const u8, line_no: u32, timeout: u32, callback_length: usize) bun.JSError!void {
    groupLog.begin(@src());
    defer groupLog.end();

    // only allow in collection phase
    switch (bunTest.phase) {
        .collection => {}, // ok
        .execution => return globalThis.throw("TODO: support calling {}() inside a test", .{this}),
        .done => return globalThis.throw("Cannot call {}() after the test run has completed", .{this}),
    }

    // handle test reporter agent for debugger
    const vm = globalThis.bunVM();
    var test_id_for_debugger: i32 = 0;
    if (vm.debugger) |*debugger| {
        if (debugger.test_reporter_agent.isEnabled()) {
            const globals = struct {
                var max_test_id_for_debugger: i32 = 0;
            };
            globals.max_test_id_for_debugger += 1;
            var name = bun.String.init(description orelse "(unnamed)");
            const parent = bunTest.collection.active_scope;
            const parent_id = if (parent.base.test_id_for_debugger != 0) parent.base.test_id_for_debugger else -1;
            debugger.test_reporter_agent.reportTestFound(callFrame, globals.max_test_id_for_debugger, &name, switch (this.mode) {
                .describe => .describe,
                .@"test" => .@"test",
            }, parent_id);
            test_id_for_debugger = globals.max_test_id_for_debugger;
        }
    }
    const has_done_parameter = if (callback) |*c| callback_length > c.args.get().len else false;

    var base = this.cfg;
    base.test_id_for_debugger = test_id_for_debugger;

    switch (this.mode) {
        .describe => {
            const new_scope = try bunTest.collection.active_scope.appendDescribe(bunTest.gpa, description, this.cfg);
            try bunTest.collection.enqueueDescribeCallback(new_scope, callback);
        },
        .@"test" => {

            // check for filter match
            var matches_filter = true;
            if (bunTest.reporter) |reporter| if (reporter.jest.filter_regex) |filter_regex| {
                bun.assert(bunTest.collection.filter_buffer.items.len == 0);
                defer bunTest.collection.filter_buffer.clearRetainingCapacity();

                var parent: ?*describe2.DescribeScope = bunTest.collection.active_scope;
                while (parent) |scope| : (parent = scope.base.parent) {
                    try bunTest.collection.filter_buffer.appendSlice(scope.base.name orelse "");
                    try bunTest.collection.filter_buffer.append(' ');
                }
                try bunTest.collection.filter_buffer.appendSlice(description orelse "");

                const str = bun.String.fromBytes(bunTest.collection.filter_buffer.items);
                matches_filter = filter_regex.matches(str);
            };

            if (!matches_filter) {
                base.self_mode = .filtered_out;
            }

            bun.assert(!bunTest.collection.locked);
            groupLog.log("enqueueTestCallback / {s} / in scope: {s}", .{ description orelse "(unnamed)", bunTest.collection.active_scope.base.name orelse "(unnamed)" });

            _ = try bunTest.collection.active_scope.appendTest(bunTest.gpa, description, if (matches_filter) callback else null, .{
                .line_no = line_no,
                .has_done_parameter = has_done_parameter,
                .timeout = timeout,
            }, base);
        },
    }
}

fn genericIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame, cfg: describe2.BaseScopeCfg, name: []const u8, invert: bool) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    const args = callFrame.arguments();
    if (args.len != 1) return globalThis.throw("Expected 1 argument to {s}, got {d}", .{ name, args.len });
    const condition = args[0];
    const cond = condition.toBoolean();
    if (cond != invert) {
        return genericExtend(this, globalThis, cfg, name, this.maybeCaptureLineNumber(globalThis, callFrame));
    } else {
        return create(globalThis, this.mode, this.each, this.cfg, this.maybeCaptureLineNumber(globalThis, callFrame));
    }
}
fn genericExtend(this: *ScopeFunctions, globalThis: *JSGlobalObject, cfg: describe2.BaseScopeCfg, name: []const u8, line_no: ?u32) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    if (cfg.self_mode == .failing and this.mode == .describe) return globalThis.throw("Cannot {s} on {f}", .{ name, this });
    if (cfg.self_only) try errorInCI(globalThis, ".only");
    const extended = this.cfg.extend(cfg) orelse return globalThis.throw("Cannot {s} on {f}", .{ name, this });
    return create(globalThis, this.mode, this.each, extended, line_no);
}

fn errorInCI(globalThis: *jsc.JSGlobalObject, signature: []const u8) bun.JSError!void {
    if (!bun.FeatureFlags.breaking_changes_1_3) return; // this is a breaking change for version 1.3
    if (bun.detectCI()) |_| {
        return globalThis.throwPretty("{s} is not allowed in CI environments.\nIf this is not a CI environment, set the environment variable CI=false to force allow.", .{signature});
    }
}

const ParseArgumentsResult = struct {
    description: ?[]const u8,
    callback: ?jsc.JSValue,
    options: struct {
        timeout: u32 = std.math.maxInt(u32),
        retry: ?f64 = null, // TODO: use this value
        repeats: ?f64 = null, // TODO: use this value
    },
    pub fn deinit(this: *ParseArgumentsResult, gpa: std.mem.Allocator) void {
        if (this.description) |str| gpa.free(str);
    }
};
pub const CallbackMode = enum { require, allow, ignore };

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

pub fn parseArguments(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, signature: Signature, gpa: std.mem.Allocator, cfg: struct { callback: CallbackMode }) bun.JSError!ParseArgumentsResult {
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
    errdefer result.deinit(gpa);

    var timeout_option: ?f64 = null;

    if (options.isNumber()) {
        timeout_option = options.asNumber();
    } else if (options.isObject()) {
        if (try options.get(globalThis, "timeout")) |timeout| {
            if (!timeout.isNumber()) {
                return globalThis.throwPretty("{s} expects timeout to be a number", .{signature});
            }
            timeout_option = timeout.asNumber();
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

    result.description = if (description.isUndefinedOrNull()) null else try getDescription(gpa, globalThis, description, signature);

    const default_timeout_ms = if (bun.jsc.Jest.Jest.runner) |runner| runner.default_timeout_ms else std.math.maxInt(u32);
    const override_timeout_ms = if (bun.jsc.Jest.Jest.runner) |runner| runner.default_timeout_override else std.math.maxInt(u32);
    const final_default_timeout_ms = if (override_timeout_ms != std.math.maxInt(u32)) override_timeout_ms else default_timeout_ms;
    result.options.timeout = std.math.lossyCast(u32, timeout_option orelse @as(f64, @floatFromInt(final_default_timeout_ms)));

    return result;
}

pub const js = jsc.Codegen.JSScopeFunctions;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub fn format(this: ScopeFunctions, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
    try writer.print("{s}", .{@tagName(this.mode)});
    if (this.cfg.self_concurrent) try writer.print(".concurrent", .{});
    if (this.cfg.self_mode != .normal) try writer.print(".{s}", .{@tagName(this.cfg.self_mode)});
    if (this.cfg.self_only) try writer.print(".only", .{});
    if (this.each != .zero) try writer.print(".each()", .{});
}

pub fn finalize(
    this: *ScopeFunctions,
) callconv(.C) void {
    groupLog.begin(@src());
    defer groupLog.end();

    VirtualMachine.get().allocator.destroy(this);
}

pub fn create(globalThis: *JSGlobalObject, mode: Mode, each: jsc.JSValue, cfg: describe2.BaseScopeCfg, line_no: ?u32) JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    var scope_functions = globalThis.bunVM().allocator.create(ScopeFunctions) catch bun.outOfMemory();
    scope_functions.* = .{ .mode = mode, .cfg = cfg, .each = each, .line_no = line_no orelse std.math.maxInt(u32) };

    const value = scope_functions.toJS(globalThis);
    value.ensureStillAlive();
    return value;
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const Strong = jsc.Strong.Safe;

const describe2 = jsc.Jest.describe2;
const BunTest = describe2.BunTest;
const ScopeFunctions = describe2.ScopeFunctions;
const Signature = describe2.js_fns.Signature;
const groupLog = describe2.debug.group;
