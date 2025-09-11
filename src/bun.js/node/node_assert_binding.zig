/// ```ts
/// const enum DiffType {
///     Insert = 0,
///     Delete = 1,
///     Equal  = 2,
/// }
/// type Diff = { operation: DiffType, text: string };
/// declare function myersDiff(actual: string, expected: string): Diff[];
/// ```
pub fn myersDiff(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var stack_fallback = std.heap.stackFallback(1024 * 2, bun.default_allocator);
    var arena = std.heap.ArenaAllocator.init(stack_fallback.get());
    defer arena.deinit();
    const allocator = arena.allocator();

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

    const actual_str = try actual_arg.toBunString(global);
    defer actual_str.deref();
    const expected_str = try expected_arg.toBunString(global);
    defer expected_str.deref();

    bun.assertWithLocation(actual_str.tag != .Dead, @src());
    bun.assertWithLocation(expected_str.tag != .Dead, @src());

    return assert.myersDiff(
        allocator,
        global,
        &actual_str,
        &expected_str,
        check_comma_disparity,
        lines,
    );
}

const StrDiffList = DiffList([]const u8);
fn diffListToJS(global: *jsc.JSGlobalObject, diff_list: StrDiffList) bun.JSError!jsc.JSValue {
    // todo: replace with toJS
    var array = try jsc.JSValue.createEmptyArray(global, diff_list.items.len);
    for (diff_list.items, 0..) |*line, i| {
        var obj = jsc.JSValue.createEmptyObjectWithNullPrototype(global);
        if (obj == .zero) return global.throwOutOfMemory();
        obj.put(global, bun.String.static("kind"), jsc.JSValue.jsNumber(@as(u32, @intFromEnum(line.kind))));
        obj.put(global, bun.String.static("value"), .fromAny(global, []const u8, line.value));
        array.putIndex(global, @truncate(i), obj);
    }
    return array;
}

// =============================================================================

pub fn generate(global: *jsc.JSGlobalObject) jsc.JSValue {
    const exports = jsc.JSValue.createEmptyObject(global, 1);

    exports.put(
        global,
        bun.String.static("myersDiff"),
        jsc.JSFunction.create(global, "myersDiff", myersDiff, 2, .{}),
    );

    return exports;
}

const assert = @import("./node_assert.zig");
const bun = @import("bun");
const std = @import("std");
const DiffList = @import("./assert/myers_diff.zig").DiffList;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
