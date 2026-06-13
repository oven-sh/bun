const Scanner = @This();

/// Memory is borrowed.
exclusion_names: []const []const u8 = &.{},
/// When this list is empty, no filters are applied.
/// "test" suffixes (e.g. .spec.*) are always applied when traversing directories.
filter_names: []const []const u8 = &.{},
/// Glob patterns for paths to ignore. Matched against the path relative to the
/// project root (top_level_dir). When a file matches any pattern, it is excluded.
path_ignore_patterns: []const []const u8 = &.{},
/// Whether `path_ignore_patterns` are the built-in defaults (see
/// `default_path_ignore_patterns`) vs a list configured by the user via
/// `--path-ignore-patterns` or `bunfig.toml`. When true, explicit file/directory
/// arguments bypass the patterns — otherwise running `bun test build/foo.test.ts`
/// would silently match nothing.
path_ignore_patterns_are_defaults: bool = false,
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
    relative_dir: bun.FD,
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
    return this.scanInternal(path_literal, .auto_discover);
}

/// Like `scan`, but the path came from an explicit command-line argument
/// (`bun test ./build/foo.test.ts`). When the only patterns in play are the
/// Scanner's built-in defaults, skip them for this invocation — the user
/// pointed at this file/directory, so silently dropping it would be
/// surprising. Any patterns the user configured themselves still apply.
pub fn scanExplicit(this: *Scanner, path_literal: []const u8) Error!void {
    return this.scanInternal(path_literal, .explicit_path);
}

const ScanMode = enum { auto_discover, explicit_path };

fn scanInternal(this: *Scanner, path_literal: []const u8, mode: ScanMode) Error!void {
    // Explicit paths narrow the built-in defaults only: any pattern that
    // would match the explicit root itself is dropped for this scan, but
    // every other default keeps pruning. So `bun test ./build/foo.test.ts`
    // drops `**/build/**` and runs the named file, while `bun test
    // ./packages/foo` keeps both defaults and still prunes
    // `packages/foo/dist/`. User-configured patterns are untouched.
    const saved_patterns = this.path_ignore_patterns;
    const narrow = mode == .explicit_path and this.path_ignore_patterns_are_defaults;
    var narrow_buf: [default_path_ignore_patterns.len][]const u8 = undefined;
    if (narrow) {
        const rel_path = bun.path.relative(this.fs.top_level_dir, path_literal);
        const rel_source: []const u8 = if (rel_path.len == 0) path_literal else rel_path;
        var kept: usize = 0;
        for (this.path_ignore_patterns) |pattern| {
            if (!patternMatchesPath(pattern, rel_source)) {
                narrow_buf[kept] = pattern;
                kept += 1;
            }
        }
        this.path_ignore_patterns = narrow_buf[0..kept];
    }
    defer if (narrow) {
        this.path_ignore_patterns = saved_patterns;
    };

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

/// Glob patterns applied when the user has not configured
/// `pathIgnorePatterns` (neither in `bunfig.toml` nor via
/// `--path-ignore-patterns`). Matches the relative path from the project
/// root, so these patterns prune the conventional output directories at any
/// depth. An explicit (even empty) user configuration replaces this list.
pub const default_path_ignore_patterns = [_][]const u8{
    "**/dist/**",
    "**/build/**",
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

/// Returns true if the given path matches any of the path ignore patterns.
/// The path is matched as a relative path from the project root.
pub fn matchesPathIgnorePattern(this: *Scanner, abs_path: []const u8) bool {
    if (this.path_ignore_patterns.len == 0) return false;
    const rel_path = bun.path.relative(this.fs.top_level_dir, abs_path);
    for (this.path_ignore_patterns) |pattern| {
        if (patternMatchesPath(pattern, rel_path)) return true;
    }
    return false;
}

/// Returns true if `pattern` matches `rel_path`. Handles the same two-attempt
/// glob behavior as the main scanner match: try the raw relative path first,
/// then retry with a trailing `/` for `**` patterns (so `**/build/**` matches
/// the bare directory name `packages/sub/build` as well as files under it).
fn patternMatchesPath(pattern: []const u8, rel_path: []const u8) bool {
    if (bun.glob.match(pattern, rel_path).matches()) return true;
    // Only try trailing separator for ** patterns (e.g. "vendor/**").
    // Single-star patterns like "vendor/*" must not prune entire
    // directories because * doesn't cross directory boundaries.
    if (rel_path.len == 0 or rel_path[rel_path.len - 1] == '/') return false;
    if (strings.indexOf(pattern, "**") == null) return false;
    var buf: [4096]u8 = undefined;
    if (rel_path.len + 1 > buf.len) return false;
    @memcpy(buf[0..rel_path.len], rel_path);
    buf[rel_path.len] = '/';
    return bun.glob.match(pattern, buf[0 .. rel_path.len + 1]).matches();
}

pub fn isTestFile(this: *Scanner, name: []const u8) bool {
    return this.couldBeTestFile(name, false) and this.doesPathMatchFilter(name) and !this.matchesPathIgnorePattern(name);
}

pub fn next(this: *Scanner, entry: *FileSystem.Entry, fd: bun.FD) void {
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

            // Prune ignored directory trees early so we never traverse them.
            if (this.path_ignore_patterns.len > 0) {
                const parts = &[_][]const u8{ entry.dir, entry.base() };
                const dir_path = this.fs.absBuf(parts, &this.open_dir_buf);
                if (this.matchesPathIgnorePattern(dir_path)) return;
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

            if (this.matchesPathIgnorePattern(path)) return;

            entry.abs_path = bun.PathString.init(this.fs.filename_store.append(@TypeOf(path), path) catch unreachable);
            this.test_files.append(this.allocator(), entry.abs_path) catch unreachable;
        },
    }
}

inline fn allocator(self: *const Scanner) Allocator {
    return self.dirs_to_scan.allocator;
}

const std = @import("std");
const BundleOptions = @import("../../../bundler/options.zig").BundleOptions;
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Transpiler = bun.Transpiler;
const FileSystem = bun.fs.FileSystem;

const jsc = bun.jsc;
const jest = jsc.Jest;

const strings = bun.strings;
const StringOrTinyString = strings.StringOrTinyString;
