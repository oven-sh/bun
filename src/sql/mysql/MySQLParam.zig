//! Pure parameter descriptor used by the wire-protocol encoders
//! (`Query.rust`, `PreparedStatement.rust`). Split from `MySQLStatement`
//! so the protocol layer has no dependency on the JSC-coupled statement
//! struct that lives in `sql_jsc/`.
pub const Param = struct {
    type: types.FieldType,
    flags: ColumnDefinition41.ColumnFlags,
};

const ColumnDefinition41 = @import("./protocol/ColumnDefinition41.rust");
const types = @import("./MySQLTypes.rust");
