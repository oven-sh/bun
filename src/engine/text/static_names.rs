//! The names of `names.txt`: immortal, shared by every thread, and constants to the code that names them.

#![allow(non_upper_case_globals)]

use crate::{PropertyName, StaticString, StaticSymbol, Text};

include!(concat!(env!("OUT_DIR"), "/static_names.rs"));

pub const STATIC_ATOM_COUNT: usize = ATOMS.len();

/// The symbol that `@name` stands for in the source of a built-in.
pub fn find_private_name(name: Text<'_>, hash: u32) -> Option<PropertyName<'static>> {
    let mask = PRIVATE_NAME_SLOTS.len() - 1;
    let mut slot = hash as usize & mask;
    loop {
        let index = usize::from(PRIVATE_NAME_SLOTS[slot]).checked_sub(1)?;
        let symbol = PropertyName::from_static_symbol(&PRIVATE_NAMES[index]);
        if symbol.string().existing_hash() == hash && symbol.text() == name {
            return Some(symbol);
        }
        slot = (slot + 1) & mask;
    }
}

/// The symbol that `@@name` stands for in the source of a built-in.
pub fn find_well_known_symbol(name: Text<'_>) -> Option<PropertyName<'static>> {
    WELL_KNOWN_SYMBOLS
        .iter()
        .map(PropertyName::from_static_symbol)
        .find(|symbol| symbol.text().slice_from("Symbol.".len()) == name)
}
