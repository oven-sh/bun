use core::sync::atomic::Ordering;

use bun_ast::Source;
use bun_collections::{DynamicBitSet, index_sort};
use bun_core::UnwrapOrOom as _;
use bun_core::time::nano_timestamp;
use bun_core::{Global, Output};

use bun_core::{ZStr, strings};
use bun_semver::String as SemverString;

use crate::GetJsonResult as WorkspacePackageJsonCacheResult;
use crate::Subcommand;
use crate::dependency::{DependencyExt as _, Tag as DependencyVersionTag};
use crate::lockfile::{self, Lockfile, reachable};
use crate::resolution::Tag as ResolutionTag;
use crate::update_transitive::{
    DirectDependencies, TransitiveUpdate, enqueue_peer_rows, moved_targets_after_clean,
    plannable_peer_rows, print_kept_patched, redirect_moved_edges,
};
use crate::{
    Dependency, DependencyID, Features, PackageID, PackageNameHash, PatchTask, Resolution,
    invalid_package_id,
};
// Bring the typed `items_<field>()` column accessors into scope for
// `MultiArrayList<Package>` / `Slice<Package>`.
use super::Command;
use crate::PackageManager;
use crate::config_version::ConfigVersion;
use crate::hoisted_install::install_hoisted_packages;
use crate::isolated_install::install_isolated_packages;
use crate::lockfile_real::package::PackageColumns as _;
use crate::lockfile_real::package::{Diff, Updating};
use crate::lockfile_real::{Printer, printer as LockfilePrinter};
use crate::package_install::Summary as PackageInstallSummary;
use crate::package_manager::Options::Enable;
use crate::package_manager::{Options, WorkspaceFilter};
use bun_install_types::NodeLinker::NodeLinker;

// Free-function "methods" on `PackageManager` hosted in sibling modules
// to avoid one giant `impl PackageManager` block.
use crate::package_manager_real::run_tasks::{RunTasksCtx, run_tasks};
use crate::package_manager_real::{
    UpdateRequest, enqueue_dependency_list, enqueue_dependency_with_main, enqueue_patch_task_pre,
    save_lockfile, setup_global_dir, update_lockfile_if_needed, write_yarn_lock,
};

use super::security_scanner;

pub fn install_with_manager(
    manager: &mut PackageManager,
    ctx: Command::Context,
    root_package_json_path: &ZStr,
    original_cwd: &[u8],
) -> crate::Result<()> {
    let log_level = manager.options.log_level;

    // Start resolving DNS for the default registry immediately.
    // Unless you're behind a proxy.
    if !manager.env().has_http_proxy()
        && manager.options.offline != crate::package_manager_real::options::OfflineMode::Offline
    {
        // And don't try to resolve DNS if it's an IP address.
        let scope_url = manager.options.scope.url.url();
        if !scope_url.hostname.is_empty() && !scope_url.is_ip_address() {
            bun_dns::internal::prefetch(
                manager.event_loop.loop_(),
                scope_url.hostname,
                scope_url.get_port_auto(),
            );
        }
    }

    let load_result: lockfile::DetachedLoadResult = if manager.options.do_.load_lockfile() {
        manager.load_lockfile_from_cwd_detached::<true>()
    } else {
        lockfile::DetachedLoadResult::NotFound
    };

    update_lockfile_if_needed(manager, &load_result)?;

    // Snapshot the loaded-from-lockfile package count so
    // `Lockfile::get_package_id` can tell loaded pins apart from packages
    // appended by manifest fetches in this resolve session.
    manager.lockfile.mark_loaded_packages();

    let (config_version, changed_config_version) =
        load_result.choose_config_version(&manager.lockfile);
    manager.options.config_version = Some(config_version);

    let mut root = lockfile::Package::default();
    let mut needs_new_lockfile = !matches!(load_result, lockfile::DetachedLoadResult::Ok { .. })
        || (manager.lockfile.buffers.dependencies.is_empty()
            && !manager.update_requests.is_empty());

    manager.options.enable.set(
        Enable::FORCE_SAVE_LOCKFILE,
        manager.options.enable.force_save_lockfile()
            || changed_config_version
            || (matches!(load_result, lockfile::DetachedLoadResult::Ok { .. })
                // if migrated always save a new lockfile
                && (load_result.ok().migrated != lockfile::Migrated::None
                    // if loaded from binary and save-text-lockfile is passed
                    || (load_result.ok().format == lockfile::Format::Binary
                        && manager.options.save_text_lockfile.unwrap_or(false)))),
    );

    if manager.subcommand == Subcommand::Dedupe {
        crate::dedupe::dedupe_before_install(manager, &load_result)?;
    }

    let bare_update =
        manager.subcommand == Subcommand::Update && manager.update_requests.is_empty();
    let mut transitive = TransitiveUpdate::default();
    // Reachability must be walked before the differ invalidates the root rows it is about to re-enqueue.
    if manager.to_update
        && matches!(load_result, lockfile::DetachedLoadResult::Ok { .. })
        && !crate::update_scope::UpdateScope::of(&*manager).is_whole_workspace()
    {
        crate::update_scope::plan_named(manager);
    }

    // this defaults to false
    // but we force allowing updates to the lockfile when you do bun add
    let mut had_any_diffs = false;
    let mut direct_deps_before = DirectDependencies::default();
    manager.progress = Default::default();

    match &load_result {
        lockfile::DetachedLoadResult::Err(cause) => {
            report_lockfile_load_error(manager, cause, log_level)?
        }
        lockfile::DetachedLoadResult::Ok(_) => {
            if manager.subcommand == Subcommand::Update {
                record_updating_package_versions(manager);
            }
            'differ: {
                root = match manager.lockfile.root_package() {
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

                let source_copy = root_package_json_source(manager, root_package_json_path)?;

                let mut resolver: () = ();
                manager.with_log(|manager, log| {
                    maybe_root.parse(
                        &mut lockfile,
                        manager,
                        log,
                        &source_copy,
                        &mut resolver,
                        Features::main(),
                    )
                })?;
                let mut mapping = vec![invalid_package_id; maybe_root.dependencies.len as usize]
                    .into_boxed_slice();

                manager.summary = {
                    let updating =
                        manager
                            .to_update
                            .then_some(if manager.update_requests.is_empty() {
                                Updating::Everything
                            } else {
                                Updating::Named
                            });
                    manager.with_lockfile_and_log(|from_lockfile, manager, log| {
                        Diff::generate(
                            manager,
                            log,
                            from_lockfile,
                            &mut lockfile,
                            &root,
                            &maybe_root,
                            updating,
                            Some(&mut mapping[..]),
                        )
                    })?
                };

                had_any_diffs = manager.summary.has_diffs();
                // Which workspaces asked for a self-contained node_modules is a property
                // of their manifests, not of the dependency graph: mirror the freshly
                // parsed manifests whether or not anything else changed, so the copy
                // loaded from bun.lock never goes stale.
                manager
                    .lockfile
                    .self_contained_workspaces
                    .clear_retaining_capacity();
                for key in lockfile.self_contained_workspaces.keys() {
                    manager.lockfile.self_contained_workspaces.put(*key, ())?;
                }
                if manager.subcommand == Subcommand::Dedupe {
                    crate::dedupe::dedupe_after_differ(manager);
                }
                if manager.summary.changes_resolutions() {
                    direct_deps_before = DirectDependencies::snapshot(&manager.lockfile);
                }

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
                    if bare_update {
                        transitive = TransitiveUpdate::plan(manager, &direct_deps_before)?;
                        transitive.enqueue(manager)?;
                    }
                } else {
                    // If you changed packages, we will copy over the new package from the new lockfile
                    let new_dependencies =
                        maybe_root.dependencies.get(&lockfile.buffers.dependencies);

                    let kept_pruned: Vec<(Dependency, PackageID)> =
                        if summary.pruned_workspaces.is_empty() {
                            Vec::new()
                        } else {
                            root.dependencies
                                .get(&lf.dependencies[..])
                                .iter()
                                .zip(root.resolutions.get(&lf.resolutions[..]))
                                .filter(|(dep, _)| {
                                    dep.behavior.is_workspace()
                                        && summary.pruned_workspaces.contains(&dep.name_hash)
                                })
                                .map(|(dep, &res)| (dep.clone(), res))
                                .collect()
                        };

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
                    let len = (new_dependencies.len() + kept_pruned.len()) as u32;
                    let old_resolutions_list = lf.packages.items_resolutions()[0];
                    lf.packages.items_dependencies_mut()[0] =
                        lockfile::DependencySlice::new(off, len);
                    lf.packages.items_resolutions_mut()[0] =
                        lockfile::PackageIDSlice::new(off, len);
                    builder.allocate()?;

                    let all_name_hashes: Vec<PackageNameHash> = if !summary.overrides_changed {
                        Vec::new()
                    } else {
                        let mut v = Vec::new();
                        lf.overrides.append_overridden_name_hashes(&mut v);
                        lockfile.overrides.append_overridden_name_hashes(&mut v);
                        index_sort::sort_slice_unstable_by(&mut v, |a, b| a.cmp(b));
                        v.dedup();
                        v
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

                    // `ArrayHashMap::clone()` is an inherent fallible method,
                    // not the `Clone` trait, so
                    // `Option::clone` won't see it — map by hand.
                    *lf.trusted_dependencies = match &lockfile.trusted_dependencies {
                        Some(td) => Some(td.clone()?),
                        None => None,
                    };

                    lf.dependencies.reserve(len as usize);
                    lf.resolutions.reserve(len as usize);

                    // copy `old_resolutions` to a temporary Vec —
                    // the slice indexes into `buffers.resolutions`, which we're
                    // about to grow via spare-capacity writes / `set_len` below.
                    let old_resolutions: Vec<PackageID> =
                        old_resolutions_list.get(lf.resolutions).to_vec();

                    // `extend_from_fn`
                    // writes into `spare_capacity_mut()` then bumps `len`, so we
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
                    for (k, (dep, res)) in kept_pruned.into_iter().enumerate() {
                        let slot = off as usize + new_dependencies.len() + k;
                        lf.dependencies[slot] = dep;
                        lf.resolutions[slot] = res;
                    }

                    lf.packages.items_scripts_mut()[0] = maybe_root
                        .scripts
                        .clone_into(&lockfile.buffers.string_bytes, builder);

                    // Update workspace paths
                    {
                        lf.workspace_paths.reserve(lockfile.workspace_paths.len());
                        lf.workspace_paths.clear();
                        for (key, value) in lockfile.workspace_paths.iter() {
                            // The string offsets will be wrong so fix them
                            let path = value.slice(&lockfile.buffers.string_bytes);
                            let str = builder.append::<SemverString>(path);
                            lf.workspace_paths.insert(*key, str);
                        }
                    }

                    // Update workspace versions
                    {
                        lf.workspace_versions
                            .reserve(lockfile.workspace_versions.len());
                        lf.workspace_versions.clear();
                        for (key, value) in lockfile.workspace_versions.iter() {
                            // Copy version string offsets
                            let version = value.append(&lockfile.buffers.string_bytes, builder);
                            lf.workspace_versions.insert(*key, version);
                        }
                    }
                    // Update patched dependencies
                    {
                        for (key, value) in lockfile.patched_dependencies.iter() {
                            let pkg_name_and_version_hash = *key;
                            debug_assert!(value.patchfile_hash_is_null);
                            let gop = lf.patched_dependencies.entry(pkg_name_and_version_hash);
                            match gop {
                                bun_collections::array_hash_map::MapEntry::Vacant(v) => {
                                    // `PatchedDep` has private padding/hash fields,
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

                    let invalidates_rows = (manager.summary.overrides_changed
                        && !all_name_hashes.is_empty())
                        || manager.summary.catalogs_changed;
                    let mut pinned_rows = DynamicBitSet::default();
                    if bare_update {
                        transitive = TransitiveUpdate::plan(manager, &direct_deps_before)?;
                        pinned_rows = enqueue_transitive(manager, &transitive, invalidates_rows)?;
                    }

                    // `enqueue_dependency_with_main` can reach `Package::from_npm`,
                    // which grows `buffers.dependencies` and may reallocate it.
                    // Iterate by index against a snapshot of the original length and
                    // copy each entry to the stack so neither the loop nor the callee
                    // ever reads through a pointer into the old backing storage.
                    if manager.summary.overrides_changed && !all_name_hashes.is_empty() {
                        let dependencies_len = manager.lockfile.buffers.dependencies.len();
                        for dependency_i in 0..dependencies_len {
                            if pinned_rows.is_set_allow_out_of_bound(dependency_i, false) {
                                continue;
                            }
                            let dependency =
                                manager.lockfile.buffers.dependencies[dependency_i].clone();
                            if all_name_hashes.binary_search(&dependency.name_hash).is_ok() {
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
                        let mut catalog_overridden: Vec<PackageNameHash> = Vec::new();
                        manager
                            .lockfile
                            .overrides
                            .append_catalog_valued_name_hashes(&mut catalog_overridden);
                        index_sort::sort_slice_unstable_by(&mut catalog_overridden, |a, b| {
                            a.cmp(b)
                        });
                        catalog_overridden.dedup();
                        let dependencies_len = manager.lockfile.buffers.dependencies.len();
                        for _dep_id in 0..dependencies_len {
                            let dep_id: DependencyID = u32::try_from(_dep_id).expect("int cast");
                            if pinned_rows.is_set_allow_out_of_bound(_dep_id, false) {
                                continue;
                            }
                            let dep =
                                manager.lockfile.buffers.dependencies[dep_id as usize].clone();
                            if dep.version.tag != DependencyVersionTag::Catalog
                                && (catalog_overridden.is_empty()
                                    || catalog_overridden.binary_search(&dep.name_hash).is_err())
                            {
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

    let named_update = manager.to_update && !manager.update_requests.is_empty();
    let mut named = NamedUpdates::default();
    if !needs_new_lockfile {
        if named_update {
            named = enqueue_named_updates(
                manager,
                &direct_deps_before,
                loaded_lockfile_name(&load_result),
            )?;
        }
        if !manager.audit_fix_pins.is_empty() {
            crate::audit_fix::enqueue_planned_fixes(manager)?;
        }
    }

    if needs_new_lockfile {
        if named_update {
            reject_unknown_update_requests(
                manager,
                loaded_lockfile_name(&load_result),
                |_, request| request.e_string.is_none(),
                |_| false,
            );
        }
        root = create_new_lockfile_and_enqueue(
            manager,
            &load_result,
            root_package_json_path,
            log_level,
        )?;
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

    if manager.pending_task_count() > 0
        || manager.peer_dependencies.readable_length() > 0
        || !named.latest_rows.is_empty()
    {
        resolve_pending_tasks(manager, &root, log_level, &mut named)?;
    }

    direct_deps_before.redirect_dependents(&mut manager.lockfile);
    transitive.redirect_dependents(&mut manager.lockfile);
    redirect_moved_edges(&mut manager.lockfile, &named.moved);
    transitive.print_plan(manager, &direct_deps_before, &named.moved);
    print_kept_patched(manager);

    let had_errors_before_cleaning_lockfile = manager.log.has_errors();
    manager
        .log
        .print(std::ptr::from_mut(Output::error_writer()))?;
    manager.log.reset();
    super::add_catalog::refuse_declared_positionals(manager);

    // This operation doesn't perform any I/O, so it should be relatively cheap.
    // The old lockfile stays live for the later `eql(lockfile_before_clean, ...)` checks.
    let lockfile_before_clean = Lockfile::clean_with_logger(manager, log_level)?;
    if manager.subcommand == Subcommand::Update && !manager.options.dry_run {
        Output::flush();
        crate::update_transitive::warn_orphaned_patches(manager);
    }
    let requests_removed_from_lockfile = if manager.subcommand == Subcommand::Remove {
        count_requests_removed_from_lockfile(manager, &lockfile_before_clean)
    } else {
        0
    };

    if manager.lockfile.packages.len() > 0 {
        root = *manager.lockfile.packages.get(0);
    }

    if manager.lockfile.packages.len() > 0 {
        for request in &manager.update_requests {
            // prevent redundant errors
            if request.failed {
                return Err(crate::Error::InstallFailed);
            }
        }

        manager.verify_resolutions(log_level);

        super::package_json_write_back::edit_after_resolve(manager)?;

        if manager.options.security_scanner.is_some() {
            run_security_scanner(
                manager,
                ctx,
                original_cwd,
                &lockfile_before_clean,
                &named.moved,
            );
        }
    }

    // append scripts to lockfile before generating new metahash
    manager.load_root_lifecycle_scripts(&root);
    // The root scripts are this install's; drop them on the way out.
    let result = (|| -> crate::Result<()> {
        let manager = &mut *manager;
        if let Some(root_scripts) = &manager.root_lifecycle_scripts {
            root_scripts.append_to_lockfile(&mut manager.lockfile);
        }
        {
            // Split borrow: the resolution/meta/scripts columns are read while
            // pushing into `lockfile.scripts`.
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
                let (first_index, _, entries) = scripts.get_script_entries(
                    string_bytes,
                    ResolutionTag::Workspace,
                    add_node_gyp,
                );

                debug_assert!(first_index != -1);

                // In the `add_node_gyp` arm the assert already guarantees
                // `first_index != -1`, so a single guarded loop covers
                // both paths exactly.
                if first_index != -1 {
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
            && !matches!(load_result, lockfile::DetachedLoadResult::NotFound)
        {
            'frozen_lockfile: {
                let changed_section = frozen_changed_section(manager, root_package_json_path);
                if changed_section.is_none() {
                    if load_result.loaded_from_text_lockfile() {
                        if bun_core::handle_oom(Lockfile::eql(
                            &manager.lockfile,
                            &lockfile_before_clean,
                            lockfile_before_clean.loaded_package_count as usize,
                        )) {
                            break 'frozen_lockfile;
                        }
                    } else if !(manager
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
                    bun_core::pretty_errorln!(
                        "<r><red>error<r><d>:<r> lockfile had changes, but lockfile is frozen"
                    );
                    if let Some(section) = changed_section {
                        bun_core::note!(
                            "{} in package.json changed since {} was saved",
                            section,
                            loaded_lockfile_name(&load_result)
                        );
                    }
                    bun_core::note!(
                        "try re-running without <d>--frozen-lockfile<r> and commit the updated lockfile"
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
        // `workspace_filters` drops at end of scope

        let install_summary: PackageInstallSummary = 'install_summary: {
            if !manager.options.do_.install_packages() {
                break 'install_summary PackageInstallSummary::default();
            }

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
                        let summary = install_hoisted_packages(
                            manager,
                            &workspace_filters,
                            install_root_dependencies,
                            log_level,
                            None,
                        )?;
                        if summary.fail == 0
                            && matches!(
                                manager.subcommand,
                                Subcommand::Dedupe | Subcommand::Audit | Subcommand::Update
                            )
                        {
                            crate::prune::remove_collapsed_copies(manager, &lockfile_before_clean);
                        }
                        break 'install_summary summary;
                    }

                    NodeLinker::Isolated => {
                        break 'install_summary install_isolated_packages(
                            manager,
                            install_root_dependencies,
                            &workspace_filters,
                            None,
                        )?;
                    }
                }
            }
        };

        if log_level != Options::LogLevel::Silent {
            manager
                .log
                .print(std::ptr::from_mut(Output::error_writer()))?;
        }
        if had_errors_before_cleaning_lockfile || manager.log.has_errors() {
            Global::crash();
        }

        let did_meta_hash_change =
        // If the lockfile was frozen, we already checked it
        !manager.options.enable.frozen_lockfile()
            && if load_result.loaded_from_text_lockfile() {
                !manager.lockfile.eql(
                    &lockfile_before_clean,
                    lockfile_before_clean.loaded_package_count as usize,
                )?
            } else {
                manager.lockfile.has_meta_hash_changed(
                    PackageManager::verbose_install() || manager.options.do_.print_meta_hash_string(),
                    packages_len_before_install.min(manager.lockfile.packages.len()),
                )?
            };

        // It's unnecessary work to re-save the lockfile if there are no changes.
        // A loaded text lockfile is never re-saved just to bump its version: an
        // existing `bun.lock` keeps the version it was written with.
        let should_save_lockfile = saves_migrated_lockfile(&load_result, save_format)
        // check `save_lockfile` after checking if loaded from binary and save format is text
        // because `save_lockfile` is set to false for `--frozen-lockfile`
        || (manager.options.do_.save_lockfile()
            && (did_meta_hash_change
                || had_any_diffs
                || !manager.update_requests.is_empty()
                || (matches!(load_result, lockfile::DetachedLoadResult::Ok { .. })
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

        // Before root lifecycle scripts, which exit the process on failure.
        super::package_json_write_back::flush(manager)?;

        if needs_new_lockfile {
            manager.summary.add = manager.lockfile.packages.len() as u32;
        }

        if manager.options.do_.save_yarn_lock() {
            write_yarn_lock_with_progress(manager, log_level)?;
        }

        if manager.options.do_.run_scripts() && install_root_dependencies && !manager.options.global
        {
            run_root_lifecycle_scripts(manager, log_level)?;
        }

        if log_level != Options::LogLevel::Silent {
            print_install_summary(
                manager,
                ctx,
                &install_summary,
                did_meta_hash_change,
                requests_removed_from_lockfile,
                log_level,
            )?;
        }

        if install_summary.fail > 0 {
            manager.any_failed_to_install = true;
        }

        Output::flush();
        Ok(())
    })();
    manager.root_lifecycle_scripts = None;
    result
}

// ─── run_and_wait closure family ──────────────────────────────────────────
// A const-generic struct + three thin wrapper fns.

/// `RunTasksCtx` for the hook-less `run_tasks` call inside
/// `run_and_wait` / `is_done` (`progress_bar = true`).
struct InstallWaitCtx<'a>(&'a mut PackageManager);
impl RunTasksCtx for InstallWaitCtx<'_> {
    fn manager(&mut self) -> &mut PackageManager {
        self.0
    }
    fn progress_bar(&self) -> bool {
        true
    }
}

struct RunAndWaitClosure<const CHECK_PEERS: bool, const ONLY_PRE_PATCH: bool>;

impl<const CHECK_PEERS: bool, const ONLY_PRE_PATCH: bool>
    RunAndWaitClosure<CHECK_PEERS, ONLY_PRE_PATCH>
{
    fn is_done(this: &mut PackageManager, err: &mut Option<crate::Error>) -> bool {
        loop {
            if CHECK_PEERS {
                if let Err(e) = this.process_peer_dependency_list() {
                    *err = Some(e);
                    return true;
                }
            }

            this.drain_dependency_list();

            let log_level = this.options.log_level;
            if let Err(e) = run_tasks(&mut InstallWaitCtx(this), CHECK_PEERS, log_level) {
                *err = Some(e);
                return true;
            }

            // `run_tasks` can resolve a package whose deferred peers create no
            // new async task (e.g. its tarball is already extracted). With zero
            // pending tasks nothing wakes this loop again, so drain the peer
            // queue now instead of sleeping on a wakeup that never comes.
            if CHECK_PEERS && this.peer_dependencies.readable_length() > 0 {
                continue;
            }
            break;
        }

        if ONLY_PRE_PATCH {
            let pending_patch = this.pending_pre_calc_hashes.load(Ordering::Relaxed);
            return pending_patch == 0;
        }

        let pending_tasks = this.pending_task_count();

        if PackageManager::verbose_install() && pending_tasks > 0 {
            if this.has_enough_time_passed_between_waiting_messages() {
                bun_core::pretty_errorln!(
                    "<d>[PackageManager]<r> waiting for {} tasks\n",
                    pending_tasks,
                );
            }
        }

        pending_tasks == 0
    }

    fn run_and_wait(this: &mut PackageManager) -> crate::Result<()> {
        let mut err = None;
        PackageManager::sleep_until(this, |this| Self::is_done(this, &mut err));
        match err {
            Some(err) => Err(err),
            None => Ok(()),
        }
    }
}

fn wait_for_calcing_patch_hashes(this: &mut PackageManager) -> crate::Result<()> {
    RunAndWaitClosure::<false, true>::run_and_wait(this)
}
fn wait_for_everything_except_peers(this: &mut PackageManager) -> crate::Result<()> {
    RunAndWaitClosure::<false, false>::run_and_wait(this)
}
fn wait_for_peers(this: &mut PackageManager) -> crate::Result<()> {
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
    requests_removed_from_lockfile: u32,
    log_level: Options::LogLevel,
) -> crate::Result<()> {
    let _flush_guard = Output::flush_guard();

    let mut printed_timestamp = false;
    if this.options.do_.summary() {
        if this.subcommand == Subcommand::Dedupe {
            crate::dedupe::print_dedupe_summary(this, install_summary.success, ctx.start_time);
            if install_summary.fail > 0 {
                print_summary_failed(install_summary);
            }
            return Ok(());
        }
        if this.subcommand == Subcommand::Update && this.options.dry_run {
            return Ok(());
        }
        print_summary_tree(this, install_summary, log_level)?;

        let print_removed = this.subcommand == Subcommand::Remove
            && this.summary.remove > 0
            && install_summary.success == 0;
        if this.subcommand == Subcommand::Remove {
            this.summary.remove = requests_removed_from_lockfile;
        }

        if !did_meta_hash_change {
            this.summary.remove = 0;
            this.summary.add = 0;
            this.summary.update = 0;
        }

        if print_removed {
            print_removed_rows(this);
        }

        if install_summary.success > 0 {
            print_summary_installed(this, ctx.start_time, install_summary);
            printed_timestamp = true;
        } else if this.summary.remove > 0 {
            print_summary_removed(this, ctx.start_time, install_summary);
            printed_timestamp = true;
        } else if (install_summary.skipped > 0 || !this.options.filter_patterns.is_empty())
            && install_summary.fail == 0
            && (this.update_requests.is_empty() || this.subcommand == Subcommand::Update)
        {
            // Hot no-op path (install/fastify bench): kept inline.
            let count = this.lockfile.packages.len() as PackageID;
            if count != install_summary.skipped {
                bun_core::pretty!(
                    "Checked <green>{} install{}<r> across {} package{} <d>(no changes)<r> ",
                    install_summary.skipped,
                    if install_summary.skipped == 1 {
                        ""
                    } else {
                        "s"
                    },
                    count,
                    if count == 1 { "" } else { "s" },
                );
                Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
                printed_timestamp = true;
                print_blocked_packages_info(install_summary, this.options.global);
            } else {
                bun_core::pretty!(
                    "<r><green>Done<r>! Checked {} package{}<r> <d>(no changes)<r> ",
                    install_summary.skipped,
                    if install_summary.skipped == 1 {
                        ""
                    } else {
                        "s"
                    },
                );
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
) -> crate::Result<()> {
    let mut print_state = crate::lockfile::printer_mods::tree_printer::PrintState {
        kept_patched_text: core::mem::take(&mut this.kept_patched_text),
        track_installed_bin: core::mem::take(&mut this.track_installed_bin),
    };
    let printer = Printer {
        lockfile: &this.lockfile,
        options: &this.options,
        updates: &this.update_requests,
        successfully_installed: install_summary.successfully_installed.as_ref(),
    };

    Output::flush();
    // Ensure at this point buffering is enabled.
    // We deliberately do not disable it after this.
    Output::enable_buffering();
    let writer = Output::writer_buffered();
    let result = if Output::enable_ansi_colors_stdout() {
        LockfilePrinter::Tree::print::<_, true>(&printer, this, &mut print_state, writer, log_level)
    } else {
        LockfilePrinter::Tree::print::<_, false>(
            &printer,
            this,
            &mut print_state,
            writer,
            log_level,
        )
    };
    this.kept_patched_text = print_state.kept_patched_text;
    this.track_installed_bin = print_state.track_installed_bin;
    result
}

#[cold]
#[inline(never)]
fn print_summary_installed(
    this: &PackageManager,
    start_time: i128,
    install_summary: &PackageInstallSummary,
) {
    // bun add: it's confusing when it shows 3 packages and says it installed 1
    let pkgs_installed = if this.subcommand == Subcommand::Add {
        install_summary
            .success
            .max(this.update_requests.len() as u32)
    } else {
        install_summary.success
    };
    bun_core::pretty!(
        "<green>{}<r> package{}<r> installed ",
        pkgs_installed,
        if pkgs_installed == 1 { "" } else { "s" },
    );
    Output::print_start_end_stdout(start_time, nano_timestamp());
    print_blocked_packages_info(install_summary, this.options.global);

    if this.summary.remove > 0 {
        bun_core::pretty!("Removed: <cyan>{}<r>\n", this.summary.remove);
    }
}

#[cold]
#[inline(never)]
fn print_removed_rows(this: &PackageManager) {
    for request in &this.update_requests {
        bun_core::prettyln!("<r><red>-<r> {}", bstr::BStr::new(request.name));
    }
}

/// The differ's `summary.remove` counts names removed from a package.json; the removed count line only counts the requests that left bun.lock.
#[cold]
#[inline(never)]
fn count_requests_removed_from_lockfile(manager: &PackageManager, before_clean: &Lockfile) -> u32 {
    let before = before_clean.packages.items_name_hash();
    let after = manager.lockfile.packages.items_name_hash();
    manager
        .update_requests
        .iter()
        .filter(|request| {
            before.contains(&request.name_hash) && !after.contains(&request.name_hash)
        })
        .count() as u32
}

#[cold]
#[inline(never)]
fn print_summary_removed(
    this: &PackageManager,
    start_time: i128,
    install_summary: &PackageInstallSummary,
) {
    bun_core::pretty!(
        "<r><b>{}<r> package{} removed ",
        this.summary.remove,
        if this.summary.remove == 1 { "" } else { "s" },
    );
    Output::print_start_end_stdout(start_time, nano_timestamp());
    print_blocked_packages_info(install_summary, this.options.global);
}

#[cold]
#[inline(never)]
fn print_summary_failed(install_summary: &PackageInstallSummary) {
    bun_core::prettyln!(
        "<r>Failed to install <red><b>{}<r> package{}\n",
        install_summary.fail,
        if install_summary.fail == 1 { "" } else { "s" },
    );
    Output::flush();
}

#[cold]
#[inline(never)]
fn print_summary_timing_fallback(start_time: i128) {
    Output::print_start_end_stdout(start_time, nano_timestamp());
    bun_core::prettyln!("<d> done<r>");
}

#[cold]
#[inline(never)]
fn print_blocked_packages_info(summary: &PackageInstallSummary, global: bool) {
    let packages_count = summary.packages_with_blocked_scripts.len();
    let mut scripts_count: usize = 0;
    for count in summary.packages_with_blocked_scripts.values() {
        scripts_count += *count;
    }

    // if packages_count is greater than 0, scripts_count must also be greater than 0.
    debug_assert!(packages_count == 0 || scripts_count > 0);
    // if scripts_count is 1, it's only possible for packages_count to be 1.
    debug_assert!(scripts_count != 1 || packages_count == 1);

    if packages_count > 0 {
        bun_core::prettyln!(
            "\n\n<d>Blocked {} postinstall{}. Run `bun pm {}untrusted` for details.<r>\n",
            scripts_count,
            if scripts_count > 1 { "s" } else { "" },
            if global { "-g " } else { "" },
        );
    } else {
        bun_core::pretty!("<r>\n");
    }
}

pub(crate) fn get_workspace_filters(
    manager: &mut PackageManager,
    original_cwd: &[u8],
) -> crate::Result<(Vec<WorkspaceFilter>, bool)> {
    let ids = if manager.subcommand == Subcommand::Install {
        if manager.options.filter_patterns.is_empty() {
            return Ok((Vec::new(), true));
        }
        WorkspaceFilter::select_workspaces(
            &manager.lockfile,
            manager.options.filter_patterns,
            original_cwd,
        )
    } else {
        match &manager.filtered_link_targets {
            None => return Ok((Vec::new(), true)),
            Some(targets) => targets.package_ids(&manager.lockfile),
        }
    };
    let filters = vec![WorkspaceFilter::from_ids(ids)];
    let install_root_dependencies = WorkspaceFilter::is_selected(&filters, 0);
    Ok((filters, install_root_dependencies))
}

fn frozen_changed_section(
    manager: &mut PackageManager,
    root_package_json_path: &ZStr,
) -> Option<&'static str> {
    if manager.summary.overrides_changed {
        Some(overrides_field_name(manager, root_package_json_path))
    } else if manager.summary.catalogs_changed {
        Some("the catalog")
    } else {
        None
    }
}

#[cold]
#[inline(never)]
fn overrides_field_name(
    manager: &mut PackageManager,
    root_package_json_path: &ZStr,
) -> &'static str {
    let log = &mut manager.log;
    let WorkspacePackageJsonCacheResult::Entry(entry) = manager
        .workspace_package_json_cache
        .get_with_path(log, root_package_json_path.as_bytes(), Default::default())
    else {
        return "overrides";
    };
    let root = entry.root;
    if root.as_property(b"overrides").is_none() && root.as_property(b"resolutions").is_some() {
        "resolutions"
    } else {
        "overrides"
    }
}

pub(crate) fn loaded_lockfile_name(load_result: &lockfile::DetachedLoadResult) -> &'static str {
    if load_result.loaded_from_binary_lockfile() {
        "bun.lockb"
    } else {
        "bun.lock"
    }
}

/// Adds a contextual error for a dependency resolution failure.
/// This provides better error messages than just propagating the raw error.
/// The error is logged to manager.log, and the install will fail later when
/// manager.log.has_errors() is checked.
#[cold]
#[inline(never)]
fn add_dependency_error(manager: &mut PackageManager, dependency: &Dependency, err: crate::Error) {
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

    let log = &mut manager.log;
    if dependency.behavior.is_optional() || dependency.behavior.is_peer() {
        log.add_warning_with_note(
            None,
            Default::default(),
            err.name().as_bytes(),
            format_args!("error occurred while resolving {}", path_fmt),
        );
    } else {
        log.add_zig_error_with_note(
            err.name(),
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
) -> crate::Result<()> {
    if log_level != Options::LogLevel::Silent
        && !crate::migration::reported_unsupported_lockfile_version(cause)
    {
        Output::err(
            cause.value,
            "failed to {} lockfile: '{}'",
            (cause.step.verb(), bstr::BStr::new(&cause.lockfile_path)),
        );

        if !manager.options.enable.fail_early() {
            Output::print_errorln("");
            bun_core::warn!("Ignoring lockfile");
        }

        if manager.log.errors > 0 {
            manager
                .log
                .print(std::ptr::from_mut(Output::error_writer()))?;
            manager.log.reset();
        }
        Output::flush();
    }

    if manager.options.enable.fail_early() {
        Global::crash();
    }
    Ok(())
}

/// Returns the rows the plan re-resolved so the overrides/catalogs invalidation loops that follow leave them pinned; only tracked when those loops will run.
fn enqueue_transitive(
    manager: &mut PackageManager,
    transitive: &TransitiveUpdate,
    track_rows: bool,
) -> crate::Result<DynamicBitSet> {
    if !track_rows {
        transitive.enqueue(manager)?;
        return Ok(DynamicBitSet::default());
    }
    transitive.enqueue_tracked(manager)
}

#[derive(Default)]
struct NamedUpdates {
    /// Invalidated rows paired with the package they resolved to, for redirect_moved_edges.
    moved: Vec<(DependencyID, PackageID)>,
    /// `--latest` only: every in-scope row naming a requested package, for refresh_children_of_named.
    latest_rows: Vec<DependencyID>,
}

/// bun update <name>…: every in-scope row resolving to <name> (see update_scope) re-resolves within its own range; rows the differ re-enqueued are left to it, peers with a provider and bundled rows only follow via redirect_moved_edges.
#[cold]
#[inline(never)]
fn enqueue_named_updates(
    manager: &mut PackageManager,
    direct: &DirectDependencies,
    lockfile_name: &'static str,
) -> crate::Result<NamedUpdates> {
    let walkable = crate::update_scope::UpdateScope::of(&*manager).walkable_rows(&manager.lockfile);
    let plannable_peers = plannable_peer_rows(&manager.lockfile, direct);
    let collect_latest_rows = manager.options.do_.update_to_latest();
    let requests = manager.update_requests.len();
    let mut matched = DynamicBitSet::init_empty(requests).unwrap_or_oom();
    let mut matched_elsewhere = DynamicBitSet::init_empty(requests).unwrap_or_oom();
    let mut named = NamedUpdates::default();
    let mut peer_rows: Vec<DependencyID> = Vec::new();
    let dependencies_len = manager.lockfile.buffers.dependencies.len();
    for dependency_i in 0..dependencies_len {
        let dependency = manager.lockfile.buffers.dependencies[dependency_i].clone();
        let package_id = manager.lockfile.buffers.resolutions[dependency_i];
        let Some(request) = index_of_named_update(manager, &dependency, package_id) else {
            continue;
        };
        if !walkable.is_set(dependency_i) {
            matched_elsewhere.set(request);
            continue;
        }
        matched.set(request);
        if collect_latest_rows {
            named.latest_rows.push(dependency_i as DependencyID);
        }
        if package_id == invalid_package_id || dependency.behavior.is_bundled() {
            continue;
        }
        if dependency.behavior.is_peer() {
            if plannable_peers.is_set(dependency_i) {
                peer_rows.push(dependency_i as DependencyID);
            }
            continue;
        }
        manager.lockfile.buffers.resolutions[dependency_i] = invalid_package_id;
        named.moved.push((dependency_i as DependencyID, package_id));
        if let Err(err) = enqueue_dependency_with_main(
            manager,
            dependency_i as DependencyID,
            &dependency,
            invalid_package_id,
            false,
        ) {
            add_dependency_error(manager, &dependency, err);
        }
    }

    reject_unknown_update_requests(
        manager,
        lockfile_name,
        |i, _| !matched.is_set(i) && !matched_elsewhere.is_set(i),
        |i| !matched.is_set(i) && matched_elsewhere.is_set(i),
    );
    enqueue_peer_rows(manager, &peer_rows, &mut named.moved)?;
    Ok(named)
}

fn index_of_named_update(
    manager: &PackageManager,
    dependency: &Dependency,
    package_id: PackageID,
) -> Option<usize> {
    let buf = manager.lockfile.buffers.string_bytes.as_slice();
    if let Some(i) =
        manager.index_of_update_request(dependency.name_hash, dependency.name.slice(buf))
    {
        return Some(i);
    }
    if package_id != invalid_package_id {
        let name_hash = manager.lockfile.packages.items_name_hash()[package_id as usize];
        if name_hash == dependency.name_hash {
            return None;
        }
        let name = manager.lockfile.packages.items_name()[package_id as usize].slice(buf);
        return manager.index_of_update_request(name_hash, name);
    }
    let realname = dependency.realname();
    if realname.eql(dependency.name, buf, buf) {
        return None;
    }
    let realname = realname.slice(buf);
    manager.index_of_update_request_named(realname)
}

#[cold]
#[inline(never)]
fn reject_unknown_update_requests(
    manager: &PackageManager,
    lockfile_name: &'static str,
    is_unknown: impl Fn(usize, &UpdateRequest) -> bool,
    is_out_of_scope: impl Fn(usize) -> bool,
) {
    let requests = &manager.update_requests;
    let out_of_scope: Vec<(usize, &UpdateRequest)> = requests
        .iter()
        .enumerate()
        .filter(|&(i, _)| is_out_of_scope(i))
        .collect();
    let unknown: Vec<&UpdateRequest> = requests
        .iter()
        .enumerate()
        .filter_map(|(i, request)| is_unknown(i, request).then_some(request))
        .collect();
    if out_of_scope.is_empty() && unknown.is_empty() {
        return;
    }
    if manager.options.log_level == Options::LogLevel::Silent {
        Global::exit(1);
    }
    Output::flush();
    let scope = crate::update_scope::UpdateScope::of(manager);
    let of_what = if scope.targets.is_some() {
        "the selected workspaces"
    } else {
        "this workspace"
    };
    for &(i, request) in &out_of_scope {
        let name = bstr::BStr::new(request.get_name());
        Output::err_generic("\"{}\" is not a dependency of {}", (name, of_what));
        bun_core::pretty_errorln!("    <cyan>bun update -r {}<r>", name);
        for workspace in workspaces_reaching_request(manager, &scope, i) {
            bun_core::pretty_errorln!(
                "    <cyan>bun update --filter {} {}<r>",
                bstr::BStr::new(workspace),
                name
            );
        }
    }
    for request in &unknown {
        let name = bstr::BStr::new(request.get_name());
        Output::err_generic("\"{}\" is not in {}", (name, lockfile_name));
        bun_core::pretty_errorln!("    <cyan>bun add {}<r>", name);
    }
    Output::flush();
    Global::exit(1);
}

fn workspaces_reaching_request<'a>(
    manager: &'a PackageManager,
    scope: &crate::update_scope::UpdateScope<'_>,
    request_index: usize,
) -> Vec<&'a [u8]> {
    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let packages = &lockfile.packages;
    let package_resolutions = packages.items_resolution();
    let names = packages.items_name();
    let name_hashes = packages.items_name_hash();
    let dep_lists = packages.items_dependencies();
    let res_lists = packages.items_resolutions();

    let mut owners = DynamicBitSet::init_empty(packages.len()).unwrap_or_oom();
    let all_deps = lockfile.buffers.dependencies.as_slice();
    let all_resolutions = lockfile.buffers.resolutions.as_slice();
    for (pkg_id, (dep_list, res_list)) in dep_lists.iter().zip(res_lists).enumerate() {
        if dep_list
            .get(all_deps)
            .iter()
            .zip(res_list.get(all_resolutions))
            .any(|(dep, &res)| index_of_named_update(manager, dep, res) == Some(request_index))
        {
            owners.set(pkg_id);
        }
    }
    if owners.count() == 0 {
        return Vec::new();
    }

    let mut workspaces: Vec<&'a [u8]> = Vec::new();
    for importer in 0..packages.len() {
        let tag = package_resolutions[importer].tag;
        if !matches!(tag, ResolutionTag::Root | ResolutionTag::Workspace) {
            continue;
        }
        let name = names[importer].slice(buf);
        if name.is_empty()
            || scope.contains_workspace(tag == ResolutionTag::Root, name_hashes[importer], name)
        {
            continue;
        }
        let reached = reachable::packages_from(
            lockfile,
            all_resolutions,
            &[importer as PackageID],
            false,
            reachable::Options::all(0),
        );
        if (0..packages.len()).any(|pkg_id| owners.is_set(pkg_id) && reached.is_set(pkg_id)) {
            workspaces.push(name);
        }
    }
    workspaces
}

#[cold]
#[inline(never)]
fn record_updating_package_versions(manager: &mut PackageManager) {
    // existing lockfile, get the original version is updating
    let lockfile: &Lockfile = &manager.lockfile;
    let updating_packages = &mut manager.updating_packages;
    let packages = lockfile.packages.slice();
    let resolutions = packages.items_resolution();
    // Bare `-r`/`--filter` edits the targets' package.json files only after resolve (`package_json_write_back`), so their rows are registered here instead.
    let register_rows =
        manager.update_target_workspaces.is_some() && manager.update_requests.is_empty();
    let update_to_latest = manager
        .options
        .do_
        .contains(crate::package_manager::options::Do::UPDATE_TO_LATEST);
    let mut workspaces = DynamicBitSet::init_empty(packages.len()).unwrap_or_oom();
    match manager.update_target_workspaces.as_deref() {
        None => workspaces.set(
            manager
                .root_package_id
                .get(lockfile, manager.workspace_name_hash) as usize,
        ),
        Some(targets) => {
            let buf = lockfile.buffers.string_bytes.as_slice();
            let names = packages.items_name();
            let name_hashes = packages.items_name_hash();
            for (id, resolution) in resolutions.iter().enumerate() {
                let is_root = resolution.tag == ResolutionTag::Root;
                if (is_root || resolution.tag == ResolutionTag::Workspace)
                    && targets.iter().any(|target| {
                        target.matches(is_root, name_hashes[id], names[id].slice(buf))
                    })
                {
                    workspaces.set(id);
                }
            }
        }
    }
    let mut selected = workspaces.iterator::<true, true>();
    while let Some(workspace_package_id) = selected.next() {
        let workspace_dep_list = packages.items_dependencies()[workspace_package_id];
        let workspace_res_list = packages.items_resolutions()[workspace_package_id];
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

            let name = dep.name.slice(&lockfile.buffers.string_bytes);
            let entry_ptr = if register_rows {
                if dep.version.tag == DependencyVersionTag::DistTag && !update_to_latest {
                    continue;
                }
                let entry = updating_packages.get_or_put(name).unwrap_or_oom();
                if !entry.found_existing {
                    entry.value_ptr.original_version_literal =
                        Box::from(dep.version.literal.slice(&lockfile.buffers.string_bytes));
                }
                entry.value_ptr
            } else {
                let Some(entry_ptr) = updating_packages.get_mut(name) else {
                    continue;
                };
                entry_ptr
            };
            if entry_ptr.original_version.is_some() {
                continue;
            }
            let original_resolution: Resolution = resolutions[package_id as usize];
            if original_resolution.tag != ResolutionTag::Npm {
                continue;
            }

            let mut original = original_resolution.npm().version;
            let tag_total = original.tag.pre.len() + original.tag.build.len();
            if tag_total > 0 {
                let mut tag_buf = vec![0u8; tag_total].into_boxed_slice();
                original.tag = original_resolution.npm().version.tag.clone_into(
                    &lockfile.buffers.string_bytes,
                    &mut tag_buf,
                    &mut 0,
                );

                entry_ptr.original_version_string_buf = tag_buf;
            }

            entry_ptr.original_version = Some(original);
        }
    }
}

fn root_package_json_source(
    manager: &mut PackageManager,
    root_package_json_path: &ZStr,
) -> crate::Result<Source> {
    let (verb, err) = match manager.workspace_package_json_cache.get_with_path(
        &mut manager.log,
        root_package_json_path.as_bytes(),
        Default::default(),
    ) {
        WorkspacePackageJsonCacheResult::Entry(entry) => return Ok(entry.source.clone()),
        WorkspacePackageJsonCacheResult::ReadErr(err) => ("read", err),
        WorkspacePackageJsonCacheResult::ParseErr(err) => ("parse", err),
    };
    if manager.log.errors > 0 {
        manager
            .log
            .print(std::ptr::from_mut(Output::error_writer()))?;
    }
    Output::err(
        err,
        "failed to {} '{}'",
        (verb, bstr::BStr::new(root_package_json_path.as_bytes())),
    );
    Global::exit(1);
}

#[cold]
#[inline(never)]
fn create_new_lockfile_and_enqueue(
    manager: &mut PackageManager,
    load_result: &lockfile::DetachedLoadResult,
    root_package_json_path: &ZStr,
    log_level: Options::LogLevel,
) -> crate::Result<lockfile::Package> {
    let mut root = lockfile::Package::default();

    // `init_empty()` resets `text_lockfile_version` to the current version. When
    // we're recreating the lockfile from an existing text `bun.lock` (e.g. it
    // had no dependencies yet, so the differ short-circuits here), preserve the
    // on-disk version so re-saving it still doesn't bump the format — matching
    // the "an existing lockfile keeps its version" behavior everywhere else.
    let preserved_text_version = match load_result {
        lockfile::DetachedLoadResult::Ok(ok) if ok.format == lockfile::Format::Text => {
            Some(manager.lockfile.text_lockfile_version)
        }
        _ => None,
    };
    manager.lockfile.init_empty();
    if let Some(version) = preserved_text_version {
        manager.lockfile.text_lockfile_version = version;
    }

    if manager.options.enable.frozen_lockfile()
        && !matches!(load_result, lockfile::DetachedLoadResult::NotFound)
    {
        if log_level != Options::LogLevel::Silent {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: lockfile had changes, but lockfile is frozen"
            );
        }
        Global::crash();
    }

    let source_copy = root_package_json_source(manager, root_package_json_path)?;

    let mut resolver: () = ();
    manager.with_lockfile_and_log(|lockfile, manager, log| {
        root.parse(
            lockfile,
            manager,
            log,
            &source_copy,
            &mut resolver,
            Features::main(),
        )
    })?;

    root = manager.lockfile.append_package(&root)?;

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
    named: &mut NamedUpdates,
) -> crate::Result<()> {
    if root.dependencies.len > 0 {
        let _ = manager.get_cache_directory();
        let _ = manager.get_temporary_directory();
    }

    if log_level.show_progress() {
        manager.start_progress_bar();
    } else if log_level != Options::LogLevel::Silent {
        bun_core::pretty_errorln!("Resolving dependencies");
        Output::flush();
    }

    if manager.lockfile.patched_dependencies.len() > 0 {
        wait_for_calcing_patch_hashes(manager)?;
    }

    wait_for_resolution(manager)?;

    if !named.latest_rows.is_empty() {
        let child_moves = refresh_children_of_named(manager, &named.latest_rows)?;
        named.moved.extend(child_moves);
        wait_for_resolution(manager)?;
    }

    if log_level.show_progress() {
        manager.end_progress_bar();
    } else if log_level != Options::LogLevel::Silent {
        bun_core::pretty_errorln!(
            "Resolved, downloaded and extracted [{}]",
            manager.total_tasks,
        );
        Output::flush();
    }
    Ok(())
}

/// `bun update <name> --latest`: the packages the named rows now resolve to get their own children moved in-range too.
#[cold]
#[inline(never)]
fn refresh_children_of_named(
    manager: &mut PackageManager,
    latest_rows: &[DependencyID],
) -> crate::Result<Vec<(DependencyID, PackageID)>> {
    let mut package_ids: Vec<PackageID> = {
        let lockfile = &*manager.lockfile;
        let resolutions = lockfile.buffers.resolutions.as_slice();
        let pkg_res = lockfile.packages.items_resolution();
        latest_rows
            .iter()
            .map(|&dep_id| resolutions[dep_id as usize])
            .filter(|&id| {
                (id as usize) < pkg_res.len()
                    && !matches!(
                        pkg_res[id as usize].tag,
                        ResolutionTag::Root | ResolutionTag::Workspace
                    )
            })
            .collect()
    };
    index_sort::sort_indices_unstable(&mut package_ids, &mut |a, b| a.cmp(&b));
    package_ids.dedup();
    if package_ids.is_empty() {
        return Ok(Vec::new());
    }
    let moves = crate::update_transitive::refresh_children_of(manager, &package_ids)?;
    manager.drain_dependency_list();
    Ok(moves)
}

fn wait_for_resolution(manager: &mut PackageManager) -> crate::Result<()> {
    if manager.pending_task_count() > 0 {
        wait_for_everything_except_peers(manager)?;
    }

    // Resolving a peer dep can create a NEW package whose own peer deps
    // get re-queued to `peer_dependencies` during `drain_dependency_list`.
    // When all manifests are cached (synchronous resolution), no I/O tasks
    // are spawned, so `pending_task_count() == 0`. We must drain the peer
    // queue iteratively here — entering the event loop (`wait_for_peers`)
    // with zero pending I/O would block forever.
    while manager.peer_dependencies.readable_length() > 0 {
        manager.process_peer_dependency_list()?;
        manager.drain_dependency_list();
    }

    if manager.pending_task_count() > 0 {
        wait_for_peers(manager)?;
    }
    Ok(())
}

#[cold]
#[inline(never)]
fn run_security_scanner(
    manager: &mut PackageManager,
    ctx: Command::Context,
    original_cwd: &[u8],
    before_clean: &Lockfile,
    moved: &[(DependencyID, PackageID)],
) {
    let is_subcommand_to_run_scanner = matches!(
        manager.subcommand,
        Subcommand::Add
            | Subcommand::Update
            | Subcommand::Install
            | Subcommand::Remove
            | Subcommand::Audit
    );

    if !is_subcommand_to_run_scanner {
        return;
    }

    let seeds = moved_targets_after_clean(before_clean, &manager.lockfile, moved);
    match security_scanner::perform_security_scan_after_resolution(
        manager,
        ctx,
        original_cwd,
        &seeds,
    ) {
        Err(err) => {
            match err {
                crate::Error::SecurityScannerInWorkspace => {
                    Output::err_generic(
                        "security scanner cannot be a dependency of a workspace package. It must be a direct dependency of the root package.",
                        (),
                    );
                }
                crate::Error::SecurityScannerRetryFailed => {
                    Output::err_generic(
                        "security scanner failed after partial install. This is probably a bug in Bun. Please report it at https://github.com/oven-sh/bun/issues",
                        (),
                    );
                }
                crate::Error::InvalidPackageID => {
                    Output::err_generic(
                        "cannot perform partial install: security scanner package ID is invalid",
                        (),
                    );
                }
                crate::Error::PartialInstallFailed => {
                    Output::err_generic("failed to install security scanner package", ());
                }
                crate::Error::NoPackagesInstalled => {
                    Output::err_generic(
                        "no packages were installed during security scanner installation",
                        (),
                    );
                }
                crate::Error::IPCPipeFailed => {
                    Output::err_generic("failed to create IPC pipe for security scanner", ());
                }
                crate::Error::ProcessWatchFailed => {
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
            // `results` drops at end of scope
            security_scanner::print_security_advisories(manager, &results);

            if results.has_fatal_advisories() {
                bun_core::pretty!(
                    "<red>Installation aborted due to fatal security advisories<r>\n"
                );
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

// bun.lockb / package-lock.json / yarn.lock / pnpm-lock.yaml -> bun.lock is written even under --frozen-lockfile.
fn saves_migrated_lockfile(
    load_result: &lockfile::DetachedLoadResult,
    save_format: lockfile::Format,
) -> bool {
    save_format == lockfile::Format::Text
        && matches!(
            load_result,
            lockfile::DetachedLoadResult::Ok(ok)
                if ok.format == lockfile::Format::Binary || ok.migrated != lockfile::Migrated::None
        )
}

#[cold]
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn save_lockfile_only(
    manager: &mut PackageManager,
    ctx: Command::Context,
    load_result: &lockfile::DetachedLoadResult,
    save_format: lockfile::Format,
    had_any_diffs: bool,
    lockfile_before_install: bun_ptr::ParentRef<Lockfile>,
    packages_len_before_install: usize,
    log_level: Options::LogLevel,
) -> crate::Result<()> {
    if (manager.options.enable.frozen_lockfile()
        && !saves_migrated_lockfile(load_result, save_format))
        || (manager.subcommand == Subcommand::Dedupe && manager.dedupe_report.is_none())
    {
        Output::flush();
        return Ok(());
    }

    // save the lockfile and exit. make sure metahash is generated for binary lockfile
    manager.lockfile.meta_hash = manager.lockfile.generate_meta_hash(
        PackageManager::verbose_install() || manager.options.do_.print_meta_hash_string(),
        packages_len_before_install,
    )?;

    let saved = save_lockfile(
        manager,
        load_result,
        save_format,
        had_any_diffs,
        lockfile_before_install.get(),
        packages_len_before_install,
        log_level,
    )?;

    if manager.subcommand == Subcommand::Dedupe {
        if manager.options.do_.summary() {
            crate::dedupe::print_dedupe_summary(manager, 0, ctx.start_time);
        }
    } else if manager.options.do_.summary() {
        let count = manager.lockfile.packages.len();
        let plural = if count == 1 { "" } else { "s" };
        if saved {
            // TODO(dylan-conway): packages aren't installed but we can still print
            // added/removed/updated direct dependencies.
            bun_core::pretty!(
                "\nSaved <green>{}<r> ({} package{}) ",
                match save_format {
                    lockfile::Format::Text => "bun.lock",
                    lockfile::Format::Binary => "bun.lockb",
                },
                count,
                plural,
            );
        } else {
            bun_core::pretty!(
                "\n<r><green>Done<r>! Checked <b>{}<r> package{} <d>(no changes)<r> ",
                count,
                plural
            );
        }
        Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
        bun_core::pretty!("\n");
    }
    Output::flush();
    Ok(())
}

#[cold]
#[inline(never)]
fn write_yarn_lock_with_progress(
    manager: &mut PackageManager,
    log_level: Options::LogLevel,
) -> crate::Result<()> {
    let mut node_started = false;
    if log_level.show_progress() {
        manager.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        let _ = manager.progress.start(b"Saving yarn.lock", 0);
        manager.progress.refresh();
        node_started = true;
    } else if log_level != Options::LogLevel::Silent {
        bun_core::pretty_errorln!("Saved yarn.lock");
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
    log_level: Options::LogLevel,
) -> crate::Result<()> {
    if let Some(scripts) = manager.root_lifecycle_scripts.take() {
        debug_assert!(scripts.total > 0);

        if log_level != Options::LogLevel::Silent {
            Output::print_error(format_args!("\n"));
            Output::flush();
        }
        // root lifecycle scripts can run now that all dependencies are installed, dependency scripts
        // have finished, and lockfiles have been saved
        let optional = false;
        let output_in_foreground = true;
        // `spawn_package_lifecycle_scripts` consumes by-value; `.take()`
        // moves it out (`package_name` is owned by the List and drops with it).
        manager.spawn_package_lifecycle_scripts(scripts, optional, output_in_foreground, None)?;

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
