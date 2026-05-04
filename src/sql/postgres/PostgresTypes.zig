pub const @"bool" = @import("../../sql_jsc/postgres/types/bool.zig");

pub const bytea = @import("../../sql_jsc/postgres/types/bytea.zig");
pub const date = @import("../../sql_jsc/postgres/types/date.zig");
pub const json = @import("../../sql_jsc/postgres/types/json.zig");
pub const string = @import("../../sql_jsc/postgres/types/PostgresString.zig");
pub const AnyPostgresError = @import("./AnyPostgresError.zig").AnyPostgresError;
pub const Tag = @import("./types/Tag.zig").Tag;

pub const Int32 = int_types.Int32;
pub const PostgresInt32 = int_types.int4;
pub const PostgresInt64 = int_types.int8;
pub const PostgresShort = int_types.short;
pub const int4 = int_types.int4;
pub const int8 = int_types.int8;
pub const short = int_types.short;

const int_types = @import("./types/int_types.zig");
