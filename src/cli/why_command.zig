const std = @import("std");
const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const string = bun.string;
const strings = bun.strings;
const Command = @import("../cli.zig").Command;
const Install = @import("../install/install.zig");
const PackageID = Install.PackageID;
const DependencyID = Install.DependencyID;
const PackageManager = Install.PackageManager;
const Lockfile = @import("../install/lockfile.zig");
const Dependency = @import("../install/dependency.zig");

const DependencyPath = struct {
    packages: std.ArrayList(PackageID),
    depth: usize,

    fn init(allocator: std.mem.Allocator) @This() {
        return .{
            .packages = std.ArrayList(PackageID).init(allocator),
            .depth = 0,
        };
    }

    fn deinit(self: *@This()) void {
        self.packages.deinit();
    }
};

fn findDependencyPaths(lockfile: *Lockfile, target_pkg_id: PackageID, target_name: []const u8, allocator: std.mem.Allocator) !std.ArrayList(DependencyPath) {
    const dependencies = lockfile.buffers.dependencies.items;
    const resolutions = lockfile.buffers.resolutions.items;
    const pkgs = lockfile.packages.slice();
    const string_bytes = lockfile.buffers.string_bytes.items;

    var paths = std.ArrayList(DependencyPath).init(allocator);
    var visited = std.AutoHashMap(PackageID, void).init(allocator);
    defer visited.deinit();

    // BFS to find all paths from root to target
    var queue = std.ArrayList(DependencyPath).init(allocator);
    defer {
        for (queue.items) |*path| {
            path.deinit();
        }
        queue.deinit();
    }

    // Start with root package
    var root_path = DependencyPath.init(allocator);
    try root_path.packages.append(0);
    try queue.append(root_path);

    while (queue.items.len > 0) {
        var current_path = queue.orderedRemove(0);
        const current_pkg = current_path.packages.items[current_path.packages.items.len - 1];

        // Check if current package depends on our target
        const pkg_deps = pkgs.items(.dependencies)[current_pkg];
        for (0..pkg_deps.len) |i| {
            const dep_id = @as(DependencyID, @truncate(pkg_deps.off + i));
            const dep = dependencies[dep_id];
            const dep_name = dep.name.slice(string_bytes);

            if (strings.eqlLong(dep_name, target_name, true) and resolutions[dep_id] == target_pkg_id) {
                // Found a path! Add target to current path
                var complete_path = DependencyPath.init(allocator);
                for (current_path.packages.items) |pkg_id| {
                    try complete_path.packages.append(pkg_id);
                }
                try complete_path.packages.append(target_pkg_id);
                complete_path.depth = complete_path.packages.items.len - 1;
                try paths.append(complete_path);
                continue;
            }

            // Continue exploring if this leads to another package
            const resolved_pkg = resolutions[dep_id];
            if (resolved_pkg < lockfile.packages.len and resolved_pkg != target_pkg_id) {
                // Avoid cycles
                var has_cycle = false;
                for (current_path.packages.items) |visited_pkg| {
                    if (visited_pkg == resolved_pkg) {
                        has_cycle = true;
                        break;
                    }
                }

                if (!has_cycle and current_path.packages.items.len < 10) { // Limit depth
                    var new_path = DependencyPath.init(allocator);
                    for (current_path.packages.items) |pkg_id| {
                        try new_path.packages.append(pkg_id);
                    }
                    try new_path.packages.append(resolved_pkg);
                    try queue.append(new_path);
                }
            }
        }

        current_path.deinit();
    }

    return paths;
}

pub const WhyCommand = struct {
    pub fn exec(lockfile: *Lockfile, pm: *PackageManager, query: []const u8) !void {
        const string_bytes = lockfile.buffers.string_bytes.items;
        const pkgs = lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        const pkg_resolutions = pkgs.items(.resolution);

        var found = false;
        // Check for --json flag - it might be in positionals or we can check all CLI args
        var json_output = strings.leftHasAnyInRight(pm.options.positionals, &.{"--json"});

        // Also check if --json appears anywhere in the full command line
        if (!json_output) {
            var arg_it = std.process.argsWithAllocator(lockfile.allocator) catch return;
            defer arg_it.deinit();
            while (arg_it.next()) |arg| {
                if (strings.eql(arg, "--json")) {
                    json_output = true;
                    break;
                }
            }
        }

        // Find all packages that match the query name
        var matching_package_ids = std.ArrayList(PackageID).init(lockfile.allocator);
        defer matching_package_ids.deinit();

        for (pkg_names, 0..) |pkg_name, pkg_idx| {
            const name = pkg_name.slice(string_bytes);
            if (strings.eqlLong(name, query, true)) {
                try matching_package_ids.append(@as(PackageID, @truncate(pkg_idx)));
            }
        }

        if (matching_package_ids.items.len == 0) {
            if (json_output) {
                Output.println("{{\"error\": \"package not found\"}}", .{});
            } else {
                // In test environment, error messages go to stdout
                Output.println("error: package '{s}' not found", .{query});
            }
            return;
        }

        // Show legend and header once for non-JSON output
        if (!json_output) {
            Output.prettyln("DEBUG: Showing header", .{});
            Output.prettyln("Legend: <green>production dependency<r>, <blue>optional only<r>, <yellow>dev only<r>", .{});
            Output.prettyln("", .{});

            // Get root package info
            const root_name = pkg_names[0].slice(string_bytes);
            var root_version_buf: [512]u8 = undefined;
            const root_version_str = std.fmt.bufPrint(&root_version_buf, "{}", .{pkg_resolutions[0].fmt(string_bytes, .auto)}) catch "unknown";
            
            // Try to get current working directory for display
            var cwd_buf: [std.fs.max_path_bytes]u8 = undefined;
            const cwd = std.process.getCwd(&cwd_buf) catch "/unknown";
            
            Output.prettyln("{s} {s} {s}", .{ root_name, root_version_str, cwd });
            Output.prettyln("", .{});
            Output.prettyln("dependencies:", .{});
        }

        for (matching_package_ids.items) |target_pkg_id| {
            found = true;

            var version_buf: [512]u8 = undefined;
            const version_str = try std.fmt.bufPrint(&version_buf, "{}", .{pkg_resolutions[target_pkg_id].fmt(string_bytes, .auto)});
            const target_name = pkg_names[target_pkg_id].slice(string_bytes);

            // Find all dependency paths
            var paths = try findDependencyPaths(lockfile, target_pkg_id, target_name, lockfile.allocator);
            defer {
                for (paths.items) |*path| {
                    path.deinit();
                }
                paths.deinit();
            }

            if (json_output) {
                // JSON output with proper dependency chain
                Output.println("{{", .{});
                Output.println("  \"dependencies\": [", .{});
                Output.println("    {{", .{});
                Output.println("      \"name\": \"{s}\",", .{target_name});
                Output.println("      \"version\": \"{s}\",", .{version_str});
                Output.println("      \"hops\": {d},", .{if (paths.items.len > 0) paths.items[0].depth else 0});
                Output.println("      \"dependencyChain\": [", .{});

                if (paths.items.len > 0) {
                    // Sort paths by depth first
                    std.sort.pdq(DependencyPath, paths.items, {}, struct {
                        fn lessThan(_: void, a: DependencyPath, b: DependencyPath) bool {
                            return a.depth < b.depth;
                        }
                    }.lessThan);

                    const first_path = paths.items[0];
                    for (first_path.packages.items, 0..) |pkg_id, step| {
                        const pkg_name = pkg_names[pkg_id].slice(string_bytes);
                        var pkg_version_buf: [512]u8 = undefined;
                        const pkg_version_str = std.fmt.bufPrint(&pkg_version_buf, "{}", .{pkg_resolutions[pkg_id].fmt(string_bytes, .auto)}) catch continue;

                        const from_name = if (step == 0) "root" else pkg_name;
                        const comma = if (step == first_path.packages.items.len - 1) "" else ",";
                        Output.println("        {{\"from\": \"{s}\", \"version\": \"{s}\"}}{s}", .{ from_name, pkg_version_str, comma });
                    }
                }

                Output.println("      ]", .{});
                Output.println("    }}", .{});
                Output.println("  ]", .{});
                Output.println("}}", .{});
            } else {
                // pnpm-style output
                if (paths.items.len == 0) {
                    Output.prettyln("Package \"{s}\" not found", .{target_name});
                    return;
                }


                // Sort paths by depth (shortest first) and group by direct dependency
                std.sort.pdq(DependencyPath, paths.items, {}, struct {
                    fn lessThan(_: void, a: DependencyPath, b: DependencyPath) bool {
                        if (a.packages.items.len != b.packages.items.len) {
                            return a.packages.items.len < b.packages.items.len;
                        }
                        // If same depth, sort by first dependency name
                        if (a.packages.items.len > 1 and b.packages.items.len > 1) {
                            const a_name = pkg_names[a.packages.items[1]].slice(string_bytes);
                            const b_name = pkg_names[b.packages.items[1]].slice(string_bytes);
                            return strings.order(a_name, b_name) == .lt;
                        }
                        return false;
                    }
                }.lessThan);

                // Show each dependency path
                for (paths.items) |path| {
                    if (path.packages.items.len < 2) continue;

                    // Get direct dependency (first after root)
                    const direct_dep_id = path.packages.items[1];
                    const direct_dep_name = pkg_names[direct_dep_id].slice(string_bytes);
                    var direct_dep_version_buf: [512]u8 = undefined;
                    const direct_dep_version_str = std.fmt.bufPrint(&direct_dep_version_buf, "{}", .{pkg_resolutions[direct_dep_id].fmt(string_bytes, .auto)}) catch continue;

                    // Get dependency type for direct dependency
                    var direct_dep_type_suffix: []const u8 = "";
                    const root_deps = pkgs.items(.dependencies)[0];
                    const dependencies = lockfile.buffers.dependencies.items;
                    const resolutions = lockfile.buffers.resolutions.items;
                    
                    for (0..root_deps.len) |i| {
                        const dep_id = @as(DependencyID, @truncate(root_deps.off + i));
                        if (resolutions[dep_id] == direct_dep_id) {
                            const dep = dependencies[dep_id];
                            if (dep.behavior.isDev()) {
                                direct_dep_type_suffix = " <yellow>dev<r>";
                            } else if (dep.behavior.isOptional()) {
                                direct_dep_type_suffix = " <blue>optional<r>";
                            } else if (dep.behavior.isPeer()) {
                                direct_dep_type_suffix = " <cyan>peer<r>";
                            }
                            break;
                        }
                    }

                    // Show the direct dependency
                    const is_direct_target = direct_dep_id == target_pkg_id;
                    if (is_direct_target) {
                        Output.prettyln("<b>{s}<r> <d>{s}<r>{s}", .{ direct_dep_name, direct_dep_version_str, direct_dep_type_suffix });
                    } else {
                        Output.prettyln("{s} <d>{s}<r>{s}", .{ direct_dep_name, direct_dep_version_str, direct_dep_type_suffix });
                    }

                    // Show the path to target if it's not the direct dependency
                    if (!is_direct_target and path.packages.items.len > 2) {
                        for (path.packages.items[2..], 0..) |pkg_id, depth| {
                            const pkg_name = pkg_names[pkg_id].slice(string_bytes);
                            var pkg_version_buf: [512]u8 = undefined;
                            const pkg_version_str = std.fmt.bufPrint(&pkg_version_buf, "{}", .{pkg_resolutions[pkg_id].fmt(string_bytes, .auto)}) catch continue;

                            // Determine if this is our target package
                            const is_target = pkg_id == target_pkg_id;
                            
                            // Get dependency type for this level
                            var dep_type_suffix: []const u8 = "";
                            const parent_pkg_id = path.packages.items[depth + 1];
                            const parent_deps = pkgs.items(.dependencies)[parent_pkg_id];
                            
                            for (0..parent_deps.len) |i| {
                                const dep_id = @as(DependencyID, @truncate(parent_deps.off + i));
                                if (resolutions[dep_id] == pkg_id) {
                                    const dep = dependencies[dep_id];
                                    if (dep.behavior.isDev()) {
                                        dep_type_suffix = " <yellow>dev<r>";
                                    } else if (dep.behavior.isOptional()) {
                                        dep_type_suffix = " <blue>optional<r>";
                                    } else if (dep.behavior.isPeer()) {
                                        dep_type_suffix = " <cyan>peer<r>";
                                    }
                                    break;
                                }
                            }

                            // Show the tree structure
                            const is_last = depth == path.packages.items.len - 3;
                            const tree_char = if (is_last) "└──" else "├──";
                            
                            if (is_target) {
                                // Emphasize target package name
                                Output.prettyln("{s} <b>{s}<r> <d>{s}<r>{s}", .{ tree_char, pkg_name, pkg_version_str, dep_type_suffix });
                            } else {
                                // Normal nested dependency
                                Output.prettyln("{s} {s} <d>{s}<r>{s}", .{ tree_char, pkg_name, pkg_version_str, dep_type_suffix });
                            }
                        }
                    }
                }
            }
        }
    }
};
