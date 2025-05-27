const std = @import("std");
pub const css = @import("../css_parser.zig");
const Result = css.Result;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;

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
