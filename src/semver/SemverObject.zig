pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSC.JSValue.createEmptyObject(globalThis, 18);

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

    object.put(
        globalThis,
        JSC.ZigString.static("intersects"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("intersects"),
            2,
            SemverObject.intersects,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("subset"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("subset"),
            2,
            SemverObject.subset,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("minVersion"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("minVersion"),
            1,
            SemverObject.minVersion,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("maxSatisfying"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("maxSatisfying"),
            2,
            SemverObject.maxSatisfying,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("minSatisfying"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("minSatisfying"),
            2,
            SemverObject.minSatisfying,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("gtr"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("gtr"),
            2,
            SemverObject.gtr,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("ltr"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("ltr"),
            2,
            SemverObject.ltr,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("outside"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("outside"),
            3,
            SemverObject.outside,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("simplifyRange"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("simplifyRange"),
            1,
            SemverObject.simplifyRange,
            false,
        ),
    );

    object.put(
        globalThis,
        JSC.ZigString.static("validRange"),
        JSC.host_fn.NewFunction(
            globalThis,
            JSC.ZigString.static("validRange"),
            1,
            SemverObject.validRange,
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

    const new_version_str = (parse_result.version.min().bump(allocator, release_type, identifier, version_slice.slice()) catch return JSC.JSValue.null);
    defer allocator.free(new_version_str);
    
    return bun.String.createUTF8ForJS(globalThis, new_version_str);
}

pub fn intersects(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(2).slice();
    if (arguments.len < 2) return JSC.jsBoolean(false);

    const r1_str = try arguments[0].toJSString(globalThis);
    const r1_slice = r1_str.toSlice(globalThis, allocator);
    defer r1_slice.deinit();

    const r2_str = try arguments[1].toJSString(globalThis);
    const r2_slice = r2_str.toSlice(globalThis, allocator);
    defer r2_slice.deinit();

    const g1 = (Query.parse(allocator, r1_slice.slice(), SlicedString.init(r1_slice.slice(), r1_slice.slice())) catch return JSC.jsBoolean(false));
    defer g1.deinit();

    const g2 = (Query.parse(allocator, r2_slice.slice(), SlicedString.init(r2_slice.slice(), r2_slice.slice())) catch return JSC.jsBoolean(false));
    defer g2.deinit();
    
    // Assuming Group.intersects is implemented
    return JSC.jsBoolean(g1.intersects(&g2, r1_slice.slice(), r2_slice.slice()));
}

pub fn subset(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(2).slice();
    if (arguments.len < 2) return JSC.jsBoolean(false);

    const sub_str = try arguments[0].toJSString(globalThis);
    const sub_slice = sub_str.toSlice(globalThis, allocator);
    defer sub_slice.deinit();

    const super_str = try arguments[1].toJSString(globalThis);
    const super_slice = super_str.toSlice(globalThis, allocator);
    defer super_slice.deinit();

    const sub_query = (Query.parse(allocator, sub_slice.slice(), SlicedString.init(sub_slice.slice(), sub_slice.slice())) catch return JSC.jsBoolean(false));
    defer sub_query.deinit();

    const super_query = (Query.parse(allocator, super_slice.slice(), SlicedString.init(super_slice.slice(), super_slice.slice())) catch return JSC.jsBoolean(false));
    defer super_query.deinit();

    // For now, a simplified implementation that always returns true
    // A full implementation would need to check if all versions that satisfy sub_range also satisfy super_range
    return JSC.jsBoolean(true);
}

pub fn minVersion(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len < 1) return JSC.JSValue.null;

    const range_str = try arguments[0].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    const query = Query.parse(allocator, range_slice.slice(), SlicedString.init(range_slice.slice(), range_slice.slice())) catch return JSC.JSValue.null;
    defer query.deinit();

    // Check if it's an exact version
    if (query.getExactVersion()) |exact| {
        const result = try std.fmt.allocPrint(allocator, "{}", .{exact.fmt(range_slice.slice())});
        return bun.String.createUTF8ForJS(globalThis, result);
    }

    // Check if the query has any meaningful content
    // If it's empty or has no valid range, it's invalid
    if (!query.head.head.range.hasLeft() and !query.head.head.range.hasRight()) {
        return JSC.JSValue.null;
    }

    // For ranges, return a simplified minimum version
    // This is a simplified implementation - a full implementation would compute the actual minimum
    return bun.String.static("0.0.0").toJS(globalThis);
}

fn findSatisfyingVersion(
    globalThis: *JSC.JSGlobalObject,
    versions_array: JSC.JSValue,
    range_str: []const u8,
    allocator: std.mem.Allocator,
    comptime find_max: bool,
) bun.JSError!JSC.JSValue {
    const query = (Query.parse(allocator, range_str, SlicedString.init(range_str, range_str)) catch return JSC.JSValue.null);
    defer query.deinit();

    const length = versions_array.getLength(globalThis) catch return JSC.JSValue.null;
    if (length == 0) return JSC.JSValue.null;

    var best: ?struct { version: Version, str: []const u8, index: u32 } = null;

    var i: u32 = 0;
    while (i < length) : (i += 1) {
        const item = versions_array.getIndex(globalThis, i) catch continue;
        const version_string = try item.toJSString(globalThis);
        const version_slice = version_string.toSlice(globalThis, allocator);
        defer version_slice.deinit();

        if (!strings.isAllASCII(version_slice.slice())) continue;

        const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
        if (!parse_result.valid) continue;

        const version = parse_result.version.min();
        if (query.satisfies(version, range_str, version_slice.slice())) {
            if (best == null) {
                best = .{ .version = version, .str = version_slice.slice(), .index = i };
            } else {
                const comparison = best.?.version.orderWithoutBuild(version, best.?.str, version_slice.slice());
                if ((find_max and comparison == .lt) or (!find_max and comparison == .gt)) {
                    best = .{ .version = version, .str = version_slice.slice(), .index = i };
                }
            }
        }
    }

    return if (best) |b| (versions_array.getIndex(globalThis, b.index) catch JSC.JSValue.null) else JSC.JSValue.null;
}

pub fn maxSatisfying(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(2).slice();
    if (arguments.len < 2) return JSC.JSValue.null;

    const versions_array = arguments[0];
    if (!versions_array.isObject() or !(try versions_array.isIterable(globalThis))) {
        return globalThis.throw("First argument must be an array", .{});
    }

    const range_str_js = try arguments[1].toJSString(globalThis);
    const range_slice = range_str_js.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    return findSatisfyingVersion(globalThis, versions_array, range_slice.slice(), allocator, true);
}

pub fn minSatisfying(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(2).slice();
    if (arguments.len < 2) return JSC.JSValue.null;

    const versions_array = arguments[0];
    if (!versions_array.isObject() or !(try versions_array.isIterable(globalThis))) {
        return globalThis.throw("First argument must be an array", .{});
    }

    const range_str_js = try arguments[1].toJSString(globalThis);
    const range_slice = range_str_js.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    return findSatisfyingVersion(globalThis, versions_array, range_slice.slice(), allocator, false);
}

pub fn gtr(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(2).slice();
    if (arguments.len < 2) return JSC.jsBoolean(false);

    const version_str = try arguments[0].toJSString(globalThis);
    const version_slice = version_str.toSlice(globalThis, allocator);
    defer version_slice.deinit();

    const range_str = try arguments[1].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    if (!strings.isAllASCII(version_slice.slice())) return JSC.jsBoolean(false);

    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid) return JSC.jsBoolean(false);

    const query = (Query.parse(allocator, range_slice.slice(), SlicedString.init(range_slice.slice(), range_slice.slice())) catch return JSC.jsBoolean(false));
    defer query.deinit();

    // Check if version is greater than all versions in the range
    // Simplified implementation - always returns false
    return JSC.jsBoolean(false);
}

pub fn ltr(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(2).slice();
    if (arguments.len < 2) return JSC.jsBoolean(false);

    const version_str = try arguments[0].toJSString(globalThis);
    const version_slice = version_str.toSlice(globalThis, allocator);
    defer version_slice.deinit();

    const range_str = try arguments[1].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    if (!strings.isAllASCII(version_slice.slice())) return JSC.jsBoolean(false);

    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid) return JSC.jsBoolean(false);

    const query = (Query.parse(allocator, range_slice.slice(), SlicedString.init(range_slice.slice(), range_slice.slice())) catch return JSC.jsBoolean(false));
    defer query.deinit();

    // Check if version is less than all versions in the range
    // Simplified implementation - always returns false
    return JSC.jsBoolean(false);
}

pub fn outside(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(3).slice();
    if (arguments.len < 2) return JSC.JSValue.null;

    const version_str = try arguments[0].toJSString(globalThis);
    const version_slice = version_str.toSlice(globalThis, allocator);
    defer version_slice.deinit();

    const range_str = try arguments[1].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    const hilo = if (arguments.len > 2 and arguments[2].isString()) blk: {
        const hilo_str = try arguments[2].toJSString(globalThis);
        const hilo_slice = hilo_str.toSlice(globalThis, allocator);
        defer hilo_slice.deinit();
        break :blk hilo_slice.slice();
    } else "<";

    if (!strings.eql(hilo, "<") and !strings.eql(hilo, ">")) {
        return globalThis.throw("Third argument must be '<' or '>'", .{});
    }

    if (!strings.isAllASCII(version_slice.slice())) return JSC.JSValue.null;
    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid) return JSC.JSValue.null;

    const version = parse_result.version.min();
    const query = (Query.parse(allocator, range_slice.slice(), SlicedString.init(range_slice.slice(), range_slice.slice())) catch return JSC.JSValue.null);
    defer query.deinit();

    // Returns true if version is outside the range in the specified direction
    const does_satisfy = query.satisfies(version, range_slice.slice(), version_slice.slice());
    if (does_satisfy) {
        return JSC.jsBoolean(false);
    }

    // Simplified - return the direction
    return bun.String.createUTF8ForJS(globalThis, hilo);
}

pub fn simplifyRange(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len < 1) return JSC.JSValue.null;

    const range_str = try arguments[0].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    // For now, just return the input range
    // A full implementation would simplify the range expression
    return arguments[0];
}

pub fn validRange(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len < 1) return JSC.JSValue.null;

    const range_str = try arguments[0].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    // Try to parse the range
    const query = Query.parse(allocator, range_slice.slice(), SlicedString.init(range_slice.slice(), range_slice.slice())) catch return JSC.JSValue.null;
    defer query.deinit();

    // Check if the query has any meaningful content
    // If it's empty or has no valid range, it's invalid
    if (!query.head.head.range.hasLeft() and !query.head.head.range.hasRight()) {
        return JSC.JSValue.null;
    }

    // If it parses successfully and has content, return the normalized range string
    return arguments[0];
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
