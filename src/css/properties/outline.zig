pub const css = @import("../css_parser.zig");

const GenericBorder = css.css_properties.border.GenericBorder;
const LineStyle = css.css_properties.border.LineStyle;

/// A value for the [outline](https://drafts.csswg.org/css-ui/#outline) shorthand property.
pub const Outline = GenericBorder(OutlineStyle, 11);

/// A value for the [outline-style](https://drafts.csswg.org/css-ui/#outline-style) property.
pub const OutlineStyle = union(enum) {
    /// The `auto` keyword.
    auto: void,
    /// A value equivalent to the `border-style` property.
    line_style: LineStyle,

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub fn default() @This() {
        return .{ .line_style = .none };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

const std = @import("std");
const Allocator = std.mem.Allocator;
