pub const CloseComplete = [_]u8{'3'} ++ toBytes(Int32(4));
pub const EmptyQueryResponse = [_]u8{'I'} ++ toBytes(Int32(4));
pub const Terminate = [_]u8{'X'} ++ toBytes(Int32(4));

pub const BindComplete = [_]u8{'2'} ++ toBytes(Int32(4));

pub const ParseComplete = [_]u8{'1'} ++ toBytes(Int32(4));

pub const CopyDone = [_]u8{'c'} ++ toBytes(Int32(4));
pub const Sync = [_]u8{'S'} ++ toBytes(Int32(4));
pub const Flush = [_]u8{'H'} ++ toBytes(Int32(4));
pub const SSLRequest = toBytes(Int32(8)) ++ toBytes(Int32(80877103));
pub const NoData = [_]u8{'n'} ++ toBytes(Int32(4));

pub fn writeQuery(query: []const u8, comptime Context: type, writer: NewWriter(Context)) !void {
    const count: u32 = @sizeOf((u32)) + @as(u32, @intCast(query.len)) + 1;
    const header = [_]u8{
        'Q',
    } ++ toBytes(Int32(count));
    try writer.write(&header);
    try writer.string(query);
}

pub const ArrayList = @import("./protocol/ArrayList.zig");
pub const BackendKeyData = @import("./protocol/BackendKeyData.zig");
pub const CommandComplete = @import("./protocol/CommandComplete.zig");
pub const CopyData = @import("./protocol/CopyData.zig");
pub const CopyFail = @import("./protocol/CopyFail.zig");
pub const DataRow = @import("./protocol/DataRow.zig");
pub const Describe = @import("./protocol/Describe.zig");
pub const ErrorResponse = @import("./protocol/ErrorResponse.zig");
pub const Execute = @import("./protocol/Execute.zig");
pub const FieldDescription = @import("./protocol/FieldDescription.zig");
pub const NegotiateProtocolVersion = @import("./protocol/NegotiateProtocolVersion.zig");
pub const NoticeResponse = @import("./protocol/NoticeResponse.zig");
pub const NotificationResponse = @import("./protocol/NotificationResponse.zig");
pub const ParameterDescription = @import("./protocol/ParameterDescription.zig");
pub const ParameterStatus = @import("./protocol/ParameterStatus.zig");
pub const Parse = @import("./protocol/Parse.zig");
pub const PasswordMessage = @import("./protocol/PasswordMessage.zig");
pub const ReadyForQuery = @import("./protocol/ReadyForQuery.zig");
pub const RowDescription = @import("./protocol/RowDescription.zig");
pub const SASLInitialResponse = @import("./protocol/SASLInitialResponse.zig");
pub const SASLResponse = @import("./protocol/SASLResponse.zig");
pub const StackReader = @import("./protocol/StackReader.zig");
pub const StartupMessage = @import("./protocol/StartupMessage.zig");
pub const Authentication = @import("./protocol/Authentication.zig").Authentication;
pub const ColumnIdentifier = @import("../shared/ColumnIdentifier.zig").ColumnIdentifier;
pub const DecoderWrap = @import("./protocol/DecoderWrap.zig").DecoderWrap;
pub const FieldMessage = @import("./protocol/FieldMessage.zig").FieldMessage;
pub const FieldType = @import("./protocol/FieldType.zig").FieldType;
pub const NewReader = @import("./protocol/NewReader.zig").NewReader;
pub const NewWriter = @import("./protocol/NewWriter.zig").NewWriter;
pub const PortalOrPreparedStatement = @import("./protocol/PortalOrPreparedStatement.zig").PortalOrPreparedStatement;
pub const WriteWrap = @import("./protocol/WriteWrap.zig").WriteWrap;

const std = @import("std");
const types = @import("./PostgresTypes.zig");
const toBytes = std.mem.toBytes;

const int_types = @import("./types/int_types.zig");
const Int32 = int_types.Int32;
