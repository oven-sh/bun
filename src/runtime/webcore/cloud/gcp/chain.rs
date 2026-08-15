//! Google Application Default Credentials → an OAuth2 access token (or an
//! OIDC identity token for a given audience):
//!
//!   1. `GOOGLE_APPLICATION_CREDENTIALS` — a service-account key file
//!      (self-signed JWT exchanged at `oauth2.googleapis.com/token`) or an
//!      `authorized_user` file (refresh token, what `gcloud auth
//!      application-default login` writes)
//!   2. the well-known ADC file (`~/.config/gcloud/application_default_credentials.json`,
//!      `%APPDATA%\\gcloud\\…` on Windows, or under `CLOUDSDK_CONFIG`)
//!   3. the metadata server (GCE, GKE, Cloud Run, Cloud Functions, App Engine …)
//!
//! Like the AWS chain: an unconfigured source is skipped, a configured but
//! failing one is an error. Synchronous; `provider.rs` runs it off-thread.

use std::io::Write as _;

use bstr::BStr;
use bun_core::strings;
use bun_http::Method;
use bun_jsc::JSGlobalObject;
use bun_s3_signing::ProviderError;
use bun_s3_signing::sigv4::uri_encode_into;
use bun_sys::{Fd, File};

use super::jwt;
use crate::webcore::cloud::cache::{Expiring, now_secs};
use crate::webcore::cloud::env::Env;
use crate::webcore::cloud::{http_sync, json};

pub const DEFAULT_SCOPE: &[u8] = b"https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_TOKEN_URI: &[u8] = b"https://oauth2.googleapis.com/token";
const METADATA_HOST: &[u8] = b"metadata.google.internal";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Source {
    ServiceAccount,
    AuthorizedUser,
    Metadata,
}

impl Source {
    pub const fn as_str(self) -> &'static str {
        match self {
            Source::ServiceAccount => "service-account",
            Source::AuthorizedUser => "authorized-user",
            Source::Metadata => "metadata",
        }
    }
}

/// What kind of token to mint.
#[derive(Clone, PartialEq, Eq, Hash)]
pub enum TokenRequest {
    /// OAuth2 access token for these scopes (space-joined).
    Access { scopes: Box<[u8]> },
    /// OIDC ID token for this audience.
    Identity { audience: Box<[u8]> },
}

pub struct Token {
    pub token: Box<[u8]>,
    /// Unix epoch seconds.
    pub expiration: u64,
    pub source: Source,
    /// Service account email, when known.
    pub email: Option<Box<[u8]>>,
    pub project_id: Option<Box<[u8]>>,
    /// `quota_project_id` from an authorized_user file / `GOOGLE_CLOUD_QUOTA_PROJECT`.
    pub quota_project_id: Option<Box<[u8]>>,
}

impl Expiring for Token {
    fn expiration(&self) -> Option<u64> {
        Some(self.expiration)
    }
}

impl Drop for Token {
    fn drop(&mut self) {
        // SAFETY: exclusively owned boxed slice.
        unsafe { bun_core::secure_zero(self.token.as_mut_ptr(), self.token.len()) };
    }
}

/// Environment snapshot, captured on the JS thread.
#[derive(Default)]
pub struct GcpConfig {
    pub credentials_file: Option<Box<[u8]>>,
    pub cloudsdk_config: Option<Box<[u8]>>,
    pub home: Option<Box<[u8]>>,
    pub appdata: Option<Box<[u8]>>,
    pub metadata_host: Option<Box<[u8]>>,
    pub metadata_disabled: bool,
    pub metadata_timeout_ms: u32,
    pub quota_project: Option<Box<[u8]>>,
    pub universe_domain: Option<Box<[u8]>>,
    pub https_proxy: Option<Box<[u8]>>,
    pub no_proxy: Option<Box<[u8]>>,
    pub reject_unauthorized: bool,
}

fn owned(v: Option<Vec<u8>>) -> Option<Box<[u8]>> {
    v.filter(|s| !s.is_empty()).map(Vec::into_boxed_slice)
}

impl GcpConfig {
    pub fn capture(global: &JSGlobalObject) -> GcpConfig {
        let env = Env::new(global);
        GcpConfig {
            credentials_file: owned(env.get(b"GOOGLE_APPLICATION_CREDENTIALS")),
            cloudsdk_config: owned(env.get(b"CLOUDSDK_CONFIG")),
            home: owned(
                env.get(b"HOME")
                    .or_else(|| env.get(b"USERPROFILE"))
                    .or_else(|| bun_core::env_var::HOME.get().map(<[u8]>::to_vec)),
            ),
            appdata: owned(env.get(b"APPDATA")),
            metadata_host: owned(
                env.get(b"GCE_METADATA_HOST")
                    .or_else(|| env.get(b"GCE_METADATA_IP")),
            ),
            metadata_disabled: env
                .get(b"NO_GCE_CHECK")
                .is_some_and(|v| v.eq_ignore_ascii_case(b"true") || v == b"1"),
            metadata_timeout_ms: env
                .get(b"GCE_METADATA_TIMEOUT")
                .and_then(|s| {
                    core::str::from_utf8(&s)
                        .ok()
                        .and_then(|s| s.trim().parse::<f64>().ok())
                })
                .filter(|v| v.is_finite() && *v > 0.0)
                // google-auth's default is 3s per attempt on the first probe.
                .map_or(3000, |secs| (secs * 1000.0).clamp(50.0, 120_000.0) as u32),
            quota_project: owned(env.get(b"GOOGLE_CLOUD_QUOTA_PROJECT")),
            universe_domain: owned(env.get(b"GOOGLE_CLOUD_UNIVERSE_DOMAIN")),
            https_proxy: owned(env.get(b"https_proxy").or_else(|| env.get(b"HTTPS_PROXY"))),
            no_proxy: owned(env.get(b"no_proxy").or_else(|| env.get(b"NO_PROXY"))),
            reject_unauthorized: global.bun_vm().get_tls_reject_unauthorized(),
        }
    }

    fn well_known_file(&self) -> Option<Vec<u8>> {
        const NAME: &[u8] = b"application_default_credentials.json";
        let mut p = Vec::new();
        if let Some(dir) = &self.cloudsdk_config {
            p.extend_from_slice(strings::trim_right(dir, b"/\\"));
        } else if cfg!(windows) {
            let appdata = self.appdata.as_deref()?;
            p.extend_from_slice(strings::trim_right(appdata, b"/\\"));
            p.push(bun_paths::SEP);
            p.extend_from_slice(b"gcloud");
        } else {
            let home = self.home.as_deref()?;
            p.extend_from_slice(strings::trim_right(home, b"/"));
            p.extend_from_slice(b"/.config/gcloud");
        }
        p.push(bun_paths::SEP);
        p.extend_from_slice(NAME);
        Some(p)
    }

    fn proxy_for(&self, url: &[u8]) -> Option<&[u8]> {
        let parsed = bun_url::URL::parse(url);
        if !parsed.is_https() {
            return None;
        }
        let proxy = self.https_proxy.as_deref()?;
        let host = parsed.hostname;
        if let Some(no_proxy) = self.no_proxy.as_deref() {
            for entry in no_proxy.split(|b| *b == b',') {
                let entry = strings::trim(entry, b" \t.");
                if entry == b"*"
                    || host.eq_ignore_ascii_case(entry)
                    || (host.len() > entry.len()
                        && !entry.is_empty()
                        && host[host.len() - entry.len()..].eq_ignore_ascii_case(entry)
                        && host[host.len() - entry.len() - 1] == b'.')
                {
                    return None;
                }
            }
        }
        Some(proxy)
    }
}

fn err(args: core::fmt::Arguments<'_>) -> ProviderError {
    let mut v = Vec::new();
    let _ = v.write_fmt(args);
    ProviderError::new("ERR_GCP_CREDENTIALS", v)
}

macro_rules! fail {
    ($($arg:tt)*) => { err(format_args!($($arg)*)) };
}

fn snippet(body: &[u8]) -> &BStr {
    let body = body.trim_ascii();
    BStr::new(&body[..body.len().min(300)])
}

fn form_encode(out: &mut Vec<u8>, pairs: &[(&[u8], &[u8])]) {
    for (i, (k, v)) in pairs.iter().enumerate() {
        if i > 0 {
            out.push(b'&');
        }
        uri_encode_into(out, k, false);
        out.push(b'=');
        uri_encode_into(out, v, false);
    }
}

/// `{"error": "...", "error_description": "..."}` from Google's token endpoint.
fn oauth_error(body: &[u8]) -> String {
    json::parse(body, |o| {
        let e = o.str(b"error");
        let d = o.str(b"error_description");
        match (e, d) {
            (Some(e), Some(d)) => format!("{}: {}", BStr::new(&e), BStr::new(&d)),
            (Some(e), None) => format!("{}", BStr::new(&e)),
            _ => format!("{}", snippet(body)),
        }
    })
    .unwrap_or_else(|| format!("{}", snippet(body)))
}

pub fn resolve(cfg: &GcpConfig, request: &TokenRequest) -> Result<Token, ProviderError> {
    let mut notes: Vec<u8> = Vec::new();
    let mut note = |args: core::fmt::Arguments<'_>| {
        if !notes.is_empty() {
            notes.extend_from_slice(b"; ");
        }
        let _ = notes.write_fmt(args);
    };

    // 1. GOOGLE_APPLICATION_CREDENTIALS
    if let Some(path) = &cfg.credentials_file {
        let bytes = File::read_from(Fd::cwd(), path).map_err(|e| {
            fail!(
                "could not read GOOGLE_APPLICATION_CREDENTIALS file {}: {}",
                BStr::new(path),
                BStr::new(e.name())
            )
        })?;
        let mut t = from_credentials_file(cfg, path, &bytes, request)?;
        if t.quota_project_id.is_none() {
            t.quota_project_id.clone_from(&cfg.quota_project);
        }
        return Ok(t);
    }
    note(format_args!("GOOGLE_APPLICATION_CREDENTIALS (not set)"));

    // 2. well-known ADC file
    match cfg.well_known_file() {
        Some(path) => match File::read_from(Fd::cwd(), &path) {
            Ok(bytes) => {
                let mut t = from_credentials_file(cfg, &path, &bytes, request)?;
                if t.quota_project_id.is_none() {
                    t.quota_project_id.clone_from(&cfg.quota_project);
                }
                return Ok(t);
            }
            Err(_) => note(format_args!(
                "application default credentials ({} not found; `gcloud auth application-default login` creates it)",
                BStr::new(&path)
            )),
        },
        None => note(format_args!(
            "application default credentials (HOME is not set)"
        )),
    }

    // 3. metadata server
    match from_metadata(cfg, request, &mut note)? {
        Some(t) => Ok(t),
        None => Err(ProviderError::new(
            "ERR_GCP_MISSING_CREDENTIALS",
            format!(
                "Could not find Google Cloud credentials in any source: {}",
                BStr::new(&notes)
            )
            .into_bytes(),
        )),
    }
}

fn from_credentials_file(
    cfg: &GcpConfig,
    path: &[u8],
    bytes: &[u8],
    request: &TokenRequest,
) -> Result<Token, ProviderError> {
    struct F {
        kind: Option<Box<[u8]>>,
        client_email: Option<Box<[u8]>>,
        private_key: Option<Box<[u8]>>,
        private_key_id: Option<Box<[u8]>>,
        token_uri: Option<Box<[u8]>>,
        project_id: Option<Box<[u8]>>,
        client_id: Option<Box<[u8]>>,
        client_secret: Option<Box<[u8]>>,
        refresh_token: Option<Box<[u8]>>,
        quota_project_id: Option<Box<[u8]>>,
        universe_domain: Option<Box<[u8]>>,
    }
    let Some(f) = json::parse(bytes, |o| F {
        kind: o.str(b"type"),
        client_email: o.str(b"client_email"),
        private_key: o.str(b"private_key"),
        private_key_id: o.str(b"private_key_id"),
        token_uri: o.str(b"token_uri"),
        project_id: o.str(b"project_id"),
        client_id: o.str(b"client_id"),
        client_secret: o.str(b"client_secret"),
        refresh_token: o.str(b"refresh_token"),
        quota_project_id: o.str(b"quota_project_id"),
        universe_domain: o.str(b"universe_domain"),
    }) else {
        return Err(fail!(
            "credentials file {} is not a JSON object",
            BStr::new(path)
        ));
    };
    match f.kind.as_deref() {
        Some(b"service_account") => {
            let (Some(email), Some(key)) = (&f.client_email, &f.private_key) else {
                return Err(fail!(
                    "service account file {} is missing client_email or private_key",
                    BStr::new(path)
                ));
            };
            let token_uri: Vec<u8> = match (&f.token_uri, &f.universe_domain, &cfg.universe_domain)
            {
                (Some(u), _, _) => u.to_vec(),
                (None, Some(d), _) | (None, None, Some(d)) if &**d != b"googleapis.com" => {
                    format!("https://oauth2.{}/token", BStr::new(d)).into_bytes()
                }
                _ => DEFAULT_TOKEN_URI.to_vec(),
            };
            let mut t = service_account_token(
                cfg,
                email,
                key,
                f.private_key_id.as_deref(),
                &token_uri,
                request,
            )?;
            t.project_id = f.project_id;
            t.quota_project_id = f.quota_project_id;
            Ok(t)
        }
        Some(b"authorized_user") => {
            let (Some(id), Some(secret), Some(rt)) =
                (&f.client_id, &f.client_secret, &f.refresh_token)
            else {
                return Err(fail!(
                    "authorized_user file {} is missing client_id, client_secret or refresh_token",
                    BStr::new(path)
                ));
            };
            let token_uri = f.token_uri.as_deref().unwrap_or(DEFAULT_TOKEN_URI);
            let mut t = authorized_user_token(cfg, id, secret, rt, token_uri, request)?;
            t.quota_project_id = f.quota_project_id;
            Ok(t)
        }
        Some(other) => Err(fail!(
            "credentials file {} has type \"{}\"; only \"service_account\" and \"authorized_user\" are supported (external_account / impersonation are not yet)",
            BStr::new(path),
            BStr::new(other)
        )),
        None => Err(fail!(
            "credentials file {} has no \"type\" field",
            BStr::new(path)
        )),
    }
}

fn post_token_endpoint(
    cfg: &GcpConfig,
    what: &str,
    token_uri: &[u8],
    body: &[u8],
) -> Result<http_sync::Response, ProviderError> {
    let parsed = bun_url::URL::parse(token_uri);
    if !(parsed.is_https()
        || (parsed.is_http()
            && (parsed.hostname == b"localhost" || parsed.hostname == b"127.0.0.1")))
    {
        return Err(fail!(
            "{what}: token_uri \"{}\" must be https://",
            BStr::new(token_uri)
        ));
    }
    let res = http_sync::fetch(&http_sync::Request {
        method: Method::POST,
        url: token_uri,
        headers: &[
            (b"content-type", b"application/x-www-form-urlencoded"),
            (b"accept", b"application/json"),
        ],
        body,
        timeout_ms: 30_000,
        follow_redirects: false,
        proxy: cfg.proxy_for(token_uri),
        reject_unauthorized: cfg.reject_unauthorized,
    })
    .map_err(|e| fail!("{what}: request to {} failed: {e}", BStr::new(token_uri)))?;
    if res.status != 200 {
        return Err(fail!(
            "{what}: {} answered HTTP {}: {}",
            BStr::new(token_uri),
            res.status,
            oauth_error(&res.body)
        ));
    }
    Ok(res)
}

fn service_account_token(
    cfg: &GcpConfig,
    email: &[u8],
    private_key: &[u8],
    key_id: Option<&[u8]>,
    token_uri: &[u8],
    request: &TokenRequest,
) -> Result<Token, ProviderError> {
    let now = now_secs();
    let (scope, target_audience) = match request {
        TokenRequest::Access { scopes } => (Some(&**scopes), None),
        TokenRequest::Identity { audience } => (None, Some(&**audience)),
    };
    let assertion = jwt::sign_rs256(
        private_key,
        key_id,
        &jwt::Claims {
            iss: email,
            scope,
            target_audience,
            aud: token_uri,
            iat: now.saturating_sub(10),
            exp: now + 3600,
        },
    )
    .map_err(|e| fail!("service account {}: {e}", BStr::new(email)))?;
    let mut body = Vec::with_capacity(assertion.len() + 80);
    form_encode(
        &mut body,
        &[
            (
                b"grant_type",
                b"urn:ietf:params:oauth:grant-type:jwt-bearer",
            ),
            (b"assertion", &assertion),
        ],
    );
    let what = format!("service account {}", BStr::new(email));
    let res = post_token_endpoint(cfg, &what, token_uri, &body)?;
    let mut t = token_from_response(&what, &res.body, request, Source::ServiceAccount)?;
    t.email = Some(Box::from(email));
    Ok(t)
}

fn authorized_user_token(
    cfg: &GcpConfig,
    client_id: &[u8],
    client_secret: &[u8],
    refresh_token: &[u8],
    token_uri: &[u8],
    request: &TokenRequest,
) -> Result<Token, ProviderError> {
    let mut body = Vec::with_capacity(256 + refresh_token.len());
    let mut pairs: Vec<(&[u8], &[u8])> = vec![
        (b"grant_type", b"refresh_token"),
        (b"client_id", client_id),
        (b"client_secret", client_secret),
        (b"refresh_token", refresh_token),
    ];
    if let TokenRequest::Access { scopes } = request {
        if &**scopes != DEFAULT_SCOPE {
            pairs.push((b"scope", scopes));
        }
    }
    form_encode(&mut body, &pairs);
    let what = "authorized user credentials";
    let res = post_token_endpoint(cfg, what, token_uri, &body)?;
    token_from_response(what, &res.body, request, Source::AuthorizedUser)
}

/// `{access_token, expires_in, id_token?, token_type}`
fn token_from_response(
    what: &str,
    body: &[u8],
    request: &TokenRequest,
    source: Source,
) -> Result<Token, ProviderError> {
    let parsed = json::parse(body, |o| {
        (
            o.str(b"access_token"),
            o.str(b"id_token"),
            o.number(b"expires_in"),
        )
    });
    let Some((access, id, expires_in)) = parsed else {
        return Err(fail!(
            "{what}: token endpoint returned an unexpected response: {}",
            snippet(body)
        ));
    };
    let now = now_secs();
    match request {
        TokenRequest::Access { .. } => {
            let Some(token) = access else {
                return Err(fail!("{what}: token endpoint response has no access_token"));
            };
            let expires_in = expires_in
                .filter(|e| e.is_finite() && *e > 0.0)
                .unwrap_or(3600.0) as u64;
            Ok(Token {
                token,
                expiration: now + expires_in,
                source,
                email: None,
                project_id: None,
                quota_project_id: None,
            })
        }
        TokenRequest::Identity { .. } => {
            let Some(token) = id else {
                return Err(fail!(
                    "{what}: token endpoint response has no id_token{}",
                    if source == Source::AuthorizedUser {
                        " (user credentials cannot mint ID tokens for an arbitrary audience; use a service account or the metadata server)"
                    } else {
                        ""
                    }
                ));
            };
            let expiration = jwt::unverified_exp(&token).unwrap_or(now + 3600);
            Ok(Token {
                token,
                expiration,
                source,
                email: None,
                project_id: None,
                quota_project_id: None,
            })
        }
    }
}

fn from_metadata(
    cfg: &GcpConfig,
    request: &TokenRequest,
    note: &mut dyn FnMut(core::fmt::Arguments<'_>),
) -> Result<Option<Token>, ProviderError> {
    if cfg.metadata_disabled {
        note(format_args!("metadata server (NO_GCE_CHECK is set)"));
        return Ok(None);
    }
    let base: Vec<u8> = match &cfg.metadata_host {
        Some(h) if h.starts_with(b"http://") || h.starts_with(b"https://") => {
            strings::trim_right(h, b"/").to_vec()
        }
        Some(h) => {
            let mut v = b"http://".to_vec();
            v.extend_from_slice(strings::trim_right(h, b"/"));
            v
        }
        None => {
            let mut v = b"http://".to_vec();
            v.extend_from_slice(METADATA_HOST);
            v
        }
    };
    let mut url = base.clone();
    url.extend_from_slice(b"/computeMetadata/v1/instance/service-accounts/default/");
    match request {
        TokenRequest::Access { scopes } => {
            url.extend_from_slice(b"token");
            if &**scopes != DEFAULT_SCOPE {
                url.extend_from_slice(b"?scopes=");
                // The metadata server wants them comma-separated.
                let joined: Vec<u8> = scopes
                    .iter()
                    .map(|c| if *c == b' ' { b',' } else { *c })
                    .collect();
                uri_encode_into(&mut url, &joined, false);
            }
        }
        TokenRequest::Identity { audience } => {
            url.extend_from_slice(b"identity?format=full&audience=");
            uri_encode_into(&mut url, audience, false);
        }
    }
    let headers: [(&[u8], &[u8]); 1] = [(b"metadata-flavor", b"Google")];
    let mut last_transport_err = None;
    let mut res = None;
    for attempt in 0..3 {
        match http_sync::fetch(&http_sync::Request {
            method: Method::GET,
            url: &url,
            headers: &headers,
            body: b"",
            timeout_ms: cfg.metadata_timeout_ms,
            follow_redirects: false,
            proxy: None,
            reject_unauthorized: cfg.reject_unauthorized,
        }) {
            Ok(r) if r.status >= 500 && attempt < 2 => {
                res = Some(r);
            }
            Ok(r) => {
                res = Some(r);
                break;
            }
            Err(e) => {
                // Off-GCP the hostname does not resolve / the address does
                // not route: that is "not on GCP", not an error.
                last_transport_err = Some(e);
                if cfg.metadata_host.is_none() {
                    break;
                }
            }
        }
    }
    let Some(res) = res else {
        let e = last_transport_err
            .map(|e| e.to_string())
            .unwrap_or_default();
        note(format_args!(
            "metadata server ({} is unreachable: {e})",
            BStr::new(&base)
        ));
        return Ok(None);
    };
    if res
        .header(b"metadata-flavor")
        .is_none_or(|v| !v.eq_ignore_ascii_case(b"Google"))
        && res.status != 200
    {
        note(format_args!(
            "metadata server ({} did not answer like one, HTTP {})",
            BStr::new(&base),
            res.status
        ));
        return Ok(None);
    }
    if res.status == 404 {
        return Err(fail!(
            "metadata server has no default service account attached (HTTP 404): {}",
            snippet(&res.body)
        ));
    }
    if res.status != 200 {
        return Err(fail!(
            "metadata server {} answered HTTP {}: {}",
            BStr::new(&url),
            res.status,
            snippet(&res.body)
        ));
    }
    let now = now_secs();
    let mut token = match request {
        TokenRequest::Access { .. } => {
            let parsed = json::parse(&res.body, |o| {
                (o.str(b"access_token"), o.number(b"expires_in"))
            });
            let Some((Some(token), expires_in)) = parsed else {
                return Err(fail!(
                    "metadata server returned an unexpected token response: {}",
                    snippet(&res.body)
                ));
            };
            Token {
                token,
                expiration: now
                    + expires_in
                        .filter(|e| e.is_finite() && *e > 0.0)
                        .unwrap_or(3600.0) as u64,
                source: Source::Metadata,
                email: None,
                project_id: None,
                quota_project_id: None,
            }
        }
        TokenRequest::Identity { .. } => {
            let body = res.body.trim_ascii();
            if body.is_empty() || strings::count_char(body, b'.') != 2 {
                return Err(fail!(
                    "metadata server returned an unexpected identity response: {}",
                    snippet(&res.body)
                ));
            }
            Token {
                token: Box::from(body),
                expiration: jwt::unverified_exp(body).unwrap_or(now + 3600),
                source: Source::Metadata,
                email: None,
                project_id: None,
                quota_project_id: None,
            }
        }
    };
    // Best-effort extras; cheap and cached alongside the token.
    let get = |path: &str| -> Option<Box<[u8]>> {
        let mut u = base.clone();
        u.extend_from_slice(path.as_bytes());
        http_sync::fetch(&http_sync::Request {
            method: Method::GET,
            url: &u,
            headers: &headers,
            body: b"",
            timeout_ms: cfg.metadata_timeout_ms,
            follow_redirects: false,
            proxy: None,
            reject_unauthorized: cfg.reject_unauthorized,
        })
        .ok()
        .filter(|r| r.status == 200)
        .map(|r| r.body.trim_ascii().to_vec())
        .filter(|b| !b.is_empty())
        .map(Vec::into_boxed_slice)
    };
    token.email = get("/computeMetadata/v1/instance/service-accounts/default/email");
    token.project_id = get("/computeMetadata/v1/project/project-id");
    token.quota_project_id.clone_from(&cfg.quota_project);
    Ok(Some(token))
}
