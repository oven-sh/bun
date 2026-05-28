use super::data::Data;

pub enum ColumnIdentifier {
    Name(Data),
    Index(u32),
    Duplicate,
}

impl ColumnIdentifier {
    pub fn init(name: Data) -> Result<Self, bun_alloc::AllocError> {
        // TODO(port): narrow error set — only `try` site is name.to_owned()
        const U32_MAX_DIGITS: usize = "4294967295".len();
        let might_be_int = match name.slice().len() {
            1..=U32_MAX_DIGITS => true,
            0 => return Ok(Self::Name(Data::Empty)),
            _ => false,
        };
        // `parse_unsigned` skips embedded `_` separators (it ports Zig
        // `std.fmt.parseInt`), so a column named `"2024_01"` would parse as
        // `202401` and be misclassified as an array index. The original Zig
        // hand-loop only accepted `'0'..'9'`; mirror that by requiring every
        // byte be an ASCII digit before treating the name as an index.
        if might_be_int && name.slice().iter().all(|b| b.is_ascii_digit()) {
            if let Ok(int) = bun_core::parse_unsigned::<u64>(name.slice(), 10) {
                // keep `<` (not ≤): JSC indexed-property bound
                if int < u32::MAX as u64 {
                    return Ok(Self::Index(int as u32));
                }
            }
        }

        Ok(Self::Name(Data::Owned(name.to_owned()?)))
    }
}

// `deinit` dropped: the only work was `name.deinit()`, which Rust handles via
// `Data: Drop` when the `Name` variant is dropped.

// ported from: src/sql/shared/ColumnIdentifier.zig
