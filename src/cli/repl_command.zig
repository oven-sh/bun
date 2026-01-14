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

        // Format the filename with PID (null-terminated for syscalls)
        var filename_buf: [64:0]u8 = undefined;
        const filename = std.fmt.bufPrintZ(&filename_buf, "bun-repl-{d}.ts", .{pid}) catch {
            Output.prettyErrorln("<r><red>error<r>: Could not create temp file name", .{});
            Global.exit(1);
        };

        // Join temp_dir and filename using platform-aware path joining
        var temp_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const temp_path = bun.path.joinAbsStringBufZ(temp_dir, &temp_path_buf, &.{filename}, .auto);

        // Open temp directory for openat/unlinkat operations
        const temp_dir_z = std.posix.toPosixPath(temp_dir) catch {
            Output.prettyErrorln("<r><red>error<r>: Temp directory path too long", .{});
            Global.exit(1);
        };
        const temp_dir_fd = switch (bun.sys.open(&temp_dir_z, bun.O.DIRECTORY | bun.O.RDONLY, 0)) {
            .result => |fd| fd,
            .err => {
                Output.prettyErrorln("<r><red>error<r>: Could not access temp directory", .{});
                Global.exit(1);
            },
        };
        defer temp_dir_fd.close();

        const temp_file_fd = switch (bun.sys.openat(temp_dir_fd, filename, bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC, 0o644)) {
            .result => |fd| fd,
            .err => {
                Output.prettyErrorln("<r><red>error<r>: Could not create temp file", .{});
                Global.exit(1);
            },
        };

        // Write the script to the temp file, handling partial writes
        var offset: usize = 0;
        while (offset < repl_script.len) {
            switch (bun.sys.write(temp_file_fd, repl_script[offset..])) {
                .err => {
                    Output.prettyErrorln("<r><red>error<r>: Could not write temp file", .{});
                    temp_file_fd.close();
                    Global.exit(1);
                },
                .result => |written| {
                    if (written == 0) {
                        Output.prettyErrorln("<r><red>error<r>: Could not write temp file: write returned 0 bytes", .{});
                        temp_file_fd.close();
                        Global.exit(1);
                    }
                    offset += written;
                },
            }
        }
        temp_file_fd.close();

        // Ensure cleanup on exit - unlink temp file after Run.boot returns
        defer {
            _ = bun.sys.unlinkat(temp_dir_fd, filename);
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
