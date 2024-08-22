const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Calc = css.css_values.calc.Calc;
const DimensionPercentage = css.css_values.percentage.DimensionPercentage;

/// Either a [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) or a [`<number>`](https://www.w3.org/TR/css-values-4/#numbers).
pub const LengthOrNumber = union(enum) {
    /// A number.
    number: CSSNumber,
    /// A length.
    length: Length,
};

pub const LengthPercentage = DimensionPercentage(LengthValue);
/// Either a [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage), or the `auto` keyword.
pub const LengthPercentageOrAuto = union(enum) {
    /// The `auto` keyword.
    auto,
    /// A [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage).
    length: LengthPercentage,
};

pub const LengthValue = struct {
    pub usingnamespace css.DefineLengthUnits(@This());

    pub fn tryFromToken(token: *const css.Token) Error!@This() {
        _ = token; // autofix
        @compileError(css.todo_stuff.depth);
    }

    pub fn toUnitValue(this: *const @This()) struct { CSSNumber, []const u8 } {
        _ = this; // autofix
        @compileError(css.todo_stuff.depth);
    }
};

/// A CSS [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) value, with support for `calc()`.
pub const Length = union(enum) {
    /// An explicitly specified length value.
    value: LengthValue,
    /// A computed length value using `calc()`.
    calc: *Calc(Length),

    pub fn parse(input: *css.Parser) Error!Length {
        if (input.tryParse(Calc(Length).parse, .{})) |calc_value| {
            // PERF: I don't like this redundant allocation
            if (calc_value == .value) return .{ .calc = calc_value.value.* };
            return .{
                .calc = bun.create(
                    @compileError(css.todo_stuff.think_about_allocator),
                    Calc(Length),
                    calc_value,
                ),
            };
        }

        const len = try LengthValue.parse(input);
        return .{ .value = len };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(css.todo_stuff.depth);
    }
};
