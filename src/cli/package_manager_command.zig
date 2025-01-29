const std = @import("std");
const Progress = std.Progress;
const bun = @import("root").bun;
const Global = bun.Global;
const Output = bun.Output;
const string = bun.string;
const strings = bun.strings;
const log = bun.log;
const logger = bun.logger;
const Command = @import("../cli.zig").Command;
const Fs = @import("../fs.zig");
const Dependency = @import("../install/dependency.zig");
const Install = @import("../install/install.zig");
const PackageID = Install.PackageID;
const DependencyID = Install.DependencyID;
const PackageManager = Install.PackageManager;
const Lockfile = @import("../install/lockfile.zig");
const NodeModulesFolder = Lockfile.Tree.Iterator(.node_modules).Next;
const Path = @import("../resolver/resolve_path.zig");
const String = @import("../install/semver.zig").String;
const ArrayIdentityContext = bun.ArrayIdentityContext;
const DepIdSet = std.ArrayHashMapUnmanaged(DependencyID, void, ArrayIdentityContext, false);
const UntrustedCommand = @import("./pm_trusted_command.zig").UntrustedCommand;
const TrustCommand = @import("./pm_trusted_command.zig").TrustCommand;
const DefaultTrustedCommand = @import("./pm_trusted_command.zig").DefaultTrustedCommand;
const Environment = bun.Environment;
pub const PackCommand = @import("./pack_command.zig").PackCommand;
const Npm = Install.Npm;
const File = bun.sys.File;

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
        @setCold(true);

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
            \\<b>Usage<r>: <b><green>bun pm<r> <cyan>[flags]<r> <blue>[\<command\>]<r>
            \\  Run package manager utilities
        ;
        const outro_text =
            \\<b>Examples:<r>
            \\
            \\  <b><green>bun pm<r> <blue>pack<r>               create a tarball of the current workspace
            \\  <d>├<r> <cyan>--dry-run<r>               do everything except for writing the tarball to disk
            \\  <d>├<r> <cyan>--destination<r>           the directory the tarball will be saved in
            \\  <d>├<r> <cyan>--ignore-scripts<r>        don't run pre/postpack and prepare scripts
            \\  <d>└<r> <cyan>--gzip-level<r>            specify a custom compression level for gzip (0-9, default is 9)
            \\  <b><green>bun pm<r> <blue>bin<r>                print the path to bin folder
            \\  <d>└<r> <cyan>-g<r>                      print the <b>global<r> path to bin folder
            \\  <b><green>bun pm<r> <blue>ls<r>                 list the dependency tree according to the current lockfile
            \\  <d>└<r> <cyan>--all<r>                   list the entire dependency tree according to the current lockfile
            \\  <b><green>bun pm<r> <blue>whoami<r>             print the current npm username
            \\  <b><green>bun pm<r> <blue>hash<r>               generate & print the hash of the current lockfile
            \\  <b><green>bun pm<r> <blue>hash-string<r>        print the string used to hash the lockfile
            \\  <b><green>bun pm<r> <blue>hash-print<r>         print the hash stored in the current lockfile
            \\  <b><green>bun pm<r> <blue>cache<r>              print the path to the cache folder
            \\  <b><green>bun pm<r> <blue>cache rm<r>           clear the cache
            \\  <b><green>bun pm<r> <blue>migrate<r>            migrate another package manager's lockfile without installing anything
            \\  <b><green>bun pm<r> <blue>untrusted<r>          print current untrusted dependencies with scripts
            \\  <b><green>bun pm<r> <blue>trust<r> <d>names ...<r>    run scripts for untrusted dependencies and add to `trustedDependencies`
            \\  <d>└<r>  <cyan>--all<r>                  trust all untrusted dependencies
            \\  <b><green>bun pm<r> <blue>default-trusted<r>    print the default trusted dependencies list
            \\
            \\Learn more about these at <magenta>https://bun.sh/docs/cli/pm<r>
            \\
        ;

        Output.pretty(intro_text, .{});
        Output.flush();
        Output.pretty("\n\n", .{});
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

        if (strings.eqlComptime(subcommand, "pack")) {
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
            const outpath = bun.getFdPath(fd.fd, &dir) catch |err| {
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
                        if (bun.Environment.isPosix) bun.C.getuid() else bun.windows.userUniqueId(),
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

            Output.flush();
            Output.disableBuffering();
            const lockfile = load_lockfile.ok.lockfile;
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
                try printNodeModulesFolderStructure(&first_directory, null, 0, &directories, lockfile, more_packages);
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
};

fn printNodeModulesFolderStructure(
    directory: *const NodeModulesFolder,
    directory_package_id: ?PackageID,
    depth: usize,
    directories: *std.ArrayList(NodeModulesFolder),
    lockfile: *Lockfile,
    more_packages: []bool,
) !void {
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
                try printNodeModulesFolderStructure(&next, package_id, new_depth, directories, lockfile, more_packages);
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
