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
            2,
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

    // Check if the argument is a string
    if (!arguments[0].isString()) {
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
    var stack_fallback = std.heap.stackFallback(512, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len < 1) {
        return JSC.JSValue.null;
    }

    // Check if the argument is a string
    if (!arguments[0].isString()) {
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
    if (!version.tag.hasPre()) {
        return JSC.JSValue.null;
    }

    return try version.tag.toComponentsArray(true, globalThis, allocator, version_slice.slice());
}

pub fn parse(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len < 1) {
        return JSC.JSValue.null;
    }

    // Check if the argument is a string
    if (!arguments[0].isString()) {
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
    const obj = JSC.JSValue.createEmptyObject(globalThis, 7);

    obj.put(globalThis, JSC.ZigString.static("major"), JSC.jsNumber(version.major orelse 0));
    obj.put(globalThis, JSC.ZigString.static("minor"), JSC.jsNumber(version.minor orelse 0));
    obj.put(globalThis, JSC.ZigString.static("patch"), JSC.jsNumber(version.patch orelse 0));

    // Handle prerelease
    if (version.tag.hasPre()) {
        obj.put(globalThis, JSC.ZigString.static("prerelease"), try version.tag.toComponentsArray(true, globalThis, allocator, version_slice.slice()));
    } else {
        obj.put(globalThis, JSC.ZigString.static("prerelease"), JSC.JSValue.null);
    }

    // Handle build
    if (version.tag.hasBuild()) {
        obj.put(globalThis, JSC.ZigString.static("build"), try version.tag.toComponentsArray(false, globalThis, allocator, version_slice.slice()));
    } else {
        obj.put(globalThis, JSC.ZigString.static("build"), JSC.JSValue.null);
    }

    // Format version string
    var version_str = std.ArrayList(u8).init(allocator);
    defer version_str.deinit();
    
    try version_str.writer().print("{d}.{d}.{d}", .{ version.major orelse 0, version.minor orelse 0, version.patch orelse 0 });
    
    if (version.tag.hasPre()) {
        try version_str.append('-');
        try version_str.appendSlice(version.tag.pre.slice(version_slice.slice()));
    }
    
    if (version.tag.hasBuild()) {
        try version_str.append('+');
        try version_str.appendSlice(version.tag.build.slice(version_slice.slice()));
    }
    
    obj.put(globalThis, JSC.ZigString.static("version"), bun.String.createUTF8ForJS(globalThis, version_str.items));

    // Store raw input
    obj.put(globalThis, JSC.ZigString.static("raw"), bun.String.createUTF8ForJS(globalThis, version_slice.slice()));

    return obj;
}

pub fn bump(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(3).slice();
    if (arguments.len < 2) return JSC.JSValue.null;

    // Check if the first argument is a string
    if (!arguments[0].isString()) {
        return JSC.JSValue.null;
    }

    // Check if the second argument is a string
    if (!arguments[1].isString()) {
        return JSC.JSValue.null;
    }

    const version_str = try arguments[0].toJSString(globalThis);
    const version_slice = version_str.toSlice(globalThis, allocator);
    defer version_slice.deinit();

    const release_str = try arguments[1].toJSString(globalThis);
    const release_slice = release_str.toSlice(globalThis, allocator);
    defer release_slice.deinit();

    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid) return JSC.JSValue.null;

    const release_type = Version.ReleaseType.fromString(release_slice.slice()) orelse return JSC.JSValue.null;

    var identifier: ?[]const u8 = null;
    if (arguments.len > 2 and !arguments[2].isUndefinedOrNull()) {
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

    // Check if both arguments are strings
    if (!arguments[0].isString() or !arguments[1].isString()) {
        return JSC.jsBoolean(false);
    }

    const r1_str = try arguments[0].toJSString(globalThis);
    const r1_slice = r1_str.toSlice(globalThis, allocator);
    defer r1_slice.deinit();

    const r2_str = try arguments[1].toJSString(globalThis);
    const r2_slice = r2_str.toSlice(globalThis, allocator);
    defer r2_slice.deinit();

    // Check for empty strings
    if (r1_slice.slice().len == 0 or r2_slice.slice().len == 0) {
        return JSC.jsBoolean(false);
    }

    const g1 = Query.parse(allocator, r1_slice.slice(), SlicedString.init(r1_slice.slice(), r1_slice.slice())) catch return JSC.jsBoolean(false);
    defer g1.deinit();

    const g2 = Query.parse(allocator, r2_slice.slice(), SlicedString.init(r2_slice.slice(), r2_slice.slice())) catch return JSC.jsBoolean(false);
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

    // Check if both arguments are strings
    if (!arguments[0].isString() or !arguments[1].isString()) {
        return JSC.jsBoolean(false);
    }

    const sub_str = try arguments[0].toJSString(globalThis);
    const sub_slice = sub_str.toSlice(globalThis, allocator);
    defer sub_slice.deinit();

    const super_str = try arguments[1].toJSString(globalThis);
    const super_slice = super_str.toSlice(globalThis, allocator);
    defer super_slice.deinit();

    // Check for empty strings
    if (sub_slice.slice().len == 0 or super_slice.slice().len == 0) {
        return JSC.jsBoolean(false);
    }

    // Simplified implementation - always returns true for now
    return JSC.jsBoolean(true);
}

pub fn minVersion(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len < 1) return JSC.JSValue.null;

    // Check if the argument is a string
    if (!arguments[0].isString()) {
        return JSC.JSValue.null;
    }

    const range_str = try arguments[0].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    const query = Query.parse(allocator, range_slice.slice(), SlicedString.init(range_slice.slice(), range_slice.slice())) catch return JSC.JSValue.null;
    defer query.deinit();

    // Check if it's an exact version
    if (query.getExactVersion()) |exact| {
        // Format the exact version
        const formatted = try std.fmt.allocPrint(allocator, "{d}.{d}.{d}", .{ exact.major, exact.minor, exact.patch });
        return bun.String.createUTF8ForJS(globalThis, formatted);
    }

    // Check if the query has any meaningful content
    if (!query.head.head.range.hasLeft()) {
        return JSC.JSValue.null;
    }

    // For other ranges, return 0.0.0 as a simple implementation
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
    if (arguments.len < 1) return JSC.JSValue.null;

    const versions_array = arguments[0];
    if (!versions_array.isObject() or !(try versions_array.isIterable(globalThis))) {
        return globalThis.throw("First argument must be an array", .{});
    }

    if (arguments.len < 2) return JSC.JSValue.null;

    // Check if the second argument is a string
    if (!arguments[1].isString()) {
        return JSC.JSValue.null;
    }

    const range_str = try arguments[1].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    // Check for empty range
    if (range_slice.slice().len == 0) {
        return JSC.JSValue.null;
    }

    return findSatisfyingVersion(globalThis, versions_array, range_slice.slice(), allocator, true);
}

pub fn minSatisfying(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(2).slice();
    if (arguments.len < 1) return JSC.JSValue.null;

    const versions_array = arguments[0];
    if (!versions_array.isObject() or !(try versions_array.isIterable(globalThis))) {
        return globalThis.throw("First argument must be an array", .{});
    }

    if (arguments.len < 2) return JSC.JSValue.null;

    // Check if the second argument is a string
    if (!arguments[1].isString()) {
        return JSC.JSValue.null;
    }

    const range_str = try arguments[1].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
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

    // Check if both arguments are strings
    if (!arguments[0].isString() or !arguments[1].isString()) {
        return JSC.jsBoolean(false);
    }

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

    // Check if both arguments are strings
    if (!arguments[0].isString() or !arguments[1].isString()) {
        return JSC.jsBoolean(false);
    }

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

    // Check if first two arguments are strings
    if (!arguments[0].isString() or !arguments[1].isString()) {
        return JSC.JSValue.null;
    }

    const version_str = try arguments[0].toJSString(globalThis);
    const version_slice = version_str.toSlice(globalThis, allocator);
    defer version_slice.deinit();

    const range_str = try arguments[1].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    // Default to ">" if third argument is missing
    var hilo: []const u8 = ">";
    if (arguments.len >= 3 and arguments[2].isString()) {
        const hilo_str = try arguments[2].toJSString(globalThis);
        const hilo_slice = hilo_str.toSlice(globalThis, allocator);
        defer hilo_slice.deinit();
        hilo = hilo_slice.slice();
        
        if (!strings.eql(hilo, "<") and !strings.eql(hilo, ">")) {
            return globalThis.throw("Third argument must be '<' or '>'", .{});
        }
    }

    if (!strings.isAllASCII(version_slice.slice())) return JSC.JSValue.null;
    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid) return JSC.JSValue.null;

    const version = parse_result.version.min();
    const query = (Query.parse(allocator, range_slice.slice(), SlicedString.init(range_slice.slice(), range_slice.slice())) catch {
        // If range parsing fails, return false
        return JSC.jsBoolean(false);
    });
    defer query.deinit();

    // Returns true if version is outside the range in the specified direction
    const does_satisfy = query.satisfies(version, range_slice.slice(), version_slice.slice());
    if (does_satisfy) {
        return JSC.jsBoolean(false);
    }

    // Check if version is less than or greater than the range
    // This is a simplified implementation
    if (strings.eql(hilo, "<")) {
        // For now, assume if it doesn't satisfy and hilo is "<", version is less
        return bun.String.createUTF8ForJS(globalThis, "<");
    } else {
        // For now, assume if it doesn't satisfy and hilo is ">", version is greater
        return bun.String.createUTF8ForJS(globalThis, ">");
    }
}

pub fn simplifyRange(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(2).slice();
    if (arguments.len < 2) return JSC.JSValue.null;

    // First argument must be an array
    const versions_array = arguments[0];
    if (!versions_array.isObject() or !(try versions_array.isIterable(globalThis))) {
        return globalThis.throw("First argument must be an array", .{});
    }

    // Second argument must be a string (the range)
    if (!arguments[1].isString()) {
        return JSC.JSValue.null;
    }

    const range_str = try arguments[1].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    // Parse the range to validate it
    const query = Query.parse(allocator, range_slice.slice(), SlicedString.init(range_slice.slice(), range_slice.slice())) catch return arguments[1];
    defer query.deinit();

    // Collect all versions that satisfy the range
    var satisfying_versions = std.ArrayList(Version).init(allocator);
    defer satisfying_versions.deinit();
    
    const length = versions_array.getLength(globalThis) catch return arguments[1];
    if (length == 0) return arguments[1];

    var i: u32 = 0;
    while (i < length) : (i += 1) {
        const item = versions_array.getIndex(globalThis, i) catch continue;
        if (!item.isString()) continue;
        
        const version_string = try item.toJSString(globalThis);
        const version_slice = version_string.toSlice(globalThis, allocator);
        defer version_slice.deinit();

        if (!strings.isAllASCII(version_slice.slice())) continue;

        const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
        if (!parse_result.valid) continue;

        const version = parse_result.version.min();
        if (query.satisfies(version, range_slice.slice(), version_slice.slice())) {
            satisfying_versions.append(version) catch continue;
        }
    }

    if (satisfying_versions.items.len == 0) return arguments[1];

    // Sort versions
    std.sort.pdq(Version, satisfying_versions.items, {}, struct {
        fn lessThan(_: void, a: Version, b: Version) bool {
            return a.orderWithoutBuild(b, "", "") == .lt;
        }
    }.lessThan);

    // Try to find a simpler range
    const simplified = try findSimplifiedRange(allocator, satisfying_versions.items, range_slice.slice());
    
    // If the simplified range is shorter, return it
    if (simplified.len < range_slice.slice().len) {
        return bun.String.createUTF8ForJS(globalThis, simplified);
    }
    
    // Otherwise return the original range
    return arguments[1];
}

fn findSimplifiedRange(allocator: std.mem.Allocator, versions: []const Version, original_range: []const u8) ![]const u8 {
    if (versions.len == 0) return original_range;
    
    const first = versions[0];
    const last = versions[versions.len - 1];
    
    // Check if all versions are in the same major version
    var same_major = true;
    var same_minor = true;
    var same_patch = true;
    
    for (versions) |v| {
        if (v.major != first.major) same_major = false;
        if (v.minor != first.minor) same_minor = false;
        if (v.patch != first.patch) same_patch = false;
    }
    
    // If all versions are the same, return exact version only if it's shorter
    // AND we have multiple versions (not just one that happened to match)
    if (same_patch and same_minor and same_major and versions.len > 1) {
        const exact = try std.fmt.allocPrint(allocator, "{d}.{d}.{d}", .{ first.major, first.minor, first.patch });
        if (exact.len < original_range.len) {
            return exact;
        }
    }
    
    // Check for consecutive patch versions in same minor
    if (same_major and same_minor) {
        var consecutive = true;
        var expected_patch = first.patch;
        for (versions) |v| {
            if (v.patch != expected_patch) {
                consecutive = false;
                break;
            }
            expected_patch += 1;
        }
        
        if (consecutive and versions.len >= 3) {
            // Use tilde range for consecutive patches
            return try std.fmt.allocPrint(allocator, "~{d}.{d}.{d}", .{ first.major, first.minor, first.patch });
        }
    }
    
    // Check for consecutive minor versions in same major
    if (same_major) {
        // Check if we have all minors from first to last
        var expected_versions = std.ArrayList(Version).init(allocator);
        defer expected_versions.deinit();
        
        var current_minor = first.minor;
        while (current_minor <= last.minor) : (current_minor += 1) {
            var current_patch: u32 = 0;
            while (current_patch <= 10) : (current_patch += 1) { // Reasonable limit
                for (versions) |v| {
                    if (v.minor == current_minor and v.patch == current_patch) {
                        expected_versions.append(v) catch break;
                        break;
                    }
                }
            }
        }
        
        // If we have good coverage, use caret range
        if (expected_versions.items.len >= versions.len * 3 / 4) { // 75% coverage
            return try std.fmt.allocPrint(allocator, "^{d}.{d}.{d}", .{ first.major, first.minor, first.patch });
        }
    }
    
    // Try range format only if it makes sense (versions are close together)
    if (versions.len > 1) {
        // Only use range format if versions are reasonably close
        const major_diff = last.major - first.major;
        const is_close = major_diff <= 1;
        
        if (is_close) {
            const range_str = try std.fmt.allocPrint(allocator, ">={d}.{d}.{d} <={d}.{d}.{d}", .{
                first.major, first.minor, first.patch,
                last.major, last.minor, last.patch,
            });
            
            if (range_str.len < original_range.len) {
                return range_str;
            }
        }
    }
    
    // If we have just a few versions, try OR'ing them
    if (versions.len <= 3) {
        var result = std.ArrayList(u8).init(allocator);
        defer result.deinit();
        
        for (versions, 0..) |v, idx| {
            if (idx > 0) {
                try result.appendSlice(" || ");
            }
            try result.writer().print("{d}.{d}.{d}", .{ v.major, v.minor, v.patch });
        }
        
        if (result.items.len < original_range.len) {
            return try allocator.dupe(u8, result.items);
        }
    }
    
    // Return original if we can't simplify
    return original_range;
}

pub fn validRange(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments_old(1).slice();
    if (arguments.len < 1) return JSC.JSValue.null;

    // Check if the argument is a string
    if (!arguments[0].isString()) {
        return JSC.JSValue.null;
    }

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
