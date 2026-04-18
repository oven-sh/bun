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

    // If this process was restarted by the --watch file watcher, it
    // recorded exactly which files changed in this env var before
    // exec()ing. Use that as the changed-file set instead of re-querying
    // git, so editing one file re-runs only the tests that reach that
    // file rather than every test affected by any uncommitted change.
    // (On Windows the watcher restarts via TerminateProcess + parent
    // respawn, which cannot carry state, so this is POSIX-only; Windows
    // falls through to git below.)
    var changed_files = if (consumeWatchTrigger(allocator)) |trigger_set|
        trigger_set
    else
        getChangedFiles(allocator, top_level_dir, changed_since) catch |err| switch (err) {
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

    // With a clean working tree and no --watch, nothing can be affected and
    // there is no watcher to seed, so skip the module-graph scan entirely.
    if (changed_files.count() == 0 and ctx.debug.hot_reload != .watch) {
        return .{
            .test_files = test_files[0..0],
            .changed_count = 0,
            .total_tests = test_files.len,
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
    // The bundler's ThreadLocalArena and worker pool are intentionally
    // left in place for the remainder of the process. `bun test --watch`
    // exec()s a fresh process on each reload, so nothing accumulates
    // across restarts; tearing the pool down here blocks on worker
    // shutdown and competes with the runtime VM's own parse threads.

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
    // Reserve once so the dupe+append below cannot leak a duped path if the
    // list ever needed to grow and failed.
    try graph_files.ensureTotalCapacityPrecise(allocator, sources.len);

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
        graph_files.appendAssumeCapacity(try allocator.dupe(u8, path_text));
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

    // Map the original test_files slot -> bundler source index. An entry
    // point that failed to resolve is skipped by enqueueEntryPoints, so
    // match by absolute path via path_to_index rather than by position.
    const slot_to_source = try allocator.alloc(?u32, test_files.len);
    defer allocator.free(slot_to_source);
    for (test_files, slot_to_source) |tf, *out| {
        out.* = path_to_index.get(tf.slice());
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
    for (test_files, slot_to_source) |tf, maybe_source| {
        const keep = changed_files.contains(tf.slice()) or
            (if (maybe_source) |src| affected.isSet(src) else false);

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

/// Env var carrying the absolute path of the temp file that the
/// previous process's watcher wrote its changed-path list into before
/// exec()ing. Set once by `initWatchTrigger` in the first process and
/// inherited through every restart. The value is a short path, never
/// the list itself, so there is no env size concern.
pub const trigger_file_env_var = "BUN_INTERNAL_TEST_CHANGED_TRIGGER_FILE";

/// Make sure the trigger-file env var is set (generating a fresh temp
/// path if this is the first process in the --watch chain) and wire up
/// the hot-reloader collector to record changed paths. The collector
/// and the path string intentionally live for the rest of the process;
/// --watch exec()s on reload so nothing accumulates across restarts.
pub fn initWatchTrigger(allocator: std.mem.Allocator) void {
    if (bun.Environment.isWindows) {
        // Windows --watch restarts via TerminateProcess + parent
        // respawn with the parent's (unchanged) env, so a setenv in
        // the first child would not reach subsequent children. Fall
        // back to re-querying git on each restart there for now.
        return;
    }

    const path: [:0]const u8 = if (bun.getenvZ(trigger_file_env_var)) |existing|
        bun.handleOom(allocator.dupeZ(u8, existing))
    else brk: {
        var rng = std.Random.DefaultPrng.init(@as(u64, @bitCast(std.time.milliTimestamp())) ^
            @as(u64, @intCast(std.c.getpid())));
        const tmpdir = bun.fs.FileSystem.RealFS.tmpdirPath();
        const fresh = bun.handleOom(std.fmt.allocPrintSentinel(
            allocator,
            "{s}{c}.bun-test-changed-{x}.trigger",
            .{ strings.withoutTrailingSlash(tmpdir), std.fs.path.sep, rng.random().int(u64) },
            0,
        ));
        // Export once so every exec()'d descendant inherits the same
        // path. Adding (not removing) an env var is safe w.r.t.
        // `std.os.environ`; it simply won't be visible to code that
        // iterates the startup-captured slice in this process.
        _ = setenv(trigger_file_env_var, fresh.ptr, 1);
        break :brk fresh;
    };

    const set = bun.handleOom(allocator.create(bun.StringSet));
    set.* = bun.StringSet.init(allocator);
    jsc.hot_reloader.watch_changed_paths = set;
    jsc.hot_reloader.watch_changed_trigger_file = path;
}

extern "c" fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: c_int) c_int;

/// If the previous process's watcher recorded which files triggered
/// this restart, read the newline-separated absolute-path list out of
/// the trigger file, delete the file, and return the set. Returns null
/// if the file is absent, empty, or every path no longer exists (in
/// which case the caller falls back to querying git).
fn consumeWatchTrigger(allocator: std.mem.Allocator) ?bun.StringSet {
    if (bun.Environment.isWindows) return null;

    const trigger_path_raw = bun.getenvZ(trigger_file_env_var) orelse return null;
    if (trigger_path_raw.len == 0) return null;
    const trigger_path = bun.handleOom(allocator.dupeZ(u8, trigger_path_raw));
    defer allocator.free(trigger_path);

    const contents = switch (bun.sys.File.readFrom(bun.FD.cwd(), trigger_path, allocator)) {
        .result => |bytes| bytes,
        .err => return null,
    };
    defer allocator.free(contents);
    // Consume-once: the next restart writes a fresh list. If the
    // process restarts for any other reason (crash + auto-reload) it
    // should fall back to git, not re-read a stale list.
    _ = bun.sys.unlink(trigger_path);

    var set = bun.StringSet.init(allocator);
    var it = std.mem.tokenizeAny(u8, contents, "\r\n");
    while (it.next()) |path| {
        if (path.len == 0) continue;
        // The watcher may see a file disappear (delete/rename). A path
        // that no longer exists cannot appear in the module graph this
        // run, so drop it; its importers will still be picked up if the
        // importer file itself was touched.
        if (!bun.sys.exists(path)) continue;
        bun.handleOom(set.insert(path));
    }
    // If every triggering path was a deletion, fall back to git so the
    // user at least gets the same behaviour as the initial run rather
    // than "0 changed files, nothing to run".
    if (set.count() == 0) {
        set.deinit();
        return null;
    }
    return set;
}

const GitError = error{ GitNotFound, GitFailed } || std.mem.Allocator.Error;

/// Return the set of changed files (absolute paths) according to git.
///
/// With `since == ""` this is the union of unstaged, staged, and
/// untracked files. With a ref, it is `git diff --name-only <since>`
/// unioned with untracked files (a brand-new file is "changed since"
/// any prior commit). Paths that do not exist on disk (deletions) are
/// skipped since they cannot appear in the module graph.
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
            if (result.spawn_failed) {
                // runGit already printed the spawn error.
            } else if (result.stderr.items.len > 0) {
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
        if (diff.spawn_failed) return error.GitFailed;
        if (diff.ok) {
            appendPaths(&set, git_root, diff.stdout.items);
        } else {
            var unstaged = try runGit(allocator, git_path, top_level_dir, &.{ "diff", "--name-only", "--" });
            defer unstaged.stdout.deinit();
            defer unstaged.stderr.deinit();
            if (unstaged.spawn_failed) return error.GitFailed;
            if (unstaged.ok) {
                appendPaths(&set, git_root, unstaged.stdout.items);
            }

            var staged = try runGit(allocator, git_path, top_level_dir, &.{ "diff", "--name-only", "--cached", "--" });
            defer staged.stdout.deinit();
            defer staged.stderr.deinit();
            if (staged.spawn_failed) return error.GitFailed;
            if (staged.ok) {
                appendPaths(&set, git_root, staged.stdout.items);
            }
        }
    } else {
        var diff = try runGit(allocator, git_path, top_level_dir, &.{ "diff", "--name-only", since, "--" });
        defer diff.stdout.deinit();
        defer diff.stderr.deinit();
        if (!diff.ok) {
            if (diff.spawn_failed) {
                // runGit already printed the spawn error.
            } else if (diff.stderr.items.len > 0) {
                Output.errGeneric("--changed: {s}", .{strings.trim(diff.stderr.items, " \r\n\t")});
            } else {
                Output.errGeneric("--changed: git diff against {f} failed", .{bun.fmt.quote(since)});
            }
            return error.GitFailed;
        }
        appendPaths(&set, git_root, diff.stdout.items);
    }

    // Untracked files are always considered changed — a brand-new file
    // did not exist at HEAD or at `since`, so it is "changed since"
    // either. `git diff --name-only` never reports untracked files, so
    // supplement with ls-files in both branches above. `--full-name`
    // forces repo-root-relative output regardless of our cwd, matching
    // `git diff --name-only`.
    {
        var untracked = try runGit(allocator, git_path, top_level_dir, &.{ "ls-files", "--others", "--exclude-standard", "--full-name" });
        defer untracked.stdout.deinit();
        defer untracked.stderr.deinit();
        if (untracked.spawn_failed) return error.GitFailed;
        if (untracked.ok) {
            appendPaths(&set, git_root, untracked.stdout.items);
        }
    }

    return set;
}

const GitResult = struct {
    ok: bool,
    /// Set when the git process could not be spawned at all. The failure
    /// has already been reported; callers should not print a second
    /// "not a git repo" style message.
    spawn_failed: bool = false,
    stdout: std.array_list.Managed(u8),
    stderr: std.array_list.Managed(u8),
};

fn runGit(
    allocator: std.mem.Allocator,
    git_path: []const u8,
    cwd: []const u8,
    args: []const []const u8,
) std.mem.Allocator.Error!GitResult {
    var argv = try std.array_list.Managed([]const u8).initCapacity(allocator, args.len + 3);
    defer argv.deinit();
    argv.appendAssumeCapacity(git_path);
    // `core.quotePath` (on by default) wraps non-ASCII filenames in quotes
    // and emits octal escapes. We want raw UTF-8 paths so they match the
    // bundler's resolved paths byte-for-byte.
    argv.appendAssumeCapacity("-c");
    argv.appendAssumeCapacity("core.quotePath=off");
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
            .spawn_failed = true,
            .stdout = .init(allocator),
            .stderr = .init(allocator),
        };
    };

    return switch (proc) {
        .err => |err| {
            Output.errGeneric("--changed: failed to spawn git: {f}", .{err});
            return .{
                .ok = false,
                .spawn_failed = true,
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
) void {
    var buf: bun.PathBuffer = undefined;
    var it = std.mem.tokenizeAny(u8, stdout, "\r\n");
    while (it.next()) |line| {
        const rel = strings.trim(line, " \t");
        if (rel.len == 0) continue;
        const abs = bun.path.joinAbsStringBuf(git_root, &buf, &[_][]const u8{rel}, .auto);
        // Skip deletions; the bundler can only parse files that exist.
        if (!bun.sys.exists(abs)) continue;
        // `StringSet.insert` dupes the key internally; abort on OOM rather
        // than propagating so the set can never be left holding a pointer
        // into our stack `buf` on the errdefer cleanup path.
        bun.handleOom(set.insert(abs));
    }
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const Transpiler = bun.Transpiler;
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;
const BundleV2 = bun.bundle_v2.BundleV2;
const Command = bun.cli.Command;
const Index = bun.ast.Index;
