pub struct MySQLQueryResult {
    pub result_count: u64,
    pub has_columns: bool,
    pub last_insert_id: u64,
    pub affected_rows: u64,
    pub is_last_result: bool,
}
