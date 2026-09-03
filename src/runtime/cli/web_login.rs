//! npm's web login handshake (show URL, offer the browser, poll `doneUrl`), shared by `bun login` and `bun publish`.

use std::io::Write as _;
use std::time::{Duration, Instant};

use bun_alloc::AllocError;
use bun_core::{Global, MutableString, Output, ZStr, strings};
use bun_http as http;
use bun_install::Npm;
use bun_parsers::json as json_mod;
use bun_url::URL;

use crate::cli::ci_info as ci;
use crate::cli::open;

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub(crate) enum WebLoginError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("TimedOut")]
    TimedOut,
}
bun_core::oom_from_alloc!(WebLoginError);

#[inline]
pub(crate) fn json_get_string_cloned<'b>(
    expr: &bun_ast::Expr,
    bump: &'b bun_alloc::Arena,
    name: &[u8],
) -> Result<Option<&'b [u8]>, AllocError> {
    match expr.as_property(name) {
        Some(q) => q.expr.as_string_cloned(bump),
        None => Ok(None),
    }
}

/// NUL-terminated copy in the process-lifetime CLI arena, for the detached browser thread.
pub(crate) fn dupe_static_z(bytes: &[u8]) -> &'static ZStr {
    let len = bytes.len();
    let buf: &'static mut [u8] = crate::cli::cli_arena().alloc_slice_fill_default(len + 1);
    buf[..len].copy_from_slice(bytes);
    // SAFETY: `buf[len] == 0`; arena-backed `'static`.
    ZStr::from_buf(&buf[..], len)
}

pub(crate) fn is_web_url(url: &[u8]) -> bool {
    let url = URL::parse(url);
    url.is_http() || url.is_https()
}

fn press_enter_to_open_in_browser(auth_url: &ZStr) {
    // without this, backspace deletes the whole line on Windows
    #[cfg(windows)]
    let _stdin_mode =
        bun_sys::windows::StdinModeGuard::set(bun_sys::windows::UpdateStdioModeFlagsOpts {
            unset: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT,
            ..Default::default()
        });

    loop {
        // SAFETY: `buffered_stdin()` is process-global and this thread is its only reader.
        match unsafe { (*Output::buffered_stdin()).reader().read_byte() } {
            Ok(b'\n') => break,
            Ok(_) => continue,
            Err(_) => return,
        }
    }

    let _ = bun_core::spawn_sync_inherit(&[open::OPENER, auth_url.as_bytes()]);
}

/// Print `auth_url` in a box; for http(s) also wait for ENTER on a detached thread and open the browser.
pub(crate) fn print_auth_url(auth_url: &'static ZStr) {
    let offer_browser = is_web_url(auth_url.as_bytes());

    if offer_browser {
        bun_core::prettyln!(
            "\nAuthenticate your account at (press <b>ENTER<r> to open in browser):\n",
        );
    } else {
        bun_core::prettyln!("\nAuthenticate your account at:\n");
    }

    const PADDING: usize = 1;

    let colors = Output::enable_ansi_colors_stdout();
    let horizontal = if colors { "─" } else { "-" };
    let vertical = if colors { "│" } else { "|" };
    let top_left = if colors { "┌" } else { "|" };
    let top_right = if colors { "┐" } else { "|" };
    let bottom_left = if colors { "└" } else { "|" };
    let bottom_right = if colors { "┘" } else { "|" };

    let width: usize = (PADDING * 2) + auth_url.len();

    Output::print(format_args!("{}", top_left));
    for _ in 0..width {
        Output::print(format_args!("{}", horizontal));
    }
    Output::print(format_args!("{}\n", top_right));

    Output::print(format_args!("{}", vertical));
    for _ in 0..PADDING {
        Output::print(format_args!(" "));
    }
    bun_core::pretty!("<b>{}<r>", bstr::BStr::new(auth_url.as_bytes()));
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

    if offer_browser {
        // on another thread because pressing enter is not required
        match std::thread::Builder::new().spawn(move || press_enter_to_open_in_browser(auth_url)) {
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
}

/// The headers every registry request shares; `include_auth` adds the credentials in `registry`.
pub(crate) fn registry_headers(
    registry: &Npm::Registry::Scope,
    npm_command: &[u8],
    body_len: Option<usize>,
    include_auth: bool,
) -> Result<http::HeaderBuilder, AllocError> {
    let mut pairs: Vec<(&[u8], Vec<u8>)> = Vec::new();
    pairs.push((b"accept", b"*/*".to_vec()));
    pairs.push((b"accept-encoding", b"gzip,deflate".to_vec()));

    if include_auth {
        if !registry.token.is_empty() {
            let mut v = b"Bearer ".to_vec();
            v.extend_from_slice(&registry.token);
            pairs.push((b"authorization", v));
        } else if !registry.auth.is_empty() {
            let mut v = b"Basic ".to_vec();
            v.extend_from_slice(&registry.auth);
            pairs.push((b"authorization", v));
        }
    }

    if body_len.is_some() {
        // verdaccio rejects anything other than exactly `application/json`
        pairs.push((b"content-type", b"application/json".to_vec()));
    }

    pairs.push((b"npm-auth-type", b"web".to_vec()));
    pairs.push((b"npm-command", npm_command.to_vec()));

    let ci_name = ci::detect_ci_name();
    let mut user_agent = Vec::new();
    let _ = write!(
        user_agent,
        "{} {} {} workspaces/false{}{}",
        Global::user_agent,
        Global::os_name,
        Global::arch_name,
        if ci_name.is_some() { " ci/" } else { "" },
        bstr::BStr::new(ci_name.unwrap_or(b"")),
    );
    pairs.push((b"user-agent", user_agent));

    pairs.push((b"Connection", b"keep-alive".to_vec()));

    if let Some(len) = body_len {
        pairs.push((b"Content-Length", len.to_string().into_bytes()));
    }

    let mut headers = http::HeaderBuilder::default();
    for (name, value) in &pairs {
        headers.count(name, value);
    }
    headers.allocate()?;
    for (name, value) in &pairs {
        headers.append(name, value);
    }
    Ok(headers)
}

/// `<registry>/-/<path>`
pub(crate) fn registry_endpoint(registry: &Npm::Registry::Scope, path: &str) -> Vec<u8> {
    let mut url = Vec::new();
    let _ = write!(
        url,
        "{}/-/{}",
        bstr::BStr::new(strings::without_trailing_slash(registry.url.href())),
        path,
    );
    url
}

pub(crate) enum WebLoginStart {
    /// The registry accepted `POST /-/v1/login`.
    Challenge {
        login_url: &'static ZStr,
        done_url: Box<[u8]>,
    },
    /// The registry answered `/-/v1/login` with an error or without both URLs.
    Unsupported { status: u32 },
}

/// `POST <registry>/-/v1/login {"hostname": ...}`; non-http(s) URLs in the answer count as no web login.
pub(crate) fn request_web_login(
    registry: &Npm::Registry::Scope,
    hostname: &[u8],
    response_buf: &mut MutableString,
) -> Result<WebLoginStart, AllocError> {
    let mut body = Vec::new();
    let _ = write!(
        body,
        "{{\"hostname\":{}}}",
        bun_core::fmt::format_json_string_utf8(hostname, Default::default()),
    );

    let headers = registry_headers(registry, b"login", Some(body.len()), false)?;
    let url = registry_endpoint(registry, "v1/login");

    response_buf.reset();
    let mut req = http::AsyncHTTP::init_sync(
        http::Method::POST,
        URL::parse(&url),
        headers.entries.clone()?,
        headers.content.written_slice(),
        &body,
        None,
        http::FetchRedirect::Follow,
    );

    let res = match req.send_sync(response_buf) {
        Ok(r) => r,
        Err(bun_http::Error::Alloc(AllocError)) => return Err(AllocError),
        Err(e) => {
            Output::err(e, "failed to send login request", ());
            Global::crash();
        }
    };

    // npm-profile treats any 4xx or 500 here as "no web login" and falls back
    let status = res.status_code();
    if !(200..300).contains(&status) {
        return Ok(WebLoginStart::Unsupported { status });
    }

    let bump = bun_alloc::Arena::new();
    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string(b"???", response_buf.list.as_slice());
    let json = match json_mod::parse_utf8(&source, &mut log, &bump) {
        Ok(j) => j,
        Err(bun_parsers::Error::Alloc(AllocError)) => return Err(AllocError),
        Err(_) => {
            Output::err("WebLogin", "failed to parse the login response as JSON", ());
            Global::crash();
        }
    };

    let login_url = json_get_string_cloned(&json, &bump, b"loginUrl")?;
    let done_url = json_get_string_cloned(&json, &bump, b"doneUrl")?;
    let (Some(login_url), Some(done_url)) = (login_url, done_url) else {
        return Ok(WebLoginStart::Unsupported { status });
    };
    if !is_web_url(login_url) || !is_web_url(done_url) {
        return Ok(WebLoginStart::Unsupported { status });
    }

    Ok(WebLoginStart::Challenge {
        login_url: dupe_static_z(login_url),
        done_url: done_url.into(),
    })
}

/// `GET done_url` until 200 `{"token"}`; 202 waits `retry-after` seconds (else 500ms) up to `deadline`.
pub(crate) fn poll_done_url(
    done_url: &URL<'_>,
    headers: &http::HeaderBuilder,
    response_buf: &mut MutableString,
    deadline: Option<Instant>,
    pkg_id: Option<(&[u8], &[u8])>,
) -> Result<Box<[u8]>, WebLoginError> {
    loop {
        let now = Instant::now();
        if deadline.is_some_and(|d| now >= d) {
            return Err(WebLoginError::TimedOut);
        }

        response_buf.reset();

        let mut req = http::AsyncHTTP::init_sync(
            http::Method::GET,
            done_url.clone(),
            headers.entries.clone()?,
            headers.content.written_slice(),
            b"",
            None,
            http::FetchRedirect::Follow,
        );

        let res = match req.send_sync(response_buf) {
            Ok(r) => r,
            Err(bun_http::Error::Alloc(AllocError)) => return Err(WebLoginError::OutOfMemory),
            Err(e) => {
                Output::err(e, "failed to poll the login status", ());
                Global::crash();
            }
        };

        match res.status_code() {
            202 => {
                let mut pause = Duration::from_millis(500);
                if let Some(retry) = res.header(b"retry-after") {
                    let trimmed = strings::trim(retry, &strings::WHITESPACE_CHARS);
                    if let Ok(seconds) = strings::parse_int::<u32>(trimmed, 10) {
                        pause = Duration::from_secs(u64::from(seconds));
                    }
                }
                if let Some(d) = deadline {
                    pause = pause.min(d.saturating_duration_since(now));
                }
                std::thread::sleep(pause);
            }
            200 => {
                let bump = bun_alloc::Arena::new();
                let mut log = bun_ast::Log::init();
                let source =
                    bun_ast::Source::init_path_string(b"???", response_buf.list.as_slice());
                let json = match json_mod::parse_utf8(&source, &mut log, &bump) {
                    Ok(j) => j,
                    Err(bun_parsers::Error::Alloc(AllocError)) => {
                        return Err(WebLoginError::OutOfMemory);
                    }
                    Err(_) => {
                        Output::err("WebLogin", "failed to parse response json", ());
                        Global::crash();
                    }
                };

                let token = json_get_string_cloned(&json, &bump, b"token")?.unwrap_or_else(|| {
                    Output::err("WebLogin", "missing `token` field in response json", ());
                    Global::crash();
                });

                // npm-registry-fetch ignores npm-notice when x-local-cache is set
                if let Some(notice) = res.header_if_other_is_absent(b"npm-notice", b"x-local-cache")
                {
                    Output::print_error(format_args!("\n"));
                    bun_core::note!("{}", bstr::BStr::new(notice));
                    Output::flush();
                }

                return Ok(token.into());
            }
            _ => {
                Npm::response_error::<false>(&req, &res, pkg_id, response_buf)?;
            }
        }
    }
}

/// `GET <registry>/-/whoami` with `token`. `None` on any failure: the caller already saved the token.
pub(crate) fn whoami_best_effort(
    registry: &Npm::Registry::Scope,
    token: &[u8],
    response_buf: &mut MutableString,
) -> Result<Option<Vec<u8>>, AllocError> {
    let mut authed = registry.clone();
    authed.token = token.into();
    let headers = registry_headers(&authed, b"whoami", None, true)?;
    let url = registry_endpoint(registry, "whoami");

    response_buf.reset();
    let mut req = http::AsyncHTTP::init_sync(
        http::Method::GET,
        URL::parse(&url),
        headers.entries.clone()?,
        headers.content.written_slice(),
        b"",
        None,
        http::FetchRedirect::Follow,
    );
    let res = match req.send_sync(response_buf) {
        Ok(r) => r,
        Err(bun_http::Error::Alloc(AllocError)) => return Err(AllocError),
        Err(_) => return Ok(None),
    };
    if res.status_code() != 200 {
        return Ok(None);
    }

    let bump = bun_alloc::Arena::new();
    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string(b"???", response_buf.list.as_slice());
    let json = match json_mod::parse_utf8(&source, &mut log, &bump) {
        Ok(j) => j,
        Err(bun_parsers::Error::Alloc(AllocError)) => return Err(AllocError),
        Err(_) => return Ok(None),
    };
    Ok(json_get_string_cloned(&json, &bump, b"username")?.map(<[u8]>::to_vec))
}

/// JavaScript's `encodeURIComponent`, so the token is one path segment.
fn encode_uri_component(input: &[u8], out: &mut Vec<u8>) {
    out.reserve(input.len());
    for &byte in input {
        if byte.is_ascii_alphanumeric() || strings::contains_char(b"-_.!~*'()", byte) {
            out.push(byte);
        } else {
            let hex = bun_core::fmt::hex2_upper(byte);
            out.extend_from_slice(&[b'%', hex[0], hex[1]]);
        }
    }
}

/// `DELETE <registry>/-/user/token/<token>` with that token as Bearer; the URL holds the token, never print it.
pub(crate) fn revoke_token(
    registry: &Npm::Registry::Scope,
    token: &[u8],
    response_buf: &mut MutableString,
) -> Result<u32, AllocError> {
    let mut authed = registry.clone();
    authed.token = token.into();
    let headers = registry_headers(&authed, b"logout", None, true)?;

    let mut url = registry_endpoint(registry, "user/token/");
    encode_uri_component(token, &mut url);

    response_buf.reset();
    let mut req = http::AsyncHTTP::init_sync(
        http::Method::DELETE,
        URL::parse(&url),
        headers.entries.clone()?,
        headers.content.written_slice(),
        b"",
        None,
        http::FetchRedirect::Follow,
    );

    let res = match req.send_sync(response_buf) {
        Ok(r) => r,
        Err(bun_http::Error::Alloc(AllocError)) => return Err(AllocError),
        Err(e) => {
            Output::err(e, "failed to send the token revocation request", ());
            Global::crash();
        }
    };

    Ok(res.status_code())
}
