/// Close (F)
/// Byte1('C')
/// - Identifies the message as a Close command.
/// Int32
/// - Length of message contents in bytes, including self.
/// Byte1
/// - 'S' to close a prepared statement; or 'P' to close a portal.
/// String
/// - The name of the prepared statement or portal to close (an empty string selects the unnamed prepared statement or portal).
pub const Close = struct {
    p: PortalOrPreparedStatement,

    fn writeInternal(
        this: *const @This(),
        comptime Context: type,
        writer: NewWriter(Context),
    ) !void {
        const p = this.p;
        const count: u32 = @sizeOf((u32)) + 1 + p.slice().len + 1;
        const header = [_]u8{
            'C',
        } ++ @byteSwap(count) ++ [_]u8{
            p.tag(),
        };
        try writer.write(&header);
        try writer.write(p.slice());
        try writer.write(&[_]u8{0});
    }

    pub const write = WriteWrap(@This(), writeInternal);
};

const NewWriter = @import("./NewWriter.zig").NewWriter;

const PortalOrPreparedStatement = @import("./PortalOrPreparedStatement.zig").PortalOrPreparedStatement;

const WriteWrap = @import("./WriteWrap.zig").WriteWrap;
