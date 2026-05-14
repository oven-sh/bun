pub const MarkedArgumentBuffer = opaque {
    extern fn MarkedArgumentBuffer__append(args: *MarkedArgumentBuffer, value: JSValue) callconv(.c) void;
    pub fn append(this: *MarkedArgumentBuffer, value: JSValue) void {
        MarkedArgumentBuffer__append(this, value);
    }

    extern fn MarkedArgumentBuffer__run(ctx: *anyopaque, *const fn (ctx: *anyopaque, args: *anyopaque) callconv(.c) void) void;
    pub fn run(comptime T: type, ctx: *T, func: *const fn (ctx: *T, args: *MarkedArgumentBuffer) callconv(.c) void) void {
        MarkedArgumentBuffer__run(@ptrCast(ctx), @ptrCast(func));
    }

    pub fn wrap(comptime function: *const fn (globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, marked_argument_buffer: *MarkedArgumentBuffer) bun.JSError!jsc.JSValue) jsc.JSHostFnZig {
        return struct {
            pub fn wrapper(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
                const Context = struct {
                    result: bun.JSError!jsc.JSValue,
                    globalThis: *jsc.JSGlobalObject,
                    callframe: *jsc.CallFrame,
                    pub fn run(this: *@This(), marked_argument_buffer: *MarkedArgumentBuffer) callconv(.c) void {
                        this.result = function(this.globalThis, this.callframe, marked_argument_buffer);
                    }
                };

                var ctx = Context{
                    .globalThis = globalThis,
                    .callframe = callframe,
                    .result = undefined,
                };
                jsc.MarkedArgumentBuffer.run(Context, &ctx, &Context.run);
                return try ctx.result;
            }
        }.wrapper;
    }
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
