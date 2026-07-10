use core::ffi::c_int;

pub use bun_core::Ordinal;

/// Represents a position in source code with line and column information
#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct ZigStackFramePosition {
    pub line: Ordinal,
    pub column: Ordinal,
    /// -1 if not present
    pub line_start_byte: c_int,
}

impl ZigStackFramePosition {
    pub const INVALID: ZigStackFramePosition = ZigStackFramePosition {
        line: Ordinal::INVALID,
        column: Ordinal::INVALID,
        line_start_byte: -1,
    };

    pub fn is_invalid(&self) -> bool {
        *self == Self::INVALID
    }

    pub fn decode<R>(reader: &mut R) -> Result<Self, bun_analytics::Error>
    where
        R: ?Sized + bun_analytics::Reader,
    {
        Ok(Self {
            line: Ordinal::from_zero_based(reader.read_value::<i32>()?),
            column: Ordinal::from_zero_based(reader.read_value::<i32>()?),
            // `encode` never writes this field, so a decoded frame has no
            // line-start-byte information: -1 means "not present".
            line_start_byte: -1,
        })
    }

    pub fn encode(&self, writer: &mut bun_options_types::schema::Writer<'_>) {
        writer.write_int(self.line.zero_based());
        writer.write_int(self.column.zero_based());
    }
}
