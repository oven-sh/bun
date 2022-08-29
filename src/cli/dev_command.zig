const Server = @import("../bun_dev_http_server.zig").Server;
const Command = @import("../cli.zig").Command;
const Global = @import("../global.zig").Global;
pub const DevCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        Global.configureAllocator(.{ .long_running = true });
        try Server.start(ctx.allocator, ctx.args, @TypeOf(ctx.debug), ctx.debug);
    }
};
