use crate::bun_schema::api as Api;
use bun_alloc::{AllocError, Arena};
use bun_ast::Expr;
use bun_core::ZStr;
use bun_core::{Global, Output, env_var};

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
    /// `--registry` was given, so `publishConfig.registry` is ignored (as in npm).
    pub(crate) registry_from_command_line: bool,
    pub scope: Npm::registry::Scope,

    pub(crate) registries: Npm::registry::Map,
    /// `.npmrc` `//host/path/` credential lines, resolved by request URL.
    pub(crate) url_auth: Vec<Npm::registry::UrlAuth>,
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

    /// Set by `init_with_runtime`: no install phase, so only a resolve downloads a package.
    pub(crate) runtime_auto_install: bool,

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
    // Packages and package versions to exclude from minimum release age checking
    pub minimum_release_age_excludes: Option<&'static Npm::MinimumReleaseAgeExcludes>,

    /// Override CPU architecture for optional dependencies filtering
    pub cpu: Npm::Architecture,
    /// Override OS for optional dependencies filtering
    pub os: Npm::OperatingSystem,
    /// Override libc for optional dependencies filtering
    pub libc: Npm::Libc,

    pub(crate) config_version: Option<ConfigVersion>,
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
            registry_from_command_line: false,
            // Always assigned in `load()` before read.
            scope: Npm::registry::Scope::default(),
            registries: Npm::registry::Map::default(),
            url_auth: Vec::new(),
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
            max_concurrent_lifecycle_scripts: usize::from(bun_core::get_thread_count()) * 2,
            publish_config: PublishConfig::default(),
            ca: Box::default(),
            ca_file_name: b"",
            save_text_lockfile: None,
            lockfile_only: false,
            runtime_auto_install: false,
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
            libc: Npm::Libc::CURRENT,
            config_version: None,
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
    pub provenance_flag: Option<bool>,
    pub provenance_npmrc: Option<bool>,
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

    /// Returns the dependency groups that are installed for a package with this resolution.
    pub(crate) fn dependency_features(&self, parent: crate::resolution::Tag) -> Features {
        if parent.is_local_package() {
            self.local_package_features
        } else {
            self.remote_package_features
        }
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

    /// Follows the order of npm's `getAuth`: the `.npmrc` line for the tarball's own URL, or else
    /// the registry's credentials if the tarball is on the registry's origin.
    pub fn tarball_credentials<'a>(
        &'a self,
        scope: &'a Npm::registry::Scope,
        tarball: &bun_url::URL,
        // A URL that one parse could not settle gets no line.
        normalized: bool,
    ) -> Option<&'a Npm::registry::Scope> {
        // This URL comes from package data, and an `.npmrc` key has no scheme, so credentials are
        // never sent over plain http.
        let own = (normalized && tarball.is_https())
            .then(|| Npm::registry::UrlAuth::find_entry(&self.url_auth, tarball))
            .flatten();
        if scope.has_credentials() && same_origin(tarball, &scope.url.url()) {
            // The registry's own key is in `scope` already, behind bunfig, env and CLI.
            return match own {
                Some(entry) if scope.url_auth_key.as_ref() != Some(&entry.key) => {
                    Some(&entry.credentials)
                }
                _ => Some(scope),
            };
        }
        own.map(|entry| &entry.credentials)
    }
}

/// `.npmrc`'s credentials for the URL of `scope` yield to bunfig.toml, the environment and flags.
fn fill_scope_from_url_auth(url_auth: &[Npm::registry::UrlAuth], scope: &mut Npm::registry::Scope) {
    let own = Npm::registry::UrlAuth::find_entry(url_auth, &scope.url.url());
    scope.url_auth_key = own.map(|entry| entry.key.clone());
    if let Some(entry) = own.filter(|_| !scope.has_credentials() || scope.declared_in_npmrc) {
        scope.copy_credentials_from(&entry.credentials);
    }
}

/// Same scheme, host and effective port (some registries spell out `:443` in `dist.tarball`).
fn same_origin(url: &bun_url::URL, base: &bun_url::URL) -> bool {
    !base.hostname.is_empty()
        && url.protocol.eq_ignore_ascii_case(base.protocol)
        && url.hostname.eq_ignore_ascii_case(base.hostname)
        && url.get_port_auto() == base.get_port_auto()
}

impl Options {
    /// The scope for `url` once it replaces `current`. The caller applies `.npmrc` lines after.
    fn scope_for_registry_url(
        &self,
        name: &[u8],
        current: &Npm::registry::Scope,
        url: &[u8],
        env: Option<&mut DotEnvLoader>,
    ) -> crate::Result<Npm::registry::Scope> {
        let registry = Api::NpmRegistry::from_url(url);
        let has_userinfo = registry.has_credentials();
        let mut scope = Npm::registry::Scope::from_api(name, registry, env)?;
        if has_userinfo && scope.has_credentials() {
            return Ok(scope);
        }
        if !scope.has_credentials() {
            let configured = core::iter::once(&self.scope)
                .chain(self.registries.values())
                .find(|configured| {
                    configured.url_hash == scope.url_hash && configured.has_credentials()
                });
            if let Some(configured) = configured {
                scope.copy_credentials_from(configured);
                return Ok(scope);
            }
        }
        if self.inherits_credentials(current, &scope.url.url()) {
            if scope.has_credentials() {
                // The credential is embedded in the path of `url`, so it's trusted as little as one
                // in the line that `url` replaces.
                scope.declared_in_npmrc = current.declared_in_npmrc;
            } else {
                scope.copy_credentials_from(current);
            }
        }
        Ok(scope)
    }

    /// A registry at or under `old` keeps its credentials unless `.npmrc` has a deeper line for it.
    fn inherits_credentials(&self, old: &Npm::registry::Scope, new_url: &bun_url::URL) -> bool {
        use Npm::registry::{UrlAuth, query_free_path};
        use bun_core::strings::tokenize;
        let old_url = old.url.url();
        let mut segments = tokenize(query_free_path(new_url), b"/");
        bun_core::without_trailing_slash(new_url.host)
            == bun_core::without_trailing_slash(old_url.host)
            && (new_url.is_https() || !old_url.is_https())
            && tokenize(query_free_path(&old_url), b"/").all(|base| segments.next() == Some(base))
            && match UrlAuth::find_entry(&self.url_auth, new_url) {
                Some(own) => UrlAuth::find_entry(&self.url_auth, &old_url)
                    .is_some_and(|old| old.key == own.key),
                None => true,
            }
    }

    /// `url` comes from package data, so no environment variable is expanded into it, and `.npmrc`
    /// credentials only apply to it over https.
    fn scope_for_publish_config(
        &self,
        name: &[u8],
        current: &Npm::registry::Scope,
        url: &[u8],
    ) -> Npm::registry::Scope {
        let mut scope = self
            .scope_for_registry_url(name, current, url, None)
            // `refuse_credential` has said why.
            .unwrap_or_else(|_| Global::crash());
        if scope.url.url().is_https() {
            fill_scope_from_url_auth(&self.url_auth, &mut scope);
        }
        scope
    }

    /// Applies the `publishConfig` of the package that's being published. Command-line flags take
    /// precedence.
    pub fn apply_publish_config(
        &mut self,
        package_json: &Expr,
        bump: &Arena,
        package_name: &[u8],
    ) -> Result<(), AllocError> {
        let Some(config) = package_json.get(b"publishConfig") else {
            return Ok(());
        };

        if self.publish_config.tag.is_empty() {
            if let Some(tag) = config.get_string_cloned(bump, b"tag")? {
                self.publish_config.tag = leak_static(tag);
            }
        }

        if self.publish_config.access.is_none() {
            if let Some(access) = config.get_string_cloned(bump, b"access")? {
                self.publish_config.access = Some(Access::from_str(access).unwrap_or_else(|| {
                    Output::err_generic("invalid `access` value: '{}'", (bstr::BStr::new(access),));
                    Global::crash();
                }));
            }
        }

        // Like in npm, `registry` only replaces the default registry, and `@scope:registry` only
        // the scope's.
        if !self.registry_from_command_line {
            if let Some(url) = publish_config_registry(&config, bump, b"registry")? {
                self.scope = self.scope_for_publish_config(b"", &self.scope, url);
                self.did_override_default_scope =
                    self.scope.url_hash != *Npm::registry::DEFAULT_URL_HASH;
            }
        }

        if package_name.starts_with(b"@") {
            let scope_name = Npm::registry::Scope::get_name(package_name);
            let key = [b"@".as_slice(), scope_name, b":registry"].concat();
            if let Some(url) = publish_config_registry(&config, bump, &key)? {
                let current = self.scope_for_package_name(package_name);
                let scope = self.scope_for_publish_config(scope_name, current, url);
                self.registries
                    .put(Npm::registry::Scope::hash(scope_name), scope)?;
            }
        }

        Ok(())
    }

    /// Returns the name of the setting that turns provenance on, or `None` if provenance is off. As
    /// in npm, the command line wins over `publishConfig`, then the environment, then `.npmrc`.
    pub fn provenance_asked_by(
        &self,
        package_json: &Expr,
        env: &DotEnvLoader,
    ) -> Option<&'static str> {
        let in_package_json = (package_json.get(b"publishConfig"))
            .and_then(|config| config.get(b"provenance"))
            .and_then(|value| bun_ini::npmrc_bool(&value));
        const PROVENANCE_KEYS: [&[u8]; 2] = [b"NPM_CONFIG_PROVENANCE", b"npm_config_provenance"];
        let in_env = (PROVENANCE_KEYS.iter())
            .filter_map(|key| env.get(key))
            .filter(|value| !value.is_empty())
            .map(bun_ini::npm_config_bool)
            .max();
        [
            ("--provenance", self.publish_config.provenance_flag),
            (
                "\"provenance\" in the publishConfig of package.json",
                in_package_json,
            ),
            ("NPM_CONFIG_PROVENANCE", in_env),
            (
                "\"provenance\" in .npmrc",
                self.publish_config.provenance_npmrc,
            ),
        ]
        .into_iter()
        .find_map(|(name, on)| Some((name, on?)))
        .and_then(|(name, on)| on.then_some(name))
    }

    /// Everything [`Self::apply_publish_config`] may replace for `package_name`.
    pub fn publish_target(&self, package_name: &[u8]) -> PublishTarget {
        PublishTarget {
            publish_config: self.publish_config,
            default_scope: self.scope.clone(),
            did_override_default_scope: self.did_override_default_scope,
            package_scope: package_name.starts_with(b"@").then(|| {
                let hash = Npm::registry::Scope::hash(Npm::registry::Scope::get_name(package_name));
                (hash, self.registries.get(&hash).cloned())
            }),
        }
    }

    pub fn set_publish_target(&mut self, target: &PublishTarget) -> Result<(), AllocError> {
        self.publish_config = target.publish_config;
        self.scope = target.default_scope.clone();
        self.did_override_default_scope = target.did_override_default_scope;
        match &target.package_scope {
            Some((hash, Some(scope))) => self.registries.put(*hash, scope.clone())?,
            Some((hash, None)) => {
                self.registries.remove(hash);
            }
            None => {}
        }
        Ok(())
    }
}

/// The settings that a `publishConfig` changes. `bun publish --recursive` restores them between
/// packages.
pub struct PublishTarget {
    publish_config: PublishConfig,
    default_scope: Npm::registry::Scope,
    did_override_default_scope: bool,
    /// The `registries` entry of the package's own scope, for a scoped name.
    package_scope: Option<(u64, Option<Npm::registry::Scope>)>,
}

/// Returns `publishConfig[key]` as an http(s) URL. Any other value is an error, so that nothing is
/// published to the wrong place.
fn publish_config_registry<'b>(
    config: &Expr,
    bump: &'b Arena,
    key: &[u8],
) -> Result<Option<&'b [u8]>, AllocError> {
    let Some(value) = config.get(key) else {
        return Ok(None);
    };
    match value.as_string_cloned(bump)? {
        Some(url) if url.starts_with(b"https://") || url.starts_with(b"http://") => Ok(Some(url)),
        not_a_url => {
            let got = not_a_url.map_or_else(String::new, |v| {
                let v = bun_core::fmt::redacted_npm_url(v).to_string();
                format!(": {}", bun_core::fmt::quote(v.as_bytes()))
            });
            Output::err_generic(
                "invalid `{}` value in `publishConfig`{}, expected a URL starting with 'https://' or 'http://'",
                (bstr::BStr::new(key), got),
            );
            Global::crash();
        }
    }
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
fn make_open_dir(path: &[u8]) -> crate::Result<bun_sys::Fd> {
    bun_sys::Dir::cwd()
        .make_open_path(path, Default::default())
        .map(|d| d.into_raw())
        .map_err(Into::into)
}

/// Opens `<base>/<parts...>`. `base` comes from the environment and can have any length.
fn make_open_dir_under(base: &[u8], parts: &[&[u8]]) -> crate::Result<bun_sys::Fd> {
    use bun_paths::{platform, resolve_path::join_abs_string_buf_checked};

    let base = expand_home(base);
    let mut buf = bun_paths::path_buffer_pool::get();
    let Some(path) = join_abs_string_buf_checked::<platform::Auto>(&base, &mut buf.0, parts) else {
        return Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
    };
    make_open_dir(path)
}

pub fn open_global_dir(explicit_global_dir: &[u8]) -> crate::Result<bun_sys::Fd> {
    if let Some(home_dir) = env_var::BUN_INSTALL_GLOBAL_DIR.get() {
        return make_open_dir(&expand_home(home_dir));
    }

    if !explicit_global_dir.is_empty() {
        return make_open_dir(explicit_global_dir);
    }

    if let Some(home_dir) = env_var::BUN_INSTALL.get() {
        return make_open_dir_under(home_dir, &[b"install", b"global"]);
    }

    if let Some(home_dir) = env_var::XDG_CACHE_HOME
        .get()
        .or_else(|| env_var::HOME.get())
    {
        return make_open_dir_under(home_dir, &[b".bun", b"install", b"global"]);
    }

    Err(crate::Error::NoGlobalDirectoryFound)
}

pub(crate) fn open_global_bin_dir(opts_: Option<&Api::BunInstall>) -> crate::Result<bun_sys::Fd> {
    if let Some(home_dir) = env_var::BUN_INSTALL_BIN.get() {
        return make_open_dir(&expand_home(home_dir));
    }

    if let Some(home_dir) = opts_
        .and_then(|opts| opts.global_bin_dir.as_deref())
        .filter(|home_dir| !home_dir.is_empty())
    {
        return make_open_dir(home_dir);
    }

    if let Some(home_dir) = env_var::BUN_INSTALL.get() {
        return make_open_dir_under(home_dir, &[b"bin"]);
    }

    if let Some(home_dir) = env_var::XDG_CACHE_HOME
        .get()
        .or_else(|| env_var::HOME.get())
    {
        return make_open_dir_under(home_dir, &[b".bun", b"bin"]);
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

/// Expands a leading `~/` in a path from an environment variable, because the shell often has not
/// done so. A relative path is returned unchanged.
pub(crate) fn expand_home(path: &[u8]) -> Box<[u8]> {
    Api::BunInstall::resolve_path(b"", path)
}

impl Options {
    pub(crate) fn load(
        &mut self,
        log: &mut bun_ast::Log,
        env: &mut DotEnvLoader,
        cli: &CommandLineArguments,
        // Every access below is a read of `config.*`; no field is ever written.
        // Taking `&` (not `&mut`) keeps provenance coherent with the bundler/
        // resolver storage (`Option<NonNull<api::BunInstall>>`).
        bun_install_ref: Option<&Api::BunInstall>,
        // The `.npmrc` for runtime auto-install. Only the registries and their credentials are read
        // from it.
        runtime_npmrc: Option<&Api::BunInstall>,
        // Runtime auto-install only: the bunfig.toml files of the project's other folders. The first
        // has the ones that `bun_install_ref` overrides, the second the ones that override it.
        runtime_bunfigs: [Option<&Api::BunInstall>; 2],
        subcommand: Subcommand,
    ) -> crate::Result<()> {
        let bunfigs = [runtime_bunfigs[0], bun_install_ref, runtime_bunfigs[1]];
        if let Some(manifest_cache) = env.get(b"BUN_MANIFEST_CACHE") {
            self.enable.set(
                Enable::MANIFEST_CACHE,
                matches!(manifest_cache, b"1" | b"2"),
            );
            self.enable
                .set(Enable::MANIFEST_CACHE_CONTROL, manifest_cache == b"2");
        }

        let mut base = Api::NpmRegistry::default();
        if let Some(registry) = runtime_npmrc.and_then(|npmrc| npmrc.default_registry.as_ref()) {
            base = registry.clone();
        }
        for config in bunfigs.into_iter().flatten() {
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
        self.scope = Npm::registry::Scope::from_api(b"", base, Some(&mut *env))?;
        // `did_override_default_scope` is set at the end of this fn;
        // on the OOM error path the field is irrelevant (process aborts).

        // Scopes that have credentials but no URL use the default registry. They are registered
        // further down, once the default registry's URL is final.
        let mut at_default_registry: Vec<(&[u8], &Api::NpmRegistry)> = Vec::new();

        // npmrc < bunfig
        for config in [runtime_npmrc].into_iter().chain(bunfigs).flatten() {
            if let Some(scoped) = &config.scoped {
                for (name, registry) in scoped.scopes.keys().iter().zip(scoped.scopes.values()) {
                    debug_assert_eq!(scoped.scopes.keys().len(), scoped.scopes.values().len());
                    let name: &[u8] = name;
                    at_default_registry.retain(|&(earlier, _)| earlier != name);
                    if registry.url.is_empty() {
                        // A scope with neither a URL nor credentials counts as having no entry.
                        self.registries.remove(&Npm::registry::Scope::hash(name));
                        if registry.has_credentials() {
                            at_default_registry.push((name, registry));
                        }
                        continue;
                    }
                    self.registries.put(
                        Npm::registry::Scope::hash(name),
                        Npm::registry::Scope::from_api(name, registry.clone(), Some(&mut *env))?,
                    )?;
                }
            }

            for url_auth in &config.url_auth {
                if let Some(url_auth) = Npm::registry::UrlAuth::from_api(url_auth, env)? {
                    self.url_auth.push(url_auth);
                }
            }
        }

        for config in bunfigs.into_iter().flatten() {
            if let Some(cache_directory) = config.cache_directory.as_deref() {
                self.cache_directory = leak_static(cache_directory);
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

            if config.dry_run == Some(true) {
                self.dry_run = true;
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
                self.enable.set(Enable::MANIFEST_CACHE, false);
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

            self.publish_config.provenance_npmrc = config.provenance;

            if let Some(min_age_ms) = config.minimum_release_age_ms {
                self.minimum_release_age_ms = Some(min_age_ms);
            }

            if let Some(exclusions) = &config.minimum_release_age_excludes {
                let leaked: Vec<&'static [u8]> =
                    exclusions.iter().map(|e| leak_static(e)).collect();
                // Parked for the lifetime of the install command (config arena
                // equivalent), same as `leak_static` above.
                self.minimum_release_age_excludes = Some(&*bun_core::heap::release(Box::new(
                    Npm::MinimumReleaseAgeExcludes::parse(&leaked, log),
                )));
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
            self.enable.set(
                Enable::GLOBAL_VIRTUAL_STORE,
                bun_core::env_var::string_is_truthy(val),
            );
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

        // The default registry from the config files, before the environment or `--registry`
        // replaces it.
        let configured = self.scope.clone();

        // technically, npm_config is case in-sensitive
        {
            const REGISTRY_KEYS: [&[u8]; 3] = [
                b"BUN_CONFIG_REGISTRY",
                b"NPM_CONFIG_REGISTRY",
                b"npm_config_registry",
            ];

            for registry_key in REGISTRY_KEYS {
                if let Some(registry_) = env.get(registry_key) {
                    // An unusable value fails when it's used. It never falls through to the next
                    // layer.
                    let registry_ = bun_core::strings::trim(registry_, b" \t\r\n");
                    if !registry_.is_empty() {
                        let url: Box<[u8]> = registry_.into();
                        self.scope =
                            self.scope_for_registry_url(b"", &self.scope, &url, Some(&mut *env))?;
                        break;
                    }
                }
            }
        }

        if !cli.registry.is_empty() {
            self.scope =
                self.scope_for_registry_url(b"", &self.scope, cli.registry, Some(&mut *env))?;
            self.registry_from_command_line = true;
        }

        // If the default registry was replaced, these scopes' credentials move to the new one only
        // when the default registry's own credentials do. Otherwise they stay with the old one.
        let follows = self.scope.url_hash == configured.url_hash
            || self.inherits_credentials(&configured, &self.scope.url.url());
        let home = if follows { &self.scope } else { &configured };
        let home: Box<[u8]> = home.url.href().into();
        for (name, registry) in at_default_registry {
            let registry = Api::NpmRegistry {
                url: home.clone(),
                ..registry.clone()
            };
            self.registries.put(
                Npm::registry::Scope::hash(name),
                Npm::registry::Scope::from_api(name, registry, Some(&mut *env))?,
            )?;
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
                        self.scope.set_token_from_env(token_key, token)?;
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

        for (key, flag) in [
            (
                b"BUN_CONFIG_SKIP_SAVE_LOCKFILE".as_slice(),
                Do::SAVE_LOCKFILE,
            ),
            (
                b"BUN_CONFIG_SKIP_LOAD_LOCKFILE".as_slice(),
                Do::LOAD_LOCKFILE,
            ),
            (
                b"BUN_CONFIG_SKIP_INSTALL_PACKAGES".as_slice(),
                Do::INSTALL_PACKAGES,
            ),
        ] {
            if let Some(check_bool) = env.get(key) {
                self.do_.set(flag, check_bool == b"0");
            }
        }
        if matches!(env.get(b"BUN_CONFIG_NO_VERIFY"), Some(b"1" | b"true")) {
            self.do_.set(Do::VERIFY_INTEGRITY, false);
        }

        // Update should never read from manifest cache
        if subcommand == Subcommand::Update {
            self.enable.set(Enable::MANIFEST_CACHE, false);
            self.enable.set(Enable::MANIFEST_CACHE_CONTROL, false);
        }

        self.do_.set(Do::ANALYZE, cli.analyze);
        self.enable
            .set(Enable::ONLY_MISSING, cli.only_missing || cli.analyze);
        self.enable.set(
            Enable::MOVE_TO_GROUP,
            cli.names_group && !cli.only_missing && !cli.analyze,
        );

        if let Some(cache_dir) = cli.cache_dir {
            self.cache_directory = cache_dir;
        }

        if cli.exact {
            self.enable.set(Enable::EXACT_VERSIONS, true);
        }

        if cli.no_save {
            self.do_.set(Do::SAVE_LOCKFILE, false);
            self.do_.set(Do::WRITE_PACKAGE_JSON, false);
        }

        if cli.dry_run {
            self.dry_run = true;
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
                // remote packages never install them (TODO: unless git with postinstalls)
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

        if let Some(concurrent_scripts) = cli.concurrent_scripts {
            self.max_concurrent_lifecycle_scripts = concurrent_scripts;
        }

        if let Some(min_age_ms) = cli.minimum_release_age_ms {
            self.minimum_release_age_ms = Some(min_age_ms);
        }

        if !cli.minimum_release_age_excludes.is_empty() {
            let entries: Vec<&'static [u8]> = cli
                .minimum_release_age_excludes
                .iter()
                .flat_map(|&list| bun_core::strings::split(list, b","))
                .map(<[u8]>::trim_ascii)
                .filter(|entry| !entry.is_empty())
                .collect();
            self.minimum_release_age_excludes = Some(&*bun_core::heap::release(Box::new(
                Npm::MinimumReleaseAgeExcludes::parse(&entries, log),
            )));
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
            // There's a single writer: the main thread, while it loads the CLI options.
            crate::package_install::SUPPORTED_METHOD
                .store(backend as u8, core::sync::atomic::Ordering::Relaxed);
        }

        self.cpu = cli.cpu.unwrap_or(Npm::Architecture::CURRENT);
        self.os = cli.os.unwrap_or(Npm::OperatingSystem::CURRENT);
        self.libc = cli.libc.unwrap_or(Npm::Libc::CURRENT);

        self.do_.set(Do::UPDATE_TO_LATEST, cli.latest);
        self.do_.set(Do::RECURSIVE, cli.recursive);
        // The only depth `bun update` accepts is 0.
        self.do_.set(
            Do::UPDATE_DIRECT_ONLY,
            subcommand == Subcommand::Update && cli.depth.is_some(),
        );

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
        self.publish_config.provenance_flag = cli.publish_config.provenance_flag;

        // `--ca` / `--cafile` replace the config file's `ca` + `cafile` as a whole.
        if !cli.ca.is_empty() || !cli.ca_file_name.is_empty() {
            self.ca = cli.ca.iter().map(|s| Box::<[u8]>::from(*s)).collect();
            self.ca_file_name = cli.ca_file_name;
        }

        // `bun pm version` command options
        self.git_tag_version = !cli.no_git_tag_version;
        self.allow_same_version = cli.allow_same_version;
        self.preid = cli.preid;
        self.message = cli.message;
        self.force = cli.force;

        // `bun pm why` command options
        self.top_only = cli.top_only;
        self.depth = cli.depth;

        // If the lockfile is frozen, don't save it to disk.
        if self.enable.contains(Enable::FROZEN_LOCKFILE) {
            self.do_.set(Do::SAVE_LOCKFILE, false);
            self.enable.set(Enable::FORCE_SAVE_LOCKFILE, false);
        }

        if self.dry_run {
            self.do_.remove(
                Do::INSTALL_PACKAGES
                    | Do::WRITE_PACKAGE_JSON
                    | Do::SAVE_LOCKFILE
                    | Do::SAVE_YARN_LOCK,
            );
        }

        // After every source of a registry URL was applied.
        if !self.url_auth.is_empty() {
            for scope in core::iter::once(&mut self.scope).chain(self.registries.values_mut()) {
                fill_scope_from_url_auth(&self.url_auth, scope);
            }
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
        // `0` means no gate. It's cleared because `is_some()` makes Bun request the full registry
        // document for every package.
        self.minimum_release_age_ms = self.minimum_release_age_ms.filter(|&ms| ms > 0.0);
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
        /// `bun update --depth 0`: only the dependencies of the root and of workspaces are
        /// re-resolved.
        const UPDATE_DIRECT_ONLY           = 1 << 14;
        // _: u1 padding
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
        /// `bun add` was given a group, so an entry that's in another group moves into it.
        const MOVE_TO_GROUP          = 1 << 10;
        // _: u5 padding
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
    #[inline]
    pub fn update_direct_only(self) -> bool {
        self.contains(Do::UPDATE_DIRECT_ONLY)
    }
}

impl Enable {
    #[inline]
    pub(crate) fn manifest_cache(self) -> bool {
        self.contains(Enable::MANIFEST_CACHE)
    }
    #[inline]
    pub(crate) fn manifest_cache_control(self) -> bool {
        self.contains(Enable::MANIFEST_CACHE_CONTROL)
    }
    #[inline]
    pub(crate) fn fail_early(self) -> bool {
        self.contains(Enable::FAIL_EARLY)
    }
    #[inline]
    pub fn frozen_lockfile(self) -> bool {
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
