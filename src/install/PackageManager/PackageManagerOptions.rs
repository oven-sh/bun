use bun_core::{Output, env_var};
use bun_core::{ZStr, strings};
use bun_paths::{self as Path, PathBuffer};
use bun_url::URL;
// TODO(port): move to <area>_sys / verify crate path for schema API
use crate::bun_schema::api as Api;

use super::Subcommand;
use super::command_line_arguments::{self, CommandLineArguments};
use bun_dotenv::Loader as DotEnvLoader;
use bun_install::{Features, Npm};

// PORT NOTE: `string` fields are `[]const u8` borrowed from CLI args / bunfig config,
// which live for the process lifetime. There is no `deinit` on Options. Mapped to
// `&'static [u8]` per PORTING.md (no lifetime params on structs in Phase A).
// TODO(port): lifetime — if any source is not truly 'static, revisit in Phase B.

pub struct Options {
    pub log_level: LogLevel,
    pub global: bool,

    // TODO(port): std.fs.Dir → bun_sys::Fd (directory handle); default was bun.FD.invalid.stdDir()
    pub global_bin_dir: bun_sys::Fd,
    pub explicit_global_directory: &'static [u8],
    /// destination directory to link bins into
    // must be a variable due to global installs and bunx
    pub bin_path: &'static ZStr,

    pub did_override_default_scope: bool,
    pub scope: Npm::registry::Scope,

    pub registries: Npm::registry::Map,
    pub cache_directory: &'static [u8],
    pub enable: Enable,
    pub do_: Do,
    pub positionals: &'static [&'static [u8]],
    pub update: Update,
    pub dry_run: bool,
    pub link_workspace_packages: bool,
    pub remote_package_features: Features,
    pub local_package_features: Features,
    pub patch_features: PatchFeatures,

    pub filter_patterns: &'static [&'static [u8]],
    pub pack_destination: &'static [u8],
    pub pack_filename: &'static [u8],
    pub pack_gzip_level: Option<&'static [u8]>,
    pub json_output: bool,

    pub max_retry_count: u16,
    pub min_simultaneous_requests: usize,

    pub max_concurrent_lifecycle_scripts: usize,

    pub publish_config: PublishConfig,

    pub ca: Box<[Box<[u8]>]>,
    pub ca_file_name: &'static [u8],

    // if set to `false` in bunfig, save a binary lockfile
    pub save_text_lockfile: Option<bool>,

    pub lockfile_only: bool,

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

    pub public_hoist_pattern: Option<Api::PnpmMatcher>,
    pub hoist_pattern: Option<Api::PnpmMatcher>,

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

    pub config_version: Option<ConfigVersion>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            log_level: LogLevel::Default,
            global: false,
            global_bin_dir: bun_sys::Fd::INVALID,
            explicit_global_directory: b"",
            // TODO(port): bun.pathLiteral("node_modules/.bin") — platform-specific separator at comptime
            bin_path: bun_paths::path_literal!("node_modules/.bin"),
            did_override_default_scope: false,
            // PORT NOTE: Zig had `= undefined`; always assigned in `load()` before read.
            scope: Npm::registry::Scope::default(),
            registries: Npm::registry::Map::default(),
            cache_directory: b"",
            enable: Enable::default(),
            do_: Do::default(),
            positionals: &[],
            update: Update::default(),
            dry_run: false,
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
            pack_destination: b"",
            pack_filename: b"",
            pack_gzip_level: None,
            json_output: false,
            max_retry_count: 5,
            min_simultaneous_requests: 4,
            // TODO(port): no default in Zig — caller must supply at construction
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
            security_scanner: None,
            minimum_release_age_ms: None,
            minimum_release_age_excludes: None,
            cpu: Npm::Architecture::CURRENT,
            os: Npm::OperatingSystem::CURRENT,
            config_version: None,
        }
    }
}

// PORT NOTE: was an anonymous `union(enum)` field type in Zig.
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
    // PORT NOTE: was `bun.ComptimeEnumMap(Access)`; ≤8 entries → plain match on &[u8].
    pub fn from_str(str: &[u8]) -> Option<Access> {
        match str {
            b"public" => Some(Access::Public),
            b"restricted" => Some(Access::Restricted),
            _ => None,
        }
    }

    /// Port of Zig `@tagName(access)` — lower-case tag name as written into the
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
    // PORT NOTE: was `bun.ComptimeEnumMap(AuthType)`; ≤8 entries → plain match on &[u8].
    pub fn from_str(str: &[u8]) -> Option<AuthType> {
        match str {
            b"legacy" => Some(AuthType::Legacy),
            b"web" => Some(AuthType::Web),
            _ => None,
        }
    }

    /// Port of Zig `@tagName(auth_type)` — lower-case tag name as used by
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
        self.registries
            .get(&Npm::registry::Scope::hash(Npm::registry::Scope::get_name(
                name,
            )))
            .unwrap_or(&self.scope)
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
    pub fn show_progress(self) -> bool {
        matches!(self, LogLevel::Default | LogLevel::Verbose)
    }
}

pub use crate::config_version::ConfigVersion;
pub use bun_install_types::NodeLinker::NodeLinker;

#[derive(Default, Copy, Clone)]
pub struct Update {
    pub development: bool,
    pub optional: bool,
    pub peer: bool,
}

// PORT NOTE: `std.fs.cwd().makeOpenPath` → `bun_sys::Dir::cwd().make_open_path()`
// (mkdir -p + open dir). Return type was `!std.fs.Dir`; callers store the raw
// `Fd` (`options.global_bin_dir: Fd`), so unwrap to `.fd`.
pub fn open_global_dir(explicit_global_dir: &[u8]) -> Result<bun_sys::Fd, bun_core::Error> {
    use bun_paths::{platform, resolve_path::join_abs_string_buf};
    use bun_sys::{Dir, OpenDirOptions};

    if let Some(home_dir) = env_var::BUN_INSTALL_GLOBAL_DIR.get() {
        return Dir::cwd()
            .make_open_path(home_dir, OpenDirOptions::default())
            .map(|d| d.fd);
    }

    if !explicit_global_dir.is_empty() {
        return Dir::cwd()
            .make_open_path(explicit_global_dir, OpenDirOptions::default())
            .map(|d| d.fd);
    }

    if let Some(home_dir) = env_var::BUN_INSTALL.get() {
        let mut buf = PathBuffer::uninit();
        let parts: [&[u8]; 2] = [b"install", b"global"];
        let path = join_abs_string_buf::<platform::Auto>(home_dir, &mut buf.0, &parts);
        return Dir::cwd()
            .make_open_path(path, OpenDirOptions::default())
            .map(|d| d.fd);
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
            .map(|d| d.fd);
    }

    Err(bun_core::err!("No global directory found"))
}

pub fn open_global_bin_dir(
    opts_: Option<&Api::BunInstall>,
) -> Result<bun_sys::Fd, bun_core::Error> {
    use bun_paths::{platform, resolve_path::join_abs_string_buf};
    use bun_sys::{Dir, OpenDirOptions};

    if let Some(home_dir) = env_var::BUN_INSTALL_BIN.get() {
        return Dir::cwd()
            .make_open_path(home_dir, OpenDirOptions::default())
            .map(|d| d.fd);
    }

    if let Some(opts) = opts_ {
        if let Some(home_dir) = &opts.global_bin_dir {
            if !home_dir.is_empty() {
                return Dir::cwd()
                    .make_open_path(home_dir, OpenDirOptions::default())
                    .map(|d| d.fd);
            }
        }
    }

    if let Some(home_dir) = env_var::BUN_INSTALL.get() {
        let mut buf = PathBuffer::uninit();
        let parts: [&[u8]; 1] = [b"bin"];
        let path = join_abs_string_buf::<platform::Auto>(home_dir, &mut buf.0, &parts);
        return Dir::cwd()
            .make_open_path(path, OpenDirOptions::default())
            .map(|d| d.fd);
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
            .map(|d| d.fd);
    }

    Err(bun_core::err!(
        "Missing global bin directory: try setting $BUN_INSTALL"
    ))
}

// PORT NOTE: Zig borrowed `[]const u8` from `Api.BunInstall` (process-lifetime
// arena). Rust `BunInstall` owns `Box<[u8]>`; Options stores `&'static [u8]`
// per Phase-A "no struct lifetime params". Park a clone for the lifetime of
// the install command (matches Zig's never-reset config arena) via the named
// hand-off helper.
#[inline]
fn leak_static(s: &[u8]) -> &'static [u8] {
    bun_core::heap::release(s.to_vec().into_boxed_slice())
}

impl Options {
    pub fn load(
        &mut self,
        log: &mut bun_ast::Log,
        env: &mut DotEnvLoader,
        maybe_cli: Option<CommandLineArguments>,
        // Spec PackageManagerOptions.zig:224 `bun_install_: ?*Api.BunInstall` —
        // every access below is a read of `config.*`; no field is ever written.
        // Taking `&` (not `&mut`) keeps provenance coherent with the bundler/
        // resolver storage (`Option<&api::BunInstall>` / `*const ()`).
        bun_install_: Option<&Api::BunInstall>,
        subcommand: Subcommand,
    ) -> Result<(), bun_alloc::AllocError> {
        let mut base = Api::NpmRegistry::default();
        // PORT NOTE: reshaped for borrowck — Zig captures `*Api.BunInstall` twice via `if (bun_install_) |config|`.
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
        // PORT NOTE: Zig passes `base` by-value (struct copy); clone so the
        // `base.url` fallback below in the scoped-registry loop stays valid.
        self.scope = Npm::registry::Scope::from_api(b"", base.clone(), env)?;
        // PORT NOTE: Zig `defer { this.did_override_default_scope = ... }` moved to end of fn;
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
                        registry.url = base.url.clone();
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
                        self.ca = ca_list.clone();
                    }
                    Api::Ca::Str(ca_str) => {
                        // Zig `&.{ca_str}` — single-element slice; own it (no `Box::leak`).
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

            if let Some(cache_dir) = config.cache_directory.as_deref() {
                self.cache_directory = leak_static(cache_dir);
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
        // load_registry:
        {
            const REGISTRY_KEYS: [&[u8]; 3] = [
                b"BUN_CONFIG_REGISTRY",
                b"NPM_CONFIG_REGISTRY",
                b"npm_config_registry",
            ];
            let mut did_set = false;

            // PORT NOTE: was `inline for`; homogeneous elements → plain for.
            for registry_key in REGISTRY_KEYS {
                if !did_set {
                    if let Some(registry_) = env.get(registry_key) {
                        if !registry_.is_empty()
                            && (registry_.starts_with(b"https://")
                                || registry_.starts_with(b"http://"))
                        {
                            let prev_scope = self.scope.clone();
                            // PORT NOTE: was `std.mem.zeroes(Api.NpmRegistry)`; zeroed slices are
                            // invalid in Rust — use Default (empty strings) which is semantically equivalent.
                            let mut api_registry = Api::NpmRegistry::default();
                            api_registry.url = registry_.into();
                            api_registry.token = prev_scope.token;
                            self.scope = Npm::registry::Scope::from_api(b"", api_registry, env)?;
                            did_set = true;
                        }
                    }
                }
            }
        }

        {
            const TOKEN_KEYS: [&[u8]; 3] = [
                b"BUN_CONFIG_TOKEN",
                b"NPM_CONFIG_TOKEN",
                b"npm_config_token",
            ];
            let mut did_set = false;

            // PORT NOTE: was `inline for`; homogeneous elements → plain for.
            for registry_key in TOKEN_KEYS {
                if !did_set {
                    if let Some(registry_) = env.get(registry_key) {
                        if !registry_.is_empty() {
                            self.scope.token = registry_.into();
                            did_set = true;
                            // stage1 bug: break inside inline is broken
                            // break :load_registry;
                        }
                    }
                }
            }
        }

        if env.get(b"BUN_CONFIG_YARN_LOCKFILE").is_some() {
            self.do_.set(Do::SAVE_YARN_LOCK, true);
        }

        if let Some(retry_count) = env.get(b"BUN_CONFIG_HTTP_RETRY_COUNT") {
            // PORT NOTE: Zig `parseInt(u16, str, 10) catch null` — `Result` → `.ok()`.
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

            if !cli.registry.is_empty() {
                self.scope.url = bun_url::OwnedURL::from_href(cli.registry.into());
            }

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

            if cli.no_summary || cli.silent {
                self.do_.set(Do::SUMMARY, false);
            }

            self.filter_patterns = cli.filters;
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

            let disable_progress_bar = default_disable_progress_bar || cli.no_progress;

            if cli.verbose {
                self.log_level = if disable_progress_bar {
                    LogLevel::VerboseNoProgress
                } else {
                    LogLevel::Verbose
                };
                // SAFETY: main-thread CLI option load — single writer (Zig: `verbose_install = true`).
                super::PackageManager::set_verbose_install(true);
            } else if cli.silent {
                self.log_level = LogLevel::Silent;
                super::PackageManager::set_verbose_install(false);
            } else if cli.quiet {
                self.log_level = LogLevel::Quiet;
                super::PackageManager::set_verbose_install(false);
            } else {
                self.log_level = if disable_progress_bar {
                    LogLevel::DefaultNoProgress
                } else {
                    LogLevel::Default
                };
                super::PackageManager::set_verbose_install(false);
            }

            if cli.no_verify {
                self.do_.set(Do::VERIFY_INTEGRITY, false);
            }

            if cli.yarn {
                self.do_.set(Do::SAVE_YARN_LOCK, true);
            }

            if let Some(backend) = cli.backend {
                // Zig: `PackageInstall.supported_method = backend` — atomic store,
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

            if cli.development {
                self.update.development = cli.development;
            } else if cli.optional {
                self.update.optional = cli.optional;
            } else if cli.peer {
                self.update.peer = cli.peer;
            }

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

        // PORT NOTE: moved from `defer { ... }` after scope assignment (see note above).
        self.did_override_default_scope = self.scope.url_hash != *Npm::registry::DEFAULT_URL_HASH;

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

// Field-style accessors for Zig parity (`options.do.save_lockfile = false` /
// `if options.do.install_packages { ... }`). The bitflags struct is `Copy`,
// so getters return by value and setters take `&mut self`.
impl Do {
    #[inline]
    pub fn save_lockfile(&self) -> bool {
        self.contains(Do::SAVE_LOCKFILE)
    }
    #[inline]
    pub fn set_save_lockfile(&mut self, v: bool) {
        self.set(Do::SAVE_LOCKFILE, v);
    }
    #[inline]
    pub fn load_lockfile(&self) -> bool {
        self.contains(Do::LOAD_LOCKFILE)
    }
    #[inline]
    pub fn set_load_lockfile(&mut self, v: bool) {
        self.set(Do::LOAD_LOCKFILE, v);
    }
    #[inline]
    pub fn install_packages(&self) -> bool {
        self.contains(Do::INSTALL_PACKAGES)
    }
    #[inline]
    pub fn set_install_packages(&mut self, v: bool) {
        self.set(Do::INSTALL_PACKAGES, v);
    }
    #[inline]
    pub fn write_package_json(&self) -> bool {
        self.contains(Do::WRITE_PACKAGE_JSON)
    }
    #[inline]
    pub fn set_write_package_json(&mut self, v: bool) {
        self.set(Do::WRITE_PACKAGE_JSON, v);
    }
    #[inline]
    pub fn run_scripts(&self) -> bool {
        self.contains(Do::RUN_SCRIPTS)
    }
    #[inline]
    pub fn set_run_scripts(&mut self, v: bool) {
        self.set(Do::RUN_SCRIPTS, v);
    }
    #[inline]
    pub fn save_yarn_lock(&self) -> bool {
        self.contains(Do::SAVE_YARN_LOCK)
    }
    #[inline]
    pub fn set_save_yarn_lock(&mut self, v: bool) {
        self.set(Do::SAVE_YARN_LOCK, v);
    }
    #[inline]
    pub fn print_meta_hash_string(&self) -> bool {
        self.contains(Do::PRINT_META_HASH_STRING)
    }
    #[inline]
    pub fn set_print_meta_hash_string(&mut self, v: bool) {
        self.set(Do::PRINT_META_HASH_STRING, v);
    }
    #[inline]
    pub fn verify_integrity(&self) -> bool {
        self.contains(Do::VERIFY_INTEGRITY)
    }
    #[inline]
    pub fn set_verify_integrity(&mut self, v: bool) {
        self.set(Do::VERIFY_INTEGRITY, v);
    }
    #[inline]
    pub fn summary(&self) -> bool {
        self.contains(Do::SUMMARY)
    }
    #[inline]
    pub fn set_summary(&mut self, v: bool) {
        self.set(Do::SUMMARY, v);
    }
    #[inline]
    pub fn trust_dependencies_from_args(&self) -> bool {
        self.contains(Do::TRUST_DEPENDENCIES_FROM_ARGS)
    }
    #[inline]
    pub fn set_trust_dependencies_from_args(&mut self, v: bool) {
        self.set(Do::TRUST_DEPENDENCIES_FROM_ARGS, v);
    }
    #[inline]
    pub fn update_to_latest(&self) -> bool {
        self.contains(Do::UPDATE_TO_LATEST)
    }
    #[inline]
    pub fn set_update_to_latest(&mut self, v: bool) {
        self.set(Do::UPDATE_TO_LATEST, v);
    }
    #[inline]
    pub fn analyze(&self) -> bool {
        self.contains(Do::ANALYZE)
    }
    #[inline]
    pub fn set_analyze(&mut self, v: bool) {
        self.set(Do::ANALYZE, v);
    }
    #[inline]
    pub fn recursive(&self) -> bool {
        self.contains(Do::RECURSIVE)
    }
    #[inline]
    pub fn set_recursive(&mut self, v: bool) {
        self.set(Do::RECURSIVE, v);
    }
    #[inline]
    pub fn prefetch_resolved_tarballs(&self) -> bool {
        self.contains(Do::PREFETCH_RESOLVED_TARBALLS)
    }
    #[inline]
    pub fn set_prefetch_resolved_tarballs(&mut self, v: bool) {
        self.set(Do::PREFETCH_RESOLVED_TARBALLS, v);
    }
}

// Field-style accessors for Zig parity (`options.enable.cache = false` /
// `if options.enable.manifest_cache { ... }`). The bitflags struct is `Copy`,
// so getters return by value and setters take `&mut self`.
impl Enable {
    #[inline]
    pub fn cache(&self) -> bool {
        self.contains(Enable::CACHE)
    }
    #[inline]
    pub fn set_cache(&mut self, v: bool) {
        self.set(Enable::CACHE, v);
    }
    #[inline]
    pub fn manifest_cache(&self) -> bool {
        self.contains(Enable::MANIFEST_CACHE)
    }
    #[inline]
    pub fn set_manifest_cache(&mut self, v: bool) {
        self.set(Enable::MANIFEST_CACHE, v);
    }
    #[inline]
    pub fn manifest_cache_control(&self) -> bool {
        self.contains(Enable::MANIFEST_CACHE_CONTROL)
    }
    #[inline]
    pub fn set_manifest_cache_control(&mut self, v: bool) {
        self.set(Enable::MANIFEST_CACHE_CONTROL, v);
    }
    #[inline]
    pub fn fail_early(&self) -> bool {
        self.contains(Enable::FAIL_EARLY)
    }
    #[inline]
    pub fn frozen_lockfile(&self) -> bool {
        self.contains(Enable::FROZEN_LOCKFILE)
    }
    #[inline]
    pub fn force_save_lockfile(&self) -> bool {
        self.contains(Enable::FORCE_SAVE_LOCKFILE)
    }
    #[inline]
    pub fn force_install(&self) -> bool {
        self.contains(Enable::FORCE_INSTALL)
    }
    #[inline]
    pub fn exact_versions(&self) -> bool {
        self.contains(Enable::EXACT_VERSIONS)
    }
    #[inline]
    pub fn only_missing(&self) -> bool {
        self.contains(Enable::ONLY_MISSING)
    }
    #[inline]
    pub fn global_virtual_store(&self) -> bool {
        self.contains(Enable::GLOBAL_VIRTUAL_STORE)
    }
}

// ported from: src/install/PackageManager/PackageManagerOptions.zig
