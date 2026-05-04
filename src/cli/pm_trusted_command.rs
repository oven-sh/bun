use core::sync::atomic::Ordering;

use bun_collections::ArrayHashMap;
use bun_core::{Global, Output, Progress};
use bun_install::{
    self as install, DependencyID, LifecycleScriptSubprocess, Lockfile, PackageID, PackageManager,
    Resolution,
};
use bun_logger as logger;
use bun_semver::String as SemverString;
use bun_str::{strings, ZStr};

use crate::cli::Command;
use crate::package_manager_command::PackageManagerCommand;

type DepIdSet = ArrayHashMap<DependencyID, ()>;

pub struct DefaultTrustedCommand;

impl DefaultTrustedCommand {
    pub fn exec() -> Result<(), bun_core::Error> {
        Output::print(format_args!(
            "Default trusted dependencies ({}):\n",
            Lockfile::default_trusted_dependencies_list().len()
        ));
        for name in Lockfile::default_trusted_dependencies_list() {
            Output::pretty(format_args!(" <d>-<r> {}\n", bstr::BStr::new(name)));
        }

        Ok(())
    }
}

pub struct UntrustedCommand;

impl UntrustedCommand {
    pub fn exec(
        ctx: &Command::Context,
        pm: &mut PackageManager,
        args: &[&ZStr],
    ) -> Result<(), bun_core::Error> {
        let _ = args;
        Output::pretty_error(format_args!(const_format::concatcp!(
            "<r><b>bun pm untrusted <r><d>v",
            bun_core::Global::PACKAGE_JSON_VERSION_WITH_SHA,
            "<r>\n\n"
        )));
        Output::flush();

        let load_lockfile = pm.lockfile.load_from_cwd(pm, ctx.log, true);
        PackageManagerCommand::handle_load_lockfile_errors(&load_lockfile, pm);
        pm.update_lockfile_if_needed(&load_lockfile)?;

        let packages = pm.lockfile.packages.slice();
        let scripts: &[Lockfile::Package::Scripts] = packages.items_scripts();
        let resolutions: &[Resolution] = packages.items_resolution();
        let buf = pm.lockfile.buffers.string_bytes.as_slice();

        let mut untrusted_dep_ids: ArrayHashMap<DependencyID, ()> = ArrayHashMap::default();

        // loop through dependencies and get trusted and untrusted deps with lifecycle scripts
        for (i, dep) in pm.lockfile.buffers.dependencies.as_slice().iter().enumerate() {
            let dep_id: DependencyID = DependencyID::try_from(i).unwrap();
            let package_id = pm.lockfile.buffers.resolutions.as_slice()[dep_id as usize];
            if package_id == install::INVALID_PACKAGE_ID {
                continue;
            }

            // called alias because a dependency name is not always the package name
            let alias = dep.name.slice(buf);
            let resolution = &resolutions[package_id as usize];
            if !pm.lockfile.has_trusted_dependency(alias, resolution) {
                untrusted_dep_ids.put(dep_id, ())?;
            }
        }

        if untrusted_dep_ids.count() == 0 {
            Self::print_zero_untrusted_dependencies_found();
            return Ok(());
        }

        let mut untrusted_deps: ArrayHashMap<DependencyID, Lockfile::Package::Scripts::List> =
            ArrayHashMap::default();

        let mut tree_iterator = Lockfile::Tree::Iterator::<{ Lockfile::Tree::IterKind::NodeModules }>::init(&pm.lockfile);
        // TODO(port): Lockfile.Tree.Iterator(.node_modules) const-generic enum param

        let mut node_modules_path = bun_paths::AbsPath::init_top_level_dir();
        // TODO(port): bun.AbsPath(.{ .sep = .auto }) — separator config is a comptime struct param

        while let Some(node_modules) = tree_iterator.next(None) {
            // TODO(port): AbsPath::save() should return an RAII guard whose Drop restores
            let _node_modules_path_save = node_modules_path.save();

            node_modules_path.append(node_modules.relative_path);

            for &dep_id in node_modules.dependencies {
                if untrusted_dep_ids.contains(&dep_id) {
                    let dep = &pm.lockfile.buffers.dependencies.as_slice()[dep_id as usize];
                    let alias = dep.name.slice(buf);
                    let package_id = pm.lockfile.buffers.resolutions.as_slice()[dep_id as usize];

                    if package_id as usize >= packages.len() {
                        continue;
                    }

                    let resolution = &resolutions[package_id as usize];
                    let mut package_scripts = scripts[package_id as usize];

                    let _folder_name_save = node_modules_path.save();
                    node_modules_path.append(alias);

                    let maybe_scripts_list = match package_scripts.get_list(
                        pm.log,
                        &pm.lockfile,
                        &mut node_modules_path,
                        alias,
                        resolution,
                    ) {
                        Ok(v) => v,
                        Err(e) if e == bun_core::err!("ENOENT") => continue,
                        Err(e) => return Err(e),
                    };

                    if let Some(scripts_list) = maybe_scripts_list {
                        if scripts_list.total == 0 || scripts_list.items.len() == 0 {
                            continue;
                        }
                        untrusted_deps.put(dep_id, scripts_list)?;
                    }
                }
            }
        }

        if untrusted_deps.count() == 0 {
            Self::print_zero_untrusted_dependencies_found();
            return Ok(());
        }

        let mut iter = untrusted_deps.iterator();
        while let Some(entry) = iter.next() {
            let dep_id = *entry.key_ptr;
            let scripts_list = *entry.value_ptr;
            let package_id = pm.lockfile.buffers.resolutions.as_slice()[dep_id as usize];
            let resolution = pm.lockfile.packages.items_resolution()[package_id as usize];

            scripts_list.print_scripts(&resolution, buf, Lockfile::Package::Scripts::PrintKind::Untrusted);
            Output::pretty(format_args!("\n"));
        }

        Output::pretty(format_args!(
            "These dependencies had their lifecycle scripts blocked during install.\n\
             \n\
             If you trust them and wish to run their scripts, use <d>`<r><blue>bun pm trust<r><d>`<r>.\n"
        ));

        Ok(())
    }

    fn print_zero_untrusted_dependencies_found() {
        Output::pretty(format_args!(
            "Found <b>0<r> untrusted dependencies with scripts.\n\
             \n\
             This means all packages with scripts are in \"trustedDependencies\" or none of your dependencies have scripts.\n\
             \n\
             For more information, visit <magenta>https://bun.com/docs/install/lifecycle#trusteddependencies<r>\n"
        ));
    }
}

pub struct TrustCommand;

/// Anonymous struct from Zig: value type stored in `scripts_at_depth`.
struct ScriptInfo {
    package_id: PackageID,
    scripts_list: Lockfile::Package::Scripts::List,
    skip: bool,
}

// TODO(port): Zig had `TrustCommand.Sorter` nested struct; Rust cannot nest structs in impl blocks.
// Hoisted to module level as `TrustCommandSorter` — update callers.
pub struct TrustCommandSorter;
impl TrustCommandSorter {
    pub fn less_than(_: (), rhs: &[u8], lhs: &[u8]) -> bool {
        rhs.cmp(lhs) == core::cmp::Ordering::Less
    }
}

impl TrustCommand {
    fn error_expected_args() -> ! {
        Output::err_generic(format_args!("expected package names(s) or --all"));
        Global::crash();
    }

    fn print_error_zero_untrusted_dependencies_found(trust_all: bool, packages_to_trust: &[&[u8]]) {
        Output::print(format_args!("\n"));
        if trust_all {
            Output::err_generic(format_args!(
                "0 scripts ran. This means all dependencies are already trusted or none have scripts."
            ));
        } else {
            Output::err_generic(format_args!(
                "0 scripts ran. The following packages are already trusted, don't have scripts to run, or don't exist:\n\n"
            ));
            for arg in packages_to_trust {
                Output::pretty_error(format_args!(" <d>-<r> {}\n", bstr::BStr::new(arg)));
            }
        }
    }

    pub fn exec(
        ctx: &Command::Context,
        pm: &mut PackageManager,
        args: &[&ZStr],
    ) -> Result<(), bun_core::Error> {
        Output::pretty_error(format_args!(const_format::concatcp!(
            "<r><b>bun pm trust <r><d>v",
            bun_core::Global::PACKAGE_JSON_VERSION_WITH_SHA,
            "<r>\n"
        )));
        Output::flush();

        if args.len() == 2 {
            Self::error_expected_args();
        }

        let load_lockfile = pm.lockfile.load_from_cwd(pm, ctx.log, true);
        PackageManagerCommand::handle_load_lockfile_errors(&load_lockfile, pm);
        pm.update_lockfile_if_needed(&load_lockfile)?;

        let mut packages_to_trust: Vec<&[u8]> = Vec::new();
        packages_to_trust.reserve(args[2..].len());
        for arg in &args[2..] {
            let arg = arg.as_bytes();
            if !arg.is_empty() && arg[0] != b'-' {
                packages_to_trust.push(arg);
                // PERF(port): was appendAssumeCapacity — profile in Phase B
            }
        }
        let trust_all = strings::left_has_any_in_right(
            // TODO(port): args is &[&ZStr]; left_has_any_in_right expects &[&[u8]]
            args,
            &[b"-a".as_slice(), b"--all".as_slice()],
        );

        if !trust_all && packages_to_trust.is_empty() {
            Self::error_expected_args();
        }

        let buf = pm.lockfile.buffers.string_bytes.as_slice();
        let packages = pm.lockfile.packages.slice();
        let resolutions: &[Resolution] = packages.items_resolution();
        let scripts: &[Lockfile::Package::Scripts] = packages.items_scripts();

        let mut untrusted_dep_ids: DepIdSet = DepIdSet::default();

        debug_assert_eq!(
            pm.lockfile.buffers.dependencies.as_slice().len(),
            pm.lockfile.buffers.resolutions.as_slice().len()
        );
        for (i, (dep, &package_id)) in pm
            .lockfile
            .buffers
            .dependencies
            .as_slice()
            .iter()
            .zip(pm.lockfile.buffers.resolutions.as_slice())
            .enumerate()
        {
            let dep_id: u32 = u32::try_from(i).unwrap();
            if package_id == install::INVALID_PACKAGE_ID {
                continue;
            }

            let alias = dep.name.slice(buf);
            let resolution = &resolutions[package_id as usize];
            if !pm.lockfile.has_trusted_dependency(alias, resolution) {
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
        let mut tree_iter = Lockfile::Tree::Iterator::<{ Lockfile::Tree::IterKind::NodeModules }>::init(&pm.lockfile);
        // TODO(port): Lockfile.Tree.Iterator(.node_modules) const-generic enum param

        let mut node_modules_path = bun_paths::AbsPath::init_top_level_dir();
        // TODO(port): bun.AbsPath(.{ .sep = .auto }) — separator config is a comptime struct param

        let mut package_names_to_add: ArrayHashMap<Box<[u8]>, ()> = ArrayHashMap::default();
        // TODO(port): Zig bun.StringArrayHashMapUnmanaged(void) — verify key type (owned vs borrowed)
        let mut scripts_at_depth: ArrayHashMap<usize, Vec<ScriptInfo>> = ArrayHashMap::default();

        let mut scripts_count: usize = 0;

        while let Some(node_modules) = tree_iter.next(None) {
            let _node_modules_path_save = node_modules_path.save();
            node_modules_path.append(node_modules.relative_path);

            let node_modules_dir = match bun_sys::open_dir(bun_sys::Fd::cwd(), node_modules.relative_path) {
                Ok(d) => d,
                Err(e) if e == bun_core::err!("ENOENT") => continue,
                Err(e) => return Err(e.into()),
            };
            // TODO(port): bun_sys::Dir must impl Drop (close fd); bun.openDir returns std.fs.Dir in Zig
            let _ = &node_modules_dir;

            for &dep_id in node_modules.dependencies {
                if untrusted_dep_ids.contains(&dep_id) {
                    let dep = &pm.lockfile.buffers.dependencies.as_slice()[dep_id as usize];
                    let alias = dep.name.slice(buf);
                    let package_id = pm.lockfile.buffers.resolutions.as_slice()[dep_id as usize];

                    if package_id as usize >= packages.len() {
                        continue;
                    }

                    let resolution = &resolutions[package_id as usize];
                    let mut package_scripts = scripts[package_id as usize];

                    let _folder_save = node_modules_path.save();
                    node_modules_path.append(alias);

                    let maybe_scripts_list = match package_scripts.get_list(
                        pm.log,
                        &pm.lockfile,
                        &mut node_modules_path,
                        alias,
                        resolution,
                    ) {
                        Ok(v) => v,
                        Err(e) if e == bun_core::err!("ENOENT") => continue,
                        Err(e) => return Err(e),
                    };

                    if let Some(scripts_list) = maybe_scripts_list {
                        let skip = 'brk: {
                            if trust_all {
                                break 'brk false;
                            }

                            for package_name_from_cli in &packages_to_trust {
                                if strings::eql_long(package_name_from_cli, alias, true)
                                    && !pm.lockfile.has_trusted_dependency(alias, resolution)
                                {
                                    break 'brk false;
                                }
                            }

                            break 'brk true;
                        };

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
                            package_names_to_add.put(Box::<[u8]>::from(alias), ())?;
                            scripts_count += scripts_list.total;
                        }
                    }
                }
            }
        }

        if scripts_at_depth.count() == 0 || package_names_to_add.count() == 0 {
            Self::print_error_zero_untrusted_dependencies_found(trust_all, &packages_to_trust);
            Global::crash();
        }

        let mut root_node: Option<&mut Progress::Node> = None;
        let mut scripts_node: Option<Progress::Node> = None;
        // PORT NOTE: reshaped for borrowck — Zig used `undefined` locals initialized inside the branch
        let progress = &mut pm.progress;

        if pm.options.log_level.show_progress() {
            progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
            let rn = progress.start("", 0);

            let sn = rn.start(PackageManager::ProgressStrings::script(), scripts_count);
            // SAFETY: scripts_node lives for the rest of this function; pm.scripts_node is a
            // backref pointer cleared before fn returns (matches Zig storing &stack_local).
            // TODO(port): lifetime — pm.scripts_node stores raw ptr to stack local
            scripts_node = Some(sn);
            root_node = Some(rn);
            pm.scripts_node = scripts_node.as_mut().map(|n| n as *mut _).unwrap_or(core::ptr::null_mut());
        }

        {
            for entry in scripts_at_depth.values().iter().rev() {
                for info in entry.as_slice() {
                    if info.skip {
                        continue;
                    }

                    while LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                        >= pm.options.max_concurrent_lifecycle_scripts
                    {
                        if pm.options.log_level.is_verbose() {
                            if PackageManager::has_enough_time_passed_between_waiting_messages() {
                                Output::pretty_errorln(format_args!(
                                    "<d>[PackageManager]<r> waiting for {} scripts\n",
                                    LifecycleScriptSubprocess::alive_count().load(Ordering::Relaxed)
                                ));
                            }
                        }

                        pm.sleep();
                    }

                    let output_in_foreground = false;
                    let optional = false;
                    pm.spawn_package_lifecycle_scripts(
                        ctx,
                        info.scripts_list,
                        optional,
                        output_in_foreground,
                        None,
                    )?;

                    if pm.options.log_level.show_progress() {
                        if let Some(sn) = scripts_node.as_mut() {
                            sn.activate();
                        }
                        progress.refresh();
                    }
                }

                while pm.pending_lifecycle_script_tasks.load(Ordering::Relaxed) > 0 {
                    pm.sleep();
                }
            }
        }

        if pm.options.log_level.show_progress() {
            progress.root.end();
            *progress = Progress::default();
        }

        let package_json_contents = pm
            .root_package_json_file
            .read_to_end_alloc(pm.root_package_json_file.get_end_pos()?)?;
        // TODO(port): readToEndAlloc/getEndPos signatures — verify bun_sys::File API

        let package_json_source =
            logger::Source::init_path_string(PackageManager::ROOT_PACKAGE_JSON_PATH, &package_json_contents);

        let mut package_json = match bun_json::parse_utf8(&package_json_source, ctx.log) {
            // TODO(port): bun.json.parseUTF8 crate path — likely bun_interchange::json
            Ok(v) => v,
            Err(err) => {
                let _ = ctx.log.print(Output::error_writer());

                Output::err_generic(format_args!("failed to parse package.json: {}", err.name()));
                Global::crash();
            }
        };

        // now add the package names to lockfile.trustedDependencies and package.json `trustedDependencies`
        let names = package_names_to_add.keys();
        #[cfg(debug_assertions)]
        {
            debug_assert!(!names.is_empty());
        }

        // could be null if these are the first packages to be trusted
        if pm.lockfile.trusted_dependencies.is_none() {
            pm.lockfile.trusted_dependencies = Some(Default::default());
        }

        let mut total_scripts_ran: usize = 0;
        let mut total_packages_with_scripts: usize = 0;
        let mut total_skipped_packages: usize = 0;

        Output::print(format_args!("\n"));

        {
            for entry in scripts_at_depth.values().iter().rev() {
                for info in entry.as_slice() {
                    let resolution = pm.lockfile.packages.items_resolution()[info.package_id as usize];
                    if info.skip {
                        info.scripts_list.print_scripts(
                            &resolution,
                            buf,
                            Lockfile::Package::Scripts::PrintKind::Untrusted,
                        );
                        total_skipped_packages += 1;
                    } else {
                        total_packages_with_scripts += 1;
                        total_scripts_ran += info.scripts_list.total;
                        info.scripts_list.print_scripts(
                            &resolution,
                            buf,
                            Lockfile::Package::Scripts::PrintKind::Completed,
                        );
                    }
                    Output::print(format_args!("\n"));
                }
            }
        }

        install::PackageManager::PackageJSONEditor::edit_trusted_dependencies(&mut package_json, names)?;

        for name in names {
            pm.lockfile
                .trusted_dependencies
                .as_mut()
                .unwrap()
                .put(SemverString::Builder::string_hash(name) as u32, ())?;
            // TODO(port): @truncate target width — assumed u32 (TruncatedPackageNameHash)
        }

        pm.lockfile.save_to_disk(&load_lockfile, &pm.options);

        let mut buffer_writer = bun_js_printer::BufferWriter::init();
        buffer_writer
            .buffer
            .list
            .reserve((package_json_contents.len() + 1).saturating_sub(buffer_writer.buffer.list.len()));
        buffer_writer.append_newline = !package_json_contents.is_empty()
            && package_json_contents[package_json_contents.len() - 1] == b'\n';
        let mut package_json_writer = bun_js_printer::BufferPrinter::init(buffer_writer);

        let _ = match bun_js_printer::print_json(
            &mut package_json_writer,
            &package_json,
            &package_json_source,
            bun_js_printer::PrintJsonOptions { mangled_props: None },
        ) {
            // TODO(port): printJSON options struct shape
            Ok(n) => n,
            Err(err) => {
                Output::err_generic(format_args!("failed to print package.json: {}", err.name()));
                Global::crash();
            }
        };

        let new_package_json_contents = package_json_writer.ctx.written_without_trailing_zero();

        pm.root_package_json_file.pwrite_all(new_package_json_contents, 0)?;
        let _ = bun_sys::ftruncate(
            pm.root_package_json_file.handle,
            new_package_json_contents.len() as u64,
        );
        pm.root_package_json_file.close();

        #[cfg(debug_assertions)]
        {
            debug_assert!(total_scripts_ran > 0);
        }

        Output::pretty(format_args!(
            " <green>{}<r> script{} ran across {} package{} ",
            total_scripts_ran,
            if total_scripts_ran > 1 { "s" } else { "" },
            total_packages_with_scripts,
            if total_packages_with_scripts > 1 { "s" } else { "" },
        ));

        Output::print_start_end_stdout(bun_core::start_time(), bun_core::time::nano_timestamp());
        // TODO(port): std.time.nanoTimestamp() mapping
        Output::print(format_args!("\n"));

        if total_skipped_packages > 0 {
            Output::print(format_args!("\n"));
            Output::prettyln(format_args!(
                " <yellow>{}<r> package{} with blocked scripts",
                total_skipped_packages,
                if total_skipped_packages > 1 { "s" } else { "" },
            ));
        }

        let _ = root_node; // suppress unused warning when progress is disabled
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/pm_trusted_command.zig (464 lines)
//   confidence: medium
//   todos:      14
//   notes:      AbsPath::save() assumed RAII (Drop restores); bun_sys::Dir assumed Drop closes fd; pm.scripts_node stores ptr to stack local; Lockfile::Tree::Iterator const-generic enum & MultiArrayList .items(.field) accessors guessed; bun.json/js_printer crate paths uncertain
// ──────────────────────────────────────────────────────────────────────────
