use bun_collections::VecExt;
use core::ffi::c_void;
use std::io::Write as _;

use crate::bun_json as JSON;
use crate::bun_schema::api;
use bun_alloc::AllocError;
use bun_collections::{HashMap, StringSet};
use bun_core::{Error, Global, Output, err, fmt as bun_fmt};
use bun_core::{MutableString, strings};
use bun_dotenv::Loader as DotEnv;
use bun_http::{self as http, AsyncHTTP, HTTPClient, HeaderBuilder};
use bun_picohttp as picohttp;
use bun_semver::{self as Semver, ExternalString, SlicedString, String as SemverString};
use bun_sys::{self, CloseOnDrop, Fd, File};
use bun_threading::ThreadPool;
use bun_url::{OwnedURL, URL};
use bun_wyhash::Wyhash11;

use crate::bin::{self, Bin};
use crate::external_slice::ExternalPackageNameHashList;
use crate::integrity::Integrity;
use crate::{
    Aligner, ExternalSlice, ExternalStringList, ExternalStringMap, IdentityContext, PackageManager,
    PackageNameHash, VersionSlice, initialize_mini_store as initialize_store,
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

    if registry.token.is_empty() {
        return Err(WhoamiError::NeedAuth);
    }

    let auth_type: &[u8] = match &manager.options.publish_config.auth_type {
        Some(auth_type) => auth_type.as_str().as_bytes(),
        None => b"web",
    };
    let ci_name = crate::ci_info::detect_ci_name();

    let mut print_buf: Vec<u8> = Vec::new();

    let mut headers = HeaderBuilder::default();

    {
        headers.count("accept", "*/*");
        headers.count("accept-encoding", "gzip,deflate");

        write!(
            &mut print_buf,
            "Bearer {}",
            bstr::BStr::new(&registry.token)
        )
        .expect("infallible: in-memory write");
        headers.count("authorization", &print_buf);
        print_buf.clear();

        // no otp needed, just use auth-type from options
        headers.count("npm-auth-type", auth_type);
        headers.count("npm-command", "whoami");

        write!(
            &mut print_buf,
            "{} {} {} workspaces/{}{}{}",
            Global::user_agent,
            Global::os_name,
            Global::arch_name,
            // TODO: figure out how npm determines workspaces=true
            false,
            if ci_name.is_some() { " ci/" } else { "" },
            bstr::BStr::new(ci_name.unwrap_or(b"")),
        )
        .unwrap();
        headers.count("user-agent", &print_buf);
        print_buf.clear();

        headers.count("Connection", "keep-alive");
        headers.count("Host", registry_url.host);
    }

    headers.allocate()?;

    {
        headers.append("accept", "*/*");
        headers.append("accept-encoding", "gzip/deflate");

        write!(
            &mut print_buf,
            "Bearer {}",
            bstr::BStr::new(&registry.token)
        )
        .expect("infallible: in-memory write");
        headers.append("authorization", &print_buf);
        print_buf.clear();

        headers.append("npm-auth-type", auth_type);
        headers.append("npm-command", "whoami");

        write!(
            &mut print_buf,
            "{} {} {} workspaces/{}{}{}",
            Global::user_agent,
            Global::os_name,
            Global::arch_name,
            false,
            if ci_name.is_some() { " ci/" } else { "" },
            bstr::BStr::new(ci_name.unwrap_or(b"")),
        )
        .unwrap();
        headers.append("user-agent", &print_buf);
        print_buf.clear();

        headers.append("Connection", "keep-alive");
        headers.append("Host", registry_url.host);
    }

    write!(
        &mut print_buf,
        "{}/-/whoami",
        bstr::BStr::new(strings::without_trailing_slash(registry_url.href)),
    )
    .unwrap();

    let mut response_buf = MutableString::init(1024)?;

    // `print_buf` stays live on this frame until after `req.send_sync()`
    // returns (Zig: `defer print_buf.deinit()`, npm.zig:25). `init_sync`
    // borrows the URL/header buffers for the duration of the synchronous
    // request only.
    let url = URL::parse(&print_buf);

    // `headers.allocate()` set `content.ptr` to a valid `content.len`-byte
    // allocation; `headers` outlives `req`. `written_slice()` is the safe
    // nonnull-asref accessor over the set-once `Option<NonNull<u8>>` (returns
    // `&[]` when unallocated, matching the previous `None => b""` arm).
    let header_buf: &[u8] = headers.content.written_slice();

    let mut req = AsyncHTTP::init_sync(
        http::Method::GET,
        url,
        headers.entries,
        header_buf,
        &raw mut response_buf,
        b"",
        None,
        None,
        http::FetchRedirect::Follow,
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

    if let Some(notice) = res
        .headers
        .get_if_other_is_absent(b"npm-notice", b"x-local-cache")
    {
        Output::print_error("\n");
        Output::note(format_args!("{}", bstr::BStr::new(notice)));
        Output::flush();
    }

    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string("???", response_buf.list.as_slice());
    let bump = bun_alloc::Arena::new();
    let json = match JSON::parse_utf8(&source, &mut log, &bump) {
        Ok(j) => j,
        Err(e) if e == err!("OutOfMemory") => return Err(WhoamiError::OutOfMemory),
        Err(e) => {
            Output::err(
                e,
                "failed to parse '/-/whoami' response body as JSON",
                format_args!(""),
            );
            Global::crash();
        }
    };

    let Some(username) = json.get(b"username").and_then(|e| e.as_string(&bump)) else {
        // no username, invalid auth probably
        return Err(WhoamiError::ProbablyInvalidAuth);
    };
    Ok(username.to_vec())
}

// TODO(b2): body gated — picohttp::Response field shape drift

pub fn response_error<const OTP_RESPONSE: bool>(
    req: &AsyncHTTP,
    res: &picohttp::Response,
    // `<name>@<version>`
    pkg_id: Option<(&[u8], &[u8])>,
    response_body: &mut MutableString,
) -> Result<core::convert::Infallible, AllocError> {
    let message: Option<Vec<u8>> = 'message: {
        let mut log = bun_ast::Log::init();
        let source = bun_ast::Source::init_path_string("???", response_body.list.as_slice());
        let bump = bun_alloc::Arena::new();
        let json = match JSON::parse_utf8(&source, &mut log, &bump) {
            Ok(j) => j,
            Err(e) if e == err!("OutOfMemory") => return Err(AllocError),
            Err(_) => break 'message None,
        };

        let Some(error) = json.get(b"error").and_then(|e| e.as_string(&bump)) else {
            break 'message None;
        };
        Some(error.to_vec())
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
                Output::pretty_errorln("\n - Received invalid OTP");
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

    // Single source of truth lives in `bun_install_types` (lower-tier crate so
    // `ini`/`options_types` can read it without depending on the full package
    // manager). Re-exported here as the same surface (`&str` const + `LazyLock`)
    // so existing `Npm::Registry::DEFAULT_URL` / `*DEFAULT_URL_HASH` callers are
    // untouched.
    pub const DEFAULT_URL: &str = bun_install_types::NodeLinker::npm::Registry::DEFAULT_URL;
    pub static DEFAULT_URL_HASH: std::sync::LazyLock<u64> =
        std::sync::LazyLock::new(bun_install_types::NodeLinker::npm::Registry::default_url_hash);
    pub fn default_url_hash() -> u64 {
        *DEFAULT_URL_HASH
    }

    // Zig: `ObjectPool(MutableString, MutableString.init2048, true, 8)`.
    // `MutableString: ObjectPoolType` (init = init2048) is provided in
    // bun_string; the `object_pool!` macro generates the per-monomorphization
    // thread-local storage so `BodyPool::get()` doesn't hit `UnwiredStorage`'s
    // `unreachable!()`.
    bun_collections::object_pool!(pub BodyPool: MutableString, threadsafe, 8);

    #[derive(Default, Clone)]
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
        pub url: OwnedURL,
        pub url_hash: u64,
        pub token: Box<[u8]>,

        // username and password combo, `user:pass`
        pub user: Box<[u8]>,
    }

    impl Scope {
        pub fn hash(str: &[u8]) -> u64 {
            bun_semver::semver_string::Builder::string_hash(str)
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
            if strings::starts_with_char(&registry.url, b'$') {
                // If it became "$ENV_VAR/", then we need to remove the trailing slash
                if let Some(replaced_url) = env.get(strings::trim(&registry.url[1..], b"/")) {
                    if replaced_url.len() > 1 {
                        registry.url = replaced_url.into();
                    }
                }
            }

            // PORT NOTE: Zig's `URL.parse(registry.url)` borrows the input
            // `[]const u8`; here `url` borrows the owned `registry_url` buffer
            // for the duration of parsing. The final href is moved into
            // `Scope.url: OwnedURL` (owned `Box<[u8]>`).
            let registry_url: Box<[u8]> = core::mem::take(&mut registry.url);
            let mut url = URL::parse(&registry_url);
            let mut auth: &[u8] = b"";
            let mut user: &mut [u8] = &mut [];
            let mut needs_normalize = false;

            // Backing storage for `user`/`auth` when synthesized from
            // username:password (Zig used a single `default_allocator.alloc`).
            let mut output_buf_owned: Box<[u8]> = Box::default();

            if registry.token.is_empty() {
                'outer: {
                    if registry.password.is_empty() {
                        let mut pathname: &[u8] = url.pathname;
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
                                registry.token = value.into();
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
                                registry.username = value.into();
                                continue;
                            }

                            if segment == b"_password" {
                                registry.password = value.into();
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
                                        registry.token = value.into();
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
                                        registry.username = value.into();
                                        pathname = &pathname[..last_slash as usize + 1];
                                        needs_normalize = true;
                                        url.pathname = pathname.into();
                                        url.path = pathname.into();
                                        break 'outer;
                                    }

                                    if segment == b"_password" {
                                        registry.password = value.into();
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

                    registry.username = env.get_auto(&registry.username).into();
                    registry.password = env.get_auto(&registry.password).into();

                    if !registry.username.is_empty()
                        && !registry.password.is_empty()
                        && auth.is_empty()
                    {
                        let combo_len = registry.username.len() + registry.password.len() + 1;
                        let total =
                            combo_len + bun_core::base64::standard_encoder_calc_size(combo_len);
                        output_buf_owned = vec![0u8; total].into_boxed_slice();
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

            registry.token = env.get_auto(&registry.token).into();

            // Copy `auth`/`user` into owned buffers now so the borrows of
            // `registry_url` / `output_buf_owned` are released before
            // `registry_url` is moved into `final_href` below.
            let auth: Box<[u8]> = Box::from(auth);
            let user: Box<[u8]> = Box::from(&*user);
            drop(output_buf_owned);

            let final_href: Box<[u8]> = if needs_normalize {
                url.href_without_auth()
            } else {
                // PORT NOTE: reshaped for borrowck — `url` (borrowing
                // `registry_url`) is dead on this branch (every path that
                // mutated `url.pathname` also set `needs_normalize = true`).
                registry_url
            };

            let url_hash = Self::hash(strings::without_trailing_slash(&final_href));

            Ok(Scope {
                name: name.into(),
                url: OwnedURL::from_href(final_href),
                url_hash,
                token: registry.token,
                auth,
                user,
            })
        }
    }

    // TODO(b2): Zig used `IdentityContext(u64)` hasher; std HashMap is fine for now.
    pub type Map = HashMap<u64, Scope>;

    pub enum PackageVersionResponse {
        Cached(PackageManifest),
        Fresh(PackageManifest),
        NotFound,
    }

    pub fn get_package_metadata(
        scope: &Scope,
        response: picohttp::Response,
        body: &[u8],
        log: &mut bun_ast::Log,
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
            (u64::try_from(bun_core::time::timestamp().max(0)).expect("int cast") as u32) + 300,
            is_extended_manifest,
        )? {
            if package_manager.options.enable.manifest_cache() {
                package_manifest::Serializer::save_async(
                    &package,
                    scope,
                    package_manager.get_temporary_directory().handle.fd,
                    package_manager.get_cache_directory().fd,
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

/// Port of `Negatable(T).fromJson` (src/install/npm.zig). Lives here (not in
/// `bun_install_types`) because `bun_ast::Expr` is not reachable from that crate.
pub fn negatable_from_json<T: NegatableEnum>(expr: &JSON::Expr) -> Result<T, AllocError> {
    let mut this = T::NONE.negatable();
    if let JSON::ExprData::EArray(a) = &expr.data {
        for item in a.items.slice() {
            // JSON parsed via `parse_utf8` always yields UTF-8 EStrings,
            // so no transcode allocator is needed (Zig: asString(allocator)).
            if let Some(value) = item.as_utf8_string_literal() {
                this.apply(value);
            }
        }
    } else if let Some(str) = expr.as_utf8_string_literal() {
        this.apply(str);
    }

    Ok(this.combine())
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

    /// Port of Zig's `@field(package_version, group.field)` reflection used by
    /// `Package.fromNPM` to walk dependency groups by name.
    pub fn dep_group(&self, field: &[u8]) -> ExternalStringMap {
        match field {
            b"dependencies" => self.dependencies,
            b"dev_dependencies" => self.dev_dependencies,
            b"optional_dependencies" => self.optional_dependencies,
            b"peer_dependencies" => self.peer_dependencies,
            _ => unreachable!("PackageVersion::dep_group: unknown field"),
        }
    }
}

// Layout pin (mirrors Zig `comptime { if (@sizeOf(Npm.PackageVersion) != 240) @compileError(...) }`).
// `PackageVersion` is `std.mem.sliceAsBytes`-serialised into the on-disk
// `.npm` manifest cache, so its size and field offsets are an ABI contract
// with every Zig-built Bun that wrote a cache entry. A mismatch here means a
// cross-runtime cache read will mis-slice — fail loudly at compile time
// instead. (Full per-type asserts live in `padding_checker::layout_asserts`.)
const _: () = assert!(
    core::mem::size_of::<PackageVersion>() == 240,
    "Npm.PackageVersion layout drifted from Zig spec (expected 240 bytes); \
     bump PackageManifest::Serializer::VERSION if intentional",
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
    // Explicit padding so this struct has no implicit (uninitialized) padding
    // bytes — `Serializer::write` reinterprets the whole struct as `&[u8]`,
    // and reading uninitialized padding as `u8` is UB. With explicit `[u8; N]`
    // fields, `Default` zero-fills them and every byte of the struct is
    // initialized. Layout (size=120, align=8) is unchanged; see the
    // `offset_of!` asserts below and `padding_checker.rs` for the contract.
    pub _padding_after_max_age: [u8; 4],

    pub name: ExternalString,

    pub releases: ExternVersionMap,
    pub prereleases: ExternVersionMap,
    pub dist_tags: DistTagMap,

    pub versions_buf: VersionSlice,
    pub string_lists_buf: ExternalStringList,

    // Flag to indicate if we have timestamp data from extended manifest
    pub has_extended_manifest: bool,
    pub _padding_tail: [u8; 7],
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

    // TODO(b2): bun_io::DiscardingWriter — counting writer not exposed yet

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
    use bun_io::Write as _;

    // bindings — see bun_install_jsc::npm_jsc::ManifestBindings (deleted *_jsc alias)

    pub struct Serializer;

    impl Serializer {
        // - v0.0.3: added serialization of registry url. it's used to invalidate when it changes
        // - v0.0.4: fixed bug with cpu & os tag not being added correctly
        // - v0.0.5: added bundled dependencies
        // - v0.0.6: changed semver major/minor/patch to each use u64 instead of u32
        // - v0.0.7: added version publish times and extended manifest flag for minimum release age
        pub const VERSION: &'static str = "bun-npm-manifest-cache-v0.0.7\n";
        const HEADER_BYTES: &'static str =
            concat!("#!/usr/bin/env bun\n", "bun-npm-manifest-cache-v0.0.7\n");

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
    }

    const _: () = assert!(
        Serializer::HEADER_BYTES.len() == 49,
        "header bytes must be exactly 49 bytes long, length is not serialized"
    );

    impl Serializer {
        pub fn write_array<W: bun_io::Write, T: Copy>(
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

        pub fn read_array<'a, T: Copy>(
            stream: &mut bun_io::FixedBufferStream<&'a [u8]>,
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
                bun_core::ffi::slice(
                    result_bytes.as_ptr().cast::<T>(),
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
            writer.write_int_le::<u64>(
                strings::without_trailing_slash(scope.url.href()).len() as u64
            )?;

            pos += 128 / 8;

            // TODO(port): inline-for over SIZES_FIELDS — unrolled by hand. Phase B: verify field
            // order matches Zig comptime sort (descending alignment).
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
                                    Output::note(
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

            {
                // errdefer file.close()
                let guard = CloseOnDrop::file(&file);
                file.write_all(&buffer)?;
                let _ = guard.into_inner();
            }

            #[cfg(windows)]
            {
                let mut realpath2_buf = bun_paths::PathBuffer::uninit();
                // errdefer if (!did_close) file.close() — disarmed once we close explicitly below.
                let guard = CloseOnDrop::file(&file);

                let cache_dir_abs = &PackageManager::get().cache_directory_path;
                let cache_path_abs =
                    bun_paths::resolve_path::join_abs_string_buf_z::<bun_paths::platform::Auto>(
                        cache_dir_abs,
                        &mut realpath2_buf[..],
                        &[cache_dir_abs, outpath.as_bytes()],
                    );
                let _ = guard.into_inner();
                // Zig spec discards the close error too — the renameat
                // immediately below surfaces a usable error if the temp
                // file is in a bad state, and on POSIX the close cannot
                // fail for a regular-file fd we just wrote.
                let _ = file.close();
                bun_sys::renameat(
                    Fd::cwd(),
                    path_to_use_for_opening_file,
                    Fd::cwd(),
                    cache_path_abs,
                )?;
                return Ok(());
            }

            #[cfg(target_os = "linux")]
            if is_using_o_tmpfile {
                let _close = CloseOnDrop::file(&file);
                // Attempt #1.
                if bun_sys::linkat_tmpfile(file.handle, cache_dir, outpath).is_err() {
                    // Attempt #2: the file may already exist. Let's unlink and try again.
                    let _ = bun_sys::unlinkat(cache_dir, outpath);
                    bun_sys::linkat_tmpfile(file.handle, cache_dir, outpath)?;
                    // There is no attempt #3. This is a cache, so it's not essential.
                }
                return Ok(());
            }

            #[cfg(not(windows))]
            {
                let _close = CloseOnDrop::file(&file);
                // Attempt #1. Rename the file.
                let rc = bun_sys::renameat(tmpdir, tmp_path, cache_dir, outpath);

                match &rc {
                    bun_sys::Result::Err(err) => {
                        // Fallback path: atomically swap from <tmp>/*.npm -> <cache>/*.npm, then unlink the temporary file.
                        // If atomically swapping fails, then we should still unlink the temporary file as a courtesy.
                        scopeguard::defer! {
                            let _ = bun_sys::unlinkat(tmpdir, tmp_path);
                        }

                        // Zig (npm.zig:1128) matches `.OPNOTSUPP`, which on
                        // Darwin is errno **45** (collapsed with NOTSUP). The
                        // Rust `Errno::EOPNOTSUPP` resolves to 102 on Darwin,
                        // so match `ENOTSUP` as well to keep the macOS
                        // `renameat2(.exchange)` fallback reachable. On
                        // Linux/FreeBSD the two names alias the same value;
                        // the redundant arm is intentional.
                        #[allow(unreachable_patterns)]
                        if matches!(
                            err.get_errno(),
                            bun_sys::Errno::EEXIST
                                | bun_sys::Errno::ENOTEMPTY
                                | bun_sys::Errno::ENOTSUP
                                | bun_sys::Errno::EOPNOTSUPP
                        ) {
                            // Atomically swap the old file with the new file.
                            bun_sys::renameat2(
                                tmpdir,
                                tmp_path,
                                cache_dir,
                                outpath,
                                bun_sys::Renameat2Flags {
                                    exchange: true,
                                    ..Default::default()
                                },
                            )?;

                            // Success.
                            return Ok(());
                        }
                    }
                    bun_sys::Result::Ok(()) => {}
                }

                rc?;
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
            use bun_threading::thread_pool::{
                Batch as PoolBatch, Node as PoolNode, Task as PoolTask,
            };

            pub struct SaveTask<'a> {
                manifest: PackageManifest,
                scope: &'a registry::Scope,
                tmpdir: Fd,
                cache_dir: Fd,

                task: PoolTask,
            }

            bun_threading::intrusive_work_task!(['a] SaveTask<'a>, task);

            impl<'a> SaveTask<'a> {
                pub fn new(init: SaveTask<'a>) -> Box<SaveTask<'a>> {
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
                pub fn run(task: *mut PoolTask) {
                    use bun_threading::IntrusiveWorkTask as _;
                    let _tracer = bun_core::perf::trace("PackageManifest.Serializer.save");

                    // SAFETY: thread-pool callback contract — `task` points to
                    // `SaveTask.task`; allocated via `heap::into_raw` in `save_async`.
                    let save_task = unsafe { bun_core::heap::take(SaveTask::from_task_ptr(task)) };

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
            let task = bun_core::heap::into_raw(SaveTask::new(SaveTask {
                manifest: this.clone(), // TODO(port): Zig copied PackageManifest by value
                scope,
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
            use core::fmt::Write as _;
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

        pub fn save(
            this: &PackageManifest,
            scope: &registry::Scope,
            tmpdir: Fd,
            cache_dir: Fd,
        ) -> Result<(), Error> {
            let file_id = Wyhash11::hash(0, this.name());
            let mut dest_path_buf = [0u8; 512 + 64];
            let mut out_path_buf =
                [0u8; ("18446744073709551615".len() * 2) + "_".len() + ".npm".len() + 1];
            let mut dest_path_stream = bun_io::FixedBufferStream::new_mut(&mut dest_path_buf);
            let file_id_hex_fmt = bun_fmt::hex_int_lower::<16>(file_id);
            let hex_timestamp: usize =
                usize::try_from(bun_core::time::milli_timestamp().max(0)).expect("int cast");
            let hex_timestamp_fmt = bun_fmt::hex_int_lower::<16>(hex_timestamp as u64);
            write!(
                dest_path_stream,
                "{}.npm-{}",
                file_id_hex_fmt, hex_timestamp_fmt
            )?;
            dest_path_stream.write_byte(0)?;
            let pos = dest_path_stream.pos;
            let tmp_path = bun_core::ZStr::from_buf_mut(&mut dest_path_buf, pos - 1);
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
            let Ok(cache_file) = File::openat(cache_dir, file_name, bun_sys::O::RDONLY, 0) else {
                return Ok(None);
            };
            let _close_cache_file = CloseOnDrop::file(&cache_file);

            'delete: {
                match Self::load_by_file(scope, &cache_file) {
                    Ok(Some(m)) => return Ok(Some(m)),
                    Ok(None) | Err(_) => break 'delete,
                }
            }

            // delete the outdated/invalid manifest
            bun_sys::unlinkat(cache_dir, file_name)?;
            Ok(None)
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

            // TODO(port): manifest borrows `bytes` in Zig; here read_all copies into Box<[T]>.
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

            let mut package_manifest = PackageManifest::default();

            let registry_hash = pkg_stream.read_int_le::<u64>()?;
            if scope.url_hash != registry_hash {
                return Ok(None);
            }

            let registry_length = pkg_stream.read_int_le::<u64>()?;
            if strings::without_trailing_slash(scope.url.href()).len() as u64 != registry_length {
                return Ok(None);
            }

            // TODO(port): inline-for over SIZES_FIELDS — unrolled by hand
            {
                // std.mem.alignForward(usize, pos, alignOf(NpmPackage))
                pkg_stream.pos = pkg_stream
                    .pos
                    .next_multiple_of(core::mem::align_of::<NpmPackage>());
                package_manifest.pkg = pkg_stream.read_struct::<NpmPackage>()?;
            }
            package_manifest.string_buf = Self::read_array::<u8>(&mut pkg_stream)?.into();
            package_manifest.versions =
                Self::read_array::<Semver::Version>(&mut pkg_stream)?.into();
            package_manifest.external_strings =
                Self::read_array::<ExternalString>(&mut pkg_stream)?.into();
            package_manifest.external_strings_for_versions =
                Self::read_array::<ExternalString>(&mut pkg_stream)?.into();
            package_manifest.package_versions =
                Self::read_array::<PackageVersion>(&mut pkg_stream)?.into();
            package_manifest.extern_strings_bin_entries =
                Self::read_array::<ExternalString>(&mut pkg_stream)?.into();
            package_manifest.bundled_deps_buf =
                Self::read_array::<PackageNameHash>(&mut pkg_stream)?.into();

            Ok(Some(package_manifest))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

impl PackageManifest {
    pub fn str<'a>(&'a self, external: &'a ExternalString) -> &'a [u8] {
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

    pub fn find_by_dist_tag(&self, tag: &[u8]) -> Option<FindResult<'_>> {
        let versions = self.pkg.dist_tags.versions.get(&self.versions);
        for (i, tag_str) in self
            .pkg
            .dist_tags
            .tags
            .get(&self.external_strings)
            .iter()
            .enumerate()
        {
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
        newest_filtered: &mut Option<Semver::Version>,
    ) -> Option<FindVersionResult<'a>> {
        let mut prev_package_blocked_from_age: Option<&PackageVersion> = None;
        let mut best_version: Option<FindResult<'a>> = None;

        let current_timestamp_ms: f64 =
            (bun_core::start_time() / bun_core::time::NS_PER_MS as i128) as f64;
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
                    if package.publish_timestamp_ms
                        < current_timestamp_ms - (minimum_release_age_ms + seven_days_ms)
                    {
                        if best_version.is_none() {
                            best_version = Some(FindResult { version, package });
                        }
                        break;
                    }

                    let is_stable = prev_package.publish_timestamp_ms
                        - package.publish_timestamp_ms
                        >= stability_window_ms;
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
            FindVersionResult::FoundWithFilter {
                newest_filtered, ..
            } => newest_filtered.is_some(),
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
            Some(min_age_ms) if !self.should_exclude_from_age_filter(exclusions) => {
                Some(min_age_ms)
            }
            _ => None,
        };
        let Some(min_age_ms) = min_age_gate_ms else {
            return FindVersionResult::Found(dist_result);
        };
        let current_timestamp_ms: f64 =
            (bun_core::start_time() / bun_core::time::NS_PER_MS as i128) as f64;
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

        let list = if is_prerelease {
            self.pkg.prereleases
        } else {
            self.pkg.releases
        };
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

            if version.order(latest_version, &self.string_buf, &self.string_buf)
                == core::cmp::Ordering::Greater
            {
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
            Some(min_age_ms) if !self.should_exclude_from_age_filter(exclusions) => {
                Some(min_age_ms)
            }
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

        if left.op == Semver::range::Op::Eql {
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
                    if group.flags.is_set(Semver::query::Flags::PRE) {
                        if left
                            .version
                            .order(result.version, group_buf, &self.string_buf)
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

        if group.flags.is_set(Semver::query::Flags::PRE) {
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

    pub fn find_best_version(
        &self,
        group: &Semver::query::Group,
        group_buf: &[u8],
    ) -> Option<FindResult<'_>> {
        let left = group.head.head.range.left;
        // Fast path: exact version
        if left.op == Semver::range::Op::Eql {
            return self.find_by_version(left.version);
        }

        if let Some(result) = self.find_by_dist_tag(b"latest") {
            if group.satisfies(result.version, group_buf, &self.string_buf) {
                if group.flags.is_set(Semver::query::Flags::PRE) {
                    if left
                        .version
                        .order(result.version, group_buf, &self.string_buf)
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

        if group.flags.is_set(Semver::query::Flags::PRE) {
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

// TODO(b2): Zig used `IdentityContext(u64)` hasher; std HashMap is fine for now.
type ExternalStringMapDeduper = HashMap<u64, ExternalStringList>;

use bun_install_types::DependencyGroup;
/// Abbreviated registry metadata never carries `devDependencies` — keep this 3-wide intentionally.
const DEPENDENCY_GROUPS: [DependencyGroup; 3] = [
    DependencyGroup::DEPENDENCIES,
    DependencyGroup::OPTIONAL,
    DependencyGroup::PEER,
];

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
        // TODO(port): narrow error set
        // `bun_ast::Source::init_path_string` accepts borrowed `&[u8]` via
        // `IntoStr`; the Source only lives for the duration of this function,
        // so pass the caller's buffers through directly without manufacturing
        // `'static` references here (PORTING.md §Forbidden lifetime extension).
        let source = bun_ast::Source::init_path_string(expected_name, json_buffer);
        initialize_store();
        // TODO(port): bun.ast.Stmt.Data.Store.memory_allocator.?.pop() — Zig
        // pushed/popped the AST arena around the parse so the JSON AST is
        // bulk-freed on return. `initialize_mini_store` already does the push;
        // the pop is handled by resetting on the next call. Phase B should wire
        // an explicit RAII guard once `ASTMemoryAllocator::pop` is exposed.
        // PERF(port): was arena bulk-free — profile in Phase B
        let bump = bun_alloc::Arena::new();
        let json = match JSON::parse_utf8(&source, log, &bump) {
            Ok(j) => j,
            Err(_) => {
                // don't use the arena memory!
                let mut cloned_log = bun_ast::Log::init();
                log.clone_to_with_recycled(&mut cloned_log, true);
                *log = cloned_log;
                return Ok(None);
            }
        };

        if let Some(error_q) = json.as_property(b"error") {
            if let Some(err) = error_q.expr.as_string(&bump) {
                log.add_error_fmt(
                    Some(&source),
                    bun_ast::Loc::EMPTY,
                    format_args!("npm error: {}", bstr::BStr::new(err)),
                );
                return Ok(None);
            }
        }

        let mut result: PackageManifest = PackageManifest::default();
        // TODO(port): bun.serializable() — zero-init for serialization determinism

        let mut all_extern_strings_dedupe_map = ExternalStringMapDeduper::default();
        let mut version_extern_strings_dedupe_map = ExternalStringMapDeduper::default();
        let mut optional_peer_dep_names: Vec<u64> = Vec::new();

        let mut bundled_deps_set = StringSet::init();
        let mut bundle_all_deps = false;

        let mut bundled_deps_count: usize = 0;

        let mut string_builder = Semver::semver_string::Builder {
            string_pool: Semver::semver_string::StringPool::default(),
            ..Default::default()
        };

        if PackageManager::verbose_install() {
            if let Some(name_q) = json.as_property(b"name") {
                let Some(received_name) = name_q.expr.as_string(&bump) else {
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

        if let Some(name_q) = json.as_property(b"modified") {
            let Some(field) = name_q.expr.as_string(&bump) else {
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
            let Some(versions_q) = json.as_property(b"versions") else {
                break 'get_versions;
            };
            let JSON::ExprData::EObject(versions_obj) = &versions_q.expr.data else {
                break 'get_versions;
            };

            let versions = versions_obj.properties.slice();
            for prop in versions {
                let Some(version_name) = prop
                    .key
                    .as_ref()
                    .expect("infallible: prop has key")
                    .as_string(&bump)
                else {
                    continue;
                };
                let sliced_version = SlicedString::init(version_name, version_name);
                let parsed_version = Semver::Version::parse(sliced_version);

                if cfg!(debug_assertions) {
                    debug_assert!(parsed_version.valid);
                }
                if !parsed_version.valid {
                    log.add_error_fmt(
                        Some(&source),
                        prop.value.as_ref().expect("infallible: prop has value").loc,
                        format_args!(
                            "Failed to parse dependency {}",
                            bstr::BStr::new(version_name)
                        ),
                    );
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

                if let Some(dist_q) = prop
                    .value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .as_property(b"dist")
                {
                    if let Some(tarball_prop) = dist_q.expr.get(b"tarball") {
                        if let JSON::ExprData::EString(s) = &tarball_prop.data {
                            let tarball = s.data.slice();
                            string_builder.count(tarball);
                            tarball_urls_count += (!tarball.is_empty()) as usize;
                        }
                    }
                }

                'bin: {
                    if let Some(bin) = prop
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .as_property(b"bin")
                    {
                        match &bin.expr.data {
                            JSON::ExprData::EObject(obj) => {
                                match obj.properties.slice().len() {
                                    0 => break 'bin,
                                    1 => {}
                                    _ => {
                                        extern_string_count_bin += obj.properties.slice().len() * 2;
                                    }
                                }

                                for bin_prop in obj.properties.slice() {
                                    let Some(k) = bin_prop
                                        .key
                                        .as_ref()
                                        .expect("infallible: prop has key")
                                        .as_string(&bump)
                                    else {
                                        break 'bin;
                                    };
                                    string_builder.count(k);
                                    let Some(v) = bin_prop
                                        .value
                                        .as_ref()
                                        .expect("infallible: prop has value")
                                        .as_string(&bump)
                                    else {
                                        break 'bin;
                                    };
                                    string_builder.count(v);
                                }
                            }
                            JSON::ExprData::EString(_) => {
                                if let Some(str_) = bin.expr.as_string(&bump) {
                                    string_builder.count(str_);
                                    break 'bin;
                                }
                            }
                            _ => {}
                        }
                    }

                    if let Some(dirs) = prop
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .as_property(b"directories")
                    {
                        if let Some(bin_prop) = dirs.expr.as_property(b"bin") {
                            if let Some(str_) = bin_prop.expr.as_string(&bump) {
                                string_builder.count(str_);
                                break 'bin;
                            }
                        }
                    }
                }

                bundled_deps_set.map.clear_retaining_capacity();
                bundle_all_deps = false;
                if let Some(bundled_deps_expr) = prop
                    .value
                    .as_ref()
                    .unwrap()
                    .get(b"bundleDependencies")
                    .or_else(|| {
                        prop.value
                            .as_ref()
                            .expect("infallible: prop has value")
                            .get(b"bundledDependencies")
                    })
                {
                    match &bundled_deps_expr.data {
                        JSON::ExprData::EBoolean(boolean) => {
                            bundle_all_deps = boolean.value;
                        }
                        JSON::ExprData::EArray(arr) => {
                            for bundled_dep in arr.slice() {
                                let Some(s) = bundled_dep.as_string(&bump) else {
                                    continue;
                                };
                                bundled_deps_set.insert(s)?;
                            }
                        }
                        _ => {}
                    }
                }

                for pair in &DEPENDENCY_GROUPS {
                    // PERF(port): was comptime monomorphization — profile in Phase B
                    if let Some(versioned_deps) = prop
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .as_property(pair.prop)
                    {
                        if let JSON::ExprData::EObject(obj) = &versioned_deps.expr.data {
                            dependency_sum += obj.properties.slice().len();
                            let properties = obj.properties.slice();
                            for property in properties {
                                if let Some(key) = property
                                    .key
                                    .as_ref()
                                    .expect("infallible: prop has key")
                                    .as_string(&bump)
                                {
                                    if !bundle_all_deps && bundled_deps_set.swap_remove(key) {
                                        // swap remove the dependency name because it could exist in
                                        // multiple behavior groups.
                                        bundled_deps_count += 1;
                                    }
                                    string_builder.count(key);
                                    string_builder.count(
                                        property
                                            .value
                                            .as_ref()
                                            .expect("infallible: prop has value")
                                            .as_string(&bump)
                                            .unwrap_or(b""),
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
                if let Some(meta) = prop
                    .value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .as_property(b"peerDependenciesMeta")
                {
                    if let JSON::ExprData::EObject(obj) = &meta.expr.data {
                        for meta_prop in obj.properties.slice() {
                            let Some(optional) = meta_prop
                                .value
                                .as_ref()
                                .expect("infallible: prop has value")
                                .as_property(b"optional")
                            else {
                                continue;
                            };
                            let JSON::ExprData::EBoolean(b) = &optional.expr.data else {
                                continue;
                            };
                            if !b.value {
                                continue;
                            }
                            let Some(key) = meta_prop
                                .key
                                .as_ref()
                                .expect("infallible: prop has key")
                                .as_string(&bump)
                            else {
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
        if let Some(dist) = json.as_property(b"dist-tags") {
            if let JSON::ExprData::EObject(obj) = &dist.expr.data {
                let tags = obj.properties.slice();
                for tag in tags {
                    if let Some(key) = tag
                        .key
                        .as_ref()
                        .expect("infallible: prop has key")
                        .as_string(&bump)
                    {
                        string_builder.count(key);
                        extern_string_count += 2;

                        string_builder.count(
                            tag.value
                                .as_ref()
                                .expect("infallible: prop has value")
                                .as_string(&bump)
                                .unwrap_or(b""),
                        );
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

        // PORT NOTE: Zig manually @memset zeroed the buffers; Default::default() above achieves
        // the same determinism for these POD types.

        // PORT NOTE: reshaped for borrowck — Zig used overlapping mutable subslices into the
        // same allocation. Rust uses index cursors instead and re-slices on demand.
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
        // SAFETY: all_semver_versions is heap-allocated; we need disjoint mutable subslices.
        // TODO(port): use split_at_mut chain instead of raw pointers in Phase B.
        let all_semver_versions_ptr: *mut Semver::Version = all_semver_versions.as_mut_ptr();
        let mut release_versions_cursor: usize = 0;
        let mut prerelease_versions_cursor: usize = release_versions_len;

        let mut extern_strings_bin_entries_cursor: usize = 0;
        let mut tarball_url_strings_cursor: usize = 0;

        let mut extern_strings_consumed: usize = 0; // tracks `all_extern_strings.len - extern_strings.len`
        string_builder.cap += (string_builder.cap % 64) + 64;
        string_builder.cap *= 2;

        string_builder.allocate()?;

        // PORT NOTE: Zig zeroed the freshly allocated buffer for determinism;
        // `Builder::allocate` already produces a zeroed `Box<[u8]>`.
        //
        // Zig kept a single `string_buf` slice over the builder's backing
        // allocation for the rest of the function. In Rust that would alias a
        // `&[u8]` across the `&mut self` borrows taken by every `append` below
        // (Stacked Borrows UB even though the allocation never moves). Instead
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
        let all_dependency_names_and_values_len = dependency_sum;

        'get_versions2: {
            let Some(versions_q) = json.as_property(b"versions") else {
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
                let Some(version_name) = prop
                    .key
                    .as_ref()
                    .expect("infallible: prop has key")
                    .as_string(&bump)
                else {
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
                    sliced_version = version_string.sliced(string_builder.allocated_slice());
                    parsed_version = Semver::Version::parse(sliced_version);
                    if cfg!(debug_assertions) {
                        debug_assert!(parsed_version.valid);
                        debug_assert!(
                            parsed_version.version.tag.has_build()
                                || parsed_version.version.tag.has_pre()
                        );
                    }
                }
                if !parsed_version.valid {
                    continue;
                }

                bundled_deps_set.map.clear_retaining_capacity();
                bundle_all_deps = false;
                if let Some(bundled_deps_expr) = prop
                    .value
                    .as_ref()
                    .unwrap()
                    .get(b"bundleDependencies")
                    .or_else(|| {
                        prop.value
                            .as_ref()
                            .expect("infallible: prop has value")
                            .get(b"bundledDependencies")
                    })
                {
                    match &bundled_deps_expr.data {
                        JSON::ExprData::EBoolean(boolean) => {
                            bundle_all_deps = boolean.value;
                        }
                        JSON::ExprData::EArray(arr) => {
                            for bundled_dep in arr.slice() {
                                let Some(s) = bundled_dep.as_string(&bump) else {
                                    continue;
                                };
                                bundled_deps_set.insert(s)?;
                            }
                        }
                        _ => {}
                    }
                }

                let mut package_version: PackageVersion = empty_version;

                if let Some(cpu_q) = prop
                    .value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .as_property(b"cpu")
                {
                    package_version.cpu = negatable_from_json::<Architecture>(&cpu_q.expr)?;
                }

                if let Some(os_q) = prop
                    .value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .as_property(b"os")
                {
                    package_version.os = negatable_from_json::<OperatingSystem>(&os_q.expr)?;
                }

                if let Some(libc) = prop
                    .value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .as_property(b"libc")
                {
                    package_version.libc = negatable_from_json::<Libc>(&libc.expr)?;
                }

                if let Some(has_install_script) = prop
                    .value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .as_property(b"hasInstallScript")
                {
                    if let JSON::ExprData::EBoolean(val) = &has_install_script.expr.data {
                        package_version.has_install_script = val.value;
                    }
                }

                'bin: {
                    // bins are extremely repetitive
                    // We try to avoid storing copies the string
                    if let Some(bin) = prop
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .as_property(b"bin")
                    {
                        match &bin.expr.data {
                            JSON::ExprData::EObject(obj) => {
                                match obj.properties.slice().len() {
                                    0 => {}
                                    1 => {
                                        let Some(bin_name) = obj.properties.slice()[0]
                                            .key
                                            .as_ref()
                                            .unwrap()
                                            .as_string(&bump)
                                        else {
                                            break 'bin;
                                        };
                                        let Some(value) = obj.properties.slice()[0]
                                            .value
                                            .as_ref()
                                            .unwrap()
                                            .as_string(&bump)
                                        else {
                                            break 'bin;
                                        };

                                        package_version.bin = Bin {
                                            tag: bin::Tag::NamedFile,
                                            _padding_tag: [0; 3],
                                            value: bin::Value::init_named_file([
                                                string_builder.append::<SemverString>(bin_name),
                                                string_builder.append::<SemverString>(value),
                                            ]),
                                        };
                                    }
                                    _ => {
                                        let group_start = extern_strings_bin_entries_cursor;
                                        let group_len = obj.properties.slice().len() * 2;

                                        let mut is_identical = match &prev_extern_bin_group {
                                            Some(r) => r.len() == group_len,
                                            None => false,
                                        };
                                        let mut group_i: u32 = 0;

                                        // PORT NOTE: Zig wrote through a raw `*[len]ExternalString`
                                        // sub-pointer. The boxed slice is fully initialised
                                        // (`vec![Default; n].into_boxed_slice()` in the counting
                                        // pass) and `ExternalString: Copy`, so plain absolute
                                        // indexing at `group_start + group_i` is the safe
                                        // equivalent — no `from_raw_parts`/`.add()` needed, and
                                        // the `prev` read at a disjoint index needs no split.
                                        for bin_prop in obj.properties.slice() {
                                            let Some(k) = bin_prop
                                                .key
                                                .as_ref()
                                                .expect("infallible: prop has key")
                                                .as_string(&bump)
                                            else {
                                                break 'bin;
                                            };
                                            let cur = string_builder.append::<ExternalString>(k);
                                            all_extern_strings_bin_entries
                                                [group_start + group_i as usize] = cur;
                                            if is_identical {
                                                let prev = prev_extern_bin_group.as_ref().unwrap();
                                                let prev_item = all_extern_strings_bin_entries
                                                    [prev.start + group_i as usize];
                                                is_identical = cur.hash == prev_item.hash;
                                                if cfg!(debug_assertions) && is_identical {
                                                    let first =
                                                        cur.slice(string_builder.allocated_slice());
                                                    let second = prev_item
                                                        .slice(string_builder.allocated_slice());
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

                                            let Some(v) = bin_prop
                                                .value
                                                .as_ref()
                                                .expect("infallible: prop has value")
                                                .as_string(&bump)
                                            else {
                                                break 'bin;
                                            };
                                            let cur = string_builder.append::<ExternalString>(v);
                                            all_extern_strings_bin_entries
                                                [group_start + group_i as usize] = cur;
                                            if is_identical {
                                                let prev = prev_extern_bin_group.as_ref().unwrap();
                                                let prev_item = all_extern_strings_bin_entries
                                                    [prev.start + group_i as usize];
                                                is_identical = cur.hash == prev_item.hash;
                                                if cfg!(debug_assertions) && is_identical {
                                                    let first =
                                                        cur.slice(string_builder.allocated_slice());
                                                    let second = prev_item
                                                        .slice(string_builder.allocated_slice());
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
                            JSON::ExprData::EString(stri) => {
                                if !stri.data.is_empty() {
                                    package_version.bin = Bin {
                                        tag: bin::Tag::File,
                                        _padding_tag: [0; 3],
                                        value: bin::Value::init_file(
                                            string_builder.append::<SemverString>(&stri.data),
                                        ),
                                    };
                                    break 'bin;
                                }
                            }
                            _ => {}
                        }
                    }

                    if let Some(dirs) = prop
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .as_property(b"directories")
                    {
                        // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#directoriesbin
                        // Because of the way the bin directive works,
                        // specifying both a bin path and setting
                        // directories.bin is an error. If you want to
                        // specify individual files, use bin, and for all
                        // the files in an existing bin directory, use
                        // directories.bin.
                        if let Some(bin_prop) = dirs.expr.as_property(b"bin") {
                            if let Some(str_) = bin_prop.expr.as_string(&bump) {
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
                    }
                }

                'integrity: {
                    if let Some(dist) = prop
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .as_property(b"dist")
                    {
                        if let JSON::ExprData::EObject(_) = &dist.expr.data {
                            if let Some(tarball_q) = dist.expr.as_property(b"tarball") {
                                if let JSON::ExprData::EString(s) = &tarball_q.expr.data {
                                    if s.len() > 0 {
                                        package_version.tarball_url =
                                            string_builder.append::<ExternalString>(&s.data);
                                        all_tarball_url_strings[tarball_url_strings_cursor] =
                                            package_version.tarball_url;
                                        tarball_url_strings_cursor += 1;
                                    }
                                }
                            }

                            if let Some(file_count_) = dist.expr.as_property(b"fileCount") {
                                if let JSON::ExprData::ENumber(n) = &file_count_.expr.data {
                                    package_version.file_count = n.value as u32;
                                }
                            }

                            if let Some(file_count_) = dist.expr.as_property(b"unpackedSize") {
                                if let JSON::ExprData::ENumber(n) = &file_count_.expr.data {
                                    package_version.unpacked_size = n.value as u32;
                                }
                            }

                            if let Some(shasum) = dist.expr.as_property(b"integrity") {
                                if let Some(shasum_str) = shasum.expr.as_string(&bump) {
                                    package_version.integrity = Integrity::parse(shasum_str);
                                    if package_version.integrity.tag.is_supported() {
                                        break 'integrity;
                                    }
                                }
                            }

                            if let Some(shasum) = dist.expr.as_property(b"shasum") {
                                if let Some(shasum_str) = shasum.expr.as_string(&bump) {
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
                    let is_peer = pair.prop == b"peerDependencies";
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
                    // PORT NOTE: hoist `versioned_deps` so the borrowed
                    // `obj.properties.slice()` outlives the labelled block.
                    let versioned_deps = prop
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .as_property(pair.prop);
                    let items: &[JSON::Property] = 'items: {
                        if let Some(versioned_deps) = &versioned_deps {
                            if let JSON::ExprData::EObject(obj) = &versioned_deps.expr.data {
                                break 'items obj.properties.slice();
                            }
                        }
                        &[]
                    };
                    let has_meta_only_peers = is_peer
                        && 'blk: {
                            let Some(meta) = prop
                                .value
                                .as_ref()
                                .expect("infallible: prop has value")
                                .as_property(b"peerDependenciesMeta")
                            else {
                                break 'blk false;
                            };
                            match &meta.expr.data {
                                JSON::ExprData::EObject(obj) => obj.properties.slice().len() > 0,
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

                            if let Some(meta) = prop
                                .value
                                .as_ref()
                                .expect("infallible: prop has value")
                                .as_property(b"peerDependenciesMeta")
                            {
                                if let JSON::ExprData::EObject(obj) = &meta.expr.data {
                                    let meta_props = obj.properties.slice();
                                    optional_peer_dep_names.reserve(meta_props.len());
                                    // PERF(port): was assume_capacity
                                    for meta_prop in meta_props {
                                        if let Some(optional) = meta_prop
                                            .value
                                            .as_ref()
                                            .expect("infallible: prop has value")
                                            .as_property(b"optional")
                                        {
                                            let JSON::ExprData::EBoolean(b) = &optional.expr.data
                                            else {
                                                continue;
                                            };
                                            if !b.value {
                                                continue;
                                            }

                                            let meta_key = meta_prop
                                                .key
                                                .as_ref()
                                                .unwrap()
                                                .as_string(&bump)
                                                .expect("unreachable");
                                            optional_peer_dep_names.push(
                                                Semver::semver_string::Builder::string_hash(
                                                    meta_key,
                                                ),
                                            );

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
                            let name_str = match item
                                .key
                                .as_ref()
                                .expect("infallible: prop has key")
                                .as_string(&bump)
                            {
                                Some(s) => s,
                                None => {
                                    if cfg!(debug_assertions) {
                                        unreachable!("non-value Expr from JSON parser")
                                    } else {
                                        continue;
                                    }
                                }
                            };
                            let version_str = match item
                                .value
                                .as_ref()
                                .expect("infallible: prop has value")
                                .as_string(&bump)
                            {
                                Some(s) => s,
                                None => {
                                    if cfg!(debug_assertions) {
                                        unreachable!("non-value Expr from JSON parser")
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
                                    *bundled_deps_buf.as_mut_ptr().add(bundled_deps_offset) =
                                        all_extern_strings[names_base + i].hash;
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
                            if let Some(meta) = prop
                                .value
                                .as_ref()
                                .expect("infallible: prop has value")
                                .as_property(b"peerDependenciesMeta")
                            {
                                if let JSON::ExprData::EObject(obj) = &meta.expr.data {
                                    'outer: for meta_prop in obj.properties.slice() {
                                        let Some(optional) = meta_prop
                                            .value
                                            .as_ref()
                                            .expect("infallible: prop has value")
                                            .as_property(b"optional")
                                        else {
                                            continue;
                                        };
                                        let JSON::ExprData::EBoolean(b) = &optional.expr.data
                                        else {
                                            continue;
                                        };
                                        if !b.value {
                                            continue;
                                        }
                                        let Some(meta_key) = meta_prop
                                            .key
                                            .as_ref()
                                            .expect("infallible: prop has key")
                                            .as_string(&bump)
                                        else {
                                            continue;
                                        };
                                        let meta_hash =
                                            Semver::semver_string::Builder::string_hash(meta_key);
                                        for existing in
                                            &all_extern_strings[names_base..names_base + i]
                                        {
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
                        let this_versions =
                            &version_extern_strings[values_base..values_base + count];

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
                                package_version.bundled_dependencies =
                                    ExternalPackageNameHashList::INVALID;
                            } else {
                                package_version.bundled_dependencies =
                                    ExternalPackageNameHashList::init(
                                        &bundled_deps_buf,
                                        &bundled_deps_buf[bundled_deps_begin..bundled_deps_offset],
                                    );
                            }
                        }

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

                        let map = ExternalStringMap {
                            name: name_list,
                            value: version_list,
                        };
                        match group_idx {
                            0 => package_version.dependencies = map,
                            1 => package_version.optional_dependencies = map,
                            2 => package_version.peer_dependencies = map,
                            _ => unreachable!("non-value Expr from JSON parser"),
                        }

                        // TODO(port): debug-assertions block (Zig lines 2478-2522) elided —
                        // it re-reads `this_names`/`this_versions` via `mut()` after dedupe.
                        // Phase B can re-add with cursor-based slicing.
                        let _ = (this_names, this_versions);
                    }
                }

                if let Some(time_obj) = json.as_property(b"time") {
                    if let Some(publish_time_expr) = time_obj.expr.get(version_name) {
                        if let Some(publish_time_str) = publish_time_expr.as_string(&bump) {
                            if let Ok(ms) = bun_core::wtf::parse_es5_date(publish_time_str) {
                                package_version.publish_timestamp_ms = ms;
                            }
                        }
                    }
                }

                if !parsed_version.version.tag.has_pre() {
                    // SAFETY: cursor < release_versions_len by counting pass
                    unsafe {
                        *all_semver_versions_ptr.add(release_versions_cursor) =
                            parsed_version.version.min();
                    }
                    versioned_packages[versioned_package_releases_start] = package_version;
                    release_versions_cursor += 1;
                    versioned_package_releases_start += 1;
                } else {
                    // SAFETY: cursor in prerelease range
                    unsafe {
                        *all_semver_versions_ptr.add(prerelease_versions_cursor) =
                            parsed_version.version.min();
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

        if let Some(dist) = json.as_property(b"dist-tags") {
            if let JSON::ExprData::EObject(obj) = &dist.expr.data {
                let tags = obj.properties.slice();
                let extern_strings_slice_start = extern_strings_cursor;
                let mut dist_tag_i: usize = 0;

                for tag in tags {
                    if let Some(key) = tag
                        .key
                        .as_ref()
                        .expect("infallible: prop has key")
                        .as_string(&bump)
                    {
                        all_extern_strings[extern_strings_slice_start + dist_tag_i] =
                            string_builder.append::<ExternalString>(key);

                        let Some(version_name) = tag
                            .value
                            .as_ref()
                            .expect("infallible: prop has value")
                            .as_string(&bump)
                        else {
                            continue;
                        };

                        let dist_tag_value_literal =
                            string_builder.append::<ExternalString>(version_name);

                        let sliced_string = dist_tag_value_literal
                            .value
                            .sliced(string_builder.allocated_slice());

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
                        &all_extern_strings
                            [extern_strings_slice_start..extern_strings_slice_start + dist_tag_i],
                    ),
                    versions: VersionSlice::init(
                        &all_semver_versions,
                        &all_semver_versions
                            [dist_tag_versions_start..dist_tag_versions_start + dist_tag_i],
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

        if let Some(name_q) = json.as_property(b"modified") {
            let Some(field) = name_q.expr.as_string(&bump) else {
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
            &versioned_packages[all_versioned_package_releases_range.clone()],
        );

        result.pkg.prereleases.keys = VersionSlice::init(
            &all_semver_versions,
            &all_semver_versions[all_prerelease_versions_range.clone()],
        );
        result.pkg.prereleases.values = PackageVersionList::init(
            &versioned_packages,
            &versioned_packages[all_versioned_package_prereleases_range.clone()],
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
                    // `ExternalSlice` offsets index into `versioned_packages` /
                    // `all_semver_versions`, both fully-initialised `Box<[T]>`s
                    // (created via `vec![Default; n].into_boxed_slice()` above) —
                    // safe slice indexing replaces the `from_raw_parts_mut`
                    // reconstruction Zig's `@constCast(release.values.get(..))`
                    // forced. The two boxes are distinct allocations so the two
                    // `&mut` borrows do not overlap.
                    let versioned_packages_ =
                        &mut versioned_packages[release.values.off as usize..][..len];
                    let semver_versions_ =
                        &mut all_semver_versions[release.keys.off as usize..][..len];
                    cloned_packages.copy_from_slice(versioned_packages_);
                    cloned_versions.copy_from_slice(semver_versions_);

                    for (i, dest) in indices.iter_mut().enumerate() {
                        *dest = i as Int;
                    }

                    let string_bytes = string_builder.allocated_slice();
                    indices.sort_by(|&left, &right| {
                        cloned_versions[left as usize].order(
                            cloned_versions[right as usize],
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
                            let order = second.order(first, string_bytes, string_bytes);
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
                // `ExternalString` is `Copy` POD — Zig used `@memcpy` over
                // `sliceAsBytes` views here; an element-wise `copy_from_slice`
                // is bit-identical and lets us drop the `from_raw_parts`
                // byte-view reconstruction over the same boxed slices.
                debug_assert!(all_extern_strings.len() - extern_strings_cursor >= src_len);
                all_extern_strings[extern_strings_cursor..extern_strings_cursor + src_len]
                    .copy_from_slice(&all_tarball_url_strings[..src_len]);
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

        if let Some(buf) = string_builder.ptr.take() {
            // TODO(port): string_builder owns this allocation; copy out the
            // written prefix. Phase B can add a `Builder::into_owned()` that
            // yields `Box<[u8]>` without the truncate copy.
            let mut v = buf.into_vec();
            v.truncate(string_builder.len);
            result.string_buf = v.into_boxed_slice();
        }

        let _ = all_tarball_url_strings; // suppress unused-mut warnings in Phase A

        Ok(Some(result))
    }
}

// ported from: src/install/npm.zig
