const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Calc = css.css_values.calc.Calc;

pub const CSSNumber = f32;
pub const CSSNumberFns = struct {
    pub fn parse(input: *css.Parser) Error!CSSNumber {
        if (input.tryParse(Calc(f32).parse, .{})) |calc_value| {
            switch (calc_value) {
                .value => |v| return v.*,
                .number => |n| return n,
                // Numbers are always compatible, so they will always compute to a value.
                else => return input.newCustomError(css.ParserError.invalid_value),
            }
        }

        const num = try input.expectNumber();
        return num;
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(css.todo_stuff.depth);
    }
};

/// A CSS [`<integer>`](https://www.w3.org/TR/css-values-4/#integers) value.
pub const CSSInteger = i32;
pub const CSSIntegerFns = struct {
    pub fn parse(input: *css.Parser) Error!CSSInteger {
        // TODO: calc??
        const integer = try input.expectInteger();
        return integer;
    }
    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        try css.to_css.integer(i32, this.*, W, dest);
    }
};
