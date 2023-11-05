const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CallFrame = JSC.CallFrame;
const Timer = JSC.BunTimer;
const ZigString = JSC.ZigString;

// for now cInclude, later add a SDL wrapper
const c = @cImport({
    @cInclude("SDL.h");
});

var initializeSDL = std.once(struct {
    pub fn call() void {
        _ = c.SDL_Init(c.SDL_INIT_VIDEO);
    }
}.call);

pub const CSS = struct {
    pub const UnitType = enum(u8) {
        unknown,
        number,
        integer,
        percentage,
        em,
        ex,
        px,
        cm,
        mm,
        in,
        pt,
        pc,
        deg,
        rad,
        grad,
        ms,
        s,
        hz,
        khz,
        dimension,
        string,
        uri,
        ident,
        attr,
        rgbcolor,

        vw,
        vh,
        vmin,
        vmax,
        vb,
        vi,
        svw,
        svh,
        svmin,
        svmax,
        svb,
        svi,
        lvw,
        lvh,
        lvmin,
        lvmax,
        lvb,
        lvi,
        dvw,
        dvh,
        dvmin,
        dvmax,
        dvb,
        dvi,

        // first_viewport_unit_type = UnitType.vw,
        // last_viewport_unit_type = UnitType.dvi,

        cqw,
        cqh,
        cqi,
        cqb,
        cqmin,
        cqmax,

        dppx,
        x,
        dpi,
        dpcm,
        fr,
        q,
        lh,
        rlh,

        custom_ident,

        turn,
        rem,
        rex,
        cap,
        rcap,
        ch,
        rch,
        ic,
        ric,

        counter_name,

        calc,
        calc_percentage_with_number,
        calc_percentage_with_length,

        font_family,

        unresolved_color,

        property_id,
        value_id,

        // This value is used to handle quirky margins in reflow roots (body, td, and th) like WinIE.
        // The basic idea is that a stylesheet can use the value __qem (for quirky em) instead of em.
        // When the quirky value is used, if you're in quirks mode, the margin will collapse away
        // inside a table cell. This quirk is specified in the HTML spec but our impl is different.
        quirky_em,

        // Note that CSSValue allocates 7 bits for m_primitiveUnitType, so there can be no value here > 127.
    };

    pub fn ParserFastPaths(comptime T: type) type {
        const CharType = T;
        const StrType = []const T;

        return struct {
            pub fn parseHexColor(hex: StrType) ?Color {
                if (hex.len != 3 and hex.len != 4 and hex.len != 6 and hex.len != 8) return null;
                var value: u32 = 0;
                for (hex) |digit| {
                    if (!strings.isASCIIHexDigit(CharType, digit)) return null;
                    const hex_value = strings.toASCIIHexValue(CharType, digit);
                    value <<= 4;
                    value |= hex_value;

                    // #abc -> #aabbcc
                    // #abcd -> #ddaabbcc
                    if (hex.len == 3 or hex.len == 4) {
                        value <<= 4;
                        value |= hex_value;
                    }
                }

                return switch (hex.len) {
                    3, 6 => Color.argb(value | 0xff000000),
                    4, 8 => Color.rgba(value),
                    else => unreachable,
                };
            }

            pub fn parseNumericColor(str: StrType) ?Color {
                if (str.len >= 4 and str[0] == '#') {
                    if (parseHexColor(str[1..])) |color| {
                        return color;
                    }
                }

                // assume strict == true, no-quirks mode

                // if (!strict and (str.len == 3 or str.len == 6)) {
                //     if (parseHexColor(str)) |color| {
                //         return color;
                //     }
                // }

                var expect = UnitType.unknown;

                if (mightBeRGBA(str)) {
                    var remain = str[5..];
                    const red = parseColorIntOrPercentage(&remain, ',', &expect) orelse return null;
                    const green = parseColorIntOrPercentage(&remain, ',', &expect) orelse return null;
                    const blue = parseColorIntOrPercentage(&remain, ',', &expect) orelse return null;
                    const alpha = parseAlphaValue(&remain, ')') orelse return null;
                    if (remain.len != 0) {
                        return null;
                    }

                    return Color.fromRGBA(red, green, blue, alpha);
                }

                if (mightBeRGB(str)) {
                    var remain = str[4..];
                    const red = parseColorIntOrPercentage(&remain, ',', &expect) orelse return null;
                    const green = parseColorIntOrPercentage(&remain, ',', &expect) orelse return null;
                    const blue = parseColorIntOrPercentage(&remain, ')', &expect) orelse return null;
                    if (remain.len != 0) {
                        return null;
                    }

                    return Color.fromRGBA(red, green, blue, 255);
                }

                return null;
            }

            fn parseColorIntOrPercentage(_remain: *StrType, terminator: u8, expect: *UnitType) ?u8 {
                var remain = _remain.*;

                var local_value: f64 = 0;
                var negative = false;
                while (remain.len != 0 and strings.isASCIIWhitespace(CharType, remain[0])) {
                    remain = remain[1..];
                }

                if (remain.len != 0 and remain[0] == '-') {
                    negative = true;
                    remain = remain[1..];
                }

                if (remain.len == 0 or !strings.isASCIIDigit(CharType, remain[0])) {
                    return null;
                }

                while (remain.len != 0 and strings.isASCIIDigit(CharType, remain[0])) {
                    const new_value: f64 = local_value * @as(f64, 10) + @as(f64, @floatFromInt(remain[0] - '0'));
                    remain = remain[1..];
                    if (new_value >= @as(f64, 255)) {
                        // Clamp values at 255.
                        local_value = 255;
                        while (remain.len != 0 and strings.isASCIIDigit(CharType, remain[0])) {
                            remain = remain[1..];
                        }
                        break;
                    }

                    local_value = new_value;
                }

                if (remain.len == 0) {
                    return null;
                }

                if (expect.* == .number and (remain[0] == '.' or remain[0] == '%')) {
                    return null;
                }

                if (remain[0] == '.') {
                    // We already parsed the integral part, try to parse
                    // the fraction part of the percentage value.
                    var percentage: f64 = 0;
                    const num_characters_parsed = parseDouble(remain, '%', &percentage);
                    if (num_characters_parsed == 0) {
                        return null;
                    }
                    remain = remain[num_characters_parsed..];
                    if (remain[0] != '%') {
                        return null;
                    }
                    local_value += percentage;
                }

                if (expect.* == .percentage and remain[0] != '%') {
                    return null;
                }

                if (remain[0] == '%') {
                    expect.* = .percentage;
                    local_value = local_value / 100 * 255;
                    if (local_value > 255) {
                        local_value = 255;
                    }
                    remain = remain[1..];
                } else {
                    expect.* = .number;
                }

                while (remain.len != 0 and strings.isASCIIWhitespace(CharType, remain[0])) {
                    remain = remain[1..];
                }

                if (remain.len == 0) {
                    return null;
                } else {
                    if (remain[0] != terminator) {
                        return null;
                    }
                    remain = remain[1..];
                }

                _remain.* = remain;

                if (comptime Environment.allow_assert) {
                    std.debug.assert(local_value <= 255);
                }

                // convertPrescaledSRGBAFloatToSRGBAByte(local_value)
                return if (negative) 0 else std.math.clamp(@as(u8, @intFromFloat(@round(local_value))), 0, 255);
            }

            fn parseAlphaValue(_remain: *StrType, terminator: u8) ?u8 {
                var remain = _remain.*;
                defer _remain.* = remain;

                while (remain.len != 0 and strings.isASCIIWhitespace(CharType, remain[0])) {
                    remain = remain[1..];
                }

                var negative = false;

                if (remain.len != 0 and remain[0] == '-') {
                    negative = true;
                    remain = remain[1..];
                }

                if (remain.len < 2) {
                    return null;
                }

                if (remain[remain.len - 1] != terminator or !strings.isASCIIDigit(CharType, remain[remain.len - 2])) {
                    return null;
                }

                if (remain[0] != '0' and remain[0] != '1' and remain[0] != '.') {
                    if (checkForValidDouble(remain, terminator) != 0) {
                        remain = remain[remain.len..];
                        return if (negative) 0 else 255;
                    }

                    return null;
                }

                if (remain.len == 2 and remain[0] != '.') {
                    const result: u8 = if (!negative and remain[0] == '1') 255 else 0;
                    remain = remain[remain.len..];
                    return result;
                }

                if (isTenthAlpha(remain[1..])) {
                    const tenth_alpha_values = &[_]u8{ 0, 26, 51, 77, 102, 128, 153, 179, 204, 230 };
                    const result: u8 = if (negative) 0 else tenth_alpha_values[remain[remain.len - 2] - '0'];
                    remain = remain[remain.len..];
                    return result;
                }

                var alpha: f64 = 0;
                if (parseDouble(remain, terminator, &alpha) == 0) {
                    return null;
                }

                remain = remain[remain.len..];

                // convertFloatToAlpha<u8>(alpha)
                return if (negative) 0 else std.math.clamp(@as(u8, @intFromFloat(@round(alpha * 255))), 0, 255);
            }

            fn isTenthAlpha(str: StrType) bool {
                // "X.X"
                if (str.len == 3 and str[0] == '0' and str[1] == '.' and strings.isASCIIDigit(CharType, str[2])) {
                    return true;
                }

                // ".X"
                if (str.len == 2 and str[0] == '.' and strings.isASCIIDigit(CharType, str[1])) {
                    return true;
                }

                return false;
            }

            fn parseDouble(str: StrType, terminator: u8, value: *f64) usize {
                const length = checkForValidDouble(str, terminator);
                if (length == 0) {
                    return 0;
                }

                var position: usize = 0;
                var local_value: f64 = 0;

                // The consumed characters here are guaranteed to be
                // ASCII digits with or without a decimal mark
                while (position < length) : (position += 1) {
                    if (str[position] == '.') {
                        break;
                    }

                    local_value = local_value * @as(f64, 10) + @as(f64, @floatFromInt(str[position] - '0'));
                }

                position += 1;
                if (position == length) {
                    value.* = local_value;
                    return length;
                }

                var fraction: f64 = 0;
                var scale: f64 = 1;

                var max_scale: f64 = 1_000_000;
                while (position < length and scale < max_scale) {
                    fraction = fraction * @as(f64, 10) + @as(f64, @floatFromInt(str[position] - '0'));
                    position += 1;
                    scale *= 10;
                }

                value.* = local_value + fraction / scale;
                return length;
            }

            fn checkForValidDouble(str: StrType, terminator: u8) usize {
                if (str.len < 1) {
                    return 0;
                }

                var decimal_mark_seen = false;
                var processed_length: usize = 0;

                for (str, 0..) |digit, i| {
                    if (digit == terminator) {
                        processed_length = i;
                        break;
                    }

                    if (!strings.isASCIIDigit(CharType, digit)) {
                        if (!decimal_mark_seen and digit == '.') {
                            decimal_mark_seen = true;
                        } else {
                            return 0;
                        }
                    }
                }

                if (decimal_mark_seen and processed_length == 1) {
                    return 0;
                }

                return processed_length;
            }

            fn mightBeRGBA(str: StrType) bool {
                if (str.len < 5) return false;
                return str[4] == '(' and
                    strings.isASCIIAlphaCaselessEqual(CharType, str[0], 'r') and
                    strings.isASCIIAlphaCaselessEqual(CharType, str[1], 'g') and
                    strings.isASCIIAlphaCaselessEqual(CharType, str[2], 'b') and
                    strings.isASCIIAlphaCaselessEqual(CharType, str[3], 'a');
            }

            fn mightBeRGB(str: StrType) bool {
                if (str.len < 4) return false;
                return str[3] == '(' and
                    strings.isASCIIAlphaCaselessEqual(CharType, str[0], 'r') and
                    strings.isASCIIAlphaCaselessEqual(CharType, str[1], 'g') and
                    strings.isASCIIAlphaCaselessEqual(CharType, str[2], 'b');
            }

            pub fn parseSimpleColor(str: StrType) ?Color {
                if (parseNumericColor(str)) |color| {
                    return color;
                }

                return null;
            }
        };
    }
};

const Color = union(enum) {
    rgba: u32,
    argb: u32,

    pub fn a(this: Color) u8 {
        return switch (this) {
            .rgba => |color| @truncate(color),
            .argb => |color| @truncate(color >> 24),
        };
    }

    pub fn r(this: Color) u8 {
        return switch (this) {
            .rgba => |color| @truncate(color >> 24),
            .argb => |color| @truncate(color >> 16),
        };
    }

    pub fn g(this: Color) u8 {
        return switch (this) {
            .rgba => |color| @truncate(color >> 16),
            .argb => |color| @truncate(color >> 8),
        };
    }

    pub fn b(this: Color) u8 {
        return switch (this) {
            .rgba => |color| @truncate(color >> 8),
            .argb => |color| @truncate(color),
        };
    }

    pub fn get(this: Color) u32 {
        return switch (this) {
            inline else => |color| color,
        };
    }

    pub fn rgba(color: u32) Color {
        return .{ .rgba = color };
    }

    pub fn argb(color: u32) Color {
        return .{ .argb = color };
    }

    pub fn fromRGBA(red: u8, green: u8, blue: u8, alpha: u8) Color {
        var value: u32 = 0;
        value <<= 4;
        value |= red;
        value <<= 4;
        value |= blue;
        value <<= 4;
        value |= green;
        value <<= 4;
        value |= alpha;
        return rgba(value);
    }

    pub fn fromJS(value: JSValue, global: *JSGlobalObject) ?Color {
        if (bun.String.tryFromJS(value, global)) |str| {
            if (str.inMapCaseInsensitive(Names)) |color| {
                return color;
            }

            if (str.is8Bit()) {
                return CSS.ParserFastPaths(u8).parseSimpleColor(str.byteSlice());
            }

            return CSS.ParserFastPaths(u16).parseSimpleColor(str.utf16());
        }

        return null;
    }

    pub const Names = bun.ComptimeStringMap(Color, .{
        .{ "aliceblue", argb(0xfff0f8ff) },
        .{ "alpha", argb(0x00000000) },
        .{ "antiquewhite", argb(0xfffaebd7) },
        .{ "aqua", argb(0xff00ffff) },
        .{ "aquamarine", argb(0xff7fffd4) },
        .{ "azure", argb(0xfff0ffff) },
        .{ "beige", argb(0xfff5f5dc) },
        .{ "bisque", argb(0xffffe4c4) },
        .{ "black", argb(0xff000000) },
        .{ "blanchedalmond", argb(0xffffebcd) },
        .{ "blue", argb(0xff0000ff) },
        .{ "blueviolet", argb(0xff8a2be2) },
        .{ "brown", argb(0xffa52a2a) },
        .{ "burlywood", argb(0xffdeb887) },
        .{ "cadetblue", argb(0xff5f9ea0) },
        .{ "chartreuse", argb(0xff7fff00) },
        .{ "chocolate", argb(0xffd2691e) },
        .{ "coral", argb(0xffff7f50) },
        .{ "cornflowerblue", argb(0xff6495ed) },
        .{ "cornsilk", argb(0xfffff8dc) },
        .{ "crimson", argb(0xffdc143c) },
        .{ "cyan", argb(0xff00ffff) },
        .{ "darkblue", argb(0xff00008b) },
        .{ "darkcyan", argb(0xff008b8b) },
        .{ "darkgoldenrod", argb(0xffb8860b) },
        .{ "darkgray", argb(0xffa9a9a9) },
        .{ "darkgrey", argb(0xffa9a9a9) },
        .{ "darkgreen", argb(0xff006400) },
        .{ "darkkhaki", argb(0xffbdb76b) },
        .{ "darkmagenta", argb(0xff8b008b) },
        .{ "darkolivegreen", argb(0xff556b2f) },
        .{ "darkorange", argb(0xffff8c00) },
        .{ "darkorchid", argb(0xff9932cc) },
        .{ "darkred", argb(0xff8b0000) },
        .{ "darksalmon", argb(0xffe9967a) },
        .{ "darkseagreen", argb(0xff8fbc8f) },
        .{ "darkslateblue", argb(0xff483d8b) },
        .{ "darkslategray", argb(0xff2f4f4f) },
        .{ "darkslategrey", argb(0xff2f4f4f) },
        .{ "darkturquoise", argb(0xff00ced1) },
        .{ "darkviolet", argb(0xff9400d3) },
        .{ "deeppink", argb(0xffff1493) },
        .{ "deepskyblue", argb(0xff00bfff) },
        .{ "dimgray", argb(0xff696969) },
        .{ "dimgrey", argb(0xff696969) },
        .{ "dodgerblue", argb(0xff1e90ff) },
        .{ "firebrick", argb(0xffb22222) },
        .{ "floralwhite", argb(0xfffffaf0) },
        .{ "forestgreen", argb(0xff228b22) },
        .{ "fuchsia", argb(0xffff00ff) },
        .{ "gainsboro", argb(0xffdcdcdc) },
        .{ "ghostwhite", argb(0xfff8f8ff) },
        .{ "gold", argb(0xffffd700) },
        .{ "goldenrod", argb(0xffdaa520) },
        .{ "gray", argb(0xff808080) },
        .{ "grey", argb(0xff808080) },
        .{ "green", argb(0xff008000) },
        .{ "greenyellow", argb(0xffadff2f) },
        .{ "honeydew", argb(0xfff0fff0) },
        .{ "hotpink", argb(0xffff69b4) },
        .{ "indianred", argb(0xffcd5c5c) },
        .{ "indigo", argb(0xff4b0082) },
        .{ "ivory", argb(0xfffffff0) },
        .{ "khaki", argb(0xfff0e68c) },
        .{ "lavender", argb(0xffe6e6fa) },
        .{ "lavenderblush", argb(0xfffff0f5) },
        .{ "lawngreen", argb(0xff7cfc00) },
        .{ "lemonchiffon", argb(0xfffffacd) },
        .{ "lightblue", argb(0xffadd8e6) },
        .{ "lightcoral", argb(0xfff08080) },
        .{ "lightcyan", argb(0xffe0ffff) },
        .{ "lightgoldenrodyellow", argb(0xfffafad2) },
        .{ "lightgray", argb(0xffd3d3d3) },
        .{ "lightgrey", argb(0xffd3d3d3) },
        .{ "lightgreen", argb(0xff90ee90) },
        .{ "lightpink", argb(0xffffb6c1) },
        .{ "lightsalmon", argb(0xffffa07a) },
        .{ "lightseagreen", argb(0xff20b2aa) },
        .{ "lightskyblue", argb(0xff87cefa) },
        .{ "lightslateblue", argb(0xff8470ff) },
        .{ "lightslategray", argb(0xff778899) },
        .{ "lightslategrey", argb(0xff778899) },
        .{ "lightsteelblue", argb(0xffb0c4de) },
        .{ "lightyellow", argb(0xffffffe0) },
        .{ "lime", argb(0xff00ff00) },
        .{ "limegreen", argb(0xff32cd32) },
        .{ "linen", argb(0xfffaf0e6) },
        .{ "magenta", argb(0xffff00ff) },
        .{ "maroon", argb(0xff800000) },
        .{ "mediumaquamarine", argb(0xff66cdaa) },
        .{ "mediumblue", argb(0xff0000cd) },
        .{ "mediumorchid", argb(0xffba55d3) },
        .{ "mediumpurple", argb(0xff9370db) },
        .{ "mediumseagreen", argb(0xff3cb371) },
        .{ "mediumslateblue", argb(0xff7b68ee) },
        .{ "mediumspringgreen", argb(0xff00fa9a) },
        .{ "mediumturquoise", argb(0xff48d1cc) },
        .{ "mediumvioletred", argb(0xffc71585) },
        .{ "midnightblue", argb(0xff191970) },
        .{ "mintcream", argb(0xfff5fffa) },
        .{ "mistyrose", argb(0xffffe4e1) },
        .{ "moccasin", argb(0xffffe4b5) },
        .{ "navajowhite", argb(0xffffdead) },
        .{ "navy", argb(0xff000080) },
        .{ "oldlace", argb(0xfffdf5e6) },
        .{ "olive", argb(0xff808000) },
        .{ "olivedrab", argb(0xff6b8e23) },
        .{ "orange", argb(0xffffa500) },
        .{ "orangered", argb(0xffff4500) },
        .{ "orchid", argb(0xffda70d6) },
        .{ "palegoldenrod", argb(0xffeee8aa) },
        .{ "palegreen", argb(0xff98fb98) },
        .{ "paleturquoise", argb(0xffafeeee) },
        .{ "palevioletred", argb(0xffdb7093) },
        .{ "papayawhip", argb(0xffffefd5) },
        .{ "peachpuff", argb(0xffffdab9) },
        .{ "peru", argb(0xffcd853f) },
        .{ "pink", argb(0xffffc0cb) },
        .{ "plum", argb(0xffdda0dd) },
        .{ "powderblue", argb(0xffb0e0e6) },
        .{ "purple", argb(0xff800080) },
        .{ "rebeccapurple", argb(0xff663399) },
        .{ "red", argb(0xffff0000) },
        .{ "rosybrown", argb(0xffbc8f8f) },
        .{ "royalblue", argb(0xff4169e1) },
        .{ "saddlebrown", argb(0xff8b4513) },
        .{ "salmon", argb(0xfffa8072) },
        .{ "sandybrown", argb(0xfff4a460) },
        .{ "seagreen", argb(0xff2e8b57) },
        .{ "seashell", argb(0xfffff5ee) },
        .{ "sienna", argb(0xffa0522d) },
        .{ "silver", argb(0xffc0c0c0) },
        .{ "skyblue", argb(0xff87ceeb) },
        .{ "slateblue", argb(0xff6a5acd) },
        .{ "slategray", argb(0xff708090) },
        .{ "slategrey", argb(0xff708090) },
        .{ "snow", argb(0xfffffafa) },
        .{ "springgreen", argb(0xff00ff7f) },
        .{ "steelblue", argb(0xff4682b4) },
        .{ "tan", argb(0xffd2b48c) },
        .{ "teal", argb(0xff008080) },
        .{ "thistle", argb(0xffd8bfd8) },
        .{ "tomato", argb(0xffff6347) },
        .{ "transparent", argb(0x00000000) },
        .{ "turquoise", argb(0xff40e0d0) },
        .{ "violet", argb(0xffee82ee) },
        .{ "violetred", argb(0xffd02090) },
        .{ "wheat", argb(0xfff5deb3) },
        .{ "white", argb(0xffffffff) },
        .{ "whitesmoke", argb(0xfff5f5f5) },
        .{ "yellow", argb(0xffffff00) },
        .{ "yellowgreen", argb(0xff9acd32) },
    });
};

pub const Canvas = struct {
    const log = Output.scoped(.Canvas, false);
    pub usingnamespace JSC.Codegen.JSCanvas;

    running: bool = true,
    width: i32 = 640,
    width_value: JSValue = .zero,
    height: i32 = 480,
    height_value: JSValue = .zero,
    x: i32 = c.SDL_WINDOWPOS_UNDEFINED,
    x_value: JSValue = .zero,
    y: i32 = c.SDL_WINDOWPOS_UNDEFINED,
    y_value: JSValue = .zero,

    timer_id: ?JSValue = null,
    _animate_callback_wrapper_value: ?JSValue = null,

    previous_time: f64 = 0.0,

    window: *c.SDL_Window = undefined,
    renderer: *c.SDL_Renderer = undefined,

    pub fn constructor(global: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) ?*Canvas {
        log("Canvas.constructor", .{});

        const args = callFrame.arguments(5).slice();

        var canvas = Canvas{};

        switch (args.len) {
            0, 1 => {},
            else => brk: {
                if (args[1].isInt32()) {
                    canvas.width = args[1].asInt32();
                } else {
                    global.throw("Canvas constructor expects width to be a number", .{});
                    return null;
                }

                if (args.len == 2) break :brk;

                if (args[2].isInt32()) {
                    canvas.height = args[2].asInt32();
                } else {
                    global.throw("Canvas constructor expects height to be a number", .{});
                    return null;
                }

                if (args.len == 3) break :brk;

                if (args[3].isInt32()) {
                    canvas.x = args[3].asInt32();
                } else {
                    global.throw("Canvas constructor expects x to be a number", .{});
                    return null;
                }

                if (args.len == 4) break :brk;

                if (args[4].isInt32()) {
                    canvas.y = args[4].asInt32();
                } else {
                    global.throw("Canvas constructor expects y to be a number", .{});
                    return null;
                }
            },
        }

        initializeSDL.call();

        if (c.SDL_CreateWindow(
            "bun bun bun",
            canvas.x,
            canvas.y,
            canvas.width,
            canvas.height,
            c.SDL_WINDOW_SHOWN,
        )) |window| {
            canvas.window = window;
        } else {
            global.throw("Failed to create window", .{});
            return null;
        }

        if (canvas.x == c.SDL_WINDOWPOS_UNDEFINED or canvas.y == c.SDL_WINDOWPOS_UNDEFINED) {
            c.SDL_GetWindowPosition(canvas.window, &canvas.x, &canvas.y);
        }

        canvas.width_value = JSValue.jsNumber(canvas.width);
        canvas.height_value = JSValue.jsNumber(canvas.height);
        canvas.x_value = JSValue.jsNumber(canvas.x);
        canvas.y_value = JSValue.jsNumber(canvas.y);

        var _canvas = bun.default_allocator.create(Canvas) catch unreachable;
        _canvas.* = canvas;

        return _canvas;
    }

    fn animateCallbackWrapper(global: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(2).slice();
        const canvas = Canvas.fromJS(args[0]) orelse {
            global.throw("Failed to get canvas from value", .{});
            return .undefined;
        };
        const callback = args[1];

        var event: c.SDL_Event = undefined;
        while (c.SDL_PollEvent(&event) != 0) {
            switch (event.type) {
                c.SDL_QUIT => canvas.running = false,
                c.SDL_KEYDOWN => {
                    // for debugging
                    if (event.key.keysym.sym == c.SDLK_ESCAPE) {
                        canvas.running = false;
                    }
                },
                else => {},
            }
        }

        const current_time: f64 = @floatFromInt(global.bunVM().origin_timer.read());
        const delta = (current_time - canvas.previous_time) / @as(f64, 1000000000.0);
        canvas.previous_time = current_time;

        const res = callback.call(global, &[_]JSValue{JSValue.jsNumber(delta)});
        if (res.isException(global.vm())) {
            const err = res.toError() orelse return .zero;
            global.throwValue(err);
            return .zero;
        }

        // queue up the next animation frame callback if needed
        if (canvas.running) {
            canvas.timer_id = Timer.setImmediate(
                global,
                canvas.getAnimateCallbackWrapper(global),
                JSC.JSArray.from(global, &[_]JSValue{ canvas.toJS(global), callback }),
            );
        }

        c.SDL_RenderPresent(canvas.renderer);

        return .undefined;
    }

    fn getAnimateCallbackWrapper(this: *Canvas, global: *JSGlobalObject) callconv(.C) JSValue {
        return this._animate_callback_wrapper_value orelse {
            const cb = JSC.createCallback(global, ZigString.static("animateCallbackWrapper"), 2, animateCallbackWrapper);
            this._animate_callback_wrapper_value = cb;
            return this._animate_callback_wrapper_value.?;
        };
    }

    pub fn animate(this: *Canvas, global: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        log("Canvas.animate", .{});

        const args = callFrame.arguments(1).slice();
        if (args.len == 0 or !args[0].isCallable(global.vm())) {
            global.throw("Expected first argument to be a callback", .{});
            return .zero;
        }

        const callback = args[0];

        this.previous_time = @floatFromInt(global.bunVM().origin_timer.read());

        this.timer_id = Timer.setImmediate(
            global,
            this.getAnimateCallbackWrapper(global),
            JSC.JSArray.from(global, &[_]JSValue{ this.toJS(global), callback }),
        );

        return .undefined;
    }

    pub fn close(this: *Canvas, global: *JSGlobalObject, _: *CallFrame) callconv(.C) JSValue {
        log("Canvas.close", .{});

        if (this.timer_id) |timer_id| {
            _ = Timer.clearImmediate(global, timer_id);
            this.timer_id = null;
        }
        this.running = false;

        return .undefined;
    }

    pub fn getContext(this: *Canvas, global: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        log("Canvas.getContext", .{});

        const args = callFrame.arguments(1).slice();
        if (args.len == 0) {
            global.throw("getContext expects one argument, received 0", .{});
            return .zero;
        }

        if (!args[0].isString()) {
            global.throw("getContext expected argument to be string", .{});
            return .zero;
        }

        const context_type_string = args[0].toBunString(global);

        if (!context_type_string.eqlComptime("2d")) {
            global.throw("getContext unsupported context type: {}", .{context_type_string});
            return .zero;
        }

        if (c.SDL_CreateRenderer(this.window, -1, c.SDL_RENDERER_ACCELERATED)) |renderer| {
            this.renderer = renderer;
        } else {
            global.throw("Failed to create renderer", .{});
            return .zero;
        }

        if (c.SDL_SetRenderDrawBlendMode(this.renderer, c.SDL_BLENDMODE_BLEND) < 0) {
            global.throw("Failed to set render blend mode", .{});
            return .zero;
        }

        const context = CanvasRenderingContext2D.create(this) orelse {
            global.throw("Failed to create 2d rendering context", .{});
            return .zero;
        };

        return context.toJS(global);
    }

    pub fn finalize(this: *Canvas) callconv(.C) void {
        log("Canvas.finalize", .{});
        bun.default_allocator.destroy(this);
    }

    pub fn hasPendingActivity(this: *Canvas) callconv(.C) bool {
        return this.timer_id != null and this.running;
    }

    pub fn getHeight(this: *Canvas, globalObject: *JSGlobalObject) callconv(.C) JSValue {
        _ = globalObject;

        return this.height_value;
    }

    pub fn setHeight(this: *Canvas, globalObject: *JSGlobalObject, value: JSValue) callconv(.C) bool {
        _ = globalObject;

        this.height_value = value;

        if (value.isInt32()) {
            this.height = value.asInt32();
            c.SDL_SetWindowSize(this.window, this.width, this.height);
        }

        return true;
    }

    pub fn getWidth(this: *Canvas, globalObject: *JSGlobalObject) callconv(.C) JSValue {
        _ = globalObject;

        return this.width_value;
    }

    pub fn setWidth(this: *Canvas, globalObject: *JSGlobalObject, value: JSValue) callconv(.C) bool {
        _ = globalObject;

        this.width_value = value;

        if (value.isInt32()) {
            this.width = value.asInt32();
            c.SDL_SetWindowSize(this.window, this.width, this.height);
        }

        return true;
    }

    pub fn getX(this: *Canvas, global: *JSGlobalObject) callconv(.C) JSValue {
        _ = global;

        return this.x_value;
    }

    pub fn setX(this: *Canvas, global: *JSGlobalObject, value: JSValue) callconv(.C) bool {
        _ = global;

        this.x_value = value;

        if (value.isInt32()) {
            this.x = value.toInt32();
            c.SDL_SetWindowPosition(this.window, this.x, this.y);
        }

        return true;
    }

    pub fn getY(this: *Canvas, global: *JSGlobalObject) callconv(.C) JSValue {
        _ = global;

        return this.y_value;
    }

    pub fn setY(this: *Canvas, global: *JSGlobalObject, value: JSValue) callconv(.C) bool {
        _ = global;

        this.y_value = value;

        if (value.isInt32()) {
            this.y = value.toInt32();
            c.SDL_SetWindowPosition(this.window, this.x, this.y);
        }

        return true;
    }
};

pub const CanvasRenderingContext2D = struct {
    const log = Output.scoped(.CanvasRenderingContext2D, false);
    pub usingnamespace JSC.Codegen.JSCanvasRenderingContext2D;

    canvas: *Canvas,
    renderer: *c.SDL_Renderer,

    stroke_style: JSValue = .undefined,
    cached_stroke_color: ?Color = null,
    fill_style: JSValue = .undefined,
    cached_fill_color: ?Color = null,

    const clear_color = Color.rgba(0xffffffff);
    const default_color = Color.rgba(0xaaaaaaaa);

    pub fn create(canvas: *Canvas) ?*CanvasRenderingContext2D {
        log("create", .{});

        var context = bun.default_allocator.create(CanvasRenderingContext2D) catch unreachable;
        context.* = CanvasRenderingContext2D{
            .canvas = canvas,
            .renderer = canvas.renderer,
        };

        return context;
    }

    pub fn constructor(global: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) ?*CanvasRenderingContext2D {
        _ = callFrame;
        log("constructor", .{});
        global.throw("Illegal constructor: CanvasRenderingContext2D cannot be constructed", .{});
        return null;
    }

    pub fn getStrokeStyle(this: *CanvasRenderingContext2D, global: *JSGlobalObject) callconv(.C) JSValue {
        _ = global;

        return this.stroke_style;
    }

    pub fn setStrokeStyle(this: *CanvasRenderingContext2D, global: *JSGlobalObject, value: JSValue) callconv(.C) bool {
        _ = global;
        this.stroke_style = value;
        this.cached_stroke_color = null;
        return true;
    }

    pub fn getFillStyle(this: *CanvasRenderingContext2D, global: *JSGlobalObject) callconv(.C) JSValue {
        _ = global;
        return this.fill_style;
    }

    pub fn setFillStyle(this: *CanvasRenderingContext2D, global: *JSGlobalObject, value: JSValue) callconv(.C) bool {
        _ = global;
        this.fill_style = value;
        this.cached_fill_color = null;
        return true;
    }

    pub fn getCanvas(this: *CanvasRenderingContext2D, global: *JSGlobalObject) callconv(.C) JSValue {
        return this.canvas.toJS(global);
    }

    pub fn clearRect(this: *CanvasRenderingContext2D, global: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(4).slice();
        if (args.len < 4) {
            global.throw("clearRect expects at least four arguments, received {d}", .{args.len});
            return .zero;
        }

        const rect = c.SDL_FRect{
            .x = @floatCast(args[0].asNumber()),
            .y = @floatCast(args[1].asNumber()),
            .w = @floatCast(args[2].asNumber()),
            .h = @floatCast(args[3].asNumber()),
        };

        if (c.SDL_SetRenderDrawColor(this.renderer, clear_color.r(), clear_color.g(), clear_color.b(), clear_color.a()) < 0) {
            global.throw("clearRect failed to set draw color", .{});
            return .zero;
        }

        if (c.SDL_RenderFillRectF(this.renderer, &rect) < 0) {
            global.throw("clearRect failed to fill rect", .{});
            return .zero;
        }

        return .undefined;
    }

    fn getFillColor(this: *CanvasRenderingContext2D, global: *JSGlobalObject) ?Color {
        return brk: {
            if (this.cached_fill_color) |color| break :brk color;

            if (Color.fromJS(this.fill_style, global)) |color| {
                this.cached_fill_color = color;
                break :brk color;
            }

            break :brk null;
        };
    }

    fn getStrokeColor(this: *CanvasRenderingContext2D, global: *JSGlobalObject) ?Color {
        return brk: {
            if (this.cached_stroke_color) |color| break :brk color;

            if (Color.fromJS(this.stroke_style, global)) |color| {
                this.cached_stroke_color = color;
                break :brk color;
            }

            break :brk null;
        };
    }

    pub fn fillRect(this: *CanvasRenderingContext2D, global: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(4).slice();
        if (args.len < 4) {
            global.throw("fillRect expects at least four arguments, received {d}", .{args.len});
            return .zero;
        }

        const rect = c.SDL_FRect{
            .x = @floatCast(args[0].asNumber()),
            .y = @floatCast(args[1].asNumber()),
            .w = @floatCast(args[2].asNumber()),
            .h = @floatCast(args[3].asNumber()),
        };

        const fill_color = this.getFillColor(global) orelse default_color;
        if (c.SDL_SetRenderDrawColor(this.renderer, fill_color.r(), fill_color.g(), fill_color.b(), fill_color.a()) < 0) {
            global.throw("fillRect failed to set fill color", .{});
            return .zero;
        }

        if (c.SDL_RenderFillRectF(this.renderer, &rect) < 0) {
            global.throw("fillRect failed to fill rect", .{});
            return .zero;
        }

        return .undefined;
    }

    pub fn strokeRect(this: *CanvasRenderingContext2D, global: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(4).slice();
        if (args.len < 4) {
            global.throw("strokeRect expects at least four arguments, received {d}", .{args.len});
            return .zero;
        }

        const rect = c.SDL_FRect{
            .x = @floatCast(args[0].asNumber()),
            .y = @floatCast(args[1].asNumber()),
            .w = @floatCast(args[2].asNumber()),
            .h = @floatCast(args[3].asNumber()),
        };

        const stroke_color = this.getStrokeColor(global) orelse default_color;
        if (c.SDL_SetRenderDrawColor(this.renderer, stroke_color.r(), stroke_color.g(), stroke_color.b(), stroke_color.a()) < 0) {
            global.throw("strokeRect failed to set fill color", .{});
            return .zero;
        }

        if (c.SDL_RenderDrawRectF(this.renderer, &rect) < 0) {
            global.throw("strokeRect failed to fill rect", .{});
            return .zero;
        }

        return .undefined;
    }
};
