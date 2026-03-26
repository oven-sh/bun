/// https://developer.mozilla.org/en-US/docs/Web/API/Request/mode
pub const FetchRequestMode = enum(u2) {
    @"same-origin",
    @"no-cors",
    cors,
    navigate,

    pub const Map = bun.ComptimeStringMap(FetchRequestMode, .{
        .{ "same-origin", .@"same-origin" },
        .{ "no-cors", .@"no-cors" },
        .{ "cors", .cors },
        .{ "navigate", .navigate },
    });
};

const bun = @import("bun");
