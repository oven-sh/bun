use core::sync::atomic::Ordering;

use bun_core::time::nano_timestamp;
use bun_core::{Global, Output, Progress};

use crate::bun_fs::FileSystem;
use bun_core::{ZStr, strings};
use bun_glob as glob;
use bun_paths as Path;
use bun_semver::String as SemverString;

use crate::GetJsonResult as WorkspacePackageJsonCacheResult;
use crate::Subcommand;
use crate::dependency::{DependencyExt as _, Tag as DependencyVersionTag};
use crate::lockfile::{self, Lockfile, Package};
use crate::resolution::Tag as ResolutionTag;
use crate::{
    Dependency, DependencyID, Features, PackageID, PackageNameHash, PatchTask, Resolution,
    invalid_package_id,
};
// Bring the typed `items_<field>()` column accessors into scope for
// `MultiArrayList<Package>` / `Slice<Package>` (Zig: `packages.items(.field)`).
use super::Command;
use crate::PackageManager;
use crate::config_version::ConfigVersion;
use crate::hoisted_install::install_hoisted_packages;
use crate::isolated_install::install_isolated_packages;
use crate::lockfile_real::bun_lock as TextLockfile;
use crate::lockfile_real::package::Diff;
use crate::lockfile_real::package::{PackageColumns as _};
use crate::lockfile_real::{Printer, printer as LockfilePrinter};
use crate::package_install::Summary as PackageInstallSummary;
use crate::package_manager::Options::Enable;
use crate::package_manager::{Options, WorkspaceFilter};
use bun_install_types::NodeLinker::NodeLinker;

// Free-function "methods" on `*PackageManager` that the Zig source calls via
// UFCS (`manager.foo(...)`) but which the Rust port hosts in sibling modules
// to avoid one giant `impl PackageManager` block. Import them under their Zig
// names so the body reads the same as the spec.
use crate::package_manager_real::run_tasks::{RunTasksCallbacks, run_tasks};
use crate::package_manager_real::{
    enqueue_dependency_list, enqueue_dependency_with_main, enqueue_patch_task_pre, save_lockfile,
    setup_global_dir, update_lockfile_if_needed, write_yarn_lock,
};

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
            (*mgr)
                .lockfile
                .load_from_cwd::<true>(Some(&mut *mgr), &mut *log)
        }
    } else {
        lockfile::LoadResult::NotFound
    };

    update_lockfile_if_needed(manager, &load_result)?;

    // Snapshot the loaded-from-lockfile package count so
    // `Lockfile::get_package_id` can tell loaded pins apart from packages
    // appended by manifest fetches in this resolve session.
    manager.lockfile.mark_loaded_packages();

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
        lockfile::LoadResult::Err(cause) => report_lockfile_load_error(manager, cause, log_level)?,
        lockfile::LoadResult::Ok(ok) => {
            if manager.subcommand == Subcommand::Update {
                record_updating_package_versions(manager);
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
                let root_package_json_entry = match manager
                    .workspace_package_json_cache
                    .get_with_path(
                        manager.log_mut(),
                        root_package_json_path.as_bytes(),
                        Default::default(),
                    ) {
                    WorkspacePackageJsonCacheResult::Entry(entry) => entry,
                    WorkspacePackageJsonCacheResult::ReadErr(err) => {
                        if manager.log_mut().errors > 0 {
                            manager
                                .log_mut()
                                .print(std::ptr::from_mut(Output::error_writer()))?;
                        }
                        Output::err(
                            err,
                            "failed to read '{}'",
                            format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())),
                        );
                        Global::exit(1);
                    }
                    WorkspacePackageJsonCacheResult::ParseErr(err) => {
                        if manager.log_mut().errors > 0 {
                            manager
                                .log_mut()
                                .print(std::ptr::from_mut(Output::error_writer()))?;
                        }
                        Output::err(
                            err,
                            "failed to parse '{}'",
                            format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())),
                        );
                        Global::exit(1);
                    }
                };

                // PORT NOTE: Zig copies `Source` by value; in Rust it's not `Copy`, so
                // clone it (cheap — `Source` is a few `Box<[u8]>` handles) so the
                // `&mut *mgr` reborrow below doesn't conflict with the cache borrow.
                let source_copy = root_package_json_entry.source.clone();

                let mut resolver: () = ();
                // PORT NOTE: Zig passes `manager`, `manager.log` and a fresh
                // stack `lockfile` simultaneously. Route through raw ptrs so
                // borrowck doesn't see overlapping `&mut PackageManager` /
                // `&mut Lockfile` (Zig `*T` semantics).
                {
                    // `log_mut()` reads the BACKREF `self.log: *mut Log` and
                    // returns the disjoint CLI `Log` allocation (lifetime
                    // decoupled from `&self`), so call it safely through
                    // `manager` *before* establishing the raw-ptr split — no
                    // borrow on `*manager` survives into the `&mut *mgr` below.
                    let log = manager.log_mut();
                    let mgr: *mut PackageManager = manager;
                    maybe_root.parse(
                        &mut lockfile,
                        unsafe { &mut *mgr },
                        log,
                        &source_copy,
                        &mut resolver,
                        Features::main(),
                    )?;
                }
                let mut mapping = vec![invalid_package_id; maybe_root.dependencies.len as usize]
                    .into_boxed_slice();
                // @memset already done via vec! init

                // PORT NOTE: Zig passes `manager`, `manager.log`, `manager.lockfile` and a
                // fresh `lockfile` simultaneously. Route through raw ptrs to satisfy
                // borrowck; `Diff::generate` is ported in lockfile_real::package.
                manager.summary = {
                    // `log_mut()` returns the disjoint CLI `Log` allocation
                    // (BACKREF field, lifetime decoupled from `&self`); read it
                    // and the `to_update` scalar safely through `manager`
                    // *before* establishing the raw-ptr split so no borrow on
                    // `*manager` survives into `mgr`'s `&mut` reborrows below.
                    let log = manager.log_mut();
                    let to_update = manager.to_update;
                    let mgr: *mut PackageManager = manager;
                    // SAFETY: `mgr` is the sole provenance root for the manager
                    // from here on; `Diff::generate` reborrows disjoint fields
                    // (`lockfile`, `update_requests`) through it. No other live
                    // `&mut` to `*mgr` exists across the call.
                    let from_lockfile: *mut Lockfile = unsafe { &raw mut *(*mgr).lockfile };
                    let update_requests = if to_update {
                        Some(unsafe { &(&(*mgr).update_requests)[..] })
                    } else {
                        None
                    };
                    Diff::generate(
                        unsafe { &mut *mgr },
                        log,
                        unsafe { &mut *from_lockfile },
                        &mut lockfile,
                        &root,
                        &maybe_root,
                        update_requests,
                        Some(&mut mapping[..]),
                    )?
                };

                had_any_diffs = manager.summary.has_diffs();

                // Split-borrow `manager.lockfile` so the `StringBuilder`
                // (which owns `buffers.string_bytes` + `string_pool`) and the
                // remaining lockfile columns can coexist without raw-pointer
                // reborrows. `manager.{summary, known_npm_aliases,
                // patched_dependencies_to_remove}` are disjoint top-level
                // fields and can be accessed alongside `manager.lockfile`.
                let summary = &manager.summary;
                let known_npm_aliases = &mut manager.known_npm_aliases;
                let patched_dependencies_to_remove = &mut manager.patched_dependencies_to_remove;
                let (mut builder_, lf) = manager.lockfile.string_builder_split();
                let builder = &mut builder_;

                if !had_any_diffs {
                    // always grab latest scripts for root package
                    maybe_root
                        .scripts
                        .count(&lockfile.buffers.string_bytes, builder);
                    builder.allocate()?;
                    lf.packages.items_scripts_mut()[0] = maybe_root
                        .scripts
                        .clone_into(&lockfile.buffers.string_bytes, builder);
                    builder.clamp();
                } else {
                    // If you changed packages, we will copy over the new package from the new lockfile
                    let new_dependencies =
                        maybe_root.dependencies.get(&lockfile.buffers.dependencies);

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

                    lockfile
                        .overrides
                        .count(&lockfile.buffers.string_bytes, builder);
                    lockfile
                        .catalogs
                        .count(&lockfile.buffers.string_bytes, builder);
                    maybe_root
                        .scripts
                        .count(&lockfile.buffers.string_bytes, builder);

                    let off = lf.dependencies.len() as u32;
                    let len = new_dependencies.len() as u32;
                    let old_resolutions_list = lf.packages.items_resolutions()[0];
                    lf.packages.items_dependencies_mut()[0] =
                        lockfile::DependencySlice::new(off, len);
                    lf.packages.items_resolutions_mut()[0] =
                        lockfile::PackageIDSlice::new(off, len);
                    builder.allocate()?;

                    let all_name_hashes: Vec<PackageNameHash> = 'brk: {
                        if !summary.overrides_changed {
                            break 'brk Vec::new();
                        }
                        let hashes_len = lf.overrides.map.len() + lockfile.overrides.map.len();
                        if hashes_len == 0 {
                            break 'brk Vec::new();
                        }
                        let mut all_name_hashes: Vec<PackageNameHash> =
                            Vec::with_capacity(hashes_len);
                        all_name_hashes.extend_from_slice(lf.overrides.map.keys());
                        all_name_hashes.extend_from_slice(lockfile.overrides.map.keys());
                        let mut i = lf.overrides.map.len();
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

                    *lf.overrides = lockfile.overrides.clone(
                        known_npm_aliases,
                        &lockfile.buffers.string_bytes,
                        builder,
                    )?;
                    *lf.catalogs = lockfile.catalogs.clone(
                        known_npm_aliases,
                        &lockfile.buffers.string_bytes,
                        builder,
                    )?;

                    // PORT NOTE: `ArrayHashMap::clone()` is an inherent fallible method (Zig:
                    // `try trusted_dependencies.clone(allocator)`), not the `Clone` trait, so
                    // `Option::clone` won't see it — map by hand.
                    *lf.trusted_dependencies = match &lockfile.trusted_dependencies {
                        Some(td) => Some(td.clone()?),
                        None => None,
                    };

                    lf.dependencies.reserve(len as usize);
                    lf.resolutions.reserve(len as usize);

                    // PORT NOTE: copy `old_resolutions` to a temporary Vec —
                    // the slice indexes into `buffers.resolutions`, which we're
                    // about to grow via spare-capacity writes / `set_len` below.
                    let old_resolutions: Vec<PackageID> =
                        old_resolutions_list.get(lf.resolutions).to_vec();

                    // PORT NOTE: Zig slices raw spare capacity via `.items.ptr[off .. off + len]`,
                    // `@memset`s it (no drop), then extends `.items.len`. `extend_from_fn`
                    // mirrors that: writes into `spare_capacity_mut()` then bumps `len`, so we
                    // never form `&mut [T]` over uninitialized storage and never drop garbage.
                    debug_assert_eq!(lf.dependencies.len(), off as usize);
                    debug_assert_eq!(lf.resolutions.len(), off as usize);
                    bun_core::vec::extend_from_fn(lf.dependencies, len as usize, |_| {
                        Dependency::default()
                    });
                    bun_core::vec::extend_from_fn(lf.resolutions, len as usize, |_| {
                        invalid_package_id
                    });
                    debug_assert_eq!(lf.dependencies.len(), (off + len) as usize);
                    debug_assert_eq!(lf.resolutions.len(), (off + len) as usize);

                    for (i, new_dep) in new_dependencies.iter().enumerate() {
                        let cloned = new_dep.clone_in(
                            known_npm_aliases,
                            &lockfile.buffers.string_bytes,
                            builder,
                        )?;
                        lf.dependencies[off as usize + i] = cloned;
                        if mapping[i] != invalid_package_id {
                            lf.resolutions[off as usize + i] = old_resolutions[mapping[i] as usize];
                        }
                    }

                    lf.packages.items_scripts_mut()[0] = maybe_root
                        .scripts
                        .clone_into(&lockfile.buffers.string_bytes, builder);

                    // Update workspace paths
                    {
                        lf.workspace_paths.reserve(lockfile.workspace_paths.len());
                        lf.workspace_paths.clear();
                        let mut iter = lockfile.workspace_paths.iter();
                        while let Some((key, value)) = iter.next() {
                            // The string offsets will be wrong so fix them
                            let path = value.slice(&lockfile.buffers.string_bytes);
                            let str = builder.append::<SemverString>(path);
                            // PERF(port): was assume_capacity
                            lf.workspace_paths.insert(*key, str);
                        }
                    }

                    // Update workspace versions
                    {
                        lf.workspace_versions
                            .reserve(lockfile.workspace_versions.len());
                        lf.workspace_versions.clear();
                        let mut iter = lockfile.workspace_versions.iter();
                        while let Some((key, value)) = iter.next() {
                            // Copy version string offsets
                            let version = value.append(&lockfile.buffers.string_bytes, builder);
                            // PERF(port): was assume_capacity
                            lf.workspace_versions.insert(*key, version);
                        }
                    }

                    // Update patched dependencies
                    {
                        let mut iter = lockfile.patched_dependencies.iter();
                        while let Some((key, value)) = iter.next() {
                            let pkg_name_and_version_hash = *key;
                            debug_assert!(value.patchfile_hash_is_null);
                            let gop = lf.patched_dependencies.entry(pkg_name_and_version_hash);
                            // PORT NOTE: ArrayHashMap getOrPut semantics → entry API approximation
                            match gop {
                                bun_collections::array_hash_map::MapEntry::Vacant(v) => {
                                    // PORT NOTE: `PatchedDep` has private padding/hash fields,
                                    // so the `..Default::default()` struct-update form is rejected
                                    // outside its module. Build via `default()` + field stores.
                                    let mut new = crate::lockfile_real::PatchedDep::default();
                                    new.path = builder.append::<SemverString>(
                                        value.path.slice(&lockfile.buffers.string_bytes),
                                    );
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
                        for (key, _) in lf.patched_dependencies.iter() {
                            if !lockfile.patched_dependencies.contains_key(key) {
                                count += 1;
                            }
                        }
                        if count > 0 {
                            patched_dependencies_to_remove.reserve(count);
                            for (key, _) in lf.patched_dependencies.iter() {
                                if !lockfile.patched_dependencies.contains_key(key) {
                                    patched_dependencies_to_remove.insert(*key, ());
                                }
                            }
                            let to_remove: Vec<u64> =
                                patched_dependencies_to_remove.keys().to_vec();
                            for hash in to_remove {
                                let _ = lf.patched_dependencies.ordered_remove(&hash);
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
                            let dependency =
                                manager.lockfile.buffers.dependencies[dependency_i].clone();
                            if all_name_hashes.contains(&dependency.name_hash) {
                                manager.lockfile.buffers.resolutions[dependency_i] =
                                    invalid_package_id;
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
                            let dep_id: DependencyID = u32::try_from(_dep_id).expect("int cast");
                            let dep =
                                manager.lockfile.buffers.dependencies[dep_id as usize].clone();
                            if dep.version.tag != DependencyVersionTag::Catalog {
                                continue;
                            }

                            manager.lockfile.buffers.resolutions[dep_id as usize] =
                                invalid_package_id;
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
                                let dependency = manager.lockfile.buffers.dependencies
                                    [dependency_i as usize]
                                    .clone();
                                let resolution =
                                    manager.lockfile.buffers.resolutions[dependency_i as usize];
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
        root = create_new_lockfile_and_enqueue(manager, &load_result, root_package_json_path, log_level)?;
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
        resolve_pending_tasks(manager, &root, log_level)?;
    }

    let had_errors_before_cleaning_lockfile = manager.log_mut().has_errors();
    manager
        .log_mut()
        .print(std::ptr::from_mut(Output::error_writer()))?;
    manager.log_mut().reset();

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
        root = *manager.lockfile.packages.get(0);
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
            run_security_scanner(manager, ctx, original_cwd);
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
        // `manager.lockfile.scripts`. Field-level split borrow keeps the two
        // disjoint columns alive simultaneously without raw-pointer routing.
        let lockfile = &mut *manager.lockfile;
        let packages = &lockfile.packages;
        let string_bytes = lockfile.buffers.string_bytes.as_slice();
        let lockfile_scripts = &mut lockfile.scripts;
        for pkg_i in 0..packages.len() {
            let resolution = packages.items_resolution()[pkg_i];
            if resolution.tag != ResolutionTag::Workspace {
                continue;
            }
            let meta = packages.items_meta()[pkg_i];
            if !meta.has_install_script() {
                continue;
            }
            let scripts = packages.items_scripts()[pkg_i];
            let add_node_gyp = !scripts.has_any();
            let (first_index, _, entries) =
                scripts.get_script_entries(string_bytes, ResolutionTag::Workspace, add_node_gyp);

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
                        lockfile_scripts.hook_mut(i).push(entry);
                    }
                }
            }
        }
    }

    if manager.options.global {
        setup_global_dir(manager, &ctx)?;
    }

    let packages_len_before_install = manager.lockfile.packages.len();

    if manager.options.enable.frozen_lockfile()
        && !matches!(load_result, lockfile::LoadResult::NotFound)
    {
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
                        PackageManager::verbose_install()
                            || manager.options.do_.print_meta_hash_string(),
                        packages_len_before_install,
                    )
                    .unwrap_or(false))
                {
                    break 'frozen_lockfile;
                }
            }

            if log_level != Options::LogLevel::Silent {
                Output::pretty_errorln(
                    "<r><red>error<r><d>:<r> lockfile had changes, but lockfile is frozen",
                );
                Output::note(
                    "try re-running without <d>--frozen-lockfile<r> and commit the updated lockfile",
                );
            }
            Global::crash();
        }
    }

    // BACKREF: `manager.lockfile` is a `Box<Lockfile>` whose allocation is
    // never replaced for the remainder of this function (only its fields
    // mutate). Wrap once as `ParentRef` so the two `save_lockfile` read sites
    // below deref through the safe abstraction instead of per-site raw deref.
    let lockfile_before_install = bun_ptr::ParentRef::<Lockfile>::new(&*manager.lockfile);

    let save_format = load_result.save_format(&manager.options);

    if manager.options.lockfile_only {
        // save the lockfile and exit. make sure metahash is generated for binary lockfile
        return save_lockfile_only(
            manager,
            ctx,
            &load_result,
            save_format,
            had_any_diffs,
            lockfile_before_install,
            packages_len_before_install,
            log_level,
        );
    }

    let (workspace_filters, install_root_dependencies) =
        get_workspace_filters(manager, original_cwd)?;
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
                        if !load_result.migrated_from_npm()
                            && manager.lockfile.workspace_paths.len() > 0
                        {
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
            .print(std::ptr::from_mut(Output::error_writer()))?;
    }
    if had_errors_before_cleaning_lockfile || manager.log_mut().has_errors() {
        Global::crash();
    }

    let did_meta_hash_change =
        // If the lockfile was frozen, we already checked it
        !manager.options.enable.frozen_lockfile()
            && if load_result.loaded_from_text_lockfile() {
                !manager.lockfile.eql(&lockfile_before_clean, packages_len_before_install)?
            } else {
                manager.lockfile.has_meta_hash_changed(
                    PackageManager::verbose_install() || manager.options.do_.print_meta_hash_string(),
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
        || (manager.options.do_.save_lockfile()
            && (did_meta_hash_change
                || had_any_diffs
                || !manager.update_requests.is_empty()
                || (matches!(load_result, lockfile::LoadResult::Ok { .. })
                    && (load_result.ok().serializer_result.packages_need_update
                        || load_result.ok().serializer_result.migrated_from_lockb_v2))
                || manager.lockfile.is_empty()
                || manager.options.enable.force_save_lockfile()));

    if should_save_lockfile {
        save_lockfile(
            manager,
            &load_result,
            save_format,
            had_any_diffs,
            lockfile_before_install.get(),
            packages_len_before_install,
            log_level,
        )?;
    }

    if needs_new_lockfile {
        manager.summary.add = manager.lockfile.packages.len() as u32;
    }

    if manager.options.do_.save_yarn_lock() {
        write_yarn_lock_with_progress(manager, log_level)?;
    }

    if manager.options.do_.run_scripts() && install_root_dependencies && !manager.options.global {
        run_root_lifecycle_scripts(manager, ctx, log_level)?;
    }

    if log_level != Options::LogLevel::Silent {
        print_install_summary(
            manager,
            ctx,
            &install_summary,
            did_meta_hash_change,
            log_level,
        )?;
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

/// `RunTasksCallbacks` impl for the void-callback `runTasks` call inside
/// `runAndWaitFn::isDone` (Zig passed an anonymous struct with `void` hooks
/// and `progress_bar = true`). Only the comptime flags differ from the default.
struct InstallWaitCallbacks;
impl RunTasksCallbacks for InstallWaitCallbacks {
    type Ctx = ();
    const PROGRESS_BAR: bool = true;
}

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

        // PORT NOTE: void RunTasksCallbacks — Zig passes an anon struct with
        // `void` hooks and `progress_bar = true`. The Rust trait dispatch needs a
        // concrete `RunTasksCallbacks` impl; `extract_ctx` collapses to `()` so we
        // do NOT pass `this` as both receiver and ctx (would alias `&mut`).
        let log_level = this.options.log_level;
        if let Err(err) = run_tasks::<InstallWaitCallbacks>(this, &mut (), CHECK_PEERS, log_level) {
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

// Outlined cold so the install fast path (`install_with_manager` tail) does not
// pull `bun_core::output`'s panic/format machinery into its own body. The
// function is additionally split so that the no-op path — a repeat
// `bun install` with nothing to do, which prints only the single
// "Checked N installs" line — touches ~2 i-cache pages instead of the ~5 the
// monolithic body required: every other output section (tree, added, removed,
// failures, fallback timestamp, blocked-scripts) lives in its own
// `#[cold] #[inline(never)]` helper that LLVM places in `.text.unlikely`.
#[cold]
#[inline(never)]
fn print_install_summary(
    this: &mut PackageManager,
    ctx: Command::Context,
    install_summary: &PackageInstallSummary,
    did_meta_hash_change: bool,
    log_level: Options::LogLevel,
) -> Result<(), bun_core::Error> {
    let _flush_guard = Output::flush_guard();

    let mut printed_timestamp = false;
    if this.options.do_.summary() {
        print_summary_tree(this, install_summary, log_level)?;

        if !did_meta_hash_change {
            this.summary.remove = 0;
            this.summary.add = 0;
            this.summary.update = 0;
        }

        if install_summary.success > 0 {
            print_summary_installed(this, ctx.start_time, install_summary);
            printed_timestamp = true;
        } else if this.summary.remove > 0 {
            print_summary_removed(this, ctx.start_time, install_summary);
            printed_timestamp = true;
        } else if install_summary.skipped > 0
            && install_summary.fail == 0
            && this.update_requests.is_empty()
        {
            // Hot no-op path (install/fastify bench): kept inline.
            let count = this.lockfile.packages.len() as PackageID;
            if count != install_summary.skipped {
                if !this.options.enable.only_missing() {
                    Output::pretty(format_args!(
                        "Checked <green>{} install{}<r> across {} package{} <d>(no changes)<r> ",
                        install_summary.skipped,
                        if install_summary.skipped == 1 {
                            ""
                        } else {
                            "s"
                        },
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
                    if install_summary.skipped == 1 {
                        ""
                    } else {
                        "s"
                    },
                ));
                // TODO(port): Output::pretty multi-arg formatting
                Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
                printed_timestamp = true;
                print_blocked_packages_info(install_summary, this.options.global);
            }
        }

        if install_summary.fail > 0 {
            print_summary_failed(install_summary);
        }
    }

    if this.options.do_.summary() && !printed_timestamp {
        print_summary_timing_fallback(ctx.start_time);
    }

    Ok(())
}

#[cold]
#[inline(never)]
fn print_summary_tree(
    this: &mut PackageManager,
    install_summary: &PackageInstallSummary,
    log_level: Options::LogLevel,
) -> Result<(), bun_core::Error> {
    // PORT NOTE: reshaped for borrowck — Zig builds `Printer` borrowing
    // `this.lockfile` / `this.options` while also passing `this` (the
    // PackageManager) to `Tree::print`. Route through a single `*mut
    // PackageManager` provenance root and reborrow disjoint fields
    // through it (Zig `*T` semantics): `Tree::print` only reads
    // `manager.{updating_packages, workspace_name_hash}` and writes
    // `manager.track_installed_bin`, none of which overlap `lockfile` /
    // `options` / `update_requests`.
    let mgr: *mut PackageManager = this;
    // `mgr` is the sole provenance root from here through the `Tree::print`
    // call; the `Printer` reborrows shared `lockfile` / `options` /
    // `update_requests`, and the `&mut *mgr` passed to `Tree::print` only
    // touches disjoint `PackageManager` fields. Wrapped once as `ParentRef`
    // so the three read-only field reborrows go through safe `Deref`
    // instead of three per-site raw projections. Safe `From<NonNull>`
    // construction — `mgr` was just derived from `&mut *this`.
    let mgr_ref = bun_ptr::ParentRef::<PackageManager>::from(
        core::ptr::NonNull::new(mgr).expect("derived from &mut, non-null"),
    );
    let printer = Printer {
        lockfile: &mgr_ref.lockfile,
        options: &mgr_ref.options,
        updates: &mgr_ref.update_requests,
        successfully_installed: install_summary.successfully_installed.as_ref(),
    };

    Output::flush();
    // Ensure at this point buffering is enabled.
    // We deliberately do not disable it after this.
    Output::enable_buffering();
    let writer = Output::writer_buffered();
    // Runtime bool → comptime dispatch (Zig `switch (b) { inline else => |c| ... }`).
    if Output::enable_ansi_colors_stdout() {
        LockfilePrinter::Tree::print::<_, true>(&printer, unsafe { &mut *mgr }, writer, log_level)?;
    } else {
        LockfilePrinter::Tree::print::<_, false>(
            &printer,
            unsafe { &mut *mgr },
            writer,
            log_level,
        )?;
    }
    Ok(())
}

#[cold]
#[inline(never)]
fn print_summary_installed(
    this: &PackageManager,
    start_time: i128,
    install_summary: &PackageInstallSummary,
) {
    // it's confusing when it shows 3 packages and says it installed 1
    let pkgs_installed = install_summary
        .success
        .max(this.update_requests.len() as u32);
    Output::pretty(format_args!(
        "<green>{}<r> package{}<r> installed ",
        pkgs_installed,
        if pkgs_installed == 1 { "" } else { "s" },
    ));
    // TODO(port): Output::pretty multi-arg formatting
    Output::print_start_end_stdout(start_time, nano_timestamp());
    print_blocked_packages_info(install_summary, this.options.global);

    if this.summary.remove > 0 {
        Output::pretty(format_args!("Removed: <cyan>{}<r>\n", this.summary.remove));
    }
}

#[cold]
#[inline(never)]
fn print_summary_removed(
    this: &PackageManager,
    start_time: i128,
    install_summary: &PackageInstallSummary,
) {
    if this.subcommand == Subcommand::Remove {
        for request in &this.update_requests {
            Output::prettyln(format_args!(
                "<r><red>-<r> {}",
                bstr::BStr::new(request.name)
            ));
        }
    }

    Output::pretty(format_args!(
        "<r><b>{}<r> package{} removed ",
        this.summary.remove,
        if this.summary.remove == 1 { "" } else { "s" },
    ));
    // TODO(port): Output::pretty multi-arg formatting
    Output::print_start_end_stdout(start_time, nano_timestamp());
    print_blocked_packages_info(install_summary, this.options.global);
}

#[cold]
#[inline(never)]
fn print_summary_failed(install_summary: &PackageInstallSummary) {
    Output::prettyln(format_args!(
        "<r>Failed to install <red><b>{}<r> package{}\n",
        install_summary.fail,
        if install_summary.fail == 1 { "" } else { "s" },
    ));
    // TODO(port): Output::pretty multi-arg formatting
    Output::flush();
}

#[cold]
#[inline(never)]
fn print_summary_timing_fallback(start_time: i128) {
    Output::print_start_end_stdout(start_time, nano_timestamp());
    Output::prettyln(format_args!("<d> done<r>"));
}

#[cold]
#[inline(never)]
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
    if manager.subcommand == Subcommand::Install && !manager.options.filter_patterns.is_empty() {
        workspace_filters.reserve(manager.options.filter_patterns.len());
        for pattern in manager.options.filter_patterns {
            workspace_filters.push(WorkspaceFilter::init(pattern, original_cwd, &mut path_buf)?);
        }
    }

    let mut install_root_dependencies = workspace_filters.is_empty();
    if !install_root_dependencies {
        let pkg_names = manager.lockfile.packages.items_name();

        let abs_root_path: &[u8] = 'abs_root_path: {
            #[cfg(not(windows))]
            {
                break 'abs_root_path strings::without_trailing_slash(
                    FileSystem::instance().top_level_dir(),
                );
            }

            #[cfg(windows)]
            {
                let abs_path = Path::path_to_posix_buf::<u8>(
                    FileSystem::instance().top_level_dir,
                    &mut path_buf.0,
                );
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
#[cold]
#[inline(never)]
fn add_dependency_error(
    manager: &mut PackageManager,
    dependency: &Dependency,
    err: bun_core::Error,
) {
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

    let log = manager.log_mut();
    if dependency.behavior.is_optional() || dependency.behavior.is_peer() {
        log.add_warning_with_note(
            None,
            Default::default(),
            err.name().as_bytes(),
            format_args!("error occurred while resolving {}", path_fmt),
        );
    } else {
        log.add_zig_error_with_note(
            err,
            format_args!("error occurred while resolving {}", path_fmt),
        );
    }
}

// ─── cold install branches ────────────────────────────────────────────────
// These are the rarely-taken arms of `install_with_manager` (lockfile load
// error reporting, building a brand-new lockfile, the network resolve loop,
// the security scanner, `--lockfile-only`, yarn.lock writing, root lifecycle
// scripts). Hoisting them out of the function body and tagging them
// `#[cold] #[inline(never)]` keeps LLVM from interleaving their code with the
// hot verify-and-exit path during fat-LTO emission, so a no-op
// `bun install` / `bun install --frozen-lockfile` (node_modules already up to
// date) faults in far fewer distinct `.text` pages.

#[cold]
#[inline(never)]
fn report_lockfile_load_error(
    manager: &mut PackageManager,
    cause: &lockfile::LoadResultErr,
    log_level: Options::LogLevel,
) -> Result<(), bun_core::Error> {
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

        if manager.log_mut().errors > 0 {
            manager
                .log_mut()
                .print(std::ptr::from_mut(Output::error_writer()))?;
            manager.log_mut().reset();
        }
        Output::flush();
    }

    if manager.options.enable.fail_early() {
        Global::crash();
    }
    Ok(())
}

#[cold]
#[inline(never)]
fn record_updating_package_versions(manager: &mut PackageManager) {
    // existing lockfile, get the original version is updating
    // PORT NOTE: reshaped for borrowck — Zig holds `*Lockfile` while
    // also mutating `manager.updating_packages`. Field-level split
    // borrow keeps the disjoint columns alive without raw pointers.
    let lockfile: &Lockfile = &manager.lockfile;
    let updating_packages = &mut manager.updating_packages;
    let packages = lockfile.packages.slice();
    let resolutions = packages.items_resolution();
    let workspace_package_id = manager
        .root_package_id
        .get(lockfile, manager.workspace_name_hash);
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

        if let Some(entry_ptr) =
            updating_packages.get_mut(dep.name.slice(&lockfile.buffers.string_bytes))
        {
            let original_resolution: Resolution = resolutions[package_id as usize];
            // Just in case check if the resolution is `npm`. It should always be `npm` because the dependency version
            // is `npm` or `dist_tag`.
            if original_resolution.tag != ResolutionTag::Npm {
                continue;
            }

            // SAFETY: `original_resolution.tag == ResolutionTag::Npm` was checked
            // immediately above, so the `.npm` arm of the value union is active.
            let mut original = original_resolution.npm().version;
            let tag_total = original.tag.pre.len() + original.tag.build.len();
            if tag_total > 0 {
                // clone because don't know if lockfile buffer will reallocate
                let mut tag_buf = vec![0u8; tag_total].into_boxed_slice();
                let mut ptr = &mut tag_buf[..];
                original.tag = original_resolution
                    .npm()
                    .version
                    .tag
                    .clone_into(&lockfile.buffers.string_bytes, &mut ptr);

                entry_ptr.original_version_string_buf = tag_buf;
            }

            entry_ptr.original_version = Some(original);
        }
    }
}

#[cold]
#[inline(never)]
fn create_new_lockfile_and_enqueue(
    manager: &mut PackageManager,
    load_result: &lockfile::LoadResult,
    root_package_json_path: &ZStr,
    log_level: Options::LogLevel,
) -> Result<lockfile::Package, bun_core::Error> {
    let mut root = lockfile::Package::default();
    manager.lockfile.init_empty();

    if manager.options.enable.frozen_lockfile()
        && !matches!(load_result, lockfile::LoadResult::NotFound)
    {
        if log_level != Options::LogLevel::Silent {
            Output::pretty_errorln(
                "<r><red>error<r>: lockfile had changes, but lockfile is frozen",
            );
        }
        Global::crash();
    }

    // SAFETY: `manager.log` is a non-null backref to the CLI log set at init().
    let root_package_json_entry = match manager.workspace_package_json_cache.get_with_path(
        manager.log_mut(),
        root_package_json_path.as_bytes(),
        Default::default(),
    ) {
        WorkspacePackageJsonCacheResult::Entry(entry) => entry,
        WorkspacePackageJsonCacheResult::ReadErr(err) => {
            if manager.log_mut().errors > 0 {
                manager
                    .log_mut()
                    .print(std::ptr::from_mut(Output::error_writer()))?;
            }
            Output::err(
                err,
                "failed to read '{}'",
                format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())),
            );
            Global::exit(1);
        }
        WorkspacePackageJsonCacheResult::ParseErr(err) => {
            if manager.log_mut().errors > 0 {
                manager
                    .log_mut()
                    .print(std::ptr::from_mut(Output::error_writer()))?;
            }
            Output::err(
                err,
                "failed to parse '{}'",
                format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())),
            );
            Global::exit(1);
        }
    };

    let source_copy = root_package_json_entry.source.clone();

    let mut resolver: () = ();
    {
        // `log_mut()` reads the BACKREF `self.log` and returns the disjoint
        // CLI `Log` allocation (lifetime decoupled from `&self`); call it
        // safely *before* the raw-ptr split.
        let log = manager.log_mut();
        let mgr: *mut PackageManager = manager;
        // SAFETY: `mgr` is the sole provenance root; `parse` reborrows the
        // disjoint `lockfile` field through it. No other live `&mut` to
        // `*mgr` exists across the call.
        root.parse(
            unsafe { &mut (*mgr).lockfile },
            unsafe { &mut *mgr },
            log,
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
    Ok(root)
}

#[cold]
#[inline(never)]
fn resolve_pending_tasks(
    manager: &mut PackageManager,
    root: &lockfile::Package,
    log_level: Options::LogLevel,
) -> Result<(), bun_core::Error> {
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
    Ok(())
}

#[cold]
#[inline(never)]
fn run_security_scanner(manager: &mut PackageManager, ctx: Command::Context, original_cwd: &[u8]) {
    let is_subcommand_to_run_scanner = matches!(
        manager.subcommand,
        Subcommand::Add | Subcommand::Update | Subcommand::Install | Subcommand::Remove
    );

    if !is_subcommand_to_run_scanner {
        return;
    }

    match security_scanner::perform_security_scan_after_resolution(manager, ctx, original_cwd) {
        Err(err) => {
            match err {
                e if e == bun_core::err!("SecurityScannerInWorkspace") => {
                    Output::err_generic(
                        "security scanner cannot be a dependency of a workspace package. It must be a direct dependency of the root package.",
                        (),
                    );
                }
                e if e == bun_core::err!("SecurityScannerRetryFailed") => {
                    Output::err_generic(
                        "security scanner failed after partial install. This is probably a bug in Bun. Please report it at https://github.com/oven-sh/bun/issues",
                        (),
                    );
                }
                e if e == bun_core::err!("InvalidPackageID") => {
                    Output::err_generic(
                        "cannot perform partial install: security scanner package ID is invalid",
                        (),
                    );
                }
                e if e == bun_core::err!("PartialInstallFailed") => {
                    Output::err_generic("failed to install security scanner package", ());
                }
                e if e == bun_core::err!("NoPackagesInstalled") => {
                    Output::err_generic(
                        "no packages were installed during security scanner installation",
                        (),
                    );
                }
                e if e == bun_core::err!("IPCPipeFailed") => {
                    Output::err_generic("failed to create IPC pipe for security scanner", ());
                }
                e if e == bun_core::err!("ProcessWatchFailed") => {
                    Output::err_generic("failed to watch security scanner process", ());
                }
                e => {
                    Output::err_generic(
                        "security scanner failed: {}",
                        format_args!("{}", e.name()),
                    );
                }
            }

            Global::exit(1);
        }
        Ok(Some(results)) => {
            // `results` drops at end of scope (Zig had `defer results_mut.deinit()`)
            security_scanner::print_security_advisories(manager, &results);

            if results.has_fatal_advisories() {
                Output::pretty(format_args!(
                    "<red>Installation aborted due to fatal security advisories<r>\n"
                ));
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

#[cold]
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn save_lockfile_only(
    manager: &mut PackageManager,
    ctx: Command::Context,
    load_result: &lockfile::LoadResult,
    save_format: lockfile::Format,
    had_any_diffs: bool,
    lockfile_before_install: bun_ptr::ParentRef<Lockfile>,
    packages_len_before_install: usize,
    log_level: Options::LogLevel,
) -> Result<(), bun_core::Error> {
    // save the lockfile and exit. make sure metahash is generated for binary lockfile
    manager.lockfile.meta_hash = manager.lockfile.generate_meta_hash(
        PackageManager::verbose_install() || manager.options.do_.print_meta_hash_string(),
        packages_len_before_install,
    )?;

    save_lockfile(
        manager,
        load_result,
        save_format,
        had_any_diffs,
        lockfile_before_install.get(),
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
            if manager.lockfile.packages.len() == 1 {
                ""
            } else {
                "s"
            },
        ));
        // TODO(port): Output::pretty multi-arg formatting — Zig used positional `{s} {d} {s}`
        Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
        Output::pretty(format_args!("\n"));
    }
    Output::flush();
    Ok(())
}

#[cold]
#[inline(never)]
fn write_yarn_lock_with_progress(
    manager: &mut PackageManager,
    log_level: Options::LogLevel,
) -> Result<(), bun_core::Error> {
    // PORT NOTE: reshaped for borrowck — Zig holds `*Progress.Node` (returned by
    // `progress.start`) across `writeYarnLock(manager)`. `Progress::start` returns
    // `&mut self.root`, so re-access it via `manager.progress.root` after the
    // `&mut manager` borrow ends instead of keeping a live `&mut Node`.
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

    write_yarn_lock(manager)?;
    if log_level.show_progress() {
        if node_started {
            manager.progress.root.complete_one();
        }
        manager.progress.refresh();
        manager.progress.root.end();
        manager.progress = Default::default();
    }
    Ok(())
}

#[cold]
#[inline(never)]
fn run_root_lifecycle_scripts(
    manager: &mut PackageManager,
    ctx: Command::Context,
    log_level: Options::LogLevel,
) -> Result<(), bun_core::Error> {
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
        while manager
            .pending_lifecycle_script_tasks
            .load(Ordering::Relaxed)
            > 0
        {
            manager.report_slow_lifecycle_scripts();
            manager.sleep();
        }
    }
    Ok(())
}

// ported from: src/install/PackageManager/install_with_manager.zig
