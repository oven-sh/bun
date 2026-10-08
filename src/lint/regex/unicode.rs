//! What regular expressions need to know about Unicode.

use super::unicode_tables as tables;
use bun_core::strings;

/// The index of `name` in `names`, which are separated by spaces.
fn index_of_name(names: &'static [u8], name: &[u8]) -> Option<usize> {
    let mut all = strings::split(names, b" ");
    let mut index = 0;
    while let Some(candidate) = all.next() {
        if candidate == name {
            return Some(index);
        }
        index += 1;
    }
    None
}

/// Looks `name` up in a table of `version << 8 | index`.
fn versioned(names: &'static [u8], values: &'static [u16], name: &[u8]) -> Option<(u32, u8)> {
    let value = *values.get(index_of_name(names, name)?)?;
    Some((2018 + u32::from(value >> 8), value as u8))
}

fn is_general_category(name: &[u8]) -> bool {
    matches!(name, b"General_Category" | b"gc")
}

fn is_script(name: &[u8]) -> bool {
    matches!(name, b"Script" | b"Script_Extensions" | b"sc" | b"scx")
}

/// `\p{name=value}`
pub(super) fn is_valid_unicode_property(version: u32, name: &[u8], value: &[u8]) -> bool {
    if is_general_category(name) {
        return version >= 2018 && index_of_name(tables::GENERAL_CATEGORY_NAMES, value).is_some();
    }
    if is_script(name) {
        return versioned(tables::SCRIPT_NAMES, tables::SCRIPT_VALUES, value)
            .is_some_and(|(since, _)| version >= since);
    }
    false
}

/// `\p{value}`
pub(super) fn is_valid_lone_unicode_property(version: u32, value: &[u8]) -> bool {
    versioned(tables::BINARY_NAMES, tables::BINARY_VALUES, value)
        .is_some_and(|(since, _)| version >= since)
}

/// `\p{value}` with the `v` flag.
pub(super) fn is_valid_lone_unicode_property_of_string(version: u32, value: &[u8]) -> bool {
    version >= 2024 && index_of_name(tables::STRING_PROPERTY_NAMES, value).is_some()
}
