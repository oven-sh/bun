/// Linked-list of AND ranges
/// "^1 ^2"
/// ----|-----
/// That is two Query
pub const Op = enum {
    none,
    AND,
    OR,
};

range: Range = Range{},

// AND
next: ?*Query = null,

const Formatter = struct {
    query: *const Query,
    buffer: []const u8,
    pub fn format(formatter: Formatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        const this = formatter.query;

        if (this.next) |ptr| {
            if (ptr.range.hasLeft() or ptr.range.hasRight()) {
                try std.fmt.format(writer, "{} && {}", .{ this.range.fmt(formatter.buffer), ptr.range.fmt(formatter.buffer) });
                return;
            }
        }

        try std.fmt.format(writer, "{}", .{this.range.fmt(formatter.buffer)});
    }
};

pub fn fmt(this: *const Query, buf: []const u8) @This().Formatter {
    return .{ .query = this, .buffer = buf };
}

/// Linked-list of Queries OR'd together
/// "^1 || ^2"
/// ----|-----
/// That is two List
pub const List = struct {
    head: Query = Query{},
    tail: ?*Query = null,

    // OR
    next: ?*List = null,

    const Formatter = struct {
        list: *const List,
        buffer: []const u8,
        pub fn format(formatter: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const this = formatter.list;

            if (this.next) |ptr| {
                try std.fmt.format(writer, "{} || {}", .{ this.head.fmt(formatter.buffer), ptr.fmt(formatter.buffer) });
            } else {
                try std.fmt.format(writer, "{}", .{this.head.fmt(formatter.buffer)});
            }
        }
    };

    pub fn fmt(this: *const List, buf: []const u8) @This().Formatter {
        return .{ .list = this, .buffer = buf };
    }

    pub fn satisfies(list: *const List, version: Version, list_buf: string, version_buf: string) bool {
        return list.head.satisfies(
            version,
            list_buf,
            version_buf,
        ) or (list.next orelse return false).satisfies(
            version,
            list_buf,
            version_buf,
        );
    }

    pub fn satisfiesPre(list: *const List, version: Version, list_buf: string, version_buf: string) bool {
        if (comptime Environment.allow_assert) {
            assert(version.tag.hasPre());
        }

        // `version` has a prerelease tag:
        // - needs to satisfy each comparator in the query (<comparator> AND <comparator> AND ...) like normal comparison
        // - if it does, also needs to match major, minor, patch with at least one of the other versions
        //   with a prerelease
        // https://github.com/npm/node-semver/blob/ac9b35769ab0ddfefd5a3af4a3ecaf3da2012352/classes/range.js#L505
        var pre_matched = false;
        return (list.head.satisfiesPre(
            version,
            list_buf,
            version_buf,
            &pre_matched,
        ) and pre_matched) or (list.next orelse return false).satisfiesPre(
            version,
            list_buf,
            version_buf,
        );
    }

    pub fn eql(lhs: *const List, rhs: *const List) bool {
        if (!lhs.head.eql(&rhs.head)) return false;

        const lhs_next = lhs.next orelse return rhs.next == null;
        const rhs_next = rhs.next orelse return false;

        return lhs_next.eql(rhs_next);
    }

    pub fn andRange(self: *List, allocator: Allocator, range: Range) !void {
        if (!self.head.range.hasLeft() and !self.head.range.hasRight()) {
            self.head.range = range;
            return;
        }

        var tail = try allocator.create(Query);
        tail.* = Query{
            .range = range,
        };
        tail.range = range;

        var last_tail = self.tail orelse &self.head;
        last_tail.next = tail;
        self.tail = tail;
    }
};

pub const Group = struct {
    head: List = List{},
    tail: ?*List = null,
    allocator: Allocator,
    input: string = "",

    flags: FlagsBitSet = FlagsBitSet.initEmpty(),
    pub const Flags = struct {
        pub const pre = 1;
        pub const build = 0;
    };

    const Formatter = struct {
        group: *const Group,
        buf: string,

        pub fn format(formatter: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const this = formatter.group;

            if (this.tail == null and this.head.tail == null and !this.head.head.range.hasLeft()) {
                return;
            }

            if (this.tail == null and this.head.tail == null) {
                try std.fmt.format(writer, "{}", .{this.head.fmt(formatter.buf)});
                return;
            }

            var list = &this.head;
            while (list.next) |next| {
                try std.fmt.format(writer, "{} && ", .{list.fmt(formatter.buf)});
                list = next;
            }

            try std.fmt.format(writer, "{}", .{list.fmt(formatter.buf)});
        }
    };

    pub fn fmt(this: *const Group, buf: string) @This().Formatter {
        return .{
            .group = this,
            .buf = buf,
        };
    }

    pub fn jsonStringify(this: *const Group, writer: anytype) !void {
        const temp = try std.fmt.allocPrint(bun.default_allocator, "{}", .{this.fmt()});
        defer bun.default_allocator.free(temp);
        try std.json.encodeJsonString(temp, .{}, writer);
    }

    pub fn deinit(this: *const Group) void {
        var list = this.head;
        var allocator = this.allocator;

        while (list.next) |next| {
            var query = list.head;
            while (query.next) |next_query| {
                query = next_query.*;
                allocator.destroy(next_query);
            }
            list = next.*;
            allocator.destroy(next);
        }
    }

    pub fn getExactVersion(this: *const Group) ?Version {
        const range = this.head.head.range;
        if (this.head.next == null and
            this.head.head.next == null and
            range.hasLeft() and
            range.left.op == .eql and
            !range.hasRight())
        {
            if (comptime Environment.allow_assert) {
                assert(this.tail == null);
            }
            return range.left.version;
        }

        return null;
    }

    pub fn from(version: Version) Group {
        return .{
            .allocator = bun.default_allocator,
            .head = .{
                .head = .{
                    .range = .{
                        .left = .{
                            .op = .eql,
                            .version = version,
                        },
                    },
                },
            },
        };
    }

    pub const FlagsBitSet = bun.bit_set.IntegerBitSet(3);

    pub fn isExact(this: *const Group) bool {
        return this.head.next == null and this.head.head.next == null and !this.head.head.range.hasRight() and this.head.head.range.left.op == .eql;
    }

    pub fn @"is *"(this: *const Group) bool {
        const left = this.head.head.range.left;
        return this.head.head.range.right.op == .unset and
            left.op == .gte and
            this.head.next == null and
            this.head.head.next == null and
            left.version.isZero() and
            !this.flags.isSet(Flags.build);
    }

    pub inline fn eql(lhs: Group, rhs: Group) bool {
        return lhs.head.eql(&rhs.head);
    }

    pub fn toVersion(this: Group) Version {
        assert(this.isExact() or this.head.head.range.left.op == .unset);
        return this.head.head.range.left.version;
    }

    pub fn orVersion(self: *Group, version: Version) !void {
        if (self.tail == null and !self.head.head.range.hasLeft()) {
            self.head.head.range.left.version = version;
            self.head.head.range.left.op = .eql;
            return;
        }

        var new_tail = try self.allocator.create(List);
        new_tail.* = List{};
        new_tail.head.range.left.version = version;
        new_tail.head.range.left.op = .eql;

        var prev_tail = self.tail orelse &self.head;
        prev_tail.next = new_tail;
        self.tail = new_tail;
    }

    pub fn andRange(self: *Group, range: Range) !void {
        var tail = self.tail orelse &self.head;
        try tail.andRange(self.allocator, range);
    }

    pub fn orRange(self: *Group, range: Range) !void {
        if (self.tail == null and self.head.tail == null and !self.head.head.range.hasLeft()) {
            self.head.head.range = range;
            return;
        }

        var new_tail = try self.allocator.create(List);
        new_tail.* = List{};
        new_tail.head.range = range;

        var prev_tail = self.tail orelse &self.head;
        prev_tail.next = new_tail;
        self.tail = new_tail;
    }

    pub inline fn satisfies(
        group: *const Group,
        version: Version,
        group_buf: string,
        version_buf: string,
    ) bool {
        return if (version.tag.hasPre())
            group.head.satisfiesPre(version, group_buf, version_buf)
        else
            group.head.satisfies(version, group_buf, version_buf);
    }
};

pub fn eql(lhs: *const Query, rhs: *const Query) bool {
    if (!lhs.range.eql(rhs.range)) return false;

    const lhs_next = lhs.next orelse return rhs.next == null;
    const rhs_next = rhs.next orelse return false;

    return lhs_next.eql(rhs_next);
}

pub fn satisfies(query: *const Query, version: Version, query_buf: string, version_buf: string) bool {
    return query.range.satisfies(
        version,
        query_buf,
        version_buf,
    ) and (query.next orelse return true).satisfies(
        version,
        query_buf,
        version_buf,
    );
}

pub fn satisfiesPre(query: *const Query, version: Version, query_buf: string, version_buf: string, pre_matched: *bool) bool {
    if (comptime Environment.allow_assert) {
        assert(version.tag.hasPre());
    }
    return query.range.satisfiesPre(
        version,
        query_buf,
        version_buf,
        pre_matched,
    ) and (query.next orelse return true).satisfiesPre(
        version,
        query_buf,
        version_buf,
        pre_matched,
    );
}

pub const Token = struct {
    tag: Tag = Tag.none,
    wildcard: Wildcard = Wildcard.none,

    pub fn toRange(this: Token, version: Version.Partial) Range {
        switch (this.tag) {
            // Allows changes that do not modify the left-most non-zero element in the [major, minor, patch] tuple
            .caret => {
                // https://github.com/npm/node-semver/blob/3a8a4309ae986c1967b3073ba88c9e69433d44cb/classes/range.js#L302-L353
                var range = Range{};
                if (version.major) |major| done: {
                    range.left = .{
                        .op = .gte,
                        .version = .{
                            .major = major,
                        },
                    };
                    range.right = .{
                        .op = .lt,
                    };
                    if (version.minor) |minor| {
                        range.left.version.minor = minor;
                        if (version.patch) |patch| {
                            range.left.version.patch = patch;
                            range.left.version.tag = version.tag;
                            if (major == 0) {
                                if (minor == 0) {
                                    range.right.version.patch = patch +| 1;
                                } else {
                                    range.right.version.minor = minor +| 1;
                                }
                                break :done;
                            }
                        } else if (major == 0) {
                            range.right.version.minor = minor +| 1;
                            break :done;
                        }
                    }
                    range.right.version.major = major +| 1;
                }
                return range;
            },
            .tilda => {
                // https://github.com/npm/node-semver/blob/3a8a4309ae986c1967b3073ba88c9e69433d44cb/classes/range.js#L261-L287
                var range = Range{};
                if (version.major) |major| done: {
                    range.left = .{
                        .op = .gte,
                        .version = .{
                            .major = major,
                        },
                    };
                    range.right = .{
                        .op = .lt,
                    };
                    if (version.minor) |minor| {
                        range.left.version.minor = minor;
                        if (version.patch) |patch| {
                            range.left.version.patch = patch;
                            range.left.version.tag = version.tag;
                        }
                        range.right.version.major = major;
                        range.right.version.minor = minor +| 1;
                        break :done;
                    }
                    range.right.version.major = major +| 1;
                }
                return range;
            },
            .none => unreachable,
            .version => {
                if (this.wildcard != Wildcard.none) {
                    return Range.initWildcard(version.min(), this.wildcard);
                }

                return .{ .left = .{ .op = .eql, .version = version.min() } };
            },
            else => {},
        }

        return switch (this.wildcard) {
            .major => .{
                .left = .{ .op = .gte, .version = version.min() },
                .right = .{
                    .op = .lte,
                    .version = .{
                        .major = std.math.maxInt(u32),
                        .minor = std.math.maxInt(u32),
                        .patch = std.math.maxInt(u32),
                    },
                },
            },
            .minor => switch (this.tag) {
                .lte => .{
                    .left = .{
                        .op = .lte,
                        .version = .{
                            .major = version.major orelse 0,
                            .minor = std.math.maxInt(u32),
                            .patch = std.math.maxInt(u32),
                        },
                    },
                },
                .lt => .{
                    .left = .{
                        .op = .lt,
                        .version = .{
                            .major = version.major orelse 0,
                            .minor = 0,
                            .patch = 0,
                        },
                    },
                },

                .gt => .{
                    .left = .{
                        .op = .gt,
                        .version = .{
                            .major = version.major orelse 0,
                            .minor = std.math.maxInt(u32),
                            .patch = std.math.maxInt(u32),
                        },
                    },
                },

                .gte => .{
                    .left = .{
                        .op = .gte,
                        .version = .{
                            .major = version.major orelse 0,
                            .minor = 0,
                            .patch = 0,
                        },
                    },
                },
                else => unreachable,
            },
            .patch => switch (this.tag) {
                .lte => .{
                    .left = .{
                        .op = .lte,
                        .version = .{
                            .major = version.major orelse 0,
                            .minor = version.minor orelse 0,
                            .patch = std.math.maxInt(u32),
                        },
                    },
                },
                .lt => .{
                    .left = .{
                        .op = .lt,
                        .version = .{
                            .major = version.major orelse 0,
                            .minor = version.minor orelse 0,
                            .patch = 0,
                        },
                    },
                },

                .gt => .{
                    .left = .{
                        .op = .gt,
                        .version = .{
                            .major = version.major orelse 0,
                            .minor = version.minor orelse 0,
                            .patch = std.math.maxInt(u32),
                        },
                    },
                },

                .gte => .{
                    .left = .{
                        .op = .gte,
                        .version = .{
                            .major = version.major orelse 0,
                            .minor = version.minor orelse 0,
                            .patch = 0,
                        },
                    },
                },
                else => unreachable,
            },
            .none => .{
                .left = .{
                    .op = switch (this.tag) {
                        .gt => .gt,
                        .gte => .gte,
                        .lt => .lt,
                        .lte => .lte,
                        else => unreachable,
                    },
                    .version = version.min(),
                },
            },
        };
    }

    pub const Tag = enum {
        none,
        gt,
        gte,
        lt,
        lte,
        version,
        tilda,
        caret,
    };

    pub const Wildcard = enum {
        none,
        major,
        minor,
        patch,
    };
};

pub fn parse(
    allocator: Allocator,
    input: string,
    sliced: SlicedString,
) bun.OOM!Group {
    var i: usize = 0;
    var list = Group{
        .allocator = allocator,
        .input = input,
    };

    var token = Token{};
    var prev_token = Token{};

    var count: u8 = 0;
    var skip_round = false;
    var is_or = false;

    while (i < input.len) {
        skip_round = false;

        switch (input[i]) {
            '>' => {
                if (input.len > i + 1 and input[i + 1] == '=') {
                    token.tag = .gte;
                    i += 1;
                } else {
                    token.tag = .gt;
                }

                i += 1;
                while (i < input.len and input[i] == ' ') : (i += 1) {}
            },
            '<' => {
                if (input.len > i + 1 and input[i + 1] == '=') {
                    token.tag = .lte;
                    i += 1;
                } else {
                    token.tag = .lt;
                }

                i += 1;
                while (i < input.len and input[i] == ' ') : (i += 1) {}
            },
            '=', 'v' => {
                token.tag = .version;
                is_or = true;
                i += 1;
                while (i < input.len and input[i] == ' ') : (i += 1) {}
            },
            '~' => {
                token.tag = .tilda;
                i += 1;

                if (i < input.len and input[i] == '>') i += 1;

                while (i < input.len and input[i] == ' ') : (i += 1) {}
            },
            '^' => {
                token.tag = .caret;
                i += 1;
                while (i < input.len and input[i] == ' ') : (i += 1) {}
            },
            '0'...'9', 'X', 'x', '*' => {
                token.tag = .version;
                is_or = true;
            },
            '|' => {
                i += 1;

                while (i < input.len and input[i] == '|') : (i += 1) {}
                while (i < input.len and input[i] == ' ') : (i += 1) {}
                is_or = true;
                token.tag = Token.Tag.none;
                skip_round = true;
            },
            '-' => {
                i += 1;
                while (i < input.len and input[i] == ' ') : (i += 1) {}
            },
            ' ' => {
                i += 1;
                while (i < input.len and input[i] == ' ') : (i += 1) {}
                skip_round = true;
            },
            else => {
                i += 1;
                token.tag = Token.Tag.none;

                // skip tagged versions
                // we are assuming this is the beginning of a tagged version like "boop"
                // "1.0.0 || boop"
                while (i < input.len and input[i] != ' ' and input[i] != '|') : (i += 1) {}
                skip_round = true;
            },
        }

        if (!skip_round) {
            const parse_result = Version.parse(sliced.sub(input[i..]));
            const version = parse_result.version.min();
            if (version.tag.hasBuild()) list.flags.setValue(Group.Flags.build, true);
            if (version.tag.hasPre()) list.flags.setValue(Group.Flags.pre, true);

            token.wildcard = parse_result.wildcard;

            i += parse_result.len;
            const rollback = i;

            const maybe_hyphenate = i < input.len and (input[i] == ' ' or input[i] == '-');

            // TODO: can we do this without rolling back?
            const hyphenate: bool = maybe_hyphenate and possibly_hyphenate: {
                i += strings.lengthOfLeadingWhitespaceASCII(input[i..]);
                if (!(i < input.len and input[i] == '-')) break :possibly_hyphenate false;
                i += 1;
                i += strings.lengthOfLeadingWhitespaceASCII(input[i..]);
                if (i == input.len) break :possibly_hyphenate false;
                if (input[i] == 'v' or input[i] == '=') {
                    i += 1;
                }
                if (i == input.len) break :possibly_hyphenate false;
                i += strings.lengthOfLeadingWhitespaceASCII(input[i..]);
                if (i == input.len) break :possibly_hyphenate false;

                if (!(i < input.len and switch (input[i]) {
                    '0'...'9', 'X', 'x', '*' => true,
                    else => false,
                })) break :possibly_hyphenate false;

                break :possibly_hyphenate true;
            };

            if (!hyphenate) i = rollback;
            i += @as(usize, @intFromBool(!hyphenate));

            if (hyphenate) {
                const second_parsed = Version.parse(sliced.sub(input[i..]));
                var second_version = second_parsed.version.min();
                if (second_version.tag.hasBuild()) list.flags.setValue(Group.Flags.build, true);
                if (second_version.tag.hasPre()) list.flags.setValue(Group.Flags.pre, true);
                const range: Range = brk: {
                    switch (second_parsed.wildcard) {
                        .major => {
                            // "1.0.0 - x" --> ">=1.0.0"
                            break :brk Range{
                                .left = .{ .op = .gte, .version = version },
                            };
                        },
                        .minor => {
                            // "1.0.0 - 1.x" --> ">=1.0.0 < 2.0.0"
                            second_version.major +|= 1;
                            second_version.minor = 0;
                            second_version.patch = 0;

                            break :brk Range{
                                .left = .{ .op = .gte, .version = version },
                                .right = .{ .op = .lt, .version = second_version },
                            };
                        },
                        .patch => {
                            // "1.0.0 - 1.0.x" --> ">=1.0.0 <1.1.0"
                            second_version.minor +|= 1;
                            second_version.patch = 0;

                            break :brk Range{
                                .left = .{ .op = .gte, .version = version },
                                .right = .{ .op = .lt, .version = second_version },
                            };
                        },
                        .none => {
                            break :brk Range{
                                .left = .{ .op = .gte, .version = version },
                                .right = .{ .op = .lte, .version = second_version },
                            };
                        },
                    }
                };

                if (is_or) {
                    try list.orRange(range);
                } else {
                    try list.andRange(range);
                }

                i += second_parsed.len + 1;
            } else if (count == 0 and token.tag == .version) {
                switch (parse_result.wildcard) {
                    .none => {
                        try list.orVersion(version);
                    },
                    else => {
                        try list.orRange(token.toRange(parse_result.version));
                    },
                }
            } else if (count == 0) {
                // From a semver perspective, treat "--foo" the same as "-foo"
                // example: foo/bar@1.2.3@--canary.24
                //                         ^
                if (token.tag == .none) {
                    is_or = false;
                    token.wildcard = .none;
                    prev_token.tag = .none;
                    continue;
                }
                try list.andRange(token.toRange(parse_result.version));
            } else if (is_or) {
                try list.orRange(token.toRange(parse_result.version));
            } else {
                try list.andRange(token.toRange(parse_result.version));
            }

            is_or = false;
            count += 1;
            token.wildcard = .none;
            prev_token.tag = token.tag;
        }
    }

    return list;
}

const Query = @This();

const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("bun");
const string = bun.string;
const Environment = bun.Environment;
const strings = bun.strings;
const default_allocator = bun.default_allocator;

const OOM = bun.OOM;
const SlicedString = bun.Semver.SlicedString;
const Version = bun.Semver.Version;
const Range = bun.Semver.Range;
const assert = bun.assert;
