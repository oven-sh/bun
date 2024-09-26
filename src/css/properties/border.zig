const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

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

/// A value for the [border-top](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-top) shorthand property.
pub const BorderTop = GenericBorder(LineStyle, 0);
/// A value for the [border-right](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-right) shorthand property.
pub const BorderRight = GenericBorder(LineStyle, 1);
/// A value for the [border-bottom](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-bottom) shorthand property.
pub const BorderBottom = GenericBorder(LineStyle, 2);
/// A value for the [border-left](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-left) shorthand property.
pub const BorderLeft = GenericBorder(LineStyle, 3);
/// A value for the [border-block-start](https://drafts.csswg.org/css-logical/#propdef-border-block-start) shorthand property.
pub const BorderBlockStart = GenericBorder(LineStyle, 4);
/// A value for the [border-block-end](https://drafts.csswg.org/css-logical/#propdef-border-block-end) shorthand property.
pub const BorderBlockEnd = GenericBorder(LineStyle, 5);
/// A value for the [border-inline-start](https://drafts.csswg.org/css-logical/#propdef-border-inline-start) shorthand property.
pub const BorderInlineStart = GenericBorder(LineStyle, 6);
/// A value for the [border-inline-end](https://drafts.csswg.org/css-logical/#propdef-border-inline-end) shorthand property.
pub const BorderInlineEnd = GenericBorder(LineStyle, 7);
/// A value for the [border-block](https://drafts.csswg.org/css-logical/#propdef-border-block) shorthand property.
pub const BorderBlock = GenericBorder(LineStyle, 8);
/// A value for the [border-inline](https://drafts.csswg.org/css-logical/#propdef-border-inline) shorthand property.
pub const BorderInline = GenericBorder(LineStyle, 9);
/// A value for the [border](https://www.w3.org/TR/css-backgrounds-3/#propdef-border) shorthand property.
pub const Border = GenericBorder(LineStyle, 10);

/// A generic type that represents the `border` and `outline` shorthand properties.
pub fn GenericBorder(comptime S: type, comptime P: u8) type {
    _ = P; // autofix
    return struct {
        /// The width of the border.
        width: BorderSideWidth,
        /// The border style.
        style: S,
        /// The border color.
        color: CssColor,
    };
}
/// A [`<line-style>`](https://drafts.csswg.org/css-backgrounds/#typedef-line-style) value, used in the `border-style` property.
/// A [`<line-style>`](https://drafts.csswg.org/css-backgrounds/#typedef-line-style) value, used in the `border-style` property.
pub const LineStyle = enum {
    /// No border.
    none,
    /// Similar to `none` but with different rules for tables.
    hidden,
    /// Looks as if the content on the inside of the border is sunken into the canvas.
    inset,
    /// Looks as if it were carved in the canvas.
    groove,
    /// Looks as if the content on the inside of the border is coming out of the canvas.
    outset,
    /// Looks as if it were coming out of the canvas.
    ridge,
    /// A series of round dots.
    dotted,
    /// A series of square-ended dashes.
    dashed,
    /// A single line segment.
    solid,
    /// Two parallel solid lines with some space between them.
    double,

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the [border-width](https://www.w3.org/TR/css-backgrounds-3/#border-width) property.
pub const BorderSideWidth = union(enum) {
    /// A UA defined `thin` value.
    thin,
    /// A UA defined `medium` value.
    medium,
    /// A UA defined `thick` value.
    thick,
    /// An explicit width.
    length: Length,
};

/// A value for the [border-color](https://drafts.csswg.org/css-backgrounds/#propdef-border-color) shorthand property.
pub const BorderColor = struct {
    top: CssColor,
    right: CssColor,
    bottom: CssColor,
    left: CssColor,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"border-color");
    pub usingnamespace css.DefineRectShorthand(@This(), CssColor);

    pub const PropertyFieldMap = .{
        .top = css.PropertyIdTag.@"border-top-color",
        .right = css.PropertyIdTag.@"border-right-color",
        .bottom = css.PropertyIdTag.@"border-bottom-color",
        .left = css.PropertyIdTag.@"border-left-color",
    };
};

/// A value for the [border-style](https://drafts.csswg.org/css-backgrounds/#propdef-border-style) shorthand property.
pub const BorderStyle = struct {
    top: LineStyle,
    right: LineStyle,
    bottom: LineStyle,
    left: LineStyle,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"border-style");
    pub usingnamespace css.DefineRectShorthand(@This(), LineStyle);

    pub const PropertyFieldMap = .{
        .top = css.PropertyIdTag.@"border-top-style",
        .right = css.PropertyIdTag.@"border-right-style",
        .bottom = css.PropertyIdTag.@"border-bottom-style",
        .left = css.PropertyIdTag.@"border-left-style",
    };
};

/// A value for the [border-width](https://drafts.csswg.org/css-backgrounds/#propdef-border-width) shorthand property.
pub const BorderWidth = struct {
    top: BorderSideWidth,
    right: BorderSideWidth,
    bottom: BorderSideWidth,
    left: BorderSideWidth,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"border-width");
    pub usingnamespace css.DefineRectShorthand(@This(), BorderSideWidth);

    pub const PropertyFieldMap = .{
        .top = css.PropertyIdTag.@"border-top-width",
        .right = css.PropertyIdTag.@"border-right-width",
        .bottom = css.PropertyIdTag.@"border-bottom-width",
        .left = css.PropertyIdTag.@"border-left-width",
    };
};

/// A value for the [border-block-color](https://drafts.csswg.org/css-logical/#propdef-border-block-color) shorthand property.
pub const BorderBlockColor = struct {
    /// The block start value.
    start: CssColor,
    /// The block end value.
    end: CssColor,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"border-block-color");
    pub usingnamespace css.DefineSizeShorthand(@This(), CssColor);

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-block-start-color",
        .end = css.PropertyIdTag.@"border-block-end-color",
    };
};

/// A value for the [border-block-style](https://drafts.csswg.org/css-logical/#propdef-border-block-style) shorthand property.
pub const BorderBlockStyle = struct {
    /// The block start value.
    start: LineStyle,
    /// The block end value.
    end: LineStyle,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"border-block-style");
    pub usingnamespace css.DefineSizeShorthand(@This(), LineStyle);

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-block-start-style",
        .end = css.PropertyIdTag.@"border-block-end-style",
    };
};

/// A value for the [border-block-width](https://drafts.csswg.org/css-logical/#propdef-border-block-width) shorthand property.
pub const BorderBlockWidth = struct {
    /// The block start value.
    start: BorderSideWidth,
    /// The block end value.
    end: BorderSideWidth,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"border-block-width");
    pub usingnamespace css.DefineSizeShorthand(@This(), BorderSideWidth);

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-block-start-width",
        .end = css.PropertyIdTag.@"border-block-end-width",
    };
};

/// A value for the [border-inline-color](https://drafts.csswg.org/css-logical/#propdef-border-inline-color) shorthand property.
pub const BorderInlineColor = struct {
    /// The inline start value.
    start: CssColor,
    /// The inline end value.
    end: CssColor,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"border-inline-color");
    pub usingnamespace css.DefineSizeShorthand(@This(), CssColor);

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-inline-start-color",
        .end = css.PropertyIdTag.@"border-inline-end-color",
    };
};

/// A value for the [border-inline-style](https://drafts.csswg.org/css-logical/#propdef-border-inline-style) shorthand property.
pub const BorderInlineStyle = struct {
    /// The inline start value.
    start: LineStyle,
    /// The inline end value.
    end: LineStyle,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"border-inline-style");
    pub usingnamespace css.DefineSizeShorthand(@This(), LineStyle);

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-inline-start-style",
        .end = css.PropertyIdTag.@"border-inline-end-style",
    };
};

/// A value for the [border-inline-width](https://drafts.csswg.org/css-logical/#propdef-border-inline-width) shorthand property.
pub const BorderInlineWidth = struct {
    /// The inline start value.
    start: BorderSideWidth,
    /// The inline end value.
    end: BorderSideWidth,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"border-inline-width");
    pub usingnamespace css.DefineSizeShorthand(@This(), BorderSideWidth);

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-inline-start-width",
        .end = css.PropertyIdTag.@"border-inline-end-width",
    };
};
