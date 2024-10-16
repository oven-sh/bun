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

const CSSNumberFns = css.css_values.number.CSSNumberFns;
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

/// A value for the [flex-direction](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#propdef-flex-direction) property.
/// A value for the [flex-direction](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#propdef-flex-direction) property.
pub const FlexDirection = enum {
    /// Flex items are laid out in a row.
    row,
    /// Flex items are laid out in a row, and reversed.
    @"row-reverse",
    /// Flex items are laid out in a column.
    column,
    /// Flex items are laid out in a column, and reversed.
    @"column-reverse",

    pub usingnamespace css.DefineEnumProperty(@This());

    pub fn default() FlexDirection {
        return .row;
    }
};

/// A value for the [flex-wrap](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-wrap-property) property.
/// A value for the [flex-wrap](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-wrap-property) property.
pub const FlexWrap = enum {
    /// The flex items do not wrap.
    nowrap,
    /// The flex items wrap.
    wrap,
    /// The flex items wrap, in reverse.
    @"wrap-reverse",

    pub usingnamespace css.DefineEnumProperty(@This());

    pub fn default() FlexWrap {
        return .nowrap;
    }
};

/// A value for the [flex-flow](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-flow-property) shorthand property.
/// A value for the [flex-flow](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-flow-property) shorthand property.
pub const FlexFlow = struct {
    /// The direction that flex items flow.
    direction: FlexDirection,
    /// How the flex items wrap.
    wrap: FlexWrap,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"flex-flow");

    pub const PropertyFieldMap = .{
        .direction = css.PropertyIdTag.@"flex-direction",
        .wrap = css.PropertyIdTag.@"flex-wrap",
    };

    pub const VendorPrefixMap = .{
        .direction = true,
        .wrap = true,
    };

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        var direction: ?FlexDirection = null;
        var wrap: ?FlexWrap = null;

        while (true) {
            if (direction == null) {
                if (input.tryParse(FlexDirection.parse, .{}).asValue()) |value| {
                    direction = value;
                    continue;
                }
            }
            if (wrap == null) {
                if (input.tryParse(FlexWrap.parse, .{}).asValue()) |value| {
                    wrap = value;
                    continue;
                }
            }
            break;
        }

        return .{
            .result = FlexFlow{
                .direction = direction orelse FlexDirection.row,
                .wrap = wrap orelse FlexWrap.nowrap,
            },
        };
    }

    pub fn toCss(this: *const FlexFlow, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        var needs_space = false;
        if (!this.direction.eql(&FlexDirection.default()) or this.wrap.eql(&FlexWrap.default())) {
            try this.direction.toCss(W, dest);
            needs_space = true;
        }

        if (!this.wrap.eql(&FlexWrap.default())) {
            if (needs_space) {
                try dest.writeStr(" ");
            }
            try this.wrap.toCss(W, dest);
        }

        return;
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [flex](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-property) shorthand property.
/// A value for the [flex](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-property) shorthand property.
pub const Flex = struct {
    /// The flex grow factor.
    grow: CSSNumber,
    /// The flex shrink factor.
    shrink: CSSNumber,
    /// The flex basis.
    basis: LengthPercentageOrAuto,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.flex);

    pub const PropertyFieldMap = .{
        .grow = css.PropertyIdTag.@"flex-grow",
        .shrink = css.PropertyIdTag.@"flex-shrink",
        .basis = css.PropertyIdTag.@"flex-basis",
    };

    pub const VendorPrefixMap = .{
        .grow = true,
        .shrink = true,
        .basis = true,
    };

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"none"}).isOk()) {
            return .{
                .result = .{
                    .grow = 0.0,
                    .shrink = 0.0,
                    .basis = LengthPercentageOrAuto.auto,
                },
            };
        }

        var grow: ?CSSNumber = null;
        var shrink: ?CSSNumber = null;
        var basis: ?LengthPercentageOrAuto = null;

        while (true) {
            if (grow == null) {
                if (input.tryParse(CSSNumberFns.parse, .{}).asValue()) |value| {
                    grow = value;
                    shrink = input.tryParse(CSSNumberFns.parse, .{}).asValue();
                    continue;
                }
            }

            if (basis == null) {
                if (input.tryParse(LengthPercentageOrAuto.parse, .{}).asValue()) |value| {
                    basis = value;
                    continue;
                }
            }

            break;
        }

        return .{
            .result = .{
                .grow = grow orelse 1.0,
                .shrink = shrink orelse 1.0,
                .basis = basis orelse LengthPercentageOrAuto{ .length = LengthPercentage{ .percentage = .{ .v = 0.0 } } },
            },
        };
    }

    pub fn toCss(this: *const Flex, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        if (this.grow == 0.0 and this.shrink == 0.0 and this.basis == .auto) {
            try dest.writeStr("none");
            return;
        }

        const ZeroKind = enum {
            NonZero,
            Length,
            Percentage,
        };

        // If the basis is unitless 0, we must write all three components to disambiguate.
        // If the basis is 0%, we can omit the basis.
        const basis_kind = switch (this.basis) {
            .length => |lp| brk: {
                if (lp == .dimension and lp.dimension.isZero()) break :brk ZeroKind.Length;
                if (lp == .percentage and lp.percentage.isZero()) break :brk ZeroKind.Percentage;
                break :brk ZeroKind.NonZero;
            },
            else => ZeroKind.NonZero,
        };

        if (this.grow != 1.0 or this.shrink != 1.0 or basis_kind != .NonZero) {
            try CSSNumberFns.toCss(&this.grow, W, dest);
            if (this.shrink != 1.0 or basis_kind == .Length) {
                try dest.writeStr(" ");
                try CSSNumberFns.toCss(&this.shrink, W, dest);
            }
        }

        if (basis_kind != .Percentage) {
            if (this.grow != 1.0 or this.shrink != 1.0 or basis_kind == .Length) {
                try dest.writeStr(" ");
            }
            try this.basis.toCss(W, dest);
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the legacy (prefixed) [box-orient](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#orientation) property.
/// Partially equivalent to `flex-direction` in the standard syntax.
/// A value for the legacy (prefixed) [box-orient](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#orientation) property.
/// Partially equivalent to `flex-direction` in the standard syntax.
pub const BoxOrient = enum {
    /// Items are laid out horizontally.
    horizontal,
    /// Items are laid out vertically.
    vertical,
    /// Items are laid out along the inline axis, according to the writing direction.
    @"inline-axis",
    /// Items are laid out along the block axis, according to the writing direction.
    @"block-axis",

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the legacy (prefixed) [box-direction](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#displayorder) property.
/// Partially equivalent to the `flex-direction` property in the standard syntax.
pub const BoxDirection = enum {
    /// Items flow in the natural direction.
    normal,
    /// Items flow in the reverse direction.
    reverse,

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the legacy (prefixed) [box-align](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#alignment) property.
/// Equivalent to the `align-items` property in the standard syntax.
/// A value for the legacy (prefixed) [box-align](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#alignment) property.
/// Equivalent to the `align-items` property in the standard syntax.
pub const BoxAlign = enum {
    /// Items are aligned to the start.
    start,
    /// Items are aligned to the end.
    end,
    /// Items are centered.
    center,
    /// Items are aligned to the baseline.
    baseline,
    /// Items are stretched.
    stretch,

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the legacy (prefixed) [box-pack](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#packing) property.
/// Equivalent to the `justify-content` property in the standard syntax.
/// A value for the legacy (prefixed) [box-pack](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#packing) property.
/// Equivalent to the `justify-content` property in the standard syntax.
pub const BoxPack = enum {
    /// Items are justified to the start.
    start,
    /// Items are justified to the end.
    end,
    /// Items are centered.
    center,
    /// Items are justified to the start and end.
    justify,

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the legacy (prefixed) [box-lines](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#multiple) property.
/// Equivalent to the `flex-wrap` property in the standard syntax.
/// A value for the legacy (prefixed) [box-lines](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#multiple) property.
/// Equivalent to the `flex-wrap` property in the standard syntax.
pub const BoxLines = enum {
    /// Items are laid out in a single line.
    single,
    /// Items may wrap into multiple lines.
    multiple,

    pub usingnamespace css.DefineEnumProperty(@This());
};

// Old flex (2012): https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/
/// A value for the legacy (prefixed) [flex-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-pack) property.
/// Equivalent to the `justify-content` property in the standard syntax.
/// A value for the legacy (prefixed) [flex-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-pack) property.
/// Equivalent to the `justify-content` property in the standard syntax.
pub const FlexPack = enum {
    /// Items are justified to the start.
    start,
    /// Items are justified to the end.
    end,
    /// Items are centered.
    center,
    /// Items are justified to the start and end.
    justify,
    /// Items are distributed evenly, with half size spaces on either end.
    distribute,

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the legacy (prefixed) [flex-item-align](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-align) property.
/// Equivalent to the `align-self` property in the standard syntax.
/// A value for the legacy (prefixed) [flex-item-align](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-align) property.
/// Equivalent to the `align-self` property in the standard syntax.
pub const FlexItemAlign = enum {
    /// Equivalent to the value of `flex-align`.
    auto,
    /// The item is aligned to the start.
    start,
    /// The item is aligned to the end.
    end,
    /// The item is centered.
    center,
    /// The item is aligned to the baseline.
    baseline,
    /// The item is stretched.
    stretch,

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the legacy (prefixed) [flex-line-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-line-pack) property.
/// Equivalent to the `align-content` property in the standard syntax.
/// A value for the legacy (prefixed) [flex-line-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-line-pack) property.
/// Equivalent to the `align-content` property in the standard syntax.
pub const FlexLinePack = enum {
    /// Content is aligned to the start.
    start,
    /// Content is aligned to the end.
    end,
    /// Content is centered.
    center,
    /// Content is justified.
    justify,
    /// Content is distributed evenly, with half size spaces on either end.
    distribute,
    /// Content is stretched.
    stretch,

    pub usingnamespace css.DefineEnumProperty(@This());
};
