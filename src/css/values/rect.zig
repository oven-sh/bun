const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Result = css.Result;
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

/// A generic value that represents a value for four sides of a box,
/// e.g. border-width, margin, padding, etc.
///
/// When serialized, as few components as possible are written when
/// there are duplicate values.
pub fn Rect(comptime T: type) type {
    return struct {
        /// The top component.
        top: T,
        /// The right component.
        right: T,
        /// The bottom component.
        bottom: T,
        /// The left component.
        left: T,

        const This = @This();

        pub fn parse(input: *css.Parser) Result(This) {
            return This.parseWith(input, valParse);
        }

        pub fn parseWith(input: *css.Parser, comptime parse_fn: *const fn (*css.Parser) Result(T)) Result(This) {
            const first = switch (parse_fn(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            const second = switch (input.tryParse(parse_fn, .{})) {
                .result => |v| v,
                // <first>
                .err => return .{ .result = This{ .top = first, .right = first, .bottom = first, .left = first } },
            };
            const third = switch (input.tryParse(parse_fn, .{})) {
                .result => |v| v,
                // <first> <second>
                .err => return This{ .top = first, .right = second, .bottom = first, .left = second },
            };
            const fourth = switch (input.tryParse(parse_fn, .{})) {
                .result => |v| v,
                // <first> <second> <third>
                .err => return This{ .top = first, .right = second, .bottom = third, .left = second },
            };
            // <first> <second> <third> <fourth>
            return .{ .result = This{ .top = first, .right = second, .bottom = third, .left = fourth } };
        }

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            try css.generic.toCss(T, &this.top, W, dest);
            const same_vertical = css.generic.eql(T, &this.top, &this.bottom);
            const same_horizontal = css.generic.eql(T, &this.right, &this.left);
            if (same_vertical and same_horizontal and css.generic.eql(T, &this.top, &this.right)) {
                return;
            }
            try dest.writeStr(" ");
            try css.generic.toCss(T, &this.right, W, dest);
            if (same_vertical and same_horizontal) {
                return;
            }
            try dest.writeStr(" ");
            try css.generic.toCss(T, &this.bottom, W, dest);
            if (same_horizontal) {
                return;
            }
            try dest.writeStr(" ");
            try css.generic.toCss(T, &this.left, W, dest);
        }

        pub fn valParse(i: *css.Parser) Result(T) {
            return css.generic.parse(T, i);
        }
    };
}
