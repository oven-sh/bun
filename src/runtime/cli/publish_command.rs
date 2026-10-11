use bun_collections::VecExt;
use std::io::Write as _;

use crate::Error;
use bun_alloc::AllocError;
use bun_ast::{E, Expr, G};
use bun_core::MutableString;
use bun_core::fmt as bun_fmt;
use bun_core::{Environment, Global, Output};
use bun_core::{ZStr, strings};
use bun_http as http;
use bun_install::package_manager::options::PublishTarget;
use bun_install::package_manager::workspace_manifests;
use bun_install::{self as install, Npm, PackageManager, Subcommand};
use bun_libarchive::lib::{Archive, ArchiveIterator, IteratorResult as ArchiveIterResult};
use bun_parsers::json as json_mod;
use bun_paths as path;
use bun_paths::resolve_path::{join_abs_string_buf_checked, normalize_buf_z_spill};
use bun_sha_hmac as sha;
use bun_simdutf_sys::simdutf;
use bun_sys::dir_iterator as DirIterator;
use bun_sys::{self, Fd, File, FileKind};
use bun_url::URL;
// `LogLevel`/`AuthType`/`Access` from `bun_install::PackageManagerOptions`.
use bun_ast::expr::Data as ExprData;
use bun_core::OSPathChar;
use bun_install::Access;
use bun_install::dependency;
use bun_install::{AuthType, LogLevel};

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
use crate::cli::pack_command::{self as pack};

pub(crate) struct ReadmeInfo {
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

type SHA1Digest = [u8; sha::SHA1::DIGEST];
type SHA512Digest = [u8; sha::SHA512::DIGEST];

pub(crate) struct PublishCommand;

/// What `bun publish` sends, built by [`Context::from_tarball_path`] or
/// [`Context::from_workspace`]. It borrows nothing, so `--recursive` holds one
/// per package. The scripts are `None` for a tarball publish, which runs none.
pub(crate) struct Context {
    pub(crate) package_name: Box<[u8]>,
    pub(crate) package_version: Box<[u8]>,
    pub(crate) tarball_bytes: Box<[u8]>,

    pub(crate) normalized_pkg_info: Box<[u8]>,

    pub(crate) publish_script: Option<Box<[u8]>>,
    pub(crate) postpublish_script: Option<Box<[u8]>>,
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

pub(crate) type FromWorkspaceError = pack::PackError;

impl Context {
    /// Retrieve information for publishing from a tarball path, `bun publish path/to/tarball.tgz`
    pub(crate) fn from_tarball_path(
        manager: &mut PackageManager,
        original_cwd: &[u8],
        tarball_path: &[u8],
    ) -> Result<Context, FromTarballError> {
        let mut abs_buf = bun_paths::path_buffer_pool::get();
        let abs_tarball_path = join_abs_string_buf_checked::<path::platform::Auto>(
            original_cwd,
            &mut abs_buf,
            &[tarball_path],
        )
        .ok_or_else(|| bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open));

        let tarball_bytes = match abs_tarball_path.and_then(|p| File::read_from(Fd::cwd(), p)) {
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
                        // SAFETY: `archive` is the live `read_new()` handle returned in the Err arm.
                        bstr::BStr::new(Archive::opaque_ref(archive).error_string()),
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
                            // SAFETY: `archive` is the live `read_new()` handle returned in the Err arm.
                            bstr::BStr::new(Archive::opaque_ref(archive).error_string()),
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

                bun_core::pretty!(
                    "<b><cyan>packed<r> {} {}\n",
                    bun_fmt::size(
                        usize::try_from(size.max(0)).expect("int cast"),
                        bun_fmt::SizeFormatterOptions {
                            space_between_number_and_unit: false
                        }
                    ),
                    bun_fmt::fmt_os_path(stripped, Default::default()),
                );

                if next.kind != FileKind::File {
                    continue;
                }

                if !stripped.iter().any(|&c| bun_paths::is_sep_any_t(c)) {
                    // check for package.json, readme.md, ...
                    let filename = &pathname[slash + 1..];

                    if maybe_package_json_contents.is_none()
                        && strings::eql_case_insensitive_t(filename, b"package.json")
                    {
                        // SAFETY: `iter.archive` is the live `read_new()` handle this iterator
                        // was constructed from; `next` is the entry it just yielded.
                        let r = next.read_entry_data(unsafe { &*iter.archive })?;
                        maybe_package_json_contents = match r {
                            ArchiveIterResult::Err { archive, message } => {
                                Output::err_generic(
                                    "{}: {}",
                                    (
                                        bstr::BStr::new(message),
                                        // SAFETY: `archive` is the same live handle returned in the Err arm.
                                        bstr::BStr::new(
                                            Archive::opaque_ref(archive).error_string(),
                                        ),
                                    ),
                                );
                                Global::crash();
                            }
                            ArchiveIterResult::Result(bytes) => Some(bytes),
                        };
                    } else if maybe_readme.is_none() && is_readme_os_path(filename) {
                        // First matching README wins — libarchive iteration is one-shot.
                        // SAFETY: same as the package.json arm above.
                        let r = next.read_entry_data(unsafe { &*iter.archive })?;
                        let bytes = match r {
                            ArchiveIterResult::Err { archive, message } => {
                                Output::err_generic(
                                    "{}: {}",
                                    (
                                        bstr::BStr::new(message),
                                        // SAFETY: `archive` is the same live handle returned in the Err arm.
                                        bstr::BStr::new(
                                            Archive::opaque_ref(archive).error_string(),
                                        ),
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
                bun_core::pretty!(
                    "<b><cyan>packed<r> {} {}\n",
                    bun_fmt::size(
                        usize::try_from(size.max(0)).expect("int cast"),
                        bun_fmt::SizeFormatterOptions {
                            space_between_number_and_unit: false
                        }
                    ),
                    bun_fmt::fmt_os_path(pathname, Default::default()),
                );
            }
        }

        match iter.close() {
            ArchiveIterResult::Err { archive, message } => {
                Output::err_generic(
                    "{}: {}",
                    (
                        bstr::BStr::new(message),
                        // SAFETY: `archive` is the live `read_new()` handle returned in the Err arm.
                        bstr::BStr::new(Archive::opaque_ref(archive).error_string()),
                    ),
                );
                Global::crash();
            }
            ArchiveIterResult::Result(()) => {}
        }

        let package_json_contents =
            maybe_package_json_contents.ok_or(FromTarballError::MissingPackageJSON)?;

        // Note: adopt `package_json_contents` (already an owned `Box<[u8]>`)
        // into the process-lifetime side-table so the `Source` borrow stays
        // alive across `normalized_package`. Zero-copy.
        let package_json_contents: &'static [u8] = crate::cli::cli_adopt(package_json_contents);

        let bump = bun_alloc::Arena::new();
        let (package_name, package_version, json, json_source) = {
            let source = bun_ast::Source::init_path_string(b"package.json", package_json_contents);
            let log = manager.log_mut();
            let json = match json_mod::parse_package_json_utf8(&source, log, &bump) {
                Ok(j) => j,
                Err(e) => {
                    if e == bun_parsers::Error::Alloc(bun_alloc::AllocError) {
                        return Err(FromTarballError::OutOfMemory);
                    }
                    return Err(FromTarballError::InvalidPackageJSON);
                }
            };

            if pack::is_private_package(&json) {
                return Err(FromTarballError::PrivatePackage);
            }

            let name: Box<[u8]> = json_get_string_cloned(&json, &bump, b"name")?
                .ok_or(FromTarballError::MissingPackageName)?
                .into();
            let is_scoped = dependency::is_scoped_package_name(&name)
                .map_err(|_| FromTarballError::InvalidPackageName)?;

            manager.options.apply_publish_config(&json, &bump, &name)?;
            PublishCommand::refuse_publish_config_provenance(&json);

            if let Some(access) = manager.options.publish_config.access {
                if access == Access::Restricted && !is_scoped {
                    return Err(FromTarballError::RestrictedUnscopedPackage);
                }
            }

            let version = json_get_string_cloned(&json, &bump, b"version")?
                .ok_or(FromTarballError::MissingPackageVersion)?;
            let version: Box<[u8]> = pack::published_version(version)
                .ok_or(FromTarballError::InvalidPackageVersion)?
                .into();

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

        let mut json = json;
        let normalized_pkg_info = PublishCommand::normalized_package(
            manager,
            strings::without_suffix_comptime(
                manager.original_package_json_path.as_bytes(),
                b"package.json",
            ),
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
            package_name,
            package_version,
            tarball_bytes: tarball_bytes.into(),
            normalized_pkg_info,
            publish_script: None,
            postpublish_script: None,
        })
    }

    /// `bun publish` without a tarball path. Automatically pack the package of `abs_package_json_path`
    /// and get information required for publishing
    pub(crate) fn from_workspace(
        ctx: Command::Context<'_>,
        manager: &mut PackageManager,
        abs_package_json_path: &ZStr,
    ) -> Result<Context, FromWorkspaceError> {
        let pack_ctx = pack::Context {
            manager,
            command_ctx: ctx,
            bundled_deps: Vec::new(),
            stats: pack::Stats::default(),
        };

        Ok(pack::pack(pack_ctx, abs_package_json_path, true)?
            .expect("pack for a publish always yields a publish context"))
    }
}

impl PublishCommand {
    /// Publishing without the provenance statement `asked_by` asks for would look like success.
    fn refuse_provenance(asked_by: &str) -> ! {
        Output::err_generic(
            "{} is not supported yet: bun publish cannot generate provenance statements",
            (asked_by,),
        );
        Global::crash();
    }

    pub(crate) fn refuse_publish_config_provenance(package_json: &Expr) {
        let provenance = (package_json.get(b"publishConfig"))
            .and_then(|publish_config| publish_config.get(b"provenance"));
        if provenance.is_some_and(|value| value.as_bool() != Some(false)) {
            Self::refuse_provenance("\"provenance\" in the publishConfig of package.json");
        }
    }

    pub(crate) fn exec(ctx: Command::Context) -> Result<(), Error> {
        bun_core::prettyln!(
            "<r><b>bun publish <r><d>v{}<r>",
            Global::package_json_version_with_sha,
        );
        Output::flush();

        if (bun_core::argv().iter()).any(|arg| arg.starts_with(b"--provenance")) {
            Self::refuse_provenance("--provenance");
        }

        let cli = install::CommandLineArguments::parse(Subcommand::Publish)?;

        let (manager, original_cwd) =
            match PackageManager::init(&mut *ctx, cli.clone(), Subcommand::Publish) {
                Ok(v) => v,
                Err(err) => {
                    if !cli.log_level.is_silent() {
                        if err == bun_install::Error::MissingPackageJSON {
                            Output::err_generic("missing package.json, nothing to publish", ());
                        }
                        Output::err_generic("failed to initialize bun install: {}", (err.name(),));
                    }
                    Global::crash();
                }
            };

        const PROVENANCE_KEYS: [&[u8]; 2] = [b"NPM_CONFIG_PROVENANCE", b"npm_config_provenance"];
        if PROVENANCE_KEYS.iter().any(|key| {
            (manager.env_mut().get(key)).is_some_and(|value| !value.is_empty() && value != b"false")
        }) {
            Self::refuse_provenance("NPM_CONFIG_PROVENANCE");
        }

        if cli.positionals.len() > 1 {
            if Self::is_workspace_publish(manager) {
                Output::err_generic(
                    "--recursive and --filter cannot be used with a tarball path",
                    (),
                );
                Global::crash();
            }

            let context = match Context::from_tarball_path(
                manager,
                &original_cwd,
                cli.positionals[1],
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
                        FromTarballError::InvalidPackageName => {
                            Output::err_generic(
                                "package.json `name` and `version` fields must be non-empty strings",
                                (),
                            );
                        }
                        FromTarballError::InvalidPackageVersion => {
                            Output::err_generic(
                                "package.json `version` is not a valid semver version",
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
                            let _ = manager
                                .log_mut()
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

            match Self::publish(manager, &context) {
                Ok(Published::Yes) => Self::print_published(manager, &context),
                Ok(Published::AlreadyOnRegistry) => {}
                Err(err) => err.report_and_crash(),
            }
            return Ok(());
        }

        if Self::is_workspace_publish(manager) {
            return Self::exec_workspaces(ctx, manager, &original_cwd);
        }

        let abs_package_json_path =
            bun_core::ZBox::from_bytes(manager.original_package_json_path.as_bytes());
        let context = match Context::from_workspace(&mut *ctx, manager, &abs_package_json_path) {
            Ok(c) => c,
            Err(err) => Self::report_pack_error_and_crash(err),
        };

        match Self::publish(manager, &context) {
            Ok(Published::Yes) => {
                Self::finish_directory_publish(ctx, manager, &context, &abs_package_json_path)
            }
            Ok(Published::AlreadyOnRegistry) => Ok(()),
            Err(err) => err.report_and_crash(),
        }
    }

    fn report_pack_error_and_crash(err: FromWorkspaceError) -> ! {
        use pack::PackError;
        match err {
            PackError::OutOfMemory => bun_core::out_of_memory(),
            PackError::MissingPackageName => {
                Output::err_generic("missing `name` string in package.json", ());
            }
            PackError::MissingPackageVersion => {
                Output::err_generic("missing `version` string in package.json", ());
            }
            PackError::InvalidPackageName => {
                Output::err_generic(
                    "package.json `name` and `version` fields must be non-empty strings",
                    (),
                );
            }
            PackError::InvalidPackageVersion => {
                Output::err_generic("package.json `version` is not a valid semver version", ());
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

    /// `-r` / `--filter`: packs every selected workspace package that has something to publish, then publishes
    /// them, dependencies first. Every failure ends the run: a pack that fails publishes nothing, and no package
    /// gets to the registry ahead of a dependency that did not. What is there already is skipped, so a re-run goes on.
    fn exec_workspaces(
        ctx: Command::Context<'_>,
        manager: &mut PackageManager,
        original_cwd: &[u8],
    ) -> Result<(), Error> {
        struct Packed {
            abs_package_json_path: bun_core::ZBox,
            /// The options as this package's `publishConfig` left them.
            target: PublishTarget,
            context: Context,
        }

        let bump = bun_alloc::Arena::new();
        let mut packed: Vec<Packed> = Vec::new();
        for abs_package_json_path in
            workspace_manifests::selected_in_dependency_order(manager, original_cwd)
        {
            let abs_package_json_path = bun_core::ZBox::from_bytes(&abs_package_json_path);
            // Copied out: the scripts `pack()` runs invalidate the cache this points into.
            let root = pack::package_json_entry(manager, &abs_package_json_path).root;
            let string_field = |key: &[u8]| -> Box<[u8]> {
                let value = root.get(key);
                let value = value.as_ref().and_then(Expr::as_utf8_string_literal);
                value.unwrap_or(b"").into()
            };
            let (name, version) = (string_field(b"name"), string_field(b"version"));

            if pack::is_private_package(&root) {
                bun_core::prettyln!(
                    "<d>skipped {}: private<r>",
                    bstr::BStr::new(if name.is_empty() {
                        abs_package_json_path.as_bytes()
                    } else {
                        &*name
                    }),
                );
                continue;
            }

            let cli_target = manager.options.publish_target(&name);

            // Asked before its scripts run. `pack()` reports a name or version that is not one.
            if let Some(version) = pack::published_version(&version).filter(|_| !name.is_empty()) {
                let version = dependency::without_build_tag(version);
                bun_core::handle_oom(manager.options.apply_publish_config(&root, &bump, &name));
                let registry = manager.scope_for_package_name(&name);
                if !Self::has_credentials(registry) {
                    PublishError::NeedAuth.report_and_crash();
                }
                let exists = Self::check_package_version_exists(manager, &name, version, registry);
                bun_core::handle_oom(manager.options.set_publish_target(&cli_target));
                if exists {
                    bun_core::prettyln!(
                        "<d>skipped {}@{}: already on the registry<r>",
                        bstr::BStr::new(&name),
                        bstr::BStr::new(version),
                    );
                    continue;
                }
            }

            bun_core::prettyln!("\n<b><magenta>{}<r>", bstr::BStr::new(&name));
            let context = match Context::from_workspace(&mut *ctx, manager, &abs_package_json_path)
            {
                Ok(context) => context,
                Err(err) => Self::report_pack_error_and_crash(err),
            };
            let target = manager.options.publish_target(&name);
            bun_core::handle_oom(manager.options.set_publish_target(&cli_target));
            packed.push(Packed {
                abs_package_json_path,
                target,
                context,
            });
        }

        for Packed {
            abs_package_json_path,
            target,
            context,
        } in &packed
        {
            bun_core::handle_oom(manager.options.set_publish_target(target));
            bun_core::prettyln!(
                "\n<b><magenta>{}<r>",
                bstr::BStr::new(&context.package_name)
            );
            match Self::publish(manager, context) {
                Ok(Published::Yes) => Self::finish_directory_publish(
                    &mut *ctx,
                    manager,
                    context,
                    abs_package_json_path,
                )?,
                Ok(Published::AlreadyOnRegistry) => {}
                Err(err) => err.report_and_crash(),
            }
        }

        Ok(())
    }

    fn print_published(manager: &PackageManager, context: &Context) {
        bun_core::prettyln!(
            "\n<green> +<r> {}@{}{}",
            bstr::BStr::new(&context.package_name),
            bstr::BStr::new(dependency::without_build_tag(&context.package_version)),
            if manager.options.dry_run {
                " (dry-run)"
            } else {
                ""
            },
        );
    }

    /// The ` + name@version` line, then the `publish` and `postpublish` scripts of the package.
    fn finish_directory_publish(
        ctx: Command::Context<'_>,
        manager: &PackageManager,
        context: &Context,
        abs_package_json_path: &ZStr,
    ) -> Result<(), Error> {
        Self::print_published(manager, context);

        if !manager
            .options
            .do_
            .contains(install::PackageManagerDoStub::RUN_SCRIPTS)
        {
            return Ok(());
        }

        let abs_workspace_path = path::string_paths::without_trailing_slash_windows_path(
            strings::without_suffix_comptime(abs_package_json_path.as_bytes(), b"package.json"),
        );
        let script_env = manager.env_mut();
        // `pack()` left the last three describing the package it packed last.
        let variables: [(&[u8], &[u8]); 4] = [
            (b"npm_command", b"publish"),
            (b"npm_package_json", abs_package_json_path.as_bytes()),
            (b"npm_package_name", &*context.package_name),
            (b"npm_package_version", &*context.package_version),
        ];
        for (key, value) in variables {
            script_env
                .map
                .put(key, value)
                .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?;
        }

        let use_system_shell = ctx.debug.use_system_shell;
        let scripts: [(&[u8], &Option<Box<[u8]>>); 2] = [
            (b"publish", &context.publish_script),
            (b"postpublish", &context.postpublish_script),
        ];
        for (name, script) in scripts {
            let Some(script) = script else { continue };
            if let Err(e) = Run::run_package_script_foreground(
                ctx,
                script,
                name,
                abs_workspace_path,
                script_env,
                &[],
                manager.options.log_level == LogLevel::Silent,
                use_system_shell,
            ) {
                if matches!(e, crate::Error::MissingShell) {
                    Output::err_generic(
                        "failed to find shell executable to run {} script",
                        (bstr::BStr::new(name),),
                    );
                    Global::crash();
                }
                return Err(e);
            }
        }

        Ok(())
    }

    fn check_package_version_exists(
        manager: &PackageManager,
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

        // Note: `URL::parse` borrows; dupe into the process-lifetime CLI
        // arena so the URL outlives the local Vec.
        let package_url = URL::parse(crate::cli::cli_dupe(&url_buf));

        let Ok(mut response_buf) = MutableString::init(1024) else {
            return false;
        };

        let authorization = registry.authorization(&package_url);
        let mut headers = http::HeaderBuilder::default();
        headers.count(b"accept", b"application/json");
        if let Some(authorization) = &authorization {
            headers.count(b"authorization", authorization);
        }

        if headers.allocate().is_err() {
            return false;
        }
        headers.append(b"accept", b"application/json");
        if let Some(authorization) = &authorization {
            headers.append(b"authorization", authorization);
        }

        let mut req = manager.registry_request(
            http::Method::GET,
            package_url,
            headers.entries,
            headers.content.written_slice(),
            b"",
        );

        let Ok(res) = req.send_sync(&mut response_buf) else {
            return false;
        };
        if res.status_code() != 200 {
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

    /// `-r` or `--filter`: the run covers workspace packages, not only the current one.
    fn is_workspace_publish(manager: &PackageManager) -> bool {
        manager.options.do_.recursive() || !manager.options.filter_patterns.is_empty()
    }

    fn has_credentials(registry: &Npm::Registry::Scope) -> bool {
        registry.authorization_parts(&registry.url.url()).is_some()
    }

    fn publish(manager: &PackageManager, ctx: &Context) -> Result<Published, PublishError> {
        let registry = manager.scope_for_package_name(&ctx.package_name);
        let registry_url = registry.url.url();

        if !Self::has_credentials(registry) {
            return Err(PublishError::NeedAuth);
        }

        let tolerate_republish = manager.options.publish_config.tolerate_republish;
        if tolerate_republish {
            let version_without_build_tag = dependency::without_build_tag(&ctx.package_version);
            let package_exists = Self::check_package_version_exists(
                manager,
                &ctx.package_name,
                version_without_build_tag,
                registry,
            );

            if package_exists {
                bun_core::warn!(
                    "Registry already knows about version {}; skipping.",
                    bstr::BStr::new(version_without_build_tag),
                );
                return Ok(Published::AlreadyOnRegistry);
            }
        }

        // continues from `printSummary`
        let registry_href = registry_url.href_without_auth();
        bun_core::pretty!(
            "<b><blue>Tag<r>: {}\n<b><blue>Access<r>: {}\n<b><blue>Registry<r>: {}/\n",
            bstr::BStr::new(if !manager.options.publish_config.tag.is_empty() {
                manager.options.publish_config.tag
            } else {
                b"latest"
            }),
            if let Some(access) = manager.options.publish_config.access {
                access.as_str()
            } else {
                "default"
            },
            bstr::BStr::new(strings::without_trailing_slash(&registry_href)),
        );

        // dry-run stops here
        if manager.options.dry_run {
            return Ok(Published::Yes);
        }

        // Note: `AsyncHTTP::init_sync` requires `&'static [u8]` for the
        // request body. Single-shot CLI path — adopt the
        // already-owned `Box<[u8]>` (base64-encoded tarball; can be multi-MB)
        // into the process-lifetime side-table. Zero-copy.
        let publish_req_body: &'static [u8] =
            crate::cli::cli_adopt(Self::construct_publish_request_body(manager, ctx)?);

        let mut print_buf: Vec<u8> = Vec::new();

        let publish_headers = Self::construct_publish_headers(
            &mut print_buf,
            registry,
            Some(publish_req_body.len()),
            if !manager.options.publish_config.otp.is_empty() {
                Some(manager.options.publish_config.otp)
            } else {
                None
            },
            Self::is_workspace_publish(manager),
            manager.options.publish_config.auth_type,
        )?;

        let mut response_buf = MutableString::init(1024)?;

        write!(
            &mut print_buf,
            "{}/{}",
            bstr::BStr::new(strings::without_trailing_slash(registry.url.href())),
            bun_fmt::dependency_url(&ctx.package_name),
        )
        .map_err(|_| AllocError)?;
        // Note: `URL::parse` borrows; dupe into the process-lifetime CLI
        // arena so the URL outlives `print_buf.clear()` below.
        let publish_url = URL::parse(crate::cli::cli_dupe(&print_buf));
        print_buf.clear();

        let mut req = manager.registry_request(
            http::Method::PUT,
            publish_url.clone(),
            publish_headers.entries,
            publish_headers.content.written_slice(),
            publish_req_body,
        );

        let res = match req.send_sync(&mut response_buf) {
            Ok(r) => r,
            Err(e) => {
                if e == bun_http::Error::Alloc(bun_alloc::AllocError) {
                    return Err(PublishError::OutOfMemory);
                }
                Output::err(e, "failed to publish package", ());
                Global::crash();
            }
        };

        match res.status_code() {
            400..=u32::MAX => {
                let prompt_for_otp = 'prompt_for_otp: {
                    if res.status_code() != 401 {
                        break 'prompt_for_otp false;
                    }

                    if let Some(www_authenticate) = res.header(b"www-authenticate") {
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
                            (bun_fmt::escape_control_chars(www_authenticate),),
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
                if let Some(notice) = res.header_if_other_is_absent(b"npm-notice", b"x-local-cache")
                {
                    Output::print_error(format_args!("\n"));
                    bun_core::note!("{}", bun_fmt::escape_control_chars(notice));
                    Output::flush();
                }

                let otp = Self::get_otp(manager, ctx, registry, &mut response_buf, &mut print_buf)?;

                let otp_headers = Self::construct_publish_headers(
                    &mut print_buf,
                    registry,
                    Some(publish_req_body.len()),
                    Some(&otp),
                    Self::is_workspace_publish(manager),
                    manager.options.publish_config.auth_type,
                )?;

                response_buf.reset();

                let mut otp_req = manager.registry_request(
                    http::Method::PUT,
                    publish_url,
                    otp_headers.entries,
                    otp_headers.content.written_slice(),
                    publish_req_body,
                );

                let otp_res = match otp_req.send_sync(&mut response_buf) {
                    Ok(r) => r,
                    Err(e) => {
                        if e == bun_http::Error::Alloc(bun_alloc::AllocError) {
                            return Err(PublishError::OutOfMemory);
                        }
                        Output::err(e, "failed to publish package", ());
                        Global::crash();
                    }
                };

                match otp_res.status_code() {
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
                        if let Some(notice) =
                            otp_res.header_if_other_is_absent(b"npm-notice", b"x-local-cache")
                        {
                            Output::print_error(format_args!("\n"));
                            bun_core::note!("{}", bun_fmt::escape_control_chars(notice));
                            Output::flush();
                        }
                    }
                }
            }
            _ => {}
        }

        Ok(Published::Yes)
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
            // SAFETY: `buffered_stdin()` returns a process-global `*mut`; this
            // loop is the only accessor while it runs (single-threaded CLI path).
            match unsafe { (*Output::buffered_stdin()).reader().read_byte() } {
                Ok(b'\n') => break,
                Ok(_) => continue,
                Err(_) => return,
            }
        }

        let _ = bun_core::spawn_sync_inherit(&[open::OPENER, auth_url.as_bytes()]);
    }

    fn get_otp(
        manager: &PackageManager,
        ctx: &Context,
        registry: &Npm::Registry::Scope,
        response_buf: &mut MutableString,
        print_buf: &mut Vec<u8>,
    ) -> Result<Box<[u8]>, GetOTPError> {
        let bump = bun_alloc::Arena::new();
        let manager_log: &mut bun_ast::Log = manager.log_mut();
        let res_source = bun_ast::Source::init_path_string(b"???", response_buf.list.as_slice());

        let res_json = match json_mod::parse_utf8(&res_source, manager_log, &bump) {
            Ok(j) => Some(j),
            Err(e) => {
                if e == bun_parsers::Error::Alloc(bun_alloc::AllocError) {
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
                // Note: bump-owned `&[u8]` — dupe into the process-lifetime
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
                let auth_url_is_web = {
                    let auth_url = URL::parse(auth_url_str.as_bytes());
                    auth_url.is_http() || auth_url.is_https()
                };

                // important to clone because it belongs to `response_buf`, and `response_buf` will be
                // reused with the following requests
                let Some(done_url_str) = json_get_string_cloned(&json, &bump, b"doneUrl")? else {
                    break 'try_web;
                };
                let done_url = URL::parse(crate::cli::cli_dupe(done_url_str));
                {
                    let registry_url = registry.url.url();
                    if !(done_url.is_http() || done_url.is_https())
                        || done_url.protocol != registry_url.protocol
                        || done_url.hostname != registry_url.hostname
                        || done_url.get_port_auto() != registry_url.get_port_auto()
                    {
                        break 'try_web;
                    }
                }

                if auth_url_is_web {
                    bun_core::prettyln!(
                        "\nAuthenticate your account at (press <b>ENTER<r> to open in browser):\n",
                    );
                } else {
                    bun_core::prettyln!("\nAuthenticate your account at:\n");
                }

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

                Output::print(format_args!("{}", top_left));
                for _ in 0..width {
                    Output::print(format_args!("{}", horizontal));
                }
                Output::print(format_args!("{}\n", top_right));

                Output::print(format_args!("{}", vertical));
                for _ in 0..PADDING {
                    Output::print(format_args!(" "));
                }
                bun_core::pretty!("<b>{}<r>", bstr::BStr::new(auth_url_str.as_bytes()));
                for _ in 0..PADDING {
                    Output::print(format_args!(" "));
                }
                Output::print(format_args!("{}\n", vertical));

                Output::print(format_args!("{}", bottom_left));
                for _ in 0..width {
                    Output::print(format_args!("{}", horizontal));
                }
                Output::print(format_args!("{}\n", bottom_right));
                Output::flush();

                if auth_url_is_web {
                    // on another thread because pressing enter is not required
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
                }

                let auth_headers = Self::construct_publish_headers(
                    print_buf,
                    registry,
                    None,
                    None,
                    Self::is_workspace_publish(manager),
                    manager.options.publish_config.auth_type,
                )?;

                loop {
                    response_buf.reset();

                    // Note: `done_url`/`auth_headers.entries` move into the
                    // request, so re-clone per iteration.
                    let mut req = manager.registry_request(
                        http::Method::GET,
                        done_url.clone(),
                        auth_headers.entries.clone()?,
                        auth_headers.content.written_slice(),
                        b"",
                    );

                    let res = match req.send_sync(response_buf) {
                        Ok(r) => r,
                        Err(e) => {
                            if e == bun_http::Error::Alloc(bun_alloc::AllocError) {
                                return Err(GetOTPError::OutOfMemory);
                            }
                            Output::err(e, "failed to send OTP request", ());
                            Global::crash();
                        }
                    };

                    match res.status_code() {
                        202 => {
                            // retry
                            let nanoseconds: u64 = 'nanoseconds: {
                                if let Some(retry) = res.header(b"retry-after") {
                                    'default: {
                                        let trimmed =
                                            strings::trim(retry, &strings::WHITESPACE_CHARS);
                                        // Header value is bytes, not UTF-8; use the byte-slice parser.
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
                                    if e == bun_parsers::Error::Alloc(bun_alloc::AllocError) {
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
                            if let Some(notice) =
                                res.header_if_other_is_absent(b"npm-notice", b"x-local-cache")
                            {
                                Output::print_error(format_args!("\n"));
                                bun_core::note!("{}", bun_fmt::escape_control_chars(notice));
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
                if matches!(e, crate::Error::Alloc(_)) {
                    return Err(GetOTPError::OutOfMemory);
                }
                Output::err(e, "failed to read OTP input", ());
                Global::crash();
            }
        }
    }

    pub(crate) fn normalized_package(
        manager: &PackageManager,
        abs_workspace_path: &[u8],
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
        // Note: `E::String` stores `&'static [u8]` (lifetime erased per the
        // parser's Str convention); dupe formatted buffers into the
        // process-lifetime CLI arena so they outlive the AST nodes through printing.
        macro_rules! leak {
            ($v:expr) => {
                crate::cli::cli_dupe(&$v) as &'static [u8]
            };
        }

        let registry = manager.scope_for_package_name(package_name);

        let version_without_build_tag = dependency::without_build_tag(package_version);

        Expr::set_string(json, &bump, b"version", leak!(version_without_build_tag))?;

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
                            strings::without_prefix(
                                &registry.url.url().href_without_auth(),
                                b"https://"
                            ),
                            b"http://",
                        ))),
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
            let workspace_root = match bun_sys::open_a(abs_workspace_path, bun_sys::O::DIRECTORY, 0)
            {
                Ok(fd) => fd,
                Err(e) => {
                    Output::err(e, "failed to open workspace directory", ());
                    Global::crash();
                }
            };
            let _close = bun_sys::CloseOnDrop::new(workspace_root);

            Self::normalize_bin(
                json,
                &bump,
                package_name,
                workspace_root,
                abs_workspace_path,
            )?;
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
                if e == bun_js_printer::Error::Alloc(bun_alloc::AllocError) {
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
    pub(crate) fn find_workspace_readme(abs_workspace_path: &[u8]) -> Option<ReadmeInfo> {
        let workspace_dir = bun_sys::open_dir_absolute(abs_workspace_path).ok()?;
        let _close = bun_sys::CloseOnDrop::new(workspace_dir);

        let mut iter = DirIterator::iterate(workspace_dir);
        while let Some(entry) = pack::next_dir_entry(&mut iter, b"") {
            // Symlinks are not packed, so a symlinked README is not the readme either.
            if entry.kind != bun_sys::EntryKind::File {
                continue;
            }
            // Entry names are UTF-8 on every platform.
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

    fn bin_target<'a>(
        value: &[u8],
        path_buf: &'a mut [u8],
        path_spill: &'a mut Vec<u8>,
    ) -> Option<&'a ZStr> {
        let target: &'a ZStr =
            normalize_buf_z_spill::<path::platform::Posix>(path_buf, path_spill, value);
        (!pack::is_package_root_or_outside(target.as_bytes())).then_some(target)
    }

    fn normalize_bin(
        json: &mut Expr,
        bump: &bun_alloc::Arena,
        package_name: &[u8],
        workspace_root: Fd,
        abs_workspace_path: &[u8],
    ) -> Result<(), AllocError> {
        // Note: see `normalized_package` — `E::String` stores
        // `&'static [u8]` (lifetime erased per the parser's Str convention);
        // dupe into the process-lifetime CLI arena for buffers that flow into AST nodes.
        macro_rules! leak {
            ($v:expr) => {
                crate::cli::cli_dupe($v) as &'static [u8]
            };
        }
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let mut path_spill: Vec<u8> = Vec::new();
        let use_directories_bin = pack::non_empty_bin(json).is_none();
        if let Some(bin_query) = json.as_property(b"bin") {
            match &bin_query.expr.data {
                ExprData::EString(bin_str) => {
                    let mut bin_props: Vec<G::Property> = Vec::new();
                    if let Some(value) =
                        Self::bin_target(bin_str.string(bump)?, &mut *path_buf, &mut path_spill)
                    {
                        if !bun_sys::exists_at(workspace_root, value) {
                            bun_core::warn!(
                                "bin '{}' does not exist",
                                bstr::BStr::new(value.as_bytes()),
                            );
                        }

                        bin_props.push(G::Property {
                            key: Some(Expr::init(
                                E::String::init(leak!(package_name)),
                                bun_ast::Loc::EMPTY,
                            )),
                            value: Some(Expr::init(
                                E::String::init(leak!(value.as_bytes())),
                                bun_ast::Loc::EMPTY,
                            )),
                            ..Default::default()
                        });
                    }

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
                                                normalize_buf_z_spill::<path::platform::Posix>(
                                                    &mut *path_buf,
                                                    &mut path_spill,
                                                    ks.string(bump)?,
                                                )
                                                .as_bytes(),
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

                        let Some(value) =
                            bin_prop.value.as_ref().and_then(|v| v.data.as_e_string())
                        else {
                            continue;
                        };
                        let Some(value) =
                            Self::bin_target(value.string(bump)?, &mut *path_buf, &mut path_spill)
                        else {
                            continue;
                        };

                        if !bun_sys::exists_at(workspace_root, value) {
                            bun_core::warn!(
                                "bin '{}' does not exist",
                                bstr::BStr::new(value.as_bytes()),
                            );
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
        }

        // An empty "bin" is `{}` by now. The listing replaces it.
        if use_directories_bin && let Some(directories_query) = json.as_property(b"directories") {
            if let Some(bin_query) = directories_query.expr.as_property(b"bin") {
                let Some(bin_dir_str) = bin_query.expr.as_string(bump) else {
                    return Ok(());
                };
                let mut bin_props: Vec<G::Property> = Vec::new();
                let Some(bin_dir_subpath) = pack::bin_subpath(
                    bin_dir_str,
                    pack::BinType::Dir,
                    &mut *path_buf,
                    &mut path_spill,
                ) else {
                    return Ok(());
                };
                let normalized_bin_dir = bun_core::ZBox::from_bytes(bin_dir_subpath);

                // The rule pack has for it: what is not in the tarball is not listed either.
                let not_packed = match pack::bin_kind_without_following_symlinks(
                    abs_workspace_path,
                    normalized_bin_dir.as_bytes(),
                ) {
                    FileKind::Directory => None,
                    FileKind::Unknown => Some("does not exist"),
                    _ => Some("is not a directory"),
                };
                if let Some(why) = not_packed {
                    bun_core::warn!(
                        "bin directory '{}' {}",
                        bstr::BStr::new(normalized_bin_dir.as_bytes()),
                        why,
                    );
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
                        Output::err(
                            e,
                            "failed to open bin directory: '{}'",
                            (bstr::BStr::new(normalized_bin_dir.as_bytes()),),
                        );
                        Global::crash();
                    }
                };

                let mut dirs: Vec<(Fd, Box<[u8]>)> = Vec::new();

                dirs.push((bin_dir, normalized_bin_dir.as_bytes().into()));

                while let Some((dir, dir_subpath)) = dirs.pop() {
                    let _close = bun_sys::CloseOnDrop::new(dir);

                    let mut iter = DirIterator::iterate(dir);
                    while let Some(entry) = pack::next_dir_entry(&mut iter, &dir_subpath) {
                        let (name, subpath): (&'static ZStr, &'static ZStr) = {
                            // Entry names are UTF-8 on every platform.
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
                            // Dupe into the process-lifetime CLI arena (bytes flow into long-lived `E::String` nodes).
                            let interned: &'static [u8] = crate::cli::cli_dupe(&join);
                            // SAFETY: NUL terminator at interned[join_len] (copied from `join`).
                            let join_z = ZStr::from_buf(interned, join_len);
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
                            let Ok(subdir) = bun_sys::openat(dir, name, bun_sys::O::DIRECTORY, 0)
                            else {
                                continue;
                            };
                            dirs.push((subdir, subpath.as_bytes().into()));
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
        let ci_name = bun_core::ci_info::detect_ci_name();
        // Every request these headers go on is on the registry's origin.
        let authorization = registry.authorization(&registry.url.url());

        {
            headers.count(b"accept", b"*/*");
            headers.count(b"accept-encoding", b"gzip,deflate");

            if let Some(authorization) = &authorization {
                headers.count(b"authorization", authorization);
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

            let _ = write!(
                print_buf,
                "{} {} {} workspaces/{}{}{}",
                Global::user_agent,
                Global::os_name,
                Global::arch_name,
                uses_workspaces,
                if ci_name.is_some() { " ci/" } else { "" },
                bstr::BStr::new(ci_name.unwrap_or(b"")),
            );
            // headers.count("user-agent", "npm/10.8.3 node/v24.3.0 darwin arm64 workspaces/false");
            headers.count(b"user-agent", &**print_buf);
            print_buf.clear();

            headers.count(b"Connection", b"keep-alive");
            headers.count(b"Host", registry.url.url().host);

            if let Some(json_len) = maybe_json_len {
                let _ = write!(print_buf, "{}", json_len);
                headers.count(b"Content-Length", &**print_buf);
                print_buf.clear();
            }
        }

        headers.allocate()?;

        {
            headers.append(b"accept", b"*/*");
            headers.append(b"accept-encoding", b"gzip,deflate");

            if let Some(authorization) = &authorization {
                headers.append(b"authorization", authorization);
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

            let _ = write!(
                print_buf,
                "{} {} {} workspaces/{}{}{}",
                Global::user_agent,
                Global::os_name,
                Global::arch_name,
                uses_workspaces,
                if ci_name.is_some() { " ci/" } else { "" },
                bstr::BStr::new(ci_name.unwrap_or(b"")),
            );
            // headers.append("user-agent", "npm/10.8.3 node/v24.3.0 darwin arm64 workspaces/false");
            headers.append(b"user-agent", &**print_buf);
            print_buf.clear();

            headers.append(b"Connection", b"keep-alive");
            headers.append(b"Host", registry.url.url().host);

            if let Some(json_len) = maybe_json_len {
                let _ = write!(print_buf, "{}", json_len);
                headers.append(b"Content-Length", &**print_buf);
                print_buf.clear();
            }
        }

        Ok(headers)
    }

    fn construct_publish_request_body(
        manager: &PackageManager,
        ctx: &Context,
    ) -> Result<Box<[u8]>, AllocError> {
        let tag: &[u8] = if !manager.options.publish_config.tag.is_empty() {
            manager.options.publish_config.tag
        } else {
            b"latest"
        };

        let encoded_tarball_len =
            bun_core::base64::standard_encoder_calc_size(ctx.tarball_bytes.len());
        let version_without_build_tag =
            install::dependency::without_build_tag(&ctx.package_version);

        let mut buf: Vec<u8> = Vec::with_capacity(
            ctx.package_name.len() * 5 + version_without_build_tag.len() * 4 + encoded_tarball_len,
        );

        let _ = write!(
            &mut buf,
            "{{\"_id\":\"{}\",\"name\":\"{}\"",
            bstr::BStr::new(&ctx.package_name),
            bstr::BStr::new(&ctx.package_name),
        );

        let _ = write!(
            &mut buf,
            ",\"dist-tags\":{{{}:\"{}\"}}",
            bun_fmt::format_json_string_utf8(tag, Default::default()),
            bstr::BStr::new(version_without_build_tag),
        );

        // "versions"
        {
            let _ = write!(
                &mut buf,
                ",\"versions\":{{\"{}\":{}}}",
                bstr::BStr::new(version_without_build_tag),
                bstr::BStr::new(&ctx.normalized_pkg_info),
            );
        }

        if let Some(access) = manager.options.publish_config.access {
            let _ = write!(&mut buf, ",\"access\":\"{}\"", access.as_str());
        } else {
            buf.extend_from_slice(b",\"access\":null");
        }

        // "_attachments"
        {
            let _ = write!(
                &mut buf,
                ",\"_attachments\":{{\"{}\":{{\"content_type\":\"application/octet-stream\",\"data\":\"",
                pack::fmt_tarball_filename(
                    &ctx.package_name,
                    &ctx.package_version,
                    pack::TarballNameStyle::Raw
                ),
            );

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

            let _ = write!(&mut buf, "\",\"length\":{}}}}}}}", ctx.tarball_bytes.len());
        }

        Ok(buf.into_boxed_slice())
    }
}

enum Published {
    Yes,
    /// `--tolerate-republish`: the registry already had this `name@version`, so nothing was sent.
    AlreadyOnRegistry,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub(crate) enum PublishError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("NeedAuth")]
    NeedAuth,
}
bun_core::oom_from_alloc!(PublishError);

impl PublishError {
    fn report_and_crash(self) -> ! {
        match self {
            PublishError::OutOfMemory => bun_core::out_of_memory(),
            PublishError::NeedAuth => {
                Output::err_generic("missing authentication (run <cyan>`bunx npm login`<r>)", ());
                Global::crash();
            }
        }
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub(crate) enum GetOTPError {
    #[error("OutOfMemory")]
    OutOfMemory,
}
bun_core::oom_from_alloc!(GetOTPError);
impl From<GetOTPError> for PublishError {
    fn from(_: GetOTPError) -> Self {
        PublishError::OutOfMemory
    }
}
