pub const css = @import("../css_parser.zig");
const Property = css.Property;
const PropertyIdTag = css.PropertyIdTag;
const PropertyCategory = css.logical.PropertyCategory;

const LengthPercentageOrAuto = css.css_values.length.LengthPercentageOrAuto;

/// A value for the [inset](https://drafts.csswg.org/css-logical/#propdef-inset) shorthand property.
pub const Inset = struct {
    top: LengthPercentageOrAuto,
    right: LengthPercentageOrAuto,
    bottom: LengthPercentageOrAuto,
    left: LengthPercentageOrAuto,

    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.inset);
    const css_impl = css.DefineRectShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"inset-block");
    const css_impl = css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"inset-inline");
    const css_impl = css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"margin-block");
    const css_impl = css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"margin-inline");
    const css_impl = css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.margin);
    const css_impl = css.DefineRectShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"padding-block");
    const css_impl = css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"padding-inline");
    const css_impl = css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.padding);
    const css_impl = css.DefineRectShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-margin-block");
    const css_impl = css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-margin-inline");
    const css_impl = css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-margin");
    const css_impl = css.DefineRectShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-padding-block");
    const css_impl = css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-padding-inline");
    const css_impl = css.DefineSizeShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-padding");
    const css_impl = css.DefineRectShorthand(@This(), LengthPercentageOrAuto);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

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

pub const MarginHandler = NewSizeHandler(
    PropertyIdTag.@"margin-top",
    PropertyIdTag.@"margin-bottom",
    PropertyIdTag.@"margin-left",
    PropertyIdTag.@"margin-right",
    PropertyIdTag.@"margin-block-start",
    PropertyIdTag.@"margin-block-end",
    PropertyIdTag.@"margin-inline-start",
    PropertyIdTag.@"margin-inline-end",
    PropertyIdTag.margin,
    PropertyIdTag.@"margin-block",
    PropertyIdTag.@"margin-inline",
    PropertyCategory.physical,
    .{
        .feature = css.Feature.logical_margin,
        .shorthand_feature = css.Feature.logical_margin_shorthand,
    },
);

pub const PaddingHandler = NewSizeHandler(
    PropertyIdTag.@"padding-top",
    PropertyIdTag.@"padding-bottom",
    PropertyIdTag.@"padding-left",
    PropertyIdTag.@"padding-right",
    PropertyIdTag.@"padding-block-start",
    PropertyIdTag.@"padding-block-end",
    PropertyIdTag.@"padding-inline-start",
    PropertyIdTag.@"padding-inline-end",
    PropertyIdTag.padding,
    PropertyIdTag.@"padding-block",
    PropertyIdTag.@"padding-inline",
    PropertyCategory.physical,
    .{
        .feature = css.Feature.logical_padding,
        .shorthand_feature = css.Feature.logical_padding_shorthand,
    },
);

pub const ScrollMarginHandler = NewSizeHandler(
    PropertyIdTag.@"scroll-margin-top",
    PropertyIdTag.@"scroll-margin-bottom",
    PropertyIdTag.@"scroll-margin-left",
    PropertyIdTag.@"scroll-margin-right",
    PropertyIdTag.@"scroll-margin-block-start",
    PropertyIdTag.@"scroll-margin-block-end",
    PropertyIdTag.@"scroll-margin-inline-start",
    PropertyIdTag.@"scroll-margin-inline-end",
    PropertyIdTag.@"scroll-margin",
    PropertyIdTag.@"scroll-margin-block",
    PropertyIdTag.@"scroll-margin-inline",
    PropertyCategory.physical,
    null,
);

pub const InsetHandler = NewSizeHandler(
    PropertyIdTag.top,
    PropertyIdTag.bottom,
    PropertyIdTag.left,
    PropertyIdTag.right,
    PropertyIdTag.@"inset-block-start",
    PropertyIdTag.@"inset-block-end",
    PropertyIdTag.@"inset-inline-start",
    PropertyIdTag.@"inset-inline-end",
    PropertyIdTag.inset,
    PropertyIdTag.@"inset-block",
    PropertyIdTag.@"inset-inline",
    PropertyCategory.physical,
    .{
        .feature = css.Feature.logical_inset,
        .shorthand_feature = css.Feature.logical_inset,
    },
);

pub fn NewSizeHandler(
    comptime top_prop: css.PropertyIdTag,
    comptime bottom_prop: css.PropertyIdTag,
    comptime left_prop: css.PropertyIdTag,
    comptime right_prop: css.PropertyIdTag,
    comptime block_start_prop: css.PropertyIdTag,
    comptime block_end_prop: css.PropertyIdTag,
    comptime inline_start_prop: css.PropertyIdTag,
    comptime inline_end_prop: css.PropertyIdTag,
    comptime shorthand_prop: css.PropertyIdTag,
    comptime block_shorthand: css.PropertyIdTag,
    comptime inline_shorthand: css.PropertyIdTag,
    comptime shorthand_category: css.logical.PropertyCategory,
    comptime shorthand_extra: ?struct { feature: css.compat.Feature, shorthand_feature: css.compat.Feature },
) type {
    return struct {
        top: ?LengthPercentageOrAuto = null,
        bottom: ?LengthPercentageOrAuto = null,
        left: ?LengthPercentageOrAuto = null,
        right: ?LengthPercentageOrAuto = null,
        block_start: ?Property = null,
        block_end: ?Property = null,
        inline_start: ?Property = null,
        inline_end: ?Property = null,
        has_any: bool = false,
        category: css.logical.PropertyCategory = css.logical.PropertyCategory.default(),

        pub fn handleProperty(
            this: *@This(),
            property: *const Property,
            dest: *css.DeclarationList,
            context: *css.PropertyHandlerContext,
        ) bool {
            switch (@as(PropertyIdTag, property.*)) {
                top_prop => this.propertyHelper("top", top_prop.valueType(), &@field(property, @tagName(top_prop)), PropertyCategory.physical, dest, context),
                bottom_prop => this.propertyHelper("bottom", bottom_prop.valueType(), &@field(property, @tagName(bottom_prop)), PropertyCategory.physical, dest, context),
                left_prop => this.propertyHelper("left", left_prop.valueType(), &@field(property, @tagName(left_prop)), PropertyCategory.physical, dest, context),
                right_prop => this.propertyHelper("right", right_prop.valueType(), &@field(property, @tagName(right_prop)), PropertyCategory.physical, dest, context),
                block_start_prop => {
                    this.flushHelper("block_start", block_start_prop.valueType(), &@field(property, @tagName(block_start_prop)), PropertyCategory.logical, dest, context);
                    this.logicalPropertyHelper("block_start", property.deepClone(context.allocator), dest, context);
                },
                block_end_prop => {
                    this.flushHelper("block_end", block_end_prop.valueType(), &@field(property, @tagName(block_end_prop)), PropertyCategory.logical, dest, context);
                    this.logicalPropertyHelper("block_end", property.deepClone(context.allocator), dest, context);
                },
                inline_start_prop => {
                    this.flushHelper("inline_start", inline_start_prop.valueType(), &@field(property, @tagName(inline_start_prop)), PropertyCategory.logical, dest, context);
                    this.logicalPropertyHelper("inline_start", property.deepClone(context.allocator), dest, context);
                },
                inline_end_prop => {
                    this.flushHelper("inline_end", inline_end_prop.valueType(), &@field(property, @tagName(inline_end_prop)), PropertyCategory.logical, dest, context);
                    this.logicalPropertyHelper("inline_end", property.deepClone(context.allocator), dest, context);
                },
                block_shorthand => {
                    const val = &@field(property, @tagName(block_shorthand));
                    this.flushHelper("block_start", block_start_prop.valueType(), &val.block_start, .logical, dest, context);
                    this.flushHelper("block_end", block_end_prop.valueType(), &val.block_end, .logical, dest, context);
                    this.logicalPropertyHelper("block_start", @unionInit(Property, @tagName(block_start_prop), val.block_start.deepClone(context.allocator)), dest, context);
                    this.logicalPropertyHelper("block_end", @unionInit(Property, @tagName(block_end_prop), val.block_end.deepClone(context.allocator)), dest, context);
                },
                inline_shorthand => {
                    const val = &@field(property, @tagName(inline_shorthand));
                    this.flushHelper("inline_start", inline_start_prop.valueType(), &val.inline_start, .logical, dest, context);
                    this.flushHelper("inline_end", inline_end_prop.valueType(), &val.inline_end, .logical, dest, context);
                    this.logicalPropertyHelper("inline_start", @unionInit(Property, @tagName(inline_start_prop), val.inline_start.deepClone(context.allocator)), dest, context);
                    this.logicalPropertyHelper("inline_end", @unionInit(Property, @tagName(inline_end_prop), val.inline_end.deepClone(context.allocator)), dest, context);
                },
                shorthand_prop => {
                    const val = &@field(property, @tagName(shorthand_prop));
                    this.flushHelper("top", top_prop.valueType(), &val.top, shorthand_category, dest, context);
                    this.flushHelper("right", right_prop.valueType(), &val.right, shorthand_category, dest, context);
                    this.flushHelper("bottom", bottom_prop.valueType(), &val.bottom, shorthand_category, dest, context);
                    this.flushHelper("left", left_prop.valueType(), &val.left, shorthand_category, dest, context);
                    this.top = val.top.deepClone(context.allocator);
                    this.right = val.right.deepClone(context.allocator);
                    this.bottom = val.bottom.deepClone(context.allocator);
                    this.left = val.left.deepClone(context.allocator);
                    this.block_start = null;
                    this.block_end = null;
                    this.inline_start = null;
                    this.inline_end = null;
                    this.has_any = true;
                },
                css.PropertyIdTag.unparsed => {
                    switch (property.unparsed.property_id) {
                        top_prop, bottom_prop, left_prop, right_prop, block_start_prop, block_end_prop, inline_start_prop, inline_end_prop, block_shorthand, inline_shorthand, shorthand_prop => {
                            // Even if we weren't able to parse the value (e.g. due to var() references),
                            // we can still add vendor prefixes to the property itself.
                            switch (property.unparsed.property_id) {
                                block_start_prop => this.logicalPropertyHelper("block_start", property.deepClone(context.allocator), dest, context),
                                block_end_prop => this.logicalPropertyHelper("block_end", property.deepClone(context.allocator), dest, context),
                                inline_start_prop => this.logicalPropertyHelper("inline_start", property.deepClone(context.allocator), dest, context),
                                inline_end_prop => this.logicalPropertyHelper("inline_end", property.deepClone(context.allocator), dest, context),
                                else => {
                                    this.flush(dest, context);
                                    dest.append(context.allocator, property.deepClone(context.allocator)) catch unreachable;
                                },
                            }
                        },
                        else => return false,
                    }
                },
                else => return false,
            }

            return true;
        }

        pub fn finalize(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
            this.flush(dest, context);
        }

        fn flushHelper(
            this: *@This(),
            comptime field: []const u8,
            comptime T: type,
            val: *const T,
            comptime category: PropertyCategory,
            dest: *css.DeclarationList,
            context: *css.PropertyHandlerContext,
        ) void {
            // If the category changes betweet logical and physical,
            // or if the value contains syntax that isn't supported across all targets,
            // preserve the previous value as a fallback.
            if (category != this.category or (@field(this, field) != null and context.targets.browsers != null and !val.isCompatible(context.targets.browsers.?))) {
                this.flush(dest, context);
            }
        }

        fn propertyHelper(
            this: *@This(),
            comptime field: []const u8,
            comptime T: type,
            val: *const T,
            comptime category: PropertyCategory,
            dest: *css.DeclarationList,
            context: *css.PropertyHandlerContext,
        ) void {
            this.flushHelper(field, T, val, category, dest, context);
            @field(this, field) = val.deepClone(context.allocator);
            this.category = category;
            this.has_any = true;
        }

        fn logicalPropertyHelper(
            this: *@This(),
            comptime field: []const u8,
            val: css.Property,
            dest: *css.DeclarationList,
            context: *css.PropertyHandlerContext,
        ) void {
            // Assume unparsed properties might contain unsupported syntax that we must preserve as a fallback.
            if (this.category != PropertyCategory.logical or (@field(this, field) != null and val == .unparsed)) {
                this.flush(dest, context);
            }

            if (@field(this, field)) |*p| p.deinit(context.allocator);
            @field(this, field) = val;
            this.category = PropertyCategory.logical;
            this.has_any = true;
        }

        fn flush(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
            if (!this.has_any) return;

            this.has_any = false;

            const top = bun.take(&this.top);
            const bottom = bun.take(&this.bottom);
            const left = bun.take(&this.left);
            const right = bun.take(&this.right);
            const logical_supported = if (comptime shorthand_extra != null) !context.shouldCompileLogical(shorthand_extra.?.feature) else true;

            if ((shorthand_category != .logical or logical_supported) and top != null and bottom != null and left != null and right != null) {
                dest.append(
                    context.allocator,
                    @unionInit(
                        Property,
                        @tagName(shorthand_prop),
                        .{
                            .top = top.?,
                            .bottom = bottom.?,
                            .left = left.?,
                            .right = right.?,
                        },
                    ),
                ) catch |err| bun.handleOom(err);
            } else {
                if (top) |t| {
                    dest.append(
                        context.allocator,
                        @unionInit(Property, @tagName(top_prop), t),
                    ) catch |err| bun.handleOom(err);
                }

                if (bottom) |b| {
                    dest.append(
                        context.allocator,
                        @unionInit(Property, @tagName(bottom_prop), b),
                    ) catch |err| bun.handleOom(err);
                }

                if (left) |b| {
                    dest.append(
                        context.allocator,
                        @unionInit(Property, @tagName(left_prop), b),
                    ) catch |err| bun.handleOom(err);
                }

                if (right) |b| {
                    dest.append(
                        context.allocator,
                        @unionInit(Property, @tagName(right_prop), b),
                    ) catch |err| bun.handleOom(err);
                }
            }

            var block_start = bun.take(&this.block_start);
            var block_end = bun.take(&this.block_end);
            var inline_start = bun.take(&this.inline_start);
            var inline_end = bun.take(&this.inline_end);

            if (logical_supported) {
                this.logicalSideHelper(&block_start, &block_end, "block_start", "block_end", block_shorthand, block_start_prop, block_end_prop, logical_supported, dest, context);
            } else {
                this.prop(&block_start, block_start_prop, top_prop, dest, context);
                this.prop(&block_end, block_end_prop, bottom_prop, dest, context);
            }

            if (logical_supported) {
                this.logicalSideHelper(&inline_start, &inline_end, "inline_start", "inline_end", inline_shorthand, inline_start_prop, inline_end_prop, logical_supported, dest, context);
            } else if (inline_start != null or inline_end != null) {
                if (inline_start != null and inline_start.? == @field(Property, @tagName(inline_start_prop)) and inline_end != null and inline_end.? == @field(Property, @tagName(inline_end_prop)) and
                    @field(inline_start.?, @tagName(inline_start_prop)).eql(&@field(inline_end.?, @tagName(inline_end_prop))))
                {
                    this.prop(&inline_start, inline_start_prop, left_prop, dest, context);
                    this.prop(&inline_end, inline_end_prop, right_prop, dest, context);
                } else {
                    this.logicalPropHelper(&inline_start, inline_start_prop, left_prop, right_prop, dest, context);
                    this.logicalPropHelper(&inline_end, inline_end_prop, right_prop, left_prop, dest, context);
                }
            }
        }

        inline fn logicalPropHelper(
            this: *@This(),
            val: *?Property,
            comptime logical: css.PropertyIdTag,
            comptime ltr: css.PropertyIdTag,
            comptime rtl: css.PropertyIdTag,
            dest: *css.DeclarationList,
            context: *css.PropertyHandlerContext,
        ) void {
            _ = this; // autofix
            _ = dest; // autofix
            if (val.*) |*_v| {
                if (@as(css.PropertyIdTag, _v.*) == logical) {
                    const v = &@field(_v, @tagName(logical));
                    context.addLogicalRule(
                        context.allocator,
                        @unionInit(Property, @tagName(ltr), v.deepClone(context.allocator)),
                        @unionInit(Property, @tagName(rtl), v.deepClone(context.allocator)),
                    );
                } else if (_v.* == .unparsed) {
                    const v = &_v.unparsed;
                    context.addLogicalRule(
                        context.allocator,
                        Property{
                            .unparsed = v.withPropertyId(context.allocator, ltr),
                        },
                        Property{
                            .unparsed = v.withPropertyId(context.allocator, rtl),
                        },
                    );
                }
            }
        }

        inline fn logicalSideHelper(
            this: *@This(),
            start: *?Property,
            end: *?Property,
            comptime start_name: []const u8,
            comptime end_name: []const u8,
            comptime shorthand_property: css.PropertyIdTag,
            comptime start_prop: css.PropertyIdTag,
            comptime end_prop: css.PropertyIdTag,
            logical_supported: bool,
            dest: *css.DeclarationList,
            context: *css.PropertyHandlerContext,
        ) void {
            _ = this; // autofix
            const shorthand_supported = logical_supported and if (comptime shorthand_extra != null) !context.shouldCompileLogical(shorthand_extra.?.shorthand_feature) else true;

            if (start.* != null and @as(PropertyIdTag, start.*.?) == start_prop and
                end.* != null and @as(PropertyIdTag, end.*.?) == end_prop and
                shorthand_supported)
            {
                const ValueType = shorthand_property.valueType();
                var value: ValueType = undefined;
                @field(value, start_name) = @field(start.*.?, @tagName(start_prop)).deepClone(context.allocator);
                @field(value, end_name) = @field(end.*.?, @tagName(end_prop)).deepClone(context.allocator);
                if (std.meta.fields(ValueType).len != 2) {
                    @compileError(@typeName(ValueType) ++ " has more than two fields. This could cause undefined memory.");
                }

                dest.append(context.allocator, @unionInit(
                    Property,
                    @tagName(shorthand_property),
                    value,
                )) catch |err| bun.handleOom(err);
            } else {
                if (start.* != null) {
                    bun.handleOom(dest.append(context.allocator, start.*.?));
                }
                if (end.* != null) {
                    bun.handleOom(dest.append(context.allocator, end.*.?));
                }
            }
        }

        inline fn prop(
            this: *@This(),
            val: *?Property,
            comptime logical: css.PropertyIdTag,
            comptime physical: css.PropertyIdTag,
            dest: *css.DeclarationList,
            context: *css.PropertyHandlerContext,
        ) void {
            _ = this; // autofix
            if (val.*) |*v| {
                if (@as(css.PropertyIdTag, v.*) == logical) {
                    dest.append(
                        context.allocator,
                        @unionInit(
                            Property,
                            @tagName(physical),
                            @field(v, @tagName(logical)),
                        ),
                    ) catch |err| bun.handleOom(err);
                } else if (v.* == .unparsed) {
                    dest.append(
                        context.allocator,
                        Property{
                            .unparsed = v.unparsed.withPropertyId(context.allocator, physical),
                        },
                    ) catch |err| bun.handleOom(err);
                }
            }
        }
    };
}

const bun = @import("bun");
const std = @import("std");
const Allocator = std.mem.Allocator;
