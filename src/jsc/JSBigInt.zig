pub const JSBigInt = opaque {
    extern fn JSC__JSBigInt__fromJS(JSValue) ?*JSBigInt;
    pub fn fromJS(value: JSValue) ?*JSBigInt {
        return JSC__JSBigInt__fromJS(value);
    }

    extern fn JSC__JSBigInt__orderDouble(*JSBigInt, f64) i8;
    extern fn JSC__JSBigInt__orderUint64(*JSBigInt, u64) i8;
    extern fn JSC__JSBigInt__orderInt64(*JSBigInt, i64) i8;
    pub fn order(this: *JSBigInt, comptime T: type, num: T) std.math.Order {
        const result = switch (T) {
            f64 => brk: {
                bun.debugAssert(!std.math.isNan(num));
                break :brk JSC__JSBigInt__orderDouble(this, num);
            },
            u64 => JSC__JSBigInt__orderUint64(this, num),
            i64 => JSC__JSBigInt__orderInt64(this, num),
            else => @compileError("Unsupported BigInt.order type"),
        };
        if (result == 0) return .eq;
        if (result < 0) return .lt;
        return .gt;
    }

    extern fn JSC__JSBigInt__toInt64(*JSBigInt) i64;
    pub fn toInt64(this: *JSBigInt) i64 {
        return JSC__JSBigInt__toInt64(this);
    }

    extern fn JSC__JSBigInt__toString(*JSBigInt, *JSGlobalObject) bun.String;
    pub fn toString(this: *JSBigInt, global: *JSGlobalObject) JSError!bun.String {
        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSBigInt__toString, .{ this, global });
    }
};

const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;
const String = bun.String;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
