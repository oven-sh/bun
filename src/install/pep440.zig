//! PEP 440 Version Parsing and Comparison
//!
//! Implements version parsing and range matching according to PEP 440:
//! https://peps.python.org/pep-0440/
//!
//! Version format: [N!]N(.N)*[{a|b|rc}N][.postN][.devN][+local]
//! Examples: 1.0, 2.0.0, 1.0a1, 1.0b2, 1.0rc1, 1.0.post1, 1.0.dev1, 1.0+local
//!
//! Specifier operators: ==, !=, <=, >=, <, >, ~=, ===

const Pep440 = @This();

const std = @import("std");

/// PEP 440 Version
/// Stores version components for comparison
pub const Version = struct {
    /// Epoch (rarely used, default 0)
    epoch: u32 = 0,
    /// Release segments (e.g., [1, 2, 3] for "1.2.3")
    /// We store up to 4 segments inline for common cases
    major: u32 = 0,
    minor: u32 = 0,
    micro: u32 = 0,
    extra: u32 = 0,
    /// Number of release segments (1-4 for inline, 0 means unset)
    segment_count: u8 = 0,

    /// Pre-release type
    pre_type: PreType = .none,
    /// Pre-release number (e.g., 1 for "a1")
    pre_num: u32 = 0,

    /// Post-release number (0 means no post-release)
    post: u32 = 0,
    /// Whether .post was explicitly specified
    has_post: bool = false,

    /// Dev release number (0 means no dev release)
    dev: u32 = 0,
    /// Whether .dev was explicitly specified
    has_dev: bool = false,

    pub const PreType = enum(u8) {
        none = 0,
        dev = 1, // .devN (lowest precedence in pre-releases)
        alpha = 2, // aN or alphaN
        beta = 3, // bN or betaN
        rc = 4, // rcN or cN
        final = 5, // no pre-release suffix (highest)
    };

    /// Compare two versions
    /// Returns: .lt, .eq, or .gt
    pub fn order(self: Version, other: Version) std.math.Order {
        // Compare epoch first
        if (self.epoch != other.epoch) {
            return std.math.order(self.epoch, other.epoch);
        }

        // Compare release segments
        const self_segments = [4]u32{ self.major, self.minor, self.micro, self.extra };
        const other_segments = [4]u32{ other.major, other.minor, other.micro, other.extra };

        const max_segments = @max(self.segment_count, other.segment_count);
        var i: usize = 0;
        while (i < max_segments) : (i += 1) {
            const self_seg = if (i < self.segment_count) self_segments[i] else 0;
            const other_seg = if (i < other.segment_count) other_segments[i] else 0;
            if (self_seg != other_seg) {
                return std.math.order(self_seg, other_seg);
            }
        }

        // Compare pre-release (none/final > rc > beta > alpha > dev)
        // But dev without pre-release is LESS than final
        const self_pre = self.effectivePreType();
        const other_pre = other.effectivePreType();

        if (@intFromEnum(self_pre) != @intFromEnum(other_pre)) {
            return std.math.order(@intFromEnum(self_pre), @intFromEnum(other_pre));
        }

        // Same pre-type, compare pre-number
        if (self_pre != .none and self_pre != .final) {
            if (self.pre_num != other.pre_num) {
                return std.math.order(self.pre_num, other.pre_num);
            }
        }

        // Compare post-release
        if (self.has_post != other.has_post) {
            return if (self.has_post) .gt else .lt;
        }
        if (self.has_post and self.post != other.post) {
            return std.math.order(self.post, other.post);
        }

        // Compare dev release (has_dev means it's a dev version, which is less than non-dev)
        if (self.has_dev != other.has_dev) {
            return if (self.has_dev) .lt else .gt;
        }
        if (self.has_dev and self.dev != other.dev) {
            return std.math.order(self.dev, other.dev);
        }

        return .eq;
    }

    fn effectivePreType(self: Version) PreType {
        if (self.pre_type != .none) return self.pre_type;
        // If no pre-release suffix, it's a final release
        return .final;
    }

    pub fn eql(self: Version, other: Version) bool {
        return self.order(other) == .eq;
    }

    /// Parse a PEP 440 version string
    pub fn parse(input: []const u8) ?Version {
        var result = Version{};
        var remaining = input;

        // Skip leading 'v' or 'V' if present (common but not in spec)
        if (remaining.len > 0 and (remaining[0] == 'v' or remaining[0] == 'V')) {
            remaining = remaining[1..];
        }

        // Parse epoch (N!)
        if (std.mem.indexOfScalar(u8, remaining, '!')) |bang_idx| {
            result.epoch = std.fmt.parseInt(u32, remaining[0..bang_idx], 10) catch return null;
            remaining = remaining[bang_idx + 1 ..];
        }

        // Parse release segments (N.N.N...)
        var segment_idx: u8 = 0;
        while (remaining.len > 0 and segment_idx < 4) {
            // Find end of this segment
            var seg_end: usize = 0;
            while (seg_end < remaining.len and remaining[seg_end] >= '0' and remaining[seg_end] <= '9') {
                seg_end += 1;
            }

            if (seg_end == 0) break; // No more digits

            const segment = std.fmt.parseInt(u32, remaining[0..seg_end], 10) catch return null;

            switch (segment_idx) {
                0 => result.major = segment,
                1 => result.minor = segment,
                2 => result.micro = segment,
                3 => result.extra = segment,
                else => {},
            }
            segment_idx += 1;
            result.segment_count = segment_idx;

            remaining = remaining[seg_end..];

            // Check for dot separator
            if (remaining.len > 0 and remaining[0] == '.') {
                // Peek ahead - if next char is a digit, continue parsing segments
                if (remaining.len > 1 and remaining[1] >= '0' and remaining[1] <= '9') {
                    remaining = remaining[1..];
                    continue;
                }
            }
            break;
        }

        if (result.segment_count == 0) return null;

        // Parse pre-release, post-release, dev, local
        while (remaining.len > 0) {
            // Skip separator (., -, _)
            if (remaining[0] == '.' or remaining[0] == '-' or remaining[0] == '_') {
                remaining = remaining[1..];
                if (remaining.len == 0) break;
            }

            // Local version (+...)
            if (remaining[0] == '+') {
                // We don't store local version for comparison purposes
                break;
            }

            // Pre-release: a, alpha, b, beta, c, rc, preview, pre
            if (parsePreRelease(remaining)) |pre_result| {
                result.pre_type = pre_result.pre_type;
                result.pre_num = pre_result.pre_num;
                remaining = pre_result.remaining;
                continue;
            }

            // Post-release: post, rev, r
            if (parsePostRelease(remaining)) |post_result| {
                result.has_post = true;
                result.post = post_result.post;
                remaining = post_result.remaining;
                continue;
            }

            // Dev release: dev
            if (parseDevRelease(remaining)) |dev_result| {
                result.has_dev = true;
                result.dev = dev_result.dev;
                remaining = dev_result.remaining;
                continue;
            }

            // Unknown suffix, stop parsing
            break;
        }

        return result;
    }

    const PreResult = struct {
        pre_type: PreType,
        pre_num: u32,
        remaining: []const u8,
    };

    fn parsePreRelease(input: []const u8) ?PreResult {
        const prefixes = [_]struct { prefix: []const u8, pre_type: PreType }{
            .{ .prefix = "alpha", .pre_type = .alpha },
            .{ .prefix = "beta", .pre_type = .beta },
            .{ .prefix = "preview", .pre_type = .rc },
            .{ .prefix = "pre", .pre_type = .rc },
            .{ .prefix = "rc", .pre_type = .rc },
            .{ .prefix = "a", .pre_type = .alpha },
            .{ .prefix = "b", .pre_type = .beta },
            .{ .prefix = "c", .pre_type = .rc },
        };

        for (prefixes) |p| {
            if (startsWithIgnoreCase(input, p.prefix)) {
                var remaining = input[p.prefix.len..];
                // Skip optional separator
                if (remaining.len > 0 and (remaining[0] == '.' or remaining[0] == '-' or remaining[0] == '_')) {
                    remaining = remaining[1..];
                }
                // Parse number
                var num_end: usize = 0;
                while (num_end < remaining.len and remaining[num_end] >= '0' and remaining[num_end] <= '9') {
                    num_end += 1;
                }
                const num = if (num_end > 0)
                    std.fmt.parseInt(u32, remaining[0..num_end], 10) catch 0
                else
                    0;

                return .{
                    .pre_type = p.pre_type,
                    .pre_num = num,
                    .remaining = remaining[num_end..],
                };
            }
        }
        return null;
    }

    const PostResult = struct {
        post: u32,
        remaining: []const u8,
    };

    fn parsePostRelease(input: []const u8) ?PostResult {
        const prefixes = [_][]const u8{ "post", "rev", "r" };

        for (prefixes) |prefix| {
            if (startsWithIgnoreCase(input, prefix)) {
                var remaining = input[prefix.len..];
                // Skip optional separator
                if (remaining.len > 0 and (remaining[0] == '.' or remaining[0] == '-' or remaining[0] == '_')) {
                    remaining = remaining[1..];
                }
                // Parse number
                var num_end: usize = 0;
                while (num_end < remaining.len and remaining[num_end] >= '0' and remaining[num_end] <= '9') {
                    num_end += 1;
                }
                const num = if (num_end > 0)
                    std.fmt.parseInt(u32, remaining[0..num_end], 10) catch 0
                else
                    0;

                return .{
                    .post = num,
                    .remaining = remaining[num_end..],
                };
            }
        }
        return null;
    }

    const DevResult = struct {
        dev: u32,
        remaining: []const u8,
    };

    fn parseDevRelease(input: []const u8) ?DevResult {
        if (startsWithIgnoreCase(input, "dev")) {
            var remaining = input[3..];
            // Skip optional separator
            if (remaining.len > 0 and (remaining[0] == '.' or remaining[0] == '-' or remaining[0] == '_')) {
                remaining = remaining[1..];
            }
            // Parse number
            var num_end: usize = 0;
            while (num_end < remaining.len and remaining[num_end] >= '0' and remaining[num_end] <= '9') {
                num_end += 1;
            }
            const num = if (num_end > 0)
                std.fmt.parseInt(u32, remaining[0..num_end], 10) catch 0
            else
                0;

            return .{
                .dev = num,
                .remaining = remaining[num_end..],
            };
        }
        return null;
    }

    fn startsWithIgnoreCase(haystack: []const u8, needle: []const u8) bool {
        if (haystack.len < needle.len) return false;
        for (haystack[0..needle.len], needle) |h, n| {
            if (std.ascii.toLower(h) != std.ascii.toLower(n)) return false;
        }
        return true;
    }

    pub fn format(self: Version, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (self.epoch != 0) {
            try writer.print("{d}!", .{self.epoch});
        }

        try writer.print("{d}", .{self.major});
        if (self.segment_count >= 2) try writer.print(".{d}", .{self.minor});
        if (self.segment_count >= 3) try writer.print(".{d}", .{self.micro});
        if (self.segment_count >= 4) try writer.print(".{d}", .{self.extra});

        switch (self.pre_type) {
            .alpha => try writer.print("a{d}", .{self.pre_num}),
            .beta => try writer.print("b{d}", .{self.pre_num}),
            .rc => try writer.print("rc{d}", .{self.pre_num}),
            .dev => try writer.print(".dev{d}", .{self.dev}),
            .none, .final => {},
        }

        if (self.has_post) {
            try writer.print(".post{d}", .{self.post});
        }

        if (self.has_dev and self.pre_type != .dev) {
            try writer.print(".dev{d}", .{self.dev});
        }
    }
};

/// Comparison operator
pub const Op = enum(u8) {
    unset = 0,
    /// == (exact match, or prefix match with .*)
    eql = 1,
    /// !=
    neq = 2,
    /// <
    lt = 3,
    /// <=
    lte = 4,
    /// >
    gt = 5,
    /// >=
    gte = 6,
    /// ~= (compatible release)
    compat = 7,
    /// === (arbitrary equality, string match)
    arbitrary = 8,
};

/// A single version specifier (e.g., ">=1.0" or "!=1.5.0")
pub const Specifier = struct {
    op: Op = .unset,
    version: Version = .{},
    /// For == with wildcard (e.g., ==1.0.*)
    /// 0 = no wildcard, 1 = major.*, 2 = major.minor.*, etc.
    wildcard_segments: u8 = 0,

    /// Check if a version satisfies this specifier
    pub fn satisfies(self: Specifier, version: Version) bool {
        if (self.op == .unset) return true;

        const cmp = version.order(self.version);

        return switch (self.op) {
            .unset => true,
            .eql => if (self.wildcard_segments > 0)
                self.wildcardMatch(version)
            else
                cmp == .eq,
            .neq => if (self.wildcard_segments > 0)
                !self.wildcardMatch(version)
            else
                cmp != .eq,
            .lt => cmp == .lt,
            .lte => cmp == .lt or cmp == .eq,
            .gt => cmp == .gt,
            .gte => cmp == .gt or cmp == .eq,
            .compat => self.compatibleMatch(version),
            .arbitrary => false, // Not supported, would need string comparison
        };
    }

    fn wildcardMatch(self: Specifier, version: Version) bool {
        // Match up to wildcard_segments
        const self_segs = [4]u32{ self.version.major, self.version.minor, self.version.micro, self.version.extra };
        const other_segs = [4]u32{ version.major, version.minor, version.micro, version.extra };

        var i: usize = 0;
        while (i < self.wildcard_segments) : (i += 1) {
            if (self_segs[i] != other_segs[i]) return false;
        }
        return true;
    }

    fn compatibleMatch(self: Specifier, version: Version) bool {
        // ~=X.Y is equivalent to >=X.Y,<(X+1).0
        // ~=X.Y.Z is equivalent to >=X.Y.Z,<X.(Y+1).0
        const cmp = version.order(self.version);
        if (cmp == .lt) return false;

        // Check upper bound
        var upper = self.version;
        if (self.version.segment_count >= 2) {
            // Increment the second-to-last segment
            if (self.version.segment_count == 2) {
                upper.major += 1;
                upper.minor = 0;
            } else if (self.version.segment_count == 3) {
                upper.minor += 1;
                upper.micro = 0;
            } else {
                upper.micro += 1;
                upper.extra = 0;
            }
        } else {
            // Single segment version, no upper bound restriction
            return true;
        }

        return version.order(upper) == .lt;
    }
};

/// A version range consisting of multiple specifiers (AND'd together)
/// e.g., ">=1.0,<2.0,!=1.5.0"
pub const Range = struct {
    /// Specifiers are AND'd together (all must match)
    /// Stored inline for common case (up to 4 specifiers)
    specs: [4]Specifier = [_]Specifier{.{}} ** 4,
    count: u8 = 0,

    /// Parse a version range string
    /// e.g., ">=1.0,<2.0" or "~=1.4.2" or ">=1.0,!=1.5.0"
    pub fn parse(input: []const u8) ?Range {
        var result = Range{};
        var remaining = std.mem.trim(u8, input, " \t\n\r");

        while (remaining.len > 0 and result.count < 4) {
            // Skip whitespace and commas
            while (remaining.len > 0 and (remaining[0] == ',' or remaining[0] == ' ')) {
                remaining = remaining[1..];
            }
            if (remaining.len == 0) break;

            // Parse operator
            var spec = Specifier{};

            if (std.mem.startsWith(u8, remaining, "===")) {
                spec.op = .arbitrary;
                remaining = remaining[3..];
            } else if (std.mem.startsWith(u8, remaining, "==")) {
                spec.op = .eql;
                remaining = remaining[2..];
            } else if (std.mem.startsWith(u8, remaining, "!=")) {
                spec.op = .neq;
                remaining = remaining[2..];
            } else if (std.mem.startsWith(u8, remaining, "~=")) {
                spec.op = .compat;
                remaining = remaining[2..];
            } else if (std.mem.startsWith(u8, remaining, "<=")) {
                spec.op = .lte;
                remaining = remaining[2..];
            } else if (std.mem.startsWith(u8, remaining, ">=")) {
                spec.op = .gte;
                remaining = remaining[2..];
            } else if (std.mem.startsWith(u8, remaining, "<")) {
                spec.op = .lt;
                remaining = remaining[1..];
            } else if (std.mem.startsWith(u8, remaining, ">")) {
                spec.op = .gt;
                remaining = remaining[1..];
            } else {
                // No operator means implicit ==
                spec.op = .eql;
            }

            // Skip whitespace after operator
            remaining = std.mem.trim(u8, remaining, " \t\n\r");

            // Find end of version (comma or end of string)
            var ver_end: usize = 0;
            while (ver_end < remaining.len and remaining[ver_end] != ',') {
                ver_end += 1;
            }

            var ver_str = std.mem.trim(u8, remaining[0..ver_end], " \t\n\r");

            // Check for wildcard (e.g., ==1.0.*)
            if (ver_str.len > 2 and std.mem.endsWith(u8, ver_str, ".*")) {
                // Count segments before .*
                var seg_count: u8 = 1;
                for (ver_str[0 .. ver_str.len - 2]) |c| {
                    if (c == '.') seg_count += 1;
                }
                spec.wildcard_segments = seg_count;
                ver_str = ver_str[0 .. ver_str.len - 2];
            }

            // Parse version
            if (Version.parse(ver_str)) |v| {
                spec.version = v;
            } else {
                return null;
            }

            result.specs[result.count] = spec;
            result.count += 1;

            remaining = remaining[ver_end..];
        }

        return if (result.count > 0) result else null;
    }

    /// Check if a version satisfies all specifiers in this range
    pub fn satisfies(self: Range, version: Version) bool {
        if (self.count == 0) return true;

        for (self.specs[0..self.count]) |spec| {
            if (!spec.satisfies(version)) return false;
        }
        return true;
    }

    /// Check if this is a "match any" range (empty or *)
    pub fn isAny(self: Range) bool {
        return self.count == 0;
    }
};

// ============================================================================
// Tests
// ============================================================================

test "Version.parse basic" {
    const v1 = Version.parse("1.0").?;
    try std.testing.expectEqual(@as(u32, 1), v1.major);
    try std.testing.expectEqual(@as(u32, 0), v1.minor);
    try std.testing.expectEqual(@as(u8, 2), v1.segment_count);

    const v2 = Version.parse("1.2.3").?;
    try std.testing.expectEqual(@as(u32, 1), v2.major);
    try std.testing.expectEqual(@as(u32, 2), v2.minor);
    try std.testing.expectEqual(@as(u32, 3), v2.micro);
    try std.testing.expectEqual(@as(u8, 3), v2.segment_count);

    const v3 = Version.parse("2.0.0.1").?;
    try std.testing.expectEqual(@as(u32, 2), v3.major);
    try std.testing.expectEqual(@as(u32, 0), v3.minor);
    try std.testing.expectEqual(@as(u32, 0), v3.micro);
    try std.testing.expectEqual(@as(u32, 1), v3.extra);
    try std.testing.expectEqual(@as(u8, 4), v3.segment_count);
}

test "Version.parse pre-release" {
    const v1 = Version.parse("1.0a1").?;
    try std.testing.expectEqual(Version.PreType.alpha, v1.pre_type);
    try std.testing.expectEqual(@as(u32, 1), v1.pre_num);

    const v2 = Version.parse("1.0b2").?;
    try std.testing.expectEqual(Version.PreType.beta, v2.pre_type);
    try std.testing.expectEqual(@as(u32, 2), v2.pre_num);

    const v3 = Version.parse("1.0rc1").?;
    try std.testing.expectEqual(Version.PreType.rc, v3.pre_type);
    try std.testing.expectEqual(@as(u32, 1), v3.pre_num);

    const v4 = Version.parse("1.0.alpha.2").?;
    try std.testing.expectEqual(Version.PreType.alpha, v4.pre_type);
    try std.testing.expectEqual(@as(u32, 2), v4.pre_num);
}

test "Version.parse post and dev" {
    const v1 = Version.parse("1.0.post1").?;
    try std.testing.expect(v1.has_post);
    try std.testing.expectEqual(@as(u32, 1), v1.post);

    const v2 = Version.parse("1.0.dev1").?;
    try std.testing.expect(v2.has_dev);
    try std.testing.expectEqual(@as(u32, 1), v2.dev);

    const v3 = Version.parse("1.0a1.post2.dev3").?;
    try std.testing.expectEqual(Version.PreType.alpha, v3.pre_type);
    try std.testing.expectEqual(@as(u32, 1), v3.pre_num);
    try std.testing.expect(v3.has_post);
    try std.testing.expectEqual(@as(u32, 2), v3.post);
    try std.testing.expect(v3.has_dev);
    try std.testing.expectEqual(@as(u32, 3), v3.dev);
}

test "Version.parse epoch" {
    const v1 = Version.parse("1!2.0").?;
    try std.testing.expectEqual(@as(u32, 1), v1.epoch);
    try std.testing.expectEqual(@as(u32, 2), v1.major);
    try std.testing.expectEqual(@as(u32, 0), v1.minor);
}

test "Version.order" {
    const v1 = Version.parse("1.0").?;
    const v2 = Version.parse("2.0").?;
    try std.testing.expectEqual(std.math.Order.lt, v1.order(v2));
    try std.testing.expectEqual(std.math.Order.gt, v2.order(v1));
    try std.testing.expectEqual(std.math.Order.eq, v1.order(v1));

    // Pre-release < final
    const v3 = Version.parse("1.0a1").?;
    const v4 = Version.parse("1.0").?;
    try std.testing.expectEqual(std.math.Order.lt, v3.order(v4));

    // alpha < beta < rc
    const va = Version.parse("1.0a1").?;
    const vb = Version.parse("1.0b1").?;
    const vrc = Version.parse("1.0rc1").?;
    try std.testing.expectEqual(std.math.Order.lt, va.order(vb));
    try std.testing.expectEqual(std.math.Order.lt, vb.order(vrc));

    // dev < final
    const vdev = Version.parse("1.0.dev1").?;
    const vfinal = Version.parse("1.0").?;
    try std.testing.expectEqual(std.math.Order.lt, vdev.order(vfinal));

    // post > final
    const vpost = Version.parse("1.0.post1").?;
    try std.testing.expectEqual(std.math.Order.gt, vpost.order(vfinal));
}

test "Range.parse and satisfies" {
    // Simple >= range
    const r1 = Range.parse(">=1.0").?;
    try std.testing.expect(r1.satisfies(Version.parse("1.0").?));
    try std.testing.expect(r1.satisfies(Version.parse("2.0").?));
    try std.testing.expect(!r1.satisfies(Version.parse("0.9").?));

    // Combined range
    const r2 = Range.parse(">=1.0,<2.0").?;
    try std.testing.expect(r2.satisfies(Version.parse("1.0").?));
    try std.testing.expect(r2.satisfies(Version.parse("1.5").?));
    try std.testing.expect(!r2.satisfies(Version.parse("2.0").?));
    try std.testing.expect(!r2.satisfies(Version.parse("0.5").?));

    // Exclusion
    const r3 = Range.parse(">=1.0,!=1.5.0").?;
    try std.testing.expect(r3.satisfies(Version.parse("1.0").?));
    try std.testing.expect(r3.satisfies(Version.parse("1.4").?));
    try std.testing.expect(!r3.satisfies(Version.parse("1.5.0").?));
    try std.testing.expect(r3.satisfies(Version.parse("1.6").?));

    // Compatible release
    const r4 = Range.parse("~=1.4.2").?;
    try std.testing.expect(r4.satisfies(Version.parse("1.4.2").?));
    try std.testing.expect(r4.satisfies(Version.parse("1.4.5").?));
    try std.testing.expect(!r4.satisfies(Version.parse("1.5.0").?));
    try std.testing.expect(!r4.satisfies(Version.parse("1.4.1").?));
}

test "Range wildcard" {
    const r1 = Range.parse("==1.0.*").?;
    try std.testing.expect(r1.satisfies(Version.parse("1.0.0").?));
    try std.testing.expect(r1.satisfies(Version.parse("1.0.5").?));
    try std.testing.expect(!r1.satisfies(Version.parse("1.1.0").?));
}
