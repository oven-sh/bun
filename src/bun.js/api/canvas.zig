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

const Color = struct {
    r: u8,
    g: u8,
    b: u8,
    a: u8,

    /// color name -> ARGB value
    pub const Names = bun.ComptimeStringMap(u32, .{
        .{ "aliceblue", 0xfff0f8ff },
        .{ "alpha", 0x00000000 },
        .{ "antiquewhite", 0xfffaebd7 },
        .{ "aqua", 0xff00ffff },
        .{ "aquamarine", 0xff7fffd4 },
        .{ "azure", 0xfff0ffff },
        .{ "beige", 0xfff5f5dc },
        .{ "bisque", 0xffffe4c4 },
        .{ "black", 0xff000000 },
        .{ "blanchedalmond", 0xffffebcd },
        .{ "blue", 0xff0000ff },
        .{ "blueviolet", 0xff8a2be2 },
        .{ "brown", 0xffa52a2a },
        .{ "burlywood", 0xffdeb887 },
        .{ "cadetblue", 0xff5f9ea0 },
        .{ "chartreuse", 0xff7fff00 },
        .{ "chocolate", 0xffd2691e },
        .{ "coral", 0xffff7f50 },
        .{ "cornflowerblue", 0xff6495ed },
        .{ "cornsilk", 0xfffff8dc },
        .{ "crimson", 0xffdc143c },
        .{ "cyan", 0xff00ffff },
        .{ "darkblue", 0xff00008b },
        .{ "darkcyan", 0xff008b8b },
        .{ "darkgoldenrod", 0xffb8860b },
        .{ "darkgray", 0xffa9a9a9 },
        .{ "darkgrey", 0xffa9a9a9 },
        .{ "darkgreen", 0xff006400 },
        .{ "darkkhaki", 0xffbdb76b },
        .{ "darkmagenta", 0xff8b008b },
        .{ "darkolivegreen", 0xff556b2f },
        .{ "darkorange", 0xffff8c00 },
        .{ "darkorchid", 0xff9932cc },
        .{ "darkred", 0xff8b0000 },
        .{ "darksalmon", 0xffe9967a },
        .{ "darkseagreen", 0xff8fbc8f },
        .{ "darkslateblue", 0xff483d8b },
        .{ "darkslategray", 0xff2f4f4f },
        .{ "darkslategrey", 0xff2f4f4f },
        .{ "darkturquoise", 0xff00ced1 },
        .{ "darkviolet", 0xff9400d3 },
        .{ "deeppink", 0xffff1493 },
        .{ "deepskyblue", 0xff00bfff },
        .{ "dimgray", 0xff696969 },
        .{ "dimgrey", 0xff696969 },
        .{ "dodgerblue", 0xff1e90ff },
        .{ "firebrick", 0xffb22222 },
        .{ "floralwhite", 0xfffffaf0 },
        .{ "forestgreen", 0xff228b22 },
        .{ "fuchsia", 0xffff00ff },
        .{ "gainsboro", 0xffdcdcdc },
        .{ "ghostwhite", 0xfff8f8ff },
        .{ "gold", 0xffffd700 },
        .{ "goldenrod", 0xffdaa520 },
        .{ "gray", 0xff808080 },
        .{ "grey", 0xff808080 },
        .{ "green", 0xff008000 },
        .{ "greenyellow", 0xffadff2f },
        .{ "honeydew", 0xfff0fff0 },
        .{ "hotpink", 0xffff69b4 },
        .{ "indianred", 0xffcd5c5c },
        .{ "indigo", 0xff4b0082 },
        .{ "ivory", 0xfffffff0 },
        .{ "khaki", 0xfff0e68c },
        .{ "lavender", 0xffe6e6fa },
        .{ "lavenderblush", 0xfffff0f5 },
        .{ "lawngreen", 0xff7cfc00 },
        .{ "lemonchiffon", 0xfffffacd },
        .{ "lightblue", 0xffadd8e6 },
        .{ "lightcoral", 0xfff08080 },
        .{ "lightcyan", 0xffe0ffff },
        .{ "lightgoldenrodyellow", 0xfffafad2 },
        .{ "lightgray", 0xffd3d3d3 },
        .{ "lightgrey", 0xffd3d3d3 },
        .{ "lightgreen", 0xff90ee90 },
        .{ "lightpink", 0xffffb6c1 },
        .{ "lightsalmon", 0xffffa07a },
        .{ "lightseagreen", 0xff20b2aa },
        .{ "lightskyblue", 0xff87cefa },
        .{ "lightslateblue", 0xff8470ff },
        .{ "lightslategray", 0xff778899 },
        .{ "lightslategrey", 0xff778899 },
        .{ "lightsteelblue", 0xffb0c4de },
        .{ "lightyellow", 0xffffffe0 },
        .{ "lime", 0xff00ff00 },
        .{ "limegreen", 0xff32cd32 },
        .{ "linen", 0xfffaf0e6 },
        .{ "magenta", 0xffff00ff },
        .{ "maroon", 0xff800000 },
        .{ "mediumaquamarine", 0xff66cdaa },
        .{ "mediumblue", 0xff0000cd },
        .{ "mediumorchid", 0xffba55d3 },
        .{ "mediumpurple", 0xff9370db },
        .{ "mediumseagreen", 0xff3cb371 },
        .{ "mediumslateblue", 0xff7b68ee },
        .{ "mediumspringgreen", 0xff00fa9a },
        .{ "mediumturquoise", 0xff48d1cc },
        .{ "mediumvioletred", 0xffc71585 },
        .{ "midnightblue", 0xff191970 },
        .{ "mintcream", 0xfff5fffa },
        .{ "mistyrose", 0xffffe4e1 },
        .{ "moccasin", 0xffffe4b5 },
        .{ "navajowhite", 0xffffdead },
        .{ "navy", 0xff000080 },
        .{ "oldlace", 0xfffdf5e6 },
        .{ "olive", 0xff808000 },
        .{ "olivedrab", 0xff6b8e23 },
        .{ "orange", 0xffffa500 },
        .{ "orangered", 0xffff4500 },
        .{ "orchid", 0xffda70d6 },
        .{ "palegoldenrod", 0xffeee8aa },
        .{ "palegreen", 0xff98fb98 },
        .{ "paleturquoise", 0xffafeeee },
        .{ "palevioletred", 0xffdb7093 },
        .{ "papayawhip", 0xffffefd5 },
        .{ "peachpuff", 0xffffdab9 },
        .{ "peru", 0xffcd853f },
        .{ "pink", 0xffffc0cb },
        .{ "plum", 0xffdda0dd },
        .{ "powderblue", 0xffb0e0e6 },
        .{ "purple", 0xff800080 },
        .{ "rebeccapurple", 0xff663399 },
        .{ "red", 0xffff0000 },
        .{ "rosybrown", 0xffbc8f8f },
        .{ "royalblue", 0xff4169e1 },
        .{ "saddlebrown", 0xff8b4513 },
        .{ "salmon", 0xfffa8072 },
        .{ "sandybrown", 0xfff4a460 },
        .{ "seagreen", 0xff2e8b57 },
        .{ "seashell", 0xfffff5ee },
        .{ "sienna", 0xffa0522d },
        .{ "silver", 0xffc0c0c0 },
        .{ "skyblue", 0xff87ceeb },
        .{ "slateblue", 0xff6a5acd },
        .{ "slategray", 0xff708090 },
        .{ "slategrey", 0xff708090 },
        .{ "snow", 0xfffffafa },
        .{ "springgreen", 0xff00ff7f },
        .{ "steelblue", 0xff4682b4 },
        .{ "tan", 0xffd2b48c },
        .{ "teal", 0xff008080 },
        .{ "thistle", 0xffd8bfd8 },
        .{ "tomato", 0xffff6347 },
        .{ "transparent", 0x00000000 },
        .{ "turquoise", 0xff40e0d0 },
        .{ "violet", 0xffee82ee },
        .{ "violetred", 0xffd02090 },
        .{ "wheat", 0xfff5deb3 },
        .{ "white", 0xffffffff },
        .{ "whitesmoke", 0xfff5f5f5 },
        .{ "yellow", 0xffffff00 },
        .{ "yellowgreen", 0xff9acd32 },
    });

    pub fn fromJS(value: JSValue, global: *JSGlobalObject) ?Color {
        if (bun.String.tryFromJS(value, global)) |str| {
            if (str.inMapCaseInsensitive(Names)) |color| {
                return fromARGB(color);
            }
        }

        return null;
    }

    pub fn fromARGB(value: u32) Color {
        return .{
            .r = @truncate(value >> 16),
            .g = @truncate(value >> 8),
            .b = @truncate(value),
            .a = @truncate(value >> 24),
        };
    }

    pub fn fromRGBA(value: u32) Color {
        return .{
            .r = @truncate(value >> 24),
            .g = @truncate(value >> 16),
            .b = @truncate(value >> 8),
            .a = @truncate(value),
        };
    }
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
    _animate_callback_value: ?JSValue = null,

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

    fn animateCallback(global: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
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
                canvas.getAnimateCallback(global),
                JSC.JSArray.from(global, &[_]JSValue{ canvas.toJS(global), callback }),
            );
        }

        c.SDL_RenderPresent(canvas.renderer);

        return .undefined;
    }

    fn getAnimateCallback(this: *Canvas, global: *JSGlobalObject) callconv(.C) JSValue {
        return this._animate_callback_value orelse {
            const cb = JSC.createCallback(global, ZigString.static("animateCallback"), 2, animateCallback);
            this._animate_callback_value = cb;
            return this._animate_callback_value.?;
        };
    }

    pub fn animate(this: *Canvas, global: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        log("Canvas.animate", .{});

        const args = callFrame.arguments(1).slice();
        if (args.len == 0 or !args[0].isCallable(global.vm())) {
            global.throw("Expected first argument to be a callback", .{});
            return .zero;
        }

        this.previous_time = @floatFromInt(global.bunVM().origin_timer.read());

        this.timer_id = Timer.setImmediate(
            global,
            this.getAnimateCallback(global),
            JSC.JSArray.from(global, &[_]JSValue{ this.toJS(global), args[0] }),
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

    clear_color: Color = Color.fromRGBA(0x00000000),

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
        global.throw("CanvasRenderingContext2D cannot be constructed", .{});
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

        if (c.SDL_SetRenderDrawColor(this.renderer, this.clear_color.r, this.clear_color.g, this.clear_color.b, this.clear_color.a) < 0) {
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

        if (this.getFillColor(global)) |fill_color| {
            if (c.SDL_SetRenderDrawColor(this.renderer, fill_color.r, fill_color.g, fill_color.b, fill_color.a) < 0) {
                global.throw("fillRect failed to set fill color", .{});
                return .zero;
            }
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

        if (this.getStrokeColor(global)) |fill_color| {
            if (c.SDL_SetRenderDrawColor(this.renderer, fill_color.r, fill_color.g, fill_color.b, fill_color.a) < 0) {
                global.throw("strokeRect failed to set fill color", .{});
                return .zero;
            }
        }

        if (c.SDL_RenderDrawRectF(this.renderer, &rect) < 0) {
            global.throw("strokeRect failed to fill rect", .{});
            return .zero;
        }

        return .undefined;
    }
};
