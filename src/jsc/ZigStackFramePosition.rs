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
}
