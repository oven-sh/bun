use std::io::Write as _;

use bun_alloc::AllocError;
use bun_core::{err, Environment, Error, Global, Output};
use bun_core::fmt as bun_fmt;
use bun_str::{strings, ZStr};
use bun_paths::{self as path, PathBuffer};
use bun_logger as logger;
use bun_sys::{self, Fd, File};
use bun_http as http;
use bun_http::HeaderBuilder;
use bun_install::{self as install, Dependency, Lockfile, Npm, PackageManager};
use bun_libarchive::lib::Archive;
use bun_fs::FileSystem;
use bun_dotenv as dotenv;
use bun_sha as sha;
use bun_json as json_mod;
use bun_url::URL;
use bun_collections::MutableString;
use bun_js_parser::Expr;
use bun_ast::{E, G};
use bun_ci as ci;
use bun_simdutf as simdutf;
use bun_dir_iterator::DirIterator;

use crate::Command;
use crate::pack_command::{self as pack, PackCommand as Pack};
use crate::run_command::RunCommand as Run;
use crate::init_command::prompt;
use crate::open;

pub struct PublishCommand;

// TODO(port): Zig used `if (directory_publish) ?[]const u8 else void` for the script fields
// and `if (directory_publish) *DotEnv.Loader else void` for script_env. Rust const generics
// cannot vary field types; we keep them as Option<> in both instantiations and rely on
// invariants (always None / never used when DIRECTORY_PUBLISH == false).
pub struct Context<'a, const DIRECTORY_PUBLISH: bool> {
    pub manager: &'a mut PackageManager,
    pub command_ctx: Command::Context,

    pub package_name: Box<[u8]>,
    pub package_version: Box<[u8]>,
    pub abs_tarball_path: Box<ZStr>,
    pub tarball_bytes: Box<[u8]>,
    pub shasum: sha::SHA1Digest,
    pub integrity: sha::SHA512Digest,
    pub uses_workspaces: bool,

    pub normalized_pkg_info: Box<[u8]>,

    pub publish_script: Option<Box<[u8]>>,
    pub postpublish_script: Option<Box<[u8]>>,
    pub script_env: Option<&'a mut dotenv::Loader>,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum FromTarballError {
    OutOfMemory,
    MissingPackageJSON,
    InvalidPackageJSON,
    MissingPackageName,
    MissingPackageVersion,
    InvalidPackageName,
    InvalidPackageVersion,
    PrivatePackage,
    RestrictedUnscopedPackage,
}
impl From<AllocError> for FromTarballError {
    fn from(_: AllocError) -> Self {
        FromTarballError::OutOfMemory
    }
}

impl<'a, const DIRECTORY_PUBLISH: bool> Context<'a, DIRECTORY_PUBLISH> {
    /// Retrieve information for publishing from a tarball path, `bun publish path/to/tarball.tgz`
    pub fn from_tarball_path(
        ctx: Command::Context,
        manager: &'a mut PackageManager,
        tarball_path: &[u8],
    ) -> Result<Context<'a, DIRECTORY_PUBLISH>, FromTarballError> {
        let mut abs_buf = PathBuffer::uninit();
        let abs_tarball_path = path::join_abs_string_buf_z(
            FileSystem::instance().top_level_dir,
            &mut abs_buf,
            &[tarball_path],
            path::Platform::Auto,
        );

        let tarball_bytes = match File::read_from(Fd::INVALID, abs_tarball_path).unwrap() {
            Ok(b) => b,
            Err(e) => {
                Output::err(e, format_args!("failed to read tarball: '{}'", bstr::BStr::new(tarball_path)));
                Global::crash();
            }
        };

        let mut maybe_package_json_contents: Option<Box<[u8]>> = None;

        let mut iter = match Archive::Iterator::init(&tarball_bytes) {
            bun_sys::Result::Err(e) => {
                Output::err_generic(format_args!(
                    "{}: {}",
                    bstr::BStr::new(e.message),
                    bstr::BStr::new(e.archive.error_string()),
                ));
                Global::crash();
            }
            bun_sys::Result::Ok(res) => res,
        };

        let mut unpacked_size: usize = 0;
        let mut total_files: usize = 0;

        Output::print(format_args!("\n"));

        loop {
            let next = match iter.next() {
                bun_sys::Result::Err(e) => {
                    Output::err_generic(format_args!(
                        "{}: {}",
                        bstr::BStr::new(e.message),
                        bstr::BStr::new(e.archive.error_string()),
                    ));
                    Global::crash();
                }
                bun_sys::Result::Ok(res) => res,
            };
            let Some(next) = next else { break };

            #[cfg(windows)]
            let pathname = next.entry.pathname_w();
            #[cfg(not(windows))]
            let pathname = next.entry.pathname();

            let size = next.entry.size();

            unpacked_size += usize::try_from(size.max(0)).unwrap();
            total_files += (next.kind == Archive::EntryKind::File) as usize;

            // this is option `strip: 1` (npm expects a `package/` prefix for all paths)
            if let Some(slash) = strings::index_of_any_t::<bun_paths::OSPathChar>(pathname, b"/\\") {
                let stripped = &pathname[slash + 1..];
                if stripped.is_empty() {
                    continue;
                }

                Output::pretty(format_args!(
                    "<b><cyan>packed<r> {} {}\n",
                    bun_fmt::size(size, bun_fmt::SizeOptions { space_between_number_and_unit: false }),
                    bun_fmt::fmt_os_path(stripped, Default::default()),
                ));

                if next.kind != Archive::EntryKind::File {
                    continue;
                }

                if strings::index_of_any_t::<bun_paths::OSPathChar>(stripped, b"/\\").is_none() {
                    // check for package.json, readme.md, ...
                    let filename = &pathname[slash + 1..];

                    if maybe_package_json_contents.is_none()
                        && strings::eql_case_insensitive_t::<bun_paths::OSPathChar>(filename, b"package.json")
                    {
                        maybe_package_json_contents = Some(match next.read_entry_data(iter.archive)? {
                            bun_sys::Result::Err(e) => {
                                Output::err_generic(format_args!(
                                    "{}: {}",
                                    bstr::BStr::new(e.message),
                                    bstr::BStr::new(e.archive.error_string()),
                                ));
                                Global::crash();
                            }
                            bun_sys::Result::Ok(bytes) => bytes,
                        });
                    }
                }
            } else {
                Output::pretty(format_args!(
                    "<b><cyan>packed<r> {} {}\n",
                    bun_fmt::size(size, bun_fmt::SizeOptions { space_between_number_and_unit: false }),
                    bun_fmt::fmt_os_path(pathname, Default::default()),
                ));
            }
        }

        match iter.deinit() {
            bun_sys::Result::Err(e) => {
                Output::err_generic(format_args!(
                    "{}: {}",
                    bstr::BStr::new(e.message),
                    bstr::BStr::new(e.archive.error_string()),
                ));
                Global::crash();
            }
            bun_sys::Result::Ok(()) => {}
        }

        let package_json_contents = maybe_package_json_contents
            .ok_or(FromTarballError::MissingPackageJSON)?;

        let (package_name, package_version, mut json, json_source) = 'package_info: {
            let source = logger::Source::init_path_string(b"package.json", &package_json_contents);
            let json = match json_mod::parse_package_json_utf8(&source, manager.log) {
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
                    if let Some(tag) = config.get_string_cloned(b"tag")? {
                        manager.options.publish_config.tag = tag;
                    }
                }

                if manager.options.publish_config.access.is_none() {
                    if let Some(access) = config.get_string(b"access")? {
                        manager.options.publish_config.access = Some(
                            install::package_manager::Options::Access::from_str(access.0).unwrap_or_else(|| {
                                Output::err_generic(format_args!(
                                    "invalid `access` value: '{}'",
                                    bstr::BStr::new(access.0),
                                ));
                                Global::crash();
                            }),
                        );
                    }
                }

                // maybe otp
            }

            let name = json
                .get_string_cloned(b"name")?
                .ok_or(FromTarballError::MissingPackageName)?;
            let is_scoped = Dependency::is_scoped_package_name(&name)?;

            if let Some(access) = manager.options.publish_config.access {
                if access == install::package_manager::Options::Access::Restricted && !is_scoped {
                    return Err(FromTarballError::RestrictedUnscopedPackage);
                }
            }

            let version = json
                .get_string_cloned(b"version")?
                .ok_or(FromTarballError::MissingPackageVersion)?;
            if version.is_empty() {
                return Err(FromTarballError::InvalidPackageVersion);
            }

            break 'package_info (name, version, json, source);
        };

        let mut shasum: sha::SHA1Digest = Default::default();
        let mut sha1 = sha::SHA1::init();
        sha1.update(&tarball_bytes);
        sha1.final_(&mut shasum);
        drop(sha1);

        let mut integrity: sha::SHA512Digest = Default::default();
        let mut sha512 = sha::SHA512::init();
        sha512.update(&tarball_bytes);
        sha512.final_(&mut integrity);
        drop(sha512);

        let normalized_pkg_info = PublishCommand::normalized_package(
            manager,
            &package_name,
            &package_version,
            &mut json,
            &json_source,
            shasum,
            integrity,
        )?;

        Pack::Context::print_summary(
            pack::Stats {
                total_files,
                unpacked_size,
                packed_size: tarball_bytes.len(),
            },
            shasum,
            integrity,
            manager.options.log_level,
        );

        Ok(Context {
            manager,
            package_name,
            package_version,
            abs_tarball_path: ZStr::from_bytes(abs_tarball_path.as_bytes()),
            tarball_bytes,
            shasum,
            integrity,
            uses_workspaces: false,
            command_ctx: ctx,
            script_env: None,
            normalized_pkg_info,
            publish_script: None,
            postpublish_script: None,
        })
    }

    pub type FromWorkspaceError = pack::PackError<true>;

    /// `bun publish` without a tarball path. Automatically pack the current workspace and get
    /// information required for publishing
    pub fn from_workspace(
        ctx: Command::Context,
        manager: &'a mut PackageManager,
    ) -> Result<Context<'a, DIRECTORY_PUBLISH>, Self::FromWorkspaceError> {
        // TODO(port): in-place init — Lockfile::loadFromCwd writes into out-param `lockfile`
        let mut lockfile = Lockfile::default();
        let load_from_disk_result = lockfile.load_from_cwd(
            manager,
            manager.log,
            false,
        );

        let mut pack_ctx = Pack::Context {
            manager,
            command_ctx: ctx,
            lockfile: match load_from_disk_result {
                Lockfile::LoadResult::Ok(ok) => Some(ok.lockfile),
                Lockfile::LoadResult::NotFound => None,
                Lockfile::LoadResult::Err(cause) => 'err: {
                    match cause.step {
                        Lockfile::LoadStep::OpenFile => {
                            if cause.value == err!(ENOENT) {
                                break 'err None;
                            }
                            Output::err_generic(format_args!(
                                "failed to open lockfile: {}",
                                cause.value.name(),
                            ));
                        }
                        Lockfile::LoadStep::ParseFile => {
                            Output::err_generic(format_args!(
                                "failed to parse lockfile: {}",
                                cause.value.name(),
                            ));
                        }
                        Lockfile::LoadStep::ReadFile => {
                            Output::err_generic(format_args!(
                                "failed to read lockfile: {}",
                                cause.value.name(),
                            ));
                        }
                        Lockfile::LoadStep::Migrating => {
                            Output::err_generic(format_args!(
                                "failed to migrate lockfile: {}",
                                cause.value.name(),
                            ));
                        }
                    }

                    if manager.log.has_errors() {
                        let _ = manager.log.print(Output::error_writer());
                    }

                    Global::crash();
                }
            },
            ..Default::default()
        };

        Pack::pack(&mut pack_ctx, &manager.original_package_json_path, true)
    }
}

impl PublishCommand {
    pub fn exec(ctx: Command::Context) -> Result<(), Error> {
        // TODO(port): narrow error set
        Output::prettyln(format_args!(
            concat!("<r><b>bun publish <r><d>v", env!("BUN_PACKAGE_JSON_VERSION_WITH_SHA"), "<r>"),
        ));
        // TODO(port): Global.package_json_version_with_sha — using env! placeholder above
        Output::flush();

        let cli = PackageManager::CommandLineArguments::parse(PackageManager::Subcommand::Publish)?;

        let (manager, original_cwd) = match PackageManager::init(ctx, &cli, PackageManager::Subcommand::Publish) {
            Ok(v) => v,
            Err(e) => {
                if !cli.silent {
                    if e == err!(MissingPackageJSON) {
                        Output::err_generic(format_args!("missing package.json, nothing to publish"));
                    }
                    Output::err_generic(format_args!(
                        "failed to initialize bun install: {}",
                        e.name(),
                    ));
                }
                Global::crash();
            }
        };
        drop(original_cwd);

        if cli.positionals.len() > 1 {
            let context = match Context::<false>::from_tarball_path(ctx, manager, &cli.positionals[1]) {
                Ok(c) => c,
                Err(e) => {
                    match e {
                        FromTarballError::OutOfMemory => bun_core::out_of_memory(),
                        FromTarballError::MissingPackageName => {
                            Output::err_generic(format_args!("missing `name` string in package.json"));
                        }
                        FromTarballError::MissingPackageVersion => {
                            Output::err_generic(format_args!("missing `version` string in package.json"));
                        }
                        FromTarballError::InvalidPackageName | FromTarballError::InvalidPackageVersion => {
                            Output::err_generic(format_args!(
                                "package.json `name` and `version` fields must be non-empty strings",
                            ));
                        }
                        FromTarballError::MissingPackageJSON => {
                            Output::err_generic(format_args!(
                                "failed to find package.json in tarball '{}'",
                                bstr::BStr::new(&cli.positionals[1]),
                            ));
                        }
                        FromTarballError::InvalidPackageJSON => {
                            let _ = manager.log.print(Output::error_writer());
                            Output::err_generic(format_args!("failed to parse tarball package.json"));
                        }
                        FromTarballError::PrivatePackage => {
                            Output::err_generic(format_args!("attempted to publish a private package"));
                        }
                        FromTarballError::RestrictedUnscopedPackage => {
                            Output::err_generic(format_args!("unable to restrict access to unscoped package"));
                        }
                    }
                    Global::crash();
                }
            };

            if let Err(e) = Self::publish::<false>(&context) {
                match e {
                    PublishError::OutOfMemory => bun_core::out_of_memory(),
                    PublishError::NeedAuth => {
                        Output::err_generic(format_args!(
                            "missing authentication (run <cyan>`bunx npm login`<r>)",
                        ));
                        Global::crash();
                    }
                }
            }

            Output::prettyln(format_args!(
                "\n<green> +<r> {}@{}{}",
                bstr::BStr::new(&context.package_name),
                bstr::BStr::new(Dependency::without_build_tag(&context.package_version)),
                if manager.options.dry_run { " (dry-run)" } else { "" },
            ));

            return Ok(());
        }

        let context = match Context::<true>::from_workspace(ctx, manager) {
            Ok(c) => c,
            Err(e) => {
                // TODO(port): FromWorkspaceError = Pack.PackError(true) — matching against bun_core::Error consts
                match e {
                    e if e == err!(OutOfMemory) => bun_core::out_of_memory(),
                    e if e == err!(MissingPackageName) => {
                        Output::err_generic(format_args!("missing `name` string in package.json"));
                    }
                    e if e == err!(MissingPackageVersion) => {
                        Output::err_generic(format_args!("missing `version` string in package.json"));
                    }
                    e if e == err!(InvalidPackageName) || e == err!(InvalidPackageVersion) => {
                        Output::err_generic(format_args!(
                            "package.json `name` and `version` fields must be non-empty strings",
                        ));
                    }
                    e if e == err!(MissingPackageJSON) => {
                        Output::err_generic(format_args!(
                            "failed to find package.json from: '{}'",
                            bstr::BStr::new(FileSystem::instance().top_level_dir),
                        ));
                    }
                    e if e == err!(RestrictedUnscopedPackage) => {
                        Output::err_generic(format_args!("unable to restrict access to unscoped package"));
                    }
                    e if e == err!(PrivatePackage) => {
                        Output::err_generic(format_args!("attempted to publish a private package"));
                    }
                    _ => {}
                }
                Global::crash();
            }
        };

        // TODO: read this into memory
        let _ = bun_sys::unlink(&context.abs_tarball_path);

        if let Err(e) = Self::publish::<true>(&context) {
            match e {
                PublishError::OutOfMemory => bun_core::out_of_memory(),
                PublishError::NeedAuth => {
                    Output::err_generic(format_args!(
                        "missing authentication (run <cyan>`bunx npm login`<r>)",
                    ));
                    Global::crash();
                }
            }
        }

        Output::prettyln(format_args!(
            "\n<green> +<r> {}@{}{}",
            bstr::BStr::new(&context.package_name),
            bstr::BStr::new(Dependency::without_build_tag(&context.package_version)),
            if manager.options.dry_run { " (dry-run)" } else { "" },
        ));

        if manager.options.do_.run_scripts {
            let abs_workspace_path: &[u8] = strings::without_trailing_slash(
                strings::without_suffix(&manager.original_package_json_path, b"package.json"),
            );
            context.script_env.as_ref().unwrap().map.put(b"npm_command", b"publish")?;

            if let Some(publish_script) = &context.publish_script {
                if let Err(e) = Run::run_package_script_foreground(
                    context.command_ctx,
                    publish_script,
                    b"publish",
                    abs_workspace_path,
                    context.script_env.as_ref().unwrap(),
                    &[],
                    context.manager.options.log_level == install::package_manager::LogLevel::Silent,
                    context.command_ctx.debug.use_system_shell,
                ) {
                    if e == err!(MissingShell) {
                        Output::err_generic(format_args!(
                            "failed to find shell executable to run publish script",
                        ));
                        Global::crash();
                    } else if e == err!(OutOfMemory) {
                        return Err(e);
                    }
                }
            }

            if let Some(postpublish_script) = &context.postpublish_script {
                if let Err(e) = Run::run_package_script_foreground(
                    context.command_ctx,
                    postpublish_script,
                    b"postpublish",
                    abs_workspace_path,
                    context.script_env.as_ref().unwrap(),
                    &[],
                    context.manager.options.log_level == install::package_manager::LogLevel::Silent,
                    context.command_ctx.debug.use_system_shell,
                ) {
                    if e == err!(MissingShell) {
                        Output::err_generic(format_args!(
                            "failed to find shell executable to run postpublish script",
                        ));
                        Global::crash();
                    } else if e == err!(OutOfMemory) {
                        return Err(e);
                    }
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
        let registry_url = strings::without_trailing_slash(&registry.url.href);
        let encoded_name = bun_fmt::dependency_url(package_name);

        // Try to get package metadata to check if version exists
        if write!(&mut url_buf, "{}/{}", bstr::BStr::new(registry_url), encoded_name).is_err() {
            return false;
        }

        let package_url = URL::parse(&url_buf);

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
            // SAFETY: headers.content was allocated above
            unsafe { core::slice::from_raw_parts(headers.content.ptr.unwrap(), headers.content.len) },
            &mut response_buf,
            b"",
            None,
            None,
            http::Redirect::Follow,
        );

        let Ok(res) = req.send_sync() else {
            return false;
        };
        if res.status_code != 200 {
            return false;
        }

        // Parse the response to check if this specific version exists
        let source = logger::Source::init_path_string(b"???", &response_buf.list);
        let mut log = logger::Log::init();
        let Ok(json) = json_mod::parse_utf8(&source, &mut log) else {
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

        if registry.token.is_empty() && (registry.url.password.is_empty() || registry.url.username.is_empty()) {
            return Err(PublishError::NeedAuth);
        }

        let tolerate_republish = ctx.manager.options.publish_config.tolerate_republish;
        if tolerate_republish {
            let version_without_build_tag = Dependency::without_build_tag(&ctx.package_version);
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
                &ctx.manager.options.publish_config.tag[..]
            } else {
                b"latest"
            }),
            if let Some(access) = ctx.manager.options.publish_config.access {
                <&'static str>::from(access)
            } else {
                "default"
            },
            bstr::BStr::new(&registry.url.href),
        ));

        // dry-run stops here
        if ctx.manager.options.dry_run {
            return Ok(());
        }

        let publish_req_body = Self::construct_publish_request_body::<DIRECTORY_PUBLISH>(ctx)?;

        let mut print_buf: Vec<u8> = Vec::new();

        let publish_headers = Self::construct_publish_headers(
            &mut print_buf,
            registry,
            Some(publish_req_body.len()),
            if !ctx.manager.options.publish_config.otp.is_empty() {
                Some(&ctx.manager.options.publish_config.otp[..])
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
            bstr::BStr::new(strings::without_trailing_slash(&registry.url.href)),
            bun_fmt::dependency_url(&ctx.package_name),
        )?;
        let publish_url = URL::parse(Box::<[u8]>::from(&print_buf[..]));
        print_buf.clear();

        let mut req = http::AsyncHTTP::init_sync(
            http::Method::PUT,
            publish_url,
            publish_headers.entries,
            // SAFETY: publish_headers.content was allocated by construct_publish_headers
            unsafe { core::slice::from_raw_parts(publish_headers.content.ptr.unwrap(), publish_headers.content.len) },
            &mut response_buf,
            &publish_req_body,
            None,
            None,
            http::Redirect::Follow,
        );

        let res = match req.send_sync() {
            Ok(r) => r,
            Err(e) => {
                if e == err!(OutOfMemory) {
                    return Err(PublishError::OutOfMemory);
                }
                Output::err(e, format_args!("failed to publish package"));
                Global::crash();
            }
        };

        match res.status_code {
            400..=u16::MAX => {
                // TODO(port): Zig used @TypeOf(res.status_code); assuming u16
                let prompt_for_otp = 'prompt_for_otp: {
                    if res.status_code != 401 {
                        break 'prompt_for_otp false;
                    }

                    if let Some(www_authenticate) = res.headers.get(b"www-authenticate") {
                        let mut iter = strings::split(www_authenticate, b",");
                        while let Some(part) = iter.next() {
                            let trimmed = strings::trim(part, strings::WHITESPACE_CHARS);
                            if strings::eql_case_insensitive_ascii(trimmed, b"ipaddress", true) {
                                Output::err_generic(format_args!(
                                    "login is not allowed from your IP address",
                                ));
                                Global::crash();
                            } else if strings::eql_case_insensitive_ascii(trimmed, b"otp", true) {
                                break 'prompt_for_otp true;
                            }
                        }

                        Output::err_generic(format_args!(
                            "unable to authenticate, need: {}",
                            bstr::BStr::new(www_authenticate),
                        ));
                        Global::crash();
                    } else if strings::contains(&response_buf.list, b"one-time pass") {
                        // missing www-authenicate header but one-time pass is still included
                        break 'prompt_for_otp true;
                    }

                    break 'prompt_for_otp false;
                };

                if !prompt_for_otp {
                    // general error
                    let otp_response = false;
                    Npm::response_error(
                        &req,
                        &res,
                        (&ctx.package_name, &ctx.package_version),
                        &mut response_buf,
                        otp_response,
                    )?;
                }

                // https://github.com/npm/cli/blob/534ad7789e5c61f579f44d782bdd18ea3ff1ee20/node_modules/npm-registry-fetch/lib/check-response.js#L14
                // ignore if x-local-cache exists
                if let Some(notice) = res.headers.get_if_other_is_absent(b"npm-notice", b"x-local-cache") {
                    Output::print_error(format_args!("\n"));
                    Output::note(format_args!("{}", bstr::BStr::new(notice)));
                    Output::flush();
                }

                let otp = Self::get_otp::<DIRECTORY_PUBLISH>(ctx, registry, &mut response_buf, &mut print_buf)?;

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
                    // SAFETY: otp_headers.content was allocated by construct_publish_headers
                    unsafe { core::slice::from_raw_parts(otp_headers.content.ptr.unwrap(), otp_headers.content.len) },
                    &mut response_buf,
                    &publish_req_body,
                    None,
                    None,
                    http::Redirect::Follow,
                );

                let otp_res = match otp_req.send_sync() {
                    Ok(r) => r,
                    Err(e) => {
                        if e == err!(OutOfMemory) {
                            return Err(PublishError::OutOfMemory);
                        }
                        Output::err(e, format_args!("failed to publish package"));
                        Global::crash();
                    }
                };

                match otp_res.status_code {
                    400..=u16::MAX => {
                        let otp_response = true;
                        Npm::response_error(
                            &otp_req,
                            &otp_res,
                            (&ctx.package_name, &ctx.package_version),
                            &mut response_buf,
                            otp_response,
                        )?;
                    }
                    _ => {
                        // https://github.com/npm/cli/blob/534ad7789e5c61f579f44d782bdd18ea3ff1ee20/node_modules/npm-registry-fetch/lib/check-response.js#L14
                        // ignore if x-local-cache exists
                        if let Some(notice) = otp_res.headers.get_if_other_is_absent(b"npm-notice", b"x-local-cache") {
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
        let original_mode: Option<bun_sys::windows::DWORD> =
            bun_sys::windows::update_stdio_mode_flags(
                bun_sys::windows::StdHandle::StdIn,
                bun_sys::windows::ModeFlagsUpdate {
                    unset: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT,
                    ..Default::default()
                },
            )
            .ok();
        #[cfg(not(windows))]
        let original_mode: () = ();

        #[cfg(windows)]
        let _restore = scopeguard::guard((), |_| {
            if let Some(mode) = original_mode {
                // SAFETY: SetConsoleMode is safe to call with stdin handle
                unsafe {
                    let _ = bun_sys::c::SetConsoleMode(Fd::stdin().native(), mode);
                }
            }
        });
        #[cfg(not(windows))]
        let _ = original_mode;

        loop {
            match Output::buffered_stdin().reader().read_byte() {
                Ok(b'\n') => break,
                Ok(_) => continue,
                Err(_) => return,
            }
        }

        // TODO(port): Zig used std.process.Child here; bun_spawn::spawn_sync should be substituted in Phase B
        let mut child = bun_spawn::Child::init(&[open::OPENER, auth_url.as_bytes()]);
        let _ = child.spawn_and_wait();
    }

    fn get_otp<const DIRECTORY_PUBLISH: bool>(
        ctx: &Context<'_, DIRECTORY_PUBLISH>,
        registry: &Npm::Registry::Scope,
        response_buf: &mut MutableString,
        print_buf: &mut Vec<u8>,
    ) -> Result<Box<[u8]>, GetOTPError> {
        let res_source = logger::Source::init_path_string(b"???", &response_buf.list);

        let res_json = match json_mod::parse_utf8(&res_source, ctx.manager.log) {
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
                let Some(auth_url_str) = json.get_string_cloned_z(b"authUrl")? else {
                    break 'try_web;
                };

                // important to clone because it belongs to `response_buf`, and `response_buf` will be
                // reused with the following requests
                let Some(done_url_str) = json.get_string_cloned(b"doneUrl")? else {
                    break 'try_web;
                };
                let done_url = URL::parse(&done_url_str);

                Output::prettyln(format_args!(
                    "\nAuthenticate your account at (press <b>ENTER<r> to open in browser):\n",
                ));

                const OFFSET: usize = 0;
                const PADDING: usize = 1;

                let horizontal = if Output::enable_ansi_colors_stdout() { "─" } else { "-" };
                let vertical = if Output::enable_ansi_colors_stdout() { "│" } else { "|" };
                let top_left = if Output::enable_ansi_colors_stdout() { "┌" } else { "|" };
                let top_right = if Output::enable_ansi_colors_stdout() { "┐" } else { "|" };
                let bottom_left = if Output::enable_ansi_colors_stdout() { "└" } else { "|" };
                let bottom_right = if Output::enable_ansi_colors_stdout() { "┘" } else { "|" };

                let width = (PADDING * 2) + auth_url_str.len();

                for _ in 0..OFFSET { Output::print(format_args!(" ")); }
                Output::print(format_args!("{}", top_left));
                for _ in 0..width { Output::print(format_args!("{}", horizontal)); }
                Output::println(format_args!("{}", top_right));

                for _ in 0..OFFSET { Output::print(format_args!(" ")); }
                Output::print(format_args!("{}", vertical));
                for _ in 0..PADDING { Output::print(format_args!(" ")); }
                Output::pretty(format_args!("<b>{}<r>", bstr::BStr::new(auth_url_str.as_bytes())));
                for _ in 0..PADDING { Output::print(format_args!(" ")); }
                Output::println(format_args!("{}", vertical));

                for _ in 0..OFFSET { Output::print(format_args!(" ")); }
                Output::print(format_args!("{}", bottom_left));
                for _ in 0..width { Output::print(format_args!("{}", horizontal)); }
                Output::println(format_args!("{}", bottom_right));
                Output::flush();

                // on another thread because pressing enter is not required
                // TODO(port): Zig used std.Thread.spawn — bun_threading equivalent in Phase B
                match bun_threading::Thread::spawn(move || Self::press_enter_to_open_in_browser(&auth_url_str)) {
                    Ok(t) => t.detach(),
                    Err(e) => {
                        Output::err(e, format_args!("failed to spawn thread for opening auth url"));
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

                    let mut req = http::AsyncHTTP::init_sync(
                        http::Method::GET,
                        done_url,
                        auth_headers.entries,
                        // SAFETY: auth_headers.content was allocated by construct_publish_headers
                        unsafe { core::slice::from_raw_parts(auth_headers.content.ptr.unwrap(), auth_headers.content.len) },
                        response_buf,
                        b"",
                        None,
                        None,
                        http::Redirect::Follow,
                    );

                    let res = match req.send_sync() {
                        Ok(r) => r,
                        Err(e) => {
                            if e == err!(OutOfMemory) {
                                return Err(GetOTPError::OutOfMemory);
                            }
                            Output::err(e, format_args!("failed to send OTP request"));
                            Global::crash();
                        }
                    };

                    match res.status_code {
                        202 => {
                            // retry
                            let nanoseconds: u64 = 'nanoseconds: {
                                if let Some(retry) = res.headers.get(b"retry-after") {
                                    'default: {
                                        let trimmed = strings::trim(retry, strings::WHITESPACE_CHARS);
                                        // PORT NOTE: std.fmt.parseInt(u32, _, 10) — header value is bytes,
                                        // not UTF-8; use the byte-slice parser per PORTING.md.
                                        let Ok(seconds) = strings::parse_int::<u32>(trimmed, 10) else {
                                            break 'default;
                                        };
                                        break 'nanoseconds (seconds as u64) * 1_000_000_000;
                                    }
                                }

                                break 'nanoseconds 500 * 1_000_000;
                            };

                            bun_threading::Thread::sleep_ns(nanoseconds);
                            continue;
                        }
                        200 => {
                            // login successful
                            let otp_done_source = logger::Source::init_path_string(b"???", &response_buf.list);
                            let otp_done_json = match json_mod::parse_utf8(&otp_done_source, ctx.manager.log) {
                                Ok(j) => j,
                                Err(e) => {
                                    if e == err!(OutOfMemory) {
                                        return Err(GetOTPError::OutOfMemory);
                                    }
                                    Output::err("WebLogin", format_args!("failed to parse response json"));
                                    Global::crash();
                                }
                            };

                            let token = otp_done_json.get_string_cloned(b"token")?.unwrap_or_else(|| {
                                Output::err("WebLogin", format_args!("missing `token` field in reponse json"));
                                Global::crash();
                            });

                            // https://github.com/npm/cli/blob/534ad7789e5c61f579f44d782bdd18ea3ff1ee20/node_modules/npm-registry-fetch/lib/check-response.js#L14
                            // ignore if x-local-cache exists
                            if let Some(notice) = res.headers.get_if_other_is_absent(b"npm-notice", b"x-local-cache") {
                                Output::print_error(format_args!("\n"));
                                Output::note(format_args!("{}", bstr::BStr::new(notice)));
                                Output::flush();
                            }

                            return Ok(token);
                        }
                        _ => {
                            let otp_response = false;
                            Npm::response_error(
                                &req,
                                &res,
                                (&ctx.package_name, &ctx.package_version),
                                response_buf,
                                otp_response,
                            )?;
                        }
                    }
                }
            }
        }

        // classic
        match prompt(b"\nThis operation requires a one-time password.\nEnter OTP: ", b"") {
            Ok(v) => Ok(v),
            Err(e) => {
                if e == err!(OutOfMemory) {
                    return Err(GetOTPError::OutOfMemory);
                }
                Output::err(e, format_args!("failed to read OTP input"));
                Global::crash();
            }
        }
    }

    pub fn normalized_package(
        manager: &mut PackageManager,
        package_name: &[u8],
        package_version: &[u8],
        json: &mut Expr,
        json_source: &logger::Source,
        shasum: sha::SHA1Digest,
        integrity: sha::SHA512Digest,
    ) -> Result<Box<[u8]>, AllocError> {
        debug_assert!(json.is_object());

        let registry = manager.scope_for_package_name(package_name);

        let version_without_build_tag = Dependency::without_build_tag(package_version);

        let integrity_fmt = {
            let mut v = Vec::new();
            write!(&mut v, "{}", bun_fmt::integrity(integrity, bun_fmt::IntegrityFormat::Full))?;
            v.into_boxed_slice()
        };

        json.set_string(b"_id", {
            let mut v = Vec::new();
            write!(&mut v, "{}@{}", bstr::BStr::new(package_name), bstr::BStr::new(version_without_build_tag))?;
            v.into_boxed_slice()
        })?;
        json.set_string(b"_integrity", integrity_fmt.clone())?;
        json.set_string(b"_nodeVersion", Environment::REPORTED_NODEJS_VERSION.as_bytes())?;
        // TODO: npm version
        json.set_string(b"_npmVersion", b"10.8.3")?;
        json.set_string(b"integrity", integrity_fmt)?;
        json.set_string(b"shasum", {
            let mut v = Vec::new();
            write!(&mut v, "{}", bun_fmt::bytes_to_hex_lower(&shasum))?;
            v.into_boxed_slice()
        })?;

        let mut dist_props: Box<[G::Property]> = vec![G::Property::default(); 3].into_boxed_slice();
        dist_props[0] = G::Property {
            key: Some(Expr::init(
                E::String { data: b"integrity".into() },
                logger::Loc::EMPTY,
            )),
            value: Some(Expr::init(
                E::String {
                    data: {
                        let mut v = Vec::new();
                        write!(&mut v, "{}", bun_fmt::integrity(integrity, bun_fmt::IntegrityFormat::Full))?;
                        v.into_boxed_slice()
                    },
                },
                logger::Loc::EMPTY,
            )),
            ..Default::default()
        };
        dist_props[1] = G::Property {
            key: Some(Expr::init(
                E::String { data: b"shasum".into() },
                logger::Loc::EMPTY,
            )),
            value: Some(Expr::init(
                E::String {
                    data: {
                        let mut v = Vec::new();
                        write!(&mut v, "{}", bun_fmt::bytes_to_hex_lower(&shasum))?;
                        v.into_boxed_slice()
                    },
                },
                logger::Loc::EMPTY,
            )),
            ..Default::default()
        };
        dist_props[2] = G::Property {
            key: Some(Expr::init(
                E::String { data: b"tarball".into() },
                logger::Loc::EMPTY,
            )),
            value: Some(Expr::init(
                E::String {
                    data: {
                        let mut v = Vec::new();
                        write!(
                            &mut v,
                            "http://{}/{}/-/{}",
                            // always use replace https with http
                            // https://github.com/npm/cli/blob/9281ebf8e428d40450ad75ba61bc6f040b3bf896/workspaces/libnpmpublish/lib/publish.js#L120
                            bstr::BStr::new(strings::without_trailing_slash(
                                strings::without_prefix(&registry.url.href, b"https://"),
                            )),
                            bstr::BStr::new(package_name),
                            Pack::fmt_tarball_filename(package_name, package_version, pack::TarballFilenameStyle::Raw),
                        )?;
                        v.into_boxed_slice()
                    },
                },
                logger::Loc::EMPTY,
            )),
            ..Default::default()
        };

        json.set(b"dist", Expr::init(
            E::Object {
                properties: G::Property::List::from_owned_slice(dist_props),
                ..Default::default()
            },
            logger::Loc::EMPTY,
        ))?;

        {
            let workspace_root = match bun_sys::open_a(
                strings::without_suffix(&manager.original_package_json_path, b"package.json"),
                bun_sys::O::DIRECTORY,
                0,
            )
            .unwrap()
            {
                Ok(fd) => fd,
                Err(e) => {
                    Output::err(e, format_args!("failed to open workspace directory"));
                    Global::crash();
                }
            };
            let _close = scopeguard::guard(workspace_root, |fd| fd.close());

            Self::normalize_bin(
                json,
                package_name,
                workspace_root,
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
                if e == err!(OutOfMemory) {
                    return Err(AllocError);
                }
                Output::err_generic(format_args!(
                    "failed to print normalized package.json: {}",
                    e.name(),
                ));
                Global::crash();
            }
        };
        let _ = written;

        Ok(writer.ctx.written_without_trailing_zero())
    }

    fn normalize_bin(
        json: &mut Expr,
        package_name: &[u8],
        workspace_root: Fd,
    ) -> Result<(), AllocError> {
        let mut path_buf = PathBuffer::uninit();
        if let Some(bin_query) = json.as_property(b"bin") {
            match &bin_query.expr.data {
                Expr::Data::EString(bin_str) => {
                    let mut bin_props: Vec<G::Property> = Vec::new();
                    let normalized = strings::without_prefix_z(
                        path::normalize_buf_z(
                            &bin_str.string()?,
                            &mut path_buf,
                            path::Platform::Posix,
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
                            E::String { data: package_name.into() },
                            logger::Loc::EMPTY,
                        )),
                        value: Some(Expr::init(
                            E::String { data: Box::<[u8]>::from(normalized.as_bytes()) },
                            logger::Loc::EMPTY,
                        )),
                        ..Default::default()
                    });

                    // TODO(port): direct mutation of e_object.properties.ptr[i] — borrowck reshape may be needed
                    json.data.as_e_object_mut().properties.ptr[bin_query.i].value = Some(Expr::init(
                        E::Object {
                            properties: G::Property::List::move_from_list(&mut bin_props),
                            ..Default::default()
                        },
                        logger::Loc::EMPTY,
                    ));
                }
                Expr::Data::EObject(bin_obj) => {
                    let mut bin_props: Vec<G::Property> = Vec::new();
                    for bin_prop in bin_obj.properties.slice() {
                        let key = 'key: {
                            if let Some(key) = &bin_prop.key {
                                if key.is_string() && key.data.as_e_string().len() != 0 {
                                    break 'key Some(ZStr::from_bytes(
                                        strings::without_prefix(
                                            path::normalize_buf(
                                                &key.data.as_e_string().string()?,
                                                &mut path_buf,
                                                path::Platform::Posix,
                                            ),
                                            b"./",
                                        ),
                                    ));
                                }
                            }
                            None
                        };
                        let Some(key) = key else { continue };

                        if key.is_empty() {
                            continue;
                        }

                        let value = 'value: {
                            if let Some(value) = &bin_prop.value {
                                if value.is_string() && value.data.as_e_string().len() != 0 {
                                    break 'value Some(ZStr::from_bytes(
                                        strings::without_prefix_z(
                                            // replace separators
                                            path::normalize_buf_z(
                                                &value.data.as_e_string().string()?,
                                                &mut path_buf,
                                                path::Platform::Posix,
                                            ),
                                            b"./",
                                        )
                                        .as_bytes(),
                                    ));
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
                                E::String { data: key.into_bytes() },
                                logger::Loc::EMPTY,
                            )),
                            value: Some(Expr::init(
                                E::String { data: value.into_bytes() },
                                logger::Loc::EMPTY,
                            )),
                            ..Default::default()
                        });
                    }

                    // TODO(port): direct mutation of e_object.properties.ptr[i] — borrowck reshape may be needed
                    json.data.as_e_object_mut().properties.ptr[bin_query.i].value = Some(Expr::init(
                        E::Object {
                            properties: G::Property::List::move_from_list(&mut bin_props),
                            ..Default::default()
                        },
                        logger::Loc::EMPTY,
                    ));
                }
                _ => {}
            }
        } else if let Some(directories_query) = json.as_property(b"directories") {
            if let Some(bin_query) = directories_query.expr.as_property(b"bin") {
                let Some(bin_dir_str) = bin_query.expr.as_string() else {
                    return Ok(());
                };
                let mut bin_props: Vec<G::Property> = Vec::new();
                let normalized_bin_dir = ZStr::from_bytes(
                    strings::without_trailing_slash(
                        strings::without_prefix(
                            path::normalize_buf(
                                &bin_dir_str,
                                &mut path_buf,
                                path::Platform::Posix,
                            ),
                            b"./",
                        ),
                    ),
                );

                if normalized_bin_dir.is_empty() {
                    return Ok(());
                }

                let bin_dir = match bun_sys::openat(workspace_root, &normalized_bin_dir, bun_sys::O::DIRECTORY, 0).unwrap() {
                    Ok(fd) => fd,
                    Err(e) => {
                        if e == err!(ENOENT) {
                            Output::warn(format_args!(
                                "bin directory '{}' does not exist",
                                bstr::BStr::new(normalized_bin_dir.as_bytes()),
                            ));
                            return Ok(());
                        } else {
                            Output::err(e, format_args!(
                                "failed to open bin directory: '{}'",
                                bstr::BStr::new(normalized_bin_dir.as_bytes()),
                            ));
                            Global::crash();
                        }
                    }
                };

                // TODO(port): Zig used std.fs.Dir here for openDirZ — using bun_sys::Fd instead
                let mut dirs: Vec<(Fd, Box<[u8]>, bool)> = Vec::new();

                dirs.push((bin_dir, normalized_bin_dir.into_bytes(), false));

                while let Some(dir_info) = dirs.pop() {
                    let (dir, dir_subpath, close_dir) = dir_info;
                    let _close = scopeguard::guard(dir, move |d| {
                        if close_dir {
                            d.close();
                        }
                    });

                    let mut iter = DirIterator::iterate(dir, DirIterator::Encoding::U8);
                    while let Some(entry) = iter.next().unwrap().ok().flatten() {
                        let (name, subpath) = 'name_and_subpath: {
                            let name = entry.name.slice();
                            let mut join: Vec<u8> = Vec::new();
                            write!(
                                &mut join,
                                "{}{}{}",
                                bstr::BStr::new(&dir_subpath),
                                // only using posix separators
                                if dir_subpath.is_empty() { "" } else { "/" },
                                bstr::BStr::new(strings::without_trailing_slash(name)),
                            )?;
                            join.push(0);
                            let join_len = join.len() - 1;
                            // SAFETY: NUL terminator written at join[join_len]
                            let join_z = unsafe { ZStr::from_raw(join.as_ptr(), join_len) };
                            // PORT NOTE: reshaped for borrowck — Zig sliced into the same allocation for both name and subpath
                            let name_slice_start = join_len - name.len();
                            // SAFETY: name is the trailing segment of join, NUL-terminated
                            let name_z = unsafe { ZStr::from_raw(join.as_ptr().add(name_slice_start), name.len()) };
                            // TODO(port): lifetime — `join` backing storage must outlive both name_z and subpath usage
                            core::mem::forget(join);
                            break 'name_and_subpath (name_z, join_z);
                        };

                        if name.is_empty()
                            || (name.len() == 1 && name.as_bytes()[0] == b'.')
                            || (name.len() == 2 && name.as_bytes()[0] == b'.' && name.as_bytes()[1] == b'.')
                        {
                            continue;
                        }

                        bin_props.push(G::Property {
                            key: Some(Expr::init(
                                E::String { data: bun_paths::basename_posix(subpath.as_bytes()).into() },
                                logger::Loc::EMPTY,
                            )),
                            value: Some(Expr::init(
                                E::String { data: subpath.as_bytes().into() },
                                logger::Loc::EMPTY,
                            )),
                            ..Default::default()
                        });

                        if entry.kind == DirIterator::EntryKind::Directory {
                            // TODO(port): Zig used dir.openDirZ — substituting bun_sys::openat
                            let Ok(subdir) = bun_sys::openat(dir, &name, bun_sys::O::DIRECTORY, 0).unwrap() else {
                                continue;
                            };
                            dirs.push((subdir, subpath.as_bytes().into(), true));
                        }
                    }
                }

                json.set(b"bin", Expr::init(
                    E::Object {
                        properties: G::Property::List::move_from_list(&mut bin_props),
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                ))?;
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
        auth_type: Option<install::package_manager::Options::AuthType>,
    ) -> Result<http::HeaderBuilder, AllocError> {
        let mut headers = http::HeaderBuilder::default();
        let npm_auth_type: &[u8] = if maybe_otp.is_none() {
            if let Some(auth) = auth_type {
                <&'static str>::from(auth).as_bytes()
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
                write!(print_buf, "Bearer {}", bstr::BStr::new(&registry.token))?;
                headers.count(b"authorization", print_buf);
                print_buf.clear();
            } else if !registry.auth.is_empty() {
                write!(print_buf, "Basic {}", bstr::BStr::new(&registry.auth))?;
                headers.count(b"authorization", print_buf);
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
                Global::USER_AGENT,
                Global::OS_NAME,
                Global::ARCH_NAME,
                uses_workspaces,
                if ci_name.is_some() { " ci/" } else { "" },
                ci_name.unwrap_or(""),
            )?;
            // headers.count("user-agent", "npm/10.8.3 node/v24.3.0 darwin arm64 workspaces/false");
            headers.count(b"user-agent", print_buf);
            print_buf.clear();

            headers.count(b"Connection", b"keep-alive");
            headers.count(b"Host", &registry.url.host);

            if let Some(json_len) = maybe_json_len {
                write!(print_buf, "{}", json_len)?;
                headers.count(b"Content-Length", print_buf);
                print_buf.clear();
            }
        }

        headers.allocate()?;

        {
            headers.append(b"accept", b"*/*");
            headers.append(b"accept-encoding", b"gzip,deflate");

            if !registry.token.is_empty() {
                write!(print_buf, "Bearer {}", bstr::BStr::new(&registry.token))?;
                headers.append(b"authorization", print_buf);
                print_buf.clear();
            } else if !registry.auth.is_empty() {
                write!(print_buf, "Basic {}", bstr::BStr::new(&registry.auth))?;
                headers.append(b"authorization", print_buf);
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
                Global::USER_AGENT,
                Global::OS_NAME,
                Global::ARCH_NAME,
                uses_workspaces,
                if ci_name.is_some() { " ci/" } else { "" },
                ci_name.unwrap_or(""),
            )?;
            // headers.append("user-agent", "npm/10.8.3 node/v24.3.0 darwin arm64 workspaces/false");
            headers.append(b"user-agent", print_buf);
            print_buf.clear();

            headers.append(b"Connection", b"keep-alive");
            headers.append(b"Host", &registry.url.host);

            if let Some(json_len) = maybe_json_len {
                write!(print_buf, "{}", json_len)?;
                headers.append(b"Content-Length", print_buf);
                print_buf.clear();
            }
        }

        Ok(headers)
    }

    fn construct_publish_request_body<const DIRECTORY_PUBLISH: bool>(
        ctx: &Context<'_, DIRECTORY_PUBLISH>,
    ) -> Result<Box<[u8]>, AllocError> {
        let tag: &[u8] = if !ctx.manager.options.publish_config.tag.is_empty() {
            &ctx.manager.options.publish_config.tag
        } else {
            b"latest"
        };

        let encoded_tarball_len = bun_base64::standard_encoder_calc_size(ctx.tarball_bytes.len());
        let version_without_build_tag = Dependency::without_build_tag(&ctx.package_version);

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
        )?;

        write!(
            &mut buf,
            ",\"dist-tags\":{{\"{}\":\"{}\"}}",
            bstr::BStr::new(tag),
            bstr::BStr::new(version_without_build_tag),
        )?;

        // "versions"
        {
            write!(
                &mut buf,
                ",\"versions\":{{\"{}\":{}}}",
                bstr::BStr::new(version_without_build_tag),
                bstr::BStr::new(&ctx.normalized_pkg_info),
            )?;
        }

        if let Some(access) = ctx.manager.options.publish_config.access {
            write!(&mut buf, ",\"access\":\"{}\"", <&'static str>::from(access))?;
        } else {
            buf.extend_from_slice(b",\"access\":null");
        }

        // "_attachments"
        {
            write!(
                &mut buf,
                ",\"_attachments\":{{\"{}\":{{\"content_type\":\"{}\",\"data\":\"",
                Pack::fmt_tarball_filename(&ctx.package_name, &ctx.package_version, pack::TarballFilenameStyle::Raw),
                "application/octet-stream",
            )?;

            buf.reserve(encoded_tarball_len);
            let old_len = buf.len();
            // SAFETY: reserved encoded_tarball_len bytes above; simdutf base64 encode writes exactly that many bytes
            unsafe {
                buf.set_len(old_len + encoded_tarball_len);
            }
            let count = simdutf::base64::encode(
                &ctx.tarball_bytes,
                &mut buf[old_len..old_len + encoded_tarball_len],
                false,
            );
            debug_assert!(count == encoded_tarball_len);

            write!(
                &mut buf,
                "\",\"length\":{}}}}}}}",
                ctx.tarball_bytes.len(),
            )?;
        }

        Ok(buf.into_boxed_slice())
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum PublishError {
    OutOfMemory,
    NeedAuth,
}
impl From<AllocError> for PublishError {
    fn from(_: AllocError) -> Self {
        PublishError::OutOfMemory
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum GetOTPError {
    OutOfMemory,
}
impl From<AllocError> for GetOTPError {
    fn from(_: AllocError) -> Self {
        GetOTPError::OutOfMemory
    }
}
impl From<GetOTPError> for PublishError {
    fn from(_: GetOTPError) -> Self {
        PublishError::OutOfMemory
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/publish_command.zig (1468 lines)
//   confidence: medium
//   todos:      13
//   notes:      Context<const bool> cannot vary field types (script_env/publish_script kept as Option); std.process.Child/std.Thread/std.fs.Dir need bun_* substitutes; Expr/E.String construction shapes guessed; allocPrintSentinel reshaped for borrowck
// ──────────────────────────────────────────────────────────────────────────
