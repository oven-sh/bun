const std = @import("std");
const ziggit = @import("ziggit");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    if (args.len < 2) {
        std.debug.print("Usage: findcommit_bench <bare-repo-path> [ref]\n", .{});
        return;
    }

    const repo_path = args[1];
    const ref = if (args.len > 2) args[2] else "HEAD";

    // Open repo (use openBare to match production code path)
    var repo = ziggit.Repository.openBare(allocator, repo_path) catch |err| {
        std.debug.print("Failed to open repo {s}: {}\n", .{ repo_path, err });
        return;
    };
    defer repo.close();

    // Warm up
    _ = repo.findCommit(ref) catch |err| {
        std.debug.print("Warm-up findCommit failed for ref {s}: {}\n", .{ ref, err });
        return;
    };

    // Benchmark 1000 iterations using monotonic timer
    const iterations: u32 = 1000;
    var timer = try std.time.Timer.start();
    var i: u32 = 0;
    var last_hash: [40]u8 = undefined;
    while (i < iterations) : (i += 1) {
        last_hash = repo.findCommit(ref) catch {
            std.debug.print("findCommit failed on iteration {}\n", .{i});
            return;
        };
    }
    const total_ns: u64 = timer.read();
    const per_call_ns = total_ns / iterations;

    std.debug.print("repo={s} ref={s} hash={s}\n", .{ repo_path, ref, &last_hash });
    std.debug.print("iterations={} total={d:.2}ms per_call={d:.1}µs\n", .{
        iterations,
        @as(f64, @floatFromInt(total_ns)) / 1_000_000.0,
        @as(f64, @floatFromInt(per_call_ns)) / 1_000.0,
    });
}
