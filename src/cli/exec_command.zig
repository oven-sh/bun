const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;

// TODO: shell escaping is hard and happens twice in some scenarios
// if '-c' is implemented here, make sure to use it in src/install/lifecycle_script_runner.zig
pub const ExecCommand = struct {
    pub fn exec(ctx: bun.CLI.Command.Context) !void {
        //
        var commandline = std.ArrayList(u8).init(bun.default_allocator);

        for (bun.argv()[2..], 0..) |item, i| {
            if (i > 0) try commandline.append(' ');
            try commandline.appendSlice(item);
        }

        const commandline_pretty = try std.fmt.allocPrint(bun.default_allocator, "\"{s}\"", .{commandline.items});

        var ORIGINAL_PATH: string = "";
        var this_bundler: bun.bundler.Bundler = undefined;
        const root_dir_info = try bun.RunCommand.configureEnvForRun(ctx, &this_bundler, null, true, false);
        try bun.RunCommand.configurePathForRun(ctx, root_dir_info, &this_bundler, &ORIGINAL_PATH, root_dir_info.abs_path, false);

        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        const mini = bun.JSC.MiniEventLoop.initGlobal(this_bundler.env);

        const code = bun.shell.Interpreter.initAndRunFromFileSource(mini, &arena, commandline_pretty, commandline.items) catch |err| {
            Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{ commandline_pretty, @errorName(err) });
            Global.exit(1);
        };

        if (code > 0) {
            if (code != 2) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> script <b>\"{s}\"<r> exited with code {d}<r>", .{ commandline_pretty, code });
                Output.flush();
            }

            Global.exitWide(code);
        }
    }
};
