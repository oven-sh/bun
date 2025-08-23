const Mode = enum { describe, @"test" };
mode: Mode,
cfg: describe2.BaseScopeCfg,
/// typically `.zero`
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
pub fn fnEach(_: *ScopeFunctions, _: *JSGlobalObject, _: *CallFrame) bun.JSError!JSValue {
    @panic("TODO: implement .each()");
}

pub fn callAsFunction(_: *ScopeFunctions, _: *JSGlobalObject, _: *CallFrame) bun.JSError!JSValue {
    @panic("TODO: call ScopeFunctions");
}

fn genericIf(this: *ScopeFunctions, globalThis: *JSGlobalObject, callFrame: *CallFrame, cfg: describe2.BaseScopeCfg, name: []const u8, invert: bool) bun.JSError!JSValue {
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
    if (cfg.self_concurrent and this.mode == .describe) return globalThis.throw("Cannot {s} on {f}", .{ name, this });
    const extended = this.cfg.extend(cfg) orelse return globalThis.throw("Cannot {s} on {f}", .{ name, this });
    return create(globalThis, this.mode, this.each, extended);
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
    VirtualMachine.get().allocator.destroy(this);
}

pub fn create(globalThis: *JSGlobalObject, mode: Mode, each: jsc.JSValue, cfg: describe2.BaseScopeCfg) JSValue {
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
