const std = @import("std");
const bun = @import("root").bun;
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CallFrame = JSC.CallFrame;

// for now cInclude, later add a SDL wrapper
const c = @cImport({
    @cInclude("SDL.h");
});

const Canvas = @This();

const log = Output.scoped(.Canvas, false);
pub usingnamespace JSC.Codegen.JSCanvas;

running: bool,
width: i32,
height: i32,

window: *c.SDL_Window,

pub fn constructor(globalObject: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) ?*Canvas {
    log("Canvas.constructor", .{});

    const args = callFrame.arguments(4).slice();
    _ = args;

    _ = c.SDL_Init(c.SDL_INIT_EVERYTHING);

    const window = c.SDL_CreateWindow("bun window", c.SDL_WINDOWPOS_UNDEFINED, c.SDL_WINDOWPOS_UNDEFINED, 640, 480, c.SDL_WINDOW_SHOWN);
    if (window == null) {
        globalObject.throw("Failed to create window", .{});
        return null;
    }

    var canvas: *Canvas = bun.default_allocator.create(Canvas) catch unreachable;

    canvas.running = true;
    canvas.height = 1;
    canvas.width = 1;

    return canvas;
}

pub fn finalize(this: *Canvas) callconv(.C) void {
    log("Canvas.finalize", .{});
    bun.default_allocator.destroy(this);
}

pub fn getHeight(this: *Canvas, globalObject: *JSGlobalObject) callconv(.C) JSValue {
    log("Canvas.getHeight: {d}", .{this.height});
    _ = globalObject;

    return JSValue.jsNumber(this.height);
}

pub fn setHeight(this: *Canvas, globalObject: *JSGlobalObject, value: JSValue) callconv(.C) bool {
    log("Canvas.setHeight", .{});
    _ = this;
    _ = value;
    _ = globalObject;

    return true;
}

pub fn getWidth(this: *Canvas, globalObject: *JSGlobalObject) callconv(.C) JSValue {
    log("Canvas.getHeight: {d}", .{this.width});
    _ = globalObject;

    return JSValue.jsNumber(this.width);
}

pub fn setWidth(this: *Canvas, globalObject: *JSGlobalObject, value: JSValue) callconv(.C) bool {
    log("Canvas.setWidth", .{});
    _ = this;
    _ = value;
    _ = globalObject;

    return true;
}

// pub fn hasPendingActivity(this: *Canvas) callconv(.C) bool {
//     return this.running;
// }
