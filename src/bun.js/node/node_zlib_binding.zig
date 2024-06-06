const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;

pub fn createBrotliEncoder(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    return JSC.JSFunction.create(global, "createBrotliEncoder", bun.JSC.API.BrotliEncoder.create, 3, .{});
}

pub fn createBrotliDecoder(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    return JSC.JSFunction.create(global, "createBrotliDecoder", bun.JSC.API.BrotliDecoder.create, 3, .{});
}

pub fn createDeflateEncoder(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    return JSC.JSFunction.create(global, "createDeflateEncoder", bun.JSC.API.DeflateEncoder.create, 3, .{});
}

pub fn createDeflateDecoder(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    return JSC.JSFunction.create(global, "createDeflateDecoder", bun.JSC.API.DeflateDecoder.create, 3, .{});
}
