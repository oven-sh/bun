const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Error = css.Error;

const Property = css.Property;
const PropertyId = css.PropertyId;

const ContainerName = css.css_rules.container.ContainerName;

const CSSNumberFns = css.css_values.number.CSSNumberFns;
const LengthPercentage = css.css_values.length.LengthPercentage;
const CustomIdent = css.css_values.ident.CustomIdent;
const CSSString = css.css_values.string.CSSString;
const CSSNumber = css.css_values.number.CSSNumber;
const LengthPercentageOrAuto = css.css_values.length.LengthPercentageOrAuto;
const Size2D = css.css_values.size.Size2D;
const DashedIdent = css.css_values.ident.DashedIdent;
const Image = css.css_values.image.Image;
const CssColor = css.css_values.color.CssColor;
const Ratio = css.css_values.ratio.Ratio;
const Length = css.css_values.length.LengthValue;
const Rect = css.css_values.rect.Rect;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;
const CustomIdentList = css.css_values.ident.CustomIdentList;
const Angle = css.css_values.angle.Angle;
const Url = css.css_values.url.Url;
const CSSInteger = css.css_values.number.CSSInteger;
const BabyList = bun.BabyList;

const isFlex2009 = css.prefixes.Feature.isFlex2009;

const VendorPrefix = css.VendorPrefix;

/// A [track sizing](https://drafts.csswg.org/css-grid-2/#track-sizing) value
/// for the `grid-template-rows` and `grid-template-columns` properties.
pub const TrackSizing = union(enum) {
    /// No explicit grid tracks.
    none,
    /// A list of grid tracks.
    tracklist: TrackList,

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());
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
            line_names.append(input.allocator(), line_name) catch bun.outOfMemory();

            if (input.tryParse(TrackSize.parse, .{}).asValue()) |track_size| {
                // TODO: error handling
                items.append(.{ .track_size = track_size }) catch bun.outOfMemory();
            } else if (input.tryParse(TrackRepeat.parse, .{}).asValue()) |repeat| {
                // TODO: error handling
                items.append(.{ .track_repeat = repeat }) catch bun.outOfMemory();
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

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        var items_index = 0;
        var first = true;

        for (this.line_names.sliceConst()) |*names| {
            if (!names.isEmpty()) try serializeLineNames(names, W, dest);

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
                    .track_repeat => |*repeat| try repeat.toCss(W, dest),
                    .track_size => |*size| try size.toCss(W, dest),
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

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        switch (this.*) {
            .track_breadth => |breadth| try breadth.toCss(W, dest),
            .min_max => |mm| {
                try dest.writeStr("minmax(");
                try mm.min.toCss(W, dest);
                try dest.delim(',', false);
                try mm.max.toCss(W, dest);
                try dest.writeChar(')');
            },
            .fit_content => |len| {
                try dest.writeStr("fit-content(");
                try len.toCss(W, dest);
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
            res.append(input.allocator(), size) catch bun.outOfMemory();
        }

        if (res.len() == 1 and res.at(0).eql(&TrackSize.default())) {
            res.clearRetainingCapacity();
        }

        return .{ .result = .{ .v = res } };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
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
            try item.toCss(W, dest);
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

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        switch (this.*) {
            .auto => try dest.writeStr("auto"),
            .min_content => try dest.writeStr("min-content"),
            .max_content => try dest.writeStr("max-content"),
            .length => |len| try len.toCss(W, dest),
            // .flex => |flex| try css.CSSNumberFns.serializeDimension(&flex, "fr", W, dest),
            .flex => |flex| css.serializer.serializeDimension(flex, "fr", W, dest),
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

                var line_names = bun.BabyList(CustomIdentList).init(i.allocator);
                var track_sizes = bun.BabyList(TrackSize).init(i.allocator);

                while (true) {
                    const line_name = i.tryParse(parseLineNames, .{}).unwrapOr(CustomIdentList{});
                    line_names.append(i.allocator(), line_name) catch bun.outOfMemory();

                    if (input.tryParse(TrackSize.parse, .{}).asValue()) |track_size| {
                        // TODO: error handling
                        track_sizes.append(i.allocator(), track_size) catch bun.outOfMemory();
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

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        try dest.writeStr("repeat(");
        try this.count.toCss(W, dest);
        try dest.delim(',', false);

        var track_sizes_index = 0;
        var first = true;
        for (this.line_names.sliceConst()) |*names| {
            if (!names.isEmpty()) {
                try serializeLineNames(names, W, dest);
            }

            if (track_sizes_index < this.track_sizes.len) {
                const size = this.track_sizes.at(track_sizes_index);
                track_sizes_index += 1;

                if (!names.isEmpty()) {
                    try dest.whitespace();
                } else if (!first) {
                    try dest.writeChar(' ');
                }
                try size.toCss(W, dest);
            }

            first = false;
        }

        try dest.writeChar(')');
    }
};

fn serializeLineNames(names: []const CustomIdent, comptime W: type, dest: *Printer(W)) PrintErr!void {
    try dest.writeChar('[');
    var first = true;
    for (names) |*name| {
        if (first) {
            first = false;
        } else {
            try dest.writeChar(' ');
        }
        try writeIdent(&name.value, W, dest);
    }
    try dest.writeChar(']');
}

fn writeIdent(name: []const u8, comptime W: type, dest: *Printer(W)) PrintErr!void {
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
                values.append(i.allocator(), ident) catch bun.outOfMemory();
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

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

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
            tokens.append(allocator, token) catch bun.outOfMemory();
            string = rest[token_len..];
        }

        return .{ .result = column };
    }
};

fn isNameCodepoint(c: u8) bool {
    // alpha numeric, -, _, o
    return c >= 'a' and c <= 'z' or c >= 'A' and c <= 'Z' or c == '_' or c >= '0' and c <= '9' or c == '-' or c >= 0x80; // codepoints larger than ascii;
}
