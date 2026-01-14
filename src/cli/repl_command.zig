pub const ReplCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        @branchHint(.cold);

        // Embed the REPL script
        const repl_script = @embedFile("../js/eval/repl.ts");

        // Get platform-specific temp directory
        const temp_dir = bun.fs.FileSystem.RealFS.platformTempDir();

        // Create unique temp file name with PID to avoid collisions
        const pid = if (bun.Environment.isWindows)
            std.os.windows.GetCurrentProcessId()
        else
            std.c.getpid();
        var temp_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const temp_path = std.fmt.bufPrint(&temp_path_buf, "{s}/bun-repl-{d}.ts", .{ temp_dir, pid }) catch {
            Output.prettyErrorln("<r><red>error<r>: Could not create temp path", .{});
            Global.exit(1);
        };

        // Open temp directory
        const temp_dir_z = std.fs.path.dirname(temp_path) orelse temp_dir;
        var temp_dir_path_buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
        @memcpy(temp_dir_path_buf[0..temp_dir_z.len], temp_dir_z);
        temp_dir_path_buf[temp_dir_z.len] = 0;
        const temp_dir_fd = switch (bun.sys.open(temp_dir_path_buf[0..temp_dir_z.len :0], bun.O.DIRECTORY | bun.O.RDONLY, 0)) {
            .result => |fd| fd,
            .err => {
                Output.prettyErrorln("<r><red>error<r>: Could not access temp directory", .{});
                Global.exit(1);
            },
        };
        defer temp_dir_fd.close();

        // Create temp file name (basename only)
        const temp_file_name = std.fmt.bufPrint(temp_path_buf[temp_dir.len + 1 ..], "bun-repl-{d}.ts", .{pid}) catch {
            Output.prettyErrorln("<r><red>error<r>: Could not create temp file name", .{});
            Global.exit(1);
        };
        var temp_file_name_z: [64]u8 = undefined;
        @memcpy(temp_file_name_z[0..temp_file_name.len], temp_file_name);
        temp_file_name_z[temp_file_name.len] = 0;

        const temp_file_fd = switch (bun.sys.openat(temp_dir_fd, temp_file_name_z[0..temp_file_name.len :0], bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC, 0o644)) {
            .result => |fd| fd,
            .err => {
                Output.prettyErrorln("<r><red>error<r>: Could not create temp file", .{});
                Global.exit(1);
            },
        };

        // Write the script to the temp file
        switch (bun.sys.write(temp_file_fd, repl_script)) {
            .err => {
                Output.prettyErrorln("<r><red>error<r>: Could not write temp file", .{});
                temp_file_fd.close();
                Global.exit(1);
            },
            .result => {},
        }
        temp_file_fd.close();

        // Ensure cleanup on exit - unlink temp file after Run.boot returns
        defer {
            _ = bun.sys.unlinkat(temp_dir_fd, temp_file_name_z[0..temp_file_name.len :0]);
        }

        // Run the temp file
        try Run.boot(ctx, temp_path, null);
    }
};

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const Command = bun.cli.Command;
const Run = bun.bun_js.Run;
