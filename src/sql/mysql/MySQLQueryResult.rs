pub struct MySQLQueryResult {
    /// Rows of a result set, or rows affected when there was none.
    pub count: u64,
    pub last_insert_id: u64,
    pub affected_rows: u64,
    pub is_last_result: bool,
    /// Whether this result's statement was lexed with backslash escapes on
    /// (`NO_BACKSLASH_ESCAPES` unset).
    pub backslash_escapes: bool,
}
