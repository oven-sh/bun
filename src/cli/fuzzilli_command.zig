const std = @import("std");
const bun = @import("bun");

extern "c" fn Fuzzilli__runReprl(globalObject: *bun.jsc.JSGlobalObject) void;

const Run = bun.bun_js.Run;

pub const FuzzilliCommand = struct {
    pub fn exec(ctx: bun.cli.Command.Context) !void {
        if (!bun.Environment.isPosix) {
            bun.Output.prettyErrorln(
                "<r><red>error<r>: Fuzzilli mode is only supported on POSIX systems",
                .{},
            );
            bun.Global.exit(1);
        }

        // Verify REPRL file descriptors are available
        const REPRL_CRFD: c_int = 100;
        if (!isValidFd(REPRL_CRFD)) {
            bun.Output.prettyErrorln(
                "<r><red>error<r>: REPRL_CRFD (fd {d}) is not available. Run Bun under Fuzzilli.",
                .{REPRL_CRFD},
            );
            bun.Output.prettyErrorln(
                "<r><d>Example: fuzzilli --profile=bun /path/to/bun fuzzilli<r>",
                .{},
            );
            bun.Global.exit(1);
        }

        bun.jsc.initialize(false);

        // Create minimal VM for REPRL
        const arena = bun.MimallocArena.init();
        const vm = try bun.jsc.VirtualMachine.init(.{
            .allocator = arena.allocator(),
            .log = ctx.log,
            .args = ctx.args,
            .is_main_thread = true,
        });

        // Get the global object and run REPRL
        const global = vm.global;
        Fuzzilli__runReprl(global);

        // This never returns (REPRL is infinite loop)
        unreachable;
    }

    fn isValidFd(fd: c_int) bool {
        // Use fcntl F_GETFD to check if fd is valid
        const result = std.c.fcntl(fd, std.posix.F.GETFD);
        return result != -1;
    }
};
