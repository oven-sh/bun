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
const Property = css.Property;
const PropertyId = css.PropertyId;
const VendorPrefix = css.VendorPrefix;
const PropertyIdTag = css.PropertyIdTag;

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

pub const BorderRadiusHandler = struct {
    top_left: ?struct { Size2D(LengthPercentage), css.VendorPrefix } = null,
    top_right: ?struct { Size2D(LengthPercentage), css.VendorPrefix } = null,
    bottom_right: ?struct { Size2D(LengthPercentage), css.VendorPrefix } = null,
    bottom_left: ?struct { Size2D(LengthPercentage), css.VendorPrefix } = null,
    start_start: ?css.Property = null,
    start_end: ?css.Property = null,
    end_end: ?css.Property = null,
    end_start: ?css.Property = null,
    category: css.PropertyCategory = .physical,
    has_any: bool = false,

    pub fn handleProperty(this: *@This(), property: *const css.Property, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) bool {
        switch (property.*) {
            .@"border-top-left-radius" => |val| propertyHelper(this, dest, context, "top_left", &val[0], val[1]),
            .@"border-top-right-radius" => |val| propertyHelper(this, dest, context, "top_right", &val[0], val[1]),
            .@"border-bottom-right-radius" => |val| propertyHelper(this, dest, context, "bottom_right", &val[0], val[1]),
            .@"border-bottom-left-radius" => |val| propertyHelper(this, dest, context, "bottom_left", &val[0], val[1]),
            .@"border-start-start-radius" => logicalPropertyHelper(this, dest, context, "start_start", property),
            .@"border-start-end-radius" => logicalPropertyHelper(this, dest, context, "start_end", property),
            .@"border-end-end-radius" => logicalPropertyHelper(this, dest, context, "end_end", property),
            .@"border-end-start-radius" => logicalPropertyHelper(this, dest, context, "end_start", property),
            .@"border-radius" => |val| {
                this.start_start = null;
                this.start_end = null;
                this.end_end = null;
                this.end_start = null;

                maybeFlush(this, dest, context, "top_left", &val[0].top_left, val[1]);
                maybeFlush(this, dest, context, "top_right", &val[0].top_right, val[1]);
                maybeFlush(this, dest, context, "bottom_right", &val[0].bottom_right, val[1]);
                maybeFlush(this, dest, context, "bottom_left", &val[0].bottom_left, val[1]);

                propertyHelper(this, dest, context, "top_left", &val[0].top_left, val[1]);
                propertyHelper(this, dest, context, "top_right", &val[0].top_right, val[1]);
                propertyHelper(this, dest, context, "bottom_right", &val[0].bottom_right, val[1]);
                propertyHelper(this, dest, context, "bottom_left", &val[0].bottom_left, val[1]);
            },
            .unparsed => |unparsed| {
                if (isBorderRadiusProperty(unparsed.property_id)) {
                    // Even if we weren't able to parse the value (e.g. due to var() references),
                    // we can still add vendor prefixes to the property itself.
                    switch (unparsed.property_id) {
                        .@"border-start-start-radius" => logicalPropertyHelper(this, dest, context, "start_start", property),
                        .@"border-start-end-radius" => logicalPropertyHelper(this, dest, context, "start_end", property),
                        .@"border-end-end-radius" => logicalPropertyHelper(this, dest, context, "end_end", property),
                        .@"border-end-start-radius" => logicalPropertyHelper(this, dest, context, "end_start", property),
                        else => {
                            this.flush(dest, context);
                            dest.append(context.allocator, Property{ .unparsed = unparsed.getPrefixed(context.allocator, context.targets, css.prefixes.Feature.border_radius) }) catch bun.outOfMemory();
                        },
                    }
                } else return false;
            },
            else => return false,
        }

        return true;
    }

    pub fn finalize(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        this.flush(dest, context);
    }

    fn flush(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (!this.has_any) return;

        this.has_any = false;

        var top_left = bun.take(&this.top_left);
        var top_right = bun.take(&this.top_right);
        var bottom_right = bun.take(&this.bottom_right);
        var bottom_left = bun.take(&this.bottom_left);
        const start_start = bun.take(&this.start_start);
        const start_end = bun.take(&this.start_end);
        const end_end = bun.take(&this.end_end);
        const end_start = bun.take(&this.end_start);

        if (top_left != null and top_right != null and bottom_right != null and bottom_left != null) {
            const intersection = top_left.?[1].bitwiseAnd(top_right.?[1]).bitwiseAnd(bottom_right.?[1]).bitwiseAnd(bottom_left.?[1]);
            if (!intersection.isEmpty()) {
                const prefix = context.targets.prefixes(intersection, css.prefixes.Feature.border_radius);
                dest.append(context.allocator, Property{ .@"border-radius" = .{
                    BorderRadius{
                        .top_left = top_left.?[0].deepClone(context.allocator),
                        .top_right = top_right.?[0].deepClone(context.allocator),
                        .bottom_right = bottom_right.?[0].deepClone(context.allocator),
                        .bottom_left = bottom_left.?[0].deepClone(context.allocator),
                    },
                    prefix,
                } }) catch bun.outOfMemory();
                top_left.?[1].remove(intersection);
                top_right.?[1].remove(intersection);
                bottom_right.?[1].remove(intersection);
                bottom_left.?[1].remove(intersection);
            }
        }

        const logical_supported = !context.shouldCompileLogical(.logical_border_radius);

        singleProperty(dest, context, "border-top-left-radius", top_left);
        singleProperty(dest, context, "border-top-right-radius", top_right);
        singleProperty(dest, context, "border-bottom-right-radius", bottom_right);
        singleProperty(dest, context, "border-bottom-left-radius", bottom_left);

        logicalProperty(dest, context, start_start, "border-top-left-radius", "border-top-right-radius", logical_supported);
        logicalProperty(dest, context, start_end, "border-top-right-radius", "border-top-left-radius", logical_supported);
        logicalProperty(dest, context, end_end, "border-bottom-right-radius", "border-bottom-left-radius", logical_supported);
        logicalProperty(dest, context, end_start, "border-bottom-left-radius", "border-bottom-right-radius", logical_supported);
    }

    fn singleProperty(d: *css.DeclarationList, ctx: *css.PropertyHandlerContext, comptime prop: []const u8, val: ?struct { Size2D(LengthPercentage), css.VendorPrefix }) void {
        if (val) |v| {
            if (!v[1].isEmpty()) {
                const prefix = ctx.targets.prefixes(v[1], css.prefixes.Feature.border_radius);
                d.append(ctx.allocator, @unionInit(css.Property, prop, .{ v[0], prefix })) catch bun.outOfMemory();
            }
        }
    }

    fn logicalProperty(d: *css.DeclarationList, ctx: *css.PropertyHandlerContext, val: ?css.Property, comptime ltr: []const u8, comptime rtl: []const u8, logical_supported: bool) void {
        if (val) |v| {
            if (logical_supported) {
                d.append(ctx.allocator, v) catch bun.outOfMemory();
            } else {
                const prefix = ctx.targets.prefixes(css.VendorPrefix.empty(), css.prefixes.Feature.border_radius);
                switch (v) {
                    .@"border-start-start-radius",
                    .@"border-start-end-radius",
                    .@"border-end-end-radius",
                    .@"border-end-start-radius",
                    => |radius| {
                        ctx.addLogicalRule(
                            ctx.allocator,
                            @unionInit(css.Property, ltr, .{ radius, prefix }),
                            @unionInit(css.Property, rtl, .{ radius, prefix }),
                        );
                    },
                    .unparsed => |unparsed| {
                        ctx.addLogicalRule(
                            ctx.allocator,
                            Property{ .unparsed = unparsed.withPropertyId(ctx.allocator, .{ .@"border-top-left-radius" = prefix }) },
                            Property{ .unparsed = unparsed.withPropertyId(ctx.allocator, .{ .@"border-top-right-radius" = prefix }) },
                        );
                    },
                    else => {},
                }
            }
        }
    }

    fn maybeFlush(self: *BorderRadiusHandler, d: *css.DeclarationList, ctx: *css.PropertyHandlerContext, comptime prop: []const u8, val: anytype, vp: css.VendorPrefix) void {
        // If two vendor prefixes for the same property have different
        // values, we need to flush what we have immediately to preserve order.
        if (@field(self, prop)) |*existing| {
            if (!existing.*[0].eql(val) and !existing.*[1].contains(vp)) {
                self.flush(d, ctx);
            }
        }

        if (@field(self, prop) != null and ctx.targets.browsers != null and !css.generic.isCompatible(Size2D(LengthPercentage), val, ctx.targets.browsers.?)) {
            self.flush(d, ctx);
        }
    }

    fn propertyHelper(self: *BorderRadiusHandler, d: *css.DeclarationList, ctx: *css.PropertyHandlerContext, comptime prop: []const u8, val: *const Size2D(LengthPercentage), vp: css.VendorPrefix) void {
        if (self.category != .physical) {
            self.flush(d, ctx);
        }

        maybeFlush(self, d, ctx, prop, val, vp);

        // Otherwise, update the value and add the prefix.
        if (@field(self, prop)) |*existing| {
            existing.* = .{ val.deepClone(ctx.allocator), vp };
        } else {
            @field(self, prop) = .{ val.deepClone(ctx.allocator), vp };
            self.has_any = true;
        }

        self.category = .physical;
    }

    fn logicalPropertyHelper(self: *BorderRadiusHandler, d: *css.DeclarationList, ctx: *css.PropertyHandlerContext, comptime prop: []const u8, val: *const css.Property) void {
        if (self.category != .logical) {
            self.flush(d, ctx);
        }

        @field(self, prop) = val.deepClone(ctx.allocator);
        self.category = .logical;
        self.has_any = true;
    }
};

pub fn isBorderRadiusProperty(property_id: PropertyIdTag) bool {
    if (isLogicalBorderRadiusProperty(property_id)) {
        return true;
    }

    return switch (property_id) {
        .@"border-top-left-radius",
        .@"border-top-right-radius",
        .@"border-bottom-right-radius",
        .@"border-bottom-left-radius",
        .@"border-radius",
        => true,
        else => false,
    };
}

pub fn isLogicalBorderRadiusProperty(property_id: PropertyIdTag) bool {
    return switch (property_id) {
        .@"border-start-start-radius",
        .@"border-start-end-radius",
        .@"border-end-end-radius",
        .@"border-end-start-radius",
        => true,
        else => false,
    };
}
