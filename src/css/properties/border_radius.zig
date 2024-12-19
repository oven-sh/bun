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

/// A value for the [border-radius](https://www.w3.org/TR/css-backgrounds-3/#border-radius) property.
pub const BorderRadius = struct {
    /// The x and y radius values for the top left corner.
    top_left: Size2D(LengthPercentage),
    /// The x and y radius values for the top right corner.
    top_right: Size2D(LengthPercentage),
    /// The x and y radius values for the bottom right corner.
    bottom_right: Size2D(LengthPercentage),
    /// The x and y radius values for the bottom left corner.
    bottom_left: Size2D(LengthPercentage),

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"border-radius");

    pub const PropertyFieldMap = .{
        .top_left = "border-top-left-radius",
        .top_right = "border-top-right-radius",
        .bottom_right = "border-bottom-right-radius",
        .bottom_left = "border-bottom-left-radius",
    };

    pub const VendorPrefixMap = .{
        .top_left = true,
        .top_right = true,
        .bottom_right = true,
        .bottom_left = true,
    };

    pub fn parse(input: *css.Parser) css.Result(BorderRadius) {
        const widths = switch (Rect(LengthPercentage).parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const heights = if (input.tryParse(css.Parser.expectDelim, .{'/'}).isOk())
            switch (Rect(LengthPercentage).parse(input)) {
                .result => |v| v,
                .err => |e| {
                    widths.deinit(input.allocator());
                    return .{ .err = e };
                },
            }
        else
            widths.deepClone(input.allocator());

        return .{
            .result = BorderRadius{
                .top_left = Size2D(LengthPercentage){ .a = widths.top, .b = heights.top },
                .top_right = Size2D(LengthPercentage){ .a = widths.right, .b = heights.right },
                .bottom_right = Size2D(LengthPercentage){ .a = widths.bottom, .b = heights.bottom },
                .bottom_left = Size2D(LengthPercentage){ .a = widths.left, .b = heights.left },
            },
        };
    }

    pub fn toCss(this: *const BorderRadius, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const widths = Rect(*const LengthPercentage){
            .top = &this.top_left.a,
            .right = &this.top_right.a,
            .bottom = &this.bottom_right.a,
            .left = &this.bottom_left.a,
        };

        const heights = Rect(*const LengthPercentage){
            .top = &this.top_left.b,
            .right = &this.top_right.b,
            .bottom = &this.bottom_right.b,
            .left = &this.bottom_left.b,
        };

        try widths.toCss(W, dest);

        if (!widths.eql(&heights)) {
            try dest.delim('/', true);
            try heights.toCss(W, dest);
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};
