const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Result = css.Result;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Calc = css.css_values.calc.Calc;

pub const CSSNumber = f32;
pub const CSSNumberFns = struct {
    pub fn parse(input: *css.Parser) Result(CSSNumber) {
        if (input.tryParse(Calc(f32).parse, .{}).asValue()) |calc_value| {
            switch (calc_value) {
                .value => |v| return .{ .result = v.* },
                .number => |n| return .{ .result = n },
                // Numbers are always compatible, so they will always compute to a value.
                else => return input.newCustomError(css.ParserError.invalid_value),
            }
        }

        return input.expectNumber();
    }

    pub fn toCss(this: *const CSSNumber, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const number: f32 = this.*;
        if (number != 0.0 and @abs(number) < 1.0) {
            // PERF: Use temp allocation here?
            // why the extra allocation anyway?
            var s = ArrayList(u8){};
            const writer = s.writer(@compileError(css.todo_stuff.think_about_allocator));
            const W2 = @TypeOf(writer);
            try css.to_css.float32(number, W2, writer);
            if (number < 0.0) {
                try dest.writeChar('-');
                dest.writeStr(bun.strings.trimLeadingPattern2(s, '-', '0'));
            } else {
                try dest.writeStr(bun.strings.trimLeadingChar(s, '0'));
            }
        } else {
            return css.to_css.float32(number, W, dest);
        }
    }
};

/// A CSS [`<integer>`](https://www.w3.org/TR/css-values-4/#integers) value.
pub const CSSInteger = i32;
pub const CSSIntegerFns = struct {
    pub fn parse(input: *css.Parser) Result(CSSInteger) {
        // TODO: calc??
        return input.expectInteger();
    }
    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        try css.to_css.integer(i32, this.*, W, dest);
    }
};
