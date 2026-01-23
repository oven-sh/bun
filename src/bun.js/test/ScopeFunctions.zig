const Mode = enum { describe, @"test" };
mode: Mode,
cfg: bun_test.BaseScopeCfg,
/// typically `.zero`. not Strong.Optional because codegen adds it to the visit function.
each: jsc.JSValue,

pub const strings = struct {
    pub const describe = bun.String.static("describe");
    pub const xdescribe = bun.String.static("xdescribe");
    pub const @"test" = bun.String.static("test");
    pub const xtest = bun.String.static("xtest");
    pub const skip = bun.String.static("skip");
    pub const todo = bun.String.static("todo");
    pub const failing = bun.String.static("failing");
    pub const concurrent = bun.String.static("concurrent");
    pub const serial = bun.String.static("serial");
    pub const only = bun.String.static("only");
    pub const @"if" = bun.String.static("if");
    pub const skipIf = bun.String.static("skipIf");
    pub const todoIf = bun.String.static("todoIf");
    pub const failingIf = bun.String.static("failingIf");
    pub const concurrentIf = bun.String.static("concurrentIf");
    pub const serialIf = bun.String.static("serialIf");
    pub const each = bun.String.static("each");
};

pub fn getSkip(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_mode = .skip }, "get .skip", strings.skip);
}
pub fn getTodo(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_mode = .todo }, "get .todo", strings.todo);
}
pub fn getFailing(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_mode = .failing }, "get .failing", strings.failing);
}
pub fn getConcurrent(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_concurrent = .yes }, "get .concurrent", strings.concurrent);
}
pub fn getSerial(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_concurrent = .no }, "get .serial", strings.serial);
}
pub fn getOnly(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_only = true }, "get .only", strings.only);
}
pub fn fnIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    return genericIf(this, globalThis, callFrame, .{ .self_mode = .skip }, "call .if()", true, strings.@"if");
}
pub fn fnSkipIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    return genericIf(this, globalThis, callFrame, .{ .self_mode = .skip }, "call .skipIf()", false, strings.skipIf);
}
pub fn fnTodoIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    return genericIf(this, globalThis, callFrame, .{ .self_mode = .todo }, "call .todoIf()", false, strings.todoIf);
}
pub fn fnFailingIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    return genericIf(this, globalThis, callFrame, .{ .self_mode = .failing }, "call .failingIf()", false, strings.failingIf);
}
pub fn fnConcurrentIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    return genericIf(this, globalThis, callFrame, .{ .self_concurrent = .yes }, "call .concurrentIf()", false, strings.concurrentIf);
}
pub fn fnSerialIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    return genericIf(this, globalThis, callFrame, .{ .self_concurrent = .no }, "call .serialIf()", false, strings.serialIf);
}
pub fn fnEach(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    const array = callFrame.argumentsAsArray(1)[0];
    if (array.isUndefinedOrNull() or !array.isArray()) {
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
        defer formatter.deinit();
        return globalThis.throw("Expected array, got {f}", .{array.toFmt(&formatter)});
    }

    if (this.each != .zero) return globalThis.throw("Cannot {s} on {f}", .{ "each", this });
    return createBound(globalThis, this.mode, array, this.cfg, strings.each);
}

pub fn callAsFunction(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    const this = ScopeFunctions.fromJS(callFrame.this()) orelse return globalThis.throw("Expected callee to be ScopeFunctions", .{});
    const line_no = jsc.Jest.captureTestLineNumber(callFrame, globalThis);

    var buntest_strong = try bun_test.js_fns.cloneActiveStrong(globalThis, .{ .signature = .{ .scope_functions = this }, .allow_in_preload = false });
    defer buntest_strong.deinit();
    const bunTest = buntest_strong.get();

    const callback_mode: CallbackMode = switch (this.cfg.self_mode) {
        .skip, .todo => .allow,
        else => .require,
    };

    var args = try parseArguments(globalThis, callFrame, .{ .scope_functions = this }, bunTest.gpa, .{ .callback = callback_mode });
    defer args.deinit(bunTest.gpa);

    const callback_length = if (args.callback) |callback| try callback.getLength(globalThis) else 0;

    if (this.each != .zero) {
        if (this.each.isUndefinedOrNull() or !this.each.isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
            defer formatter.deinit();
            return globalThis.throw("Expected array, got {f}", .{this.each.toFmt(&formatter)});
        }
        var iter = try this.each.arrayIterator(globalThis);
        var test_idx: usize = 0;
        while (try iter.next()) |item| : (test_idx += 1) {
            if (item == .zero) break;

            var args_list: std.array_list.Managed(Strong) = .init(bunTest.gpa);
            defer args_list.deinit();
            defer for (args_list.items) |*arg| arg.deinit();

            if (item.isArray()) {
                // Spread array as args_list (matching Jest & Vitest)
                bun.handleOom(args_list.ensureUnusedCapacity(try item.getLength(globalThis)));

                var item_iter = try item.arrayIterator(globalThis);
                var idx: usize = 0;
                while (try item_iter.next()) |array_item| : (idx += 1) {
                    bun.handleOom(args_list.append(.init(bunTest.gpa, array_item)));
                }
            } else {
                bun.handleOom(args_list.append(.init(bunTest.gpa, item)));
            }

            var args_list_raw = bun.handleOom(std.array_list.Managed(jsc.JSValue).initCapacity(bunTest.gpa, args_list.items.len)); // safe because the items are held strongly in args_list
            defer args_list_raw.deinit();
            for (args_list.items) |arg| bun.handleOom(args_list_raw.append(arg.get()));

            const formatted_label: ?[]const u8 = if (args.description) |desc| try jsc.Jest.formatLabel(globalThis, desc, args_list_raw.items, test_idx, bunTest.gpa) else null;
            defer if (formatted_label) |label| bunTest.gpa.free(label);

            const bound = if (args.callback) |cb| try cb.bind(globalThis, item, &bun.String.static("cb"), 0, args_list_raw.items) else null;
            try this.enqueueDescribeOrTestCallback(bunTest, globalThis, callFrame, bound, formatted_label, args.options, callback_length -| args_list.items.len, line_no);
        }
    } else {
        try this.enqueueDescribeOrTestCallback(bunTest, globalThis, callFrame, args.callback, args.description, args.options, callback_length, line_no);
    }

    return .js_undefined;
}

const Measure = struct {
    len: usize,
    fn writeEnd(this: *Measure, write: []const u8) void {
        this.len += write.len;
    }
};
const Write = struct {
    buf: []u8,
    fn writeEnd(this: *Write, write: []const u8) void {
        if (this.buf.len < write.len) {
            bun.debugAssert(false);
            return;
        }
        @memcpy(this.buf[this.buf.len - write.len ..], write);
        this.buf = this.buf[0 .. this.buf.len - write.len];
    }
};
fn filterNames(comptime Rem: type, rem: *Rem, description: ?[]const u8, parent_in: ?*bun_test.DescribeScope) void {
    const sep = " ";
    rem.writeEnd(description orelse "");
    var parent = parent_in;
    while (parent) |scope| : (parent = scope.base.parent) {
        if (scope.base.name == null) continue;
        rem.writeEnd(sep);
        rem.writeEnd(scope.base.name orelse "");
    }
}

fn enqueueDescribeOrTestCallback(this: *ScopeFunctions, bunTest: *bun_test.BunTest, globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame, callback: ?jsc.JSValue, description: ?[]const u8, options: ParseArgumentsOptions, callback_length: usize, line_no: u32) bun.JSError!void {
    groupLog.begin(@src());
    defer groupLog.end();

    // only allow in collection phase
    switch (bunTest.phase) {
        .collection => {}, // ok
        .execution => return globalThis.throw("Cannot call {f}() inside a test. Call it inside describe() instead.", .{this}),
        .done => return globalThis.throw("Cannot call {f}() after the test run has completed", .{this}),
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
    const has_done_parameter = if (callback != null) callback_length >= 1 else false;

    var base = this.cfg;
    base.line_no = line_no;
    base.test_id_for_debugger = test_id_for_debugger;
    // Use the file's default concurrent setting (determined once when entering the file)
    // or the global concurrent flag from the runner
    if (bunTest.default_concurrent or (bun.jsc.Jest.Jest.runner != null and bun.jsc.Jest.Jest.runner.?.concurrent)) {
        // Only set to concurrent if still inheriting
        if (base.self_concurrent == .inherit) {
            base.self_concurrent = .yes;
        }
    }

    switch (this.mode) {
        .describe => {
            const new_scope = try bunTest.collection.active_scope.appendDescribe(bunTest.gpa, description, base);
            try bunTest.collection.enqueueDescribeCallback(new_scope, callback);
        },
        .@"test" => {

            // check for filter match
            var matches_filter = true;
            if (bunTest.reporter) |reporter| if (reporter.jest.filter_regex) |filter_regex| {
                groupLog.log("matches_filter begin", .{});
                bun.assert(bunTest.collection.filter_buffer.items.len == 0);
                defer bunTest.collection.filter_buffer.clearRetainingCapacity();

                var len: Measure = .{ .len = 0 };
                filterNames(Measure, &len, description, bunTest.collection.active_scope);
                const slice = try bunTest.collection.filter_buffer.addManyAsSlice(len.len);
                var rem: Write = .{ .buf = slice };
                filterNames(Write, &rem, description, bunTest.collection.active_scope);
                bun.debugAssert(rem.buf.len == 0);

                const str = bun.String.fromBytes(bunTest.collection.filter_buffer.items);
                groupLog.log("matches_filter \"{f}\"", .{std.zig.fmtString(bunTest.collection.filter_buffer.items)});
                matches_filter = filter_regex.matches(str);
            };

            if (!matches_filter) {
                base.self_mode = .filtered_out;
            }

            bun.assert(!bunTest.collection.locked);
            groupLog.log("enqueueTestCallback / {s} / in scope: {s}", .{ description orelse "(unnamed)", bunTest.collection.active_scope.base.name orelse "(unnamed)" });

            _ = try bunTest.collection.active_scope.appendTest(bunTest.gpa, description, if (matches_filter) callback else null, .{
                .has_done_parameter = has_done_parameter,
                .timeout = options.timeout,
                .retry_count = options.retry,
                .repeat_count = options.repeats,
            }, base, .collection);
        },
    }
}

fn genericIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame, conditional_cfg: bun_test.BaseScopeCfg, name: []const u8, invert: bool, fn_name: bun.String) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    const condition = callFrame.argumentsAsArray(1)[0];
    if (callFrame.arguments().len == 0) return globalThis.throw("Expected condition to be a boolean", .{});
    const cond = condition.toBoolean();
    if (cond != invert) {
        return genericExtend(this, globalThis, conditional_cfg, name, fn_name);
    } else {
        return createBound(globalThis, this.mode, this.each, this.cfg, fn_name);
    }
}
fn genericExtend(this: *ScopeFunctions, globalThis: *JSGlobalObject, cfg: bun_test.BaseScopeCfg, name: []const u8, fn_name: bun.String) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    if (cfg.self_mode == .failing and this.mode == .describe) return globalThis.throw("Cannot {s} on {f}", .{ name, this });
    if (cfg.self_only) try errorInCI(globalThis, ".only");
    const extended = this.cfg.extend(cfg) orelse return globalThis.throw("Cannot {s} on {f}", .{ name, this });
    return createBound(globalThis, this.mode, this.each, extended, fn_name);
}

fn errorInCI(globalThis: *jsc.JSGlobalObject, signature: []const u8) bun.JSError!void {
    if (bun.ci.isCI()) {
        return globalThis.throwPretty("{s} is disabled in CI environments to prevent accidentally skipping tests. To override, set the environment variable CI=false.", .{signature});
    }
}

const ParseArgumentsResult = struct {
    description: ?[]const u8,
    callback: ?jsc.JSValue,
    options: ParseArgumentsOptions,
    pub fn deinit(this: *ParseArgumentsResult, gpa: std.mem.Allocator) void {
        if (this.description) |str| gpa.free(str);
    }
};
const ParseArgumentsOptions = struct {
    timeout: u32 = 0,
    retry: u32 = 0,
    repeats: u32 = 0,
};
pub const CallbackMode = enum { require, allow };
pub const FunctionKind = enum { test_or_describe, hook };

fn getDescription(gpa: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, description: jsc.JSValue, signature: Signature) bun.JSError![]const u8 {
    if (description == .zero) {
        return "";
    }

    if (description.isClass(globalThis)) {
        var description_class_name = try description.className(globalThis);

        if (description_class_name.len > 0) {
            return description_class_name.toOwnedSlice(gpa);
        }

        var description_name = try description.getName(globalThis);
        defer description_name.deref();
        return description_name.toOwnedSlice(gpa);
    }

    if (description.isFunction()) {
        const func_name = try description.getName(globalThis);
        if (func_name.length() > 0) {
            return func_name.toOwnedSlice(gpa);
        }
    }

    if (description.isNumber() or description.isString()) {
        var slice = try description.toSlice(globalThis, gpa);
        return slice.intoOwnedSlice(gpa);
    }

    return globalThis.throwPretty("{f}() expects first argument to be a named class, named function, number, or string", .{signature});
}

pub fn parseArguments(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, signature: Signature, gpa: std.mem.Allocator, cfg: struct { callback: CallbackMode, kind: FunctionKind = .test_or_describe }) bun.JSError!ParseArgumentsResult {
    var a1, var a2, var a3 = callframe.argumentsAsArray(3);

    const len: enum { three, two, one, zero } = if (!a3.isUndefinedOrNull()) .three else if (!a2.isUndefinedOrNull()) .two else if (!a1.isUndefinedOrNull()) .one else .zero;
    const DescriptionCallbackOptions = struct { description: JSValue = .js_undefined, callback: JSValue = .js_undefined, options: JSValue = .js_undefined };
    const items: DescriptionCallbackOptions = switch (len) {
        // description, callback(fn), options(!fn)
        // description, options(!fn), callback(fn)
        .three => if (a2.isFunction()) .{ .description = a1, .callback = a2, .options = a3 } else .{ .description = a1, .callback = a3, .options = a2 },
        // callback(fn), options(!fn)
        // description, callback(fn)
        .two => if (a1.isFunction() and !a2.isFunction()) .{ .callback = a1, .options = a2 } else .{ .description = a1, .callback = a2 },
        // description
        // callback(fn)
        .one => if (a1.isFunction()) .{ .callback = a1 } else .{ .description = a1 },
        .zero => .{},
    };
    const description, const callback, const options = .{ items.description, items.callback, items.options };

    const result_callback: ?jsc.JSValue = if (cfg.callback != .require and callback.isUndefinedOrNull()) blk: {
        break :blk null;
    } else if (callback.isFunction()) blk: {
        break :blk callback.withAsyncContextIfNeeded(globalThis);
    } else {
        const ordinal = if (cfg.kind == .hook) "first" else "second";
        return globalThis.throw("{f} expects a function as the {s} argument", .{ signature, ordinal });
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
    } else if (options.isFunction()) {
        return globalThis.throw("{f}() expects options to be a number or object, not a function", .{signature});
    } else if (options.isObject()) {
        if (try options.get(globalThis, "timeout")) |timeout| {
            if (!timeout.isNumber()) {
                return globalThis.throwPretty("{f}() expects timeout to be a number", .{signature});
            }
            timeout_option = timeout.asNumber();
        }
        if (try options.get(globalThis, "retry")) |retries| {
            if (!retries.isNumber()) {
                return globalThis.throwPretty("{f}() expects retry to be a number", .{signature});
            }
            result.options.retry = std.math.lossyCast(u32, retries.asNumber());
        }
        if (try options.get(globalThis, "repeats")) |repeats| {
            if (!repeats.isNumber()) {
                return globalThis.throwPretty("{f}() expects repeats to be a number", .{signature});
            }
            if (result.options.retry != 0) {
                return globalThis.throwPretty("{f}(): Cannot set both retry and repeats", .{signature});
            }
            result.options.repeats = std.math.lossyCast(u32, repeats.asNumber());
        }
    } else if (options.isUndefinedOrNull()) {
        // no options
    } else {
        return globalThis.throw("{f}() expects a number, object, or undefined as the third argument", .{signature});
    }

    result.description = if (description.isUndefinedOrNull()) null else try getDescription(gpa, globalThis, description, signature);

    const default_timeout_ms: ?u32 = if (bun.jsc.Jest.Jest.runner) |runner| if (runner.default_timeout_ms != 0) runner.default_timeout_ms else null else null;
    const override_timeout_ms: ?u32 = if (bun.jsc.Jest.Jest.runner) |runner| if (runner.default_timeout_override != std.math.maxInt(u32)) runner.default_timeout_override else null else null;
    const timeout_option_ms: ?u32 = if (timeout_option) |timeout| std.math.lossyCast(u32, timeout) else null;
    result.options.timeout = timeout_option_ms orelse override_timeout_ms orelse default_timeout_ms orelse 0;

    return result;
}

pub const js = jsc.Codegen.JSScopeFunctions;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub fn format(this: ScopeFunctions, writer: *std.Io.Writer) !void {
    try writer.print("{s}", .{@tagName(this.mode)});
    switch (this.cfg.self_concurrent) {
        .yes => try writer.print(".concurrent", .{}),
        .no => try writer.print(".serial", .{}),
        .inherit => {},
    }
    if (this.cfg.self_mode != .normal) try writer.print(".{s}", .{@tagName(this.cfg.self_mode)});
    if (this.cfg.self_only) try writer.print(".only", .{});
    if (this.each != .zero) try writer.print(".each()", .{});
}

pub fn finalize(
    this: *ScopeFunctions,
) callconv(.c) void {
    groupLog.begin(@src());
    defer groupLog.end();

    VirtualMachine.get().allocator.destroy(this);
}

pub fn createUnbound(globalThis: *JSGlobalObject, mode: Mode, each: jsc.JSValue, cfg: bun_test.BaseScopeCfg) JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    var scope_functions = bun.handleOom(globalThis.bunVM().allocator.create(ScopeFunctions));
    scope_functions.* = .{ .mode = mode, .cfg = cfg, .each = each };

    const value = scope_functions.toJS(globalThis);
    value.ensureStillAlive();
    return value;
}

pub fn bind(value: JSValue, globalThis: *JSGlobalObject, name: bun.String) bun.JSError!JSValue {
    const callFn = jsc.JSFunction.create(globalThis, name, callAsFunction, 1, .{});
    const bound = try callFn.bind(globalThis, value, &name, 1, &.{});
    try bound.setPrototypeDirect(value.getPrototype(globalThis), globalThis);
    return bound;
}

pub fn createBound(globalThis: *JSGlobalObject, mode: Mode, each: jsc.JSValue, cfg: bun_test.BaseScopeCfg, name: bun.String) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    const value = createUnbound(globalThis, mode, each, cfg);
    return bind(value, globalThis, name);
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const Strong = jsc.Strong.Deprecated;

const bun_test = jsc.Jest.bun_test;
const BunTest = bun_test.BunTest;
const ScopeFunctions = bun_test.ScopeFunctions;
const Signature = bun_test.js_fns.Signature;
const groupLog = bun_test.debug.group;
