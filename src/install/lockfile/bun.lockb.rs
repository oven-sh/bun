//! Binary lockfile (bun.lockb) serializer/deserializer.

use crate::lockfile::package::PackageColumns as _;
use core::mem::{align_of, size_of};

use crate::Error;
use bun_io::Write as _;
// `Lockfile`/`Stream`/`StringPool`/`package_index` live in the parent
// `lockfile_real` module (this file is `lockfile_real::bun_lockb`). The
// `bun_install::lockfile::*` path is the stub surface and lacks these items.
use super::PatchedDep;
use super::{
    FormatVersion, Lockfile, Scratch, Stream, StringPool, buffers, package,
    package_index as PackageIndex,
};
use crate::ALIGNMENT_BYTES_TO_REPEAT_BUFFER;
use crate::config_version::ConfigVersion;
use crate::dependency;
use crate::package_manager_real::Options as PackageManagerOptions;
use crate::resolution_real::Tag as ResolutionTag;
use bun_ast::Log;
use bun_core::strings;
use bun_install::{PackageID, PackageManager, PackageNameAndVersionHash, PackageNameHash};
use bun_semver::{self as semver, String as SemverString};

// Serialized padding bytes must be deterministic; the per-field
// save path zeroes padding explicitly (see the note in `save` and the
// `assert_no_uninitialized_padding` invariant in `Package::Serializer`).

pub const VERSION: &[u8] = b"bun-lockfile-format-v0\n";
const HEADER_BYTES: &[u8] = b"#!/usr/bin/env bun\nbun-lockfile-format-v0\n";

// Native-endian reinterpretation of 8 bytes as u64.
const HAS_PATCHED_DEPENDENCIES_TAG: u64 = u64::from_ne_bytes(*b"pAtChEdD");
const HAS_WORKSPACE_PACKAGE_IDS_TAG: u64 = u64::from_ne_bytes(*b"wOrKsPaC");
const HAS_TRUSTED_DEPENDENCIES_TAG: u64 = u64::from_ne_bytes(*b"tRuStEDd");
const HAS_EMPTY_TRUSTED_DEPENDENCIES_TAG: u64 = u64::from_ne_bytes(*b"eMpTrUsT");
const HAS_OVERRIDES_TAG: u64 = u64::from_ne_bytes(*b"oVeRriDs");
const HAS_CATALOGS_TAG: u64 = u64::from_ne_bytes(*b"cAtAlOgS");
const HAS_CONFIG_VERSION_TAG: u64 = u64::from_ne_bytes(*b"cNfGvRsN");

/// Wraps a growing `Vec<u8>` to provide both positional-write semantics
/// (`get_pos`/`pwrite`) and append semantics (`write_all`/`write_int_*`) for
/// `Lockfile.Package.Serializer.save` / `Lockfile.Buffers.save`.
///
/// A separate `stream` and `writer` over the same `bytes` would be two
/// aliased `&mut`s, so both roles are collapsed into a single type and
/// callers pass exactly one `&mut StreamType`.
///
/// LIFETIMES.tsv: `bytes` is BORROW_PARAM → `&'a mut Vec<u8>`.
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

#[inline]
fn write_array<T>(
    stream: &mut StreamType<'_>,
    array: &[T],
    prefix: &'static str,
) -> Result<(), Error> {
    buffers::write_array(stream, array, prefix)
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

/// Bridges `bun_semver::string::ArrayHashContext` (inherent `hash`/`eql`) to
/// `bun_collections::ArrayHashAdapter` so `get_or_put_adapted` can use it.
/// Can't `impl` the foreign trait for the foreign type directly (orphan rule).
struct StringCtxAdapter<'a, 'b>(&'b semver::string::ArrayHashContext<'a>);

impl<'a, 'b> bun_collections::array_hash_map::ArrayHashAdapter<SemverString, SemverString>
    for StringCtxAdapter<'a, 'b>
{
    #[inline]
    fn hash(&self, key: &SemverString) -> u32 {
        self.0.hash(*key)
    }
    #[inline]
    fn eql(&self, a: &SemverString, b: &SemverString, b_index: usize) -> bool {
        self.0.eql(*a, *b, b_index)
    }
}

pub fn save(
    this: &mut Lockfile,
    options: &PackageManagerOptions,
    bytes: &mut Vec<u8>,
    total_size: &mut usize,
    end_pos: &mut usize,
) -> Result<(), Error> {
    // No defensive clone of `packages` is needed for byte-exact serialization:
    // the per-field writers below already zero-pad via the
    // `assert_no_uninitialized_padding` invariant.

    // `writer` and `stream` roles are collapsed into a single `StreamType`.
    let mut stream = StreamType { bytes };

    stream.write_all(HEADER_BYTES)?;
    stream.write_int_le::<u32>(this.format.0)?;

    stream.write_all(&this.meta_hash)?;

    *end_pos = stream.get_pos()?;
    stream.write_int_le(0u64)?;

    if cfg!(debug_assertions) {
        for res in this.packages.items_resolution() {
            match res.tag {
                ResolutionTag::Folder => {
                    debug_assert!(
                        strings::index_of_char(this.str(res.folder()), bun_paths::SEP_WINDOWS,)
                            .is_none()
                    );
                }
                ResolutionTag::Symlink => {
                    debug_assert!(
                        strings::index_of_char(this.str(res.symlink()), bun_paths::SEP_WINDOWS,)
                            .is_none()
                    );
                }
                ResolutionTag::LocalTarball => {
                    debug_assert!(
                        strings::index_of_char(
                            this.str(res.local_tarball()),
                            bun_paths::SEP_WINDOWS,
                        )
                        .is_none()
                    );
                }
                ResolutionTag::Workspace => {
                    debug_assert!(
                        strings::index_of_char(this.str(res.workspace()), bun_paths::SEP_WINDOWS,)
                            .is_none()
                    );
                }
                _ => {}
            }
        }
    }

    // The callees take a single `&mut S: PositionalStream + bun_io::Write` (both
    // roles collapsed onto `StreamType`) — two `&mut` aliases of one object would
    // be UB regardless of access order.
    // turbofish — `this.packages` is `PackageList = List<u64>`, but
    // inference through `MultiArrayList<Package<_>>` is brittle when sibling
    // generic types in the crate have errors. Pin SemverIntType explicitly.
    package::serializer::save::<u64, _>(&this.packages, &mut stream)?;
    buffers::save(this, options, &mut stream)?;
    stream.write_int_le(0u64)?;

    // < Bun v1.0.4 stopped right here when reading the lockfile
    // So we add an extra 8 byte tag to say "hey, there's more data here"
    if this.workspace_versions.count() > 0 {
        stream.write_all(&HAS_WORKSPACE_PACKAGE_IDS_TAG.to_ne_bytes())?;

        // We need to track the "version" field in "package.json" of workspace member packages
        // We do not necessarily have that in the Resolution struct. So we store it here.
        write_array::<PackageNameHash>(&mut stream, this.workspace_versions.keys(), PREFIX_U64)?;
        write_array::<semver::Version>(
            &mut stream,
            this.workspace_versions.values(),
            PREFIX_SEMVER_VERSION,
        )?;

        write_array::<PackageNameHash>(&mut stream, this.workspace_paths.keys(), PREFIX_U64)?;
        write_array::<SemverString>(
            &mut stream,
            this.workspace_paths.values(),
            PREFIX_SEMVER_STRING,
        )?;
    }

    if let Some(trusted_dependencies) = &this.trusted_dependencies {
        if trusted_dependencies.count() > 0 {
            stream.write_all(&HAS_TRUSTED_DEPENDENCIES_TAG.to_ne_bytes())?;

            write_array::<u32>(&mut stream, trusted_dependencies.keys(), PREFIX_U32)?;
        } else {
            stream.write_all(&HAS_EMPTY_TRUSTED_DEPENDENCIES_TAG.to_ne_bytes())?;
        }
    }

    if this.overrides.map.count() > 0 {
        stream.write_all(&HAS_OVERRIDES_TAG.to_ne_bytes())?;

        write_array::<PackageNameHash>(&mut stream, this.overrides.map.keys(), PREFIX_U64)?;
        let mut external_overrides: Vec<dependency::External> =
            Vec::with_capacity(this.overrides.map.count());
        for src in this.overrides.map.values() {
            external_overrides.push(dependency::to_external(src));
        }

        write_array::<dependency::External>(&mut stream, &external_overrides, PREFIX_DEP_EXTERNAL)?;
    }

    if this.patched_dependencies.count() > 0 {
        for patched_dep in this.patched_dependencies.values() {
            debug_assert!(!patched_dep.patchfile_hash_is_null);
        }

        stream.write_all(&HAS_PATCHED_DEPENDENCIES_TAG.to_ne_bytes())?;

        write_array::<PackageNameAndVersionHash>(
            &mut stream,
            this.patched_dependencies.keys(),
            PREFIX_U64,
        )?;

        write_array::<PatchedDep>(
            &mut stream,
            this.patched_dependencies.values(),
            PREFIX_PATCHED_DEP,
        )?;
    }

    if this.catalogs.has_any() {
        stream.write_all(&HAS_CATALOGS_TAG.to_ne_bytes())?;

        write_array::<SemverString>(
            &mut stream,
            this.catalogs.default.keys(),
            PREFIX_SEMVER_STRING,
        )?;

        let mut external_deps_buf: Vec<dependency::External> =
            Vec::with_capacity(this.catalogs.default.count());
        for src in this.catalogs.default.values() {
            external_deps_buf.push(dependency::to_external(src));
        }

        write_array::<dependency::External>(&mut stream, &external_deps_buf, PREFIX_DEP_EXTERNAL)?;
        external_deps_buf.clear();

        write_array::<SemverString>(
            &mut stream,
            this.catalogs.groups.keys(),
            PREFIX_SEMVER_STRING,
        )?;

        for catalog_deps in this.catalogs.groups.values() {
            write_array::<SemverString>(&mut stream, catalog_deps.keys(), PREFIX_SEMVER_STRING)?;

            external_deps_buf.reserve(catalog_deps.count().saturating_sub(external_deps_buf.len()));
            // Push into the cleared Vec.
            for src in catalog_deps.values() {
                external_deps_buf.push(dependency::to_external(src));
            }

            write_array::<dependency::External>(
                &mut stream,
                &external_deps_buf,
                PREFIX_DEP_EXTERNAL,
            )?;
            external_deps_buf.clear();
        }
    }

    stream.write_all(&HAS_CONFIG_VERSION_TAG.to_ne_bytes())?;
    let config_version: ConfigVersion = options.config_version.unwrap_or(ConfigVersion::CURRENT);
    stream.write_int_le::<u64>(config_version as u64)?;

    *total_size = stream.get_pos()?;

    stream.write_all(&ALIGNMENT_BYTES_TO_REPEAT_BUFFER)?;

    Ok(())
}

#[derive(Default)]
pub struct SerializerLoadResult {
    pub packages_need_update: bool,
    pub migrated_from_lockb_v2: bool,
}

pub(crate) fn load(
    lockfile: &mut Lockfile,
    stream: &mut Stream,
    log: &mut Log,
    mut manager: Option<&mut PackageManager>,
) -> Result<SerializerLoadResult, Error> {
    let mut res = SerializerLoadResult::default();
    // `FixedBufferStream` exposes the read methods directly, so we
    // call them on `stream` to avoid holding a long-lived `&mut` borrow that
    // would conflict with the `stream.pos` / `stream.buffer` accesses below.
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
    // `lockfile.allocator = allocator;` dropped — global mimalloc.

    let _ = stream.read_all(&mut lockfile.meta_hash)?;

    let total_buffer_size = stream.read_int_le::<u64>()?;
    if total_buffer_size > stream.buffer.len() as u64 {
        return Err(crate::Error::LockfileIsMissingData);
    }

    let packages_load_result =
        package::serializer::load(stream, total_buffer_size as usize, migrate_from_v2)?;

    lockfile.packages = packages_load_result.list;

    // `meta.id` is memcpy'd verbatim from disk with no range validation; a
    // corrupt `bun.lockb` can make it garbage and trip `panic_bounds_check`
    // in `Package::clone` / `preinstall_state` indexing later. Surface it
    // here as a parse error so the installer can warn + re-resolve instead
    // of aborting.
    {
        let len = lockfile.packages.len();
        for meta in lockfile.packages.items_meta() {
            if meta.id as usize >= len {
                return Err(crate::Error::InvalidLockfile);
            }
        }
    }

    res.packages_need_update = packages_load_result.needs_update;
    res.migrated_from_lockb_v2 = migrate_from_v2;

    lockfile.buffers = buffers::load(stream, log, manager.as_deref_mut())?;
    if stream.read_int_le::<u64>()? != 0 {
        return Err(crate::Error::LockfileIsMalformedExpected0AtTheEnd);
    }

    let has_workspace_name_hashes = false;
    // < Bun v1.0.4 stopped right here when reading the lockfile
    // So we add an extra 8 byte tag to say "hey, there's more data here"
    {
        let remaining_in_buffer = total_buffer_size.saturating_sub(stream.pos as u64);

        if remaining_in_buffer > 8 && total_buffer_size <= stream.buffer.len() as u64 {
            let next_num = stream.read_int_le::<u64>()?;
            if next_num == HAS_WORKSPACE_PACKAGE_IDS_TAG {
                {
                    let workspace_package_name_hashes: Vec<PackageNameHash> =
                        buffers::read_array(stream)?;

                    let workspace_versions_list: Vec<semver::Version> = 'workspace_versions_list: {
                        if !migrate_from_v2 {
                            break 'workspace_versions_list buffers::read_array::<semver::Version>(
                                stream,
                            )?;
                        }

                        let old_versions_list: Vec<semver::VersionType<u32>> =
                            buffers::read_array(stream)?;

                        let mut versions_list: Vec<semver::Version> =
                            Vec::with_capacity(old_versions_list.len());
                        for old_version in &old_versions_list {
                            versions_list.push(old_version.migrate());
                        }

                        break 'workspace_versions_list versions_list;
                    };

                    // VersionHashMap key/value types matching PackageNameHash /
                    // Semver.Version is enforced by the type-checked
                    // `ensure_total_capacity` + slice copy below.

                    if workspace_package_name_hashes.len() != workspace_versions_list.len() {
                        return Err(crate::Error::InvalidLockfile);
                    }

                    lockfile
                        .workspace_versions
                        .ensure_total_capacity(workspace_versions_list.len())?;
                    // SAFETY: capacity reserved above; both columns are fully
                    // overwritten by `copy_from_slice` before `re_index` reads them.
                    unsafe {
                        lockfile
                            .workspace_versions
                            .set_entries_len(workspace_versions_list.len());
                    }
                    lockfile
                        .workspace_versions
                        .keys_mut()
                        .copy_from_slice(&workspace_package_name_hashes);
                    lockfile
                        .workspace_versions
                        .values_mut()
                        .copy_from_slice(&workspace_versions_list);
                    lockfile.workspace_versions.re_index()?;
                }

                {
                    let workspace_paths_hashes: Vec<PackageNameHash> = buffers::read_array(stream)?;
                    let workspace_paths_strings: Vec<SemverString> = buffers::read_array(stream)?;

                    if workspace_paths_hashes.len() != workspace_paths_strings.len() {
                        return Err(crate::Error::InvalidLockfile);
                    }

                    lockfile
                        .workspace_paths
                        .ensure_total_capacity(workspace_paths_strings.len())?;

                    // SAFETY: capacity reserved above; both columns are fully
                    // overwritten by `copy_from_slice` before `re_index` reads them.
                    unsafe {
                        lockfile
                            .workspace_paths
                            .set_entries_len(workspace_paths_strings.len());
                    }
                    lockfile
                        .workspace_paths
                        .keys_mut()
                        .copy_from_slice(&workspace_paths_hashes);
                    lockfile
                        .workspace_paths
                        .values_mut()
                        .copy_from_slice(&workspace_paths_strings);
                    lockfile.workspace_paths.re_index()?;
                }
            } else {
                stream.pos -= 8;
            }
        }
    }

    {
        let remaining_in_buffer = total_buffer_size.saturating_sub(stream.pos as u64);

        // >= because `has_empty_trusted_dependencies_tag` is tag only
        if remaining_in_buffer >= 8 && total_buffer_size <= stream.buffer.len() as u64 {
            let next_num = stream.read_int_le::<u64>()?;
            if remaining_in_buffer > 8 && next_num == HAS_TRUSTED_DEPENDENCIES_TAG {
                let trusted_dependencies_hashes: Vec<u32> = buffers::read_array(stream)?;

                lockfile.trusted_dependencies = Some(Default::default());
                let td = lockfile.trusted_dependencies.as_mut().unwrap();
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

    {
        let remaining_in_buffer = total_buffer_size.saturating_sub(stream.pos as u64);

        if remaining_in_buffer > 8 && total_buffer_size <= stream.buffer.len() as u64 {
            let next_num = stream.read_int_le::<u64>()?;
            if next_num == HAS_OVERRIDES_TAG {
                let overrides_name_hashes: Vec<PackageNameHash> = buffers::read_array(stream)?;

                lockfile
                    .overrides
                    .map
                    .ensure_total_capacity(overrides_name_hashes.len())?;
                let override_versions_external: Vec<dependency::External> =
                    buffers::read_array(stream)?;
                // reshaped for borrowck — `Context.buffer` borrows
                // `lockfile.buffers.string_bytes` while we also need
                // `&mut lockfile.overrides`. Split the disjoint fields up front so
                // borrowck sees sibling borrows (no raw-ptr provenance laundering).
                let Lockfile {
                    buffers, overrides, ..
                } = &mut *lockfile;
                let string_bytes: &[u8] = buffers.string_bytes.as_slice();
                debug_assert_eq!(
                    overrides_name_hashes.len(),
                    override_versions_external.len()
                );
                for (name, value) in overrides_name_hashes
                    .iter()
                    .zip(override_versions_external.iter())
                {
                    let mut context = dependency::Context {
                        log: &mut *log,
                        buffer: string_bytes,
                        package_manager: manager.as_deref_mut(),
                    };
                    overrides.map.put_assume_capacity(
                        *name,
                        dependency::to_dependency(*value, &mut context),
                    );
                }
            } else {
                stream.pos -= 8;
            }
        }
    }

    {
        let remaining_in_buffer = total_buffer_size.saturating_sub(stream.pos as u64);

        if remaining_in_buffer > 8 && total_buffer_size <= stream.buffer.len() as u64 {
            let next_num = stream.read_int_le::<u64>()?;
            if next_num == HAS_PATCHED_DEPENDENCIES_TAG {
                let patched_dependencies_name_and_version_hashes: Vec<PackageNameAndVersionHash> =
                    buffers::read_array(stream)?;

                let map = &mut lockfile.patched_dependencies;

                map.ensure_total_capacity(patched_dependencies_name_and_version_hashes.len())?;
                let patched_dependencies_paths: Vec<PatchedDepExternal> =
                    buffers::read_array(stream)?;

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
            } else {
                stream.pos -= 8;
            }
        }
    }

    {
        let remaining_in_buffer = total_buffer_size.saturating_sub(stream.pos as u64);

        if remaining_in_buffer > 8 && total_buffer_size <= stream.buffer.len() as u64 {
            let next_num = stream.read_int_le::<u64>()?;
            if next_num == HAS_CATALOGS_TAG {
                lockfile.catalogs = Default::default();

                let default_dep_names: Vec<SemverString> = buffers::read_array(stream)?;

                let default_deps: Vec<dependency::External> = buffers::read_array(stream)?;

                // reshaped for borrowck — `dependency::Context` /
                // `ArrayHashContext` borrow `lockfile.buffers.string_bytes` while
                // we also need `&mut lockfile.catalogs`. Split the disjoint
                // fields up front so borrowck sees sibling borrows (no raw-ptr
                // provenance laundering). `string_bytes` is not reallocated for
                // the remainder of this block.
                let Lockfile {
                    buffers, catalogs, ..
                } = &mut *lockfile;
                let string_bytes: &[u8] = buffers.string_bytes.as_slice();

                catalogs.default.ensure_total_capacity(default_deps.len())?;

                // Both arg and existing keys resolve against the lockfile's
                // string buffer.
                let str_ctx = semver::string::ArrayHashContext {
                    arg_buf: string_bytes,
                    existing_buf: string_bytes,
                };

                debug_assert_eq!(default_dep_names.len(), default_deps.len());
                for (dep_name, dep) in default_dep_names.iter().zip(default_deps.iter()) {
                    let mut context = dependency::Context {
                        log: &mut *log,
                        buffer: string_bytes,
                        package_manager: manager.as_deref_mut(),
                    };
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

                    // `CatalogMap::get_or_put_group` currently takes the
                    // stub `bun_install::lockfile::Lockfile`; inline its body here
                    // against the split `catalogs` borrow to avoid the type
                    // mismatch and the simultaneous `&mut lockfile` self-borrow.
                    let group: &mut super::catalog_map::Map = if catalog_name.is_empty() {
                        &mut catalogs.default
                    } else {
                        let entry = catalogs
                            .groups
                            .get_or_put_adapted(catalog_name, &StringCtxAdapter(&str_ctx))?;
                        if !entry.found_existing {
                            *entry.key_ptr = *catalog_name;
                            *entry.value_ptr = super::catalog_map::Map::default();
                        }
                        entry.value_ptr
                    };

                    group.ensure_total_capacity(catalog_deps.len())?;

                    debug_assert_eq!(catalog_dep_names.len(), catalog_deps.len());
                    for (dep_name, dep) in catalog_dep_names.iter().zip(catalog_deps.iter()) {
                        let mut context = dependency::Context {
                            log,
                            buffer: string_bytes,
                            package_manager: manager.as_deref_mut(),
                        };
                        let value = dependency::to_dependency(*dep, &mut context);
                        group.put_assume_capacity_context(
                            *dep_name,
                            value,
                            |k| str_ctx.hash(*k),
                            |a, b, i| str_ctx.eql(*a, *b, i),
                        );
                    }
                }
            } else {
                stream.pos -= 8;
            }
        }
    }

    {
        let remaining_in_buffer = total_buffer_size.saturating_sub(stream.pos as u64);

        if remaining_in_buffer > 8 && total_buffer_size <= stream.buffer.len() as u64 {
            let next_num = stream.read_int_le::<u64>()?;
            if next_num == HAS_CONFIG_VERSION_TAG {
                let Some(config_version) = ConfigVersion::from_int(stream.read_int_le::<u64>()?)
                else {
                    return Err(crate::Error::InvalidLockfile);
                };
                lockfile.saved_config_version = Some(config_version);
            }
        }
    }

    lockfile.scratch = Scratch::init();
    lockfile.package_index = PackageIndex::Map::default();
    lockfile.string_pool = StringPool::default();
    lockfile
        .package_index
        .ensure_total_capacity(lockfile.packages.len())?;

    // `get_or_put_id` only mutates `package_index` (and reads `packages` /
    // `buffers.string_bytes`), and `workspace_paths.put` only mutates
    // `workspace_paths`, so re-reading the columns by index each iteration is
    // sound and avoids the overlapping borrow.
    if !has_workspace_name_hashes {
        let len = lockfile.packages.len();
        for id in 0..len {
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
                            bstr::BStr::new(resolved)
                        ),
                    );
                    return Err(crate::Error::InvalidLockfile);
                }
            }

            // compatibility with < Bun v1.0.4
            #[allow(clippy::single_match)]
            match resolution.tag {
                ResolutionTag::Workspace => {
                    // SAFETY: tag == Workspace discriminates the active union field.
                    lockfile
                        .workspace_paths
                        .put(name_hash, *resolution.workspace())?;
                }
                _ => {}
            }
        }
    } else {
        let len = lockfile.packages.len();
        for id in 0..len {
            let name_hash = lockfile.packages.items_name_hash()[id];
            lockfile.get_or_put_id(id as PackageID, name_hash)?;
        }
    }

    debug_assert!(stream.pos as u64 == total_buffer_size);

    Ok(res)
}
