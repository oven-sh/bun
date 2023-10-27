const Glob = @This();
const globImpl = @import("../../glob.zig");

const bun = @import("root").bun;
const string = bun.string;
const JSC = bun.JSC;
const ZigString = JSC.ZigString;
const Base = @import("../base.zig");
const getAllocator = Base.getAllocator;

pub usingnamespace JSC.Codegen.JSGlob;

pattern: []const u8,

pub fn constructor(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) ?*Glob {
    const alloc = getAllocator(globalThis);

    const arguments_ = callframe.arguments(1);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();
    const pat_arg = arguments.nextEat() orelse {
        globalThis.throw("Glob.constructor: expected 1 arguments, got 0", .{});
        return null;
    };

    if (!pat_arg.isString()) {
        globalThis.throw("Glob.constructor: first argument is not a string", .{});
        return null;
    }

    var pat_str: []u8 = pat_arg.getZigString(globalThis).toOwnedSlice(globalThis.bunVM().allocator) catch @panic("OOM");

    var glob = alloc.create(Glob) catch @panic("OOM");
    glob.* = .{
        .pattern = pat_str,
    };

    return glob;
}

pub fn finalize(
    this: *Glob,
) callconv(.C) void {
    const alloc = JSC.VirtualMachine.get().allocator;
    alloc.free(this.pattern);
    alloc.destroy(this);
}

pub fn match(this: *Glob, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const alloc = getAllocator(globalThis);

    const arguments_ = callframe.arguments(1);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();
    const str_arg = arguments.nextEat() orelse {
        globalThis.throw("Glob.match: expected 1 arguments, got 0", .{});
        return JSC.JSValue.jsUndefined();
    };

    if (!str_arg.isString()) {
        globalThis.throw("Glob.match: first argument is not a string", .{});
        return JSC.JSValue.jsUndefined();
    }

    var str = str_arg.toSlice(globalThis, alloc);
    defer str.deinit();

    return JSC.JSValue.jsBoolean(globImpl.match(this.pattern, str.slice()));
}
