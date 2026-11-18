//! The shapes and ranges of the arguments that ICU is given, the same for every release.

use core::ffi::{CStr, c_char};

use crate::ffi::length;
use crate::{Error, Result};

fn require(condition: bool) -> Result<()> {
    condition.then_some(()).ok_or(Error::ILLEGAL_ARGUMENT)
}

/// With its terminator it fits `ULOC_KEYWORDS_CAPACITY`, the smaller of the two sizes that ICU documents for an
/// identifier or a part of one.
pub(crate) const MAX_LOCALE_ID_LENGTH: usize = 95;

/// `language[_Script][_REGION][_VARIANT…][@key=value;…]` or `root[@key=value;…]`, with `_` or `-` between the subtags
/// and no extension of BCP 47.
pub(crate) fn locale_id(id: &CStr) -> Result<*const c_char> {
    #[derive(Clone, Copy)]
    enum Part {
        Language,
        Subtag,
        Key,
        Value,
    }

    require(id.count_bytes() <= MAX_LOCALE_ID_LENGTH)?;
    let bytes = id.to_bytes_with_nul();
    let (mut part, mut start) = (Part::Language, 0);
    for (index, &byte) in bytes.iter().enumerate() {
        let next = match (part, byte) {
            (_, b'a'..=b'z' | b'A'..=b'Z')
            | (Part::Subtag | Part::Key | Part::Value, b'0'..=b'9')
            | (Part::Value, b'-') => continue,
            (Part::Language | Part::Subtag, b'_' | b'-' | 0) => Part::Subtag,
            (Part::Language | Part::Subtag, b'@') | (Part::Value, b';' | 0) => Part::Key,
            (Part::Key, b'=') => Part::Value,
            _ => return Err(Error::ILLEGAL_ARGUMENT),
        };
        let length = index - start;
        require(match part {
            Part::Language => {
                matches!(length, 0 | 2 | 3 | 5..=8)
                    || matches!(bytes[..=index], [b'r', b'o', b'o', b't', 0 | b'@'])
            }
            Part::Subtag => matches!(length, 0 | 2..=8),
            Part::Key => matches!(length, 2..=24),
            Part::Value => length != 0,
        })?;
        (part, start) = (next, index + 1);
    }
    Ok(id.as_ptr())
}

/// Of text that ICU holds in an expanded form, in which a unit takes the room of up to 22.
pub(crate) const MAX_EXPANDABLE_LENGTH: usize = 1 << 25;

pub(crate) fn expandable_length<T>(text: &[T]) -> Result<i32> {
    if text.len() > MAX_EXPANDABLE_LENGTH {
        return Err(Error::MEMORY_ALLOCATION);
    }
    length(text)
}

fn printable_ascii_length(text: &[u16], longest: usize) -> Result<i32> {
    require(text.len() <= longest && text.iter().all(|unit| matches!(unit, 0x20..=0x7e)))?;
    length(text)
}

pub(crate) fn zone_id_length(id: &[u16]) -> Result<i32> {
    printable_ascii_length(id, crate::time_zone::MAX_ID_LENGTH)
}

const LONGEST_PATTERN: usize = 1024;

/// Of the pattern or the skeleton of a date.
pub(crate) fn pattern_length(pattern: &[u16]) -> Result<i32> {
    require(pattern.len() <= LONGEST_PATTERN)?;
    length(pattern)
}

pub(crate) fn number_skeleton_length(skeleton: &[u16]) -> Result<i32> {
    printable_ascii_length(skeleton, LONGEST_PATTERN)
}

/// Whole milliseconds, a little further from the epoch than a time value of ECMA-262 can be.
pub(crate) fn time_value(time: f64) -> Result<f64> {
    require(time.abs() <= (1u64 << 53) as f64)?;
    Ok(time.floor())
}
