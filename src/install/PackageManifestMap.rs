use bun_collections::HashMap;
use bun_collections::hash_map::Entry;
use bun_semver::String as SemverString;

use crate::npm;
use crate::PackageManager;
use crate::PackageNameHash;

#[derive(Default)]
pub struct PackageManifestMap {
    pub hash_map: ManifestHashMap,
}

enum Value {
    Expired(npm::PackageManifest),
    Manifest(npm::PackageManifest),

    // Avoid checking the filesystem again.
    NotFound,
}

// TODO(port): Zig used `IdentityContext(PackageNameHash)` (key is already a hash) with load factor 80.
// `bun_collections::HashMap` needs an identity hasher here; Phase B should wire one.
type ManifestHashMap = HashMap<PackageNameHash, Value>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CacheBehavior {
    LoadFromMemory,
    LoadFromMemoryFallbackToDisk,
}

impl PackageManifestMap {
    pub fn by_name(
        &mut self,
        pm: &mut PackageManager,
        scope: &npm::registry::Scope,
        name: &[u8],
        cache_behavior: CacheBehavior,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        self.by_name_hash(
            pm,
            scope,
            SemverString::Builder::string_hash(name),
            cache_behavior,
            needs_extended_manifest,
        )
    }

    pub fn insert(
        &mut self,
        name_hash: PackageNameHash,
        manifest: &npm::PackageManifest,
    ) -> Result<(), bun_alloc::AllocError> {
        // TODO(port): `manifest.*` in Zig is a struct copy; verify `PackageManifest: Clone`.
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
            SemverString::Builder::string_hash(name),
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
                if let Value::Manifest(m) = value_ptr {
                    if needs_extended_manifest && !m.pkg.has_extended_manifest {
                        // PORT NOTE: reshaped for borrowck — swap variant tag while moving payload.
                        let Value::Manifest(m) = core::mem::replace(value_ptr, Value::NotFound)
                        else {
                            unreachable!()
                        };
                        *value_ptr = Value::Expired(m);
                    } else {
                        return Some(m);
                    }
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
                if pm.options.enable.manifest_cache {
                    if let Some(manifest) = npm::PackageManifest::Serializer::load_by_file_id(
                        scope,
                        pm.get_cache_directory(),
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

                        if pm.options.enable.manifest_cache_control
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
//   confidence: medium
//   todos:      2
//   notes:      getOrPut reshaped to Entry API; needs IdentityContext hasher; &mut self may alias pm (PackageManifestMap is likely a PackageManager field)
// ──────────────────────────────────────────────────────────────────────────
