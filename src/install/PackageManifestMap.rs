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
    /// `--prefer-offline` / `--offline`: a cached manifest counts as fresh regardless of
    /// its age (stored as `Value::Manifest`), so resolution can use it without a
    /// revalidation request. A lookup that needs the extended manifest still reports a
    /// cached abbreviated one as missing (see `by_name_hash_allow_expired`): age is
    /// waived, content is not.
    pub(crate) accept_expired: bool,
}

impl PackageManifestMap {
    pub(crate) fn by_name(
        &mut self,
        ctx: DiskCacheCtx,
        scope: &npm::registry::Scope,
        name: &[u8],
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        self.by_name_hash(
            ctx,
            scope,
            name,
            StringBuilder::string_hash(name),
            needs_extended_manifest,
        )
    }

    /// Stores a manifest that was just fetched. When the same package was
    /// requested both abbreviated and extended during this install (it is a
    /// regular dependency of one package and an optional dependency of
    /// another), the extended response must win regardless of which one
    /// arrives last, otherwise the dependencies waiting for the extended one
    /// would never resolve.
    ///
    /// This only decides what this install resolves from. A fetched document
    /// is written to the disk cache by the task that parsed it, before it gets
    /// here, so when both were fetched the disk ends up with whichever save
    /// finished last; if that was the abbreviated one, the next resolve that
    /// needs the extended document fetches it again, nothing else depends on it.
    pub(crate) fn insert(
        &mut self,
        name_hash: PackageNameHash,
        manifest: npm::PackageManifest,
    ) -> Result<(), bun_alloc::AllocError> {
        if !manifest.pkg.has_extended_manifest
            && matches!(
                self.hash_map.get(&name_hash),
                Some(Value::Manifest(existing))
                    if existing.pkg.has_extended_manifest && existing.name() == manifest.name()
            )
        {
            return Ok(());
        }
        self.hash_map.insert(name_hash, Value::Manifest(manifest));
        Ok(())
    }

    pub(crate) fn by_name_hash(
        &mut self,
        ctx: DiskCacheCtx,
        scope: &npm::registry::Scope,
        name: &[u8],
        name_hash: PackageNameHash,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        self.by_name_hash_allow_expired(ctx, scope, name, name_hash, None, needs_extended_manifest)
    }

    /// `by_name_hash` without the disk fallback, so callers holding
    /// `&mut PackageManager` can borrow only `pm.manifests`.
    pub(crate) fn by_name_hash_in_memory(
        &mut self,
        name: &[u8],
        name_hash: PackageNameHash,
    ) -> Option<&mut npm::PackageManifest> {
        match self.hash_map.get_mut(&name_hash)? {
            Value::Manifest(m) if m.name() == name => Some(m),
            _ => None,
        }
    }

    pub fn by_name_allow_expired(
        &mut self,
        ctx: DiskCacheCtx,
        scope: &npm::registry::Scope,
        name: &[u8],
        is_expired: Option<&mut bool>,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        self.by_name_hash_allow_expired(
            ctx,
            scope,
            name,
            StringBuilder::string_hash(name),
            is_expired,
            needs_extended_manifest,
        )
    }

    /// The `PackageManager` scalars read on the disk-fallback arm
    /// (`options.enable.*`, the cache directory, and
    /// `timestamp_for_manifest_cache_control`) are hoisted into
    /// [`DiskCacheCtx`] so callers never hold `&mut pm.manifests` and a
    /// `PackageManager` borrow simultaneously.
    ///
    /// With `needs_extended_manifest`, an abbreviated manifest is reported as
    /// missing so the caller fetches the extended one. The entry itself is left
    /// untouched: it is still valid for the callers that don't need the
    /// extended fields, and `insert` replaces it once the extended one arrives.
    pub(crate) fn by_name_hash_allow_expired(
        &mut self,
        ctx: DiskCacheCtx,
        scope: &npm::registry::Scope,
        name: &[u8],
        name_hash: PackageNameHash,
        is_expired: Option<&mut bool>,
        needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        let usable = |m: &npm::PackageManifest| {
            m.name() == name && (!needs_extended_manifest || m.pkg.has_extended_manifest)
        };

        let value_ptr = match self.hash_map.entry(name_hash) {
            Entry::Occupied(occ) => occ.into_mut(),
            Entry::Vacant(vac) => {
                let mut loaded = None;
                if ctx.enable_manifest_cache {
                    // `ctx.cache_directory` is `Some` iff `enable_manifest_cache`
                    // (see `manifest_disk_cache_ctx`).
                    let cache_fd = ctx.cache_directory.expect("cache_directory");
                    loaded = npm::package_manifest::Serializer::load_by_file_id(
                        scope, cache_fd, name, name_hash,
                    )
                    .ok()
                    .flatten();
                }
                vac.insert(match loaded {
                    Some(manifest)
                        if ctx.accept_expired
                            || (ctx.enable_manifest_cache_control
                                && manifest.pkg.public_max_age
                                    > ctx.timestamp_for_manifest_cache_control) =>
                    {
                        Value::Manifest(manifest)
                    }
                    Some(manifest) => Value::Expired(manifest),
                    None => Value::NotFound,
                })
            }
        };

        match value_ptr {
            Value::Manifest(m) if usable(m) => Some(m),
            Value::Expired(m) if usable(m) => {
                let expiry = is_expired?;
                *expiry = true;
                Some(m)
            }
            _ => None,
        }
    }
}
