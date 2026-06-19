const bun = @import("bun");
const Output = bun.Output;
const Global = bun.Global;
const Command = bun.cli.Command;

/// `bun explain` — deprecated alias for `bun why`.
/// GitHub issue #23196: `bun explain` was removed in favor of `bun why`.
/// Always exits 1 except when invoked with `--help`, which exits 0 with
/// a help-style message (Arguments.zig:434-439 short-circuits --help).
pub const ExplainCommand = struct {
    pub fn exec(_ctx: Command.Context) !void {
        Output.prettyErrorln(
            \\<r><red>error<r>: <b>bun explain<r> has been removed.
            \\
            \\Use <green>bun why<r> <blue><package><r> instead. For example:
            \\
            \\<d>  $<r> <b><green>bun why<r> <blue>react<r>
            \\
            \\Full documentation: <magenta>https://bun.com/docs/cli/why<r>
            \\
        , .{});
        Output.flush();
        Global.exit(1);
    }
};
