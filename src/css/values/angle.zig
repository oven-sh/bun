pub const css = @import("../css_parser.zig");
const Result = css.Result;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Calc = css.css_values.calc.Calc;

const Tag = enum(u8) {
    deg = 1,
    rad = 2,
    grad = 4,
    turn = 8,
};

/// A CSS [`<angle>`](https://www.w3.org/TR/css-values-4/#angles) value.
///
/// Angles may be explicit or computed by `calc()`, but are always stored and serialized
/// as their computed value.
pub const Angle = union(Tag) {
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

    pub fn parse(input: *css.Parser) Result(Angle) {
        return Angle.parseInternal(input, false);
    }

    fn parseInternal(input: *css.Parser, allow_unitless_zero: bool) Result(Angle) {
        if (input.tryParse(Calc(Angle).parse, .{}).asValue()) |calc_value| {
            if (calc_value == .value) return .{ .result = calc_value.value.* };
            // Angles are always compatible, so they will always compute to a value.
            return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
        }

        const location = input.currentSourceLocation();
        const token = switch (input.next()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        switch (token.*) {
            .dimension => |*dim| {
                const value = dim.num.value;
                const unit = dim.unit;
                // todo_stuff.match_ignore_ascii_case
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("deg", unit)) {
                    return .{ .result = Angle{ .deg = value } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("grad", unit)) {
                    return .{ .result = Angle{ .grad = value } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("turn", unit)) {
                    return .{ .result = Angle{ .turn = value } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("rad", unit)) {
                    return .{ .result = Angle{ .rad = value } };
                } else {
                    return .{ .err = location.newUnexpectedTokenError(token.*) };
                }
            },
            .number => |num| {
                if (num.value == 0.0 and allow_unitless_zero) return .{ .result = Angle.zero() };
            },
            else => {},
        }
        return .{ .err = location.newUnexpectedTokenError(token.*) };
    }

    pub fn parseWithUnitlessZero(input: *css.Parser) Result(Angle) {
        return Angle.parseInternal(input, true);
    }

    pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
        const value, const unit = switch (this.*) {
            .deg => |val| .{ val, "deg" },
            .grad => |val| .{ val, "grad" },
            .rad => |val| brk: {
                const deg = this.toDegrees();

                // We print 5 digits of precision by default.
                // Switch to degrees if length is smaller than rad.
                if (css.f32_length_with_5_digits(deg) < css.f32_length_with_5_digits(val)) {
                    break :brk .{ deg, "deg" };
                } else {
                    break :brk .{ val, "rad" };
                }
            },
            .turn => |val| .{ val, "turn" },
        };
        css.serializer.serializeDimension(value, unit, dest) catch return dest.addFmtError();
    }

    pub fn toCssWithUnitlessZero(this: *const This, dest: *Printer) PrintErr!void {
        if (this.isZero()) {
            const v: f32 = 0.0;
            try CSSNumberFns.toCss(&v, dest);
        } else {
            return this.toCss(dest);
        }
    }

    pub fn tryFromAngle(angle: Angle) ?This {
        return angle;
    }

    pub fn tryFromToken(token: *const css.Token) css.Maybe(Angle, void) {
        if (token.* == .dimension) {
            const value = token.dimension.num.value;
            const unit = token.dimension.unit;
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "deg")) {
                return .{ .result = .{ .deg = value } };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "grad")) {
                return .{ .result = .{ .grad = value } };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "turn")) {
                return .{ .result = .{ .turn = value } };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "rad")) {
                return .{ .result = .{ .rad = value } };
            }
        }
        return .{ .err = {} };
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

    pub fn map(this: *const Angle, comptime opfn: *const fn (f32) f32) Angle {
        return switch (this.*) {
            .deg => |deg| .{ .deg = opfn(deg) },
            .rad => |rad| .{ .rad = opfn(rad) },
            .grad => |grad| .{ .grad = opfn(grad) },
            .turn => |turn| .{ .turn = opfn(turn) },
        };
    }

    pub fn tryMap(this: *const Angle, comptime opfn: *const fn (f32) f32) ?Angle {
        return map(this, opfn);
    }

    pub fn addInternal(this: Angle, _: std.mem.Allocator, other: Angle) Angle {
        return this.add(other);
    }

    pub fn add(this: Angle, rhs: Angle) Angle {
        const addfn = struct {
            pub fn add(_: void, a: f32, b: f32) f32 {
                return a + b;
            }
        };
        return Angle.op(&this, &rhs, {}, addfn.add);
    }

    pub fn tryAdd(this: *const Angle, _: std.mem.Allocator, rhs: *const Angle) ?Angle {
        return .{ .deg = this.toDegrees() + rhs.toDegrees() };
    }

    pub fn eql(lhs: *const Angle, rhs: *const Angle) bool {
        return lhs.toDegrees() == rhs.toDegrees();
    }

    pub fn mulF32(this: Angle, _: std.mem.Allocator, other: f32) Angle {
        // return Angle.op(&this, &other, Angle.mulF32);
        return switch (this) {
            .deg => |v| .{ .deg = v * other },
            .rad => |v| .{ .rad = v * other },
            .grad => |v| .{ .grad = v * other },
            .turn => |v| .{ .turn = v * other },
        };
    }

    pub fn partialCmp(this: *const Angle, other: *const Angle) ?std.math.Order {
        return css.generic.partialCmpF32(&this.toDegrees(), &other.toDegrees());
    }

    pub fn tryOp(
        this: *const Angle,
        other: *const Angle,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) f32,
    ) ?Angle {
        return Angle.op(this, other, ctx, op_fn);
    }

    pub fn tryOpTo(
        this: *const Angle,
        other: *const Angle,
        comptime R: type,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) R,
    ) ?R {
        return Angle.opTo(this, other, R, ctx, op_fn);
    }

    pub fn op(
        this: *const Angle,
        other: *const Angle,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) f32,
    ) Angle {
        // PERF: not sure if this is faster
        const self_tag: u16 = @intFromEnum(this.*);
        const other_tag: u16 = @intFromEnum(other.*);
        const DEG: u16 = @intFromEnum(Tag.deg);
        const GRAD: u16 = @intFromEnum(Tag.grad);
        const RAD: u16 = @intFromEnum(Tag.rad);
        const TURN: u16 = @intFromEnum(Tag.turn);

        const switch_val: u16 = self_tag | (other_tag << 8);
        return switch (switch_val) {
            DEG | (DEG << 8) => Angle{ .deg = op_fn(ctx, this.deg, other.deg) },
            RAD | (RAD << 8) => Angle{ .rad = op_fn(ctx, this.rad, other.rad) },
            GRAD | (GRAD << 8) => Angle{ .grad = op_fn(ctx, this.grad, other.grad) },
            TURN | (TURN << 8) => Angle{ .turn = op_fn(ctx, this.turn, other.turn) },
            else => Angle{ .deg = op_fn(ctx, this.toDegrees(), other.toDegrees()) },
        };
    }

    pub fn opTo(
        this: *const Angle,
        other: *const Angle,
        comptime T: type,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) T,
    ) T {
        // PERF: not sure if this is faster
        const self_tag: u8 = @intFromEnum(this.*);
        const other_tag: u8 = @intFromEnum(this.*);
        const DEG: u8 = @intFromEnum(Tag.deg);
        const GRAD: u8 = @intFromEnum(Tag.grad);
        const RAD: u8 = @intFromEnum(Tag.rad);
        const TURN: u8 = @intFromEnum(Tag.turn);

        const switch_val: u8 = self_tag | other_tag;
        return switch (switch_val) {
            DEG | DEG => op_fn(ctx, this.deg, other.deg),
            RAD | RAD => op_fn(ctx, this.rad, other.rad),
            GRAD | GRAD => op_fn(ctx, this.grad, other.grad),
            TURN | TURN => op_fn(ctx, this.turn, other.turn),
            else => op_fn(ctx, this.toDegrees(), other.toDegrees()),
        };
    }

    pub fn sign(this: *const Angle) f32 {
        return switch (this.*) {
            .deg, .rad, .grad, .turn => |v| CSSNumberFns.sign(&v),
        };
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A CSS [`<angle-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-angle-percentage) value.
/// May be specified as either an angle or a percentage that resolves to an angle.
pub const AnglePercentage = css.css_values.percentage.DimensionPercentage(Angle);

const bun = @import("bun");
const std = @import("std");
