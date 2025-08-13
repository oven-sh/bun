// MySQL connection status flags
pub const StatusFlags = packed struct(u16) {
    /// Indicates if a transaction is currently active
    SERVER_STATUS_IN_TRANS: bool = false,
    /// Indicates if autocommit mode is enabled
    SERVER_STATUS_AUTOCOMMIT: bool = false,
    /// Indicates there are more result sets from this query
    SERVER_MORE_RESULTS_EXISTS: bool = false,
    /// Query used a suboptimal index
    SERVER_STATUS_NO_GOOD_INDEX_USED: bool = false,
    /// Query performed a full table scan with no index
    SERVER_STATUS_NO_INDEX_USED: bool = false,
    /// Indicates an open cursor exists
    SERVER_STATUS_CURSOR_EXISTS: bool = false,
    /// Last row in result set has been sent
    SERVER_STATUS_LAST_ROW_SENT: bool = false,
    /// Database was dropped
    SERVER_STATUS_DB_DROPPED: bool = false,
    /// Backslash escaping is disabled
    SERVER_STATUS_NO_BACKSLASH_ESCAPES: bool = false,
    /// Server's metadata has changed
    SERVER_STATUS_METADATA_CHANGED: bool = false,
    /// Query execution was considered slow
    SERVER_QUERY_WAS_SLOW: bool = false,
    /// Statement has output parameters
    SERVER_PS_OUT_PARAMS: bool = false,
    /// Transaction is in read-only mode
    SERVER_STATUS_IN_TRANS_READONLY: bool = false,
    /// Session state has changed
    SERVER_SESSION_STATE_CHANGED: bool = false,
    _padding: u2 = 0,

    pub fn format(self: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
        var first = true;
        inline for (comptime std.meta.fieldNames(StatusFlags)) |field| {
            if (@TypeOf(@field(self, field)) == bool) {
                if (@field(self, field)) {
                    if (!first) {
                        try writer.writeAll(", ");
                    }
                    first = false;
                    try writer.writeAll(field);
                }
            }
        }
    }

    pub fn toInt(this: @This()) u16 {
        return @bitCast(this);
    }

    pub fn fromInt(flags: u16) @This() {
        return @bitCast(flags);
    }
};

const std = @import("std");
