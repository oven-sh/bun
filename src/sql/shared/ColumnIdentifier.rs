use super::data::Data;

pub enum ColumnIdentifier {
    Name(Data),
    Index(u32),
    Duplicate,
}

impl ColumnIdentifier {
    pub(crate) fn init(name: Data) -> Result<Self, bun_alloc::AllocError> {
        const U32_MAX_DIGITS: usize = "4294967295".len();
        let might_be_int = match name.slice().len() {
            1..=U32_MAX_DIGITS => true,
            0 => return Ok(Self::Name(Data::Empty)),
            _ => false,
        };
        if might_be_int {
            // Only `'0'..='9'` — not `parse_unsigned`, which skips embedded `_`
            // separators and would turn a column named `2024_01` into `202401`.
            // `U32_MAX_DIGITS` caps the length, so `u64` cannot overflow here.
            let mut int: u64 = 0;
            let mut all_digits = true;
            for &byte in name.slice() {
                match byte {
                    b'0'..=b'9' => int = int * 10 + (byte - b'0') as u64,
                    _ => {
                        all_digits = false;
                        break;
                    }
                }
            }
            // keep `<` (not ≤): JSC indexed-property bound
            if all_digits && int < u32::MAX as u64 {
                return Ok(Self::Index(int as u32));
            }
        }

        Ok(Self::Name(Data::Owned(name.to_owned()?)))
    }
}

// `deinit` dropped: the only work was `name.deinit()`, which Rust handles via
// `Data: Drop` when the `Name` variant is dropped.
