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

/// A value for the [border-image](https://www.w3.org/TR/css-backgrounds-3/#border-image) shorthand property.
pub const BorderImage = @compileError(css.todo_stuff.depth);

/// A value for the [border-image-repeat](https://www.w3.org/TR/css-backgrounds-3/#border-image-repeat) property.
const BorderImageRepeat = struct {
    /// The horizontal repeat value.
    horizontal: BorderImageRepeatKeyword,
    /// The vertical repeat value.
    vertical: BorderImageRepeatKeyword,
};

/// A value for the [border-image-width](https://www.w3.org/TR/css-backgrounds-3/#border-image-width) property.
pub const BorderImageSideWidth = union(enum) {
    /// A number representing a multiple of the border width.
    number: CSSNumber,
    /// An explicit length or percentage.
    length_percentage: LengthPercentage,
    /// The `auto` keyword, representing the natural width of the image slice.
    auto: void,
};

const BorderImageRepeatKeyword = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [border-image-slice](https://www.w3.org/TR/css-backgrounds-3/#border-image-slice) property.
const BorderImageSlice = struct {
    /// The offsets from the edges of the image.
    offsets: Rect(NumberOrPercentage),
    /// Whether the middle of the border image should be preserved.
    fill: bool,
};
