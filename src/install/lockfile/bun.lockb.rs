//! Binary lockfile (bun.lockb) serializer/deserializer.

use crate::lockfile::package::PackageColumns as _;
use core::mem::{align_of, size_of};

use super::PatchedDep;
use super::buffers::write_array;
use super::override_map::ScopedOverride;
use super::{
    FormatVersion, Lockfile, Scratch, Stream, StringPool, Tree, buffers, package,
    package_index as PackageIndex,
};
use crate::ALIGNMENT_BYTES_TO_REPEAT_BUFFER;
use crate::Error;
use crate::config_version::ConfigVersion;
use crate::dependency;
use crate::dependency::{Behavior, Dependency};
use crate::package_manager_real::Options as PackageManagerOptions;
use crate::resolution_real::Tag as ResolutionTag;
use bun_ast::Log;
use bun_collections::{ArrayHashMap, ArrayIdentityContextU64};
use bun_core::strings;
use bun_install::{PackageID, PackageManager, PackageNameAndVersionHash, PackageNameHash};
use bun_io::Write as _;
use bun_semver::{self as semver, String as SemverString};

const HEADER_BYTES: &[u8] = b"#!/usr/bin/env bun\nbun-lockfile-format-v0\n";

// Native-endian reinterpretation of 8 bytes as u64.
const HAS_PATCHED_DEPENDENCIES_TAG: u64 = u64::from_ne_bytes(*b"pAtChEdD");
const HAS_WORKSPACE_PACKAGE_IDS_TAG: u64 = u64::from_ne_bytes(*b"wOrKsPaC");
const HAS_TRUSTED_DEPENDENCIES_TAG: u64 = u64::from_ne_bytes(*b"tRuStEDd");
const HAS_EMPTY_TRUSTED_DEPENDENCIES_TAG: u64 = u64::from_ne_bytes(*b"eMpTrUsT");
const HAS_OVERRIDES_TAG: u64 = u64::from_ne_bytes(*b"oVeRriDs");
const HAS_CATALOGS_TAG: u64 = u64::from_ne_bytes(*b"cAtAlOgS");
const HAS_CONFIG_VERSION_TAG: u64 = u64::from_ne_bytes(*b"cNfGvRsN");
const HAS_SCOPED_OVERRIDES_TAG: u64 = u64::from_ne_bytes(*b"sCoPdOvR");
const HAS_PACKAGE_EXTENSIONS_TAG: u64 = u64::from_ne_bytes(*b"pKgExTnS");

/// Wraps a growing `Vec<u8>` to provide both positional-write semantics
/// (`get_pos`/`pwrite`) and append semantics (`write_all`/`write_int_*`) for
/// `Lockfile.Package.Serializer.save` / `Lockfile.Buffers.save`.
pub(crate) struct StreamType<'a> {
    pub bytes: &'a mut Vec<u8>,
}

impl<'a> StreamType<'a> {
    #[inline]
    pub(crate) fn get_pos(&self) -> Result<usize, Error> {
        Ok(self.bytes.len())
    }

    pub(crate) fn pwrite(&mut self, data: &[u8], index: usize) -> usize {
        self.bytes[index..index + data.len()].copy_from_slice(data);
        data.len()
    }

    #[inline]
    pub(crate) fn write_all(&mut self, data: &[u8]) -> Result<(), Error> {
        self.bytes.extend_from_slice(data);
        Ok(())
    }
}

impl<'a> bun_io::Write for StreamType<'a> {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> bun_io::Result<()> {
        self.bytes.extend_from_slice(buf);
        Ok(())
    }
}

// Section header strings, byte-for-byte as historical writers emitted them.
// The reader skips these by absolute offset (see `buffers::read_array`),
// so they are semantically inert; we match the historical bytes only so that
// re-saving an unchanged lockfile is a no-op.
//
// Primitive-type tags (`u64`, `u32`, `[26]u8`) are stable. Struct-type tags have
// already drifted across format revisions (`src.install.lockfile.Tree`
// → `install.lockfile.Tree`), so for `Version`/`String`/`PatchedDep` — which no
// checked-in fixture exercises — we emit the most recent decl path; the const
// asserts below catch any size/align drift even if the name is later wrong.
const PREFIX_U64: &str = "\n<u64> 8 sizeof, 8 alignof\n";
const PREFIX_U32: &str = "\n<u32> 4 sizeof, 4 alignof\n";
const PREFIX_DEP_EXTERNAL: &str = "\n<[26]u8> 26 sizeof, 1 alignof\n";
const PREFIX_SEMVER_VERSION: &str = "\n<semver.Version.Version> 56 sizeof, 8 alignof\n";
const PREFIX_SEMVER_STRING: &str = "\n<semver.String> 8 sizeof, 1 alignof\n";
const PREFIX_PATCHED_DEP: &str = "\n<install.lockfile.PatchedDep> 24 sizeof, 8 alignof\n";

const _: () = {
    assert!(size_of::<PackageNameHash>() == 8 && align_of::<PackageNameHash>() == 8);
    assert!(size_of::<PackageNameAndVersionHash>() == 8);
    assert!(size_of::<dependency::External>() == 26 && align_of::<dependency::External>() == 1);
    assert!(size_of::<semver::Version>() == 56 && align_of::<semver::Version>() == 8);
    assert!(size_of::<SemverString>() == 8 && align_of::<SemverString>() == 1);
    assert!(size_of::<PatchedDep>() == 24 && align_of::<PatchedDep>() == 8);
};

/// On-disk layout of `PatchedDep` with the `bool` flag widened to `u8`.
///
/// `read_array` reinterprets untrusted lockfile bytes as `T`, and
/// `PatchedDep::patchfile_hash_is_null` is a `bool` whose only valid byte
/// values are 0 and 1 — reinterpreting any other byte is immediate UB. Read
/// this invariant-free form instead and validate the flag before constructing
/// the real `PatchedDep`.
#[repr(C)]
#[derive(Clone, Copy)]
struct PatchedDepExternal {
    path: SemverString,
    _padding: [u8; 7],
    patchfile_hash_is_null: u8,
    patchfile_hash: u64,
}

const _: () = {
    assert!(size_of::<PatchedDepExternal>() == size_of::<PatchedDep>());
    assert!(align_of::<PatchedDepExternal>() == align_of::<PatchedDep>());
};

impl PatchedDepExternal {
    fn to_patched_dep(self) -> Result<PatchedDep, Error> {
        let mut dep = PatchedDep::with_path(self.path);
        dep.set_patchfile_hash(match self.patchfile_hash_is_null {
            0 => Some(self.patchfile_hash),
            1 => None,
            _ => return Err(crate::Error::InvalidLockfile),
        });
        Ok(dep)
    }
}

fn write_dependencies<'a>(
    stream: &mut StreamType<'_>,
    dependencies: impl Iterator<Item = &'a Dependency>,
) -> Result<(), Error> {
    let externals: Vec<dependency::External> = dependencies.map(dependency::to_external).collect();
    write_array(stream, &externals, PREFIX_DEP_EXTERNAL)
}

pub(crate) fn save(
    this: &mut Lockfile,
    options: &PackageManagerOptions,
    config_version: ConfigVersion,
    bytes: &mut Vec<u8>,
    total_size: &mut usize,
    end_pos: &mut usize,
) -> Result<(), Error> {
    let mut stream = StreamType { bytes };

    stream.write_all(HEADER_BYTES)?;
    stream.write_int_le::<u32>(this.format.0)?;

    stream.write_all(&this.meta_hash)?;

    *end_pos = stream.get_pos()?;
    stream.write_int_le(0u64)?;

    if cfg!(debug_assertions) {
        for res in this.packages.items_resolution() {
            let path = match res.tag {
                ResolutionTag::Folder => res.folder(),
                ResolutionTag::Symlink => res.symlink(),
                ResolutionTag::LocalTarball => res.local_tarball(),
                ResolutionTag::Workspace => res.workspace(),
                _ => continue,
            };
            debug_assert!(!strings::contains_char(
                this.str(path),
                bun_paths::SEP_WINDOWS
            ));
        }
    }

    package::serializer::save(&this.packages, &mut stream)?;
    buffers::save(this, options, &mut stream)?;
    stream.write_int_le(0u64)?;

    // < Bun v1.0.4 stopped right here when reading the lockfile
    // So we add an extra 8 byte tag to say "hey, there's more data here"
    if this.workspace_versions.count() > 0 {
        stream.write_all(&HAS_WORKSPACE_PACKAGE_IDS_TAG.to_ne_bytes())?;

        // We need to track the "version" field in "package.json" of workspace member packages
        // We do not necessarily have that in the Resolution struct. So we store it here.
        write_array(&mut stream, this.workspace_versions.keys(), PREFIX_U64)?;
        write_array(
            &mut stream,
            this.workspace_versions.values(),
            PREFIX_SEMVER_VERSION,
        )?;

        write_array(&mut stream, this.workspace_paths.keys(), PREFIX_U64)?;
        write_array(
            &mut stream,
            this.workspace_paths.values(),
            PREFIX_SEMVER_STRING,
        )?;
    }

    if let Some(trusted_dependencies) = &this.trusted_dependencies {
        if trusted_dependencies.count() > 0 {
            stream.write_all(&HAS_TRUSTED_DEPENDENCIES_TAG.to_ne_bytes())?;

            write_array(&mut stream, trusted_dependencies.keys(), PREFIX_U32)?;
        } else {
            stream.write_all(&HAS_EMPTY_TRUSTED_DEPENDENCIES_TAG.to_ne_bytes())?;
        }
    }

    if this.overrides.map.count() > 0 {
        stream.write_all(&HAS_OVERRIDES_TAG.to_ne_bytes())?;

        write_array(&mut stream, this.overrides.map.keys(), PREFIX_U64)?;
        write_dependencies(&mut stream, this.overrides.map.values().iter())?;
    }

    if this.patched_dependencies.count() > 0 {
        stream.write_all(&HAS_PATCHED_DEPENDENCIES_TAG.to_ne_bytes())?;

        write_array(&mut stream, this.patched_dependencies.keys(), PREFIX_U64)?;
        write_array(
            &mut stream,
            this.patched_dependencies.values(),
            PREFIX_PATCHED_DEP,
        )?;
    }

    if this.catalogs.has_any() {
        stream.write_all(&HAS_CATALOGS_TAG.to_ne_bytes())?;

        write_array(
            &mut stream,
            this.catalogs.default.keys(),
            PREFIX_SEMVER_STRING,
        )?;
        write_dependencies(&mut stream, this.catalogs.default.values().iter())?;

        write_array(
            &mut stream,
            this.catalogs.groups.keys(),
            PREFIX_SEMVER_STRING,
        )?;
        for catalog_deps in this.catalogs.groups.values() {
            write_array(&mut stream, catalog_deps.keys(), PREFIX_SEMVER_STRING)?;
            write_dependencies(&mut stream, catalog_deps.values().iter())?;
        }
    }

    stream.write_all(&HAS_CONFIG_VERSION_TAG.to_ne_bytes())?;
    stream.write_int_le::<u64>(config_version as u64)?;

    if this.overrides.has_scoped() {
        stream.write_all(&HAS_SCOPED_OVERRIDES_TAG.to_ne_bytes())?;

        let scoped = &this.overrides.scoped;
        let no_parent = Dependency::default();
        let parents = scoped
            .iter()
            .map(|rule| rule.parent.as_ref().unwrap_or(&no_parent));
        write_dependencies(&mut stream, parents)?;

        let ranges: Vec<Dependency> = (scoped.iter())
            .map(|rule| Dependency {
                name: rule.dep.name,
                name_hash: rule.dep.name_hash,
                version: rule.target_range.clone(),
                behavior: Behavior::default(),
            })
            .collect();
        write_dependencies(&mut stream, ranges.iter())?;
        write_dependencies(&mut stream, scoped.iter().map(|rule| &rule.dep))?;
    }

    if !this.package_extensions.applied.is_empty() {
        stream.write_all(&HAS_PACKAGE_EXTENSIONS_TAG.to_ne_bytes())?;
        write_array(
            &mut stream,
            &this.package_extensions.applied_words(),
            PREFIX_U64,
        )?;
    }

    *total_size = stream.get_pos()?;

    stream.write_all(&ALIGNMENT_BYTES_TO_REPEAT_BUFFER)?;

    Ok(())
}

#[derive(Default)]
pub struct SerializerLoadResult {
    pub packages_need_update: bool,
    pub(crate) migrated_from_lockb_v2: bool,
}

/// Consumes the next 8 bytes if they're `tag`, which marks a section that older versions neither
/// write nor read.
fn next_section_is(stream: &mut Stream, total_buffer_size: u64, tag: u64) -> Result<bool, Error> {
    if total_buffer_size.saturating_sub(stream.pos as u64) <= 8 {
        return Ok(false);
    }
    if stream.read_int_le::<u64>()? == tag {
        return Ok(true);
    }
    stream.pos -= 8;
    Ok(false)
}

fn fill_map<V: Copy>(
    map: &mut ArrayHashMap<PackageNameHash, V, ArrayIdentityContextU64>,
    keys: &[PackageNameHash],
    values: &[V],
) -> Result<(), Error> {
    if keys.len() != values.len() {
        return Err(crate::Error::InvalidLockfile);
    }
    map.ensure_total_capacity(values.len())?;
    // SAFETY: capacity reserved above; both columns are fully
    // overwritten by `copy_from_slice` before `re_index` reads them.
    unsafe { map.set_entries_len(values.len()) };
    map.keys_mut().copy_from_slice(keys);
    map.values_mut().copy_from_slice(values);
    map.re_index()?;
    Ok(())
}

pub(crate) fn load(
    lockfile: &mut Lockfile,
    stream: &mut Stream,
    log: &mut Log,
    manager: Option<&PackageManager>,
) -> Result<SerializerLoadResult, Error> {
    let mut res = SerializerLoadResult::default();
    let mut header_buf_: [u8; HEADER_BYTES.len()] = [0; HEADER_BYTES.len()];
    let n = stream.read_all(&mut header_buf_)?;
    let header_buf = &header_buf_[..n];

    if header_buf != HEADER_BYTES {
        return Err(crate::Error::InvalidLockfile);
    }

    let mut migrate_from_v2 = false;
    let format = stream.read_int_le::<u32>()?;
    if format > FormatVersion::current().0 {
        return Err(crate::Error::UnexpectedLockfileVersion);
    }

    if format < FormatVersion::current().0 {
        // we only allow migrating from v2 to v3 or above
        if format != FormatVersion::V2.0 {
            return Err(crate::Error::OutdatedLockfileVersion);
        }

        migrate_from_v2 = true;
    }

    lockfile.format = FormatVersion::current();

    let _ = stream.read_all(&mut lockfile.meta_hash)?;

    let total_buffer_size = stream.read_int_le::<u64>()?;
    if total_buffer_size > stream.buffer.len() as u64 {
        return Err(crate::Error::LockfileIsMissingData);
    }

    let packages_load_result =
        package::serializer::load(stream, total_buffer_size as usize, migrate_from_v2)?;

    lockfile.packages = packages_load_result.list;

    res.packages_need_update = packages_load_result.needs_update;
    res.migrated_from_lockb_v2 = migrate_from_v2;

    lockfile.buffers = buffers::load(stream, log, manager, lockfile.packages.len())?;
    if stream.read_int_le::<u64>()? != 0 {
        return Err(crate::Error::LockfileIsMalformedExpected0AtTheEnd);
    }

    if packages_load_result.bin_map_end > lockfile.buffers.extern_strings.len()
        || !ids_and_windows_are_in_range(lockfile)
    {
        return Err(crate::Error::InvalidLockfile);
    }

    // `name_hash` is derived from `name`. Recompute it, as loading `bun.lock` does.
    {
        let string_bytes = lockfile.buffers.string_bytes.as_slice();
        let package::PackageColumnsMut {
            name: names,
            name_hash: name_hashes,
            ..
        } = lockfile.packages.split_mut();
        for (name, name_hash) in names.iter().zip(name_hashes.iter_mut()) {
            *name_hash = semver::string::Builder::string_hash(name.slice(string_bytes));
        }
    }

    // < Bun v1.0.4 stopped right here when reading the lockfile
    // So we add an extra 8 byte tag to say "hey, there's more data here"
    if next_section_is(stream, total_buffer_size, HAS_WORKSPACE_PACKAGE_IDS_TAG)? {
        let name_hashes: Vec<PackageNameHash> = buffers::read_array(stream)?;
        let versions: Vec<semver::Version> = if migrate_from_v2 {
            let old_versions: Vec<semver::VersionType<u32>> = buffers::read_array(stream)?;
            old_versions.iter().map(|old| old.migrate()).collect()
        } else {
            buffers::read_array(stream)?
        };
        fill_map(&mut lockfile.workspace_versions, &name_hashes, &versions)?;

        let name_hashes: Vec<PackageNameHash> = buffers::read_array(stream)?;
        let paths: Vec<SemverString> = buffers::read_array(stream)?;
        fill_map(&mut lockfile.workspace_paths, &name_hashes, &paths)?;
    }

    {
        let remaining_in_buffer = total_buffer_size.saturating_sub(stream.pos as u64);

        // >= because `has_empty_trusted_dependencies_tag` is tag only
        if remaining_in_buffer >= 8 {
            let next_num = stream.read_int_le::<u64>()?;
            if remaining_in_buffer > 8 && next_num == HAS_TRUSTED_DEPENDENCIES_TAG {
                let trusted_dependencies_hashes: Vec<u32> = buffers::read_array(stream)?;

                let td = lockfile.trusted_dependencies.insert(Default::default());
                td.ensure_total_capacity(trusted_dependencies_hashes.len())?;
                // The binary lockfile only stores the truncated hashes, not the
                // names they were computed from. The empty value is the
                // "name unknown, hash-only match" sentinel.
                for &hash in &trusted_dependencies_hashes {
                    td.put_assume_capacity(hash, Box::<[u8]>::default());
                }
            } else if next_num == HAS_EMPTY_TRUSTED_DEPENDENCIES_TAG {
                // trusted dependencies exists in package.json but is an empty array.
                lockfile.trusted_dependencies = Some(Default::default());
            } else {
                stream.pos -= 8;
            }
        }
    }

    if next_section_is(stream, total_buffer_size, HAS_OVERRIDES_TAG)? {
        let overrides_name_hashes: Vec<PackageNameHash> = buffers::read_array(stream)?;

        lockfile
            .overrides
            .map
            .ensure_total_capacity(overrides_name_hashes.len())?;
        let override_versions_external: Vec<dependency::External> = buffers::read_array(stream)?;
        let mut context = dependency::Context {
            log: &mut *log,
            buffer: lockfile.buffers.string_bytes.as_slice(),
        };
        debug_assert_eq!(
            overrides_name_hashes.len(),
            override_versions_external.len()
        );
        for (name, value) in overrides_name_hashes
            .iter()
            .zip(override_versions_external.iter())
        {
            let value = dependency::to_dependency(*value, &mut context);
            lockfile.overrides.map.put_assume_capacity(*name, value);
        }
    }

    if next_section_is(stream, total_buffer_size, HAS_PATCHED_DEPENDENCIES_TAG)? {
        let patched_dependencies_name_and_version_hashes: Vec<PackageNameAndVersionHash> =
            buffers::read_array(stream)?;

        let map = &mut lockfile.patched_dependencies;

        map.ensure_total_capacity(patched_dependencies_name_and_version_hashes.len())?;
        let patched_dependencies_paths: Vec<PatchedDepExternal> = buffers::read_array(stream)?;

        debug_assert_eq!(
            patched_dependencies_name_and_version_hashes.len(),
            patched_dependencies_paths.len()
        );
        for (name_hash, patch_path) in patched_dependencies_name_and_version_hashes
            .iter()
            .zip(patched_dependencies_paths.iter())
        {
            map.put_assume_capacity(*name_hash, patch_path.to_patched_dep()?);
        }
    }

    if next_section_is(stream, total_buffer_size, HAS_CATALOGS_TAG)? {
        lockfile.catalogs = Default::default();

        let default_dep_names: Vec<SemverString> = buffers::read_array(stream)?;

        let default_deps: Vec<dependency::External> = buffers::read_array(stream)?;

        let Lockfile {
            buffers, catalogs, ..
        } = &mut *lockfile;
        let string_bytes: &[u8] = buffers.string_bytes.as_slice();

        catalogs.default.ensure_total_capacity(default_deps.len())?;

        let str_ctx = semver::string::ArrayHashContext {
            arg_buf: string_bytes,
            existing_buf: string_bytes,
        };
        let mut context = dependency::Context {
            log: &mut *log,
            buffer: string_bytes,
        };

        debug_assert_eq!(default_dep_names.len(), default_deps.len());
        for (dep_name, dep) in default_dep_names.iter().zip(default_deps.iter()) {
            let value = dependency::to_dependency(*dep, &mut context);
            catalogs.default.put_assume_capacity_context(
                *dep_name,
                value,
                |k| str_ctx.hash(*k),
                |a, b, i| str_ctx.eql(*a, *b, i),
            );
        }

        let catalog_names: Vec<SemverString> = buffers::read_array(stream)?;

        catalogs.groups.ensure_total_capacity(catalog_names.len())?;

        for catalog_name in &catalog_names {
            let catalog_dep_names: Vec<SemverString> = buffers::read_array(stream)?;

            let catalog_deps: Vec<dependency::External> = buffers::read_array(stream)?;

            let group = catalogs.get_or_put_group(string_bytes, *catalog_name)?;
            group.ensure_total_capacity(catalog_deps.len())?;

            debug_assert_eq!(catalog_dep_names.len(), catalog_deps.len());
            for (dep_name, dep) in catalog_dep_names.iter().zip(catalog_deps.iter()) {
                let value = dependency::to_dependency(*dep, &mut context);
                group.put_assume_capacity_context(
                    *dep_name,
                    value,
                    |k| str_ctx.hash(*k),
                    |a, b, i| str_ctx.eql(*a, *b, i),
                );
            }
        }
    }

    if next_section_is(stream, total_buffer_size, HAS_CONFIG_VERSION_TAG)? {
        let Some(config_version) = ConfigVersion::from_int(stream.read_int_le::<u64>()?) else {
            return Err(crate::Error::InvalidLockfile);
        };
        lockfile.saved_config_version = Some(config_version);
    }

    if next_section_is(stream, total_buffer_size, HAS_SCOPED_OVERRIDES_TAG)? {
        let parents: Vec<dependency::External> = buffers::read_array(stream)?;
        let ranges: Vec<dependency::External> = buffers::read_array(stream)?;
        let deps: Vec<dependency::External> = buffers::read_array(stream)?;
        debug_assert_eq!(parents.len(), ranges.len());
        debug_assert_eq!(parents.len(), deps.len());

        let Lockfile {
            buffers, overrides, ..
        } = &mut *lockfile;
        let string_bytes: &[u8] = buffers.string_bytes.as_slice();
        overrides.scoped.reserve(parents.len());
        let mut context = dependency::Context {
            log: &mut *log,
            buffer: string_bytes,
        };
        for ((parent, range), dep) in parents.iter().zip(ranges.iter()).zip(deps.iter()) {
            let parent = dependency::to_dependency(*parent, &mut context);
            let rule = ScopedOverride {
                parent: (!parent.name.is_empty()).then_some(parent),
                target_range: dependency::to_dependency(*range, &mut context).version,
                dep: dependency::to_dependency(*dep, &mut context),
            };
            overrides.push_scoped(rule, string_bytes);
        }
    }

    if next_section_is(stream, total_buffer_size, HAS_PACKAGE_EXTENSIONS_TAG)? {
        let words: Vec<u64> = buffers::read_array(stream)?;
        lockfile.package_extensions.set_applied_words(&words);
    }

    lockfile.scratch = Scratch::init();
    lockfile.package_index = PackageIndex::Map::default();
    lockfile.string_pool = StringPool::default();
    lockfile
        .package_index
        .ensure_total_capacity(lockfile.packages.len())?;

    for id in 0..lockfile.packages.len() {
        let name_hash = lockfile.packages.items_name_hash()[id];
        let resolution = lockfile.packages.items_resolution()[id];
        lockfile.get_or_put_id(id as PackageID, name_hash)?;

        if matches!(resolution.tag, ResolutionTag::Git | ResolutionTag::Github) {
            let resolved = lockfile.str(&resolution.repository().resolved);
            if !resolved.is_empty() && !crate::repository::is_safe_resolved_tag(resolved) {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Invalid git dependency tag \"{}\" in bun.lockb",
                        bun_core::fmt::escape_control_chars(resolved)
                    ),
                );
                return Err(crate::Error::InvalidLockfile);
            }
        }

        // compatibility with < Bun v1.0.4
        if resolution.tag == ResolutionTag::Workspace {
            lockfile
                .workspace_paths
                .put(name_hash, *resolution.workspace())?;
        }
    }

    Ok(res)
}

/// Everything after the load indexes with these unchecked. Not `String`s: `slice` checks them.
fn ids_and_windows_are_in_range(lockfile: &mut Lockfile) -> bool {
    let packages_len = lockfile.packages.len();
    let dependencies_len = lockfile.buffers.dependencies.len();
    // One dependency id indexes both `dependencies` and `resolutions`.
    if lockfile.buffers.resolutions.len() != dependencies_len {
        return false;
    }
    for (package_id, dependency) in
        (lockfile.buffers.resolutions.iter_mut()).zip(lockfile.buffers.dependencies.iter())
    {
        if *package_id as usize >= packages_len && *package_id != crate::invalid_package_id {
            // Writers before v0.6.11 left the id of a peer they did not resolve uninitialized.
            if !dependency.behavior.is_peer() {
                return false;
            }
            *package_id = crate::invalid_package_id;
        }
    }

    let packages = &lockfile.packages;
    let buffers = &lockfile.buffers;
    let hoisted_len = buffers.hoisted_dependencies.len();
    let fits = |off: u32, len: u32, buffer_len: usize| off as usize + len as usize <= buffer_len;

    (packages.items_resolution().first()).is_some_and(|root| root.tag == ResolutionTag::Root)
        && (packages.items_meta().iter().enumerate()).all(|(id, meta)| meta.id as usize == id)
        && (packages.items_dependencies().iter())
            .zip(packages.items_resolutions())
            .all(|(dependencies, resolutions)| {
                fits(dependencies.off, dependencies.len, dependencies_len)
                    && fits(resolutions.off, resolutions.len, dependencies_len)
                    && resolutions.len == dependencies.len
                    && (resolutions.off == dependencies.off || dependencies.len == 0)
            })
        // Their names are joined into paths; only an install hoists again, which checks them.
        && buffers.hoisted_dependencies.iter().all(|&id| {
            (buffers.dependencies.get(id as usize)).is_some_and(|row| {
                dependency::is_safe_install_folder_name(row.name.slice(&buffers.string_bytes))
            })
        })
        // A tree follows its parent, which rules out cycles.
        && buffers.trees.iter().enumerate().all(|(position, tree)| {
            tree.id as usize == position
                && fits(tree.dependencies.off, tree.dependencies.len, hoisted_len)
                && if position == 0 {
                    tree.parent == Tree::INVALID_ID
                } else {
                    (tree.parent as usize) < position
                        && (tree.dependency_id as usize) < dependencies_len
                }
        })
}
