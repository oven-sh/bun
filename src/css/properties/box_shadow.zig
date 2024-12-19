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
};
