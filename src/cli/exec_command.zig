const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");
const open = @import("../open.zig");
const Command = bun.CLI.Command;

pub const ExecCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const script = ctx.positionals[1];
        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()` function to populate environment variables probably should split out the functionality
        var bundle = try bun.Bundler.init(
            ctx.allocator,
            ctx.log,
            try @import("../bun.js/config.zig").configureTransformOptionsForBunVM(ctx.allocator, ctx.args),
            null,
        );
        try bundle.runEnvLoader(false);
        const mini = bun.JSC.MiniEventLoop.initGlobal(bundle.env);
        var buf: bun.PathBuffer = undefined;

        const cwd = switch (bun.sys.getcwd(&buf)) {
            .result => |p| p,
            .err => |e| {
                Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{ script, e.toSystemError() });
                Global.exit(1);
            },
        };
        const parts: []const []const u8 = &[_][]const u8{
            cwd,
            "[eval]",
        };
        const script_path = bun.path.join(parts, .auto);

        const code = bun.shell.Interpreter.initAndRunFromSource(ctx, mini, script_path, script) catch |err| {
            Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{ script_path, @errorName(err) });
            Global.exit(1);
        };

        // if (code > 0) {
        //     if (code != 2 and !silent) {
        //         Output.prettyErrorln("<r><red>error<r><d>:<r> script <b>\"{s}\"<r> exited with code {d}<r>", .{ name, code });
        //         Output.flush();
        //     }

        Global.exit(code);
        // }
    }
};
