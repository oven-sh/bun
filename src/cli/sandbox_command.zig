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
pub const SandboxCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        // The sandbox command is implemented in TypeScript for flexibility.
        // We execute the CLI script using Bun's runtime.
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
