mod ids;
mod lookup;
mod modules;
mod removable_calls;
mod syntax;

use super::{BuiltinId, BuiltinName, find_name};

fn all_ids() -> impl Iterator<Item = BuiltinId> {
    BuiltinId::ALL.into_iter()
}

fn all_names() -> impl Iterator<Item = BuiltinName> {
    (0..BuiltinName::COUNT).map(BuiltinName)
}

#[track_caller]
fn name(text: &str) -> BuiltinName {
    find_name(text.as_bytes()).unwrap_or_else(|| panic!("`{text}` is not in the name table"))
}
