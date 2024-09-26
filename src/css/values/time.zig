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

    const Tag = enum(u8) { seconds = 1, milliseconds = 2 };

    pub fn parse(input: *css.Parser) Result(Time) {
        var calc_result = switch (input.tryParse(Calc(Time).parse, .{})) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        switch (calc_result) {
            .value => |v| {
                const ret: Time = v.*;
                // redundant allocation
                calc_result.deinit(input.allocator());
                return .{ .result = ret };
            },
            // Time is always compatible, so they will always compute to a value.
            else => return .{ .err = input.newErrorForNextToken() },
        }

        const location = input.currentSourceLocation();
        const token = switch (input.next()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        switch (token.*) {
            .dimension => |*dim| {
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("s", dim.unit)) {
                    return .{ .result = .{ .seconds = dim.value } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("ms", dim.unit)) {
                    return .{ .result = .{ .milliseconds = dim.value } };
                } else {
                    return .{ .err = location.newUnexpectedTokenError(css.Token{ .ident = dim.unit }) };
                }
            },
            else => return .{ .err = location.newUnexpectedTokenError(token) },
        }
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        // 0.1s is shorter than 100ms
        // anything smaller is longer
        switch (this.*) {
            .seconds => |s| {
                if (s > 0.0 and s < 0.1) {
                    try CSSNumberFns.toCss(&(s * 1000.0), W, dest);
                    try dest.writeStr("ms");
                } else {
                    try CSSNumberFns.toCss(&s, W, dest);
                    try dest.writeStr("s");
                }
            },
            .milliseconds => |ms| {
                if (ms == 0.0 or ms >= 100.0) {
                    try CSSNumberFns.toCss(&(ms / 1000.0), W, dest);
                    try dest.writeStr("s");
                } else {
                    try CSSNumberFns.toCss(&ms, W, dest);
                    try dest.writeStr("ms");
                }
            },
        }
    }

    /// Returns the time in milliseconds.
    pub fn toMs(this: *const Time) CSSNumber {
        return switch (this.*) {
            .seconds => |v| v * 1000.0,
            .milliseconds => |v| v,
        };
    }

    pub fn tryFromToken(token: *const css.Token) css.Maybe(Time, void) {
        switch (token.*) {
            .dimension => |*dim| {
                // todo_stuff.match_ignore_ascii_case
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("s", dim.unit)) {
                    return .{ .result = .{ .seconds = dim.num.value } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("ms", dim.unit)) {
                    return .{ .result = .{ .milliseconds = dim.num.value } };
                }
            },
            else => {},
        }

        return .{ .err = {} };
    }

    pub fn tryFromAngle(_: css.css_values.angle.Angle) ?@This() {
        return null;
    }

    pub fn mulF32(this: @This(), _: std.mem.Allocator, other: f32) Time {
        return switch (this) {
            .seconds => .{ .seconds = this.seconds * other },
            .milliseconds => .{ .milliseconds = this.milliseconds * other },
        };
    }

    pub fn add(this: @This(), _: std.mem.Allocator, other: @This()) Time {
        return switch (this) {
            .seconds => |v| .{ .seconds = v + other.seconds },
            .milliseconds => |v| .{ .milliseconds = v + other.milliseconds },
        };
    }

    pub fn partialCmp(this: *const Time, other: *const Time) ?std.math.Order {
        return css.generic.partialCmpF32(&this.toMs(), &other.toMs());
    }

    pub fn map(this: *const @This(), comptime map_fn: *const fn (f32) f32) Time {
        return switch (this.*) {
            .seconds => Time{ .seconds = map_fn(this.seconds) },
            .milliseconds => Time{ .milliseconds = map_fn(this.milliseconds) },
        };
    }

    pub fn sign(this: *const Time) f32 {
        return switch (this.*) {
            .seconds => |v| CSSNumberFns.sign(&v),
            .milliseconds => |v| CSSNumberFns.sign(&v),
        };
    }

    pub fn op(
        this: *const Time,
        other: *const Time,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) f32,
    ) Time {
        const self_tag: u16 = @intFromEnum(this.*);
        const other_tag: u16 = @intFromEnum(other.*);
        const S: u16 = @intFromEnum(Tag.seconds);
        const MS: u16 = @intFromEnum(Tag.milliseconds);

        const switch_val: u16 = self_tag | (@as(u16, other_tag) << 8);
        return switch (switch_val) {
            S | (S << 8) => Time{ .seconds = op_fn(ctx, this.seconds, other.seconds) },
            MS | (MS << 8) => Time{ .milliseconds = op_fn(ctx, this.milliseconds, other.milliseconds) },
            S | (MS << 8) => Time{ .seconds = op_fn(ctx, this.seconds, other.milliseconds / 1000.0) },
            MS | (S << 8) => Time{ .milliseconds = op_fn(ctx, this.milliseconds, other.seconds * 1000.0) },
            else => unreachable,
        };
    }

    pub fn opTo(
        this: *const Time,
        other: *const Time,
        comptime R: type,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) R,
    ) R {
        const self_tag: u16 = @intFromEnum(this.*);
        const other_tag: u16 = @intFromEnum(other.*);
        const S: u16 = @intFromEnum(Tag.seconds);
        const MS: u16 = @intFromEnum(Tag.milliseconds);

        const switch_val: u16 = self_tag | (@as(u16, other_tag) << 8);
        return switch (switch_val) {
            S | (S << 8) => op_fn(ctx, this.seconds, other.seconds),
            MS | (MS << 8) => op_fn(ctx, this.milliseconds, other.milliseconds),
            S | (MS << 8) => op_fn(ctx, this.seconds, other.milliseconds / 1000.0),
            MS | (S << 8) => op_fn(ctx, this.milliseconds, other.seconds * 1000.0),
            else => unreachable,
        };
    }
};
