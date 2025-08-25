//! Linux container support for Bun.spawn
//! Provides ephemeral cgroupv2, rootless user namespaces, PID namespaces,
//! network namespaces, and optional overlayfs support.

const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const log = Output.scoped(.LinuxContainer, .visible);

pub const ContainerError = error{
    NotLinux,
    RequiresRoot,
    CgroupNotSupported,
    NamespaceNotSupported,
    OverlayfsNotSupported,
    InsufficientPrivileges,
    InvalidConfiguration,
    SystemCallFailed,
    MountFailed,
    NetworkSetupFailed,
    OutOfMemory,
};

pub const ContainerOptions = struct {
    /// Enable cgroup v2 isolation
    cgroup: bool = true,

    /// Enable rootless user namespace
    user_namespace: bool = true,

    /// Enable PID namespace isolation
    pid_namespace: bool = true,

    /// Enable network namespace isolation
    network_namespace: bool = true,

    /// Enable overlayfs support
    overlayfs: ?OverlayfsConfig = null,

    /// Memory limit in bytes (for cgroup)
    memory_limit: ?u64 = null,

    /// CPU limit as percentage (for cgroup)
    cpu_limit: ?f32 = null,

    /// Custom UID mapping for user namespace
    uid_map: ?[]const UidGidMap = null,

    /// Custom GID mapping for user namespace
    gid_map: ?[]const UidGidMap = null,
};

pub const OverlayfsConfig = struct {
    /// Upper directory (read-write layer)
    upper_dir: []const u8,

    /// Work directory (required by overlayfs)
    work_dir: []const u8,

    /// Lower directories (read-only layers)
    lower_dirs: []const []const u8,

    /// Mount point for the overlay
    mount_point: []const u8,
};

pub const UidGidMap = struct {
    /// ID inside namespace
    inside_id: u32,

    /// ID outside namespace
    outside_id: u32,

    /// Number of IDs to map
    length: u32,
};

/// Container context that manages the lifecycle of a containerized process
pub const ContainerContext = struct {
    const Self = @This();

    allocator: std.mem.Allocator,
    options: ContainerOptions,
    
    // Runtime state
    cgroup_path: ?[]u8 = null,
    mount_namespace_fd: ?std.posix.fd_t = null,
    pid_namespace_fd: ?std.posix.fd_t = null,
    net_namespace_fd: ?std.posix.fd_t = null,
    user_namespace_fd: ?std.posix.fd_t = null,
    overlay_mounted: bool = false,
    
    pub fn init(allocator: std.mem.Allocator, options: ContainerOptions) ContainerError!*Self {
        if (comptime !Environment.isLinux) {
            return ContainerError.NotLinux;
        }

        const self = try allocator.create(Self);
        self.* = Self{
            .allocator = allocator,
            .options = options,
        };

        return self;
    }

    pub fn deinit(self: *Self) void {
        self.cleanup();
        if (self.cgroup_path) |path| {
            self.allocator.free(path);
        }
        self.allocator.destroy(self);
    }

    /// Setup container environment before spawning process
    pub fn setup(self: *Self) ContainerError!void {
        log("Setting up container environment", .{});

        // Create cgroup if requested
        if (self.options.cgroup) {
            try self.setupCgroup();
        }

        // Create user namespace if requested
        if (self.options.user_namespace) {
            try self.setupUserNamespace();
        }

        // Create PID namespace if requested
        if (self.options.pid_namespace) {
            try self.setupPidNamespace();
        }

        // Create network namespace if requested
        if (self.options.network_namespace) {
            try self.setupNetworkNamespace();
        }

        // Setup overlayfs if requested
        if (self.options.overlayfs) |_| {
            try self.setupOverlayfs();
        }

        log("Container environment setup complete", .{});
    }

    /// Cleanup container resources
    pub fn cleanup(self: *Self) void {
        log("Cleaning up container environment", .{});

        // Unmount overlayfs if mounted
        if (self.overlay_mounted) {
            self.cleanupOverlayfs();
        }

        // Close namespace file descriptors
        if (self.mount_namespace_fd) |fd| {
            _ = std.c.close(fd);
            self.mount_namespace_fd = null;
        }
        if (self.pid_namespace_fd) |fd| {
            _ = std.c.close(fd);
            self.pid_namespace_fd = null;
        }
        if (self.net_namespace_fd) |fd| {
            _ = std.c.close(fd);
            self.net_namespace_fd = null;
        }
        if (self.user_namespace_fd) |fd| {
            _ = std.c.close(fd);
            self.user_namespace_fd = null;
        }

        // Remove cgroup
        if (self.cgroup_path) |path| {
            self.cleanupCgroup(path);
        }

        log("Container cleanup complete", .{});
    }

    fn setupCgroup(self: *Self) ContainerError!void {
        log("Setting up cgroup v2", .{});

        // Generate unique cgroup name
        var buf: [64]u8 = undefined;
        const pid = std.os.linux.getpid();
        const timestamp = @as(i64, @intCast(std.time.timestamp()));
        const cgroup_name = std.fmt.bufPrint(&buf, "bun-container-{d}-{d}", .{ pid, timestamp }) catch {
            return ContainerError.OutOfMemory;
        };

        // Create cgroup path
        const cgroup_base = "/sys/fs/cgroup";
        const full_path = std.fmt.allocPrint(self.allocator, "{s}/{s}", .{ cgroup_base, cgroup_name }) catch {
            return ContainerError.OutOfMemory;
        };
        
        self.cgroup_path = full_path;

        // Create cgroup directory
        std.fs.cwd().makeDir(full_path) catch |err| switch (err) {
            error.PathAlreadyExists => {},
            error.AccessDenied => return ContainerError.RequiresRoot,
            else => return ContainerError.CgroupNotSupported,
        };

        // Set memory limit if specified
        if (self.options.memory_limit) |limit| {
            try self.setCgroupLimit("memory.max", limit);
        }

        // Set CPU limit if specified
        if (self.options.cpu_limit) |limit| {
            const cpu_max = std.fmt.allocPrint(self.allocator, "{d} 100000", .{@as(u64, @intFromFloat(limit * 1000))}) catch {
                return ContainerError.OutOfMemory;
            };
            defer self.allocator.free(cpu_max);
            try self.setCgroupValue("cpu.max", cpu_max);
        }

        log("Cgroup v2 setup complete: {s}", .{full_path});
    }

    fn setCgroupLimit(self: *Self, controller: []const u8, limit: u64) ContainerError!void {
        const path = self.cgroup_path orelse return ContainerError.InvalidConfiguration;
        const control_file = std.fmt.allocPrint(self.allocator, "{s}/{s}", .{ path, controller }) catch {
            return ContainerError.OutOfMemory;
        };
        defer self.allocator.free(control_file);

        const value_str = std.fmt.allocPrint(self.allocator, "{d}", .{limit}) catch {
            return ContainerError.OutOfMemory;
        };
        defer self.allocator.free(value_str);

        try self.setCgroupValue(controller, value_str);
    }

    fn setCgroupValue(self: *Self, controller: []const u8, value: []const u8) ContainerError!void {
        const path = self.cgroup_path orelse return ContainerError.InvalidConfiguration;
        const control_file = std.fmt.allocPrint(self.allocator, "{s}/{s}", .{ path, controller }) catch {
            return ContainerError.OutOfMemory;
        };
        defer self.allocator.free(control_file);

        const file = std.fs.cwd().openFile(control_file, .{ .mode = .write_only }) catch {
            return ContainerError.CgroupNotSupported;
        };
        defer file.close();

        file.writeAll(value) catch {
            return ContainerError.CgroupNotSupported;
        };

        log("Set cgroup {s} = {s}", .{ controller, value });
    }

    fn setupUserNamespace(self: *Self) ContainerError!void {
        log("Setting up user namespace", .{});

        const flags = std.os.linux.CLONE.NEWUSER;
        const result = std.os.linux.unshare(flags);
        
        if (result != 0) {
            const errno = bun.sys.getErrno(result);
            log("unshare(CLONE_NEWUSER) failed: errno={}", .{errno});
            return ContainerError.NamespaceNotSupported;
        }

        // Setup default UID/GID mapping if not provided
        const uid_map = self.options.uid_map orelse &[_]UidGidMap{
            UidGidMap{ .inside_id = 0, .outside_id = std.os.linux.getuid(), .length = 1 },
        };
        
        const gid_map = self.options.gid_map orelse &[_]UidGidMap{
            UidGidMap{ .inside_id = 0, .outside_id = std.os.linux.getgid(), .length = 1 },
        };

        try self.writeUidGidMap("/proc/self/uid_map", uid_map);
        try self.writeUidGidMap("/proc/self/gid_map", gid_map);

        log("User namespace setup complete", .{});
    }

    fn writeUidGidMap(self: *Self, map_file: []const u8, mappings: []const UidGidMap) ContainerError!void {
        const file = std.fs.cwd().openFile(map_file, .{ .mode = .write_only }) catch {
            return ContainerError.NamespaceNotSupported;
        };
        defer file.close();

        for (mappings) |mapping| {
            const line = std.fmt.allocPrint(self.allocator, "{d} {d} {d}\n", .{
                mapping.inside_id, mapping.outside_id, mapping.length
            }) catch {
                return ContainerError.OutOfMemory;
            };
            defer self.allocator.free(line);

            file.writeAll(line) catch {
                return ContainerError.NamespaceNotSupported;
            };
        }
    }

    fn setupPidNamespace(self: *Self) ContainerError!void {
        _ = self; // suppress unused parameter warning
        log("Setting up PID namespace", .{});

        const flags = std.os.linux.CLONE.NEWPID;
        const result = std.os.linux.unshare(flags);
        
        if (result != 0) {
            const errno = bun.sys.getErrno(result);
            log("unshare(CLONE_NEWPID) failed: errno={}", .{errno});
            return ContainerError.NamespaceNotSupported;
        }

        log("PID namespace setup complete", .{});
    }

    fn setupNetworkNamespace(self: *Self) ContainerError!void {
        log("Setting up network namespace", .{});

        const flags = std.os.linux.CLONE.NEWNET;
        const result = std.os.linux.unshare(flags);
        
        if (result != 0) {
            const errno = bun.sys.getErrno(result);
            log("unshare(CLONE_NEWNET) failed: errno={}", .{errno});
            return ContainerError.NamespaceNotSupported;
        }

        // Setup loopback interface
        try self.setupLoopback();

        log("Network namespace setup complete", .{});
    }

    fn setupLoopback(self: *Self) ContainerError!void {
        // This is a simplified setup - in practice, you'd need to use netlink
        // to properly configure network interfaces in the namespace
        const result = std.process.Child.run(.{
            .allocator = self.allocator,
            .argv = &[_][]const u8{ "ip", "link", "set", "lo", "up" },
        }) catch {
            return ContainerError.NetworkSetupFailed;
        };
        defer self.allocator.free(result.stdout);
        defer self.allocator.free(result.stderr);

        if (result.term != .Exited or result.term.Exited != 0) {
            log("Failed to setup loopback interface", .{});
            return ContainerError.NetworkSetupFailed;
        }
    }

    fn setupOverlayfs(self: *Self) ContainerError!void {
        const config = self.options.overlayfs orelse return ContainerError.InvalidConfiguration;
        log("Setting up overlayfs mount", .{});

        // Create mount namespace first
        const flags = std.os.linux.CLONE.NEWNS;
        const result = std.os.linux.unshare(flags);
        
        if (result != 0) {
            const errno = bun.sys.getErrno(result);
            log("unshare(CLONE_NEWNS) failed: errno={}", .{errno});
            return ContainerError.NamespaceNotSupported;
        }

        // Create directories if they don't exist
        std.fs.cwd().makePath(config.upper_dir) catch {};
        std.fs.cwd().makePath(config.work_dir) catch {};
        std.fs.cwd().makePath(config.mount_point) catch {};

        // Build lowerdir string
        const lowerdir = try std.mem.join(self.allocator, ":", config.lower_dirs);
        defer self.allocator.free(lowerdir);

        // Build mount options
        const options = std.fmt.allocPrint(self.allocator, 
            "lowerdir={s},upperdir={s},workdir={s}", 
            .{ lowerdir, config.upper_dir, config.work_dir }
        ) catch {
            return ContainerError.OutOfMemory;
        };
        defer self.allocator.free(options);

        // Mount overlayfs - need to convert strings to null-terminated
        const cstr_mount_point = std.fmt.allocPrintZ(self.allocator, "{s}", .{config.mount_point}) catch return ContainerError.OutOfMemory;
        defer self.allocator.free(cstr_mount_point);
        
        const mount_result = std.os.linux.mount("overlay", cstr_mount_point, "overlay", 0, @intFromPtr(options.ptr));
        if (mount_result != 0) {
            const errno = bun.sys.getErrno(mount_result);
            log("overlayfs mount failed: errno={}", .{errno});
            return ContainerError.MountFailed;
        }

        self.overlay_mounted = true;
        log("Overlayfs mount complete: {s}", .{config.mount_point});
    }

    fn cleanupOverlayfs(self: *Self) void {
        const config = self.options.overlayfs orelse return;
        log("Cleaning up overlayfs mount", .{});

        const cstr_mount_point = std.fmt.allocPrintZ(std.heap.page_allocator, "{s}", .{config.mount_point}) catch return;
        defer std.heap.page_allocator.free(cstr_mount_point);
        
        const umount_result = std.os.linux.umount(cstr_mount_point);
        if (umount_result != 0) {
            const errno = bun.sys.getErrno(umount_result);
            log("overlayfs umount failed: errno={}", .{errno});
        }

        self.overlay_mounted = false;
    }

    fn cleanupCgroup(self: *Self, path: []const u8) void {
        _ = self; // suppress unused parameter warning
        log("Cleaning up cgroup: {s}", .{path});
        
        std.fs.cwd().deleteDir(path) catch |err| {
            log("Failed to remove cgroup directory {s}: {}", .{ path, err });
        };
    }

    /// Add current process to the container's cgroup
    pub fn addProcessToCgroup(self: *Self, pid: std.posix.pid_t) ContainerError!void {
        const path = self.cgroup_path orelse return ContainerError.InvalidConfiguration;
        const procs_file = std.fmt.allocPrint(self.allocator, "{s}/cgroup.procs", .{path}) catch {
            return ContainerError.OutOfMemory;
        };
        defer self.allocator.free(procs_file);

        const file = std.fs.cwd().openFile(procs_file, .{ .mode = .write_only }) catch {
            return ContainerError.CgroupNotSupported;
        };
        defer file.close();

        const pid_str = std.fmt.allocPrint(self.allocator, "{d}", .{pid}) catch {
            return ContainerError.OutOfMemory;
        };
        defer self.allocator.free(pid_str);

        file.writeAll(pid_str) catch {
            return ContainerError.CgroupNotSupported;
        };

        log("Added PID {d} to cgroup {s}", .{ pid, path });
    }
};

/// Check if the system supports containers
pub fn isContainerSupported() bool {
    if (comptime !Environment.isLinux) {
        return false;
    }

    // Check for cgroup v2 support
    if (!std.fs.cwd().access("/sys/fs/cgroup/cgroup.controllers", .{})) {
        return false;
    } else |_| {}

    // Check for namespace support
    if (!std.fs.cwd().access("/proc/self/ns/user", .{})) {
        return false;
    } else |_| {}

    return true;
}