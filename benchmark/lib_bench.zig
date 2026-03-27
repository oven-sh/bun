// lib_bench.zig - Benchmark ziggit as a LIBRARY (how bun fork uses it)
// vs measuring CLI overhead of spawning git processes
//
// This is the critical comparison: bun fork calls ziggit functions directly,
// stock bun spawns git as child processes.
const std = @import("std");
const ziggit = @import("ziggit");
const print = std.debug.print;

const Timer = struct {
    start: i128,
    fn begin() Timer {
        return .{ .start = std.time.nanoTimestamp() };
    }
    fn elapsedUs(self: Timer) u64 {
        const end = std.time.nanoTimestamp();
        return @intCast(@divTrunc(end - self.start, 1000));
    }
    fn elapsedMs(self: Timer) u64 {
        return self.elapsedUs() / 1000;
    }
};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Args: <source_bare_repo_path> <iterations>
    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    if (args.len < 3) {
        print("Usage: lib_bench <bare_repo_path> <iterations>\n", .{});
        return;
    }

    const bare_path = args[1];
    const iterations = try std.fmt.parseInt(u32, args[2], 10);

    print("=== ZIGGIT LIBRARY vs GIT CLI BENCHMARK ===\n", .{});
    print("Bare repo: {s}\n", .{bare_path});
    print("Iterations: {d}\n\n", .{iterations});

    // ============================================================
    // Benchmark 1: rev-parse HEAD (findCommit) - LIBRARY
    // ============================================================
    {
        print("--- findCommit (rev-parse HEAD) ---\n", .{});

        // Library path: open repo + findCommit("HEAD") (what bun fork does)
        var lib_total_us: u64 = 0;
        var i: u32 = 0;
        while (i < iterations) : (i += 1) {
            const t = Timer.begin();
            var repo = try ziggit.Repository.open(allocator, bare_path);
            const hash = try repo.findCommit("HEAD");
            _ = hash;
            repo.close();
            lib_total_us += t.elapsedUs();
        }
        const lib_avg_us = lib_total_us / iterations;
        print("  ziggit library: {d}μs avg ({d}μs total over {d} iterations)\n", .{ lib_avg_us, lib_total_us, iterations });

        // CLI path: spawn git rev-parse HEAD (what stock bun does)
        var cli_total_us: u64 = 0;
        i = 0;
        while (i < iterations) : (i += 1) {
            const t = Timer.begin();
            var child = std.process.Child.init(&.{ "git", "-C", bare_path, "rev-parse", "HEAD" }, allocator);
            child.stdout_behavior = .Pipe;
            child.stderr_behavior = .Pipe;
            try child.spawn();
            _ = try child.wait();
            cli_total_us += t.elapsedUs();
        }
        const cli_avg_us = cli_total_us / iterations;
        print("  git CLI spawn:  {d}μs avg ({d}μs total over {d} iterations)\n", .{ cli_avg_us, cli_total_us, iterations });

        if (lib_avg_us > 0) {
            print("  speedup: {d}.{d:0>1}x\n", .{ cli_avg_us / lib_avg_us, (cli_avg_us * 10 / lib_avg_us) % 10 });
        }
        print("\n", .{});
    }

    // ============================================================
    // Benchmark 2: clone --bare (local) - LIBRARY
    // ============================================================
    {
        print("--- cloneBare (local bare clone) ---\n", .{});
        const clone_iters = @min(iterations, 20); // Cloning is heavier

        var lib_total_us: u64 = 0;
        var i: u32 = 0;
        while (i < clone_iters) : (i += 1) {
            const target = "/tmp/lib-bench-clone-zig";
            std.fs.deleteTreeAbsolute(target) catch {};
            const t = Timer.begin();
            var repo = try ziggit.Repository.cloneBare(allocator, bare_path, target);
            repo.close();
            lib_total_us += t.elapsedUs();
            std.fs.deleteTreeAbsolute(target) catch {};
        }
        const lib_avg_us = lib_total_us / clone_iters;
        print("  ziggit library: {d}μs avg ({d}μs total over {d} iterations)\n", .{ lib_avg_us, lib_total_us, clone_iters });

        var cli_total_us: u64 = 0;
        i = 0;
        while (i < clone_iters) : (i += 1) {
            const target = "/tmp/lib-bench-clone-git";
            std.fs.deleteTreeAbsolute(target) catch {};
            const t = Timer.begin();
            var child = std.process.Child.init(&.{ "git", "clone", "--bare", "--quiet", bare_path, target }, allocator);
            child.stdout_behavior = .Pipe;
            child.stderr_behavior = .Pipe;
            try child.spawn();
            _ = try child.wait();
            cli_total_us += t.elapsedUs();
            std.fs.deleteTreeAbsolute(target) catch {};
        }
        const cli_avg_us = cli_total_us / clone_iters;
        print("  git CLI spawn:  {d}μs avg ({d}μs total over {d} iterations)\n", .{ cli_avg_us, cli_total_us, clone_iters });

        if (lib_avg_us > 0) {
            print("  speedup: {d}.{d:0>1}x\n", .{ cli_avg_us / lib_avg_us, (cli_avg_us * 10 / lib_avg_us) % 10 });
        }
        print("\n", .{});
    }

    // ============================================================
    // Benchmark 3: Full workflow (clone bare + findCommit + checkout)
    // ============================================================
    {
        print("--- Full bun-install workflow (cloneBare + findCommit + clone) ---\n", .{});
        const wf_iters = @min(iterations, 20);

        var lib_total_us: u64 = 0;
        var i: u32 = 0;
        while (i < wf_iters) : (i += 1) {
            const bare_target = "/tmp/lib-bench-wf-bare-zig";
            const work_target = "/tmp/lib-bench-wf-work-zig";
            std.fs.deleteTreeAbsolute(bare_target) catch {};
            std.fs.deleteTreeAbsolute(work_target) catch {};

            const t = Timer.begin();
            // Step 1: cloneBare
            var bare_repo = try ziggit.Repository.cloneBare(allocator, bare_path, bare_target);
            // Step 2: findCommit (rev-parse HEAD)
            _ = try bare_repo.findCommit("HEAD");
            bare_repo.close();
            // Step 3: clone from bare (full clone with checkout)
            // In bun: cloneNoCheckout + checkout; here we use full clone which does both
            var work_repo = try ziggit.Repository.cloneBare(allocator, bare_target, work_target);
            work_repo.close();
            lib_total_us += t.elapsedUs();

            std.fs.deleteTreeAbsolute(bare_target) catch {};
            std.fs.deleteTreeAbsolute(work_target) catch {};
        }
        const lib_avg_us = lib_total_us / wf_iters;
        print("  ziggit library: {d}μs avg ({d}μs total over {d} iterations)\n", .{ lib_avg_us, lib_total_us, wf_iters });

        var cli_total_us: u64 = 0;
        i = 0;
        while (i < wf_iters) : (i += 1) {
            const bare_target = "/tmp/lib-bench-wf-bare-git";
            const work_target = "/tmp/lib-bench-wf-work-git";
            std.fs.deleteTreeAbsolute(bare_target) catch {};
            std.fs.deleteTreeAbsolute(work_target) catch {};

            const t = Timer.begin();
            // Step 1: clone --bare
            var c1 = std.process.Child.init(&.{ "git", "clone", "--bare", "--quiet", bare_path, bare_target }, allocator);
            c1.stdout_behavior = .Pipe;
            c1.stderr_behavior = .Pipe;
            try c1.spawn();
            _ = try c1.wait();

            // Step 2: rev-parse HEAD
            var c2 = std.process.Child.init(&.{ "git", "-C", bare_target, "rev-parse", "HEAD" }, allocator);
            c2.stdout_behavior = .Pipe;
            c2.stderr_behavior = .Pipe;
            try c2.spawn();
            _ = try c2.wait();

            // Step 3: clone (checkout)
            var c3 = std.process.Child.init(&.{ "git", "clone", "--quiet", bare_target, work_target }, allocator);
            c3.stdout_behavior = .Pipe;
            c3.stderr_behavior = .Pipe;
            try c3.spawn();
            _ = try c3.wait();

            cli_total_us += t.elapsedUs();
            std.fs.deleteTreeAbsolute(bare_target) catch {};
            std.fs.deleteTreeAbsolute(work_target) catch {};
        }
        const cli_avg_us = cli_total_us / wf_iters;
        print("  git CLI spawn:  {d}μs avg ({d}μs total over {d} iterations)\n", .{ cli_avg_us, cli_total_us, wf_iters });

        if (lib_avg_us > 0) {
            print("  speedup: {d}.{d:0>1}x\n", .{ cli_avg_us / lib_avg_us, (cli_avg_us * 10 / lib_avg_us) % 10 });
        }
        print("\n", .{});
    }
}
