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
const Time = css.css_values.time.Time;
const Resolution = css.css_values.resolution.Resolution;
const CustomIdent = css.css_values.ident.CustomIdent;
const CustomIdentFns = css.css_values.ident.CustomIdentFns;
const Ident = css.css_values.ident.Ident;

/// A CSS [easing function](https://www.w3.org/TR/css-easing-1/#easing-functions).
pub const EasingFunction = union(enum) {
    /// A linear easing function.
    linear,
    /// Equivalent to `cubic-bezier(0.25, 0.1, 0.25, 1)`.
    ease,
    /// Equivalent to `cubic-bezier(0.42, 0, 1, 1)`.
    ease_in,
    /// Equivalent to `cubic-bezier(0, 0, 0.58, 1)`.
    ease_out,
    /// Equivalent to `cubic-bezier(0.42, 0, 0.58, 1)`.
    ease_in_out,
    /// A custom cubic Bézier easing function.
    cubic_bezier: struct {
        /// The x-position of the first point in the curve.
        x1: CSSNumber,
        /// The y-position of the first point in the curve.
        y1: CSSNumber,
        /// The x-position of the second point in the curve.
        x2: CSSNumber,
        /// The y-position of the second point in the curve.
        y2: CSSNumber,
    },
    /// A step easing function.
    steps: struct {
        /// The number of intervals in the function.
        count: CSSInteger,
        /// The step position.
        position: StepPosition = StepPosition.default,
    },
};

/// A [step position](https://www.w3.org/TR/css-easing-1/#step-position), used within the `steps()` function.
pub const StepPosition = enum {
    /// The first rise occurs at input progress value of 0.
    start,
    /// The last rise occurs at input progress value of 1.
    end,
    /// All rises occur within the range (0, 1).
    jump_none,
    /// The first rise occurs at input progress value of 0 and the last rise occurs at input progress value of 1.
    jump_both,
};
