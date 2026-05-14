use core::ffi::c_char;
use std::io::Write as _;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMapExt, Entry, GetOrPutResult, StringArrayHashMap};
use bun_core::{self, Output};
use bun_core::{ZStr, strings};
use bun_paths::{self, MAX_PATH_BYTES, PathBuffer};
use bun_sys;
use bun_url::URL;
use bun_which::which;
use bun_wyhash;

use bun_core::analytics;

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum DotEnvFileSuffix {
    Development,
    Production,
    Test,
}

/// Downstream callers (transpiler, install, lockfile) variously spell the load-mode
/// discriminant `Kind` or `Mode`; both alias the same `DotEnvFileSuffix` enum so the
/// crate exports a single canonical type without forcing a tree-wide rename.
pub type Kind = DotEnvFileSuffix;
pub type Mode = DotEnvFileSuffix;

/// Port of the `*FileSystem.DirEntry` parameter to `Loader::load`
/// (env_loader.zig). `bun_dotenv` sits below `bun_resolver` in the crate
/// graph, so the concrete `bun_resolver::fs::DirEntry` is taken generically;
/// the only operation `load_default_files` performs is `hasComptimeQuery`
/// (fs.zig:305) — fast O(1) lookup of a known-at-compile-time filename in the
/// directory's entry map. Implemented for `bun_resolver::fs::DirEntry`.
pub trait DirEntryProbe {
    /// Zig: `DirEntry.hasComptimeQuery(comptime query)`. The argument MUST
    /// already be ASCII-lowercase (Zig lowercases at comptime; fs.zig:305-310).
    fn has_comptime_query(&self, query_lower: &'static [u8]) -> bool;
}

// LAYERING: the concrete `DirEntry` lives in `bun_resolver::fs` (higher tier,
// depends on this crate). `impl DirEntryProbe for bun_resolver::fs::DirEntry`
// is provided there — see src/resolver/lib.rs. No impl here; that would be a
// dep-cycle.

/// schema.peechy / schema.zig:1172 — `enum(u32)`. Canonical definition; re-exported as
/// `bun_options_types::schema::api::DotEnvBehavior` for higher tiers.
#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
#[allow(non_camel_case_types)]
pub enum DotEnvBehavior {
    #[default]
    _none = 0,
    disable = 1,
    prefix = 2,
    load_all = 3,
    load_all_without_inlining = 4,
}

#[allow(non_upper_case_globals)]
impl DotEnvBehavior {
    // PascalCase aliases — downstream callers (bundler/options.rs, bundler/defines.rs,
    // runtime/api/JSBundler.rs) name the variants both ways while the snake_case enum
    // body above stays the schema ground truth.
    pub const None: Self = Self::_none;
    pub const Disable: Self = Self::disable;
    pub const Prefix: Self = Self::prefix;
    pub const LoadAll: Self = Self::load_all;
    pub const LoadAllWithoutInlining: Self = Self::load_all_without_inlining;

    /// String-branch classifier shared by `bunfig.zig:988-1018` (serve.env) and
    /// `JSBundler.zig:603-630` (Bun.build env). Only the *string* arm is common to
    /// both specs — the surrounding null/bool/number dispatch and the error
    /// reporting intentionally diverge per call site, so they stay inline there.
    ///
    /// Returns `Ok((behavior, prefix))` where `prefix` is `Some(&s[..idx])` only for
    /// `DotEnvBehavior::prefix`; `Err(())` means the string is none of
    /// `"inline"` / `"disable"` / contains-`*`, and the caller emits its own
    /// site-specific diagnostic.
    pub fn parse_str(s: &[u8]) -> Result<(Self, Option<&[u8]>), ()> {
        if s == b"inline" {
            Ok((Self::load_all, None))
        } else if s == b"disable" {
            Ok((Self::disable, None))
        } else if let Some(asterisk) = s.iter().position(|&b| b == b'*') {
            if asterisk > 0 {
                Ok((Self::prefix, Some(&s[..asterisk])))
            } else {
                Ok((Self::load_all, None))
            }
        } else {
            Err(())
        }
    }
}

/// Mirrors the value fields of `bun_s3_signing::S3Credentials` (T5). Defined locally so
/// this T2 crate names no `bun_s3_signing` types — see PORTING.md §Dispatch (cold-path,
/// upward dep). The high-tier caller constructs the real refcounted `S3Credentials` from
/// this POD at the call site.
// TODO(port): once bun_s3_signing TYPE_ONLY move-down lands ≤T2, re-export that struct here.
#[derive(Clone, Default)]
pub struct S3Credentials {
    pub access_key_id: Box<[u8]>,
    pub secret_access_key: Box<[u8]>,
    pub region: Box<[u8]>,
    pub endpoint: Box<[u8]>,
    pub bucket: Box<[u8]>,
    pub session_token: Box<[u8]>,
    /// Important for MinIO support.
    pub insecure_http: bool,
}

pub struct Loader<'a> {
    pub map: &'a mut Map,
    // allocator dropped — global mimalloc (see PORTING.md §Allocators)
    pub env_local: Option<bun_ast::Source>,
    pub env_development: Option<bun_ast::Source>,
    pub env_production: Option<bun_ast::Source>,
    pub env_test: Option<bun_ast::Source>,
    pub env_development_local: Option<bun_ast::Source>,
    pub env_production_local: Option<bun_ast::Source>,
    pub env_test_local: Option<bun_ast::Source>,
    pub env: Option<bun_ast::Source>,

    /// only populated with files specified explicitly (e.g. --env-file arg)
    pub custom_files_loaded: StringArrayHashMap<bun_ast::Source>,

    pub quiet: bool,

    pub did_load_process: bool,
    pub reject_unauthorized: Option<bool>,

    // Local POD mirror of `bun_s3_signing::S3Credentials` — see type doc above.
    aws_credentials: Option<S3Credentials>,
}

// Module-level mutable statics from the Zig (`var` decls inside `Loader`).
static DID_LOAD_CCACHE_PATH: AtomicBool = AtomicBool::new(false);
// Zig: `var node_path_to_use_set_once: []const u8 = ""` — overwritten on every
// `loadNodeJSConfig` call (env_loader.zig:344). NOT set-once despite the name,
// so RwLock<Option> (not OnceLock) — a 2nd call with an override must update the cache.
static NODE_PATH_TO_USE_SET_ONCE: bun_core::RwLock<Option<Box<[u8]>>> = bun_core::RwLock::new(None);

// Zig: `pub var has_no_clear_screen_cli_flag: ?bool = null;`
// PORTING.md §Concurrency: OnceLock — set once from CLI flag, read many.
pub static HAS_NO_CLEAR_SCREEN_CLI_FLAG: OnceLock<bool> = OnceLock::new();

impl<'a> Loader<'a> {
    /// Shared "empty-ish" predicate for proxy env vars: an unset/empty value,
    /// or a literal empty-quote pair left over from shell `export FOO=""` /
    /// `export FOO=''`. Mirrors Zig env_loader.zig getHttpProxy/getNoProxy.
    #[inline]
    fn is_emptyish(v: &[u8]) -> bool {
        v.is_empty() || v == b"\"\"" || v == b"''"
    }

    /// Lookup `lower` first; if present-but-empty, fall through to `upper`.
    /// CI environments often set `http_proxy=""` as a default; a runtime
    /// `process.env.HTTP_PROXY = "..."` must still be observed.
    #[inline]
    fn get_lower_then_upper(&self, lower: &[u8], upper: &[u8]) -> Option<&[u8]> {
        if let Some(p) = self.get(lower) {
            if !p.is_empty() {
                return Some(p);
            }
        }
        self.get(upper)
    }

    pub fn iterator(&mut self) -> <HashTable as ArrayHashMapExt>::Iterator<'_> {
        self.map.iterator()
    }

    pub fn has(&self, input: &[u8]) -> bool {
        let Some(value) = self.get(input) else {
            return false;
        };
        // NOTE: intentionally stricter than `is_emptyish` — also rejects "0"/"false"
        // per Zig `Loader.has` spec; do not collapse the extra terms.
        !Self::is_emptyish(value) && value != b"0" && value != b"false"
    }

    /// `BUN_ENV` with fallback to `NODE_ENV` — Bun's env precedence for
    /// production/test detection. Mirrors Zig `isProduction`/`isTest` lookup.
    pub fn get_node_env(&self) -> Option<&[u8]> {
        self.get(b"BUN_ENV").or_else(|| self.get(b"NODE_ENV"))
    }

    pub fn is_production(&self) -> bool {
        self.get_node_env() == Some(b"production")
    }

    pub fn is_test(&self) -> bool {
        self.get_node_env() == Some(b"test")
    }

    pub fn get_node_path<'b>(
        &mut self,
        fs: &bun_paths::fs::FileSystem,
        buf: &'b mut PathBuffer,
    ) -> Option<&'b ZStr> {
        // Check NODE or npm_node_execpath env var, but only use it if the file actually exists.
        // NLL workaround: compute the length in an inner scope so the borrow of `buf` for the
        // executable check ends before we either return a fresh borrow or fall through to `which`.
        let env_len = self
            .get(b"NODE")
            .or_else(|| self.get(b"npm_node_execpath"))
            .filter(|n| !n.is_empty() && n.len() < MAX_PATH_BYTES)
            .map(|node| {
                buf[..node.len()].copy_from_slice(node);
                buf[node.len()] = 0;
                node.len()
            });
        if let Some(len) = env_len {
            if bun_sys::is_executable_file_path(ZStr::from_buf(&buf[..], len)) {
                return Some(ZStr::from_buf(&buf[..], len));
            }
        }

        let path = self.get(b"PATH")?;
        if let Some(node) = which(buf, path, fs.top_level_dir(), b"node") {
            return Some(node);
        }

        None
    }

    pub fn is_ci(&self) -> bool {
        self.get(b"CI")
            .or_else(|| self.get(b"TDDIUM"))
            .or_else(|| self.get(b"GITHUB_ACTIONS"))
            .or_else(|| self.get(b"JENKINS_URL"))
            .or_else(|| self.get(b"bamboo.buildKey"))
            .is_some()
    }

    pub fn load_tracy(&self) {}

    pub fn get_s3_credentials(&mut self) -> &S3Credentials {
        if self.aws_credentials.is_some() {
            return self.aws_credentials.as_ref().unwrap();
        }

        // PORT NOTE: reshaped for borrowck — Zig stored borrowed `[]const u8` slices into
        // the env map; here we copy to `Box<[u8]>` so the cached struct owns its bytes and
        // we can release the `&self` borrow before writing `&mut self.aws_credentials`.
        // PERF(port): one-shot, cached — copies are negligible.
        let access_key_id: Box<[u8]> = self
            .get(b"S3_ACCESS_KEY_ID")
            .or_else(|| self.get(b"AWS_ACCESS_KEY_ID"))
            .map(Box::from)
            .unwrap_or_default();
        let secret_access_key: Box<[u8]> = self
            .get(b"S3_SECRET_ACCESS_KEY")
            .or_else(|| self.get(b"AWS_SECRET_ACCESS_KEY"))
            .map(Box::from)
            .unwrap_or_default();
        let region: Box<[u8]> = self
            .get(b"S3_REGION")
            .or_else(|| self.get(b"AWS_REGION"))
            .map(Box::from)
            .unwrap_or_default();

        let mut endpoint: Box<[u8]> = Box::default();
        let mut insecure_http = false;
        if let Some(endpoint_) = self
            .get(b"S3_ENDPOINT")
            .or_else(|| self.get(b"AWS_ENDPOINT"))
        {
            let url = URL::parse(endpoint_);
            endpoint = Box::from(url.host_with_path());
            insecure_http = url.is_http();
        }

        let bucket: Box<[u8]> = self
            .get(b"S3_BUCKET")
            .or_else(|| self.get(b"AWS_BUCKET"))
            .map(Box::from)
            .unwrap_or_default();
        let session_token: Box<[u8]> = self
            .get(b"S3_SESSION_TOKEN")
            .or_else(|| self.get(b"AWS_SESSION_TOKEN"))
            .map(Box::from)
            .unwrap_or_default();

        self.aws_credentials = Some(S3Credentials {
            access_key_id,
            secret_access_key,
            region,
            endpoint,
            bucket,
            session_token,
            insecure_http,
        });

        self.aws_credentials.as_ref().unwrap()
    }

    /// Checks whether `NODE_TLS_REJECT_UNAUTHORIZED` is set to `0` or `false`.
    ///
    /// **Prefer VirtualMachine.getTLSRejectUnauthorized()** for JavaScript, as individual workers could have different settings.
    pub fn get_tls_reject_unauthorized(&mut self) -> bool {
        if let Some(reject_unauthorized) = self.reject_unauthorized {
            return reject_unauthorized;
        }
        if let Some(reject) = self.get(b"NODE_TLS_REJECT_UNAUTHORIZED") {
            if reject == b"0" {
                self.reject_unauthorized = Some(false);
                return false;
            }
            if reject == b"false" {
                self.reject_unauthorized = Some(false);
                return false;
            }
        }
        // default: true
        self.reject_unauthorized = Some(true);
        true
    }

    pub fn get_http_proxy_for(&mut self, url: &URL<'_>) -> Option<URL<'a>> {
        self.get_http_proxy(url.is_http(), Some(url.hostname), Some(url.host))
    }

    pub fn has_http_proxy(&self) -> bool {
        self.has(b"http_proxy")
            || self.has(b"HTTP_PROXY")
            || self.has(b"https_proxy")
            || self.has(b"HTTPS_PROXY")
    }

    /// Get proxy URL for HTTP/HTTPS requests, respecting NO_PROXY.
    /// `hostname` is the host without port (e.g., "localhost")
    /// `host` is the host with port if present (e.g., "localhost:3000")
    pub fn get_http_proxy(
        &mut self,
        is_http: bool,
        hostname: Option<&[u8]>,
        host: Option<&[u8]>,
    ) -> Option<URL<'a>> {
        // TODO: When Web Worker support is added, make sure to intern these strings
        //
        // Lifetime: the returned `URL` borrows env-var values that are
        // `Box<[u8]>`-owned by `*self.map: Map`, which is borrowed for `'a`
        // (`map: &'a mut Map`). The boxed allocations are address-stable
        // across rehashes and Bun never removes/overwrites the proxy env vars
        // after they are read here, so the slices are valid for `'a`. This is
        // the same contract Zig `getHttpProxy` (env_loader.zig:174) relies on
        // by returning `[]const u8` borrowing the loader's map. Encapsulating
        // the extension here keeps every caller (PackageManager, fetch,
        // upgrade, create) free of `transmute` (PORTING.md §Forbidden).
        //
        // SAFETY: see above — `s` points into a `Box<[u8]>` owned by
        // `*self.map`, which outlives `'a`.
        let extend =
            |s: &[u8]| -> &'a [u8] { unsafe { core::slice::from_raw_parts(s.as_ptr(), s.len()) } };

        let mut http_proxy: Option<URL<'a>> = None;

        let proxy = if is_http {
            self.get_lower_then_upper(b"http_proxy", b"HTTP_PROXY")
        } else {
            self.get_lower_then_upper(b"https_proxy", b"HTTPS_PROXY")
        };
        if let Some(p) = proxy {
            if !Self::is_emptyish(p) {
                http_proxy = Some(URL::parse(extend(p)));
            }
        }

        if http_proxy.is_some() && hostname.is_some() {
            if self.is_no_proxy(hostname, host) {
                return None;
            }
        }
        http_proxy
    }

    /// Returns true if the given hostname/host should bypass the proxy
    /// according to the NO_PROXY / no_proxy environment variable.
    pub fn is_no_proxy(&self, hostname: Option<&[u8]>, host: Option<&[u8]>) -> bool {
        // NO_PROXY filter
        // See the syntax at https://about.gitlab.com/blog/2021/01/27/we-need-to-talk-no-proxy/
        let Some(hn) = hostname else { return false };

        let Some(no_proxy_text) = self.get_lower_then_upper(b"no_proxy", b"NO_PROXY") else {
            return false;
        };
        if Self::is_emptyish(no_proxy_text) {
            return false;
        }

        for no_proxy_item in no_proxy_text.split(|&b| b == b',') {
            let mut no_proxy_entry = strings::trim(no_proxy_item, &strings::WHITESPACE_CHARS);
            if no_proxy_entry.is_empty() {
                continue;
            }
            if no_proxy_entry == b"*" {
                return true;
            }
            // strips .
            if strings::starts_with_char(no_proxy_entry, b'.') {
                no_proxy_entry = &no_proxy_entry[1..];
                if no_proxy_entry.is_empty() {
                    continue;
                }
            }

            // Determine if entry contains a port or is an IPv6 address
            // IPv6 addresses contain multiple colons (e.g., "::1", "2001:db8::1")
            // Bracketed IPv6 with port: "[::1]:8080"
            // Host with port: "localhost:8080" (single colon)
            let colon_count = no_proxy_entry.iter().filter(|&&b| b == b':').count();
            let is_bracketed_ipv6 = strings::starts_with_char(no_proxy_entry, b'[');
            let has_port = 'blk: {
                if is_bracketed_ipv6 {
                    // Bracketed IPv6: check for "]:port" pattern
                    if strings::index_of(no_proxy_entry, b"]:").is_some() {
                        break 'blk true;
                    }
                    break 'blk false;
                } else if colon_count == 1 {
                    // Single colon means host:port (not IPv6)
                    break 'blk true;
                }
                // Multiple colons without brackets = bare IPv6 literal (no port)
                break 'blk false;
            };

            if has_port {
                // Entry has a port, do exact match against host:port
                if let Some(h) = host {
                    if strings::eql_case_insensitive_ascii(h, no_proxy_entry, true) {
                        return true;
                    }
                }
            } else {
                // Entry is hostname/IPv6 only, match exact or dot-boundary suffix (case-insensitive)
                let entry_len = no_proxy_entry.len();
                if hn.len() == entry_len {
                    if strings::eql_case_insensitive_ascii(hn, no_proxy_entry, true) {
                        return true;
                    }
                } else if hn.len() > entry_len
                    && hn[hn.len() - entry_len - 1] == b'.'
                    && strings::eql_case_insensitive_ascii(
                        &hn[hn.len() - entry_len..],
                        no_proxy_entry,
                        true,
                    )
                {
                    return true;
                }
            }
        }

        false
    }

    pub fn load_ccache_path(&mut self, fs: &bun_paths::fs::FileSystem) {
        if DID_LOAD_CCACHE_PATH.load(Ordering::Relaxed) {
            return;
        }
        DID_LOAD_CCACHE_PATH.store(true, Ordering::Relaxed);
        let _ = self.load_ccache_path_impl(fs);
    }

    fn load_ccache_path_impl(&mut self, fs: &bun_paths::fs::FileSystem) -> Result<(), AllocError> {
        // if they have ccache installed, put it in env variable `CMAKE_CXX_COMPILER_LAUNCHER` so
        // cmake can use it to hopefully speed things up
        let mut buf = PathBuffer::uninit();
        let path = match self.get(b"PATH") {
            Some(p) => p,
            None => return Ok(()),
        };
        // PORT NOTE: borrowck — `path` borrows `self.map`; `which` writes into `buf` and
        // returns a borrow of `buf`. Copy the result before mutating `self.map`.
        let ccache_path: Box<[u8]> = which(&mut buf, path, fs.top_level_dir(), b"ccache")
            .map(|z| Box::<[u8]>::from(z.as_bytes()))
            .unwrap_or_default();

        if !ccache_path.is_empty() {
            let cxx_gop = self
                .map
                .get_or_put_without_value(b"CMAKE_CXX_COMPILER_LAUNCHER")?;
            if !cxx_gop.found_existing {
                *cxx_gop.key_ptr = Box::<[u8]>::from(&**cxx_gop.key_ptr);
                *cxx_gop.value_ptr = HashTableValue {
                    value: ccache_path.clone(),
                    conditional: false,
                };
            }
            let c_gop = self
                .map
                .get_or_put_without_value(b"CMAKE_C_COMPILER_LAUNCHER")?;
            if !c_gop.found_existing {
                *c_gop.key_ptr = Box::<[u8]>::from(&**c_gop.key_ptr);
                *c_gop.value_ptr = HashTableValue {
                    value: ccache_path,
                    conditional: false,
                };
            }
        }
        Ok(())
    }

    /// Port of `loadNodeJSConfig` (env_loader.zig:332). Populates `NODE` /
    /// `npm_node_execpath` with the resolved node binary path. Returns `false`
    /// only when no node could be discovered and no override was supplied.
    pub fn load_node_js_config(
        &mut self,
        fs: &bun_paths::fs::FileSystem,
        override_node: &[u8],
    ) -> Result<bool, bun_core::Error> {
        let mut buf = PathBuffer::uninit();

        let node_path_to_use: Box<[u8]> = if !override_node.is_empty() {
            Box::from(override_node)
        } else {
            let cached: Option<Box<[u8]>> = NODE_PATH_TO_USE_SET_ONCE
                .read()
                .as_ref()
                .filter(|b| !b.is_empty())
                .cloned();
            if let Some(c) = cached {
                c
            } else {
                let Some(node) = self.get_node_path(fs, &mut buf) else {
                    return Ok(false);
                };
                // PORT NOTE: Zig used `fs.dirname_store.append` (interning arena
                // returning 'static slice). RwLock owns a Box; just box here.
                Box::from(node.as_bytes())
            }
        };
        // Zig order (env_loader.zig:344-346): cache to `node_path_to_use_set_once`
        // first, then `map.put` (which dupes the bytes).
        *NODE_PATH_TO_USE_SET_ONCE.write() = Some(node_path_to_use.clone());
        self.map.put(b"NODE", &node_path_to_use)?;
        self.map.put(b"npm_node_execpath", &node_path_to_use)?;
        Ok(true)
    }

    // TODO(port): Zig `getAs(comptime T: type)` only implements `bool`; expose as concrete fn.
    pub fn get_as_bool(&self, key: &[u8]) -> Option<bool> {
        let value = self.get(key)?;
        if value == b"" {
            return Some(false);
        }
        if value == b"0" {
            return Some(false);
        }
        if value == b"NO" {
            return Some(false);
        }
        if value == b"OFF" {
            return Some(false);
        }
        if value == b"false" {
            return Some(false);
        }

        Some(true)
    }

    /// Returns whether the `BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD` env var is set to something truthy
    pub fn has_set_no_clear_terminal_on_reload(&self, default_value: bool) -> bool {
        HAS_NO_CLEAR_SCREEN_CLI_FLAG
            .get()
            .copied()
            .or_else(|| self.get_as_bool(b"BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD"))
            .unwrap_or(default_value)
    }

    pub fn get(&self, key: &[u8]) -> Option<&[u8]> {
        let mut _key = key;
        if !_key.is_empty() && _key[0] == b'$' {
            _key = &key[1..];
        }

        if _key.is_empty() {
            return None;
        }

        self.map.get(_key)
    }

    pub fn get_auto<'b>(&'b self, key: &'b [u8]) -> &'b [u8] {
        // If it's "" or "$", it's not a variable
        if key.len() < 2 || key[0] != b'$' {
            return key;
        }

        self.get(&key[1..]).unwrap_or(key)
    }

    // `copyForDefine` moved up into `bun_bundler::defines::copy_env_for_define`
    // — it constructs `E::String` + `DefineData`, both higher-tier types, and
    // only reads `self.map.map.{keys,values}()` from this crate.

    pub fn init(map: &'a mut Map) -> Loader<'a> {
        Loader {
            map,
            env_local: None,
            env_development: None,
            env_production: None,
            env_test: None,
            env_development_local: None,
            env_production_local: None,
            env_test_local: None,
            env: None,
            custom_files_loaded: StringArrayHashMap::default(),
            quiet: false,
            did_load_process: false,
            reject_unauthorized: None,
            aws_credentials: None,
        }
    }

    pub fn load_process(&mut self) -> Result<(), AllocError> {
        if self.did_load_process {
            return Ok(());
        }

        let environ: &[*const c_char] = bun_sys::environ();
        self.map.map.ensure_total_capacity(environ.len())?;
        for &_env in environ {
            // SAFETY: environ entries are NUL-terminated C strings from the OS
            let env = unsafe { bun_core::ffi::cstr(_env) }.to_bytes();
            if let Some(i) = strings::index_of_char(env, b'=') {
                let key = &env[..i as usize];
                let value = &env[i as usize + 1..];
                if !key.is_empty() {
                    self.map.put(key, value)?;
                }
            } else {
                if !env.is_empty() {
                    self.map.put(env, b"")?;
                }
            }
        }
        self.did_load_process = true;
        Ok(())
    }

    // mostly for tests
    pub fn load_from_string<const OVERWRITE: bool, const EXPAND: bool>(
        &mut self,
        str: &[u8],
    ) -> Result<(), AllocError> {
        // PORT NOTE: Zig built a `logger.Source` here; the only field `Parser`
        // reads is `.contents`, so go straight to `parse_bytes` and avoid the
        // `Source.contents: &'static [u8]` lifetime constraint (callers like
        // `node:util.parseEnv` pass JS-owned non-'static buffers).
        let mut value_buffer: Vec<u8> = Vec::new();
        Parser::parse_bytes::<OVERWRITE, false, EXPAND>(str, self.map, &mut value_buffer)
    }

    pub fn load<D: DirEntryProbe + ?Sized>(
        &mut self,
        dir: &D,
        env_files: &[&[u8]],
        suffix: DotEnvFileSuffix,
        skip_default_env: bool,
    ) -> Result<(), bun_core::Error> {
        // PERF(port): SUFFIX was `comptime DotEnvFileSuffix` — demoted to runtime arg
        // (avoids unstable adt_const_params; cold path). Argument order matches the Zig
        // signature (`dir, env_files, comptime suffix, skip_default_env`) so high-tier
        // callers (transpiler/install/lockfile) need no shim.
        let start = bun_core::time::nano_timestamp();

        // Create a reusable buffer for parsing multiple files.
        // PERF(port): Zig used a 4 KiB stack-fallback allocator; plain Vec here.
        let mut value_buffer: Vec<u8> = Vec::new();

        if !env_files.is_empty() {
            self.load_explicit_files(env_files, &mut value_buffer)?;
        } else {
            // Do not automatically load .env files in `bun run <script>`
            // Instead, it is the responsibility of the script's instance of `bun` to load .env,
            // so that if the script runner is NODE_ENV=development, but the script is
            // "NODE_ENV=production bun ...", there should be no development env loaded.
            //
            // See https://github.com/oven-sh/bun/issues/9635#issuecomment-2021350123
            // for more details on how this edge case works.
            if !skip_default_env {
                self.load_default_files(suffix, dir, &mut value_buffer)?;
            }
        }

        if !self.quiet {
            self.print_loaded(start);
        }
        Ok(())
    }

    fn load_explicit_files(
        &mut self,
        env_files: &[&[u8]],
        value_buffer: &mut Vec<u8>,
    ) -> Result<(), bun_core::Error> {
        // iterate backwards, so the latest entry in the latest arg instance assumes the highest priority
        let mut i: usize = env_files.len();
        while i > 0 {
            let arg_value = strings::trim(env_files[i - 1], b" ");
            if !arg_value.is_empty() {
                // ignore blank args
                for file_path in arg_value.rsplit(|&b| b == b',') {
                    if !file_path.is_empty() {
                        self.load_env_file_dynamic::<false>(file_path, value_buffer)?;
                        analytics::Features::dotenv_inc();
                    }
                }
            }
            i -= 1;
        }
        Ok(())
    }

    // .env.local goes first
    // Load .env.development if development
    // Load .env.production if !development
    // .env goes last
    fn load_default_files<D: DirEntryProbe + ?Sized>(
        &mut self,
        suffix: DotEnvFileSuffix,
        dir: &D,
        value_buffer: &mut Vec<u8>,
    ) -> Result<(), bun_core::Error> {
        let dir_handle = bun_sys::Fd::cwd();

        // PORT NOTE: Zig calls `dir.hasComptimeQuery(...)` on a
        // `*FileSystem.DirEntry` (env_loader.zig). `bun_dotenv` sits below
        // `bun_resolver` in the crate graph, so the directory entry is taken
        // generically — `bun_resolver::fs::DirEntry` impls `DirEntryProbe`.
        match suffix {
            DotEnvFileSuffix::Development => {
                self.try_load_default(dir, dir_handle, b".env.development.local", value_buffer)?
            }
            DotEnvFileSuffix::Production => {
                self.try_load_default(dir, dir_handle, b".env.production.local", value_buffer)?
            }
            DotEnvFileSuffix::Test => {
                self.try_load_default(dir, dir_handle, b".env.test.local", value_buffer)?
            }
        }

        if suffix != DotEnvFileSuffix::Test {
            self.try_load_default(dir, dir_handle, b".env.local", value_buffer)?;
        }

        match suffix {
            DotEnvFileSuffix::Development => {
                self.try_load_default(dir, dir_handle, b".env.development", value_buffer)?
            }
            DotEnvFileSuffix::Production => {
                self.try_load_default(dir, dir_handle, b".env.production", value_buffer)?
            }
            DotEnvFileSuffix::Test => {
                self.try_load_default(dir, dir_handle, b".env.test", value_buffer)?
            }
        }

        self.try_load_default(dir, dir_handle, b".env", value_buffer)
    }

    /// Probe `dir` for a known `.env*` filename and, if present, load it into
    /// its dedicated slot and bump the analytics counter. Shared body for the
    /// eight unrolled call sites in `load_default_files` (Zig unrolled them for
    /// `hasComptimeQuery`'s comptime-string requirement, which Rust lacks).
    #[inline]
    fn try_load_default<D: DirEntryProbe + ?Sized>(
        &mut self,
        dir: &D,
        dir_handle: bun_sys::Fd,
        name: &'static [u8],
        value_buffer: &mut Vec<u8>,
    ) -> Result<(), bun_core::Error> {
        if dir.has_comptime_query(name) {
            self.load_env_file::<false>(dir_handle, name, value_buffer)?;
            analytics::Features::dotenv_inc();
        }
        Ok(())
    }

    pub fn print_loaded(&self, start: i128) {
        let count: usize = (self.env_development_local.is_some() as usize)
            + (self.env_production_local.is_some() as usize)
            + (self.env_test_local.is_some() as usize)
            + (self.env_local.is_some() as usize)
            + (self.env_development.is_some() as usize)
            + (self.env_production.is_some() as usize)
            + (self.env_test.is_some() as usize)
            + (self.env.is_some() as usize)
            + self.custom_files_loaded.count();

        if count == 0 {
            return;
        }
        let elapsed = (bun_core::time::nano_timestamp() - start) as f64 / 1_000_000.0;

        const ALL: [&[u8]; 8] = [
            b".env.development.local",
            b".env.production.local",
            b".env.test.local",
            b".env.local",
            b".env.development",
            b".env.production",
            b".env.test",
            b".env",
        ];
        let loaded: [bool; 8] = [
            self.env_development_local.is_some(),
            self.env_production_local.is_some(),
            self.env_test_local.is_some(),
            self.env_local.is_some(),
            self.env_development.is_some(),
            self.env_production.is_some(),
            self.env_test.is_some(),
            self.env.is_some(),
        ];

        let mut loaded_i: usize = 0;
        Output::print_elapsed(elapsed);
        bun_core::pretty_error!(" <d>");

        for (i, &yes) in loaded.iter().enumerate() {
            if yes {
                loaded_i += 1;
                if count == 1 || (loaded_i >= count && count > 1) {
                    bun_core::pretty_error!("\"{}\"", bstr::BStr::new(ALL[i]));
                } else {
                    bun_core::pretty_error!("\"{}\", ", bstr::BStr::new(ALL[i]));
                }
            }
        }

        // PORT NOTE: `iterator()` requires `&mut self`; iterate `keys()` slice instead.
        for k in self.custom_files_loaded.keys() {
            loaded_i += 1;
            if count == 1 || (loaded_i >= count && count > 1) {
                bun_core::pretty_error!("\"{}\"", bstr::BStr::new(k));
            } else {
                bun_core::pretty_error!("\"{}\", ", bstr::BStr::new(k));
            }
        }

        bun_core::pretty_errorln!("<r>");
        Output::flush();
    }

    /// Helper: maps a comptime `.env*` filename to its `Option<Source>` field.
    /// Replaces Zig `@field(this, base)`.
    fn default_file_slot(&mut self, base: &'static [u8]) -> &mut Option<bun_ast::Source> {
        match base {
            b".env.local" => &mut self.env_local,
            b".env.development" => &mut self.env_development,
            b".env.production" => &mut self.env_production,
            b".env.test" => &mut self.env_test,
            b".env.development.local" => &mut self.env_development_local,
            b".env.production.local" => &mut self.env_production_local,
            b".env.test.local" => &mut self.env_test_local,
            b".env" => &mut self.env,
            _ => unreachable!(),
        }
    }

    pub fn load_env_file<const OVERRIDE: bool>(
        &mut self,
        dir: bun_sys::Fd,
        base: &'static [u8],
        value_buffer: &mut Vec<u8>,
    ) -> Result<(), bun_core::Error> {
        if self.default_file_slot(base).is_some() {
            return Ok(());
        }

        // PORT NOTE: Zig used `std.fs.Dir.openFile` whose error set names
        // (`error.FileNotFound`, `error.FileBusy`, …) don't map 1:1 to errno.
        // `bun_sys` is errno-based, so the match arms below approximate the Zig
        // error groups by errno. Any errno not listed propagates (matches the
        // Zig `else => return err`).
        let file =
            match bun_sys::File::openat(dir, base, bun_sys::O::RDONLY | bun_sys::O::CLOEXEC, 0) {
                Ok(file) => file,
                Err(err) => {
                    use bun_sys::E;
                    match err.get_errno() {
                        E::EISDIR | E::ENOENT => {
                            // prevent retrying
                            *self.default_file_slot(base) =
                                Some(bun_ast::Source::init_path_string(base, b""));
                            return Ok(());
                        }
                        E::EBUSY | E::EACCES => {
                            if !self.quiet {
                                bun_core::pretty_errorln!(
                                    "<r><red>{}<r> error loading {} file",
                                    bstr::BStr::new(err.name()),
                                    bstr::BStr::new(base)
                                );
                            }
                            // prevent retrying
                            *self.default_file_slot(base) =
                                Some(bun_ast::Source::init_path_string(base, b""));
                            return Ok(());
                        }
                        _ => return Err(err.into()),
                    }
                }
            };
        let _close = bun_sys::CloseOnDrop::file(&file);

        match read_env_file_contents(&file)? {
            ReadEnvFile::Empty => {}
            ReadEnvFile::ReadErr(err) => {
                if !self.quiet {
                    bun_core::pretty_errorln!(
                        "<r><red>{}<r> error loading {} file",
                        bstr::BStr::new(err.name()),
                        bstr::BStr::new(base)
                    );
                }
            }
            ReadEnvFile::Bytes(buf) => {
                Parser::parse_bytes::<OVERRIDE, false, true>(&buf, &mut *self.map, value_buffer)?;
            }
        }

        // TODO(port): Zig retained the file buffer in `Source.contents`; here we
        // drop it after parsing because `bun_ast::Source.contents` is
        // `&'static [u8]` and §Forbidden bans `Box::leak`. The stored `Source`
        // is only ever checked for `.is_some()` / its path printed, so dropping
        // the bytes is observationally identical. Revisit once `bun_logger`
        // grows an owning `contents` (Phase-B `Str` rework).
        *self.default_file_slot(base) = Some(bun_ast::Source::init_path_string(base, b""));
        Ok(())
    }

    pub fn load_env_file_dynamic<const OVERRIDE: bool>(
        &mut self,
        file_path: &[u8],
        value_buffer: &mut Vec<u8>,
    ) -> Result<(), bun_core::Error> {
        if self.custom_files_loaded.contains(file_path) {
            return Ok(());
        }

        let file = match bun_sys::open_file(file_path, bun_sys::OpenFlags::READ_ONLY) {
            Ok(f) => f,
            Err(_) => {
                // prevent retrying
                // PORT NOTE: `Source::init_path_string` requires a `'static` path; the
                // map key already carries `file_path` (boxed), and the value is never
                // read for its path/contents — only `.contains()` and key iteration —
                // so an empty placeholder is observationally identical.
                self.custom_files_loaded
                    .put(file_path, bun_ast::Source::default())?;
                return Ok(());
            }
        };
        let _close = bun_sys::CloseOnDrop::file(&file);

        match read_env_file_contents(&file)? {
            ReadEnvFile::Empty => {}
            ReadEnvFile::ReadErr(err) => {
                if !self.quiet {
                    bun_core::pretty_errorln!(
                        "<r><red>{}<r> error loading {} file",
                        bstr::BStr::new(err.name()),
                        bstr::BStr::new(file_path)
                    );
                }
            }
            ReadEnvFile::Bytes(buf) => {
                Parser::parse_bytes::<OVERRIDE, false, true>(&buf, &mut *self.map, value_buffer)?;
            }
        }

        // TODO(port): see `load_env_file` — `Source.contents` not retained
        // pending the `bun_logger` owning-`Str` rework.
        self.custom_files_loaded
            .put(file_path, bun_ast::Source::default())?;
        Ok(())
    }
}

/// Shared post-open tail of `load_env_file` / `load_env_file_dynamic`:
/// `File::read_to_end` (fstat-presized) with the recoverable-errno filter.
/// The two callers differ in their open path, open-error handling, and the
/// memo slot they write — those stay in the callers (see env_loader.zig
/// :784 vs :874). Only the byte-identical read tail is factored here.
enum ReadEnvFile {
    /// Zero-length — caller marks the slot and returns.
    Empty,
    /// Recoverable read errno (ENOMEM/EPIPE/EACCES/EISDIR) — caller prints
    /// (unless `quiet`), marks the slot, and returns.
    ReadErr(bun_sys::Error),
    /// File contents; `buf.len()` is the amount read.
    Bytes(Vec<u8>),
}

fn read_env_file_contents(file: &bun_sys::File) -> Result<ReadEnvFile, bun_core::Error> {
    match file.read_to_end() {
        Ok(buf) if buf.is_empty() => Ok(ReadEnvFile::Empty),
        Ok(buf) => Ok(ReadEnvFile::Bytes(buf)),
        Err(err) => {
            use bun_sys::E;
            match err.get_errno() {
                E::ENOMEM | E::EPIPE | E::EACCES | E::EISDIR => Ok(ReadEnvFile::ReadErr(err)),
                _ => Err(err.into()),
            }
        }
    }
}

struct Parser<'a> {
    pos: usize,
    src: &'a [u8],
    value_buffer: &'a mut Vec<u8>,
}

const WHITESPACE_CHARS: &[u8] = b"\t\x0B\x0C \xA0\n\r";

impl<'a> Parser<'a> {
    fn skip_line(&mut self) {
        if let Some(i) = strings::index_of_any(&self.src[self.pos..], b"\n\r") {
            self.pos += i as usize + 1;
        } else {
            self.pos = self.src.len();
        }
    }

    fn skip_whitespaces(&mut self) {
        let mut i = self.pos;
        while i < self.src.len() {
            if strings::index_of_char(WHITESPACE_CHARS, self.src[i]).is_none() {
                break;
            }
            i += 1;
        }
        self.pos = i;
    }

    fn parse_key<const CHECK_EXPORT: bool>(&mut self) -> Option<&'a [u8]> {
        if CHECK_EXPORT {
            self.skip_whitespaces();
        }
        let start = self.pos;
        let mut end = start;
        while end < self.src.len() {
            match self.src[end] {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'-' | b'.' => {
                    end += 1;
                    continue;
                }
                _ => break,
            }
        }
        if end < self.src.len() && start < end {
            self.pos = end;
            self.skip_whitespaces();
            if self.pos < self.src.len() {
                if CHECK_EXPORT {
                    if end < self.pos && &self.src[start..end] == b"export" {
                        if let Some(key) = self.parse_key::<false>() {
                            return Some(key);
                        }
                    }
                }
                match self.src[self.pos] {
                    b'=' => {
                        self.pos += 1;
                        return Some(&self.src[start..end]);
                    }
                    b':' => {
                        let next = self.pos + 1;
                        if next < self.src.len()
                            && strings::index_of_char(WHITESPACE_CHARS, self.src[next]).is_some()
                        {
                            self.pos += 2;
                            return Some(&self.src[start..end]);
                        }
                    }
                    _ => {}
                }
            }
        }
        self.pos = start;
        None
    }

    fn parse_quoted<const QUOTE: u8>(&mut self) -> Result<Option<&[u8]>, AllocError> {
        if cfg!(debug_assertions) {
            debug_assert!(self.src[self.pos] == QUOTE);
        }
        let start = self.pos;
        self.value_buffer.clear(); // Reset the buffer
        let mut end = start + 1;
        while end < self.src.len() {
            match self.src[end] {
                b'\\' => end += 1,
                q if q == QUOTE => {
                    end += 1;
                    self.pos = end;
                    self.skip_whitespaces();
                    if self.pos >= self.src.len()
                        || self.src[self.pos] == b'#'
                        || strings::index_of_char(&self.src[end..self.pos], b'\n').is_some()
                        || strings::index_of_char(&self.src[end..self.pos], b'\r').is_some()
                    {
                        let mut i = start;
                        while i < end {
                            match self.src[i] {
                                b'\\' => {
                                    if QUOTE == b'"' {
                                        if cfg!(debug_assertions) {
                                            debug_assert!(i + 1 < end);
                                        }
                                        match self.src[i + 1] {
                                            b'n' => {
                                                self.value_buffer.push(b'\n');
                                                i += 2;
                                            }
                                            b'r' => {
                                                self.value_buffer.push(b'\r');
                                                i += 2;
                                            }
                                            _ => {
                                                self.value_buffer
                                                    .extend_from_slice(&self.src[i..i + 2]);
                                                i += 2;
                                            }
                                        }
                                    } else {
                                        self.value_buffer.push(b'\\');
                                        i += 1;
                                    }
                                }
                                b'\r' => {
                                    i += 1;
                                    if i >= end || self.src[i] != b'\n' {
                                        self.value_buffer.push(b'\n');
                                    }
                                }
                                c => {
                                    self.value_buffer.push(c);
                                    i += 1;
                                }
                            }
                        }
                        return Ok(Some(self.value_buffer.as_slice()));
                    }
                    self.pos = start;
                    // PORT NOTE: fallthrough to outer loop's `end += 1` (Zig switch fallthrough)
                }
                _ => {}
            }
            end += 1;
        }
        Ok(None)
    }

    fn parse_value<const IS_PROCESS: bool>(&mut self) -> Result<&[u8], AllocError> {
        let start = self.pos;
        self.skip_whitespaces();
        let mut end = self.pos;
        if end >= self.src.len() {
            return Ok(&self.src[self.src.len()..]);
        }
        // PORT NOTE: reshaped for borrowck — `parse_quoted` returns a borrow of
        // `self.value_buffer`; capture only its length, then re-borrow the buffer
        // after the match so the unquoted fallthrough can re-borrow `self`.
        let quoted_len: Option<usize> = match self.src[end] {
            b'`' => self.parse_quoted::<{ b'`' }>()?.map(|v| v.len()),
            b'"' => self.parse_quoted::<{ b'"' }>()?.map(|v| v.len()),
            b'\'' => self.parse_quoted::<{ b'\'' }>()?.map(|v| v.len()),
            _ => None,
        };
        if let Some(len) = quoted_len {
            let value = &self.value_buffer[..len];
            return Ok(if IS_PROCESS {
                value
            } else {
                &value[1..value.len() - 1]
            });
        }
        end = start;
        while end < self.src.len() {
            match self.src[end] {
                b'#' | b'\r' | b'\n' => break,
                _ => {}
            }
            end += 1;
        }
        self.pos = end;
        Ok(strings::trim(&self.src[start..end], WHITESPACE_CHARS))
    }

    fn expand_value(&mut self, map: &Map, value: &[u8]) -> Result<Option<&[u8]>, AllocError> {
        if value.len() < 2 {
            return Ok(None);
        }

        self.value_buffer.clear();

        let mut pos = value.len() - 2;
        let mut last = value.len();
        loop {
            if value[pos] == b'$' {
                if pos > 0 && value[pos - 1] == b'\\' {
                    // PERF(port): insertSlice(0, ..) is O(n); same as Zig
                    self.value_buffer
                        .splice(0..0, value[pos..last].iter().copied());
                    pos -= 1;
                } else {
                    let mut end = if value[pos + 1] == b'{' {
                        pos + 2
                    } else {
                        pos + 1
                    };
                    let key_start = end;
                    while end < value.len() {
                        match value[end] {
                            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' => {
                                end += 1;
                                continue;
                            }
                            _ => break,
                        }
                    }
                    let lookup_value = map.get(&value[key_start..end]);
                    let default_value: &[u8] = if value[end..].starts_with(b":-") {
                        end += b":-".len();
                        let value_start = end;
                        while end < value.len() {
                            match value[end] {
                                b'}' | b'\\' => break,
                                _ => {
                                    end += 1;
                                    continue;
                                }
                            }
                        }
                        &value[value_start..end]
                    } else {
                        b""
                    };
                    if end < value.len() && value[end] == b'}' {
                        end += 1;
                    }
                    self.value_buffer
                        .splice(0..0, value[end..last].iter().copied());
                    self.value_buffer
                        .splice(0..0, lookup_value.unwrap_or(default_value).iter().copied());
                }
                last = pos;
            }
            if pos == 0 {
                if last == value.len() {
                    return Ok(None);
                }
                break;
            }
            pos -= 1;
        }
        if last > 0 {
            self.value_buffer
                .splice(0..0, value[..last].iter().copied());
        }
        Ok(Some(self.value_buffer.as_slice()))
    }

    fn _parse<const OVERRIDE: bool, const IS_PROCESS: bool, const EXPAND: bool>(
        &mut self,
        map: &mut Map,
    ) -> Result<(), AllocError> {
        let mut count = map.map.count();
        while self.pos < self.src.len() {
            let Some(key) = self.parse_key::<true>() else {
                self.skip_line();
                continue;
            };
            let value = self.parse_value::<IS_PROCESS>()?;
            // PORT NOTE: reshaped for borrowck — value borrows self.value_buffer; copy before map mut.
            let value_owned: Box<[u8]> = Box::from(value);
            let entry = map.map.get_or_put(key)?;
            if entry.found_existing {
                if entry.index < count {
                    // Allow keys defined later in the same file to override keys defined earlier
                    // https://github.com/oven-sh/bun/issues/1262
                    if !OVERRIDE {
                        continue;
                    }
                }
                // else: previous value freed by Drop on assignment below
            }
            *entry.value_ptr = HashTableValue {
                value: value_owned,
                conditional: false,
            };
        }
        if !IS_PROCESS && EXPAND {
            // PORT NOTE: borrowck — Zig iterates `map` while calling `map.get` inside expandValue.
            // Reshaped to index-based iteration: clone the value bytes, run expansion against an
            // immutable `&Map`, then write back via `values_mut()`. The clone matches the Zig:
            // values are dupe'd by `_parse` above, so length is bounded by file size.
            let total = map.map.count();
            let mut idx = count;
            while idx < total {
                let current: Box<[u8]> = Box::from(&*map.map.values()[idx].value);
                if let Some(expanded) = self.expand_value(map, &current)? {
                    map.map.values_mut()[idx] = HashTableValue {
                        value: Box::from(expanded),
                        conditional: false,
                    };
                }
                idx += 1;
            }
            count = 0;
        }
        let _ = count;
        Ok(())
    }

    pub(crate) fn parse<const OVERRIDE: bool, const IS_PROCESS: bool, const EXPAND: bool>(
        source: &bun_ast::Source,
        map: &mut Map,
        value_buffer: &mut Vec<u8>,
    ) -> Result<(), AllocError> {
        Self::parse_bytes::<OVERRIDE, IS_PROCESS, EXPAND>(&source.contents, map, value_buffer)
    }

    /// Same as [`parse`] but takes the source bytes directly. Exists so
    /// `load_env_file*` can parse a transient `Vec<u8>` without constructing a
    /// `bun_ast::Source` (whose `contents` field is currently `&'static [u8]`).
    // PORT NOTE: Zig built a `logger.Source` and passed `&source` — the only
    // field `Parser` reads is `.contents`, so this is observationally identical.
    pub(crate) fn parse_bytes<const OVERRIDE: bool, const IS_PROCESS: bool, const EXPAND: bool>(
        src: &[u8],
        map: &mut Map,
        value_buffer: &mut Vec<u8>,
    ) -> Result<(), AllocError> {
        // Clear the buffer before each parse to ensure no leftover data
        value_buffer.clear();
        let mut parser = Parser {
            pos: 0,
            src,
            value_buffer,
        };
        parser._parse::<OVERRIDE, IS_PROCESS, EXPAND>(map)
    }
}

/// Downstream callers spell this `dot_env::Value` / `dotenv::map::Entry`; both alias the
/// canonical `HashTableValue`.
pub type Value = HashTableValue;

#[derive(Default, Clone)]
pub struct HashTableValue {
    // TODO(port): Zig stored borrowed `[]const u8`; values are sometimes allocator.dupe'd, sometimes
    // borrowed from environ. Using Box<[u8]> here for owned-by-default; Phase B may need Cow.
    pub value: Box<[u8]>,
    pub conditional: bool,
}

// On Windows, environment variables are case-insensitive. So we use a case-insensitive hash map.
// An issue with this exact implementation is unicode characters can technically appear in these
// keys, and we use a simple toLowercase function that only applies to ascii, so this will make
// some strings collide.
// Spec: env_loader.zig:1220 — `bun.CaseInsensitiveASCIIStringArrayHashMap` on Windows.
#[cfg(not(windows))]
pub type HashTable = bun_collections::StringArrayHashMap<HashTableValue>;
#[cfg(windows)]
pub type HashTable = bun_collections::CaseInsensitiveAsciiStringArrayHashMap<HashTableValue>;

pub struct Map {
    pub map: HashTable,
}

impl Default for Map {
    fn default() -> Self {
        Self::init()
    }
}

impl Map {
    /// Builds a NULL-terminated `K=V\0` envp array. Returns an owning struct so
    /// dropping it frees the joined buffers (PORTING.md §Forbidden: no Box::leak).
    /// Zig used an arena; here the struct *is* the arena.
    pub fn create_null_delimited_env_map(&mut self) -> Result<NullDelimitedEnvMap, AllocError> {
        let envp_count = self.map.count();
        let mut storage: Vec<Box<[u8]>> = Vec::with_capacity(envp_count);
        let mut envp_buf: Vec<*const c_char> = Vec::with_capacity(envp_count + 1);
        {
            let mut it = self.map.iterator();
            let mut i: usize = 0;
            while let Some(pair) = it.next() {
                let klen = pair.key_ptr.len();
                let vlen = pair.value_ptr.value.len();
                let mut env_buf = vec![0u8; klen + vlen + 2].into_boxed_slice();
                env_buf[..klen].copy_from_slice(pair.key_ptr);
                env_buf[klen] = b'=';
                env_buf[klen + 1..klen + 1 + vlen].copy_from_slice(&pair.value_ptr.value);
                // env_buf[klen + 1 + vlen] = 0; (already zero-initialized)
                envp_buf.push(env_buf.as_ptr().cast::<c_char>());
                storage.push(env_buf);
                i += 1;
            }
            #[cfg(debug_assertions)]
            debug_assert!(i == envp_count);
        }
        envp_buf.push(core::ptr::null()); // sentinel
        Ok(NullDelimitedEnvMap {
            storage,
            envp: envp_buf.into_boxed_slice(),
        })
    }

    /// Returns a wrapper around the std.process.EnvMap that does not duplicate the memory of
    /// the keys and values, but instead points into the memory of the bun env map.
    // TODO(port): `bun_sys::EnvMap` is `HashMap<String, String>`, which copies and is
    // UTF-8-lossy. Zig's `std.process.EnvMap` stored `[]const u8` borrows. Phase C: replace
    // `bun_sys::EnvMap` with a `&[u8]`-keyed map and drop the lossy round-trip here.
    pub fn std_env_map(&mut self) -> Result<StdEnvMapWrapper, AllocError> {
        let mut env_map = bun_sys::EnvMap::default();
        let mut it = self.map.iterator();
        while let Some(entry) = it.next() {
            env_map.insert(
                String::from_utf8_lossy(entry.key_ptr).into_owned(),
                String::from_utf8_lossy(&entry.value_ptr.value).into_owned(),
            );
        }
        Ok(StdEnvMapWrapper {
            unsafe_map: env_map,
        })
    }

    /// Write the Windows environment block into a buffer
    /// This can be passed to CreateProcessW's lpEnvironment parameter
    pub fn write_windows_env_block(
        &mut self,
        result: &mut [u16; 32767],
    ) -> Result<*const u16, bun_core::Error> {
        let mut i: usize = 0;
        let mut it = self.map.iterator();
        while let Some(pair) = it.next() {
            i += strings::convert_utf8_to_utf16_in_buffer(&mut result[i..], pair.key_ptr).len();
            if i + 7 >= result.len() {
                return Err(bun_core::Error::from_name("TooManyEnvironmentVariables"));
            }
            result[i] = b'=' as u16;
            i += 1;
            i += strings::convert_utf8_to_utf16_in_buffer(&mut result[i..], &pair.value_ptr.value)
                .len();
            if i + 5 >= result.len() {
                return Err(bun_core::Error::from_name("TooManyEnvironmentVariables"));
            }
            result[i] = 0;
            i += 1;
        }
        result[i] = 0;
        i += 1;
        result[i] = 0;
        i += 1;
        result[i] = 0;
        i += 1;
        result[i] = 0;
        i += 1;

        Ok(result.as_ptr())
    }

    pub fn iterator(&mut self) -> <HashTable as ArrayHashMapExt>::Iterator<'_> {
        self.map.iterator()
    }

    /// Shared-borrow iteration over `(key, value)` pairs in insertion order.
    /// Zig: `pub fn iterator(this: *const Map) HashTable.Iterator` — Zig's
    /// iterator does not require exclusive access; this is the `&self`
    /// surface for callers (e.g. shell `EnvMapIter`) that only read entries.
    #[inline]
    pub fn iter(
        &self,
    ) -> core::iter::Zip<core::slice::Iter<'_, Box<[u8]>>, core::slice::Iter<'_, HashTableValue>>
    {
        self.map.iter()
    }

    /// Zig: `this.map.map.unmanaged.entries.len`.
    #[inline]
    pub fn count(&self) -> usize {
        self.map.count()
    }

    #[inline]
    pub fn init() -> Map {
        Map {
            map: HashTable::default(),
        }
    }

    #[inline]
    pub fn put(&mut self, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        #[cfg(all(windows, debug_assertions))]
        {
            debug_assert!(strings::index_of_char(key, b'\x00').is_none());
        }
        self.map.put(
            key,
            HashTableValue {
                value: Box::from(value),
                conditional: false,
            },
        )
    }

    pub fn ensure_unused_capacity(&mut self, additional_count: usize) -> Result<(), AllocError> {
        self.map.ensure_unused_capacity(additional_count)
    }

    pub fn put_assume_capacity(&mut self, key: &[u8], value: &[u8]) {
        #[cfg(all(windows, debug_assertions))]
        {
            debug_assert!(strings::index_of_char(key, b'\x00').is_none());
        }
        // PERF(port): was assume_capacity
        self.map.put_assume_capacity(
            key,
            HashTableValue {
                value: Box::from(value),
                conditional: false,
            },
        );
    }

    #[inline]
    pub fn put_alloc_key_and_value(&mut self, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        let gop = self.map.get_or_put(key)?;
        *gop.value_ptr = HashTableValue {
            value: Box::from(value),
            conditional: false,
        };
        if !gop.found_existing {
            *gop.key_ptr = Box::from(key);
        }
        Ok(())
    }

    #[inline]
    pub fn put_alloc_key(&mut self, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        // TODO(port): Zig stored borrowed `value` here without dupe; Box<[u8]> forces a copy.
        // If `HashTableValue.value` ever becomes `Cow`/borrowed storage, re-diverge from
        // `put_alloc_key_and_value` (which dupes both key and value).
        self.put_alloc_key_and_value(key, value)
    }

    #[inline]
    pub fn put_alloc_value(&mut self, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        // Zig diverged from `put` only by `allocator.dupe(value)` vs borrowed; the Rust
        // `HashTableValue { value: Box<[u8]> }` storage forces a copy either way, so this is
        // equivalent to `put`. Kept as a thin wrapper to preserve call-site alloc intent
        // should storage ever change to `Cow`/borrowed.
        self.put(key, value)
    }

    #[inline]
    pub fn get_or_put_without_value(
        &mut self,
        key: &[u8],
    ) -> Result<GetOrPutResult<'_, Box<[u8]>, HashTableValue>, AllocError> {
        self.map.get_or_put(key)
    }

    pub fn json_stringify(&self, writer: &mut impl core::fmt::Write) -> core::fmt::Result {
        // PORT NOTE: `iterator()` requires `&mut self`; iterate parallel slices instead.
        let count = self.map.count();
        writer.write_str("{")?;
        for (i, (k, v)) in self
            .map
            .keys()
            .iter()
            .zip(self.map.values().iter())
            .enumerate()
        {
            writer.write_str("\n    ")?;
            writer.write_str(&String::from_utf8_lossy(k))?;
            writer.write_str(": ")?;
            writer.write_str(&String::from_utf8_lossy(&v.value))?;
            if i + 1 <= count - 1 {
                writer.write_str(", ")?;
            }
        }
        writer.write_str("\n}")
    }

    #[inline]
    pub fn get(&self, key: &[u8]) -> Option<&[u8]> {
        self.map.get(key).map(|entry| entry.value.as_ref())
    }

    #[inline]
    pub fn put_default(&mut self, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        let _ = self.map.get_or_put_value(
            key,
            HashTableValue {
                value: Box::from(value),
                conditional: false,
            },
        )?;
        Ok(())
    }

    #[inline]
    pub fn get_or_put(&mut self, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        // Spec-level alias of `put_default` (env_loader.zig:1393/1400 both call `getOrPutValue`).
        self.put_default(key, value)
    }

    pub fn remove(&mut self, key: &[u8]) {
        let _ = self.map.swap_remove(key);
    }

    pub fn clone_with_allocator(&self) -> Result<Map, AllocError> {
        // allocator param dropped — global mimalloc
        Ok(Map {
            map: self.map.clone()?,
        })
    }
}

/// Owns the `K=V\0` strings backing a `[*:null]?[*:0]const u8` envp array.
/// Replaces the Zig arena passed to `createNullDelimitedEnvMap`; dropping this
/// frees every entry (PORTING.md §Forbidden: no Box::leak).
///
/// LAYOUT NOTE: `envp` stores raw `*const c_char` (with a trailing
/// `ptr::null()` sentinel), **not** `Option<*const c_char>`. Raw pointers are
/// already nullable, so `Option<*const T>` is *not* niche-optimized — it is a
/// 2-word `(tag, ptr)` pair. Casting `*const Option<*const c_char>` to
/// `*const *const c_char` for `execve()` interleaves `Some`-discriminant
/// `0x1` words between the real pointers and the kernel faults with `EFAULT`.
/// Zig's `?[*:0]const u8` *is* a single nullable thin pointer; the Rust
/// equivalent for FFI is `*const c_char`, not `Option<*const c_char>`.
pub struct NullDelimitedEnvMap {
    storage: Vec<Box<[u8]>>,
    envp: Box<[*const c_char]>,
}

impl NullDelimitedEnvMap {
    /// `[:null]?[*:0]const u8` — last element is `ptr::null()`.
    #[inline]
    pub fn as_slice(&self) -> &[*const c_char] {
        &self.envp
    }
    /// Raw `*const ?[*:0]const u8` for FFI (`envp`-style).
    #[inline]
    pub fn as_ptr(&self) -> *const *const c_char {
        self.envp.as_ptr()
    }
}

pub struct StdEnvMapWrapper {
    pub unsafe_map: bun_sys::EnvMap,
}

impl StdEnvMapWrapper {
    pub fn get(&self) -> &bun_sys::EnvMap {
        &self.unsafe_map
    }
}

// Drop replaces deinit (only frees hash_map storage; Rust does this automatically)

// Zig: `pub var instance: ?*Loader = null;` — global mutable raw pointer, freely re-assignable.
// PORT NOTE: Loader is !Sync (holds `&mut Map`); same single-thread invariant the Zig had.
// We store a raw `*mut` in an AtomicPtr (overwritable, matches `pub var` semantics) and hand
// the raw pointer back to callers so the no-alias `&mut` proof obligation lives at the *call
// site*, not here — manufacturing `&'static mut` inside an accessor is aliased-&mut UB the
// moment two callers hold results simultaneously (PORTING.md §Forbidden: lifetime-extension
// via `unsafe { &*(p as *const _) }`).
pub static INSTANCE: AtomicPtr<Loader<'static>> = AtomicPtr::new(core::ptr::null_mut());

/// Read the global singleton as a raw pointer — `Some(ptr)` once `set_instance` has been called.
/// Callers must `unsafe { &mut *ptr }` at point of use under the same single-thread CLI-init
/// invariant the Zig `var instance: ?*Loader` had (mirrors raw `*Loader` deref in Zig).
#[inline]
pub fn instance() -> Option<*mut Loader<'static>> {
    let ptr = INSTANCE.load(Ordering::Acquire);
    if ptr.is_null() { None } else { Some(ptr) }
}

/// Install the global singleton. Overwrites any previous value (matches Zig `pub var` re-assign
/// semantics — test harnesses / worker re-init may call this more than once).
#[inline]
pub fn set_instance(loader: *mut Loader<'static>) {
    INSTANCE.store(loader, Ordering::Release);
}

// ported from: src/dotenv/env_loader.zig
