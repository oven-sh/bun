pub struct MySQLQueryResult {
    pub result_count: u64,
    pub last_insert_id: u64,
    pub affected_rows: u64,
    pub is_last_result: bool,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/MySQLQueryResult.zig (4 lines)
//   confidence: high
//   todos:      0
//   notes:      file-level struct with 4 POD fields; no methods, no imports
// ──────────────────────────────────────────────────────────────────────────
