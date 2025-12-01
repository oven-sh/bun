pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;

const PropertyId = css.PropertyId;
const PropertyIdTag = css.PropertyIdTag;
const Property = css.Property;
const UnparsedProperty = css.css_properties.custom.UnparsedProperty;

const PropertyCategory = css.logical.PropertyCategory;

const LengthPercentage = css.css_values.length.LengthPercentage;
const Ratio = css.css_values.ratio.Ratio;

pub const BoxSizing = enum {
    /// Exclude the margin/border/padding from the width and height.
    @"content-box",
    /// Include the padding and border (but not the margin) in the width and height.
    @"border-box",
    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
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

    pub fn parse(input: *css.Parser) css.Result(Size) {
        const Enum = enum {
            auto,
            @"min-content",
            @"-webkit-min-content",
            @"-moz-min-content",
            @"max-content",
            @"-webkit-max-content",
            @"-moz-max-content",
            stretch,
            @"-webkit-fill-available",
            @"-moz-available",
            @"fit-content",
            @"-webkit-fit-content",
            @"-moz-fit-content",
            contain,
        };
        const Map = comptime bun.ComptimeEnumMap(Enum);
        const res = input.tryParse(struct {
            pub fn parseFn(i: *css.Parser) css.Result(Size) {
                const ident = switch (i.expectIdent()) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                };

                if (Map.getASCIIICaseInsensitive(ident)) |res| {
                    return .{ .result = switch (res) {
                        .auto => .auto,
                        .@"min-content" => .{ .min_content = css.VendorPrefix{ .none = true } },
                        .@"-webkit-min-content" => .{ .min_content = css.VendorPrefix{ .webkit = true } },
                        .@"-moz-min-content" => .{ .min_content = css.VendorPrefix{ .moz = true } },
                        .@"max-content" => .{ .max_content = css.VendorPrefix{ .none = true } },
                        .@"-webkit-max-content" => .{ .max_content = css.VendorPrefix{ .webkit = true } },
                        .@"-moz-max-content" => .{ .max_content = css.VendorPrefix{ .moz = true } },
                        .stretch => .{ .stretch = css.VendorPrefix{ .none = true } },
                        .@"-webkit-fill-available" => .{ .stretch = css.VendorPrefix{ .webkit = true } },
                        .@"-moz-available" => .{ .stretch = css.VendorPrefix{ .moz = true } },
                        .@"fit-content" => .{ .fit_content = css.VendorPrefix{ .none = true } },
                        .@"-webkit-fit-content" => .{ .fit_content = css.VendorPrefix{ .webkit = true } },
                        .@"-moz-fit-content" => .{ .fit_content = css.VendorPrefix{ .moz = true } },
                        .contain => .contain,
                    } };
                } else return .{ .err = i.newCustomError(css.ParserError.invalid_value) };
            }
        }.parseFn, .{});

        if (res == .result) return res;

        if (input.tryParse(parseFitContent, .{}).asValue()) |v| {
            return .{ .result = Size{ .fit_content_function = v } };
        }

        const lp = switch (input.tryParse(LengthPercentage.parse, .{})) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = Size{ .length_percentage = lp } };
    }

    pub fn toCss(this: *const Size, dest: *css.Printer) css.PrintErr!void {
        return switch (this.*) {
            .auto => dest.writeStr("auto"),
            .contain => dest.writeStr("contain"),
            .min_content => |vp| {
                try vp.toCss(dest);
                try dest.writeStr("min-content");
            },
            .max_content => |vp| {
                try vp.toCss(dest);
                try dest.writeStr("max-content");
            },
            .fit_content => |vp| {
                try vp.toCss(dest);
                try dest.writeStr("fit-content");
            },
            .stretch => |vp| {
                if (vp == css.VendorPrefix{ .none = true }) {
                    try dest.writeStr("stretch");
                } else if (vp == css.VendorPrefix{ .webkit = true }) {
                    try dest.writeStr("-webkit-fill-available");
                } else if (vp == css.VendorPrefix{ .moz = true }) {
                    try dest.writeStr("-moz-available");
                } else {
                    bun.unreachablePanic("Unexpected vendor prefixes", .{});
                }
            },
            .fit_content_function => |l| {
                try dest.writeStr("fit-content(");
                try l.toCss(dest);
                try dest.writeChar(')');
            },
            .length_percentage => |l| return l.toCss(dest),
        };
    }

    pub fn isCompatible(this: *const @This(), browsers: css.targets.Browsers) bool {
        const F = css.compat.Feature;
        return switch (this.*) {
            .length_percentage => |*l| l.isCompatible(browsers),
            .min_content => F.isCompatible(.min_content_size, browsers),
            .max_content => F.isCompatible(.max_content_size, browsers),
            .fit_content => F.isCompatible(.fit_content_size, browsers),
            .fit_content_function => |*l| F.isCompatible(.fit_content_function_size, browsers) and l.isCompatible(browsers),
            .stretch => |*vp| F.isCompatible(switch (vp.asBits()) {
                css.VendorPrefix.NONE.asBits() => F.stretch_size,
                css.VendorPrefix.WEBKIT.asBits() => F.webkit_fill_available_size,
                css.VendorPrefix.MOZ.asBits() => F.moz_available_size,
                else => return false,
            }, browsers),
            .contain => false, // ??? no data in mdn
            .auto => true,
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
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

    pub fn parse(input: *css.Parser) css.Result(MaxSize) {
        const Ident = enum {
            none,
            min_content,
            webkit_min_content,
            moz_min_content,
            max_content,
            webkit_max_content,
            moz_max_content,
            stretch,
            webkit_fill_available,
            moz_available,
            fit_content,
            webkit_fit_content,
            moz_fit_content,
            contain,
        };

        const IdentMap = bun.ComptimeStringMap(Ident, .{
            .{ "none", .none },
            .{ "min-content", .min_content },
            .{ "-webkit-min-content", .webkit_min_content },
            .{ "-moz-min-content", .moz_min_content },
            .{ "max-content", .max_content },
            .{ "-webkit-max-content", .webkit_max_content },
            .{ "-moz-max-content", .moz_max_content },
            .{ "stretch", .stretch },
            .{ "-webkit-fill-available", .webkit_fill_available },
            .{ "-moz-available", .moz_available },
            .{ "fit-content", .fit_content },
            .{ "-webkit-fit-content", .webkit_fit_content },
            .{ "-moz-fit-content", .moz_fit_content },
            .{ "contain", .contain },
        });

        const res = input.tryParse(struct {
            fn parse(i: *css.Parser) css.Result(MaxSize) {
                const ident = switch (i.expectIdent()) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                };
                const mapped = IdentMap.getASCIIICaseInsensitive(ident) orelse return .{ .err = i.newCustomError(css.ParserError.invalid_value) };
                return .{ .result = switch (mapped) {
                    .none => .none,
                    .min_content => .{ .min_content = .{ .none = true } },
                    .webkit_min_content => .{ .min_content = .{ .webkit = true } },
                    .moz_min_content => .{ .min_content = .{ .moz = true } },
                    .max_content => .{ .max_content = .{ .none = true } },
                    .webkit_max_content => .{ .max_content = .{ .webkit = true } },
                    .moz_max_content => .{ .max_content = .{ .moz = true } },
                    .stretch => .{ .stretch = .{ .none = true } },
                    .webkit_fill_available => .{ .stretch = .{ .webkit = true } },
                    .moz_available => .{ .stretch = .{ .moz = true } },
                    .fit_content => .{ .fit_content = .{ .none = true } },
                    .webkit_fit_content => .{ .fit_content = .{ .webkit = true } },
                    .moz_fit_content => .{ .fit_content = .{ .moz = true } },
                    .contain => .contain,
                } };
            }
        }.parse, .{});

        if (res.isOk()) {
            return res;
        }

        if (input.tryParse(parseFitContent, .{}).asValue()) |v| {
            return .{ .result = .{ .fit_content_function = v } };
        }

        return switch (input.tryParse(LengthPercentage.parse, .{})) {
            .result => |v| .{ .result = .{ .length_percentage = v } },
            .err => |e| .{ .err = e },
        };
    }

    pub fn toCss(this: *const MaxSize, dest: *css.Printer) css.PrintErr!void {
        switch (this.*) {
            .none => try dest.writeStr("none"),
            .contain => try dest.writeStr("contain"),
            .min_content => |vp| {
                try vp.toCss(dest);
                try dest.writeStr("min-content");
            },
            .max_content => |vp| {
                try vp.toCss(dest);
                try dest.writeStr("max-content");
            },
            .fit_content => |vp| {
                try vp.toCss(dest);
                try dest.writeStr("fit-content");
            },
            .stretch => |vp| {
                if (vp == css.VendorPrefix{ .none = true }) {
                    try dest.writeStr("stretch");
                } else if (vp == css.VendorPrefix{ .webkit = true }) {
                    try dest.writeStr("-webkit-fill-available");
                } else if (vp == css.VendorPrefix{ .moz = true }) {
                    try dest.writeStr("-moz-available");
                } else {
                    bun.unreachablePanic("Unexpected vendor prefixes", .{});
                }
            },
            .fit_content_function => |l| {
                try dest.writeStr("fit-content(");
                try l.toCss(dest);
                try dest.writeChar(')');
            },
            .length_percentage => |l| try l.toCss(dest),
        }
    }

    pub fn isCompatible(this: *const @This(), browsers: css.targets.Browsers) bool {
        const F = css.compat.Feature;
        return switch (this.*) {
            .length_percentage => |*l| l.isCompatible(browsers),
            .min_content => F.isCompatible(.min_content_size, browsers),
            .max_content => F.isCompatible(.max_content_size, browsers),
            .fit_content => F.isCompatible(.fit_content_size, browsers),
            .fit_content_function => |*l| F.isCompatible(F.fit_content_function_size, browsers) and l.isCompatible(browsers),
            .stretch => |*vp| F.isCompatible(
                switch (vp.asBits()) {
                    css.VendorPrefix.NONE.asBits() => F.stretch_size,
                    css.VendorPrefix.WEBKIT.asBits() => F.webkit_fill_available_size,
                    css.VendorPrefix.MOZ.asBits() => F.moz_available_size,
                    else => return false,
                },
                browsers,
            ),
            .contain => false, // ??? no data in mdn
            .none => true,
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
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
            return .{ .err = location.newCustomError(css.ParserError{ .invalid_value = {} }) };
        }

        return .{
            .result = AspectRatio{
                .auto = auto.isOk(),
                .ratio = ratio.asValue(),
            },
        };
    }

    pub fn toCss(this: *const AspectRatio, dest: *css.Printer) css.PrintErr!void {
        if (this.auto) {
            try dest.writeStr("auto");
        }

        if (this.ratio) |*ratio| {
            if (this.auto) try dest.writeChar(' ');
            try ratio.toCss(dest);
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

fn parseFitContent(input: *css.Parser) css.Result(LengthPercentage) {
    if (input.expectFunctionMatching("fit-content").asErr()) |e| return .{ .err = e };
    return input.parseNestedBlock(LengthPercentage, {}, css.voidWrap(LengthPercentage, LengthPercentage.parse));
}

pub const SizeProperty = packed struct(u16) {
    width: bool = false,
    height: bool = false,
    @"min-width": bool = false,
    @"min-height": bool = false,
    @"max-width": bool = false,
    @"max-height": bool = false,
    @"block-size": bool = false,
    @"inline-size": bool = false,
    @"min-block-size": bool = false,
    @"min-inline-size": bool = false,
    @"max-block-size": bool = false,
    @"max-inline-size": bool = false,
    __unused: u4 = 0,

    pub fn tryFromPropertyIdTag(property_id: PropertyIdTag) ?SizeProperty {
        inline for (std.meta.fields(@This())) |field| {
            if (comptime std.mem.eql(u8, field.name, "__unused")) continue;
            if (@intFromEnum(@field(PropertyIdTag, field.name)) == @intFromEnum(@as(PropertyIdTag, property_id))) {
                var ret: SizeProperty = .{};
                @field(ret, field.name) = true;
                return ret;
            }
        }
        return null;
    }
};

pub const SizeHandler = struct {
    width: ?Size = null,
    height: ?Size = null,
    min_width: ?Size = null,
    min_height: ?Size = null,
    max_width: ?MaxSize = null,
    max_height: ?MaxSize = null,
    block_size: ?Size = null,
    inline_size: ?Size = null,
    min_block_size: ?Size = null,
    min_inline_size: ?Size = null,
    max_block_size: ?MaxSize = null,
    max_inline_size: ?MaxSize = null,
    has_any: bool = false,
    flushed_properties: SizeProperty = .{},
    category: PropertyCategory = PropertyCategory.default(),

    const Feature = css.Feature;

    pub fn handleProperty(this: *@This(), property: *const Property, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) bool {
        const logical_supported = !context.shouldCompileLogical(Feature.logical_size);

        switch (property.*) {
            .width => |*v| this.propertyHelper("width", Size, v, PropertyCategory.physical, dest, context),
            .height => |*v| this.propertyHelper("height", Size, v, PropertyCategory.physical, dest, context),
            .@"min-width" => |*v| this.propertyHelper("min_width", Size, v, PropertyCategory.physical, dest, context),
            .@"min-height" => |*v| this.propertyHelper("min_height", Size, v, PropertyCategory.physical, dest, context),
            .@"max-width" => |*v| this.propertyHelper("max_width", MaxSize, v, PropertyCategory.physical, dest, context),
            .@"max-height" => |*v| this.propertyHelper("max_height", MaxSize, v, PropertyCategory.physical, dest, context),
            .@"block-size" => |*v| this.propertyHelper("block_size", Size, v, PropertyCategory.logical, dest, context),
            .@"min-block-size" => |*v| this.propertyHelper("min_block_size", Size, v, PropertyCategory.logical, dest, context),
            .@"max-block-size" => |*v| this.propertyHelper("max_block_size", MaxSize, v, PropertyCategory.logical, dest, context),
            .@"inline-size" => |*v| this.propertyHelper("inline_size", Size, v, PropertyCategory.logical, dest, context),
            .@"min-inline-size" => |*v| this.propertyHelper("min_inline_size", Size, v, PropertyCategory.logical, dest, context),
            .@"max-inline-size" => |*v| this.propertyHelper("max_inline_size", MaxSize, v, PropertyCategory.logical, dest, context),
            .unparsed => |*unparsed| {
                switch (unparsed.property_id) {
                    .width, .height, .@"min-width", .@"max-width", .@"min-height", .@"max-height" => {
                        bun.bits.insert(SizeProperty, &this.flushed_properties, SizeProperty.tryFromPropertyIdTag(@as(PropertyIdTag, unparsed.property_id)).?);
                        dest.append(context.allocator, property.deepClone(context.allocator)) catch unreachable;
                    },
                    .@"block-size" => this.logicalUnparsedHelper(property, unparsed, .height, logical_supported, dest, context),
                    .@"min-block-size" => this.logicalUnparsedHelper(property, unparsed, .@"min-height", logical_supported, dest, context),
                    .@"max-block-size" => this.logicalUnparsedHelper(property, unparsed, .@"max-height", logical_supported, dest, context),
                    .@"inline-size" => this.logicalUnparsedHelper(property, unparsed, .width, logical_supported, dest, context),
                    .@"min-inline-size" => this.logicalUnparsedHelper(property, unparsed, .@"min-width", logical_supported, dest, context),
                    .@"max-inline-size" => this.logicalUnparsedHelper(property, unparsed, .@"max-width", logical_supported, dest, context),
                    else => return false,
                }
            },
            else => return false,
        }

        return true;
    }

    inline fn logicalUnparsedHelper(this: *@This(), property: *const Property, unparsed: *const UnparsedProperty, comptime physical: PropertyIdTag, logical_supported: bool, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (logical_supported) {
            bun.bits.insert(SizeProperty, &this.flushed_properties, SizeProperty.tryFromPropertyIdTag(@as(PropertyIdTag, unparsed.property_id)).?);
            bun.handleOom(dest.append(context.allocator, property.deepClone(context.allocator)));
        } else {
            dest.append(context.allocator, Property{
                .unparsed = unparsed.withPropertyId(
                    context.allocator,
                    @unionInit(PropertyId, @tagName(physical), {}),
                ),
            }) catch |err| bun.handleOom(err);
            @field(this.flushed_properties, @tagName(physical)) = true;
        }
    }

    inline fn propertyHelper(
        this: *@This(),
        comptime property: []const u8,
        comptime T: type,
        value: *const T,
        comptime category: PropertyCategory,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) void {
        // If the category changes betweet logical and physical,
        // or if the value contains syntax that isn't supported across all targets,
        // preserve the previous value as a fallback.

        if (@field(PropertyCategory, @tagName(category)) != this.category or (@field(this, property) != null and context.targets.browsers != null and !value.isCompatible(context.targets.browsers.?))) {
            this.flush(dest, context);
        }

        @field(this, property) = value.deepClone(context.allocator);
        this.category = category;
        this.has_any = true;
    }

    pub fn flush(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (!this.has_any) return;

        this.has_any = false;
        const logical_supported = !context.shouldCompileLogical(Feature.logical_size);

        this.flushPropertyHelper(PropertyIdTag.width, "width", Size, dest, context);
        this.flushPropertyHelper(PropertyIdTag.@"min-width", "min_width", Size, dest, context);
        this.flushPropertyHelper(PropertyIdTag.@"max-width", "max_width", MaxSize, dest, context);
        this.flushPropertyHelper(PropertyIdTag.height, "height", Size, dest, context);
        this.flushPropertyHelper(PropertyIdTag.@"min-height", "min_height", Size, dest, context);
        this.flushPropertyHelper(PropertyIdTag.@"max-height", "max_height", MaxSize, dest, context);
        this.flushLogicalHelper(PropertyIdTag.@"block-size", "block_size", PropertyIdTag.height, Size, logical_supported, dest, context);
        this.flushLogicalHelper(PropertyIdTag.@"min-block-size", "min_block_size", PropertyIdTag.@"min-height", Size, logical_supported, dest, context);
        this.flushLogicalHelper(PropertyIdTag.@"max-block-size", "max_block_size", PropertyIdTag.@"max-height", MaxSize, logical_supported, dest, context);
        this.flushLogicalHelper(PropertyIdTag.@"inline-size", "inline_size", PropertyIdTag.width, Size, logical_supported, dest, context);
        this.flushLogicalHelper(PropertyIdTag.@"min-inline-size", "min_inline_size", PropertyIdTag.@"min-width", Size, logical_supported, dest, context);
        this.flushLogicalHelper(PropertyIdTag.@"max-inline-size", "max_inline_size", PropertyIdTag.@"max-width", MaxSize, logical_supported, dest, context);
    }

    pub fn finalize(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        this.flush(dest, context);
        this.flushed_properties = SizeProperty{};
    }

    inline fn flushPrefixHelper(
        this: *@This(),
        comptime property: PropertyIdTag,
        comptime SizeType: type,
        comptime feature: css.prefixes.Feature,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) void {
        if (!@field(this.flushed_properties, @tagName(property))) {
            const prefixes = context.targets.prefixes(css.VendorPrefix{ .none = true }, feature).difference(css.VendorPrefix{ .none = true });
            inline for (css.VendorPrefix.FIELDS) |field| {
                if (@field(prefixes, field)) {
                    var prefix: css.VendorPrefix = .{};
                    @field(prefix, field) = true;
                    dest.append(
                        context.allocator,
                        @unionInit(
                            Property,
                            @tagName(property),
                            @unionInit(SizeType, @tagName(feature), prefix),
                        ),
                    ) catch |err| bun.handleOom(err);
                }
            }
        }
    }

    inline fn flushPropertyHelper(
        this: *@This(),
        comptime property: PropertyIdTag,
        comptime field: []const u8,
        comptime SizeType: type,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) void {
        if (bun.take(&@field(this, field))) |val| {
            switch (val) {
                .stretch => |vp| if (vp == css.VendorPrefix{ .none = true }) {
                    this.flushPrefixHelper(property, SizeType, .stretch, dest, context);
                },
                .min_content => |vp| if (vp == css.VendorPrefix{ .none = true }) {
                    this.flushPrefixHelper(property, SizeType, .min_content, dest, context);
                },
                .max_content => |vp| if (vp == css.VendorPrefix{ .none = true }) {
                    this.flushPrefixHelper(property, SizeType, .max_content, dest, context);
                },
                .fit_content => |vp| if (vp == css.VendorPrefix{ .none = true }) {
                    this.flushPrefixHelper(property, SizeType, .fit_content, dest, context);
                },
                else => {},
            }
            bun.handleOom(dest.append(context.allocator, @unionInit(Property, @tagName(property), val.deepClone(context.allocator))));
            @field(this.flushed_properties, @tagName(property)) = true;
        }
    }

    inline fn flushLogicalHelper(
        this: *@This(),
        comptime property: PropertyIdTag,
        comptime field: []const u8,
        comptime physical: PropertyIdTag,
        comptime SizeType: type,
        logical_supported: bool,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) void {
        if (logical_supported) {
            this.flushPropertyHelper(property, field, SizeType, dest, context);
        } else {
            this.flushPropertyHelper(physical, field, SizeType, dest, context);
        }
    }
};

const bun = @import("bun");
const std = @import("std");
const Allocator = std.mem.Allocator;
