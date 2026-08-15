//! Everything the credential chain reads from the environment, captured on
//! the JS thread (where `process.env` / `.env` files live) so resolution can
//! run on any thread.

use bun_core::strings;
use bun_jsc::{JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, StringJsc as _};

fn owned(v: Option<Vec<u8>>) -> Option<Box<[u8]>> {
    v.filter(|s| !s.is_empty()).map(Vec::into_boxed_slice)
}

fn truthy(v: Option<&[u8]>) -> bool {
    matches!(v, Some(s) if s.eq_ignore_ascii_case(b"true") || s == b"1")
}

/// Reads the live `process.env` object (so `process.env.AWS_PROFILE = "x"`
/// at runtime is honoured), falling back to the VM's dotenv loader if the
/// object is unavailable. Getter exceptions are swallowed as "unset".
pub struct Env<'a> {
    global: &'a JSGlobalObject,
    object: Option<JSValue>,
}

impl<'a> Env<'a> {
    pub fn new(global: &'a JSGlobalObject) -> Self {
        let object = global
            .to_js_value()
            .get(global, "process")
            .ok()
            .flatten()
            .filter(|p| p.is_object())
            .and_then(|p| p.get(global, "env").ok().flatten())
            .filter(|e| e.is_object());
        if object.is_none() {
            global.clear_exception_except_termination();
        }
        Env { global, object }
    }

    pub fn get(&self, key: &[u8]) -> Option<Vec<u8>> {
        match self.object {
            Some(obj) => match obj.get(self.global, key) {
                Ok(Some(v)) if v.is_string() => {
                    let s = bun_core::OwnedString::new(bun_core::String::from_js(v, self.global).ok()?);
                    Some(s.to_utf8().slice().to_vec())
                }
                Ok(_) => None,
                Err(_) => {
                    self.global.clear_exception_except_termination();
                    None
                }
            },
            None => self
                .global
                .bun_vm()
                .as_mut()
                .transpiler
                .env_mut()
                .get(key)
                .map(<[u8]>::to_vec),
        }
    }

    /// Every string-valued entry, for `credential_process` children.
    pub fn to_map(&self) -> bun_sys::EnvMap {
        let vm = self.global.bun_vm().as_mut();
        let from_loader = || {
            vm.transpiler
                .env_mut()
                .map
                .std_env_map()
                .map(|w| w.get().clone())
                .unwrap_or_default()
        };
        let Some(obj) = self.object.and_then(JSValue::get_object) else {
            return from_loader();
        };
        let mut map = bun_sys::EnvMap::default();
        let Ok(mut iter) = JSPropertyIterator::init(
            self.global,
            obj,
            JSPropertyIteratorOptions::new(true, true),
        ) else {
            self.global.clear_exception_except_termination();
            return from_loader();
        };
        loop {
            match iter.next() {
                Ok(Some(key)) => {
                    let value = iter.value;
                    if !value.is_string() {
                        continue;
                    }
                    let Ok(v) = bun_core::String::from_js(value, self.global) else {
                        self.global.clear_exception_except_termination();
                        continue;
                    };
                    let v = bun_core::OwnedString::new(v);
                    #[allow(clippy::disallowed_methods)]
                    map.insert(
                        key.to_string(),
                        String::from_utf8_lossy(v.to_utf8().slice()).into_owned(),
                    );
                }
                Ok(None) => break,
                Err(_) => {
                    self.global.clear_exception_except_termination();
                    break;
                }
            }
        }
        map
    }
}

#[derive(Default)]
pub struct ChainConfig {
    /// Explicit profile from options; wins over `AWS_PROFILE`.
    pub profile: Option<Box<[u8]>>,

    pub aws_profile: Option<Box<[u8]>>,
    pub access_key_id: Option<Box<[u8]>>,
    pub secret_access_key: Option<Box<[u8]>>,
    pub session_token: Option<Box<[u8]>>,
    pub account_id: Option<Box<[u8]>>,
    pub region: Option<Box<[u8]>>,
    pub config_file: Option<Box<[u8]>>,
    pub credentials_file: Option<Box<[u8]>>,
    pub home: Option<Box<[u8]>>,

    pub web_identity_token_file: Option<Box<[u8]>>,
    pub role_arn: Option<Box<[u8]>>,
    pub role_session_name: Option<Box<[u8]>>,

    pub container_relative_uri: Option<Box<[u8]>>,
    pub container_full_uri: Option<Box<[u8]>>,
    pub container_auth_token: Option<Box<[u8]>>,
    pub container_auth_token_file: Option<Box<[u8]>>,

    pub imds_disabled: bool,
    pub imds_endpoint: Option<Box<[u8]>>,
    pub imds_ipv6: bool,
    pub imds_v1_disabled: bool,
    pub imds_timeout_ms: u32,
    pub imds_attempts: u32,

    pub endpoint_url_sts: Option<Box<[u8]>>,
    pub sts_regional_endpoints_legacy: bool,

    pub https_proxy: Option<Box<[u8]>>,
    pub http_proxy: Option<Box<[u8]>>,
    pub no_proxy: Option<Box<[u8]>>,
    pub reject_unauthorized: bool,

    /// Snapshot for `credential_process` children.
    pub env_map: bun_sys::EnvMap,
    /// Only the env source is consulted (used by tests and `credential_source = Environment`).
    pub skip_env: bool,
}

impl ChainConfig {
    pub fn capture(global: &JSGlobalObject, profile: Option<&[u8]>) -> ChainConfig {
        let env = Env::new(global);
        let timeout_secs: f64 = env
            .get(b"AWS_METADATA_SERVICE_TIMEOUT")
            .and_then(|s| core::str::from_utf8(&s).ok().and_then(|s| s.trim().parse().ok()))
            .filter(|v: &f64| v.is_finite() && *v > 0.0)
            .unwrap_or(1.0);
        let attempts: u32 = env
            .get(b"AWS_METADATA_SERVICE_NUM_ATTEMPTS")
            .and_then(|s| core::str::from_utf8(&s).ok().and_then(|s| s.trim().parse().ok()))
            .filter(|v: &u32| *v > 0)
            .unwrap_or(3);
        let reject_unauthorized = global.bun_vm().get_tls_reject_unauthorized();
        let env_map = env.to_map();
        ChainConfig {
            profile: profile.filter(|s| !s.is_empty()).map(Box::from),
            aws_profile: owned(env.get(b"AWS_PROFILE")),
            access_key_id: owned(env.get(b"AWS_ACCESS_KEY_ID")),
            secret_access_key: owned(env.get(b"AWS_SECRET_ACCESS_KEY")),
            session_token: owned(env.get(b"AWS_SESSION_TOKEN")),
            account_id: owned(env.get(b"AWS_ACCOUNT_ID")),
            region: owned(env.get(b"AWS_REGION").or_else(|| env.get(b"AWS_DEFAULT_REGION"))),
            config_file: owned(env.get(b"AWS_CONFIG_FILE")),
            credentials_file: owned(env.get(b"AWS_SHARED_CREDENTIALS_FILE")),
            home: owned(
                env.get(b"HOME")
                    .or_else(|| env.get(b"USERPROFILE"))
                    .or_else(|| bun_core::env_var::HOME.get().map(<[u8]>::to_vec)),
            ),
            web_identity_token_file: owned(env.get(b"AWS_WEB_IDENTITY_TOKEN_FILE")),
            role_arn: owned(env.get(b"AWS_ROLE_ARN")),
            role_session_name: owned(env.get(b"AWS_ROLE_SESSION_NAME")),
            container_relative_uri: owned(env.get(b"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")),
            container_full_uri: owned(env.get(b"AWS_CONTAINER_CREDENTIALS_FULL_URI")),
            container_auth_token: owned(env.get(b"AWS_CONTAINER_AUTHORIZATION_TOKEN")),
            container_auth_token_file: owned(env.get(b"AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE")),
            imds_disabled: truthy(env.get(b"AWS_EC2_METADATA_DISABLED").as_deref()),
            imds_endpoint: owned(env.get(b"AWS_EC2_METADATA_SERVICE_ENDPOINT")),
            imds_ipv6: env
                .get(b"AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE")
                .is_some_and(|m| m.eq_ignore_ascii_case(b"ipv6")),
            imds_v1_disabled: truthy(env.get(b"AWS_EC2_METADATA_V1_DISABLED").as_deref()),
            imds_timeout_ms: (timeout_secs * 1000.0).clamp(50.0, 120_000.0) as u32,
            imds_attempts: attempts.min(10),
            endpoint_url_sts: owned(
                env.get(b"AWS_ENDPOINT_URL_STS")
                    .or_else(|| env.get(b"AWS_ENDPOINT_URL")),
            ),
            sts_regional_endpoints_legacy: env
                .get(b"AWS_STS_REGIONAL_ENDPOINTS")
                .is_some_and(|m| m.eq_ignore_ascii_case(b"legacy")),
            https_proxy: owned(env.get(b"https_proxy").or_else(|| env.get(b"HTTPS_PROXY"))),
            http_proxy: owned(env.get(b"http_proxy").or_else(|| env.get(b"HTTP_PROXY"))),
            no_proxy: owned(env.get(b"no_proxy").or_else(|| env.get(b"NO_PROXY"))),
            reject_unauthorized,
            env_map,
            skip_env: false,
        }
    }

    pub fn effective_profile(&self) -> &[u8] {
        self.profile
            .as_deref()
            .or(self.aws_profile.as_deref())
            .unwrap_or(b"default")
    }

    pub fn profile_is_explicit(&self) -> bool {
        self.profile.is_some() || self.aws_profile.is_some()
    }

    fn home_join(&self, rel: &[u8]) -> Option<Vec<u8>> {
        let home = self.home.as_deref()?;
        let mut p = Vec::with_capacity(home.len() + 1 + rel.len());
        p.extend_from_slice(strings::trim_right(home, b"/\\"));
        p.push(bun_paths::SEP);
        p.extend_from_slice(rel);
        Some(p)
    }

    pub fn config_file_path(&self) -> Option<Vec<u8>> {
        match &self.config_file {
            Some(p) => Some(self.expand_home(p)),
            None => self.home_join(b".aws/config"),
        }
    }

    pub fn credentials_file_path(&self) -> Option<Vec<u8>> {
        match &self.credentials_file {
            Some(p) => Some(self.expand_home(p)),
            None => self.home_join(b".aws/credentials"),
        }
    }

    pub fn sso_cache_dir(&self) -> Option<Vec<u8>> {
        self.home_join(b".aws/sso/cache")
    }

    /// `~/x` → `$HOME/x`; anything else unchanged.
    pub fn expand_home(&self, path: &[u8]) -> Vec<u8> {
        if let Some(rest) = path
            .strip_prefix(b"~/".as_slice())
            .or_else(|| path.strip_prefix(b"~\\".as_slice()))
        {
            if let Some(joined) = self.home_join(rest) {
                return joined;
            }
        }
        path.to_vec()
    }

    /// The proxy to use for `url`, honouring `NO_PROXY` (`*`, exact host, or
    /// domain-suffix entries). Link-local metadata endpoints are never proxied.
    pub fn proxy_for(&self, url: &[u8]) -> Option<&[u8]> {
        let parsed = bun_url::URL::parse(url);
        let host = parsed.hostname;
        if host.is_empty()
            || host == b"169.254.169.254"
            || host == b"169.254.170.2"
            || host == b"169.254.170.23"
            || host == b"[fd00:ec2::254]"
            || host == b"[fd00:ec2::23]"
            || host == b"localhost"
            || host == b"127.0.0.1"
            || host == b"[::1]"
        {
            return None;
        }
        let proxy = if parsed.is_https() {
            self.https_proxy.as_deref()
        } else {
            self.http_proxy.as_deref()
        }?;
        if let Some(no_proxy) = self.no_proxy.as_deref() {
            for entry in no_proxy.split(|b| *b == b',') {
                let mut entry = strings::trim(entry, b" \t");
                if entry.is_empty() {
                    continue;
                }
                if entry == b"*" {
                    return None;
                }
                if let Some(rest) = entry.strip_prefix(b".".as_slice()) {
                    entry = rest;
                }
                // Strip a port from the entry for hostname comparison.
                let entry_host = match strings::index_of_char_usize(entry, b':') {
                    Some(i) if !entry.starts_with(b"[") => &entry[..i],
                    _ => entry,
                };
                if host.eq_ignore_ascii_case(entry_host)
                    || (host.len() > entry_host.len()
                        && host[host.len() - entry_host.len()..].eq_ignore_ascii_case(entry_host)
                        && host[host.len() - entry_host.len() - 1] == b'.')
                {
                    return None;
                }
            }
        }
        Some(proxy)
    }
}
