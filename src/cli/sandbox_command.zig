/// CLI command for running Sandboxfile-based sandboxes
///
/// Usage:
///   bun sandbox [options] [path]
///
/// Options:
///   --test      Run tests only (no dev server)
///   --dry-run   Parse and validate without executing
///   --stop      Stop a running sandbox
///
/// Examples:
///   bun sandbox                    # Run Sandboxfile in current directory
///   bun sandbox ./my-project       # Run Sandboxfile in specified directory
///   bun sandbox --test             # Run tests only
pub const SandboxCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const allocator = ctx.allocator;

        // Parse command line arguments
        var sandboxfile_path: []const u8 = "Sandboxfile";
        var test_only = false;
        var dry_run = false;

        // Check all command line arguments for flags
        for (bun.argv) |arg| {
            if (std.mem.eql(u8, arg, "--test")) {
                test_only = true;
            } else if (std.mem.eql(u8, arg, "--dry-run")) {
                dry_run = true;
            }
        }

        // Skip the first positional (the command name "sandbox")
        const args = if (ctx.positionals.len > 0) ctx.positionals[1..] else ctx.positionals;

        // Check positionals for paths
        for (args) |arg| {
            if (!std.mem.startsWith(u8, arg, "-")) {
                // Path argument
                if (std.fs.path.isAbsolute(arg)) {
                    sandboxfile_path = arg;
                } else {
                    // Construct path to Sandboxfile
                    sandboxfile_path = std.fs.path.join(allocator, &.{ arg, "Sandboxfile" }) catch {
                        Output.prettyErrorln("<r><red>error<r>: Out of memory", .{});
                        Global.exit(1);
                    };
                }
            }
        }

        // Check if Sandboxfile exists
        const file = std.fs.cwd().openFile(sandboxfile_path, .{}) catch |err| {
            if (err == error.FileNotFound) {
                Output.prettyErrorln("<r><red>error<r>: Sandboxfile not found at <b>{s}<r>", .{sandboxfile_path});
                Output.prettyErrorln("", .{});
                Output.prettyErrorln("Create a Sandboxfile to define your sandbox environment:", .{});
                Output.prettyErrorln("", .{});
                Output.prettyErrorln("  <cyan># Sandboxfile<r>", .{});
                Output.prettyErrorln("  <green>FROM<r> host", .{});
                Output.prettyErrorln("  <green>WORKDIR<r> .", .{});
                Output.prettyErrorln("  <green>RUN<r> bun install", .{});
                Output.prettyErrorln("  <green>DEV<r> PORT=3000 bun run dev", .{});
                Output.prettyErrorln("  <green>TEST<r> bun test", .{});
                Output.prettyErrorln("", .{});
                Global.exit(1);
            }
            Output.prettyErrorln("<r><red>error<r>: Failed to open Sandboxfile: {s}", .{@errorName(err)});
            Global.exit(1);
        };
        defer file.close();

        // Read and parse the Sandboxfile
        const source = file.readToEndAlloc(allocator, 1024 * 1024) catch |err| {
            Output.prettyErrorln("<r><red>error<r>: Failed to read Sandboxfile: {s}", .{@errorName(err)});
            Global.exit(1);
        };
        defer allocator.free(source);

        var parser = sandboxfile.Parser.init(allocator, source);
        const config = parser.parse() catch |err| {
            Output.prettyErrorln("<r><red>error<r>: Failed to parse Sandboxfile: {s}", .{@errorName(err)});
            for (parser.getErrors()) |parse_err| {
                Output.prettyErrorln("  line {d}: {s}", .{ parse_err.line, parse_err.message });
            }
            Global.exit(1);
        };

        // Print parsed configuration
        Output.prettyErrorln("<cyan>sandbox<r>: Parsed Sandboxfile:", .{});
        Output.prettyErrorln("  FROM: {s}", .{switch (config.base_env) {
            .host => "host",
            .image => |img| img,
        }});
        Output.prettyErrorln("  WORKDIR: {s}", .{config.workdir});

        if (config.run_commands.items.len > 0) {
            Output.prettyErrorln("  RUN commands: {d}", .{config.run_commands.items.len});
        }
        if (config.dev) |dev| {
            Output.prettyErrorln("  DEV: {s}", .{dev.command});
        }
        if (config.services.items.len > 0) {
            Output.prettyErrorln("  Services: {d}", .{config.services.items.len});
        }
        if (config.tests.items.len > 0) {
            Output.prettyErrorln("  Tests: {d}", .{config.tests.items.len});
        }
        if (config.outputs.items.len > 0) {
            Output.prettyErrorln("  Outputs: {d}", .{config.outputs.items.len});
        }
        if (config.allowed_hosts.items.len > 0) {
            Output.prettyErrorln("  Allowed hosts: {d}", .{config.allowed_hosts.items.len});
        }
        if (config.secrets.items.len > 0) {
            Output.prettyErrorln("  Secrets: {d}", .{config.secrets.items.len});
        }
        Output.prettyErrorln("", .{});
        Output.flush();

        if (dry_run) {
            Output.prettyErrorln("<green>Sandboxfile is valid<r>", .{});
            Output.flush();
            Global.exit(0);
        }

        // Create and run the sandbox
        var runner = sandboxfile.Runner.init(allocator, config);
        defer runner.deinit();

        // Handle interrupt signal to clean up
        // Note: In a real implementation, we'd set up proper signal handling

        if (test_only) {
            // Only run tests
            Output.prettyErrorln("<cyan>sandbox<r>: Running tests only...", .{});
            Output.flush();

            runner.runTests() catch |err| {
                Output.prettyErrorln("<r><red>error<r>: Test execution failed: {s}", .{@errorName(err)});
                runner.stop();
                Global.exit(1);
            };

            if (runner.result.tests_success) {
                Output.prettyErrorln("<green>All tests passed<r>", .{});
                Global.exit(0);
            } else {
                Output.prettyErrorln("<red>Some tests failed<r>", .{});
                for (runner.result.errors.items) |err_msg| {
                    Output.prettyErrorln("  {s}", .{err_msg});
                }
                Global.exit(1);
            }
        }

        // Run the full sandbox
        const result = runner.run() catch |err| {
            Output.prettyErrorln("<r><red>error<r>: Sandbox execution failed: {s}", .{@errorName(err)});
            runner.stop();
            Global.exit(1);
        };

        // Print results
        if (!result.setup_success) {
            Output.prettyErrorln("<red>Setup failed<r>", .{});
            for (result.errors.items) |err_msg| {
                Output.prettyErrorln("  {s}", .{err_msg});
            }
            runner.stop();
            Global.exit(1);
        }

        if (!result.tests_success) {
            Output.prettyErrorln("<yellow>Some tests failed<r>", .{});
            for (result.errors.items) |err_msg| {
                Output.prettyErrorln("  {s}", .{err_msg});
            }
        }

        // Show status
        runner.getStatus();

        // If we have a dev server, wait for it
        if (runner.dev_process != null) {
            Output.prettyErrorln("", .{});
            Output.prettyErrorln("<cyan>sandbox<r>: Dev server is running. Press Ctrl+C to stop.", .{});
            Output.flush();

            // Wait for the dev server to exit
            if (runner.dev_process.?.pid) |pid| {
                _ = std.posix.waitpid(pid, 0);
            }
        }

        runner.stop();
        Global.exit(if (result.setup_success and result.tests_success) 0 else 1);
    }

    pub fn printHelp() void {
        const help_text =
            \\<b>Usage<r>: <b><green>bun sandbox<r> <cyan>[options]<r> <blue>[path]<r>
            \\  Run a sandbox environment defined by a Sandboxfile.
            \\
            \\<b>Options:<r>
            \\  <cyan>--test<r>      Run tests only (no dev server)
            \\  <cyan>--dry-run<r>   Parse and validate without executing
            \\
            \\<b>Arguments:<r>
            \\  <blue>[path]<r>      Path to directory containing Sandboxfile (default: current directory)
            \\
            \\<b>Examples:<r>
            \\  <d>Run sandbox in current directory<r>
            \\  <b><green>bun sandbox<r>
            \\
            \\  <d>Run sandbox in specified directory<r>
            \\  <b><green>bun sandbox<r> <blue>./my-project<r>
            \\
            \\  <d>Run tests only<r>
            \\  <b><green>bun sandbox<r> <cyan>--test<r>
            \\
            \\  <d>Validate Sandboxfile<r>
            \\  <b><green>bun sandbox<r> <cyan>--dry-run<r>
            \\
            \\<b>Sandboxfile Directives:<r>
            \\  <green>FROM<r>       Base environment (host or container image)
            \\  <green>WORKDIR<r>    Working directory
            \\  <green>RUN<r>        Setup command (executed once)
            \\  <green>DEV<r>        Dev server command (PORT=, WATCH= options)
            \\  <green>SERVICE<r>    Background service (name, PORT=, command)
            \\  <green>TEST<r>       Test command
            \\  <green>OUTPUT<r>     Output path (extracted from sandbox)
            \\  <green>LOGS<r>       Log path pattern
            \\  <green>NET<r>        Allowed network host
            \\  <green>SECRET<r>     Secret environment variable
            \\  <green>INFER<r>      Auto-generate from repo analysis
            \\
            \\Full documentation is available at <magenta>https://bun.com/docs/cli/sandbox<r>
            \\
        ;

        Output.pretty(help_text, .{});
        Output.flush();
    }
};

const std = @import("std");
const bun = @import("bun");
const sandboxfile = @import("../sandboxfile.zig");
const Output = bun.Output;
const Global = bun.Global;
const Command = bun.cli.Command;
