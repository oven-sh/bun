//! Binary lockfile (bun.lockb) serializer/deserializer.
//! Port of `src/install/lockfile/bun.lockb.zig` (`const Serializer = @This();`).

use crate::lockfile::package::PackageColumns as _;
use core::mem::{align_of, size_of};

use bun_core::Error;
use bun_io::Write as _;
// PORT NOTE: `Lockfile`/`Stream`/`StringPool`/`package_index` live in the parent
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

// TODO(port): z_allocator is a zeroing allocator (bun.z_allocator). In Rust,
// the equivalent is a wrapper that zeroes allocations. Phase B: provide
// `bun_alloc::ZAllocator` or ensure padding bytes are zeroed via
// `#[derive(zeroize)]` / explicit zeroing on the serialized structs.

pub const VERSION: &[u8] = b"bun-lockfile-format-v0\n";
// PORT NOTE: Zig: "#!/usr/bin/env bun\n" ++ version
const HEADER_BYTES: &[u8] = b"#!/usr/bin/env bun\nbun-lockfile-format-v0\n";

// `@bitCast(@as([8]u8, "...".*))` → native-endian reinterpretation of 8 bytes as u64.
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
/// PORT NOTE: reshaped for borrowck — Zig held a separate `stream` and `writer`
/// over the same `bytes` simultaneously (legal in Zig, aliased `&mut` in Rust).
/// Collapsed into a single type so callers pass exactly one `&mut StreamType`.
///
/// LIFETIMES.tsv: `bytes` is BORROW_PARAM → `&'a mut Vec<u8>`.
pub struct StreamType<'a> {
    pub bytes: &'a mut Vec<u8>,
}

impl<'a> StreamType<'a> {
    #[inline]
    pub fn get_pos(&self) -> Result<usize, Error> {
        Ok(self.bytes.len())
    }

    pub fn pwrite(&mut self, data: &[u8], index: usize) -> usize {
        self.bytes[index..index + data.len()].copy_from_slice(data);
        data.len()
    }

    #[inline]
    pub fn write_all(&mut self, data: &[u8]) -> Result<(), Error> {
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

// Section header strings, byte-for-byte as Zig's `@typeName`/`@sizeOf`/`@alignOf`
// emit them. The reader skips these by absolute offset (see `buffers::read_array`),
// so they are semantically inert; we match Zig's bytes only so that re-saving an
// unchanged lockfile is a no-op across the Zig→Rust migration.
//
// Primitive-type tags (`u64`, `u32`, `[26]u8`) are stable. Struct-type tags have
// already drifted across Zig versions in this repo (`src.install.lockfile.Tree`
// → `install.lockfile.Tree`), so for `Version`/`String`/`PatchedDep` — which no
// checked-in fixture exercises — we emit the current Zig decl path; the const
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
    // we clone packages with the z_allocator to make sure bytes are zeroed.
    // TODO: investigate if we still need this now that we have `padding_checker.zig`
    // TODO(port): z_allocator clone — `MultiArrayList::clone` requires
    // `Package: MultiArrayElement` (not yet derived). The Zig path only exists
    // to zero padding bytes for byte-exact serialization; the per-field writers
    // below already zero-pad via `assert_no_uninitialized_padding`, so skipping
    // the clone is a no-op for correctness. Revisit once the derive lands.
    // let old_packages_list = core::mem::replace(&mut this.packages, this.packages.clone_zeroed()?);
    // drop(old_packages_list);

    // PORT NOTE: reshaped for borrowck — Zig holds `writer` and `stream` over
    // the same `bytes` simultaneously; collapsed into a single `StreamType`.
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

    // PORT NOTE: Zig passes `StreamType` (type) + `stream` (value) +
    // `@TypeOf(writer)` + `writer` as separate comptime/runtime args. In Rust the
    // callees take a single `&mut S: PositionalStream + bun_io::Write` (both
    // roles collapsed onto `StreamType`) — two `&mut` aliases of one object would
    // be UB regardless of access order.
    // PORT NOTE: turbofish — `this.packages` is `PackageList = List<u64>`, but
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
        // PERF(port): Zig uses z_allocator + initCapacity then sets items.len directly.
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

        // PERF(port): Zig uses z_allocator + initCapacity then sets items.len directly.
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
            // PORT NOTE: Zig sets `items.len = count` then writes each slot via `dest.* = ...`.
            // Reshape: push into the cleared Vec instead.
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

pub fn load(
    lockfile: &mut Lockfile,
    stream: &mut Stream,
    log: &mut Log,
    mut manager: Option<&mut PackageManager>,
) -> Result<SerializerLoadResult, Error> {
    // TODO(port): narrow error set
    let mut res = SerializerLoadResult::default();
    // PORT NOTE: Zig's `var reader = stream.reader();` is a thin view over the
    // same buffer. `FixedBufferStream` exposes the read methods directly, so we
    // call them on `stream` to avoid holding a long-lived `&mut` borrow that
    // would conflict with the `stream.pos` / `stream.buffer` accesses below.
    let mut header_buf_: [u8; HEADER_BYTES.len()] = [0; HEADER_BYTES.len()];
    let n = stream.read_all(&mut header_buf_)?;
    let header_buf = &header_buf_[..n];

    if header_buf != HEADER_BYTES {
        return Err(bun_core::err!("InvalidLockfile"));
    }

    let mut migrate_from_v2 = false;
    let format = stream.read_int_le::<u32>()?;
    if format > FormatVersion::current().0 {
        return Err(bun_core::err!("Unexpected lockfile version"));
    }

    if format < FormatVersion::current().0 {
        // we only allow migrating from v2 to v3 or above
        if format != FormatVersion::V2.0 {
            return Err(bun_core::err!("Outdated lockfile version"));
        }

        migrate_from_v2 = true;
    }

    lockfile.format = FormatVersion::current();
    // PORT NOTE: `lockfile.allocator = allocator;` dropped — global mimalloc.

    let _ = stream.read_all(&mut lockfile.meta_hash)?;

    let total_buffer_size = stream.read_int_le::<u64>()?;
    if total_buffer_size > stream.buffer.len() as u64 {
        return Err(bun_core::err!("Lockfile is missing data"));
    }

    let packages_load_result =
        package::serializer::load(stream, total_buffer_size as usize, migrate_from_v2)?;

    lockfile.packages = packages_load_result.list;

    res.packages_need_update = packages_load_result.needs_update;
    res.migrated_from_lockb_v2 = migrate_from_v2;

    lockfile.buffers = buffers::load(stream, log, manager.as_deref_mut())?;
    if stream.read_int_le::<u64>()? != 0 {
        return Err(bun_core::err!(
            "Lockfile is malformed (expected 0 at the end)"
        ));
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
                            // PERF(port): was assume_capacity
                            versions_list.push(old_version.migrate());
                        }

                        break 'workspace_versions_list versions_list;
                    };

                    // TODO(port): comptime type assertion that VersionHashMap key/value types
                    // match PackageNameHash / Semver.Version. Rust cannot express this as a
                    // const block without specialization; rely on type-checked
                    // `ensure_total_capacity` + slice copy below to enforce it.

                    if workspace_package_name_hashes.len() != workspace_versions_list.len() {
                        return Err(bun_core::err!("InvalidLockfile"));
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
                        return Err(bun_core::err!("InvalidLockfile"));
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

                // SAFETY: capacity reserved above; keys are fully overwritten
                // by `copy_from_slice` before `re_index` reads them; value type
                // is `()` so its column needs no init.
                unsafe {
                    td.set_entries_len(trusted_dependencies_hashes.len());
                }
                td.keys_mut().copy_from_slice(&trusted_dependencies_hashes);
                td.re_index()?;
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

                // PORT NOTE: Zig: `var map = lockfile.overrides.map; defer lockfile.overrides.map = map;`
                // is a move-out/move-back pattern. In Rust we mutate in place.
                lockfile
                    .overrides
                    .map
                    .ensure_total_capacity(overrides_name_hashes.len())?;
                let override_versions_external: Vec<dependency::External> =
                    buffers::read_array(stream)?;
                // PORT NOTE: reshaped for borrowck — `Context.buffer` borrows
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
                    // PERF(port): was assume_capacity
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

                // PORT NOTE: Zig: `var map = lockfile.patched_dependencies; defer lockfile.patched_dependencies = map;`
                let map = &mut lockfile.patched_dependencies;

                map.ensure_total_capacity(patched_dependencies_name_and_version_hashes.len())?;
                let patched_dependencies_paths: Vec<PatchedDep> = buffers::read_array(stream)?;

                debug_assert_eq!(
                    patched_dependencies_name_and_version_hashes.len(),
                    patched_dependencies_paths.len()
                );
                for (name_hash, patch_path) in patched_dependencies_name_and_version_hashes
                    .iter()
                    .zip(patched_dependencies_paths.iter())
                {
                    // PERF(port): was assume_capacity
                    map.put_assume_capacity(*name_hash, *patch_path);
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

                // PORT NOTE: reshaped for borrowck — `dependency::Context` /
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

                // Zig `String.arrayHashContext(lockfile, null)` →
                // `{ .arg_buf = lockfile.buffers.string_bytes.items, .existing_buf = same }`.
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
                    drop(context);
                    // PERF(port): was assume_capacity
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

                    // PORT NOTE: `CatalogMap::get_or_put_group` currently takes the
                    // stub `bun_install::lockfile::Lockfile`; inline its body here
                    // against the split `catalogs` borrow to avoid the type
                    // mismatch and the simultaneous `&mut lockfile` self-borrow.
                    let group: &mut super::catalog_map::Map = if catalog_name.is_empty() {
                        &mut catalogs.default
                    } else {
                        let entry = catalogs
                            .groups
                            .get_or_put_adapted(*catalog_name, StringCtxAdapter(&str_ctx))?;
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
                        drop(context);
                        // PERF(port): was assume_capacity
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
                    return Err(bun_core::err!("InvalidLockfile"));
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

    // PORT NOTE: reshaped for borrowck — Zig holds `slice.items(.name_hash)` /
    // `slice.items(.resolution)` across `lockfile.getOrPutID(&mut self, …)`.
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

    if cfg!(debug_assertions) {
        debug_assert!(stream.pos as u64 == total_buffer_size);
    }

    // const end = try reader.readInt(u64, .little);
    Ok(res)
}

// ported from: src/install/lockfile/bun.lockb.zig
