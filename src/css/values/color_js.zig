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
    css,
    rgb,
    rgba,
    hsl,
    lab,
    hex,
    HEX,
    ansi,
    ansi256,
    number,

    pub const Map = bun.ComptimeStringMap(OutputColorFormat, .{
        .{ "css", .css },
        .{ "hex", .hex },
        .{ "HEX", .HEX },
        .{ "hsl", .hsl },
        .{ "lab", .lab },
        .{ "rgb", .rgb },
        .{ "ansi", .ansi },
        .{ "rgba", .rgba },
        .{ "number", .number },
        .{ "ansi256", .ansi256 },
        .{ "ansi_256", .ansi256 },
        .{ "ansi-256", .ansi256 },
    });
};

pub fn jsFunctionColor(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const args = callFrame.arguments(2).slice();
    if (args.len < 1 or args[0].isUndefined()) {
        globalThis.throwNotEnoughArguments("Bun.color", 2, args.len);
        return JSC.JSValue.jsUndefined();
    }

    const input = args[0].toSlice(globalThis, bun.default_allocator);
    defer input.deinit();

    var format = OutputColorFormat.css;
    if (!args[1].isEmptyOrUndefinedOrNull()) {
        if (!args[1].isString()) {
            globalThis.throwInvalidArgumentType("color", "format", "string");
            return JSC.JSValue.jsUndefined();
        }

        format = args[1].toEnum(globalThis, "format", OutputColorFormat) catch return .zero;
    }

    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack_fallback = std.heap.stackFallback(4096, arena.allocator());
    const allocator = stack_fallback.get();

    var log = bun.logger.Log.init(allocator);
    defer log.deinit();

    var parser_input = css.ParserInput.new(allocator, input.slice());
    var parser = css.Parser.new(&parser_input);
    var parsed_color = css.CssColor.parse(&parser);
    switch (parsed_color) {
        .err => |err| {
            if (log.msgs.items.len == 0) {
                return .null;
            }

            globalThis.throw("color() failed to parse {s}", .{@tagName(err.basic().kind)});
            return JSC.JSValue.jsUndefined();
        },
        .result => |*result| {
            formatted: {
                var str = color: {
                    switch (format) {
                        .css => break :formatted,

                        .number, .rgb, .rgba, .hex, .HEX, .ansi, .ansi256 => |tag| {
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
                                .ansi => {
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
                                .ansi256 => {
                                    // https://github.com/tmux/tmux/blob/dae2868d1227b95fd076fb4a5efa6256c7245943/colour.c#L44-L55
                                    const Ansi256 = struct {
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
                                    };

                                    const val = Ansi256.get(rgba.red, rgba.green, rgba.blue);
                                    // ANSI escape sequence
                                    var buf: [12]u8 = undefined;
                                    // 0x1b is the escape character
                                    buf[0] = 0x1b;
                                    buf[1] = '[';
                                    buf[2] = '3';
                                    buf[3] = '8';
                                    buf[4] = ';';
                                    buf[5] = '5';
                                    buf[6] = ';';
                                    const extra = std.fmt.bufPrint(buf[7..], "{d}m", .{val}) catch unreachable;
                                    break :color bun.String.createLatin1(buf[0 .. 7 + extra.len]);
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
