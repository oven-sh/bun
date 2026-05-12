use core::cmp::Ordering;
use std::io::Write as _;

use bun_core::fmt::PathSep;
use bun_core::strings;
use bun_core::{Global, Output, env_var, fmt as bun_fmt};
use bun_install::dependency::Dependency;
use bun_install::lockfile::{
    LoadResult, Lockfile,
    package::{PackageColumns as _},
    tree,
};
use bun_install::npm as Npm;
use bun_install::package_manager_real::{
    CommandLineArguments, Subcommand, get_cache_directory, package_manager_options::LogLevel,
    setup_global_dir,
};
use bun_install::{DependencyID, PackageID, PackageManager, migration};
use bun_paths::{self as Path, PathBuffer};
use bun_resolver::fs as Fs;
use bun_sys::{self, Dir, Fd, FdExt as _, File};

use crate::cli::Command;
use crate::cli::pm_pkg_command::PmPkgCommand;
use crate::cli::pm_trusted_command::{DefaultTrustedCommand, TrustCommand, UntrustedCommand};
use crate::cli::pm_version_command::PmVersionCommand;
use crate::cli::pm_view_command as PmViewCommand;
use crate::cli::pm_why_command::PmWhyCommand;

pub use crate::cli::pack_command::PackCommand;
pub use crate::cli::scan_command::ScanCommand;

// PORT NOTE: Owned snapshot of `Lockfile.Tree.Iterator(.node_modules).Next`.
// `tree::IteratorNext` borrows the iterator's internal `path_buf`; we copy
// into owned storage so the `directories` Vec can outlive each `next()` call.
struct NodeModulesFolder {
    relative_path: bun_core::ZBox,
    dependencies: Box<[DependencyID]>,
    tree_id: tree::Id,
    depth: usize,
}

// PORT NOTE: transient sort-comparator context; lifetime is fn-local (BORROW_PARAM).
struct ByName<'a> {
    dependencies: &'a [Dependency],
    buf: &'a [u8],
}

impl<'a> ByName<'a> {
    #[allow(dead_code)]
    pub fn is_less_than(ctx: &ByName<'a>, lhs: DependencyID, rhs: DependencyID) -> bool {
        strings::cmp_strings_asc(
            &(),
            ctx.dependencies[lhs as usize].name.slice(ctx.buf),
            ctx.dependencies[rhs as usize].name.slice(ctx.buf),
        )
    }

    // PORT NOTE: Zig pdq takes a strict-less-than predicate; Rust
    // `sort_unstable_by` requires a total `Ordering`. Use this 3-way cmp at
    // sort callsites instead of mapping `is_less_than` → {Less, Greater}.
    pub fn cmp(&self, lhs: DependencyID, rhs: DependencyID) -> Ordering {
        self.dependencies[lhs as usize]
            .name
            .slice(self.buf)
            .cmp(self.dependencies[rhs as usize].name.slice(self.buf))
    }
}

pub struct PackageManagerCommand;

impl PackageManagerCommand {
    // PORT NOTE: takes `LogLevel` instead of `&mut PackageManager` so callers
    // can keep `pm` mutably borrowed by `LoadResult` (which holds
    // `&mut Lockfile` into `pm.lockfile`) across this call.
    pub fn handle_load_lockfile_errors(load_lockfile: &LoadResult<'_>, log_level: LogLevel) {
        let not_silent = log_level != LogLevel::Silent;

        if matches!(load_lockfile, LoadResult::NotFound) {
            if not_silent {
                Output::err_generic("Lockfile not found", ());
            }
            Global::exit(1);
        }

        if let LoadResult::Err(err) = load_lockfile {
            if not_silent {
                Output::err_generic("Error loading lockfile: {s}", (err.value.name(),));
            }
            Global::exit(1);
        }
    }

    #[cold]
    pub fn print_hash(ctx: Command::Context, file: File) -> Result<(), bun_core::Error> {
        let cli = CommandLineArguments::parse(Subcommand::Pm)?;
        let (pm, _cwd) = PackageManager::init(ctx, cli, Subcommand::Pm)?;
        // PORT NOTE: `defer ctx.allocator.free(cwd)` dropped — `_cwd: Box<[u8]>` drops at scope exit.

        let bytes = match file.read_to_end() {
            Ok(bytes) => bytes,
            Err(err) => {
                Output::err(bun_core::Error::from(err), "failed to read lockfile", ());
                Global::crash();
            }
        };

        let log_level = pm.options.log_level;
        // PORT NOTE: reshaped for borrowck — Zig `pm.lockfile.loadFromBytes(pm, …)`
        // is a self-referential split borrow. Derive both halves through `pm`
        // (not the raw `pm_ptr`) so the outer borrow stays on the stack.
        let pm_raw: *mut PackageManager = pm;
        // SAFETY: `pm.lockfile` is `Box<Lockfile>` whose pointee lives in a
        // separate heap allocation; `&mut Lockfile` and `&mut PackageManager`
        // cannot alias. `load_from_bytes` reads `manager.options`/`manager.log`
        // only and never re-projects `manager.lockfile`.
        let load_lockfile = unsafe {
            let lockfile: *mut Lockfile = &raw mut *(*pm_raw).lockfile;
            let log: *mut bun_ast::Log = (*pm_raw).log;
            (*lockfile).load_from_bytes(Some(&mut *pm_raw), bytes, &mut *log)
        };

        Self::handle_load_lockfile_errors(&load_lockfile, log_level);
        drop(load_lockfile);

        Output::flush();
        Output::disable_buffering();
        Output::writer().print(format_args!("{}", pm.lockfile.fmt_meta_hash()))?;
        Output::enable_buffering();
        Global::exit(0);
    }

    fn get_subcommand(args_ptr: &mut &'static [&'static [u8]]) -> &'static [u8] {
        // PORT NOTE: reshaped for borrowck — Zig copied `*args_ptr` to a local,
        // mutated it, and `defer`-wrote it back. We mutate through `args_ptr`
        // directly so the reslice persists into `pm.options.positionals`.
        let mut subcommand: &[u8] = if !args_ptr.is_empty() {
            args_ptr[0]
        } else {
            b""
        };

        if strings::eql_comptime(subcommand, b"pm") {
            subcommand = b"";
            if args_ptr.len() > 1 {
                *args_ptr = &args_ptr[1..];
                return args_ptr[0];
            }
        }

        subcommand
    }

    pub fn print_help() {
        // the output of --help uses the following syntax highlighting
        // template: <b>Usage<r>: <b><green>bun <command><r> <cyan>[flags]<r> <blue>[arguments]<r>
        // use [foo] for multiple arguments or flags for foo.
        // use <bar> to emphasize 'bar'

        const INTRO_TEXT: &str = "\n\
<b>Usage<r>: <b><green>bun pm<r> <cyan>[flags]<r> <blue>[\\<command\\>]<r>\n\
\n\
  Run package manager utilities.";

        const OUTRO_TEXT: &str = "\n\
\n\
<b>Commands:<r>\n\
\n\
  <b><green>bun pm<r> <blue>scan<r>                 scan all packages in lockfile for security vulnerabilities\n\
  <b><green>bun pm<r> <blue>pack<r>                 create a tarball of the current workspace\n\
  <d>├<r> <cyan>--dry-run<r>                 do everything except for writing the tarball to disk\n\
  <d>├<r> <cyan>--destination<r>             the directory the tarball will be saved in\n\
  <d>├<r> <cyan>--filename<r>                the name of the tarball\n\
  <d>├<r> <cyan>--ignore-scripts<r>          don't run pre/postpack and prepare scripts\n\
  <d>├<r> <cyan>--gzip-level<r>              specify a custom compression level for gzip (0-9, default is 9)\n\
  <d>└<r> <cyan>--quiet<r>                   only output the tarball filename\n\
  <b><green>bun pm<r> <blue>bin<r>                  print the path to bin folder\n\
  <d>└<r> <cyan>-g<r>                        print the <b>global<r> path to bin folder\n\
  <b><green>bun<r> <blue>list<r>                  list the dependency tree according to the current lockfile\n\
  <d>└<r> <cyan>--all<r>                     list the entire dependency tree according to the current lockfile\n\
  <b><green>bun pm<r> <blue>why<r> <d>\\<pkg\\><r>            show dependency tree explaining why a package is installed\n\
  <b><green>bun pm<r> <blue>whoami<r>               print the current npm username\n\
  <b><green>bun pm<r> <blue>view<r> <d>name[@version]<r>  view package metadata from the registry <d>(use `bun info` instead)<r>\n\
  <b><green>bun pm<r> <blue>version<r> <d>[increment]<r>  bump the version in package.json and create a git tag\n\
  <d>└<r> <cyan>increment<r>                 patch, minor, major, prepatch, preminor, premajor, prerelease, from-git, or a specific version\n\
  <b><green>bun pm<r> <blue>pkg<r>                  manage data in package.json\n\
  <d>├<r> <cyan>get<r> <d>[key ...]<r>\n\
  <d>├<r> <cyan>set<r> <d>key=value ...<r>\n\
  <d>├<r> <cyan>delete<r> <d>key ...<r>\n\
  <d>└<r> <cyan>fix<r>                       auto-correct common package.json errors\n\
  <b><green>bun pm<r> <blue>hash<r>                 generate & print the hash of the current lockfile\n\
  <b><green>bun pm<r> <blue>hash-string<r>          print the string used to hash the lockfile\n\
  <b><green>bun pm<r> <blue>hash-print<r>           print the hash stored in the current lockfile\n\
  <b><green>bun pm<r> <blue>cache<r>                print the path to the cache folder\n\
  <b><green>bun pm<r> <blue>cache rm<r>             clear the cache\n\
  <b><green>bun pm<r> <blue>migrate<r>              migrate another package manager's lockfile without installing anything\n\
  <b><green>bun pm<r> <blue>untrusted<r>            print current untrusted dependencies with scripts\n\
  <b><green>bun pm<r> <blue>trust<r> <d>names ...<r>      run scripts for untrusted dependencies and add to `trustedDependencies`\n\
  <d>└<r>  <cyan>--all<r>                    trust all untrusted dependencies\n\
  <b><green>bun pm<r> <blue>default-trusted<r>      print the default trusted dependencies list\n\
\n\
Learn more about these at <magenta>https://bun.com/docs/cli/pm<r>.\n";

        Output::pretty(format_args!("{}", INTRO_TEXT));
        Output::pretty(format_args!("{}", OUTRO_TEXT));
        Output::flush();
    }

    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        // PORT NOTE: Zig `std.process.argsAlloc(ctx.allocator)[1..]` → collect
        // process-static argv (already skips argv[0] internally? no — `Argv`
        // includes argv[0]) into a borrowed-slice Vec so `&[&[u8]]` callers
        // (TrustCommand/UntrustedCommand, `left_has_any_in_right`) keep their shape.
        let args_vec: Vec<&'static [u8]> = bun_core::argv().into_iter().skip(1).collect();
        let args: &[&[u8]] = &args_vec;

        // Check if we're being invoked directly as "bun whoami" instead of "bun pm whoami"
        let is_direct_whoami = bun_core::argv()
            .get(1)
            .is_some_and(|arg| strings::eql_comptime(arg.as_bytes(), b"whoami"));

        let cli = CommandLineArguments::parse(Subcommand::Pm)?;
        let (pm, cwd) = match PackageManager::init(&mut *ctx, cli, Subcommand::Pm) {
            Ok(v) => v,
            Err(err) => {
                if err == bun_core::err!(MissingPackageJSON) {
                    let mut cwd_buf = PathBuffer::uninit();
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
                    Output::note("Run \"bun init\" to initialize a project");
                    Global::exit(1);
                }
                return Err(err);
            }
        };
        // PORT NOTE: `defer ctx.allocator.free(cwd)` — `cwd: Box<[u8]>` drops at scope exit.

        // PORT NOTE: reshaped for borrowck — `pm: &mut PackageManager`;
        // many Zig call sites alias `pm` and `pm.lockfile` simultaneously. Hold a
        // raw pointer for those re-entry points (Zig's `*PackageManager` is raw).
        let pm_ptr: *mut PackageManager = pm;

        let mut subcommand: &[u8] = if is_direct_whoami {
            b"whoami"
        } else {
            // PORT NOTE: Zig `getSubcommand(&pm.options.positionals)` defer-writes the
            // advanced slice back into the field; downstream branches (cache rm, view,
            // version/why/pkg) index `positionals[1]/[2]` *after* that advance. Pass the
            // field itself by `&mut` so the reslice persists.
            Self::get_subcommand(&mut pm.options.positionals)
        };

        // Normalize "list" to "ls" (handles both "bun list" and "bun pm list")
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
            PackCommand::exec_with_manager(ctx, pm)?;
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
            Output::println(format_args!("{}", bstr::BStr::new(&username)));
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"view") {
            let property_path = if pm.options.positionals.len() > 2 {
                Some(pm.options.positionals[2])
            } else {
                None
            };
            let spec = if pm.options.positionals.len() > 1 {
                pm.options.positionals[1]
            } else {
                b"".as_slice()
            };
            let json_output = pm.options.json_output;
            PmViewCommand::view(pm, spec, property_path, json_output)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"bin") {
            // SAFETY: `FileSystem::instance()` is initialised during
            // `PackageManager::init` (CLI startup); the singleton lives for
            // process lifetime.
            let top_level_dir: &[u8] = Fs::FileSystem::get().top_level_dir;
            let output_path = Path::resolve_path::join_abs::<Path::platform::Auto>(
                top_level_dir,
                pm.options.bin_path.as_bytes(),
            );
            Output::prettyln(format_args!("{}", bstr::BStr::new(output_path)));
            if Output::stdout_descriptor_type() == Output::OutputStreamDescriptor::Terminal {
                Output::prettyln(format_args!("\n"));
            }

            if pm.options.global {
                'warner: {
                    if Output::enable_ansi_colors_stderr() {
                        if let Some(path) = env_var::PATH.get() {
                            // PORT NOTE: `std.mem.tokenizeScalar` skips empty
                            // segments; mirror with `split` + `filter`.
                            let mut path_iter = path
                                .split(|b| *b == bun_paths::DELIMITER)
                                .filter(|s| !s.is_empty());
                            for entry in &mut path_iter {
                                if strings::eql(entry, output_path) {
                                    break 'warner;
                                }
                            }

                            Output::pretty_errorln("\n<r><yellow>warn<r>: not in $PATH\n");
                        }
                    }
                }
            }

            Output::flush();
            return Ok(());
        } else if strings::eql_comptime(subcommand, b"hash") {
            let log_level = pm.options.log_level;
            let load_lockfile = pm.load_lockfile_from_cwd::<true>();
            Self::handle_load_lockfile_errors(&load_lockfile, log_level);
            drop(load_lockfile);

            // SAFETY: pm_ptr is the unique owner; lockfile borrow released above.
            let pm = unsafe { &mut *pm_ptr };
            let _ = pm
                .lockfile
                .has_meta_hash_changed(false, pm.lockfile.packages.len())?;

            Output::flush();
            Output::disable_buffering();
            Output::writer().print(format_args!("{}", pm.lockfile.fmt_meta_hash()))?;
            Output::enable_buffering();
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"hash-print") {
            let log_level = pm.options.log_level;
            let load_lockfile = pm.load_lockfile_from_cwd::<true>();
            Self::handle_load_lockfile_errors(&load_lockfile, log_level);
            drop(load_lockfile);

            Output::flush();
            Output::disable_buffering();
            Output::writer().print(format_args!("{}", pm.lockfile.fmt_meta_hash()))?;
            Output::enable_buffering();
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"hash-string") {
            let log_level = pm.options.log_level;
            let load_lockfile = pm.load_lockfile_from_cwd::<true>();
            Self::handle_load_lockfile_errors(&load_lockfile, log_level);
            drop(load_lockfile);

            // SAFETY: pm_ptr is the unique owner; lockfile borrow released above.
            let pm = unsafe { &mut *pm_ptr };
            let _ = pm
                .lockfile
                .has_meta_hash_changed(true, pm.lockfile.packages.len())?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"cache") {
            let mut dir = PathBuffer::uninit();
            let fd = get_cache_directory(pm);
            let outpath = match bun_sys::get_fd_path(fd.fd(), &mut dir) {
                Ok(p) => &p[..],
                Err(err) => {
                    Output::pretty_errorln(format_args!(
                        "{} getting cache directory",
                        bun_core::Error::from(err).name(),
                    ));
                    Global::crash();
                }
            };

            if pm.options.positionals.len() > 1
                && strings::eql_comptime(pm.options.positionals[1], b"rm")
            {
                fd.close();

                let mut had_err = false;

                if let Err(err) = bun_sys::delete_tree_absolute(outpath) {
                    Output::err(err, "Could not delete {s}", (bstr::BStr::new(outpath),));
                    had_err = true;
                }
                Output::prettyln(format_args!("Cleared 'bun install' cache"));

                'bunx: {
                    let tmp = Fs::RealFS::platform_temp_dir();
                    let tmp_dir = match bun_sys::open_dir_absolute(tmp) {
                        Ok(d) => Dir::from_fd(d),
                        Err(err) => {
                            Output::err(
                                bun_core::Error::from(err),
                                "Could not open {s}",
                                (bstr::BStr::new(tmp),),
                            );
                            had_err = true;
                            break 'bunx;
                        }
                    };
                    let mut iter = bun_sys::iterate_dir(tmp_dir.fd());

                    // This is to match 'bunx_command.BunxCommand.exec's logic
                    let mut prefix: Vec<u8> = Vec::new();
                    #[cfg(unix)]
                    {
                        // SAFETY: getuid(2) is always-successful with no preconditions.
                        write!(&mut prefix, "bunx-{}-", unsafe { libc::getuid() })
                            .expect("unreachable");
                    }
                    #[cfg(not(unix))]
                    {
                        write!(&mut prefix, "bunx-{}-", bun_sys::windows::user_unique_id())
                            .expect("unreachable");
                    }

                    let mut deleted: usize = 0;
                    loop {
                        let entry = match iter.next() {
                            Ok(Some(e)) => e,
                            Ok(None) => break,
                            Err(err) => {
                                Output::err(
                                    bun_core::Error::from(err),
                                    "Could not read {s}",
                                    (bstr::BStr::new(tmp),),
                                );
                                had_err = true;
                                break 'bunx;
                            }
                        };
                        let name = entry.name.slice_u8();
                        if name.starts_with(prefix.as_slice()) {
                            if let Err(err) = tmp_dir.delete_tree(name) {
                                Output::err(err, "Could not delete {s}", (bstr::BStr::new(name),));
                                had_err = true;
                                continue;
                            }

                            deleted += 1;
                        }
                    }

                    Output::prettyln(format_args!("Cleared {} cached 'bunx' packages", deleted));
                }

                Global::exit(if had_err { 1 } else { 0 });
            }

            let _ = Output::writer().write_all(outpath);
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"default-trusted") {
            DefaultTrustedCommand::exec()?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"untrusted") {
            UntrustedCommand::exec(&mut *ctx, pm, args)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"trust") {
            TrustCommand::exec(&mut *ctx, pm, args)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"ls") {
            let log_level = pm.options.log_level;
            let load_lockfile = pm.load_lockfile_from_cwd::<true>();
            Self::handle_load_lockfile_errors(&load_lockfile, log_level);
            drop(load_lockfile);

            Output::flush();
            Output::disable_buffering();
            let lockfile: &Lockfile = &pm.lockfile;
            let mut iterator =
                tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(lockfile);

            let mut max_depth: usize = 0;

            let mut directories: Vec<NodeModulesFolder> = Vec::new();
            while let Some(node_modules) = iterator.next(None) {
                let path_len = node_modules.relative_path.as_bytes().len();
                let mut path: Vec<u8> = Vec::with_capacity(path_len + 1);
                path.extend_from_slice(node_modules.relative_path.as_bytes());
                path.push(0);

                let dependencies: Box<[DependencyID]> = Box::from(node_modules.dependencies);

                if max_depth < node_modules.depth + 1 {
                    max_depth = node_modules.depth + 1;
                }

                directories.push(NodeModulesFolder {
                    // SAFETY: NUL terminator just appended above.
                    relative_path: bun_core::ZBox::from_vec_with_nul(path),
                    dependencies,
                    tree_id: node_modules.tree_id,
                    depth: node_modules.depth,
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

            if strings::left_has_any_in_right(args, &[b"-A", b"-a", b"--all"]) {
                print_node_modules_folder_structure(
                    &first_directory,
                    None,
                    0,
                    &mut directories,
                    lockfile,
                    &mut more_packages,
                )?;
            } else {
                let mut cwd_buf = PathBuffer::uninit();
                let path = match bun_sys::getcwd(&mut cwd_buf[..]) {
                    Ok(len) => &cwd_buf[..len],
                    Err(_) => {
                        Output::pretty_errorln(
                            "<r><red>error<r>: Could not get current working directory",
                        );
                        Global::exit(1);
                    }
                };
                let dependencies = lockfile.buffers.dependencies.as_slice();
                let slice = lockfile.packages.slice();
                let resolutions = slice.items_resolution();
                let root_deps = slice.items_dependencies()[0];

                Output::println(format_args!(
                    "{} node_modules ({})",
                    bstr::BStr::new(path),
                    lockfile.buffers.hoisted_dependencies.len(),
                ));
                let string_bytes = lockfile.buffers.string_bytes.as_slice();
                let mut sorted_dependencies: Vec<DependencyID> =
                    Vec::with_capacity(root_deps.len as usize);
                for i in 0..root_deps.len {
                    sorted_dependencies.push((root_deps.off + i) as DependencyID);
                }
                let by_name = ByName {
                    dependencies,
                    buf: string_bytes,
                };
                // PERF(port): Zig `std.sort.pdq` (unstable pdqsort) — Rust
                // `sort_unstable_by` is the matching pdqsort; names are
                // unique so stability is irrelevant.
                sorted_dependencies.sort_unstable_by(|a, b| by_name.cmp(*a, *b));

                for (index, &dependency_id) in sorted_dependencies.iter().enumerate() {
                    let package_id =
                        lockfile.buffers.resolutions.as_slice()[dependency_id as usize];
                    if package_id as usize >= lockfile.packages.len() {
                        continue;
                    }
                    let name = dependencies[dependency_id as usize]
                        .name
                        .slice(string_bytes);
                    let resolution =
                        resolutions[package_id as usize].fmt(string_bytes, PathSep::Auto);

                    if index < sorted_dependencies.len() - 1 {
                        Output::prettyln(format_args!(
                            "<d>├──<r> {}<r><d>@{}<r>\n",
                            bstr::BStr::new(name),
                            resolution,
                        ));
                    } else {
                        Output::prettyln(format_args!(
                            "<d>└──<r> {}<r><d>@{}<r>\n",
                            bstr::BStr::new(name),
                            resolution,
                        ));
                    }
                }
            }

            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"migrate") {
            if !pm.options.enable.force_save_lockfile() {
                if bun_sys::exists_z(bun_core::zstr!("bun.lock")) {
                    Output::pretty_errorln(
                        "<r><red>error<r>: bun.lock already exists\nrun with --force to overwrite",
                    );
                    Global::exit(1);
                }

                if bun_sys::exists_z(bun_core::zstr!("bun.lockb")) {
                    Output::pretty_errorln(
                        "<r><red>error<r>: bun.lockb already exists\nrun with --force to overwrite",
                    );
                    Global::exit(1);
                }
            }
            let log_level = pm.options.log_level;
            // PORT NOTE: reshaped for borrowck — Zig
            // `migration.detectAndLoadOtherLockfile(&pm.lockfile, .cwd(), pm, ctx.log)`
            // is a self-referential split borrow. Derive both halves through
            // `pm` (not the raw `pm_ptr`) so the outer borrow stays on the
            // Stacked-Borrows stack.
            let pm_raw: *mut PackageManager = pm;
            // SAFETY: `pm.lockfile` is `Box<Lockfile>` whose pointee lives in a
            // separate heap allocation; `&mut Lockfile` and `&mut PackageManager`
            // cannot alias. `detect_and_load_other_lockfile` reads
            // `manager.options`/`manager.log` only and never re-projects
            // `manager.lockfile`.
            let mut load_lockfile = unsafe {
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
                Output::pretty_errorln("<r><red>error<r>: could not find any other lockfile");
                Global::exit(1);
            }
            Self::handle_load_lockfile_errors(&load_lockfile, log_level);
            // PORT NOTE: reshaped for borrowck — `save_to_disk` needs
            // `&mut Lockfile` (self) and `&LoadResult` simultaneously, but
            // `LoadResultOk.lockfile` already holds the only `&mut` into the
            // boxed lockfile. Project that field to a raw pointer (no second
            // Box-deref) so both arguments share one Stacked-Borrows lineage.
            let lf: *mut Lockfile = &raw mut *load_lockfile.ok_mut().lockfile;
            // SAFETY: `load_lockfile` is `Ok` (errors exited above). `lf` is a
            // reborrow of `ok.lockfile`; `save_to_disk` reads `load_result` only
            // for `save_format()` / `loaded_from_binary_lockfile()` (scalar
            // `format`/`migrated` fields) and never dereferences `ok.lockfile`,
            // so `&mut *lf` remains the sole live mutable view of the heap
            // lockfile. `options` is read via `pm_raw` (disjoint allocation).
            unsafe {
                (*lf).save_to_disk(&load_lockfile, &(*pm_raw).options);
            }
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"version") {
            // PORT NOTE: `pm.options.positionals: &'static [&'static [u8]]`
            // coerces to `&[&[u8]]` (covariant in both lifetimes).
            let positionals: &[&[u8]] = pm.options.positionals;
            PmVersionCommand::exec(ctx, pm, positionals, &cwd)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"why") {
            let positionals: &[&[u8]] = pm.options.positionals;
            PmWhyCommand::exec(&&mut *ctx, pm, positionals)?;
            Global::exit(0);
        } else if strings::eql_comptime(subcommand, b"pkg") {
            let positionals: &[&[u8]] = pm.options.positionals;
            PmPkgCommand::exec(&&mut *ctx, pm, positionals, &cwd)?;
            Global::exit(0);
        }

        Self::print_help();

        if !subcommand.is_empty() {
            Output::pretty_errorln(format_args!(
                "\n<red>error<r>: \"{}\" unknown command\n",
                bstr::BStr::new(subcommand),
            ));
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
) -> Result<(), bun_core::Error> {
    // PORT NOTE: `lockfile.allocator` dropped — global mimalloc.
    let resolutions = lockfile.packages.items_resolution();
    let string_bytes = lockfile.buffers.string_bytes.as_slice();

    {
        for i in 0..depth {
            if i == depth - 1 {
                if more_packages[i] {
                    Output::pretty(format_args!("<d>├──<r>"));
                } else {
                    Output::pretty(format_args!("<d>└──<r>"));
                }
            } else if more_packages[i] {
                Output::pretty(format_args!("<d>│<r>   "));
            } else {
                Output::pretty(format_args!("    "));
            }
        }

        let mut resolution_buf = [0u8; 512];
        if let Some(id) = directory_package_id {
            let mut path: &[u8] = directory.relative_path.as_bytes();

            if depth != 0 {
                Output::pretty(format_args!(" "));
                for _ in 0..depth {
                    if let Some(j) = strings::index_of(path, b"node_modules") {
                        path = &path[j + b"node_modules".len() + 1..];
                    }
                }
            }
            let directory_version = buf_print(
                &mut resolution_buf,
                format_args!(
                    "{}",
                    resolutions[id as usize].fmt(string_bytes, PathSep::Auto)
                ),
            );
            if let Some(j) = strings::index_of(path, b"node_modules") {
                Output::prettyln(format_args!(
                    "{}<d>@{}<r>",
                    bstr::BStr::new(&path[0..j - 1]),
                    bstr::BStr::new(directory_version),
                ));
            } else {
                Output::prettyln(format_args!(
                    "{}<d>@{}<r>",
                    bstr::BStr::new(path),
                    bstr::BStr::new(directory_version),
                ));
            }
        } else {
            let mut cwd_buf = PathBuffer::uninit();
            let path = match bun_sys::getcwd(&mut cwd_buf[..]) {
                Ok(len) => &cwd_buf[..len],
                Err(_) => {
                    Output::pretty_errorln(
                        "<r><red>error<r>: Could not get current working directory",
                    );
                    Global::exit(1);
                }
            };
            Output::println(format_args!("{} node_modules", bstr::BStr::new(path)));
        }
    }

    let dependencies = lockfile.buffers.dependencies.as_slice();
    let mut sorted_dependencies: Vec<DependencyID> = directory.dependencies.to_vec();
    let by_name = ByName {
        dependencies,
        buf: string_bytes,
    };
    // PERF(port): Zig `std.sort.pdq` (unstable pdqsort) — Rust
    // `sort_unstable_by` is the matching pdqsort; names are unique so
    // stability is irrelevant.
    sorted_dependencies.sort_unstable_by(|a, b| by_name.cmp(*a, *b));

    let sorted_len = sorted_dependencies.len();
    for (index, &dependency_id) in sorted_dependencies.iter().enumerate() {
        let package_name = dependencies[dependency_id as usize]
            .name
            .slice(string_bytes);
        let mut possible_path: Vec<u8> = Vec::new();
        write!(
            &mut possible_path,
            "{}{}{}{}node_modules",
            bstr::BStr::new(directory.relative_path.as_bytes()),
            bun_paths::SEP_STR,
            bstr::BStr::new(package_name),
            bun_paths::SEP_STR,
        )
        .expect("unreachable");

        if index + 1 == sorted_len {
            more_packages[depth] = false;
        }

        let package_id = lockfile.buffers.resolutions[dependency_id as usize];

        if package_id as usize >= lockfile.packages.len() {
            // in case we are loading from a binary lockfile with invalid package ids
            continue;
        }

        let mut dir_index: usize = 0;
        let mut found_node_modules = false;
        while dir_index < directories.len() {
            // Recursively print node_modules. node_modules is removed from
            // the directories list before traversal.
            if strings::eql_long(
                &possible_path,
                directories[dir_index].relative_path.as_bytes(),
                true,
            ) {
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
                )?;
            }
            dir_index += 1;
        }

        if found_node_modules {
            continue;
        }

        for i in 0..depth {
            if more_packages[i] {
                Output::pretty(format_args!("<d>│<r>   "));
            } else {
                Output::pretty(format_args!("    "));
            }
        }

        if more_packages[depth] {
            Output::pretty(format_args!("<d>├──<r> "));
        } else {
            Output::pretty(format_args!("<d>└──<r> "));
        }

        let mut resolution_buf = [0u8; 512];
        let package_version = buf_print(
            &mut resolution_buf,
            format_args!(
                "{}",
                resolutions[package_id as usize].fmt(string_bytes, PathSep::Auto)
            ),
        );
        Output::prettyln(format_args!(
            "{}<d>@{}<r>",
            bstr::BStr::new(package_name),
            bstr::BStr::new(package_version),
        ));
    }

    Ok(())
}

use bun_core::fmt::buf_print_infallible as buf_print;

// ported from: src/cli/package_manager_command.zig
