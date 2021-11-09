usingnamespace @import("../global.zig");
const std = @import("std");

pub const Version = struct {
    major: u32 = 0,
    minor: u32 = 0,
    patch: u32 = 0,
    tag: Tag = Tag{},
    extra_tags: []const Tag = &[_]Tag{},
    raw: strings.StringOrTinyString = strings.StringOrTinyString.init(""),

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

    pub fn eql(lhs: Version, rhs: Version) bool {
        return lhs.major == rhs.major and lhs.minor == rhs.minor and lhs.patch == rhs.patch and rhs.tag.eql(lhs.tag);
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
        pre: strings.StringOrTinyString = strings.StringOrTinyString.init(""),
        build: strings.StringOrTinyString = strings.StringOrTinyString.init(""),

        pub inline fn hasPre(this: Tag) bool {
            return this.pre.slice().len > 0;
        }

        pub inline fn hasBuild(this: Tag) bool {
            return this.build.slice().len > 0;
        }

        pub fn eql(lhs: Tag, rhs: Tag) bool {
            return strings.eql(lhs.pre.slice(), rhs.pre.slice()) and strings.eql(rhs.build.slice(), lhs.build.slice());
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
                    else => {},
                }
            }

            if (build_count == 0 and pre_count == 0) {
                return TagResult{
                    .len = 0,
                };
            }

            if (@maximum(build_count, pre_count) > 1 and !multi_tag_warn) {
                Output.prettyErrorln("<r><magenta>warn<r>: Multiple pre/build tags is not supported yet.", .{});
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
                    else => {},
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

        var part_i: u8 = 0;
        var part_start_i: usize = 0;
        var last_char_i: usize = 0;

        if (input.len == 0) {
            result.valid = false;
            return result;
        }
        var is_done = false;
        var stopped_at: i32 = 0;

        var i: usize = 0;

        // two passes :(
        while (i < input.len) {
            if (is_done) {
                break;
            }

            stopped_at = @intCast(i32, i);
            switch (input[i]) {
                ' ' => {
                    if (part_i > 2) {
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
                    part_start_i = i;
                    i += 1;

                    while (i < input.len and switch (input[i]) {
                        '0'...'9' => true,
                        else => false,
                    }) {
                        i += 1;
                    }

                    last_char_i = i;

                    switch (part_i) {
                        0 => {
                            result.version.major = parseVersionNumber(input[part_start_i..last_char_i]);
                            part_i = 1;
                        },
                        1 => {
                            result.version.minor = parseVersionNumber(input[part_start_i..last_char_i]);
                            part_i = 2;
                        },
                        2 => {
                            result.version.patch = parseVersionNumber(input[part_start_i..last_char_i]);
                            part_i = 3;
                        },
                        else => {},
                    }

                    if (i < input.len and switch (input[i]) {
                        '.' => true,
                        else => false,
                    }) {
                        i += 1;
                    }
                },
                '.' => {
                    result.valid = false;
                    is_done = true;
                    break;
                },
                '-', '+' => {
                    // Just a plain tag with no version is invalid.

                    if (part_i < 2) {
                        result.valid = false;
                        is_done = true;
                        break;
                    }

                    part_start_i = i;
                    i += 1;
                    while (i < input.len and switch (input[i]) {
                        ' ' => true,
                        else => false,
                    }) {
                        i += 1;
                    }
                    const tag_result = Tag.parse(allocator, input[part_start_i..]);
                    result.version.tag = tag_result.tag;
                    result.version.extra_tags = tag_result.extra_tags;
                    break;
                },
                'x', '*', 'X' => {
                    part_start_i = i;
                    i += 1;

                    while (i < input.len and switch (input[i]) {
                        'x', '*', 'X' => true,
                        else => false,
                    }) {
                        i += 1;
                    }

                    last_char_i = i;

                    if (i < input.len and switch (input[i]) {
                        '.' => true,
                        else => false,
                    }) {
                        i += 1;
                    }

                    if (result.wildcard == .none) {
                        switch (part_i) {
                            0 => {
                                result.wildcard = Query.Token.Wildcard.major;
                                part_i = 1;
                            },
                            1 => {
                                result.wildcard = Query.Token.Wildcard.minor;
                                part_i = 2;
                            },
                            2 => {
                                result.wildcard = Query.Token.Wildcard.patch;
                                part_i = 3;
                            },
                            else => unreachable,
                        }
                    }
                },
                else => {
                    last_char_i = 0;
                    result.valid = false;
                    is_done = true;
                    break;
                },
            }
        }

        result.stopped_at = @intCast(u32, i);
        result.version.raw = strings.StringOrTinyString.init(input[0..i]);
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

        pub inline fn satisfies(this: *List, version: Version) bool {
            return this.head.satisfies(version);
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

const expect = struct {
    pub var counter: usize = 0;
    pub fn isRangeMatch(input: string, version_str: string) void {
        var parsed = Version.parse(input, default_allocator);
        std.debug.assert(parsed.version.valid);
        std.debug.assert(strings.eql(parsed.version.raw.slice(), version_str));

        var list = try Query.parse(default_allocator, input);

        return list.satisfies(parsed.version);
    }

    pub fn range(input: string, version_str: string, src: std.builtin.SourceLocation) void {
        Output.initTest();
        defer counter += 1;
        if (!isRangeMatch(input, version_str)) {
            Output.panic("<r><red>Fail<r> Expected range <b>\"{s}\"<r> to match <b>\"{s}\"<r>\nAt: <blue><b>{s}:{d}:{d}<r><d> in {s}<r>", .{
                input,
                version_str,
                src.file,
                src.line,
                src.column,
                src.fn_name,
            });
        }
    }

    pub fn done(src: std.builtin.SourceLocation) void {
        Output.prettyErrorln("<r><green>{d} passed expectations <d>in {s}<r>", .{ counter, src.fn_name });
        Output.flush();
        counter = 0;
    }

    pub fn version(input: string, v: [3]u32, src: std.builtin.SourceLocation) void {
        Output.initTest();
        defer counter += 1;
        var result = Version.parse(input, default_allocator);
        var other = Version{ .major = v[0], .minor = v[1], .patch = v[2] };

        if (!other.eql(result.version)) {
            Output.panic("<r><red>Fail<r> Expected version <b>\"{s}\"<r> to match <b>\"{d}.{d}.{d}\" but received <red>\"{d}.{d}.{d}\"<r>\nAt: <blue><b>{s}:{d}:{d}<r><d> in {s}<r>", .{
                input,
                v[0],
                v[1],
                v[2],
                result.version.major,
                result.version.minor,
                result.version.patch,
                src.file,
                src.line,
                src.column,
                src.fn_name,
            });
        }
    }

    pub fn versionT(input: string, v: Version, src: std.builtin.SourceLocation) void {
        Output.initTest();
        defer counter += 1;
        var result = Version.parse(input, default_allocator);
        if (!v.eql(result.version)) {
            Output.panic("<r><red>Fail<r> Expected version <b>\"{s}\"<r> to match <b>\"{s}\" but received <red>\"{}\"<r>\nAt: <blue><b>{s}:{d}:{d}<r><d> in {s}<r>", .{
                input,
                v,
                result.version,
                src.file,
                src.line,
                src.column,
                src.fn_name,
            });
        }
    }
};

test "Version parsing" {
    defer expect.done(@src());

    expect.version("1.0.0", .{ 1, 0, 0 }, @src());
    expect.version("1.1.0", .{ 1, 1, 0 }, @src());
    expect.version("1.1.1", .{ 1, 1, 1 }, @src());
    expect.version("1.1.0", .{ 1, 1, 0 }, @src());
    expect.version("0.1.1", .{ 0, 1, 1 }, @src());
    expect.version("0.0.1", .{ 0, 0, 1 }, @src());
    expect.version("0.0.0", .{ 0, 0, 0 }, @src());

    expect.version("1.x", .{ 1, 0, 0 }, @src());
    expect.version("2.2.x", .{ 2, 2, 0 }, @src());
    expect.version("2.x.2", .{ 2, 0, 2 }, @src());

    expect.version("1.X", .{ 1, 0, 0 }, @src());
    expect.version("2.2.X", .{ 2, 2, 0 }, @src());
    expect.version("2.X.2", .{ 2, 0, 2 }, @src());

    expect.version("1.*", .{ 1, 0, 0 }, @src());
    expect.version("2.2.*", .{ 2, 2, 0 }, @src());
    expect.version("2.*.2", .{ 2, 0, 2 }, @src());
    expect.version("3", .{ 3, 0, 0 }, @src());
    expect.version("3.x", .{ 3, 0, 0 }, @src());
    expect.version("3.x.x", .{ 3, 0, 0 }, @src());
    expect.version("3.*.*", .{ 3, 0, 0 }, @src());
    expect.version("3.X.x", .{ 3, 0, 0 }, @src());

    {
        var v = Version{
            .major = 1,
            .minor = 0,
            .patch = 0,
        };
        v.tag.pre = strings.StringOrTinyString.init("beta");
        expect.versionT("1.0.0-beta", v, @src());
    }

    {
        var v = Version{
            .major = 1,
            .minor = 0,
            .patch = 0,
        };
        v.tag.build = strings.StringOrTinyString.init("build101");
        expect.versionT("1.0.0+build101", v, @src());
    }

    {
        var v = Version{
            .major = 1,
            .minor = 0,
            .patch = 0,
        };
        v.tag.build = strings.StringOrTinyString.init("build101");
        v.tag.pre = strings.StringOrTinyString.init("beta");
        expect.versionT("1.0.0-beta+build101", v, @src());
    }

    var buf: [1024]u8 = undefined;

    var triplet = [3]u32{ 0, 0, 0 };
    var x: u32 = 0;
    var y: u32 = 0;
    var z: u32 = 0;

    while (x < 32) : (x += 1) {
        while (y < 32) : (y += 1) {
            while (z < 32) : (z += 1) {
                triplet[0] = x;
                triplet[1] = y;
                triplet[2] = z;
                expect.version(try std.fmt.bufPrint(&buf, "{d}.{d}.{d}", .{ x, y, z }), triplet, @src());
                triplet[0] = z;
                triplet[1] = x;
                triplet[2] = y;
                expect.version(try std.fmt.bufPrint(&buf, "{d}.{d}.{d}", .{ z, x, y }), triplet, @src());

                triplet[0] = y;
                triplet[1] = x;
                triplet[2] = z;
                expect.version(try std.fmt.bufPrint(&buf, "{d}.{d}.{d}", .{ y, x, z }), triplet, @src());
            }
        }
    }
}
