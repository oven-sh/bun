const std = @import("std");
const Allocator = std.mem.Allocator;
const Walker = @This();
const path = std.fs.path;

stack: std.ArrayList(StackItem),
name_buffer: std.ArrayList(u8),
skip_filenames: []const u64 = &[_]u64{},
skip_dirnames: []const u64 = &[_]u64{},
skip_all: []const u64 = &[_]u64{},
seed: u64 = 0,

const Dir = std.fs.Dir;

pub const WalkerEntry = struct {
    /// The containing directory. This can be used to operate directly on `basename`
    /// rather than `path`, avoiding `error.NameTooLong` for deeply nested paths.
    /// The directory remains open until `next` or `deinit` is called.
    dir: Dir,
    basename: []const u8,
    path: []const u8,
    kind: Dir.Entry.Kind,
};

const StackItem = struct {
    iter: Dir.Iterator,
    dirname_len: usize,
};

/// After each call to this function, and on deinit(), the memory returned
/// from this function becomes invalid. A copy must be made in order to keep
/// a reference to the path.
pub fn next(self: *Walker) !?WalkerEntry {
    while (self.stack.items.len != 0) {
        // `top` becomes invalid after appending to `self.stack`
        var top = &self.stack.items[self.stack.items.len - 1];
        var dirname_len = top.dirname_len;
        if (try top.iter.next()) |base| {
            switch (base.kind) {
                .Directory => {
                    if (std.mem.indexOfScalar(
                        u64,
                        self.skip_dirnames,
                        // avoid hashing if there will be 0 results
                        if (self.skip_dirnames.len > 0) std.hash.Wyhash.hash(self.seed, base.name) else 0,
                    ) != null) continue;
                },
                .File => {
                    if (std.mem.indexOfScalar(
                        u64,
                        self.skip_filenames,
                        // avoid hashing if there will be 0 results
                        if (self.skip_filenames.len > 0) std.hash.Wyhash.hash(self.seed, base.name) else 0,
                    ) != null) continue;
                },

                // we don't know what it is for a symlink
                .SymLink => {
                    if (std.mem.indexOfScalar(
                        u64,
                        self.skip_all,
                        // avoid hashing if there will be 0 results
                        if (self.skip_all.len > 0) std.hash.Wyhash.hash(self.seed, base.name) else 0,
                    ) != null) continue;
                },

                else => {},
            }

            self.name_buffer.shrinkRetainingCapacity(dirname_len);
            if (self.name_buffer.items.len != 0) {
                try self.name_buffer.append(path.sep);
                dirname_len += 1;
            }
            try self.name_buffer.appendSlice(base.name);
            const cur_len = self.name_buffer.items.len;
            try self.name_buffer.append(0);
            self.name_buffer.shrinkRetainingCapacity(cur_len);

            if (base.kind == .Directory) {
                var new_dir = top.iter.dir.openDir(base.name, .{ .iterate = true }) catch |err| switch (err) {
                    error.NameTooLong => unreachable, // no path sep in base.name
                    else => |e| return e,
                };
                {
                    errdefer new_dir.close();
                    try self.stack.append(StackItem{
                        .iter = new_dir.iterate(),
                        .dirname_len = self.name_buffer.items.len,
                    });
                    top = &self.stack.items[self.stack.items.len - 1];
                }
            }
            return WalkerEntry{
                .dir = top.iter.dir,
                .basename = self.name_buffer.items[dirname_len..],
                .path = self.name_buffer.items,
                .kind = base.kind,
            };
        } else {
            var item = self.stack.pop();
            if (self.stack.items.len != 0) {
                item.iter.dir.close();
            }
        }
    }
    return null;
}

pub fn deinit(self: *Walker) void {
    while (self.stack.popOrNull()) |*item| {
        if (self.stack.items.len != 0) {
            item.iter.dir.close();
        }
    }
    self.stack.deinit();
    self.name_buffer.allocator.free(self.skip_all);
    self.name_buffer.deinit();
}

/// Recursively iterates over a directory.
/// `self` must have been opened with `OpenDirOptions{.iterate = true}`.
/// Must call `Walker.deinit` when done.
/// The order of returned file system entries is undefined.
/// `self` will not be closed after walking it.
pub fn walk(
    self: Dir,
    allocator: Allocator,
    skip_filenames: []const []const u8,
    skip_dirnames: []const []const u8,
) !Walker {
    var name_buffer = std.ArrayList(u8).init(allocator);
    errdefer name_buffer.deinit();

    var stack = std.ArrayList(Walker.StackItem).init(allocator);
    errdefer stack.deinit();

    var skip_names = try allocator.alloc(u64, skip_filenames.len + skip_dirnames.len);
    const seed = skip_filenames.len + skip_dirnames.len;
    var skip_name_i: usize = 0;

    for (skip_filenames) |name| {
        skip_names[skip_name_i] = std.hash.Wyhash.hash(seed, name);
        skip_name_i += 1;
    }
    var skip_filenames_ = skip_names[0..skip_name_i];
    var skip_dirnames_ = skip_names[skip_name_i..];

    for (skip_dirnames) |name, i| {
        skip_dirnames_[i] = std.hash.Wyhash.hash(seed, name);
    }

    try stack.append(Walker.StackItem{
        .iter = self.iterate(),
        .dirname_len = 0,
    });

    return Walker{
        .stack = stack,
        .name_buffer = name_buffer,
        .skip_all = skip_names,
        .seed = seed,
        .skip_filenames = skip_filenames_,
        .skip_dirnames = skip_dirnames_,
    };
}
