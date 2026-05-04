use super::Data::Data;

pub enum ColumnIdentifier {
    Name(Data),
    Index(u32),
    Duplicate,
}

impl ColumnIdentifier {
    pub fn init(name: Data) -> Result<Self, bun_alloc::AllocError> {
        // TODO(port): narrow error set — only `try` site is name.to_owned()
        let might_be_int = match name.slice().len() {
            1..="4294967295".len() => true,
            0 => return Ok(Self::Name(Data::Empty)),
            _ => false,
        };
        if might_be_int {
            'might_be_int: {
                // use a u64 to avoid overflow
                let mut int: u64 = 0;
                for &byte in name.slice() {
                    int = int * 10
                        + match byte {
                            b'0'..=b'9' => (byte - b'0') as u64,
                            _ => break 'might_be_int,
                        };
                }

                // JSC only supports indexed property names up to 2^32
                if int < u32::MAX as u64 {
                    return Ok(Self::Index(u32::try_from(int).unwrap()));
                }
            }
        }

        Ok(Self::Name(Data::Owned(name.to_owned()?)))
    }
}

// `deinit` dropped: the only work was `name.deinit()`, which Rust handles via
// `Data: Drop` when the `Name` variant is dropped.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/shared/ColumnIdentifier.zig (38 lines)
//   confidence: medium
//   todos:      1
//   notes:      Data variant constructors (Empty/Owned) and .to_owned() signature assumed; verify against ported Data.rs
// ──────────────────────────────────────────────────────────────────────────
