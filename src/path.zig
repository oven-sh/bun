const std = @import("std");
const bun = @import("root").bun;

const os = bun.Environment.os;
const strings = bun.strings;

pub fn isRelativePathCrossPlatform(path: []const u8) bool {
    return switch (path.len) {
        0 => false,
        1 => path[0] == '.',
        // "./" is valid on all platforms, and ".\" is valid on Windows only
        // 2 => if (os != .windows)
        //     strings.eqlComptime(path, "./")
        // else
        //     path[0] == '.' and strings.charIsAnySlash(path[1]),
        2 => switch (os) {
            .windows => path[0] == '.' and strings.charIsAnySlash(path[1]),
            else => strings.eqlComptime(path, "./"),
        },
        // same as above but with "../" and "..\"
        else => switch (os) {
            .windows => strings.eqlComptime(path[0..2], "..") and strings.charIsAnySlash(path[2]),
            else => strings.eqlComptime(path, "../"),
        },
    };
}
