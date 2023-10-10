const std = @import("std");
const bun = @import("root").bun;
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

    fn shift(this: Color, comptime p: @TypeOf(.enum_literal)) u5 {
        return switch (this) {
            .rgba => switch (p) {
                .r => 24,
                .g => 16,
                .b => 8,
                .a => 0,
                else => @compileError("must be r, g, b, or a"),
            },
            .argb => switch (p) {
                .a => 24,
                .r => 16,
                .g => 8,
                .b => 0,
                else => @compileError("must be r, g, b, or a"),
            },
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

    pub fn rgb(color: u32) Color {
        return .{ .argb = 0xff000000 | color };
    }

    pub fn fromJS(value: JSValue, global: *JSGlobalObject) ?Color {
        if (bun.String.tryFromJS(value, global)) |str| {
            if (str.inMapCaseInsensitive(Names)) |color| {
                return color;
            }

            const length = str.length();
            if (length >= 4 and str.hasPrefixComptime("#")) brk: {
                const hex_length = length - 1;
                if (hex_length != 3 and hex_length != 4 and hex_length != 6 and hex_length != 8) break :brk;
                if (str.is8Bit()) {
                    var hex = str.byteSlice()[1..];
                    var hex_value: u32 = 0;
                    for (hex) |digit| {
                        if (!std.ascii.isHex(digit)) break :brk;
                        hex_value <<= 4;
                        hex_value |= if (digit < 'A') digit - '0' else (digit - 'A' + 10) & 0xf;
                    }
                    switch (hex_length) {
                        3 => {
                            std.debug.print("TODO: hex colors with 3 digits\n", .{});
                            break :brk;
                        },
                        4 => {
                            std.debug.print("TODO: hex colors with 4 digits\n", .{});
                            break :brk;
                        },
                        6 => return rgb(hex_value),
                        8 => return rgba(hex_value),
                        else => unreachable,
                    }
                }
            }

            if (str.hasPrefixComptime("rgba(")) {
                // parse rgba color
            }

            // assume never in quirks mode
            // if (str.hasPrefixComptime("rgb(")) {}

        }

        return null;
    }

    pub fn maybeRGB(comptime T: type, characters: []T) bool {
        _ = characters;
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

    fps: struct {
        pub const max_ticks = 100;
        ticks: [max_ticks]f64 = .{0} ** max_ticks,
        index: usize = 0,
        sum: f64 = 0,

        pub fn get(this: *@This(), tick: f64) f64 {
            this.sum -= this.ticks[this.index];
            this.sum += tick;
            this.ticks[this.index] = tick;
            this.index += 1;
            if (this.index == max_ticks) {
                this.index = 0;
            }

            return this.sum / @as(f64, @floatFromInt(max_ticks));
        }
    },

    pub fn constructor(global: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) ?*Canvas {
        log("Canvas.constructor", .{});

        const args = callFrame.arguments(5).slice();

        var canvas = Canvas{
            .fps = .{},
        };

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
        const fps = canvas.fps.get(current_time - canvas.previous_time);
        const delta = (current_time - canvas.previous_time) / @as(f64, 1000000000.0);
        canvas.previous_time = current_time;

        var buf: [1000:0]u8 = undefined;
        c.SDL_SetWindowTitle(canvas.window, std.fmt.bufPrintZ(&buf, "fps: {d}", .{fps}) catch unreachable);

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

        const context = CanvasRenderingContext2D.create(this.window, this.renderer) orelse {
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

    window: *c.SDL_Window,
    renderer: *c.SDL_Renderer,

    stroke_style: JSValue = .undefined,
    cached_stroke_color: ?Color = null,
    fill_style: JSValue = .undefined,
    cached_fill_color: ?Color = null,

    const clear_color = Color.rgb(0xffffff);
    const default_color = Color.rgba(0x000000ff);

    pub fn create(window: *c.SDL_Window, renderer: *c.SDL_Renderer) ?*CanvasRenderingContext2D {
        log("create", .{});

        var context = bun.default_allocator.create(CanvasRenderingContext2D) catch unreachable;
        context.* = CanvasRenderingContext2D{
            .window = window,
            .renderer = renderer,
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
