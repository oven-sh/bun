//! Sandbox Executor
//!
//! Creates and manages sandboxed processes using Linux namespaces.
//! This module handles the fork/clone, namespace setup, and process lifecycle.

const std = @import("std");
const builtin = @import("builtin");
const bun = @import("bun");
const linux = std.os.linux;
const posix = std.posix;

const sandbox_linux = @import("linux.zig");
const SandboxConfig = sandbox_linux.SandboxConfig;

const Allocator = std.mem.Allocator;
const fd_t = posix.fd_t;
const pid_t = posix.pid_t;

// ============================================================================
// Pipe Management
// ============================================================================

const Pipe = struct {
    read_fd: fd_t,
    write_fd: fd_t,

    fn create() !Pipe {
        const fds = try posix.pipe();
        return Pipe{
            .read_fd = fds[0],
            .write_fd = fds[1],
        };
    }

    fn closeRead(self: *Pipe) void {
        if (self.read_fd != -1) {
            posix.close(self.read_fd);
            self.read_fd = -1;
        }
    }

    fn closeWrite(self: *Pipe) void {
        if (self.write_fd != -1) {
            posix.close(self.write_fd);
            self.write_fd = -1;
        }
    }

    fn close(self: *Pipe) void {
        self.closeRead();
        self.closeWrite();
    }
};

// ============================================================================
// Sandbox Process
// ============================================================================

pub const SandboxProcess = struct {
    pid: pid_t,
    stdout_pipe: Pipe,
    stderr_pipe: Pipe,
    sync_pipe: Pipe, // For parent-child synchronization

    pub fn wait(self: *SandboxProcess) !u32 {
        const result = posix.waitpid(self.pid, 0);
        if (result.status.Exited) |code| {
            return code;
        }
        if (result.status.Signaled) |sig| {
            return 128 + @as(u32, @intFromEnum(sig));
        }
        return 1;
    }

    pub fn readStdout(self: *SandboxProcess, allocator: Allocator) ![]u8 {
        return readAll(allocator, self.stdout_pipe.read_fd);
    }

    pub fn readStderr(self: *SandboxProcess, allocator: Allocator) ![]u8 {
        return readAll(allocator, self.stderr_pipe.read_fd);
    }

    fn readAll(allocator: Allocator, fd: fd_t) ![]u8 {
        var buffer = std.ArrayList(u8).init(allocator);
        errdefer buffer.deinit();

        var read_buf: [4096]u8 = undefined;
        while (true) {
            const n = posix.read(fd, &read_buf) catch |err| switch (err) {
                error.WouldBlock => continue,
                else => return err,
            };
            if (n == 0) break;
            try buffer.appendSlice(read_buf[0..n]);
        }

        return buffer.toOwnedSlice();
    }

    pub fn kill(self: *SandboxProcess) void {
        _ = posix.kill(self.pid, .KILL) catch {};
    }

    pub fn deinit(self: *SandboxProcess) void {
        self.stdout_pipe.close();
        self.stderr_pipe.close();
        self.sync_pipe.close();
    }
};

// ============================================================================
// Sandbox Executor
// ============================================================================

pub const Executor = struct {
    allocator: Allocator,
    config: SandboxConfig,

    // Overlay filesystem paths
    overlay_base: ?[]const u8 = null,
    overlay_upper: ?[]const u8 = null,
    overlay_work: ?[]const u8 = null,
    overlay_merged: ?[]const u8 = null,

    pub fn init(allocator: Allocator, config: SandboxConfig) Executor {
        return Executor{
            .allocator = allocator,
            .config = config,
        };
    }

    pub fn deinit(self: *Executor) void {
        // Cleanup overlay directories
        if (self.overlay_base) |base| {
            // Unmount merged
            if (self.overlay_merged) |merged| {
                const merged_z = @as([*:0]const u8, @ptrCast(merged.ptr));
                sandbox_linux.umount2(merged_z, sandbox_linux.MNT_DETACH) catch {};
            }

            // Remove directories
            std.fs.deleteTreeAbsolute(base) catch {};
            self.allocator.free(base);
        }
    }

    /// Setup overlay filesystem for copy-on-write
    pub fn setupOverlay(self: *Executor) !void {
        // Generate unique base path
        var rand_buf: [8]u8 = undefined;
        std.crypto.random.bytes(&rand_buf);
        var hex_buf: [16]u8 = undefined;
        _ = std.fmt.bufPrint(&hex_buf, "{s}", .{std.fmt.fmtSliceHexLower(&rand_buf)}) catch unreachable;

        const base = try std.fmt.allocPrint(self.allocator, "/tmp/bun-sandbox-{s}", .{hex_buf});
        errdefer self.allocator.free(base);

        // Create directories
        const upper = try std.fmt.allocPrint(self.allocator, "{s}/upper", .{base});
        errdefer self.allocator.free(upper);

        const work = try std.fmt.allocPrint(self.allocator, "{s}/work", .{base});
        errdefer self.allocator.free(work);

        const merged = try std.fmt.allocPrint(self.allocator, "{s}/merged", .{base});
        errdefer self.allocator.free(merged);

        try std.fs.makeDirAbsolute(base);
        try std.fs.makeDirAbsolute(upper);
        try std.fs.makeDirAbsolute(work);
        try std.fs.makeDirAbsolute(merged);

        self.overlay_base = base;
        self.overlay_upper = upper;
        self.overlay_work = work;
        self.overlay_merged = merged;
    }

    /// Spawn a sandboxed process
    pub fn spawn(self: *Executor, argv: []const []const u8, envp: []const [2][]const u8) !SandboxProcess {
        // Create pipes for stdout, stderr, and sync
        var stdout_pipe = try Pipe.create();
        errdefer stdout_pipe.close();

        var stderr_pipe = try Pipe.create();
        errdefer stderr_pipe.close();

        var sync_pipe = try Pipe.create();
        errdefer sync_pipe.close();

        // Fork the process
        const pid = try posix.fork();

        if (pid == 0) {
            // Child process
            self.childProcess(argv, envp, &stdout_pipe, &stderr_pipe, &sync_pipe) catch {
                posix.exit(127);
            };
            posix.exit(0);
        }

        // Parent process
        stdout_pipe.closeWrite();
        stderr_pipe.closeWrite();
        sync_pipe.closeRead();

        // Setup user namespace mappings (must be done from parent)
        if (self.config.user_ns) {
            const current_uid = linux.getuid();
            const current_gid = linux.getgid();

            sandbox_linux.writeUidMap(pid, self.config.uid, current_uid, 1) catch {};
            sandbox_linux.writeGidMap(pid, self.config.gid, current_gid, 1) catch {};
        }

        // Signal child to continue
        _ = posix.write(sync_pipe.write_fd, "x") catch {};
        sync_pipe.closeWrite();

        return SandboxProcess{
            .pid = pid,
            .stdout_pipe = stdout_pipe,
            .stderr_pipe = stderr_pipe,
            .sync_pipe = sync_pipe,
        };
    }

    fn childProcess(
        self: *Executor,
        argv: []const []const u8,
        envp: []const [2][]const u8,
        stdout_pipe: *Pipe,
        stderr_pipe: *Pipe,
        sync_pipe: *Pipe,
    ) !void {
        // Close parent ends of pipes
        stdout_pipe.closeRead();
        stderr_pipe.closeRead();
        sync_pipe.closeWrite();

        // Redirect stdout/stderr
        try posix.dup2(stdout_pipe.write_fd, posix.STDOUT_FILENO);
        try posix.dup2(stderr_pipe.write_fd, posix.STDERR_FILENO);

        // Unshare namespaces
        const flags = self.config.getCloneFlags();
        if (flags != 0) {
            sandbox_linux.unshare(flags) catch |err| {
                std.debug.print("unshare failed: {}\n", .{err});
                return err;
            };
        }

        // Wait for parent to setup UID/GID mappings
        var buf: [1]u8 = undefined;
        _ = posix.read(sync_pipe.read_fd, &buf) catch {};
        sync_pipe.closeRead();

        // Setup mount namespace
        if (self.config.mount_ns) {
            try sandbox_linux.setupMountNamespace();

            // Mount overlay if configured
            if (self.overlay_merged) |merged| {
                const overlay = sandbox_linux.OverlayPaths{
                    .lower_dir = self.config.rootfs,
                    .upper_dir = self.overlay_upper.?,
                    .work_dir = self.overlay_work.?,
                    .merged_dir = merged,
                };
                overlay.mountOverlay() catch {};
            }

            // Mount essential filesystems
            sandbox_linux.mountProc("/proc") catch {};
            sandbox_linux.mountTmpfs("/tmp", "size=64m,mode=1777") catch {};
            sandbox_linux.mountDev("/dev") catch {};

            // Bind mount readonly paths
            for (self.config.readonly_binds) |path| {
                const path_z = @as([*:0]const u8, @ptrCast(path.ptr));
                sandbox_linux.bindMount(path_z, path_z, true) catch {};
            }

            // Bind mount writable paths
            for (self.config.writable_binds) |path| {
                const path_z = @as([*:0]const u8, @ptrCast(path.ptr));
                sandbox_linux.bindMount(path_z, path_z, false) catch {};
            }
        }

        // Setup UTS namespace (hostname)
        if (self.config.uts_ns) {
            sandbox_linux.sethostname(self.config.hostname) catch {};
        }

        // Apply seccomp filter
        if (self.config.seccomp) {
            if (sandbox_linux.createSeccompFilter(self.allocator)) |filter| {
                defer self.allocator.free(filter);
                sandbox_linux.applySeccompFilter(filter) catch {};
            } else |_| {}
        }

        // Change to working directory
        posix.chdir(self.config.workdir) catch {};

        // Build environment
        var env_ptrs: [256][*:0]const u8 = undefined;
        var env_count: usize = 0;

        for (envp) |kv| {
            if (env_count >= 255) break;
            // Would need to format "KEY=VALUE" here
            _ = kv;
            // env_ptrs[env_count] = ...
            // env_count += 1;
        }
        env_ptrs[env_count] = null;

        // Build argv
        var argv_ptrs: [256][*:0]const u8 = undefined;
        for (argv, 0..) |arg, i| {
            if (i >= 255) break;
            argv_ptrs[i] = @as([*:0]const u8, @ptrCast(arg.ptr));
        }
        argv_ptrs[argv.len] = null;

        // Execute the command
        const argv_ptr: [*:null]const ?[*:0]const u8 = @ptrCast(&argv_ptrs);
        const envp_ptr: [*:null]const ?[*:0]const u8 = @ptrCast(&env_ptrs);

        const err = posix.execvpeZ(argv_ptrs[0], argv_ptr, envp_ptr);
        _ = err;

        // If we get here, exec failed
        posix.exit(127);
    }

    /// Run a command and wait for completion
    pub fn run(self: *Executor, argv: []const []const u8, envp: []const [2][]const u8) !SandboxResult {
        var proc = try self.spawn(argv, envp);
        defer proc.deinit();

        const exit_code = try proc.wait();
        const stdout = try proc.readStdout(self.allocator);
        const stderr = try proc.readStderr(self.allocator);

        return SandboxResult{
            .exit_code = @truncate(exit_code),
            .stdout = stdout,
            .stderr = stderr,
        };
    }
};

pub const SandboxResult = struct {
    exit_code: u8,
    stdout: []const u8,
    stderr: []const u8,

    pub fn deinit(self: *SandboxResult, allocator: Allocator) void {
        allocator.free(self.stdout);
        allocator.free(self.stderr);
    }
};

// ============================================================================
// High-Level API
// ============================================================================

/// Run a command in a fully isolated sandbox
pub fn runIsolated(
    allocator: Allocator,
    argv: []const []const u8,
    config: SandboxConfig,
) !SandboxResult {
    var executor = Executor.init(allocator, config);
    defer executor.deinit();

    // Setup overlay for filesystem isolation
    try executor.setupOverlay();

    return executor.run(argv, config.env);
}

/// Quick sandbox run with default config
pub fn quickRun(allocator: Allocator, argv: []const []const u8) !SandboxResult {
    const config = SandboxConfig{};
    return runIsolated(allocator, argv, config);
}

// ============================================================================
// Tests
// ============================================================================

test "create executor" {
    const allocator = std.testing.allocator;
    var executor = Executor.init(allocator, .{});
    defer executor.deinit();
}

test "setup overlay" {
    const allocator = std.testing.allocator;
    var executor = Executor.init(allocator, .{});
    defer executor.deinit();

    executor.setupOverlay() catch |err| {
        // May fail without permissions
        if (err == error.AccessDenied) return;
        return err;
    };

    // Verify directories created
    if (executor.overlay_base) |base| {
        var dir = std.fs.openDirAbsolute(base, .{}) catch return;
        dir.close();
    }
}
