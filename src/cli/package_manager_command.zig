const NodeModulesFolder = Lockfile.Tree.Iterator(.node_modules).Next;
pub const PackCommand = @import("./pack_command.zig").PackCommand;
pub const ScanCommand = @import("./scan_command.zig").ScanCommand;

const ByName = struct {
    dependencies: []const Dependency,
    buf: []const u8,

    pub fn isLessThan(ctx: ByName, lhs: DependencyID, rhs: DependencyID) bool {
        return strings.cmpStringsAsc(
            {},
            ctx.dependencies[lhs].name.slice(ctx.buf),
            ctx.dependencies[rhs].name.slice(ctx.buf),
        );
    }
};

pub const PackageManagerCommand = struct {
    pub fn handleLoadLockfileErrors(load_lockfile: Lockfile.LoadResult, pm: *PackageManager) void {
        if (load_lockfile == .not_found) {
            if (pm.options.log_level != .silent) {
                Output.errGeneric("Lockfile not found", .{});
            }
            Global.exit(1);
        }

        if (load_lockfile == .err) {
            if (pm.options.log_level != .silent) {
                Output.errGeneric("Error loading lockfile: {s}", .{@errorName(load_lockfile.err.value)});
            }
            Global.exit(1);
        }
    }

    pub fn printHash(ctx: Command.Context, file: File) !void {
        @branchHint(.cold);

        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .pm);
        var pm, const cwd = try PackageManager.init(ctx, cli, PackageManager.Subcommand.pm);
        defer ctx.allocator.free(cwd);

        const bytes = file.readToEnd(ctx.allocator).unwrap() catch |err| {
            Output.err(err, "failed to read lockfile", .{});
            Global.crash();
        };

        const load_lockfile = pm.lockfile.loadFromBytes(pm, bytes, ctx.allocator, ctx.log);

        handleLoadLockfileErrors(load_lockfile, pm);

        Output.flush();
        Output.disableBuffering();
        try Output.writer().print("{}", .{load_lockfile.ok.lockfile.fmtMetaHash()});
        Output.enableBuffering();
        Global.exit(0);
    }

    fn getSubcommand(args_ptr: *[]const string) []const u8 {
        var args = args_ptr.*;
        defer args_ptr.* = args;

        var subcommand: []const u8 = if (args.len > 0)
            args[0]
        else
            "";

        if (strings.eqlComptime(subcommand, "pm")) {
            subcommand = "";
            if (args.len > 1) {
                args = args[1..];
                return args[0];
            }
        }

        return subcommand;
    }

    pub fn printHelp() void {

        // the output of --help uses the following syntax highlighting
        // template: <b>Usage<r>: <b><green>bun <command><r> <cyan>[flags]<r> <blue>[arguments]<r>
        // use [foo] for multiple arguments or flags for foo.
        // use <bar> to emphasize 'bar'

        const intro_text =
            \\
            \\<b>Usage<r>: <b><green>bun pm<r> <cyan>[flags]<r> <blue>[\<command\>]<r>
            \\
            \\  Run package manager utilities.
        ;
        const outro_text =
            \\
            \\
            \\<b>Commands:<r>
            \\
            \\  <b><green>bun pm<r> <blue>scan<r>                 scan all packages in lockfile for security vulnerabilities
            \\  <b><green>bun pm<r> <blue>pack<r>                 create a tarball of the current workspace
            \\  <d>├<r> <cyan>--dry-run<r>                 do everything except for writing the tarball to disk
            \\  <d>├<r> <cyan>--destination<r>             the directory the tarball will be saved in
            \\  <d>├<r> <cyan>--filename<r>                the name of the tarball
            \\  <d>├<r> <cyan>--ignore-scripts<r>          don't run pre/postpack and prepare scripts
            \\  <d>├<r> <cyan>--gzip-level<r>              specify a custom compression level for gzip (0-9, default is 9)
            \\  <d>└<r> <cyan>--quiet<r>                   only output the tarball filename
            \\  <b><green>bun pm<r> <blue>bin<r>                  print the path to bin folder
            \\  <d>└<r> <cyan>-g<r>                        print the <b>global<r> path to bin folder
            \\  <b><green>bun pm<r> <blue>ls<r>                   list the dependency tree according to the current lockfile
            \\  <d>└<r> <cyan>--all<r>                     list the entire dependency tree according to the current lockfile
            \\  <b><green>bun pm<r> <blue>why<r> <d>\<pkg\><r>            show dependency tree explaining why a package is installed
            \\  <b><green>bun pm<r> <blue>whoami<r>               print the current npm username
            \\  <b><green>bun pm<r> <blue>view<r> <d>name[@version]<r>  view package metadata from the registry <d>(use `bun info` instead)<r>
            \\  <b><green>bun pm<r> <blue>version<r> <d>[increment]<r>  bump the version in package.json and create a git tag
            \\  <d>└<r> <cyan>increment<r>                 patch, minor, major, prepatch, preminor, premajor, prerelease, from-git, or a specific version
            \\  <b><green>bun pm<r> <blue>pkg<r>                  manage data in package.json
            \\  <d>├<r> <cyan>get<r> <d>[key ...]<r> 
            \\  <d>├<r> <cyan>set<r> <d>key=value ...<r>
            \\  <d>├<r> <cyan>delete<r> <d>key ...<r>
            \\  <d>└<r> <cyan>fix<r>                       auto-correct common package.json errors
            \\  <b><green>bun pm<r> <blue>hash<r>                 generate & print the hash of the current lockfile
            \\  <b><green>bun pm<r> <blue>hash-string<r>          print the string used to hash the lockfile
            \\  <b><green>bun pm<r> <blue>hash-print<r>           print the hash stored in the current lockfile
            \\  <b><green>bun pm<r> <blue>cache<r>                print the path to the cache folder
            \\  <b><green>bun pm<r> <blue>cache rm<r>             clear the cache
            \\  <b><green>bun pm<r> <blue>migrate<r>              migrate another package manager's lockfile without installing anything
            \\  <b><green>bun pm<r> <blue>untrusted<r>            print current untrusted dependencies with scripts
            \\  <b><green>bun pm<r> <blue>trust<r> <d>names ...<r>      run scripts for untrusted dependencies and add to `trustedDependencies`
            \\  <d>└<r>  <cyan>--all<r>                    trust all untrusted dependencies
            \\  <b><green>bun pm<r> <blue>default-trusted<r>      print the default trusted dependencies list
            \\
            \\Learn more about these at <magenta>https://bun.com/docs/cli/pm<r>.
            \\
        ;

        Output.pretty(intro_text, .{});
        Output.pretty(outro_text, .{});
        Output.flush();
    }

    pub fn exec(ctx: Command.Context) !void {
        var args = try std.process.argsAlloc(ctx.allocator);
        args = args[1..];
        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .pm);
        var pm, const cwd = PackageManager.init(ctx, cli, PackageManager.Subcommand.pm) catch |err| {
            if (err == error.MissingPackageJSON) {
                var cwd_buf: bun.PathBuffer = undefined;
                if (bun.getcwd(&cwd_buf)) |cwd| {
                    Output.errGeneric("No package.json was found for directory \"{s}\"", .{cwd});
                } else |_| {
                    Output.errGeneric("No package.json was found", .{});
                }
                Output.note("Run \"bun init\" to initialize a project", .{});
                Global.exit(1);
            }
            return err;
        };
        defer ctx.allocator.free(cwd);

        const subcommand = getSubcommand(&pm.options.positionals);
        if (pm.options.global) {
            try pm.setupGlobalDir(ctx);
        }

        if (strings.eqlComptime(subcommand, "scan")) {
            try ScanCommand.execWithManager(ctx, pm, cwd);
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "pack")) {
            try PackCommand.execWithManager(ctx, pm);
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "whoami")) {
            const username = Npm.whoami(ctx.allocator, pm) catch |err| {
                switch (err) {
                    error.OutOfMemory => bun.outOfMemory(),
                    error.NeedAuth => {
                        Output.errGeneric("missing authentication (run <cyan>`bunx npm login`<r>)", .{});
                    },
                    error.ProbablyInvalidAuth => {
                        Output.errGeneric("failed to authenticate with registry '{}'", .{
                            bun.fmt.redactedNpmUrl(pm.options.scope.url.href),
                        });
                    },
                }
                Global.crash();
            };
            Output.println("{s}", .{username});
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "view")) {
            const property_path = if (pm.options.positionals.len > 2) pm.options.positionals[2] else null;
            try PmViewCommand.view(ctx.allocator, pm, if (pm.options.positionals.len > 1) pm.options.positionals[1] else "", property_path, pm.options.json_output);
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "bin")) {
            const output_path = Path.joinAbs(Fs.FileSystem.instance.top_level_dir, .auto, bun.asByteSlice(pm.options.bin_path));
            Output.prettyln("{s}", .{output_path});
            if (Output.stdout_descriptor_type == .terminal) {
                Output.prettyln("\n", .{});
            }

            if (pm.options.global) {
                warner: {
                    if (Output.enable_ansi_colors_stderr) {
                        if (bun.getenvZ("PATH")) |path| {
                            var path_iter = std.mem.tokenizeScalar(u8, path, std.fs.path.delimiter);
                            while (path_iter.next()) |entry| {
                                if (strings.eql(entry, output_path)) {
                                    break :warner;
                                }
                            }

                            Output.prettyErrorln("\n<r><yellow>warn<r>: not in $PATH\n", .{});
                        }
                    }
                }
            }

            Output.flush();
            return;
        } else if (strings.eqlComptime(subcommand, "hash")) {
            const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
            handleLoadLockfileErrors(load_lockfile, pm);

            _ = try pm.lockfile.hasMetaHashChanged(false, pm.lockfile.packages.len);

            Output.flush();
            Output.disableBuffering();
            try Output.writer().print("{}", .{load_lockfile.ok.lockfile.fmtMetaHash()});
            Output.enableBuffering();
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "hash-print")) {
            const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
            handleLoadLockfileErrors(load_lockfile, pm);

            Output.flush();
            Output.disableBuffering();
            try Output.writer().print("{}", .{load_lockfile.ok.lockfile.fmtMetaHash()});
            Output.enableBuffering();
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "hash-string")) {
            const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
            handleLoadLockfileErrors(load_lockfile, pm);

            _ = try pm.lockfile.hasMetaHashChanged(true, pm.lockfile.packages.len);
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "cache")) {
            var dir: bun.PathBuffer = undefined;
            var fd = pm.getCacheDirectory();
            const outpath = bun.getFdPath(.fromStdDir(fd), &dir) catch |err| {
                Output.prettyErrorln("{s} getting cache directory", .{@errorName(err)});
                Global.crash();
            };

            if (pm.options.positionals.len > 1 and strings.eqlComptime(pm.options.positionals[1], "rm")) {
                fd.close();

                var had_err = false;

                std.fs.deleteTreeAbsolute(outpath) catch |err| {
                    Output.err(err, "Could not delete {s}", .{outpath});
                    had_err = true;
                };
                Output.prettyln("Cleared 'bun install' cache", .{});

                bunx: {
                    const tmp = bun.fs.FileSystem.RealFS.platformTempDir();
                    const tmp_dir = std.fs.openDirAbsolute(tmp, .{ .iterate = true }) catch |err| {
                        Output.err(err, "Could not open {s}", .{tmp});
                        had_err = true;
                        break :bunx;
                    };
                    var iter = tmp_dir.iterate();

                    // This is to match 'bunx_command.BunxCommand.exec's logic
                    const prefix = try std.fmt.allocPrint(ctx.allocator, "bunx-{d}-", .{
                        if (bun.Environment.isPosix) bun.c.getuid() else bun.windows.userUniqueId(),
                    });

                    var deleted: usize = 0;
                    while (iter.next() catch |err| {
                        Output.err(err, "Could not read {s}", .{tmp});
                        had_err = true;
                        break :bunx;
                    }) |entry| {
                        if (std.mem.startsWith(u8, entry.name, prefix)) {
                            tmp_dir.deleteTree(entry.name) catch |err| {
                                Output.err(err, "Could not delete {s}", .{entry.name});
                                had_err = true;
                                continue;
                            };

                            deleted += 1;
                        }
                    }

                    Output.prettyln("Cleared {d} cached 'bunx' packages", .{deleted});
                }

                Global.exit(if (had_err) 1 else 0);
            }

            Output.writer().writeAll(outpath) catch {};
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "default-trusted")) {
            try DefaultTrustedCommand.exec();
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "untrusted")) {
            try UntrustedCommand.exec(ctx, pm, args);
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "trust")) {
            try TrustCommand.exec(ctx, pm, args);
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "ls")) {
            const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
            handleLoadLockfileErrors(load_lockfile, pm);

            const lockfile = load_lockfile.ok.lockfile;

            // Determine max depth for traversal
            const max_display_depth = if (pm.options.depth) |d| d else std.math.maxInt(usize);

            if (pm.options.json_output) {
                // JSON output
                try printJsonDependencyTree(ctx, pm, lockfile, max_display_depth);
            } else {
                // Regular tree output
                Output.flush();
                Output.disableBuffering();

                var iterator = Lockfile.Tree.Iterator(.node_modules).init(lockfile);

                var max_depth: usize = 0;

                var directories = std.ArrayList(NodeModulesFolder).init(ctx.allocator);
                defer directories.deinit();
                while (iterator.next(null)) |node_modules| {
                    const path_len = node_modules.relative_path.len;
                    const path = try ctx.allocator.alloc(u8, path_len + 1);
                    bun.copy(u8, path, node_modules.relative_path);
                    path[path_len] = 0;

                    const dependencies = try ctx.allocator.alloc(DependencyID, node_modules.dependencies.len);
                    bun.copy(DependencyID, dependencies, node_modules.dependencies);

                    if (max_depth < node_modules.depth + 1) max_depth = node_modules.depth + 1;

                    try directories.append(.{
                        .relative_path = path[0..path_len :0],
                        .dependencies = dependencies,
                        .tree_id = node_modules.tree_id,
                        .depth = node_modules.depth,
                    });
                }

                const first_directory = directories.orderedRemove(0);

                var more_packages = try ctx.allocator.alloc(bool, max_depth);
                @memset(more_packages, false);
                if (first_directory.dependencies.len > 1) more_packages[0] = true;

                if (strings.leftHasAnyInRight(args, &.{ "-A", "-a", "--all" })) {
                    try printNodeModulesFolderStructure(&first_directory, null, 0, &directories, lockfile, more_packages, max_display_depth);
                } else {
                    var cwd_buf: bun.PathBuffer = undefined;
                    const path = bun.getcwd(&cwd_buf) catch {
                        Output.prettyErrorln("<r><red>error<r>: Could not get current working directory", .{});
                        Global.exit(1);
                    };
                    const dependencies = lockfile.buffers.dependencies.items;
                    const slice = lockfile.packages.slice();
                    const resolutions = slice.items(.resolution);
                    const root_deps = slice.items(.dependencies)[0];

                    Output.println("{s} node_modules ({d})", .{ path, lockfile.buffers.hoisted_dependencies.items.len });
                    const string_bytes = lockfile.buffers.string_bytes.items;
                    const sorted_dependencies = try ctx.allocator.alloc(DependencyID, root_deps.len);
                    defer ctx.allocator.free(sorted_dependencies);
                    for (sorted_dependencies, 0..) |*dep, i| {
                        dep.* = @as(DependencyID, @truncate(root_deps.off + i));
                    }
                    std.sort.pdq(DependencyID, sorted_dependencies, ByName{
                        .dependencies = dependencies,
                        .buf = string_bytes,
                    }, ByName.isLessThan);

                    for (sorted_dependencies, 0..) |dependency_id, index| {
                        const package_id = lockfile.buffers.resolutions.items[dependency_id];
                        if (package_id >= lockfile.packages.len) continue;
                        const name = dependencies[dependency_id].name.slice(string_bytes);
                        const resolution = resolutions[package_id].fmt(string_bytes, .auto);

                        if (index < sorted_dependencies.len - 1) {
                            Output.prettyln("<d>├──<r> {s}<r><d>@{any}<r>\n", .{ name, resolution });
                        } else {
                            Output.prettyln("<d>└──<r> {s}<r><d>@{any}<r>\n", .{ name, resolution });
                        }
                    }
                }
            }

            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "migrate")) {
            if (!pm.options.enable.force_save_lockfile) {
                if (bun.sys.existsZ("bun.lock")) {
                    Output.prettyErrorln(
                        \\<r><red>error<r>: bun.lock already exists
                        \\run with --force to overwrite
                    , .{});
                    Global.exit(1);
                }

                if (bun.sys.existsZ("bun.lockb")) {
                    Output.prettyErrorln(
                        \\<r><red>error<r>: bun.lockb already exists
                        \\run with --force to overwrite
                    , .{});
                    Global.exit(1);
                }
            }
            const load_lockfile = @import("../install/migration.zig").detectAndLoadOtherLockfile(
                pm.lockfile,
                bun.FD.cwd(),
                pm,
                ctx.allocator,
                pm.log,
            );
            if (load_lockfile == .not_found) {
                Output.prettyErrorln(
                    \\<r><red>error<r>: could not find any other lockfile
                , .{});
                Global.exit(1);
            }
            handleLoadLockfileErrors(load_lockfile, pm);
            const lockfile = load_lockfile.ok.lockfile;

            lockfile.saveToDisk(&load_lockfile, &pm.options);
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "version")) {
            try PmVersionCommand.exec(ctx, pm, pm.options.positionals, cwd);
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "why")) {
            try PmWhyCommand.exec(ctx, pm, pm.options.positionals);
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "pkg")) {
            try PmPkgCommand.exec(ctx, pm, pm.options.positionals, cwd);
            Global.exit(0);
        }

        printHelp();

        if (subcommand.len > 0) {
            Output.prettyErrorln("\n<red>error<r>: \"{s}\" unknown command\n", .{subcommand});
            Output.flush();

            Global.exit(1);
        } else {
            Global.exit(0);
        }
    }

    fn printJsonDependencyTree(ctx: Command.Context, pm: *PackageManager, lockfile: *Lockfile, max_depth: usize) !void {
        const allocator = ctx.allocator;
        const dependencies = lockfile.buffers.dependencies.items;
        const string_bytes = lockfile.buffers.string_bytes.items;
        const slice = lockfile.packages.slice();
        const resolutions = slice.items(.resolution);
        const names = slice.items(.name);
        const root_deps = slice.items(.dependencies)[0];

        // Get root package info from lockfile
        const root_package_id = pm.root_package_id.get(lockfile, pm.workspace_name_hash);
        const root_name = if (root_package_id < lockfile.packages.len)
            names[root_package_id].slice(string_bytes)
        else if (pm.root_package_json_name_at_time_of_init.len > 0)
            pm.root_package_json_name_at_time_of_init
        else
            "unknown";

        // Get version from root package resolution
        // For the root package, we typically have a "root" resolution tag, so we need to check package.json
        var version_buf: [512]u8 = undefined;
        const version = if (root_package_id < lockfile.packages.len and resolutions[root_package_id].tag == .npm)
            try std.fmt.bufPrint(&version_buf, "{}", .{resolutions[root_package_id].value.npm.version.fmt(string_bytes)})
        else if (root_package_id < lockfile.packages.len and resolutions[root_package_id].tag != .root)
            try std.fmt.bufPrint(&version_buf, "{}", .{resolutions[root_package_id].fmt(string_bytes, .auto)})
        else blk: {
            // Try to read version from package.json for root packages
            var path_buf: bun.PathBuffer = undefined;
            const package_json_path = std.fmt.bufPrintZ(&path_buf, "{s}/package.json", .{pm.root_dir.dir}) catch "package.json";

            if (std.fs.cwd().openFile(package_json_path, .{})) |file| {
                defer file.close();
                const content = file.readToEndAlloc(allocator, 1024 * 1024) catch null;
                if (content) |c| {
                    defer allocator.free(c);
                    // Simple extraction of version field
                    if (std.mem.indexOf(u8, c, "\"version\"")) |pos| {
                        if (std.mem.indexOfPos(u8, c, pos + 9, "\"")) |start| {
                            if (std.mem.indexOfPos(u8, c, start + 1, "\"")) |end| {
                                const v = c[start + 1 .. end];
                                break :blk try std.fmt.bufPrint(&version_buf, "{s}", .{v});
                            }
                        }
                    }
                }
            } else |_| {}
            break :blk "0.0.1";
        };

        // Start building JSON output
        var buffer = std.ArrayList(u8).init(allocator);
        defer buffer.deinit();
        var writer = buffer.writer();

        try writer.writeAll("{\n");
        try writer.print("  \"version\": \"{s}\",\n", .{version});
        try writer.print("  \"name\": \"{s}\"", .{root_name});

        // Separate dependencies by type
        var prod_deps = std.ArrayList(DependencyID).init(allocator);
        var dev_deps = std.ArrayList(DependencyID).init(allocator);
        var peer_deps = std.ArrayList(DependencyID).init(allocator);
        var optional_deps = std.ArrayList(DependencyID).init(allocator);
        defer prod_deps.deinit();
        defer dev_deps.deinit();
        defer peer_deps.deinit();
        defer optional_deps.deinit();

        // Categorize dependencies by type
        if (root_deps.len > 0) {
            for (0..root_deps.len) |i| {
                const dep_id = @as(DependencyID, @truncate(root_deps.off + i));
                const dep = dependencies[dep_id];

                if (dep.behavior.peer) {
                    try peer_deps.append(dep_id);
                } else if (dep.behavior.dev) {
                    try dev_deps.append(dep_id);
                } else if (dep.behavior.optional) {
                    try optional_deps.append(dep_id);
                } else if (dep.behavior.prod) {
                    try prod_deps.append(dep_id);
                }
            }
        }

        var has_any_deps = false;

        // Print production dependencies
        if (prod_deps.items.len > 0) {
            try writer.writeAll(if (has_any_deps) ",\n  \"dependencies\": {\n" else ",\n  \"dependencies\": {\n");
            try printJsonDependencySection(
                writer,
                lockfile,
                prod_deps.items,
                max_depth,
                allocator,
                true, // include "from" field
            );
            try writer.writeAll("  }");
            has_any_deps = true;
        }

        // Print dev dependencies
        if (dev_deps.items.len > 0) {
            try writer.writeAll(if (has_any_deps) ",\n  \"devDependencies\": {\n" else ",\n  \"devDependencies\": {\n");
            try printJsonDependencySection(
                writer,
                lockfile,
                dev_deps.items,
                max_depth,
                allocator,
                true, // include "from" field
            );
            try writer.writeAll("  }");
            has_any_deps = true;
        }

        // Print peer dependencies
        if (peer_deps.items.len > 0) {
            try writer.writeAll(if (has_any_deps) ",\n  \"peerDependencies\": {\n" else ",\n  \"peerDependencies\": {\n");
            try printJsonDependencySection(
                writer,
                lockfile,
                peer_deps.items,
                max_depth,
                allocator,
                true, // include "from" field
            );
            try writer.writeAll("  }");
            has_any_deps = true;
        }

        // Print optional dependencies
        if (optional_deps.items.len > 0) {
            try writer.writeAll(if (has_any_deps) ",\n  \"optionalDependencies\": {\n" else ",\n  \"optionalDependencies\": {\n");
            try printJsonDependencySection(
                writer,
                lockfile,
                optional_deps.items,
                max_depth,
                allocator,
                true, // include "from" field
            );
            try writer.writeAll("  }");
            has_any_deps = true;
        }

        if (!has_any_deps) {
            try writer.writeAll("\n");
        } else {
            try writer.writeAll("\n");
        }

        try writer.writeAll("}\n");

        Output.flush();
        Output.disableBuffering();
        try Output.writer().writeAll(buffer.items);
        Output.enableBuffering();
    }

    fn printJsonDependencySection(
        writer: anytype,
        lockfile: *Lockfile,
        dep_ids: []const DependencyID,
        max_depth: usize,
        allocator: std.mem.Allocator,
        include_from: bool,
    ) !void {
        const dependencies = lockfile.buffers.dependencies.items;
        const string_bytes = lockfile.buffers.string_bytes.items;
        const slice = lockfile.packages.slice();
        const resolutions = slice.items(.resolution);

        // Sort dependencies by name
        const sorted_deps = try allocator.alloc(DependencyID, dep_ids.len);
        defer allocator.free(sorted_deps);
        @memcpy(sorted_deps, dep_ids);
        std.sort.pdq(DependencyID, sorted_deps, ByName{
            .dependencies = dependencies,
            .buf = string_bytes,
        }, ByName.isLessThan);

        for (sorted_deps, 0..) |dependency_id, i| {
            const package_id = lockfile.buffers.resolutions.items[dependency_id];
            if (package_id >= lockfile.packages.len) continue;

            const dep = dependencies[dependency_id];
            const dep_name = dep.name.slice(string_bytes);
            const resolution = resolutions[package_id];

            // Get version string based on resolution type
            var version_buf: [512]u8 = undefined;
            const version_str = if (resolution.tag == .npm)
                try std.fmt.bufPrint(&version_buf, "{}", .{resolution.value.npm.version.fmt(string_bytes)})
            else
                try std.fmt.bufPrint(&version_buf, "{}", .{resolution.fmt(string_bytes, .auto)});

            // Get resolved URL from resolution
            var resolved_buf: [1024]u8 = undefined;
            const resolved_url = try std.fmt.bufPrint(&resolved_buf, "{}", .{resolution.fmtURL(string_bytes)});

            try writer.print("    \"{s}\": {{\n", .{dep_name});
            try writer.print("      \"version\": \"{s}\",\n", .{version_str});
            try writer.print("      \"resolved\": \"{s}\",\n", .{resolved_url});
            try writer.writeAll("      \"overridden\": false");

            // Add "from" field only if requested (for root-level deps)
            if (include_from) {
                const from_str = dep.version.literal.slice(string_bytes);
                try writer.print(",\n      \"from\": \"{s}\"", .{from_str});
            }

            // Add nested dependencies if depth allows
            if (max_depth > 0) {
                const package_deps = slice.items(.dependencies)[package_id];
                if (package_deps.len > 0) {
                    try writer.writeAll(",\n      \"dependencies\": {\n");
                    try printJsonNestedDependencies(
                        writer,
                        lockfile,
                        package_deps,
                        1,
                        max_depth,
                        allocator,
                        8,
                    );
                    try writer.writeAll("\n      }");
                }
            }

            try writer.writeAll("\n    }");

            if (i < sorted_deps.len - 1) {
                try writer.writeAll(",");
            }
            try writer.writeAll("\n");
        }
    }

    fn printJsonNestedDependencies(
        writer: anytype,
        lockfile: *Lockfile,
        deps: Lockfile.DependencySlice,
        current_depth: usize,
        max_depth: usize,
        allocator: std.mem.Allocator,
        indent: usize,
    ) !void {
        if (current_depth > max_depth) return;

        const dependencies = lockfile.buffers.dependencies.items;
        const string_bytes = lockfile.buffers.string_bytes.items;
        const slice = lockfile.packages.slice();
        const resolutions = slice.items(.resolution);

        // Sort dependencies
        const sorted_dependencies = try allocator.alloc(DependencyID, deps.len);
        defer allocator.free(sorted_dependencies);
        for (sorted_dependencies, 0..) |*dep, i| {
            dep.* = @as(DependencyID, @truncate(deps.off + i));
        }
        std.sort.pdq(DependencyID, sorted_dependencies, ByName{
            .dependencies = dependencies,
            .buf = string_bytes,
        }, ByName.isLessThan);

        for (sorted_dependencies, 0..) |dependency_id, i| {
            const package_id = lockfile.buffers.resolutions.items[dependency_id];
            if (package_id >= lockfile.packages.len) continue;

            const dep_name = dependencies[dependency_id].name.slice(string_bytes);
            const resolution = resolutions[package_id];

            // Get version string based on resolution type
            var version_buf: [512]u8 = undefined;
            const version_str = if (resolution.tag == .npm)
                try std.fmt.bufPrint(&version_buf, "{}", .{resolution.value.npm.version.fmt(string_bytes)})
            else
                try std.fmt.bufPrint(&version_buf, "{}", .{resolution.fmt(string_bytes, .auto)});

            // Get resolved URL from resolution
            var resolved_buf: [1024]u8 = undefined;
            const resolved_url = try std.fmt.bufPrint(&resolved_buf, "{}", .{resolution.fmtURL(string_bytes)});

            // Indent
            var j: usize = 0;
            while (j < indent) : (j += 1) {
                try writer.writeAll(" ");
            }

            try writer.print("\"{s}\": {{\n", .{dep_name});

            // Indent for properties
            j = 0;
            while (j < indent + 2) : (j += 1) {
                try writer.writeAll(" ");
            }
            try writer.print("\"version\": \"{s}\",\n", .{version_str});

            j = 0;
            while (j < indent + 2) : (j += 1) {
                try writer.writeAll(" ");
            }
            try writer.print("\"resolved\": \"{s}\",\n", .{resolved_url});

            j = 0;
            while (j < indent + 2) : (j += 1) {
                try writer.writeAll(" ");
            }
            try writer.writeAll("\"overridden\": false");

            // Add nested dependencies if depth allows (no "from" field for nested)
            if (current_depth < max_depth) {
                const package_deps = slice.items(.dependencies)[package_id];
                if (package_deps.len > 0) {
                    try writer.writeAll(",\n");
                    j = 0;
                    while (j < indent + 2) : (j += 1) {
                        try writer.writeAll(" ");
                    }
                    try writer.writeAll("\"dependencies\": {\n");
                    try printJsonNestedDependencies(
                        writer,
                        lockfile,
                        package_deps,
                        current_depth + 1,
                        max_depth,
                        allocator,
                        indent + 4,
                    );
                    try writer.writeAll("\n");
                    j = 0;
                    while (j < indent + 2) : (j += 1) {
                        try writer.writeAll(" ");
                    }
                    try writer.writeAll("}");
                }
            }

            try writer.writeAll("\n");
            j = 0;
            while (j < indent) : (j += 1) {
                try writer.writeAll(" ");
            }
            try writer.writeAll("}");

            if (i < sorted_dependencies.len - 1) {
                try writer.writeAll(",\n");
            }
        }
    }
};

fn printNodeModulesFolderStructure(
    directory: *const NodeModulesFolder,
    directory_package_id: ?PackageID,
    depth: usize,
    directories: *std.ArrayList(NodeModulesFolder),
    lockfile: *Lockfile,
    more_packages: []bool,
    max_display_depth: usize,
) !void {
    // Stop if we've exceeded the maximum depth
    if (depth > max_display_depth) {
        return;
    }
    const allocator = lockfile.allocator;
    const resolutions = lockfile.packages.items(.resolution);
    const string_bytes = lockfile.buffers.string_bytes.items;

    {
        var i: usize = 0;
        while (i < depth) : (i += 1) {
            if (i == depth - 1) {
                if (more_packages[i]) {
                    Output.pretty("<d>├──<r>", .{});
                } else {
                    Output.pretty("<d>└──<r>", .{});
                }
            } else {
                if (more_packages[i]) {
                    Output.pretty("<d>│<r>   ", .{});
                } else {
                    Output.pretty("    ", .{});
                }
            }
        }

        var resolution_buf: [512]u8 = undefined;
        if (directory_package_id) |id| {
            var path = directory.relative_path;

            if (depth != 0) {
                Output.pretty(" ", .{});
                var temp_depth = depth;
                while (temp_depth > 0) : (temp_depth -= 1) {
                    if (std.mem.indexOf(u8, path, "node_modules")) |j| {
                        path = path[j + "node_modules".len + 1 ..];
                    }
                }
            }
            const directory_version = try std.fmt.bufPrint(&resolution_buf, "{}", .{resolutions[id].fmt(string_bytes, .auto)});
            if (std.mem.indexOf(u8, path, "node_modules")) |j| {
                Output.prettyln("{s}<d>@{s}<r>", .{ path[0 .. j - 1], directory_version });
            } else {
                Output.prettyln("{s}<d>@{s}<r>", .{ path, directory_version });
            }
        } else {
            var cwd_buf: bun.PathBuffer = undefined;
            const path = bun.getcwd(&cwd_buf) catch {
                Output.prettyErrorln("<r><red>error<r>: Could not get current working directory", .{});
                Global.exit(1);
            };
            Output.println("{s} node_modules", .{path});
        }
    }

    const dependencies = lockfile.buffers.dependencies.items;
    const sorted_dependencies = try allocator.alloc(DependencyID, directory.dependencies.len);
    defer allocator.free(sorted_dependencies);
    bun.copy(DependencyID, sorted_dependencies, directory.dependencies);
    std.sort.pdq(DependencyID, sorted_dependencies, ByName{
        .dependencies = dependencies,
        .buf = string_bytes,
    }, ByName.isLessThan);

    for (sorted_dependencies, 0..) |dependency_id, index| {
        const package_name = dependencies[dependency_id].name.slice(string_bytes);
        const fmt = "{s}" ++ std.fs.path.sep_str ++ "{s}" ++ std.fs.path.sep_str ++ "node_modules";
        const possible_path = try std.fmt.allocPrint(allocator, fmt, .{ directory.relative_path, package_name });
        defer allocator.free(possible_path);

        if (index + 1 == sorted_dependencies.len) {
            more_packages[depth] = false;
        }

        const package_id = lockfile.buffers.resolutions.items[dependency_id];
        var dir_index: usize = 0;
        var found_node_modules = false;
        while (dir_index < directories.items.len) : (dir_index += 1) {
            // Recursively print node_modules. node_modules is removed from
            // the directories list before traversal.
            if (strings.eqlLong(possible_path, directories.items[dir_index].relative_path, true)) {
                found_node_modules = true;
                const next = directories.orderedRemove(dir_index);

                var new_depth: usize = 0;
                var temp_path = possible_path;
                while (std.mem.indexOf(u8, temp_path["node_modules".len..], "node_modules")) |j| {
                    new_depth += 1;
                    temp_path = temp_path[j + "node_modules".len ..];
                }

                more_packages[new_depth] = true;
                try printNodeModulesFolderStructure(&next, package_id, new_depth, directories, lockfile, more_packages, max_display_depth);
            }
        }

        if (found_node_modules) continue;

        var i: usize = 0;
        while (i < depth) : (i += 1) {
            if (more_packages[i]) {
                Output.pretty("<d>│<r>   ", .{});
            } else {
                Output.pretty("    ", .{});
            }
        }

        if (more_packages[depth]) {
            Output.pretty("<d>├──<r> ", .{});
        } else {
            Output.pretty("<d>└──<r> ", .{});
        }

        var resolution_buf: [512]u8 = undefined;
        const package_version = try std.fmt.bufPrint(&resolution_buf, "{}", .{resolutions[package_id].fmt(string_bytes, .auto)});
        Output.prettyln("{s}<d>@{s}<r>", .{ package_name, package_version });
    }
}

const string = []const u8;

const Dependency = @import("../install/dependency.zig");
const Fs = @import("../fs.zig");
const Lockfile = @import("../install/lockfile.zig");
const Path = @import("../resolver/resolve_path.zig");
const PmViewCommand = @import("./pm_view_command.zig");
const std = @import("std");
const Command = @import("../cli.zig").Command;
const PmPkgCommand = @import("./pm_pkg_command.zig").PmPkgCommand;
const PmVersionCommand = @import("./pm_version_command.zig").PmVersionCommand;
const PmWhyCommand = @import("./pm_why_command.zig").PmWhyCommand;

const Install = @import("../install/install.zig");
const DependencyID = Install.DependencyID;
const Npm = Install.Npm;
const PackageID = Install.PackageID;
const PackageManager = Install.PackageManager;

const DefaultTrustedCommand = @import("./pm_trusted_command.zig").DefaultTrustedCommand;
const TrustCommand = @import("./pm_trusted_command.zig").TrustCommand;
const UntrustedCommand = @import("./pm_trusted_command.zig").UntrustedCommand;

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const log = bun.log;
const strings = bun.strings;
const File = bun.sys.File;
