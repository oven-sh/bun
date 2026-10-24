//! `bun x` / `bunx`: resolves a package's executable — installing it into a
//! shared cache when not already present — and execs it with the given args.

use bstr::BStr;

use crate::cli::command::ContextData;
use crate::cli::{self, Command};
use crate::run_command::{ConfigureEnvOptions, RunCommand as Run};

use bun_alloc::AllocError;
use bun_ast::ExprData;
use bun_bundler::Transpiler;
use bun_core::{self, Global, Output};
use bun_core::{ZBox, ZStr, strings};
use bun_install::CommandLineArguments;
use bun_install::dependency::VersionTag;
use bun_install::update_request::{self, UpdateRequest};
use bun_parsers::json;
use bun_paths::{self, DELIMITER};
use bun_resolver::fs::RealFS;
use bun_sys::{self, Fd, FdDirExt as _, O};
use bun_wyhash::hash;
use std::env::consts::EXE_SUFFIX;

use crate::api::bun::process::Status as SpawnStatus;
use crate::api::bun::process::sync as proc_sync;

bun_output::declare_scope!(bunx, visible);

const SEP: &[u8] = &[bun_paths::SEP];

pub(crate) struct BunxCommand;

/// One entry of the `bin` field in a package.json.
struct PackageBin {
    name: Box<[u8]>,
    /// The path of the bin's file, relative to the package's directory.
    file: Box<[u8]>,
}

/// What the project has of the package that a request without a version names.
enum InProject {
    Absent,
    Run(ZBox),
    NotExecutable(ZBox),
    /// `realpath` of the bin's file failed.
    Unresolved {
        file: ZBox,
        err: bun_sys::Error,
        is_in_node_modules: bool,
    },
}

/// `flock` on `<bunx cache dir>.lock`, next to the tree. CLOEXEC: exec'ing the target releases it.
struct InstallLock {
    _file: bun_sys::File,
}

impl InstallLock {
    /// Blocks while another `bunx` holds the lock. Returns `None` if the lock cannot be taken.
    fn acquire(bunx_cache_dir: &[u8]) -> Option<Self> {
        let path = ZBox::from_bytes([bunx_cache_dir, b".lock"].concat());
        let flags = O::CREAT | O::RDWR | O::CLOEXEC | O::NOFOLLOW;
        let file = bun_sys::File::from_fd(bun_sys::openat(Fd::cwd(), &path, flags, 0o600).ok()?);
        bun_sys::flock(file.fd(), bun_sys::FileLockMode::Exclusive, false).ok()?;
        Some(Self { _file: file })
    }
}

/// The state of the directory that `bunx` installs a package into. Its package.json is
/// `EMPTY_PACKAGE_JSON` while `bun add` links packages, so a read-only run needs no lock.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Tree {
    Missing,
    /// Unfinished, or older than [`BunxCommand::SECONDS_CACHE_VALID`].
    Stale,
    Fresh,
}

/// Returns the name of the directory that contains all of this user's trees. See
/// [`BunxCommand::cache_dir`]. Windows doesn't have one.
pub(crate) fn cache_root_name() -> Vec<u8> {
    #[cfg(unix)]
    let uid = bun_sys::c::getuid();
    #[cfg(windows)]
    let uid = bun_sys::windows::user_unique_id();
    format!(".bunx-{uid}").into_bytes()
}

/// Returns how many packages are in `<base>/.bunx-<uid>`. All packages of one scope count as one.
pub(crate) fn count_cached_packages(base: &[u8]) -> usize {
    let root = [base, SEP, cache_root_name().as_slice()].concat();
    let Ok(root) = bun_sys::Dir::open(&root) else {
        return 0;
    };
    let mut entries = bun_sys::iterate_dir(root.fd());
    let mut count = 0;
    while let Ok(Some(entry)) = entries.next() {
        // The files are the locks beside the trees.
        count += usize::from(entry.kind != bun_sys::EntryKind::File);
    }
    count
}

/// bunx-specific options parsed from argv.
#[derive(Default)]
pub(crate) struct Options {
    /// CLI arguments to pass to the command being run.
    pub(crate) passthrough_list: Vec<Box<[u8]>>,
    /// `bunx <package_name>`
    pub(crate) package_name: &'static [u8],
    /// The binary name to run (when using --package)
    pub(crate) binary_name: Option<&'static [u8]>,
    /// The package to install (when using --package)
    pub(crate) specified_package: Option<&'static [u8]>,
    // `--silent` and `--verbose` are not mutually exclusive.
    pub(crate) verbose_install: bool,
    pub(crate) silent_install: bool,
    /// Only run the target command if it is already downloaded; otherwise `bunx` exits with an error.
    pub(crate) no_install: bool,
    /// Passes `--trust` to `bun add`, so the lifecycle scripts of the package and of everything it
    /// depends on run.
    pub(crate) trust: bool,
    /// Passes `--ignore-scripts` to `bun add`, which wins over `--trust`.
    pub(crate) ignore_scripts: bool,
    /// In seconds, as typed. It's forwarded to `bun add` and is part of the cache directory's name.
    pub(crate) minimum_release_age: Option<&'static [u8]>,
    /// Forwarded to `bun add`, like `ca` and `cafile`. It's part of the cache directory's name.
    pub(crate) registry: Option<&'static [u8]>,
    pub(crate) ca: Vec<&'static [u8]>,
    pub(crate) cafile: Option<&'static [u8]>,
}

impl Options {
    /// The value when `argv[*i]` is `<name>=<value>` or `<name>` followed by `<value>`. Exits when it has none.
    fn flag_value(argv: &[&'static ZStr], i: &mut usize, name: &str) -> Option<&'static [u8]> {
        let value = match argv[*i].as_bytes().strip_prefix(name.as_bytes())? {
            [] => {
                *i += 1;
                argv.get(*i).map_or(b"".as_slice(), |arg| arg.as_bytes())
            }
            [b'=', value @ ..] => value,
            _ => return None,
        };
        if value.is_empty() {
            Output::err_generic("{} requires a value", (name,));
            Global::exit(1);
        }
        Some(value)
    }

    fn non_empty_package(package: &'static [u8]) -> &'static [u8] {
        if package.is_empty() {
            Output::err_generic("--package requires a non-empty package name", ());
            Global::exit(1);
        }
        package
    }

    /// Exits on `--version` / `--revision` without a target command (not a failure) and on incorrect arguments.
    fn parse(ctx: &mut ContextData, argv: &[&'static ZStr]) -> Result<Options, AllocError> {
        let mut found_subcommand_name = false;
        let mut maybe_package_name: Option<&'static [u8]> = None;
        let mut has_version = false;
        let mut has_revision = false;
        let mut i: usize = 0;

        let mut opts = Options::default();
        opts.passthrough_list.reserve_exact(argv.len());
        let mut ca_store_flags: Vec<&[u8]> = Vec::new();

        // `BUN_OPTIONS` applies to every command, so flags in it that bunx doesn't know are meant
        // for something else.
        let bun_options = (bun_core::argv().as_slice())
            .get(1..1 + bun_core::bun_options_argc())
            .unwrap_or_default();
        let is_from_bun_options =
            |arg: &ZStr| bun_options.iter().any(|option| core::ptr::eq(*option, arg));

        while i < argv.len() {
            let positional: &[u8] = argv[i].as_bytes();

            if maybe_package_name.is_some() {
                opts.passthrough_list.push(Box::<[u8]>::from(positional));
                i += 1;
                continue;
            }

            if !positional.is_empty() && positional[0] == b'-' {
                if positional == b"--version" || positional == b"-v" {
                    has_version = true;
                } else if positional == b"--revision" {
                    has_revision = true;
                } else if positional == b"--verbose" {
                    opts.verbose_install = true;
                } else if positional == b"--silent" {
                    opts.silent_install = true;
                } else if positional == b"--bun" || positional == b"-b" {
                    ctx.debug.run_in_bun = true;
                } else if matches!(
                    positional,
                    // The others are npm's names for it.
                    b"--no-install" | b"--no" | b"--no-yes" | b"--yes=false" | b"-n" | b"--offline"
                ) {
                    opts.no_install = true;
                } else if positional == b"--package" || positional == b"-p" {
                    i += 1;
                    if i >= argv.len() {
                        Output::err_generic("--package requires a package name", ());
                        Global::exit(1);
                    }
                    opts.specified_package = Some(Self::non_empty_package(argv[i].as_bytes()));
                } else if let Some(package) = positional
                    .strip_prefix(b"--package=")
                    .or_else(|| positional.strip_prefix(b"-p="))
                {
                    opts.specified_package = Some(Self::non_empty_package(package));
                } else if positional == b"--yes"
                    && (argv.get(i + 1)).is_some_and(|next| next.as_bytes() == b"false")
                {
                    opts.no_install = true;
                    i += 1;
                } else if positional == b"--trust" {
                    opts.trust = true;
                } else if matches!(positional, b"--ignore-scripts" | b"--ignore-scripts=true") {
                    opts.ignore_scripts = true;
                } else if let Some(file) = Self::flag_value(argv, &mut i, "--env-file") {
                    ctx.args.env_files.push(Box::<[u8]>::from(file));
                } else if let Some(dir) = Self::flag_value(argv, &mut i, "--cwd") {
                    if let Err(err) = bun_sys::chdir(&ZBox::from_bytes(dir)) {
                        Output::err(
                            err,
                            "Could not change directory to \"{}\"",
                            format_args!("{}", BStr::new(dir)),
                        );
                        Global::exit(1);
                    }
                } else if let Some(age) = Self::flag_value(argv, &mut i, "--minimum-release-age") {
                    // Validate the whole value, like `bun add` does, because it becomes part of a
                    // directory name.
                    if bun_core::fmt::parse_seconds(age).is_none() {
                        Output::err_generic(
                            "Expected --minimum-release-age to be a positive number: {}",
                            (BStr::new(age),),
                        );
                        Global::exit(1);
                    }
                    opts.minimum_release_age = Some(age);
                } else if let Some(url) = Self::flag_value(argv, &mut i, "--registry")
                    // The names that npm and pnpm also have for it.
                    .or_else(|| Self::flag_value(argv, &mut i, "--reg"))
                    .or_else(|| Self::flag_value(argv, &mut i, "--config.registry"))
                {
                    opts.registry = Some(url);
                } else if let Some(ca) = Self::flag_value(argv, &mut i, "--ca") {
                    opts.ca.push(ca);
                } else if let Some(path) = Self::flag_value(argv, &mut i, "--cafile") {
                    opts.cafile = Some(path);
                } else if positional == b"--help" || positional == b"-h" {
                    crate::cli::command::tag_print_help(Command::Tag::BunxCommand, false);
                    Global::exit(0);
                } else if Global::is_ca_store_flag(positional) {
                    ca_store_flags.push(positional);
                } else if positional == b"--" || is_from_bun_options(argv[i]) {
                } else if let Some(value_is_next_arg) = CommandLineArguments::bunx_skips_flag(
                    positional,
                    argv.get(i + 1).map_or(b"".as_slice(), |arg| arg.as_bytes()),
                ) {
                    i += usize::from(value_is_next_arg);
                } else {
                    // Skipping it would make the value of `--flag value` the package that is downloaded and run.
                    Output::err_generic(
                        "bunx has no <b>{}<r> flag. Flags for the package go after its name.",
                        (BStr::new(positional),),
                    );
                    Global::exit(1);
                }
            } else if is_from_bun_options(argv[i]) {
                // The value of a flag that was skipped.
            } else if !found_subcommand_name {
                found_subcommand_name = true;
            } else {
                maybe_package_name = Some(positional);
            }

            i += 1;
        }

        Global::set_ca_store_from_flags(|flag| ca_store_flags.contains(&flag));

        let maybe_package_name = maybe_package_name.filter(|name| !name.is_empty());
        if let Some(specified_package) = opts.specified_package {
            if maybe_package_name.is_none() {
                Output::err_generic(
                    "When using --package, you must specify the binary to run",
                    (),
                );
                bun_core::prettyln!(
                    "  <d>usage: bunx --package=\\<package-name\\> \\<binary-name\\> [args...]<r>"
                );
                Global::exit(1);
            }
            opts.binary_name = maybe_package_name;
            opts.package_name = specified_package;
        } else {
            let Some(package_name) = maybe_package_name else {
                if has_revision {
                    cli::print_revision_and_exit();
                } else if has_version {
                    cli::print_version_and_exit();
                } else {
                    BunxCommand::exit_with_usage();
                }
            };
            opts.package_name = package_name;
        }
        Ok(opts)
    }
}

impl BunxCommand {
    pub(crate) fn add_create_prefix(input: &[u8]) -> Result<ZBox, AllocError> {
        if input.is_empty() {
            return Ok(ZBox::default());
        }
        let (at, infix) = if input[0] != b'@' {
            (0, b"create-")
        } else if let Some(slash) = strings::index_of_char_usize(input, b'/') {
            // @org/some@v -> @org/create-some@v
            (slash + 1, b"create-")
        } else {
            // @org@v -> @org/create@v, @org -> @org/create
            let version = strings::index_of_char_usize(&input[1..], b'@');
            (version.map_or(input.len(), |at| at + 1), b"/create")
        };
        Ok(ZBox::from_vec([&input[..at], infix, &input[at..]].concat()))
    }

    /// 1 day
    const SECONDS_CACHE_VALID: i64 = 60 * 60 * 24;

    const EMPTY_PACKAGE_JSON: &[u8] =
        bun_install::package_manager_real::run_tasks::BUNX_UNFINISHED_PACKAGE_JSON;

    /// `bun_which::which` resolves a name with a slash against the cwd, not `node_modules/.bin`.
    fn is_safe_bin_name(name: &[u8]) -> bool {
        !name.is_empty()
            && name != b"."
            && name != b".."
            && strings::index_of_char(name, b'/').is_none()
            && strings::index_of_char(name, b'\\').is_none()
    }

    /// Returns the package's bin named `preferred` if it has one, and otherwise its first bin.
    fn get_bin_from_subpath(
        transpiler: &mut Transpiler,
        dir_fd: Fd,
        subpath_z: &ZStr,
        preferred: &[u8],
    ) -> crate::Result<PackageBin> {
        let package_bin = |name: &[u8], file: &[u8]| PackageBin {
            name: name.into(),
            file: file.into(),
        };
        let target_package_json_fd = bun_sys::openat(dir_fd, subpath_z, O::RDONLY, 0)?;
        let target_package_json = bun_sys::File::from_fd(target_package_json_fd);
        let package_json_bytes = target_package_json.read_to_end()?;
        let package_json_contents = package_json_bytes.as_slice();
        let source = bun_ast::Source::init_path_string(subpath_z.as_bytes(), package_json_contents);

        bun_ast::initialize_store();

        let parsed = json::ParsedJson::parse_package_json(&source, transpiler.log_mut())?;
        let expr = parsed.root;

        if let Some(bin_expr) = expr.get(b"bin") {
            match &bin_expr.data {
                ExprData::EObjectJSON(object) => {
                    let mut first: Option<PackageBin> = None;
                    for prop in object.get().properties() {
                        let bin_name = prop.key.slice();
                        // Same values the bin linker does not link (`bin.rs`).
                        let Some(target) = prop.value.as_str().filter(|target| {
                            !target.is_empty()
                                && !bun_install::bin::bin_target_escapes_package_dir(target)
                        }) else {
                            continue;
                        };
                        if !Self::is_safe_bin_name(bin_name) {
                            continue;
                        }
                        if bin_name == preferred {
                            return Ok(package_bin(bin_name, target));
                        }
                        first.get_or_insert_with(|| package_bin(bin_name, target));
                    }
                    if let Some(bin) = first {
                        return Ok(bin);
                    }
                }
                ExprData::EString(_) => {
                    // The command name of a scoped `name` (`@scope/pkg`) is its unscoped portion.
                    if let Some(name_expr) = expr.get(b"name")
                        && let Some(name) = name_expr.as_utf8_string_literal()
                        && !name.is_empty()
                        && let Some(target) = bin_expr.as_utf8_string_literal()
                    {
                        let bin_name = bun_install::dependency::unscoped_package_name(name);
                        if Self::is_safe_bin_name(bin_name) {
                            return Ok(package_bin(bin_name, target));
                        }
                    }
                }
                _ => {}
            }
        }

        // Same values the bin linker refuses to link from (`bin.rs`, `Tag::Dir`).
        if let Some(dirs) = expr.as_property(b"directories")
            && let Some(bin_prop) = dirs.expr.as_property(b"bin")
            && let Some(dir_name) = bin_prop.expr.as_utf8_string_literal()
            && !dir_name.is_empty()
            && !bun_install::bin::bin_target_escapes_package_dir(dir_name)
        {
            use bun_paths::{platform::Auto, resolve_path::dirname, resolve_path::join_z};
            // `directories.bin` is relative to the package, not to `dir_fd`.
            let path = join_z::<Auto>(&[dirname::<Auto>(subpath_z.as_bytes()), dir_name]);
            let bin_dir = bun_sys::openat(dir_fd, path, O::RDONLY | O::DIRECTORY, 0)?;
            let _close_bin_dir = bun_sys::CloseOnDrop::new(bin_dir);
            let mut iterator = bun_sys::dir_iterator::iterate(bin_dir);
            let bin_in_dir = |name: &[u8]| package_bin(name, &[dir_name, b"/", name].concat());
            let mut first: Option<PackageBin> = None;
            while let Ok(Some(current)) = iterator.next() {
                if current.kind == bun_sys::EntryKind::File && !current.name.slice().is_empty() {
                    if current.name.slice_u8() == preferred {
                        return Ok(bin_in_dir(preferred));
                    }
                    first.get_or_insert_with(|| bin_in_dir(current.name.slice_u8()));
                }
            }
            if let Some(bin) = first {
                return Ok(bin);
            }
        }

        Err(crate::Error::NoBinFound)
    }

    /// Finds the bin in the nearest `node_modules/<package_name>` from `cwd` up to `project`. Two
    /// packages can share a bin name, so the `.bin` entry is used only if it resolves there.
    fn find_in_project(
        transpiler: &mut Transpiler,
        cwd: &[u8],
        project: &[u8],
        package_name: &[u8],
        bin_name: &[u8],
        only_that_bin: bool,
    ) -> crate::Result<InProject> {
        let project = strings::without_trailing_slash(project);
        let mut next_dir = Some(cwd);
        while let Some(dir) = next_dir.map(strings::without_trailing_slash) {
            if !dir.starts_with(project) {
                break;
            }
            next_dir = bun_paths::dirname(dir);
            let node_modules = [dir, SEP, b"node_modules", SEP].concat();
            let package_dir = [node_modules.as_slice(), package_name].concat();
            let package_json =
                ZBox::from_vec([package_dir.as_slice(), SEP, b"package.json"].concat());
            let bin =
                match Self::get_bin_from_subpath(transpiler, Fd::cwd(), &package_json, bin_name) {
                    Ok(bin) => bin,
                    Err(err @ crate::Error::NoBinFound) => return Err(err),
                    Err(_) => continue,
                };
            if only_that_bin && *bin.name != *bin_name {
                return Err(crate::Error::NoBinFound);
            }

            let mut buf = bun_paths::path_buffer_pool::get();
            let bin_dir = [node_modules.as_slice(), b".bin"].concat();
            let entry = bun_which::which(&mut buf, &bin_dir, b"", &bin.name)
                .map(|entry| ZBox::from_bytes(entry.as_bytes()));
            // On Windows the `.bin` entry is a shim executable, not a link, and a script cannot be
            // started without it.
            if cfg!(windows) {
                return Ok(entry.map_or(InProject::Absent, InProject::Run));
            }
            let file_path = [package_dir.as_slice(), SEP, &*bin.file].concat();
            let file = bun_which::which(&mut buf, b"", b"", &file_path)
                .map(|file| ZBox::from_bytes(file.as_bytes()));

            let mut real_dir = bun_paths::path_buffer_pool::get();
            let Ok(real_dir) = bun_sys::realpath(&ZBox::from_vec(package_dir), &mut real_dir)
            else {
                return Ok(InProject::Absent);
            };
            let is_in_package = |real: &[u8]| {
                (real.strip_prefix(real_dir)).is_some_and(|rest| rest.starts_with(SEP))
            };
            // The installer links the bin of a package with native builds into an optional dependency,
            // and skips the install script that replaces the package's own file.
            if let Some(entry) = entry
                && let Ok(real) = bun_sys::realpath(&entry, &mut buf)
                && (is_in_package(real)
                    || Self::is_in_platform_package(transpiler, &package_json, real))
            {
                return Ok(InProject::Run(entry));
            }
            let Some(file) = file else {
                return Ok(Self::find_without_executable_file(
                    package_name,
                    file_path,
                    real_dir,
                ));
            };
            return Ok(match bun_sys::realpath(&file, &mut buf) {
                Ok(real) if is_in_package(real) => InProject::Run(file),
                // The file links out of the package.
                _ => InProject::Absent,
            });
        }
        Ok(InProject::Absent)
    }

    /// The project has the package, and the file of its bin is not an executable file.
    #[cold]
    fn find_without_executable_file(
        package_name: &[u8],
        file: Vec<u8>,
        real_dir: &[u8],
    ) -> InProject {
        let mut buf = bun_paths::path_buffer_pool::get();
        let file = ZBox::from_vec(file);
        match bun_sys::realpath(&file, &mut buf) {
            Ok(real) if (real.strip_prefix(real_dir)).is_some_and(|rest| rest.starts_with(SEP)) => {
                InProject::NotExecutable(file)
            }
            // The file links out of the package.
            Ok(_) => InProject::Absent,
            Err(err) => InProject::Unresolved {
                file,
                err,
                is_in_node_modules: (real_dir.strip_suffix(package_name))
                    .is_some_and(|parent| parent.ends_with(b"/node_modules/")),
            },
        }
    }

    /// Whether `real` is in one of the `optionalDependencies` of the package at `package_json` that
    /// has an `os` and a `cpu`. The installer links the bin of a package into no other package.
    fn is_in_platform_package(
        transpiler: &mut Transpiler,
        package_json: &ZStr,
        real: &[u8],
    ) -> bool {
        let dependency_json =
            Self::read_package_json(transpiler, package_json.as_bytes(), |root| {
                let optional = root.get(b"optionalDependencies")?;
                let ExprData::EObjectJSON(optional) = &optional.data else {
                    return None;
                };
                // `node_modules` can be a link to a folder of another name, which is the name in `real`.
                optional.get().properties().iter().find_map(|dependency| {
                    let name = dependency.key.slice();
                    let (parent, _) = strings::rsplit_once(real, &[b"/", name, b"/"].concat())?;
                    Some([parent, b"/", name, b"/package.json"].concat())
                })
            });
        let Some(Some(dependency_json)) = dependency_json else {
            return false;
        };
        Self::read_package_json(transpiler, &dependency_json, |root| {
            root.get(b"os").is_some() && root.get(b"cpu").is_some()
        })
        .unwrap_or(false)
    }

    fn read_package_json<T>(
        transpiler: &mut Transpiler,
        path: &[u8],
        read: impl FnOnce(&bun_ast::Expr) -> T,
    ) -> Option<T> {
        let contents = bun_sys::File::read_from(Fd::cwd(), path).ok()?;
        let source = bun_ast::Source::init_path_string(path, contents.as_slice());
        bun_ast::initialize_store();
        let parsed = json::ParsedJson::parse_package_json(&source, transpiler.log_mut()).ok()?;
        Some(read(&parsed.root))
    }

    fn tree_state(bunx_cache_dir: &[u8]) -> Tree {
        let package_json = [bunx_cache_dir, &[bun_paths::SEP], b"package.json"].concat();
        let stat = match bun_sys::stat(&ZBox::from_vec(package_json)) {
            Ok(stat) => stat,
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => return Tree::Missing,
            Err(_) => return Tree::Stale,
        };
        let age = bun_core::time::timestamp() - bun_sys::stat_mtime(&stat).sec;
        if stat.st_size as u64 <= Self::EMPTY_PACKAGE_JSON.len() as u64
            || age > Self::SECONDS_CACHE_VALID
        {
            return Tree::Stale;
        }
        Tree::Fresh
    }

    fn get_bin_name_from_cache_directory(
        transpiler: &mut Transpiler,
        bunx_cache_dir: &[u8],
        package_name: &[u8],
        preferred: &[u8],
    ) -> crate::Result<Box<[u8]>> {
        let subpath = Self::path_in_cache(&[
            bunx_cache_dir,
            SEP,
            b"node_modules",
            SEP,
            package_name,
            SEP,
            b"package.json",
        ])?;
        Ok(Self::get_bin_from_subpath(transpiler, Fd::cwd(), &subpath, preferred)?.name)
    }

    /// Concatenates raw bytes. Formatting the path would replace invalid UTF-8 and point at a
    /// different directory.
    fn path_in_cache(parts: &[&[u8]]) -> crate::Result<ZBox> {
        let path = parts.concat();
        if path.len() >= bun_paths::MAX_PATH_BYTES {
            return Err(crate::Error::PathTooLong);
        }
        Ok(ZBox::from_vec(path))
    }

    /// `.bunx-<uid>`, owned by this user with mode 0700, is the trust boundary. Nothing below it is
    /// checked. `configured` is the result of `user_cache_directory`.
    #[cfg(unix)]
    fn cache_dir(
        env: &mut bun_dotenv::Loader,
        configured: Option<&[u8]>,
        package_fmt: &[u8],
        create: bool,
    ) -> Option<Vec<u8>> {
        let uid = bun_sys::c::getuid();
        let root_name = cache_root_name();
        let install_cache =
            bun_install::package_manager_real::fetch_cache_directory_path(env, configured)
                .ok()
                .filter(|dir| !dir.is_cwd_fallback);
        // `$TMPDIR` can be relative. It is made absolute because the install runs in a different
        // working directory than this command.
        let mut temp_dir_buf = bun_paths::path_buffer_pool::get();
        let temp_dir = bun_resolver::fs::FileSystem::instance()
            .abs_buf_checked(&[RealFS::platform_temp_dir()], &mut temp_dir_buf[..]);
        let bases = [
            install_cache.as_ref().map(|dir| dir.path.as_slice()),
            temp_dir,
        ];
        for (base, is_shared) in bases.into_iter().zip([false, true]) {
            let Some(base) = base.map(strings::without_trailing_slash) else {
                continue;
            };
            let root = ZBox::from_vec([base, b"/", root_name.as_slice()].concat());
            if create {
                let _ = Fd::cwd().make_path(base);
                let _ = bun_sys::mkdirat(Fd::cwd(), &root, 0o700);
            }
            if !bun_sys::lstat(&root).is_ok_and(|st| {
                (st.st_mode & libc::S_IFMT) == libc::S_IFDIR
                    && st.st_uid == uid
                    && (st.st_mode & 0o077) == 0
            }) {
                continue;
            }
            if create && is_shared {
                bun_core::warn!(
                    "no usable private cache directory, installing into shared temp directory. Set <b>BUN_INSTALL_CACHE_DIR<r> to a directory only you can write."
                );
                // macOS replaces this process with the tool, which would drop anything that's still
                // buffered.
                Output::flush();
            }
            return Some([root.as_bytes(), b"/", package_fmt].concat());
        }
        None
    }

    /// `GetTempPath` is per user.
    #[cfg(windows)]
    fn cache_dir(
        _env: &mut bun_dotenv::Loader,
        _configured: Option<&[u8]>,
        package_fmt: &[u8],
        _create: bool,
    ) -> Option<Vec<u8>> {
        let prefix = format!("\\bunx-{}-", bun_sys::windows::user_unique_id());
        Some([RealFS::platform_temp_dir(), prefix.as_bytes(), package_fmt].concat())
    }

    fn prepend_to_path(
        env: &mut bun_dotenv::Loader,
        bunx_cache_dir: &[u8],
        path: &[u8],
    ) -> crate::Result<()> {
        let mut new_path = [bunx_cache_dir, SEP, b"node_modules", SEP, b".bin"].concat();
        if !path.is_empty() {
            new_path.push(DELIMITER);
            new_path.extend_from_slice(path);
        }
        env.map.put(b"PATH", &new_path)?;
        Ok(())
    }

    fn which_in_cache<'a>(
        buf: &'a mut bun_paths::PathBuffer,
        bunx_cache_dir: &[u8],
        cwd: &[u8],
        bin_name: &[u8],
    ) -> crate::Result<Option<&'a ZStr>> {
        let absolute = Self::path_in_cache(&[
            bunx_cache_dir,
            SEP,
            b"node_modules",
            SEP,
            b".bin",
            SEP,
            bin_name,
            EXE_SUFFIX.as_bytes(),
        ])?;
        Ok(bun_which::which(
            buf,
            bunx_cache_dir,
            cwd,
            absolute.as_bytes(),
        ))
    }

    /// Exits if the package has no bin, because installing it again would not give it one.
    fn exit_if_no_bin<T>(found: crate::Result<T>, package_name: &[u8]) -> crate::Result<T> {
        if matches!(found, Err(crate::Error::NoBinFound)) {
            Output::err_generic(
                "could not determine executable to run for package <b>{}<r>",
                format_args!("{}", BStr::new(package_name)),
            );
            Global::exit(1);
        }
        found
    }

    /// The project has the package, so no other copy of it is run in its place.
    #[cold]
    fn exit_unresolved(
        file: &[u8],
        err: bun_sys::Error,
        is_in_node_modules: bool,
        package_name: &[u8],
    ) -> ! {
        let package_name = BStr::new(package_name);
        Output::err(
            err,
            "could not find the bin of <b>{}<r>: {}",
            (package_name, bun_core::fmt::quote(file)),
        );
        if is_in_node_modules {
            bun_core::note!(
                "run 'bun install --force', or 'bun pm trust {}' and 'bun install' if an install script writes the bin",
                package_name,
            );
        } else {
            bun_core::note!(
                "{} is a package of this project, and its bin is not built",
                package_name,
            );
        }
        Global::exit(1);
    }

    /// Finds the bin in the tree that `bunx` installed. `package_name` is `None` with `--package`,
    /// which, like npx, runs any command: the tree's bins are searched first, and then `path`.
    fn find_in_cache(
        transpiler: &mut Transpiler,
        bunx_cache_dir: &[u8],
        cwd: &[u8],
        initial_bin_name: &[u8],
        package_name: Option<&[u8]>,
        path: &[u8],
    ) -> crate::Result<Option<ZBox>> {
        // The bin's name comes from the package's own package.json, because one of its dependencies
        // can have a bin with the name that the user typed.
        let own_bin_name = package_name.map(|name| {
            let dir = bunx_cache_dir;
            Self::get_bin_name_from_cache_directory(transpiler, dir, name, initial_bin_name)
        });
        let bin_name = match &own_bin_name {
            Some(Ok(own_bin_name)) => &**own_bin_name,
            _ => initial_bin_name,
        };
        let mut buf = bun_paths::path_buffer_pool::get();
        if let Some(bin) = Self::which_in_cache(&mut buf, bunx_cache_dir, cwd, bin_name)? {
            return Ok(Some(ZBox::from_bytes(bin.as_bytes())));
        }
        match own_bin_name {
            Some(Err(err @ crate::Error::NoBinFound)) => Err(err),
            Some(_) => Ok(None),
            None => Ok(bun_which::which(&mut buf, path, cwd, initial_bin_name)
                .map(|bin| ZBox::from_bytes(bin.as_bytes()))),
        }
    }

    fn exit_with_usage() -> ! {
        crate::cli::command::tag_print_help(Command::Tag::BunxCommand, false);
        Global::exit(1);
    }

    pub(crate) fn exec(ctx: &mut ContextData, argv: &[&'static ZStr]) -> crate::Result<()> {
        // Don't log stuff
        ctx.debug.silent = true;

        let opts = Options::parse(ctx, argv)?;

        let mut requests_buf = update_request::Array::with_capacity(64);
        // SAFETY: single-threaded, and `UpdateRequest::parse` consumes `ctx_log` before anything reborrows it.
        let ctx_log = unsafe { ctx.log_mut() };
        let update_requests = UpdateRequest::parse(
            None,
            ctx_log,
            &[opts.package_name],
            &mut requests_buf,
            bun_install::Subcommand::Add,
        );

        if update_requests.is_empty() {
            Self::exit_with_usage();
        }

        debug_assert!(update_requests.len() == 1); // One positional cannot parse to multiple requests
        let update_request = &mut update_requests[0];

        // `bunx tsc` installs TypeScript, then runs tsc.
        if opts.specified_package.is_none() {
            if update_request.name == b"tsc" {
                update_request.name = b"typescript".as_slice();
            } else if update_request.name == b"claude" {
                // The npm package "claude" is an unrelated squatter with no bin.
                update_request.name = b"@anthropic-ai/claude-code".as_slice();
            }
        }

        // The "bar" of `@foo/bar` is only a guess. The package's own `bin` field decides the name,
        // so `bunx @uidotsh/install` must not run /usr/bin/install.
        let mut initial_bin_name_is_a_guess = false;
        let initial_bin_name: &[u8] = if let Some(bin_name) = opts.binary_name {
            bin_name
        } else if update_request.name == b"typescript" {
            b"tsc"
        } else if update_request.name == b"@anthropic-ai/claude-code" {
            b"claude"
        } else if update_request.version.tag == VersionTag::Github {
            update_request
                .version
                .github()
                .repo
                .slice(update_request.version_buf())
        } else if let Some(index) = strings::last_index_of_char(update_request.name, b'/') {
            initial_bin_name_is_a_guess = true;
            &update_request.name[index + 1..]
        } else {
            update_request.name
        };
        bun_output::scoped_log!(bunx, "initial_bin_name: {}", BStr::new(initial_bin_name));

        let mut this_transpiler_slot = ::core::mem::MaybeUninit::<Transpiler<'static>>::uninit();

        let root_dir_info = Run::configure_env_for_run(
            ctx,
            &mut this_transpiler_slot,
            None,
            ConfigureEnvOptions {
                log_errors: true,
                store_root_fd: false,
            },
        )?;
        // SAFETY: `configure_env_for_run` returned `Ok`, so the slot is initialized.
        let this_transpiler = unsafe { this_transpiler_slot.assume_init_mut() };

        let force_using_bun = ctx.debug.run_in_bun;
        Run::configure_path_for_run(
            root_dir_info,
            this_transpiler,
            None,
            root_dir_info.abs_path,
            force_using_bun,
        )?;
        let env_loader = this_transpiler.env_mut();
        env_loader
            .map
            .put(b"npm_command", b"exec")
            .expect("unreachable");
        env_loader
            .map
            .put(b"npm_lifecycle_event", b"bunx")
            .expect("unreachable");
        env_loader
            .map
            .put(b"npm_lifecycle_script", opts.package_name)
            .expect("unreachable");

        if opts.package_name == b"bun-repl" {
            env_loader.map.remove(b"BUN_INSPECT_CONNECT_TO");
            env_loader.map.remove(b"BUN_INSPECT_NOTIFY");
            env_loader.map.remove(b"BUN_INSPECT");
        }

        let ignore_cwd: Vec<u8> = env_loader
            .get(b"BUN_WHICH_IGNORE_CWD")
            .unwrap_or(b"")
            .to_vec();
        if !ignore_cwd.is_empty() {
            env_loader.map.remove(b"BUN_WHICH_IGNORE_CWD");
        }

        let path: Vec<u8> = env_loader.get(b"PATH").unwrap().to_vec();

        let display_version: &[u8] = if update_request.version.literal.is_empty() {
            b"latest"
        } else {
            update_request
                .version
                .literal
                .slice(update_request.version_buf())
        };

        // Includes the delimiters because we use this as a part of $PATH
        #[cfg(windows)]
        const BANNED_PATH_CHARS: &[u8] = b":*?<>|;";
        #[cfg(not(windows))]
        const BANNED_PATH_CHARS: &[u8] = b":";

        // `..` (`pkg@../folder`) would climb out of the cache root.
        let has_banned_char = [update_request.name, display_version].iter().any(|part| {
            strings::index_of_any(part, BANNED_PATH_CHARS).is_some()
                || strings::contains(part, b"..")
        });

        let package_fmt = if has_banned_char {
            // Usually a URL is requested as the package: https://github.com/oven-sh/bun/issues/3675
            format!(
                "{}@{}@{}",
                BStr::new(initial_bin_name),
                <&'static str>::from(update_request.version.tag),
                hash(update_request.name).wrapping_add(hash(display_version)),
            )
        } else {
            format!(
                "{}@{}",
                BStr::new(update_request.name),
                BStr::new(display_version)
            )
        };
        let mut package_fmt: Vec<u8> = package_fmt.into_bytes();
        // Every option that affects a tree's contents is part of its name.
        if opts.trust {
            package_fmt.extend_from_slice(b"+trust");
        }
        if opts.ignore_scripts {
            package_fmt.extend_from_slice(b"+ignore-scripts");
        }
        if let Some(age) = opts.minimum_release_age {
            package_fmt.extend_from_slice(b"+min-age=");
            package_fmt.extend_from_slice(age);
        }
        if let Some(registry) = opts.registry {
            package_fmt.extend_from_slice(format!("+registry={:x}", hash(registry)).as_bytes());
        }
        bun_output::scoped_log!(bunx, "package_fmt: {}", BStr::new(&package_fmt));

        // The `{what}` of 'node_modules/{what}/package.json': without a clear name (URL/GitHub/etc), the bin name.
        let result_package_name: &[u8] = if update_request.name.is_empty() {
            initial_bin_name
        } else {
            update_request.name
        };
        // `@latest` is left out when the user did not type it. Without an explicit tag, `bun add`
        // does not pick the `latest` version if it is deprecated.
        let install_param: Vec<u8> = if update_request.version.literal.is_empty() {
            result_package_name.to_vec()
        } else {
            format!(
                "{}@{}",
                BStr::new(result_package_name),
                BStr::new(display_version),
            )
            .into_bytes()
        };
        bun_output::scoped_log!(bunx, "install_param: {}", BStr::new(&install_param));

        let path_for_bin_dirs: Vec<u8> = if ignore_cwd.is_empty() {
            path.clone()
        } else {
            // Without the cwd passed through BUN_WHICH_IGNORE_CWD: a temp node-gyp script must not find itself.
            let mut new_path: Vec<u8> = Vec::with_capacity(path.len());
            for (i, segment) in strings::tokenize(&path, &[DELIMITER]).enumerate() {
                if !strings::eql_long(
                    strings::without_trailing_slash(segment),
                    strings::without_trailing_slash(&ignore_cwd),
                    true,
                ) {
                    if i > 0 {
                        new_path.push(DELIMITER);
                    }
                    new_path.extend_from_slice(segment);
                }
            }
            new_path
        };

        // SAFETY: `Transpiler::init` always sets `fs` to the process singleton.
        let top_level_dir: &[u8] = unsafe { &*this_transpiler.fs }.top_level_dir();
        let which_cwd: &[u8] = if ignore_cwd.is_empty() {
            top_level_dir
        } else {
            b""
        };

        let passthrough: &[Box<[u8]>] = opts.passthrough_list.as_slice();

        let is_versioned = !update_request.version.literal.is_empty();
        // An explicit dist-tag (`pkg@latest`, `pkg@next`) checks the registry on every run, except
        // with `--no-install`.
        let look_for_existing_bin =
            opts.no_install || !is_versioned || update_request.version.tag != VersionTag::DistTag;
        let package_with_bin = opts.binary_name.is_none().then_some(result_package_name);

        let find_on_path = || {
            let mut buf = bun_paths::path_buffer_pool::get();
            bun_which::which(&mut buf, &path_for_bin_dirs, which_cwd, initial_bin_name)
                .map(|bin| ZBox::from_bytes(bin.as_bytes()))
        };

        // 1. Like npx, when one word names both the package and its bin, look for that bin in
        // `node_modules/.bin` and $PATH.
        if !is_versioned && !initial_bin_name_is_a_guess && opts.binary_name.is_none() {
            if let Some(bin) = find_on_path() {
                Run::run_binary(
                    ctx,
                    bin.as_bytes(),
                    &bin,
                    top_level_dir,
                    env_loader,
                    passthrough,
                    None,
                )?;
            }
            // The project has this command, but it is not executable. Report that instead of
            // downloading a package of the same name.
            for bin_dir in strings::tokenize(&path_for_bin_dirs, &[DELIMITER])
                .filter(|dir| cfg!(unix) && dir.ends_with(b"/node_modules/.bin"))
            {
                let bin = [bin_dir, b"/", initial_bin_name].concat();
                if bun_sys::exists(&bin) {
                    Output::err_generic(
                        "{} is not executable",
                        format_args!("{}", BStr::new(&bin)),
                    );
                    Global::exit(126);
                }
            }
        }

        // 2. The project's installed copy of the package. It is skipped when the user typed a
        // version, a tag, or a URL, because that says where the package must come from.
        if !is_versioned {
            let project = bun_install::package_manager_real::project_directory(top_level_dir);
            let found = match Self::find_in_project(
                this_transpiler,
                top_level_dir,
                project.unwrap_or(top_level_dir),
                result_package_name,
                initial_bin_name,
                opts.binary_name.is_some(),
            ) {
                // Like npx, `--package` runs any command on $PATH once the package is installed.
                Err(crate::Error::NoBinFound) if opts.binary_name.is_some() => {
                    find_on_path().map_or(InProject::Absent, InProject::Run)
                }
                found => {
                    Self::exit_if_no_bin(found, update_request.name).unwrap_or(InProject::Absent)
                }
            };
            match found {
                InProject::Absent => {}
                InProject::Run(bin) => {
                    Run::run_binary(
                        ctx,
                        bin.as_bytes(),
                        &bin,
                        top_level_dir,
                        env_loader,
                        passthrough,
                        None,
                    )?;
                }
                InProject::NotExecutable(file) => {
                    Output::err_generic(
                        "{} is not executable",
                        format_args!("{}", BStr::new(file.as_bytes())),
                    );
                    Global::exit(126);
                }
                InProject::Unresolved {
                    file,
                    err,
                    is_in_node_modules,
                } => Self::exit_unresolved(
                    file.as_bytes(),
                    err,
                    is_in_node_modules,
                    update_request.name,
                ),
            }
        }

        let configured_cache = if cfg!(unix) {
            bun_install::package_manager_real::user_cache_directory(env_loader, top_level_dir)
        } else {
            None
        };
        let configured_cache: Option<&[u8]> = configured_cache.as_deref();

        // 3. The tree that an earlier `bunx` installed, if any. It goes stale after a day, so that
        // `bunx hello` picks up new versions of hello.
        if look_for_existing_bin
            && let Some(bunx_cache_dir) =
                Self::cache_dir(env_loader, configured_cache, &package_fmt, false)
        {
            let tree = Self::tree_state(&bunx_cache_dir);
            let is_fresh = tree == Tree::Fresh;
            if (is_fresh || (opts.no_install && tree != Tree::Missing))
                && let Some(bin) = Self::exit_if_no_bin(
                    Self::find_in_cache(
                        this_transpiler,
                        &bunx_cache_dir,
                        which_cwd,
                        initial_bin_name,
                        package_with_bin,
                        &path_for_bin_dirs,
                    ),
                    update_request.name,
                )?
            {
                if !is_fresh {
                    bun_core::warn!(
                        "Using a stale installation of <b>{}<r> because --no-install was passed. Run `bunx` without --no-install to use a fresh binary.",
                        BStr::new(&update_request.name),
                    );
                }
                Self::prepend_to_path(env_loader, &bunx_cache_dir, &path)?;
                Run::run_binary(
                    ctx,
                    bin.as_bytes(),
                    &bin,
                    top_level_dir,
                    env_loader,
                    passthrough,
                    None,
                )?;
            }
        }

        if opts.no_install {
            Output::err_generic(
                "Could not find an existing '{}' binary to run. Stopping because --no-install was passed.",
                format_args!("{}", BStr::new(initial_bin_name)),
            );
            Global::exit(1);
        }

        // The install cache comes first again, regardless of which root the lookups above found.
        let Some(bunx_cache_dir) =
            Self::cache_dir(env_loader, configured_cache, &package_fmt, true)
        else {
            Output::err_generic(
                "failed to create private cache directory. Set <b>BUN_INSTALL_CACHE_DIR<r> to a directory you own.",
                (),
            );
            Global::exit(1);
        };
        let bunx_cache_dir: &[u8] = &bunx_cache_dir;
        Self::prepend_to_path(env_loader, bunx_cache_dir, &path)?;
        let bunx_install_dir = Fd::cwd().make_open_path(bunx_cache_dir)?;

        // Held during the install and the bin lookups, until exec. If the lock can't be taken,
        // install without it.
        let mut install_lock = InstallLock::acquire(bunx_cache_dir);

        // Checked under the lock, because the process that held it before may have just installed
        // the tree.
        let tree = Self::tree_state(bunx_cache_dir);
        let installed = if tree == Tree::Fresh {
            match Self::find_in_cache(
                this_transpiler,
                bunx_cache_dir,
                which_cwd,
                initial_bin_name,
                package_with_bin,
                &path_for_bin_dirs,
            ) {
                // The version that the dist-tag points to now may have a bin, so install it.
                Err(crate::Error::NoBinFound) if !look_for_existing_bin => None,
                found => Self::exit_if_no_bin(found, update_request.name)?,
            }
        } else {
            None
        };
        if let Some(bin) = installed.as_ref().filter(|_| look_for_existing_bin) {
            drop(install_lock.take());
            Run::run_binary(
                ctx,
                bin.as_bytes(),
                bin,
                top_level_dir,
                env_loader,
                passthrough,
                None,
            )?;
        }

        let write_package_json = |contents: &[u8]| {
            if let Ok(package_json) = bun_sys::File::create(
                bunx_install_dir.fd,
                b"package.json",
                /* truncate */ true,
            ) {
                let _ = package_json.write_all(contents);
            }
        };
        // The package.json of a finished install, if there is one. It is left in place because the
        // tree stays usable until `bun add` starts linking. See `Tree`.
        let finished_package_json = bun_sys::File::read_from(bunx_install_dir.fd, b"package.json")
            .ok()
            .filter(|contents| contents.len() > Self::EMPTY_PACKAGE_JSON.len());
        if finished_package_json.is_none() {
            write_package_json(Self::EMPTY_PACKAGE_JSON);
        }
        if tree == Tree::Stale {
            // The lockfile would pin what the refresh is meant to update: the version within a
            // range and every dependency.
            for lockfile in [bun_core::zstr!("bun.lock"), bun_core::zstr!("bun.lockb")] {
                let _ = bun_sys::unlinkat(bunx_install_dir.fd, lockfile);
            }
        }
        // An install into a fresh tree only updates the requested package, so package.json gets its
        // old mtime back afterward. Otherwise the dependencies' refresh would be postponed again.
        let package_json_path =
            ZBox::from_vec([bunx_cache_dir, &[bun_paths::SEP], b"package.json"].concat());
        let last_refresh = (tree == Tree::Fresh)
            .then(|| bun_sys::stat(&package_json_path).ok())
            .flatten();

        // `bun add` runs in another directory.
        let cafile = opts.cafile.map(|path| {
            bun_paths::resolve_path::join_abs::<bun_paths::platform::Auto>(top_level_dir, path)
                .to_vec()
        });
        let flags_with_value: Vec<Vec<u8>> = [
            (
                b"--minimum-release-age=".as_slice(),
                opts.minimum_release_age,
            ),
            (b"--registry=", opts.registry),
            (b"--cafile=", cafile.as_deref()),
        ]
        .into_iter()
        .chain(opts.ca.iter().map(|ca| (b"--ca=".as_slice(), Some(*ca))))
        .filter_map(|(name, value)| Some([name, value?].concat()))
        .collect();
        let mut args: Vec<&[u8]> = vec![
            bun_core::self_exe_path()?.as_bytes(),
            b"add",
            install_param.as_slice(),
            b"--no-summary",
        ];
        if update_request.version.tag == VersionTag::DistTag || tree == Tree::Stale {
            // No manifest cache, so that @latest is fetched from the registry.
            args.push(b"--no-cache");
        }
        if installed.is_none() {
            // Links every package again, which repairs a killed install.
            args.push(b"--force");
        }
        if opts.verbose_install {
            args.push(b"--verbose");
        }
        if opts.silent_install {
            args.push(b"--silent");
        }
        if opts.trust {
            args.push(b"--trust");
        }
        if opts.ignore_scripts {
            args.push(b"--ignore-scripts");
        }
        args.extend(Global::ca_store_flag().map(|flag| flag.as_bytes()));
        args.extend(flags_with_value.iter().map(Vec::as_slice));

        bun_output::scoped_log!(
            bunx,
            "installing package: {}",
            bun_core::fmt::fmt_slice(&args, " "),
        );
        env_loader
            .map
            .put(b"BUN_INTERNAL_BUNX_INSTALL", bunx_cache_dir)?;
        let has_copy: &[u8] = if finished_package_json.is_some() && look_for_existing_bin {
            b"true"
        } else {
            b"false"
        };
        env_loader
            .map
            .put(b"BUN_INTERNAL_BUNX_HAS_COPY", has_copy)?;

        let envp = env_loader.map.create_null_delimited_env_map()?;

        let spawn_result = match proc_sync::spawn(&proc_sync::Options {
            argv: args.iter().map(|s| Box::<[u8]>::from(*s)).collect(),
            envp: Some(envp.as_ptr().cast::<*const ::core::ffi::c_char>()),
            cwd: Box::<[u8]>::from(bunx_cache_dir),
            stderr: proc_sync::SyncStdio::Inherit,
            stdout: proc_sync::SyncStdio::Inherit,
            stdin: proc_sync::SyncStdio::Inherit,

            #[cfg(windows)]
            windows: proc_sync::WindowsOptions {
                loop_: bun_jsc::EventLoopHandle::init_mini(
                    bun_event_loop::MiniEventLoop::init_global(
                        // SAFETY: a reborrow through the live `env_loader`, not a second `env_mut()` aliasing it.
                        Some(unsafe { &mut *(env_loader as *mut _) }),
                        None,
                    ),
                ),
                ..Default::default()
            },
            ..Default::default()
        }) {
            Err(err) => {
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: bunx failed to install <b>{}<r> due to error <b>{}<r>",
                    bun_core::fmt::for_terminal(BStr::new(&install_param)),
                    err.name(),
                );
                Global::exit(1);
            }
            Ok(Err(_)) => Global::exit(1),
            Ok(Ok(result)) => result,
        };

        // These are only for the install. A `bunx` or `bun install` that the tool itself runs must
        // not inherit them.
        env_loader.map.remove(b"BUN_INTERNAL_BUNX_INSTALL");
        env_loader.map.remove(b"BUN_INTERNAL_BUNX_HAS_COPY");

        /// Takes the raw byte, because `signal_code()` would drop real-time signals (>31).
        fn raise(signal: u8) -> ! {
            if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN
                .get()
                .unwrap_or(false)
            {
                bun_crash_handler::suppress_reporting();
            }
            Global::raise_ignoring_panic_handler_raw(core::ffi::c_int::from(signal))
        }

        match &spawn_result.status {
            SpawnStatus::Exited(exited) => {
                if exited.signal != 0 {
                    raise(exited.signal);
                }

                use bun_install::package_manager_real::run_tasks::BUNX_REGISTRY_UNREACHABLE;
                match (exited.code as u32, &finished_package_json) {
                    (0, _) => {
                        if let Some(stat) = &last_refresh {
                            let [atime, mtime] =
                                [bun_sys::stat_atime(stat), bun_sys::stat_mtime(stat)].map(
                                    |time| bun_sys::TimeLike {
                                        sec: time.sec,
                                        nsec: time.nsec,
                                    },
                                );
                            let _ = bun_sys::utimens(&package_json_path, atime, mtime);
                        }
                    }
                    (BUNX_REGISTRY_UNREACHABLE, Some(package_json)) if look_for_existing_bin => {
                        // Rewriting package.json marks the tree as fresh. Otherwise every run
                        // without a network connection would first wait for another failed attempt.
                        write_package_json(package_json);
                        bun_core::warn!(
                            "registry unreachable, using cached <b>{}<r>",
                            BStr::new(&update_request.name),
                        );
                    }
                    (BUNX_REGISTRY_UNREACHABLE, _) => Global::exit(1),
                    (code, _) => Global::exit(code),
                }
            }
            SpawnStatus::Signaled(sig) => raise(*sig),
            SpawnStatus::Err(err) => {
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: bunx failed to install <b>{}<r> due to error:\n{}",
                    bun_core::fmt::for_terminal(BStr::new(&install_param)),
                    err,
                );
                Global::exit(1);
            }
            _ => {}
        }

        if let Some(bin) = Self::exit_if_no_bin(
            Self::find_in_cache(
                this_transpiler,
                bunx_cache_dir,
                which_cwd,
                initial_bin_name,
                package_with_bin,
                &path_for_bin_dirs,
            ),
            update_request.name,
        )? {
            drop(install_lock.take());
            Run::run_binary(
                ctx,
                bin.as_bytes(),
                &bin,
                top_level_dir,
                env_loader,
                passthrough,
                None,
            )?;
        }

        if let (Some(_), Some(binary_name)) = (opts.specified_package, opts.binary_name) {
            Output::err_generic(
                "Package <b>{}<r> does not provide a binary named <b>{}<r>",
                (BStr::new(&update_request.name), BStr::new(binary_name)),
            );
            bun_core::prettyln!(
                "  <d>hint: try running without --package to install and run {} directly<r>",
                BStr::new(binary_name),
            );
        } else {
            Output::err_generic(
                "could not determine executable to run for package <b>{}<r>",
                format_args!("{}", BStr::new(&update_request.name)),
            );
        }
        Global::exit(1);
    }
}
