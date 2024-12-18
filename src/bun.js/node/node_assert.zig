const std = @import("std");
const bun = @import("root").bun;
const MyersDiff = @import("./assert/myers_diff.zig");

const Allocator = std.mem.Allocator;
const BunString = bun.String;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;

const StringDiffList = MyersDiff.DiffList([]const u8);

const print = std.debug.print;

/// Compare `actual` and `expected`, producing a diff that would turn `actual`
/// into `expected`.
///
/// Lines in the returned diff have the same encoding as `actual` and
/// `expected`. Lines borrow from these inputs, but the diff list itself must
/// be deallocated.
///
/// Use an arena allocator, otherwise this will leak memory.
///
/// ## Invariants
/// If not met, this function will panic.
/// - `actual` and `expected` are alive and have the same encoding.
pub fn myersDiff(
    allocator: Allocator,
    global: *JSC.JSGlobalObject,
    actual: []const u8,
    expected: []const u8,
    // If true, strings that have a trailing comma but are otherwise equal are
    // considered equal.
    check_comma_disparity: bool,
    // split `actual` and `expected` into lines before diffing
    lines: bool,
) bun.JSError!JSC.JSValue {
    if (lines) {
        var a = try MyersDiff.split(allocator, actual);
        errdefer a.deinit(allocator);
        var e = try MyersDiff.split(allocator, expected);
        errdefer e.deinit(allocator);

        // NOTE: split lines leak memory if arena is not used
        const diff = blk: {
            if (check_comma_disparity) {
                const Differ = MyersDiff.Differ([]const u8, .{ .check_comma_disparity = true });
                break :blk Differ.diff(allocator, a.items, e.items) catch |err| return mapDiffError(global, err);
            } else {
                const Differ = MyersDiff.Differ([]const u8, .{ .check_comma_disparity = false });
                break :blk Differ.diff(allocator, a.items, e.items) catch |err| return mapDiffError(global, err);
            }
        };
        return diffListToJS([]const u8, global, diff);
    } else {
        const Differ = MyersDiff.Differ(u8, .{});
        const diff = Differ.diff(allocator, actual, expected) catch |err| return mapDiffError(global, err);
        return diffListToJS(u8, global, diff);
    }

    @panic("TODO: diff characters w/o allocating for each char.");
}

fn diffListToJS(comptime T: type, global: *JSC.JSGlobalObject, diff_list: MyersDiff.DiffList(T)) bun.JSError!JSC.JSValue {
    var array = JSC.JSValue.createEmptyArray(global, diff_list.items.len);
    for (diff_list.items, 0..) |*line, i| {
        array.putIndex(global, @truncate(i), JSC.JSObject.createNullProto(line.*, global).toJS());
    }
    return array;
}

fn mapDiffError(global: *JSC.JSGlobalObject, err: MyersDiff.Error) bun.JSError {
    return switch (err) {
        error.OutOfMemory => error.OutOfMemory,
        error.DiffTooLarge => global.throwInvalidArguments("Diffing these two values would create a string that is too large. If this was intentional, please open a bug report on GitHub.", .{}),
        error.InputsTooLarge => global.throwInvalidArguments("Input strings are too large to diff. Please open a bug report on GitHub.", .{}),
    };
}
