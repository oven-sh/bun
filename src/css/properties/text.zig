pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;

const LengthPercentage = css.css_values.length.LengthPercentage;
const CssColor = css.css_values.color.CssColor;
const Length = css.css_values.length.LengthValue;
const Percentage = css.css_values.percentage.Percentage;

/// A value for the [text-transform](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-transform-property) property.
pub const TextTransform = struct {
    /// How case should be transformed.
    case: TextTransformCase,
    /// How ideographic characters should be transformed.
    other: TextTransformOther,
};

pub const TextTransformOther = packed struct(u8) {
    /// Puts all typographic character units in full-width form.
    full_width: bool = false,
    /// Converts all small Kana characters to the equivalent full-size Kana.
    full_size_kana: bool = false,
};

/// Defines how text case should be transformed in the
/// [text-transform](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-transform-property) property.
const TextTransformCase = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [white-space](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#white-space-property) property.
pub const WhiteSpace = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [word-break](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#word-break-property) property.
pub const WordBreak = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [line-break](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#line-break-property) property.
pub const LineBreak = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [hyphens](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#hyphenation) property.
pub const Hyphens = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [overflow-wrap](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#overflow-wrap-property) property.
pub const OverflowWrap = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [text-align](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-align-property) property.
pub const TextAlign = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [text-align-last](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-align-last-property) property.
pub const TextAlignLast = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [text-justify](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-justify-property) property.
pub const TextJustify = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [word-spacing](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#word-spacing-property)
/// and [letter-spacing](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#letter-spacing-property) properties.
pub const Spacing = union(enum) {
    /// No additional spacing is applied.
    normal,
    /// Additional spacing between each word or letter.
    length: Length,
};

/// A value for the [text-indent](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-indent-property) property.
pub const TextIndent = struct {
    /// The amount to indent.
    value: LengthPercentage,
    /// Inverts which lines are affected.
    hanging: bool,
    /// Affects the first line after each hard break.
    each_line: bool,
};

/// A value for the [text-decoration-line](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-line-property) property.
///
/// Multiple lines may be specified by combining the flags.
pub const TextDecorationLine = packed struct(u8) {
    /// Each line of text is underlined.
    underline: bool = false,
    /// Each line of text has a line over it.
    overline: bool = false,
    /// Each line of text has a line through the middle.
    line_through: bool = false,
    /// The text blinks.
    blink: bool = false,
    /// The text is decorated as a spelling error.
    spelling_error: bool = false,
    /// The text is decorated as a grammar error.
    grammar_error: bool = false,
};

/// A value for the [text-decoration-style](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-style-property) property.
pub const TextDecorationStyle = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [text-decoration-thickness](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-width-property) property.
pub const TextDecorationThickness = union(enum) {
    /// The UA chooses an appropriate thickness for text decoration lines.
    auto,
    /// Use the thickness defined in the current font.
    from_font,
    /// An explicit length.
    length_percentage: LengthPercentage,
};

/// A value for the [text-decoration](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-property) shorthand property.
pub const TextDecoration = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [text-decoration-skip-ink](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-skip-ink-property) property.
pub const TextDecorationSkipInk = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A text emphasis shape for the [text-emphasis-style](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-style-property) property.
///
/// See [TextEmphasisStyle](TextEmphasisStyle).
pub const TextEmphasisStyle = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [text-emphasis](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-property) shorthand property.
pub const TextEmphasis = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
pub const TextEmphasisPosition = struct {
    /// The vertical position.
    vertical: TextEmphasisPositionVertical,
    /// The horizontal position.
    horizontal: TextEmphasisPositionHorizontal,
};

/// A vertical position keyword for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
///
/// See [TextEmphasisPosition](TextEmphasisPosition).
pub const TextEmphasisPositionVertical = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A horizontal position keyword for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
///
/// See [TextEmphasisPosition](TextEmphasisPosition).
pub const TextEmphasisPositionHorizontal = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [text-shadow](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-shadow-property) property.
pub const TextShadow = struct {
    /// The color of the text shadow.
    color: CssColor,
    /// The x offset of the text shadow.
    x_offset: Length,
    /// The y offset of the text shadow.
    y_offset: Length,
    /// The blur radius of the text shadow.
    blur: Length,
    /// The spread distance of the text shadow.
    spread: Length, // added in Level 4 spec

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        var color: ?CssColor = null;
        const Lengths = struct { Length, Length, Length, Length };
        var lengths: ?Lengths = null;

        while (true) {
            if (lengths == null) {
                const value = input.tryParse(struct {
                    pub fn parseFn(i: *css.Parser) css.Result(Lengths) {
                        const horizontal = switch (Length.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        const vertical = switch (Length.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        const blur = i.tryParse(Length.parse, .{}).asValue() orelse Length.zero();
                        const spread = i.tryParse(Length.parse, .{}).asValue() orelse Length.zero();
                        return .{ .result = .{ horizontal, vertical, blur, spread } };
                    }
                }.parseFn, .{});

                if (value.asValue()) |v| {
                    lengths = v;
                    continue;
                }
            }

            if (color == null) {
                if (input.tryParse(CssColor.parse, .{}).asValue()) |value| {
                    color = value;
                    continue;
                }
            }

            break;
        }

        const l = lengths orelse return .{ .err = input.newError(.qualified_rule_invalid) };
        return .{
            .result = .{
                .color = color orelse CssColor.current_color,
                .x_offset = l[0],
                .y_offset = l[1],
                .blur = l[2],
                .spread = l[3],
            },
        };
    }

    pub fn toCss(this: *const @This(), dest: *css.Printer) css.PrintErr!void {
        try this.x_offset.toCss(dest);
        try dest.writeChar(' ');
        try this.y_offset.toCss(dest);

        if (!this.blur.eql(&Length.zero()) or !this.spread.eql(&Length.zero())) {
            try dest.writeChar(' ');
            try this.blur.toCss(dest);

            if (!this.spread.eql(&Length.zero())) {
                try dest.writeChar(' ');
                try this.spread.toCss(dest);
            }
        }

        if (!this.color.eql(&CssColor{ .current_color = {} })) {
            try dest.writeChar(' ');
            try this.color.toCss(dest);
        }

        return;
    }

    pub fn isCompatible(this: *const @This(), browsers: css.targets.Browsers) bool {
        return this.color.isCompatible(browsers) and
            this.x_offset.isCompatible(browsers) and
            this.y_offset.isCompatible(browsers) and
            this.blur.isCompatible(browsers) and
            this.spread.isCompatible(browsers);
    }

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return css.implementEql(@This(), this, other);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [text-size-adjust](https://w3c.github.io/csswg-drafts/css-size-adjust/#adjustment-control) property.
pub const TextSizeAdjust = union(enum) {
    /// Use the default size adjustment when displaying on a small device.
    auto,
    /// No size adjustment when displaying on a small device.
    none,
    /// When displaying on a small device, the font size is multiplied by this percentage.
    percentage: Percentage,
};

/// A value for the [direction](https://drafts.csswg.org/css-writing-modes-3/#direction) property.
pub const Direction = enum {
    /// This value sets inline base direction (bidi directionality) to line-left-to-line-right.
    ltr,
    /// This value sets inline base direction (bidi directionality) to line-right-to-line-left.
    rtl,

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
};

/// A value for the [unicode-bidi](https://drafts.csswg.org/css-writing-modes-3/#unicode-bidi) property.
pub const UnicodeBidi = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [box-decoration-break](https://www.w3.org/TR/css-break-3/#break-decoration) property.
pub const BoxDecorationBreak = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

const std = @import("std");
const Allocator = std.mem.Allocator;
