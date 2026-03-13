// MySQL connection status flags
pub const StatusFlag = enum(u16) {
    SERVER_STATUS_IN_TRANS = 1,
    /// Indicates if autocommit mode is enabled
    SERVER_STATUS_AUTOCOMMIT = 2,
    /// Indicates there are more result sets from this query
    SERVER_MORE_RESULTS_EXISTS = 8,
    /// Query used a suboptimal index
    SERVER_STATUS_NO_GOOD_INDEX_USED = 16,
    /// Query performed a full table scan with no index
    SERVER_STATUS_NO_INDEX_USED = 32,
    /// Indicates an open cursor exists
    SERVER_STATUS_CURSOR_EXISTS = 64,
    /// Last row in result set has been sent
    SERVER_STATUS_LAST_ROW_SENT = 128,
    /// Database was dropped
    SERVER_STATUS_DB_DROPPED = 1 << 8,
    /// Backslash escaping is disabled
    SERVER_STATUS_NO_BACKSLASH_ESCAPES = 1 << 9,
    /// Server's metadata has changed
    SERVER_STATUS_METADATA_CHANGED = 1 << 10,
    /// Query execution was considered slow
    SERVER_QUERY_WAS_SLOW = 1 << 11,
    /// Statement has output parameters
    SERVER_PS_OUT_PARAMS = 1 << 12,
    /// Transaction is in read-only mode
    SERVER_STATUS_IN_TRANS_READONLY = 1 << 13,
    /// Session state has changed
    SERVER_SESSION_STATE_CHANGED = 1 << 14,
};

pub const StatusFlags = struct {
    /// Indicates if a transaction is currently active
    _value: u16 = 0,

    pub fn format(self: @This(), writer: *std.Io.Writer) std.Io.Writer.Error!void {
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

    pub fn has(this: @This(), flag: StatusFlag) bool {
        return this._value & @as(u16, @intFromEnum(flag)) != 0;
    }

    pub fn toInt(this: @This()) u16 {
        return this._value;
    }

    pub fn fromInt(flags: u16) @This() {
        return @This(){
            ._value = flags,
        };
    }
};

const std = @import("std");
