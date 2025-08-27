const Mode = enum { describe, @"test" };
mode: Mode,
cfg: describe2.BaseScopeCfg,
/// typically `.zero`. not Strong.Optional because codegen adds it to the visit function.
each: jsc.JSValue,

pub fn getSkip(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_mode = .skip }, "get .skip");
}
pub fn getTodo(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_mode = .todo }, "get .todo");
}
pub fn getFailing(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_mode = .failing }, "get .failing");
}
pub fn getConcurrent(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_concurrent = true }, "get .concurrent");
}
pub fn getOnly(this: *ScopeFunctions, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return genericExtend(this, globalThis, .{ .self_only = true }, "get .only");
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
    return create(globalThis, this.mode, array, this.cfg);
}

pub fn callAsFunction(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    const this = ScopeFunctions.fromJS(callFrame.callee()) orelse return globalThis.throw("Expected callee to be ScopeFunctions", .{});

    const bunTest = try describe2.js_fns.getActive(globalThis, .{ .signature = .{ .scope_functions = this }, .allow_in_preload = false });

    const callback_mode: describe2.js_fns.CallbackMode = switch (this.cfg.self_mode) {
        .skip => .ignore,
        .todo => blk: {
            const run_todo = if (bun.jsc.Jest.Jest.runner) |runner| runner.run_todo else false;
            break :blk if (run_todo) .allow else .ignore;
        },
        else => .require,
    };

    var args = try describe2.js_fns.parseArguments(globalThis, callFrame, .{ .scope_functions = this }, bunTest, .{ .callback = callback_mode });
    defer args.deinit(bunTest.gpa);

    switch (bunTest.phase) {
        .collection => {}, // ok
        .execution => return globalThis.throw("TODO: support calling {}() inside a test", .{this}),
        .done => return globalThis.throw("Cannot call {}() after the test run has completed", .{this}),
    }

    const line_no = switch (this.mode) {
        .@"test" => jsc.Jest.captureTestLineNumber(callFrame, globalThis),
        else => 0,
    };

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

            if (item.isUndefinedOrNull() and item.isArray()) {
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

            try this.enqueueDescribeOrTestCallback(bunTest, callback, formatted_label, line_no);
        }
    } else {
        var callback: ?describe2.CallbackWithArgs = if (args.callback) |callback| .init(bunTest.gpa, callback, &.{}) else null;
        defer if (callback) |*cb| cb.deinit(bunTest.gpa);

        try this.enqueueDescribeOrTestCallback(bunTest, callback, args.description, line_no);
    }

    return .js_undefined;
}

fn enqueueDescribeOrTestCallback(this: *ScopeFunctions, bunTest: *describe2.BunTestFile, callback: ?describe2.CallbackWithArgs, description: ?[]const u8, line_no: u32) bun.JSError!void {
    switch (this.mode) {
        .describe => try bunTest.collection.enqueueDescribeCallback(callback, description, this.cfg),
        .@"test" => {
            try bunTest.collection.enqueueTestCallback(description, callback, .{
                .line_no = line_no,
            }, this.cfg);
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
        return genericExtend(this, globalThis, cfg, name);
    } else {
        return create(globalThis, this.mode, this.each, this.cfg);
    }
}
fn genericExtend(this: *ScopeFunctions, globalThis: *JSGlobalObject, cfg: describe2.BaseScopeCfg, name: []const u8) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    if (cfg.self_mode == .failing and this.mode == .describe) return globalThis.throw("Cannot {s} on {f}", .{ name, this });
    if (cfg.self_only) try errorInCI(globalThis, ".only");
    const extended = this.cfg.extend(cfg) orelse return globalThis.throw("Cannot {s} on {f}", .{ name, this });
    return create(globalThis, this.mode, this.each, extended);
}

fn errorInCI(globalThis: *jsc.JSGlobalObject, signature: []const u8) bun.JSError!void {
    if (!bun.FeatureFlags.breaking_changes_1_3) return; // this is a breaking change for version 1.3
    if (bun.detectCI()) |_| {
        return globalThis.throwPretty("{s} is not allowed in CI environments.\nIf this is not a CI environment, set the environment variable CI=false to force allow.", .{signature});
    }
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
    if (this.cfg.self_filter) try writer.print(".filter", .{});
    if (this.each != .zero) try writer.print(".each()", .{});
}

pub fn finalize(
    this: *ScopeFunctions,
) callconv(.C) void {
    groupLog.begin(@src());
    defer groupLog.end();

    VirtualMachine.get().allocator.destroy(this);
}

pub fn create(globalThis: *JSGlobalObject, mode: Mode, each: jsc.JSValue, cfg: describe2.BaseScopeCfg) JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    var scope_functions = globalThis.bunVM().allocator.create(ScopeFunctions) catch bun.outOfMemory();
    scope_functions.* = .{ .mode = mode, .cfg = cfg, .each = each };

    const value = scope_functions.toJS(globalThis);
    value.ensureStillAlive();
    return value;
}

const std = @import("std");
const test_command = @import("../../cli/test_command.zig");

const describe2 = @import("./describe2.zig");
const BunTestFile = describe2.BunTestFile;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const groupLog = describe2.group;
const ScopeFunctions = describe2.ScopeFunctions;

const bun = @import("bun");
const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const CallFrame = jsc.CallFrame;
const VirtualMachine = jsc.VirtualMachine;
const JSValue = jsc.JSValue;

const Strong = jsc.Strong.Safe;
