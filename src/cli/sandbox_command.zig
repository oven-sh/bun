/// Sandboxfile: A declarative spec for agent sandboxes
///
/// Usage:
///   bun sandbox [command] [options]
///
/// Commands:
///   run       Run the sandbox (setup + services + dev)
///   test      Run the sandbox and execute tests
///   validate  Validate a Sandboxfile without running
///   init      Create a new Sandboxfile in the current directory
///   exec      Execute a command directly in a Linux namespace sandbox
///   features  Show available sandbox features on this system
pub const SandboxCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        // Check for native sandbox subcommands first
        if (ctx.positionals.len > 1) {
            const subcmd = ctx.positionals[1];
            if (strings.eqlComptime(subcmd, "exec")) {
                return execNativeSandbox(ctx);
            }
            if (strings.eqlComptime(subcmd, "features")) {
                return showFeatures();
            }
        }

        // Fall back to TypeScript CLI for other commands
        var path_buf: bun.PathBuffer = undefined;

        const cli_script = findSandboxCli(&path_buf) orelse {
            Output.errGeneric("Could not find sandbox CLI. Make sure bun-sandbox package exists at packages/bun-sandbox/src/cli.ts", .{});
            Global.exit(1);
        };

        // Build arguments to pass to RunCommand
        // ctx.positionals = ["sandbox", "init", ...args]
        // We need to run: bun <cli_script> <args after "sandbox">
        var run_ctx = ctx;

        // ctx.positionals[0] is "sandbox", [1:] are the actual sandbox command args
        // These need to be in passthrough to be passed to the script as process.argv
        const sandbox_args = if (ctx.positionals.len > 1) ctx.positionals[1..] else &[_][]const u8{};

        // Set positionals to just the script path
        var new_positionals: [1][]const u8 = .{cli_script};
        run_ctx.positionals = &new_positionals;

        // Set passthrough to the sandbox command arguments (init, test, etc.)
        // This is what gets passed to the script as command line args
        run_ctx.passthrough = sandbox_args;

        // Set entry point for RunCommand
        var entry_points: [1][]const u8 = .{cli_script};
        run_ctx.args.entry_points = &entry_points;

        if (try RunCommand.exec(run_ctx, .{
            .bin_dirs_only = false,
            .log_errors = true,
            .allow_fast_run_for_extensions = true,
        })) {
            return;
        }

        Global.exit(1);
    }

    /// Execute a command directly in a Linux namespace sandbox
    /// Usage: bun sandbox exec [options] -- <command> [args...]
    fn execNativeSandbox(ctx: Command.Context) !void {
        if (comptime !bun.Environment.isLinux) {
            Output.errGeneric("Native sandbox execution is only available on Linux", .{});
            Global.exit(1);
        }

        // Parse options and find the command
        // Format: bun sandbox exec [--no-net] [--no-mount] -- command args...
        var no_network = false;
        var no_mount = false;
        var workdir: []const u8 = ".";
        var cmd_start: usize = 2; // Skip "sandbox" and "exec"

        var i: usize = 2;
        while (i < ctx.positionals.len) : (i += 1) {
            const arg = ctx.positionals[i];
            if (strings.eqlComptime(arg, "--")) {
                cmd_start = i + 1;
                break;
            } else if (strings.eqlComptime(arg, "--no-net")) {
                no_network = true;
            } else if (strings.eqlComptime(arg, "--no-mount")) {
                no_mount = true;
            } else if (strings.eqlComptime(arg, "--workdir") or strings.eqlComptime(arg, "-C")) {
                i += 1;
                if (i < ctx.positionals.len) {
                    workdir = ctx.positionals[i];
                }
            } else if (!strings.startsWith(arg, "-")) {
                // First non-option argument is the command
                cmd_start = i;
                break;
            }
        }

        if (cmd_start >= ctx.positionals.len) {
            Output.print("error: No command specified. Usage: bun sandbox exec [options] -- <command> [args...]\n", .{});
            Global.exit(1);
        }

        const cmd_args = ctx.positionals[cmd_start..];

        // Build environment
        var env_list = std.ArrayListUnmanaged([]const u8){};
        defer env_list.deinit(ctx.allocator);

        // Pass through common environment variables
        const pass_vars = [_][:0]const u8{ "PATH", "HOME", "USER", "SHELL", "TERM", "LANG" };
        for (pass_vars) |var_name| {
            if (bun.getenvZ(var_name)) |value| {
                const env_str = std.fmt.allocPrint(ctx.allocator, "{s}={s}", .{ var_name, value }) catch {
                    continue;
                };
                env_list.append(ctx.allocator, env_str) catch continue;
            }
        }

        // Configure sandbox
        const config = Sandbox.SandboxConfig{
            .workdir = workdir,
            .user_namespace = true,
            .mount_namespace = !no_mount,
            .network_namespace = !no_network,
            .share_network = no_network, // If --no-net is not set, share network
            .pid_namespace = false, // Disable for simplicity
            .seccomp = false,
        };

        Output.prettyln("<b>Running in sandbox:<r> ", .{});
        for (cmd_args) |arg| {
            Output.print("{s} ", .{arg});
        }
        Output.print("\n", .{});
        Output.flush();

        // Run the sandbox
        var sandbox = Sandbox.Sandbox.init(ctx.allocator, config);
        defer sandbox.deinit();

        const result = sandbox.exec(cmd_args, env_list.items) catch |err| {
            Output.print("error: Sandbox error: {s}\n", .{@errorName(err)});
            Global.exit(1);
        };

        Output.prettyln("\n<b>Sandbox exited with code:<r> {d}", .{result.exit_code});
        Output.flush();

        Global.exit(result.exit_code);
    }

    /// Show available sandbox features
    fn showFeatures() void {
        if (comptime !bun.Environment.isLinux) {
            Output.prettyln("<b>Sandbox Features (non-Linux):<r>\n", .{});
            Output.print("  Native sandbox execution is only available on Linux.\n", .{});
            Output.print("  On this platform, sandboxing uses process-level isolation only.\n", .{});
            Output.flush();
            return;
        }

        const features = Sandbox.KernelFeatures.detect();

        Output.prettyln("<b>Sandbox Features:<r>\n", .{});
        Output.print("  User Namespaces:    {s}\n", .{if (features.user_namespaces) "\x1b[32menabled\x1b[0m" else "\x1b[31mdisabled\x1b[0m"});
        Output.print("  Overlayfs:          {s}\n", .{if (features.overlayfs) "\x1b[32mavailable\x1b[0m" else "\x1b[31mnot available\x1b[0m"});
        Output.print("  Seccomp-BPF:        {s}\n", .{if (features.seccomp_bpf) "\x1b[32mavailable\x1b[0m" else "\x1b[31mnot available\x1b[0m"});

        Output.prettyln("\n<b>Capabilities:<r>\n", .{});
        if (features.user_namespaces) {
            Output.print("  - Process isolation via Linux namespaces\n", .{});
            Output.print("  - UID/GID mapping (run as root inside sandbox)\n", .{});
        }
        if (features.overlayfs) {
            Output.print("  - Copy-on-write filesystem isolation\n", .{});
        }
        if (features.seccomp_bpf) {
            Output.print("  - Syscall filtering (seccomp-bpf)\n", .{});
        }

        Output.print("\n", .{});
        Output.flush();
    }

    fn findSandboxCli(buf: *bun.PathBuffer) ?[]const u8 {
        // Get current working directory
        const cwd = switch (bun.sys.getcwd(buf)) {
            .result => |p| p,
            .err => return null,
        };

        // Try multiple locations
        const locations = [_][]const u8{
            // Development location (relative to bun repo)
            "packages/bun-sandbox/src/cli.ts",
            // Installed as dependency
            "node_modules/bun-sandbox/src/cli.ts",
        };

        for (locations) |rel_path| {
            const parts: []const []const u8 = &.{ cwd, rel_path };
            const full_path = bun.path.joinZ(parts, .auto);

            // Check if file exists using stat
            switch (bun.sys.stat(full_path)) {
                .result => {
                    return full_path;
                },
                .err => continue,
            }
        }

        return null;
    }

    pub fn printHelp() void {
        Output.pretty(
            \\<b>Usage: bun sandbox <r><cyan>\<command\><r> <cyan>[options]<r>
            \\
            \\Sandboxfile - Declarative agent sandbox configuration
            \\
            \\<b>Commands:<r>
            \\  <cyan>run<r>          Run the sandbox (setup + services + dev)
            \\  <cyan>test<r>         Run the sandbox and execute tests
            \\  <cyan>validate<r>     Validate a Sandboxfile without running
            \\  <cyan>init<r>         Create a new Sandboxfile in the current directory
            \\
            \\<b>Options:<r>
            \\  <cyan>-f, --file<r>   Path to Sandboxfile (default: ./Sandboxfile)
            \\  <cyan>-C, --cwd<r>    Working directory
            \\  <cyan>-v, --verbose<r> Enable verbose output
            \\  <cyan>-n, --dry-run<r> Show what would be done without executing
            \\  <cyan>-h, --help<r>   Show this help message
            \\
            \\<b>Examples:<r>
            \\  bun sandbox run                    Run using ./Sandboxfile
            \\  bun sandbox test -f sandbox.conf   Run tests using custom file
            \\  bun sandbox validate               Validate ./Sandboxfile
            \\  bun sandbox init                   Create a new Sandboxfile
            \\
            \\<b>Sandboxfile directives:<r>
            \\  FROM        Base environment (host or container image)
            \\  WORKDIR     Project root directory
            \\  RUN         Setup commands (run once)
            \\  DEV         Development server (PORT=, WATCH=)
            \\  SERVICE     Background service (required name, PORT=, WATCH=)
            \\  TEST        Test command
            \\  OUTPUT      Files to extract from sandbox
            \\  LOGS        Log file patterns
            \\  NET         Allowed network hosts
            \\  SECRET      Secret environment variables
            \\  INFER       Auto-generate from repo analysis
            \\
        , .{});
        Output.flush();
    }
};

const bun = @import("bun");
const std = @import("std");
const Output = bun.Output;
const Global = bun.Global;
const Command = bun.cli.Command;
const RunCommand = bun.RunCommand;
const strings = bun.strings;
const Sandbox = @import("../sandbox.zig");
