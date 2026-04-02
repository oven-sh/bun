const std = @import("std");
const ziggit = @import("ziggit");

const CLONE_URL = "https://github.com/octocat/Hello-World.git";
const LOCAL_ITERATIONS = 100;
const NETWORK_ITERATIONS = 5;

fn timestamp() i128 {
    return std.time.nanoTimestamp();
}

fn nsToMs(ns: i128) f64 {
    return @as(f64, @floatFromInt(ns)) / 1_000_000.0;
}

fn sortI128(items: []i128) void {
    std.mem.sort(i128, items, {}, struct {
        fn cmp(_: void, a: i128, b: i128) bool {
            return a < b;
        }
    }.cmp);
}

const Stats = struct {
    mean: f64,
    min: f64,
    max: f64,
    p50: f64,
    p95: f64,

    fn compute(samples: []i128) Stats {
        if (samples.len == 0) {
            return .{ .mean = 0, .min = 0, .max = 0, .p50 = 0, .p95 = 0 };
        }
        sortI128(samples);
        var sum: i128 = 0;
        for (samples) |s| sum += s;
        const n = samples.len;
        return .{
            .mean = nsToMs(sum) / @as(f64, @floatFromInt(n)),
            .min = nsToMs(samples[0]),
            .max = nsToMs(samples[n - 1]),
            .p50 = nsToMs(samples[n / 2]),
            .p95 = nsToMs(samples[@min(n - 1, n * 95 / 100)]),
        };
    }

    fn print(self: Stats, label: []const u8) void {
        std.debug.print("  {s}: mean={d:.3}ms min={d:.3}ms max={d:.3}ms p50={d:.3}ms p95={d:.3}ms\n", .{
            label, self.mean, self.min, self.max, self.p50, self.p95,
        });
    }
};

const BenchResult = struct {
    ziggit_stats: Stats,
    git_stats: Stats,
};

fn cleanDir(path: []const u8) void {
    std.fs.cwd().deleteTree(path) catch {};
}

const SEPARATOR = "============================================================";

// ==================== BENCHMARK: Clone (bare) ====================
fn benchClone(allocator: std.mem.Allocator) ?BenchResult {
    std.debug.print("\n{s}\n", .{SEPARATOR});
    std.debug.print("=== Clone Bare Benchmark ({d} iterations) ===\n", .{NETWORK_ITERATIONS});
    std.debug.print("    URL: {s}\n", .{CLONE_URL});

    var ziggit_samples: [NETWORK_ITERATIONS]i128 = undefined;
    var git_samples: [NETWORK_ITERATIONS]i128 = undefined;

    // Ziggit clone
    for (0..NETWORK_ITERATIONS) |i| {
        const target = std.fmt.allocPrint(allocator, "/tmp/bench_ziggit_clone_{d}", .{i}) catch continue;
        defer allocator.free(target);
        cleanDir(target);

        const start = timestamp();
        var repo = ziggit.Repository.cloneBare(allocator, CLONE_URL, target) catch |err| {
            std.debug.print("  ziggit clone error: {s}\n", .{@errorName(err)});
            ziggit_samples[i] = -1;
            continue;
        };
        defer repo.close();
        ziggit_samples[i] = timestamp() - start;
        cleanDir(target);
    }

    // Git CLI clone
    for (0..NETWORK_ITERATIONS) |i| {
        const target = std.fmt.allocPrint(allocator, "/tmp/bench_git_clone_{d}", .{i}) catch continue;
        defer allocator.free(target);
        cleanDir(target);

        const start = timestamp();
        const result = std.process.Child.run(.{
            .allocator = allocator,
            .argv = &.{ "git", "clone", "--bare", "--quiet", CLONE_URL, target },
        }) catch |err| {
            std.debug.print("  git clone error: {s}\n", .{@errorName(err)});
            git_samples[i] = -1;
            continue;
        };
        allocator.free(result.stdout);
        allocator.free(result.stderr);
        git_samples[i] = timestamp() - start;
        cleanDir(target);
    }

    // Filter out errors (-1)
    var z_valid = std.ArrayList(i128).init(allocator);
    defer z_valid.deinit();
    var g_valid = std.ArrayList(i128).init(allocator);
    defer g_valid.deinit();
    for (ziggit_samples) |s| if (s > 0) z_valid.append(s) catch {};
    for (git_samples) |s| if (s > 0) g_valid.append(s) catch {};

    if (z_valid.items.len == 0 or g_valid.items.len == 0) {
        std.debug.print("  ERROR: Not enough successful samples\n", .{});
        return null;
    }

    const zs = Stats.compute(z_valid.items);
    const gs = Stats.compute(g_valid.items);
    zs.print("ziggit");
    gs.print("git   ");
    std.debug.print("  speedup: {d:.2}x\n", .{gs.mean / zs.mean});

    return .{ .ziggit_stats = zs, .git_stats = gs };
}

// ==================== BENCHMARK: revParseHead ====================
fn benchRevParse(allocator: std.mem.Allocator, repo_path: []const u8) ?BenchResult {
    std.debug.print("\n{s}\n", .{SEPARATOR});
    std.debug.print("=== revParseHead Benchmark ({d} iterations) ===\n", .{LOCAL_ITERATIONS});

    var ziggit_samples: [LOCAL_ITERATIONS]i128 = undefined;
    var git_samples: [LOCAL_ITERATIONS]i128 = undefined;

    // Ziggit
    for (0..LOCAL_ITERATIONS) |i| {
        const start = timestamp();
        var repo = ziggit.Repository.open(allocator, repo_path) catch |err| {
            std.debug.print("  ziggit open error: {s}\n", .{@errorName(err)});
            ziggit_samples[i] = -1;
            continue;
        };
        const head = repo.revParseHead() catch |err| {
            std.debug.print("  ziggit revParseHead error: {s}\n", .{@errorName(err)});
            repo.close();
            ziggit_samples[i] = -1;
            continue;
        };
        _ = head;
        repo.close();
        ziggit_samples[i] = timestamp() - start;
    }

    // Git CLI
    for (0..LOCAL_ITERATIONS) |i| {
        const start = timestamp();
        const result = std.process.Child.run(.{
            .allocator = allocator,
            .argv = &.{ "git", "-C", repo_path, "rev-parse", "HEAD" },
        }) catch |err| {
            std.debug.print("  git rev-parse error: {s}\n", .{@errorName(err)});
            git_samples[i] = -1;
            continue;
        };
        allocator.free(result.stdout);
        allocator.free(result.stderr);
        git_samples[i] = timestamp() - start;
    }

    var z_valid = std.ArrayList(i128).init(allocator);
    defer z_valid.deinit();
    var g_valid = std.ArrayList(i128).init(allocator);
    defer g_valid.deinit();
    for (ziggit_samples) |s| if (s > 0) z_valid.append(s) catch {};
    for (git_samples) |s| if (s > 0) g_valid.append(s) catch {};

    if (z_valid.items.len == 0 or g_valid.items.len == 0) {
        std.debug.print("  ERROR: Not enough successful samples\n", .{});
        return null;
    }

    const zs = Stats.compute(z_valid.items);
    const gs = Stats.compute(g_valid.items);
    zs.print("ziggit");
    gs.print("git   ");
    std.debug.print("  speedup: {d:.2}x\n", .{gs.mean / zs.mean});

    return .{ .ziggit_stats = zs, .git_stats = gs };
}

// ==================== BENCHMARK: findCommit ====================
fn benchFindCommit(allocator: std.mem.Allocator, repo_path: []const u8, committish: []const u8) ?BenchResult {
    std.debug.print("\n{s}\n", .{SEPARATOR});
    std.debug.print("=== findCommit Benchmark ({d} iterations, ref=\"{s}\") ===\n", .{ LOCAL_ITERATIONS, committish });

    var ziggit_samples: [LOCAL_ITERATIONS]i128 = undefined;
    var git_samples: [LOCAL_ITERATIONS]i128 = undefined;

    // Ziggit
    for (0..LOCAL_ITERATIONS) |i| {
        const start = timestamp();
        var repo = ziggit.Repository.open(allocator, repo_path) catch |err| {
            std.debug.print("  ziggit open error: {s}\n", .{@errorName(err)});
            ziggit_samples[i] = -1;
            continue;
        };
        const hash = repo.findCommit(committish) catch |err| {
            std.debug.print("  ziggit findCommit error: {s}\n", .{@errorName(err)});
            repo.close();
            ziggit_samples[i] = -1;
            continue;
        };
        _ = hash;
        repo.close();
        ziggit_samples[i] = timestamp() - start;
    }

    // Git CLI
    for (0..LOCAL_ITERATIONS) |i| {
        const start = timestamp();
        const result = std.process.Child.run(.{
            .allocator = allocator,
            .argv = &.{ "git", "-C", repo_path, "log", "--format=%H", "-1", committish },
        }) catch |err| {
            std.debug.print("  git log error: {s}\n", .{@errorName(err)});
            git_samples[i] = -1;
            continue;
        };
        allocator.free(result.stdout);
        allocator.free(result.stderr);
        git_samples[i] = timestamp() - start;
    }

    var z_valid = std.ArrayList(i128).init(allocator);
    defer z_valid.deinit();
    var g_valid = std.ArrayList(i128).init(allocator);
    defer g_valid.deinit();
    for (ziggit_samples) |s| if (s > 0) z_valid.append(s) catch {};
    for (git_samples) |s| if (s > 0) g_valid.append(s) catch {};

    if (z_valid.items.len == 0 or g_valid.items.len == 0) {
        std.debug.print("  ERROR: Not enough successful samples\n", .{});
        return null;
    }

    const zs = Stats.compute(z_valid.items);
    const gs = Stats.compute(g_valid.items);
    zs.print("ziggit");
    gs.print("git   ");
    std.debug.print("  speedup: {d:.2}x\n", .{gs.mean / zs.mean});

    return .{ .ziggit_stats = zs, .git_stats = gs };
}

// ==================== BENCHMARK: Fetch ====================
fn benchFetch(allocator: std.mem.Allocator, repo_path: []const u8) ?BenchResult {
    std.debug.print("\n{s}\n", .{SEPARATOR});
    std.debug.print("=== Fetch Benchmark ({d} iterations) ===\n", .{NETWORK_ITERATIONS});

    var ziggit_samples: [NETWORK_ITERATIONS]i128 = undefined;
    var git_samples: [NETWORK_ITERATIONS]i128 = undefined;

    // Ziggit fetch
    for (0..NETWORK_ITERATIONS) |i| {
        const start = timestamp();
        var repo = ziggit.Repository.open(allocator, repo_path) catch |err| {
            std.debug.print("  ziggit open error: {s}\n", .{@errorName(err)});
            ziggit_samples[i] = -1;
            continue;
        };
        repo.fetch(CLONE_URL) catch |err| {
            std.debug.print("  ziggit fetch error: {s}\n", .{@errorName(err)});
            repo.close();
            ziggit_samples[i] = -1;
            continue;
        };
        repo.close();
        ziggit_samples[i] = timestamp() - start;
    }

    // Git CLI fetch
    for (0..NETWORK_ITERATIONS) |i| {
        const start = timestamp();
        const result = std.process.Child.run(.{
            .allocator = allocator,
            .argv = &.{ "git", "-C", repo_path, "fetch", "--quiet" },
        }) catch |err| {
            std.debug.print("  git fetch error: {s}\n", .{@errorName(err)});
            git_samples[i] = -1;
            continue;
        };
        allocator.free(result.stdout);
        allocator.free(result.stderr);
        git_samples[i] = timestamp() - start;
    }

    var z_valid = std.ArrayList(i128).init(allocator);
    defer z_valid.deinit();
    var g_valid = std.ArrayList(i128).init(allocator);
    defer g_valid.deinit();
    for (ziggit_samples) |s| if (s > 0) z_valid.append(s) catch {};
    for (git_samples) |s| if (s > 0) g_valid.append(s) catch {};

    if (z_valid.items.len == 0 or g_valid.items.len == 0) {
        std.debug.print("  ERROR: Not enough successful samples\n", .{});
        return null;
    }

    const zs = Stats.compute(z_valid.items);
    const gs = Stats.compute(g_valid.items);
    zs.print("ziggit");
    gs.print("git   ");
    std.debug.print("  speedup: {d:.2}x\n", .{gs.mean / zs.mean});

    return .{ .ziggit_stats = zs, .git_stats = gs };
}

// ==================== BENCHMARK: describeTags ====================
fn benchDescribeTags(allocator: std.mem.Allocator, repo_path: []const u8) ?BenchResult {
    std.debug.print("\n{s}\n", .{SEPARATOR});
    std.debug.print("=== describeTags Benchmark ({d} iterations) ===\n", .{LOCAL_ITERATIONS});

    var ziggit_samples: [LOCAL_ITERATIONS]i128 = undefined;
    var git_samples: [LOCAL_ITERATIONS]i128 = undefined;

    // Ziggit
    for (0..LOCAL_ITERATIONS) |i| {
        const start = timestamp();
        var repo = ziggit.Repository.open(allocator, repo_path) catch |err| {
            std.debug.print("  ziggit open error: {s}\n", .{@errorName(err)});
            ziggit_samples[i] = -1;
            continue;
        };
        const tag = repo.describeTags(allocator) catch |err| {
            if (i == 0) std.debug.print("  ziggit describeTags error: {s}\n", .{@errorName(err)});
            repo.close();
            ziggit_samples[i] = -1;
            continue;
        };
        allocator.free(tag);
        repo.close();
        ziggit_samples[i] = timestamp() - start;
    }

    // Git CLI
    for (0..LOCAL_ITERATIONS) |i| {
        const start = timestamp();
        const result = std.process.Child.run(.{
            .allocator = allocator,
            .argv = &.{ "git", "-C", repo_path, "describe", "--tags", "--abbrev=0" },
        }) catch |err| {
            std.debug.print("  git describe error: {s}\n", .{@errorName(err)});
            git_samples[i] = -1;
            continue;
        };
        allocator.free(result.stdout);
        allocator.free(result.stderr);
        git_samples[i] = timestamp() - start;
    }

    var z_valid = std.ArrayList(i128).init(allocator);
    defer z_valid.deinit();
    var g_valid = std.ArrayList(i128).init(allocator);
    defer g_valid.deinit();
    for (ziggit_samples) |s| if (s > 0) z_valid.append(s) catch {};
    for (git_samples) |s| if (s > 0) g_valid.append(s) catch {};

    if (z_valid.items.len == 0 or g_valid.items.len == 0) {
        std.debug.print("  WARN: Not enough valid samples for describeTags\n", .{});
        return null;
    }

    const zs = Stats.compute(z_valid.items);
    const gs = Stats.compute(g_valid.items);
    zs.print("ziggit");
    gs.print("git   ");
    std.debug.print("  speedup: {d:.2}x\n", .{gs.mean / zs.mean});

    return .{ .ziggit_stats = zs, .git_stats = gs };
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    std.debug.print("{s}\n", .{"╔══════════════════════════════════════════════════════════╗"});
    std.debug.print("{s}\n", .{"║       ziggit vs git CLI — Performance Benchmark         ║"});
    std.debug.print("{s}\n", .{"╚══════════════════════════════════════════════════════════╝"});

    // Print environment info
    {
        const uname_result = std.process.Child.run(.{
            .allocator = allocator,
            .argv = &.{ "uname", "-a" },
        }) catch null;
        if (uname_result) |u| {
            std.debug.print("System: {s}\n", .{std.mem.trim(u8, u.stdout, "\n")});
            allocator.free(u.stdout);
            allocator.free(u.stderr);
        }
    }

    std.debug.print("Local iterations: {d}, Network iterations: {d}\n", .{ LOCAL_ITERATIONS, NETWORK_ITERATIONS });
    std.debug.print("Target repo: {s}\n", .{CLONE_URL});

    // Setup: clone a repo for local operation benchmarks
    const bare_path = "/tmp/bench_bare_repo";
    const work_path = "/tmp/bench_work_repo";
    cleanDir(bare_path);
    cleanDir(work_path);

    std.debug.print("\n--- Setup: cloning test repo via git CLI ---\n", .{});
    {
        const result = try std.process.Child.run(.{
            .allocator = allocator,
            .argv = &.{ "git", "clone", "--bare", "--quiet", CLONE_URL, bare_path },
        });
        allocator.free(result.stdout);
        allocator.free(result.stderr);
    }
    // Also clone a working copy for rev-parse etc.
    {
        const result = try std.process.Child.run(.{
            .allocator = allocator,
            .argv = &.{ "git", "clone", "--quiet", CLONE_URL, work_path },
        });
        allocator.free(result.stdout);
        allocator.free(result.stderr);
    }
    // Create a lightweight tag for describeTags benchmark (Hello-World has no tags)
    {
        const result = try std.process.Child.run(.{
            .allocator = allocator,
            .argv = &.{ "git", "-C", work_path, "tag", "v1.0.0" },
        });
        allocator.free(result.stdout);
        allocator.free(result.stderr);
    }
    std.debug.print("Setup complete.\n", .{});

    // Get the HEAD hash for findCommit
    const head_hash_raw = blk: {
        const result = try std.process.Child.run(.{
            .allocator = allocator,
            .argv = &.{ "git", "-C", work_path, "rev-parse", "HEAD" },
        });
        allocator.free(result.stderr);
        break :blk result.stdout;
    };
    defer allocator.free(head_hash_raw);
    const head_hash = std.mem.trim(u8, head_hash_raw, " \t\r\n");
    std.debug.print("HEAD hash: {s}\n", .{head_hash});

    // ===== Run benchmarks =====

    // 1. Clone (network)
    const clone_result = benchClone(allocator);

    // 2. revParseHead (local) — on the working copy
    const revparse_result = benchRevParse(allocator, work_path);

    // 3. findCommit (local) — on the working copy with a known hash
    const findcommit_result = benchFindCommit(allocator, work_path, head_hash);

    // 4. Fetch (network) — on the bare repo
    const fetch_result = benchFetch(allocator, bare_path);

    // 5. describeTags (local) — on the working copy
    const describe_result = benchDescribeTags(allocator, work_path);

    // ===== Summary =====
    std.debug.print("\n{s}\n", .{SEPARATOR});
    std.debug.print("=== SUMMARY ===\n", .{});
    std.debug.print("{s:<20} {s:>12} {s:>12} {s:>10}\n", .{ "Operation", "ziggit(ms)", "git(ms)", "speedup" });
    std.debug.print("------------------------------------------------------\n", .{});

    if (clone_result) |r| {
        std.debug.print("{s:<20} {d:>12.3} {d:>12.3} {d:>9.2}x\n", .{ "clone (bare)", r.ziggit_stats.mean, r.git_stats.mean, r.git_stats.mean / r.ziggit_stats.mean });
    }
    if (revparse_result) |r| {
        std.debug.print("{s:<20} {d:>12.3} {d:>12.3} {d:>9.2}x\n", .{ "revParseHead", r.ziggit_stats.mean, r.git_stats.mean, r.git_stats.mean / r.ziggit_stats.mean });
    }
    if (findcommit_result) |r| {
        std.debug.print("{s:<20} {d:>12.3} {d:>12.3} {d:>9.2}x\n", .{ "findCommit", r.ziggit_stats.mean, r.git_stats.mean, r.git_stats.mean / r.ziggit_stats.mean });
    }
    if (fetch_result) |r| {
        std.debug.print("{s:<20} {d:>12.3} {d:>12.3} {d:>9.2}x\n", .{ "fetch", r.ziggit_stats.mean, r.git_stats.mean, r.git_stats.mean / r.ziggit_stats.mean });
    }
    if (describe_result) |r| {
        std.debug.print("{s:<20} {d:>12.3} {d:>12.3} {d:>9.2}x\n", .{ "describeTags", r.ziggit_stats.mean, r.git_stats.mean, r.git_stats.mean / r.ziggit_stats.mean });
    }

    std.debug.print("\nNote: speedup > 1.0 means ziggit is faster.\n", .{});
    std.debug.print("For local ops, the main advantage is eliminating process spawn overhead (~1-2ms).\n", .{});
    std.debug.print("For network ops, network latency dominates so the difference is smaller.\n", .{});

    // Cleanup
    cleanDir(bare_path);
    cleanDir(work_path);
    for (0..NETWORK_ITERATIONS) |i| {
        const p1 = std.fmt.allocPrint(allocator, "/tmp/bench_ziggit_clone_{d}", .{i}) catch continue;
        defer allocator.free(p1);
        cleanDir(p1);
        const p2 = std.fmt.allocPrint(allocator, "/tmp/bench_git_clone_{d}", .{i}) catch continue;
        defer allocator.free(p2);
        cleanDir(p2);
    }
}
