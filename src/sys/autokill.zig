const KillPass = enum {
    sigterm, // Send SIGTERM for graceful shutdown
    sigstop, // Send SIGSTOP to freeze processes
    sigkill, // Send SIGKILL for forced termination
};

pub fn killAllChildProcesses() void {
    if (Environment.isWindows) {
        // Windows already uses Job Objects which automatically kill children on exit
        // This is a no-op
        return;
    }

    const current_pid = std.c.getpid();

    // Walk the process tree and kill only child processes
    // Do NOT kill the entire process group with kill(-pid) as that would
    // kill the Bun process itself before it can finish shutting down

    // Pass 1: SIGTERM to allow graceful cleanup
    // Give processes a chance to handle cleanup work before forced termination
    {
        const children = getChildPids(current_pid, current_pid) catch &[_]c_int{};
        defer if (children.len > 0) bun.default_allocator.free(children);

        // Bail out early if no children to kill
        if (children.len == 0) return;

        var seen = std.AutoHashMap(c_int, void).init(bun.default_allocator);
        defer seen.deinit();
        for (children) |child| {
            killProcessTreeRecursive(child, &seen, current_pid, .sigterm) catch {};
        }
    }

    // Brief delay to allow processes to handle SIGTERM (500 microseconds)
    std.time.sleep(500 * std.time.ns_per_us);

    // Pass 2: SIGSTOP to freeze entire tree and minimize reparenting races
    // Get fresh child list in case some exited from SIGTERM
    {
        const children = getChildPids(current_pid, current_pid) catch &[_]c_int{};
        defer if (children.len > 0) bun.default_allocator.free(children);

        // All processes may have exited from SIGTERM, bail out if so
        if (children.len == 0) return;

        var seen = std.AutoHashMap(c_int, void).init(bun.default_allocator);
        defer seen.deinit();
        for (children) |child| {
            killProcessTreeRecursive(child, &seen, current_pid, .sigstop) catch {};
        }
    }

    // Pass 3: SIGKILL to force termination of any remaining processes
    // Get fresh child list in case some exited from SIGSTOP
    {
        const children = getChildPids(current_pid, current_pid) catch &[_]c_int{};
        defer if (children.len > 0) bun.default_allocator.free(children);

        // All processes may have exited from SIGSTOP, bail out if so
        if (children.len == 0) return;

        var seen = std.AutoHashMap(c_int, void).init(bun.default_allocator);
        defer seen.deinit();
        for (children) |child| {
            killProcessTreeRecursive(child, &seen, current_pid, .sigkill) catch {};
        }
    }
}

fn getChildPids(parent: c_int, current_pid: c_int) ![]c_int {
    if (Environment.isLinux) {
        // Try /proc/{pid}/task/{tid}/children first (most efficient)
        const children_path = std.fmt.allocPrint(
            bun.default_allocator,
            "/proc/{d}/task/{d}/children",
            .{ parent, parent },
        ) catch {
            // Allocation failed; fall back to /proc scanning
            return getChildPidsFallback(parent, current_pid);
        };
        defer bun.default_allocator.free(children_path);

        const file = std.fs.openFileAbsolute(children_path, .{}) catch {
            // Fallback to scanning /proc (older kernels)
            return getChildPidsFallback(parent, current_pid);
        };
        defer file.close();

        const contents = file.readToEndAlloc(bun.default_allocator, 4096) catch {
            // File unreadable or too large; fall back to /proc scanning
            return getChildPidsFallback(parent, current_pid);
        };
        defer bun.default_allocator.free(contents);

        var list = std.ArrayList(c_int).init(bun.default_allocator);
        var iter = std.mem.tokenizeAny(u8, contents, " \n");
        while (iter.next()) |pid_str| {
            const pid = std.fmt.parseInt(c_int, pid_str, 10) catch continue;
            list.append(pid) catch continue;
        }

        return list.toOwnedSlice();
    } else if (Environment.isMac) {
        // Use proc_listpids with PROC_PPID_ONLY
        // Note: 2048 is a reasonable limit for most scenarios. If a process has more
        // than 2048 direct children, the list will be truncated. This is acceptable
        // for autokill's use case as processes with thousands of children are rare.
        var pids: [2048]c_int = undefined;
        const bytes = bun.c.proc_listpids(bun.c.PROC_PPID_ONLY, @as(u32, @intCast(parent)), &pids, @sizeOf(@TypeOf(pids)));

        if (bytes <= 0) return &[_]c_int{};

        const count = @as(usize, @intCast(bytes)) / @sizeOf(c_int);
        var list = std.ArrayList(c_int).init(bun.default_allocator);

        for (pids[0..count]) |pid| {
            if (pid > 0 and pid != current_pid) {
                list.append(pid) catch continue;
            }
        }

        return list.toOwnedSlice();
    }

    return &[_]c_int{};
}

fn getChildPidsFallback(parent: c_int, current_pid: c_int) ![]c_int {
    // Fallback for older Linux kernels: scan /proc
    var list = std.ArrayList(c_int).init(bun.default_allocator);

    var proc_dir = std.fs.openDirAbsolute("/proc", .{ .iterate = true }) catch return list.toOwnedSlice();
    defer proc_dir.close();

    var iter = proc_dir.iterate();
    while (try iter.next()) |entry| {
        const pid = std.fmt.parseInt(c_int, entry.name, 10) catch continue;
        if (pid <= 0 or pid == parent or pid == current_pid) continue;

        // Read /proc/{pid}/stat to get ppid
        const stat_path = std.fmt.allocPrint(
            bun.default_allocator,
            "/proc/{d}/stat",
            .{pid},
        ) catch continue;
        defer bun.default_allocator.free(stat_path);

        const stat_file = std.fs.openFileAbsolute(stat_path, .{}) catch continue;
        defer stat_file.close();

        const stat_contents = stat_file.readToEndAlloc(bun.default_allocator, 4096) catch continue;
        defer bun.default_allocator.free(stat_contents);

        // Parse: pid (comm) state ppid ...
        // Find the last ')' to skip the comm field
        const last_paren = std.mem.lastIndexOf(u8, stat_contents, ")") orelse continue;
        const after_comm = stat_contents[last_paren + 1 ..];

        // Parse: " state ppid ..."
        var parts = std.mem.tokenizeAny(u8, after_comm, " ");
        _ = parts.next(); // skip state
        const ppid_str = parts.next() orelse continue;
        const ppid = std.fmt.parseInt(c_int, ppid_str, 10) catch continue;

        if (ppid == parent) {
            list.append(pid) catch continue;
        }
    }

    return list.toOwnedSlice();
}

fn killProcessTreeRecursive(pid: c_int, killed: *std.AutoHashMap(c_int, void), current_pid: c_int, pass: KillPass) !void {
    // Avoid cycles and killing ourselves
    if (killed.contains(pid) or pid == current_pid or pid <= 0) {
        return;
    }
    try killed.put(pid, {});

    // Get children first to avoid race conditions where killing the parent
    // might prevent us from finding the children
    // If enumeration fails, treat as having no children and continue to kill this process
    const children = getChildPids(pid, current_pid) catch &[_]c_int{};
    defer if (children.len > 0) bun.default_allocator.free(children);

    // Process children first (depth-first)
    for (children) |child| {
        if (child > 0) {
            killProcessTreeRecursive(child, killed, current_pid, pass) catch {};
        }
    }

    // Use std.posix.SIG for platform-portable signal constants
    // (SIGSTOP=17 on macOS, 19 on Linux)
    switch (pass) {
        .sigterm => {
            // Pass 1: SIGTERM for graceful shutdown
            _ = std.c.kill(pid, std.posix.SIG.TERM);
        },
        .sigstop => {
            // Pass 2: SIGSTOP to freeze the process
            _ = std.c.kill(pid, std.posix.SIG.STOP);
        },
        .sigkill => {
            // Pass 3: SIGKILL to force termination
            _ = std.c.kill(pid, std.posix.SIG.KILL);
        },
    }
}

export fn Bun__autokillChildProcesses() void {
    killAllChildProcesses();
}

const std = @import("std");

const bun = @import("../bun.zig");
const Environment = bun.Environment;
