/// https://developer.mozilla.org/en-US/docs/Web/API/Request/cache
pub const FetchCacheMode = enum(u3) {
    default,
    @"no-store",
    reload,
    @"no-cache",
    @"force-cache",
    @"only-if-cached",

    pub const Map = bun.ComptimeStringMap(FetchCacheMode, .{
        .{ "default", .default },
        .{ "no-store", .@"no-store" },
        .{ "reload", .reload },
        .{ "no-cache", .@"no-cache" },
        .{ "force-cache", .@"force-cache" },
        .{ "only-if-cached", .@"only-if-cached" },
    });

    extern "c" fn Bun__FetchCacheMode__toJS(cache: u8, globalObject: *jsc.JSGlobalObject) jsc.JSValue;
    pub inline fn toJS(this: FetchCacheMode, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        return Bun__FetchCacheMode__toJS(@intFromEnum(this), globalObject);
    }
};

const bun = @import("bun");
const jsc = bun.jsc;
