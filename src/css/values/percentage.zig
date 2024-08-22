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

pub const Percentage = struct {
    v: CSSNumber,

    pub fn parse(input: *css.Parser) Error!Percentage {
        if (input.tryParse(Calc(Percentage), .{})) |calc_value| {
            if (calc_value == .value) |v| return v.*;
            // Percentages are always compatible, so they will always compute to a value.
            bun.unreachablePanic("Percentages are always compatible, so they will always compute to a value.", .{});
        }

        const percent = try input.expectPercentage();
        return Percentage{ .v = percent };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(css.todo_stuff.depth);
    }
};

pub fn DimensionPercentage(comptime D: type) type {
    return union(enum) {
        dimension: D,
        percentage: Percentage,
        calc: *Calc(DimensionPercentage(D)),
    };
}

/// Either a `<number>` or `<percentage>`.
pub const NumberOrPercentage = union(enum) {
    /// A number.
    number: CSSNumber,
    /// A percentage.
    percentage: Percentage,
};
