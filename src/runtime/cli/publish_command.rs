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

use bun_ast::expr::Data as ExprData;
use bun_core::OSPathChar;
use bun_install::Access;
use bun_install::LogLevel;
use bun_install::dependency::{self, TagExt as _};

use crate::Command;
use crate::cli::cli_dupe;
use crate::cli::pack_command::{self as pack, PackError};

pub(crate) struct ReadmeInfo {
    pub filename: Vec<u8>,
    pub contents: Vec<u8>,
}

/// Where to look for the files that `"bin"` and `"directories.bin"` refer to.
#[derive(Clone, Copy)]
pub(crate) enum PackageFiles<'a> {
    /// The folder that was packed.
    Folder { root: Fd, abs_path: &'a [u8] },
    /// The paths of the files in the tarball, without the leading `package/`.
    Tarball(&'a [Vec<u8>]),
}

impl PackageFiles<'_> {
    fn has(&self, subpath: &ZStr) -> bool {
        match self {
            PackageFiles::Folder { root, .. } => bun_sys::exists_at(*root, subpath),
            PackageFiles::Tarball(paths) => {
                let subpath = strings::without_trailing_slash(subpath.as_bytes());
                let is_at_or_below = |path: &Vec<u8>| {
                    (path.strip_prefix(subpath))
                        .is_some_and(|below| below.is_empty() || below[0] == b'/')
                };
                paths.iter().any(is_at_or_below)
            }
        }
    }
}

/// Matches npm's `{README,README.*}` glob, case-insensitively. Tar entry names are UTF-16 on
/// Windows.
fn is_readme_filename<T: bun_core::NoUninit + Into<u32>>(name: &[T]) -> bool {
    const README: &[u8] = b"README";
    name.len() >= README.len()
        && strings::eql_case_insensitive_t(&name[..README.len()], README)
        && (name.len() == README.len() || name[README.len()].into() == u32::from(b'.'))
}

fn archive_ok<T>(result: ArchiveIterResult<T>) -> T {
    match result {
        ArchiveIterResult::Result(value) => value,
        ArchiveIterResult::Err { archive, message } => {
            Output::err_generic(
                "{}: {}",
                (
                    bstr::BStr::new(message),
                    bstr::BStr::new(Archive::opaque_ref(archive).error_string()),
                ),
            );
            Global::crash();
        }
    }
}

/// `E::String` erases the lifetime of its bytes, so these have to outlive the printing of the AST.
fn string_property(key: &'static [u8], value: &'static [u8]) -> G::Property {
    G::Property {
        key: Some(Expr::init(E::String::init(key), bun_ast::Loc::EMPTY)),
        value: Some(Expr::init(E::String::init(value), bun_ast::Loc::EMPTY)),
        ..Default::default()
    }
}

fn object_expr(properties: Vec<G::Property>) -> Expr {
    Expr::init(
        E::Object {
            properties: G::PropertyList::move_from_list(properties),
            ..Default::default()
        },
        bun_ast::Loc::EMPTY,
    )
}

use crate::cli::init_command::InitCommand;
use crate::cli::open;
use crate::run_command::RunCommand as Run;

type SHA1Digest = [u8; sha::SHA1::DIGEST];
type SHA512Digest = [u8; sha::SHA512::DIGEST];

pub(crate) struct PublishCommand;

/// A thread that is blocked reading stdin cannot be stopped. When `--recursive` needs another
/// login, it reuses the thread that is still waiting for ENTER instead of starting a second one.
struct WebLogin {
    /// The URL that pressing ENTER opens. `None` once the login has finished.
    auth_url: Option<&'static [u8]>,
    waits_for_enter: bool,
}

static WEB_LOGIN: bun_core::Mutex<WebLogin> = bun_core::Mutex::new(WebLogin {
    auth_url: None,
    waits_for_enter: false,
});

/// What `bun publish` sends. The scripts are `None` when publishing a tarball, which doesn't run
/// any.
pub(crate) struct Context {
    pub(crate) package_name: Box<[u8]>,
    pub(crate) package_version: Box<[u8]>,
    pub(crate) tarball_bytes: Box<[u8]>,

    pub(crate) normalized_pkg_info: Box<[u8]>,

    pub(crate) publish_script: Option<Box<[u8]>>,
    pub(crate) postpublish_script: Option<Box<[u8]>>,
}

impl Context {
    /// `bun publish path/to/tarball.tgz`
    pub(crate) fn from_tarball_path(
        manager: &mut PackageManager,
        original_cwd: &[u8],
        tarball_path: &[u8],
    ) -> Result<Context, PackError> {
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
        let mut files: Vec<Vec<u8>> = Vec::new();

        let mut iter = archive_ok(ArchiveIterator::init(&tarball_bytes));

        let mut unpacked_size: usize = 0;
        let mut total_files: usize = 0;

        Output::print(format_args!("\n"));

        while let Some(next) = archive_ok(iter.next()) {
            // SAFETY: `next.entry` is valid until the next `iter.next()` call.
            let entry = unsafe { &*next.entry };
            #[cfg(windows)]
            let pathname: &[OSPathChar] = entry.pathname_w().as_slice();
            #[cfg(not(windows))]
            let pathname: &[OSPathChar] = entry.pathname().as_bytes();

            let size = usize::try_from(entry.size().max(0)).expect("int cast");

            unpacked_size += size;
            total_files += usize::from(next.kind == FileKind::File);

            // this is option `strip: 1` (npm expects a `package/` prefix for all paths)
            let stripped = (pathname.iter().position(|&c| bun_paths::is_sep_any_t(c)))
                .map(|slash| &pathname[slash + 1..]);
            if stripped.is_some_and(|stripped| stripped.is_empty()) {
                continue;
            }

            bun_core::pretty!(
                "<b><cyan>packed<r> {} {}\n",
                bun_fmt::size(
                    size,
                    bun_fmt::SizeFormatterOptions {
                        space_between_number_and_unit: false
                    }
                ),
                bun_fmt::EscapeControlChars(bun_fmt::fmt_os_path(
                    stripped.unwrap_or(pathname),
                    Default::default()
                )),
            );

            let Some(filename) = stripped else { continue };
            if next.kind != FileKind::File {
                continue;
            }
            #[cfg(not(windows))]
            files.push(filename.to_vec());
            #[cfg(windows)]
            files.push(strings::to_utf8_alloc(filename));
            if filename.iter().any(|&c| bun_paths::is_sep_any_t(c)) {
                continue;
            }

            if maybe_package_json_contents.is_none()
                && strings::eql_case_insensitive_t(filename, b"package.json")
            {
                maybe_package_json_contents = Some(archive_ok(iter.read_entry_data(&next)?));
            } else if maybe_readme.is_none() && is_readme_filename(filename) {
                let contents = archive_ok(iter.read_entry_data(&next)?).into_vec();
                #[cfg(not(windows))]
                let filename: Vec<u8> = filename.to_vec();
                #[cfg(windows)]
                let filename: Vec<u8> = strings::to_utf8_alloc(filename);
                maybe_readme = Some(ReadmeInfo { filename, contents });
            }
        }

        archive_ok(iter.close());

        let Some(package_json_contents) = maybe_package_json_contents else {
            Output::err_generic(
                "failed to find package.json in tarball '{}'",
                (bstr::BStr::new(tarball_path),),
            );
            Global::crash();
        };
        let package_json_contents: &'static [u8] = crate::cli::cli_adopt(package_json_contents);

        let bump = bun_alloc::Arena::new();
        let json_source = bun_ast::Source::init_path_string(b"package.json", package_json_contents);
        let mut json =
            match json_mod::parse_package_json_utf8(&json_source, manager.log_mut(), &bump) {
                Ok(j) => j,
                Err(bun_parsers::Error::Alloc(_)) => return Err(PackError::OutOfMemory),
                Err(_) => {
                    let _ = manager
                        .log_mut()
                        .print(std::ptr::from_mut(Output::error_writer()));
                    Output::err_generic("failed to parse tarball package.json", ());
                    Global::crash();
                }
            };
        pack::drop_shadowed_properties(json);

        if pack::is_private_package(&json) {
            return Err(PackError::PrivatePackage);
        }

        let package_name: Box<[u8]> = json
            .get_string_cloned(&bump, b"name")?
            .ok_or(PackError::MissingPackageName)?
            .into();
        let is_scoped = dependency::is_scoped_package_name(&package_name)
            .map_err(|_| PackError::InvalidPackageName)?;

        manager
            .options
            .apply_publish_config(&json, &bump, &package_name)?;
        PublishCommand::refuse_provenance(manager, &json);

        if manager.options.publish_config.access == Some(Access::Restricted) && !is_scoped {
            return Err(PackError::RestrictedUnscopedPackage);
        }

        let package_version = json
            .get_string_cloned(&bump, b"version")?
            .ok_or(PackError::MissingPackageVersion)?;
        let package_version: Box<[u8]> = pack::published_version(package_version)
            .ok_or(PackError::InvalidPackageVersion)?
            .into();
        PublishCommand::refuse_tag(manager, &package_version);

        let mut shasum: SHA1Digest = [0u8; sha::SHA1::DIGEST];
        let mut sha1 = sha::SHA1::init();
        sha1.update(&tarball_bytes);
        sha1.r#final(&mut shasum);

        let mut integrity: SHA512Digest = [0u8; sha::SHA512::DIGEST];
        let mut sha512 = sha::SHA512::init();
        sha512.update(&tarball_bytes);
        sha512.r#final(&mut integrity);

        let normalized_pkg_info = PublishCommand::normalized_package(
            manager,
            PackageFiles::Tarball(&files),
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

    /// For `bun publish` without a tarball path. Packs the package at `abs_package_json_path`.
    pub(crate) fn from_workspace(
        ctx: Command::Context<'_>,
        manager: &mut PackageManager,
        abs_package_json_path: &ZStr,
    ) -> Context {
        let pack_ctx = pack::Context {
            manager,
            command_ctx: ctx,
            bundled_deps: Vec::new(),
            stats: pack::Stats::default(),
        };

        match pack::pack(pack_ctx, abs_package_json_path, true) {
            Ok(context) => context.expect("pack for a publish always yields a publish context"),
            Err(err) => PublishCommand::report_pack_error_and_crash(err),
        }
    }
}

impl PublishCommand {
    /// Fails if provenance was requested. Publishing without the statement would look like success.
    pub(crate) fn refuse_provenance(manager: &PackageManager, package_json: &Expr) {
        let options = &manager.options;
        if let Some(asked_by) = options.provenance_asked_by(package_json, manager.env_mut()) {
            Output::err_generic(
                "{} is not supported yet: bun publish cannot generate provenance statements",
                (asked_by,),
            );
            Global::crash();
        }
    }

    /// Rejects the tags that `npm publish` rejects. Call this after `--tag` and `publishConfig.tag`
    /// have been applied.
    pub(crate) fn refuse_tag(manager: &PackageManager, package_version: &[u8]) {
        let tag = manager.options.publish_config.tag;
        if dependency::Tag::infer(tag) == dependency::Tag::Npm {
            Output::err_generic(
                "invalid tag \"{}\": cannot be a version or range",
                (bstr::BStr::new(tag),),
            );
            Global::crash();
        }

        let version = bun_semver::SlicedString::init(package_version, package_version);
        if tag.is_empty()
            && bun_semver::Version::parse_exact(version).is_some_and(|it| it.tag.has_pre())
        {
            Output::err_generic(
                "prerelease needs a tag: {} would become \"latest\"",
                (bstr::BStr::new(package_version),),
            );
            bun_core::note!(
                "pass a tag, for example <b>bun publish --tag next<r>, or <b>--tag latest<r> to publish it as \"latest\" anyway"
            );
            Global::crash();
        }
    }

    pub(crate) fn exec(ctx: Command::Context) -> Result<(), Error> {
        bun_core::prettyln!(
            "<r><b>bun publish <r><d>v{}<r>",
            Global::package_json_version_with_sha,
        );
        Output::flush();

        let cli = install::CommandLineArguments::parse(Subcommand::Publish)?;

        // `bun --filter='*' publish` means "run every workspace's `publish` script", not "publish
        // every workspace".
        let mut args_before_publish =
            (bun_core::argv().into_iter().skip(1)).take_while(|arg| *arg != b"publish");
        if let Some(flag) = args_before_publish.find(|arg| {
            matches!(*arg, b"-r" | b"--recursive" | b"--filter")
                || arg.starts_with(b"--filter=")
                || arg.starts_with(b"-F")
        }) {
            Output::err_generic(
                "refusing to publish: {} must come after \"publish\"",
                (bun_fmt::escape_control_chars(flag),),
            );
            bun_core::note!(
                "use <b>bun publish {}<r>, or <b>bun run --filter='*' publish<r> to run \"publish\" scripts",
                bun_fmt::escape_control_chars(flag)
            );
            Global::crash();
        }

        let (manager, original_cwd) =
            match PackageManager::init(&mut *ctx, &cli, Subcommand::Publish) {
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

        if cli.positionals.len() > 1 {
            if Self::is_workspace_publish(manager) {
                Output::err_generic(
                    "--recursive and --filter cannot be used with a tarball path",
                    (),
                );
                Global::crash();
            }

            let tarball_path = cli.positionals[1];
            let context = match Context::from_tarball_path(manager, &original_cwd, tarball_path) {
                Ok(context) => context,
                Err(err) => Self::report_pack_error_and_crash(err),
            };

            if bun_core::handle_oom(Self::publish(manager, &context)) {
                Self::print_published(manager, &context);
            }
            return Ok(());
        }

        if Self::is_workspace_publish(manager) {
            return Self::exec_workspaces(ctx, manager, &original_cwd);
        }

        let abs_package_json_path =
            bun_core::ZBox::from_bytes(manager.original_package_json_path.as_bytes());
        let context = Context::from_workspace(&mut *ctx, manager, &abs_package_json_path);

        if bun_core::handle_oom(Self::publish(manager, &context)) {
            Self::finish_directory_publish(ctx, manager, &context, &abs_package_json_path)?;
        }
        Ok(())
    }

    fn report_pack_error_and_crash(err: PackError) -> ! {
        Output::err_generic(
            match err {
                PackError::OutOfMemory => bun_core::out_of_memory(),
                PackError::MissingPackageName => "missing `name` string in package.json",
                PackError::MissingPackageVersion => "missing `version` string in package.json",
                PackError::InvalidPackageName => {
                    "package.json `name` and `version` fields must be non-empty strings"
                }
                PackError::InvalidPackageVersion => {
                    "package.json `version` is not a valid semver version"
                }
                PackError::RestrictedUnscopedPackage => {
                    "unable to restrict access to unscoped package"
                }
                PackError::PrivatePackage => "attempted to publish a private package",
            },
            (),
        );
        Global::crash();
    }

    /// For `-r` and `--filter`. Packs every selected workspace, then publishes them, dependencies
    /// first.
    fn exec_workspaces(
        ctx: Command::Context<'_>,
        manager: &mut PackageManager,
        original_cwd: &[u8],
    ) -> Result<(), Error> {
        let bump = bun_alloc::Arena::new();
        // Each with the options as its `publishConfig` left them.
        let mut packed: Vec<(bun_core::ZBox, PublishTarget, Context)> = Vec::new();
        for abs_package_json_path in
            workspace_manifests::selected_in_dependency_order(manager, original_cwd)
        {
            let abs_package_json_path = bun_core::ZBox::from_bytes(&abs_package_json_path);
            // Copied, because the scripts that `pack()` runs invalidate the cache that this points
            // into.
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
                    bun_fmt::escape_control_chars(if name.is_empty() {
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
                Self::require_credentials(registry);
                let exists = Self::check_package_version_exists(manager, &name, version, registry);
                bun_core::handle_oom(manager.options.set_publish_target(&cli_target));
                if exists {
                    bun_core::prettyln!(
                        "<d>skipped {}@{}: already on the registry<r>",
                        bun_fmt::escape_control_chars(&name),
                        bun_fmt::escape_control_chars(version),
                    );
                    continue;
                }
            }

            bun_core::prettyln!("\n<b><magenta>{}<r>", bun_fmt::escape_control_chars(&name));
            let context = Context::from_workspace(&mut *ctx, manager, &abs_package_json_path);
            let target = manager.options.publish_target(&name);
            bun_core::handle_oom(manager.options.set_publish_target(&cli_target));
            packed.push((abs_package_json_path, target, context));
        }

        for (abs_package_json_path, target, context) in &packed {
            bun_core::handle_oom(manager.options.set_publish_target(target));
            bun_core::prettyln!(
                "\n<b><magenta>{}<r>",
                bun_fmt::escape_control_chars(&context.package_name)
            );
            if bun_core::handle_oom(Self::publish(manager, context)) {
                Self::finish_directory_publish(&mut *ctx, manager, context, abs_package_json_path)?;
            }
        }

        Ok(())
    }

    fn print_published(manager: &PackageManager, context: &Context) {
        bun_core::prettyln!(
            "\n<green> +<r> {}@{}{}",
            bun_fmt::escape_control_chars(&context.package_name),
            bun_fmt::escape_control_chars(dependency::without_build_tag(&context.package_version)),
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

        let scripts: [(&[u8], &Option<Box<[u8]>>); 2] = [
            (b"publish", &context.publish_script),
            (b"postpublish", &context.postpublish_script),
        ];
        for (name, script) in scripts {
            let Some(script) = script else { continue };
            if let Err(e) = Run::run_lifecycle_script_foreground(
                ctx,
                script,
                name,
                abs_workspace_path,
                script_env,
                manager.options.log_level == LogLevel::Silent,
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
        let package_url = Self::package_url(registry, package_name);

        let Ok(mut response_buf) = MutableString::init(1024) else {
            return false;
        };

        let authorization = registry.authorization(&package_url);
        let mut pairs: Vec<(&[u8], &[u8])> = vec![(b"accept", b"application/json")];
        if let Some(authorization) = &authorization {
            pairs.push((b"authorization", authorization));
        }
        let Ok(headers) = http::HeaderBuilder::from_pairs(&pairs) else {
            return false;
        };

        let mut req = manager.registry_request(
            http::Method::GET,
            package_url,
            headers.entries,
            headers.content.written_slice(),
            b"",
        );

        let Ok(res) = manager.send_with_retries(&mut req, &mut response_buf) else {
            return false;
        };
        Self::print_npm_notice(&res);
        if res.status_code() != 200 {
            return false;
        }

        let source = bun_ast::Source::init_path_string(b"???", response_buf.list.as_slice());
        let mut log = bun_ast::Log::init();
        let bump = bun_alloc::Arena::new();
        let Ok(json) = json_mod::parse_utf8(&source, &mut log, &bump) else {
            return false;
        };

        (json.get(b"versions")).is_some_and(|versions| versions.get(version).is_some())
    }

    fn is_workspace_publish(manager: &PackageManager) -> bool {
        manager.options.do_.recursive() || !manager.options.filter_patterns.is_empty()
    }

    fn require_credentials(registry: &Npm::Registry::Scope) {
        if registry.authorization_parts(&registry.url.url()).is_none() {
            Output::err_generic("missing authentication (run <cyan>`bunx npm login`<r>)", ());
            Global::crash();
        }
    }

    fn package_url(registry: &Npm::Registry::Scope, package_name: &[u8]) -> URL<'static> {
        let href = format!(
            "{}/{}",
            bstr::BStr::new(strings::without_trailing_slash(registry.url.href())),
            bun_fmt::dependency_url(package_name),
        );
        URL::parse(cli_dupe(href.as_bytes()))
    }

    // https://github.com/npm/cli/blob/534ad7789e5c61f579f44d782bdd18ea3ff1ee20/node_modules/npm-registry-fetch/lib/check-response.js#L14
    fn print_npm_notice(res: &http::HTTPResponseMetadata) {
        if let Some(notice) = res.header_if_other_is_absent(b"npm-notice", b"x-local-cache") {
            Output::print_error(format_args!("\n"));
            bun_core::note!("{}", bun_fmt::escape_control_chars(notice));
            Output::flush();
        }
    }

    fn send_or_crash(
        req: &mut http::AsyncHTTP<'_>,
        response_buf: &mut MutableString,
        failure: &str,
    ) -> Result<http::HTTPResponseMetadata, AllocError> {
        match req.send_sync(response_buf) {
            Ok(res) => {
                Self::print_npm_notice(&res);
                Ok(res)
            }
            Err(http::Error::Alloc(_)) => Err(AllocError),
            Err(e) => {
                Output::err(e, failure, ());
                Global::crash();
            }
        }
    }

    /// Returns false if `--tolerate-republish` is set and the registry already had this
    /// `name@version`, so nothing was sent.
    fn publish(manager: &PackageManager, ctx: &Context) -> Result<bool, AllocError> {
        let registry = manager.scope_for_package_name(&ctx.package_name);
        let registry_url = registry.url.url();

        Self::require_credentials(registry);

        if manager.options.publish_config.tolerate_republish {
            let version_without_build_tag = dependency::without_build_tag(&ctx.package_version);
            if Self::check_package_version_exists(
                manager,
                &ctx.package_name,
                version_without_build_tag,
                registry,
            ) {
                bun_core::warn!(
                    "Registry already knows about version {}; skipping.",
                    bun_fmt::escape_control_chars(version_without_build_tag),
                );
                return Ok(false);
            }
        }

        // continues from `printSummary`
        let registry_href = registry_url.href_without_auth();
        bun_core::pretty!(
            "<b><blue>Tag<r>: {}\n<b><blue>Access<r>: {}\n<b><blue>Registry<r>: {}/\n",
            bun_fmt::escape_control_chars(if !manager.options.publish_config.tag.is_empty() {
                manager.options.publish_config.tag
            } else {
                b"latest"
            }),
            (manager.options.publish_config.access).map_or("default", Access::as_str),
            bun_fmt::escape_control_chars(strings::without_trailing_slash(&registry_href)),
        );

        if manager.options.dry_run {
            return Ok(true);
        }

        let publish_req_body: &'static [u8] =
            crate::cli::cli_adopt(Self::construct_publish_request_body(manager, ctx)?);

        let publish_headers = Self::construct_publish_headers(
            manager,
            registry,
            Some(publish_req_body.len()),
            Some(manager.options.publish_config.otp).filter(|otp| !otp.is_empty()),
        )?;

        let mut response_buf = MutableString::init(1024)?;
        let publish_url = Self::package_url(registry, &ctx.package_name);

        let mut req = manager.registry_request(
            http::Method::PUT,
            publish_url.clone(),
            publish_headers.entries,
            publish_headers.content.written_slice(),
            publish_req_body,
        );
        let res = Self::send_or_crash(&mut req, &mut response_buf, "failed to publish package")?;

        if res.status_code() < 400 {
            return Ok(true);
        }

        let prompt_for_otp = 'prompt_for_otp: {
            if res.status_code() != 401 {
                break 'prompt_for_otp false;
            }

            let Some(www_authenticate) = res.header(b"www-authenticate") else {
                break 'prompt_for_otp strings::contains(&response_buf.list, b"one-time pass");
            };
            let mut iter = strings::split(www_authenticate, b",");
            while let Some(part) = iter.next() {
                let trimmed = strings::trim(part, &strings::WHITESPACE_CHARS);
                if strings::eql_case_insensitive_ascii(trimmed, b"ipaddress", true) {
                    Output::err_generic("login is not allowed from your IP address", ());
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
        };

        if !prompt_for_otp {
            Npm::response_error::<false>(
                &req,
                &res,
                Some((&ctx.package_name, &ctx.package_version)),
                &mut response_buf,
            )?;
        }

        let otp = Self::get_otp(manager, ctx, registry, &mut response_buf)?;

        let otp_headers = Self::construct_publish_headers(
            manager,
            registry,
            Some(publish_req_body.len()),
            Some(&otp),
        )?;

        response_buf.reset();

        let mut otp_req = manager.registry_request(
            http::Method::PUT,
            publish_url,
            otp_headers.entries,
            otp_headers.content.written_slice(),
            publish_req_body,
        );
        let otp_res =
            Self::send_or_crash(&mut otp_req, &mut response_buf, "failed to publish package")?;

        if otp_res.status_code() >= 400 {
            Npm::response_error::<true>(
                &otp_req,
                &otp_res,
                Some((&ctx.package_name, &ctx.package_version)),
                &mut response_buf,
            )?;
        }

        Ok(true)
    }

    fn press_enter_to_open_in_browser() {
        // This prevents backspace from deleting the entire line
        #[cfg(windows)]
        let _stdin_mode =
            bun_sys::windows::StdinModeGuard::set(bun_sys::windows::UpdateStdioModeFlagsOpts {
                unset: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT,
                ..Default::default()
            });

        // This runs on its own thread, and `Output::buffered_stdin()` is for the main thread only.
        let mut input = [0u8; 1024];
        loop {
            match bun_sys::read(Fd::stdin(), &mut input) {
                Ok(0) | Err(_) => return,
                Ok(len) if strings::contains_char(&input[..len], b'\n') => break,
                Ok(_) => continue,
            }
        }

        let auth_url = {
            let mut login = WEB_LOGIN.lock();
            login.waits_for_enter = false;
            login.auth_url.take()
        };
        if let Some(auth_url) = auth_url {
            let _ = bun_core::spawn_sync_inherit(&[open::OPENER, auth_url]);
        }
    }

    fn get_otp(
        manager: &PackageManager,
        ctx: &Context,
        registry: &Npm::Registry::Scope,
        response_buf: &mut MutableString,
    ) -> Result<Box<[u8]>, AllocError> {
        let bump = bun_alloc::Arena::new();
        let manager_log: &mut bun_ast::Log = manager.log_mut();
        let res_source = bun_ast::Source::init_path_string(b"???", response_buf.list.as_slice());

        'try_web: {
            let json = match json_mod::parse_utf8(&res_source, manager_log, &bump) {
                Ok(json) => json,
                Err(bun_parsers::Error::Alloc(_)) => return Err(AllocError),
                // https://github.com/npm/cli/blob/63d6a732c3c0e9c19fd4d147eaa5cc27c29b168d/node_modules/npm-registry-fetch/lib/check-response.js#L65
                // invalid json is ignored
                Err(_) => break 'try_web,
            };

            let Some(auth_url_str) = json.get_string_cloned(&bump, b"authUrl")? else {
                break 'try_web;
            };
            // The thread that opens it outlives `bump`.
            let auth_url_str: &'static [u8] = cli_dupe(auth_url_str);
            let auth_url = URL::parse(auth_url_str);
            let shown_auth_url = bun_fmt::escape_control_chars(auth_url_str).to_string();
            // ENTER only opens a URL that the box shows exactly as it is, with nothing escaped.
            let auth_url_is_web = (auth_url.is_http() || auth_url.is_https())
                && shown_auth_url.as_bytes() == auth_url_str;

            let Some(done_url_str) = json.get_string_cloned(&bump, b"doneUrl")? else {
                break 'try_web;
            };
            let done_url = URL::parse(cli_dupe(done_url_str));
            let registry_url = registry.url.url();
            if !(done_url.is_http() || done_url.is_https())
                || done_url.protocol != registry_url.protocol
                || done_url.hostname != registry_url.hostname
                || done_url.get_port_auto() != registry_url.get_port_auto()
            {
                break 'try_web;
            }

            if auth_url_is_web {
                bun_core::prettyln!(
                    "\nAuthenticate your account at (press <b>ENTER<r> to open in browser):\n",
                );
            } else {
                bun_core::prettyln!("\nAuthenticate your account at:\n");
            }

            let [
                horizontal,
                vertical,
                top_left,
                top_right,
                bottom_left,
                bottom_right,
            ] = if Output::enable_ansi_colors_stdout() {
                ["─", "│", "┌", "┐", "└", "┘"]
            } else {
                ["-", "|", "|", "|", "|", "|"]
            };
            let line = horizontal.repeat(shown_auth_url.len() + 2);

            Output::print(format_args!("{top_left}{line}{top_right}\n{vertical} "));
            bun_core::pretty!("<b>{}<r>", shown_auth_url);
            Output::print(format_args!(
                " {vertical}\n{bottom_left}{line}{bottom_right}\n"
            ));
            Output::flush();

            // on another thread because pressing enter is not required
            if auth_url_is_web {
                let mut login = WEB_LOGIN.lock();
                login.auth_url = Some(auth_url_str);
                if !std::mem::replace(&mut login.waits_for_enter, true)
                    && std::thread::Builder::new()
                        .spawn(Self::press_enter_to_open_in_browser)
                        .is_err()
                {
                    Output::err(
                        "ThreadSpawn",
                        "failed to spawn thread for opening auth url",
                        (),
                    );
                    Global::crash();
                }
            }

            let auth_headers = Self::construct_publish_headers(manager, registry, None, None)?;

            loop {
                response_buf.reset();

                let mut req = manager.registry_request(
                    http::Method::GET,
                    done_url.clone(),
                    auth_headers.entries.clone()?,
                    auth_headers.content.written_slice(),
                    b"",
                );
                let res =
                    Self::send_or_crash(&mut req, response_buf, "failed to send OTP request")?;

                match res.status_code() {
                    202 => {
                        let milliseconds = (res.header(b"retry-after"))
                            .and_then(|retry| {
                                let trimmed = strings::trim(retry, &strings::WHITESPACE_CHARS);
                                strings::parse_int::<u32>(trimmed, 10).ok()
                            })
                            .map_or(500, |seconds| u64::from(seconds) * 1000);
                        std::thread::sleep(std::time::Duration::from_millis(milliseconds));
                    }
                    200 => {
                        WEB_LOGIN.lock().auth_url = None;

                        let done_bump = bun_alloc::Arena::new();
                        let otp_done_source =
                            bun_ast::Source::init_path_string(b"???", response_buf.list.as_slice());
                        let otp_done_json =
                            match json_mod::parse_utf8(&otp_done_source, manager_log, &done_bump) {
                                Ok(j) => j,
                                Err(bun_parsers::Error::Alloc(_)) => return Err(AllocError),
                                Err(_) => {
                                    Output::err("WebLogin", "failed to parse response json", ());
                                    Global::crash();
                                }
                            };

                        let Some(token) = otp_done_json.get_string_cloned(&done_bump, b"token")?
                        else {
                            Output::err("WebLogin", "missing `token` field in reponse json", ());
                            Global::crash();
                        };
                        if http::async_http::breaks_header_line(token) {
                            Output::err("WebLogin", "invalid `token` field in response json", ());
                            Global::crash();
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

        match InitCommand::prompt(
            "\nThis operation requires a one-time password.\nEnter OTP: ",
            b"",
        ) {
            Ok(v) => Ok(v.into()),
            Err(crate::Error::Alloc(_)) => Err(AllocError),
            Err(e) => {
                Output::err(e, "failed to read OTP input", ());
                Global::crash();
            }
        }
    }

    pub(crate) fn normalized_package(
        manager: &PackageManager,
        files: PackageFiles<'_>,
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
        let registry = manager.scope_for_package_name(package_name);

        let version_without_build_tag = dependency::without_build_tag(package_version);

        // `E::String` erases the lifetime of its bytes, so `cli_dupe` keeps them alive through
        // printing.
        Expr::set_string(json, &bump, b"version", cli_dupe(version_without_build_tag))?;

        let integrity_fmt = cli_dupe(
            bun_fmt::integrity::<false>(integrity)
                .to_string()
                .as_bytes(),
        );
        let shasum_fmt = cli_dupe(bun_fmt::hex_lower(&shasum).to_string().as_bytes());
        let id = format!(
            "{}@{}",
            bstr::BStr::new(package_name),
            bstr::BStr::new(version_without_build_tag)
        );

        Expr::set_string(json, &bump, b"_id", cli_dupe(id.as_bytes()))?;
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

        // Like `npm publish` does. A `readme` in package.json takes precedence.
        if let Some(r) = readme {
            if json.get(b"readme").is_none() {
                Expr::set_string(json, &bump, b"readme", cli_dupe(&r.contents))?;
                Expr::set_string(json, &bump, b"readmeFilename", cli_dupe(&r.filename))?;
            }
        }

        let tarball = format!(
            "http://{}/{}/-/{}",
            // Always http, never https, as in npm's libnpmpublish/lib/publish.js.
            bstr::BStr::new(strings::without_trailing_slash(strings::without_prefix(
                strings::without_prefix(&registry.url.url().href_without_auth(), b"https://"),
                b"http://",
            ))),
            bstr::BStr::new(package_name),
            pack::fmt_tarball_filename(package_name, package_version, pack::TarballNameStyle::Raw),
        );

        json.set(
            &bump,
            b"dist",
            object_expr(vec![
                string_property(b"integrity", integrity_fmt),
                string_property(b"shasum", shasum_fmt),
                string_property(b"tarball", cli_dupe(tarball.as_bytes())),
            ]),
        )?;

        Self::normalize_bin(json, &bump, package_name, &files)?;

        let buffer_writer = bun_js_printer::BufferWriter::init();
        let mut writer = bun_js_printer::BufferPrinter::init(buffer_writer);

        if let Err(e) = bun_js_printer::print_json(
            &mut writer,
            *json,
            json_source,
            bun_js_printer::PrintJsonOptions {
                minify_whitespace: true,
                mangled_props: None,
                ..Default::default()
            },
        ) {
            if e == bun_js_printer::Error::Alloc(bun_alloc::AllocError) {
                return Err(AllocError);
            }
            Output::err_generic("failed to print normalized package.json: {}", (e.name(),));
            Global::crash();
        }

        Ok(writer.ctx.written_without_trailing_zero().into())
    }

    /// The first README `readdir` returns, as `npm publish` picks it.
    pub(crate) fn find_workspace_readme(abs_workspace_path: &[u8]) -> Option<ReadmeInfo> {
        let workspace_dir = bun_sys::open_dir_absolute(abs_workspace_path).ok()?;
        let _close = bun_sys::CloseOnDrop::new(workspace_dir);

        let mut iter = DirIterator::iterate(workspace_dir);
        while let Some(entry) = pack::next_dir_entry(&mut iter, b"") {
            let name = entry.name.slice_u8();
            // Symlinks are not packed, so a symlinked README is not the readme either.
            if entry.kind == bun_sys::EntryKind::File && is_readme_filename(name) {
                return Some(ReadmeInfo {
                    filename: name.to_vec(),
                    contents: bun_sys::File::read_from(workspace_dir, name).ok()?,
                });
            }
        }
        None
    }

    /// Adds `key: value`, unless `value` is the package root or outside of it.
    fn push_bin(
        bin_props: &mut Vec<G::Property>,
        key: &[u8],
        value: &[u8],
        files: &PackageFiles<'_>,
        path_buf: &mut [u8],
        path_spill: &mut Vec<u8>,
    ) {
        let target = normalize_buf_z_spill::<path::platform::Posix>(path_buf, path_spill, value);
        if pack::is_package_root_or_outside(target.as_bytes()) {
            return;
        }
        if !files.has(target) {
            bun_core::warn!(
                "bin '{}' does not exist",
                bun_fmt::escape_control_chars(target.as_bytes()),
            );
        }
        bin_props.push(string_property(cli_dupe(key), cli_dupe(target.as_bytes())));
    }

    fn normalize_bin(
        json: &mut Expr,
        bump: &bun_alloc::Arena,
        package_name: &[u8],
        files: &PackageFiles<'_>,
    ) -> Result<(), AllocError> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let mut path_spill: Vec<u8> = Vec::new();
        let use_directories_bin = pack::non_empty_bin(json).is_none();
        if let Some(bin_query) = json.as_property(b"bin") {
            let mut bin_props: Vec<G::Property> = Vec::new();
            match &bin_query.expr.data {
                ExprData::EString(bin_str) => Self::push_bin(
                    &mut bin_props,
                    package_name,
                    bin_str.string(bump)?,
                    files,
                    &mut *path_buf,
                    &mut path_spill,
                ),
                ExprData::EObject(bin_obj) => {
                    for bin_prop in bin_obj.properties.slice() {
                        let Some(key) = (bin_prop.key.as_ref())
                            .and_then(|key| key.data.as_e_string())
                            .filter(|key| key.len() != 0)
                        else {
                            continue;
                        };
                        let key: Box<[u8]> = strings::without_prefix(
                            normalize_buf_z_spill::<path::platform::Posix>(
                                &mut *path_buf,
                                &mut path_spill,
                                key.string(bump)?,
                            )
                            .as_bytes(),
                            b"./",
                        )
                        .into();
                        if key.is_empty() {
                            continue;
                        }

                        let Some(value) =
                            bin_prop.value.as_ref().and_then(|v| v.data.as_e_string())
                        else {
                            continue;
                        };
                        Self::push_bin(
                            &mut bin_props,
                            &key,
                            value.string(bump)?,
                            files,
                            &mut *path_buf,
                            &mut path_spill,
                        );
                    }
                }
                // It isn't empty either, so "directories" isn't checked.
                _ => return Ok(()),
            }

            json.data
                .e_object_mut()
                .expect("infallible: variant checked")
                .properties
                .slice_mut()[bin_query.i as usize]
                .value = Some(object_expr(bin_props));
        }

        // An empty "bin" is `{}` by now. The listing replaces it.
        if !use_directories_bin {
            return Ok(());
        }
        let Some(bin_dir_str) = (json.get(b"directories"))
            .and_then(|directories| directories.get(b"bin"))
            .and_then(|bin| bin.as_string(bump))
        else {
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

        let (workspace_root, abs_workspace_path) = match files {
            PackageFiles::Folder { root, abs_path } => (*root, *abs_path),
            PackageFiles::Tarball(paths) => {
                for path in paths.iter() {
                    if (path.strip_prefix(normalized_bin_dir.as_bytes()))
                        .is_some_and(|below| below.len() > 1 && below[0] == b'/')
                    {
                        bin_props.push(string_property(
                            cli_dupe(bun_paths::basename_posix(path)),
                            cli_dupe(path),
                        ));
                    }
                }
                if bin_props.is_empty() {
                    bun_core::warn!(
                        "bin directory '{}' does not exist",
                        bun_fmt::escape_control_chars(normalized_bin_dir.as_bytes()),
                    );
                    return Ok(());
                }
                return json.set(bump, b"bin", object_expr(bin_props));
            }
        };

        // The same rule as in pack: a file that isn't in the tarball isn't listed either.
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
                bun_fmt::escape_control_chars(normalized_bin_dir.as_bytes()),
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

        let mut dirs: Vec<(Fd, Box<[u8]>)> = vec![(bin_dir, normalized_bin_dir.as_bytes().into())];

        while let Some((dir, dir_subpath)) = dirs.pop() {
            let _close = bun_sys::CloseOnDrop::new(dir);

            let mut iter = DirIterator::iterate(dir);
            while let Some(entry) = pack::next_dir_entry(&mut iter, &dir_subpath) {
                let name = entry.name.slice_u8();
                let mut join: Vec<u8> = Vec::new();
                let _ = write!(
                    &mut join,
                    "{}{}{}\0",
                    bstr::BStr::new(&dir_subpath),
                    // only using posix separators
                    if dir_subpath.is_empty() { "" } else { "/" },
                    bstr::BStr::new(strings::without_trailing_slash(name)),
                );
                let join_len = join.len() - 1;
                let interned: &'static [u8] = cli_dupe(&join);
                let subpath = &interned[..join_len];
                // SAFETY: name is the trailing segment of `interned`, NUL-terminated
                let name = unsafe {
                    ZStr::from_raw(interned.as_ptr().add(join_len - name.len()), name.len())
                };

                if matches!(name.as_bytes(), b"" | b"." | b"..") {
                    continue;
                }

                bin_props.push(string_property(
                    cli_dupe(bun_paths::basename_posix(subpath)),
                    subpath,
                ));

                if entry.kind == bun_sys::EntryKind::Directory {
                    let Ok(subdir) = bun_sys::openat(dir, name, bun_sys::O::DIRECTORY, 0) else {
                        continue;
                    };
                    dirs.push((subdir, subpath.into()));
                }
            }
        }

        json.set(bump, b"bin", object_expr(bin_props))
    }

    fn construct_publish_headers(
        manager: &PackageManager,
        registry: &Npm::Registry::Scope,
        maybe_json_len: Option<usize>,
        maybe_otp: Option<&[u8]>,
    ) -> Result<http::HeaderBuilder, AllocError> {
        let npm_auth_type: &[u8] = match manager.options.publish_config.auth_type {
            _ if maybe_otp.is_some() => b"legacy",
            Some(auth) => auth.as_str().as_bytes(),
            None => b"web",
        };
        let ci_name = bun_core::ci_info::detect_ci_name();
        let registry_url = registry.url.url();
        // Every request these headers go on is on the registry's origin.
        let authorization = registry.authorization(&registry_url);
        let user_agent = format!(
            "{} {} {} workspaces/{}{}{}",
            Global::user_agent,
            Global::os_name,
            Global::arch_name,
            Self::is_workspace_publish(manager),
            if ci_name.is_some() { " ci/" } else { "" },
            bstr::BStr::new(ci_name.unwrap_or(b"")),
        );
        let content_length = maybe_json_len.map(|json_len| json_len.to_string());

        let mut pairs: Vec<(&[u8], &[u8])> =
            vec![(b"accept", b"*/*"), (b"accept-encoding", b"gzip,deflate")];
        if let Some(authorization) = &authorization {
            pairs.push((b"authorization", authorization));
        }
        if maybe_json_len.is_some() {
            // not using `MimeType.json.value`, verdaccio will fail if it's anything other than `application/json`
            pairs.push((b"content-type", b"application/json"));
        }
        pairs.push((b"npm-auth-type", npm_auth_type));
        if let Some(otp) = maybe_otp {
            pairs.push((b"npm-otp", otp));
        }
        pairs.push((b"npm-command", b"publish"));
        pairs.push((b"user-agent", user_agent.as_bytes()));
        pairs.push((b"Connection", b"keep-alive"));
        pairs.push((b"Host", registry_url.host));
        if let Some(content_length) = &content_length {
            pairs.push((b"Content-Length", content_length.as_bytes()));
        }

        http::HeaderBuilder::from_pairs(&pairs)
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
        let version_without_build_tag = dependency::without_build_tag(&ctx.package_version);

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

        let _ = write!(
            &mut buf,
            ",\"versions\":{{\"{}\":{}}}",
            bstr::BStr::new(version_without_build_tag),
            bstr::BStr::new(&ctx.normalized_pkg_info),
        );

        if let Some(access) = manager.options.publish_config.access {
            let _ = write!(&mut buf, ",\"access\":\"{}\"", access.as_str());
        } else {
            buf.extend_from_slice(b",\"access\":null");
        }

        let _ = write!(
            &mut buf,
            ",\"_attachments\":{{\"{}\":{{\"content_type\":\"application/octet-stream\",\"data\":\"",
            pack::fmt_tarball_filename(
                &ctx.package_name,
                &ctx.package_version,
                pack::TarballNameStyle::Raw
            ),
        );

        // SAFETY: `encode_raw` writes exactly `encoded_tarball_len` bytes into the reserved spare
        // capacity; `fill_spare` commits exactly that count.
        let count = unsafe {
            bun_core::vec::fill_spare(&mut buf, encoded_tarball_len, |spare| {
                let n = simdutf::base64::encode_raw(&ctx.tarball_bytes, spare.as_mut_ptr(), false);
                (n, n)
            })
        };
        debug_assert!(count == encoded_tarball_len);

        let _ = write!(&mut buf, "\",\"length\":{}}}}}}}", ctx.tarball_bytes.len());

        Ok(buf.into_boxed_slice())
    }
}
