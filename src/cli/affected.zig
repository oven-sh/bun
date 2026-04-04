/// Affected detection for workspace packages.
///
/// Algorithm:
///   1. Run `git diff --name-only` between base and head refs
///   2. Map changed files to workspace packages (longest prefix match)
///   3. Build reverse dependency graph from workspace deps
///   4. BFS from directly changed packages to find transitively affected ones
///
const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const Output = bun.Output;
const Global = bun.Global;

const FilterRun = @import("./filter_run.zig");
const ScriptConfig = FilterRun.ScriptConfig;
const DependencyMap = @import("../resolver/package_json.zig").DependencyMap;

/// Root-level files that, when changed, mark ALL packages as affected.
const GLOBAL_FILES = [_][]const u8{
    "bun.lock",
    "bun.lockb",
    "package.json",
    "tsconfig.json",
    "tsconfig.base.json",
    ".npmrc",
};

/// Given a list of collected scripts and workspace root, filter to only
/// those in affected packages.
pub fn filterAffectedScripts(
    allocator: std.mem.Allocator,
    scripts: *std.array_list.Managed(ScriptConfig),
    resolve_root: []const u8,
    base_ref: []const u8,
    head_ref: []const u8,
    explicit_refs: bool,
) !void {
    // Phase 1: Get changed files via git
    var changed_files = std.array_list.Managed([]const u8).init(allocator);
    defer changed_files.deinit();

    // Get merge-base for accurate diff on diverged branches
    const merge_base = try runGitOneLine(allocator, &.{ "git", "merge-base", base_ref, head_ref }, resolve_root);

    // Committed changes: merge-base..head
    try collectGitLines(allocator, &changed_files, &.{ "git", "diff", "--name-only", "--no-renames", "--relative", merge_base orelse base_ref, head_ref }, resolve_root);

    // Include working tree changes only when using default refs (local dev workflow).
    // When custom --base/--head are provided, only committed diffs matter (CI use case).
    if (!explicit_refs) {
        // Uncommitted changes (staged + unstaged vs HEAD)
        try collectGitLines(allocator, &changed_files, &.{ "git", "diff", "--name-only", "--no-renames", "--relative", "HEAD" }, resolve_root);

        // Untracked files
        try collectGitLines(allocator, &changed_files, &.{ "git", "ls-files", "--others", "--exclude-standard" }, resolve_root);
    }

    // Phase 2: Check for global file changes
    for (changed_files.items) |file| {
        const basename = std.fs.path.basename(file);
        for (&GLOBAL_FILES) |global| {
            if (strings.eql(basename, global) and isRootLevel(file, basename)) {
                // Global file changed — all packages are affected, no filtering needed
                return;
            }
        }
    }

    // Build package_roots map: relative dir path → package name
    var package_roots = bun.StringHashMap([]const u8).init(allocator);
    defer package_roots.deinit();

    for (scripts.items) |*script| {
        const dir = std.fs.path.dirname(script.package_json_path) orelse continue;
        const rel = makeRelative(dir, resolve_root);
        if (!package_roots.contains(rel)) {
            try package_roots.put(rel, script.package_name);
        }
    }

    // Map changed files → directly changed packages
    var directly_changed = bun.StringHashMap(void).init(allocator);
    defer directly_changed.deinit();

    for (changed_files.items) |file| {
        if (mapFileToPackage(file, &package_roots)) |pkg_name| {
            try directly_changed.put(pkg_name, {});
        }
    }

    // Phase 3: Build reverse dependency graph
    var workspace_names = bun.StringHashMap(void).init(allocator);
    defer workspace_names.deinit();
    for (scripts.items) |*script| {
        if (!workspace_names.contains(script.package_name)) {
            try workspace_names.put(script.package_name, {});
        }
    }

    var reverse_deps = bun.StringHashMap(std.array_list.Managed([]const u8)).init(allocator);
    defer {
        var rev_iter = reverse_deps.valueIterator();
        while (rev_iter.next()) |list| {
            list.deinit();
        }
        reverse_deps.deinit();
    }

    for (scripts.items) |*script| {
        const source_buf = script.deps.source_buf;
        var iter = script.deps.map.iterator();
        while (iter.next()) |entry| {
            const dep_name = entry.key_ptr.slice(source_buf);
            if (workspace_names.contains(dep_name)) {
                const res = try reverse_deps.getOrPut(dep_name);
                if (!res.found_existing) {
                    res.value_ptr.* = std.array_list.Managed([]const u8).init(allocator);
                }
                try res.value_ptr.append(script.package_name);
            }
        }
    }

    // Phase 4: BFS from directly changed packages
    var affected = bun.StringHashMap(void).init(allocator);
    defer affected.deinit();

    var queue = std.array_list.Managed([]const u8).init(allocator);
    defer queue.deinit();

    var dc_iter = directly_changed.keyIterator();
    while (dc_iter.next()) |name_ptr| {
        try affected.put(name_ptr.*, {});
        try queue.append(name_ptr.*);
    }

    var qi: usize = 0;
    while (qi < queue.items.len) : (qi += 1) {
        const current = queue.items[qi];
        if (reverse_deps.get(current)) |dependents| {
            for (dependents.items) |dependent| {
                if (!affected.contains(dependent)) {
                    try affected.put(dependent, {});
                    try queue.append(dependent);
                }
            }
        }
    }

    // Phase 5: Filter scripts — keep only those in affected set
    var write_idx: usize = 0;
    for (scripts.items) |script| {
        if (affected.contains(script.package_name)) {
            scripts.items[write_idx] = script;
            write_idx += 1;
        }
    }
    scripts.shrinkRetainingCapacity(write_idx);
}

/// Print affected package names to stdout and exit.
pub fn listAffectedAndExit(
    allocator: std.mem.Allocator,
    scripts: *const std.array_list.Managed(ScriptConfig),
) noreturn {
    var seen = bun.StringHashMap(void).init(allocator);
    var names = std.array_list.Managed([]const u8).init(allocator);

    for (scripts.items) |script| {
        if (!seen.contains(script.package_name)) {
            seen.put(script.package_name, {}) catch |err| switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            };
            names.append(script.package_name) catch |err| switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            };
        }
    }

    std.mem.sort([]const u8, names.items, {}, struct {
        fn lessThan(_: void, a: []const u8, b: []const u8) bool {
            return bun.strings.cmpStringsAsc({}, a, b);
        }
    }.lessThan);

    if (names.items.len == 0) {
        Output.prettyln("No packages affected.", .{});
    } else {
        Output.prettyln("{d} affected package(s):\n", .{names.items.len});
        for (names.items) |name| {
            Output.prettyln("  {s}", .{name});
        }
    }
    Output.flush();
    Global.exit(0);
}

// --- Internal helpers ---

fn isRootLevel(path: []const u8, basename: []const u8) bool {
    return path.len == basename.len;
}

fn makeRelative(abs_path: []const u8, root: []const u8) []const u8 {
    if (strings.hasPrefix(abs_path, root)) {
        var rel = abs_path[root.len..];
        if (rel.len > 0 and rel[0] == '/') {
            rel = rel[1..];
        }
        return rel;
    }
    return abs_path;
}

fn mapFileToPackage(file_path: []const u8, package_roots: *const bun.StringHashMap([]const u8)) ?[]const u8 {
    var current = file_path;
    while (true) {
        current = std.fs.path.dirname(current) orelse break;
        if (current.len == 0 or strings.eql(current, ".")) break;
        if (package_roots.get(current)) |pkg_name| {
            return pkg_name;
        }
    }
    return null;
}

/// Run a git command and return a single trimmed line of output, or null if empty.
fn runGitOneLine(allocator: std.mem.Allocator, argv: []const []const u8, cwd: []const u8) !?[]const u8 {
    const output = runGitSync(allocator, argv, cwd, true) catch |err| {
        Output.warn("git command failed: {s}\n", .{@errorName(err)});
        return null;
    };
    const trimmed = std.mem.trimRight(u8, output, "\n\r ");
    if (trimmed.len == 0) return null;
    return trimmed;
}

/// Run a git command and add each output line to the list.
fn collectGitLines(
    allocator: std.mem.Allocator,
    out: *std.array_list.Managed([]const u8),
    argv: []const []const u8,
    cwd: []const u8,
) !void {
    const output = runGitSync(allocator, argv, cwd, false) catch |err| {
        Output.warn("git command failed: {s}\n", .{@errorName(err)});
        return;
    };
    var lines = std.mem.splitScalar(u8, output, '\n');
    while (lines.next()) |line| {
        const trimmed = std.mem.trimRight(u8, line, "\r ");
        if (trimmed.len > 0) {
            try out.append(try allocator.dupe(u8, trimmed));
        }
    }
}

/// Execute a git command synchronously and return stdout.
fn runGitSync(allocator: std.mem.Allocator, argv: []const []const u8, cwd: []const u8, allow_non_zero: bool) ![]const u8 {
    var child = std.process.Child.init(argv, allocator);
    child.cwd = cwd;
    child.stdout_behavior = .Pipe;
    child.stderr_behavior = .Pipe;

    try child.spawn();

    var stdout: std.ArrayListUnmanaged(u8) = .empty;
    var stderr: std.ArrayListUnmanaged(u8) = .empty;
    defer stderr.deinit(allocator);

    try child.collectOutput(allocator, &stdout, &stderr, 1024 * 1024);
    const term = try child.wait();

    const exit_code = switch (term) {
        .Exited => |code| code,
        .Signal, .Stopped, .Unknown => 1,
    };

    if (exit_code != 0 and !allow_non_zero) {
        stdout.deinit(allocator);
        return error.GitCommandFailed;
    }

    return stdout.items;
}
