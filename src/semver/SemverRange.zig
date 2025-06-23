pub const Op = enum(u8) {
    unset = 0,
    eql = 1,
    lt = 3,
    lte = 4,
    gt = 5,
    gte = 6,
};

left: Comparator = .{},
right: Comparator = .{},

pub fn format(this: Range, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
    if (this.left.op == .unset and this.right.op == .unset) {
        return;
    }

    if (this.right.op == .unset) {
        try std.fmt.format(writer, "{}", .{this.left});
    } else {
        try std.fmt.format(writer, "{} {}", .{ this.left, this.right });
    }
}

/// *
/// >= 0.0.0
/// >= 0
/// >= 0.0
/// >= x
/// >= 0
pub fn anyRangeSatisfies(this: *const Range) bool {
    return this.left.op == .gte and this.left.version.eql(.{});
}

pub fn initWildcard(version: Version, wildcard: Query.Token.Wildcard) Range {
    switch (wildcard) {
        .none => {
            return .{
                .left = .{
                    .op = Op.eql,
                    .version = version,
                },
            };
        },

        .major => {
            return .{
                .left = .{
                    .op = Op.gte,
                    .version = .{
                        // .raw = version.raw
                    },
                },
            };
        },
        .minor => {
            const lhs = Version{
                .major = version.major +| 1,
                // .raw = version.raw
            };
            const rhs = Version{
                .major = version.major,
                // .raw = version.raw
            };
            return .{
                .left = .{
                    .op = Op.lt,
                    .version = lhs,
                },
                .right = .{
                    .op = Op.gte,
                    .version = rhs,
                },
            };
        },
        .patch => {
            const lhs = Version{
                .major = version.major,
                .minor = version.minor +| 1,
                // .raw = version.raw;
            };
            const rhs = Version{
                .major = version.major,
                .minor = version.minor,
                // .raw = version.raw;
            };
            return Range{
                .left = .{
                    .op = Op.lt,
                    .version = lhs,
                },
                .right = .{
                    .op = Op.gte,
                    .version = rhs,
                },
            };
        },
    }
}

pub inline fn hasLeft(this: Range) bool {
    return this.left.op != Op.unset;
}

pub inline fn hasRight(this: Range) bool {
    return this.right.op != Op.unset;
}

/// Is the Range equal to another Range
/// This does not evaluate the range.
pub inline fn eql(lhs: Range, rhs: Range) bool {
    return lhs.left.eql(rhs.left) and lhs.right.eql(rhs.right);
}

pub const Formatter = struct {
    buffer: []const u8,
    range: *const Range,

    pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (this.range.left.op == Op.unset and this.range.right.op == Op.unset) {
            return;
        }

        if (this.range.right.op == .unset) {
            try std.fmt.format(writer, "{}", .{this.range.left.fmt(this.buffer)});
        } else {
            try std.fmt.format(writer, "{} {}", .{ this.range.left.fmt(this.buffer), this.range.right.fmt(this.buffer) });
        }
    }
};

pub fn fmt(this: *const Range, buf: []const u8) @This().Formatter {
    return .{ .buffer = buf, .range = this };
}

pub const Comparator = struct {
    op: Op = .unset,
    version: Version = .{},

    pub inline fn eql(lhs: Comparator, rhs: Comparator) bool {
        return lhs.op == rhs.op and lhs.version.eql(rhs.version);
    }

    pub const Formatter = struct {
        buffer: []const u8,
        comparator: *const Comparator,

        pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            if (this.comparator.op == Op.unset) {
                return;
            }

            switch (this.comparator.op) {
                .unset => unreachable, // see above,
                .eql => try writer.writeAll("=="),
                .lt => try writer.writeAll("<"),
                .lte => try writer.writeAll("<="),
                .gt => try writer.writeAll(">"),
                .gte => try writer.writeAll(">="),
            }

            try std.fmt.format(writer, "{}", .{this.comparator.version.fmt(this.buffer)});
        }
    };

    pub fn fmt(this: *const Comparator, buf: []const u8) @This().Formatter {
        return .{ .buffer = buf, .comparator = this };
    }

    pub fn satisfies(
        comparator: Comparator,
        version: Version,
        comparator_buf: string,
        version_buf: string,
    ) bool {
        const order = version.orderWithoutBuild(comparator.version, version_buf, comparator_buf);

        return switch (order) {
            .eq => switch (comparator.op) {
                .lte, .gte, .eql => true,
                else => false,
            },
            .gt => switch (comparator.op) {
                .gt, .gte => true,
                else => false,
            },
            .lt => switch (comparator.op) {
                .lt, .lte => true,
                else => false,
            },
        };
    }
};

pub fn satisfies(range: Range, version: Version, range_buf: string, version_buf: string) bool {
    const has_left = range.hasLeft();
    const has_right = range.hasRight();

    if (!has_left) {
        return true;
    }

    if (!range.left.satisfies(version, range_buf, version_buf)) {
        return false;
    }

    if (has_right and !range.right.satisfies(version, range_buf, version_buf)) {
        return false;
    }

    return true;
}

pub fn satisfiesPre(range: Range, version: Version, range_buf: string, version_buf: string, pre_matched: *bool) bool {
    if (comptime Environment.allow_assert) {
        assert(version.tag.hasPre());
    }
    const has_left = range.hasLeft();
    const has_right = range.hasRight();

    if (!has_left) {
        return true;
    }

    // If left has prerelease check if major,minor,patch matches with left. If
    // not, check the same with right if right exists and has prerelease.
    pre_matched.* = pre_matched.* or
        (range.left.version.tag.hasPre() and
            version.patch == range.left.version.patch and
            version.minor == range.left.version.minor and
            version.major == range.left.version.major) or
        (has_right and
            range.right.version.tag.hasPre() and
            version.patch == range.right.version.patch and
            version.minor == range.right.version.minor and
            version.major == range.right.version.major);

    if (!range.left.satisfies(version, range_buf, version_buf)) {
        return false;
    }

    if (has_right and !range.right.satisfies(version, range_buf, version_buf)) {
        return false;
    }

    return true;
}

pub fn intersects(range1: *const Range, range2: *const Range, range1_buf: string, range2_buf: string) bool {

    // If either range has no constraints, they intersect
    if (!range1.hasLeft() or !range2.hasLeft()) {
        return true;
    }

    // Special case: if either range accepts any version (>= 0.0.0), they intersect
    if (range1.anyRangeSatisfies() or range2.anyRangeSatisfies()) {
        return true;
    }

    // For two ranges to intersect, there must exist at least one version that satisfies both
    // We need to check if the ranges overlap by examining their bounds

    // First, let's handle exact version matches (single comparator with op == eql)
    if (range1.left.op == .eql and !range1.hasRight() and range2.left.op == .eql and !range2.hasRight()) {
        // Both are exact versions, they only intersect if they're the same
        return range1.left.version.eql(range2.left.version);
    }

    // If one is an exact version and the other is a range, check if the exact version satisfies the range
    if (range1.left.op == .eql and !range1.hasRight()) {
        // range1 is an exact version, check if it satisfies range2
        return range2.satisfies(range1.left.version, range2_buf, range1_buf);
    }
    if (range2.left.op == .eql and !range2.hasRight()) {
        // range2 is an exact version, check if it satisfies range1
        return range1.satisfies(range2.left.version, range1_buf, range2_buf);
    }

    // Now handle general ranges
    // Two ranges intersect if their intervals overlap
    // We need to find the effective lower and upper bounds of each range

    // For range1
    var r1_has_lower = false;
    var r1_lower_version: Version = undefined;
    var r1_lower_inclusive = false;
    var r1_has_upper = false;
    var r1_upper_version: Version = undefined;
    var r1_upper_inclusive = false;

    if (range1.left.op == .gte or range1.left.op == .gt) {
        r1_has_lower = true;
        r1_lower_version = range1.left.version;
        r1_lower_inclusive = (range1.left.op == .gte);
    }

    if (range1.hasRight()) {
        if (range1.right.op == .lte or range1.right.op == .lt) {
            r1_has_upper = true;
            r1_upper_version = range1.right.version;
            r1_upper_inclusive = (range1.right.op == .lte);
        }
    } else if (range1.left.op == .lte or range1.left.op == .lt) {
        // Single comparator with upper bound
        r1_has_upper = true;
        r1_upper_version = range1.left.version;
        r1_upper_inclusive = (range1.left.op == .lte);
    }

    // For range2
    var r2_has_lower = false;
    var r2_lower_version: Version = undefined;
    var r2_lower_inclusive = false;
    var r2_has_upper = false;
    var r2_upper_version: Version = undefined;
    var r2_upper_inclusive = false;

    if (range2.left.op == .gte or range2.left.op == .gt) {
        r2_has_lower = true;
        r2_lower_version = range2.left.version;
        r2_lower_inclusive = (range2.left.op == .gte);
    }

    if (range2.hasRight()) {
        if (range2.right.op == .lte or range2.right.op == .lt) {
            r2_has_upper = true;
            r2_upper_version = range2.right.version;
            r2_upper_inclusive = (range2.right.op == .lte);
        }
    } else if (range2.left.op == .lte or range2.left.op == .lt) {
        // Single comparator with upper bound
        r2_has_upper = true;
        r2_upper_version = range2.left.version;
        r2_upper_inclusive = (range2.left.op == .lte);
    }

    // Check if the ranges overlap
    // Case 1: Both have lower and upper bounds
    if (r1_has_lower and r1_has_upper and r2_has_lower and r2_has_upper) {
        // Check if r1's upper is below r2's lower
        const r1_upper_vs_r2_lower = r1_upper_version.orderWithoutBuild(r2_lower_version, "", "");
        if (r1_upper_vs_r2_lower == .lt) return false;
        if (r1_upper_vs_r2_lower == .eq and (!r1_upper_inclusive or !r2_lower_inclusive)) return false;

        // Check if r2's upper is below r1's lower
        const r2_upper_vs_r1_lower = r2_upper_version.orderWithoutBuild(r1_lower_version, "", "");
        if (r2_upper_vs_r1_lower == .lt) return false;
        if (r2_upper_vs_r1_lower == .eq and (!r2_upper_inclusive or !r1_lower_inclusive)) return false;

        return true;
    }

    // Case 2: One or both ranges are unbounded on one side
    if (r1_has_lower and r2_has_upper) {
        // Check if r2's upper is below r1's lower
        const order = r2_upper_version.orderWithoutBuild(r1_lower_version, "", "");
        if (order == .lt) return false;
        if (order == .eq and (!r2_upper_inclusive or !r1_lower_inclusive)) return false;
    }

    if (r2_has_lower and r1_has_upper) {
        // Check if r1's upper is below r2's lower
        const order = r1_upper_version.orderWithoutBuild(r2_lower_version, "", "");
        if (order == .lt) return false;
        if (order == .eq and (!r1_upper_inclusive or !r2_lower_inclusive)) return false;
    }

    // If we get here, the ranges intersect
    return true;
}

const Range = @This();

const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const Environment = bun.Environment;

const Version = bun.Semver.Version;
const Query = bun.Semver.Query;
const assert = bun.assert;
