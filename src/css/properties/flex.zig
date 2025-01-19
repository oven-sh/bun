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
const CSSInteger = css.css_values.integer.CSSInteger;

const VendorPrefix = css.VendorPrefix;

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

// A handler for flex-related properties that manages both standard and legacy vendor prefixed values.
// pub const FlexHandler = struct {
//     /// The flex-direction property value and vendor prefix
//     direction: ?struct { FlexDirection, VendorPrefix } = null,
//     /// The box-orient property value and vendor prefix (legacy)
//     box_orient: ?struct { BoxOrient, VendorPrefix } = null,
//     /// The box-direction property value and vendor prefix (legacy)
//     box_direction: ?struct { BoxDirection, VendorPrefix } = null,
//     /// The flex-wrap property value and vendor prefix
//     wrap: ?struct { FlexWrap, VendorPrefix } = null,
//     /// The box-lines property value and vendor prefix (legacy)
//     box_lines: ?struct { BoxLines, VendorPrefix } = null,
//     /// The flex-grow property value and vendor prefix
//     grow: ?struct { CSSNumber, VendorPrefix } = null,
//     /// The box-flex property value and vendor prefix (legacy)
//     box_flex: ?struct { CSSNumber, VendorPrefix } = null,
//     /// The flex-positive property value and vendor prefix (legacy)
//     flex_positive: ?struct { CSSNumber, VendorPrefix } = null,
//     /// The flex-shrink property value and vendor prefix
//     shrink: ?struct { CSSNumber, VendorPrefix } = null,
//     /// The flex-negative property value and vendor prefix (legacy)
//     flex_negative: ?struct { CSSNumber, VendorPrefix } = null,
//     /// The flex-basis property value and vendor prefix
//     basis: ?struct { LengthPercentageOrAuto, VendorPrefix } = null,
//     /// The preferred-size property value and vendor prefix (legacy)
//     preferred_size: ?struct { LengthPercentageOrAuto, VendorPrefix } = null,
//     /// The order property value and vendor prefix
//     order: ?struct { CSSInteger, VendorPrefix } = null,
//     /// The box-ordinal-group property value and vendor prefix (legacy)
//     box_ordinal_group: ?struct { BoxOrdinalGroup, VendorPrefix } = null,
//     /// The flex-order property value and vendor prefix (legacy)
//     flex_order: ?struct { CSSInteger, VendorPrefix } = null,
//     /// Whether any flex-related properties have been set
//     has_any: bool = false,

//     pub fn handleProperty(
//         this: *@This(),
//         property: *const Property,
//         dest: *css.DeclarationList,
//         context: *css.PropertyHandlerContext,
//     ) bool {
//         const maybeFlush = struct {
//             fn maybeFlush(
//                 self: *FlexHandler,
//                 comptime prop: []const u8,
//                 val: anytype,
//                 vp: *const VendorPrefix,
//             ) void {
//                 // If two vendor prefixes for the same property have different
//                 // values, we need to flush what we have immediately to preserve order.
//                 if (@field(self, prop)) |*field| {
//                     if (!std.meta.eql(field[0], val.*) and !field[1].contains(vp.*)) {
//                         self.flush(dest, context);
//                     }
//                 }
//             }
//         }.maybeFlush;

//         const propertyHelper = struct {
//             fn propertyHelper(
//                 self: *FlexHandler,
//                 comptime prop: []const u8,
//                 val: anytype,
//                 vp: *const VendorPrefix,
//             ) void {
//                 maybeFlush(self, prop, val, vp);

//                 // Otherwise, update the value and add the prefix
//                 if (@field(self, prop)) |*field| {
//                     field[0] = val.deepClone(context.allocator);
//                     field[1].insert(vp.*);
//                 } else {
//                     @field(self, prop) = .{
//                         val.deepClone(context.allocator),
//                         vp.*,
//                     };
//                     self.has_any = true;
//                 }
//             }
//         }.propertyHelper;

//         switch (property.*) {
//             .flex_direction => |*val| {
//                 if (context.targets.browsers != null) {
//                     this.box_direction = null;
//                     this.box_orient = null;
//                 }
//                 propertyHelper(this, "direction", &val[0], &val[1]);
//             },
//             .box_orient => |*val| propertyHelper(this, "box_orient", &val[0], &val[1]),
//             .box_direction => |*val| propertyHelper(this, "box_direction", &val[0], &val[1]),
//             .flex_wrap => |*val| {
//                 if (context.targets.browsers != null) {
//                     this.box_lines = null;
//                 }
//                 propertyHelper(this, "wrap", &val[0], &val[1]);
//             },
//             .box_lines => |*val| propertyHelper(this, "box_lines", &val[0], &val[1]),
//             .flex_flow => |*val| {
//                 if (context.targets.browsers != null) {
//                     this.box_direction = null;
//                     this.box_orient = null;
//                 }
//                 propertyHelper(this, "direction", &val[0].direction, &val[1]);
//                 propertyHelper(this, "wrap", &val[0].wrap, &val[1]);
//             },
//             .flex_grow => |*val| {
//                 if (context.targets.browsers != null) {
//                     this.box_flex = null;
//                     this.flex_positive = null;
//                 }
//                 propertyHelper(this, "grow", &val[0], &val[1]);
//             },
//             .box_flex => |*val| propertyHelper(this, "box_flex", &val[0], &val[1]),
//             .flex_positive => |*val| propertyHelper(this, "flex_positive", &val[0], &val[1]),
//             .flex_shrink => |*val| {
//                 if (context.targets.browsers != null) {
//                     this.flex_negative = null;
//                 }
//                 propertyHelper(this, "shrink", &val[0], &val[1]);
//             },
//             .flex_negative => |*val| propertyHelper(this, "flex_negative", &val[0], &val[1]),
//             .flex_basis => |*val| {
//                 if (context.targets.browsers != null) {
//                     this.preferred_size = null;
//                 }
//                 propertyHelper(this, "basis", &val[0], &val[1]);
//             },
//             .flex_preferred_size => |*val| propertyHelper(this, "preferred_size", &val[0], &val[1]),
//             .flex => |*val| {
//                 if (context.targets.browsers != null) {
//                     this.box_flex = null;
//                     this.flex_positive = null;
//                     this.flex_negative = null;
//                     this.preferred_size = null;
//                 }
//                 maybeFlush(this, "grow", &val[0].grow, &val[1]);
//                 maybeFlush(this, "shrink", &val[0].shrink, &val[1]);
//                 maybeFlush(this, "basis", &val[0].basis, &val[1]);
//                 propertyHelper(this, "grow", &val[0].grow, &val[1]);
//                 propertyHelper(this, "shrink", &val[0].shrink, &val[1]);
//                 propertyHelper(this, "basis", &val[0].basis, &val[1]);
//             },
//             .order => |*val| {
//                 if (context.targets.browsers != null) {
//                     this.box_ordinal_group = null;
//                     this.flex_order = null;
//                 }
//                 propertyHelper(this, "order", &val[0], &val[1]);
//             },
//             .box_ordinal_group => |*val| propertyHelper(this, "box_ordinal_group", &val[0], &val[1]),
//             .flex_order => |*val| propertyHelper(this, "flex_order", &val[0], &val[1]),
//             .unparsed => |*val| {
//                 if (isFlexProperty(&val.property_id)) {
//                     this.flush(dest, context);
//                     dest.append(context.allocator, property.deepClone(context.allocator)) catch unreachable;
//                 } else {
//                     return false;
//                 }
//             },
//             else => return false,
//         }

//         return true;
//     }

//     pub fn finalize(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
//         this.flush(dest, context);
//     }

//     fn flush(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
//         if (!this.has_any) {
//             return;
//         }

//         this.has_any = false;

//         var direction = bun.take(&this.direction);
//         var wrap = bun.take(&this.wrap);
//         var grow = bun.take(&this.grow);
//         var shrink = bun.take(&this.shrink);
//         var basis = bun.take(&this.basis);
//         const box_orient = bun.take(&this.box_orient);
//         const box_direction = bun.take(&this.box_direction);
//         const box_flex = bun.take(&this.box_flex);
//         const box_ordinal_group = bun.take(&this.box_ordinal_group);
//         const box_lines = bun.take(&this.box_lines);
//         const flex_positive = bun.take(&this.flex_positive);
//         const flex_negative = bun.take(&this.flex_negative);
//         const preferred_size = bun.take(&this.preferred_size);
//         const order = bun.take(&this.order);
//         const flex_order = bun.take(&this.flex_order);

//         // Legacy properties. These are only set if the final standard properties were unset.
//         if (box_orient) |val| {
//             if (!val[1].isEmpty()) {
//                 dest.append(context.allocator, Property{ .box_orient = val }) catch unreachable;
//             }
//         }

//         if (box_direction) |val| {
//             if (!val[1].isEmpty()) {
//                 dest.append(context.allocator, Property{ .box_direction = val }) catch unreachable;
//             }
//         }

//         if (box_ordinal_group) |val| {
//             if (!val[1].isEmpty()) {
//                 dest.append(context.allocator, Property{ .box_ordinal_group = val }) catch unreachable;
//             }
//         }

//         if (box_flex) |val| {
//             if (!val[1].isEmpty()) {
//                 dest.append(context.allocator, Property{ .box_flex = val }) catch unreachable;
//             }
//         }

//         if (box_lines) |val| {
//             if (!val[1].isEmpty()) {
//                 dest.append(context.allocator, Property{ .box_lines = val }) catch unreachable;
//             }
//         }

//         if (flex_positive) |val| {
//             if (!val[1].isEmpty()) {
//                 dest.append(context.allocator, Property{ .flex_positive = val }) catch unreachable;
//             }
//         }

//         if (flex_negative) |val| {
//             if (!val[1].isEmpty()) {
//                 dest.append(context.allocator, Property{ .flex_negative = val }) catch unreachable;
//             }
//         }

//         if (preferred_size) |val| {
//             if (!val[1].isEmpty()) {
//                 dest.append(context.allocator, Property{ .flex_preferred_size = val }) catch unreachable;
//             }
//         }

//         if (flex_order) |val| {
//             if (!val[1].isEmpty()) {
//                 dest.append(context.allocator, Property{ .flex_order = val }) catch unreachable;
//             }
//         }

//         // Handle direction
//         if (direction) |dir| {
//             if (context.targets.browsers) |targets| {
//                 const prefixes = context.targets.prefixes(VendorPrefix{ .none = true }, .flex_direction);
//                 var prefixes_2009 = VendorPrefix{};
//                 if (isFlexbox2009(targets)) {
//                     prefixes_2009.insert(.webkit);
//                 }
//                 if (prefixes.contains(.moz)) {
//                     prefixes_2009.insert(.moz);
//                 }
//                 if (!prefixes_2009.isEmpty()) {
//                     const orient_dir = dir[0].to2009();
//                     dest.append(context.allocator, Property{ .box_orient = .{ orient_dir[0], prefixes_2009 } }) catch unreachable;
//                     dest.append(context.allocator, Property{ .box_direction = .{ orient_dir[1], prefixes_2009 } }) catch unreachable;
//                 }
//             }
//         }

//         // Handle flex-flow
//         if (direction != null and wrap != null) {
//             const intersection = direction.?[1].intersect(wrap.?[1]);
//             if (!intersection.isEmpty()) {
//                 var prefix = context.targets.prefixes(intersection, .flex_flow);
//                 // Firefox only implemented the 2009 spec prefixed.
//                 prefix.remove(.moz);
//                 dest.append(context.allocator, Property{ .flex_flow = .{
//                     .{
//                         .direction = direction.?[0],
//                         .wrap = wrap.?[0],
//                     },
//                     prefix,
//                 } }) catch unreachable;
//                 direction.?[1].remove(intersection);
//                 wrap.?[1].remove(intersection);
//             }
//         }

//         // Handle flex shorthand
//         if (grow != null and shrink != null and basis != null) {
//             const intersection = grow.?[1].intersect(shrink.?[1]).intersect(basis.?[1]);
//             if (!intersection.isEmpty()) {
//                 var prefix = context.targets.prefixes(intersection, .flex);
//                 // Firefox only implemented the 2009 spec prefixed.
//                 prefix.remove(.moz);
//                 dest.append(context.allocator, Property{ .flex = .{
//                     .{
//                         .grow = grow.?[0],
//                         .shrink = shrink.?[0],
//                         .basis = basis.?[0],
//                     },
//                     prefix,
//                 } }) catch unreachable;
//                 grow.?[1].remove(intersection);
//                 shrink.?[1].remove(intersection);
//                 basis.?[1].remove(intersection);
//             }
//         }

//         // Handle remaining individual properties
//         if (direction) |dir| {
//             if (!dir[1].isEmpty()) {
//                 var prefix = context.targets.prefixes(dir[1], .flex_direction);
//                 // Firefox only implemented the 2009 spec prefixed.
//                 prefix.remove(.moz);
//                 dest.append(context.allocator, Property{ .flex_direction = .{ dir[0], prefix } }) catch unreachable;
//             }
//         }

//         if (wrap) |w| {
//             if (!w[1].isEmpty()) {
//                 var prefix = context.targets.prefixes(w[1], .flex_wrap);
//                 // Firefox only implemented the 2009 spec prefixed.
//                 prefix.remove(.moz);
//                 dest.append(context.allocator, Property{ .flex_wrap = .{ w[0], prefix } }) catch unreachable;
//             }
//         }

//         if (grow) |g| {
//             if (!g[1].isEmpty()) {
//                 var prefix = context.targets.prefixes(g[1], .flex_grow);
//                 // Firefox only implemented the 2009 spec prefixed.
//                 prefix.remove(.moz);
//                 dest.append(context.allocator, Property{ .flex_grow = .{ g[0], prefix } }) catch unreachable;
//             }
//         }

//         if (shrink) |s| {
//             if (!s[1].isEmpty()) {
//                 var prefix = context.targets.prefixes(s[1], .flex_shrink);
//                 // Firefox only implemented the 2009 spec prefixed.
//                 prefix.remove(.moz);
//                 dest.append(context.allocator, Property{ .flex_shrink = .{ s[0], prefix } }) catch unreachable;
//             }
//         }

//         if (basis) |b| {
//             if (!b[1].isEmpty()) {
//                 var prefix = context.targets.prefixes(b[1], .flex_basis);
//                 // Firefox only implemented the 2009 spec prefixed.
//                 prefix.remove(.moz);
//                 dest.append(context.allocator, Property{ .flex_basis = .{ b[0], prefix } }) catch unreachable;
//             }
//         }

//         if (order) |o| {
//             if (!o[1].isEmpty()) {
//                 var prefix = context.targets.prefixes(o[1], .order);
//                 // Firefox only implemented the 2009 spec prefixed.
//                 prefix.remove(.moz);
//                 dest.append(context.allocator, Property{ .order = .{ o[0], prefix } }) catch unreachable;
//             }
//         }
//     }

//     fn isFlexProperty(property_id: *const PropertyId) bool {
//         return switch (property_id.*) {
//             .flex_direction,
//             .box_orient,
//             .box_direction,
//             .flex_wrap,
//             .box_lines,
//             .flex_flow,
//             .flex_grow,
//             .box_flex,
//             .flex_positive,
//             .flex_shrink,
//             .flex_negative,
//             .flex_basis,
//             .flex_preferred_size,
//             .flex,
//             .order,
//             .box_ordinal_group,
//             .flex_order,
//             => true,
//             else => false,
//         };
//     }
// };
