use core::ptr::NonNull;

use bun_engine_text::{CodeUnit, StringImpl, StringRef};

use crate::string::Utf8Bytes;
use crate::strings;

/// Behaves like `WTF::Ref<WTF::StringImpl>`.
pub use crate::external_shared::WTFString;

/// `WTF::StringImpl` in C++.
#[repr(transparent)]
pub struct WTFStringImplStruct(StringImpl);

/// Always non-null when `tag == WTFStringImpl`.
pub type WTFStringImpl = *mut WTFStringImplStruct;

impl WTFStringImplStruct {
    #[inline(always)]
    pub fn string(&self) -> &StringImpl {
        &self.0
    }
    #[inline]
    pub fn length(&self) -> u32 {
        self.0.len() as u32
    }
    #[inline]
    pub fn is_8bit(&self) -> bool {
        self.0.is_latin1()
    }
    #[inline]
    pub fn byte_length(&self) -> usize {
        self.0.byte_length()
    }
    #[inline]
    pub fn memory_cost(&self) -> usize {
        self.byte_length()
    }
    #[inline]
    pub fn r#ref(&self) {
        StringRef::retain(&self.0).into_raw();
    }
    /// # Safety
    /// The caller gives up a ref that it holds.
    #[inline]
    pub unsafe fn deref(this: WTFStringImpl) {
        // SAFETY: the caller's ref.
        drop(unsafe { StringRef::from_raw(NonNull::new_unchecked(this.cast())) });
    }
    #[inline]
    pub fn byte_slice(&self) -> &[u8] {
        // SAFETY: the characters take that many bytes, and live as long as `self`.
        unsafe { core::slice::from_raw_parts(self.0.characters().cast(), self.byte_length()) }
    }
    #[inline]
    pub fn latin1_slice(&self) -> &[u8] {
        debug_assert!(self.is_8bit());
        &self.byte_slice()[..self.0.len()]
    }
    #[inline]
    pub fn utf16_slice(&self) -> &[u16] {
        debug_assert!(!self.is_8bit());
        u16::units(self.0.text()).unwrap_or_default()
    }
    /// In no atom table, and not part of another string.
    #[inline]
    pub(crate) fn is_thread_isolated(&self) -> bool {
        self.0.is_static() || !(self.0.is_atom() || self.0.is_symbol() || self.0.is_substring())
    }
    /// Isolated, and no holder changes it: the hash is computed, and it is never atomized in place.
    #[inline]
    pub(crate) fn is_thread_shareable(&self) -> bool {
        self.0.is_static() || (self.is_thread_isolated() && !self.0.can_become_atom())
    }

    /// Borrows the impl's own bytes when 8-bit all-ASCII (no ref taken);
    /// transcodes otherwise.
    #[inline]
    pub fn to_utf8(&self) -> Utf8Bytes<'_> {
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
    pub fn to_owned_slice_z(&self) -> crate::ZBox {
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
    pub fn can_use_as_utf8(&self) -> bool {
        self.is_8bit() && strings::is_all_ascii(self.latin1_slice())
    }

    pub fn utf8_byte_length(&self) -> usize {
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
    pub fn utf8_slice(&self) -> &[u8] {
        debug_assert!(self.can_use_as_utf8());
        self.latin1_slice()
    }
}

// `parse_double` lives in `bun_core::fmt` (tier-0) so `bun_interchange`
// (yaml/toml) and `bun_js_parser::lexer` can call it without a string dep.
pub use crate::fmt::{InvalidCharacter, parse_double};
