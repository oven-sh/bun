usingnamespace @import("./global.zig");

const std = @import("std");

pub const NPMClient = struct {
    bin: string,
    tag: Tag,

    pub const Tag = enum {
        bun,
    };

    pub fn detect(allocator: *std.mem.Allocator, realpath_buf: *[std.fs.MAX_PATH_BYTES]u8, PATH: string, cwd: string, comptime allow_yarn: bool) !NPMClient {
      
    }
};
