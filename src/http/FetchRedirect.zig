pub const FetchRedirect = enum(u8) {
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
