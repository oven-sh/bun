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

const ErrorPacket = @import("../../../sql/mysql/protocol/ErrorPacket.zig");
const MySQLErrorOptions = ErrorPacket.MySQLErrorOptions;

const JSC = bun.jsc;
const jsc = bun.jsc;
const JSValue = JSC.JSValue;
