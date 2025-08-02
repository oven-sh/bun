const SemverObject = @This();

pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = jsc.JSValue.createEmptyObject(globalThis, 13);

    object.put(
        globalThis,
        jsc.ZigString.static("satisfies"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("satisfies"),
            2,
            SemverObject.satisfies,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("order"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("order"),
            2,
            SemverObject.order,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("major"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("major"),
            1,
            SemverObject.major,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("minor"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("minor"),
            1,
            SemverObject.minor,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("patch"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("patch"),
            1,
            SemverObject.patch,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("parse"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("parse"),
            1,
            SemverObject.parse,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("prerelease"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("prerelease"),
            1,
            SemverObject.prerelease,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("bump"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("bump"),
            3,
            SemverObject.bump,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("intersects"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("intersects"),
            2,
            SemverObject.intersects,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("maxSatisfying"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("maxSatisfying"),
            2,
            SemverObject.maxSatisfying,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("minSatisfying"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("minSatisfying"),
            2,
            SemverObject.minSatisfying,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("simplifyRange"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("simplifyRange"),
            2,
            SemverObject.simplifyRange,
            false,
        ),
    );

    object.put(
        globalThis,
        jsc.ZigString.static("validRange"),
        jsc.host_fn.NewFunction(
            globalThis,
            jsc.ZigString.static("validRange"),
            1,
            SemverObject.validRange,
            false,
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

    const arguments = callFrame.arguments();
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

    const arguments = callFrame.arguments();
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

// Add a helper to reduce boilerplate for major, minor, patch
fn getVersionComponent(
    globalThis: *jsc.JSGlobalObject,
    callFrame: *jsc.CallFrame,
    comptime component: enum { major, minor, patch },
) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(512, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments();
    if (arguments.len < 1) {
        return jsc.JSValue.jsNull();
    }

    // Check if the argument is a string
    if (!arguments[0].isString()) {
        return jsc.JSValue.jsNull();
    }

    const arg_string = try arguments[0].toJSString(globalThis);
    const version_slice = arg_string.toSlice(globalThis, allocator);
    defer version_slice.deinit();

    if (!strings.isAllASCII(version_slice.slice())) return jsc.JSValue.jsNull();

    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid) {
        return jsc.JSValue.jsNull();
    }

    const version = parse_result.version;
    return switch (component) {
        .major => jsc.JSValue.jsNumber(version.major orelse 0),
        .minor => jsc.JSValue.jsNumber(version.minor orelse 0),
        .patch => jsc.JSValue.jsNumber(version.patch orelse 0),
    };
}

pub fn major(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return getVersionComponent(globalThis, callFrame, .major);
}

pub fn minor(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return getVersionComponent(globalThis, callFrame, .minor);
}

pub fn patch(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return getVersionComponent(globalThis, callFrame, .patch);
}

pub fn prerelease(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(512, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments();
    if (arguments.len < 1) {
        return jsc.JSValue.jsNull();
    }

    // Check if the argument is a string
    if (!arguments[0].isString()) {
        return jsc.JSValue.jsNull();
    }

    const arg_string = try arguments[0].toJSString(globalThis);
    const version_slice = arg_string.toSlice(globalThis, allocator);
    defer version_slice.deinit();

    if (!strings.isAllASCII(version_slice.slice())) return jsc.JSValue.jsNull();

    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid) {
        return jsc.JSValue.jsNull();
    }

    const version = parse_result.version;
    if (!version.tag.hasPre()) {
        return jsc.JSValue.jsNull();
    }

    return try version.tag.toComponentsArray(true, globalThis, version_slice.slice());
}

pub fn parse(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments();
    if (arguments.len < 1) {
        return jsc.JSValue.jsNull();
    }

    // Check if the argument is a string
    if (!arguments[0].isString()) {
        return jsc.JSValue.jsNull();
    }

    const arg_string = try arguments[0].toJSString(globalThis);
    const version_slice = arg_string.toSlice(globalThis, allocator);
    defer version_slice.deinit();

    if (!strings.isAllASCII(version_slice.slice())) return jsc.JSValue.jsNull();

    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid) {
        return jsc.JSValue.jsNull();
    }

    const version = parse_result.version;
    const obj = jsc.JSValue.createEmptyObject(globalThis, 7);

    obj.put(globalThis, jsc.ZigString.static("major"), jsc.JSValue.jsNumber(version.major orelse 0));
    obj.put(globalThis, jsc.ZigString.static("minor"), jsc.JSValue.jsNumber(version.minor orelse 0));
    obj.put(globalThis, jsc.ZigString.static("patch"), jsc.JSValue.jsNumber(version.patch orelse 0));

    // Handle prerelease
    if (version.tag.hasPre()) {
        obj.put(globalThis, jsc.ZigString.static("prerelease"), try version.tag.toComponentsArray(true, globalThis, version_slice.slice()));
    } else {
        obj.put(globalThis, jsc.ZigString.static("prerelease"), jsc.JSValue.jsNull());
    }

    // Handle build
    if (version.tag.hasBuild()) {
        obj.put(globalThis, jsc.ZigString.static("build"), try version.tag.toComponentsArray(false, globalThis, version_slice.slice()));
    } else {
        obj.put(globalThis, jsc.ZigString.static("build"), jsc.JSValue.jsNull());
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

    obj.put(globalThis, jsc.ZigString.static("version"), try bun.String.createUTF8ForJS(globalThis, version_str.items));

    // Store raw input
    obj.put(globalThis, jsc.ZigString.static("raw"), arguments[0]);

    return obj;
}

pub fn bump(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments();
    if (arguments.len < 2) return jsc.JSValue.jsNull();

    // Check if the first argument is a string
    if (!arguments[0].isString()) {
        return jsc.JSValue.jsNull();
    }

    // Check if the second argument is a string
    if (!arguments[1].isString()) {
        return jsc.JSValue.jsNull();
    }

    const version_str = try arguments[0].toJSString(globalThis);
    const version_slice = version_str.toSlice(globalThis, allocator);
    defer version_slice.deinit();

    const release_str = try arguments[1].toJSString(globalThis);
    const release_slice = release_str.toSlice(globalThis, allocator);
    defer release_slice.deinit();

    const parse_result = Version.parse(SlicedString.init(version_slice.slice(), version_slice.slice()));
    if (!parse_result.valid) return jsc.JSValue.jsNull();

    const release_type = Version.ReleaseType.fromString(release_slice.slice()) orelse return jsc.JSValue.jsNull();

    var identifier_slice: jsc.ZigString.Slice = .empty;
    defer identifier_slice.deinit();

    if (arguments.len > 2 and !arguments[2].isUndefinedOrNull()) {
        const id_str = try arguments[2].toJSString(globalThis);
        identifier_slice = id_str.toSlice(globalThis, allocator);
    }

    const new_version_str = parse_result.version.min().bump(allocator, release_type, identifier_slice.slice(), version_slice.slice()) catch return jsc.JSValue.jsNull();
    defer allocator.free(new_version_str);

    return bun.String.createUTF8ForJS(globalThis, new_version_str);
}

pub fn intersects(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments();
    if (arguments.len < 2) return jsc.JSValue.jsBoolean(false);

    // Check if both arguments are strings
    if (!arguments[0].isString() or !arguments[1].isString()) {
        return jsc.JSValue.jsBoolean(false);
    }

    const r1_str = try arguments[0].toJSString(globalThis);
    const r1_slice = r1_str.toSlice(globalThis, allocator);
    defer r1_slice.deinit();

    const r2_str = try arguments[1].toJSString(globalThis);
    const r2_slice = r2_str.toSlice(globalThis, allocator);
    defer r2_slice.deinit();

    // Check for empty strings
    if (r1_slice.slice().len == 0 or r2_slice.slice().len == 0) {
        return jsc.JSValue.jsBoolean(false);
    }

    const g1 = Query.parse(allocator, r1_slice.slice(), SlicedString.init(r1_slice.slice(), r1_slice.slice())) catch return jsc.JSValue.jsBoolean(false);
    defer g1.deinit();

    const g2 = Query.parse(allocator, r2_slice.slice(), SlicedString.init(r2_slice.slice(), r2_slice.slice())) catch return jsc.JSValue.jsBoolean(false);
    defer g2.deinit();

    return jsc.JSValue.jsBoolean(g1.intersects(&g2, r1_slice.slice(), r2_slice.slice()));
}

fn findSatisfyingVersion(
    globalThis: *jsc.JSGlobalObject,
    versions_array: jsc.JSValue,
    range_str: []const u8,
    allocator: std.mem.Allocator,
    comptime find_max: bool,
) bun.JSError!jsc.JSValue {
    const query = (Query.parse(allocator, range_str, SlicedString.init(range_str, range_str)) catch return jsc.JSValue.jsNull());
    defer query.deinit();

    const length = versions_array.getLength(globalThis) catch return jsc.JSValue.jsNull();
    if (length == 0) return jsc.JSValue.jsNull();

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

    return if (best) |b| (versions_array.getIndex(globalThis, b.index) catch jsc.JSValue.jsNull()) else jsc.JSValue.jsNull();
}

pub fn maxSatisfying(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments();
    if (arguments.len < 1) return jsc.JSValue.jsNull();

    const versions_array = arguments[0];
    if (!versions_array.isObject() or !(try versions_array.isIterable(globalThis))) {
        return globalThis.throw("First argument must be an array", .{});
    }

    if (arguments.len < 2) return jsc.JSValue.jsNull();

    // Check if the second argument is a string
    if (!arguments[1].isString()) {
        return jsc.JSValue.jsNull();
    }

    const range_str = try arguments[1].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    // Check for empty range
    if (range_slice.slice().len == 0) {
        return jsc.JSValue.jsNull();
    }

    return findSatisfyingVersion(globalThis, versions_array, range_slice.slice(), allocator, true);
}

pub fn minSatisfying(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments();
    if (arguments.len < 1) return jsc.JSValue.jsNull();

    const versions_array = arguments[0];
    if (!versions_array.isObject() or !(try versions_array.isIterable(globalThis))) {
        return globalThis.throw("First argument must be an array", .{});
    }

    if (arguments.len < 2) return jsc.JSValue.jsNull();

    // Check if the second argument is a string
    if (!arguments[1].isString()) {
        return jsc.JSValue.jsNull();
    }

    const range_str = try arguments[1].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    return findSatisfyingVersion(globalThis, versions_array, range_slice.slice(), allocator, false);
}

pub fn simplifyRange(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(2048, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments();
    if (arguments.len < 2) return jsc.JSValue.jsNull();

    // First argument must be an array
    const versions_array = arguments[0];
    if (!versions_array.isObject() or !(try versions_array.isIterable(globalThis))) {
        return globalThis.throw("First argument must be an array", .{});
    }

    // Second argument must be a string (the range)
    if (!arguments[1].isString()) {
        return jsc.JSValue.jsNull();
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
                last.major,  last.minor,  last.patch,
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

pub fn validRange(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack_fallback.get();

    const arguments = callFrame.arguments();
    if (arguments.len < 1) return jsc.JSValue.jsNull();

    // Check if the argument is a string
    if (!arguments[0].isString()) {
        return jsc.JSValue.jsNull();
    }

    const range_str = try arguments[0].toJSString(globalThis);
    const range_slice = range_str.toSlice(globalThis, allocator);
    defer range_slice.deinit();

    // Try to parse the range
    const query = Query.parse(allocator, range_slice.slice(), SlicedString.init(range_slice.slice(), range_slice.slice())) catch return jsc.JSValue.jsNull();
    defer query.deinit();

    // Check if the query has any meaningful content
    // If it's empty or has no valid range, it's invalid
    if (!query.head.head.range.hasLeft() and !query.head.head.range.hasRight()) {
        return jsc.JSValue.jsNull();
    }

    // If it parses successfully and has content, return the normalized range string
    return arguments[0];
}

const std = @import("std");

const bun = @import("bun");
const default_allocator = bun.default_allocator;
const jsc = bun.jsc;
const strings = bun.strings;

const Query = bun.Semver.Query;
const SlicedString = bun.Semver.SlicedString;
const Version = bun.Semver.Version;
