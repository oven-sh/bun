const std = @import("std");
const bun = @import("root").bun;
const Global = bun.Global;
const Output = bun.Output;
const Command = bun.CLI.Command;
const Install = bun.install;
const Bin = Install.Bin;
const PackageManager = Install.PackageManager;
const Lockfile = Install.Lockfile;
const PackageID = Install.PackageID;
const DependencyID = Install.DependencyID;
const Behavior = Install.Dependency.Behavior;
const string = bun.string;
const stringZ = bun.stringZ;
const Archive = @import("../libarchive/libarchive.zig").lib.Archive;
const Expr = bun.js_parser.Expr;
const Semver = @import("../install/semver.zig");
const File = bun.sys.File;
const FD = bun.FD;
const strings = bun.strings;
const glob = bun.glob;
const PathBuffer = bun.PathBuffer;
const DirIterator = bun.DirIterator;
const Environment = bun.Environment;
const RunCommand = bun.RunCommand;
const FileSystem = bun.fs.FileSystem;
const OOM = bun.OOM;
const js_printer = bun.js_printer;
const E = bun.js_parser.E;

pub const PackCommand = struct {
    pub const Context = struct {
        manager: *PackageManager,
        allocator: std.mem.Allocator,
        command_ctx: Command.Context,

        // `bun pack` does not require a lockfile, but
        // it's possible we will need it for finding
        // workspace versions. This is the only valid lockfile
        // pointer in this file. `manager.lockfile` is incorrect
        lockfile: ?*Lockfile,

        stats: struct {
            total_unpacked_size: usize = 0,
            total_files: usize = 0,
            ignored_files: usize = 0,
            ignored_directories: usize = 0,

            successfully_bundled_deps: std.ArrayListUnmanaged(string) = .{},
        } = .{},

        pub fn printStats(this: *const Context) void {
            if (this.manager.options.log_level != .silent) {
                const stats = this.stats;
                Output.pretty(
                    \\total_unpacked_size: {}
                    \\total_files: {d}
                    \\ignored_files: {d}
                    \\ignored_directories: {d}
                    \\
                , .{
                    bun.fmt.size(stats.total_unpacked_size, .{ .space_between_number_and_unit = false }),
                    stats.total_files,
                    stats.ignored_files,
                    stats.ignored_directories,
                });
            }
        }
    };

    pub fn execWithManager(ctx: Command.Context, manager: *PackageManager) !void {
        var lockfile: Lockfile = undefined;
        const load_from_disk_result = lockfile.loadFromDisk(
            manager,
            manager.allocator,
            manager.log,
            manager.options.lockfile_path,
            false,
        );

        var pack_ctx: Context = .{
            .manager = manager,
            .allocator = ctx.allocator,
            .command_ctx = ctx,
            .lockfile = switch (load_from_disk_result) {
                .ok => |ok| ok.lockfile,
                .err => |cause| err: {
                    switch (cause.step) {
                        .open_file => {
                            if (cause.value == error.ENOENT) break :err null;
                            Output.errGeneric("failed to open lockfile: {s}", .{
                                @errorName(cause.value),
                            });
                        },
                        .parse_file => Output.errGeneric("failed to parse lockfile: {s}", .{
                            @errorName(cause.value),
                        }),
                        .read_file => Output.errGeneric("failed to read lockfile: {s}", .{
                            @errorName(cause.value),
                        }),
                        .migrating => Output.errGeneric("failed to migrate lockfile: {s}", .{
                            @errorName(cause.value),
                        }),
                    }

                    if (ctx.log.hasErrors()) {
                        switch (Output.enable_ansi_colors) {
                            inline else => |enable_ansi_colors| try manager.log.printForLogLevelWithEnableAnsiColors(
                                Output.errorWriter(),
                                enable_ansi_colors,
                            ),
                        }
                    }

                    Global.crash();
                },
                else => null,
            },
        };

        switch (Output.enable_ansi_colors) {
            inline else => |enable_ansi_colors| {
                // var arena = std.heap.ArenaAllocator.init(ctx.allocator);
                // defer arena.deinit();

                if (manager.options.filter_patterns.len > 0) {
                    // loop, convert, find matching workspaces, then pack each
                    return;
                }

                // just pack the current workspace
                pack(&pack_ctx, manager.original_package_json_path, enable_ansi_colors) catch |err| {
                    switch (err) {
                        error.OutOfMemory => bun.outOfMemory(),
                        error.MissingPackageName, error.MissingPackageVersion => {
                            Output.errGeneric("package.json must have `name` and `version` fields", .{});
                            Global.crash();
                        },
                        error.InvalidPackageName, error.InvalidPackageVersion => {
                            Output.errGeneric("`name` and `version` must have string values in package.json", .{});
                            Global.crash();
                        },
                        error.MissingPackageJSON => {
                            Output.errGeneric("failed to find a package.json in: \"{s}\"", .{manager.original_package_json_path});
                            Global.crash();
                        },
                    }
                };
            },
        }

        pack_ctx.printStats();
    }

    pub fn exec(ctx: Command.Context) !void {
        Output.prettyErrorln("<r><b>bun pack <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
        Output.flush();

        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .pack);

        const manager, const original_cwd = PackageManager.init(ctx, cli, .pack) catch |err| {
            if (!cli.silent) {
                switch (err) {
                    error.MissingPackageJSON => {
                        var cwd_buf: bun.PathBuffer = undefined;
                        const cwd = bun.getcwd(&cwd_buf) catch {
                            Output.errGeneric("failed to find project package.json", .{});
                            Global.crash();
                        };
                        Output.errGeneric("failed to find project package.json from: \"{s}\"", .{cwd});
                    },
                    else => Output.errGeneric("failed to initialize bun install: {s}", .{@errorName(err)}),
                }
            }

            Global.crash();
        };
        defer ctx.allocator.free(original_cwd);

        return execWithManager(ctx, manager);
    }

    const PackError = OOM || error{
        MissingPackageName,
        InvalidPackageName,
        MissingPackageVersion,
        InvalidPackageVersion,
        MissingPackageJSON,
    };

    const package_prefix = "package/";

    const root_default_ignore_patterns = [_][]const u32{
        &.{ 112, 97, 99, 107, 97, 103, 101, 45, 108, 111, 99, 107, 46, 106, 115, 111, 110 }, // package-lock.json
        &.{ 121, 97, 114, 110, 46, 108, 111, 99, 107 }, // yarn.lock
        &.{ 112, 110, 112, 109, 45, 108, 111, 99, 107, 46, 121, 97, 109, 108 }, // pnpm-lock.yaml
        &.{ 'b', 'u', 'n', '.', 'l', 'o', 'c', 'k', 'b' }, // bun.lockb
    };

    // pattern, can override
    const default_ignore_patterns = [_]struct { []const u32, bool }{
        .{ &.{ '.', '*', '.', 's', 'w', 'p' }, true },
        .{ &.{ 46, 95, 42 }, true }, // "._*",
        .{ &.{ 46, 68, 83, 95, 83, 116, 111, 114, 101 }, true }, // ".DS_Store",
        .{ &.{ 46, 103, 105, 116 }, false }, // ".git",
        .{ &.{ 46, 103, 105, 116, 105, 103, 110, 111, 114, 101 }, true }, // ".gitignore",
        .{ &.{ 46, 104, 103 }, false }, // ".hg",
        .{ &.{ 46, 110, 112, 109, 105, 103, 110, 111, 114, 101 }, true }, // ".npmignore",
        .{ &.{ 46, 110, 112, 109, 114, 99 }, false }, // ".npmrc",
        .{ &.{ 46, 108, 111, 99, 107, 45, 119, 115, 99, 114, 105, 112, 116 }, true }, // ".lock-wscript",
        .{ &.{ 46, 115, 118, 110 }, true }, // ".svn",
        .{ &.{ 46, 119, 97, 102, 112, 105, 99, 107, 108, 101, 45, 42 }, true }, // ".wafpickle-*",
        .{ &.{ 67, 86, 83 }, true }, // "CVS",
        .{ &.{ 110, 112, 109, 45, 100, 101, 98, 117, 103, 46, 108, 111, 103 }, true }, // "npm-debug.log",

        // mentioned in the docs but does not appear to be ignored by default
        // .{ &.{ 99, 111, 110, 102, 105, 103, 46, 103, 121, 112, 105 }, false }, // "config.gypi",
    };

    const DirInfo = struct {
        std.fs.Dir, // the dir
        string, // the dir subpath
        usize, // dir depth. used to shrink ignore stack
    };

    fn iterateIncludedProjectTree(
        ctx: *Context,
        includes: []const Pattern,
        root_dir_info: DirInfo,
        comptime close_root_dir: bool,
    ) OOM!struct { std.ArrayListUnmanaged(stringZ), std.ArrayListUnmanaged(stringZ) } {
        const pack_list: std.ArrayListUnmanaged(stringZ) = .{};
        const bundled_pack_list: std.ArrayListUnmanaged(stringZ) = .{};

        var ignores: std.ArrayListUnmanaged(IgnorePatterns) = .{};
        defer ignores.deinit(ctx.allocator);

        var dirs: std.ArrayListUnmanaged(DirInfo) = .{};
        defer dirs.deinit(ctx.allocator);

        try dirs.append(ctx.allocator, root_dir_info);

        // var included_files: std.ArrayListUnmanaged(stringZ) = .{};
        // defer included_files.deinit(ctx.allocator);

        var included_dirs: std.ArrayListUnmanaged(DirInfo) = .{};
        defer included_dirs.deinit(ctx.allocator);

        // for (includes) |include| {
        //     if (include.len ==)
        // }

        while (dirs.popOrNull()) |dir_info| {
            var dir, const dir_subpath, const dir_depth = dir_info;
            defer {
                if (comptime close_root_dir) {
                    dir.close();
                } else if (dir_depth != root_dir_info[2]) {
                    dir.close();
                }
            }

            var dir_iter = DirIterator.iterate(dir, .u8);
            while (dir_iter.next().unwrap() catch null) |entry| {
                if (entry.kind != .file and entry.kind != .directory) continue;

                const entry_name = entry.name.slice();
                const entry_subpath = try std.fmt.allocPrintZ(ctx.allocator, "{s}{s}{s}", .{
                    dir_subpath,
                    if (dir_subpath.len == 0) "" else "/",
                    entry_name,
                });

                var included = false;
                for (includes) |include| {
                    if (include.dirs_only and entry.kind != .directory) continue;
                    const match_path = if (!include.rel_path) entry_name else entry_subpath;
                    switch (glob.matchImpl(include.glob, match_path)) {
                        .match => {
                            included = true;
                        },
                        .negate_no_match => included = false,

                        else => {},
                    }
                }
            }
        }

        return .{ pack_list, bundled_pack_list };
    }

    /// Adds all files in a directory tree to `pack_list` (default ignores still apply)
    fn addEntireTree(
        ctx: *Context,
        root_dir_info: DirInfo,
        pack_list: *std.ArrayListUnmanaged(stringZ),
    ) OOM!void {
        var dirs: std.ArrayListUnmanaged(DirInfo) = .{};
        defer dirs.deinit(ctx.allocator);

        try dirs.append(ctx.allocator, root_dir_info);

        while (dirs.popOrNull()) |dir_info| {
            var dir, const dir_subpath, const dir_depth = dir_info;
            defer dir.close();

            var iter = DirIterator.iterate(dir, .u8);
            while (iter.next().unwrap() catch null) |entry| {
                if (entry.kind != .file and entry.kind != .directory) continue;

                const entry_name = entry.name.slice();

                const entry_subpath = try std.fmt.allocPrintZ(ctx.allocator, "{s}{s}{s}", .{
                    dir_subpath,
                    if (dir_subpath.len == 0) "" else "/",
                    entry_name,
                });

                if (dir_depth == root_dir_info[2]) {
                    if (entry.kind == .directory and strings.eqlComptime(entry_name, "node_modules")) continue;
                }

                if (isExcluded(entry, entry_subpath, dir_depth, &.{})) |used_pattern_info| {
                    if (ctx.manager.options.log_level.isVerbose()) {
                        const pattern, const kind = used_pattern_info;
                        Output.prettyln("<r><blue>ignore<r> <d>[{s}:{}]<r> {s}{s}", .{
                            @tagName(kind),
                            bun.fmt.debugUtf32PathFormatter(pattern),
                            entry_subpath,
                            if (entry.kind == .directory) "/" else "",
                        });
                        Output.flush();
                    }
                    continue;
                }

                switch (entry.kind) {
                    .file => try pack_list.append(ctx.allocator, entry_subpath),
                    .directory => {
                        const subdir = openSubdir(dir, entry_name, entry_subpath);

                        try dirs.append(ctx.allocator, .{
                            subdir,
                            entry_subpath,
                            dir_depth + 1,
                        });
                    },
                    else => unreachable,
                }
            }
        }
    }

    fn iterateBundledDeps(
        ctx: *Context,
        bundled_deps: []const string,
        node_modules_dir: std.fs.Dir,
        bundled_pack_list: *std.ArrayListUnmanaged(stringZ),
    ) OOM!void {
        var iter = DirIterator.iterate(node_modules_dir, .u8);
        while (iter.next().unwrap() catch null) |entry| {
            if (entry.kind != .directory) continue;

            const entry_name = entry.name.slice();

            const entry_subpath = try std.fmt.allocPrintZ(ctx.allocator, "node_modules/{s}", .{
                entry_name,
            });

            for (bundled_deps) |dep| {
                if (!strings.eqlLong(dep, entry_name, true)) continue;

                // closed in `addEntireTree`
                const subdir = openSubdir(node_modules_dir, entry_name, entry_subpath);

                try addEntireTree(ctx, .{ subdir, entry_subpath, 2 }, bundled_pack_list);
                try ctx.stats.successfully_bundled_deps.append(ctx.allocator, dep);
            }
        }
    }

    fn openSubdir(
        dir: std.fs.Dir,
        entry_name: string,
        entry_subpath: stringZ,
    ) std.fs.Dir {
        return dir.openDirZ(
            // doing this because `entry_subpath` has a sentinel and I don't trust `entry.name.sliceAssumeZ()`
            entry_subpath[entry_subpath.len - entry_name.len ..][0..entry_name.len :0],
            .{ .iterate = true },
        ) catch |err| {
            Output.err(err, "failed to open directory \"{s}\" for packing", .{entry_subpath});
            Global.crash();
        };
    }

    /// Returns an array of filenames to include in the archive
    fn iterateProjectTree(
        ctx: *Context,
        bundled_deps: []const string,
        root_dir_info: DirInfo,
        comptime close_root_dir: bool,
    ) OOM!struct { std.ArrayListUnmanaged(stringZ), std.ArrayListUnmanaged(stringZ) } {
        var pack_list: std.ArrayListUnmanaged(stringZ) = .{};
        var bundled_pack_list: std.ArrayListUnmanaged(stringZ) = .{};

        var ignores: std.ArrayListUnmanaged(IgnorePatterns) = .{};
        defer ignores.deinit(ctx.allocator);

        // Stacks and depth-first traversal. Doing so means we can push and pop from
        // ignore patterns without needing to clone the entire list for future use.
        var dirs: std.ArrayListUnmanaged(DirInfo) = .{};
        defer dirs.deinit(ctx.allocator);

        try dirs.append(ctx.allocator, root_dir_info);

        while (dirs.popOrNull()) |dir_info| {
            var dir, const dir_subpath, const dir_depth = dir_info;
            defer {
                if (comptime close_root_dir) {
                    dir.close();
                } else if (dir_depth != 1) {
                    dir.close();
                }
            }

            while (ignores.getLastOrNull()) |last| {
                if (last.depth < dir_depth) break;

                // pop patterns from files greater than or equal to the current depth.
                last.deinit(ctx.allocator);
                ignores.items.len -= 1;
            }

            if (try IgnorePatterns.readFromDisk(ctx, dir, dir_depth)) |patterns| {
                try ignores.append(ctx.allocator, patterns);
            }

            if (comptime Environment.isDebug) {
                // make sure depths are in order
                if (ignores.items.len > 0) {
                    for (1..ignores.items.len) |i| {
                        bun.assertWithLocation(ignores.items[i - 1].depth < ignores.items[i].depth, @src());
                    }
                }
            }

            var dir_iter = DirIterator.iterate(dir, .u8);
            while (dir_iter.next().unwrap() catch null) |entry| {
                if (entry.kind != .file and entry.kind != .directory) continue;

                const entry_name = entry.name.slice();

                const entry_subpath = try std.fmt.allocPrintZ(ctx.allocator, "{s}{s}{s}", .{
                    dir_subpath,
                    if (dir_subpath.len == 0) "" else "/",
                    entry_name,
                });

                if (dir_depth == 1) {
                    // Special case root package.json. It is always included
                    // and is possibly edited, so it's easier to handle it
                    // separately
                    if (strings.eqlComptime(entry_name, "package.json")) continue;

                    // bundled dependencies are included only if they exist on disk
                    if (strings.eqlComptime(entry_name, "node_modules")) {
                        if (bundled_deps.len == 0) continue;

                        const node_modules_dir = dir.openDirZ("node_modules", .{ .iterate = true }) catch |err| {
                            switch (err) {
                                error.NotDir => continue,
                                else => {
                                    Output.err(err, "failed to open \"node_modules\" to pack bundled dependencies", .{});
                                    Global.crash();
                                },
                            }
                        };

                        try iterateBundledDeps(ctx, bundled_deps, node_modules_dir, &bundled_pack_list);
                        continue;
                    }
                }

                if (isExcluded(entry, entry_subpath, dir_depth, ignores.items)) |used_pattern_info| {
                    if (ctx.manager.options.log_level.isVerbose()) {
                        const pattern, const kind = used_pattern_info;
                        Output.prettyln("<r><blue>ignore<r> <d>[{s}:{}]<r> {s}{s}", .{
                            @tagName(kind),
                            bun.fmt.debugUtf32PathFormatter(pattern),
                            entry_subpath,
                            if (entry.kind == .directory) "/" else "",
                        });
                        Output.flush();
                    }
                    continue;
                }

                switch (entry.kind) {
                    .file => {
                        try pack_list.append(ctx.allocator, entry_subpath);
                    },
                    .directory => {
                        const subdir = openSubdir(dir, entry_name, entry_subpath);

                        try dirs.append(ctx.allocator, .{
                            subdir,
                            entry_subpath,
                            dir_depth + 1,
                        });
                    },
                    else => unreachable,
                }
            }
        }

        return .{ pack_list, bundled_pack_list };
    }

    fn getBundledDeps(
        ctx: *Context,
        json: Expr,
        comptime field: string,
    ) OOM!?[]const string {
        var deps: std.ArrayListUnmanaged(string) = .{};
        const bundled_deps = json.get(field) orelse return null;

        invalid_field: {
            var iter = bundled_deps.asArray() orelse break :invalid_field;
            while (iter.next()) |bundled_dep_item| {
                const bundled_dep = bundled_dep_item.asStringCloned(ctx.allocator) orelse break :invalid_field;
                try deps.append(ctx.allocator, bundled_dep);
            }

            return deps.items;
        }

        Output.errGeneric("expected `{s}` to be an array of strings", .{field});
        Global.crash();
    }

    const BinInfo = struct {
        path: string,
        type: Type,

        const Type = enum {
            file,
            dir,
        };
    };

    fn getPackageBins(
        ctx: *Context,
        json: Expr,
    ) OOM![]const BinInfo {
        var bins: std.ArrayListUnmanaged(BinInfo) = .{};

        var path_buf: PathBuffer = undefined;

        if (json.asProperty("bin")) |bin| {
            if (bin.expr.asString(ctx.allocator)) |bin_str| {
                const normalized = bun.path.normalizeBuf(bin_str, &path_buf, .posix);
                try bins.append(ctx.allocator, .{
                    .path = try ctx.allocator.dupe(u8, normalized),
                    .type = .file,
                });
                return bins.items;
            }

            switch (bin.expr.data) {
                .e_object => |bin_obj| {
                    if (bin_obj.properties.len == 0) return &.{};

                    for (bin_obj.properties.slice()) |bin_prop| {
                        if (bin_prop.value) |bin_prop_value| {
                            if (bin_prop_value.asString(ctx.allocator)) |bin_str| {
                                const normalized = bun.path.normalizeBuf(bin_str, &path_buf, .posix);
                                try bins.append(ctx.allocator, .{
                                    .path = try ctx.allocator.dupe(u8, normalized),
                                    .type = .file,
                                });
                            }
                        }
                    }
                },
                else => {},
            }

            return bins.items;
        }

        if (json.asProperty("directories")) |directories| {
            switch (directories.expr.data) {
                .e_object => |directories_obj| {
                    if (directories_obj.asProperty("bin")) |bin| {
                        if (bin.expr.asString(ctx.allocator)) |bin_str| {
                            const normalized = bun.path.normalizeBuf(bin_str, &path_buf, .posix);
                            try bins.append(ctx.allocator, .{
                                .path = try ctx.allocator.dupe(u8, normalized),
                                .type = .dir,
                            });
                        }
                    }
                },
                else => {},
            }
        }

        return bins.items;
    }

    fn isPackageBin(bins: []const BinInfo, maybe_bin_path: string) bool {
        for (bins) |bin| {
            switch (bin.type) {
                .file => {
                    if (strings.eqlLong(bin.path, maybe_bin_path, true)) {
                        return true;
                    }
                },
                .dir => {
                    const bin_without_trailing = strings.withoutTrailingSlash(bin.path);
                    if (strings.hasPrefix(maybe_bin_path, bin_without_trailing)) {
                        const remain = maybe_bin_path[bin_without_trailing.len..];
                        if (remain.len > 1 and remain[0] == '/' and !strings.containsChar(remain[1..], '/')) {
                            return true;
                        }
                    }
                },
            }
        }

        return false;
    }

    fn isExcluded(
        entry: DirIterator.IteratorResult,
        entry_subpath: stringZ,
        dir_depth: usize,
        ignores: []const IgnorePatterns,
    ) ?struct { []const u32, IgnorePatterns.Kind } {
        const entry_name = entry.name.slice();

        if (dir_depth == 1) {

            // TODO: should this be case insensitive on all platforms?
            const eql = if (comptime Environment.isLinux)
                strings.eqlComptime
            else
                strings.eqlCaseInsensitiveASCIIICheckLength;

            // first, check files that can never be ignored. project root directory only
            if (entry.kind == .file and
                (eql(entry_name, "package.json") or
                eql(entry_name, "LICENSE") or
                eql(entry_name, "LICENCE") or
                eql(entry_name, "README") or
                entry_name.len > "README.".len and eql(entry_name[0.."README.".len], "README.") or
                eql(entry_name, "CHANGELOG") or
                entry_name.len > "CHANGELOG.".len and eql(entry_name[0.."CHANGELOG.".len], "CHANGELOG.")))
                return null;

            // check default ignores that only apply to the root project directory
            for (root_default_ignore_patterns) |pattern| {
                switch (glob.matchImpl(pattern, entry_name)) {
                    .match => {
                        // cannot be reversed
                        return .{
                            pattern,
                            .default,
                        };
                    },

                    .no_match => {},

                    // default patterns don't use `!`
                    .negate_no_match => unreachable,
                    .negate_match => unreachable,
                }
            }
        }

        var ignore_pattern: []const u32 = &.{};
        var ignore_kind: IgnorePatterns.Kind = .@".npmignore";

        // then check default ignore list. None of the defaults contain slashes
        // so just match agaist entry name
        var ignored = false;

        for (default_ignore_patterns) |pattern_info| {
            const pattern, const can_override = pattern_info;
            switch (glob.matchImpl(pattern, entry_name)) {
                .match => {
                    if (can_override) {
                        ignored = true;
                        ignore_pattern = pattern;
                        ignore_kind = .default;

                        // break. doesnt matter if more default patterns
                        // match this path
                        break;
                    }

                    return .{
                        pattern,
                        .default,
                    };
                },
                .no_match => {},

                // default patterns don't use `!`
                .negate_no_match => unreachable,
                .negate_match => unreachable,
            }
        }

        // lastly, check each .npmignore/.gitignore from root directory to
        // the current directory.
        for (ignores) |ignore| {
            var rel = entry_subpath;
            if (ignore.has_rel_path) {
                // trim parent directories up to the directory
                // containing this ignore file
                for (1..ignore.depth) |_| {
                    if (strings.indexOfChar(rel, '/')) |sep| {
                        rel = rel[sep + 1 ..];
                    }
                }
            }
            for (ignore.list) |pattern| {
                if (pattern.dirs_only and entry.kind != .directory) continue;

                const match_path = if (pattern.rel_path) rel else entry_name;
                switch (glob.matchImpl(pattern.glob, match_path)) {
                    .match => {
                        ignored = true;
                        ignore_pattern = pattern.glob;
                        ignore_kind = ignore.kind;
                    },
                    .negate_no_match => ignored = false,
                    else => {},
                }
            }
        }

        return if (!ignored)
            null
        else
            .{
                ignore_pattern,
                ignore_kind,
            };
    }

    fn pack(
        ctx: *Context,
        package_json_path: stringZ,
        comptime enable_ansi_colors: bool,
    ) PackError!void {
        _ = enable_ansi_colors;
        const manager = ctx.manager;
        const json = switch (manager.workspace_package_json_cache.getWithPath(manager.allocator, manager.log, package_json_path, .{
            .guess_indentation = true,
        })) {
            .read_err => |err| {
                Output.err(err, "failed to read package.json: {s}", .{package_json_path});
                Global.crash();
            },
            .parse_err => |err| {
                Output.err(err, "failed to parse package.json: {s}", .{package_json_path});
                Global.crash();
            },
            .entry => |entry| entry,
        };

        const package_name_expr: Expr = json.root.get("name") orelse return error.MissingPackageName;
        const package_name = package_name_expr.asStringCloned(ctx.allocator) orelse return error.InvalidPackageName;
        defer ctx.allocator.free(package_name);

        const package_version_expr: Expr = json.root.get("version") orelse return error.MissingPackageVersion;
        const package_version = package_version_expr.asStringCloned(ctx.allocator) orelse return error.InvalidPackageVersion;
        defer ctx.allocator.free(package_version);

        var this_bundler: bun.bundler.Bundler = undefined;

        _ = RunCommand.configureEnvForRun(
            ctx.command_ctx,
            &this_bundler,
            manager.env,
            manager.options.log_level != .silent,
            false,
        ) catch |err| {
            switch (err) {
                error.OutOfMemory => |oom| return oom,
                else => {
                    Output.errGeneric("failed to run pack scripts due to error: {s}\n", .{@errorName(err)});
                    Global.crash();
                },
            }
        };

        const postpack_script: ?string = postpack_script: {
            const scripts = json.root.asProperty("scripts") orelse break :postpack_script null;
            if (scripts.expr.data != .e_object) break :postpack_script null;

            if (scripts.expr.get("prepack")) |prepack_script| {
                if (prepack_script.asString(ctx.allocator)) |prepack_script_str| {
                    _ = RunCommand.runPackageScriptForeground(
                        ctx.command_ctx,
                        ctx.allocator,
                        prepack_script_str,
                        "prepack",
                        FileSystem.instance.top_level_dir,
                        this_bundler.env,
                        &.{},
                        manager.options.log_level == .silent,
                        ctx.command_ctx.debug.use_system_shell,
                    ) catch |err| {
                        switch (err) {
                            error.MissingShell => {
                                Output.errGeneric("failed to find shell executable to run prepack script", .{});
                                Global.crash();
                            },
                            error.OutOfMemory => |oom| return oom,
                        }
                    };
                }
            }

            if (scripts.expr.get("prepare")) |prepare_script| {
                if (prepare_script.asString(ctx.allocator)) |prepare_script_str| {
                    _ = RunCommand.runPackageScriptForeground(
                        ctx.command_ctx,
                        ctx.allocator,
                        prepare_script_str,
                        "prepare",
                        FileSystem.instance.top_level_dir,
                        this_bundler.env,
                        &.{},
                        manager.options.log_level == .silent,
                        ctx.command_ctx.debug.use_system_shell,
                    ) catch |err| {
                        switch (err) {
                            error.MissingShell => {
                                Output.errGeneric("failed to find shell executable to run prepare script", .{});
                                Global.crash();
                            },
                            error.OutOfMemory => |oom| return oom,
                        }
                    };
                }
            }

            if (scripts.expr.get("postpack")) |postpack| {
                if (postpack.asString(ctx.allocator)) |postpack_str| {
                    break :postpack_script postpack_str;
                }
            }

            break :postpack_script null;
        };

        const package_json_dir = std.fs.path.dirname(package_json_path) orelse @panic("ooops");
        var root_dir = root_dir: {
            var path_buf: PathBuffer = undefined;
            @memcpy(path_buf[0..package_json_dir.len], package_json_dir);
            path_buf[package_json_dir.len] = 0;
            break :root_dir std.fs.openDirAbsoluteZ(path_buf[0..package_json_dir.len :0], .{
                .iterate = true,
            }) catch |err| {
                Output.err(err, "failed to open root directory: {s}\n", .{package_json_dir});
                Global.crash();
            };
        };
        defer root_dir.close();

        const bundled_deps: []const string = try getBundledDeps(ctx, json.root, "bundledDependencies") orelse
            try getBundledDeps(ctx, json.root, "bundleDependencies") orelse
            &.{};

        var pack_list, var bundled_pack_list = pack_lists: {
            if (json.root.get("files")) |files| {
                files_error: {
                    if (files.asArray()) |_files_array| {
                        var includes: std.ArrayListUnmanaged(Pattern) = .{};
                        defer includes.deinit(ctx.allocator);

                        var files_array = _files_array;
                        while (files_array.next()) |files_entry| {
                            if (files_entry.asStringZ(ctx.allocator)) |file_entry_str| {
                                if (glob.detectGlobSyntax(file_entry_str)) {
                                    Output.errGeneric("glob syntax is unsupported in package.json `files`", .{});
                                    Global.crash();
                                }

                                // TODO: support pattern matching in `files`
                                const parsed = try Pattern.fromUTF8(ctx, file_entry_str) orelse continue;

                                // try includes.append(ctx.allocator, file_entry_str);
                                try includes.append(ctx.allocator, parsed);
                                continue;
                            }

                            break :files_error;
                        }

                        break :pack_lists try iterateIncludedProjectTree(
                            ctx,
                            includes.items,
                            .{
                                root_dir,
                                "",
                                1,
                            },
                            false,
                        );
                    }
                }

                Output.errGeneric("expected `files` to be an array of string values", .{});
                Global.crash();
            }

            // pack from project root
            break :pack_lists try iterateProjectTree(
                ctx,
                bundled_deps,
                .{
                    root_dir,
                    "",
                    1,
                },
                false,
            );
        };
        defer {
            pack_list.deinit(ctx.allocator);
            bundled_pack_list.deinit(ctx.allocator);
        }

        if (manager.options.dry_run) {
            // don't create the tarball, but run scripts if they exists
            for (ctx.stats.successfully_bundled_deps.items) |dep| {
                Output.prettyln("<r><b><green>bundled<r> {s}", .{dep});
            }
            for (pack_list.items) |filename| {
                const file = File.openat(root_dir, filename, bun.O.RDONLY, 0).unwrap() catch |err| {
                    Output.err(err, "failed to open file: \"{s}\"", .{filename});
                    Global.crash();
                };
                defer file.close();
                const stat = file.stat().unwrap() catch |err| {
                    Output.err(err, "failed to stat file: \"{}\"", .{file.handle});
                    Global.crash();
                };
                Output.prettyln("<r><b><cyan>packing<r> {} {s}", .{ bun.fmt.size(stat.size, .{ .space_between_number_and_unit = false }), filename });
            }

            if (postpack_script) |postpack_script_str| {
                _ = RunCommand.runPackageScriptForeground(
                    ctx.command_ctx,
                    ctx.allocator,
                    postpack_script_str,
                    "postpack",
                    FileSystem.instance.top_level_dir,
                    manager.env,
                    &.{},
                    manager.options.log_level == .silent,
                    ctx.command_ctx.debug.use_system_shell,
                ) catch |err| {
                    switch (err) {
                        error.MissingShell => {
                            Output.errGeneric("failed to find shell executable to run postpack script", .{});
                            Global.crash();
                        },
                        error.OutOfMemory => |oom| return oom,
                    }
                };
            }
            return;
        }

        const bins = try getPackageBins(ctx, json.root);
        defer for (bins) |bin| ctx.allocator.free(bin.path);

        var read_buf: [8192]u8 = undefined;

        var print_buf = std.ArrayList(u8).init(ctx.allocator);
        defer print_buf.deinit();
        const print_buf_writer = print_buf.writer();

        var archive = Archive.writeNew();
        defer {
            switch (archive.writeClose()) {
                .failed, .fatal, .warn => {
                    Output.errGeneric("failed to close archive: {s}", .{archive.errorString()});
                    Global.crash();
                },
                else => {},
            }
            switch (archive.free()) {
                .failed, .fatal, .warn => {
                    Output.errGeneric("failed to free archive: {s}", .{archive.errorString()});
                    Global.crash();
                },
                else => {},
            }
        }

        switch (archive.writeSetFormatPaxRestricted()) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to set archive format to pax restricted: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }
        switch (archive.writeSetCompressionGzip()) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to set compression to gzip: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }
        switch (archive.writeAddFilterGzip()) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to set filter to gzip: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }

        // default is 9
        // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L12
        const compression_level = manager.options.pack_gzip_level orelse "9";
        try print_buf_writer.print("{s}\x00", .{compression_level});
        switch (archive.writeSetFilterOption(null, "compression-level", print_buf.items[0..compression_level.len :0])) {
            .failed, .fatal, .warn => {
                Output.errGeneric("compression level must be between 0 and 9, received {s}", .{compression_level});
                Global.crash();
            },
            else => {},
        }
        print_buf.clearRetainingCapacity();

        setupTarballDestination(ctx, archive, package_name, package_version);

        var entry = Archive.Entry.new();
        defer entry.free();

        for (ctx.stats.successfully_bundled_deps.items) |dep| {
            Output.prettyln("<r><b><green>bundled<r> {s}", .{dep});
        }

        entry = try editAndArchivePackageJSON(ctx, archive, entry, root_dir, json);

        for (pack_list.items) |filename| {
            const file = File.openat(root_dir, filename, bun.O.RDONLY, 0).unwrap() catch |err| {
                Output.err(err, "failed to open file: \"{s}\"", .{filename});
                Global.crash();
            };
            defer file.close();
            const stat = file.stat().unwrap() catch |err| {
                Output.err(err, "failed to stat file: \"{}\"", .{file.handle});
                Global.crash();
            };
            Output.prettyln("<r><b><cyan>packing<r> {} {s}", .{ bun.fmt.size(stat.size, .{ .space_between_number_and_unit = false }), filename });
            Output.flush();
            entry = try addArchiveEntry(ctx, file, stat, filename, &read_buf, archive, entry, &print_buf, bins);
        }

        for (bundled_pack_list.items) |filename| {
            const file = File.openat(root_dir, filename, bun.O.RDONLY, 0).unwrap() catch |err| {
                Output.err(err, "failed to open file: \"{s}\"", .{filename});
                Global.crash();
            };
            defer file.close();
            const stat = file.stat().unwrap() catch |err| {
                Output.err(err, "failed to stat file: \"{}\"", .{file.handle});
                Global.crash();
            };
            entry = try addArchiveEntry(ctx, file, stat, filename, &read_buf, archive, entry, &print_buf, bins);
        }

        if (postpack_script) |postpack_script_str| {
            _ = RunCommand.runPackageScriptForeground(
                ctx.command_ctx,
                ctx.allocator,
                postpack_script_str,
                "postpack",
                FileSystem.instance.top_level_dir,
                manager.env,
                &.{},
                manager.options.log_level == .silent,
                ctx.command_ctx.debug.use_system_shell,
            ) catch |err| {
                switch (err) {
                    error.MissingShell => {
                        Output.errGeneric("failed to find shell executable to run postpack script", .{});
                        Global.crash();
                    },
                    error.OutOfMemory => |oom| return oom,
                }
            };
        }
    }

    fn setupTarballDestination(
        ctx: *Context,
        archive: *Archive,
        package_name: string,
        package_version: string,
    ) void {
        var dest_buf: PathBuffer = undefined;
        const tarball_destination_dir = bun.path.joinAbsStringBufZ(
            FileSystem.instance.top_level_dir,
            &dest_buf,
            &.{ctx.manager.options.pack_destination},
            .posix,
        );

        // create the directory if it doesn't exist
        std.fs.makeDirAbsoluteZ(tarball_destination_dir) catch {};

        const tarball_name = std.fmt.bufPrint(dest_buf[strings.withoutTrailingSlash(tarball_destination_dir).len..], "/{s}-{s}.tgz\x00", .{
            package_name,
            package_version,
        }) catch {
            Output.errGeneric("archive destination name too long: \"{s}/{s}-{s}.tgz\"", .{
                strings.withoutTrailingSlash(tarball_destination_dir),
                package_name,
                package_version,
            });
            Global.crash();
        };
        const tarball_destination = dest_buf[0 .. strings.withoutTrailingSlash(tarball_destination_dir).len + tarball_name.len - 1 :0];

        switch (archive.writeOpenFilename(tarball_destination)) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to open tarball file descriptor: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }

        // TODO: experiment with `archive.writeOpenMemory()`
    }

    fn editAndArchivePackageJSON(
        ctx: *Context,
        archive: *Archive,
        entry: *Archive.Entry,
        root_dir: std.fs.Dir,
        json: *PackageManager.WorkspacePackageJSONCache.MapEntry,
    ) OOM!*Archive.Entry {
        const edited_package_json = try editRootPackageJSON(ctx, json);
        const package_json_file = File.openat(root_dir, "package.json", bun.O.RDONLY, 0).unwrap() catch |err| {
            Output.err(err, "failed to open package.json", .{});
            Global.crash();
        };
        defer package_json_file.close();

        Output.prettyln("<r><b><cyan>packing<r> {} package.json", .{bun.fmt.size(edited_package_json.len, .{ .space_between_number_and_unit = false })});
        Output.flush();

        const stat = package_json_file.stat().unwrap() catch |err| {
            Output.err(err, "failed to stat package.json", .{});
            Global.crash();
        };

        entry.setPathnameUtf8(package_prefix ++ "package.json");
        entry.setSize(@intCast(edited_package_json.len));
        // https://github.com/libarchive/libarchive/blob/898dc8319355b7e985f68a9819f182aaed61b53a/libarchive/archive_entry.h#L185
        entry.setFiletype(0o100000);
        // TODO: is this correct on windows?
        entry.setPerm(@intCast(stat.mode));
        // '1985-10-26T08:15:00.000Z'
        // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L28
        entry.setMtime(499162500, 0);

        switch (archive.writeHeader(entry)) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to write tarball header: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }

        _ = archive.writeData(edited_package_json);

        ctx.stats.total_unpacked_size += edited_package_json.len;
        ctx.stats.total_files += 1;

        return entry.clear();
    }

    fn addArchiveEntry(
        ctx: *Context,
        file: File,
        stat: bun.Stat,
        filename: stringZ,
        read_buf: []u8,
        archive: *Archive,
        entry: *Archive.Entry,
        print_buf: *std.ArrayList(u8),
        bins: []const BinInfo,
    ) OOM!*Archive.Entry {
        const print_buf_writer = print_buf.writer();

        try print_buf_writer.print("{s}{s}\x00", .{ package_prefix, filename });
        entry.setPathnameUtf8(print_buf_writer.context.items[0 .. package_prefix.len + filename.len :0]);
        print_buf_writer.context.clearRetainingCapacity();

        entry.setSize(@intCast(stat.size));

        // https://github.com/libarchive/libarchive/blob/898dc8319355b7e985f68a9819f182aaed61b53a/libarchive/archive_entry.h#L185
        entry.setFiletype(0o100000);

        var perm: bun.Mode = @intCast(stat.mode);
        // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L20
        if (isPackageBin(bins, filename)) perm |= 0o111;
        // TODO: is this correct on windows?
        entry.setPerm(@intCast(perm));

        // '1985-10-26T08:15:00.000Z'
        // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L28
        entry.setMtime(499162500, 0);

        switch (archive.writeHeader(entry)) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to write tarball header: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }

        var read = file.read(read_buf).unwrap() catch |err| {
            Output.err(err, "failed to read file: {s}", .{filename});
            Global.crash();
        };
        while (read > 0) {
            ctx.stats.total_unpacked_size += read;
            _ = archive.writeData(read_buf[0..read]);
            read = file.read(read_buf).unwrap() catch |err| {
                Output.err(err, "failed to read file: {s}", .{filename});
                Global.crash();
            };
        }

        ctx.stats.total_files += 1;

        return entry.clear();
    }

    /// Strip workspace protocols from dependency versions then
    /// returns the printed json
    fn editRootPackageJSON(
        ctx: *Context,
        json: *PackageManager.WorkspacePackageJSONCache.MapEntry,
    ) OOM!string {
        for ([_]string{
            "dependencies",
            "devDependencies",
            "peerDependencies",
            "optionalDependencies",
        }) |dependency_group| {
            if (json.root.get(dependency_group)) |dependencies_expr| {
                switch (dependencies_expr.data) {
                    .e_object => |dependencies| {
                        for (dependencies.properties.slice()) |*dependency| {
                            if (dependency.key == null) continue;
                            if (dependency.value == null) continue;

                            const package_spec = dependency.value.?.asString(ctx.allocator) orelse continue;
                            if (strings.withoutPrefixIfPossibleComptime(package_spec, "workspace:")) |without_workspace_protocol| {

                                // TODO: make semver parsing more strict. `^`, `~` are not valid
                                // const parsed = Semver.Version.parseUTF8(without_workspace_protocol);
                                // if (parsed.valid) {
                                //     dependency.value = Expr.allocate(
                                //         ctx.manager.allocator,
                                //         E.String,
                                //         .{
                                //             .data = without_workspace_protocol,
                                //         },
                                //         .{},
                                //     );
                                //     continue;
                                // }

                                if (without_workspace_protocol.len == 1) {
                                    // TODO: this might be too strict
                                    const c = without_workspace_protocol[0];
                                    if (c == '^' or c == '~' or c == '*') {
                                        const dependency_name = dependency.key.?.asString(ctx.allocator) orelse {
                                            Output.errGeneric("expected string value for dependency name in \"{s}\"", .{
                                                dependency_group,
                                            });
                                            Global.crash();
                                        };

                                        failed_to_resolve: {
                                            // find the current workspace version and append to package spec without `workspace:`
                                            const lockfile = ctx.lockfile orelse break :failed_to_resolve;

                                            const workspace_version = lockfile.workspace_versions.get(Semver.String.Builder.stringHash(dependency_name)) orelse break :failed_to_resolve;

                                            dependency.value = Expr.allocate(
                                                ctx.manager.allocator,
                                                E.String,
                                                .{
                                                    .data = try std.fmt.allocPrint(ctx.allocator, "{s}{}", .{
                                                        switch (c) {
                                                            '^' => "^",
                                                            '~' => "~",
                                                            '*' => "",
                                                            else => unreachable,
                                                        },
                                                        workspace_version.fmt(lockfile.buffers.string_bytes.items),
                                                    }),
                                                },
                                                .{},
                                            );

                                            continue;
                                        }

                                        // only produce this error only when we need to get the workspace version
                                        Output.errGeneric("Failed to resolve version for dependency \"{s}\" in \"{s}\". Run <cyan>`bun install`<r> and try again.", .{
                                            dependency_name,
                                            dependency_group,
                                        });
                                        Global.crash();
                                    }
                                }

                                dependency.value = Expr.allocate(
                                    ctx.manager.allocator,
                                    E.String,
                                    .{
                                        .data = try ctx.allocator.dupe(u8, without_workspace_protocol),
                                    },
                                    .{},
                                );
                            }
                        }
                    },
                    else => {},
                }
            }
        }

        const has_trailing_newline = json.source.contents.len > 0 and json.source.contents[json.source.contents.len - 1] == '\n';
        var buffer_writer = try js_printer.BufferWriter.init(ctx.allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(ctx.allocator, json.source.contents.len + 1);
        buffer_writer.append_newline = has_trailing_newline;
        var package_json_writer = js_printer.BufferPrinter.init(buffer_writer);

        const written = js_printer.printJSON(
            @TypeOf(&package_json_writer),
            &package_json_writer,
            json.root,

            // shouldn't be used
            &json.source,
            .{
                .indent = json.indentation,
            },
        ) catch |err| {
            return switch (err) {
                error.OutOfMemory => |oom| oom,
                else => {
                    Output.errGeneric("failed to print edited package.json: {s}", .{@errorName(err)});
                    Global.crash();
                },
            };
        };
        _ = written;

        return package_json_writer.ctx.writtenWithoutTrailingZero();
    }

    /// A pattern used to ignore or include
    /// files in the project tree. Might come
    /// from .npmignore, .gitignore, or `files`
    /// in package.json
    const Pattern = struct {
        glob: []const u32,
        /// beginning or middle slash (leading slash was trimmed)
        rel_path: bool,
        // can only match directories (had an ending slash, also trimmed)
        dirs_only: bool,

        pub fn fromUTF8(ctx: *Context, pattern: string) OOM!?Pattern {
            var remain = pattern;
            const has_leading_or_middle_slash, const has_trailing_slash, const add_negate = check_slashes: {
                const before_length = remain.len;

                // strip `!` and add one if any existed
                while (remain.len > 0 and remain[0] == '!') remain = remain[1..];

                const skipped_negate = before_length != remain.len;

                if (remain.len == 0) return null;

                // `**/foo` matches the same as `foo`
                if (strings.hasPrefixComptime(remain, "**/")) {
                    remain = remain["**/".len..];
                    if (remain.len == 0) return null;
                }

                const trailing_slash = remain[remain.len - 1] == '/';
                if (trailing_slash) {
                    // trim trailing slash
                    remain = remain[0 .. remain.len - 1];
                    if (remain.len == 0) return null;
                }

                var leading_or_middle_slash = remain[0] == '/';
                if (!leading_or_middle_slash) {
                    // check for middle slash
                    if (strings.indexOfChar(remain, '/')) |slash_index| {
                        leading_or_middle_slash = slash_index != remain.len - 1;
                    }
                } else {
                    // trim leading slash
                    remain = remain[1..];
                    if (remain.len == 0) return null;
                }

                break :check_slashes .{ leading_or_middle_slash, trailing_slash, skipped_negate };
            };

            const length = bun.simdutf.length.utf32.from.utf8.le(remain) + @intFromBool(add_negate);
            const buf = try ctx.allocator.alloc(u32, length);
            const result = bun.simdutf.convert.utf8.to.utf32.with_errors.le(remain, buf[@intFromBool(add_negate)..]);
            if (!result.isSuccessful()) {
                ctx.allocator.free(buf);
                return null;
            }

            if (add_negate) {
                buf[0] = '!';
            }

            return .{
                .glob = buf[0 .. result.count + @intFromBool(add_negate)],
                .rel_path = has_leading_or_middle_slash,
                .dirs_only = has_trailing_slash,
            };
        }

        pub fn deinit(this: Pattern, allocator: std.mem.Allocator) void {
            allocator.free(this.glob);
        }
    };

    pub const IgnorePatterns = struct {
        list: []const Pattern,
        kind: Kind,
        depth: usize,

        // At least one of the patterns has a leading
        // or middle slash. A relative path will need to
        // be created
        has_rel_path: bool,

        pub const Kind = enum {
            default,
            @".npmignore",
            @".gitignore",
        };

        pub const List = std.ArrayListUnmanaged(IgnorePatterns);

        fn ignoreFileFail(dir: std.fs.Dir, ignore_kind: Kind, reason: enum { read, open }, err: anyerror) noreturn {
            var buf: PathBuffer = undefined;
            const dir_path = bun.getFdPath(dir, &buf) catch "";
            Output.err(err, "failed to {s} {s} at: \"{s}{s}{s}\"", .{
                @tagName(reason),
                @tagName(ignore_kind),
                strings.withoutTrailingSlash(dir_path),
                std.fs.path.sep_str,
                @tagName(ignore_kind),
            });
            Global.crash();
        }

        fn trimTrailingSpaces(line: string) string {
            // TODO: copy this function
            // https://github.com/git/git/blob/17d4b10aea6bda2027047a0e3548a6f8ad667dde/dir.c#L986
            return line;
        }

        fn maybeTrimLeadingSpaces(line: string) string {
            // npm will trim, git will not
            return line;
        }

        pub fn readFromDisk(ctx: *Context, dir: std.fs.Dir, dir_depth: usize) OOM!?IgnorePatterns {
            var patterns: std.ArrayListUnmanaged(Pattern) = .{};
            errdefer patterns.deinit(ctx.allocator);

            var ignore_kind: Kind = .@".npmignore";

            const ignore_file = dir.openFileZ(".npmignore", .{}) catch |err| ignore_file: {
                if (err != error.FileNotFound) {
                    // Crash if the file exists and fails to open. Don't want to create a tarball
                    // with files you want to ignore.
                    ignoreFileFail(dir, ignore_kind, .open, err);
                }
                ignore_kind = .@".gitignore";
                break :ignore_file dir.openFileZ(".gitignore", .{}) catch |err2| {
                    if (err2 != error.FileNotFound) {
                        ignoreFileFail(dir, ignore_kind, .open, err2);
                    }

                    return null;
                };
            };
            defer ignore_file.close();

            const contents = File.from(ignore_file).readToEnd(ctx.allocator).unwrap() catch |err| {
                ignoreFileFail(dir, ignore_kind, .read, err);
            };
            defer ctx.allocator.free(contents);

            var has_rel_path = false;

            var iter = std.mem.tokenizeScalar(u8, contents, '\n');
            while (iter.next()) |line| {
                if (line.len == 0) continue;

                // comment
                if (line[0] == '#') continue;

                const trimmed = trimmed: {
                    var remain = line;
                    if (remain[remain.len - 1] == '\r') {
                        remain = remain[0 .. remain.len - 1];
                    }

                    break :trimmed trimTrailingSpaces(remain);
                };

                if (trimmed.len == 0) continue;

                const parsed = try Pattern.fromUTF8(ctx, trimmed) orelse continue;
                try patterns.append(ctx.allocator, parsed);

                has_rel_path = has_rel_path or parsed.rel_path;
            }

            if (patterns.items.len == 0) return null;

            return .{
                .list = patterns.items,
                .kind = ignore_kind,
                .depth = dir_depth,
                .has_rel_path = has_rel_path,
            };
        }

        pub fn deinit(this: *const IgnorePatterns, allocator: std.mem.Allocator) void {
            for (this.list) |pattern_info| {
                allocator.free(pattern_info.glob);
            }
            allocator.free(this.list);
        }
    };
};
