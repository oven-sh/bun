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
//! failing one is an error; straight-line `async` code whose network I/O goes
//! through [`Io`], driven from the JS thread by `provider.rs`.

use std::io::Write as _;

use bstr::BStr;
use bun_core::strings;
use bun_jsc::JSGlobalObject;
use bun_s3_signing::ProviderError;
use bun_s3_signing::sigv4::uri_encode_into;
use bun_sys::{Fd, File};

use super::jwt;
use crate::webcore::cloud::cache::{Expiring, now_secs};
use crate::webcore::cloud::env::Env;
use crate::webcore::cloud::form_encode;
use crate::webcore::cloud::io::{ChainFuture, HttpError, HttpRequest, HttpResponse, Io};
use crate::webcore::cloud::json;

const TOKEN_ENDPOINT_TIMEOUT_MS: u32 = 30_000;
/// Sanity bound on `expires_in` from a token endpoint.
const MAX_TOKEN_LIFETIME_SECS: f64 = 7.0 * 24.0 * 3600.0;

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

/// Which credentials a `GCPClient` uses.
#[derive(Clone, PartialEq, Eq)]
pub enum CredentialSource {
    /// Application Default Credentials (env, gcloud file, metadata server).
    Default,
    /// A key file path (`keyFile`), as if `GOOGLE_APPLICATION_CREDENTIALS` named it.
    File(std::sync::Arc<[u8]>),
    /// The key file's JSON, given inline (`credentials`).
    Inline(std::sync::Arc<[u8]>),
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
        bun_core::secure_zero_slice(&mut self.token);
    }
}

/// Environment snapshot, captured on the JS thread.
#[derive(Default)]
pub struct GcpConfig {
    /// Inline key JSON from `new GCPClient({ credentials })`; wins over files.
    pub credentials_json: Option<std::sync::Arc<[u8]>>,
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
}

fn owned(v: Option<Vec<u8>>) -> Option<Box<[u8]>> {
    v.filter(|s| !s.is_empty()).map(Vec::into_boxed_slice)
}

impl GcpConfig {
    pub fn capture(global: &JSGlobalObject, source: &CredentialSource) -> GcpConfig {
        let env = Env::new(global);
        GcpConfig {
            credentials_json: match source {
                CredentialSource::Inline(json) => Some(std::sync::Arc::clone(json)),
                _ => None,
            },
            credentials_file: match source {
                CredentialSource::File(path) => Some(Box::from(&**path)),
                _ => owned(env.get(b"GOOGLE_APPLICATION_CREDENTIALS")),
            },
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
            https_proxy: owned(env.get_proxy_var(b"https_proxy", b"HTTPS_PROXY")),
            no_proxy: owned(env.get_proxy_var(b"no_proxy", b"NO_PROXY")),
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
        if let Some(no_proxy) = self.no_proxy.as_deref() {
            if bun_http::no_proxy_matches(no_proxy, parsed.hostname, parsed.host) {
                return None;
            }
        }
        Some(proxy)
    }
}

struct Resolver {
    cfg: GcpConfig,
    request: TokenRequest,
    io: Io,
    notes: Vec<u8>,
}

pub fn resolve(
    cfg: GcpConfig,
    request: TokenRequest,
    io: Io,
) -> ChainFuture<Result<Token, ProviderError>> {
    Box::pin(async move {
        let mut r = Resolver {
            cfg,
            request,
            io,
            notes: Vec::new(),
        };
        let t = r.run().await?;
        if t.expiration <= now_secs() + bun_s3_signing::AwsCredentials::EXPIRY_MARGIN_SECONDS {
            return Err(err(format_args!(
                "the {} token was already expired when it arrived; check this machine's clock",
                t.source.as_str()
            )));
        }
        Ok(t)
    })
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

impl Resolver {
    fn note(&mut self, args: core::fmt::Arguments<'_>) {
        if !self.notes.is_empty() {
            self.notes.extend_from_slice(b"; ");
        }
        let _ = self.notes.write_fmt(args);
    }

    async fn http(&self, mut req: HttpRequest, proxied: bool) -> Result<HttpResponse, HttpError> {
        if proxied {
            req.proxy_url = self.cfg.proxy_for(&req.url).map(Box::from);
        }
        self.io.http(req).await
    }

    async fn run(&mut self) -> Result<Token, ProviderError> {
        // 0. explicit key material from `new GCPClient({ credentials })`
        if let Some(json) = self.cfg.credentials_json.clone() {
            let mut t = self.from_credentials_file(b"<credentials>", &json).await?;
            if t.quota_project_id.is_none() {
                t.quota_project_id.clone_from(&self.cfg.quota_project);
            }
            return Ok(t);
        }

        // 1. GOOGLE_APPLICATION_CREDENTIALS / `new GCPClient({ keyFile })`
        if let Some(path) = self.cfg.credentials_file.clone() {
            let bytes = File::read_from(Fd::cwd(), &path).map_err(|e| {
                fail!(
                    "could not read credentials file {}: {}",
                    BStr::new(&path),
                    BStr::new(e.name())
                )
            })?;
            let mut t = self.from_credentials_file(&path, &bytes).await?;
            if t.quota_project_id.is_none() {
                t.quota_project_id.clone_from(&self.cfg.quota_project);
            }
            return Ok(t);
        }
        self.note(format_args!("GOOGLE_APPLICATION_CREDENTIALS (not set)"));

        // 2. well-known ADC file
        match self.cfg.well_known_file() {
            Some(path) => match File::read_from(Fd::cwd(), &path) {
                Ok(bytes) => {
                    let mut t = self.from_credentials_file(&path, &bytes).await?;
                    if t.quota_project_id.is_none() {
                        t.quota_project_id.clone_from(&self.cfg.quota_project);
                    }
                    return Ok(t);
                }
                Err(_) => self.note(format_args!(
                    "application default credentials ({} not found; `gcloud auth application-default login` creates it)",
                    BStr::new(&path)
                )),
            },
            None => self.note(format_args!(
                "application default credentials (HOME is not set)"
            )),
        }

        // 3. metadata server
        match self.from_metadata().await? {
            Some(t) => Ok(t),
            None => Err(ProviderError::new(
                "ERR_GCP_MISSING_CREDENTIALS",
                format!(
                    "Could not find Google Cloud credentials in any source: {}",
                    BStr::new(&self.notes)
                )
                .into_bytes(),
            )),
        }
    }

    async fn from_credentials_file(
        &self,
        path: &[u8],
        bytes: &[u8],
    ) -> Result<Token, ProviderError> {
        let cfg = &self.cfg;
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
                let token_uri: Vec<u8> =
                    match (&f.token_uri, &f.universe_domain, &cfg.universe_domain) {
                        (Some(u), _, _) => u.to_vec(),
                        (None, Some(d), _) | (None, None, Some(d)) if &**d != b"googleapis.com" => {
                            format!("https://oauth2.{}/token", BStr::new(d)).into_bytes()
                        }
                        _ => DEFAULT_TOKEN_URI.to_vec(),
                    };
                let mut t = self
                    .service_account_token(email, key, f.private_key_id.as_deref(), &token_uri)
                    .await?;
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
                let mut t = self
                    .authorized_user_token(id, secret, rt, token_uri)
                    .await?;
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

    async fn post_token_endpoint(
        &self,
        what: &str,
        token_uri: &[u8],
        body: Vec<u8>,
    ) -> Result<HttpResponse, ProviderError> {
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
        let req = HttpRequest::post(token_uri.to_vec(), body)
            .header(b"content-type", b"application/x-www-form-urlencoded")
            .header(b"accept", b"application/json")
            .timeout(TOKEN_ENDPOINT_TIMEOUT_MS);
        let res = self
            .http(req, true)
            .await
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

    async fn service_account_token(
        &self,
        email: &[u8],
        private_key: &[u8],
        key_id: Option<&[u8]>,
        token_uri: &[u8],
    ) -> Result<Token, ProviderError> {
        let request = &self.request;
        let now = now_secs();
        let (scope, target_audience) = match request {
            TokenRequest::Access { scopes } => (Some(&**scopes), None),
            TokenRequest::Identity { audience } => (None, Some(&**audience)),
        };
        let unsigned = jwt::unsigned(
            key_id,
            &jwt::Claims {
                iss: email,
                scope,
                target_audience,
                aud: token_uri,
                iat: now.saturating_sub(10),
                exp: now + 3600,
            },
        );
        // The RSA signature is a millisecond or two of CPU: not on the JS thread.
        let key = private_key.to_vec();
        let assertion = match self
            .io
            .blocking(move || {
                let signed = jwt::sign_rs256(&key, unsigned);
                let mut key = key;
                bun_core::secure_zero_slice(&mut key);
                signed
            })
            .await
        {
            Some(signed) => {
                signed.map_err(|e| fail!("service account {}: {e}", BStr::new(email)))?
            }
            None => return Err(fail!("the JavaScript VM is shutting down")),
        };
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
        let res = self.post_token_endpoint(&what, token_uri, body).await?;
        let mut t = Self::token_from_response(&what, &res.body, request, Source::ServiceAccount)?;
        t.email = Some(Box::from(email));
        Ok(t)
    }

    async fn authorized_user_token(
        &self,
        client_id: &[u8],
        client_secret: &[u8],
        refresh_token: &[u8],
        token_uri: &[u8],
    ) -> Result<Token, ProviderError> {
        let request = &self.request;
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
        let res = self.post_token_endpoint(what, token_uri, body).await?;
        Self::token_from_response(what, &res.body, request, Source::AuthorizedUser)
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
                    .unwrap_or(3600.0)
                    .min(MAX_TOKEN_LIFETIME_SECS) as u64;
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

    async fn from_metadata(&mut self) -> Result<Option<Token>, ProviderError> {
        let request = self.request.clone();
        let custom_host = self.cfg.metadata_host.is_some();
        if self.cfg.metadata_disabled {
            self.note(format_args!("metadata server (NO_GCE_CHECK is set)"));
            return Ok(None);
        }
        let base: Vec<u8> = match &self.cfg.metadata_host {
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
        match &request {
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
        let mut last_transport_err = None;
        let mut res = None;
        for attempt in 0..3 {
            match self.metadata_get(url.clone()).await {
                Ok(r) if r.status >= 500 && attempt < 2 => {
                    res = Some(r);
                }
                Ok(r) => {
                    res = Some(r);
                    break;
                }
                Err(e) => {
                    // Off-GCP the hostname does not resolve / the address does
                    // not route: that is "not on GCP", not an error. Only a
                    // host someone configured is worth retrying.
                    let retry = custom_host && !e.is_interruption();
                    last_transport_err = Some(e);
                    if !retry {
                        break;
                    }
                }
            }
        }
        let Some(res) = res else {
            let e = last_transport_err
                .map(|e| e.to_string())
                .unwrap_or_default();
            self.note(format_args!(
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
            self.note(format_args!(
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
        let mut token = match &request {
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
                            .unwrap_or(3600.0)
                            .min(MAX_TOKEN_LIFETIME_SECS) as u64,
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
        token.email = self
            .metadata_text(
                &base,
                "/computeMetadata/v1/instance/service-accounts/default/email",
            )
            .await;
        token.project_id = self
            .metadata_text(&base, "/computeMetadata/v1/project/project-id")
            .await;
        token.quota_project_id.clone_from(&self.cfg.quota_project);
        Ok(Some(token))
    }

    async fn metadata_get(&self, url: Vec<u8>) -> Result<HttpResponse, HttpError> {
        let req = HttpRequest::get(url)
            .header(b"metadata-flavor", b"Google")
            .timeout(self.cfg.metadata_timeout_ms);
        self.http(req, false).await
    }

    async fn metadata_text(&self, base: &[u8], path: &str) -> Option<Box<[u8]>> {
        let mut u = base.to_vec();
        u.extend_from_slice(path.as_bytes());
        self.metadata_get(u)
            .await
            .ok()
            .filter(|r| r.status == 200)
            .map(|r| r.body.trim_ascii().to_vec())
            .filter(|b| !b.is_empty())
            .map(Vec::into_boxed_slice)
    }
}
