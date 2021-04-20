const std = @import("std");

usingnamespace @import("strings.zig");

const alloc = @import("alloc.zig");
const expect = std.testing.expect;

// pub const FilesystemImplementation = @import("fs_impl.zig");

pub const FileSystem = struct { tree: std.AutoHashMap(FileSystemEntry) };

pub const FileSystemEntry = union(enum) {
    file: File,
    directory: Directory,
};

pub const File = struct {
    path: Path,
    mtime: ?usize,
    contents: ?string,
};
pub const Directory = struct { path: Path, mtime: ?usize, contents: []FileSystemEntry };

pub const PathName = struct {
    base: string,
    dir: string,
    ext: string,

    // For readability, the names of certain automatically-generated symbols are
    // derived from the file name. For example, instead of the CommonJS wrapper for
    // a file being called something like "require273" it can be called something
    // like "require_react" instead. This function generates the part of these
    // identifiers that's specific to the file path. It can take both an absolute
    // path (OS-specific) and a path in the source code (OS-independent).
    //
    // Note that these generated names do not at all relate to the correctness of
    // the code as far as avoiding symbol name collisions. These names still go
    // through the renaming logic that all other symbols go through to avoid name
    // collisions.
    pub fn nonUniqueNameString(self: *PathName, allocator: *std.mem.Allocator) !string {
        if (strings.eql("index", self.base)) {
            if (self.dir.len > 0) {
                return MutableString.ensureValidIdentifier(PathName.init(self.dir), allocator);
            }
        }

        return MutableString.ensureValidIdentifier(self.base, allocator);
    }

    pub fn init(_path: string) PathName {
        var path = _path;
        var base = path;
        var ext = path;
        var dir = path;

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
    pretty_path: string,
    text: string,
    namespace: string,
    name: PathName,

    pub fn init(text: string) Path {
        return Path{ .pretty_path = text, .text = text, .namespace = "file", .name = PathName.init(text) };
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
    const res = PathName.init(
        &file,
    );
    std.testing.expectEqualStrings(res.dir, "/root/directory");
    std.testing.expectEqualStrings(res.base, "file");
    std.testing.expectEqualStrings(res.ext, ".ext");
}
