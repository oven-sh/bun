const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;

pub const createBrotliEncoder = bun.JSC.API.BrotliEncoder.create;

pub const createBrotliDecoder = bun.JSC.API.BrotliDecoder.create;

pub const createZlibEncoder = bun.JSC.API.ZlibEncoder.create;

pub const createZlibDecoder = bun.JSC.API.ZlibDecoder.create;

pub fn crc32(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const arguments = callframe.arguments(2).ptr;

    const data: ZigString.Slice = blk: {
        const data: JSC.JSValue = arguments[0];
        var exceptionref: JSC.C.JSValueRef = null;

        if (data == .zero) {
            return globalThis.throwInvalidArgumentTypeValue("data", "string or an instance of Buffer, TypedArray, or DataView", .undefined);
        }
        if (data.isString()) {
            break :blk data.asString().toSlice(globalThis, bun.default_allocator);
        }
        const buffer: JSC.Buffer = JSC.Buffer.fromJS(globalThis, data, &exceptionref) orelse {
            const ty_str = data.jsTypeString(globalThis).toSlice(globalThis, bun.default_allocator);
            defer ty_str.deinit();
            globalThis.ERR_INVALID_ARG_TYPE("The \"data\" property must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received {s}", .{ty_str.slice()}).throw();
            return .zero;
        };
        if (exceptionref) |ptr| {
            globalThis.throwValue(JSC.JSValue.c(ptr));
            return .zero;
        }
        break :blk ZigString.Slice.fromUTF8NeverFree(buffer.slice());
    };
    defer data.deinit();

    const value: u32 = blk: {
        const value: JSC.JSValue = arguments[1];
        if (value == .zero) {
            break :blk 0;
        }
        if (!value.isNumber()) {
            return globalThis.throwInvalidArgumentTypeValue("value", "number", value);
        }
        const valuef = value.asNumber();
        const min = 0;
        const max = std.math.maxInt(u32);

        if (@floor(valuef) != valuef) {
            globalThis.ERR_OUT_OF_RANGE("The value of \"{s}\" is out of range. It must be an integer. Received {}", .{ "value", valuef }).throw();
            return .zero;
        }
        if (valuef < min or valuef > max) {
            globalThis.ERR_OUT_OF_RANGE("The value of \"{s}\" is out of range. It must be >= {d} and <= {d}. Received {d}", .{ "value", min, max, valuef }).throw();
            return .zero;
        }
        break :blk @intFromFloat(valuef);
    };

    // crc32 returns a u64 but the data will always be within a u32 range so the outer @intCast is always safe.
    const slice_u8 = data.slice();
    return JSC.JSValue.jsNumber(@as(u32, @intCast(bun.zlib.crc32(value, slice_u8.ptr, @intCast(slice_u8.len)))));
}
