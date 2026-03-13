pub const Status = enum(u8) {
    /// The query was just enqueued, statement status can be checked for more details
    pending,
    /// The query is being bound to the statement
    binding,
    /// The query is running
    running,
    /// The query is waiting for a partial response
    partial_response,
    /// The query was successful
    success,
    /// The query failed
    fail,

    pub fn isRunning(this: Status) bool {
        return @intFromEnum(this) > @intFromEnum(Status.pending) and @intFromEnum(this) < @intFromEnum(Status.success);
    }
};
