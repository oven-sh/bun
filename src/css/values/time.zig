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
const Url = css.css_values.url.Url;
const CSSInteger = css.css_values.number.CSSInteger;
const CSSIntegerFns = css.css_values.number.CSSIntegerFns;
const Angle = css.css_values.angle.Angle;
const Resolution = css.css_values.resolution.Resolution;
const CustomIdent = css.css_values.ident.CustomIdent;
const CustomIdentFns = css.css_values.ident.CustomIdentFns;
const Ident = css.css_values.ident.Ident;

/// A CSS [`<time>`](https://www.w3.org/TR/css-values-4/#time) value, in either
/// seconds or milliseconds.
///
/// Time values may be explicit or computed by `calc()`, but are always stored and serialized
/// as their computed value.
pub const Time = union(enum) {
    /// A time in seconds.
    seconds: CSSNumber,
    /// A time in milliseconds.
    milliseconds: CSSNumber,

    pub fn tryFromToken(token: *const css.Token) Error!Time {
        _ = token; // autofix
        @compileError(css.todo_stuff.depth);
    }
};
