const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const assert = @import("./node_assert.zig");
const Diff = assert.Diff;
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

    const actual = try safeToString(global, alloc, callframe.argument(0), "actual");
    const expected = try safeToString(global, alloc, callframe.argument(1), "expected");

    const diff = assert.myersDiff(arena.allocator(), actual.slice(), expected.slice()) catch |e| {
        return switch (e) {
            error.OutOfMemory => return global.throwOutOfMemory(),
        };
    };

    // todo: replace with toJS
    var array = JSC.JSValue.createEmptyArray(global, diff.items.len);
    for (diff.items, 0..) |*line, i| {
        var obj = JSC.JSValue.createEmptyObjectWithNullPrototype(global);
        if (obj == .zero) return global.throwOutOfMemory();
        obj.put(global, bun.String.static("operation"), JSC.JSValue.jsNumber(@as(u32, @intFromEnum(line.operation))));
        obj.put(global, bun.String.static("text"), JSC.toJS(global, []const u8, line.text, .allocated));
        array.putIndex(global, @truncate(i), obj);
    }
    return array;
}

fn safeToString(global: *JSC.JSGlobalObject, arena: Allocator, argument: JSC.JSValue, comptime argname: []const u8) bun.JSError!bun.JSC.ZigString.Slice {
    if (argument.isString()) {
        const bunstring = argument.toBunString2(global) catch @panic("argument is string-like but could not be converted into a bun.String. This is a bug.");
        return bunstring.toUTF8WithoutRef(arena);
    } else if (argument.isObject()) {
        const to_string: JSC.JSValue = (try argument.getFunction(global, "toString")) orelse {
            return global.throwInvalidArgumentTypeValue(argname, "string or object with .toString()", argument);
        };
        const js_string = try to_string.call(
            global,
            argument,
            &[0]JSC.JSValue{},
        );
        const bun_string = bun.String.fromJS(js_string, global);
        // TODO: does bunstring own its memory or does it increment a reference
        // count? IF the former, it's saved in the arena and this won't leak,
        // otherwise this will cause a UAF.
        return bun_string.toUTF8WithoutRef(arena);
    } else {
        return global.throwInvalidArgumentTypeValue(argname, "string or object with .toString()", argument);
    }
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
