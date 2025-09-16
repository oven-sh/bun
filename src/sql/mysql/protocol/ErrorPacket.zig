const ErrorPacket = @This();
header: u8 = 0xff,
error_code: u16 = 0,
sql_state_marker: ?u8 = null,
sql_state: ?[5]u8 = null,
error_message: Data = .{ .empty = {} },

pub fn deinit(this: *ErrorPacket) void {
    this.error_message.deinit();
}
pub const MySQLErrorOptions = struct {
    code: []const u8,
    errno: ?u16 = null,
    sqlState: ?[5]u8 = null,
};

pub fn createMySQLError(
    globalObject: *JSC.JSGlobalObject,
    message: []const u8,
    options: MySQLErrorOptions,
) bun.JSError!JSValue {
    const opts_obj = JSValue.createEmptyObject(globalObject, 0);
    opts_obj.ensureStillAlive();
    opts_obj.put(globalObject, JSC.ZigString.static("code"), try bun.String.createUTF8ForJS(globalObject, options.code));
    if (options.errno) |errno| {
        opts_obj.put(globalObject, JSC.ZigString.static("errno"), JSC.JSValue.jsNumber(errno));
    }
    if (options.sqlState) |state| {
        opts_obj.put(globalObject, JSC.ZigString.static("sqlState"), try bun.String.createUTF8ForJS(globalObject, state[0..]));
    }
    opts_obj.put(globalObject, JSC.ZigString.static("message"), try bun.String.createUTF8ForJS(globalObject, message));

    return opts_obj;
}

pub fn decodeInternal(this: *ErrorPacket, comptime Context: type, reader: NewReader(Context)) !void {
    this.header = try reader.int(u8);
    if (this.header != 0xff) {
        return error.InvalidErrorPacket;
    }

    this.error_code = try reader.int(u16);

    // Check if we have a SQL state marker
    const next_byte = try reader.int(u8);
    if (next_byte == '#') {
        this.sql_state_marker = '#';
        var sql_state_data = try reader.read(5);
        defer sql_state_data.deinit();
        this.sql_state = sql_state_data.slice()[0..5].*;
    } else {
        // No SQL state, rewind one byte
        reader.skip(-1);
    }

    // Read the error message (rest of packet)
    this.error_message = try reader.read(reader.peek().len);
}

pub const decode = decoderWrap(ErrorPacket, decodeInternal).decode;

pub fn toJS(this: ErrorPacket, globalObject: *JSC.JSGlobalObject) JSValue {
    var msg = this.error_message.slice();
    if (msg.len == 0) {
        msg = "MySQL error occurred";
    }

    return createMySQLError(globalObject, msg, .{
        .code = if (this.error_code == 1064) "ERR_MYSQL_SYNTAX_ERROR" else "ERR_MYSQL_SERVER_ERROR",
        .errno = this.error_code,
        .sqlState = this.sql_state,
    }) catch |err| globalObject.takeException(err);
}

const bun = @import("bun");
const Data = @import("../../shared/Data.zig").Data;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;

const JSC = bun.jsc;
const JSValue = JSC.JSValue;
