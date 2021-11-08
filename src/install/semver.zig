usingnamespace @import("../global.zig");
const std = @import("std");

pub const Version = struct {
    major: u32 = 0,
    minor: u32 = 0,
    patch: u32 = 0,
    tag: Tag = Tag{},
    extra_tags: []const Tag = &[_]Tag{},
    raw: strings.StringOrTinyString = strings.StringOrTinyString{},

    pub fn format(self: Version, comptime layout: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
        try std.fmt.format(writer, "{d}.{d}.{d}", .{ self.major, self.minor, self.patch });

        const pre = self.tag.pre.slice();
        const build = self.tag.build.slice();

        if (pre.len > 0) {
            try writer.writeAll("-");
            try writer.writeAll(pre);
        }

        if (build.len > 0) {
            try writer.writeAll("+");
            try writer.writeAll(build);
        }
    }

    inline fn atPart(i: u8) u32 {
        return switch (i) {
            0 => self.major,
            1 => self.minor,
            2 => self.patch,
            else => unreachable,
        };
    }

    pub fn order(lhs: Version, rhs: Version) std.math.Order {
        if (lhs.major < rhs.major) return .lt;
        if (lhs.major > rhs.major) return .gt;
        if (lhs.minor < rhs.minor) return .lt;
        if (lhs.minor > rhs.minor) return .gt;
        if (lhs.patch < rhs.patch) return .lt;
        if (lhs.patch > rhs.patch) return .gt;

        return .eql;
    }

    pub const Tag = struct {
        pre: strings.StringOrTinyString = strings.StringOrTinyString{},
        build: strings.StringOrTinyString = strings.StringOrTinyString{},

        pub inline fn hasPre(this: Tag) bool {
            return this.pre.slice().len > 0;
        }

        pub inline fn hasBuild(this: Tag) bool {
            return this.build.slice().len > 0;
        }

        pub const TagResult = struct {
            tag: Tag = Tag{},
            extra_tags: []const Tag = &[_]Tag{},
            len: u32 = 0,
        };
        var multi_tag_warn = false;
        // TODO: support multiple tags
        pub fn parse(allocator: *std.mem.Allocator, input: string) TagResult {
            var build_count: u32 = 0;
            var pre_count: u32 = 0;

            for (input) |c| {
                switch (c) {
                    ' ' => break,
                    '+' => {
                        build_count += 1;
                    },
                    '-' => {
                        pre_count += 1;
                    },
                }
            }

            if (build_count == 0 and pre_count == 0) {
                return TagResult{
                    .len = 0,
                };
            }

            if (@maximum(build_count, pre_count) > 1 and !multi_tag_warn) {
                Output.prettyErrorln("<r><orange>warn<r>: Multiple pre/build tags is not supported yet.", .{});
                multi_tag_warn = true;
            }

            const State = enum { none, pre, build };
            var result = TagResult{};
            // Common case: no allocation is necessary.
            var state = State.none;
            var start: usize = 0;

            var tag_i: usize = 0;
            var had_content = false;

            for (input) |c, i| {
                switch (c) {
                    ' ' => {
                        switch (state) {
                            .none => {},
                            .pre => {
                                result.tag.pre = strings.StringOrTinyString.init(input[start..i]);
                                if (comptime Environment.isDebug) {
                                    std.debug.assert(!strings.containsChar(result.tag.pre.slice(), '-'));
                                }
                                state = State.none;
                            },
                            .build => {
                                result.tag.build = strings.StringOrTinyString.init(input[start..i]);
                                if (comptime Environment.isDebug) {
                                    std.debug.assert(!strings.containsChar(result.tag.build.slice(), '-'));
                                }
                                state = State.none;
                            },
                        }
                        result.len = @truncate(u32, i);
                        break;
                    },
                    '+' => {
                        // qualifier  ::= ( '-' pre )? ( '+' build )?
                        if (state == .pre) {
                            result.tag.pre = strings.StringOrTinyString.init(input[start..i]);
                            if (comptime Environment.isDebug) {
                                std.debug.assert(!strings.containsChar(result.tag.pre.slice(), '-'));
                            }
                        }

                        state = .build;
                        start = i + 1;
                    },
                    '-' => {
                        state = .pre;
                        start = i + 1;
                    },
                }
            }

            switch (state) {
                .none => {},
                .pre => {
                    result.tag.pre = strings.StringOrTinyString.init(input[start..]);
                    if (comptime Environment.isDebug) {
                        std.debug.assert(!strings.containsChar(result.tag.pre.slice(), '-'));
                    }
                    result.len = @truncate(u32, input.len);
                },
                .build => {
                    result.tag.build = strings.StringOrTinyString.init(input[start..]);
                    if (comptime Environment.isDebug) {
                        std.debug.assert(!strings.containsChar(result.tag.build.slice(), '-'));
                    }
                    result.len = @truncate(u32, input.len);
                },
            }

            return result;
        }
    };

    pub const ParseResult = struct {
        wildcard: Query.Token.Wildcard = Query.Token.Wildcard.none,
        valid: bool = true,
        version: Version = Version{},
        stopped_at: u32 = 0,
    };

    pub fn parse(input: string, allocator: *std.mem.Allocator) ParseResult {
        var result = ParseResult{};

        var part_i_: i8 = -1;
        var part_start_i_: i32 = -1;
        var last_char_i: u32 = 0;

        if (input.len == 0) {
            result.valid = false;
            return result;
        }
        var is_done = false;
        var stopped_at: i32 = 0;
        for (input) |char, i| {
            if (is_done) {
                break;
            }

            stopped_at = i;
            switch (char) {
                ' ' => {
                    if (part_i_ > 2) {
                        is_done = true;
                        break;
                    }
                },
                '|', '^', '#', '&', '%', '!' => {
                    is_done = true;
                    stopped_at -= 1;
                    break;
                },
                '0'...'9' => {
                    if (part_start_i_ == -1) {
                        part_start_i_ = @intCast(i32, i);
                    }
                    last_char_i = @intCast(u32, i);
                },
                '.' => {
                    if (part_start_i_ > -1 and part_i <= 2) {
                        switch (part_i) {
                            0 => {
                                result.version.major = parseVersionNumber(input[@intCast(usize, part_start_i)..i]);
                            },
                            1 => {
                                result.version.minor = parseVersionNumber(input[@intCast(usize, part_start_i)..i]);
                            },
                            else => {},
                        }

                        part_start_i_ = -1;
                        part_i_ += 1;
                        // "fo.o.b.ar"
                    } else if (part_i > 2 or part_start_i_ == -1) {
                        result.valid = false;
                        is_done = true;
                        break;
                    }
                },
                '-', '+' => {
                    if (part_i == 2 and part_start_i_ > -1) {
                        result.version.patch = parseVersionNumber(input[@intCast(usize, part_start_i)..i]);
                        result.wildcard = Query.Token.Wildcard.none;
                        part_start_i_ = @intCast(i32, i);
                        part_i_ = 3;
                        is_done = true;
                        break;
                    } else {
                        result.valid = false;
                        is_done = true;
                        break;
                    }
                },
                'x', '*', 'X' => {
                    if (part_start_i_ == -1) {
                        part_start_i_ = @intCast(i32, i);
                    }
                    last_char_i = @intCast(u32, i);

                    // We want min wildcard
                    if (result.wildcard == .none) {
                        switch (part_i_) {
                            0 => {
                                result.wildcard = Query.Token.Wildcard.major;
                            },
                            1 => {
                                result.wildcard = Query.Token.Wildcard.minor;
                            },
                            2 => {
                                result.wildcard = Query.Token.Wildcard.patch;
                            },
                            else => unreachable,
                        }
                    }
                },
                else => {
                    last_char_i = 0;
                    result.is_valid = false;
                    is_done = true;
                    break;
                },
            }
        }

        const part_i = @intCast(u8, @maximum(0, part_i_));
        result.valid = result.valid and part_i_ > -1;

        const part_start_i = @intCast(u32, @maximum(0, part_start_i_));

        if (last_char_i == -1 or part_start_i > last_char_i)
            last_char_i = input.len - 1;

        // Where did we leave off?
        switch (part_i) {
            // That means they used a match like this:
            // "1"
            // So its a wildcard major
            0 => {
                if (result.wildcard == .none) {
                    result.wildcard = Query.Token.Wildcard.minor;
                }

                result.version.major = parseVersionNumber(input[@as(usize, part_start_i) .. last_char_i + 1]);
            },
            1 => {
                if (result.wildcard == .none) {
                    result.wildcard = Query.Token.Wildcard.patch;
                }

                result.version.minor = parseVersionNumber(input[@as(usize, part_start_i) .. last_char_i + 1]);
            },
            2 => {
                result.version.patch = parseVersionNumber(input[@as(usize, part_start_i) .. last_char_i + 1]);
            },
            3 => {
                const tag_result = Tag.parse(allocator, input[part_start_i..]);
                result.version.tag = tag_result.tag;
                if (tag_result.extra_tags.len > 0) {
                    result.version.extra_tags = tag_result.extra_tags;
                }

                stopped_at = @intCast(i32, tag_result.len) + part_start_i;
            },
            else => {},
        }

        result.stopped_at = @intCast(u32, @maximum(stopped_at, 0));
        result.version.raw = strings.StringOrTinyString.init(input[0..result.stopped_at]);
        return result;
    }

    fn parseVersionNumber(input: string) u32 {
        // max decimal u32 is 4294967295
        var bytes: [10]u8 = undefined;
        var byte_i: u8 = 0;

        std.debug.assert(input[0] != '.');

        for (input) |char, i| {
            switch (char) {
                'X', 'x', '*' => return 0,
                '0'...'9' => {
                    // out of bounds
                    if (byte_i + 1 > bytes.len) return 0;
                    bytes[byte_i] = char;
                    byte_i += 1;
                },
                ' ', '.' => break,
                // ignore invalid characters
                else => {},
            }
        }

        // If there are no numbers, it's 0.
        if (byte_i == 0) return 0;

        if (comptime Environment.isDebug) {
            return std.fmt.parseInt(u32, bytes[0..byte_i], 10) catch |err| {
                Output.prettyErrorln("ERROR {s} parsing version: \"{s}\", bytes: {s}", .{
                    @errorName(err),
                    input,
                    bytes[0..byte_i],
                });
                return 0;
            };
        }

        return std.fmt.parseInt(u32, bytes[0..byte_i], 10) catch 0;
    }
};

pub const Range = struct {
    pub const Op = enum(u8) {
        unset = 0,
        eql = 1,
        lt = 3,
        lte = 4,
        gt = 5,
        gte = 6,
    };

    left: Comparator = Comparator{},
    right: Comparator = Comparator{},

    pub fn initWildcard(version: Version, wildcard: Query.Token.Wildcard) Range {
        switch (wildcard) {
            .none => {
                return Range{
                    .left = Comparator{
                        .op = Op.eql,
                        .version = version,
                    },
                };
            },

            .major => {
                return Range{
                    .left = Comparator{
                        .op = Op.gte,
                        .version = Version{ .raw = version.raw },
                    },
                };
            },
            .minor => {
                var lhs = Version{ .raw = version.raw };
                lhs.major = version.major + 1;

                var rhs = Version{ .raw = version.raw };
                rhs.major = version.major;

                return Range{
                    .left = Comparator{
                        .op = Op.lt,
                        .version = lhs,
                    },
                    .right = Comparator{
                        .op = Op.gte,
                        .version = rhs,
                    },
                };
            },
            .patch => {
                var lhs = Version{};
                lhs.major = version.major;
                lhs.minor = version.minor + 1;

                var rhs = Version{};
                rhs.major = version.major;
                rhs.minor = version.minor;

                rhs.raw = version.raw;
                lhs.raw = version.raw;

                return Range{
                    .left = Comparator{
                        .op = Op.lt,
                        .version = lhs,
                    },
                    .right = Comparator{
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

    pub const Comparator = struct {
        op: Op = Op.unset,
        version: Version = Version{},

        pub fn satisfies(this: Comparator, version: Version) bool {
            const order = this.version.order(version);

            return switch (order) {
                .eql => switch (this.op) {
                    .lte, .gte, .eql => true,
                    else => false,
                },
                .gt => switch (this.op) {
                    .gt => true,
                    else => false,
                },
                .lt => switch (this.op) {
                    .lt => true,
                    else => false,
                },
            };
        }
    };

    pub fn satisfies(this: Range, version: Version) bool {
        if (!this.hasLeft()) {
            return false;
        }

        if (!this.left.satisfies(version)) {
            return false;
        }

        if (this.hasRight() and !this.right.satisfies(version)) {
            return false;
        }

        return true;
    }
};

pub const Query = struct {
    pub const Op = enum {
        none,
        AND,
        OR,
    };

    range: Range = Range{},
    next_op: Op = Op.none,

    next: *Query = undefined,

    pub const List = struct {
        head: Query,
        tail: ?*Query = null,
        allocator: *std.mem.Allocator,
        pub fn orVersion(self: *List, version: Version) !void {
            if (!self.head.range.hasLeft() and self.tail == null) {
                std.debug.assert(!self.head.range.hasRight());
                self.head.range.left.version = version;
                self.head.range.left.op = .eql;
                return;
            }

            var tail = try self.allocator.create(Query);
            tail.* = Query{};
            tail.range.left.version = version;
            tail.range.left.op = .eql;

            var last_tail = self.tail orelse &self.head;
            std.debug.assert(last_tail.next_op == .none);

            last_tail.next_op = .OR;
            last_tail.next = tail;
            self.tail = tail;
        }

        fn addRange(self: *List, range: Range, is_and: bool) !void {
            if (!self.head.range.hasLeft() and !self.head.range.hasRight()) {
                self.head.range = range;
                return;
            }

            var tail = try self.allocator.create(Query);
            tail.range = range;

            var last_tail = self.tail orelse &self.head;
            std.debug.assert(last_tail.next_op == .none);
            last_tail.next = tail;
            last_tail.next_op = if (is_and) .AND else .OR;
        }
        pub fn andRange(self: *List, range: Range) !void {
            try self.addRange(range, true);
        }
        pub fn orRange(self: *List, range: Range) !void {
            try self.addRange(range, false);
        }
    };

    pub fn satisfies(this: *Query, version: Version) bool {
        const left = this.range.satisfies(version);
        return switch (this.next_op) {
            .none => left,
            .AND => left and this.next.satisfies(version),
            .OR => left or this.next.satisfies(version),
        };
    }

    pub const Token = struct {
        tag: Tag = Tag.none,
        wildcard: Wildcard = Wildcard.none,

        pub fn toRange(this: Token, version: Version) Range {
            switch (this.tag) {
                // Allows changes that do not modify the left-most non-zero element in the [major, minor, patch] tuple
                .caret => {
                    var range = Range{ .left = .{ .op = .gte, .version = Version{ .raw = version.raw } } };

                    if (version.patch > 0 or version.minor > 0) {
                        range.right = .{
                            .op = .lt,
                            .version = Version{ .raw = version.raw, .major = version.major, .minor = version.minor + 1, .patch = 0 },
                        };
                        return range;
                    }

                    range.right = .{
                        .op = .lt,
                        .version = Version{ .raw = version.raw, .major = version.major + 1, .minor = 0, .patch = 0 },
                    };

                    return range;
                },
                .tilda => {
                    if (version.minor == 0 or this.wildcard == .minor or this.wildcard == .major) {
                        return Range.initWildcard(version, .minor);
                    }

                    return Range.initWildcard(version, .patch);
                },
                .none => unreachable,
                else => {},
            }

            if (this.wildcard != Wildcard.none) {
                return Range.initWildcard(version, this.wildcard);
            }

            switch (this.tag) {
                .version => {
                    return Range{ .left = .{ .op = .eql, .version = version } };
                },
                .gt => {
                    return Range{ .left = .{ .op = .gt, .version = version } };
                },
                .gte => {
                    return Range{ .left = .{ .op = .gte, .version = version } };
                },
                .lt => {
                    return Range{ .left = .{ .op = .lt, .version = version } };
                },
                .lte => {
                    return Range{ .left = .{ .op = .lte, .version = version } };
                },
                else => unreachable,
            }
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

    pub fn parse(allocator: *std.mem.Allocator, input: string) !List {
        var i: usize = 0;
        var list = List{ .allocator = allocator };

        var token = Token{};
        var prev_token = Token{};

        var count: u8 = 0;
        var skip_round = false;
        var is_or = false;

        var last_non_whitespace: usize = 0;

        while (i < input.len) {
            skip_round = false;

            switch (input[i]) {
                '>' => {
                    if (prev_token.tag == .version) {
                        is_or = false;
                    }

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
                    skip_round = true;
                },
            }

            if (!skip_round) {
                const parse_result = Version.parse(input[i..]);

                if (count == 0 and token.tag == .version) {
                    prev_token.tag = token.tag;

                    token.wildcard = parse_result.wildcard;

                    switch (parse_result.wildcard) {
                        .none => {
                            try list.orVersion(parse_result.version);
                        },
                        else => {
                            try list.andRange(token.toRange(parse_result.version));
                        },
                    }
                    token.tag = Token.Tag.none;
                    token.wildcard = .none;
                } else if (count == 0) {
                    prev_token.tag = token.tag;
                    token.wildcard = parse_result.wildcard;
                    try list.andRange(token.toRange(parse_result.version));
                } else if (is_or) {
                    try list.orRange(token.toRange(parse_result.version));
                } else {
                    try list.andRange(token.toRange(parse_result.version));
                }

                i += parse_result.stopped_at + 1;
                is_or = false;
            }
        }

        return query;
    }
};
