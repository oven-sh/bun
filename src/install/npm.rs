use core::ffi::c_void;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_collections::{HashMap, IdentityContext, ObjectPool, StringSet};
use bun_core::{err, fmt as bun_fmt, Error, Global, Output};
use bun_dotenv::EnvLoader as DotEnv;
use bun_http::{self as http, AsyncHTTP, HeaderBuilder, HTTPClient};
use bun_json as JSON;
use bun_logger as logger;
use bun_picohttp as picohttp;
use bun_schema::api;
use bun_semver::{self as Semver, ExternalString, SlicedString, String as SemverString};
use bun_str::{strings, MutableString};
use bun_sys::{self, Fd, File};
use bun_threading::ThreadPool;
use bun_url::URL;
use bun_wyhash::Wyhash11;

use crate::bin::Bin;
use crate::install::{
    initialize_mini_store as initialize_store, Aligner, ExternalPackageNameHashList, ExternalSlice,
    ExternalStringList, ExternalStringMap, PackageManager, PackageNameHash, VersionSlice,
};
use crate::integrity::Integrity;

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
impl From<AllocError> for WhoamiError {
    fn from(_: AllocError) -> Self {
        WhoamiError::OutOfMemory
    }
}

pub fn whoami(manager: &mut PackageManager) -> Result<Vec<u8>, WhoamiError> {
    let registry = &manager.options.scope;

    if !registry.user.is_empty() {
        let sep = strings::index_of_char(&registry.user, b':').unwrap();
        return Ok(registry.user[..sep as usize].to_vec());
    }

    if !registry.url.username.is_empty() {
        return Ok(registry.url.username.to_vec());
    }

    if registry.token.is_empty() {
        return Err(WhoamiError::NeedAuth);
    }

    let auth_type: &[u8] = match &manager.options.publish_config.auth_type {
        Some(auth_type) => <&'static str>::from(*auth_type).as_bytes(),
        None => b"web",
    };
    let ci_name = bun_core::ci::detect_ci_name();

    let mut print_buf: Vec<u8> = Vec::new();

    let mut headers = HeaderBuilder::default();

    {
        headers.count("accept", "*/*");
        headers.count("accept-encoding", "gzip,deflate");

        write!(&mut print_buf, "Bearer {}", bstr::BStr::new(&registry.token)).unwrap();
        headers.count("authorization", &print_buf);
        print_buf.clear();

        // no otp needed, just use auth-type from options
        headers.count("npm-auth-type", auth_type);
        headers.count("npm-command", "whoami");

        write!(
            &mut print_buf,
            "{} {} {} workspaces/{}{}{}",
            Global::USER_AGENT,
            Global::OS_NAME,
            Global::ARCH_NAME,
            // TODO: figure out how npm determines workspaces=true
            false,
            if ci_name.is_some() { " ci/" } else { "" },
            ci_name.unwrap_or(""),
        )
        .unwrap();
        headers.count("user-agent", &print_buf);
        print_buf.clear();

        headers.count("Connection", "keep-alive");
        headers.count("Host", &registry.url.host);
    }

    headers.allocate()?;

    {
        headers.append("accept", "*/*");
        headers.append("accept-encoding", "gzip/deflate");

        write!(&mut print_buf, "Bearer {}", bstr::BStr::new(&registry.token)).unwrap();
        headers.append("authorization", &print_buf);
        print_buf.clear();

        headers.append("npm-auth-type", auth_type);
        headers.append("npm-command", "whoami");

        write!(
            &mut print_buf,
            "{} {} {} workspaces/{}{}{}",
            Global::USER_AGENT,
            Global::OS_NAME,
            Global::ARCH_NAME,
            false,
            if ci_name.is_some() { " ci/" } else { "" },
            ci_name.unwrap_or(""),
        )
        .unwrap();
        headers.append("user-agent", &print_buf);
        print_buf.clear();

        headers.append("Connection", "keep-alive");
        headers.append("Host", &registry.url.host);
    }

    write!(
        &mut print_buf,
        "{}/-/whoami",
        bstr::BStr::new(strings::without_trailing_slash(&registry.url.href)),
    )
    .unwrap();

    let mut response_buf = MutableString::init(1024)?;

    let url = URL::parse(&print_buf);

    let mut req = AsyncHTTP::init_sync(
        http::Method::GET,
        url,
        headers.entries,
        &headers.content.as_slice()[..headers.content.len()],
        &mut response_buf,
        b"",
        None,
        None,
        http::Redirect::Follow,
    );

    let res = match req.send_sync() {
        Ok(res) => res,
        Err(e) if e == err!("OutOfMemory") => return Err(WhoamiError::OutOfMemory),
        Err(e) => {
            Output::err(e, "whoami request failed to send", format_args!(""));
            Global::crash();
        }
    };

    if res.status_code >= 400 {
        const OTP_RESPONSE: bool = false;
        response_error::<OTP_RESPONSE>(&req, &res, None, &mut response_buf)?;
    }

    if let Some(notice) = res.headers.get_if_other_is_absent("npm-notice", "x-local-cache") {
        Output::print_error("\n", format_args!(""));
        Output::note(format_args!("{}", bstr::BStr::new(notice)));
        Output::flush();
    }

    let mut log = logger::Log::init();
    let source = logger::Source::init_path_string("???", response_buf.list.as_slice());
    let json = match JSON::parse_utf8(&source, &mut log) {
        Ok(j) => j,
        Err(e) if e == err!("OutOfMemory") => return Err(WhoamiError::OutOfMemory),
        Err(e) => {
            Output::err(e, "failed to parse '/-/whoami' response body as JSON", format_args!(""));
            Global::crash();
        }
    };

    let Some((username, _)) = json.get_string("username")? else {
        // no username, invalid auth probably
        return Err(WhoamiError::ProbablyInvalidAuth);
    };
    Ok(username)
}

pub fn response_error<const OTP_RESPONSE: bool>(
    req: &AsyncHTTP,
    res: &picohttp::Response,
    // `<name>@<version>`
    pkg_id: Option<(&[u8], &[u8])>,
    response_body: &mut MutableString,
) -> Result<core::convert::Infallible, AllocError> {
    let message: Option<Vec<u8>> = 'message: {
        let mut log = logger::Log::init();
        let source = logger::Source::init_path_string("???", response_body.list.as_slice());
        let json = match JSON::parse_utf8(&source, &mut log) {
            Ok(j) => j,
            Err(e) if e == err!("OutOfMemory") => return Err(AllocError),
            Err(_) => break 'message None,
        };

        let Some((error, _)) = json.get_string("error")? else {
            break 'message None;
        };
        Some(error)
    };

    Output::pretty_errorln(format_args!(
        "\n<red>{}<r>{}{}: {}\n",
        res.status_code,
        if !res.status.is_empty() { " " } else { "" },
        bstr::BStr::new(&res.status),
        bun_fmt::redacted_npm_url(&req.url.href),
    ));

    if res.status_code == 404 && pkg_id.is_some() {
        let (package_name, package_version) = pkg_id.unwrap();
        Output::pretty_errorln(format_args!(
            "\n - '{}@{}' does not exist in this registry",
            bstr::BStr::new(package_name),
            bstr::BStr::new(package_version),
        ));
    } else if let Some(msg) = &message {
        if OTP_RESPONSE {
            if res.status_code == 401
                && strings::contains(
                    msg,
                    b"You must provide a one-time pass. Upgrade your client to npm@latest in order to use 2FA.",
                )
            {
                Output::pretty_errorln(format_args!("\n - Received invalid OTP"));
                Global::crash();
            }
        }
        Output::pretty_errorln(format_args!("\n - {}", bstr::BStr::new(msg)));
    }

    Global::crash();
}

// ──────────────────────────────────────────────────────────────────────────

pub mod registry {
    use super::*;

    pub const DEFAULT_URL: &str = "https://registry.npmjs.org/";
    // TODO(port): const-eval Wyhash11 — needs const fn; init lazily for now
    pub static DEFAULT_URL_HASH: once_cell::sync::Lazy<u64> =
        once_cell::sync::Lazy::new(|| Wyhash11::hash(0, strings::without_trailing_slash(DEFAULT_URL.as_bytes())));

    pub type BodyPool = ObjectPool<MutableString, fn() -> MutableString, true, 8>;
    // TODO(port): ObjectPool init fn = MutableString::init2048

    #[derive(Default)]
    pub struct Scope {
        pub name: Box<[u8]>,
        // https://github.com/npm/npm-registry-fetch/blob/main/lib/auth.js#L96
        // base64("${username}:${password}")
        pub auth: Box<[u8]>,
        // URL may contain these special suffixes in the pathname:
        //  :_authToken
        //  :username
        //  :_password
        //  :_auth
        pub url: URL,
        pub url_hash: u64,
        pub token: Box<[u8]>,

        // username and password combo, `user:pass`
        pub user: Box<[u8]>,
    }

    impl Scope {
        pub fn hash(str: &[u8]) -> u64 {
            SemverString::Builder::string_hash(str)
        }

        pub fn get_name(name: &[u8]) -> &[u8] {
            if name.is_empty() || name[0] != b'@' {
                return name;
            }

            if let Some(i) = strings::index_of_char(name, b'/') {
                return &name[1..i as usize];
            }

            &name[1..]
        }

        pub fn from_api(
            name: &[u8],
            registry_: api::NpmRegistry,
            env: &mut DotEnv,
        ) -> Result<Scope, AllocError> {
            let mut registry = registry_;

            // Support $ENV_VAR for registry URLs
            if strings::starts_with_char(&registry_.url, b'$') {
                // If it became "$ENV_VAR/", then we need to remove the trailing slash
                if let Some(replaced_url) = env.get(strings::trim(&registry_.url[1..], b"/")) {
                    if replaced_url.len() > 1 {
                        registry.url = replaced_url;
                    }
                }
            }

            let mut url = URL::parse(&registry.url);
            let mut auth: &[u8] = b"";
            let mut user: &mut [u8] = &mut [];
            let mut needs_normalize = false;

            // TODO(port): heap-allocated buffer that owns `auth`/`user` — Zig used a single
            // allocation; in Rust we keep the Box alive for the lifetime of the Scope.
            let mut output_buf_owned: Box<[u8]> = Box::default();

            if registry.token.is_empty() {
                'outer: {
                    if registry.password.is_empty() {
                        let mut pathname = url.pathname.as_slice();
                        // defer { url.pathname = pathname; url.path = pathname; } — applied below
                        let mut needs_to_check_slash = true;
                        while let Some(colon) = strings::last_index_of_char(pathname, b':') {
                            let mut segment = &pathname[colon as usize + 1..];
                            pathname = &pathname[..colon as usize];
                            needs_to_check_slash = false;
                            needs_normalize = true;
                            if pathname.len() > 1 && pathname[pathname.len() - 1] == b'/' {
                                pathname = &pathname[..pathname.len() - 1];
                            }

                            let Some(eql_i) = strings::index_of_char(segment, b'=') else {
                                continue;
                            };
                            let value = &segment[eql_i as usize + 1..];
                            segment = &segment[..eql_i as usize];

                            // https://github.com/yarnpkg/yarn/blob/6db39cf0ff684ce4e7de29669046afb8103fce3d/src/registries/npm-registry.js#L364
                            // Bearer Token
                            if segment == b"_authToken" {
                                registry.token = value;
                                url.pathname = pathname.into();
                                url.path = pathname.into();
                                break 'outer;
                            }

                            if segment == b"_auth" {
                                auth = value;
                                url.pathname = pathname.into();
                                url.path = pathname.into();
                                break 'outer;
                            }

                            if segment == b"username" {
                                registry.username = value;
                                continue;
                            }

                            if segment == b"_password" {
                                registry.password = value;
                                continue;
                            }
                        }

                        // In this case, there is only one.
                        if needs_to_check_slash {
                            if let Some(last_slash) = strings::last_index_of_char(pathname, b'/') {
                                let remain = &pathname[last_slash as usize + 1..];
                                if let Some(eql_i) = strings::index_of_char(remain, b'=') {
                                    let segment = &remain[..eql_i as usize];
                                    let value = &remain[eql_i as usize + 1..];

                                    // https://github.com/yarnpkg/yarn/blob/6db39cf0ff684ce4e7de29669046afb8103fce3d/src/registries/npm-registry.js#L364
                                    // Bearer Token
                                    if segment == b"_authToken" {
                                        registry.token = value;
                                        pathname = &pathname[..last_slash as usize + 1];
                                        needs_normalize = true;
                                        url.pathname = pathname.into();
                                        url.path = pathname.into();
                                        break 'outer;
                                    }

                                    if segment == b"_auth" {
                                        auth = value;
                                        pathname = &pathname[..last_slash as usize + 1];
                                        needs_normalize = true;
                                        url.pathname = pathname.into();
                                        url.path = pathname.into();
                                        break 'outer;
                                    }

                                    if segment == b"username" {
                                        registry.username = value;
                                        pathname = &pathname[..last_slash as usize + 1];
                                        needs_normalize = true;
                                        url.pathname = pathname.into();
                                        url.path = pathname.into();
                                        break 'outer;
                                    }

                                    if segment == b"_password" {
                                        registry.password = value;
                                        pathname = &pathname[..last_slash as usize + 1];
                                        needs_normalize = true;
                                        url.pathname = pathname.into();
                                        url.path = pathname.into();
                                        break 'outer;
                                    }
                                }
                            }
                        }

                        // PORT NOTE: reshaped for borrowck — Zig's `defer { url.pathname = pathname; url.path = pathname; }`
                        // is applied at every `break 'outer` above and once more here at fallthrough.
                        url.pathname = pathname.into();
                        url.path = pathname.into();
                    }

                    registry.username = env.get_auto(&registry.username);
                    registry.password = env.get_auto(&registry.password);

                    if !registry.username.is_empty() && !registry.password.is_empty() && auth.is_empty() {
                        let combo_len = registry.username.len() + registry.password.len() + 1;
                        let total = combo_len + bun_core::base64::standard_encoder_calc_size(combo_len);
                        output_buf_owned = vec![0u8; total].into_boxed_slice();
                        // TODO(port): lifetime — Zig leaked this allocation into the Scope; here
                        // we transfer ownership via `output_buf_owned` and slice into it.
                        let (user_slice, output_buf) = output_buf_owned.split_at_mut(combo_len);
                        user_slice[..registry.username.len()].copy_from_slice(&registry.username);
                        user_slice[registry.username.len()] = b':';
                        user_slice[registry.username.len() + 1..][..registry.password.len()]
                            .copy_from_slice(&registry.password);
                        user = user_slice;
                        auth = bun_core::base64::standard_encode(output_buf, user);
                        break 'outer;
                    }
                }
            }

            registry.token = env.get_auto(&registry.token);

            if needs_normalize {
                let mut href = Vec::new();
                write!(
                    &mut href,
                    "{}://{}/{}/",
                    bstr::BStr::new(url.display_protocol()),
                    url.display_host(),
                    bstr::BStr::new(strings::trim(&url.pathname, b"/")),
                )
                .unwrap();
                url = URL::parse(&href);
                // TODO(port): href must outlive url — URL::parse may need to own its input
                let _ = href;
            }

            let url_hash = Self::hash(strings::without_trailing_slash(&url.href));

            Ok(Scope {
                name: name.into(),
                url,
                url_hash,
                token: registry.token.into(),
                auth: auth.into(),
                user: user.to_vec().into_boxed_slice(),
            })
            // PORT NOTE: `output_buf_owned` is dropped here; `auth`/`user` were copied above.
        }
    }

    pub type Map = HashMap<u64, Scope, IdentityContext<u64>>;

    pub enum PackageVersionResponse {
        Cached(PackageManifest),
        Fresh(PackageManifest),
        NotFound,
    }

    pub fn get_package_metadata(
        scope: &Scope,
        response: picohttp::Response,
        body: &[u8],
        log: &mut logger::Log,
        package_name: &[u8],
        loaded_manifest: Option<PackageManifest>,
        package_manager: &mut PackageManager,
        is_extended_manifest: bool,
    ) -> Result<PackageVersionResponse, Error> {
        // TODO(port): narrow error set
        match response.status_code {
            400 => return Err(err!("BadRequest")),
            429 => return Err(err!("TooManyRequests")),
            404 => return Ok(PackageVersionResponse::NotFound),
            500..=599 => return Err(err!("HTTPInternalServerError")),
            304 => return Ok(PackageVersionResponse::Cached(loaded_manifest.unwrap())),
            _ => {}
        }

        let mut newly_last_modified: &[u8] = b"";
        let mut new_etag: &[u8] = b"";
        for header in response.headers.list.iter() {
            if !(header.name.len() == "last-modified".len() || header.name.len() == "etag".len()) {
                continue;
            }

            let hashed = HTTPClient::hash_header_name(&header.name);

            if hashed == HTTPClient::hash_header_const("last-modified") {
                newly_last_modified = &header.value;
            } else if hashed == HTTPClient::hash_header_const("etag") {
                new_etag = &header.value;
            }
        }

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
            (u64::try_from(bun_core::time::timestamp().max(0)).unwrap() as u32) + 300,
            is_extended_manifest,
        )? {
            if package_manager.options.enable.manifest_cache {
                package_manifest::Serializer::save_async(
                    &package,
                    scope,
                    package_manager.get_temporary_directory().handle,
                    package_manager.get_cache_directory(),
                );
            }

            return Ok(PackageVersionResponse::Fresh(package));
        }

        Err(err!("PackageFailedToParse"))
    }
}

pub use registry as Registry;

// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct DistTagMap {
    pub tags: ExternalStringList,
    pub versions: VersionSlice,
}

pub type PackageVersionList = ExternalSlice<PackageVersion>;

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct ExternVersionMap {
    pub keys: VersionSlice,
    pub values: PackageVersionList,
}

impl ExternVersionMap {
    pub fn find_key_index(self, buf: &[Semver::Version], find: Semver::Version) -> Option<u32> {
        for (i, key) in self.keys.get(buf).iter().enumerate() {
            if key.eql(&find) {
                return Some(i as u32);
            }
        }
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────

/// `T` must be a `#[repr(uN)]` "open" enum that exposes:
///   - `T::NONE`, `T::ALL`, `T::ALL_VALUE: uN`
///   - `T::NAME_MAP: phf::Map<&'static [u8], uN>`
///   - `fn has(self, other: uN) -> bool`
///   - `fn from_raw(n: uN) -> Self`, `fn to_raw(self) -> uN`
///   - `fn negatable(self) -> Negatable<T>`
// TODO(port): Zig used comptime u16/u8 mixed; bound via a trait in Phase B.
pub trait NegatableEnum: Copy + Eq {
    type Int: Copy
        + Eq
        + core::ops::BitOr<Output = Self::Int>
        + core::ops::BitAnd<Output = Self::Int>
        + core::ops::Not<Output = Self::Int>
        + Default;
    const NONE: Self;
    const ALL: Self;
    const ALL_VALUE: Self::Int;
    fn name_map() -> &'static phf::Map<&'static [u8], Self::Int>;
    fn name_map_kvs() -> &'static [(&'static [u8], Self::Int)];
    fn has(self, other: Self::Int) -> bool;
    fn to_raw(self) -> Self::Int;
    fn from_raw(n: Self::Int) -> Self;
}

#[derive(Clone, Copy)]
pub struct Negatable<T: NegatableEnum> {
    pub added: T,
    pub removed: T,
    pub had_wildcard: bool,
    pub had_unrecognized_values: bool,
}

impl<T: NegatableEnum> Default for Negatable<T> {
    fn default() -> Self {
        Self {
            added: T::NONE,
            removed: T::NONE,
            had_wildcard: false,
            had_unrecognized_values: false,
        }
    }
}

impl<T: NegatableEnum> Negatable<T> {
    // https://github.com/pnpm/pnpm/blob/1f228b0aeec2ef9a2c8577df1d17186ac83790f9/config/package-is-installable/src/checkPlatform.ts#L56-L86
    // https://github.com/npm/cli/blob/fefd509992a05c2dfddbe7bc46931c42f1da69d7/node_modules/npm-install-checks/lib/index.js#L2-L96
    pub fn combine(self) -> T {
        let added = if self.had_wildcard { T::ALL_VALUE } else { self.added.to_raw() };
        let removed = self.removed.to_raw();
        let zero = T::Int::default();

        // If none were added or removed, all are allowed
        if added == zero && removed == zero {
            if self.had_unrecognized_values {
                return T::NONE;
            }
            // []
            return T::ALL;
        }

        // If none were added, but some were removed, return the inverse of the removed
        if added == zero && removed != zero {
            // ["!linux", "!darwin"]
            return T::from_raw(T::ALL_VALUE & !removed);
        }

        if removed == zero {
            // ["linux", "darwin"]
            return T::from_raw(added);
        }

        // - ["linux", "!darwin"]
        T::from_raw(added & !removed)
    }

    pub fn apply(&mut self, str: &[u8]) {
        if str.is_empty() {
            return;
        }

        if str == b"any" {
            self.had_wildcard = true;
            return;
        }

        if str == b"none" {
            self.had_unrecognized_values = true;
            return;
        }

        let is_not = str[0] == b'!';
        let offset: usize = is_not as usize;

        let Some(&field) = T::name_map().get(&str[offset..]) else {
            if !is_not {
                self.had_unrecognized_values = true;
            }
            return;
        };

        if is_not {
            *self = Self {
                added: self.added,
                removed: T::from_raw(self.removed.to_raw() | field),
                ..Default::default()
            };
        } else {
            *self = Self {
                added: T::from_raw(self.added.to_raw() | field),
                removed: self.removed,
                ..Default::default()
            };
        }
    }

    pub fn from_json(expr: JSON::Expr) -> Result<T, AllocError> {
        let mut this = T::NONE.negatable();
        match expr.data {
            JSON::ExprData::EArray(arr) => {
                let items = arr.slice();
                if !items.is_empty() {
                    for item in items {
                        if let Some(value) = item.as_string() {
                            this.apply(value);
                        }
                    }
                }
            }
            JSON::ExprData::EString(str) => {
                this.apply(str.data);
            }
            _ => {}
        }

        Ok(this.combine())
    }

    /// writes to a one line json array with a trailing comma and space, or writes a string
    pub fn to_json(field: T, writer: &mut impl core::fmt::Write) -> core::fmt::Result {
        if field == T::NONE {
            // [] means everything, so unrecognized value
            writer.write_str(r#""none""#)?;
            return Ok(());
        }

        let kvs = T::name_map_kvs();
        let mut removed: u8 = 0;
        for kv in kvs {
            if !field.has(kv.1) {
                removed += 1;
            }
        }
        let included = kvs.len() - usize::from(removed);
        let print_included = usize::from(removed) > kvs.len() - usize::from(removed);

        let one = (print_included && included == 1) || (!print_included && removed == 1);

        if !one {
            writer.write_str("[ ")?;
        }

        for kv in kvs {
            let has = field.has(kv.1);
            if has && print_included {
                write!(writer, r#""{}""#, bstr::BStr::new(kv.0))?;
                if one {
                    return Ok(());
                }
                writer.write_str(", ")?;
            } else if !has && !print_included {
                write!(writer, r#""!{}""#, bstr::BStr::new(kv.0))?;
                if one {
                    return Ok(());
                }
                writer.write_str(", ")?;
            }
        }

        writer.write_char(']')
    }
}

// TODO(port): NegatableEnum needs `fn negatable(self) -> Negatable<Self>` — added as ext below.
pub trait NegatableExt: NegatableEnum {
    fn negatable(self) -> Negatable<Self> {
        Negatable { added: self, removed: Self::NONE, had_wildcard: false, had_unrecognized_values: false }
    }
}
impl<T: NegatableEnum> NegatableExt for T {}

// ──────────────────────────────────────────────────────────────────────────

/// https://nodejs.org/api/os.html#osplatform
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct OperatingSystem(pub u16);

impl OperatingSystem {
    pub const NONE: Self = Self(0);
    pub const ALL: Self = Self(Self::ALL_VALUE);

    pub const AIX: u16 = 1 << 1;
    pub const DARWIN: u16 = 1 << 2;
    pub const FREEBSD: u16 = 1 << 3;
    pub const LINUX: u16 = 1 << 4;
    pub const OPENBSD: u16 = 1 << 5;
    pub const SUNOS: u16 = 1 << 6;
    pub const WIN32: u16 = 1 << 7;
    pub const ANDROID: u16 = 1 << 8;

    pub const ALL_VALUE: u16 =
        Self::AIX | Self::DARWIN | Self::FREEBSD | Self::LINUX | Self::OPENBSD | Self::SUNOS | Self::WIN32 | Self::ANDROID;

    #[cfg(all(target_os = "linux", not(target_os = "android")))]
    pub const CURRENT: Self = Self(Self::LINUX);
    #[cfg(target_os = "android")]
    pub const CURRENT: Self = Self(Self::ANDROID);
    #[cfg(target_os = "macos")]
    pub const CURRENT: Self = Self(Self::DARWIN);
    #[cfg(windows)]
    pub const CURRENT: Self = Self(Self::WIN32);
    #[cfg(target_os = "freebsd")]
    pub const CURRENT: Self = Self(Self::FREEBSD);

    pub fn is_match(self, target: OperatingSystem) -> bool {
        (self.0 & target.0) != 0
    }

    #[inline]
    pub fn has(self, other: u16) -> bool {
        (self.0 & other) != 0
    }

    pub static NAME_MAP: phf::Map<&'static [u8], u16> = phf::phf_map! {
        b"aix" => Self::AIX,
        b"darwin" => Self::DARWIN,
        b"freebsd" => Self::FREEBSD,
        b"linux" => Self::LINUX,
        b"openbsd" => Self::OPENBSD,
        b"sunos" => Self::SUNOS,
        b"win32" => Self::WIN32,
        b"android" => Self::ANDROID,
    };

    pub const NAME_MAP_KVS: &'static [(&'static [u8], u16)] = &[
        (b"aix", Self::AIX),
        (b"darwin", Self::DARWIN),
        (b"freebsd", Self::FREEBSD),
        (b"linux", Self::LINUX),
        (b"openbsd", Self::OPENBSD),
        (b"sunos", Self::SUNOS),
        (b"win32", Self::WIN32),
        (b"android", Self::ANDROID),
    ];

    #[cfg(target_os = "linux")]
    pub const CURRENT_NAME: &'static str = "linux";
    #[cfg(target_os = "macos")]
    pub const CURRENT_NAME: &'static str = "darwin";
    #[cfg(windows)]
    pub const CURRENT_NAME: &'static str = "win32";
    #[cfg(target_os = "freebsd")]
    pub const CURRENT_NAME: &'static str = "freebsd";

    pub fn negatable(self) -> Negatable<OperatingSystem> {
        Negatable { added: self, removed: Self::NONE, had_wildcard: false, had_unrecognized_values: false }
    }

    // jsFunctionOperatingSystemIsMatch — see bun_install_jsc::npm_jsc::operating_system_is_match
    // (deleted per PORTING.md: *_jsc alias)
}

impl NegatableEnum for OperatingSystem {
    type Int = u16;
    const NONE: Self = Self::NONE;
    const ALL: Self = Self::ALL;
    const ALL_VALUE: u16 = Self::ALL_VALUE;
    fn name_map() -> &'static phf::Map<&'static [u8], u16> { &Self::NAME_MAP }
    fn name_map_kvs() -> &'static [(&'static [u8], u16)] { Self::NAME_MAP_KVS }
    fn has(self, other: u16) -> bool { Self::has(self, other) }
    fn to_raw(self) -> u16 { self.0 }
    fn from_raw(n: u16) -> Self { Self(n) }
}

// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Libc(pub u8);

impl Libc {
    pub const NONE: Self = Self(0);
    pub const ALL: Self = Self(Self::ALL_VALUE);

    pub const GLIBC: u8 = 1 << 1;
    pub const MUSL: u8 = 1 << 2;

    pub const ALL_VALUE: u8 = Self::GLIBC | Self::MUSL;

    pub static NAME_MAP: phf::Map<&'static [u8], u8> = phf::phf_map! {
        b"glibc" => Self::GLIBC,
        b"musl" => Self::MUSL,
    };

    pub const NAME_MAP_KVS: &'static [(&'static [u8], u8)] = &[
        (b"glibc", Self::GLIBC),
        (b"musl", Self::MUSL),
    ];

    #[inline]
    pub fn has(self, other: u8) -> bool {
        (self.0 & other) != 0
    }

    pub fn is_match(self, target: Libc) -> bool {
        (self.0 & target.0) != 0
    }

    pub fn negatable(self) -> Negatable<Libc> {
        Negatable { added: self, removed: Self::NONE, had_wildcard: false, had_unrecognized_values: false }
    }

    // TODO:
    pub const CURRENT: Libc = Self(Self::GLIBC);

    // jsFunctionLibcIsMatch — see bun_install_jsc::npm_jsc::libc_is_match (deleted *_jsc alias)
}

impl NegatableEnum for Libc {
    type Int = u8;
    const NONE: Self = Self::NONE;
    const ALL: Self = Self::ALL;
    const ALL_VALUE: u8 = Self::ALL_VALUE;
    fn name_map() -> &'static phf::Map<&'static [u8], u8> { &Self::NAME_MAP }
    fn name_map_kvs() -> &'static [(&'static [u8], u8)] { Self::NAME_MAP_KVS }
    fn has(self, other: u8) -> bool { Self::has(self, other) }
    fn to_raw(self) -> u8 { self.0 }
    fn from_raw(n: u8) -> Self { Self(n) }
}

// ──────────────────────────────────────────────────────────────────────────

/// https://docs.npmjs.com/cli/v8/configuring-npm/package-json#cpu
/// https://nodejs.org/api/os.html#osarch
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Architecture(pub u16);

impl Architecture {
    pub const NONE: Self = Self(0);
    pub const ALL: Self = Self(Self::ALL_VALUE);

    pub const ARM: u16 = 1 << 1;
    pub const ARM64: u16 = 1 << 2;
    pub const IA32: u16 = 1 << 3;
    pub const MIPS: u16 = 1 << 4;
    pub const MIPSEL: u16 = 1 << 5;
    pub const PPC: u16 = 1 << 6;
    pub const PPC64: u16 = 1 << 7;
    pub const S390: u16 = 1 << 8;
    pub const S390X: u16 = 1 << 9;
    pub const X32: u16 = 1 << 10;
    pub const X64: u16 = 1 << 11;

    pub const ALL_VALUE: u16 = Self::ARM
        | Self::ARM64
        | Self::IA32
        | Self::MIPS
        | Self::MIPSEL
        | Self::PPC
        | Self::PPC64
        | Self::S390
        | Self::S390X
        | Self::X32
        | Self::X64;

    #[cfg(target_arch = "aarch64")]
    pub const CURRENT: Self = Self(Self::ARM64);
    #[cfg(target_arch = "x86_64")]
    pub const CURRENT: Self = Self(Self::X64);

    #[cfg(target_arch = "aarch64")]
    pub const CURRENT_NAME: &'static str = "arm64";
    #[cfg(target_arch = "x86_64")]
    pub const CURRENT_NAME: &'static str = "x64";

    pub static NAME_MAP: phf::Map<&'static [u8], u16> = phf::phf_map! {
        b"arm" => Self::ARM,
        b"arm64" => Self::ARM64,
        b"ia32" => Self::IA32,
        b"mips" => Self::MIPS,
        b"mipsel" => Self::MIPSEL,
        b"ppc" => Self::PPC,
        b"ppc64" => Self::PPC64,
        b"s390" => Self::S390,
        b"s390x" => Self::S390X,
        b"x32" => Self::X32,
        b"x64" => Self::X64,
    };

    pub const NAME_MAP_KVS: &'static [(&'static [u8], u16)] = &[
        (b"arm", Self::ARM),
        (b"arm64", Self::ARM64),
        (b"ia32", Self::IA32),
        (b"mips", Self::MIPS),
        (b"mipsel", Self::MIPSEL),
        (b"ppc", Self::PPC),
        (b"ppc64", Self::PPC64),
        (b"s390", Self::S390),
        (b"s390x", Self::S390X),
        (b"x32", Self::X32),
        (b"x64", Self::X64),
    ];

    #[inline]
    pub fn has(self, other: u16) -> bool {
        (self.0 & other) != 0
    }

    pub fn is_match(self, target: Architecture) -> bool {
        (self.0 & target.0) != 0
    }

    pub fn negatable(self) -> Negatable<Architecture> {
        Negatable { added: self, removed: Self::NONE, had_wildcard: false, had_unrecognized_values: false }
    }

    // jsFunctionArchitectureIsMatch — see bun_install_jsc::npm_jsc::architecture_is_match (deleted *_jsc alias)
}

impl NegatableEnum for Architecture {
    type Int = u16;
    const NONE: Self = Self::NONE;
    const ALL: Self = Self::ALL;
    const ALL_VALUE: u16 = Self::ALL_VALUE;
    fn name_map() -> &'static phf::Map<&'static [u8], u16> { &Self::NAME_MAP }
    fn name_map_kvs() -> &'static [(&'static [u8], u16)] { Self::NAME_MAP_KVS }
    fn has(self, other: u16) -> bool { Self::has(self, other) }
    fn to_raw(self) -> u16 { self.0 }
    fn from_raw(n: u16) -> Self { Self(n) }
}

// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy)]
pub struct PackageVersion {
    /// `"integrity"` field || `"shasum"` field
    /// https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#dist
    // Splitting this into it's own array ends up increasing the final size a little bit.
    pub integrity: Integrity,

    /// "dependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#dependencies)
    pub dependencies: ExternalStringMap,

    /// `"optionalDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies)
    pub optional_dependencies: ExternalStringMap,

    /// `"peerDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#peerdependencies)
    /// if `non_optional_peer_dependencies_start` is > 0, then instead of alphabetical, the first N items are optional
    pub peer_dependencies: ExternalStringMap,

    /// `"devDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#devdependencies)
    /// We deliberately choose not to populate this field.
    /// We keep it in the data layout so that if it turns out we do need it, we can add it without invalidating everyone's history.
    pub dev_dependencies: ExternalStringMap,

    pub bundled_dependencies: ExternalPackageNameHashList,

    /// `"bin"` field in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#bin)
    pub bin: Bin,

    /// `"engines"` field in package.json
    pub engines: ExternalStringMap,

    /// `"peerDependenciesMeta"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#peerdependenciesmeta)
    /// if `non_optional_peer_dependencies_start` is > 0, then instead of alphabetical, the first N items of `peer_dependencies` are optional
    pub non_optional_peer_dependencies_start: u32,

    pub man_dir: ExternalString,

    /// can be empty!
    /// When empty, it means that the tarball URL can be inferred
    pub tarball_url: ExternalString,

    pub unpacked_size: u32,
    pub file_count: u32,

    /// `"os"` field in package.json
    pub os: OperatingSystem,
    /// `"cpu"` field in package.json
    pub cpu: Architecture,

    /// `"libc"` field in package.json
    pub libc: Libc,

    /// `hasInstallScript` field in registry API.
    pub has_install_script: bool,

    /// Unix timestamp when this version was published (0 if unknown)
    pub publish_timestamp_ms: f64,
}

impl Default for PackageVersion {
    fn default() -> Self {
        Self {
            integrity: Integrity::default(),
            dependencies: ExternalStringMap::default(),
            optional_dependencies: ExternalStringMap::default(),
            peer_dependencies: ExternalStringMap::default(),
            dev_dependencies: ExternalStringMap::default(),
            bundled_dependencies: ExternalPackageNameHashList::default(),
            bin: Bin::default(),
            engines: ExternalStringMap::default(),
            non_optional_peer_dependencies_start: 0,
            man_dir: ExternalString::default(),
            tarball_url: ExternalString::default(),
            unpacked_size: 0,
            file_count: 0,
            os: OperatingSystem::ALL,
            cpu: Architecture::ALL,
            libc: Libc::NONE,
            has_install_script: false,
            publish_timestamp_ms: 0.0,
        }
    }
}

impl PackageVersion {
    pub fn all_dependencies_bundled(&self) -> bool {
        self.bundled_dependencies.is_invalid()
    }
}

const _: () = assert!(
    core::mem::size_of::<PackageVersion>() == 240,
    "Npm.PackageVersion has unexpected size"
);

// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct NpmPackage {
    /// HTTP response headers
    pub last_modified: SemverString,
    pub etag: SemverString,

    /// "modified" in the JSON
    pub modified: SemverString,
    pub public_max_age: u32,

    pub name: ExternalString,

    pub releases: ExternVersionMap,
    pub prereleases: ExternVersionMap,
    pub dist_tags: DistTagMap,

    pub versions_buf: VersionSlice,
    pub string_lists_buf: ExternalStringList,

    // Flag to indicate if we have timestamp data from extended manifest
    pub has_extended_manifest: bool,
}

// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct PackageManifest {
    pub pkg: NpmPackage,

    pub string_buf: Box<[u8]>,
    pub versions: Box<[Semver::Version]>,
    pub external_strings: Box<[ExternalString]>,
    // We store this in a separate buffer so that we can dedupe contiguous identical versions without an extra pass
    pub external_strings_for_versions: Box<[ExternalString]>,
    pub package_versions: Box<[PackageVersion]>,
    pub extern_strings_bin_entries: Box<[ExternalString]>,
    pub bundled_deps_buf: Box<[PackageNameHash]>,
}

impl PackageManifest {
    #[inline]
    pub fn name(&self) -> &[u8] {
        self.pkg.name.slice(&self.string_buf)
    }

    pub fn byte_length(&self, scope: &registry::Scope) -> usize {
        let mut counter = bun_io::DiscardingWriter::new();
        match package_manifest::Serializer::write(self, scope, &mut counter) {
            Ok(()) => counter.count,
            Err(_) => 0,
        }
    }
}

pub mod package_manifest {
    use super::*;

    // bindings — see bun_install_jsc::npm_jsc::ManifestBindings (deleted *_jsc alias)

    pub struct Serializer;

    impl Serializer {
        // - v0.0.3: added serialization of registry url. it's used to invalidate when it changes
        // - v0.0.4: fixed bug with cpu & os tag not being added correctly
        // - v0.0.5: added bundled dependencies
        // - v0.0.6: changed semver major/minor/patch to each use u64 instead of u32
        // - v0.0.7: added version publish times and extended manifest flag for minimum release age
        pub const VERSION: &'static str = "bun-npm-manifest-cache-v0.0.7\n";
        const HEADER_BYTES: &'static str = concat!("#!/usr/bin/env bun\n", "bun-npm-manifest-cache-v0.0.7\n");

        // TODO(port): `sizes` was a comptime block iterating PackageManifest's fields by alignment.
        // Rust cannot reflect struct fields. Hardcode the field order produced by the Zig sort
        // (descending alignment) and verify in Phase B against the Zig output.
        pub const SIZES_FIELDS: &'static [&'static str] = &[
            "pkg",
            "string_buf",
            "versions",
            "external_strings",
            "external_strings_for_versions",
            "package_versions",
            "extern_strings_bin_entries",
            "bundled_deps_buf",
        ];
        const _: () = assert!(Self::HEADER_BYTES.len() == 49, "header bytes must be exactly 49 bytes long, length is not serialized");

        pub fn write_array<W: bun_io::Write, T: Copy>(
            writer: &mut W,
            array: &[T],
            pos: &mut u64,
        ) -> Result<(), Error> {
            // SAFETY: T is Copy POD; sliceAsBytes equivalent
            let bytes = unsafe {
                core::slice::from_raw_parts(
                    array.as_ptr() as *const u8,
                    core::mem::size_of_val(array),
                )
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

        pub fn read_array<'a, T: Copy>(
            stream: &mut bun_io::FixedBufferStream<'a>,
        ) -> Result<&'a [T], Error> {
            let byte_len = stream.read_int_le::<u64>()?;
            if byte_len == 0 {
                return Ok(&[]);
            }

            stream.pos += Aligner::skip_amount::<T>(stream.pos);
            let remaining = &stream.buffer[stream.pos.min(stream.buffer.len())..];
            if (remaining.len() as u64) < byte_len {
                return Err(err!("BufferTooSmall"));
            }
            let result_bytes = &remaining[..byte_len as usize];
            // SAFETY: alignment was advanced by Aligner::skip_amount; T is POD
            let result = unsafe {
                core::slice::from_raw_parts(
                    result_bytes.as_ptr() as *const T,
                    result_bytes.len() / core::mem::size_of::<T>(),
                )
            };
            stream.pos += result_bytes.len();
            Ok(result)
        }

        pub fn write<W: bun_io::Write>(
            this: &PackageManifest,
            scope: &registry::Scope,
            writer: &mut W,
        ) -> Result<(), Error> {
            let mut pos: u64 = 0;
            writer.write_all(Self::HEADER_BYTES.as_bytes())?;
            pos += Self::HEADER_BYTES.len() as u64;

            writer.write_int_le::<u64>(scope.url_hash)?;
            writer.write_int_le::<u64>(strings::without_trailing_slash(&scope.url.href).len() as u64)?;

            pos += 128 / 8;

            // TODO(port): inline-for over SIZES_FIELDS — unrolled by hand. Phase B: verify field
            // order matches Zig comptime sort (descending alignment).
            {
                // "pkg"
                // SAFETY: NpmPackage is #[repr(C)] POD
                let bytes = unsafe {
                    core::slice::from_raw_parts(
                        (&this.pkg as *const NpmPackage) as *const u8,
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
            tmp_path: &bun_str::ZStr,
            tmpdir: Fd,
            cache_dir: Fd,
            outpath: &bun_str::ZStr,
        ) -> Result<(), Error> {
            // 64 KB sounds like a lot but when you consider that this is only about 6 levels deep in the stack, it's not that much.
            // PERF(port): was stack-fallback alloc — profile in Phase B
            let mut buffer: Vec<u8> = Vec::with_capacity(this.byte_length(scope) + 64);
            Serializer::write(this, scope, &mut buffer)?;
            // --- Perf Improvement #1 ----
            // Do not forget to buffer writes!
            //
            // (benchmark output elided — see npm.zig)
            // --- Perf Improvement #2 ----
            // GetFinalPathnameByHandle is very expensive if called many times
            // We skip calling it when we are giving an absolute file path.
            // This needs many more call sites, doesn't have much impact on this location.
            let mut realpath_buf = bun_paths::PathBuffer::uninit();
            #[cfg(windows)]
            let path_to_use_for_opening_file = bun_paths::join_abs_string_buf_z(
                PackageManager::get().get_temporary_directory().path,
                &mut realpath_buf,
                &[tmp_path.as_bytes()],
                bun_paths::Style::Auto,
            );
            #[cfg(not(windows))]
            let path_to_use_for_opening_file = tmp_path;
            #[cfg(not(windows))]
            let _ = &mut realpath_buf;

            #[cfg(target_os = "linux")]
            let mut is_using_o_tmpfile = false;

            let file: File = 'brk: {
                let flags = bun_sys::O::WRONLY;
                #[cfg(unix)]
                let mask = 0o664;
                #[cfg(not(unix))]
                let mask = 0;

                // Do our best to use O_TMPFILE, so that if this process is interrupted, we don't leave a temporary file behind.
                // O_TMPFILE is Linux-only. Not all filesystems support O_TMPFILE.
                // https://manpages.debian.org/testing/manpages-dev/openat.2.en.html#O_TMPFILE
                #[cfg(target_os = "linux")]
                {
                    match File::openat(cache_dir, b".", flags | bun_sys::O::TMPFILE, mask) {
                        bun_sys::Result::Err(_) => {
                            static DID_WARN: core::sync::atomic::AtomicBool =
                                core::sync::atomic::AtomicBool::new(false);
                            fn warn_once() {
                                // .monotonic is okay because we only ever set this to true, and
                                // we don't rely on any side effects from a thread that
                                // previously set this to true.
                                if !DID_WARN.swap(true, core::sync::atomic::Ordering::Relaxed) {
                                    // This is not an error. Nor is it really a warning.
                                    Output::note(format_args!(
                                        "Linux filesystem or kernel lacks O_TMPFILE support. Using a fallback instead."
                                    ));
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
                )
                .unwrap()?
            };

            {
                // errdefer file.close() — handled by scopeguard
                let guard = scopeguard::guard((), |_| file.close());
                file.write_all(&buffer).unwrap()?;
                scopeguard::ScopeGuard::into_inner(guard);
            }

            #[cfg(windows)]
            {
                let mut realpath2_buf = bun_paths::PathBuffer::uninit();
                let mut did_close = false;
                let guard = scopeguard::guard((), |_| if !did_close { file.close() });

                let cache_dir_abs = &PackageManager::get().cache_directory_path;
                let cache_path_abs = bun_paths::join_abs_string_buf_z(
                    cache_dir_abs,
                    &mut realpath2_buf,
                    &[cache_dir_abs, outpath.as_bytes()],
                    bun_paths::Style::Auto,
                );
                file.close();
                did_close = true;
                bun_sys::renameat(Fd::cwd(), path_to_use_for_opening_file, Fd::cwd(), cache_path_abs).unwrap()?;
                scopeguard::ScopeGuard::into_inner(guard);
                return Ok(());
            }

            #[cfg(target_os = "linux")]
            if is_using_o_tmpfile {
                let _close = scopeguard::guard((), |_| file.close());
                // Attempt #1.
                if bun_sys::linkat_tmpfile(file.handle, cache_dir, outpath).unwrap().is_err() {
                    // Attempt #2: the file may already exist. Let's unlink and try again.
                    let _ = bun_sys::unlinkat(cache_dir, outpath).unwrap();
                    bun_sys::linkat_tmpfile(file.handle, cache_dir, outpath).unwrap()?;
                    // There is no attempt #3. This is a cache, so it's not essential.
                }
                return Ok(());
            }

            #[cfg(not(windows))]
            {
                let _close = scopeguard::guard((), |_| file.close());
                // Attempt #1. Rename the file.
                let rc = bun_sys::renameat(tmpdir, tmp_path, cache_dir, outpath);

                match &rc {
                    bun_sys::Result::Err(err) => {
                        // Fallback path: atomically swap from <tmp>/*.npm -> <cache>/*.npm, then unlink the temporary file.
                        let _unlink = scopeguard::guard((), |_| {
                            // If atomically swapping fails, then we should still unlink the temporary file as a courtesy.
                            let _ = bun_sys::unlinkat(tmpdir, tmp_path).unwrap();
                        });

                        if matches!(
                            err.get_errno(),
                            bun_sys::Errno::EXIST | bun_sys::Errno::NOTEMPTY | bun_sys::Errno::OPNOTSUPP
                        ) {
                            // Atomically swap the old file with the new file.
                            bun_sys::renameat2(
                                tmpdir,
                                tmp_path,
                                cache_dir,
                                outpath,
                                bun_sys::Renameat2Flags { exchange: true, ..Default::default() },
                            )
                            .unwrap()?;

                            // Success.
                            return Ok(());
                        }
                    }
                    bun_sys::Result::Ok(()) => {}
                }

                rc.unwrap()?;
            }

            Ok(())
        }

        /// We save into a temporary directory and then move the file to the cache directory.
        /// Saving the files to the manifest cache doesn't need to prevent application exit.
        /// It's an optional cache.
        /// Therefore, we choose to not increment the pending task count or wake up the main thread.
        ///
        /// This might leave temporary files in the temporary directory that will never be moved to the cache directory. We'll see if anyone asks about that.
        pub fn save_async(
            this: &PackageManifest,
            scope: &registry::Scope,
            tmpdir: Fd,
            cache_dir: Fd,
        ) {
            pub struct SaveTask<'a> {
                manifest: PackageManifest,
                scope: &'a registry::Scope,
                tmpdir: Fd,
                cache_dir: Fd,

                task: ThreadPool::Task,
            }

            impl<'a> SaveTask<'a> {
                pub fn new(init: SaveTask<'a>) -> Box<SaveTask<'a>> {
                    Box::new(init)
                }

                pub fn run(task: *mut ThreadPool::Task) {
                    let _tracer = bun_core::perf::trace("PackageManifest.Serializer.save");

                    // SAFETY: task points to SaveTask.task
                    let save_task: *mut SaveTask<'_> = unsafe {
                        (task as *mut u8)
                            .sub(core::mem::offset_of!(SaveTask<'_>, task))
                            .cast()
                    };
                    // SAFETY: allocated via Box::into_raw in save_async
                    let save_task = unsafe { Box::from_raw(save_task) };

                    if let Err(err) = Serializer::save(
                        &save_task.manifest,
                        save_task.scope,
                        save_task.tmpdir,
                        save_task.cache_dir,
                    ) {
                        if PackageManager::verbose_install() {
                            Output::warn(format_args!(
                                "Error caching manifest for {}: {}",
                                bstr::BStr::new(save_task.manifest.name()),
                                err.name(),
                            ));
                            Output::flush();
                        }
                    }
                }
            }

            // TODO(port): lifetime — `scope` is borrowed across a thread boundary; Zig assumed
            // the Registry.Scope outlives the threadpool task. Phase B: prove or change to owned.
            let task = Box::into_raw(SaveTask::new(SaveTask {
                manifest: this.clone(), // TODO(port): Zig copied PackageManifest by value
                scope,
                tmpdir,
                cache_dir,
                task: ThreadPool::Task { callback: SaveTask::run },
            }));

            // SAFETY: task is a valid Box-allocated SaveTask
            let batch = ThreadPool::Batch::from(unsafe { &mut (*task).task });
            PackageManager::get().thread_pool.schedule(batch);
        }

        fn manifest_file_name(
            buf: &mut [u8],
            file_id: u64,
            scope: &registry::Scope,
        ) -> Result<&bun_str::ZStr, Error> {
            let file_id_hex_fmt = bun_fmt::hex_int_lower(file_id);
            if scope.url_hash == *registry::DEFAULT_URL_HASH {
                bun_str::buf_print_z(buf, format_args!("{}.npm", file_id_hex_fmt))
            } else {
                bun_str::buf_print_z(
                    buf,
                    format_args!("{}-{}.npm", file_id_hex_fmt, bun_fmt::hex_int_lower(scope.url_hash)),
                )
            }
        }

        pub fn save(
            this: &PackageManifest,
            scope: &registry::Scope,
            tmpdir: Fd,
            cache_dir: Fd,
        ) -> Result<(), Error> {
            let file_id = Wyhash11::hash(0, this.name());
            let mut dest_path_buf = [0u8; 512 + 64];
            let mut out_path_buf = [0u8; ("18446744073709551615".len() * 2) + "_".len() + ".npm".len() + 1];
            let mut dest_path_stream = bun_io::FixedBufferStream::new_mut(&mut dest_path_buf);
            let file_id_hex_fmt = bun_fmt::hex_int_lower(file_id);
            let hex_timestamp: usize = usize::try_from(bun_core::time::milli_timestamp().max(0)).unwrap();
            let hex_timestamp_fmt = bun_fmt::hex_int_lower(hex_timestamp as u64);
            write!(dest_path_stream, "{}.npm-{}", file_id_hex_fmt, hex_timestamp_fmt)?;
            dest_path_stream.write_byte(0)?;
            let pos = dest_path_stream.pos;
            // SAFETY: dest_path_buf[pos-1] == 0 written above
            let tmp_path = unsafe { bun_str::ZStr::from_raw_mut(dest_path_buf.as_mut_ptr(), pos - 1) };
            let out_path = Self::manifest_file_name(&mut out_path_buf, file_id, scope)?;
            Self::write_file(this, scope, tmp_path, tmpdir, cache_dir, out_path)
        }

        pub fn load_by_file_id(
            scope: &registry::Scope,
            cache_dir: Fd,
            file_id: u64,
        ) -> Result<Option<PackageManifest>, Error> {
            let mut file_path_buf = [0u8; 512 + 64];
            let file_name = Self::manifest_file_name(&mut file_path_buf, file_id, scope)?;
            let Ok(cache_file) = File::openat(cache_dir, file_name, bun_sys::O::RDONLY, 0).unwrap() else {
                return Ok(None);
            };
            let _close = scopeguard::guard((), |_| cache_file.close());

            'delete: {
                match Self::load_by_file(scope, &cache_file) {
                    Ok(Some(m)) => return Ok(Some(m)),
                    Ok(None) | Err(_) => break 'delete,
                }
            }

            // delete the outdated/invalid manifest
            bun_sys::unlinkat(cache_dir, file_name).unwrap()?;
            Ok(None)
        }

        pub fn load_by_file(
            scope: &registry::Scope,
            manifest_file: &File,
        ) -> Result<Option<PackageManifest>, Error> {
            let _tracer = bun_core::perf::trace("PackageManifest.Serializer.loadByFile");
            let bytes = manifest_file.read_to_end()?.unwrap()?;
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

            // TODO(port): manifest borrows `bytes` in Zig; here read_all copies into Box<[T]>.
            Ok(Some(manifest))
        }

        fn read_all(bytes: &[u8], scope: &registry::Scope) -> Result<Option<PackageManifest>, Error> {
            if &bytes[..Self::HEADER_BYTES.len()] != Self::HEADER_BYTES.as_bytes() {
                return Ok(None);
            }
            let mut pkg_stream = bun_io::FixedBufferStream::new(bytes);
            pkg_stream.pos = Self::HEADER_BYTES.len();

            let mut package_manifest = PackageManifest::default();

            let registry_hash = pkg_stream.read_int_le::<u64>()?;
            if scope.url_hash != registry_hash {
                return Ok(None);
            }

            let registry_length = pkg_stream.read_int_le::<u64>()?;
            if strings::without_trailing_slash(&scope.url.href).len() as u64 != registry_length {
                return Ok(None);
            }

            // TODO(port): inline-for over SIZES_FIELDS — unrolled by hand
            {
                pkg_stream.pos = bun_core::mem::align_forward(pkg_stream.pos, core::mem::align_of::<NpmPackage>());
                package_manifest.pkg = pkg_stream.read_struct::<NpmPackage>()?;
            }
            package_manifest.string_buf = Self::read_array::<u8>(&mut pkg_stream)?.into();
            package_manifest.versions = Self::read_array::<Semver::Version>(&mut pkg_stream)?.into();
            package_manifest.external_strings = Self::read_array::<ExternalString>(&mut pkg_stream)?.into();
            package_manifest.external_strings_for_versions =
                Self::read_array::<ExternalString>(&mut pkg_stream)?.into();
            package_manifest.package_versions = Self::read_array::<PackageVersion>(&mut pkg_stream)?.into();
            package_manifest.extern_strings_bin_entries =
                Self::read_array::<ExternalString>(&mut pkg_stream)?.into();
            package_manifest.bundled_deps_buf = Self::read_array::<PackageNameHash>(&mut pkg_stream)?.into();

            Ok(Some(package_manifest))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

impl PackageManifest {
    pub fn str(&self, external: &ExternalString) -> &[u8] {
        external.slice(&self.string_buf)
    }

    pub fn report_size(&self) {
        Output::pretty_errorln(format_args!(
            " Versions count:            {}\n \
             External Strings count:    {}\n \
             Package Versions count:    {}\n\n \
             Bytes:\n\n  \
             Versions:   {}\n  \
             External:   {}\n  \
             Packages:   {}\n  \
             Strings:    {}\n  \
             Total:      {}",
            self.versions.len(),
            self.external_strings.len(),
            self.package_versions.len(),
            core::mem::size_of_val(&*self.versions),
            core::mem::size_of_val(&*self.external_strings),
            core::mem::size_of_val(&*self.package_versions),
            core::mem::size_of_val(&*self.string_buf),
            core::mem::size_of_val(&*self.versions)
                + core::mem::size_of_val(&*self.external_strings)
                + core::mem::size_of_val(&*self.package_versions)
                + core::mem::size_of_val(&*self.string_buf),
        ));
        Output::flush();
    }
}

#[derive(Clone, Copy)]
pub struct FindResult<'a> {
    pub version: Semver::Version,
    pub package: &'a PackageVersion,
}

impl PackageManifest {
    pub fn find_by_version(&self, version: Semver::Version) -> Option<FindResult<'_>> {
        let list = if !version.tag.has_pre() { self.pkg.releases } else { self.pkg.prereleases };
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

    pub fn find_by_dist_tag(&self, tag: &[u8]) -> Option<FindResult<'_>> {
        let versions = self.pkg.dist_tags.versions.get(&self.versions);
        for (i, tag_str) in self.pkg.dist_tags.tags.get(&self.external_strings).iter().enumerate() {
            if tag_str.slice(&self.string_buf) == tag {
                return self.find_by_version(versions[i]);
            }
        }
        None
    }

    pub fn should_exclude_from_age_filter(&self, exclusions: Option<&[&[u8]]>) -> bool {
        if let Some(excl) = exclusions {
            let pkg_name = self.name();
            for excluded in excl {
                if pkg_name == *excluded {
                    return true;
                }
            }
        }
        false
    }

    #[inline]
    pub fn is_package_version_too_recent(
        package_version: &PackageVersion,
        minimum_release_age_ms: f64,
    ) -> bool {
        let current_timestamp_ms: f64 = (bun_core::start_time() / bun_core::time::NS_PER_MS) as f64;
        package_version.publish_timestamp_ms > current_timestamp_ms - minimum_release_age_ms
    }

    fn search_version_list<'a>(
        &'a self,
        versions: &'a [Semver::Version],
        packages: &'a [PackageVersion],
        group: &Semver::query::Group,
        group_buf: &[u8],
        minimum_release_age_ms: f64,
        newest_filtered: &mut Option<Semver::Version>,
    ) -> Option<FindVersionResult<'a>> {
        let mut prev_package_blocked_from_age: Option<&PackageVersion> = None;
        let mut best_version: Option<FindResult<'a>> = None;

        let current_timestamp_ms: f64 = (bun_core::start_time() / bun_core::time::NS_PER_MS) as f64;
        let seven_days_ms: f64 = 7.0 * bun_core::time::MS_PER_DAY as f64;
        let stability_window_ms: f64 = minimum_release_age_ms.min(seven_days_ms);

        let mut i = versions.len();
        while i > 0 {
            i -= 1;
            let version = versions[i];
            if group.satisfies(version, group_buf, &self.string_buf) {
                let package = &packages[i];
                if Self::is_package_version_too_recent(package, minimum_release_age_ms) {
                    if newest_filtered.is_none() {
                        *newest_filtered = Some(version);
                    }
                    prev_package_blocked_from_age = Some(package);
                }
                // stability check - if the previous package is blocked from age, we need to check if the current package wasn't the cause
                else if let Some(prev_package) = prev_package_blocked_from_age {
                    // only try to go backwards for a max of 7 days on top of existing minimum age
                    if package.publish_timestamp_ms < current_timestamp_ms - (minimum_release_age_ms + seven_days_ms) {
                        if best_version.is_none() {
                            best_version = Some(FindResult { version, package });
                        }
                        break;
                    }

                    let is_stable =
                        prev_package.publish_timestamp_ms - package.publish_timestamp_ms >= stability_window_ms;
                    if is_stable {
                        best_version = Some(FindResult { version, package });
                        break;
                    } else {
                        if best_version.is_none() {
                            best_version = Some(FindResult { version, package });
                        }
                        prev_package_blocked_from_age = Some(package);
                        continue;
                    }
                } else {
                    return Some(FindVersionResult::Found(FindResult { version, package }));
                }
            }
        }

        if let Some(result) = best_version {
            if let Some(nf) = *newest_filtered {
                return Some(FindVersionResult::FoundWithFilter {
                    result,
                    newest_filtered: Some(nf),
                });
            } else {
                return Some(FindVersionResult::Found(result));
            }
        }
        None
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FindVersionError {
    NotFound,
    TooRecent,
    AllVersionsTooRecent,
}

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
            FindVersionResult::FoundWithFilter { newest_filtered, .. } => newest_filtered.is_some(),
            FindVersionResult::Err(err) => *err == FindVersionError::AllVersionsTooRecent,
            // .err.too_recent is only for direct version checks which doesn't prove there was a later version that could have been chosen
            _ => false,
        }
    }
}

impl PackageManifest {
    pub fn find_by_dist_tag_with_filter(
        &self,
        tag: &[u8],
        minimum_release_age_ms: Option<f64>,
        exclusions: Option<&[&[u8]]>,
    ) -> FindVersionResult<'_> {
        let Some(dist_result) = self.find_by_dist_tag(tag) else {
            return FindVersionResult::Err(FindVersionError::NotFound);
        };
        let min_age_gate_ms = match minimum_release_age_ms {
            Some(min_age_ms) if !self.should_exclude_from_age_filter(exclusions) => Some(min_age_ms),
            _ => None,
        };
        let Some(min_age_ms) = min_age_gate_ms else {
            return FindVersionResult::Found(dist_result);
        };
        let current_timestamp_ms: f64 = (bun_core::start_time() / bun_core::time::NS_PER_MS) as f64;
        let seven_days_ms: f64 = 7.0 * bun_core::time::MS_PER_DAY as f64;
        let stability_window_ms = min_age_ms.min(seven_days_ms);

        let dist_too_recent = Self::is_package_version_too_recent(dist_result.package, min_age_ms);
        if !dist_too_recent {
            return FindVersionResult::Found(dist_result);
        }

        let latest_version = dist_result.version;
        let is_prerelease = latest_version.tag.has_pre();
        let latest_version_tag = if is_prerelease {
            Some(latest_version.tag.pre.slice(&self.string_buf))
        } else {
            None
        };
        let latest_version_tag_before_dot = latest_version_tag.map(|v| {
            if let Some(i) = strings::index_of_char(v, b'.') {
                &v[..i as usize]
            } else {
                v
            }
        });

        let list = if is_prerelease { self.pkg.prereleases } else { self.pkg.releases };
        let versions = list.keys.get(&self.versions);
        let packages = list.values.get(&self.package_versions);

        let mut best_version: Option<FindResult<'_>> = None;
        let mut prev_package_blocked_from_age: Option<&PackageVersion> = Some(dist_result.package);

        let mut i: usize = versions.len();
        while i > 0 {
            let idx = i - 1;
            i -= 1;
            let version = versions[idx];
            let package = &packages[idx];

            if version.order(&latest_version, &self.string_buf, &self.string_buf) == core::cmp::Ordering::Greater {
                continue;
            }
            if let Some(expected_tag) = latest_version_tag_before_dot {
                let package_tag = version.tag.pre.slice(&self.string_buf);
                let actual_tag = if let Some(dot_i) = strings::index_of_char(package_tag, b'.') {
                    &package_tag[..dot_i as usize]
                } else {
                    package_tag
                };

                if actual_tag != expected_tag {
                    continue;
                }
            }

            if Self::is_package_version_too_recent(package, min_age_ms) {
                prev_package_blocked_from_age = Some(package);
                continue;
            }

            // stability check - if the previous package is blocked from age, we need to check if the current package wasn't the cause
            if let Some(prev_package) = prev_package_blocked_from_age {
                // only try to go backwards for a max of 7 days on top of existing minimum age
                if package.publish_timestamp_ms < current_timestamp_ms - (min_age_ms + seven_days_ms) {
                    return FindVersionResult::FoundWithFilter {
                        result: best_version.unwrap_or(FindResult { version, package }),
                        newest_filtered: Some(dist_result.version),
                    };
                }

                let is_stable =
                    prev_package.publish_timestamp_ms - package.publish_timestamp_ms >= stability_window_ms;
                if is_stable {
                    return FindVersionResult::FoundWithFilter {
                        result: FindResult { version, package },
                        newest_filtered: Some(dist_result.version),
                    };
                } else {
                    if best_version.is_none() {
                        best_version = Some(FindResult { version, package });
                    }
                    prev_package_blocked_from_age = Some(package);
                    continue;
                }
            }

            best_version = Some(FindResult { version, package });
            break;
        }

        if let Some(result) = best_version {
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
        exclusions: Option<&[&[u8]]>,
    ) -> FindVersionResult<'_> {
        let min_age_gate_ms = match minimum_release_age_ms {
            Some(min_age_ms) if !self.should_exclude_from_age_filter(exclusions) => Some(min_age_ms),
            _ => None,
        };
        let Some(min_age_ms) = min_age_gate_ms else {
            let result = self.find_best_version(group, group_buf);
            if let Some(r) = result {
                return FindVersionResult::Found(r);
            }
            return FindVersionResult::Err(FindVersionError::NotFound);
        };
        debug_assert!(self.pkg.has_extended_manifest);

        let left = group.head.head.range.left;
        let mut newest_filtered: Option<Semver::Version> = None;

        if left.op == Semver::query::Op::Eql {
            let result = self.find_by_version(left.version);
            if let Some(r) = result {
                if Self::is_package_version_too_recent(r.package, min_age_ms) {
                    return FindVersionResult::Err(FindVersionError::TooRecent);
                }
                return FindVersionResult::Found(r);
            }
            return FindVersionResult::Err(FindVersionError::NotFound);
        }

        if let Some(result) = self.find_by_dist_tag(b"latest") {
            if group.satisfies(result.version, group_buf, &self.string_buf) {
                if Self::is_package_version_too_recent(result.package, min_age_ms) {
                    newest_filtered = Some(result.version);
                }
                if newest_filtered.is_none() {
                    if group.flags.is_set(Semver::query::Group::Flags::PRE) {
                        if left.version.order(&result.version, group_buf, &self.string_buf)
                            == core::cmp::Ordering::Equal
                        {
                            return FindVersionResult::Found(result);
                        }
                    } else {
                        return FindVersionResult::Found(result);
                    }
                }
            }
        }

        if let Some(result) = self.search_version_list(
            self.pkg.releases.keys.get(&self.versions),
            self.pkg.releases.values.get(&self.package_versions),
            group,
            group_buf,
            min_age_ms,
            &mut newest_filtered,
        ) {
            return result;
        }

        if group.flags.is_set(Semver::query::Group::Flags::PRE) {
            if let Some(result) = self.search_version_list(
                self.pkg.prereleases.keys.get(&self.versions),
                self.pkg.prereleases.values.get(&self.package_versions),
                group,
                group_buf,
                min_age_ms,
                &mut newest_filtered,
            ) {
                return result;
            }
        }

        if newest_filtered.is_some() {
            return FindVersionResult::Err(FindVersionError::AllVersionsTooRecent);
        }

        FindVersionResult::Err(FindVersionError::NotFound)
    }

    pub fn find_best_version(&self, group: &Semver::query::Group, group_buf: &[u8]) -> Option<FindResult<'_>> {
        let left = group.head.head.range.left;
        // Fast path: exact version
        if left.op == Semver::query::Op::Eql {
            return self.find_by_version(left.version);
        }

        if let Some(result) = self.find_by_dist_tag(b"latest") {
            if group.satisfies(result.version, group_buf, &self.string_buf) {
                if group.flags.is_set(Semver::query::Group::Flags::PRE) {
                    if left.version.order(&result.version, group_buf, &self.string_buf)
                        == core::cmp::Ordering::Equal
                    {
                        // if prerelease, use latest if semver+tag match range exactly
                        return Some(result);
                    }
                } else {
                    return Some(result);
                }
            }
        }

        {
            // This list is sorted at serialization time.
            let releases = self.pkg.releases.keys.get(&self.versions);
            let mut i = releases.len();

            while i > 0 {
                let version = releases[i - 1];

                if group.satisfies(version, group_buf, &self.string_buf) {
                    return Some(FindResult {
                        version,
                        package: &self.pkg.releases.values.get(&self.package_versions)[i - 1],
                    });
                }
                i -= 1;
            }
        }

        if group.flags.is_set(Semver::query::Group::Flags::PRE) {
            let prereleases = self.pkg.prereleases.keys.get(&self.versions);
            let mut i = prereleases.len();
            while i > 0 {
                let version = prereleases[i - 1];

                // This list is sorted at serialization time.
                if group.satisfies(version, group_buf, &self.string_buf) {
                    let packages = self.pkg.prereleases.values.get(&self.package_versions);
                    return Some(FindResult {
                        version,
                        package: &packages[i - 1],
                    });
                }
                i -= 1;
            }
        }

        None
    }
}

type ExternalStringMapDeduper = HashMap<u64, ExternalStringList, IdentityContext<u64>>;

struct DependencyGroup {
    prop: &'static str,
    field: &'static str,
}
const DEPENDENCY_GROUPS: [DependencyGroup; 3] = [
    DependencyGroup { prop: "dependencies", field: "dependencies" },
    DependencyGroup { prop: "optionalDependencies", field: "optional_dependencies" },
    DependencyGroup { prop: "peerDependencies", field: "peer_dependencies" },
];

impl PackageManifest {
    /// This parses [Abbreviated metadata](https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#abbreviated-metadata-format)
    pub fn parse(
        scope: &registry::Scope,
        log: &mut logger::Log,
        json_buffer: &[u8],
        expected_name: &[u8],
        last_modified: &[u8],
        etag: &[u8],
        public_max_age: u32,
        is_extended_manifest: bool,
    ) -> Result<Option<PackageManifest>, Error> {
        // TODO(port): narrow error set
        let source = logger::Source::init_path_string(expected_name, json_buffer);
        initialize_store();
        let _store_pop = scopeguard::guard((), |_| {
            // TODO(port): bun.ast.Stmt.Data.Store.memory_allocator.?.pop()
            bun_js_parser::ast::Stmt::Data::Store::memory_allocator().unwrap().pop();
        });
        // PERF(port): was arena bulk-free — profile in Phase B
        let json = match JSON::parse_utf8(&source, log) {
            Ok(j) => j,
            Err(_) => {
                // don't use the arena memory!
                let mut cloned_log = logger::Log::init();
                log.clone_to_with_recycled(&mut cloned_log, true)?;
                *log = cloned_log;
                return Ok(None);
            }
        };

        if let Some(error_q) = json.as_property("error") {
            if let Some(err) = error_q.expr.as_string() {
                log.add_error_fmt(&source, logger::Loc::EMPTY, format_args!("npm error: {}", bstr::BStr::new(err)))
                    .expect("unreachable");
                return Ok(None);
            }
        }

        let mut result: PackageManifest = PackageManifest::default();
        // TODO(port): bun.serializable() — zero-init for serialization determinism

        let mut string_pool = SemverString::Builder::StringPool::init();
        let mut all_extern_strings_dedupe_map = ExternalStringMapDeduper::default();
        let mut version_extern_strings_dedupe_map = ExternalStringMapDeduper::default();
        let mut optional_peer_dep_names: Vec<u64> = Vec::new();

        let mut bundled_deps_set = StringSet::init();
        let mut bundle_all_deps = false;

        let mut bundled_deps_count: usize = 0;

        let mut string_builder = SemverString::Builder {
            string_pool,
            ..Default::default()
        };

        if PackageManager::verbose_install() {
            if let Some(name_q) = json.as_property("name") {
                let Some(received_name) = name_q.expr.as_string() else {
                    return Ok(None);
                };
                // If this manifest is coming from the default registry, make sure it's the expected one. If it's not
                // from the default registry we don't check because the registry might have a different name in the manifest.
                // https://github.com/oven-sh/bun/issues/4925
                if scope.url_hash == *registry::DEFAULT_URL_HASH
                    && !strings::eql_long(expected_name, received_name, true)
                {
                    Output::warn(format_args!(
                        "Package name mismatch. Expected <b>\"{}\"<r> but received <red>\"{}\"<r>",
                        bstr::BStr::new(expected_name),
                        bstr::BStr::new(received_name),
                    ));
                }
            }
        }

        string_builder.count(expected_name);

        if let Some(name_q) = json.as_property("modified") {
            let Some(field) = name_q.expr.as_string() else {
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
            let Some(versions_q) = json.as_property("versions") else {
                break 'get_versions;
            };
            let JSON::ExprData::EObject(versions_obj) = &versions_q.expr.data else {
                break 'get_versions;
            };

            let versions = versions_obj.properties.slice();
            for prop in versions {
                let Some(version_name) = prop.key.as_ref().unwrap().as_string() else {
                    continue;
                };
                let sliced_version = SlicedString::init(version_name, version_name);
                let parsed_version = Semver::Version::parse(sliced_version);

                if cfg!(debug_assertions) {
                    debug_assert!(parsed_version.valid);
                }
                if !parsed_version.valid {
                    log.add_error_fmt(
                        &source,
                        prop.value.as_ref().unwrap().loc,
                        format_args!("Failed to parse dependency {}", bstr::BStr::new(version_name)),
                    )
                    .expect("unreachable");
                    continue;
                }

                if parsed_version.version.tag.has_pre() {
                    pre_versions_len += 1;
                    extern_string_count += 1;
                } else {
                    extern_string_count += (strings::index_of_char(version_name, b'+').is_some()) as usize;
                    release_versions_len += 1;
                }

                string_builder.count(version_name);

                if let Some(dist_q) = prop.value.as_ref().unwrap().as_property("dist") {
                    if let Some(tarball_prop) = dist_q.expr.get("tarball") {
                        if let JSON::ExprData::EString(s) = &tarball_prop.data {
                            let tarball = s.slice();
                            string_builder.count(tarball);
                            tarball_urls_count += (!tarball.is_empty()) as usize;
                        }
                    }
                }

                'bin: {
                    if let Some(bin) = prop.value.as_ref().unwrap().as_property("bin") {
                        match &bin.expr.data {
                            JSON::ExprData::EObject(obj) => {
                                match obj.properties.len() {
                                    0 => break 'bin,
                                    1 => {}
                                    _ => {
                                        extern_string_count_bin += obj.properties.len() * 2;
                                    }
                                }

                                for bin_prop in obj.properties.slice() {
                                    let Some(k) = bin_prop.key.as_ref().unwrap().as_string() else {
                                        break 'bin;
                                    };
                                    string_builder.count(k);
                                    let Some(v) = bin_prop.value.as_ref().unwrap().as_string() else {
                                        break 'bin;
                                    };
                                    string_builder.count(v);
                                }
                            }
                            JSON::ExprData::EString(_) => {
                                if let Some(str_) = bin.expr.as_string() {
                                    string_builder.count(str_);
                                    break 'bin;
                                }
                            }
                            _ => {}
                        }
                    }

                    if let Some(dirs) = prop.value.as_ref().unwrap().as_property("directories") {
                        if let Some(bin_prop) = dirs.expr.as_property("bin") {
                            if let Some(str_) = bin_prop.expr.as_string() {
                                string_builder.count(str_);
                                break 'bin;
                            }
                        }
                    }
                }

                bundled_deps_set.map.clear();
                bundle_all_deps = false;
                if let Some(bundled_deps_expr) = prop
                    .value
                    .as_ref()
                    .unwrap()
                    .get("bundleDependencies")
                    .or_else(|| prop.value.as_ref().unwrap().get("bundledDependencies"))
                {
                    match &bundled_deps_expr.data {
                        JSON::ExprData::EBoolean(boolean) => {
                            bundle_all_deps = boolean.value;
                        }
                        JSON::ExprData::EArray(arr) => {
                            for bundled_dep in arr.slice() {
                                let Some(s) = bundled_dep.as_string() else { continue };
                                bundled_deps_set.insert(s)?;
                            }
                        }
                        _ => {}
                    }
                }

                for pair in &DEPENDENCY_GROUPS {
                    // PERF(port): was comptime monomorphization — profile in Phase B
                    if let Some(versioned_deps) = prop.value.as_ref().unwrap().as_property(pair.prop) {
                        if let JSON::ExprData::EObject(obj) = &versioned_deps.expr.data {
                            dependency_sum += obj.properties.len();
                            let properties = obj.properties.slice();
                            for property in properties {
                                if let Some(key) = property.key.as_ref().unwrap().as_string() {
                                    if !bundle_all_deps && bundled_deps_set.swap_remove(key) {
                                        // swap remove the dependency name because it could exist in
                                        // multiple behavior groups.
                                        bundled_deps_count += 1;
                                    }
                                    string_builder.count(key);
                                    string_builder.count(
                                        property.value.as_ref().unwrap().as_string().unwrap_or(b""),
                                    );
                                }
                            }
                        }
                    }
                }

                // pnpm/yarn synthesise an implicit `"*"` optional peer for
                // entries that appear in `peerDependenciesMeta` but not in
                // `peerDependencies`. Reserve space for them; the build
                // pass below appends them after the declared peer deps.
                if let Some(meta) = prop.value.as_ref().unwrap().as_property("peerDependenciesMeta") {
                    if let JSON::ExprData::EObject(obj) = &meta.expr.data {
                        for meta_prop in obj.properties.slice() {
                            let Some(optional) = meta_prop.value.as_ref().unwrap().as_property("optional") else {
                                continue;
                            };
                            let JSON::ExprData::EBoolean(b) = &optional.expr.data else { continue };
                            if !b.value {
                                continue;
                            }
                            let Some(key) = meta_prop.key.as_ref().unwrap().as_string() else {
                                continue;
                            };
                            dependency_sum += 1;
                            string_builder.count(key);
                            string_builder.count(b"*");
                        }
                    }
                }
            }
        }

        extern_string_count += dependency_sum;

        let mut dist_tags_count: usize = 0;
        if let Some(dist) = json.as_property("dist-tags") {
            if let JSON::ExprData::EObject(obj) = &dist.expr.data {
                let tags = obj.properties.slice();
                for tag in tags {
                    if let Some(key) = tag.key.as_ref().unwrap().as_string() {
                        string_builder.count(key);
                        extern_string_count += 2;

                        string_builder.count(tag.value.as_ref().unwrap().as_string().unwrap_or(b""));
                        dist_tags_count += 1;
                    }
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
            vec![PackageVersion::default(); release_versions_len + pre_versions_len].into_boxed_slice();
        let all_semver_versions: Box<[Semver::Version]> =
            vec![Semver::Version::default(); release_versions_len + pre_versions_len + dist_tags_count]
                .into_boxed_slice();
        let mut all_extern_strings: Box<[ExternalString]> =
            vec![ExternalString::default(); extern_string_count + tarball_urls_count].into_boxed_slice();
        let mut version_extern_strings: Box<[ExternalString]> =
            vec![ExternalString::default(); dependency_sum].into_boxed_slice();
        let all_extern_strings_bin_entries: Box<[ExternalString]> =
            vec![ExternalString::default(); extern_string_count_bin].into_boxed_slice();
        let mut all_tarball_url_strings: Box<[ExternalString]> =
            vec![ExternalString::default(); tarball_urls_count].into_boxed_slice();
        let bundled_deps_buf: Box<[PackageNameHash]> =
            vec![PackageNameHash::default(); bundled_deps_count].into_boxed_slice();
        let mut bundled_deps_offset: usize = 0;

        // PORT NOTE: Zig manually @memset zeroed the buffers; Default::default() above achieves
        // the same determinism for these POD types.

        // PORT NOTE: reshaped for borrowck — Zig used overlapping mutable subslices into the
        // same allocation. Rust uses index cursors instead and re-slices on demand.
        let mut versioned_package_releases_start: usize = 0;
        let all_versioned_package_releases_range = 0..release_versions_len;
        let mut versioned_package_prereleases_start: usize = release_versions_len;
        let all_versioned_package_prereleases_range = release_versions_len..release_versions_len + pre_versions_len;

        // all_semver_versions layout: [releases | prereleases | dist_tags]
        let all_release_versions_range = 0..release_versions_len;
        let all_prerelease_versions_range = release_versions_len..release_versions_len + pre_versions_len;
        let dist_tag_versions_start = release_versions_len + pre_versions_len;
        // SAFETY: all_semver_versions is heap-allocated; we need disjoint mutable subslices.
        // TODO(port): use split_at_mut chain instead of raw pointers in Phase B.
        let all_semver_versions_ptr = all_semver_versions.as_ptr() as *mut Semver::Version;
        let mut release_versions_cursor: usize = 0;
        let mut prerelease_versions_cursor: usize = release_versions_len;

        let mut extern_strings_bin_entries_cursor: usize = 0;
        let mut tarball_url_strings_cursor: usize = 0;

        let mut extern_strings_consumed: usize = 0; // tracks `all_extern_strings.len - extern_strings.len`
        string_builder.cap += (string_builder.cap % 64) + 64;
        string_builder.cap *= 2;

        string_builder.allocate()?;

        let string_buf: &[u8] = if let Some(ptr) = string_builder.ptr() {
            // 0 it out for better determinism
            // SAFETY: ptr is a freshly allocated buffer of cap bytes
            unsafe { core::ptr::write_bytes(ptr, 0, string_builder.cap) };
            // SAFETY: ptr is valid for cap bytes
            unsafe { core::slice::from_raw_parts(ptr, string_builder.cap) }
        } else {
            b""
        };

        // Using `expected_name` instead of the name from the manifest. Custom registries might
        // have a different name than the dependency name in package.json.
        result.pkg.name = string_builder.append::<ExternalString>(expected_name);

        // Cursors into all_extern_strings / version_extern_strings for dependency name/value writes.
        let mut dependency_names_cursor: usize = 0; // into all_extern_strings[0..dependency_sum]
        let mut dependency_values_cursor: usize = 0; // into version_extern_strings
        let all_dependency_names_and_values_len = dependency_sum;

        'get_versions2: {
            let Some(versions_q) = json.as_property("versions") else {
                break 'get_versions2;
            };
            let JSON::ExprData::EObject(versions_obj) = &versions_q.expr.data else {
                break 'get_versions2;
            };

            let versions = versions_obj.properties.slice();

            // versions change more often than names
            // so names go last because we are better able to dedupe at the end
            let mut prev_extern_bin_group: Option<core::ops::Range<usize>> = None;
            let empty_version = PackageVersion {
                bin: Bin::init(),
                ..PackageVersion::default()
            };
            // TODO(port): bun.serializable() on empty_version

            for prop in versions {
                let Some(version_name) = prop.key.as_ref().unwrap().as_string() else {
                    continue;
                };
                let mut sliced_version = SlicedString::init(version_name, version_name);
                let mut parsed_version = Semver::Version::parse(sliced_version);

                if cfg!(debug_assertions) {
                    debug_assert!(parsed_version.valid);
                }
                // We only need to copy the version tags if it contains pre and/or build
                if parsed_version.version.tag.has_build() || parsed_version.version.tag.has_pre() {
                    let version_string = string_builder.append::<SemverString>(version_name);
                    sliced_version = version_string.sliced(string_buf);
                    parsed_version = Semver::Version::parse(sliced_version);
                    if cfg!(debug_assertions) {
                        debug_assert!(parsed_version.valid);
                        debug_assert!(
                            parsed_version.version.tag.has_build() || parsed_version.version.tag.has_pre()
                        );
                    }
                }
                if !parsed_version.valid {
                    continue;
                }

                bundled_deps_set.map.clear();
                bundle_all_deps = false;
                if let Some(bundled_deps_expr) = prop
                    .value
                    .as_ref()
                    .unwrap()
                    .get("bundleDependencies")
                    .or_else(|| prop.value.as_ref().unwrap().get("bundledDependencies"))
                {
                    match &bundled_deps_expr.data {
                        JSON::ExprData::EBoolean(boolean) => {
                            bundle_all_deps = boolean.value;
                        }
                        JSON::ExprData::EArray(arr) => {
                            for bundled_dep in arr.slice() {
                                let Some(s) = bundled_dep.as_string() else { continue };
                                bundled_deps_set.insert(s)?;
                            }
                        }
                        _ => {}
                    }
                }

                let mut package_version: PackageVersion = empty_version;

                if let Some(cpu_q) = prop.value.as_ref().unwrap().as_property("cpu") {
                    package_version.cpu = Negatable::<Architecture>::from_json(cpu_q.expr)?;
                }

                if let Some(os_q) = prop.value.as_ref().unwrap().as_property("os") {
                    package_version.os = Negatable::<OperatingSystem>::from_json(os_q.expr)?;
                }

                if let Some(libc) = prop.value.as_ref().unwrap().as_property("libc") {
                    package_version.libc = Negatable::<Libc>::from_json(libc.expr)?;
                }

                if let Some(has_install_script) = prop.value.as_ref().unwrap().as_property("hasInstallScript") {
                    if let JSON::ExprData::EBoolean(val) = &has_install_script.expr.data {
                        package_version.has_install_script = val.value;
                    }
                }

                'bin: {
                    // bins are extremely repetitive
                    // We try to avoid storing copies the string
                    if let Some(bin) = prop.value.as_ref().unwrap().as_property("bin") {
                        match &bin.expr.data {
                            JSON::ExprData::EObject(obj) => {
                                match obj.properties.len() {
                                    0 => {}
                                    1 => {
                                        let Some(bin_name) =
                                            obj.properties.ptr()[0].key.as_ref().unwrap().as_string()
                                        else {
                                            break 'bin;
                                        };
                                        let Some(value) =
                                            obj.properties.ptr()[0].value.as_ref().unwrap().as_string()
                                        else {
                                            break 'bin;
                                        };

                                        package_version.bin = Bin {
                                            tag: Bin::Tag::NamedFile,
                                            value: Bin::Value {
                                                named_file: [
                                                    string_builder.append::<SemverString>(bin_name),
                                                    string_builder.append::<SemverString>(value),
                                                ],
                                            },
                                        };
                                    }
                                    _ => {
                                        let group_start = extern_strings_bin_entries_cursor;
                                        let group_len = obj.properties.len() * 2;
                                        // SAFETY: all_extern_strings_bin_entries is heap-allocated and sized in counting pass
                                        let group_slice_ptr = unsafe {
                                            (all_extern_strings_bin_entries.as_ptr() as *mut ExternalString)
                                                .add(group_start)
                                        };

                                        let mut is_identical = match &prev_extern_bin_group {
                                            Some(r) => r.len() == group_len,
                                            None => false,
                                        };
                                        let mut group_i: u32 = 0;

                                        for bin_prop in obj.properties.slice() {
                                            let Some(k) = bin_prop.key.as_ref().unwrap().as_string() else {
                                                break 'bin;
                                            };
                                            // SAFETY: group_i < group_len by construction
                                            unsafe {
                                                *group_slice_ptr.add(group_i as usize) =
                                                    string_builder.append::<ExternalString>(k);
                                            }
                                            if is_identical {
                                                let prev = prev_extern_bin_group.as_ref().unwrap();
                                                // SAFETY: indices in range
                                                let cur = unsafe { *group_slice_ptr.add(group_i as usize) };
                                                let prev_item = all_extern_strings_bin_entries[prev.start + group_i as usize];
                                                is_identical = cur.hash == prev_item.hash;
                                                if cfg!(debug_assertions) && is_identical {
                                                    let first = cur.slice(string_builder.allocated_slice());
                                                    let second = prev_item.slice(string_builder.allocated_slice());
                                                    if !strings::eql_long(first, second, true) {
                                                        Output::panic(format_args!(
                                                            "Bin group is not identical: {} != {}",
                                                            bstr::BStr::new(first),
                                                            bstr::BStr::new(second),
                                                        ));
                                                    }
                                                }
                                            }
                                            group_i += 1;

                                            let Some(v) = bin_prop.value.as_ref().unwrap().as_string() else {
                                                break 'bin;
                                            };
                                            // SAFETY: group_i < group_len
                                            unsafe {
                                                *group_slice_ptr.add(group_i as usize) =
                                                    string_builder.append::<ExternalString>(v);
                                            }
                                            if is_identical {
                                                let prev = prev_extern_bin_group.as_ref().unwrap();
                                                // SAFETY: group_i < group_len; group_slice_ptr valid for group_len elements
                                                let cur = unsafe { *group_slice_ptr.add(group_i as usize) };
                                                let prev_item = all_extern_strings_bin_entries[prev.start + group_i as usize];
                                                is_identical = cur.hash == prev_item.hash;
                                                if cfg!(debug_assertions) && is_identical {
                                                    let first = cur.slice(string_builder.allocated_slice());
                                                    let second = prev_item.slice(string_builder.allocated_slice());
                                                    if !strings::eql_long(first, second, true) {
                                                        Output::panic(format_args!(
                                                            "Bin group is not identical: {} != {}",
                                                            bstr::BStr::new(first),
                                                            bstr::BStr::new(second),
                                                        ));
                                                    }
                                                }
                                            }
                                            group_i += 1;
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
                                            tag: Bin::Tag::Map,
                                            value: Bin::Value {
                                                map: ExternalStringList::init(
                                                    &all_extern_strings_bin_entries,
                                                    &all_extern_strings_bin_entries[final_range],
                                                ),
                                            },
                                        };
                                    }
                                }

                                break 'bin;
                            }
                            JSON::ExprData::EString(stri) => {
                                if !stri.data.is_empty() {
                                    package_version.bin = Bin {
                                        tag: Bin::Tag::File,
                                        value: Bin::Value {
                                            file: string_builder.append::<SemverString>(stri.data),
                                        },
                                    };
                                    break 'bin;
                                }
                            }
                            _ => {}
                        }
                    }

                    if let Some(dirs) = prop.value.as_ref().unwrap().as_property("directories") {
                        // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#directoriesbin
                        // Because of the way the bin directive works,
                        // specifying both a bin path and setting
                        // directories.bin is an error. If you want to
                        // specify individual files, use bin, and for all
                        // the files in an existing bin directory, use
                        // directories.bin.
                        if let Some(bin_prop) = dirs.expr.as_property("bin") {
                            if let Some(str_) = bin_prop.expr.as_string() {
                                if !str_.is_empty() {
                                    package_version.bin = Bin {
                                        tag: Bin::Tag::Dir,
                                        value: Bin::Value {
                                            dir: string_builder.append::<SemverString>(str_),
                                        },
                                    };
                                    break 'bin;
                                }
                            }
                        }
                    }
                }

                'integrity: {
                    if let Some(dist) = prop.value.as_ref().unwrap().as_property("dist") {
                        if let JSON::ExprData::EObject(_) = &dist.expr.data {
                            if let Some(tarball_q) = dist.expr.as_property("tarball") {
                                if let JSON::ExprData::EString(s) = &tarball_q.expr.data {
                                    if s.len() > 0 {
                                        package_version.tarball_url =
                                            string_builder.append::<ExternalString>(s.slice());
                                        all_tarball_url_strings[tarball_url_strings_cursor] =
                                            package_version.tarball_url;
                                        tarball_url_strings_cursor += 1;
                                    }
                                }
                            }

                            if let Some(file_count_) = dist.expr.as_property("fileCount") {
                                if let JSON::ExprData::ENumber(n) = &file_count_.expr.data {
                                    package_version.file_count = n.to_u32();
                                }
                            }

                            if let Some(file_count_) = dist.expr.as_property("unpackedSize") {
                                if let JSON::ExprData::ENumber(n) = &file_count_.expr.data {
                                    package_version.unpacked_size = n.to_u32();
                                }
                            }

                            if let Some(shasum) = dist.expr.as_property("integrity") {
                                if let Some(shasum_str) = shasum.expr.as_string() {
                                    package_version.integrity = Integrity::parse(shasum_str);
                                    if package_version.integrity.tag.is_supported() {
                                        break 'integrity;
                                    }
                                }
                            }

                            if let Some(shasum) = dist.expr.as_property("shasum") {
                                if let Some(shasum_str) = shasum.expr.as_string() {
                                    package_version.integrity =
                                        Integrity::parse_sha_sum(shasum_str).unwrap_or_default();
                                }
                            }
                        }
                    }
                }

                let mut non_optional_peer_dependency_offset: usize = 0;

                // PERF(port): was comptime monomorphization (`inline for`) — profile in Phase B
                for (group_idx, pair) in DEPENDENCY_GROUPS.iter().enumerate() {
                    let is_peer = pair.prop == "peerDependencies";
                    // For peer deps, fall through with an empty `items`
                    // slice when `peerDependencies` is absent so that
                    // `peerDependenciesMeta`-only entries (synthesised
                    // below) still get a build pass. The fallthrough must
                    // stay scoped to packages that actually have a
                    // `peerDependenciesMeta`: the body sets
                    // `package_version.bundled_dependencies` from this
                    // iteration's slice of `bundled_deps_buf`, so an
                    // unconditional empty pass would clobber the value the
                    // `dependencies` iteration just produced.
                    let items: &[JSON::Property] = 'items: {
                        if let Some(versioned_deps) = prop.value.as_ref().unwrap().as_property(pair.prop) {
                            if let JSON::ExprData::EObject(obj) = &versioned_deps.expr.data {
                                break 'items obj.properties.slice();
                            }
                        }
                        &[]
                    };
                    let has_meta_only_peers = is_peer && 'blk: {
                        let Some(meta) = prop.value.as_ref().unwrap().as_property("peerDependenciesMeta") else {
                            break 'blk false;
                        };
                        match &meta.expr.data {
                            JSON::ExprData::EObject(obj) => obj.properties.len() > 0,
                            _ => false,
                        }
                    };
                    if items.len() > 0 || has_meta_only_peers {
                        let mut count = items.len();

                        // PORT NOTE: reshaped for borrowck — index into all_extern_strings / version_extern_strings
                        let names_base = dependency_names_cursor;
                        let values_base = dependency_values_cursor;

                        let mut name_hasher = Wyhash11::init(0);
                        let mut version_hasher = Wyhash11::init(0);

                        if is_peer {
                            optional_peer_dep_names.clear();

                            if let Some(meta) = prop.value.as_ref().unwrap().as_property("peerDependenciesMeta") {
                                if let JSON::ExprData::EObject(obj) = &meta.expr.data {
                                    let meta_props = obj.properties.slice();
                                    optional_peer_dep_names.reserve(meta_props.len());
                                    // PERF(port): was assume_capacity
                                    for meta_prop in meta_props {
                                        if let Some(optional) =
                                            meta_prop.value.as_ref().unwrap().as_property("optional")
                                        {
                                            let JSON::ExprData::EBoolean(b) = &optional.expr.data else {
                                                continue;
                                            };
                                            if !b.value {
                                                continue;
                                            }

                                            let meta_key = meta_prop
                                                .key
                                                .as_ref()
                                                .unwrap()
                                                .as_string()
                                                .expect("unreachable");
                                            optional_peer_dep_names
                                                .push(SemverString::Builder::string_hash(meta_key));

                                            // Reserve a slot for a meta-only synthesised peer.
                                            // The slot is unused if `meta_key` also appears in
                                            // `peerDependencies` below.
                                            count += 1;
                                        }
                                    }
                                }
                            }
                        }

                        let bundled_deps_begin = bundled_deps_offset;

                        let mut i: usize = 0;

                        for item in items {
                            let name_str = match item.key.as_ref().unwrap().as_string() {
                                Some(s) => s,
                                None => {
                                    if cfg!(debug_assertions) {
                                        unreachable!()
                                    } else {
                                        continue;
                                    }
                                }
                            };
                            let version_str = match item.value.as_ref().unwrap().as_string() {
                                Some(s) => s,
                                None => {
                                    if cfg!(debug_assertions) {
                                        unreachable!()
                                    } else {
                                        continue;
                                    }
                                }
                            };

                            all_extern_strings[names_base + i] =
                                string_builder.append::<ExternalString>(name_str);
                            version_extern_strings[values_base + i] =
                                string_builder.append::<ExternalString>(version_str);

                            if !bundle_all_deps && bundled_deps_set.swap_remove(name_str) {
                                // SAFETY: bundled_deps_buf sized in counting pass
                                unsafe {
                                    *(bundled_deps_buf.as_ptr() as *mut PackageNameHash)
                                        .add(bundled_deps_offset) = all_extern_strings[names_base + i].hash;
                                }
                                bundled_deps_offset += 1;
                            }

                            if is_peer {
                                if optional_peer_dep_names
                                    .iter()
                                    .any(|h| *h == all_extern_strings[names_base + i].hash)
                                {
                                    // For optional peer dependencies, we store a length instead of a whole separate array
                                    // To make that work, we have to move optional peer dependencies to the front of the array
                                    //
                                    if non_optional_peer_dependency_offset != i {
                                        all_extern_strings
                                            .swap(names_base + i, names_base + non_optional_peer_dependency_offset);
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
                                let names_hash_bytes = all_extern_strings[names_base + i].hash.to_ne_bytes();
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
                            if let Some(meta) =
                                prop.value.as_ref().unwrap().as_property("peerDependenciesMeta")
                            {
                                if let JSON::ExprData::EObject(obj) = &meta.expr.data {
                                    'outer: for meta_prop in obj.properties.slice() {
                                        let Some(optional) =
                                            meta_prop.value.as_ref().unwrap().as_property("optional")
                                        else {
                                            continue;
                                        };
                                        let JSON::ExprData::EBoolean(b) = &optional.expr.data else {
                                            continue;
                                        };
                                        if !b.value {
                                            continue;
                                        }
                                        let Some(meta_key) = meta_prop.key.as_ref().unwrap().as_string()
                                        else {
                                            continue;
                                        };
                                        let meta_hash = SemverString::Builder::string_hash(meta_key);
                                        for existing in &all_extern_strings[names_base..names_base + i] {
                                            if existing.hash == meta_hash {
                                                continue 'outer;
                                            }
                                        }
                                        all_extern_strings[names_base + i] =
                                            string_builder.append::<ExternalString>(meta_key);
                                        version_extern_strings[values_base + i] =
                                            string_builder.append::<ExternalString>(b"*");
                                        // Swap to the optional-peer
                                        // prefix the rest of the loop
                                        // body would have produced.
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
                        }

                        count = i;
                        // The peer slice was over-reserved by the
                        // number of `peerDependenciesMeta` entries (so
                        // meta-only synthesised peers had room); trim
                        // to what was actually written before the
                        // ExternalStringList offsets are computed.
                        let this_names = &all_extern_strings[names_base..names_base + count];
                        let this_versions = &version_extern_strings[values_base..values_base + count];

                        // Bundled deps are matched against the
                        // `dependencies`/`optionalDependencies` groups
                        // only; the peer pass never adds to
                        // `bundled_deps_buf`. With the meta-only
                        // synthesis above the peer body now runs even
                        // when `peerDependencies` is absent, so writing
                        // here would clobber the value the dependencies
                        // pass already produced with an empty slice.
                        if !is_peer {
                            if bundle_all_deps {
                                package_version.bundled_dependencies = ExternalPackageNameHashList::INVALID;
                            } else {
                                package_version.bundled_dependencies = ExternalPackageNameHashList::init(
                                    &bundled_deps_buf,
                                    &bundled_deps_buf[bundled_deps_begin..bundled_deps_offset],
                                );
                            }
                        }

                        let mut name_list = ExternalStringList::init(&all_extern_strings, this_names);
                        let mut version_list = ExternalStringList::init(&version_extern_strings, this_versions);

                        if is_peer {
                            package_version.non_optional_peer_dependencies_start =
                                non_optional_peer_dependency_offset as u32;
                        }

                        if count > 0 && (!is_peer || optional_peer_dep_names.is_empty()) {
                            let name_map_hash = name_hasher.final_();
                            let version_map_hash = version_hasher.final_();

                            let name_entry = all_extern_strings_dedupe_map.get_or_put(name_map_hash)?;
                            if name_entry.found_existing {
                                name_list = *name_entry.value_ptr;
                                // this_names = name_list.mut(all_extern_strings) — only used in debug asserts below
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

                        let map = ExternalStringMap { name: name_list, value: version_list };
                        match group_idx {
                            0 => package_version.dependencies = map,
                            1 => package_version.optional_dependencies = map,
                            2 => package_version.peer_dependencies = map,
                            _ => unreachable!(),
                        }

                        // TODO(port): debug-assertions block (Zig lines 2478-2522) elided —
                        // it re-reads `this_names`/`this_versions` via `mut()` after dedupe.
                        // Phase B can re-add with cursor-based slicing.
                        let _ = (this_names, this_versions);
                    }
                }

                if let Some(time_obj) = json.as_property("time") {
                    if let Some(publish_time_expr) = time_obj.expr.get(version_name) {
                        if let Some(publish_time_str) = publish_time_expr.as_string() {
                            if let Ok(Some(time)) = bun_jsc::wtf::parse_es5_date(publish_time_str) {
                                // TODO(port): move to *_jsc — bun.jsc.wtf.parseES5Date
                                package_version.publish_timestamp_ms = time;
                            }
                        }
                    }
                }

                if !parsed_version.version.tag.has_pre() {
                    // SAFETY: cursor < release_versions_len by counting pass
                    unsafe {
                        *all_semver_versions_ptr.add(release_versions_cursor) = parsed_version.version.min();
                    }
                    versioned_packages[versioned_package_releases_start] = package_version;
                    release_versions_cursor += 1;
                    versioned_package_releases_start += 1;
                } else {
                    // SAFETY: cursor in prerelease range
                    unsafe {
                        *all_semver_versions_ptr.add(prerelease_versions_cursor) = parsed_version.version.min();
                    }
                    versioned_packages[versioned_package_prereleases_start] = package_version;
                    prerelease_versions_cursor += 1;
                    versioned_package_prereleases_start += 1;
                }
            }

            extern_strings_consumed = dependency_names_cursor;
            // version_extern_strings trimmed below
            // PORT NOTE: Zig: version_extern_strings = version_extern_strings[0 .. len - dependency_values.len]
        }
        let version_extern_strings_len = dependency_values_cursor;

        // extern_strings = all_extern_strings[all_dependency_names_and_values.len - dependency_names.len ..]
        let mut extern_strings_cursor = extern_strings_consumed;
        let _ = all_dependency_names_and_values_len;

        if let Some(dist) = json.as_property("dist-tags") {
            if let JSON::ExprData::EObject(obj) = &dist.expr.data {
                let tags = obj.properties.slice();
                let extern_strings_slice_start = extern_strings_cursor;
                let mut dist_tag_i: usize = 0;

                for tag in tags {
                    if let Some(key) = tag.key.as_ref().unwrap().as_string() {
                        all_extern_strings[extern_strings_slice_start + dist_tag_i] =
                            string_builder.append::<ExternalString>(key);

                        let Some(version_name) = tag.value.as_ref().unwrap().as_string() else {
                            continue;
                        };

                        let dist_tag_value_literal = string_builder.append::<ExternalString>(version_name);

                        let sliced_string = dist_tag_value_literal.value.sliced(string_buf);

                        // SAFETY: dist_tag_versions_start + dist_tag_i < all_semver_versions.len()
                        unsafe {
                            *all_semver_versions_ptr.add(dist_tag_versions_start + dist_tag_i) =
                                Semver::Version::parse(sliced_string).version.min();
                        }
                        dist_tag_i += 1;
                    }
                }

                result.pkg.dist_tags = DistTagMap {
                    tags: ExternalStringList::init(
                        &all_extern_strings,
                        &all_extern_strings[extern_strings_slice_start..extern_strings_slice_start + dist_tag_i],
                    ),
                    versions: VersionSlice::init(
                        &all_semver_versions,
                        &all_semver_versions[dist_tag_versions_start..dist_tag_versions_start + dist_tag_i],
                    ),
                };

                if cfg!(debug_assertions) {
                    // TODO(port): std.meta.eql sanity checks elided
                }

                extern_strings_cursor += dist_tag_i;
            }
        }

        if !last_modified.is_empty() {
            result.pkg.last_modified = string_builder.append::<SemverString>(last_modified);
        }

        if !etag.is_empty() {
            result.pkg.etag = string_builder.append::<SemverString>(etag);
        }

        if let Some(name_q) = json.as_property("modified") {
            let Some(field) = name_q.expr.as_string() else {
                return Ok(None);
            };
            result.pkg.modified = string_builder.append::<SemverString>(field);
        }

        result.pkg.releases.keys =
            VersionSlice::init(&all_semver_versions, &all_semver_versions[all_release_versions_range.clone()]);
        result.pkg.releases.values = PackageVersionList::init(
            &versioned_packages,
            &versioned_packages[all_versioned_package_releases_range.clone()],
        );

        result.pkg.prereleases.keys =
            VersionSlice::init(&all_semver_versions, &all_semver_versions[all_prerelease_versions_range.clone()]);
        result.pkg.prereleases.values = PackageVersionList::init(
            &versioned_packages,
            &versioned_packages[all_versioned_package_prereleases_range.clone()],
        );

        let max_versions_count = all_release_versions_range.len().max(all_prerelease_versions_range.len());

        // Sort the list of packages in a deterministic order
        // Usually, npm will do this for us.
        // But, not always.
        // See https://github.com/oven-sh/bun/pull/6611
        //
        // The tricky part about this code is we need to sort two different arrays.
        // To do that, we create a 3rd array, containing indices into the other 2 arrays.
        // Creating a 3rd array is expensive! But mostly expensive if the size of the integers is large
        // Most packages don't have > 65,000 versions
        // So instead of having a hardcoded limit of how many packages we can sort, we ask
        //    > "How many bytes do we need to store the indices?"
        // We decide what size of integer to use based on that.
        let how_many_bytes_to_store_indices: usize = match max_versions_count {
            // log2(0) == Infinity
            0 => 0,
            // log2(1) == 0
            1 => 1,
            n => {
                // ceil(log2_int_ceil(n) / 8)
                let bits = (usize::BITS - (n - 1).leading_zeros()) as usize;
                (bits + 7) / 8
            }
        };

        // PERF(port): was comptime monomorphization over Int width — using a macro to expand
        // the 1..=8 byte cases. Phase B may collapse to a single usize path if profiling allows.
        macro_rules! sort_with_int {
            ($Int:ty) => {{
                type Int = $Int;

                let mut all_indices: Vec<Int> = vec![0 as Int; max_versions_count];
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
                    // SAFETY: ExternalSlice points into versioned_packages / all_semver_versions
                    // which we own mutably here. @constCast equivalent.
                    let versioned_packages_ = unsafe {
                        core::slice::from_raw_parts_mut(
                            (versioned_packages.as_ptr() as *mut PackageVersion)
                                .add(release.values.off as usize),
                            len,
                        )
                    };
                    let semver_versions_ = unsafe {
                        core::slice::from_raw_parts_mut(
                            all_semver_versions_ptr.add(release.keys.off as usize),
                            len,
                        )
                    };
                    cloned_packages.copy_from_slice(versioned_packages_);
                    cloned_versions.copy_from_slice(semver_versions_);

                    for (i, dest) in indices.iter_mut().enumerate() {
                        *dest = i as Int;
                    }

                    let string_bytes = string_buf;
                    indices.sort_by(|&left, &right| {
                        cloned_versions[left as usize].order(
                            &cloned_versions[right as usize],
                            string_bytes,
                            string_bytes,
                        )
                    });
                    // PORT NOTE: Zig sorted indices against semver_versions_ (which is unmutated
                    // until after sort) — equivalent to sorting against cloned_versions.

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
                            // version
                            let first = semver_versions_[0];
                            let second = semver_versions_[1];
                            let order = second.order(&first, string_buf, string_buf);
                            debug_assert!(order == core::cmp::Ordering::Greater);
                        }
                    }
                }
            }};
        }

        match how_many_bytes_to_store_indices {
            1 => sort_with_int!(u8),
            2 => sort_with_int!(u16),
            3 => sort_with_int!(u32), // TODO(port): Zig used u24; Rust has no u24, use u32
            4 => sort_with_int!(u32),
            5 | 6 | 7 | 8 => sort_with_int!(u64),
            _ => {
                debug_assert!(max_versions_count == 0);
            }
        }

        let extern_strings_remaining = all_extern_strings.len() - extern_strings_cursor;
        if extern_strings_remaining + tarball_urls_count > 0 {
            let src_len = tarball_url_strings_cursor;
            if src_len > 0 {
                // SAFETY: both are POD ExternalString slices
                let src = unsafe {
                    core::slice::from_raw_parts(
                        all_tarball_url_strings.as_ptr() as *const u8,
                        src_len * core::mem::size_of::<ExternalString>(),
                    )
                };
                let dst_start = extern_strings_cursor * core::mem::size_of::<ExternalString>();
                // SAFETY: all_extern_strings owns the buffer
                let dst = unsafe {
                    core::slice::from_raw_parts_mut(
                        (all_extern_strings.as_ptr() as *mut u8).add(dst_start),
                        all_extern_strings.len() * core::mem::size_of::<ExternalString>() - dst_start,
                    )
                };
                debug_assert!(dst.len() >= src.len());
                dst[..src.len()].copy_from_slice(src);
            }

            // all_extern_strings = all_extern_strings[0 .. len - extern_strings_remaining]
            // PORT NOTE: trim by truncating the boxed slice via Vec round-trip
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

        if let Some(ptr) = string_builder.ptr() {
            // SAFETY: ptr is valid for string_builder.len bytes; ownership transfers to result
            // TODO(port): string_builder owns this allocation; need into_owned() that yields Box<[u8]>
            result.string_buf =
                unsafe { core::slice::from_raw_parts(ptr, string_builder.len) }.into();
        }

        let _ = (string_pool, all_tarball_url_strings); // suppress unused-mut warnings in Phase A

        Ok(Some(result))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/npm.zig (2775 lines)
//   confidence: medium
//   todos:      24
//   notes:      parse() heavily reshaped for borrowck (cursor indices vs overlapping subslices); Serializer field-order reflection hardcoded; SaveTask scope lifetime crosses thread boundary; verify in Phase B
// ──────────────────────────────────────────────────────────────────────────

