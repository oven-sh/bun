usingnamespace @import("../global.zig");
const std = @import("std");

pub const ExternalString = extern struct {
    off: u32 = 0,
    len: u32 = 0,
    hash: u64 = 0,

    /// ExternalString but without the hash
    pub const Small = extern struct {
        off: u32 = 0,
        len: u32 = 0,

        pub inline fn slice(this: Small, buf: string) string {
            return buf[this.off..][0..this.len];
        }

        pub inline fn from(in: string) Small {
            return Small{
                .off = 0,
                .len = @truncate(u32, in.len),
                .hash = std.hash.Wyhash.hash(0, in),
            };
        }

        pub inline fn init(buf: string, in: string) Small {
            std.debug.assert(@ptrToInt(buf.ptr) <= @ptrToInt(in.ptr) and ((@ptrToInt(in.ptr) + in.len) <= (@ptrToInt(buf.ptr) + buf.len)));

            return Small{
                .off = @truncate(u32, @ptrToInt(in.ptr) - @ptrToInt(buf.ptr)),
                .len = @truncate(u32, in.len),
            };
        }
    };

    pub inline fn from(in: string) ExternalString {
        return ExternalString{
            .off = 0,
            .len = @truncate(u32, in.len),
            .hash = std.hash.Wyhash.hash(0, in),
        };
    }

    pub inline fn small(this: ExternalString) ExternalString.Small {
        return ExternalString.Small{
            .off = this.off,
            .len = this.len,
        };
    }

    pub inline fn init(buf: string, in: string, hash: u64) ExternalString {
        std.debug.assert(@ptrToInt(buf.ptr) <= @ptrToInt(in.ptr) and ((@ptrToInt(in.ptr) + in.len) <= (@ptrToInt(buf.ptr) + buf.len)));

        return ExternalString{
            .off = @truncate(u32, @ptrToInt(in.ptr) - @ptrToInt(buf.ptr)),
            .len = @truncate(u32, in.len),
            .hash = hash,
        };
    }

    pub inline fn slice(this: ExternalString, buf: string) string {
        return buf[this.off..][0..this.len];
    }
};

pub const BigExternalString = extern struct {
    off: u32 = 0,
    len: u32 = 0,
    hash: u64 = 0,

    pub fn from(in: string) ExternalString {
        return ExternalString{
            .off = 0,
            .len = @truncate(u32, in.len),
            .hash = std.hash.Wyhash.hash(0, in),
        };
    }

    pub inline fn init(buf: string, in: string, hash: u64) ExternalString {
        std.debug.assert(@ptrToInt(buf.ptr) <= @ptrToInt(in.ptr) and ((@ptrToInt(in.ptr) + in.len) <= (@ptrToInt(buf.ptr) + buf.len)));

        return ExternalString{
            .off = @truncate(u32, @ptrToInt(in.ptr) - @ptrToInt(buf.ptr)),
            .len = @truncate(u32, in.len),
            .hash = hash,
        };
    }

    pub fn slice(this: ExternalString, buf: string) string {
        return buf[this.off..][0..this.len];
    }
};

pub const SlicedString = struct {
    buf: string,
    slice: string,

    pub inline fn init(buf: string, slice: string) SlicedString {
        return SlicedString{ .buf = buf, .slice = slice };
    }

    pub inline fn external(this: SlicedString) ExternalString {
        if (comptime Environment.isDebug or Environment.isTest) std.debug.assert(@ptrToInt(this.buf.ptr) <= @ptrToInt(this.slice.ptr) and ((@ptrToInt(this.slice.ptr) + this.slice.len) <= (@ptrToInt(this.buf.ptr) + this.buf.len)));

        return ExternalString{ .off = @truncate(u32, @ptrToInt(this.slice.ptr) - @ptrToInt(this.buf.ptr)), .len = @truncate(u32, this.slice.len), .hash = std.hash.Wyhash.hash(0, this.slice) };
    }

    pub inline fn small(this: SlicedString) ExternalString.Small {
        if (comptime Environment.isDebug or Environment.isTest) std.debug.assert(@ptrToInt(this.buf.ptr) <= @ptrToInt(this.slice.ptr) and ((@ptrToInt(this.slice.ptr) + this.slice.len) <= (@ptrToInt(this.buf.ptr) + this.buf.len)));

        return ExternalString.Small{
            .off = @truncate(u32, @ptrToInt(this.slice.ptr) - @ptrToInt(this.buf.ptr)),
            .len = @truncate(u32, this.slice.len),
        };
    }

    pub inline fn sub(this: SlicedString, input: string) SlicedString {
        std.debug.assert(@ptrToInt(this.buf.ptr) <= @ptrToInt(this.buf.ptr) and ((@ptrToInt(input.ptr) + input.len) <= (@ptrToInt(this.buf.ptr) + this.buf.len)));
        return SlicedString{ .buf = this.buf, .slice = input };
    }
};

const RawType = void;
pub const Version = extern struct {
    major: u32 = 0,
    minor: u32 = 0,
    patch: u32 = 0,
    tag: Tag = Tag{},
    // raw: RawType = RawType{},

    pub fn cloneInto(this: Version, slice: []const u8, buf: []u8) Version {
        return Version{
            .major = this.major,
            .minor = this.minor,
            .patch = this.patch,
            .tag = this.tag.cloneInto(slice, buf),
        };
    }

    pub inline fn len(this: *const Version) u32 {
        return this.tag.build.len + this.tag.pre.len;
    }

    pub fn fmt(this: Version, input: string) Formatter {
        return Formatter{ .version = this, .input = input };
    }

    pub fn count(this: Version, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
        if (this.tag.hasPre()) builder.count(this.tag.pre.slice(buf));
        if (this.tag.hasBuild()) builder.count(this.tag.build.slice(buf));
    }

    pub fn clone(this: Version, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) Version {
        var that = this;

        if (this.tag.hasPre()) that.tag.pre = builder.append(ExternalString, this.tag.pre.slice(buf));
        if (this.tag.hasBuild()) that.tag.build = builder.append(ExternalString, this.tag.build.slice(buf));

        return that;
    }

    const HashableVersion = extern struct { major: u32, minor: u32, patch: u32, pre: u64, build: u64 };

    pub fn hash(this: Version) u64 {
        const hashable = HashableVersion{ .major = this.major, .minor = this.minor, .patch = this.patch, .pre = this.tag.pre.hash, .build = this.tag.build.hash };
        const bytes = std.mem.asBytes(&hashable);
        return std.hash.Wyhash.hash(0, bytes);
    }

    pub const Formatter = struct {
        version: Version,
        input: string,

        pub fn format(formatter: Formatter, comptime layout: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
            const self = formatter.version;
            try std.fmt.format(writer, "{d}.{d}.{d}", .{ self.major, self.minor, self.patch });

            if (self.tag.pre.len > 0) {
                const pre = self.tag.pre.slice(formatter.input);
                try writer.writeAll("-");
                try writer.writeAll(pre);
            }

            if (self.tag.build.len > 0) {
                const build = self.tag.build.slice(formatter.input);
                try writer.writeAll("+");
                try writer.writeAll(build);
            }
        }
    };

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

    pub const HashContext = struct {
        pub fn hash(this: @This(), lhs: Version) u32 {
            return @truncate(u32, lhs.hash());
        }

        pub fn eql(this: @This(), lhs: Version, rhs: Version) bool {
            return lhs.eql(rhs);
        }
    };

    pub fn order(lhs: Version, rhs: Version) std.math.Order {
        if (lhs.major < rhs.major) return .lt;
        if (lhs.major > rhs.major) return .gt;
        if (lhs.minor < rhs.minor) return .lt;
        if (lhs.minor > rhs.minor) return .gt;
        if (lhs.patch < rhs.patch) return .lt;
        if (lhs.patch > rhs.patch) return .gt;

        return .eq;
    }

    pub const Tag = extern struct {
        pre: ExternalString = ExternalString{},
        build: ExternalString = ExternalString{},

        pub fn cloneInto(this: Tag, slice: []const u8, buf: []u8) Tag {
            const pre_slice = this.pre.slice(slice);
            const build_slice = this.build.slice(slice);
            std.mem.copy(u8, buf, pre_slice);
            std.mem.copy(u8, buf[pre_slice.len..], build_slice);
            return Tag{
                .pre = .{
                    .off = 0,
                    .len = this.pre.len,
                    .hash = this.pre.hash,
                },
                .build = .{
                    .off = this.pre.len,
                    .len = this.build.len,
                    .hash = this.build.hash,
                },
            };
        }

        pub inline fn hasPre(this: Tag) bool {
            return this.pre.len > 0;
        }

        pub inline fn hasBuild(this: Tag) bool {
            return this.build.len > 0;
        }

        pub fn eql(lhs: Tag, rhs: Tag) bool {
            return lhs.build.hash == rhs.build.hash and lhs.pre.hash == rhs.pre.hash;
        }

        pub const TagResult = struct {
            tag: Tag = Tag{},
            len: u32 = 0,
        };

        var multi_tag_warn = false;
        // TODO: support multiple tags
        pub fn parse(allocator: *std.mem.Allocator, sliced_string: SlicedString) TagResult {
            var input = sliced_string.slice;
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

            const State = enum { none, pre, build };
            var result = TagResult{};
            // Common case: no allocation is necessary.
            var state = State.none;
            var start: usize = 0;

            var tag_i: usize = 0;
            var had_content = false;

            var i: usize = 0;

            while (i < input.len) : (i += 1) {
                const c = input[i];
                switch (c) {
                    ' ' => {
                        switch (state) {
                            .none => {},
                            .pre => {
                                result.tag.pre = sliced_string.sub(input[start..i]).external();
                                if (comptime Environment.isDebug) {
                                    std.debug.assert(!strings.containsChar(result.tag.pre.slice(sliced_string.buf), '-'));
                                }
                                state = State.none;
                            },
                            .build => {
                                result.tag.build = sliced_string.sub(input[start..i]).external();
                                if (comptime Environment.isDebug) {
                                    std.debug.assert(!strings.containsChar(result.tag.build.slice(sliced_string.buf), '-'));
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
                            result.tag.pre = sliced_string.sub(input[start..i]).external();
                            if (comptime Environment.isDebug) {
                                std.debug.assert(!strings.containsChar(result.tag.pre.slice(sliced_string.buf), '-'));
                            }
                        }

                        if (state != .build) {
                            state = .build;
                            start = i + 1;
                        }
                    },
                    '-' => {
                        if (state != .pre) {
                            state = .pre;
                            start = i + 1;
                        }
                    },
                    else => {},
                }
            }

            switch (state) {
                .none => {},
                .pre => {
                    result.tag.pre = sliced_string.sub(input[start..i]).external();
                    // a pre can contain multiple consecutive tags
                    if (comptime Environment.isDebug) {
                        std.debug.assert(!strings.startsWithChar(result.tag.pre.slice(sliced_string.buf), '-'));
                    }
                    state = State.none;
                },
                .build => {
                    // a build can contain multiple consecutive tags
                    result.tag.build = sliced_string.sub(input[start..i]).external();
                    if (comptime Environment.isDebug) {
                        std.debug.assert(!strings.startsWithChar(result.tag.build.slice(sliced_string.buf), '+'));
                    }
                    state = State.none;
                },
            }
            result.len = @truncate(u32, i);

            return result;
        }
    };

    pub const ParseResult = struct {
        wildcard: Query.Token.Wildcard = Query.Token.Wildcard.none,
        valid: bool = true,
        version: Version = Version{},
        stopped_at: u32 = 0,
    };

    pub fn parse(sliced_string: SlicedString, allocator: *std.mem.Allocator) ParseResult {
        var input = sliced_string.slice;
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
                    is_done = true;
                    break;
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
                    const tag_result = Tag.parse(allocator, sliced_string.sub(input[part_start_i..]));
                    result.version.tag = tag_result.tag;
                    i += tag_result.len;
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

        if (result.wildcard == .none) {
            switch (part_i) {
                0 => {
                    result.wildcard = Query.Token.Wildcard.major;
                },
                1 => {
                    result.wildcard = Query.Token.Wildcard.minor;
                },
                2 => {
                    result.wildcard = Query.Token.Wildcard.patch;
                },
                else => {},
            }
        }

        result.stopped_at = @intCast(u32, i);

        if (comptime RawType != void) {
            result.version.raw = sliced_string.sub(input[0..i]).external();
        }

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
                        .version = Version{
                            // .raw = version.raw
                        },
                    },
                };
            },
            .minor => {
                var lhs = Version{
                    // .raw = version.raw
                };
                lhs.major = version.major + 1;

                var rhs = Version{
                    // .raw = version.raw
                };
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

                // rhs.raw = version.raw;
                // lhs.raw = version.raw;

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
            const order = version.order(this.version);

            return switch (order) {
                .eq => switch (this.op) {
                    .lte, .gte, .eql => true,
                    else => false,
                },
                .gt => switch (this.op) {
                    .gt, .gte => true,
                    else => false,
                },
                .lt => switch (this.op) {
                    .lt, .lte => true,
                    else => false,
                },
            };
        }
    };

    pub fn satisfies(this: Range, version: Version) bool {
        if (!this.hasLeft()) {
            return true;
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

/// Linked-list of AND ranges
/// "^1 ^2"
/// ----|-----
/// That is two Query
pub const Query = struct {
    pub const Op = enum {
        none,
        AND,
        OR,
    };

    range: Range = Range{},

    // AND
    next: ?*Query = null,

    /// Linked-list of Queries OR'd together
    /// "^1 || ^2"
    /// ----|-----
    /// That is two List
    pub const List = struct {
        head: Query = Query{},
        tail: ?*Query = null,

        // OR
        next: ?*List = null,

        pub inline fn satisfies(this: *const List, version: Version) bool {
            return this.head.satisfies(version) or (this.next orelse return false).satisfies(version);
        }

        pub fn andRange(self: *List, allocator: *std.mem.Allocator, range: Range) !void {
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
        allocator: *std.mem.Allocator,
        input: string = "",

        flags: FlagsBitSet = FlagsBitSet.initEmpty(),
        pub const Flags = struct {
            pub const pre = 1;
            pub const build = 0;
        };

        pub const FlagsBitSet = std.bit_set.IntegerBitSet(3);

        pub fn isExact(this: *const Group) bool {
            return this.head.next == null and this.head.head.next == null and !this.head.head.range.hasRight() and this.head.head.range.left.op == .eql;
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

        pub inline fn satisfies(this: *const Group, version: Version) bool {
            return this.head.satisfies(version);
        }
    };

    pub inline fn satisfies(this: *const Query, version: Version) bool {
        const left = this.range.satisfies(version);

        return left and (this.next orelse return true).satisfies(version);
    }

    pub const Token = struct {
        tag: Tag = Tag.none,
        wildcard: Wildcard = Wildcard.none,

        pub fn toRange(this: Token, version: Version) Range {
            switch (this.tag) {
                // Allows changes that do not modify the left-most non-zero element in the [major, minor, patch] tuple
                .caret => {
                    var right_version = version;
                    // https://github.com/npm/node-semver/blob/cb1ca1d5480a6c07c12ac31ba5f2071ed530c4ed/classes/range.js#L310-L336
                    if (right_version.major == 0) {
                        if (right_version.minor == 0) {
                            right_version.patch += 1;
                        } else {
                            right_version.minor += 1;
                            right_version.patch = 0;
                        }
                    } else {
                        right_version.major += 1;
                        right_version.patch = 0;
                        right_version.minor = 0;
                    }

                    return Range{
                        .left = .{
                            .op = .gte,
                            .version = version,
                        },
                        .right = .{
                            .op = .lt,
                            .version = right_version,
                        },
                    };
                },
                .tilda => {
                    if (version.minor == 0 or this.wildcard == .minor or this.wildcard == .major) {
                        return Range.initWildcard(version, .minor);
                    }

                    return Range.initWildcard(version, .patch);
                },
                .none => unreachable,
                .version => {
                    if (this.wildcard != Wildcard.none) {
                        return Range.initWildcard(version, this.wildcard);
                    }

                    return Range{ .left = .{ .op = .eql, .version = version } };
                },
                else => {},
            }

            {
                var _version = version;
                switch (this.wildcard) {
                    .major => {
                        return Range{
                            .left = .{ .op = .gte, .version = _version },
                            .right = .{
                                .op = .lte,
                                .version = Version{
                                    .major = std.math.maxInt(u32),
                                    .minor = std.math.maxInt(u32),
                                    .patch = std.math.maxInt(u32),
                                },
                            },
                        };
                    },
                    .minor => {
                        switch (this.tag) {
                            .lt, .lte => {
                                return Range{
                                    .left = .{
                                        .op = if (this.tag == .lt) .lt else .lte,
                                        .version = Version{
                                            .major = version.major,
                                            .minor = 0,
                                            .patch = 0,
                                        },
                                    },
                                };
                            },
                            else => {
                                return Range{
                                    .left = .{
                                        .op = if (this.tag == .gt) .gt else .gte,
                                        .version = Version{
                                            .major = version.major,
                                            .minor = std.math.maxInt(u32),
                                            .patch = std.math.maxInt(u32),
                                        },
                                    },
                                };
                            },
                        }
                    },
                    .patch => {
                        switch (this.tag) {
                            .lt, .lte => {
                                return Range{
                                    .left = .{
                                        .op = if (this.tag == .lt) .lt else .lte,
                                        .version = Version{
                                            .major = version.major,
                                            .minor = version.minor,
                                            .patch = 0,
                                        },
                                    },
                                };
                            },
                            else => {
                                return Range{
                                    .left = .{
                                        .op = if (this.tag == .gt) .gt else .gte,
                                        .version = Version{
                                            .major = version.major,
                                            .minor = version.minor,
                                            .patch = std.math.maxInt(u32),
                                        },
                                    },
                                };
                            },
                        }
                    },
                    .none => {
                        return Range{
                            .left = .{
                                .op = switch (this.tag) {
                                    .gt => .gt,
                                    .gte => .gte,
                                    .lt => .lt,
                                    .lte => .lte,
                                    else => unreachable,
                                },
                                .version = version,
                            },
                        };
                    },
                }
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

    pub fn parse(
        allocator: *std.mem.Allocator,
        input: string,
        sliced: SlicedString,
    ) !Group {
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
        var enable_hyphen = false;

        var last_non_whitespace: usize = 0;

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
                    skip_round = true;
                },
            }

            if (!skip_round) {
                const parse_result = Version.parse(sliced.sub(input[i..]), allocator);
                if (parse_result.version.tag.hasBuild()) list.flags.setValue(Group.Flags.build, true);
                if (parse_result.version.tag.hasPre()) list.flags.setValue(Group.Flags.pre, true);

                token.wildcard = parse_result.wildcard;

                i += parse_result.stopped_at;
                const rollback = i;

                const had_space = i < input.len and input[i] == ' ';

                // TODO: can we do this without rolling back?
                const hyphenate: bool = had_space and possibly_hyphenate: {
                    i += 1;
                    while (i < input.len and input[i] == ' ') : (i += 1) {}
                    if (!(i < input.len and input[i] == '-')) break :possibly_hyphenate false;
                    i += 1;
                    if (!(i < input.len and input[i] == ' ')) break :possibly_hyphenate false;
                    i += 1;
                    while (i < input.len and switch (input[i]) {
                        ' ', 'v', '=' => true,
                        else => false,
                    }) : (i += 1) {}
                    if (!(i < input.len and switch (input[i]) {
                        '0'...'9', 'X', 'x', '*' => true,
                        else => false,
                    })) break :possibly_hyphenate false;

                    break :possibly_hyphenate true;
                };

                if (!hyphenate) i = rollback;
                i += @as(usize, @boolToInt(!hyphenate));

                if (hyphenate) {
                    var second_version = Version.parse(sliced.sub(input[i..]), allocator);
                    if (second_version.version.tag.hasBuild()) list.flags.setValue(Group.Flags.build, true);
                    if (second_version.version.tag.hasPre()) list.flags.setValue(Group.Flags.pre, true);

                    const range: Range = brk: {
                        switch (second_version.wildcard) {
                            .major => {
                                second_version.version.major += 1;
                                break :brk Range{
                                    .left = .{ .op = .gte, .version = parse_result.version },
                                    .right = .{ .op = .lte, .version = second_version.version },
                                };
                            },
                            .minor => {
                                second_version.version.major += 1;
                                second_version.version.minor = 0;
                                second_version.version.patch = 0;

                                break :brk Range{
                                    .left = .{ .op = .gte, .version = parse_result.version },
                                    .right = .{ .op = .lt, .version = second_version.version },
                                };
                            },
                            .patch => {
                                second_version.version.minor += 1;
                                second_version.version.patch = 0;

                                break :brk Range{
                                    .left = .{ .op = .gte, .version = parse_result.version },
                                    .right = .{ .op = .lt, .version = second_version.version },
                                };
                            },
                            .none => {
                                break :brk Range{
                                    .left = .{ .op = .gte, .version = parse_result.version },
                                    .right = .{ .op = .lte, .version = second_version.version },
                                };
                            },
                        }
                    };

                    if (is_or) {
                        try list.orRange(range);
                    } else {
                        try list.andRange(range);
                    }

                    i += second_version.stopped_at + 1;
                } else if (count == 0 and token.tag == .version) {
                    switch (parse_result.wildcard) {
                        .none => {
                            try list.orVersion(parse_result.version);
                        },
                        else => {
                            try list.orRange(token.toRange(parse_result.version));
                        },
                    }
                } else if (count == 0) {
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
};

const expect = struct {
    pub var counter: usize = 0;
    pub fn isRangeMatch(input: string, version_str: string) bool {
        var parsed = Version.parse(SlicedString.init(version_str, version_str), default_allocator);
        std.debug.assert(parsed.valid);
        // std.debug.assert(strings.eql(parsed.version.raw.slice(version_str), version_str));

        var list = Query.parse(
            default_allocator,
            input,
            SlicedString.init(input, input),
        ) catch |err| Output.panic("Test fail due to error {s}", .{@errorName(err)});

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
    pub fn notRange(input: string, version_str: string, src: std.builtin.SourceLocation) void {
        Output.initTest();
        defer counter += 1;
        if (isRangeMatch(input, version_str)) {
            Output.panic("<r><red>Fail<r> Expected range <b>\"{s}\"<r> NOT match <b>\"{s}\"<r>\nAt: <blue><b>{s}:{d}:{d}<r><d> in {s}<r>", .{
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
        var result = Version.parse(SlicedString.init(input, input), default_allocator);
        var other = Version{ .major = v[0], .minor = v[1], .patch = v[2] };
        std.debug.assert(result.valid);

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

        var result = Version.parse(SlicedString.init(input, input), default_allocator);
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

    expect.version("0.0.0", .{ 0, 0, 0 }, @src());

    {
        var v = Version{
            .major = 1,
            .minor = 0,
            .patch = 0,
        };
        var input: string = "1.0.0-beta";
        v.tag.pre = SlicedString.init(input, input["1.0.0-".len..]).external();
        expect.versionT(input, v, @src());
    }

    {
        var v = Version{
            .major = 1,
            .minor = 0,
            .patch = 0,
        };
        var input: string = "1.0.0-build101";
        v.tag.pre = SlicedString.init(input, input["1.0.0-".len..]).external();
        expect.versionT(input, v, @src());
    }

    {
        var v = Version{
            .major = 0,
            .minor = 21,
            .patch = 0,
        };
        var input: string = "0.21.0-beta-96ca8d915-20211115";
        v.tag.pre = SlicedString.init(input, input["0.21.0-".len..]).external();
        expect.versionT(input, v, @src());
    }

    {
        var v = Version{
            .major = 1,
            .minor = 0,
            .patch = 0,
        };
        var input: string = "1.0.0-beta+build101";
        v.tag.build = SlicedString.init(input, input["1.0.0-beta+".len..]).external();
        v.tag.pre = SlicedString.init(input, input["1.0.0-".len..][0..4]).external();
        expect.versionT(input, v, @src());
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

test "Range parsing" {
    defer expect.done(@src());
    expect.range("^1.1.4", "1.1.4", @src());

    expect.range(">2", "3", @src());
    expect.notRange(">2", "2.1", @src());
    expect.notRange(">2", "2", @src());
    expect.notRange(">2", "1.0", @src());
    expect.notRange(">1.3", "1.3.1", @src());
    expect.range(">1.3", "2.0.0", @src());
    expect.range(">2.1.0", "2.2.0", @src());
    expect.range("<=2.2.99999", "2.2.0", @src());
    expect.range(">=2.1.99999", "2.2.0", @src());
    expect.range("<2.2.99999", "2.2.0", @src());
    expect.range(">2.1.99999", "2.2.0", @src());
    expect.range(">1.0.0", "2.0.0", @src());
    expect.range("1.0.0", "1.0.0", @src());
    expect.notRange("1.0.0", "2.0.0", @src());

    expect.range("1.0.0 || 2.0.0", "1.0.0", @src());
    expect.range("2.0.0 || 1.0.0", "1.0.0", @src());
    expect.range("1.0.0 || 2.0.0", "2.0.0", @src());
    expect.range("2.0.0 || 1.0.0", "2.0.0", @src());
    expect.range("2.0.0 || >1.0.0", "2.0.0", @src());

    expect.range(">1.0.0 <2.0.0 <2.0.1 >1.0.1", "1.0.2", @src());

    expect.range("2.x", "2.0.0", @src());
    expect.range("2.x", "2.1.0", @src());
    expect.range("2.x", "2.2.0", @src());
    expect.range("2.x", "2.3.0", @src());
    expect.range("2.x", "2.1.1", @src());
    expect.range("2.x", "2.2.2", @src());
    expect.range("2.x", "2.3.3", @src());

    expect.range("<2.0.1 >1.0.0", "2.0.0", @src());
    expect.range("<=2.0.1 >=1.0.0", "2.0.0", @src());

    expect.range("^2", "2.0.0", @src());
    expect.range("^2", "2.9.9", @src());
    expect.range("~2", "2.0.0", @src());
    expect.range("~2", "2.1.0", @src());
    expect.range("~2.2", "2.2.1", @src());

    {
        const passing = [_]string{ "2.4.0", "2.4.1", "3.0.0", "3.0.1", "3.1.0", "3.2.0", "3.3.0", "3.3.1", "3.4.0", "3.5.0", "3.6.0", "3.7.0", "2.4.2", "3.8.0", "3.9.0", "3.9.1", "3.9.2", "3.9.3", "3.10.0", "3.10.1", "4.0.0", "4.0.1", "4.1.0", "4.2.0", "4.2.1", "4.3.0", "4.4.0", "4.5.0", "4.5.1", "4.6.0", "4.6.1", "4.7.0", "4.8.0", "4.8.1", "4.8.2", "4.9.0", "4.10.0", "4.11.0", "4.11.1", "4.11.2", "4.12.0", "4.13.0", "4.13.1", "4.14.0", "4.14.1", "4.14.2", "4.15.0", "4.16.0", "4.16.1", "4.16.2", "4.16.3", "4.16.4", "4.16.5", "4.16.6", "4.17.0", "4.17.1", "4.17.2", "4.17.3", "4.17.4", "4.17.5", "4.17.9", "4.17.10", "4.17.11", "2.0.0", "2.1.0" };

        for (passing) |item| {
            expect.range("^2 <2.2 || > 2.3", item, @src());
            expect.range("> 2.3 || ^2 <2.2", item, @src());
        }

        const not_passing = [_]string{
            "0.1.0",
            "0.10.0",
            "0.2.0",
            "0.2.1",
            "0.2.2",
            "0.3.0",
            "0.3.1",
            "0.3.2",
            "0.4.0",
            "0.4.1",
            "0.4.2",
            "0.5.0",
            // "0.5.0-rc.1",
            "0.5.1",
            "0.5.2",
            "0.6.0",
            "0.6.1",
            "0.7.0",
            "0.8.0",
            "0.8.1",
            "0.8.2",
            "0.9.0",
            "0.9.1",
            "0.9.2",
            "1.0.0",
            "1.0.1",
            "1.0.2",
            "1.1.0",
            "1.1.1",
            "1.2.0",
            "1.2.1",
            "1.3.0",
            "1.3.1",
            "2.2.0",
            "2.2.1",
            "2.3.0",
            // "1.0.0-rc.1",
            // "1.0.0-rc.2",
            // "1.0.0-rc.3",
        };

        for (not_passing) |item| {
            expect.notRange("^2 <2.2 || > 2.3", item, @src());
            expect.notRange("> 2.3 || ^2 <2.2", item, @src());
        }
    }
    expect.range("2.1.0 || > 2.2 || >3", "2.1.0", @src());
    expect.range(" > 2.2 || >3 || 2.1.0", "2.1.0", @src());
    expect.range(" > 2.2 || 2.1.0 || >3", "2.1.0", @src());
    expect.range("> 2.2 || 2.1.0 || >3", "2.3.0", @src());
    expect.notRange("> 2.2 || 2.1.0 || >3", "2.2.1", @src());
    expect.notRange("> 2.2 || 2.1.0 || >3", "2.2.0", @src());
    expect.range("> 2.2 || 2.1.0 || >3", "2.3.0", @src());
    expect.range("> 2.2 || 2.1.0 || >3", "3.0.1", @src());
    expect.range("~2", "2.0.0", @src());
    expect.range("~2", "2.1.0", @src());

    expect.range("1.2.0 - 1.3.0", "1.2.2", @src());
    expect.range("1.2 - 1.3", "1.2.2", @src());
    expect.range("1 - 1.3", "1.2.2", @src());
    expect.range("1 - 1.3", "1.3.0", @src());
    expect.range("1.2 - 1.3", "1.3.1", @src());
    expect.notRange("1.2 - 1.3", "1.4.0", @src());
    expect.range("1 - 1.3", "1.3.1", @src());

    expect.notRange("1.2 - 1.3 || 5.0", "6.4.0", @src());
    expect.range("1.2 - 1.3 || 5.0", "1.2.1", @src());
    expect.range("5.0 || 1.2 - 1.3", "1.2.1", @src());
    expect.range("1.2 - 1.3 || 5.0", "5.0", @src());
    expect.range("5.0 || 1.2 - 1.3", "5.0", @src());
    expect.range("1.2 - 1.3 || 5.0", "5.0.2", @src());
    expect.range("5.0 || 1.2 - 1.3", "5.0.2", @src());
    expect.range("1.2 - 1.3 || 5.0", "5.0.2", @src());
    expect.range("5.0 || 1.2 - 1.3", "5.0.2", @src());
    expect.range("5.0 || 1.2 - 1.3 || >8", "9.0.2", @src());
}
