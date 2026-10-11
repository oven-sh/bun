#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Status {
    /// The query was just enqueued and no byte of it is written, statement status can be checked for more details
    Pending,
    /// The query wrote its own Parse (PostgreSQL) or COM_STMT_PREPARE (MySQL); its Bind and Execute are not written
    Preparing,
    /// The query is being bound to the statement
    Binding,
    /// The query is running
    Running,
    /// The query is waiting for a partial response
    PartialResponse,
    /// The query was successful
    Success,
    /// The query failed
    Fail,
}

impl Status {
    /// Its Bind and Execute, or all of it, are still to be written.
    #[inline]
    pub fn awaits_write(self) -> bool {
        matches!(self, Status::Pending | Status::Preparing)
    }
}
