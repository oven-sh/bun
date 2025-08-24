const std = @import("std");
const bun = @import("../bun.zig");
const Environment = bun.Environment;

pub fn killAllChildProcesses() void {
    if (Environment.isWindows) {
        // Windows already uses Job Objects which automatically kill children on exit
        // This is a no-op
        return;
    }

    const current_pid = std.c.getpid();
    
    // First, try to kill the entire process group - this is more reliable 
    // on musl systems where process tree detection may be inconsistent
    _ = std.c.kill(-current_pid, 15); // SIGTERM to entire process group
    
    // Give processes a brief moment to exit gracefully
    std.time.sleep(50 * std.time.ns_per_ms);
    
    // Follow up with SIGKILL to ensure termination
    _ = std.c.kill(-current_pid, 9); // SIGKILL to entire process group
    
    // Also walk the process tree as backup for any processes not in our process group
    var killed = std.AutoHashMap(c_int, void).init(bun.default_allocator);
    defer killed.deinit();

    const children = getChildPids(current_pid, current_pid) catch return;
    defer if (children.len > 0) bun.default_allocator.free(children);

    // Kill remaining processes in the tree
    for (children) |child| {
        killProcessTreeRecursive(child, &killed, current_pid, false) catch {};
    }
}

fn getChildPids(parent: c_int, current_pid: c_int) ![]c_int {
    if (Environment.isLinux) {
        // Try /proc/{pid}/task/{tid}/children first (most efficient)
        const children_path = std.fmt.allocPrint(
            bun.default_allocator,
            "/proc/{d}/task/{d}/children",
            .{ parent, parent },
        ) catch return &[_]c_int{};
        defer bun.default_allocator.free(children_path);

        const file = std.fs.openFileAbsolute(children_path, .{}) catch {
            // Fallback to scanning /proc (older kernels)
            return getChildPidsFallback(parent, current_pid);
        };
        defer file.close();

        const contents = file.readToEndAlloc(bun.default_allocator, 4096) catch return &[_]c_int{};
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

fn killProcessTreeRecursive(pid: c_int, killed: *std.AutoHashMap(c_int, void), current_pid: c_int, stop_only: bool) !void {
    // Avoid cycles and killing ourselves
    if (killed.contains(pid) or pid == current_pid or pid <= 0) {
        return;
    }
    try killed.put(pid, {});
    
    // Get children first to avoid race conditions where killing the parent
    // might prevent us from finding the children
    const children = getChildPids(pid, current_pid) catch return;
    defer if (children.len > 0) bun.default_allocator.free(children);
    
    // Process children first (depth-first)
    for (children) |child| {
        if (child > 0) {
            killProcessTreeRecursive(child, killed, current_pid, stop_only) catch {};
        }
    }
    
    if (stop_only) {
        // First pass: SIGSTOP to freeze the process tree
        _ = std.c.kill(pid, 19); // SIGSTOP
    } else {
        // Second pass: try multiple signals to ensure the process dies
        _ = std.c.kill(pid, 15); // SIGTERM first
        std.time.sleep(5 * std.time.ns_per_ms); // Brief delay
        _ = std.c.kill(pid, 9); // SIGKILL to ensure it dies
    }
}

export fn Bun__autokillChildProcesses() void {
    killAllChildProcesses();
}
