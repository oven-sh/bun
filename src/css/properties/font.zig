const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");
const Error = css.Error;

const ArrayList = std.ArrayListUnmanaged;
const SmallList = css.SmallList;

const Printer = css.Printer;
const PrintErr = css.PrintErr;

const css_values = css.css_values;
const CssColor = css.css_values.color.CssColor;
const Image = css.css_values.image.Image;
const Length = css.css_values.length.LengthValue;
const LengthPercentage = css_values.length.LengthPercentage;
const LengthPercentageOrAuto = css_values.length.LengthPercentageOrAuto;
const PropertyCategory = css.PropertyCategory;
const LogicalGroup = css.LogicalGroup;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const CSSInteger = css.css_values.number.CSSInteger;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;
const Percentage = css.css_values.percentage.Percentage;
const Angle = css.css_values.angle.Angle;
const DashedIdentReference = css.css_values.ident.DashedIdentReference;
const Time = css.css_values.time.Time;
const EasingFunction = css.css_values.easing.EasingFunction;
const CustomIdent = css.css_values.ident.CustomIdent;
const CSSString = css.css_values.string.CSSString;
const DashedIdent = css.css_values.ident.DashedIdent;
const Url = css.css_values.url.Url;
const CustomIdentList = css.css_values.ident.CustomIdentList;
const Location = css.Location;
const HorizontalPosition = css.css_values.position.HorizontalPosition;
const VerticalPosition = css.css_values.position.VerticalPosition;
const ContainerName = css.css_rules.container.ContainerName;

/// A value for the [font-weight](https://www.w3.org/TR/css-fonts-4/#font-weight-prop) property.
pub const FontWeight = union(enum) {
    /// An absolute font weight.
    absolute: AbsoluteFontWeight,
    /// The `bolder` keyword.
    bolder,
    /// The `lighter` keyword.
    lighter,

    // TODO: implement this
    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

    pub inline fn default() FontWeight {
        return .{ .absolute = AbsoluteFontWeight.default() };
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

    pub usingnamespace css.DeriveParse(@This());

    pub fn toCss(this: *const AbsoluteFontWeight, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        return switch (this.*) {
            .weight => |*weight| CSSNumberFns.toCss(weight, W, dest),
            .normal => try dest.writeStr(if (dest.minify) "400" else "normal"),
            .bold => try dest.writeStr(if (dest.minify) "700" else "bold"),
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

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

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

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A [relative font size](https://www.w3.org/TR/css-fonts-3/#relative-size-value),
/// as used in the `font-size` property.
///
/// See [FontSize](FontSize).
pub const RelativeFontSize = enum {
    smaller,
    larger,

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the [font-stretch](https://www.w3.org/TR/css-fonts-4/#font-stretch-prop) property.
pub const FontStretch = union(enum) {
    /// A font stretch keyword.
    keyword: FontStretchKeyword,
    /// A percentage.
    percentage: Percentage,

    // TODO: implement this
    pub usingnamespace css.DeriveParse(@This());

    pub fn toCss(this: *const FontStretch, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        if (dest.minify) {
            const percentage: Percentage = this.intoPercentage();
            return percentage.toCss(W, dest);
        }

        return switch (this.*) {
            .percentage => |*val| val.toCss(W, dest),
            .keyword => |*kw| kw.toCss(W, dest),
        };
    }

    pub fn intoPercentage(this: *const FontStretch) Percentage {
        return switch (this.*) {
            .percentage => |*val| val.*,
            .keyword => |*kw| kw.intoPercentage(),
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

    pub usingnamespace css.DefineEnumProperty(@This());

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
                string.?.appendSlice(stralloc, value) catch bun.outOfMemory();
            }

            if (string) |*s| {
                s.append(stralloc, ' ') catch bun.outOfMemory();
                s.appendSlice(stralloc, ident) catch bun.outOfMemory();
            }
        }

        const final_value = if (string) |s| s.items else value;

        return .{ .result = .{ .family_name = final_value } };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        switch (this.*) {
            .generic => |val| {
                try val.toCss(W, dest);
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
                ).isOk()) {
                    var id = ArrayList(u8){};
                    defer id.deinit(dest.allocator);
                    var first = true;
                    var split_iter = std.mem.splitScalar(u8, val, ' ');
                    while (split_iter.next()) |slice| {
                        if (first) {
                            first = false;
                        } else {
                            id.append(dest.allocator, ' ') catch bun.outOfMemory();
                        }
                        css.serializer.serializeIdentifier(slice, dest) catch return dest.addFmtError();
                    }
                    if (id.items.len < val.len + 2) {
                        return dest.writeStr(id.items);
                    }
                }
                return css.serializer.serializeString(val, dest) catch return dest.addFmtError();
            },
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
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

    pub usingnamespace css.DefineEnumProperty(@This());
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

    pub fn toCss(this: *const FontStyle, comptime W: type, dest: *Printer(W)) PrintErr!void {
        switch (this.*) {
            .normal => try dest.writeStr("normal"),
            .italic => try dest.writeStr("italic"),
            .oblique => |angle| {
                try dest.writeStr("oblique");
                if (angle.eql(&FontStyle.defaultObliqueAngle())) {
                    try dest.writeChar(' ');
                    try angle.toCss(W, dest);
                }
            },
        }
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

    pub usingnamespace css.DefineEnumProperty(@This());

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
};

/// A value for the [line-height](https://www.w3.org/TR/2020/WD-css-inline-3-20200827/#propdef-line-height) property.
pub const LineHeight = union(enum) {
    /// The UA sets the line height based on the font.
    normal,
    /// A multiple of the element's font size.
    number: CSSNumber,
    /// An explicit height.
    length: LengthPercentage,

    pub usingnamespace @call(.auto, css.DeriveParse, .{@This()});
    pub usingnamespace @call(.auto, css.DeriveToCss, .{@This()});

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

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.font);

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

    pub fn toCss(this: *const Font, comptime W: type, dest: *Printer(W)) PrintErr!void {
        if (!this.style.eql(&FontStyle.default())) {
            try this.style.toCss(W, dest);
            try dest.writeChar(' ');
        }

        if (!this.variant_caps.eql(&FontVariantCaps.default())) {
            try this.variant_caps.toCss(W, dest);
            try dest.writeChar(' ');
        }

        if (!this.weight.eql(&FontWeight.default())) {
            try this.weight.toCss(W, dest);
            try dest.writeChar(' ');
        }

        if (!this.stretch.eql(&FontStretch.default())) {
            try this.stretch.toCss(W, dest);
            try dest.writeChar(' ');
        }

        try this.size.toCss(W, dest);

        if (!this.line_height.eql(&LineHeight.default())) {
            try dest.delim('/', true);
            try this.line_height.toCss(W, dest);
        }

        try dest.writeChar(' ');

        const len = this.family.len;
        for (this.family.sliceConst(), 0..) |*val, idx| {
            try val.toCss(W, dest);
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

    pub usingnamespace css.DefineEnumProperty(@This());
};
