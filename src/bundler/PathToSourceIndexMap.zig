const PathToSourceIndexMap = @This();

/// The lifetime of the keys are not owned by this map.
///
/// We assume it's arena allocated.
map: Map = .{},

/// Cache key that combines path and loader to differentiate
/// the same file imported with different import attributes.
pub const CacheKey = struct {
    path: []const u8,
    loader: options.Loader,

    pub fn hash(self: CacheKey, hasher: anytype) void {
        hasher.update(self.path);
        hasher.update(std.mem.asBytes(&self.loader));
    }

    pub fn eql(a: CacheKey, b: CacheKey, comptime _: @TypeOf(.{})) bool {
        return a.loader == b.loader and bun.strings.eql(a.path, b.path);
    }
};

const CacheKeyContext = struct {
    pub fn hash(_: @This(), key: CacheKey) u32 {
        var hasher = std.hash.Wyhash.init(0);
        key.hash(&hasher);
        return @truncate(hasher.final());
    }

    pub fn eql(_: @This(), a: CacheKey, b: CacheKey) bool {
        return CacheKey.eql(a, b, .{});
    }
};

const Map = std.HashMapUnmanaged(CacheKey, Index.Int, CacheKeyContext, std.hash_map.default_max_load_percentage);

pub fn getPath(this: *const PathToSourceIndexMap, path: *const Fs.Path, loader: options.Loader) ?Index.Int {
    return this.get(path.text, loader);
}

pub fn get(this: *const PathToSourceIndexMap, text: []const u8, loader: options.Loader) ?Index.Int {
    return this.map.get(.{ .path = text, .loader = loader });
}

pub fn putPath(this: *PathToSourceIndexMap, allocator: std.mem.Allocator, path: *const Fs.Path, loader: options.Loader, value: Index.Int) bun.OOM!void {
    try this.put(allocator, path.text, loader, value);
}

pub fn put(this: *PathToSourceIndexMap, allocator: std.mem.Allocator, text: []const u8, loader: options.Loader, value: Index.Int) bun.OOM!void {
    try this.map.put(allocator, .{ .path = text, .loader = loader }, value);
}

pub fn getOrPutPath(this: *PathToSourceIndexMap, allocator: std.mem.Allocator, path: *const Fs.Path, loader: options.Loader) bun.OOM!Map.GetOrPutResult {
    return this.getOrPut(allocator, path.text, loader);
}

pub fn getOrPut(this: *PathToSourceIndexMap, allocator: std.mem.Allocator, text: []const u8, loader: options.Loader) bun.OOM!Map.GetOrPutResult {
    return try this.map.getOrPut(allocator, .{ .path = text, .loader = loader });
}

pub fn remove(this: *PathToSourceIndexMap, text: []const u8, loader: options.Loader) bool {
    return this.map.remove(.{ .path = text, .loader = loader });
}

pub fn removePath(this: *PathToSourceIndexMap, path: *const Fs.Path, loader: options.Loader) bool {
    return this.remove(path.text, loader);
}

const std = @import("std");

const bun = @import("bun");
const Fs = bun.fs;
const Index = bun.ast.Index;
const options = bun.options;
