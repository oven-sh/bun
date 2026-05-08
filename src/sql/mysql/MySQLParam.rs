//! Pure parameter descriptor used by the wire-protocol encoders
//! (`Query.rs`, `PreparedStatement.rs`). Split from `MySQLStatement`
//! so the protocol layer has no dependency on the JSC-coupled statement
//! struct that lives in `sql_jsc/`.

use super::mysql_types::FieldType;
use super::protocol::column_definition41::ColumnFlags;

pub struct Param {
    pub r#type: FieldType,
    pub flags: ColumnFlags,
}

// ported from: src/sql/mysql/MySQLParam.zig
