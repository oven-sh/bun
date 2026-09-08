pub struct MySQLQueryResult {
    /// Rows of a result set, or rows affected when there was none.
    pub count: u64,
    pub last_insert_id: u64,
    pub affected_rows: u64,
    pub is_last_result: bool,
    /// False when the session has `NO_BACKSLASH_ESCAPES` set.
    pub backslash_escapes: bool,
}
