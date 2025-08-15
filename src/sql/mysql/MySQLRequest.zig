pub fn executeQuery(
    query: []const u8,
    comptime Context: type,
    writer: NewWriter(Context),
) !void {
    // resets the sequence id to zero every time we send a query
    var packet = try writer.start(0);
    try writer.int1(@intFromEnum(CommandType.COM_QUERY));
    try writer.write(encodeLengthInt(0).slice());
    try writer.write(encodeLengthInt(1).slice()); // Number of parameter sets. Currently always 1
    try writer.write(query);

    try packet.end();
}

const NewWriter = @import("./protocol/NewWriter.zig").NewWriter;
const CommandType = @import("./protocol/CommandType.zig").CommandType;
const encodeLengthInt = @import("./protocol/EncodeInt.zig").encodeLengthInt;
