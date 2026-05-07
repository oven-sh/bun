use bun_collections::HashMap;
// PORT NOTE: bun_collections::HashMap aliases std::collections::HashMap, so its
// .entry() returns the std Entry, not bun_collections::hash_map::Entry.
use std::collections::hash_map::Entry;
use bun_semver::string::Builder as StringBuilder;

use crate::npm;
use crate::PackageManager;
use crate::PackageNameHash;

#[derive(Default)]
pub struct PackageManifestMap {
    pub hash_map: ManifestHashMap,
}

pub enum Value {
    Expired(npm::PackageManifest),
    Manifest(npm::PackageManifest),

    // Avoid checking the filesystem again.
    NotFound,
}

impl Value {
    /// Zig: `entry.value_ptr.manifest` field projection on the `.manifest` arm.
    #[inline]
    pub fn manifest_mut(&mut self) -> &mut npm::PackageManifest {
        match self {
            Value::Manifest(m) => m,
            _ => unreachable!("manifest_mut on non-Manifest value"),
        }
    }

    /// Immutable counterpart of `manifest_mut`.
    #[inline]
    pub fn manifest(&self) -> &npm::PackageManifest {
        match self {
            Value::Manifest(m) => m,
            _ => unreachable!("manifest on non-Manifest value"),
        }
    }
}

// Zig used `IdentityContext(PackageNameHash)` (key is already a hash) with load factor 80.
// `bun_collections::HashMap` aliases std HashMap, which has no `BuildHasher` for
// `IdentityContext` yet — re-hashing the u64 is correctness-neutral, only a perf
// difference. Matches the precedent in `npm.rs`.
type ManifestHashMap = HashMap<PackageNameHash, Value>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CacheBehavior {
    LoadFromMemory,
    LoadFromMemoryFallbackToDisk,
}

impl PackageManifestMap {
    /// # Safety
    /// See [`by_name_hash_allow_expired`](Self::by_name_hash_allow_expired).
    pub unsafe fn by_name(
        &mut self,
        pm: *mut PackageManager,
        scope: &npm::registry::Scope,
        name: &[u8],
        cache_behavior: CacheBehavior,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        // SAFETY: forwarded to caller.
        unsafe {
            self.by_name_hash(
                pm,
                scope,
                StringBuilder::string_hash(name),
                cache_behavior,
                needs_extended_manifest,
            )
        }
    }

    pub fn insert(
        &mut self,
        name_hash: PackageNameHash,
        manifest: &npm::PackageManifest,
    ) -> Result<(), bun_alloc::AllocError> {
        // Zig: `.{ .manifest = manifest.* }` — struct copy; `PackageManifest: Clone`.
        self.hash_map
            .insert(name_hash, Value::Manifest(manifest.clone()));
        Ok(())
    }

    pub fn by_name_hash(
        &mut self,
        pm: &mut PackageManager,
        scope: &npm::registry::Scope,
        name_hash: PackageNameHash,
        cache_behavior: CacheBehavior,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        self.by_name_hash_allow_expired(
            pm,
            scope,
            name_hash,
            None,
            cache_behavior,
            needs_extended_manifest,
        )
    }

    /// Memory-only lookup — equivalent to Zig
    /// `byNameHash(this, pm, scope, hash, .load_from_memory, _)` with
    /// `is_expired = null`, but without the `pm`/`scope` parameters: the
    /// `.load_from_memory` arm never reads them. Exposed separately so callers
    /// holding `&mut PackageManager` can borrow only the disjoint
    /// `pm.manifests` field instead of constructing an aliased
    /// `(&mut pm.manifests, &mut pm)` pair.
    pub fn by_name_hash_in_memory(
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
        pm: &mut PackageManager,
        scope: &npm::registry::Scope,
        name: &[u8],
        is_expired: Option<&mut bool>,
        cache_behavior: CacheBehavior,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        self.by_name_hash_allow_expired(
            pm,
            scope,
            StringBuilder::string_hash(name),
            is_expired,
            cache_behavior,
            needs_extended_manifest,
        )
    }

    pub fn by_name_hash_allow_expired(
        &mut self,
        pm: &mut PackageManager,
        scope: &npm::registry::Scope,
        name_hash: PackageNameHash,
        is_expired: Option<&mut bool>,
        cache_behavior: CacheBehavior,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        if cache_behavior == CacheBehavior::LoadFromMemory {
            let Some(entry) = self.hash_map.get_mut(&name_hash) else {
                return None;
            };
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

        // PORT NOTE: reshaped for borrowck — Zig's `getOrPut` returns `{ found_existing, value_ptr }`;
        // Rust splits into Occupied/Vacant arms.
        match self.hash_map.entry(name_hash) {
            Entry::Occupied(occ) => {
                let value_ptr = occ.into_mut();
                // PORT NOTE: reshaped for borrowck — Zig mutated `value_ptr.*` in
                // place from `.manifest` to `.expired`. Compute the demote decision
                // first without holding a borrow that escapes the fn.
                let demote = matches!(
                    value_ptr,
                    Value::Manifest(m)
                        if needs_extended_manifest && !m.pkg.has_extended_manifest
                );
                if demote {
                    let Value::Manifest(m) = core::mem::replace(value_ptr, Value::NotFound)
                    else {
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
                if pm.options.enable.manifest_cache() {
                    if let Some(manifest) = npm::package_manifest::Serializer::load_by_file_id(
                        scope,
                        pm.get_cache_directory().fd(),
                        name_hash,
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

                        if pm.options.enable.manifest_cache_control()
                            && manifest.pkg.public_max_age
                                > pm.timestamp_for_manifest_cache_control
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManifestMap.zig (124 lines)
//   confidence: high
//   notes:      getOrPut reshaped to Entry API; callers split `&mut pm` /
//               `&mut pm.manifests` through a raw root (disjoint fields).
// ──────────────────────────────────────────────────────────────────────────
