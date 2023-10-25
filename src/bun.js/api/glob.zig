const Glob = @This();
const globImpl = @import("../../glob.zig");

const bun = @import("root").bun;
const string = bun.string;
const JSC = bun.JSC;
const ZigString = JSC.ZigString;
const Base = @import("../base.zig");
const getAllocator = Base.getAllocator;

pub usingnamespace JSC.Codegen.JSGlob;

pub fn constructor(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) ?*Glob {
    _ = callframe;
    const alloc = getAllocator(globalThis);

    var glob = alloc.create(Glob) catch @panic("OOM");
    glob.* = .{};
    return glob;
}

pub fn finalize(
    this: *Glob,
) callconv(.C) void {
    JSC.VirtualMachine.get().allocator.destroy(this);
}

pub fn testFunc(this: *Glob, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    _ = callframe;
    _ = this;
    const hello: []const u8 = "HELLO FROM ZIG!";
    var out = ZigString.init(hello);
    out.setOutputEncoding();

    return out.toValueGC(globalThis);
}
