use bun_paths::platform::Posix;
use bun_paths::resolve_path::join_spill;
use bun_sema::resolve::DeclaredSideEffects;

/// The answer of the bundler's `SideEffects::has_side_effects`, negated.
pub(super) fn is_declared_free_of_side_effects(
    declared: DeclaredSideEffects<'_>,
    path: &[u8],
) -> bool {
    match declared {
        DeclaredSideEffects::Unspecified => false,
        DeclaredSideEffects::None => true,
        DeclaredSideEffects::Listed { directory, entries } => {
            let mut entries = entries.iter();
            path.starts_with(directory) && !entries.any(|entry| names(directory, entry, path))
        }
    }
}

fn is_pattern(entry: &[u8]) -> bool {
    let has_wildcard = bun_core::strings::index_of_any(entry, b"*?[{").is_some();
    has_wildcard || bun_glob::has_extglob_prefix(entry)
}

fn names(directory: &[u8], entry: &[u8], path: &[u8]) -> bool {
    let mut long_path = Vec::new();
    let named = join_spill::<Posix>(&mut long_path, &[directory, entry]);
    match is_pattern(entry) {
        true => bun_glob::Prepared::new(named).r#match(path).matches(),
        false => named == path,
    }
}
