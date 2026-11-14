use core::cmp::Ordering;
use std::io::Write as _;

use bun_collections::DynamicBitSet;
use bun_core::fmt::PathSep;
use bun_core::strings;
use bun_core::{Global, Output, env_var, fmt as bun_fmt};
use bun_install::lockfile::{LoadResult, Lockfile, package::PackageColumns as _, reachable, tree};
use bun_install::npm as Npm;
use bun_install::package_manager_real::{
    CommandLineArguments, Subcommand, fetch_cache_directory_path, get_cache_directory,
    package_json_write_back, package_manager_options::LogLevel, setup_global_dir,
};
use bun_install::{DependencyID, PackageID, PackageManager, ResolutionTag, migration};
use bun_paths::{self as Path, AutoAbsPath};
use bun_resolver::fs as Fs;
use bun_sys::{self, Dir, Fd, File};

use crate::cli::Command;
use crate::cli::pm_cache_prune_command::{DEFAULT_MAX_AGE_DAYS, PmCachePruneCommand};
use crate::cli::pm_diff_command as PmDiffCommand;
use crate::cli::pm_licenses_command::{BunStore, LicensesFlags, PmLicensesCommand};
use crate::cli::pm_pkg_command::PmPkgCommand;
use crate::cli::pm_trusted_command::{
    DefaultTrustedCommand, TrustCommand, UntrustedCommand, read_trusted_dependencies,
};
use crate::cli::pm_version_command::PmVersionCommand;
use crate::cli::pm_view_command as PmViewCommand;
use crate::cli::why_command::WhyCommand;
use bun_collections::index_sort;

pub(crate) use crate::cli::pack_command::PackCommand;
pub(crate) use crate::cli::scan_command::ScanCommand;

// An owned `tree::IteratorNext`, which borrows the iterator's path buffer.
struct NodeModulesFolder {
    relative_path: Box<[u8]>,
    dependencies: Box<[DependencyID]>,
}

/// `bun pm ls` lists what's on disk. The lockfile also has optional dependencies that were never
/// installed, and pruned entries.
struct InstalledFilter {
    path: AutoAbsPath,
    top_len: usize,
    store: BunStore,
}

impl InstalledFilter {
    /// `None` when there is no `node_modules`.
    fn init() -> Option<Self> {
        let mut path = AutoAbsPath::init_top_level_dir();
        let top_len = path.len();
        let _ = path.append(b"node_modules");
        let store = BunStore::init();
        bun_sys::exists(path.slice()).then(|| Self {
            path,
            top_len,
            store,
        })
    }

    /// `or_in_store`: an isolated install only links direct dependencies into a `node_modules`, so
    /// an entry of the (hoisted) tree may only be in `node_modules/.bun`. A dependency of the root
    /// has to be linked, because the root has to be able to load it.
    fn is_installed(
        &mut self,
        lockfile: &Lockfile,
        dir: &[u8],
        dep_id: DependencyID,
        or_in_store: bool,
    ) -> bool {
        let package_id = lockfile.buffers.resolutions.as_slice()[dep_id as usize] as usize;
        if package_id >= lockfile.packages.len() {
            return false;
        }
        let slice = lockfile.packages.slice();
        let name = slice.items_name()[package_id];
        let resolution = &slice.items_resolution()[package_id];
        let buf = lockfile.buffers.string_bytes.as_slice();
        // Local sources live outside of node_modules.
        match resolution.tag {
            ResolutionTag::Root | ResolutionTag::Symlink => return true,
            // A pruned checkout (`turbo prune`, a Docker layer) is missing some of the lockfile's
            // workspaces.
            ResolutionTag::Workspace => {
                // `join` resolves a `..` in the workspace's path, which `append` does not. Windows
                // treats a `..` that is left in an absolute path as a literal name.
                let mut member = AutoAbsPath::init_top_level_dir();
                let _ = member.join(&[resolution.workspace().slice(buf)]);
                return bun_sys::exists(member.slice());
            }
            _ => {}
        }

        let alias = lockfile.buffers.dependencies.as_slice()[dep_id as usize]
            .name
            .slice(buf);
        self.path.set_length(self.top_len);
        let _ = self.path.append(dir);
        let _ = self.path.append(alias);
        bun_sys::exists(self.path.slice())
            || (or_in_store
                && self
                    .store
                    .lookup(&mut self.path, self.top_len, name, resolution, buf)
                    .is_some())
    }
}

fn cmp_dependency_names(lockfile: &Lockfile, lhs: DependencyID, rhs: DependencyID) -> Ordering {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    dependencies[lhs as usize]
        .name
        .slice(buf)
        .cmp(dependencies[rhs as usize].name.slice(buf))
}

fn cwd_or_exit(buf: &mut bun_paths::PathBuffer) -> &[u8] {
    match bun_sys::getcwd(&mut buf[..]) {
        Ok(len) => &buf[..len],
        Err(_) => {
            bun_core::pretty_errorln!("<r><red>error<r>: Could not get current working directory");
            Global::exit(1);
        }
    }
}

pub(crate) struct PackageManagerCommand;

impl PackageManagerCommand {
    pub(crate) fn handle_load_lockfile_errors_for(
        load_lockfile: &LoadResult,
        log_level: LogLevel,
        nothing_to: &str,
    ) {
        let not_silent = log_level != LogLevel::Silent;

        match load_lockfile {
            LoadResult::NotFound => {
                if not_silent {
                    if nothing_to.is_empty() {
                        Output::err_generic("missing lockfile", ());
                    } else {
                        Output::err_generic("missing lockfile, nothing to {s}", (nothing_to,));
                    }
                    bun_core::note!("run 'bun install' first");
                }
                Global::exit(1);
            }
            LoadResult::Err(err) => {
                if not_silent && !migration::reported_unsupported_lockfile_version(err) {
                    Output::err_generic(
                        "failed to {s} lockfile: {s}",
                        (err.step.verb(), err.value.name()),
                    );
                }
                Global::exit(1);
            }
            LoadResult::Ok(_) => {}
        }
    }

    #[cold]
    pub(crate) fn print_hash(log: &mut bun_ast::Log, file: &File) -> crate::Result<()> {
        let bytes = match file.read_to_end() {
            Ok(bytes) => bytes,
            Err(err) => {
                Output::err(crate::Error::from(err), "failed to read lockfile", ());
                Global::crash();
            }
        };

        let mut lockfile = Box::<Lockfile>::default();
        let load_lockfile = lockfile.load_from_bytes(None, bytes, log);
        Self::handle_load_lockfile_errors_for(&load_lockfile, LogLevel::Default, "hash");

        Output::flush();
        Output::disable_buffering();
        Output::writer().print(format_args!("{}", lockfile.fmt_meta_hash()))?;
        Output::enable_buffering();
        Global::exit(0);
    }

    fn crash_getting_cache_directory(err: bun_sys::Error) -> ! {
        bun_core::pretty_errorln!("{} getting cache directory", crate::Error::from(err).name(),);
        Global::crash();
    }

    /// Returns what `bun pm cache rm` must not delete, if `dir` (a real path) is or contains it.
    fn protected_in(dir: &[u8], bun_install: Option<&[u8]>, cwd: &[u8]) -> Option<&'static str> {
        let protected: [(&'static str, Option<&[u8]>); 5] = [
            ("the home directory", env_var::HOME.get_not_empty()),
            (
                "the bun executable",
                bun_core::self_exe_path().ok().map(|exe| exe.as_bytes()),
            ),
            ("$BUN_INSTALL", bun_install),
            (
                "the project directory",
                Some(Fs::FileSystem::get().top_level_dir()),
            ),
            ("the current directory", Some(cwd)),
        ];
        let mut buf = bun_paths::path_buffer_pool::get();
        for (what, path) in protected {
            let Some(path) = path else { continue };
            // Compare real paths on both sides, so that a symlink to `$HOME` compares equal to
            // `$HOME`.
            let real: &[u8] = match Dir::open(path) {
                Ok(opened) => match opened.get_fd_path(&mut buf) {
                    Ok(real) => &real[..],
                    Err(_) => path,
                },
                Err(_) => path,
            };
            if !matches!(
                Path::resolve_path::is_parent_or_equal(dir, real),
                Path::resolve_path::ParentEqual::Unrelated
            ) {
                return Some(what);
            }
        }
        None
    }

    fn get_subcommand(args_ptr: &mut &'static [&'static [u8]]) -> &'static [u8] {
        let mut subcommand: &[u8] = args_ptr.first().copied().unwrap_or(b"");

        if strings::eql_comptime(subcommand, b"pm") {
            subcommand = b"";
            if args_ptr.len() > 1 {
                *args_ptr = &args_ptr[1..];
                return args_ptr[0];
            }
        }

        subcommand
    }

    pub(crate) fn exec(ctx: Command::Context) -> crate::Result<()> {
        // "bun whoami" instead of "bun pm whoami"
        let is_direct_whoami = bun_core::argv()
            .get(1)
            .is_some_and(|arg| strings::eql_comptime(arg.as_bytes(), b"whoami"));

        let cli = CommandLineArguments::parse(Subcommand::Pm)?;
        let licenses_flags = LicensesFlags {
            dev_only: cli.dev_only,
            long: cli.long,
        };
        let diff_flags = PmDiffCommand::DiffFlags {
            raw: cli.diff_raw,
            json: cli.json_output,
            unminify: cli.diff_unminify,
            minify: cli.diff_minify,
            ignore_space: cli.diff_ignore_space,
            name_only: cli.diff_name_only,
            stat: cli.diff_stat,
            context: cli.diff_context.unwrap_or(3),
        };
        let cache_max_age_days = cli.cache_max_age_days.unwrap_or(DEFAULT_MAX_AGE_DAYS);
        let (pm, cwd) = match PackageManager::init(&mut *ctx, &cli, Subcommand::Pm) {
            Ok(v) => v,
            Err(err) => {
                if err == bun_install::Error::MissingPackageJSON {
                    let mut cwd_buf = bun_paths::path_buffer_pool::get();
                    match bun_sys::getcwd(&mut cwd_buf[..]) {
                        Ok(len) => {
                            Output::err_generic(
                                "No package.json was found for directory \"{s}\"",
                                (bstr::BStr::new(&cwd_buf[..len]),),
                            );
                        }
                        Err(_) => {
                            Output::err_generic("No package.json was found", ());
                        }
                    }
                    bun_core::note!("Run \"bun init\" to initialize a project");
                    Global::exit(1);
                }
                return Err(err.into());
            }
        };

        let mut subcommand: &[u8] = if is_direct_whoami {
            b"whoami"
        } else {
            // Drops a leading "pm" from the field, because the branches below index
            // `positionals[1]` and up.
            Self::get_subcommand(&mut pm.options.positionals)
        };
        let positionals: &'static [&'static [u8]] = pm.options.positionals;

        // "bun list" and "bun pm list"
        if strings::eql_comptime(subcommand, b"list") {
            subcommand = b"ls";
        }

        if pm.options.global {
            setup_global_dir(pm, &&mut *ctx)?;
        }

        if strings::eql_comptime(subcommand, b"scan") {
            ScanCommand::exec_with_manager(&mut *ctx, pm, &cwd)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"pack") {
            PackCommand::exec_with_manager(ctx, pm, &cwd)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"whoami") {
            let username = match Npm::whoami(pm) {
                Ok(u) => u,
                Err(err) => {
                    match err {
                        Npm::WhoamiError::OutOfMemory => bun_core::out_of_memory(),
                        Npm::WhoamiError::NeedAuth => {
                            Output::err_generic(
                                "missing authentication (run <cyan>`bunx npm login`<r>)",
                                (),
                            );
                        }
                        Npm::WhoamiError::ProbablyInvalidAuth => {
                            Output::err_generic(
                                "failed to authenticate with registry '{f}'",
                                (bun_fmt::redacted_npm_url(pm.options.scope.url.href()),),
                            );
                        }
                    }
                    Global::crash();
                }
            };
            Output::println(format_args!("{}", bun_fmt::escape_control_chars(&username)));
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"view") {
            let spec: &[u8] = positionals.get(1).copied().unwrap_or(b"");
            let fields: &[&[u8]] = positionals.get(2..).unwrap_or(&[]);
            let json_output = pm.options.json_output;
            PmViewCommand::view(pm, spec, fields, json_output)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"bin") {
            let output_path = Path::resolve_path::join_abs::<Path::platform::Auto>(
                Fs::FileSystem::get().top_level_dir(),
                pm.options.bin_path.as_bytes(),
            );
            bun_core::prettyln!("{}", bstr::BStr::new(output_path));
            if Output::stdout_descriptor_type() == Output::OutputStreamDescriptor::Terminal {
                bun_core::prettyln!("\n");
            }

            if pm.options.global
                && Output::enable_ansi_colors_stderr()
                && let Some(path) = env_var::PATH.get()
            {
                let bin_dir = strings::without_trailing_slash(output_path);
                let in_path = path
                    .split(|b| *b == bun_paths::DELIMITER)
                    .filter(|s| !s.is_empty())
                    .map(strings::without_trailing_slash)
                    .any(|entry| {
                        if cfg!(windows) {
                            strings::eql_case_insensitive_ascii(entry, bin_dir, true)
                        } else {
                            strings::eql(entry, bin_dir)
                        }
                    });
                if !in_path {
                    bun_core::pretty_errorln!("\n<r><yellow>warn<r>: not in $PATH\n");
                }
            }

            Output::flush();
            return Ok(());
        } else if matches!(subcommand, b"hash" | b"hash-print" | b"hash-string") {
            let log_level = pm.options.log_level;
            let load_lockfile = pm.load_lockfile_from_cwd::<true>();
            Self::handle_load_lockfile_errors_for(&load_lockfile, log_level, "hash");

            let print_string = strings::eql_comptime(subcommand, b"hash-string");
            if !strings::eql_comptime(subcommand, b"hash-print") {
                let _ = pm
                    .lockfile
                    .has_meta_hash_changed(print_string, pm.lockfile.packages.len())?;
            }
            if !print_string {
                Output::flush();
                Output::disable_buffering();
                Output::writer().print(format_args!("{}", pm.lockfile.fmt_meta_hash()))?;
                Output::enable_buffering();
            }
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"cache") {
            let action: &[u8] = positionals.get(1).copied().unwrap_or(b"");
            if matches!(action, b"pack" | b"unpack") {
                if strings::eql_comptime(action, b"pack") {
                    let log_level = pm.options.log_level;
                    let load_lockfile = pm.load_lockfile_from_cwd::<true>();
                    Self::handle_load_lockfile_errors_for(&load_lockfile, log_level, "pack");
                }
                bun_install::cache_pack::exec(pm, &cwd);
            }

            let deletes = matches!(action, b"rm" | b"prune");
            // `rm` and `prune` always act on the whole cache, so an extra argument is an error.
            // Otherwise `rm <package>` would clear everything.
            if let Some(&word) = positionals.get(if deletes { 2 } else { 1 }) {
                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> unexpected argument \"{}\"\n<d>usage:<r> bun pm cache [rm | prune | pack \\<file\\> | unpack \\<file\\>]",
                    bun_fmt::escape_control_chars(word),
                );
                Global::exit(1);
            }

            if deletes {
                let prune = strings::eql_comptime(action, b"prune");
                let mut had_err = false;
                let dry_run = pm.options.dry_run;

                // Not `pm.options`: a project's `.env`, bunfig.toml or `.npmrc` does not choose what is deleted.
                // `~/.bunfig.toml` is honored because a project can't write to it. `~/.npmrc`
                // isn't, because its `cache` setting is npm's cache, which Bun shouldn't delete.
                let mut process_env = bun_dotenv::Loader::init();
                process_env.load_process()?;
                let user_cache_dir = match cli.cache_dir {
                    Some(_) => None,
                    None => (bun_bunfig::arguments::load_user_install_section().ok())
                        .flatten()
                        .and_then(|install| install.cache_directory),
                };
                let configured = cli.cache_dir.or(user_cache_dir.as_deref());
                let cache_dir = match fetch_cache_directory_path(&mut process_env, configured) {
                    Ok(cache_dir) => cache_dir,
                    Err(err) => Self::crash_getting_cache_directory(err),
                };
                let mut rm_buf = bun_paths::path_buffer_pool::get();
                let rm_dir: Option<Dir> = match Dir::open(&cache_dir.path) {
                    Ok(rm_dir) => Some(rm_dir),
                    Err(err) if err.get_errno() == bun_sys::E::ENOENT => None,
                    Err(err) => Self::crash_getting_cache_directory(err),
                };
                // The real path, and whether it contains the global store. `None` if the directory
                // doesn't exist.
                let found: Option<(&[u8], bool)> = match &rm_dir {
                    Some(rm_dir) => {
                        let has_global_store =
                            bun_sys::directory_exists_at(rm_dir.fd(), bun_core::zstr!("links"))
                                .unwrap_or(false);
                        match rm_dir.get_fd_path(&mut rm_buf) {
                            Ok(p) => Some((&p[..], has_global_store)),
                            Err(err) => Self::crash_getting_cache_directory(err),
                        }
                    }
                    None => None,
                };
                let (rm_path, has_global_store) =
                    found.unwrap_or((cache_dir.path.as_slice(), false));
                let bun_install = process_env.get(b"BUN_INSTALL").map(|path| {
                    bun_options_types::schema::api::BunInstall::resolve_path(b"", path)
                });
                let protected = found
                    .and_then(|(real, _)| Self::protected_in(real, bun_install.as_deref(), &cwd));
                // The packages that bunx installed are inside the install cache, so count them
                // before it's deleted.
                let mut deleted: usize = match protected {
                    None if !prune => crate::cli::bunx_command::count_cached_packages(rm_path),
                    _ => 0,
                };

                if let Some(what) = protected {
                    Output::err_generic(
                        "refusing to {s} \"{s}\": is or contains {s}",
                        (
                            if prune { "prune" } else { "clear" },
                            bstr::BStr::new(rm_path),
                            what,
                        ),
                    );
                    bun_core::note!(
                        "cache directory comes from <b>$BUN_INSTALL_CACHE_DIR<r>, <b>--cache-dir<r>, <b>~/.bunfig.toml<r> or <b>$BUN_INSTALL<r>. point it at a directory used only for the bun install cache"
                    );
                    had_err = true;
                } else if prune {
                    had_err = PmCachePruneCommand::exec(rm_path, cache_max_age_days, dry_run);
                } else {
                    // Only the directory's contents are deleted. The directory itself may be a
                    // mount point, the target of a symlink, or inside a read-only parent.
                    if dry_run {
                        bun_core::prettyln!(
                            "<r><d>dry run:<r> would delete 'bun install' cache at {}",
                            bstr::BStr::new(rm_path),
                        );
                    } else if let Some(rm_dir) = &rm_dir
                        && let Err(err) = rm_dir.delete_children()
                    {
                        Output::err(err, "Could not delete {s}", (bstr::BStr::new(rm_path),));
                        had_err = true;
                    } else {
                        bun_core::prettyln!("Cleared 'bun install' cache");
                    }
                    // A store that is a volume of its own stays: no delete goes into a mount.
                    let store_stays = !dry_run
                        && rm_dir.as_ref().is_some_and(|dir| {
                            bun_sys::directory_exists_at(dir.fd(), bun_core::zstr!("links"))
                                .unwrap_or(true)
                        });
                    if has_global_store && !store_stays {
                        bun_core::note!(
                            "global store {} removed too, run 'bun install' in each project that uses it",
                            if dry_run { "would be" } else { "was" },
                        );
                    }
                }

                'bunx: {
                    if prune {
                        break 'bunx;
                    }
                    let tmp = Fs::RealFS::platform_temp_dir();
                    let tmp_dir = match Dir::open(tmp) {
                        Ok(d) => d,
                        Err(err) => {
                            Output::err(
                                crate::Error::from(err),
                                "Could not open {s}",
                                (bstr::BStr::new(tmp),),
                            );
                            had_err = true;
                            break 'bunx;
                        }
                    };
                    let mut iter = bun_sys::iterate_dir(tmp_dir.fd());

                    // `.bunx-<uid>` for all packages, or (Windows, older versions) `bunx-<uid>-<package>`.
                    let bunx_root_name = crate::cli::bunx_command::cache_root_name();
                    let prefix = [&bunx_root_name[1..], &b"-"[..]].concat();
                    loop {
                        let entry = match iter.next() {
                            Ok(Some(e)) => e,
                            Ok(None) => break,
                            Err(err) => {
                                Output::err(
                                    crate::Error::from(err),
                                    "Could not read {s}",
                                    (bstr::BStr::new(tmp),),
                                );
                                had_err = true;
                                break 'bunx;
                            }
                        };
                        let name = entry.name.slice_u8();
                        let is_bunx_root = name == bunx_root_name.as_slice();
                        if is_bunx_root || name.starts_with(prefix.as_slice()) {
                            let packages = if is_bunx_root {
                                crate::cli::bunx_command::count_cached_packages(tmp)
                            } else {
                                1
                            };
                            if dry_run {
                                bun_core::prettyln!(
                                    "<r><d>dry run:<r> would delete {}{}{}",
                                    bstr::BStr::new(strings::without_trailing_slash(tmp)),
                                    bun_paths::SEP_STR,
                                    bun_fmt::escape_control_chars(name),
                                );
                            } else if let Err(err) = tmp_dir.delete_tree(name) {
                                Output::err(err, "Could not delete {s}", (bstr::BStr::new(name),));
                                had_err = true;
                                continue;
                            }

                            deleted += packages;
                        }
                    }

                    bun_core::prettyln!(
                        "{} {} cached 'bunx' packages",
                        if dry_run { "Would clear" } else { "Cleared" },
                        deleted
                    );
                }

                Global::exit(if had_err { 1 } else { 0 });
            }

            let mut dir = bun_paths::path_buffer_pool::get();
            let fd = get_cache_directory(pm);
            let outpath = match bun_sys::get_fd_path(fd, &mut dir) {
                Ok(p) => &p[..],
                Err(err) => Self::crash_getting_cache_directory(err),
            };
            let _ = Output::writer().write_all(outpath);
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"default-trusted") {
            DefaultTrustedCommand::exec()?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"untrusted") {
            UntrustedCommand::exec(pm)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"trust") {
            TrustCommand::exec(&mut *ctx, pm, positionals.get(1..).unwrap_or(&[]), cli.all)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"ls") {
            let log_level = pm.options.log_level;
            let global = pm.options.global;
            let features = pm.options.local_package_features;
            if pm.options.depth.is_some_and(|depth| depth != 0) {
                Output::err_generic(
                    "bun pm ls --depth only accepts 0 (direct dependencies, the default). --all lists every installed package",
                    (),
                );
                Global::exit(1);
            }
            let names: &[&[u8]] = positionals.get(1..).unwrap_or(&[]);
            // As in `npm ls`, a package name is searched for among all installed packages, and
            // `--depth` takes precedence over `--all`.
            let all = pm.options.depth.is_none() && (!names.is_empty() || cli.all);
            let load_lockfile = pm.load_lockfile_from_cwd::<true>();
            // Before the first `bun add -g`, and after the last package was removed.
            if global && matches!(load_lockfile, LoadResult::NotFound) {
                Output::println(format_args!(
                    "{} node_modules{}",
                    bstr::BStr::new(strings::without_trailing_slash(
                        Fs::FileSystem::get().top_level_dir()
                    )),
                    if all { "" } else { " (0 installed)" },
                ));
                Global::exit(0);
            }
            Self::handle_load_lockfile_errors_for(&load_lockfile, log_level, "list");
            let trusted_only = cli.trusted_only;
            if trusted_only {
                read_trusted_dependencies(pm);
            }

            Output::flush();
            Output::disable_buffering();
            let lockfile: &Lockfile = &pm.lockfile;

            // If there's no `node_modules`, list every dependency that the lockfile resolved.
            let mut on_disk = InstalledFilter::init();
            let mut is_installed =
                |dir: &[u8], dep_id: DependencyID, or_in_store: bool| match on_disk.as_mut() {
                    Some(on_disk) => on_disk.is_installed(lockfile, dir, dep_id, or_in_store),
                    None => {
                        (lockfile.buffers.resolutions[dep_id as usize] as usize)
                            < lockfile.packages.len()
                    }
                };

            let resolutions = lockfile.buffers.resolutions.as_slice();
            // `--production` and `--omit` exclude a dependency group, along with every package that
            // only that group needs.
            let wanted = reachable::packages(
                lockfile,
                resolutions,
                reachable::Options {
                    dev: features.dev_dependencies,
                    optional: features.optional_dependencies,
                    peer: features.peer_dependencies,
                    optional_peer: features.peer_dependencies,
                    ..reachable::Options::all(0)
                },
            );
            let selected = |dep_id: DependencyID| {
                let name = lockfile.buffers.dependencies[dep_id as usize]
                    .name
                    .slice(lockfile.buffers.string_bytes.as_slice());
                (!trusted_only || is_trusted(lockfile, dep_id))
                    && (names.is_empty() || names.contains(&name))
            };

            let mut iterator =
                tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(lockfile);

            let mut max_depth: usize = 0;
            let mut installed_count: usize = 0;

            let mut directories: Vec<NodeModulesFolder> = Vec::new();
            while let Some(node_modules) = iterator.next(None) {
                let dir = node_modules.relative_path.as_bytes();
                let mut dependencies = node_modules.dependencies.to_vec();
                dependencies.retain(|&dep_id| {
                    wanted.is_set_allow_out_of_bound(resolutions[dep_id as usize] as usize, false)
                        && is_installed(dir, dep_id, true)
                });
                installed_count += dependencies.len();
                max_depth = max_depth.max(node_modules.depth + 1);

                directories.push(NodeModulesFolder {
                    relative_path: dir.into(),
                    dependencies: dependencies.into(),
                });
            }

            if directories.is_empty() {
                return Ok(());
            }

            let first_directory = directories.remove(0);

            let mut more_packages: Box<[bool]> = vec![false; max_depth].into_boxed_slice();
            if first_directory.dependencies.len() > 1 {
                more_packages[0] = true;
            }

            let found = if all {
                if trusted_only || !names.is_empty() {
                    // `--trusted` and package names select by name, not by position in the tree. A
                    // flat list shows a selected package even when its parent is not selected.
                    print_selected_dependencies_flat(
                        &first_directory,
                        &directories,
                        lockfile,
                        selected,
                    )
                } else {
                    print_node_modules_folder_structure(
                        &first_directory,
                        None,
                        0,
                        &mut directories,
                        lockfile,
                        &mut more_packages,
                    );
                    true
                }
            } else {
                let mut cwd_buf = bun_paths::path_buffer_pool::get();
                Output::println(format_args!(
                    "{} node_modules ({} installed)",
                    bstr::BStr::new(cwd_or_exit(&mut cwd_buf)),
                    installed_count,
                ));
                let root_deps = lockfile.packages.items_dependencies()[0];
                let mut sorted_dependencies: Vec<DependencyID> =
                    (root_deps.begin()..root_deps.end()).collect();
                sorted_dependencies.retain(|&dep_id| {
                    lockfile.buffers.dependencies[dep_id as usize]
                        .behavior
                        .is_enabled(features)
                });
                // The root lists a workspace it also declares once per declaration.
                index_sort::sort_indices(&mut sorted_dependencies, &mut |a, b| {
                    cmp_dependency_names(lockfile, a, b)
                });
                // If the root uses a workspace member's name for a different package, both the
                // member and that package are listed.
                let resolutions = lockfile.buffers.resolutions.as_slice();
                let is_member_row = |dep_id: DependencyID| {
                    lockfile.buffers.dependencies[dep_id as usize]
                        .behavior
                        .is_workspace()
                };
                sorted_dependencies.dedup_by(|a, b| {
                    cmp_dependency_names(lockfile, *a, *b) == Ordering::Equal
                        && (resolutions[*a as usize] == resolutions[*b as usize]
                            || !(is_member_row(*a) || is_member_row(*b)))
                });

                sorted_dependencies.retain(|&dep_id| {
                    is_installed(b"node_modules", dep_id, false) && selected(dep_id)
                });
                print_flat_list(lockfile, &sorted_dependencies);
                !sorted_dependencies.is_empty()
            };

            if !found && !names.is_empty() {
                if log_level != LogLevel::Silent {
                    Output::err_generic(
                        "no packages match: {}",
                        (bstr::BStr::new(&names.join(&b", "[..])),),
                    );
                }
                Global::exit(1);
            }
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"migrate") {
            if !pm.options.enable.force_save_lockfile() {
                for name in [bun_core::zstr!("bun.lock"), bun_core::zstr!("bun.lockb")] {
                    if bun_sys::exists_z(name) {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: {} already exists\nrun with --force to overwrite",
                            bstr::BStr::new(name.as_bytes()),
                        );
                        Global::exit(1);
                    }
                }
            }
            let log_level = pm.options.log_level;
            let pm_raw: *mut PackageManager = pm;
            // SAFETY: same split as `PackageManager::load_lockfile_from_cwd`, with the same FIXME.
            let load_lockfile = unsafe {
                let lockfile: *mut Lockfile = &raw mut *(*pm_raw).lockfile;
                let log: *mut bun_ast::Log = (*pm_raw).log;
                migration::detect_and_load_other_lockfile(
                    &mut *lockfile,
                    Fd::cwd(),
                    &mut *pm_raw,
                    &mut *log,
                )
            };
            if matches!(load_lockfile, LoadResult::NotFound) {
                bun_core::pretty_errorln!("<r><red>error<r>: could not find any other lockfile");
                Global::exit(1);
            }
            Self::handle_load_lockfile_errors_for(&load_lockfile, log_level, "");
            if pm.options.dry_run {
                if log_level != LogLevel::Silent {
                    bun_core::prettyln!(
                        "<r><d>dry run:<r> would write {}",
                        bstr::BStr::new(
                            load_lockfile.save_format(&pm.options).filename().as_bytes()
                        ),
                    );
                }
                Output::flush();
                Global::exit(0);
            }
            package_json_write_back::write_migrated(pm);
            pm.lockfile.save_to_disk(&load_lockfile, &pm.options);
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"version") {
            PmVersionCommand::exec(ctx, pm, positionals, &cwd)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"why") {
            WhyCommand::exec_from_pm(pm, positionals)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"diff") {
            PmDiffCommand::exec(pm, positionals, &cli.diff_args, diff_flags, &cwd)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"licenses") {
            PmLicensesCommand::exec(pm, positionals, &cwd, licenses_flags)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"pkg") {
            PmPkgCommand::exec(&&mut *ctx, pm, positionals, &cwd)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"fetch") {
            crate::cli::pm_fetch_command::exec(ctx, pm, &cwd)?;
            Global::exit(0);
        }

        CommandLineArguments::print_help(Subcommand::Pm);

        if !subcommand.is_empty() {
            bun_core::pretty_errorln!(
                "\n<red>error<r>: \"{}\" unknown command\n",
                bstr::BStr::new(subcommand),
            );
            Output::flush();

            Global::exit(1);
        } else {
            Global::exit(0);
        }
    }
}

fn print_node_modules_folder_structure(
    directory: &NodeModulesFolder,
    directory_package_id: Option<PackageID>,
    depth: usize,
    directories: &mut Vec<NodeModulesFolder>,
    lockfile: &Lockfile,
    more_packages: &mut [bool],
) {
    let resolutions = lockfile.packages.items_resolution();
    let string_bytes = lockfile.buffers.string_bytes.as_slice();

    for i in 0..depth {
        if i == depth - 1 {
            if more_packages[i] {
                bun_core::pretty!("<d>├──<r>");
            } else {
                bun_core::pretty!("<d>└──<r>");
            }
        } else if more_packages[i] {
            bun_core::pretty!("<d>│<r>   ");
        } else {
            bun_core::pretty!("    ");
        }
    }

    if let Some(id) = directory_package_id {
        let mut path: &[u8] = &directory.relative_path;

        if depth != 0 {
            bun_core::pretty!(" ");
            for _ in 0..depth {
                if let Some(j) = strings::index_of(path, b"node_modules") {
                    path = &path[j + b"node_modules".len() + 1..];
                }
            }
        }
        let directory_version =
            bun_fmt::for_terminal(resolutions[id as usize].fmt(string_bytes, PathSep::Auto));
        if let Some(j) = strings::index_of(path, b"node_modules") {
            path = &path[0..j - 1];
        }
        let path = bun_fmt::escape_control_chars(path);
        bun_core::prettyln!("{}<d>@{}<r>", path, directory_version);
    } else {
        let mut cwd_buf = bun_paths::path_buffer_pool::get();
        let path = cwd_or_exit(&mut cwd_buf);
        Output::println(format_args!("{} node_modules", bstr::BStr::new(path)));
    }

    let mut sorted_dependencies: Vec<DependencyID> = directory.dependencies.to_vec();
    index_sort::sort_indices_unstable(&mut sorted_dependencies, &mut |a, b| {
        cmp_dependency_names(lockfile, a, b)
    });

    let sorted_len = sorted_dependencies.len();
    for (index, &dependency_id) in sorted_dependencies.iter().enumerate() {
        let package_name = lockfile.buffers.dependencies[dependency_id as usize]
            .name
            .slice(string_bytes);
        let mut possible_path: Vec<u8> = Vec::new();
        write!(
            &mut possible_path,
            "{}{}{}{}node_modules",
            bstr::BStr::new(&directory.relative_path),
            bun_paths::SEP_STR,
            bstr::BStr::new(package_name),
            bun_paths::SEP_STR,
        )
        .expect("unreachable");

        if index + 1 == sorted_len {
            more_packages[depth] = false;
        }

        let package_id = lockfile.buffers.resolutions[dependency_id as usize];

        let mut dir_index: usize = 0;
        let mut found_node_modules = false;
        while dir_index < directories.len() {
            // A node_modules is removed from the list before it is printed.
            if strings::eql_long(&possible_path, &directories[dir_index].relative_path, true) {
                found_node_modules = true;
                let next = directories.remove(dir_index);

                let mut new_depth: usize = 0;
                let mut temp_path: &[u8] = &possible_path;
                while let Some(j) =
                    strings::index_of(&temp_path[b"node_modules".len()..], b"node_modules")
                {
                    new_depth += 1;
                    temp_path = &temp_path[j + b"node_modules".len()..];
                }

                more_packages[new_depth] = true;
                print_node_modules_folder_structure(
                    &next,
                    Some(package_id),
                    new_depth,
                    directories,
                    lockfile,
                    more_packages,
                );
            }
            dir_index += 1;
        }

        if found_node_modules {
            continue;
        }

        for i in 0..depth {
            if more_packages[i] {
                bun_core::pretty!("<d>│<r>   ");
            } else {
                bun_core::pretty!("    ");
            }
        }

        if more_packages[depth] {
            bun_core::pretty!("<d>├──<r> ");
        } else {
            bun_core::pretty!("<d>└──<r> ");
        }

        bun_core::prettyln!(
            "{}<d>@{}<r>",
            bun_fmt::escape_control_chars(package_name),
            bun_fmt::for_terminal(
                resolutions[package_id as usize].fmt(string_bytes, PathSep::Auto)
            ),
        );
    }
}

/// Returns whether any package was listed.
fn print_selected_dependencies_flat(
    first_directory: &NodeModulesFolder,
    directories: &[NodeModulesFolder],
    lockfile: &Lockfile,
    selected: impl Fn(DependencyID) -> bool,
) -> bool {
    let mut cwd_buf = bun_paths::path_buffer_pool::get();
    let path = cwd_or_exit(&mut cwd_buf);
    Output::println(format_args!("{} node_modules", bstr::BStr::new(path)));

    let mut seen = bun_core::handle_oom(DynamicBitSet::init_empty(lockfile.packages.len()));
    let mut listed: Vec<DependencyID> = Vec::new();
    for folder in core::iter::once(first_directory).chain(directories) {
        for &dep_id in folder.dependencies.iter() {
            let package_id = lockfile.buffers.resolutions[dep_id as usize] as usize;
            if !seen.is_set(package_id) && selected(dep_id) {
                seen.set(package_id);
                listed.push(dep_id);
            }
        }
    }

    index_sort::sort_indices_unstable(&mut listed, &mut |a, b| {
        cmp_dependency_names(lockfile, a, b)
    });
    print_flat_list(lockfile, &listed);
    !listed.is_empty()
}

/// `InstalledFilter` kept `dep_id`, so it resolves to a package of `lockfile`. The same holds for `print_flat_list`.
fn is_trusted(lockfile: &Lockfile, dep_id: DependencyID) -> bool {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let package_id = lockfile.buffers.resolutions[dep_id as usize] as usize;
    lockfile.has_trusted_dependency(
        lockfile.buffers.dependencies[dep_id as usize]
            .name
            .slice(buf),
        lockfile.packages.items_name()[package_id].slice(buf),
        &lockfile.packages.items_resolution()[package_id],
    )
}

fn print_flat_list(lockfile: &Lockfile, dependency_ids: &[DependencyID]) {
    let string_bytes = lockfile.buffers.string_bytes.as_slice();
    for (index, &dep_id) in dependency_ids.iter().enumerate() {
        let package_id = lockfile.buffers.resolutions[dep_id as usize] as usize;
        let name = lockfile.buffers.dependencies[dep_id as usize]
            .name
            .slice(string_bytes);
        let name = bun_fmt::escape_control_chars(name);
        let resolution = bun_fmt::for_terminal(
            lockfile.packages.items_resolution()[package_id].fmt(string_bytes, PathSep::Auto),
        );
        if index + 1 < dependency_ids.len() {
            bun_core::prettyln!("<d>├──<r> {}<r><d>@{}<r>\n", name, resolution);
        } else {
            bun_core::prettyln!("<d>└──<r> {}<r><d>@{}<r>\n", name, resolution);
        }
    }
}
