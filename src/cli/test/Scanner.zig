const Scanner = @This();

/// Memory is borrowed.
exclusion_names: []const []const u8 = &.{},
/// When this list is empty, no filters are applied.
/// "test" suffixes (e.g. .spec.*) are always applied when traversing directories.
filter_names: []const []const u8 = &.{},
dirs_to_scan: Fifo,
/// Paths to test files found while scanning.
test_files: std.ArrayListUnmanaged(bun.PathString),
fs: *FileSystem,
open_dir_buf: bun.PathBuffer = undefined,
scan_dir_buf: bun.PathBuffer = undefined,
options: *BundleOptions,
has_iterated: bool = false,
search_count: usize = 0,

const log = bun.Output.scoped(.jest, .hidden);
const Fifo = bun.LinearFifo(ScanEntry, .Dynamic);
const ScanEntry = struct {
    relative_dir: bun.StoredFileDescriptorType,
    dir_path: []const u8,
    name: StringOrTinyString,
};
const Error = error{
    /// Scan entrypoint file/directory does not exist. Not returned when
    /// a subdirectory is scanned but does not exist.
    DoesNotExist,
} || Allocator.Error;

pub fn init(
    alloc: Allocator,
    transpiler: *Transpiler,
    initial_results_capacity: usize,
) Allocator.Error!Scanner {
    const results = try std.ArrayListUnmanaged(bun.PathString).initCapacity(
        alloc,
        initial_results_capacity,
    );
    return Scanner{
        .dirs_to_scan = Fifo.init(alloc),
        .options = &transpiler.options,
        .fs = transpiler.fs,
        .test_files = results,
    };
}

pub fn deinit(this: *Scanner) void {
    this.test_files.deinit(this.allocator());
    this.dirs_to_scan.deinit();
    this.* = undefined;
}

/// Take the list of test files out of this scanner. Caller owns the returned
/// allocation.
pub fn takeFoundTestFiles(this: *Scanner) Allocator.Error![]bun.PathString {
    return this.test_files.toOwnedSlice(this.allocator());
}

pub fn scan(this: *Scanner, path_literal: []const u8) Error!void {
    const parts = &[_][]const u8{ this.fs.top_level_dir, path_literal };
    const path = this.fs.absBuf(parts, &this.scan_dir_buf);

    var root = try this.readDirWithName(path, null);

    if (root.* == .err) {
        switch (root.err.original_err) {
            error.NotDir, error.ENOTDIR => {
                if (this.isTestFile(path)) {
                    const rel_path = bun.PathString.init(bun.handleOom(this.fs.filename_store.append([]const u8, path)));
                    bun.handleOom(this.test_files.append(this.allocator(), rel_path));
                }
            },
            error.ENOENT => return error.DoesNotExist,
            else => log("Scanner.readDirWithName('{s}') -> {s}", .{ path, @errorName(root.err.original_err) }),
        }
    }

    // you typed "." and we already scanned it
    if (!this.has_iterated) {
        if (@as(FileSystem.RealFS.EntriesOption.Tag, root.*) == .entries) {
            var iter = root.entries.data.iterator();
            const fd = root.entries.fd;
            bun.assert(fd != bun.invalid_fd);
            while (iter.next()) |entry| {
                this.next(entry.value_ptr.*, fd);
            }
        }
    }

    while (this.dirs_to_scan.readItem()) |entry| {
        bun.assert(entry.relative_dir.isValid());
        if (!bun.Environment.isWindows) {
            const dir = entry.relative_dir.stdDir();

            const parts2 = &[_][]const u8{ entry.dir_path, entry.name.slice() };
            var path2 = this.fs.absBuf(parts2, &this.open_dir_buf);
            this.open_dir_buf[path2.len] = 0;
            const pathZ = this.open_dir_buf[path2.len - entry.name.slice().len .. path2.len :0];
            const child_dir = bun.openDir(dir, pathZ) catch continue;
            path2 = try this.fs.dirname_store.append([]const u8, path2);
            FileSystem.setMaxFd(child_dir.fd);
            _ = this.readDirWithName(path2, child_dir) catch return error.OutOfMemory;
        } else {
            const parts2 = &[_][]const u8{ entry.dir_path, entry.name.slice() };
            const path2 = this.fs.absBufZ(parts2, &this.open_dir_buf);
            const child_dir = bun.openDirNoRenamingOrDeletingWindows(bun.invalid_fd, path2) catch continue;
            _ = this.readDirWithName(
                try this.fs.dirname_store.append([]const u8, path2),
                child_dir,
            ) catch return error.OutOfMemory;
        }
    }
}

fn readDirWithName(this: *Scanner, name: []const u8, handle: ?std.fs.Dir) !*FileSystem.RealFS.EntriesOption {
    return try this.fs.fs.readDirectoryWithIterator(name, handle, 0, true, *Scanner, this);
}

pub const test_name_suffixes = [_][]const u8{
    ".test",
    "_test",
    ".spec",
    "_spec",
};

pub fn couldBeTestFile(this: *Scanner, name: []const u8, comptime needs_test_suffix: bool) bool {
    const extname = std.fs.path.extension(name);
    if (extname.len == 0 or !this.options.loader(extname).isJavaScriptLike()) return false;
    if (comptime !needs_test_suffix) return true;
    const name_without_extension = name[0 .. name.len - extname.len];
    inline for (test_name_suffixes) |suffix| {
        if (strings.endsWithComptime(name_without_extension, suffix)) return true;
    }

    return false;
}

pub fn doesAbsolutePathMatchFilter(this: *Scanner, name: []const u8) bool {
    if (this.filter_names.len == 0) return true;

    for (this.filter_names) |filter_name| {
        if (strings.startsWith(name, filter_name)) return true;
    }

    return false;
}

pub fn doesPathMatchFilter(this: *Scanner, name: []const u8) bool {
    if (this.filter_names.len == 0) return true;

    for (this.filter_names) |filter_name| {
        if (strings.contains(name, filter_name)) return true;
    }

    return false;
}

pub fn isTestFile(this: *Scanner, name: []const u8) bool {
    return this.couldBeTestFile(name, false) and this.doesPathMatchFilter(name);
}

pub fn next(this: *Scanner, entry: *FileSystem.Entry, fd: bun.StoredFileDescriptorType) void {
    const name = entry.base_lowercase();
    this.has_iterated = true;
    switch (entry.kind(&this.fs.fs, true)) {
        .dir => {
            if ((name.len > 0 and name[0] == '.') or strings.eqlComptime(name, "node_modules")) {
                return;
            }

            if (comptime bun.Environment.allow_assert)
                bun.assert(!strings.contains(name, std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str));

            for (this.exclusion_names) |exclude_name| {
                if (strings.eql(exclude_name, name)) return;
            }

            this.search_count += 1;

            this.dirs_to_scan.writeItem(.{
                .relative_dir = fd,
                .name = entry.base_,
                .dir_path = entry.dir,
            }) catch unreachable;
        },
        .file => {
            // already seen it!
            if (!entry.abs_path.isEmpty()) return;

            this.search_count += 1;
            if (!this.couldBeTestFile(name, true)) return;

            const parts = &[_][]const u8{ entry.dir, entry.base() };
            const path = this.fs.absBuf(parts, &this.open_dir_buf);

            if (!this.doesAbsolutePathMatchFilter(path)) {
                const rel_path = bun.path.relative(this.fs.top_level_dir, path);
                if (!this.doesPathMatchFilter(rel_path)) return;
            }

            entry.abs_path = bun.PathString.init(this.fs.filename_store.append(@TypeOf(path), path) catch unreachable);
            this.test_files.append(this.allocator(), entry.abs_path) catch unreachable;
        },
    }
}

inline fn allocator(self: *const Scanner) Allocator {
    return self.dirs_to_scan.allocator;
}

const std = @import("std");
const BundleOptions = @import("../../options.zig").BundleOptions;
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Transpiler = bun.Transpiler;
const FileSystem = bun.fs.FileSystem;

const jsc = bun.jsc;
const jest = jsc.Jest;

const strings = bun.strings;
const StringOrTinyString = strings.StringOrTinyString;
