//! The characters that do not count at the ends of a formatted field. ICU4C: static_unicode_sets.cpp

use crate::common::memory::get_or_try_init;
use crate::common::resource::ResourceValue;
use crate::common::ubidi_props::ubidi_is_bidi_control;
use crate::common::uchar::{is_variation_selector, u_char_type};
use crate::common::unicode::uchar::U_SPACE_SEPARATOR;
use crate::common::uniset::UnicodeSet;
use crate::common::unistr::ustr;
use crate::common::uresimp::{ures_get_all_items_with_fallback, ures_open};
use crate::common::utypes::UErrorCode;
use std::sync::OnceLock;

/// Checks the arrays of patterns `parse/<context>/<strictness>`. ICU4C: static_unicode_sets.cpp, ParseDataSink
fn check_parse_data() -> Result<(), UErrorCode> {
    let signs = ustr(".,+-$£₹¥₩%‰’");
    let mut sink = |value: &ResourceValue| {
        for (context, value) in value.get_table()?.iter() {
            if context == b"date" {
                continue;
            }
            for (_, value) in value.get_table()?.iter() {
                for value in value.get_array()?.iter() {
                    let pattern = value.get_unicode_string()?;
                    if pattern.iter().any(|c| signs.contains(c)) {
                        UnicodeSet::from_pattern(&pattern)?;
                    }
                }
            }
        }
        Ok(())
    };
    ures_get_all_items_with_fallback(&ures_open(None, b"root")?, b"parse", &mut sink)
}

#[inline(never)]
fn has_valid_parse_data() -> bool {
    static IS_VALID: OnceLock<bool> = OnceLock::new();
    get_or_try_init(&IS_VALID, || Ok(check_parse_data().is_ok())) == Ok(&true)
}

/// `[[:Zs:][\u0009][:Bidi_Control:][:Variation_Selector:]]`, or nothing if the data for parsing are not valid.
pub(crate) fn is_default_ignorable(c: u32) -> bool {
    (u_char_type(c) == U_SPACE_SEPARATOR
        || c == 9
        || ubidi_is_bidi_control(c)
        || is_variation_selector(c))
        && has_valid_parse_data()
}
