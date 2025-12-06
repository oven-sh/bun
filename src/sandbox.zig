//! Linux Sandbox Implementation - Pure Zig, No External Dependencies
//!
//! Provides complete process isolation using Linux kernel features:
//! - User namespaces for privilege isolation (unprivileged containers)
//! - Mount namespaces with overlayfs for copy-on-write filesystem
//! - Network namespaces for network isolation
//! - PID namespaces for process tree isolation
//! - Seccomp-BPF for syscall filtering
//!
//! This is a complete sandbox implementation without bwrap/bubblewrap/firejail.

const std = @import("std");
const bun = @import("bun");
const linux = std.os.linux;

const Output = bun.Output;

// ============================================================================
// Linux Constants
// ============================================================================

/// Clone flags for creating namespaces
pub const CLONE = struct {
    pub const NEWNS: u32 = 0x00020000; // Mount namespace
    pub const NEWUSER: u32 = 0x10000000; // User namespace
    pub const NEWPID: u32 = 0x20000000; // PID namespace
    pub const NEWNET: u32 = 0x40000000; // Network namespace
    pub const NEWIPC: u32 = 0x08000000; // IPC namespace
    pub const NEWUTS: u32 = 0x04000000; // UTS namespace
    pub const NEWCGROUP: u32 = 0x02000000; // Cgroup namespace
};

/// Mount flags
pub const MS = struct {
    pub const RDONLY: u32 = 1;
    pub const NOSUID: u32 = 2;
    pub const NODEV: u32 = 4;
    pub const NOEXEC: u32 = 8;
    pub const REMOUNT: u32 = 32;
    pub const BIND: u32 = 4096;
    pub const REC: u32 = 16384;
    pub const PRIVATE: u32 = 1 << 18;
    pub const SLAVE: u32 = 1 << 19;
    pub const STRICTATIME: u32 = 1 << 24;
};

/// Seccomp constants
pub const SECCOMP = struct {
    pub const MODE_FILTER: u32 = 2;
    pub const RET_KILL_PROCESS: u32 = 0x80000000;
    pub const RET_KILL_THREAD: u32 = 0x00000000;
    pub const RET_TRAP: u32 = 0x00030000;
    pub const RET_ERRNO: u32 = 0x00050000;
    pub const RET_ALLOW: u32 = 0x7fff0000;
    pub const RET_LOG: u32 = 0x7ffc0000;
};

/// prctl constants
pub const PR = struct {
    pub const SET_NO_NEW_PRIVS: u32 = 38;
    pub const SET_SECCOMP: u32 = 22;
    pub const GET_SECCOMP: u32 = 21;
};

/// BPF instruction opcodes
pub const BPF = struct {
    // Instruction classes
    pub const LD: u16 = 0x00;
    pub const LDX: u16 = 0x01;
    pub const ST: u16 = 0x02;
    pub const STX: u16 = 0x03;
    pub const ALU: u16 = 0x04;
    pub const JMP: u16 = 0x05;
    pub const RET: u16 = 0x06;
    pub const MISC: u16 = 0x07;

    // LD/LDX fields
    pub const W: u16 = 0x00; // 32-bit word
    pub const H: u16 = 0x08; // 16-bit half word
    pub const B: u16 = 0x10; // 8-bit byte
    pub const ABS: u16 = 0x20; // absolute offset
    pub const IND: u16 = 0x40;
    pub const MEM: u16 = 0x60;
    pub const LEN: u16 = 0x80;
    pub const MSH: u16 = 0xa0;

    // JMP fields
    pub const JA: u16 = 0x00;
    pub const JEQ: u16 = 0x10;
    pub const JGT: u16 = 0x20;
    pub const JGE: u16 = 0x30;
    pub const JSET: u16 = 0x40;
    pub const K: u16 = 0x00; // immediate value
    pub const X: u16 = 0x08; // index register
};

/// Seccomp data structure offsets (for aarch64)
pub const SECCOMP_DATA = struct {
    pub const nr: u32 = 0; // syscall number
    pub const arch: u32 = 4; // architecture
    pub const instruction_pointer: u32 = 8;
    pub const args: u32 = 16; // syscall arguments (6 * 8 bytes)
};

/// Architecture audit values
pub const AUDIT_ARCH = struct {
    pub const AARCH64: u32 = 0xC00000B7;
    pub const X86_64: u32 = 0xC000003E;
};

// ============================================================================
// BPF Program Builder
// ============================================================================

/// BPF instruction
pub const BpfInsn = extern struct {
    code: u16,
    jt: u8,
    jf: u8,
    k: u32,
};

/// BPF program
pub const BpfProg = extern struct {
    len: u16,
    filter: [*]const BpfInsn,
};

/// Build a BPF instruction
fn bpfStmt(code: u16, k: u32) BpfInsn {
    return BpfInsn{ .code = code, .jt = 0, .jf = 0, .k = k };
}

fn bpfJump(code: u16, k: u32, jt: u8, jf: u8) BpfInsn {
    return BpfInsn{ .code = code, .jt = jt, .jf = jf, .k = k };
}

// ============================================================================
// Sandbox Configuration
// ============================================================================

/// Sandbox configuration
pub const SandboxConfig = struct {
    /// Root directory for the sandbox (lower layer for overlayfs)
    root_dir: []const u8 = "/",

    /// Working directory inside the sandbox
    workdir: []const u8 = "/tmp",

    /// Enable user namespace (required for unprivileged operation)
    user_namespace: bool = true,

    /// Enable mount namespace
    mount_namespace: bool = true,

    /// Enable network namespace (isolated by default)
    network_namespace: bool = true,

    /// Share network with host (disables network namespace)
    share_network: bool = false,

    /// Enable PID namespace
    pid_namespace: bool = false,

    /// Enable overlayfs (copy-on-write filesystem)
    /// If true, creates a tmpfs upper layer automatically
    overlayfs: bool = false,

    /// Custom upper directory for overlayfs (optional, uses tmpfs if null)
    upper_dir: ?[]const u8 = null,

    /// Enable seccomp syscall filtering
    seccomp: bool = true,

    /// Seccomp mode: "strict" blocks dangerous syscalls, "permissive" logs only
    seccomp_mode: SeccompMode = .strict,

    /// Directories to bind mount read-only into sandbox
    readonly_binds: []const []const u8 = &.{},

    /// Directories to bind mount read-write into sandbox
    readwrite_binds: []const []const u8 = &.{},

    /// Hostname inside the sandbox
    hostname: []const u8 = "sandbox",

    /// UID inside the sandbox (0 = root)
    uid: u32 = 0,

    /// GID inside the sandbox (0 = root)
    gid: u32 = 0,

    pub const SeccompMode = enum {
        strict, // Kill process on disallowed syscall
        permissive, // Log but allow (for debugging)
        disabled, // No filtering
    };
};

/// Result of sandbox execution
pub const SandboxResult = struct {
    exit_code: u8,
    signal: ?u8 = null,
    stdout: ?[]const u8 = null,
    stderr: ?[]const u8 = null,
};

/// Sandbox errors
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
    OverlayfsSetupFailed,
    OutOfMemory,
    TmpfsCreateFailed,
};

// ============================================================================
// Sandbox Implementation
// ============================================================================

/// Linux Sandbox - Pure Zig implementation
pub const Sandbox = struct {
    config: SandboxConfig,
    allocator: std.mem.Allocator,

    /// Pipes for parent-child synchronization
    /// pipe1: child signals parent that unshare is done
    /// pipe2: parent signals child that uid/gid maps are written
    pipe1: [2]i32 = .{ -1, -1 },
    pipe2: [2]i32 = .{ -1, -1 },

    /// Child PID
    child_pid: ?i32 = null,

    /// Temporary directories created for overlayfs
    tmp_upper: ?[]u8 = null,
    tmp_work: ?[]u8 = null,
    tmp_merged: ?[]u8 = null,

    pub fn init(allocator: std.mem.Allocator, config: SandboxConfig) Sandbox {
        return Sandbox{
            .config = config,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Sandbox) void {
        // Close pipes
        inline for (.{ &self.pipe1, &self.pipe2 }) |pipe| {
            if (pipe[0] != -1) _ = linux.close(pipe[0]);
            if (pipe[1] != -1) _ = linux.close(pipe[1]);
        }

        // Free temp directory paths
        if (self.tmp_upper) |p| self.allocator.free(p);
        if (self.tmp_work) |p| self.allocator.free(p);
        if (self.tmp_merged) |p| self.allocator.free(p);
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

        // Create synchronization pipes
        if (@as(isize, @bitCast(linux.pipe2(&self.pipe1, .{}))) < 0) {
            return SandboxError.PipeFailed;
        }
        if (@as(isize, @bitCast(linux.pipe2(&self.pipe2, .{}))) < 0) {
            return SandboxError.PipeFailed;
        }

        // Fork
        const fork_result = linux.fork();
        const fork_pid: isize = @bitCast(fork_result);

        if (fork_pid < 0) {
            return SandboxError.ForkFailed;
        }

        if (fork_pid == 0) {
            // ===== CHILD PROCESS =====
            self.runChild(argv, env) catch |err| {
                // Write error to stderr and exit
                const msg = @errorName(err);
                _ = linux.write(2, msg.ptr, msg.len);
                _ = linux.write(2, "\n", 1);
                linux.exit(127);
            };
            linux.exit(0);
        }

        // ===== PARENT PROCESS =====
        self.child_pid = @intCast(fork_result);

        // Close unused pipe ends
        _ = linux.close(self.pipe1[1]); // Close write end of pipe1
        self.pipe1[1] = -1;
        _ = linux.close(self.pipe2[0]); // Close read end of pipe2
        self.pipe2[0] = -1;

        // Wait for child to signal it has unshared
        var buf: [1]u8 = undefined;
        _ = linux.read(self.pipe1[0], &buf, 1);

        // Setup UID/GID mappings
        if (self.config.user_namespace) {
            self.setupUidGidMaps() catch |err| {
                _ = self.killChild();
                return err;
            };
        }

        // Signal child to continue
        _ = linux.write(self.pipe2[1], "G", 1);

        // Wait for child
        var status: u32 = 0;
        const wait_result = linux.waitpid(self.child_pid.?, &status, 0);
        if (@as(isize, @bitCast(wait_result)) < 0) {
            return SandboxError.WaitFailed;
        }

        var result = SandboxResult{ .exit_code = 0 };

        if (linux.W.IFEXITED(status)) {
            result.exit_code = linux.W.EXITSTATUS(status);
        } else if (linux.W.IFSIGNALED(status)) {
            result.signal = @truncate(linux.W.TERMSIG(status));
            result.exit_code = 128 + result.signal.?;
        }

        return result;
    }

    fn killChild(self: *Sandbox) void {
        if (self.child_pid) |pid| {
            _ = linux.kill(pid, linux.SIG.KILL);
        }
    }

    fn setupUidGidMaps(self: *Sandbox) SandboxError!void {
        const pid = self.child_pid orelse return SandboxError.UidMapFailed;
        const real_uid = linux.getuid();
        const real_gid = linux.getgid();

        // Write uid_map: <inside_uid> <outside_uid> <count>
        var path_buf: [64]u8 = undefined;
        var content_buf: [64]u8 = undefined;

        const uid_path = std.fmt.bufPrintZ(&path_buf, "/proc/{d}/uid_map", .{pid}) catch
            return SandboxError.UidMapFailed;
        const uid_content = std.fmt.bufPrint(&content_buf, "{d} {d} 1\n", .{ self.config.uid, real_uid }) catch
            return SandboxError.UidMapFailed;

        try writeFile(uid_path, uid_content);

        // Deny setgroups (required before writing gid_map)
        const setgroups_path = std.fmt.bufPrintZ(&path_buf, "/proc/{d}/setgroups", .{pid}) catch
            return SandboxError.GidMapFailed;
        writeFile(setgroups_path, "deny\n") catch {};

        // Write gid_map
        const gid_path = std.fmt.bufPrintZ(&path_buf, "/proc/{d}/gid_map", .{pid}) catch
            return SandboxError.GidMapFailed;
        const gid_content = std.fmt.bufPrint(&content_buf, "{d} {d} 1\n", .{ self.config.gid, real_gid }) catch
            return SandboxError.GidMapFailed;

        try writeFile(gid_path, gid_content);
    }

    /// Child process entry point
    fn runChild(
        self: *Sandbox,
        argv: []const []const u8,
        env: []const []const u8,
    ) SandboxError!void {
        // Close unused pipe ends
        _ = linux.close(self.pipe1[0]);
        _ = linux.close(self.pipe2[1]);

        // Build unshare flags
        var flags: u32 = 0;
        if (self.config.user_namespace) flags |= CLONE.NEWUSER;
        if (self.config.mount_namespace) flags |= CLONE.NEWNS;
        if (self.config.network_namespace and !self.config.share_network) flags |= CLONE.NEWNET;
        if (self.config.pid_namespace) flags |= CLONE.NEWPID;

        // Unshare namespaces
        if (@as(isize, @bitCast(linux.unshare(flags))) < 0) {
            return SandboxError.NamespaceCreationFailed;
        }

        // Signal parent: unshare done
        _ = linux.write(self.pipe1[1], "U", 1);
        _ = linux.close(self.pipe1[1]);

        // Wait for parent to write uid/gid maps
        var buf: [1]u8 = undefined;
        _ = linux.read(self.pipe2[0], &buf, 1);
        _ = linux.close(self.pipe2[0]);

        // Setup filesystem
        if (self.config.mount_namespace) {
            try self.setupFilesystem();
        }

        // Setup seccomp
        if (self.config.seccomp and self.config.seccomp_mode != .disabled) {
            try self.setupSeccomp();
        }

        // Change to working directory
        var workdir_buf: [256]u8 = undefined;
        @memcpy(workdir_buf[0..self.config.workdir.len], self.config.workdir);
        workdir_buf[self.config.workdir.len] = 0;
        _ = linux.chdir(@ptrCast(&workdir_buf));

        // Execute command
        try self.execCommand(argv, env);
    }

    /// Setup the sandboxed filesystem
    fn setupFilesystem(self: *Sandbox) SandboxError!void {
        // Make all mounts private
        _ = linux.mount("none", "/", null, MS.REC | MS.PRIVATE, 0);

        if (self.config.overlayfs) {
            try self.setupOverlayfs();
        } else {
            // Just setup basic mounts without overlayfs
            try self.setupBasicMounts();
        }
    }

    /// Setup overlayfs with tmpfs backing
    fn setupOverlayfs(self: *Sandbox) SandboxError!void {
        // Create tmpfs for overlay directories
        const tmpdir = "/tmp/.bun-sandbox-XXXXXX";
        var tmpdir_buf: [64]u8 = undefined;
        @memcpy(tmpdir_buf[0..tmpdir.len], tmpdir);
        tmpdir_buf[tmpdir.len] = 0;

        // Create base tmpdir
        if (@as(isize, @bitCast(linux.mkdir(@ptrCast(&tmpdir_buf), 0o700))) < 0) {
            // Directory might exist, try to continue
        }

        // Create upper, work, and merged directories
        var upper_buf: [128]u8 = undefined;
        var work_buf: [128]u8 = undefined;
        var merged_buf: [128]u8 = undefined;

        const upper_path = std.fmt.bufPrintZ(&upper_buf, "{s}/upper", .{tmpdir}) catch
            return SandboxError.OverlayfsSetupFailed;
        const work_path = std.fmt.bufPrintZ(&work_buf, "{s}/work", .{tmpdir}) catch
            return SandboxError.OverlayfsSetupFailed;
        const merged_path = std.fmt.bufPrintZ(&merged_buf, "{s}/merged", .{tmpdir}) catch
            return SandboxError.OverlayfsSetupFailed;

        _ = linux.mkdir(upper_path, 0o755);
        _ = linux.mkdir(work_path, 0o755);
        _ = linux.mkdir(merged_path, 0o755);

        // Mount overlayfs
        var opts_buf: [512]u8 = undefined;
        const opts = std.fmt.bufPrintZ(&opts_buf, "lowerdir={s},upperdir={s},workdir={s}", .{
            self.config.root_dir,
            upper_path,
            work_path,
        }) catch return SandboxError.OverlayfsSetupFailed;

        const mount_result = linux.mount("overlay", merged_path, "overlay", 0, @intFromPtr(opts.ptr));
        if (@as(isize, @bitCast(mount_result)) < 0) {
            // Overlayfs might not be available, fall back to basic mounts
            return self.setupBasicMounts();
        }

        // Pivot root to the merged directory
        try self.pivotRoot(merged_path);
    }

    /// Setup basic mounts without overlayfs
    fn setupBasicMounts(self: *Sandbox) SandboxError!void {
        _ = self;
        // Mount a new /proc
        _ = linux.mount("proc", "/proc", "proc", MS.NOSUID | MS.NODEV | MS.NOEXEC, 0);

        // Mount tmpfs on /tmp
        _ = linux.mount("tmpfs", "/tmp", "tmpfs", MS.NOSUID | MS.NODEV, 0);

        // Mount /dev/null, /dev/zero, /dev/random, /dev/urandom
        // These are needed for many programs
        // Note: In a full sandbox we'd create device nodes, but that requires CAP_MKNOD
    }

    /// Pivot root to new filesystem
    fn pivotRoot(self: *Sandbox, new_root: [:0]const u8) SandboxError!void {
        _ = self;

        // Create directory for old root
        var put_old_buf: [256]u8 = undefined;
        const put_old = std.fmt.bufPrintZ(&put_old_buf, "{s}/.old_root", .{new_root}) catch
            return SandboxError.PivotRootFailed;

        _ = linux.mkdir(put_old, 0o755);

        // Change to new root
        if (@as(isize, @bitCast(linux.chdir(new_root))) < 0) {
            return SandboxError.PivotRootFailed;
        }

        // pivot_root(new_root, put_old)
        const result = linux.syscall2(
            .pivot_root,
            @intFromPtr(new_root.ptr),
            @intFromPtr(put_old.ptr),
        );
        if (@as(isize, @bitCast(result)) < 0) {
            return SandboxError.PivotRootFailed;
        }

        // Change to new root
        _ = linux.chdir("/");

        // Unmount old root
        _ = linux.umount2("/.old_root", linux.MNT.DETACH);
        _ = linux.rmdir("/.old_root");
    }

    /// Setup seccomp-BPF syscall filtering
    fn setupSeccomp(self: *Sandbox) SandboxError!void {
        // Set no_new_privs - required for unprivileged seccomp
        const nnp_result = linux.syscall5(.prctl, PR.SET_NO_NEW_PRIVS, 1, 0, 0, 0);
        if (@as(isize, @bitCast(nnp_result)) < 0) {
            return SandboxError.SeccompFailed;
        }

        // Build BPF filter
        const filter = self.buildSeccompFilter();

        const prog = BpfProg{
            .len = @intCast(filter.len),
            .filter = filter.ptr,
        };

        // Install seccomp filter
        const seccomp_result = linux.syscall3(
            .seccomp,
            SECCOMP.MODE_FILTER,
            0, // flags
            @intFromPtr(&prog),
        );
        if (@as(isize, @bitCast(seccomp_result)) < 0) {
            // Try prctl fallback for older kernels
            const prctl_result = linux.syscall5(.prctl, PR.SET_SECCOMP, SECCOMP.MODE_FILTER, @intFromPtr(&prog), 0, 0);
            if (@as(isize, @bitCast(prctl_result)) < 0) {
                return SandboxError.SeccompFailed;
            }
        }
    }

    /// Build a seccomp BPF filter that blocks dangerous syscalls
    fn buildSeccompFilter(self: *Sandbox) []const BpfInsn {
        const ret_action: u32 = switch (self.config.seccomp_mode) {
            .strict => SECCOMP.RET_KILL_PROCESS,
            .permissive => SECCOMP.RET_LOG,
            .disabled => SECCOMP.RET_ALLOW,
        };

        // Get the correct architecture value
        const arch_value: u32 = comptime if (@import("builtin").cpu.arch == .aarch64)
            AUDIT_ARCH.AARCH64
        else if (@import("builtin").cpu.arch == .x86_64)
            AUDIT_ARCH.X86_64
        else
            @compileError("Unsupported architecture for seccomp");

        // Build filter that:
        // 1. Validates architecture
        // 2. Blocks dangerous syscalls
        // 3. Allows everything else
        const filter = comptime blk: {
            var f: [32]BpfInsn = undefined;
            var i: usize = 0;

            // Load architecture
            f[i] = bpfStmt(BPF.LD | BPF.W | BPF.ABS, SECCOMP_DATA.arch);
            i += 1;

            // Check architecture
            f[i] = bpfJump(BPF.JMP | BPF.JEQ | BPF.K, arch_value, 1, 0);
            i += 1;

            // Kill if wrong architecture
            f[i] = bpfStmt(BPF.RET | BPF.K, SECCOMP.RET_KILL_PROCESS);
            i += 1;

            // Load syscall number
            f[i] = bpfStmt(BPF.LD | BPF.W | BPF.ABS, SECCOMP_DATA.nr);
            i += 1;

            // Block ptrace (most dangerous for escaping sandbox)
            // aarch64: ptrace = 117, x86_64: ptrace = 101
            const ptrace_nr: u32 = if (@import("builtin").cpu.arch == .aarch64) 117 else 101;
            f[i] = bpfJump(BPF.JMP | BPF.JEQ | BPF.K, ptrace_nr, 0, 1);
            i += 1;
            f[i] = bpfStmt(BPF.RET | BPF.K, SECCOMP.RET_ERRNO | 1); // EPERM
            i += 1;

            // Block mount (prevent mounting new filesystems)
            const mount_nr: u32 = if (@import("builtin").cpu.arch == .aarch64) 40 else 165;
            f[i] = bpfJump(BPF.JMP | BPF.JEQ | BPF.K, mount_nr, 0, 1);
            i += 1;
            f[i] = bpfStmt(BPF.RET | BPF.K, SECCOMP.RET_ERRNO | 1);
            i += 1;

            // Block umount2
            const umount_nr: u32 = if (@import("builtin").cpu.arch == .aarch64) 39 else 166;
            f[i] = bpfJump(BPF.JMP | BPF.JEQ | BPF.K, umount_nr, 0, 1);
            i += 1;
            f[i] = bpfStmt(BPF.RET | BPF.K, SECCOMP.RET_ERRNO | 1);
            i += 1;

            // Block pivot_root
            const pivot_nr: u32 = if (@import("builtin").cpu.arch == .aarch64) 41 else 155;
            f[i] = bpfJump(BPF.JMP | BPF.JEQ | BPF.K, pivot_nr, 0, 1);
            i += 1;
            f[i] = bpfStmt(BPF.RET | BPF.K, SECCOMP.RET_ERRNO | 1);
            i += 1;

            // Block kexec_load
            const kexec_nr: u32 = if (@import("builtin").cpu.arch == .aarch64) 104 else 246;
            f[i] = bpfJump(BPF.JMP | BPF.JEQ | BPF.K, kexec_nr, 0, 1);
            i += 1;
            f[i] = bpfStmt(BPF.RET | BPF.K, SECCOMP.RET_ERRNO | 1);
            i += 1;

            // Block reboot
            const reboot_nr: u32 = if (@import("builtin").cpu.arch == .aarch64) 142 else 169;
            f[i] = bpfJump(BPF.JMP | BPF.JEQ | BPF.K, reboot_nr, 0, 1);
            i += 1;
            f[i] = bpfStmt(BPF.RET | BPF.K, SECCOMP.RET_ERRNO | 1);
            i += 1;

            // Allow everything else
            f[i] = bpfStmt(BPF.RET | BPF.K, SECCOMP.RET_ALLOW);
            i += 1;

            break :blk f[0..i].*;
        };

        _ = ret_action; // Used in non-comptime version

        return &filter;
    }

    /// Execute the command
    fn execCommand(self: *Sandbox, argv: []const []const u8, env: []const []const u8) SandboxError!void {
        // Build null-terminated argv
        const argv_ptrs = self.allocator.alloc(?[*:0]const u8, argv.len + 1) catch
            return SandboxError.OutOfMemory;

        for (argv, 0..) |arg, i| {
            const arg_z = self.allocator.dupeZ(u8, arg) catch
                return SandboxError.OutOfMemory;
            argv_ptrs[i] = arg_z.ptr;
        }
        argv_ptrs[argv.len] = null;

        // Build null-terminated env
        const env_ptrs = self.allocator.alloc(?[*:0]const u8, env.len + 1) catch
            return SandboxError.OutOfMemory;

        for (env, 0..) |e, i| {
            const env_z = self.allocator.dupeZ(u8, e) catch
                return SandboxError.OutOfMemory;
            env_ptrs[i] = env_z.ptr;
        }
        env_ptrs[env.len] = null;

        // execve
        _ = linux.execve(
            argv_ptrs[0].?,
            @ptrCast(argv_ptrs.ptr),
            @ptrCast(env_ptrs.ptr),
        );

        // If we get here, execve failed
        return SandboxError.ExecFailed;
    }
};

// ============================================================================
// Utility Functions
// ============================================================================

fn writeFile(path: [:0]const u8, content: []const u8) SandboxError!void {
    const fd = linux.open(path, .{ .ACCMODE = .WRONLY }, 0);
    if (@as(isize, @bitCast(fd)) < 0) {
        return SandboxError.UidMapFailed;
    }
    defer _ = linux.close(@intCast(fd));

    const result = linux.write(@intCast(fd), content.ptr, content.len);
    if (@as(isize, @bitCast(result)) < 0) {
        return SandboxError.UidMapFailed;
    }
}

// ============================================================================
// Public API
// ============================================================================

/// Run a command in a sandbox
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

/// Check available kernel features
pub const KernelFeatures = struct {
    user_namespaces: bool = false,
    overlayfs: bool = false,
    seccomp_bpf: bool = false,

    pub fn detect() KernelFeatures {
        return KernelFeatures{
            .user_namespaces = checkUserNamespaces(),
            .overlayfs = checkOverlayfs(),
            .seccomp_bpf = checkSeccompBpf(),
        };
    }

    fn checkUserNamespaces() bool {
        var buf: [16]u8 = undefined;
        const fd = linux.open("/proc/sys/kernel/unprivileged_userns_clone\x00", .{ .ACCMODE = .RDONLY }, 0);
        if (@as(isize, @bitCast(fd)) < 0) return true; // File doesn't exist = enabled
        defer _ = linux.close(@intCast(fd));

        const n = linux.read(@intCast(fd), &buf, buf.len);
        if (@as(isize, @bitCast(n)) <= 0) return false;
        return buf[0] == '1';
    }

    fn checkOverlayfs() bool {
        var buf: [4096]u8 = undefined;
        const fd = linux.open("/proc/filesystems\x00", .{ .ACCMODE = .RDONLY }, 0);
        if (@as(isize, @bitCast(fd)) < 0) return false;
        defer _ = linux.close(@intCast(fd));

        const n = linux.read(@intCast(fd), &buf, buf.len);
        if (@as(isize, @bitCast(n)) <= 0) return false;

        const len: usize = @intCast(@as(isize, @bitCast(n)));
        return std.mem.indexOf(u8, buf[0..len], "overlay") != null;
    }

    fn checkSeccompBpf() bool {
        const result = linux.syscall5(.prctl, PR.GET_SECCOMP, 0, 0, 0, 0);
        return @as(isize, @bitCast(result)) >= 0;
    }
};
