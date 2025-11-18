const std = @import("std");
const bun = @import("bun");

extern "c" fn Fuzzilli__runReprl(globalObject: *bun.jsc.JSGlobalObject) void;

const Run = bun.bun_js.Run;

pub const FuzzilliCommand = struct {
    pub fn exec(ctx: bun.cli.Command.Context) !void {
        bun.Output.prettyErrorln("<d>[ZIG] FuzzilliCommand.exec() starting<r>", .{});

        if (!bun.Environment.isPosix) {
            bun.Output.prettyErrorln(
                "<r><red>error<r>: Fuzzilli mode is only supported on POSIX systems",
                .{},
            );
            bun.Global.exit(1);
        }

        bun.Output.prettyErrorln("<d>[ZIG] Checking for REPRL file descriptors<r>", .{});

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

        bun.Output.prettyErrorln("<d>[ZIG] REPRL fd check passed<r>", .{});
        bun.Output.prettyErrorln("<d>[ZIG] Initializing JSC<r>", .{});

        bun.jsc.initialize(false);

        bun.Output.prettyErrorln("<d>[ZIG] JSC initialized, creating VM<r>", .{});

        // Create minimal VM for REPRL
        const arena = bun.MimallocArena.init();
        const vm = try bun.jsc.VirtualMachine.init(.{
            .allocator = arena.allocator(),
            .log = ctx.log,
            .args = ctx.args,
            .is_main_thread = true,
        });

        bun.Output.prettyErrorln("<d>[ZIG] VM created, getting global object<r>", .{});

        // Get the global object and run REPRL
        const global = vm.global;
        bun.Output.prettyErrorln("<d>[ZIG] Global object obtained: {*}<r>", .{global});
        bun.Output.prettyErrorln("<d>[ZIG] Calling Fuzzilli__runReprl()<r>", .{});

        Fuzzilli__runReprl(global);

        // This never returns (REPRL is infinite loop)
        bun.Output.prettyErrorln("<d>[ZIG] ERROR: Fuzzilli__runReprl() returned!<r>", .{});
        unreachable;
    }

    fn isValidFd(fd: c_int) bool {
        // Use fcntl F_GETFD to check if fd is valid
        const result = std.c.fcntl(fd, std.posix.F.GETFD);
        return result != -1;
    }
};
