//! Permission checking utilities for Deno-compatible security model.
//!
//! This module provides functions to check permissions before performing
//! sensitive operations like file I/O, network access, subprocess spawning, etc.
//!
//! Usage:
//!   const checker = PermissionChecker.init(globalThis);
//!   try checker.requireRead("/path/to/file");
//!   // ... perform read operation

const std = @import("std");
const permissions = @import("../permissions.zig");
const jsc = bun.jsc;
const bun = @import("bun");
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;

/// Permission checker that wraps a JSGlobalObject and provides
/// convenient methods for checking different permission types.
pub const PermissionChecker = struct {
    global: *JSGlobalObject,
    perms: *permissions.Permissions,

    /// Initialize a permission checker from a JSGlobalObject
    pub fn init(global: *JSGlobalObject) PermissionChecker {
        const vm = global.bunVM();
        return .{
            .global = global,
            .perms = vm.permissions,
        };
    }

    /// Check read permission for a path. Throws JS error if denied.
    pub fn requireRead(self: PermissionChecker, path: []const u8) bun.JSError!void {
        return self.require(.read, path);
    }

    /// Check write permission for a path. Throws JS error if denied.
    pub fn requireWrite(self: PermissionChecker, path: []const u8) bun.JSError!void {
        return self.require(.write, path);
    }

    /// Check network permission for a host. Throws JS error if denied.
    pub fn requireNet(self: PermissionChecker, host: []const u8) bun.JSError!void {
        return self.require(.net, host);
    }

    /// Check environment variable permission. Throws JS error if denied.
    pub fn requireEnv(self: PermissionChecker, variable: ?[]const u8) bun.JSError!void {
        return self.require(.env, variable);
    }

    /// Check system info permission. Throws JS error if denied.
    pub fn requireSys(self: PermissionChecker, kind: ?[]const u8) bun.JSError!void {
        return self.require(.sys, kind);
    }

    /// Check run/subprocess permission. Throws JS error if denied.
    pub fn requireRun(self: PermissionChecker, command: []const u8) bun.JSError!void {
        return self.require(.run, command);
    }

    /// Check FFI permission for a library path. Throws JS error if denied.
    pub fn requireFfi(self: PermissionChecker, path: []const u8) bun.JSError!void {
        return self.require(.ffi, path);
    }

    /// Generic permission check. Throws JS error if denied.
    pub fn require(self: PermissionChecker, kind: permissions.Kind, resource: ?[]const u8) bun.JSError!void {
        const state = self.perms.check(kind, resource);

        switch (state) {
            .granted, .granted_partial => return, // OK
            .prompt => {
                // Prompts are disabled for now, treat as denied
                if (self.perms.no_prompt) {
                    return self.throwPermissionDenied(kind, resource);
                }
                // Future: implement interactive prompts here
                return self.throwPermissionDenied(kind, resource);
            },
            .denied, .denied_partial => {
                return self.throwPermissionDenied(kind, resource);
            },
        }
    }

    /// Query permission state without throwing
    pub fn query(self: PermissionChecker, kind: permissions.Kind, resource: ?[]const u8) permissions.State {
        return self.perms.check(kind, resource);
    }

    /// Check if permission is granted (convenience method)
    pub fn isGranted(self: PermissionChecker, kind: permissions.Kind, resource: ?[]const u8) bool {
        return self.perms.isGranted(kind, resource);
    }

    /// Throw a PermissionDenied error with Deno-compatible message format
    fn throwPermissionDenied(self: PermissionChecker, kind: permissions.Kind, resource: ?[]const u8) bun.JSError {
        // Create error message
        const kind_name = kind.toName();
        const flag_name = kind.toFlagName();

        if (resource) |res| {
            return self.global.throwInvalidArguments(
                "PermissionDenied: Requires {s} access to \"{s}\", run again with the --allow-{s} flag",
                .{ kind_name, res, flag_name },
            );
        } else {
            return self.global.throwInvalidArguments(
                "PermissionDenied: Requires {s} access, run again with the --allow-{s} flag",
                .{ kind_name, flag_name },
            );
        }
    }
};

/// Get a permission checker from a JSGlobalObject
pub fn getChecker(global: *JSGlobalObject) PermissionChecker {
    return PermissionChecker.init(global);
}

/// Quick check if read permission is granted for a path
pub fn canRead(global: *JSGlobalObject, path: []const u8) bool {
    return getChecker(global).isGranted(.read, path);
}

/// Quick check if write permission is granted for a path
pub fn canWrite(global: *JSGlobalObject, path: []const u8) bool {
    return getChecker(global).isGranted(.write, path);
}

/// Quick check if network permission is granted for a host
pub fn canNet(global: *JSGlobalObject, host: []const u8) bool {
    return getChecker(global).isGranted(.net, host);
}

/// Quick check if env permission is granted for a variable
pub fn canEnv(global: *JSGlobalObject, variable: ?[]const u8) bool {
    return getChecker(global).isGranted(.env, variable);
}

/// Quick check if sys permission is granted
pub fn canSys(global: *JSGlobalObject, kind: ?[]const u8) bool {
    return getChecker(global).isGranted(.sys, kind);
}

/// Quick check if run permission is granted for a command
pub fn canRun(global: *JSGlobalObject, command: []const u8) bool {
    return getChecker(global).isGranted(.run, command);
}

/// Quick check if FFI permission is granted for a path
pub fn canFfi(global: *JSGlobalObject, path: []const u8) bool {
    return getChecker(global).isGranted(.ffi, path);
}

/// Require read permission, throwing if denied
pub fn requireRead(global: *JSGlobalObject, path: []const u8) bun.JSError!void {
    return getChecker(global).requireRead(path);
}

/// Require write permission, throwing if denied
pub fn requireWrite(global: *JSGlobalObject, path: []const u8) bun.JSError!void {
    return getChecker(global).requireWrite(path);
}

/// Require network permission, throwing if denied
pub fn requireNet(global: *JSGlobalObject, host: []const u8) bun.JSError!void {
    return getChecker(global).requireNet(host);
}

/// Require env permission, throwing if denied
pub fn requireEnv(global: *JSGlobalObject, variable: ?[]const u8) bun.JSError!void {
    return getChecker(global).requireEnv(variable);
}

/// Require sys permission, throwing if denied
pub fn requireSys(global: *JSGlobalObject, kind: ?[]const u8) bun.JSError!void {
    return getChecker(global).requireSys(kind);
}

/// Require run permission, throwing if denied
pub fn requireRun(global: *JSGlobalObject, command: []const u8) bun.JSError!void {
    return getChecker(global).requireRun(command);
}

/// Require FFI permission, throwing if denied
pub fn requireFfi(global: *JSGlobalObject, path: []const u8) bun.JSError!void {
    return getChecker(global).requireFfi(path);
}
