const std = @import("std");
const bun = @import("bun");
const Command = @import("../cli.zig").Command;
const strings = bun.strings;
const Output = bun.Output;
const Global = bun.Global;

const Manager = @import("./process_manager/manager.zig");
const Client = @import("./process_manager/client.zig");
const Protocol = @import("./process_manager/protocol.zig");

pub const ProcessManagerCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const args = ctx.positionals;

        if (args.len == 0) {
            printHelp();
            Global.exit(1);
        }

        const subcommand = args[0];

        if (strings.eqlComptime(subcommand, "start")) {
            try Client.startCommand(ctx);
        } else if (strings.eqlComptime(subcommand, "stop")) {
            try Client.stopCommand(ctx);
        } else if (strings.eqlComptime(subcommand, "list")) {
            try Client.listCommand(ctx);
        } else if (strings.eqlComptime(subcommand, "logs")) {
            try Client.logsCommand(ctx);
        } else {
            Output.errGeneric("Unknown subcommand: {s}", .{subcommand});
            printHelp();
            Global.exit(1);
        }
    }

    fn printHelp() void {
        const help_text =
            \\<b>Usage:<r>
            \\
            \\  <b><green>bun start<r> <cyan>SCRIPT<r>
            \\    Start a process in the background
            \\
            \\  <b><green>bun stop<r> <cyan>NAME<r>
            \\    Stop a running process
            \\
            \\  <b><green>bun list<r>
            \\    List all running processes in this workspace
            \\
            \\  <b><green>bun logs<r> <cyan>NAME<r> [-f]
            \\    Show logs for a process (-f to follow)
            \\
            \\<b>Examples:<r>
            \\
            \\  bun start dev          # Start "dev" script from package.json
            \\  bun start ./server.js  # Start a file directly
            \\  bun list               # See what's running
            \\  bun logs dev           # View dev logs
            \\  bun stop dev           # Stop dev process
            \\
        ;

        Output.pretty(help_text, .{});
        Output.flush();
    }
};
