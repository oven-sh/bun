const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const Command = bun.cli.Command;
const Run = bun.bun_js.Run;
const std = @import("std");

pub const ReplCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        @branchHint(.cold);

        // Embed the REPL script
        const repl_script = @embedFile("../js/eval/repl.ts");

        const temp_path = "/tmp/bun-repl.ts";

        // Open /tmp directory
        const temp_dir_fd = switch (bun.sys.open("/tmp", bun.O.DIRECTORY | bun.O.RDONLY, 0)) {
            .result => |fd| fd,
            .err => {
                Output.prettyErrorln("<r><red>error<r>: Could not access /tmp directory", .{});
                Global.exit(1);
            },
        };
        defer temp_dir_fd.close();

        // Create temp file for the script
        const temp_file_name = "bun-repl.ts";
        const temp_file_fd = switch (bun.sys.openat(temp_dir_fd, temp_file_name, bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC, 0o644)) {
            .result => |fd| fd,
            .err => {
                Output.prettyErrorln("<r><red>error<r>: Could not create temp file", .{});
                Global.exit(1);
            },
        };
        defer temp_file_fd.close();

        // Write the script to the temp file
        switch (bun.sys.write(temp_file_fd, repl_script)) {
            .err => {
                Output.prettyErrorln("<r><red>error<r>: Could not write temp file", .{});
                Global.exit(1);
            },
            .result => {},
        }

        // Run the temp file
        try Run.boot(ctx, temp_path, null);
    }
};
