use strum::IntoStaticStr;

// MySQL field types
// https://dev.mysql.com/doc/dev/mysql-server/latest/binary__log__types_8h.html#a8935f33b06a3a88ba403c63acd806920
// On the wire any u8 is possible. This Rust enum is
// exhaustive: all wire decoding must go through the range-checked `from_raw`
// below (returns `None` for unknown bytes) — never `transmute`.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug, IntoStaticStr)]
pub enum FieldType {
    MYSQL_TYPE_DECIMAL = 0x00,
    MYSQL_TYPE_TINY = 0x01,
    MYSQL_TYPE_SHORT = 0x02,
    MYSQL_TYPE_LONG = 0x03,
    MYSQL_TYPE_FLOAT = 0x04,
    MYSQL_TYPE_DOUBLE = 0x05,
    MYSQL_TYPE_NULL = 0x06,
    MYSQL_TYPE_TIMESTAMP = 0x07,
    MYSQL_TYPE_LONGLONG = 0x08,
    MYSQL_TYPE_INT24 = 0x09, // MEDIUMINT
    MYSQL_TYPE_DATE = 0x0a,
    MYSQL_TYPE_TIME = 0x0b,
    MYSQL_TYPE_DATETIME = 0x0c,
    MYSQL_TYPE_YEAR = 0x0d,
    MYSQL_TYPE_NEWDATE = 0x0e,
    MYSQL_TYPE_VARCHAR = 0x0f,
    MYSQL_TYPE_BIT = 0x10,
    MYSQL_TYPE_TIMESTAMP2 = 0x11,
    MYSQL_TYPE_DATETIME2 = 0x12,
    MYSQL_TYPE_TIME2 = 0x13,
    MYSQL_TYPE_JSON = 0xf5,
    MYSQL_TYPE_NEWDECIMAL = 0xf6,
    MYSQL_TYPE_ENUM = 0xf7,
    MYSQL_TYPE_SET = 0xf8,
    MYSQL_TYPE_TINY_BLOB = 0xf9,
    MYSQL_TYPE_MEDIUM_BLOB = 0xfa,
    MYSQL_TYPE_LONG_BLOB = 0xfb,
    MYSQL_TYPE_BLOB = 0xfc,
    MYSQL_TYPE_VAR_STRING = 0xfd,
    MYSQL_TYPE_STRING = 0xfe,
    MYSQL_TYPE_GEOMETRY = 0xff,
}

impl FieldType {
    // `from_js` is provided as an extension-trait method in the
    // `bun_sql_jsc` crate; the base type carries no JSC dependency.

    /// Decode a raw protocol byte. On the wire any byte is possible; this
    /// Rust enum is
    /// exhaustive, so unknown bytes return `None` instead of producing an
    /// invalid discriminant. LLVM folds the contiguous arms to two range
    /// checks.
    #[inline]
    pub const fn from_raw(b: u8) -> Option<Self> {
        Some(match b {
            0x00 => FieldType::MYSQL_TYPE_DECIMAL,
            0x01 => FieldType::MYSQL_TYPE_TINY,
            0x02 => FieldType::MYSQL_TYPE_SHORT,
            0x03 => FieldType::MYSQL_TYPE_LONG,
            0x04 => FieldType::MYSQL_TYPE_FLOAT,
            0x05 => FieldType::MYSQL_TYPE_DOUBLE,
            0x06 => FieldType::MYSQL_TYPE_NULL,
            0x07 => FieldType::MYSQL_TYPE_TIMESTAMP,
            0x08 => FieldType::MYSQL_TYPE_LONGLONG,
            0x09 => FieldType::MYSQL_TYPE_INT24,
            0x0a => FieldType::MYSQL_TYPE_DATE,
            0x0b => FieldType::MYSQL_TYPE_TIME,
            0x0c => FieldType::MYSQL_TYPE_DATETIME,
            0x0d => FieldType::MYSQL_TYPE_YEAR,
            0x0e => FieldType::MYSQL_TYPE_NEWDATE,
            0x0f => FieldType::MYSQL_TYPE_VARCHAR,
            0x10 => FieldType::MYSQL_TYPE_BIT,
            0x11 => FieldType::MYSQL_TYPE_TIMESTAMP2,
            0x12 => FieldType::MYSQL_TYPE_DATETIME2,
            0x13 => FieldType::MYSQL_TYPE_TIME2,
            0xf5 => FieldType::MYSQL_TYPE_JSON,
            0xf6 => FieldType::MYSQL_TYPE_NEWDECIMAL,
            0xf7 => FieldType::MYSQL_TYPE_ENUM,
            0xf8 => FieldType::MYSQL_TYPE_SET,
            0xf9 => FieldType::MYSQL_TYPE_TINY_BLOB,
            0xfa => FieldType::MYSQL_TYPE_MEDIUM_BLOB,
            0xfb => FieldType::MYSQL_TYPE_LONG_BLOB,
            0xfc => FieldType::MYSQL_TYPE_BLOB,
            0xfd => FieldType::MYSQL_TYPE_VAR_STRING,
            0xfe => FieldType::MYSQL_TYPE_STRING,
            0xff => FieldType::MYSQL_TYPE_GEOMETRY,
            _ => return None,
        })
    }

    pub fn is_binary_format_supported(self) -> bool {
        matches!(
            self,
            FieldType::MYSQL_TYPE_TINY
                | FieldType::MYSQL_TYPE_SHORT
                | FieldType::MYSQL_TYPE_LONG
                | FieldType::MYSQL_TYPE_LONGLONG
                | FieldType::MYSQL_TYPE_FLOAT
                | FieldType::MYSQL_TYPE_DOUBLE
                | FieldType::MYSQL_TYPE_TIME
                | FieldType::MYSQL_TYPE_DATE
                | FieldType::MYSQL_TYPE_DATETIME
                | FieldType::MYSQL_TYPE_TIMESTAMP
        )
    }
}

// Callers import `bun_sql_jsc::mysql::mysql_value::Value` directly.

pub(crate) type MySQLInt32 = Int4;
// encode/decode sites must mask/read exactly 3 bytes. Verify all Int3 users do so.
pub type Int4 = u32;
