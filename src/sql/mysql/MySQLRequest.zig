pub fn executeQuery(
    query: []const u8,
    comptime Context: type,
    writer: NewWriter(Context),
) !void {
    debug("executeQuery {s}", .{query});
    // resets the sequence id to zero every time we send a query
    var packet = try writer.start(0);
    try writer.int1(@intFromEnum(CommandType.COM_QUERY));
    try writer.write(query);

    try packet.end();
}
pub fn prepareRequest(
    query: []const u8,
    comptime Context: type,
    writer: NewWriter(Context),
) !void {
    debug("prepareRequest {s}", .{query});
    var packet = try writer.start(0);
    try writer.int1(@intFromEnum(CommandType.COM_STMT_PREPARE));
    try writer.write(query);

    try packet.end();
}

const NewWriter = @import("./protocol/NewWriter.zig").NewWriter;
const CommandType = @import("./protocol/CommandType.zig").CommandType;
const ExecutePrepareStatement = @import("./protocol/PreparedStatement.zig").Execute;
const bun = @import("bun");
const debug = bun.Output.scoped(.MySQLRequest, false);
