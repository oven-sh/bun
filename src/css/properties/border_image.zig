pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

const LengthPercentage = css.css_values.length.LengthPercentage;
const CSSNumber = css.css_values.number.CSSNumber;
const LengthOrNumber = css.css_values.length.LengthOrNumber;
const Image = css.css_values.image.Image;
const Rect = css.css_values.rect.Rect;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;
const Percentage = css.css_values.percentage.Percentage;
const Property = css.Property;
const VendorPrefix = css.VendorPrefix;

/// A value for the [border-image](https://www.w3.org/TR/css-backgrounds-3/#border-image) shorthand property.
pub const BorderImage = struct {
    /// The border image.
    source: Image,
    /// The offsets that define where the image is sliced.
    slice: BorderImageSlice,
    /// The width of the border image.
    width: Rect(BorderImageSideWidth),
    /// The amount that the image extends beyond the border box.
    outset: Rect(css.css_values.length.LengthOrNumber),
    /// How the border image is scaled and tiled.
    repeat: BorderImageRepeat,

    pub const PropertyFieldMap = .{
        .source = css.PropertyIdTag.@"border-image-source",
        .slice = css.PropertyIdTag.@"border-image-slice",
        .width = css.PropertyIdTag.@"border-image-width",
        .outset = css.PropertyIdTag.@"border-image-outset",
        .repeat = css.PropertyIdTag.@"border-image-repeat",
    };

    pub const VendorPrefixMap = .{
        .source = true,
        .slice = true,
        .width = true,
        .outset = true,
        .repeat = true,
    };

    pub fn parse(input: *css.Parser) css.Result(BorderImage) {
        return parseWithCallback(input, {}, struct {
            pub fn cb(_: void, _: *css.Parser) bool {
                return false;
            }
        }.cb);
    }

    pub fn parseWithCallback(input: *css.Parser, ctx: anytype, comptime callback: anytype) css.Result(BorderImage) {
        var source: ?Image = null;
        var slice: ?BorderImageSlice = null;
        var width: ?Rect(BorderImageSideWidth) = null;
        var outset: ?Rect(LengthOrNumber) = null;
        var repeat: ?BorderImageRepeat = null;

        while (true) {
            if (slice == null) {
                if (input.tryParse(BorderImageSlice.parse, .{}).asValue()) |value| {
                    slice = value;
                    // Parse border image width and outset, if applicable.
                    const maybe_width_outset = input.tryParse(struct {
                        pub fn parse(i: *css.Parser) css.Result(struct { ?Rect(BorderImageSideWidth), ?Rect(LengthOrNumber) }) {
                            if (i.expectDelim('/').asErr()) |e| return .{ .err = e };

                            const w = i.tryParse(Rect(BorderImageSideWidth).parse, .{}).asValue();

                            const o = i.tryParse(struct {
                                pub fn parseFn(in: *css.Parser) css.Result(Rect(LengthOrNumber)) {
                                    if (in.expectDelim('/').asErr()) |e| return .{ .err = e };
                                    return Rect(LengthOrNumber).parse(in);
                                }
                            }.parseFn, .{}).asValue();

                            if (w == null and o == null) return .{ .err = i.newCustomError(css.ParserError.invalid_declaration) };
                            return .{ .result = .{ w, o } };
                        }
                    }.parse, .{});

                    if (maybe_width_outset.asValue()) |val| {
                        width = val[0];
                        outset = val[1];
                    }
                    continue;
                }
            }

            if (source == null) {
                if (input.tryParse(Image.parse, .{}).asValue()) |value| {
                    source = value;
                    continue;
                }
            }

            if (repeat == null) {
                if (input.tryParse(BorderImageRepeat.parse, .{}).asValue()) |value| {
                    repeat = value;
                    continue;
                }
            }

            if (@call(.auto, callback, .{ ctx, input })) {
                continue;
            }

            break;
        }

        if (source != null or slice != null or width != null or outset != null or repeat != null) {
            return .{
                .result = BorderImage{
                    .source = source orelse Image.default(),
                    .slice = slice orelse BorderImageSlice.default(),
                    .width = width orelse Rect(BorderImageSideWidth).all(BorderImageSideWidth.default()),
                    .outset = outset orelse Rect(LengthOrNumber).all(LengthOrNumber.default()),
                    .repeat = repeat orelse BorderImageRepeat.default(),
                },
            };
        }
        return .{ .err = input.newCustomError(css.ParserError.invalid_declaration) };
    }

    pub fn toCss(this: *const BorderImage, dest: *css.Printer) PrintErr!void {
        return toCssInternal(&this.source, &this.slice, &this.width, &this.outset, &this.repeat, dest);
    }

    pub fn toCssInternal(
        source: *const Image,
        slice: *const BorderImageSlice,
        width: *const Rect(BorderImageSideWidth),
        outset: *const Rect(LengthOrNumber),
        repeat: *const BorderImageRepeat,
        dest: *css.Printer,
    ) PrintErr!void {
        if (!css.generic.eql(Image, source, &Image.default())) {
            try source.toCss(dest);
        }
        const has_slice = !css.generic.eql(BorderImageSlice, slice, &BorderImageSlice.default());
        const has_width = !css.generic.eql(Rect(BorderImageSideWidth), width, &Rect(BorderImageSideWidth).all(BorderImageSideWidth.default()));
        const has_outset = !css.generic.eql(Rect(LengthOrNumber), outset, &Rect(LengthOrNumber).all(LengthOrNumber{ .number = 0.0 }));
        if (has_slice or has_width or has_outset) {
            try dest.writeStr(" ");
            try slice.toCss(dest);
            if (has_width or has_outset) {
                try dest.delim('/', true);
            }
            if (has_width) {
                try width.toCss(dest);
            }

            if (has_outset) {
                try dest.delim('/', true);
                try outset.toCss(dest);
            }
        }

        if (!css.generic.eql(BorderImageRepeat, repeat, &BorderImageRepeat.default())) {
            try dest.writeStr(" ");
            return repeat.toCss(dest);
        }

        return;
    }

    pub fn getFallbacks(this: *@This(), allocator: Allocator, targets: css.targets.Targets) css.SmallList(BorderImage, 6) {
        var fallbacks = this.source.getFallbacks(allocator, targets);
        defer fallbacks.deinit(allocator);
        var res = css.SmallList(BorderImage, 6).initCapacity(allocator, fallbacks.len());
        res.setLen(fallbacks.len());
        for (fallbacks.slice(), res.slice_mut()) |fallback, *out| {
            out.* = this.deepClone(allocator);
            out.source = fallback;
        }

        return res;
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const BorderImage, other: *const BorderImage) bool {
        return this.source.eql(&other.source) and
            this.slice.eql(&other.slice) and
            this.width.eql(&other.width) and
            this.outset.eql(&other.outset) and
            this.repeat.eql(&other.repeat);
    }

    pub fn default() BorderImage {
        return BorderImage{
            .source = Image.default(),
            .slice = BorderImageSlice.default(),
            .width = Rect(BorderImageSideWidth).all(BorderImageSideWidth.default()),
            .outset = Rect(LengthOrNumber).all(LengthOrNumber.default()),
            .repeat = BorderImageRepeat.default(),
        };
    }
};

/// A value for the [border-image-repeat](https://www.w3.org/TR/css-backgrounds-3/#border-image-repeat) property.
pub const BorderImageRepeat = struct {
    /// The horizontal repeat value.
    horizontal: BorderImageRepeatKeyword,
    /// The vertical repeat value.
    vertical: BorderImageRepeatKeyword,

    pub fn parse(input: *css.Parser) css.Result(BorderImageRepeat) {
        const horizontal = switch (BorderImageRepeatKeyword.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const vertical = input.tryParse(BorderImageRepeatKeyword.parse, .{}).asValue();
        return .{ .result = BorderImageRepeat{
            .horizontal = horizontal,
            .vertical = vertical orelse horizontal,
        } };
    }

    pub fn toCss(this: *const BorderImageRepeat, dest: *Printer) PrintErr!void {
        try this.horizontal.toCss(dest);
        if (this.horizontal != this.vertical) {
            try dest.writeStr(" ");
            try this.vertical.toCss(dest);
        }
    }

    pub fn isCompatible(this: *const @This(), browsers: css.targets.Browsers) bool {
        return this.horizontal.isCompatible(browsers) and this.vertical.isCompatible(browsers);
    }

    pub fn default() BorderImageRepeat {
        return BorderImageRepeat{
            .horizontal = BorderImageRepeatKeyword.stretch,
            .vertical = BorderImageRepeatKeyword.stretch,
        };
    }

    pub fn eql(this: *const BorderImageRepeat, other: *const BorderImageRepeat) bool {
        return this.horizontal.eql(&other.horizontal) and this.vertical.eql(&other.vertical);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [border-image-width](https://www.w3.org/TR/css-backgrounds-3/#border-image-width) property.
pub const BorderImageSideWidth = union(enum) {
    /// A number representing a multiple of the border width.
    number: CSSNumber,
    /// An explicit length or percentage.
    length_percentage: LengthPercentage,
    /// The `auto` keyword, representing the natural width of the image slice.
    auto: void,

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub fn deinit(this: *const BorderImageSideWidth, allocator: std.mem.Allocator) void {
        switch (this.*) {
            .length_percentage => |*l| l.deinit(allocator),
            .number => {},
            .auto => {},
        }
    }

    pub fn default() BorderImageSideWidth {
        return .{ .number = 1.0 };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const BorderImageSideWidth, other: *const BorderImageSideWidth) bool {
        return switch (this.*) {
            .number => |*a| switch (other.*) {
                .number => |*b| a.* == b.*,
                else => false,
            },
            .length_percentage => |*a| switch (other.*) {
                .length_percentage => css.generic.eql(LengthPercentage, a, &other.length_percentage),
                else => false,
            },
            .auto => switch (other.*) {
                .auto => true,
                else => false,
            },
        };
    }

    pub fn isCompatible(this: *const @This(), browsers: css.targets.Browsers) bool {
        return switch (this.*) {
            .length_percentage => |*l| l.isCompatible(browsers),
            else => true,
        };
    }
};

/// A single [border-image-repeat](https://www.w3.org/TR/css-backgrounds-3/#border-image-repeat) keyword.
pub const BorderImageRepeatKeyword = enum {
    /// The image is stretched to fill the area.
    stretch,
    /// The image is tiled (repeated) to fill the area.
    repeat,
    /// The image is scaled so that it repeats an even number of times.
    round,
    /// The image is repeated so that it fits, and then spaced apart evenly.
    space,

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;

    pub fn isCompatible(this: *const @This(), browsers: css.targets.Browsers) bool {
        return switch (this.*) {
            .round => css.compat.Feature.border_image_repeat_round.isCompatible(browsers),
            .space => css.compat.Feature.border_image_repeat_space.isCompatible(browsers),
            .stretch, .repeat => true,
        };
    }
};

/// A value for the [border-image-slice](https://www.w3.org/TR/css-backgrounds-3/#border-image-slice) property.
pub const BorderImageSlice = struct {
    /// The offsets from the edges of the image.
    offsets: Rect(NumberOrPercentage),
    /// Whether the middle of the border image should be preserved.
    fill: bool,

    pub fn parse(input: *css.Parser) css.Result(BorderImageSlice) {
        var fill = switch (input.expectIdentMatching("fill")) {
            .err => false,
            .result => true,
        };
        const offsets = switch (Rect(NumberOrPercentage).parse(input)) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (!fill) {
            fill = switch (input.expectIdentMatching("fill")) {
                .err => false,
                .result => true,
            };
        }
        return .{ .result = BorderImageSlice{ .offsets = offsets, .fill = fill } };
    }

    pub fn toCss(this: *const BorderImageSlice, dest: *Printer) PrintErr!void {
        try this.offsets.toCss(dest);
        if (this.fill) {
            try dest.writeStr(" fill");
        }
    }

    pub fn isCompatible(_: *const BorderImageSlice, _: css.targets.Browsers) bool {
        return true;
    }

    pub fn eql(this: *const BorderImageSlice, other: *const BorderImageSlice) bool {
        return this.offsets.eql(&other.offsets) and this.fill == other.fill;
    }

    pub fn default() BorderImageSlice {
        return BorderImageSlice{
            .offsets = Rect(NumberOrPercentage).all(NumberOrPercentage{ .percentage = Percentage{ .v = 1.0 } }),
            .fill = false,
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub const BorderImageProperty = packed struct(u8) {
    source: bool = false,
    slice: bool = false,
    width: bool = false,
    outset: bool = false,
    repeat: bool = false,
    __unused: u3 = 0,

    pub const @"border-image-source" = BorderImageProperty{ .source = true };
    pub const @"border-image-slice" = BorderImageProperty{ .slice = true };
    pub const @"border-image-width" = BorderImageProperty{ .width = true };
    pub const @"border-image-outset" = BorderImageProperty{ .outset = true };
    pub const @"border-image-repeat" = BorderImageProperty{ .repeat = true };

    pub const @"border-image" = BorderImageProperty{
        .source = true,
        .slice = true,
        .width = true,
        .outset = true,
        .repeat = true,
    };

    pub fn isEmpty(this: BorderImageProperty) bool {
        return @as(u8, @bitCast(this)) == 0;
    }

    pub fn tryFromPropertyId(property_id: css.PropertyIdTag) ?BorderImageProperty {
        inline for (std.meta.fields(BorderImageProperty)) |field| {
            if (comptime std.mem.eql(u8, field.name, "__unused")) continue;
            const desired = comptime @field(css.PropertyIdTag, "border-image-" ++ field.name);
            if (desired == property_id) {
                var result: BorderImageProperty = .{};
                @field(result, field.name) = true;
                return result;
            }
        }
        if (property_id == .@"border-image") {
            return BorderImageProperty.@"border-image";
        }
        return null;
    }
};

pub const BorderImageHandler = struct {
    source: ?Image = null,
    slice: ?BorderImageSlice = null,
    width: ?Rect(BorderImageSideWidth) = null,
    outset: ?Rect(LengthOrNumber) = null,
    repeat: ?BorderImageRepeat = null,
    vendor_prefix: css.VendorPrefix = .{},
    flushed_properties: BorderImageProperty = .{},
    has_any: bool = false,

    pub fn handleProperty(this: *@This(), property: *const css.Property, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) bool {
        const allocator = context.allocator;

        const flushHelper = struct {
            inline fn flushHelper(
                self: *BorderImageHandler,
                d: *css.DeclarationList,
                ctx: *css.PropertyHandlerContext,
                comptime name: []const u8,
                val: anytype,
            ) void {
                if (@field(self, name) != null and !@field(self, name).?.eql(val) and ctx.targets.browsers != null and css.generic.isCompatible(@TypeOf(@field(self, name).?), val, ctx.targets.browsers.?)) {
                    self.flush(d, ctx);
                }
            }
        }.flushHelper;

        const propertyHelper = struct {
            inline fn propertyHelper(self: *BorderImageHandler, comptime field: []const u8, comptime T: type, val: *const T, d: *css.DeclarationList, ctx: *css.PropertyHandlerContext) void {
                if (self.vendor_prefix != VendorPrefix{ .none = true }) {
                    self.flush(d, ctx);
                }

                flushHelper(self, d, ctx, field, val);

                self.vendor_prefix = VendorPrefix{ .none = true };
                @field(self, field) = val.deepClone(ctx.allocator);
                self.has_any = true;
            }
        }.propertyHelper;

        switch (property.*) {
            .@"border-image-source" => |*val| propertyHelper(this, "source", Image, val, dest, context),
            .@"border-image-slice" => |*val| propertyHelper(this, "slice", BorderImageSlice, val, dest, context),
            .@"border-image-width" => |*val| propertyHelper(this, "width", Rect(BorderImageSideWidth), val, dest, context),
            .@"border-image-outset" => |*val| propertyHelper(this, "outset", Rect(LengthOrNumber), val, dest, context),
            .@"border-image-repeat" => |*val| propertyHelper(this, "repeat", BorderImageRepeat, val, dest, context),
            .@"border-image" => |_val| {
                const val = &_val[0];
                const vp = _val[1];

                flushHelper(this, dest, context, "source", &val.source);
                flushHelper(this, dest, context, "slice", &val.slice);
                flushHelper(this, dest, context, "width", &val.width);
                flushHelper(this, dest, context, "outset", &val.outset);
                flushHelper(this, dest, context, "repeat", &val.repeat);

                this.source = val.source.deepClone(allocator);
                this.slice = val.slice.deepClone(allocator);
                this.width = val.width.deepClone(allocator);
                this.outset = val.outset.deepClone(allocator);
                this.repeat = val.repeat.deepClone(allocator);
                this.vendor_prefix = bun.bits.@"or"(VendorPrefix, this.vendor_prefix, vp);
                this.has_any = true;
            },
            .unparsed => |unparsed| {
                if (isBorderImageProperty(unparsed.property_id)) {
                    this.flush(dest, context);

                    // Even if we weren't able to parse the value (e.g. due to var() references),
                    // we can still add vendor prefixes to the property itself.
                    var unparsed_clone = if (unparsed.property_id == .@"border-image")
                        unparsed.getPrefixed(allocator, context.targets, css.prefixes.Feature.border_image)
                    else
                        unparsed.deepClone(allocator);

                    context.addUnparsedFallbacks(&unparsed_clone);
                    bun.bits.insert(BorderImageProperty, &this.flushed_properties, BorderImageProperty.tryFromPropertyId(unparsed_clone.property_id).?);
                    bun.handleOom(dest.append(allocator, Property{ .unparsed = unparsed_clone }));
                } else return false;
            },
            else => return false,
        }

        return true;
    }

    pub fn finalize(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        this.flush(dest, context);
        this.flushed_properties = BorderImageProperty{};
    }

    pub fn reset(this: *@This(), allocator: std.mem.Allocator) void {
        if (this.source) |*s| s.deinit(allocator);
        // if (this.slice) |*s| s.deinit(allocator);
        if (this.width) |*w| w.deinit(allocator);
        if (this.outset) |*o| o.deinit(allocator);
        // if (this.repeat) |*r| r.deinit(allocator);
        this.source = null;
        this.slice = null;
        this.width = null;
        this.outset = null;
        this.repeat = null;
    }

    pub fn willFlush(this: *const @This(), property: *const Property) bool {
        return switch (property.*) {
            .@"border-image-source",
            .@"border-image-slice",
            .@"border-image-width",
            .@"border-image-outset",
            .@"border-image-repeat",
            => this.vendor_prefix != VendorPrefix{ .none = true },
            .unparsed => |val| isBorderImageProperty(val.property_id),
            else => false,
        };
    }

    fn flush(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (!this.has_any) return;
        const allocator = context.allocator;

        this.has_any = false;

        var source = bun.take(&this.source);
        const slice = bun.take(&this.slice);
        const width = bun.take(&this.width);
        const outset = bun.take(&this.outset);
        const repeat = bun.take(&this.repeat);

        if (source != null and slice != null and width != null and outset != null and repeat != null) {
            var border_image = BorderImage{
                .source = source.?,
                .slice = slice.?,
                .width = width.?,
                .outset = outset.?,
                .repeat = repeat.?,
            };

            var prefix = this.vendor_prefix;
            if (prefix.none and !border_image.slice.fill) {
                prefix = context.targets.prefixes(this.vendor_prefix, css.prefixes.Feature.border_image);
                if (this.flushed_properties.isEmpty()) {
                    const fallbacks = border_image.getFallbacks(allocator, context.targets).slice();
                    for (fallbacks) |fallback| {
                        // Match prefix of fallback. e.g. -webkit-linear-gradient
                        // can only be used in -webkit-border-image, not -moz-border-image.
                        // However, if border-image is unprefixed, gradients can still be.
                        var p = bun.bits.@"and"(VendorPrefix, fallback.source.getVendorPrefix(), prefix);
                        if (p.isEmpty()) {
                            p = prefix;
                        }
                        bun.handleOom(dest.append(allocator, css.Property{ .@"border-image" = .{ fallback, p } }));
                    }
                }
            }

            const p = bun.bits.@"and"(css.VendorPrefix, border_image.source.getVendorPrefix(), prefix);
            if (!p.isEmpty()) {
                prefix = p;
            }

            bun.handleOom(dest.append(allocator, Property{ .@"border-image" = .{ border_image, prefix } }));
            bun.bits.insert(BorderImageProperty, &this.flushed_properties, BorderImageProperty.@"border-image");
        } else {
            if (source) |*mut_source| {
                if (!bun.bits.contains(BorderImageProperty, this.flushed_properties, BorderImageProperty.@"border-image-source")) {
                    for (mut_source.getFallbacks(allocator, context.targets).slice()) |fallback| {
                        bun.handleOom(dest.append(allocator, Property{ .@"border-image-source" = fallback }));
                    }
                }

                bun.handleOom(dest.append(allocator, Property{ .@"border-image-source" = mut_source.* }));
                bun.bits.insert(BorderImageProperty, &this.flushed_properties, BorderImageProperty.@"border-image-source");
            }

            if (slice) |s| {
                bun.handleOom(dest.append(allocator, Property{ .@"border-image-slice" = s }));
                bun.bits.insert(BorderImageProperty, &this.flushed_properties, BorderImageProperty.@"border-image-slice");
            }

            if (width) |w| {
                bun.handleOom(dest.append(allocator, Property{ .@"border-image-width" = w }));
                bun.bits.insert(BorderImageProperty, &this.flushed_properties, BorderImageProperty.@"border-image-width");
            }

            if (outset) |o| {
                bun.handleOom(dest.append(allocator, Property{ .@"border-image-outset" = o }));
                bun.bits.insert(BorderImageProperty, &this.flushed_properties, BorderImageProperty.@"border-image-outset");
            }

            if (repeat) |r| {
                bun.handleOom(dest.append(allocator, Property{ .@"border-image-repeat" = r }));
                bun.bits.insert(BorderImageProperty, &this.flushed_properties, BorderImageProperty.@"border-image-repeat");
            }
        }

        this.vendor_prefix = VendorPrefix{};
    }
};

pub fn isBorderImageProperty(property_id: css.PropertyId) bool {
    return switch (property_id) {
        .@"border-image-source", .@"border-image-slice", .@"border-image-width", .@"border-image-outset", .@"border-image-repeat", .@"border-image" => true,
        else => false,
    };
}

const bun = @import("bun");
const std = @import("std");
const Allocator = std.mem.Allocator;
