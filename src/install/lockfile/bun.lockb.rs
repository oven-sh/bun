//! Binary lockfile (bun.lockb) serializer/deserializer.
//! Port of `src/install/lockfile/bun.lockb.zig` (`const Serializer = @This();`).

use bun_core::{ConfigVersion, Error};
use bun_install::lockfile::{
    Lockfile, PackageIndex, Stream, StringPool, ALIGNMENT_BYTES_TO_REPEAT_BUFFER,
};
use bun_install::{
    Dependency, PackageID, PackageManager, PackageNameAndVersionHash, PackageNameHash, PatchedDep,
};
use bun_logger::Log;
use bun_semver::{self as semver, String as SemverString};
use bun_str::strings;

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

/// Wraps a growing `Vec<u8>` to provide positional-write semantics for
/// `Lockfile.Package.Serializer.save` / `Lockfile.Buffers.save`.
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
}

/// Minimal writer over `Vec<u8>` mirroring `std.array_list.Managed(u8).Writer`.
/// Kept local because `save` only uses `writeAll` + `writeInt(.little)`.
struct Writer<'a> {
    bytes: &'a mut Vec<u8>,
}

impl<'a> Writer<'a> {
    #[inline]
    fn write_all(&mut self, data: &[u8]) -> Result<(), Error> {
        self.bytes.extend_from_slice(data);
        Ok(())
    }

    #[inline]
    fn write_int_u32_le(&mut self, v: u32) -> Result<(), Error> {
        self.bytes.extend_from_slice(&v.to_le_bytes());
        Ok(())
    }

    #[inline]
    fn write_int_u64_le(&mut self, v: u64) -> Result<(), Error> {
        self.bytes.extend_from_slice(&v.to_le_bytes());
        Ok(())
    }
}

pub fn save(
    this: &mut Lockfile,
    options: &PackageManager::Options,
    bytes: &mut Vec<u8>,
    total_size: &mut usize,
    end_pos: &mut usize,
) -> Result<(), Error> {
    // we clone packages with the z_allocator to make sure bytes are zeroed.
    // TODO: investigate if we still need this now that we have `padding_checker.zig`
    // TODO(port): z_allocator clone — ensure zeroed padding in Rust port.
    let old_packages_list = core::mem::replace(&mut this.packages, this.packages.clone_zeroed()?);
    drop(old_packages_list);

    // PORT NOTE: reshaped for borrowck — Zig holds `writer` and `stream` over
    // the same `bytes` simultaneously; here we re-borrow per call.
    {
        let mut writer = Writer { bytes };
        writer.write_all(HEADER_BYTES)?;
        writer.write_int_u32_le(this.format as u32)?;

        writer.write_all(&this.meta_hash)?;
    }

    *end_pos = bytes.len();
    {
        let mut writer = Writer { bytes };
        writer.write_int_u64_le(0)?;
    }

    if cfg!(debug_assertions) {
        for res in this.packages.items_resolution() {
            match res.tag {
                bun_install::Resolution::Tag::Folder => {
                    debug_assert!(strings::index_of_char(
                        this.str(&res.value.folder),
                        bun_paths::SEP_WINDOWS,
                    )
                    .is_none());
                }
                bun_install::Resolution::Tag::Symlink => {
                    debug_assert!(strings::index_of_char(
                        this.str(&res.value.symlink),
                        bun_paths::SEP_WINDOWS,
                    )
                    .is_none());
                }
                bun_install::Resolution::Tag::LocalTarball => {
                    debug_assert!(strings::index_of_char(
                        this.str(&res.value.local_tarball),
                        bun_paths::SEP_WINDOWS,
                    )
                    .is_none());
                }
                bun_install::Resolution::Tag::Workspace => {
                    debug_assert!(strings::index_of_char(
                        this.str(&res.value.workspace),
                        bun_paths::SEP_WINDOWS,
                    )
                    .is_none());
                }
                _ => {}
            }
        }
    }

    // TODO(port): Zig passes `StreamType` (type) + `stream` (value) + `@TypeOf(writer)` + `writer`
    // as separate comptime/runtime args. In Rust the type params are inferred; the callees take
    // `&mut StreamType` and `&mut Vec<u8>` (or a Write impl). Phase B: align with
    // `Lockfile::Package::Serializer::save` / `Lockfile::Buffers::save` signatures.
    Lockfile::Package::Serializer::save(&this.packages, &mut StreamType { bytes }, bytes)?;
    Lockfile::Buffers::save(this, options, &mut StreamType { bytes }, bytes)?;
    {
        let mut writer = Writer { bytes };
        writer.write_int_u64_le(0)?;
    }

    // < Bun v1.0.4 stopped right here when reading the lockfile
    // So we add an extra 8 byte tag to say "hey, there's more data here"
    if this.workspace_versions.count() > 0 {
        let mut writer = Writer { bytes };
        writer.write_all(&HAS_WORKSPACE_PACKAGE_IDS_TAG.to_ne_bytes())?;
        drop(writer);

        // We need to track the "version" field in "package.json" of workspace member packages
        // We do not necessarily have that in the Resolution struct. So we store it here.
        Lockfile::Buffers::write_array::<PackageNameHash>(
            &mut StreamType { bytes },
            bytes,
            this.workspace_versions.keys(),
        )?;
        Lockfile::Buffers::write_array::<semver::Version>(
            &mut StreamType { bytes },
            bytes,
            this.workspace_versions.values(),
        )?;

        Lockfile::Buffers::write_array::<PackageNameHash>(
            &mut StreamType { bytes },
            bytes,
            this.workspace_paths.keys(),
        )?;
        Lockfile::Buffers::write_array::<SemverString>(
            &mut StreamType { bytes },
            bytes,
            this.workspace_paths.values(),
        )?;
    }

    if let Some(trusted_dependencies) = &this.trusted_dependencies {
        if trusted_dependencies.count() > 0 {
            Writer { bytes }.write_all(&HAS_TRUSTED_DEPENDENCIES_TAG.to_ne_bytes())?;

            Lockfile::Buffers::write_array::<u32>(
                &mut StreamType { bytes },
                bytes,
                trusted_dependencies.keys(),
            )?;
        } else {
            Writer { bytes }.write_all(&HAS_EMPTY_TRUSTED_DEPENDENCIES_TAG.to_ne_bytes())?;
        }
    }

    if this.overrides.map.count() > 0 {
        Writer { bytes }.write_all(&HAS_OVERRIDES_TAG.to_ne_bytes())?;

        Lockfile::Buffers::write_array::<PackageNameHash>(
            &mut StreamType { bytes },
            bytes,
            this.overrides.map.keys(),
        )?;
        // PERF(port): Zig uses z_allocator + initCapacity then sets items.len directly.
        let mut external_overrides: Vec<Dependency::External> =
            Vec::with_capacity(this.overrides.map.count());
        for src in this.overrides.map.values() {
            external_overrides.push(src.to_external());
        }

        Lockfile::Buffers::write_array::<Dependency::External>(
            &mut StreamType { bytes },
            bytes,
            &external_overrides,
        )?;
    }

    if this.patched_dependencies.entries_len() > 0 {
        for patched_dep in this.patched_dependencies.values() {
            debug_assert!(!patched_dep.patchfile_hash_is_null);
        }

        Writer { bytes }.write_all(&HAS_PATCHED_DEPENDENCIES_TAG.to_ne_bytes())?;

        Lockfile::Buffers::write_array::<PackageNameAndVersionHash>(
            &mut StreamType { bytes },
            bytes,
            this.patched_dependencies.keys(),
        )?;

        Lockfile::Buffers::write_array::<PatchedDep>(
            &mut StreamType { bytes },
            bytes,
            this.patched_dependencies.values(),
        )?;
    }

    if this.catalogs.has_any() {
        Writer { bytes }.write_all(&HAS_CATALOGS_TAG.to_ne_bytes())?;

        Lockfile::Buffers::write_array::<SemverString>(
            &mut StreamType { bytes },
            bytes,
            this.catalogs.default.keys(),
        )?;

        // PERF(port): Zig uses z_allocator + initCapacity then sets items.len directly.
        let mut external_deps_buf: Vec<Dependency::External> =
            Vec::with_capacity(this.catalogs.default.count());
        for src in this.catalogs.default.values() {
            external_deps_buf.push(src.to_external());
        }

        Lockfile::Buffers::write_array::<Dependency::External>(
            &mut StreamType { bytes },
            bytes,
            &external_deps_buf,
        )?;
        external_deps_buf.clear();

        Lockfile::Buffers::write_array::<SemverString>(
            &mut StreamType { bytes },
            bytes,
            this.catalogs.groups.keys(),
        )?;

        for catalog_deps in this.catalogs.groups.values() {
            Lockfile::Buffers::write_array::<SemverString>(
                &mut StreamType { bytes },
                bytes,
                catalog_deps.keys(),
            )?;

            external_deps_buf.reserve(catalog_deps.count().saturating_sub(external_deps_buf.len()));
            // PORT NOTE: Zig sets `items.len = count` then writes each slot via `dest.* = ...`.
            // Reshape: push into the cleared Vec instead.
            for src in catalog_deps.values() {
                external_deps_buf.push(src.to_external());
            }

            Lockfile::Buffers::write_array::<Dependency::External>(
                &mut StreamType { bytes },
                bytes,
                &external_deps_buf,
            )?;
            external_deps_buf.clear();
        }
    }

    Writer { bytes }.write_all(&HAS_CONFIG_VERSION_TAG.to_ne_bytes())?;
    let config_version: ConfigVersion = options.config_version.unwrap_or(ConfigVersion::CURRENT);
    Writer { bytes }.write_int_u64_le(config_version as u64)?;

    *total_size = StreamType { bytes }.get_pos()?;

    Writer { bytes }.write_all(&ALIGNMENT_BYTES_TO_REPEAT_BUFFER)?;

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
    manager: Option<&mut PackageManager>,
) -> Result<SerializerLoadResult, Error> {
    // TODO(port): narrow error set
    let mut res = SerializerLoadResult::default();
    let mut reader = stream.reader();
    let mut header_buf_: [u8; HEADER_BYTES.len()] = [0; HEADER_BYTES.len()];
    let n = reader.read_all(&mut header_buf_)?;
    let header_buf = &header_buf_[..n];

    if header_buf != HEADER_BYTES {
        return Err(bun_core::err!("InvalidLockfile"));
    }

    let mut migrate_from_v2 = false;
    let format = reader.read_int_u32_le()?;
    if format > Lockfile::FormatVersion::CURRENT as u32 {
        return Err(bun_core::err!("Unexpected lockfile version"));
    }

    if format < Lockfile::FormatVersion::CURRENT as u32 {
        // we only allow migrating from v2 to v3 or above
        if format != Lockfile::FormatVersion::V2 as u32 {
            return Err(bun_core::err!("Outdated lockfile version"));
        }

        migrate_from_v2 = true;
    }

    lockfile.format = Lockfile::FormatVersion::CURRENT;
    // PORT NOTE: `lockfile.allocator = allocator;` dropped — global mimalloc.

    let _ = reader.read_all(&mut lockfile.meta_hash)?;

    let total_buffer_size = reader.read_int_u64_le()?;
    if total_buffer_size > stream.buffer.len() as u64 {
        return Err(bun_core::err!("Lockfile is missing data"));
    }

    let packages_load_result =
        Lockfile::Package::Serializer::load(stream, total_buffer_size, migrate_from_v2)?;

    lockfile.packages = packages_load_result.list;

    res.packages_need_update = packages_load_result.needs_update;
    res.migrated_from_lockb_v2 = migrate_from_v2;

    lockfile.buffers = Lockfile::Buffers::load(stream, log, manager.as_deref_mut())?;
    if stream.reader().read_int_u64_le()? != 0 {
        return Err(bun_core::err!("Lockfile is malformed (expected 0 at the end)"));
    }

    let has_workspace_name_hashes = false;
    // < Bun v1.0.4 stopped right here when reading the lockfile
    // So we add an extra 8 byte tag to say "hey, there's more data here"
    {
        let remaining_in_buffer = total_buffer_size.saturating_sub(stream.pos as u64);

        if remaining_in_buffer > 8 && total_buffer_size <= stream.buffer.len() as u64 {
            let next_num = reader.read_int_u64_le()?;
            if next_num == HAS_WORKSPACE_PACKAGE_IDS_TAG {
                {
                    let workspace_package_name_hashes: Vec<PackageNameHash> =
                        Lockfile::Buffers::read_array(stream)?;

                    let workspace_versions_list: Vec<semver::Version> = 'workspace_versions_list: {
                        if !migrate_from_v2 {
                            break 'workspace_versions_list Lockfile::Buffers::read_array::<
                                semver::Version,
                            >(stream)?;
                        }

                        let old_versions_list: Vec<semver::VersionType<u32>> =
                            Lockfile::Buffers::read_array(stream)?;

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

                    lockfile
                        .workspace_versions
                        .ensure_total_capacity(workspace_versions_list.len())?;
                    lockfile
                        .workspace_versions
                        .set_entries_len(workspace_versions_list.len());
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
                    let workspace_paths_hashes: Vec<PackageNameHash> =
                        Lockfile::Buffers::read_array(stream)?;
                    let workspace_paths_strings: Vec<SemverString> =
                        Lockfile::Buffers::read_array(stream)?;

                    lockfile
                        .workspace_paths
                        .ensure_total_capacity(workspace_paths_strings.len())?;

                    lockfile
                        .workspace_paths
                        .set_entries_len(workspace_paths_strings.len());
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
            let next_num = reader.read_int_u64_le()?;
            if remaining_in_buffer > 8 && next_num == HAS_TRUSTED_DEPENDENCIES_TAG {
                let trusted_dependencies_hashes: Vec<u32> = Lockfile::Buffers::read_array(stream)?;

                lockfile.trusted_dependencies = Some(Default::default());
                let td = lockfile.trusted_dependencies.as_mut().unwrap();
                td.ensure_total_capacity(trusted_dependencies_hashes.len())?;

                td.set_entries_len(trusted_dependencies_hashes.len());
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
            let next_num = reader.read_int_u64_le()?;
            if next_num == HAS_OVERRIDES_TAG {
                let overrides_name_hashes: Vec<PackageNameHash> =
                    Lockfile::Buffers::read_array(stream)?;

                // PORT NOTE: Zig: `var map = lockfile.overrides.map; defer lockfile.overrides.map = map;`
                // is a move-out/move-back pattern. In Rust we mutate in place.
                let map = &mut lockfile.overrides.map;

                map.ensure_total_capacity(overrides_name_hashes.len())?;
                let override_versions_external: Vec<Dependency::External> =
                    Lockfile::Buffers::read_array(stream)?;
                let context = Dependency::Context {
                    log,
                    buffer: lockfile.buffers.string_bytes.as_slice(),
                    package_manager: manager.as_deref_mut(),
                };
                debug_assert_eq!(overrides_name_hashes.len(), override_versions_external.len());
                for (name, value) in overrides_name_hashes
                    .iter()
                    .zip(override_versions_external.iter())
                {
                    // PERF(port): was assume_capacity
                    map.put_assume_capacity(*name, Dependency::to_dependency(*value, &context));
                }
            } else {
                stream.pos -= 8;
            }
        }
    }

    {
        let remaining_in_buffer = total_buffer_size.saturating_sub(stream.pos as u64);

        if remaining_in_buffer > 8 && total_buffer_size <= stream.buffer.len() as u64 {
            let next_num = reader.read_int_u64_le()?;
            if next_num == HAS_PATCHED_DEPENDENCIES_TAG {
                let patched_dependencies_name_and_version_hashes: Vec<PackageNameAndVersionHash> =
                    Lockfile::Buffers::read_array(stream)?;

                // PORT NOTE: Zig: `var map = lockfile.patched_dependencies; defer lockfile.patched_dependencies = map;`
                let map = &mut lockfile.patched_dependencies;

                map.ensure_total_capacity(patched_dependencies_name_and_version_hashes.len())?;
                let patched_dependencies_paths: Vec<PatchedDep> =
                    Lockfile::Buffers::read_array(stream)?;

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
            let next_num = reader.read_int_u64_le()?;
            if next_num == HAS_CATALOGS_TAG {
                lockfile.catalogs = Default::default();

                let default_dep_names: Vec<SemverString> = Lockfile::Buffers::read_array(stream)?;

                let default_deps: Vec<Dependency::External> =
                    Lockfile::Buffers::read_array(stream)?;

                lockfile
                    .catalogs
                    .default
                    .ensure_total_capacity(default_deps.len())?;

                let context = Dependency::Context {
                    log,
                    buffer: lockfile.buffers.string_bytes.as_slice(),
                    package_manager: manager.as_deref_mut(),
                };

                debug_assert_eq!(default_dep_names.len(), default_deps.len());
                for (dep_name, dep) in default_dep_names.iter().zip(default_deps.iter()) {
                    // PERF(port): was assume_capacity
                    lockfile.catalogs.default.put_assume_capacity_context(
                        *dep_name,
                        Dependency::to_dependency(*dep, &context),
                        SemverString::array_hash_context(lockfile, None),
                    );
                }

                let catalog_names: Vec<SemverString> = Lockfile::Buffers::read_array(stream)?;

                lockfile
                    .catalogs
                    .groups
                    .ensure_total_capacity(catalog_names.len())?;

                for catalog_name in &catalog_names {
                    let catalog_dep_names: Vec<SemverString> =
                        Lockfile::Buffers::read_array(stream)?;

                    let catalog_deps: Vec<Dependency::External> =
                        Lockfile::Buffers::read_array(stream)?;

                    let group = lockfile.catalogs.get_or_put_group(lockfile, *catalog_name)?;

                    group.ensure_total_capacity(catalog_deps.len())?;

                    debug_assert_eq!(catalog_dep_names.len(), catalog_deps.len());
                    for (dep_name, dep) in catalog_dep_names.iter().zip(catalog_deps.iter()) {
                        // PERF(port): was assume_capacity
                        group.put_assume_capacity_context(
                            *dep_name,
                            Dependency::to_dependency(*dep, &context),
                            SemverString::array_hash_context(lockfile, None),
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
            let next_num = reader.read_int_u64_le()?;
            if next_num == HAS_CONFIG_VERSION_TAG {
                let Some(config_version) = ConfigVersion::from_int(reader.read_int_u64_le()?)
                else {
                    return Err(bun_core::err!("InvalidLockfile"));
                };
                lockfile.saved_config_version = config_version;
            }
        }
    }

    lockfile.scratch = Lockfile::Scratch::init();
    lockfile.package_index = PackageIndex::Map::init_context(Default::default());
    lockfile.string_pool = StringPool::init();
    lockfile
        .package_index
        .ensure_total_capacity(lockfile.packages.len() as u32)?;

    if !has_workspace_name_hashes {
        let slice = lockfile.packages.slice();
        let name_hashes = slice.items_name_hash();
        let resolutions = slice.items_resolution();
        debug_assert_eq!(name_hashes.len(), resolutions.len());
        for (id, (name_hash, resolution)) in
            name_hashes.iter().zip(resolutions.iter()).enumerate()
        {
            lockfile.get_or_put_id(id as PackageID, *name_hash)?;

            // compatibility with < Bun v1.0.4
            match resolution.tag {
                bun_install::Resolution::Tag::Workspace => {
                    lockfile
                        .workspace_paths
                        .put(*name_hash, resolution.value.workspace)?;
                }
                _ => {}
            }
        }
    } else {
        let slice = lockfile.packages.slice();
        let name_hashes = slice.items_name_hash();
        for (id, name_hash) in name_hashes.iter().enumerate() {
            lockfile.get_or_put_id(id as PackageID, *name_hash)?;
        }
    }

    if cfg!(debug_assertions) {
        debug_assert!(stream.pos as u64 == total_buffer_size);
    }

    // const end = try reader.readInt(u64, .little);
    Ok(res)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/bun.lockb.zig (640 lines)
//   confidence: medium
//   todos:      4
//   notes:      save() borrowck reshape (StreamType+Writer share &mut Vec<u8>); z_allocator zeroing semantics deferred; Buffers::write_array/read_array signatures assumed; Dependency::Context.allocator field dropped
// ──────────────────────────────────────────────────────────────────────────
