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

const Range = @This();

const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const Environment = bun.Environment;

const Version = bun.Semver.Version;
const Query = bun.Semver.Query;
const assert = bun.assert;
