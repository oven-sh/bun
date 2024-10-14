const bun = @import("root").bun;
const std = @import("std");
const color = @import("./color.zig");
const RGBA = color.RGBA;
const LAB = color.LAB;
const LCH = color.LCH;
const SRGB = color.SRGB;
const HSL = color.HSL;
const HWB = color.HWB;
const SRGBLinear = color.SRGBLinear;
const P3 = color.P3;
const JSC = bun.JSC;
const css = bun.css;

const OutputColorFormat = enum {
    ansi,
    ansi_16,
    ansi_256,
    ansi_16m,
    css,
    hex,
    HEX,
    hsl,
    lab,
    number,
    rgb,
    rgba,
    @"[rgb]",
    @"[rgba]",
    @"{rgb}",
    @"{rgba}",

    pub const Map = bun.ComptimeStringMap(OutputColorFormat, .{
        .{ "[r,g,b,a]", .@"[rgba]" },
        .{ "[rgb]", .@"[rgb]" },
        .{ "[rgba]", .@"[rgba]" },
        .{ "{r,g,b}", .@"{rgb}" },
        .{ "{rgb}", .@"{rgb}" },
        .{ "{rgba}", .@"{rgba}" },
        .{ "ansi_256", .ansi_256 },
        .{ "ansi-256", .ansi_256 },
        .{ "ansi-16", .ansi_16 },
        .{ "ansi-16m", .ansi_16m },
        .{ "ansi-24bit", .ansi_16m },
        .{ "ansi-truecolor", .ansi_16m },
        .{ "ansi", .ansi },
        .{ "ansi256", .ansi_256 },
        .{ "css", .css },
        .{ "hex", .hex },
        .{ "HEX", .HEX },
        .{ "hsl", .hsl },
        .{ "lab", .lab },
        .{ "number", .number },
        .{ "rgb", .rgb },
        .{ "rgba", .rgba },
    });
};

fn colorIntFromJS(globalThis: *JSC.JSGlobalObject, input: JSC.JSValue, comptime property: []const u8) ?i32 {
    if (input == .zero or input == .undefined or !input.isNumber()) {
        globalThis.throwInvalidArgumentType("color", property, "integer");

        return null;
    }

    // CSS spec says to clamp values to their valid range so we'll respect that here
    return std.math.clamp(input.coerce(i32, globalThis), 0, 255);
}

// https://github.com/tmux/tmux/blob/dae2868d1227b95fd076fb4a5efa6256c7245943/colour.c#L44-L55
pub const Ansi256 = struct {
    const q2c = [_]u32{ 0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff };

    fn sqdist(R: u32, G: u32, B: u32, r: u32, g: u32, b: u32) u32 {
        return ((R -% r) *% (R -% r) +% (G -% g) *% (G -% g) +% (B -% b) *% (B -% b));
    }

    fn to6Cube(v: u32) u32 {
        if (v < 48)
            return (0);
        if (v < 114)
            return (1);
        return ((v - 35) / 40);
    }

    fn get(r: u32, g: u32, b: u32) u32 {
        const qr = to6Cube(r);
        const cr = q2c[@intCast(qr)];
        const qg = to6Cube(g);
        const cg = q2c[@intCast(qg)];
        const qb = to6Cube(b);
        const cb = q2c[@intCast(qb)];

        if (cr == r and cg == g and cb == b) {
            return 16 +% (36 *% qr) +% (6 *% qg) +% qb;
        }

        const grey_avg = (r +% g +% b) / 3;
        const grey_idx = if (grey_avg > 238) 23 else (grey_avg -% 3) / 10;
        const grey = 8 +% (10 *% grey_idx);

        const d = sqdist(cr, cg, cb, r, g, b);
        const idx = if (sqdist(grey, grey, grey, r, g, b) < d) 232 +% grey_idx else 16 +% (36 *% qr) +% (6 *% qg) +% qb;
        return idx;
    }

    const table_256: [256]u8 = .{
        0,  1,  2,  3,  4,  5,  6,  7,  8,  9,  10, 11, 12, 13, 14, 15,
        0,  4,  4,  4,  12, 12, 2,  6,  4,  4,  12, 12, 2,  2,  6,  4,
        12, 12, 2,  2,  2,  6,  12, 12, 10, 10, 10, 10, 14, 12, 10, 10,
        10, 10, 10, 14, 1,  5,  4,  4,  12, 12, 3,  8,  4,  4,  12, 12,
        2,  2,  6,  4,  12, 12, 2,  2,  2,  6,  12, 12, 10, 10, 10, 10,
        14, 12, 10, 10, 10, 10, 10, 14, 1,  1,  5,  4,  12, 12, 1,  1,
        5,  4,  12, 12, 3,  3,  8,  4,  12, 12, 2,  2,  2,  6,  12, 12,
        10, 10, 10, 10, 14, 12, 10, 10, 10, 10, 10, 14, 1,  1,  1,  5,
        12, 12, 1,  1,  1,  5,  12, 12, 1,  1,  1,  5,  12, 12, 3,  3,
        3,  7,  12, 12, 10, 10, 10, 10, 14, 12, 10, 10, 10, 10, 10, 14,
        9,  9,  9,  9,  13, 12, 9,  9,  9,  9,  13, 12, 9,  9,  9,  9,
        13, 12, 9,  9,  9,  9,  13, 12, 11, 11, 11, 11, 7,  12, 10, 10,
        10, 10, 10, 14, 9,  9,  9,  9,  9,  13, 9,  9,  9,  9,  9,  13,
        9,  9,  9,  9,  9,  13, 9,  9,  9,  9,  9,  13, 9,  9,  9,  9,
        9,  13, 11, 11, 11, 11, 11, 15, 0,  0,  0,  0,  0,  0,  8,  8,
        8,  8,  8,  8,  7,  7,  7,  7,  7,  7,  15, 15, 15, 15, 15, 15,
    };

    pub fn get16(r: u32, g: u32, b: u32) u8 {
        const val = get(r, g, b);
        return table_256[val & 0xff];
    }

    pub const Buffer = [24]u8;

    pub fn from(rgba: RGBA, buf: *Buffer) []u8 {
        const val = get(rgba.red, rgba.green, rgba.blue);
        // 0x1b is the escape character
        buf[0] = 0x1b;
        buf[1] = '[';
        buf[2] = '3';
        buf[3] = '8';
        buf[4] = ';';
        buf[5] = '5';
        buf[6] = ';';
        const extra = std.fmt.bufPrint(buf[7..], "{d}m", .{val}) catch unreachable;
        return buf[0 .. 7 + extra.len];
    }
};

pub fn jsFunctionColor(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const args = callFrame.argumentsUndef(2).all();
    if (args[0].isUndefined()) {
        globalThis.throwInvalidArgumentType("color", "input", "string, number, or object");
        return JSC.JSValue.jsUndefined();
    }

    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(4096, arena.allocator());
    const allocator = stack_fallback.get();

    var log = bun.logger.Log.init(allocator);
    defer log.deinit();

    const unresolved_format: OutputColorFormat = brk: {
        if (!args[1].isEmptyOrUndefinedOrNull()) {
            if (!args[1].isString()) {
                globalThis.throwInvalidArgumentType("color", "format", "string");
                return JSC.JSValue.jsUndefined();
            }

            break :brk args[1].toEnum(globalThis, "format", OutputColorFormat) catch return .zero;
        }

        break :brk OutputColorFormat.css;
    };
    var input = JSC.ZigString.Slice.empty;
    defer input.deinit();

    var parsed_color: css.CssColor.ParseResult = brk: {
        if (args[0].isNumber()) {
            const number: i64 = args[0].toInt64();
            const Packed = packed struct(u32) {
                blue: u8,
                green: u8,
                red: u8,
                alpha: u8,
            };
            const int: u32 = @truncate(@abs(@mod(number, std.math.maxInt(u32))));
            const rgba: Packed = @bitCast(int);

            break :brk .{ .result = css.CssColor{ .rgba = .{ .alpha = rgba.alpha, .red = rgba.red, .green = rgba.green, .blue = rgba.blue } } };
        } else if (args[0].jsType().isArrayLike()) {
            switch (args[0].getLength(globalThis)) {
                3 => {
                    const r = colorIntFromJS(globalThis, args[0].getIndex(globalThis, 0), "[0]") orelse return .zero;
                    if (globalThis.hasException()) {
                        return .zero;
                    }
                    const g = colorIntFromJS(globalThis, args[0].getIndex(globalThis, 1), "[1]") orelse return .zero;
                    if (globalThis.hasException()) {
                        return .zero;
                    }
                    const b = colorIntFromJS(globalThis, args[0].getIndex(globalThis, 2), "[2]") orelse return .zero;
                    if (globalThis.hasException()) {
                        return .zero;
                    }
                    break :brk .{ .result = css.CssColor{ .rgba = .{ .alpha = 255, .red = @intCast(r), .green = @intCast(g), .blue = @intCast(b) } } };
                },
                4 => {
                    const r = colorIntFromJS(globalThis, args[0].getIndex(globalThis, 0), "[0]") orelse return .zero;
                    if (globalThis.hasException()) {
                        return .zero;
                    }
                    const g = colorIntFromJS(globalThis, args[0].getIndex(globalThis, 1), "[1]") orelse return .zero;
                    if (globalThis.hasException()) {
                        return .zero;
                    }
                    const b = colorIntFromJS(globalThis, args[0].getIndex(globalThis, 2), "[2]") orelse return .zero;
                    if (globalThis.hasException()) {
                        return .zero;
                    }
                    const a = colorIntFromJS(globalThis, args[0].getIndex(globalThis, 3), "[3]") orelse return .zero;
                    if (globalThis.hasException()) {
                        return .zero;
                    }
                    break :brk .{ .result = css.CssColor{ .rgba = .{ .alpha = @intCast(a), .red = @intCast(r), .green = @intCast(g), .blue = @intCast(b) } } };
                },
                else => {
                    globalThis.throw("Expected array length 3 or 4", .{});
                    return JSC.JSValue.jsUndefined();
                },
            }
        } else if (args[0].isObject()) {
            const r = colorIntFromJS(globalThis, args[0].get(globalThis, "r") orelse .zero, "r") orelse return .zero;

            if (globalThis.hasException()) {
                return .zero;
            }
            const g = colorIntFromJS(globalThis, args[0].get(globalThis, "g") orelse .zero, "g") orelse return .zero;

            if (globalThis.hasException()) {
                return .zero;
            }
            const b = colorIntFromJS(globalThis, args[0].get(globalThis, "b") orelse .zero, "b") orelse return .zero;

            if (globalThis.hasException()) {
                return .zero;
            }

            const a: ?u8 = if (args[0].getTruthy(globalThis, "a")) |a_value| brk2: {
                if (a_value.isNumber()) {
                    break :brk2 @intCast(@mod(@as(i64, @intFromFloat(a_value.asNumber() * 255.0)), 256));
                }
                break :brk2 null;
            } else null;
            if (globalThis.hasException()) {
                return .zero;
            }

            break :brk .{
                .result = css.CssColor{
                    .rgba = .{
                        .alpha = if (a != null) @intCast(a.?) else 255,
                        .red = @intCast(r),
                        .green = @intCast(g),
                        .blue = @intCast(b),
                    },
                },
            };
        }

        input = args[0].toSlice(globalThis, bun.default_allocator);

        var parser_input = css.ParserInput.new(allocator, input.slice());
        var parser = css.Parser.new(&parser_input, null);
        break :brk css.CssColor.parse(&parser);
    };

    switch (parsed_color) {
        .err => |err| {
            if (log.msgs.items.len == 0) {
                return .null;
            }

            globalThis.throw("color() failed to parse {s}", .{@tagName(err.basic().kind)});
            return JSC.JSValue.jsUndefined();
        },
        .result => |*result| {
            const format: OutputColorFormat = if (unresolved_format == .ansi) switch (bun.Output.Source.colorDepth()) {
                // No color terminal, therefore return an empty string
                .none => return JSC.JSValue.jsEmptyString(globalThis),
                .@"16" => .ansi_16,
                .@"16m" => .ansi_16m,
                .@"256" => .ansi_256,
            } else unresolved_format;

            formatted: {
                var str = color: {
                    switch (format) {
                        // resolved above.
                        .ansi => unreachable,

                        // Use the CSS printer.
                        .css => break :formatted,

                        .number,
                        .rgb,
                        .rgba,
                        .hex,
                        .HEX,
                        .ansi_16,
                        .ansi_16m,
                        .ansi_256,
                        .@"{rgba}",
                        .@"{rgb}",
                        .@"[rgba]",
                        .@"[rgb]",
                        => |tag| {
                            const srgba = switch (result.*) {
                                .float => |float| switch (float.*) {
                                    .rgb => |rgb| rgb,
                                    inline else => |*val| val.intoSRGB(),
                                },
                                .rgba => |*rgba| rgba.intoSRGB(),
                                .lab => |lab| switch (lab.*) {
                                    inline else => |entry| entry.intoSRGB(),
                                },
                                else => break :formatted,
                            };
                            const rgba = srgba.intoRGBA();
                            switch (tag) {
                                .@"{rgba}" => {
                                    const object = JSC.JSValue.createEmptyObject(globalThis, 4);
                                    object.put(globalThis, "r", JSC.JSValue.jsNumber(rgba.red));
                                    object.put(globalThis, "g", JSC.JSValue.jsNumber(rgba.green));
                                    object.put(globalThis, "b", JSC.JSValue.jsNumber(rgba.blue));
                                    object.put(globalThis, "a", JSC.JSValue.jsNumber(rgba.alphaF32()));
                                    return object;
                                },
                                .@"{rgb}" => {
                                    const object = JSC.JSValue.createEmptyObject(globalThis, 4);
                                    object.put(globalThis, "r", JSC.JSValue.jsNumber(rgba.red));
                                    object.put(globalThis, "g", JSC.JSValue.jsNumber(rgba.green));
                                    object.put(globalThis, "b", JSC.JSValue.jsNumber(rgba.blue));
                                    return object;
                                },
                                .@"[rgb]" => {
                                    const object = JSC.JSValue.createEmptyArray(globalThis, 3);
                                    object.putIndex(globalThis, 0, JSC.JSValue.jsNumber(rgba.red));
                                    object.putIndex(globalThis, 1, JSC.JSValue.jsNumber(rgba.green));
                                    object.putIndex(globalThis, 2, JSC.JSValue.jsNumber(rgba.blue));
                                    return object;
                                },
                                .@"[rgba]" => {
                                    const object = JSC.JSValue.createEmptyArray(globalThis, 4);
                                    object.putIndex(globalThis, 0, JSC.JSValue.jsNumber(rgba.red));
                                    object.putIndex(globalThis, 1, JSC.JSValue.jsNumber(rgba.green));
                                    object.putIndex(globalThis, 2, JSC.JSValue.jsNumber(rgba.blue));
                                    object.putIndex(globalThis, 3, JSC.JSValue.jsNumber(rgba.alpha));
                                    return object;
                                },
                                .number => {
                                    var int: u32 = 0;
                                    int |= @as(u32, rgba.red) << 16;
                                    int |= @as(u32, rgba.green) << 8;
                                    int |= @as(u32, rgba.blue);
                                    return JSC.JSValue.jsNumber(int);
                                },
                                .hex => {
                                    break :color bun.String.createFormat("#{}{}{}", .{ bun.fmt.hexIntLower(rgba.red), bun.fmt.hexIntLower(rgba.green), bun.fmt.hexIntLower(rgba.blue) });
                                },
                                .HEX => {
                                    break :color bun.String.createFormat("#{}{}{}", .{ bun.fmt.hexIntUpper(rgba.red), bun.fmt.hexIntUpper(rgba.green), bun.fmt.hexIntUpper(rgba.blue) });
                                },
                                .rgb => {
                                    break :color bun.String.createFormat("rgb({d}, {d}, {d})", .{ rgba.red, rgba.green, rgba.blue });
                                },
                                .rgba => {
                                    break :color bun.String.createFormat("rgba({d}, {d}, {d}, {d})", .{ rgba.red, rgba.green, rgba.blue, rgba.alphaF32() });
                                },
                                .ansi_16 => {
                                    const ansi_16_color = Ansi256.get16(rgba.red, rgba.green, rgba.blue);
                                    // 16-color ansi, foreground text color
                                    break :color bun.String.createLatin1(&[_]u8{
                                        // 0x1b is the escape character
                                        // 38 is the foreground color code
                                        // 5 is the 16-color mode
                                        // {d} is the color index
                                        0x1b, '[', '3', '8', ';', '5', ';', ansi_16_color, 'm',
                                    });
                                },
                                .ansi_16m => {
                                    // true color ansi
                                    var buf: [48]u8 = undefined;
                                    // 0x1b is the escape character
                                    buf[0] = 0x1b;
                                    buf[1] = '[';
                                    buf[2] = '3';
                                    buf[3] = '8';
                                    buf[4] = ';';
                                    buf[5] = '2';
                                    buf[6] = ';';
                                    const additional = std.fmt.bufPrint(buf[7..], "{d};{d};{d}m", .{
                                        rgba.red,
                                        rgba.green,
                                        rgba.blue,
                                    }) catch unreachable;

                                    break :color bun.String.createLatin1(buf[0 .. 7 + additional.len]);
                                },
                                .ansi_256 => {
                                    // ANSI escape sequence
                                    var buf: Ansi256.Buffer = undefined;
                                    const val = Ansi256.from(rgba, &buf);
                                    break :color bun.String.createLatin1(val);
                                },
                                else => unreachable,
                            }
                        },

                        .hsl => {
                            const hsl = switch (result.*) {
                                .float => |float| brk: {
                                    switch (float.*) {
                                        .hsl => |hsl| break :brk hsl,
                                        inline else => |*val| break :brk val.intoHSL(),
                                    }
                                },
                                .rgba => |*rgba| rgba.intoHSL(),
                                .lab => |lab| switch (lab.*) {
                                    inline else => |entry| entry.intoHSL(),
                                },
                                else => break :formatted,
                            };

                            break :color bun.String.createFormat("hsl({d}, {d}, {d})", .{ hsl.h, hsl.s, hsl.l });
                        },
                        .lab => {
                            const lab = switch (result.*) {
                                .float => |float| switch (float.*) {
                                    inline else => |*val| val.intoLAB(),
                                },
                                .lab => |lab| switch (lab.*) {
                                    .lab => |lab_| lab_,
                                    inline else => |entry| entry.intoLAB(),
                                },
                                .rgba => |*rgba| rgba.intoLAB(),
                                else => break :formatted,
                            };

                            break :color bun.String.createFormat("lab({d}, {d}, {d})", .{ lab.l, lab.a, lab.b });
                        },
                    }
                } catch bun.outOfMemory();

                return str.transferToJS(globalThis);
            }

            // Fallback to CSS string output
            var dest = std.ArrayListUnmanaged(u8){};
            const writer = dest.writer(allocator);

            var printer = css.Printer(@TypeOf(writer)).new(
                allocator,
                std.ArrayList(u8).init(allocator),
                writer,
                .{},
                null,
            );

            result.toCss(@TypeOf(writer), &printer) catch |err| {
                globalThis.throw("color() internal error: {s}", .{@errorName(err)});
                return .zero;
            };

            var out = bun.String.createUTF8(dest.items);
            return out.transferToJS(globalThis);
        },
    }
}
