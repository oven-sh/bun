use core::ffi::c_char;
use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::{self, Output};
use bun_logger as logger;
use bun_paths::{self, PathBuffer, MAX_PATH_BYTES};
// MOVE_DOWN(b0): bun_resolver::fs → bun_sys::fs (CYCLEBREAK dotenv)
use bun_sys::fs as Fs;
// TODO(b0-genuine): S3Credentials lives in bun_s3_signing (T5). Not in CYCLEBREAK's
// dotenv task list — needs TYPE_ONLY move-down to a ≤T2 crate (move-in pass).
use bun_s3 as s3;
use bun_schema::api;
use bun_str::{strings, ZStr};
use bun_sys;
use bun_url::URL;
use bun_which::which;
use bun_wyhash;

// MOVE_DOWN(b0): bun_analytics::features → bun_core (CYCLEBREAK). Re-import at lower tier.
use bun_core::analytics;

#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum DotEnvFileSuffix {
    Development,
    Production,
    Test,
}

pub struct Loader<'a> {
    pub map: &'a mut Map,
    // allocator dropped — global mimalloc (see PORTING.md §Allocators)

    pub env_local: Option<logger::Source>,
    pub env_development: Option<logger::Source>,
    pub env_production: Option<logger::Source>,
    pub env_test: Option<logger::Source>,
    pub env_development_local: Option<logger::Source>,
    pub env_production_local: Option<logger::Source>,
    pub env_test_local: Option<logger::Source>,
    pub env: Option<logger::Source>,

    /// only populated with files specified explicitly (e.g. --env-file arg)
    pub custom_files_loaded: StringArrayHashMap<logger::Source>,

    pub quiet: bool,

    pub did_load_process: bool,
    pub reject_unauthorized: Option<bool>,

    pub aws_credentials: Option<s3::S3Credentials>,
}

// Module-level mutable statics from the Zig (`var` decls inside `Loader`).
static DID_LOAD_CCACHE_PATH: AtomicBool = AtomicBool::new(false);
// TODO(port): global mutable byte-slice; Zig used `var node_path_to_use_set_once: []const u8 = ""`.
// Single-threaded in practice (CLI startup). Revisit with OnceLock<Box<[u8]>> in Phase B.
static mut NODE_PATH_TO_USE_SET_ONCE: &'static [u8] = b"";

// TODO(port): global mutable Option<bool>; Zig `pub var has_no_clear_screen_cli_flag: ?bool = null;`
// SAFETY: single-threaded CLI startup. Revisit with OnceLock<bool> in Phase B.
pub static mut HAS_NO_CLEAR_SCREEN_CLI_FLAG: Option<bool> = None;

impl<'a> Loader<'a> {
    pub fn iterator(&self) -> <Map as MapHashTable>::Iterator<'_> {
        // TODO(port): exact iterator type depends on bun_collections::ArrayHashMap API
        self.map.iterator()
    }

    pub fn has(&self, input: &[u8]) -> bool {
        let Some(value) = self.get(input) else { return false };
        if value.is_empty() {
            return false;
        }

        value != b"\"\"" && value != b"''" && value != b"0" && value != b"false"
    }

    pub fn is_production(&self) -> bool {
        let Some(env) = self.get(b"BUN_ENV").or_else(|| self.get(b"NODE_ENV")) else {
            return false;
        };
        env == b"production"
    }

    pub fn is_test(&self) -> bool {
        let Some(env) = self.get(b"BUN_ENV").or_else(|| self.get(b"NODE_ENV")) else {
            return false;
        };
        env == b"test"
    }

    pub fn get_node_path<'b>(
        &mut self,
        fs: &Fs::FileSystem,
        buf: &'b mut PathBuffer,
    ) -> Option<&'b ZStr> {
        // Check NODE or npm_node_execpath env var, but only use it if the file actually exists
        if let Some(node) = self.get(b"NODE").or_else(|| self.get(b"npm_node_execpath")) {
            if !node.is_empty() && node.len() < MAX_PATH_BYTES {
                buf[..node.len()].copy_from_slice(node);
                buf[node.len()] = 0;
                // SAFETY: buf[node.len()] == 0 written above
                let z = unsafe { ZStr::from_raw(buf.as_ptr(), node.len()) };
                if bun_sys::is_executable_file_path(z) {
                    return Some(z);
                }
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

    pub fn get_s3_credentials(&mut self) -> s3::S3Credentials {
        if let Some(credentials) = &self.aws_credentials {
            return credentials.clone();
        }

        let mut access_key_id: &[u8] = b"";
        let mut secret_access_key: &[u8] = b"";
        let mut region: &[u8] = b"";
        let mut endpoint: &[u8] = b"";
        let mut bucket: &[u8] = b"";
        let mut session_token: &[u8] = b"";
        let mut insecure_http: bool = false;

        if let Some(access_key) = self.get(b"S3_ACCESS_KEY_ID") {
            access_key_id = access_key;
        } else if let Some(access_key) = self.get(b"AWS_ACCESS_KEY_ID") {
            access_key_id = access_key;
        }
        if let Some(access_key) = self.get(b"S3_SECRET_ACCESS_KEY") {
            secret_access_key = access_key;
        } else if let Some(access_key) = self.get(b"AWS_SECRET_ACCESS_KEY") {
            secret_access_key = access_key;
        }

        if let Some(region_) = self.get(b"S3_REGION") {
            region = region_;
        } else if let Some(region_) = self.get(b"AWS_REGION") {
            region = region_;
        }
        if let Some(endpoint_) = self.get(b"S3_ENDPOINT") {
            let url = URL::parse(endpoint_);
            endpoint = url.host_with_path();
            insecure_http = url.is_http();
        } else if let Some(endpoint_) = self.get(b"AWS_ENDPOINT") {
            let url = URL::parse(endpoint_);
            endpoint = url.host_with_path();
            insecure_http = url.is_http();
        }
        if let Some(bucket_) = self.get(b"S3_BUCKET") {
            bucket = bucket_;
        } else if let Some(bucket_) = self.get(b"AWS_BUCKET") {
            bucket = bucket_;
        }
        if let Some(token) = self.get(b"S3_SESSION_TOKEN") {
            session_token = token;
        } else if let Some(token) = self.get(b"AWS_SESSION_TOKEN") {
            session_token = token;
        }
        // TODO(port): S3Credentials field types/ownership (Zig stored borrowed slices)
        self.aws_credentials = Some(s3::S3Credentials {
            ref_count: Default::default(),
            access_key_id,
            secret_access_key,
            region,
            endpoint,
            bucket,
            session_token,
            insecure_http,
        });

        self.aws_credentials.as_ref().unwrap().clone()
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

    pub fn get_http_proxy_for(&mut self, url: &URL) -> Option<URL> {
        self.get_http_proxy(url.is_http(), Some(url.hostname()), Some(url.host()))
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
    ) -> Option<URL> {
        // TODO: When Web Worker support is added, make sure to intern these strings
        let mut http_proxy: Option<URL> = None;

        // Treat empty-string lowercase as "absent" so it falls through to uppercase.
        // CI environments often set `http_proxy=""` as a default; a runtime
        // `process.env.HTTP_PROXY = "..."` must still be observed.
        if is_http {
            let proxy: Option<&[u8]> = 'blk: {
                if let Some(p) = self.get(b"http_proxy") {
                    if !p.is_empty() {
                        break 'blk Some(p);
                    }
                }
                break 'blk self.get(b"HTTP_PROXY");
            };
            if let Some(p) = proxy {
                if !p.is_empty() && p != b"\"\"" && p != b"''" {
                    http_proxy = Some(URL::parse(p));
                }
            }
        } else {
            let proxy: Option<&[u8]> = 'blk: {
                if let Some(p) = self.get(b"https_proxy") {
                    if !p.is_empty() {
                        break 'blk Some(p);
                    }
                }
                break 'blk self.get(b"HTTPS_PROXY");
            };
            if let Some(p) = proxy {
                if !p.is_empty() && p != b"\"\"" && p != b"''" {
                    http_proxy = Some(URL::parse(p));
                }
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

        // Treat empty-string lowercase as "absent" so it falls through to uppercase.
        let no_proxy_text: &[u8] = 'blk: {
            if let Some(p) = self.get(b"no_proxy") {
                if !p.is_empty() {
                    break 'blk p;
                }
            }
            match self.get(b"NO_PROXY") {
                Some(p) => break 'blk p,
                None => return false,
            }
        };
        if no_proxy_text.is_empty() || no_proxy_text == b"\"\"" || no_proxy_text == b"''" {
            return false;
        }

        for no_proxy_item in no_proxy_text.split(|&b| b == b',') {
            let mut no_proxy_entry = strings::trim(no_proxy_item, strings::WHITESPACE_CHARS);
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

    pub fn load_ccache_path(&mut self, fs: &Fs::FileSystem) {
        if DID_LOAD_CCACHE_PATH.load(Ordering::Relaxed) {
            return;
        }
        DID_LOAD_CCACHE_PATH.store(true, Ordering::Relaxed);
        let _ = self.load_ccache_path_impl(fs);
    }

    fn load_ccache_path_impl(&mut self, fs: &Fs::FileSystem) -> Result<(), AllocError> {
        // if they have ccache installed, put it in env variable `CMAKE_CXX_COMPILER_LAUNCHER` so
        // cmake can use it to hopefully speed things up
        let mut buf = PathBuffer::uninit();
        let path = match self.get(b"PATH") {
            Some(p) => p,
            None => return Ok(()),
        };
        let ccache_path: &[u8] = which(&mut buf, path, fs.top_level_dir(), b"ccache")
            .map(|z| z.as_bytes())
            .unwrap_or(b"");

        if !ccache_path.is_empty() {
            let cxx_gop = self.map.get_or_put_without_value(b"CMAKE_CXX_COMPILER_LAUNCHER")?;
            if !cxx_gop.found_existing {
                *cxx_gop.key_ptr = Box::<[u8]>::from(&**cxx_gop.key_ptr);
                *cxx_gop.value_ptr = HashTableValue {
                    value: Box::<[u8]>::from(ccache_path),
                    conditional: false,
                };
            }
            let c_gop = self.map.get_or_put_without_value(b"CMAKE_C_COMPILER_LAUNCHER")?;
            if !c_gop.found_existing {
                *c_gop.key_ptr = Box::<[u8]>::from(&**c_gop.key_ptr);
                *c_gop.value_ptr = HashTableValue {
                    value: Box::<[u8]>::from(ccache_path),
                    conditional: false,
                };
            }
        }
        Ok(())
    }

    pub fn load_node_js_config(
        &mut self,
        fs: &Fs::FileSystem,
        override_node: &[u8],
    ) -> Result<bool, bun_core::Error> {
        let mut buf = PathBuffer::uninit();

        let mut node_path_to_use: &[u8] = override_node;
        if node_path_to_use.is_empty() {
            // SAFETY: single-threaded CLI startup; see TODO(port) on the static.
            let cached = unsafe { NODE_PATH_TO_USE_SET_ONCE };
            if !cached.is_empty() {
                node_path_to_use = cached;
            } else {
                let Some(node) = self.get_node_path(fs, &mut buf) else {
                    return Ok(false);
                };
                // TODO(port): fs.dirname_store.append returns a 'static-lifetime slice owned by FileSystem
                node_path_to_use = fs.dirname_store().append(node.as_bytes())?;
            }
        }
        // SAFETY: single-threaded CLI startup; see TODO(port) on the static.
        unsafe {
            NODE_PATH_TO_USE_SET_ONCE = core::mem::transmute::<&[u8], &'static [u8]>(node_path_to_use);
        }
        self.map.put(b"NODE", node_path_to_use)?;
        self.map.put(b"npm_node_execpath", node_path_to_use)?;
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
            .with(|c| c.get())
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

    /// Load values from the environment into Define.
    ///
    /// If there is a framework, values from the framework are inserted with a
    /// **lower priority** so that users may override defaults. Unlike regular
    /// defines, environment variables are loaded as JavaScript string literals.
    ///
    /// Empty environment variables become empty strings.
    // CYCLEBREAK(b0): GENUINE upward dep on bun_bundler::defines::{DefineData, DefineDataInit}
    // and bun_js_parser::{E::String, Expr::Data}. Converted to manual vtable (cold-path
    // §Dispatch, PORTING.md): dotenv passes (key, raw_value) bytes; the high-tier vtable
    // impl (bun_bundler / bun_runtime) constructs E::String + DefineData and inserts.
    // PERF(port): was inline switch — Zig built E.String slab + DefineData inline here.
    pub fn copy_for_define(
        &mut self,
        to_json: DefineStoreRef<'_>,
        to_string: DefineStoreRef<'_>,
        framework_defaults: &api::StringMap,
        behavior: api::DotEnvBehavior,
        prefix: &[u8],
    ) -> Result<(), bun_core::Error> {
        let mut iter = self.map.iterator();
        let mut key_count: usize = 0;
        let mut string_map_hashes: Vec<u64> = vec![0u64; framework_defaults.keys.len()];
        let invalid_hash = u64::MAX - 1;
        string_map_hashes.fill(invalid_hash);

        let mut key_buf: Vec<u8> = Vec::new();
        // Frameworks determine an allowlist of values

        for (i, key) in framework_defaults.keys.iter().enumerate() {
            if key.len() > b"process.env.".len() && &key[..b"process.env.".len()] == b"process.env." {
                let hashable_segment = &key[b"process.env.".len()..];
                string_map_hashes[i] = bun_wyhash::hash(hashable_segment);
            }
        }

        // We have to copy all the keys to prepend "process.env" :/
        let mut key_buf_len: usize = 0;
        let mut e_strings_to_allocate: usize = 0;

        if behavior != api::DotEnvBehavior::Disable
            && behavior != api::DotEnvBehavior::LoadAllWithoutInlining
        {
            if behavior == api::DotEnvBehavior::Prefix {
                debug_assert!(!prefix.is_empty());

                while let Some(entry) = iter.next() {
                    if strings::starts_with(entry.key_ptr, prefix) {
                        key_buf_len += entry.key_ptr.len();
                        key_count += 1;
                        e_strings_to_allocate += 1;
                        debug_assert!(!entry.key_ptr.is_empty());
                    }
                }
            } else {
                while let Some(entry) = iter.next() {
                    if !entry.key_ptr.is_empty() {
                        key_buf_len += entry.key_ptr.len();
                        key_count += 1;
                        e_strings_to_allocate += 1;

                        debug_assert!(!entry.key_ptr.is_empty());
                    }
                }
            }

            if key_buf_len > 0 {
                iter.reset();
                key_buf = vec![0u8; key_buf_len + key_count * b"process.env.".len()];
                // TODO(port): std.Io.Writer.fixed equivalent — write into key_buf via cursor
                let mut key_cursor: usize = 0;
                let _ = e_strings_to_allocate; // PERF(port): slab sizing hint now unused; vtable impl owns alloc

                if behavior == api::DotEnvBehavior::Prefix {
                    while let Some(entry) = iter.next() {
                        let value: &[u8] = &entry.value_ptr.value;

                        if strings::starts_with(entry.key_ptr, prefix) {
                            let key_start = key_cursor;
                            // miscalculated length above would be a bug — match Zig unreachable
                            write!(
                                &mut &mut key_buf[key_cursor..],
                                "process.env.{}",
                                bstr::BStr::new(entry.key_ptr)
                            )
                            .expect("unreachable");
                            key_cursor = key_start + b"process.env.".len() + entry.key_ptr.len();
                            let key_str = &key_buf[key_start..key_cursor];

                            // CYCLEBREAK(b0): vtable builds E::String + DefineData{can_be_removed_if_unused, IfUnused}
                            to_string.put_string_define(key_str, value)?;
                        } else {
                            let hash = bun_wyhash::hash(entry.key_ptr);

                            debug_assert!(hash != invalid_hash);

                            if let Some(key_i) =
                                string_map_hashes.iter().position(|&h| h == hash)
                            {
                                // CYCLEBREAK(b0): vtable builds E::String + DefineData{can_be_removed_if_unused, IfUnused}
                                to_string.put_string_define(&framework_defaults.keys[key_i], value)?;
                            }
                        }
                    }
                } else {
                    while let Some(entry) = iter.next() {
                        let value: &[u8] = &entry.value_ptr.value;

                        let key_start = key_cursor;
                        write!(
                            &mut &mut key_buf[key_cursor..],
                            "process.env.{}",
                            bstr::BStr::new(entry.key_ptr)
                        )
                        .expect("unreachable");
                        key_cursor = key_start + b"process.env.".len() + entry.key_ptr.len();
                        let key_str = &key_buf[key_start..key_cursor];

                        // CYCLEBREAK(b0): vtable builds E::String + DefineData{can_be_removed_if_unused, IfUnused}
                        to_string.put_string_define(key_str, value)?;
                    }
                }
                // PERF(port): key_buf was allocator-owned in Zig and intentionally leaked into the
                // define store. Phase B must ensure this outlives `to_string`.
                core::mem::forget(key_buf);
            }
        }

        for (i, key) in framework_defaults.keys.iter().enumerate() {
            let value = &framework_defaults.values[i];

            if !to_string.contains(key) && !to_json.contains(key) {
                to_json.put_raw(key, value)?;
            }
        }
        Ok(())
    }

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
            custom_files_loaded: StringArrayHashMap::new(),
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

        // TODO(port): std.os.environ equivalent. Use bun_sys::environ() returning &[*const c_char].
        let environ: &[*const c_char] = bun_sys::environ();
        self.map.map.ensure_total_capacity(environ.len())?;
        for &_env in environ {
            // SAFETY: environ entries are NUL-terminated C strings from the OS
            let env = unsafe { core::ffi::CStr::from_ptr(_env) }.to_bytes();
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
        let source = logger::Source::init_path_string(b"test", str);
        let mut value_buffer: Vec<u8> = Vec::new();
        Parser::parse::<OVERWRITE, false, EXPAND>(&source, self.map, &mut value_buffer)?;
        core::hint::black_box(&source);
        Ok(())
    }

    pub fn load<const SUFFIX: DotEnvFileSuffix>(
        &mut self,
        dir: &mut Fs::FileSystem::DirEntry,
        env_files: &[&[u8]],
        skip_default_env: bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): std.time.nanoTimestamp() — use bun_core::time or platform clock
        let start: i128 = bun_core::time::nano_timestamp();

        // PERF(port): was stack-fallback (4096) — using heap Vec; profile in Phase B
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
                self.load_default_files::<SUFFIX>(dir, &mut value_buffer)?;
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
    fn load_default_files<const SUFFIX: DotEnvFileSuffix>(
        &mut self,
        dir: &mut Fs::FileSystem::DirEntry,
        value_buffer: &mut Vec<u8>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): std.fs.cwd() — use bun_sys::Fd::cwd() as the dir handle type
        let dir_handle = bun_sys::Fd::cwd();

        match SUFFIX {
            DotEnvFileSuffix::Development => {
                if dir.has_comptime_query(b".env.development.local") {
                    self.load_env_file::<false>(dir_handle, b".env.development.local", value_buffer)?;
                    analytics::Features::dotenv_inc();
                }
            }
            DotEnvFileSuffix::Production => {
                if dir.has_comptime_query(b".env.production.local") {
                    self.load_env_file::<false>(dir_handle, b".env.production.local", value_buffer)?;
                    analytics::Features::dotenv_inc();
                }
            }
            DotEnvFileSuffix::Test => {
                if dir.has_comptime_query(b".env.test.local") {
                    self.load_env_file::<false>(dir_handle, b".env.test.local", value_buffer)?;
                    analytics::Features::dotenv_inc();
                }
            }
        }

        if SUFFIX != DotEnvFileSuffix::Test {
            if dir.has_comptime_query(b".env.local") {
                self.load_env_file::<false>(dir_handle, b".env.local", value_buffer)?;
                analytics::Features::dotenv_inc();
            }
        }

        match SUFFIX {
            DotEnvFileSuffix::Development => {
                if dir.has_comptime_query(b".env.development") {
                    self.load_env_file::<false>(dir_handle, b".env.development", value_buffer)?;
                    analytics::Features::dotenv_inc();
                }
            }
            DotEnvFileSuffix::Production => {
                if dir.has_comptime_query(b".env.production") {
                    self.load_env_file::<false>(dir_handle, b".env.production", value_buffer)?;
                    analytics::Features::dotenv_inc();
                }
            }
            DotEnvFileSuffix::Test => {
                if dir.has_comptime_query(b".env.test") {
                    self.load_env_file::<false>(dir_handle, b".env.test", value_buffer)?;
                    analytics::Features::dotenv_inc();
                }
            }
        }

        if dir.has_comptime_query(b".env") {
            self.load_env_file::<false>(dir_handle, b".env", value_buffer)?;
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
        // TODO(port): std.time.nanoTimestamp() / ns_per_ms
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
        Output::pretty_error(" <d>");

        for (i, &yes) in loaded.iter().enumerate() {
            if yes {
                loaded_i += 1;
                if count == 1 || (loaded_i >= count && count > 1) {
                    Output::pretty_error_fmt(format_args!("\"{}\"", bstr::BStr::new(ALL[i])));
                } else {
                    Output::pretty_error_fmt(format_args!("\"{}\", ", bstr::BStr::new(ALL[i])));
                }
            }
        }

        for e in self.custom_files_loaded.iterator() {
            loaded_i += 1;
            if count == 1 || (loaded_i >= count && count > 1) {
                Output::pretty_error_fmt(format_args!("\"{}\"", bstr::BStr::new(e.key_ptr)));
            } else {
                Output::pretty_error_fmt(format_args!("\"{}\", ", bstr::BStr::new(e.key_ptr)));
            }
        }

        Output::pretty_errorln("<r>\n");
        Output::flush();
    }

    /// Helper: maps a comptime `.env*` filename to its `Option<Source>` field.
    /// Replaces Zig `@field(this, base)`.
    fn default_file_slot(&mut self, base: &'static [u8]) -> &mut Option<logger::Source> {
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

        // TODO(port): dir.openFile via bun_sys; Zig used std.fs.Dir.openFile
        let file = match bun_sys::openat_read_only(dir, base) {
            Ok(f) => f,
            Err(err) => {
                if err == bun_core::err!("IsDir") || err == bun_core::err!("FileNotFound") {
                    // prevent retrying
                    *self.default_file_slot(base) = Some(logger::Source::init_path_string(base, b""));
                    return Ok(());
                }
                if err == bun_core::err!("Unexpected")
                    || err == bun_core::err!("FileBusy")
                    || err == bun_core::err!("DeviceBusy")
                    || err == bun_core::err!("AccessDenied")
                {
                    if !self.quiet {
                        Output::pretty_errorln_fmt(format_args!(
                            "<r><red>{}<r> error loading {} file",
                            err.name(),
                            bstr::BStr::new(base)
                        ));
                    }
                    // prevent retrying
                    *self.default_file_slot(base) = Some(logger::Source::init_path_string(base, b""));
                    return Ok(());
                }
                return Err(err);
            }
        };
        // file closed on Drop

        let end: u64 = 'brk: {
            #[cfg(windows)]
            {
                let pos = file.get_end_pos()?;
                if pos == 0 {
                    *self.default_file_slot(base) = Some(logger::Source::init_path_string(base, b""));
                    return Ok(());
                }
                break 'brk pos;
            }

            #[cfg(not(windows))]
            {
                let stat = file.stat()?;
                if stat.size == 0 || !stat.is_file() {
                    *self.default_file_slot(base) = Some(logger::Source::init_path_string(base, b""));
                    return Ok(());
                }
                break 'brk stat.size as u64;
            }
        };

        let mut buf: Vec<u8> = vec![0u8; end as usize + 1];
        let amount_read = match file.read_all(&mut buf[..end as usize]) {
            Ok(n) => n,
            Err(err) => {
                if err == bun_core::err!("Unexpected")
                    || err == bun_core::err!("SystemResources")
                    || err == bun_core::err!("OperationAborted")
                    || err == bun_core::err!("BrokenPipe")
                    || err == bun_core::err!("AccessDenied")
                    || err == bun_core::err!("IsDir")
                {
                    if !self.quiet {
                        Output::pretty_errorln_fmt(format_args!(
                            "<r><red>{}<r> error loading {} file",
                            err.name(),
                            bstr::BStr::new(base)
                        ));
                    }
                    // prevent retrying
                    *self.default_file_slot(base) = Some(logger::Source::init_path_string(base, b""));
                    return Ok(());
                }
                return Err(err);
            }
        };

        // The null byte here is mostly for debugging purposes.
        buf[end as usize] = 0;

        // PERF(port): Zig leaked `buf` into the Source (allocator-owned, never freed). Phase B:
        // ensure logger::Source takes ownership of buf so contents stay alive for the program.
        let buf = buf.into_boxed_slice();
        let contents: &'static [u8] = unsafe {
            // SAFETY: Zig intentionally leaks this buffer for program lifetime
            core::mem::transmute::<&[u8], &'static [u8]>(&buf[..amount_read])
        };
        core::mem::forget(buf);

        let source = logger::Source::init_path_string(base, contents);

        Parser::parse::<OVERRIDE, false, true>(&source, self.map, value_buffer)?;

        *self.default_file_slot(base) = Some(source);
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

        // TODO(port): bun.openFile via bun_sys
        let file = match bun_sys::open_file_read_only(file_path) {
            Ok(f) => f,
            Err(_) => {
                // prevent retrying
                self.custom_files_loaded
                    .put(file_path, logger::Source::init_path_string(file_path, b""))?;
                return Ok(());
            }
        };
        // file closed on Drop

        let end: u64 = 'brk: {
            #[cfg(windows)]
            {
                let pos = file.get_end_pos()?;
                if pos == 0 {
                    self.custom_files_loaded
                        .put(file_path, logger::Source::init_path_string(file_path, b""))?;
                    return Ok(());
                }
                break 'brk pos;
            }

            #[cfg(not(windows))]
            {
                let stat = file.stat()?;
                if stat.size == 0 || !stat.is_file() {
                    self.custom_files_loaded
                        .put(file_path, logger::Source::init_path_string(file_path, b""))?;
                    return Ok(());
                }
                break 'brk stat.size as u64;
            }
        };

        let mut buf: Vec<u8> = vec![0u8; end as usize + 1];
        let amount_read = match file.read_all(&mut buf[..end as usize]) {
            Ok(n) => n,
            Err(err) => {
                if err == bun_core::err!("Unexpected")
                    || err == bun_core::err!("SystemResources")
                    || err == bun_core::err!("OperationAborted")
                    || err == bun_core::err!("BrokenPipe")
                    || err == bun_core::err!("AccessDenied")
                    || err == bun_core::err!("IsDir")
                {
                    if !self.quiet {
                        Output::pretty_errorln_fmt(format_args!(
                            "<r><red>{}<r> error loading {} file",
                            err.name(),
                            bstr::BStr::new(file_path)
                        ));
                    }
                    // prevent retrying
                    self.custom_files_loaded
                        .put(file_path, logger::Source::init_path_string(file_path, b""))?;
                    return Ok(());
                }
                return Err(err);
            }
        };

        // The null byte here is mostly for debugging purposes.
        buf[end as usize] = 0;

        // PERF(port): see load_env_file — Zig leaks buf for program lifetime
        let buf = buf.into_boxed_slice();
        let contents: &'static [u8] = unsafe {
            // SAFETY: intentionally leaked, lives for program lifetime
            core::mem::transmute::<&[u8], &'static [u8]>(&buf[..amount_read])
        };
        core::mem::forget(buf);

        let source = logger::Source::init_path_string(file_path, contents);

        Parser::parse::<OVERRIDE, false, true>(&source, self.map, value_buffer)?;

        self.custom_files_loaded.put(file_path, source)?;
        Ok(())
    }
}

// CYCLEBREAK(b0): manual vtable (cold-path §Dispatch, PORTING.md) for the
// GENUINE upward dep on bun_bundler::defines::{DefineData, DefineDataInit, CallUnwrap}
// + bun_js_parser::{E::String, Expr::Data}. dotenv (T2) names no high-tier types;
// the bundler/runtime move-in pass provides `pub static ENV_DEFINE_STORE_VTABLE`
// instances that construct `E::String` + `DefineData::init(DefineDataInit {
// can_be_removed_if_unused: true, call_can_be_unwrapped_if_unused: CallUnwrap::IfUnused, .. })`
// and insert into the concrete StringStore / JSONStore maps.
// PERF(port): was inline switch.
pub struct DefineStoreVTable {
    pub contains: unsafe fn(owner: *mut (), key: &[u8]) -> bool,
    /// Insert `key` → JS string-literal define wrapping `value` (E::String + DefineData).
    /// Implementor copies/owns `value` bytes as needed.
    pub put_string_define:
        unsafe fn(owner: *mut (), key: &[u8], value: &[u8]) -> Result<(), bun_core::Error>,
    /// Insert `key` → raw `value` (JSON-store fallback for framework defaults).
    pub put_raw: unsafe fn(owner: *mut (), key: &[u8], value: &[u8]) -> Result<(), bun_core::Error>,
}

pub struct DefineStoreRef<'a> {
    pub owner: *mut (),
    pub vtable: &'static DefineStoreVTable,
    _marker: core::marker::PhantomData<&'a mut ()>,
}

impl<'a> DefineStoreRef<'a> {
    #[inline]
    pub fn new(owner: *mut (), vtable: &'static DefineStoreVTable) -> Self {
        Self { owner, vtable, _marker: core::marker::PhantomData }
    }
    #[inline]
    pub fn contains(&self, key: &[u8]) -> bool {
        // SAFETY: vtable contract — owner is the erased store the vtable was built for.
        unsafe { (self.vtable.contains)(self.owner, key) }
    }
    #[inline]
    pub fn put_string_define(&self, key: &[u8], value: &[u8]) -> Result<(), bun_core::Error> {
        // SAFETY: vtable contract.
        unsafe { (self.vtable.put_string_define)(self.owner, key, value) }
    }
    #[inline]
    pub fn put_raw(&self, key: &[u8], value: &[u8]) -> Result<(), bun_core::Error> {
        // SAFETY: vtable contract.
        unsafe { (self.vtable.put_raw)(self.owner, key, value) }
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
        match self.src[end] {
            b'`' => {
                if let Some(value) = self.parse_quoted::<{ b'`' }>()? {
                    return Ok(if IS_PROCESS { value } else { &value[1..value.len() - 1] });
                }
            }
            b'"' => {
                if let Some(value) = self.parse_quoted::<{ b'"' }>()? {
                    return Ok(if IS_PROCESS { value } else { &value[1..value.len() - 1] });
                }
            }
            b'\'' => {
                if let Some(value) = self.parse_quoted::<{ b'\'' }>()? {
                    return Ok(if IS_PROCESS { value } else { &value[1..value.len() - 1] });
                }
            }
            _ => {}
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
                    self.value_buffer.splice(0..0, value[pos..last].iter().copied());
                    pos -= 1;
                } else {
                    let mut end = if value[pos + 1] == b'{' { pos + 2 } else { pos + 1 };
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
                    self.value_buffer.splice(0..0, value[end..last].iter().copied());
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
            self.value_buffer.splice(0..0, value[..last].iter().copied());
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
            // TODO(port): borrowck — Zig iterates `map` while calling `map.get` inside expandValue.
            // Phase B: use index-based iteration over map.map.values_mut() with raw key access.
            let mut it = map.iterator();
            while let Some(entry) = it.next() {
                if count > 0 {
                    count -= 1;
                } else if let Some(value) = self.expand_value(map, &entry.value_ptr.value)? {
                    *entry.value_ptr = HashTableValue {
                        value: Box::from(value),
                        conditional: false,
                    };
                }
            }
        }
        Ok(())
    }

    pub fn parse<const OVERRIDE: bool, const IS_PROCESS: bool, const EXPAND: bool>(
        source: &logger::Source,
        map: &mut Map,
        value_buffer: &mut Vec<u8>,
    ) -> Result<(), AllocError> {
        // Clear the buffer before each parse to ensure no leftover data
        value_buffer.clear();
        let mut parser = Parser {
            pos: 0,
            src: source.contents(),
            value_buffer,
        };
        parser._parse::<OVERRIDE, IS_PROCESS, EXPAND>(map)
    }
}

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
#[cfg(windows)]
pub type HashTable = bun_collections::CaseInsensitiveAsciiStringArrayHashMap<HashTableValue>;
#[cfg(not(windows))]
pub type HashTable = bun_collections::StringArrayHashMap<HashTableValue>;

// TODO(port): GetOrPutResult type from bun_collections
type GetOrPutResult<'a> = bun_collections::GetOrPutResult<'a, Box<[u8]>, HashTableValue>;

pub struct Map {
    pub map: HashTable,
}

// TODO(port): helper trait alias for Map.HashTable.Iterator return type used in Loader::iterator
pub trait MapHashTable {
    type Iterator<'a>
    where
        Self: 'a;
}
impl MapHashTable for Map {
    type Iterator<'a> = <HashTable as bun_collections::ArrayHashMapExt>::Iterator<'a>;
}

impl Map {
    pub fn create_null_delimited_env_map(
        &mut self,
    ) -> Result<Box<[Option<*const c_char>]>, AllocError> {
        // PERF(port): was arena bulk-free (envp lifetime tied to spawn) — profile in Phase B
        let env_map = &mut self.map;

        let envp_count = env_map.count();
        let mut envp_buf: Vec<Option<*const c_char>> = vec![None; envp_count + 1];
        {
            let mut i: usize = 0;
            for pair in env_map.iterator() {
                let mut env_buf =
                    vec![0u8; pair.key_ptr.len() + pair.value_ptr.value.len() + 2].into_boxed_slice();
                env_buf[..pair.key_ptr.len()].copy_from_slice(pair.key_ptr);
                env_buf[pair.key_ptr.len()] = b'=';
                env_buf[pair.key_ptr.len() + 1..pair.key_ptr.len() + 1 + pair.value_ptr.value.len()]
                    .copy_from_slice(&pair.value_ptr.value);
                // NUL terminator at end (allocSentinel in Zig) — last byte already 0
                envp_buf[i] = Some(Box::leak(env_buf).as_ptr() as *const c_char);
                i += 1;
            }
            if cfg!(debug_assertions) {
                debug_assert!(i == envp_count);
            }
        }
        // last element is the null sentinel (already None)
        Ok(envp_buf.into_boxed_slice())
    }

    /// Returns a wrapper around the std.process.EnvMap that does not duplicate the memory of
    /// the keys and values, but instead points into the memory of the bun env map.
    ///
    /// To prevent
    pub fn std_env_map(&mut self) -> Result<StdEnvMapWrapper, AllocError> {
        // TODO(port): std.process.EnvMap has no Rust std equivalent we're allowed to use.
        // Phase B: define bun_sys::EnvMap or pass envp directly.
        let mut env_map = StdEnvMapInner::new();

        for entry in self.map.iterator() {
            env_map.put(entry.key_ptr, &entry.value_ptr.value)?;
        }

        Ok(StdEnvMapWrapper { unsafe_map: env_map })
    }

    /// Write the Windows environment block into a buffer
    /// This can be passed to CreateProcessW's lpEnvironment parameter
    pub fn write_windows_env_block(
        &mut self,
        result: &mut [u16; 32767],
    ) -> Result<*const u16, bun_core::Error> {
        let mut i: usize = 0;
        for pair in self.map.iterator() {
            i += strings::convert_utf8_to_utf16_in_buffer(&mut result[i..], pair.key_ptr).len();
            if i + 7 >= result.len() {
                return Err(bun_core::err!("TooManyEnvironmentVariables"));
            }
            result[i] = b'=' as u16;
            i += 1;
            i += strings::convert_utf8_to_utf16_in_buffer(&mut result[i..], &pair.value_ptr.value)
                .len();
            if i + 5 >= result.len() {
                return Err(bun_core::err!("TooManyEnvironmentVariables"));
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
        let _ = i;

        Ok(result.as_ptr())
    }

    pub fn iterator(&self) -> impl Iterator<Item = bun_collections::Entry<'_, Box<[u8]>, HashTableValue>> {
        // TODO(port): exact iterator type from bun_collections
        self.map.iterator()
    }

    #[inline]
    pub fn init() -> Map {
        Map { map: HashTable::new() }
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
        let gop = self.map.get_or_put(key)?;
        *gop.value_ptr = HashTableValue {
            // TODO(port): Zig stored borrowed `value` here without dupe; Box<[u8]> forces a copy
            value: Box::from(value),
            conditional: false,
        };
        if !gop.found_existing {
            *gop.key_ptr = Box::from(key);
        }
        Ok(())
    }

    #[inline]
    pub fn put_alloc_value(&mut self, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        self.map.put(
            key,
            HashTableValue {
                value: Box::from(value),
                conditional: false,
            },
        )
    }

    #[inline]
    pub fn get_or_put_without_value(&mut self, key: &[u8]) -> Result<GetOrPutResult<'_>, AllocError> {
        self.map.get_or_put(key)
    }

    pub fn json_stringify(&self, writer: &mut impl core::fmt::Write) -> core::fmt::Result {
        // TODO(port): Zig writer used `.write` returning the byte count; using fmt::Write here
        writer.write_str("{")?;
        let count = self.map.count();
        let mut index = 0usize;
        for entry in self.map.iterator() {
            writer.write_str("\n    ")?;

            // TODO(port): Zig wrote key/value via writer.write (JSON-string-ish); preserve bytes
            write!(writer, "{}", bstr::BStr::new(entry.key_ptr))?;

            writer.write_str(": ")?;

            write!(writer, "{}", bstr::BStr::new(&entry.value_ptr.value))?;

            index += 1;
            if index <= count - 1 {
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
        let _ = self.map.get_or_put_value(
            key,
            HashTableValue {
                value: Box::from(value),
                conditional: false,
            },
        )?;
        Ok(())
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

pub struct StdEnvMapWrapper {
    // TODO(port): std.process.EnvMap replacement
    pub unsafe_map: StdEnvMapInner,
}

impl StdEnvMapWrapper {
    pub fn get(&self) -> &StdEnvMapInner {
        &self.unsafe_map
    }
}

// Drop replaces deinit (only frees hash_map storage; Rust does this automatically)

// TODO(port): placeholder for std.process.EnvMap — Phase B replaces with bun_sys equivalent
pub struct StdEnvMapInner {
    // intentionally opaque in Phase A
}
impl StdEnvMapInner {
    fn new() -> Self {
        StdEnvMapInner {}
    }
    fn put(&mut self, _key: &[u8], _value: &[u8]) -> Result<(), AllocError> {
        // TODO(port)
        Ok(())
    }
}

// TODO(port): global mutable singleton; Zig `pub var instance: ?*Loader = null;`
pub static mut INSTANCE: Option<*mut Loader<'static>> = None;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/dotenv/env_loader.zig (1433 lines)
//   confidence: medium
//   todos:      33
//   notes:      @field(this, base) → match helper; HashTableValue.value owned vs borrowed needs Cow; copy_for_define store types/E.String slab need bun_bundler concrete types; std.os.environ/std.process.EnvMap/file I/O mapped to bun_sys placeholders; global mutable statics need OnceLock review.
// ──────────────────────────────────────────────────────────────────────────
