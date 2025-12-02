pub const FuzzilliCommand = if (bun.Environment.enable_fuzzilli) struct {
    pub fn exec(ctx: Command.Context) !void {
        @branchHint(.cold);

        if (!Environment.isPosix) {
            Output.prettyErrorln("<r><red>error<r>: Fuzzilli mode is only supported on POSIX systems", .{});
            Global.exit(1);
        }

        // Set an environment variable so we can detect fuzzilli mode in JavaScript

        // Verify REPRL file descriptors are available
        const REPRL_CRFD: c_int = 100;
        verifyFd(REPRL_CRFD) catch {
            Output.prettyErrorln("<r><red>error<r>: REPRL_CRFD (fd {d}) is not available. Run Bun under Fuzzilli.", .{REPRL_CRFD});
            Output.prettyErrorln("<r><d>Example: fuzzilli --profile=bun /path/to/bun fuzzilli<r>", .{});
            Global.exit(1);
        };

        // Always embed the REPRL script (it's small and not worth the runtime overhead)
        const reprl_script = @embedFile("../js/eval/fuzzilli-reprl.ts");

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
        const temp_file_name = "bun-fuzzilli-reprl.js";
        const temp_file_fd = switch (bun.sys.openat(temp_dir_fd, temp_file_name, bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC, 0o644)) {
            .result => |fd| fd,
            .err => {
                Output.prettyErrorln("<r><red>error<r>: Could not create temp file", .{});
                Global.exit(1);
            },
        };
        defer temp_file_fd.close();

        // Write the script to the temp file
        switch (bun.sys.write(temp_file_fd, reprl_script)) {
            .err => {
                Output.prettyErrorln("<r><red>error<r>: Could not write temp file", .{});
                Global.exit(1);
            },
            .result => {},
        }

        Output.prettyErrorln("<r><d>[FUZZILLI] Temp file written, booting JS runtime<r>", .{});

        // Run the temp file
        const temp_path = "/tmp/bun-fuzzilli-reprl.js";
        try Run.boot(ctx, temp_path, null);
    }

    fn verifyFd(fd: c_int) !void {
        const stat = try std_posix.fstat(fd);
        _ = stat;
    }
} else {};

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const Command = bun.cli.Command;
const Run = bun.bun_js.Run;

const std = @import("std");
const std_posix = std.posix;
