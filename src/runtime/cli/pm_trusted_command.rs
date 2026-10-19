use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_alloc::Arena as Bump;
use bun_collections::{ArrayHashMap, ArrayIdentityContext, StringArrayHashMap};
use bun_core::strings;
use bun_core::{Global, Output, Progress};
use bun_install::lockfile::{
    Lockfile,
    package::PackageColumns as _,
    package::scripts::{List as ScriptsList, PrintFormat},
    tree,
};
use bun_install::package_manager_real::{
    PackageJSONEditor, ProgressStrings, ROOT_PACKAGE_JSON_PATH, package_json_write_back,
    update_lockfile_if_needed,
};
use bun_install::{
    self as install, DEFAULT_TRUSTED_DEPENDENCIES_LIST, DependencyID, LifecycleScriptSubprocess,
    PackageID, PackageManager, ResolutionTag,
};
use bun_install_types::NodeLinker::NodeLinker;
use bun_paths::AutoAbsPath;

use crate::cli::Command;

type TrustedDependenciesSet =
    ArrayHashMap<install::TruncatedPackageNameHash, Box<[u8]>, ArrayIdentityContext>;

/// Trust comes from what the package.json files say now, like for an install. Returns what the
/// lockfile had recorded.
pub(crate) fn read_trusted_dependencies(pm: &mut PackageManager) -> Option<TrustedDependenciesSet> {
    let log = pm.log_mut();
    match pm
        .lockfile
        .read_trusted_dependencies_from_manifests(&mut pm.workspace_package_json_cache, log)
    {
        Ok(recorded) => recorded,
        Err(err) => {
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            Output::err(err, "failed to read trustedDependencies", ());
            Global::crash();
        }
    }
}

const CANNOT_TRUST: &str = "cannot trust by name: add it to your package.json dependencies";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Action {
    Skip,
    Run,
    /// The package is trusted, but its scripts only run on the next install. See
    /// `Blocked::in_global_store`.
    Defer,
}

/// An installed dependency whose lifecycle scripts the installers do not run.
struct Blocked {
    dep_id: DependencyID,
    package_id: PackageID,
    /// Scripts run deepest first, like during an install.
    depth: usize,
    scripts_list: ScriptsList,
    /// Other projects share the directory, so nothing runs there until an install moves the
    /// package.
    in_global_store: bool,
    action: Action,
}

impl Blocked {
    /// The same check as in the installers: the scripts of the project and its workspaces always
    /// run, and every other package needs trust.
    fn scripts_at(
        log: &mut bun_ast::Log,
        lockfile: &Lockfile,
        dep_id: DependencyID,
        package_id: PackageID,
        folder: &mut AutoAbsPath,
    ) -> crate::Result<Option<ScriptsList>> {
        let buf = lockfile.buffers.string_bytes.as_slice();
        let packages = lockfile.packages.slice();
        let package_id = package_id as usize;
        // called alias because a dependency name is not always the package name
        let alias = lockfile.buffers.dependencies.as_slice()[dep_id as usize]
            .name
            .slice(buf);
        let resolution = &packages.items_resolution()[package_id];
        if matches!(
            resolution.tag,
            ResolutionTag::Root | ResolutionTag::Workspace
        ) || lockfile.has_trusted_dependency(
            alias,
            packages.items_name()[package_id].slice(buf),
            resolution,
        ) {
            return Ok(None);
        }

        let mut scripts = packages.items_scripts()[package_id];
        // Pass `true` to get the scripts that will run once the package is trusted.
        match scripts.get_list(log, lockfile, folder, alias, resolution, true) {
            Ok(list) => Ok(list.filter(|list| list.total > 0)),
            Err(bun_install::Error::Sys(bun_errno::SystemErrno::ENOENT)) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn find_all(pm: &mut PackageManager, linker: NodeLinker) -> crate::Result<Vec<Blocked>> {
        // If there is no `node_modules/.bun`, another tool created `node_modules`. In that case,
        // look for each package where it resolves from.
        let mut store = AutoAbsPath::init_top_level_dir();
        let _ = store.append(b"node_modules/.bun");
        if linker == NodeLinker::Isolated && bun_sys::exists(store.slice()) {
            return Self::find_in_store(pm);
        }
        // The tree saved in the lockfile also has the dependencies that packages bundle, and no
        // install runs the scripts of those. The install tree leaves them out.
        bun_install::prune::with_install_tree(pm, Self::find_in_tree)?
    }

    fn find_in_store(pm: &PackageManager) -> crate::Result<Vec<Blocked>> {
        let log = pm.log_mut();
        let lockfile: &Lockfile = &pm.lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();

        let mut blocked: Vec<Blocked> = Vec::new();
        let mut path = AutoAbsPath::init_top_level_dir();
        let top_level_len = path.len();

        let mut link_buf = bun_paths::path_buffer_pool::get();
        for folder in bun_install::isolated_install::store_folders(pm, lockfile)? {
            path.set_length(top_level_len);
            let _ = path.append(folder.entry_dir.as_slice());
            let entry_dir_len = path.len();
            let _ = path.append(b"node_modules");
            let is_link = lockfile.packages.items_resolution()[folder.pkg_id as usize].tag
                == ResolutionTag::Symlink;
            let name = if is_link {
                lockfile.buffers.dependencies.as_slice()[folder.dep_id as usize].name
            } else {
                lockfile.packages.items_name()[folder.pkg_id as usize]
            };
            let _ = path.append(name.slice(buf));
            let Some(scripts_list) =
                Self::scripts_at(log, lockfile, folder.dep_id, folder.pkg_id, &mut path)?
            else {
                continue;
            };
            path.set_length(entry_dir_len);
            blocked.push(Blocked {
                dep_id: folder.dep_id,
                package_id: folder.pkg_id,
                depth: folder.depth,
                scripts_list,
                in_global_store: !is_link
                    && bun_sys::readlink(path.slice_z(), &mut link_buf[..]).is_ok(),
                action: Action::Skip,
            });
        }
        Ok(blocked)
    }

    fn find_in_tree(pm: &PackageManager) -> crate::Result<Vec<Blocked>> {
        let log = pm.log_mut();
        let lockfile: &Lockfile = &pm.lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();
        let resolutions = lockfile.buffers.resolutions.as_slice();

        let mut blocked: Vec<Blocked> = Vec::new();
        let mut path = AutoAbsPath::init_top_level_dir();
        let top_level_len = path.len();

        let mut tree_iterator =
            tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(lockfile);
        while let Some(node_modules) = tree_iterator.next(None) {
            path.set_length(top_level_len);
            let _ = path.append(node_modules.relative_path.as_bytes());
            if !bun_sys::exists(path.slice()) {
                continue;
            }
            let node_modules_len = path.len();

            for &dep_id in node_modules.dependencies {
                let package_id = resolutions[dep_id as usize];
                if package_id as usize >= lockfile.packages.len()
                    || lockfile.is_folder_inside_declarer(dep_id)
                {
                    continue;
                }
                path.set_length(node_modules_len);
                let _ = path.append(
                    lockfile.buffers.dependencies.as_slice()[dep_id as usize]
                        .name
                        .slice(buf),
                );
                if let Some(scripts_list) =
                    Self::scripts_at(log, lockfile, dep_id, package_id, &mut path)?
                {
                    blocked.push(Blocked {
                        dep_id,
                        package_id,
                        depth: node_modules.depth,
                        scripts_list,
                        in_global_store: false,
                        action: Action::Skip,
                    });
                }
            }
        }
        Ok(blocked)
    }

    /// (dependency name, the name `trustedDependencies` knows the package by)
    fn names<'a>(&self, lockfile: &'a Lockfile) -> (&'a [u8], &'a [u8]) {
        let buf = lockfile.buffers.string_bytes.as_slice();
        let alias = lockfile.buffers.dependencies.as_slice()[self.dep_id as usize]
            .name
            .slice(buf);
        let pkg_name = lockfile.packages.items_name()[self.package_id as usize].slice(buf);
        let trusted_name = lockfile.packages.items_resolution()[self.package_id as usize]
            .trusted_name(alias, pkg_name);
        (alias, trusted_name)
    }

    /// Returns true if an install runs the package's scripts once its name is in
    /// `trustedDependencies`. `bun pm trust` doesn't run the scripts of any other package.
    fn can_trust(&self, lockfile: &Lockfile) -> bool {
        lockfile.can_trust_by_name(
            self.names(lockfile).0,
            &lockfile.packages.items_resolution()[self.package_id as usize],
        )
    }

    fn print(&self, lockfile: &Lockfile, format: PrintFormat) {
        self.scripts_list.print_scripts(
            &lockfile.packages.items_resolution()[self.package_id as usize],
            lockfile.buffers.string_bytes.as_slice(),
            format,
        );
        // `print_scripts` names the package by its folder.
        let (alias, trusted_name) = self.names(lockfile);
        if trusted_name != alias {
            bun_core::pretty!(" <d>alias of<r> {}\n", bun_core::fmt::quote(trusted_name));
        }
        if !self.can_trust(lockfile) {
            bun_core::pretty!(" <d>{}<r>\n", CANNOT_TRUST);
        }
        bun_core::pretty!("\n");
    }
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
    pub(crate) fn exec(pm: &mut PackageManager) -> crate::Result<()> {
        bun_core::pretty_error!(
            "<r><b>bun pm untrusted <r><d>v{}<r>\n\n",
            Global::package_json_version_with_sha,
        );
        Output::flush();

        // `load_lockfile` mutably borrows `pm.lockfile`, so `pm` is reached through `pm_raw` while it lives.
        let pm_raw: *mut PackageManager = pm;
        let configured_linker = pm.options.node_linker;
        let load_lockfile = pm.load_lockfile_from_cwd_or_exit::<true>("nothing to list");
        let linker = load_lockfile.node_linker(configured_linker);
        // SAFETY: `update_lockfile_if_needed` never dereferences the lockfile through `load_lockfile`.
        unsafe { update_lockfile_if_needed(&mut *pm_raw, &load_lockfile)? };

        // SAFETY: `load_lockfile` is not used past this point.
        let pm: &mut PackageManager = unsafe { &mut *pm_raw };
        read_trusted_dependencies(pm);

        let blocked = Blocked::find_all(pm, linker)?;
        if blocked.is_empty() {
            bun_core::pretty!(
                "Found <b>0<r> untrusted dependencies with scripts.\n\
                 \n\
                 This means all packages with scripts are in \"trustedDependencies\" or none of your dependencies have scripts.\n\
                 \n\
                 For more information, visit <magenta>https://bun.com/docs/install/lifecycle#trusteddependencies<r>\n"
            );
            return Ok(());
        }

        for info in &blocked {
            info.print(&pm.lockfile, PrintFormat::Untrusted);
        }

        bun_core::pretty!(
            "These dependencies had their lifecycle scripts blocked during install.\n\
             \n\
             If you trust them and wish to run their scripts, use <d>`<r><blue>bun pm {}trust<r><d>`<r>.\n",
            if pm.options.global { "-g " } else { "" },
        );

        Ok(())
    }
}

pub(crate) struct TrustCommand;

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

    fn print_aliased_args(aliased_args: &StringArrayHashMap<Box<[u8]>>) {
        if aliased_args.count() == 0 {
            return;
        }
        // The listing above went to stdout. Flush it, so that the notes come after it on a
        // terminal.
        Output::flush();
        for (alias, trusted_name) in aliased_args.keys().iter().zip(aliased_args.values()) {
            bun_core::note!(
                "{} is an alias of {}, run 'bun pm trust {}' to trust it",
                bun_core::fmt::quote(alias),
                bun_core::fmt::quote(trusted_name),
                bun_core::fmt::quote(trusted_name),
            );
        }
    }

    fn print_dry_run(
        lockfile: &Lockfile,
        blocked: &[Blocked],
        package_names_to_add: &StringArrayHashMap<()>,
    ) {
        let mut total_scripts: usize = 0;
        let mut total_packages: usize = 0;

        Output::print(format_args!("\n"));
        for info in blocked {
            if info.action != Action::Run {
                continue;
            }
            total_packages += 1;
            total_scripts += info.scripts_list.total as usize;
            info.print(lockfile, PrintFormat::Untrusted);
        }

        bun_core::prettyln!(
            "<r><d>dry run:<r> would run <b>{}<r> script{} across <b>{}<r> package{}",
            total_scripts,
            if total_scripts != 1 { "s" } else { "" },
            total_packages,
            if total_packages != 1 { "s" } else { "" },
        );
        bun_core::prettyln!("<r><d>dry run:<r> would add to trustedDependencies:");
        for name in package_names_to_add.keys() {
            bun_core::pretty!(" <d>-<r> {}\n", bun_core::fmt::escape_control_chars(name));
        }
        Output::flush();
    }

    pub(crate) fn exec(
        ctx: Command::Context,
        pm: &mut PackageManager,
        packages_to_trust: &[&[u8]],
        trust_all: bool,
    ) -> crate::Result<()> {
        bun_core::pretty_error!(
            "<r><b>bun pm trust <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        );
        Output::flush();

        if !trust_all && packages_to_trust.is_empty() {
            Self::error_expected_args();
        }

        if !pm.options.do_.run_scripts() {
            Output::err_generic(
                "lifecycle scripts are disabled (ignore-scripts), nothing to run",
                (),
            );
            Global::crash();
        }

        if pm.options.enable.frozen_lockfile() && !pm.options.dry_run {
            Output::err_generic(
                "lockfile is frozen. refusing to update package.json & lockfile",
                (),
            );
            Global::crash();
        }

        // `load_lockfile` lives until `save_to_disk`. See `UntrustedCommand::exec`.
        let pm_raw: *mut PackageManager = pm;
        let log_level = pm.options.log_level;
        let dry_run = pm.options.dry_run;
        let configured_linker = pm.options.node_linker;
        let max_concurrent = pm.options.max_concurrent_lifecycle_scripts;
        let load_lockfile = pm.load_lockfile_from_cwd_or_exit::<true>("nothing to trust");
        let linker = load_lockfile.node_linker(configured_linker);
        // SAFETY: `update_lockfile_if_needed` never dereferences the lockfile through `load_lockfile`.
        unsafe { update_lockfile_if_needed(&mut *pm_raw, &load_lockfile)? };
        // SAFETY: `pm_raw` singleton; `load_lockfile` is not dereferenced while this runs.
        let recorded = read_trusted_dependencies(unsafe { &mut *pm_raw });

        // SAFETY: `pm_raw` singleton; `load_lockfile` is not dereferenced while this runs.
        let mut blocked = Blocked::find_all(unsafe { &mut *pm_raw }, linker)?;
        bun_collections::index_sort::sort_slice_by(&mut blocked, |a, b| b.depth.cmp(&a.depth));

        // SAFETY: `pm_raw` singleton; read-only `lockfile` borrow until the scripts have run.
        let lockfile: &Lockfile = unsafe { &*(*pm_raw).lockfile };

        let mut package_names_to_add: StringArrayHashMap<()> = StringArrayHashMap::new();
        // alias given on the command line -> the name its package is trusted under
        let mut aliased_args: StringArrayHashMap<Box<[u8]>> = StringArrayHashMap::new();
        let mut undeclared_args: StringArrayHashMap<()> = StringArrayHashMap::new();
        let mut scripts_count: usize = 0;

        let named = |name: &[u8]| {
            packages_to_trust
                .iter()
                .any(|package_name_from_cli| strings::eql_long(package_name_from_cli, name, true))
        };
        for info in &mut blocked {
            let (alias, trusted_name) = info.names(lockfile);
            if !trust_all && !named(trusted_name) {
                if trusted_name != alias && named(alias) {
                    aliased_args.put(alias, Box::<[u8]>::from(trusted_name))?;
                }
                continue;
            }
            if !info.can_trust(lockfile) {
                undeclared_args.put(trusted_name, ())?;
                continue;
            }
            package_names_to_add.put(trusted_name, ())?;
            if info.in_global_store {
                info.action = Action::Defer;
            } else {
                info.action = Action::Run;
                scripts_count += info.scripts_list.total as usize;
            }
        }

        if package_names_to_add.count() == 0 {
            Self::print_error_zero_untrusted_dependencies_found(trust_all, packages_to_trust);
            Self::print_aliased_args(&aliased_args);
            for name in undeclared_args.keys() {
                bun_core::note!("{} {}", bun_core::fmt::quote(name), CANNOT_TRUST);
            }
            Global::crash();
        }

        if dry_run {
            Self::print_dry_run(lockfile, &blocked, &package_names_to_add);
            return Ok(());
        }

        // Opened before any script runs: a script whose trust cannot be recorded must not run.
        // SAFETY: `ROOT_PACKAGE_JSON_PATH` is set during `PackageManager::init` and immutable thereafter.
        let root_package_json_path = unsafe { ROOT_PACKAGE_JSON_PATH.read() };
        let (cwd, flags) = (bun_sys::Fd::cwd(), bun_sys::O::RDWR | bun_sys::O::CLOEXEC);
        let root_file = match bun_sys::File::openat(cwd, root_package_json_path, flags, 0) {
            Ok(file) => file,
            Err(err) => {
                Output::err(
                    &err,
                    "could not open \"{s}\" for writing",
                    (bstr::BStr::new(root_package_json_path.as_bytes()),),
                );
                bun_core::note!(
                    "bun pm trust adds the packages to trustedDependencies in package.json"
                );
                Global::crash();
            }
        };

        let mut scripts_node: Progress::Node;
        let show_progress = log_level.show_progress();

        if show_progress {
            // SAFETY: `pm_raw` singleton; `Node::start` returns an owned `Node` with raw backrefs into `pm.progress`.
            unsafe {
                (*pm_raw).progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
                scripts_node = (*pm_raw)
                    .progress
                    .start(b"", 0)
                    .start(ProgressStrings::script(), scripts_count);
                (*pm_raw).scripts_node = Some(NonNull::from(&mut scripts_node));
            }
        }

        for same_depth in blocked.chunk_by(|a, b| a.depth == b.depth) {
            for info in same_depth {
                if info.action != Action::Run {
                    continue;
                }

                while LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                    >= max_concurrent
                {
                    if log_level.is_verbose()
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

                if show_progress {
                    // SAFETY: `pm_raw` singleton.
                    if let Some(sn) = unsafe { (*pm_raw).scripts_node } {
                        // SAFETY: points at our stack-local `scripts_node`.
                        unsafe { sn.as_ptr().as_mut().unwrap().activate() };
                    }
                    // SAFETY: `pm_raw` singleton.
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
                // SAFETY: `pm_raw` singleton.
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

        // A migration's package.json edits must hit disk before the re-read below.
        // SAFETY: `pm_raw` singleton; `load_lockfile` only borrows the boxed lockfile.
        unsafe { package_json_write_back::write_migrated(&mut *pm_raw) };

        let package_json_contents = root_file.read_to_end().map_err(crate::Error::from)?;

        let package_json_source = bun_ast::Source::init_path_string(
            root_package_json_path.as_bytes(),
            package_json_contents.as_slice(),
        );

        let bump = Bump::new();
        // SAFETY: `ctx.log` set by `Command::init`, non-null for the command.
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

        let mut total_scripts_ran: usize = 0;
        let mut total_packages_with_scripts: usize = 0;
        let mut total_skipped_packages: usize = 0;
        let mut total_deferred_packages: usize = 0;
        // The lockfile records whose scripts have run. An install runs the scripts of any name that
        // isn't recorded.
        let mut ran = recorded.unwrap_or_default();

        Output::print(format_args!("\n"));

        for info in &blocked {
            match info.action {
                Action::Skip => total_skipped_packages += 1,
                Action::Defer => total_deferred_packages += 1,
                Action::Run => {
                    total_packages_with_scripts += 1;
                    total_scripts_ran += info.scripts_list.total as usize;
                    let (_, trusted_name) = info.names(lockfile);
                    ran.put(
                        bun_semver::string::Builder::string_hash(trusted_name)
                            as install::TruncatedPackageNameHash,
                        Box::<[u8]>::from(trusted_name),
                    )?;
                }
            }
            info.print(
                lockfile,
                if info.action == Action::Run {
                    PrintFormat::Completed
                } else {
                    PrintFormat::Untrusted
                },
            );
        }

        PackageJSONEditor::edit_trusted_dependencies(
            &mut package_json,
            package_names_to_add.keys_mut(),
        )?;

        if total_scripts_ran > 0 {
            // SAFETY: `save_to_disk` reads `load_lockfile` only for `save_format()` (scalar fields).
            unsafe {
                let lf: *mut Lockfile = &raw mut *(*pm_raw).lockfile;
                (*lf).trusted_dependencies = Some(ran);
                (*lf).save_to_disk(&load_lockfile, &(*pm_raw).options);
            }
        }

        let mut buffer_writer = bun_js_printer::BufferWriter::init();
        buffer_writer.buffer.list.reserve(
            (package_json_contents.len() + 1).saturating_sub(buffer_writer.buffer.list.len()),
        );
        buffer_writer.append_newline = !package_json_contents.is_empty()
            && package_json_contents[package_json_contents.len() - 1] == b'\n';
        let mut package_json_writer = bun_js_printer::BufferPrinter::init(buffer_writer);

        if let Err(err) = bun_js_printer::print_json(
            &mut package_json_writer,
            package_json,
            &package_json_source,
            bun_js_printer::PrintJsonOptions {
                mangled_props: None,
                ..Default::default()
            },
        ) {
            Output::err_generic("failed to print package.json: {s}", (err.name(),));
            Global::crash();
        }

        let new_package_json_contents = package_json_writer.ctx.written_without_trailing_zero();

        root_file
            .pwrite_all(new_package_json_contents, 0)
            .map_err(crate::Error::from)?;
        let _ = bun_sys::ftruncate(root_file.handle, new_package_json_contents.len() as i64);
        let _ = root_file.close();

        if total_scripts_ran > 0 {
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

            Output::print_start_end_stdout(
                bun_core::start_time(),
                bun_core::time::nano_timestamp(),
            );
            Output::print(format_args!("\n"));
        }

        if total_deferred_packages > 0 {
            if total_scripts_ran > 0 {
                Output::print(format_args!("\n"));
            }
            bun_core::prettyln!(
                " <yellow>{}<r> trusted package{} linked from the global store: run <d>`<r><blue>bun install<r><d>`<r> to run the scripts inside this project",
                total_deferred_packages,
                if total_deferred_packages > 1 { "s" } else { "" },
            );
        }

        if total_skipped_packages > 0 {
            Output::print(format_args!("\n"));
            bun_core::prettyln!(
                " <yellow>{}<r> package{} with blocked scripts",
                total_skipped_packages,
                if total_skipped_packages > 1 { "s" } else { "" },
            );
        }
        Self::print_aliased_args(&aliased_args);

        Ok(())
    }
}
