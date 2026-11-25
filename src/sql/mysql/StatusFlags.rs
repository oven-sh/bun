// MySQL connection status flags
#[repr(u16)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum StatusFlag {
    SERVER_STATUS_IN_TRANS = 1,
    /// Indicates there are more result sets from this query
    SERVER_MORE_RESULTS_EXISTS = 8,
}

#[derive(Copy, Clone, Default)]
pub(crate) struct StatusFlags {
    _value: u16,
}

impl StatusFlags {
    pub(crate) fn has(self, flag: StatusFlag) -> bool {
        self._value & (flag as u16) != 0
    }

    pub(crate) fn from_int(flags: u16) -> Self {
        Self { _value: flags }
    }
}
