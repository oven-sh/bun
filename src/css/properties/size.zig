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

pub const BoxSizing = enum {
    /// Exclude the margin/border/padding from the width and height.
    @"content-box",
    /// Include the padding and border (but not the margin) in the width and height.
    @"border-box",
    pub usingnamespace css.DefineEnumProperty(@This());
};

pub const Size = union(enum) {
    /// The `auto` keyworda
    auto,
    /// An explicit length or percentage.
    length_percentage: LengthPercentage,
    /// The `min-content` keyword.
    min_content: css.VendorPrefix,
    /// The `max-content` keyword.
    max_content: css.VendorPrefix,
    /// The `fit-content` keyword.
    fit_content: css.VendorPrefix,
    /// The `fit-content()` function.
    fit_content_function: LengthPercentage,
    /// The `stretch` keyword, or the `-webkit-fill-available` or `-moz-available` prefixed keywords.
    stretch: css.VendorPrefix,
    /// The `contain` keyword.
    contain,
};

/// A value for the [minimum](https://drafts.csswg.org/css-sizing-3/#min-size-properties)
/// and [maximum](https://drafts.csswg.org/css-sizing-3/#max-size-properties) size properties,
/// e.g. `min-width` and `max-height`.
pub const MaxSize = union(enum) {
    /// The `none` keyword.
    none,
    /// An explicit length or percentage.
    length_percentage: LengthPercentage,
    /// The `min-content` keyword.
    min_content: css.VendorPrefix,
    /// The `max-content` keyword.
    max_content: css.VendorPrefix,
    /// The `fit-content` keyword.
    fit_content: css.VendorPrefix,
    /// The `fit-content()` function.
    fit_content_function: LengthPercentage,
    /// The `stretch` keyword, or the `-webkit-fill-available` or `-moz-available` prefixed keywords.
    stretch: css.VendorPrefix,
    /// The `contain` keyword.
    contain,
};

/// A value for the [aspect-ratio](https://drafts.csswg.org/css-sizing-4/#aspect-ratio) property.
pub const AspectRatio = struct {
    /// The `auto` keyword.
    auto: bool,
    /// A preferred aspect ratio for the box, specified as width / height.
    ratio: ?Ratio,

    pub fn parse(input: *css.Parser) css.Result(AspectRatio) {
        const location = input.currentSourceLocation();
        var auto = input.tryParse(css.Parser.expectIdentMatching, .{"auto"});

        const ratio = input.tryParse(Ratio.parse, .{});
        if (auto.isErr()) {
            auto = input.tryParse(css.Parser.expectIdentMatching, .{"auto"});
        }
        if (auto.isErr() and ratio.isErr()) {
            return .{ .err = location.newCustomError(css.ParserError.invalid_value) };
        }

        return .{
            .result = AspectRatio{
                .auto = auto.isOk(),
                .ratio = ratio.asValue(),
            },
        };
    }

    pub fn toCss(this: *const AspectRatio, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        if (this.auto) {
            try dest.writeStr("auto");
        }

        if (this.ratio) |*ratio| {
            if (this.auto) try dest.writeChar(' ');
            try ratio.toCss(W, dest);
        }
    }
};
