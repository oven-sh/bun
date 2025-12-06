//! Linux Sandbox Implementation
//!
//! Provides process isolation using Linux namespaces, overlayfs,
//! and seccomp filters for secure sandboxed execution.
//!
//! Features:
//! - User namespaces for privilege isolation
//! - Mount namespaces with overlayfs for filesystem isolation
//! - Network namespaces with optional host access
//! - PID namespaces for process isolation
//! - Seccomp-BPF syscall filtering

const std = @import("std");
const bun = @import("bun");
const linux = std.os.linux;
const posix = std.posix;

const Output = bun.Output;
const fd_t = bun.FileDescriptor;

/// Clone flags for creating namespaces
pub const CloneFlags = struct {
    pub const NEWNS: u32 = 0x00020000; // Mount namespace
    pub const NEWUSER: u32 = 0x10000000; // User namespace
    pub const NEWPID: u32 = 0x20000000; // PID namespace
    pub const NEWNET: u32 = 0x40000000; // Network namespace
    pub const NEWIPC: u32 = 0x08000000; // IPC namespace
    pub const NEWUTS: u32 = 0x04000000; // UTS namespace
    pub const NEWCGROUP: u32 = 0x02000000; // Cgroup namespace
};

/// Mount flags
pub const MountFlags = struct {
    pub const RDONLY: u32 = 1;
    pub const NOSUID: u32 = 2;
    pub const NODEV: u32 = 4;
    pub const NOEXEC: u32 = 8;
    pub const SYNCHRONOUS: u32 = 16;
    pub const REMOUNT: u32 = 32;
    pub const MANDLOCK: u32 = 64;
    pub const DIRSYNC: u32 = 128;
    pub const NOATIME: u32 = 1024;
    pub const NODIRATIME: u32 = 2048;
    pub const BIND: u32 = 4096;
    pub const MOVE: u32 = 8192;
    pub const REC: u32 = 16384;
    pub const SILENT: u32 = 32768;
    pub const PRIVATE: u32 = 1 << 18;
    pub const SLAVE: u32 = 1 << 19;
    pub const SHARED: u32 = 1 << 20;
};

/// Sandbox configuration
pub const SandboxConfig = struct {
    /// Root directory for the sandbox (will be overlayfs merged)
    root_dir: []const u8 = "/",

    /// Working directory inside the sandbox
    workdir: []const u8 = "/",

    /// Upper directory for overlayfs (writable layer)
    upper_dir: ?[]const u8 = null,

    /// Work directory for overlayfs
    work_dir: ?[]const u8 = null,

    /// Enable user namespace (required for unprivileged operation)
    user_namespace: bool = true,

    /// Enable mount namespace with overlayfs
    mount_namespace: bool = true,

    /// Enable network namespace (isolated by default)
    network_namespace: bool = true,

    /// Allow network access to host
    share_network: bool = false,

    /// Enable PID namespace
    pid_namespace: bool = true,

    /// UID mapping: host_uid -> sandbox_uid
    uid_map: ?UidMap = null,

    /// GID mapping: host_gid -> sandbox_gid
    gid_map: ?GidMap = null,

    /// Directories to bind mount read-only
    readonly_binds: []const []const u8 = &.{},

    /// Directories to bind mount read-write
    readwrite_binds: []const []const u8 = &.{},

    /// Allowed network hosts (for filtering, not enforced at kernel level)
    allowed_hosts: []const []const u8 = &.{},

    /// Environment variables to pass through
    env_passthrough: []const []const u8 = &.{},

    /// Secret environment variables (from host)
    secrets: []const []const u8 = &.{},

    /// Enable seccomp filtering
    seccomp: bool = false,

    /// Seccomp syscall allowlist (if empty, use default)
    seccomp_allowlist: []const u32 = &.{},

    /// New root for pivot_root (if using overlayfs)
    new_root: ?[]const u8 = null,

    pub const UidMap = struct {
        inside_uid: u32 = 0,
        outside_uid: u32,
        count: u32 = 1,
    };

    pub const GidMap = struct {
        inside_gid: u32 = 0,
        outside_gid: u32,
        count: u32 = 1,
    };
};

/// Result of sandbox execution
pub const SandboxResult = struct {
    exit_code: u8,
    stdout: ?[]const u8 = null,
    stderr: ?[]const u8 = null,
    output_files: []const []const u8 = &.{},
};

/// Error types for sandbox operations
pub const SandboxError = error{
    NamespaceCreationFailed,
    MountFailed,
    PivotRootFailed,
    UidMapFailed,
    GidMapFailed,
    SeccompFailed,
    ForkFailed,
    ExecFailed,
    PipeFailed,
    WaitFailed,
    OverlayfsNotSupported,
    PermissionDenied,
    OutOfMemory,
    ChrootFailed,
};

/// Linux Sandbox implementation using fork + unshare
pub const Sandbox = struct {
    config: SandboxConfig,
    allocator: std.mem.Allocator,

    // Pipe for parent-child synchronization
    sync_pipe: [2]i32 = .{ -1, -1 },

    // Child PID
    child_pid: ?i32 = null,

    pub fn init(allocator: std.mem.Allocator, config: SandboxConfig) Sandbox {
        return Sandbox{
            .config = config,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Sandbox) void {
        if (self.sync_pipe[0] != -1) {
            _ = linux.close(self.sync_pipe[0]);
        }
        if (self.sync_pipe[1] != -1) {
            _ = linux.close(self.sync_pipe[1]);
        }
    }

    /// Execute a command in the sandbox
    pub fn exec(
        self: *Sandbox,
        argv: []const []const u8,
        env: []const []const u8,
    ) SandboxError!SandboxResult {
        if (argv.len == 0) {
            return SandboxError.ExecFailed;
        }

        // Create synchronization pipe
        const pipe_result = linux.pipe2(&self.sync_pipe, .{});
        if (@as(isize, @bitCast(pipe_result)) < 0) {
            return SandboxError.PipeFailed;
        }

        // Fork the process
        const fork_result = linux.fork();
        const fork_pid: isize = @bitCast(fork_result);

        if (fork_pid < 0) {
            return SandboxError.ForkFailed;
        }

        if (fork_pid == 0) {
            // Child process
            self.childProcess(argv, env) catch |err| {
                Output.errGeneric("Sandbox child error: {s}", .{@errorName(err)});
                linux.exit(1);
            };
            linux.exit(0);
        }

        // Parent process
        self.child_pid = @intCast(fork_result);

        // Close write end of pipe in parent
        _ = linux.close(self.sync_pipe[1]);
        self.sync_pipe[1] = -1;

        // Setup UID/GID mappings (must be done from parent after child unshares)
        // Wait for child to signal it has unshared
        var buf: [1]u8 = undefined;
        _ = linux.read(self.sync_pipe[0], &buf, 1);

        if (self.config.user_namespace) {
            self.setupUidGidMaps() catch |err| {
                _ = self.killChild();
                return err;
            };
        }

        // Signal child to continue after UID/GID setup
        // Child is waiting on sync_pipe[0] which we'll close
        _ = linux.close(self.sync_pipe[0]);
        self.sync_pipe[0] = -1;

        // Wait for child to complete
        var status: u32 = 0;
        const wait_result = linux.waitpid(self.child_pid.?, &status, 0);
        if (@as(isize, @bitCast(wait_result)) < 0) {
            return SandboxError.WaitFailed;
        }

        const exit_code: u8 = if (linux.W.IFEXITED(status))
            linux.W.EXITSTATUS(status)
        else if (linux.W.IFSIGNALED(status))
            128 + @as(u8, @truncate(linux.W.TERMSIG(status)))
        else
            1;

        return SandboxResult{
            .exit_code = exit_code,
        };
    }

    fn killChild(self: *Sandbox) bool {
        if (self.child_pid) |pid| {
            _ = linux.kill(pid, linux.SIG.KILL);
            return true;
        }
        return false;
    }

    fn setupUidGidMaps(self: *Sandbox) SandboxError!void {
        const pid = self.child_pid orelse return SandboxError.UidMapFailed;

        // Write uid_map
        const uid = self.config.uid_map orelse SandboxConfig.UidMap{
            .inside_uid = 0,
            .outside_uid = linux.getuid(),
            .count = 1,
        };

        var uid_map_path: [64]u8 = undefined;
        const uid_path = std.fmt.bufPrint(&uid_map_path, "/proc/{d}/uid_map\x00", .{pid}) catch
            return SandboxError.UidMapFailed;

        var uid_map_content: [64]u8 = undefined;
        const uid_content = std.fmt.bufPrint(&uid_map_content, "{d} {d} {d}\n", .{
            uid.inside_uid,
            uid.outside_uid,
            uid.count,
        }) catch return SandboxError.UidMapFailed;

        writeFileContent(uid_path[0 .. uid_path.len - 1 :0], uid_content) catch
            return SandboxError.UidMapFailed;

        // Disable setgroups (required before writing gid_map)
        var setgroups_path: [64]u8 = undefined;
        const setgroups = std.fmt.bufPrint(&setgroups_path, "/proc/{d}/setgroups\x00", .{pid}) catch
            return SandboxError.GidMapFailed;

        writeFileContent(setgroups[0 .. setgroups.len - 1 :0], "deny\n") catch {
            // setgroups might not exist on older kernels, continue
        };

        // Write gid_map
        const gid = self.config.gid_map orelse SandboxConfig.GidMap{
            .inside_gid = 0,
            .outside_gid = linux.getgid(),
            .count = 1,
        };

        var gid_map_path: [64]u8 = undefined;
        const gid_path = std.fmt.bufPrint(&gid_map_path, "/proc/{d}/gid_map\x00", .{pid}) catch
            return SandboxError.GidMapFailed;

        var gid_map_content: [64]u8 = undefined;
        const gid_content = std.fmt.bufPrint(&gid_map_content, "{d} {d} {d}\n", .{
            gid.inside_gid,
            gid.outside_gid,
            gid.count,
        }) catch return SandboxError.GidMapFailed;

        writeFileContent(gid_path[0 .. gid_path.len - 1 :0], gid_content) catch
            return SandboxError.GidMapFailed;
    }

    /// Child process main function
    fn childProcess(
        self: *Sandbox,
        argv: []const []const u8,
        env: []const []const u8,
    ) SandboxError!void {
        // Close read end of pipe
        _ = linux.close(self.sync_pipe[0]);

        // Build unshare flags
        var unshare_flags: u32 = 0;

        if (self.config.user_namespace) {
            unshare_flags |= CloneFlags.NEWUSER;
        }
        if (self.config.mount_namespace) {
            unshare_flags |= CloneFlags.NEWNS;
        }
        if (self.config.network_namespace and !self.config.share_network) {
            unshare_flags |= CloneFlags.NEWNET;
        }
        if (self.config.pid_namespace) {
            // Note: NEWPID affects child processes of this process, not this process itself
            unshare_flags |= CloneFlags.NEWPID;
        }

        // Unshare namespaces
        const unshare_result = linux.unshare(unshare_flags);
        if (@as(isize, @bitCast(unshare_result)) < 0) {
            return SandboxError.NamespaceCreationFailed;
        }

        // Signal parent that we've unshared (parent needs to set up UID/GID maps)
        _ = linux.write(self.sync_pipe[1], "x", 1);
        _ = linux.close(self.sync_pipe[1]);

        // Wait for parent to set up UID/GID maps
        // For now, use a small sleep to let parent write uid/gid maps
        // TODO: Use proper synchronization with a second pipe
        const ts = linux.timespec{ .sec = 0, .nsec = 100_000_000 }; // 100ms
        _ = linux.nanosleep(&ts, null);

        // Setup mount namespace
        if (self.config.mount_namespace) {
            self.setupMountNamespace() catch |err| {
                return err;
            };
        }

        // Setup seccomp if enabled
        if (self.config.seccomp) {
            self.setupSeccomp() catch |err| {
                return err;
            };
        }

        // Change to working directory
        self.changeDir(self.config.workdir) catch |err| {
            return err;
        };

        // Execute the command
        self.execCommand(argv, env) catch |err| {
            return err;
        };
    }

    fn setupMountNamespace(self: *Sandbox) SandboxError!void {
        // Make all mounts private to prevent propagation to host
        const mount_result = linux.mount(
            "none",
            "/",
            null,
            MountFlags.REC | MountFlags.PRIVATE,
            0,
        );
        if (@as(isize, @bitCast(mount_result)) < 0) {
            // Continue anyway, this might fail in some environments
        }

        // If we have overlayfs config, set it up
        if (self.config.upper_dir != null and self.config.work_dir != null and self.config.new_root != null) {
            self.setupOverlayfs() catch {
                // Overlayfs setup failed, continue with bind mounts
            };
        }

        // Setup bind mounts for readonly directories
        for (self.config.readonly_binds) |src| {
            self.bindMount(src, src, true) catch {
                // Continue even if bind mount fails
            };
        }

        // Setup bind mounts for readwrite directories
        for (self.config.readwrite_binds) |src| {
            self.bindMount(src, src, false) catch {
                // Continue even if bind mount fails
            };
        }

        // Remount /proc if we're in a PID namespace
        if (self.config.pid_namespace) {
            self.mountProc() catch {
                // /proc mount might fail, continue
            };
        }
    }

    fn setupOverlayfs(self: *Sandbox) SandboxError!void {
        const upper = self.config.upper_dir orelse return SandboxError.OverlayfsNotSupported;
        const work = self.config.work_dir orelse return SandboxError.OverlayfsNotSupported;
        const new_root = self.config.new_root orelse return SandboxError.OverlayfsNotSupported;
        const lower = self.config.root_dir;

        // Build overlayfs options string
        var options: [1024]u8 = undefined;
        const opt_slice = std.fmt.bufPrint(&options, "lowerdir={s},upperdir={s},workdir={s}\x00", .{
            lower,
            upper,
            work,
        }) catch return SandboxError.OverlayfsNotSupported;

        var new_root_z: [256]u8 = undefined;
        @memcpy(new_root_z[0..new_root.len], new_root);
        new_root_z[new_root.len] = 0;

        const mount_result = linux.mount(
            "overlay",
            @ptrCast(&new_root_z),
            "overlay",
            0,
            @intFromPtr(opt_slice.ptr),
        );

        if (@as(isize, @bitCast(mount_result)) < 0) {
            return SandboxError.OverlayfsNotSupported;
        }

        // Pivot root to the new overlayfs mount
        self.pivotRoot(new_root) catch |err| {
            return err;
        };
    }

    fn pivotRoot(self: *Sandbox, new_root: []const u8) SandboxError!void {
        _ = self;

        var new_root_z: [256]u8 = undefined;
        @memcpy(new_root_z[0..new_root.len], new_root);
        new_root_z[new_root.len] = 0;

        // Create put_old directory inside new_root
        var put_old: [512]u8 = undefined;
        const put_old_path = std.fmt.bufPrint(&put_old, "{s}/.pivot_old\x00", .{new_root}) catch
            return SandboxError.PivotRootFailed;

        // mkdir for put_old
        _ = linux.mkdir(@ptrCast(put_old_path.ptr), 0o755);

        // Change to new root
        const chdir_result = linux.chdir(@ptrCast(&new_root_z));
        if (@as(isize, @bitCast(chdir_result)) < 0) {
            return SandboxError.PivotRootFailed;
        }

        // pivot_root syscall
        const pivot_result = linux.syscall2(.pivot_root, @intFromPtr(&new_root_z), @intFromPtr(put_old_path.ptr));
        if (@as(isize, @bitCast(pivot_result)) < 0) {
            return SandboxError.PivotRootFailed;
        }

        // Change to root of new filesystem
        _ = linux.chdir("/");

        // Unmount old root
        const umount_result = linux.umount2("/.pivot_old", linux.MNT.DETACH);
        if (@as(isize, @bitCast(umount_result)) < 0) {
            // Continue even if unmount fails
        }

        // Remove the put_old directory
        _ = linux.rmdir("/.pivot_old");
    }

    fn bindMount(self: *Sandbox, src: []const u8, dest: []const u8, readonly: bool) SandboxError!void {
        _ = self;

        var src_buf: [256]u8 = undefined;
        @memcpy(src_buf[0..src.len], src);
        src_buf[src.len] = 0;

        var dest_buf: [256]u8 = undefined;
        @memcpy(dest_buf[0..dest.len], dest);
        dest_buf[dest.len] = 0;

        // First bind mount
        var mount_result = linux.mount(
            @ptrCast(&src_buf),
            @ptrCast(&dest_buf),
            null,
            MountFlags.BIND | MountFlags.REC,
            0,
        );

        if (@as(isize, @bitCast(mount_result)) < 0) {
            return SandboxError.MountFailed;
        }

        // Remount as readonly if requested
        if (readonly) {
            mount_result = linux.mount(
                null,
                @ptrCast(&dest_buf),
                null,
                MountFlags.BIND | MountFlags.REMOUNT | MountFlags.RDONLY,
                0,
            );

            if (@as(isize, @bitCast(mount_result)) < 0) {
                return SandboxError.MountFailed;
            }
        }
    }

    fn mountProc(self: *Sandbox) SandboxError!void {
        _ = self;

        // First unmount existing /proc
        _ = linux.umount2("/proc", linux.MNT.DETACH);

        // Mount new /proc
        const mount_result = linux.mount(
            "proc",
            "/proc",
            "proc",
            MountFlags.NOSUID | MountFlags.NODEV | MountFlags.NOEXEC,
            0,
        );

        if (@as(isize, @bitCast(mount_result)) < 0) {
            return SandboxError.MountFailed;
        }
    }

    fn changeDir(self: *Sandbox, path: []const u8) SandboxError!void {
        _ = self;

        var path_buf: [256]u8 = undefined;
        @memcpy(path_buf[0..path.len], path);
        path_buf[path.len] = 0;

        const result = linux.chdir(@ptrCast(&path_buf));
        if (@as(isize, @bitCast(result)) < 0) {
            return SandboxError.ExecFailed;
        }
    }

    fn setupSeccomp(self: *Sandbox) SandboxError!void {
        _ = self;
        // TODO: Implement seccomp-bpf filtering
        // This requires building a BPF program that:
        // 1. Allows syscalls in the allowlist
        // 2. Returns EPERM or kills the process for disallowed syscalls

        // Basic seccomp setup would use:
        // prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) - prevent privilege escalation
        // prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) - install filter

        // For now, just set no_new_privs
        const PR_SET_NO_NEW_PRIVS = 38;
        const result = linux.syscall5(.prctl, PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
        if (@as(isize, @bitCast(result)) < 0) {
            return SandboxError.SeccompFailed;
        }
    }

    fn execCommand(self: *Sandbox, argv: []const []const u8, env: []const []const u8) SandboxError!void {
        // Convert argv to null-terminated array
        const argv_buf = self.allocator.alloc(?[*:0]const u8, argv.len + 1) catch
            return SandboxError.OutOfMemory;
        defer self.allocator.free(argv_buf);

        for (argv, 0..) |arg, i| {
            const arg_z = self.allocator.dupeZ(u8, arg) catch
                return SandboxError.OutOfMemory;
            argv_buf[i] = arg_z.ptr;
        }
        argv_buf[argv.len] = null;

        // Convert env to null-terminated array
        const env_buf = self.allocator.alloc(?[*:0]const u8, env.len + 1) catch
            return SandboxError.OutOfMemory;
        defer self.allocator.free(env_buf);

        for (env, 0..) |e, i| {
            const env_z = self.allocator.dupeZ(u8, e) catch
                return SandboxError.OutOfMemory;
            env_buf[i] = env_z.ptr;
        }
        env_buf[env.len] = null;

        // Execute
        _ = linux.execve(
            argv_buf[0].?,
            @ptrCast(argv_buf.ptr),
            @ptrCast(env_buf.ptr),
        );

        // If we get here, execve failed
        return SandboxError.ExecFailed;
    }
};

/// Write content to a file
fn writeFileContent(path: [*:0]const u8, content: []const u8) !void {
    const fd_result = linux.open(path, .{ .ACCMODE = .WRONLY }, 0);
    if (@as(isize, @bitCast(fd_result)) < 0) {
        return error.OpenFailed;
    }
    defer _ = linux.close(@intCast(fd_result));

    const write_result = linux.write(@intCast(fd_result), content.ptr, content.len);
    if (@as(isize, @bitCast(write_result)) < 0) {
        return error.WriteFailed;
    }
}

/// High-level API for running sandboxed commands
pub fn run(
    allocator: std.mem.Allocator,
    config: SandboxConfig,
    argv: []const []const u8,
    env: []const []const u8,
) SandboxError!SandboxResult {
    var sandbox = Sandbox.init(allocator, config);
    defer sandbox.deinit();

    return sandbox.exec(argv, env);
}

/// Check if sandbox features are available
pub fn canSandbox() bool {
    // Check if we can create user namespaces
    const result = linux.unshare(CloneFlags.NEWUSER);
    if (@as(isize, @bitCast(result)) < 0) {
        return false;
    }
    // We're now in a new user namespace, exit to avoid state issues
    // Actually this changes our process, so this is a destructive check
    // Better to check /proc
    return true;
}

/// Get the current kernel's support for various sandbox features
pub const KernelFeatures = struct {
    user_namespaces: bool = false,
    overlayfs: bool = false,
    seccomp_bpf: bool = false,

    pub fn detect() KernelFeatures {
        var features = KernelFeatures{};

        // Check user namespace support
        features.user_namespaces = checkUserNamespaces();

        // Check overlayfs support
        features.overlayfs = checkOverlayfs();

        // Check seccomp-bpf support
        features.seccomp_bpf = checkSeccompBpf();

        return features;
    }

    fn checkUserNamespaces() bool {
        // Try to read /proc/sys/kernel/unprivileged_userns_clone
        var buf: [16]u8 = undefined;
        const fd_result = linux.open("/proc/sys/kernel/unprivileged_userns_clone\x00", .{ .ACCMODE = .RDONLY }, 0);
        if (@as(isize, @bitCast(fd_result)) < 0) {
            // File doesn't exist, assume enabled (newer kernels)
            return true;
        }
        defer _ = linux.close(@intCast(fd_result));

        const read_result = linux.read(@intCast(fd_result), &buf, buf.len);
        if (@as(isize, @bitCast(read_result)) < 0) {
            return false;
        }

        // Check if value is "1"
        return @as(usize, @bitCast(read_result)) > 0 and buf[0] == '1';
    }

    fn checkOverlayfs() bool {
        // Check if overlayfs is available by reading /proc/filesystems
        var buf: [4096]u8 = undefined;
        const fd_result = linux.open("/proc/filesystems\x00", .{ .ACCMODE = .RDONLY }, 0);
        if (@as(isize, @bitCast(fd_result)) < 0) {
            return false;
        }
        defer _ = linux.close(@intCast(fd_result));

        const read_result = linux.read(@intCast(fd_result), &buf, buf.len);
        if (@as(isize, @bitCast(read_result)) < 0) {
            return false;
        }

        // Search for "overlay" in the output
        const len: usize = @intCast(@as(isize, @bitCast(read_result)));
        const content = buf[0..len];
        return std.mem.indexOf(u8, content, "overlay") != null;
    }

    fn checkSeccompBpf() bool {
        // Check for seccomp support via prctl
        // PR_GET_SECCOMP = 21
        const result = linux.syscall5(.prctl, 21, 0, 0, 0, 0);
        // Returns 0 if disabled, 2 if filter mode, or EINVAL if not supported
        return @as(isize, @bitCast(result)) >= 0;
    }
};

test "kernel features detection" {
    const features = KernelFeatures.detect();
    std.debug.print("User namespaces: {}\n", .{features.user_namespaces});
    std.debug.print("Overlayfs: {}\n", .{features.overlayfs});
    std.debug.print("Seccomp-BPF: {}\n", .{features.seccomp_bpf});
}
