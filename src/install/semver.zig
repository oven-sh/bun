usingnamespace @import("../global.zig");
const std = @import("std");

pub const Version = struct {
    major: u32 = 0,
    minor: u32 = 0,
    patch: u32 = 0,
    tag: Tag = Tag{},
    extra_tags: []const Tag = &[_]Tag{},
    raw: strings.StringOrTinyString = strings.StringOrTinyString{},

    inline fn atPart(i: u8) u32 {
        return switch (i) {
            0 => self.major,
            1 => self.minor,
            2 => self.patch,
            else => unreachable,
        };
    }

    pub const Tag = struct {
        pre: strings.StringOrTinyString = strings.StringOrTinyString{},
        build: strings.StringOrTinyString = strings.StringOrTinyString{},

        pub const TagResult = struct {
            tag: Tag = Tag{},
            extra_tags: []const Tag = &[_]Tag{},
            len: u32 = 0,
        };
        pub fn parse(allocator: *std.mem.Allocator, input: string) TagResult {}
    };

    pub fn isGreaterThan(self: Version, other: Version) bool {
        if (self.major > other.major) {
            return true;
        }

        if (self.minor > other.minor) {
            return true;
        }

        if (self.patch > other.patch) {
            return true;
        }
    }

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

        return result;
    }

    fn parseVersionNumber(input: string) u32 {
        // max decimal u32 is 4294967295
        var bytes: [10]u8 = undefined;
        var byte_i: u8 = 0;

        for (input) |char, i| {
            switch (char) {
                'X', 'x', '*' => return 0,
                '0'...'9' => {
                    // out of bounds
                    if (byte_i + 1 > bytes.len) return 0;
                    bytes[byte_i] = char;
                    byte_i += 1;
                },
                // ignore invalid characters
                else => {},
            }
        }

        // If there are no numbers, it's 0.
        if (byte_i == 0) return 0;

        return std.fmt.parseInt(u32, bytes[0..byte_i], 10) catch 0;
    }
};

pub const Range = struct {
    pub const Op = enum {
        eql,
        lt,
        lte,
        gt,
        gte,
    };

    pub const Comparator = struct {
        op: Op = Op.eql,
        version: Version = Version{},
    };

    left: Comparator = Comparator{},
    right: ?Comparator = null,
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
        pub fn setVersion(self: *List, version: Version) void {}

        pub fn andRange(self: *List, range: Range) !void {}

        pub fn orRange(self: *List, range: Range) !void {}
    };

    pub const Token = struct {
        tag: Tag = Tag.none,
        wildcard: Wildcard = Wildcard.none,

        pub const Tag = enum {
            none,
            logical_or,
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

    pub fn parse(allocator: *std.mem.Allocator, input: string) !Query {
        var i: usize = 0;
        var query = Query{};

        var token = Token{};
        var prev_token = Token{};

        var count: u8 = 0;
        var skip_round = false;
        var is_or = false;

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
                if (count == 0 and token.tag == .version) {
                    prev_token.tag = token.tag;
                    const parse_result = Version.parse(input[i..]);
                }
            }
        }

        return query;
    }
};
