const std = @import("std");

pub const fixtures = std.ComptimeStringMap([]u8, .{
    .{ "package.json", @embedFile("./fixtures/package.json") },
    .{ "tsconfig.json", @embedFile("./fixtures/tsconfig.json") },
    .{ "simple-component.js", @embedFile("./fixtures/simple-component.js") },
    .{ "simple-component.tsx", @embedFile("./fixtures/simple-component.tsx") },
    .{ "simple-component.tsx", @embedFile("./fixtures/simple-component.tsx") },
});
