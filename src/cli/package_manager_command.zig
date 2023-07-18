const std = @import("std");
const bun = @import("root").bun;
const Global = bun.Global;
const Output = bun.Output;
const string = bun.string;
const strings = bun.strings;
const Command = @import("../cli.zig").Command;
const Fs = @import("../fs.zig");
const Dependency = @import("../install/dependency.zig");
const Install = @import("../install/install.zig");
const PackageID = Install.PackageID;
const DependencyID = Install.DependencyID;
const PackageManager = Install.PackageManager;
const Lockfile = @import("../install/lockfile.zig");
const NodeModulesFolder = Lockfile.Tree.NodeModulesFolder;
const Path = @import("../resolver/resolve_path.zig");
const String = @import("../install/semver.zig").String;

fn handleLoadLockfileErrors(load_lockfile: Lockfile.LoadFromDiskResult, pm: *PackageManager) void {
    if (load_lockfile == .not_found) {
        if (pm.options.log_level != .silent)
            Output.prettyErrorln("Lockfile not found", .{});
        Global.exit(1);
    }

    if (load_lockfile == .err) {
        if (pm.options.log_level != .silent)
            Output.prettyErrorln("Error loading lockfile: {s}", .{@errorName(load_lockfile.err.value)});
        Global.exit(1);
    }
}

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
    pub fn printHelp(_: std.mem.Allocator) void {}
    pub fn printHash(ctx: Command.Context, lockfile_: []const u8) !void {
        @setCold(true);
        var lockfile_buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
        @memcpy(lockfile_buffer[0..lockfile_.len], lockfile_);
        lockfile_buffer[lockfile_.len] = 0;
        var lockfile = lockfile_buffer[0..lockfile_.len :0];
        var pm = try PackageManager.init(ctx, null, PackageManager.Subcommand.pm);

        const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, lockfile);
        handleLoadLockfileErrors(load_lockfile, pm);

        Output.flush();
        Output.disableBuffering();
        try Output.writer().print("{}", .{load_lockfile.ok.fmtMetaHash()});
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

    pub fn exec(ctx: Command.Context) !void {
        var args = try std.process.argsAlloc(ctx.allocator);
        args = args[1..];

        var pm = PackageManager.init(ctx, null, PackageManager.Subcommand.pm) catch |err| {
            // TODO: error messages here
            // if (err == error.MissingPackageJSON) {
            //     // TODO: error messages
            //     // var cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, PackageManager.Subcommand.pm, &_ctx);
            // }

            return err;
        };

        const subcommand = getSubcommand(&pm.options.positionals);
        if (pm.options.global) {
            try pm.setupGlobalDir(&ctx);
        }

        if (strings.eqlComptime(subcommand, "bin")) {
            var output_path = Path.joinAbs(Fs.FileSystem.instance.top_level_dir, .auto, bun.asByteSlice(pm.options.bin_path));
            Output.prettyln("{s}", .{output_path});
            if (Output.stdout_descriptor_type == .terminal) {
                Output.prettyln("\n", .{});
            }

            if (pm.options.global) {
                warner: {
                    if (Output.enable_ansi_colors_stderr) {
                        if (bun.getenvZ("PATH")) |path| {
                            var path_splitter = std.mem.split(u8, path, ":");
                            while (path_splitter.next()) |entry| {
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
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            handleLoadLockfileErrors(load_lockfile, pm);

            _ = try pm.lockfile.hasMetaHashChanged(false);

            Output.flush();
            Output.disableBuffering();
            try Output.writer().print("{}", .{load_lockfile.ok.fmtMetaHash()});
            Output.enableBuffering();
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "hash-print")) {
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            handleLoadLockfileErrors(load_lockfile, pm);

            Output.flush();
            Output.disableBuffering();
            try Output.writer().print("{}", .{load_lockfile.ok.fmtMetaHash()});
            Output.enableBuffering();
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "hash-string")) {
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            handleLoadLockfileErrors(load_lockfile, pm);

            _ = try pm.lockfile.hasMetaHashChanged(true);
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "cache")) {
            var dir: [bun.MAX_PATH_BYTES]u8 = undefined;
            var fd = pm.getCacheDirectory();
            var outpath = bun.getFdPath(fd.dir.fd, &dir) catch |err| {
                Output.prettyErrorln("{s} getting cache directory", .{@errorName(err)});
                Global.crash();
            };

            if (pm.options.positionals.len > 0 and strings.eqlComptime(pm.options.positionals[0], "rm")) {
                std.fs.deleteTreeAbsolute(outpath) catch |err| {
                    Output.prettyErrorln("{s} deleting cache directory", .{@errorName(err)});
                    Global.crash();
                };
                Output.prettyln("Cache directory deleted:\n  {s}", .{outpath});
                Global.exit(0);
            }
            Output.writer().writeAll(outpath) catch {};
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "ls")) {
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            handleLoadLockfileErrors(load_lockfile, pm);

            Output.flush();
            Output.disableBuffering();
            const lockfile = load_lockfile.ok;
            var iterator = Lockfile.Tree.Iterator.init(lockfile);

            var directories = std.ArrayList(NodeModulesFolder).init(ctx.allocator);
            defer directories.deinit();
            while (iterator.nextNodeModulesFolder()) |node_modules| {
                const path_len = node_modules.relative_path.len;
                const path = try ctx.allocator.alloc(u8, path_len + 1);
                bun.copy(u8, path, node_modules.relative_path);
                path[path_len] = 0;

                const dependencies = try ctx.allocator.alloc(DependencyID, node_modules.dependencies.len);
                bun.copy(DependencyID, dependencies, node_modules.dependencies);

                try directories.append(.{
                    .relative_path = path[0..path_len :0],
                    .dependencies = dependencies,
                });
            }

            const first_directory = directories.orderedRemove(0);

            // TODO: find max depth beforehand
            var more_packages = [_]bool{false} ** 16;
            if (first_directory.dependencies.len > 1) more_packages[0] = true;

            if (strings.leftHasAnyInRight(args, &.{ "-A", "-a", "--all" })) {
                try printNodeModulesFolderStructure(&first_directory, null, 0, &directories, lockfile, more_packages);
            } else {
                var cwd_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const path = std.os.getcwd(&cwd_buf) catch {
                    Output.prettyErrorln("<r><red>error<r>: Could not get current working directory", .{});
                    Global.exit(1);
                };
                const dependencies = lockfile.buffers.dependencies.items;
                const slice = lockfile.packages.slice();
                const resolutions = slice.items(.resolution);
                const root_deps = slice.items(.dependencies)[0];

                Output.println("{s} node_modules ({d})", .{ path, dependencies.len });
                const string_bytes = lockfile.buffers.string_bytes.items;
                const sorted_dependencies = try ctx.allocator.alloc(DependencyID, root_deps.len);
                defer ctx.allocator.free(sorted_dependencies);
                for (sorted_dependencies, 0..) |*dep, i| {
                    dep.* = @as(DependencyID, @truncate(root_deps.off + i));
                }
                std.sort.block(DependencyID, sorted_dependencies, ByName{
                    .dependencies = dependencies,
                    .buf = string_bytes,
                }, ByName.isLessThan);

                for (sorted_dependencies, 0..) |dependency_id, index| {
                    const package_id = lockfile.buffers.resolutions.items[dependency_id];
                    if (package_id >= lockfile.packages.len) continue;
                    const name = dependencies[dependency_id].name.slice(string_bytes);
                    const resolution = resolutions[package_id].fmt(string_bytes);

                    if (index < sorted_dependencies.len - 1) {
                        Output.prettyln("<d>├──<r> {s}<r><d>@{any}<r>\n", .{ name, resolution });
                    } else {
                        Output.prettyln("<d>└──<r> {s}<r><d>@{any}<r>\n", .{ name, resolution });
                    }
                }
            }

            Global.exit(0);
        }

        Output.prettyln(
            \\bun pm - package manager related commands
            \\
            \\  bun pm <b>bin<r>          print the path to bin folder
            \\  bun pm <b>-g bin<r>       print the <b>global<r> path to bin folder
            \\  bun pm <b>ls<r>           list the dependency tree according to the current lockfile
            \\  bun pm <b>ls --all<r>     list the entire dependency tree according to the current lockfile
            \\  bun pm <b>hash<r>         generate & print the hash of the current lockfile
            \\  bun pm <b>hash-string<r>  print the string used to hash the lockfile
            \\  bun pm <b>hash-print<r>   print the hash stored in the current lockfile
            \\  bun pm <b>cache<r>        print the path to the cache folder
            \\  bun pm <b>cache rm<r>     clear the cache
            \\
        , .{});

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
    more_packages_: [16]bool,
) !void {
    const allocator = lockfile.allocator;
    var more_packages = more_packages_;
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
            const directory_version = try std.fmt.bufPrint(&resolution_buf, "{}", .{resolutions[id].fmt(string_bytes)});
            if (std.mem.indexOf(u8, path, "node_modules")) |j| {
                Output.prettyln("{s}<d>@{s}<r>", .{ path[0 .. j - 1], directory_version });
            } else {
                Output.prettyln("{s}<d>@{s}<r>", .{ path, directory_version });
            }
        } else {
            var cwd_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const path = std.os.getcwd(&cwd_buf) catch {
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
    std.sort.block(DependencyID, sorted_dependencies, ByName{
        .dependencies = dependencies,
        .buf = string_bytes,
    }, ByName.isLessThan);

    for (sorted_dependencies, 0..) |dependency_id, index| {
        const package_name = dependencies[dependency_id].name.slice(string_bytes);

        var possible_path = try std.fmt.allocPrint(allocator, "{s}/{s}/node_modules", .{ directory.relative_path, package_name });
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
            if (strings.eql(possible_path, directories.items[dir_index].relative_path)) {
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
        const package_version = try std.fmt.bufPrint(&resolution_buf, "{}", .{resolutions[package_id].fmt(string_bytes)});
        Output.prettyln("{s}<d>@{s}<r>", .{ package_name, package_version });
    }
}
