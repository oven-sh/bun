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
        if might_be_int {
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
