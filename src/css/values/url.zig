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
const Length = css.css_values.length.Length;
const Percentage = css.css_values.percentage.Percentage;
const CssColor = css.css_values.color.CssColor;
const Image = css.css_values.image.Image;
const CSSInteger = css.css_values.number.CSSInteger;
const CSSIntegerFns = css.css_values.number.CSSIntegerFns;
const Angle = css.css_values.angle.Angle;
const Time = css.css_values.time.Time;
const Resolution = css.css_values.resolution.Resolution;
const CustomIdent = css.css_values.ident.CustomIdent;
const CustomIdentFns = css.css_values.ident.CustomIdentFns;
const Ident = css.css_values.ident.Ident;

/// A CSS [url()](https://www.w3.org/TR/css-values-4/#urls) value and its source location.
pub const Url = struct {
    /// The url string.
    url: []const u8,
    /// The location where the `url()` was seen in the CSS source file.
    loc: css.Location,

    pub fn parse(input: *css.Parser) Error!Url {
        _ = input; // autofix
        @compileError(css.todo_stuff.depth);
    }

    const This = @This();

    /// Returns whether the URL is absolute, and not relative.
    pub fn isAbsolute(this: *const This) bool {
        _ = this; // autofix

        @compileError(css.todo_stuff.depth);
    }

    pub fn toCss(
        this: *const This,
        comptime W: type,
        dest: *Printer(W),
    ) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(css.todo_stuff.depth);
    }
};
