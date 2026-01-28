pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;

const css_values = css.css_values;
const LengthPercentage = css_values.length.LengthPercentage;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Percentage = css.css_values.percentage.Percentage;
const Angle = css.css_values.angle.Angle;

/// A value for the [font-weight](https://www.w3.org/TR/css-fonts-4/#font-weight-prop) property.
pub const FontWeight = union(enum) {
    /// An absolute font weight.
    absolute: AbsoluteFontWeight,
    /// The `bolder` keyword.
    bolder,
    /// The `lighter` keyword.
    lighter,

    // TODO: implement this
    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub inline fn default() FontWeight {
        return .{ .absolute = AbsoluteFontWeight.default() };
    }

    pub fn isCompatible(this: *const FontWeight, browsers: bun.css.targets.Browsers) bool {
        return switch (this.*) {
            .absolute => |*a| a.isCompatible(browsers),
            .bolder, .lighter => true,
        };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// An [absolute font weight](https://www.w3.org/TR/css-fonts-4/#font-weight-absolute-values),
/// as used in the `font-weight` property.
///
/// See [FontWeight](FontWeight).
pub const AbsoluteFontWeight = union(enum) {
    /// An explicit weight.
    weight: CSSNumber,
    /// Same as `400`.
    normal,
    /// Same as `700`.
    bold,

    pub const parse = css.DeriveParse(@This()).parse;

    pub fn toCss(this: *const AbsoluteFontWeight, dest: *css.Printer) css.PrintErr!void {
        return switch (this.*) {
            .weight => |*weight| CSSNumberFns.toCss(weight, dest),
            .normal => try dest.writeStr(if (dest.minify) "400" else "normal"),
            .bold => try dest.writeStr(if (dest.minify) "700" else "bold"),
        };
    }

    pub fn isCompatible(this: *const AbsoluteFontWeight, browsers: bun.css.targets.Browsers) bool {
        return switch (this.*) {
            // Older browsers only supported 100, 200, 300, ...900 rather than arbitrary values.
            .weight => |*val| if (!((val.* >= 100.0 and val.* <= 900.0) and @mod(val.*, 100.0) == 0.0))
                css.Feature.font_weight_number.isCompatible(browsers)
            else
                true,
            else => true,
        };
    }

    pub inline fn default() AbsoluteFontWeight {
        return .normal;
    }

    pub fn eql(lhs: *const AbsoluteFontWeight, rhs: *const AbsoluteFontWeight) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [font-size](https://www.w3.org/TR/css-fonts-4/#font-size-prop) property.
pub const FontSize = union(enum) {
    /// An explicit size.
    length: LengthPercentage,
    /// An absolute font size keyword.
    absolute: AbsoluteFontSize,
    /// A relative font size keyword.
    relative: RelativeFontSize,

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub fn isCompatible(this: *const FontSize, browsers: bun.css.targets.Browsers) bool {
        return switch (this.*) {
            .length => |*l| switch (l.*) {
                .dimension => |*d| switch (d.*) {
                    .rem => css.Feature.font_size_rem.isCompatible(browsers),
                    else => l.isCompatible(browsers),
                },
                else => l.isCompatible(browsers),
            },
            .absolute => |*a| a.isCompatible(browsers),
            .relative => true,
        };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// An [absolute font size](https://www.w3.org/TR/css-fonts-3/#absolute-size-value),
/// as used in the `font-size` property.
///
/// See [FontSize](FontSize).
pub const AbsoluteFontSize = enum {
    /// "xx-small"
    @"xx-small",
    /// "x-small"
    @"x-small",
    /// "small"
    small,
    /// "medium"
    medium,
    /// "large"
    large,
    /// "x-large"
    @"x-large",
    /// "xx-large"
    @"xx-large",
    /// "xxx-large"
    @"xxx-large",

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;

    pub fn isCompatible(this: *const AbsoluteFontSize, browsers: bun.css.targets.Browsers) bool {
        return switch (this.*) {
            .@"xxx-large" => css.Feature.font_size_x_x_x_large.isCompatible(browsers),
            else => true,
        };
    }
};

/// A [relative font size](https://www.w3.org/TR/css-fonts-3/#relative-size-value),
/// as used in the `font-size` property.
///
/// See [FontSize](FontSize).
pub const RelativeFontSize = enum {
    smaller,
    larger,

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
};

/// A value for the [font-stretch](https://www.w3.org/TR/css-fonts-4/#font-stretch-prop) property.
pub const FontStretch = union(enum) {
    /// A font stretch keyword.
    keyword: FontStretchKeyword,
    /// A percentage.
    percentage: Percentage,

    // TODO: implement this
    pub const parse = css.DeriveParse(@This()).parse;

    pub fn toCss(this: *const FontStretch, dest: *css.Printer) css.PrintErr!void {
        if (dest.minify) {
            const percentage: Percentage = this.intoPercentage();
            return percentage.toCss(dest);
        }

        return switch (this.*) {
            .percentage => |*val| val.toCss(dest),
            .keyword => |*kw| kw.toCss(dest),
        };
    }

    pub fn intoPercentage(this: *const FontStretch) Percentage {
        return switch (this.*) {
            .percentage => |*val| val.*,
            .keyword => |*kw| kw.intoPercentage(),
        };
    }

    pub fn isCompatible(this: *const FontStretch, browsers: bun.css.targets.Browsers) bool {
        return switch (this.*) {
            .percentage => css.Feature.font_stretch_percentage.isCompatible(browsers),
            .keyword => true,
        };
    }

    pub fn eql(lhs: *const FontStretch, rhs: *const FontStretch) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub inline fn default() FontStretch {
        return .{ .keyword = FontStretchKeyword.default() };
    }
};

/// A [font stretch keyword](https://www.w3.org/TR/css-fonts-4/#font-stretch-prop),
/// as used in the `font-stretch` property.
///
/// See [FontStretch](FontStretch).
pub const FontStretchKeyword = enum {
    /// 100%
    normal,
    /// 50%
    @"ultra-condensed",
    /// 62.5%
    @"extra-condensed",
    /// 75%
    condensed,
    /// 87.5%
    @"semi-condensed",
    /// 112.5%
    @"semi-expanded",
    /// 125%
    expanded,
    /// 150%
    @"extra-expanded",
    /// 200%
    @"ultra-expanded",

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;

    pub inline fn default() FontStretchKeyword {
        return .normal;
    }

    pub fn intoPercentage(this: *const FontStretchKeyword) Percentage {
        const val: f32 = switch (this.*) {
            .@"ultra-condensed" => 0.5,
            .@"extra-condensed" => 0.625,
            .condensed => 0.75,
            .@"semi-condensed" => 0.875,
            .normal => 1.0,
            .@"semi-expanded" => 1.125,
            .expanded => 1.25,
            .@"extra-expanded" => 1.5,
            .@"ultra-expanded" => 2.0,
        };
        return .{ .v = val };
    }
};

/// A value for the [font-family](https://www.w3.org/TR/css-fonts-4/#font-family-prop) property.
pub const FontFamily = union(enum) {
    /// A generic family name.
    generic: GenericFontFamily,
    /// A custom family name.
    family_name: []const u8,

    pub fn HashMap(comptime V: type) type {
        return std.ArrayHashMapUnmanaged(FontFamily, V, struct {
            pub fn hash(_: @This(), key: FontFamily) u32 {
                var hasher = std.hash.Wyhash.init(0);
                key.hash(&hasher);
                return @truncate(hasher.final());
            }

            pub fn eql(_: @This(), a: FontFamily, b: FontFamily, _: usize) bool {
                return a.eql(&b);
            }
        }, false);
    }

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.tryParse(css.Parser.expectString, .{}).asValue()) |value| {
            return .{ .result = .{ .family_name = value } };
        }

        if (input.tryParse(GenericFontFamily.parse, .{}).asValue()) |value| {
            return .{ .result = .{ .generic = value } };
        }

        const stralloc = input.allocator();
        const value = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        var string: ?ArrayList(u8) = null;
        while (input.tryParse(css.Parser.expectIdent, .{}).asValue()) |ident| {
            if (string == null) {
                string = ArrayList(u8){};
                bun.handleOom(string.?.appendSlice(stralloc, value));
            }

            if (string) |*s| {
                bun.handleOom(s.append(stralloc, ' '));
                bun.handleOom(s.appendSlice(stralloc, ident));
            }
        }

        const final_value = if (string) |s| s.items else value;

        return .{ .result = .{ .family_name = final_value } };
    }

    pub fn toCss(this: *const @This(), dest: *Printer) PrintErr!void {
        switch (this.*) {
            .generic => |val| {
                try val.toCss(dest);
            },
            .family_name => |val| {
                // Generic family names such as sans-serif must be quoted if parsed as a string.
                // CSS wide keywords, as well as "default", must also be quoted.
                // https://www.w3.org/TR/css-fonts-4/#family-name-syntax

                if (val.len > 0 and
                    !css.parse_utility.parseString(
                        dest.allocator,
                        GenericFontFamily,
                        val,
                        GenericFontFamily.parse,
                    ).isOk())
                {
                    var id = std.Io.Writer.Allocating.init(dest.allocator);
                    defer id.deinit();
                    var first = true;
                    var split_iter = std.mem.splitScalar(u8, val, ' ');
                    while (split_iter.next()) |slice| {
                        if (first) {
                            first = false;
                        } else {
                            bun.handleOom(id.writer.writeByte(' ') catch |e| switch (e) {
                                error.WriteFailed => error.OutOfMemory,
                            });
                        }
                        css.serializer.serializeIdentifier(slice, &id.writer) catch return dest.addFmtError();
                    }
                    if (id.written().len < val.len + 2) {
                        return dest.writeStr(id.written());
                    }
                }
                return css.serializer.serializeString(val, dest) catch return dest.addFmtError();
            },
        }
    }

    pub fn isCompatible(this: *const FontFamily, browsers: bun.css.targets.Browsers) bool {
        return switch (this.*) {
            .generic => |g| g.isCompatible(browsers),
            .family_name => true,
        };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn hash(this: *const @This(), hasher: anytype) void {
        return css.implementHash(@This(), this, hasher);
    }
};

/// A [generic font family](https://www.w3.org/TR/css-fonts-4/#generic-font-families) name,
/// as used in the `font-family` property.
///
/// See [FontFamily](FontFamily).
pub const GenericFontFamily = enum {
    serif,
    @"sans-serif",
    cursive,
    fantasy,
    monospace,
    @"system-ui",
    emoji,
    math,
    fangsong,
    @"ui-serif",
    @"ui-sans-serif",
    @"ui-monospace",
    @"ui-rounded",

    // CSS wide keywords. These must be parsed as identifiers so they
    // don't get serialized as strings.
    // https://www.w3.org/TR/css-values-4/#common-keywords
    initial,
    inherit,
    unset,
    // Default is also reserved by the <custom-ident> type.
    // https://www.w3.org/TR/css-values-4/#custom-idents
    default,

    // CSS defaulting keywords
    // https://drafts.csswg.org/css-cascade-5/#defaulting-keywords
    revert,
    @"revert-layer",

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;

    pub fn isCompatible(this: *const GenericFontFamily, browsers: bun.css.targets.Browsers) bool {
        return switch (this.*) {
            .@"system-ui" => css.Feature.font_family_system_ui.isCompatible(browsers),
            .@"ui-serif", .@"ui-sans-serif", .@"ui-monospace", .@"ui-rounded" => css.Feature.extended_system_fonts.isCompatible(browsers),
            else => true,
        };
    }
};

/// A value for the [font-style](https://www.w3.org/TR/css-fonts-4/#font-style-prop) property.
pub const FontStyle = union(enum) {
    /// Normal font style.
    normal,
    /// Italic font style.
    italic,
    /// Oblique font style, with a custom angle.
    oblique: Angle,

    pub fn default() FontStyle {
        return .normal;
    }

    pub fn parse(input: *css.Parser) css.Result(FontStyle) {
        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        // todo_stuff.match_ignore_ascii_case
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("normal", ident)) {
            return .{ .result = .normal };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("italic", ident)) {
            return .{ .result = .italic };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("oblique", ident)) {
            const angle = input.tryParse(Angle.parse, .{}).unwrapOr(FontStyle.defaultObliqueAngle());
            return .{ .result = .{ .oblique = angle } };
        } else {
            //
            return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
        }
    }

    pub fn toCss(this: *const FontStyle, dest: *Printer) PrintErr!void {
        switch (this.*) {
            .normal => try dest.writeStr("normal"),
            .italic => try dest.writeStr("italic"),
            .oblique => |angle| {
                try dest.writeStr("oblique");
                if (!angle.eql(&FontStyle.defaultObliqueAngle())) {
                    try dest.writeChar(' ');
                    try angle.toCss(dest);
                }
            },
        }
    }

    pub fn isCompatible(this: *const FontStyle, browsers: bun.css.targets.Browsers) bool {
        return switch (this.*) {
            .oblique => |*angle| if (!angle.eql(&FontStyle.defaultObliqueAngle()))
                css.Feature.font_style_oblique_angle.isCompatible(browsers)
            else
                true,
            .normal, .italic => true,
        };
    }

    pub fn defaultObliqueAngle() Angle {
        return Angle{ .deg = 14.0 };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [font-variant-caps](https://www.w3.org/TR/css-fonts-4/#font-variant-caps-prop) property.
pub const FontVariantCaps = enum {
    /// No special capitalization features are applied.
    normal,
    /// The small capitals feature is used for lower case letters.
    @"small-caps",
    /// Small capitals are used for both upper and lower case letters.
    @"all-small-caps",
    /// Petite capitals are used.
    @"petite-caps",
    /// Petite capitals are used for both upper and lower case letters.
    @"all-petite-caps",
    /// Enables display of mixture of small capitals for uppercase letters with normal lowercase letters.
    unicase,
    /// Uses titling capitals.
    @"titling-caps",

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;

    pub fn default() FontVariantCaps {
        return .normal;
    }

    fn isCss2(this: *const FontVariantCaps) bool {
        return switch (this.*) {
            .normal, .@"small-caps" => true,
            else => false,
        };
    }

    pub fn parseCss2(input: *css.Parser) css.Result(FontVariantCaps) {
        const value = switch (FontVariantCaps.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        if (!value.isCss2()) {
            return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
        }
        return .{ .result = value };
    }

    pub fn isCompatible(_: *const FontVariantCaps, _: bun.css.targets.Browsers) bool {
        return true;
    }
};

/// A value for the [line-height](https://www.w3.org/TR/2020/WD-css-inline-3-20200827/#propdef-line-height) property.
pub const LineHeight = union(enum) {
    /// The UA sets the line height based on the font.
    normal,
    /// A multiple of the element's font size.
    number: CSSNumber,
    /// An explicit height.
    length: LengthPercentage,

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub fn isCompatible(this: *const LineHeight, browsers: bun.css.targets.Browsers) bool {
        return switch (this.*) {
            .length => |*l| l.isCompatible(browsers),
            .normal, .number => true,
        };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn default() LineHeight {
        return .normal;
    }
};

/// A value for the [font](https://www.w3.org/TR/css-fonts-4/#font-prop) shorthand property.
pub const Font = struct {
    /// The font family.
    family: bun.BabyList(FontFamily),
    /// The font size.
    size: FontSize,
    /// The font style.
    style: FontStyle,
    /// The font weight.
    weight: FontWeight,
    /// The font stretch.
    stretch: FontStretch,
    /// The line height.
    line_height: LineHeight,
    /// How the text should be capitalized. Only CSS 2.1 values are supported.
    variant_caps: FontVariantCaps,

    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.font, PropertyFieldMap);

    pub const PropertyFieldMap = .{
        .family = css.PropertyIdTag.@"font-family",
        .size = css.PropertyIdTag.@"font-size",
        .style = css.PropertyIdTag.@"font-style",
        .weight = css.PropertyIdTag.@"font-weight",
        .stretch = css.PropertyIdTag.@"font-stretch",
        .line_height = css.PropertyIdTag.@"line-height",
        .variant_caps = css.PropertyIdTag.@"font-variant-caps",
    };

    pub fn parse(input: *css.Parser) css.Result(Font) {
        var style: ?FontStyle = null;
        var weight: ?FontWeight = null;
        var stretch: ?FontStretch = null;
        var size: ?FontSize = null;
        var variant_caps: ?FontVariantCaps = null;
        var count: i32 = 0;

        while (true) {
            // Skip "normal" since it is valid for several properties, but we don't know which ones it will be used for yet.
            if (input.tryParse(css.Parser.expectIdentMatching, .{"normal"}).isOk()) {
                count += 1;
                continue;
            }

            if (style == null) {
                if (input.tryParse(FontStyle.parse, .{}).asValue()) |value| {
                    style = value;
                    count += 1;
                    continue;
                }
            }

            if (weight == null) {
                if (input.tryParse(FontWeight.parse, .{}).asValue()) |value| {
                    weight = value;
                    count += 1;
                    continue;
                }
            }

            if (variant_caps != null) {
                if (input.tryParse(FontVariantCaps.parseCss2, .{}).asValue()) |value| {
                    variant_caps = value;
                    count += 1;
                    continue;
                }
            }

            if (stretch == null) {
                if (input.tryParse(FontStretchKeyword.parse, .{}).asValue()) |value| {
                    stretch = .{ .keyword = value };
                    count += 1;
                    continue;
                }
            }

            size = switch (@call(.auto, @field(FontSize, "parse"), .{input})) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };
            break;
        }

        if (count > 4) return .{ .err = input.newCustomError(css.ParserError.invalid_declaration) };

        const final_size = size orelse return .{ .err = input.newCustomError(css.ParserError.invalid_declaration) };

        const line_height = if (input.tryParse(css.Parser.expectDelim, .{'/'}).isOk()) switch (LineHeight.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        } else null;

        const family = switch (bun.BabyList(FontFamily).parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        return .{ .result = Font{
            .family = family,
            .size = final_size,
            .style = style orelse FontStyle.default(),
            .weight = weight orelse FontWeight.default(),
            .stretch = stretch orelse FontStretch.default(),
            .line_height = line_height orelse LineHeight.default(),
            .variant_caps = variant_caps orelse FontVariantCaps.default(),
        } };
    }

    pub fn toCss(this: *const Font, dest: *Printer) PrintErr!void {
        if (!this.style.eql(&FontStyle.default())) {
            try this.style.toCss(dest);
            try dest.writeChar(' ');
        }

        if (!this.variant_caps.eql(&FontVariantCaps.default())) {
            try this.variant_caps.toCss(dest);
            try dest.writeChar(' ');
        }

        if (!this.weight.eql(&FontWeight.default())) {
            try this.weight.toCss(dest);
            try dest.writeChar(' ');
        }

        if (!this.stretch.eql(&FontStretch.default())) {
            try this.stretch.toCss(dest);
            try dest.writeChar(' ');
        }

        try this.size.toCss(dest);

        if (!this.line_height.eql(&LineHeight.default())) {
            try dest.delim('/', true);
            try this.line_height.toCss(dest);
        }

        try dest.writeChar(' ');

        const len = this.family.len;
        for (this.family.sliceConst(), 0..) |*val, idx| {
            try val.toCss(dest);
            if (idx < len - 1) {
                try dest.delim(',', false);
            }
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [vertical align](https://drafts.csswg.org/css2/#propdef-vertical-align) property.
// TODO: there is a more extensive spec in CSS3 but it doesn't seem any browser implements it? https://www.w3.org/TR/css-inline-3/#transverse-alignment
pub const VerticalAlign = union(enum) {
    /// A vertical align keyword.
    keyword: VerticalAlignKeyword,
    /// An explicit length.
    length: LengthPercentage,
};

/// A keyword for the [vertical align](https://drafts.csswg.org/css2/#propdef-vertical-align) property.
pub const VerticalAlignKeyword = enum {
    /// Align the baseline of the box with the baseline of the parent box.
    baseline,
    /// Lower the baseline of the box to the proper position for subscripts of the parent’s box.
    sub,
    /// Raise the baseline of the box to the proper position for superscripts of the parent’s box.
    super,
    /// Align the top of the aligned subtree with the top of the line box.
    top,
    /// Align the top of the box with the top of the parent’s content area.
    @"text-top",
    /// Align the vertical midpoint of the box with the baseline of the parent box plus half the x-height of the parent.
    middle,
    /// Align the bottom of the aligned subtree with the bottom of the line box.
    bottom,
    /// Align the bottom of the box with the bottom of the parent’s content area.
    @"text-bottom",

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
};

pub const FontProperty = packed struct(u8) {
    @"font-family": bool = false,
    @"font-size": bool = false,
    @"font-style": bool = false,
    @"font-weight": bool = false,
    @"font-stretch": bool = false,
    @"line-height": bool = false,
    @"font-variant-caps": bool = false,
    __unused: u1 = 0,

    const FONT = FontProperty{
        .@"font-family" = true,
        .@"font-size" = true,
        .@"font-style" = true,
        .@"font-weight" = true,
        .@"font-stretch" = true,
        .@"line-height" = true,
        .@"font-variant-caps" = true,
    };

    pub fn tryFromPropertyId(property_id: css.PropertyIdTag) ?FontProperty {
        inline for (std.meta.fields(FontProperty)) |field| {
            if (comptime std.mem.eql(u8, field.name, "__unused")) continue;
            const desired = comptime @field(css.PropertyIdTag, field.name);
            if (desired == property_id) {
                var result: FontProperty = .{};
                @field(result, field.name) = true;
                return result;
            }
        }
        if (property_id == .font) {
            return FontProperty.FONT;
        }
        return null;
    }
};

pub const FontHandler = struct {
    family: ?bun.BabyList(FontFamily) = null,
    size: ?FontSize = null,
    style: ?FontStyle = null,
    weight: ?FontWeight = null,
    stretch: ?FontStretch = null,
    line_height: ?LineHeight = null,
    variant_caps: ?FontVariantCaps = null,
    flushed_properties: FontProperty = .{},
    has_any: bool = false,

    pub fn handleProperty(
        this: *FontHandler,
        property: *const css.Property,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) bool {
        switch (property.*) {
            .@"font-family" => |*val| this.propertyHelper(dest, context, "family", val),
            .@"font-size" => |*val| this.propertyHelper(dest, context, "size", val),
            .@"font-style" => |*val| this.propertyHelper(dest, context, "style", val),
            .@"font-weight" => |*val| this.propertyHelper(dest, context, "weight", val),
            .@"font-stretch" => |*val| this.propertyHelper(dest, context, "stretch", val),
            .@"font-variant-caps" => |*val| this.propertyHelper(dest, context, "variant_caps", val),
            .@"line-height" => |*val| this.propertyHelper(dest, context, "line_height", val),
            .font => |*val| {
                this.flushHelper(dest, context, "family", &val.family);
                this.flushHelper(dest, context, "size", &val.size);
                this.flushHelper(dest, context, "style", &val.style);
                this.flushHelper(dest, context, "weight", &val.weight);
                this.flushHelper(dest, context, "stretch", &val.stretch);
                this.flushHelper(dest, context, "line_height", &val.line_height);
                this.flushHelper(dest, context, "variant_caps", &val.variant_caps);

                this.family = css.generic.deepClone(bun.BabyList(FontFamily), &val.family, context.allocator);
                this.size = val.size.deepClone(context.allocator);
                this.style = val.style.deepClone(context.allocator);
                this.weight = val.weight.deepClone(context.allocator);
                this.stretch = val.stretch.deepClone(context.allocator);
                this.line_height = val.line_height.deepClone(context.allocator);
                this.variant_caps = val.variant_caps.deepClone(context.allocator);
                this.has_any = true;
                // TODO: reset other properties
            },
            .unparsed => |*val| {
                if (isFontProperty(val.property_id)) {
                    this.flush(dest, context);
                    bun.bits.insert(FontProperty, &this.flushed_properties, FontProperty.tryFromPropertyId(val.property_id).?);
                    bun.handleOom(dest.append(context.allocator, property.*));
                } else {
                    return false;
                }
            },
            else => return false,
        }

        return true;
    }

    inline fn propertyHelper(this: *FontHandler, dest: *css.DeclarationList, context: *css.PropertyHandlerContext, comptime prop: []const u8, val: anytype) void {
        this.flushHelper(dest, context, prop, val);
        @field(this, prop) = css.generic.deepClone(@TypeOf(val.*), val, context.allocator);
        this.has_any = true;
    }

    inline fn flushHelper(
        this: *FontHandler,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
        comptime prop: []const u8,
        val: anytype,
    ) void {
        if (@field(this, prop) != null and
            !css.generic.eql(@TypeOf(@field(this, prop).?), &@field(this, prop).?, val) and
            context.targets.browsers != null and
            !css.generic.isCompatible(@TypeOf(@field(this, prop).?), val, context.targets.browsers.?))
        {
            this.flush(dest, context);
        }
    }

    pub fn finalize(this: *FontHandler, decls: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        this.flush(decls, context);
        this.flushed_properties = .{};
    }

    fn push(self: *FontHandler, d: *css.DeclarationList, ctx: *css.PropertyHandlerContext, comptime prop: []const u8, val: anytype) void {
        bun.handleOom(d.append(ctx.allocator, @unionInit(css.Property, prop, val)));
        var insertion: FontProperty = .{};
        if (comptime std.mem.eql(u8, prop, "font")) {
            insertion = FontProperty.FONT;
        } else {
            @field(insertion, prop) = true;
        }
        bun.bits.insert(FontProperty, &self.flushed_properties, insertion);
    }

    fn flush(this: *FontHandler, decls: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (!this.has_any) {
            return;
        }

        this.has_any = false;

        var family: ?bun.BabyList(FontFamily) = bun.take(&this.family);
        if (!this.flushed_properties.@"font-family") {
            family = compatibleFontFamily(context.allocator, family, !context.targets.shouldCompileSame(.font_family_system_ui));
        }

        const size: ?FontSize = bun.take(&this.size);
        const style: ?FontStyle = bun.take(&this.style);
        const weight: ?FontWeight = bun.take(&this.weight);
        const stretch: ?FontStretch = bun.take(&this.stretch);
        const line_height: ?LineHeight = bun.take(&this.line_height);
        const variant_caps: ?FontVariantCaps = bun.take(&this.variant_caps);

        if (family) |*f| {
            if (f.len > 1) {
                // Dedupe
                var sfb = std.heap.stackFallback(664, bun.default_allocator);
                const alloc = sfb.get();
                var seen = FontFamily.HashMap(void){};
                defer seen.deinit(alloc);

                var i: usize = 0;
                while (i < f.len) {
                    const gop = bun.handleOom(seen.getOrPut(alloc, f.at(i).*));
                    if (gop.found_existing) {
                        _ = f.orderedRemove(i);
                    } else {
                        i += 1;
                    }
                }
            }
        }

        if (family != null and size != null and style != null and weight != null and stretch != null and line_height != null and variant_caps != null) {
            const caps = variant_caps.?;
            push(this, decls, context, "font", Font{
                .family = family.?,
                .size = size.?,
                .style = style.?,
                .weight = weight.?,
                .stretch = stretch.?,
                .line_height = line_height.?,
                .variant_caps = if (caps.isCss2()) caps else FontVariantCaps.default(),
            });

            // The `font` property only accepts CSS 2.1 values for font-variant caps.
            // If we have a CSS 3+ value, we need to add a separate property.
            if (!caps.isCss2()) {
                push(this, decls, context, "font-variant-caps", caps);
            }
        } else {
            if (family) |val| {
                push(this, decls, context, "font-family", val);
            }

            if (size) |val| {
                push(this, decls, context, "font-size", val);
            }

            if (style) |val| {
                push(this, decls, context, "font-style", val);
            }

            if (variant_caps) |val| {
                push(this, decls, context, "font-variant-caps", val);
            }

            if (weight) |val| {
                push(this, decls, context, "font-weight", val);
            }

            if (stretch) |val| {
                push(this, decls, context, "font-stretch", val);
            }

            if (line_height) |val| {
                push(this, decls, context, "line-height", val);
            }
        }
    }
};

const SYSTEM_UI: FontFamily = FontFamily{ .generic = .@"system-ui" };

const DEFAULT_SYSTEM_FONTS: []const []const u8 = &.{
    // #1: Supported as the '-apple-system' value (macOS, Safari >= 9.2 < 11, Firefox >= 43)
    "-apple-system",
    // #2: Supported as the 'BlinkMacSystemFont' value (macOS, Chrome < 56)
    "BlinkMacSystemFont",
    "Segoe UI", // Windows >= Vista
    "Roboto", // Android >= 4
    "Noto Sans", // Plasma >= 5.5
    "Ubuntu", // Ubuntu >= 10.10
    "Cantarell", // GNOME >= 3
    "Helvetica Neue",
};

inline fn compatibleFontFamily(allocator: std.mem.Allocator, _family: ?bun.BabyList(FontFamily), is_supported: bool) ?bun.BabyList(FontFamily) {
    var family = _family;
    if (is_supported) {
        return family;
    }

    if (family) |*families| {
        for (families.sliceConst(), 0..) |v, i| {
            if (v.eql(&SYSTEM_UI)) {
                for (DEFAULT_SYSTEM_FONTS, 0..) |name, j| {
                    bun.handleOom(families.insert(allocator, i + j + 1, .{ .family_name = name }));
                }
                break;
            }
        }
    }

    return family;
}

inline fn isFontProperty(property_id: css.PropertyId) bool {
    return switch (property_id) {
        .@"font-family",
        .@"font-size",
        .@"font-style",
        .@"font-weight",
        .@"font-stretch",
        .@"font-variant-caps",
        .@"line-height",
        .font,
        => true,
        else => false,
    };
}

const bun = @import("bun");

const std = @import("std");
const ArrayList = std.ArrayListUnmanaged;
const Allocator = std.mem.Allocator;
