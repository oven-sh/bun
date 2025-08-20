const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const Output = bun.Output;
const Global = bun.Global;
const Command = @import("../cli.zig").Command;
const Install = @import("../install/install.zig");
const PackageManager = Install.PackageManager;
const Lockfile = @import("../install/lockfile.zig");
const DependencyID = Install.DependencyID;
const PackageID = Install.PackageID;
const fs = @import("../fs.zig");
const Fs = fs.FileSystem;

pub const PruneCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .install);
        
        var manager, const original_cwd = PackageManager.init(ctx, cli, .install) catch |err| {
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
        defer ctx.allocator.free(original_cwd);

        if (manager.options.shouldPrintCommandName()) {
            Output.prettyln("<r><b>bun prune <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
            Output.flush();
        }

        // Load the lockfile to understand which packages should be kept
        const load_lockfile = manager.lockfile.loadFromCwd(manager, ctx.allocator, ctx.log, true);
        if (load_lockfile == .not_found) {
            if (manager.options.log_level != .silent) {
                Output.errGeneric("Lockfile not found", .{});
            }
            Global.exit(1);
        }

        if (load_lockfile == .err) {
            if (manager.options.log_level != .silent) {
                Output.errGeneric("Error loading lockfile: {s}", .{@errorName(load_lockfile.err.value)});
            }
            Global.exit(1);
        }

        const lockfile = load_lockfile.ok.lockfile;
        
        try pruneNodeModules(ctx.allocator, manager, lockfile);

        if (manager.options.log_level != .silent) {
            Output.prettyln("<r><green>Pruned extraneous packages<r>", .{});
            Output.flush();
        }
    }

    fn pruneNodeModules(allocator: std.mem.Allocator, manager: *PackageManager, lockfile: *Lockfile) !void {
        // Get the current working directory
        var cwd_buf: bun.PathBuffer = undefined;
        const cwd = bun.getcwd(&cwd_buf) catch {
            Output.prettyErrorln("<r><red>error<r>: Could not get current working directory", .{});
            Global.exit(1);
        };
        
        // Construct node_modules path
        var node_modules_buf: bun.PathBuffer = undefined;
        const node_modules_path = try std.fmt.bufPrint(&node_modules_buf, "{s}/node_modules", .{cwd});

        // Get the list of packages that should exist according to the lockfile
        var expected_packages = std.StringHashMap(void).init(allocator);
        defer expected_packages.deinit();

        // Add all packages that are actually used/installed
        // We'll iterate through the lockfile packages to find what should be installed
        const dependencies = lockfile.buffers.dependencies.items;
        const string_bytes = lockfile.buffers.string_bytes.items;
        const packages_slice = lockfile.packages.slice();
        const package_names = packages_slice.items(.name);
        
        // Add all packages that are in the lockfile
        for (package_names) |package_name_string| {
            const package_name = package_name_string.slice(string_bytes);
            try expected_packages.put(package_name, {});
        }

        // Also check for any hoisted dependencies
        for (lockfile.buffers.hoisted_dependencies.items) |hoisted_dep| {
            if (hoisted_dep < dependencies.len) {
                const dep = dependencies[hoisted_dep];
                const package_name = dep.name.slice(string_bytes);
                try expected_packages.put(package_name, {});
            }
        }

        // Open node_modules directory
        var node_modules_dir = std.fs.openDirAbsolute(node_modules_path, .{ .iterate = true }) catch |err| switch (err) {
            error.FileNotFound => {
                // No node_modules directory, nothing to prune
                return;
            },
            else => return err,
        };
        defer node_modules_dir.close();

        var iterator = node_modules_dir.iterate();
        var pruned_count: u32 = 0;
        
        while (try iterator.next()) |entry| {
            if (entry.kind != .directory) continue;

            const dirname = entry.name;
            
            // Skip .bin directory and other dot directories
            if (strings.hasPrefix(dirname, ".")) continue;

            // Handle scoped packages (@scope/package)
            if (strings.hasPrefix(dirname, "@")) {
                // This is a scope directory, iterate through it
                var scope_dir = node_modules_dir.openDir(dirname, .{ .iterate = true }) catch continue;
                defer scope_dir.close();
                
                var scope_iterator = scope_dir.iterate();
                while (try scope_iterator.next()) |scope_entry| {
                    if (scope_entry.kind != .directory) continue;
                    
                    const scoped_package_name = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ dirname, scope_entry.name });
                    defer allocator.free(scoped_package_name);
                    
                    if (!expected_packages.contains(scoped_package_name)) {
                        // This package should be removed
                        if (manager.options.log_level.showProgress()) {
                            Output.prettyln("<r><d>Removing<r> {s}", .{scoped_package_name});
                        }
                        
                        scope_dir.deleteTree(scope_entry.name) catch |err| {
                            if (manager.options.log_level != .silent) {
                                Output.err(err, "Failed to remove {s}", .{scoped_package_name});
                            }
                            continue;
                        };
                        pruned_count += 1;
                    }
                }
            } else {
                // Regular package
                if (!expected_packages.contains(dirname)) {
                    // This package should be removed
                    if (manager.options.log_level.showProgress()) {
                        Output.prettyln("<r><d>Removing<r> {s}", .{dirname});
                    }
                    
                    node_modules_dir.deleteTree(dirname) catch |err| {
                        if (manager.options.log_level != .silent) {
                            Output.err(err, "Failed to remove {s}", .{dirname});
                        }
                        continue;
                    };
                    pruned_count += 1;
                }
            }
        }

        if (manager.options.log_level != .silent and pruned_count > 0) {
            Output.prettyln("<r><green>Removed {d} extraneous package{s}<r>", .{ pruned_count, if (pruned_count == 1) "" else "s" });
        }
    }
};