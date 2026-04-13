//! Implements `bun test --changed` (vitest-compatible).
//!
//! 1. Ask git for the set of changed files relative to HEAD (uncommitted,
//!    staged, and untracked) or relative to a user-supplied ref.
//! 2. Run the bundler over every discovered test file with packages marked
//!    external so node_modules are not entered. This produces the full parse
//!    graph (transitive imports) without linking or emitting code.
//! 3. Starting from each changed file that appears in the graph, walk the
//!    reverse import edges to find every test entry point that can reach it.
//!
//! Only those test entry points are returned.

const ChangedFilesFilter = @This();

pub const Result = struct {
    /// The filtered list of test files. Slice of the original `test_files`
    /// allocation, owned by the caller.
    test_files: []bun.PathString,
    /// Number of files git reported as changed.
    changed_count: usize,
    /// Number of test files before filtering.
    total_tests: usize,
    /// Absolute paths of every local source file that participates in the
    /// module graph (test entry points and everything they transitively
    /// import, excluding node_modules). Used by `--changed --watch` to watch
    /// files that would not otherwise be loaded when a subset of tests runs.
    /// Owned by the caller; each element is individually allocated.
    module_graph_files: []const []const u8 = &.{},
};

/// Filter `test_files` in place to only the entries whose module graph
/// reaches a changed file. On success, `test_files` is compacted (preserving
/// order) and the new length is returned via `Result.test_files`.
pub fn filter(
    ctx: Command.Context,
    vm: *jsc.VirtualMachine,
    test_files: []bun.PathString,
    changed_since: []const u8,
) !Result {
    const allocator = ctx.allocator;
    const top_level_dir = vm.transpiler.fs.top_level_dir;

    var changed_files = getChangedFiles(allocator, top_level_dir, changed_since) catch |err| switch (err) {
        error.GitNotFound => {
            Output.errGeneric("<b>--changed<r> requires <b>git<r> to be installed and in PATH", .{});
            Global.exit(1);
        },
        error.GitFailed => {
            // getChangedFiles already printed the git error output.
            Global.exit(1);
        },
        else => return err,
    };
    defer changed_files.deinit();

    if (test_files.len == 0) {
        return .{
            .test_files = test_files[0..0],
            .changed_count = changed_files.count(),
            .total_tests = 0,
        };
    }

    // Convert PathString list to []const []const u8 for the bundler.
    const entry_points = try allocator.alloc([]const u8, test_files.len);
    defer allocator.free(entry_points);
    for (test_files, entry_points) |p, *out| out.* = p.slice();

    // Build a dedicated transpiler for scanning. We do not reuse the VM's
    // transpiler because BundleV2.init takes ownership of the allocator and
    // log, and we want the runtime transpiler left untouched for actually
    // executing tests afterward.
    var log = logger.Log.init(allocator);
    defer log.deinit();

    var scan_transpiler = Transpiler.init(allocator, &log, ctx.args, vm.transpiler.env) catch |err| {
        Output.errGeneric("Failed to initialize module graph scanner for --changed: {s}", .{@errorName(err)});
        Global.exit(1);
    };
    scan_transpiler.options.target = .bun;
    scan_transpiler.options.entry_points = entry_points;
    // Do not follow bare specifiers into node_modules; changes there are not
    // considered local edits.
    scan_transpiler.options.packages = .external;
    // The module graph scan is best-effort. A test file that imports
    // something unresolved should still be considered, not abort --changed.
    scan_transpiler.options.ignore_module_resolution_errors = true;
    scan_transpiler.options.output_dir = "";
    scan_transpiler.options.tree_shaking = false;
    scan_transpiler.configureLinker();
    scan_transpiler.configureDefines() catch {};
    scan_transpiler.resolver.opts = scan_transpiler.options;
    scan_transpiler.resolver.env_loader = scan_transpiler.env;

    const bundle = BundleV2.scanModuleGraphFromCLI(
        &scan_transpiler,
        allocator,
        jsc.AnyEventLoop.init(allocator),
        entry_points,
    ) catch |err| {
        // Fall back to running every test rather than aborting the run.
        Output.warn("--changed: failed to build module graph ({s}); running all tests", .{@errorName(err)});
        Output.flush();
        return .{
            .test_files = test_files,
            .changed_count = changed_files.count(),
            .total_tests = test_files.len,
        };
    };

    const sources = bundle.graph.input_files.items(.source);
    const import_records = bundle.graph.ast.items(.import_records);

    // Map absolute source path -> source index for paths that participate in
    // the graph. This lets us look up changed-file paths quickly.
    var path_to_index = bun.StringHashMap(u32).init(allocator);
    defer path_to_index.deinit();
    try path_to_index.ensureTotalCapacity(@intCast(sources.len));

    // Reverse graph: for each source index, the list of source indexes that
    // import it. Built once, then used for a backward BFS from every changed
    // file.
    const importers = try allocator.alloc(std.ArrayListUnmanaged(u32), sources.len);
    defer {
        for (importers) |*list| list.deinit(allocator);
        allocator.free(importers);
    }
    for (importers) |*list| list.* = .{};

    var graph_files: std.ArrayListUnmanaged([]const u8) = .{};
    errdefer {
        for (graph_files.items) |p| allocator.free(p);
        graph_files.deinit(allocator);
    }

    for (sources, 0..) |*source, idx| {
        const index = Index.init(@as(u32, @intCast(idx)));
        if (index.isRuntime()) continue;
        const path_text = source.path.text;
        if (path_text.len == 0) continue;
        // Only record real on-disk files (the bundler reserves a few
        // virtual slots whose namespace is not "file").
        if (!source.path.isFile()) continue;
        // All scanned entry points are absolute, and the resolver emits
        // absolute file paths as well.
        path_to_index.putAssumeCapacity(path_text, @intCast(idx));
        // Copy out of the bundler's arena so the caller can use these paths
        // after the BundleV2 heap is gone.
        try graph_files.append(allocator, try allocator.dupe(u8, path_text));
    }

    for (import_records, 0..) |records, idx| {
        const importer: u32 = @intCast(idx);
        for (records.slice()) |*record| {
            const dep = record.source_index;
            if (!dep.isValid() or dep.isRuntime()) continue;
            if (dep.get() >= sources.len) continue;
            try importers[dep.get()].append(allocator, importer);
        }
    }

    // Identify which source indexes correspond to test entry points so we can
    // check BFS results against them. `bundle.graph.entry_points` preserves
    // the order of `entry_points`, but an entry point that failed to resolve
    // is skipped, so we map by path rather than by position.
    var entry_index_to_test_slot = std.AutoHashMap(u32, usize).init(allocator);
    defer entry_index_to_test_slot.deinit();
    for (bundle.graph.entry_points.items) |entry_index| {
        const path_text = sources[entry_index.get()].path.text;
        // `test_files` is typically small enough that a linear lookup is fine
        // (matching the overall cost of building the graph). Match by
        // identity against the PathString slices we passed in.
        for (test_files, 0..) |tf, slot| {
            if (strings.eql(tf.slice(), path_text)) {
                try entry_index_to_test_slot.put(entry_index.get(), slot);
                break;
            }
        }
    }

    // BFS backward from every changed file that participates in the graph.
    var affected = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(allocator, sources.len);
    defer affected.deinit(allocator);
    var queue: std.ArrayListUnmanaged(u32) = .{};
    defer queue.deinit(allocator);

    {
        var it = changed_files.map.iterator();
        while (it.next()) |entry| {
            const changed_path = entry.key_ptr.*;
            if (path_to_index.get(changed_path)) |idx| {
                if (!affected.isSet(idx)) {
                    affected.set(idx);
                    try queue.append(allocator, idx);
                }
            }
        }
    }

    while (queue.pop()) |idx| {
        for (importers[idx].items) |importer| {
            if (affected.isSet(importer)) continue;
            affected.set(importer);
            try queue.append(allocator, importer);
        }
    }

    // A test file is selected if (a) its entry point source index is marked
    // affected, or (b) the test file itself is in the changed set (covers
    // test files that failed to enter the graph for any reason).
    var write: usize = 0;
    for (test_files, 0..) |tf, slot| {
        var keep = changed_files.contains(tf.slice());

        if (!keep) {
            // Find the entry index that corresponds to this slot.
            var iter = entry_index_to_test_slot.iterator();
            while (iter.next()) |e| {
                if (e.value_ptr.* == slot) {
                    if (affected.isSet(e.key_ptr.*)) keep = true;
                    break;
                }
            }
        }

        if (keep) {
            test_files[write] = tf;
            write += 1;
        }
    }

    return .{
        .test_files = test_files[0..write],
        .changed_count = changed_files.count(),
        .total_tests = test_files.len,
        .module_graph_files = try graph_files.toOwnedSlice(allocator),
    };
}

const GitError = error{ GitNotFound, GitFailed } || std.mem.Allocator.Error;

/// Return the set of changed files (absolute paths) according to git.
///
/// With `since == ""` this is the union of unstaged, staged, and untracked
/// files. With a ref, it is `git diff --name-only <since>`. Paths that do not
/// exist on disk (deletions) are skipped since they cannot appear in the
/// module graph.
fn getChangedFiles(
    allocator: std.mem.Allocator,
    top_level_dir: []const u8,
    since: []const u8,
) GitError!bun.StringSet {
    var which_buf: bun.PathBuffer = undefined;
    const git_path = bun.which(&which_buf, bun.env_var.PATH.get() orelse "", top_level_dir, "git") orelse {
        return error.GitNotFound;
    };

    // Find the git repository root so we can make the paths git prints
    // absolute (git prints paths relative to the repo toplevel with these
    // commands).
    const git_root = blk: {
        var result = try runGit(allocator, git_path, top_level_dir, &.{ "rev-parse", "--show-toplevel" });
        defer result.stdout.deinit();
        defer result.stderr.deinit();
        if (!result.ok) {
            if (result.stderr.items.len > 0) {
                Output.errGeneric("--changed: {s}", .{strings.trim(result.stderr.items, " \r\n\t")});
            } else {
                Output.errGeneric("--changed requires running inside a git repository", .{});
            }
            return error.GitFailed;
        }
        break :blk try allocator.dupe(u8, strings.trim(result.stdout.items, " \r\n\t"));
    };
    defer allocator.free(git_root);

    var set = bun.StringSet.init(allocator);
    errdefer set.deinit();

    if (since.len == 0) {
        // Uncommitted (unstaged + staged). `git diff HEAD` covers both.
        // On a repo with no commits, `HEAD` is unresolved; fall back to just
        // `git diff` (unstaged) + staged.
        var diff = try runGit(allocator, git_path, top_level_dir, &.{ "diff", "--name-only", "HEAD", "--" });
        defer diff.stdout.deinit();
        defer diff.stderr.deinit();
        if (diff.ok) {
            try appendPaths(&set, git_root, diff.stdout.items);
        } else {
            var unstaged = try runGit(allocator, git_path, top_level_dir, &.{ "diff", "--name-only", "--" });
            defer unstaged.stdout.deinit();
            defer unstaged.stderr.deinit();
            try appendPaths(&set, git_root, unstaged.stdout.items);

            var staged = try runGit(allocator, git_path, top_level_dir, &.{ "diff", "--name-only", "--cached", "--" });
            defer staged.stdout.deinit();
            defer staged.stderr.deinit();
            try appendPaths(&set, git_root, staged.stdout.items);
        }

        // Untracked files.
        var untracked = try runGit(allocator, git_path, top_level_dir, &.{ "ls-files", "--others", "--exclude-standard" });
        defer untracked.stdout.deinit();
        defer untracked.stderr.deinit();
        if (untracked.ok) {
            try appendPaths(&set, git_root, untracked.stdout.items);
        }
    } else {
        var diff = try runGit(allocator, git_path, top_level_dir, &.{ "diff", "--name-only", since, "--" });
        defer diff.stdout.deinit();
        defer diff.stderr.deinit();
        if (!diff.ok) {
            if (diff.stderr.items.len > 0) {
                Output.errGeneric("--changed: {s}", .{strings.trim(diff.stderr.items, " \r\n\t")});
            } else {
                Output.errGeneric("--changed: git diff against {f} failed", .{bun.fmt.quote(since)});
            }
            return error.GitFailed;
        }
        try appendPaths(&set, git_root, diff.stdout.items);
    }

    return set;
}

const GitResult = struct {
    ok: bool,
    stdout: std.array_list.Managed(u8),
    stderr: std.array_list.Managed(u8),
};

fn runGit(
    allocator: std.mem.Allocator,
    git_path: []const u8,
    cwd: []const u8,
    args: []const []const u8,
) std.mem.Allocator.Error!GitResult {
    var argv = try std.array_list.Managed([]const u8).initCapacity(allocator, args.len + 1);
    defer argv.deinit();
    argv.appendAssumeCapacity(git_path);
    argv.appendSliceAssumeCapacity(args);

    const proc = bun.spawnSync(&.{
        .argv = argv.items,
        .cwd = cwd,
        .stdout = .buffer,
        .stderr = .buffer,
        .stdin = .ignore,
        .envp = null,
        // The test command has a JSC VM running; reuse its event loop on
        // Windows rather than spinning up a MiniEventLoop.
        .windows = if (Environment.isWindows) .{
            .loop = jsc.EventLoopHandle.init(jsc.VirtualMachine.get()),
        },
    }) catch |err| {
        Output.errGeneric("--changed: failed to spawn git: {s}", .{@errorName(err)});
        return .{
            .ok = false,
            .stdout = .init(allocator),
            .stderr = .init(allocator),
        };
    };

    return switch (proc) {
        .err => |err| {
            Output.errGeneric("--changed: failed to spawn git: {f}", .{err});
            return .{
                .ok = false,
                .stdout = .init(allocator),
                .stderr = .init(allocator),
            };
        },
        .result => |result| .{
            .ok = result.isOK(),
            .stdout = result.stdout,
            .stderr = result.stderr,
        },
    };
}

/// Parse newline-delimited repo-relative paths from git output, join each
/// with the repository root, and insert existing files into `set`.
fn appendPaths(
    set: *bun.StringSet,
    git_root: []const u8,
    stdout: []const u8,
) std.mem.Allocator.Error!void {
    var buf: bun.PathBuffer = undefined;
    var it = std.mem.tokenizeAny(u8, stdout, "\r\n");
    while (it.next()) |line| {
        const rel = strings.trim(line, " \t");
        if (rel.len == 0) continue;
        const abs = bun.path.joinAbsStringBuf(git_root, &buf, &[_][]const u8{rel}, .auto);
        // Skip deletions; the bundler can only parse files that exist.
        if (!bun.sys.exists(abs)) continue;
        try set.insert(abs);
    }
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const Transpiler = bun.Transpiler;
const logger = bun.logger;
const strings = bun.strings;

const Command = bun.cli.Command;
const jsc = bun.jsc;

const BundleV2 = bun.bundle_v2.BundleV2;
const Index = bun.ast.Index;
