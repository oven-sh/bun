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
    pub const toJS = @import("../http_jsc/fetch_enums_jsc.zig").fetchCacheModeToJS;
};

const bun = @import("bun");
