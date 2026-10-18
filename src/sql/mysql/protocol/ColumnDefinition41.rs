use crate::mysql::mysql_types::FieldType;
use crate::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use crate::mysql::protocol::encode_int::decode_length_int;
use crate::mysql::protocol::stack_reader::PacketReader;
use crate::shared::column_identifier::ColumnIdentifier;
use crate::shared::data::Data;
use bstr::BStr;

bun_core::declare_scope!(ColumnDefinition41, hidden);

pub struct ColumnDefinition41 {
    /// A copy: it is read after the packet is gone.
    pub table: Data,
    /// A copy of the name on the wire, which `name_or_index` is made from.
    name: Option<Data>,
    pub character_set: u16,
    pub column_length: u32,
    pub column_type: FieldType,
    pub flags: ColumnFlags,
    pub decimals: u8,
    pub name_or_index: ColumnIdentifier,
}

impl Default for ColumnDefinition41 {
    fn default() -> Self {
        Self {
            table: Data::empty(),
            name: None,
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Changed {
    Nothing,
    /// Table, type, length or flags. MariaDB derives the last three from each execution's values.
    Description,
    Name,
}

fn replace<T: PartialEq>(slot: &mut T, value: T) -> bool {
    let changed = *slot != value;
    *slot = value;
    changed
}

impl ColumnDefinition41 {
    /// The next definition counts as `Changed::Name`.
    pub fn forget_name(&mut self) {
        self.name = None;
    }

    pub fn decode(
        &mut self,
        reader: &mut PacketReader<'_>,
        extended_type_info: bool,
    ) -> Result<Changed, AnyMySQLError> {
        // Length encoded strings
        let catalog = reader.encode_len_string()?;
        bun_core::scoped_log!(
            ColumnDefinition41,
            "catalog: {}",
            BStr::new(catalog.slice())
        );

        let schema = reader.encode_len_string()?;
        bun_core::scoped_log!(ColumnDefinition41, "schema: {}", BStr::new(schema.slice()));

        let table = reader.encode_len_string()?;
        bun_core::scoped_log!(ColumnDefinition41, "table: {}", BStr::new(table.slice()));
        let mut described_differently = self.table.slice() != table.slice();
        if described_differently {
            self.table = Data::create(table.slice()).map_err(|_| AnyMySQLError::OutOfMemory)?;
        }

        let org_table = reader.encode_len_string()?;
        bun_core::scoped_log!(
            ColumnDefinition41,
            "org_table: {}",
            BStr::new(org_table.slice())
        );

        let name = reader.encode_len_string()?;
        bun_core::scoped_log!(ColumnDefinition41, "name: {}", BStr::new(name.slice()));

        let org_name = reader.encode_len_string()?;
        bun_core::scoped_log!(
            ColumnDefinition41,
            "org_name: {}",
            BStr::new(org_name.slice())
        );

        // With MARIADB_CLIENT_EXTENDED_TYPE_INFO negotiated, a lenenc blob of
        // extended metadata sits between org_name and the fixed-length
        // fields: https://mariadb.com/kb/en/result-set-packets/
        let mut json_format = false;
        if extended_type_info {
            let extended = reader.encode_len_string()?;
            json_format = extended_metadata_is_json(extended.slice())?;
        }

        reader.encoded_len_int()?; // length of the fixed-length fields
        self.character_set = reader.int::<u16>()?;
        described_differently |= replace(&mut self.column_length, reader.int::<u32>()?);
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
        described_differently |= replace(&mut self.column_type, column_type);
        described_differently |=
            replace(&mut self.flags, ColumnFlags::from_int(reader.int::<u16>()?));
        self.decimals = reader.int::<u8>()?;

        // The server re-sends column definitions on every COM_STMT_EXECUTE, so a
        // reused prepared statement re-decodes into the same slot once per query.
        let renamed = self
            .name
            .as_ref()
            .is_none_or(|previous| previous.slice() != name.slice());
        if renamed {
            self.name = Some(Data::create(name.slice()).map_err(|_| AnyMySQLError::OutOfMemory)?);
            self.name_or_index =
                ColumnIdentifier::init(name).map_err(|_| AnyMySQLError::OutOfMemory)?;
        }

        // https://mariadb.com/kb/en/result-set-packets/#column-definition-packet
        // According to mariadb, there seem to be extra 2 bytes at the end that is not being used
        reader.skip(2);

        Ok(if renamed {
            Changed::Name
        } else if described_differently {
            Changed::Description
        } else {
            Changed::Nothing
        })
    }
}
