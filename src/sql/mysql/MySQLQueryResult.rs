pub struct MySQLQueryResult {
    /// Rows returned for a result set; rows affected for a reply with no
    /// result set (the OK packet of an INSERT, UPDATE, DELETE or DDL).
    pub count: u64,
    pub last_insert_id: u64,
    pub affected_rows: u64,
    pub is_last_result: bool,
    /// False when the session has `NO_BACKSLASH_ESCAPES` set.
    pub backslash_escapes: bool,
}
