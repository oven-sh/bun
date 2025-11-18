extern "c" fn bun__fuzzilli__begin() void;

pub const FuzzilliCommand = struct {
    pub fn exec(ctx: bun.cli.Command.Context) !void {
        _ = ctx;
        bun__fuzzilli__begin();
    }
};

const bun = @import("bun");
