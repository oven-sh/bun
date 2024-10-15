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
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;

/// A CSS [`<alpha-value>`](https://www.w3.org/TR/css-color-4/#typedef-alpha-value),
/// used to represent opacity.
///
/// Parses either a `<number>` or `<percentage>`, but is always stored and serialized as a number.
pub const AlphaValue = struct {
    v: f32,

    pub fn parse(input: *css.Parser) Result(AlphaValue) {
        // For some reason NumberOrPercentage.parse makes zls crash, using this instead.
        const val: NumberOrPercentage = switch (@call(.auto, @field(NumberOrPercentage, "parse"), .{input})) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const final = switch (val) {
            .percentage => |percent| AlphaValue{ .v = percent.v },
            .number => |num| AlphaValue{ .v = num },
        };
        return .{ .result = final };
    }

    pub fn toCss(this: *const AlphaValue, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        return CSSNumberFns.toCss(&this.v, W, dest);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};
