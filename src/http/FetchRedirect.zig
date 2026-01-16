pub const FetchRedirect = enum(u2) {
    follow,
    manual,
    @"error",

    pub const Map = bun.ComptimeStringMap(FetchRedirect, .{
        .{ "follow", .follow },
        .{ "manual", .manual },
        .{ "error", .@"error" },
    });
};

const bun = @import("bun");
