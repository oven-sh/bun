const std = @import("std");
const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const string = bun.string;
const strings = bun.strings;
const Command = @import("../cli.zig").Command;
const Install = @import("../install/install.zig");
const PackageManager = Install.PackageManager;
const PackageManagerCommand = @import("./package_manager_command.zig").PackageManagerCommand;
const Lockfile = @import("../install/lockfile.zig");
const NodeModulesFolder = Lockfile.Tree.Iterator(.node_modules).Next;
const DependencyID = Install.DependencyID;

const ByName = struct {
    dependencies: []const Install.Dependency,
    buf: []const u8,

    pub fn isLessThan(ctx: ByName, lhs: DependencyID, rhs: DependencyID) bool {
        return strings.cmpStringsAsc(
            {},
            ctx.dependencies[lhs].name.slice(ctx.buf),
            ctx.dependencies[rhs].name.slice(ctx.buf),
        );
    }
};

pub const ListCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .pm);
        var pm, const cwd = PackageManager.init(ctx, cli, PackageManager.Subcommand.pm) catch |err| {
            if (err == error.MissingPackageJSON) {
                var cwd_buf: bun.PathBuffer = undefined;
                if (bun.getcwd(&cwd_buf)) |cwd_path| {
                    Output.errGeneric("No package.json was found for directory \"{s}\"", .{cwd_path});
                } else |_| {
                    Output.errGeneric("No package.json was found", .{});
                }
                Output.note("Run \"bun init\" to initialize a project", .{});
                Global.exit(1);
            }
            return err;
        };
        defer ctx.allocator.free(cwd);

        if (pm.options.global) {
            try pm.setupGlobalDir(ctx);
        }

        const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
        PackageManagerCommand.handleLoadLockfileErrors(load_lockfile, pm);

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

        // Check for --all flag
        const args = try std.process.argsAlloc(ctx.allocator);
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
    }
};

fn printNodeModulesFolderStructure(
    directory: *const NodeModulesFolder,
    directory_package_id: ?Install.PackageID,
    depth: usize,
    directories: *std.ArrayList(NodeModulesFolder),
    lockfile: *Lockfile,
    more_packages: []bool,
) !void {
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
            Output.prettyln("{s} node_modules", .{path});
        }
    }

    // Sort IDs by name
    const sorted_deps = try lockfile.allocator.alloc(DependencyID, directory.dependencies.len);
    defer lockfile.allocator.free(sorted_deps);
    bun.copy(DependencyID, sorted_deps, directory.dependencies);
    const tree_id = directory.tree_id;
    const dependencies = lockfile.buffers.trees.items[tree_id].dependencies.items;
    const resolutions_list = lockfile.buffers.trees.items[tree_id].resolutions.items;
    const list = lockfile.buffers.trees.items[tree_id].list.items;

    std.sort.pdq(DependencyID, sorted_deps, ByName{
        .dependencies = dependencies,
        .buf = string_bytes,
    }, ByName.isLessThan);

    for (sorted_deps, 0..) |dependency_id, j| {
        const pkg_id = resolutions_list[dependency_id];
        const dependency = dependencies[dependency_id];
        const name = dependency.name.slice(string_bytes);
        const new_directory_i = std.mem.indexOfScalar(u8, list, @intFromEnum(dependency_id));

        if (j < sorted_deps.len - 1) {
            more_packages[depth] = true;
        } else {
            more_packages[depth] = false;
        }

        if (new_directory_i != null and directories.items.len > 0) {
            const new_directory = &directories.items[0];
            _ = directories.orderedRemove(0);
            try printNodeModulesFolderStructure(new_directory, pkg_id, depth + 1, directories, lockfile, more_packages);
        } else {
            {
                var i: usize = 0;
                while (i < depth + 1) : (i += 1) {
                    if (i == depth) {
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
                const resolution = resolutions[pkg_id].fmt(string_bytes, .auto);
                Output.prettyln(" {s}<d>@{}<r>", .{ name, resolution });
            }
        }
    }
}
