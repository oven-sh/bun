//! `bun login` (npm web login, token saved to the user `.npmrc`) and `bun logout` (revoke and remove it).

use std::time::{Duration, Instant};

use bun_core::{Global, MutableString, Output, ZStr, fmt as bun_fmt, strings};
use bun_install::Npm;
use bun_install::npmrc::{self, Npmrc};
use bun_install::package_manager_real::{CommandLineArguments, PackageManager, Subcommand};
use bun_paths::{PathBuffer, path_buffer_pool};
use bun_url::URL;

use crate::Command;
use crate::cli::web_login::{self, WebLoginError, WebLoginStart};

/// How long `bun login` waits for the browser login to finish.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// `--registry` wins over `--scope`; `--scope` picks that scope's configured registry.
fn select_registry<'a>(
    manager: &'a PackageManager,
    explicit_registry: bool,
    scope: &[u8],
) -> &'a Npm::Registry::Scope {
    if !explicit_registry && !scope.is_empty() {
        return manager.options.scope_for_package_name(scope);
    }
    &manager.options.scope
}

fn user_npmrc_path_or_exit(buf: &mut PathBuffer) -> &ZStr {
    match npmrc::user_npmrc_path(buf) {
        Some(path) => path,
        None => {
            Output::err_generic(
                "could not find the user-level .npmrc: neither $XDG_CONFIG_HOME nor $HOME is set",
                (),
            );
            Global::exit(1);
        }
    }
}

fn load_npmrc_or_exit(path: &ZStr) -> Npmrc {
    match Npmrc::load(path) {
        Ok(rc) => rc,
        Err(err) => {
            Output::err(
                err,
                "failed to read {s}",
                (bstr::BStr::new(path.as_bytes()),),
            );
            Global::exit(1);
        }
    }
}

fn save_npmrc_or_exit(rc: &Npmrc, path: &ZStr) {
    if let Err(err) = rc.save(path) {
        Output::err(
            err,
            "failed to write {s}",
            (bstr::BStr::new(path.as_bytes()),),
        );
        Global::exit(1);
    }
}

fn os_hostname() -> Vec<u8> {
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        if bun_sys::posix::gethostname(&mut buf[..]).is_ok() {
            return bun_core::slice_to_nul(&buf[..]).to_vec();
        }
    }
    #[cfg(windows)]
    {
        let mut wide = [0u16; 256];
        // SAFETY: idempotent Winsock init (libuv defers it to first use).
        unsafe { bun_sys::windows::libuv::uv__winsock_ensure() };
        // SAFETY: `wide` holds 256 u16; the call writes at most 255 plus the NUL.
        if unsafe { bun_sys::windows::GetHostNameW(wide.as_mut_ptr(), 255) } == 0 {
            let len = wide.iter().take_while(|&&c| c != 0).count();
            return strings::to_utf8_alloc_with_type(&wide[..len]);
        }
    }
    b"unknown".to_vec()
}

/// Same grammar as the `.npmrc` reader: `${VAR}` (kept literal when unset) and `${VAR?}` (empty when unset).
fn expand_env_vars(value: &[u8], env: &bun_dotenv::Loader) -> Vec<u8> {
    let mut out = Vec::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = strings::index_of(rest, b"${") {
        out.extend_from_slice(&rest[..start]);
        rest = &rest[start..];
        let Some(end) = strings::index_of_char_usize(rest, b'}') else {
            break;
        };
        let raw_name = &rest[2..end];
        let optional = strings::ends_with_char(raw_name, b'?');
        let name = if optional {
            &raw_name[..raw_name.len() - 1]
        } else {
            raw_name
        };
        match env.get(name) {
            Some(expanded) => out.extend_from_slice(expanded),
            None if optional => {}
            None => out.extend_from_slice(&rest[..=end]),
        }
        rest = &rest[end + 1..];
    }
    out.extend_from_slice(rest);
    out
}

fn is_loopback_host(hostname: &[u8]) -> bool {
    strings::eql_comptime(hostname, b"localhost")
        || strings::eql_comptime(hostname, b"127.0.0.1")
        || strings::eql_comptime(hostname, b"[::1]")
        || strings::eql_comptime(hostname, b"::1")
}

/// Exit on a non-http(s) registry; warn before a token crosses plain http to a remote host.
fn check_transport(registry: &Npm::Registry::Scope) {
    let url = registry.url.url();
    if !(url.is_http() || url.is_https()) {
        Output::err_generic(
            "registry URL must start with http:// or https://: {}",
            (bun_fmt::redacted_npm_url(registry.url.href()),),
        );
        Global::exit(1);
    }
    if url.is_http() && !is_loopback_host(url.hostname) {
        bun_core::warn!(
            "{} uses plain http. The token will travel unencrypted.",
            bun_fmt::redacted_npm_url(registry.url.href()),
        );
    }
}

fn print_command_name(manager: &PackageManager, name: &str) {
    if manager.options.should_print_command_name() {
        bun_core::prettyln!(
            "<r><b>bun {} <r><d>v{}<r>\n",
            name,
            Global::package_json_version_with_sha,
        );
        Output::flush();
    }
}

pub(crate) struct LoginCommand;

impl LoginCommand {
    pub(crate) fn exec(ctx: Command::Context) -> crate::Result<()> {
        let cli = CommandLineArguments::parse(Subcommand::Login)?;

        // positionals[0] is "login" itself
        if cli.positionals.len() > 1 {
            Output::err_generic("bun login does not take arguments", ());
            bun_core::note!("run 'bun login --help' for more information");
            Global::exit(1);
        }

        let explicit_registry = !cli.registry.is_empty();
        let scope = cli.scope;
        let (manager, _cwd) = PackageManager::init(&mut *ctx, cli, Subcommand::Login)?;
        print_command_name(manager, "login");

        let registry = select_registry(manager, explicit_registry, scope);
        let registry_href: &[u8] = registry.url.href();
        check_transport(registry);

        bun_core::prettyln!(
            "Logging in to <b>{}<r>",
            bun_fmt::redacted_npm_url(registry_href)
        );
        Output::flush();

        let mut response_buf =
            MutableString::init(1024).unwrap_or_else(|_| bun_core::out_of_memory());

        let hostname = os_hostname();

        let (login_url, done_url) = match web_login::request_web_login(
            registry,
            &hostname,
            &mut response_buf,
        ) {
            Ok(WebLoginStart::Challenge {
                login_url,
                done_url,
            }) => (login_url, done_url),
            Ok(WebLoginStart::Unsupported { status }) => {
                Output::err_generic(
                    "{} did not offer a web login (HTTP {} from /-/v1/login)",
                    (bun_fmt::redacted_npm_url(registry_href), status),
                );
                let mut path_buf = path_buffer_pool::get();
                let path = user_npmrc_path_or_exit(&mut path_buf);
                bun_core::note!(
                    "create a token on the registry's website and add it to {} as:\n  {}=\\<token\\>",
                    bstr::BStr::new(path.as_bytes()),
                    bstr::BStr::new(&npmrc::auth_token_key(registry_href)),
                );
                Global::exit(1);
            }
            Err(_) => bun_core::out_of_memory(),
        };

        web_login::print_auth_url(login_url);

        let headers = web_login::registry_headers(registry, b"login", None, false)
            .unwrap_or_else(|_| bun_core::out_of_memory());

        let token = match web_login::poll_done_url(
            &URL::parse(&done_url),
            &headers,
            &mut response_buf,
            Some(Instant::now() + LOGIN_TIMEOUT),
            None,
        ) {
            Ok(token) => token,
            Err(WebLoginError::OutOfMemory) => bun_core::out_of_memory(),
            Err(WebLoginError::TimedOut) => {
                Output::err_generic(
                    "timed out after {} minutes waiting for the login to complete",
                    (LOGIN_TIMEOUT.as_secs() / 60,),
                );
                Global::exit(1);
            }
        };

        if token.is_empty() || token.iter().any(|b| b.is_ascii_control()) {
            Output::err_generic("the registry returned an invalid token", ());
            Global::exit(1);
        }

        let mut path_buf = path_buffer_pool::get();
        let path = user_npmrc_path_or_exit(&mut path_buf);
        let mut rc = load_npmrc_or_exit(path);
        rc.set(&npmrc::auth_token_key(registry_href), &token);
        if !scope.is_empty() {
            rc.set(&npmrc::scope_registry_key(scope), registry_href);
        }
        save_npmrc_or_exit(&rc, path);

        bun_core::prettyln!(
            "\n<green>Saved the token to<r> <b>{}<r>",
            bstr::BStr::new(path.as_bytes())
        );
        Output::flush();

        let username = web_login::whoami_best_effort(registry, &token, &mut response_buf)
            .unwrap_or_else(|_| bun_core::out_of_memory());
        match username {
            Some(username) => bun_core::prettyln!(
                "Logged in as <b>{}<r> on <b>{}<r>",
                bstr::BStr::new(&username),
                bun_fmt::redacted_npm_url(registry_href),
            ),
            None => bun_core::prettyln!(
                "Logged in on <b>{}<r>",
                bun_fmt::redacted_npm_url(registry_href)
            ),
        }
        Output::flush();
        Ok(())
    }
}

pub(crate) struct LogoutCommand;

impl LogoutCommand {
    pub(crate) fn exec(ctx: Command::Context) -> crate::Result<()> {
        let cli = CommandLineArguments::parse(Subcommand::Logout)?;

        // positionals[0] is "logout" itself
        if cli.positionals.len() > 1 {
            Output::err_generic("bun logout does not take arguments", ());
            bun_core::note!("run 'bun logout --help' for more information");
            Global::exit(1);
        }

        let explicit_registry = !cli.registry.is_empty();
        let scope = cli.scope;
        let (manager, _cwd) = PackageManager::init(&mut *ctx, cli, Subcommand::Logout)?;
        print_command_name(manager, "logout");

        let registry = select_registry(manager, explicit_registry, scope);
        let registry_href: &[u8] = registry.url.href();
        check_transport(registry);

        let mut path_buf = path_buffer_pool::get();
        let path = user_npmrc_path_or_exit(&mut path_buf);
        let mut rc = load_npmrc_or_exit(path);

        let token_key = npmrc::auth_token_key(registry_href);
        let Some(raw_token) = rc.get(&token_key) else {
            Output::err_generic(
                "not logged in to {}",
                (bun_fmt::redacted_npm_url(registry_href),),
            );
            bun_core::note!(
                "{} has no `{}` line",
                bstr::BStr::new(path.as_bytes()),
                bstr::BStr::new(&token_key),
            );
            if !registry.token.is_empty() || !registry.auth.is_empty() {
                bun_core::note!(
                    "the credentials for this registry come from bunfig.toml, a project .npmrc, or an environment variable. Remove them there."
                );
            }
            Global::exit(1);
        };

        let expand = |value: &[u8]| match manager.env.as_deref() {
            Some(env) => expand_env_vars(value, env),
            None => value.to_vec(),
        };
        let token = expand(&raw_token);
        if token.is_empty() {
            Output::err_generic(
                "the token for {} is `{}`, which expands to an empty string",
                (
                    bun_fmt::redacted_npm_url(registry_href),
                    bstr::BStr::new(&raw_token),
                ),
            );
            Global::exit(1);
        }

        let mut response_buf =
            MutableString::init(1024).unwrap_or_else(|_| bun_core::out_of_memory());
        let status = web_login::revoke_token(registry, &token, &mut response_buf)
            .unwrap_or_else(|_| bun_core::out_of_memory());

        match status {
            200..=299 => {}
            // the saved line is dead either way
            401 | 404 => {
                bun_core::note!(
                    "{} reports the token is already invalid (HTTP {})",
                    bun_fmt::redacted_npm_url(registry_href),
                    status,
                );
            }
            _ => {
                Output::err_generic(
                    "failed to revoke the token on {} (HTTP {}). {} was left unchanged.",
                    (
                        bun_fmt::redacted_npm_url(registry_href),
                        status,
                        bstr::BStr::new(path.as_bytes()),
                    ),
                );
                Global::exit(1);
            }
        }

        rc.remove(&token_key);
        if !scope.is_empty() {
            let scope_key = npmrc::scope_registry_key(scope);
            let points_here = rc.get(&scope_key).is_some_and(|url| {
                strings::without_trailing_slash(&expand(&url))
                    == strings::without_trailing_slash(registry_href)
            });
            if points_here {
                rc.remove(&scope_key);
            }
        }
        save_npmrc_or_exit(&rc, path);

        bun_core::prettyln!(
            "Logged out of <b>{}<r>. Removed the token from <b>{}<r>",
            bun_fmt::redacted_npm_url(registry_href),
            bstr::BStr::new(path.as_bytes()),
        );
        Output::flush();
        Ok(())
    }
}
