//! Port of `src/cli/bunx_command.zig`.

use core::ffi::c_int;
use core::mem::size_of;
use std::cell::RefCell;
use std::io::Write as _;

use bstr::BStr;

use crate::cli::{self, Command};
use crate::run_command::RunCommand as Run;

use bun_alloc::AllocError;
use bun_bundler::Transpiler;
use bun_collections::BoundedArray;
use bun_core::{self, Global, Output};
use bun_fs::FileSystem;
use bun_install::package_manager::UpdateRequest;
use bun_paths::{self, PathBuffer, DELIMITER};
use bun_str::{strings, ZStr};
use bun_sys::{self, Fd, O};
use bun_wyhash::hash;

bun_output::declare_scope!(bunx, visible);

pub struct BunxCommand;

// PORT NOTE: Zig had a module-level `var path_buf: bun.PathBuffer = undefined;`.
// Rust forbids plain mutable statics; use a thread-local scratch buffer instead.
thread_local! {
    static PATH_BUF: RefCell<PathBuffer> = const { RefCell::new(PathBuffer::ZEROED) };
}

/// bunx-specific options parsed from argv.
//
// PORT NOTE: string fields borrow from `argv` (process-lifetime). Phase A forbids
// struct lifetime params, so they are typed `&'static [u8]`.
// TODO(port): lifetime — these borrow argv, not true 'static.
pub struct Options {
    /// CLI arguments to pass to the command being run.
    pub passthrough_list: Vec<&'static [u8]>,
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
    // PORT NOTE: `allocator: Allocator` field dropped — global mimalloc.
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
    fn parse(ctx: &mut Command::Context, argv: &[&'static ZStr]) -> Result<Options, AllocError> {
        let mut found_subcommand_name = false;
        let mut maybe_package_name: Option<&'static [u8]> = None;
        let mut has_version = false; //  --version
        let mut has_revision = false; // --revision
        let mut i: usize = 0;

        // SAFETY: `opts` is only ever returned when a package name is found, otherwise the process exits.
        let mut opts = Options { package_name: b"", ..Default::default() };
        opts.passthrough_list.reserve_exact(argv.len());

        while i < argv.len() {
            let positional: &[u8] = argv[i].as_bytes();

            if maybe_package_name.is_some() {
                opts.passthrough_list.push(positional);
                // PERF(port): was appendAssumeCapacity — profile in Phase B
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
                        Output::err_generic("--package requires a non-empty package name", format_args!(""));
                        Global::exit(1);
                    }
                    opts.specified_package = Some(argv[i].as_bytes());
                } else if positional.starts_with(b"--package=") {
                    let package_value = &positional[b"--package=".len()..];
                    if package_value.is_empty() {
                        Output::err_generic("--package requires a non-empty package name", format_args!(""));
                        Global::exit(1);
                    }
                    opts.specified_package = Some(package_value);
                } else if positional.starts_with(b"-p=") {
                    let package_value = &positional[b"-p=".len()..];
                    if package_value.is_empty() {
                        Output::err_generic("--package requires a non-empty package name", format_args!(""));
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
        if opts.specified_package.is_some() {
            if let Some(package_name) = maybe_package_name {
                if package_name.is_empty() {
                    Output::err_generic("When using --package, you must specify the binary to run", format_args!(""));
                    Output::prettyln("  <d>usage: bunx --package=\\<package-name\\> \\<binary-name\\> [args...]<r>", format_args!(""));
                    Global::exit(1);
                }
            } else {
                Output::err_generic("When using --package, you must specify the binary to run", format_args!(""));
                Output::prettyln("  <d>usage: bunx --package=\\<package-name\\> \\<binary-name\\> [args...]<r>", format_args!(""));
                Global::exit(1);
            }
            opts.binary_name = maybe_package_name;
            opts.package_name = opts.specified_package.unwrap();
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

// PORT NOTE: `fn deinit` only freed `passthrough_list`; `Vec` drops automatically,
// so no explicit `Drop` impl is needed.

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum GetBinNameError {
    #[error("NoBinFound")]
    NoBinFound,
    #[error("NeedToInstall")]
    NeedToInstall,
}

impl From<GetBinNameError> for bun_core::Error {
    fn from(e: GetBinNameError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
        // TODO(port): use generated `Into<bun_core::Error>` derive once available
    }
}

impl BunxCommand {
    /// Adds `create-` to the string, but also handles scoped packages correctly.
    /// Always clones the string in the process.
    ///
    /// Returned `Vec<u8>` is NUL-terminated: `v[v.len()-1] == 0` and the content
    /// occupies `v[..v.len()-1]` (matches Zig `[:0]const u8` from `allocSentinel`).
    // TODO(port): return owned `bun_str::ZString` / `Box<ZStr>` once that type exists,
    // instead of a Vec<u8> with a trailing-NUL convention.
    pub fn add_create_prefix(input: &[u8]) -> Result<Vec<u8>, AllocError> {
        const PREFIX_LENGTH: usize = b"create-".len();

        if input.is_empty() {
            // Zig's `dupeZ(u8, "")` yields a 1-byte allocation containing only NUL.
            return Ok(vec![0u8]);
        }

        // +1 for the trailing NUL sentinel; vec! zero-initializes so the last byte stays 0.
        let mut new_str = vec![0u8; input.len() + PREFIX_LENGTH + 1];
        if input[0] == b'@' {
            // @org/some -> @org/create-some
            // @org/some@v -> @org/create-some@v
            if let Some(slash_i) = strings::index_of_char(input, b'/') {
                let index = usize::try_from(slash_i + 1).unwrap();
                new_str[0..index].copy_from_slice(&input[0..index]);
                new_str[index..index + PREFIX_LENGTH].copy_from_slice(b"create-");
                new_str[index + PREFIX_LENGTH..input.len() + PREFIX_LENGTH].copy_from_slice(&input[index..]);
                return Ok(new_str);
            }
            // @org@v -> @org/create@v
            else if let Some(at_i) = strings::index_of_char(&input[1..], b'@') {
                let index = usize::try_from(at_i + 1).unwrap();
                new_str[0..index].copy_from_slice(&input[0..index]);
                new_str[index..index + PREFIX_LENGTH].copy_from_slice(b"/create");
                new_str[index + PREFIX_LENGTH..input.len() + PREFIX_LENGTH].copy_from_slice(&input[index..]);
                return Ok(new_str);
            }
            // @org -> @org/create
            else {
                new_str[0..input.len()].copy_from_slice(input);
                new_str[input.len()..input.len() + PREFIX_LENGTH].copy_from_slice(b"/create");
                return Ok(new_str);
            }
        }

        new_str[0..PREFIX_LENGTH].copy_from_slice(b"create-");
        new_str[PREFIX_LENGTH..input.len() + PREFIX_LENGTH].copy_from_slice(input);

        Ok(new_str)
    }

    /// 1 day
    const SECONDS_CACHE_VALID: i64 = 60 * 60 * 24;
    /// 1 day
    const NANOSECONDS_CACHE_VALID: i128 = (Self::SECONDS_CACHE_VALID as i128) * 1_000_000_000;

    fn get_bin_name_from_subpath(
        transpiler: &mut Transpiler,
        dir_fd: Fd,
        subpath_z: &ZStr,
    ) -> Result<Box<[u8]>, bun_core::Error> {
        let target_package_json_fd = bun_sys::openat(dir_fd, subpath_z, O::RDONLY, 0).unwrap_result()?;
        let target_package_json = bun_sys::File { handle: target_package_json_fd };
        // PORT NOTE: `defer target_package_json.close()` handled by Drop on bun_sys::File.
        // TODO(port): confirm bun_sys::File implements Drop → close.

        let package_json_read = target_package_json.read_to_end();

        // TODO: make this better
        if let Some(err) = package_json_read.err {
            bun_sys::Result::<()>::Err(err).unwrap_result()?;
        }

        let package_json_contents = package_json_read.bytes.as_slice();
        let source = bun_logger::Source::init_path_string(subpath_z.as_bytes(), package_json_contents);

        bun_js_parser::Expr::Data::Store::create();
        bun_js_parser::Stmt::Data::Store::create();

        let expr = bun_json::parse_package_json_utf8(&source, &mut transpiler.log)?;
        // TODO(port): allocator param dropped from parse_package_json_utf8

        // choose the first package that fits
        if let Some(bin_expr) = expr.get(b"bin") {
            match &bin_expr.data {
                bun_js_parser::ExprData::EObject(object) => {
                    for prop in object.properties.slice() {
                        if let Some(key) = &prop.key {
                            if let Some(bin_name) = key.as_string() {
                                if bin_name.is_empty() {
                                    continue;
                                }
                                return Ok(bin_name.into());
                            }
                        }
                    }
                }
                bun_js_parser::ExprData::EString(_) => {
                    if let Some(name_expr) = expr.get(b"name") {
                        if let Some(name) = name_expr.as_string() {
                            return Ok(name.into());
                        }
                    }
                }
                _ => {}
            }
        }

        if let Some(dirs) = expr.as_property(b"directories") {
            if let Some(bin_prop) = dirs.expr.as_property(b"bin") {
                if let Some(dir_name) = bin_prop.expr.as_string() {
                    let bin_dir = bun_sys::openat_a(dir_fd, &dir_name, O::RDONLY | O::DIRECTORY, 0).unwrap_result()?;
                    // PORT NOTE: `defer bin_dir.close()` → Drop.
                    let mut iterator = bun_sys::DirIterator::iterate(bin_dir, bun_sys::DirIteratorEncoding::U8);
                    let mut entry = iterator.next();
                    loop {
                        let current = match entry {
                            bun_sys::Result::Err(_) => break,
                            bun_sys::Result::Ok(result) => match result {
                                Some(r) => r,
                                None => break,
                            },
                        };

                        if current.kind == bun_sys::DirEntryKind::File {
                            if current.name.len() == 0 {
                                entry = iterator.next();
                                continue;
                            }
                            return Ok(Box::<[u8]>::from(current.name.slice()));
                        }

                        entry = iterator.next();
                    }
                }
            }
        }

        Err(bun_core::err!("NoBinFound"))
    }

    fn get_bin_name_from_project_directory(
        transpiler: &mut Transpiler,
        dir_fd: Fd,
        package_name: &[u8],
    ) -> Result<Box<[u8]>, bun_core::Error> {
        let mut subpath = PathBuffer::uninit();
        // TODO(port): bun.pathLiteral() rewrites '/' to the platform separator at comptime.
        let len = {
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
            subpath.len() - cursor.len()
        };
        subpath[len] = 0;
        // SAFETY: subpath[len] == 0 written above
        let subpath_z = unsafe { ZStr::from_raw(subpath.as_ptr(), len) };
        Self::get_bin_name_from_subpath(transpiler, dir_fd, subpath_z)
    }

    fn get_bin_name_from_temp_directory(
        transpiler: &mut Transpiler,
        tempdir_name: &[u8],
        package_name: &[u8],
        with_stale_check: bool,
    ) -> Result<Box<[u8]>, bun_core::Error> {
        let mut subpath = PathBuffer::uninit();
        if with_stale_check {
            let len = {
                let mut cursor: &mut [u8] = &mut subpath[..];
                write!(
                    cursor,
                    "{}{}package.json",
                    BStr::new(tempdir_name),
                    bun_paths::SEP as char,
                )
                .expect("unreachable");
                subpath.len() - cursor.len()
            };
            subpath[len] = 0;
            // SAFETY: subpath[len] == 0 written above
            let subpath_z = unsafe { ZStr::from_raw(subpath.as_ptr(), len) };
            let target_package_json_fd = match bun_sys::openat(Fd::cwd(), subpath_z, O::RDONLY, 0).unwrap_result() {
                Ok(fd) => fd,
                Err(_) => return Err(bun_core::err!("NeedToInstall")),
            };
            let target_package_json = bun_sys::File { handle: target_package_json_fd };

            let is_stale: bool = 'is_stale: {
                #[cfg(windows)]
                {
                    use bun_sys::windows as win;
                    // SAFETY: all-zero is a valid IO_STATUS_BLOCK (repr(C) POD, no niches)
                    let mut io_status_block: win::IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };
                    // SAFETY: all-zero is a valid FILE_BASIC_INFORMATION (repr(C) POD, no niches)
                    let mut info: win::FILE_BASIC_INFORMATION = unsafe { core::mem::zeroed() };
                    // SAFETY: FFI call with valid out-params
                    let rc = unsafe {
                        win::ntdll::NtQueryInformationFile(
                            target_package_json_fd.cast(),
                            &mut io_status_block,
                            (&mut info as *mut win::FILE_BASIC_INFORMATION).cast(),
                            u32::try_from(size_of::<win::FILE_BASIC_INFORMATION>()).unwrap(),
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
                    let stat = match target_package_json.stat().unwrap_result() {
                        Ok(s) => s,
                        Err(_) => break 'is_stale true,
                    };
                    break 'is_stale bun_core::time::timestamp() - stat.mtime().sec > Self::SECONDS_CACHE_VALID;
                }
            };

            if is_stale {
                let _ = target_package_json.close();
                // If delete fails, oh well. Hope installation takes care of it.
                // TODO(port): Zig used std.fs.cwd().deleteTree; map to bun_sys recursive rm.
                let _ = bun_sys::delete_tree(Fd::cwd(), tempdir_name);
                return Err(bun_core::err!("NeedToInstall"));
            }
            let _ = target_package_json.close();
        }

        let len = {
            let mut cursor: &mut [u8] = &mut subpath[..];
            write!(
                cursor,
                "{tmp}{sep}node_modules{sep}{pkg}{sep}package.json",
                tmp = BStr::new(tempdir_name),
                sep = bun_paths::SEP as char,
                pkg = BStr::new(package_name),
            )
            .expect("unreachable");
            subpath.len() - cursor.len()
        };
        subpath[len] = 0;
        // SAFETY: subpath[len] == 0 written above
        let subpath_z = unsafe { ZStr::from_raw(subpath.as_ptr(), len) };

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
                if err == bun_core::err!("NoBinFound") {
                    return Err(GetBinNameError::NoBinFound);
                }

                match Self::get_bin_name_from_temp_directory(transpiler, tempdir_name, package_name, true) {
                    Ok(v) => Ok(v),
                    Err(err2) => {
                        if err2 == bun_core::err!("NoBinFound") {
                            return Err(GetBinNameError::NoBinFound);
                        }

                        Err(GetBinNameError::NeedToInstall)
                    }
                }
            }
        }
    }

    fn exit_with_usage() -> ! {
        Command::Tag::print_help(Command::Tag::BunxCommand, false);
        Global::exit(1);
    }

    pub fn exec(ctx: &mut Command::Context, argv: &[&'static ZStr]) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // Don't log stuff
        ctx.debug.silent = true;

        let mut opts = Options::parse(ctx, argv)?;

        let mut requests_buf = UpdateRequest::Array::with_capacity(64);
        let update_requests = UpdateRequest::parse(
            None,
            &mut ctx.log,
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
                update_request.name = b"typescript".as_slice().into();
            } else if update_request.name == b"claude" {
                // The npm package "claude" is an unrelated squatter with no bin;
                // `bunx claude` is much more likely to mean the actual CLI.
                update_request.name = b"@anthropic-ai/claude-code".as_slice().into();
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
        } else if &*update_request.name == b"typescript" {
            b"tsc"
        } else if &*update_request.name == b"@anthropic-ai/claude-code" {
            b"claude"
        } else if update_request.version.tag == bun_semver::VersionTag::Github {
            update_request.version.value.github.repo.slice(&update_request.version_buf)
        } else if let Some(index) = strings::last_index_of_char(&update_request.name, b'/') {
            initial_bin_name_is_a_guess = true;
            &update_request.name[usize::try_from(index + 1).unwrap()..]
        } else {
            &update_request.name
        };
        bun_output::scoped_log!(bunx, "initial_bin_name: {}", BStr::new(initial_bin_name));

        // fast path: they're actually using this interchangeably with `bun run`
        // so we use Bun.which to check
        // SAFETY: initialized by Run.configureEnvForRun
        // TODO(port): `this_transpiler` was an out-param `undefined` in Zig; configure_env_for_run
        // should return it by value in Rust.
        let mut this_transpiler: Transpiler;
        let mut original_path: &[u8] = b"";

        let root_dir_info = Run::configure_env_for_run(
            ctx,
            &mut this_transpiler,
            None,
            true,
            true,
        )?;

        Run::configure_path_for_run(
            ctx,
            root_dir_info,
            &mut this_transpiler,
            &mut original_path,
            root_dir_info.abs_path,
            ctx.debug.run_in_bun,
        )?;
        this_transpiler.env.map.put(b"npm_command", b"exec").expect("unreachable");
        this_transpiler.env.map.put(b"npm_lifecycle_event", b"bunx").expect("unreachable");
        this_transpiler.env.map.put(b"npm_lifecycle_script", opts.package_name).expect("unreachable");

        if opts.package_name == b"bun-repl" {
            this_transpiler.env.map.remove(b"BUN_INSPECT_CONNECT_TO");
            this_transpiler.env.map.remove(b"BUN_INSPECT_NOTIFY");
            this_transpiler.env.map.remove(b"BUN_INSPECT");
        }

        let ignore_cwd: &[u8] = this_transpiler.env.get(b"BUN_WHICH_IGNORE_CWD").unwrap_or(b"");

        if !ignore_cwd.is_empty() {
            let _ = this_transpiler.env.map.map.swap_remove(b"BUN_WHICH_IGNORE_CWD");
        }

        let mut path: Vec<u8> = this_transpiler.env.get(b"PATH").unwrap().to_vec();
        // PORT NOTE: reshaped for borrowck — Zig held a borrowed slice into env.map and
        // later overwrote PATH with a new allocation; here we own PATH as a Vec<u8>.

        // `configurePathForRun` builds PATH by appending ORIGINAL_PATH to a set of
        // `*/node_modules/.bin` directories (plus the bun-node shim dir). Capture just
        // that prepended portion here — it is used below to search for guessed bin
        // names without risking a collision with an unrelated binary in the user's
        // system $PATH. A trailing delimiter may remain; `bun.which` tokenizes on the
        // delimiter so empty segments are ignored.
        let local_bin_dirs: Vec<u8> = if !original_path.is_empty() && strings::ends_with(&path, original_path) {
            path[0..path.len() - original_path.len()].to_vec()
        } else {
            path.clone()
        };
        // PORT NOTE: cloned to avoid borrowck overlap when PATH is reassigned below.

        let display_version: &[u8] = if update_request.version.literal.is_empty() {
            b"latest"
        } else {
            update_request.version.literal.slice(&update_request.version_buf)
        };

        // package_fmt is used for the path to install in.
        let package_fmt: Vec<u8> = 'brk: {
            // Includes the delimiters because we use this as a part of $PATH
            #[cfg(windows)]
            const BANNED_PATH_CHARS: &[u8] = b":*?<>|;";
            #[cfg(not(windows))]
            const BANNED_PATH_CHARS: &[u8] = b":";

            let has_banned_char = strings::index_any(&update_request.name, BANNED_PATH_CHARS).is_some()
                || strings::index_any(display_version, BANNED_PATH_CHARS).is_some();

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
                    hash(&update_request.name).wrapping_add(hash(display_version)),
                )
                .map_err(|_| bun_core::err!("OutOfMemory"))?;
            } else {
                write!(
                    &mut v,
                    "{}@{}",
                    BStr::new(&update_request.name),
                    BStr::new(display_version),
                )
                .map_err(|_| bun_core::err!("OutOfMemory"))?;
            }
            break 'brk v;
        };
        bun_output::scoped_log!(bunx, "package_fmt: {}", BStr::new(&package_fmt));

        // install_param -> used in command 'bun install {what}'
        // result_package_name -> used for path 'node_modules/{what}/package.json'
        let (install_param, result_package_name): (Vec<u8>, &[u8]) = if !update_request.name.is_empty() {
            let mut v = Vec::new();
            write!(
                &mut v,
                "{}@{}",
                BStr::new(&update_request.name),
                BStr::new(display_version),
            )
            .map_err(|_| bun_core::err!("OutOfMemory"))?;
            (v, &update_request.name)
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
            .map_err(|_| bun_core::err!("OutOfMemory"))?;
            (v, initial_bin_name)
        };
        bun_output::scoped_log!(bunx, "install_param: {}", BStr::new(&install_param));
        bun_output::scoped_log!(bunx, "result_package_name: {}", BStr::new(result_package_name));

        let temp_dir = FileSystem::RealFS::platform_temp_dir();

        let path_for_bin_dirs: Vec<u8> = 'brk: {
            if ignore_cwd.is_empty() {
                break 'brk path.clone();
            }

            // Remove the cwd passed through BUN_WHICH_IGNORE_CWD from path. This prevents temp node-gyp script from finding and running itself
            let mut new_path: Vec<u8> = Vec::with_capacity(path.len());
            let mut path_iter = path.split(|b| *b == DELIMITER).filter(|s| !s.is_empty());
            if let Some(segment) = path_iter.next() {
                if !strings::eql_long(
                    strings::without_trailing_slash(segment),
                    strings::without_trailing_slash(ignore_cwd),
                    true,
                ) {
                    new_path.extend_from_slice(segment);
                }
            }
            while let Some(segment) = path_iter.next() {
                if !strings::eql_long(
                    strings::without_trailing_slash(segment),
                    strings::without_trailing_slash(ignore_cwd),
                    true,
                ) {
                    new_path.push(DELIMITER);
                    new_path.extend_from_slice(segment);
                }
            }

            break 'brk new_path;
        };
        // PORT NOTE: `defer ctx.allocator.free(PATH_FOR_BIN_DIRS)` — Vec drops automatically.

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
        // If this format changes, please update cache clearing code in package_manager_command.zig
        #[cfg(unix)]
        // SAFETY: getuid() is always safe to call (no preconditions, never fails)
        let uid = unsafe { bun_sys::c::getuid() };
        #[cfg(windows)]
        let uid = bun_sys::windows::user_unique_id();

        // PORT NOTE: Zig used `switch (PATH.len > 0) { inline else => |path_is_nonzero| ... }`
        // to monomorphize the format string. Collapsed to a runtime branch.
        // PERF(port): was comptime bool dispatch — profile in Phase B
        path = {
            let mut v = Vec::new();
            let path_is_nonzero = !path.is_empty();
            // TODO(port): bun.pathLiteral() applied platform separator at comptime.
            write!(
                &mut v,
                "{tmp}{sep}bunx-{uid}-{pkg}{sep}node_modules{sep}.bin",
                tmp = BStr::new(temp_dir),
                sep = bun_paths::SEP as char,
                uid = uid,
                pkg = BStr::new(&package_fmt),
            )
            .map_err(|_| bun_core::err!("OutOfMemory"))?;
            if path_is_nonzero {
                v.push(DELIMITER);
                v.extend_from_slice(&path);
            }
            v
        };

        this_transpiler.env.map.put(b"PATH", &path)?;
        // TODO(port): std.fmt.count("{d}", .{uid}) — compute decimal digit count of uid.
        let uid_digits = bun_core::fmt::count_digits(uid as u64);
        let bunx_cache_dir: &[u8] =
            &path[0..temp_dir.len() + b"/bunx--".len() + package_fmt.len() + uid_digits];

        bun_output::scoped_log!(bunx, "bunx_cache_dir: {}", BStr::new(bunx_cache_dir));

        let mut absolute_in_cache_dir_buf = PathBuffer::uninit();
        let mut absolute_in_cache_dir: &[u8] = {
            let mut cursor: &mut [u8] = &mut absolute_in_cache_dir_buf[..];
            write!(
                cursor,
                "{cache}{sep}node_modules{sep}.bin{sep}{bin}{exe}",
                cache = BStr::new(bunx_cache_dir),
                sep = bun_paths::SEP as char,
                bin = BStr::new(initial_bin_name),
                exe = bun_core::EXE_SUFFIX,
            )
            .map_err(|_| bun_core::err!("PathTooLong"))?;
            let written = absolute_in_cache_dir_buf.len() - cursor.len();
            // PORT NOTE: reshaped for borrowck — re-slice from buffer
            // SAFETY: `written` bytes were just initialized above
            unsafe { core::slice::from_raw_parts(absolute_in_cache_dir_buf.as_ptr(), written) }
        };

        let passthrough = opts.passthrough_list.as_slice();

        let mut do_cache_bust = update_request.version.tag == bun_semver::VersionTag::DistTag;
        let look_for_existing_bin =
            update_request.version.literal.is_empty() || update_request.version.tag != bun_semver::VersionTag::DistTag;

        bun_output::scoped_log!(bunx, "try run existing? {}", look_for_existing_bin);
        if look_for_existing_bin {
            'try_run_existing: {
                let mut destination_: Option<&ZStr> = None;

                // Only use the system-installed version if there is no version specified
                if update_request.version.literal.is_empty() {
                    // If the bin name is a guess derived from a scoped package name,
                    // exclude the original system $PATH so we don't match unrelated
                    // system binaries. Only search local node_modules/.bin directories.
                    destination_ = PATH_BUF.with_borrow_mut(|path_buf| {
                        bun_core::which(
                            path_buf,
                            if initial_bin_name_is_a_guess { &local_bin_dirs } else { &path_for_bin_dirs },
                            if !ignore_cwd.is_empty() { b"" } else { this_transpiler.fs.top_level_dir },
                            initial_bin_name,
                        )
                    });
                    // TODO(port): bun.which writes into path_buf and returns a slice borrowing it;
                    // thread_local borrow scope makes this awkward. Phase B may move path_buf to a local.
                }

                // Similar to "npx":
                //
                //  1. Try the bin in the current node_modules and then we try the bin in the global cache
                let dest_or_cache = destination_.or_else(|| {
                    PATH_BUF.with_borrow_mut(|path_buf| {
                        bun_core::which(
                            path_buf,
                            bunx_cache_dir,
                            if !ignore_cwd.is_empty() { b"" } else { this_transpiler.fs.top_level_dir },
                            absolute_in_cache_dir,
                        )
                    })
                });
                if let Some(destination) = dest_or_cache {
                    let out: &[u8] = destination.as_bytes();

                    // If this directory was installed by bunx, we want to perform cache invalidation on it
                    // this way running `bunx hello` will update hello automatically to the latest version
                    if strings::has_prefix(out, bunx_cache_dir) {
                        let is_stale: bool = 'is_stale: {
                            #[cfg(windows)]
                            {
                                use bun_sys::windows as win;
                                let fd = match bun_sys::openat(Fd::cwd(), destination, O::RDONLY, 0).unwrap_result() {
                                    Ok(fd) => fd,
                                    Err(_) => {
                                        // if we cant open this, we probably will just fail when we run it
                                        // and that error message is likely going to be better than the one from `bun add`
                                        break 'is_stale false;
                                    }
                                };
                                // PORT NOTE: `defer fd.close()` → Drop on Fd guard.
                                // TODO(port): ensure Fd has RAII close or close explicitly here.

                                // SAFETY: all-zero is a valid IO_STATUS_BLOCK (repr(C) POD, no niches)
                                let mut io_status_block: win::IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };
                                // SAFETY: all-zero is a valid FILE_BASIC_INFORMATION (repr(C) POD, no niches)
                                let mut info: win::FILE_BASIC_INFORMATION = unsafe { core::mem::zeroed() };
                                // SAFETY: FFI call with valid out-params
                                let rc = unsafe {
                                    win::ntdll::NtQueryInformationFile(
                                        fd.cast(),
                                        &mut io_status_block,
                                        (&mut info as *mut win::FILE_BASIC_INFORMATION).cast(),
                                        u32::try_from(size_of::<win::FILE_BASIC_INFORMATION>()).unwrap(),
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
                                // SAFETY: all-zero is a valid posix Stat (repr(C) POD)
                                let mut stat: bun_sys::posix::Stat = unsafe { core::mem::zeroed() };
                                // SAFETY: destination is NUL-terminated, stat is a valid out-param
                                let rc = unsafe { bun_sys::c::stat(destination.as_ptr().cast(), &mut stat) };
                                if rc != 0 {
                                    break 'is_stale true;
                                }
                                break 'is_stale bun_core::time::timestamp() - stat.mtime().sec > Self::SECONDS_CACHE_VALID;
                            }
                        };

                        if is_stale {
                            bun_output::scoped_log!(bunx, "found stale binary: {}", BStr::new(out));
                            do_cache_bust = true;
                            if opts.no_install {
                                Output::warn(
                                    "Using a stale installation of <b>{}<r> because --no-install was passed. Run `bunx` without --no-install to use a fresh binary.",
                                    format_args!("{}", BStr::new(&update_request.name)),
                                );
                            } else {
                                break 'try_run_existing;
                            }
                        }
                    }

                    bun_output::scoped_log!(bunx, "running existing binary: {}", BStr::new(destination.as_bytes()));
                    Run::run_binary(
                        ctx,
                        this_transpiler.fs.dirname_store.append(out)?,
                        destination,
                        this_transpiler.fs.top_level_dir,
                        &this_transpiler.env,
                        passthrough,
                        None,
                    )?;
                    // runBinary is noreturn
                    unreachable!();
                }

                // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
                // BUT: Skip this if --package was used, as the user explicitly specified the binary name
                let root_dir_fd = root_dir_info.get_file_descriptor();
                debug_assert!(root_dir_fd.is_valid());
                if opts.binary_name.is_none() {
                    match Self::get_bin_name(&mut this_transpiler, root_dir_fd, bunx_cache_dir, result_package_name) {
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
                                        exe = bun_core::EXE_SUFFIX,
                                    )
                                    .expect("unreachable");
                                    let written = absolute_in_cache_dir_buf.len() - cursor.len();
                                    // SAFETY: `written` bytes initialized above
                                    unsafe { core::slice::from_raw_parts(absolute_in_cache_dir_buf.as_ptr(), written) }
                                };

                                // Only use the system-installed version if there is no version specified.
                                // `package_name_for_bin` is the real bin name from the target package's
                                // own package.json. Search only local node_modules/.bin directories for
                                // it — not the system $PATH, because the real bin name may itself collide
                                // with an unrelated system binary when the package lives only in the bunx
                                // cache (handled by the `orelse` absolute-path probe below) and not in a
                                // local node_modules.
                                if update_request.version.literal.is_empty() {
                                    destination_ = PATH_BUF.with_borrow_mut(|path_buf| {
                                        bun_core::which(
                                            path_buf,
                                            &local_bin_dirs,
                                            if !ignore_cwd.is_empty() { b"" } else { this_transpiler.fs.top_level_dir },
                                            &package_name_for_bin,
                                        )
                                    });
                                }

                                let dest_or_cache2 = destination_.or_else(|| {
                                    PATH_BUF.with_borrow_mut(|path_buf| {
                                        bun_core::which(
                                            path_buf,
                                            bunx_cache_dir,
                                            if !ignore_cwd.is_empty() { b"" } else { this_transpiler.fs.top_level_dir },
                                            absolute_in_cache_dir,
                                        )
                                    })
                                });
                                if let Some(destination) = dest_or_cache2 {
                                    let out: &[u8] = destination.as_bytes();
                                    Run::run_binary(
                                        ctx,
                                        this_transpiler.fs.dirname_store.append(out)?,
                                        destination,
                                        this_transpiler.fs.top_level_dir,
                                        &this_transpiler.env,
                                        passthrough,
                                        None,
                                    )?;
                                    // runBinary is noreturn
                                    unreachable!();
                                }
                            }
                        }
                        Err(err) => {
                            if err == GetBinNameError::NoBinFound {
                                if opts.specified_package.is_some() && opts.binary_name.is_some() {
                                    Output::err_generic(
                                        "Package <b>{}<r> does not provide a binary named <b>{}<r>",
                                        format_args!(
                                            "{} {}",
                                            BStr::new(&update_request.name),
                                            BStr::new(opts.binary_name.unwrap()),
                                        ),
                                    );
                                    // TODO(port): Output API takes a single format_args; Zig had two slots.
                                    Output::prettyln(
                                        "  <d>hint: try running without --package to install and run {} directly<r>",
                                        format_args!("{}", BStr::new(opts.binary_name.unwrap())),
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

        // TODO(port): Zig used std.fs.cwd().makeOpenPath; map to bun_sys recursive mkdir + open.
        let bunx_install_dir = bun_sys::make_open_path(Fd::cwd(), bunx_cache_dir)?;

        'create_package_json: {
            // create package.json, but only if it doesn't exist
            let package_json = match bun_sys::File::create_at_z(
                bunx_install_dir,
                ZStr::from_literal(b"package.json\0"),
                bun_sys::CreateOptions { truncate: true, ..Default::default() },
            ) {
                Ok(f) => f,
                Err(_) => break 'create_package_json,
            };
            // TODO(port): Zig used std.fs.Dir.createFileZ; mapped to bun_sys::File::create_at_z.
            let _ = package_json.write_all(b"{}\n");
            // PORT NOTE: `defer package_json.close()` → Drop.
        }

        let mut args: BoundedArray<&[u8], 8> = BoundedArray::from_slice(&[
            bun_core::self_exe_path()?,
            b"add",
            &install_param,
            b"--no-summary",
        ])
        .expect("unreachable"); // upper bound is known

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
        this_transpiler.env.map.put(b"BUN_INTERNAL_BUNX_INSTALL", b"true").expect("oom");

        let spawn_result = match bun_core::spawn_sync(&bun_core::SpawnSyncOptions {
            argv: argv_to_use,

            envp: this_transpiler.env.map.create_null_delimited_env_map()?,

            cwd: bunx_cache_dir,
            stderr: bun_core::Stdio::Inherit,
            stdout: bun_core::Stdio::Inherit,
            stdin: bun_core::Stdio::Inherit,

            #[cfg(windows)]
            windows: bun_core::SpawnWindowsOptions {
                loop_: bun_jsc::EventLoopHandle::init(bun_jsc::MiniEventLoop::init_global(&this_transpiler.env, None)),
            },
            ..Default::default()
        }) {
            Err(err) => {
                Output::pretty_errorln(
                    "<r><red>error<r>: bunx failed to install <b>{}<r> due to error <b>{}<r>",
                    format_args!("{} {}", BStr::new(&install_param), err.name()),
                );
                // TODO(port): @errorName(err) → err.name()
                Global::exit(1);
            }
            Ok(maybe) => match maybe {
                bun_sys::Result::Err(_err) => {
                    Global::exit(1);
                }
                bun_sys::Result::Ok(result) => result,
            },
        };

        match spawn_result.status {
            bun_core::SpawnStatus::Exited(exit) => {
                if exit.signal.valid() {
                    if bun_core::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() {
                        bun_crash_handler::suppress_reporting();
                    }

                    Global::raise_ignoring_panic_handler(exit.signal);
                }

                if exit.code != 0 {
                    Global::exit(exit.code);
                }
            }
            bun_core::SpawnStatus::Signaled(signal) => {
                if bun_core::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() {
                    bun_crash_handler::suppress_reporting();
                }

                Global::raise_ignoring_panic_handler(signal);
            }
            bun_core::SpawnStatus::Err(err) => {
                Output::pretty_errorln(
                    "<r><red>error<r>: bunx failed to install <b>{}<r> due to error:\n{}",
                    format_args!("{} {}", BStr::new(&install_param), err),
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
                exe = bun_core::EXE_SUFFIX,
            )
            .expect("unreachable");
            let written = absolute_in_cache_dir_buf.len() - cursor.len();
            // SAFETY: `written` bytes initialized above
            unsafe { core::slice::from_raw_parts(absolute_in_cache_dir_buf.as_ptr(), written) }
        };

        // Similar to "npx":
        //
        //  1. Try the bin in the global cache
        //     Do not try $PATH because we already checked it above if we should
        if let Some(destination) = PATH_BUF.with_borrow_mut(|path_buf| {
            bun_core::which(
                path_buf,
                bunx_cache_dir,
                if !ignore_cwd.is_empty() { b"" } else { this_transpiler.fs.top_level_dir },
                absolute_in_cache_dir,
            )
        }) {
            let out: &[u8] = destination.as_bytes();
            Run::run_binary(
                ctx,
                this_transpiler.fs.dirname_store.append(out)?,
                destination,
                this_transpiler.fs.top_level_dir,
                &this_transpiler.env,
                passthrough,
                None,
            )?;
            // runBinary is noreturn
            unreachable!();
        }

        // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
        // BUT: Skip this if --package was used, as the user explicitly specified the binary name
        if opts.binary_name.is_none() {
            if let Ok(package_name_for_bin) =
                Self::get_bin_name_from_temp_directory(&mut this_transpiler, bunx_cache_dir, result_package_name, false)
            {
                if !strings::eql_long(&package_name_for_bin, initial_bin_name, true) {
                    absolute_in_cache_dir = {
                        let mut cursor: &mut [u8] = &mut absolute_in_cache_dir_buf[..];
                        write!(
                            cursor,
                            "{}/node_modules/.bin/{}{}",
                            BStr::new(bunx_cache_dir),
                            BStr::new(&package_name_for_bin),
                            bun_core::EXE_SUFFIX,
                        )
                        .expect("unreachable");
                        let written = absolute_in_cache_dir_buf.len() - cursor.len();
                        // SAFETY: `written` bytes initialized above
                        unsafe { core::slice::from_raw_parts(absolute_in_cache_dir_buf.as_ptr(), written) }
                    };

                    if let Some(destination) = PATH_BUF.with_borrow_mut(|path_buf| {
                        bun_core::which(
                            path_buf,
                            bunx_cache_dir,
                            if !ignore_cwd.is_empty() { b"" } else { this_transpiler.fs.top_level_dir },
                            absolute_in_cache_dir,
                        )
                    }) {
                        let out: &[u8] = destination.as_bytes();
                        Run::run_binary(
                            ctx,
                            this_transpiler.fs.dirname_store.append(out)?,
                            destination,
                            this_transpiler.fs.top_level_dir,
                            &this_transpiler.env,
                            passthrough,
                            None,
                        )?;
                        // runBinary is noreturn
                        unreachable!();
                    }
                }
            }
        }

        if opts.specified_package.is_some() && opts.binary_name.is_some() {
            Output::err_generic(
                "Package <b>{}<r> does not provide a binary named <b>{}<r>",
                format_args!("{} {}", BStr::new(&update_request.name), BStr::new(opts.binary_name.unwrap())),
            );
            // TODO(port): Output API — Zig used two positional {s} slots
            Output::prettyln(
                "  <d>hint: try running without --package to install and run {} directly<r>",
                format_args!("{}", BStr::new(opts.binary_name.unwrap())),
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/bunx_command.zig (923 lines)
//   confidence: medium
//   todos:      18
//   notes:      bun.which/PATH_BUF borrow scoping + Output fmt API + bufPrint helpers need Phase B fixes; Options string fields use &'static [u8] placeholder for argv lifetime
// ──────────────────────────────────────────────────────────────────────────
