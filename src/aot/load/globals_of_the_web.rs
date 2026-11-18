use std::sync::OnceLock;

use crate::builtins::{BuiltinId, table};

include!(concat!(env!("BUN_CODEGEN_DIR"), "/web_globals.rs"));

fn find_globals(names: &[&str]) -> Vec<u32> {
    let mut globals: Vec<u32> = (names.iter())
        .filter_map(|name| table::global(table::find_name(name.as_bytes())?))
        .map(|id| id as u32)
        .collect();
    globals.sort_unstable();
    globals
}

/// The names under which a window or a worker does not have what Bun has.
pub(crate) fn absent_or_different() -> &'static [u32] {
    static GLOBALS: OnceLock<Vec<u32>> = OnceLock::new();
    GLOBALS.get_or_init(|| find_globals(ABSENT_OR_DIFFERENT))
}

pub(crate) fn is_absent_or_different(global: BuiltinId) -> bool {
    absent_or_different()
        .binary_search(&(global as u32))
        .is_ok()
}

pub(crate) fn depending_on_realm() -> Vec<u32> {
    find_globals(DEPENDS_ON_REALM)
}

pub(crate) fn kept_aside() -> Vec<u32> {
    find_globals(KEPT_ASIDE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_name_is_a_built_in() {
        assert_eq!(absent_or_different().len(), ABSENT_OR_DIFFERENT.len());
        assert_eq!(depending_on_realm().len(), DEPENDS_ON_REALM.len());
        assert_eq!(kept_aside().len(), KEPT_ASIDE.len());
        assert!(is_absent_or_different(BuiltinId::Process));
        assert!(!is_absent_or_different(BuiltinId::URL));
    }
}
