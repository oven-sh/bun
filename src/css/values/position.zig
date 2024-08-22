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
const LengthPercentage = css.css_values.length.LengthPercentage;

pub fn PositionComponent(comptime S: type) type {
    return union(enum) {
        center,
        length,
        side: struct {
            side: S,
            offset: ?LengthPercentage,
        },
    };
}

pub const HorizontalPositionKeyword = css.DefineEnumProperty(struct {
    comptime {
        @compileError(css.todo_stuff.depth);
    }
});

pub const VerticalPositionKeyword = css.DefineEnumProperty(struct {
    comptime {
        @compileError(css.todo_stuff.depth);
    }
});

pub const HorizontalPosition = PositionComponent(HorizontalPositionKeyword);
pub const VerticalPosition = PositionComponent(VerticalPositionKeyword);
