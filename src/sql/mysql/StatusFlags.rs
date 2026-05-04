use core::fmt;

// MySQL connection status flags
#[repr(u16)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum StatusFlag {
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
}

#[derive(Copy, Clone, Default)]
pub struct StatusFlags {
    /// Indicates if a transaction is currently active
    _value: u16,
}

impl fmt::Display for StatusFlags {
    fn fmt(&self, _f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // PORT NOTE: the Zig `format` iterates `std.meta.fieldNames(StatusFlags)` and
        // prints each field whose type is `bool`. `StatusFlags` has only one field
        // (`_value: u16`), so the Zig loop is a no-op at comptime. Preserved as a
        // no-op here; likely dead code left over from when this was a packed struct.
        let _first = true;
        Ok(())
    }
}

impl StatusFlags {
    pub fn has(self, flag: StatusFlag) -> bool {
        self._value & (flag as u16) != 0
    }

    pub fn to_int(self) -> u16 {
        self._value
    }

    pub fn from_int(flags: u16) -> Self {
        Self { _value: flags }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/StatusFlags.zig (66 lines)
//   confidence: high
//   todos:      0
//   notes:      Zig format() is a comptime no-op (iterates bool fields, none exist); ported as no-op Display
// ──────────────────────────────────────────────────────────────────────────
