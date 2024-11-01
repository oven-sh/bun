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

const GenericBorder = css.css_properties.border.GenericBorder;
const LineStyle = css.css_properties.border.LineStyle;

/// A value for the [position](https://www.w3.org/TR/css-position-3/#position-property) property.
pub const Position = union(enum) {
    /// The box is laid in the document flow.
    static,
    /// The box is laid out in the document flow and offset from the resulting position.
    relative,
    /// The box is taken out of document flow and positioned in reference to its relative ancestor.
    absolute,
    /// Similar to relative but adjusted according to the ancestor scrollable element.
    sticky: css.VendorPrefix,
    /// The box is taken out of the document flow and positioned in reference to the page viewport.
    fixed,

    pub fn parse(input: *css.Parser) css.Result(Position) {
        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };

        const PositionKeyword = enum {
            static,
            relative,
            absolute,
            fixed,
            sticky,
            @"-webkit-sticky",
        };

        const keyword_map = bun.ComptimeStringMap(PositionKeyword, .{
            .{ "static", .static },
            .{ "relative", .relative },
            .{ "absolute", .absolute },
            .{ "fixed", .fixed },
            .{ "sticky", .sticky },
            .{ "-webkit-sticky", .@"-webkit-sticky" },
        });

        const keyword = keyword_map.get(ident) orelse {
            return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
        };

        return .{ .result = switch (keyword) {
            .static => .static,
            .relative => .relative,
            .absolute => .absolute,
            .fixed => .fixed,
            .sticky => .{ .sticky = css.VendorPrefix{ .none = true } },
            .@"-webkit-sticky" => .{ .sticky = css.VendorPrefix{ .webkit = true } },
        } };
    }

    pub fn toCss(this: *const Position, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        return switch (this.*) {
            .static => dest.writeStr("static"),
            .relative => dest.writeStr("relative"),
            .absolute => dest.writeStr("absolute"),
            .fixed => dest.writeStr("fixed"),
            .sticky => |prefix| {
                try prefix.toCss(W, dest);
                return dest.writeStr("sticky");
            },
        };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};
