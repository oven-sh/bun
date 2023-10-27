const Command = @import("../cli.zig").Command;

pub const DevCommand = struct {
    pub fn exec(ctx: *Command.Context) !void {
        if (comptime @import("root").bun.Environment.isWindows) unreachable;

        const Server = @import("../bun_dev_http_server.zig").Server;
        const Global = @import("root").bun.Global;
        Global.configureAllocator(.{ .long_running = true });
        try Server.start(ctx.allocator, ctx.args, @TypeOf(ctx.debug), ctx.debug);
    }
};
