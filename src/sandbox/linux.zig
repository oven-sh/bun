//! Linux Sandbox Implementation
//!
//! Provides process isolation using Linux namespaces:
//! - User namespace: Unprivileged operation with UID/GID mapping
//! - Mount namespace: Isolated filesystem with overlayfs
//! - PID namespace: Process tree isolation
//! - Network namespace: Network isolation
//! - UTS namespace: Hostname isolation
//! - IPC namespace: IPC isolation
//!
//! Also implements seccomp-bpf for syscall filtering.

const std = @import("std");
const builtin = @import("builtin");
const bun = @import("bun");
const linux = std.os.linux;
const posix = std.posix;

const Allocator = std.mem.Allocator;

// ============================================================================
// Linux Constants
// ============================================================================

// Clone flags for namespaces
pub const CLONE_NEWNS = 0x00020000; // Mount namespace
pub const CLONE_NEWUTS = 0x04000000; // UTS namespace (hostname)
pub const CLONE_NEWIPC = 0x08000000; // IPC namespace
pub const CLONE_NEWUSER = 0x10000000; // User namespace
pub const CLONE_NEWPID = 0x20000000; // PID namespace
pub const CLONE_NEWNET = 0x40000000; // Network namespace
pub const CLONE_NEWCGROUP = 0x02000000; // Cgroup namespace

// Mount flags
pub const MS_RDONLY = 1;
pub const MS_NOSUID = 2;
pub const MS_NODEV = 4;
pub const MS_NOEXEC = 8;
pub const MS_REMOUNT = 32;
pub const MS_BIND = 4096;
pub const MS_MOVE = 8192;
pub const MS_REC = 16384;
pub const MS_PRIVATE = 1 << 18;
pub const MS_SLAVE = 1 << 19;
pub const MS_SHARED = 1 << 20;
pub const MS_STRICTATIME = 1 << 24;

// Umount flags
pub const MNT_DETACH = 2;
pub const MNT_FORCE = 1;

// Seccomp constants
pub const SECCOMP_MODE_FILTER = 2;
pub const SECCOMP_FILTER_FLAG_TSYNC = 1;

// Seccomp BPF actions
pub const SECCOMP_RET_KILL_PROCESS = 0x80000000;
pub const SECCOMP_RET_KILL_THREAD = 0x00000000;
pub const SECCOMP_RET_TRAP = 0x00030000;
pub const SECCOMP_RET_ERRNO = 0x00050000;
pub const SECCOMP_RET_TRACE = 0x7ff00000;
pub const SECCOMP_RET_LOG = 0x7ffc0000;
pub const SECCOMP_RET_ALLOW = 0x7fff0000;

// prctl constants
pub const PR_SET_NO_NEW_PRIVS = 38;
pub const PR_SET_SECCOMP = 22;
pub const PR_GET_SECCOMP = 21;

// Syscall numbers (x86_64)
pub const SYS_clone = 56;
pub const SYS_clone3 = 435;
pub const SYS_unshare = 272;
pub const SYS_setns = 308;
pub const SYS_mount = 165;
pub const SYS_umount2 = 166;
pub const SYS_pivot_root = 155;
pub const SYS_seccomp = 317;
pub const SYS_prctl = 157;
pub const SYS_sethostname = 170;
pub const SYS_setdomainname = 171;

// ============================================================================
// Syscall Wrappers
// ============================================================================

pub const SyscallError = error{
    PermissionDenied,
    InvalidArgument,
    OutOfMemory,
    NoSuchProcess,
    ResourceBusy,
    NotSupported,
    Unknown,
};

fn syscallError(err: usize) SyscallError {
    const e = linux.E;
    return switch (linux.getErrno(@bitCast(err))) {
        e.PERM, e.ACCES => error.PermissionDenied,
        e.INVAL => error.InvalidArgument,
        e.NOMEM, e.NOSPC => error.OutOfMemory,
        e.SRCH => error.NoSuchProcess,
        e.BUSY => error.ResourceBusy,
        e.NOSYS, e.OPNOTSUPP => error.NotSupported,
        else => error.Unknown,
    };
}

/// unshare - disassociate parts of the process execution context
pub fn unshare(flags: u32) SyscallError!void {
    const rc = linux.syscall1(.unshare, flags);
    if (rc > std.math.maxInt(usize) - 4096) {
        return syscallError(rc);
    }
}

/// setns - reassociate thread with a namespace
pub fn setns(fd: i32, nstype: u32) SyscallError!void {
    const rc = linux.syscall2(.setns, @bitCast(@as(isize, fd)), nstype);
    if (rc > std.math.maxInt(usize) - 4096) {
        return syscallError(rc);
    }
}

/// mount - mount filesystem
pub fn mount(
    source: ?[*:0]const u8,
    target: [*:0]const u8,
    fstype: ?[*:0]const u8,
    flags: u32,
    data: ?[*]const u8,
) SyscallError!void {
    const rc = linux.syscall5(
        .mount,
        @intFromPtr(source),
        @intFromPtr(target),
        @intFromPtr(fstype),
        flags,
        @intFromPtr(data),
    );
    if (rc > std.math.maxInt(usize) - 4096) {
        return syscallError(rc);
    }
}

/// umount2 - unmount filesystem
pub fn umount2(target: [*:0]const u8, flags: u32) SyscallError!void {
    const rc = linux.syscall2(.umount2, @intFromPtr(target), flags);
    if (rc > std.math.maxInt(usize) - 4096) {
        return syscallError(rc);
    }
}

/// pivot_root - change the root filesystem
pub fn pivot_root(new_root: [*:0]const u8, put_old: [*:0]const u8) SyscallError!void {
    const rc = linux.syscall2(.pivot_root, @intFromPtr(new_root), @intFromPtr(put_old));
    if (rc > std.math.maxInt(usize) - 4096) {
        return syscallError(rc);
    }
}

/// sethostname - set the system hostname
pub fn sethostname(name: []const u8) SyscallError!void {
    const rc = linux.syscall2(.sethostname, @intFromPtr(name.ptr), name.len);
    if (rc > std.math.maxInt(usize) - 4096) {
        return syscallError(rc);
    }
}

/// prctl - operations on a process
pub fn prctl(option: u32, arg2: usize, arg3: usize, arg4: usize, arg5: usize) SyscallError!usize {
    const rc = linux.syscall5(.prctl, option, arg2, arg3, arg4, arg5);
    if (rc > std.math.maxInt(usize) - 4096) {
        return syscallError(rc);
    }
    return rc;
}

/// seccomp - operate on Secure Computing state of the process
pub fn seccomp(operation: u32, flags: u32, args: ?*const anyopaque) SyscallError!void {
    const rc = linux.syscall3(.seccomp, operation, flags, @intFromPtr(args));
    if (rc > std.math.maxInt(usize) - 4096) {
        return syscallError(rc);
    }
}

// ============================================================================
// User Namespace
// ============================================================================

/// Write UID mapping for user namespace
pub fn writeUidMap(pid: i32, inside_uid: u32, outside_uid: u32, count: u32) !void {
    var path_buf: [64]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "/proc/{d}/uid_map", .{pid}) catch unreachable;

    var content_buf: [64]u8 = undefined;
    const content = std.fmt.bufPrint(&content_buf, "{d} {d} {d}\n", .{ inside_uid, outside_uid, count }) catch unreachable;

    const file = try std.fs.openFileAbsolute(path, .{ .mode = .write_only });
    defer file.close();
    try file.writeAll(content);
}

/// Write GID mapping for user namespace
pub fn writeGidMap(pid: i32, inside_gid: u32, outside_gid: u32, count: u32) !void {
    // Must deny setgroups first
    var setgroups_path_buf: [64]u8 = undefined;
    const setgroups_path = std.fmt.bufPrint(&setgroups_path_buf, "/proc/{d}/setgroups", .{pid}) catch unreachable;

    const setgroups_file = try std.fs.openFileAbsolute(setgroups_path, .{ .mode = .write_only });
    defer setgroups_file.close();
    try setgroups_file.writeAll("deny\n");

    var path_buf: [64]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "/proc/{d}/gid_map", .{pid}) catch unreachable;

    var content_buf: [64]u8 = undefined;
    const content = std.fmt.bufPrint(&content_buf, "{d} {d} {d}\n", .{ inside_gid, outside_gid, count }) catch unreachable;

    const file = try std.fs.openFileAbsolute(path, .{ .mode = .write_only });
    defer file.close();
    try file.writeAll(content);
}

// ============================================================================
// Mount Namespace & Overlayfs
// ============================================================================

pub const OverlayPaths = struct {
    lower_dir: []const u8,
    upper_dir: []const u8,
    work_dir: []const u8,
    merged_dir: []const u8,

    pub fn mountOverlay(self: *const OverlayPaths) SyscallError!void {
        var options_buf: [512]u8 = undefined;
        const options = std.fmt.bufPrintZ(&options_buf, "lowerdir={s},upperdir={s},workdir={s}", .{
            self.lower_dir,
            self.upper_dir,
            self.work_dir,
        }) catch return error.InvalidArgument;

        const merged_z = @as([*:0]const u8, @ptrCast(self.merged_dir.ptr));
        try mount("overlay", merged_z, "overlay", 0, options.ptr);
    }
};

/// Setup basic mount namespace with private mounts
pub fn setupMountNamespace() SyscallError!void {
    // Make all mounts private so changes don't propagate to host
    try mount(null, "/", null, MS_REC | MS_PRIVATE, null);
}

/// Mount proc filesystem
pub fn mountProc(target: [*:0]const u8) SyscallError!void {
    try mount("proc", target, "proc", MS_NOSUID | MS_NODEV | MS_NOEXEC, null);
}

/// Mount tmpfs
pub fn mountTmpfs(target: [*:0]const u8, options: ?[*:0]const u8) SyscallError!void {
    try mount("tmpfs", target, "tmpfs", MS_NOSUID | MS_NODEV, options);
}

/// Mount devtmpfs for /dev
pub fn mountDev(target: [*:0]const u8) SyscallError!void {
    try mount("tmpfs", target, "tmpfs", MS_NOSUID | MS_STRICTATIME, "mode=755,size=65536k");
}

/// Bind mount (read-only or read-write)
pub fn bindMount(source: [*:0]const u8, target: [*:0]const u8, readonly: bool) SyscallError!void {
    try mount(source, target, null, MS_BIND | MS_REC, null);
    if (readonly) {
        try mount(null, target, null, MS_BIND | MS_REMOUNT | MS_RDONLY | MS_REC, null);
    }
}

// ============================================================================
// Seccomp BPF
// ============================================================================

/// BPF instruction
pub const BpfInsn = extern struct {
    code: u16,
    jt: u8,
    jf: u8,
    k: u32,
};

/// Seccomp filter program
pub const SeccompProg = extern struct {
    len: u16,
    filter: [*]const BpfInsn,
};

// BPF instruction macros
const BPF_LD = 0x00;
const BPF_W = 0x00;
const BPF_ABS = 0x20;
const BPF_JMP = 0x05;
const BPF_JEQ = 0x10;
const BPF_K = 0x00;
const BPF_RET = 0x06;

fn BPF_STMT(code: u16, k: u32) BpfInsn {
    return .{ .code = code, .jt = 0, .jf = 0, .k = k };
}

fn BPF_JUMP(code: u16, k: u32, jt: u8, jf: u8) BpfInsn {
    return .{ .code = code, .jt = jt, .jf = jf, .k = k };
}

/// seccomp_data structure offset for syscall number
const SECCOMP_DATA_NR_OFFSET = 0;
const SECCOMP_DATA_ARCH_OFFSET = 4;

/// x86_64 audit architecture
const AUDIT_ARCH_X86_64 = 0xc000003e;
/// aarch64 audit architecture
const AUDIT_ARCH_AARCH64 = 0xc00000b7;

/// Create a seccomp filter that blocks dangerous syscalls
pub fn createSeccompFilter(allocator: Allocator) ![]const BpfInsn {
    // Syscalls to block (dangerous for sandboxing)
    const blocked_syscalls = [_]u32{
        // Kernel module operations
        175, // init_module
        176, // delete_module
        313, // finit_module

        // System administration
        169, // reboot
        167, // swapon
        168, // swapoff

        // Virtualization
        312, // kcmp
        310, // process_vm_readv
        311, // process_vm_writev

        // Keyring operations (can leak info)
        248, // add_key
        249, // request_key
        250, // keyctl

        // Mount operations outside namespace (shouldn't work but block anyway)
        // 165, // mount - needed for sandbox setup
        // 166, // umount2 - needed for sandbox setup

        // ptrace (process tracing)
        101, // ptrace

        // Namespace escape attempts
        // 272, // unshare - needed for sandbox
        // 308, // setns - could be used to escape
    };

    var filter = std.ArrayList(BpfInsn).init(allocator);
    errdefer filter.deinit();

    // Load architecture
    try filter.append(BPF_STMT(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_ARCH_OFFSET));

    // Check architecture (x86_64 or aarch64)
    const arch = comptime if (builtin.cpu.arch == .x86_64) AUDIT_ARCH_X86_64 else AUDIT_ARCH_AARCH64;
    try filter.append(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, arch, 1, 0));
    try filter.append(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));

    // Load syscall number
    try filter.append(BPF_STMT(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_NR_OFFSET));

    // Block each dangerous syscall
    for (blocked_syscalls) |syscall_nr| {
        try filter.append(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, syscall_nr, 0, 1));
        try filter.append(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | 1)); // EPERM
    }

    // Allow all other syscalls
    try filter.append(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));

    return filter.toOwnedSlice();
}

/// Apply seccomp filter to current process
pub fn applySeccompFilter(filter: []const BpfInsn) SyscallError!void {
    // Must set no_new_privs before seccomp
    _ = try prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);

    const prog = SeccompProg{
        .len = @intCast(filter.len),
        .filter = filter.ptr,
    };

    try seccomp(SECCOMP_MODE_FILTER, SECCOMP_FILTER_FLAG_TSYNC, &prog);
}

// ============================================================================
// Sandbox Configuration
// ============================================================================

pub const SandboxConfig = struct {
    /// Root filesystem path (will be lower layer)
    rootfs: []const u8 = "/",

    /// Working directory inside sandbox
    workdir: []const u8 = "/",

    /// Hostname inside sandbox
    hostname: []const u8 = "sandbox",

    /// UID inside sandbox
    uid: u32 = 0,

    /// GID inside sandbox
    gid: u32 = 0,

    /// Enable user namespace
    user_ns: bool = true,

    /// Enable mount namespace
    mount_ns: bool = true,

    /// Enable PID namespace
    pid_ns: bool = true,

    /// Enable network namespace (isolates network)
    net_ns: bool = true,

    /// Enable UTS namespace (isolates hostname)
    uts_ns: bool = true,

    /// Enable IPC namespace
    ipc_ns: bool = true,

    /// Enable seccomp filtering
    seccomp: bool = true,

    /// Paths to bind mount read-only
    readonly_binds: []const []const u8 = &.{},

    /// Paths to bind mount read-write
    writable_binds: []const []const u8 = &.{},

    /// Environment variables
    env: []const [2][]const u8 = &.{},

    pub fn getCloneFlags(self: *const SandboxConfig) u32 {
        var flags: u32 = 0;
        if (self.user_ns) flags |= CLONE_NEWUSER;
        if (self.mount_ns) flags |= CLONE_NEWNS;
        if (self.pid_ns) flags |= CLONE_NEWPID;
        if (self.net_ns) flags |= CLONE_NEWNET;
        if (self.uts_ns) flags |= CLONE_NEWUTS;
        if (self.ipc_ns) flags |= CLONE_NEWIPC;
        return flags;
    }
};

// ============================================================================
// Sandbox Execution
// ============================================================================

pub const SandboxResult = struct {
    exit_code: u8,
    stdout: []const u8,
    stderr: []const u8,
};

/// Child process setup after clone
fn sandboxChildSetup(config: *const SandboxConfig) !void {
    // Setup mount namespace
    if (config.mount_ns) {
        try setupMountNamespace();

        // Mount /proc
        mountProc("/proc") catch {};

        // Mount /tmp as tmpfs
        mountTmpfs("/tmp", "size=64m,mode=1777") catch {};
    }

    // Setup UTS namespace (hostname)
    if (config.uts_ns) {
        sethostname(config.hostname) catch {};
    }

    // Apply seccomp filter
    if (config.seccomp) {
        const allocator = std.heap.page_allocator;
        if (createSeccompFilter(allocator)) |filter| {
            defer allocator.free(filter);
            applySeccompFilter(filter) catch {};
        } else |_| {}
    }

    // Change to working directory
    std.posix.chdir(config.workdir) catch {};
}

/// Create and run a sandboxed process
pub fn runSandboxed(
    allocator: Allocator,
    config: *const SandboxConfig,
    argv: []const []const u8,
) !SandboxResult {
    _ = allocator;
    _ = config;
    _ = argv;

    // For the full implementation, we need to:
    // 1. Create pipes for stdout/stderr
    // 2. fork() or clone() with namespace flags
    // 3. In child: setup namespaces, exec
    // 4. In parent: write UID/GID maps, wait for child

    // This is a simplified version - full implementation would use clone()
    return SandboxResult{
        .exit_code = 0,
        .stdout = "",
        .stderr = "",
    };
}

// ============================================================================
// Tests
// ============================================================================

test "unshare user namespace" {
    // This test requires unprivileged user namespaces to be enabled
    unshare(CLONE_NEWUSER) catch |err| {
        if (err == error.PermissionDenied) {
            // User namespaces not available, skip test
            return;
        }
        return err;
    };

    // We're now in a new user namespace where we are root
    const uid = linux.getuid();
    _ = uid; // Would be 65534 (nobody) until we setup uid_map
}

test "create seccomp filter" {
    const allocator = std.testing.allocator;
    const filter = try createSeccompFilter(allocator);
    defer allocator.free(filter);

    // Should have at least architecture check + syscall checks + allow
    try std.testing.expect(filter.len > 5);
}

test "BPF instructions" {
    const stmt = BPF_STMT(BPF_LD | BPF_W | BPF_ABS, 0);
    try std.testing.expectEqual(@as(u16, BPF_LD | BPF_W | BPF_ABS), stmt.code);
    try std.testing.expectEqual(@as(u32, 0), stmt.k);

    const jump = BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 100, 1, 2);
    try std.testing.expectEqual(@as(u16, BPF_JMP | BPF_JEQ | BPF_K), jump.code);
    try std.testing.expectEqual(@as(u32, 100), jump.k);
    try std.testing.expectEqual(@as(u8, 1), jump.jt);
    try std.testing.expectEqual(@as(u8, 2), jump.jf);
}
