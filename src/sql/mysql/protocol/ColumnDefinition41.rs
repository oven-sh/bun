use crate::mysql::mysql_types::FieldType;
use crate::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use crate::mysql::protocol::new_reader::{NewReader, ReaderContext};
use crate::shared::column_identifier::ColumnIdentifier;
use crate::shared::data::Data;
use bstr::BStr;

bun_core::declare_scope!(ColumnDefinition41, hidden);

pub struct ColumnDefinition41 {
    pub catalog: Data,
    pub schema: Data,
    pub table: Data,
    pub org_table: Data,
    pub name: Data,
    pub org_name: Data,
    pub fixed_length_fields_length: u64,
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
    pub fn to_int(self) -> u16 {
        self.bits()
    }

    #[inline]
    pub fn from_int(flags: u16) -> ColumnFlags {
        ColumnFlags::from_bits_retain(flags)
    }
}

impl ColumnDefinition41 {
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: &mut NewReader<Context>,
    ) -> Result<bool, AnyMySQLError> {
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

        self.table = reader.encode_len_string()?;
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

        self.name = reader.encode_len_string()?;
        bun_core::scoped_log!(ColumnDefinition41, "name: {}", BStr::new(self.name.slice()));

        self.org_name = reader.encode_len_string()?;
        bun_core::scoped_log!(
            ColumnDefinition41,
            "org_name: {}",
            BStr::new(self.org_name.slice())
        );

        self.fixed_length_fields_length = reader.encoded_len_int()?;
        self.character_set = reader.int::<u16>()?;
        self.column_length = reader.int::<u32>()?;
        // `FieldType` is an exhaustive `#[repr(u8)]` enum, so an unknown wire byte
        // fails the whole query with `UnsupportedColumnType` rather than being
        // carried through and served as a raw/string cell. Resolves once
        // `FieldType` becomes a non-exhaustive newtype-over-u8 (see MySQLTypes.rs).
        let type_byte = reader.int::<u8>()?;
        self.column_type =
            FieldType::from_raw(type_byte).ok_or(AnyMySQLError::UnsupportedColumnType)?;
        self.flags = ColumnFlags::from_int(reader.int::<u16>()?);
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
        let mut changed = false;
        if !unchanged {
            let name_view = Data::Temporary(bun_ptr::RawSlice::new(self.name.slice()));
            let rebuilt =
                ColumnIdentifier::init(name_view).map_err(|_| AnyMySQLError::OutOfMemory)?;
            changed = match (&self.name_or_index, &rebuilt) {
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
    ) -> Result<bool, AnyMySQLError> {
        self.decode_internal(reader)
    }
}
