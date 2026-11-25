use std::borrow::Cow;

pub enum ColumnIdentifier {
    Name(Vec<u8>),
    Index(u32),
    /// A later column has this name too, so a row object leaves this one out.
    Duplicate(Vec<u8>),
}

impl ColumnIdentifier {
    pub fn init(bytes: Cow<'_, [u8]>) -> Self {
        unsafe extern "C" {
            fn JSC__parseIndex(name: *const u8, length: usize) -> u32;
        }
        const NOT_AN_INDEX: u32 = u32::MAX;
        const U32_MAX_DIGITS: usize = "4294967295".len();
        match bytes.len() {
            1..=U32_MAX_DIGITS if bytes[0].is_ascii_digit() => {
                // SAFETY: `bytes` is a live slice and the callee only reads `bytes.len()` bytes.
                let index = unsafe { JSC__parseIndex(bytes.as_ptr(), bytes.len()) };
                if index != NOT_AN_INDEX {
                    return Self::Index(index);
                }
            }
            _ => {}
        }

        Self::Name(match bstr::ByteSlice::to_str_lossy(&*bytes) {
            Cow::Owned(replaced) => replaced.into_bytes(),
            Cow::Borrowed(_) => bytes.into_owned(),
        })
    }
}
