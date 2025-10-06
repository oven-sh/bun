max_rows: int4 = 0,
p: PortalOrPreparedStatement,

pub fn writeInternal(
    this: *const @This(),
    comptime Context: type,
    writer: NewWriter(Context),
) !void {
    try writer.write("E");
    const length = try writer.length();
    if (this.p == .portal)
        try writer.string(this.p.portal)
    else
        try writer.write(&[_]u8{0});
    try writer.int4(this.max_rows);
    try length.write();
}

pub const write = WriteWrap(@This(), writeInternal).write;

const NewWriter = @import("./NewWriter.zig").NewWriter;
const PortalOrPreparedStatement = @import("./PortalOrPreparedStatement.zig").PortalOrPreparedStatement;
const WriteWrap = @import("./WriteWrap.zig").WriteWrap;

const int_types = @import("../types/int_types.zig");
const int4 = int_types.int4;
