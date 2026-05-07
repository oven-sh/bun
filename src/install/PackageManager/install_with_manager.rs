use core::sync::atomic::Ordering;

use bun_core::{Global, Output, Progress};
use bun_core::time::nano_timestamp;

use bun_str::{strings, ZStr};
use bun_semver::String as SemverString;
use crate::bun_fs::FileSystem;
use bun_paths as Path;
use bun_glob as glob;

use crate::{
    Dependency, DependencyID, Features, PackageID, PackageNameHash, PatchTask,
    Resolution, invalid_package_id,
};
use crate::dependency::{Tag as DependencyVersionTag, DependencyExt as _};
use crate::resolution::Tag as ResolutionTag;
use crate::Subcommand;
use crate::GetJsonResult as WorkspacePackageJsonCacheResult;
use crate::lockfile::{self, Lockfile, Package};
// Bring the typed `items_<field>()` column accessors into scope for
// `MultiArrayList<Package>` / `Slice<Package>` (Zig: `packages.items(.field)`).
use crate::lockfile_real::package::{PackageListExt as _, PackageSliceExt as _};
use crate::lockfile_real::bun_lock as TextLockfile;
use crate::lockfile_real::package::Diff;
use crate::lockfile_real::{Printer, printer as LockfilePrinter};
use crate::package_install::Summary as PackageInstallSummary;
use crate::PackageManager;
use crate::package_manager::{Options, WorkspaceFilter};
use crate::package_manager::Options::Enable;
use super::Command;
use bun_install_types::NodeLinker::NodeLinker;
use crate::config_version::ConfigVersion;
use crate::hoisted_install::install_hoisted_packages;
use crate::isolated_install::install_isolated_packages;

// Free-function "methods" on `*PackageManager` that the Zig source calls via
// UFCS (`manager.foo(...)`) but which the Rust port hosts in sibling modules
// to avoid one giant `impl PackageManager` block. Import them under their Zig
// names so the body reads the same as the spec.
use crate::package_manager_real::{
    enqueue_dependency_list, enqueue_dependency_with_main, enqueue_patch_task_pre,
    save_lockfile, setup_global_dir, update_lockfile_if_needed, write_yarn_lock,
};
use crate::package_manager_real::run_tasks::{run_tasks, RunTasksCallbacks};

use super::security_scanner;

pub fn install_with_manager(
    manager: &mut PackageManager,
    ctx: Command::Context,
    root_package_json_path: &ZStr,
    original_cwd: &[u8],
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let log_level = manager.options.log_level;

    // Start resolving DNS for the default registry immediately.
    // Unless you're behind a proxy.
    if !manager.env().has_http_proxy() {
        // And don't try to resolve DNS if it's an IP address.
        let scope_url = manager.options.scope.url.url();
        if !scope_url.hostname.is_empty() && !scope_url.is_ip_address() {
            // PERF(port): was stack-fallback alloc — profile in Phase B
            bun_dns::internal::prefetch(
                manager.event_loop.loop_(),
                scope_url.hostname,
                scope_url.get_port_auto(),
            );
        }
    }

    // PORT NOTE: reshaped for borrowck — Zig passes `manager`, `manager.lockfile`,
    // and `manager.log` to `loadFromCwd` simultaneously. Route through a single
    // raw provenance root so the three reborrows share a tag.
    let load_result: lockfile::LoadResult = if manager.options.do_.load_lockfile() {
        let mgr: *mut PackageManager = manager;
        // SAFETY: `mgr` is the sole provenance root; `lockfile`, `*mgr`, and
        // `*log` are disjoint storage. `load_from_cwd` only reads `manager`
        // for option flags and writes through `lockfile`/`log`.
        unsafe {
            let log = (*mgr).log;
            (*mgr).lockfile.load_from_cwd::<true>(Some(&mut *mgr), &mut *log)
        }
    } else {
        lockfile::LoadResult::NotFound
    };

    update_lockfile_if_needed(manager, load_result)?;

    let (config_version, changed_config_version) = load_result.choose_config_version();
    manager.options.config_version = Some(config_version);

    let mut root = lockfile::Package::default();
    let mut needs_new_lockfile = !matches!(load_result, lockfile::LoadResult::Ok { .. })
        || (load_result.ok().lockfile.buffers.dependencies.is_empty()
            && !manager.update_requests.is_empty());

    manager.options.enable.set(
        Enable::FORCE_SAVE_LOCKFILE,
        manager.options.enable.force_save_lockfile()
            || changed_config_version
            || (matches!(load_result, lockfile::LoadResult::Ok { .. })
                // if migrated always save a new lockfile
                && (load_result.ok().migrated != lockfile::Migrated::None
                    // if loaded from binary and save-text-lockfile is passed
                    || (load_result.ok().format == lockfile::Format::Binary
                        && manager.options.save_text_lockfile.unwrap_or(false)))),
    );

    // this defaults to false
    // but we force allowing updates to the lockfile when you do bun add
    let mut had_any_diffs = false;
    manager.progress = Default::default();

    match &load_result {
        lockfile::LoadResult::Err(cause) => {
            if log_level != Options::LogLevel::Silent {
                match cause.step {
                    lockfile::LoadStep::OpenFile => Output::err(
                        cause.value,
                        "failed to open lockfile: '{}'",
                        format_args!("{}", bstr::BStr::new(&cause.lockfile_path)),
                    ),
                    lockfile::LoadStep::ParseFile => Output::err(
                        cause.value,
                        "failed to parse lockfile: '{}'",
                        format_args!("{}", bstr::BStr::new(&cause.lockfile_path)),
                    ),
                    lockfile::LoadStep::ReadFile => Output::err(
                        cause.value,
                        "failed to read lockfile: '{}'",
                        format_args!("{}", bstr::BStr::new(&cause.lockfile_path)),
                    ),
                    lockfile::LoadStep::Migrating => Output::err(
                        cause.value,
                        "failed to migrate lockfile: '{}'",
                        format_args!("{}", bstr::BStr::new(&cause.lockfile_path)),
                    ),
                }

                if !manager.options.enable.fail_early() {
                    Output::print_errorln("");
                    Output::warn("Ignoring lockfile");
                }

                if unsafe { (*ctx.log).errors } > 0 {
                    // SAFETY: `manager.log` is a non-null backref to the CLI log set at init().
                    unsafe { &*manager.log }
                        .print(Output::error_writer() as *mut _)
                        .map_err(|_| bun_core::err!("WriteFailed"))?;
                    unsafe { &mut *manager.log }.reset();
                }
                Output::flush();
            }

            if manager.options.enable.fail_early() {
                Global::crash();
            }
        }
        lockfile::LoadResult::Ok(ok) => {
            if manager.subcommand == Subcommand::Update {
                // existing lockfile, get the original version is updating
                // PORT NOTE: reshaped for borrowck — Zig holds `*Lockfile` while
                // also mutating `manager.updating_packages`. Route through a raw
                // provenance root and reborrow disjoint fields through it.
                let mgr: *mut PackageManager = manager;
                // SAFETY: `mgr` is the sole provenance root; the shared
                // `lockfile` reborrow and the `&mut updating_packages` reborrow
                // touch disjoint `PackageManager` fields.
                let lockfile: &Lockfile = unsafe { &(*mgr).lockfile };
                let packages = lockfile.packages.slice();
                let resolutions = packages.items_resolution();
                let workspace_package_id = unsafe { &(*mgr).root_package_id }
                    .get(lockfile, unsafe { (*mgr).workspace_name_hash });
                let workspace_dep_list = packages.items_dependencies()[workspace_package_id as usize];
                let workspace_res_list = packages.items_resolutions()[workspace_package_id as usize];
                let workspace_deps = workspace_dep_list.get(&lockfile.buffers.dependencies);
                let workspace_package_ids = workspace_res_list.get(&lockfile.buffers.resolutions);
                debug_assert_eq!(workspace_deps.len(), workspace_package_ids.len());
                for (dep, &package_id) in workspace_deps.iter().zip(workspace_package_ids) {
                    if dep.version.tag != DependencyVersionTag::Npm
                        && dep.version.tag != DependencyVersionTag::DistTag
                    {
                        continue;
                    }
                    if package_id == invalid_package_id {
                        continue;
                    }

                    if let Some(entry_ptr) = unsafe { &mut (*mgr).updating_packages }
                        .get_mut(dep.name.slice(&lockfile.buffers.string_bytes))
                    {
                        let original_resolution: Resolution = resolutions[package_id as usize];
                        // Just in case check if the resolution is `npm`. It should always be `npm` because the dependency version
                        // is `npm` or `dist_tag`.
                        if original_resolution.tag != ResolutionTag::Npm {
                            continue;
                        }

                        let mut original = original_resolution.value.npm.version;
                        let tag_total = original.tag.pre.len() + original.tag.build.len();
                        if tag_total > 0 {
                            // clone because don't know if lockfile buffer will reallocate
                            let mut tag_buf = vec![0u8; tag_total].into_boxed_slice();
                            let mut ptr = &mut tag_buf[..];
                            original.tag = original_resolution
                                .value
                                .npm
                                .version
                                .tag
                                .clone_into(&lockfile.buffers.string_bytes, &mut ptr);

                            entry_ptr.original_version_string_buf = tag_buf;
                        }

                        entry_ptr.original_version = Some(original);
                    }
                }
            }
            'differ: {
                root = match ok.lockfile.root_package() {
                    Some(r) => r,
                    None => {
                        needs_new_lockfile = true;
                        break 'differ;
                    }
                };

                if root.dependencies.len == 0 {
                    needs_new_lockfile = true;
                }

                if needs_new_lockfile {
                    break 'differ;
                }

                let mut lockfile = Lockfile::default();
                let mut maybe_root = lockfile::Package::default();

                // SAFETY: `manager.log` is a non-null backref to the CLI log set at init().
                let root_package_json_entry = match manager.workspace_package_json_cache.get_with_path(
                    unsafe { &mut *manager.log },
                    root_package_json_path.as_bytes(),
                    Default::default(),
                ) {
                    WorkspacePackageJsonCacheResult::Entry(entry) => entry,
                    WorkspacePackageJsonCacheResult::ReadErr(err) => {
                        if unsafe { (*ctx.log).errors } > 0 {
                            unsafe { &*manager.log }
                                .print(Output::error_writer() as *mut _)
                                .map_err(|_| bun_core::err!("WriteFailed"))?;
                        }
                        Output::err(err, "failed to read '{}'", format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())));
                        Global::exit(1);
                    }
                    WorkspacePackageJsonCacheResult::ParseErr(err) => {
                        if unsafe { (*ctx.log).errors } > 0 {
                            unsafe { &*manager.log }
                                .print(Output::error_writer() as *mut _)
                                .map_err(|_| bun_core::err!("WriteFailed"))?;
                        }
                        Output::err(err, "failed to parse '{}'", format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())));
                        Global::exit(1);
                    }
                };

                let source_copy = root_package_json_entry.source;

                let mut resolver: () = ();
                // PORT NOTE: Zig passes `manager`, `manager.log` and a fresh
                // stack `lockfile` simultaneously. Route through raw ptrs so
                // borrowck doesn't see overlapping `&mut PackageManager` /
                // `&mut Lockfile` (Zig `*T` semantics).
                {
                    let mgr: *mut PackageManager = manager;
                    // SAFETY: `parse` only reads `*log` / `*mgr` between writes
                    // to `lockfile`/`maybe_root`; no field of `*mgr` aliases
                    // the local `lockfile`.
                    let log = unsafe { (*mgr).log };
                    maybe_root.parse(
                        &mut lockfile,
                        unsafe { &mut *mgr },
                        unsafe { &mut *log },
                        &source_copy,
                        &mut resolver,
                        Features::main(),
                    )?;
                }
                let mut mapping = vec![invalid_package_id; maybe_root.dependencies.len as usize].into_boxed_slice();
                // @memset already done via vec! init

                // PORT NOTE: Zig passes `manager`, `manager.log`, `manager.lockfile` and a
                // fresh `lockfile` simultaneously. Route through raw ptrs to satisfy
                // borrowck; `Diff::generate` is ported in lockfile_real::package.
                manager.summary = {
                    let mgr: *mut PackageManager = manager;
                    // SAFETY: `mgr` is the sole provenance root for the manager
                    // from here on; `Diff::generate` reborrows disjoint fields
                    // (`log`, `lockfile`, `update_requests`) through it. No
                    // other live `&mut` to `*mgr` exists across the call.
                    let log = unsafe { (*mgr).log };
                    let from_lockfile: *mut Lockfile = unsafe { &mut *(*mgr).lockfile };
                    let update_requests = if unsafe { (*mgr).to_update } {
                        Some(unsafe { &(*mgr).update_requests[..] })
                    } else {
                        None
                    };
                    Diff::generate(
                        unsafe { &mut *mgr },
                        unsafe { &mut *log },
                        unsafe { &mut *from_lockfile },
                        &mut lockfile,
                        &root,
                        &maybe_root,
                        update_requests,
                        Some(&mut mapping[..]),
                    )?
                };

                had_any_diffs = manager.summary.has_diffs();

                // PORT NOTE: reshaped for borrowck — `string_builder()` borrows
                // `&mut manager.lockfile.{buffers.string_bytes, string_pool}`
                // for the builder's lifetime, but the body below also touches
                // `manager.lockfile.{packages, buffers.dependencies, …}` and
                // `manager` itself. Derive a single raw provenance root for the
                // *new* lockfile (`manager.lockfile`) so we can hand-reborrow
                // disjoint columns alongside the builder (Zig `*T` semantics).
                let mgr: *mut PackageManager = manager;
                // SAFETY: `mgr` is the sole provenance root from here through
                // `builder.clamp()`. Every reborrow of `*to_lockfile` below is
                // for a field disjoint from `string_bytes`/`string_pool` (the
                // two columns the builder owns), so no `&mut` overlap.
                let to_lockfile: *mut Lockfile = unsafe { &mut *(*mgr).lockfile };

                if !had_any_diffs {
                    // always grab latest scripts for root package
                    let mut builder_ = unsafe { &mut *to_lockfile }.string_builder();
                    let builder = &mut builder_;

                    maybe_root.scripts.count(&lockfile.buffers.string_bytes, builder);
                    builder.allocate()?;
                    unsafe { &mut (*to_lockfile).packages }.items_scripts_mut()[0] =
                        maybe_root.scripts.clone_into(&lockfile.buffers.string_bytes, builder);
                    builder.clamp();
                } else {
                    let mut builder_ = unsafe { &mut *to_lockfile }.string_builder();
                    // ensure we use one pointer to reference it instead of creating new ones and potentially aliasing
                    let builder = &mut builder_;
                    // If you changed packages, we will copy over the new package from the new lockfile
                    let new_dependencies = maybe_root.dependencies.get(&lockfile.buffers.dependencies);

                    for new_dep in new_dependencies {
                        new_dep.count(&lockfile.buffers.string_bytes, builder);
                    }

                    for path in lockfile.workspace_paths.values() {
                        builder.count(path.slice(&lockfile.buffers.string_bytes));
                    }
                    for version in lockfile.workspace_versions.values() {
                        version.count(&lockfile.buffers.string_bytes, builder);
                    }
                    for patch_dep in lockfile.patched_dependencies.values() {
                        builder.count(patch_dep.path.slice(&lockfile.buffers.string_bytes));
                    }

                    // PORT NOTE: reshaped for borrowck — Zig passes `&lockfile`
                    // while also borrowing `lockfile.overrides` / `.catalogs`.
                    // `count` only reads `lockfile.buffers.string_bytes`, so
                    // route through a raw ptr derived first (Zig `*T` semantics).
                    {
                        let lockfile_ptr: *mut Lockfile = &mut lockfile;
                        // SAFETY: `count` only reads `(*lockfile_ptr).buffers.
                        // string_bytes`; no overlap with the disjoint
                        // `.overrides`/`.catalogs` field reborrows.
                        unsafe { (*lockfile_ptr).overrides.count(&mut *lockfile_ptr, builder) };
                        unsafe { (*lockfile_ptr).catalogs.count(&mut *lockfile_ptr, builder) };
                    }
                    maybe_root.scripts.count(&lockfile.buffers.string_bytes, builder);

                    let off = unsafe { &(*to_lockfile).buffers.dependencies }.len() as u32;
                    let len = new_dependencies.len() as u32;
                    let old_resolutions_list = unsafe { &(*to_lockfile).packages }.items_resolutions()[0];
                    unsafe { &mut (*to_lockfile).packages }.items_dependencies_mut()[0] =
                        lockfile::DependencySlice::new(off, len);
                    unsafe { &mut (*to_lockfile).packages }.items_resolutions_mut()[0] =
                        lockfile::PackageIDSlice::new(off, len);
                    builder.allocate()?;

                    let all_name_hashes: Vec<PackageNameHash> = 'brk: {
                        if !unsafe { &(*mgr).summary }.overrides_changed {
                            break 'brk Vec::new();
                        }
                        let hashes_len =
                            unsafe { &(*to_lockfile).overrides }.map.len() + lockfile.overrides.map.len();
                        if hashes_len == 0 {
                            break 'brk Vec::new();
                        }
                        let mut all_name_hashes: Vec<PackageNameHash> = Vec::with_capacity(hashes_len);
                        all_name_hashes.extend_from_slice(unsafe { &(*to_lockfile).overrides }.map.keys());
                        all_name_hashes.extend_from_slice(lockfile.overrides.map.keys());
                        let mut i = unsafe { &(*to_lockfile).overrides }.map.len();
                        while i < all_name_hashes.len() {
                            if all_name_hashes[..i].contains(&all_name_hashes[i]) {
                                let last = all_name_hashes.len() - 1;
                                all_name_hashes[i] = all_name_hashes[last];
                                all_name_hashes.truncate(last);
                            } else {
                                i += 1;
                            }
                        }
                        break 'brk all_name_hashes;
                    };

                    // PORT NOTE: reshaped for borrowck — Zig: `lockfile.overrides
                    // .clone(manager, &lockfile, manager.lockfile, builder)`
                    // borrows `manager` + `manager.lockfile` + the local
                    // `lockfile` + a field of `lockfile`. Route through the raw
                    // provenance roots derived above (`mgr`, `to_lockfile`).
                    {
                        let from_lockfile: *mut Lockfile = &mut lockfile;
                        // SAFETY: `clone` reads `*from_lockfile` (string_bytes)
                        // and appends into `*to_lockfile` via `builder`; the
                        // four reborrows touch disjoint storage.
                        unsafe {
                            (*to_lockfile).overrides = (*from_lockfile).overrides.clone(
                                &mut *mgr,
                                &*from_lockfile,
                                builder,
                            )?;
                            (*to_lockfile).catalogs = (*from_lockfile).catalogs.clone(
                                &mut *mgr,
                                &*from_lockfile,
                                builder,
                            )?;
                        }
                    }

                    unsafe { (*to_lockfile).trusted_dependencies = lockfile.trusted_dependencies.clone() };

                    unsafe { &mut (*to_lockfile).buffers.dependencies }.reserve(len as usize);
                    unsafe { &mut (*to_lockfile).buffers.resolutions }.reserve(len as usize);

                    // PORT NOTE: copy `old_resolutions` to a temporary Vec —
                    // the slice indexes into `buffers.resolutions`, which we're
                    // about to grow via spare-capacity writes / `set_len` below.
                    let old_resolutions: Vec<PackageID> = old_resolutions_list
                        .get(unsafe { &(*to_lockfile).buffers.resolutions })
                        .to_vec();

                    // PORT NOTE: Zig slices raw spare capacity via `.items.ptr[off .. off + len]`,
                    // `@memset`s it (no drop), then extends `.items.len`. Mirror that ordering:
                    // write into `spare_capacity_mut()` (MaybeUninit) and only then `set_len`, so we
                    // never form `&mut [T]` over uninitialized storage and never drop garbage.
                    debug_assert_eq!(unsafe { &(*to_lockfile).buffers.dependencies }.len(), off as usize);
                    debug_assert_eq!(unsafe { &(*to_lockfile).buffers.resolutions }.len(), off as usize);
                    {
                        let spare = unsafe { &mut (*to_lockfile).buffers.dependencies }.spare_capacity_mut();
                        for slot in &mut spare[..len as usize] {
                            slot.write(Dependency::default());
                        }
                    }
                    {
                        let spare = unsafe { &mut (*to_lockfile).buffers.resolutions }.spare_capacity_mut();
                        for slot in &mut spare[..len as usize] {
                            slot.write(invalid_package_id);
                        }
                    }
                    // SAFETY: capacity reserved above and the `[off .. off+len)` tail was just
                    // initialized via `MaybeUninit::write`.
                    unsafe {
                        (*to_lockfile).buffers.dependencies.set_len((off + len) as usize);
                        (*to_lockfile).buffers.resolutions.set_len((off + len) as usize);
                    }

                    for (i, new_dep) in new_dependencies.iter().enumerate() {
                        // SAFETY: `clone_in` appends to `builder` (string_bytes) and reads
                        // `*mgr` for the npm-alias registry; neither overlaps the
                        // `buffers.dependencies`/`resolutions` slots we write here.
                        let cloned =
                            new_dep.clone_in(unsafe { &mut *mgr }, &lockfile.buffers.string_bytes, builder)?;
                        unsafe { &mut (*to_lockfile).buffers.dependencies }[off as usize + i] = cloned;
                        if mapping[i] != invalid_package_id {
                            unsafe { &mut (*to_lockfile).buffers.resolutions }[off as usize + i] =
                                old_resolutions[mapping[i] as usize];
                        }
                    }

                    unsafe { &mut (*to_lockfile).packages }.items_scripts_mut()[0] =
                        maybe_root.scripts.clone_into(&lockfile.buffers.string_bytes, builder);

                    // Update workspace paths
                    {
                        let dst = unsafe { &mut (*to_lockfile).workspace_paths };
                        dst.reserve(lockfile.workspace_paths.len());
                        dst.clear();
                        let mut iter = lockfile.workspace_paths.iter();
                        while let Some((key, value)) = iter.next() {
                            // The string offsets will be wrong so fix them
                            let path = value.slice(&lockfile.buffers.string_bytes);
                            let str = builder.append::<SemverString>(path);
                            // PERF(port): was assume_capacity
                            dst.insert(*key, str);
                        }
                    }

                    // Update workspace versions
                    {
                        let dst = unsafe { &mut (*to_lockfile).workspace_versions };
                        dst.reserve(lockfile.workspace_versions.len());
                        dst.clear();
                        let mut iter = lockfile.workspace_versions.iter();
                        while let Some((key, value)) = iter.next() {
                            // Copy version string offsets
                            let version = value.append(&lockfile.buffers.string_bytes, builder);
                            // PERF(port): was assume_capacity
                            dst.insert(*key, version);
                        }
                    }

                    // Update patched dependencies
                    {
                        let mut iter = lockfile.patched_dependencies.iter();
                        while let Some((key, value)) = iter.next() {
                            let pkg_name_and_version_hash = *key;
                            debug_assert!(value.patchfile_hash_is_null);
                            let gop = unsafe { &mut (*to_lockfile).patched_dependencies }
                                .entry(pkg_name_and_version_hash);
                            // PORT NOTE: ArrayHashMap getOrPut semantics → entry API approximation
                            match gop {
                                bun_collections::array_hash_map::MapEntry::Vacant(v) => {
                                    let mut new = crate::lockfile_real::PatchedDep {
                                        path: builder.append::<SemverString>(
                                            value.path.slice(&lockfile.buffers.string_bytes),
                                        ),
                                        ..Default::default()
                                    };
                                    new.set_patchfile_hash(None);
                                    v.insert(new);
                                    // gop.value_ptr.path = gop.value_ptr.path;
                                }
                                bun_collections::array_hash_map::MapEntry::Occupied(mut o) => {
                                    if !strings::eql(
                                        o.get().path.slice(builder.string_bytes.as_slice()),
                                        value.path.slice(&lockfile.buffers.string_bytes),
                                    ) {
                                        o.get_mut().path = builder.append::<SemverString>(
                                            value.path.slice(&lockfile.buffers.string_bytes),
                                        );
                                        o.get_mut().set_patchfile_hash(None);
                                    }
                                }
                            }
                        }

                        let mut count: usize = 0;
                        for (key, _) in unsafe { &(*to_lockfile).patched_dependencies }.iter() {
                            if !lockfile.patched_dependencies.contains_key(key) {
                                count += 1;
                            }
                        }
                        if count > 0 {
                            let to_remove_set =
                                unsafe { &mut (*mgr).patched_dependencies_to_remove };
                            to_remove_set.reserve(count);
                            for (key, _) in unsafe { &(*to_lockfile).patched_dependencies }.iter() {
                                if !lockfile.patched_dependencies.contains_key(key) {
                                    to_remove_set.insert(*key, ());
                                }
                            }
                            let to_remove: Vec<u64> = to_remove_set.keys().to_vec();
                            for hash in to_remove {
                                let _ = unsafe { &mut (*to_lockfile).patched_dependencies }
                                    .ordered_remove(&hash);
                            }
                        }
                    }

                    builder.clamp();
                    drop(builder_);

                    // `enqueueDependencyWithMain` can reach `Lockfile.Package.fromNPM`,
                    // which grows `buffers.dependencies` and may reallocate it.
                    // Iterate by index against a snapshot of the original length and
                    // copy each entry to the stack so neither the loop nor the callee
                    // ever reads through a pointer into the old backing storage.
                    if manager.summary.overrides_changed && !all_name_hashes.is_empty() {
                        let dependencies_len = manager.lockfile.buffers.dependencies.len();
                        for dependency_i in 0..dependencies_len {
                            let dependency = manager.lockfile.buffers.dependencies[dependency_i];
                            if all_name_hashes.contains(&dependency.name_hash) {
                                manager.lockfile.buffers.resolutions[dependency_i] = invalid_package_id;
                                if let Err(err) = enqueue_dependency_with_main(
                                    manager,
                                    dependency_i as u32,
                                    &dependency,
                                    invalid_package_id,
                                    false,
                                ) {
                                    add_dependency_error(manager, &dependency, err);
                                }
                            }
                        }
                    }

                    if manager.summary.catalogs_changed {
                        let dependencies_len = manager.lockfile.buffers.dependencies.len();
                        for _dep_id in 0..dependencies_len {
                            let dep_id: DependencyID = u32::try_from(_dep_id).unwrap();
                            let dep = manager.lockfile.buffers.dependencies[dep_id as usize];
                            if dep.version.tag != DependencyVersionTag::Catalog {
                                continue;
                            }

                            manager.lockfile.buffers.resolutions[dep_id as usize] = invalid_package_id;
                            if let Err(err) = enqueue_dependency_with_main(
                                manager,
                                dep_id,
                                &dep,
                                invalid_package_id,
                                false,
                            ) {
                                add_dependency_error(manager, &dep, err);
                            }
                        }
                    }

                    // Split this into two passes because the below may allocate memory or invalidate pointers
                    if manager.summary.add > 0 || manager.summary.update > 0 {
                        let changes = mapping.len() as PackageID;
                        let mut counter_i: PackageID = 0;

                        let _ = manager.get_cache_directory();
                        let _ = manager.get_temporary_directory();

                        while counter_i < changes {
                            if mapping[counter_i as usize] == invalid_package_id {
                                let dependency_i = counter_i + off;
                                let dependency = manager.lockfile.buffers.dependencies[dependency_i as usize];
                                let resolution = manager.lockfile.buffers.resolutions[dependency_i as usize];
                                if let Err(err) = enqueue_dependency_with_main(
                                    manager,
                                    dependency_i,
                                    &dependency,
                                    resolution,
                                    false,
                                ) {
                                    add_dependency_error(manager, &dependency, err);
                                }
                            }
                            counter_i += 1;
                        }
                    }

                    if manager.summary.update > 0 {
                        root.scripts = Default::default();
                    }
                }
            }
        }
        _ => {}
    }

    if needs_new_lockfile {
        root = Default::default();
        manager.lockfile.init_empty();

        if manager.options.enable.frozen_lockfile() && !matches!(load_result, lockfile::LoadResult::NotFound) {
            if log_level != Options::LogLevel::Silent {
                Output::pretty_errorln("<r><red>error<r>: lockfile had changes, but lockfile is frozen");
            }
            Global::crash();
        }

        // SAFETY: `manager.log` is a non-null backref to the CLI log set at init().
        let root_package_json_entry = match manager.workspace_package_json_cache.get_with_path(
            unsafe { &mut *manager.log },
            root_package_json_path.as_bytes(),
            Default::default(),
        ) {
            WorkspacePackageJsonCacheResult::Entry(entry) => entry,
            WorkspacePackageJsonCacheResult::ReadErr(err) => {
                if unsafe { (*ctx.log).errors } > 0 {
                    unsafe { &*manager.log }
                        .print(Output::error_writer() as *mut _)
                        .map_err(|_| bun_core::err!("WriteFailed"))?;
                }
                Output::err(err, "failed to read '{}'", format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())));
                Global::exit(1);
            }
            WorkspacePackageJsonCacheResult::ParseErr(err) => {
                if unsafe { (*ctx.log).errors } > 0 {
                    unsafe { &*manager.log }
                        .print(Output::error_writer() as *mut _)
                        .map_err(|_| bun_core::err!("WriteFailed"))?;
                }
                Output::err(err, "failed to parse '{}'", format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())));
                Global::exit(1);
            }
        };

        let source_copy = root_package_json_entry.source;

        let mut resolver: () = ();
        {
            let mgr: *mut PackageManager = manager;
            // SAFETY: `mgr` is the sole provenance root; `parse` reborrows
            // disjoint fields (`lockfile`, `log`) through it. No other live
            // `&mut` to `*mgr` exists across the call.
            let log = unsafe { (*mgr).log };
            root.parse(
                unsafe { &mut (*mgr).lockfile },
                unsafe { &mut *mgr },
                unsafe { &mut *log },
                &source_copy,
                &mut resolver,
                Features::main(),
            )?;
        }

        root = manager.lockfile.append_package(root)?;

        if root.dependencies.len > 0 {
            let _ = manager.get_cache_directory();
            let _ = manager.get_temporary_directory();
        }
        {
            let keys: Vec<u64> = manager.lockfile.patched_dependencies.keys().to_vec();
            for key in keys {
                let task = PatchTask::new_calc_patch_hash(manager, key, None);
                enqueue_patch_task_pre(manager, task);
            }
        }
        enqueue_dependency_list(manager, root.dependencies);
    } else {
        {
            let keys: Vec<u64> = manager.lockfile.patched_dependencies.keys().to_vec();
            for key in keys {
                let task = PatchTask::new_calc_patch_hash(manager, key, None);
                enqueue_patch_task_pre(manager, task);
            }
        }
        // Anything that needs to be downloaded from an update needs to be scheduled here
        manager.drain_dependency_list();
    }

    if manager.pending_task_count() > 0 || manager.peer_dependencies.readable_length() > 0 {
        if root.dependencies.len > 0 {
            let _ = manager.get_cache_directory();
            let _ = manager.get_temporary_directory();
        }

        if log_level.show_progress() {
            manager.start_progress_bar();
        } else if log_level != Options::LogLevel::Silent {
            Output::pretty_errorln("Resolving dependencies");
            Output::flush();
        }

        if manager.lockfile.patched_dependencies.len() > 0 {
            wait_for_calcing_patch_hashes(manager)?;
        }

        if manager.pending_task_count() > 0 {
            wait_for_everything_except_peers(manager)?;
        }

        // Resolving a peer dep can create a NEW package whose own peer deps
        // get re-queued to `peer_dependencies` during `drainDependencyList`.
        // When all manifests are cached (synchronous resolution), no I/O tasks
        // are spawned, so `pendingTaskCount() == 0`. We must drain the peer
        // queue iteratively here — entering the event loop (`waitForPeers`)
        // with zero pending I/O would block forever.
        while manager.peer_dependencies.readable_length() > 0 {
            manager.process_peer_dependency_list()?;
            manager.drain_dependency_list();
        }

        if manager.pending_task_count() > 0 {
            wait_for_peers(manager)?;
        }

        if log_level.show_progress() {
            manager.end_progress_bar();
        } else if log_level != Options::LogLevel::Silent {
            Output::pretty_errorln(format_args!(
                "Resolved, downloaded and extracted [{}]",
                manager.total_tasks,
            ));
            Output::flush();
        }
    }

    // SAFETY: `manager.log` is a non-null backref to the CLI log set at init().
    let had_errors_before_cleaning_lockfile = unsafe { &*manager.log }.has_errors();
    unsafe { &*manager.log }
        .print(Output::error_writer() as *mut _)
        .map_err(|_| bun_core::err!("WriteFailed"))?;
    unsafe { &mut *manager.log }.reset();

    // This operation doesn't perform any I/O, so it should be relatively cheap.
    // PORT NOTE: Zig copies the `*Lockfile` pointer, leaving `manager.lockfile` intact so both
    // old and new lockfiles are live for the later `eql(lockfile_before_clean, ...)` checks.
    // In Rust `manager.lockfile: Box<Lockfile>` would move; compute the new lockfile first, then
    // `mem::replace` so `lockfile_before_clean` owns the old box and `manager.lockfile` the new.
    let new_lockfile = {
        let mgr: *mut PackageManager = manager;
        // SAFETY: `lockfile`, `update_requests`, and `*log` are disjoint storage
        // within `*mgr`; `clean_with_logger` only reads `manager` for option flags
        // and its preinstall_state, so a single raw provenance root keeps all
        // reborrows under one tag (PORTING.md §Aliasing-split-borrow).
        unsafe {
            let log = (*mgr).log;
            let exact_versions = (*mgr).options.enable.exact_versions();
            Lockfile::clean_with_logger(
                &mut (*mgr).lockfile,
                &mut *mgr,
                &mut (*mgr).update_requests,
                &mut *log,
                exact_versions,
                log_level,
            )?
        }
    };
    let lockfile_before_clean = core::mem::replace(&mut manager.lockfile, new_lockfile);

    if manager.lockfile.packages.len() > 0 {
        root = manager.lockfile.packages.get(0);
    }

    if manager.lockfile.packages.len() > 0 {
        for request in &manager.update_requests {
            // prevent redundant errors
            if request.failed {
                return Err(bun_core::err!("InstallFailed"));
            }
        }

        manager.verify_resolutions(log_level);

        if manager.options.security_scanner.is_some() {
            let is_subcommand_to_run_scanner = matches!(
                manager.subcommand,
                Subcommand::Add
                    | Subcommand::Update
                    | Subcommand::Install
                    | Subcommand::Remove
            );

            if is_subcommand_to_run_scanner {
                match security_scanner::perform_security_scan_after_resolution(manager, ctx, original_cwd) {
                    Err(err) => {
                        match err {
                            e if e == bun_core::err!("SecurityScannerInWorkspace") => {
                                Output::err_generic("security scanner cannot be a dependency of a workspace package. It must be a direct dependency of the root package.", ());
                            }
                            e if e == bun_core::err!("SecurityScannerRetryFailed") => {
                                Output::err_generic("security scanner failed after partial install. This is probably a bug in Bun. Please report it at https://github.com/oven-sh/bun/issues", ());
                            }
                            e if e == bun_core::err!("InvalidPackageID") => {
                                Output::err_generic("cannot perform partial install: security scanner package ID is invalid", ());
                            }
                            e if e == bun_core::err!("PartialInstallFailed") => {
                                Output::err_generic("failed to install security scanner package", ());
                            }
                            e if e == bun_core::err!("NoPackagesInstalled") => {
                                Output::err_generic("no packages were installed during security scanner installation", ());
                            }
                            e if e == bun_core::err!("IPCPipeFailed") => {
                                Output::err_generic("failed to create IPC pipe for security scanner", ());
                            }
                            e if e == bun_core::err!("ProcessWatchFailed") => {
                                Output::err_generic("failed to watch security scanner process", ());
                            }
                            e => {
                                Output::err_generic("security scanner failed: {}", format_args!("{}", e.name()));
                            }
                        }

                        Global::exit(1);
                    }
                    Ok(Some(results)) => {
                        // `results` drops at end of scope (Zig had `defer results_mut.deinit()`)
                        security_scanner::print_security_advisories(manager, &results);

                        if results.has_fatal_advisories() {
                            Output::pretty(format_args!("<red>Installation aborted due to fatal security advisories<r>\n"));
                            Global::exit(1);
                        } else if results.has_warnings() {
                            if !security_scanner::prompt_for_warnings() {
                                Global::exit(1);
                            }
                        }
                    }
                    Ok(None) => {}
                }
            }
        }
    }

    // append scripts to lockfile before generating new metahash
    manager.load_root_lifecycle_scripts(&root);
    // Zig: `defer { if (root_lifecycle_scripts) |s| allocator.free(s.package_name) }`.
    // `List.package_name` is `Box<[u8]>`, so dropping the whole `Option<List>`
    // at scope exit frees it. Route through a raw provenance root because
    // `manager: &mut` is reborrowed many times below; the guard fires once on
    // the way out and is the only access at that point.
    let mgr_for_root_scripts_cleanup: *mut PackageManager = manager;
    scopeguard::defer! {
        // SAFETY: `mgr_for_root_scripts_cleanup` was derived from the live
        // exclusive `manager` borrow above; this guard runs once at scope exit
        // (before `manager` is returned to the caller) and is the sole access
        // to `*mgr_for_root_scripts_cleanup` at that instant.
        unsafe { (*mgr_for_root_scripts_cleanup).root_lifecycle_scripts = None };
    };

    if let Some(root_scripts) = &manager.root_lifecycle_scripts {
        root_scripts.append_to_lockfile(&mut manager.lockfile);
    }
    {
        // PORT NOTE: reshaped for borrowck — Zig holds shared slices into
        // `packages.items(.resolution/.meta/.scripts)` while pushing into
        // `manager.lockfile.scripts`. Iterate by index and copy each row to
        // the stack so the `&mut manager.lockfile.scripts` write doesn't
        // overlap a live `&manager.lockfile.packages` borrow.
        let lockfile: *mut Lockfile = &mut *manager.lockfile;
        // SAFETY: `packages` (read-only column slices) and `scripts` (the
        // `Vec` push targets) are disjoint fields of `*lockfile`.
        let packages_len = unsafe { &(*lockfile).packages }.len();
        for pkg_i in 0..packages_len {
            let resolution = unsafe { &(*lockfile).packages }.items_resolution()[pkg_i];
            if resolution.tag != ResolutionTag::Workspace {
                continue;
            }
            let meta = unsafe { &(*lockfile).packages }.items_meta()[pkg_i];
            if !meta.has_install_script() {
                continue;
            }
            let scripts = unsafe { &(*lockfile).packages }.items_scripts()[pkg_i];
            let add_node_gyp = !scripts.has_any();
            let (first_index, _, entries) = scripts.get_script_entries(
                unsafe { &*lockfile },
                unsafe { &(*lockfile).buffers.string_bytes },
                ResolutionTag::Workspace,
                add_node_gyp,
            );

            if cfg!(debug_assertions) {
                debug_assert!(first_index != -1);
            }

            // Zig's two arms differ only in whether the `first_index != -1`
            // guard wraps the inner loop; in the `add_node_gyp` arm the
            // assert already guarantees it, so a single guarded loop matches
            // both paths exactly.
            if first_index != -1 {
                // PERF(port): was `inline for` over comptime entries — profile in Phase B
                for (i, maybe_entry) in entries.into_iter().enumerate() {
                    if let Some(entry) = maybe_entry {
                        unsafe { &mut (*lockfile).scripts }.hook_mut(i).push(entry);
                    }
                }
            }
        }
    }

    if manager.options.global {
        setup_global_dir(manager, &ctx)?;
    }

    let packages_len_before_install = manager.lockfile.packages.len();

    if manager.options.enable.frozen_lockfile() && !matches!(load_result, lockfile::LoadResult::NotFound) {
        'frozen_lockfile: {
            if load_result.loaded_from_text_lockfile() {
                if bun_core::handle_oom(Lockfile::eql(
                    &manager.lockfile,
                    &lockfile_before_clean,
                    packages_len_before_install,
                )) {
                    break 'frozen_lockfile;
                }
            } else {
                if !(manager
                    .lockfile
                    .has_meta_hash_changed(
                        PackageManager::verbose_install() || manager.options.do_.print_meta_hash_string(),
                        packages_len_before_install,
                    )
                    .unwrap_or(false))
                {
                    break 'frozen_lockfile;
                }
            }

            if log_level != Options::LogLevel::Silent {
                Output::pretty_errorln("<r><red>error<r><d>:<r> lockfile had changes, but lockfile is frozen");
                Output::note("try re-running without <d>--frozen-lockfile<r> and commit the updated lockfile");
            }
            Global::crash();
        }
    }

    let lockfile_before_install: *const Lockfile = &*manager.lockfile;

    let save_format = load_result.save_format(&manager.options);

    if manager.options.lockfile_only {
        // save the lockfile and exit. make sure metahash is generated for binary lockfile

        manager.lockfile.meta_hash = manager.lockfile.generate_meta_hash(
            PackageManager::verbose_install() || manager.options.do_.print_meta_hash_string(),
            packages_len_before_install,
        )?;

        // SAFETY: `lockfile_before_install` was derived from `manager.lockfile`
        // above and the box hasn't been replaced; it points at the same
        // allocation `save_lockfile` will read against itself.
        save_lockfile(
            manager,
            &load_result,
            save_format,
            had_any_diffs,
            unsafe { &*lockfile_before_install },
            packages_len_before_install,
            log_level,
        )?;

        if manager.options.do_.summary() {
            // TODO(dylan-conway): packages aren't installed but we can still print
            // added/removed/updated direct dependencies.
            Output::pretty(format_args!(
                "\nSaved <green>{}<r> ({} package{}) ",
                match save_format {
                    lockfile::Format::Text => "bun.lock",
                    lockfile::Format::Binary => "bun.lockb",
                },
                manager.lockfile.packages.len(),
                if manager.lockfile.packages.len() == 1 { "" } else { "s" },
            ));
            // TODO(port): Output::pretty multi-arg formatting — Zig used positional `{s} {d} {s}`
            Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
            Output::pretty(format_args!("\n"));
        }
        Output::flush();
        return Ok(());
    }

    let (workspace_filters, install_root_dependencies) = get_workspace_filters(manager, original_cwd)?;
    // `workspace_filters` drops at end of scope (Zig had `defer manager.allocator.free(workspace_filters)`)

    let install_summary: PackageInstallSummary = 'install_summary: {
        if !manager.options.do_.install_packages() {
            break 'install_summary PackageInstallSummary::default();
        }

        // Zig `linker: switch` with `continue :linker` — emulate with a small loop.
        let mut linker = manager.options.node_linker;
        loop {
            match linker {
                NodeLinker::Auto => match config_version {
                    ConfigVersion::V0 => {
                        linker = NodeLinker::Hoisted;
                        continue;
                    }
                    ConfigVersion::V1 => {
                        if !load_result.migrated_from_npm() && manager.lockfile.workspace_paths.len() > 0 {
                            linker = NodeLinker::Isolated;
                            continue;
                        }
                        linker = NodeLinker::Hoisted;
                        continue;
                    }
                },

                NodeLinker::Hoisted => {
                    break 'install_summary install_hoisted_packages(
                        manager,
                        ctx,
                        &workspace_filters,
                        install_root_dependencies,
                        log_level,
                        None,
                    )?;
                }

                NodeLinker::Isolated => {
                    break 'install_summary install_isolated_packages(
                        manager,
                        ctx,
                        install_root_dependencies,
                        &workspace_filters,
                        None,
                    )?;
                    // PERF(port): was bun.handleOom — install_isolated_packages aborts on OOM internally now
                }
            }
        }
    };

    if log_level != Options::LogLevel::Silent {
        manager
            .log_mut()
            .print(Output::error_writer() as *mut _)
            .map_err(|_| bun_core::err!("WriteFailed"))?;
    }
    if had_errors_before_cleaning_lockfile || manager.log_mut().has_errors() {
        Global::crash();
    }

    let did_meta_hash_change =
        // If the lockfile was frozen, we already checked it
        !manager.options.enable.frozen_lockfile
            && if load_result.loaded_from_text_lockfile() {
                !manager.lockfile.eql(&lockfile_before_clean, packages_len_before_install)?
            } else {
                manager.lockfile.has_meta_hash_changed(
                    PackageManager::verbose_install() || manager.options.do_.print_meta_hash_string,
                    packages_len_before_install.min(manager.lockfile.packages.len()),
                )?
            };

    // It's unnecessary work to re-save the lockfile if there are no changes
    let should_save_lockfile = (matches!(load_result, lockfile::LoadResult::Ok { .. })
        && ((load_result.ok().format == lockfile::Format::Binary && save_format == lockfile::Format::Text)
            // make sure old versions are updated
            || load_result.ok().format == lockfile::Format::Text
                && save_format == lockfile::Format::Text
                && manager.lockfile.text_lockfile_version != TextLockfile::Version::CURRENT))
        // check `save_lockfile` after checking if loaded from binary and save format is text
        // because `save_lockfile` is set to false for `--frozen-lockfile`
        || (manager.options.do_.save_lockfile
            && (did_meta_hash_change
                || had_any_diffs
                || !manager.update_requests.is_empty()
                || (matches!(load_result, lockfile::LoadResult::Ok { .. })
                    && (load_result.ok().serializer_result.packages_need_update
                        || load_result.ok().serializer_result.migrated_from_lockb_v2))
                || manager.lockfile.is_empty()
                || manager.options.enable.force_save_lockfile));

    if should_save_lockfile {
        manager.save_lockfile(
            &load_result,
            save_format,
            had_any_diffs,
            lockfile_before_install,
            packages_len_before_install,
            log_level,
        )?;
    }

    if needs_new_lockfile {
        manager.summary.add = manager.lockfile.packages.len() as u32;
    }

    if manager.options.do_.save_yarn_lock {
        let mut node_started = false;
        if log_level.show_progress() {
            manager.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
            let _ = manager.progress.start(b"Saving yarn.lock", 0);
            manager.progress.refresh();
            node_started = true;
        } else if log_level != Options::LogLevel::Silent {
            Output::pretty_errorln("Saved yarn.lock");
            Output::flush();
        }

        manager.write_yarn_lock()?;
        if log_level.show_progress() {
            if node_started {
                manager.progress.root.complete_one();
            }
            manager.progress.refresh();
            manager.progress.root.end();
            manager.progress = Default::default();
        }
    }

    if manager.options.do_.run_scripts && install_root_dependencies && !manager.options.global {
        if let Some(scripts) = manager.root_lifecycle_scripts.take() {
            if cfg!(debug_assertions) {
                debug_assert!(scripts.total > 0);
            }

            if log_level != Options::LogLevel::Silent {
                Output::print_error(format_args!("\n"));
                Output::flush();
            }
            // root lifecycle scripts can run now that all dependencies are installed, dependency scripts
            // have finished, and lockfiles have been saved
            let optional = false;
            let output_in_foreground = true;
            // PORT NOTE: Zig passes `scripts.*` (deref-copy of the List).
            // `spawn_package_lifecycle_scripts` consumes by-value; `.take()`
            // moves it out (Zig only frees `package_name` afterwards, which is
            // owned by the List in Rust and drops with it).
            manager.spawn_package_lifecycle_scripts(ctx, scripts, optional, output_in_foreground, None)?;

            // .monotonic is okay because at this point, this value is only accessed from this
            // thread.
            while manager.pending_lifecycle_script_tasks.load(Ordering::Relaxed) > 0 {
                manager.report_slow_lifecycle_scripts();
                manager.sleep();
            }
        }
    }

    if log_level != Options::LogLevel::Silent {
        print_install_summary(manager, ctx, &install_summary, did_meta_hash_change, log_level)?;
    }

    if install_summary.fail > 0 {
        manager.any_failed_to_install = true;
    }

    Output::flush();
    Ok(())
}

// ─── runAndWaitFn closure family ──────────────────────────────────────────
// Zig: `fn runAndWaitFn(comptime check_peers: bool, comptime only_pre_patch: bool) *const fn(*PackageManager) anyerror!void`
// Ported as a const-generic struct + three thin wrapper fns.

struct RunAndWaitClosure<const CHECK_PEERS: bool, const ONLY_PRE_PATCH: bool> {
    // PORT NOTE: Zig stores `*PackageManager` here while the caller also holds the same
    // pointer to call `sleepUntil`. Storing `&mut PackageManager` would alias the outer
    // borrow in `run_and_wait`. Keep a raw pointer; `run_and_wait` derives this pointer
    // first and then reborrows *through it* for the `sleep_until` receiver, so both the
    // receiver and the callback's reborrow share the same raw provenance root (Zig `*T`
    // semantics). See `run_and_wait` for the remaining `tick`/`event_loop` overlap note.
    manager: *mut PackageManager,
    err: Option<bun_core::Error>,
}

impl<const CHECK_PEERS: bool, const ONLY_PRE_PATCH: bool>
    RunAndWaitClosure<CHECK_PEERS, ONLY_PRE_PATCH>
{
    fn is_done(closure: &mut Self) -> bool {
        // SAFETY: `closure.manager` is the raw provenance root set in `run_and_wait`.
        // `sleep_until` is now an associated fn taking `*mut PackageManager` and
        // `AnyEventLoop::tick_raw` reborrows the event loop only *between* `is_done`
        // calls, so this `&mut PackageManager` is the unique live borrow for the
        // duration of the callback (no `&mut event_loop` straddles it). The original
        // `this: &mut` in `run_and_wait` is dead past the `let mgr = ...` line.
        let this = unsafe { &mut *closure.manager };
        if CHECK_PEERS {
            if let Err(err) = this.process_peer_dependency_list() {
                closure.err = Some(err);
                return true;
            }
        }

        this.drain_dependency_list();

        // PORT NOTE: void RunTasksCallbacks — `extract_ctx` is unit. Do NOT pass `this` as
        // both receiver and ctx (aliased &mut). Phase B: add a `VoidCallbacks` impl in
        // run_tasks.rs so this becomes `run_tasks::<VoidCallbacks>(this, &mut (), ..)`.
        let log_level = this.options.log_level;
        if let Err(err) = this.run_tasks(
            &mut (),
            RunTasksCallbacks {
                on_extract: (),
                on_resolve: (),
                on_package_manifest_error: (),
                on_package_download_error: (),
                progress_bar: true,
                manifests_only: false,
            },
            CHECK_PEERS,
            log_level,
        ) {
            closure.err = Some(err);
            return true;
        }

        if CHECK_PEERS {
            if this.peer_dependencies.readable_length() > 0 {
                return false;
            }
        }

        if ONLY_PRE_PATCH {
            let pending_patch = this.pending_pre_calc_hashes.load(Ordering::Relaxed);
            return pending_patch == 0;
        }

        let pending_tasks = this.pending_task_count();

        if PackageManager::verbose_install() && pending_tasks > 0 {
            if PackageManager::has_enough_time_passed_between_waiting_messages() {
                Output::pretty_errorln(format_args!(
                    "<d>[PackageManager]<r> waiting for {} tasks\n",
                    pending_tasks,
                ));
            }
        }

        pending_tasks == 0
    }

    fn run_and_wait(this: &mut PackageManager) -> Result<(), bun_core::Error> {
        // Derive the raw pointer first and route *every* manager access through it.
        // Previously `closure.manager` was taken from `this`, then `this` was reborrowed
        // into `sleep_until`'s `&mut self` — under Stacked Borrows that reborrow popped
        // the raw pointer's tag, so the later `&mut *closure.manager` in `is_done` used
        // an invalidated provenance. Now `mgr` is the root: both the `sleep_until`
        // receiver and the closure share it, and `this` is never touched again.
        let mgr: *mut PackageManager = this;
        let mut closure = RunAndWaitClosure::<CHECK_PEERS, ONLY_PRE_PATCH> {
            manager: mgr,
            err: None,
        };

        // SAFETY: `mgr` was just derived from the live exclusive `this` borrow above and
        // is the sole access path for the manager from here on. `sleep_until` takes the
        // raw pointer directly (no `&mut self` receiver) and `tick_raw` holds no
        // `&mut event_loop` across `is_done`, so `closure.manager`'s reborrow inside the
        // callback never invalidates a live tag.
        unsafe { PackageManager::sleep_until(mgr, &mut closure, Self::is_done) };

        if let Some(err) = closure.err {
            return Err(err);
        }
        Ok(())
    }
}

fn wait_for_calcing_patch_hashes(this: &mut PackageManager) -> Result<(), bun_core::Error> {
    RunAndWaitClosure::<false, true>::run_and_wait(this)
}
fn wait_for_everything_except_peers(this: &mut PackageManager) -> Result<(), bun_core::Error> {
    RunAndWaitClosure::<false, false>::run_and_wait(this)
}
fn wait_for_peers(this: &mut PackageManager) -> Result<(), bun_core::Error> {
    RunAndWaitClosure::<true, false>::run_and_wait(this)
}

fn print_install_summary(
    this: &mut PackageManager,
    ctx: Command::Context,
    install_summary: &PackageInstallSummary,
    did_meta_hash_change: bool,
    log_level: Options::LogLevel,
) -> Result<(), bun_core::Error> {
    let _flush_guard = Output::flush_guard();

    let mut printed_timestamp = false;
    if this.options.do_.summary {
        // PORT NOTE: reshaped for borrowck — Zig builds `Printer` borrowing
        // `this.lockfile` / `this.options` while also passing `this` (the
        // PackageManager) to `Tree::print`. Route through a single `*mut
        // PackageManager` provenance root and reborrow disjoint fields
        // through it (Zig `*T` semantics): `Tree::print` only reads
        // `manager.{updating_packages, workspace_name_hash}` and writes
        // `manager.track_installed_bin`, none of which overlap `lockfile` /
        // `options` / `update_requests`.
        let mgr: *mut PackageManager = this;
        // SAFETY: `mgr` is the sole provenance root from here through the
        // `Tree::print` call; the `Printer` reborrows shared `lockfile` /
        // `options` / `update_requests`, and the `&mut *mgr` passed to
        // `Tree::print` only touches disjoint `PackageManager` fields.
        let printer = Printer {
            lockfile: unsafe { &(*mgr).lockfile },
            options: unsafe { &(*mgr).options },
            updates: unsafe { &(*mgr).update_requests },
            successfully_installed: install_summary.successfully_installed.as_ref(),
        };

        {
            Output::flush();
            // Ensure at this point buffering is enabled.
            // We deliberately do not disable it after this.
            Output::enable_buffering();
            let writer = Output::writer_buffered();
            // Runtime bool → comptime dispatch (Zig `switch (b) { inline else => |c| ... }`).
            if Output::enable_ansi_colors_stdout() {
                LockfilePrinter::Tree::print::<_, true>(
                    &printer,
                    unsafe { &mut *mgr },
                    writer,
                    log_level,
                )?;
            } else {
                LockfilePrinter::Tree::print::<_, false>(
                    &printer,
                    unsafe { &mut *mgr },
                    writer,
                    log_level,
                )?;
            }
        }
        drop(printer);

        if !did_meta_hash_change {
            this.summary.remove = 0;
            this.summary.add = 0;
            this.summary.update = 0;
        }

        if install_summary.success > 0 {
            // it's confusing when it shows 3 packages and says it installed 1
            let pkgs_installed = install_summary.success.max(this.update_requests.len() as u32);
            Output::pretty(format_args!(
                "<green>{}<r> package{}<r> installed ",
                pkgs_installed,
                if pkgs_installed == 1 { "" } else { "s" },
            ));
            // TODO(port): Output::pretty multi-arg formatting
            Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
            printed_timestamp = true;
            print_blocked_packages_info(install_summary, this.options.global);

            if this.summary.remove > 0 {
                Output::pretty(format_args!("Removed: <cyan>{}<r>\n", this.summary.remove));
            }
        } else if this.summary.remove > 0 {
            if this.subcommand == Subcommand::Remove {
                for request in &this.update_requests {
                    Output::prettyln(format_args!("<r><red>-<r> {}", bstr::BStr::new(request.name)));
                }
            }

            Output::pretty(format_args!(
                "<r><b>{}<r> package{} removed ",
                this.summary.remove,
                if this.summary.remove == 1 { "" } else { "s" },
            ));
            // TODO(port): Output::pretty multi-arg formatting
            Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
            printed_timestamp = true;
            print_blocked_packages_info(install_summary, this.options.global);
        } else if install_summary.skipped > 0 && install_summary.fail == 0 && this.update_requests.is_empty() {
            let count = this.lockfile.packages.len() as PackageID;
            if count != install_summary.skipped {
                if !this.options.enable.only_missing {
                    Output::pretty(format_args!(
                        "Checked <green>{} install{}<r> across {} package{} <d>(no changes)<r> ",
                        install_summary.skipped,
                        if install_summary.skipped == 1 { "" } else { "s" },
                        count,
                        if count == 1 { "" } else { "s" },
                    ));
                    // TODO(port): Output::pretty multi-arg formatting
                    Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
                }
                printed_timestamp = true;
                print_blocked_packages_info(install_summary, this.options.global);
            } else {
                Output::pretty(format_args!(
                    "<r><green>Done<r>! Checked {} package{}<r> <d>(no changes)<r> ",
                    install_summary.skipped,
                    if install_summary.skipped == 1 { "" } else { "s" },
                ));
                // TODO(port): Output::pretty multi-arg formatting
                Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
                printed_timestamp = true;
                print_blocked_packages_info(install_summary, this.options.global);
            }
        }

        if install_summary.fail > 0 {
            Output::prettyln(format_args!(
                "<r>Failed to install <red><b>{}<r> package{}\n",
                install_summary.fail,
                if install_summary.fail == 1 { "" } else { "s" },
            ));
            // TODO(port): Output::pretty multi-arg formatting
            Output::flush();
        }
    }

    if this.options.do_.summary {
        if !printed_timestamp {
            Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
            Output::prettyln(format_args!("<d> done<r>"));
            printed_timestamp = true;
            let _ = printed_timestamp;
        }
    }

    Ok(())
}

fn print_blocked_packages_info(summary: &PackageInstallSummary, global: bool) {
    let packages_count = summary.packages_with_blocked_scripts.len();
    let mut scripts_count: usize = 0;
    for count in summary.packages_with_blocked_scripts.values() {
        scripts_count += *count;
    }

    if cfg!(debug_assertions) {
        // if packages_count is greater than 0, scripts_count must also be greater than 0.
        debug_assert!(packages_count == 0 || scripts_count > 0);
        // if scripts_count is 1, it's only possible for packages_count to be 1.
        debug_assert!(scripts_count != 1 || packages_count == 1);
    }

    if packages_count > 0 {
        Output::prettyln(format_args!(
            "\n\n<d>Blocked {} postinstall{}. Run `bun pm {}untrusted` for details.<r>\n",
            scripts_count,
            if scripts_count > 1 { "s" } else { "" },
            if global { "-g " } else { "" },
        ));
        // TODO(port): Output::pretty multi-arg formatting
    } else {
        Output::pretty(format_args!("<r>\n"));
    }
}

pub fn get_workspace_filters(
    manager: &mut PackageManager,
    original_cwd: &[u8],
) -> Result<(Vec<WorkspaceFilter>, bool), bun_core::Error> {
    let mut path_buf = bun_paths::path_buffer_pool::get();
    // RAII: guard puts the buffer back on Drop.

    let mut workspace_filters: Vec<WorkspaceFilter> = Vec::new();
    // only populated when subcommand is `.install`
    if manager.subcommand == Subcommand::Install
        && !manager.options.filter_patterns.is_empty()
    {
        workspace_filters.reserve(manager.options.filter_patterns.len());
        for pattern in &manager.options.filter_patterns {
            workspace_filters.push(WorkspaceFilter::init(pattern, original_cwd, &mut path_buf));
        }
    }

    let mut install_root_dependencies = workspace_filters.is_empty();
    if !install_root_dependencies {
        let pkg_names = manager.lockfile.packages.items_name();

        let abs_root_path: &[u8] = 'abs_root_path: {
            #[cfg(not(windows))]
            {
                break 'abs_root_path strings::without_trailing_slash(FileSystem::instance().top_level_dir());
            }

            #[cfg(windows)]
            {
                let abs_path = Path::path_to_posix_buf::<u8>(FileSystem::instance().top_level_dir, &mut path_buf.0);
                break 'abs_root_path strings::without_trailing_slash(
                    &abs_path[Path::windows_volume_name_len(abs_path).0..],
                );
            }
        };

        for filter in &workspace_filters {
            let (pattern, path_or_name): (&[u8], &[u8]) = match filter {
                WorkspaceFilter::Name(pattern) => (
                    pattern,
                    pkg_names[0].slice(&manager.lockfile.buffers.string_bytes),
                ),
                WorkspaceFilter::Path(pattern) => (pattern, abs_root_path),
                WorkspaceFilter::All => {
                    install_root_dependencies = true;
                    continue;
                }
            };

            match glob::r#match(pattern, path_or_name) {
                glob::MatchResult::Match | glob::MatchResult::NegateMatch => {
                    install_root_dependencies = true;
                }

                glob::MatchResult::NegateNoMatch => {
                    // always skip if a pattern specifically says "!<name>"
                    install_root_dependencies = false;
                    break;
                }

                glob::MatchResult::NoMatch => {}
            }
        }
    }

    Ok((workspace_filters, install_root_dependencies))
}

/// Adds a contextual error for a dependency resolution failure.
/// This provides better error messages than just propagating the raw error.
/// The error is logged to manager.log, and the install will fail later when
/// manager.log.hasErrors() is checked.
fn add_dependency_error(manager: &mut PackageManager, dependency: &Dependency, err: bun_core::Error) {
    // PORT NOTE: reshaped for borrowck — capture the realname slice before
    // taking `&mut` on `manager.log` (Zig held both via shared `*` pointers).
    let realname = dependency.realname();
    let path = manager.lockfile.str(&realname).to_vec();
    let path_fmt = bun_core::fmt::fmt_path(
        &path,
        bun_core::fmt::PathFormatOptions {
            path_sep: match dependency.version.tag {
                DependencyVersionTag::Folder => bun_core::fmt::PathSep::Auto,
                _ => bun_core::fmt::PathSep::Any,
            },
            ..Default::default()
        },
    );

    if dependency.behavior.is_optional() || dependency.behavior.is_peer() {
        bun_core::handle_oom(manager.log_mut().add_warning_with_note(
            None,
            Default::default(),
            err.name().as_bytes(),
            format_args!("error occurred while resolving {}", path_fmt),
        ));
    } else {
        bun_core::handle_oom(manager.log_mut().add_zig_error_with_note(
            err,
            format_args!("error occurred while resolving {}", path_fmt),
        ));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/install_with_manager.zig (1204 lines)
//   confidence: medium
//   notes:      Output::pretty multi-arg fmt needs a real API; heavy borrowck
//               reshaping around manager.lockfile aliases routes through raw
//               ptrs (Zig *T semantics). `Printer` retyped against the stub
//               `crate::Lockfile` / `PackageManagerOptionsStub` so
//               `print_install_summary` and `write_yarn_lock` route through
//               the file-backed tree/yarn printers without a stub→real
//               conversion. Compile still depends on the
//               lockfile::Lockfile / lockfile_real::Lockfile unification
//               (reconciler-6) for Package::parse / Diff::generate /
//               OverrideMap::clone — same pre-existing constraint as the
//               needs_new_lockfile branch's root.parse() call.
// ──────────────────────────────────────────────────────────────────────────
