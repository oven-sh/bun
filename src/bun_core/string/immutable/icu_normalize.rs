//! Unicode normalization with ICU, which is what `String.prototype.normalize` uses.

use super::{first_non_ascii, wtf8_to_utf16, wtf16_to_wtf8};
use std::borrow::Cow;

unsafe extern "C" {
    fn Bun__normalizeUTF16(
        form: u8,
        text: *const u16,
        len: usize,
        out: *mut u16,
        capacity: usize,
    ) -> i32;
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum NormalizationForm {
    Nfc,
    Nfd,
    Nfkc,
    Nfkd,
}

/// `text.normalize(form)` for WTF-8. Returns `Cow::Borrowed` if `text` is already normalized.
pub fn normalize(text: &[u8], form: NormalizationForm) -> Cow<'_, [u8]> {
    // ASCII is already normalized in every form.
    if first_non_ascii(text).is_none() || i32::try_from(text.len()).is_err() {
        return Cow::Borrowed(text);
    }
    let units = wtf8_to_utf16(text);
    let mut out: Vec<u16> = vec![0; units.len() + units.len() / 2 + 8];
    // If the buffer is too small, the first call returns the length it needs, so the second call has room.
    for _ in 0..2 {
        // SAFETY: `units` is only read, `out` is written up to its length, and the callee keeps neither pointer.
        let len = unsafe {
            Bun__normalizeUTF16(
                form as u8,
                units.as_ptr(),
                units.len(),
                out.as_mut_ptr(),
                out.len(),
            )
        };
        let Ok(len) = usize::try_from(len) else {
            break;
        };
        if len <= out.len() {
            out.truncate(len);
            return match out == units {
                true => Cow::Borrowed(text),
                false => Cow::Owned(wtf16_to_wtf8(&out)),
            };
        }
        out.resize(len, 0);
    }
    Cow::Borrowed(text)
}
