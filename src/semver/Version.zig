pub const Version = extern struct {
    major: u32 = 0,
    minor: u32 = 0,
    patch: u32 = 0,
    _tag_padding: [4]u8 = .{0} ** 4, // [see padding_checker.zig]
    tag: Tag = .{},

    /// Assumes that there is only one buffer for all the strings
    pub fn sortGt(ctx: []const u8, lhs: Version, rhs: Version) bool {
        return orderFn(ctx, lhs, rhs) == .gt;
    }

    pub fn orderFn(ctx: []const u8, lhs: Version, rhs: Version) std.math.Order {
        return lhs.order(rhs, ctx, ctx);
    }

    pub fn isZero(this: Version) bool {
        return this.patch == 0 and this.minor == 0 and this.major == 0;
    }

    pub fn parseUTF8(slice: []const u8) ParseResult {
        return parse(.{ .buf = slice, .slice = slice });
    }

    pub fn cloneInto(this: Version, slice: []const u8, buf: *[]u8) Version {
        return .{
            .major = this.major,
            .minor = this.minor,
            .patch = this.patch,
            .tag = this.tag.cloneInto(slice, buf),
        };
    }

    pub inline fn len(this: *const Version) u32 {
        return this.tag.build.len + this.tag.pre.len;
    }

    pub const Formatter = struct {
        version: Version,
        input: string,

        pub fn format(formatter: Formatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const self = formatter.version;
            try std.fmt.format(writer, "{?d}.{?d}.{?d}", .{ self.major, self.minor, self.patch });

            if (self.tag.hasPre()) {
                const pre = self.tag.pre.slice(formatter.input);
                try writer.writeAll("-");
                try writer.writeAll(pre);
            }

            if (self.tag.hasBuild()) {
                const build = self.tag.build.slice(formatter.input);
                try writer.writeAll("+");
                try writer.writeAll(build);
            }
        }
    };

    pub fn fmt(this: Version, input: string) Formatter {
        return .{ .version = this, .input = input };
    }

    pub const DiffFormatter = struct {
        version: Version,
        buf: string,
        other: Version,
        other_buf: string,

        pub fn format(this: DiffFormatter, comptime fmt_: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
            if (!Output.enable_ansi_colors) {
                // print normally if no colors
                const formatter: Formatter = .{ .version = this.version, .input = this.buf };
                return Formatter.format(formatter, fmt_, options, writer);
            }

            const diff = this.version.whichVersionIsDifferent(this.other, this.buf, this.other_buf) orelse .none;

            switch (diff) {
                .major => try writer.print(Output.prettyFmt("<r><b><red>{d}.{d}.{d}", true), .{
                    this.version.major, this.version.minor, this.version.patch,
                }),
                .minor => {
                    if (this.version.major == 0) {
                        try writer.print(Output.prettyFmt("<d>{d}.<r><b><red>{d}.{d}", true), .{
                            this.version.major, this.version.minor, this.version.patch,
                        });
                    } else {
                        try writer.print(Output.prettyFmt("<d>{d}.<r><b><yellow>{d}.{d}", true), .{
                            this.version.major, this.version.minor, this.version.patch,
                        });
                    }
                },
                .patch => {
                    if (this.version.major == 0 and this.version.minor == 0) {
                        try writer.print(Output.prettyFmt("<d>{d}.{d}.<r><b><red>{d}", true), .{
                            this.version.major, this.version.minor, this.version.patch,
                        });
                    } else {
                        try writer.print(Output.prettyFmt("<d>{d}.{d}.<r><b><green>{d}", true), .{
                            this.version.major, this.version.minor, this.version.patch,
                        });
                    }
                },
                .none, .pre, .build => try writer.print(Output.prettyFmt("<d>{d}.{d}.{d}", true), .{
                    this.version.major, this.version.minor, this.version.patch,
                }),
            }

            // might be pre or build. loop through all characters, and insert <red> on
            // first diff.

            var set_color = false;
            if (this.version.tag.hasPre()) {
                if (this.other.tag.hasPre()) {
                    const pre = this.version.tag.pre.slice(this.buf);
                    const other_pre = this.other.tag.pre.slice(this.other_buf);

                    var first = true;
                    for (pre, 0..) |c, i| {
                        if (!set_color and i < other_pre.len and c != other_pre[i]) {
                            set_color = true;
                            try writer.writeAll(Output.prettyFmt("<r><b><red>", true));
                        }
                        if (first) {
                            first = false;
                            try writer.writeByte('-');
                        }
                        try writer.writeByte(c);
                    }
                } else {
                    try writer.print(Output.prettyFmt("<r><b><red>-{}", true), .{this.version.tag.pre.fmt(this.buf)});
                    set_color = true;
                }
            }

            if (this.version.tag.hasBuild()) {
                if (this.other.tag.hasBuild()) {
                    const build = this.version.tag.build.slice(this.buf);
                    const other_build = this.other.tag.build.slice(this.other_buf);

                    var first = true;
                    for (build, 0..) |c, i| {
                        if (!set_color and i < other_build.len and c != other_build[i]) {
                            set_color = true;
                            try writer.writeAll(Output.prettyFmt("<r><b><red>", true));
                        }
                        if (first) {
                            first = false;
                            try writer.writeByte('+');
                        }
                        try writer.writeByte(c);
                    }
                } else {
                    if (!set_color) {
                        try writer.print(Output.prettyFmt("<r><b><red>+{}", true), .{this.version.tag.build.fmt(this.buf)});
                    } else {
                        try writer.print("+{}", .{this.version.tag.build.fmt(this.other_buf)});
                    }
                }
            }

            try writer.writeAll(Output.prettyFmt("<r>", true));
        }
    };

    pub fn diffFmt(this: Version, other: Version, this_buf: string, other_buf: string) DiffFormatter {
        return .{
            .version = this,
            .buf = this_buf,
            .other = other,
            .other_buf = other_buf,
        };
    }

    pub const ChangedVersion = enum {
        major,
        minor,
        patch,
        pre,
        build,
        none,
    };

    pub fn whichVersionIsDifferent(
        left: Version,
        right: Version,
        left_buf: string,
        right_buf: string,
    ) ?ChangedVersion {
        if (left.major != right.major) return .major;
        if (left.minor != right.minor) return .minor;
        if (left.patch != right.patch) return .patch;

        if (left.tag.hasPre() != right.tag.hasPre()) return .pre;
        if (!left.tag.hasPre() and !right.tag.hasPre()) return null;
        if (left.tag.orderPre(right.tag, left_buf, right_buf) != .eq) return .pre;

        if (left.tag.hasBuild() != right.tag.hasBuild()) return .build;
        if (!left.tag.hasBuild() and !right.tag.hasBuild()) return null;
        return if (left.tag.build.order(&right.tag.build, left_buf, right_buf) != .eq)
            .build
        else
            null;
    }

    pub fn count(this: *const Version, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
        if (this.tag.hasPre() and !this.tag.pre.isInline()) builder.count(this.tag.pre.slice(buf));
        if (this.tag.hasBuild() and !this.tag.build.isInline()) builder.count(this.tag.build.slice(buf));
    }

    pub fn append(this: *const Version, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) Version {
        var that = this.*;

        if (this.tag.hasPre() and !this.tag.pre.isInline()) that.tag.pre = builder.append(ExternalString, this.tag.pre.slice(buf));
        if (this.tag.hasBuild() and !this.tag.build.isInline()) that.tag.build = builder.append(ExternalString, this.tag.build.slice(buf));

        return that;
    }

    pub const Partial = struct {
        major: ?u32 = null,
        minor: ?u32 = null,
        patch: ?u32 = null,
        tag: Tag = .{},

        pub fn min(this: Partial) Version {
            return .{
                .major = this.major orelse 0,
                .minor = this.minor orelse 0,
                .patch = this.patch orelse 0,
                .tag = this.tag,
            };
        }

        pub fn max(this: Partial) Version {
            return .{
                .major = this.major orelse std.math.maxInt(u32),
                .minor = this.minor orelse std.math.maxInt(u32),
                .patch = this.patch orelse std.math.maxInt(u32),
                .tag = this.tag,
            };
        }
    };

    const Hashable = extern struct {
        major: u32,
        minor: u32,
        patch: u32,
        pre: u64,
        build: u64,
    };

    pub fn hash(this: Version) u64 {
        const hashable = Hashable{
            .major = this.major,
            .minor = this.minor,
            .patch = this.patch,
            .pre = this.tag.pre.hash,
            .build = this.tag.build.hash,
        };
        const bytes = std.mem.asBytes(&hashable);
        return bun.Wyhash.hash(0, bytes);
    }

    pub fn eql(lhs: Version, rhs: Version) bool {
        return lhs.major == rhs.major and lhs.minor == rhs.minor and lhs.patch == rhs.patch and rhs.tag.eql(lhs.tag);
    }

    pub const HashContext = struct {
        pub fn hash(_: @This(), lhs: Version) u32 {
            return @as(u32, @truncate(lhs.hash()));
        }

        pub fn eql(_: @This(), lhs: Version, rhs: Version) bool {
            return lhs.eql(rhs);
        }
    };

    pub const PinnedVersion = enum {
        major, // ^
        minor, // ~
        patch, // =
    };

    /// Modified version of pnpm's `whichVersionIsPinned`
    /// https://github.com/pnpm/pnpm/blob/bc0618cf192a9cafd0ab171a3673e23ed0869bbd/packages/which-version-is-pinned/src/index.ts#L9
    ///
    /// Differences:
    /// - It's not used for workspaces
    /// - `npm:` is assumed already removed from aliased versions
    /// - Invalid input is considered major pinned (important because these strings are coming
    ///    from package.json)
    ///
    /// The goal of this function is to avoid a complete parse of semver that's unused
    pub fn whichVersionIsPinned(input: string) PinnedVersion {
        const version = strings.trim(input, &strings.whitespace_chars);

        var i: usize = 0;

        const pinned: PinnedVersion = pinned: {
            for (0..version.len) |j| {
                switch (version[j]) {
                    // newlines & whitespace
                    ' ',
                    '\t',
                    '\n',
                    '\r',
                    std.ascii.control_code.vt,
                    std.ascii.control_code.ff,

                    // version separators
                    'v',
                    '=',
                    => {},

                    else => |c| {
                        i = j;

                        switch (c) {
                            '~', '^' => {
                                i += 1;

                                for (i..version.len) |k| {
                                    switch (version[k]) {
                                        ' ',
                                        '\t',
                                        '\n',
                                        '\r',
                                        std.ascii.control_code.vt,
                                        std.ascii.control_code.ff,
                                        => {
                                            // `v` and `=` not included.
                                            // `~v==1` would update to `^1.1.0` if versions `1.0.0`, `1.0.1`, `1.1.0`, and `2.0.0` are available
                                            // note that `~` changes to `^`
                                        },

                                        else => {
                                            i = k;
                                            break :pinned if (c == '~') .minor else .major;
                                        },
                                    }
                                }

                                // entire version after `~` is whitespace. invalid
                                return .major;
                            },

                            '0'...'9' => break :pinned .patch,

                            // could be invalid, could also be valid range syntax (>=, ...)
                            // either way, pin major
                            else => return .major,
                        }
                    },
                }
            }

            // entire semver is whitespace, `v`, and `=`. Invalid
            return .major;
        };

        // `pinned` is `.major`, `.minor`, or `.patch`. Check for each version core number:
        // - if major is missing, return `if (pinned == .patch) .major else pinned`
        // - if minor is missing, return `if (pinned == .patch) .minor else pinned`
        // - if patch is missing, return `pinned`
        // - if there's whitespace or non-digit characters between core numbers, return `.major`
        // - if the end is reached, return `pinned`

        // major
        if (i >= version.len or !std.ascii.isDigit(version[i])) return .major;
        var d = version[i];
        while (std.ascii.isDigit(d)) {
            i += 1;
            if (i >= version.len) return if (pinned == .patch) .major else pinned;
            d = version[i];
        }

        if (d != '.') return .major;

        // minor
        i += 1;
        if (i >= version.len or !std.ascii.isDigit(version[i])) return .major;
        d = version[i];
        while (std.ascii.isDigit(d)) {
            i += 1;
            if (i >= version.len) return if (pinned == .patch) .minor else pinned;
            d = version[i];
        }

        if (d != '.') return .major;

        // patch
        i += 1;
        if (i >= version.len or !std.ascii.isDigit(version[i])) return .major;
        d = version[i];
        while (std.ascii.isDigit(d)) {
            i += 1;

            // patch is done and at input end, valid
            if (i >= version.len) return pinned;
            d = version[i];
        }

        // Skip remaining valid pre/build tag characters and whitespace.
        // Does not validate whitespace used inside pre/build tags.
        if (!validPreOrBuildTagCharacter(d) or std.ascii.isWhitespace(d)) return .major;
        i += 1;

        // at this point the semver is valid so we can return true if it ends
        if (i >= version.len) return pinned;
        d = version[i];
        while (validPreOrBuildTagCharacter(d) and !std.ascii.isWhitespace(d)) {
            i += 1;
            if (i >= version.len) return pinned;
            d = version[i];
        }

        // We've come across a character that is not valid for tags or is whitespace.
        // Trailing whitespace was trimmed so we can assume there's another range
        return .major;
    }

    fn validPreOrBuildTagCharacter(c: u8) bool {
        return switch (c) {
            '-', '+', '.', 'A'...'Z', 'a'...'z', '0'...'9' => true,
            else => false,
        };
    }

    pub fn isTaggedVersionOnly(input: []const u8) bool {
        const version = strings.trim(input, &strings.whitespace_chars);

        // first needs to be a-z
        if (version.len == 0 or !std.ascii.isAlphabetic(version[0])) return false;

        for (1..version.len) |i| {
            if (!std.ascii.isAlphanumeric(version[i])) return false;
        }

        return true;
    }

    pub fn orderWithoutTag(
        lhs: Version,
        rhs: Version,
    ) std.math.Order {
        if (lhs.major < rhs.major) return .lt;
        if (lhs.major > rhs.major) return .gt;
        if (lhs.minor < rhs.minor) return .lt;
        if (lhs.minor > rhs.minor) return .gt;
        if (lhs.patch < rhs.patch) return .lt;
        if (lhs.patch > rhs.patch) return .gt;

        if (lhs.tag.hasPre()) {
            if (!rhs.tag.hasPre()) return .lt;
        } else {
            if (rhs.tag.hasPre()) return .gt;
        }

        return .eq;
    }

    pub fn order(
        lhs: Version,
        rhs: Version,
        lhs_buf: []const u8,
        rhs_buf: []const u8,
    ) std.math.Order {
        const order_without_tag = orderWithoutTag(lhs, rhs);
        if (order_without_tag != .eq) return order_without_tag;

        return lhs.tag.order(rhs.tag, lhs_buf, rhs_buf);
    }

    pub fn orderWithoutBuild(
        lhs: Version,
        rhs: Version,
        lhs_buf: []const u8,
        rhs_buf: []const u8,
    ) std.math.Order {
        const order_without_tag = orderWithoutTag(lhs, rhs);
        if (order_without_tag != .eq) return order_without_tag;

        return lhs.tag.orderWithoutBuild(rhs.tag, lhs_buf, rhs_buf);
    }

    pub const Tag = extern struct {
        pre: ExternalString = ExternalString{},
        build: ExternalString = ExternalString{},

        pub fn orderPre(lhs: Tag, rhs: Tag, lhs_buf: []const u8, rhs_buf: []const u8) std.math.Order {
            const lhs_str = lhs.pre.slice(lhs_buf);
            const rhs_str = rhs.pre.slice(rhs_buf);

            // 1. split each by '.', iterating through each one looking for integers
            // 2. compare as integers, or if not possible compare as string
            // 3. whichever is greater is the greater one
            //
            // 1.0.0-canary.0.0.0.0.0.0 < 1.0.0-canary.0.0.0.0.0.1

            var lhs_itr = strings.split(lhs_str, ".");
            var rhs_itr = strings.split(rhs_str, ".");

            while (true) {
                const lhs_part = lhs_itr.next();
                const rhs_part = rhs_itr.next();

                if (lhs_part == null and rhs_part == null) return .eq;

                // if right is null, left is greater than.
                if (rhs_part == null) return .gt;

                // if left is null, left is less than.
                if (lhs_part == null) return .lt;

                const lhs_uint: ?u32 = std.fmt.parseUnsigned(u32, lhs_part.?, 10) catch null;
                const rhs_uint: ?u32 = std.fmt.parseUnsigned(u32, rhs_part.?, 10) catch null;

                // a part that doesn't parse as an integer is greater than a part that does
                // https://github.com/npm/node-semver/blob/816c7b2cbfcb1986958a290f941eddfd0441139e/internal/identifiers.js#L12
                if (lhs_uint != null and rhs_uint == null) return .lt;
                if (lhs_uint == null and rhs_uint != null) return .gt;

                if (lhs_uint == null and rhs_uint == null) {
                    switch (strings.order(lhs_part.?, rhs_part.?)) {
                        .eq => {
                            // continue to the next part
                            continue;
                        },
                        else => |not_equal| return not_equal,
                    }
                }

                switch (std.math.order(lhs_uint.?, rhs_uint.?)) {
                    .eq => continue,
                    else => |not_equal| return not_equal,
                }
            }

            unreachable;
        }

        pub fn order(
            lhs: Tag,
            rhs: Tag,
            lhs_buf: []const u8,
            rhs_buf: []const u8,
        ) std.math.Order {
            if (!lhs.pre.isEmpty() and !rhs.pre.isEmpty()) {
                return lhs.orderPre(rhs, lhs_buf, rhs_buf);
            }

            const pre_order = lhs.pre.order(&rhs.pre, lhs_buf, rhs_buf);
            if (pre_order != .eq) return pre_order;

            return lhs.build.order(&rhs.build, lhs_buf, rhs_buf);
        }

        pub fn orderWithoutBuild(
            lhs: Tag,
            rhs: Tag,
            lhs_buf: []const u8,
            rhs_buf: []const u8,
        ) std.math.Order {
            if (!lhs.pre.isEmpty() and !rhs.pre.isEmpty()) {
                return lhs.orderPre(rhs, lhs_buf, rhs_buf);
            }

            return lhs.pre.order(&rhs.pre, lhs_buf, rhs_buf);
        }

        pub fn cloneInto(this: Tag, slice: []const u8, buf: *[]u8) Tag {
            var pre: String = this.pre.value;
            var build: String = this.build.value;

            if (this.pre.isInline()) {
                pre = this.pre.value;
            } else {
                const pre_slice = this.pre.slice(slice);
                bun.copy(u8, buf.*, pre_slice);
                pre = String.init(buf.*, buf.*[0..pre_slice.len]);
                buf.* = buf.*[pre_slice.len..];
            }

            if (this.build.isInline()) {
                build = this.build.value;
            } else {
                const build_slice = this.build.slice(slice);
                bun.copy(u8, buf.*, build_slice);
                build = String.init(buf.*, buf.*[0..build_slice.len]);
                buf.* = buf.*[build_slice.len..];
            }

            return .{
                .pre = .{
                    .value = pre,
                    .hash = this.pre.hash,
                },
                .build = .{
                    .value = build,
                    .hash = this.build.hash,
                },
            };
        }

        pub inline fn hasPre(this: Tag) bool {
            return !this.pre.isEmpty();
        }

        pub inline fn hasBuild(this: Tag) bool {
            return !this.build.isEmpty();
        }

        pub fn eql(lhs: Tag, rhs: Tag) bool {
            return lhs.pre.hash == rhs.pre.hash;
        }

        pub const TagResult = struct {
            tag: Tag = Tag{},
            len: u32 = 0,
        };

        var multi_tag_warn = false;
        // TODO: support multiple tags

        pub fn parse(sliced_string: SlicedString) TagResult {
            return parseWithPreCount(sliced_string, 0);
        }

        pub fn parseWithPreCount(sliced_string: SlicedString, initial_pre_count: u32) TagResult {
            var input = sliced_string.slice;
            var build_count: u32 = 0;
            var pre_count: u32 = initial_pre_count;

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

            var i: usize = 0;

            while (i < input.len) : (i += 1) {
                const c = input[i];
                switch (c) {
                    '+' => {
                        // qualifier  ::= ( '-' pre )? ( '+' build )?
                        if (state == .pre or state == .none and initial_pre_count > 0) {
                            result.tag.pre = sliced_string.sub(input[start..i]).external();
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

                    // only continue if character is a valid pre/build tag character
                    // https://semver.org/#spec-item-9
                    'a'...'z', 'A'...'Z', '0'...'9', '.' => {},

                    else => {
                        switch (state) {
                            .none => {},
                            .pre => {
                                result.tag.pre = sliced_string.sub(input[start..i]).external();

                                state = State.none;
                            },
                            .build => {
                                result.tag.build = sliced_string.sub(input[start..i]).external();
                                if (comptime Environment.isDebug) {
                                    assert(!strings.containsChar(result.tag.build.slice(sliced_string.buf), '-'));
                                }
                                state = State.none;
                            },
                        }
                        result.len = @truncate(i);
                        break;
                    },
                }
            }

            if (state == .none and initial_pre_count > 0) {
                state = .pre;
                start = 0;
            }

            switch (state) {
                .none => {},
                .pre => {
                    result.tag.pre = sliced_string.sub(input[start..i]).external();
                    // a pre can contain multiple consecutive tags
                    // checking for "-" prefix is not enough, as --canary.67e7966.0 is a valid tag
                    state = State.none;
                },
                .build => {
                    // a build can contain multiple consecutive tags
                    result.tag.build = sliced_string.sub(input[start..i]).external();

                    state = State.none;
                },
            }
            result.len = @as(u32, @truncate(i));

            return result;
        }
    };

    pub const ParseResult = struct {
        wildcard: Query.Token.Wildcard = .none,
        valid: bool = true,
        version: Version.Partial = .{},
        len: u32 = 0,
    };

    pub fn parse(sliced_string: SlicedString) ParseResult {
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

        var i: usize = 0;

        for (0..input.len) |c| {
            switch (input[c]) {
                // newlines & whitespace
                ' ',
                '\t',
                '\n',
                '\r',
                std.ascii.control_code.vt,
                std.ascii.control_code.ff,

                // version separators
                'v',
                '=',
                => {},
                else => {
                    i = c;
                    break;
                },
            }
        }

        if (i == input.len) {
            result.valid = false;
            return result;
        }

        // two passes :(
        while (i < input.len) {
            if (is_done) {
                break;
            }

            switch (input[i]) {
                ' ' => {
                    is_done = true;
                    break;
                },
                '|', '^', '#', '&', '%', '!' => {
                    is_done = true;
                    if (i > 0) {
                        i -= 1;
                    }
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
                        // `.` is expected only if there are remaining core version numbers
                        '.' => part_i != 3,
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
                    if (part_i < 2 and result.wildcard == .none) {
                        result.valid = false;
                        is_done = true;
                        break;
                    }

                    part_start_i = i;
                    while (i < input.len and switch (input[i]) {
                        ' ' => true,
                        else => false,
                    }) {
                        i += 1;
                    }
                    const tag_result = Tag.parse(sliced_string.sub(input[part_start_i..]));
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
                            else => {},
                        }
                    }
                },
                else => |c| {

                    // Some weirdo npm packages in the wild have a version like "1.0.0rc.1"
                    // npm just expects that to work...even though it has no "-" qualifier.
                    if (result.wildcard == .none and part_i >= 2 and switch (c) {
                        'a'...'z', 'A'...'Z' => true,
                        else => false,
                    }) {
                        part_start_i = i;
                        const tag_result = Tag.parseWithPreCount(sliced_string.sub(input[part_start_i..]), 1);
                        result.version.tag = tag_result.tag;
                        i += tag_result.len;
                        is_done = true;
                        last_char_i = i;
                        break;
                    }

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

        result.len = @as(u32, @intCast(i));

        return result;
    }

    fn parseVersionNumber(input: string) ?u32 {
        // max decimal u32 is 4294967295
        var bytes: [10]u8 = undefined;
        var byte_i: u8 = 0;

        assert(input[0] != '.');

        for (input) |char| {
            switch (char) {
                'X', 'x', '*' => return null,
                '0'...'9' => {
                    // out of bounds
                    if (byte_i + 1 > bytes.len) return null;
                    bytes[byte_i] = char;
                    byte_i += 1;
                },
                ' ', '.' => break,
                // ignore invalid characters
                else => {},
            }
        }

        // If there are no numbers
        if (byte_i == 0) return null;

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

const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;

const ExternalString = bun.Semver.ExternalString;
const SlicedString = bun.Semver.SlicedString;
const String = bun.Semver.String;

const Query = bun.Semver.Query;
const assert = bun.assert;
