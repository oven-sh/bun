p: PortalOrPreparedStatement,

pub fn writeInternal(
    this: *const @This(),
    comptime Context: type,
    writer: NewWriter(Context),
) !void {
    const message = this.p.slice();
    try writer.write(&[_]u8{
        'D',
    });
    const length = try writer.length();
    try writer.write(&[_]u8{
        this.p.tag(),
    });
    try writer.string(message);
    try length.write();
}

pub const write = WriteWrap(@This(), writeInternal).write;

const NewWriter = @import("./NewWriter.zig").NewWriter;

const PortalOrPreparedStatement = @import("./PortalOrPreparedStatement.zig").PortalOrPreparedStatement;

const WriteWrap = @import("./WriteWrap.zig").WriteWrap;
