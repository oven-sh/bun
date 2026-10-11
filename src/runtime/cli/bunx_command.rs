//! `bun x` / `bunx`: resolves a package's executable — installing it into a
//! shared cache when not already present — and execs it with the given args.

use std::io::Write as _;

use bstr::BStr;

use crate::cli::command::ContextData;
use crate::cli::{self, Command};
use crate::run_command::{ConfigureEnvOptions, RunCommand as Run};

use bun_alloc::AllocError;
use bun_ast::ExprData;
use bun_bundler::Transpiler;
use bun_core::{self, Global, Output};
use bun_core::{ZBox, ZStr, strings};
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

pub(crate) struct BunxCommand;

/// `flock` on `<bunx cache dir>.lock`, next to (not inside) the tree: exclusive while installing, probed shared
/// before running out of it. CLOEXEC, so exec'ing the target releases it too.
struct InstallLock {
    _file: bun_sys::File,
}

impl InstallLock {
    /// `None` when the lock cannot be taken, or is held elsewhere and `nonblocking`.
    fn acquire(
        bunx_cache_dir: &[u8],
        mode: bun_sys::FileLockMode,
        nonblocking: bool,
    ) -> Option<Self> {
        let path = ZBox::from_bytes([bunx_cache_dir, b".lock"].concat());
        let flags = O::CREAT | O::RDWR | O::CLOEXEC | O::NOFOLLOW;
        let file = bun_sys::File::from_fd(bun_sys::openat(Fd::cwd(), &path, flags, 0o600).ok()?);
        bun_sys::flock(file.fd(), mode, nonblocking)
            .ok()?
            .then_some(Self { _file: file })
    }

    /// Whether another `bun x` is installing into `bunx_cache_dir` right now (its tree is partial).
    fn install_in_progress(bunx_cache_dir: &[u8]) -> bool {
        let busy = Self::acquire(bunx_cache_dir, bun_sys::FileLockMode::Shared, true).is_none();
        if busy {
            bun_output::scoped_log!(
                bunx,
                "install in progress for {}, waiting",
                BStr::new(bunx_cache_dir)
            );
        }
        busy
    }
}

/// What `<bunx cache dir>/package.json` says about the tree beside it. bunx writes
/// [`BunxCommand::EMPTY_PACKAGE_JSON`] there before every install and `bun add` replaces that only once
/// everything is linked, so its size tells a finished install from a killed or failed one and its mtime is
/// when that install ran. The installed files cannot tell: they are hard links into the install cache, whose
/// mtime no install renews.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Tree {
    Missing,
    /// Unfinished, or older than [`BunxCommand::SECONDS_CACHE_VALID`].
    Stale,
    Fresh,
}

/// The directory in the install cache (or the temp directory) that holds every tree of this user; see
/// [`BunxCommand::cache_dir`]. `bun pm cache rm` sweeps it: both spell the name from here. Windows has none.
pub(crate) fn cache_root_name() -> Vec<u8> {
    #[cfg(unix)]
    let uid = bun_sys::c::getuid();
    #[cfg(windows)]
    let uid = bun_sys::windows::user_unique_id();
    format!(".bunx-{uid}").into_bytes()
}

/// How many packages `<base>/.bunx-<uid>` holds. The packages of one scope count as one.
pub(crate) fn count_cached_packages(base: &[u8]) -> usize {
    const SEP: &[u8] = &[bun_paths::SEP];
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
//
// Invariant: string fields borrow from `argv`, which is process-lifetime —
// that is what makes the `&'static [u8]` typing sound here.
#[derive(Default)]
pub(crate) struct Options {
    /// CLI arguments to pass to the command being run.
    // `Box<[u8]>` to match `ContextData::passthrough` /
    // `Run::run_binary`'s `&[Box<[u8]>]` param.
    pub(crate) passthrough_list: Vec<Box<[u8]>>,
    /// `bunx <package_name>`
    pub(crate) package_name: &'static [u8],
    /// The binary name to run (when using --package)
    pub(crate) binary_name: Option<&'static [u8]>,
    /// The package to install (when using --package)
    pub(crate) specified_package: Option<&'static [u8]>,
    // `--silent` and `--verbose` are not mutually exclusive. Both the
    // global CLI parser and `bun add` parser use them for different
    // purposes.
    pub(crate) verbose_install: bool,
    pub(crate) silent_install: bool,
    /// Skip installing the package, only running the target command if its
    /// already downloaded. If its not, `bunx` exits with an error.
    pub(crate) no_install: bool,
    /// `bun add --trust`: the lifecycle scripts of the package and of everything it depends on run.
    pub(crate) trust: bool,
    /// Seconds, as typed: forwarded to `bun add` and part of the cache directory's name.
    pub(crate) minimum_release_age: Option<&'static [u8]>,
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

    /// Create a new `Options` instance by parsing CLI arguments. `ctx` may be mutated.
    ///
    /// ## Exits
    /// - `--revision` or `--version` flags are passed without a target
    ///   command also being provided. This is not a failure.
    /// - Incorrect arguments are passed. Prints usage and exits with a failure code.
    fn parse(ctx: &mut ContextData, argv: &[&'static ZStr]) -> Result<Options, AllocError> {
        let mut found_subcommand_name = false;
        let mut maybe_package_name: Option<&'static [u8]> = None;
        let mut has_version = false; //  --version
        let mut has_revision = false; // --revision
        let mut i: usize = 0;

        // SAFETY: `opts` is only ever returned when a package name is found, otherwise the process exits.
        let mut opts = Options {
            package_name: b"",
            ..Default::default()
        };
        opts.passthrough_list.reserve_exact(argv.len());

        // `BUN_OPTIONS` is for every command: what bunx does not know there is not for it.
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
                } else if positional == b"--no-install" {
                    opts.no_install = true;
                } else if positional == b"--package" || positional == b"-p" {
                    // Next argument should be the package name
                    i += 1;
                    if i >= argv.len() {
                        Output::err_generic("--package requires a package name", format_args!(""));
                        Global::exit(1);
                    }
                    if argv[i].as_bytes().is_empty() {
                        Output::err_generic(
                            "--package requires a non-empty package name",
                            format_args!(""),
                        );
                        Global::exit(1);
                    }
                    opts.specified_package = Some(argv[i].as_bytes());
                } else if positional.starts_with(b"--package=") {
                    let package_value = &positional[b"--package=".len()..];
                    if package_value.is_empty() {
                        Output::err_generic(
                            "--package requires a non-empty package name",
                            format_args!(""),
                        );
                        Global::exit(1);
                    }
                    opts.specified_package = Some(package_value);
                } else if positional.starts_with(b"-p=") {
                    let package_value = &positional[b"-p=".len()..];
                    if package_value.is_empty() {
                        Output::err_generic(
                            "--package requires a non-empty package name",
                            format_args!(""),
                        );
                        Global::exit(1);
                    }
                    opts.specified_package = Some(package_value);
                } else if positional == b"--trust" {
                    opts.trust = true;
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
                    // The whole value, as for `bun add`: it names a directory.
                    if bun_core::fmt::parse_seconds(age).is_none() {
                        Output::err_generic(
                            "Expected --minimum-release-age to be a positive number: {}",
                            (BStr::new(age),),
                        );
                        Global::exit(1);
                    }
                    opts.minimum_release_age = Some(age);
                } else if positional == b"--help" || positional == b"-h" {
                    crate::cli::command::tag_print_help(Command::Tag::BunxCommand, false);
                    Global::exit(0);
                } else if !matches!(positional, b"--" | b"--yes" | b"-y")
                    && !is_from_bun_options(argv[i])
                {
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

        // Handle --package flag case differently
        if let Some(specified_package) = opts.specified_package {
            if let Some(package_name) = maybe_package_name {
                if package_name.is_empty() {
                    Output::err_generic(
                        "When using --package, you must specify the binary to run",
                        format_args!(""),
                    );
                    bun_core::prettyln!(
                        "  <d>usage: bunx --package=\\<package-name\\> \\<binary-name\\> [args...]<r>"
                    );
                    Global::exit(1);
                }
            } else {
                Output::err_generic(
                    "When using --package, you must specify the binary to run",
                    format_args!(""),
                );
                bun_core::prettyln!(
                    "  <d>usage: bunx --package=\\<package-name\\> \\<binary-name\\> [args...]<r>"
                );
                Global::exit(1);
            }
            opts.binary_name = maybe_package_name;
            opts.package_name = specified_package;
        } else {
            // Normal case: package_name is the first non-flag argument
            if maybe_package_name.is_none() || maybe_package_name.unwrap().is_empty() {
                // no need to free memory b/c we're exiting
                if has_revision {
                    cli::print_revision_and_exit();
                } else if has_version {
                    cli::print_version_and_exit();
                } else {
                    BunxCommand::exit_with_usage();
                }
            }
            opts.package_name = maybe_package_name.unwrap();
        }
        Ok(opts)
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GetBinNameError {
    #[error("NoBinFound")]
    NoBinFound,
    #[error("NeedToInstall")]
    NeedToInstall,
}

impl BunxCommand {
    /// Adds `create-` to the string, but also handles scoped packages correctly.
    /// Always clones the string in the process.
    ///
    /// Returns an owned NUL-terminated string.
    pub(crate) fn add_create_prefix(input: &[u8]) -> Result<bun_core::ZBox, AllocError> {
        const PREFIX_LENGTH: usize = b"create-".len();

        if input.is_empty() {
            return Ok(bun_core::ZBox::default());
        }

        // +1 for the trailing NUL sentinel; vec! zero-initializes so the last byte stays 0.
        let mut new_str = vec![0u8; input.len() + PREFIX_LENGTH + 1];
        if input[0] == b'@' {
            // @org/some -> @org/create-some
            // @org/some@v -> @org/create-some@v
            if let Some(slash_i) = strings::index_of_char(input, b'/') {
                let index = usize::try_from(slash_i + 1).expect("int cast");
                new_str[0..index].copy_from_slice(&input[0..index]);
                new_str[index..index + PREFIX_LENGTH].copy_from_slice(b"create-");
                new_str[index + PREFIX_LENGTH..input.len() + PREFIX_LENGTH]
                    .copy_from_slice(&input[index..]);
                return Ok(bun_core::ZBox::from_vec_with_nul(new_str));
            }
            // @org@v -> @org/create@v
            else if let Some(at_i) = strings::index_of_char(&input[1..], b'@') {
                let index = usize::try_from(at_i + 1).expect("int cast");
                new_str[0..index].copy_from_slice(&input[0..index]);
                new_str[index..index + PREFIX_LENGTH].copy_from_slice(b"/create");
                new_str[index + PREFIX_LENGTH..input.len() + PREFIX_LENGTH]
                    .copy_from_slice(&input[index..]);
                return Ok(bun_core::ZBox::from_vec_with_nul(new_str));
            }
            // @org -> @org/create
            else {
                new_str[0..input.len()].copy_from_slice(input);
                new_str[input.len()..input.len() + PREFIX_LENGTH].copy_from_slice(b"/create");
                return Ok(bun_core::ZBox::from_vec_with_nul(new_str));
            }
        }

        new_str[0..PREFIX_LENGTH].copy_from_slice(b"create-");
        new_str[PREFIX_LENGTH..input.len() + PREFIX_LENGTH].copy_from_slice(input);

        Ok(bun_core::ZBox::from_vec_with_nul(new_str))
    }

    /// 1 day
    const SECONDS_CACHE_VALID: i64 = 60 * 60 * 24;

    const EMPTY_PACKAGE_JSON: &[u8] = b"{}\n";

    /// `bin` keys (and the `name` fallback) in package.json are command
    /// names, not paths. A published package.json could yield a key like
    /// `../../../../tmp/x` or `/tmp/x`; `bun_which::which` resolves
    /// slash-containing names against the cwd, escaping `node_modules/.bin`.
    /// Reject anything that isn't a plain file name.
    fn is_safe_bin_name(name: &[u8]) -> bool {
        !name.is_empty()
            && name != b"."
            && name != b".."
            && strings::index_of_char(name, b'/').is_none()
            && strings::index_of_char(name, b'\\').is_none()
    }

    fn get_bin_name_from_subpath(
        transpiler: &mut Transpiler,
        dir_fd: Fd,
        subpath_z: &ZStr,
    ) -> crate::Result<Box<[u8]>> {
        let target_package_json_fd = bun_sys::openat(dir_fd, subpath_z, O::RDONLY, 0)?;
        let target_package_json = bun_sys::File::from_fd(target_package_json_fd);

        // TODO: make this better
        let package_json_bytes = target_package_json.read_to_end()?;
        let package_json_contents = package_json_bytes.as_slice();
        let source = bun_ast::Source::init_path_string(subpath_z.as_bytes(), package_json_contents);

        bun_ast::initialize_store();

        let log = transpiler.log_mut();
        let parsed = json::ParsedJson::parse_package_json(&source, log)?;
        let expr = parsed.root;

        // choose the first package that fits
        if let Some(bin_expr) = expr.get(b"bin") {
            match &bin_expr.data {
                ExprData::EObjectJSON(object) => {
                    for prop in object.get().properties() {
                        let bin_name = prop.key.slice();
                        // Same values the bin linker does not link (`bin.rs`).
                        let is_linked = prop.value.as_str().is_some_and(|target| {
                            !target.is_empty()
                                && !bun_install::bin::bin_target_escapes_package_dir(target)
                        });
                        if !is_linked || !Self::is_safe_bin_name(bin_name) {
                            continue;
                        }
                        return Ok(Box::<[u8]>::from(bin_name));
                    }
                }
                ExprData::EString(_) => {
                    if let Some(name_expr) = expr.get(b"name") {
                        if let Some(name) = name_expr.as_utf8_string_literal() {
                            // A scoped `name` (`@scope/pkg`) is legitimate here;
                            // the command name is its unscoped portion.
                            let bin_name = if name.is_empty() {
                                name
                            } else {
                                bun_install::dependency::unscoped_package_name(name)
                            };
                            if Self::is_safe_bin_name(bin_name) {
                                return Ok(Box::<[u8]>::from(bin_name));
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        if let Some(dirs) = expr.as_property(b"directories") {
            if let Some(bin_prop) = dirs.expr.as_property(b"bin") {
                // Same values the bin linker refuses to link from (`bin.rs`, `Tag::Dir`).
                if let Some(dir_name) = bin_prop.expr.as_utf8_string_literal().filter(|dir| {
                    !dir.is_empty() && !bun_install::bin::bin_target_escapes_package_dir(dir)
                }) {
                    use bun_paths::{platform::Auto, resolve_path::dirname, resolve_path::join_z};
                    // `directories.bin` is relative to the package, not to `dir_fd`.
                    let path = join_z::<Auto>(&[dirname::<Auto>(subpath_z.as_bytes()), dir_name]);
                    let bin_dir = bun_sys::openat(dir_fd, path, O::RDONLY | O::DIRECTORY, 0)?;
                    // Fd is non-owning Copy; guard it.
                    let _close_bin_dir = bun_sys::CloseOnDrop::new(bin_dir);
                    let mut iterator = bun_sys::dir_iterator::iterate(bin_dir);
                    let mut entry = iterator.next();
                    loop {
                        let current = match entry {
                            bun_sys::Result::Err(_) => break,
                            bun_sys::Result::Ok(result) => match result {
                                Some(r) => r,
                                None => break,
                            },
                        };

                        if current.kind == bun_sys::EntryKind::File {
                            if current.name.slice().is_empty() {
                                entry = iterator.next();
                                continue;
                            }
                            return Ok(Box::<[u8]>::from(current.name.slice_u8()));
                        }

                        entry = iterator.next();
                    }
                }
            }
        }

        Err(crate::Error::NoBinFound)
    }

    fn get_bin_name_from_project_directory(
        transpiler: &mut Transpiler,
        dir_fd: Fd,
        package_name: &[u8],
    ) -> crate::Result<Box<[u8]>> {
        let mut subpath = bun_paths::path_buffer_pool::get();
        let subpath_z = bun_core::fmt::buf_print_z(
            &mut subpath[..],
            format_args!(
                "node_modules{sep}{pkg}{sep}package.json",
                sep = bun_paths::SEP as char,
                pkg = BStr::new(package_name),
            ),
        )
        .map_err(|_| crate::Error::PathTooLong)?;
        Self::get_bin_name_from_subpath(transpiler, dir_fd, subpath_z)
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
    ) -> crate::Result<Box<[u8]>> {
        let mut subpath = bun_paths::path_buffer_pool::get();
        let subpath_z = bun_core::fmt::buf_print_z(
            &mut subpath[..],
            format_args!(
                "{cache}{sep}node_modules{sep}{pkg}{sep}package.json",
                cache = BStr::new(bunx_cache_dir),
                sep = bun_paths::SEP as char,
                pkg = BStr::new(package_name),
            ),
        )
        .map_err(|_| crate::Error::PathTooLong)?;
        Self::get_bin_name_from_subpath(transpiler, Fd::cwd(), subpath_z)
    }

    /// Check the enclosing package.json for a matching "bin"
    /// If not found, check bunx cache dir
    fn get_bin_name(
        transpiler: &mut Transpiler,
        toplevel_fd: Fd,
        bunx_cache_dir: Option<&[u8]>,
        package_name: &[u8],
    ) -> Result<Box<[u8]>, GetBinNameError> {
        debug_assert!(toplevel_fd.is_valid());
        match Self::get_bin_name_from_project_directory(transpiler, toplevel_fd, package_name) {
            Ok(v) => Ok(v),
            Err(err) => {
                if matches!(err, crate::Error::NoBinFound) {
                    return Err(GetBinNameError::NoBinFound);
                }

                let Some(bunx_cache_dir) =
                    bunx_cache_dir.filter(|dir| Self::tree_state(dir) == Tree::Fresh)
                else {
                    return Err(GetBinNameError::NeedToInstall);
                };
                match Self::get_bin_name_from_cache_directory(
                    transpiler,
                    bunx_cache_dir,
                    package_name,
                ) {
                    Ok(v) => Ok(v),
                    Err(err2) => {
                        if matches!(err2, crate::Error::NoBinFound) {
                            return Err(GetBinNameError::NoBinFound);
                        }

                        Err(GetBinNameError::NeedToInstall)
                    }
                }
            }
        }
    }

    /// The directory `package_fmt` is installed into:
    ///
    /// ```text
    /// <install cache>/.bunx-<uid>/<package_fmt>/node_modules/.bin/<bin>
    /// ```
    ///
    /// - `require`, the dynamic loader (a `DT_RUNPATH` with `..`) and the tsconfig lookup walk from an
    ///   installed file toward `/` and take what they find, so every ancestor has to belong to this user or
    ///   to root. Below the temp directory, where any user can create `node_modules`, that does not hold: it
    ///   is only used, with a warning, when there is no install cache to write to.
    /// - `.bunx-<uid>` is the trust boundary: a directory of this user with mode 0700. Nobody else can
    ///   create, replace or even look up anything below it, so nothing below it is checked.
    ///
    /// Writes nothing unless `create` (a run that installs). `None` when no candidate holds such a directory.
    ///
    /// If this format changes, please update cache clearing code in package_manager_command.rs
    #[cfg(unix)]
    fn cache_dir(
        env: &mut bun_dotenv::Loader,
        package_fmt: &[u8],
        create: bool,
    ) -> Option<Vec<u8>> {
        let uid = bun_sys::c::getuid();
        let root_name = cache_root_name();
        let install_cache =
            bun_install::package_manager_real::fetch_cache_directory_path(env, None)
                .ok()
                .filter(|dir| !dir.is_cwd_fallback);
        let bases = [
            install_cache.as_ref().map(|dir| dir.path.as_slice()),
            Some(RealFS::platform_temp_dir()),
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
                    "bunx is installing into the shared temp directory because no cache directory of your own is usable. Set <b>BUN_INSTALL_CACHE_DIR<r> to a directory only you can write."
                );
                // macOS replaces this process with the tool, which drops what is still buffered.
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
        package_fmt: &[u8],
        _create: bool,
    ) -> Option<Vec<u8>> {
        let prefix = format!("\\bunx-{}-", bun_sys::windows::user_unique_id());
        Some([RealFS::platform_temp_dir(), prefix.as_bytes(), package_fmt].concat())
    }

    /// The bins of the tree come first in the `$PATH` of what runs out of it.
    fn prepend_to_path(
        env: &mut bun_dotenv::Loader,
        bunx_cache_dir: &[u8],
        path: &[u8],
    ) -> crate::Result<()> {
        const SEP: &[u8] = &[bun_paths::SEP];
        let mut new_path = [bunx_cache_dir, SEP, b"node_modules", SEP, b".bin"].concat();
        if !path.is_empty() {
            new_path.push(DELIMITER);
            new_path.extend_from_slice(path);
        }
        env.map.put(b"PATH", &new_path)?;
        Ok(())
    }

    /// `<bunx cache dir>/node_modules/.bin/<bin_name>`, if that is an executable.
    fn which_in_cache<'a>(
        buf: &'a mut bun_paths::PathBuffer,
        bunx_cache_dir: &[u8],
        cwd: &[u8],
        bin_name: &[u8],
    ) -> crate::Result<Option<&'a ZStr>> {
        let mut absolute_buf = bun_paths::path_buffer_pool::get();
        let absolute = bun_core::fmt::buf_print_z(
            &mut absolute_buf[..],
            format_args!(
                "{cache}{sep}node_modules{sep}.bin{sep}{bin}{exe}",
                cache = BStr::new(bunx_cache_dir),
                sep = bun_paths::SEP as char,
                bin = BStr::new(bin_name),
                exe = EXE_SUFFIX,
            ),
        )
        .map_err(|_| crate::Error::PathTooLong)?;
        Ok(bun_which::which(
            buf,
            bunx_cache_dir,
            cwd,
            absolute.as_bytes(),
        ))
    }

    /// What to run out of the tree: the bin called `initial_bin_name`, else the one the package.json of
    /// `package_name` declares (`None` with `--package`, which names the bin).
    fn find_in_cache(
        transpiler: &mut Transpiler,
        bunx_cache_dir: &[u8],
        cwd: &[u8],
        initial_bin_name: &[u8],
        package_name: Option<&[u8]>,
    ) -> crate::Result<Option<ZBox>> {
        let mut buf = bun_paths::path_buffer_pool::get();
        if let Some(bin) = Self::which_in_cache(&mut buf, bunx_cache_dir, cwd, initial_bin_name)? {
            return Ok(Some(ZBox::from_bytes(bin.as_bytes())));
        }
        let Some(Ok(bin_name)) = package_name
            .map(|name| Self::get_bin_name_from_cache_directory(transpiler, bunx_cache_dir, name))
        else {
            return Ok(None);
        };
        if strings::eql_long(&bin_name, initial_bin_name, true) {
            return Ok(None);
        }
        Ok(
            Self::which_in_cache(&mut buf, bunx_cache_dir, cwd, &bin_name)?
                .map(|bin| ZBox::from_bytes(bin.as_bytes())),
        )
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
        // SAFETY: CLI dispatch is single-threaded and `ctx_log` is consumed by
        // `UpdateRequest::parse` immediately below; it is not held across any
        // call that may itself reborrow the same `Log`.
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

        // if you type "tsc" and TypeScript is not installed:
        // 1. Install TypeScript
        // 2. Run tsc
        // BUT: Skip this transformation if --package was explicitly specified
        if opts.specified_package.is_none() {
            if update_request.name == b"tsc" {
                update_request.name = b"typescript".as_slice();
            } else if update_request.name == b"claude" {
                // The npm package "claude" is an unrelated squatter with no bin;
                // `bunx claude` is much more likely to mean the actual CLI.
                update_request.name = b"@anthropic-ai/claude-code".as_slice();
            }
        }

        // When the user types a scoped package like `@foo/bar`, the initial bin
        // name ("bar") is only a guess — the package's actual bin may be named
        // something else entirely. In that case we must not search the original
        // system $PATH with the guessed name, or we may match an unrelated system
        // binary (e.g. `bunx @uidotsh/install` would otherwise run /usr/bin/install).
        // We still search local node_modules/.bin directories, since many scoped
        // packages do link their bin under the unscoped name.
        //
        // Only the branch that strips the scope from the package name is a guess;
        // explicit `--package` bins and hardcoded aliases like `tsc`/`claude` are
        // known-good bin names and should still be searchable in the system $PATH.
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

        // fast path: they're actually using this interchangeably with `bun run`
        // so we use Bun.which to check
        let mut this_transpiler_slot = ::core::mem::MaybeUninit::<Transpiler<'static>>::uninit();
        let mut original_path: Vec<u8> = Vec::new();

        let root_dir_info = Run::configure_env_for_run(
            ctx,
            &mut this_transpiler_slot,
            None,
            ConfigureEnvOptions {
                log_errors: true,
                store_root_fd: true,
            },
        )?;
        // SAFETY: `configure_env_for_run` returned `Ok`, so the slot is fully
        // initialized via `MaybeUninit::write`.
        let this_transpiler = unsafe { this_transpiler_slot.assume_init_mut() };

        let force_using_bun = ctx.debug.run_in_bun;
        Run::configure_path_for_run(
            ctx,
            root_dir_info,
            this_transpiler,
            Some(&mut original_path),
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
        // Cloned to drop the borrow on `env_loader.map` before mutating it.

        if !ignore_cwd.is_empty() {
            env_loader.map.remove(b"BUN_WHICH_IGNORE_CWD");
        }

        let path: Vec<u8> = env_loader.get(b"PATH").unwrap().to_vec();

        // `configurePathForRun` builds PATH by appending ORIGINAL_PATH to a set of
        // `*/node_modules/.bin` directories (plus the bun-node shim dir). Capture just
        // that prepended portion here — it is used below to search for guessed bin
        // names without risking a collision with an unrelated binary in the user's
        // system $PATH. A trailing delimiter may remain; `bun.which` tokenizes on the
        // delimiter so empty segments are ignored.
        let local_bin_dirs: Vec<u8> =
            if !original_path.is_empty() && strings::ends_with(&path, &original_path) {
                path[0..path.len() - original_path.len()].to_vec()
            } else {
                path.clone()
            };
        // Cloned to avoid borrowck overlap when PATH is reassigned below.

        let display_version: &[u8] = if update_request.version.literal.is_empty() {
            b"latest"
        } else {
            update_request
                .version
                .literal
                .slice(update_request.version_buf())
        };

        // package_fmt is used for the path to install in.
        let package_fmt: Vec<u8> = 'brk: {
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

            let mut v = Vec::new();
            if has_banned_char {
                // This branch gets hit usually when a URL is requested as the package
                // See https://github.com/oven-sh/bun/issues/3675
                //
                // But the requested version will contain the url.
                // The colon will break all platforms.
                write!(
                    &mut v,
                    "{}@{}@{}",
                    BStr::new(initial_bin_name),
                    <&'static str>::from(update_request.version.tag),
                    hash(update_request.name).wrapping_add(hash(display_version)),
                )
                .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?;
            } else {
                write!(
                    &mut v,
                    "{}@{}",
                    BStr::new(&update_request.name),
                    BStr::new(display_version),
                )
                .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?;
            }
            // What decides the content of a tree is part of its name: a run with one of these flags is never
            // served a tree that was installed without it.
            if opts.trust {
                v.extend_from_slice(b"+trust");
            }
            if let Some(age) = opts.minimum_release_age {
                v.extend_from_slice(b"+min-age=");
                v.extend_from_slice(age);
            }
            break 'brk v;
        };
        bun_output::scoped_log!(bunx, "package_fmt: {}", BStr::new(&package_fmt));

        // install_param -> used in command 'bun install {what}'
        // result_package_name -> used for path 'node_modules/{what}/package.json'
        let (install_param, result_package_name): (Vec<u8>, &[u8]) =
            if !update_request.name.is_empty() {
                let mut v = Vec::new();
                write!(
                    &mut v,
                    "{}@{}",
                    BStr::new(&update_request.name),
                    BStr::new(display_version),
                )
                .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?;
                (v, update_request.name)
            } else {
                // When there is not a clear package name (URL/GitHub/etc), we force the package name
                // to be the same as the calculated initial bin name. This allows us to have a predictable
                // node_modules folder structure.
                let mut v = Vec::new();
                write!(
                    &mut v,
                    "{}@{}",
                    BStr::new(initial_bin_name),
                    BStr::new(display_version),
                )
                .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?;
                (v, initial_bin_name)
            };
        bun_output::scoped_log!(bunx, "install_param: {}", BStr::new(&install_param));
        bun_output::scoped_log!(
            bunx,
            "result_package_name: {}",
            BStr::new(result_package_name)
        );

        let path_for_bin_dirs: Vec<u8> = 'brk: {
            if ignore_cwd.is_empty() {
                break 'brk path.clone();
            }

            // Remove the cwd passed through BUN_WHICH_IGNORE_CWD from path. This prevents temp node-gyp script from finding and running itself
            let mut new_path: Vec<u8> = Vec::with_capacity(path.len());
            let mut path_iter = strings::tokenize(&path, &[DELIMITER]);
            if let Some(segment) = path_iter.next() {
                if !strings::eql_long(
                    strings::without_trailing_slash(segment),
                    strings::without_trailing_slash(&ignore_cwd),
                    true,
                ) {
                    new_path.extend_from_slice(segment);
                }
            }
            while let Some(segment) = path_iter.next() {
                if !strings::eql_long(
                    strings::without_trailing_slash(segment),
                    strings::without_trailing_slash(&ignore_cwd),
                    true,
                ) {
                    new_path.push(DELIMITER);
                    new_path.extend_from_slice(segment);
                }
            }

            break 'brk new_path;
        };

        // `None`: bunx has not installed anything yet, so there is nothing to look for in its cache.
        let existing_cache_dir = Self::cache_dir(env_loader, &package_fmt, false);
        let existing_cache_dir: Option<&[u8]> = existing_cache_dir.as_deref();
        if let Some(bunx_cache_dir) = existing_cache_dir {
            Self::prepend_to_path(env_loader, bunx_cache_dir, &path)?;
            bun_output::scoped_log!(bunx, "bunx_cache_dir: {}", BStr::new(bunx_cache_dir));
        }

        // SAFETY: `Transpiler::init` always sets `fs` to the process singleton.
        let fs = unsafe { &mut *this_transpiler.fs };

        // `path_buf` is a stack local so
        // `bun_which::which`'s returned slice can borrow it for the rest of exec().
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let top_level_dir: &[u8] = fs.top_level_dir;
        let which_cwd: &[u8] = if ignore_cwd.is_empty() {
            top_level_dir
        } else {
            b""
        };

        let passthrough: &[Box<[u8]>] = opts.passthrough_list.as_slice();

        // An explicit dist-tag (`pkg@latest`, `pkg@next`) asks the registry on every run.
        let look_for_existing_bin = update_request.version.literal.is_empty()
            || update_request.version.tag != VersionTag::DistTag;

        bun_output::scoped_log!(bunx, "try run existing? {}", look_for_existing_bin);
        if look_for_existing_bin {
            'try_run_existing: {
                // Similar to "npx":
                //
                //  1. Try the bin in the current node_modules and then we try the bin in the global cache
                //
                // Both probes are folded into one labeled block.
                let dest_or_cache: Option<&ZStr> = 'find: {
                    // Only use the system-installed version if there is no version specified
                    if update_request.version.literal.is_empty() {
                        // If the bin name is a guess derived from a scoped package name,
                        // exclude the original system $PATH so we don't match unrelated
                        // system binaries. Only search local node_modules/.bin directories.
                        if let Some(d) = bun_which::which(
                            &mut path_buf,
                            if initial_bin_name_is_a_guess {
                                &local_bin_dirs
                            } else {
                                &path_for_bin_dirs
                            },
                            which_cwd,
                            initial_bin_name,
                        ) {
                            break 'find Some(d);
                        }
                    }
                    match existing_cache_dir {
                        Some(bunx_cache_dir) => Self::which_in_cache(
                            &mut path_buf,
                            bunx_cache_dir,
                            which_cwd,
                            initial_bin_name,
                        )?,
                        None => None,
                    }
                };
                if let Some(destination) = dest_or_cache {
                    let out: &[u8] = destination.as_bytes();

                    // If this directory was installed by bunx, we want to perform cache invalidation on it
                    // this way running `bunx hello` will update hello automatically to the latest version
                    if let Some(bunx_cache_dir) =
                        existing_cache_dir.filter(|dir| strings::has_prefix(out, dir))
                    {
                        if Self::tree_state(bunx_cache_dir) != Tree::Fresh {
                            bun_output::scoped_log!(bunx, "found stale binary: {}", BStr::new(out));
                            if opts.no_install {
                                bun_core::warn!(
                                    "Using a stale installation of <b>{}<r> because --no-install was passed. Run `bunx` without --no-install to use a fresh binary.",
                                    BStr::new(&update_request.name),
                                );
                            } else {
                                break 'try_run_existing;
                            }
                        }

                        // The install path waits for it; with --no-install that path is an error.
                        if !opts.no_install && InstallLock::install_in_progress(bunx_cache_dir) {
                            break 'try_run_existing;
                        }
                    }

                    bun_output::scoped_log!(
                        bunx,
                        "running existing binary: {}",
                        BStr::new(destination.as_bytes())
                    );
                    let stored = fs.dirname_store.append_slice(out)?;
                    Run::run_binary(
                        ctx,
                        stored,
                        destination,
                        top_level_dir,
                        env_loader,
                        passthrough,
                        None,
                    )?;
                    // run_binary is noreturn
                }

                // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
                // BUT: Skip this if --package was used, as the user explicitly specified the binary name
                let root_dir_fd = root_dir_info.get_file_descriptor();
                debug_assert!(root_dir_fd.is_valid());
                if opts.binary_name.is_none() {
                    match Self::get_bin_name(
                        this_transpiler,
                        root_dir_fd,
                        existing_cache_dir,
                        result_package_name,
                    ) {
                        Ok(package_name_for_bin) => {
                            // if we check the bin name and its actually the same, we don't need to check $PATH here again
                            if !strings::eql_long(&package_name_for_bin, initial_bin_name, true) {
                                // Only use the system-installed version if there is no version specified.
                                // `package_name_for_bin` is the real bin name from the target package's
                                // own package.json. Search only local node_modules/.bin directories for
                                // it — not the system $PATH, because the real bin name may itself collide
                                // with an unrelated system binary when the package lives only in the bunx
                                // cache (handled by the `orelse` absolute-path probe below) and not in a
                                // local node_modules.
                                let dest_or_cache2: Option<&ZStr> = 'find2: {
                                    if update_request.version.literal.is_empty() {
                                        if let Some(d) = bun_which::which(
                                            &mut path_buf,
                                            &local_bin_dirs,
                                            which_cwd,
                                            &package_name_for_bin,
                                        ) {
                                            break 'find2 Some(d);
                                        }
                                    }
                                    match existing_cache_dir {
                                        Some(bunx_cache_dir) => Self::which_in_cache(
                                            &mut path_buf,
                                            bunx_cache_dir,
                                            which_cwd,
                                            &package_name_for_bin,
                                        )?,
                                        None => None,
                                    }
                                };
                                if let Some(destination) = dest_or_cache2 {
                                    let out: &[u8] = destination.as_bytes();
                                    if !opts.no_install
                                        && existing_cache_dir.is_some_and(|dir| {
                                            strings::has_prefix(out, dir)
                                                && InstallLock::install_in_progress(dir)
                                        })
                                    {
                                        break 'try_run_existing;
                                    }
                                    let stored = fs.dirname_store.append_slice(out)?;
                                    Run::run_binary(
                                        ctx,
                                        stored,
                                        destination,
                                        top_level_dir,
                                        env_loader,
                                        passthrough,
                                        None,
                                    )?;
                                    // run_binary is noreturn
                                }
                            }
                        }
                        Err(err) => {
                            if err == GetBinNameError::NoBinFound {
                                // `opts.binary_name` is `None` here (checked at the
                                // enclosing `if` above), so the `--package` + binary
                                // hint message can never apply on this path.
                                Output::err_generic(
                                    "could not determine executable to run for package <b>{}<r>",
                                    format_args!("{}", BStr::new(&update_request.name)),
                                );
                                Global::exit(1);
                            }
                        }
                    }
                }
            }
        }
        // If we've reached this point, it means we couldn't find an existing binary to run.
        // Next step is to install, then run it.

        // NOTE: npx prints errors like this:
        //
        //     npm error npx canceled due to missing packages and no YES option: ["foo@1.2.3"]
        //     npm error A complete log of this run can be found in: [folder]/debug.log
        //
        // Which is not very helpful.

        if opts.no_install {
            Output::err_generic(
                "Could not find an existing '{}' binary to run. Stopping because --no-install was passed.",
                format_args!("{}", BStr::new(initial_bin_name)),
            );
            Global::exit(1);
        }

        // The install cache comes first again, whichever root the lookups above found.
        let Some(bunx_cache_dir) = Self::cache_dir(env_loader, &package_fmt, true) else {
            Output::err_generic(
                "bunx could not create a cache directory that only the current user can access. Set <b>BUN_INSTALL_CACHE_DIR<r> to a directory you own.",
                (),
            );
            Global::exit(1);
        };
        let bunx_cache_dir: &[u8] = &bunx_cache_dir;
        Self::prepend_to_path(env_loader, bunx_cache_dir, &path)?;
        let bunx_install_dir = Fd::cwd().make_open_path(bunx_cache_dir)?;

        // Concurrent runs of one package share this directory: hold the lock through the install and
        // the bin lookups below, until exec. Unlockable: install without it.
        let mut install_lock =
            InstallLock::acquire(bunx_cache_dir, bun_sys::FileLockMode::Exclusive, false);
        if install_lock.is_none() {
            bun_output::scoped_log!(
                bunx,
                "could not lock {}, installing without the lock",
                BStr::new(bunx_cache_dir)
            );
        }

        // Looked at under the lock: the holder this run queued behind may just have installed the tree.
        let tree = Self::tree_state(bunx_cache_dir);
        // `--package` names the binary; otherwise the package.json may name another one than `initial_bin_name`.
        let package_with_bin = opts.binary_name.is_none().then_some(result_package_name);
        let installed = if tree == Tree::Fresh {
            Self::find_in_cache(
                this_transpiler,
                bunx_cache_dir,
                which_cwd,
                initial_bin_name,
                package_with_bin,
            )?
        } else {
            None
        };
        if let Some(bin) = installed.as_ref().filter(|_| look_for_existing_bin) {
            bun_output::scoped_log!(
                bunx,
                "concurrent bunx finished installing {}, skipping reinstall",
                BStr::new(&install_param)
            );
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
            // run_binary is noreturn
        }

        // See `Tree`.
        let write_package_json = |contents: &[u8]| {
            if let Ok(package_json) = bun_sys::File::create(
                bunx_install_dir.fd,
                b"package.json",
                /* truncate */ true,
            ) {
                let _ = package_json.write_all(contents);
            }
        };
        // Of a finished install: written back when the registry cannot be reached.
        let finished_package_json = bun_sys::File::read_from(bunx_install_dir.fd, b"package.json")
            .ok()
            .filter(|contents| contents.len() > Self::EMPTY_PACKAGE_JSON.len());
        write_package_json(Self::EMPTY_PACKAGE_JSON);

        let minimum_release_age_arg = opts
            .minimum_release_age
            .map(|age| [b"--minimum-release-age=".as_slice(), age].concat());
        let install_args: [&[u8]; 4] = [
            bun_core::self_exe_path()?.as_bytes(),
            b"add",
            install_param.as_slice(),
            b"--no-summary",
        ];
        let mut args: Vec<&[u8]> = install_args.to_vec();

        if update_request.version.tag == VersionTag::DistTag || tree == Tree::Stale {
            // disable the manifest cache when a tag is specified
            // so that @latest is fetched from the registry
            args.push(b"--no-cache");
        }

        if installed.is_none() {
            // Without it the install keeps every package whose package.json has the right name and version.
            // Only a tree known to be whole gets that: a killed install, a tree without its bin and, once a
            // day, every tree are linked again, which repairs them.
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

        if let Some(arg) = &minimum_release_age_arg {
            args.push(arg);
        }

        let argv_to_use = args.as_slice();

        bun_output::scoped_log!(
            bunx,
            "installing package: {}",
            bun_core::fmt::fmt_slice(argv_to_use, " "),
        );
        env_loader
            .map
            .put(b"BUN_INTERNAL_BUNX_INSTALL", b"true")
            .expect("oom");

        let envp = env_loader.map.create_null_delimited_env_map()?;

        let spawn_result = match proc_sync::spawn(&proc_sync::Options {
            argv: argv_to_use.iter().map(|s| Box::<[u8]>::from(*s)).collect(),

            envp: Some(envp.as_ptr().cast::<*const ::core::ffi::c_char>()),

            cwd: Box::<[u8]>::from(bunx_cache_dir),
            stderr: proc_sync::SyncStdio::Inherit,
            stdout: proc_sync::SyncStdio::Inherit,
            stdin: proc_sync::SyncStdio::Inherit,

            #[cfg(windows)]
            windows: proc_sync::WindowsOptions {
                loop_: bun_jsc::EventLoopHandle::init_mini(
                    bun_event_loop::MiniEventLoop::init_global(
                        // `this_transpiler.env` is the process-lifetime loader
                        // singleton populated during transpiler init.
                        //
                        // Aliasing: do NOT call `this_transpiler.env_mut()` here —
                        // `env_loader` is still live and is used again below at the
                        // post-install `Run::run_binary` calls. A second `env_mut()` would
                        // `unsafe { &mut *self.env }` from the raw field, popping `env_loader`'s
                        // Unique tag under Stacked Borrows (UB on later use). Instead reborrow
                        // *through* `env_loader` so the new `&mut` is a child of its tag; the
                        // child is consumed by `init_global` (converted to `NonNull`) before
                        // `env_loader` is touched again.
                        // SAFETY: `env_loader` is a valid `&'static mut Loader`; this is a
                        // stacked reborrow, not a sibling alias.
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
            Ok(maybe) => match maybe {
                bun_sys::Result::Err(_err) => {
                    Global::exit(1);
                }
                bun_sys::Result::Ok(result) => result,
            },
        };

        // Only for the install: with it, a tool that runs `bunx add` gets `bun add`, and its own
        // `bun install` finds no workspace root.
        env_loader.map.remove(b"BUN_INTERNAL_BUNX_INSTALL");

        match &spawn_result.status {
            SpawnStatus::Exited(exited) => {
                // Any non-zero byte (incl. RT signals >31) is a valid signal.
                // `signal_code()` would drop RT signals, so check the raw byte directly.
                if exited.signal != 0 {
                    if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN
                        .get()
                        .unwrap_or(false)
                    {
                        bun_crash_handler::suppress_reporting();
                    }

                    Global::raise_ignoring_panic_handler_raw(core::ffi::c_int::from(exited.signal));
                }

                use bun_install::package_manager_real::run_tasks::BUNX_REGISTRY_UNREACHABLE;
                match (exited.code as u32, &finished_package_json) {
                    (0, _) => {}
                    // The install touched nothing, so the tree is what it was. It counts as refreshed:
                    // without a network every run would wait for the attempt.
                    (BUNX_REGISTRY_UNREACHABLE, Some(package_json)) => {
                        write_package_json(package_json);
                        if !look_for_existing_bin {
                            Global::exit(1);
                        }
                        bun_core::warn!(
                            "Could not reach the registry. Using the installation of <b>{}<r> that bunx has.",
                            BStr::new(&update_request.name),
                        );
                    }
                    (BUNX_REGISTRY_UNREACHABLE, None) => Global::exit(1),
                    (code, _) => Global::exit(code),
                }
            }
            SpawnStatus::Signaled(sig) => {
                if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN
                    .get()
                    .unwrap_or(false)
                {
                    bun_crash_handler::suppress_reporting();
                }

                // RT signals (>31) are valid payloads; forward the
                // raw byte instead of lossy `signal_code()` so this arm always
                // diverges with the *actual* signal.
                Global::raise_ignoring_panic_handler_raw(core::ffi::c_int::from(*sig));
            }
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

        // Do not try $PATH because we already checked it above if we should
        if let Some(bin) = Self::find_in_cache(
            this_transpiler,
            bunx_cache_dir,
            which_cwd,
            initial_bin_name,
            package_with_bin,
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
            // run_binary is noreturn
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
