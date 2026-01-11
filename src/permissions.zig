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

/// Network permission protocol types
pub const NetProtocol = enum {
    http,
    https,
    ws,
    wss,

    pub fn fromString(str: []const u8) ?NetProtocol {
        const map = std.StaticStringMap(NetProtocol).initComptime(.{
            .{ "http", .http },
            .{ "https", .https },
            .{ "ws", .ws },
            .{ "wss", .wss },
        });
        return map.get(str);
    }
};

/// Port pattern for network permissions
pub const PortPattern = union(enum) {
    any, // * or omitted - matches any port
    none, // invalid pattern - matches no ports (fail closed for security)
    single: u16, // :443 - matches exactly this port
    list: []const u16, // :80;443 - matches any of these ports (semicolon-separated)
    range: struct { min: u16, max: u16 }, // :8000-9000 - matches ports in range

    pub fn matches(self: PortPattern, port: ?u16) bool {
        return switch (self) {
            .any => true,
            .none => false, // Invalid patterns fail closed - deny access
            .single => |p| if (port) |rp| rp == p else false,
            .list => |ports| {
                if (port) |rp| {
                    for (ports) |p| {
                        if (p == rp) return true;
                    }
                }
                return false;
            },
            .range => |r| if (port) |rp| rp >= r.min and rp <= r.max else false,
        };
    }
};

/// Match a resource against a permission pattern
/// Supports:
/// - Exact match
/// - Directory prefix matching for paths (e.g., "/foo" allows "/foo/bar")
/// - Wildcard prefix for env vars (e.g., "AWS_*")
/// - Host:port matching for network
/// - Network wildcards (*.example.com, **.example.com, :8000-9000, https://...)
fn matchesPattern(resource: []const u8, pattern: []const u8) bool {
    // Exact match
    if (std.mem.eql(u8, resource, pattern)) {
        return true;
    }

    // Check if this is a network pattern with advanced wildcards
    if (isNetworkPattern(pattern)) {
        return matchesNetworkPatternString(resource, pattern);
    }

    // Wildcard suffix match (e.g., "AWS_*" matches "AWS_SECRET_KEY")
    if (pattern.len > 0 and pattern[pattern.len - 1] == '*') {
        const prefix = pattern[0 .. pattern.len - 1];
        if (std.mem.startsWith(u8, resource, prefix)) {
            return true;
        }
    }

    // Directory prefix match for paths (e.g., "/foo" allows "/foo/bar", "/tmp/" allows "/tmp/foo")
    // Pattern must be a directory prefix of resource
    // Handle both POSIX (/...) and Windows (C:\...) absolute paths
    if (pattern.len > 0 and (pattern[0] == '/' or pattern[0] == '.' or isWindowsDrivePath(pattern))) {
        // Strip trailing separators from pattern for consistent matching
        const trimmed_pattern = std.mem.trimRight(u8, pattern, "/\\");
        if (resource.len > trimmed_pattern.len) {
            if (std.mem.startsWith(u8, resource, trimmed_pattern)) {
                // Check for path separator after pattern
                if (resource[trimmed_pattern.len] == '/' or resource[trimmed_pattern.len] == '\\') {
                    return true;
                }
            }
        }
    }

    // Host:port matching for network permissions
    // Pattern "host" matches "host:port" (any port on that host)
    // Pattern "host:port" requires exact match (handled above)
    // Use findPortSeparator to handle IPv6 addresses correctly (e.g., [::1]:8080)
    if (findPortSeparator(resource)) |colon_pos| {
        const resource_host = resource[0..colon_pos];
        if (std.mem.eql(u8, resource_host, pattern)) {
            return true;
        }
    }

    // Command basename matching for run permissions
    // Pattern "cmd" matches "/usr/bin/cmd" or "C:\bin\cmd.exe"
    // Only if pattern doesn't contain path separators
    if (std.mem.indexOfScalar(u8, pattern, '/') == null and
        std.mem.indexOfScalar(u8, pattern, '\\') == null)
    {
        // Find the last path separator (either / or \)
        const last_sep_pos = blk: {
            const last_slash = std.mem.lastIndexOfScalar(u8, resource, '/');
            const last_backslash = std.mem.lastIndexOfScalar(u8, resource, '\\');
            if (last_slash) |s| {
                if (last_backslash) |b| {
                    break :blk @max(s, b);
                }
                break :blk s;
            }
            break :blk last_backslash;
        };
        if (last_sep_pos) |pos| {
            const basename = resource[pos + 1 ..];
            if (std.mem.eql(u8, basename, pattern)) {
                return true;
            }
        }
    }

    return false;
}

/// Check if a path is a Windows drive-letter absolute path (e.g., "C:\..." or "D:/...")
fn isWindowsDrivePath(path: []const u8) bool {
    if (path.len < 2) return false;
    // Check for drive letter followed by colon
    const first = path[0];
    if ((first >= 'A' and first <= 'Z') or (first >= 'a' and first <= 'z')) {
        if (path[1] == ':') {
            // Optional check for separator after colon
            if (path.len == 2) return true;
            return path[2] == '/' or path[2] == '\\';
        }
    }
    return false;
}

/// Check if pattern uses advanced network wildcards
fn isNetworkPattern(pattern: []const u8) bool {
    // Contains protocol prefix (e.g., "https://")
    if (std.mem.indexOf(u8, pattern, "://") != null) return true;
    // Contains domain wildcards
    if (std.mem.indexOf(u8, pattern, "*.") != null) return true;
    if (std.mem.indexOf(u8, pattern, "**.") != null) return true;
    // Contains port wildcard
    if (std.mem.endsWith(u8, pattern, ":*")) return true;
    // Contains port range (e.g., :8000-9000)
    if (hasPortRange(pattern)) return true;
    // Contains port list (e.g., :80;443)
    if (hasPortList(pattern)) return true;
    return false;
}

fn hasPortRange(pattern: []const u8) bool {
    // Look for :digits-digits at the end
    if (std.mem.lastIndexOfScalar(u8, pattern, ':')) |colon_pos| {
        const port_part = pattern[colon_pos + 1 ..];
        if (std.mem.indexOfScalar(u8, port_part, '-')) |dash_pos| {
            // Verify both sides are digits
            const left = port_part[0..dash_pos];
            const right = port_part[dash_pos + 1 ..];
            if (left.len > 0 and right.len > 0) {
                for (left) |c| if (!std.ascii.isDigit(c)) return false;
                for (right) |c| if (!std.ascii.isDigit(c)) return false;
                return true;
            }
        }
    }
    return false;
}

fn hasPortList(pattern: []const u8) bool {
    // Look for :digits;digits at the end (semicolon-separated to avoid conflict with CLI comma separator)
    if (std.mem.lastIndexOfScalar(u8, pattern, ':')) |colon_pos| {
        const port_part = pattern[colon_pos + 1 ..];
        if (std.mem.indexOfScalar(u8, port_part, ';') != null) {
            // Verify it's semicolon-separated digits
            var iter = std.mem.splitScalar(u8, port_part, ';');
            while (iter.next()) |seg| {
                const trimmed = std.mem.trim(u8, seg, " ");
                if (trimmed.len == 0) return false;
                for (trimmed) |c| if (!std.ascii.isDigit(c)) return false;
            }
            return true;
        }
    }
    return false;
}

/// Match a resource against an advanced network pattern
fn matchesNetworkPatternString(resource: []const u8, pattern: []const u8) bool {
    var pat_remaining = pattern;
    var res_remaining = resource;

    // Parse protocol from pattern (if present)
    var pat_protocol: ?NetProtocol = null;
    if (std.mem.indexOf(u8, pat_remaining, "://")) |proto_end| {
        pat_protocol = NetProtocol.fromString(pat_remaining[0..proto_end]);
        pat_remaining = pat_remaining[proto_end + 3 ..];
    }

    // Parse protocol from resource (if present)
    var res_protocol: ?NetProtocol = null;
    if (std.mem.indexOf(u8, res_remaining, "://")) |proto_end| {
        res_protocol = NetProtocol.fromString(res_remaining[0..proto_end]);
        res_remaining = res_remaining[proto_end + 3 ..];
    }

    // If pattern specifies a protocol, resource must match
    if (pat_protocol) |pp| {
        if (res_protocol) |rp| {
            if (pp != rp) return false;
        }
        // If resource has no protocol, allow match (backward compat)
    }

    // Parse port from pattern
    var pat_host = pat_remaining;
    var pat_port_pattern: PortPattern = .any;
    var port_list_buf: [16]u16 = undefined; // Local buffer for port list parsing
    if (findPortSeparator(pat_remaining)) |colon_pos| {
        pat_host = pat_remaining[0..colon_pos];
        const port_str = pat_remaining[colon_pos + 1 ..];
        pat_port_pattern = parsePortPatternString(port_str, &port_list_buf);
    }

    // Parse port from resource
    var res_host = res_remaining;
    var res_port: ?u16 = null;
    if (findPortSeparator(res_remaining)) |colon_pos| {
        res_host = res_remaining[0..colon_pos];
        const port_str = res_remaining[colon_pos + 1 ..];
        res_port = std.fmt.parseInt(u16, port_str, 10) catch null;
    }

    // Check port match
    // If pattern is .none (invalid), always deny
    if (pat_port_pattern == .none) {
        return false;
    }
    if (!pat_port_pattern.matches(res_port)) {
        // Special case: if pattern has no port spec and resource has port,
        // allow match for backward compatibility
        if (pat_port_pattern != .any or res_port == null) {
            return false;
        }
    }

    // Check host match with wildcards
    return matchesHostPattern(res_host, pat_host);
}

/// Find the position of port separator, handling IPv6 addresses
fn findPortSeparator(s: []const u8) ?usize {
    // IPv6 addresses are enclosed in brackets: [::1]:8080
    if (s.len > 0 and s[0] == '[') {
        if (std.mem.indexOfScalar(u8, s, ']')) |bracket_end| {
            if (bracket_end + 1 < s.len and s[bracket_end + 1] == ':') {
                return bracket_end + 1;
            }
            return null;
        }
        return null;
    }
    // For regular hosts, use last colon
    return std.mem.lastIndexOfScalar(u8, s, ':');
}

/// Parse a port pattern string into a PortPattern
/// The caller must provide a buffer for port lists to avoid thread-local state issues.
/// The returned PortPattern.list slice points into the provided buffer.
/// On parse errors, returns .none (fail closed) to avoid accidentally granting broader permissions.
fn parsePortPatternString(port_str: []const u8, port_buf: *[16]u16) PortPattern {
    if (port_str.len == 0 or std.mem.eql(u8, port_str, "*")) {
        return .any;
    }

    // Check for range (e.g., "8000-9000")
    if (std.mem.indexOfScalar(u8, port_str, '-')) |dash_pos| {
        const min_str = port_str[0..dash_pos];
        const max_str = port_str[dash_pos + 1 ..];
        // Fail closed on parse errors - don't accidentally grant access
        const min_port = std.fmt.parseInt(u16, min_str, 10) catch return .none;
        const max_port = std.fmt.parseInt(u16, max_str, 10) catch return .none;
        if (min_port <= max_port) {
            return .{ .range = .{ .min = min_port, .max = max_port } };
        }
        // Invalid range (min > max) - fail closed
        return .none;
    }

    // Check for list (e.g., "80;443") - semicolon-separated to avoid conflict with CLI comma separator
    if (std.mem.indexOfScalar(u8, port_str, ';') != null) {
        // Count ports
        var count: usize = 0;
        var iter = std.mem.splitScalar(u8, port_str, ';');
        while (iter.next()) |_| count += 1;

        // Parse into caller-provided buffer (max 16 ports)
        if (count <= 16) {
            var i: usize = 0;
            iter = std.mem.splitScalar(u8, port_str, ';');
            while (iter.next()) |seg| {
                const trimmed = std.mem.trim(u8, seg, " ");
                // Fail closed on parse errors
                port_buf[i] = std.fmt.parseInt(u16, trimmed, 10) catch return .none;
                i += 1;
            }
            return .{ .list = port_buf[0..count] };
        }
        // Too many ports (>16) - fail closed
        return .none;
    }

    // Single port - fail closed on parse errors
    const port = std.fmt.parseInt(u16, port_str, 10) catch return .none;
    return .{ .single = port };
}

/// Match a host against a pattern with wildcards
/// Supports:
///   * - matches exactly one domain segment
///   ** - matches one or more domain segments
fn matchesHostPattern(resource_host: []const u8, pattern_host: []const u8) bool {
    // Split into segments
    var pat_segs: [32][]const u8 = undefined;
    var pat_count: usize = 0;
    var pat_iter = std.mem.splitScalar(u8, pattern_host, '.');
    while (pat_iter.next()) |seg| {
        if (pat_count >= 32) return false;
        pat_segs[pat_count] = seg;
        pat_count += 1;
    }

    var res_segs: [32][]const u8 = undefined;
    var res_count: usize = 0;
    var res_iter = std.mem.splitScalar(u8, resource_host, '.');
    while (res_iter.next()) |seg| {
        if (res_count >= 32) return false;
        res_segs[res_count] = seg;
        res_count += 1;
    }

    // Find ** position
    var double_star_pos: ?usize = null;
    for (pat_segs[0..pat_count], 0..) |seg, i| {
        if (std.mem.eql(u8, seg, "**")) {
            double_star_pos = i;
            break;
        }
    }

    if (double_star_pos) |ds_pos| {
        return matchesWithDoubleStar(pat_segs[0..pat_count], ds_pos, res_segs[0..res_count]);
    } else {
        return matchesWithSingleStar(pat_segs[0..pat_count], res_segs[0..res_count]);
    }
}

/// Match with * wildcards (each * matches exactly one segment)
fn matchesWithSingleStar(pattern_segs: []const []const u8, resource_segs: []const []const u8) bool {
    if (pattern_segs.len != resource_segs.len) {
        return false;
    }

    for (pattern_segs, resource_segs) |pat, res| {
        if (std.mem.eql(u8, pat, "*")) {
            continue; // * matches any single segment
        }
        if (!std.ascii.eqlIgnoreCase(pat, res)) {
            return false;
        }
    }
    return true;
}

/// Match with ** wildcard (matches one or more segments)
fn matchesWithDoubleStar(pattern_segs: []const []const u8, double_star_pos: usize, resource_segs: []const []const u8) bool {
    const before_star = pattern_segs[0..double_star_pos];
    const after_star = pattern_segs[double_star_pos + 1 ..];

    // ** matches at least one segment
    const min_res_len = before_star.len + after_star.len + 1;
    if (resource_segs.len < min_res_len) {
        return false;
    }

    // Match segments before **
    for (before_star, 0..) |pat, i| {
        if (std.mem.eql(u8, pat, "*")) {
            continue;
        }
        if (!std.ascii.eqlIgnoreCase(pat, resource_segs[i])) {
            return false;
        }
    }

    // Match segments after ** (from the end)
    const res_end_start = resource_segs.len - after_star.len;
    for (after_star, 0..) |pat, i| {
        if (std.mem.eql(u8, pat, "*")) {
            continue;
        }
        if (!std.ascii.eqlIgnoreCase(pat, resource_segs[res_end_start + i])) {
            return false;
        }
    }

    return true;
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

    /// Set permission to granted with resource list.
    /// If resources is empty, the permission is denied (no access granted).
    pub fn grantWithResources(self: *Permissions, kind: Kind, resources: []const []const u8) void {
        const perm = self.getPermissionMut(kind);
        if (resources.len == 0) {
            // Empty resource list means no access granted - treat as denied
            perm.state = .denied;
            perm.allowed = null;
        } else {
            perm.state = .granted_partial;
            perm.allowed = resources;
        }
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

test "network wildcard - single segment *" {
    // *.example.com should match api.example.com
    try std.testing.expect(matchesPattern("api.example.com", "*.example.com"));
    try std.testing.expect(matchesPattern("www.example.com", "*.example.com"));
    // *.example.com should NOT match api.v2.example.com (too deep)
    try std.testing.expect(!matchesPattern("api.v2.example.com", "*.example.com"));
    // *.example.com should NOT match example.com (too shallow)
    try std.testing.expect(!matchesPattern("example.com", "*.example.com"));
}

test "network wildcard - double segment **" {
    // **.example.com should match api.example.com
    try std.testing.expect(matchesPattern("api.example.com", "**.example.com"));
    // **.example.com should match api.v2.example.com
    try std.testing.expect(matchesPattern("api.v2.example.com", "**.example.com"));
    // **.example.com should match a.b.c.example.com
    try std.testing.expect(matchesPattern("a.b.c.example.com", "**.example.com"));
    // **.example.com should NOT match example.com (** needs at least one segment)
    try std.testing.expect(!matchesPattern("example.com", "**.example.com"));
}

test "network wildcard - middle position" {
    // api.*.example.com should match api.v1.example.com
    try std.testing.expect(matchesPattern("api.v1.example.com", "api.*.example.com"));
    // api.*.example.com should NOT match api.v1.v2.example.com
    try std.testing.expect(!matchesPattern("api.v1.v2.example.com", "api.*.example.com"));
}

test "network wildcard - port patterns" {
    // :* matches any port
    try std.testing.expect(matchesPattern("example.com:443", "example.com:*"));
    try std.testing.expect(matchesPattern("example.com:8080", "example.com:*"));
    // :443 matches only 443
    try std.testing.expect(matchesPattern("example.com:443", "example.com:443"));
    try std.testing.expect(!matchesPattern("example.com:80", "example.com:443"));
    // :80;443 matches 80 or 443 (semicolon-separated)
    try std.testing.expect(matchesPattern("example.com:80", "example.com:80;443"));
    try std.testing.expect(matchesPattern("example.com:443", "example.com:80;443"));
    try std.testing.expect(!matchesPattern("example.com:8080", "example.com:80;443"));
    // :8000-9000 matches range
    try std.testing.expect(matchesPattern("example.com:8000", "example.com:8000-9000"));
    try std.testing.expect(matchesPattern("example.com:8500", "example.com:8000-9000"));
    try std.testing.expect(matchesPattern("example.com:9000", "example.com:8000-9000"));
    try std.testing.expect(!matchesPattern("example.com:7999", "example.com:8000-9000"));
    try std.testing.expect(!matchesPattern("example.com:9001", "example.com:8000-9000"));
}

test "network wildcard - protocol prefix" {
    // https:// matches only https
    try std.testing.expect(matchesPattern("https://example.com", "https://example.com"));
    try std.testing.expect(!matchesPattern("http://example.com", "https://example.com"));
    // Combined with wildcards
    try std.testing.expect(matchesPattern("https://api.example.com", "https://*.example.com"));
    try std.testing.expect(!matchesPattern("http://api.example.com", "https://*.example.com"));
}

test "network wildcard - backward compatibility" {
    // Plain host still matches host:port
    try std.testing.expect(matchesPattern("example.com:443", "example.com"));
    try std.testing.expect(matchesPattern("127.0.0.1:3000", "127.0.0.1"));
}

test "network wildcard - case insensitive" {
    try std.testing.expect(matchesPattern("API.Example.COM", "*.example.com"));
    try std.testing.expect(matchesPattern("api.example.com", "*.EXAMPLE.COM"));
}

test "path matching - trailing separator" {
    // Pattern with trailing slash should match files in that directory
    try std.testing.expect(matchesPattern("/tmp/foo", "/tmp/"));
    try std.testing.expect(matchesPattern("/tmp/foo/bar", "/tmp/"));
    // Pattern without trailing slash should also work
    try std.testing.expect(matchesPattern("/tmp/foo", "/tmp"));
    // Exact match should still work
    try std.testing.expect(matchesPattern("/tmp/", "/tmp/"));
}

test "path matching - Windows drive paths" {
    // Windows absolute paths
    try std.testing.expect(matchesPattern("C:\\foo\\bar", "C:\\foo"));
    try std.testing.expect(matchesPattern("C:\\foo\\bar\\baz", "C:\\foo"));
    // With trailing backslash
    try std.testing.expect(matchesPattern("C:\\foo\\bar", "C:\\foo\\"));
    // Mixed separators (Windows allows both)
    try std.testing.expect(matchesPattern("C:/foo/bar", "C:/foo"));
}

test "path matching - Windows basename" {
    // Pattern without path separators should match Windows paths
    try std.testing.expect(matchesPattern("C:\\Windows\\System32\\cmd.exe", "cmd.exe"));
    try std.testing.expect(matchesPattern("D:\\bin\\node.exe", "node.exe"));
    // POSIX paths should still work
    try std.testing.expect(matchesPattern("/usr/bin/node", "node"));
}

test "isWindowsDrivePath" {
    try std.testing.expect(isWindowsDrivePath("C:\\foo"));
    try std.testing.expect(isWindowsDrivePath("D:/bar"));
    try std.testing.expect(isWindowsDrivePath("c:\\lowercase"));
    try std.testing.expect(isWindowsDrivePath("Z:\\"));
    try std.testing.expect(!isWindowsDrivePath("/unix/path"));
    try std.testing.expect(!isWindowsDrivePath("relative/path"));
    try std.testing.expect(!isWindowsDrivePath("C")); // Too short
}
