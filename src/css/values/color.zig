const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("bun");
const bits = bun.bits;

pub const css = @import("../css_parser.zig");
pub const Result = css.Result;

const Percentage = css.css_values.percentage.Percentage;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Calc = css.css_values.calc.Calc;
const Angle = css.css_values.angle.Angle;

const Printer = css.Printer;
const PrintErr = css.PrintErr;

pub fn UnboundedColorGamut(comptime T: type) type {
    return struct {
        pub fn inGamut(_: *const T) bool {
            return true;
        }

        pub fn clip(this: *const T) T {
            return this.*;
        }
    };
}

pub fn HslHwbColorGamut(comptime T: type, comptime a: []const u8, comptime b: []const u8) type {
    return struct {
        pub fn inGamut(this: *const T) bool {
            return @field(this, a) >= 0.0 and
                @field(this, a) <= 1.0 and
                @field(this, b) >= 0.0 and
                @field(this, b) <= 1.0;
        }

        pub fn clip(this: *const T) T {
            var result: T = this.*;
            // result.h = this.h % 360.0;
            result.h = @mod(this.h, 360.0);
            @field(result, a) = bun.clamp(@field(this, a), 0.0, 1.0);
            @field(result, b) = bun.clamp(@field(this, b), 0.0, 1.0);
            result.alpha = bun.clamp(this.alpha, 0.0, 1.0);
            return result;
        }
    };
}

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

        pub fn takeLightFreeDark(this: *const @This(), allocator: Allocator) *CssColor {
            const ret = this.light;
            this.dark.deinit(allocator);
            allocator.destroy(this.dark);
            return ret;
        }

        pub fn takeDarkFreeLight(this: *const @This(), allocator: Allocator) *CssColor {
            const ret = this.dark;
            this.light.deinit(allocator);
            allocator.destroy(this.light);
            return ret;
        }

        pub fn __generateHash() void {}
    },
    /// A system color keyword.
    system: SystemColor,

    const This = @This();

    pub const jsFunctionColor = @import("./color_js.zig").jsFunctionColor;

    pub fn isCompatible(this: *const CssColor, browsers: css.targets.Browsers) bool {
        return switch (this.*) {
            .current_color, .rgba, .float => true,
            .lab => |lab| switch (lab.*) {
                .lab, .lch => css.Feature.isCompatible(.lab_colors, browsers),
                .oklab, .oklch => css.Feature.isCompatible(.oklab_colors, browsers),
            },
            .predefined => |predefined| switch (predefined.*) {
                .display_p3 => css.Feature.isCompatible(.p3_colors, browsers),
                else => css.Feature.isCompatible(.color_function, browsers),
            },
            .light_dark => |light_dark| css.Feature.isCompatible(.light_dark, browsers) and
                light_dark.light.isCompatible(browsers) and
                light_dark.dark.isCompatible(browsers),
            .system => |system| system.isCompatible(browsers),
        };
    }

    pub fn toCss(
        this: *const This,
        comptime W: type,
        dest: *Printer(W),
    ) PrintErr!void {
        switch (this.*) {
            .current_color => try dest.writeStr("currentColor"),
            .rgba => |*color| {
                if (color.alpha == 255) {
                    const hex: u32 = (@as(u32, color.red) << 16) | (@as(u32, color.green) << 8) | @as(u32, color.blue);
                    if (shortColorName(hex)) |name| return dest.writeStr(name);

                    const compact = compactHex(hex);
                    if (hex == expandHex(compact)) {
                        try dest.writeFmt("#{x:0>3}", .{compact});
                    } else {
                        try dest.writeFmt("#{x:0>6}", .{hex});
                    }
                } else {
                    // If the #rrggbbaa syntax is not supported by the browser targets, output rgba()
                    if (dest.targets.shouldCompileSame(.hex_alpha_colors)) {
                        // If the browser doesn't support `#rrggbbaa` color syntax, it is converted to `transparent` when compressed(minify = true).
                        // https://www.w3.org/TR/css-color-4/#transparent-black
                        if (dest.minify and color.red == 0 and color.green == 0 and color.blue == 0 and color.alpha == 0) {
                            return dest.writeStr("transparent");
                        } else {
                            try dest.writeFmt("rgba({d}", .{color.red});
                            try dest.delim(',', false);
                            try dest.writeFmt("{d}", .{color.green});
                            try dest.delim(',', false);
                            try dest.writeFmt("{d}", .{color.blue});
                            try dest.delim(',', false);

                            // Try first with two decimal places, then with three.
                            var rounded_alpha = @round(color.alphaF32() * 100.0) / 100.0;
                            const clamped: u8 = @intFromFloat(@min(
                                @max(
                                    @round(rounded_alpha * 255.0),
                                    0.0,
                                ),
                                255.0,
                            ));
                            if (clamped != color.alpha) {
                                rounded_alpha = @round(color.alphaF32() * 1000.0) / 1000.0;
                            }

                            try CSSNumberFns.toCss(&rounded_alpha, W, dest);
                            try dest.writeChar(')');
                            return;
                        }
                    }

                    const hex: u32 = (@as(u32, color.red) << 24) |
                        (@as(u32, color.green) << 16) |
                        (@as(u32, color.blue) << 8) |
                        (@as(u32, color.alpha));
                    const compact = compactHex(hex);
                    if (hex == expandHex(compact)) {
                        try dest.writeFmt("#{x:0>4}", .{compact});
                    } else {
                        try dest.writeFmt("#{x:0>8}", .{hex});
                    }
                }
                return;
            },
            .lab => |_lab| {
                return switch (_lab.*) {
                    .lab => |*lab| writeComponents(
                        "lab",
                        lab.l,
                        lab.a,
                        lab.b,
                        lab.alpha,
                        W,
                        dest,
                    ),
                    .lch => |*lch| writeComponents(
                        "lch",
                        lch.l,
                        lch.c,
                        lch.h,
                        lch.alpha,
                        W,
                        dest,
                    ),
                    .oklab => |*oklab| writeComponents(
                        "oklab",
                        oklab.l,
                        oklab.a,
                        oklab.b,
                        oklab.alpha,
                        W,
                        dest,
                    ),
                    .oklch => |*oklch| writeComponents(
                        "oklch",
                        oklch.l,
                        oklch.c,
                        oklch.h,
                        oklch.alpha,
                        W,
                        dest,
                    ),
                };
            },
            .predefined => |predefined| return writePredefined(predefined, W, dest),
            .float => |*float| {
                // Serialize as hex.
                const srgb = SRGB.fromFloatColor(float.*);
                const as_css_color = srgb.intoCssColor(dest.allocator);
                defer as_css_color.deinit(dest.allocator);
                try as_css_color.toCss(W, dest);
            },
            .light_dark => |*light_dark| {
                if (!dest.targets.isCompatible(css.compat.Feature.light_dark)) {
                    try dest.writeStr("var(--buncss-light");
                    try dest.delim(',', false);
                    try light_dark.light.toCss(W, dest);
                    try dest.writeChar(')');
                    try dest.whitespace();
                    try dest.writeStr("var(--buncss-dark");
                    try dest.delim(',', false);
                    try light_dark.dark.toCss(W, dest);
                    return dest.writeChar(')');
                }

                try dest.writeStr("light-dark(");
                try light_dark.light.toCss(W, dest);
                try dest.delim(',', false);
                try light_dark.dark.toCss(W, dest);
                return dest.writeChar(')');
            },
            .system => |*system| return system.toCss(W, dest),
        }
    }

    pub const ParseResult = Result(CssColor);
    pub fn parse(input: *css.Parser) ParseResult {
        const location = input.currentSourceLocation();
        const token = switch (input.next()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };

        switch (token.*) {
            .unrestrictedhash, .idhash => |v| {
                const r, const g, const b, const a = css.color.parseHashColor(v) orelse return .{ .err = location.newUnexpectedTokenError(token.*) };
                return .{ .result = .{
                    .rgba = RGBA.new(r, g, b, a),
                } };
            },
            .ident => |value| {
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(value, "currentcolor")) {
                    return .{ .result = .current_color };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(value, "transparent")) {
                    return .{ .result = .{
                        .rgba = RGBA.transparent(),
                    } };
                } else {
                    if (css.color.parseNamedColor(value)) |named| {
                        const r, const g, const b = named;
                        return .{ .result = .{ .rgba = RGBA.new(r, g, b, 255.0) } };
                        // } else if (SystemColor.parseString(value)) |system_color| {
                    } else if (css.parse_utility.parseString(input.allocator(), SystemColor, value, SystemColor.parse).asValue()) |system_color| {
                        return .{ .result = .{ .system = system_color } };
                    } else return .{ .err = location.newUnexpectedTokenError(token.*) };
                }
            },
            .function => |name| return parseColorFunction(location, name, input),
            else => return .{
                .err = location.newUnexpectedTokenError(token.*),
            },
        }
    }

    pub fn deinit(this: CssColor, allocator: Allocator) void {
        switch (this) {
            .current_color => {},
            .rgba => {},
            .lab => {
                allocator.destroy(this.lab);
            },
            .predefined => {
                allocator.destroy(this.predefined);
            },
            .float => {
                allocator.destroy(this.float);
            },
            .light_dark => {
                this.light_dark.light.deinit(allocator);
                this.light_dark.dark.deinit(allocator);
                allocator.destroy(this.light_dark.light);
                allocator.destroy(this.light_dark.dark);
            },
            .system => {},
        }
    }

    pub fn deepClone(this: *const CssColor, allocator: Allocator) CssColor {
        return switch (this.*) {
            .current_color => .current_color,
            .rgba => |rgba| CssColor{ .rgba = rgba },
            .lab => |lab| CssColor{ .lab = bun.create(allocator, LABColor, lab.*) },
            .predefined => |pre| CssColor{ .predefined = bun.create(allocator, PredefinedColor, pre.*) },
            .float => |float| CssColor{ .float = bun.create(allocator, FloatColor, float.*) },
            .light_dark => CssColor{
                .light_dark = .{
                    .light = bun.create(allocator, CssColor, this.light_dark.light.deepClone(allocator)),
                    .dark = bun.create(allocator, CssColor, this.light_dark.dark.deepClone(allocator)),
                },
            },
            .system => |sys| CssColor{ .system = sys },
        };
    }

    pub fn toLightDark(this: *const CssColor, allocator: Allocator) CssColor {
        return switch (this.*) {
            .light_dark => this.deepClone(allocator),
            else => .{
                .light_dark = .{
                    .light = bun.create(allocator, CssColor, this.deepClone(allocator)),
                    .dark = bun.create(allocator, CssColor, this.deepClone(allocator)),
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
            const other_light_dark = other.toLightDark(allocator);

            const al = this_light_dark.light_dark.light;
            const ad = this_light_dark.light_dark.dark;

            const bl = other_light_dark.light_dark.light;
            const bd = other_light_dark.light_dark.dark;

            return .{
                .light_dark = .{
                    .light = bun.create(
                        allocator,
                        CssColor,
                        al.interpolate(allocator, T, p1, bl, p2, method) orelse return null,
                    ),
                    .dark = bun.create(
                        allocator,
                        CssColor,
                        ad.interpolate(allocator, T, p1, bd, p2, method) orelse return null,
                    ),
                },
            };
        }

        const check_converted = struct {
            fn run(color: *const CssColor) bool {
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
        var first_color = T.tryFromCssColor(this) orelse return null;
        var second_color = T.tryFromCssColor(other) orelse return null;

        if (converted_first and !first_color.inGamut()) {
            first_color = mapGamut(T, first_color);
        }

        if (converted_second and !second_color.inGamut()) {
            second_color = mapGamut(T, second_color);
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
        first_color.adjustHue(&second_color, method);

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

        return result_color.intoCssColor(allocator);
    }

    pub fn lightDarkOwned(allocator: Allocator, light: CssColor, dark: CssColor) CssColor {
        return CssColor{
            .light_dark = .{
                .light = bun.create(allocator, CssColor, light),
                .dark = bun.create(allocator, CssColor, dark),
            },
        };
    }

    pub fn getFallback(this: *const @This(), allocator: Allocator, kind: ColorFallbackKind) CssColor {
        if (this.* == .rgba) return this.deepClone(allocator);

        return switch (kind.asBits()) {
            ColorFallbackKind.RGB.asBits() => this.toRGB(allocator).?,
            ColorFallbackKind.P3.asBits() => this.toP3(allocator).?,
            ColorFallbackKind.LAB.asBits() => this.toLAB(allocator).?,
            else => bun.unreachablePanic("Expected RGBA, P3, LAB fallback. This is a bug in Bun.", .{}),
        };
    }

    pub fn getFallbacks(this: *@This(), allocator: Allocator, targets: css.targets.Targets) css.SmallList(CssColor, 2) {
        const fallbacks = this.getNecessaryFallbacks(targets);

        var res = css.SmallList(CssColor, 2){};

        if (fallbacks.rgb) {
            res.appendAssumeCapacity(this.toRGB(allocator).?);
        }

        if (fallbacks.p3) {
            res.appendAssumeCapacity(this.toP3(allocator).?);
        }

        if (fallbacks.lab) {
            const foo = this.toLAB(allocator).?;
            this.* = foo;
        }

        return res;
    }

    /// Returns the color fallback types needed for the given browser targets.
    pub fn getNecessaryFallbacks(this: *const @This(), targets: css.targets.Targets) ColorFallbackKind {
        // Get the full set of possible fallbacks, and remove the highest one, which
        // will replace the original declaration. The remaining fallbacks need to be added.
        const fallbacks = this.getPossibleFallbacks(targets);
        return fallbacks.difference(fallbacks.highest());
    }

    pub fn getPossibleFallbacks(this: *const @This(), targets: css.targets.Targets) ColorFallbackKind {
        // Fallbacks occur in levels: Oklab -> Lab -> P3 -> RGB. We start with all levels
        // below and including the authored color space, and remove the ones that aren't
        // compatible with our browser targets.
        var fallbacks = switch (this.*) {
            .current_color, .rgba, .float, .system => return ColorFallbackKind{},
            .lab => |lab| brk: {
                if (lab.* == .lab or lab.* == .lch and targets.shouldCompileSame(.lab_colors))
                    break :brk ColorFallbackKind.andBelow(.{ .lab = true });
                if (lab.* == .oklab or lab.* == .oklch and targets.shouldCompileSame(.oklab_colors))
                    break :brk ColorFallbackKind.andBelow(.{ .oklab = true });
                return ColorFallbackKind{};
            },
            .predefined => |predefined| brk: {
                if (predefined.* == .display_p3 and targets.shouldCompileSame(.p3_colors)) break :brk ColorFallbackKind.andBelow(.{ .p3 = true });
                if (targets.shouldCompileSame(.color_function)) break :brk ColorFallbackKind.andBelow(.{ .lab = true });
                return ColorFallbackKind{};
            },
            .light_dark => |*ld| {
                return bun.bits.@"or"(ColorFallbackKind, ld.light.getPossibleFallbacks(targets), ld.dark.getPossibleFallbacks(targets));
            },
        };

        if (fallbacks.oklab) {
            if (!targets.shouldCompileSame(.oklab_colors)) {
                fallbacks = fallbacks.difference(ColorFallbackKind.andBelow(.{ .lab = true }));
            }
        }

        if (fallbacks.lab) {
            if (!targets.shouldCompileSame(.lab_colors)) {
                fallbacks = fallbacks.difference(ColorFallbackKind.andBelow(.{ .p3 = true }));
            } else if (targets.browsers != null and css.compat.Feature.isPartiallyCompatible(&css.compat.Feature.lab_colors, targets.browsers.?)) {
                // We don't need P3 if Lab is supported by some of our targets.
                // No browser implements Lab but not P3.
                fallbacks.p3 = false;
            }
        }

        if (fallbacks.p3) {
            if (!targets.shouldCompileSame(.p3_colors)) {
                fallbacks.rgb = false;
            } else if (fallbacks.highest() != ColorFallbackKind.P3 and
                (targets.browsers == null or !css.compat.Feature.isPartiallyCompatible(&css.compat.Feature.p3_colors, targets.browsers.?)))
            {
                // Remove P3 if it isn't supported by any targets, and wasn't the
                // original authored color.
                fallbacks.p3 = false;
            }
        }

        return fallbacks;
    }

    pub fn default() @This() {
        return .{ .rgba = RGBA.transparent() };
    }

    pub fn eql(this: *const This, other: *const This) bool {
        if (@intFromEnum(this.*) != @intFromEnum(other.*)) return false;

        return switch (this.*) {
            .current_color => true,
            .rgba => std.meta.eql(this.rgba, other.rgba),
            .lab => std.meta.eql(this.lab.*, other.lab.*),
            .predefined => std.meta.eql(this.predefined.*, other.predefined.*),
            .float => std.meta.eql(this.float.*, other.float.*),
            .light_dark => this.light_dark.light.eql(other.light_dark.light) and this.light_dark.dark.eql(other.light_dark.dark),
            .system => this.system == other.system,
        };
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn toRGB(this: *const @This(), allocator: Allocator) ?CssColor {
        if (this.* == .light_dark) {
            return CssColor{ .light_dark = .{
                .light = bun.create(allocator, CssColor, this.light_dark.light.toRGB(allocator) orelse return null),
                .dark = bun.create(allocator, CssColor, this.light_dark.dark.toRGB(allocator) orelse return null),
            } };
        }
        return CssColor{ .rgba = RGBA.tryFromCssColor(this) orelse return null };
    }

    pub fn toP3(this: *const @This(), allocator: Allocator) ?CssColor {
        return switch (this.*) {
            .light_dark => |ld| blk: {
                const light = ld.light.toP3(allocator) orelse break :blk null;
                const dark = ld.dark.toP3(allocator) orelse break :blk null;
                break :blk .{
                    .light_dark = .{
                        .light = bun.create(allocator, CssColor, light),
                        .dark = bun.create(allocator, CssColor, dark),
                    },
                };
            },
            else => return .{ .predefined = bun.create(allocator, PredefinedColor, .{ .display_p3 = P3.tryFromCssColor(this) orelse return null }) },
        };
    }

    pub fn toLAB(this: *const @This(), allocator: Allocator) ?CssColor {
        return switch (this.*) {
            .light_dark => |ld| blk: {
                const light = ld.light.toLAB(allocator) orelse break :blk null;
                const dark = ld.dark.toLAB(allocator) orelse break :blk null;
                break :blk .{
                    .light_dark = .{
                        .light = bun.create(allocator, CssColor, light),
                        .dark = bun.create(allocator, CssColor, dark),
                    },
                };
            },
            else => .{ .lab = bun.create(allocator, LABColor, .{ .lab = LAB.tryFromCssColor(this) orelse return null }) },
        };
    }
};

pub fn parseColorFunction(location: css.SourceLocation, function: []const u8, input: *css.Parser) Result(CssColor) {
    var parser = ComponentParser.new(true);

    const ColorFunctions = enum { lab, oklab, lch, oklch, color, hsl, hsla, hwb, rgb, rgba, @"color-mix", @"light-dark" };
    const Map = bun.ComptimeEnumMap(ColorFunctions);

    if (Map.getASCIIICaseInsensitive(function)) |val| {
        return switch (val) {
            .lab => parseLab(LAB, input, &parser, struct {
                fn callback(l: f32, a: f32, b: f32, alpha: f32) LABColor {
                    return .{ .lab = .{ .l = l, .a = a, .b = b, .alpha = alpha } };
                }
            }.callback),
            .oklab => parseLab(OKLAB, input, &parser, struct {
                fn callback(l: f32, a: f32, b: f32, alpha: f32) LABColor {
                    return .{ .oklab = .{ .l = l, .a = a, .b = b, .alpha = alpha } };
                }
            }.callback),
            .lch => parseLch(LCH, input, &parser, struct {
                fn callback(l: f32, c: f32, h: f32, alpha: f32) LABColor {
                    return .{ .lch = .{ .l = l, .c = c, .h = h, .alpha = alpha } };
                }
            }.callback),
            .oklch => parseLch(OKLCH, input, &parser, struct {
                fn callback(l: f32, c: f32, h: f32, alpha: f32) LABColor {
                    return .{ .oklch = .{ .l = l, .c = c, .h = h, .alpha = alpha } };
                }
            }.callback),
            .color => parsePredefined(input, &parser),
            .hsl, .hsla => parseHslHwb(HSL, input, &parser, true, struct {
                fn callback(allocator: Allocator, h: f32, s: f32, l: f32, a: f32) CssColor {
                    const hsl = HSL{ .h = h, .s = s, .l = l, .alpha = a };
                    if (!std.math.isNan(h) and !std.math.isNan(s) and !std.math.isNan(l) and !std.math.isNan(a)) {
                        return CssColor{ .rgba = hsl.into(.RGBA) };
                    } else {
                        return CssColor{ .float = bun.create(allocator, FloatColor, .{ .hsl = hsl }) };
                    }
                }
            }.callback),
            .hwb => parseHslHwb(HWB, input, &parser, false, struct {
                fn callback(allocator: Allocator, h: f32, w: f32, b: f32, a: f32) CssColor {
                    const hwb = HWB{ .h = h, .w = w, .b = b, .alpha = a };
                    if (!std.math.isNan(h) and !std.math.isNan(w) and !std.math.isNan(b) and !std.math.isNan(a)) {
                        return CssColor{ .rgba = hwb.into(.RGBA) };
                    } else {
                        return CssColor{ .float = bun.create(allocator, FloatColor, .{ .hwb = hwb }) };
                    }
                }
            }.callback),
            .rgb, .rgba => parseRgb(input, &parser),
            .@"color-mix" => input.parseNestedBlock(CssColor, {}, struct {
                pub fn parseFn(_: void, i: *css.Parser) Result(CssColor) {
                    return parseColorMix(i);
                }
            }.parseFn),
            .@"light-dark" => input.parseNestedBlock(CssColor, {}, struct {
                fn callback(_: void, i: *css.Parser) Result(CssColor) {
                    const light = switch (switch (CssColor.parse(i)) {
                        .result => |v| v,
                        .err => |e| return .{ .err = e },
                    }) {
                        .light_dark => |ld| ld.takeLightFreeDark(i.allocator()),
                        else => |v| bun.create(i.allocator(), CssColor, v),
                    };
                    if (i.expectComma().asErr()) |e| return .{ .err = e };
                    const dark = switch (switch (CssColor.parse(i)) {
                        .result => |v| v,
                        .err => |e| return .{ .err = e },
                    }) {
                        .light_dark => |ld| ld.takeDarkFreeLight(i.allocator()),
                        else => |v| bun.create(i.allocator(), CssColor, v),
                    };
                    return .{ .result = .{
                        .light_dark = .{
                            .light = light,
                            .dark = dark,
                        },
                    } };
                }
            }.callback),
        };
    }
    return .{ .err = location.newUnexpectedTokenError(.{ .ident = function }) };
}

pub fn parseRGBComponents(input: *css.Parser, parser: *ComponentParser) Result(struct { f32, f32, f32, bool }) {
    const red = switch (parser.parseNumberOrPercentage(input)) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };

    const is_legacy_syntax = parser.from == null and
        !std.math.isNan(red.unitValue()) and
        input.tryParse(css.Parser.expectComma, .{}).isOk();

    const r, const g, const b = if (is_legacy_syntax) switch (red) {
        .number => |v| brk: {
            const r = bun.clamp(@round(v.value), 0.0, 255.0);
            const g = switch (parser.parseNumber(input)) {
                .err => |e| return .{ .err = e },
                .result => |vv| bun.clamp(@round(vv), 0.0, 255.0),
            };
            if (input.expectComma().asErr()) |e| return .{ .err = e };
            const b = switch (parser.parseNumber(input)) {
                .err => |e| return .{ .err = e },
                .result => |vv| bun.clamp(@round(vv), 0.0, 255.0),
            };
            break :brk .{ r, g, b };
        },
        .percentage => |v| brk: {
            const r = bun.clamp(@round(v.unit_value * 255.0), 0.0, 255.0);
            const g = switch (parser.parsePercentage(input)) {
                .err => |e| return .{ .err = e },
                .result => |vv| bun.clamp(@round(vv * 255.0), 0.0, 255.0),
            };
            if (input.expectComma().asErr()) |e| return .{ .err = e };
            const b = switch (parser.parsePercentage(input)) {
                .err => |e| return .{ .err = e },
                .result => |vv| bun.clamp(@round(vv * 255.0), 0.0, 255.0),
            };
            break :brk .{ r, g, b };
        },
    } else blk: {
        const getComponent = struct {
            fn get(value: NumberOrPercentage) f32 {
                return switch (value) {
                    .number => |v| if (std.math.isNan(v.value)) v.value else bun.clamp(@round(v.value), 0.0, 255.0) / 255.0,
                    .percentage => |v| bun.clamp(v.unit_value, 0.0, 1.0),
                };
            }
        }.get;

        const r = getComponent(red);
        const g = getComponent(switch (parser.parseNumberOrPercentage(input)) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        });
        const b = getComponent(switch (parser.parseNumberOrPercentage(input)) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        });
        break :blk .{ r, g, b };
    };

    if (is_legacy_syntax and (std.math.isNan(g) or std.math.isNan(b))) {
        return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
    }
    return .{ .result = .{ r, g, b, is_legacy_syntax } };
}

pub fn parseHSLHWBComponents(comptime T: type, input: *css.Parser, parser: *ComponentParser, allows_legacy: bool) Result(struct { f32, f32, f32, bool }) {
    _ = T; // autofix
    const h = switch (parseAngleOrNumber(input, parser)) {
        .result => |v| v,
        .err => |e| return .{ .err = e },
    };
    const is_legacy_syntax = allows_legacy and
        parser.from == null and
        !std.math.isNan(h) and
        input.tryParse(css.Parser.expectComma, .{}).isOk();
    const a = switch (parser.parsePercentage(input)) {
        .result => |v| bun.clamp(v, 0.0, 1.0),
        .err => |e| return .{ .err = e },
    };
    if (is_legacy_syntax) {
        if (input.expectColon().asErr()) |e| return .{ .err = e };
    }
    const b = switch (parser.parsePercentage(input)) {
        .result => |v| bun.clamp(v, 0.0, 1.0),
        .err => |e| return .{ .err = e },
    };
    if (is_legacy_syntax and (std.math.isNan(a) or std.math.isNan(b))) {
        return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
    }
    return .{ .result = .{ h, a, b, is_legacy_syntax } };
}

pub fn mapGamut(comptime T: type, color: T) T {
    const conversion_target = comptime ConvertTo.fromType(T);
    const JND: f32 = 0.02;
    const EPSILON: f32 = 0.00001;

    // https://www.w3.org/TR/css-color-4/#binsearch
    var current: OKLCH = color.into(.OKLCH);

    // If lightness is >= 100%, return pure white.
    if (@abs(current.l - 1.0) < EPSILON or current.l > 1.0) {
        const oklch = OKLCH{
            .l = 1.0,
            .c = 0.0,
            .h = 0.0,
            .alpha = current.alpha,
        };
        return oklch.into(conversion_target);
    }

    // If lightness <= 0%, return pure black.
    if (current.l < EPSILON) {
        const oklch = OKLCH{
            .l = 0.0,
            .c = 0.0,
            .h = 0.0,
            .alpha = current.alpha,
        };
        return oklch.into(conversion_target);
    }

    var min: f32 = 0.0;
    var max = current.c;

    while ((max - min) > EPSILON) {
        const chroma = (min + max) / 2.0;
        current.c = chroma;

        const converted = current.into(conversion_target);
        if (converted.inGamut()) {
            min = chroma;
            continue;
        }

        const clipped = converted.clip();
        const delta_e = deltaEok(T, clipped, current);
        if (delta_e < JND) {
            return clipped;
        }

        max = chroma;
    }

    return current.into(conversion_target);
}

pub fn deltaEok(comptime T: type, _a: T, _b: OKLCH) f32 {
    // https://www.w3.org/TR/css-color-4/#color-difference-OK
    const a: OKLAB = _a.into(.OKLAB);
    const b: OKLAB = _b.into(.OKLAB);

    const delta_l = a.l - b.l;
    const delta_a = a.a - b.a;
    const delta_b = a.b - b.b;

    return @sqrt(
        bun.powf(delta_l, 2) +
            bun.powf(delta_a, 2) +
            bun.powf(delta_b, 2),
    );
}

pub fn parseLab(
    comptime T: type,
    input: *css.Parser,
    parser: *ComponentParser,
    comptime func: *const fn (f32, f32, f32, f32) LABColor,
) Result(CssColor) {
    const Closure = struct {
        parser: *ComponentParser,

        pub fn parsefn(this: *@This(), i: *css.Parser) Result(CssColor) {
            return this.parser.parseRelative(i, T, CssColor, @This().innerfn, .{});
        }

        pub fn innerfn(i: *css.Parser, p: *ComponentParser) Result(CssColor) {
            // f32::max() does not propagate NaN, so use clamp for now until f32::maximum() is stable.
            const l = bun.clamp(
                switch (p.parsePercentage(i)) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                },
                0.0,
                std.math.floatMax(f32),
            );
            const a = switch (p.parseNumber(i)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            const b = switch (p.parseNumber(i)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            const alpha = switch (parseAlpha(i, p)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            const lab = func(l, a, b, alpha);
            const heap_lab = bun.create(i.allocator(), LABColor, lab);
            heap_lab.* = lab;
            return .{ .result = CssColor{ .lab = heap_lab } };
        }
    };
    var closure = Closure{
        .parser = parser,
    };
    // https://www.w3.org/TR/css-color-4/#funcdef-lab
    return input.parseNestedBlock(
        CssColor,
        &closure,
        Closure.parsefn,
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
) Result(CssColor) {
    const Closure = struct {
        parser: *ComponentParser,

        pub fn parseNestedBlockFn(this: *@This(), i: *css.Parser) Result(CssColor) {
            return this.parser.parseRelative(i, T, CssColor, @This().parseRelativeFn, .{this});
        }

        pub fn parseRelativeFn(i: *css.Parser, p: *ComponentParser, this: *@This()) Result(CssColor) {
            _ = this; // autofix
            if (p.from) |*from| {
                // Relative angles should be normalized.
                // https://www.w3.org/TR/css-color-5/#relative-LCH
                // from.components[2] %= 360.0;
                from.components[2] = @mod(from.components[2], 360.0);
                if (from.components[2] < 0.0) {
                    from.components[2] += 360.0;
                }
            }

            const l = bun.clamp(
                switch (p.parsePercentage(i)) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                },
                0.0,
                std.math.floatMax(f32),
            );
            const c = bun.clamp(
                switch (p.parseNumber(i)) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                },
                0.0,
                std.math.floatMax(f32),
            );
            const h = switch (parseAngleOrNumber(i, p)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            const alpha = switch (parseAlpha(i, p)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            const lab = func(l, c, h, alpha);
            return .{
                .result = .{
                    .lab = bun.create(i.allocator(), LABColor, lab),
                },
            };
        }
    };

    var closure = Closure{
        .parser = parser,
    };

    return input.parseNestedBlock(CssColor, &closure, Closure.parseNestedBlockFn);
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
        Allocator,
        f32,
        f32,
        f32,
        f32,
    ) CssColor,
) Result(CssColor) {
    const Closure = struct {
        parser: *ComponentParser,
        allows_legacy: bool,

        pub fn parseNestedBlockFn(this: *@This(), i: *css.Parser) Result(CssColor) {
            return this.parser.parseRelative(i, T, CssColor, @This().parseRelativeFn, .{this});
        }

        pub fn parseRelativeFn(i: *css.Parser, p: *ComponentParser, this: *@This()) Result(CssColor) {
            const h, const a, const b, const is_legacy = switch (parseHslHwbComponents(T, i, p, this.allows_legacy)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            const alpha = switch (if (is_legacy) parseLegacyAlpha(i, p) else parseAlpha(i, p)) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };

            return .{ .result = func(i.allocator(), h, a, b, alpha) };
        }
    };

    var closure = Closure{
        .parser = parser,
        .allows_legacy = allows_legacy,
    };

    return input.parseNestedBlock(CssColor, &closure, Closure.parseNestedBlockFn);
}

pub fn parseHslHwbComponents(
    comptime T: type,
    input: *css.Parser,
    parser: *ComponentParser,
    allows_legacy: bool,
) Result(struct { f32, f32, f32, bool }) {
    _ = T; // autofix
    const h = switch (parseAngleOrNumber(input, parser)) {
        .result => |vv| vv,
        .err => |e| return .{ .err = e },
    };
    const is_legacy_syntax = allows_legacy and
        parser.from == null and
        !std.math.isNan(h) and
        input.tryParse(css.Parser.expectComma, .{}).isOk();

    const a = bun.clamp(
        switch (parser.parsePercentage(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        },
        0.0,
        1.0,
    );

    if (is_legacy_syntax) {
        if (input.expectComma().asErr()) |e| return .{ .err = e };
    }

    const b = bun.clamp(
        switch (parser.parsePercentage(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        },
        0.0,
        1.0,
    );

    if (is_legacy_syntax and (std.math.isNan(a) or std.math.isNan(b))) {
        return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
    }

    return .{ .result = .{ h, a, b, is_legacy_syntax } };
}

pub fn parseAngleOrNumber(input: *css.Parser, parser: *const ComponentParser) Result(f32) {
    const result = switch (parser.parseAngleOrNumber(input)) {
        .result => |vv| vv,
        .err => |e| return .{ .err = e },
    };
    return .{
        .result = switch (result) {
            .number => |v| v.value,
            .angle => |v| v.degrees,
        },
    };
}

fn parseRgb(input: *css.Parser, parser: *ComponentParser) Result(CssColor) {
    // https://drafts.csswg.org/css-color-4/#rgb-functions

    const Closure = struct {
        p: *ComponentParser,

        pub fn parseNestedBlockFn(this: *@This(), i: *css.Parser) Result(CssColor) {
            return this.p.parseRelative(i, SRGB, CssColor, @This().parseRelativeFn, .{this});
        }

        pub fn parseRelativeFn(i: *css.Parser, p: *ComponentParser, this: *@This()) Result(CssColor) {
            _ = this; // autofix
            const r, const g, const b, const is_legacy = switch (parseRGBComponents(i, p)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            const alpha = switch (if (is_legacy) parseLegacyAlpha(i, p) else parseAlpha(i, p)) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };

            if (!std.math.isNan(r) and
                !std.math.isNan(g) and
                !std.math.isNan(b) and
                !std.math.isNan(alpha))
            {
                if (is_legacy) return .{
                    .result = .{
                        .rgba = RGBA.new(
                            @intFromFloat(r),
                            @intFromFloat(g),
                            @intFromFloat(b),
                            alpha,
                        ),
                    },
                };

                return .{
                    .result = .{
                        .rgba = RGBA.fromFloats(
                            r,
                            g,
                            b,
                            alpha,
                        ),
                    },
                };
            } else {
                return .{
                    .result = .{
                        .float = bun.create(
                            i.allocator(),
                            FloatColor,
                            .{
                                .rgb = .{
                                    .r = r,
                                    .g = g,
                                    .b = b,
                                    .alpha = alpha,
                                },
                            },
                        ),
                    },
                };
            }
        }
    };
    var closure = Closure{
        .p = parser,
    };
    return input.parseNestedBlock(CssColor, &closure, Closure.parseNestedBlockFn);
}

// pub fn parseRgbComponents(input: *css.Parser, parser: *ComponentParser) Result(struct {
//     f32,
//     f32,
//     f32,
//     bool,
// }) {
//     const red = switch (parser.parseNumberOrPercentage(input)) {
//         .result => |vv| vv,
//         .err => |e| return .{ .err = e },
//     };
//     const is_legacy_syntax = parser.from == null and !std.math.isNan(red.unitValue()) and input.tryParse(css.Parser.expectComma, .{}).isOk();

//     const r, const g, const b = if (is_legacy_syntax) switch (red) {
//         .number => |num| brk: {
//             const r = bun.clamp(@round(num.value), 0.0, 255.0);
//             const g = bun.clamp(
//                 @round(
//                     switch (parser.parseNumber(input)) {
//                         .result => |vv| vv,
//                         .err => |e| return .{ .err = e },
//                     },
//                 ),
//                 0.0,
//                 255.0,
//             );
//             if (input.expectComma().asErr()) |e| return .{ .err = e };
//             const b = bun.clamp(
//                 @round(
//                     switch (parser.parseNumber(input)) {
//                         .result => |vv| vv,
//                         .err => |e| return .{ .err = e },
//                     },
//                 ),
//                 0.0,
//                 255.0,
//             );
//             break :brk .{ r, g, b };
//         },
//         .percentage => |per| brk: {
//             const unit_value = per.unit_value;
//             const r = bun.clamp(@round(unit_value * 255.0), 0.0, 255.0);
//             const g = bun.clamp(
//                 @round(
//                     switch (parser.parsePercentage(input)) {
//                         .result => |vv| vv,
//                         .err => |e| return .{ .err = e },
//                     } * 255.0,
//                 ),
//                 0.0,
//                 255.0,
//             );
//             if (input.expectComma().asErr()) |e| return .{ .err = e };
//             const b = bun.clamp(
//                 @round(
//                     switch (parser.parsePercentage(input)) {
//                         .result => |vv| vv,
//                         .err => |e| return .{ .err = e },
//                     } * 255.0,
//                 ),
//                 0.0,
//                 255.0,
//             );
//             break :brk .{ r, g, b };
//         },
//     } else brk: {
//         const get = struct {
//             pub fn component(value: NumberOrPercentage) f32 {
//                 return switch (value) {
//                     .number => |num| {
//                         const v = num.value;
//                         if (std.math.isNan(v)) return v;
//                         return bun.clamp(@round(v), 0.0, 255.0) / 255.0;
//                     },
//                     .percentage => |per| bun.clamp(per.unit_value, 0.0, 1.0),
//                 };
//             }
//         };
//         const r = get.component(red);
//         const g = get.component(
//             switch (parser.parseNumberOrPercentage(input)) {
//                 .result => |vv| vv,
//                 .err => |e| return .{ .err = e },
//             },
//         );
//         const b = get.component(
//             switch (parser.parseNumberOrPercentage(input)) {
//                 .result => |vv| vv,
//                 .err => |e| return .{ .err = e },
//             },
//         );
//         break :brk .{ r, g, b };
//     };

//     if (is_legacy_syntax and (std.math.isNan(g) or std.math.isNan(b))) {
//         return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
//     }

//     return .{ .result = .{ r, g, b, is_legacy_syntax } };
// }

fn parseLegacyAlpha(input: *css.Parser, parser: *const ComponentParser) Result(f32) {
    if (!input.isExhausted()) {
        if (input.expectComma().asErr()) |e| return .{ .err = e };
        return .{ .result = bun.clamp(
            switch (parseNumberOrPercentage(input, parser)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            },
            0.0,
            1.0,
        ) };
    }
    return .{ .result = 1.0 };
}

fn parseAlpha(input: *css.Parser, parser: *const ComponentParser) Result(f32) {
    const res = if (input.tryParse(css.Parser.expectDelim, .{'/'}).isOk())
        bun.clamp(switch (parseNumberOrPercentage(input, parser)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        }, 0.0, 1.0)
    else
        1.0;

    return .{ .result = res };
}

pub fn parseNumberOrPercentage(input: *css.Parser, parser: *const ComponentParser) Result(f32) {
    const result = switch (parser.parseNumberOrPercentage(input)) {
        .result => |vv| vv,
        .err => |e| return .{ .err = e },
    };
    return switch (result) {
        .number => |value| .{ .result = value.value },
        .percentage => |value| .{ .result = value.unit_value },
    };
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

    /// Convert the color into another color format.
    pub const into = ColorIntoMixin(@This(), .RGBA).into;

    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;

    pub fn new(red: u8, green: u8, blue: u8, alpha: f32) RGBA {
        return RGBA{
            .red = red,
            .green = green,
            .blue = blue,
            .alpha = clamp_unit_f32(alpha),
        };
    }

    /// Constructs a new RGBA value from float components. It expects the red,
    /// green, blue and alpha channels in that order, and all values will be
    /// clamped to the 0.0 ... 1.0 range.
    pub fn fromFloats(red: f32, green: f32, blue: f32, alpha: f32) RGBA {
        return RGBA.new(
            clamp_unit_f32(red),
            clamp_unit_f32(green),
            clamp_unit_f32(blue),
            alpha,
        );
    }

    pub fn transparent() RGBA {
        return RGBA.new(0, 0, 0, 0.0);
    }

    /// Returns the red channel in a floating point number form, from 0 to 1.
    pub fn redF32(this: *const RGBA) f32 {
        return @as(f32, @floatFromInt(this.red)) / 255.0;
    }

    /// Returns the green channel in a floating point number form, from 0 to 1.
    pub fn greenF32(this: *const RGBA) f32 {
        return @as(f32, @floatFromInt(this.green)) / 255.0;
    }

    /// Returns the blue channel in a floating point number form, from 0 to 1.
    pub fn blueF32(this: *const RGBA) f32 {
        return @as(f32, @floatFromInt(this.blue)) / 255.0;
    }

    /// Returns the alpha channel in a floating point number form, from 0 to 1.
    pub fn alphaF32(this: *const RGBA) f32 {
        return @as(f32, @floatFromInt(this.alpha)) / 255.0;
    }

    pub fn intoSRGB(rgb: *const RGBA) SRGB {
        return SRGB{
            .r = rgb.redF32(),
            .g = rgb.greenF32(),
            .b = rgb.blueF32(),
            .alpha = rgb.alphaF32(),
        };
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
    return @intFromFloat(@min(255.0, @max(0.0, @round(val))));
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

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
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

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }
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

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }
};

/// A CSS [system color](https://drafts.csswg.org/css-color/#css-system-colors) keyword.
/// *NOTE* these are intentionally in flat case
pub const SystemColor = enum {
    /// Background of accented user interface controls.
    accentcolor,
    /// Text of accented user interface controls.
    accentcolortext,
    /// Text in active links. For light backgrounds, traditionally red.
    activetext,
    /// The base border color for push buttons.
    buttonborder,
    /// The face background color for push buttons.
    buttonface,
    /// Text on push buttons.
    buttontext,
    /// Background of application content or documents.
    canvas,
    /// Text in application content or documents.
    canvastext,
    /// Background of input fields.
    field,
    /// Text in input fields.
    fieldtext,
    /// Disabled text. (Often, but not necessarily, gray.)
    graytext,
    /// Background of selected text, for example from ::selection.
    highlight,
    /// Text of selected text.
    highlighttext,
    /// Text in non-active, non-visited links. For light backgrounds, traditionally blue.
    linktext,
    /// Background of text that has been specially marked (such as by the HTML mark element).
    mark,
    /// Text that has been specially marked (such as by the HTML mark element).
    marktext,
    /// Background of selected items, for example a selected checkbox.
    selecteditem,
    /// Text of selected items.
    selecteditemtext,
    /// Text in visited links. For light backgrounds, traditionally purple.
    visitedtext,

    // Deprecated colors: https://drafts.csswg.org/css-color/#deprecated-system-colors

    /// Active window border. Same as ButtonBorder.
    activeborder,
    /// Active window caption. Same as Canvas.
    activecaption,
    /// Background color of multiple document interface. Same as Canvas.
    appworkspace,
    /// Desktop background. Same as Canvas.
    background,
    /// The color of the border facing the light source for 3-D elements that appear 3-D due to one layer of surrounding border. Same as ButtonFace.
    buttonhighlight,
    /// The color of the border away from the light source for 3-D elements that appear 3-D due to one layer of surrounding border. Same as ButtonFace.
    buttonshadow,
    /// Text in caption, size box, and scrollbar arrow box. Same as CanvasText.
    captiontext,
    /// Inactive window border. Same as ButtonBorder.
    inactiveborder,
    /// Inactive window caption. Same as Canvas.
    inactivecaption,
    /// Color of text in an inactive caption. Same as GrayText.
    inactivecaptiontext,
    /// Background color for tooltip controls. Same as Canvas.
    infobackground,
    /// Text color for tooltip controls. Same as CanvasText.
    infotext,
    /// Menu background. Same as Canvas.
    menu,
    /// Text in menus. Same as CanvasText.
    menutext,
    /// Scroll bar gray area. Same as Canvas.
    scrollbar,
    /// The color of the darker (generally outer) of the two borders away from the light source for 3-D elements that appear 3-D due to two concentric layers of surrounding border. Same as ButtonBorder.
    threeddarkshadow,
    /// The face background color for 3-D elements that appear 3-D due to two concentric layers of surrounding border. Same as ButtonFace.
    threedface,
    /// The color of the lighter (generally outer) of the two borders facing the light source for 3-D elements that appear 3-D due to two concentric layers of surrounding border. Same as ButtonBorder.
    threedhighlight,
    /// The color of the darker (generally inner) of the two borders facing the light source for 3-D elements that appear 3-D due to two concentric layers of surrounding border. Same as ButtonBorder.
    threedlightshadow,
    /// The color of the lighter (generally inner) of the two borders away from the light source for 3-D elements that appear 3-D due to two concentric layers of surrounding border. Same as ButtonBorder.
    threedshadow,
    /// Window background. Same as Canvas.
    window,
    /// Window frame. Same as ButtonBorder.
    windowframe,
    /// Text in windows. Same as CanvasText.
    windowtext,

    pub fn isCompatible(this: SystemColor, browsers: css.targets.Browsers) bool {
        return switch (this) {
            .accentcolor, .accentcolortext => css.Feature.isCompatible(.accent_system_color, browsers),
            else => true,
        };
    }

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }
};

/// A color in the [CIE Lab](https://www.w3.org/TR/css-color-4/#cie-lab) color space.
pub const LAB = struct {
    /// The lightness component.
    l: f32,
    /// The a component.
    a: f32,
    /// The b component.
    b: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const types = colorspace_impl.types;
    pub const channels = colorspace_impl.channels;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = UnboundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    pub const adjustPowerlessComponents = AdjustPowerlessLAB(@This()).adjustPowerlessComponents;
    const interpolate_impl = DeriveInterpolate(@This(), "l", "a", "b");
    pub const fillMissingComponents = interpolate_impl.fillMissingComponents;
    pub const interpolate = interpolate_impl.interpolate;
    const recangular_impl = RecangularPremultiply(@This(), "l", "a", "b");
    pub const premultiply = recangular_impl.premultiply;
    pub const unpremultiply = recangular_impl.unpremultiply;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .LAB).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .LAB);

    pub const ChannelTypeMap = .{
        .l = ChannelType{ .percentage = true },
        .a = ChannelType{ .number = true },
        .b = ChannelType{ .number = true },
    };

    pub fn adjustHue(_: *@This(), _: *@This(), _: HueInterpolationMethod) void {}
};

/// A color in the [`sRGB`](https://www.w3.org/TR/css-color-4/#predefined-sRGB) color space.
pub const SRGB = struct {
    /// The red component.
    r: f32,
    /// The green component.
    g: f32,
    /// The blue component.
    b: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = BoundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    const interpolate_impl = DeriveInterpolate(@This(), "r", "g", "b");
    pub const fillMissingComponents = interpolate_impl.fillMissingComponents;
    pub const interpolate = interpolate_impl.interpolate;
    const recangular_impl = RecangularPremultiply(@This(), "r", "g", "b");
    pub const premultiply = recangular_impl.premultiply;
    pub const unpremultiply = recangular_impl.unpremultiply;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .SRGB).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .SRGB);

    pub const ChannelTypeMap = .{
        .r = ChannelType{ .percentage = true },
        .g = ChannelType{ .percentage = true },
        .b = ChannelType{ .percentage = true },
    };

    pub fn adjustPowerlessComponents(_: *@This()) void {}
    pub fn adjustHue(_: *@This(), _: *@This(), _: HueInterpolationMethod) void {}

    pub fn intoRGBA(_rgb: *const SRGB) RGBA {
        const rgb = _rgb.resolve();
        return RGBA.fromFloats(
            rgb.r,
            rgb.g,
            rgb.b,
            rgb.alpha,
        );
    }
};

/// A color in the [`hsl`](https://www.w3.org/TR/css-color-4/#the-hsl-notation) color space.
pub const HSL = struct {
    /// The hue component.
    h: f32,
    /// The saturation component.
    s: f32,
    /// The lightness component.
    l: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = HslHwbColorGamut(@This(), "s", "l");
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    const polar_impl = PolarPremultiply(@This(), "s", "l");
    pub const premultiply = polar_impl.premultiply;
    pub const unpremultiply = polar_impl.unpremultiply;
    const interpolate_impl = DeriveInterpolate(@This(), "h", "s", "l");
    pub const fillMissingComponents = interpolate_impl.fillMissingComponents;
    pub const interpolate = interpolate_impl.interpolate;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .HSL).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .HSL);

    pub const ChannelTypeMap = .{
        .h = ChannelType{ .angle = true },
        .s = ChannelType{ .percentage = true },
        .l = ChannelType{ .percentage = true },
    };

    pub fn adjustPowerlessComponents(this: *HSL) void {
        // If the saturation of an HSL color is 0%, then the hue component is powerless.
        // If the lightness of an HSL color is 0% or 100%, both the saturation and hue components are powerless.
        if (@abs(this.s) < std.math.floatEps(f32)) {
            this.h = std.math.nan(f32);
        }

        if (@abs(this.l) < std.math.floatEps(f32) or @abs(this.l - 1.0) < std.math.floatEps(f32)) {
            this.h = std.math.nan(f32);
            this.s = std.math.nan(f32);
        }
    }

    pub fn adjustHue(this: *HSL, other: *HSL, method: HueInterpolationMethod) void {
        _ = method.interpolate(&this.h, &other.h);
    }
};

/// A color in the [`hwb`](https://www.w3.org/TR/css-color-4/#the-hwb-notation) color space.
pub const HWB = struct {
    /// The hue component.
    h: f32,
    /// The whiteness component.
    w: f32,
    /// The blackness component.
    b: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = HslHwbColorGamut(@This(), "w", "b");
    pub const inGamut = gamut_impl.inGamut;
    pub const clip = gamut_impl.clip;

    const polar_impl = PolarPremultiply(@This(), "w", "b");
    pub const premultiply = polar_impl.premultiply;
    pub const unpremultiply = polar_impl.unpremultiply;
    const interpolate_impl = DeriveInterpolate(@This(), "h", "w", "b");
    pub const fillMissingComponents = interpolate_impl.fillMissingComponents;
    pub const interpolate = interpolate_impl.interpolate;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .HWB).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .HWB);

    pub const ChannelTypeMap = .{
        .h = ChannelType{ .angle = true },
        .w = ChannelType{ .percentage = true },
        .b = ChannelType{ .percentage = true },
    };

    pub fn adjustPowerlessComponents(this: *HWB) void {
        // If white+black is equal to 100% (after normalization), it defines an achromatic color,
        // i.e. some shade of gray, without any hint of the chosen hue. In this case, the hue component is powerless.
        if (@abs(this.w + this.b - 1.0) < std.math.floatEps(f32)) {
            this.h = std.math.nan(f32);
        }
    }

    pub fn adjustHue(this: *HWB, other: *HWB, method: HueInterpolationMethod) void {
        _ = method.interpolate(&this.h, &other.h);
    }
};

/// A color in the [`sRGB-linear`](https://www.w3.org/TR/css-color-4/#predefined-sRGB-linear) color space.
pub const SRGBLinear = struct {
    /// The red component.
    r: f32,
    /// The green component.
    g: f32,
    /// The blue component.
    b: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = BoundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    const interpolate_impl = DeriveInterpolate(@This(), "r", "g", "b");
    pub const fillMissingComponents = interpolate_impl.fillMissingComponents;
    pub const interpolate = interpolate_impl.interpolate;
    const recangular_impl = RecangularPremultiply(@This(), "r", "g", "b");
    pub const premultiply = recangular_impl.premultiply;
    pub const unpremultiply = recangular_impl.unpremultiply;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .SRGBLinear).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .SRGBLinear);

    pub const ChannelTypeMap = .{
        .r = ChannelType{ .angle = true },
        .g = ChannelType{ .percentage = true },
        .b = ChannelType{ .percentage = true },
    };

    pub fn adjustPowerlessComponents(_: *@This()) void {}
    pub fn adjustHue(_: *@This(), _: *@This(), _: HueInterpolationMethod) void {}
};

/// A color in the [`display-p3`](https://www.w3.org/TR/css-color-4/#predefined-display-p3) color space.
pub const P3 = struct {
    /// The red component.
    r: f32,
    /// The green component.
    g: f32,
    /// The blue component.
    b: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = BoundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .P3).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .P3);

    pub const ChannelTypeMap = .{
        .r = ChannelType{ .percentage = true },
        .g = ChannelType{ .percentage = true },
        .b = ChannelType{ .percentage = true },
    };
};

/// A color in the [`a98-rgb`](https://www.w3.org/TR/css-color-4/#predefined-a98-rgb) color space.
pub const A98 = struct {
    /// The red component.
    r: f32,
    /// The green component.
    g: f32,
    /// The blue component.
    b: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = BoundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .A98).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .A98);

    pub const ChannelTypeMap = .{
        .r = ChannelType{ .percentage = true },
        .g = ChannelType{ .percentage = true },
        .b = ChannelType{ .percentage = true },
    };
};

/// A color in the [`prophoto-rgb`](https://www.w3.org/TR/css-color-4/#predefined-prophoto-rgb) color space.
pub const ProPhoto = struct {
    /// The red component.
    r: f32,
    /// The green component.
    g: f32,
    /// The blue component.
    b: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = BoundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .ProPhoto).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .ProPhoto);

    pub const ChannelTypeMap = .{
        .r = ChannelType{ .percentage = true },
        .g = ChannelType{ .percentage = true },
        .b = ChannelType{ .percentage = true },
    };
};

/// A color in the [`rec2020`](https://www.w3.org/TR/css-color-4/#predefined-rec2020) color space.
pub const Rec2020 = struct {
    /// The red component.
    r: f32,
    /// The green component.
    g: f32,
    /// The blue component.
    b: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = BoundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .Rec2020).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .Rec2020);

    pub const ChannelTypeMap = .{
        .r = ChannelType{ .percentage = true },
        .g = ChannelType{ .percentage = true },
        .b = ChannelType{ .percentage = true },
    };
};

/// A color in the [`xyz-d50`](https://www.w3.org/TR/css-color-4/#predefined-xyz) color space.
pub const XYZd50 = struct {
    /// The x component.
    x: f32,
    /// The y component.
    y: f32,
    /// The z component.
    z: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = UnboundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    const interpolate_impl = DeriveInterpolate(@This(), "x", "y", "z");
    pub const fillMissingComponents = interpolate_impl.fillMissingComponents;
    pub const interpolate = interpolate_impl.interpolate;
    const recangular_impl = RecangularPremultiply(@This(), "x", "y", "z");
    pub const premultiply = recangular_impl.premultiply;
    pub const unpremultiply = recangular_impl.unpremultiply;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .XYZd50).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .XYZd50);

    pub const ChannelTypeMap = .{
        .x = ChannelType{ .percentage = true },
        .y = ChannelType{ .percentage = true },
        .z = ChannelType{ .percentage = true },
    };
};

/// A color in the [`xyz-d65`](https://www.w3.org/TR/css-color-4/#predefined-xyz) color space.
pub const XYZd65 = struct {
    /// The x component.
    x: f32,
    /// The y component.
    y: f32,
    /// The z component.
    z: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = UnboundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    const interpolate_impl = DeriveInterpolate(@This(), "x", "y", "z");
    pub const fillMissingComponents = interpolate_impl.fillMissingComponents;
    pub const interpolate = interpolate_impl.interpolate;
    const recangular_impl = RecangularPremultiply(@This(), "x", "y", "z");
    pub const premultiply = recangular_impl.premultiply;
    pub const unpremultiply = recangular_impl.unpremultiply;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .XYZd65).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .XYZd65);

    pub const ChannelTypeMap = .{
        .x = ChannelType{ .percentage = true },
        .y = ChannelType{ .percentage = true },
        .z = ChannelType{ .percentage = true },
    };

    pub fn adjustPowerlessComponents(_: *@This()) void {}
    pub fn adjustHue(_: *@This(), _: *@This(), _: HueInterpolationMethod) void {}
};

/// A color in the [CIE LCH](https://www.w3.org/TR/css-color-4/#cie-lab) color space.
pub const LCH = struct {
    /// The lightness component.
    l: f32,
    /// The chroma component.
    c: f32,
    /// The hue component.
    h: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = UnboundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    const powerless_lch_impl = AdjustPowerlessLCH(@This());
    pub const adjustPowerlessComponents = powerless_lch_impl.adjustPowerlessComponents;
    pub const adjustHue = powerless_lch_impl.adjustHue;
    const interpolate_impl = DeriveInterpolate(@This(), "l", "c", "h");
    pub const fillMissingComponents = interpolate_impl.fillMissingComponents;
    pub const interpolate = interpolate_impl.interpolate;
    const recangular_impl = RecangularPremultiply(@This(), "l", "c", "h");
    pub const premultiply = recangular_impl.premultiply;
    pub const unpremultiply = recangular_impl.unpremultiply;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .LCH).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .LCH);

    pub const ChannelTypeMap = .{
        .l = ChannelType{ .percentage = true },
        .c = ChannelType{ .number = true },
        .h = ChannelType{ .angle = true },
    };
};

/// A color in the [OKLab](https://www.w3.org/TR/css-color-4/#ok-lab) color space.
pub const OKLAB = struct {
    /// The lightness component.
    l: f32,
    /// The a component.
    a: f32,
    /// The b component.
    b: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = UnboundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    pub const adjustPowerlessComponents = AdjustPowerlessLAB(@This()).adjustPowerlessComponents;
    const interpolate_impl = DeriveInterpolate(@This(), "l", "a", "b");
    pub const fillMissingComponents = interpolate_impl.fillMissingComponents;
    pub const interpolate = interpolate_impl.interpolate;
    const recangular_impl = RecangularPremultiply(@This(), "l", "a", "b");
    pub const premultiply = recangular_impl.premultiply;
    pub const unpremultiply = recangular_impl.unpremultiply;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .OKLAB).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .OKLAB);

    pub const ChannelTypeMap = .{
        .l = ChannelType{ .percentage = true },
        .a = ChannelType{ .number = true },
        .b = ChannelType{ .number = true },
    };

    pub fn adjustHue(_: *@This(), _: *@This(), _: HueInterpolationMethod) void {}
};

/// A color in the [OKLCH](https://www.w3.org/TR/css-color-4/#ok-lab) color space.
pub const OKLCH = struct {
    /// The lightness component.
    l: f32,
    /// The chroma component.
    c: f32,
    /// The hue component.
    h: f32,
    /// The alpha component.
    alpha: f32,

    const colorspace_impl = DefineColorspace(@This(), ChannelTypeMap);
    pub const components = colorspace_impl.components;
    pub const channels = colorspace_impl.channels;
    pub const types = colorspace_impl.types;
    pub const resolveMissing = colorspace_impl.resolveMissing;
    pub const resolve = colorspace_impl.resolve;
    const conversions_impl = ColorspaceConversions(@This());
    pub const fromLABColor = conversions_impl.fromLABColor;
    pub const fromPredefinedColor = conversions_impl.fromPredefinedColor;
    pub const fromFloatColor = conversions_impl.fromFloatColor;
    pub const tryFromCssColor = conversions_impl.tryFromCssColor;
    pub const hash = conversions_impl.hash;
    const gamut_impl = UnboundedColorGamut(@This());
    pub const clip = gamut_impl.clip;
    pub const inGamut = gamut_impl.inGamut;

    const powerless_lch_impl = AdjustPowerlessLCH(@This());
    pub const adjustPowerlessComponents = powerless_lch_impl.adjustPowerlessComponents;
    pub const adjustHue = powerless_lch_impl.adjustHue;
    const interpolate_impl = DeriveInterpolate(@This(), "l", "c", "h");
    pub const fillMissingComponents = interpolate_impl.fillMissingComponents;
    pub const interpolate = interpolate_impl.interpolate;

    const recangular_impl = RecangularPremultiply(@This(), "l", "c", "h");
    pub const premultiply = recangular_impl.premultiply;
    pub const unpremultiply = recangular_impl.unpremultiply;

    /// Convert this color into another color format.
    pub const into = ColorIntoMixin(@This(), .OKLCH).into;
    pub const intoCssColor = ImplementIntoCssColor(@This(), .OKLCH);

    pub const ChannelTypeMap = .{
        .l = ChannelType{ .percentage = true },
        .c = ChannelType{ .number = true },
        .h = ChannelType{ .angle = true },
    };
};

pub const ComponentParser = struct {
    allow_none: bool,
    from: ?RelativeComponentParser,

    pub fn new(allow_none: bool) ComponentParser {
        return ComponentParser{
            .allow_none = allow_none,
            .from = null,
        };
    }

    /// `func` must be a function like:
    /// fn (*css.Parser, *ComponentParser, ...args)
    pub fn parseRelative(
        this: *ComponentParser,
        input: *css.Parser,
        comptime T: type,
        comptime C: type,
        comptime func: anytype,
        args_: anytype,
    ) Result(C) {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"from"}).isOk()) {
            const from = switch (CssColor.parse(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
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
    ) Result(C) {
        if (from == .light_dark) {
            const state = input.state();
            const light = switch (this.parseFrom(from.light_dark.light.*, input, T, C, func, args_)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            input.reset(&state);
            const dark = switch (this.parseFrom(from.light_dark.dark.*, input, T, C, func, args_)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            return .{ .result = C.lightDarkOwned(input.allocator(), light, dark) };
        }

        const new_from = if (T.tryFromCssColor(&from)) |v| v.resolve() else return .{ .err = input.newCustomError(css.ParserError.invalid_value) };

        this.from = RelativeComponentParser.new(&new_from);

        const args = bun.meta.ConcatArgs2(func, input, this, args_);
        return @call(.auto, func, args);
    }

    pub fn parseNumberOrPercentage(this: *const ComponentParser, input: *css.Parser) Result(NumberOrPercentage) {
        if (this.from) |*from| {
            if (input.tryParse(RelativeComponentParser.parseNumberOrPercentage, .{from}).asValue()) |res| {
                return .{ .result = res };
            }
        }

        if (input.tryParse(CSSNumberFns.parse, .{}).asValue()) |value| {
            return .{ .result = NumberOrPercentage{ .number = .{ .value = value } } };
        } else if (input.tryParse(Percentage.parse, .{}).asValue()) |value| {
            return .{
                .result = NumberOrPercentage{
                    .percentage = .{ .unit_value = value.v },
                },
            };
        } else if (this.allow_none) {
            if (input.expectIdentMatching("none").asErr()) |e| return .{ .err = e };
            return .{ .result = NumberOrPercentage{
                .number = .{
                    .value = std.math.nan(f32),
                },
            } };
        } else {
            return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
        }
    }

    pub fn parseAngleOrNumber(this: *const ComponentParser, input: *css.Parser) Result(css.color.AngleOrNumber) {
        if (this.from) |*from| {
            if (input.tryParse(RelativeComponentParser.parseAngleOrNumber, .{from}).asValue()) |res| {
                return .{ .result = res };
            }
        }

        if (input.tryParse(Angle.parse, .{}).asValue()) |angle| {
            return .{
                .result = .{
                    .angle = .{
                        .degrees = angle.toDegrees(),
                    },
                },
            };
        } else if (input.tryParse(CSSNumberFns.parse, .{}).asValue()) |value| {
            return .{
                .result = .{
                    .number = .{
                        .value = value,
                    },
                },
            };
        } else if (this.allow_none) {
            if (input.expectIdentMatching("none").asErr()) |e| return .{ .err = e };
            return .{
                .result = .{
                    .number = .{
                        .value = std.math.nan(f32),
                    },
                },
            };
        } else {
            return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
        }
    }

    pub fn parsePercentage(this: *const ComponentParser, input: *css.Parser) Result(f32) {
        if (this.from) |*from| {
            if (input.tryParse(RelativeComponentParser.parsePercentage, .{from}).asValue()) |res| {
                return .{ .result = res };
            }
        }

        if (input.tryParse(Percentage.parse, .{}).asValue()) |val| {
            return .{ .result = val.v };
        } else if (this.allow_none) {
            if (input.expectIdentMatching("none").asErr()) |e| return .{ .err = e };
            return .{ .result = std.math.nan(f32) };
        } else {
            return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
        }
    }

    pub fn parseNumber(this: *const ComponentParser, input: *css.Parser) Result(f32) {
        if (this.from) |*from| {
            if (input.tryParse(RelativeComponentParser.parseNumber, .{from}).asValue()) |res| {
                return .{ .result = res };
            }
        }

        if (input.tryParse(CSSNumberFns.parse, .{}).asValue()) |val| {
            return .{ .result = val };
        } else if (this.allow_none) {
            if (input.expectIdentMatching("none").asErr()) |e| return .{ .err = e };
            return .{ .result = std.math.nan(f32) };
        } else {
            return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
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

    /// Return the value as a percentage.
    pub fn unitValue(this: *const NumberOrPercentage) f32 {
        return switch (this.*) {
            .number => |v| v.value,
            .percentage => |v| v.unit_value,
        };
    }

    /// Return the value as a number with a percentage adjusted to the
    /// `percentage_basis`.
    pub fn value(this: *const NumberOrPercentage, percentage_basis: f32) f32 {
        return switch (this.*) {
            .number => |v| v.value,
            .percentage => |v| v.unit_value * percentage_basis,
        };
    }
};

const RelativeComponentParser = struct {
    names: struct { []const u8, []const u8, []const u8 },
    components: struct { f32, f32, f32, f32 },
    types: struct { ChannelType, ChannelType, ChannelType },

    pub fn new(color: anytype) RelativeComponentParser {
        return RelativeComponentParser{
            .names = color.channels(),
            .components = color.components(),
            .types = color.types(),
        };
    }

    pub fn parseAngleOrNumber(input: *css.Parser, this: *const RelativeComponentParser) Result(css.color.AngleOrNumber) {
        if (input.tryParse(
            RelativeComponentParser.parseIdent,
            .{
                this,
                ChannelType{ .angle = true, .number = true },
            },
        ).asValue()) |value| {
            return .{ .result = .{
                .number = .{
                    .value = value,
                },
            } };
        }

        if (input.tryParse(
            RelativeComponentParser.parseCalc,
            .{
                this,
                ChannelType{ .angle = true, .number = true },
            },
        ).asValue()) |value| {
            return .{ .result = .{
                .number = .{
                    .value = value,
                },
            } };
        }

        const Closure = struct {
            angle: Angle,
            parser: *const RelativeComponentParser,
            pub fn tryParseFn(i: *css.Parser, t: *@This()) Result(Angle) {
                if (Calc(Angle).parseWith(i, t, @This().calcParseIdentFn).asValue()) |val| {
                    if (val == .value) {
                        return .{ .result = val.value.* };
                    }
                }
                return .{ .err = i.newCustomError(css.ParserError.invalid_value) };
            }

            pub fn calcParseIdentFn(t: *@This(), ident: []const u8) ?Calc(Angle) {
                const value = t.parser.getIdent(ident, ChannelType{ .angle = true, .number = true }) orelse return null;
                t.angle = .{ .deg = value };
                return Calc(Angle){
                    .value = &t.angle,
                };
            }
        };
        var closure = Closure{
            .angle = undefined,
            .parser = this,
        };
        if (input.tryParse(Closure.tryParseFn, .{&closure}).asValue()) |value| {
            return .{ .result = .{
                .angle = .{
                    .degrees = value.toDegrees(),
                },
            } };
        }

        return .{ .err = input.newErrorForNextToken() };
    }

    pub fn parseNumberOrPercentage(input: *css.Parser, this: *const RelativeComponentParser) Result(NumberOrPercentage) {
        if (input.tryParse(RelativeComponentParser.parseIdent, .{ this, ChannelType{ .percentage = true, .number = true } }).asValue()) |value| {
            return .{ .result = NumberOrPercentage{ .percentage = .{ .unit_value = value } } };
        }

        if (input.tryParse(RelativeComponentParser.parseCalc, .{ this, ChannelType{ .percentage = true, .number = true } }).asValue()) |value| {
            return .{ .result = NumberOrPercentage{
                .percentage = .{
                    .unit_value = value,
                },
            } };
        }

        {
            const Closure = struct {
                parser: *const RelativeComponentParser,
                percentage: Percentage = .{ .v = 0 },

                pub fn parsefn(i: *css.Parser, self: *@This()) Result(Percentage) {
                    if (Calc(Percentage).parseWith(i, self, @This().calcparseident).asValue()) |calc_value| {
                        if (calc_value == .value) return .{ .result = calc_value.value.* };
                    }
                    return .{ .err = i.newCustomError(css.ParserError.invalid_value) };
                }

                pub fn calcparseident(self: *@This(), ident: []const u8) ?Calc(Percentage) {
                    const v = self.parser.getIdent(ident, ChannelType{ .percentage = true, .number = true }) orelse return null;
                    self.percentage = .{ .v = v };
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
            }).asValue()) |value| {
                return .{ .result = NumberOrPercentage{
                    .percentage = .{
                        .unit_value = value.v,
                    },
                } };
            }
        }

        return .{ .err = input.newErrorForNextToken() };
    }

    pub fn parsePercentage(
        input: *css.Parser,
        this: *const RelativeComponentParser,
    ) Result(f32) {
        if (input.tryParse(RelativeComponentParser.parseIdent, .{ this, ChannelType{ .percentage = true } }).asValue()) |value| {
            return .{ .result = value };
        }

        const Closure = struct { self: *const RelativeComponentParser, temp: Percentage = .{ .v = 0 } };
        var _closure = Closure{ .self = this };
        if (input.tryParse(struct {
            pub fn parseFn(i: *css.Parser, closure: *Closure) Result(Percentage) {
                const calc_value = switch (Calc(Percentage).parseWith(i, closure, parseIdentFn)) {
                    .result => |v| v,
                    .err => return .{ .err = i.newCustomError(css.ParserError.invalid_value) },
                };
                if (calc_value == .value) return .{ .result = calc_value.value.* };
                return .{ .err = i.newCustomError(css.ParserError.invalid_value) };
            }

            pub fn parseIdentFn(closure: *Closure, ident: []const u8) ?Calc(Percentage) {
                const v = closure.self.getIdent(ident, ChannelType{ .percentage = true }) orelse return null;
                closure.temp = .{ .v = v };
                return Calc(Percentage){ .value = &closure.temp };
            }
        }.parseFn, .{&_closure}).asValue()) |value| {
            return .{ .result = value.v };
        }

        return .{ .err = input.newErrorForNextToken() };
    }

    pub fn parseNumber(
        input: *css.Parser,
        this: *const RelativeComponentParser,
    ) Result(f32) {
        if (input.tryParse(
            RelativeComponentParser.parseIdent,
            .{ this, ChannelType{ .number = true } },
        ).asValue()) |value| {
            return .{ .result = value };
        }

        if (input.tryParse(
            RelativeComponentParser.parseCalc,
            .{ this, ChannelType{ .number = true } },
        ).asValue()) |value| {
            return .{ .result = value };
        }

        return .{ .err = input.newErrorForNextToken() };
    }

    pub fn parseIdent(
        input: *css.Parser,
        this: *const RelativeComponentParser,
        allowed_types: ChannelType,
    ) Result(f32) {
        const v = this.getIdent(
            switch (input.expectIdent()) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            },
            allowed_types,
        ) orelse return .{ .err = input.newErrorForNextToken() };
        return .{ .result = v };
    }

    pub fn parseCalc(
        input: *css.Parser,
        this: *const RelativeComponentParser,
        allowed_types: ChannelType,
    ) Result(f32) {
        const Closure = struct {
            p: *const RelativeComponentParser,
            allowed_types: ChannelType,

            pub fn parseIdentFn(self: *@This(), ident: []const u8) ?Calc(f32) {
                const v = self.p.getIdent(ident, self.allowed_types) orelse return null;
                return .{ .number = v };
            }
        };
        var closure = Closure{
            .p = this,
            .allowed_types = allowed_types,
        };
        if (Calc(f32).parseWith(input, &closure, Closure.parseIdentFn).asValue()) |calc_val| {
            // PERF: I don't like this redundant allocation
            if (calc_val == .value) return .{ .result = calc_val.value.* };
            if (calc_val == .number) return .{ .result = calc_val.number };
        }
        return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
    }

    pub fn getIdent(
        this: *const RelativeComponentParser,
        ident: []const u8,
        allowed_types: ChannelType,
    ) ?f32 {
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, this.names[0]) and
            bits.intersects(ChannelType, allowed_types, this.types[0]))
        {
            return this.components[0];
        }

        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, this.names[1]) and
            bits.intersects(ChannelType, allowed_types, this.types[1]))
        {
            return this.components[1];
        }

        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, this.names[2]) and
            bits.intersects(ChannelType, allowed_types, this.types[2]))
        {
            return this.components[2];
        }

        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "alpha") and allowed_types.percentage) {
            return this.components[3];
        }

        return null;
    }
};

/// A channel type for a color space.
/// TODO(zack): why tf is this bitflags?
pub const ChannelType = packed struct(u8) {
    /// Channel represents a percentage.
    percentage: bool = false,
    /// Channel represents an angle.
    angle: bool = false,
    /// Channel represents a number.
    number: bool = false,
    __unused: u5 = 0,
};

pub fn parsePredefined(input: *css.Parser, parser: *ComponentParser) Result(CssColor) {
    const Closure = struct { p: *ComponentParser };
    var closure = Closure{
        .p = parser,
    };
    const res = switch (input.parseNestedBlock(CssColor, &closure, struct {
        // https://www.w3.org/TR/css-color-4/#color-function
        pub fn parseFn(this: *Closure, i: *css.Parser) Result(CssColor) {
            const from: ?CssColor = if (i.tryParse(css.Parser.expectIdentMatching, .{"from"}).isOk())
                switch (CssColor.parse(i)) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                }
            else
                null;

            const colorspace = switch (i.expectIdent()) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };

            if (from) |f| {
                if (f == .light_dark) {
                    const state = i.state();
                    const light = switch (parsePredefinedRelative(i, this.p, colorspace, f.light_dark.light)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    i.reset(&state);
                    const dark = switch (parsePredefinedRelative(i, this.p, colorspace, f.light_dark.dark)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    return .{ .result = CssColor{
                        .light_dark = .{
                            .light = bun.create(
                                i.allocator(),
                                CssColor,
                                light,
                            ),
                            .dark = bun.create(
                                i.allocator(),
                                CssColor,
                                dark,
                            ),
                        },
                    } };
                }
            }

            return parsePredefinedRelative(i, this.p, colorspace, if (from) |*f| f else null);
        }
    }.parseFn)) {
        .result => |vv| vv,
        .err => |e| return .{ .err = e },
    };

    return .{ .result = res };
}

pub fn parsePredefinedRelative(
    input: *css.Parser,
    parser: *ComponentParser,
    colorspace: []const u8,
    _from: ?*const CssColor,
) Result(CssColor) {
    const location = input.currentSourceLocation();
    if (_from) |from| {
        parser.from = set_from: {
            // todo_stuff.match_ignore_ascii_case
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("srgb", colorspace)) {
                break :set_from RelativeComponentParser.new(
                    if (SRGB.tryFromCssColor(from)) |v| v.resolveMissing() else return .{ .err = input.newCustomError(css.ParserError.invalid_value) },
                );
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("srgb-linear", colorspace)) {
                break :set_from RelativeComponentParser.new(
                    if (SRGBLinear.tryFromCssColor(from)) |v| v.resolveMissing() else return .{ .err = input.newCustomError(css.ParserError.invalid_value) },
                );
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("display-p3", colorspace)) {
                break :set_from RelativeComponentParser.new(
                    if (P3.tryFromCssColor(from)) |v| v.resolveMissing() else return .{ .err = input.newCustomError(css.ParserError.invalid_value) },
                );
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("a98-rgb", colorspace)) {
                break :set_from RelativeComponentParser.new(
                    if (A98.tryFromCssColor(from)) |v| v.resolveMissing() else return .{ .err = input.newCustomError(css.ParserError.invalid_value) },
                );
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("prophoto-rgb", colorspace)) {
                break :set_from RelativeComponentParser.new(
                    if (ProPhoto.tryFromCssColor(from)) |v| v.resolveMissing() else return .{ .err = input.newCustomError(css.ParserError.invalid_value) },
                );
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("rec2020", colorspace)) {
                break :set_from RelativeComponentParser.new(
                    if (Rec2020.tryFromCssColor(from)) |v| v.resolveMissing() else return .{ .err = input.newCustomError(css.ParserError.invalid_value) },
                );
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("xyz-d50", colorspace)) {
                break :set_from RelativeComponentParser.new(
                    if (XYZd50.tryFromCssColor(from)) |v| v.resolveMissing() else return .{ .err = input.newCustomError(css.ParserError.invalid_value) },
                );
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("xyz", colorspace) or
                bun.strings.eqlCaseInsensitiveASCIIICheckLength("xyz-d65", colorspace))
            {
                break :set_from RelativeComponentParser.new(
                    if (XYZd65.tryFromCssColor(from)) |v| v.resolveMissing() else return .{ .err = input.newCustomError(css.ParserError.invalid_value) },
                );
            } else {
                return .{ .err = location.newUnexpectedTokenError(.{ .ident = colorspace }) };
            }
        };
    }

    // Out of gamut values should not be clamped, i.e. values < 0 or > 1 should be preserved.
    // The browser will gamut-map the color for the target device that it is rendered on.
    const a = switch (input.tryParse(parseNumberOrPercentage, .{parser})) {
        .result => |vv| vv,
        .err => |e| return .{ .err = e },
    };
    const b = switch (input.tryParse(parseNumberOrPercentage, .{parser})) {
        .result => |vv| vv,
        .err => |e| return .{ .err = e },
    };
    const c = switch (input.tryParse(parseNumberOrPercentage, .{parser})) {
        .result => |vv| vv,
        .err => |e| return .{ .err = e },
    };
    const alpha = switch (parseAlpha(input, parser)) {
        .result => |vv| vv,
        .err => |e| return .{ .err = e },
    };

    const predefined: PredefinedColor = predefined: {
        const Variants = enum {
            srgb,
            @"srgb-linear",
            @"display-p3",
            @"a99-rgb",
            @"prophoto-rgb",
            rec2020,
            @"xyz-d50",
            @"xyz-d65",
            xyz,
        };
        const Map = bun.ComptimeEnumMap(Variants);
        if (Map.getAnyCase(colorspace)) |ret| {
            switch (ret) {
                .srgb => break :predefined .{ .srgb = SRGB{
                    .r = a,
                    .g = b,
                    .b = c,
                    .alpha = alpha,
                } },
                .@"srgb-linear" => break :predefined .{ .srgb_linear = SRGBLinear{
                    .r = a,
                    .g = b,
                    .b = c,
                    .alpha = alpha,
                } },
                .@"display-p3" => break :predefined .{ .display_p3 = P3{
                    .r = a,
                    .g = b,
                    .b = c,
                    .alpha = alpha,
                } },
                .@"a99-rgb" => break :predefined .{ .a98 = A98{
                    .r = a,
                    .g = b,
                    .b = c,
                    .alpha = alpha,
                } },
                .@"prophoto-rgb" => break :predefined .{ .prophoto = ProPhoto{
                    .r = a,
                    .g = b,
                    .b = c,
                    .alpha = alpha,
                } },
                .rec2020 => break :predefined .{ .rec2020 = Rec2020{
                    .r = a,
                    .g = b,
                    .b = c,
                    .alpha = alpha,
                } },
                .@"xyz-d50" => break :predefined .{ .xyz_d50 = XYZd50{
                    .x = a,
                    .y = b,
                    .z = c,
                    .alpha = alpha,
                } },
                .@"xyz-d65", .xyz => break :predefined .{ .xyz_d65 = XYZd65{
                    .x = a,
                    .y = b,
                    .z = c,
                    .alpha = alpha,
                } },
            }
        } else return .{ .err = location.newUnexpectedTokenError(.{ .ident = colorspace }) };
    };

    return .{ .result = .{
        .predefined = bun.create(
            input.allocator(),
            PredefinedColor,
            predefined,
        ),
    } };
}

/// A color type that is used as a fallback when compiling colors for older browsers.
pub const ColorFallbackKind = packed struct(u8) {
    rgb: bool = false,
    p3: bool = false,
    lab: bool = false,
    oklab: bool = false,
    __unused: u4 = 0,

    pub const P3 = ColorFallbackKind{ .p3 = true };
    pub const RGB = ColorFallbackKind{ .rgb = true };
    pub const LAB = ColorFallbackKind{ .lab = true };
    pub const OKLAB = ColorFallbackKind{ .oklab = true };

    pub fn lowest(this: @This()) ColorFallbackKind {
        return bun.bits.@"and"(
            ColorFallbackKind,
            this,
            fromBitsTruncate(bun.wrappingNegation(@as(u8, @bitCast(this)))),
        );
    }

    pub fn highest(this: @This()) ColorFallbackKind {
        // This finds the highest set bit.
        if (this.isEmpty()) return ColorFallbackKind{};

        const zeroes: u3 = @intCast(@as(u4, 7) - bun.bits.leadingZeros(ColorFallbackKind, this));
        return fromBitsTruncate(@as(u8, 1) << zeroes);
    }

    pub fn difference(left: @This(), right: @This()) ColorFallbackKind {
        return @bitCast(@as(u8, @bitCast(left)) - @as(u8, @bitCast(right)));
    }

    pub fn andBelow(this: @This()) ColorFallbackKind {
        if (this.isEmpty()) return .{};

        return bun.bits.@"or"(ColorFallbackKind, this, fromBitsTruncate(@as(u8, @bitCast(this)) - 1));
    }

    pub fn supportsCondition(this: @This()) css.SupportsCondition {
        const s = switch (this.asBits()) {
            ColorFallbackKind.P3.asBits() => "color(display-p3 0 0 0)",
            ColorFallbackKind.LAB.asBits() => "lab(0% 0 0)",
            else => bun.unreachablePanic("Expected P3 or LAB. This is a bug in Bun.", .{}),
        };

        return css.SupportsCondition{
            .declaration = .{
                .property_id = .color,
                .value = s,
            },
        };
    }

    pub fn isEmpty(cfk: ColorFallbackKind) bool {
        return @as(u8, @bitCast(cfk)) == 0;
    }

    pub inline fn fromBitsTruncate(b: u8) ColorFallbackKind {
        var cfk: ColorFallbackKind = @bitCast(b);
        cfk.__unused = 0;
        return cfk;
    }

    pub fn asBits(this: @This()) u8 {
        return @bitCast(this);
    }
};

/// A [color space](https://www.w3.org/TR/css-color-4/#interpolation-space) keyword
/// used in interpolation functions such as `color-mix()`.
pub const ColorSpaceName = enum {
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

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }
};

pub fn parseColorMix(input: *css.Parser) Result(CssColor) {
    if (input.expectIdentMatching("in").asErr()) |e| return .{ .err = e };
    const method = switch (ColorSpaceName.parse(input)) {
        .result => |vv| vv,
        .err => |e| return .{ .err = e },
    };

    const hue_method_: Result(HueInterpolationMethod) = if (switch (method) {
        .hsl, .hwb, .lch, .oklch => true,
        else => false,
    }) brk: {
        const hue_method = input.tryParse(HueInterpolationMethod.parse, .{});
        if (hue_method.isOk()) {
            if (input.expectIdentMatching("hue").asErr()) |e| return .{ .err = e };
        }
        break :brk hue_method;
    } else .{ .result = HueInterpolationMethod.shorter };

    const hue_method = hue_method_.unwrapOr(HueInterpolationMethod.shorter);
    if (input.expectComma().asErr()) |e| return .{ .err = e };

    const first_percent_ = input.tryParse(css.Parser.expectPercentage, .{});
    const first_color = switch (CssColor.parse(input)) {
        .result => |vv| vv,
        .err => |e| return .{ .err = e },
    };
    const first_percent = switch (first_percent_) {
        .result => |v| v,
        .err => switch (input.tryParse(css.Parser.expectPercentage, .{})) {
            .result => |vv| vv,
            .err => null,
        },
    };
    if (input.expectComma().asErr()) |e| return .{ .err = e };

    const second_percent_ = input.tryParse(css.Parser.expectPercentage, .{});
    const second_color = switch (CssColor.parse(input)) {
        .result => |vv| vv,
        .err => |e| return .{ .err = e },
    };
    const second_percent = switch (second_percent_) {
        .result => |vv| vv,
        .err => switch (input.tryParse(css.Parser.expectPercentage, .{})) {
            .result => |vv| vv,
            .err => null,
        },
    };

    // https://drafts.csswg.org/css-color-5/#color-mix-percent-norm
    const p1: f32, const p2: f32 = if (first_percent == null and second_percent == null) .{ @as(f32, 0.5), @as(f32, 0.5) } else brk: {
        const p2 = second_percent orelse (@as(f32, 1.0) - first_percent.?);
        const p1 = first_percent orelse (@as(f32, 1.0) - second_percent.?);
        break :brk .{ p1, p2 };
    };

    if ((p1 + p2) == 0.0) return .{ .err = input.newCustomError(css.ParserError.invalid_value) };

    const result = switch (method) {
        .srgb => first_color.interpolate(input.allocator(), SRGB, p1, &second_color, p2, hue_method),
        .@"srgb-linear" => first_color.interpolate(input.allocator(), SRGBLinear, p1, &second_color, p2, hue_method),
        .hsl => first_color.interpolate(input.allocator(), HSL, p1, &second_color, p2, hue_method),
        .hwb => first_color.interpolate(input.allocator(), HWB, p1, &second_color, p2, hue_method),
        .lab => first_color.interpolate(input.allocator(), LAB, p1, &second_color, p2, hue_method),
        .lch => first_color.interpolate(input.allocator(), LCH, p1, &second_color, p2, hue_method),
        .oklab => first_color.interpolate(input.allocator(), OKLAB, p1, &second_color, p2, hue_method),
        .oklch => first_color.interpolate(input.allocator(), OKLCH, p1, &second_color, p2, hue_method),
        .xyz, .@"xyz-d65" => first_color.interpolate(input.allocator(), XYZd65, p1, &second_color, p2, hue_method),
        .@"xyz-d50" => first_color.interpolate(input.allocator(), XYZd65, p1, &second_color, p2, hue_method),
    } orelse return .{ .err = input.newCustomError(css.ParserError.invalid_value) };

    return .{ .result = result };
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

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }

    pub fn interpolate(
        this: *const HueInterpolationMethod,
        a: *f32,
        b: *f32,
    ) void {
        // https://drafts.csswg.org/css-color/#hue-interpolation
        if (this.* == .specified) {
            // a.* = ((a.* % 360.0) + 360.0) % 360.0;
            // b.* = ((b.* % 360.0) + 360.0) % 360.0;
            a.* = @mod((@mod(a.*, 360.0) + 360.0), 360.0);
            b.* = @mod((@mod(b.*, 360.0) + 360.0), 360.0);
        }

        switch (this.*) {
            .shorter => {
                // https://www.w3.org/TR/css-color-4/#hue-shorter
                const delta = b.* - a.*;
                if (delta > 180.0) {
                    a.* += 360.0;
                } else if (delta < -180.0) {
                    b.* += 360.0;
                }
            },
            .longer => {
                // https://www.w3.org/TR/css-color-4/#hue-longer
                const delta = b.* - a.*;
                if (0.0 < delta and delta < 180.0) {
                    a.* += 360.0;
                } else if (-180.0 < delta and delta < 0.0) {
                    b.* += 360.0;
                }
            },
            .increasing => {
                // https://www.w3.org/TR/css-color-4/#hue-decreasing
                if (b.* < a.*) {
                    b.* += 360.0;
                }
            },
            .decreasing => {
                // https://www.w3.org/TR/css-color-4/#hue-decreasing
                if (a.* < b.*) {
                    a.* += 360.0;
                }
            },
            .specified => {},
        }
    }
};

fn rectangularToPolar(l: f32, a: f32, b: f32) struct { f32, f32, f32 } {
    // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L375

    var h = std.math.atan2(b, a) * 180.0 / std.math.pi;
    if (h < 0.0) {
        h += 360.0;
    }

    // const c = @sqrt(std.math.powi(f32, a, 2) + std.math.powi(f32, b, 2));
    // PERF: Zig does not have Rust's f32::powi
    const c = @sqrt(bun.powf(a, 2) + bun.powf(b, 2));

    // h = h % 360.0;
    h = @mod(h, 360.0);
    return .{ l, c, h };
}

pub fn ColorspaceConversions(comptime T: type) type {
    return struct {
        const convert_type: ConvertTo = .fromType(T);

        pub fn fromLABColor(color: *const LABColor) T {
            return switch (color.*) {
                inline else => |*v| v.into(convert_type),
            };
        }

        pub fn fromPredefinedColor(color: *const PredefinedColor) T {
            return switch (color.*) {
                inline else => |*v| v.into(convert_type),
            };
        }

        pub fn fromFloatColor(color: *const FloatColor) T {
            return switch (color.*) {
                inline else => |*v| v.into(convert_type),
            };
        }

        pub fn tryFromCssColor(color: *const CssColor) ?T {
            return switch (color.*) {
                .rgba => |*rgba| rgba.into(convert_type),
                .lab => |lab| fromLABColor(lab),
                .predefined => |predefined| fromPredefinedColor(predefined),
                .float => |float| fromFloatColor(float),
                .current_color => null,
                .light_dark => null,
                .system => null,
            };
        }

        pub fn hash(this: *const T, hasher: *std.hash.Wyhash) void {
            return css.implementHash(T, this, hasher);
        }
    };
}

pub fn DefineColorspace(comptime T: type, comptime ChannelTypeMap: anytype) type {
    const fields: []const std.builtin.Type.StructField = @typeInfo(T).@"struct".fields;
    const a = fields[0].name;
    const b = fields[1].name;
    const c = fields[2].name;
    const alpha = "alpha";
    if (!@hasField(T, "alpha")) {
        @compileError("A Colorspace must define an alpha field");
    }

    if (!@hasField(@TypeOf(ChannelTypeMap), a)) {
        @compileError("A Colorspace must define a field for each channel, missing: " ++ a);
    }
    if (!@hasField(@TypeOf(ChannelTypeMap), b)) {
        @compileError("A Colorspace must define a field for each channel, missing: " ++ b);
    }
    if (!@hasField(@TypeOf(ChannelTypeMap), c)) {
        @compileError("A Colorspace must define a field for each channel, missing: " ++ c);
    }

    return struct {
        pub fn components(this: *const T) struct { f32, f32, f32, f32 } {
            return .{
                @field(this, a),
                @field(this, b),
                @field(this, c),
                @field(this, alpha),
            };
        }

        pub fn channels(_: *const T) struct { []const u8, []const u8, []const u8 } {
            return .{ a, b, c };
        }

        pub fn types(_: *const T) struct { ChannelType, ChannelType, ChannelType } {
            return .{
                @field(ChannelTypeMap, a),
                @field(ChannelTypeMap, b),
                @field(ChannelTypeMap, c),
            };
        }

        pub fn resolveMissing(this: *const T) T {
            var result: T = this.*;
            @field(result, a) = if (std.math.isNan(@field(this, a))) 0.0 else @field(this, a);
            @field(result, b) = if (std.math.isNan(@field(this, b))) 0.0 else @field(this, b);
            @field(result, c) = if (std.math.isNan(@field(this, c))) 0.0 else @field(this, c);
            @field(result, alpha) = if (std.math.isNan(@field(this, alpha))) 0.0 else @field(this, alpha);
            return result;
        }

        pub fn resolve(this: *const T) T {
            var resolved = resolveMissing(this);
            if (!resolved.inGamut()) {
                resolved = mapGamut(T, resolved);
            }
            return resolved;
        }
    };
}

pub fn BoundedColorGamut(comptime T: type) type {
    const fields: []const std.builtin.Type.StructField = std.meta.fields(T);
    const a = fields[0].name;
    const b = fields[1].name;
    const c = fields[2].name;
    return struct {
        pub fn inGamut(this: *const T) bool {
            return @field(this, a) >= 0.0 and
                @field(this, a) <= 1.0 and
                @field(this, b) >= 0.0 and
                @field(this, b) <= 1.0 and
                @field(this, c) >= 0.0 and
                @field(this, c) <= 1.0;
        }

        pub fn clip(this: *const T) T {
            var result: T = this.*;
            @field(result, a) = bun.clamp(@field(this, a), 0.0, 1.0);
            @field(result, b) = bun.clamp(@field(this, b), 0.0, 1.0);
            @field(result, c) = bun.clamp(@field(this, c), 0.0, 1.0);
            result.alpha = bun.clamp(this.alpha, 0.0, 1.0);
            return result;
        }
    };
}

pub fn DeriveInterpolate(
    comptime T: type,
    comptime a: []const u8,
    comptime b: []const u8,
    comptime c: []const u8,
) type {
    if (!@hasField(T, a)) @compileError("Missing field: " ++ a);
    if (!@hasField(T, b)) @compileError("Missing field: " ++ b);
    if (!@hasField(T, c)) @compileError("Missing field: " ++ c);

    return struct {
        pub fn fillMissingComponents(this: *T, other: *T) void {
            if (std.math.isNan(@field(this, a))) {
                @field(this, a) = @field(other, a);
            }

            if (std.math.isNan(@field(this, b))) {
                @field(this, b) = @field(other, b);
            }

            if (std.math.isNan(@field(this, c))) {
                @field(this, c) = @field(other, c);
            }

            if (std.math.isNan(this.alpha)) {
                this.alpha = other.alpha;
            }
        }

        pub fn interpolate(this: *const T, p1: f32, other: *const T, p2: f32) T {
            var result: T = undefined;
            @field(result, a) = @field(this, a) * p1 + @field(other, a) * p2;
            @field(result, b) = @field(this, b) * p1 + @field(other, b) * p2;
            @field(result, c) = @field(this, c) * p1 + @field(other, c) * p2;
            result.alpha = this.alpha * p1 + other.alpha * p2;
            return result;
        }
    };
}

// pub fn DerivePredefined(comptime T: type, comptime predefined_color_field: []const u8) type {
//     return struct {
//         pub fn
//     };
// }

pub fn RecangularPremultiply(
    comptime T: type,
    comptime a: []const u8,
    comptime b: []const u8,
    comptime c: []const u8,
) type {
    if (!@hasField(T, a)) @compileError("Missing field: " ++ a);
    if (!@hasField(T, b)) @compileError("Missing field: " ++ b);
    if (!@hasField(T, c)) @compileError("Missing field: " ++ c);
    return struct {
        pub fn premultiply(this: *T) void {
            if (!std.math.isNan(this.alpha)) {
                @field(this, a) *= this.alpha;
                @field(this, b) *= this.alpha;
                @field(this, c) *= this.alpha;
            }
        }

        pub fn unpremultiply(this: *T, alpha_multiplier: f32) void {
            if (!std.math.isNan(this.alpha) and this.alpha != 0.0) {
                // PERF: precalculate 1/alpha?
                @field(this, a) /= this.alpha;
                @field(this, b) /= this.alpha;
                @field(this, c) /= this.alpha;
                this.alpha *= alpha_multiplier;
            }
        }
    };
}

pub fn PolarPremultiply(
    comptime T: type,
    comptime a: []const u8,
    comptime b: []const u8,
) type {
    if (!@hasField(T, a)) @compileError("Missing field: " ++ a);
    if (!@hasField(T, b)) @compileError("Missing field: " ++ b);
    return struct {
        pub fn premultiply(this: *T) void {
            if (!std.math.isNan(this.alpha)) {
                @field(this, a) *= this.alpha;
                @field(this, b) *= this.alpha;
            }
        }

        pub fn unpremultiply(this: *T, alpha_multiplier: f32) void {
            // this.h %= 360.0;
            this.h = @mod(this.h, 360.0);
            if (!std.math.isNan(this.alpha)) {
                // PERF: precalculate 1/alpha?
                @field(this, a) /= this.alpha;
                @field(this, b) /= this.alpha;
                this.alpha *= alpha_multiplier;
            }
        }
    };
}

pub fn AdjustPowerlessLAB(comptime T: type) type {
    return struct {
        pub fn adjustPowerlessComponents(this: *T) void {
            // If the lightness of a LAB color is 0%, both the a and b components are powerless.
            if (@abs(this.l) < std.math.floatEps(f32)) {
                this.a = std.math.nan(f32);
                this.b = std.math.nan(f32);
            }
        }
    };
}

pub fn AdjustPowerlessLCH(comptime T: type) type {
    return struct {
        pub fn adjustPowerlessComponents(this: *T) void {
            // If the chroma of an LCH color is 0%, the hue component is powerless.
            // If the lightness of an LCH color is 0%, both the hue and chroma components are powerless.
            if (@abs(this.c) < std.math.floatEps(f32)) {
                this.h = std.math.nan(f32);
            }

            if (@abs(this.l) < std.math.floatEps(f32)) {
                this.c = std.math.nan(f32);
                this.h = std.math.nan(f32);
            }
        }

        pub fn adjustHue(this: *T, other: *T, method: HueInterpolationMethod) void {
            _ = method.interpolate(&this.h, &other.h);
        }
    };
}

pub fn shortColorName(v: u32) ?[]const u8 {
    // These names are shorter than their hex codes
    return switch (v) {
        0x000080 => "navy",
        0x008000 => "green",
        0x008080 => "teal",
        0x4b0082 => "indigo",
        0x800000 => "maroon",
        0x800080 => "purple",
        0x808000 => "olive",
        0x808080 => "gray",
        0xa0522d => "sienna",
        0xa52a2a => "brown",
        0xc0c0c0 => "silver",
        0xcd853f => "peru",
        0xd2b48c => "tan",
        0xda70d6 => "orchid",
        0xdda0dd => "plum",
        0xee82ee => "violet",
        0xf0e68c => "khaki",
        0xf0ffff => "azure",
        0xf5deb3 => "wheat",
        0xf5f5dc => "beige",
        0xfa8072 => "salmon",
        0xfaf0e6 => "linen",
        0xff0000 => "red",
        0xff6347 => "tomato",
        0xff7f50 => "coral",
        0xffa500 => "orange",
        0xffc0cb => "pink",
        0xffd700 => "gold",
        0xffe4c4 => "bisque",
        0xfffafa => "snow",
        0xfffff0 => "ivory",
        else => return null,
    };
}

// From esbuild: https://github.com/evanw/esbuild/blob/18e13bdfdca5cd3c7a2fae1a8bd739f8f891572c/internal/css_parser/css_decls_color.go#L218
// 0xAABBCCDD => 0xABCD
pub fn compactHex(v: u32) u32 {
    return ((v & 0x0FF00000) >> 12) | ((v & 0x00000FF0) >> 4);
}

// 0xABCD => 0xAABBCCDD
pub fn expandHex(v: u32) u32 {
    return ((v & 0xF000) << 16) |
        ((v & 0xFF00) << 12) |
        ((v & 0x0FF0) << 8) |
        ((v & 0x00FF) << 4) |
        (v & 0x000F);
}

pub fn writeComponents(
    name: []const u8,
    a: f32,
    b: f32,
    c: f32,
    alpha: f32,
    comptime W: type,
    dest: *Printer(W),
) PrintErr!void {
    try dest.writeStr(name);
    try dest.writeChar('(');
    if (std.math.isNan(a)) {
        try dest.writeStr("none");
    } else {
        try (Percentage{ .v = a }).toCss(W, dest);
    }
    try dest.writeChar(' ');
    try writeComponent(b, W, dest);
    try dest.writeChar(' ');
    try writeComponent(c, W, dest);
    if (std.math.isNan(alpha) or @abs(alpha - 1.0) > std.math.floatEps(f32)) {
        try dest.delim('/', true);
        try writeComponent(alpha, W, dest);
    }
    return dest.writeChar(')');
}

pub fn writeComponent(c: f32, comptime W: type, dest: *Printer(W)) PrintErr!void {
    if (std.math.isNan(c)) {
        return dest.writeStr("none");
    } else {
        return CSSNumberFns.toCss(&c, W, dest);
    }
}

pub fn writePredefined(
    predefined: *const PredefinedColor,
    comptime W: type,
    dest: *Printer(W),
) PrintErr!void {
    const name, const a, const b, const c, const alpha = switch (predefined.*) {
        .srgb => |*rgb| .{ "srgb", rgb.r, rgb.g, rgb.b, rgb.alpha },
        .srgb_linear => |*rgb| .{ "srgb-linear", rgb.r, rgb.g, rgb.b, rgb.alpha },
        .display_p3 => |*rgb| .{ "display-p3", rgb.r, rgb.g, rgb.b, rgb.alpha },
        .a98 => |*rgb| .{ "a98-rgb", rgb.r, rgb.g, rgb.b, rgb.alpha },
        .prophoto => |*rgb| .{ "prophoto-rgb", rgb.r, rgb.g, rgb.b, rgb.alpha },
        .rec2020 => |*rgb| .{ "rec2020", rgb.r, rgb.g, rgb.b, rgb.alpha },
        .xyz_d50 => |*xyz| .{ "xyz-d50", xyz.x, xyz.y, xyz.z, xyz.alpha },
        // "xyz" has better compatibility (Safari 15) than "xyz-d65", and it is shorter.
        .xyz_d65 => |*xyz| .{ "xyz", xyz.x, xyz.y, xyz.z, xyz.alpha },
    };

    try dest.writeStr("color(");
    try dest.writeStr(name);
    try dest.writeChar(' ');
    try writeComponent(a, W, dest);
    try dest.writeChar(' ');
    try writeComponent(b, W, dest);
    try dest.writeChar(' ');
    try writeComponent(c, W, dest);

    if (std.math.isNan(alpha) or @abs(alpha - 1.0) > std.math.floatEps(f32)) {
        try dest.delim('/', true);
        try writeComponent(alpha, W, dest);
    }

    return dest.writeChar(')');
}

extern "c" fn powf(f32, f32) f32;

pub fn gamSrgb(r: f32, g: f32, b: f32) struct { f32, f32, f32 } {
    // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L31
    // convert an array of linear-light sRGB values in the range 0.0-1.0
    // to gamma corrected form
    // https://en.wikipedia.org/wiki/SRGB
    // Extended transfer function:
    // For negative values, linear portion extends on reflection
    // of axis, then uses reflected pow below that

    const Helpers = struct {
        pub fn gamSrgbComponent(c: f32) f32 {
            const abs = @abs(c);
            if (abs > 0.0031308) {
                const sign: f32 = if (c < 0.0) @as(f32, -1.0) else @as(f32, 1.0);
                // const x: f32 = bun.powf( abs,  1.0 / 2.4);
                const x: f32 = powf(abs, 1.0 / 2.4);
                const y: f32 = 1.055 * x;
                const z: f32 = y - 0.055;
                // return sign * (1.055 * bun.powf( abs,  1.0 / 2.4) - 0.055);
                return sign * z;
            }

            return 12.92 * c;
        }
    };

    const rr = Helpers.gamSrgbComponent(r);
    const gg = Helpers.gamSrgbComponent(g);
    const bb = Helpers.gamSrgbComponent(b);
    return .{
        rr,
        gg,
        bb,
    };
}

pub fn linSrgb(r: f32, g: f32, b: f32) struct { f32, f32, f32 } {
    // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L11
    // convert sRGB values where in-gamut values are in the range [0 - 1]
    // to linear light (un-companded) form.
    // https://en.wikipedia.org/wiki/SRGB
    // Extended transfer function:
    // for negative values, linear portion is extended on reflection of axis,
    // then reflected power function is used.

    const H = struct {
        pub fn linSrgbComponent(c: f32) f32 {
            const abs = @abs(c);
            if (abs < 0.04045) {
                return c / 12.92;
            }

            const sign: f32 = if (c < 0.0) -1.0 else 1.0;
            return sign * bun.powf(
                ((abs + 0.055) / 1.055),
                2.4,
            );
        }
    };

    return .{
        H.linSrgbComponent(r),
        H.linSrgbComponent(g),
        H.linSrgbComponent(b),
    };
}

/// PERF: SIMD?
pub fn multiplyMatrix(m: *const [9]f32, x: f32, y: f32, z: f32) struct { f32, f32, f32 } {
    const a = m[0] * x + m[1] * y + m[2] * z;
    const b = m[3] * x + m[4] * y + m[5] * z;
    const c = m[6] * x + m[7] * y + m[8] * z;
    return .{ a, b, c };
}

pub fn polarToRectangular(l: f32, c: f32, h: f32) struct { f32, f32, f32 } {
    // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L385

    const a = c * @cos(h * std.math.pi / 180.0);
    const b = c * @sin(h * std.math.pi / 180.0);
    return .{ l, a, b };
}

const D50: []const f32 = &.{ @floatCast(@as(f64, 0.3457) / @as(f64, 0.3585)), 1.00000, @floatCast((@as(f64, 1.0) - @as(f64, 0.3457) - @as(f64, 0.3585)) / @as(f64, 0.3585)) };
// const D50: []const f32 = &.{ 0.9642956, 1.0, 0.82510453 };

const generated_color_conversions = @import("./color_generated.zig").generated_color_conversions;
const color_conversions = struct {
    pub const convert_RGBA = struct {};

    pub const convert_LAB = struct {
        pub fn intoCssColor(c: *const LAB, allocator: Allocator) CssColor {
            return CssColor{ .lab = bun.create(
                allocator,
                LABColor,
                LABColor{ .lab = c.* },
            ) };
        }

        pub fn intoLCH(_lab: *const LAB) LCH {
            const lab = _lab.resolveMissing();
            const l, const c, const h = rectangularToPolar(lab.l, lab.a, lab.b);
            return LCH{
                .l = l,
                .c = c,
                .h = h,
                .alpha = lab.alpha,
            };
        }

        pub fn intoXYZd50(_lab: *const LAB) XYZd50 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L352
            const K: f32 = @floatCast(@as(f64, 24389.0) / @as(f64, 27.0)); // 29^3/3^3
            const E: f32 = @floatCast(@as(f64, 216.0) / @as(f64, 24389.0)); // 6^3/29^3

            const lab = _lab.resolveMissing();
            const l = lab.l * 100.0;
            const a = lab.a;
            const b = lab.b;

            // compute f, starting with the luminance-related term
            const f1: f32 = (l + 16.0) / 116.0;
            const f0: f32 = a / 500.0 + f1;
            const f2: f32 = f1 - b / 200.0;

            // compute xyz
            const x = if (bun.powf(f0, 3) > E)
                bun.powf(f0, 3)
            else
                (116.0 * f0 - 16.0) / K;

            const y = if (l > K * E) bun.powf((l + 16.0) / 116.0, 3) else l / K;

            const z = if (bun.powf(f2, 3) > E)
                bun.powf(f2, 3)
            else
                (@as(f32, 116.0) * f2 - 16.0) / K;

            const final_x = x * D50[0];
            const final_y = y * D50[1];
            const final_z = z * D50[2];

            // Compute XYZ by scaling xyz by reference white
            return XYZd50{
                .x = final_x,
                .y = final_y,
                .z = final_z,
                .alpha = lab.alpha,
            };
        }
    };

    pub const convert_SRGB = struct {
        pub fn intoCssColor(srgb: *const SRGB, _: Allocator) CssColor {
            // TODO: should we serialize as color(srgb, ...)?
            // would be more precise than 8-bit color.
            return CssColor{ .rgba = srgb.into(.RGBA) };
        }

        pub fn intoSRGBLinear(rgb: *const SRGB) SRGBLinear {
            const srgb = rgb.resolveMissing();
            const r, const g, const b = linSrgb(srgb.r, srgb.g, srgb.b);
            return SRGBLinear{
                .r = r,
                .g = g,
                .b = b,
                .alpha = srgb.alpha,
            };
        }

        pub fn intoHSL(_rgb: *const SRGB) HSL {
            // https://drafts.csswg.org/css-color/#rgb-to-hsl
            const rgb = _rgb.resolve();
            const r = rgb.r;
            const g = rgb.g;
            const b = rgb.b;
            const max = @max(
                @max(r, g),
                b,
            );
            const min = @min(@min(r, g), b);
            var h = std.math.nan(f32);
            var s: f32 = 0.0;
            const l = (min + max) / 2.0;
            const d = max - min;

            if (d != 0.0) {
                s = if (l == 0.0 or l == 1.0)
                    0.0
                else
                    (max - l) / @min(l, 1.0 - l);

                if (max == r) {
                    h = (g - b) / d + (if (g < b) @as(f32, 6.0) else @as(f32, 0.0));
                } else if (max == g) {
                    h = (b - r) / d + 2.0;
                } else if (max == b) {
                    h = (r - g) / d + 4.0;
                }

                h = h * 60.0;
            }

            return HSL{
                .h = h,
                .s = s,
                .l = l,
                .alpha = rgb.alpha,
            };
        }

        pub fn intoHWB(_rgb: *const SRGB) HWB {
            const rgb = _rgb.resolve();
            const hsl = rgb.into(.HSL);
            const r = rgb.r;
            const g = rgb.g;
            const _b = rgb.b;
            const w = @min(@min(r, g), _b);
            const b = 1.0 - @max(@max(r, g), _b);
            return HWB{
                .h = hsl.h,
                .w = w,
                .b = b,
                .alpha = rgb.alpha,
            };
        }
    };

    pub const convert_HSL = struct {
        pub fn intoCssColor(c: *const HSL, _: Allocator) CssColor {
            // TODO: should we serialize as color(srgb, ...)?
            // would be more precise than 8-bit color.
            return CssColor{ .rgba = c.into(.RGBA) };
        }

        pub fn intoSRGB(hsl_: *const HSL) SRGB {
            // https://drafts.csswg.org/css-color/#hsl-to-rgb
            const hsl = hsl_.resolveMissing();
            const h = (hsl.h - 360.0 * @floor(hsl.h / 360.0)) / 360.0;
            const r, const g, const b = css.color.hslToRgb(h, hsl.s, hsl.l);
            return SRGB{
                .r = r,
                .g = g,
                .b = b,
                .alpha = hsl.alpha,
            };
        }
    };

    pub const convert_HWB = struct {
        pub fn intoCssColor(c: *const HWB, _: Allocator) CssColor {
            // TODO: should we serialize as color(srgb, ...)?
            // would be more precise than 8-bit color.
            return CssColor{ .rgba = c.into(.RGBA) };
        }

        pub fn intoSRGB(_hwb: *const HWB) SRGB {
            // https://drafts.csswg.org/css-color/#hwb-to-rgb
            const hwb = _hwb.resolveMissing();
            const h = hwb.h;
            const w = hwb.w;
            const b = hwb.b;

            if (w + b >= 1.0) {
                const gray = w / (w + b);
                return SRGB{
                    .r = gray,
                    .g = gray,
                    .b = gray,
                    .alpha = hwb.alpha,
                };
            }

            var rgba = (HSL{ .h = h, .s = 1.0, .l = 0.5, .alpha = hwb.alpha }).into(.SRGB);
            const x = 1.0 - w - b;
            rgba.r = rgba.r * x + w;
            rgba.g = rgba.g * x + w;
            rgba.b = rgba.b * x + w;
            return rgba;
        }
    };

    pub const convert_SRGBLinear = struct {
        pub fn intoPredefinedColor(rgb: *const SRGBLinear) PredefinedColor {
            return PredefinedColor{ .srgb_linear = rgb.* };
        }

        pub fn intoCssColor(rgb: *const SRGBLinear, allocator: Allocator) CssColor {
            return CssColor{
                .predefined = bun.create(
                    allocator,
                    PredefinedColor,
                    rgb.into(.PredefinedColor),
                ),
            };
        }

        pub fn intoSRGB(_rgb: *const SRGBLinear) SRGB {
            const rgb = _rgb.resolveMissing();
            const r, const g, const b = gamSrgb(rgb.r, rgb.g, rgb.b);
            return SRGB{
                .r = r,
                .g = g,
                .b = b,
                .alpha = rgb.alpha,
            };
        }

        pub fn intoXYZd65(_rgb: *const SRGBLinear) XYZd65 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L50
            // convert an array of linear-light sRGB values to CIE XYZ
            // using sRGB's own white, D65 (no chromatic adaptation)
            const MATRIX: [9]f32 = .{
                0.41239079926595934,
                0.357584339383878,
                0.1804807884018343,
                0.21263900587151027,
                0.715168678767756,
                0.07219231536073371,
                0.01933081871559182,
                0.11919477979462598,
                0.9505321522496607,
            };

            const rgb = _rgb.resolveMissing();
            const x, const y, const z = multiplyMatrix(&MATRIX, rgb.r, rgb.g, rgb.b);
            return XYZd65{
                .x = x,
                .y = y,
                .z = z,
                .alpha = rgb.alpha,
            };
        }
    };

    pub const convert_P3 = struct {
        pub fn intoPredefinedColor(rgb: *const P3) PredefinedColor {
            return PredefinedColor{ .display_p3 = rgb.* };
        }

        pub fn intoCssColor(rgb: *const P3, allocator: Allocator) CssColor {
            return CssColor{
                .predefined = bun.create(
                    allocator,
                    PredefinedColor,
                    rgb.into(.PredefinedColor),
                ),
            };
        }

        pub fn intoXYZd65(_p3: *const P3) XYZd65 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L91
            // convert linear-light display-p3 values to CIE XYZ
            // using D65 (no chromatic adaptation)
            // http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html
            const MATRIX: [9]f32 = .{
                0.4865709486482162,
                0.26566769316909306,
                0.1982172852343625,
                0.2289745640697488,
                0.6917385218365064,
                0.079286914093745,
                0.0000000000000000,
                0.04511338185890264,
                1.043944368900976,
            };

            const p3 = _p3.resolveMissing();
            const r, const g, const b = linSrgb(p3.r, p3.g, p3.b);
            const x, const y, const z = multiplyMatrix(&MATRIX, r, g, b);
            return XYZd65{
                .x = x,
                .y = y,
                .z = z,
                .alpha = p3.alpha,
            };
        }
    };

    pub const convert_A98 = struct {
        pub fn intoPredefinedColor(rgb: *const A98) PredefinedColor {
            return PredefinedColor{ .a98 = rgb.* };
        }

        pub fn intoCssColor(rgb: *const A98, allocator: Allocator) CssColor {
            return CssColor{
                .predefined = bun.create(
                    allocator,
                    PredefinedColor,
                    rgb.into(.PredefinedColor),
                ),
            };
        }

        pub fn intoXYZd65(_a98: *const A98) XYZd65 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L181
            const H = struct {
                pub fn linA98rgbComponent(c: f32) f32 {
                    const sign: f32 = if (c < 0.0) @as(f32, -1.0) else @as(f32, 1.0);
                    return sign * bun.powf(@abs(c), 563.0 / 256.0);
                }
            };

            // convert an array of a98-rgb values in the range 0.0 - 1.0
            // to linear light (un-companded) form.
            // negative values are also now accepted
            const a98 = _a98.resolveMissing();
            const r = H.linA98rgbComponent(a98.r);
            const g = H.linA98rgbComponent(a98.g);
            const b = H.linA98rgbComponent(a98.b);

            // convert an array of linear-light a98-rgb values to CIE XYZ
            // http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html
            // has greater numerical precision than section 4.3.5.3 of
            // https://www.adobe.com/digitalimag/pdfs/AdobeRGB1998.pdf
            // but the values below were calculated from first principles
            // from the chromaticity coordinates of R G B W
            // see matrixmaker.html
            const MATRIX: [9]f32 = .{
                0.5766690429101305,
                0.1855582379065463,
                0.1882286462349947,
                0.29734497525053605,
                0.6273635662554661,
                0.07529145849399788,
                0.02703136138641234,
                0.07068885253582723,
                0.9913375368376388,
            };

            const x, const y, const z = multiplyMatrix(&MATRIX, r, g, b);
            return XYZd65{
                .x = x,
                .y = y,
                .z = z,
                .alpha = a98.alpha,
            };
        }
    };

    pub const convert_ProPhoto = struct {
        pub fn intoPredefinedColor(rgb: *const ProPhoto) PredefinedColor {
            return PredefinedColor{ .prophoto = rgb.* };
        }

        pub fn intoCssColor(rgb: *const ProPhoto, allocator: Allocator) CssColor {
            return CssColor{
                .predefined = bun.create(
                    allocator,
                    PredefinedColor,
                    rgb.into(.PredefinedColor),
                ),
            };
        }

        pub fn intoXYZd50(_prophoto: *const ProPhoto) XYZd50 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L118
            // convert an array of prophoto-rgb values
            // where in-gamut colors are in the range [0.0 - 1.0]
            // to linear light (un-companded) form.
            // Transfer curve is gamma 1.8 with a small linear portion
            // Extended transfer function

            const H = struct {
                pub fn linProPhotoComponent(c: f32) f32 {
                    const ET2: f32 = 16.0 / 512.0;
                    const abs = @abs(c);
                    if (abs <= ET2) {
                        return c / 16.0;
                    }
                    const sign: f32 = if (c < 0.0) -1.0 else 1.0;
                    return sign * bun.powf(abs, 1.8);
                }
            };

            const prophoto = _prophoto.resolveMissing();
            const r = H.linProPhotoComponent(prophoto.r);
            const g = H.linProPhotoComponent(prophoto.g);
            const b = H.linProPhotoComponent(prophoto.b);

            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L155
            // convert an array of linear-light prophoto-rgb values to CIE XYZ
            // using  D50 (so no chromatic adaptation needed afterwards)
            // http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html
            const MATRIX: [9]f32 = .{
                0.7977604896723027,
                0.13518583717574031,
                0.0313493495815248,
                0.2880711282292934,
                0.7118432178101014,
                0.00008565396060525902,
                0.0,
                0.0,
                0.8251046025104601,
            };

            const x, const y, const z = multiplyMatrix(&MATRIX, r, g, b);
            return XYZd50{
                .x = x,
                .y = y,
                .z = z,
                .alpha = prophoto.alpha,
            };
        }
    };

    pub const convert_Rec2020 = struct {
        pub fn intoPredefinedColor(rgb: *const Rec2020) PredefinedColor {
            return PredefinedColor{ .rec2020 = rgb.* };
        }

        pub fn intoCssColor(rgb: *const Rec2020, allocator: Allocator) CssColor {
            return CssColor{
                .predefined = bun.create(
                    allocator,
                    PredefinedColor,
                    rgb.into(.PredefinedColor),
                ),
            };
        }

        pub fn intoXYZd65(_rec2020: *const Rec2020) XYZd65 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L235
            // convert an array of rec2020 RGB values in the range 0.0 - 1.0
            // to linear light (un-companded) form.
            // ITU-R BT.2020-2 p.4

            const H = struct {
                pub fn linRec2020Component(c: f32) f32 {
                    const A: f32 = 1.09929682680944;
                    const B: f32 = 0.018053968510807;

                    const abs = @abs(c);
                    if (abs < B * 4.5) {
                        return c / 4.5;
                    }

                    const sign: f32 = if (c < 0.0) -1.0 else 1.0;
                    return sign * bun.powf(
                        (abs + A - 1.0) / A,
                        1.0 / 0.45,
                    );
                }
            };

            const rec2020 = _rec2020.resolveMissing();
            const r = H.linRec2020Component(rec2020.r);
            const g = H.linRec2020Component(rec2020.g);
            const b = H.linRec2020Component(rec2020.b);

            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L276
            // convert an array of linear-light rec2020 values to CIE XYZ
            // using  D65 (no chromatic adaptation)
            // http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html
            const MATRIX: [9]f32 = .{
                0.6369580483012914,
                0.14461690358620832,
                0.1688809751641721,
                0.2627002120112671,
                0.6779980715188708,
                0.05930171646986196,
                0.000000000000000,
                0.028072693049087428,
                1.060985057710791,
            };

            const x, const y, const z = multiplyMatrix(&MATRIX, r, g, b);

            return XYZd65{
                .x = x,
                .y = y,
                .z = z,
                .alpha = rec2020.alpha,
            };
        }
    };

    pub const convert_XYZd50 = struct {
        pub fn intoPredefinedColor(rgb: *const XYZd50) PredefinedColor {
            return PredefinedColor{ .xyz_d50 = rgb.* };
        }

        pub fn intoCssColor(rgb: *const XYZd50, allocator: Allocator) CssColor {
            return CssColor{
                .predefined = bun.create(
                    allocator,
                    PredefinedColor,
                    rgb.into(.PredefinedColor),
                ),
            };
        }

        pub fn intoLAB(_xyz: *const XYZd50) LAB {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L332
            // Assuming XYZ is relative to D50, convert to CIE LAB
            // from CIE standard, which now defines these as a rational fraction
            const E: f32 = 216.0 / 24389.0; // 6^3/29^3
            const K: f32 = 24389.0 / 27.0; // 29^3/3^3

            // compute xyz, which is XYZ scaled relative to reference white
            const xyz = _xyz.resolveMissing();
            const x = xyz.x / D50[0];
            const y = xyz.y / D50[1];
            const z = xyz.z / D50[2];

            // now compute f

            const f0 = if (x > E) std.math.cbrt(x) else (K * x + 16.0) / 116.0;

            const f1 = if (y > E) std.math.cbrt(y) else (K * y + 16.0) / 116.0;

            const f2 = if (z > E) std.math.cbrt(z) else (K * z + 16.0) / 116.0;

            const l = ((116.0 * f1) - 16.0) / 100.0;
            const a = 500.0 * (f0 - f1);
            const b = 200.0 * (f1 - f2);

            return LAB{
                .l = l,
                .a = a,
                .b = b,
                .alpha = xyz.alpha,
            };
        }

        pub fn intoXYZd65(_xyz: *const XYZd50) XYZd65 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L105
            const MATRIX: [9]f32 = .{
                0.9554734527042182,
                -0.023098536874261423,
                0.0632593086610217,
                -0.028369706963208136,
                1.0099954580058226,
                0.021041398966943008,
                0.012314001688319899,
                -0.020507696433477912,
                1.3303659366080753,
            };

            const xyz = _xyz.resolveMissing();
            const x, const y, const z = multiplyMatrix(&MATRIX, xyz.x, xyz.y, xyz.z);
            return XYZd65{
                .x = x,
                .y = y,
                .z = z,
                .alpha = xyz.alpha,
            };
        }

        pub fn intoProPhoto(_xyz: *const XYZd50) ProPhoto {
            // convert XYZ to linear-light prophoto-rgb
            const MATRIX: [9]f32 = .{
                1.3457989731028281,
                -0.25558010007997534,
                -0.05110628506753401,
                -0.5446224939028347,
                1.5082327413132781,
                0.02053603239147973,
                0.0,
                0.0,
                1.2119675456389454,
            };
            const H = struct {
                pub fn gamProPhotoComponent(c: f32) f32 {
                    // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L137
                    // convert linear-light prophoto-rgb  in the range 0.0-1.0
                    // to gamma corrected form
                    // Transfer curve is gamma 1.8 with a small linear portion
                    // TODO for negative values, extend linear portion on reflection of axis, then add pow below that
                    const ET: f32 = 1.0 / 512.0;
                    const abs = @abs(c);
                    if (abs >= ET) {
                        const sign: f32 = if (c < 0.0) -1.0 else 1.0;
                        return sign * bun.powf(abs, 1.0 / 1.8);
                    }
                    return 16.0 * c;
                }
            };
            const xyz = _xyz.resolveMissing();
            const r1, const g1, const b1 = multiplyMatrix(&MATRIX, xyz.x, xyz.y, xyz.z);
            const r = H.gamProPhotoComponent(r1);
            const g = H.gamProPhotoComponent(g1);
            const b = H.gamProPhotoComponent(b1);
            return ProPhoto{
                .r = r,
                .g = g,
                .b = b,
                .alpha = xyz.alpha,
            };
        }
    };

    pub const convert_XYZd65 = struct {
        pub fn intoPredefinedColor(rgb: *const XYZd65) PredefinedColor {
            return PredefinedColor{ .xyz_d65 = rgb.* };
        }

        pub fn intoCssColor(rgb: *const XYZd65, allocator: Allocator) CssColor {
            return CssColor{
                .predefined = bun.create(
                    allocator,
                    PredefinedColor,
                    rgb.into(.PredefinedColor),
                ),
            };
        }

        pub fn intoXYZd50(_xyz: *const XYZd65) XYZd50 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L319

            const MATRIX: [9]f32 = .{
                1.0479298208405488,
                0.022946793341019088,
                -0.05019222954313557,
                0.029627815688159344,
                0.990434484573249,
                -0.01707382502938514,
                -0.009243058152591178,
                0.015055144896577895,
                0.7518742899580008,
            };

            const xyz = _xyz.resolveMissing();
            const x, const y, const z = multiplyMatrix(&MATRIX, xyz.x, xyz.y, xyz.z);
            return XYZd50{
                .x = x,
                .y = y,
                .z = z,
                .alpha = xyz.alpha,
            };
        }

        pub fn intoSRGBLinear(_xyz: *const XYZd65) SRGBLinear {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L62
            const MATRIX: [9]f32 = .{
                3.2409699419045226,
                -1.537383177570094,
                -0.4986107602930034,
                -0.9692436362808796,
                1.8759675015077202,
                0.04155505740717559,
                0.05563007969699366,
                -0.20397695888897652,
                1.0569715142428786,
            };

            const xyz = _xyz.resolveMissing();
            const r, const g, const b = multiplyMatrix(&MATRIX, xyz.x, xyz.y, xyz.z);
            return SRGBLinear{
                .r = r,
                .g = g,
                .b = b,
                .alpha = xyz.alpha,
            };
        }

        pub fn intoA98(_xyz: *const XYZd65) A98 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L222
            // convert XYZ to linear-light a98-rgb

            const MATRIX: [9]f32 = .{
                2.0415879038107465,
                -0.5650069742788596,
                -0.34473135077832956,
                -0.9692436362808795,
                1.8759675015077202,
                0.04155505740717557,
                0.013444280632031142,
                -0.11836239223101838,
                1.0151749943912054,
            };

            const H = struct {
                pub fn gamA98Component(c: f32) f32 {
                    // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L193
                    // convert linear-light a98-rgb  in the range 0.0-1.0
                    // to gamma corrected form
                    // negative values are also now accepted
                    const sign: f32 = if (c < 0.0) -1.0 else 1.0;
                    return sign * bun.powf(@abs(c), 256.0 / 563.0);
                }
            };

            const xyz = _xyz.resolveMissing();
            const r1, const g1, const b1 = multiplyMatrix(&MATRIX, xyz.x, xyz.y, xyz.z);
            const r = H.gamA98Component(r1);
            const g = H.gamA98Component(g1);
            const b = H.gamA98Component(b1);
            return A98{
                .r = r,
                .g = g,
                .b = b,
                .alpha = xyz.alpha,
            };
        }

        pub fn intoRec2020(_xyz: *const XYZd65) Rec2020 {
            // convert XYZ to linear-light rec2020
            const MATRIX: [9]f32 = .{
                1.7166511879712674,
                -0.35567078377639233,
                -0.25336628137365974,
                -0.6666843518324892,
                1.6164812366349395,
                0.01576854581391113,
                0.017639857445310783,
                -0.042770613257808524,
                0.9421031212354738,
            };

            const H = struct {
                pub fn gamRec2020Component(c: f32) f32 {
                    // convert linear-light rec2020 RGB  in the range 0.0-1.0
                    // to gamma corrected form
                    // ITU-R BT.2020-2 p.4

                    const A: f32 = 1.09929682680944;
                    const B: f32 = 0.018053968510807;

                    const abs = @abs(c);
                    if (abs > B) {
                        const sign: f32 = if (c < 0.0) -1.0 else 1.0;
                        return sign * (A * bun.powf(abs, 0.45) - (A - 1.0));
                    }

                    return 4.5 * c;
                }
            };

            const xyz = _xyz.resolveMissing();
            const r1, const g1, const b1 = multiplyMatrix(&MATRIX, xyz.x, xyz.y, xyz.z);
            const r = H.gamRec2020Component(r1);
            const g = H.gamRec2020Component(g1);
            const b = H.gamRec2020Component(b1);
            return Rec2020{
                .r = r,
                .g = g,
                .b = b,
                .alpha = xyz.alpha,
            };
        }

        pub fn intoOKLAB(_xyz: *const XYZd65) OKLAB {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L400
            const XYZ_TO_LMS: [9]f32 = .{
                0.8190224432164319,
                0.3619062562801221,
                -0.12887378261216414,
                0.0329836671980271,
                0.9292868468965546,
                0.03614466816999844,
                0.048177199566046255,
                0.26423952494422764,
                0.6335478258136937,
            };

            const LMS_TO_OKLAB: [9]f32 = .{
                0.2104542553,
                0.7936177850,
                -0.0040720468,
                1.9779984951,
                -2.4285922050,
                0.4505937099,
                0.0259040371,
                0.7827717662,
                -0.8086757660,
            };

            const cbrt = std.math.cbrt;

            const xyz = _xyz.resolveMissing();
            const a1, const b1, const c1 = multiplyMatrix(&XYZ_TO_LMS, xyz.x, xyz.y, xyz.z);
            const l, const a, const b = multiplyMatrix(&LMS_TO_OKLAB, cbrt(a1), cbrt(b1), cbrt(c1));

            return OKLAB{
                .l = l,
                .a = a,
                .b = b,
                .alpha = xyz.alpha,
            };
        }

        pub fn intoP3(_xyz: *const XYZd65) P3 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L105
            const MATRIX: [9]f32 = .{
                2.493496911941425,
                -0.9313836179191239,
                -0.40271078445071684,
                -0.8294889695615747,
                1.7626640603183463,
                0.023624685841943577,
                0.03584583024378447,
                -0.07617238926804182,
                0.9568845240076872,
            };

            const xyz = _xyz.resolveMissing();
            const r1, const g1, const b1 = multiplyMatrix(&MATRIX, xyz.x, xyz.y, xyz.z);
            const r, const g, const b = gamSrgb(r1, g1, b1); // same as sRGB
            return P3{
                .r = r,
                .g = g,
                .b = b,
                .alpha = xyz.alpha,
            };
        }
    };

    pub const convert_LCH = struct {
        pub fn intoCssColor(c: *const LCH, allocator: Allocator) CssColor {
            return CssColor{ .lab = bun.create(
                allocator,
                LABColor,
                LABColor{ .lch = c.* },
            ) };
        }

        pub fn intoLAB(_lch: *const LCH) LAB {
            const lch = _lch.resolveMissing();
            const l, const a, const b = polarToRectangular(lch.l, lch.c, lch.h);
            return LAB{
                .l = l,
                .a = a,
                .b = b,
                .alpha = lch.alpha,
            };
        }
    };

    pub const convert_OKLAB = struct {
        pub fn intoCssColor(c: *const OKLAB, allocator: Allocator) CssColor {
            return CssColor{ .lab = bun.create(
                allocator,
                LABColor,
                LABColor{ .oklab = c.* },
            ) };
        }

        pub fn intoOKLAB(labb: *const OKLAB) OKLAB {
            return labb.*;
        }

        pub fn intoOKLCH(labb: *const OKLAB) OKLCH {
            const lab = labb.resolveMissing();
            const l, const c, const h = rectangularToPolar(lab.l, lab.a, lab.b);
            return OKLCH{
                .l = l,
                .c = c,
                .h = h,
                .alpha = lab.alpha,
            };
        }

        pub fn intoXYZd65(_lab: *const OKLAB) XYZd65 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L418
            const LMS_TO_XYZ: [9]f32 = .{
                1.2268798733741557,
                -0.5578149965554813,
                0.28139105017721583,
                -0.04057576262431372,
                1.1122868293970594,
                -0.07171106666151701,
                -0.07637294974672142,
                -0.4214933239627914,
                1.5869240244272418,
            };

            const OKLAB_TO_LMS: [9]f32 = .{
                0.99999999845051981432,
                0.39633779217376785678,
                0.21580375806075880339,
                1.0000000088817607767,
                -0.1055613423236563494,
                -0.063854174771705903402,
                1.0000000546724109177,
                -0.089484182094965759684,
                -1.2914855378640917399,
            };

            const lab = _lab.resolveMissing();
            const a, const b, const c = multiplyMatrix(&OKLAB_TO_LMS, lab.l, lab.a, lab.b);
            const x, const y, const z = multiplyMatrix(
                &LMS_TO_XYZ,
                bun.powf(a, 3),
                bun.powf(b, 3),
                bun.powf(c, 3),
            );

            return XYZd65{
                .x = x,
                .y = y,
                .z = z,
                .alpha = lab.alpha,
            };
        }
    };

    pub const convert_OKLCH = struct {
        pub fn intoCssColor(c: *const OKLCH, allocator: Allocator) CssColor {
            return CssColor{ .lab = bun.create(
                allocator,
                LABColor,
                LABColor{ .oklch = c.* },
            ) };
        }

        pub fn intoOKLAB(_lch: *const OKLCH) OKLAB {
            const lch = _lch.resolveMissing();
            const l, const a, const b = polarToRectangular(lch.l, lch.c, lch.h);
            return OKLAB{
                .l = l,
                .a = a,
                .b = b,
                .alpha = lch.alpha,
            };
        }

        pub fn intoOKLCH(x: *const OKLCH) OKLCH {
            return x.*;
        }
    };
};

pub const ConvertTo = enum {
    RGBA,
    LAB,
    SRGB,
    HSL,
    HWB,
    SRGBLinear,
    P3,
    A98,
    ProPhoto,
    Rec2020,
    XYZd50,
    XYZd65,
    LCH,
    OKLAB,
    OKLCH,
    PredefinedColor,
    pub fn fromType(comptime T: type) ConvertTo {
        return @field(ConvertTo, bun.meta.typeName(T));
    }
    pub fn Type(comptime space: ConvertTo) type {
        return switch (space) {
            .RGBA => RGBA,
            .LAB => LAB,
            .SRGB => SRGB,
            .HSL => HSL,
            .HWB => HWB,
            .SRGBLinear => SRGBLinear,
            .P3 => P3,
            .A98 => A98,
            .ProPhoto => ProPhoto,
            .Rec2020 => Rec2020,
            .XYZd50 => XYZd50,
            .XYZd65 => XYZd65,
            .LCH => LCH,
            .OKLAB => OKLAB,
            .OKLCH => OKLCH,
            .PredefinedColor => PredefinedColor,
        };
    }
};
pub fn ColorIntoMixin(T: type, space: ConvertTo) type {
    return struct {
        pub const into_names = struct {
            const RGBA = "intoRGBA";
            const LAB = "intoLAB";
            const SRGB = "intoSRGB";
            const HSL = "intoHSL";
            const HWB = "intoHWB";
            const SRGBLinear = "intoSRGBLinear";
            const P3 = "intoP3";
            const A98 = "intoA98";
            const ProPhoto = "intoProPhoto";
            const Rec2020 = "intoRec2020";
            const XYZd50 = "intoXYZd50";
            const XYZd65 = "intoXYZd65";
            const LCH = "intoLCH";
            const OKLAB = "intoOKLAB";
            const OKLCH = "intoOKLCH";
            const PredefinedColor = "intoPredefinedColor";
        };
        const ns = "convert_" ++ @tagName(space);

        const handwritten_conversions = @field(color_conversions, ns);
        const generated_conversions = @field(generated_color_conversions, ns);

        pub fn into(color: *const T, comptime target_space: ConvertTo) target_space.Type() {
            if (target_space == space) return color.*;

            const name = @field(into_names, @tagName(target_space));

            const function = if (@hasDecl(handwritten_conversions, name))
                @field(handwritten_conversions, name)
            else if (@hasDecl(generated_conversions, name))
                @field(generated_conversions, name)
            else if (@hasDecl(T, name))
                @field(T, name)
            else
                @compileError("No conversion from " ++ @tagName(space) ++ " to " ++ @tagName(target_space));

            return function(color);
        }
    };
}

pub fn ImplementIntoCssColor(comptime T: type, space: ConvertTo) fn (*const T, Allocator) CssColor {
    const ns = "convert_" ++ @tagName(space);
    return @field(color_conversions, ns).intoCssColor;
}
