use bun_collections::VecExt;
use std::io::Write as _;

use crate::cli::ci_info as ci;
use bun_alloc::AllocError;
use bun_ast::{E, Expr, G};
use bun_core::MutableString;
use bun_core::fmt as bun_fmt;
use bun_core::{Environment, Error, Global, Output, err};
use bun_core::{ZStr, strings};
use bun_dotenv as dotenv;
use bun_http as http;
use bun_http::HeaderBuilder;
use bun_install::lockfile::{LoadResult, LoadStep};
use bun_install::{self as install, Dependency, Lockfile, Npm, PackageManager, Subcommand};
use bun_libarchive::lib::{Archive, ArchiveIterator, IteratorResult as ArchiveIterResult};
use bun_parsers::json as json_mod;
use bun_paths::resolve_path::{join_abs_string_buf_z, normalize_buf, normalize_buf_z};
use bun_paths::{self as path, PathBuffer};
use bun_resolver::fs::FileSystem;
use bun_sha_hmac as sha;
use bun_simdutf_sys::simdutf;
use bun_sys::dir_iterator as DirIterator;
use bun_sys::{self, Fd, File, FileKind};
use bun_url::URL;
// `LogLevel`/`AuthType`/`Access` from `bun_install::PackageManagerOptions`.
use bun_ast::expr::Data as ExprData;
use bun_core::OSPathChar;
pub use bun_install::Access;
use bun_install::dependency;
use bun_install::{AuthType, LogLevel};
use bun_sys::FdExt as _;

use crate::api::bun_process::sync as spawn_sync;

// `json_mod::parse_utf8` returns `bun_ast::Expr` (the value-shaped
// JSON-only `Expr`), not `bun_ast::Expr`, so `Expr::get_string_cloned`
// can't be applied. Mirror the lookup as a free fn over the JSON `Expr` using
// its own `as_property` / `as_string_cloned` surface.
#[inline]
fn json_get_string_cloned<'b>(
    expr: &bun_ast::Expr,
    bump: &'b bun_alloc::Arena,
    name: &[u8],
) -> Result<Option<&'b [u8]>, AllocError> {
    match expr.as_property(name) {
        Some(q) => q.expr.as_string_cloned(bump),
        None => Ok(None),
    }
}

use crate::Command;
use crate::cli::pack_command::{self as pack, PackCommand as Pack};

pub struct ReadmeInfo {
    pub filename: Vec<u8>,
    pub contents: Vec<u8>,
}

/// Matches npm's `{README,README.*}` glob case-insensitively. Generic
/// over char type so it works for both UTF-8 readdir entries and UTF-16
/// tar entry names on Windows.
fn is_readme_filename_t<T: bun_core::NoUninit + Into<u32>>(name: &[T]) -> bool {
    const README: &[u8] = b"README";
    if name.len() < README.len() {
        return false;
    }
    if !strings::eql_case_insensitive_t(&name[..README.len()], README) {
        return false;
    }
    name.len() == README.len() || name[README.len()].into() == u32::from(b'.')
}

#[inline]
fn is_readme_filename(name: &[u8]) -> bool {
    is_readme_filename_t(name)
}

#[inline]
fn is_readme_os_path(name: &[OSPathChar]) -> bool {
    is_readme_filename_t(name)
}

use crate::cli::init_command::InitCommand;
use crate::cli::open;
use crate::run_command::RunCommand as Run;

// TODO(port): inherent associated type `Digest = [u8; N]` requires nightly
// `inherent_associated_types`; mirror pack_command.rs and spell the array out.
type SHA1Digest = [u8; sha::SHA1::DIGEST];
type SHA512Digest = [u8; sha::SHA512::DIGEST];

pub struct PublishCommand;

// TODO(port): Zig used `if (directory_publish) ?[]const u8 else void` for the script fields
// and `if (directory_publish) *DotEnv.Loader else void` for script_env. Rust const generics
// cannot vary field types; we keep them as Option<> in both instantiations and rely on
// invariants (always None / never used when DIRECTORY_PUBLISH == false).
pub struct Context<'a, const DIRECTORY_PUBLISH: bool> {
    pub manager: &'a mut PackageManager,
    pub command_ctx: Command::Context<'a>,

    pub package_name: Box<[u8]>,
    pub package_version: Box<[u8]>,
    pub abs_tarball_path: Box<ZStr>,
    pub tarball_bytes: Box<[u8]>,
    pub shasum: SHA1Digest,
    pub integrity: SHA512Digest,
    pub uses_workspaces: bool,

    pub normalized_pkg_info: Box<[u8]>,

    pub publish_script: Option<Box<[u8]>>,
    pub postpublish_script: Option<Box<[u8]>>,
    pub script_env: Option<&'a mut dotenv::Loader<'a>>,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum FromTarballError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("MissingPackageJSON")]
    MissingPackageJSON,
    #[error("InvalidPackageJSON")]
    InvalidPackageJSON,
    #[error("MissingPackageName")]
    MissingPackageName,
    #[error("MissingPackageVersion")]
    MissingPackageVersion,
    #[error("InvalidPackageName")]
    InvalidPackageName,
    #[error("InvalidPackageVersion")]
    InvalidPackageVersion,
    #[error("PrivatePackage")]
    PrivatePackage,
    #[error("RestrictedUnscopedPackage")]
    RestrictedUnscopedPackage,
}
bun_core::oom_from_alloc!(FromTarballError);

// TODO(port): Zig defined this as a nested type alias on the Context struct;
// inherent associated types are unstable (rust#8995) so hoist to module scope.
pub type FromWorkspaceError = pack::PackError<true>;

impl<'a, const DIRECTORY_PUBLISH: bool> Context<'a, DIRECTORY_PUBLISH> {
    /// Retrieve information for publishing from a tarball path, `bun publish path/to/tarball.tgz`
    pub fn from_tarball_path(
        ctx: Command::Context<'a>,
        manager: &'a mut PackageManager,
        tarball_path: &[u8],
    ) -> Result<Context<'a, DIRECTORY_PUBLISH>, FromTarballError> {
        let mut abs_buf = PathBuffer::uninit();
        let abs_tarball_path = join_abs_string_buf_z::<path::platform::Auto>(
            FileSystem::instance().top_level_dir,
            &mut abs_buf,
            &[tarball_path],
        );

        let tarball_bytes = match File::read_from(Fd::cwd(), abs_tarball_path) {
            Ok(b) => b,
            Err(e) => {
                Output::err(
                    e,
                    "failed to read tarball: '{}'",
                    (bstr::BStr::new(tarball_path),),
                );
                Global::crash();
            }
        };

        let mut maybe_package_json_contents: Option<Box<[u8]>> = None;
        let mut maybe_readme: Option<ReadmeInfo> = None;

        let mut iter = match ArchiveIterator::init(&tarball_bytes) {
            ArchiveIterResult::Err { archive, message } => {
                Output::err_generic(
                    "{}: {}",
                    (
                        bstr::BStr::new(message),
                        bstr::BStr::new(Archive::error_string(archive)),
                    ),
                );
                Global::crash();
            }
            ArchiveIterResult::Result(res) => res,
        };

        let mut unpacked_size: usize = 0;
        let mut total_files: usize = 0;

        Output::print(format_args!("\n"));

        loop {
            let next = match iter.next() {
                ArchiveIterResult::Err { archive, message } => {
                    Output::err_generic(
                        "{}: {}",
                        (
                            bstr::BStr::new(message),
                            bstr::BStr::new(Archive::error_string(archive)),
                        ),
                    );
                    Global::crash();
                }
                ArchiveIterResult::Result(res) => res,
            };
            let Some(next) = next else { break };

            // SAFETY: `next.entry` is valid until the next `iter.next()` call.
            let entry = unsafe { &*next.entry };
            #[cfg(windows)]
            let pathname: &[OSPathChar] = entry.pathname_w().as_slice();
            #[cfg(not(windows))]
            let pathname: &[OSPathChar] = entry.pathname().as_bytes();

            let size = entry.size();

            unpacked_size += usize::try_from(size.max(0)).expect("int cast");
            total_files += usize::from(next.kind == FileKind::File);

            // this is option `strip: 1` (npm expects a `package/` prefix for all paths)
            if let Some(slash) = pathname.iter().position(|&c| bun_paths::is_sep_any_t(c)) {
                let stripped = &pathname[slash + 1..];
                if stripped.is_empty() {
                    continue;
                }

                Output::pretty(format_args!(
                    "<b><cyan>packed<r> {} {}\n",
                    bun_fmt::size(
                        usize::try_from(size.max(0)).expect("int cast"),
                        bun_fmt::SizeFormatterOptions {
                            space_between_number_and_unit: false
                        }
                    ),
                    bun_fmt::fmt_os_path(stripped, Default::default()),
                ));

                if next.kind != FileKind::File {
                    continue;
                }

                if !stripped.iter().any(|&c| bun_paths::is_sep_any_t(c)) {
                    // check for package.json, readme.md, ...
                    let filename = &pathname[slash + 1..];

                    if maybe_package_json_contents.is_none()
                        && strings::eql_case_insensitive_t(filename, b"package.json")
                    {
                        maybe_package_json_contents = match next.read_entry_data(iter.archive)? {
                            ArchiveIterResult::Err { archive, message } => {
                                Output::err_generic(
                                    "{}: {}",
                                    (
                                        bstr::BStr::new(message),
                                        bstr::BStr::new(Archive::error_string(archive)),
                                    ),
                                );
                                Global::crash();
                            }
                            ArchiveIterResult::Result(bytes) => Some(bytes),
                        };
                    } else if maybe_readme.is_none() && is_readme_os_path(filename) {
                        // First matching README wins — libarchive iteration is one-shot.
                        let bytes = match next.read_entry_data(iter.archive)? {
                            ArchiveIterResult::Err { archive, message } => {
                                Output::err_generic(
                                    "{}: {}",
                                    (
                                        bstr::BStr::new(message),
                                        bstr::BStr::new(Archive::error_string(archive)),
                                    ),
                                );
                                Global::crash();
                            }
                            ArchiveIterResult::Result(bytes) => bytes,
                        };
                        #[cfg(not(windows))]
                        let filename_utf8: Vec<u8> = filename.to_vec();
                        #[cfg(windows)]
                        let filename_utf8: Vec<u8> = strings::to_utf8_alloc(filename);
                        maybe_readme = Some(ReadmeInfo {
                            filename: filename_utf8,
                            contents: bytes.into_vec(),
                        });
                    }
                }
            } else {
                Output::pretty(format_args!(
                    "<b><cyan>packed<r> {} {}\n",
                    bun_fmt::size(
                        usize::try_from(size.max(0)).expect("int cast"),
                        bun_fmt::SizeFormatterOptions {
                            space_between_number_and_unit: false
                        }
                    ),
                    bun_fmt::fmt_os_path(pathname, Default::default()),
                ));
            }
        }

        match iter.close() {
            ArchiveIterResult::Err { archive, message } => {
                Output::err_generic(
                    "{}: {}",
                    (
                        bstr::BStr::new(message),
                        bstr::BStr::new(Archive::error_string(archive)),
                    ),
                );
                Global::crash();
            }
            ArchiveIterResult::Result(()) => {}
        }

        let package_json_contents =
            maybe_package_json_contents.ok_or(FromTarballError::MissingPackageJSON)?;

        // PORT NOTE: adopt `package_json_contents` (already an owned `Box<[u8]>`)
        // into the process-lifetime side-table so the `Source` borrow stays
        // alive across `normalized_package` (Zig held an arena slice). Zero-copy.
        let package_json_contents: &'static [u8] = crate::cli::cli_adopt(package_json_contents);

        let bump = bun_alloc::Arena::new();
        let (package_name, package_version, json, json_source) = {
            let source = bun_ast::Source::init_path_string(b"package.json", package_json_contents);
            let log = manager.log_mut();
            let json = match json_mod::parse_package_json_utf8(&source, log, &bump) {
                Ok(j) => j,
                Err(e) => {
                    if e == err!(OutOfMemory) {
                        return Err(FromTarballError::OutOfMemory);
                    }
                    return Err(FromTarballError::InvalidPackageJSON);
                }
            };

            if let Some(private) = json.get(b"private") {
                if let Some(is_private) = private.as_bool() {
                    if is_private {
                        return Err(FromTarballError::PrivatePackage);
                    }
                }
            }

            if let Some(config) = json.get(b"publishConfig") {
                if manager.options.publish_config.tag.is_empty() {
                    if let Some(tag) = json_get_string_cloned(&config, &bump, b"tag")? {
                        // PORT NOTE: `PublishConfig.tag` is `&'static [u8]`; dupe the
                        // bump-owned slice into the process-lifetime CLI arena.
                        manager.options.publish_config.tag = crate::cli::cli_dupe(tag);
                    }
                }

                if manager.options.publish_config.access.is_none() {
                    if let Some(access) = json_get_string_cloned(&config, &bump, b"access")? {
                        manager.options.publish_config.access = match Access::from_str(access) {
                            Some(a) => Some(a),
                            None => {
                                Output::err_generic(
                                    "invalid `access` value: '{}'",
                                    (bstr::BStr::new(access),),
                                );
                                Global::crash();
                            }
                        };
                    }
                }

                // maybe otp
            }

            let name: Box<[u8]> = json_get_string_cloned(&json, &bump, b"name")?
                .ok_or(FromTarballError::MissingPackageName)?
                .into();
            let is_scoped = dependency::is_scoped_package_name(&name)
                .map_err(|_| FromTarballError::InvalidPackageName)?;

            if let Some(access) = manager.options.publish_config.access {
                if access == Access::Restricted && !is_scoped {
                    return Err(FromTarballError::RestrictedUnscopedPackage);
                }
            }

            let version: Box<[u8]> = json_get_string_cloned(&json, &bump, b"version")?
                .ok_or(FromTarballError::MissingPackageVersion)?
                .into();
            if version.is_empty() {
                return Err(FromTarballError::InvalidPackageVersion);
            }

            (name, version, json, source)
        };

        let mut shasum: SHA1Digest = [0u8; sha::SHA1::DIGEST];
        let mut sha1 = sha::SHA1::init();
        sha1.update(&tarball_bytes);
        sha1.r#final(&mut shasum);
        drop(sha1);

        let mut integrity: SHA512Digest = [0u8; sha::SHA512::DIGEST];
        let mut sha512 = sha::SHA512::init();
        sha512.update(&tarball_bytes);
        sha512.r#final(&mut integrity);
        drop(sha512);

        // `json_mod::parse_package_json_utf8` returns the value-shaped
        // `bun_ast::Expr`; `normalized_package` (and `print_json`)
        // operate on the full parser-shaped `bun_ast::Expr`. Lift via the
        // documented `From<bun_ast::Expr>` bridge — same conversion
        // `WorkspacePackageJSONCache::get_with_path` applies before stashing
        // `MapEntry.root`. The thread-local `data::Store` has already been
        // initialised by `PackageManager::init`.
        let mut json: Expr = Expr::from(json);
        let normalized_pkg_info = PublishCommand::normalized_package(
            manager,
            &package_name,
            &package_version,
            &mut json,
            &json_source,
            shasum,
            integrity,
            maybe_readme,
        )?;

        pack::Context::print_summary(
            pack::Stats {
                total_files,
                unpacked_size,
                packed_size: tarball_bytes.len(),
                ..Default::default()
            },
            Some(&shasum),
            Some(&integrity),
            manager.options.log_level,
        );

        Ok(Context {
            manager,
            command_ctx: ctx,
            package_name,
            package_version,
            abs_tarball_path: ZStr::boxed(abs_tarball_path.as_bytes()),
            tarball_bytes: tarball_bytes.into(),
            shasum,
            integrity,
            uses_workspaces: false,
            normalized_pkg_info,
            publish_script: None,
            postpublish_script: None,
            script_env: None,
        })
    }

    /// `bun publish` without a tarball path. Automatically pack the current workspace and get
    /// information required for publishing
    // PORT NOTE: Zig declares this on the comptime-generic `Context(directory_publish)`
    // but only ever instantiates it as `Context(true).fromWorkspace`; lazy comptime
    // evaluation hid the `pack(true) -> Context(true)` mismatch for the unused
    // `false` branch. Rust type-checks all monomorphisations, so pin the return
    // type to the only valid shape. `'static` matches `pack::pack`'s return —
    // the embedded `&mut PackageManager` / `Command::Context` are process-
    // lifetime singletons reborrowed through raw pointers there.
    pub fn from_workspace(
        ctx: Command::Context<'a>,
        manager: &'a mut PackageManager,
    ) -> Result<Context<'static, true>, FromWorkspaceError> {
        let mut lockfile = Lockfile::default();
        let manager_ptr: *mut PackageManager = manager;
        let log: &mut bun_ast::Log = manager.log_mut();
        let load_from_disk_result =
            lockfile.load_from_cwd::<false>(Some(unsafe { &mut *manager_ptr }), log);

        let lockfile_ref: Option<&Lockfile> = match load_from_disk_result {
            LoadResult::Ok(ok) => Some(&*ok.lockfile),
            LoadResult::NotFound => None,
            LoadResult::Err(cause) => 'err: {
                match cause.step {
                    LoadStep::OpenFile => {
                        if cause.value == err!("ENOENT") {
                            break 'err None;
                        }
                        Output::err_generic("failed to open lockfile: {}", (cause.value.name(),));
                    }
                    LoadStep::ParseFile => {
                        Output::err_generic("failed to parse lockfile: {}", (cause.value.name(),));
                    }
                    LoadStep::ReadFile => {
                        Output::err_generic("failed to read lockfile: {}", (cause.value.name(),));
                    }
                    LoadStep::Migrating => {
                        Output::err_generic(
                            "failed to migrate lockfile: {}",
                            (cause.value.name(),),
                        );
                    }
                }

                if log.has_errors() {
                    let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                }

                Global::crash();
            }
        };

        // PORT NOTE: capture the package.json path before constructing
        // `pack::Context` so the `&mut PackageManager` borrow doesn't conflict.
        // SAFETY: `manager_ptr` came from `&'a mut PackageManager`.
        let abs_pkg_json = bun_core::ZBox::from_bytes(
            unsafe { &*manager_ptr }
                .original_package_json_path
                .as_bytes(),
        );

        let mut pack_ctx = pack::Context {
            // SAFETY: `manager_ptr` came from `&'a mut PackageManager`; the
            // overlapping borrow with `lockfile_ref` mirrors Zig's freely-
            // aliased `*PackageManager`.
            manager: unsafe { &mut *manager_ptr },
            command_ctx: ctx,
            lockfile: lockfile_ref,
            bundled_deps: Vec::new(),
            stats: pack::Stats::default(),
        };

        // `pack::<true>` returns `Some(Context<true>)` on success.
        Ok(pack::pack::<true>(&mut pack_ctx, &abs_pkg_json)?
            .expect("pack::<true> always yields a publish context"))
    }
}

impl PublishCommand {
    pub fn exec(ctx: Command::Context) -> Result<(), Error> {
        // TODO(port): narrow error set
        Output::prettyln(format_args!(
            "<r><b>bun publish <r><d>v{}<r>",
            Global::package_json_version_with_sha,
        ));
        Output::flush();

        let cli = install::CommandLineArguments::parse(Subcommand::Publish)?;

        let (manager, original_cwd) =
            match PackageManager::init(&mut *ctx, cli.clone(), Subcommand::Publish) {
                Ok(v) => v,
                Err(err) => {
                    if !cli.silent {
                        if err == bun_core::err!("MissingPackageJSON") {
                            Output::err_generic("missing package.json, nothing to publish", ());
                        }
                        Output::err_generic("failed to initialize bun install: {}", (err.name(),));
                    }
                    Global::crash();
                }
            };
        drop(original_cwd);
        let manager_ptr: *mut PackageManager = manager;

        if cli.positionals.len() > 1 {
            let context = match Context::<false>::from_tarball_path(
                ctx,
                manager,
                &cli.positionals[1],
            ) {
                Ok(c) => c,
                Err(err) => {
                    match err {
                        FromTarballError::OutOfMemory => bun_core::out_of_memory(),
                        FromTarballError::MissingPackageName => {
                            Output::err_generic("missing `name` string in package.json", ());
                        }
                        FromTarballError::MissingPackageVersion => {
                            Output::err_generic("missing `version` string in package.json", ());
                        }
                        FromTarballError::InvalidPackageName
                        | FromTarballError::InvalidPackageVersion => {
                            Output::err_generic(
                                "package.json `name` and `version` fields must be non-empty strings",
                                (),
                            );
                        }
                        FromTarballError::MissingPackageJSON => {
                            Output::err_generic(
                                "failed to find package.json in tarball '{}'",
                                (bstr::BStr::new(&cli.positionals[1]),),
                            );
                        }
                        FromTarballError::InvalidPackageJSON => {
                            // SAFETY: `manager.log` is set once at init.
                            let _ = unsafe { &mut *(*manager_ptr).log }
                                .print(std::ptr::from_mut(Output::error_writer()));
                            Output::err_generic("failed to parse tarball package.json", ());
                        }
                        FromTarballError::PrivatePackage => {
                            Output::err_generic("attempted to publish a private package", ());
                        }
                        FromTarballError::RestrictedUnscopedPackage => {
                            Output::err_generic(
                                "unable to restrict access to unscoped package",
                                (),
                            );
                        }
                    }
                    Global::crash();
                }
            };

            if let Err(err) = Self::publish::<false>(&context) {
                match err {
                    PublishError::OutOfMemory => bun_core::out_of_memory(),
                    PublishError::NeedAuth => {
                        Output::err_generic(
                            "missing authentication (run <cyan>`bunx npm login`<r>)",
                            (),
                        );
                        Global::crash();
                    }
                }
            }

            Output::prettyln(format_args!(
                "\n<green> +<r> {}@{}{}",
                bstr::BStr::new(&context.package_name),
                bstr::BStr::new(dependency::without_build_tag(&context.package_version)),
                if PackageManager::get().options.dry_run {
                    " (dry-run)"
                } else {
                    ""
                },
            ));

            return Ok(());
        }

        let context = match Context::<true>::from_workspace(ctx, manager) {
            Ok(c) => c,
            Err(err) => {
                use pack::PackError;
                match err {
                    PackError::OutOfMemory => bun_core::out_of_memory(),
                    PackError::MissingPackageName => {
                        Output::err_generic("missing `name` string in package.json", ());
                    }
                    PackError::MissingPackageVersion => {
                        Output::err_generic("missing `version` string in package.json", ());
                    }
                    PackError::InvalidPackageName | PackError::InvalidPackageVersion => {
                        Output::err_generic(
                            "package.json `name` and `version` fields must be non-empty strings",
                            (),
                        );
                    }
                    PackError::MissingPackageJSON => {
                        Output::err_generic(
                            "failed to find package.json from: '{}'",
                            (bstr::BStr::new(FileSystem::instance().top_level_dir),),
                        );
                    }
                    PackError::RestrictedUnscopedPackage => {
                        Output::err_generic("unable to restrict access to unscoped package", ());
                    }
                    PackError::PrivatePackage => {
                        Output::err_generic("attempted to publish a private package", ());
                    }
                }
                Global::crash();
            }
        };

        // TODO: read this into memory
        let _ = bun_sys::unlink(&context.abs_tarball_path);

        if let Err(err) = Self::publish::<true>(&context) {
            match err {
                PublishError::OutOfMemory => bun_core::out_of_memory(),
                PublishError::NeedAuth => {
                    Output::err_generic(
                        "missing authentication (run <cyan>`bunx npm login`<r>)",
                        (),
                    );
                    Global::crash();
                }
            }
        }

        Output::prettyln(format_args!(
            "\n<green> +<r> {}@{}{}",
            bstr::BStr::new(&context.package_name),
            bstr::BStr::new(dependency::without_build_tag(&context.package_version)),
            if PackageManager::get().options.dry_run {
                " (dry-run)"
            } else {
                ""
            },
        ));

        if PackageManager::get()
            .options
            .do_
            .contains(install::PackageManagerDoStub::RUN_SCRIPTS)
        {
            let abs_workspace_path: Box<[u8]> =
                strings::without_trailing_slash(strings::without_suffix_comptime(
                    PackageManager::get().original_package_json_path.as_bytes(),
                    b"package.json",
                ))
                .into();
            let script_env = context
                .script_env
                .expect("DIRECTORY_PUBLISH=true sets script_env");
            script_env
                .map
                .put(b"npm_command", b"publish")
                .map_err(|_| err!(OutOfMemory))?;

            // PORT NOTE: reshaped for borrowck — `command_ctx: &mut ContextData`
            // is held by `context`; `run_package_script_foreground` needs
            // `&mut ContextData` too. Re-derive from the raw pointer (mirrors
            // Zig's freely-aliased `Command.Context`).
            let cmd_ctx_ptr: *mut crate::cli::command::ContextData = context.command_ctx;

            if let Some(publish_script) = &context.publish_script {
                if let Err(e) = Run::run_package_script_foreground(
                    // SAFETY: see above.
                    unsafe { &mut *cmd_ctx_ptr },
                    publish_script,
                    b"publish",
                    &abs_workspace_path,
                    script_env,
                    &[],
                    context.manager.options.log_level == LogLevel::Silent,
                    // SAFETY: see above.
                    unsafe { &*cmd_ctx_ptr }.debug.use_system_shell,
                ) {
                    if e == err!("MissingShell") {
                        Output::err_generic(
                            "failed to find shell executable to run publish script",
                            (),
                        );
                        Global::crash();
                    }
                    return Err(e);
                }
            }

            if let Some(postpublish_script) = &context.postpublish_script {
                if let Err(e) = Run::run_package_script_foreground(
                    // SAFETY: see above.
                    unsafe { &mut *cmd_ctx_ptr },
                    postpublish_script,
                    b"postpublish",
                    &abs_workspace_path,
                    script_env,
                    &[],
                    context.manager.options.log_level == LogLevel::Silent,
                    // SAFETY: see above.
                    unsafe { &*cmd_ctx_ptr }.debug.use_system_shell,
                ) {
                    if e == err!("MissingShell") {
                        Output::err_generic(
                            "failed to find shell executable to run postpublish script",
                            (),
                        );
                        Global::crash();
                    }
                    return Err(e);
                }
            }
        }

        Ok(())
    }

    fn check_package_version_exists(
        package_name: &[u8],
        version: &[u8],
        registry: &Npm::Registry::Scope,
    ) -> bool {
        let mut url_buf: Vec<u8> = Vec::new();
        let registry_url = strings::without_trailing_slash(registry.url.href());
        let encoded_name = bun_fmt::dependency_url(package_name);

        // Try to get package metadata to check if version exists
        if write!(
            &mut url_buf,
            "{}/{}",
            bstr::BStr::new(registry_url),
            encoded_name
        )
        .is_err()
        {
            return false;
        }

        // PORT NOTE: `URL::parse` borrows; dupe into the process-lifetime CLI
        // arena so the URL outlives the local Vec (mirrors `allocPrint`
        // ownership in the Zig spec).
        let package_url = URL::parse(crate::cli::cli_dupe(&url_buf));

        let Ok(mut response_buf) = MutableString::init(1024) else {
            return false;
        };

        let mut headers = http::HeaderBuilder::default();
        headers.count(b"accept", b"application/json");

        let mut auth_buf: Vec<u8> = Vec::new();

        if !registry.token.is_empty() {
            if write!(&mut auth_buf, "Bearer {}", bstr::BStr::new(&registry.token)).is_err() {
                return false;
            }
            headers.count(b"authorization", &auth_buf);
        } else if !registry.auth.is_empty() {
            if write!(&mut auth_buf, "Basic {}", bstr::BStr::new(&registry.auth)).is_err() {
                return false;
            }
            headers.count(b"authorization", &auth_buf);
        }

        if headers.allocate().is_err() {
            return false;
        }
        headers.append(b"accept", b"application/json");

        if !registry.token.is_empty() {
            auth_buf.clear();
            if write!(&mut auth_buf, "Bearer {}", bstr::BStr::new(&registry.token)).is_err() {
                return false;
            }
            headers.append(b"authorization", &auth_buf);
        } else if !registry.auth.is_empty() {
            auth_buf.clear();
            if write!(&mut auth_buf, "Basic {}", bstr::BStr::new(&registry.auth)).is_err() {
                return false;
            }
            headers.append(b"authorization", &auth_buf);
        }

        let mut req = http::AsyncHTTP::init_sync(
            http::Method::GET,
            package_url,
            headers.entries,
            headers.content.written_slice(),
            &raw mut response_buf,
            b"",
            None,
            None,
            http::FetchRedirect::Follow,
        );

        let Ok(res) = req.send_sync() else {
            return false;
        };
        if res.status_code != 200 {
            return false;
        }

        // Parse the response to check if this specific version exists
        let source = bun_ast::Source::init_path_string(b"???", response_buf.list.as_slice());
        let mut log = bun_ast::Log::init();
        let bump = bun_alloc::Arena::new();
        let Ok(json) = json_mod::parse_utf8(&source, &mut log, &bump) else {
            return false;
        };

        // Check if the version exists in the versions object
        if let Some(versions) = json.get(b"versions") {
            if versions.get(version).is_some() {
                return true;
            }
        }

        false
    }

    pub fn publish<const DIRECTORY_PUBLISH: bool>(
        ctx: &Context<'_, DIRECTORY_PUBLISH>,
    ) -> Result<(), PublishError> {
        let registry = ctx.manager.scope_for_package_name(&ctx.package_name);
        let registry_url = registry.url.url();

        if registry.token.is_empty()
            && (registry_url.password.is_empty() || registry_url.username.is_empty())
        {
            return Err(PublishError::NeedAuth);
        }

        let tolerate_republish = ctx.manager.options.publish_config.tolerate_republish;
        if tolerate_republish {
            let version_without_build_tag = dependency::without_build_tag(&ctx.package_version);
            let package_exists = Self::check_package_version_exists(
                &ctx.package_name,
                version_without_build_tag,
                registry,
            );

            if package_exists {
                Output::warn(format_args!(
                    "Registry already knows about version {}; skipping.",
                    bstr::BStr::new(version_without_build_tag),
                ));
                return Ok(());
            }
        }

        // continues from `printSummary`
        Output::pretty(format_args!(
            "<b><blue>Tag<r>: {}\n<b><blue>Access<r>: {}\n<b><blue>Registry<r>: {}\n",
            bstr::BStr::new(if !ctx.manager.options.publish_config.tag.is_empty() {
                ctx.manager.options.publish_config.tag
            } else {
                b"latest"
            }),
            if let Some(access) = ctx.manager.options.publish_config.access {
                access.as_str()
            } else {
                "default"
            },
            bstr::BStr::new(registry.url.href()),
        ));

        // dry-run stops here
        if ctx.manager.options.dry_run {
            return Ok(());
        }

        // PORT NOTE: `AsyncHTTP::init_sync` requires `&'static [u8]` for the
        // request body (Zig had no lifetimes). Single-shot CLI path — adopt the
        // already-owned `Box<[u8]>` (base64-encoded tarball; can be multi-MB)
        // into the process-lifetime side-table. Zero-copy.
        let publish_req_body: &'static [u8] = crate::cli::cli_adopt(
            Self::construct_publish_request_body::<DIRECTORY_PUBLISH>(ctx)?,
        );

        let mut print_buf: Vec<u8> = Vec::new();

        let publish_headers = Self::construct_publish_headers(
            &mut print_buf,
            registry,
            Some(publish_req_body.len()),
            if !ctx.manager.options.publish_config.otp.is_empty() {
                Some(ctx.manager.options.publish_config.otp)
            } else {
                None
            },
            ctx.uses_workspaces,
            ctx.manager.options.publish_config.auth_type,
        )?;

        let mut response_buf = MutableString::init(1024)?;

        write!(
            &mut print_buf,
            "{}/{}",
            bstr::BStr::new(strings::without_trailing_slash(registry.url.href())),
            bun_fmt::dependency_url(&ctx.package_name),
        )
        .map_err(|_| AllocError)?;
        // PORT NOTE: `URL::parse` borrows; dupe into the process-lifetime CLI
        // arena so the URL outlives `print_buf.clear()` below (Zig's
        // `allocPrint` owned its buffer).
        let publish_url = URL::parse(crate::cli::cli_dupe(&print_buf));
        print_buf.clear();

        let mut req = http::AsyncHTTP::init_sync(
            http::Method::PUT,
            publish_url.clone(),
            publish_headers.entries,
            publish_headers.content.written_slice(),
            &raw mut response_buf,
            publish_req_body,
            None,
            None,
            http::FetchRedirect::Follow,
        );

        let res = match req.send_sync() {
            Ok(r) => r,
            Err(e) => {
                if e == err!(OutOfMemory) {
                    return Err(PublishError::OutOfMemory);
                }
                Output::err(e, "failed to publish package", ());
                Global::crash();
            }
        };

        match res.status_code {
            400..=u32::MAX => {
                let prompt_for_otp = 'prompt_for_otp: {
                    if res.status_code != 401 {
                        break 'prompt_for_otp false;
                    }

                    if let Some(www_authenticate) = res.headers.get(b"www-authenticate") {
                        let mut iter = strings::split(www_authenticate, b",");
                        while let Some(part) = iter.next() {
                            let trimmed = strings::trim(part, &strings::WHITESPACE_CHARS);
                            if strings::eql_case_insensitive_ascii(trimmed, b"ipaddress", true) {
                                Output::err_generic(
                                    "login is not allowed from your IP address",
                                    (),
                                );
                                Global::crash();
                            } else if strings::eql_case_insensitive_ascii(trimmed, b"otp", true) {
                                break 'prompt_for_otp true;
                            }
                        }

                        Output::err_generic(
                            "unable to authenticate, need: {}",
                            (bstr::BStr::new(www_authenticate),),
                        );
                        Global::crash();
                    } else if strings::contains(&response_buf.list, b"one-time pass") {
                        // missing www-authenicate header but one-time pass is still included
                        break 'prompt_for_otp true;
                    }

                    break 'prompt_for_otp false;
                };

                if !prompt_for_otp {
                    // general error
                    Npm::response_error::<false>(
                        &req,
                        &res,
                        Some((&ctx.package_name, &ctx.package_version)),
                        &mut response_buf,
                    )?;
                }

                // https://github.com/npm/cli/blob/534ad7789e5c61f579f44d782bdd18ea3ff1ee20/node_modules/npm-registry-fetch/lib/check-response.js#L14
                // ignore if x-local-cache exists
                if let Some(notice) = res
                    .headers
                    .get_if_other_is_absent(b"npm-notice", b"x-local-cache")
                {
                    Output::print_error(format_args!("\n"));
                    Output::note(format_args!("{}", bstr::BStr::new(notice)));
                    Output::flush();
                }

                let otp = Self::get_otp::<DIRECTORY_PUBLISH>(
                    ctx,
                    registry,
                    &mut response_buf,
                    &mut print_buf,
                )?;

                let otp_headers = Self::construct_publish_headers(
                    &mut print_buf,
                    registry,
                    Some(publish_req_body.len()),
                    Some(&otp),
                    ctx.uses_workspaces,
                    ctx.manager.options.publish_config.auth_type,
                )?;

                response_buf.reset();

                let mut otp_req = http::AsyncHTTP::init_sync(
                    http::Method::PUT,
                    publish_url,
                    otp_headers.entries,
                    otp_headers.content.written_slice(),
                    &raw mut response_buf,
                    publish_req_body,
                    None,
                    None,
                    http::FetchRedirect::Follow,
                );

                let otp_res = match otp_req.send_sync() {
                    Ok(r) => r,
                    Err(e) => {
                        if e == err!(OutOfMemory) {
                            return Err(PublishError::OutOfMemory);
                        }
                        Output::err(e, "failed to publish package", ());
                        Global::crash();
                    }
                };

                match otp_res.status_code {
                    400..=u32::MAX => {
                        Npm::response_error::<true>(
                            &otp_req,
                            &otp_res,
                            Some((&ctx.package_name, &ctx.package_version)),
                            &mut response_buf,
                        )?;
                    }
                    _ => {
                        // https://github.com/npm/cli/blob/534ad7789e5c61f579f44d782bdd18ea3ff1ee20/node_modules/npm-registry-fetch/lib/check-response.js#L14
                        // ignore if x-local-cache exists
                        if let Some(notice) = otp_res
                            .headers
                            .get_if_other_is_absent(b"npm-notice", b"x-local-cache")
                        {
                            Output::print_error(format_args!("\n"));
                            Output::note(format_args!("{}", bstr::BStr::new(notice)));
                            Output::flush();
                        }
                    }
                }
            }
            _ => {}
        }

        Ok(())
    }

    fn press_enter_to_open_in_browser(auth_url: &ZStr) {
        // unset `ENABLE_VIRTUAL_TERMINAL_INPUT` on windows. This prevents backspace from
        // deleting the entire line
        #[cfg(windows)]
        let _stdin_mode =
            bun_sys::windows::StdinModeGuard::set(bun_sys::windows::UpdateStdioModeFlagsOpts {
                unset: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT,
                ..Default::default()
            });

        loop {
            // SAFETY: `buffered_stdin()` returns a process-global `*mut`; single-threaded
            // access here mirrors Zig's `Output.buffered_stdin().reader()`.
            match unsafe { (*Output::buffered_stdin()).reader().read_byte() } {
                Ok(b'\n') => break,
                Ok(_) => continue,
                Err(_) => return,
            }
        }

        // PORT NOTE: Zig used `std.process.Child.init(&.{Open.opener, auth_url})
        // .spawnAndWait()`. Route through `bun.spawnSync` (PORTING.md §Spawning).
        let _ = spawn_sync::spawn(&spawn_sync::Options {
            argv: vec![Box::from(open::OPENER), Box::from(auth_url.as_bytes())],
            envp: None,
            stdin: spawn_sync::SyncStdio::Inherit,
            stdout: spawn_sync::SyncStdio::Inherit,
            stderr: spawn_sync::SyncStdio::Inherit,
            ..Default::default()
        });
    }

    fn get_otp<const DIRECTORY_PUBLISH: bool>(
        ctx: &Context<'_, DIRECTORY_PUBLISH>,
        registry: &Npm::Registry::Scope,
        response_buf: &mut MutableString,
        print_buf: &mut Vec<u8>,
    ) -> Result<Box<[u8]>, GetOTPError> {
        let bump = bun_alloc::Arena::new();
        let manager_log: &mut bun_ast::Log = ctx.manager.log_mut();
        let res_source = bun_ast::Source::init_path_string(b"???", response_buf.list.as_slice());

        let res_json = match json_mod::parse_utf8(&res_source, manager_log, &bump) {
            Ok(j) => Some(j),
            Err(e) => {
                if e == err!(OutOfMemory) {
                    return Err(GetOTPError::OutOfMemory);
                }
                // https://github.com/npm/cli/blob/63d6a732c3c0e9c19fd4d147eaa5cc27c29b168d/node_modules/npm-registry-fetch/lib/check-response.js#L65
                // invalid json is ignored
                None
            }
        };

        if let Some(json) = res_json {
            'try_web: {
                let Some(auth_url_str) = json_get_string_cloned(&json, &bump, b"authUrl")? else {
                    break 'try_web;
                };
                // PORT NOTE: bump-owned `&[u8]` — dupe into the process-lifetime
                // CLI arena so the spawned thread (which outlives `bump`) can
                // borrow it `'static`.
                let auth_url_str: &'static ZStr = {
                    let len = auth_url_str.len();
                    let buf: &'static mut [u8] =
                        crate::cli::cli_arena().alloc_slice_fill_default(len + 1);
                    buf[..len].copy_from_slice(auth_url_str);
                    // SAFETY: `buf[len] == 0`; arena-backed `'static`.
                    ZStr::from_buf(&buf[..], len)
                };

                // important to clone because it belongs to `response_buf`, and `response_buf` will be
                // reused with the following requests
                let Some(done_url_str) = json_get_string_cloned(&json, &bump, b"doneUrl")? else {
                    break 'try_web;
                };
                let done_url = URL::parse(crate::cli::cli_dupe(done_url_str));

                Output::prettyln(format_args!(
                    "\nAuthenticate your account at (press <b>ENTER<r> to open in browser):\n",
                ));

                const OFFSET: usize = 0;
                const PADDING: usize = 1;

                let horizontal = if Output::enable_ansi_colors_stdout() {
                    "─"
                } else {
                    "-"
                };
                let vertical = if Output::enable_ansi_colors_stdout() {
                    "│"
                } else {
                    "|"
                };
                let top_left = if Output::enable_ansi_colors_stdout() {
                    "┌"
                } else {
                    "|"
                };
                let top_right = if Output::enable_ansi_colors_stdout() {
                    "┐"
                } else {
                    "|"
                };
                let bottom_left = if Output::enable_ansi_colors_stdout() {
                    "└"
                } else {
                    "|"
                };
                let bottom_right = if Output::enable_ansi_colors_stdout() {
                    "┘"
                } else {
                    "|"
                };

                let width: usize = (PADDING * 2) + auth_url_str.len();

                for _ in 0..OFFSET {
                    Output::print(format_args!(" "));
                }
                Output::print(format_args!("{}", top_left));
                for _ in 0..width {
                    Output::print(format_args!("{}", horizontal));
                }
                Output::print(format_args!("{}\n", top_right));

                for _ in 0..OFFSET {
                    Output::print(format_args!(" "));
                }
                Output::print(format_args!("{}", vertical));
                for _ in 0..PADDING {
                    Output::print(format_args!(" "));
                }
                Output::pretty(format_args!(
                    "<b>{}<r>",
                    bstr::BStr::new(auth_url_str.as_bytes())
                ));
                for _ in 0..PADDING {
                    Output::print(format_args!(" "));
                }
                Output::print(format_args!("{}\n", vertical));

                for _ in 0..OFFSET {
                    Output::print(format_args!(" "));
                }
                Output::print(format_args!("{}", bottom_left));
                for _ in 0..width {
                    Output::print(format_args!("{}", horizontal));
                }
                Output::print(format_args!("{}\n", bottom_right));
                Output::flush();

                // on another thread because pressing enter is not required
                // TODO(port): Zig used std.Thread.spawn — bun_threading has no spawn; use std::thread::Builder
                match std::thread::Builder::new()
                    .spawn(move || Self::press_enter_to_open_in_browser(auth_url_str))
                {
                    Ok(_t) => { /* JoinHandle dropped → detached */ }
                    Err(_e) => {
                        Output::err(
                            "ThreadSpawn",
                            "failed to spawn thread for opening auth url",
                            (),
                        );
                        Global::crash();
                    }
                }

                let auth_headers = Self::construct_publish_headers(
                    print_buf,
                    registry,
                    None,
                    None,
                    ctx.uses_workspaces,
                    ctx.manager.options.publish_config.auth_type,
                )?;

                loop {
                    response_buf.reset();

                    // PORT NOTE: Zig copied `done_url`/`auth_headers.entries` by value each
                    // loop turn; in Rust both move into `init_sync`, so re-clone per iteration.
                    let mut req = http::AsyncHTTP::init_sync(
                        http::Method::GET,
                        done_url.clone(),
                        auth_headers.entries.clone()?,
                        auth_headers.content.written_slice(),
                        response_buf,
                        b"",
                        None,
                        None,
                        http::FetchRedirect::Follow,
                    );

                    let res = match req.send_sync() {
                        Ok(r) => r,
                        Err(e) => {
                            if e == err!(OutOfMemory) {
                                return Err(GetOTPError::OutOfMemory);
                            }
                            Output::err(e, "failed to send OTP request", ());
                            Global::crash();
                        }
                    };

                    match res.status_code {
                        202 => {
                            // retry
                            let nanoseconds: u64 = 'nanoseconds: {
                                if let Some(retry) = res.headers.get(b"retry-after") {
                                    'default: {
                                        let trimmed =
                                            strings::trim(retry, &strings::WHITESPACE_CHARS);
                                        // PORT NOTE: std.fmt.parseInt(u32, _, 10) — header value is bytes,
                                        // not UTF-8; use the byte-slice parser per PORTING.md.
                                        let Ok(seconds) = strings::parse_int::<u32>(trimmed, 10)
                                        else {
                                            break 'default;
                                        };
                                        break 'nanoseconds (seconds as u64) * 1_000_000_000;
                                    }
                                }

                                break 'nanoseconds 500 * 1_000_000;
                            };

                            std::thread::sleep(std::time::Duration::from_nanos(nanoseconds));
                            continue;
                        }
                        200 => {
                            // login successful
                            let done_bump = bun_alloc::Arena::new();
                            let otp_done_source = bun_ast::Source::init_path_string(
                                b"???",
                                response_buf.list.as_slice(),
                            );
                            let otp_done_json = match json_mod::parse_utf8(
                                &otp_done_source,
                                manager_log,
                                &done_bump,
                            ) {
                                Ok(j) => j,
                                Err(e) => {
                                    if e == err!(OutOfMemory) {
                                        return Err(GetOTPError::OutOfMemory);
                                    }
                                    Output::err("WebLogin", "failed to parse response json", ());
                                    Global::crash();
                                }
                            };

                            let token =
                                json_get_string_cloned(&otp_done_json, &done_bump, b"token")?
                                    .unwrap_or_else(|| {
                                        Output::err(
                                            "WebLogin",
                                            "missing `token` field in reponse json",
                                            (),
                                        );
                                        Global::crash();
                                    });

                            // https://github.com/npm/cli/blob/534ad7789e5c61f579f44d782bdd18ea3ff1ee20/node_modules/npm-registry-fetch/lib/check-response.js#L14
                            // ignore if x-local-cache exists
                            if let Some(notice) = res
                                .headers
                                .get_if_other_is_absent(b"npm-notice", b"x-local-cache")
                            {
                                Output::print_error(format_args!("\n"));
                                Output::note(format_args!("{}", bstr::BStr::new(notice)));
                                Output::flush();
                            }

                            return Ok(token.into());
                        }
                        _ => {
                            Npm::response_error::<false>(
                                &req,
                                &res,
                                Some((&ctx.package_name, &ctx.package_version)),
                                response_buf,
                            )?;
                        }
                    }
                }
            }
        }

        // classic
        match InitCommand::prompt(
            "\nThis operation requires a one-time password.\nEnter OTP: ",
            b"",
        ) {
            Ok(v) => Ok(v.into()),
            Err(e) => {
                if e == err!(OutOfMemory) {
                    return Err(GetOTPError::OutOfMemory);
                }
                Output::err(e, "failed to read OTP input", ());
                Global::crash();
            }
        }
    }

    pub fn normalized_package(
        manager: &mut PackageManager,
        package_name: &[u8],
        package_version: &[u8],
        json: &mut Expr,
        json_source: &bun_ast::Source,
        shasum: SHA1Digest,
        integrity: SHA512Digest,
        readme: Option<ReadmeInfo>,
    ) -> Result<Box<[u8]>, AllocError> {
        debug_assert!(json.is_object());

        let bump = bun_alloc::Arena::new();
        // PORT NOTE: `E::String` stores `&'static [u8]` (Phase-A erasure); dupe
        // formatted buffers into the process-lifetime CLI arena so they outlive
        // the AST nodes through printing.
        macro_rules! leak {
            ($v:expr) => {
                crate::cli::cli_dupe(&$v) as &'static [u8]
            };
        }

        let registry = manager.scope_for_package_name(package_name);

        let version_without_build_tag = dependency::without_build_tag(package_version);

        let integrity_fmt = {
            let mut v = Vec::new();
            write!(&mut v, "{}", bun_fmt::integrity::<false>(integrity)).map_err(|_| AllocError)?;
            leak!(v)
        };
        let shasum_fmt = {
            let mut v = Vec::new();
            write!(&mut v, "{}", bun_fmt::hex_lower(&shasum)).map_err(|_| AllocError)?;
            leak!(v)
        };

        Expr::set_string(
            json,
            &bump,
            b"_id",
            leak!({
                let mut v = Vec::new();
                write!(
                    &mut v,
                    "{}@{}",
                    bstr::BStr::new(package_name),
                    bstr::BStr::new(version_without_build_tag)
                )
                .map_err(|_| AllocError)?;
                v
            }),
        )?;
        Expr::set_string(json, &bump, b"_integrity", integrity_fmt)?;
        Expr::set_string(
            json,
            &bump,
            b"_nodeVersion",
            Environment::REPORTED_NODEJS_VERSION.as_bytes(),
        )?;
        // TODO: npm version
        Expr::set_string(json, &bump, b"_npmVersion", b"10.8.3")?;
        Expr::set_string(json, &bump, b"integrity", integrity_fmt)?;
        Expr::set_string(json, &bump, b"shasum", shasum_fmt)?;

        // Include README contents in the registry payload so `npm view <pkg>
        // readme` shows something, matching `npm publish`. User-provided
        // `readme` in package.json wins.
        if let Some(r) = readme {
            if json.get(b"readme").is_none() {
                Expr::set_string(json, &bump, b"readme", leak!(r.contents))?;
                Expr::set_string(json, &bump, b"readmeFilename", leak!(r.filename))?;
            }
        }

        let mut dist_props: Vec<G::Property> = Vec::with_capacity(3);
        dist_props.push(G::Property {
            key: Some(Expr::init(
                E::String::init(b"integrity"),
                bun_ast::Loc::EMPTY,
            )),
            value: Some(Expr::init(
                E::String::init(integrity_fmt),
                bun_ast::Loc::EMPTY,
            )),
            ..Default::default()
        });
        dist_props.push(G::Property {
            key: Some(Expr::init(E::String::init(b"shasum"), bun_ast::Loc::EMPTY)),
            value: Some(Expr::init(E::String::init(shasum_fmt), bun_ast::Loc::EMPTY)),
            ..Default::default()
        });
        dist_props.push(G::Property {
            key: Some(Expr::init(E::String::init(b"tarball"), bun_ast::Loc::EMPTY)),
            value: Some(Expr::init(
                E::String::init(leak!({
                    let mut v = Vec::new();
                    write!(
                        &mut v,
                        "http://{}/{}/-/{}",
                        // always use replace https with http
                        // https://github.com/npm/cli/blob/9281ebf8e428d40450ad75ba61bc6f040b3bf896/workspaces/libnpmpublish/lib/publish.js#L120
                        bstr::BStr::new(strings::without_trailing_slash(strings::without_prefix(
                            registry.url.href(),
                            b"https://"
                        ),)),
                        bstr::BStr::new(package_name),
                        pack::fmt_tarball_filename(
                            package_name,
                            package_version,
                            pack::TarballNameStyle::Raw
                        ),
                    )
                    .map_err(|_| AllocError)?;
                    v
                })),
                bun_ast::Loc::EMPTY,
            )),
            ..Default::default()
        });

        json.set(
            &bump,
            b"dist",
            Expr::init(
                E::Object {
                    properties: G::PropertyList::move_from_list(dist_props),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            ),
        )?;

        {
            let workspace_root = match bun_sys::open_a(
                strings::without_suffix_comptime(
                    manager.original_package_json_path.as_bytes(),
                    b"package.json",
                ),
                bun_sys::O::DIRECTORY,
                0,
            ) {
                Ok(fd) => fd,
                Err(e) => {
                    Output::err(e, "failed to open workspace directory", ());
                    Global::crash();
                }
            };
            let _close = scopeguard::guard(workspace_root, |fd| {
                let _ = fd.close();
            });

            Self::normalize_bin(json, &bump, package_name, workspace_root)?;
        }

        let buffer_writer = bun_js_printer::BufferWriter::init();
        let mut writer = bun_js_printer::BufferPrinter::init(buffer_writer);

        let written = match bun_js_printer::print_json(
            &mut writer,
            *json,
            json_source,
            bun_js_printer::PrintJsonOptions {
                minify_whitespace: true,
                mangled_props: None,
                ..Default::default()
            },
        ) {
            Ok(w) => w,
            Err(e) => {
                if e == err!(OutOfMemory) {
                    return Err(AllocError);
                }
                Output::err_generic("failed to print normalized package.json: {}", (e.name(),));
                Global::crash();
            }
        };
        let _ = written;

        Ok(writer.ctx.written_without_trailing_zero().into())
    }

    /// Searches `abs_workspace_path` for a README, matching `npm publish`. Returns
    /// the first match from `readdir` (same ordering npm's glob walks, in practice),
    /// or `None` if none is present.
    pub fn find_workspace_readme(abs_workspace_path: &[u8]) -> Option<ReadmeInfo> {
        let workspace_dir = bun_sys::open_dir_absolute(abs_workspace_path).ok()?;
        let _close = scopeguard::guard(workspace_dir, |d| {
            let _ = d.close();
        });

        let mut iter = DirIterator::iterate(workspace_dir);
        while let Some(entry) = iter.next().ok().flatten() {
            if entry.kind == bun_sys::EntryKind::Directory {
                continue;
            }
            // Zig: `DirIterator.iterate(dir, .u8)` — entry names are UTF-8 on every platform.
            let name = entry.name.slice_u8();
            if !is_readme_filename(name) {
                continue;
            }

            let contents = match bun_sys::File::read_from(workspace_dir, name) {
                Ok(bytes) => bytes,
                Err(_) => return None,
            };
            return Some(ReadmeInfo {
                filename: name.to_vec(),
                contents,
            });
        }
        None
    }

    fn normalize_bin(
        json: &mut Expr,
        bump: &bun_alloc::Arena,
        package_name: &[u8],
        workspace_root: Fd,
    ) -> Result<(), AllocError> {
        // PORT NOTE: see `normalized_package` — `E::String` stores
        // `&'static [u8]` (Phase-A erasure); dupe into the process-lifetime
        // CLI arena for buffers that flow into AST nodes.
        macro_rules! leak {
            ($v:expr) => {
                crate::cli::cli_dupe($v) as &'static [u8]
            };
        }
        let mut path_buf = PathBuffer::uninit();
        if let Some(bin_query) = json.as_property(b"bin") {
            match &bin_query.expr.data {
                ExprData::EString(bin_str) => {
                    let mut bin_props: Vec<G::Property> = Vec::new();
                    let normalized = strings::without_prefix_comptime_z(
                        normalize_buf_z::<path::platform::Posix>(
                            bin_str.string(bump)?,
                            &mut *path_buf,
                        ),
                        b"./",
                    );
                    if !bun_sys::exists_at(workspace_root, normalized) {
                        Output::warn(format_args!(
                            "bin '{}' does not exist",
                            bstr::BStr::new(normalized.as_bytes()),
                        ));
                    }

                    bin_props.push(G::Property {
                        key: Some(Expr::init(
                            E::String::init(leak!(package_name)),
                            bun_ast::Loc::EMPTY,
                        )),
                        value: Some(Expr::init(
                            E::String::init(leak!(normalized.as_bytes())),
                            bun_ast::Loc::EMPTY,
                        )),
                        ..Default::default()
                    });

                    // TODO(port): direct mutation of e_object.properties[i] — borrowck reshape may be needed
                    json.data
                        .e_object_mut()
                        .expect("infallible: variant checked")
                        .properties
                        .slice_mut()[bin_query.i as usize]
                        .value = Some(Expr::init(
                        E::Object {
                            properties: G::PropertyList::move_from_list(bin_props),
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    ));
                }
                ExprData::EObject(bin_obj) => {
                    let mut bin_props: Vec<G::Property> = Vec::new();
                    for bin_prop in bin_obj.properties.slice() {
                        let key: Option<Box<[u8]>> = 'key: {
                            if let Some(key) = &bin_prop.key {
                                if let Some(ks) = key.data.as_e_string() {
                                    if ks.len() != 0 {
                                        break 'key Some(Box::<[u8]>::from(
                                            strings::without_prefix(
                                                normalize_buf::<path::platform::Posix>(
                                                    ks.string(bump)?,
                                                    &mut *path_buf,
                                                ),
                                                b"./",
                                            ),
                                        ));
                                    }
                                }
                            }
                            None
                        };
                        let Some(key) = key else { continue };

                        if key.is_empty() {
                            continue;
                        }

                        let value: Option<bun_core::ZBox> = 'value: {
                            if let Some(value) = &bin_prop.value {
                                if let Some(vs) = value.data.as_e_string() {
                                    if vs.len() != 0 {
                                        break 'value Some(bun_core::ZBox::from_bytes(
                                            strings::without_prefix_comptime_z(
                                                // replace separators
                                                normalize_buf_z::<path::platform::Posix>(
                                                    vs.string(bump)?,
                                                    &mut *path_buf,
                                                ),
                                                b"./",
                                            )
                                            .as_bytes(),
                                        ));
                                    }
                                }
                            }
                            None
                        };
                        let Some(value) = value else { continue };
                        if value.is_empty() {
                            continue;
                        }

                        if !bun_sys::exists_at(workspace_root, &value) {
                            Output::warn(format_args!(
                                "bin '{}' does not exist",
                                bstr::BStr::new(value.as_bytes()),
                            ));
                        }

                        bin_props.push(G::Property {
                            key: Some(Expr::init(
                                E::String::init(crate::cli::cli_dupe(&key)),
                                bun_ast::Loc::EMPTY,
                            )),
                            value: Some(Expr::init(
                                E::String::init(leak!(value.as_bytes())),
                                bun_ast::Loc::EMPTY,
                            )),
                            ..Default::default()
                        });
                    }

                    // TODO(port): direct mutation of e_object.properties[i] — borrowck reshape may be needed
                    json.data
                        .e_object_mut()
                        .expect("infallible: variant checked")
                        .properties
                        .slice_mut()[bin_query.i as usize]
                        .value = Some(Expr::init(
                        E::Object {
                            properties: G::PropertyList::move_from_list(bin_props),
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    ));
                }
                _ => {}
            }
        } else if let Some(directories_query) = json.as_property(b"directories") {
            if let Some(bin_query) = directories_query.expr.as_property(b"bin") {
                let Some(bin_dir_str) = bin_query.expr.as_string(bump) else {
                    return Ok(());
                };
                let mut bin_props: Vec<G::Property> = Vec::new();
                let normalized_bin_dir = bun_core::ZBox::from_bytes(
                    strings::without_trailing_slash(strings::without_prefix(
                        normalize_buf::<path::platform::Posix>(bin_dir_str, &mut *path_buf),
                        b"./",
                    )),
                );

                if normalized_bin_dir.is_empty() {
                    return Ok(());
                }

                let bin_dir = match bun_sys::openat(
                    workspace_root,
                    &normalized_bin_dir,
                    bun_sys::O::DIRECTORY,
                    0,
                ) {
                    Ok(fd) => fd,
                    Err(e) => {
                        if e.get_errno() == bun_sys::E::ENOENT {
                            Output::warn(format_args!(
                                "bin directory '{}' does not exist",
                                bstr::BStr::new(normalized_bin_dir.as_bytes()),
                            ));
                            return Ok(());
                        } else {
                            Output::err(
                                e,
                                "failed to open bin directory: '{}'",
                                (bstr::BStr::new(normalized_bin_dir.as_bytes()),),
                            );
                            Global::crash();
                        }
                    }
                };

                // TODO(port): Zig used std.fs.Dir here for openDirZ — using bun_sys::Fd instead
                let mut dirs: Vec<(Fd, Box<[u8]>, bool)> = Vec::new();

                dirs.push((bin_dir, normalized_bin_dir.as_bytes().into(), false));

                while let Some(dir_info) = dirs.pop() {
                    let (dir, dir_subpath, close_dir) = dir_info;
                    let _close = scopeguard::guard(dir, move |d| {
                        if close_dir {
                            let _ = d.close();
                        }
                    });

                    let mut iter = DirIterator::iterate(dir);
                    while let Some(entry) = iter.next().ok().flatten() {
                        let (name, subpath): (&'static ZStr, &'static ZStr) = {
                            // Zig: `DirIterator.iterate(dir, .u8)` — UTF-8 entry name on every platform.
                            let name = entry.name.slice_u8();
                            let mut join: Vec<u8> = Vec::new();
                            write!(
                                &mut join,
                                "{}{}{}",
                                bstr::BStr::new(&dir_subpath),
                                // only using posix separators
                                if dir_subpath.is_empty() { "" } else { "/" },
                                bstr::BStr::new(strings::without_trailing_slash(name)),
                            )
                            .map_err(|_| AllocError)?;
                            join.push(0);
                            let join_len = join.len() - 1;
                            // PORT NOTE: reshaped for borrowck — Zig sliced into the same allocation for both name and subpath.
                            // Dupe into the process-lifetime CLI arena (bytes flow into long-lived `E::String` nodes).
                            let interned: &'static [u8] = crate::cli::cli_dupe(&join);
                            // SAFETY: NUL terminator at interned[join_len] (copied from `join`).
                            let join_z = ZStr::from_buf(&interned[..], join_len);
                            let name_slice_start = join_len - name.len();
                            // SAFETY: name is the trailing segment of `interned`, NUL-terminated
                            let name_z = unsafe {
                                ZStr::from_raw(interned.as_ptr().add(name_slice_start), name.len())
                            };
                            (name_z, join_z)
                        };

                        if name.is_empty()
                            || (name.len() == 1 && name.as_bytes()[0] == b'.')
                            || (name.len() == 2
                                && name.as_bytes()[0] == b'.'
                                && name.as_bytes()[1] == b'.')
                        {
                            continue;
                        }

                        bin_props.push(G::Property {
                            key: Some(Expr::init(
                                E::String::init(leak!(bun_paths::basename_posix(
                                    subpath.as_bytes()
                                ))),
                                bun_ast::Loc::EMPTY,
                            )),
                            value: Some(Expr::init(
                                E::String::init(subpath.as_bytes()),
                                bun_ast::Loc::EMPTY,
                            )),
                            ..Default::default()
                        });

                        if entry.kind == bun_sys::EntryKind::Directory {
                            // TODO(port): Zig used dir.openDirZ — substituting bun_sys::openat
                            let Ok(subdir) = bun_sys::openat(dir, name, bun_sys::O::DIRECTORY, 0)
                            else {
                                continue;
                            };
                            dirs.push((subdir, subpath.as_bytes().into(), true));
                        }
                    }
                }

                json.set(
                    bump,
                    b"bin",
                    Expr::init(
                        E::Object {
                            properties: G::PropertyList::move_from_list(bin_props),
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    ),
                )?;
            }
        }

        // no bins
        Ok(())
    }

    fn construct_publish_headers(
        print_buf: &mut Vec<u8>,
        registry: &Npm::Registry::Scope,
        maybe_json_len: Option<usize>,
        maybe_otp: Option<&[u8]>,
        uses_workspaces: bool,
        auth_type: Option<AuthType>,
    ) -> Result<http::HeaderBuilder, AllocError> {
        let mut headers = http::HeaderBuilder::default();
        let npm_auth_type: &[u8] = if maybe_otp.is_none() {
            if let Some(auth) = auth_type {
                auth.as_str().as_bytes()
            } else {
                b"web"
            }
        } else {
            b"legacy"
        };
        let ci_name = ci::detect_ci_name();

        {
            headers.count(b"accept", b"*/*");
            headers.count(b"accept-encoding", b"gzip,deflate");

            if !registry.token.is_empty() {
                write!(print_buf, "Bearer {}", bstr::BStr::new(&registry.token)).ok();
                headers.count(b"authorization", &**print_buf);
                print_buf.clear();
            } else if !registry.auth.is_empty() {
                write!(print_buf, "Basic {}", bstr::BStr::new(&registry.auth)).ok();
                headers.count(b"authorization", &**print_buf);
                print_buf.clear();
            }

            if maybe_json_len.is_some() {
                // not using `MimeType.json.value`, verdaccio will fail if it's anything other than `application/json`
                headers.count(b"content-type", b"application/json");
            }

            headers.count(b"npm-auth-type", npm_auth_type);
            if let Some(otp) = maybe_otp {
                headers.count(b"npm-otp", otp);
            }
            headers.count(b"npm-command", b"publish");

            write!(
                print_buf,
                "{} {} {} workspaces/{}{}{}",
                Global::user_agent,
                Global::os_name,
                Global::arch_name,
                uses_workspaces,
                if ci_name.is_some() { " ci/" } else { "" },
                bstr::BStr::new(ci_name.unwrap_or(b"")),
            )
            .ok();
            // headers.count("user-agent", "npm/10.8.3 node/v24.3.0 darwin arm64 workspaces/false");
            headers.count(b"user-agent", &**print_buf);
            print_buf.clear();

            headers.count(b"Connection", b"keep-alive");
            headers.count(b"Host", registry.url.url().host);

            if let Some(json_len) = maybe_json_len {
                write!(print_buf, "{}", json_len).ok();
                headers.count(b"Content-Length", &**print_buf);
                print_buf.clear();
            }
        }

        headers.allocate()?;

        {
            headers.append(b"accept", b"*/*");
            headers.append(b"accept-encoding", b"gzip,deflate");

            if !registry.token.is_empty() {
                write!(print_buf, "Bearer {}", bstr::BStr::new(&registry.token)).ok();
                headers.append(b"authorization", &**print_buf);
                print_buf.clear();
            } else if !registry.auth.is_empty() {
                write!(print_buf, "Basic {}", bstr::BStr::new(&registry.auth)).ok();
                headers.append(b"authorization", &**print_buf);
                print_buf.clear();
            }

            if maybe_json_len.is_some() {
                // not using `MimeType.json.value`, verdaccio will fail if it's anything other than `application/json`
                headers.append(b"content-type", b"application/json");
            }

            headers.append(b"npm-auth-type", npm_auth_type);
            if let Some(otp) = maybe_otp {
                headers.append(b"npm-otp", otp);
            }
            headers.append(b"npm-command", b"publish");

            write!(
                print_buf,
                "{} {} {} workspaces/{}{}{}",
                Global::user_agent,
                Global::os_name,
                Global::arch_name,
                uses_workspaces,
                if ci_name.is_some() { " ci/" } else { "" },
                bstr::BStr::new(ci_name.unwrap_or(b"")),
            )
            .ok();
            // headers.append("user-agent", "npm/10.8.3 node/v24.3.0 darwin arm64 workspaces/false");
            headers.append(b"user-agent", &**print_buf);
            print_buf.clear();

            headers.append(b"Connection", b"keep-alive");
            headers.append(b"Host", registry.url.url().host);

            if let Some(json_len) = maybe_json_len {
                write!(print_buf, "{}", json_len).ok();
                headers.append(b"Content-Length", &**print_buf);
                print_buf.clear();
            }
        }

        Ok(headers)
    }

    fn construct_publish_request_body<const DIRECTORY_PUBLISH: bool>(
        ctx: &Context<'_, DIRECTORY_PUBLISH>,
    ) -> Result<Box<[u8]>, AllocError> {
        let tag: &[u8] = if !ctx.manager.options.publish_config.tag.is_empty() {
            ctx.manager.options.publish_config.tag
        } else {
            b"latest"
        };

        let encoded_tarball_len =
            bun_core::base64::standard_encoder_calc_size(ctx.tarball_bytes.len());
        let version_without_build_tag =
            install::dependency::without_build_tag(&ctx.package_version);

        let mut buf: Vec<u8> = Vec::with_capacity(
            ctx.package_name.len() * 5
                + version_without_build_tag.len() * 4
                + ctx.abs_tarball_path.len()
                + encoded_tarball_len,
        );

        write!(
            &mut buf,
            "{{\"_id\":\"{}\",\"name\":\"{}\"",
            bstr::BStr::new(&ctx.package_name),
            bstr::BStr::new(&ctx.package_name),
        )
        .ok();

        write!(
            &mut buf,
            ",\"dist-tags\":{{{}:\"{}\"}}",
            bun_fmt::format_json_string_utf8(tag, Default::default()),
            bstr::BStr::new(version_without_build_tag),
        )
        .ok();

        // "versions"
        {
            write!(
                &mut buf,
                ",\"versions\":{{\"{}\":{}}}",
                bstr::BStr::new(version_without_build_tag),
                bstr::BStr::new(&ctx.normalized_pkg_info),
            )
            .ok();
        }

        if let Some(access) = ctx.manager.options.publish_config.access {
            write!(&mut buf, ",\"access\":\"{}\"", access.as_str()).ok();
        } else {
            buf.extend_from_slice(b",\"access\":null");
        }

        // "_attachments"
        {
            write!(
                &mut buf,
                ",\"_attachments\":{{\"{}\":{{\"content_type\":\"{}\",\"data\":\"",
                pack::fmt_tarball_filename(
                    &ctx.package_name,
                    &ctx.package_version,
                    pack::TarballNameStyle::Raw
                ),
                "application/octet-stream",
            )
            .ok();

            // SAFETY: `encode_raw` writes exactly `encoded_tarball_len`
            // (= `base64::encode_len(tarball_bytes.len(), false)`) bytes into the
            // reserved spare capacity; `fill_spare` commits exactly that count.
            let count = unsafe {
                bun_core::vec::fill_spare(&mut buf, encoded_tarball_len, |spare| {
                    let n =
                        simdutf::base64::encode_raw(&ctx.tarball_bytes, spare.as_mut_ptr(), false);
                    (n, n)
                })
            };
            debug_assert!(count == encoded_tarball_len);

            write!(&mut buf, "\",\"length\":{}}}}}}}", ctx.tarball_bytes.len(),).ok();
        }

        Ok(buf.into_boxed_slice())
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum PublishError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("NeedAuth")]
    NeedAuth,
}
bun_core::oom_from_alloc!(PublishError);

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum GetOTPError {
    #[error("OutOfMemory")]
    OutOfMemory,
}
bun_core::oom_from_alloc!(GetOTPError);
impl From<GetOTPError> for PublishError {
    fn from(_: GetOTPError) -> Self {
        PublishError::OutOfMemory
    }
}

// ported from: src/cli/publish_command.zig
