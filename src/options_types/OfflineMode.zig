pub const OfflineMode = enum {
    online,
    latest,
    offline,
};

pub const Prefer = bun.ComptimeStringMap(OfflineMode, .{
    &.{ "offline", OfflineMode.offline },
    &.{ "latest", OfflineMode.latest },
    &.{ "online", OfflineMode.online },
});

const bun = @import("bun");
