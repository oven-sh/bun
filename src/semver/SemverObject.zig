pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSC.JSValue.createEmptyObject(globalThis, 8);

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
        JSC.ZigString.static("major"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("major"),
            1,
            SemverObject.major,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("minor"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("minor"),
            1,
            SemverObject.minor,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("patch"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("patch"),
            1,
            SemverObject.patch,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("parse"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("parse"),
            1,
            SemverObject.parse,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("prerelease"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("prerelease"),
            1,
            SemverObject.prerelease,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("bump"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("bump"),
            3,
            SemverObject.bump,
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

    if (!strings.isAllASCII(left.slice())) return JSC.jsNumber(0);
    if (!strings.isAllASCII(right.slice())) return JSC.jsNumber(0);

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
        .eq => JSC.jsNumber(0),
        .gt => JSC.jsNumber(1),
        .lt => JSC.jsNumber(-1),
    };
}

pub fn satisfies(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
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
        return JSC.jsBoolean(left_version.eql(right_version.?));
    }

    return JSC.jsBoolean(right_group.satisfies(left_version, right.slice(), left.slice()));
}

// Add a helper to reduce boilerplate for major, minor, patch
fn getVersionComponent(
    globalThis: *JSC.JSGlobalObject,
    callFrame: *JSC.CallFrame,
    comptime component: enum { major, minor, patch },
) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(512, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len < 1) {
        return JSC.JSValue.null;
    }

    const arg_string = try arguments[0].toJSString(globalThis);
    const version_slice = arg_string.toSlice(globalThis, allocator);
    defer version_slice.deinit();

    if (!strings.isAllASCII(version_slice.slice())) return JSC.JSValue.null;

    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid) {
        return JSC.JSValue.null;
    }

    const version = parse_result.version;
    return switch (component) {
        .major => JSC.jsNumber(version.major orelse 0),
        .minor => JSC.jsNumber(version.minor orelse 0),
        .patch => JSC.jsNumber(version.patch orelse 0),
    };
}

pub fn major(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return getVersionComponent(globalThis, callFrame, .major);
}

pub fn minor(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return getVersionComponent(globalThis, callFrame, .minor);
}

pub fn patch(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return getVersionComponent(globalThis, callFrame, .patch);
}

pub fn prerelease(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len < 1) return JSC.JSValue.null;

    const arg_string = try arguments[0].toJSString(globalThis);
    const version_slice = arg_string.toSlice(globalThis, allocator);
    defer version_slice.deinit();

    if (!strings.isAllASCII(version_slice.slice())) return JSC.JSValue.null;

    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid or !parse_result.version.min().tag.hasPre()) {
        return JSC.JSValue.null;
    }

    return parse_result.version.min().tag.toComponentsArray(true, globalThis, allocator, version_slice.slice());
}

pub fn parse(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len < 1) return JSC.JSValue.null;

    const arg_string = try arguments[0].toJSString(globalThis);
    const version_slice = arg_string.toSlice(globalThis, allocator);
    defer version_slice.deinit();
    
    if (!strings.isAllASCII(version_slice.slice())) return JSC.JSValue.null;
    
    const sliced_string = SlicedString.init(version_slice.slice(), version_slice.slice());
    const parse_result = Version.parse(sliced_string);
    if (!parse_result.valid) {
        return JSC.JSValue.null;
    }

    const version = parse_result.version.min();
    const obj = JSC.JSValue.createEmptyObject(globalThis, 6);

    obj.put(globalThis, JSC.ZigString.static("major"), JSC.jsNumber(version.major));
    obj.put(globalThis, JSC.ZigString.static("minor"), JSC.jsNumber(version.minor));
    obj.put(globalThis, JSC.ZigString.static("patch"), JSC.jsNumber(version.patch));

    const pre_array = try version.tag.toComponentsArray(true, globalThis, allocator, version_slice.slice());
    obj.put(globalThis, JSC.ZigString.static("prerelease"), pre_array);

    const build_array = try version.tag.toComponentsArray(false, globalThis, allocator, version_slice.slice());
    obj.put(globalThis, JSC.ZigString.static("build"), build_array);
    
    const raw_version_string = try std.fmt.allocPrint(allocator, "{s}", .{version.fmt(version_slice.slice())});
    obj.put(globalThis, JSC.ZigString.static("version"), bun.String.createUTF8ForJS(globalThis, raw_version_string));

    obj.put(globalThis, JSC.ZigString.static("raw"), arguments[0]);

    return obj;
}

pub fn bump(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(3).slice(); // v, releaseType, identifier
    if (arguments.len < 2) return JSC.JSValue.null;

    // Arg 1: Version
    const version_str = try arguments[0].toJSString(globalThis);
    const version_slice = version_str.toSlice(globalThis, allocator);
    defer version_slice.deinit();
    if (!strings.isAllASCII(version_slice.slice())) return JSC.JSValue.null;
    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid) return JSC.JSValue.null;

    // Arg 2: Release Type
    const release_type_str = try arguments[1].toJSString(globalThis);
    const release_type_slice = release_type_str.toSlice(globalThis, allocator);
    defer release_type_slice.deinit();
    const release_type = Version.ReleaseType.fromString(release_type_slice.slice()) orelse return JSC.JSValue.null;

    // Arg 3: Identifier (optional)
    var identifier: ?[]const u8 = null;
    if (arguments.len > 2 and arguments[2].isString()) {
        const id_str = try arguments[2].toJSString(globalThis);
        const id_slice = id_str.toSlice(globalThis, allocator);
        defer id_slice.deinit();
        identifier = id_slice.slice();
    }

    const new_version_str = (parse_result.version.min().bump(allocator, release_type, identifier) catch return JSC.JSValue.null);
    defer allocator.free(new_version_str);
    
    return bun.String.createUTF8ForJS(globalThis, new_version_str);
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
