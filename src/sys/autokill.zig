const std = @import("std");
const bun = @import("../bun.zig");
const Environment = bun.Environment;

pub fn killAllChildProcesses() void {
    if (Environment.isWindows) {
        // Windows already uses Job Objects which automatically kill children on exit
        // This is a no-op
        return;
    }

    var killed = std.AutoHashMap(c_int, void).init(bun.default_allocator);
    defer killed.deinit();

    const current_pid = std.c.getpid();
    const children = getChildPids(current_pid) catch return;
    defer if (children.len > 0) bun.default_allocator.free(children);

    // Kill each child tree recursively
    for (children) |child| {
        killProcessTreeRecursive(child, &killed) catch {};
    }
}

fn getChildPids(parent: c_int) ![]c_int {
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
            return getChildPidsFallback(parent);
        };
        defer file.close();

        const contents = file.readToEndAlloc(bun.default_allocator, 4096) catch return &[_]c_int{};
        defer bun.default_allocator.free(contents);

        var list = std.ArrayList(c_int).init(bun.default_allocator);
        var iter = std.mem.tokenize(u8, contents, " \n");
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
        
        const current_pid = std.c.getpid();
        for (pids[0..count]) |pid| {
            if (pid > 0 and pid != current_pid) {
                list.append(pid) catch continue;
            }
        }
        
        return list.toOwnedSlice();
    }
    
    return &[_]c_int{};
}

fn getChildPidsFallback(parent: c_int) ![]c_int {
    // Fallback for older Linux kernels: scan /proc
    var list = std.ArrayList(c_int).init(bun.default_allocator);
    
    var proc_dir = std.fs.openDirAbsolute("/proc", .{ .iterate = true }) catch return list.toOwnedSlice();
    defer proc_dir.close();
    
    var iter = proc_dir.iterate();
    while (try iter.next()) |entry| {
        const pid = std.fmt.parseInt(c_int, entry.name, 10) catch continue;
        if (pid <= 0 or pid == parent) continue;
        
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
        var parts = std.mem.tokenize(u8, after_comm, " ");
        _ = parts.next(); // skip state
        const ppid_str = parts.next() orelse continue;
        const ppid = std.fmt.parseInt(c_int, ppid_str, 10) catch continue;
        
        if (ppid == parent) {
            list.append(pid) catch continue;
        }
    }
    
    return list.toOwnedSlice();
}

fn killProcessTreeRecursive(pid: c_int, killed: *std.AutoHashMap(c_int, void)) !void {
    const current_pid = std.c.getpid();
    
    // Avoid cycles and killing ourselves
    if (killed.contains(pid) or pid == current_pid) {
        return;
    }
    try killed.put(pid, {});
    
    // Get children and kill them recursively
    const children = try getChildPids(pid);
    defer if (children.len > 0) bun.default_allocator.free(children);
    
    for (children) |child| {
        if (child > 0) {
            killProcessTreeRecursive(child, killed) catch {};
        }
    }
    
    // Kill this process
    _ = std.c.kill(pid, 9); // SIGKILL
}

export fn Bun__autokillChildProcesses() void {
    killAllChildProcesses();
}
