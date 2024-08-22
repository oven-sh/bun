const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumber = css.css_values.number.CSSNumber;

/// A CSS [`<angle>`](https://www.w3.org/TR/css-values-4/#angles) value.
///
/// Angles may be explicit or computed by `calc()`, but are always stored and serialized
/// as their computed value.
pub const Angle = union(enum) {
    /// An angle in degrees. There are 360 degrees in a full circle.
    deg: CSSNumber,
    /// An angle in radians. There are 2π radians in a full circle.
    rad: CSSNumber,
    /// An angle in gradians. There are 400 gradians in a full circle.
    grad: CSSNumber,
    /// An angle in turns. There is 1 turn in a full circle.
    turn: CSSNumber,

    pub fn toDegrees(this: *const Angle) CSSNumber {
        const DEG_PER_RAD: f32 = 180.0 / std.math.pi;
        switch (this.*) {
            .deg => |deg| return deg,
            .rad => |rad| return rad * DEG_PER_RAD,
            .grad => |grad| return grad * 180.0 / 200.0,
            .turn => |turn| return turn * 360.0,
        }
    }

    pub fn parse(input: *css.Parser) Error!Angle {
        _ = input; // autofix
        @compileError(css.todo_stuff.depth);
    }

    // ~toCssImpl
    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(css.todo_stuff.depth);
    }

    pub fn tryFromToken(token: *const css.Token) Error!Angle {
        if (token.* == .dimension) {
            const value = token.dimension.num;
            const unit = token.dimension.unit;
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "deg")) {
                return .{ .deg = value };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "grad")) {
                return .{ .grad = value };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "turn")) {
                return .{ .turn = value };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "rad")) {
                return .{ .rad = value };
            }
        }
        @compileError(css.todo_stuff.errors);
    }
};
