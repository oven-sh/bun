pub const css = @import("../css_parser.zig");
const Result = css.Result;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
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

    pub fn toCss(this: *const AlphaValue, dest: *css.Printer) css.PrintErr!void {
        return CSSNumberFns.toCss(&this.v, dest);
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

const std = @import("std");
