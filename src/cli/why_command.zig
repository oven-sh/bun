pub const WhyCommand = struct {
    const PREFIX_LAST = "  └─ ";
    const PREFIX_MIDDLE = "  ├─ ";
    const PREFIX_CONTINUE = "  │  ";
    const PREFIX_SPACE = "     ";
    var max_depth: usize = 100;

    const VersionInfo = struct {
        version: string,
        pkg_id: PackageID,
    };

    const DependentInfo = struct {
        name: string,
        version: string,
        spec: string,
        dep_type: DependencyType,
        pkg_id: PackageID,
        workspace: bool,
    };

    const DependencyType = enum {
        dev,
        prod,
        peer,
        optional,
        optional_peer,
    };

    fn getSpecifierSpecificity(spec: []const u8) u8 {
        if (spec.len == 0) return 9;
        if (spec[0] == '*') return 1;
        if (strings.indexOf(spec, ".x")) |_| return 5;
        if (strings.indexOfAny(spec, "<>=")) |_| return 6;
        if (spec[0] == '~') return 7;
        if (spec[0] == '^') return 8;
        if (strings.indexOf(spec, "workspace:")) |_| return 9;
        if (std.ascii.isDigit(spec[0])) return 10;
        return 3;
    }

    fn getDependencyTypePriority(dep_type: DependencyType) u8 {
        return switch (dep_type) {
            .prod => 4,
            .peer => 3,
            .optional_peer => 2,
            .optional => 1,
            .dev => 0,
        };
    }

    fn compareDependents(context: void, a: DependentInfo, b: DependentInfo) bool {
        _ = context;

        const a_specificity = getSpecifierSpecificity(a.spec);
        const b_specificity = getSpecifierSpecificity(b.spec);

        if (a_specificity != b_specificity) {
            return a_specificity > b_specificity;
        }

        const a_type_priority = getDependencyTypePriority(a.dep_type);
        const b_type_priority = getDependencyTypePriority(b.dep_type);

        if (a_type_priority != b_type_priority) {
            return a_type_priority > b_type_priority;
        }

        return std.mem.lessThan(u8, a.name, b.name);
    }

    const GlobPattern = struct {
        pattern_type: enum {
            exact,
            prefix,
            suffix,
            middle,
            contains,
            invalid,
        },
        prefix: []const u8 = "",
        suffix: []const u8 = "",
        substring: []const u8 = "",
        version_pattern: []const u8 = "",
        version_query: ?Semver.Query.Group = null,

        fn init(pattern: []const u8) GlobPattern {
            if (std.mem.indexOfScalar(u8, pattern, '@')) |at_pos| {
                if (at_pos > 0 and at_pos < pattern.len - 1) {
                    const pkg_pattern = pattern[0..at_pos];
                    const version_pattern = pattern[at_pos + 1 ..];

                    var result = initForName(pkg_pattern);
                    result.version_pattern = version_pattern;

                    const sliced = Semver.SlicedString.init(version_pattern, version_pattern);
                    result.version_query = Semver.Query.parse(bun.default_allocator, version_pattern, sliced) catch null;

                    return result;
                }
            }

            return initForName(pattern);
        }

        fn initForName(pattern: []const u8) GlobPattern {
            if (std.mem.indexOfScalar(u8, pattern, '*') == null) {
                return .{ .pattern_type = .exact };
            }

            if (pattern.len >= 3 and pattern[0] == '*' and pattern[pattern.len - 1] == '*') {
                const substring = pattern[1 .. pattern.len - 1];
                if (substring.len > 0 and std.mem.indexOfScalar(u8, substring, '*') == null) {
                    return .{
                        .pattern_type = .contains,
                        .substring = substring,
                    };
                }
            }

            if (std.mem.indexOfScalar(u8, pattern, '*')) |wildcard_pos| {
                if (wildcard_pos == pattern.len - 1) {
                    return .{
                        .pattern_type = .prefix,
                        .prefix = pattern[0..wildcard_pos],
                    };
                }

                if (wildcard_pos == 0) {
                    return .{
                        .pattern_type = .suffix,
                        .suffix = pattern[1..],
                    };
                }

                if (std.mem.indexOfScalarPos(u8, pattern, wildcard_pos + 1, '*') != null) {
                    return .{ .pattern_type = .invalid };
                }

                return .{
                    .pattern_type = .middle,
                    .prefix = pattern[0..wildcard_pos],
                    .suffix = pattern[wildcard_pos + 1 ..],
                };
            }

            return .{ .pattern_type = .exact };
        }

        fn matchesName(self: GlobPattern, name: []const u8, pattern: []const u8) bool {
            return switch (self.pattern_type) {
                .exact => strings.eql(name, pattern),
                .prefix => std.mem.startsWith(u8, name, self.prefix),
                .suffix => std.mem.endsWith(u8, name, self.suffix),
                .middle => std.mem.startsWith(u8, name, self.prefix) and std.mem.endsWith(u8, name, self.suffix),
                .contains => std.mem.indexOf(u8, name, self.substring) != null,
                else => false,
            };
        }

        fn matchesVersion(self: GlobPattern, version: []const u8) bool {
            if (self.version_pattern.len == 0 or strings.eqlComptime(self.version_pattern, "latest")) {
                return true;
            }

            if (self.version_query) |query| {
                const sliced = Semver.SlicedString.init(version, version);
                const version_result = Semver.Version.parse(sliced);

                if (version_result.valid) {
                    const semver_version = version_result.version.min();
                    return query.satisfies(semver_version, self.version_pattern, version);
                }
            }

            if (strings.eql(version, self.version_pattern)) {
                return true;
            }

            return std.mem.startsWith(u8, version, self.version_pattern);
        }

        fn matches(self: GlobPattern, name: []const u8, version: []const u8, pattern: []const u8) bool {
            if (!self.matchesName(name, pattern)) return false;
            if (self.version_pattern.len > 0 and !self.matchesVersion(version)) return false;
            return true;
        }
    };

    pub fn printUsage() void {
        Output.prettyln("<r><b>bun why<r> <d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});

        const usage_text =
            \\Explain why a package is installed
            \\
            \\<b>Arguments:<r>
            \\  <blue>\<package\><r>     <d>The package name to explain (supports glob patterns like '@org/*')<r>
            \\
            \\<b>Options:<r>
            \\  <cyan>--top<r>         <d>Show only the top dependency tree instead of nested ones<r>
            \\  <cyan>--depth<r> <blue>\<NUM\><r> <d>Maximum depth of the dependency tree to display<r>
            \\
            \\<b>Examples:<r>
            \\  <d>$<r> <b><green>bun why<r> <blue>react<r>
            \\  <d>$<r> <b><green>bun why<r> <blue>"@types/*"<r> <cyan>--depth<r> <blue>2<r>
            \\  <d>$<r> <b><green>bun why<r> <blue>"*-lodash"<r> <cyan>--top<r>
            \\
        ;
        Output.pretty(usage_text, .{});
        Output.flush();
    }

    pub fn exec(ctx: Command.Context) !void {
        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .why);
        const pm, _ = try PackageManager.init(ctx, cli, PackageManager.Subcommand.why);

        if (cli.positionals.len < 1) {
            printUsage();
            Global.exit(1);
        }

        if (strings.eqlComptime(cli.positionals[0], "why")) {
            if (cli.positionals.len < 2) {
                printUsage();
                Global.exit(1);
            }
            return try execWithManager(ctx, pm, cli.positionals[1], cli.top_only);
        }

        return try execWithManager(ctx, pm, cli.positionals[0], cli.top_only);
    }

    pub fn execFromPm(ctx: Command.Context, pm: *PackageManager, positionals: []const string) !void {
        if (positionals.len < 2) {
            printUsage();
            Global.exit(1);
        }

        try execWithManager(ctx, pm, positionals[1], pm.options.top_only);
    }

    pub fn execWithManager(ctx: Command.Context, pm: *PackageManager, package_pattern: string, top_only: bool) !void {
        const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
        PackageManagerCommand.handleLoadLockfileErrors(load_lockfile, pm);

        if (top_only) {
            max_depth = 1;
        } else if (pm.options.depth) |depth| {
            max_depth = depth;
        } else {
            max_depth = 100;
        }

        const lockfile = load_lockfile.ok.lockfile;
        const string_bytes = lockfile.buffers.string_bytes.items;
        const packages = lockfile.packages.slice();
        const dependencies_items = lockfile.buffers.dependencies.items;
        const resolutions_items = lockfile.buffers.resolutions.items;

        var arena = std.heap.ArenaAllocator.init(ctx.allocator);
        defer arena.deinit();
        const arena_allocator = arena.allocator();

        var target_versions = std.array_list.Managed(VersionInfo).init(ctx.allocator);
        defer {
            for (target_versions.items) |item| {
                ctx.allocator.free(item.version);
            }
            target_versions.deinit();
        }

        var all_dependents = std.AutoHashMap(PackageID, std.array_list.Managed(DependentInfo)).init(arena_allocator);

        const glob = GlobPattern.init(package_pattern);

        for (0..packages.len) |pkg_idx| {
            const pkg = packages.get(pkg_idx);
            const pkg_name = pkg.name.slice(string_bytes);

            if (pkg_name.len == 0) continue;

            const dependencies = pkg.dependencies.get(dependencies_items);
            const resolutions = pkg.resolutions.get(resolutions_items);

            for (dependencies, 0..) |dependency, dep_idx| {
                const target_id = resolutions[dep_idx];
                if (target_id >= packages.len) continue;

                var dependents_entry = try all_dependents.getOrPut(target_id);
                if (!dependents_entry.found_existing) {
                    dependents_entry.value_ptr.* = std.array_list.Managed(DependentInfo).init(arena_allocator);
                }

                var dep_version_buf = std.array_list.Managed(u8).init(arena_allocator);
                defer dep_version_buf.deinit();
                try dep_version_buf.writer().print("{f}", .{packages.items(.resolution)[pkg_idx].fmt(string_bytes, .auto)});
                const dep_pkg_version = try arena_allocator.dupe(u8, dep_version_buf.items);

                const spec = try arena_allocator.dupe(u8, dependency.version.literal.slice(string_bytes));

                const dep_type = if (dependency.behavior.dev)
                    DependencyType.dev
                else if (dependency.behavior.optional and dependency.behavior.peer)
                    DependencyType.optional_peer
                else if (dependency.behavior.optional)
                    DependencyType.optional
                else if (dependency.behavior.peer)
                    DependencyType.peer
                else
                    DependencyType.prod;

                try dependents_entry.value_ptr.append(.{
                    .name = try arena_allocator.dupe(u8, pkg_name),
                    .version = dep_pkg_version,
                    .spec = spec,
                    .dep_type = dep_type,
                    .pkg_id = @as(PackageID, @intCast(pkg_idx)),
                    .workspace = strings.hasPrefixComptime(dep_pkg_version, "workspace:") or dep_pkg_version.len == 0,
                });
            }

            if (!glob.matchesName(pkg_name, package_pattern)) continue;

            var version_buf = std.array_list.Managed(u8).init(ctx.allocator);
            defer version_buf.deinit();
            try version_buf.writer().print("{f}", .{packages.items(.resolution)[pkg_idx].fmt(string_bytes, .auto)});
            const version = try ctx.allocator.dupe(u8, version_buf.items);

            if (!glob.matchesVersion(version)) continue;

            try target_versions.append(.{
                .version = version,
                .pkg_id = @as(PackageID, @intCast(pkg_idx)),
            });
        }

        if (target_versions.items.len == 0) {
            Output.prettyln("<r><red>error<r>: No packages matching '{s}' found in lockfile", .{package_pattern});
            Global.exit(1);
        }

        for (target_versions.items) |target_version| {
            const target_pkg = packages.get(target_version.pkg_id);
            const target_name = target_pkg.name.slice(string_bytes);
            Output.prettyln("<b>{s}@{s}<r>", .{ target_name, target_version.version });

            if (all_dependents.get(target_version.pkg_id)) |dependents| {
                if (dependents.items.len == 0) {
                    Output.prettyln("<d>  └─ No dependents found<r>", .{});
                } else if (max_depth == 0) {
                    Output.prettyln("<d>  └─ (deeper dependencies hidden)<r>", .{});
                } else {
                    var ctx_data = TreeContext.init(arena_allocator, string_bytes, top_only, &all_dependents);
                    defer ctx_data.clearPathTracker();

                    std.sort.insertion(DependentInfo, dependents.items, {}, compareDependents);

                    for (dependents.items, 0..) |dep, dep_idx| {
                        const is_last = dep_idx == dependents.items.len - 1;
                        const prefix = if (is_last) PREFIX_LAST else PREFIX_MIDDLE;

                        printPackageWithType(prefix, &dep);
                        if (!top_only) {
                            try printDependencyTree(&ctx_data, dep.pkg_id, if (is_last) PREFIX_SPACE else PREFIX_CONTINUE, 1, is_last, dep.workspace);
                        }
                    }
                }
            } else {
                Output.prettyln("<d>  └─ No dependents found<r>", .{});
            }

            Output.prettyln("", .{});
            Output.flush();
        }
    }

    fn printPackageWithType(prefix: string, package: *const DependentInfo) void {
        Output.pretty("<d>{s}<r>", .{prefix});

        switch (package.dep_type) {
            .dev => Output.pretty("<magenta>dev<r> ", .{}),
            .peer => Output.pretty("<yellow>peer<r> ", .{}),
            .optional => Output.pretty("<cyan>optional<r> ", .{}),
            .optional_peer => Output.pretty("<cyan>optional peer<r> ", .{}),
            else => {},
        }

        if (package.workspace) {
            Output.pretty("<blue>{s}<r>", .{package.name});
            if (package.version.len > 0) {
                Output.pretty("<d><blue>@workspace<r>", .{});
            }
        } else {
            Output.pretty("{s}", .{package.name});
            if (package.version.len > 0) {
                Output.pretty("<d>@{s}<r>", .{package.version});
            }
        }

        if (package.spec.len > 0) {
            Output.prettyln(" <d>(requires {s})<r>", .{package.spec});
        } else {
            Output.prettyln("", .{});
        }
    }

    const TreeContext = struct {
        allocator: std.mem.Allocator,
        string_bytes: []const u8,
        top_only: bool,
        all_dependents: *const std.AutoHashMap(PackageID, std.array_list.Managed(DependentInfo)),
        path_tracker: std.AutoHashMap(PackageID, usize),

        fn init(allocator: std.mem.Allocator, string_bytes: []const u8, top_only: bool, all_dependents: *const std.AutoHashMap(PackageID, std.array_list.Managed(DependentInfo))) TreeContext {
            return .{
                .allocator = allocator,
                .string_bytes = string_bytes,
                .top_only = top_only,
                .all_dependents = all_dependents,
                .path_tracker = std.AutoHashMap(PackageID, usize).init(allocator),
            };
        }

        fn clearPathTracker(self: *TreeContext) void {
            self.path_tracker.clearRetainingCapacity();
        }
    };

    fn printDependencyTree(
        ctx: *TreeContext,
        current_pkg_id: PackageID,
        prefix: string,
        depth: usize,
        printed_break_line: bool,
        parent_is_workspace: bool,
    ) !void {
        if (ctx.path_tracker.get(current_pkg_id) != null) {
            Output.prettyln("<d>{s}└─ <yellow>*circular<r>", .{prefix});
            return;
        }

        try ctx.path_tracker.put(current_pkg_id, depth);
        defer _ = ctx.path_tracker.remove(current_pkg_id);

        if (ctx.all_dependents.get(current_pkg_id)) |dependents| {
            const sorted_dependents = try ctx.allocator.dupe(DependentInfo, dependents.items);
            defer ctx.allocator.free(sorted_dependents);

            std.sort.insertion(DependentInfo, sorted_dependents, {}, compareDependents);

            for (sorted_dependents, 0..) |dep, dep_idx| {
                if (parent_is_workspace and dep.version.len == 0) {
                    continue;
                }

                if (depth >= max_depth) {
                    Output.prettyln("<d>{s}└─ (deeper dependencies hidden)<r>", .{prefix});
                    return;
                }

                const is_dep_last = dep_idx == sorted_dependents.len - 1;
                const prefix_char = if (is_dep_last) "└─ " else "├─ ";

                const full_prefix = try std.fmt.allocPrint(ctx.allocator, "{s}{s}", .{ prefix, prefix_char });
                printPackageWithType(full_prefix, &dep);

                const next_prefix = try std.fmt.allocPrint(ctx.allocator, "{s}{s}", .{ prefix, if (is_dep_last) "   " else "│  " });

                const print_break_line = is_dep_last and sorted_dependents.len > 1 and !printed_break_line;
                try printDependencyTree(ctx, dep.pkg_id, next_prefix, depth + 1, printed_break_line or print_break_line, dep.workspace);

                if (print_break_line) {
                    Output.prettyln("<d>{s}<r>", .{prefix});
                }
            }
        }
    }
};

const string = []const u8;

const std = @import("std");
const PackageID = @import("../install/install.zig").PackageID;
const PackageManagerCommand = @import("./package_manager_command.zig").PackageManagerCommand;

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const Semver = bun.Semver;
const strings = bun.strings;
const Command = bun.cli.Command;
const PackageManager = bun.install.PackageManager;
