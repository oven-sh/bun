pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSC.JSValue.createEmptyObject(globalThis, 9);

    object.put(
        globalThis,
        JSC.ZigString.static("satisfies"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("satisfies"),
            2,
            SemverObject.satisfies,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("order"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("order"),
            2,
            SemverObject.order,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("gt"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("gt"),
            2,
            SemverObject.gt,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("lt"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("lt"),
            2,
            SemverObject.lt,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("eq"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("eq"),
            2,
            SemverObject.eq,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("gte"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("gte"),
            2,
            SemverObject.gte,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("lte"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("lte"),
            2,
            SemverObject.lte,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("neq"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("neq"),
            2,
            SemverObject.neq,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("valid"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("valid"),
            1,
            SemverObject.valid,
            false,
        ),
    );

    return object;
}

pub fn order(
    globalThis: *JSC.JSGlobalObject,
    callFrame: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(512, arena.allocator());
    const allocator = stack_fallback.get();

    var argumentStrings = try parseArgumentStrings(globalThis, callFrame, allocator);
    defer argumentStrings.deinit();

    const left = argumentStrings.left.slice();
    const right = argumentStrings.right.slice();

    const left_result = Version.parseStrict(SlicedString.init(left, left));
    const right_result = Version.parseStrict(SlicedString.init(right, right));

    if (!left_result.valid) {
        return globalThis.throw("Invalid SemVer: {s}\n", .{left});
    }
    if (!right_result.valid) {
        return globalThis.throw("Invalid SemVer: {s}\n", .{right});
    }

    const left_version = left_result.version.max();
    const right_version = right_result.version.max();

    return switch (left_version.orderWithoutBuild(right_version, left, right)) {
        .eq => JSC.jsNumber(0),
        .gt => JSC.jsNumber(1),
        .lt => JSC.jsNumber(-1),
    };
}

pub fn satisfies(
    globalThis: *JSC.JSGlobalObject,
    callFrame: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(512, arena.allocator());
    const allocator = stack_fallback.get();

    var argumentStrings = try parseArgumentStrings(globalThis, callFrame, allocator);
    defer argumentStrings.deinit();

    const left = argumentStrings.left.slice();
    const right = argumentStrings.right.slice();

    const left_result = Version.parseStrict(SlicedString.init(left, left));
    if (left_result.wildcard != .none) {
        return .false;
    }

    const left_version = left_result.version.min();

    const right_group = try Query.parse(
        allocator,
        right,
        SlicedString.init(right, right),
    );
    defer right_group.deinit();

    const right_version = right_group.getExactVersion();

    if (right_version != null) {
        return JSC.jsBoolean(left_version.eql(right_version.?));
    }

    return JSC.jsBoolean(right_group.satisfies(left_version, right, left));
}

pub fn gt(
    globalThis: *JSC.JSGlobalObject,
    callFrame: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    const orderResult = try order(globalThis, callFrame);
    const orderValue = orderResult.asNumber();
    return JSC.jsBoolean(orderValue > 0);
}

pub fn lt(
    globalThis: *JSC.JSGlobalObject,
    callFrame: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    const orderResult = try order(globalThis, callFrame);
    const orderValue = orderResult.asNumber();
    return JSC.jsBoolean(orderValue < 0);
}

pub fn eq(
    globalThis: *JSC.JSGlobalObject,
    callFrame: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    const orderResult = try order(globalThis, callFrame);
    const orderValue = orderResult.asNumber();
    return JSC.jsBoolean(orderValue == 0);
}

pub fn gte(
    globalThis: *JSC.JSGlobalObject,
    callFrame: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    const orderResult = try order(globalThis, callFrame);
    const orderValue = orderResult.asNumber();
    return JSC.jsBoolean(orderValue >= 0);
}

pub fn lte(
    globalThis: *JSC.JSGlobalObject,
    callFrame: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    const orderResult = try order(globalThis, callFrame);
    const orderValue = orderResult.asNumber();
    return JSC.jsBoolean(orderValue <= 0);
}

pub fn neq(
    globalThis: *JSC.JSGlobalObject,
    callFrame: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    const orderResult = try order(globalThis, callFrame);
    const orderValue = orderResult.asNumber();
    return JSC.jsBoolean(orderValue != 0);
}

pub fn valid(
    globalThis: *JSC.JSGlobalObject,
    callFrame: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(512, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments();
    if (arguments.len != 1) {
        return globalThis.throw("Expected one argument", .{});
    }

    const arg = arguments[0];
    const string = try arg.toJSString(globalThis);
    const string_sliced = string.toSlice(globalThis, allocator);
    defer string_sliced.deinit();

    const result = Version.parseStrict(SlicedString.init(string_sliced.slice(), string_sliced.slice()));
    if (result.valid) {
        const formatter = result.version.min().fmt(string_sliced.slice());
        const formatted = std.fmt.allocPrint(allocator, "{}", .{formatter}) catch return JSC.JSValue.null;
        return bun.String.createUTF8ForJS(globalThis, formatted);
    } else {
        return JSC.JSValue.null;
    }
}

const ArgumentStrings = struct {
    left: JSC.ZigString.Slice,
    right: JSC.ZigString.Slice,

    fn deinit(self: *ArgumentStrings) void {
        self.left.deinit();
        self.right.deinit();
    }
};

fn parseArgumentStrings(
    globalThis: *JSC.JSGlobalObject,
    callFrame: *JSC.CallFrame,
    allocator: std.mem.Allocator,
) bun.JSError!ArgumentStrings {
    const arguments = callFrame.arguments();
    if (arguments.len != 2) {
        return globalThis.throw("Expected two arguments", .{});
    }

    const left_arg = arguments[0];
    const right_arg = arguments[1];

    const left_string = try left_arg.toJSString(globalThis);
    const right_string = try right_arg.toJSString(globalThis);

    const left = left_string.toSlice(globalThis, allocator);
    const right = right_string.toSlice(globalThis, allocator);

    return ArgumentStrings{
        .left = left,
        .right = right,
    };
}

const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const default_allocator = bun.default_allocator;

const JSC = bun.JSC;
const SlicedString = bun.Semver.SlicedString;

const Query = bun.Semver.Query;
const Version = bun.Semver.Version;
const SemverObject = @This();
