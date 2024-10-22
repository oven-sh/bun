const std = @import("std");
const Allocator = std.mem.Allocator;
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

/// Either a [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) or a [`<number>`](https://www.w3.org/TR/css-values-4/#numbers).
pub const LengthOrNumber = union(enum) {
    /// A number.
    number: CSSNumber,
    /// A length.
    length: Length,

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

    pub fn default() LengthOrNumber {
        return .{ .number = 0.0 };
    }

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return switch (this.*) {
            .number => |*n| n.* == other.number,
            .length => |*l| l.eql(&other.length),
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub const LengthPercentage = DimensionPercentage(LengthValue);
/// Either a [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage), or the `auto` keyword.
pub const LengthPercentageOrAuto = union(enum) {
    /// The `auto` keyword.
    auto,
    /// A [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage).
    length: LengthPercentage,

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub inline fn deepClone(this: *const @This(), allocator: Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

const PX_PER_IN: f32 = 96.0;
const PX_PER_CM: f32 = PX_PER_IN / 2.54;
const PX_PER_MM: f32 = PX_PER_CM / 10.0;
const PX_PER_Q: f32 = PX_PER_CM / 40.0;
const PX_PER_PT: f32 = PX_PER_IN / 72.0;
const PX_PER_PC: f32 = PX_PER_IN / 6.0;

pub const LengthValue = union(enum) {
    // https://www.w3.org/TR/css-values-4/#absolute-lengths
    /// A length in pixels.
    px: CSSNumber,
    /// A length in inches. 1in = 96px.
    in: CSSNumber,
    /// A length in centimeters. 1cm = 96px / 2.54.
    cm: CSSNumber,
    /// A length in millimeters. 1mm = 1/10th of 1cm.
    mm: CSSNumber,
    /// A length in quarter-millimeters. 1Q = 1/40th of 1cm.
    q: CSSNumber,
    /// A length in points. 1pt = 1/72nd of 1in.
    pt: CSSNumber,
    /// A length in picas. 1pc = 1/6th of 1in.
    pc: CSSNumber,

    // https://www.w3.org/TR/css-values-4/#font-relative-lengths
    /// A length in the `em` unit. An `em` is equal to the computed value of the
    /// font-size property of the element on which it is used.
    em: CSSNumber,
    /// A length in the `rem` unit. A `rem` is equal to the computed value of the
    /// `em` unit on the root element.
    rem: CSSNumber,
    /// A length in `ex` unit. An `ex` is equal to the x-height of the font.
    ex: CSSNumber,
    /// A length in the `rex` unit. A `rex` is equal to the value of the `ex` unit on the root element.
    rex: CSSNumber,
    /// A length in the `ch` unit. A `ch` is equal to the width of the zero ("0") character in the current font.
    ch: CSSNumber,
    /// A length in the `rch` unit. An `rch` is equal to the value of the `ch` unit on the root element.
    rch: CSSNumber,
    /// A length in the `cap` unit. A `cap` is equal to the cap-height of the font.
    cap: CSSNumber,
    /// A length in the `rcap` unit. An `rcap` is equal to the value of the `cap` unit on the root element.
    rcap: CSSNumber,
    /// A length in the `ic` unit. An `ic` is equal to the width of the “水” (CJK water ideograph) character in the current font.
    ic: CSSNumber,
    /// A length in the `ric` unit. An `ric` is equal to the value of the `ic` unit on the root element.
    ric: CSSNumber,
    /// A length in the `lh` unit. An `lh` is equal to the computed value of the `line-height` property.
    lh: CSSNumber,
    /// A length in the `rlh` unit. An `rlh` is equal to the value of the `lh` unit on the root element.
    rlh: CSSNumber,

    // https://www.w3.org/TR/css-values-4/#viewport-relative-units
    /// A length in the `vw` unit. A `vw` is equal to 1% of the [viewport width](https://www.w3.org/TR/css-values-4/#ua-default-viewport-size).
    vw: CSSNumber,
    /// A length in the `lvw` unit. An `lvw` is equal to 1% of the [large viewport width](https://www.w3.org/TR/css-values-4/#large-viewport-size).
    lvw: CSSNumber,
    /// A length in the `svw` unit. An `svw` is equal to 1% of the [small viewport width](https://www.w3.org/TR/css-values-4/#small-viewport-size).
    svw: CSSNumber,
    /// A length in the `dvw` unit. An `dvw` is equal to 1% of the [dynamic viewport width](https://www.w3.org/TR/css-values-4/#dynamic-viewport-size).
    dvw: CSSNumber,
    /// A length in the `cqw` unit. An `cqw` is equal to 1% of the [query container](https://drafts.csswg.org/css-contain-3/#query-container) width.
    cqw: CSSNumber,

    /// A length in the `vh` unit. A `vh` is equal to 1% of the [viewport height](https://www.w3.org/TR/css-values-4/#ua-default-viewport-size).
    vh: CSSNumber,
    /// A length in the `lvh` unit. An `lvh` is equal to 1% of the [large viewport height](https://www.w3.org/TR/css-values-4/#large-viewport-size).
    lvh: CSSNumber,
    /// A length in the `svh` unit. An `svh` is equal to 1% of the [small viewport height](https://www.w3.org/TR/css-values-4/#small-viewport-size).
    svh: CSSNumber,
    /// A length in the `dvh` unit. An `dvh` is equal to 1% of the [dynamic viewport height](https://www.w3.org/TR/css-values-4/#dynamic-viewport-size).
    dvh: CSSNumber,
    /// A length in the `cqh` unit. An `cqh` is equal to 1% of the [query container](https://drafts.csswg.org/css-contain-3/#query-container) height.
    cqh: CSSNumber,

    /// A length in the `vi` unit. A `vi` is equal to 1% of the [viewport size](https://www.w3.org/TR/css-values-4/#ua-default-viewport-size)
    /// in the box's [inline axis](https://www.w3.org/TR/css-writing-modes-4/#inline-axis).
    vi: CSSNumber,
    /// A length in the `svi` unit. A `svi` is equal to 1% of the [small viewport size](https://www.w3.org/TR/css-values-4/#small-viewport-size)
    /// in the box's [inline axis](https://www.w3.org/TR/css-writing-modes-4/#inline-axis).
    svi: CSSNumber,
    /// A length in the `lvi` unit. A `lvi` is equal to 1% of the [large viewport size](https://www.w3.org/TR/css-values-4/#large-viewport-size)
    /// in the box's [inline axis](https://www.w3.org/TR/css-writing-modes-4/#inline-axis).
    lvi: CSSNumber,
    /// A length in the `dvi` unit. A `dvi` is equal to 1% of the [dynamic viewport size](https://www.w3.org/TR/css-values-4/#dynamic-viewport-size)
    /// in the box's [inline axis](https://www.w3.org/TR/css-writing-modes-4/#inline-axis).
    dvi: CSSNumber,
    /// A length in the `cqi` unit. An `cqi` is equal to 1% of the [query container](https://drafts.csswg.org/css-contain-3/#query-container) inline size.
    cqi: CSSNumber,

    /// A length in the `vb` unit. A `vb` is equal to 1% of the [viewport size](https://www.w3.org/TR/css-values-4/#ua-default-viewport-size)
    /// in the box's [block axis](https://www.w3.org/TR/css-writing-modes-4/#block-axis).
    vb: CSSNumber,
    /// A length in the `svb` unit. A `svb` is equal to 1% of the [small viewport size](https://www.w3.org/TR/css-values-4/#small-viewport-size)
    /// in the box's [block axis](https://www.w3.org/TR/css-writing-modes-4/#block-axis).
    svb: CSSNumber,
    /// A length in the `lvb` unit. A `lvb` is equal to 1% of the [large viewport size](https://www.w3.org/TR/css-values-4/#large-viewport-size)
    /// in the box's [block axis](https://www.w3.org/TR/css-writing-modes-4/#block-axis).
    lvb: CSSNumber,
    /// A length in the `dvb` unit. A `dvb` is equal to 1% of the [dynamic viewport size](https://www.w3.org/TR/css-values-4/#dynamic-viewport-size)
    /// in the box's [block axis](https://www.w3.org/TR/css-writing-modes-4/#block-axis).
    dvb: CSSNumber,
    /// A length in the `cqb` unit. An `cqb` is equal to 1% of the [query container](https://drafts.csswg.org/css-contain-3/#query-container) block size.
    cqb: CSSNumber,

    /// A length in the `vmin` unit. A `vmin` is equal to the smaller of `vw` and `vh`.
    vmin: CSSNumber,
    /// A length in the `svmin` unit. An `svmin` is equal to the smaller of `svw` and `svh`.
    svmin: CSSNumber,
    /// A length in the `lvmin` unit. An `lvmin` is equal to the smaller of `lvw` and `lvh`.
    lvmin: CSSNumber,
    /// A length in the `dvmin` unit. An `dvmin` is equal to the smaller of `dvw` and `dvh`.
    dvmin: CSSNumber,
    /// A length in the `cqmin` unit. An `cqmin` is equal to the smaller of `cqi` and `cqb`.
    cqmin: CSSNumber,

    /// A length in the `vmax` unit. A `vmax` is equal to the larger of `vw` and `vh`.
    vmax: CSSNumber,
    /// A length in the `svmax` unit. An `svmax` is equal to the larger of `svw` and `svh`.
    svmax: CSSNumber,
    /// A length in the `lvmax` unit. An `lvmax` is equal to the larger of `lvw` and `lvh`.
    lvmax: CSSNumber,
    /// A length in the `dvmax` unit. An `dvmax` is equal to the larger of `dvw` and `dvh`.
    dvmax: CSSNumber,
    /// A length in the `cqmax` unit. An `cqmin` is equal to the larger of `cqi` and `cqb`.
    cqmax: CSSNumber,

    pub fn parse(input: *css.Parser) Result(@This()) {
        const location = input.currentSourceLocation();
        const token = switch (input.next()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        switch (token.*) {
            .dimension => |*dim| {
                // todo_stuff.match_ignore_ascii_case
                inline for (std.meta.fields(@This())) |field| {
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(field.name, dim.unit)) {
                        return .{ .result = @unionInit(LengthValue, field.name, dim.num.value) };
                    }
                }
            },
            .number => |*num| return .{ .result = .{ .px = num.value } },
            else => {},
        }
        return .{ .err = location.newUnexpectedTokenError(token.*) };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        const value, const unit = this.toUnitValue();

        // The unit can be omitted if the value is zero, except inside calc()
        // expressions, where unitless numbers won't be parsed as dimensions.
        if (!dest.in_calc and value == 0.0) {
            return dest.writeChar('0');
        }

        return css.serializer.serializeDimension(value, unit, W, dest);
    }

    pub fn isZero(this: *const LengthValue) bool {
        inline for (bun.meta.EnumFields(@This())) |field| {
            if (@intFromEnum(this.*) == field.value) {
                return @field(this, field.name) == 0.0;
            }
        }
        unreachable;
    }

    pub fn zero() LengthValue {
        return .{ .px = 0.0 };
    }

    /// Attempts to convert the value to pixels.
    /// Returns `None` if the conversion is not possible.
    pub fn toPx(this: *const @This()) ?CSSNumber {
        return switch (this.*) {
            .px => |v| v,
            .in => |v| v * PX_PER_IN,
            .cm => |v| v * PX_PER_CM,
            .mm => |v| v * PX_PER_MM,
            .q => |v| v * PX_PER_Q,
            .pt => |v| v * PX_PER_PT,
            .pc => |v| v * PX_PER_PC,
            else => null,
        };
    }

    pub inline fn eql(this: *const @This(), other: *const @This()) bool {
        inline for (bun.meta.EnumFields(@This())) |field| {
            if (field.value == @intFromEnum(this.*) and field.value == @intFromEnum(other.*)) {
                return @field(this, field.name) == @field(other, field.name);
            }
        }
        return false;
    }

    pub fn trySign(this: *const @This()) ?f32 {
        return sign(this);
    }

    pub fn sign(this: *const @This()) f32 {
        const enum_fields = @typeInfo(@typeInfo(@This()).Union.tag_type.?).Enum.fields;
        inline for (std.meta.fields(@This()), 0..) |field, i| {
            if (enum_fields[i].value == @intFromEnum(this.*)) {
                return css.signfns.signF32(@field(this, field.name));
            }
        }
        unreachable;
    }

    pub fn tryFromToken(token: *const css.Token) css.Maybe(@This(), void) {
        switch (token.*) {
            .dimension => |*dim| {
                inline for (std.meta.fields(@This())) |field| {
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(field.name, dim.unit)) {
                        return .{ .result = @unionInit(LengthValue, field.name, dim.num.value) };
                    }
                }
            },
            else => {},
        }
        return .{ .err = {} };
    }

    pub fn toUnitValue(this: *const @This()) struct { CSSNumber, []const u8 } {
        const enum_fields = @typeInfo(@typeInfo(@This()).Union.tag_type.?).Enum.fields;
        inline for (std.meta.fields(@This()), 0..) |field, i| {
            if (enum_fields[i].value == @intFromEnum(this.*)) {
                return .{ @field(this, field.name), field.name };
            }
        }
        unreachable;
    }

    pub fn map(this: *const @This(), comptime map_fn: *const fn (f32) f32) LengthValue {
        inline for (comptime bun.meta.EnumFields(@This())) |field| {
            if (field.value == @intFromEnum(this.*)) {
                return @unionInit(LengthValue, field.name, map_fn(@field(this, field.name)));
            }
        }
        unreachable;
    }

    pub fn mulF32(this: @This(), _: Allocator, other: f32) LengthValue {
        const fields = comptime bun.meta.EnumFields(@This());
        inline for (fields) |field| {
            if (field.value == @intFromEnum(this)) {
                return @unionInit(LengthValue, field.name, @field(this, field.name) * other);
            }
        }
        unreachable;
    }

    pub fn tryFromAngle(_: css.css_values.angle.Angle) ?@This() {
        return null;
    }

    pub fn partialCmp(this: *const LengthValue, other: *const LengthValue) ?std.math.Order {
        if (@intFromEnum(this.*) == @intFromEnum(other.*)) {
            inline for (bun.meta.EnumFields(LengthValue)) |field| {
                if (field.value == @intFromEnum(this.*)) {
                    const a = @field(this, field.name);
                    const b = @field(other, field.name);
                    return css.generic.partialCmpF32(&a, &b);
                }
            }
            unreachable;
        }

        const a = this.toPx();
        const b = this.toPx();
        if (a != null and b != null) {
            return css.generic.partialCmpF32(&a.?, &b.?);
        }
        return null;
    }

    pub fn tryOp(
        this: *const LengthValue,
        other: *const LengthValue,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) f32,
    ) ?LengthValue {
        if (@intFromEnum(this.*) == @intFromEnum(other.*)) {
            inline for (bun.meta.EnumFields(LengthValue)) |field| {
                if (field.value == @intFromEnum(this.*)) {
                    const a = @field(this, field.name);
                    const b = @field(other, field.name);
                    return @unionInit(LengthValue, field.name, op_fn(ctx, a, b));
                }
            }
            unreachable;
        }

        const a = this.toPx();
        const b = this.toPx();
        if (a != null and b != null) {
            return .{ .px = op_fn(ctx, a.?, b.?) };
        }
        return null;
    }

    pub fn tryOpTo(
        this: *const LengthValue,
        other: *const LengthValue,
        comptime R: type,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) R,
    ) ?R {
        if (@intFromEnum(this.*) == @intFromEnum(other.*)) {
            inline for (bun.meta.EnumFields(LengthValue)) |field| {
                if (field.value == @intFromEnum(this.*)) {
                    const a = @field(this, field.name);
                    const b = @field(other, field.name);
                    return op_fn(ctx, a, b);
                }
            }
            unreachable;
        }

        const a = this.toPx();
        const b = this.toPx();
        if (a != null and b != null) {
            return op_fn(ctx, a.?, b.?);
        }
        return null;
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn tryAdd(this: *const LengthValue, _: std.mem.Allocator, rhs: *const LengthValue) ?LengthValue {
        if (@intFromEnum(this.*) == @intFromEnum(rhs.*)) {
            inline for (bun.meta.EnumFields(LengthValue)) |field| {
                if (field.value == @intFromEnum(this.*)) {
                    return @unionInit(LengthValue, field.name, @field(this, field.name) + @field(rhs, field.name));
                }
            }
            unreachable;
        }
        if (this.toPx()) |a| {
            if (rhs.toPx()) |b| {
                return .{ .px = a + b };
            }
        }
        return null;
    }
};

/// A CSS [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) value, with support for `calc()`.
pub const Length = union(enum) {
    /// An explicitly specified length value.
    value: LengthValue,
    /// A computed length value using `calc()`.
    calc: *Calc(Length),

    pub fn deepClone(this: *const Length, allocator: Allocator) Length {
        return switch (this.*) {
            .value => |v| .{ .value = v },
            .calc => |calc| .{ .calc = bun.create(allocator, Calc(Length), Calc(Length).deepClone(calc, allocator)) },
        };
    }

    pub fn deinit(this: *const Length, allocator: Allocator) void {
        return switch (this.*) {
            .calc => |calc| calc.deinit(allocator),
            .value => {},
        };
    }

    pub fn parse(input: *css.Parser) Result(Length) {
        if (input.tryParse(Calc(Length).parse, .{}).asValue()) |calc_value| {
            // PERF: I don't like this redundant allocation
            if (calc_value == .value) {
                var mutable: *Calc(Length) = @constCast(&calc_value);
                const ret = calc_value.value.*;
                mutable.deinit(input.allocator());
                return .{ .result = ret };
            }
            return .{ .result = .{
                .calc = bun.create(
                    input.allocator(),
                    Calc(Length),
                    calc_value,
                ),
            } };
        }

        const len = switch (LengthValue.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = .{ .value = len } };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return switch (this.*) {
            .value => |a| a.toCss(W, dest),
            .calc => |c| c.toCss(W, dest),
        };
    }

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return switch (this.*) {
            .value => |a| other.* == .value and a.eql(&other.value),
            .calc => |a| other.* == .calc and a.eql(other.calc),
        };
    }

    pub fn px(p: CSSNumber) Length {
        return .{ .value = .{ .px = p } };
    }

    pub fn mulF32(this: Length, allocator: Allocator, other: f32) Length {
        return switch (this) {
            .value => Length{ .value = this.value.mulF32(allocator, other) },
            .calc => Length{
                .calc = bun.create(
                    allocator,
                    Calc(Length),
                    this.calc.mulF32(allocator, other),
                ),
            },
        };
    }

    pub fn add(this: Length, allocator: Allocator, other: Length) Length {
        // Unwrap calc(...) functions so we can add inside.
        // Then wrap the result in a calc(...) again if necessary.
        const a = unwrapCalc(allocator, this);
        _ = a; // autofix
        const b = unwrapCalc(allocator, other);
        _ = b; // autofix
        @panic(css.todo_stuff.depth);
    }

    fn unwrapCalc(allocator: Allocator, length: Length) Length {
        return switch (length) {
            .calc => |c| switch (c.*) {
                .function => |f| switch (f.*) {
                    .calc => |c2| .{ .calc = bun.create(allocator, Calc(Length), c2) },
                    else => |c2| .{ .calc = bun.create(
                        allocator,
                        Calc(Length),
                        Calc(Length){ .function = bun.create(allocator, css.css_values.calc.MathFunction(Length), c2) },
                    ) },
                },
                else => .{ .calc = c },
            },
            else => length,
        };
    }

    pub fn trySign(this: *const Length) ?f32 {
        return switch (this.*) {
            .value => |v| v.sign(),
            .calc => |v| v.trySign(),
        };
    }

    pub fn partialCmp(this: *const Length, other: *const Length) ?std.math.Order {
        if (this.* == .value and other.* == .value) return css.generic.partialCmp(LengthValue, &this.value, &other.value);
        return null;
    }

    pub fn tryFromAngle(_: css.css_values.angle.Angle) ?@This() {
        return null;
    }

    pub fn tryMap(this: *const Length, comptime map_fn: *const fn (f32) f32) ?Length {
        return switch (this.*) {
            .value => |v| .{ .value = v.map(map_fn) },
            else => null,
        };
    }

    pub fn tryOp(
        this: *const Length,
        other: *const Length,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) f32,
    ) ?Length {
        if (this.* == .value and other.* == .value) {
            if (this.value.tryOp(&other.value, ctx, op_fn)) |val| return .{ .value = val };
            return null;
        }
        return null;
    }

    pub fn tryOpTo(
        this: *const Length,
        other: *const Length,
        comptime R: type,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) R,
    ) ?R {
        if (this.* == .value and other.* == .value) {
            return this.value.tryOpTo(&other.value, R, ctx, op_fn);
        }
        return null;
    }
};
