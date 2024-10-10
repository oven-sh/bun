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

/// A value for the [inset](https://drafts.csswg.org/css-logical/#propdef-inset) shorthand property.
pub const Inset = struct {
    top: LengthPercentageOrAuto,
    right: LengthPercentageOrAuto,
    bottom: LengthPercentageOrAuto,
    left: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.inset);
    pub usingnamespace css.DefineRectShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .top = css.PropertyIdTag.top,
        .right = css.PropertyIdTag.right,
        .bottom = css.PropertyIdTag.bottom,
        .left = css.PropertyIdTag.left,
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [inset-block](https://drafts.csswg.org/css-logical/#propdef-inset-block) shorthand property.
pub const InsetBlock = struct {
    /// The block start value.
    block_start: LengthPercentageOrAuto,
    /// The block end value.
    block_end: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"inset-block");
    pub usingnamespace css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .block_start = css.PropertyIdTag.@"inset-block-start",
        .block_end = css.PropertyIdTag.@"inset-block-end",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [inset-inline](https://drafts.csswg.org/css-logical/#propdef-inset-inline) shorthand property.
pub const InsetInline = struct {
    /// The inline start value.
    inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    inline_end: LengthPercentageOrAuto,

    pub const PropertyFieldMap = .{
        .inline_start = css.PropertyIdTag.@"inset-inline-start",
        .inline_end = css.PropertyIdTag.@"inset-inline-end",
    };

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"inset-inline");
    pub usingnamespace css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [margin-block](https://drafts.csswg.org/css-logical/#propdef-margin-block) shorthand property.
pub const MarginBlock = struct {
    /// The block start value.
    block_start: LengthPercentageOrAuto,
    /// The block end value.
    block_end: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"margin-block");
    pub usingnamespace css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .block_start = css.PropertyIdTag.@"margin-block-start",
        .block_end = css.PropertyIdTag.@"margin-block-end",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [margin-inline](https://drafts.csswg.org/css-logical/#propdef-margin-inline) shorthand property.
pub const MarginInline = struct {
    /// The inline start value.
    inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    inline_end: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"margin-inline");
    pub usingnamespace css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .inline_start = css.PropertyIdTag.@"margin-inline-start",
        .inline_end = css.PropertyIdTag.@"margin-inline-end",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [margin](https://drafts.csswg.org/css-box-4/#propdef-margin) shorthand property.
pub const Margin = struct {
    top: LengthPercentageOrAuto,
    right: LengthPercentageOrAuto,
    bottom: LengthPercentageOrAuto,
    left: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.margin);
    pub usingnamespace css.DefineRectShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .top = css.PropertyIdTag.@"margin-top",
        .right = css.PropertyIdTag.@"margin-right",
        .bottom = css.PropertyIdTag.@"margin-bottom",
        .left = css.PropertyIdTag.@"margin-left",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [padding-block](https://drafts.csswg.org/css-logical/#propdef-padding-block) shorthand property.
pub const PaddingBlock = struct {
    /// The block start value.
    block_start: LengthPercentageOrAuto,
    /// The block end value.
    block_end: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"padding-block");
    pub usingnamespace css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .block_start = css.PropertyIdTag.@"padding-block-start",
        .block_end = css.PropertyIdTag.@"padding-block-end",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [padding-inline](https://drafts.csswg.org/css-logical/#propdef-padding-inline) shorthand property.
pub const PaddingInline = struct {
    /// The inline start value.
    inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    inline_end: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"padding-inline");
    pub usingnamespace css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .inline_start = css.PropertyIdTag.@"padding-inline-start",
        .inline_end = css.PropertyIdTag.@"padding-inline-end",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [padding](https://drafts.csswg.org/css-box-4/#propdef-padding) shorthand property.
pub const Padding = struct {
    top: LengthPercentageOrAuto,
    right: LengthPercentageOrAuto,
    bottom: LengthPercentageOrAuto,
    left: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.padding);
    pub usingnamespace css.DefineRectShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .top = css.PropertyIdTag.@"padding-top",
        .right = css.PropertyIdTag.@"padding-right",
        .bottom = css.PropertyIdTag.@"padding-bottom",
        .left = css.PropertyIdTag.@"padding-left",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [scroll-margin-block](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-margin-block) shorthand property.
pub const ScrollMarginBlock = struct {
    /// The block start value.
    block_start: LengthPercentageOrAuto,
    /// The block end value.
    block_end: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-margin-block");
    pub usingnamespace css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .block_start = css.PropertyIdTag.@"scroll-margin-block-start",
        .block_end = css.PropertyIdTag.@"scroll-margin-block-end",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [scroll-margin-inline](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-margin-inline) shorthand property.
pub const ScrollMarginInline = struct {
    /// The inline start value.
    inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    inline_end: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-margin-inline");
    pub usingnamespace css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .inline_start = css.PropertyIdTag.@"scroll-margin-inline-start",
        .inline_end = css.PropertyIdTag.@"scroll-margin-inline-end",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [scroll-margin](https://drafts.csswg.org/css-scroll-snap/#scroll-margin) shorthand property.
pub const ScrollMargin = struct {
    top: LengthPercentageOrAuto,
    right: LengthPercentageOrAuto,
    bottom: LengthPercentageOrAuto,
    left: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-margin");
    pub usingnamespace css.DefineRectShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .top = css.PropertyIdTag.@"scroll-margin-top",
        .right = css.PropertyIdTag.@"scroll-margin-right",
        .bottom = css.PropertyIdTag.@"scroll-margin-bottom",
        .left = css.PropertyIdTag.@"scroll-margin-left",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [scroll-padding-block](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-padding-block) shorthand property.
pub const ScrollPaddingBlock = struct {
    /// The block start value.
    block_start: LengthPercentageOrAuto,
    /// The block end value.
    block_end: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-padding-block");
    pub usingnamespace css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .block_start = css.PropertyIdTag.@"scroll-padding-block-start",
        .block_end = css.PropertyIdTag.@"scroll-padding-block-end",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [scroll-padding-inline](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-padding-inline) shorthand property.
pub const ScrollPaddingInline = struct {
    /// The inline start value.
    inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    inline_end: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-padding-inline");
    pub usingnamespace css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .inline_start = css.PropertyIdTag.@"scroll-padding-inline-start",
        .inline_end = css.PropertyIdTag.@"scroll-padding-inline-end",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [scroll-padding](https://drafts.csswg.org/css-scroll-snap/#scroll-padding) shorthand property.
pub const ScrollPadding = struct {
    top: LengthPercentageOrAuto,
    right: LengthPercentageOrAuto,
    bottom: LengthPercentageOrAuto,
    left: LengthPercentageOrAuto,

    // TODO: bring this back
    // pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-padding");
    pub usingnamespace css.DefineRectShorthand(@This(), LengthPercentageOrAuto);

    pub const PropertyFieldMap = .{
        .top = css.PropertyIdTag.@"scroll-padding-top",
        .right = css.PropertyIdTag.@"scroll-padding-right",
        .bottom = css.PropertyIdTag.@"scroll-padding-bottom",
        .left = css.PropertyIdTag.@"scroll-padding-left",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};
