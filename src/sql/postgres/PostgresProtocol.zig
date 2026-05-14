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

pub const ArrayList = @import("./protocol/ArrayList.rust");
pub const BackendKeyData = @import("./protocol/BackendKeyData.rust");
pub const CommandComplete = @import("./protocol/CommandComplete.rust");
pub const CopyData = @import("./protocol/CopyData.rust");
pub const CopyFail = @import("./protocol/CopyFail.rust");
pub const DataRow = @import("./protocol/DataRow.rust");
pub const Describe = @import("./protocol/Describe.rust");
pub const ErrorResponse = @import("./protocol/ErrorResponse.rust");
pub const Execute = @import("./protocol/Execute.rust");
pub const FieldDescription = @import("./protocol/FieldDescription.rust");
pub const NegotiateProtocolVersion = @import("./protocol/NegotiateProtocolVersion.rust");
pub const NoticeResponse = @import("./protocol/NoticeResponse.rust");
pub const NotificationResponse = @import("./protocol/NotificationResponse.rust");
pub const ParameterDescription = @import("./protocol/ParameterDescription.rust");
pub const ParameterStatus = @import("./protocol/ParameterStatus.rust");
pub const Parse = @import("./protocol/Parse.rust");
pub const PasswordMessage = @import("./protocol/PasswordMessage.rust");
pub const ReadyForQuery = @import("./protocol/ReadyForQuery.rust");
pub const RowDescription = @import("./protocol/RowDescription.rust");
pub const SASLInitialResponse = @import("./protocol/SASLInitialResponse.rust");
pub const SASLResponse = @import("./protocol/SASLResponse.rust");
pub const StackReader = @import("./protocol/StackReader.rust");
pub const StartupMessage = @import("./protocol/StartupMessage.rust");
pub const Authentication = @import("./protocol/Authentication.rust").Authentication;
pub const ColumnIdentifier = @import("../shared/ColumnIdentifier.rust").ColumnIdentifier;
pub const DecoderWrap = @import("./protocol/DecoderWrap.rust").DecoderWrap;
pub const FieldMessage = @import("./protocol/FieldMessage.rust").FieldMessage;
pub const FieldType = @import("./protocol/FieldType.rust").FieldType;
pub const NewReader = @import("./protocol/NewReader.rust").NewReader;
pub const NewWriter = @import("./protocol/NewWriter.rust").NewWriter;
pub const PortalOrPreparedStatement = @import("./protocol/PortalOrPreparedStatement.rust").PortalOrPreparedStatement;
pub const WriteWrap = @import("./protocol/WriteWrap.rust").WriteWrap;

const std = @import("std");
const types = @import("./PostgresTypes.rust");
const toBytes = std.mem.toBytes;

const int_types = @import("./types/int_types.rust");
const Int32 = int_types.Int32;
