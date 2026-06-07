pub const URLSearchParams = opaque {
    extern fn URLSearchParams__create(globalObject: *JSGlobalObject, *const ZigString) JSValue;
    pub fn create(globalObject: *JSGlobalObject, init: ZigString) JSValue {
        jsc.markBinding(@src());
        return URLSearchParams__create(globalObject, &init);
    }

    extern fn URLSearchParams__fromJS(JSValue) ?*URLSearchParams;
    pub fn fromJS(value: JSValue) ?*URLSearchParams {
        jsc.markBinding(@src());
        return URLSearchParams__fromJS(value);
    }

    extern fn URLSearchParams__toString(
        self: *URLSearchParams,
        ctx: *anyopaque,
        callback: *const fn (ctx: *anyopaque, str: *const ZigString) callconv(.c) void,
    ) void;

    pub fn toString(
        self: *URLSearchParams,
        comptime Ctx: type,
        ctx: *Ctx,
        comptime callback: *const fn (ctx: *Ctx, str: ZigString) void,
    ) void {
        jsc.markBinding(@src());
        const Wrap = struct {
            const cb_ = callback;
            pub fn cb(c: *anyopaque, str: *const ZigString) callconv(.c) void {
                cb_(
                    bun.cast(*Ctx, c),
                    str.*,
                );
            }
        };

        URLSearchParams__toString(self, ctx, Wrap.cb);
    }
};

const bun = @import("bun");
const ZigString = @import("./ZigString.zig").ZigString;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
