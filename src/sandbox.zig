//! Sandbox module for agent sandboxes.
//!
//! This module provides tools for creating and managing ephemeral agent environments
//! based on Sandboxfile declarations.
//!
//! Features:
//! - Sandboxfile parser for declarative sandbox configuration
//! - Linux namespace isolation (user, mount, PID, network, UTS, IPC)
//! - Overlayfs for copy-on-write filesystem
//! - Seccomp BPF for syscall filtering
//!
//! Example:
//! ```zig
//! const sandbox = @import("sandbox");
//!
//! // Parse a Sandboxfile
//! var parser = sandbox.Parser.init(allocator, path, src);
//! const config = try parser.parse();
//!
//! // Run isolated command
//! const result = try sandbox.executor.runIsolated(allocator, &.{"echo", "hello"}, .{});
//! ```

const builtin = @import("builtin");

// Sandboxfile parser
pub const sandboxfile = @import("sandbox/sandboxfile.zig");
pub const Sandboxfile = sandboxfile.Sandboxfile;
pub const Parser = sandboxfile.Parser;
pub const validate = sandboxfile.validate;

// Linux-specific isolation
pub const linux = if (builtin.os.tag == .linux) @import("sandbox/linux.zig") else struct {};
pub const executor = if (builtin.os.tag == .linux) @import("sandbox/executor.zig") else struct {};

// Re-export common types
pub const SandboxConfig = if (builtin.os.tag == .linux) linux.SandboxConfig else struct {};
pub const SandboxResult = if (builtin.os.tag == .linux) executor.SandboxResult else struct {};

/// Check if Linux namespace isolation is available
pub fn isIsolationAvailable() bool {
    if (builtin.os.tag != .linux) return false;

    // Check if unprivileged user namespaces are enabled
    const file = std.fs.openFileAbsolute("/proc/sys/kernel/unprivileged_userns_clone", .{}) catch return true;
    defer file.close();

    var buf: [2]u8 = undefined;
    const n = file.read(&buf) catch return false;
    if (n > 0 and buf[0] == '1') return true;

    return false;
}

const std = @import("std");
