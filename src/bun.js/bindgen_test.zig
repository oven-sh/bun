//! This namespace is used to test binding generator

pub fn getBindgenTestFunctions(global: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    return (try jsc.JSObject.create(.{
        .add = gen.createAddCallback(global),
        .requiredAndOptionalArg = gen.createRequiredAndOptionalArgCallback(global),
    }, global)).toJS();
}

// This example should be kept in sync with bindgen's documentation
pub fn add(global: *jsc.JSGlobalObject, a: i32, b: i32) !i32 {
    return std.math.add(i32, a, b) catch {
        // Binding functions can return `error.OutOfMemory` and `error.JSError`.
        // Others like `error.Overflow` from `std.math.add` must be converted.
        // Remember to be descriptive.
        return global.throwPretty("Integer overflow while adding", .{});
    };
}

pub fn requiredAndOptionalArg(a: bool, b: ?usize, c: i32, d: ?u8) i32 {
    const b_nonnull = b orelse {
        return (123456 +% c) +% (d orelse 0);
    };
    var math_result: i32 = @truncate(@as(isize, @as(u53, @truncate(
        (b_nonnull +% @as(usize, @abs(c))) *% (d orelse 1),
    ))));
    if (a) {
        math_result = -math_result;
    }
    return math_result;
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const gen = bun.gen.bindgen_test;
