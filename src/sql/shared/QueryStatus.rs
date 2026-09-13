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
