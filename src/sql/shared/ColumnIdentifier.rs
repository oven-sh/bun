use super::data::Data;

pub enum ColumnIdentifier {
    Name(Data),
    Index(u32),
    /// A later column has this name too, so a row object leaves this one out.
    Duplicate(Data),
}

impl ColumnIdentifier {
    pub fn init(name: Data) -> Result<Self, bun_alloc::AllocError> {
        unsafe extern "C" {
            fn JSC__parseIndex(name: *const u8, length: usize) -> u32;
        }
        const NOT_AN_INDEX: u32 = u32::MAX;
        const U32_MAX_DIGITS: usize = "4294967295".len();
        let bytes = name.slice();
        match bytes.len() {
            0 => return Ok(Self::Name(Data::Empty)),
            1..=U32_MAX_DIGITS if bytes[0].is_ascii_digit() => {
                // SAFETY: `bytes` is a live slice and the callee only reads `bytes.len()` bytes.
                let index = unsafe { JSC__parseIndex(bytes.as_ptr(), bytes.len()) };
                if index != NOT_AN_INDEX {
                    return Ok(Self::Index(index));
                }
            }
            _ => {}
        }

        let owned = name.to_owned()?;
        let owned = match bstr::ByteSlice::to_str_lossy(owned.as_slice()) {
            std::borrow::Cow::Owned(replaced) => replaced.into_bytes(),
            std::borrow::Cow::Borrowed(_) => owned,
        };
        Ok(Self::Name(Data::Owned(owned)))
    }
}

// `deinit` dropped: the only work was `name.deinit()`, which Rust handles via
// `Data: Drop` when the `Name` variant is dropped.
