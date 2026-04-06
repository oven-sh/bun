const SemverObject = @This();

pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = jsc.JSValue.createEmptyObject(globalThis, 2);

    object.put(
        globalThis,
        jsc.ZigString.static("satisfies"),
        jsc.JSFunction.create(
            globalThis,
            "satisfies",
            SemverObject.satisfies,
            2,
            .{},
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("order"),
        jsc.JSFunction.create(
            globalThis,
            "order",
            SemverObject.order,
            2,
            .{},
        ),
    );

    return object;
}

pub fn order(
    globalThis: *jsc.JSGlobalObject,
    callFrame: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(512, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(2).slice();
    if (arguments.len < 2) {
        return globalThis.throw("Expected two arguments", .{});
    }

    const left_arg = arguments[0];
    const right_arg = arguments[1];

    const left_string = try left_arg.toJSString(globalThis);
    const right_string = try right_arg.toJSString(globalThis);

    const left = left_string.toSlice(globalThis, allocator);
    defer left.deinit();
    const right = right_string.toSlice(globalThis, allocator);
    defer right.deinit();

    if (!strings.isAllASCII(left.slice())) return .jsNumber(0);
    if (!strings.isAllASCII(right.slice())) return .jsNumber(0);

    const left_result = Version.parse(SlicedString.init(left.slice(), left.slice()));
    const right_result = Version.parse(SlicedString.init(right.slice(), right.slice()));

    if (!left_result.valid) {
        return globalThis.throw("Invalid SemVer: {s}\n", .{left.slice()});
    }

    if (!right_result.valid) {
        return globalThis.throw("Invalid SemVer: {s}\n", .{right.slice()});
    }

    const left_version = left_result.version.max();
    const right_version = right_result.version.max();

    return switch (left_version.orderWithoutBuild(right_version, left.slice(), right.slice())) {
        .eq => .jsNumber(0),
        .gt => .jsNumber(1),
        .lt => .jsNumber(-1),
    };
}

pub fn satisfies(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(512, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(2).slice();
    if (arguments.len < 2) {
        return globalThis.throw("Expected two arguments", .{});
    }

    const left_arg = arguments[0];
    const right_arg = arguments[1];

    const left_string = try left_arg.toJSString(globalThis);
    const right_string = try right_arg.toJSString(globalThis);

    const left = left_string.toSlice(globalThis, allocator);
    defer left.deinit();
    const right = right_string.toSlice(globalThis, allocator);
    defer right.deinit();

    if (!strings.isAllASCII(left.slice())) return .false;
    if (!strings.isAllASCII(right.slice())) return .false;

    const left_result = Version.parse(SlicedString.init(left.slice(), left.slice()));
    if (left_result.wildcard != .none) {
        return .false;
    }

    const left_version = left_result.version.min();

    const right_group = try Query.parse(
        allocator,
        right.slice(),
        SlicedString.init(right.slice(), right.slice()),
    );
    defer right_group.deinit();

    const right_version = right_group.getExactVersion();

    if (right_version != null) {
        return .jsBoolean(left_version.eql(right_version.?));
    }

    return .jsBoolean(right_group.satisfies(left_version, right.slice(), left.slice()));
}

const std = @import("std");

const bun = @import("bun");
const default_allocator = bun.default_allocator;
const jsc = bun.jsc;
const strings = bun.strings;

const Query = bun.Semver.Query;
const SlicedString = bun.Semver.SlicedString;
const Version = bun.Semver.Version;
