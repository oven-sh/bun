//! Linux cgroup memory limit detection for container-aware garbage collection.
//!
//! When Bun runs inside a Docker container or Kubernetes pod, the Linux kernel
//! enforces memory limits via cgroups. Without reading these limits, the GC has
//! no idea that the process is memory-constrained and will delay collection until
//! the kernel's OOM killer terminates the container.
//!
//! This module reads cgroup v2 and v1 memory limits, returning the effective
//! memory ceiling for the current process. It is zero-cost on non-Linux platforms
//! and when running outside a container.
//!
//! References:
//! - cgroup v2: https://docs.kernel.org/admin-guide/cgroup-v2.html
//! - cgroup v1: https://docs.kernel.org/admin-guide/cgroup-v1/memory.html
//! - Issue: https://github.com/oven-sh/bun/issues/17723

/// Returns the cgroup memory limit in bytes, or `null` if no limit is set
/// (i.e., the process is not running in a memory-constrained container).
///
/// Tries cgroup v2 first (`/sys/fs/cgroup/memory.max`), then falls back to
/// cgroup v1 (`/sys/fs/cgroup/memory/memory.limit_in_bytes`).
///
/// A limit of "max" (cgroup v2) or a value >= 1 TiB (cgroup v1 sentinel)
/// is treated as "unlimited" and returns `null`.
///
/// NOTE: This reads the root cgroup files, which resolve to the container's own
/// limit when running inside a Docker/K8s cgroup namespace (the common case).
/// Nested cgroup setups without namespace isolation may need /proc/self/cgroup
/// parsing as a follow-up.
pub fn getMemoryLimit() ?usize {
    if (comptime !bun.Environment.isLinux) return null;

    // Try cgroup v2 first
    if (readCgroupFile("/sys/fs/cgroup/memory.max")) |limit| {
        return limit;
    }

    // Fall back to cgroup v1
    if (readCgroupFile("/sys/fs/cgroup/memory/memory.limit_in_bytes")) |limit| {
        // cgroup v1 uses PAGE_COUNTER_MAX * PAGE_SIZE as sentinel for "no limit",
        // which on 64-bit is a huge number (typically 0x7FFFFFFFFFFFF000 or similar).
        // We check against a 1 TiB threshold: any limit above 1 TiB is almost certainly
        // the sentinel, not a real container limit. This avoids the previous heuristic
        // of comparing against physical RAM, which wrongly dropped valid limits
        // (e.g. 15 GiB on a 16 GiB node).
        const one_tib: usize = 1024 * 1024 * 1024 * 1024;
        if (limit >= one_tib) return null;
        return limit;
    }

    return null;
}



/// Read and parse a cgroup memory limit file.
/// Returns `null` if the file doesn't exist, can't be read, or contains "max".
fn readCgroupFile(path: [:0]const u8) ?usize {
    const file = switch (bun.sys.open(path, bun.O.RDONLY, 0)) {
        .result => |fd| fd,
        .err => return null,
    };
    defer _ = bun.sys.close(file);

    var buf: [64]u8 = undefined;
    const bytes_read = switch (bun.sys.read(file, &buf)) {
        .result => |n| n,
        .err => return null,
    };

    if (bytes_read == 0) return null;
    const content = buf[0..bytes_read];

    // Trim trailing newline/whitespace
    const trimmed = std.mem.trimRight(u8, content, "\n \t\r");

    // "max" means unlimited (cgroup v2)
    if (bun.strings.eqlComptime(trimmed, "max")) return null;

    // Parse integer value
    return std.fmt.parseInt(usize, trimmed, 10) catch null;
}

// Cached memory limit — initialized exactly once via std.once.
// Uses std.once for thread safety since Bun__cgroup__getMemoryLimit() can be
// called from any Worker thread via process.constrainedMemory().
var cached_limit_value: usize = 0;
var cached_has_limit: bool = false;

var once_init = std.once(initCachedLimit);

fn initCachedLimit() void {
    if (getMemoryLimit()) |limit| {
        cached_limit_value = limit;
        cached_has_limit = true;
    }
}

/// Returns the cached cgroup memory limit. Thread-safe.
pub fn getCachedMemoryLimit() ?usize {
    once_init.call();
    if (cached_has_limit) return cached_limit_value;
    return null;
}

/// Export for C++ side (BunProcess.cpp) to call from process.constrainedMemory()
pub export fn Bun__cgroup__getMemoryLimit() u64 {
    return getCachedMemoryLimit() orelse 0;
}



const std = @import("std");
const bun = @import("bun");
