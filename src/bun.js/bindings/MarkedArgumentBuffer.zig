pub const MarkedArgumentBuffer = opaque {
    extern fn MarkedArgumentBuffer__append(args: *MarkedArgumentBuffer, value: JSValue) callconv(.c) void;
    pub fn append(this: *MarkedArgumentBuffer, value: JSValue) void {
        MarkedArgumentBuffer__append(this, value);
    }

    extern fn MarkedArgumentBuffer__run(ctx: *anyopaque, *const fn (ctx: *anyopaque, args: *anyopaque) callconv(.c) void) void;
    pub fn run(comptime T: type, ctx: *T, func: *const fn (ctx: *T, args: *MarkedArgumentBuffer) callconv(.c) void) void {
        MarkedArgumentBuffer__run(@ptrCast(ctx), @ptrCast(func));
    }
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
