use bun_collections::VecExt;
use core::mem;

use bun_collections::{ArrayHashMap, AutoBitSet, MultiArrayList, StringSet, index_sort};
use bun_core::strings;
use bun_core::{Global, Output};
use bun_paths::{self as path, MAX_PATH_BYTES, resolve_path};
use bun_resolver::fs::FileSystem;
use bun_semver::semver_query::Wildcard;
use bun_semver::version::VersionInt;
use bun_semver::{self as semver, ExternalString, String, Version as SemverVersion};

use crate::bun_json::{E, Expr, ExprData};
use crate::dependency::{Behavior, DependencyExt as _, TagExt as _};
use crate::lockfile_real as lockfile;
use crate::lockfile_real::{
    Cloner, DependencySlice, Lockfile, PackageIDSlice, PatchedDep, PendingResolution, Stream,
    StringBuilder, TrustedDependenciesSet,
};
use crate::resolution_real::{ResolutionType, Tag as ResolutionTag, TaggedValue};
use crate::versioned_url::VersionedURLType;
use crate::{
    self as install, Aligner, Bin, Dependency, ExternalStringList, ExternalStringMap, Features,
    Npm, PackageID, PackageManager, PackageNameHash, TruncatedPackageNameHash, UpdateRequest, bin,
    default_trusted_dependencies, dependency, initialize_store, invalid_package_id,
};

#[path = "Package/Meta.rs"]
pub mod meta;
#[path = "Package/Scripts.rs"]
pub mod scripts;
#[path = "Package/WorkspaceMap.rs"]
pub mod workspace_map;

pub use meta::Meta;
pub use scripts::Scripts;
pub use workspace_map as WorkspaceMap;

bun_output::declare_scope!(Lockfile, hidden);

trait ExprStr {
    fn as_utf8<'b>(&self, bump: &'b bun_alloc::Arena) -> Option<&'b [u8]>;
}
impl ExprStr for Expr {
    #[inline]
    fn as_utf8<'b>(&self, bump: &'b bun_alloc::Arena) -> Option<&'b [u8]> {
        if let ExprData::EString(s) = &self.data {
            return Some(s.string(bump).expect("OOM"));
        }
        None
    }
}

#[derive(Clone)]
enum JsonObjectStringRows<'a> {
    Classic(
        core::slice::Iter<'a, bun_ast::G::Property>,
        &'a bun_alloc::Arena,
    ),
    Json(core::slice::Iter<'a, E::PropertyJSON>),
}

impl<'a> JsonObjectStringRows<'a> {
    fn new(expr: &'a Expr, bump: &'a bun_alloc::Arena) -> Option<Self> {
        match &expr.data {
            ExprData::EObject(obj) => Some(Self::Classic(obj.properties.slice().iter(), bump)),
            ExprData::EObjectJSON(obj) => Some(Self::Json(obj.get().properties().iter())),
            _ => None,
        }
    }

    fn len(&self) -> usize {
        match self {
            Self::Classic(iter, _) => iter.len(),
            Self::Json(iter) => iter.len(),
        }
    }
}

impl<'a> Iterator for JsonObjectStringRows<'a> {
    type Item = (&'a [u8], Option<&'a [u8]>, bun_ast::Loc);

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Self::Classic(iter, bump) => {
                let prop = iter.next()?;
                let key = prop.key?;
                let key_bytes = key.as_utf8(*bump)?;
                Some((
                    key_bytes,
                    prop.value.as_ref().and_then(|v| v.as_utf8(*bump)),
                    key.loc,
                ))
            }
            Self::Json(iter) => {
                let row = iter.next()?;
                Some((row.key.slice(), row.value.as_str(), row.key_loc))
            }
        }
    }
}

pub(crate) fn value_loc_of(source: &bun_ast::Source, key_loc: bun_ast::Loc) -> bun_ast::Loc {
    crate::bun_json::property_value_loc(&source.contents, key_loc).unwrap_or(key_loc)
}

/// Finds `"name"` in the file on disk. The cached tree can be of an edit that is not written.
fn name_range_on_disk(source: &bun_ast::Source) -> bun_ast::Range {
    let mut log = bun_ast::Log::init();
    let Ok(json) = crate::bun_json::ParsedJson::parse_package_json(source, &mut log) else {
        return bun_ast::Range::NONE;
    };
    match json.root.as_property(b"name") {
        Some(name) => source.range_of_string(value_loc_of(source, name.loc)),
        None => bun_ast::Range::NONE,
    }
}

/// Returns the path in the form that `Version.value.folder` has in local packages, or `None` if it
/// doesn't fit in `buf`.
pub(crate) fn folder_relative_to_top_level_dir<'a>(
    pkg_dir: &[u8],
    folder: &[u8],
    buf: &'a mut [u8],
) -> Option<&'a [u8]> {
    let top_level_dir = FileSystem::instance().top_level_dir();
    let joined = resolve_path::join_abs_string_buf_checked::<path::platform::Auto>(
        top_level_dir,
        buf,
        &[pkg_dir, folder],
    )?;
    let relative = resolve_path::relative(top_level_dir, joined);
    // empty when the package depends on itself
    let relative: &[u8] = if relative.is_empty() { b"." } else { relative };
    let len = relative.len();
    buf.get_mut(..len)?.copy_from_slice(relative);
    #[cfg(windows)]
    path::dangerously_convert_path_to_posix_in_place::<u8>(&mut buf[..len]);
    Some(&buf[..len])
}

#[cold]
fn invalid_trusted_dependencies(
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    loc: bun_ast::Loc,
) -> crate::Error {
    let _ = bun_ast::add_error_pretty!(
        log,
        source,
        loc,
        "trustedDependencies expects an array of strings, e.g.\n  <r><green>\"trustedDependencies\"<r>: [\n    <green>\"package_name\"<r>\n  ]"
    );
    crate::Error::InvalidPackageJSON
}

/// Warns once per file, because a workspace that changed is parsed twice into the same log.
#[cold]
fn warn_ignored_patched_dependencies(
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    key_loc: bun_ast::Loc,
) {
    const TEXT: &[u8] =
        b"ignoring \"patchedDependencies\" in workspace package, move it to the root package.json";
    let warned = log.msgs.iter().any(|msg| {
        *msg.data.text == *TEXT
            && (msg.data.location.as_ref())
                .is_some_and(|location| *location.file == *source.path.text)
    });
    if !warned {
        log.add_range_warning(Some(source), source.range_of_string(key_loc), TEXT);
    }
}

/// A declared `trustedDependencies`, even `[]`, replaces the default list, so the set becomes
/// `Some`.
pub(crate) fn parse_append_trusted_dependencies(
    trusted_dependencies: &mut Option<TrustedDependenciesSet>,
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    json: Expr,
    bump: &bun_alloc::Arena,
) -> crate::Result<()> {
    let Some(q) = json.as_property(b"trustedDependencies") else {
        return Ok(());
    };
    let count = match &q.expr.data {
        ExprData::EArray(arr) => arr.items.len_u32() as usize,
        ExprData::EArrayJSON(arr) => arr.get().items().len(),
        _ => return Err(invalid_trusted_dependencies(log, source, q.loc)),
    };
    let trusted = trusted_dependencies.get_or_insert_with(Default::default);
    trusted.ensure_unused_capacity(count)?;
    if let Some(mut items) = q.expr.as_array() {
        while let Some(item) = items.next() {
            let Some(name) = item.as_string(bump) else {
                return Err(invalid_trusted_dependencies(log, source, q.loc));
            };
            trusted.put_assume_capacity(
                semver::string::Builder::string_hash(name) as TruncatedPackageNameHash,
                Box::<[u8]>::from(name),
            );
        }
    }
    Ok(())
}

/// Used by a migration, which may not have parsed the root package.json. Keeps what the migration
/// already recorded.
pub(crate) fn append_patched_dependencies(
    lockfile: &mut Lockfile,
    json: Expr,
    bump: &bun_alloc::Arena,
) -> Result<(), bun_alloc::AllocError> {
    let Some(q) = json.as_property(b"patchedDependencies") else {
        return Ok(());
    };
    for (key, value, _) in JsonObjectStringRows::new(&q.expr, bump)
        .into_iter()
        .flatten()
    {
        let hash = semver::string::Builder::string_hash(key);
        if let Some(value) = value.filter(|_| !lockfile.patched_dependencies.contains(&hash)) {
            let path = lockfile.string_buf().append(value)?;
            lockfile
                .patched_dependencies
                .put(hash, PatchedDep::with_path(path))?;
        }
    }
    Ok(())
}

// `SemverIntType` defaults to `u64`, the only instantiation the lockfile/PM
// call sites name unqualified.
//
// `#[derive(MultiArrayElement)]` cannot be used here — the derive
// emits a `PackageField` enum with snake_case variants and an inherent
// `__MAL_SIZES` const that fail to const-eval through the defaulted
// `SemverIntType` param. The trait impl, field enum, and `PackageColumns` /
// `PackageColumns` accessor traits are therefore expanded by hand below.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Package<SemverIntType: VersionInt = u64> {
    pub name: String,
    pub(crate) name_hash: PackageNameHash,

    /// How this package has been resolved
    /// When .tag is uninitialized, that means the package is not resolved yet.
    pub resolution: ResolutionType<SemverIntType>,

    /// dependencies & resolutions must be the same length
    /// resolutions[i] is the resolved package ID for dependencies[i]
    /// if resolutions[i] is an invalid package ID, then dependencies[i] is not resolved
    pub dependencies: DependencySlice,

    /// The resolved package IDs for this package's dependencies. Instead of storing this
    /// on the `Dependency` struct within `.dependencies`, it is stored on the package itself
    /// so we can access it faster.
    ///
    /// Each index in this array corresponds to the same index in dependencies.
    /// Each value in this array corresponds to the resolved package ID for that dependency.
    ///
    /// So this is how you say "what package ID for lodash does this package actually resolve to?"
    ///
    /// By default, the underlying buffer is filled with "invalid_id" to indicate this package ID
    /// was not resolved
    pub(crate) resolutions: PackageIDSlice,

    pub(crate) meta: Meta,
    pub bin: Bin,

    /// If any of these scripts run, they will run in order:
    /// 1. preinstall
    /// 2. install
    /// 3. postinstall
    /// 4. preprepare
    /// 5. prepare
    /// 6. postprepare
    pub(crate) scripts: Scripts,
}

pub(crate) type Resolution<SemverIntType> = ResolutionType<SemverIntType>;

// ─── ResolverContext ─────────────────────────────────────────────────────────
//
// `()` is the no-op resolver. Object-safe, so that `parse_with_json` is compiled once.
pub trait ResolverContext {
    fn is_void(&self) -> bool {
        false
    }

    fn check_bundled_dependencies(&self) -> bool {
        false
    }

    /// Counts strings to be appended by `resolve`.
    fn count(&mut self, _builder: &mut StringBuilder<'_>, _json: &Expr) {}

    /// Produces the package's `Resolution`. Only called when `!is_void()`.
    fn resolve(
        &mut self,
        builder: &mut StringBuilder<'_>,
        json: &Expr,
    ) -> crate::Result<ResolutionType<u64>>;

    /// Name to store when the package.json has no name, or has one that is not safe to use as a
    /// bun.lock `packages` key.
    fn fallback_name(&self) -> Option<Vec<u8>> {
        None
    }
}

impl ResolverContext for () {
    fn is_void(&self) -> bool {
        true
    }

    fn resolve(
        &mut self,
        _builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> crate::Result<ResolutionType<u64>> {
        Ok(ResolutionType::default())
    }
}

/// Field tags for the binary lockfile serializer (`bun.lockb`). The
/// reflection-backed `MultiArrayList` no longer needs an enum, but the
/// serializer iterates fields by tag to write column blobs in a fixed order.
#[repr(usize)]
#[derive(Copy, Clone)]
pub(crate) enum PackageField {
    Name = 0,
    NameHash = 1,
    Resolution = 2,
    Dependencies = 3,
    Resolutions = 4,
    Meta = 5,
    Bin = 6,
    Scripts = 7,
}

impl PackageField {
    const ALL: [PackageField; 8] = [
        PackageField::Name,
        PackageField::NameHash,
        PackageField::Resolution,
        PackageField::Dependencies,
        PackageField::Resolutions,
        PackageField::Meta,
        PackageField::Bin,
        PackageField::Scripts,
    ];

    pub(crate) fn name(self) -> &'static [u8] {
        match self {
            PackageField::Name => b"name",
            PackageField::NameHash => b"name_hash",
            PackageField::Resolution => b"resolution",
            PackageField::Dependencies => b"dependencies",
            PackageField::Resolutions => b"resolutions",
            PackageField::Meta => b"meta",
            PackageField::Bin => b"bin",
            PackageField::Scripts => b"scripts",
        }
    }
}

bun_collections::multi_array_columns! {
    pub trait PackageColumns [SemverIntType: VersionInt] for Package<SemverIntType> {
        name: String,
        name_hash: PackageNameHash,
        resolution: ResolutionType<SemverIntType>,
        dependencies: DependencySlice,
        resolutions: PackageIDSlice,
        meta: Meta,
        bin: Bin,
        scripts: Scripts,
    }
}

impl<SemverIntType: VersionInt> Default for Package<SemverIntType> {
    fn default() -> Self {
        Self {
            name: String::default(),
            name_hash: 0,
            resolution: Resolution::<SemverIntType>::default(),
            dependencies: DependencySlice::default(),
            resolutions: PackageIDSlice::default(),
            meta: Meta::init(),
            bin: Bin::default(),
            scripts: Scripts::default(),
        }
    }
}

pub use bun_install_types::DependencyGroup;

// Borrows into lockfile.packages SoA columns + string_bytes; `RawSlice`
// carries the outlives-holder invariant (the lockfile outlives every sort
// pass that constructs an Alphabetizer).
pub(crate) struct Alphabetizer<SemverIntType: VersionInt> {
    pub names: bun_ptr::RawSlice<String>,
    pub buf: bun_ptr::RawSlice<u8>,
    pub resolutions: bun_ptr::RawSlice<Resolution<SemverIntType>>,
}

impl<SemverIntType: VersionInt> Alphabetizer<SemverIntType> {
    pub(crate) fn order(&self, lhs: PackageID, rhs: PackageID) -> core::cmp::Ordering {
        let (names, buf, resolutions) = (
            self.names.slice(),
            self.buf.slice(),
            self.resolutions.slice(),
        );
        names[lhs as usize]
            .order(names[rhs as usize], buf, buf)
            .then_with(|| resolutions[lhs as usize].order(&resolutions[rhs as usize], buf, buf))
    }
}

// The `u32` instantiation is migration-only (`Serializer::load`).
impl Package<u64> {
    pub(crate) fn clone(&self, cloner: &mut Cloner) -> crate::Result<PackageID> {
        let old = &mut *cloner.old;
        let new = &mut *cloner.lockfile;
        let package_id_mapping = &mut *cloner.mapping;
        let old_string_buf = old.buffers.string_bytes.as_slice();
        let old_extern_string_buf = old.buffers.extern_strings.as_slice();
        let mut builder_ = crate::string_builder!(new);
        let builder = &mut builder_;
        bun_output::scoped_log!(
            Lockfile,
            "Clone: {}@{} ({:?}, {} dependencies)",
            bstr::BStr::new(self.name.slice(old_string_buf)),
            self.resolution
                .fmt(old_string_buf, bun_core::fmt::PathSep::Auto),
            self.resolution.tag,
            self.dependencies.len,
        );

        builder.count(self.name.slice(old_string_buf));
        self.resolution.count(old_string_buf, &mut *builder);
        self.meta.count(old_string_buf, &mut *builder);
        self.scripts.count(old_string_buf, &mut *builder);
        for patched_dep in old.patched_dependencies.values() {
            builder.count(patched_dep.path.slice(old.buffers.string_bytes.as_slice()));
        }
        let new_extern_string_count =
            self.bin
                .count(old_string_buf, old_extern_string_buf, &mut *builder) as usize;
        let old_dependencies: &[Dependency] =
            self.dependencies.get(old.buffers.dependencies.as_slice());
        let old_resolutions: &[PackageID] =
            self.resolutions.get(old.buffers.resolutions.as_slice());

        for dependency in old_dependencies {
            dependency.count(old_string_buf, &mut *builder);
        }

        builder.allocate()?;

        // should be unnecessary, but Just In Case
        new.buffers.dependencies.reserve(old_dependencies.len());
        new.buffers.resolutions.reserve(old_dependencies.len());
        new.buffers.extern_strings.reserve(new_extern_string_count);

        let prev_len = new.buffers.dependencies.len() as u32;
        let end = prev_len + (old_dependencies.len() as u32);
        let max_package_id = old.packages.len() as PackageID;

        // The zip-loops further below overwrite each slot with the real cloned value.
        bun_core::vec::extend_from_fn(
            &mut new.buffers.dependencies,
            old_dependencies.len(),
            |_| Dependency::default(),
        );
        bun_core::vec::extend_from_fn(&mut new.buffers.resolutions, old_dependencies.len(), |_| {
            invalid_package_id
        });
        debug_assert_eq!(new.buffers.dependencies.len(), end as usize);
        debug_assert_eq!(new.buffers.resolutions.len(), end as usize);

        let new_extern_strings_start = new.buffers.extern_strings.len();
        bun_core::vec::grow_default(&mut new.buffers.extern_strings, new_extern_string_count);

        let id = new.packages.len() as PackageID;

        let pkg_value = Package {
            name: builder.append::<String>(self.name.slice(old_string_buf)),
            bin: self.bin.clone_with_buffers(
                old_string_buf,
                old_extern_string_buf,
                new_extern_strings_start as u32,
                &mut new.buffers.extern_strings[new_extern_strings_start..],
                &mut *builder,
            ),
            name_hash: self.name_hash,
            meta: Meta::clone_into(&self.meta, id, old_string_buf, &mut *builder),
            resolution: self.resolution.clone_into(old_string_buf, &mut *builder),
            scripts: self.scripts.clone_into(old_string_buf, &mut *builder),
            dependencies: DependencySlice::new(prev_len, end - prev_len),
            resolutions: PackageIDSlice::new(prev_len, end - prev_len),
        };

        {
            let dependencies: &mut [Dependency] =
                &mut new.buffers.dependencies[prev_len as usize..end as usize];
            debug_assert_eq!(old_dependencies.len(), dependencies.len());
            for (old_dep, new_dep) in old_dependencies.iter().zip(dependencies.iter_mut()) {
                *new_dep = old_dep.clone_in(
                    &mut crate::lockfile::override_map::NoAliases,
                    old_string_buf,
                    &mut *builder,
                )?;
            }
        }

        builder.clamp();

        let new_package = new.append_package_with_id(&pkg_value, id)?;

        package_id_mapping[self.meta.id as usize] = new_package.meta.id;

        if cloner.manager.preinstall_state.len() > 0 {
            cloner.manager.preinstall_state[new_package.meta.id as usize] =
                cloner.old_preinstall_state[self.meta.id as usize];
        }

        let resolutions: &mut [PackageID] =
            &mut new.buffers.resolutions[prev_len as usize..end as usize];
        debug_assert_eq!(old_resolutions.len(), resolutions.len());
        debug_assert_eq!(old_dependencies.len(), resolutions.len());
        for (i, (old_resolution, resolution)) in
            (0u32..).zip(old_resolutions.iter().zip(resolutions.iter_mut()))
        {
            if *old_resolution >= max_package_id {
                *resolution = invalid_package_id;
                continue;
            }

            let pending = PendingResolution {
                old_resolution: *old_resolution,
                resolve_id: new_package.resolutions.off + i,
            };

            // A weak peer must not keep its target alive. It's bound in `Cloner::flush`.
            if old.is_weak_peer(self.dependencies.off + i, *old_resolution)
                && old
                    .held_at_load
                    .is_set_allow_out_of_bound(*old_resolution as usize, true)
            {
                cloner.weak_peers.push(pending);
                continue;
            }

            let mapped = package_id_mapping[*old_resolution as usize];
            if mapped < max_package_id {
                *resolution = mapped;
            } else {
                cloner.clone_queue.push(pending);
            }
        }

        Ok(new_package.meta.id)
    }

    pub(crate) fn from_npm(
        lockfile: &mut Lockfile,
        log: &mut bun_ast::Log,
        log_level: crate::LogLevel,
        manifest: &Npm::PackageManifest,
        version: SemverVersion,
        package_version_ptr: &Npm::PackageVersion,
        features: Features,
    ) -> crate::Result<Self> {
        #[allow(non_snake_case)]
        let FEATURES = features;
        let mut package = Self::default();

        let package_version = *package_version_ptr;

        let dependency_groups: &[DependencyGroup] = &{
            let mut out: Vec<DependencyGroup> = Vec::with_capacity(4);
            if FEATURES.dependencies {
                out.push(DependencyGroup::DEPENDENCIES);
            }
            if FEATURES.dev_dependencies {
                out.push(DependencyGroup::DEV);
            }
            if FEATURES.optional_dependencies {
                out.push(DependencyGroup::OPTIONAL);
            }
            if FEATURES.peer_dependencies {
                out.push(DependencyGroup::PEER);
            }
            out
        };

        let mut string_builder = crate::string_builder!(lockfile);

        let mut total_dependencies_count: u32 = 0;
        let bin_extern_strings_count: u32;

        // --- Counting
        {
            string_builder.count(manifest.name());
            version.count(&manifest.string_buf, &mut string_builder);

            for group in dependency_groups {
                let map: ExternalStringMap = package_version.dep_group(group.field);
                let keys = map.name.get(&manifest.external_strings);
                let version_strings = map.value.get(&manifest.external_strings_for_versions);
                total_dependencies_count += map.value.len;

                debug_assert_eq!(keys.len(), version_strings.len());
                for (key, ver) in keys.iter().zip(version_strings.iter()) {
                    string_builder.count(key.slice(&manifest.string_buf));
                    string_builder.count(ver.slice(&manifest.string_buf));
                }
            }

            bin_extern_strings_count = package_version.bin.count(
                &manifest.string_buf,
                &manifest.extern_strings_bin_entries,
                &mut string_builder,
            );
        }

        string_builder.count(manifest.str(&package_version_ptr.tarball_url));

        string_builder.allocate()?;
        let extern_strings_list = &mut lockfile.buffers.extern_strings;
        let dependencies_list = &mut lockfile.buffers.dependencies;
        let resolutions_list = &mut lockfile.buffers.resolutions;
        dependencies_list.reserve(total_dependencies_count as usize);
        resolutions_list.reserve(total_dependencies_count as usize);
        let extern_old_len = extern_strings_list.len();
        let extern_strings_slice =
            bun_core::vec::grow_default(extern_strings_list, bin_extern_strings_count as usize);

        // -- Cloning
        {
            let package_name: ExternalString =
                string_builder.append::<ExternalString>(manifest.name());
            package.name_hash = package_name.hash;
            package.name = package_name.value;
            package.resolution =
                Resolution::<u64>::init(TaggedValue::Npm(VersionedURLType::<u64> {
                    version: version.append(&manifest.string_buf, &mut string_builder),
                    url: string_builder
                        .append::<String>(manifest.str(&package_version_ptr.tarball_url)),
                }));

            let total_len = dependencies_list.len() + total_dependencies_count as usize;
            debug_assert!(dependencies_list.len() == resolutions_list.len());

            let dep_start = dependencies_list.len();
            bun_core::vec::extend_from_fn(
                dependencies_list,
                total_dependencies_count as usize,
                |_| Dependency::default(),
            );
            debug_assert_eq!(dependencies_list.len(), total_len);
            let dependencies = &mut dependencies_list[dep_start..total_len];

            total_dependencies_count = 0;
            for group in dependency_groups {
                let map: ExternalStringMap = package_version.dep_group(group.field);
                let keys = map.name.get(&manifest.external_strings);
                let version_strings = map.value.get(&manifest.external_strings_for_versions);

                let is_peer = group.field == b"peer_dependencies";

                debug_assert_eq!(keys.len(), version_strings.len());
                'list: for (i, (key, version_string_)) in
                    keys.iter().zip(version_strings.iter()).enumerate()
                {
                    // The problem is in another package's manifest, so it isn't reported as this
                    // project's error.
                    let declared = version_string_.slice(&manifest.string_buf);
                    if key.slice(&manifest.string_buf).is_empty()
                        || dependency::nameless_npm_alias(declared).is_some()
                    {
                        if log_level.is_verbose() {
                            log.add_warning_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "skipping unnamed dependency of {}@{} (\"{}\" in \"{}\")",
                                    bun_core::fmt::escape_control_chars(manifest.name()),
                                    version.fmt(&manifest.string_buf),
                                    bun_core::fmt::escape_control_chars(declared),
                                    bstr::BStr::new(group.prop),
                                ),
                            );
                        }
                        continue 'list;
                    }

                    // Duplicate peer & dev dependencies are promoted to whichever appeared first
                    // In practice, npm validates this so it shouldn't happen
                    let mut duplicate_at: Option<usize> = None;
                    if group.behavior.is_peer()
                        || group.behavior.is_dev()
                        || group.behavior.is_optional()
                    {
                        for (j, dependency) in dependencies[0..total_dependencies_count as usize]
                            .iter()
                            .enumerate()
                        {
                            if dependency.name_hash == key.hash {
                                if group.behavior.is_optional() {
                                    duplicate_at = Some(j);
                                    break;
                                }

                                continue 'list;
                            }
                        }
                    }

                    let name: ExternalString =
                        string_builder.append::<ExternalString>(key.slice(&manifest.string_buf));
                    let dep_version = string_builder
                        .append::<String>(version_string_.slice(&manifest.string_buf));
                    let sliced = dep_version.sliced(string_builder.string_bytes.as_slice());

                    let mut behavior = group.behavior;
                    if is_peer {
                        // The running runtime is the `bun` a package asks for.
                        behavior.set(
                            Behavior::OPTIONAL,
                            (i as u32) < package_version.non_optional_peer_dependencies_start
                                || key.slice(&manifest.string_buf) == b"bun",
                        );
                    }
                    if package_version_ptr.all_dependencies_bundled()
                        || (package_version.bundled_dependencies)
                            .get(&manifest.bundled_deps_buf)
                            .contains(&name.hash)
                    {
                        behavior.insert(Behavior::BUNDLED);
                    }

                    let mut dependency = Dependency {
                        name: name.value,
                        name_hash: name.hash,
                        behavior,
                        version: Dependency::parse(
                            name.value,
                            Some(name.hash),
                            sliced.slice,
                            &sliced,
                            Some(&mut *log),
                            // An `npm:` alias in a registry manifest applies to this dependency
                            // only, so it is not registered as one of the project's aliases.
                            None,
                        )
                        .unwrap_or_default(),
                    };
                    lockfile::CatalogMap::strip_reference(&mut dependency);

                    // If a dependency appears in both "dependencies" and "optionalDependencies", it is considered optional!
                    if group.behavior.is_optional() {
                        if let Some(j) = duplicate_at {
                            // need to shift dependencies after the duplicate to maintain sort order
                            // (in-place left-rotate by 1 over `[j .. total_dependencies_count)`)
                            dependencies[j..total_dependencies_count as usize].rotate_left(1);

                            // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies
                            // > Entries in optionalDependencies will override entries of the same name in dependencies, so it's usually best to only put in one place.
                            dependencies[total_dependencies_count as usize - 1] = dependency;
                            continue 'list;
                        }
                    }

                    dependencies[total_dependencies_count as usize] = dependency;
                    total_dependencies_count += 1;
                }
            }

            package.bin = package_version.bin.clone_with_buffers(
                &manifest.string_buf,
                &manifest.extern_strings_bin_entries,
                extern_old_len as u32,
                extern_strings_slice,
                &mut string_builder,
            );

            package.meta.arch = package_version.cpu;
            package.meta.os = package_version.os;
            package.meta.libc = package_version.libc;
            package.meta.integrity = package_version.integrity;
            package
                .meta
                .set_has_install_script(package_version.has_install_script);

            package.dependencies.off = dep_start as u32;
            package.dependencies.len = total_dependencies_count;
            package.resolutions.off = package.dependencies.off;
            package.resolutions.len = package.dependencies.len;

            let new_length = package.dependencies.len as usize + dep_start;

            debug_assert_eq!(resolutions_list.len(), dep_start);
            bun_core::vec::extend_from_fn(
                resolutions_list,
                package.dependencies.len as usize,
                |_| invalid_package_id,
            );
            debug_assert_eq!(resolutions_list.len(), new_length);

            // Shrink off the unused default-initialized tail (`new_length <= total_len`).
            dependencies_list.truncate(new_length);

            string_builder.clamp();
            return Ok(package);
        }
    }
}

// ─── Diff ────────────────────────────────────────────────────────────────────

pub(crate) struct Diff;

/// A dependency that was removed from a package.json: `owner` no longer depends on `name`, which
/// had resolved to `package`. All three fields refer to the lockfile as it was loaded.
pub(crate) struct DroppedRow {
    pub(crate) owner: PackageID,
    pub(crate) name: String,
    pub(crate) package: PackageID,
}

/// A dependency that differs between package.json and the lockfile.
pub(crate) struct ChangedDependency {
    name: Box<[u8]>,
    /// Path of the workspace whose package.json changed. Empty for the root.
    workspace: Box<[u8]>,
    change: DependencyChange,
}

enum DependencyChange {
    Added,
    Removed,
    /// Moved to a different group, e.g. from `dependencies` to `devDependencies`.
    MovedGroup,
    /// Became an optional peer, or stopped being one.
    PeerMeta,
    Range {
        now: Box<[u8]>,
        before: Box<[u8]>,
    },
}

impl core::fmt::Display for ChangedDependency {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        use bun_core::fmt::escape_control_chars as text;
        write!(f, "{}", text(&self.name))?;
        match &self.change {
            DependencyChange::Added => f.write_str(" was added")?,
            DependencyChange::Removed => f.write_str(" was removed")?,
            DependencyChange::MovedGroup => f.write_str(" is in different dependency groups")?,
            DependencyChange::PeerMeta => f.write_str(" changed in peerDependenciesMeta")?,
            DependencyChange::Range { now, before } => {
                write!(f, " changed from {} to {}", text(before), text(now))?;
            }
        }
        if !self.workspace.is_empty() {
            write!(f, " in {}", text(&self.workspace))?;
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct DiffSummary {
    pub(crate) add: u32,
    pub(crate) remove: u32,
    /// The first changed dependency, shown in the `--frozen-lockfile` error. Only set for frozen
    /// installs.
    pub(crate) first_change: Option<ChangedDependency>,
    /// The dependencies removed from the package.json of the root and of each workspace.
    pub(crate) dropped_rows: Vec<DroppedRow>,
    pub(crate) update: u32,
    /// How many of the changes counted in `update` leave every dependency unchanged.
    pub(crate) script_only_updates: u32,
    pub(crate) overrides_changed: bool,
    /// The sorted names with a rule in bun.lock or package.json, if `overrides_changed`.
    pub(crate) overridden_names: Vec<PackageNameHash>,
    pub(crate) catalogs_changed: bool,
    /// Set after the differ, by `Lockfile::reconcile_package_extensions`.
    pub(crate) package_extensions_changed: bool,
    /// Also set by `Lockfile::reconcile_package_extensions`: the dependencies that no
    /// `packageExtensions` rule adds anymore, as `(Lockfile::package_extension_key, name hash)`.
    pub(crate) removed_extension_rows: Vec<(u64, PackageNameHash)>,

    /// Packages that are trusted now but weren't when the lockfile was saved. If one is already
    /// installed, its blocked scripts run.
    pub(crate) added_trusted_dependencies: TrustedDependenciesSet,
    pub(crate) removed_trusted_dependencies: bool,

    pub(crate) patched_dependencies_changed: bool,
    /// A workspace's `version` changed. No edge changed with it (those count as updates), but the
    /// lockfile records the version, so it is rewritten.
    pub(crate) workspace_versions_changed: bool,

    pub(crate) pruned_workspaces: Vec<PackageNameHash>,
    /// Indexes, in the new root's dependencies, of the workspaces that a lockfile from Bun 1.4 or
    /// older has no entry for, because the root also depends on a registry version of that package.
    pub(crate) members_left_out: Vec<u32>,
    /// Indexes, in the old root's dependencies, of the entries that Bun 1.4 and older kept next to
    /// the optional dependency of the same name. They stay until the dependencies change.
    pub(crate) second_entries: Vec<u32>,
}

impl DiffSummary {
    /// `buf` is the string buffer of the lockfile that `owner` belongs to.
    fn record_first_change(
        &mut self,
        owner: &Package,
        buf: &[u8],
        name: &[u8],
        change: DependencyChange,
    ) {
        if self.first_change.is_some() {
            return;
        }
        let workspace: &[u8] = match owner.resolution.tag {
            ResolutionTag::Workspace => owner.resolution.workspace().slice(buf),
            _ => b"",
        };
        self.first_change = Some(ChangedDependency {
            name: name.into(),
            workspace: workspace.into(),
            change,
        });
    }

    #[inline]
    pub(crate) fn changes_resolutions(&self) -> bool {
        self.add > 0
            || self.remove > 0
            || self.update > 0
            || self.overrides_changed
            || self.catalogs_changed
            || self.package_extensions_changed
    }

    #[inline]
    pub(crate) fn has_diffs(&self) -> bool {
        self.changes_resolutions()
            || self.added_trusted_dependencies.count() > 0
            || self.removed_trusted_dependencies
            || self.patched_dependencies_changed
            || self.workspace_versions_changed
    }

    #[inline]
    pub(crate) fn changes_dependencies(&self) -> bool {
        self.add > 0
            || self.remove > 0
            || self.overrides_changed
            || self.catalogs_changed
            || self.package_extensions_changed
            || self.update > self.script_only_updates
    }
}

impl Diff {
    pub(crate) fn generate(
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        from_lockfile: &mut Lockfile,
        to_lockfile: &mut Lockfile,
        from: &Package,
        to: &Package,
        update_requests: Option<&[UpdateRequest]>,
        id_mapping: Option<&mut [PackageID]>,
    ) -> crate::Result<DiffSummary> {
        let mut removed_names: Vec<PackageNameHash> = Vec::new();
        Self::generate_inner(
            pm,
            log,
            from_lockfile,
            to_lockfile,
            from,
            to,
            update_requests,
            id_mapping,
            &mut removed_names,
        )
    }

    // The root summary's `remove` is the count of distinct names removed across root + workspaces.
    fn generate_inner(
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        from_lockfile: &mut Lockfile,
        to_lockfile: &mut Lockfile,
        from: &Package,
        to: &Package,
        update_requests: Option<&[UpdateRequest]>,
        mut id_mapping: Option<&mut [PackageID]>,
        removed_names: &mut Vec<PackageNameHash>,
    ) -> crate::Result<DiffSummary> {
        let mut summary = DiffSummary::default();
        let is_root = id_mapping.is_some();
        let frozen = pm.options.enable.frozen_lockfile();
        let keeps_missing_workspaces = lockfile::pruned_workspaces::keeps_missing_workspaces(pm);
        macro_rules! from_buf {
            () => {
                from_lockfile.buffers.string_bytes.as_slice()
            };
        }
        macro_rules! to_buf {
            () => {
                to_lockfile.buffers.string_bytes.as_slice()
            };
        }
        let named_update_here = pm.update_requests.is_empty()
            || crate::update_scope::UpdateScope::of(&*pm).contains_workspace(
                from.resolution.tag == ResolutionTag::Root,
                from.name_hash,
                from.name.slice(from_buf!()),
            );
        // Re-derived after each package.json parse, which may grow `to_lockfile`'s dependencies.
        let mut to_deps: bun_ptr::RawSlice<Dependency> = to
            .dependencies
            .get(to_lockfile.buffers.dependencies.as_slice())
            .into();
        macro_rules! to_deps {
            () => {
                to_deps.slice()
            };
        }
        let from_deps: bun_ptr::RawSlice<Dependency> = from
            .dependencies
            .get(from_lockfile.buffers.dependencies.as_slice())
            .into();
        let from_resolutions: bun_ptr::RawSlice<PackageID> = from
            .resolutions
            .get(from_lockfile.buffers.resolutions.as_slice())
            .into();
        let (from_deps, from_resolutions) = (from_deps.slice(), from_resolutions.slice());
        let mut to_i: usize = 0;

        if lockfile::OverrideMap::changed(
            &mut from_lockfile.overrides,
            from_lockfile.buffers.string_bytes.as_slice(),
            &mut to_lockfile.overrides,
            to_lockfile.buffers.string_bytes.as_slice(),
        ) {
            summary.overrides_changed = true;

            if PackageManager::verbose_install() {
                bun_core::pretty_errorln!("Overrides changed since last install");
            }
        }

        let mut catalog_entries_skipped: Vec<Box<[u8]>> = Vec::new();
        if is_root {
            // `None` means a catalog has a different number of entries on each side.
            let same_catalogs: Option<bool> = 'catalogs: {
                // don't sort if lengths are different
                if from_lockfile.catalogs.default.count() != to_lockfile.catalogs.default.count()
                    || from_lockfile.catalogs.groups.count() != to_lockfile.catalogs.groups.count()
                {
                    break 'catalogs None;
                }

                lockfile::CatalogMap::sort(&mut from_lockfile.catalogs, &from_lockfile.buffers);
                lockfile::CatalogMap::sort(&mut to_lockfile.catalogs, &to_lockfile.buffers);

                type Catalog = lockfile::catalog_map::Map;
                let same_entries = |from: &Catalog, to: &Catalog| {
                    (from.iter().zip(to.iter())).all(
                        |((from_name, from_dep), (to_name, to_dep))| {
                            String::eql(*from_name, *to_name, from_buf!(), to_buf!())
                                && Dependency::eql(from_dep, to_dep, from_buf!(), to_buf!())
                        },
                    )
                };
                if !same_entries(
                    &from_lockfile.catalogs.default,
                    &to_lockfile.catalogs.default,
                ) {
                    break 'catalogs Some(false);
                }
                for ((from_name, from_catalog), (to_name, to_catalog)) in
                    (from_lockfile.catalogs.groups.iter()).zip(to_lockfile.catalogs.groups.iter())
                {
                    if !String::eql(*from_name, *to_name, from_buf!(), to_buf!()) {
                        break 'catalogs Some(false);
                    }
                    if from_catalog.count() != to_catalog.count() {
                        break 'catalogs None;
                    }
                    if !same_entries(from_catalog, to_catalog) {
                        break 'catalogs Some(false);
                    }
                }
                Some(true)
            };
            match same_catalogs {
                Some(same) => summary.catalogs_changed = !same,
                None => match frozen
                    .then(|| {
                        lockfile::pruned_workspaces::catalog_entries_missing_from_lockfile(
                            &*from_lockfile,
                            &*to_lockfile,
                        )
                    })
                    .flatten()
                {
                    Some(skipped) => catalog_entries_skipped = skipped,
                    None => summary.catalogs_changed = true,
                },
            }
        }

        summary.patched_dependencies_changed = from_lockfile.patched_dependencies.count()
            != to_lockfile.patched_dependencies.count()
            || (to_lockfile.patched_dependencies.iter()).any(|(key, to)| {
                (from_lockfile.patched_dependencies.get(key))
                    .is_none_or(|from| from.path.slice(from_buf!()) != to.path.slice(to_buf!()))
            });

        if is_root {
            // Compared as bun.lock prints them (`Version::eql` ignores build metadata, and an
            // empty pre-release or build is not printed), so one rewrite settles the file.
            summary.workspace_versions_changed = from_lockfile.workspace_versions.count()
                != to_lockfile.workspace_versions.count()
                || (to_lockfile.workspace_versions.iter()).any(|(name_hash, to)| {
                    (from_lockfile.workspace_versions.get(name_hash)).is_none_or(|from| {
                        from.major != to.major
                            || from.minor != to.minor
                            || from.patch != to.patch
                            || from.tag.pre.slice(from_buf!()) != to.tag.pre.slice(to_buf!())
                            || from.tag.build.slice(from_buf!()) != to.tag.build.slice(to_buf!())
                    })
                });
        }

        let mut missing_workspaces: Vec<PackageID> = Vec::new();
        let mut survivors: Vec<lockfile::pruned_workspaces::Survivor> = Vec::new();
        // Two `from` rows can pair with one `to` row, so the lengths do not give the added count.
        let mut paired = AutoBitSet::init_empty(to_deps!().len())?;
        for (i, from_dep) in from_deps.iter().enumerate() {
            // Usually it's at the same position or at a constant offset. The O(n^2) case is when it
            // comes earlier.
            let found = (to_i..to_deps!().len()).chain(0..to_i).find(|&to_i| {
                let to_dep = &to_deps!()[to_i];
                from_dep.name_hash == to_dep.name_hash
                    && from_dep.behavior.difference(Behavior::BUNDLED) == to_dep.behavior
            });

            let Some(cur_to_i) = found else {
                // A name in `optionalDependencies` and in another group is one optional dependency,
                // and a peer that `peerDependenciesMeta` makes optional is one optional peer. Bun 1.4
                // and older kept both if the name is a workspace's.
                let is_optional_twin = |dep: &Dependency| {
                    dep.name_hash == from_dep.name_hash
                        && dep.behavior.contains(Behavior::OPTIONAL)
                        && dep.behavior.is_peer() == from_dep.behavior.is_peer()
                };
                if is_root
                    && to_lockfile.workspace_paths.contains(&from_dep.name_hash)
                    && !from_dep.behavior.is_workspace()
                    && from_deps.iter().any(is_optional_twin)
                    && to_deps!().iter().any(is_optional_twin)
                    && Self::is_still_in_root_manifest(pm, log, from_dep, from_buf!())
                {
                    summary.second_entries.push(i as u32);
                    continue;
                }
                if is_root
                    && from_dep.behavior.is_workspace()
                    && lockfile::pruned_workspaces::workspace_is_missing_on_disk(
                        &*from_lockfile,
                        from_dep.name_hash,
                    )
                {
                    if (from_resolutions[i] as usize) < from_lockfile.packages.len() {
                        missing_workspaces.push(from_resolutions[i]);
                    }
                    if keeps_missing_workspaces
                        && !summary.overrides_changed
                        && !summary.catalogs_changed
                    {
                        summary.pruned_workspaces.push(from_dep.name_hash);
                        continue;
                    }
                }
                summary.remove += 1;
                if !removed_names.contains(&from_dep.name_hash) {
                    removed_names.push(from_dep.name_hash);
                }
                let is_still_listed = to_deps!().iter().any(|to_dep| {
                    to_dep.name_hash == from_dep.name_hash && !to_dep.behavior.is_workspace()
                });
                if frozen && !from_dep.behavior.is_workspace() {
                    let is_still_peer = from_dep.behavior.is_peer()
                        && to_deps!().iter().any(|to_dep| {
                            to_dep.name_hash == from_dep.name_hash && to_dep.behavior.is_peer()
                        });
                    let change = match (is_still_listed, is_still_peer) {
                        (_, true) => DependencyChange::PeerMeta,
                        (true, false) => DependencyChange::MovedGroup,
                        (false, false) => DependencyChange::Removed,
                    };
                    let name = from_dep.name.slice(from_buf!());
                    summary.record_first_change(from, from_buf!(), name, change);
                }
                // The root's implicit dependency on a workspace listed in "workspaces" is skipped:
                // the isolated linker creates no link for it, so there is none to remove.
                if !from_dep.behavior.is_workspace() && !is_still_listed {
                    summary.dropped_rows.push(DroppedRow {
                        owner: from.meta.id,
                        name: from_dep.name,
                        package: from_resolutions[i],
                    });
                }
                continue;
            };
            to_i = cur_to_i + 1;
            paired.set(cur_to_i);

            if is_root
                && from_dep.version.tag != to_deps!()[cur_to_i].version.tag
                // A workspace that the lockfile doesn't have may be new, and `bun install` links it.
                // Next to a published version, a frozen install leaves it out either way.
                && (from_dep.version.tag == dependency::version::Tag::Workspace
                    || from_lockfile.workspace_paths.contains(&from_dep.name_hash)
                    || (frozen
                        && to_deps!().iter().any(|own| {
                            own.name_hash == from_dep.name_hash
                                && Self::is_published_version_of(own, to_buf!(), own.name_hash)
                        })))
            {
                let row = to.dependencies.off as usize + cur_to_i;
                Self::keep_older_link(from_lockfile, from_dep, to_lockfile, row);
                to_deps = to
                    .dependencies
                    .get(to_lockfile.buffers.dependencies.as_slice())
                    .into();
            }
            let to_version = &to_deps!()[cur_to_i].version;
            let same = Dependency::eql(&to_deps!()[cur_to_i], from_dep, to_buf!(), from_buf!());
            // Bun 1.4 and older wrote an optional peer with a workspace's name twice. In bun.lockb, the
            // one that has the range is not optional.
            if !same
                && is_root
                && to_lockfile.workspace_paths.contains(&from_dep.name_hash)
                && from_deps.iter().any(|twin| {
                    twin.behavior.difference(Behavior::OPTIONAL)
                        == from_dep.behavior.difference(Behavior::OPTIONAL)
                        && Dependency::eql(&to_deps!()[cur_to_i], twin, to_buf!(), from_buf!())
                })
            {
                continue;
            }
            // A migration writes `file:x` for `file:./x`.
            let same_folder = !same
                && from_dep.version.tag == dependency::version::Tag::Folder
                && to_version.tag == dependency::version::Tag::Folder
                && (to_version.folder()).eql(*from_dep.version.folder(), to_buf!(), from_buf!());
            // The lockfile records the literal, so this is an update that keeps its package.
            let retyped = same
                && !from_dep.behavior.is_workspace()
                && !(to_version.literal).eql(from_dep.version.literal, to_buf!(), from_buf!());
            // Parsing package.json links a dependency to a workspace whenever its range matches.
            // The lockfile can differ for a peer or an overridden name, which is not a change.
            let range_link = !same
                && to_version.tag == dependency::version::Tag::Workspace
                && (from_dep.behavior.is_peer()
                    || to_lockfile.overrides.has_rule_for_name(from_dep.name_hash))
                && (to_version.literal).eql(from_dep.version.literal, to_buf!(), from_buf!());
            let is_explicit_update_target = update_requests.is_some_and(|updates| {
                updates.is_empty()
                    || (named_update_here
                        && pm.is_update_request(
                            from_dep.name_hash,
                            from_dep.name.slice(from_buf!()),
                        ))
            });
            if (same || same_folder) && !retyped {
                if is_explicit_update_target
                    || (from_dep.version.tag == dependency::version::Tag::Tarball
                        && pm.repins_tarball(from_dep, from_buf!(), named_update_here))
                    || Self::locked_version_is_out_of_range(
                        from_lockfile,
                        from_resolutions[i],
                        to_lockfile,
                        to_deps!(),
                        cur_to_i,
                    )
                    // Bun 1.4 and older could leave out the packages that a workspace depends on.
                    // These are the rows that `verify_resolutions` fails the install for.
                    || (!frozen
                        && from.resolution.tag == ResolutionTag::Workspace
                        && from_resolutions[i] as usize >= from_lockfile.packages.len()
                        && !lockfile::bun_lock::may_stay_unresolved(from_dep)
                        && (from_dep.behavior)
                            .is_enabled(pm.options.dependency_features(from.resolution.tag)))
                {
                    summary.update += 1;
                    continue;
                }

                let mut folder_diff = None;
                if matches!(
                    from.resolution.tag,
                    ResolutionTag::Root | ResolutionTag::Workspace
                ) && (from_lockfile.packages.items_resolution())
                    .get(from_resolutions[i] as usize)
                    .is_some_and(|locked| locked.tag == ResolutionTag::Folder)
                {
                    let mut not_counted: Vec<PackageNameHash> = Vec::new();
                    folder_diff = Self::generate_folder(
                        pm,
                        log,
                        from_lockfile,
                        to_lockfile,
                        from_resolutions[i],
                        if frozen {
                            &mut not_counted
                        } else {
                            &mut *removed_names
                        },
                    )?;
                    to_deps = to
                        .dependencies
                        .get(to_lockfile.buffers.dependencies.as_slice())
                        .into();
                    // Older versions never updated these, so a frozen install accepts what's
                    // locked.
                    if frozen
                        && (folder_diff.take()).is_some_and(|diff| diff.changes_dependencies())
                    {
                        Self::warn_folder_is_out_of_date(log, from_lockfile, from_resolutions[i]);
                    }
                }

                let mut workspace_hooks_only = false;
                let update_mapping = 'update_mapping: {
                    if let Some(diff) = &folder_diff {
                        workspace_hooks_only = !diff.changes_dependencies();
                        break 'update_mapping !diff.changes_resolutions();
                    }

                    if !is_root || !from_dep.behavior.is_workspace() {
                        break 'update_mapping true;
                    }

                    let Some(workspace_path) = to_lockfile
                        .workspace_paths
                        .get(&from_dep.name_hash)
                        .copied()
                    else {
                        break 'update_mapping false;
                    };

                    let Some(package_json_path) = lockfile::join_top_level_dir(&[
                        workspace_path.slice(to_buf!()),
                        b"package.json",
                    ]) else {
                        break 'update_mapping false;
                    };

                    let mut workspace_pkg = Package::default();

                    // `parse_with_json` does not touch the storage of the map `source` lives in.
                    let (source_ref, json_root): (bun_ptr::ParentRef<bun_ast::Source>, Expr) =
                        match pm
                            .workspace_package_json_cache
                            .get_with_path(&mut *log, package_json_path.slice(), Default::default())
                            .unwrap()
                        {
                            Ok(entry) => (bun_ptr::ParentRef::new(&entry.source), entry.root),
                            Err(_) => break 'update_mapping false,
                        };
                    workspace_pkg.parse_with_json(
                        to_lockfile,
                        pm,
                        log,
                        source_ref.get(),
                        json_root,
                        &mut (),
                        Features::WORKSPACE,
                    )?;

                    let from_pkg = from_lockfile.packages.get(from_resolutions[i] as usize);
                    survivors.push(lockfile::pruned_workspaces::Survivor {
                        name: workspace_pkg.name,
                        dependencies: workspace_pkg.dependencies,
                        recorded: from_pkg.dependencies,
                    });

                    let mut diff = Self::generate_inner(
                        pm,
                        log,
                        from_lockfile,
                        to_lockfile,
                        &from_pkg,
                        &workspace_pkg,
                        update_requests,
                        None,
                        removed_names,
                    )?;
                    summary.dropped_rows.append(&mut diff.dropped_rows);
                    if summary.first_change.is_none() {
                        summary.first_change = diff.first_change.take();
                    }
                    // Both calls may have grown `to_lockfile.buffers.dependencies`.
                    to_deps = to
                        .dependencies
                        .get(to_lockfile.buffers.dependencies.as_slice())
                        .into();

                    if pm.options.log_level.is_verbose()
                        && (diff.add + diff.remove + diff.update) > 0
                    {
                        bun_core::pretty_errorln!(
                            "Workspace package \"{}\" has added <green>{}<r> dependencies, removed <red>{}<r> dependencies, and updated <cyan>{}<r> dependencies",
                            bstr::BStr::new(workspace_path.slice(to_buf!())),
                            diff.add,
                            diff.remove,
                            diff.update,
                        );
                    }

                    workspace_hooks_only = !diff.changes_dependencies();
                    // bun.lock records no scripts, and an unchanged member is not read again.
                    if !diff.changes_resolutions()
                        && !from_pkg.scripts.filled
                        && workspace_pkg.scripts.has_any()
                    {
                        let mut builder = from_lockfile.string_builder();
                        workspace_pkg.scripts.count(to_buf!(), &mut builder);
                        builder.allocate()?;
                        let scripts = workspace_pkg.scripts.clone_into(to_buf!(), &mut builder);
                        builder.clamp();
                        let member = from_resolutions[i] as usize;
                        from_lockfile.packages.items_scripts_mut()[member] = scripts;
                        from_lockfile.packages.items_meta_mut()[member]
                            .set_has_install_script(true);
                    }
                    !diff.changes_resolutions()
                };

                if update_mapping {
                    if let Some(mapping) = id_mapping.as_deref_mut() {
                        mapping[cur_to_i] = i as PackageID;
                    }
                    continue;
                }
                if workspace_hooks_only {
                    summary.script_only_updates += 1;
                }
            }

            // An older bun's pnpm migration recorded the catalog's range in place of `catalog:`.
            if frozen
                && to_deps!()[cur_to_i].version.tag == dependency::version::Tag::Catalog
                && (to_lockfile.catalogs)
                    .resolve_range(to_buf!(), &to_deps!()[cur_to_i])
                    .literal
                    .eql(from_dep.version.literal, to_buf!(), from_buf!())
            {
                if let Some(mapping) = id_mapping.as_deref_mut() {
                    mapping[cur_to_i] = i as PackageID;
                }
                continue;
            }

            // Still counted as an update so `had_any_diffs` triggers the rebuild path.
            let still_satisfied = || {
                Self::locked_version_satisfies(
                    from_lockfile,
                    from_resolutions[i],
                    &to_deps!()[cur_to_i],
                    to_buf!(),
                )
            };
            if !is_explicit_update_target
                && let Some(mapping) = id_mapping.as_deref_mut()
                && (retyped || still_satisfied())
            {
                mapping[cur_to_i] = i as PackageID;
            }
            summary.update += 1;
            // Up to Bun 1.1, `bun add` left its request (`""`, a tag) in the lockfile.
            let recorded_request = (from_dep.version.tag == dependency::version::Tag::DistTag
                || from_dep.version.literal.is_empty())
                && still_satisfied();
            let is_equivalent = retyped || recorded_request || range_link;
            summary.script_only_updates += is_equivalent as u32;
            if frozen && !is_equivalent && !from_dep.behavior.is_workspace() {
                let change = DependencyChange::Range {
                    now: (to_deps!()[cur_to_i].version.literal.slice(to_buf!())).into(),
                    before: from_dep.version.literal.slice(from_buf!()).into(),
                };
                let name = from_dep.name.slice(from_buf!());
                summary.record_first_change(from, from_buf!(), name, change);
            }
        }

        if is_root {
            let second_entries = &summary.second_entries;
            summary.members_left_out = (to_deps!().iter().enumerate())
                .filter(|(to_i, member)| {
                    // Bun 1.4 and older replaced the root's entry for a workspace with the root's
                    // own dependency on that package if the workspace did not satisfy its range, or
                    // if the dependency was in two groups. bun.lockb still has the workspace's path.
                    member.behavior.is_workspace()
                        && !paired.is_set(*to_i)
                        && to_lockfile.workspace_versions.contains(&member.name_hash)
                        && (from_lockfile.workspace_paths.contains(&member.name_hash)
                            || (to_deps!().iter().enumerate()).any(|(own_i, own)| {
                                // bun.lock looks the same if the workspace is new. Next to an
                                // alias, `bun install` adds it either way.
                                (frozen || own.name_hash == member.name_hash)
                                    && paired.is_set(own_i)
                                    && Self::is_published_version_of(
                                        own,
                                        to_buf!(),
                                        member.name_hash,
                                    )
                            })
                            || second_entries.iter().any(|&own| {
                                Self::is_published_version_of(
                                    &from_deps[own as usize],
                                    from_buf!(),
                                    member.name_hash,
                                )
                            }))
                })
                .map(|(to_i, _)| to_i as u32)
                .collect();
        }
        // An older bun.lock doesn't have the `*` optional peer for a name that's only in
        // `peerDependenciesMeta`.
        let added: Vec<&Dependency> = (to_deps!().iter().enumerate())
            .filter(|(to_i, to_dep)| {
                !paired.is_set(*to_i)
                    && !(frozen
                        && to_dep.behavior.is_optional_peer()
                        && to_dep.version.literal.slice(to_buf!()) == b"*")
                    && !summary.members_left_out.contains(&(*to_i as u32))
            })
            .map(|(_, to_dep)| to_dep)
            .collect();
        summary.add = added.len() as u32;
        if frozen && let Some(added) = added.iter().find(|dep| !dep.behavior.is_workspace()) {
            let name = added.name.slice(to_buf!());
            summary.record_first_change(from, from_buf!(), name, DependencyChange::Added);
        }
        if is_root {
            summary.remove = removed_names.len() as u32;
            // This comes after the loop, which adds each workspace's `trustedDependencies` to
            // `to_lockfile`.
            if !summary.pruned_workspaces.is_empty()
                && to_lockfile.trusted_dependencies.is_none()
                && let Some(recorded) = &from_lockfile.trusted_dependencies
            {
                to_lockfile.trusted_dependencies =
                    Some(Lockfile::recorded_default_trust(recorded)?);
            }
            // A frozen install can't record that the scripts ran, so every frozen install would run
            // them again.
            if !frozen {
                Self::trusted_dependencies(
                    &mut summary,
                    from_lockfile.trusted_dependencies.as_ref(),
                    to_lockfile.trusted_dependencies.as_ref(),
                )?;
            }
        }

        if !missing_workspaces.is_empty() {
            lockfile::pruned_workspaces::exit_if_survivor_depends_on_missing(
                &*from_lockfile,
                &missing_workspaces,
                &*to_lockfile,
                &lockfile::pruned_workspaces::Survivor {
                    name: to.name,
                    dependencies: to.dependencies,
                    recorded: from.dependencies,
                },
                &survivors,
                keeps_missing_workspaces,
                pm.options.log_level.is_silent(),
            );
        }

        if !summary.pruned_workspaces.is_empty() && !pm.options.log_level.is_silent() {
            let count = summary.pruned_workspaces.len();
            bun_core::note!(
                "skipped {} workspace{} listed in bun.lock but not on disk: {}",
                count,
                if count == 1 { "" } else { "s" },
                lockfile::pruned_workspaces::quoted_names(
                    &mut from_deps
                        .iter()
                        .filter(|dep| {
                            dep.behavior.is_workspace()
                                && summary.pruned_workspaces.contains(&dep.name_hash)
                        })
                        .map(|dep| dep.name.slice(from_buf!())),
                ),
            );
        }

        if !catalog_entries_skipped.is_empty() && !pm.options.log_level.is_silent() {
            let count = catalog_entries_skipped.len();
            bun_core::note!(
                "skipped {} catalog entr{} not in bun.lock (unused by the workspaces on disk): {}",
                count,
                if count == 1 { "y" } else { "ies" },
                lockfile::pruned_workspaces::quoted_names(
                    &mut catalog_entries_skipped.iter().map(|name| &**name),
                ),
            );
        }

        // bun.lock records no scripts.
        if from.resolution.tag != ResolutionTag::Root && from.scripts.filled {
            for (to_hook, from_hook) in to.scripts.hooks().iter().zip(from.scripts.hooks().iter()) {
                if !String::eql(**to_hook, **from_hook, to_buf!(), from_buf!()) {
                    // We found a changed life-cycle script
                    summary.update += 1;
                    summary.script_only_updates += 1;
                }
            }
        }

        if from.resolution.tag != ResolutionTag::Root
            && !Bin::eql(
                &to.bin,
                &from.bin,
                to_buf!(),
                to_lockfile.buffers.extern_strings.as_slice(),
                from_buf!(),
                from_lockfile.buffers.extern_strings.as_slice(),
            )
        {
            summary.update += 1;
            summary.script_only_updates += 1;
        }

        Ok(summary)
    }

    /// Compares the package.json of a `file:` directory with its lockfile entry. Returns `None` if
    /// the file can't be read, and the entry is kept.
    #[inline(never)]
    fn generate_folder(
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        from_lockfile: &mut Lockfile,
        to_lockfile: &mut Lockfile,
        from_package_id: PackageID,
        removed_names: &mut Vec<PackageNameHash>,
    ) -> crate::Result<Option<DiffSummary>> {
        let from_pkg = from_lockfile.packages.get(from_package_id as usize);
        let Some(package_json_path) = lockfile::join_top_level_dir(&[
            from_pkg
                .resolution
                .folder()
                .slice(from_lockfile.buffers.string_bytes.as_slice()),
            b"package.json",
        ]) else {
            return Ok(None);
        };
        let Ok(contents) = bun_sys::File::read_from(bun_sys::Fd::cwd(), package_json_path.slice())
        else {
            return Ok(None);
        };
        let source =
            bun_ast::Source::init_path_string(package_json_path.slice(), contents.as_slice());
        let mut folder_pkg = Package::default();
        // Its messages point into `source`. The resolver reports them when it reads the directory.
        let mut parse_log = bun_ast::Log::init();
        if folder_pkg
            .parse(
                to_lockfile,
                pm,
                &mut parse_log,
                &source,
                &mut (),
                Features::FOLDER,
            )
            .is_err()
        {
            return Ok(None);
        }
        Self::generate_inner(
            pm,
            log,
            from_lockfile,
            to_lockfile,
            &from_pkg,
            &folder_pkg,
            None,
            None,
            removed_names,
        )
        .map(Some)
    }

    #[cold]
    #[inline(never)]
    fn warn_folder_is_out_of_date(log: &mut bun_ast::Log, lockfile: &Lockfile, folder: PackageID) {
        log.add_warning_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "dependencies in {}/package.json changed since lockfile was saved (run 'bun install')",
                bun_core::fmt::escape_control_chars(
                    lockfile.packages.items_resolution()[folder as usize]
                        .folder()
                        .slice(lockfile.buffers.string_bytes.as_slice())
                ),
            ),
        );
    }

    /// npm's sticky rule: returns true if `to_dep` refers to the package `locked` and its range
    /// accepts that version.
    pub(crate) fn locked_version_satisfies(
        from_lockfile: &Lockfile,
        locked: PackageID,
        to_dep: &Dependency,
        to_buf: &[u8],
    ) -> bool {
        let packages = &from_lockfile.packages;
        let (Some(resolution), Some(npm)) = (
            packages.items_resolution().get(locked as usize),
            to_dep.version.try_npm(),
        ) else {
            return false;
        };
        let from_buf = from_lockfile.buffers.string_bytes.as_slice();
        resolution.tag == ResolutionTag::Npm
            && (npm.name).eql(packages.items_name()[locked as usize], to_buf, from_buf)
            && (npm.version).satisfies(resolution.npm().version, to_buf, from_buf)
    }

    /// The parsed root has no row for a dependency that is also in `optionalDependencies`, so this
    /// reads package.json: does the group of `dep` still have it, with the same text?
    #[cold]
    fn is_still_in_root_manifest(
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        dep: &Dependency,
        buf: &[u8],
    ) -> bool {
        let group: &[u8] = if dep.behavior.is_dev() {
            b"devDependencies"
        } else if dep.behavior.is_peer() {
            b"peerDependencies"
        } else {
            b"dependencies"
        };
        let Some(path) = lockfile::join_top_level_dir(&[b"package.json"]) else {
            return false;
        };
        let Ok(entry) = pm
            .workspace_package_json_cache
            .get_with_path(log, path.slice(), Default::default())
            .unwrap()
        else {
            return false;
        };
        let bump = bun_alloc::Arena::new();
        (entry.root.get(group))
            .and_then(|rows| rows.get(dep.name.slice(buf)))
            .and_then(|written| written.as_utf8(&bump))
            .is_some_and(|written| {
                dependency::trim_literal(written)
                    == dependency::trim_literal(dep.version.literal.slice(buf))
            })
    }

    /// Returns true for a range of registry versions of the package that `member` is the name of.
    fn is_published_version_of(own: &Dependency, buf: &[u8], member: PackageNameHash) -> bool {
        !own.behavior.is_workspace()
            && own.version.try_npm().is_some_and(|npm| {
                semver::string::Builder::string_hash(npm.name.slice(buf)) == member
            })
    }

    /// Bun 1.4 and older took a dist-tag of a workspace's name from the registry, and linked the
    /// workspace for a `file:` path to its folder under any name. While package.json says the same,
    /// the root's dependency `row` is read the way the lockfile has it.
    fn keep_older_link(
        from_lockfile: &Lockfile,
        from_dep: &Dependency,
        to_lockfile: &mut Lockfile,
        row: usize,
    ) {
        use dependency::version::Tag;
        let from_buf = from_lockfile.buffers.string_bytes.as_slice();
        let to_buf = to_lockfile.buffers.string_bytes.as_slice();
        let to_dep = &mut to_lockfile.buffers.dependencies[row];
        if !(to_dep.version.literal).eql(from_dep.version.literal, to_buf, from_buf) {
            return;
        }
        match (from_dep.version.tag, to_dep.version.tag) {
            (Tag::DistTag, Tag::Workspace) => {
                let literal = to_dep.version.literal.sliced(to_buf);
                if let Some(version) = dependency::parse(
                    to_dep.name,
                    to_dep.name_hash,
                    literal.slice,
                    &literal,
                    None,
                    None,
                ) {
                    to_dep.version = version;
                }
            }
            (Tag::Workspace, Tag::Folder) => {
                let folder = *to_dep.version.folder();
                // The folder can have stopped being a workspace, or be one of another name now.
                if folder.eql(*from_dep.version.workspace(), to_buf, from_buf)
                    && (to_lockfile.workspace_paths.iter()).any(|(name_hash, path)| {
                        path.eql(folder, to_buf, to_buf)
                            && from_lockfile.workspace_paths.contains(name_hash)
                    })
                {
                    to_dep.version.tag = Tag::Workspace;
                    to_dep.version.value.workspace = folder;
                }
            }
            _ => {}
        }
    }

    /// A one-sided merge can leave a pin that the unchanged range rules out. Only flags clear cases.
    fn locked_version_is_out_of_range(
        from_lockfile: &Lockfile,
        locked: PackageID,
        to_lockfile: &Lockfile,
        to_deps: &[Dependency],
        to_i: usize,
    ) -> bool {
        let to_dep = &to_deps[to_i];
        let packages = &from_lockfile.packages;
        let to_buf = to_lockfile.buffers.string_bytes.as_slice();
        let declared = to_lockfile.catalogs.resolve_range(to_buf, to_dep);
        let (Some(resolution), Some(npm)) = (
            packages.items_resolution().get(locked as usize),
            declared.try_npm(),
        ) else {
            return false;
        };
        let from_buf = from_lockfile.buffers.string_bytes.as_slice();
        resolution.tag == ResolutionTag::Npm
            // bun.lock binds rows by name, so an optional row that never resolved can point anywhere.
            && !to_dep.behavior.is_peer()
            && !to_dep.behavior.is_optional()
            // `*` can pin the prerelease that `latest` points at, which no range "satisfies".
            && !resolution.npm().version.tag.has_pre()
            && (npm.name).eql(packages.items_name()[locked as usize], to_buf, from_buf)
            && !to_lockfile.overrides.has_rule_for_name(to_dep.name_hash)
            && !(npm.version).satisfies(resolution.npm().version, to_buf, from_buf)
            // A name in two groups gets one version, which only has to fit one of the ranges.
            && (to_deps.iter())
                .filter(|other| {
                    other.name_hash == to_dep.name_hash && !other.behavior.is_workspace()
                })
                .count()
                == 1
    }

    /// `to` is about to replace `from_id`. Its dependencies keep the resolutions that `generate`
    /// would let the root's dependencies keep.
    pub(crate) fn keep_resolutions(pm: &mut PackageManager, from_id: PackageID, to: &Package) {
        if from_id >= pm.lockfile.loaded_package_count {
            return;
        }
        let from = pm.lockfile.packages.items_dependencies()[from_id as usize];
        if pm.to_update {
            return Self::keep_while_refreshing(pm, from_id, from, to.dependencies);
        }
        for to_i in to.dependencies.begin() as usize..to.dependencies.end() as usize {
            let lockfile = &*pm.lockfile;
            let buf = lockfile.buffers.string_bytes.as_slice();
            let to_dep = &lockfile.buffers.dependencies[to_i];
            let kept = Self::locked_for(lockfile, from, to_dep, |from_dep, locked| {
                (lockfile.packages.items_resolution().get(locked as usize))
                    .is_some_and(|resolution| resolution.tag != ResolutionTag::Folder)
                    && ((Dependency::eql(to_dep, from_dep, buf, buf)
                        && !Self::locked_version_is_out_of_range(
                            lockfile,
                            locked,
                            lockfile,
                            to.dependencies.get(&lockfile.buffers.dependencies),
                            to_i - to.dependencies.begin() as usize,
                        ))
                        || Self::locked_version_satisfies(lockfile, locked, to_dep, buf))
            });
            if let Some(locked) = kept {
                pm.lockfile.buffers.resolutions[to_i] = locked;
            }
        }
    }

    /// The package of the dependency in `from` with the name and group of `to_dep`, if `keeps` it.
    fn locked_for(
        lockfile: &Lockfile,
        from: DependencySlice,
        to_dep: &Dependency,
        keeps: impl Fn(&Dependency, PackageID) -> bool,
    ) -> Option<PackageID> {
        (from.begin() as usize..from.end() as usize).find_map(|from_i| {
            let from_dep = &lockfile.buffers.dependencies[from_i];
            let locked = lockfile.buffers.resolutions[from_i];
            (from_dep.name_hash == to_dep.name_hash
                && from_dep.behavior == to_dep.behavior
                && keeps(from_dep, locked))
            .then_some(locked)
        })
    }

    /// A dependency in `to` that `refreshes_in_place` keeps the package of the same one in `from`.
    pub(crate) fn keep_while_refreshing(
        pm: &mut PackageManager,
        declarer: PackageID,
        from: DependencySlice,
        to: DependencySlice,
    ) {
        use crate::package_manager_real::enqueue;
        for to_i in to.begin()..to.end() {
            let lockfile = &*pm.lockfile;
            let buf = lockfile.buffers.string_bytes.as_slice();
            let to_dep = &lockfile.buffers.dependencies[to_i as usize];
            if lockfile.buffers.resolutions[to_i as usize] != invalid_package_id
                || !enqueue::may_refresh_in_place(to_dep)
            {
                continue;
            }
            let kept = Self::locked_for(lockfile, from, to_dep, |from_dep, locked| {
                Dependency::eql(to_dep, from_dep, buf, buf)
                    && enqueue::refreshes_in_place(pm, declarer, to_dep, locked)
            });
            if let Some(locked) = kept {
                pm.lockfile.buffers.resolutions[to_i as usize] = locked;
                pm.lockfile.mark_refreshing(to_i);
            }
        }
    }

    /// `None` is the default list, which the lockfile never records.
    fn trusted_dependencies(
        summary: &mut DiffSummary,
        from: Option<&TrustedDependenciesSet>,
        to: Option<&TrustedDependenciesSet>,
    ) -> crate::Result<()> {
        // An empty name is the legacy bun.lockb hash-only sentinel.
        let same = |a: &[u8], b: &[u8]| a.is_empty() || b.is_empty() || a == b;
        let added = &mut summary.added_trusted_dependencies;
        match (from, to) {
            (None, None) => {}
            (Some(from), Some(to)) => {
                for (hash, to_name) in to.iter() {
                    if !from.get(hash).is_some_and(|name| same(name, to_name)) {
                        added.put(*hash, to_name.clone())?;
                    }
                }
                summary.removed_trusted_dependencies = from
                    .iter()
                    .any(|(hash, name)| !to.get(hash).is_some_and(|to_name| same(name, to_name)));
            }
            (Some(from), None) => {
                for (hash, key) in default_trusted_dependencies::entries() {
                    if !from.contains(&hash) {
                        added.put(hash, Box::from(key))?;
                    }
                }
                summary.removed_trusted_dependencies = from
                    .keys()
                    .iter()
                    .any(|&hash| !default_trusted_dependencies::has_with_hash(hash));
            }
            // This includes an entry that's on the default list, because the lockfile didn't have
            // it.
            (None, Some(to)) => {
                for (hash, to_name) in to.iter() {
                    added.put(*hash, to_name.clone())?;
                }
                // `[]` adds no name and takes the default list away, which the lockfile records.
                summary.removed_trusted_dependencies = to.count() == 0;
            }
        }
        Ok(())
    }
}

impl Package<u64> {
    pub fn parse<R: ResolverContext>(
        &mut self,
        lockfile: &mut Lockfile,
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        resolver: &mut R,
        features: Features,
    ) -> crate::Result<()> {
        initialize_store();
        let parsed = match crate::bun_json::ParsedJson::parse_package_json(source, log) {
            Ok(p) => p,
            Err(err) => {
                let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                bun_core::pretty_errorln!(
                    "<r><red>{}<r> parsing package.json in <b>\"{}\"<r>",
                    err.name(),
                    bstr::BStr::new(source.path.pretty_dir()),
                );
                Global::crash();
            }
        };

        self.parse_with_json(lockfile, pm, log, source, parsed.root, resolver, features)
    }

    /// Borrow-splitting bridge for `PackageManager` callers
    /// (`processDependencyList`, `folder_resolver`). Borrowck rejects passing
    /// `manager.lockfile`, `manager`, `manager.log` as three separate args
    /// overlapping `&mut self`, so split via raw
    /// pointer here once instead of at every call site.
    ///
    /// # Safety
    /// `manager` must point to a live `PackageManager` for the duration of the
    /// call, and its `lockfile` / `log` fields must point to live allocations
    /// disjoint from `*manager` itself.
    pub(crate) unsafe fn parse_from_real_manager<R: ResolverContext>(
        &mut self,
        manager: *mut crate::package_manager_real::PackageManager,
        source: &bun_ast::Source,
        resolver: &mut R,
        features: Features,
    ) -> crate::Result<()> {
        // SAFETY: `manager` points to a live `PackageManager` for the duration
        // of this call (caller passes `self as *mut _`); `lockfile` and `log`
        // are disjoint fields, and `parse_with_json` only reaches `manager`
        // through the `pm` argument it receives here — no re-entrancy.
        let (lockfile, pm, log) = unsafe {
            let m = &mut *manager;
            let lockfile: *mut Lockfile = &raw mut *m.lockfile;
            let log: *mut bun_ast::Log = m.log;
            (&mut *lockfile, &mut *manager, &mut *log)
        };
        self.parse(lockfile, pm, log, source, resolver, features)
    }

    fn parse_dependency(
        workspace_paths: &mut lockfile::NameHashMap,
        workspace_versions: &mut lockfile::VersionHashMap,
        linked_members: &mut lockfile::LinkedMembers,
        duplicate_checker_map: &mut lockfile::DuplicateCheckerMap,
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        group: &DependencyGroup,
        string_builder: &mut StringBuilder<'_>,
        features: Features,
        package_dependencies: &mut [Dependency],
        tag: Option<dependency::version::Tag>,
        workspace_ver: Option<SemverVersion>,
        external_alias: ExternalString,
        version: &[u8],
        key_loc: bun_ast::Loc,
    ) -> crate::Result<Option<Dependency>> {
        let nameless_alias = dependency::nameless_npm_alias(version);
        if external_alias.value.is_empty() || nameless_alias.is_some() {
            // Packages that others publish do have these, and that is not this project's error.
            if !(features.is_main || features.is_workspace) {
                log.add_warning_fmt_no_excerpt(
                    source,
                    key_loc,
                    format_args!(
                        "skipping unnamed dependency (\"{}\" in \"{}\")",
                        bun_core::fmt::escape_control_chars(version),
                        bstr::BStr::new(group.prop),
                    ),
                );
                return Ok(None);
            }
            match nameless_alias {
                Some(name) if !external_alias.value.is_empty() => log.add_error_fmt(
                    source,
                    value_loc_of(source, key_loc),
                    format_args!(
                        "invalid package name \"{}\" in dependency \"{}\"",
                        bun_core::fmt::escape_control_chars(name),
                        bun_core::fmt::escape_control_chars(version),
                    ),
                ),
                _ => log.add_error_fmt(
                    source,
                    key_loc,
                    format_args!(
                        "empty dependency name (in \"{}\")",
                        bstr::BStr::new(group.prop)
                    ),
                ),
            }
            return Err(crate::Error::InstallFailed);
        }

        #[cfg(windows)]
        let external_version = 'brk: {
            match tag.unwrap_or_else(|| {
                dependency::version::Tag::infer(dependency::trim_literal(version))
            }) {
                dependency::version::Tag::Workspace
                | dependency::version::Tag::Folder
                | dependency::version::Tag::Symlink
                | dependency::version::Tag::Tarball => {
                    if String::can_inline(version) {
                        let mut copy = string_builder.append::<String>(version);
                        path::dangerously_convert_path_to_posix_in_place::<u8>(&mut copy.bytes);
                        break 'brk copy;
                    } else {
                        let str_ = string_builder.append::<String>(version);
                        let ptr = str_.ptr();
                        path::dangerously_convert_path_to_posix_in_place::<u8>(
                            &mut string_builder.string_bytes
                                [ptr.off as usize..(ptr.off + ptr.len) as usize],
                        );
                        break 'brk str_;
                    }
                }
                _ => string_builder.append::<String>(version),
            }
        };
        #[cfg(not(windows))]
        let external_version = string_builder.append::<String>(version);

        // SAFETY: `buf` aliases `string_builder.string_bytes` while later
        // `string_builder.append()` calls write into the *pre-reserved* tail
        // (`allocate()` ran before this fn). No realloc occurs, so the detached
        // borrow stays valid; a tracked `&[u8]` would needlessly lock the builder.
        let buf: &[u8] =
            unsafe { bun_ptr::detach_lifetime(string_builder.string_bytes.as_slice()) };
        let sliced = external_version.sliced(buf);

        let mut dependency_version = Dependency::parse_with_optional_tag(
            external_alias.value,
            Some(external_alias.hash),
            sliced.slice,
            tag,
            &sliced,
            Some(&mut *log),
            // Only the project's own `npm:` aliases are registered. An alias that another package
            // declares applies to that dependency only.
            (features.is_main || features.is_workspace).then_some(&mut *pm),
        )
        .unwrap_or_default();
        let mut workspace_range: Option<semver::query::Group> = None;
        #[allow(non_snake_case)]
        let FEATURES = features;
        let name_hash = match dependency_version.tag {
            dependency::version::Tag::Npm => {
                let npm_name = dependency_version.npm().name;
                semver::string::Builder::string_hash(npm_name.slice(buf))
            }
            dependency::version::Tag::Workspace => {
                let literal = dependency::trim_literal(sliced.slice);
                if strings::has_prefix(literal, b"workspace:") {
                    'brk: {
                        let input = &literal[b"workspace:".len()..];
                        let trimmed = strings::trim(input, &strings::WHITESPACE_CHARS);
                        if trimmed.len() != 1
                            || (trimmed[0] != b'*' && trimmed[0] != b'^' && trimmed[0] != b'~')
                        {
                            let at = strings::last_index_of_char(input, b'@').unwrap_or(0);
                            if at > 0 {
                                workspace_range = Some(
                                    semver::query::parse(&input[at as usize + 1..], sliced)
                                        .unwrap_or_else(|_| bun_core::out_of_memory()),
                                );
                                break 'brk semver::string::Builder::string_hash(
                                    &input[0..at as usize],
                                );
                            }
                            workspace_range = Some(
                                semver::query::parse(input, sliced)
                                    .unwrap_or_else(|_| bun_core::out_of_memory()),
                            );
                        }
                        external_alias.hash
                    }
                } else {
                    external_alias.hash
                }
            }
            _ => external_alias.hash,
        };

        let mut workspace_path: Option<String> = None;
        let mut workspace_version = workspace_ver;
        if tag.is_none() {
            workspace_path = workspace_paths.get(&name_hash).copied();
            workspace_version = workspace_versions.get(&name_hash).copied();
        }

        if tag.is_some() {
            debug_assert!(
                dependency_version.tag != dependency::version::Tag::Npm
                    && dependency_version.tag != dependency::version::Tag::DistTag
            );
        }

        let unsafe_folder_path = |log: &mut bun_ast::Log| {
            log.add_error_fmt(
                source,
                value_loc_of(source, key_loc),
                format_args!(
                    "Dependency \"{}\" has an unsafe folder path",
                    bun_core::fmt::escape_control_chars(external_alias.slice(buf)),
                ),
            );
            crate::Error::InstallFailed
        };

        match dependency_version.tag {
            // Cache packages (`Features::NPM`) keep these package-relative, like `from_npm`.
            path_tag @ (dependency::version::Tag::Folder | dependency::version::Tag::Symlink)
                if (features.is_main || features.is_workspace || features.is_folder)
                    && (path_tag == dependency::version::Tag::Folder
                        || dependency::is_link_path(dependency_version.symlink().slice(buf))) =>
            {
                let is_link = path_tag == dependency::version::Tag::Symlink;
                let target = if is_link {
                    *dependency_version.symlink()
                } else {
                    *dependency_version.folder()
                };
                let mut folder_buf = bun_paths::path_buffer_pool::get();
                let Some(relative) = folder_relative_to_top_level_dir(
                    source.path.name().dir,
                    target.slice(buf),
                    &mut folder_buf.0,
                ) else {
                    return Err(unsafe_folder_path(log));
                };
                if is_link {
                    dependency_version.value.symlink = string_builder
                        .append::<String>(&dependency::link_path_for_lockfile(relative));
                } else {
                    dependency_version.value.folder = string_builder.append::<String>(relative);
                }

                // The root only has one `node_modules/<name>`, and the workspace wins over the
                // folder.
                if !is_link
                    && let Some(path) = workspace_path
                    && package_dependencies
                        .iter()
                        .any(|dep| dep.name_hash == name_hash && dep.behavior.is_workspace())
                {
                    dependency_version.tag = dependency::version::Tag::Workspace;
                    dependency_version.value.workspace = path;
                }
            }
            // The workspace also wins over a dist-tag of its own name, such as `"foo": "latest"`,
            // because only the registry knows which version a tag refers to.
            dependency::version::Tag::DistTag => {
                if let Some(path) = workspace_path
                    && (dependency_version.dist_tag().name).eql(external_alias.value, buf, buf)
                    && package_dependencies
                        .iter()
                        .any(|dep| dep.name_hash == name_hash && dep.behavior.is_workspace())
                {
                    dependency_version.tag = dependency::version::Tag::Workspace;
                    dependency_version.value.workspace = path;
                }
            }
            dependency::version::Tag::Npm => {
                if let Some(workspace_path) = lockfile::linked_workspace_path(
                    pm.options.link_workspace_packages,
                    workspace_paths,
                    workspace_versions,
                    name_hash,
                    &dependency_version.npm().version,
                    buf,
                ) {
                    let path = workspace_path.sliced(buf);
                    if let Some(mut dep) = dependency::parse_with_tag(
                        external_alias.value,
                        Some(external_alias.hash),
                        path.slice,
                        dependency::version::Tag::Workspace,
                        &path,
                        Some(&mut *log),
                        Some(&mut *pm),
                    ) {
                        // Whole-struct move so `Drop` frees the old npm
                        // chain; keep the existing `literal`.
                        dep.literal = dependency_version.literal;
                        dependency_version = dep;
                    }
                }
            }
            dependency::version::Tag::Workspace => 'workspace: {
                // The dependency names the root package. The root is not a workspace member, so it
                // is not added to `workspace_paths`.
                let mut version_buf: &[u8] = buf;
                if workspace_path.is_none()
                    && (features.is_main || features.is_workspace)
                    && tag.is_none()
                    && name_hash != 0
                    && name_hash == pm.workspace_root_name_hash
                {
                    workspace_path = Some(string_builder.append::<String>(b"."));
                    version_buf = &pm.workspace_root_version;
                    let parsed = SemverVersion::parse_utf8(version_buf);
                    workspace_version = (parsed.valid && parsed.wildcard == Wildcard::None)
                        .then(|| parsed.version.min());
                }
                if let Some(path) = workspace_path {
                    if let Some(range) = &workspace_range {
                        if let Some(ver) = workspace_version {
                            if range.satisfies(ver, buf, version_buf) {
                                dependency_version.value.workspace = path;
                                break 'workspace;
                            }
                        }

                        // `foo@      `, `foo@^`, `foo@~` and `../foo` do not name a version, so
                        // they link the workspace whatever its version is, like `workspace:^`.
                        // SAFETY: `range.input` borrows `lockfile.buffers.string_bytes`
                        // (set by `semver::query::parse` above), which is live here.
                        let version_literal =
                            strings::trim(unsafe { &*range.input }, &strings::WHITESPACE_CHARS);
                        if range.is_empty()
                            || range.is_star()
                            || SemverVersion::is_tagged_version_only(version_literal)
                            || features.unchecked_workspace_ranges
                        {
                            dependency_version.value.workspace = path;
                            break 'workspace;
                        }

                        // workspace is not required to have a version, but if it does
                        // and this version doesn't match it, fail to install
                        log.add_error_fmt(
                            source,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "No matching version for workspace dependency \"{}\". Version: \"{}\"",
                                bstr::BStr::new(external_alias.slice(buf)),
                                bun_core::fmt::escape_control_chars(
                                    dependency_version.literal.slice(buf)
                                ),
                            ),
                        );
                        return Err(crate::Error::InstallFailed);
                    }

                    dependency_version.value.workspace = path;
                } else if features.is_main || features.is_workspace {
                    let workspace_str = *dependency_version.workspace();
                    let workspace = workspace_str.slice(buf);
                    let mut relative_buf;
                    // An empty spec names no workspace and no path, so it resolves like `*`.
                    let relative: &[u8] = if workspace == b"*"
                        || strings::trim(workspace, &strings::WHITESPACE_CHARS).is_empty()
                    {
                        b"*"
                    } else {
                        relative_buf = bun_paths::path_buffer_pool::get();
                        // `.` for `workspace:.` in the root package.json
                        match folder_relative_to_top_level_dir(
                            source.path.name().dir,
                            workspace,
                            &mut relative_buf.0,
                        ) {
                            Some(relative) => relative,
                            None => return Err(unsafe_folder_path(log)),
                        }
                    };
                    let path = string_builder.append::<String>(relative);
                    debug_assert!(path.len() > 0);
                    debug_assert!(!bun_paths::is_absolute(path.slice(buf)));
                    dependency_version.value.workspace = path;

                    // The root package again, by its path.
                    if path.slice(buf) == b"." {
                        break 'workspace;
                    }

                    // With a `tag`, the path comes from "workspaces", and the caller has already
                    // checked whether that path goes through a symlink.
                    if tag.is_none() && relative != b"*" {
                        linked_members.look_at(relative);
                    }

                    let workspace_entry = workspace_paths.get_or_put(name_hash)?;
                    let found_matching_workspace = workspace_entry.found_existing;

                    if let Some(ver) = workspace_version {
                        workspace_versions.put(name_hash, ver)?;
                        for package_dep in package_dependencies.iter_mut() {
                            if match package_dep.version.tag {
                                // `dependencies` & `workspaces` defined within the same `package.json`
                                dependency::version::Tag::Npm => {
                                    semver::string::Builder::string_hash(
                                        package_dep.realname().slice(buf),
                                    ) == name_hash
                                        && package_dep
                                            .version
                                            .npm()
                                            .version
                                            .satisfies(ver, buf, buf)
                                }
                                // `workspace:*`
                                dependency::version::Tag::Workspace => {
                                    found_matching_workspace
                                        && semver::string::Builder::string_hash(
                                            package_dep.realname().slice(buf),
                                        ) == name_hash
                                }
                                _ => false,
                            } {
                                package_dep.version = dependency_version;
                                *workspace_entry.value_ptr = path;
                                return Ok(None);
                            }
                        }
                    } else if workspace_entry.found_existing {
                        for package_dep in package_dependencies.iter_mut() {
                            if package_dep.version.tag == dependency::version::Tag::Workspace
                                && semver::string::Builder::string_hash(
                                    package_dep.realname().slice(buf),
                                ) == name_hash
                            {
                                package_dep.version = dependency_version;
                                return Ok(None);
                            }
                        }
                        return Err(crate::Error::InstallFailed);
                    }

                    *workspace_entry.value_ptr = path;
                }
            }
            _ => {}
        }

        let mut this_dep = Dependency {
            behavior: group.behavior,
            name: external_alias.value,
            name_hash: external_alias.hash,
            version: dependency_version,
        };
        if !(FEATURES.is_main || FEATURES.is_workspace) {
            lockfile::CatalogMap::strip_reference(&mut this_dep);
        }

        // `peerDependencies` may be specified on existing dependencies. Packages in `workspaces` are deduplicated when
        // the array is processed
        if FEATURES.check_for_duplicate_dependencies
            && !group.behavior.is_peer()
            && !group.behavior.is_workspace()
        {
            let entry = duplicate_checker_map.get_or_put(external_alias.hash)?;
            if entry.found_existing {
                // duplicate dependencies are allowed in optionalDependencies
                if group.behavior.is_optional() {
                    for package_dep in package_dependencies.iter_mut() {
                        if package_dep.name_hash == this_dep.name_hash
                            && !package_dep.behavior.is_workspace()
                        {
                            *package_dep = this_dep;
                            break;
                        }
                    }
                    return Ok(None);
                } else {
                    let mut notes: Vec<bun_ast::Data> = Vec::with_capacity(1);

                    let mut text = Vec::new();
                    {
                        use std::io::Write;
                        let _ = write!(
                            &mut text,
                            "\"{}\" originally specified here",
                            bun_core::fmt::escape_control_chars(external_alias.slice(buf))
                        );
                    }
                    notes.push(bun_ast::Data {
                        text: text.into(),
                        location: bun_ast::Location::init_or_null(
                            Some(source),
                            source.range_of_string(value_loc_of(source, *entry.value_ptr)),
                        ),
                        ..Default::default()
                    });

                    log.add_range_warning_fmt_with_notes(
                        Some(source),
                        source.range_of_string(key_loc),
                        notes.into(),
                        format_args!(
                            "Duplicate dependency: \"{}\" specified in package.json",
                            bun_core::fmt::escape_control_chars(external_alias.slice(buf))
                        ),
                    );
                }
            }

            *entry.value_ptr = key_loc;
        }

        Ok(Some(this_dep))
    }

    #[inline(never)]
    pub(crate) fn parse_with_json(
        &mut self,
        lockfile: &mut Lockfile,
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        json: Expr,
        resolver: &mut dyn ResolverContext,
        features: Features,
    ) -> crate::Result<()> {
        #[allow(non_snake_case)]
        let FEATURES = features;
        // Used by `asString` for transcoding. The result is only borrowed until
        // `string_builder.append` copies it.
        let bump = bun_alloc::Arena::new();
        // While it's live, read `string_bytes` through `string_builder.string_bytes`.
        let mut string_builder = crate::string_builder!(lockfile);
        let mut total_dependencies_count: u32 = 0;

        self.meta.origin = if FEATURES.is_main {
            install::Origin::Local
        } else {
            install::Origin::Npm
        };
        self.name = String::default();
        self.name_hash = 0;

        // -- Count the sizes
        let name: &[u8] = 'name: {
            if let Some(name_q) = json.as_property(b"name") {
                if let Some(name) = name_q.expr.as_utf8(&bump) {
                    if !name.is_empty() {
                        // Non-root names become bun.lock `packages` keys, read back only if safe.
                        if FEATURES.is_main || dependency::is_safe_lockfile_package_name(name) {
                            break 'name name;
                        }
                        if resolver.fallback_name().is_none() {
                            log.add_error_fmt(
                                source,
                                value_loc_of(source, name_q.loc),
                                format_args!(
                                    "invalid package name {}",
                                    bun_core::fmt::EscapeControlChars(bun_core::fmt::quote(name))
                                ),
                            );
                            return Err(crate::Error::InvalidPackageJSON);
                        }
                    }
                }
            }

            match resolver.fallback_name() {
                Some(fallback_name) => bump.alloc_slice_copy(&fallback_name),
                None => b"",
            }
        };
        if !name.is_empty() {
            string_builder.count(name);
        }

        if FEATURES.patched_dependencies {
            if let Some(patched_deps) = json.as_property(b"patchedDependencies") {
                if let Some(rows) = JsonObjectStringRows::new(&patched_deps.expr, &bump) {
                    for (_, value, _) in rows {
                        if let Some(value) = value {
                            string_builder.count(value);
                        }
                    }
                }
            }
        }

        if !FEATURES.is_main {
            if let Some(version_q) = json.as_property(b"version") {
                if let Some(version_str) = version_q.expr.as_utf8(&bump) {
                    string_builder.count(version_str);
                }
            }
        }
        'bin: {
            if let Some(bin) = json.as_property(b"bin") {
                if let Some(rows) = JsonObjectStringRows::new(&bin.expr, &bump) {
                    for (k, v, _) in rows {
                        let Some(v) = v else {
                            continue;
                        };
                        string_builder.count(k);
                        string_builder.count(v);
                    }
                    break 'bin;
                }
                if bin.expr.is_string() {
                    if let Some(str_) = bin.expr.as_utf8(&bump) {
                        // The build pass reads `directories.bin` when `bin` is empty.
                        if !str_.is_empty() {
                            string_builder.count(str_);
                            break 'bin;
                        }
                    }
                }
            }

            if let Some(dirs) = json.as_property(b"directories") {
                if let Some(bin_prop) = dirs.expr.as_property(b"bin") {
                    if let Some(str_) = bin_prop.expr.as_utf8(&bump) {
                        string_builder.count(str_);
                        break 'bin;
                    }
                }
            }
        }

        Scripts::parse_count(&mut string_builder, json);

        if !resolver.is_void() {
            resolver.count(&mut string_builder, &json);
        }

        let dependency_groups: Vec<DependencyGroup> = {
            let mut out: Vec<DependencyGroup> = Vec::with_capacity(5);
            if FEATURES.workspaces {
                out.push(DependencyGroup::WORKSPACES);
            }
            if FEATURES.dependencies {
                out.push(DependencyGroup::DEPENDENCIES);
            }
            if FEATURES.dev_dependencies {
                out.push(DependencyGroup::DEV);
            }
            if FEATURES.optional_dependencies {
                out.push(DependencyGroup::OPTIONAL);
            }
            if FEATURES.peer_dependencies {
                out.push(DependencyGroup::PEER);
            }
            out
        };

        let mut workspace_names = workspace_map::WorkspaceMap::init();

        // pnpm/yarn synthesise an implicit `"*"` optional peer for entries
        // that appear in `peerDependenciesMeta` but not in
        // `peerDependencies`. Track the original key string so the
        // post-build pass can emit a real `Dependency` for any meta-only
        // names that nothing in the build loop consumed.
        let mut optional_peer_dependencies: ArrayHashMap<
            PackageNameHash,
            &[u8],
            bun_collections::identity_context::U64,
        > = ArrayHashMap::default();

        if FEATURES.peer_dependencies {
            if let Some(peer_dependencies_meta) = json.as_property(b"peerDependenciesMeta") {
                optional_peer_dependencies
                    .ensure_unused_capacity(peer_dependencies_meta.expr.property_count())?;
                peer_dependencies_meta
                    .expr
                    .for_each_property(|key, _key_loc, meta| {
                        let Some(optional) = meta.as_property(b"optional") else {
                            return;
                        };
                        if !matches!(
                            &optional.expr.data,
                            ExprData::EBoolean(b) if b.value
                        ) {
                            return;
                        }

                        let key: &[u8] = bump.alloc_slice_copy(key);
                        optional_peer_dependencies
                            .put_assume_capacity(semver::string::Builder::string_hash(key), key);
                        string_builder.count(key);
                        string_builder.count(b"*");
                        total_dependencies_count += 1;
                    });
            }
        }

        let missing_workspace = if pm.options.runtime_auto_install {
            workspace_map::MissingWorkspace::SkipEmptyToo
        } else if lockfile::pruned_workspaces::keeps_missing_workspaces(pm) {
            workspace_map::MissingWorkspace::SkipIfInLockfile(&pm.lockfile)
        } else {
            workspace_map::MissingWorkspace::Error
        };

        for group in &dependency_groups {
            if let Some(dependencies_q) = json.as_property(group.prop) {
                'brk: {
                    if dependencies_q.expr.is_array() {
                        if !group.behavior.is_workspace() {
                            let _ = bun_ast::add_error_pretty!(
                                log,
                                source,
                                dependencies_q.loc,
                                "{0} expects a map of specifiers, e.g.\n  <r><green>\"{0}\"<r>: {{\n    <green>\"bun\"<r>: <green>\"latest\"<r>\n  }}",
                                bstr::BStr::new(group.prop)
                            );
                            return Err(crate::Error::InvalidPackageJSON);
                        }
                        let arr = workspace_map::NamesArray::from_expr(
                            &dependencies_q.expr,
                            value_loc_of(source, dependencies_q.loc),
                        )
                        .expect("is_array was checked above");
                        total_dependencies_count += workspace_names.process_names_array(
                            &mut pm.workspace_package_json_cache,
                            log,
                            arr,
                            source,
                            dependencies_q.loc,
                            Some(&mut string_builder),
                            missing_workspace,
                        )?;
                        break 'brk;
                    }

                    if let Some(rows) = JsonObjectStringRows::new(&dependencies_q.expr, &bump) {
                        if group.behavior.is_workspace() {
                            // yarn workspaces expects a "workspaces" property shaped like this:
                            //
                            //    "workspaces": {
                            //        "packages": [
                            //           "path/to/package"
                            //        ]
                            //    }
                            //
                            if let Some(packages_query) =
                                dependencies_q.expr.as_property(b"packages")
                            {
                                let packages_expr = packages_query.expr;
                                let packages_loc =
                                    if matches!(dependencies_q.expr.data, ExprData::EObject(_)) {
                                        packages_expr.loc
                                    } else {
                                        value_loc_of(source, packages_query.loc)
                                    };
                                if !packages_expr.is_array() {
                                    let _ = log.add_error_fmt(
                                        source,
                                        packages_loc,
                                        format_args!(
                                            "\"workspaces.packages\" expects an array of strings, e.g.\n  \"workspaces\": {{\n    \"packages\": [\n      \"path/to/package\"\n    ]\n  }}"
                                        ),
                                    );
                                    return Err(crate::Error::InvalidPackageJSON);
                                }
                                let packages_arr = workspace_map::NamesArray::from_expr(
                                    &packages_expr,
                                    packages_loc,
                                )
                                .expect("is_array was checked above");
                                total_dependencies_count += workspace_names.process_names_array(
                                    &mut pm.workspace_package_json_cache,
                                    log,
                                    packages_arr,
                                    source,
                                    packages_loc,
                                    Some(&mut string_builder),
                                    missing_workspace,
                                )?;
                            }
                            // "workspaces": { "selfContained": ["apps/desktop"] } — workspaces
                            // (by path or name) whose node_modules must be complete and
                            // physical; see docs/pm/workspaces.mdx.
                            if let Some(q) = dependencies_q.expr.as_property(b"selfContained") {
                                if !q.expr.is_array() {
                                    let _ = log.add_error_fmt(
                                        source,
                                        q.expr.loc,
                                        format_args!(
                                            "\"workspaces.selfContained\" expects an array of workspace paths or names"
                                        ),
                                    );
                                    return Err(crate::Error::InvalidPackageJSON);
                                }
                                let mut owned: Vec<Vec<u8>> = Vec::new();
                                if let Some(mut items) = q.expr.as_array() {
                                    while let Some(item) = items.next() {
                                        let Some(s) = item.as_string(&bump) else {
                                            let _ = log.add_error_fmt(
                                                source,
                                                item.loc,
                                                format_args!(
                                                    "\"workspaces.selfContained\" entries must be strings (workspace paths or names)"
                                                ),
                                            );
                                            return Err(crate::Error::InvalidPackageJSON);
                                        };
                                        owned.push(s.to_vec());
                                    }
                                }
                                let list: Vec<&[u8]> = owned.iter().map(|v| v.as_slice()).collect();
                                for unmatched in workspace_names.mark_self_contained(&list) {
                                    log.add_warning_fmt(
                                        Some(source),
                                        q.expr.loc,
                                        format_args!(
                                            "\"workspaces.selfContained\": \"{}\" does not match any workspace path or name",
                                            bun_core::fmt::EscapeControlChars(bstr::BStr::new(
                                                unmatched
                                            ))
                                        ),
                                    );
                                }
                            }

                            break 'brk;
                        }
                        let count = rows.len() as u32;
                        for (key, value, key_loc) in rows {
                            let Some(value) = value else {
                                let _ = bun_ast::add_error_pretty!(
                                    log,
                                    source,
                                    value_loc_of(source, key_loc),
                                    "{0} expects a map of specifiers, e.g.\n  <r><green>\"{0}\"<r>: {{\n    <green>\"bun\"<r>: <green>\"latest\"<r>\n  }}",
                                    bstr::BStr::new(group.prop)
                                );
                                return Err(crate::Error::InvalidPackageJSON);
                            };

                            string_builder.count(key);
                            string_builder.count(value);

                            // If it's a folder or workspace, pessimistically assume we will need a maximum path
                            match dependency::version::Tag::infer(dependency::trim_literal(value)) {
                                dependency::version::Tag::Folder
                                | dependency::version::Tag::Workspace
                                | dependency::version::Tag::Symlink => {
                                    string_builder.cap += MAX_PATH_BYTES;
                                }
                                _ => {}
                            }
                        }
                        total_dependencies_count += count;
                        break 'brk;
                    }

                    if group.behavior.is_workspace() {
                        let _ = bun_ast::add_error_pretty!(
                            log,
                            source,
                            dependencies_q.loc,
                            "\"workspaces\" expects an array of strings, e.g.\n  <r><green>\"workspaces\"<r>: [\n    <green>\"path/to/package\"<r>\n  ]"
                        );
                    } else {
                        let _ = bun_ast::add_error_pretty!(
                            log,
                            source,
                            dependencies_q.loc,
                            "{0} expects a map of specifiers, e.g.\n  <r><green>\"{0}\"<r>: {{\n    <green>\"bun\"<r>: <green>\"latest\"<r>\n  }}",
                            bstr::BStr::new(group.prop)
                        );
                    }
                    return Err(crate::Error::InvalidPackageJSON);
                }
            }
        }

        workspace_names.warn_skipped(log);

        if FEATURES.trusted_dependencies {
            parse_append_trusted_dependencies(
                &mut lockfile.trusted_dependencies,
                log,
                source,
                json,
                &bump,
            )?;
        }

        if FEATURES.is_main {
            lockfile.overrides.parse_count(
                pm,
                log,
                source,
                &workspace_names,
                json,
                &mut string_builder,
            );

            if let Some(workspaces_expr) = json.get(b"workspaces") {
                lockfile
                    .catalogs
                    .parse_count(workspaces_expr, &mut string_builder);
            }

            // Count catalog strings in top-level package.json as well, since parseAppend
            // might process them later if no catalogs were found in workspaces
            lockfile.catalogs.parse_count(json, &mut string_builder);

            lockfile.package_extensions.parse(log, source, &json);

            install::postinstall_optimizer::PostinstallOptimizer::from_package_json(
                &mut pm.postinstall_optimizer,
                &json,
            )?;
        }

        string_builder.allocate()?;
        lockfile
            .buffers
            .dependencies
            .reserve(total_dependencies_count as usize);
        lockfile
            .buffers
            .resolutions
            .reserve(total_dependencies_count as usize);

        let off = lockfile.buffers.dependencies.len();
        debug_assert!(lockfile.buffers.dependencies.len() == lockfile.buffers.resolutions.len());

        // Only appended to the lockfile after the last `?`, because a caller may swallow an error
        // and call this again.
        let mut package_dependencies: Vec<Dependency> =
            Vec::with_capacity(total_dependencies_count as usize);

        if !name.is_empty() {
            let external_string = string_builder.append::<ExternalString>(name);
            self.name = external_string.value;
            self.name_hash = external_string.hash;
        }

        if !FEATURES.is_main {
            if !resolver.is_void() {
                self.resolution = resolver.resolve(&mut string_builder, &json)?;
            }
        } else {
            self.resolution = Resolution::<u64>::init(TaggedValue::Root);
        }

        if FEATURES.patched_dependencies {
            if let Some(patched_deps) = json.as_property(b"patchedDependencies") {
                if let Some(rows) = JsonObjectStringRows::new(&patched_deps.expr, &bump) {
                    lockfile
                        .patched_dependencies
                        .ensure_total_capacity(rows.len())
                        .expect("unreachable");
                    for (key, value, _) in rows {
                        let Some(value) = value else {
                            continue;
                        };
                        let keyhash = semver::string::Builder::string_hash(key);
                        let patch_path = string_builder.append::<String>(value);
                        lockfile
                            .patched_dependencies
                            .put(keyhash, PatchedDep::with_path(patch_path))
                            .expect("unreachable");
                    }
                }
            }
        } else if FEATURES.is_workspace {
            if let Some(patched_deps) = json.as_property(b"patchedDependencies") {
                warn_ignored_patched_dependencies(log, source, patched_deps.loc);
            }
        }

        'bin: {
            if let Some(bin) = json.as_property(b"bin") {
                if let Some(rows) = JsonObjectStringRows::new(&bin.expr, &bump) {
                    // npm (normalize-package-bin) skips an entry whose value is not a string.
                    let mut entries = rows.filter_map(|(k, v, _)| Some((k, v?)));
                    match entries.clone().count() {
                        0 => {}
                        1 => {
                            let (bin_name, value) = entries.next().expect("counted: one entry");

                            self.bin = Bin {
                                tag: bin::Tag::NamedFile,
                                value: bin::Value::init_named_file([
                                    string_builder.append::<String>(bin_name),
                                    string_builder.append::<String>(value),
                                ]),
                                ..Default::default()
                            };
                        }
                        n => {
                            let current_len = lockfile.buffers.extern_strings.len();
                            let count = n * 2;
                            lockfile.buffers.extern_strings.reserve_exact(count);
                            let extern_strings = bun_core::vec::grow_default(
                                &mut lockfile.buffers.extern_strings,
                                count,
                            );

                            let mut i: usize = 0;
                            for (k, v) in entries {
                                extern_strings[i] = string_builder.append::<ExternalString>(k);
                                i += 1;
                                extern_strings[i] = string_builder.append::<ExternalString>(v);
                                i += 1;
                            }
                            debug_assert!(i == extern_strings.len());
                            self.bin = Bin {
                                tag: bin::Tag::Map,
                                value: bin::Value::init_map(ExternalStringList::new(
                                    current_len as u32,
                                    extern_strings.len() as u32,
                                )),
                                ..Default::default()
                            };
                        }
                    }

                    break 'bin;
                }
                if let ExprData::EString(stri) = &bin.expr.data {
                    if !stri.data.is_empty() {
                        self.bin = Bin {
                            tag: bin::Tag::File,
                            value: bin::Value::init_file(
                                string_builder.append::<String>(&stri.data),
                            ),
                            ..Default::default()
                        };
                        break 'bin;
                    }
                }
            }

            if let Some(dirs) = json.as_property(b"directories") {
                // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#directoriesbin
                // Because of the way the bin directive works,
                // specifying both a bin path and setting
                // directories.bin is an error. If you want to
                // specify individual files, use bin, and for all
                // the files in an existing bin directory, use
                // directories.bin.
                if let Some(bin_prop) = dirs.expr.as_property(b"bin") {
                    if let Some(str_) = bin_prop.expr.as_utf8(&bump) {
                        if !str_.is_empty() {
                            self.bin = Bin {
                                tag: bin::Tag::Dir,
                                value: bin::Value::init_dir(string_builder.append::<String>(str_)),
                                ..Default::default()
                            };
                            break 'bin;
                        }
                    }
                }
            }
        }

        self.scripts.parse_alloc(&mut string_builder, json);
        self.scripts.filled = true;

        // Root packages (the void resolver) keep has_install_script unset.
        if !resolver.is_void() {
            let has_scripts = self.scripts.has_any()
                || self.scripts.wants_default_node_gyp(
                    source.path.name().dir,
                    Some(scripts::gypfile_from_json(json)),
                );
            self.meta.set_has_install_script(has_scripts);
        }

        // It is allowed for duplicate dependencies to exist in optionalDependencies and regular dependencies
        if FEATURES.check_for_duplicate_dependencies {
            lockfile.scratch.duplicate_checker_map.clear();
            lockfile
                .scratch
                .duplicate_checker_map
                .reserve(total_dependencies_count as usize);
        }

        let mut bundled_deps = StringSet::init();
        let mut bundle_all_deps = false;
        if !resolver.is_void() && resolver.check_bundled_dependencies() {
            if let Some(bundled_deps_expr) = json
                .get(b"bundleDependencies")
                .or_else(|| json.get(b"bundledDependencies"))
            {
                match &bundled_deps_expr.data {
                    ExprData::EBoolean(boolean) => {
                        bundle_all_deps = boolean.value;
                    }
                    _ => {
                        if let Some(mut items) = bundled_deps_expr.as_array() {
                            while let Some(item) = items.next() {
                                let Some(s) = item.as_string(&bump) else {
                                    continue;
                                };
                                bundled_deps.insert(s)?;
                            }
                        }
                    }
                }
            }
        }

        if FEATURES.is_main {
            pm.workspace_root_name_hash = self.name_hash;
            let version = json.get(b"version").and_then(|v| v.as_utf8(&bump));
            pm.workspace_root_version = version.unwrap_or_default().into();
        }

        for group in &dependency_groups {
            if group.behavior.is_workspace() {
                let mut seen_workspace_names = StringSet::init();
                for (entry, path_) in workspace_names
                    .values()
                    .iter()
                    .zip(workspace_names.keys().iter())
                {
                    // workspace names from their package jsons. duplicates not allowed
                    if seen_workspace_names
                        .map
                        .get_or_put(&entry.name)?
                        .found_existing
                    {
                        // this path does alot of extra work to format the error message
                        // but this is ok because the install is going to fail anyways, so this
                        // has zero effect on the happy path.
                        let root_dir = workspace_map::package_json_dir(source);

                        let num_notes = 'count: {
                            let mut i: usize = 0;
                            for value in workspace_names.values() {
                                if strings::eql_long(&value.name, &entry.name, true) {
                                    i += 1;
                                }
                            }
                            break 'count i;
                        };
                        let notes = 'notes: {
                            let mut notes: Vec<bun_ast::Data> = Vec::with_capacity(num_notes);
                            let mut i: usize = 0;
                            for (value, note_path) in workspace_names
                                .values()
                                .iter()
                                .zip(workspace_names.keys().iter())
                            {
                                if note_path.as_ptr() == path_.as_ptr() {
                                    continue;
                                }
                                if strings::eql_long(&value.name, &entry.name, true) {
                                    let note_abs_path = bun_core::ZBox::from_bytes(
                                        resolve_path::join_abs_string_z::<path::platform::Auto>(
                                            root_dir,
                                            &[note_path, b"package.json"],
                                        )
                                        .as_bytes(),
                                    );

                                    let note_src = match bun_ast::to_source(
                                        &note_abs_path,
                                        Default::default(),
                                    ) {
                                        Ok(s) => s,
                                        Err(_) => bun_ast::Source::init_empty_file(
                                            note_abs_path.as_bytes(),
                                        ),
                                    };

                                    // `Location::init_or_null` borrows `file` from
                                    // `note_src.path.text`, which itself borrows
                                    // `note_abs_path`; both drop before the log is
                                    // printed. `Location::clone` deep-copies `file`
                                    // into a `Cow::Owned`.
                                    notes.push(bun_ast::Data {
                                        text: b"Package name is also declared here".to_vec().into(),
                                        location: bun_ast::Location::init_or_null(
                                            Some(&note_src),
                                            name_range_on_disk(&note_src),
                                        )
                                        .as_ref()
                                        .cloned(),
                                        ..Default::default()
                                    });
                                    i += 1;
                                }
                            }
                            notes.truncate(i);
                            break 'notes notes;
                        };

                        let abs_path = bun_core::ZBox::from_bytes(
                            resolve_path::join_abs_string_z::<path::platform::Auto>(
                                root_dir,
                                &[path_, b"package.json"],
                            )
                            .as_bytes(),
                        );

                        let src = match bun_ast::to_source(&abs_path, Default::default()) {
                            Ok(s) => s,
                            Err(_) => bun_ast::Source::init_empty_file(abs_path.as_bytes()),
                        };

                        let _ = log.add_range_error_fmt_with_notes(
                            Some(&src),
                            name_range_on_disk(&src),
                            notes.into(),
                            format_args!(
                                "Workspace name \"{}\" already exists",
                                bun_core::fmt::escape_control_chars(&entry.name),
                            ),
                        );
                        return Err(crate::Error::InstallFailed);
                    }

                    let external_name = string_builder.append::<ExternalString>(&entry.name);
                    // a property of the manifest, recorded whether or not the dependency
                    // edge below turns out to be new
                    if entry.hoisting_limits {
                        lockfile
                            .self_contained_workspaces
                            .put(external_name.hash, ())?;
                    }
                    lockfile.linked_members.see(path_, entry.is_behind_link);
                    if let Some(v) = &entry.unsupported_hoisting_limits {
                        log.add_warning_fmt(
                            Some(source),
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "workspace \"{}\": installConfig.hoistingLimits \"{}\" is not supported (only \"workspaces\" and \"none\" are); ignoring",
                                bstr::BStr::new(&entry.name),
                                bun_core::fmt::EscapeControlChars(bstr::BStr::new(v)),
                            ),
                        );
                    }

                    let workspace_version = 'brk: {
                        if let Some(version_string) = &entry.version {
                            let external_version =
                                string_builder.append::<ExternalString>(version_string);
                            let sliced = external_version
                                .value
                                .sliced(string_builder.string_bytes.as_slice());
                            let result = SemverVersion::parse(sliced);
                            if result.valid && result.wildcard == Wildcard::None {
                                break 'brk Some(result.version.min());
                            }
                        }

                        None
                    };

                    if let Some(dep_) = Self::parse_dependency(
                        &mut lockfile.workspace_paths,
                        &mut lockfile.workspace_versions,
                        &mut lockfile.linked_members,
                        &mut lockfile.scratch.duplicate_checker_map,
                        pm,
                        log,
                        source,
                        group,
                        &mut string_builder,
                        FEATURES,
                        package_dependencies.as_mut_slice(),
                        Some(dependency::version::Tag::Workspace),
                        workspace_version,
                        external_name,
                        path_,
                        bun_ast::Loc::EMPTY,
                    )? {
                        let mut dep = dep_;
                        if group.behavior.is_peer()
                            && optional_peer_dependencies.swap_remove(&external_name.hash)
                        {
                            dep.behavior = dep.behavior.add(Behavior::OPTIONAL);
                        }

                        // `parse_dependency` was called with `Tag::Workspace`,
                        // so the workspace accessor's tag-check holds.
                        let ws_path = *dep.version.workspace();
                        package_dependencies.push(dep);

                        lockfile.workspace_paths.put(external_name.hash, ws_path)?;
                        if let Some(version) = workspace_version {
                            lockfile
                                .workspace_versions
                                .put(external_name.hash, version)?;
                        }
                    }
                }
            } else {
                if let Some(dependencies_q) = json.as_property(group.prop) {
                    let rows = JsonObjectStringRows::new(&dependencies_q.expr, &bump)
                        .expect("validated above: a dependency group is an object");
                    for (key, version, key_loc) in rows {
                        let external_name = string_builder.append::<ExternalString>(key);
                        let version = version.unwrap_or(b"");

                        if let Some(dep_) = Self::parse_dependency(
                            &mut lockfile.workspace_paths,
                            &mut lockfile.workspace_versions,
                            &mut lockfile.linked_members,
                            &mut lockfile.scratch.duplicate_checker_map,
                            pm,
                            log,
                            source,
                            group,
                            &mut string_builder,
                            FEATURES,
                            package_dependencies.as_mut_slice(),
                            None,
                            None,
                            external_name,
                            version,
                            key_loc,
                        )? {
                            let mut dep = dep_;
                            if group.behavior.is_peer()
                                && (optional_peer_dependencies.swap_remove(&external_name.hash)
                                    || (!FEATURES.is_main
                                        && !FEATURES.is_workspace
                                        && key == b"bun"))
                            {
                                dep.behavior.insert(Behavior::OPTIONAL);
                            }

                            if bundle_all_deps
                                || bundled_deps.contains(
                                    dep.name.slice(string_builder.string_bytes.as_slice()),
                                )
                            {
                                dep.behavior.insert(Behavior::BUNDLED);
                            }

                            package_dependencies.push(dep);
                        }
                    }
                }
            }
        }

        // Anything left in `optional_peer_dependencies` was listed only in
        // `peerDependenciesMeta`. Synthesise an optional peer dep with
        // version `"*"` so resolution can pick up a sibling install when
        // one exists (matching pnpm/yarn). Webpack relies on this for
        // `webpack-cli`, which it lists in meta but not in
        // `peerDependencies`.
        let meta_only = optional_peer_dependencies.iterator();
        for entry in meta_only {
            let external_name = string_builder.append::<ExternalString>(*entry.value_ptr);
            if let Some(dep_) = Self::parse_dependency(
                &mut lockfile.workspace_paths,
                &mut lockfile.workspace_versions,
                &mut lockfile.linked_members,
                &mut lockfile.scratch.duplicate_checker_map,
                pm,
                log,
                source,
                &DependencyGroup::PEER,
                &mut string_builder,
                FEATURES,
                package_dependencies.as_mut_slice(),
                None,
                None,
                external_name,
                b"*",
                bun_ast::Loc::EMPTY,
            )? {
                let mut dep = dep_;
                dep.behavior.insert(Behavior::OPTIONAL);
                package_dependencies.push(dep);
            }
        }

        {
            let buf = string_builder.string_bytes.as_slice();
            index_sort::sort_slice_by(&mut package_dependencies, |a, b| Dependency::cmp(buf, a, b));
        }

        let new_len = off + package_dependencies.len();
        self.dependencies = DependencySlice::new(off as u32, package_dependencies.len() as u32);
        self.resolutions = PackageIDSlice::new(self.dependencies.off, self.dependencies.len);

        // Capacity for both was reserved above.
        debug_assert_eq!(lockfile.buffers.dependencies.len(), off);
        lockfile
            .buffers
            .resolutions
            .resize(new_len, invalid_package_id);
        lockfile
            .buffers
            .dependencies
            .append(&mut package_dependencies);

        // This function depends on package.dependencies being set, so it is done at the very end.
        if FEATURES.is_main {
            lockfile.overrides.parse_append(
                pm,
                lockfile.buffers.dependencies.as_slice(),
                self,
                log,
                source,
                &workspace_names,
                json,
                &mut string_builder,
            )?;

            let mut found_any_catalog_or_catalog_object = false;
            let mut has_workspaces = false;
            if let Some(workspaces_expr) = json.get(b"workspaces") {
                found_any_catalog_or_catalog_object = lockfile.catalogs.parse_append(
                    pm,
                    log,
                    source,
                    workspaces_expr,
                    &mut string_builder,
                )?;
                has_workspaces = true;
            }

            // `"workspaces"` being an object instead of an array is sometimes
            // unexpected to people. therefore if you also are using workspaces,
            // allow "catalog" and "catalogs" in top-level "package.json"
            // so it's easier to guess.
            if !found_any_catalog_or_catalog_object && has_workspaces {
                let _ =
                    lockfile
                        .catalogs
                        .parse_append(pm, log, source, json, &mut string_builder)?;
            }
            lockfile.overrides.warn_missing_catalog_entries(
                &lockfile.catalogs,
                string_builder.string_bytes.as_slice(),
                log,
                source,
                &json,
                has_workspaces,
            );
        }

        string_builder.clamp();
        Ok(())
    }
}

pub type List<SemverIntType> = MultiArrayList<Package<SemverIntType>>;

// ─── Serializer ──────────────────────────────────────────────────────────────

pub mod serializer {
    use super::*;
    use bun_io::Write as _;

    /// Number of columns in the on-disk package table.
    const FIELD_COUNT: usize = PackageField::ALL.len();

    pub(crate) fn save<SemverIntType: VersionInt>(
        list: &List<SemverIntType>,
        stream: &mut lockfile::bun_lockb::StreamType<'_>,
    ) -> crate::Result<()> {
        stream.write_int_le::<u64>(list.len() as u64)?;
        // The on-disk format records the alignment of the MultiArrayList
        // bytes *pointer* itself (not the pointee), which is exactly
        // `align_of::<*mut u8>()` on every supported target.
        stream.write_int_le::<u64>(mem::align_of::<*mut u8>() as u64)?;
        stream.write_int_le::<u64>(FIELD_COUNT as u64)?;
        let begin_at = stream.get_pos()?;
        stream.write_int_le::<u64>(0)?;
        let end_at = stream.get_pos()?;
        stream.write_int_le::<u64>(0)?;

        // `*mut u8` carries the pointer alignment, matching the
        // `@alignOf(@TypeOf(list.bytes))` value serialized above.
        let pos = stream.get_pos()? as u64;
        let _ = Aligner::write::<*mut u8, _>(&mut *stream, pos)?;

        let really_begin_at = stream.get_pos()?;
        let mut sliced = list.slice();

        for field in PackageField::ALL {
            // SAFETY: no other borrow of the column is live; it is only read, as raw bytes.
            let bytes: &[u8] = unsafe { &*sliced.column_bytes_mut(field as usize) };
            bun_output::scoped_log!(
                Lockfile,
                "save(\"{}\") = {} bytes",
                bstr::BStr::new(field.name()),
                bytes.len(),
            );
            // No uninitialized padding: `Package`'s field types are all
            // `#[repr(C)]` with explicit padding zeroed by their
            // `Default`/`init` paths.
            if matches!(field, PackageField::Resolution) {
                // copy each resolution to make sure the union is zero initialized
                let resolutions: &[Resolution<SemverIntType>] =
                    sliced.items::<"resolution", Resolution<SemverIntType>>();
                for val in resolutions {
                    // `ResolutionType::copy` builds a fresh zero-initialised
                    // `Resolution` and writes only the active union member.
                    // A bare `*val` would serialise
                    // garbage in the inactive union bytes (non-deterministic
                    // lockfile output).
                    let copy = val.copy();
                    // SAFETY: Resolution is #[repr(C)] POD; reading raw bytes is sound.
                    stream.write_all(unsafe {
                        bun_core::ffi::slice(
                            (&raw const copy).cast::<u8>(),
                            mem::size_of_val(&copy),
                        )
                    })?;
                }
            } else {
                stream.write_all(bytes)?;
            }
        }

        let really_end_at = stream.get_pos()?;

        let _ = stream.pwrite(&really_begin_at.to_ne_bytes(), begin_at);
        let _ = stream.pwrite(&really_end_at.to_ne_bytes(), end_at);
        Ok(())
    }

    #[derive(Default)]
    pub(crate) struct PackagesLoadResult<SemverIntType: VersionInt> {
        pub list: List<SemverIntType>,
        pub needs_update: bool,
        /// How far into `extern_strings` the `Map` bins reach.
        pub bin_map_end: usize,
    }

    // The v2-migration arm
    // below hard-codes `u32 → u64` (`VersionedURL.migrate()` returns `<u64>`).
    // The only caller (`bun.lockb.rs`) instantiates at `u64`, so bind concretely
    // instead of carrying a phantom generic that can't typecheck the migrate arm.
    pub(crate) fn load(
        stream: &mut Stream,
        end: usize,
        migrate_from_v2: bool,
    ) -> crate::Result<PackagesLoadResult<u64>> {
        type SemverIntType = u64;
        let reader = stream.reader();

        let list_len = reader.read_int_le::<u64>()?;
        if list_len > u32::MAX as u64 - 1 {
            return Err(crate::Error::LockfileValidationFailedListIsImpossiblyLong);
        }

        let input_alignment = reader.read_int_le::<u64>()?;

        let mut list = List::<SemverIntType>::default();

        // The recorded alignment is that of the MultiArrayList bytes
        // *pointer* itself, i.e. pointer alignment.
        let expected_alignment = mem::align_of::<*mut u8>() as u64;
        if expected_alignment != input_alignment {
            return Err(crate::Error::LockfileValidationFailedAlignmentMismatch);
        }

        let field_count = reader.read_int_le::<u64>()? as usize;
        match field_count {
            FIELD_COUNT => {}
            // "scripts" field is absent before v0.6.8
            // we will back-fill from each package.json
            n if n == FIELD_COUNT - 1 => {}
            _ => {
                return Err(crate::Error::LockfileValidationFailedUnexpectedNumberOfPackageFields);
            }
        }

        let begin_at = reader.read_int_le::<u64>()? as usize;
        let end_at = reader.read_int_le::<u64>()? as usize;
        if begin_at > end || end_at > end || begin_at > end_at {
            return Err(crate::Error::LockfileValidationFailedInvalidPackageListRange);
        }
        stream.pos = begin_at;
        list.ensure_total_capacity(list_len as usize)?;

        let mut needs_update = false;
        let mut bin_map_end = 0;
        if migrate_from_v2 {
            type OldPackageV2 = Package<u32>;
            let mut list_for_migrating_from_v2 = <List<u32>>::default();

            list_for_migrating_from_v2.ensure_total_capacity(list_len as usize)?;
            // SAFETY: capacity reserved above; `load_fields` writes every column.
            unsafe { list_for_migrating_from_v2.set_len(list_len as usize) };

            load_fields::<u32>(
                stream,
                end_at as u64,
                &mut list_for_migrating_from_v2,
                &mut needs_update,
                &mut bin_map_end,
            )?;

            for pkg_id in 0..list_for_migrating_from_v2.len() {
                let old: OldPackageV2 = *list_for_migrating_from_v2.get(pkg_id);
                let new = Package::<SemverIntType> {
                    name: old.name,
                    name_hash: old.name_hash,
                    meta: old.meta,
                    bin: old.bin,
                    dependencies: old.dependencies,
                    resolutions: old.resolutions,
                    scripts: old.scripts,
                    resolution: Resolution::init(match old.resolution.tag {
                        ResolutionTag::Root => TaggedValue::Root,
                        ResolutionTag::Npm => TaggedValue::Npm(old.resolution.npm().migrate()),
                        ResolutionTag::Folder => TaggedValue::Folder(*old.resolution.folder()),
                        ResolutionTag::LocalTarball => {
                            TaggedValue::LocalTarball(*old.resolution.local_tarball())
                        }
                        ResolutionTag::Github => TaggedValue::Github(*old.resolution.github()),
                        ResolutionTag::Git => TaggedValue::Git(*old.resolution.git()),
                        ResolutionTag::Symlink => TaggedValue::Symlink(*old.resolution.symlink()),
                        ResolutionTag::Workspace => {
                            TaggedValue::Workspace(*old.resolution.workspace())
                        }
                        ResolutionTag::RemoteTarball => {
                            TaggedValue::RemoteTarball(*old.resolution.remote_tarball())
                        }
                        _ => {
                            return Err(crate::Error::LockfileValidationFailedInvalidResolutionTag);
                        }
                    }),
                };

                list.append(new)?;
            }
        } else {
            // SAFETY: capacity reserved above; `load_fields` writes every column.
            unsafe { list.set_len(list_len as usize) };
            load_fields::<SemverIntType>(
                stream,
                end_at as u64,
                &mut list,
                &mut needs_update,
                &mut bin_map_end,
            )?;
        }

        Ok(PackagesLoadResult {
            list,
            needs_update,
            bin_map_end,
        })
    }

    fn load_fields<SemverIntType: VersionInt>(
        stream: &mut Stream,
        end_at: u64,
        list: &mut List<SemverIntType>,
        needs_update: &mut bool,
        bin_map_end: &mut usize,
    ) -> crate::Result<()> {
        let mut sliced = list.slice();

        for field in PackageField::ALL {
            // SAFETY: no other borrow of the column is live; the byte view is used solely
            // for memcpy from the serialised lockfile stream.
            let bytes: &mut [u8] = unsafe { sliced.column_bytes_mut(field as usize) };
            let end_pos = stream.pos + bytes.len();
            if end_pos as u64 <= end_at {
                let src = &stream.buffer[stream.pos..stream.pos + bytes.len()];
                if matches!(field, PackageField::Resolution) {
                    let stride = mem::size_of::<ResolutionType<SemverIntType>>();
                    let tag_at = mem::offset_of!(ResolutionType<SemverIntType>, tag);
                    debug_assert!(stride != 0 && src.len().is_multiple_of(stride));
                    for raw in src.chunks_exact(stride) {
                        if !ResolutionTag(raw[tag_at]).belongs_in_lockfile() {
                            return Err(crate::Error::LockfileValidationFailedInvalidResolutionTag);
                        }
                    }
                }
                if matches!(field, PackageField::Meta) {
                    // Same hardening as `Resolution` above: `Meta` embeds two
                    // `#[repr(u8)]` enums (`Origin` = 0..=2 and
                    // `HasInstallScript` = 0..=2). Copying an out-of-range byte
                    // into either field and reading it back as the enum would
                    // be immediate UB, so check the raw stream bytes first.
                    let stride = mem::size_of::<Meta>();
                    let origin_at = mem::offset_of!(Meta, origin);
                    let install_script_at = mem::offset_of!(Meta, has_install_script);
                    debug_assert!(stride != 0 && src.len().is_multiple_of(stride));
                    for raw in src.chunks_exact(stride) {
                        if !matches!(raw[origin_at], 0..=2)
                            || !matches!(raw[install_script_at], 0..=2)
                        {
                            return Err(crate::Error::LockfileValidationFailedInvalidPackageMeta);
                        }
                    }
                }
                if matches!(field, PackageField::Bin) {
                    // `Bin.tag` is a `#[repr(u8)]` enum with discriminants
                    // 0..=4; validate it the same way before the copy.
                    let stride = mem::size_of::<Bin>();
                    let tag_at = mem::offset_of!(Bin, tag);
                    let map_at = mem::offset_of!(Bin, value);
                    debug_assert!(stride != 0 && src.len().is_multiple_of(stride));
                    for raw in src.chunks_exact(stride) {
                        if !matches!(raw[tag_at], 0..=4) {
                            return Err(crate::Error::LockfileValidationFailedInvalidBinTag);
                        }
                        if raw[tag_at] == bin::Tag::Map as u8 {
                            // `(off, len)` of `[name, target]` pairs in `extern_strings`
                            let [off, len] = [map_at, map_at + 4].map(|at| {
                                u32::from_ne_bytes([raw[at], raw[at + 1], raw[at + 2], raw[at + 3]])
                            });
                            if len % 2 != 0 {
                                return Err(crate::Error::InvalidLockfile);
                            }
                            *bin_map_end = (*bin_map_end).max(off as usize + len as usize);
                        }
                    }
                }
                if matches!(field, PackageField::Scripts) {
                    // `Scripts.filled` is a `bool`; validate the raw byte the
                    // same way before the copy.
                    let stride = mem::size_of::<Scripts>();
                    let filled_at = mem::offset_of!(Scripts, filled);
                    debug_assert!(stride != 0 && src.len().is_multiple_of(stride));
                    for raw in src.chunks_exact(stride) {
                        if !matches!(raw[filled_at], 0 | 1) {
                            return Err(
                                crate::Error::LockfileValidationFailedInvalidPackageScripts,
                            );
                        }
                    }
                }
                bytes.copy_from_slice(src);
                stream.pos = end_pos;
                if matches!(field, PackageField::Meta) {
                    // need to check if any values were created from an older version of bun
                    // (currently just `has_install_script`). If any are found, the values need
                    // to be updated before saving the lockfile.
                    let metas: &[Meta] = sliced.items_mut::<"meta", Meta>();
                    *needs_update |= metas.iter().any(Meta::needs_update);
                }
            } else if matches!(field, PackageField::Scripts) {
                bytes.fill(0);
            } else {
                return Err(crate::Error::LockfileValidationFailedInvalidPackageListRange);
            }
        }
        Ok(())
    }
}

pub use serializer as Serializer;
