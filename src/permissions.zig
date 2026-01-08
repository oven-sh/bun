//! Deno-compatible permissions model for Bun.
//!
//! This module implements a security sandbox with granular permission control over:
//! - File system access (read/write)
//! - Network access (connect/listen)
//! - Environment variable access
//! - Subprocess spawning
//! - FFI/native addon loading
//! - System information access
//!
//! By default, Bun runs in "allow-all" mode for backwards compatibility.
//! Use `--secure` flag to enable secure-by-default mode (like Deno).

const std = @import("std");
const Allocator = std.mem.Allocator;

/// Permission types matching Deno's model
pub const Kind = enum(u8) {
    read,
    write,
    net,
    env,
    sys,
    run,
    ffi,

    pub fn toFlag(self: Kind) []const u8 {
        return switch (self) {
            .read => "--allow-read",
            .write => "--allow-write",
            .net => "--allow-net",
            .env => "--allow-env",
            .sys => "--allow-sys",
            .run => "--allow-run",
            .ffi => "--allow-ffi",
        };
    }

    pub fn toFlagName(self: Kind) []const u8 {
        return switch (self) {
            .read => "read",
            .write => "write",
            .net => "net",
            .env => "env",
            .sys => "sys",
            .run => "run",
            .ffi => "ffi",
        };
    }

    pub fn toName(self: Kind) []const u8 {
        return switch (self) {
            .read => "read",
            .write => "write",
            .net => "network",
            .env => "env",
            .sys => "sys",
            .run => "run",
            .ffi => "ffi",
        };
    }

    pub fn toString(self: Kind) []const u8 {
        return @tagName(self);
    }
};

/// Permission states following Deno's model
pub const State = enum(u8) {
    /// Permission is fully granted
    granted = 0,
    /// Permission is granted for specific resources only
    granted_partial = 1,
    /// Permission will prompt user (default in secure mode)
    prompt = 2,
    /// Permission is fully denied
    denied = 3,
    /// Permission is denied for specific resources, others may prompt
    denied_partial = 4,

    pub fn isGranted(self: State) bool {
        return self == .granted or self == .granted_partial;
    }

    pub fn isDenied(self: State) bool {
        return self == .denied or self == .denied_partial;
    }

    pub fn toJsString(self: State) []const u8 {
        return switch (self) {
            .granted, .granted_partial => "granted",
            .prompt => "prompt",
            .denied, .denied_partial => "denied",
        };
    }
};

/// System information kinds for --allow-sys granularity
pub const SysKind = enum {
    hostname,
    osRelease,
    osUptime,
    loadavg,
    networkInterfaces,
    systemMemoryInfo,
    uid,
    gid,
    username,
    cpus,
    homedir,
    statfs,
    getPriority,
    setPriority,

    pub fn fromString(str: []const u8) ?SysKind {
        const map = std.StaticStringMap(SysKind).initComptime(.{
            .{ "hostname", .hostname },
            .{ "osRelease", .osRelease },
            .{ "osUptime", .osUptime },
            .{ "loadavg", .loadavg },
            .{ "networkInterfaces", .networkInterfaces },
            .{ "systemMemoryInfo", .systemMemoryInfo },
            .{ "uid", .uid },
            .{ "gid", .gid },
            .{ "username", .username },
            .{ "cpus", .cpus },
            .{ "homedir", .homedir },
            .{ "statfs", .statfs },
            .{ "getPriority", .getPriority },
            .{ "setPriority", .setPriority },
        });
        return map.get(str);
    }
};

/// A single permission with optional resource scope
pub const Permission = struct {
    state: State,
    /// Allowed resources (paths, hosts, env vars, commands, etc.)
    /// null means the permission applies to all resources
    allowed: ?[]const []const u8 = null,
    /// Explicitly denied resources (takes precedence over allowed)
    denied_list: ?[]const []const u8 = null,

    /// Check if access to a specific resource is permitted
    pub fn check(self: *const Permission, resource: ?[]const u8) State {
        // First check if explicitly denied
        if (self.denied_list) |denied| {
            if (resource) |r| {
                for (denied) |pattern| {
                    if (matchesPattern(r, pattern)) {
                        return .denied;
                    }
                }
            } else {
                // Requesting access to all resources, but some are denied
                return .denied_partial;
            }
        }

        // If fully granted (no resource list), allow everything
        if (self.state == .granted and self.allowed == null) {
            return .granted;
        }

        // If granted with resource list, check if resource matches
        if (self.allowed) |allowed| {
            if (resource) |r| {
                for (allowed) |pattern| {
                    if (matchesPattern(r, pattern)) {
                        return .granted;
                    }
                }
            }
            // Resource not in allowed list
            return if (self.state == .prompt) .prompt else .denied;
        }

        return self.state;
    }

    /// Check if the permission covers all resources (no restrictions)
    pub fn isUnrestricted(self: *const Permission) bool {
        return self.state == .granted and self.allowed == null and self.denied_list == null;
    }
};

/// Match a resource against a permission pattern
/// Supports:
/// - Exact match
/// - Directory prefix matching for paths (e.g., "/foo" allows "/foo/bar")
/// - Wildcard prefix for env vars (e.g., "AWS_*")
/// - Host:port matching for network
fn matchesPattern(resource: []const u8, pattern: []const u8) bool {
    // Exact match
    if (std.mem.eql(u8, resource, pattern)) {
        return true;
    }

    // Wildcard suffix match (e.g., "AWS_*" matches "AWS_SECRET_KEY")
    if (pattern.len > 0 and pattern[pattern.len - 1] == '*') {
        const prefix = pattern[0 .. pattern.len - 1];
        if (std.mem.startsWith(u8, resource, prefix)) {
            return true;
        }
    }

    // Directory prefix match for paths (e.g., "/foo" allows "/foo/bar")
    // Pattern must be a directory prefix of resource
    if (pattern.len > 0 and (pattern[0] == '/' or pattern[0] == '.')) {
        if (resource.len > pattern.len) {
            if (std.mem.startsWith(u8, resource, pattern)) {
                // Check for path separator after pattern
                if (resource[pattern.len] == '/' or resource[pattern.len] == '\\') {
                    return true;
                }
            }
        }
    }

    // Host:port matching for network permissions
    // Pattern "host" matches "host:port" (any port on that host)
    // Pattern "host:port" requires exact match (handled above)
    if (std.mem.indexOfScalar(u8, resource, ':')) |colon_pos| {
        const resource_host = resource[0..colon_pos];
        if (std.mem.eql(u8, resource_host, pattern)) {
            return true;
        }
    }

    // Command basename matching for run permissions
    // Pattern "cmd" matches "/usr/bin/cmd" or any path ending in "/cmd"
    // Only if pattern doesn't contain path separators
    if (std.mem.indexOfScalar(u8, pattern, '/') == null and
        std.mem.indexOfScalar(u8, pattern, '\\') == null)
    {
        if (std.mem.lastIndexOfScalar(u8, resource, '/')) |last_slash| {
            const basename = resource[last_slash + 1 ..];
            if (std.mem.eql(u8, basename, pattern)) {
                return true;
            }
        }
    }

    return false;
}

/// Central permissions container
pub const Permissions = struct {
    read: Permission = .{ .state = .granted },
    write: Permission = .{ .state = .granted },
    net: Permission = .{ .state = .granted },
    env: Permission = .{ .state = .granted },
    sys: Permission = .{ .state = .granted },
    run: Permission = .{ .state = .granted },
    ffi: Permission = .{ .state = .granted },

    /// Fast path for when all permissions are granted (default mode)
    allow_all: bool = true,

    /// Whether interactive prompts are disabled (always true until prompts are implemented)
    no_prompt: bool = true,

    /// Operating mode: true = secure by default, false = allow all by default
    secure_mode: bool = false,

    /// Allocator for owned resource lists
    allocator: ?Allocator = null,

    /// Initialize with default allow-all permissions (Bun's default mode)
    pub fn initAllowAll() Permissions {
        return .{
            .allow_all = true,
            .secure_mode = false,
        };
    }

    /// Initialize with secure-by-default permissions (Deno-style)
    pub fn initSecure() Permissions {
        return .{
            .read = .{ .state = .prompt },
            .write = .{ .state = .prompt },
            .net = .{ .state = .prompt },
            .env = .{ .state = .prompt },
            .sys = .{ .state = .prompt },
            .run = .{ .state = .prompt },
            .ffi = .{ .state = .prompt },
            .allow_all = false,
            .secure_mode = true,
        };
    }

    /// Check permission with fast path for allow_all
    pub fn check(self: *const Permissions, kind: Kind, resource: ?[]const u8) State {
        // Fast path: if allow_all is true, skip all checks
        if (self.allow_all) {
            return .granted;
        }

        const perm = switch (kind) {
            .read => &self.read,
            .write => &self.write,
            .net => &self.net,
            .env => &self.env,
            .sys => &self.sys,
            .run => &self.run,
            .ffi => &self.ffi,
        };

        return perm.check(resource);
    }

    /// Check if permission is granted (convenience wrapper)
    pub fn isGranted(self: *const Permissions, kind: Kind, resource: ?[]const u8) bool {
        return self.check(kind, resource).isGranted();
    }

    /// Set permission to fully granted
    pub fn grant(self: *Permissions, kind: Kind) void {
        const perm = self.getPermissionMut(kind);
        perm.state = .granted;
        perm.allowed = null;
    }

    /// Set permission to granted with resource list
    pub fn grantWithResources(self: *Permissions, kind: Kind, resources: []const []const u8) void {
        const perm = self.getPermissionMut(kind);
        perm.state = .granted_partial;
        perm.allowed = resources;
        self.allow_all = false;
    }

    /// Set permission to denied
    pub fn deny(self: *Permissions, kind: Kind) void {
        const perm = self.getPermissionMut(kind);
        perm.state = .denied;
        self.allow_all = false;
    }

    /// Add resources to deny list
    pub fn denyResources(self: *Permissions, kind: Kind, resources: []const []const u8) void {
        const perm = self.getPermissionMut(kind);
        perm.denied_list = resources;
        self.allow_all = false;
    }

    fn getPermissionMut(self: *Permissions, kind: Kind) *Permission {
        return switch (kind) {
            .read => &self.read,
            .write => &self.write,
            .net => &self.net,
            .env => &self.env,
            .sys => &self.sys,
            .run => &self.run,
            .ffi => &self.ffi,
        };
    }

    pub fn getPermission(self: *const Permissions, kind: Kind) *const Permission {
        return switch (kind) {
            .read => &self.read,
            .write => &self.write,
            .net => &self.net,
            .env => &self.env,
            .sys => &self.sys,
            .run => &self.run,
            .ffi => &self.ffi,
        };
    }
};

/// Error type for permission denials
pub const PermissionError = error{
    PermissionDenied,
};

/// Format a permission denied error message (Deno-compatible format)
pub fn formatDeniedMessage(
    writer: anytype,
    kind: Kind,
    resource: ?[]const u8,
) !void {
    try writer.print("PermissionDenied: Requires {s} access", .{kind.toString()});
    if (resource) |r| {
        try writer.print(" to \"{s}\"", .{r});
    }
    try writer.print(", run again with the {s} flag", .{kind.toFlag()});
}

test "permission matching - exact" {
    const perm = Permission{
        .state = .granted_partial,
        .allowed = &.{ "/tmp", "/home/user" },
    };

    try std.testing.expectEqual(State.granted, perm.check("/tmp"));
    try std.testing.expectEqual(State.granted, perm.check("/home/user"));
    try std.testing.expectEqual(State.denied, perm.check("/etc"));
}

test "permission matching - directory prefix" {
    const perm = Permission{
        .state = .granted_partial,
        .allowed = &.{"/tmp"},
    };

    try std.testing.expectEqual(State.granted, perm.check("/tmp"));
    try std.testing.expectEqual(State.granted, perm.check("/tmp/foo"));
    try std.testing.expectEqual(State.granted, perm.check("/tmp/foo/bar"));
    try std.testing.expectEqual(State.denied, perm.check("/tmpfoo")); // Not a subdir
}

test "permission matching - wildcard" {
    const perm = Permission{
        .state = .granted_partial,
        .allowed = &.{"AWS_*"},
    };

    try std.testing.expectEqual(State.granted, perm.check("AWS_SECRET_KEY"));
    try std.testing.expectEqual(State.granted, perm.check("AWS_ACCESS_KEY_ID"));
    try std.testing.expectEqual(State.denied, perm.check("PATH"));
}

test "permission deny takes precedence" {
    const perm = Permission{
        .state = .granted,
        .allowed = null,
        .denied_list = &.{"/etc/passwd"},
    };

    try std.testing.expectEqual(State.granted, perm.check("/tmp/foo"));
    try std.testing.expectEqual(State.denied, perm.check("/etc/passwd"));
}

test "permissions - allow all fast path" {
    const perms = Permissions.initAllowAll();
    try std.testing.expect(perms.allow_all);
    try std.testing.expectEqual(State.granted, perms.check(.read, "/etc/passwd"));
    try std.testing.expectEqual(State.granted, perms.check(.net, "example.com:443"));
}

test "permissions - secure mode" {
    const perms = Permissions.initSecure();
    try std.testing.expect(!perms.allow_all);
    try std.testing.expect(perms.secure_mode);
    try std.testing.expectEqual(State.prompt, perms.check(.read, "/etc/passwd"));
    try std.testing.expectEqual(State.prompt, perms.check(.net, "example.com:443"));
}

const bun = @import("bun");
