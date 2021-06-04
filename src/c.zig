const std = @import("std");

pub usingnamespace switch (std.Target.current.os.tag) {
    .macos => @import("./darwin_c.zig"),
    else => struct {},
};
