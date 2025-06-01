const std = @import("std");
const Allocator = std.mem.Allocator;
const Walker = @This();
const bun = @import("bun");
const path = std.fs.path;
const DirIterator = bun.DirIterator;
const Environment = bun.Environment;
const OSPathSlice = bun.OSPathSlice;

stack: std.ArrayList(StackItem),
name_buffer: NameBufferList,
skip_filenames: []const u64 = &[_]u64{},
skip_dirnames: []const u64 = &[_]u64{},
skip_all: []const u64 = &[_]u64{},
seed: u64 = 0,

const NameBufferList = std.ArrayList(bun.OSPathChar);

const Dir = std.fs.Dir;
const WrappedIterator = DirIterator.NewWrappedIterator(if (Environment.isWindows) .u16 else .u8);

pub const WalkerEntry = struct {
    /// The containing directory. This can be used to operate directly on `basename`
    /// rather than `path`, avoiding `error.NameTooLong` for deeply nested paths.
    /// The directory remains open until `next` or `deinit` is called.
    dir: Dir,
    basename: OSPathSlice,
    path: OSPathSlice,
    kind: Dir.Entry.Kind,
};

const StackItem = struct {
    iter: WrappedIterator,
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
        switch (top.iter.next()) {
            .err => |err| return bun.errnoToZigErr(err.errno),
            .result => |res| {
                if (res) |base| {
                    switch (base.kind) {
                        .directory => {
                            if (std.mem.indexOfScalar(
                                u64,
                                self.skip_dirnames,
                                // avoid hashing if there will be 0 results
                                if (self.skip_dirnames.len > 0) bun.hashWithSeed(self.seed, std.mem.sliceAsBytes(base.name.slice())) else 0,
                            ) != null) continue;
                        },
                        .file => {
                            if (std.mem.indexOfScalar(
                                u64,
                                self.skip_filenames,
                                // avoid hashing if there will be 0 results
                                if (self.skip_filenames.len > 0) bun.hashWithSeed(self.seed, std.mem.sliceAsBytes(base.name.slice())) else 0,
                            ) != null) continue;
                        },

                        // we don't know what it is for a symlink
                        .sym_link => {
                            if (std.mem.indexOfScalar(
                                u64,
                                self.skip_all,
                                // avoid hashing if there will be 0 results
                                if (self.skip_all.len > 0) bun.hashWithSeed(self.seed, std.mem.sliceAsBytes(base.name.slice())) else 0,
                            ) != null) continue;
                        },

                        else => {},
                    }

                    self.name_buffer.shrinkRetainingCapacity(dirname_len);
                    if (self.name_buffer.items.len != 0) {
                        try self.name_buffer.append(path.sep);
                        dirname_len += 1;
                    }
                    try self.name_buffer.appendSlice(base.name.slice());
                    const cur_len = self.name_buffer.items.len;
                    try self.name_buffer.append(0);
                    self.name_buffer.shrinkRetainingCapacity(cur_len);

                    if (base.kind == .directory) {
                        var new_dir = (if (Environment.isWindows)
                            top.iter.iter.dir.openDirW(base.name.sliceAssumeZ(), .{ .iterate = true })
                        else
                            top.iter.iter.dir.openDir(base.name.slice(), .{ .iterate = true })) catch |err| switch (err) {
                            error.NameTooLong => unreachable, // no path sep in base.name
                            else => |e| return e,
                        };
                        {
                            errdefer new_dir.close();
                            try self.stack.append(StackItem{
                                .iter = DirIterator.iterate(new_dir, if (Environment.isWindows) .u16 else .u8),
                                .dirname_len = self.name_buffer.items.len,
                            });
                            top = &self.stack.items[self.stack.items.len - 1];
                        }
                    }
                    return WalkerEntry{
                        .dir = top.iter.iter.dir,
                        .basename = self.name_buffer.items[dirname_len..],
                        .path = self.name_buffer.items,
                        .kind = base.kind,
                    };
                } else {
                    var item = self.stack.pop().?;
                    if (self.stack.items.len != 0) {
                        item.iter.iter.dir.close();
                    }
                }
            },
        }
    }
    return null;
}

pub fn deinit(self: *Walker) void {
    if (self.stack.items.len > 0) {
        for (self.stack.items[1..]) |*item| {
            if (self.stack.items.len != 0) {
                item.iter.iter.dir.close();
            }
        }
        self.stack.deinit();
    }

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
    skip_filenames: []const OSPathSlice,
    skip_dirnames: []const OSPathSlice,
) !Walker {
    var name_buffer = NameBufferList.init(allocator);
    errdefer name_buffer.deinit();

    var stack = std.ArrayList(Walker.StackItem).init(allocator);
    errdefer stack.deinit();

    var skip_names = try allocator.alloc(u64, skip_filenames.len + skip_dirnames.len);
    const seed = skip_filenames.len + skip_dirnames.len;
    var skip_name_i: usize = 0;

    for (skip_filenames) |name| {
        skip_names[skip_name_i] = bun.hashWithSeed(seed, std.mem.sliceAsBytes(name));
        skip_name_i += 1;
    }
    const skip_filenames_ = skip_names[0..skip_name_i];
    var skip_dirnames_ = skip_names[skip_name_i..];

    for (skip_dirnames, 0..) |name, i| {
        skip_dirnames_[i] = bun.hashWithSeed(seed, std.mem.sliceAsBytes(name));
    }

    try stack.append(Walker.StackItem{
        .iter = DirIterator.iterate(self, if (Environment.isWindows) .u16 else .u8),
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
