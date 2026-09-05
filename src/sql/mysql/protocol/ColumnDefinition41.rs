use crate::mysql::mysql_types::FieldType;
use crate::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use crate::mysql::protocol::encode_int::decode_length_int;
use crate::mysql::protocol::new_reader::{NewReader, ReaderContext};
use crate::shared::column_identifier::ColumnIdentifier;
use crate::shared::data::Data;
use bstr::BStr;

bun_core::declare_scope!(ColumnDefinition41, hidden);

pub struct ColumnDefinition41 {
    pub(crate) catalog: Data,
    pub(crate) schema: Data,
    pub table: Data,
    pub(crate) org_table: Data,
    pub name: Data,
    pub(crate) org_name: Data,
    pub(crate) fixed_length_fields_length: u64,
    pub character_set: u16,
    pub column_length: u32,
    pub column_type: FieldType,
    pub flags: ColumnFlags,
    pub(crate) decimals: u8,
    pub name_or_index: ColumnIdentifier,
}

impl Default for ColumnDefinition41 {
    fn default() -> Self {
        Self {
            catalog: Data::empty(),
            schema: Data::empty(),
            table: Data::empty(),
            org_table: Data::empty(),
            name: Data::empty(),
            org_name: Data::empty(),
            fixed_length_fields_length: 0,
            character_set: 0,
            column_length: 0,
            column_type: FieldType::MYSQL_TYPE_NULL,
            flags: ColumnFlags::empty(),
            decimals: 0,
            name_or_index: ColumnIdentifier::Name(Data::empty()),
        }
    }
}

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub struct ColumnFlags: u16 {
        const NOT_NULL         = 1 << 0;
        const PRI_KEY          = 1 << 1;
        const UNIQUE_KEY       = 1 << 2;
        const MULTIPLE_KEY     = 1 << 3;
        const BLOB             = 1 << 4;
        const UNSIGNED         = 1 << 5;
        const ZEROFILL         = 1 << 6;
        const BINARY           = 1 << 7;
        const ENUM             = 1 << 8;
        const AUTO_INCREMENT   = 1 << 9;
        const TIMESTAMP        = 1 << 10;
        const SET              = 1 << 11;
        const NO_DEFAULT_VALUE = 1 << 12;
        const ON_UPDATE_NOW    = 1 << 13;
    }
}

impl ColumnFlags {
    #[inline]
    pub(crate) fn from_int(flags: u16) -> ColumnFlags {
        ColumnFlags::from_bits_retain(flags)
    }
}

/// Chunk kind in MariaDB's extended column metadata: 0 carries a type name
/// ("uuid", "inet4", ...), 1 carries a storage format name ("json").
const EXTENDED_METADATA_FORMAT: u8 = 1;

/// Walks a MariaDB extended-metadata blob ((int<1> kind, string<lenenc> value)
/// pairs) and reports whether it marks the column as format=json. Other kinds
/// and values ("uuid", "inet4", ...) keep their string decoding; skip them.
fn extended_metadata_is_json(mut bytes: &[u8]) -> Result<bool, AnyMySQLError> {
    let mut is_json = false;
    while let Some((&kind, rest)) = bytes.split_first() {
        let decoded = decode_length_int(rest).ok_or(AnyMySQLError::InvalidEncodedInteger)?;
        let len =
            usize::try_from(decoded.value).map_err(|_| AnyMySQLError::InvalidEncodedLength)?;
        let value_end = decoded
            .bytes_read
            .checked_add(len)
            .filter(|end| *end <= rest.len())
            .ok_or(AnyMySQLError::InvalidEncodedLength)?;
        if kind == EXTENDED_METADATA_FORMAT && rest[decoded.bytes_read..value_end] == *b"json" {
            is_json = true;
        }
        bytes = &rest[value_end..];
    }
    Ok(is_json)
}

/// What re-decoding a column definition into an already-populated slot invalidated.
#[derive(Clone, Copy, Default)]
pub struct Changed {
    /// `name_or_index` differs, so the cached row structure and duplicate check are stale.
    pub structure: bool,
    /// A field reported by `result.columns` differs, so the cached statement object is stale.
    pub metadata: bool,
}

impl ColumnDefinition41 {
    pub(crate) fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: &mut NewReader<Context>,
        extended_type_info: bool,
    ) -> Result<Changed, AnyMySQLError> {
        // Length encoded strings
        self.catalog = reader.encode_len_string()?;
        bun_core::scoped_log!(
            ColumnDefinition41,
            "catalog: {}",
            BStr::new(self.catalog.slice())
        );

        self.schema = reader.encode_len_string()?;
        bun_core::scoped_log!(
            ColumnDefinition41,
            "schema: {}",
            BStr::new(self.schema.slice())
        );

        let mut changed = Changed::default();

        // `table`/`name` outlive the read buffer (read at OK/EOF time), so they are owned copies.
        let table = reader.encode_len_string()?;
        if self.table.slice() != table.slice() {
            self.table = Data::create(table.slice()).map_err(|_| AnyMySQLError::OutOfMemory)?;
            changed.metadata = true;
        }
        bun_core::scoped_log!(
            ColumnDefinition41,
            "table: {}",
            BStr::new(self.table.slice())
        );

        self.org_table = reader.encode_len_string()?;
        bun_core::scoped_log!(
            ColumnDefinition41,
            "org_table: {}",
            BStr::new(self.org_table.slice())
        );

        let name = reader.encode_len_string()?;
        if self.name.slice() != name.slice() {
            self.name = Data::create(name.slice()).map_err(|_| AnyMySQLError::OutOfMemory)?;
            // Byte compare: all-digit aliases like `1` and `01` collapse to the same `Index` below.
            changed.metadata = true;
        }
        bun_core::scoped_log!(ColumnDefinition41, "name: {}", BStr::new(self.name.slice()));

        self.org_name = reader.encode_len_string()?;
        bun_core::scoped_log!(
            ColumnDefinition41,
            "org_name: {}",
            BStr::new(self.org_name.slice())
        );

        // With MARIADB_CLIENT_EXTENDED_TYPE_INFO negotiated, a lenenc blob of
        // extended metadata sits between org_name and the fixed-length
        // fields: https://mariadb.com/kb/en/result-set-packets/
        let mut json_format = false;
        if extended_type_info {
            let extended = reader.encode_len_string()?;
            json_format = extended_metadata_is_json(extended.slice())?;
        }

        self.fixed_length_fields_length = reader.encoded_len_int()?;
        self.character_set = reader.int::<u16>()?;
        let column_length = reader.int::<u32>()?;
        changed.metadata |= column_length != self.column_length;
        self.column_length = column_length;
        // `FieldType` is an exhaustive `#[repr(u8)]` enum, so an unknown wire byte
        // fails the whole query with `UnsupportedColumnType` rather than being
        // carried through and served as a raw/string cell. Resolves once
        // `FieldType` becomes a non-exhaustive newtype-over-u8 (see MySQLTypes.rs).
        let type_byte = reader.int::<u8>()?;
        let mut column_type =
            FieldType::from_raw(type_byte).ok_or(AnyMySQLError::UnsupportedColumnType)?;
        // MariaDB has no MYSQL_TYPE_JSON: JSON columns and JSON function
        // results arrive as TEXT/BLOB marked format=json, so remap them onto
        // the MySQL JSON decode path. Only types whose wire values are
        // length-encoded strings (the shape MYSQL_TYPE_JSON decodes) remap,
        // keeping the row reader aligned.
        if json_format
            && matches!(
                column_type,
                FieldType::MYSQL_TYPE_BLOB
                    | FieldType::MYSQL_TYPE_TINY_BLOB
                    | FieldType::MYSQL_TYPE_MEDIUM_BLOB
                    | FieldType::MYSQL_TYPE_LONG_BLOB
                    | FieldType::MYSQL_TYPE_STRING
                    | FieldType::MYSQL_TYPE_VAR_STRING
                    | FieldType::MYSQL_TYPE_VARCHAR
            )
        {
            column_type = FieldType::MYSQL_TYPE_JSON;
        }
        changed.metadata |= column_type != self.column_type;
        self.column_type = column_type;
        let flags = ColumnFlags::from_int(reader.int::<u16>()?);
        changed.metadata |= flags != self.flags;
        self.flags = flags;
        self.decimals = reader.int::<u8>()?;

        // `ColumnIdentifier::init` consumes its `Data`. We can't move `self.name`
        // while `&mut self` is borrowed, so feed it a Temporary view of the same bytes.
        //
        // The server re-sends column definitions on every COM_STMT_EXECUTE, so a
        // reused prepared statement re-decodes into the same slot once per query.
        // Skip the `name_or_index` rebuild when the previously-owned name already
        // matches — `ColumnIdentifier::init` would produce a byte-identical
        // `Name(Owned(..))`, so this is a pure allocation elision. Without it the
        // per-column free/alloc churn shows up as steady RSS growth under the
        // ASAN quarantine (test/regression/issue/28632).
        let unchanged = matches!(&self.name_or_index,
            ColumnIdentifier::Name(existing) if existing.slice() == self.name.slice());
        if !unchanged {
            let name_view = Data::Temporary(bun_ptr::RawSlice::new(self.name.slice()));
            let rebuilt =
                ColumnIdentifier::init(name_view).map_err(|_| AnyMySQLError::OutOfMemory)?;
            changed.structure = match (&self.name_or_index, &rebuilt) {
                (ColumnIdentifier::Index(prev), ColumnIdentifier::Index(curr)) => prev != curr,
                _ => true,
            };
            self.name_or_index = rebuilt;
        }

        // https://mariadb.com/kb/en/result-set-packets/#column-definition-packet
        // According to mariadb, there seem to be extra 2 bytes at the end that is not being used
        reader.skip(2);

        Ok(changed)
    }

    pub fn decode<Context: ReaderContext>(
        &mut self,
        reader: &mut NewReader<Context>,
        extended_type_info: bool,
    ) -> Result<Changed, AnyMySQLError> {
        self.decode_internal(reader, extended_type_info)
    }
}
