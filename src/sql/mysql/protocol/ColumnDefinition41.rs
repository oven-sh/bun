use crate::mysql::mysql_types::{self as types, FieldType};
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
    // Zig `packed struct` field order is LSB-first; `_padding: u2` rounds to 16 bits.
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

// Zig `deinit` only deinit'd owned `Data`/`ColumnIdentifier` fields — their `Drop` impls
// handle that automatically in Rust, so no explicit `impl Drop` is needed here.

impl ColumnDefinition41 {
    // TODO(port): narrow error set
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: &mut NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
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
        // PORT NOTE: Zig FieldType is a NON-exhaustive `enum(u8)` so `@enumFromInt` accepts
        // any byte. Rust `#[repr(u8)] enum` is exhaustive, so unknown bytes go through
        // `from_raw`'s match and error here instead. This diverges from Zig (which keeps
        // the value) but is sound; if a new server sends an unknown type, we fail loudly
        // rather than carry an invalid discriminant. TODO(b2): switch FieldType to a
        // `#[repr(transparent)] struct(u8)` newtype to match Zig's non-exhaustive
        // semantics exactly.
        let type_byte = reader.int::<u8>()?;
        self.column_type = FieldType::from_raw(type_byte)
            .ok_or_else(|| bun_core::err!("UnknownMySQLFieldType"))?;
        self.flags = ColumnFlags::from_int(reader.int::<u16>()?);
        self.decimals = reader.int::<u8>()?;

        // PORT NOTE: Zig called `name_or_index.deinit()` before reassigning; in Rust the
        // assignment below drops the previous value automatically.
        // PORT NOTE: reshaped for borrowck — Zig passed `this.name` by value; pass by ref here.
        // PORT NOTE: `ColumnIdentifier::init` consumes its `Data` (Zig moved by-value
        // and `errdefer name.deinit()`). We can't move `self.name` while `&mut self`
        // is borrowed, so feed it a Temporary view of the same bytes.
        let name_view = Data::Temporary(bun_ptr::RawSlice::new(self.name.slice()));
        self.name_or_index = ColumnIdentifier::init(name_view)?;

        // https://mariadb.com/kb/en/result-set-packets/#column-definition-packet
        // According to mariadb, there seem to be extra 2 bytes at the end that is not being used
        reader.skip(2);

        Ok(())
    }

    // TODO(port): `decoderWrap(ColumnDefinition41, decodeInternal).decode` is a comptime
    // type-generator that produces a `.decode` wrapper. Phase B: express as a trait impl
    // (e.g. `impl Decode for ColumnDefinition41`) or a macro from `new_reader`.
    pub fn decode<Context: ReaderContext>(
        &mut self,
        reader: &mut NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
        self.decode_internal(reader)
    }
}

// ported from: src/sql/mysql/protocol/ColumnDefinition41.zig
