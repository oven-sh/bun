use bun_collections::VecExt;
use std::io::Write as _;

use crate::Error;
use crate::bun_json as JSON;
use crate::bun_schema::api;
use bun_alloc::AllocError;
use bun_collections::{HashMap, IdentityContext, index_sort};
use bun_core::{Global, Output, fmt as bun_fmt};
use bun_core::{MutableString, strings};
use bun_dotenv::Loader as DotEnv;
use bun_http::{self as http, AsyncHTTP, HeaderBuilder};
use bun_picohttp as picohttp;
use bun_semver::{self as Semver, ExternalString, SlicedString, String as SemverString};
use bun_sys::{self, Fd, File};
use bun_url::{OwnedURL, URL};
use bun_wyhash::Wyhash11;

use crate::bin::{self, Bin};
use crate::bun_fs::FileSystem;
use crate::external_slice::ExternalPackageNameHashList;
use crate::integrity::Integrity;
use crate::package_manager::directories;
use crate::{
    Aligner, ExternalSlice, ExternalStringList, ExternalStringMap, PackageManager, PackageNameHash,
    VersionSlice, initialize_mini_store as initialize_store,
};

// ──────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum WhoamiError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("need auth")]
    NeedAuth,
    #[error("probably invalid auth")]
    ProbablyInvalidAuth,
}
bun_core::oom_from_alloc!(WhoamiError);

pub fn whoami(manager: &mut PackageManager) -> Result<Vec<u8>, WhoamiError> {
    let registry = &manager.options.scope;
    let registry_url = registry.url.url();

    if !registry.user.is_empty() {
        let sep = strings::index_of_char(&registry.user, b':').unwrap();
        return Ok(registry.user[..sep as usize].to_vec());
    }

    if !registry_url.username.is_empty() {
        return Ok(registry_url.username.to_vec());
    }

    // An `_auth` whose username could not be derived still authenticates the request.
    let Some(authorization) = registry.authorization(&registry_url) else {
        return Err(WhoamiError::NeedAuth);
    };

    let auth_type: &[u8] = match &manager.options.publish_config.auth_type {
        Some(auth_type) => auth_type.as_str().as_bytes(),
        None => b"web",
    };
    let ci_name = bun_core::ci_info::detect_ci_name();

    let user_agent = format!(
        "{} {} {} workspaces/false{}{}",
        Global::user_agent,
        Global::os_name,
        Global::arch_name,
        if ci_name.is_some() { " ci/" } else { "" },
        bstr::BStr::new(ci_name.unwrap_or(b"")),
    );
    // no otp needed, just use auth-type from options
    let header_list: [(&[u8], &[u8]); 8] = [
        (b"accept", b"*/*"),
        (b"accept-encoding", b"gzip/deflate"),
        (b"authorization", &authorization),
        (b"npm-auth-type", auth_type),
        (b"npm-command", b"whoami"),
        (b"user-agent", user_agent.as_bytes()),
        (b"Connection", b"keep-alive"),
        (b"Host", registry_url.host),
    ];
    let headers = HeaderBuilder::from_pairs(&header_list)?;

    let mut print_buf: Vec<u8> = Vec::new();
    write!(
        &mut print_buf,
        "{}/-/whoami",
        bstr::BStr::new(strings::without_trailing_slash(registry_url.href)),
    )
    .unwrap();

    let mut response_buf = MutableString::init(1024)?;
    let url = URL::parse(&print_buf);
    let header_buf: &[u8] = headers.content.written_slice();

    let mut req =
        manager.registry_request(http::Method::GET, url, headers.entries, header_buf, b"");

    let res = match manager.send_with_retries(&mut req, &mut response_buf) {
        Ok(res) => res,
        Err(bun_http::Error::Alloc(bun_alloc::AllocError)) => {
            return Err(WhoamiError::OutOfMemory);
        }
        Err(e) => {
            Output::err(e, "whoami request failed to send", format_args!(""));
            Global::crash();
        }
    };

    if res.status_code() >= 400 {
        const OTP_RESPONSE: bool = false;
        response_error::<OTP_RESPONSE>(&req, &res, None, &mut response_buf)?;
    }

    if let Some(notice) = res.header_if_other_is_absent(b"npm-notice", b"x-local-cache") {
        Output::print_error("\n");
        bun_core::note!("{}", bun_fmt::escape_control_chars(notice));
        Output::flush();
    }

    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string("???", response_buf.list.as_slice());
    let parsed = match JSON::ParsedJson::parse_json(&source, &mut log) {
        Ok(j) => j,
        Err(bun_parsers::Error::Alloc(bun_alloc::AllocError)) => {
            return Err(WhoamiError::OutOfMemory);
        }
        Err(e) => {
            Output::err(
                e,
                "failed to parse '/-/whoami' response body as JSON",
                format_args!(""),
            );
            Global::crash();
        }
    };
    let json = parsed.root;

    let username_expr = json.get(b"username");
    let Some(username) = username_expr
        .as_ref()
        .and_then(|e| e.as_utf8_string_literal())
    else {
        // no username, invalid auth probably
        return Err(WhoamiError::ProbablyInvalidAuth);
    };
    Ok(username.to_vec())
}

pub fn response_error<const OTP_RESPONSE: bool>(
    req: &AsyncHTTP,
    res: &bun_http::HTTPResponseMetadata,
    // `<name>@<version>`
    pkg_id: Option<(&[u8], &[u8])>,
    response_body: &mut MutableString,
) -> Result<core::convert::Infallible, AllocError> {
    let message: Option<Vec<u8>> = 'message: {
        let mut log = bun_ast::Log::init();
        let source = bun_ast::Source::init_path_string("???", response_body.list.as_slice());
        let parsed = match JSON::ParsedJson::parse_json(&source, &mut log) {
            Ok(j) => j,
            Err(bun_parsers::Error::Alloc(bun_alloc::AllocError)) => {
                return Err(AllocError);
            }
            Err(_) => break 'message None,
        };

        let error_expr = parsed.root.get(b"error");
        let Some(error) = error_expr.as_ref().and_then(|e| e.as_utf8_string_literal()) else {
            break 'message None;
        };
        Some(error.to_vec())
    };

    bun_core::pretty_errorln!(
        "\n<red>{}<r>{}{}: {}\n",
        res.status_code(),
        if !res.status_text().is_empty() {
            " "
        } else {
            ""
        },
        bun_fmt::escape_control_chars(res.status_text()),
        bun_fmt::EscapeControlChars(bun_fmt::redacted_npm_url(req.url.href)),
    );

    if res.status_code() == 404
        && let Some((package_name, package_version)) = pkg_id
    {
        bun_core::pretty_errorln!(
            "\n - '{}@{}' does not exist in this registry",
            bun_fmt::escape_control_chars(package_name),
            bun_fmt::escape_control_chars(package_version),
        );
    } else if let Some(msg) = &message {
        if OTP_RESPONSE {
            if res.status_code() == 401
                && strings::contains(
                    msg,
                    b"You must provide a one-time pass. Upgrade your client to npm@latest in order to use 2FA.",
                )
            {
                bun_core::pretty_errorln!("\n - Received invalid OTP");
                Global::crash();
            }
        }
        bun_core::pretty_errorln!("\n - {}", bun_fmt::escape_control_chars(msg));
    }

    Global::crash();
}

// ──────────────────────────────────────────────────────────────────────────

pub mod registry {
    use super::*;

    // Single source of truth lives in `bun_install_types` (lower-tier crate so
    // `ini`/`options_types` can read it without depending on the full package
    // manager). Re-exported here as the same surface (`&str` const + `LazyLock`)
    // so existing `Npm::Registry::DEFAULT_URL` / `*DEFAULT_URL_HASH` callers are
    // untouched.
    pub const DEFAULT_URL: &str = bun_install_types::NodeLinker::npm::Registry::DEFAULT_URL;
    pub static DEFAULT_URL_HASH: std::sync::LazyLock<u64> =
        std::sync::LazyLock::new(bun_install_types::NodeLinker::npm::Registry::default_url_hash);

    // `MutableString: ObjectPoolType` (init = init2048) is provided in
    // bun_string; the `object_pool!` macro generates the per-monomorphization
    // thread-local storage so `BodyPool::get()` doesn't hit `UnwiredStorage`'s
    // `unreachable!()`.
    bun_collections::object_pool!(pub BodyPool: MutableString, threadsafe, 8);

    #[derive(Default, Clone)]
    pub struct Scope {
        pub name: Box<[u8]>,
        // https://github.com/npm/npm-registry-fetch/blob/main/lib/auth.js#L96
        // Sent verbatim as `Basic <auth>`: whatever `_auth` holds, usually base64(user:password).
        pub(crate) auth: Box<[u8]>,
        pub url: OwnedURL,
        pub url_hash: u64,
        pub(crate) token: Box<[u8]>,

        // username and password combo, `user:pass`
        pub(crate) user: Box<[u8]>,

        /// See `NpmRegistry::declared_in_npmrc`. Cleared when an explicit token is set later.
        pub(crate) declared_in_npmrc: bool,

        /// The `.npmrc` key this registry's URL resolves to, once every source was applied.
        pub(crate) url_auth_key: Option<Box<[u8]>>,
    }

    /// After `:` in yarn's shape (`/api/:_authToken=T`), after `/` in JFrog's (`/npm/_auth=<b64>`).
    const EMBEDDED_OPTIONS: [&[u8]; 4] = [b"_authToken=", b"_auth=", b"username=", b"_password="];

    #[derive(Default)]
    struct EmbeddedAuth<'a> {
        /// In the order of `EMBEDDED_OPTIONS`.
        values: [Option<&'a [u8]>; 4],
        /// True if the scan found a token or an `_auth`. That ends the scan, and nothing after it
        /// is read.
        terminal: bool,
    }

    /// Returns `(start, index in EMBEDDED_OPTIONS)`. Matches the whole marker, because base64
    /// values can contain `/`.
    fn last_embedded_marker(pathname: &[u8]) -> Option<(usize, usize)> {
        (0..pathname.len())
            .rev()
            .filter(|&start| matches!(pathname[start], b':' | b'/'))
            .find_map(|start| {
                let rest = &pathname[start + 1..];
                let option = (EMBEDDED_OPTIONS.iter()).position(|name| rest.starts_with(name))?;
                Some((start, option))
            })
    }

    /// A trailing `:<word>=` that isn't a known option is a misspelled credential. It's stripped
    /// and never used.
    fn trailing_misspelt_marker(pathname: &[u8]) -> Option<usize> {
        let unslashed = pathname.strip_suffix(b"/").unwrap_or(pathname);
        let start = strings::last_index_of_char(unslashed, b'/')? + 1;
        let tail = &unslashed[start..];
        let word = &tail.get(1..)?[..strings::index_of_char_usize(tail.get(1..)?, b'=')?];
        let shaped = tail[0] == b':'
            && word
                .first()
                .is_some_and(|&c| c == b'_' || c.is_ascii_alphabetic())
            && word
                .iter()
                .all(|&c| c == b'_' || c == b'-' || c.is_ascii_alphanumeric());
        shaped.then_some(start)
    }

    /// The credentials are stripped whether or not they're used. If they stayed, the secret would
    /// be sent in every request path.
    fn parse_embedded_auth<'a>(url: &mut URL<'a>) -> EmbeddedAuth<'a> {
        let mut out = EmbeddedAuth::default();
        let mut pathname: &'a [u8] = url.pathname;

        // Scan from right to left, because the credentials are appended after the path.
        loop {
            let start = if let Some((start, option)) = last_embedded_marker(pathname) {
                let value = &pathname[start + 1 + EMBEDDED_OPTIONS[option].len()..];
                // The slash that closes the URL (`/:_authToken=S/`) is not part of the value.
                let value = value.strip_suffix(b"/").unwrap_or(value);
                // An empty marker neither ends the scan nor shadows a `.npmrc` line.
                if !out.terminal && !value.is_empty() {
                    out.values[option] = Some(value);
                    out.terminal = option < 2;
                }
                // `/<name>=` keeps the slash that ends the path. `:<name>=` comes after that slash.
                if pathname[start] == b'/' {
                    pathname = &pathname[..start + 1];
                    continue;
                }
                start
            } else if let Some(start) = trailing_misspelt_marker(pathname) {
                start
            } else {
                break;
            };
            pathname = &pathname[..start];
            if pathname.len() > 1 && pathname[pathname.len() - 1] == b'/' {
                pathname = &pathname[..pathname.len() - 1];
            }
        }

        url.pathname = pathname;
        url.path = pathname;
        out
    }

    /// A credential that holds a CR, LF or NUL: its name in `bunfig.toml`, then in `.npmrc`.
    type UnsafeCredential = (&'static str, &'static str);

    fn check_credential(value: &[u8], names: UnsafeCredential) -> Result<(), UnsafeCredential> {
        if http::async_http::breaks_header_line(value) {
            return Err(names);
        }
        Ok(())
    }

    /// `what` names the key the credential was configured under, never its value.
    fn refuse_credential(what: core::fmt::Arguments<'_>) -> Error {
        Output::err_generic("{} contains a newline or NUL byte", what);
        Error::InstallFailed
    }

    impl Scope {
        pub fn hash(str: &[u8]) -> u64 {
            bun_semver::semver_string::Builder::string_hash(str)
        }

        /// This is the only place where a credential leaves a `Scope`, so it's where a URL that
        /// isn't http(s) is refused.
        pub fn authorization_parts(&self, url: &URL) -> Option<(&'static [u8], &[u8])> {
            if !url.has_http_like_protocol() {
                None
            } else if !self.token.is_empty() {
                Some((b"Bearer ", &self.token))
            } else if !self.auth.is_empty() {
                Some((b"Basic ", &self.auth))
            } else {
                None
            }
        }

        /// Returns raw bytes, because a credential doesn't have to be UTF-8.
        pub fn authorization(&self, url: &URL) -> Option<Vec<u8>> {
            self.authorization_parts(url)
                .map(|(scheme, value)| [scheme, value].concat())
        }

        /// Stores the WHATWG serialization (the base `bun_url::join` resolves against) so same-origin checks, concatenated tarball URLs and `url_hash` agree with the requests; credentials must already be split off.
        pub fn set_url(&mut self, href: Box<[u8]>) {
            self.url = URL::from_string(&bun_core::String::borrow_utf8(&href))
                .unwrap_or_else(|_| OwnedURL::from_href(href));
            self.url_hash = Self::hash(strings::without_trailing_slash(self.url.href()));
        }

        pub(crate) fn has_credentials(&self) -> bool {
            !self.token.is_empty() || !self.auth.is_empty()
        }

        pub(crate) fn copy_credentials_from(&mut self, other: &Scope) {
            self.token.clone_from(&other.token);
            self.auth.clone_from(&other.auth);
            self.user.clone_from(&other.user);
            self.declared_in_npmrc = other.declared_in_npmrc;
        }

        pub(crate) fn set_token_from_env(&mut self, key: &[u8], token: &[u8]) -> crate::Result<()> {
            if http::async_http::breaks_header_line(token) {
                return Err(refuse_credential(format_args!("${}", bstr::BStr::new(key))));
            }
            self.token = token.into();
            self.declared_in_npmrc = false;
            Ok(())
        }

        pub(crate) fn get_name(name: &[u8]) -> &[u8] {
            if name.is_empty() || name[0] != b'@' {
                return name;
            }

            if let Some(i) = strings::index_of_char(name, b'/') {
                return &name[1..i as usize];
            }

            &name[1..]
        }

        /// `env` is `None` for a registry URL that comes from package data, so that no environment
        /// variable is expanded into it.
        pub(crate) fn from_api(
            name: &[u8],
            registry: api::NpmRegistry,
            env: Option<&mut DotEnv>,
        ) -> crate::Result<Scope> {
            match env {
                Some(env) => Self::build(name, registry, env, true),
                None => Self::build(name, registry, &mut DotEnv::init(), false),
            }
            .map_err(|(credential, _)| {
                if name.is_empty() {
                    refuse_credential(format_args!("the {credential} of the default registry"))
                } else {
                    refuse_credential(format_args!(
                        "the {credential} of the @{} registry",
                        bun_fmt::escape_control_chars(name),
                    ))
                }
            })
        }

        /// The only function that builds a `Scope`. It checks the final bytes that go into
        /// `Authorization`.
        fn build(
            name: &[u8],
            mut registry: api::NpmRegistry,
            env: &mut DotEnv,
            // `false` for a `.npmrc` line, where `$` before no variable's name is a literal.
            unset_variable_is_no_credential: bool,
        ) -> Result<Scope, UnsafeCredential> {
            // Support $ENV_VAR for registry URLs
            if strings::starts_with_char(&registry.url, b'$') {
                // If it became "$ENV_VAR/", then we need to remove the trailing slash
                if let Some(replaced_url) = env.get(strings::trim(&registry.url[1..], b"/")) {
                    if replaced_url.len() > 1 {
                        registry.url = replaced_url.into();
                    }
                }
            }

            // The config loaders split literal strings. A URL that came from an expanded $ENV_VAR
            // is split here.
            let from_url = api::NpmRegistry::from_url(&registry.url);
            registry.url = from_url.url;
            if !registry.has_credentials() {
                registry.token = from_url.token;
                registry.auth = from_url.auth;
                registry.username = from_url.username;
                registry.password = from_url.password;
            }

            // Sent as text, an unset `$NPM_TOKEN` would also hide the registry's `.npmrc` line.
            for (what, field) in [
                ("token", &mut registry.token),
                ("username", &mut registry.username),
                ("password", &mut registry.password),
            ] {
                // Anything else after the `$` isn't a variable name, so it's a password that starts
                // with `$`.
                if field.len() < 2
                    || field[0] != b'$'
                    || !(field[1..].iter()).all(|c| c.is_ascii_alphanumeric() || *c == b'_')
                {
                    continue;
                }
                match env.get(&**field) {
                    Some(value) => *field = value.into(),
                    None if unset_variable_is_no_credential => {
                        // `--silent` has lowered it by now.
                        if bun_ast::DEFAULT_LOG_LEVEL
                            .load()
                            .at_least(bun_ast::Level::Warn)
                        {
                            bun_core::warn!(
                                "registry {} references unset variable <b>{}<r>, ignoring credential",
                                what,
                                bun_fmt::escape_control_chars(&**field),
                            );
                        }
                        *field = Box::default();
                    }
                    None => {}
                }
            }

            let registry_url: Box<[u8]> = core::mem::take(&mut registry.url);
            let mut url = URL::parse(&registry_url);
            let mut auth: Box<[u8]> = Box::default();
            let mut user: Box<[u8]> = Box::default();

            let original_pathname_len = url.pathname.len();
            let embedded = parse_embedded_auth(&mut url);
            let needs_normalize = url.pathname.len() != original_pathname_len;

            if registry.token.is_empty() {
                'outer: {
                    if registry.password.is_empty() && registry.auth.is_empty() {
                        let [token, embedded_auth, username, password] = embedded.values;
                        if let Some(token) = token {
                            registry.token = env.get_auto(token).into();
                        }
                        if let Some(embedded_auth) = embedded_auth {
                            auth = embedded_auth.into();
                        }
                        if let Some(username) = username {
                            registry.username = env.get_auto(username).into();
                        }
                        if let Some(password) = password {
                            registry.password = env.get_auto(password).into();
                        }
                        if embedded.terminal {
                            break 'outer;
                        }
                    }

                    // Sent verbatim. It's only decoded to get `user` for `bun pm whoami`.
                    if !registry.auth.is_empty() {
                        let mut decoded = vec![0u8; bun_base64::decode_len(&registry.auth)];
                        let result = bun_base64::decode(&mut decoded, &registry.auth);
                        decoded.truncate(result.count);
                        // A blank username or password is a real pattern. There's no identity to
                        // report then.
                        if result.is_successful()
                            && strings::index_of_char_usize(&decoded, b':')
                                .is_some_and(|colon| colon > 0 && colon + 1 < decoded.len())
                        {
                            user = decoded.into();
                        }
                        auth = registry.auth;
                        break 'outer;
                    }

                    check_credential(&registry.username, ("username", "username"))?;
                    check_credential(&registry.password, ("password", "_password"))?;

                    if !registry.username.is_empty() && !registry.password.is_empty() {
                        user = [&*registry.username, b":", &*registry.password]
                            .concat()
                            .into();
                        let encoded_len = bun_core::base64::standard_encoder_calc_size(user.len());
                        auth =
                            bun_core::base64::standard_encode(&mut vec![0u8; encoded_len], &user)
                                .into();
                    }
                }
            }

            check_credential(&registry.token, ("token", "_authToken"))?;
            check_credential(&auth, ("_auth", "_auth"))?;

            let final_href: Box<[u8]> = if needs_normalize {
                api::NpmRegistry::href_without_auth(&url)
            } else {
                registry_url
            };

            let mut scope = Scope {
                name: name.into(),
                token: registry.token,
                auth,
                user,
                declared_in_npmrc: registry.declared_in_npmrc,
                ..Default::default()
            };
            scope.set_url(final_href);
            Ok(scope)
        }
    }

    // Keys are pre-hashed (`Scope::hash`), so don't re-hash them.
    pub type Map = HashMap<u64, Scope, bun_collections::IdentityContext<u64>>;

    /// One credential key from `.npmrc`. It has no scheme, so it applies to both `http` and
    /// `https`.
    pub(crate) struct UrlAuth {
        /// npm's config key, already normalized by `bun_ini` (`host/path/`).
        pub(crate) key: Box<[u8]>,
        /// Only the credential fields are set. `url` is empty.
        pub(crate) credentials: Scope,
    }

    impl UrlAuth {
        pub(crate) fn from_api(
            api: &api::NpmUrlAuth,
            env: &mut DotEnv,
        ) -> crate::Result<Option<UrlAuth>> {
            let credentials = Scope::build(b"", api.credentials.clone(), env, false).map_err(
                |(_, npmrc_option)| {
                    refuse_credential(format_args!(
                        "//{}:{npmrc_option} in .npmrc",
                        bun_fmt::escape_control_chars(&api.key),
                    ))
                },
            )?;
            Ok(credentials.has_credentials().then(|| UrlAuth {
                key: api.key.clone(),
                credentials,
            }))
        }

        /// Walks the path like npm does. `url` must be a WHATWG serialization, from `Scope::url` or
        /// `normalize_tarball_url`.
        pub(crate) fn find_entry<'a>(list: &'a [UrlAuth], url: &URL) -> Option<&'a UrlAuth> {
            if list.is_empty() || !url.has_http_like_protocol() {
                return None;
            }
            bun_ini::RegistryKey::from_parsed(url)
                .walk()
                .find_map(|key| list.iter().find(|entry| *entry.key == *key))
        }
    }

    /// Returns `dist.tarball` as npm's `new URL()` serializes it, or `None` if parsing it once
    /// doesn't give a stable result.
    pub fn normalize_tarball_url(raw: &[u8]) -> Option<Box<[u8]>> {
        // The parse would read bytes that are not UTF-8 as U+FFFD, which names another resource.
        if raw.iter().any(|&b| b <= 0x20 || b == 0x7f) || !strings::is_valid_utf8(raw) {
            return None;
        }
        let href = URL::from_string(&bun_core::String::borrow_utf8(raw))
            .ok()?
            .into_href();
        if hides_dot_segment(query_free_path(&URL::parse(&href))) {
            return None;
        }
        Some(href)
    }

    /// `normalize_tarball_url` without the parse, for a URL built from `Scope::url` and a name.
    pub fn is_normalized_tarball_url(url: &[u8]) -> bool {
        !url.iter().any(|&b| b <= 0x20 || b >= 0x7f || b == b'\\')
            && !hides_dot_segment(query_free_path(&URL::parse(url)))
    }

    /// Reads `%2f` and `%5c` as separators and drops `;params`, as Tomcat and Jetty do.
    fn hides_dot_segment(path: &[u8]) -> bool {
        let mut start = 0;
        let mut i = 0;
        let mut found = false;
        let mut check = |segment: &[u8]| {
            const DOTS: [&[u8]; 6] = [b".", b"..", b"%2e", b"%2e.", b".%2e", b"%2e%2e"];
            let name_end = strings::index_of_char_usize(segment, b';').unwrap_or(segment.len());
            let name = &segment[..name_end];
            found |= DOTS.iter().any(|dot| name.eq_ignore_ascii_case(dot));
        };
        while i < path.len() {
            let encoded_separator = path[i] == b'%'
                && i + 2 < path.len()
                && matches!(
                    &path[i + 1..i + 3],
                    [b'2', b'f' | b'F'] | [b'5', b'c' | b'C']
                );
            if path[i] == b'/' || encoded_separator {
                check(&path[start..i]);
                i += if encoded_separator { 3 } else { 1 };
                start = i;
            } else {
                i += 1;
            }
        }
        check(&path[start..]);
        found
    }

    /// `url.path` is query-free too, but collapses a one-byte path such as `/r/` to `/`.
    pub(crate) fn query_free_path<'a>(url: &URL<'a>) -> &'a [u8] {
        let pathname = url.pathname;
        &pathname[..strings::index_of_char_usize(pathname, b'?').unwrap_or(pathname.len())]
    }

    pub(crate) enum PackageVersionResponse {
        Cached(PackageManifest),
        Fresh(PackageManifest),
        NotFound,
    }

    /// How long a cached manifest stays fresh, in seconds. This is the `max-age` that
    /// registry.npmjs.org sends, the default without one, and the longest one that is honored.
    const MAX_MANIFEST_AGE: u32 = 300;

    fn seconds_from_now(seconds: u32) -> u32 {
        (u64::try_from(bun_core::time::timestamp().max(0)).expect("int cast") as u32)
            .saturating_add(seconds)
    }

    /// True for a cached manifest that was written while the system clock was set in the future.
    /// `past` is any earlier time. It settles the usual case without reading the clock.
    pub(crate) fn expires_too_late(expiry: u32, past: u32) -> bool {
        expiry > past.saturating_add(MAX_MANIFEST_AGE)
            && expiry > seconds_from_now(MAX_MANIFEST_AGE)
    }

    pub(crate) fn manifest_expiry(headers: &picohttp::HeaderList) -> u32 {
        let mut max_age = u64::from(MAX_MANIFEST_AGE);
        for directive in strings::split(headers.get(b"cache-control").unwrap_or(b""), b",") {
            let directive = directive.trim_ascii();
            if strings::eql_case_insensitive_ascii(directive, b"no-cache", true)
                || strings::eql_case_insensitive_ascii(directive, b"no-store", true)
            {
                max_age = 0;
            } else if strings::has_prefix_case_insensitive(directive, b"max-age=") {
                let seconds = bun_core::parse_int::<u64>(&directive[b"max-age=".len()..], 10);
                max_age = max_age.min(seconds.unwrap_or(0));
            }
        }
        seconds_from_now(max_age as u32)
    }

    pub(crate) fn get_package_metadata(
        scope: &Scope,
        response: picohttp::Response,
        body: &[u8],
        log: &mut bun_ast::Log,
        package_name: &[u8],
        loaded_manifest: Option<PackageManifest>,
        package_manager: &mut PackageManager,
        is_extended_manifest: bool,
    ) -> Result<PackageVersionResponse, Error> {
        match response.status_code {
            400 => return Err(crate::Error::BadRequest),
            429 => return Err(crate::Error::TooManyRequests),
            404 => return Ok(PackageVersionResponse::NotFound),
            500..=599 => return Err(crate::Error::HTTPInternalServerError),
            304 => match loaded_manifest {
                Some(manifest) => return Ok(PackageVersionResponse::Cached(manifest)),
                None => return Err(crate::Error::UnexpectedNotModified),
            },
            _ => {}
        }

        let newly_last_modified: &[u8] = response.headers.get(b"last-modified").unwrap_or(b"");
        let mut new_etag: &[u8] = response.headers.get(b"etag").unwrap_or(b"");

        let mut new_etag_buf = [0u8; 64];

        if new_etag.len() < new_etag_buf.len() {
            new_etag_buf[..new_etag.len()].copy_from_slice(new_etag);
            new_etag = &new_etag_buf[..new_etag.len()];
        }

        if let Some(package) = PackageManifest::parse(
            scope,
            log,
            body,
            package_name,
            newly_last_modified,
            new_etag,
            manifest_expiry(&response.headers),
            is_extended_manifest,
        )? {
            // If the cache cannot be written, the manifest is still used. It is just not saved.
            if package_manager.options.enable.manifest_cache()
                && let Ok(temp_dir) = directories::try_get_temporary_directory(package_manager)
            {
                package_manifest::Serializer::save_async(
                    &package,
                    scope,
                    temp_dir.handle.fd,
                    package_manager.get_cache_directory(),
                );
            }

            return Ok(PackageVersionResponse::Fresh(package));
        }

        Err(crate::Error::PackageFailedToParse)
    }
}

pub use registry as Registry;

// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct DistTagMap {
    pub(crate) tags: ExternalStringList,
    pub(crate) versions: VersionSlice,
}

pub(crate) type PackageVersionList = ExternalSlice<PackageVersion>;

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct ExternVersionMap {
    pub(crate) keys: VersionSlice,
    pub(crate) values: PackageVersionList,
}

impl ExternVersionMap {
    fn find_key_index(self, buf: &[Semver::Version], find: Semver::Version) -> Option<u32> {
        for (i, key) in self.keys.get(buf).iter().enumerate() {
            if key.eql(find) {
                return Some(i as u32);
            }
        }
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// MOVE_DOWN: `Negatable` / `NegatableEnum` / `NegatableExt` / `OperatingSystem`
// / `Libc` / `Architecture` (and their name maps) now live in
// `bun_install_types::resolver_hooks` so `bun_resolver` and `bun_install`
// share ONE nominal type per name. Re-export the canonical definitions; only
// `negatable_from_json` (which depends on `bun_ast::Expr`) stays here.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_install_types::resolver_hooks::{
    Architecture, Libc, Negatable, NegatableEnum, NegatableExt, OperatingSystem,
};

/// Lives here (not in `bun_install_types`) because `bun_ast::Expr` is not
/// reachable from that crate.
pub(crate) fn negatable_from_json<T: NegatableEnum>(expr: &JSON::Expr) -> Result<T, AllocError> {
    let mut this = T::NONE.negatable();
    if let JSON::ExprData::EArray(a) = &expr.data {
        for item in a.items.slice() {
            // JSON parsed via `parse_utf8` always yields UTF-8 EStrings,
            // so no transcode allocator is needed.
            if let Some(value) = item.as_utf8_string_literal() {
                this.apply(value);
            }
        }
    } else if let Some(str) = expr.as_utf8_string_literal() {
        this.apply(str);
    }

    Ok(this.combine())
}

pub(crate) fn negatable_from_json_value<T: NegatableEnum>(value: &JSON::E::JsonValue) -> T {
    let mut this = T::NONE.negatable();
    match value {
        JSON::E::JsonValue::Array(arr) => {
            for item in arr.get().items() {
                if let Some(value) = item.as_str() {
                    this.apply(value);
                }
            }
        }
        JSON::E::JsonValue::String(str) => this.apply(str.slice()),
        _ => {}
    }

    this.combine()
}

/// Only the registry's full document has `libc`. This goes by the name alone, because a lockfile
/// written on macOS records `libc` for Linux too.
pub(crate) fn name_suggests_libc(name: &[u8]) -> bool {
    // `gnu` isn't checked, because it's also in `signup`, and where it means glibc it comes after
    // `linux`.
    strings::contains(name, b"linux")
        || strings::contains(name, b"musl")
        || strings::contains(name, b"glibc")
}

// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy)]
pub struct PackageVersion {
    /// `"integrity"` field || `"shasum"` field
    /// https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#dist
    // Splitting this into it's own array ends up increasing the final size a little bit.
    pub(crate) integrity: Integrity,

    // Explicit padding so this struct has no implicit (uninitialized) padding
    // bytes — `Serializer::write_array` reinterprets the whole slice as `&[u8]`,
    // and reading uninitialized padding as `u8` is UB. With explicit `[u8; N]`
    // fields, `Default` zero-fills them and every byte of the struct is
    // initialized. Layout (size=248, align=8) is unchanged; see the
    // `offset_of!` asserts below and `padding_checker.rs` for the contract.
    pub(crate) _padding_after_integrity: [u8; 3],

    /// "dependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#dependencies)
    pub(crate) dependencies: ExternalStringMap,

    /// `"optionalDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies)
    pub(crate) optional_dependencies: ExternalStringMap,

    /// `"peerDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#peerdependencies)
    /// if `non_optional_peer_dependencies_start` is > 0, then instead of alphabetical, the first N items are optional
    pub(crate) peer_dependencies: ExternalStringMap,

    /// `"devDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#devdependencies)
    /// We deliberately choose not to populate this field.
    /// We keep it in the data layout so that if it turns out we do need it, we can add it without invalidating everyone's history.
    pub(crate) dev_dependencies: ExternalStringMap,

    pub(crate) bundled_dependencies: ExternalPackageNameHashList,

    /// `"bin"` field in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#bin)
    pub(crate) bin: Bin,

    /// `"engines"` field in package.json
    pub(crate) engines: ExternalStringMap,

    /// `"peerDependenciesMeta"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#peerdependenciesmeta)
    /// if `non_optional_peer_dependencies_start` is > 0, then instead of alphabetical, the first N items of `peer_dependencies` are optional
    pub(crate) non_optional_peer_dependencies_start: u32,
    pub(crate) _padding_before_man_dir: [u8; 4],

    pub(crate) man_dir: ExternalString,

    /// can be empty!
    /// When empty, it means that the tarball URL can be inferred
    pub(crate) tarball_url: ExternalString,

    /// The registry document's `"deprecated"` message. Empty when the version is not deprecated.
    pub(crate) deprecated: SemverString,

    pub(crate) unpacked_size: u32,
    pub(crate) file_count: u32,

    /// `"os"` field in package.json
    pub(crate) os: OperatingSystem,
    /// `"cpu"` field in package.json
    pub(crate) cpu: Architecture,

    /// The `"libc"` field in package.json. It's only in the full document. See
    /// `name_suggests_libc`.
    pub(crate) libc: Libc,

    /// The `hasInstallScript` field of the registry API. It is derived from `scripts` when the
    /// registry's document has those instead.
    pub(crate) has_install_script: bool,
    pub(crate) _padding_tail: [u8; 2],

    /// Unix timestamp of publication (0 if the registry gives none, infinity if it is no date)
    pub(crate) publish_timestamp_ms: f64,
}

impl Default for PackageVersion {
    fn default() -> Self {
        Self {
            integrity: Integrity::default(),
            _padding_after_integrity: [0; 3],
            dependencies: ExternalStringMap::default(),
            optional_dependencies: ExternalStringMap::default(),
            peer_dependencies: ExternalStringMap::default(),
            dev_dependencies: ExternalStringMap::default(),
            bundled_dependencies: ExternalPackageNameHashList::default(),
            bin: Bin::default(),
            engines: ExternalStringMap::default(),
            non_optional_peer_dependencies_start: 0,
            _padding_before_man_dir: [0; 4],
            man_dir: ExternalString::default(),
            tarball_url: ExternalString::default(),
            deprecated: SemverString::default(),
            unpacked_size: 0,
            file_count: 0,
            os: OperatingSystem::ALL,
            cpu: Architecture::ALL,
            libc: Libc::NONE,
            has_install_script: false,
            _padding_tail: [0; 2],
            publish_timestamp_ms: 0.0,
        }
    }
}

impl PackageVersion {
    pub(crate) fn all_dependencies_bundled(&self) -> bool {
        self.bundled_dependencies.is_invalid()
    }

    /// Used by `Package.fromNPM` to walk dependency groups by name.
    pub(crate) fn dep_group(&self, field: &[u8]) -> ExternalStringMap {
        match field {
            b"dependencies" => self.dependencies,
            b"dev_dependencies" => self.dev_dependencies,
            b"optional_dependencies" => self.optional_dependencies,
            b"peer_dependencies" => self.peer_dependencies,
            _ => unreachable!("PackageVersion::dep_group: unknown field"),
        }
    }
}

// Layout pin. `PackageVersion` is byte-serialised into the on-disk `.npm`
// manifest cache, so its size and field offsets are an ABI contract with
// every previously released Bun that wrote a cache entry. A mismatch here
// means a cross-version cache read will mis-slice — fail loudly at compile
// time instead. (Full per-type asserts live in `padding_checker::layout_asserts`.)
const _: () = assert!(
    core::mem::size_of::<PackageVersion>() == 248,
    "Npm.PackageVersion layout drifted from Zig spec (expected 248 bytes); \
     bump PackageManifest::Serializer::VERSION if intentional",
);

// Compile-time proof that the explicit `_padding_*` fields above leave no
// implicit padding gaps in `PackageVersion` (so `&[PackageVersion] as &[u8]`
// in `Serializer::write_array` reads only initialized bytes). Mirrors the
// `NpmPackage` checks below and `padding_checker.rs`.
const _: () = {
    use core::mem::{offset_of, size_of};
    // gap between `integrity` (size 65, align 1) and `dependencies` (align 4 → 68)
    assert!(
        offset_of!(PackageVersion, _padding_after_integrity)
            == offset_of!(PackageVersion, integrity) + size_of::<Integrity>()
    );
    assert!(
        offset_of!(PackageVersion, dependencies)
            == offset_of!(PackageVersion, _padding_after_integrity) + 3
    );
    // gap between `non_optional_peer_dependencies_start` (u32, ends at 180) and `man_dir` (align 8 → 184)
    assert!(
        offset_of!(PackageVersion, _padding_before_man_dir)
            == offset_of!(PackageVersion, non_optional_peer_dependencies_start) + size_of::<u32>()
    );
    assert!(
        offset_of!(PackageVersion, man_dir)
            == offset_of!(PackageVersion, _padding_before_man_dir) + 4
    );
    // `deprecated` (size 8, align 1) fills 216..224 between `tarball_url` and `unpacked_size`
    assert!(
        offset_of!(PackageVersion, deprecated)
            == offset_of!(PackageVersion, tarball_url) + size_of::<ExternalString>()
    );
    assert!(
        offset_of!(PackageVersion, unpacked_size)
            == offset_of!(PackageVersion, deprecated) + size_of::<SemverString>()
    );
    // gap between `has_install_script` (ends at 238) and `publish_timestamp_ms` (align 8 → 240)
    assert!(
        offset_of!(PackageVersion, _padding_tail)
            == offset_of!(PackageVersion, has_install_script) + size_of::<bool>()
    );
    assert!(
        offset_of!(PackageVersion, publish_timestamp_ms)
            == offset_of!(PackageVersion, _padding_tail) + 2
    );
};

// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct NpmPackage {
    /// HTTP response headers
    pub(crate) last_modified: SemverString,
    pub(crate) etag: SemverString,

    /// "modified" in the JSON
    pub(crate) modified: SemverString,
    pub(crate) public_max_age: u32,
    // Explicit padding so this struct has no implicit (uninitialized) padding
    // bytes — `Serializer::write` reinterprets the whole struct as `&[u8]`,
    // and reading uninitialized padding as `u8` is UB. With explicit `[u8; N]`
    // fields, `Default` zero-fills them and every byte of the struct is
    // initialized. Layout (size=120, align=8) is unchanged; see the
    // `offset_of!` asserts below and `padding_checker.rs` for the contract.
    pub(crate) _padding_after_max_age: [u8; 4],

    pub(crate) name: ExternalString,

    pub(crate) releases: ExternVersionMap,
    pub(crate) prereleases: ExternVersionMap,
    pub(crate) dist_tags: DistTagMap,

    pub(crate) versions_buf: VersionSlice,
    pub(crate) string_lists_buf: ExternalStringList,

    // True if the full document was fetched, so `publish_timestamp_ms` and `libc` are populated.
    pub(crate) has_extended_manifest: bool,
    pub(crate) _padding_tail: [u8; 7],
}

// Compile-time proof that the explicit `_padding_*` fields above leave no
// implicit padding gaps in `NpmPackage` (so `&NpmPackage as &[u8]` reads only
// initialized bytes). Mirrors the per-field-gap check documented in
// `padding_checker.rs`.
const _: () = {
    use core::mem::{offset_of, size_of};
    // gap between `public_max_age` (u32, ends at 28) and `name` (align 8 → 32)
    assert!(
        offset_of!(NpmPackage, _padding_after_max_age)
            == offset_of!(NpmPackage, public_max_age) + size_of::<u32>()
    );
    assert!(offset_of!(NpmPackage, name) == offset_of!(NpmPackage, _padding_after_max_age) + 4);
    // tail gap after `has_extended_manifest` (bool, at 112) → struct end (120)
    assert!(
        offset_of!(NpmPackage, _padding_tail)
            == offset_of!(NpmPackage, has_extended_manifest) + size_of::<bool>()
    );
    assert!(offset_of!(NpmPackage, _padding_tail) + 7 == size_of::<NpmPackage>());
};

// ──────────────────────────────────────────────────────────────────────────

#[derive(Default, Clone)]
pub struct PackageManifest {
    pub(crate) pkg: NpmPackage,

    pub string_buf: Box<[u8]>,
    pub versions: Box<[Semver::Version]>,
    pub(crate) external_strings: Box<[ExternalString]>,
    // We store this in a separate buffer so that we can dedupe contiguous identical versions without an extra pass
    pub(crate) external_strings_for_versions: Box<[ExternalString]>,
    pub(crate) package_versions: Box<[PackageVersion]>,
    pub(crate) extern_strings_bin_entries: Box<[ExternalString]>,
    pub(crate) bundled_deps_buf: Box<[PackageNameHash]>,
}

impl PackageManifest {
    #[inline]
    pub fn name(&self) -> &[u8] {
        self.pkg.name.slice(&self.string_buf)
    }

    pub(crate) fn byte_length(&self, scope: &registry::Scope) -> usize {
        let mut counter = bun_io::DiscardingWriter::new();
        match package_manifest::Serializer::write(self, scope, &mut counter) {
            Ok(()) => counter.count,
            Err(_) => 0,
        }
    }
}

pub mod package_manifest {
    use super::*;
    use bun_io::Write as _;

    pub struct Serializer;

    /// The `save_async` tasks that have not finished.
    static SAVES: bun_threading::WaitGroup = bun_threading::WaitGroup::init();

    impl Serializer {
        // - v0.0.3: added serialization of registry url. it's used to invalidate when it changes
        // - v0.0.4: fixed bug with cpu & os tag not being added correctly
        // - v0.0.5: added bundled dependencies
        // - v0.0.6: changed semver major/minor/patch to each use u64 instead of u32
        // - v0.0.7: added version publish times and extended manifest flag for minimum release age
        // - v0.0.8: fixed bundled dependencies kept for one group only; added `deprecated`
        const HEADER_BYTES: &'static str =
            concat!("#!/usr/bin/env bun\n", "bun-npm-manifest-cache-v0.0.8\n");

        // Field order is hardcoded (descending alignment). Re-verify if the
        // layout changes.
    }

    const _: () = assert!(
        Serializer::HEADER_BYTES.len() == 49,
        "header bytes must be exactly 49 bytes long, length is not serialized"
    );

    impl Serializer {
        pub(crate) fn write_array<W: bun_io::Write, T: Copy>(
            writer: &mut W,
            array: &[T],
            pos: &mut u64,
        ) -> Result<(), Error> {
            // SAFETY: T is Copy POD; sliceAsBytes equivalent
            let bytes = unsafe {
                bun_core::ffi::slice(array.as_ptr().cast::<u8>(), core::mem::size_of_val(array))
            };
            if bytes.is_empty() {
                writer.write_int_le::<u64>(0)?;
                *pos += 8;
                return Ok(());
            }

            writer.write_int_le::<u64>(bytes.len() as u64)?;
            *pos += 8;
            *pos += Aligner::write::<T, W>(writer, *pos)? as u64;

            writer.write_all(bytes)?;
            *pos += bytes.len() as u64;
            Ok(())
        }

        fn read_array_bytes<'a, T: Copy>(
            stream: &mut bun_io::FixedBufferStream<&'a [u8]>,
        ) -> Result<&'a [u8], Error> {
            let byte_len = stream.read_int_le::<u64>()?;
            if byte_len == 0 {
                return Ok(&[]);
            }

            stream.pos += Aligner::skip_amount::<T>(stream.pos);
            let remaining = &stream.buffer[stream.pos.min(stream.buffer.len())..];
            if (remaining.len() as u64) < byte_len {
                return Err(crate::Error::BufferTooSmall);
            }
            let result_bytes = &remaining[..byte_len as usize];
            stream.pos += result_bytes.len();
            Ok(result_bytes)
        }

        fn array_from_bytes<T: Copy>(result_bytes: &[u8]) -> &[T] {
            if result_bytes.is_empty() {
                return &[];
            }
            // SAFETY: alignment was advanced by Aligner::skip_amount; T is POD
            unsafe {
                bun_core::ffi::slice(
                    result_bytes.as_ptr().cast::<T>(),
                    result_bytes.len() / core::mem::size_of::<T>(),
                )
            }
        }

        pub fn read_array<'a, T: Copy>(
            stream: &mut bun_io::FixedBufferStream<&'a [u8]>,
        ) -> Result<&'a [T], Error> {
            Ok(Self::array_from_bytes::<T>(Self::read_array_bytes::<T>(
                stream,
            )?))
        }

        pub(crate) fn write<W: bun_io::Write>(
            this: &PackageManifest,
            scope: &registry::Scope,
            writer: &mut W,
        ) -> Result<(), Error> {
            let mut pos: u64 = 0;
            writer.write_all(Self::HEADER_BYTES.as_bytes())?;
            pos += Self::HEADER_BYTES.len() as u64;

            writer.write_int_le::<u64>(scope.url_hash)?;
            writer.write_int_le::<u64>(
                strings::without_trailing_slash(scope.url.href()).len() as u64
            )?;

            pos += 128 / 8;

            // Verify field order matches SIZES_FIELDS (descending alignment)
            // if the layout changes.
            {
                // "pkg"
                // SAFETY: NpmPackage is `#[repr(C)]`, `Copy`, and has **no
                // implicit padding** — the two layout gaps are filled by
                // explicit `_padding_*: [u8; N]` fields (zero-initialized via
                // `Default`), and the `const _ = { offset_of!… }` block at the
                // struct definition statically asserts no gap remains. Every
                // byte of `this.pkg` is therefore initialized, so viewing it
                // as `&[u8]` is sound.
                let bytes = unsafe {
                    bun_core::ffi::slice(
                        (&raw const this.pkg).cast::<u8>(),
                        core::mem::size_of::<NpmPackage>(),
                    )
                };
                pos += Aligner::write::<NpmPackage, W>(writer, pos)? as u64;
                writer.write_all(bytes)?;
                pos += bytes.len() as u64;
            }
            Self::write_array(writer, &this.string_buf, &mut pos)?;
            Self::write_array(writer, &this.versions, &mut pos)?;
            Self::write_array(writer, &this.external_strings, &mut pos)?;
            Self::write_array(writer, &this.external_strings_for_versions, &mut pos)?;
            Self::write_array(writer, &this.package_versions, &mut pos)?;
            Self::write_array(writer, &this.extern_strings_bin_entries, &mut pos)?;
            Self::write_array(writer, &this.bundled_deps_buf, &mut pos)?;

            Ok(())
        }

        fn write_file(
            this: &PackageManifest,
            scope: &registry::Scope,
            tmp_path: &bun_core::ZStr,
            tmpdir: Fd,
            cache_dir: Fd,
            outpath: &bun_core::ZStr,
        ) -> Result<(), Error> {
            // 64 KB sounds like a lot but when you consider that this is only about 6 levels deep in the stack, it's not that much.
            let mut buffer: Vec<u8> = Vec::with_capacity(this.byte_length(scope) + 64);
            Serializer::write(this, scope, &mut buffer)?;
            // --- Perf Improvement #1 ----
            // Do not forget to buffer writes!
            //
            // --- Perf Improvement #2 ----
            // GetFinalPathnameByHandle is very expensive if called many times
            // We skip calling it when we are giving an absolute file path.
            // This needs many more call sites, doesn't have much impact on this location.
            let mut realpath_buf = bun_paths::path_buffer_pool::get();
            // SAFETY: `crate::package_manager::get()` returns the live
            // singleton; `get_temporary_directory` only mutates its
            // lazy-init state and is called from the install thread.
            #[cfg(windows)]
            let tmpdir_stub = unsafe { (*crate::package_manager::get()).get_temporary_directory() };
            #[cfg(windows)]
            let path_to_use_for_opening_file =
                bun_paths::resolve_path::join_abs_string_buf_z::<bun_paths::platform::Auto>(
                    &tmpdir_stub.path,
                    &mut realpath_buf[..],
                    &[tmp_path.as_bytes()],
                );
            #[cfg(not(windows))]
            let path_to_use_for_opening_file = tmp_path;
            #[cfg(not(windows))]
            let _ = &mut realpath_buf;
            #[cfg(windows)]
            let _ = cache_dir;

            #[cfg(any(target_os = "linux", target_os = "android"))]
            let mut is_using_o_tmpfile = false;

            #[allow(unused_labels)]
            let file: File = 'brk: {
                let flags = bun_sys::O::WRONLY;
                #[cfg(unix)]
                let mask = 0o664;
                #[cfg(not(unix))]
                let mask = 0;

                // Do our best to use O_TMPFILE, so that if this process is interrupted, we don't leave a temporary file behind.
                // O_TMPFILE is Linux-only. Not all filesystems support O_TMPFILE.
                // https://manpages.debian.org/testing/manpages-dev/openat.2.en.html#O_TMPFILE
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    match File::openat(
                        cache_dir,
                        bun_core::zstr!("."),
                        flags | bun_sys::O::TMPFILE,
                        mask,
                    ) {
                        bun_sys::Result::Err(_) => {
                            static DID_WARN: core::sync::atomic::AtomicBool =
                                core::sync::atomic::AtomicBool::new(false);
                            fn warn_once() {
                                // .monotonic is okay because we only ever set this to true, and
                                // we don't rely on any side effects from a thread that
                                // previously set this to true.
                                if !DID_WARN.swap(true, core::sync::atomic::Ordering::Relaxed) {
                                    // This is not an error. Nor is it really a warning.
                                    bun_core::note!(
                                        "Linux filesystem or kernel lacks O_TMPFILE support. Using a fallback instead.",
                                    );
                                    Output::flush();
                                }
                            }
                            if PackageManager::verbose_install() {
                                warn_once();
                            }
                        }
                        bun_sys::Result::Ok(f) => {
                            is_using_o_tmpfile = true;
                            break 'brk f;
                        }
                    }
                }

                File::openat(
                    tmpdir,
                    path_to_use_for_opening_file,
                    flags | bun_sys::O::CREAT | bun_sys::O::TRUNC,
                    mask,
                )?
            };

            file.write_all(&buffer)?;

            #[cfg(windows)]
            {
                let mut realpath2_buf = bun_paths::path_buffer_pool::get();
                let cache_dir_abs = &PackageManager::get().cache_directory_path;
                let cache_path_abs =
                    bun_paths::resolve_path::join_abs_string_buf_z::<bun_paths::platform::Auto>(
                        cache_dir_abs,
                        &mut realpath2_buf[..],
                        &[cache_dir_abs, outpath.as_bytes()],
                    );
                // The close error is discarded — the renameat immediately
                // below surfaces a usable error if the temp file is in a
                // bad state, and on POSIX the close cannot fail for a
                // regular-file fd we just wrote.
                let _ = file.close();
                bun_sys::renameat(
                    Fd::cwd(),
                    path_to_use_for_opening_file,
                    Fd::cwd(),
                    cache_path_abs,
                )?;
                return Ok(());
            }

            #[cfg(any(target_os = "linux", target_os = "android"))]
            if is_using_o_tmpfile {
                if bun_sys::linkat_tmpfile(file.handle, cache_dir, outpath).is_ok() {
                    return Ok(());
                }
                // Keep the entry in place the whole time: rename over it below instead of unlinking
                // it first.
                bun_sys::linkat_tmpfile(file.handle, tmpdir, tmp_path)?;
            }

            #[cfg(not(windows))]
            {
                // Attempt #1. Rename the file.
                let rc = bun_sys::renameat(tmpdir, tmp_path, cache_dir, outpath);

                match &rc {
                    bun_sys::Result::Err(err) => {
                        // Fallback path: atomically swap from <tmp>/*.npm -> <cache>/*.npm, then unlink the temporary file.
                        // If atomically swapping fails, then we should still unlink the temporary file as a courtesy.
                        scopeguard::defer! {
                            let _ = bun_sys::unlinkat(tmpdir, tmp_path);
                        }

                        // On Darwin `Errno::EOPNOTSUPP` resolves to 102 while
                        // the kernel reports errno **45** (ENOTSUP), so match
                        // `ENOTSUP` as well to keep the macOS
                        // `renameat2(.exchange)` fallback reachable. On
                        // Linux/FreeBSD the two names alias the same value,
                        // so compare by equality (a `matches!` pattern would
                        // flag the alias as unreachable).
                        let errno = err.get_errno();
                        if errno == bun_sys::Errno::EEXIST
                            || errno == bun_sys::Errno::ENOTEMPTY
                            || errno == bun_sys::Errno::ENOTSUP
                            || errno == bun_sys::Errno::EOPNOTSUPP
                        {
                            // Atomically swap the old file with the new file.
                            bun_sys::renameat2(
                                tmpdir,
                                tmp_path,
                                cache_dir,
                                outpath,
                                bun_sys::RenameMode::Exchange,
                            )?;

                            // Success.
                            return Ok(());
                        }
                    }
                    bun_sys::Result::Ok(()) => {}
                }

                rc?;
            }

            #[cfg(not(windows))]
            Ok(())
        }

        /// The next run, `--offline` above all, reads what this one fetched. A pool thread must not wait for its own pool.
        pub(crate) extern "C" fn finish_saves_at_exit() {
            if bun_crash_handler::cli_state::is_main_thread()
                && PackageManager::get().thread_pool.has_workers()
            {
                SAVES.wait();
            }
        }

        /// The install doesn't wait for the file to be written. The process does, in
        /// `finish_saves_at_exit`.
        pub(crate) fn save_async(
            this: &PackageManifest,
            scope: &registry::Scope,
            tmpdir: Fd,
            cache_dir: Fd,
        ) {
            use bun_threading::thread_pool::{
                Batch as PoolBatch, Node as PoolNode, Task as PoolTask,
            };

            struct SaveTask {
                manifest: PackageManifest,
                // Owned: the thread-pool task can outlive the caller's borrow
                // of the Registry.Scope, so it owns a clone.
                scope: registry::Scope,
                tmpdir: Fd,
                cache_dir: Fd,

                task: PoolTask,
            }

            bun_threading::intrusive_work_task!(SaveTask, task);

            impl SaveTask {
                fn new(init: SaveTask) -> Box<SaveTask> {
                    Box::new(init)
                }

                // Safe-fn: only ever invoked by `ThreadPool` via the `callback`
                // fn-pointer with the `*mut PoolTask` we registered below
                // (`heap::into_raw(SaveTask { task: .. })`). The thread-pool
                // contract — not the Rust caller — guarantees `task` is live
                // and points at `SaveTask.task`, so the precondition is
                // discharged locally (matches `HardLinkWindowsInstallTask::
                // run_from_thread_pool` in PackageInstall.rs). Safe `fn`
                // coerces to the `unsafe fn(*mut Task)` field type.
                fn run(task: *mut PoolTask) {
                    use bun_threading::IntrusiveWorkTask as _;
                    let _tracer = bun_core::perf::trace("PackageManifest.Serializer.save");

                    // SAFETY: thread-pool callback contract — `task` points to
                    // `SaveTask.task`; allocated via `heap::into_raw` in `save_async`.
                    let save_task = unsafe { bun_core::heap::take(SaveTask::from_task_ptr(task)) };

                    if let Err(err) = Serializer::save(
                        &save_task.manifest,
                        &save_task.scope,
                        save_task.tmpdir,
                        save_task.cache_dir,
                    ) {
                        if PackageManager::verbose_install() {
                            bun_core::warn!(
                                "Error caching manifest for {}: {}",
                                bstr::BStr::new(save_task.manifest.name()),
                                err.name(),
                            );
                            Output::flush();
                        }
                    }
                    drop(save_task);
                    SAVES.finish();
                }
            }

            SAVES.add_one();
            let task = bun_core::heap::into_raw(SaveTask::new(SaveTask {
                manifest: this.clone(),
                scope: scope.clone(),
                tmpdir,
                cache_dir,
                task: PoolTask {
                    node: PoolNode::default(),
                    callback: SaveTask::run,
                },
            }));

            // SAFETY: task is a valid Box-allocated SaveTask
            let batch = PoolBatch::from(unsafe { core::ptr::addr_of_mut!((*task).task) });
            PackageManager::get().thread_pool.schedule(batch);
        }

        fn manifest_file_name<'b>(
            buf: &'b mut [u8],
            file_id: u64,
            scope: &registry::Scope,
        ) -> Result<&'b bun_core::ZStr, Error> {
            let file_id_hex_fmt = bun_fmt::hex_int_lower::<16>(file_id);
            let mut stream = bun_io::FixedBufferStream::new_mut(buf);
            if scope.url_hash == *registry::DEFAULT_URL_HASH {
                write!(stream, "{}.npm", file_id_hex_fmt)?;
            } else {
                write!(
                    stream,
                    "{}-{}.npm",
                    file_id_hex_fmt,
                    bun_fmt::hex_int_lower::<16>(scope.url_hash),
                )?;
            }
            stream.write_byte(0)?;
            let len = stream.pos;
            // We wrote `len` bytes ending in a NUL into `buf`.
            Ok(bun_core::ZStr::from_buf_mut(buf, len - 1))
        }

        pub(crate) fn save(
            this: &PackageManifest,
            scope: &registry::Scope,
            tmpdir: Fd,
            cache_dir: Fd,
        ) -> Result<(), Error> {
            let file_id = Wyhash11::hash(0, this.name());
            let mut tmp_path_buf = [0u8; 64];
            let tmp_path = FileSystem::tmpname(b"npm", &mut tmp_path_buf, bun_core::fast_random())?;
            let mut out_path_buf =
                [0u8; ("18446744073709551615".len() * 2) + "_".len() + ".npm".len() + 1];
            let out_path = Self::manifest_file_name(&mut out_path_buf, file_id, scope)?;
            Self::write_file(this, scope, tmp_path, tmpdir, cache_dir, out_path)
        }

        pub(crate) fn load_by_file_id(
            scope: &registry::Scope,
            cache_dir: Fd,
            name: &[u8],
            file_id: u64,
        ) -> Result<Option<PackageManifest>, Error> {
            let mut file_path_buf = [0u8; 512 + 64];
            let file_name = Self::manifest_file_name(&mut file_path_buf, file_id, scope)?;
            let Ok(cache_file) = File::openat(cache_dir, file_name, bun_sys::O::RDONLY, 0) else {
                return Ok(None);
            };

            // A file that cannot be used is not deleted. Another version of bun may have written
            // it, and the next download of the manifest replaces it.
            Ok(Self::load_by_file(scope, &cache_file)
                .ok()
                .flatten()
                .filter(|manifest| manifest.name() == name))
        }

        pub fn load_by_file(
            scope: &registry::Scope,
            manifest_file: &File,
        ) -> Result<Option<PackageManifest>, Error> {
            let _tracer = bun_core::perf::trace("PackageManifest.Serializer.loadByFile");
            let bytes = manifest_file.read_to_end()?;
            // errdefer allocator.free(bytes) — Vec drops on error path

            if bytes.len() < Self::HEADER_BYTES.len() {
                return Ok(None);
            }

            let Some(manifest) = Self::read_all(&bytes, scope)? else {
                return Ok(None);
            };

            if manifest.versions.is_empty() {
                // it's impossible to publish a package with zero versions, bust
                // invalid entry
                return Ok(None);
            }

            Ok(Some(manifest))
        }

        fn read_all(
            bytes: &[u8],
            scope: &registry::Scope,
        ) -> Result<Option<PackageManifest>, Error> {
            if &bytes[..Self::HEADER_BYTES.len()] != Self::HEADER_BYTES.as_bytes() {
                return Ok(None);
            }
            let mut pkg_stream = bun_io::FixedBufferStream::new(bytes);
            pkg_stream.pos = Self::HEADER_BYTES.len();

            let registry_hash = pkg_stream.read_int_le::<u64>()?;
            if scope.url_hash != registry_hash {
                return Ok(None);
            }

            let registry_length = pkg_stream.read_int_le::<u64>()?;
            if strings::without_trailing_slash(scope.url.href()).len() as u64 != registry_length {
                return Ok(None);
            }

            // Keep the order in sync with `Serializer::write` and SIZES_FIELDS.
            let pkg = {
                pkg_stream.pos = pkg_stream
                    .pos
                    .next_multiple_of(core::mem::align_of::<NpmPackage>());
                let flag_at =
                    pkg_stream.pos + core::mem::offset_of!(NpmPackage, has_extended_manifest);
                if !matches!(bytes.get(flag_at).copied(), Some(0 | 1)) {
                    return Ok(None);
                }
                pkg_stream.read_struct::<NpmPackage>()?
            };
            let string_buf = Self::read_array::<u8>(&mut pkg_stream)?;
            let versions = Self::read_array::<Semver::Version>(&mut pkg_stream)?;
            let external_strings = Self::read_array::<ExternalString>(&mut pkg_stream)?;
            let external_strings_for_versions =
                Self::read_array::<ExternalString>(&mut pkg_stream)?;
            let raw_package_versions = Self::read_array_bytes::<PackageVersion>(&mut pkg_stream)?;
            let extern_strings_bin_entries = Self::read_array::<ExternalString>(&mut pkg_stream)?;
            let bundled_deps_buf = Self::read_array::<PackageNameHash>(&mut pkg_stream)?;

            // The file is ignored if a list of the package points outside its array. A version's
            // lists are checked later, by `is_in_bounds`. A string outside the buffer reads as "".
            let string = |s: &SemverString| s.is_within(string_buf);
            let package_versions = {
                let bin_at = core::mem::offset_of!(PackageVersion, bin);
                let bin_tag_at = bin_at + core::mem::offset_of!(Bin, tag);
                let bin_value_at = bin_at + core::mem::offset_of!(Bin, value);
                let install_script_at = core::mem::offset_of!(PackageVersion, has_install_script);
                for raw_pkg in raw_package_versions
                    .as_chunks::<{ core::mem::size_of::<PackageVersion>() }>()
                    .0
                {
                    let is_bin_valid = match raw_pkg[bin_tag_at] {
                        0..=3 => true,
                        4 => {
                            let names_and_paths =
                                bun_io::FixedBufferStream::new(&raw_pkg[bin_value_at..])
                                    .read_struct::<ExternalStringList>()?;
                            names_and_paths.len.is_multiple_of(2)
                                && names_and_paths.is_within(extern_strings_bin_entries)
                        }
                        _ => false,
                    };
                    if !is_bin_valid || !matches!(raw_pkg[install_script_at], 0 | 1) {
                        return Ok(None);
                    }
                }
                Self::array_from_bytes::<PackageVersion>(raw_package_versions)
            };
            let version_map = |map: &ExternVersionMap| {
                map.keys.len == map.values.len
                    && map.keys.is_within(versions)
                    && map.values.is_within(package_versions)
            };
            let is_in_bounds = version_map(&pkg.releases)
                && version_map(&pkg.prereleases)
                && pkg.dist_tags.tags.len == pkg.dist_tags.versions.len
                && pkg.dist_tags.tags.is_within(external_strings)
                && pkg.dist_tags.versions.is_within(versions)
                && pkg.versions_buf.is_within(versions)
                && pkg.string_lists_buf.is_within(external_strings)
                && [pkg.last_modified, pkg.etag, pkg.modified, pkg.name.value]
                    .iter()
                    .all(string);
            if !is_in_bounds {
                return Ok(None);
            }

            Ok(Some(PackageManifest {
                pkg,
                string_buf: string_buf.into(),
                versions: versions.into(),
                external_strings: external_strings.into(),
                external_strings_for_versions: external_strings_for_versions.into(),
                package_versions: package_versions.into(),
                extern_strings_bin_entries: extern_strings_bin_entries.into(),
                bundled_deps_buf: bundled_deps_buf.into(),
            }))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

impl PackageManifest {
    pub(crate) fn str<'a>(&'a self, external: &'a ExternalString) -> &'a [u8] {
        external.slice(&self.string_buf)
    }

    /// Returns true if every list of `version` points inside its array. This is checked right
    /// before `Package::from_npm` reads the lists, so loading a manifest doesn't check unused
    /// versions.
    pub(crate) fn is_in_bounds(&self, version: &PackageVersion) -> bool {
        [
            &version.dependencies,
            &version.optional_dependencies,
            &version.peer_dependencies,
            &version.dev_dependencies,
            &version.engines,
        ]
        .into_iter()
        .all(|map| {
            map.name.len == map.value.len
                && map.name.is_within(&self.external_strings)
                && map.value.is_within(&self.external_strings_for_versions)
        }) && (version.all_dependencies_bundled()
            || (version.bundled_dependencies).is_within(&self.bundled_deps_buf))
    }
}

#[derive(Clone, Copy)]
pub struct FindResult<'a> {
    pub version: Semver::Version,
    pub(crate) package: &'a PackageVersion,
}

impl FindResult<'_> {
    /// The tarball URL the registry advertised for this version (empty when the manifest omitted it).
    pub fn tarball_url(&self, manifest: &PackageManifest) -> Vec<u8> {
        self.package
            .tarball_url
            .slice(&manifest.string_buf)
            .to_vec()
    }

    pub fn integrity(&self) -> Integrity {
        self.package.integrity
    }

    pub fn is_newer_than(
        &self,
        manifest: &PackageManifest,
        current: Semver::Version,
        current_buf: &[u8],
    ) -> bool {
        self.version
            .order(current, &manifest.string_buf, current_buf)
            .is_gt()
    }
}

/// Uses pnpm's grammar: `name` exempts a package, and `name@1.2.3 || 1.2.4` only exempts those
/// versions.
pub struct MinimumReleaseAgeExcludes(Vec<(&'static [u8], Option<Semver::Version>)>);

impl MinimumReleaseAgeExcludes {
    /// A malformed entry (`foo@`, `foo@^1`) is dropped with a warning, never widened to the name.
    pub(crate) fn parse(entries: &[&'static [u8]], log: &mut bun_ast::Log) -> Self {
        let mut list = Vec::new();
        for &entry in entries {
            // Skip a scope's leading `@` so `@types/node@20.0.0` splits after the name.
            let name_start = usize::from(strings::starts_with_char(entry, b'@'));
            let Some(at) = strings::index_of_char_usize(&entry[name_start..], b'@') else {
                list.push((entry, None));
                continue;
            };
            let (name, specs) = (&entry[..name_start + at], &entry[name_start + at + 1..]);
            let first_of_entry = list.len();
            for spec in strings::split(specs, b"||") {
                let Some(version) = Semver::Version::parse_exact(SlicedString::init(spec, spec))
                else {
                    list.truncate(first_of_entry);
                    log.add_warning_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "ignoring minimumReleaseAgeExcludes entry {}: expected a package name or exact versions, e.g. \"{name}@1.2.3\" or \"{name}@1.2.3 || 1.2.4\"",
                            bun_fmt::EscapeControlChars(bun_fmt::quote(entry)),
                            name = bun_fmt::escape_control_chars(name),
                        ),
                    );
                    break;
                };
                list.push((name, Some(version)));
            }
        }
        MinimumReleaseAgeExcludes(list)
    }

    /// `bun audit fix` exempts the packages it must move past the age gate.
    pub(crate) fn with_packages(
        base: Option<&Self>,
        names: impl IntoIterator<Item = &'static [u8]>,
    ) -> Self {
        let mut list = base.map_or_else(Vec::new, |base| base.0.clone());
        list.extend(names.into_iter().map(|name| (name, None)));
        MinimumReleaseAgeExcludes(list)
    }

    fn excludes_version(&self, name: &[u8], version: Semver::Version) -> bool {
        self.0
            .iter()
            .any(|&(p, v)| p == name && v.is_some_and(|v| v.eql(version)))
    }
}

impl PackageManifest {
    pub(crate) fn find_by_version(&self, version: Semver::Version) -> Option<FindResult<'_>> {
        let list = if !version.tag.has_pre() {
            self.pkg.releases
        } else {
            self.pkg.prereleases
        };
        let values = list.values.get(&self.package_versions);
        let keys = list.keys.get(&self.versions);
        let index = list.find_key_index(&self.versions, version)?;
        Some(FindResult {
            // Be sure to use the struct from the list in the NpmPackage
            // That is the one we can correctly recover the original version string for
            version: keys[index as usize],
            package: &values[index as usize],
        })
    }

    /// Published release versions, oldest first (prereleases excluded), as sorted at serialization time.
    pub fn release_versions(&self) -> &[Semver::Version] {
        self.pkg.releases.keys.get(&self.versions)
    }

    /// Published prerelease versions, oldest first, as sorted at serialization time.
    pub fn prerelease_versions(&self) -> &[Semver::Version] {
        self.pkg.prereleases.keys.get(&self.versions)
    }

    /// Like `npm view`: an exact dist-tag name wins, and otherwise the best match for the range.
    pub fn find_by_spec(&self, spec: &[u8]) -> Result<FindResult<'_>, Error> {
        use crate::dependency::{Tag, TagExt as _};
        let spec: &[u8] = if spec.is_empty() { b"latest" } else { spec };
        // Checked before classifying because published tag names like `v12-lts` read as a range.
        if let Some((_, version)) = self.dist_tags().find(|(tag, _)| *tag == spec) {
            return self.find_by_version(version).ok_or(Error::DistTagNotFound);
        }
        // Both pick the version that `bun add` would install. `latest` only gets here when the
        // manifest has no such tag.
        if spec == b"*" || spec == b"latest" {
            return (self.find_any_version(None, None).unwrap()).ok_or(Error::NoMatchingVersion);
        }
        match Tag::infer(spec) {
            Tag::DistTag => Err(Error::DistTagNotFound),
            Tag::Npm => {
                // `v1.2.3` -> `1.2.3`, as `dependency::parse_with_tag` does.
                let range = if spec.len() > 1 && spec[0] == b'v' {
                    &spec[1..]
                } else {
                    spec
                };
                let query = Semver::query::parse(range, SlicedString::init(range, range))?;
                // The spec only has unknown words (e.g. `npm:x@1`), which the lenient parser turned
                // into a group that matches everything.
                if query.is_empty() {
                    return Err(Error::NoMatchingVersion);
                }
                self.find_best_version(&query, range)
                    .ok_or(Error::NoMatchingVersion)
            }
            _ => Err(Error::NoMatchingVersion),
        }
    }

    /// `(tag, version)` pairs of the dist-tags.
    pub fn dist_tags(&self) -> impl Iterator<Item = (&[u8], Semver::Version)> + '_ {
        let versions = self.pkg.dist_tags.versions.get(&self.versions);
        self.pkg
            .dist_tags
            .tags
            .get(&self.external_strings)
            .iter()
            .zip(versions)
            .map(|(t, &v)| (t.slice(&self.string_buf), v))
    }

    pub fn find_by_dist_tag(&self, tag: &[u8]) -> Option<FindResult<'_>> {
        let (_, version) = self.dist_tags().find(|(name, _)| *name == tag)?;
        self.find_by_version(version)
    }

    /// Returns true if every version of this package bypasses the minimum release age.
    pub(crate) fn should_exclude_from_age_filter(
        &self,
        exclusions: Option<&MinimumReleaseAgeExcludes>,
    ) -> bool {
        exclusions.is_some_and(|e| (e.0.iter()).any(|&(p, v)| p == self.name() && v.is_none()))
    }

    /// Too recent for the gate and not listed in `exclusions`.
    pub(crate) fn is_version_blocked_by_age_filter(
        &self,
        result: FindResult<'_>,
        minimum_release_age_ms: f64,
        exclusions: Option<&MinimumReleaseAgeExcludes>,
    ) -> bool {
        Self::is_package_version_too_recent(result.package, minimum_release_age_ms)
            && !exclusions.is_some_and(|e| e.excludes_version(self.name(), result.version))
    }

    #[inline]
    pub(crate) fn is_package_version_too_recent(
        package_version: &PackageVersion,
        minimum_release_age_ms: f64,
    ) -> bool {
        let current_timestamp_ms: f64 =
            (bun_core::start_time() / bun_core::time::NS_PER_MS as i128) as f64;
        package_version.publish_timestamp_ms > current_timestamp_ms - minimum_release_age_ms
    }

    fn search_version_list<'a>(
        &'a self,
        versions: &'a [Semver::Version],
        packages: &'a [PackageVersion],
        group: &Semver::query::Group,
        group_buf: &[u8],
        minimum_release_age_ms: f64,
        exclusions: Option<&MinimumReleaseAgeExcludes>,
        newest_filtered: &mut Option<Semver::Version>,
        deprecated: &mut Option<FindResult<'a>>,
    ) -> Option<FindVersionResult<'a>> {
        let mut prev_package_blocked_from_age: Option<&PackageVersion> = None;
        let mut best_version: Option<FindResult<'a>> = None;

        let current_timestamp_ms: f64 =
            (bun_core::start_time() / bun_core::time::NS_PER_MS as i128) as f64;
        let seven_days_ms: f64 = 7.0 * bun_core::time::MS_PER_DAY as f64;
        let stability_window_ms: f64 = minimum_release_age_ms.min(seven_days_ms);

        for (&version, package) in versions.iter().zip(packages).rev() {
            if group.satisfies(version, group_buf, &self.string_buf) {
                if !package.deprecated.is_empty() {
                    let found = FindResult { version, package };
                    if self.is_version_blocked_by_age_filter(
                        found,
                        minimum_release_age_ms,
                        exclusions,
                    ) {
                        newest_filtered.get_or_insert(version);
                    } else {
                        deprecated.get_or_insert(found);
                    }
                    continue;
                }
                // Listed versions count as stable, so they skip the age gate and replace an
                // unstable fallback.
                if exclusions.is_some_and(|e| e.excludes_version(self.name(), version)) {
                    best_version = Some(FindResult { version, package });
                    break;
                }
                if Self::is_package_version_too_recent(package, minimum_release_age_ms) {
                    newest_filtered.get_or_insert(version);
                    prev_package_blocked_from_age = Some(package);
                }
                // stability check - if the previous package is blocked from age, we need to check if the current package wasn't the cause
                else if let Some(prev_package) = prev_package_blocked_from_age {
                    // only try to go backwards for a max of 7 days on top of existing minimum age
                    if package.publish_timestamp_ms
                        < current_timestamp_ms - (minimum_release_age_ms + seven_days_ms)
                    {
                        best_version.get_or_insert(FindResult { version, package });
                        break;
                    }

                    let is_stable = prev_package.publish_timestamp_ms
                        - package.publish_timestamp_ms
                        >= stability_window_ms;
                    if is_stable {
                        best_version = Some(FindResult { version, package });
                        break;
                    }
                    best_version.get_or_insert(FindResult { version, package });
                    prev_package_blocked_from_age = Some(package);
                } else {
                    return Some(FindVersionResult::Found(FindResult { version, package }));
                }
            }
        }

        best_version.map(|result| match *newest_filtered {
            Some(_) => FindVersionResult::FoundWithFilter {
                result,
                newest_filtered: *newest_filtered,
            },
            None => FindVersionResult::Found(result),
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FindVersionError {
    NotFound,
    TooRecent,
    AllVersionsTooRecent,
}

#[derive(Clone, Copy)]
pub enum FindVersionResult<'a> {
    Found(FindResult<'a>),
    FoundWithFilter {
        result: FindResult<'a>,
        newest_filtered: Option<Semver::Version>,
    },
    Err(FindVersionError),
}

impl<'a> FindVersionResult<'a> {
    pub fn unwrap(self) -> Option<FindResult<'a>> {
        match self {
            FindVersionResult::Found(result) => Some(result),
            FindVersionResult::FoundWithFilter { result, .. } => Some(result),
            FindVersionResult::Err(_) => None,
        }
    }

    pub fn latest_is_filtered(&self) -> bool {
        match self {
            FindVersionResult::FoundWithFilter {
                newest_filtered, ..
            } => newest_filtered.is_some(),
            FindVersionResult::Err(err) => *err == FindVersionError::AllVersionsTooRecent,
            // .err.too_recent is only for direct version checks which doesn't prove there was a later version that could have been chosen
            _ => false,
        }
    }
}

/// Returns true if the text of a range is npm's `*`, which `find_any_version` resolves. npm goes by
/// the text: `x` and `>=0.0.0` are ranges like any other.
pub(crate) fn is_any_version_range(literal: &[u8]) -> bool {
    literal == b"*" || literal.ends_with(b"@*")
}

impl PackageManifest {
    pub(crate) fn find_for_dependency(
        &self,
        version: &crate::dependency::Version,
        buf: &[u8],
        minimum_release_age_ms: Option<f64>,
        exclusions: Option<&MinimumReleaseAgeExcludes>,
    ) -> FindVersionResult<'_> {
        let literal = version.literal.slice(buf);
        if version.tag == crate::dependency::Tag::Npm {
            if is_any_version_range(literal) {
                return self.find_any_version(minimum_release_age_ms, exclusions);
            }
            return self.find_best_version_with_filter(
                &version.npm().version,
                buf,
                minimum_release_age_ms,
                exclusions,
            );
        }
        // Nobody wrote `latest` explicitly (`bun add pkg`), so like npm, don't follow the tag to a
        // deprecated version.
        if literal.is_empty()
            && (self.find_by_dist_tag(b"latest"))
                .is_some_and(|latest| !latest.package.deprecated.is_empty())
        {
            return self.find_any_version(minimum_release_age_ms, exclusions);
        }
        self.find_by_dist_tag_with_filter(
            version.dist_tag().tag.slice(buf),
            minimum_release_age_ms,
            exclusions,
        )
    }

    /// Resolves npm's `*`: `latest`, even if it's a prerelease, unless it's deprecated. Otherwise
    /// the highest release.
    pub(crate) fn find_any_version(
        &self,
        minimum_release_age_ms: Option<f64>,
        exclusions: Option<&MinimumReleaseAgeExcludes>,
    ) -> FindVersionResult<'_> {
        self.find_best_version_with_filter(
            &Semver::query::Group::default(),
            b"",
            minimum_release_age_ms,
            exclusions,
        )
    }

    /// `latest`, or `find_any_version` when that tag names no published version.
    pub fn find_latest(
        &self,
        minimum_release_age_ms: Option<f64>,
        exclusions: Option<&MinimumReleaseAgeExcludes>,
    ) -> FindVersionResult<'_> {
        if self.find_by_dist_tag(b"latest").is_none() {
            return self.find_any_version(minimum_release_age_ms, exclusions);
        }
        self.find_by_dist_tag_with_filter(b"latest", minimum_release_age_ms, exclusions)
    }

    pub fn find_by_dist_tag_with_filter(
        &self,
        tag: &[u8],
        minimum_release_age_ms: Option<f64>,
        exclusions: Option<&MinimumReleaseAgeExcludes>,
    ) -> FindVersionResult<'_> {
        let Some(dist_result) = self.find_by_dist_tag(tag) else {
            return FindVersionResult::Err(FindVersionError::NotFound);
        };
        let Some(min_age_ms) =
            minimum_release_age_ms.filter(|_| !self.should_exclude_from_age_filter(exclusions))
        else {
            return FindVersionResult::Found(dist_result);
        };
        let current_timestamp_ms: f64 =
            (bun_core::start_time() / bun_core::time::NS_PER_MS as i128) as f64;
        let seven_days_ms: f64 = 7.0 * bun_core::time::MS_PER_DAY as f64;
        let stability_window_ms = min_age_ms.min(seven_days_ms);

        if !self.is_version_blocked_by_age_filter(dist_result, min_age_ms, exclusions) {
            return FindVersionResult::Found(dist_result);
        }

        let latest_version = dist_result.version;
        let is_prerelease = latest_version.tag.has_pre();
        fn before_dot(tag: &[u8]) -> &[u8] {
            &tag[..strings::index_of_char_usize(tag, b'.').unwrap_or(tag.len())]
        }
        let latest_tag = before_dot(latest_version.tag.pre.slice(&self.string_buf));

        let list = if is_prerelease {
            self.pkg.prereleases
        } else {
            self.pkg.releases
        };
        let versions = list.keys.get(&self.versions);
        let packages = list.values.get(&self.package_versions);

        let mut best_version: Option<FindResult<'_>> = None;
        let mut deprecated: Option<FindResult<'_>> = None;
        let mut prev_package_blocked_from_age: Option<&PackageVersion> = Some(dist_result.package);

        for (&version, package) in versions.iter().zip(packages).rev() {
            if version.order(latest_version, &self.string_buf, &self.string_buf)
                == core::cmp::Ordering::Greater
            {
                continue;
            }
            if is_prerelease && before_dot(version.tag.pre.slice(&self.string_buf)) != latest_tag {
                continue;
            }

            if !package.deprecated.is_empty() {
                let found = FindResult { version, package };
                if !self.is_version_blocked_by_age_filter(found, min_age_ms, exclusions) {
                    deprecated.get_or_insert(found);
                }
                continue;
            }

            // See `search_version_list`.
            if exclusions.is_some_and(|e| e.excludes_version(self.name(), version)) {
                best_version = Some(FindResult { version, package });
                break;
            }

            if Self::is_package_version_too_recent(package, min_age_ms) {
                prev_package_blocked_from_age = Some(package);
                continue;
            }

            // stability check - if the previous package is blocked from age, we need to check if the current package wasn't the cause
            if let Some(prev_package) = prev_package_blocked_from_age {
                // only try to go backwards for a max of 7 days on top of existing minimum age
                if package.publish_timestamp_ms
                    < current_timestamp_ms - (min_age_ms + seven_days_ms)
                {
                    return FindVersionResult::FoundWithFilter {
                        result: best_version.unwrap_or(FindResult { version, package }),
                        newest_filtered: Some(dist_result.version),
                    };
                }

                let is_stable = prev_package.publish_timestamp_ms - package.publish_timestamp_ms
                    >= stability_window_ms;
                if is_stable {
                    return FindVersionResult::FoundWithFilter {
                        result: FindResult { version, package },
                        newest_filtered: Some(dist_result.version),
                    };
                }
                best_version.get_or_insert(FindResult { version, package });
                prev_package_blocked_from_age = Some(package);
                continue;
            }

            best_version = Some(FindResult { version, package });
            break;
        }

        if let Some(result) = best_version.or(deprecated) {
            return FindVersionResult::FoundWithFilter {
                result,
                newest_filtered: Some(dist_result.version),
            };
        }

        FindVersionResult::Err(FindVersionError::AllVersionsTooRecent)
    }

    pub fn find_best_version_with_filter(
        &self,
        group: &Semver::query::Group,
        group_buf: &[u8],
        minimum_release_age_ms: Option<f64>,
        exclusions: Option<&MinimumReleaseAgeExcludes>,
    ) -> FindVersionResult<'_> {
        const NOT_FOUND: FindVersionResult<'static> =
            FindVersionResult::Err(FindVersionError::NotFound);
        let Some(min_age_ms) =
            minimum_release_age_ms.filter(|_| !self.should_exclude_from_age_filter(exclusions))
        else {
            return (self.find_best_version(group, group_buf))
                .map_or(NOT_FOUND, FindVersionResult::Found);
        };
        debug_assert!(self.pkg.has_extended_manifest);

        let left = group.head.head.range.left;
        let mut newest_filtered: Option<Semver::Version> = None;

        if let Some(exact) = group.get_exact_version() {
            return match self.find_by_version(exact) {
                Some(r) if self.is_version_blocked_by_age_filter(r, min_age_ms, exclusions) => {
                    FindVersionResult::Err(FindVersionError::TooRecent)
                }
                Some(r) => FindVersionResult::Found(r),
                None => NOT_FOUND,
            };
        }

        if let Some(result) = self.find_by_dist_tag(b"latest") {
            if group.is_empty() || group.satisfies(result.version, group_buf, &self.string_buf) {
                if self.is_version_blocked_by_age_filter(result, min_age_ms, exclusions) {
                    newest_filtered = Some(result.version);
                }
                if newest_filtered.is_none()
                    && result.package.deprecated.is_empty()
                    && (!group.flags.is_set(Semver::query::Flags::PRE)
                        || left
                            .version
                            .order(result.version, group_buf, &self.string_buf)
                            == core::cmp::Ordering::Equal)
                {
                    return FindVersionResult::Found(result);
                }
            }
        }

        let mut deprecated: Option<FindResult<'_>> = None;

        let prereleases = group
            .flags
            .is_set(Semver::query::Flags::PRE)
            .then_some(self.pkg.prereleases);
        for list in [Some(self.pkg.releases), prereleases].into_iter().flatten() {
            if let Some(result) = self.search_version_list(
                list.keys.get(&self.versions),
                list.values.get(&self.package_versions),
                group,
                group_buf,
                min_age_ms,
                exclusions,
                &mut newest_filtered,
                &mut deprecated,
            ) {
                return result;
            }
        }

        if let Some(result) = deprecated {
            return FindVersionResult::FoundWithFilter {
                result,
                newest_filtered,
            };
        }

        if newest_filtered.is_some() {
            return FindVersionResult::Err(FindVersionError::AllVersionsTooRecent);
        }

        NOT_FOUND
    }

    pub fn find_best_version(
        &self,
        group: &Semver::query::Group,
        group_buf: &[u8],
    ) -> Option<FindResult<'_>> {
        let left = group.head.head.range.left;
        // Fast path: exact version
        if let Some(exact) = group.get_exact_version() {
            return self.find_by_version(exact);
        }

        // Like npm-pick-manifest, only pick a deprecated version if every match is deprecated.
        if let Some(result) = self.find_by_dist_tag(b"latest") {
            if result.package.deprecated.is_empty()
                && (group.is_empty()
                    || group.satisfies(result.version, group_buf, &self.string_buf))
                // if prerelease, use latest if semver+tag match range exactly
                && (!group.flags.is_set(Semver::query::Flags::PRE)
                    || left
                        .version
                        .order(result.version, group_buf, &self.string_buf)
                        == core::cmp::Ordering::Equal)
            {
                return Some(result);
            }
        }

        let mut deprecated: Option<FindResult<'_>> = None;
        let prereleases = group
            .flags
            .is_set(Semver::query::Flags::PRE)
            .then_some(self.pkg.prereleases);
        for list in [Some(self.pkg.releases), prereleases].into_iter().flatten() {
            // These lists are sorted at serialization time.
            let versions = list.keys.get(&self.versions);
            let packages = list.values.get(&self.package_versions);
            for (&version, package) in versions.iter().zip(packages).rev() {
                if group.satisfies(version, group_buf, &self.string_buf) {
                    let found = FindResult { version, package };
                    if package.deprecated.is_empty() {
                        return Some(found);
                    }
                    deprecated.get_or_insert(found);
                }
            }
        }

        deprecated
    }
}

// Keys are pre-hashed string hashes, so don't re-hash them.
type ExternalStringMapDeduper = HashMap<u64, ExternalStringList, IdentityContext<u64>>;

use bun_install_types::DependencyGroup;
/// Abbreviated registry metadata never carries `devDependencies` — keep this 3-wide intentionally.
const DEPENDENCY_GROUPS: [DependencyGroup; 3] = [
    DependencyGroup::DEPENDENCIES,
    DependencyGroup::OPTIONAL,
    DependencyGroup::PEER,
];

/// npm accepts both spellings. `bundleDependencies` is the documented one.
fn bundled_dependencies_field(
    version_obj: Option<&JSON::E::ObjectJSON>,
) -> Option<&JSON::E::JsonValue> {
    let version_obj = version_obj?;
    version_obj
        .get(b"bundleDependencies")
        .or_else(|| version_obj.get(b"bundledDependencies"))
}

/// `npm undeprecate` leaves `"deprecated": ""`.
fn deprecation_message(version_obj: Option<&JSON::E::ObjectJSON>) -> Option<&[u8]> {
    match version_obj?.get(b"deprecated")? {
        JSON::E::JsonValue::Boolean(true) => Some(b"true"),
        value => value.as_str().filter(|message| !message.is_empty()),
    }
}

/// Like npm: a version with no time passes minimum-release-age (0), and a time that isn't a date
/// never does.
fn publish_timestamp_ms(time: &JSON::E::JsonValue) -> f64 {
    use JSON::E::JsonValue;
    match time {
        JsonValue::Null | JsonValue::Boolean(false) => 0.0,
        JsonValue::Number(n) if n.value() == 0.0 => 0.0,
        JsonValue::String(s) if s.slice().is_empty() => 0.0,
        JsonValue::String(s) => bun_core::wtf::parse_date(s.slice()).unwrap_or(f64::INFINITY),
        _ => f64::INFINITY,
    }
}

impl PackageManifest {
    /// This parses [Abbreviated metadata](https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#abbreviated-metadata-format)
    pub fn parse(
        scope: &registry::Scope,
        log: &mut bun_ast::Log,
        json_buffer: &[u8],
        expected_name: &[u8],
        last_modified: &[u8],
        etag: &[u8],
        public_max_age: u32,
        is_extended_manifest: bool,
    ) -> Result<Option<PackageManifest>, Error> {
        // `bun_ast::Source::init_path_string` accepts borrowed `&[u8]` via
        // `IntoStr`; the Source only lives for the duration of this function,
        // so pass the caller's buffers through directly without manufacturing
        // `'static` references here (PORTING.md §Forbidden lifetime extension).
        let source = bun_ast::Source::init_path_string(expected_name, json_buffer);
        initialize_store();
        // `initialize_mini_store` deliberately keeps the allocator pushed
        // across calls (the AstAlloc state stays installed for the re-arm) and
        // bulk-frees via `reset_retain_with_limit` on the next call — see
        // `initialize_mini_store` in lib.rs for why.
        let parsed = match JSON::ParsedJson::parse_npm_manifest(&source, log) {
            Ok(j) => j,
            Err(_) => {
                let mut cloned_log = bun_ast::Log::init();
                log.clone_to_with_recycled(&mut cloned_log, true);
                *log = cloned_log;
                return Ok(None);
            }
        };
        let json = parsed.root;

        if let Some(error_q) = json.as_property(b"error") {
            if let Some(err) = error_q.expr.as_utf8_string_literal() {
                log.add_error_fmt(
                    Some(&source),
                    bun_ast::Loc::EMPTY,
                    format_args!("npm error: {}", bun_fmt::escape_control_chars(err)),
                );
                return Ok(None);
            }
        }

        // For cache determinism the serialized `NpmPackage` has explicit
        // `_padding_*` fields zeroed by `Default`, so plain `default()` is
        // already deterministic here.
        let mut result: PackageManifest = PackageManifest::default();

        let mut all_extern_strings_dedupe_map = ExternalStringMapDeduper::default();
        let mut version_extern_strings_dedupe_map = ExternalStringMapDeduper::default();
        let mut optional_peer_dep_names: Vec<u64> = Vec::new();

        let mut bundled_deps_count: usize = 0;

        let mut string_builder = Semver::semver_string::Builder {
            string_pool: Semver::semver_string::StringPool::default(),
            ..Default::default()
        };

        if PackageManager::verbose_install() {
            if let Some(name_q) = json.as_property(b"name") {
                let Some(received_name) = name_q.expr.as_utf8_string_literal() else {
                    return Ok(None);
                };
                // If this manifest is coming from the default registry, make sure it's the expected one. If it's not
                // from the default registry we don't check because the registry might have a different name in the manifest.
                // https://github.com/oven-sh/bun/issues/4925
                if scope.url_hash == *registry::DEFAULT_URL_HASH
                    && !strings::eql_long(expected_name, received_name, true)
                {
                    bun_core::warn!(
                        "Package name mismatch. Expected <b>\"{}\"<r> but received <red>\"{}\"<r>",
                        bstr::BStr::new(expected_name),
                        bun_fmt::escape_control_chars(received_name),
                    );
                }
            }
        }

        string_builder.count(expected_name);

        if let Some(name_q) = json.as_property(b"modified") {
            let Some(field) = name_q.expr.as_utf8_string_literal() else {
                return Ok(None);
            };
            string_builder.count(field);
        }

        let mut release_versions_len: usize = 0;
        let mut pre_versions_len: usize = 0;
        let mut dependency_sum: usize = 0;
        let mut extern_string_count: usize = 0;
        let mut extern_string_count_bin: usize = 0;
        let mut tarball_urls_count: usize = 0;
        'get_versions: {
            let Some(versions_expr) = json.get(b"versions") else {
                break 'get_versions;
            };
            let JSON::ExprData::EObjectJSON(versions_obj) = &versions_expr.data else {
                break 'get_versions;
            };

            let versions = versions_obj.get().properties();
            // A package that deprecates many versions repeats the same sentence, so it's stored
            // once per run of equal messages.
            let mut prev_deprecated: &[u8] = b"";
            for prop in versions {
                let version_name = prop.key.slice();
                let sliced_version = SlicedString::init(version_name, version_name);
                let parsed_version = Semver::Version::parse(sliced_version);

                if !parsed_version.valid {
                    // Not an error: an error fails the install. npm skips such a key in silence.
                    if PackageManager::verbose_install() {
                        log.add_warning_fmt(
                            Some(&source),
                            prop.key_loc,
                            format_args!(
                                "Skipping version {} of {}: not a valid semver version",
                                bun_fmt::EscapeControlChars(bun_fmt::quote(version_name)),
                                bun_fmt::quote(expected_name),
                            ),
                        );
                    }
                    continue;
                }

                if parsed_version.version.tag.has_pre() {
                    pre_versions_len += 1;
                    extern_string_count += 1;
                } else {
                    extern_string_count +=
                        (strings::index_of_char(version_name, b'+').is_some()) as usize;
                    release_versions_len += 1;
                }

                string_builder.count(version_name);

                let version_obj = prop.value.as_object();

                if let Some(tarball) = version_obj
                    .and_then(|o| o.get(b"dist"))
                    .and_then(|dist| dist.as_object())
                    .and_then(|dist| dist.get(b"tarball"))
                    .and_then(|tarball| tarball.as_str())
                {
                    string_builder.count(tarball);
                    tarball_urls_count += (!tarball.is_empty()) as usize;
                }

                if let Some(message) = deprecation_message(version_obj) {
                    if message != prev_deprecated {
                        string_builder.count(message);
                        prev_deprecated = message;
                    }
                }

                'bin: {
                    if let Some(bin) = version_obj.and_then(|o| o.get(b"bin")) {
                        match bin {
                            JSON::E::JsonValue::Object(obj) => {
                                let mut entries: usize = 0;
                                for bin_prop in obj.get().properties() {
                                    let Some(v) = bin_prop.value.as_str() else {
                                        continue;
                                    };
                                    string_builder.count(bin_prop.key.slice());
                                    string_builder.count(v);
                                    entries += 1;
                                }
                                if entries > 1 {
                                    extern_string_count_bin += entries * 2;
                                }
                                break 'bin;
                            }
                            JSON::E::JsonValue::String(str_) => {
                                // The build pass reads `directories.bin` when `bin` is empty.
                                let str_ = str_.slice();
                                if !str_.is_empty() {
                                    string_builder.count(str_);
                                    break 'bin;
                                }
                            }
                            _ => {}
                        }
                    }

                    if let Some(str_) = version_obj
                        .and_then(|o| o.get(b"directories"))
                        .and_then(|dirs| dirs.as_object())
                        .and_then(|dirs| dirs.get(b"bin"))
                        .and_then(|bin| bin.as_str())
                    {
                        string_builder.count(str_);
                        break 'bin;
                    }
                }

                if let Some(JSON::E::JsonValue::Array(arr)) =
                    bundled_dependencies_field(version_obj)
                {
                    bundled_deps_count += arr
                        .get()
                        .items()
                        .iter()
                        .filter(|bundled_dep| bundled_dep.as_str().is_some())
                        .count();
                }

                for pair in &DEPENDENCY_GROUPS {
                    if let Some(obj) = version_obj
                        .and_then(|o| o.get(pair.prop))
                        .and_then(|deps| deps.as_object())
                    {
                        let properties = obj.properties();
                        dependency_sum += properties.len();
                        for property in properties {
                            let key = property.key.slice();
                            string_builder.count(key);
                            string_builder.count(property.value.as_str().unwrap_or(b""));
                        }
                    }
                }

                // pnpm/yarn synthesise an implicit `"*"` optional peer for
                // entries that appear in `peerDependenciesMeta` but not in
                // `peerDependencies`. Reserve space for them; the build
                // pass below appends them after the declared peer deps.
                if let Some(obj) = version_obj
                    .and_then(|o| o.get(b"peerDependenciesMeta"))
                    .and_then(|meta| meta.as_object())
                {
                    for meta_prop in obj.properties() {
                        let Some(optional) = meta_prop
                            .value
                            .as_object()
                            .and_then(|meta| meta.get(b"optional"))
                        else {
                            continue;
                        };
                        let JSON::E::JsonValue::Boolean(true) = optional else {
                            continue;
                        };
                        dependency_sum += 1;
                        string_builder.count(meta_prop.key.slice());
                        string_builder.count(b"*");
                    }
                }
            }
        }

        extern_string_count += dependency_sum;

        let mut dist_tags_count: usize = 0;
        if let Some(dist) = json.get(b"dist-tags") {
            if let JSON::ExprData::EObjectJSON(obj) = &dist.data {
                for tag in obj.get().properties() {
                    string_builder.count(tag.key.slice());
                    extern_string_count += 2;

                    string_builder.count(tag.value.as_str().unwrap_or(b""));
                    dist_tags_count += 1;
                }
            }
        }

        if !last_modified.is_empty() {
            string_builder.count(last_modified);
        }

        if !etag.is_empty() {
            string_builder.count(etag);
        }

        let mut versioned_packages: Box<[PackageVersion]> =
            vec![PackageVersion::default(); release_versions_len + pre_versions_len]
                .into_boxed_slice();
        let mut all_semver_versions: Box<[Semver::Version]> =
            vec![
                Semver::Version::default();
                release_versions_len + pre_versions_len + dist_tags_count
            ]
            .into_boxed_slice();
        let mut all_extern_strings: Box<[ExternalString]> =
            vec![ExternalString::default(); extern_string_count + tarball_urls_count]
                .into_boxed_slice();
        let mut version_extern_strings: Box<[ExternalString]> =
            vec![ExternalString::default(); dependency_sum].into_boxed_slice();
        let mut all_extern_strings_bin_entries: Box<[ExternalString]> =
            vec![ExternalString::default(); extern_string_count_bin].into_boxed_slice();
        let mut all_tarball_url_strings: Box<[ExternalString]> =
            vec![ExternalString::default(); tarball_urls_count].into_boxed_slice();
        let mut bundled_deps_buf: Box<[PackageNameHash]> =
            vec![PackageNameHash::default(); bundled_deps_count].into_boxed_slice();
        let mut bundled_deps_offset: usize = 0;

        // Default::default() above zeroes the buffers for determinism.

        // Index cursors are used instead of overlapping mutable subslices into
        // the same allocation; re-slice on demand.
        let mut versioned_package_releases_start: usize = 0;
        let all_versioned_package_releases_range = 0..release_versions_len;
        let mut versioned_package_prereleases_start: usize = release_versions_len;
        let all_versioned_package_prereleases_range =
            release_versions_len..release_versions_len + pre_versions_len;

        // all_semver_versions layout: [releases | prereleases | dist_tags]
        let all_release_versions_range = 0..release_versions_len;
        let all_prerelease_versions_range =
            release_versions_len..release_versions_len + pre_versions_len;
        let dist_tag_versions_start = release_versions_len + pre_versions_len;
        let mut release_versions_cursor: usize = 0;
        let mut prerelease_versions_cursor: usize = release_versions_len;

        let mut extern_strings_bin_entries_cursor: usize = 0;
        let mut tarball_url_strings_cursor: usize = 0;

        let mut extern_strings_consumed: usize = 0; // tracks `all_extern_strings.len - extern_strings.len`
        string_builder.cap += (string_builder.cap % 64) + 64;
        string_builder.cap *= 2;

        string_builder.allocate()?;

        // `Builder::allocate` produces a zeroed `Box<[u8]>` for determinism.
        //
        // A single `&[u8]` over the builder's backing allocation held across
        // the `&mut self` borrows taken by every `append` below would be
        // Stacked Borrows UB (even though the allocation never moves). Instead
        // we re-borrow `string_builder.allocated_slice()` at each read site —
        // `Builder::append*` only writes in-place and never grows/replaces
        // `ptr`, so the slice contents are stable, and NLL releases each
        // short-lived borrow before the next `append`.

        // Using `expected_name` instead of the name from the manifest. Custom registries might
        // have a different name than the dependency name in package.json.
        result.pkg.name = string_builder.append::<ExternalString>(expected_name);

        // Cursors into all_extern_strings / version_extern_strings for dependency name/value writes.
        let mut dependency_names_cursor: usize = 0; // into all_extern_strings[0..dependency_sum]
        let mut dependency_values_cursor: usize = 0; // into version_extern_strings

        'get_versions2: {
            let Some(versions_expr) = json.get(b"versions") else {
                break 'get_versions2;
            };
            let JSON::ExprData::EObjectJSON(versions_obj) = &versions_expr.data else {
                break 'get_versions2;
            };

            let versions = versions_obj.get().properties();

            // versions change more often than names
            // so names go last because we are better able to dedupe at the end
            let mut prev_extern_bin_group: Option<core::ops::Range<usize>> = None;
            let mut prev_deprecated: (&[u8], SemverString) = (b"", SemverString::default());
            let empty_version = PackageVersion {
                bin: Bin::init(),
                ..PackageVersion::default()
            };
            // PackageVersion's explicit `_padding_*` fields are zeroed by
            // `Default`, so no separate padding scrub is needed.

            // Index the root `time` object once so the per-version publish-time
            // lookup below is O(1) instead of a linear scan of ~V entries.
            let time_obj = json.get(b"time").and_then(|e| match e.data {
                JSON::ExprData::EObjectJSON(obj) => Some(obj),
                _ => None,
            });
            let time_props: &[JSON::E::PropertyJSON] = time_obj
                .as_ref()
                .map(|o| o.get().properties())
                .unwrap_or(&[]);
            let mut time_index: HashMap<u64, u32, IdentityContext<u64>> = HashMap::default();
            if !time_props.is_empty() {
                time_index.ensure_total_capacity(time_props.len())?;
                for (i, p) in time_props.iter().enumerate() {
                    let gop = time_index.get_or_put(Wyhash11::hash(0, p.key.slice()))?;
                    if !gop.found_existing {
                        *gop.value_ptr = i as u32;
                    }
                }
            }

            for prop in versions {
                let version_name = prop.key.slice();
                let mut sliced_version = SlicedString::init(version_name, version_name);
                let mut parsed_version = Semver::Version::parse(sliced_version);

                if !parsed_version.valid {
                    continue;
                }
                // We only need to copy the version tags if it contains pre and/or build
                if parsed_version.version.tag.has_build() || parsed_version.version.tag.has_pre() {
                    let version_string = string_builder.append::<SemverString>(version_name);
                    sliced_version = version_string.sliced(string_builder.allocated_slice());
                    parsed_version = Semver::Version::parse(sliced_version);
                    debug_assert!(parsed_version.valid);
                    debug_assert!(
                        parsed_version.version.tag.has_build()
                            || parsed_version.version.tag.has_pre()
                    );
                }

                let version_obj = prop.value.as_object();

                let mut package_version: PackageVersion = empty_version;

                // `Package::from_npm` matches these against the dependencies of every group.
                package_version.bundled_dependencies = match bundled_dependencies_field(version_obj)
                {
                    Some(JSON::E::JsonValue::Boolean(true)) => ExternalPackageNameHashList::INVALID,
                    Some(JSON::E::JsonValue::Array(arr)) => {
                        let bundled_deps_begin = bundled_deps_offset;
                        for bundled_dep in arr.get().items() {
                            let Some(name) = bundled_dep.as_str() else {
                                continue;
                            };
                            bundled_deps_buf[bundled_deps_offset] =
                                Semver::semver_string::Builder::string_hash(name);
                            bundled_deps_offset += 1;
                        }
                        ExternalPackageNameHashList::init(
                            &bundled_deps_buf,
                            &bundled_deps_buf[bundled_deps_begin..bundled_deps_offset],
                        )
                    }
                    _ => ExternalPackageNameHashList::default(),
                };

                if let Some(cpu) = version_obj.and_then(|o| o.get(b"cpu")) {
                    package_version.cpu = negatable_from_json_value::<Architecture>(cpu);
                }

                if let Some(os) = version_obj.and_then(|o| o.get(b"os")) {
                    package_version.os = negatable_from_json_value::<OperatingSystem>(os);
                }

                if let Some(libc) = version_obj.and_then(|o| o.get(b"libc")) {
                    package_version.libc = negatable_from_json_value::<Libc>(libc);
                }

                if let Some(JSON::E::JsonValue::Boolean(val)) =
                    version_obj.and_then(|o| o.get(b"hasInstallScript"))
                {
                    package_version.has_install_script = *val;
                } else if let Some(scripts) = version_obj
                    .and_then(|o| o.get(b"scripts"))
                    .and_then(|scripts| scripts.as_object())
                {
                    // The full manifest has `scripts` instead of the field. The registry and npm
                    // derive the field from them in the same way.
                    package_version.has_install_script =
                        [&b"preinstall"[..], b"install", b"postinstall"]
                            .iter()
                            .filter_map(|name| scripts.get(name)?.as_str())
                            .any(|script| !script.is_empty());
                }

                if let Some(message) = deprecation_message(version_obj) {
                    if message != prev_deprecated.0 {
                        prev_deprecated = (message, string_builder.append::<SemverString>(message));
                    }
                    package_version.deprecated = prev_deprecated.1;
                }

                'bin: {
                    // bins are extremely repetitive
                    // We try to avoid storing copies the string
                    if let Some(bin) = version_obj.and_then(|o| o.get(b"bin")) {
                        match bin {
                            JSON::E::JsonValue::Object(obj) => {
                                // npm (normalize-package-bin) skips a value that is not a string.
                                let mut entries = obj
                                    .get()
                                    .properties()
                                    .iter()
                                    .filter_map(|p| Some((p.key.slice(), p.value.as_str()?)));
                                match entries.clone().count() {
                                    0 => {}
                                    1 => {
                                        let (bin_name, value) =
                                            entries.next().expect("counted: one entry");

                                        package_version.bin = Bin {
                                            tag: bin::Tag::NamedFile,
                                            _padding_tag: [0; 3],
                                            value: bin::Value::init_named_file([
                                                string_builder.append::<SemverString>(bin_name),
                                                string_builder.append::<SemverString>(value),
                                            ]),
                                        };
                                    }
                                    len => {
                                        let group_start = extern_strings_bin_entries_cursor;
                                        let group_len = len * 2;

                                        let mut is_identical = match &prev_extern_bin_group {
                                            Some(r) => r.len() == group_len,
                                            None => false,
                                        };

                                        // The boxed slice is fully initialised
                                        // (`vec![Default; n].into_boxed_slice()` in the counting
                                        // pass) and `ExternalString: Copy`, so plain absolute
                                        // indexing at `group_start + group_i` works — no
                                        // `from_raw_parts`/`.add()` needed, and the `prev` read
                                        // at a disjoint index needs no split.
                                        for (group_i, s) in
                                            entries.flat_map(|(k, v)| [k, v]).enumerate()
                                        {
                                            let cur = string_builder.append::<ExternalString>(s);
                                            all_extern_strings_bin_entries[group_start + group_i] =
                                                cur;
                                            if is_identical {
                                                let prev = prev_extern_bin_group.as_ref().unwrap();
                                                let prev_item = all_extern_strings_bin_entries
                                                    [prev.start + group_i];
                                                is_identical = cur.hash == prev_item.hash;
                                            }
                                        }

                                        let final_range = if is_identical {
                                            prev_extern_bin_group.clone().unwrap()
                                        } else {
                                            let r = group_start..group_start + group_len;
                                            prev_extern_bin_group = Some(r.clone());
                                            extern_strings_bin_entries_cursor += group_len;
                                            r
                                        };

                                        package_version.bin = Bin {
                                            tag: bin::Tag::Map,
                                            _padding_tag: [0; 3],
                                            value: bin::Value::init_map(ExternalStringList::init(
                                                &all_extern_strings_bin_entries,
                                                &all_extern_strings_bin_entries[final_range],
                                            )),
                                        };
                                    }
                                }

                                break 'bin;
                            }
                            JSON::E::JsonValue::String(stri) => {
                                let stri = stri.slice();
                                if !stri.is_empty() {
                                    package_version.bin = Bin {
                                        tag: bin::Tag::File,
                                        _padding_tag: [0; 3],
                                        value: bin::Value::init_file(
                                            string_builder.append::<SemverString>(stri),
                                        ),
                                    };
                                    break 'bin;
                                }
                            }
                            _ => {}
                        }
                    }

                    // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#directoriesbin
                    // Because of the way the bin directive works,
                    // specifying both a bin path and setting
                    // directories.bin is an error. If you want to
                    // specify individual files, use bin, and for all
                    // the files in an existing bin directory, use
                    // directories.bin.
                    if let Some(str_) = version_obj
                        .and_then(|o| o.get(b"directories"))
                        .and_then(|dirs| dirs.as_object())
                        .and_then(|dirs| dirs.get(b"bin"))
                        .and_then(|bin| bin.as_str())
                    {
                        if !str_.is_empty() {
                            package_version.bin = Bin {
                                tag: bin::Tag::Dir,
                                _padding_tag: [0; 3],
                                value: bin::Value::init_dir(
                                    string_builder.append::<SemverString>(str_),
                                ),
                            };
                            break 'bin;
                        }
                    }
                }

                'integrity: {
                    if let Some(dist) = version_obj
                        .and_then(|o| o.get(b"dist"))
                        .and_then(|dist| dist.as_object())
                    {
                        if let Some(tarball) = dist.get(b"tarball").and_then(|t| t.as_str()) {
                            if !tarball.is_empty() {
                                package_version.tarball_url =
                                    string_builder.append::<ExternalString>(tarball);
                                all_tarball_url_strings[tarball_url_strings_cursor] =
                                    package_version.tarball_url;
                                tarball_url_strings_cursor += 1;
                            }
                        }

                        if let Some(JSON::E::JsonValue::Number(n)) = dist.get(b"fileCount") {
                            package_version.file_count = n.value() as u32;
                        }

                        if let Some(JSON::E::JsonValue::Number(n)) = dist.get(b"unpackedSize") {
                            package_version.unpacked_size = n.value() as u32;
                        }

                        let mut malformed = false;
                        if let Some(shasum_str) = dist.get(b"integrity").and_then(|v| v.as_str()) {
                            package_version.integrity = Integrity::parse(shasum_str);
                            if package_version.integrity.tag.is_supported() {
                                break 'integrity;
                            }
                            malformed = !shasum_str.is_empty();
                        }

                        if let Some(shasum_str) = dist.get(b"shasum").and_then(|v| v.as_str()) {
                            match Integrity::parse_sha_sum(shasum_str) {
                                Ok(integrity) if integrity.tag.is_supported() => {
                                    package_version.integrity = integrity;
                                    break 'integrity;
                                }
                                Ok(_) => {}
                                Err(_) => malformed = true,
                            }
                        }

                        if malformed {
                            log.add_warning_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "Unsupported or malformed integrity hash in registry metadata for {}@{}, tarball will not be verified",
                                    bstr::BStr::new(expected_name),
                                    bun_fmt::escape_control_chars(version_name),
                                ),
                            );
                        }
                    }
                }

                let mut non_optional_peer_dependency_offset: usize = 0;

                for (group_idx, pair) in DEPENDENCY_GROUPS.iter().enumerate() {
                    let is_peer = pair.prop == b"peerDependencies";
                    // For peer deps, fall through with an empty `items`
                    // slice when `peerDependencies` is absent so that
                    // `peerDependenciesMeta`-only entries (synthesised
                    // below) still get a build pass.
                    let items: &[JSON::E::PropertyJSON] = version_obj
                        .and_then(|o| o.get(pair.prop))
                        .and_then(|deps| deps.as_object())
                        .map(JSON::E::ObjectJSON::properties)
                        .unwrap_or(&[]);
                    let peer_deps_meta: Option<&JSON::E::ObjectJSON> = if is_peer {
                        version_obj
                            .and_then(|o| o.get(b"peerDependenciesMeta"))
                            .and_then(|meta| meta.as_object())
                    } else {
                        None
                    };
                    let has_meta_only_peers =
                        peer_deps_meta.is_some_and(|meta| !meta.properties().is_empty());
                    if items.len() > 0 || has_meta_only_peers {
                        // reshaped for borrowck — index into all_extern_strings / version_extern_strings
                        let names_base = dependency_names_cursor;
                        let values_base = dependency_values_cursor;

                        let mut name_hasher = Wyhash11::init(0);
                        let mut version_hasher = Wyhash11::init(0);

                        if is_peer {
                            optional_peer_dep_names.clear();

                            if let Some(meta) = peer_deps_meta {
                                let meta_props = meta.properties();
                                optional_peer_dep_names.reserve(meta_props.len());
                                for meta_prop in meta_props {
                                    if let Some(optional) = meta_prop
                                        .value
                                        .as_object()
                                        .and_then(|meta| meta.get(b"optional"))
                                    {
                                        let JSON::E::JsonValue::Boolean(true) = optional else {
                                            continue;
                                        };

                                        optional_peer_dep_names.push(
                                            Semver::semver_string::Builder::string_hash(
                                                meta_prop.key.slice(),
                                            ),
                                        );
                                    }
                                }
                            }
                        }

                        let mut i: usize = 0;

                        for item in items {
                            let name_str = item.key.slice();
                            let Some(version_str) = item.value.as_str() else {
                                continue;
                            };

                            all_extern_strings[names_base + i] =
                                string_builder.append::<ExternalString>(name_str);
                            version_extern_strings[values_base + i] =
                                string_builder.append::<ExternalString>(version_str);

                            if is_peer {
                                if optional_peer_dep_names
                                    .iter()
                                    .any(|h| *h == all_extern_strings[names_base + i].hash)
                                {
                                    // For optional peer dependencies, we store a length instead of a whole separate array
                                    // To make that work, we have to move optional peer dependencies to the front of the array
                                    //
                                    if non_optional_peer_dependency_offset != i {
                                        all_extern_strings.swap(
                                            names_base + i,
                                            names_base + non_optional_peer_dependency_offset,
                                        );
                                        version_extern_strings.swap(
                                            values_base + i,
                                            values_base + non_optional_peer_dependency_offset,
                                        );
                                    }

                                    non_optional_peer_dependency_offset += 1;
                                }

                                if optional_peer_dep_names.is_empty() {
                                    let names_hash_bytes =
                                        all_extern_strings[names_base + i].hash.to_ne_bytes();
                                    name_hasher.update(&names_hash_bytes);
                                    let versions_hash_bytes =
                                        version_extern_strings[values_base + i].hash.to_ne_bytes();
                                    version_hasher.update(&versions_hash_bytes);
                                }
                            } else {
                                let names_hash_bytes =
                                    all_extern_strings[names_base + i].hash.to_ne_bytes();
                                name_hasher.update(&names_hash_bytes);
                                let versions_hash_bytes =
                                    version_extern_strings[values_base + i].hash.to_ne_bytes();
                                version_hasher.update(&versions_hash_bytes);
                            }

                            i += 1;
                        }

                        if is_peer {
                            // Append meta-only optional peers (declared
                            // in `peerDependenciesMeta` but not in
                            // `peerDependencies`) as `"*"` versions.
                            // pnpm/yarn do this; webpack relies on it
                            // to make `webpack-cli` reachable.
                            if let Some(meta) = peer_deps_meta {
                                'outer: for meta_prop in meta.properties() {
                                    let Some(optional) = meta_prop
                                        .value
                                        .as_object()
                                        .and_then(|meta| meta.get(b"optional"))
                                    else {
                                        continue;
                                    };
                                    let JSON::E::JsonValue::Boolean(true) = optional else {
                                        continue;
                                    };
                                    let meta_key = meta_prop.key.slice();
                                    let meta_hash =
                                        Semver::semver_string::Builder::string_hash(meta_key);
                                    for existing in &all_extern_strings[names_base..names_base + i]
                                    {
                                        if existing.hash == meta_hash {
                                            continue 'outer;
                                        }
                                    }
                                    all_extern_strings[names_base + i] =
                                        string_builder.append::<ExternalString>(meta_key);
                                    version_extern_strings[values_base + i] =
                                        string_builder.append::<ExternalString>(b"*");
                                    if non_optional_peer_dependency_offset != i {
                                        all_extern_strings.swap(
                                            names_base + i,
                                            names_base + non_optional_peer_dependency_offset,
                                        );
                                        version_extern_strings.swap(
                                            values_base + i,
                                            values_base + non_optional_peer_dependency_offset,
                                        );
                                    }
                                    non_optional_peer_dependency_offset += 1;
                                    i += 1;
                                }
                            }
                        }

                        let count = i;
                        // The peer slice was over-reserved by the
                        // number of `peerDependenciesMeta` entries (so
                        // meta-only synthesised peers had room); trim
                        // to what was actually written before the
                        // ExternalStringList offsets are computed.
                        let this_names = &all_extern_strings[names_base..names_base + count];
                        let this_versions =
                            &version_extern_strings[values_base..values_base + count];

                        let mut name_list =
                            ExternalStringList::init(&all_extern_strings, this_names);
                        let mut version_list =
                            ExternalStringList::init(&version_extern_strings, this_versions);

                        if is_peer {
                            package_version.non_optional_peer_dependencies_start =
                                non_optional_peer_dependency_offset as u32;
                        }

                        if count > 0 && (!is_peer || optional_peer_dep_names.is_empty()) {
                            let name_map_hash = name_hasher.final_();
                            let version_map_hash = version_hasher.final_();

                            let name_entry =
                                all_extern_strings_dedupe_map.get_or_put(name_map_hash)?;
                            if name_entry.found_existing {
                                name_list = *name_entry.value_ptr;
                            } else {
                                *name_entry.value_ptr = name_list;
                                dependency_names_cursor += count;
                            }

                            let version_entry =
                                version_extern_strings_dedupe_map.get_or_put(version_map_hash)?;
                            if version_entry.found_existing {
                                version_list = *version_entry.value_ptr;
                            } else {
                                *version_entry.value_ptr = version_list;
                                dependency_values_cursor += count;
                            }
                        }

                        if is_peer && !optional_peer_dep_names.is_empty() {
                            dependency_names_cursor += count;
                            dependency_values_cursor += count;
                        }

                        let map = ExternalStringMap {
                            name: name_list,
                            value: version_list,
                        };
                        match group_idx {
                            0 => package_version.dependencies = map,
                            1 => package_version.optional_dependencies = map,
                            2 => package_version.peer_dependencies = map,
                            _ => unreachable!("DEPENDENCY_GROUPS has 3 entries"),
                        }
                    }
                }

                if let Some(&i) = time_index.get(&Wyhash11::hash(0, version_name)) {
                    let indexed = &time_props[i as usize];
                    let entry = if indexed.key.slice() == version_name {
                        Some(indexed)
                    } else {
                        // Hash collision: fall back to a linear scan so the
                        // result matches the previous `ObjectJSON::get` exactly.
                        time_props.iter().find(|p| p.key.slice() == version_name)
                    };
                    if let Some(entry) = entry {
                        package_version.publish_timestamp_ms = publish_timestamp_ms(&entry.value);
                    }
                }

                if !parsed_version.version.tag.has_pre() {
                    all_semver_versions[release_versions_cursor] = parsed_version.version.min();
                    versioned_packages[versioned_package_releases_start] = package_version;
                    release_versions_cursor += 1;
                    versioned_package_releases_start += 1;
                } else {
                    all_semver_versions[prerelease_versions_cursor] = parsed_version.version.min();
                    versioned_packages[versioned_package_prereleases_start] = package_version;
                    prerelease_versions_cursor += 1;
                    versioned_package_prereleases_start += 1;
                }
            }

            extern_strings_consumed = dependency_names_cursor;
            // version_extern_strings trimmed below
        }
        let version_extern_strings_len = dependency_values_cursor;

        let mut extern_strings_cursor = extern_strings_consumed;

        if let Some(dist) = json.get(b"dist-tags") {
            if let JSON::ExprData::EObjectJSON(obj) = &dist.data {
                let tags = obj.get().properties();
                let extern_strings_slice_start = extern_strings_cursor;
                let mut dist_tag_i: usize = 0;

                for tag in tags {
                    all_extern_strings[extern_strings_slice_start + dist_tag_i] =
                        string_builder.append::<ExternalString>(tag.key.slice());

                    let Some(version_name) = tag.value.as_str() else {
                        continue;
                    };

                    let dist_tag_value_literal =
                        string_builder.append::<ExternalString>(version_name);

                    let sliced_string = dist_tag_value_literal
                        .value
                        .sliced(string_builder.allocated_slice());

                    all_semver_versions[dist_tag_versions_start + dist_tag_i] =
                        Semver::Version::parse(sliced_string).version.min();
                    dist_tag_i += 1;
                }

                result.pkg.dist_tags = DistTagMap {
                    tags: ExternalStringList::init(
                        &all_extern_strings,
                        &all_extern_strings
                            [extern_strings_slice_start..extern_strings_slice_start + dist_tag_i],
                    ),
                    versions: VersionSlice::init(
                        &all_semver_versions,
                        &all_semver_versions
                            [dist_tag_versions_start..dist_tag_versions_start + dist_tag_i],
                    ),
                };

                extern_strings_cursor += dist_tag_i;
            }
        }

        if !last_modified.is_empty() {
            result.pkg.last_modified = string_builder.append::<SemverString>(last_modified);
        }

        if !etag.is_empty() {
            result.pkg.etag = string_builder.append::<SemverString>(etag);
        }

        if let Some(name_q) = json.as_property(b"modified") {
            let Some(field) = name_q.expr.as_utf8_string_literal() else {
                return Ok(None);
            };
            result.pkg.modified = string_builder.append::<SemverString>(field);
        }

        result.pkg.releases.keys = VersionSlice::init(
            &all_semver_versions,
            &all_semver_versions[all_release_versions_range.clone()],
        );
        result.pkg.releases.values = PackageVersionList::init(
            &versioned_packages,
            &versioned_packages[all_versioned_package_releases_range],
        );

        result.pkg.prereleases.keys = VersionSlice::init(
            &all_semver_versions,
            &all_semver_versions[all_prerelease_versions_range.clone()],
        );
        result.pkg.prereleases.values = PackageVersionList::init(
            &versioned_packages,
            &versioned_packages[all_versioned_package_prereleases_range],
        );

        let max_versions_count = all_release_versions_range
            .len()
            .max(all_prerelease_versions_range.len());

        // Sort the list of packages in a deterministic order
        // Usually, npm will do this for us.
        // But, not always.
        // See https://github.com/oven-sh/bun/pull/6611
        //
        // The tricky part about this code is we need to sort two different arrays.
        // To do that, we create a 3rd array, containing indices into the other 2 arrays.
        {
            let mut all_indices: Vec<u32> = vec![0; max_versions_count];
            let mut all_cloned_versions: Vec<Semver::Version> =
                vec![Semver::Version::default(); max_versions_count];
            let mut all_cloned_packages: Vec<PackageVersion> =
                vec![PackageVersion::default(); max_versions_count];

            let releases_list = [result.pkg.releases, result.pkg.prereleases];

            for release_i in 0..2usize {
                let release = releases_list[release_i];
                let len = release.keys.len as usize;
                let indices = &mut all_indices[..len];
                let cloned_packages = &mut all_cloned_packages[..len];
                let cloned_versions = &mut all_cloned_versions[..len];
                // `ExternalSlice` offsets index into `versioned_packages` /
                // `all_semver_versions`, both fully-initialised `Box<[T]>`s
                // (created via `vec![Default; n].into_boxed_slice()` above),
                // so safe slice indexing suffices. The two boxes are
                // distinct allocations so the two `&mut` borrows do not
                // overlap.
                let versioned_packages_ =
                    &mut versioned_packages[release.values.off as usize..][..len];
                let semver_versions_ = &mut all_semver_versions[release.keys.off as usize..][..len];
                cloned_packages.copy_from_slice(versioned_packages_);
                cloned_versions.copy_from_slice(semver_versions_);

                for (i, dest) in indices.iter_mut().enumerate() {
                    *dest = i as u32;
                }

                let string_bytes = string_builder.allocated_slice();
                index_sort::sort_indices(indices, &mut |left, right| {
                    cloned_versions[left as usize].order(
                        cloned_versions[right as usize],
                        string_bytes,
                        string_bytes,
                    )
                });
                debug_assert_eq!(indices.len(), versioned_packages_.len());
                debug_assert_eq!(indices.len(), semver_versions_.len());
                for ((i, pkg), version) in indices
                    .iter()
                    .copied()
                    .zip(versioned_packages_.iter_mut())
                    .zip(semver_versions_.iter_mut())
                {
                    *pkg = cloned_packages[i as usize];
                    *version = cloned_versions[i as usize];
                }

                if cfg!(debug_assertions) {
                    if cloned_versions.len() > 1 {
                        // Sanity check:
                        // When reading the versions, we iterate through the
                        // list backwards to choose the highest matching
                        // version. Two keys can name one version ("1.0.0" and
                        // "01.0.0"), so neighbours can be equal.
                        let first = semver_versions_[0];
                        let second = semver_versions_[1];
                        let order = second.order(first, string_bytes, string_bytes);
                        debug_assert!(order != core::cmp::Ordering::Less);
                    }
                }
            }
        }

        let extern_strings_remaining = all_extern_strings.len() - extern_strings_cursor;
        if extern_strings_remaining + tarball_urls_count > 0 {
            let src_len = tarball_url_strings_cursor;
            if src_len > 0 {
                // `ExternalString` is `Copy` POD — an element-wise
                // `copy_from_slice` suffices.
                debug_assert!(all_extern_strings.len() - extern_strings_cursor >= src_len);
                all_extern_strings[extern_strings_cursor..extern_strings_cursor + src_len]
                    .copy_from_slice(&all_tarball_url_strings[..src_len]);
            }

            // all_extern_strings = all_extern_strings[0 .. len - extern_strings_remaining]
            // trim by truncating the boxed slice via Vec round-trip
            let new_len = all_extern_strings.len() - extern_strings_remaining;
            let mut v = core::mem::take(&mut all_extern_strings).into_vec();
            v.truncate(new_len);
            all_extern_strings = v.into_boxed_slice();
        }

        result.pkg.string_lists_buf.off = 0;
        result.pkg.string_lists_buf.len = all_extern_strings.len() as u32;

        result.pkg.versions_buf.off = 0;
        result.pkg.versions_buf.len = all_semver_versions.len() as u32;

        result.versions = all_semver_versions;
        result.external_strings = all_extern_strings;
        result.external_strings_for_versions = {
            let mut v = version_extern_strings.into_vec();
            v.truncate(version_extern_strings_len);
            v.into_boxed_slice()
        };
        result.package_versions = versioned_packages;
        result.extern_strings_bin_entries = {
            let mut v = all_extern_strings_bin_entries.into_vec();
            v.truncate(extern_strings_bin_entries_cursor);
            v.into_boxed_slice()
        };
        result.bundled_deps_buf = bundled_deps_buf;
        result.pkg.public_max_age = public_max_age;
        result.pkg.has_extended_manifest = is_extended_manifest;

        if let Some(buf) = string_builder.ptr.take() {
            let mut v = buf.into_vec();
            v.truncate(string_builder.len);
            result.string_buf = v.into_boxed_slice();
        }

        Ok(Some(result))
    }
}
