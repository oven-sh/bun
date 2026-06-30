//! `PackageManager`-side impls for the canonical
//! `bun_install_types::dependency` parsing surface.
use bun_install_types::dependency::{NpmAliasRegistry, StringBuilderLike, Version};

use crate::{PackageManager, PackageNameHash};

impl NpmAliasRegistry for PackageManager {
    #[inline]
    fn record_npm_alias(&mut self, hash: PackageNameHash, version: &Version) {
        self.known_npm_aliases.insert(hash, Clone::clone(version));
    }
}

/// Field-level adapter so callers that have already split-borrowed
/// `PackageManager` (e.g. they hold `&mut manager.lockfile` for a
/// `StringBuilder`) can pass `&mut manager.known_npm_aliases` to
/// `Dependency::clone_in` / `OverrideMap::clone` instead of a full
/// `&mut PackageManager`. (A direct impl on the map type is impossible:
/// both the trait and `HashMap` are foreign to this crate.)
pub(crate) struct NpmAliasMapRegistry<'a>(
    pub(crate) &'a mut crate::package_manager_real::NpmAliasMap,
);

impl NpmAliasRegistry for NpmAliasMapRegistry<'_> {
    #[inline]
    fn record_npm_alias(&mut self, hash: PackageNameHash, version: &Version) {
        self.0.insert(hash, Clone::clone(version));
    }
}

// single-impl monomorphization is intentional — `semver_string::Builder` is
// never used here, and its isolated Box<[u8]> can't satisfy
// `builder.lockfile.buffers.string_bytes`.
impl<'a> StringBuilderLike for crate::lockfile::StringBuilder<'a> {
    #[inline]
    fn string_bytes(&self) -> &[u8] {
        self.string_bytes.as_slice()
    }
}
