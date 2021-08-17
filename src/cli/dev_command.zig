const Server = @import("../http.zig").Server;
const Command = @import("../cli.zig").Command;

pub const DevCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        try Server.start(ctx.allocator, ctx.args);
    }
};
