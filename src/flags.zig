const std = @import("std");

pub const isWasm = std.Target.Os.Tag.freestanding == std.Target.current.os.tag;
