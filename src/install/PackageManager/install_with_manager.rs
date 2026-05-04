use core::sync::atomic::Ordering;

use bun_core::{Global, Output, Progress};
use bun_core::time::nano_timestamp;
use bun_cli::Command;
use bun_str::{strings, ZStr};
use bun_semver::String as SemverString;
use bun_fs::FileSystem;
use bun_paths as Path;
use bun_glob as glob;

use crate::{
    Dependency, DependencyID, Features, PackageID, PackageInstall, PackageNameHash, PatchTask,
    Resolution, TextLockfile, invalid_package_id,
};
use crate::lockfile::{self, Lockfile, Package};
use crate::PackageManager;
use crate::package_manager::{Options, WorkspaceFilter};
use crate::hoisted_install::install_hoisted_packages;
use crate::isolated_install::install_isolated_packages;

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
    if !manager.env.has_http_proxy() {
        // And don't try to resolve DNS if it's an IP address.
        if !manager.options.scope.url.hostname.is_empty() && !manager.options.scope.url.is_ip_address() {
            // PERF(port): was stack-fallback alloc — profile in Phase B
            let hostname = bun_str::ZStr::from_bytes(&manager.options.scope.url.hostname);
            bun_dns::internal::prefetch(
                manager.event_loop.loop_(),
                &hostname,
                manager.options.scope.url.get_port_auto(),
            );
        }
    }

    let mut load_result: lockfile::LoadResult = if manager.options.do_.load_lockfile {
        manager.lockfile.load_from_cwd(manager, manager.log, true)
    } else {
        lockfile::LoadResult::NotFound
    };

    manager.update_lockfile_if_needed(&load_result)?;

    let (config_version, changed_config_version) = load_result.choose_config_version();
    manager.options.config_version = config_version;

    let mut root = Lockfile::Package::default();
    let mut needs_new_lockfile = !matches!(load_result, lockfile::LoadResult::Ok { .. })
        || (load_result.ok().lockfile.buffers.dependencies.is_empty()
            && !manager.update_requests.is_empty());

    manager.options.enable.force_save_lockfile = manager.options.enable.force_save_lockfile
        || changed_config_version
        || (matches!(load_result, lockfile::LoadResult::Ok { .. })
            // if migrated always save a new lockfile
            && (load_result.ok().migrated != lockfile::Migrated::None
                // if loaded from binary and save-text-lockfile is passed
                || (load_result.ok().format == lockfile::Format::Binary
                    && manager.options.save_text_lockfile.unwrap_or(false))));

    // this defaults to false
    // but we force allowing updates to the lockfile when you do bun add
    let mut had_any_diffs = false;
    manager.progress = Progress::default();

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

                if !manager.options.enable.fail_early {
                    Output::print_error_ln("", format_args!(""));
                    Output::warn("Ignoring lockfile", format_args!(""));
                }

                if ctx.log.errors > 0 {
                    manager.log.print(Output::error_writer())?;
                    manager.log.reset();
                }
                Output::flush();
            }

            if manager.options.enable.fail_early {
                Global::crash();
            }
        }
        lockfile::LoadResult::Ok(ok) => {
            if manager.subcommand == PackageManager::Subcommand::Update {
                // existing lockfile, get the original version is updating
                let lockfile = &*manager.lockfile;
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
                    if dep.version.tag != Dependency::VersionTag::Npm
                        && dep.version.tag != Dependency::VersionTag::DistTag
                    {
                        continue;
                    }
                    if package_id == invalid_package_id {
                        continue;
                    }

                    if let Some(entry_ptr) = manager
                        .updating_packages
                        .get_mut(dep.name.slice(&lockfile.buffers.string_bytes))
                    {
                        let original_resolution: Resolution = resolutions[package_id as usize];
                        // Just in case check if the resolution is `npm`. It should always be `npm` because the dependency version
                        // is `npm` or `dist_tag`.
                        if original_resolution.tag != Resolution::Tag::Npm {
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

                let mut lockfile = Lockfile::init_empty();
                let mut maybe_root = Lockfile::Package::default();

                let root_package_json_entry = match manager.workspace_package_json_cache.get_with_path(
                    manager.log,
                    root_package_json_path,
                    Default::default(),
                ) {
                    crate::WorkspacePackageJsonCacheResult::Entry(entry) => entry,
                    crate::WorkspacePackageJsonCacheResult::ReadErr(err) => {
                        if ctx.log.errors > 0 {
                            manager.log.print(Output::error_writer())?;
                        }
                        Output::err(err, "failed to read '{}'", format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())));
                        Global::exit(1);
                    }
                    crate::WorkspacePackageJsonCacheResult::ParseErr(err) => {
                        if ctx.log.errors > 0 {
                            manager.log.print(Output::error_writer())?;
                        }
                        Output::err(err, "failed to parse '{}'", format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())));
                        Global::exit(1);
                    }
                };

                let source_copy = root_package_json_entry.source;

                let mut resolver: () = ();
                maybe_root.parse(
                    &mut lockfile,
                    manager,
                    manager.log,
                    &source_copy,
                    &mut resolver,
                    Features::main(),
                )?;
                let mut mapping = vec![invalid_package_id; maybe_root.dependencies.len as usize].into_boxed_slice();
                // @memset already done via vec! init

                manager.summary = Package::Diff::generate(
                    manager,
                    manager.log,
                    manager.lockfile,
                    &mut lockfile,
                    &mut root,
                    &mut maybe_root,
                    if manager.to_update { Some(&manager.update_requests) } else { None },
                    &mut mapping,
                )?;

                had_any_diffs = manager.summary.has_diffs();

                if !had_any_diffs {
                    // always grab latest scripts for root package
                    let mut builder_ = manager.lockfile.string_builder();
                    let builder = &mut builder_;

                    maybe_root.scripts.count(&lockfile.buffers.string_bytes, builder);
                    builder.allocate()?;
                    manager.lockfile.packages.items_scripts_mut()[0] =
                        maybe_root.scripts.clone_into_builder(&lockfile.buffers.string_bytes, builder);
                    builder.clamp();
                } else {
                    let mut builder_ = manager.lockfile.string_builder();
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

                    lockfile.overrides.count(&lockfile, builder);
                    lockfile.catalogs.count(&lockfile, builder);
                    maybe_root.scripts.count(&lockfile.buffers.string_bytes, builder);

                    let off = manager.lockfile.buffers.dependencies.len() as u32;
                    let len = new_dependencies.len() as u32;
                    let mut packages = manager.lockfile.packages.slice_mut();
                    let dep_lists = packages.items_dependencies_mut();
                    let resolution_lists = packages.items_resolutions_mut();
                    let old_resolutions_list = resolution_lists[0];
                    dep_lists[0] = lockfile::DependencySlice { off, len };
                    resolution_lists[0] = lockfile::DependencyIDSlice { off, len };
                    builder.allocate()?;

                    let all_name_hashes: Vec<PackageNameHash> = 'brk: {
                        if !manager.summary.overrides_changed {
                            break 'brk Vec::new();
                        }
                        let hashes_len = manager.lockfile.overrides.map.len() + lockfile.overrides.map.len();
                        if hashes_len == 0 {
                            break 'brk Vec::new();
                        }
                        let mut all_name_hashes: Vec<PackageNameHash> = Vec::with_capacity(hashes_len);
                        all_name_hashes.extend_from_slice(manager.lockfile.overrides.map.keys());
                        all_name_hashes.extend_from_slice(lockfile.overrides.map.keys());
                        let mut i = manager.lockfile.overrides.map.len();
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

                    manager.lockfile.overrides = lockfile.overrides.clone_into(manager, &lockfile, manager.lockfile, builder)?;
                    manager.lockfile.catalogs = lockfile.catalogs.clone_into(manager, &lockfile, manager.lockfile, builder)?;

                    manager.lockfile.trusted_dependencies = if let Some(trusted_dependencies) = &lockfile.trusted_dependencies {
                        Some(trusted_dependencies.clone())
                    } else {
                        None
                    };

                    manager.lockfile.buffers.dependencies.reserve(len as usize);
                    manager.lockfile.buffers.resolutions.reserve(len as usize);

                    let old_resolutions = old_resolutions_list.get(&manager.lockfile.buffers.resolutions);

                    // PORT NOTE: reshaped for borrowck — Zig directly slices into the vec's spare capacity
                    // via `.items.ptr[off .. off + len]`. We resize and slice instead.
                    // SAFETY: capacity reserved above; we are writing into [off..off+len).
                    unsafe {
                        manager.lockfile.buffers.dependencies.set_len((off + len) as usize);
                        manager.lockfile.buffers.resolutions.set_len((off + len) as usize);
                    }
                    let dependencies = &mut manager.lockfile.buffers.dependencies[off as usize..(off + len) as usize];
                    let resolutions = &mut manager.lockfile.buffers.resolutions[off as usize..(off + len) as usize];

                    // It is too easy to accidentally undefined memory
                    resolutions.fill(invalid_package_id);
                    dependencies.fill(Dependency::default());

                    for (i, new_dep) in new_dependencies.iter().enumerate() {
                        dependencies[i] = new_dep.clone_into_builder(manager, &lockfile.buffers.string_bytes, builder)?;
                        if mapping[i] != invalid_package_id {
                            resolutions[i] = old_resolutions[mapping[i] as usize];
                        }
                    }

                    manager.lockfile.packages.items_scripts_mut()[0] =
                        maybe_root.scripts.clone_into_builder(&lockfile.buffers.string_bytes, builder);

                    // Update workspace paths
                    manager.lockfile.workspace_paths.reserve(lockfile.workspace_paths.len());
                    {
                        manager.lockfile.workspace_paths.clear();
                        let mut iter = lockfile.workspace_paths.iter();
                        while let Some((key, value)) = iter.next() {
                            // The string offsets will be wrong so fix them
                            let path = value.slice(&lockfile.buffers.string_bytes);
                            let str = builder.append::<SemverString>(path);
                            // PERF(port): was assume_capacity
                            manager.lockfile.workspace_paths.insert(*key, str);
                        }
                    }

                    // Update workspace versions
                    manager.lockfile.workspace_versions.reserve(lockfile.workspace_versions.len());
                    {
                        manager.lockfile.workspace_versions.clear();
                        let mut iter = lockfile.workspace_versions.iter();
                        while let Some((key, value)) = iter.next() {
                            // Copy version string offsets
                            let version = value.append(&lockfile.buffers.string_bytes, builder);
                            // PERF(port): was assume_capacity
                            manager.lockfile.workspace_versions.insert(*key, version);
                        }
                    }

                    // Update patched dependencies
                    {
                        let mut iter = lockfile.patched_dependencies.iter();
                        while let Some((key, value)) = iter.next() {
                            let pkg_name_and_version_hash = *key;
                            debug_assert!(value.patchfile_hash_is_null);
                            let gop = manager
                                .lockfile
                                .patched_dependencies
                                .entry(pkg_name_and_version_hash);
                            // TODO(port): ArrayHashMap getOrPut semantics — using entry API approximation
                            match gop {
                                bun_collections::array_hash_map::Entry::Vacant(v) => {
                                    let mut new = lockfile::PatchedDependency {
                                        path: builder.append::<SemverString>(
                                            value.path.slice(&lockfile.buffers.string_bytes),
                                        ),
                                        ..Default::default()
                                    };
                                    new.set_patchfile_hash(None);
                                    v.insert(new);
                                    // gop.value_ptr.path = gop.value_ptr.path;
                                }
                                bun_collections::array_hash_map::Entry::Occupied(mut o) => {
                                    if !strings::eql(
                                        o.get().path.slice(&manager.lockfile.buffers.string_bytes),
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
                        let mut iter = manager.lockfile.patched_dependencies.iter();
                        while let Some((key, _)) = iter.next() {
                            if !lockfile.patched_dependencies.contains_key(key) {
                                count += 1;
                            }
                        }
                        if count > 0 {
                            manager.patched_dependencies_to_remove.reserve(count);
                            let mut iter = manager.lockfile.patched_dependencies.iter();
                            while let Some((key, _)) = iter.next() {
                                if !lockfile.patched_dependencies.contains_key(key) {
                                    manager.patched_dependencies_to_remove.insert(*key, ());
                                }
                            }
                            for hash in manager.patched_dependencies_to_remove.keys() {
                                let _ = manager.lockfile.patched_dependencies.shift_remove(hash);
                            }
                        }
                    }

                    builder.clamp();

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
                                if let Err(err) = manager.enqueue_dependency_with_main(
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
                            if dep.version.tag != Dependency::VersionTag::Catalog {
                                continue;
                            }

                            manager.lockfile.buffers.resolutions[dep_id as usize] = invalid_package_id;
                            if let Err(err) = manager.enqueue_dependency_with_main(
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
                                if let Err(err) = manager.enqueue_dependency_with_main(
                                    dependency_i,
                                    &dependency,
                                    manager.lockfile.buffers.resolutions[dependency_i as usize],
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
        manager.lockfile.init_empty_in_place();

        if manager.options.enable.frozen_lockfile && !matches!(load_result, lockfile::LoadResult::NotFound) {
            if log_level != Options::LogLevel::Silent {
                Output::pretty_error_ln("<r><red>error<r>: lockfile had changes, but lockfile is frozen", format_args!(""));
            }
            Global::crash();
        }

        let root_package_json_entry = match manager.workspace_package_json_cache.get_with_path(
            manager.log,
            root_package_json_path,
            Default::default(),
        ) {
            crate::WorkspacePackageJsonCacheResult::Entry(entry) => entry,
            crate::WorkspacePackageJsonCacheResult::ReadErr(err) => {
                if ctx.log.errors > 0 {
                    manager.log.print(Output::error_writer())?;
                }
                Output::err(err, "failed to read '{}'", format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())));
                Global::exit(1);
            }
            crate::WorkspacePackageJsonCacheResult::ParseErr(err) => {
                if ctx.log.errors > 0 {
                    manager.log.print(Output::error_writer())?;
                }
                Output::err(err, "failed to parse '{}'", format_args!("{}", bstr::BStr::new(root_package_json_path.as_bytes())));
                Global::exit(1);
            }
        };

        let source_copy = root_package_json_entry.source;

        let mut resolver: () = ();
        root.parse(
            manager.lockfile,
            manager,
            manager.log,
            &source_copy,
            &mut resolver,
            Features::main(),
        )?;

        root = manager.lockfile.append_package(root)?;

        if root.dependencies.len > 0 {
            let _ = manager.get_cache_directory();
            let _ = manager.get_temporary_directory();
        }
        {
            let mut iter = manager.lockfile.patched_dependencies.iter();
            while let Some((key, _)) = iter.next() {
                manager.enqueue_patch_task_pre(PatchTask::new_calc_patch_hash(manager, *key, None));
            }
        }
        manager.enqueue_dependency_list(root.dependencies);
    } else {
        {
            let mut iter = manager.lockfile.patched_dependencies.iter();
            while let Some((key, _)) = iter.next() {
                manager.enqueue_patch_task_pre(PatchTask::new_calc_patch_hash(manager, *key, None));
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
            Output::pretty_error_ln("Resolving dependencies", format_args!(""));
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
            Output::pretty_error_ln(
                "Resolved, downloaded and extracted [{}]",
                format_args!("{}", manager.total_tasks),
            );
            Output::flush();
        }
    }

    let had_errors_before_cleaning_lockfile = manager.log.has_errors();
    manager.log.print(Output::error_writer())?;
    manager.log.reset();

    // This operation doesn't perform any I/O, so it should be relatively cheap.
    let lockfile_before_clean = manager.lockfile;

    manager.lockfile = manager.lockfile.clean_with_logger(
        manager,
        &manager.update_requests,
        manager.log,
        manager.options.enable.exact_versions,
        log_level,
    )?;

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
                PackageManager::Subcommand::Add
                    | PackageManager::Subcommand::Update
                    | PackageManager::Subcommand::Install
                    | PackageManager::Subcommand::Remove
            );

            if is_subcommand_to_run_scanner {
                match security_scanner::perform_security_scan_after_resolution(manager, &ctx, original_cwd) {
                    Err(err) => {
                        match err {
                            e if e == bun_core::err!("SecurityScannerInWorkspace") => {
                                Output::err_generic("security scanner cannot be a dependency of a workspace package. It must be a direct dependency of the root package.", format_args!(""));
                            }
                            e if e == bun_core::err!("SecurityScannerRetryFailed") => {
                                Output::err_generic("security scanner failed after partial install. This is probably a bug in Bun. Please report it at https://github.com/oven-sh/bun/issues", format_args!(""));
                            }
                            e if e == bun_core::err!("InvalidPackageID") => {
                                Output::err_generic("cannot perform partial install: security scanner package ID is invalid", format_args!(""));
                            }
                            e if e == bun_core::err!("PartialInstallFailed") => {
                                Output::err_generic("failed to install security scanner package", format_args!(""));
                            }
                            e if e == bun_core::err!("NoPackagesInstalled") => {
                                Output::err_generic("no packages were installed during security scanner installation", format_args!(""));
                            }
                            e if e == bun_core::err!("IPCPipeFailed") => {
                                Output::err_generic("failed to create IPC pipe for security scanner", format_args!(""));
                            }
                            e if e == bun_core::err!("ProcessWatchFailed") => {
                                Output::err_generic("failed to watch security scanner process", format_args!(""));
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
                            Output::pretty("<red>Installation aborted due to fatal security advisories<r>\n", format_args!(""));
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
    // TODO(port): retype root_lifecycle_scripts.package_name as Box<[u8]> so Drop frees it
    // (Zig had `defer manager.allocator.free(scripts.package_name)` here.)

    if let Some(root_scripts) = &manager.root_lifecycle_scripts {
        root_scripts.append_to_lockfile(manager.lockfile);
    }
    {
        let packages = manager.lockfile.packages.slice();
        let resolutions = packages.items_resolution();
        let metas = packages.items_meta();
        let scripts_slice = packages.items_scripts();
        debug_assert_eq!(resolutions.len(), metas.len());
        debug_assert_eq!(resolutions.len(), scripts_slice.len());
        for ((resolution, meta), scripts) in resolutions.iter().zip(metas).zip(scripts_slice) {
            if resolution.tag == Resolution::Tag::Workspace {
                if meta.has_install_script() {
                    if scripts.has_any() {
                        let (first_index, _, entries) = scripts.get_script_entries(
                            manager.lockfile,
                            &manager.lockfile.buffers.string_bytes,
                            lockfile::ScriptKind::Workspace,
                            false,
                        );

                        if cfg!(debug_assertions) {
                            debug_assert!(first_index != -1);
                        }

                        if first_index != -1 {
                            // TODO(port): inline-for over `Lockfile.Scripts.names` with `@field` reflection.
                            // Phase B: replace with a generated `Scripts::list_mut(i)` accessor or unrolled match.
                            for (i, maybe_entry) in entries.iter().enumerate() {
                                if let Some(entry) = maybe_entry {
                                    manager.lockfile.scripts.list_mut(i).push(*entry);
                                    // PERF(port): was bun.handleOom on append
                                }
                            }
                        }
                    } else {
                        let (first_index, _, entries) = scripts.get_script_entries(
                            manager.lockfile,
                            &manager.lockfile.buffers.string_bytes,
                            lockfile::ScriptKind::Workspace,
                            true,
                        );

                        if cfg!(debug_assertions) {
                            debug_assert!(first_index != -1);
                        }

                        // TODO(port): inline-for over `Lockfile.Scripts.names` with `@field` reflection.
                        for (i, maybe_entry) in entries.iter().enumerate() {
                            if let Some(entry) = maybe_entry {
                                manager.lockfile.scripts.list_mut(i).push(*entry);
                                // PERF(port): was bun.handleOom on append
                            }
                        }
                    }
                }
            }
        }
    }

    if manager.options.global {
        manager.setup_global_dir(&ctx)?;
    }

    let packages_len_before_install = manager.lockfile.packages.len();

    if manager.options.enable.frozen_lockfile && !matches!(load_result, lockfile::LoadResult::NotFound) {
        'frozen_lockfile: {
            if load_result.loaded_from_text_lockfile() {
                if manager.lockfile.eql(lockfile_before_clean, packages_len_before_install) {
                    break 'frozen_lockfile;
                }
            } else {
                if !(manager
                    .lockfile
                    .has_meta_hash_changed(
                        PackageManager::verbose_install() || manager.options.do_.print_meta_hash_string,
                        packages_len_before_install,
                    )
                    .unwrap_or(false))
                {
                    break 'frozen_lockfile;
                }
            }

            if log_level != Options::LogLevel::Silent {
                Output::pretty_error_ln("<r><red>error<r><d>:<r> lockfile had changes, but lockfile is frozen", format_args!(""));
                Output::note("try re-running without <d>--frozen-lockfile<r> and commit the updated lockfile", format_args!(""));
            }
            Global::crash();
        }
    }

    let lockfile_before_install = manager.lockfile;

    let save_format = load_result.save_format(&manager.options);

    if manager.options.lockfile_only {
        // save the lockfile and exit. make sure metahash is generated for binary lockfile

        manager.lockfile.meta_hash = manager.lockfile.generate_meta_hash(
            PackageManager::verbose_install() || manager.options.do_.print_meta_hash_string,
            packages_len_before_install,
        )?;

        manager.save_lockfile(
            &load_result,
            save_format,
            had_any_diffs,
            lockfile_before_install,
            packages_len_before_install,
            log_level,
        )?;

        if manager.options.do_.summary {
            // TODO(dylan-conway): packages aren't installed but we can still print
            // added/removed/updated direct dependencies.
            Output::pretty(
                "\nSaved <green>{}<r> ({} package{}) ",
                format_args!(
                    "{} {} {}",
                    match save_format {
                        lockfile::SaveFormat::Text => "bun.lock",
                        lockfile::SaveFormat::Binary => "bun.lockb",
                    },
                    manager.lockfile.packages.len(),
                    if manager.lockfile.packages.len() == 1 { "" } else { "s" },
                ),
            );
            // TODO(port): Output::pretty multi-arg formatting — Zig used positional `{s} {d} {s}`
            Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
            Output::pretty("\n", format_args!(""));
        }
        Output::flush();
        return Ok(());
    }

    let (workspace_filters, install_root_dependencies) = get_workspace_filters(manager, original_cwd)?;
    // `workspace_filters` drops at end of scope (Zig had `defer manager.allocator.free(workspace_filters)`)

    let install_summary: PackageInstall::Summary = 'install_summary: {
        if !manager.options.do_.install_packages {
            break 'install_summary PackageInstall::Summary::default();
        }

        // Zig `linker: switch` with `continue :linker` — emulate with a small loop.
        let mut linker = manager.options.node_linker;
        loop {
            match linker {
                Options::NodeLinker::Auto => match config_version {
                    Options::ConfigVersion::V0 => {
                        linker = Options::NodeLinker::Hoisted;
                        continue;
                    }
                    Options::ConfigVersion::V1 => {
                        if !load_result.migrated_from_npm() && manager.lockfile.workspace_paths.len() > 0 {
                            linker = Options::NodeLinker::Isolated;
                            continue;
                        }
                        linker = Options::NodeLinker::Hoisted;
                        continue;
                    }
                },

                Options::NodeLinker::Hoisted => {
                    break 'install_summary install_hoisted_packages(
                        manager,
                        &ctx,
                        &workspace_filters,
                        install_root_dependencies,
                        log_level,
                        None,
                    )?;
                }

                Options::NodeLinker::Isolated => {
                    break 'install_summary install_isolated_packages(
                        manager,
                        &ctx,
                        install_root_dependencies,
                        &workspace_filters,
                        None,
                    );
                    // PERF(port): was bun.handleOom — install_isolated_packages aborts on OOM internally now
                }
            }
        }
    };

    if log_level != Options::LogLevel::Silent {
        manager.log.print(Output::error_writer())?;
    }
    if had_errors_before_cleaning_lockfile || manager.log.has_errors() {
        Global::crash();
    }

    let did_meta_hash_change =
        // If the lockfile was frozen, we already checked it
        !manager.options.enable.frozen_lockfile
            && if load_result.loaded_from_text_lockfile() {
                !manager.lockfile.eql(lockfile_before_clean, packages_len_before_install)?
            } else {
                manager.lockfile.has_meta_hash_changed(
                    PackageManager::verbose_install() || manager.options.do_.print_meta_hash_string,
                    packages_len_before_install.min(manager.lockfile.packages.len()),
                )?
            };

    // It's unnecessary work to re-save the lockfile if there are no changes
    let should_save_lockfile = (matches!(load_result, lockfile::LoadResult::Ok { .. })
        && ((load_result.ok().format == lockfile::Format::Binary && save_format == lockfile::SaveFormat::Text)
            // make sure old versions are updated
            || load_result.ok().format == lockfile::Format::Text
                && save_format == lockfile::SaveFormat::Text
                && manager.lockfile.text_lockfile_version != TextLockfile::Version::current()))
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
        let mut node: Option<&mut Progress::Node> = None;
        if log_level.show_progress() {
            manager.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
            node = Some(manager.progress.start("Saving yarn.lock", 0));
            manager.progress.refresh();
        } else if log_level != Options::LogLevel::Silent {
            Output::pretty_error_ln("Saved yarn.lock", format_args!(""));
            Output::flush();
        }

        manager.write_yarn_lock()?;
        if log_level.show_progress() {
            if let Some(n) = node {
                n.complete_one();
            }
            manager.progress.refresh();
            manager.progress.root.end();
            manager.progress = Progress::default();
        }
    }

    if manager.options.do_.run_scripts && install_root_dependencies && !manager.options.global {
        if let Some(scripts) = &manager.root_lifecycle_scripts {
            if cfg!(debug_assertions) {
                debug_assert!(scripts.total > 0);
            }

            if log_level != Options::LogLevel::Silent {
                Output::print_error("\n", format_args!(""));
                Output::flush();
            }
            // root lifecycle scripts can run now that all dependencies are installed, dependency scripts
            // have finished, and lockfiles have been saved
            let optional = false;
            let output_in_foreground = true;
            manager.spawn_package_lifecycle_scripts(&ctx, scripts, optional, output_in_foreground, None)?;

            // .monotonic is okay because at this point, this value is only accessed from this
            // thread.
            while manager.pending_lifecycle_script_tasks.load(Ordering::Relaxed) > 0 {
                manager.report_slow_lifecycle_scripts();
                manager.sleep();
            }
        }
    }

    if log_level != Options::LogLevel::Silent {
        print_install_summary(manager, &ctx, &install_summary, did_meta_hash_change, log_level)?;
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

struct RunAndWaitClosure<'a, const CHECK_PEERS: bool, const ONLY_PRE_PATCH: bool> {
    manager: &'a mut PackageManager,
    err: Option<bun_core::Error>,
}

impl<'a, const CHECK_PEERS: bool, const ONLY_PRE_PATCH: bool>
    RunAndWaitClosure<'a, CHECK_PEERS, ONLY_PRE_PATCH>
{
    fn is_done(closure: &mut Self) -> bool {
        let this = &mut *closure.manager;
        if CHECK_PEERS {
            if let Err(err) = this.process_peer_dependency_list() {
                closure.err = Some(err);
                return true;
            }
        }

        this.drain_dependency_list();

        if let Err(err) = this.run_tasks(
            this,
            PackageManager::RunTasksCallbacks {
                on_extract: (),
                on_resolve: (),
                on_package_manifest_error: (),
                on_package_download_error: (),
                progress_bar: true,
            },
            CHECK_PEERS,
            this.options.log_level,
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
                Output::pretty_error_ln(
                    "<d>[PackageManager]<r> waiting for {} tasks\n",
                    format_args!("{}", pending_tasks),
                );
            }
        }

        pending_tasks == 0
    }

    fn run_and_wait(this: &mut PackageManager) -> Result<(), bun_core::Error> {
        let mut closure = RunAndWaitClosure::<CHECK_PEERS, ONLY_PRE_PATCH> {
            manager: this,
            err: None,
        };

        // TODO(port): `sleepUntil` takes `&mut closure` and a fn-pointer `is_done`; verify signature in Phase B.
        this.sleep_until(&mut closure, Self::is_done);

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
    ctx: &Command::Context,
    install_summary: &PackageInstall::Summary,
    did_meta_hash_change: bool,
    log_level: Options::LogLevel,
) -> Result<(), bun_core::Error> {
    let _flush_guard = scopeguard::guard((), |_| Output::flush());

    let mut printed_timestamp = false;
    if this.options.do_.summary {
        let mut printer = lockfile::Printer {
            lockfile: this.lockfile,
            options: this.options,
            updates: &this.update_requests,
            successfully_installed: install_summary.successfully_installed,
        };

        {
            Output::flush();
            // Ensure at this point buffering is enabled.
            // We deliberately do not disable it after this.
            Output::enable_buffering();
            let writer = Output::writer_buffered();
            // Runtime bool → comptime dispatch
            if Output::enable_ansi_colors_stdout() {
                lockfile::Printer::Tree::print::<_, true>(&mut printer, this, writer, log_level)?;
            } else {
                lockfile::Printer::Tree::print::<_, false>(&mut printer, this, writer, log_level)?;
            }
        }

        if !did_meta_hash_change {
            this.summary.remove = 0;
            this.summary.add = 0;
            this.summary.update = 0;
        }

        if install_summary.success > 0 {
            // it's confusing when it shows 3 packages and says it installed 1
            let pkgs_installed = install_summary.success.max(this.update_requests.len() as u32);
            Output::pretty(
                "<green>{}<r> package{}<r> installed ",
                format_args!("{}{}", pkgs_installed, if pkgs_installed == 1 { "" } else { "s" }),
            );
            // TODO(port): Output::pretty multi-arg formatting
            Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
            printed_timestamp = true;
            print_blocked_packages_info(install_summary, this.options.global);

            if this.summary.remove > 0 {
                Output::pretty("Removed: <cyan>{}<r>\n", format_args!("{}", this.summary.remove));
            }
        } else if this.summary.remove > 0 {
            if this.subcommand == PackageManager::Subcommand::Remove {
                for request in &this.update_requests {
                    Output::pretty_ln("<r><red>-<r> {}", format_args!("{}", bstr::BStr::new(&request.name)));
                }
            }

            Output::pretty(
                "<r><b>{}<r> package{} removed ",
                format_args!("{}{}", this.summary.remove, if this.summary.remove == 1 { "" } else { "s" }),
            );
            // TODO(port): Output::pretty multi-arg formatting
            Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
            printed_timestamp = true;
            print_blocked_packages_info(install_summary, this.options.global);
        } else if install_summary.skipped > 0 && install_summary.fail == 0 && this.update_requests.is_empty() {
            let count = this.lockfile.packages.len() as PackageID;
            if count != install_summary.skipped {
                if !this.options.enable.only_missing {
                    Output::pretty(
                        "Checked <green>{} install{}<r> across {} package{} <d>(no changes)<r> ",
                        format_args!(
                            "{}{}{}{}",
                            install_summary.skipped,
                            if install_summary.skipped == 1 { "" } else { "s" },
                            count,
                            if count == 1 { "" } else { "s" },
                        ),
                    );
                    // TODO(port): Output::pretty multi-arg formatting
                    Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
                }
                printed_timestamp = true;
                print_blocked_packages_info(install_summary, this.options.global);
            } else {
                Output::pretty(
                    "<r><green>Done<r>! Checked {} package{}<r> <d>(no changes)<r> ",
                    format_args!(
                        "{}{}",
                        install_summary.skipped,
                        if install_summary.skipped == 1 { "" } else { "s" },
                    ),
                );
                // TODO(port): Output::pretty multi-arg formatting
                Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
                printed_timestamp = true;
                print_blocked_packages_info(install_summary, this.options.global);
            }
        }

        if install_summary.fail > 0 {
            Output::pretty_ln(
                "<r>Failed to install <red><b>{}<r> package{}\n",
                format_args!("{}{}", install_summary.fail, if install_summary.fail == 1 { "" } else { "s" }),
            );
            // TODO(port): Output::pretty multi-arg formatting
            Output::flush();
        }
    }

    if this.options.do_.summary {
        if !printed_timestamp {
            Output::print_start_end_stdout(ctx.start_time, nano_timestamp());
            Output::pretty_ln("<d> done<r>", format_args!(""));
            printed_timestamp = true;
            let _ = printed_timestamp;
        }
    }

    Ok(())
}

fn print_blocked_packages_info(summary: &PackageInstall::Summary, global: bool) {
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
        Output::pretty_ln(
            "\n\n<d>Blocked {} postinstall{}. Run `bun pm {}untrusted` for details.<r>\n",
            format_args!(
                "{}{}{}",
                scripts_count,
                if scripts_count > 1 { "s" } else { "" },
                if global { "-g " } else { "" },
            ),
        );
        // TODO(port): Output::pretty multi-arg formatting
    } else {
        Output::pretty("<r>\n", format_args!(""));
    }
}

pub fn get_workspace_filters(
    manager: &mut PackageManager,
    original_cwd: &[u8],
) -> Result<(Vec<WorkspaceFilter>, bool), bun_core::Error> {
    let path_buf = bun_paths::path_buffer_pool().get();
    // RAII: guard puts the buffer back on Drop.

    let mut workspace_filters: Vec<WorkspaceFilter> = Vec::new();
    // only populated when subcommand is `.install`
    if manager.subcommand == PackageManager::Subcommand::Install
        && !manager.options.filter_patterns.is_empty()
    {
        workspace_filters.reserve(manager.options.filter_patterns.len());
        for pattern in &manager.options.filter_patterns {
            workspace_filters.push(WorkspaceFilter::init(pattern, original_cwd, &mut path_buf[..])?);
        }
    }

    let mut install_root_dependencies = workspace_filters.is_empty();
    if !install_root_dependencies {
        let pkg_names = manager.lockfile.packages.items_name();

        let abs_root_path: &[u8] = 'abs_root_path: {
            #[cfg(not(windows))]
            {
                break 'abs_root_path strings::without_trailing_slash(FileSystem::instance().top_level_dir);
            }

            #[cfg(windows)]
            {
                let abs_path = Path::path_to_posix_buf::<u8>(FileSystem::instance().top_level_dir, &mut path_buf);
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

            match glob::match_(pattern, path_or_name) {
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
    let lockfile = &*manager.lockfile;
    let note_fmt = "error occurred while resolving {}";
    let note_args = format_args!(
        "{}",
        bun_core::fmt::fmt_path::<u8>(
            lockfile.str(&dependency.realname()),
            bun_core::fmt::PathOptions {
                path_sep: match dependency.version.tag {
                    Dependency::VersionTag::Folder => bun_core::fmt::PathSep::Auto,
                    _ => bun_core::fmt::PathSep::Any,
                },
                ..Default::default()
            },
        )
    );

    if dependency.behavior.is_optional() || dependency.behavior.is_peer() {
        manager
            .log
            .add_warning_with_note(None, Default::default(), err.name(), note_fmt, note_args)
            .expect("unreachable");
    } else {
        manager
            .log
            .add_zig_error_with_note(err, note_fmt, note_args)
            .expect("unreachable");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/install_with_manager.zig (1204 lines)
//   confidence: medium
//   todos:      13
//   notes:      Output::pretty multi-arg fmt needs a real API; @field/Scripts.names reflection stubbed via list_mut(i); heavy borrowck reshaping expected around manager.lockfile aliases; load_result.ok() accessor assumed.
// ──────────────────────────────────────────────────────────────────────────
