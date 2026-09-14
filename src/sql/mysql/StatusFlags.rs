use core::fmt;

// MySQL connection status flags
#[repr(u16)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum StatusFlag {
    /// Indicates there are more result sets from this query
    SERVER_MORE_RESULTS_EXISTS = 8,
    /// The session's sql_mode has NO_BACKSLASH_ESCAPES: `\` is literal in strings
    SERVER_STATUS_NO_BACKSLASH_ESCAPES = 0x200,
}

#[derive(Copy, Clone, Default)]
pub struct StatusFlags {
    /// Indicates if a transaction is currently active
    _value: u16,
}

impl fmt::Display for StatusFlags {
    fn fmt(&self, _f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Intentionally a no-op; likely dead code left over from when this
        // was a packed struct of bools.
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

    pub(crate) fn from_int(flags: u16) -> Self {
        Self { _value: flags }
    }
}
