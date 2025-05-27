const bun = @import("bun");
const Output = bun.Output;
const Global = bun.Global;

const Command = bun.CLI.Command;

pub const ExecCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const script = ctx.positionals[1];
        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()` function to populate environment variables probably should split out the functionality
        var bundle = try bun.Transpiler.init(
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
                Output.err(e, "failed to run script <b>{s}<r>", .{script});
                Global.exit(1);
            },
        };
        const parts: []const []const u8 = &[_][]const u8{
            cwd,
            "[eval]",
        };
        const script_path = bun.path.join(parts, .auto);

        const code = bun.shell.Interpreter.initAndRunFromSource(ctx, mini, script_path, script, null) catch |err| {
            Output.err(err, "failed to run script <b>{s}<r>", .{script_path});
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
