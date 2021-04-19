const std = @import("std");
const strings = @import("strings.zig");
const alloc = @import("alloc.zig");
const expect = std.testing.expect;

pub const FileSystem = struct { tree: std.AutoHashMap(FileSystemEntry) };

pub const FileSystemEntry = union(enum) {
    file: File,
    directory: Directory,
};

pub const File = struct { path: Path, mtime: ?usize, contents: ?[]u8 };
pub const Directory = struct { path: Path, mtime: ?usize, contents: []FileSystemEntry };

pub const PathName = struct {
    base: []u8,
    dir: []u8,
    ext: []u8,

    pub fn init(_path: []const u8, allocator: *std.mem.Allocator) PathName {
        // TODO: leak.
        var path: []u8 = allocator.alloc(u8, _path.len) catch unreachable;
        std.mem.copy(u8, path, _path);

        var base = path;
        var dir = path;
        var ext = path;

        var _i = strings.lastIndexOfChar(path, '/');
        while (_i) |i| {
            // Stop if we found a non-trailing slash
            if (i + 1 != path.len) {
                base = path[i + 1 ..];
                dir = path[0..i];
                break;
            }

            // Ignore trailing slashes
            path = path[0..i];

            _i = strings.lastIndexOfChar(path, '/');
        }

        // Strip off the extension
        var _dot = strings.lastIndexOfChar(base, '.');
        if (_dot) |dot| {
            ext = base[dot..];
            base = base[0..dot];
        }

        return PathName{
            .dir = dir,
            .base = base,
            .ext = ext,
        };
    }
};

pub const Path = struct {
    pretty_path: []const u8,
    text: []const u8,
    namespace: []const u8,
    name: PathName,

    pub fn init(text: []const u8, allocator: *std.mem.Allocator) Path {
        return Path{ .pretty_path = text, .text = text, .namespace = "file", .name = PathName.init(text, allocator) };
    }

    pub fn isBefore(a: *Path, b: Path) bool {
        return a.namespace > b.namespace ||
            (a.namespace == b.namespace and (a.text < b.text ||
            (a.text == b.text and (a.flags < b.flags ||
            (a.flags == b.flags)))));
    }
};

test "PathName.init" {
    var file = "/root/directory/file.ext".*;
    const res = PathName.init(&file, std.heap.page_allocator);
    std.testing.expectEqualStrings(res.dir, "/root/directory");
    std.testing.expectEqualStrings(res.base, "file");
    std.testing.expectEqualStrings(res.ext, ".ext");
}
