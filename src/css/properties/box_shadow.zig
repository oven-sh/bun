const std = @import("std");
const bun = @import("bun");
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

const CssColor = css.css_values.color.CssColor;
const Length = css.css_values.length.Length;

const VendorPrefix = css.VendorPrefix;
const Property = css.Property;
const Feature = css.prefixes.Feature;

/// A value for the [box-shadow](https://drafts.csswg.org/css-backgrounds/#box-shadow) property.
pub const BoxShadow = struct {
    /// The color of the box shadow.
    color: CssColor,
    /// The x offset of the shadow.
    x_offset: Length,
    /// The y offset of the shadow.
    y_offset: Length,
    /// The blur radius of the shadow.
    blur: Length,
    /// The spread distance of the shadow.
    spread: Length,
    /// Whether the shadow is inset within the box.
    inset: bool,

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        var color: ?CssColor = null;
        const Lengths = struct { x: Length, y: Length, blur: Length, spread: Length };
        var lengths: ?Lengths = null;
        var inset = false;

        while (true) {
            if (!inset) {
                if (input.tryParse(css.Parser.expectIdentMatching, .{"inset"}).isOk()) {
                    inset = true;
                    continue;
                }
            }

            if (lengths == null) {
                const value = input.tryParse(struct {
                    fn parse(p: *css.Parser) css.Result(Lengths) {
                        const horizontal = switch (Length.parse(p)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        const vertical = switch (Length.parse(p)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        const blur = p.tryParse(Length.parse, .{}).asValue() orelse Length.zero();
                        const spread = p.tryParse(Length.parse, .{}).asValue() orelse Length.zero();
                        return .{ .result = .{ .x = horizontal, .y = vertical, .blur = blur, .spread = spread } };
                    }
                }.parse, .{});

                if (value.isOk()) {
                    lengths = value.result;
                    continue;
                }
            }

            if (color == null) {
                if (input.tryParse(CssColor.parse, .{}).asValue()) |c| {
                    color = c;
                    continue;
                }
            }

            break;
        }

        const final_lengths = lengths orelse return .{ .err = input.newError(.qualified_rule_invalid) };
        return .{ .result = BoxShadow{
            .color = color orelse CssColor{ .current_color = {} },
            .x_offset = final_lengths.x,
            .y_offset = final_lengths.y,
            .blur = final_lengths.blur,
            .spread = final_lengths.spread,
            .inset = inset,
        } };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        if (this.inset) {
            try dest.writeStr("inset ");
        }

        try this.x_offset.toCss(W, dest);
        try dest.writeChar(' ');
        try this.y_offset.toCss(W, dest);

        if (!this.blur.eql(&Length.zero()) or !this.spread.eql(&Length.zero())) {
            try dest.writeChar(' ');
            try this.blur.toCss(W, dest);

            if (!this.spread.eql(&Length.zero())) {
                try dest.writeChar(' ');
                try this.spread.toCss(W, dest);
            }
        }

        if (!this.color.eql(&CssColor{ .current_color = {} })) {
            try dest.writeChar(' ');
            try this.color.toCss(W, dest);
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn isCompatible(this: *const @This(), browsers: css.targets.Browsers) bool {
        return this.color.isCompatible(browsers) and
            this.x_offset.isCompatible(browsers) and
            this.y_offset.isCompatible(browsers) and
            this.blur.isCompatible(browsers) and
            this.spread.isCompatible(browsers);
    }
};

pub const BoxShadowHandler = struct {
    box_shadows: ?struct { SmallList(BoxShadow, 1), VendorPrefix } = null,
    flushed: bool = false,

    pub fn handleProperty(this: *@This(), property: *const Property, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) bool {
        switch (property.*) {
            .@"box-shadow" => |*b| {
                const box_shadows: *const SmallList(BoxShadow, 1) = &b.*[0];
                const prefix: VendorPrefix = b.*[1];
                if (this.box_shadows != null and context.targets.browsers != null and !box_shadows.isCompatible(context.targets.browsers.?)) {
                    this.flush(dest, context);
                }

                if (this.box_shadows) |*bxs| {
                    const val: *SmallList(BoxShadow, 1) = &bxs.*[0];
                    const prefixes: *VendorPrefix = &bxs.*[1];
                    if (!val.eql(box_shadows) and !bun.bits.contains(VendorPrefix, prefixes.*, prefix)) {
                        this.flush(dest, context);
                        this.box_shadows = .{
                            box_shadows.deepClone(context.allocator),
                            prefix,
                        };
                    } else {
                        val.* = box_shadows.deepClone(context.allocator);
                        bun.bits.insert(VendorPrefix, prefixes, prefix);
                    }
                } else {
                    this.box_shadows = .{
                        box_shadows.deepClone(context.allocator),
                        prefix,
                    };
                }
            },
            .unparsed => |unp| {
                if (unp.property_id == .@"box-shadow") {
                    this.flush(dest, context);

                    var unparsed = unp.deepClone(context.allocator);
                    context.addUnparsedFallbacks(&unparsed);
                    dest.append(context.allocator, .{ .unparsed = unparsed }) catch bun.outOfMemory();
                    this.flushed = true;
                } else return false;
            },
            else => return false,
        }

        return true;
    }

    pub fn finalize(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        this.flush(dest, context);
        this.flushed = false;
    }

    pub fn flush(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (this.box_shadows == null) return;

        const box_shadows: SmallList(BoxShadow, 1), const prefixes2: VendorPrefix = bun.take(&this.box_shadows) orelse {
            this.flushed = true;
            return;
        };

        if (!this.flushed) {
            const ColorFallbackKind = css.ColorFallbackKind;
            var prefixes = context.targets.prefixes(prefixes2, Feature.box_shadow);
            var fallbacks = ColorFallbackKind{};
            for (box_shadows.slice()) |*shadow| {
                bun.bits.insert(ColorFallbackKind, &fallbacks, shadow.color.getNecessaryFallbacks(context.targets));
            }

            if (fallbacks.rgb) {
                var rgb = SmallList(BoxShadow, 1).initCapacity(context.allocator, box_shadows.len());
                rgb.setLen(box_shadows.len());
                for (box_shadows.slice(), rgb.slice_mut()) |*input, *output| {
                    output.color = input.color.toRGB(context.allocator) orelse input.color.deepClone(context.allocator);
                    const fields = std.meta.fields(BoxShadow);
                    inline for (fields) |field| {
                        if (comptime std.mem.eql(u8, field.name, "color")) continue;
                        @field(output, field.name) = css.generic.deepClone(field.type, &@field(input, field.name), context.allocator);
                    }
                }

                dest.append(context.allocator, .{ .@"box-shadow" = .{ rgb, prefixes } }) catch bun.outOfMemory();
                if (prefixes.none) {
                    prefixes = VendorPrefix.NONE;
                } else {
                    // Only output RGB for prefixed property (e.g. -webkit-box-shadow)
                    return;
                }
            }

            if (fallbacks.p3) {
                var p3 = SmallList(BoxShadow, 1).initCapacity(context.allocator, box_shadows.len());
                p3.setLen(box_shadows.len());
                for (box_shadows.slice(), p3.slice_mut()) |*input, *output| {
                    output.color = input.color.toP3(context.allocator) orelse input.color.deepClone(context.allocator);
                    const fields = std.meta.fields(BoxShadow);
                    inline for (fields) |field| {
                        if (comptime std.mem.eql(u8, field.name, "color")) continue;
                        @field(output, field.name) = css.generic.deepClone(field.type, &@field(input, field.name), context.allocator);
                    }
                }
                dest.append(context.allocator, .{ .@"box-shadow" = .{ p3, VendorPrefix.NONE } }) catch bun.outOfMemory();
            }

            if (fallbacks.lab) {
                var lab = SmallList(BoxShadow, 1).initCapacity(context.allocator, box_shadows.len());
                lab.setLen(box_shadows.len());
                for (box_shadows.slice(), lab.slice_mut()) |*input, *output| {
                    output.color = input.color.toLAB(context.allocator) orelse input.color.deepClone(context.allocator);
                    const fields = std.meta.fields(BoxShadow);
                    inline for (fields) |field| {
                        if (comptime std.mem.eql(u8, field.name, "color")) continue;
                        @field(output, field.name) = css.generic.deepClone(field.type, &@field(input, field.name), context.allocator);
                    }
                }
                dest.append(context.allocator, .{ .@"box-shadow" = .{ lab, VendorPrefix.NONE } }) catch bun.outOfMemory();
            } else {
                dest.append(context.allocator, .{ .@"box-shadow" = .{ box_shadows, prefixes } }) catch bun.outOfMemory();
            }
        } else {
            dest.append(context.allocator, .{ .@"box-shadow" = .{ box_shadows, prefixes2 } }) catch bun.outOfMemory();
        }

        this.flushed = true;
    }
};
