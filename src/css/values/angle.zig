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

    // ~toCssImpl
    const This = @This();

    pub fn parse(input: *css.Parser) Error!Angle {
        return Angle.parseInternal(input, false);
    }

    fn parseInternal(input: *css.Parser, allow_unitless_zero: bool) Error!Angle {
        if (input.tryParse(Calc(Angle).parse, .{})) |calc_value| {
            if (calc_value == .value) return calc_value.value.*;
            // Angles are always compatible, so they will always compute to a value.
            return input.newCustomError(css.ParserError.invalid_value);
        }

        const location = input.currentSourceLocation();
        const token = try input.next();
        switch (token.*) {
            .dimension => |*dim| {
                const value = dim.num.value;
                const unit = dim.unit;
                // todo_stuff.match_ignore_ascii_case
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("deg", unit)) {
                    return Angle{ .deg = value };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("grad", unit)) {
                    return Angle{ .grad = value };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("turn", unit)) {
                    return Angle{ .turn = value };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("rad", unit)) {
                    return Angle{ .rad = value };
                } else {
                    return location.newUnexpectedTokenError(token.*);
                }
            },
            .number => |num| {
                if (num.value == 0.0 and allow_unitless_zero) return Angle.zero();
            },
            else => {},
        }
        return location.newUnexpectedTokenError(token.*);
    }

    pub fn parseWithUnitlessZero(input: *css.Parser) Error!Angle {
        return Angle.parseInternal(input, true);
    }

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const value, const unit = switch (this.*) {
            .deg => |val| .{ val, "deg" },
            .grad => |val| .{ val, "grad" },
            .rad => |val| brk: {
                const deg = this.toDegrees();

                // We print 5 digits of precision by default.
                // Switch to degrees if there are an even number of them.
                if (std.math.round(deg * 100000.0) - (deg - @trunc(deg)) == 0) {
                    break :brk .{ val, "deg" };
                } else {
                    break :brk .{ val, "rad" };
                }
            },
            .turn => |val| .{ val, "turn" },
        };
        try css.serializer.serializeDimension(value, unit, W, dest);
    }

    pub fn toCssWithUnitlessZero(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        if (this.isZero()) {
            const v: f32 = 0.0;
            try CSSNumberFns.toCss(&v, W, dest);
        } else {
            return this.toCss(W, dest);
        }
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

    /// Returns the angle in radians.
    pub fn toRadians(this: *const Angle) CSSNumber {
        const RAD_PER_DEG: f32 = std.math.pi / 180.0;
        return switch (this.*) {
            .deg => |deg| return deg * RAD_PER_DEG,
            .rad => |rad| return rad,
            .grad => |grad| return grad * 180.0 / 200.0 * RAD_PER_DEG,
            .turn => |turn| return turn * 360.0 * RAD_PER_DEG,
        };
    }

    /// Returns the angle in degrees.
    pub fn toDegrees(this: *const Angle) CSSNumber {
        const DEG_PER_RAD: f32 = 180.0 / std.math.pi;
        switch (this.*) {
            .deg => |deg| return deg,
            .rad => |rad| return rad * DEG_PER_RAD,
            .grad => |grad| return grad * 180.0 / 200.0,
            .turn => |turn| return turn * 360.0,
        }
    }

    pub fn zero() Angle {
        return .{ .deg = 0.0 };
    }

    pub fn isZero(this: *const Angle) bool {
        const v = switch (this.*) {
            .deg => |deg| deg,
            .rad => |rad| rad,
            .grad => |grad| grad,
            .turn => |turn| turn,
        };
        return v == 0.0;
    }

    pub fn intoCalc(this: *const Angle, allocator: std.mem.Allocator) Calc(Angle) {
        return Calc(Angle){
            .value = bun.create(allocator, Angle, this.*),
        };
    }
};

/// A CSS [`<angle-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-angle-percentage) value.
/// May be specified as either an angle or a percentage that resolves to an angle.
pub const AnglePercentage = css.css_values.percentage.DimensionPercentage(Angle);
