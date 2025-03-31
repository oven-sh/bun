pub fn newCString(globalThis: *JSGlobalObject, value: JSValue, byteOffset: ?JSValue, lengthValue: ?JSValue) JSC.JSValue {
    switch (FFIObject.getPtrSlice(globalThis, value, byteOffset, lengthValue)) {
        .err => |err| {
            return err;
        },
        .slice => |slice| {
            return bun.String.createUTF8ForJS(globalThis, slice);
        },
    }
}

pub const dom_call = JSC.DOMCall("FFI", @This(), "ptr", JSC.DOMEffect.forRead(.TypedArrayProperties));

pub fn toJS(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSC.JSValue.createEmptyObject(globalObject, comptime std.meta.fieldNames(@TypeOf(fields)).len + 2);
    inline for (comptime std.meta.fieldNames(@TypeOf(fields))) |field| {
        object.put(
            globalObject,
            comptime ZigString.static(field),
            JSC.createCallback(globalObject, comptime ZigString.static(field), 1, comptime @field(fields, field)),
        );
    }

    dom_call.put(globalObject, object);
    object.put(globalObject, ZigString.static("read"), Reader.toJS(globalObject));

    return object;
}

pub const Reader = struct {
    pub const DOMCalls = .{
        .u8 = JSC.DOMCall("Reader", @This(), "u8", JSC.DOMEffect.forRead(.World)),
        .u16 = JSC.DOMCall("Reader", @This(), "u16", JSC.DOMEffect.forRead(.World)),
        .u32 = JSC.DOMCall("Reader", @This(), "u32", JSC.DOMEffect.forRead(.World)),
        .ptr = JSC.DOMCall("Reader", @This(), "ptr", JSC.DOMEffect.forRead(.World)),
        .i8 = JSC.DOMCall("Reader", @This(), "i8", JSC.DOMEffect.forRead(.World)),
        .i16 = JSC.DOMCall("Reader", @This(), "i16", JSC.DOMEffect.forRead(.World)),
        .i32 = JSC.DOMCall("Reader", @This(), "i32", JSC.DOMEffect.forRead(.World)),
        .i64 = JSC.DOMCall("Reader", @This(), "i64", JSC.DOMEffect.forRead(.World)),
        .u64 = JSC.DOMCall("Reader", @This(), "u64", JSC.DOMEffect.forRead(.World)),
        .intptr = JSC.DOMCall("Reader", @This(), "intptr", JSC.DOMEffect.forRead(.World)),
        .f32 = JSC.DOMCall("Reader", @This(), "f32", JSC.DOMEffect.forRead(.World)),
        .f64 = JSC.DOMCall("Reader", @This(), "f64", JSC.DOMEffect.forRead(.World)),
    };

    pub fn toJS(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const obj = JSC.JSValue.createEmptyObject(globalThis, std.meta.fieldNames(@TypeOf(Reader.DOMCalls)).len);

        inline for (comptime std.meta.fieldNames(@TypeOf(Reader.DOMCalls))) |field| {
            @field(Reader.DOMCalls, field).put(globalThis, obj);
        }

        return obj;
    }

    pub fn @"u8"(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) u8, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn @"u16"(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) u16, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn @"u32"(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) u32, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn ptr(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn @"i8"(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) i8, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn @"i16"(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) i16, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn @"i32"(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) i32, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn intptr(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }

    pub fn @"f32"(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) f32, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }

    pub fn @"f64"(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) f64, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }

    pub fn @"i64"(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
        return JSValue.fromInt64NoTruncate(globalObject, value);
    }

    pub fn @"u64"(
        globalObject: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) bun.JSError!JSValue {
        if (arguments.len == 0 or !arguments[0].isNumber()) {
            return globalObject.throwInvalidArguments("Expected a pointer", .{});
        }
        const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
        const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
        return JSValue.fromUInt64NoTruncate(globalObject, value);
    }

    pub fn u8WithoutTypeChecks(
        _: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) u8, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn u16WithoutTypeChecks(
        _: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) u16, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn u32WithoutTypeChecks(
        _: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) u32, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn ptrWithoutTypeChecks(
        _: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn i8WithoutTypeChecks(
        _: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) i8, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn i16WithoutTypeChecks(
        _: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) i16, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn i32WithoutTypeChecks(
        _: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) i32, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }
    pub fn intptrWithoutTypeChecks(
        _: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }

    pub fn f32WithoutTypeChecks(
        _: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) f32, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }

    pub fn f64WithoutTypeChecks(
        _: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) f64, @ptrFromInt(addr)).*;
        return JSValue.jsNumber(value);
    }

    pub fn u64WithoutTypeChecks(
        global: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
        return JSValue.fromUInt64NoTruncate(global, value);
    }

    pub fn i64WithoutTypeChecks(
        global: *JSGlobalObject,
        _: *anyopaque,
        raw_addr: i64,
        offset: i32,
    ) callconv(JSC.conv) JSValue {
        const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
        const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
        return JSValue.fromInt64NoTruncate(global, value);
    }
};

pub fn ptr(
    globalThis: *JSGlobalObject,
    _: JSValue,
    arguments: []const JSValue,
) JSValue {
    return switch (arguments.len) {
        0 => ptr_(globalThis, JSValue.zero, null),
        1 => ptr_(globalThis, arguments[0], null),
        else => ptr_(globalThis, arguments[0], arguments[1]),
    };
}

pub fn ptrWithoutTypeChecks(
    _: *JSGlobalObject,
    _: *anyopaque,
    array: *JSC.JSUint8Array,
) callconv(JSC.conv) JSValue {
    return JSValue.fromPtrAddress(@intFromPtr(array.ptr()));
}

fn ptr_(
    globalThis: *JSGlobalObject,
    value: JSValue,
    byteOffset: ?JSValue,
) JSValue {
    if (value == .zero) {
        return JSC.JSValue.jsNull();
    }

    const array_buffer = value.asArrayBuffer(globalThis) orelse {
        return JSC.toInvalidArguments("Expected ArrayBufferView but received {s}", .{@tagName(value.jsType())}, globalThis);
    };

    if (array_buffer.len == 0) {
        return JSC.toInvalidArguments("ArrayBufferView must have a length > 0. A pointer to empty memory doesn't work", .{}, globalThis);
    }

    var addr: usize = @intFromPtr(array_buffer.ptr);
    // const Sizes = @import("../bindings/sizes.zig");
    // assert(addr == @intFromPtr(value.asEncoded().ptr) + Sizes.Bun_FFI_PointerOffsetToTypedArrayVector);

    if (byteOffset) |off| {
        if (!off.isEmptyOrUndefinedOrNull()) {
            if (!off.isNumber()) {
                return JSC.toInvalidArguments("Expected number for byteOffset", .{}, globalThis);
            }
        }

        const bytei64 = off.toInt64();
        if (bytei64 < 0) {
            addr -|= @as(usize, @intCast(bytei64 * -1));
        } else {
            addr += @as(usize, @intCast(bytei64));
        }

        if (addr > @intFromPtr(array_buffer.ptr) + @as(usize, array_buffer.byte_len)) {
            return JSC.toInvalidArguments("byteOffset out of bounds", .{}, globalThis);
        }
    }

    if (addr > max_addressable_memory) {
        return JSC.toInvalidArguments("Pointer is outside max addressible memory, which usually means a bug in your program.", .{}, globalThis);
    }

    if (addr == 0) {
        return JSC.toInvalidArguments("Pointer must not be 0", .{}, globalThis);
    }

    if (addr == 0xDEADBEEF or addr == 0xaaaaaaaa or addr == 0xAAAAAAAA) {
        return JSC.toInvalidArguments("ptr to invalid memory, that would segfault Bun :(", .{}, globalThis);
    }

    if (comptime Environment.allow_assert) {
        assert(JSC.JSValue.fromPtrAddress(addr).asPtrAddress() == addr);
    }

    return JSC.JSValue.fromPtrAddress(addr);
}

const ValueOrError = union(enum) {
    err: JSValue,
    slice: []u8,
};

pub fn getPtrSlice(globalThis: *JSGlobalObject, value: JSValue, byteOffset: ?JSValue, byteLength: ?JSValue) ValueOrError {
    if (!value.isNumber()) {
        return .{ .err = JSC.toInvalidArguments("ptr must be a number.", .{}, globalThis) };
    }

    const num = value.asPtrAddress();
    if (num == 0) {
        return .{ .err = JSC.toInvalidArguments("ptr cannot be zero, that would segfault Bun :(", .{}, globalThis) };
    }

    // if (!std.math.isFinite(num)) {
    //     return .{ .err = JSC.toInvalidArguments("ptr must be a finite number.", .{}, globalThis) };
    // }

    var addr = @as(usize, @bitCast(num));

    if (byteOffset) |byte_off| {
        if (byte_off.isNumber()) {
            const off = byte_off.toInt64();
            if (off < 0) {
                addr -|= @as(usize, @intCast(off * -1));
            } else {
                addr +|= @as(usize, @intCast(off));
            }

            if (addr == 0) {
                return .{ .err = JSC.toInvalidArguments("ptr cannot be zero, that would segfault Bun :(", .{}, globalThis) };
            }

            if (!std.math.isFinite(byte_off.asNumber())) {
                return .{ .err = JSC.toInvalidArguments("ptr must be a finite number.", .{}, globalThis) };
            }
        } else if (!byte_off.isEmptyOrUndefinedOrNull()) {
            // do nothing
        } else {
            return .{ .err = JSC.toInvalidArguments("Expected number for byteOffset", .{}, globalThis) };
        }
    }

    if (addr == 0xDEADBEEF or addr == 0xaaaaaaaa or addr == 0xAAAAAAAA) {
        return .{ .err = JSC.toInvalidArguments("ptr to invalid memory, that would segfault Bun :(", .{}, globalThis) };
    }

    if (byteLength) |valueLength| {
        if (!valueLength.isEmptyOrUndefinedOrNull()) {
            if (!valueLength.isNumber()) {
                return .{ .err = JSC.toInvalidArguments("length must be a number.", .{}, globalThis) };
            }

            if (valueLength.asNumber() == 0.0) {
                return .{ .err = JSC.toInvalidArguments("length must be > 0. This usually means a bug in your code.", .{}, globalThis) };
            }

            const length_i = valueLength.toInt64();
            if (length_i < 0) {
                return .{ .err = JSC.toInvalidArguments("length must be > 0. This usually means a bug in your code.", .{}, globalThis) };
            }

            if (length_i > max_addressable_memory) {
                return .{ .err = JSC.toInvalidArguments("length exceeds max addressable memory. This usually means a bug in your code.", .{}, globalThis) };
            }

            const length = @as(usize, @intCast(length_i));
            return .{ .slice = @as([*]u8, @ptrFromInt(addr))[0..length] };
        }
    }

    return .{ .slice = bun.span(@as([*:0]u8, @ptrFromInt(addr))) };
}

fn getCPtr(value: JSValue) ?usize {
    // pointer to C function
    if (value.isNumber()) {
        const addr = value.asPtrAddress();
        if (addr > 0) return addr;
    } else if (value.isBigInt()) {
        const addr = @as(u64, @bitCast(value.toUInt64NoTruncate()));
        if (addr > 0) {
            return addr;
        }
    }

    return null;
}

pub fn toArrayBuffer(
    globalThis: *JSGlobalObject,
    value: JSValue,
    byteOffset: ?JSValue,
    valueLength: ?JSValue,
    finalizationCtxOrPtr: ?JSValue,
    finalizationCallback: ?JSValue,
) JSC.JSValue {
    switch (getPtrSlice(globalThis, value, byteOffset, valueLength)) {
        .err => |erro| {
            return erro;
        },
        .slice => |slice| {
            var callback: JSC.C.JSTypedArrayBytesDeallocator = null;
            var ctx: ?*anyopaque = null;
            if (finalizationCallback) |callback_value| {
                if (getCPtr(callback_value)) |callback_ptr| {
                    callback = @as(JSC.C.JSTypedArrayBytesDeallocator, @ptrFromInt(callback_ptr));

                    if (finalizationCtxOrPtr) |ctx_value| {
                        if (getCPtr(ctx_value)) |ctx_ptr| {
                            ctx = @as(*anyopaque, @ptrFromInt(ctx_ptr));
                        } else if (!ctx_value.isUndefinedOrNull()) {
                            return JSC.toInvalidArguments("Expected user data to be a C pointer (number or BigInt)", .{}, globalThis);
                        }
                    }
                } else if (!callback_value.isEmptyOrUndefinedOrNull()) {
                    return JSC.toInvalidArguments("Expected callback to be a C pointer (number or BigInt)", .{}, globalThis);
                }
            } else if (finalizationCtxOrPtr) |callback_value| {
                if (getCPtr(callback_value)) |callback_ptr| {
                    callback = @as(JSC.C.JSTypedArrayBytesDeallocator, @ptrFromInt(callback_ptr));
                } else if (!callback_value.isEmptyOrUndefinedOrNull()) {
                    return JSC.toInvalidArguments("Expected callback to be a C pointer (number or BigInt)", .{}, globalThis);
                }
            }

            return JSC.ArrayBuffer.fromBytes(slice, JSC.JSValue.JSType.ArrayBuffer).toJSWithContext(globalThis, ctx, callback, null);
        },
    }
}

pub fn toBuffer(
    globalThis: *JSGlobalObject,
    value: JSValue,
    byteOffset: ?JSValue,
    valueLength: ?JSValue,
    finalizationCtxOrPtr: ?JSValue,
    finalizationCallback: ?JSValue,
) JSC.JSValue {
    switch (getPtrSlice(globalThis, value, byteOffset, valueLength)) {
        .err => |err| {
            return err;
        },
        .slice => |slice| {
            var callback: JSC.C.JSTypedArrayBytesDeallocator = null;
            var ctx: ?*anyopaque = null;
            if (finalizationCallback) |callback_value| {
                if (getCPtr(callback_value)) |callback_ptr| {
                    callback = @as(JSC.C.JSTypedArrayBytesDeallocator, @ptrFromInt(callback_ptr));

                    if (finalizationCtxOrPtr) |ctx_value| {
                        if (getCPtr(ctx_value)) |ctx_ptr| {
                            ctx = @as(*anyopaque, @ptrFromInt(ctx_ptr));
                        } else if (!ctx_value.isEmptyOrUndefinedOrNull()) {
                            return JSC.toInvalidArguments("Expected user data to be a C pointer (number or BigInt)", .{}, globalThis);
                        }
                    }
                } else if (!callback_value.isEmptyOrUndefinedOrNull()) {
                    return JSC.toInvalidArguments("Expected callback to be a C pointer (number or BigInt)", .{}, globalThis);
                }
            } else if (finalizationCtxOrPtr) |callback_value| {
                if (getCPtr(callback_value)) |callback_ptr| {
                    callback = @as(JSC.C.JSTypedArrayBytesDeallocator, @ptrFromInt(callback_ptr));
                } else if (!callback_value.isEmptyOrUndefinedOrNull()) {
                    return JSC.toInvalidArguments("Expected callback to be a C pointer (number or BigInt)", .{}, globalThis);
                }
            }

            if (callback != null or ctx != null) {
                return JSC.JSValue.createBufferWithCtx(globalThis, slice, ctx, callback);
            }

            return JSC.JSValue.createBuffer(globalThis, slice, null);
        },
    }
}

pub fn toCStringBuffer(
    globalThis: *JSGlobalObject,
    value: JSValue,
    byteOffset: ?JSValue,
    valueLength: ?JSValue,
) JSC.JSValue {
    switch (getPtrSlice(globalThis, value, byteOffset, valueLength)) {
        .err => |err| {
            return err;
        },
        .slice => |slice| {
            return JSC.JSValue.createBuffer(globalThis, slice, null);
        },
    }
}

pub fn getter(
    globalObject: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    return FFIObject.toJS(globalObject);
}

const fields = .{
    .viewSource = JSC.wrapStaticMethod(
        JSC.FFI,
        "print",
        false,
    ),
    .dlopen = JSC.wrapStaticMethod(JSC.FFI, "open", false),
    .callback = JSC.wrapStaticMethod(JSC.FFI, "callback", false),
    .linkSymbols = JSC.wrapStaticMethod(JSC.FFI, "linkSymbols", false),
    .toBuffer = JSC.wrapStaticMethod(@This(), "toBuffer", false),
    .toArrayBuffer = JSC.wrapStaticMethod(@This(), "toArrayBuffer", false),
    .closeCallback = JSC.wrapStaticMethod(JSC.FFI, "closeCallback", false),
    .CString = JSC.wrapStaticMethod(Bun.FFIObject, "newCString", false),
};
const max_addressable_memory = std.math.maxInt(u56);

const JSGlobalObject = JSC.JSGlobalObject;
const JSObject = JSC.JSObject;
const JSValue = JSC.JSValue;
const JSC = bun.JSC;
const bun = @import("root").bun;
const FFIObject = @This();
const Bun = JSC.API.Bun;

const Environment = bun.Environment;
const std = @import("std");
const assert = bun.assert;
const ZigString = JSC.ZigString;
