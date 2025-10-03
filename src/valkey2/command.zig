pub const Command = struct {
    const Self = @This();

    command: []const u8,
    args: CommandArgs,

    pub fn initWithArgs(command: []const u8, args: CommandArgs) Self {
        return Self{
            .command = command,
            .args = args,
        };
    }

    /// Write the command in RESP format to the given writer
    pub fn write(this: *const Self, writer: anytype) !void {
        try writer.print("*{d}\r\n", .{1 + this.args.len()});
        try writer.print("${d}\r\n{s}\r\n", .{
            this.command.len,
            this.command,
        });

        switch (this.args) {
            inline .slices, .args => |args| {
                for (args) |*arg| {
                    try writer.print(
                        "${d}\r\n{s}\r\n",
                        .{ arg.byteLength(), arg.slice() },
                    );
                }
            },
            .raw => |args| {
                for (args) |arg| {
                    try writer.print("${d}\r\n{s}\r\n", .{ arg.len, arg });
                }
            },
        }
    }
};

pub const CommandArgs = union(enum) {
    slices: []const bun.jsc.ZigString.Slice,
    args: []const bun.api.node.BlobOrStringOrBuffer,
    raw: []const []const u8,

    pub fn len(this: *const @This()) usize {
        return switch (this.*) {
            inline .slices, .args, .raw => |args| args.len,
        };
    }
};

const bun = @import("bun");
