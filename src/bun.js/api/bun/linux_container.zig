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
    CgroupV2NotAvailable,
    NamespaceNotSupported,
    UserNamespaceNotSupported,
    PidNamespaceNotSupported,
    NetworkNamespaceNotSupported,
    MountNamespaceNotSupported,
    OverlayfsNotSupported,
    TmpfsNotSupported,
    BindMountNotSupported,
    InsufficientPrivileges,
    InvalidConfiguration,
    SystemCallFailed,
    MountFailed,
    NetworkSetupFailed,
    Clone3NotSupported,
    OutOfMemory,
};

pub const ContainerOptions = struct {
    /// Namespace options
    namespace: ?NamespaceOptions = null,

    /// Filesystem mounts
    fs: ?[]const FilesystemMount = null,

    /// Resource limits
    limit: ?ResourceLimits = null,
};

pub const NamespaceOptions = struct {
    /// Enable PID namespace isolation
    pid: ?bool = null,

    /// Enable user namespace with optional UID/GID mapping
    user: ?UserNamespaceConfig = null,

    /// Enable network namespace with optional configuration
    network: ?NetworkNamespaceConfig = null,
};

pub const UserNamespaceConfig = union(enum) {
    /// Enable with default mapping (current UID/GID mapped to root)
    enable: bool,
    /// Custom UID/GID mapping
    custom: struct {
        uid_map: []const UidGidMap,
        gid_map: []const UidGidMap,
    },
};

pub const NetworkNamespaceConfig = union(enum) {
    /// Enable with loopback only
    enable: bool,
    // Future: could add bridge networking, port forwarding, etc.
};

pub const FilesystemMount = struct {
    type: FilesystemType,
    /// Source path (for bind mounts and overlayfs lower dirs)
    from: ?[]const u8 = null,
    /// Target mount point
    to: []const u8,
    /// Options specific to the filesystem type
    options: ?FilesystemOptions = null,
};

pub const FilesystemType = enum {
    overlayfs,
    tmpfs,
    bind,
};

pub const FilesystemOptions = union(enum) {
    overlayfs: OverlayfsOptions,
    tmpfs: TmpfsOptions,
    bind: BindOptions,
};

pub const OverlayfsOptions = struct {
    /// Upper directory (read-write layer)
    upper_dir: []const u8,
    /// Work directory (required by overlayfs)
    work_dir: []const u8,
    /// Lower directories (read-only layers)
    lower_dirs: []const []const u8,
};

pub const TmpfsOptions = struct {
    /// Size limit for tmpfs
    size: ?u64 = null,
    /// Mount options (e.g., "noexec,nosuid")
    options: ?[]const u8 = null,
};

pub const BindOptions = struct {
    /// Read-only bind mount
    readonly: bool = false,
};

pub const ResourceLimits = struct {
    /// CPU limit as percentage (0-100)
    cpu: ?f32 = null,
    /// Memory limit in bytes
    ram: ?u64 = null,
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
    // Track mounted filesystems for cleanup
    mounted_paths: std.ArrayList([]const u8),
    // Track if cgroup needs cleanup
    cgroup_created: bool = false,
    
    pub fn init(allocator: std.mem.Allocator, options: ContainerOptions) ContainerError!*Self {
        if (comptime !Environment.isLinux) {
            return ContainerError.NotLinux;
        }

        const self = try allocator.create(Self);
        self.* = Self{
            .allocator = allocator,
            .options = options,
            .mounted_paths = std.ArrayList([]const u8).init(allocator),
        };

        return self;
    }

    pub fn deinit(self: *Self) void {
        // Cleanup is crucial - must happen before deallocation
        self.cleanup();
        if (self.cgroup_path) |path| {
            self.allocator.free(path);
        }
        // Free mounted paths list
        for (self.mounted_paths.items) |path| {
            self.allocator.free(path);
        }
        self.mounted_paths.deinit();
        self.allocator.destroy(self);
    }

    /// Setup container environment before spawning process
    pub fn setup(self: *Self) ContainerError!void {
        log("Setting up container environment", .{});

        // Setup namespaces if requested
        if (self.options.namespace) |ns_opts| {
            // User namespace should be created first for rootless operation
            if (ns_opts.user) |user_config| {
                try self.setupUserNamespace(user_config);
            }

            // PID namespace
            if (ns_opts.pid) |enable_pid| {
                if (enable_pid) {
                    try self.setupPidNamespace();
                }
            }

            // Network namespace
            if (ns_opts.network) |net_config| {
                try self.setupNetworkNamespace(net_config);
            }
        }

        // Setup filesystem mounts
        if (self.options.fs) |mounts| {
            // Create mount namespace first if we have any mounts
            if (mounts.len > 0) {
                try self.setupMountNamespace();
                for (mounts) |mount| {
                    try self.setupFilesystemMount(mount);
                }
            }
        }

        // Setup resource limits (cgroup)
        if (self.options.limit) |limits| {
            if (limits.cpu != null or limits.ram != null) {
                try self.setupCgroup(limits);
            }
        }

        log("Container environment setup complete", .{});
    }

    /// Cleanup container resources - MUST be called when subprocess exits
    pub fn cleanup(self: *Self) void {
        log("Cleaning up container environment", .{});

        // Unmount filesystems in reverse order (important!)
        var i = self.mounted_paths.items.len;
        while (i > 0) {
            i -= 1;
            const path = self.mounted_paths.items[i];
            self.unmountPath(path);
        }
        self.mounted_paths.clearRetainingCapacity();

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

        // Remove cgroup - this must be last to ensure all processes have exited
        if (self.cgroup_created and self.cgroup_path != null) {
            self.cleanupCgroup();
        }

        log("Container cleanup complete", .{});
    }

    fn setupMountNamespace(self: *Self) ContainerError!void {
        _ = self; // Currently unused
        log("Setting up mount namespace", .{});

        const flags = std.os.linux.CLONE.NEWNS;
        const result = std.os.linux.unshare(flags);
        
        if (result != 0) {
            const errno = bun.sys.getErrno(result);
            log("unshare(CLONE_NEWNS) failed: errno={}", .{errno});
            switch (errno) {
                .PERM => return ContainerError.InsufficientPrivileges,
                .NOSYS => return ContainerError.MountNamespaceNotSupported,
                else => return ContainerError.NamespaceNotSupported,
            }
        }

        log("Mount namespace setup complete", .{});
    }

    fn setupFilesystemMount(self: *Self, mount: FilesystemMount) ContainerError!void {
        switch (mount.type) {
            .overlayfs => {
                const opts = mount.options orelse return ContainerError.InvalidConfiguration;
                if (opts != .overlayfs) return ContainerError.InvalidConfiguration;
                try self.setupOverlayfs(mount.to, opts.overlayfs);
            },
            .tmpfs => {
                const opts = if (mount.options) |o| if (o == .tmpfs) o.tmpfs else return ContainerError.InvalidConfiguration else TmpfsOptions{};
                try self.setupTmpfs(mount.to, opts);
            },
            .bind => {
                const from = mount.from orelse return ContainerError.InvalidConfiguration;
                const opts = if (mount.options) |o| if (o == .bind) o.bind else return ContainerError.InvalidConfiguration else BindOptions{};
                try self.setupBindMount(from, mount.to, opts);
            },
        }
    }

    fn setupCgroup(self: *Self, limits: ResourceLimits) ContainerError!void {
        log("Setting up cgroup v2 with limits", .{});

        // Check if cgroupv2 is available
        std.fs.cwd().access("/sys/fs/cgroup/cgroup.controllers", .{}) catch {
            return ContainerError.CgroupV2NotAvailable;
        };

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
            error.AccessDenied => return ContainerError.InsufficientPrivileges,
            else => return ContainerError.CgroupNotSupported,
        };
        
        self.cgroup_created = true;

        // Set memory limit if specified
        if (limits.ram) |ram_limit| {
            try self.setCgroupLimit("memory.max", ram_limit);
        }

        // Set CPU limit if specified
        if (limits.cpu) |cpu_limit| {
            // CPU limit is a percentage (0-100), convert to cgroup format
            // cgroup2 cpu.max format: "$MAX $PERIOD" where both are in microseconds
            const period: u64 = 100000; // 100ms period
            const max = @as(u64, @intFromFloat(cpu_limit * @as(f32, @floatFromInt(period)) / 100.0));
            const cpu_max = std.fmt.allocPrint(self.allocator, "{d} {d}", .{ max, period }) catch {
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

    fn setupUserNamespace(self: *Self, config: UserNamespaceConfig) ContainerError!void {
        log("Setting up user namespace", .{});

        const flags = std.os.linux.CLONE.NEWUSER;
        const result = std.os.linux.unshare(flags);
        
        if (result != 0) {
            const errno = bun.sys.getErrno(result);
            log("unshare(CLONE_NEWUSER) failed: errno={}", .{errno});
            switch (errno) {
                .PERM => return ContainerError.InsufficientPrivileges,
                .NOSYS => return ContainerError.UserNamespaceNotSupported,
                .INVAL => return ContainerError.UserNamespaceNotSupported,
                else => return ContainerError.NamespaceNotSupported,
            }
        }

        // Setup UID/GID mapping based on config
        const uid_map: []const UidGidMap = switch (config) {
            .enable => &[_]UidGidMap{
                UidGidMap{ .inside_id = 0, .outside_id = std.os.linux.getuid(), .length = 1 },
            },
            .custom => |custom| custom.uid_map,
        };
        
        const gid_map: []const UidGidMap = switch (config) {
            .enable => &[_]UidGidMap{
                UidGidMap{ .inside_id = 0, .outside_id = std.os.linux.getgid(), .length = 1 },
            },
            .custom => |custom| custom.gid_map,
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
            switch (errno) {
                .PERM => return ContainerError.InsufficientPrivileges,
                .NOSYS => return ContainerError.PidNamespaceNotSupported,
                .INVAL => return ContainerError.PidNamespaceNotSupported,
                else => return ContainerError.NamespaceNotSupported,
            }
        }

        log("PID namespace setup complete", .{});
    }

    fn setupNetworkNamespace(self: *Self, config: NetworkNamespaceConfig) ContainerError!void {
        log("Setting up network namespace", .{});

        const flags = std.os.linux.CLONE.NEWNET;
        const result = std.os.linux.unshare(flags);
        
        if (result != 0) {
            const errno = bun.sys.getErrno(result);
            log("unshare(CLONE_NEWNET) failed: errno={}", .{errno});
            switch (errno) {
                .PERM => return ContainerError.InsufficientPrivileges,
                .NOSYS => return ContainerError.NetworkNamespaceNotSupported,
                .INVAL => return ContainerError.NetworkNamespaceNotSupported,
                else => return ContainerError.NamespaceNotSupported,
            }
        }

        // Setup loopback interface based on config
        switch (config) {
            .enable => try self.setupLoopback(),
            // Future: handle advanced network configs here
        }

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

    fn setupOverlayfs(self: *Self, mount_point: []const u8, config: OverlayfsOptions) ContainerError!void {
        log("Setting up overlayfs mount at {s}", .{mount_point});

        // Create directories if they don't exist
        std.fs.cwd().makePath(config.upper_dir) catch {};
        std.fs.cwd().makePath(config.work_dir) catch {};
        std.fs.cwd().makePath(mount_point) catch {};

        // Build lowerdir string
        const lowerdir = std.mem.join(self.allocator, ":", config.lower_dirs) catch {
            return ContainerError.OutOfMemory;
        };
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
        const cstr_mount_point = std.fmt.allocPrintZ(self.allocator, "{s}", .{mount_point}) catch return ContainerError.OutOfMemory;
        defer self.allocator.free(cstr_mount_point);
        const cstr_options = std.fmt.allocPrintZ(self.allocator, "{s}", .{options}) catch return ContainerError.OutOfMemory;
        defer self.allocator.free(cstr_options);
        
        const mount_result = std.os.linux.mount("overlay", cstr_mount_point, "overlay", 0, @intFromPtr(cstr_options.ptr));
        if (mount_result != 0) {
            const errno = bun.sys.getErrno(mount_result);
            log("overlayfs mount failed: errno={}", .{errno});
            switch (errno) {
                .PERM => return ContainerError.InsufficientPrivileges,
                .NOSYS => return ContainerError.OverlayfsNotSupported,
                else => return ContainerError.MountFailed,
            }
        }

        // Track mounted path for cleanup
        const mount_copy = self.allocator.dupe(u8, mount_point) catch return ContainerError.OutOfMemory;
        self.mounted_paths.append(mount_copy) catch return ContainerError.OutOfMemory;

        log("Overlayfs mount complete: {s}", .{mount_point});
    }

    fn setupTmpfs(self: *Self, mount_point: []const u8, config: TmpfsOptions) ContainerError!void {
        log("Setting up tmpfs mount at {s}", .{mount_point});

        // Create mount point if it doesn't exist
        std.fs.cwd().makePath(mount_point) catch {};

        // Build mount options
        var options_buf: [256]u8 = undefined;
        const options = if (config.size) |size| blk: {
            const base_opts = if (config.options) |opts| opts else "";
            const separator = if (base_opts.len > 0) "," else "";
            break :blk std.fmt.bufPrint(&options_buf, "{s}{s}size={d}", .{ base_opts, separator, size }) catch {
                return ContainerError.OutOfMemory;
            };
        } else config.options orelse "";

        // Mount tmpfs
        const cstr_mount_point = std.fmt.allocPrintZ(self.allocator, "{s}", .{mount_point}) catch return ContainerError.OutOfMemory;
        defer self.allocator.free(cstr_mount_point);
        const cstr_options = if (options.len > 0) 
            std.fmt.allocPrintZ(self.allocator, "{s}", .{options}) catch return ContainerError.OutOfMemory
        else null;
        defer if (cstr_options) |opts| self.allocator.free(opts);
        
        const mount_result = std.os.linux.mount(
            "tmpfs", 
            cstr_mount_point, 
            "tmpfs", 
            0, 
            if (cstr_options) |opts| @intFromPtr(opts.ptr) else 0
        );
        if (mount_result != 0) {
            const errno = bun.sys.getErrno(mount_result);
            log("tmpfs mount failed: errno={}", .{errno});
            switch (errno) {
                .PERM => return ContainerError.InsufficientPrivileges,
                .NOSYS => return ContainerError.TmpfsNotSupported,
                else => return ContainerError.MountFailed,
            }
        }

        // Track mounted path for cleanup
        const mount_copy = self.allocator.dupe(u8, mount_point) catch return ContainerError.OutOfMemory;
        self.mounted_paths.append(mount_copy) catch return ContainerError.OutOfMemory;

        log("Tmpfs mount complete: {s}", .{mount_point});
    }

    fn setupBindMount(self: *Self, source: []const u8, target: []const u8, config: BindOptions) ContainerError!void {
        log("Setting up bind mount from {s} to {s}", .{ source, target });

        // Verify source exists
        std.fs.cwd().access(source, .{}) catch {
            return ContainerError.InvalidConfiguration;
        };

        // Create target if it doesn't exist
        if (std.fs.cwd().statFile(source)) |stat| {
            if (stat.kind == .directory) {
                std.fs.cwd().makePath(target) catch {};
            } else {
                // For files, create parent directory and touch file
                if (std.fs.path.dirname(target)) |parent| {
                    std.fs.cwd().makePath(parent) catch {};
                }
                if (std.fs.cwd().createFile(target, .{})) |file| {
                    file.close();
                } else |_| {}
            }
        } else |_| {}

        // Mount bind
        const cstr_source = std.fmt.allocPrintZ(self.allocator, "{s}", .{source}) catch return ContainerError.OutOfMemory;
        defer self.allocator.free(cstr_source);
        const cstr_target = std.fmt.allocPrintZ(self.allocator, "{s}", .{target}) catch return ContainerError.OutOfMemory;
        defer self.allocator.free(cstr_target);
        
        const flags: u32 = std.os.linux.MS.BIND | (if (config.readonly) @as(u32, std.os.linux.MS.RDONLY) else @as(u32, 0));
        const mount_result = std.os.linux.mount(cstr_source, cstr_target, "", flags, 0);
        if (mount_result != 0) {
            const errno = bun.sys.getErrno(mount_result);
            log("bind mount failed: errno={}", .{errno});
            switch (errno) {
                .PERM => return ContainerError.InsufficientPrivileges,
                .NOSYS => return ContainerError.BindMountNotSupported,
                else => return ContainerError.MountFailed,
            }
        }

        // If readonly, remount to apply the flag
        if (config.readonly) {
            const remount_result = std.os.linux.mount("", cstr_target, "", std.os.linux.MS.BIND | std.os.linux.MS.REMOUNT | std.os.linux.MS.RDONLY, 0);
            if (remount_result != 0) {
                log("Failed to remount as readonly, continuing anyway", .{});
            }
        }

        // Track mounted path for cleanup
        const mount_copy = self.allocator.dupe(u8, target) catch return ContainerError.OutOfMemory;
        self.mounted_paths.append(mount_copy) catch return ContainerError.OutOfMemory;

        log("Bind mount complete: {s} -> {s}", .{ source, target });
    }

    fn unmountPath(self: *Self, path: []const u8) void {
        _ = self;
        log("Unmounting {s}", .{path});

        const cstr_path = std.fmt.allocPrintZ(std.heap.page_allocator, "{s}", .{path}) catch return;
        defer std.heap.page_allocator.free(cstr_path);
        
        // Try unmount with MNT_DETACH flag for forceful cleanup
        const umount_result = std.os.linux.umount2(cstr_path, std.os.linux.MNT.DETACH);
        if (umount_result != 0) {
            const errno = bun.sys.getErrno(umount_result);
            log("umount failed for {s}: errno={}", .{ path, errno });
            // Continue cleanup even if unmount fails
        }
    }

    fn cleanupCgroup(self: *Self) void {
        const path = self.cgroup_path orelse return;
        log("Cleaning up cgroup: {s}", .{path});
        
        // Freeze the cgroup first to prevent any new processes from being created
        // This helps avoid race conditions during cleanup
        const freeze_file = std.fmt.allocPrint(self.allocator, "{s}/cgroup.freeze", .{path}) catch {
            // If we can't allocate, just try to remove directly
            std.fs.cwd().deleteDir(path) catch |err| {
                log("Warning: cgroup directory {s} not removed: {}", .{ path, err });
            };
            self.cgroup_created = false;
            return;
        };
        defer self.allocator.free(freeze_file);
        
        // Try to freeze the cgroup (this prevents new processes from starting)
        if (std.fs.cwd().openFile(freeze_file, .{ .mode = .write_only })) |file| {
            _ = file.write("1") catch {};
            file.close();
        } else |_| {}
        
        // If we have cgroup.kill (Linux 5.14+), use it
        const kill_file = std.fmt.allocPrint(self.allocator, "{s}/cgroup.kill", .{path}) catch {
            // Just try to remove
            std.fs.cwd().deleteDir(path) catch |err| {
                log("Warning: cgroup directory {s} not removed: {}", .{ path, err });
            };
            self.cgroup_created = false;
            return;
        };
        defer self.allocator.free(kill_file);
        
        if (std.fs.cwd().openFile(kill_file, .{ .mode = .write_only })) |file| {
            _ = file.write("1") catch {};
            file.close();
            // Give processes a moment to die
            std.time.sleep(10 * std.time.ns_per_ms);
        } else |_| {}
        
        // Try to remove the cgroup directory
        // This will succeed if all processes are gone
        std.fs.cwd().deleteDir(path) catch |err| {
            log("Warning: cgroup directory {s} not removed: {} (abandoned)", .{ path, err });
            // The cgroup will persist but at least it's frozen and empty
            // This is the best we can do without elevated privileges
        };
        
        self.cgroup_created = false;
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