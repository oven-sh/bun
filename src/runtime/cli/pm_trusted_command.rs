use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_alloc::Arena as Bump;
use bun_collections::{ArrayHashMap, ArrayIdentityContext, StringArrayHashMap};
use bun_core::strings;
use bun_core::{Global, Output, Progress};
use bun_install::lockfile::{
    LoadResult, Lockfile,
    package::PackageColumns as _,
    package::scripts::{List as ScriptsList, PrintFormat, Scripts},
    tree,
};
use bun_install::package_manager_real::{
    PackageJSONEditor, ProgressStrings, ROOT_PACKAGE_JSON_PATH, update_lockfile_if_needed,
};
use bun_install::{
    self as install, DEFAULT_TRUSTED_DEPENDENCIES_LIST, DependencyID, LifecycleScriptSubprocess,
    PackageID, PackageManager, Resolution, ResolutionTag,
};
use bun_paths::AutoAbsPath;

use crate::cli::Command;
use crate::package_manager_command::PackageManagerCommand;

type DepIdSet = ArrayHashMap<DependencyID, (), ArrayIdentityContext>;

/// Under the isolated linker, packages live at
/// `node_modules/.bun/<name>@<version>[+<peerhash>]/node_modules/<name>` instead
/// of the hoisted `node_modules/<name>` path [`tree::Iterator`] assumes. This
/// walks the `.bun` store, probes each untrusted package where it actually
/// lives, and invokes `f` for each one that has lifecycle scripts. Returns
/// `Ok(false)` when `node_modules/.bun` does not exist (hoisted layout; caller
/// falls back to the tree walk).
///
/// Peer-hash suffixes are discovered by readdir rather than recomputing the
/// Store: a package's entries are every directory name equal to
/// `<name>@<res>` or prefixed `<name>@<res>+`.
fn collect_isolated_untrusted_scripts(
    log: &mut bun_ast::Log,
    lockfile: &Lockfile,
    scripts: &[Scripts],
    resolutions: &[Resolution],
    untrusted_dep_ids: &DepIdSet,
    mut f: impl FnMut(DependencyID, PackageID, ScriptsList) -> crate::Result<()>,
) -> crate::Result<bool> {
    let mut store_path = AutoAbsPath::init_top_level_dir();
    let _ = store_path.append(b"node_modules");
    let _ = store_path.append(b".bun");

    let store_fd = match bun_sys::open_dir_for_iteration(bun_sys::Fd::cwd(), store_path.slice()) {
        Ok(fd) => fd,
        Err(e) if e.get_errno() == bun_sys::E::ENOENT => return Ok(false),
        Err(e) => return Err(crate::Error::from(e)),
    };
    let _close = scopeguard::guard(store_fd, |fd| {
        let _ = bun_sys::close(fd);
    });

    let mut entries: Vec<Box<[u8]>> = Vec::new();
    let mut iter = bun_sys::iterate_dir(store_fd);
    loop {
        match iter.next() {
            Ok(Some(ent)) => {
                let name = ent.name.slice_u8();
                if name == b"node_modules" || name.first() == Some(&b'.') {
                    continue;
                }
                entries.push(Box::from(name));
            }
            Ok(None) => break,
            Err(e) => return Err(crate::Error::from(e)),
        }
    }

    let buf = lockfile.buffers.string_bytes.as_slice();
    let packages = lockfile.packages.slice();
    let pkg_names = packages.items_name();

    let mut seen_pkg_ids: ArrayHashMap<PackageID, (), ArrayIdentityContext> = ArrayHashMap::new();

    for &dep_id in untrusted_dep_ids.keys() {
        let package_id = lockfile.buffers.resolutions.as_slice()[dep_id as usize];
        if package_id == install::INVALID_PACKAGE_ID
            || package_id as usize >= resolutions.len()
            || seen_pkg_ids.contains(&package_id)
        {
            continue;
        }
        let resolution = &resolutions[package_id as usize];
        match resolution.tag {
            ResolutionTag::Root | ResolutionTag::Workspace | ResolutionTag::Symlink => continue,
            _ => {}
        }
        seen_pkg_ids.put(package_id, ())?;

        let pkg_name = pkg_names[package_id as usize];
        let dep = &lockfile.buffers.dependencies.as_slice()[dep_id as usize];
        let alias = dep.name.slice(buf);

        // Matches `isolated_install::store::entry::StorePathFormatter` for the
        // non-Root/Workspace tags (minus the trailing peer-hash suffix, which
        // is matched by the `+`-prefix check below).
        let prefix = match resolution.tag {
            ResolutionTag::Folder => format!(
                "{}@file+{}",
                pkg_name.fmt_store_path(buf),
                resolution.folder().fmt_store_path(buf),
            ),
            _ => format!(
                "{}@{}",
                pkg_name.fmt_store_path(buf),
                resolution.fmt_store_path(buf),
            ),
        }
        .into_bytes();

        for entry in &entries {
            let matches = entry[..] == prefix[..]
                || (entry.len() > prefix.len()
                    && entry[..prefix.len()] == prefix[..]
                    && entry[prefix.len()] == b'+');
            if !matches {
                continue;
            }

            let mut folder_path = AutoAbsPath::init_top_level_dir();
            let _ = folder_path.append(b"node_modules");
            let _ = folder_path.append(b".bun");
            let _ = folder_path.append(&entry[..]);
            let _ = folder_path.append(b"node_modules");
            let _ = folder_path.append(pkg_name.slice(buf));

            let mut package_scripts = scripts[package_id as usize];
            let maybe_list = match package_scripts.get_list(
                log,
                lockfile,
                &mut folder_path,
                alias,
                resolution,
            ) {
                Ok(v) => v,
                Err(bun_install::Error::Sys(bun_errno::SystemErrno::ENOENT)) => continue,
                Err(e) => return Err(e.into()),
            };

            if let Some(list) = maybe_list {
                if list.total > 0 && !list.items.is_empty() {
                    f(dep_id, package_id, list)?;
                }
            }
        }
    }

    Ok(true)
}

pub(crate) struct DefaultTrustedCommand;

impl DefaultTrustedCommand {
    pub(crate) fn exec() -> crate::Result<()> {
        Output::print(format_args!(
            "Default trusted dependencies ({}):\n",
            DEFAULT_TRUSTED_DEPENDENCIES_LIST.len()
        ));
        for name in DEFAULT_TRUSTED_DEPENDENCIES_LIST.iter() {
            bun_core::pretty!(" <d>-<r> {}\n", bstr::BStr::new(name));
        }

        Ok(())
    }
}

pub(crate) struct UntrustedCommand;

impl UntrustedCommand {
    pub(crate) fn exec(
        ctx: Command::Context,
        pm: &mut PackageManager,
        args: &[&[u8]],
    ) -> crate::Result<()> {
        let _ = args;
        bun_core::pretty_error!(
            "<r><b>bun pm untrusted <r><d>v{}<r>\n\n",
            Global::package_json_version_with_sha,
        );
        Output::flush();

        // Reshaped for borrowck — `LoadResult` returned by
        // `load_lockfile_from_cwd` mutably borrows `pm.lockfile`, so all
        // subsequent `pm` access goes through `pm_raw`. Same singleton pattern
        // as `package_manager_command.rs::print_hash`.
        let pm_raw: *mut PackageManager = pm;
        let log_level = pm.options.log_level;
        let load_lockfile = pm.load_lockfile_from_cwd::<true>();
        PackageManagerCommand::handle_load_lockfile_errors(&load_lockfile, log_level);
        // SAFETY: `pm_raw` derived from `pm` above; `update_lockfile_if_needed`
        // reads `load_result.serializer_result` (no `ok.lockfile` deref) and
        // writes through `manager.lockfile`, which is the same heap allocation
        // `load_lockfile` borrows but is never dereferenced via `load_lockfile`
        // here.
        unsafe { update_lockfile_if_needed(&mut *pm_raw, &load_lockfile)? };

        // SAFETY: `load_lockfile` is not used past this point; `pm_raw` is the
        // only path to the singleton for the rest of this fn (same as the
        // original `pm`).
        let pm: &mut PackageManager = unsafe { &mut *pm_raw };
        let log: &mut bun_ast::Log = pm.log_mut();
        let lockfile: &Lockfile = &pm.lockfile;

        let packages = lockfile.packages.slice();
        let scripts: &[Scripts] = packages.items_scripts();
        let resolutions: &[Resolution] = packages.items_resolution();
        let buf = lockfile.buffers.string_bytes.as_slice();

        let mut untrusted_dep_ids: DepIdSet = DepIdSet::new();

        // loop through dependencies and get trusted and untrusted deps with lifecycle scripts
        for (i, dep) in lockfile.buffers.dependencies.as_slice().iter().enumerate() {
            let dep_id: DependencyID = DependencyID::try_from(i).expect("int cast");
            let package_id = lockfile.buffers.resolutions.as_slice()[dep_id as usize];
            if package_id == install::INVALID_PACKAGE_ID {
                continue;
            }

            // called alias because a dependency name is not always the package name
            let alias = dep.name.slice(buf);
            let pkg_name = packages.items_name()[package_id as usize].slice(buf);
            let resolution = &resolutions[package_id as usize];
            if !lockfile.has_trusted_dependency(alias, pkg_name, resolution) {
                untrusted_dep_ids.put(dep_id, ())?;
            }
        }

        if untrusted_dep_ids.count() == 0 {
            Self::print_zero_untrusted_dependencies_found();
            return Ok(());
        }

        let mut untrusted_deps: ArrayHashMap<DependencyID, ScriptsList, ArrayIdentityContext> =
            ArrayHashMap::new();

        let found_isolated = collect_isolated_untrusted_scripts(
            log,
            lockfile,
            scripts,
            resolutions,
            &untrusted_dep_ids,
            |dep_id, _package_id, list| {
                untrusted_deps.put(dep_id, list)?;
                Ok(())
            },
        )?;

        if !found_isolated {
            let mut tree_iterator =
                tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(lockfile);

            let mut node_modules_path = AutoAbsPath::init_top_level_dir();

            while let Some(node_modules) = tree_iterator.next(None) {
                // `ResetScope`
                // exclusively borrows the path, so save/restore the length
                // explicitly. Restored at end of each iteration; the inner-loop
                // `continue`/`return` paths only need the inner `folder_saved`
                // restore (done immediately after `get_list`).
                let nm_saved = node_modules_path.len();
                let _ = node_modules_path.append(node_modules.relative_path.as_bytes());

                for &dep_id in node_modules.dependencies {
                    if !untrusted_dep_ids.contains(&dep_id) {
                        continue;
                    }
                    let dep = &lockfile.buffers.dependencies.as_slice()[dep_id as usize];
                    let alias = dep.name.slice(buf);
                    let package_id = lockfile.buffers.resolutions.as_slice()[dep_id as usize];

                    if package_id as usize >= packages.len() {
                        continue;
                    }

                    let resolution = &resolutions[package_id as usize];
                    let mut package_scripts = scripts[package_id as usize];

                    let folder_saved = node_modules_path.len();
                    let _ = node_modules_path.append(alias);

                    let result = package_scripts.get_list(
                        log,
                        lockfile,
                        &mut node_modules_path,
                        alias,
                        resolution,
                    );
                    node_modules_path.set_length(folder_saved);

                    let maybe_scripts_list = match result {
                        Ok(v) => v,
                        Err(bun_install::Error::Sys(bun_errno::SystemErrno::ENOENT)) => continue,
                        Err(e) => return Err(e.into()),
                    };

                    if let Some(scripts_list) = maybe_scripts_list {
                        if scripts_list.total == 0 || scripts_list.items.is_empty() {
                            continue;
                        }
                        untrusted_deps.put(dep_id, scripts_list)?;
                    }
                }

                node_modules_path.set_length(nm_saved);
            }
        }

        if untrusted_deps.count() == 0 {
            Self::print_zero_untrusted_dependencies_found();
            return Ok(());
        }

        let mut iter = untrusted_deps.iterator();
        while let Some(entry) = iter.next() {
            let dep_id = *entry.key_ptr;
            let scripts_list = &*entry.value_ptr;
            let package_id = lockfile.buffers.resolutions.as_slice()[dep_id as usize];
            let resolution = &lockfile.packages.items_resolution()[package_id as usize];

            scripts_list.print_scripts(resolution, buf, PrintFormat::Untrusted);
            bun_core::pretty!("\n");
        }

        bun_core::pretty!(
            "These dependencies had their lifecycle scripts blocked during install.\n\
             \n\
             If you trust them and wish to run their scripts, use <d>`<r><blue>bun pm trust<r><d>`<r>.\n"
        );

        let _ = ctx;
        Ok(())
    }

    fn print_zero_untrusted_dependencies_found() {
        bun_core::pretty!(
            "Found <b>0<r> untrusted dependencies with scripts.\n\
             \n\
             This means all packages with scripts are in \"trustedDependencies\" or none of your dependencies have scripts.\n\
             \n\
             For more information, visit <magenta>https://bun.com/docs/install/lifecycle#trusteddependencies<r>\n"
        );
    }
}

pub(crate) struct TrustCommand;

/// Value type stored in `scripts_at_depth`.
struct ScriptInfo {
    package_id: PackageID,
    scripts_list: ScriptsList,
    skip: bool,
}

impl TrustCommand {
    fn error_expected_args() -> ! {
        Output::err_generic("expected package names(s) or --all", ());
        Global::crash();
    }

    fn print_error_zero_untrusted_dependencies_found(trust_all: bool, packages_to_trust: &[&[u8]]) {
        Output::print(format_args!("\n"));
        if trust_all {
            Output::err_generic(
                "0 scripts ran. This means all dependencies are already trusted or none have scripts.",
                (),
            );
        } else {
            Output::err_generic(
                "0 scripts ran. The following packages are already trusted, don't have scripts to run, or don't exist:\n\n",
                (),
            );
            for arg in packages_to_trust {
                bun_core::pretty_error!(" <d>-<r> {}\n", bstr::BStr::new(arg));
            }
        }
    }

    pub(crate) fn exec(
        ctx: Command::Context,
        pm: &mut PackageManager,
        args: &[&[u8]],
    ) -> crate::Result<()> {
        bun_core::pretty_error!(
            "<r><b>bun pm trust <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        );
        Output::flush();

        if args.len() == 2 {
            Self::error_expected_args();
        }

        // Reshaped for borrowck — see `UntrustedCommand::exec`.
        // `load_lockfile` lives until `save_to_disk` near the end, so every
        // `pm`/`pm.lockfile` access in between goes through `pm_raw`.
        let pm_raw: *mut PackageManager = pm;
        let log_level = pm.options.log_level;
        let load_lockfile = pm.load_lockfile_from_cwd::<true>();
        PackageManagerCommand::handle_load_lockfile_errors(&load_lockfile, log_level);
        // `update_lockfile_if_needed` consumes `LoadResult` but we
        // need it again for `save_to_disk`; inline the body (it only flips
        // `meta.has_install_script` when `packages_need_update`).
        if matches!(&load_lockfile, LoadResult::Ok(ok) if ok.serializer_result.packages_need_update)
        {
            // SAFETY: `pm_raw` derived from `pm` above; `load_lockfile` is not
            // dereferenced concurrently. See `update_lockfile_if_needed`.
            let mut slice = unsafe { (*pm_raw).lockfile.packages.slice() };
            for meta in slice.items_meta_mut() {
                meta.set_has_install_script(false);
            }
        }

        let mut packages_to_trust: Vec<&[u8]> = Vec::with_capacity(args[2..].len());
        for arg in &args[2..] {
            if !arg.is_empty() && arg[0] != b'-' {
                packages_to_trust.push(arg);
            }
        }
        let trust_all =
            strings::left_has_any_in_right(args, &[b"-a".as_slice(), b"--all".as_slice()]);

        if !trust_all && packages_to_trust.is_empty() {
            Self::error_expected_args();
        }

        // SAFETY: `pm_raw` is the singleton; `pm.log` set at init, non-null.
        let log: *mut bun_ast::Log = unsafe { (*pm_raw).log };
        // SAFETY: `pm_raw` singleton; read-only `lockfile` borrow for the discovery phase.
        let lockfile: &Lockfile = unsafe { &*(*pm_raw).lockfile };

        let buf = lockfile.buffers.string_bytes.as_slice();
        let packages = lockfile.packages.slice();
        let resolutions: &[Resolution] = packages.items_resolution();
        let scripts: &[Scripts] = packages.items_scripts();

        let mut untrusted_dep_ids: DepIdSet = DepIdSet::new();

        debug_assert_eq!(
            lockfile.buffers.dependencies.as_slice().len(),
            lockfile.buffers.resolutions.as_slice().len()
        );
        for (i, (dep, &package_id)) in lockfile
            .buffers
            .dependencies
            .as_slice()
            .iter()
            .zip(lockfile.buffers.resolutions.as_slice())
            .enumerate()
        {
            let dep_id: u32 = u32::try_from(i).expect("int cast");
            if package_id == install::INVALID_PACKAGE_ID {
                continue;
            }

            let alias = dep.name.slice(buf);
            let pkg_name = packages.items_name()[package_id as usize].slice(buf);
            let resolution = &resolutions[package_id as usize];
            if !lockfile.has_trusted_dependency(alias, pkg_name, resolution) {
                untrusted_dep_ids.put(dep_id, ())?;
            }
        }

        if untrusted_dep_ids.count() == 0 {
            Self::print_error_zero_untrusted_dependencies_found(trust_all, &packages_to_trust);
            Global::crash();
        }

        // Instead of running them right away, we group scripts by depth in the node_modules
        // file structure, then run them starting at max depth. This ensures lifecycle scripts are run
        // in the correct order as they would during a normal install
        let mut package_names_to_add: StringArrayHashMap<()> = StringArrayHashMap::new();
        let mut scripts_at_depth: ArrayHashMap<usize, Vec<ScriptInfo>> = ArrayHashMap::new();

        let mut scripts_count: usize = 0;

        // SAFETY: `log` derived from `pm.log`; single-threaded CLI.
        let found_isolated = collect_isolated_untrusted_scripts(
            unsafe { &mut *log },
            lockfile,
            scripts,
            resolutions,
            &untrusted_dep_ids,
            |dep_id, package_id, scripts_list| {
                let dep = &lockfile.buffers.dependencies.as_slice()[dep_id as usize];
                let alias = dep.name.slice(buf);
                let resolution = &resolutions[package_id as usize];

                let skip = 'brk: {
                    if trust_all {
                        break 'brk false;
                    }
                    for package_name_from_cli in &packages_to_trust {
                        if strings::eql_long(package_name_from_cli, alias, true)
                            && !lockfile.has_trusted_dependency(
                                alias,
                                packages.items_name()[package_id as usize].slice(buf),
                                resolution,
                            )
                        {
                            break 'brk false;
                        }
                    }
                    true
                };

                let total = scripts_list.total as usize;
                let entry = scripts_at_depth.get_or_put(0usize)?;
                if !entry.found_existing {
                    *entry.value_ptr = Vec::new();
                }
                entry.value_ptr.push(ScriptInfo {
                    package_id,
                    scripts_list,
                    skip,
                });

                if !skip {
                    package_names_to_add.put(alias, ())?;
                    scripts_count += total;
                }
                Ok(())
            },
        )?;

        if !found_isolated {
            let mut tree_iter =
                tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(lockfile);

            let mut node_modules_path = AutoAbsPath::init_top_level_dir();

            while let Some(node_modules) = tree_iter.next(None) {
                let nm_saved = node_modules_path.len();
                let _ = node_modules_path.append(node_modules.relative_path.as_bytes());

                let _node_modules_dir = match bun_sys::Dir::cwd()
                    .open_at(node_modules.relative_path.as_bytes())
                    .map_err(crate::Error::from)
                {
                    Ok(d) => d,
                    Err(crate::Error::Sys(bun_errno::SystemErrno::ENOENT)) => {
                        node_modules_path.set_length(nm_saved);
                        continue;
                    }
                    Err(e) => return Err(e),
                };

                for &dep_id in node_modules.dependencies {
                    if !untrusted_dep_ids.contains(&dep_id) {
                        continue;
                    }
                    let dep = &lockfile.buffers.dependencies.as_slice()[dep_id as usize];
                    let alias = dep.name.slice(buf);
                    let package_id = lockfile.buffers.resolutions.as_slice()[dep_id as usize];

                    if package_id as usize >= packages.len() {
                        continue;
                    }

                    let resolution = &resolutions[package_id as usize];
                    let mut package_scripts = scripts[package_id as usize];

                    let folder_saved = node_modules_path.len();
                    let _ = node_modules_path.append(alias);

                    // SAFETY: `log` derived from `pm.log`; single-threaded CLI.
                    let result = package_scripts.get_list(
                        unsafe { &mut *log },
                        lockfile,
                        &mut node_modules_path,
                        alias,
                        resolution,
                    );
                    node_modules_path.set_length(folder_saved);

                    let maybe_scripts_list = match result {
                        Ok(v) => v,
                        Err(bun_install::Error::Sys(bun_errno::SystemErrno::ENOENT)) => continue,
                        Err(e) => return Err(e.into()),
                    };

                    if let Some(scripts_list) = maybe_scripts_list {
                        let skip = 'brk: {
                            if trust_all {
                                break 'brk false;
                            }

                            for package_name_from_cli in &packages_to_trust {
                                if strings::eql_long(package_name_from_cli, alias, true)
                                    && !lockfile.has_trusted_dependency(
                                        alias,
                                        packages.items_name()[package_id as usize].slice(buf),
                                        resolution,
                                    )
                                {
                                    break 'brk false;
                                }
                            }

                            true
                        };

                        let total = scripts_list.total as usize;
                        // even if it is skipped we still add to scripts_at_depth for logging later
                        let entry = scripts_at_depth.get_or_put(node_modules.depth)?;
                        if !entry.found_existing {
                            *entry.value_ptr = Vec::new();
                        }
                        entry.value_ptr.push(ScriptInfo {
                            package_id,
                            scripts_list,
                            skip,
                        });

                        if !skip {
                            package_names_to_add.put(alias, ())?;
                            scripts_count += total;
                        }
                    }
                }

                node_modules_path.set_length(nm_saved);
            }
        }

        if scripts_at_depth.count() == 0 || package_names_to_add.count() == 0 {
            Self::print_error_zero_untrusted_dependencies_found(trust_all, &packages_to_trust);
            Global::crash();
        }

        let mut scripts_node: Progress::Node;
        // SAFETY: `pm_raw` singleton; `progress` is owned inline.
        let show_progress = unsafe { (*pm_raw).options.log_level.show_progress() };

        if show_progress {
            // SAFETY: see above; `progress.start()` returns `&mut root` which is
            // immediately consumed by `Node::start` (returns an owned `Node`
            // with raw backrefs into `pm.progress`).
            unsafe {
                (*pm_raw).progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
                scripts_node = (*pm_raw)
                    .progress
                    .start(b"", 0)
                    .start(ProgressStrings::script(), scripts_count);
                (*pm_raw).scripts_node = Some(NonNull::from(&mut scripts_node));
            }
        }

        // `scripts_at_depth.values()` is taken twice (run, then
        // print). We can't move `scripts_list: List` out for
        // `spawn_package_lifecycle_scripts` and still print it later, so clone
        // the `List` per spawn.
        for entry in scripts_at_depth.values().iter().rev() {
            for info in entry.iter() {
                if info.skip {
                    continue;
                }

                // SAFETY: `pm_raw` singleton; `options` is CLI config set at init.
                let max_concurrent = unsafe { (*pm_raw).options.max_concurrent_lifecycle_scripts };
                while LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                    >= max_concurrent
                {
                    // SAFETY: `pm_raw` singleton; `options.log_level` is CLI config set at init.
                    if unsafe { (*pm_raw).options.log_level.is_verbose() }
                        && PackageManager::has_enough_time_passed_between_waiting_messages()
                    {
                        bun_core::pretty_errorln!(
                            "<d>[PackageManager]<r> waiting for {} scripts\n",
                            LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                        );
                    }

                    // SAFETY: `pm_raw` singleton.
                    unsafe { (*pm_raw).sleep() };
                }

                let output_in_foreground = false;
                let optional = false;
                // SAFETY: `pm_raw` singleton; `ctx` is the CLI `&mut ContextData`.
                unsafe {
                    (*pm_raw).spawn_package_lifecycle_scripts(
                        &mut *ctx,
                        info.scripts_list.clone(),
                        optional,
                        output_in_foreground,
                        None,
                    )?;
                }

                // SAFETY: `pm_raw` singleton; `options.log_level` is CLI config set at init.
                if unsafe { (*pm_raw).options.log_level.show_progress() } {
                    // SAFETY: `scripts_node` initialized above when
                    // `show_progress` was true at the same `log_level`.
                    if let Some(sn) = unsafe { (*pm_raw).scripts_node } {
                        // SAFETY: points at our stack-local `scripts_node`.
                        unsafe { sn.as_ptr().as_mut().unwrap().activate() };
                    }
                    // SAFETY: `pm_raw` singleton; `progress` owned inline by `pm`.
                    unsafe { (*pm_raw).progress.refresh() };
                }
            }

            // SAFETY: `pm_raw` singleton.
            while unsafe {
                (*pm_raw)
                    .pending_lifecycle_script_tasks
                    .load(Ordering::Relaxed)
            } > 0
            {
                // SAFETY: `pm_raw` singleton; `sleep()` ticks the event loop on the CLI thread.
                unsafe { (*pm_raw).sleep() };
            }
        }

        if show_progress {
            // SAFETY: `pm_raw` singleton.
            unsafe {
                (*pm_raw).progress.root.end();
                (*pm_raw).progress = Progress::Progress::default();
                (*pm_raw).scripts_node = None;
            }
        }

        // SAFETY: `pm_raw` singleton; this scope takes over the descriptor
        // (the original `pm.root_package_json_file` is replaced with INVALID so
        // its eventual drop is a no-op).
        let root_file = unsafe {
            let fd = (*pm_raw).root_package_json_file.handle;
            (*pm_raw).root_package_json_file.handle = bun_core::Fd::INVALID;
            bun_sys::File::from_fd(fd)
        };
        let package_json_contents = root_file.read_to_end().map_err(crate::Error::from)?;

        // SAFETY: `ROOT_PACKAGE_JSON_PATH` is set during `PackageManager::init`
        // (single-threaded startup) and immutable thereafter.
        let package_json_source = bun_ast::Source::init_path_string(
            unsafe { ROOT_PACKAGE_JSON_PATH.read() }.as_bytes(),
            package_json_contents.as_slice(),
        );

        let bump = Bump::new();
        // SAFETY: `ctx.log` set by `Command::init`, non-null for the command.
        // Layering: `parse_utf8` returns the T2
        // `bun_ast::Expr`; `PackageJSONEditor` and
        // `js_printer::print_json` consume the T4 `bun_ast::Expr`. Lift
        // once via `From<T2> for T4` (same as `updatePackageJSONAndInstall` /
        // `pack_command`).
        let mut package_json: bun_ast::Expr = match bun_parsers::json::parse_utf8(
            &package_json_source,
            unsafe { ctx.log_mut() },
            &bump,
        ) {
            Ok(v) => v,
            Err(err) => {
                let _ = ctx
                    .log_ref()
                    .print(std::ptr::from_mut(Output::error_writer()));

                Output::err_generic("failed to parse package.json: {s}", (err.name(),));
                Global::crash();
            }
        };

        // now add the package names to lockfile.trustedDependencies and package.json `trustedDependencies`
        debug_assert!(!package_names_to_add.keys().is_empty());

        // could be null if these are the first packages to be trusted
        // SAFETY: `pm_raw` singleton; mutates `lockfile.trusted_dependencies`.
        unsafe {
            if (*pm_raw).lockfile.trusted_dependencies.is_none() {
                (*pm_raw).lockfile.trusted_dependencies = Some(Default::default());
            }
        }

        let mut total_scripts_ran: usize = 0;
        let mut total_packages_with_scripts: usize = 0;
        let mut total_skipped_packages: usize = 0;

        Output::print(format_args!("\n"));

        // SAFETY: `pm_raw` singleton; read-only borrow for printing.
        let lockfile: &Lockfile = unsafe { &*(*pm_raw).lockfile };
        let buf = lockfile.buffers.string_bytes.as_slice();
        for entry in scripts_at_depth.values().iter().rev() {
            for info in entry.iter() {
                let resolution = &lockfile.packages.items_resolution()[info.package_id as usize];
                if info.skip {
                    info.scripts_list
                        .print_scripts(resolution, buf, PrintFormat::Untrusted);
                    total_skipped_packages += 1;
                } else {
                    total_packages_with_scripts += 1;
                    total_scripts_ran += info.scripts_list.total as usize;
                    info.scripts_list
                        .print_scripts(resolution, buf, PrintFormat::Completed);
                }
                Output::print(format_args!("\n"));
            }
        }

        PackageJSONEditor::edit_trusted_dependencies(
            &mut package_json,
            package_names_to_add.keys_mut(),
        )?;

        for name in package_names_to_add.keys() {
            // SAFETY: `pm_raw` singleton; `trusted_dependencies` set Some above.
            unsafe {
                (*pm_raw)
                    .lockfile
                    .trusted_dependencies
                    .as_mut()
                    .unwrap()
                    .put(
                        bun_semver::string::Builder::string_hash(name)
                            as install::TruncatedPackageNameHash,
                        Box::<[u8]>::from(&**name),
                    )?;
            }
        }

        // Reshaped for borrowck — `save_to_disk` needs `&mut Lockfile`
        // and `&LoadResult` simultaneously, but `LoadResultOk.lockfile` already
        // holds the only `&mut`. Same projection pattern as `migrate` in
        // `package_manager_command.rs`.
        // SAFETY: `load_lockfile` is `Ok` (errors exited in
        // `handle_load_lockfile_errors`). `save_to_disk` reads `load_result`
        // only for `save_format()` (scalar `format`/`migrated` fields).
        unsafe {
            let lf: *mut Lockfile = &raw mut *(*pm_raw).lockfile;
            (*lf).save_to_disk(&load_lockfile, &(*pm_raw).options);
        }

        let mut buffer_writer = bun_js_printer::BufferWriter::init();
        buffer_writer.buffer.list.reserve(
            (package_json_contents.len() + 1).saturating_sub(buffer_writer.buffer.list.len()),
        );
        buffer_writer.append_newline = !package_json_contents.is_empty()
            && package_json_contents[package_json_contents.len() - 1] == b'\n';
        let mut package_json_writer = bun_js_printer::BufferPrinter::init(buffer_writer);

        let _ = match bun_js_printer::print_json(
            &mut package_json_writer,
            package_json,
            &package_json_source,
            bun_js_printer::PrintJsonOptions {
                mangled_props: None,
                ..Default::default()
            },
        ) {
            Ok(n) => n,
            Err(err) => {
                Output::err_generic("failed to print package.json: {s}", (err.name(),));
                Global::crash();
            }
        };

        let new_package_json_contents = package_json_writer.ctx.written_without_trailing_zero();

        root_file
            .pwrite_all(new_package_json_contents, 0)
            .map_err(crate::Error::from)?;
        let _ = bun_sys::ftruncate(root_file.handle, new_package_json_contents.len() as i64);
        let _ = root_file.close();

        debug_assert!(total_scripts_ran > 0);

        bun_core::pretty!(
            " <green>{}<r> script{} ran across {} package{} ",
            total_scripts_ran,
            if total_scripts_ran > 1 { "s" } else { "" },
            total_packages_with_scripts,
            if total_packages_with_scripts > 1 {
                "s"
            } else {
                ""
            },
        );

        Output::print_start_end_stdout(bun_core::start_time(), bun_core::time::nano_timestamp());
        Output::print(format_args!("\n"));

        if total_skipped_packages > 0 {
            Output::print(format_args!("\n"));
            bun_core::prettyln!(
                " <yellow>{}<r> package{} with blocked scripts",
                total_skipped_packages,
                if total_skipped_packages > 1 { "s" } else { "" },
            );
        }

        Ok(())
    }
}
