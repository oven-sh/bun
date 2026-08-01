use bun_collections::HashMap;
use bun_collections::zig_hash_map::MapEntry as Entry;
use bun_semver::string::Builder as StringBuilder;
use bun_sys::Fd;

use crate::PackageNameHash;
use crate::npm;

#[derive(Default)]
pub struct PackageManifestMap {
    pub(crate) hash_map: ManifestHashMap,
}

pub enum Value {
    Expired(npm::PackageManifest),
    Manifest(npm::PackageManifest),

    // Avoid checking the filesystem again.
    NotFound,
}

impl Value {
    bun_core::enum_unwrap!(pub Value, Manifest => fn manifest / manifest_mut -> npm::PackageManifest);
}

type ManifestHashMap =
    HashMap<PackageNameHash, Value, bun_collections::IdentityContext<PackageNameHash>>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CacheBehavior {
    LoadFromMemory,
    LoadFromMemoryFallbackToDisk,
}

/// By-value snapshot of the `PackageManager` fields the disk-fallback path of
/// [`PackageManifestMap::by_name_hash_allow_expired`] reads.
///
/// Every
/// caller is `pm.manifests.by_name…(pm, …)`, so accepting `&mut PackageManager`
/// (or `&mut *raw`) would alias the `&mut self` receiver — Stacked-Borrows UB
/// regardless of which fields the body touches. Capturing the four scalars by
/// value lets callers split `&mut pm.manifests` from `&pm.lockfile` /
/// `&pm.options` with safe disjoint-field borrows and keeps this map free of a
/// `PackageManager` dependency.
///
/// Construct via `PackageManager::manifest_disk_cache_ctx`.
#[derive(Clone, Copy)]
pub struct DiskCacheCtx {
    pub(crate) enable_manifest_cache: bool,
    pub(crate) enable_manifest_cache_control: bool,
    /// `pm.getCacheDirectory()` — pre-opened so the lookup never needs `&mut
    /// PackageManager`. `None` iff `enable_manifest_cache` is false (the only
    /// branch that reads it is gated on that flag).
    pub(crate) cache_directory: Option<Fd>,
    pub(crate) timestamp_for_manifest_cache_control: u32,
}

impl PackageManifestMap {
    pub(crate) fn by_name(
        &mut self,
        ctx: DiskCacheCtx,
        scope: &npm::registry::Scope,
        name: &[u8],
        cache_behavior: CacheBehavior,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        self.by_name_hash(
            ctx,
            scope,
            StringBuilder::string_hash(name),
            cache_behavior,
            needs_extended_manifest,
        )
    }

    pub(crate) fn insert(
        &mut self,
        name_hash: PackageNameHash,
        manifest: npm::PackageManifest,
    ) -> Result<(), bun_alloc::AllocError> {
        self.hash_map.insert(name_hash, Value::Manifest(manifest));
        Ok(())
    }

    pub(crate) fn by_name_hash(
        &mut self,
        ctx: DiskCacheCtx,
        scope: &npm::registry::Scope,
        name_hash: PackageNameHash,
        cache_behavior: CacheBehavior,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        self.by_name_hash_allow_expired(
            ctx,
            scope,
            name_hash,
            None,
            cache_behavior,
            needs_extended_manifest,
        )
    }

    /// Memory-only lookup — equivalent to `by_name_hash` with
    /// `CacheBehavior::LoadFromMemory`, but without the `ctx`/`scope`
    /// parameters: the memory-only arm never reads them. Exposed separately so callers
    /// holding `&mut PackageManager` can borrow only the disjoint
    /// `pm.manifests` field.
    pub(crate) fn by_name_hash_in_memory(
        &mut self,
        name_hash: PackageNameHash,
    ) -> Option<&mut npm::PackageManifest> {
        match self.hash_map.get_mut(&name_hash)? {
            Value::Manifest(m) => Some(m),
            Value::Expired(_) | Value::NotFound => None,
        }
    }

    pub fn by_name_allow_expired(
        &mut self,
        ctx: DiskCacheCtx,
        scope: &npm::registry::Scope,
        name: &[u8],
        is_expired: Option<&mut bool>,
        cache_behavior: CacheBehavior,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        self.by_name_hash_allow_expired(
            ctx,
            scope,
            StringBuilder::string_hash(name),
            is_expired,
            cache_behavior,
            needs_extended_manifest,
        )
    }

    /// The `PackageManager` scalars read on the disk-fallback arm
    /// (`options.enable.*`, the cache directory, and
    /// `timestamp_for_manifest_cache_control`) are hoisted into
    /// [`DiskCacheCtx`] so callers never hold `&mut pm.manifests` and a
    /// `PackageManager` borrow simultaneously.
    pub(crate) fn by_name_hash_allow_expired(
        &mut self,
        ctx: DiskCacheCtx,
        scope: &npm::registry::Scope,
        name_hash: PackageNameHash,
        is_expired: Option<&mut bool>,
        cache_behavior: CacheBehavior,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        if cache_behavior == CacheBehavior::LoadFromMemory {
            let entry = self.hash_map.get_mut(&name_hash)?;
            return match entry {
                Value::Manifest(m) => Some(m),
                Value::Expired(m) => {
                    if let Some(expiry) = is_expired {
                        *expiry = true;
                        Some(m)
                    } else {
                        None
                    }
                }
                Value::NotFound => None,
            };
        }

        match self.hash_map.entry(name_hash) {
            Entry::Occupied(occ) => {
                let value_ptr = occ.into_mut();
                // Compute the demote decision first without holding a borrow
                // that escapes the fn.
                let demote = matches!(
                    value_ptr,
                    Value::Manifest(m)
                        if needs_extended_manifest && !m.pkg.has_extended_manifest
                );
                if demote {
                    let Value::Manifest(m) = core::mem::replace(value_ptr, Value::NotFound) else {
                        unreachable!()
                    };
                    *value_ptr = Value::Expired(m);
                } else if let Value::Manifest(m) = value_ptr {
                    return Some(m);
                }

                if let Some(expiry) = is_expired {
                    if let Value::Expired(m) = value_ptr {
                        *expiry = true;
                        return Some(m);
                    }
                }

                None
            }
            Entry::Vacant(vac) => {
                if ctx.enable_manifest_cache {
                    // `ctx.cache_directory` is `Some` iff `enable_manifest_cache`
                    // (see `manifest_disk_cache_ctx`).
                    let cache_fd = ctx.cache_directory.expect("cache_directory");
                    if let Some(manifest) = npm::package_manifest::Serializer::load_by_file_id(
                        scope, cache_fd, name_hash,
                    )
                    .ok()
                    .flatten()
                    {
                        if needs_extended_manifest && !manifest.pkg.has_extended_manifest {
                            let value_ptr = vac.insert(Value::Expired(manifest));
                            if let Some(expiry) = is_expired {
                                *expiry = true;
                                let Value::Expired(m) = value_ptr else {
                                    unreachable!()
                                };
                                return Some(m);
                            }
                            return None;
                        }

                        if ctx.enable_manifest_cache_control
                            && manifest.pkg.public_max_age
                                > ctx.timestamp_for_manifest_cache_control
                        {
                            let value_ptr = vac.insert(Value::Manifest(manifest));
                            let Value::Manifest(m) = value_ptr else {
                                unreachable!()
                            };
                            return Some(m);
                        } else {
                            let value_ptr = vac.insert(Value::Expired(manifest));

                            if let Some(expiry) = is_expired {
                                *expiry = true;
                                let Value::Expired(m) = value_ptr else {
                                    unreachable!()
                                };
                                return Some(m);
                            }

                            return None;
                        }
                    }
                }

                vac.insert(Value::NotFound);
                None
            }
        }
    }
}
