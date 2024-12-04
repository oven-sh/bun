const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Result = css.Result;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Calc = css.css_values.calc.Calc;
const DimensionPercentage = css.css_values.percentage.DimensionPercentage;
const LengthPercentage = css.css_values.length.LengthPercentage;
const Length = css.css_values.length.Length;
const Percentage = css.css_values.percentage.Percentage;
const CssColor = css.css_values.color.CssColor;
const Image = css.css_values.image.Image;
const Url = css.css_values.url.Url;
const CSSInteger = css.css_values.number.CSSInteger;
const CSSIntegerFns = css.css_values.number.CSSIntegerFns;
const Angle = css.css_values.angle.Angle;
const Time = css.css_values.time.Time;
const Resolution = css.css_values.resolution.Resolution;
const CustomIdent = css.css_values.ident.CustomIdent;
const CustomIdentFns = css.css_values.ident.CustomIdentFns;
const Ident = css.css_values.ident.Ident;

/// A CSS [`<ratio>`](https://www.w3.org/TR/css-values-4/#ratios) value,
/// representing the ratio of two numeric values.
pub const Ratio = struct {
    numerator: CSSNumber,
    denominator: CSSNumber,

    pub fn parse(input: *css.Parser) Result(Ratio) {
        const first = switch (CSSNumberFns.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        const second = if (input.tryParse(css.Parser.expectDelim, .{'/'}).isOk()) switch (CSSNumberFns.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        } else 1.0;

        return .{ .result = Ratio{ .numerator = first, .denominator = second } };
    }

    /// Parses a ratio where both operands are required.
    pub fn parseRequired(input: *css.Parser) Result(Ratio) {
        const first = switch (CSSNumberFns.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        if (input.expectDelim('/').asErr()) |e| return .{ .err = e };
        const second = switch (CSSNumberFns.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = Ratio{ .numerator = first, .denominator = second } };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        try CSSNumberFns.toCss(&this.numerator, W, dest);
        if (this.denominator != 1.0) {
            try dest.delim('/', true);
            try CSSNumberFns.toCss(&this.denominator, W, dest);
        }
    }

    pub fn addF32(this: Ratio, _: std.mem.Allocator, other: f32) Ratio {
        return .{ .numerator = this.numerator + other, .denominator = this.denominator };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};
