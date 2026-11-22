//! Byte searches, in place of the `strchr` family of `cstring.h`.

use crate::common::slice_ext::SliceExt;
pub(crate) use bun_core::strings::{
    index_of_char_usize as find_byte, last_index_of_char as find_last_byte,
};

/// Returns the part before the first NUL.
pub(crate) fn until_nul<T: Default + PartialEq>(text: &[T]) -> &[T] {
    text.slice(
        ..text
            .iter()
            .take_while(|&unit| *unit != T::default())
            .count(),
    )
}

/// Splits at the first `separator`. The second part is `None` if there is no `separator`.
pub(crate) fn split_once(text: &[u8], separator: u8) -> (&[u8], Option<&[u8]>) {
    match bun_core::strings::split_once_char(text, separator) {
        Some((before, after)) => (before, Some(after)),
        None => (text, None),
    }
}
