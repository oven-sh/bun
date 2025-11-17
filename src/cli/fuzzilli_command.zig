const std = @import("std");
const bun = @import("bun");
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const std_posix = std.posix;
const Command = bun.cli.Command;

extern "c" fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: c_int) c_int;

const Run = bun.bun_js.Run;

pub const FuzzilliCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        @branchHint(.cold);

        if (!Environment.isPosix) {
            Output.prettyErrorln("<r><red>error<r>: Fuzzilli mode is only supported on POSIX systems", .{});
            Global.exit(1);
        }

        // Set an environment variable so we can detect fuzzilli mode in JavaScript
        _ = setenv("BUN_FUZZILLI_MODE", "1", 1);

        // Verify REPRL file descriptors are available
        const REPRL_CRFD: c_int = 100;
        verifyFd(REPRL_CRFD) catch {
            Output.prettyErrorln("<r><red>error<r>: REPRL_CRFD (fd {d}) is not available. Run Bun under Fuzzilli.", .{REPRL_CRFD});
            Output.prettyErrorln("<r><d>Example: fuzzilli --profile=bun /path/to/bun fuzzilli<r>", .{});
            Global.exit(1);
        };

        // Always embed the REPRL script (it's small and not worth the runtime overhead)
        const reprl_script = @embedFile("../js/internal/fuzzilli-reprl-minimal.ts");

        // Create temp file for the script
        var temp_dir = std.fs.cwd().openDir("/tmp", .{}) catch {
            Output.prettyErrorln("<r><red>error<r>: Could not access /tmp directory", .{});
            Global.exit(1);
        };
        defer temp_dir.close();

        const temp_file_name = "bun-fuzzilli-reprl.js";
        const temp_file = temp_dir.createFile(temp_file_name, .{ .truncate = true }) catch {
            Output.prettyErrorln("<r><red>error<r>: Could not create temp file", .{});
            Global.exit(1);
        };
        defer temp_file.close();

        _ = temp_file.writeAll(reprl_script) catch {
            Output.prettyErrorln("<r><red>error<r>: Could not write temp file", .{});
            Global.exit(1);
        };

        Output.prettyErrorln("<r><d>[FUZZILLI] Temp file written, booting JS runtime<r>", .{});

        // Run the temp file
        const temp_path = "/tmp/bun-fuzzilli-reprl.js";
        try Run.boot(ctx, temp_path, null);
    }

    fn verifyFd(fd: c_int) !void {
        const stat = try std_posix.fstat(fd);
        _ = stat;
    }
};
