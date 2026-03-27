pub const PruneCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        prune(ctx) catch |err| switch (err) {
            error.InstallFailed,
            error.InvalidPackageJSON,
            => {
                const log = &bun.cli.Cli.log_;
                log.print(bun.Output.errorWriter()) catch {};
                bun.Global.exit(1);
            },
            else => |e| return e,
        };
    }
};

fn prune(ctx: Command.Context) !void {
    const cli = try CommandLineArguments.parse(ctx.allocator, .prune);

    const manager, _ = try PackageManager.init(ctx, cli, .prune);

    // Load the lockfile (not done automatically during init)
    const load_result: Lockfile.LoadResult = manager.lockfile.loadFromCwd(
        manager,
        ctx.allocator,
        manager.log,
        true,
    );

    if (load_result != .ok) {
        Output.prettyErrorln("<r><red>error:<r> no lockfile found. Run <b>bun install<r> first.", .{});
        Output.flush();
        Global.exit(1);
    }

    // bun prune requires a text lockfile (bun.lock) for pruning
    if (!load_result.loadedFromTextLockfile()) {
        Output.prettyErrorln("<r><red>error:<r> <b>bun prune<r> requires a text lockfile (<b>bun.lock<r>). Run <b>bun install --save-text-lockfile<r> to generate one.", .{});
        Output.flush();
        Global.exit(1);
    }

    const lockfile = load_result.ok.lockfile;

    // Parse positional args: bun prune <workspace>
    var target_name: ?string = null;
    for (cli.positionals) |pos| {
        if (strings.eqlComptime(pos, "prune")) continue;
        target_name = pos;
        break;
    }

    if (target_name == null) {
        printUsage();
        Global.exit(1);
    }

    const docker_mode = cli.docker;
    const out_dir = if (cli.out_dir.len > 0) cli.out_dir else "out";

    const buf = lockfile.buffers.string_bytes.items;
    const pkgs = lockfile.packages.slice();
    const pkg_names: []const String = pkgs.items(.name);
    const pkg_resolutions: []const Resolution = pkgs.items(.resolution);
    const pkg_dep_lists: []const DependencySlice = pkgs.items(.dependencies);
    const resolution_buf = lockfile.buffers.resolutions.items;

    // Find the target workspace package ID
    var target_pkg_id: ?PackageID = null;
    for (pkg_resolutions, 0..) |res, i| {
        if (res.tag == .workspace or res.tag == .root) {
            const name = pkg_names[i].slice(buf);
            if (strings.eql(name, target_name.?)) {
                target_pkg_id = @intCast(i);
                break;
            }
        }
    }

    if (target_pkg_id == null) {
        Output.prettyErrorln("<r><red>error:<r> workspace <b>\"{s}\"<r> not found in lockfile", .{target_name.?});
        Output.flush();
        Global.exit(1);
    }

    // Build transitive workspace dependency set using BFS
    var keep_set = std.AutoHashMap(PackageID, void).init(ctx.allocator);
    defer keep_set.deinit();

    // Always keep root (package ID 0)
    try keep_set.put(0, {});
    try keep_set.put(target_pkg_id.?, {});

    var queue: std.ArrayListUnmanaged(PackageID) = .{};
    defer queue.deinit(ctx.allocator);
    try queue.append(ctx.allocator, target_pkg_id.?);

    while (queue.items.len > 0) {
        const current = queue.orderedRemove(0);
        const dep_list = pkg_dep_lists[current];
        for (dep_list.begin()..dep_list.end()) |dep_idx| {
            const resolved_id = resolution_buf[dep_idx];
            if (resolved_id == invalid_package_id) continue;
            if (pkg_resolutions[resolved_id].tag == .workspace) {
                if (!keep_set.contains(resolved_id)) {
                    try keep_set.put(resolved_id, {});
                    try queue.append(ctx.allocator, resolved_id);
                }
            }
        }
    }

    // Collect workspace paths for kept workspaces
    var kept_workspace_paths: std.ArrayListUnmanaged(string) = .{};
    defer kept_workspace_paths.deinit(ctx.allocator);

    var iter = keep_set.iterator();
    while (iter.next()) |entry| {
        const pkg_id = entry.key_ptr.*;
        if (pkg_id == 0) continue; // root
        const res = pkg_resolutions[pkg_id];
        if (res.tag == .workspace) {
            try kept_workspace_paths.append(ctx.allocator, res.value.workspace.slice(buf));
        }
    }

    // Sort for deterministic output (important for Docker layer caching)
    std.mem.sort(string, kept_workspace_paths.items, {}, struct {
        pub fn lessThan(_: void, a: string, b: string) bool {
            return strings.order(a, b) == .lt;
        }
    }.lessThan);

    // Get workspace root directory
    const cwd = strings.withoutTrailingSlash(bun.fs.FileSystem.instance.top_level_dir);

    // Create output directories
    if (docker_mode) {
        makeOutputDir(out_dir, "json");
        makeOutputDir(out_dir, "full");
    } else {
        std.fs.cwd().makePath(out_dir) catch |err| {
            Output.prettyErrorln("<r><red>error:<r> failed to create output directory: {s}", .{@errorName(err)});
            Global.exit(1);
        };
    }

    // Generate pruned root package.json
    const pruned_pkg_json = generatePrunedPackageJson(ctx.allocator, cwd, kept_workspace_paths.items) catch {
        Output.prettyErrorln("<r><red>error:<r> failed to generate pruned package.json", .{});
        Global.exit(1);
    };

    // Generate pruned lockfile
    const pruned_lockfile = generatePrunedLockfile(ctx.allocator, cwd, lockfile, &keep_set) catch {
        Output.prettyErrorln("<r><red>error:<r> failed to generate pruned lockfile", .{});
        Global.exit(1);
    };

    if (docker_mode) {
        // Docker mode: json/ gets package.json files + lockfile, full/ gets everything
        writeToFile(out_dir, "json/package.json", pruned_pkg_json);
        writeToFile(out_dir, "full/package.json", pruned_pkg_json);
        writeToFile(out_dir, "json/bun.lock", pruned_lockfile);

        for (kept_workspace_paths.items) |ws_path| {
            const ws_pkg_src = std.fmt.allocPrint(ctx.allocator, "{s}/package.json", .{ws_path}) catch continue;
            const ws_pkg_dst_json = std.fmt.allocPrint(ctx.allocator, "json/{s}/package.json", .{ws_path}) catch continue;
            requiredCopyFromRoot(cwd, ws_pkg_src, out_dir, ws_pkg_dst_json);

            const ws_full_dst = std.fmt.allocPrint(ctx.allocator, "full/{s}", .{ws_path}) catch continue;
            copyDirRecursive(cwd, ws_path, out_dir, ws_full_dst);
        }

        tryCopyFile(cwd, "bunfig.toml", out_dir, "json/bunfig.toml");
        tryCopyFile(cwd, ".npmrc", out_dir, "json/.npmrc");
        tryCopyFile(cwd, "bunfig.toml", out_dir, "full/bunfig.toml");
        tryCopyFile(cwd, ".npmrc", out_dir, "full/.npmrc");
    } else {
        writeToFile(out_dir, "package.json", pruned_pkg_json);
        writeToFile(out_dir, "bun.lock", pruned_lockfile);

        for (kept_workspace_paths.items) |ws_path| {
            copyDirRecursive(cwd, ws_path, out_dir, ws_path);
        }

        tryCopyFile(cwd, "bunfig.toml", out_dir, "bunfig.toml");
        tryCopyFile(cwd, ".npmrc", out_dir, ".npmrc");
    }

    Output.prettyln("<r><green>✓<r> Pruned monorepo for <b>{s}<r>", .{target_name.?});
    Output.prettyln("  <d>Kept {d} workspace(s) (+ root)<r>", .{kept_workspace_paths.items.len});
    Output.prettyln("  <d>Output: {s}<r>", .{out_dir});
    Output.flush();
}

fn printUsage() void {
    Output.prettyln("<r><b>bun prune<r> <d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
    Output.pretty(
        \\Generate a pruned monorepo subset for a target workspace
        \\
        \\<b>Usage:<r>
        \\  <b><green>bun prune<r> <blue>\<name\><r> <cyan>[flags]<r>
        \\
        \\<b>Arguments:<r>
        \\  <blue>\<name\><r>          <d>Name of the target workspace<r>
        \\
        \\<b>Options:<r>
        \\  <cyan>--docker<r>          <d>Split output for Docker layer caching (json/ + full/)<r>
        \\  <cyan>--out-dir<r> <blue>\<dir\><r>  <d>Output directory (default: "out")<r>
        \\
        \\<b>Examples:<r>
        \\  <d>$<r> <b><green>bun prune<r> <blue>@myapp/api<r>
        \\  <d>$<r> <b><green>bun prune<r> <blue>@myapp/api<r> <cyan>--docker<r>
        \\  <d>$<r> <b><green>bun prune<r> <blue>@myapp/api<r> <cyan>--docker --out-dir=pruned<r>
        \\
    , .{});
    Output.flush();
}

fn generatePrunedPackageJson(allocator: std.mem.Allocator, cwd: string, kept_workspace_paths: []const string) ![]const u8 {
    var path_buf: bun.PathBuffer = undefined;
    const pkg_json_path = std.fmt.bufPrint(&path_buf, "{s}/package.json", .{cwd}) catch return error.PathTooLong;

    const content = std.fs.cwd().readFileAlloc(allocator, pkg_json_path, std.math.maxInt(usize)) catch return error.ReadFailed;

    var result: std.ArrayListUnmanaged(u8) = .{};
    const writer = result.writer(allocator);

    if (strings.indexOf(content, "\"workspaces\"")) |ws_start| {
        try writer.writeAll(content[0..ws_start]);
        try writer.writeAll("\"workspaces\": [\n");
        for (kept_workspace_paths, 0..) |ws_path, i| {
            try writer.writeAll("    \"");
            try writer.writeAll(ws_path);
            try writer.writeByte('"');
            if (i < kept_workspace_paths.len - 1) {
                try writer.writeByte(',');
            }
            try writer.writeByte('\n');
        }
        try writer.writeAll("  ]");

        // Skip past original workspaces value
        var depth: usize = 0;
        var in_str = false;
        var esc = false;
        var pos = ws_start;
        var found_start = false;
        while (pos < content.len) : (pos += 1) {
            const c = content[pos];
            if (esc) {
                esc = false;
                continue;
            }
            if (c == '\\' and in_str) {
                esc = true;
                continue;
            }
            if (c == '"') {
                in_str = !in_str;
                continue;
            }
            if (in_str) continue;
            if (c == '[' or c == '{') {
                if (found_start) {
                    depth += 1;
                } else {
                    found_start = true;
                    depth = 1;
                }
            }
            if (c == ']' or c == '}') {
                depth -|= 1;
                if (depth == 0 and found_start) {
                    pos += 1;
                    break;
                }
            }
        }

        try writer.writeAll(content[pos..]);
    } else {
        try writer.writeAll(content);
    }

    return result.toOwnedSlice(allocator);
}

fn generatePrunedLockfile(allocator: std.mem.Allocator, cwd: string, lockfile: *const Lockfile, keep_set: *const std.AutoHashMap(PackageID, void)) ![]const u8 {
    var path_buf: bun.PathBuffer = undefined;
    const lock_path = std.fmt.bufPrint(&path_buf, "{s}/bun.lock", .{cwd}) catch return error.PathTooLong;

    const content = std.fs.cwd().readFileAlloc(allocator, lock_path, std.math.maxInt(usize)) catch return error.ReadFailed;

    const buf = lockfile.buffers.string_bytes.items;
    const pkgs = lockfile.packages.slice();
    const pkg_resolutions: []const Resolution = pkgs.items(.resolution);

    // Build set of kept workspace paths
    var kept_paths = std.StringHashMap(void).init(allocator);
    defer kept_paths.deinit();

    var ks_iter = keep_set.iterator();
    while (ks_iter.next()) |entry| {
        const pkg_id = entry.key_ptr.*;
        if (pkg_id == 0) continue;
        const res = pkg_resolutions[pkg_id];
        if (res.tag == .workspace) {
            try kept_paths.put(res.value.workspace.slice(buf), {});
        }
    }

    var result: std.ArrayListUnmanaged(u8) = .{};
    const writer = result.writer(allocator);

    const ws_key = "\"workspaces\":";
    if (strings.indexOf(content, ws_key)) |ws_section_start| {
        var brace_start = ws_section_start + ws_key.len;
        while (brace_start < content.len and content[brace_start] != '{') : (brace_start += 1) {}

        if (brace_start >= content.len) return error.ReadFailed;

        try writer.writeAll(content[0 .. brace_start + 1]);

        var pos = brace_start + 1;
        var first_kept = true;

        while (pos < content.len) {
            // Skip whitespace
            while (pos < content.len and isJsonWhitespace(content[pos])) : (pos += 1) {}
            if (pos >= content.len or content[pos] == '}') break;
            if (content[pos] != '"') {
                pos += 1;
                continue;
            }

            // Extract key
            const key_start = pos + 1;
            pos += 1;
            while (pos < content.len and content[pos] != '"') {
                if (content[pos] == '\\') pos += 1;
                pos += 1;
            }
            const key = content[key_start..pos];
            pos += 1;

            // Skip to value
            while (pos < content.len and content[pos] != ':') : (pos += 1) {}
            pos += 1;
            while (pos < content.len and isJsonWhitespace(content[pos])) : (pos += 1) {}

            // Parse value (object)
            const value_start = pos;
            var depth: usize = 0;
            var in_str = false;
            var esc = false;
            while (pos < content.len) : (pos += 1) {
                const c = content[pos];
                if (esc) {
                    esc = false;
                    continue;
                }
                if (c == '\\' and in_str) {
                    esc = true;
                    continue;
                }
                if (c == '"') {
                    in_str = !in_str;
                    continue;
                }
                if (in_str) continue;
                if (c == '{') depth += 1;
                if (c == '}') {
                    depth -|= 1;
                    if (depth == 0) {
                        pos += 1;
                        break;
                    }
                }
            }
            const value_end = pos;

            // Skip comma/whitespace
            while (pos < content.len and (isJsonWhitespace(content[pos]) or content[pos] == ',')) : (pos += 1) {}

            // Keep root ("") and kept workspaces
            if (key.len == 0 or kept_paths.contains(key)) {
                if (!first_kept) {
                    try writer.writeByte(',');
                }
                try writer.writeByte('\n');
                try writer.writeAll("    \"");
                try writer.writeAll(key);
                try writer.writeAll("\": ");
                try writer.writeAll(content[value_start..value_end]);
                first_kept = false;
            }
        }

        // Close workspaces object
        try writer.writeAll("\n  }");

        // Skip past original closing brace
        while (pos < content.len and content[pos] != '}') : (pos += 1) {}
        if (pos < content.len) pos += 1;

        // Write rest (packages section etc.)
        try writer.writeAll(content[pos..]);
    } else {
        try writer.writeAll(content);
    }

    return result.toOwnedSlice(allocator);
}

fn isJsonWhitespace(c: u8) bool {
    return c == ' ' or c == '\n' or c == '\r' or c == '\t';
}

fn makeOutputDir(base: string, sub: string) void {
    var path_buf: bun.PathBuffer = undefined;
    const path = std.fmt.bufPrint(&path_buf, "{s}/{s}", .{ base, sub }) catch return;
    std.fs.cwd().makePath(path) catch |err| {
        Output.prettyErrorln("<r><red>error:<r> failed to create directory {s}: {s}", .{ path, @errorName(err) });
        Global.exit(1);
    };
}

fn writeToFile(base_dir: string, rel_path: string, content: []const u8) void {
    var path_buf: bun.PathBuffer = undefined;
    const full_path = std.fmt.bufPrint(&path_buf, "{s}/{s}", .{ base_dir, rel_path }) catch return;

    if (strings.lastIndexOfChar(full_path, '/')) |last_slash| {
        std.fs.cwd().makePath(full_path[0..last_slash]) catch {};
    }

    const file = std.fs.cwd().createFile(full_path, .{}) catch {
        Output.prettyErrorln("<r><red>error:<r> failed to write {s}", .{full_path});
        Global.exit(1);
    };
    defer file.close();
    file.writeAll(content) catch {
        Output.prettyErrorln("<r><red>error:<r> failed to write {s}", .{full_path});
        Global.exit(1);
    };
}

fn requiredCopyFromRoot(cwd: string, src_rel: string, out_base: string, out_rel: string) void {
    var src_buf: bun.PathBuffer = undefined;
    const src_path = std.fmt.bufPrint(&src_buf, "{s}/{s}", .{ cwd, src_rel }) catch {
        Output.prettyErrorln("<r><red>error:<r> path too long: {s}/{s}", .{ cwd, src_rel });
        Global.exit(1);
    };
    var dst_buf: bun.PathBuffer = undefined;
    const dst_path = std.fmt.bufPrint(&dst_buf, "{s}/{s}", .{ out_base, out_rel }) catch {
        Output.prettyErrorln("<r><red>error:<r> path too long: {s}/{s}", .{ out_base, out_rel });
        Global.exit(1);
    };

    if (strings.lastIndexOfChar(dst_path, '/')) |last_slash| {
        std.fs.cwd().makePath(dst_path[0..last_slash]) catch {};
    }

    std.fs.cwd().copyFile(src_path, std.fs.cwd(), dst_path, .{}) catch |err| {
        Output.prettyErrorln("<r><red>error:<r> failed to copy {s}: {s}", .{ src_rel, @errorName(err) });
        Global.exit(1);
    };
}

fn copyFromRoot(cwd: string, src_rel: string, out_base: string, out_rel: string) void {
    var src_buf: bun.PathBuffer = undefined;
    const src_path = std.fmt.bufPrint(&src_buf, "{s}/{s}", .{ cwd, src_rel }) catch return;
    var dst_buf: bun.PathBuffer = undefined;
    const dst_path = std.fmt.bufPrint(&dst_buf, "{s}/{s}", .{ out_base, out_rel }) catch return;

    if (strings.lastIndexOfChar(dst_path, '/')) |last_slash| {
        std.fs.cwd().makePath(dst_path[0..last_slash]) catch {};
    }

    std.fs.cwd().copyFile(src_path, std.fs.cwd(), dst_path, .{}) catch {};
}

fn tryCopyFile(cwd: string, name: string, out_base: string, out_rel: string) void {
    copyFromRoot(cwd, name, out_base, out_rel);
}

fn copyDirRecursive(cwd: string, src_rel: string, out_base: string, out_rel: string) void {
    var src_buf: bun.PathBuffer = undefined;
    const src_path = std.fmt.bufPrint(&src_buf, "{s}/{s}", .{ cwd, src_rel }) catch return;
    var dst_buf: bun.PathBuffer = undefined;
    const dst_path = std.fmt.bufPrint(&dst_buf, "{s}/{s}", .{ out_base, out_rel }) catch return;

    std.fs.cwd().makePath(dst_path) catch |err| {
        Output.prettyErrorln("<r><red>error:<r> failed to create directory {s}: {s}", .{ dst_path, @errorName(err) });
        Global.exit(1);
    };

    var src_dir = std.fs.cwd().openDir(src_path, .{ .iterate = true }) catch |err| {
        Output.prettyErrorln("<r><red>error:<r> failed to open directory {s}: {s}", .{ src_path, @errorName(err) });
        Global.exit(1);
    };
    defer src_dir.close();

    var walker = src_dir.iterate();
    while (walker.next() catch |err| {
        Output.prettyErrorln("<r><red>error:<r> failed to iterate directory {s}: {s}", .{ src_path, @errorName(err) });
        Global.exit(1);
    }) |entry| {
        if (strings.eqlComptime(entry.name, "node_modules")) continue;
        if (strings.eqlComptime(entry.name, ".git")) continue;

        switch (entry.kind) {
            .file => {
                var child_src: bun.PathBuffer = undefined;
                const csrc = std.fmt.bufPrint(&child_src, "{s}/{s}", .{ src_path, entry.name }) catch continue;
                var child_dst: bun.PathBuffer = undefined;
                const cdst = std.fmt.bufPrint(&child_dst, "{s}/{s}", .{ dst_path, entry.name }) catch continue;
                std.fs.cwd().copyFile(csrc, std.fs.cwd(), cdst, .{}) catch |err| {
                    Output.prettyErrorln("<r><red>error:<r> failed to copy {s}: {s}", .{ csrc, @errorName(err) });
                    Global.exit(1);
                };
            },
            .directory => {
                var child_src_rel: bun.PathBuffer = undefined;
                const csr = std.fmt.bufPrint(&child_src_rel, "{s}/{s}", .{ src_rel, entry.name }) catch continue;
                var child_out_rel: bun.PathBuffer = undefined;
                const cor = std.fmt.bufPrint(&child_out_rel, "{s}/{s}", .{ out_rel, entry.name }) catch continue;
                copyDirRecursive(cwd, csr, out_base, cor);
            },
            else => {},
        }
    }
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const strings = bun.strings;
const Command = bun.cli.Command;
const String = bun.Semver.String;

const PackageID = bun.install.PackageID;
const Resolution = bun.install.Resolution;
const invalid_package_id = bun.install.invalid_package_id;

const Lockfile = bun.install.Lockfile;
const DependencySlice = Lockfile.DependencySlice;

const PackageManager = bun.install.PackageManager;
const CommandLineArguments = PackageManager.CommandLineArguments;
