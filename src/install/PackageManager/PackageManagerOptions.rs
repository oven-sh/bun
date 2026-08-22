use crate::bun_schema::api as Api;
use bun_core::ZStr;
use bun_core::{Output, env_var, strings};
use bun_paths::PathBuffer;

use super::Subcommand;
use super::command_line_arguments::{self, CommandLineArguments};
use bun_dotenv::Loader as DotEnvLoader;
use bun_install::{Features, Npm};

/// Network policy for this install.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum OfflineMode {
    /// Default: revalidate stale manifests, download what is missing.
    #[default]
    Online,
    /// `--prefer-offline` / `install.prefer = "offline"`: a cached manifest of any age
    /// satisfies resolution; only what is missing from the cache is fetched.
    PreferOffline,
    /// `--offline` / `install.offline = true`: never touch the network; anything not
    /// in the cache is an error.
    Offline,
}

// `string` fields are `[]const u8` borrowed from CLI args / bunfig config,
// which live for the process lifetime. There is no `deinit` on Options. Mapped to
// `&'static [u8]` per PORTING.md (no lifetime params on structs).

pub struct Options {
    pub log_level: LogLevel,
    pub global: bool,

    pub(crate) global_bin_dir: bun_sys::Fd,
    pub(crate) explicit_global_directory: &'static [u8],
    /// destination directory to link bins into
    // must be a variable due to global installs and bunx
    pub bin_path: &'static ZStr,

    pub(crate) did_override_default_scope: bool,
    pub scope: Npm::registry::Scope,

    pub(crate) registries: Npm::registry::Map,
    pub(crate) cache_directory: &'static [u8],
    pub enable: Enable,
    pub do_: Do,
    pub positionals: &'static [&'static [u8]],
    pub(crate) update: DependencyGroup,
    pub dry_run: bool,
    pub check: bool,
    pub(crate) link_workspace_packages: bool,
    pub(crate) remote_package_features: Features,
    pub local_package_features: Features,
    pub(crate) patch_features: PatchFeatures,

    pub filter_patterns: &'static [&'static [u8]],
    pub add_catalog: Option<&'static [u8]>,
    pub pack_destination: &'static [u8],
    pub pack_filename: &'static [u8],
    pub pack_gzip_level: Option<&'static [u8]>,
    pub json_output: bool,

    pub(crate) max_retry_count: u16,
    pub(crate) min_simultaneous_requests: usize,

    pub max_concurrent_lifecycle_scripts: usize,

    pub publish_config: PublishConfig,

    pub(crate) ca: Box<[Box<[u8]>]>,
    pub(crate) ca_file_name: &'static [u8],

    // if set to `false` in bunfig, save a binary lockfile
    pub(crate) save_text_lockfile: Option<bool>,

    pub(crate) lockfile_only: bool,

    // `bun pm version` command options
    pub git_tag_version: bool,
    pub allow_same_version: bool,
    pub preid: &'static [u8],
    pub message: Option<&'static [u8]>,
    pub force: bool,

    // `bun pm why` command options
    pub top_only: bool,
    pub depth: Option<usize>,

    /// isolated installs (pnpm-like) or hoisted installs (yarn-like, original)
    pub node_linker: NodeLinker,

    pub(crate) public_hoist_pattern: Option<Api::PnpmMatcher>,
    pub(crate) hoist_pattern: Option<Api::PnpmMatcher>,

    /// Isolated linker: `false` skips the `node_modules/.bun/node_modules`
    /// fallback (pnpm's `hoist=false`); takes precedence over `hoist_pattern`.
    pub(crate) hoist: bool,

    /// `--offline` / `--prefer-offline` (or `install.offline` / `install.prefer = "offline"`).
    pub offline: OfflineMode,

    // Security scanner module path
    pub security_scanner: Option<&'static [u8]>,

    // Minimum release age in ms (security feature)
    // Only install packages published at least N ms ago
    pub minimum_release_age_ms: Option<f64>,
    // Packages to exclude from minimum release age checking
    pub minimum_release_age_excludes: Option<&'static [&'static [u8]]>,

    /// Override CPU architecture for optional dependencies filtering
    pub cpu: Npm::Architecture,
    /// Override OS for optional dependencies filtering
    pub os: Npm::OperatingSystem,

    pub(crate) config_version: Option<ConfigVersion>,

    /// `install.allowedHosts`: when `Some`, network requests (manifests,
    /// tarballs, git) are refused unless the host is one of these or the host
    /// of a configured registry. `None` (the default) allows any host.
    pub allowed_hosts: Option<&'static [AllowedHost]>,
    /// `install.rewrite`: `(from, to)` URL prefix rewrites applied at fetch time,
    /// sorted longest `from` first so the most specific rule wins.
    pub url_rewrites: &'static [(&'static [u8], &'static [u8])],
    /// `.npmrc` `//host/path/:_authToken`-style credentials, longest path first.
    /// Consulted for request URLs that the package's registry credentials do
    /// not cover (see `credentials_for`).
    pub npmrc_credentials: &'static [PathCredential],
}

impl Default for Options {
    fn default() -> Self {
        Self {
            log_level: LogLevel::Default,
            global: false,
            global_bin_dir: bun_sys::Fd::INVALID,
            explicit_global_directory: b"",
            bin_path: bun_paths::path_literal!("node_modules/.bin"),
            did_override_default_scope: false,
            // Always assigned in `load()` before read.
            scope: Npm::registry::Scope::default(),
            registries: Npm::registry::Map::default(),
            cache_directory: b"",
            enable: Enable::default(),
            do_: Do::default(),
            positionals: &[],
            update: DependencyGroup::default(),
            dry_run: false,
            check: false,
            link_workspace_packages: true,
            remote_package_features: Features {
                optional_dependencies: true,
                ..Features::default()
            },
            local_package_features: Features {
                optional_dependencies: true,
                dev_dependencies: true,
                workspaces: true,
                ..Features::default()
            },
            patch_features: PatchFeatures::Nothing,
            filter_patterns: &[],
            add_catalog: None,
            pack_destination: b"",
            pack_filename: b"",
            pack_gzip_level: None,
            json_output: false,
            max_retry_count: 5,
            min_simultaneous_requests: 4,
            // Placeholder only — every constructor supplies the real value
            // (`cli.concurrent_scripts` or `cpu_count * 2`).
            max_concurrent_lifecycle_scripts: 0,
            publish_config: PublishConfig::default(),
            ca: Box::default(),
            ca_file_name: b"",
            save_text_lockfile: None,
            lockfile_only: false,
            git_tag_version: true,
            allow_same_version: false,
            preid: b"",
            message: None,
            force: false,
            top_only: false,
            depth: None,
            node_linker: NodeLinker::Auto,
            public_hoist_pattern: None,
            hoist_pattern: None,
            hoist: true,
            offline: OfflineMode::Online,
            security_scanner: None,
            minimum_release_age_ms: None,
            minimum_release_age_excludes: None,
            cpu: Npm::Architecture::CURRENT,
            os: Npm::OperatingSystem::CURRENT,
            config_version: None,
            allowed_hosts: None,
            url_rewrites: &[],
            npmrc_credentials: &[],
        }
    }
}

pub enum PatchFeatures {
    Nothing,
    Patch,
    Commit { patches_dir: &'static [u8] },
}

#[derive(Default, Clone, Copy)]
pub struct PublishConfig {
    pub access: Option<Access>,
    pub tag: &'static [u8],
    pub otp: &'static [u8],
    pub auth_type: Option<AuthType>,
    pub tolerate_republish: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Access {
    Public,
    Restricted,
}

impl Access {
    // was `bun.ComptimeEnumMap(Access)`; ≤8 entries → plain match on &[u8].
    pub fn from_str(str: &[u8]) -> Option<Access> {
        match str {
            b"public" => Some(Access::Public),
            b"restricted" => Some(Access::Restricted),
            _ => None,
        }
    }

    /// Lower-case tag name as written into the
    /// publish JSON body and summary output.
    #[inline]
    pub const fn as_str(self) -> &'static str {
        match self {
            Access::Public => "public",
            Access::Restricted => "restricted",
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AuthType {
    Legacy,
    Web,
}

impl AuthType {
    // was `bun.ComptimeEnumMap(AuthType)`; ≤8 entries → plain match on &[u8].
    pub(crate) fn from_str(str: &[u8]) -> Option<AuthType> {
        match str {
            b"legacy" => Some(AuthType::Legacy),
            b"web" => Some(AuthType::Web),
            _ => None,
        }
    }

    /// Lower-case tag name as used by
    /// `npm-auth-type` header in `npm.whoami`.
    #[inline]
    pub const fn as_str(self) -> &'static str {
        match self {
            AuthType::Legacy => "legacy",
            AuthType::Web => "web",
        }
    }
}

impl Options {
    pub fn should_print_command_name(&self) -> bool {
        self.log_level != LogLevel::Silent && self.do_.contains(Do::SUMMARY)
    }

    /// Resolve the registry scope for a (possibly @-scoped) package name.
    ///
    /// Hoisted onto `Options` so callers that already hold a borrow of
    /// `pm.lockfile` can disjointly borrow `pm.options` instead of needing the
    /// whole `&PackageManager`.
    pub fn scope_for_package_name(&self, name: &[u8]) -> &Npm::registry::Scope {
        if name.is_empty() || name[0] != b'@' {
            return &self.scope;
        }
        let scope_name = Npm::registry::Scope::get_name(name);
        // Compare the stored scope name, not just its hash: a different scope
        // whose hash collides must not inherit this scope's registry or token.
        // Fall back to the default registry on a mismatch.
        match self.registries.get(&Npm::registry::Scope::hash(scope_name)) {
            Some(scope) if *scope.name == *scope_name => scope,
            _ => &self.scope,
        }
    }

    /// Every configured registry: the default one plus each `@scope` registry.
    pub fn registry_scopes(&self) -> impl Iterator<Item = &Npm::registry::Scope> + '_ {
        core::iter::once(&self.scope).chain(self.registries.values())
    }

    /// Which credentials, if any, should accompany a registry request to `url`
    /// made on behalf of a package whose registry is `scope`?
    ///
    /// Credentials are path-scoped: `scope`'s token / `_auth` /
    /// username+password are used only when `url` is under the registry URL
    /// they were configured for — same origin *and* path prefix
    /// ([`url_under`]) — so a token for `https://host/npm/team-a/` is never
    /// sent to `https://host/npm/team-b/`, nor to wherever else a manifest's
    /// `dist.tarball` points. Failing that, an `.npmrc` `//host/path/:_authToken`
    /// (or `_auth` / `username`+`_password`) entry whose `//host/path/` covers
    /// `url` is used, longest path first, the way npm scopes such entries.
    pub fn credentials_for<'a>(
        &'a self,
        scope: &'a Npm::registry::Scope,
        url: &[u8],
    ) -> Credentials<'a> {
        if url_under(url, scope.url.href()) && (!scope.token.is_empty() || !scope.auth.is_empty()) {
            return Credentials {
                token: &scope.token,
                auth: &scope.auth,
            };
        }
        if !self.npmrc_credentials.is_empty() {
            let parsed = bun_url::URL::parse(url);
            if let Some(found) = self.npmrc_credentials.iter().find(|c| c.covers(&parsed)) {
                return Credentials {
                    token: found.token,
                    auth: found.auth,
                };
            }
        }
        Credentials::NONE
    }

    /// `install.allowedHosts`: may bun connect to the host of `url` at all?
    /// Always `true` when no allow-list is configured.
    pub fn is_host_allowed(&self, url: &[u8]) -> bool {
        let Some(allowed) = self.allowed_hosts else {
            return true;
        };
        let url = bun_url::URL::parse(url);
        if url.hostname.is_empty() {
            return false;
        }
        // `get_port_auto` only knows http/https; give git's other transports
        // their real defaults so `host:22`-style entries match ssh remotes.
        let port = url.get_port().unwrap_or_else(|| {
            let scheme = strings::trim_prefix(url.protocol, b"git+");
            if scheme.eq_ignore_ascii_case(b"ssh") {
                22
            } else if scheme.eq_ignore_ascii_case(b"git") {
                9418
            } else {
                url.get_port_auto()
            }
        });
        allowed
            .iter()
            .any(|entry| entry.matches(url.hostname, port))
            || self.registry_scopes().any(|scope| {
                let registry = scope.url.url();
                !registry.hostname.is_empty()
                    && registry.hostname.eq_ignore_ascii_case(url.hostname)
                    && registry.get_port_auto() == port
            })
    }

    /// Apply `install.rewrite` prefix rules to a request URL (longest matching
    /// `from` wins). Fetch-time only: the lockfile keeps the canonical URL.
    pub fn rewrite_url<'a>(&self, url: &'a [u8]) -> std::borrow::Cow<'a, [u8]> {
        for (from, to) in self.url_rewrites {
            if url.starts_with(from) {
                let mut out = Vec::with_capacity(to.len() + url.len() - from.len());
                out.extend_from_slice(to);
                out.extend_from_slice(&url[from.len()..]);
                return std::borrow::Cow::Owned(out);
            }
        }
        std::borrow::Cow::Borrowed(url)
    }
}

/// One `install.allowedHosts` entry: a hostname, optionally pinned to a port.
#[derive(Clone, Copy, Debug)]
pub struct AllowedHost {
    pub hostname: &'static [u8],
    pub port: Option<u16>,
}

impl AllowedHost {
    pub fn parse(entry: &'static [u8]) -> Option<AllowedHost> {
        let (hostname, port) = bun_bunfig::bunfig::split_host_port(entry);
        if hostname.is_empty() {
            return None;
        }
        let port = match port {
            None => None,
            Some(p) => Some(bun_core::fmt::parse_int::<u16>(p, 10).ok()?),
        };
        Some(AllowedHost { hostname, port })
    }

    #[inline]
    pub fn matches(&self, hostname: &[u8], port: u16) -> bool {
        self.hostname.eq_ignore_ascii_case(hostname) && self.port.is_none_or(|p| p == port)
    }
}

/// The `Authorization` material for one request: a bearer `token`, or basic
/// `auth` (`base64(user:pass)`); both empty means send nothing.
#[derive(Clone, Copy)]
pub struct Credentials<'a> {
    pub token: &'a [u8],
    pub auth: &'a [u8],
}

impl Credentials<'_> {
    pub const NONE: Credentials<'static> = Credentials {
        token: b"",
        auth: b"",
    };
}

/// One `.npmrc` `//host[:port]/path/:<credential>` group, resolved to the
/// token / basic-auth value it yields.
#[derive(Clone, Copy)]
pub struct PathCredential {
    pub hostname: &'static [u8],
    /// Only set when the `.npmrc` key spelled out a port.
    pub port: Option<u16>,
    pub pathname: &'static [u8],
    pub token: &'static [u8],
    pub auth: &'static [u8],
}

impl PathCredential {
    /// Does this entry's `//host[:port]/path/` cover `url`? Host must match; an
    /// entry written without a port only covers URLs on their scheme's default
    /// port (npm derives the key from the parsed URL, which drops default
    /// ports); the path must be a segment-wise prefix with no dot-segments.
    pub fn covers(&self, url: &bun_url::URL<'_>) -> bool {
        if url.hostname.is_empty() || !self.hostname.eq_ignore_ascii_case(url.hostname) {
            return false;
        }
        let port_ok = match self.port {
            Some(port) => url.get_port_auto() == port,
            None => url
                .get_port()
                .is_none_or(|p| p == if url.is_https() { 443 } else { 80 }),
        };
        port_ok && path_under(url.pathname, self.pathname)
    }
}

/// Is `url` at or under `base`? Same scheme, host (case-insensitive) and
/// effective port, and `url`'s path starts with `base`'s path compared
/// segment by segment (so `/npm/team-ab/x` is not under `/npm/team-a/`, and a
/// trailing slash on `base` is optional). A `url` whose path contains `.` /
/// `..` segments (plain or percent-encoded) or a backslash is never "under"
/// anything: the server would resolve it somewhere we did not check.
///
/// This is the single predicate behind path-scoped registry credentials
/// (`Options::credentials_for`); plain `starts_with` on the URL bytes would
/// let `https://registry.example.com.evil.test/` pass for
/// `https://registry.example.com` and `/npm/a/../b/` escape `/npm/a/`.
pub fn url_under(url: &[u8], base: &[u8]) -> bool {
    let url = bun_url::URL::parse(url);
    let base = bun_url::URL::parse(base);
    if base.hostname.is_empty()
        || url.hostname.is_empty()
        || !url.protocol.eq_ignore_ascii_case(base.protocol)
        || !url.hostname.eq_ignore_ascii_case(base.hostname)
        || url.get_port_auto() != base.get_port_auto()
    {
        return false;
    }
    path_under(url.pathname, base.pathname)
}

/// The path half of [`url_under`]: `path` starts with `base` segment-wise and
/// carries no `.` / `..` (plain or percent-encoded) segment or backslash.
pub fn path_under(path: &[u8], base: &[u8]) -> bool {
    if strings::contains_char(path, b'\\') {
        return false;
    }
    let mut segments = strings::tokenize(path, b"/");
    for expected in strings::tokenize(base, b"/") {
        match segments.next() {
            Some(segment) if segment == expected && !is_dot_segment(segment) => {}
            _ => return false,
        }
    }
    segments.all(|segment| !is_dot_segment(segment))
}

/// WHATWG "single-dot" / "double-dot" path segments, including the
/// percent-encoded spellings a server would normalize.
fn is_dot_segment(segment: &[u8]) -> bool {
    const DOT_SEGMENTS: [&[u8]; 6] = [b".", b"..", b"%2e", b"%2e.", b".%2e", b"%2e%2e"];
    DOT_SEGMENTS
        .iter()
        .any(|dot| segment.eq_ignore_ascii_case(dot))
}

#[derive(Copy, Clone, PartialEq, Eq, Default, Debug)]
pub enum LogLevel {
    #[default]
    Default,
    Verbose,
    Silent,
    Quiet,
    DefaultNoProgress,
    VerboseNoProgress,
}

impl LogLevel {
    #[inline]
    pub fn is_verbose(self) -> bool {
        matches!(self, LogLevel::VerboseNoProgress | LogLevel::Verbose)
    }
    #[inline]
    pub fn is_silent(self) -> bool {
        matches!(self, LogLevel::Silent)
    }
    #[inline]
    pub fn show_progress(self) -> bool {
        matches!(self, LogLevel::Default | LogLevel::Verbose)
    }
    #[inline]
    pub fn without_progress(self) -> Self {
        match self {
            LogLevel::Default => LogLevel::DefaultNoProgress,
            LogLevel::Verbose => LogLevel::VerboseNoProgress,
            other => other,
        }
    }
}

pub use crate::config_version::ConfigVersion;
pub use bun_install_types::DependencyGroup;
pub use bun_install_types::NodeLinker::NodeLinker;

// mkdir -p + open the dir. Callers store the raw `Fd` (`options.global_bin_dir: Fd`).
pub fn open_global_dir(explicit_global_dir: &[u8]) -> crate::Result<bun_sys::Fd> {
    use bun_paths::{platform, resolve_path::join_abs_string_buf};
    use bun_sys::{Dir, OpenDirOptions};

    if let Some(home_dir) = env_var::BUN_INSTALL_GLOBAL_DIR.get() {
        return Dir::cwd()
            .make_open_path(home_dir, OpenDirOptions::default())
            .map(|d| d.into_raw())
            .map_err(Into::into);
    }

    if !explicit_global_dir.is_empty() {
        return Dir::cwd()
            .make_open_path(explicit_global_dir, OpenDirOptions::default())
            .map(|d| d.into_raw())
            .map_err(Into::into);
    }

    if let Some(home_dir) = env_var::BUN_INSTALL.get() {
        let mut buf = PathBuffer::uninit();
        let parts: [&[u8]; 2] = [b"install", b"global"];
        let path = join_abs_string_buf::<platform::Auto>(home_dir, &mut buf.0, &parts);
        return Dir::cwd()
            .make_open_path(path, OpenDirOptions::default())
            .map(|d| d.into_raw())
            .map_err(Into::into);
    }

    if let Some(home_dir) = env_var::XDG_CACHE_HOME
        .get()
        .or_else(|| env_var::HOME.get())
    {
        let mut buf = PathBuffer::uninit();
        let parts: [&[u8]; 3] = [b".bun", b"install", b"global"];
        let path = join_abs_string_buf::<platform::Auto>(home_dir, &mut buf.0, &parts);
        return Dir::cwd()
            .make_open_path(path, OpenDirOptions::default())
            .map(|d| d.into_raw())
            .map_err(Into::into);
    }

    Err(crate::Error::NoGlobalDirectoryFound)
}

pub(crate) fn open_global_bin_dir(opts_: Option<&Api::BunInstall>) -> crate::Result<bun_sys::Fd> {
    use bun_paths::{platform, resolve_path::join_abs_string_buf};
    use bun_sys::{Dir, OpenDirOptions};

    if let Some(home_dir) = env_var::BUN_INSTALL_BIN.get() {
        return Dir::cwd()
            .make_open_path(home_dir, OpenDirOptions::default())
            .map(|d| d.into_raw())
            .map_err(Into::into);
    }

    if let Some(opts) = opts_ {
        if let Some(home_dir) = &opts.global_bin_dir {
            if !home_dir.is_empty() {
                return Dir::cwd()
                    .make_open_path(home_dir, OpenDirOptions::default())
                    .map(|d| d.into_raw())
                    .map_err(Into::into);
            }
        }
    }

    if let Some(home_dir) = env_var::BUN_INSTALL.get() {
        let mut buf = PathBuffer::uninit();
        let parts: [&[u8]; 1] = [b"bin"];
        let path = join_abs_string_buf::<platform::Auto>(home_dir, &mut buf.0, &parts);
        return Dir::cwd()
            .make_open_path(path, OpenDirOptions::default())
            .map(|d| d.into_raw())
            .map_err(Into::into);
    }

    if let Some(home_dir) = env_var::XDG_CACHE_HOME
        .get()
        .or_else(|| env_var::HOME.get())
    {
        let mut buf = PathBuffer::uninit();
        let parts: [&[u8]; 2] = [b".bun", b"bin"];
        let path = join_abs_string_buf::<platform::Auto>(home_dir, &mut buf.0, &parts);
        return Dir::cwd()
            .make_open_path(path, OpenDirOptions::default())
            .map(|d| d.into_raw())
            .map_err(Into::into);
    }

    Err(crate::Error::MissingGlobalBinDirectoryTrySettingBUNINSTALL)
}

// `BunInstall` owns `Box<[u8]>`; Options stores `&'static [u8]`
// (no struct lifetime params). Park a clone for the
// lifetime of the install command via the named hand-off helper.
#[inline]
fn leak_static(s: &[u8]) -> &'static [u8] {
    bun_core::heap::release(s.to_vec().into_boxed_slice())
}

impl Options {
    pub(crate) fn load(
        &mut self,
        log: &mut bun_ast::Log,
        env: &mut DotEnvLoader,
        maybe_cli: Option<CommandLineArguments>,
        // Every access below is a read of `config.*`; no field is ever written.
        // Taking `&` (not `&mut`) keeps provenance coherent with the bundler/
        // resolver storage (`Option<NonNull<api::BunInstall>>`).
        bun_install_: Option<&Api::BunInstall>,
        subcommand: Subcommand,
    ) -> Result<(), bun_alloc::AllocError> {
        let mut base = Api::NpmRegistry::default();
        let bun_install_ref = bun_install_;
        if let Some(config) = bun_install_ref {
            if let Some(registry) = &config.default_registry {
                base = registry.clone();
            }
            if let Some(link_workspace_packages) = config.link_workspace_packages {
                self.link_workspace_packages = link_workspace_packages;
            }
        }

        if base.url.is_empty() {
            base.url = Npm::registry::DEFAULT_URL.as_bytes().into();
        }
        // Clone so the
        // `base.url` fallback below in the scoped-registry loop stays valid.
        self.scope = Npm::registry::Scope::from_api(b"", base.clone(), env)?;
        // `did_override_default_scope` is set at the end of this fn;
        // on the OOM error path the field is irrelevant (process aborts).

        if let Some(config) = bun_install_ref {
            if let Some(cache_directory) = config.cache_directory.as_deref() {
                self.cache_directory = leak_static(cache_directory);
            }

            if let Some(scoped) = &config.scoped {
                for (name, registry_) in scoped.scopes.keys().iter().zip(scoped.scopes.values()) {
                    debug_assert_eq!(scoped.scopes.keys().len(), scoped.scopes.values().len());
                    let mut registry = registry_.clone();
                    if registry.url.is_empty() {
                        registry.url.clone_from(&base.url);
                    }
                    self.registries.put(
                        Npm::registry::Scope::hash(name),
                        Npm::registry::Scope::from_api(name, registry, env)?,
                    )?;
                }
            }

            if let Some(ca) = &config.ca {
                match ca {
                    Api::Ca::List(ca_list) => {
                        self.ca.clone_from(ca_list);
                    }
                    Api::Ca::Str(ca_str) => {
                        // Single-element slice; own it (no `Box::leak`).
                        self.ca = vec![ca_str.clone()].into_boxed_slice();
                    }
                }
            }

            if let Some(node_linker) = config.node_linker {
                // `Api::NodeLinker` is a re-export of `bun_install_types::NodeLinker`.
                self.node_linker = node_linker;
            }

            if let Some(global_store) = config.global_store {
                self.enable.set(Enable::GLOBAL_VIRTUAL_STORE, global_store);
            }

            if let Some(hoist) = config.hoist {
                self.hoist = hoist;
            }

            if config.offline == Some(true) {
                self.offline = OfflineMode::Offline;
            }

            if let Some(security_scanner) = config.security_scanner.as_deref() {
                self.security_scanner = Some(leak_static(security_scanner));
                self.do_.set(Do::PREFETCH_RESOLVED_TARBALLS, false);
            }

            if let Some(cafile) = config.cafile.as_deref() {
                self.ca_file_name = leak_static(cafile);
            }

            if config.disable_cache.unwrap_or(false) {
                self.enable.set(Enable::CACHE, false);
            }

            if config.disable_manifest_cache.unwrap_or(false) {
                self.enable.set(Enable::MANIFEST_CACHE, false);
            }

            if config.force.unwrap_or(false) {
                self.enable.set(Enable::MANIFEST_CACHE_CONTROL, false);
                self.enable.set(Enable::FORCE_INSTALL, true);
            }

            if config.save_yarn_lockfile.unwrap_or(false) {
                self.do_.set(Do::SAVE_YARN_LOCK, true);
            }

            if let Some(save_lockfile) = config.save_lockfile {
                self.do_.set(Do::SAVE_LOCKFILE, save_lockfile);
                self.enable.set(Enable::FORCE_SAVE_LOCKFILE, true);
            }

            if let Some(save) = config.save_dev {
                self.local_package_features.dev_dependencies = save;
                // remote packages should never install dev dependencies
                // (TODO: unless git dependency with postinstalls)
            }

            if let Some(save) = config.save_optional {
                self.remote_package_features.optional_dependencies = save;
                self.local_package_features.optional_dependencies = save;
            }

            if let Some(save) = config.save_peer {
                self.remote_package_features.peer_dependencies = save;
                self.local_package_features.peer_dependencies = save;
            }

            if let Some(exact) = config.exact {
                self.enable.set(Enable::EXACT_VERSIONS, exact);
            }

            if let Some(production) = config.production {
                if production {
                    self.local_package_features.dev_dependencies = false;
                    self.enable.set(Enable::FAIL_EARLY, true);
                    self.enable.set(Enable::FROZEN_LOCKFILE, true);
                    self.enable.set(Enable::FORCE_SAVE_LOCKFILE, false);
                }
            }

            if let Some(frozen_lockfile) = config.frozen_lockfile {
                if frozen_lockfile {
                    self.enable.set(Enable::FROZEN_LOCKFILE, true);
                }
            }

            if let Some(save_text_lockfile) = config.save_text_lockfile {
                self.save_text_lockfile = Some(save_text_lockfile);
            }

            if let Some(jobs) = config.concurrent_scripts {
                self.max_concurrent_lifecycle_scripts = jobs as usize;
            }

            if let Some(ignore_scripts) = config.ignore_scripts {
                if ignore_scripts {
                    self.do_.set(Do::RUN_SCRIPTS, false);
                }
            }

            if let Some(min_age_ms) = config.minimum_release_age_ms {
                self.minimum_release_age_ms = Some(min_age_ms);
            }

            if let Some(exclusions) = &config.minimum_release_age_excludes {
                let leaked: Vec<&'static [u8]> =
                    exclusions.iter().map(|e| leak_static(e)).collect();
                // Parked for the lifetime of the install command (config arena
                // equivalent), same as `leak_static` above.
                self.minimum_release_age_excludes =
                    Some(&*bun_core::heap::release(leaked.into_boxed_slice()));
            }

            if let Some(hosts) = &config.allowed_hosts {
                // Entries were validated by the bunfig parser; anything that
                // still fails to parse is dropped rather than widening the list.
                let parsed: Vec<AllowedHost> = hosts
                    .iter()
                    .filter_map(|h| AllowedHost::parse(leak_static(h)))
                    .collect();
                self.allowed_hosts = Some(&*bun_core::heap::release(parsed.into_boxed_slice()));
            }

            if let Some(entries) = &config.npmrc_credentials {
                let mut creds: Vec<PathCredential> = Vec::with_capacity(entries.len());
                for entry in entries {
                    // `entry.url` is `host[:port]/path/` (no scheme). Reuse the
                    // registry-scope conversion for `$ENV` expansion and
                    // username:password → basic auth.
                    let scope = Npm::registry::Scope::from_api(b"", entry.clone(), env)?;
                    if scope.token.is_empty() && scope.auth.is_empty() {
                        continue;
                    }
                    let url = leak_static(&entry.url);
                    let slash = strings::index_of_char(url, b'/').map_or(url.len(), |i| i as usize);
                    let Some(host) = AllowedHost::parse(&url[..slash]) else {
                        continue;
                    };
                    creds.push(PathCredential {
                        hostname: host.hostname,
                        port: host.port,
                        pathname: &url[slash..],
                        token: leak_static(&scope.token),
                        auth: leak_static(&scope.auth),
                    });
                }
                // Longest (most specific) path first.
                creds.sort_by_key(|c| core::cmp::Reverse(c.pathname.len()));
                self.npmrc_credentials = &*bun_core::heap::release(creds.into_boxed_slice());
            }

            if let Some(rewrites) = &config.url_rewrites {
                let mut leaked: Vec<(&'static [u8], &'static [u8])> = rewrites
                    .iter()
                    .map(|(from, to)| (leak_static(from), leak_static(to)))
                    .collect();
                // Longest `from` first so the most specific prefix wins.
                leaked.sort_by_key(|rule| core::cmp::Reverse(rule.0.len()));
                self.url_rewrites = &*bun_core::heap::release(leaked.into_boxed_slice());
            }

            // `PnpmMatcher` is move-only; `config` is `&` here so the matchers
            // are taken by the owning caller (`PackageManager::init`) right
            // after `load()` returns. The runtime auto-install path never uses
            // the isolated linker, so it has nothing to transfer.

            if let Some(global_dir) = config.global_dir.as_deref() {
                self.explicit_global_directory = leak_static(global_dir);
            }
        }

        if let Some(val) = env.get(b"BUN_INSTALL_GLOBAL_STORE") {
            self.enable.set(Enable::GLOBAL_VIRTUAL_STORE, val != b"0");
        }

        let default_disable_progress_bar: bool = 'brk: {
            if let Some(prog) = env.get(b"BUN_INSTALL_PROGRESS") {
                break 'brk prog == b"0";
            }

            if env.is_ci() {
                break 'brk true;
            }

            break 'brk Output::stderr_descriptor_type() != Output::DescriptorType::Terminal;
        };

        // technically, npm_config is case in-sensitive
        {
            const REGISTRY_KEYS: [&[u8]; 3] = [
                b"BUN_CONFIG_REGISTRY",
                b"NPM_CONFIG_REGISTRY",
                b"npm_config_registry",
            ];

            for registry_key in REGISTRY_KEYS {
                if let Some(registry_) = env.get(registry_key) {
                    if !registry_.is_empty()
                        && (registry_.starts_with(b"https://") || registry_.starts_with(b"http://"))
                    {
                        let mut api_registry = Api::NpmRegistry::from_url(registry_);
                        // Credentials in the URL win, as they do for `registry=` in .npmrc.
                        if !api_registry.has_credentials() {
                            let prev_url = self.scope.url.url();
                            let new_url = bun_url::URL::parse(&api_registry.url);
                            if bun_core::without_trailing_slash(new_url.host)
                                == bun_core::without_trailing_slash(prev_url.host)
                                && (new_url.is_https() || !prev_url.is_https())
                            {
                                api_registry.token = core::mem::take(&mut self.scope.token);
                            }
                        }
                        self.scope = Npm::registry::Scope::from_api(b"", api_registry, env)?;
                        break;
                    }
                }
            }
        }

        if let Some(cli) = &maybe_cli {
            if !cli.registry.is_empty() {
                let api_registry = Api::NpmRegistry::from_url(cli.registry);
                if api_registry.has_credentials() {
                    self.scope = Npm::registry::Scope::from_api(b"", api_registry, env)?;
                } else {
                    let new_url = bun_url::URL::parse(&api_registry.url);
                    let same_origin = {
                        let prev_url = self.scope.url.url();
                        bun_core::without_trailing_slash(new_url.host)
                            == bun_core::without_trailing_slash(prev_url.host)
                            && (new_url.is_https() || !prev_url.is_https())
                    };
                    if !same_origin {
                        self.scope.token = Box::default();
                        self.scope.auth = Box::default();
                        self.scope.user = Box::default();
                    }
                    self.scope.set_url(api_registry.url);
                }
            }
        }

        {
            const TOKEN_KEYS: [&[u8]; 3] = [
                b"BUN_CONFIG_TOKEN",
                b"NPM_CONFIG_TOKEN",
                b"npm_config_token",
            ];

            for token_key in TOKEN_KEYS {
                if let Some(token) = env.get(token_key) {
                    if !token.is_empty() {
                        self.scope.token = token.into();
                        break;
                    }
                }
            }
        }

        if env.get(b"BUN_CONFIG_YARN_LOCKFILE").is_some() {
            self.do_.set(Do::SAVE_YARN_LOCK, true);
        }

        if let Some(retry_count) = env.get(b"BUN_CONFIG_HTTP_RETRY_COUNT") {
            if let Ok(int) = bun_core::parse_int::<u16>(retry_count, 10) {
                self.max_retry_count = int;
            }
        }

        bun_http::async_http::load_env(log, env);

        if let Some(check_bool) = env.get(b"BUN_CONFIG_SKIP_SAVE_LOCKFILE") {
            self.do_.set(Do::SAVE_LOCKFILE, check_bool == b"0");
        }

        if let Some(check_bool) = env.get(b"BUN_CONFIG_SKIP_LOAD_LOCKFILE") {
            self.do_.set(Do::LOAD_LOCKFILE, check_bool == b"0");
        }

        if let Some(check_bool) = env.get(b"BUN_CONFIG_SKIP_INSTALL_PACKAGES") {
            self.do_.set(Do::INSTALL_PACKAGES, check_bool == b"0");
        }

        if let Some(check_bool) = env.get(b"BUN_CONFIG_NO_VERIFY") {
            self.do_.set(Do::VERIFY_INTEGRITY, check_bool != b"0");
        }

        // Update should never read from manifest cache
        if subcommand == Subcommand::Update {
            self.enable.set(Enable::MANIFEST_CACHE, false);
            self.enable.set(Enable::MANIFEST_CACHE_CONTROL, false);
        }

        if let Some(cli) = maybe_cli {
            self.do_.set(Do::ANALYZE, cli.analyze);
            self.enable
                .set(Enable::ONLY_MISSING, cli.only_missing || cli.analyze);

            if let Some(cache_dir) = cli.cache_dir {
                self.cache_directory = cache_dir;
            }

            if cli.exact {
                self.enable.set(Enable::EXACT_VERSIONS, true);
            }

            if !cli.token.is_empty() {
                self.scope.token = cli.token.into();
            }

            if cli.no_save {
                self.do_.set(Do::SAVE_LOCKFILE, false);
                self.do_.set(Do::WRITE_PACKAGE_JSON, false);
            }

            if cli.dry_run {
                self.do_.set(Do::INSTALL_PACKAGES, false);
                self.dry_run = true;
                self.do_.set(Do::WRITE_PACKAGE_JSON, false);
                self.do_.set(Do::SAVE_LOCKFILE, false);
            }
            self.check = cli.check;

            if cli.no_summary || cli.log_level.is_silent() {
                self.do_.set(Do::SUMMARY, false);
            }

            self.filter_patterns = cli.filters;
            self.add_catalog = cli.add_catalog;
            self.pack_destination = cli.pack_destination;
            self.pack_filename = cli.pack_filename;
            self.pack_gzip_level = cli.pack_gzip_level;
            self.json_output = cli.json_output;

            if cli.no_cache {
                self.enable.set(Enable::MANIFEST_CACHE, false);
                self.enable.set(Enable::MANIFEST_CACHE_CONTROL, false);
            }

            if let Some(omit) = cli.omit {
                if omit.dev {
                    self.local_package_features.dev_dependencies = false;
                    // remote packages should never install dev dependencies
                    // (TODO: unless git dependency with postinstalls)
                }

                if omit.optional {
                    self.local_package_features.optional_dependencies = false;
                    self.remote_package_features.optional_dependencies = false;
                }

                if omit.peer {
                    self.local_package_features.peer_dependencies = false;
                    self.remote_package_features.peer_dependencies = false;
                }
            }

            if cli.ignore_scripts {
                self.do_.set(Do::RUN_SCRIPTS, false);
            }

            if cli.trusted {
                self.do_.set(Do::TRUST_DEPENDENCIES_FROM_ARGS, true);
            }

            if let Some(save_text_lockfile) = cli.save_text_lockfile {
                self.save_text_lockfile = Some(save_text_lockfile);
            }

            if let Some(min_age_ms) = cli.minimum_release_age_ms {
                self.minimum_release_age_ms = Some(min_age_ms);
            }

            self.lockfile_only = cli.lockfile_only;

            if cli.lockfile_only {
                self.do_.set(Do::PREFETCH_RESOLVED_TARBALLS, false);
            }

            if let Some(node_linker) = cli.node_linker {
                self.node_linker = node_linker;
            }

            self.log_level = if default_disable_progress_bar || cli.no_progress {
                cli.log_level.without_progress()
            } else {
                cli.log_level
            };
            if cli.log_level.is_silent() {
                log.level = bun_ast::Level::Err;
                bun_ast::DEFAULT_LOG_LEVEL.store(bun_ast::Level::Err);
            }
            // SAFETY: main-thread CLI option load — single writer.
            super::PackageManager::set_verbose_install(cli.log_level.is_verbose());

            if cli.no_verify {
                self.do_.set(Do::VERIFY_INTEGRITY, false);
            }
            if cli.offline {
                self.offline = OfflineMode::Offline;
            } else if cli.prefer_offline && self.offline == OfflineMode::Online {
                self.offline = OfflineMode::PreferOffline;
            }

            if cli.yarn {
                self.do_.set(Do::SAVE_YARN_LOCK, true);
            }

            if let Some(backend) = cli.backend {
                // Atomic store,
                // main-thread CLI option load (single writer).
                crate::package_install::SUPPORTED_METHOD
                    .store(backend as u8, core::sync::atomic::Ordering::Relaxed);
            }

            // CPU and OS are now parsed as enums in CommandLineArguments, just copy them
            self.cpu = cli.cpu;
            self.os = cli.os;

            self.do_.set(Do::UPDATE_TO_LATEST, cli.latest);
            self.do_.set(Do::RECURSIVE, cli.recursive);

            if !cli.positionals.is_empty() {
                self.positionals = cli.positionals;
            }

            if cli.production {
                self.local_package_features.dev_dependencies = false;
                self.enable.set(Enable::FAIL_EARLY, true);
                self.enable.set(Enable::FROZEN_LOCKFILE, true);
            }

            if cli.frozen_lockfile {
                self.enable.set(Enable::FROZEN_LOCKFILE, true);
            }

            if cli.force {
                self.enable.set(Enable::MANIFEST_CACHE_CONTROL, false);
                self.enable.set(Enable::FORCE_INSTALL, true);
                self.enable.set(Enable::FORCE_SAVE_LOCKFILE, true);
            }

            self.update = cli.dependency_group;

            match &cli.patch {
                command_line_arguments::PatchOpts::Nothing => {}
                command_line_arguments::PatchOpts::Patch => {
                    self.patch_features = PatchFeatures::Patch;
                }
                command_line_arguments::PatchOpts::Commit { patches_dir } => {
                    self.patch_features = PatchFeatures::Commit {
                        patches_dir: *patches_dir,
                    };
                }
            }

            if let Some(cli_access) = cli.publish_config.access {
                self.publish_config.access = Some(cli_access);
            }
            if !cli.publish_config.tag.is_empty() {
                self.publish_config.tag = cli.publish_config.tag;
            }
            if !cli.publish_config.otp.is_empty() {
                self.publish_config.otp = cli.publish_config.otp;
            }
            if let Some(auth_type) = cli.publish_config.auth_type {
                self.publish_config.auth_type = Some(auth_type);
            }
            self.publish_config.tolerate_republish = cli.tolerate_republish;

            if !cli.ca.is_empty() {
                self.ca = cli.ca.iter().map(|s| Box::<[u8]>::from(*s)).collect();
            }
            if !cli.ca_file_name.is_empty() {
                self.ca_file_name = cli.ca_file_name;
            }

            // `bun pm version` command options
            self.git_tag_version = cli.git_tag_version;
            self.allow_same_version = cli.allow_same_version;
            self.preid = cli.preid;
            self.message = cli.message;
            self.force = cli.force;

            // `bun pm why` command options
            self.top_only = cli.top_only;
            self.depth = cli.depth;
        } else {
            self.log_level = if default_disable_progress_bar {
                LogLevel::DefaultNoProgress
            } else {
                LogLevel::Default
            };
            // SAFETY: main-thread CLI option load — single writer.
            super::PackageManager::set_verbose_install(false);
        }

        // If the lockfile is frozen, don't save it to disk.
        if self.enable.contains(Enable::FROZEN_LOCKFILE) {
            self.do_.set(Do::SAVE_LOCKFILE, false);
            self.enable.set(Enable::FORCE_SAVE_LOCKFILE, false);
        }

        // moved from `defer { ... }` after scope assignment (see note above).
        self.did_override_default_scope = self.scope.url_hash != *Npm::registry::DEFAULT_URL_HASH;

        // The manifest cache is the data source for --prefer-offline/--offline; keep it on
        // even where it is otherwise bypassed (`bun update`, `--no-cache`, `--force`).
        if self.offline != OfflineMode::Online {
            self.enable.set(Enable::MANIFEST_CACHE, true);
        }
        // Prefetching resolved tarballs is a latency optimisation for downloads; under
        // --offline there is nothing to download and the install phase reports misses.
        if self.offline == OfflineMode::Offline {
            self.do_.set(Do::PREFETCH_RESOLVED_TARBALLS, false);
        }
        Ok(())
    }
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq)]
    pub struct Do: u16 {
        const SAVE_LOCKFILE                = 1 << 0;
        const LOAD_LOCKFILE                = 1 << 1;
        const INSTALL_PACKAGES             = 1 << 2;
        const WRITE_PACKAGE_JSON           = 1 << 3;
        const RUN_SCRIPTS                  = 1 << 4;
        const SAVE_YARN_LOCK               = 1 << 5;
        const PRINT_META_HASH_STRING       = 1 << 6;
        const VERIFY_INTEGRITY             = 1 << 7;
        const SUMMARY                      = 1 << 8;
        const TRUST_DEPENDENCIES_FROM_ARGS = 1 << 9;
        const UPDATE_TO_LATEST             = 1 << 10;
        const ANALYZE                      = 1 << 11;
        const RECURSIVE                    = 1 << 12;
        const PREFETCH_RESOLVED_TARBALLS   = 1 << 13;
        // _: u2 padding
    }
}

impl Default for Do {
    fn default() -> Self {
        Do::SAVE_LOCKFILE
            | Do::LOAD_LOCKFILE
            | Do::INSTALL_PACKAGES
            | Do::WRITE_PACKAGE_JSON
            | Do::RUN_SCRIPTS
            | Do::VERIFY_INTEGRITY
            | Do::SUMMARY
            | Do::PREFETCH_RESOLVED_TARBALLS
    }
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq)]
    pub struct Enable: u16 {
        const MANIFEST_CACHE         = 1 << 0;
        const MANIFEST_CACHE_CONTROL = 1 << 1;
        const CACHE                  = 1 << 2;
        const FAIL_EARLY             = 1 << 3;
        const FROZEN_LOCKFILE        = 1 << 4;

        // Don't save the lockfile unless there were actual changes
        // unless...
        const FORCE_SAVE_LOCKFILE    = 1 << 5;

        const FORCE_INSTALL          = 1 << 6;

        const EXACT_VERSIONS         = 1 << 7;
        const ONLY_MISSING           = 1 << 8;
        /// Isolated linker only: materialize package entries once into a shared
        /// `<cache>/links/` directory and symlink `node_modules/.bun/<pkg>` into
        /// it, instead of clonefiling every package into every project on every
        /// install. Off by default; set BUN_INSTALL_GLOBAL_STORE=1 or
        /// `install.globalStore = true` in bunfig to enable.
        const GLOBAL_VIRTUAL_STORE   = 1 << 9;
        // _: u6 padding
    }
}

impl Default for Enable {
    fn default() -> Self {
        Enable::MANIFEST_CACHE | Enable::MANIFEST_CACHE_CONTROL | Enable::CACHE
    }
}

// Field-style accessors (`options.do.save_lockfile = false` /
// `if options.do.install_packages { ... }`). The bitflags struct is `Copy`,
// so getters return by value and setters take `&mut self`.
impl Do {
    #[inline]
    pub(crate) fn save_lockfile(self) -> bool {
        self.contains(Do::SAVE_LOCKFILE)
    }
    #[inline]
    pub(crate) fn load_lockfile(self) -> bool {
        self.contains(Do::LOAD_LOCKFILE)
    }
    #[inline]
    pub(crate) fn install_packages(self) -> bool {
        self.contains(Do::INSTALL_PACKAGES)
    }
    #[inline]
    pub fn run_scripts(self) -> bool {
        self.contains(Do::RUN_SCRIPTS)
    }
    #[inline]
    pub(crate) fn save_yarn_lock(self) -> bool {
        self.contains(Do::SAVE_YARN_LOCK)
    }
    #[inline]
    pub(crate) fn print_meta_hash_string(self) -> bool {
        self.contains(Do::PRINT_META_HASH_STRING)
    }
    #[inline]
    pub(crate) fn summary(self) -> bool {
        self.contains(Do::SUMMARY)
    }
    #[inline]
    pub(crate) fn trust_dependencies_from_args(self) -> bool {
        self.contains(Do::TRUST_DEPENDENCIES_FROM_ARGS)
    }
    #[inline]
    pub fn update_to_latest(self) -> bool {
        self.contains(Do::UPDATE_TO_LATEST)
    }
    #[inline]
    pub fn recursive(self) -> bool {
        self.contains(Do::RECURSIVE)
    }
}

// Field-style accessors (`options.enable.cache = false` /
// `if options.enable.manifest_cache { ... }`). The bitflags struct is `Copy`,
// so getters return by value and setters take `&mut self`.
impl Enable {
    #[inline]
    pub(crate) fn cache(self) -> bool {
        self.contains(Enable::CACHE)
    }
    #[inline]
    pub(crate) fn manifest_cache(self) -> bool {
        self.contains(Enable::MANIFEST_CACHE)
    }
    #[inline]
    pub(crate) fn set_manifest_cache(&mut self, v: bool) {
        self.set(Enable::MANIFEST_CACHE, v);
    }
    #[inline]
    pub(crate) fn manifest_cache_control(self) -> bool {
        self.contains(Enable::MANIFEST_CACHE_CONTROL)
    }
    #[inline]
    pub(crate) fn set_manifest_cache_control(&mut self, v: bool) {
        self.set(Enable::MANIFEST_CACHE_CONTROL, v);
    }
    #[inline]
    pub(crate) fn fail_early(self) -> bool {
        self.contains(Enable::FAIL_EARLY)
    }
    #[inline]
    pub(crate) fn frozen_lockfile(self) -> bool {
        self.contains(Enable::FROZEN_LOCKFILE)
    }
    #[inline]
    pub fn force_save_lockfile(self) -> bool {
        self.contains(Enable::FORCE_SAVE_LOCKFILE)
    }
    #[inline]
    pub(crate) fn force_install(self) -> bool {
        self.contains(Enable::FORCE_INSTALL)
    }
    #[inline]
    pub(crate) fn exact_versions(self) -> bool {
        self.contains(Enable::EXACT_VERSIONS)
    }
    #[inline]
    pub(crate) fn only_missing(self) -> bool {
        self.contains(Enable::ONLY_MISSING)
    }
    #[inline]
    pub(crate) fn global_virtual_store(self) -> bool {
        self.contains(Enable::GLOBAL_VIRTUAL_STORE)
    }
}
