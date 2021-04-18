const std = @import("std");
const strings = @import("strings.zig");
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

    pub fn init(_path: []u8) PathName {
        var path = _path;
        var base: []u8 = path;
        var dir: []u8 = path;
        var ext: []u8 = path;

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
    pretty_path: []u8,
    text: []u8,
    namespace: []u8,
    path_disabled: []u8,

    pub fn isBefore(a: *Path, b: Path) bool {
        return a.namespace > b.namespace ||
            (a.namespace == b.namespace and (a.text < b.text ||
            (a.text == b.text and (a.flags < b.flags ||
            (a.flags == b.flags)))));
    }
};

test "PathName.init" {
    var file = "/root/directory/file.ext".*;
    const res = PathName.init(&file);
    std.testing.expectEqualStrings(res.dir, "/root/directory");
    std.testing.expectEqualStrings(res.base, "file");
    std.testing.expectEqualStrings(res.ext, ".ext");
}
