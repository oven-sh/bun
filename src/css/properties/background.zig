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

/// A value for the [background](https://www.w3.org/TR/css-backgrounds-3/#background) shorthand property.
pub const Background = struct {
    /// The background image.
    image: Image,
    /// The background color.
    color: CssColor,
    /// The background position.
    position: BackgroundPosition,
    /// How the background image should repeat.
    repeat: BackgroundRepeat,
    /// The size of the background image.
    size: BackgroundSize,
    /// The background attachment.
    attachment: BackgroundAttachment,
    /// The background origin.
    origin: BackgroundOrigin,
    /// How the background should be clipped.
    clip: BackgroundClip,
};

/// A value for the [background-size](https://www.w3.org/TR/css-backgrounds-3/#background-size) property.
pub const BackgroundSize = union(enum) {
    /// An explicit background size.
    explicit: struct {
        /// The width of the background.
        width: css.css_values.length.LengthPercentage,
        /// The height of the background.
        height: css.css_values.length.LengthPercentageOrAuto,
    },
    /// The `cover` keyword. Scales the background image to cover both the width and height of the element.
    cover,
    /// The `contain` keyword. Scales the background image so that it fits within the element.
    contain,
};

/// A value for the [background-position](https://drafts.csswg.org/css-backgrounds/#background-position) shorthand property.
pub const BackgroundPosition = css.DefineListShorthand(struct {
    comptime {
        @compileError(css.todo_stuff.depth);
    }
});

/// A value for the [background-repeat](https://www.w3.org/TR/css-backgrounds-3/#background-repeat) property.
pub const BackgroundRepeat = struct {
    /// A repeat style for the x direction.
    x: BackgroundRepeatKeyword,
    /// A repeat style for the y direction.
    y: BackgroundRepeatKeyword,
};

/// A [`<repeat-style>`](https://www.w3.org/TR/css-backgrounds-3/#typedef-repeat-style) value,
/// used within the `background-repeat` property to represent how a background image is repeated
/// in a single direction.
///
/// See [BackgroundRepeat](BackgroundRepeat).
pub const BackgroundRepeatKeyword = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [background-attachment](https://www.w3.org/TR/css-backgrounds-3/#background-attachment) property.
pub const BackgroundAttachment = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [background-origin](https://www.w3.org/TR/css-backgrounds-3/#background-origin) property.
pub const BackgroundOrigin = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [background-clip](https://drafts.csswg.org/css-backgrounds-4/#background-clip) property.
pub const BackgroundClip = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

pub const BoxSizing = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [aspect-ratio](https://drafts.csswg.org/css-sizing-4/#aspect-ratio) property.
pub const AspectRatio = struct {
    /// The `auto` keyword.
    auto: bool,
    /// A preferred aspect ratio for the box, specified as width / height.
    ratio: ?Ratio,
};
