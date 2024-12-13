const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const assert = @import("./node_assert.zig");
const Allocator = std.mem.Allocator;

/// ```ts
/// const enum DiffType {
///     Insert = 0,
///     Delete = 1,
///     Equal  = 2,
/// }
/// type Diff = { operation: DiffType, text: string };
/// declare function myersDiff(actual: string, expected: string): Diff[];
/// ```
pub fn myersDiff(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (callframe.argumentsCount() < 2) {
        return global.throwNotEnoughArguments("printMyersDiff", 2, callframe.argumentsCount());
    }

    var stack_fallback = std.heap.stackFallback(1024 * 2, bun.default_allocator);
    var arena = std.heap.ArenaAllocator.init(stack_fallback.get());
    defer arena.deinit();
    const alloc = arena.allocator();

    const actual = try safeToString(global, alloc, callframe.argument(0));
    const expected = try safeToString(global, alloc, callframe.argument(1));

    const diff = assert.myersDiff(arena.allocator(), actual.slice(), expected.slice()) catch |e| {
        return switch (e) {
            error.OutOfMemory => return global.throwOutOfMemory(),
        };
    };

    return JSC.toJS(global, []const assert.Diff, diff.items, .allocated);
}

fn safeToString(global: *JSC.JSGlobalObject, alloc: Allocator, argument: JSC.JSValue) bun.JSError!bun.JSC.ZigString.Slice {
    if (!argument.isString()) {
        return global.throwInvalidArgumentTypeValue("argument", "string", argument);
    }

    const bunstring = argument.toBunString2(global) catch @panic("argument is string-like but could not be converted into a bun.String. This is a bug.");
    return bunstring.toUTF8WithoutRef(alloc);
}

pub fn generate(global: *JSC.JSGlobalObject) JSC.JSValue {
    const exports = JSC.JSValue.createEmptyObject(global, 1);

    exports.put(
        global,
        bun.String.static("myersDiff"),
        JSC.JSFunction.create(global, "myersDiff", myersDiff, 2, .{}),
    );

    return exports;
}
