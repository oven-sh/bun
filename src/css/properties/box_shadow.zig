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
const Rect = css.css_values.rect.Rect;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;

/// A value for the [box-shadow](https://drafts.csswg.org/css-backgrounds/#box-shadow) property.
pub const BoxShadow = struct {
    /// The color of the box shadow.
    color: CssColor,
    /// The x offset of the shadow.
    x_offset: Length,
    /// The y offset of the shadow.
    y_offset: Length,
    /// The blur radius of the shadow.
    blur: Length,
    /// The spread distance of the shadow.
    spread: Length,
    /// Whether the shadow is inset within the box.
    inset: bool,
};
