//! Bun Sandbox Module
//!
//! Provides container-like isolation for running untrusted code.
//! Uses Linux namespaces and overlayfs on Linux, with fallback
//! behavior on other platforms.
//!
//! Features:
//! - Ephemeral filesystem (only OUTPUT paths preserved)
//! - Network access control (NET allowed hosts)
//! - Secret masking (SECRET env vars)
//! - Process isolation (PID namespace)

const std = @import("std");
const bun = @import("bun");
const builtin = @import("builtin");
const Allocator = std.mem.Allocator;

pub const linux = if (builtin.os.tag == .linux) @import("sandbox/linux.zig") else struct {};
pub const sandboxfile = @import("sandboxfile.zig");

const Output = bun.Output;

/// Platform-independent sandbox interface
pub const Sandbox = struct {
    allocator: Allocator,
    config: sandboxfile.Sandboxfile,

    /// Platform-specific implementation
    impl: if (builtin.os.tag == .linux) linux.Sandbox else void,

    /// Whether real sandboxing is available
    sandboxed: bool,

    /// Environment map for fallback mode
    env_map: std.process.EnvMap,

    const Self = @This();

    pub fn init(allocator: Allocator, config: sandboxfile.Sandboxfile) !Self {
        // Set up environment (always needed for BUN_SANDBOX marker)
        var env_map = std.process.EnvMap.init(allocator);

        // Inherit environment
        var parent_env = try std.process.getEnvMap(allocator);
        defer parent_env.deinit();

        var env_iter = parent_env.iterator();
        while (env_iter.next()) |entry| {
            try env_map.put(entry.key_ptr.*, entry.value_ptr.*);
        }

        // Add sandbox marker
        try env_map.put("BUN_SANDBOX", "1");

        var self = Self{
            .allocator = allocator,
            .config = config,
            .impl = undefined,
            .sandboxed = false,
            .env_map = env_map,
        };

        if (builtin.os.tag == .linux) {
            // Check if we can use real sandboxing
            if (linux.checkNamespaceSupport() and linux.checkOverlaySupport()) {
                // Get current directory as root
                var cwd_buf: [std.fs.max_path_bytes]u8 = undefined;
                const cwd = std.fs.cwd().realpath(".", &cwd_buf) catch ".";

                self.impl = linux.Sandbox.init(allocator, .{
                    .root_dir = cwd,
                    .workdir = config.workdir,
                    .output_paths = config.outputs.items,
                    .allowed_hosts = config.allowed_hosts.items,
                    .secrets = config.secrets.items,
                    .env = env_map,
                });

                self.impl.setup() catch |err| {
                    Output.prettyErrorln("<r><yellow>warning<r>: Failed to set up sandbox isolation: {s}", .{@errorName(err)});
                    Output.prettyErrorln("<r><yellow>warning<r>: Running without isolation (changes will persist)", .{});
                    self.sandboxed = false;
                    return self;
                };

                self.sandboxed = true;
            } else {
                Output.prettyErrorln("<r><yellow>warning<r>: Linux namespaces or overlayfs not available", .{});
                Output.prettyErrorln("<r><yellow>warning<r>: Running without isolation", .{});
            }
        } else {
            Output.prettyErrorln("<r><yellow>warning<r>: Sandbox isolation only available on Linux", .{});
            Output.prettyErrorln("<r><yellow>warning<r>: Running without isolation", .{});
        }

        return self;
    }

    /// Run a command inside the sandbox
    pub fn run(self: *Self, command: []const u8) !u8 {
        if (self.sandboxed and builtin.os.tag == .linux) {
            // Run inside isolated sandbox
            const argv = &[_][]const u8{ "/bin/sh", "-c", command };
            return self.impl.exec(argv);
        } else {
            // Fallback: run directly (no isolation)
            return self.runDirect(command);
        }
    }

    /// Run a command directly without isolation (fallback)
    fn runDirect(self: *Self, command: []const u8) !u8 {
        const result = try std.process.Child.run(.{
            .allocator = self.allocator,
            .argv = &.{ "/bin/sh", "-c", command },
            .cwd = self.config.workdir,
            .env_map = &self.env_map,
        });

        if (result.stdout.len > 0) {
            Output.prettyError("{s}", .{result.stdout});
            Output.flush();
        }
        if (result.stderr.len > 0) {
            Output.prettyError("{s}", .{result.stderr});
            Output.flush();
        }

        self.allocator.free(result.stdout);
        self.allocator.free(result.stderr);

        return switch (result.term) {
            .Exited => |code| code,
            .Signal => 128,
            .Stopped => 128,
            .Unknown => 128,
        };
    }

    /// Execute the full Sandboxfile
    pub fn execute(self: *Self) !SandboxResult {
        var result = SandboxResult{
            .setup_success = true,
            .tests_success = true,
            .sandboxed = self.sandboxed,
            .errors = .{},
            .allocator = self.allocator,
        };

        if (self.sandboxed) {
            Output.prettyErrorln("<cyan>sandbox<r>: Running in isolated sandbox", .{});
        } else {
            Output.prettyErrorln("<cyan>sandbox<r>: Running without isolation (changes will persist)", .{});
        }
        Output.flush();

        // Run setup commands
        for (self.config.run_commands.items) |run_cmd| {
            Output.prettyErrorln("<cyan>sandbox<r>: RUN <b>{s}<r>", .{run_cmd.command});
            Output.flush();

            const exit_code = self.run(run_cmd.command) catch |err| {
                result.setup_success = false;
                try result.errors.append(self.allocator, try std.fmt.allocPrint(
                    self.allocator,
                    "RUN command failed: {s} ({s})",
                    .{ run_cmd.command, @errorName(err) },
                ));
                return result;
            };

            if (exit_code != 0) {
                result.setup_success = false;
                try result.errors.append(self.allocator, try std.fmt.allocPrint(
                    self.allocator,
                    "RUN command failed: {s} (exit code {d})",
                    .{ run_cmd.command, exit_code },
                ));
                return result;
            }
        }

        // Run tests
        for (self.config.tests.items) |test_cmd| {
            Output.prettyErrorln("<cyan>sandbox<r>: TEST <b>{s}<r>", .{test_cmd.command});
            Output.flush();

            const exit_code = self.run(test_cmd.command) catch |err| {
                result.tests_success = false;
                try result.errors.append(self.allocator, try std.fmt.allocPrint(
                    self.allocator,
                    "TEST command failed: {s} ({s})",
                    .{ test_cmd.command, @errorName(err) },
                ));
                continue;
            };

            if (exit_code != 0) {
                result.tests_success = false;
                try result.errors.append(self.allocator, try std.fmt.allocPrint(
                    self.allocator,
                    "TEST command failed: {s} (exit code {d})",
                    .{ test_cmd.command, exit_code },
                ));
            }
        }

        return result;
    }

    /// Extract OUTPUT paths from sandbox to destination
    pub fn extractOutputs(self: *Self, dest_dir: []const u8) !void {
        if (self.sandboxed and builtin.os.tag == .linux) {
            try self.impl.extractOutputs(dest_dir);
        }
        // No-op if not sandboxed - files are already in place
    }

    pub fn deinit(self: *Self) void {
        if (self.sandboxed and builtin.os.tag == .linux) {
            self.impl.deinit();
        }
    }
};

pub const SandboxResult = struct {
    setup_success: bool,
    tests_success: bool,
    sandboxed: bool,
    errors: std.ArrayListUnmanaged([]const u8),
    allocator: Allocator,

    pub fn deinit(self: *SandboxResult) void {
        for (self.errors.items) |err| {
            self.allocator.free(err);
        }
        self.errors.deinit(self.allocator);
    }
};

/// Run a Sandboxfile
pub fn runSandboxfile(allocator: Allocator, config: sandboxfile.Sandboxfile) !SandboxResult {
    var sandbox = try Sandbox.init(allocator, config);
    defer sandbox.deinit();

    return sandbox.execute();
}

test "sandbox initialization" {
    const allocator = std.testing.allocator;

    var config = sandboxfile.Sandboxfile{};
    config.workdir = ".";

    var sandbox = try Sandbox.init(allocator, config);
    defer sandbox.deinit();

    // Should at least initialize without crashing
    // Actual sandboxing may not be available in test environment
}
