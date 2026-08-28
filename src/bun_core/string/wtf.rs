use crate::string::Utf8Bytes;
use crate::strings;

// The struct layout lives in `bun_alloc` (lowest-tier crate).
pub use bun_alloc::{WTFStringImpl, WTFStringImplPtr, WTFStringImplStruct};

/// Behaves like `WTF::Ref<WTF::StringImpl>`. The
/// [`crate::external_shared::ExternalSharedDescriptor`] impl lives alongside
/// the trait in `bun_core::external_shared` (orphan rule: trait owner gets
/// the impl since the type is foreign — defined in `bun_alloc`).
pub use crate::external_shared::WTFString;

/// Extension methods on [`WTFStringImplStruct`] that depend on
/// `bun_core` types ([`Utf8Bytes`], `crate::ZBox`) or
/// `crate::strings::*` transcoding. Kept as a trait because the struct is
/// defined in `bun_alloc` and an inherent `impl` here would violate the orphan
/// rule. Glob-imported via `bun_core::WTFStringImplExt` so method-call syntax
/// keeps working at every existing callsite.
pub trait WTFStringImplExt {
    fn to_utf8(&self) -> Utf8Bytes<'_>;
    fn to_owned_slice_z(&self) -> crate::ZBox;
    fn can_use_as_utf8(&self) -> bool;
    fn utf8_byte_length(&self) -> usize;
    fn utf8_slice(&self) -> &[u8];
}

impl WTFStringImplExt for WTFStringImplStruct {
    /// Borrows the impl's own bytes when 8-bit all-ASCII (no ref taken);
    /// transcodes otherwise.
    #[inline]
    fn to_utf8(&self) -> Utf8Bytes<'_> {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return Utf8Bytes::Owned(utf8);
            }

            return Utf8Bytes::Borrowed(self.latin1_slice());
        }

        Utf8Bytes::Owned(strings::to_utf8_alloc(self.utf16_slice()))
    }

    /// Allocates a NUL-terminated UTF-8 copy.
    /// `.len()` excludes the sentinel.
    fn to_owned_slice_z(&self) -> crate::ZBox {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1_z(self.latin1_slice()) {
                return utf8;
            }
            // ASCII: copy bytes; ZBox appends the NUL.
            return crate::ZBox::from_vec_with_nul(self.latin1_slice().to_vec());
        }
        strings::to_utf8_alloc_z(self.utf16_slice())
    }

    /// Avoid using this in code paths that are about to get the string as
    /// UTF-8; use `to_utf8` there instead.
    fn can_use_as_utf8(&self) -> bool {
        self.is_8bit() && strings::is_all_ascii(self.latin1_slice())
    }

    fn utf8_byte_length(&self) -> usize {
        if self.is_8bit() {
            let input = self.latin1_slice();
            if !input.is_empty() {
                // latin1→utf8 length: each high byte becomes 2 utf8 bytes.
                strings::element_length_latin1_into_utf8(input)
            } else {
                0
            }
        } else {
            let input = self.utf16_slice();
            if !input.is_empty() {
                strings::element_length_utf16_into_utf8(input)
            } else {
                0
            }
        }
    }

    /// Caller must ensure that the string is 8-bit and ASCII.
    #[inline]
    fn utf8_slice(&self) -> &[u8] {
        debug_assert!(self.can_use_as_utf8());
        self.raw_bytes(self.length() as usize)
    }
}

// `WTF::parseDouble` lives in `bun_core::fmt` (tier-0) so `bun_interchange`
// (yaml/toml) and `bun_js_parser::lexer` can call it without a string dep.
pub use crate::fmt::{InvalidCharacter, parse_double};
