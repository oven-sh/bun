const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Error = css.Error;

const ContainerName = css.css_rules.container.ContainerName;

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

const GenericBorder = css.css_properties.border.GenericBorder;
const LineStyle = css.css_properties.border.LineStyle;

/// A value for the [overflow](https://www.w3.org/TR/css-overflow-3/#overflow-properties) shorthand property.
pub const Overflow = struct {
    /// A value for the [overflow](https://www.w3.org/TR/css-overflow-3/#overflow-properties) shorthand property.
    x: OverflowKeyword,
    /// The overflow mode for the y direction.
    y: OverflowKeyword,

    pub fn parse(input: *css.Parser) css.Result(Overflow) {
        const x = try OverflowKeyword.parse(input);
        const y = switch (input.tryParse(OverflowKeyword.parse, .{})) {
            .result => |v| v,
            else => x,
        };
        return .{ .result = Overflow{ .x = x, .y = y } };
    }

    pub fn toCss(this: *const Overflow, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        try this.x.toCss(W, dest);
        if (this.y != this.x) {
            try dest.writeChar(' ');
            try this.y.toCss(W, dest);
        }
    }
};

/// An [overflow](https://www.w3.org/TR/css-overflow-3/#overflow-properties) keyword
/// as used in the `overflow-x`, `overflow-y`, and `overflow` properties.
pub const OverflowKeyword = enum {
    /// Overflowing content is visible.
    visible,
    /// Overflowing content is hidden. Programmatic scrolling is allowed.
    hidden,
    /// Overflowing content is clipped. Programmatic scrolling is not allowed.
    clip,
    /// The element is scrollable.
    scroll,
    /// Overflowing content scrolls if needed.
    auto,

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the [text-overflow](https://www.w3.org/TR/css-overflow-3/#text-overflow) property.
pub const TextOverflow = enum {
    /// Overflowing text is clipped.
    clip,
    /// Overflowing text is truncated with an ellipsis.
    ellipsis,

    pub usingnamespace css.DefineEnumProperty(@This());
};
