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

/// Either a [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) or a [`<number>`](https://www.w3.org/TR/css-values-4/#numbers).
pub const LengthOrNumber = union(enum) {
    /// A number.
    number: CSSNumber,
    /// A length.
    length: Length,
};

pub const LengthPercentage = DimensionPercentage(LengthValue);
/// Either a [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage), or the `auto` keyword.
pub const LengthPercentageOrAuto = union(enum) {
    /// The `auto` keyword.
    auto,
    /// A [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage).
    length: LengthPercentage,
};

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
                inline for (std.meta.fields(@This())) |field| {
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(field.name, dim.unit)) {
                        return @unionInit(LengthValue, field.name, dim.num.value);
                    }
                }
            },
            .number => |*num| return .{ .result = .{ .px = num.value } },
        }
        return location.newUnexpectedTokenError(token.*);
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

    pub fn tryFromToken(token: *const css.Token) Result(@This()) {
        switch (token.*) {
            .dimension => |*dim| {
                inline for (std.meta.fields(@This())) |field| {
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(field.name, dim.unit)) {
                        return @unionInit(LengthValue, field.name, dim.num.value);
                    }
                }
            },
            else => {},
        }
        @compileError(css.todo_stuff.errors);
    }

    pub fn toUnitValue(this: *const @This()) struct { CSSNumber, []const u8 } {
        inline for (std.meta.fields(@This())) |field| {
            if (@field(this, field.value) == @intFromEnum(this.*)) {
                return .{ @field(this, field.name), field.name };
            }
        }
    }

    pub fn mulF32(this: *const @This(), other: f32) Length {
        const val = val: {
            inline for (std.meta.fields(@This())) |field| {
                if (@field(this, field.value) == @intFromEnum(this.*)) {
                    break :val @field(this, field.name);
                }
            }
        };
        return val * other;
    }
};

/// A CSS [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) value, with support for `calc()`.
pub const Length = union(enum) {
    /// An explicitly specified length value.
    value: LengthValue,
    /// A computed length value using `calc()`.
    calc: *Calc(Length),

    pub fn mulF32(this: *const Length, other: f32) Length {
        return switch (this.*) {
            .value => Length{ .value = this.value * other },
            .calc => Length{
                .calc = bun.create(
                    @compileError(css.todo_stuff.think_about_allocator),
                    Calc(Length),
                    this.calc.* * other,
                ),
            },
        };
    }

    pub fn parse(input: *css.Parser) Result(Length) {
        if (input.tryParse(Calc(Length).parse, .{}).asValue()) |calc_value| {
            // PERF: I don't like this redundant allocation
            if (calc_value == .value) return .{ .calc = calc_value.value.* };
            return .{
                .calc = bun.create(
                    @compileError(css.todo_stuff.think_about_allocator),
                    Calc(Length),
                    calc_value,
                ),
            };
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
};
