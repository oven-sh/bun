const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("../css_parser.zig");
pub const Error = css.Error;

const Percentage = css.css_values.percentage.Percentage;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Calc = css.css_values.calc.Calc;
const Angle = css.css_values.angle.Angle;

const Printer = css.Printer;
const PrintErr = css.PrintErr;

/// A CSS `<color>` value.
///
/// CSS supports many different color spaces to represent colors. The most common values
/// are stored as RGBA using a single byte per component. Less common values are stored
/// using a `Box` to reduce the amount of memory used per color.
///
/// Each color space is represented as a struct that implements the `From` and `Into` traits
/// for all other color spaces, so it is possible to convert between color spaces easily.
/// In addition, colors support interpolation as in the `color-mix()` function.
pub const CssColor = union(enum) {
    /// The `currentColor` keyword.
    current_color,
    /// A value in the RGB color space, including values parsed as hex colors, or the `rgb()`, `hsl()`, and `hwb()` functions.
    rgba: RGBA,
    /// A value in a LAB color space, including the `lab()`, `lch()`, `oklab()`, and `oklch()` functions.
    lab: *LABColor,
    /// A value in a predefined color space, e.g. `display-p3`.
    predefined: *PredefinedColor,
    /// A floating point representation of an RGB, HSL, or HWB color when it contains `none` components.
    float: *FloatColor,
    /// The `light-dark()` function.
    light_dark: struct {
        // TODO: why box the two fields separately? why not one allocation?
        light: *CssColor,
        dark: *CssColor,
    },
    /// A system color keyword.
    system: SystemColor,

    const This = @This();

    pub fn toCss(
        this: *const This,
        comptime W: type,
        dest: *Printer(W),
    ) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(css.todo_stuff.depth);
    }

    pub fn parse(input: *css.Parser) Error!CssColor {
        const location = input.currentSourceLocation();
        const token = try input.next();

        switch (token.*) {
            .hash, .idhash => |v| {
                const r, const g, const b, const a = css.color.parseHashColor(v) orelse return location.newUnexpectedTokenError(token.*);
                return .{
                    .rgba = RGBA.new(r, g, b, a),
                };
            },
            .ident => |value| {
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(value, "currentcolor")) {
                    return .current_color;
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(value, "transparent")) {
                    return .{
                        .rgba = RGBA.transparent(),
                    };
                } else {
                    if (css.color.parseNamedColor(value)) |named| {
                        const r, const g, const b = named;
                        return .{ .rgba = RGBA.new(r, g, b, 255.0) };
                    } else if (SystemColor.parseString(value)) |system_color| {
                        return .{ .system = system_color };
                    } else return location.newUnexpectedTokenError(token.*);
                }
            },
            .function => |name| css.color.parseColorFunction(location, name, input),
        }
    }

    pub fn deinit(this: CssColor) void {
        _ = this; // autofix
        @compileError(css.todo_stuff.depth);
    }

    pub fn clone(this: *const CssColor, allocator: Allocator) CssColor {
        _ = this; // autofix
        _ = allocator; // autofix
        @compileError(css.todo_stuff.depth);
    }

    pub fn toLightDark(this: *const CssColor, allocator: Allocator) CssColor {
        return switch (this.*) {
            .light_dark => this.clone(allocator),
            else => .{
                .light_dark = .{
                    .light = bun.create(allocator, CssColor, this.clone(allocator)),
                    .dark = bun.create(allocator, CssColor, this.clone(allocator)),
                },
            },
        };
    }

    /// Mixes this color with another color, including the specified amount of each.
    /// Implemented according to the [`color-mix()`](https://www.w3.org/TR/css-color-5/#color-mix) function.
    // PERF: these little allocations feel bad
    pub fn interpolate(
        this: *const CssColor,
        allocator: Allocator,
        comptime T: type,
        p1_: f32,
        other: *const CssColor,
        p2_: f32,
        method: HueInterpolationMethod,
    ) ?CssColor {
        var p1 = p1_;
        var p2 = p2_;

        if (this.* == .current_color or other.* == .current_color) {
            return null;
        }

        if (this.* == .light_dark or other.* == .light_dark) {
            const this_light_dark = this.toLightDark(allocator);
            const other_light_dark = this.toLightDark(allocator);

            const al = this_light_dark.light_dark.light;
            const ad = this_light_dark.light_dark.dark;

            const bl = other_light_dark.light_dark.light;
            const bd = other_light_dark.light_dark.dark;

            return .{
                .light_dark = .{
                    .light = bun.create(
                        allocator,
                        CssColor,
                        al.interpolate(allocator, T, p1, &bl, p2, method) orelse return null,
                    ),
                    .dark = bun.create(
                        allocator,
                        CssColor,
                        ad.interpolate(allocator, T, p1, &bd, p2, method) orelse return null,
                    ),
                },
            };
        }

        const check_converted = struct {
            fn run(color: *CssColor) bool {
                bun.debugAssert(color.* != .light_dark and color.* != .current_color and color.* != .system);
                return switch (color.*) {
                    .rgba => T == RGBA,
                    .lab => |lab| switch (lab.*) {
                        .lab => T == LAB,
                        .lch => T == LCH,
                        .oklab => T == OKLAB,
                        .oklch => T == OKLCH,
                    },
                    .predefined => |pre| switch (pre.*) {
                        .srgb => T == SRGB,
                        .srgb_linear => T == SRGBLinear,
                        .display_p3 => T == P3,
                        .a98 => T == A98,
                        .prophoto => T == ProPhoto,
                        .rec2020 => T == Rec2020,
                        .xyz_d50 => T == XYZd50,
                        .xyz_d65 => T == XYZd65,
                    },
                    .float => |f| switch (f.*) {
                        .rgb => T == SRGB,
                        .hsl => T == HSL,
                        .hwb => T == HWB,
                    },
                    .system => bun.Output.panic("Unreachable code: system colors cannot be converted to a color.\n\nThis is a bug in Bun's CSS color parser. Please file a bug report at https://github.com/oven-sh/bun/issues/new/choose", .{}),
                    // We checked these above
                    .light_dark, .current_color => unreachable,
                };
            }
        };

        const converted_first = check_converted.run(this);
        const converted_second = check_converted.run(other);

        // https://drafts.csswg.org/css-color-5/#color-mix-result
        var first_color = T.tryFromCssColor(this) catch return null;
        var second_color = T.tryFromCssColor(other) catch return null;

        if (converted_first and !first_color.inGamut()) {
            first_color = mapGamut(first_color);
        }

        if (converted_second and !second_color.inGamut()) {
            second_color = mapGamut(second_color);
        }

        // https://www.w3.org/TR/css-color-4/#powerless
        if (converted_first) {
            first_color.adjustPowerlessComponents();
        }

        if (converted_second) {
            second_color.adjustPowerlessComponents();
        }

        // https://drafts.csswg.org/css-color-4/#interpolation-missing
        first_color.fillMissingComponents(&second_color);
        second_color.fillMissingComponents(&first_color);

        // https://www.w3.org/TR/css-color-4/#hue-interpolation
        first_color.adjustJue(&second_color, method);

        // https://www.w3.org/TR/css-color-4/#interpolation-alpha
        first_color.premultiply();
        second_color.premultiply();

        // https://drafts.csswg.org/css-color-5/#color-mix-percent-norm
        var alpha_multiplier = p1 + p2;
        if (alpha_multiplier != 1.0) {
            p1 = p1 / alpha_multiplier;
            p2 = p2 / alpha_multiplier;
            if (alpha_multiplier > 1.0) {
                alpha_multiplier = 1.0;
            }
        }

        var result_color = first_color.interpolate(p1, &second_color, p2);

        result_color.unpremultiply(alpha_multiplier);

        return result_color.toCssColor();
    }
};

pub fn mapGamut(comptime T: type, color: T) T {
    _ = color; // autofix
    @compileError(css.todo_stuff.depth);
}

pub fn parseLab(
    comptime T: type,
    input: *css.Parser,
    parser: *ComponentParser,
    comptime func: *const fn (f32, f32, f32, f32) LABColor,
) Error!CssColor {
    const Closure = struct {
        parser: *ComponentParser,

        pub fn parsefn(this: *@This(), i: *css.Parser) Error!CssColor {
            return this.parser.parseRelative(i, T, CssColor, @This().innerfn, .{});
        }

        pub fn innerfn(i: *css.Parser, p: *ComponentParser) Error!CssColor {
            // f32::max() does not propagate NaN, so use clamp for now until f32::maximum() is stable.
            const l = std.math.clamp(try p.parsePercentage(input), 0.0, std.math.floatMax(f32));
            const a = try p.parseNumber(i);
            const b = try p.parseNumber(i);
            const alpha = try parseAlpha(i, p);
            const lab = func(l, a, b, alpha);
            const allocator: Allocator = {
                @compileError(css.todo_stuff.think_about_allocator);
            };
            const heap_lab = bun.create(allocator, LABColor, lab) catch unreachable;
            heap_lab.* = lab;
            return CssColor{ .lab = heap_lab };
        }
    };
    var closure = Closure{
        .parser = parser,
    };
    // https://www.w3.org/TR/css-color-4/#funcdef-lab
    return input.parseNestedBlock(
        T,
        &closure,
    );
}

pub fn parseLch(
    comptime T: type,
    input: *css.Parser,
    parser: *ComponentParser,
    comptime func: *const fn (
        f32,
        f32,
        f32,
        f32,
    ) LABColor,
) Error!CssColor {
    const Closure = struct {
        parser: *ComponentParser,

        pub fn parseNestedBlockFn(this: *@This(), i: *css.Parser) Error!CssColor {
            return this.parser.parseRelative(i, T, CssColor, @This().parseRelativeFn, .{this});
        }

        pub fn parseRelativeFn(i: *css.Parser, p: *ComponentParser, this: *@This()) Error!CssColor {
            _ = this; // autofix
            if (p.from) |from| {
                // Relative angles should be normalized.
                // https://www.w3.org/TR/css-color-5/#relative-LCH
                from.components[2] %= 360.0;
                if (from.components[2] < 0.0) {
                    from.components[2] += 360.0;
                }
            }

            const l = std.math.clamp(try parser.parsePercentage(i), 0.0, std.math.floatMax(f32));
            const c = std.math.clamp(try parser.parseNumber(i), 0.0, std.math.floatMax(f32));
            const h = try parseAngleOrNumber(i, p);
            const alpha = try parseAlpha(i, p);
            const lab = func(l, c, h, alpha);
            return .{
                .lab = bun.create(@compileError(css.todo_stuff.think_about_allocator), LABColor, lab),
            };
        }
    };

    var closure = Closure{
        .parser = parser,
    };

    return input.parseNestedBlock(T, &closure, Closure.parseNestedBlockFn);
}

/// Parses the hsl() and hwb() functions.
/// The results of this function are stored as floating point if there are any `none` components.
/// https://drafts.csswg.org/css-color-4/#the-hsl-notation
pub fn parseHslHwb(
    comptime T: type,
    input: *css.Parser,
    parser: *ComponentParser,
    allows_legacy: bool,
    comptime func: *const fn (
        f32,
        f32,
        f32,
        f32,
    ) CssColor,
) Error!CssColor {
    const Closure = struct {
        parser: *ComponentParser,
        allows_legacy: bool,

        pub fn parseNestedBlockFn(this: *@This(), i: *css.Parser) Error!CssColor {
            return this.parser.parseRelative(i, T, CssColor, @This().parseRelativeFn, .{this});
        }

        pub fn parseRelativeFn(i: *css.Parser, p: *ComponentParser, this: *@This()) Error!CssColor {
            const h, const a, const b, const is_legacy = try parseHslHwbComponents(T, i, p, this.allows_legacy);
            const alpha = if (is_legacy) try parseLegacyAlpha(i, p) else try parseAlpha(i, p);

            return func(h, a, b, alpha);
        }
    };

    var closure = Closure{
        .parser = parser,
        .allows_legacy = allows_legacy,
    };

    return input.parseNestedBlock(T, &closure, Closure.parseNestedBlockFn);
}

pub fn parseHslHwbComponents(
    comptime T: type,
    input: *css.Parser,
    parser: *ComponentParser,
    allows_legacy: bool,
) Error!struct { f32, f32, f32, bool } {
    _ = T; // autofix
    const h = try parseAngleOrNumber(input, parser);
    const is_legacy_syntax = allows_legacy and
        parser.from == null and
        !std.math.isNan(h) and
        (if (input.tryParse(css.Parser.expectComma, .{})) |_| true else false);

    const a = std.math.clamp(try parser.parsePercentage(input), 0.0, 1.0);

    if (is_legacy_syntax) {
        try input.expectComma();
    }

    const b = std.math.clamp(try parser.parsePercentage(input), 0.0, 1.0);

    if (is_legacy_syntax and (std.math.isNan(a) or std.math.isNan(b))) {
        return try input.newCustomError(css.ParserError.invalid_value);
    }

    return .{ h, a, b, is_legacy_syntax };
}

pub fn parseAngleOrNumber(input: *css.Parser, parser: *const ComponentParser) Error!f32 {
    // zack is here
    return switch (try parser.parseAngleOrNumber(input)) {
        .number => |v| v.value,
        .angle => |v| v.degrees,
    };
}

fn parseRgb(input: *css.Parser, parser: *ComponentParser) Error!CssColor {
    // https://drafts.csswg.org/css-color-4/#rgb-functions

    const Closure = struct {
        p: *ComponentParser,

        pub fn parseNestedBlockFn(this: *@This(), i: *css.Parser) Error!CssColor {
            this.p.parseRelative(i, SRGB, CssColor, @This().parseRelativeFn, .{this});
        }

        pub fn parseRelativeFn(i: *css.Parser, p: *css.Parser, this: *@This()) Error!CssColor {
            _ = i; // autofix
            _ = this; // autofix
            const r, const g, const b, const is_legacy = try parseRgbComponents(input, p);
            const alpha = if (is_legacy) try parseLegacyAlpha(input, p) else try parseAlpha(input, p);

            if (!std.math.isNan(r) and
                !std.math.isNan(g) and
                !std.math.isNan(b) and
                !std.math.isNan(alpha))
            {
                if (is_legacy) return .{
                    .rgba = RGBA.new(
                        @intCast(r),
                        @intCast(g),
                        @intCast(b),
                        @intCast(alpha),
                    ),
                };

                return .{
                    .rgba = RGBA.fromFloats(
                        r,
                        g,
                        b,
                        alpha,
                    ),
                };
            } else {
                return .{
                    .float = bun.create(
                        @compileError(css.todo_stuff.think_about_allocator),
                        FloatColor,
                        .{
                            .srgb = .{
                                .r = r,
                                .g = g,
                                .b = b,
                                .alpha = alpha,
                            },
                        },
                    ),
                };
            }
        }
    };
    var closure = Closure{
        .p = parser,
    };
    return input.parseNestedBlock(CssColor, &closure, Closure.parseNestedBlockFn);
}

pub fn parseRgbComponents(input: *css.Parser, parser: *ComponentParser) Error!struct {
    f32,
    f32,
    f32,
    bool,
} {
    const red = try parser.parseNumberOrPercentage(input);
    const is_legacy_syntax = parser.from == null and !std.math.isNan(red.value) and (if (input.tryParse(css.Parser.expectComma)) |_| true else false);

    const r, const g, const b = if (is_legacy_syntax) switch (red) {
        .number => |num| brk: {
            const r = std.math.clamp(@round(num.value), 0.0, 255.0);
            const g = std.math.clamp(@round(try parser.parseNumber(input)), 0.0, 255.0);
            try input.expectComma();
            const b = std.math.clamp(@round(try parser.parseNumber(input)), 0.0, 255.0);
            break :brk .{ r, g, b };
        },
        .percentage => |per| brk: {
            const unit_value = per.unit_value;
            const r = std.math.clamp(@round(unit_value * 255.0), 0.0, 255.0);
            const g = std.math.clamp(@round(try parser.parsePercentage(input) * 255.0), 0.0, 255.0);
            try input.expectComma();
            const b = std.math.clamp(@round(try parser.parsePercentage(input) * 255.0), 0.0, 255.0);
            break :brk .{ r, g, b };
        },
    } else brk: {
        const get = struct {
            pub fn component(value: NumberOrPercentage) f32 {
                return switch (value) {
                    .number => |num| {
                        const v = num.value;
                        if (std.math.isNan(v)) return v;
                        return std.math.clamp(@round(v), 0.0, 255.0) / 255.0;
                    },
                    .percentage => |per| std.math.clamp(per.unit_value, 0.0, 1.0),
                };
            }
        };
        const r = get.component(red);
        const g = get.component(try parser.parseNumberOrPercentage(input));
        const b = get.component(try parser.parseNumberOrPercentage(input));
        break :brk .{ r, g, b };
    };

    if (is_legacy_syntax and (std.math.isNan(g) or std.math.isNan(b))) {
        return input.newCustomError(css.ParserError.invalid_value);
    }

    return .{ r, g, b, is_legacy_syntax };
}

fn parseLegacyAlpha(input: *css.Parser, parser: *const ComponentParser) Error!f32 {
    if (!input.isExhausted()) {
        try input.expectComma();
        return std.math.clamp(try parseNumberOrPercentage(input, parser), 0.0, 1.0);
    }
    return 1.0;
}

fn parseAlpha(input: *css.Parser, parser: *const ComponentParser) Error!f32 {
    const res = if (input.tryParse(css.Parser.expectDelim, .{'/'}))
        std.math.clamp(try parseNumberOrPercentage(input, parser), 0.0, 1.0)
    else
        1.0;

    return res;
}

pub fn parseNumberOrPercentage(input: *css.Parser, parser: *const ComponentParser) Error!f32 {
    return switch (try parser.parseNumberOrPercentage(input)) {
        .number => |value| value.value,
        .percentage => |value| value.unit_value,
    };
}

pub fn parseeColorFunction(location: css.SourceLocation, function: []const u8, input: *css.Parser) Error!CssColor {
    var parser = ComponentParser.new(true);

    // css.todo_stuff.match_ignore_ascii_case;
    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "lab")) {
        return parseLab(LAB, input, &parser, LABColor.newLAB, .{});
    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "oklab")) {
        return parseLab(OKLAB, input, &parser, LABColor.newOKLAB, .{});
    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "lch")) {
        return parseLch(LCH, input, &parser, LABColor.newLCH, .{});
    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "oklch")) {
        return parseLch(OKLCH, input, &parser, LABColor.newOKLCH, .{});
    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "color")) {
        const predefined = try parsePredefined(input, &parser);
        return predefined;
    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "hsl") or
        bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "hsla"))
    {
        const Fn = struct {
            pub fn parsefn(h: f32, s: f32, l: f32, a: f32) CssColor {
                const hsl = HSL{ .h = h, .s = s, .l = l, .alpha = a };

                if (!std.math.isNan(h) and !std.math.isNan(s) and !std.math.isNan(l) and !std.math.isNan(a)) {
                    return .{ .rgba = hsl.intoRgba() };
                }

                return .{
                    .float = bun.create(
                        @compileError(css.todo_stuff.think_about_allocator),
                        FloatColor,
                        .{ .hsl = hsl },
                    ),
                };
            }
        };
        return parseHslHwb(HSL, input, &parser, true, Fn.parsefn);
    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "hwb")) {
        const Fn = struct {
            pub fn parsefn() void {}
        };
        return parseHslHwb(HWB, input, &parser, true, Fn.parsefn);
    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "rgb") or
        bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "rgba"))
    {
        return parseRgb(input, &parser);
    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "color-mix")) {
        return input.parseNestedBlock(CssColor, void, css.voidWrap(CssColor, parseColorMix));
    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(function, "light-dark")) {
        const Fn = struct {
            pub fn parsefn(_: void, i: *css.Parser) Error!CssColor {
                const light = switch (try CssColor.parse(i)) {
                    .light_dark => |c| c.light,
                    else => |light| bun.create(
                        @compileError(css.todo_stuff.think_about_allocator),
                        CssColor,
                        light,
                    ),
                };
                try i.expectComma();
                const dark = switch (try CssColor.parse(i)) {
                    .light_dark => |c| c.dark,
                    else => |dark| bun.create(
                        @compileError(css.todo_stuff.think_about_allocator),
                        CssColor,
                        dark,
                    ),
                };
                return .{
                    .light_dark = .{
                        .light = light,
                        .dark = dark,
                    },
                };
            }
        };
        return input.parseNestedBlock(CssColor, {}, Fn.parsefn);
    } else {
        return location.newUnexpectedTokenError(.{
            .ident = function,
        });
    }
}

// Copied from an older version of cssparser.
/// A color with red, green, blue, and alpha components, in a byte each.
pub const RGBA = struct {
    /// The red component.
    red: u8,
    /// The green component.
    green: u8,
    /// The blue component.
    blue: u8,
    /// The alpha component.
    alpha: u8,

    pub fn new(red: u8, green: u8, blue: u8, alpha: f32) RGBA {
        return RGBA{
            .red = red,
            .green = green,
            .blue = blue,
            .alpha = alpha,
        };
    }

    pub fn transparent() RGBA {
        return RGBA.new(0, 0, 0, 0.0);
    }
};

fn clamp_unit_f32(val: f32) u8 {
    // Whilst scaling by 256 and flooring would provide
    // an equal distribution of integers to percentage inputs,
    // this is not what Gecko does so we instead multiply by 255
    // and round (adding 0.5 and flooring is equivalent to rounding)
    //
    // Chrome does something similar for the alpha value, but not
    // the rgb values.
    //
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=1340484
    //
    // Clamping to 256 and rounding after would let 1.0 map to 256, and
    // `256.0_f32 as u8` is undefined behavior:
    //
    // https://github.com/rust-lang/rust/issues/10184
    return clamp_floor_256_f32(val * 255.0);
}

fn clamp_floor_256_f32(val: f32) u8 {
    return @intCast(@min(255.0, @max(0.0, @round(val))));
    //   val.round().max(0.).min(255.) as u8
}

/// A color in a LAB color space, including the `lab()`, `lch()`, `oklab()`, and `oklch()` functions.
pub const LABColor = union(enum) {
    /// A `lab()` color.
    lab: LAB,
    /// An `lch()` color.
    lch: LCH,
    /// An `oklab()` color.
    oklab: OKLAB,
    /// An `oklch()` color.
    oklch: OKLCH,

    pub fn newLAB(l: f32, a: f32, b: f32, alpha: f32) LABColor {
        return LABColor{
            .lab = LAB.new(l, a, b, alpha),
        };
    }

    pub fn newOKLAB(l: f32, a: f32, b: f32, alpha: f32) LABColor {
        return LABColor{
            .lab = OKLAB.new(l, a, b, alpha),
        };
    }

    pub fn newLCH(l: f32, a: f32, b: f32, alpha: f32) LABColor {
        return LABColor{
            .lab = LCH.new(l, a, b, alpha),
        };
    }

    pub fn newOKLCH(l: f32, a: f32, b: f32, alpha: f32) LABColor {
        return LABColor{
            .lab = LCH.new(l, a, b, alpha),
        };
    }
};

/// A color in a predefined color space, e.g. `display-p3`.
pub const PredefinedColor = union(enum) {
    /// A color in the `srgb` color space.
    srgb: SRGB,
    /// A color in the `srgb-linear` color space.
    srgb_linear: SRGBLinear,
    /// A color in the `display-p3` color space.
    display_p3: P3,
    /// A color in the `a98-rgb` color space.
    a98: A98,
    /// A color in the `prophoto-rgb` color space.
    prophoto: ProPhoto,
    /// A color in the `rec2020` color space.
    rec2020: Rec2020,
    /// A color in the `xyz-d50` color space.
    xyz_d50: XYZd50,
    /// A color in the `xyz-d65` color space.
    xyz_d65: XYZd65,
};

/// A floating point representation of color types that
/// are usually stored as RGBA. These are used when there
/// are any `none` components, which are represented as NaN.
pub const FloatColor = union(enum) {
    /// An RGB color.
    rgb: SRGB,
    /// An HSL color.
    hsl: HSL,
    /// An HWB color.
    hwb: HWB,
};

/// A CSS [system color](https://drafts.csswg.org/css-color/#css-system-colors) keyword.
pub const SystemColor = css.DefineEnumProperty(@compileError(css.todo_stuff.enum_property));

/// A color in the [CIE Lab](https://www.w3.org/TR/css-color-4/#cie-lab) color space.
pub const LAB = @compileError(css.todo_stuff.depth);

/// A color in the [`sRGB`](https://www.w3.org/TR/css-color-4/#predefined-sRGB) color space.
pub const SRGB = @compileError(css.todo_stuff.depth);

/// A color in the [`hsl`](https://www.w3.org/TR/css-color-4/#the-hsl-notation) color space.
pub const HSL = @compileError(css.todo_stuff.depth);

/// A color in the [`hwb`](https://www.w3.org/TR/css-color-4/#the-hwb-notation) color space.
pub const HWB = @compileError(css.todo_stuff.depth);

/// A color in the [`sRGB-linear`](https://www.w3.org/TR/css-color-4/#predefined-sRGB-linear) color space.
pub const SRGBLinear = @compileError(css.todo_stuff.depth);

/// A color in the [`display-p3`](https://www.w3.org/TR/css-color-4/#predefined-display-p3) color space.
pub const P3 = @compileError(css.todo_stuff.depth);

/// A color in the [`a98-rgb`](https://www.w3.org/TR/css-color-4/#predefined-a98-rgb) color space.
pub const A98 = @compileError(css.todo_stuff.depth);

/// A color in the [`prophoto-rgb`](https://www.w3.org/TR/css-color-4/#predefined-prophoto-rgb) color space.
pub const ProPhoto = @compileError(css.todo_stuff.depth);

/// A color in the [`rec2020`](https://www.w3.org/TR/css-color-4/#predefined-rec2020) color space.
pub const Rec2020 = @compileError(css.todo_stuff.depth);

/// A color in the [`xyz-d50`](https://www.w3.org/TR/css-color-4/#predefined-xyz) color space.
pub const XYZd50 = @compileError(css.todo_stuff.depth);

/// A color in the [`xyz-d65`](https://www.w3.org/TR/css-color-4/#predefined-xyz) color space.
pub const XYZd65 = @compileError(css.todo_stuff.depth);

/// A color in the [CIE LCH](https://www.w3.org/TR/css-color-4/#cie-lab) color space.
pub const LCH = @compileError(css.todo_stuff.depth);

/// A color in the [OKLab](https://www.w3.org/TR/css-color-4/#ok-lab) color space.
pub const OKLAB = @compileError(css.todo_stuff.depth);

/// A color in the [OKLCH](https://www.w3.org/TR/css-color-4/#ok-lab) color space.
pub const OKLCH = @compileError(css.todo_stuff.depth);

pub const ComponentParser = struct {
    allow_none: bool,
    from: ?RelativeComponentParser,

    pub fn new(allow_none: bool) ComponentParser {
        return ComponentParser{
            .allow_none = allow_none,
            .from = null,
        };
    }

    pub fn parseRelative(
        this: *ComponentParser,
        input: *css.Parser,
        comptime T: type,
        comptime C: type,
        comptime func: anytype,
        args_: anytype,
    ) Error!C {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"from"})) {
            const from = try CssColor.parse(input);
            return this.parseFrom(from, input, T, C, func, args_);
        }

        const args = bun.meta.ConcatArgs2(func, input, this, args_);
        return @call(.auto, func, args);
    }

    pub fn parseFrom(
        this: *ComponentParser,
        from: CssColor,
        input: *css.Parser,
        comptime T: type,
        comptime C: type,
        comptime func: anytype,
        args_: anytype,
    ) Error!C {
        if (from == .light_dark) {
            const state = input.state();
            const light = try this.parseFrom(from.light_dark.light.*, input, T, C, func, args_);
            input.reset(&state);
            const dark = try this.parseFrom(from.light_dark.dark.*, input, T, C, func, args_);
            return C.LightDarkColor.lightDark(light, dark);
        }

        const new_from = (T.tryFromCssColor(from) catch {
            @compileError(css.todo_stuff.errors);
        }).resolve();

        this.from = RelativeComponentParser.new(&new_from);

        const args = bun.meta.ConcatArgs2(func, input, this, args_);
        return @call(.auto, func, args);
    }

    pub fn parseNumberOrPercentage(this: *const ComponentParser, input: *css.Parser) Error!NumberOrPercentage {
        if (this.from) |*from| {
            if (input.tryParse(RelativeComponentParser.parseNumberOrPercentage, .{from})) |res| {
                return res;
            }
        }

        if (input.tryParse(CSSNumberFns.parse, .{})) |value| {
            return NumberOrPercentage{ .number = value };
        } else if (input.tryParse(Percentage.parse, .{})) |value| {
            return NumberOrPercentage{
                .percentage = .{ .unit_value = value.v },
            };
        } else if (this.allow_none) {
            try input.expectIdentMatching("none");
            return NumberOrPercentage{
                .number = .{
                    .value = std.math.nan(f32),
                },
            };
        } else {
            return try input.newCustomError(css.ParserError.invalid_value);
        }
    }

    pub fn parseAngleOrNumber(this: *ComponentParser, input: *css.Parser) Error!css.color.AngleOrNumber {
        if (this.from) |from| {
            if (input.tryParse(RelativeComponentParser.parseAngleOrNumber, .{from})) |res| {
                return res;
            }
        }

        if (input.tryParse(Angle.parse, .{})) |angle| {
            return .{
                .angle = .{
                    .degrees = angle.toDegrees(),
                },
            };
        } else if (input.tryParse(CSSNumberFns.parse, .{})) |value| {
            return .{
                .number = .{
                    .value = value,
                },
            };
        } else if (this.allow_none) {
            try input.expectIdentMatching("none");
            return .{ .number = .{
                .value = std.math.nan(f32),
            } };
        } else {
            return try input.newCustomError(css.ParserError.invalid_value);
        }
    }
};

/// Either a number or a percentage.
pub const NumberOrPercentage = union(enum) {
    /// `<number>`.
    number: struct {
        /// The numeric value parsed, as a float.
        value: f32,
    },
    /// `<percentage>`
    percentage: struct {
        /// The value as a float, divided by 100 so that the nominal range is
        /// 0.0 to 1.0.
        unit_value: f32,
    },
};

const RelativeComponentParser = struct {
    names: struct { []const u8, []const u8, []const u8 },
    components: struct { f32, f32, f32, f32 },
    types: struct { ChannelType, ChannelType, ChannelType, ChannelType },

    pub fn parseAngleOrNumber(input: *css.Parser, this: *const RelativeComponentParser) Error!css.color.AngleOrNumber {
        _ = input; // autofix
        _ = this; // autofix
        @compileError(css.todo_stuff.depth);
    }

    pub fn parseNumberOrPercentage(input: *css.Parser, this: *const RelativeComponentParser) Error!NumberOrPercentage {
        if (input.tryParse(RelativeComponentParser.parseIdent, .{ this, ChannelType{ .percentage = true, .number = true } })) |value| {
            return NumberOrPercentage{ .percentage = .{ .unit_value = value } };
        }

        if (input.tryParse(RelativeComponentParser.parseCalc, .{ this, ChannelType{ .percentage = true, .number = true } })) |value| {
            return NumberOrPercentage{
                .percentage = .{
                    .unit_value = value,
                },
            };
        }

        {
            const Closure = struct {
                parser: *const RelativeComponentParser,
                percentage: Percentage = 0,

                pub fn parsefn(i: *css.Parser, self: *@This()) Error!Percentage {
                    if (Calc(Percentage).parseWith(i, self, @This().calcparseident)) |calc_value| {
                        if (calc_value == .value) return calc_value.value.*;
                    }
                    return i.newCustomError(css.ParserError.invalid_value);
                }

                pub fn calcparseident(self: *@This(), ident: []const u8) ?Calc(Percentage) {
                    const v = self.parser.getIdent(ident, ChannelType{ .percentage = true, .number = true }) orelse return null;
                    self.percentage = v;
                    // value variant is a *Percentage
                    // but we immediately dereference it and discard the pointer
                    // so using a field on this closure struct instead of making a gratuitous allocation
                    return .{
                        .value = &self.percentage,
                    };
                }
            };
            var closure = Closure{
                .parser = this,
            };
            if (input.tryParse(Closure.parsefn, .{
                &closure,
            })) |value| {
                return NumberOrPercentage{
                    .percentage = .{
                        .unit_value = value,
                    },
                };
            }
        }

        return input.newErrorForNextToken();
    }

    pub fn getIdent(
        this: *const RelativeComponentParser,
        ident: []const u8,
        allowed_types: ChannelType,
    ) ?f32 {
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, this.names[0]) and allowed_types.intersects(this.types[0])) {
            return this.components[0];
        }

        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, this.names[1]) and allowed_types.intersects(this.types[1])) {
            return this.components[1];
        }

        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, this.names[2]) and allowed_types.intersects(this.types[2])) {
            return this.components[2];
        }

        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "alpha") and allowed_types.intersects(ChannelType{ .percentage = true })) {
            return this.components[3];
        }

        return null;
    }
};

/// A channel type for a color space.
pub const ChannelType = packed struct(u8) {
    /// Channel represents a percentage.
    percentage: bool = false,
    /// Channel represents an angle.
    angle: bool = false,
    /// Channel represents a number.
    number: bool = false,
};

pub fn parsePredefined(input: *css.Parser, parser: *ComponentParser) Error!CssColor {
    _ = input; // autofix
    _ = parser; // autofix
    @compileError(css.todo_stuff.depth);
}

/// A [color space](https://www.w3.org/TR/css-color-4/#interpolation-space) keyword
/// used in interpolation functions such as `color-mix()`.
pub const ColorSpaceName = union(enum) {
    srgb,
    @"srgb-linear",
    lab,
    oklab,
    xyz,
    @"xyz-d50",
    @"xyz-d65",
    hsl,
    hwb,
    lch,
    oklch,

    pub usingnamespace css.DefineEnumProperty(@This());
};

pub fn parseColorMix(input: *css.Parser) Error!CssColor {
    try input.expectIdentMatching("in");
    const method = try ColorSpaceName.parse(input);

    const hue_method_ = if (switch (method) {
        .hsl, .hwb, .lch, .oklch => true,
        else => false,
    }) brk: {
        const hue_method = input.tryParse(HueInterpolationMethod.parse, .{});
        if (hue_method) |_| {
            try input.expectIdentMatching("hue");
        }
        break :brk hue_method;
    } else HueInterpolationMethod.shorter;

    const hue_method = hue_method_ orelse HueInterpolationMethod.shorter;

    const first_percent_ = input.tryParse(css.Parser.expectPercentage, .{});
    const first_color = try CssColor.parse(input);
    const first_percent = first_percent_ catch first_percent: {
        break :first_percent input.tryParse(css.Parser.expectPercentage, .{}) catch null;
    };
    try input.expectComma();

    const second_percent_ = input.tryParse(css.Parser.expectPercentage, .{});
    const second_color = try CssColor.parse(input);
    const second_percent = second_percent_ catch first_percent: {
        break :first_percent input.tryParse(css.Parser.expectPercentage, .{}) catch null;
    };

    // https://drafts.csswg.org/css-color-5/#color-mix-percent-norm
    const p1, const p2 = if (first_percent == null and second_percent == null) .{ 0.5, 0.5 } else brk: {
        const p2 = second_percent orelse (1.0 - first_percent.?);
        const p1 = first_percent orelse (1.0 - second_percent.?);
        break :brk .{ p1, p2 };
    };

    if ((p1 + p2) == 0.0) return input.newCustomError(css.ParserError.invalid_value);

    return (switch (method) {
        .srgb => first_color.interpolate(SRGB, p1, &second_color, p2, hue_method),
        .@"srgb-linear" => first_color.interpolate(SRGBLinear, p1, &second_color, p2, hue_method),
        .hsl => first_color.interpolate(HSL, p1, &second_color, p2, hue_method),
        .hwb => first_color.interpolate(HWB, p1, &second_color, p2, hue_method),
        .lab => first_color.interpolate(LAB, p1, &second_color, p2, hue_method),
        .lch => first_color.interpolate(LCH, p1, &second_color, p2, hue_method),
        .oklab => first_color.interpolate(OKLAB, p1, &second_color, p2, hue_method),
        .oklch => first_color.interpolate(OKLCH, p1, &second_color, p2, hue_method),
        .xyz, .@"xyz-d65" => first_color.interpolate(XYZd65, p1, &second_color, p2, hue_method),
        .@"xyz-d50" => first_color.interpolate(XYZd65, p1, &second_color, p2, hue_method),
    }) orelse {
        return try input.newCustomError(css.ParserError.invalid_value);
    };
}

/// A hue [interpolation method](https://www.w3.org/TR/css-color-4/#typedef-hue-interpolation-method)
/// used in interpolation functions such as `color-mix()`.
pub const HueInterpolationMethod = enum {
    /// Angles are adjusted so that θ₂ - θ₁ ∈ [-180, 180].
    shorter,
    /// Angles are adjusted so that θ₂ - θ₁ ∈ {0, [180, 360)}.
    longer,
    /// Angles are adjusted so that θ₂ - θ₁ ∈ [0, 360).
    increasing,
    /// Angles are adjusted so that θ₂ - θ₁ ∈ (-360, 0].
    decreasing,
    /// No fixup is performed. Angles are interpolated in the same way as every other component.
    specified,
    @"converts-to-kebab",

    pub usingnamespace css.DefineEnumProperty(@This());
};
