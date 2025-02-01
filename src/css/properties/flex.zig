const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Error = css.Error;

const Property = css.Property;
const PropertyId = css.PropertyId;

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
const CSSInteger = css.css_values.number.CSSInteger;

const isFlex2009 = css.prefixes.Feature.isFlex2009;

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

    pub fn to2009(this: *const FlexDirection) struct { BoxOrient, BoxDirection } {
        return switch (this.*) {
            .row => .{ .horizontal, .normal },
            .column => .{ .vertical, .normal },
            .@"row-reverse" => .{ .horizontal, .reverse },
            .@"column-reverse" => .{ .vertical, .reverse },
        };
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

    pub fn fromStandard(this: *const FlexWrap) ?FlexWrap {
        return this;
    }
};

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

pub const FlexAlign = BoxAlign;

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

    pub fn fromStandard(@"align": *const css.css_properties.@"align".AlignItems) ?BoxAlign {
        return switch (@"align".*) {
            .self_position => |sp| if (sp.overflow == null) switch (sp.value) {
                .start, .@"flex-start" => .start,
                .end, .@"flex-end" => .end,
                .center => .center,
                else => null,
            } else null,
            .stretch => .stretch,
            else => null,
        };
    }
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

    pub fn fromStandard(justify: *const css.css_properties.@"align".JustifyContent) ?BoxPack {
        return switch (justify.*) {
            .content_distribution => |cd| switch (cd) {
                .@"space-between" => .justify,
                else => null,
            },
            .content_position => |cp| if (cp.overflow == null) switch (cp.value) {
                .start, .@"flex-start" => .start,
                .end, .@"flex-end" => .end,
                .center => .center,
            } else null,
            else => null,
        };
    }
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

    pub fn fromStandard(wrap: *const FlexWrap) ?BoxLines {
        return switch (wrap.*) {
            .nowrap => .single,
            .wrap => .multiple,
            else => null,
        };
    }
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

    pub fn fromStandard(justify: *const css.css_properties.@"align".JustifyContent) ?FlexPack {
        return switch (justify.*) {
            .content_distribution => |cd| switch (cd) {
                .@"space-between" => .justify,
                .@"space-around" => .distribute,
                else => null,
            },
            .content_position => |cp| if (cp.overflow == null) switch (cp.value) {
                .start, .@"flex-start" => .start,
                .end, .@"flex-end" => .end,
                .center => .center,
            } else null,
            else => null,
        };
    }
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

    pub fn fromStandard(justify: *const css.css_properties.@"align".AlignSelf) ?FlexItemAlign {
        return switch (justify.*) {
            .auto => .auto,
            .stretch => .stretch,
            .self_position => |sp| if (sp.overflow == null) switch (sp.value) {
                .start, .@"flex-start" => .start,
                .end, .@"flex-end" => .end,
                .center => .center,
                else => null,
            } else null,
            else => null,
        };
    }
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

    pub fn fromStandard(justify: *const css.css_properties.@"align".AlignContent) ?FlexLinePack {
        return switch (justify.*) {
            .content_distribution => |cd| switch (cd) {
                .@"space-between" => .justify,
                .@"space-around" => .distribute,
                .stretch => .stretch,
                else => null,
            },
            .content_position => |cp| if (cp.overflow == null) switch (cp.value) {
                .start, .@"flex-start" => .start,
                .end, .@"flex-end" => .end,
                .center => .center,
            } else null,
            else => null,
        };
    }
};

pub const BoxOrdinalGroup = CSSInteger;

// A handler for flex-related properties that manages both standard and legacy vendor prefixed values.
pub const FlexHandler = struct {
    /// The flex-direction property value and vendor prefix
    direction: ?struct { FlexDirection, VendorPrefix } = null,
    /// The box-orient property value and vendor prefix (legacy)
    box_orient: ?struct { BoxOrient, VendorPrefix } = null,
    /// The box-direction property value and vendor prefix (legacy)
    box_direction: ?struct { BoxDirection, VendorPrefix } = null,
    /// The flex-wrap property value and vendor prefix
    wrap: ?struct { FlexWrap, VendorPrefix } = null,
    /// The box-lines property value and vendor prefix (legacy)
    box_lines: ?struct { BoxLines, VendorPrefix } = null,
    /// The flex-grow property value and vendor prefix
    grow: ?struct { CSSNumber, VendorPrefix } = null,
    /// The box-flex property value and vendor prefix (legacy)
    box_flex: ?struct { CSSNumber, VendorPrefix } = null,
    /// The flex-positive property value and vendor prefix (legacy)
    flex_positive: ?struct { CSSNumber, VendorPrefix } = null,
    /// The flex-shrink property value and vendor prefix
    shrink: ?struct { CSSNumber, VendorPrefix } = null,
    /// The flex-negative property value and vendor prefix (legacy)
    flex_negative: ?struct { CSSNumber, VendorPrefix } = null,
    /// The flex-basis property value and vendor prefix
    basis: ?struct { LengthPercentageOrAuto, VendorPrefix } = null,
    /// The preferred-size property value and vendor prefix (legacy)
    preferred_size: ?struct { LengthPercentageOrAuto, VendorPrefix } = null,
    /// The order property value and vendor prefix
    order: ?struct { CSSInteger, VendorPrefix } = null,
    /// The box-ordinal-group property value and vendor prefix (legacy)
    box_ordinal_group: ?struct { BoxOrdinalGroup, VendorPrefix } = null,
    /// The flex-order property value and vendor prefix (legacy)
    flex_order: ?struct { CSSInteger, VendorPrefix } = null,
    /// Whether any flex-related properties have been set
    has_any: bool = false,

    pub fn handleProperty(
        this: *@This(),
        property: *const Property,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) bool {
        const maybeFlush = struct {
            fn maybeFlush(
                self: *FlexHandler,
                d: *css.DeclarationList,
                ctx: *css.PropertyHandlerContext,
                comptime prop: []const u8,
                val: anytype,
                vp: *const VendorPrefix,
            ) void {
                // If two vendor prefixes for the same property have different
                // values, we need to flush what we have immediately to preserve order.
                if (@field(self, prop)) |*field| {
                    if (!std.meta.eql(field[0], val.*) and !field[1].contains(vp.*)) {
                        self.flush(d, ctx);
                    }
                }
            }
        }.maybeFlush;

        const propertyHelper = struct {
            fn propertyHelper(
                self: *FlexHandler,
                ctx: *css.PropertyHandlerContext,
                d: *css.DeclarationList,
                comptime prop: []const u8,
                val: anytype,
                vp: *const VendorPrefix,
            ) void {
                maybeFlush(self, d, ctx, prop, val, vp);

                // Otherwise, update the value and add the prefix
                if (@field(self, prop)) |*field| {
                    field[0] = css.generic.deepClone(@TypeOf(val.*), val, ctx.allocator);
                    field[1].insert(vp.*);
                } else {
                    @field(self, prop) = .{
                        css.generic.deepClone(@TypeOf(val.*), val, ctx.allocator),
                        vp.*,
                    };
                    self.has_any = true;
                }
            }
        }.propertyHelper;

        switch (property.*) {
            .@"flex-direction" => |*val| {
                if (context.targets.browsers != null) {
                    this.box_direction = null;
                    this.box_orient = null;
                }
                propertyHelper(this, context, dest, "direction", &val[0], &val[1]);
            },
            .@"box-orient" => |*val| propertyHelper(this, context, dest, "box_orient", &val[0], &val[1]),
            .@"box-direction" => |*val| propertyHelper(this, context, dest, "box_direction", &val[0], &val[1]),
            .@"flex-wrap" => |*val| {
                if (context.targets.browsers != null) {
                    this.box_lines = null;
                }
                propertyHelper(this, context, dest, "wrap", &val[0], &val[1]);
            },
            .@"box-lines" => |*val| propertyHelper(this, context, dest, "box_lines", &val[0], &val[1]),
            .@"flex-flow" => |*val| {
                if (context.targets.browsers != null) {
                    this.box_direction = null;
                    this.box_orient = null;
                }
                propertyHelper(this, context, dest, "direction", &val[0].direction, &val[1]);
                propertyHelper(this, context, dest, "wrap", &val[0].wrap, &val[1]);
            },
            .@"flex-grow" => |*val| {
                if (context.targets.browsers != null) {
                    this.box_flex = null;
                    this.flex_positive = null;
                }
                propertyHelper(this, context, dest, "grow", &val[0], &val[1]);
            },
            .@"box-flex" => |*val| propertyHelper(this, context, dest, "box_flex", &val[0], &val[1]),
            .@"flex-positive" => |*val| propertyHelper(this, context, dest, "flex_positive", &val[0], &val[1]),
            .@"flex-shrink" => |*val| {
                if (context.targets.browsers != null) {
                    this.flex_negative = null;
                }
                propertyHelper(this, context, dest, "shrink", &val[0], &val[1]);
            },
            .@"flex-negative" => |*val| propertyHelper(this, context, dest, "flex_negative", &val[0], &val[1]),
            .@"flex-basis" => |*val| {
                if (context.targets.browsers != null) {
                    this.preferred_size = null;
                }
                propertyHelper(this, context, dest, "basis", &val[0], &val[1]);
            },
            .@"flex-preferred-size" => |*val| propertyHelper(this, context, dest, "preferred_size", &val[0], &val[1]),
            .flex => |*val| {
                if (context.targets.browsers != null) {
                    this.box_flex = null;
                    this.flex_positive = null;
                    this.flex_negative = null;
                    this.preferred_size = null;
                }
                maybeFlush(this, dest, context, "grow", &val[0].grow, &val[1]);
                maybeFlush(this, dest, context, "shrink", &val[0].shrink, &val[1]);
                maybeFlush(this, dest, context, "basis", &val[0].basis, &val[1]);
                propertyHelper(this, context, dest, "grow", &val[0].grow, &val[1]);
                propertyHelper(this, context, dest, "shrink", &val[0].shrink, &val[1]);
                propertyHelper(this, context, dest, "basis", &val[0].basis, &val[1]);
            },
            .order => |*val| {
                if (context.targets.browsers != null) {
                    this.box_ordinal_group = null;
                    this.flex_order = null;
                }
                propertyHelper(this, context, dest, "order", &val[0], &val[1]);
            },
            .@"box-ordinal-group" => |*val| propertyHelper(this, context, dest, "box_ordinal_group", &val[0], &val[1]),
            .@"flex-order" => |*val| propertyHelper(this, context, dest, "flex_order", &val[0], &val[1]),
            .unparsed => |*val| {
                if (isFlexProperty(&val.property_id)) {
                    this.flush(dest, context);
                    dest.append(context.allocator, property.deepClone(context.allocator)) catch unreachable;
                } else {
                    return false;
                }
            },
            else => return false,
        }

        return true;
    }

    pub fn finalize(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        this.flush(dest, context);
    }

    fn flush(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (!this.has_any) {
            return;
        }

        this.has_any = false;

        var direction: ?struct { FlexDirection, VendorPrefix } = bun.take(&this.direction);
        var wrap: ?struct { FlexWrap, VendorPrefix } = bun.take(&this.wrap);
        var grow: ?struct { CSSNumber, VendorPrefix } = bun.take(&this.grow);
        var shrink: ?struct { CSSNumber, VendorPrefix } = bun.take(&this.shrink);
        var basis = bun.take(&this.basis);
        var box_orient = bun.take(&this.box_orient);
        var box_direction = bun.take(&this.box_direction);
        var box_flex = bun.take(&this.box_flex);
        var box_ordinal_group = bun.take(&this.box_ordinal_group);
        var box_lines = bun.take(&this.box_lines);
        var flex_positive = bun.take(&this.flex_positive);
        var flex_negative = bun.take(&this.flex_negative);
        var preferred_size = bun.take(&this.preferred_size);
        var order = bun.take(&this.order);
        var flex_order = bun.take(&this.flex_order);

        // Legacy properties. These are only set if the final standard properties were unset.
        legacyProperty(this, "box-orient", bun.take(&box_orient), dest, context);
        legacyProperty(this, "box-direction", bun.take(&box_direction), dest, context);
        legacyProperty(this, "box-ordinal-group", bun.take(&box_ordinal_group), dest, context);
        legacyProperty(this, "box-flex", bun.take(&box_flex), dest, context);
        legacyProperty(this, "box-lines", bun.take(&box_lines), dest, context);
        legacyProperty(this, "flex-positive", bun.take(&flex_positive), dest, context);
        legacyProperty(this, "flex-negative", bun.take(&flex_negative), dest, context);
        legacyProperty(this, "flex-preferred-size", bun.take(&preferred_size), dest, context);
        legacyProperty(this, "flex-order", bun.take(&flex_order), dest, context);

        if (direction) |val| {
            const dir = val[0];
            if (context.targets.browsers) |targets| {
                const prefixes = context.targets.prefixes(css.VendorPrefix.NONE, css.prefixes.Feature.flex_direction);
                var prefixes_2009 = css.VendorPrefix.empty();
                if (isFlex2009(targets)) {
                    prefixes_2009.insert(css.VendorPrefix.WEBKIT);
                }
                if (prefixes.contains(css.VendorPrefix.MOZ)) {
                    prefixes_2009.insert(css.VendorPrefix.MOZ);
                }
                if (!prefixes_2009.isEmpty()) {
                    const orient, const newdir = dir.to2009();
                    dest.append(context.allocator, Property{ .@"box-orient" = .{ orient, prefixes_2009 } }) catch bun.outOfMemory();
                    dest.append(context.allocator, Property{ .@"box-direction" = .{ newdir, prefixes_2009 } }) catch bun.outOfMemory();
                }
            }
        }

        if (direction != null and wrap != null) {
            const dir: *FlexDirection = &direction.?[0];
            const dir_prefix: *VendorPrefix = &direction.?[1];
            const wrapinner: *FlexWrap = &wrap.?[0];
            const wrap_prefix: *VendorPrefix = &wrap.?[1];

            const intersection = dir_prefix.bitwiseAnd(wrap_prefix.*);
            if (!intersection.isEmpty()) {
                var prefix = context.targets.prefixes(intersection, css.prefixes.Feature.flex_flow);
                // Firefox only implemented the 2009 spec prefixed.
                prefix.remove(css.VendorPrefix.MOZ);
                dest.append(context.allocator, Property{ .@"flex-flow" = .{
                    FlexFlow{
                        .direction = dir.*,
                        .wrap = wrapinner.*,
                    },
                    prefix,
                } }) catch bun.outOfMemory();
                dir_prefix.remove(intersection);
                wrap_prefix.remove(intersection);
            }
        }

        this.singleProperty("flex-direction", bun.take(&direction), null, null, dest, context, "flex_direction");
        this.singleProperty("flex-wrap", bun.take(&wrap), null, .{ BoxLines, "box-lines" }, dest, context, "flex_wrap");

        if (context.targets.browsers) |targets| {
            if (grow) |val| {
                const g = val[0];
                const prefixes = context.targets.prefixes(css.VendorPrefix.NONE, css.prefixes.Feature.flex_grow);
                var prefixes_2009 = css.VendorPrefix.empty();
                if (isFlex2009(targets)) {
                    prefixes_2009.insert(css.VendorPrefix.WEBKIT);
                }
                if (prefixes.contains(css.VendorPrefix.MOZ)) {
                    prefixes_2009.insert(css.VendorPrefix.MOZ);
                }
                if (!prefixes_2009.isEmpty()) {
                    dest.append(context.allocator, Property{ .@"box-flex" = .{ g, prefixes_2009 } }) catch bun.outOfMemory();
                }
            }
        }

        if (grow != null and shrink != null and basis != null) {
            const g = grow.?[0];
            const g_prefix: *VendorPrefix = &grow.?[1];
            const s = shrink.?[0];
            const s_prefix: *VendorPrefix = &shrink.?[1];
            const b = basis.?[0];
            const b_prefix: *VendorPrefix = &basis.?[1];

            const intersection = g_prefix.bitwiseAnd(s_prefix.bitwiseAnd(b_prefix.*));
            if (!intersection.isEmpty()) {
                var prefix = context.targets.prefixes(intersection, css.prefixes.Feature.flex);
                // Firefox only implemented the 2009 spec prefixed.
                prefix.remove(css.VendorPrefix.MOZ);
                dest.append(context.allocator, Property{ .flex = .{
                    Flex{
                        .grow = g,
                        .shrink = s,
                        .basis = b,
                    },
                    prefix,
                } }) catch bun.outOfMemory();
                g_prefix.remove(intersection);
                s_prefix.remove(intersection);
                b_prefix.remove(intersection);
            }
        }

        this.singleProperty("flex-grow", bun.take(&grow), "flex-positive", null, dest, context, "flex_grow");
        this.singleProperty("flex-shrink", bun.take(&shrink), "flex-negative", null, dest, context, "flex_shrink");
        this.singleProperty("flex-basis", bun.take(&basis), "flex-preferred-size", null, dest, context, "flex_basis");
        this.singleProperty("order", bun.take(&order), "flex-order", .{ BoxOrdinalGroup, "box-ordinal-group" }, dest, context, "order");
    }

    fn singleProperty(
        this: *FlexHandler,
        comptime prop: []const u8,
        key: anytype,
        comptime prop_2012: ?[]const u8,
        comptime prop_2009: ?struct { type, []const u8 },
        dest: *css.DeclarationList,
        ctx: *css.PropertyHandlerContext,
        comptime feature_name: []const u8,
    ) void {
        _ = this; // autofix
        if (key) |value| {
            const val = value[0];
            var prefix = value[1];
            if (!prefix.isEmpty()) {
                prefix = ctx.targets.prefixes(prefix, @field(css.prefixes.Feature, feature_name));
                if (comptime prop_2009) |p2009| {
                    if (prefix.contains(css.VendorPrefix.NONE)) {
                        // 2009 spec, implemented by webkit and firefox
                        if (ctx.targets.browsers) |targets| {
                            var prefixes_2009 = css.VendorPrefix.empty();
                            if (isFlex2009(targets)) {
                                prefixes_2009.insert(css.VendorPrefix.WEBKIT);
                            }
                            if (prefix.contains(css.VendorPrefix.MOZ)) {
                                prefixes_2009.insert(css.VendorPrefix.MOZ);
                            }
                            if (!prefixes_2009.isEmpty()) {
                                const s = brk: {
                                    const T = comptime p2009[0];
                                    if (comptime T == BoxOrdinalGroup) break :brk @as(?i32, val);
                                    break :brk p2009[0].fromStandard(&val);
                                };
                                if (s) |v| {
                                    dest.append(ctx.allocator, @unionInit(Property, p2009[1], .{
                                        v,
                                        prefixes_2009,
                                    })) catch bun.outOfMemory();
                                }
                            }
                        }
                    }
                }

                if (comptime prop_2012) |p2012| {
                    var ms = true;
                    if (prefix.contains(css.VendorPrefix.MS)) {
                        dest.append(ctx.allocator, @unionInit(Property, p2012, .{
                            val,
                            css.VendorPrefix.MS,
                        })) catch bun.outOfMemory();
                        ms = false;
                    }

                    if (!ms) {
                        prefix.remove(css.VendorPrefix.MS);
                    }
                }

                // Firefox only implemented the 2009 spec prefixed.
                prefix.remove(css.VendorPrefix.MOZ);
                dest.append(ctx.allocator, @unionInit(Property, prop, .{
                    val,
                    prefix,
                })) catch bun.outOfMemory();
            }
        }
    }

    fn legacyProperty(this: *FlexHandler, comptime field_name: []const u8, key: anytype, dest: *css.DeclarationList, ctx: *css.PropertyHandlerContext) void {
        _ = this; // autofix
        if (key) |value| {
            const val = value[0];
            const prefix = value[1];
            if (!prefix.isEmpty()) {
                dest.append(ctx.allocator, @unionInit(Property, field_name, .{
                    val,
                    prefix,
                })) catch bun.outOfMemory();
            } else {
                // css.generic.eql(comptime T: type, lhs: *const T, rhs: *const T)
                // css.generic.deinit(@TypeOf(val), &val, ctx.allocator);
            }
        }
    }

    fn isFlexProperty(property_id: *const PropertyId) bool {
        return switch (property_id.*) {
            .@"flex-direction",
            .@"box-orient",
            .@"box-direction",
            .@"flex-wrap",
            .@"box-lines",
            .@"flex-flow",
            .@"flex-grow",
            .@"box-flex",
            .@"flex-positive",
            .@"flex-shrink",
            .@"flex-negative",
            .@"flex-basis",
            .@"flex-preferred-size",
            .flex,
            .order,
            .@"box-ordinal-group",
            .@"flex-order",
            => true,
            else => false,
        };
    }
};
