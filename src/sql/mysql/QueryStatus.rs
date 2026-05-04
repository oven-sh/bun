#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Status {
    /// The query was just enqueued, statement status can be checked for more details
    Pending,
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
    pub fn is_running(self) -> bool {
        (self as u8) > (Status::Pending as u8) && (self as u8) < (Status::Success as u8)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/QueryStatus.zig (18 lines)
//   confidence: high
//   todos:      0
//   notes:      simple #[repr(u8)] enum + ordinal-range check
// ──────────────────────────────────────────────────────────────────────────
