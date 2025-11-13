pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

const CSSNumberFns = css.css_values.number.CSSNumberFns;
const LengthPercentage = css.css_values.length.LengthPercentage;
const CustomIdent = css.css_values.ident.CustomIdent;
const CSSNumber = css.css_values.number.CSSNumber;
const CustomIdentList = css.css_values.ident.CustomIdentList;
const CSSInteger = css.css_values.number.CSSInteger;

/// A [track sizing](https://drafts.csswg.org/css-grid-2/#track-sizing) value
/// for the `grid-template-rows` and `grid-template-columns` properties.
pub const TrackSizing = union(enum) {
    /// No explicit grid tracks.
    none,
    /// A list of grid tracks.
    tracklist: TrackList,

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;
};

/// A [`<track-list>`](https://drafts.csswg.org/css-grid-2/#typedef-track-list) value,
/// as used in the `grid-template-rows` and `grid-template-columns` properties.
///
/// See [TrackSizing](TrackSizing).
pub const TrackList = struct {
    /// A list of line names.
    line_names: bun.BabyList(CustomIdentList),
    /// A list of grid track items.
    items: bun.BabyList(TrackListItem),

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        var line_names = BabyList(CustomIdentList){};
        var items = BabyList(TrackListItem){};

        while (true) {
            const line_name = input.tryParse(parseLineNames, .{}).asValue() orelse CustomIdentList{};
            bun.handleOom(line_names.append(input.allocator(), line_name));

            if (input.tryParse(TrackSize.parse, .{}).asValue()) |track_size| {
                // TODO: error handling
                bun.handleOom(items.append(.{ .track_size = track_size }));
            } else if (input.tryParse(TrackRepeat.parse, .{}).asValue()) |repeat| {
                // TODO: error handling
                bun.handleOom(items.append(.{ .track_repeat = repeat }));
            } else {
                break;
            }
        }

        if (items.len == 0) {
            return .{ .err = input.newCustomError(.invalid_declaration) };
        }

        return .{ .result = .{
            .line_names = line_names,
            .items = items,
        } };
    }

    pub fn toCss(this: *const @This(), dest: *css.Printer) css.PrintErr!void {
        var items_index = 0;
        var first = true;

        for (this.line_names.sliceConst()) |*names| {
            if (!names.isEmpty()) try serializeLineNames(names, dest);

            if (items_index < this.items.len) {
                const item = this.items.at(items_index);
                items_index += 1;

                // Whitespace is required if there are no line names.
                if (!names.isEmpty()) {
                    try dest.whitespace();
                } else if (!first) {
                    try dest.writeChar(' ');
                }

                switch (item.*) {
                    .track_repeat => |*repeat| try repeat.toCss(dest),
                    .track_size => |*size| try size.toCss(dest),
                }
            }

            first = false;
        }
    }
};

/// Either a track size or `repeat()` function.
///
/// See [TrackList](TrackList).
pub const TrackListItem = union(enum) {
    /// A track size.
    track_size: TrackSize,
    /// A `repeat()` function.
    track_repeat: TrackRepeat,
};

/// A [track size](https://drafts.csswg.org/css-grid-2/#typedef-track-size) value.
///
/// See [TrackList](TrackList).
pub const TrackSize = union(enum) {
    /// An explicit track breadth.
    track_breadth: TrackBreadth,
    /// The `minmax()` function.
    min_max: struct {
        /// The minimum value.
        min: TrackBreadth,
        /// The maximum value.
        max: TrackBreadth,
    },
    /// The `fit-content()` function.
    fit_content: LengthPercentage,

    pub fn default() @This() {
        return .{ .track_breadth = TrackBreadth.auto };
    }

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return css.implementEql(@This(), this, other);
    }

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.tryParse(TrackBreadth.parse, .{}).asValue()) |breadth| {
            return .{ .result = .{ .track_breadth = breadth } };
        }

        if (input.tryParse(css.Parser.expectFunctionMatching, .{"minmax"}).isOk()) {
            return input.parseNestedBlock(struct {
                pub fn parse(i: *css.Parser) css.Result(TrackSize) {
                    const min = switch (TrackBreadth.parseInternal(i, false)) {
                        .result => |v| v,
                        .err => |e| return .{ .err = e },
                    };
                    if (i.expectComma().asErr()) |e| return .{ .err = e };
                    return .{
                        .result = .{ .min_max = .{ .min = min, .max = switch (TrackBreadth.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        } } },
                    };
                }
            }.parseFn);
        }

        if (input.expectFunctionMatching("fit-content").asErr()) |e| return .{ .err = e };

        const len = switch (input.parseNestedBlock(css.voidWrap(LengthPercentage, LengthPercentage.parse))) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        return .{ .result = .{ .fit_content = len } };
    }

    pub fn toCss(this: *const @This(), dest: *css.Printer) css.PrintErr!void {
        switch (this.*) {
            .track_breadth => |breadth| try breadth.toCss(dest),
            .min_max => |mm| {
                try dest.writeStr("minmax(");
                try mm.min.toCss(dest);
                try dest.delim(',', false);
                try mm.max.toCss(dest);
                try dest.writeChar(')');
            },
            .fit_content => |len| {
                try dest.writeStr("fit-content(");
                try len.toCss(dest);
                try dest.writeChar(')');
            },
        }
    }
};

pub const TrackSizeList = struct {
    v: SmallList(TrackSize, 1) = .{},

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        var res = SmallList(TrackSize, 1){};
        while (input.tryParse(TrackSize.parse, .{}).asValue()) |size| {
            bun.handleOom(res.append(input.allocator(), size));
        }

        if (res.len() == 1 and res.at(0).eql(&TrackSize.default())) {
            res.clearRetainingCapacity();
        }

        return .{ .result = .{ .v = res } };
    }

    pub fn toCss(this: *const @This(), dest: *css.Printer) css.PrintErr!void {
        if (this.v.len() == 0) {
            try dest.writeStr("auto");
            return;
        }

        var first = true;
        for (this.v.slice()) |item| {
            if (first) {
                first = false;
            } else {
                try dest.writeChar(' ');
            }
            try item.toCss(dest);
        }
    }
};

/// A [track breadth](https://drafts.csswg.org/css-grid-2/#typedef-track-breadth) value.
///
/// See [TrackSize](TrackSize).
pub const TrackBreadth = union(enum) {
    /// An explicit length.
    length: LengthPercentage,
    /// A flex factor.
    flex: CSSNumber,
    /// The `min-content` keyword.
    min_content,
    /// The `max-content` keyword.
    max_content,
    /// The `auto` keyword.
    auto,

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        return TrackBreadth.parseInternal(input, true);
    }

    fn parseInternal(input: *css.Parser, allow_flex: bool) css.Result(@This()) {
        if (input.tryParse(LengthPercentage.parse, .{}).asValue()) |len| {
            return .{ .result = .{ .length = len } };
        }

        if (allow_flex) {
            if (input.tryParse(TrackBreadth.parseFlex, .{}).asValue()) |flex| {
                return .{ .result = .{ .flex = flex } };
            }
        }

        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "auto")) {
            return .{ .result = .auto };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "min-content")) {
            return .{ .result = .min_content };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "max-content")) {
            return .{ .result = .max_content };
        }

        return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
    }

    fn parseFlex(input: *css.Parser) css.Result(CSSNumber) {
        const location = input.currentSourceLocation();
        const token = switch (input.next()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        if (token == .dimension) {
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(token.dimension.unit, "fr") and token.dimension.value >= 0.0) {
                return .{ .result = token.dimension.value };
            }
        }

        return .{ .err = location.newUnexpectedTokenError(token) };
    }

    pub fn toCss(this: *const @This(), dest: *css.Printer) css.PrintErr!void {
        switch (this.*) {
            .auto => try dest.writeStr("auto"),
            .min_content => try dest.writeStr("min-content"),
            .max_content => try dest.writeStr("max-content"),
            .length => |len| try len.toCss(dest),
            // .flex => |flex| try css.CSSNumberFns.serializeDimension(&flex, "fr", dest),
            .flex => |flex| css.serializer.serializeDimension(flex, "fr", dest),
        }
    }
};

/// A `repeat()` function.
///
/// See [TrackList](TrackList).
pub const TrackRepeat = struct {
    /// The repeat count.
    count: RepeatCount,
    /// The line names to repeat.
    line_names: bun.BabyList(CustomIdentList),
    /// The track sizes to repeat.
    track_sizes: bun.BabyList(TrackSize),

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.expectFunctionMatching("repeat").asErr()) |e| return .{ .err = e };

        return input.parseNestedBlock(struct {
            fn parse(i: *css.Parser) css.Result(TrackRepeat) {
                const count = switch (@call(.auto, @field(RepeatCount, "parse"), .{i})) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                };

                if (i.expectComma().asErr()) |e| return .{ .err = e };

                // TODO: this code will not compile if used
                var line_names = bun.BabyList(CustomIdentList).init(i.allocator);
                var track_sizes = bun.BabyList(TrackSize).init(i.allocator);

                while (true) {
                    const line_name = i.tryParse(parseLineNames, .{}).unwrapOr(CustomIdentList{});
                    bun.handleOom(line_names.append(i.allocator(), line_name));

                    if (input.tryParse(TrackSize.parse, .{}).asValue()) |track_size| {
                        // TODO: error handling
                        bun.handleOom(track_sizes.append(i.allocator(), track_size));
                    } else {
                        break;
                    }
                }

                return .{ .result = .{
                    .count = count,
                    .line_names = line_names,
                    .track_sizes = track_sizes,
                } };
            }
        }.parse);
    }

    pub fn toCss(this: *const @This(), dest: *Printer) PrintErr!void {
        try dest.writeStr("repeat(");
        try this.count.toCss(dest);
        try dest.delim(',', false);

        var track_sizes_index = 0;
        var first = true;
        for (this.line_names.sliceConst()) |*names| {
            if (!names.isEmpty()) {
                try serializeLineNames(names, dest);
            }

            if (track_sizes_index < this.track_sizes.len) {
                const size = this.track_sizes.at(track_sizes_index);
                track_sizes_index += 1;

                if (!names.isEmpty()) {
                    try dest.whitespace();
                } else if (!first) {
                    try dest.writeChar(' ');
                }
                try size.toCss(dest);
            }

            first = false;
        }

        try dest.writeChar(')');
    }
};

fn serializeLineNames(names: []const CustomIdent, dest: *Printer) PrintErr!void {
    try dest.writeChar('[');
    var first = true;
    for (names) |*name| {
        if (first) {
            first = false;
        } else {
            try dest.writeChar(' ');
        }
        try writeIdent(&name.value, dest);
    }
    try dest.writeChar(']');
}

fn writeIdent(name: []const u8, dest: *Printer) PrintErr!void {
    const css_module_grid_enabled = if (dest.css_module) |*css_module| css_module.config.grid else false;
    if (css_module_grid_enabled) {
        if (dest.css_module) |*css_module| {
            if (css_module.config.pattern.segments.last()) |last| {
                if (last != css.css_modules.Segment.local) {
                    return try dest.addInvalidCssModulesPatternInGridError();
                }
            }
        }
    }

    try dest.writeIdent(name, css_module_grid_enabled);
}

fn parseLineNames(input: *css.Parser) css.Result(CustomIdentList) {
    if (input.expectSquareBracketBlock().asErr()) |e| return .{ .err = e };

    return input.parseNestedBlock(struct {
        fn parse(i: *css.Parser) css.Result(CustomIdentList) {
            var values = CustomIdentList{};

            while (input.tryParse(CustomIdent.parse, .{}).asValue()) |ident| {
                bun.handleOom(values.append(i.allocator(), ident));
            }

            return .{ .result = values };
        }
    }.parse);
}

/// A [`<repeat-count>`](https://drafts.csswg.org/css-grid-2/#typedef-track-repeat) value,
/// used in the `repeat()` function.
///
/// See [TrackRepeat](TrackRepeat).
pub const RepeatCount = union(enum) {
    /// The number of times to repeat.
    number: CSSInteger,
    /// The `auto-fill` keyword.
    @"auto-fill",
    /// The `auto-fit` keyword.
    @"auto-fit",

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return css.implementEql(@This(), this, other);
    }
};

/// A grid template areas value.
/// See https://drafts.csswg.org/css-grid-2/#propdef-grid-template-areas
pub const GridTemplateAreas = union(enum) {
    /// No named grid areas.
    none,
    /// Defines the list of named grid areas.
    areas: struct {
        /// The number of columns in the grid.
        columns: u32,
        /// A flattened list of grid area names.
        /// Unnamed areas specified by the `.` token are represented as null.
        areas: SmallList(?[]const u8, 1),
    },

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.tryParse(struct {
            fn parse(i: *css.Parser) css.Result(void) {
                return i.expectIdentMatching("none");
            }
        }.parse, .{}).asValue()) |_| {
            return .{ .result = .none };
        }

        var tokens = SmallList(?[]const u8, 1){};
        var row: u32 = 0;
        var columns: u32 = 0;

        if (input.tryParse(css.Parser.expectString, .{}).asValue()) |s| {
            const parsed_columns = switch (parseString(input.allocator(), s, &tokens)) {
                .result => |v| v,
                .err => return .{input.newError(.qualified_rule_invalid)},
            };

            if (row == 0) {
                columns = parsed_columns;
            } else if (parsed_columns != columns) return .{ .err = input.newCustomError(.invalid_declaration) };

            row += 1;
        }

        return .{ .result = .{ .areas = .{
            .columns = columns,
            .areas = tokens,
        } } };
    }

    const HTML_SPACE_CHARACTERS: []const u8 = &.{ 0x0020, 0x0009, 0x000a, 0x000c, 0x000d };

    fn parseString(allocator: Allocator, s: []const u8, tokens: *SmallList(?[]const u8, 1)) bun.Maybe(u32, void) {
        var string = s;
        var column = 0;

        while (true) {
            const rest = bun.strings.trim(string, HTML_SPACE_CHARACTERS);
            if (rest.len == 0) {
                // Each string must produce a valid token.
                if (column == 0) return .{ .err = {} };
                break;
            }

            column += 1;

            if (bun.strings.startsWithChar(rest, '.')) {
                const idx = idx: {
                    for (rest, 0..) |*c, i| {
                        if (c.* != '.') {
                            break :idx i;
                        }
                    }
                    break :idx rest.len;
                };
                string = rest[idx..];
            }

            const starts_with_name_codepoint = brk: {
                if (rest.len == 0) break :brk false;
                break :brk isNameCodepoint(rest[0]);
            };

            if (!starts_with_name_codepoint) return .{ .err = {} };

            const token_len = token_len: {
                for (rest, 0..) |*c, i| {
                    if (!isNameCodepoint(c.*)) {
                        break :token_len i;
                    }
                }
                break :token_len rest.len;
            };
            const token = rest[0..token_len];
            bun.handleOom(tokens.append(allocator, token));
            string = rest[token_len..];
        }

        return .{ .result = column };
    }
};

fn isNameCodepoint(c: u8) bool {
    // alpha numeric, -, _, o
    return c >= 'a' and c <= 'z' or c >= 'A' and c <= 'Z' or c == '_' or c >= '0' and c <= '9' or c == '-' or c >= 0x80; // codepoints larger than ascii;
}

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const BabyList = bun.BabyList;
