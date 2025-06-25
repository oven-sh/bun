const std = @import("std");
const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const Command = bun.CLI.Command;
const Install = bun.install;
const PackageManager = Install.PackageManager;
const Lockfile = Install.Lockfile;
const string = bun.string;
const stringZ = bun.stringZ;
const libarchive = @import("../libarchive/libarchive.zig").lib;
const Archive = libarchive.Archive;
const Expr = bun.js_parser.Expr;
const Semver = bun.Semver;
const File = bun.sys.File;
const FD = bun.FD;
const strings = bun.strings;
const glob = bun.glob;
const PathBuffer = bun.PathBuffer;
const DirIterator = bun.DirIterator;
const Environment = bun.Environment;
const RunCommand = bun.RunCommand;
const OOM = bun.OOM;
const js_printer = bun.js_printer;
const E = bun.js_parser.E;
const Progress = bun.Progress;
const JSON = bun.JSON;
const sha = bun.sha;
const LogLevel = PackageManager.Options.LogLevel;
const FileDescriptor = bun.FileDescriptor;
const Publish = bun.CLI.PublishCommand;
const Dependency = Install.Dependency;
const CowString = bun.ptr.CowString;

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

        bundled_deps: std.ArrayListUnmanaged(BundledDep) = .{},

        stats: Stats = .{},

        const Stats = struct {
            unpacked_size: usize = 0,
            total_files: usize = 0,
            ignored_files: usize = 0,
            ignored_directories: usize = 0,
            packed_size: usize = 0,
            bundled_deps: usize = 0,
        };

        pub fn printSummary(
            stats: Stats,
            maybe_shasum: ?[sha.SHA1.digest]u8,
            maybe_integrity: ?[sha.SHA512.digest]u8,
            log_level: LogLevel,
        ) void {
            if (log_level != .silent) {
                Output.prettyln("\n<r><b><blue>Total files<r>: {d}", .{stats.total_files});
                if (maybe_shasum) |shasum| {
                    Output.prettyln("<b><blue>Shasum<r>: {s}", .{std.fmt.bytesToHex(shasum, .lower)});
                }
                if (maybe_integrity) |integrity| {
                    Output.prettyln("<b><blue>Integrity<r>: {}", .{bun.fmt.integrity(integrity, .short)});
                }
                Output.prettyln("<b><blue>Unpacked size<r>: {}", .{
                    bun.fmt.size(stats.unpacked_size, .{ .space_between_number_and_unit = false }),
                });
                if (stats.packed_size > 0) {
                    Output.pretty("<b><blue>Packed size<r>: {}\n", .{
                        bun.fmt.size(stats.packed_size, .{ .space_between_number_and_unit = false }),
                    });
                }
                if (stats.bundled_deps > 0) {
                    Output.pretty("<b><blue>Bundled deps<r>: {d}\n", .{stats.bundled_deps});
                }
            }
        }
    };

    pub const BundledDep = struct {
        name: string,
        was_packed: bool = false,
        from_root_package_json: bool,
    };

    pub fn execWithManager(ctx: Command.Context, manager: *PackageManager) !void {
        Output.prettyln("<r><b>bun pack <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
        Output.flush();

        var lockfile: Lockfile = undefined;
        const load_from_disk_result = lockfile.loadFromCwd(
            manager,
            manager.allocator,
            manager.log,
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

                    if (manager.log.hasErrors()) {
                        try manager.log.print(Output.errorWriter());
                    }

                    Global.crash();
                },
                else => null,
            },
        };

        // var arena = std.heap.ArenaAllocator.init(ctx.allocator);
        // defer arena.deinit();

        // if (manager.options.filter_patterns.len > 0) {
        //     // TODO: --filter
        //     // loop, convert, find matching workspaces, then pack each
        //     return;
        // }

        // just pack the current workspace
        pack(&pack_ctx, manager.original_package_json_path, false) catch |err| {
            switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
                error.MissingPackageName, error.MissingPackageVersion => {
                    Output.errGeneric("package.json must have `name` and `version` fields", .{});
                    Global.crash();
                },
                error.InvalidPackageName, error.InvalidPackageVersion => {
                    Output.errGeneric("package.json `name` and `version` fields must be non-empty strings", .{});
                    Global.crash();
                },
                error.MissingPackageJSON => {
                    Output.errGeneric("failed to find a package.json in: \"{s}\"", .{manager.original_package_json_path});
                    Global.crash();
                },
            }
        };
    }

    pub fn exec(ctx: Command.Context) !void {
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

    pub fn PackError(comptime for_publish: bool) type {
        return OOM || error{
            MissingPackageName,
            InvalidPackageName,
            MissingPackageVersion,
            InvalidPackageVersion,
            MissingPackageJSON,
        } ||
            if (for_publish) error{
                RestrictedUnscopedPackage,
                PrivatePackage,
            } else error{};
    }

    const package_prefix = "package/";

    const root_default_ignore_patterns = [_][]const u8{
        &.{ 112, 97, 99, 107, 97, 103, 101, 45, 108, 111, 99, 107, 46, 106, 115, 111, 110 }, // package-lock.json
        &.{ 121, 97, 114, 110, 46, 108, 111, 99, 107 }, // yarn.lock
        &.{ 112, 110, 112, 109, 45, 108, 111, 99, 107, 46, 121, 97, 109, 108 }, // pnpm-lock.yaml
        &.{ 'b', 'u', 'n', '.', 'l', 'o', 'c', 'k', 'b' }, // bun.lockb
        &.{ 'b', 'u', 'n', '.', 'l', 'o', 'c', 'k' },
    };

    // pattern, can override
    const default_ignore_patterns = [_]struct { []const u8, bool }{
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

        .{ &.{ '.', 'e', 'n', 'v', '.', 'p', 'r', 'o', 'd', 'u', 'c', 't', 'i', 'o', 'n' }, true },
        .{ &.{ 'b', 'u', 'n', 'f', 'i', 'g', '.', 't', 'o', 'm', 'l' }, true },
    };

    const PackListEntry = struct {
        subpath: stringZ,
        size: usize = 0,
    };
    const PackList = std.ArrayListUnmanaged(PackListEntry);

    const PackQueueContext = struct {
        pub fn lessThan(_: void, a: string, b: string) std.math.Order {
            return strings.order(a, b);
        }
    };

    const PackQueue = std.PriorityQueue(stringZ, void, PackQueueContext.lessThan);

    const DirInfo = struct {
        std.fs.Dir, // the dir
        string, // the dir subpath
        usize, // dir depth. used to shrink ignore stack
    };

    fn iterateIncludedProjectTree(
        allocator: std.mem.Allocator,
        includes: []const Pattern,
        excludes: []const Pattern,
        root_dir: std.fs.Dir,
        log_level: LogLevel,
    ) OOM!PackQueue {
        if (comptime Environment.isDebug) {
            for (excludes) |exclude| {
                bun.assertf(exclude.flags.negated, "Illegal exclusion pattern '{s}'. Exclusion patterns are always negated.", .{exclude.glob});
            }
        }

        var pack_queue = PackQueue.init(allocator, {});

        var ignores: std.ArrayListUnmanaged(IgnorePatterns) = .{};
        defer ignores.deinit(allocator);

        var dirs: std.ArrayListUnmanaged(DirInfo) = .{};
        defer dirs.deinit(allocator);

        try dirs.append(allocator, .{ root_dir, "", 1 });

        var included_dirs: std.ArrayListUnmanaged(DirInfo) = .{};
        defer included_dirs.deinit(allocator);

        var subpath_dedupe = bun.StringHashMap(void).init(allocator);
        defer subpath_dedupe.deinit();

        // first find included dirs and files
        while (dirs.pop()) |dir_info| {
            var dir, const dir_subpath, const dir_depth = dir_info;
            defer {
                if (dir_depth != 1) {
                    dir.close();
                }
            }

            var dir_iter = DirIterator.iterate(dir, .u8);
            while (dir_iter.next().unwrap() catch null) |entry| {
                if (entry.kind != .file and entry.kind != .directory) continue;

                const entry_name = entry.name.slice();
                const entry_subpath = try entrySubpath(allocator, dir_subpath, entry_name);

                var included = false;
                var is_unconditionally_included = false;

                if (dir_depth == 1) {
                    if (strings.eqlComptime(entry_name, "package.json")) continue;
                    if (strings.eqlComptime(entry_name, "node_modules")) continue;

                    if (entry.kind == .file and isUnconditionallyIncludedFile(entry_name)) {
                        included = true;
                        is_unconditionally_included = true;
                    }
                }

                if (!included) {
                    for (includes) |include| {
                        if (include.flags.dirs_only and entry.kind != .directory) continue;

                        // include patters are not recursive unless they start with `**/`
                        // normally the behavior of `index.js` and `**/index.js` are the same,
                        // but includes require `**/`
                        const match_path = if (include.flags.@"leading **/") entry_name else entry_subpath;
                        switch (glob.walk.matchImpl(allocator, include.glob.slice(), match_path)) {
                            .match => included = true,
                            .negate_no_match, .negate_match => unreachable,
                            else => {},
                        }
                    }
                }

                // There may be a "narrowing" exclusion that excludes a subset
                // of files within an included directory/pattern.
                if (included and !is_unconditionally_included and excludes.len > 0) {
                    for (excludes) |exclude| {
                        if (exclude.flags.dirs_only and entry.kind != .directory) continue;

                        const match_path = if (exclude.flags.@"leading **/") entry_name else entry_subpath;
                        // NOTE: These patterns have `!` so `.match` logic is
                        // inverted here
                        switch (glob.walk.matchImpl(allocator, exclude.glob.slice(), match_path)) {
                            .negate_no_match => included = false,
                            else => {},
                        }
                    }
                }

                // TODO: do not traverse directories that match patterns
                // excluding all files within them (e.g. `!test/**`)
                if (!included) {
                    if (entry.kind == .directory) {
                        const subdir = openSubdir(dir, entry_name, entry_subpath);
                        try dirs.append(allocator, .{ subdir, entry_subpath, dir_depth + 1 });
                    }

                    continue;
                }

                switch (entry.kind) {
                    .directory => {
                        const subdir = openSubdir(dir, entry_name, entry_subpath);
                        try included_dirs.append(allocator, .{ subdir, entry_subpath, dir_depth + 1 });
                    },
                    .file => {
                        const dedupe_entry = try subpath_dedupe.getOrPut(entry_subpath);
                        bun.assertWithLocation(!dedupe_entry.found_existing, @src());
                        if (dedupe_entry.found_existing) continue;

                        try pack_queue.add(entry_subpath);
                    },
                    else => unreachable,
                }
            }
        }

        // for each included dir, traverse it's entries, exclude any with `negate_no_match`.
        for (included_dirs.items) |included_dir_info| {
            try addEntireTree(
                allocator,
                excludes,
                included_dir_info,
                &pack_queue,
                &subpath_dedupe,
                log_level,
            );
        }

        return pack_queue;
    }

    /// Adds all files in a directory tree to `pack_list` (default ignores still apply)
    fn addEntireTree(
        allocator: std.mem.Allocator,
        excludes: []const Pattern,
        root_dir_info: DirInfo,
        pack_queue: *PackQueue,
        maybe_dedupe: ?*bun.StringHashMap(void),
        log_level: LogLevel,
    ) OOM!void {
        var dirs: std.ArrayListUnmanaged(DirInfo) = .{};
        defer dirs.deinit(allocator);

        try dirs.append(allocator, root_dir_info);

        var ignores: std.ArrayListUnmanaged(IgnorePatterns) = .{};
        defer ignores.deinit(allocator);

        var negated_excludes: std.ArrayListUnmanaged(Pattern) = .{};
        defer negated_excludes.deinit(allocator);

        if (excludes.len > 0) {
            try negated_excludes.ensureTotalCapacityPrecise(allocator, excludes.len);
            for (excludes) |exclude| {
                try negated_excludes.append(allocator, exclude.asPositive());
            }
            try ignores.append(allocator, IgnorePatterns{
                .list = negated_excludes.items,
                .kind = .@"package.json",
                .depth = 1,
                // always assume no relative path b/c matching is done from the
                // root directory
                .has_rel_path = false,
            });
        }

        while (dirs.pop()) |dir_info| {
            var dir, const dir_subpath, const dir_depth = dir_info;
            defer dir.close();

            while (ignores.getLastOrNull()) |last| {
                if (last.depth < dir_depth) break;

                last.deinit(allocator);
                ignores.items.len -= 1;
            }

            if (try IgnorePatterns.readFromDisk(allocator, dir, dir_depth)) |patterns| {
                try ignores.append(allocator, patterns);
            }

            if (comptime Environment.isDebug) {
                // make sure depths are in order
                if (ignores.items.len > 0) {
                    for (1..ignores.items.len) |i| {
                        bun.assertWithLocation(ignores.items[i - 1].depth < ignores.items[i].depth, @src());
                    }
                }
            }

            var iter = DirIterator.iterate(dir, .u8);
            while (iter.next().unwrap() catch null) |entry| {
                if (entry.kind != .file and entry.kind != .directory) continue;

                const entry_name = entry.name.slice();
                const entry_subpath = try entrySubpath(allocator, dir_subpath, entry_name);

                if (dir_depth == root_dir_info[2]) {
                    if (entry.kind == .directory and strings.eqlComptime(entry_name, "node_modules")) continue;
                }

                if (isExcluded(entry, entry_subpath, dir_depth, ignores.items)) |used_pattern_info| {
                    if (log_level.isVerbose()) {
                        const pattern, const kind = used_pattern_info;
                        Output.prettyln("<r><blue>ignore<r> <d>[{s}:{s}]<r> {s}{s}", .{
                            @tagName(kind),
                            pattern,
                            entry_subpath,
                            if (entry.kind == .directory) "/" else "",
                        });
                        Output.flush();
                    }
                    continue;
                }

                switch (entry.kind) {
                    .file => {
                        if (maybe_dedupe) |dedupe| {
                            const dedupe_entry = try dedupe.getOrPut(entry_subpath);
                            if (dedupe_entry.found_existing) continue;
                        }
                        try pack_queue.add(entry_subpath);
                    },
                    .directory => {
                        const subdir = openSubdir(dir, entry_name, entry_subpath);

                        try dirs.append(allocator, .{
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

    fn openSubdir(
        dir: std.fs.Dir,
        entry_name: string,
        entry_subpath: stringZ,
    ) std.fs.Dir {
        return dir.openDirZ(
            entryNameZ(entry_name, entry_subpath),
            .{ .iterate = true },
        ) catch |err| {
            Output.err(err, "failed to open directory \"{s}\" for packing", .{entry_subpath});
            Global.crash();
        };
    }

    fn entrySubpath(
        allocator: std.mem.Allocator,
        dir_subpath: string,
        entry_name: string,
    ) OOM!stringZ {
        return std.fmt.allocPrintZ(allocator, "{s}{s}{s}", .{
            dir_subpath,
            if (dir_subpath.len == 0) "" else "/",
            entry_name,
        });
    }

    fn entryNameZ(
        entry_name: string,
        entry_subpath: stringZ,
    ) stringZ {
        // doing this because `entry_subpath` has a sentinel and I don't trust `entry.name.sliceAssumeZ()`
        return entry_subpath[entry_subpath.len - entry_name.len ..][0..entry_name.len :0];
    }

    fn iterateBundledDeps(
        ctx: *Context,
        root_dir: std.fs.Dir,
        log_level: LogLevel,
    ) OOM!PackQueue {
        var bundled_pack_queue = PackQueue.init(ctx.allocator, {});
        if (ctx.bundled_deps.items.len == 0) return bundled_pack_queue;

        var dir = root_dir.openDirZ("node_modules", .{ .iterate = true }) catch |err| {
            switch (err) {
                // ignore node_modules if it isn't a directory, or doesn't exist
                error.NotDir, error.FileNotFound => return bundled_pack_queue,

                else => {
                    Output.err(err, "failed to open \"node_modules\" to pack bundled dependencies", .{});
                    Global.crash();
                },
            }
        };
        defer dir.close();

        // A set of bundled dependency locations
        // - node_modules/is-even
        // - node_modules/is-even/node_modules/is-odd
        // - node_modules/is-odd
        // - ...
        var dedupe = bun.StringHashMap(void).init(ctx.allocator);
        defer dedupe.deinit();

        var additional_bundled_deps: std.ArrayListUnmanaged(DirInfo) = .{};
        defer additional_bundled_deps.deinit(ctx.allocator);

        var iter = DirIterator.iterate(dir, .u8);
        while (iter.next().unwrap() catch null) |entry| {
            if (entry.kind != .directory) continue;

            const _entry_name = entry.name.slice();

            if (strings.startsWithChar(_entry_name, '@')) {
                const concat = try entrySubpath(ctx.allocator, "node_modules", _entry_name);

                var scoped_dir = root_dir.openDirZ(concat, .{ .iterate = true }) catch {
                    continue;
                };
                defer scoped_dir.close();

                var scoped_iter = DirIterator.iterate(scoped_dir, .u8);
                while (scoped_iter.next().unwrap() catch null) |sub_entry| {
                    const entry_name = try entrySubpath(ctx.allocator, _entry_name, sub_entry.name.slice());

                    for (ctx.bundled_deps.items) |*dep| {
                        bun.assertWithLocation(dep.from_root_package_json, @src());
                        if (!strings.eqlLong(entry_name, dep.name, true)) continue;

                        const entry_subpath = try entrySubpath(ctx.allocator, "node_modules", entry_name);

                        const dedupe_entry = try dedupe.getOrPut(entry_subpath);
                        if (dedupe_entry.found_existing) {
                            // already got to it in `addBundledDep` below
                            dep.was_packed = true;
                            break;
                        }

                        const subdir = openSubdir(dir, entry_name, entry_subpath);
                        dep.was_packed = true;
                        try addBundledDep(
                            ctx,
                            root_dir,
                            .{ subdir, entry_subpath, 2 },
                            &bundled_pack_queue,
                            &dedupe,
                            &additional_bundled_deps,
                            log_level,
                        );

                        break;
                    }
                }
            } else {
                const entry_name = _entry_name;
                for (ctx.bundled_deps.items) |*dep| {
                    bun.assertWithLocation(dep.from_root_package_json, @src());
                    if (!strings.eqlLong(entry_name, dep.name, true)) continue;

                    const entry_subpath = try entrySubpath(ctx.allocator, "node_modules", entry_name);

                    const dedupe_entry = try dedupe.getOrPut(entry_subpath);
                    if (dedupe_entry.found_existing) {
                        // already got to it in `addBundledDep` below
                        dep.was_packed = true;
                        break;
                    }

                    const subdir = openSubdir(dir, entry_name, entry_subpath);
                    dep.was_packed = true;
                    try addBundledDep(
                        ctx,
                        root_dir,
                        .{ subdir, entry_subpath, 2 },
                        &bundled_pack_queue,
                        &dedupe,
                        &additional_bundled_deps,
                        log_level,
                    );

                    break;
                }
            }
        }

        while (additional_bundled_deps.pop()) |bundled_dir_info| {
            const dir_subpath = bundled_dir_info[1];
            const maybe_slash = strings.lastIndexOfChar(dir_subpath, '/');
            bun.assertWithLocation(maybe_slash != null, @src());
            const dep_name: string = if (maybe_slash) |slash| dir_subpath[slash + 1 ..] else dir_subpath;

            try ctx.bundled_deps.append(ctx.allocator, .{
                .name = dep_name,
                .from_root_package_json = false,
                .was_packed = true,
            });

            try addBundledDep(
                ctx,
                root_dir,
                bundled_dir_info,
                &bundled_pack_queue,
                &dedupe,
                &additional_bundled_deps,
                log_level,
            );
        }

        return bundled_pack_queue;
    }

    fn addBundledDep(
        ctx: *Context,
        root_dir: std.fs.Dir,
        bundled_dir_info: DirInfo,
        bundled_pack_queue: *PackQueue,
        dedupe: *bun.StringHashMap(void),
        additional_bundled_deps: *std.ArrayListUnmanaged(DirInfo),
        log_level: LogLevel,
    ) OOM!void {
        ctx.stats.bundled_deps += 1;

        var dirs: std.ArrayListUnmanaged(DirInfo) = .{};
        defer dirs.deinit(ctx.allocator);

        try dirs.append(ctx.allocator, bundled_dir_info);

        while (dirs.pop()) |dir_info| {
            var dir, const dir_subpath, const dir_depth = dir_info;
            defer dir.close();

            var iter = DirIterator.iterate(dir, .u8);
            while (iter.next().unwrap() catch null) |entry| {
                if (entry.kind != .file and entry.kind != .directory) continue;

                const entry_name = entry.name.slice();
                const entry_subpath = try entrySubpath(ctx.allocator, dir_subpath, entry_name);

                if (dir_depth == bundled_dir_info[2]) root_depth: {
                    if (strings.eqlComptime(entry_name, "package.json")) {
                        if (entry.kind != .file) break :root_depth;
                        // find more dependencies to bundle
                        const source = &(File.toSourceAt(dir, entryNameZ(entry_name, entry_subpath), ctx.allocator, .{}).unwrap() catch |err| {
                            Output.err(err, "failed to read package.json: \"{s}\"", .{entry_subpath});
                            Global.crash();
                        });

                        const json = JSON.parsePackageJSONUTF8(source, ctx.manager.log, ctx.allocator) catch
                            break :root_depth;

                        // for each dependency in `dependencies` find the closest node_modules folder
                        // with the dependency name as a dir entry, starting from the node_modules of the
                        // current bundled dependency

                        for ([_]string{ "dependencies", "optionalDependencies" }) |dependency_group| {
                            const dependencies_expr = json.get(dependency_group) orelse continue;
                            if (dependencies_expr.data != .e_object) continue;

                            const dependencies = dependencies_expr.data.e_object;
                            next_dep: for (dependencies.properties.slice()) |dep| {
                                if (dep.key == null) continue;
                                if (dep.value == null) continue;

                                const dep_name = dep.key.?.asString(ctx.allocator) orelse continue;

                                const dep_subpath = try std.fmt.allocPrintZ(ctx.allocator, "{s}/node_modules/{s}", .{
                                    dir_subpath,
                                    dep_name,
                                });

                                // starting at `node_modules/is-even/node_modules/is-odd`
                                var dep_dir_depth: usize = bundled_dir_info[2] + 2;

                                if (root_dir.openDirZ(dep_subpath, .{ .iterate = true })) |dep_dir| {
                                    const dedupe_entry = try dedupe.getOrPut(dep_subpath);
                                    if (dedupe_entry.found_existing) continue;

                                    try additional_bundled_deps.append(ctx.allocator, .{ dep_dir, dep_subpath, dep_dir_depth });
                                } else |_| {
                                    // keep searching

                                    // slice off the `node_modules` from above
                                    var remain: []u8 = dep_subpath[0..dir_subpath.len];

                                    while (strings.lastIndexOf(remain, "node_modules")) |node_modules_start| {
                                        dep_dir_depth -= 2;
                                        const node_modules_end = node_modules_start + "node_modules".len;
                                        dep_subpath[node_modules_end] = '/';
                                        @memcpy(dep_subpath[node_modules_end + 1 ..][0..dep_name.len], dep_name);
                                        dep_subpath[node_modules_end + 1 + dep_name.len] = 0;
                                        const parent_dep_subpath = dep_subpath[0 .. node_modules_end + 1 + dep_name.len :0];
                                        remain = remain[0..node_modules_start];

                                        const parent_dep_dir = root_dir.openDirZ(parent_dep_subpath, .{ .iterate = true }) catch continue;

                                        const dedupe_entry = try dedupe.getOrPut(parent_dep_subpath);
                                        if (dedupe_entry.found_existing) continue :next_dep;

                                        try additional_bundled_deps.append(ctx.allocator, .{ parent_dep_dir, parent_dep_subpath, dep_dir_depth });
                                        continue :next_dep;
                                    }
                                }
                            }
                        }

                        break :root_depth;
                    }

                    if (strings.eqlComptime(entry_name, "node_modules")) continue;
                }

                if (isExcluded(entry, entry_subpath, dir_depth, &.{})) |used_pattern_info| {
                    if (log_level.isVerbose()) {
                        const pattern, const kind = used_pattern_info;
                        Output.prettyln("<r><blue>ignore<r> <d>[{s}:{s}]<r> {s}{s}", .{
                            @tagName(kind),
                            pattern,
                            entry_subpath,
                            if (entry.kind == .directory) "/" else "",
                        });
                        Output.flush();
                    }
                    continue;
                }

                switch (entry.kind) {
                    .file => {
                        try bundled_pack_queue.add(entry_subpath);
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
    }

    /// Returns a list of files to pack and another list of files from bundled dependencies
    fn iterateProjectTree(
        allocator: std.mem.Allocator,
        root_dir: std.fs.Dir,
        log_level: LogLevel,
    ) OOM!PackQueue {
        var pack_queue = PackQueue.init(allocator, {});

        var ignores: std.ArrayListUnmanaged(IgnorePatterns) = .{};
        defer ignores.deinit(allocator);

        // Stacks and depth-first traversal. Doing so means we can push and pop from
        // ignore patterns without needing to clone the entire list for future use.
        var dirs: std.ArrayListUnmanaged(DirInfo) = .{};
        defer dirs.deinit(allocator);

        try dirs.append(allocator, .{ root_dir, "", 1 });

        while (dirs.pop()) |dir_info| {
            var dir, const dir_subpath, const dir_depth = dir_info;
            defer {
                if (dir_depth != 1) {
                    dir.close();
                }
            }

            while (ignores.getLastOrNull()) |last| {
                if (last.depth < dir_depth) break;

                // pop patterns from files greater than or equal to the current depth.
                last.deinit(allocator);
                ignores.items.len -= 1;
            }

            if (try IgnorePatterns.readFromDisk(allocator, dir, dir_depth)) |patterns| {
                try ignores.append(allocator, patterns);
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
                const entry_subpath = try entrySubpath(allocator, dir_subpath, entry_name);

                if (dir_depth == 1) {
                    // Special case root package.json. It is always included
                    // and is possibly edited, so it's easier to handle it
                    // separately
                    if (strings.eqlComptime(entry_name, "package.json")) continue;

                    // bundled dependencies are included only if they exist on disk.
                    // handled later for simplicity
                    if (strings.eqlComptime(entry_name, "node_modules")) continue;
                }

                if (isExcluded(entry, entry_subpath, dir_depth, ignores.items)) |used_pattern_info| {
                    if (log_level.isVerbose()) {
                        const pattern, const kind = used_pattern_info;
                        Output.prettyln("<r><blue>ignore<r> <d>[{s}:{s}]<r> {s}{s}", .{
                            @tagName(kind),
                            pattern,
                            entry_subpath,
                            if (entry.kind == .directory) "/" else "",
                        });
                        Output.flush();
                    }
                    continue;
                }

                switch (entry.kind) {
                    .file => {
                        bun.assertWithLocation(entry_subpath.len > 0, @src());
                        try pack_queue.add(entry_subpath);
                    },
                    .directory => {
                        const subdir = openSubdir(dir, entry_name, entry_subpath);

                        try dirs.append(allocator, .{
                            subdir,
                            entry_subpath,
                            dir_depth + 1,
                        });
                    },
                    else => unreachable,
                }
            }
        }

        return pack_queue;
    }

    fn getBundledDeps(
        allocator: std.mem.Allocator,
        json: Expr,
        comptime field: string,
    ) OOM!?std.ArrayListUnmanaged(BundledDep) {
        var deps: std.ArrayListUnmanaged(BundledDep) = .{};
        const bundled_deps = json.get(field) orelse return null;

        invalid_field: {
            switch (bundled_deps.data) {
                .e_array => {
                    var iter = bundled_deps.asArray() orelse return .{};

                    while (iter.next()) |bundled_dep_item| {
                        const bundled_dep = try bundled_dep_item.asStringCloned(allocator) orelse break :invalid_field;
                        try deps.append(allocator, .{
                            .name = bundled_dep,
                            .from_root_package_json = true,
                        });
                    }
                },
                .e_boolean => {
                    const b = bundled_deps.asBool() orelse return .{};
                    if (!b == true) return .{};

                    if (json.get("dependencies")) |dependencies_expr| {
                        switch (dependencies_expr.data) {
                            .e_object => |dependencies| {
                                for (dependencies.properties.slice()) |*dependency| {
                                    if (dependency.key == null) continue;
                                    if (dependency.value == null) continue;

                                    const bundled_dep = try dependency.key.?.asStringCloned(allocator) orelse break :invalid_field;
                                    try deps.append(allocator, .{
                                        .name = bundled_dep,
                                        .from_root_package_json = true,
                                    });
                                }
                            },
                            else => {},
                        }
                    }
                },
                else => break :invalid_field,
            }

            return deps;
        }

        Output.errGeneric("expected `{s}` to be a boolean or an array of strings", .{field});
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
        allocator: std.mem.Allocator,
        json: Expr,
    ) OOM![]const BinInfo {
        var bins: std.ArrayListUnmanaged(BinInfo) = .{};

        var path_buf: PathBuffer = undefined;

        if (json.asProperty("bin")) |bin| {
            if (bin.expr.asString(allocator)) |bin_str| {
                const normalized = bun.path.normalizeBuf(bin_str, &path_buf, .posix);
                try bins.append(allocator, .{
                    .path = try allocator.dupe(u8, normalized),
                    .type = .file,
                });
                return bins.items;
            }

            switch (bin.expr.data) {
                .e_object => |bin_obj| {
                    if (bin_obj.properties.len == 0) return &.{};

                    for (bin_obj.properties.slice()) |bin_prop| {
                        if (bin_prop.value) |bin_prop_value| {
                            if (bin_prop_value.asString(allocator)) |bin_str| {
                                const normalized = bun.path.normalizeBuf(bin_str, &path_buf, .posix);
                                try bins.append(allocator, .{
                                    .path = try allocator.dupe(u8, normalized),
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
                        if (bin.expr.asString(allocator)) |bin_str| {
                            const normalized = bun.path.normalizeBuf(bin_str, &path_buf, .posix);
                            try bins.append(allocator, .{
                                .path = try allocator.dupe(u8, normalized),
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
    ) ?struct { []const u8, IgnorePatterns.Kind } {
        const entry_name = entry.name.slice();

        if (dir_depth == 1) {
            // first, check files that can never be ignored. project root
            // directory only
            if (isUnconditionallyIncludedFile(entry_name) or isSpecialFileOrVariant(entry_name, "CHANGELOG")) {
                return null;
            }

            // check default ignores that only apply to the root project directory
            for (root_default_ignore_patterns) |pattern| {
                switch (glob.walk.matchImpl(bun.default_allocator, pattern, entry_name)) {
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

        var ignore_pattern: []const u8 = &.{};
        var ignore_kind: IgnorePatterns.Kind = .@".npmignore";

        // then check default ignore list. None of the defaults contain slashes
        // so just match agaist entry name
        var ignored = false;

        for (default_ignore_patterns) |pattern_info| {
            const pattern, const can_override = pattern_info;
            switch (glob.walk.matchImpl(bun.default_allocator, pattern, entry_name)) {
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
                if (pattern.flags.dirs_only and entry.kind != .directory) continue;

                const match_path = if (pattern.flags.rel_path) rel else entry_name;
                switch (glob.walk.matchImpl(bun.default_allocator, pattern.glob.slice(), match_path)) {
                    .match => {
                        ignored = true;
                        ignore_pattern = pattern.glob.slice();
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

    const BufferedFileReader = std.io.BufferedReader(1024 * 512, File.Reader);

    pub fn pack(
        ctx: *Context,
        abs_package_json_path: stringZ,
        comptime for_publish: bool,
    ) PackError(for_publish)!if (for_publish) Publish.Context(true) else void {
        const manager = ctx.manager;
        const log_level = manager.options.log_level;
        const json = switch (manager.workspace_package_json_cache.getWithPath(manager.allocator, manager.log, abs_package_json_path, .{
            .guess_indentation = true,
        })) {
            .read_err => |err| {
                Output.err(err, "failed to read package.json: {s}", .{abs_package_json_path});
                Global.crash();
            },
            .parse_err => |err| {
                Output.err(err, "failed to parse package.json: {s}", .{abs_package_json_path});
                manager.log.print(Output.errorWriter()) catch {};
                Global.crash();
            },
            .entry => |entry| entry,
        };

        if (comptime for_publish) {
            if (json.root.get("publishConfig")) |config| {
                if (manager.options.publish_config.tag.len == 0) {
                    if (try config.getStringCloned(ctx.allocator, "tag")) |tag| {
                        manager.options.publish_config.tag = tag;
                    }
                }
                if (manager.options.publish_config.access == null) {
                    if (try config.getString(ctx.allocator, "access")) |access| {
                        manager.options.publish_config.access = PackageManager.Options.Access.fromStr(access[0]) orelse {
                            Output.errGeneric("invalid `access` value: '{s}'", .{access[0]});
                            Global.crash();
                        };
                    }
                }
            }

            // maybe otp
        }

        const package_name_expr: Expr = json.root.get("name") orelse return error.MissingPackageName;
        const package_name = try package_name_expr.asStringCloned(ctx.allocator) orelse return error.InvalidPackageName;
        if (comptime for_publish) {
            const is_scoped = try Dependency.isScopedPackageName(package_name);
            if (manager.options.publish_config.access) |access| {
                if (access == .restricted and !is_scoped) {
                    return error.RestrictedUnscopedPackage;
                }
            }
        }
        defer if (comptime !for_publish) ctx.allocator.free(package_name);
        if (package_name.len == 0) return error.InvalidPackageName;

        const package_version_expr: Expr = json.root.get("version") orelse return error.MissingPackageVersion;
        const package_version = try package_version_expr.asStringCloned(ctx.allocator) orelse return error.InvalidPackageVersion;
        defer if (comptime !for_publish) ctx.allocator.free(package_version);
        if (package_version.len == 0) return error.InvalidPackageVersion;

        if (comptime for_publish) {
            if (json.root.get("private")) |private| {
                if (private.asBool()) |is_private| {
                    if (is_private) {
                        return error.PrivatePackage;
                    }
                }
            }
        }

        const edited_package_json = try editRootPackageJSON(ctx.allocator, ctx.lockfile, json);

        var this_transpiler: bun.transpiler.Transpiler = undefined;

        _ = RunCommand.configureEnvForRun(
            ctx.command_ctx,
            &this_transpiler,
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

        const abs_workspace_path: string = strings.withoutTrailingSlash(strings.withoutSuffixComptime(abs_package_json_path, "package.json"));
        try manager.env.map.put("npm_command", "pack");

        const postpack_script, const publish_script: ?[]const u8, const postpublish_script: ?[]const u8 = post_scripts: {
            // --ignore-scripts
            if (!manager.options.do.run_scripts) break :post_scripts .{ null, null, null };

            const scripts = json.root.asProperty("scripts") orelse break :post_scripts .{ null, null, null };
            if (scripts.expr.data != .e_object) break :post_scripts .{ null, null, null };

            if (comptime for_publish) {
                if (scripts.expr.get("prepublishOnly")) |prepublish_only_script_str| {
                    if (prepublish_only_script_str.asString(ctx.allocator)) |prepublish_only| {
                        _ = RunCommand.runPackageScriptForeground(
                            ctx.command_ctx,
                            ctx.allocator,
                            prepublish_only,
                            "prepublishOnly",
                            abs_workspace_path,
                            this_transpiler.env,
                            &.{},
                            manager.options.log_level == .silent,
                            ctx.command_ctx.debug.use_system_shell,
                        ) catch |err| {
                            switch (err) {
                                error.MissingShell => {
                                    Output.errGeneric("failed to find shell executable to run prepublishOnly script", .{});
                                    Global.crash();
                                },
                                error.OutOfMemory => |oom| return oom,
                            }
                        };
                    }
                }
            }

            if (scripts.expr.get("prepack")) |prepack_script| {
                if (prepack_script.asString(ctx.allocator)) |prepack_script_str| {
                    _ = RunCommand.runPackageScriptForeground(
                        ctx.command_ctx,
                        ctx.allocator,
                        prepack_script_str,
                        "prepack",
                        abs_workspace_path,
                        this_transpiler.env,
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
                        abs_workspace_path,
                        this_transpiler.env,
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

            var postpack_script: ?[]const u8 = null;
            if (scripts.expr.get("postpack")) |postpack| {
                postpack_script = postpack.asString(ctx.allocator);
            }

            if (comptime for_publish) {
                var publish_script: ?[]const u8 = null;
                var postpublish_script: ?[]const u8 = null;
                if (scripts.expr.get("publish")) |publish| {
                    publish_script = try publish.asStringCloned(ctx.allocator);
                }
                if (scripts.expr.get("postpublish")) |postpublish| {
                    postpublish_script = try postpublish.asStringCloned(ctx.allocator);
                }

                break :post_scripts .{ postpack_script, publish_script, postpublish_script };
            }

            break :post_scripts .{ postpack_script, null, null };
        };

        var root_dir = root_dir: {
            var path_buf: PathBuffer = undefined;
            @memcpy(path_buf[0..abs_workspace_path.len], abs_workspace_path);
            path_buf[abs_workspace_path.len] = 0;
            break :root_dir std.fs.openDirAbsoluteZ(path_buf[0..abs_workspace_path.len :0], .{
                .iterate = true,
            }) catch |err| {
                Output.err(err, "failed to open root directory: {s}\n", .{abs_workspace_path});
                Global.crash();
            };
        };
        defer root_dir.close();

        ctx.bundled_deps = try getBundledDeps(ctx.allocator, json.root, "bundledDependencies") orelse
            try getBundledDeps(ctx.allocator, json.root, "bundleDependencies") orelse
            .{};

        var pack_queue = pack_queue: {
            if (json.root.get("files")) |files| {
                files_error: {
                    if (files.asArray()) |_files_array| {
                        var includes: std.ArrayListUnmanaged(Pattern) = .{};
                        var excludes: std.ArrayListUnmanaged(Pattern) = .{};
                        defer {
                            includes.deinit(ctx.allocator);
                            excludes.deinit(ctx.allocator);
                        }

                        var path_buf: PathBuffer = undefined;
                        var files_array = _files_array;
                        while (files_array.next()) |files_entry| {
                            if (files_entry.asString(ctx.allocator)) |file_entry_str| {
                                const normalized = bun.path.normalizeBuf(file_entry_str, &path_buf, .posix);
                                const parsed = try Pattern.fromUTF8(ctx.allocator, normalized) orelse continue;
                                if (parsed.flags.negated) {
                                    @branchHint(.unlikely); // most "files" entries are not exclusions.
                                    try excludes.append(ctx.allocator, parsed);
                                } else {
                                    try includes.append(ctx.allocator, parsed);
                                }

                                continue;
                            }

                            break :files_error;
                        }

                        break :pack_queue try iterateIncludedProjectTree(
                            ctx.allocator,
                            includes.items,
                            excludes.items,
                            root_dir,
                            log_level,
                        );
                    }
                }

                Output.errGeneric("expected `files` to be an array of string values", .{});
                Global.crash();
            }

            // pack from project root
            break :pack_queue try iterateProjectTree(
                ctx.allocator,
                root_dir,
                log_level,
            );
        };
        defer pack_queue.deinit();

        var bundled_pack_queue = try iterateBundledDeps(ctx, root_dir, log_level);
        defer bundled_pack_queue.deinit();

        // +1 for package.json
        ctx.stats.total_files = pack_queue.count() + bundled_pack_queue.count() + 1;

        if (manager.options.dry_run) {
            // don't create the tarball, but run scripts if they exists

            printArchivedFilesAndPackages(ctx, root_dir, true, &pack_queue, 0);

            if (comptime !for_publish) {
                if (manager.options.pack_destination.len == 0 and manager.options.pack_filename.len == 0) {
                    Output.pretty("\n{}\n", .{fmtTarballFilename(package_name, package_version, .normalize)});
                } else {
                    var dest_buf: PathBuffer = undefined;
                    const abs_tarball_dest, _ = tarballDestination(
                        ctx.manager.options.pack_destination,
                        ctx.manager.options.pack_filename,
                        abs_workspace_path,
                        package_name,
                        package_version,
                        &dest_buf,
                    );
                    Output.pretty("\n{s}\n", .{abs_tarball_dest});
                }
            }

            Context.printSummary(ctx.stats, null, null, log_level);

            if (postpack_script) |postpack_script_str| {
                _ = RunCommand.runPackageScriptForeground(
                    ctx.command_ctx,
                    ctx.allocator,
                    postpack_script_str,
                    "postpack",
                    abs_workspace_path,
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

            if (comptime for_publish) {
                var dest_buf: bun.PathBuffer = undefined;
                const abs_tarball_dest, _ = tarballDestination(
                    ctx.manager.options.pack_destination,
                    ctx.manager.options.pack_filename,
                    abs_workspace_path,
                    package_name,
                    package_version,
                    &dest_buf,
                );
                return .{
                    .allocator = ctx.allocator,
                    .command_ctx = ctx.command_ctx,
                    .manager = manager,
                    .package_name = package_name,
                    .package_version = package_version,
                    .abs_tarball_path = try ctx.allocator.dupeZ(u8, abs_tarball_dest),
                    .tarball_bytes = "",
                    .shasum = undefined,
                    .integrity = undefined,
                    .uses_workspaces = false,
                    .publish_script = publish_script,
                    .postpublish_script = postpublish_script,
                    .script_env = this_transpiler.env,
                    .normalized_pkg_info = "",
                };
            }

            return;
        }

        const bins = try getPackageBins(ctx.allocator, json.root);
        defer for (bins) |bin| ctx.allocator.free(bin.path);

        var print_buf = std.ArrayList(u8).init(ctx.allocator);
        defer print_buf.deinit();
        const print_buf_writer = print_buf.writer();

        var archive = Archive.writeNew();

        switch (archive.writeSetFormatPaxRestricted()) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to set archive format: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }
        switch (archive.writeAddFilterGzip()) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to set archive compression to gzip: {s}", .{archive.errorString()});
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

        switch (archive.writeSetFilterOption(null, "os", "Unknown")) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to set os to `Unknown`: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }

        switch (archive.writeSetOptions("gzip:!timestamp")) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to unset gzip timestamp option: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }

        var dest_buf: PathBuffer = undefined;
        const abs_tarball_dest, const abs_tarball_dest_dir_end = tarballDestination(
            ctx.manager.options.pack_destination,
            ctx.manager.options.pack_filename,
            abs_workspace_path,
            package_name,
            package_version,
            &dest_buf,
        );

        {
            // create the directory if it doesn't exist
            const most_likely_a_slash = dest_buf[abs_tarball_dest_dir_end];
            dest_buf[abs_tarball_dest_dir_end] = 0;
            const abs_tarball_dest_dir = dest_buf[0..abs_tarball_dest_dir_end :0];
            bun.makePath(std.fs.cwd(), abs_tarball_dest_dir) catch {};
            dest_buf[abs_tarball_dest_dir_end] = most_likely_a_slash;
        }

        // TODO: experiment with `archive.writeOpenMemory()`
        switch (archive.writeOpenFilename(abs_tarball_dest)) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to open tarball file destination: \"{s}\"", .{abs_tarball_dest});
                Global.crash();
            },
            else => {},
        }

        // append removed items from `pack_queue` with their file size
        var pack_list: PackList = .{};
        defer pack_list.deinit(ctx.allocator);

        var read_buf: [8192]u8 = undefined;
        const file_reader = try ctx.allocator.create(BufferedFileReader);
        defer ctx.allocator.destroy(file_reader);
        file_reader.* = .{
            .unbuffered_reader = undefined,
        };

        var entry = Archive.Entry.new2(archive);

        {
            var progress: Progress = undefined;
            var node: *Progress.Node = undefined;
            if (log_level.showProgress()) {
                progress = .{};
                progress.supports_ansi_escape_codes = Output.enable_ansi_colors;
                node = progress.start("", pack_queue.count() + bundled_pack_queue.count() + 1);
                node.unit = " files";
            }
            defer if (log_level.showProgress()) node.end();

            entry = try archivePackageJSON(ctx, archive, entry, root_dir, edited_package_json);
            if (log_level.showProgress()) node.completeOne();

            while (pack_queue.removeOrNull()) |pathname| {
                defer if (log_level.showProgress()) node.completeOne();

                const file = bun.sys.openat(.fromStdDir(root_dir), pathname, bun.O.RDONLY, 0).unwrap() catch |err| {
                    Output.err(err, "failed to open file: \"{s}\"", .{pathname});
                    Global.crash();
                };

                const fd = file.makeLibUVOwnedForSyscall(.open, .close_on_fail).unwrap() catch |err| {
                    Output.err(err, "failed to open file: \"{s}\"", .{pathname});
                    Global.crash();
                };

                defer fd.close();

                const stat = bun.sys.sys_uv.fstat(fd).unwrap() catch |err| {
                    Output.err(err, "failed to stat file: \"{s}\"", .{pathname});
                    Global.crash();
                };

                try pack_list.append(ctx.allocator, .{ .subpath = pathname, .size = @intCast(stat.size) });

                entry = try addArchiveEntry(
                    ctx,
                    fd,
                    stat,
                    pathname,
                    &read_buf,
                    file_reader,
                    archive,
                    entry,
                    &print_buf,
                    bins,
                );
            }

            while (bundled_pack_queue.removeOrNull()) |pathname| {
                defer if (log_level.showProgress()) node.completeOne();

                const file = File.openat(.fromStdDir(root_dir), pathname, bun.O.RDONLY, 0).unwrap() catch |err| {
                    Output.err(err, "failed to open file: \"{s}\"", .{pathname});
                    Global.crash();
                };
                defer file.close();
                const stat = file.stat().unwrap() catch |err| {
                    Output.err(err, "failed to stat file: \"{}\"", .{file.handle});
                    Global.crash();
                };

                entry = try addArchiveEntry(
                    ctx,
                    file.handle,
                    stat,
                    pathname,
                    &read_buf,
                    file_reader,
                    archive,
                    entry,
                    &print_buf,
                    bins,
                );
            }
        }

        entry.free();

        switch (archive.writeClose()) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to close archive: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }

        switch (archive.writeFree()) {
            .failed, .fatal, .warn => {
                Output.errGeneric("failed to free archive: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }

        var shasum: sha.SHA1.Digest = undefined;
        var integrity: sha.SHA512.Digest = undefined;

        const tarball_bytes = tarball_bytes: {
            const tarball_file = File.open(abs_tarball_dest, bun.O.RDONLY, 0).unwrap() catch |err| {
                Output.err(err, "failed to open tarball at: \"{s}\"", .{abs_tarball_dest});
                Global.crash();
            };
            defer tarball_file.close();

            var sha1 = sha.SHA1.init();
            defer sha1.deinit();

            var sha512 = sha.SHA512.init();
            defer sha512.deinit();

            if (comptime for_publish) {
                const tarball_bytes = tarball_file.readToEnd(ctx.allocator).unwrap() catch |err| {
                    Output.err(err, "failed to read tarball: \"{s}\"", .{abs_tarball_dest});
                    Global.crash();
                };

                sha1.update(tarball_bytes);
                sha512.update(tarball_bytes);

                sha1.final(&shasum);
                sha512.final(&integrity);

                ctx.stats.packed_size = tarball_bytes.len;

                break :tarball_bytes tarball_bytes;
            }

            file_reader.* = .{
                .unbuffered_reader = tarball_file.reader(),
            };

            var size: usize = 0;
            var read = file_reader.read(&read_buf) catch |err| {
                Output.err(err, "failed to read tarball: \"{s}\"", .{abs_tarball_dest});
                Global.crash();
            };
            while (read > 0) {
                sha1.update(read_buf[0..read]);
                sha512.update(read_buf[0..read]);
                size += read;
                read = file_reader.read(&read_buf) catch |err| {
                    Output.err(err, "failed to read tarball: \"{s}\"", .{abs_tarball_dest});
                    Global.crash();
                };
            }

            sha1.final(&shasum);
            sha512.final(&integrity);

            ctx.stats.packed_size = size;
        };

        const normalized_pkg_info: if (for_publish) string else void = if (comptime for_publish)
            try Publish.normalizedPackage(
                ctx.allocator,
                manager,
                package_name,
                package_version,
                &json.root,
                &json.source,
                shasum,
                integrity,
            );

        printArchivedFilesAndPackages(
            ctx,
            root_dir,
            false,
            pack_list,
            edited_package_json.len,
        );

        if (comptime !for_publish) {
            if (manager.options.pack_destination.len == 0 and manager.options.pack_filename.len == 0) {
                Output.pretty("\n{}\n", .{fmtTarballFilename(package_name, package_version, .normalize)});
            } else {
                Output.pretty("\n{s}\n", .{abs_tarball_dest});
            }
        }

        Context.printSummary(ctx.stats, shasum, integrity, log_level);

        if (comptime for_publish) {
            Output.flush();
        }

        if (postpack_script) |postpack_script_str| {
            Output.pretty("\n", .{});
            _ = RunCommand.runPackageScriptForeground(
                ctx.command_ctx,
                ctx.allocator,
                postpack_script_str,
                "postpack",
                abs_workspace_path,
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

        if (comptime for_publish) {
            return .{
                .allocator = ctx.allocator,
                .command_ctx = ctx.command_ctx,
                .manager = manager,
                .package_name = package_name,
                .package_version = package_version,
                .abs_tarball_path = try ctx.allocator.dupeZ(u8, abs_tarball_dest),
                .tarball_bytes = tarball_bytes,
                .shasum = shasum,
                .integrity = integrity,
                .uses_workspaces = false,
                .publish_script = publish_script,
                .postpublish_script = postpublish_script,
                .script_env = this_transpiler.env,
                .normalized_pkg_info = normalized_pkg_info,
            };
        }
    }

    fn tarballDestination(
        pack_destination: string,
        pack_filename: string,
        abs_workspace_path: string,
        package_name: string,
        package_version: string,
        dest_buf: []u8,
    ) struct { stringZ, usize } {
        if (pack_filename.len > 0 and pack_destination.len > 0) {
            Output.errGeneric("cannot use both filename and destination at the same time with tarball: filename \"{s}\" and destination \"{s}\"", .{
                strings.withoutTrailingSlash(pack_filename),
                strings.withoutTrailingSlash(pack_destination),
            });
            Global.crash();
        }
        if (pack_filename.len > 0) {
            const tarball_name = std.fmt.bufPrint(dest_buf[0..], "{s}\x00", .{
                pack_filename,
            }) catch {
                Output.errGeneric("archive filename too long: \"{s}\"", .{
                    pack_filename,
                });
                Global.crash();
            };

            return .{
                dest_buf[0 .. tarball_name.len - 1 :0],
                0,
            };
        } else {
            const tarball_destination_dir = bun.path.joinAbsStringBuf(
                abs_workspace_path,
                dest_buf,
                &.{pack_destination},
                .auto,
            );

            const tarball_name = std.fmt.bufPrint(dest_buf[strings.withoutTrailingSlash(tarball_destination_dir).len..], "/{}\x00", .{
                fmtTarballFilename(package_name, package_version, .normalize),
            }) catch {
                Output.errGeneric("archive destination name too long: \"{s}/{}\"", .{
                    strings.withoutTrailingSlash(tarball_destination_dir),
                    fmtTarballFilename(package_name, package_version, .normalize),
                });
                Global.crash();
            };

            return .{
                dest_buf[0 .. strings.withoutTrailingSlash(tarball_destination_dir).len + tarball_name.len - 1 :0],
                tarball_destination_dir.len,
            };
        }
    }

    pub fn fmtTarballFilename(package_name: string, package_version: string, style: TarballNameFormatter.Style) TarballNameFormatter {
        return .{
            .package_name = package_name,
            .package_version = package_version,
            .style = style,
        };
    }

    const TarballNameFormatter = struct {
        package_name: string,
        package_version: string,
        style: Style,

        pub const Style = enum {
            normalize,
            raw,
        };

        pub fn format(this: TarballNameFormatter, comptime _: string, _: std.fmt.FormatOptions, writer: anytype) !void {
            if (this.style == .raw) {
                return writer.print("{s}-{s}.tgz", .{ this.package_name, this.package_version });
            }

            if (this.package_name[0] == '@') {
                if (this.package_name.len > 1) {
                    if (strings.indexOfChar(this.package_name, '/')) |slash| {
                        return writer.print("{s}-{s}-{s}.tgz", .{
                            this.package_name[1..][0 .. slash - 1],
                            this.package_name[slash + 1 ..],
                            this.package_version,
                        });
                    }
                }

                return writer.print("{s}-{s}.tgz", .{
                    this.package_name[1..],
                    this.package_version,
                });
            }

            return writer.print("{s}-{s}.tgz", .{
                this.package_name,
                this.package_version,
            });
        }
    };

    fn archivePackageJSON(
        ctx: *Context,
        archive: *Archive,
        entry: *Archive.Entry,
        root_dir: std.fs.Dir,
        edited_package_json: string,
    ) OOM!*Archive.Entry {
        const stat = bun.sys.fstatat(.fromStdDir(root_dir), "package.json").unwrap() catch |err| {
            Output.err(err, "failed to stat package.json", .{});
            Global.crash();
        };

        entry.setPathname(package_prefix ++ "package.json");
        entry.setSize(@intCast(edited_package_json.len));
        // https://github.com/libarchive/libarchive/blob/898dc8319355b7e985f68a9819f182aaed61b53a/libarchive/archive_entry.h#L185
        entry.setFiletype(0o100000);
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

        ctx.stats.unpacked_size += @intCast(archive.writeData(edited_package_json));

        return entry.clear();
    }

    fn addArchiveEntry(
        ctx: *Context,
        file: FileDescriptor,
        stat: bun.Stat,
        filename: stringZ,
        read_buf: []u8,
        file_reader: *BufferedFileReader,
        archive: *Archive,
        entry: *Archive.Entry,
        print_buf: *std.ArrayList(u8),
        bins: []const BinInfo,
    ) OOM!*Archive.Entry {
        const print_buf_writer = print_buf.writer();

        try print_buf_writer.print("{s}{s}\x00", .{ package_prefix, filename });
        const pathname = print_buf.items[0 .. package_prefix.len + filename.len :0];
        if (comptime Environment.isWindows)
            entry.setPathnameUtf8(pathname)
        else
            entry.setPathname(pathname);
        print_buf_writer.context.clearRetainingCapacity();

        entry.setSize(@intCast(stat.size));

        // https://github.com/libarchive/libarchive/blob/898dc8319355b7e985f68a9819f182aaed61b53a/libarchive/archive_entry.h#L185
        entry.setFiletype(0o100000);

        var perm: bun.Mode = @intCast(stat.mode);
        // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L20
        if (isPackageBin(bins, filename)) perm |= 0o111;
        entry.setPerm(@intCast(perm));

        // '1985-10-26T08:15:00.000Z'
        // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L28
        entry.setMtime(499162500, 0);

        switch (archive.writeHeader(entry)) {
            .failed, .fatal => {
                Output.errGeneric("failed to write tarball header: {s}", .{archive.errorString()});
                Global.crash();
            },
            else => {},
        }

        file_reader.* = .{
            .unbuffered_reader = File.from(file).reader(),
        };

        var read = file_reader.read(read_buf) catch |err| {
            Output.err(err, "failed to read file: \"{s}\"", .{filename});
            Global.crash();
        };
        while (read > 0) {
            ctx.stats.unpacked_size += @intCast(archive.writeData(read_buf[0..read]));
            read = file_reader.read(read_buf) catch |err| {
                Output.err(err, "failed to read file: \"{s}\"", .{filename});
                Global.crash();
            };
        }

        return entry.clear();
    }

    /// Strips workspace and catalog protocols from dependency versions then
    /// returns the printed json
    fn editRootPackageJSON(
        allocator: std.mem.Allocator,
        maybe_lockfile: ?*Lockfile,
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

                            const package_spec = dependency.value.?.asString(allocator) orelse continue;
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
                                        const dependency_name = dependency.key.?.asString(allocator) orelse {
                                            Output.errGeneric("expected string value for dependency name in \"{s}\"", .{
                                                dependency_group,
                                            });
                                            Global.crash();
                                        };

                                        failed_to_resolve: {
                                            // find the current workspace version and append to package spec without `workspace:`
                                            const lockfile = maybe_lockfile orelse break :failed_to_resolve;

                                            const workspace_version = lockfile.workspace_versions.get(Semver.String.Builder.stringHash(dependency_name)) orelse break :failed_to_resolve;

                                            dependency.value = Expr.allocate(
                                                allocator,
                                                E.String,
                                                .{
                                                    .data = try std.fmt.allocPrint(allocator, "{s}{}", .{
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
                                        Output.errGeneric("Failed to resolve workspace version for \"{s}\" in `{s}`. Run <cyan>`bun install`<r> and try again.", .{
                                            dependency_name,
                                            dependency_group,
                                        });
                                        Global.crash();
                                    }
                                }

                                dependency.value = Expr.allocate(
                                    allocator,
                                    E.String,
                                    .{
                                        .data = try allocator.dupe(u8, without_workspace_protocol),
                                    },
                                    .{},
                                );
                            } else if (strings.withoutPrefixIfPossibleComptime(package_spec, "catalog:")) |catalog_name_str| {
                                const dep_name_str = dependency.key.?.asString(allocator).?;

                                const lockfile = maybe_lockfile orelse {
                                    Output.errGeneric("Failed to resolve catalog version for \"{s}\" in `{s}` (catalogs require a lockfile).", .{
                                        dep_name_str,
                                        dependency_group,
                                    });
                                    Global.crash();
                                };

                                const catalog_name = Semver.String.init(catalog_name_str, catalog_name_str);

                                const catalog = lockfile.catalogs.getGroup(lockfile.buffers.string_bytes.items, catalog_name, catalog_name_str) orelse {
                                    Output.errGeneric("Failed to resolve catalog version for \"{s}\" in `{s}` (no matching catalog).", .{
                                        dep_name_str,
                                        dependency_group,
                                    });
                                    Global.crash();
                                };

                                const dep_name = Semver.String.init(dep_name_str, dep_name_str);

                                const dep = catalog.getContext(dep_name, Semver.String.ArrayHashContext{
                                    .arg_buf = dep_name_str,
                                    .existing_buf = lockfile.buffers.string_bytes.items,
                                }) orelse {
                                    Output.errGeneric("Failed to resolve catalog version for \"{s}\" in `{s}` (no matching catalog dependency).", .{
                                        dep_name_str,
                                        dependency_group,
                                    });
                                    Global.crash();
                                };

                                dependency.value = Expr.allocate(
                                    allocator,
                                    E.String,
                                    .{
                                        .data = try allocator.dupe(u8, dep.version.literal.slice(lockfile.buffers.string_bytes.items)),
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
        var buffer_writer = js_printer.BufferWriter.init(allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(allocator, json.source.contents.len + 1);
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
                .mangled_props = null,
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

    /// A glob pattern used to ignore or include files in the project tree.
    /// Might come from .npmignore, .gitignore, or `files` in package.json
    const Pattern = struct {
        glob: CowString,
        flags: Flags,

        const Flags = packed struct(u8) {
            /// beginning or middle slash (leading slash was trimmed)
            rel_path: bool,
            // can only match directories (had an ending slash, also trimmed)
            dirs_only: bool,

            @"leading **/": bool,
            /// true if the pattern starts with `!`
            negated: bool,

            _: u4 = 0,
        };

        pub fn fromUTF8(allocator: std.mem.Allocator, pattern: string) OOM!?Pattern {
            var remain = pattern;
            var @"has leading **/, (could start with '!')" = false;
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
                    @"has leading **/, (could start with '!')" = true;
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

            const length = remain.len + @intFromBool(add_negate);
            const buf = try allocator.alloc(u8, length);
            const start_index = @intFromBool(add_negate);
            const end = start_index + remain.len;
            @memcpy(buf[start_index..end], remain);
            if (add_negate) {
                buf[0] = '!';
            }

            return .{
                .glob = CowString.initOwned(buf[0..end], allocator),
                .flags = .{
                    .rel_path = has_leading_or_middle_slash,
                    .@"leading **/" = @"has leading **/, (could start with '!')",
                    .dirs_only = has_trailing_slash,
                    .negated = add_negate,
                },
            };
        }

        /// Invert a negated pattern to a positive pattern
        pub fn asPositive(this: *const Pattern) Pattern {
            bun.assertWithLocation(this.flags.negated and this.glob.length() > 0, @src());
            return Pattern{
                .glob = this.glob.borrowSubslice(1, null), // remove the leading `!`
                .flags = .{
                    .rel_path = this.flags.rel_path,
                    .dirs_only = this.flags.dirs_only,
                    .@"leading **/" = this.flags.@"leading **/",
                    .negated = false,
                },
            };
        }

        pub fn deinit(this: Pattern, allocator: std.mem.Allocator) void {
            this.glob.deinit(allocator);
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
            /// Exclusion pattern in "files" field within `package.json`
            @"package.json",
        };

        pub const List = std.ArrayListUnmanaged(IgnorePatterns);

        fn ignoreFileFail(dir: std.fs.Dir, ignore_kind: Kind, reason: enum { read, open }, err: anyerror) noreturn {
            var buf: PathBuffer = undefined;
            const dir_path = bun.getFdPath(.fromStdDir(dir), &buf) catch "";
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

        // ignore files are always ignored, don't need to worry about opening or reading twice
        pub fn readFromDisk(allocator: std.mem.Allocator, dir: std.fs.Dir, dir_depth: usize) OOM!?IgnorePatterns {
            var patterns: std.ArrayListUnmanaged(Pattern) = .{};
            errdefer patterns.deinit(allocator);

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

            const contents = File.from(ignore_file).readToEnd(allocator).unwrap() catch |err| {
                ignoreFileFail(dir, ignore_kind, .read, err);
            };
            defer allocator.free(contents);

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

                const parsed = try Pattern.fromUTF8(allocator, trimmed) orelse continue;
                try patterns.append(allocator, parsed);

                has_rel_path = has_rel_path or parsed.flags.rel_path;
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
            for (this.list) |*pattern_info| {
                pattern_info.glob.deinit(allocator);
            }
            allocator.free(this.list);
        }
    };

    fn printArchivedFilesAndPackages(
        ctx: *Context,
        root_dir_std: std.fs.Dir,
        comptime is_dry_run: bool,
        pack_list: if (is_dry_run) *PackQueue else PackList,
        package_json_len: usize,
    ) void {
        const root_dir = bun.FD.fromStdDir(root_dir_std);
        if (ctx.manager.options.log_level == .silent) return;
        const packed_fmt = "<r><b><cyan>packed<r> {} {s}";

        if (comptime is_dry_run) {
            const package_json_stat = root_dir.statat("package.json").unwrap() catch |err| {
                Output.err(err, "failed to stat package.json", .{});
                Global.crash();
            };

            ctx.stats.unpacked_size += @intCast(package_json_stat.size);

            Output.prettyln("\n" ++ packed_fmt, .{
                bun.fmt.size(package_json_stat.size, .{ .space_between_number_and_unit = false }),
                "package.json",
            });

            while (pack_list.removeOrNull()) |filename| {
                const stat = root_dir.statat(filename).unwrap() catch |err| {
                    Output.err(err, "failed to stat file: \"{s}\"", .{filename});
                    Global.crash();
                };

                ctx.stats.unpacked_size += @intCast(stat.size);

                Output.prettyln(packed_fmt, .{
                    bun.fmt.size(stat.size, .{ .space_between_number_and_unit = false }),
                    filename,
                });
            }

            for (ctx.bundled_deps.items) |dep| {
                if (!dep.was_packed) continue;
                Output.prettyln("<r><b><green>bundled<r> {s}", .{dep.name});
            }

            Output.flush();
            return;
        }

        Output.prettyln("\n" ++ packed_fmt, .{
            bun.fmt.size(package_json_len, .{ .space_between_number_and_unit = false }),
            "package.json",
        });

        for (pack_list.items) |entry| {
            Output.prettyln(packed_fmt, .{
                bun.fmt.size(entry.size, .{ .space_between_number_and_unit = false }),
                entry.subpath,
            });
        }

        for (ctx.bundled_deps.items) |dep| {
            if (!dep.was_packed) continue;
            Output.prettyln("<r><b><green>bundled<r> {s}", .{dep.name});
        }

        Output.flush();
    }

    /// Some files are always packed, even if they are explicitly ignored or not
    /// included in package.json "files".
    fn isUnconditionallyIncludedFile(filename: []const u8) bool {
        return filename.len > 5 and (stringsEql(filename, "package.json") or
            isSpecialFileOrVariant(filename, "LICENSE") or
            isSpecialFileOrVariant(filename, "LICENCE") or // THIS IS SPELLED DIFFERENTLY
            isSpecialFileOrVariant(filename, "README"));
    }

    // TODO: should this be case insensitive on all platforms?
    const stringsEql = if (Environment.isLinux)
        strings.eqlComptime
    else
        strings.eqlCaseInsensitiveASCIIICheckLength;

    fn isSpecialFileOrVariant(filename: []const u8, comptime name: []const u8) callconv(bun.callconv_inline) bool {
        return switch (filename.len) {
            inline 0...name.len - 1 => false,
            inline name.len => stringsEql(filename, name),
            inline name.len + 1 => false,
            else => blk: {
                bun.unsafeAssert(filename.len > name.len + 1);
                break :blk filename[name.len] == '.' and stringsEql(filename[0..name.len], name);
            },
        };
    }
};

pub const bindings = struct {
    const JSC = bun.JSC;
    const JSValue = JSC.JSValue;
    const JSGlobalObject = JSC.JSGlobalObject;
    const CallFrame = JSC.CallFrame;
    const ZigString = JSC.ZigString;
    const String = bun.String;
    const JSArray = JSC.JSArray;
    const JSObject = JSC.JSObject;

    pub fn jsReadTarball(global: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        const args = callFrame.arguments_old(1).slice();
        if (args.len < 1 or !args[0].isString()) {
            return global.throw("expected tarball path string argument", .{});
        }

        const tarball_path_str = try args[0].toBunString(global);
        defer tarball_path_str.deref();

        const tarball_path = tarball_path_str.toUTF8(bun.default_allocator);
        defer tarball_path.deinit();

        const tarball_file = File.from(std.fs.openFileAbsolute(tarball_path.slice(), .{}) catch |err| {
            return global.throw("failed to open tarball file \"{s}\": {s}", .{ tarball_path.slice(), @errorName(err) });
        });
        defer tarball_file.close();

        const tarball = tarball_file.readToEnd(bun.default_allocator).unwrap() catch |err| {
            return global.throw("failed to read tarball contents \"{s}\": {s}", .{ tarball_path.slice(), @errorName(err) });
        };
        defer bun.default_allocator.free(tarball);

        var sha1_digest: sha.SHA1.Digest = undefined;
        var sha1 = sha.SHA1.init();
        defer sha1.deinit();
        sha1.update(tarball);
        sha1.final(&sha1_digest);
        const shasum_str = String.createFormat("{s}", .{std.fmt.bytesToHex(sha1_digest, .lower)}) catch bun.outOfMemory();

        var sha512_digest: sha.SHA512.Digest = undefined;
        var sha512 = sha.SHA512.init();
        defer sha512.deinit();
        sha512.update(tarball);
        sha512.final(&sha512_digest);
        var base64_buf: [std.base64.standard.Encoder.calcSize(sha.SHA512.digest)]u8 = undefined;
        const encode_count = bun.simdutf.base64.encode(&sha512_digest, &base64_buf, false);
        const integrity_str = String.createUTF8(base64_buf[0..encode_count]);

        const EntryInfo = struct {
            pathname: String,
            kind: String,
            perm: bun.Mode,
            size: ?usize = null,
            contents: ?String = null,
        };
        var entries_info = std.ArrayList(EntryInfo).init(bun.default_allocator);
        defer entries_info.deinit();

        const archive = Archive.readNew();

        switch (archive.readSupportFormatTar()) {
            .failed, .fatal, .warn => {
                return global.throw("failed to support tar: {s}", .{archive.errorString()});
            },
            else => {},
        }
        switch (archive.readSupportFormatGnutar()) {
            .failed, .fatal, .warn => {
                return global.throw("failed to support gnutar: {s}", .{archive.errorString()});
            },
            else => {},
        }
        switch (archive.readSupportFilterGzip()) {
            .failed, .fatal, .warn => {
                return global.throw("failed to support gzip compression: {s}", .{archive.errorString()});
            },
            else => {},
        }

        switch (archive.readSetOptions("read_concatenated_archives")) {
            .failed, .fatal, .warn => {
                return global.throw("failed to set read_concatenated_archives option: {s}", .{archive.errorString()});
            },
            else => {},
        }

        switch (archive.readOpenMemory(tarball)) {
            .failed, .fatal, .warn => {
                return global.throw("failed to open archive in memory: {s}", .{archive.errorString()});
            },
            else => {},
        }

        var archive_entry: *Archive.Entry = undefined;
        var header_status = archive.readNextHeader(&archive_entry);

        var read_buf = std.ArrayList(u8).init(bun.default_allocator);
        defer read_buf.deinit();

        while (header_status != .eof) : (header_status = archive.readNextHeader(&archive_entry)) {
            switch (header_status) {
                .eof => unreachable,
                .retry => continue,
                .failed, .fatal => {
                    return global.throw("failed to read archive header: {s}", .{Archive.errorString(@ptrCast(archive))});
                },
                else => {
                    const pathname = archive_entry.pathname();
                    const kind = bun.sys.kindFromMode(archive_entry.filetype());
                    const perm = archive_entry.perm();

                    var entry_info: EntryInfo = .{
                        .pathname = String.createUTF8(pathname),
                        .kind = String.static(@tagName(kind)),
                        .perm = perm,
                    };

                    if (kind == .file) {
                        const size: usize = @intCast(archive_entry.size());
                        read_buf.resize(size) catch bun.outOfMemory();
                        defer read_buf.clearRetainingCapacity();

                        const read = archive.readData(read_buf.items);
                        if (read < 0) {
                            return global.throw("failed to read archive entry \"{}\": {s}", .{
                                bun.fmt.fmtPath(u8, pathname, .{}),
                                Archive.errorString(@ptrCast(archive)),
                            });
                        }
                        read_buf.items.len = @intCast(read);
                        entry_info.contents = String.createUTF8(read_buf.items);
                    }

                    entries_info.append(entry_info) catch bun.outOfMemory();
                },
            }
        }

        switch (archive.readClose()) {
            .failed, .fatal, .warn => {
                return global.throw("failed to close read archive: {s}", .{archive.errorString()});
            },
            else => {},
        }
        switch (archive.readFree()) {
            .failed, .fatal, .warn => {
                return global.throw("failed to close read archive: {s}", .{archive.errorString()});
            },
            else => {},
        }

        const entries = try JSArray.createEmpty(global, entries_info.items.len);

        for (entries_info.items, 0..) |entry, i| {
            const obj = JSValue.createEmptyObject(global, 4);
            obj.put(global, "pathname", entry.pathname.toJS(global));
            obj.put(global, "kind", entry.kind.toJS(global));
            obj.put(global, "perm", JSValue.jsNumber(entry.perm));
            if (entry.contents) |contents| {
                obj.put(global, "contents", contents.toJS(global));
            }
            entries.putIndex(global, @intCast(i), obj);
        }

        const result = JSValue.createEmptyObject(global, 2);
        result.put(global, "entries", entries);
        result.put(global, "size", JSValue.jsNumber(tarball.len));
        result.put(global, "shasum", shasum_str.toJS(global));
        result.put(global, "integrity", integrity_str.toJS(global));

        return result;
    }
};
