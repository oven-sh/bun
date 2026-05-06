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
use bun_resolver::fs::FileSystem;
use bun_dotenv as dotenv;
use bun_sha_hmac as sha;
use bun_interchange::json as json_mod;
use bun_url::URL;
use bun_string::MutableString;
use bun_js_parser::{Expr, E, G};
use crate::cli::ci_info as ci;
use bun_simdutf_sys::simdutf as simdutf;
use bun_sys::dir_iterator as DirIterator;
use bun_paths::resolve_path::{join_abs_string_buf_z, normalize_buf, normalize_buf_z};
// `bun_install::package_manager_real` is `#![cfg(any())]`-gated (reconciler-6); pull
// `LogLevel`/`AuthType` from the stub surface in `bun_install` and re-declare `Access`
// locally (no stub upstream — see PackageManagerOptions.zig `Access`).
use bun_install::{AuthType, LogLevel};
use bun_install::dependency;
use bun_sys::FdExt as _;
use bun_js_parser::ast::expr::Data as ExprData;

// ── Upstream-stub shims ────────────────────────────────────────────────────
// `PublishConfigStub` / `PackageManagerOptionsStub` in `bun_install` are
// minimal placeholders (real bodies gated behind `package_manager_real`,
// reconciler-6). Shim the missing field surface as trait getters so call
// sites compile; bodies `todo!()` until the upstream stubs are widened.
trait PublishConfigShim {
    fn tag(&self) -> &[u8];
    fn access(&self) -> Option<Access>;
    fn otp(&self) -> &[u8];
    fn tolerate_republish(&self) -> bool;
}
impl PublishConfigShim for install::PublishConfigStub {
    fn tag(&self) -> &[u8] { todo!("blocked_on: bun_install::PublishConfigStub::tag") }
    fn access(&self) -> Option<Access> { todo!("blocked_on: bun_install::PublishConfigStub::access") }
    fn otp(&self) -> &[u8] { todo!("blocked_on: bun_install::PublishConfigStub::otp") }
    fn tolerate_republish(&self) -> bool { todo!("blocked_on: bun_install::PublishConfigStub::tolerate_republish") }
}
trait PackageManagerOptionsShim {
    fn dry_run(&self) -> bool;
}
impl PackageManagerOptionsShim for install::PackageManagerOptionsStub {
    fn dry_run(&self) -> bool { todo!("blocked_on: bun_install::PackageManagerOptionsStub::dry_run") }
}
trait PackageManagerShim {
    fn log_mut(&mut self) -> &mut logger::Log;
    fn original_package_json_path(&self) -> &[u8];
}
impl PackageManagerShim for PackageManager {
    fn log_mut(&mut self) -> &mut logger::Log { todo!("blocked_on: bun_install::PackageManager::log") }
    fn original_package_json_path(&self) -> &[u8] { todo!("blocked_on: bun_install::PackageManager::original_package_json_path") }
}

// Local hex-lower Display shim — `bun_fmt::bytes_to_hex_lower` writes into a
// caller buf; the Zig spec used it as a formatter (`{x}`).
struct HexLower<'a>(&'a [u8]);
impl core::fmt::Display for HexLower<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        for b in self.0 {
            write!(f, "{:02x}", b)?;
        }
        Ok(())
    }
}
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Access {
    Public,
    Restricted,
}
impl Access {
    pub fn from_str(str: &[u8]) -> Option<Access> {
        match str {
            b"public" => Some(Access::Public),
            b"restricted" => Some(Access::Restricted),
            _ => None,
        }
    }
}
impl From<Access> for &'static str {
    fn from(a: Access) -> &'static str {
        match a { Access::Public => "public", Access::Restricted => "restricted" }
    }
}

use crate::Command;
use crate::cli::pack_command::{self as pack, PackCommand as Pack};
use crate::run_command::RunCommand as Run;
use crate::cli::init_command::InitCommand;
use crate::cli::open;

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
impl From<AllocError> for FromTarballError {
    fn from(_: AllocError) -> Self {
        FromTarballError::OutOfMemory
    }
}

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
                Output::err(e, "failed to read tarball: '{}'", (bstr::BStr::new(tarball_path),));
                Global::crash();
            }
        };

        // TODO(port): Archive::Iterator / EntryKind / read_entry_data are not
        // exposed by `bun_libarchive::lib` yet — the Zig `Archive.Iterator`
        // wrapper has no Rust port. The package.json-extraction loop below
        // (publish_command.zig:fromTarballPath) is gated until that surface
        // lands.
        let _ = (&ctx, &tarball_bytes, manager);
        todo!("blocked_on: bun_libarchive::lib::Archive::Iterator + bun_install::PackageManager::log/publish_config (reconciler-6)")
    }

    /// `bun publish` without a tarball path. Automatically pack the current workspace and get
    /// information required for publishing
    pub fn from_workspace(
        ctx: Command::Context<'a>,
        manager: &'a mut PackageManager,
    ) -> Result<Context<'a, DIRECTORY_PUBLISH>, FromWorkspaceError> {
        // TODO(port): `Lockfile::load_from_cwd` / `LoadResult` variants /
        // `PackageManager::{log, original_package_json_path}` are unit-stubs
        // in `bun_install` (gated behind `package_manager_real`, reconciler-6).
        // The Zig body builds a `pack::Context` from the lockfile load result
        // and calls `pack::pack::<true>`; gated until upstream stubs widen.
        let _ = (ctx, manager);
        todo!("blocked_on: bun_install::Lockfile::load_from_cwd + bun_install::lockfile::LoadResult variants (reconciler-6)")
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

        // TODO(port): `PackageManager::CommandLineArguments::parse`,
        // `PackageManager::init`, `Subcommand::Publish`, and the
        // `log` / `original_package_json_path` / `options.do_` /
        // `options.dry_run` fields are all unit-stubs in `bun_install`
        // (gated behind `package_manager_real`, reconciler-6). The Zig
        // body parses CLI args, initialises the package manager, then
        // dispatches to `from_tarball_path` / `from_workspace` and
        // `publish`; gated until upstream stubs widen.
        let _ = ctx;
        todo!("blocked_on: bun_install::PackageManager::{{init,CommandLineArguments,Subcommand::Publish,log,original_package_json_path,options.do_,options.dry_run}} (reconciler-6)")
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

        // PORT NOTE: `URL::parse` borrows; leak so the URL outlives the local Vec
        // (mirrors `allocPrint` ownership in the Zig spec).
        let package_url = URL::parse(Box::leak(url_buf.into_boxed_slice()));

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
            unsafe { core::slice::from_raw_parts(headers.content.ptr.unwrap().as_ptr(), headers.content.len) },
            &mut response_buf,
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
        let source = logger::Source::init_path_string(b"???", response_buf.list.as_slice());
        let mut log = logger::Log::init();
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

        if registry.token.is_empty() && (registry.url.password.is_empty() || registry.url.username.is_empty()) {
            return Err(PublishError::NeedAuth);
        }

        let tolerate_republish = ctx.manager.options.publish_config.tolerate_republish();
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
            bstr::BStr::new(if !ctx.manager.options.publish_config.tag().is_empty() {
                ctx.manager.options.publish_config.tag()
            } else {
                b"latest"
            }),
            if let Some(access) = ctx.manager.options.publish_config.access() {
                <&'static str>::from(access)
            } else {
                "default"
            },
            bstr::BStr::new(registry.url.href),
        ));

        // dry-run stops here
        if ctx.manager.options.dry_run() {
            return Ok(());
        }

        let publish_req_body = Self::construct_publish_request_body::<DIRECTORY_PUBLISH>(ctx)?;

        let mut print_buf: Vec<u8> = Vec::new();

        let publish_headers = Self::construct_publish_headers(
            &mut print_buf,
            registry,
            Some(publish_req_body.len()),
            if !ctx.manager.options.publish_config.otp().is_empty() {
                Some(ctx.manager.options.publish_config.otp())
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
            bstr::BStr::new(strings::without_trailing_slash(registry.url.href)),
            bun_fmt::dependency_url(&ctx.package_name),
        ).map_err(|_| AllocError)?;
        // PORT NOTE: `URL::parse` borrows; clone-and-leak so the URL outlives
        // `print_buf.clear()` below (Zig's allocPrint owned its buffer).
        let publish_url = URL::parse(Box::leak(Box::<[u8]>::from(&print_buf[..])));
        print_buf.clear();

        let mut req = http::AsyncHTTP::init_sync(
            http::Method::PUT,
            publish_url,
            publish_headers.entries,
            // SAFETY: publish_headers.content was allocated by construct_publish_headers
            unsafe { core::slice::from_raw_parts(publish_headers.content.ptr.unwrap().as_ptr(), publish_headers.content.len) },
            &mut response_buf,
            &publish_req_body,
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
                                Output::err_generic("login is not allowed from your IP address", ());
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
                    unsafe { core::slice::from_raw_parts(otp_headers.content.ptr.unwrap().as_ptr(), otp_headers.content.len) },
                    &mut response_buf,
                    &publish_req_body,
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
            // SAFETY: `buffered_stdin()` returns a process-global `*mut`; single-threaded
            // access here mirrors Zig's `Output.buffered_stdin().reader()`.
            match unsafe { (*Output::buffered_stdin()).reader().read_byte() } {
                Ok(b'\n') => break,
                Ok(_) => continue,
                Err(_) => return,
            }
        }

        // TODO(port): Zig used std.process.Child here; bun_spawn::spawn_sync should be substituted in Phase B
        let _ = (open::OPENER, auth_url.as_bytes());
        todo!("blocked_on: bun_spawn::spawn_sync (std.process.Child) for browser open");
    }

    fn get_otp<const DIRECTORY_PUBLISH: bool>(
        ctx: &Context<'_, DIRECTORY_PUBLISH>,
        registry: &Npm::Registry::Scope,
        response_buf: &mut MutableString,
        print_buf: &mut Vec<u8>,
    ) -> Result<Box<[u8]>, GetOTPError> {
        let bump = bun_alloc::Arena::new();
        let res_source = logger::Source::init_path_string(b"???", response_buf.list.as_slice());

        let res_json = match json_mod::parse_utf8(&res_source, ctx.manager.log_mut(), &bump) {
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
                let Some(auth_url_str) = Expr::get_string_cloned_z(&json, &bump, b"authUrl")? else {
                    break 'try_web;
                };
                // PORT NOTE: bump-owned `&ZStr` — leak a heap copy so the spawned thread
                // (which outlives `bump`) can borrow it `'static`.
                let auth_url_str: &'static ZStr = {
                    let mut v = auth_url_str.as_bytes().to_vec();
                    v.push(0);
                    let len = v.len() - 1;
                    let leaked = Box::leak(v.into_boxed_slice());
                    // SAFETY: leaked is NUL-terminated; `'static` view safe for the detached thread.
                    unsafe { ZStr::from_raw(leaked.as_ptr(), len) }
                };

                // important to clone because it belongs to `response_buf`, and `response_buf` will be
                // reused with the following requests
                let Some(done_url_str) = Expr::get_string_cloned(&json, &bump, b"doneUrl")? else {
                    break 'try_web;
                };
                let done_url_str: Box<[u8]> = done_url_str.into();
                let done_url = URL::parse(Box::leak(done_url_str));

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

                let width: usize = (PADDING * 2) + auth_url_str.len();

                for _ in 0..OFFSET { Output::print(format_args!(" ")); }
                Output::print(format_args!("{}", top_left));
                for _ in 0..width { Output::print(format_args!("{}", horizontal)); }
                Output::print(format_args!("{}\n", top_right));

                for _ in 0..OFFSET { Output::print(format_args!(" ")); }
                Output::print(format_args!("{}", vertical));
                for _ in 0..PADDING { Output::print(format_args!(" ")); }
                Output::pretty(format_args!("<b>{}<r>", bstr::BStr::new(auth_url_str.as_bytes())));
                for _ in 0..PADDING { Output::print(format_args!(" ")); }
                Output::print(format_args!("{}\n", vertical));

                for _ in 0..OFFSET { Output::print(format_args!(" ")); }
                Output::print(format_args!("{}", bottom_left));
                for _ in 0..width { Output::print(format_args!("{}", horizontal)); }
                Output::print(format_args!("{}\n", bottom_right));
                Output::flush();

                // on another thread because pressing enter is not required
                // TODO(port): Zig used std.Thread.spawn — bun_threading has no spawn; use std::thread::Builder
                match std::thread::Builder::new().spawn(move || Self::press_enter_to_open_in_browser(auth_url_str)) {
                    Ok(_t) => { /* JoinHandle dropped → detached */ }
                    Err(_e) => {
                        Output::err("ThreadSpawn", "failed to spawn thread for opening auth url", ());
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
                        unsafe { core::slice::from_raw_parts(auth_headers.content.ptr.unwrap().as_ptr(), auth_headers.content.len) },
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
                                        let trimmed = strings::trim(retry, &strings::WHITESPACE_CHARS);
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

                            std::thread::sleep(std::time::Duration::from_nanos(nanoseconds));
                            continue;
                        }
                        200 => {
                            // login successful
                            let done_bump = bun_alloc::Arena::new();
                            let otp_done_source = logger::Source::init_path_string(b"???", response_buf.list.as_slice());
                            let otp_done_json = match json_mod::parse_utf8(&otp_done_source, ctx.manager.log_mut(), &done_bump) {
                                Ok(j) => j,
                                Err(e) => {
                                    if e == err!(OutOfMemory) {
                                        return Err(GetOTPError::OutOfMemory);
                                    }
                                    Output::err("WebLogin", "failed to parse response json", ());
                                    Global::crash();
                                }
                            };

                            let token = Expr::get_string_cloned(&otp_done_json, &done_bump, b"token")?.unwrap_or_else(|| {
                                Output::err("WebLogin", "missing `token` field in reponse json", ());
                                Global::crash();
                            });

                            // https://github.com/npm/cli/blob/534ad7789e5c61f579f44d782bdd18ea3ff1ee20/node_modules/npm-registry-fetch/lib/check-response.js#L14
                            // ignore if x-local-cache exists
                            if let Some(notice) = res.headers.get_if_other_is_absent(b"npm-notice", b"x-local-cache") {
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
        match InitCommand::prompt("\nThis operation requires a one-time password.\nEnter OTP: ", b"") {
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
        json_source: &logger::Source,
        shasum: SHA1Digest,
        integrity: SHA512Digest,
    ) -> Result<Box<[u8]>, AllocError> {
        debug_assert!(json.is_object());

        let bump = bun_alloc::Arena::new();
        // PORT NOTE: `E::String` stores `&'static [u8]` (Phase-A erasure); leak the
        // formatted buffers so they outlive the AST nodes through printing.
        macro_rules! leak {
            ($v:expr) => {
                Box::leak($v.into_boxed_slice()) as &'static [u8]
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
            write!(&mut v, "{}", HexLower(&shasum)).map_err(|_| AllocError)?;
            leak!(v)
        };

        Expr::set_string(json, &bump, b"_id", leak!({
            let mut v = Vec::new();
            write!(&mut v, "{}@{}", bstr::BStr::new(package_name), bstr::BStr::new(version_without_build_tag)).map_err(|_| AllocError)?;
            v
        }))?;
        Expr::set_string(json, &bump, b"_integrity", integrity_fmt)?;
        Expr::set_string(json, &bump, b"_nodeVersion", Environment::REPORTED_NODEJS_VERSION.as_bytes())?;
        // TODO: npm version
        Expr::set_string(json, &bump, b"_npmVersion", b"10.8.3")?;
        Expr::set_string(json, &bump, b"integrity", integrity_fmt)?;
        Expr::set_string(json, &bump, b"shasum", shasum_fmt)?;

        let mut dist_props: Vec<G::Property> = Vec::with_capacity(3);
        dist_props.push(G::Property {
            key: Some(Expr::init(E::String::init(b"integrity"), logger::Loc::EMPTY)),
            value: Some(Expr::init(E::String::init(integrity_fmt), logger::Loc::EMPTY)),
            ..Default::default()
        });
        dist_props.push(G::Property {
            key: Some(Expr::init(E::String::init(b"shasum"), logger::Loc::EMPTY)),
            value: Some(Expr::init(E::String::init(shasum_fmt), logger::Loc::EMPTY)),
            ..Default::default()
        });
        dist_props.push(G::Property {
            key: Some(Expr::init(E::String::init(b"tarball"), logger::Loc::EMPTY)),
            value: Some(Expr::init(
                E::String::init(leak!({
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
                        pack::fmt_tarball_filename(package_name, package_version, pack::TarballNameStyle::Raw),
                    ).map_err(|_| AllocError)?;
                    v
                })),
                logger::Loc::EMPTY,
            )),
            ..Default::default()
        });

        Expr::set(json, &bump, b"dist", Expr::init(
            E::Object {
                properties: G::PropertyList::move_from_list(dist_props),
                ..Default::default()
            },
            logger::Loc::EMPTY,
        ))?;

        {
            let workspace_root = match bun_sys::open_a(
                strings::without_suffix_comptime(manager.original_package_json_path(), b"package.json"),
                bun_sys::O::DIRECTORY,
                0,
            ) {
                Ok(fd) => fd,
                Err(e) => {
                    Output::err(e, "failed to open workspace directory", ());
                    Global::crash();
                }
            };
            let _close = scopeguard::guard(workspace_root, |fd| { let _ = fd.close(); });

            Self::normalize_bin(
                json,
                &bump,
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
            // TODO(port): `minify_whitespace` not yet on `PrintJsonOptions` (gated upstream).
            bun_js_printer::PrintJsonOptions {
                mangled_props: None,
                ..Default::default()
            },
        ) {
            Ok(w) => w,
            Err(e) => {
                if e == err!(OutOfMemory) {
                    return Err(AllocError);
                }
                Output::err_generic(
                    "failed to print normalized package.json: {}",
                    (e.name(),),
                );
                Global::crash();
            }
        };
        let _ = written;

        Ok(writer.ctx.written_without_trailing_zero().into())
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
                    let normalized = strings::without_prefix_comptime_z(
                        normalize_buf_z(
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
                                            normalize_buf(
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
                                        strings::without_prefix_comptime_z(
                                            // replace separators
                                            normalize_buf_z(
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
                            normalize_buf(
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

                    let mut iter = DirIterator::iterate(dir);
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

                        if entry.kind == bun_sys::EntryKind::Directory {
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
        auth_type: Option<AuthType>,
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
                write!(print_buf, "Bearer {}", bstr::BStr::new(&registry.token)).ok();
                headers.count(b"authorization", print_buf);
                print_buf.clear();
            } else if !registry.auth.is_empty() {
                write!(print_buf, "Basic {}", bstr::BStr::new(&registry.auth)).ok();
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
                Global::user_agent,
                Global::os_name,
                Global::arch_name,
                uses_workspaces,
                if ci_name.is_some() { " ci/" } else { "" },
                bstr::BStr::new(ci_name.unwrap_or(b"")),
            ).ok();
            // headers.count("user-agent", "npm/10.8.3 node/v24.3.0 darwin arm64 workspaces/false");
            headers.count(b"user-agent", print_buf);
            print_buf.clear();

            headers.count(b"Connection", b"keep-alive");
            headers.count(b"Host", &registry.url.host);

            if let Some(json_len) = maybe_json_len {
                write!(print_buf, "{}", json_len).ok();
                headers.count(b"Content-Length", print_buf);
                print_buf.clear();
            }
        }

        headers.allocate()?;

        {
            headers.append(b"accept", b"*/*");
            headers.append(b"accept-encoding", b"gzip,deflate");

            if !registry.token.is_empty() {
                write!(print_buf, "Bearer {}", bstr::BStr::new(&registry.token)).ok();
                headers.append(b"authorization", print_buf);
                print_buf.clear();
            } else if !registry.auth.is_empty() {
                write!(print_buf, "Basic {}", bstr::BStr::new(&registry.auth)).ok();
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
                Global::user_agent,
                Global::os_name,
                Global::arch_name,
                uses_workspaces,
                if ci_name.is_some() { " ci/" } else { "" },
                bstr::BStr::new(ci_name.unwrap_or(b"")),
            ).ok();
            // headers.append("user-agent", "npm/10.8.3 node/v24.3.0 darwin arm64 workspaces/false");
            headers.append(b"user-agent", print_buf);
            print_buf.clear();

            headers.append(b"Connection", b"keep-alive");
            headers.append(b"Host", &registry.url.host);

            if let Some(json_len) = maybe_json_len {
                write!(print_buf, "{}", json_len).ok();
                headers.append(b"Content-Length", print_buf);
                print_buf.clear();
            }
        }

        Ok(headers)
    }

    fn construct_publish_request_body<const DIRECTORY_PUBLISH: bool>(
        ctx: &Context<'_, DIRECTORY_PUBLISH>,
    ) -> Result<Box<[u8]>, AllocError> {
        let tag: &[u8] = if !ctx.manager.options.publish_config.tag().is_empty() {
            ctx.manager.options.publish_config.tag()
        } else {
            b"latest"
        };

        let encoded_tarball_len = bun_core::base64::standard_encoder_calc_size(ctx.tarball_bytes.len());
        let version_without_build_tag = install::dependency::without_build_tag(&ctx.package_version);

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
        ).ok();

        write!(
            &mut buf,
            ",\"dist-tags\":{{\"{}\":\"{}\"}}",
            bstr::BStr::new(tag),
            bstr::BStr::new(version_without_build_tag),
        ).ok();

        // "versions"
        {
            write!(
                &mut buf,
                ",\"versions\":{{\"{}\":{}}}",
                bstr::BStr::new(version_without_build_tag),
                bstr::BStr::new(&ctx.normalized_pkg_info),
            ).ok();
        }

        if let Some(access) = ctx.manager.options.publish_config.access() {
            write!(&mut buf, ",\"access\":\"{}\"", <&'static str>::from(access)).ok();
        } else {
            buf.extend_from_slice(b",\"access\":null");
        }

        // "_attachments"
        {
            write!(
                &mut buf,
                ",\"_attachments\":{{\"{}\":{{\"content_type\":\"{}\",\"data\":\"",
                pack::fmt_tarball_filename(&ctx.package_name, &ctx.package_version, pack::TarballNameStyle::Raw),
                "application/octet-stream",
            ).ok();

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
            ).ok();
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
impl From<AllocError> for PublishError {
    fn from(_: AllocError) -> Self {
        PublishError::OutOfMemory
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum GetOTPError {
    #[error("OutOfMemory")]
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
