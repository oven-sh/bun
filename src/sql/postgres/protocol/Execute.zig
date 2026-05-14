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

const NewWriter = @import("./NewWriter.rust").NewWriter;
const PortalOrPreparedStatement = @import("./PortalOrPreparedStatement.rust").PortalOrPreparedStatement;
const WriteWrap = @import("./WriteWrap.rust").WriteWrap;

const int_types = @import("../types/int_types.rust");
const int4 = int_types.int4;
