const std = @import("std");
const bun = @import("root").bun;
const assert = @import("./node_assert.zig");
const DiffList = @import("./assert/myers_diff.zig").DiffList;
const Allocator = std.mem.Allocator;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;

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
    const nargs = callframe.argumentsCount();
    if (nargs < 2) {
        return global.throwNotEnoughArguments("printMyersDiff", 2, callframe.argumentsCount());
    }

    const actual_arg: JSValue = callframe.argument(0);
    const expected_arg: JSValue = callframe.argument(1);
    const check_comma_disparity: bool, const lines: bool = switch (nargs) {
        0, 1 => unreachable,
        2 => .{ false, false },
        3 => .{ callframe.argument(2).isTruthy(), false },
        else => .{ callframe.argument(2).isTruthy(), callframe.argument(3).isTruthy() },
    };

    if (!actual_arg.isString()) return global.throwInvalidArgumentTypeValue("actual", "string", actual_arg);
    if (!expected_arg.isString()) return global.throwInvalidArgumentTypeValue("expected", "string", expected_arg);

    // const actual = try actual_arg.toBunString2(global);
    // const expected = try safeToString(global, alloc, callframe.argument(1), "expected");
    const actual, const expected = blk: {
        // block used to limit scope of errdefer
        var _actual = try actual_arg.toBunString2(global);
        errdefer _actual.deref();
        const _expected = try expected_arg.toBunString2(global);
        break :blk .{ _actual, _expected };
        // var _expected = try safeToString(global, alloc, expected_arg, "expected");
    };

    var stack_fallback = std.heap.stackFallback(1024 * 2, bun.default_allocator);
    var arena = std.heap.ArenaAllocator.init(stack_fallback.get());
    defer arena.deinit();

    const diff = try assert.myersDiff(arena.allocator(), global, &actual, &expected, check_comma_disparity, lines);

    return diffListToJS(global, diff);
}

const StrDiffList = DiffList([]const u8);
fn diffListToJS(global: *JSC.JSGlobalObject, diff_list: StrDiffList) bun.JSError!JSC.JSValue {
    // todo: replace with toJS
    var array = JSC.JSValue.createEmptyArray(global, diff_list.items.len);
    for (diff_list.items, 0..) |*line, i| {
        var obj = JSC.JSValue.createEmptyObjectWithNullPrototype(global);
        if (obj == .zero) return global.throwOutOfMemory();
        obj.put(global, bun.String.static("kind"), JSC.JSValue.jsNumber(@as(u32, @intFromEnum(line.kind))));
        obj.put(global, bun.String.static("value"), JSC.toJS(global, []const u8, line.value, .allocated));
        array.putIndex(global, @truncate(i), obj);
    }
    return array;
}

// =============================================================================

pub fn generate(global: *JSC.JSGlobalObject) JSC.JSValue {
    const exports = JSC.JSValue.createEmptyObject(global, 1);

    exports.put(
        global,
        bun.String.static("myersDiff"),
        JSC.JSFunction.create(global, "myersDiff", myersDiff, 2, .{}),
    );

    return exports;
}
