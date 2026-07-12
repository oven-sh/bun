//! `bun x` / `bunx`: resolves a package's executable — installing it into a
//! shared cache when not already present — and execs it with the given args.

use std::io::Write as _;

use bstr::BStr;

use crate::cli::command::ContextData;
use crate::cli::{self, Command};
use crate::run_command::RunCommand as Run;

use bun_alloc::AllocError;
use bun_ast::ExprData;
use bun_bundler::Transpiler;
use bun_collections::BoundedArray;
use bun_core::{self, Global, Output};
use bun_core::{ZStr, strings};
use bun_install::dependency::VersionTag;
use bun_install::update_request::{self, UpdateRequest};
use bun_parsers::json;
use bun_paths::{self, DELIMITER, PathBuffer};
use bun_resolver::fs::RealFS;
#[cfg(windows)]
use bun_sys::FdExt as _;
use bun_sys::{self, Fd, FdDirExt as _, O};
use bun_wyhash::hash;
use std::env::consts::EXE_SUFFIX;

use crate::api::bun::process::Status as SpawnStatus;
use crate::api::bun::process::sync as proc_sync;

bun_output::declare_scope!(bunx, visible);

pub(crate) struct BunxCommand;

/// bunx-specific options parsed from argv.
//
// Invariant: string fields borrow from `argv`, which is process-lifetime —
// that is what makes the `&'static [u8]` typing sound here.
pub struct Options {
    /// CLI arguments to pass to the command being run.
    // `Box<[u8]>` to match `ContextData::passthrough` /
    // `Run::run_binary`'s `&[Box<[u8]>]` param.
    pub passthrough_list: Vec<Box<[u8]>>,
    /// `bunx <package_name>`
    pub package_name: &'static [u8],
    /// The binary name to run (when using --package)
    pub binary_name: Option<&'static [u8]>,
    /// The package to install (when using --package)
    pub specified_package: Option<&'static [u8]>,
    // `--silent` and `--verbose` are not mutually exclusive. Both the
    // global CLI parser and `bun add` parser use them for different
    // purposes.
    pub verbose_install: bool,
    pub silent_install: bool,
    /// Skip installing the package, only running the target command if its
    /// already downloaded. If its not, `bunx` exits with an error.
    pub no_install: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            passthrough_list: Vec::new(),
            package_name: b"",
            binary_name: None,
            specified_package: None,
            verbose_install: false,
            silent_install: false,
            no_install: false,
        }
    }
}

impl Options {
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
                }
            } else {
                if !found_subcommand_name {
                    found_subcommand_name = true;
                } else {
                    maybe_package_name = Some(positional);
                }
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
    /// 1 day
    #[cfg(windows)]
    const NANOSECONDS_CACHE_VALID: i128 = (Self::SECONDS_CACHE_VALID as i128) * 1_000_000_000;

    /// `bin` keys (and the `name` fallback) in package.json are command
    /// names, not paths. The bunx cache lives in a world-writable temp dir,
    /// so a crafted package.json there could yield a key like
    /// `../../../../tmp/x` or `/tmp/x`; `bun_which::which` resolves
    /// slash-containing names against the cwd, escaping `node_modules/.bin`
    /// and skipping the cache-ownership check before execution. Reject
    /// anything that isn't a plain file name.
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
                        if !Self::is_safe_bin_name(bin_name) {
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
                if let Some(dir_name) = bin_prop.expr.as_utf8_string_literal() {
                    let bin_dir = bun_sys::openat_a(dir_fd, dir_name, O::RDONLY | O::DIRECTORY, 0)?;
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
        let mut subpath = PathBuffer::uninit();
        let len = {
            let total = subpath.len();
            let mut cursor: &mut [u8] = &mut subpath[..];
            write!(
                cursor,
                "{}",
                format_args!(
                    "node_modules{sep}{pkg}{sep}package.json",
                    sep = bun_paths::SEP as char,
                    pkg = BStr::new(package_name),
                ),
            )
            .expect("unreachable");
            total - cursor.len()
        };
        subpath[len] = 0;
        // SAFETY: subpath[len] == 0 written above
        let subpath_z = ZStr::from_buf(&subpath[..], len);
        Self::get_bin_name_from_subpath(transpiler, dir_fd, subpath_z)
    }

    fn get_bin_name_from_temp_directory(
        transpiler: &mut Transpiler,
        tempdir_name: &[u8],
        package_name: &[u8],
        with_stale_check: bool,
    ) -> crate::Result<Box<[u8]>> {
        let mut subpath = PathBuffer::uninit();
        if with_stale_check {
            let len = {
                let total = subpath.len();
                let mut cursor: &mut [u8] = &mut subpath[..];
                write!(
                    cursor,
                    "{}{}package.json",
                    BStr::new(tempdir_name),
                    bun_paths::SEP as char,
                )
                .expect("unreachable");
                total - cursor.len()
            };
            subpath[len] = 0;
            // SAFETY: subpath[len] == 0 written above
            let subpath_z = ZStr::from_buf(&subpath[..], len);
            let target_package_json_fd = match bun_sys::openat(Fd::cwd(), subpath_z, O::RDONLY, 0) {
                Ok(fd) => fd,
                Err(_) => return Err(crate::Error::NeedToInstall),
            };
            let target_package_json = bun_sys::File::from_fd(target_package_json_fd);

            let is_stale: bool = 'is_stale: {
                #[cfg(windows)]
                {
                    use bun_sys::windows as win;
                    let mut io_status_block: win::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
                    let mut info: win::FILE_BASIC_INFORMATION = bun_core::ffi::zeroed();
                    // SAFETY: FFI call with valid out-params
                    let rc = unsafe {
                        win::ntdll::NtQueryInformationFile(
                            target_package_json_fd.native(),
                            &mut io_status_block,
                            (&mut info as *mut win::FILE_BASIC_INFORMATION).cast(),
                            u32::try_from(size_of::<win::FILE_BASIC_INFORMATION>())
                                .expect("int cast"),
                            win::FILE_INFORMATION_CLASS::FileBasicInformation,
                        )
                    };
                    match rc {
                        win::NTSTATUS::SUCCESS => {
                            let time = win::from_sys_time(info.LastWriteTime);
                            let now = bun_core::time::nano_timestamp();
                            break 'is_stale now - time > Self::NANOSECONDS_CACHE_VALID;
                        }
                        // treat failures to stat as stale
                        _ => break 'is_stale true,
                    }
                }
                #[cfg(not(windows))]
                {
                    let stat = match target_package_json.stat() {
                        Ok(s) => s,
                        Err(_) => break 'is_stale true,
                    };
                    break 'is_stale bun_core::time::timestamp() - bun_sys::stat_mtime(&stat).sec
                        > Self::SECONDS_CACHE_VALID;
                }
            };

            if is_stale {
                let _ = target_package_json.close();
                // If delete fails, oh well. Hope installation takes care of it.
                let _ = bun_sys::Dir::cwd().delete_tree(tempdir_name);
                return Err(crate::Error::NeedToInstall);
            }
            let _ = target_package_json.close();
        }

        let len = {
            let total = subpath.len();
            let mut cursor: &mut [u8] = &mut subpath[..];
            write!(
                cursor,
                "{tmp}{sep}node_modules{sep}{pkg}{sep}package.json",
                tmp = BStr::new(tempdir_name),
                sep = bun_paths::SEP as char,
                pkg = BStr::new(package_name),
            )
            .expect("unreachable");
            total - cursor.len()
        };
        subpath[len] = 0;
        // SAFETY: subpath[len] == 0 written above
        let subpath_z = ZStr::from_buf(&subpath[..], len);

        Self::get_bin_name_from_subpath(transpiler, Fd::cwd(), subpath_z)
    }

    /// Check the enclosing package.json for a matching "bin"
    /// If not found, check bunx cache dir
    fn get_bin_name(
        transpiler: &mut Transpiler,
        toplevel_fd: Fd,
        tempdir_name: &[u8],
        package_name: &[u8],
    ) -> Result<Box<[u8]>, GetBinNameError> {
        debug_assert!(toplevel_fd.is_valid());
        match Self::get_bin_name_from_project_directory(transpiler, toplevel_fd, package_name) {
            Ok(v) => Ok(v),
            Err(err) => {
                if matches!(err, crate::Error::NoBinFound) {
                    return Err(GetBinNameError::NoBinFound);
                }

                match Self::get_bin_name_from_temp_directory(
                    transpiler,
                    tempdir_name,
                    package_name,
                    true,
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

    /// Refuse to execute a binary resolved from inside the bunx cache unless
    /// it is owned by the current user.
    ///
    /// The bunx cache lives under the world-writable temp dir at a predictable
    /// path. Another local user could pre-create that path. Bun's bin linker
    /// creates `.bin/<name>` entries as *symlinks* on Unix
    /// (`Linker::create_symlink`), so a regular-file-only check would mark every
    /// legitimate cache hit as untrusted and reinstall on every invocation.
    /// Accept either a symlink or a regular file owned by the current uid; for
    /// symlinks, also follow once and require the target to be a uid-owned
    /// regular file so an attacker-planted, uid-matching link can't redirect
    /// execution outside the cache.
    ///
    /// On non-Unix targets there is no comparable shared world-writable temp
    /// dir / uid model, so the check is a no-op there.
    #[cfg(unix)]
    fn is_trusted_cached_binary(destination: &ZStr, uid: libc::uid_t) -> bool {
        let lstat_ok = |st: &bun_sys::Stat| {
            let kind = st.st_mode & libc::S_IFMT;
            st.st_uid == uid && (kind == libc::S_IFREG || kind == libc::S_IFLNK)
        };
        let stat_ok =
            |st: &bun_sys::Stat| st.st_uid == uid && (st.st_mode & libc::S_IFMT) == libc::S_IFREG;
        match bun_sys::lstat(destination) {
            Ok(st) if lstat_ok(&st) => {
                if (st.st_mode & libc::S_IFMT) == libc::S_IFLNK {
                    matches!(bun_sys::stat(destination), Ok(target) if stat_ok(&target))
                } else {
                    true
                }
            }
            _ => false,
        }
    }

    #[cfg(not(unix))]
    #[inline(always)]
    fn is_trusted_cached_binary(_destination: &ZStr, _uid: u32) -> bool {
        true
    }

    #[cfg(unix)]
    fn is_trusted_cache_root(cache_root: &ZStr, uid: libc::uid_t) -> bool {
        match bun_sys::lstat(cache_root) {
            Ok(st) => {
                (st.st_mode & libc::S_IFMT) == libc::S_IFDIR
                    && st.st_uid == uid
                    && (st.st_mode & (libc::S_IWGRP | libc::S_IWOTH)) == 0
            }
            Err(_) => true,
        }
    }

    #[cfg(not(unix))]
    #[inline(always)]
    fn is_trusted_cache_root(_cache_root: &ZStr, _uid: u32) -> bool {
        true
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

        let root_dir_info =
            Run::configure_env_for_run(ctx, &mut this_transpiler_slot, None, true, true)?;
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

        let mut path: Vec<u8> = env_loader.get(b"PATH").unwrap().to_vec();

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

            let has_banned_char = strings::index_of_any(update_request.name, BANNED_PATH_CHARS)
                .is_some()
                || strings::index_of_any(display_version, BANNED_PATH_CHARS).is_some();

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

        let temp_dir = RealFS::platform_temp_dir();

        let path_for_bin_dirs: Vec<u8> = 'brk: {
            if ignore_cwd.is_empty() {
                break 'brk path.clone();
            }

            // Remove the cwd passed through BUN_WHICH_IGNORE_CWD from path. This prevents temp node-gyp script from finding and running itself
            let mut new_path: Vec<u8> = Vec::with_capacity(path.len());
            let mut path_iter = path
                .split(|b| *b == DELIMITER)
                .filter(|s: &&[u8]| !s.is_empty());
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

        // The bunx cache path is at the following location
        //
        //   <temp_dir>/bunx-<uid>-<package_fmt>/node_modules/.bin/<bin>
        //
        // Reasoning:
        // - Prefix with "bunx" to identify the bunx cache, make it easier to "rm -r"
        //   - Suffix would not work because scoped packages have a "/" in them, and
        //     before Bun 1.1 this was practically impossible to clear the cache manually.
        //     It was easier to just remove the entire temp directory.
        // - Use the uid to prevent conflicts between users. If the paths were the same
        //   across users, you run into permission conflicts
        //   - If you set permission to 777, you run into a potential attack vector
        //     where a user can replace the directory with malicious code.
        //
        // If this format changes, please update cache clearing code in package_manager_command.rs
        #[cfg(unix)]
        // SAFETY: getuid() is always safe to call (no preconditions, never fails)
        let uid = unsafe { libc::getuid() };
        #[cfg(windows)]
        let uid = bun_sys::windows::user_unique_id();

        path = {
            let mut v = Vec::new();
            let path_is_nonzero = !path.is_empty();
            write!(
                &mut v,
                "{tmp}{sep}bunx-{uid}-{pkg}{sep}node_modules{sep}.bin",
                tmp = BStr::new(temp_dir),
                sep = bun_paths::SEP as char,
                uid = uid,
                pkg = BStr::new(&package_fmt),
            )
            .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?;
            if path_is_nonzero {
                v.push(DELIMITER);
                v.extend_from_slice(&path);
            }
            v
        };

        env_loader.map.put(b"PATH", &path)?;
        // SAFETY: `Transpiler::init` always sets `fs` to the process singleton.
        let fs = unsafe { &mut *this_transpiler.fs };
        let uid_digits = bun_core::fmt::digit_count(uid);
        let bunx_cache_dir: &[u8] =
            &path[0..temp_dir.len() + b"/bunx--".len() + package_fmt.len() + uid_digits];

        bun_output::scoped_log!(bunx, "bunx_cache_dir: {}", BStr::new(bunx_cache_dir));

        // `path_buf` is a stack local so
        // `bun_which::which`'s returned slice can borrow it for the rest of exec().
        let mut path_buf = PathBuffer::uninit();
        let top_level_dir: &[u8] = fs.top_level_dir;

        let mut absolute_in_cache_dir_buf = PathBuffer::uninit();
        let buf_total = absolute_in_cache_dir_buf.len();
        let mut absolute_in_cache_dir: &[u8] = {
            let mut cursor: &mut [u8] = &mut absolute_in_cache_dir_buf[..];
            write!(
                cursor,
                "{cache}{sep}node_modules{sep}.bin{sep}{bin}{exe}",
                cache = BStr::new(bunx_cache_dir),
                sep = bun_paths::SEP as char,
                bin = BStr::new(initial_bin_name),
                exe = EXE_SUFFIX,
            )
            .map_err(|_| crate::Error::PathTooLong)?;
            let written = buf_total - cursor.len();
            // Re-slice from the buffer so the borrow on `cursor` ends here.
            // SAFETY: `written` bytes were just initialized above
            unsafe { core::slice::from_raw_parts(absolute_in_cache_dir_buf.as_ptr(), written) }
        };

        {
            let mut cache_root_buf = PathBuffer::uninit();
            cache_root_buf[..bunx_cache_dir.len()].copy_from_slice(bunx_cache_dir);
            cache_root_buf[bunx_cache_dir.len()] = 0;
            if !Self::is_trusted_cache_root(
                ZStr::from_buf(&cache_root_buf[..], bunx_cache_dir.len()),
                uid,
            ) {
                Output::err_generic(
                    "refusing to use bunx cache directory <b>{}<r> because it is not a directory owned by the current user. Remove it and try again.",
                    format_args!("{}", BStr::new(bunx_cache_dir)),
                );
                Global::exit(1);
            }
        }

        let passthrough: &[Box<[u8]>] = opts.passthrough_list.as_slice();

        let mut do_cache_bust = update_request.version.tag == VersionTag::DistTag;
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
                            if !ignore_cwd.is_empty() {
                                b"".as_slice()
                            } else {
                                top_level_dir
                            },
                            initial_bin_name,
                        ) {
                            break 'find Some(d);
                        }
                    }
                    bun_which::which(
                        &mut path_buf,
                        bunx_cache_dir,
                        if !ignore_cwd.is_empty() {
                            b"".as_slice()
                        } else {
                            top_level_dir
                        },
                        absolute_in_cache_dir,
                    )
                };
                if let Some(destination) = dest_or_cache {
                    let out: &[u8] = destination.as_bytes();

                    // If this directory was installed by bunx, we want to perform cache invalidation on it
                    // this way running `bunx hello` will update hello automatically to the latest version
                    if strings::has_prefix(out, bunx_cache_dir) {
                        // Refuse to execute a cached binary that wasn't created by the
                        // current user (another local user could have pre-created the
                        // path); fall through to a fresh install instead. See
                        // `is_trusted_cached_binary` for the full rationale.
                        if !Self::is_trusted_cached_binary(destination, uid) {
                            bun_output::scoped_log!(
                                bunx,
                                "refusing untrusted cached binary: {}",
                                BStr::new(out)
                            );
                            do_cache_bust = true;
                            break 'try_run_existing;
                        }
                        let is_stale: bool = 'is_stale: {
                            #[cfg(windows)]
                            {
                                use bun_sys::windows as win;
                                let fd = match bun_sys::openat(Fd::cwd(), destination, O::RDONLY, 0)
                                {
                                    Ok(fd) => fd,
                                    Err(_) => {
                                        // if we cant open this, we probably will just fail when we run it
                                        // and that error message is likely going to be better than the one from `bun add`
                                        break 'is_stale false;
                                    }
                                };
                                // The fd is closed explicitly below before
                                // any `break 'is_stale` (no early-return between open & close).

                                let mut io_status_block: win::IO_STATUS_BLOCK =
                                    bun_core::ffi::zeroed();
                                let mut info: win::FILE_BASIC_INFORMATION = bun_core::ffi::zeroed();
                                // SAFETY: FFI call with valid out-params
                                let rc = unsafe {
                                    win::ntdll::NtQueryInformationFile(
                                        fd.native(),
                                        &mut io_status_block,
                                        (&mut info as *mut win::FILE_BASIC_INFORMATION).cast(),
                                        u32::try_from(size_of::<win::FILE_BASIC_INFORMATION>())
                                            .expect("int cast"),
                                        win::FILE_INFORMATION_CLASS::FileBasicInformation,
                                    )
                                };
                                fd.close();
                                match rc {
                                    win::NTSTATUS::SUCCESS => {
                                        let time = win::from_sys_time(info.LastWriteTime);
                                        let now = bun_core::time::nano_timestamp();
                                        break 'is_stale now - time > Self::NANOSECONDS_CACHE_VALID;
                                    }
                                    // treat failures to stat as stale
                                    _ => break 'is_stale true,
                                }
                            }
                            #[cfg(not(windows))]
                            {
                                let stat = match bun_sys::stat(destination) {
                                    Ok(s) => s,
                                    Err(_) => break 'is_stale true,
                                };
                                break 'is_stale bun_core::time::timestamp()
                                    - bun_sys::stat_mtime(&stat).sec
                                    > Self::SECONDS_CACHE_VALID;
                            }
                        };

                        if is_stale {
                            bun_output::scoped_log!(bunx, "found stale binary: {}", BStr::new(out));
                            do_cache_bust = true;
                            if opts.no_install {
                                bun_core::warn!(
                                    "Using a stale installation of <b>{}<r> because --no-install was passed. Run `bunx` without --no-install to use a fresh binary.",
                                    BStr::new(&update_request.name),
                                );
                            } else {
                                break 'try_run_existing;
                            }
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
                        bunx_cache_dir,
                        result_package_name,
                    ) {
                        Ok(package_name_for_bin) => {
                            // if we check the bin name and its actually the same, we don't need to check $PATH here again
                            if !strings::eql_long(&package_name_for_bin, initial_bin_name, true) {
                                absolute_in_cache_dir = {
                                    let mut cursor: &mut [u8] = &mut absolute_in_cache_dir_buf[..];
                                    write!(
                                        cursor,
                                        "{cache}{sep}node_modules{sep}.bin{sep}{bin}{exe}",
                                        cache = BStr::new(bunx_cache_dir),
                                        sep = bun_paths::SEP as char,
                                        bin = BStr::new(&package_name_for_bin),
                                        exe = EXE_SUFFIX,
                                    )
                                    .expect("unreachable");
                                    let written = buf_total - cursor.len();
                                    // SAFETY: `written` bytes initialized above
                                    unsafe {
                                        core::slice::from_raw_parts(
                                            absolute_in_cache_dir_buf.as_ptr(),
                                            written,
                                        )
                                    }
                                };

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
                                            if !ignore_cwd.is_empty() {
                                                b"".as_slice()
                                            } else {
                                                top_level_dir
                                            },
                                            &package_name_for_bin,
                                        ) {
                                            break 'find2 Some(d);
                                        }
                                    }
                                    bun_which::which(
                                        &mut path_buf,
                                        bunx_cache_dir,
                                        if !ignore_cwd.is_empty() {
                                            b"".as_slice()
                                        } else {
                                            top_level_dir
                                        },
                                        absolute_in_cache_dir,
                                    )
                                };
                                if let Some(destination) = dest_or_cache2 {
                                    let out: &[u8] = destination.as_bytes();
                                    // Same hardening as the first cache probe: this path
                                    // resolves the package's *real* bin name (which may
                                    // differ from the package name), so it is just as
                                    // reachable for a binary planted by another local user
                                    // in the world-writable bunx cache.
                                    if strings::has_prefix(out, bunx_cache_dir)
                                        && !Self::is_trusted_cached_binary(destination, uid)
                                    {
                                        bun_output::scoped_log!(
                                            bunx,
                                            "refusing untrusted cached binary: {}",
                                            BStr::new(out)
                                        );
                                        do_cache_bust = true;
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

        let bunx_install_dir = Fd::cwd().make_open_path(bunx_cache_dir)?;

        'create_package_json: {
            // create package.json, but only if it doesn't exist
            let package_json = match bun_sys::File::create(
                bunx_install_dir.fd,
                b"package.json",
                /* truncate */ true,
            ) {
                Ok(f) => f,
                Err(_) => break 'create_package_json,
            };
            let _ = package_json.write_all(b"{}\n");
        }

        let install_args: [&[u8]; 4] = [
            bun_core::self_exe_path()?.as_bytes(),
            b"add",
            install_param.as_slice(),
            b"--no-summary",
        ];
        let mut args: BoundedArray<&[u8], 8> =
            BoundedArray::from_slice(&install_args).expect("unreachable"); // upper bound is known

        if do_cache_bust {
            // disable the manifest cache when a tag is specified
            // so that @latest is fetched from the registry
            args.append(b"--no-cache").expect("unreachable"); // upper bound is known

            // forcefully re-install packages in this mode too
            args.append(b"--force").expect("unreachable"); // upper bound is known
        }

        if opts.verbose_install {
            args.append(b"--verbose").expect("unreachable"); // upper bound is known
        }

        if opts.silent_install {
            args.append(b"--silent").expect("unreachable"); // upper bound is known
        }

        let argv_to_use = args.slice();

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
                        // `env_loader` (line 594) is still live and is used again below at the
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
                    BStr::new(&install_param),
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

                if exited.code != 0 {
                    Global::exit(exited.code as u32);
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
                    BStr::new(&install_param),
                    err,
                );
                Global::exit(1);
            }
            _ => {}
        }

        absolute_in_cache_dir = {
            let mut cursor: &mut [u8] = &mut absolute_in_cache_dir_buf[..];
            write!(
                cursor,
                "{cache}{sep}node_modules{sep}.bin{sep}{bin}{exe}",
                cache = BStr::new(bunx_cache_dir),
                sep = bun_paths::SEP as char,
                bin = BStr::new(initial_bin_name),
                exe = EXE_SUFFIX,
            )
            .expect("unreachable");
            let written = buf_total - cursor.len();
            // SAFETY: `written` bytes initialized above
            unsafe { core::slice::from_raw_parts(absolute_in_cache_dir_buf.as_ptr(), written) }
        };

        // Similar to "npx":
        //
        //  1. Try the bin in the global cache
        //     Do not try $PATH because we already checked it above if we should
        if let Some(destination) = bun_which::which(
            &mut path_buf,
            bunx_cache_dir,
            if !ignore_cwd.is_empty() {
                b"".as_slice()
            } else {
                top_level_dir
            },
            absolute_in_cache_dir,
        ) {
            let out: &[u8] = destination.as_bytes();
            // The install we just ran should have created this symlink as the
            // current user, but the cache lives in a world-writable temp dir; an
            // attacker can race the install and plant a uid-mismatched entry.
            // Bail out to the generic error rather than execute it.
            if Self::is_trusted_cached_binary(destination, uid) {
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
            } else {
                bun_output::scoped_log!(
                    bunx,
                    "refusing untrusted cached binary: {}",
                    BStr::new(out)
                );
            }
        }

        // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
        // BUT: Skip this if --package was used, as the user explicitly specified the binary name
        if opts.binary_name.is_none() {
            if let Ok(package_name_for_bin) = Self::get_bin_name_from_temp_directory(
                this_transpiler,
                bunx_cache_dir,
                result_package_name,
                false,
            ) {
                if !strings::eql_long(&package_name_for_bin, initial_bin_name, true) {
                    absolute_in_cache_dir = {
                        let mut cursor: &mut [u8] = &mut absolute_in_cache_dir_buf[..];
                        write!(
                            cursor,
                            "{}/node_modules/.bin/{}{}",
                            BStr::new(bunx_cache_dir),
                            BStr::new(&package_name_for_bin),
                            EXE_SUFFIX,
                        )
                        .expect("unreachable");
                        let written = buf_total - cursor.len();
                        // SAFETY: `written` bytes initialized above
                        unsafe {
                            core::slice::from_raw_parts(absolute_in_cache_dir_buf.as_ptr(), written)
                        }
                    };

                    if let Some(destination) = bun_which::which(
                        &mut path_buf,
                        bunx_cache_dir,
                        if !ignore_cwd.is_empty() {
                            b"".as_slice()
                        } else {
                            top_level_dir
                        },
                        absolute_in_cache_dir,
                    ) {
                        let out: &[u8] = destination.as_bytes();
                        // Same TOCTOU hardening as the post-install probe above.
                        if Self::is_trusted_cached_binary(destination, uid) {
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
                        } else {
                            bun_output::scoped_log!(
                                bunx,
                                "refusing untrusted cached binary: {}",
                                BStr::new(out)
                            );
                        }
                    }
                }
            }
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
