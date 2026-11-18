//! `toLocaleLowerCase` and `toLocaleUpperCase` of `String.prototype`.

use bun_engine_text::{StringRef, Text};
pub use bun_icu::case_map::Case;

use crate::parts::new_string;
use crate::utf16::Utf16Buffer;
use crate::{Cache, Error, LanguageTag, Result};

/// TransformCase. `None` if `text` stays as it is.
pub fn transform_case(
    cache: &Cache,
    text: Text<'_>,
    requested: &[LanguageTag],
    case: Case,
) -> Result<Option<StringRef>> {
    let default;
    let locale = match requested {
        [first, ..] => first,
        [] => {
            default = cache.default_locale();
            &default
        }
    };
    let language = match (locale.language(), case) {
        (b"az", _) => c"az",
        (b"el", Case::Upper) => c"el",
        (b"lt", _) => c"lt",
        (b"tr", _) => c"tr",
        (_, Case::Lower) => return Ok(bun_engine_unicode::to_lower_case(text)?),
        (_, Case::Upper) => return Ok(bun_engine_unicode::to_upper_case(text)?),
    };
    if text.len() > bun_icu::case_map::MAX_TEXT_LENGTH {
        return Err(Error::OutOfMemory);
    }
    let mut buffer = Utf16Buffer::new();
    let units = buffer.widen(text)?;
    let converted = (case.convert(units, language)).map_err(|_| Error::OutOfMemory)?;
    if *converted == *units {
        return Ok(None);
    }
    new_string(&converted).map(Some)
}
