const PathToSourceIndexMap = @This();

/// The lifetime of the keys are not owned by this map.
///
/// We assume it's arena allocated.
map: Map = .{},

/// HashMap context that makes path lookups namespace-aware.
/// For file namespace, uses only path.text for backwards compatibility.
/// For other namespaces, combines namespace and path in the hash.
const PathHashContext = struct {
    pub fn hash(_: @This(), path: Fs.Path) u64 {
        return path.hashKey();
    }

    pub fn eql(_: @This(), a: Fs.Path, b: Fs.Path) bool {
        // For file namespace, only compare path text
        if (a.isFile() and b.isFile()) {
            return bun.strings.eqlLong(a.text, b.text, true);
        }

        // For non-file namespaces, compare both namespace and path
        return bun.strings.eqlLong(a.namespace, b.namespace, true) and
            bun.strings.eqlLong(a.text, b.text, true);
    }
};

const Map = std.HashMapUnmanaged(Fs.Path, Index.Int, PathHashContext, std.hash_map.default_max_load_percentage);

pub fn getPath(this: *const PathToSourceIndexMap, path: *const Fs.Path) ?Index.Int {
    return this.map.get(path.*);
}

pub fn get(this: *const PathToSourceIndexMap, text: []const u8) ?Index.Int {
    const file_path = Fs.Path.init(text);
    return this.map.get(file_path);
}

pub fn putPath(this: *PathToSourceIndexMap, allocator: std.mem.Allocator, path: *const Fs.Path, value: Index.Int) bun.OOM!void {
    try this.map.put(allocator, path.*, value);
}

pub fn put(this: *PathToSourceIndexMap, allocator: std.mem.Allocator, text: []const u8, value: Index.Int) bun.OOM!void {
    const file_path = Fs.Path.init(text);
    try this.map.put(allocator, file_path, value);
}

pub fn getOrPutPath(this: *PathToSourceIndexMap, allocator: std.mem.Allocator, path: *const Fs.Path) bun.OOM!Map.GetOrPutResult {
    return try this.map.getOrPut(allocator, path.*);
}

pub fn getOrPut(this: *PathToSourceIndexMap, allocator: std.mem.Allocator, text: []const u8) bun.OOM!Map.GetOrPutResult {
    const file_path = Fs.Path.init(text);
    return try this.map.getOrPut(allocator, file_path);
}

pub fn remove(this: *PathToSourceIndexMap, text: []const u8) bool {
    const file_path = Fs.Path.init(text);
    return this.map.remove(file_path);
}

pub fn removePath(this: *PathToSourceIndexMap, path: *const Fs.Path) bool {
    return this.map.remove(path.*);
}

const std = @import("std");

const bun = @import("bun");
const Fs = bun.fs;
const Index = bun.ast.Index;
