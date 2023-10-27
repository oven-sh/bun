const Glob = @This();
const globImpl = @import("../../glob.zig");

const PatternError = globImpl.PatternError;
const Pattern = globImpl.Pattern;

const bun = @import("root").bun;
const string = bun.string;
const JSC = bun.JSC;
const ZigString = JSC.ZigString;
const Base = @import("../base.zig");
const getAllocator = Base.getAllocator;

pub usingnamespace JSC.Codegen.JSGlob;

pattern: Pattern,

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

    // var pat_str: []u8 = pat_arg.toOwnedSlice(globalThis, globalThis.bunVM().allocator);
    var pat_str: []u8 = pat_arg.getZigString(globalThis).toOwnedSlice(globalThis.bunVM().allocator) catch @panic("OOM");

    var err_pos: u32 = 0;
    const pattern = pattern: {
        if (Pattern.new(alloc, pat_str, &err_pos)) |p| {
            break :pattern p;
        } else |err| {
            defer alloc.free(pat_str);
            switch (err) {
                PatternError.InvalidRange, PatternError.RecursiveWildcards, PatternError.Wildcards => |p| {
                    globalThis.throw("Failed to compile pattern: {s}", .{globImpl.patternErrorString(p)});
                    return null;
                },
                else => {},
            }
            globalThis.throwError(err, "Failed to create glob pattern.");
            return null;
        }
    };

    var glob = alloc.create(Glob) catch @panic("OOM");
    glob.* = .{
        .pattern = pattern,
    };

    return glob;
}

pub fn finalize(
    this: *Glob,
) callconv(.C) void {
    const alloc = JSC.VirtualMachine.get().allocator;
    this.pattern.deinit(alloc);
    alloc.destroy(this);
}

pub fn match(this: *Glob, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const alloc = getAllocator(globalThis);

    const arguments_ = callframe.arguments(1);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();
    const pat_arg = arguments.nextEat() orelse {
        globalThis.throw("Glob.match: expected 1 arguments, got 0", .{});
        return JSC.JSValue.jsUndefined();
    };

    if (!pat_arg.isString()) {
        globalThis.throw("Glob.match: first argument is not a string", .{});
        return JSC.JSValue.jsUndefined();
    }

    var pat_str = pat_arg.toSlice(globalThis, alloc);
    defer pat_str.deinit();

    return JSC.JSValue.jsBoolean(this.pattern.matchWith(pat_str.slice(), .{}));
}

// pub fn globMatch(
//     globalThis: *JSC.JSGlobalObject,
//     callframe: *JSC.CallFrame,
// ) callconv(.C) JSC.JSValue {
//     const arguments_ = callframe.arguments(2);
//     var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
//     defer arguments.deinit();
//     const pat_arg = arguments.nextEat() orelse {
//         globalThis.throw("globMatch: expected 2 arguments, got 0", .{});
//         return JSC.JSValue.jsUndefined();
//     };
//     const input_str_arg = arguments.nextEat() orelse {
//         globalThis.throw("globMatch: expected 2 arguments, got 1", .{});
//         return JSC.JSValue.jsUndefined();
//     };

//     var pat_str: ZigString.Slice = ZigString.Slice.empty;
//     var input_str: ZigString.Slice = ZigString.Slice.empty;
//     defer {
//         pat_str.deinit();
//         input_str.deinit();
//     }

//     if (!pat_arg.isString()) {
//         globalThis.throw("globMatch: first argument is not a string", .{});
//         return JSC.JSValue.jsUndefined();
//     }

//     if (!input_str_arg.isString()) {
//         globalThis.throw("globMatch: second argument is not a string", .{});
//         return JSC.JSValue.jsUndefined();
//     }

//     pat_str = pat_arg.toSlice(globalThis, globalThis.bunVM().allocator);
//     input_str = input_str_arg.toSlice(globalThis, globalThis.bunVM().allocator);

//     const matches = glob.globMatchString(pat_str.slice(), input_str.slice());
//     return JSC.JSValue.jsBoolean(matches);
// }
