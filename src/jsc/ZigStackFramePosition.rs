use core::ffi::c_int;

use bun_core::Ordinal;

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
        // Zig: std.mem.eql(u8, std.mem.asBytes(this), std.mem.asBytes(&invalid))
        // #[repr(C)] + derived PartialEq on POD fields is equivalent.
        *self == Self::INVALID
    }

    // TODO(port): narrow error set
    // TODO(port): `reader: anytype` — bound by whatever trait provides `read_value::<i32>()`
    pub fn decode<R>(reader: &mut R) -> Result<Self, bun_core::Error>
    where
        R: ?Sized, // TODO(port): add proper Reader trait bound
    {
        Ok(Self {
            line: Ordinal::from_zero_based(reader.read_value::<i32>()?),
            column: Ordinal::from_zero_based(reader.read_value::<i32>()?),
            // TODO(port): Zig's `decode` omits `line_start_byte` in the struct literal
            // (extern-struct field left at zero/default). Confirm intended value in Phase B.
            line_start_byte: 0,
        })
    }

    // TODO(port): `writer: anytype` — bound by whatever trait provides `write_int(i32)`
    pub fn encode<W>(&self, writer: &mut W) -> Result<(), bun_core::Error>
    where
        W: ?Sized, // TODO(port): add proper Writer trait bound
    {
        writer.write_int(self.line.zero_based())?;
        writer.write_int(self.column.zero_based())?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ZigStackFramePosition.zig (32 lines)
//   confidence: medium
//   todos:      5
//   notes:      reader/writer anytype params need trait bounds; decode's omitted line_start_byte field needs confirmation
// ──────────────────────────────────────────────────────────────────────────
