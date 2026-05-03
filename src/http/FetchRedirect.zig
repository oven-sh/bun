pub const FetchRedirect = enum(u2) {
    follow,
    manual,
    @"error",

    pub const Map = bun.ComptimeStringMap(FetchRedirect, .{
        .{ "follow", .follow },
        .{ "manual", .manual },
        .{ "error", .@"error" },
    });

    extern "c" fn Bun__FetchRedirect__toJS(redirect: u8, globalObject: *jsc.JSGlobalObject) jsc.JSValue;
    pub inline fn toJS(this: FetchRedirect, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        return Bun__FetchRedirect__toJS(@intFromEnum(this), globalObject);
    }
};

const bun = @import("bun");
const jsc = bun.jsc;
