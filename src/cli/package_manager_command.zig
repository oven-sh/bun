const Command = @import("../cli.zig").Command;
const PackageManager = @import("../install/install.zig").PackageManager;
const ComamndLineArguments = PackageManager.CommandLineArguments;
const std = @import("std");
const strings = @import("bun").strings;
const Lockfile = @import("../install/lockfile.zig");
const NodeModulesFolder = Lockfile.Tree.NodeModulesFolder;
const PackageID = @import("../install/install.zig").PackageID;
const PackageInstaller = @import("../install/install.zig").PackageInstaller;
const Global = @import("bun").Global;
const Output = @import("bun").Output;
const Fs = @import("../fs.zig");
const Path = @import("../resolver/resolve_path.zig");
const bun = @import("bun");
const StringBuilder = bun.StringBuilder;
const string = bun.string;
const stringZ = bun.stringZ;
pub const PackageManagerCommand = struct {
    pub fn printHelp(_: std.mem.Allocator) void {}
    pub fn printHash(ctx: Command.Context, lockfile_: []const u8) !void {
        @setCold(true);
        var lockfile_buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
        @memcpy(&lockfile_buffer, lockfile_.ptr, lockfile_.len);
        lockfile_buffer[lockfile_.len] = 0;
        var lockfile = lockfile_buffer[0..lockfile_.len :0];
        var pm = try PackageManager.init(ctx, null, &PackageManager.install_params);

        const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, lockfile);
        if (load_lockfile == .not_found) {
            if (pm.options.log_level != .silent)
                Output.prettyError("Lockfile not found", .{});
            Global.exit(1);
        }

        if (load_lockfile == .err) {
            if (pm.options.log_level != .silent)
                Output.prettyError("Error loading lockfile: {s}", .{@errorName(load_lockfile.err.value)});
            Global.exit(1);
        }

        Output.flush();
        Output.disableBuffering();
        try Output.writer().print("{}", .{load_lockfile.ok.fmtMetaHash()});
        Output.enableBuffering();
        Global.exit(0);
    }

    pub fn exec(ctx: Command.Context) !void {
        var args = try std.process.argsAlloc(ctx.allocator);
        args = args[1..];

        var pm = try PackageManager.init(ctx, null, &PackageManager.install_params);

        var first: []const u8 = if (pm.options.positionals.len > 0) pm.options.positionals[0] else "";
        if (strings.eqlComptime(first, "pm")) {
            first = "";
            if (pm.options.positionals.len > 1) {
                pm.options.positionals = pm.options.positionals[1..];
                first = pm.options.positionals[0];
            }
        }

        if (pm.options.global) {
            try pm.setupGlobalDir(&ctx);
        }

        if (strings.eqlComptime(first, "bin")) {
            var output_path = Path.joinAbs(Fs.FileSystem.instance.top_level_dir, .auto, std.mem.span(pm.options.bin_path));
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
        } else if (strings.eqlComptime(first, "hash")) {
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            if (load_lockfile == .not_found) {
                if (pm.options.log_level != .silent)
                    Output.prettyError("Lockfile not found", .{});
                Global.exit(1);
            }

            if (load_lockfile == .err) {
                if (pm.options.log_level != .silent)
                    Output.prettyError("Error loading lockfile: {s}", .{@errorName(load_lockfile.err.value)});
                Global.exit(1);
            }

            _ = try pm.lockfile.hasMetaHashChanged(false);

            Output.flush();
            Output.disableBuffering();
            try Output.writer().print("{}", .{load_lockfile.ok.fmtMetaHash()});
            Output.enableBuffering();
            Global.exit(0);
        } else if (strings.eqlComptime(first, "hash-print")) {
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            if (load_lockfile == .not_found) {
                if (pm.options.log_level != .silent)
                    Output.prettyError("Lockfile not found", .{});
                Global.exit(1);
            }

            if (load_lockfile == .err) {
                if (pm.options.log_level != .silent)
                    Output.prettyError("Error loading lockfile: {s}", .{@errorName(load_lockfile.err.value)});
                Global.exit(1);
            }

            Output.flush();
            Output.disableBuffering();
            try Output.writer().print("{}", .{load_lockfile.ok.fmtMetaHash()});
            Output.enableBuffering();
            Global.exit(0);
        } else if (strings.eqlComptime(first, "hash-string")) {
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            if (load_lockfile == .not_found) {
                if (pm.options.log_level != .silent)
                    Output.prettyError("Lockfile not found", .{});
                Global.exit(1);
            }

            if (load_lockfile == .err) {
                if (pm.options.log_level != .silent)
                    Output.prettyError("Error loading lockfile: {s}", .{@errorName(load_lockfile.err.value)});
                Global.exit(1);
            }

            _ = try pm.lockfile.hasMetaHashChanged(true);
            Global.exit(0);
        } else if (strings.eqlComptime(first, "cache")) {
            var dir: [bun.MAX_PATH_BYTES]u8 = undefined;
            var fd = pm.getCacheDirectory();
            var outpath = std.os.getFdPath(fd.fd, &dir) catch |err| {
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
        } else if (strings.eqlComptime(first, "ls")) {
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            if (load_lockfile == .not_found) {
                if (pm.options.log_level != .silent)
                    Output.prettyError("Lockfile not found", .{});
                Global.exit(1);
            }

            if (load_lockfile == .err) {
                if (pm.options.log_level != .silent)
                    Output.prettyError("Error loading lockfile: {s}", .{@errorName(load_lockfile.err.value)});
                Global.exit(1);
            }

            Output.flush();
            Output.disableBuffering();
            const lockfile = load_lockfile.ok;

            const parts = lockfile.packages.slice();
            const names = parts.items(.name);

            var iterator = Lockfile.Tree.Iterator.init(
                lockfile.buffers.trees.items,
                lockfile.buffers.hoisted_packages.items,
                names,
                lockfile.buffers.string_bytes.items,
            );

            var directories = std.ArrayList(NodeModulesFolder).init(ctx.allocator);
            defer directories.deinit();
            while (iterator.nextNodeModulesFolder()) |node_modules| {
                const path = try ctx.allocator.alloc(u8, node_modules.relative_path.len);
                std.mem.copy(u8, path, node_modules.relative_path);

                const packages = try ctx.allocator.alloc(PackageID, node_modules.packages.len);
                std.mem.copy(PackageID, packages, node_modules.packages);

                const folder: NodeModulesFolder = .{
                    .relative_path = @ptrCast(stringZ, path),
                    .in = node_modules.in,
                    .packages = packages,
                };
                directories.append(folder) catch unreachable;
            }

            const first_directory = directories.orderedRemove(0);

            // TODO: find max depth beforehand
            var more_packages = [_]bool{false} ** 16;
            if (first_directory.packages.len > 1) more_packages[0] = true;
            printNodeModulesFolderStructure(&first_directory, null, 0, &directories, lockfile, more_packages);
            Output.enableBuffering();
            Global.exit(0);
        }

        Output.prettyln(
            \\bun pm - package manager related commands
            \\   
            \\  bun pm <b>bin<r>          print the path to bin folder
            \\  bun pm <b>-g bin<r>       print the <b>global<r> path to bin folder
            \\  bun pm <b>hash<r>         generate & print the hash of the current lockfile
            \\  bun pm <b>hash-string<r>  print the string used to hash the lockfile
            \\  bun pm <b>hash-print<r>   print the hash stored in the current lockfile
            \\  bun pm <b>cache<r>        print the path to the cache folder
            \\  bun pm <b>cache rm<r>     clear the cache
            \\  bun pm <b>ls<r>           list the directory structure of the current lockfile
            \\
        , .{});

        if (first.len > 0) {
            Output.prettyErrorln("\n<red>error<r>: \"{s}\" unknown command\n", .{first});
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
) void {
    const allocator = lockfile.allocator;
    var more_packages = more_packages_;
    const parts = lockfile.packages.slice();
    const names = parts.items(.name);
    const resolutions = parts.items(.resolution);
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
            const directory_version = std.fmt.bufPrint(&resolution_buf, "{}", .{resolutions[id].fmt(string_bytes)}) catch unreachable;
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

    for (directory.packages) |package_id, package_index| {
        const package_name_ = names[package_id].slice(string_bytes);
        const package_name = allocator.alloc(u8, package_name_.len) catch unreachable;
        defer allocator.free(package_name);
        std.mem.copy(u8, package_name, package_name_);

        var possible_path = std.fmt.allocPrint(allocator, "{s}/{s}/node_modules", .{ directory.relative_path, package_name }) catch unreachable;
        defer allocator.free(possible_path);

        if (package_index + 1 == directory.packages.len) {
            more_packages[depth] = false;
        }

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

                if (package_index + 1 < directory.packages.len) more_packages[new_depth] = true;
                printNodeModulesFolderStructure(&next, package_id, new_depth, directories, lockfile, more_packages);
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
        const package_version = std.fmt.bufPrint(&resolution_buf, "{}", .{resolutions[package_id].fmt(string_bytes)}) catch unreachable;
        Output.prettyln("{s}<d>@{s}<r>", .{ package_name, package_version });
    }
}
