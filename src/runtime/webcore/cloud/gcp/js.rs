//! `Bun.GCPClient` (and `Bun.gcp`, an instance with default options):
//! `fetch()`, `accessToken()`, `idToken()`.

use std::sync::Arc;

use bun_jsc::bun_string_jsc::create_utf8_for_js;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _};

use super::chain::{CredentialSource, DEFAULT_SCOPE, Token, TokenRequest};
use super::provider::{TokenProvider, provider_for};
use crate::webcore::cloud::aws::fetch_signing::provider_error_to_js;
use crate::webcore::cloud::flight;
use crate::webcore::fetch::{FetchAuth, fetch_with_auth};
use crate::webcore::s3::credentials_jsc::get_truthy_string_utf8;

/// A `GCPClient`'s configuration: where credentials come from and the
/// default token to mint.
pub struct ClientOptions {
    pub source: CredentialSource,
    /// Space-joined default scopes for access tokens.
    pub scopes: Box<[u8]>,
    /// When set, `fetch()` sends an ID token for this audience by default.
    pub audience: Option<Box<[u8]>>,
    /// The provider for requests that override neither.
    pub default_provider: Arc<TokenProvider>,
}

impl ClientOptions {
    fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        struct Parsed {
            source: CredentialSource,
            scopes: Box<[u8]>,
            audience: Option<Box<[u8]>>,
        }
        impl Parsed {
            fn finish(self) -> ClientOptions {
                let request = match &self.audience {
                    Some(a) => TokenRequest::Identity {
                        audience: a.clone(),
                    },
                    None => TokenRequest::Access {
                        scopes: self.scopes.clone(),
                    },
                };
                ClientOptions {
                    default_provider: provider_for(request, &self.source),
                    source: self.source,
                    scopes: self.scopes,
                    audience: self.audience,
                }
            }
        }
        let mut out = Parsed {
            source: CredentialSource::Default,
            scopes: Box::from(DEFAULT_SCOPE),
            audience: None,
        };
        if !value.is_object() {
            return Ok(out.finish());
        }
        if let Some(path) = get_truthy_string_utf8(value, global, b"keyFile", true)? {
            out.source = CredentialSource::File(Arc::from(path.slice()));
        }
        if let Some(v) = value.get_truthy(global, "credentials")? {
            let json: Vec<u8> = if v.is_string() {
                let s = bun_core::OwnedString::new(bun_core::String::from_js(v, global)?);
                s.to_utf8().slice().to_vec()
            } else if v.is_object() {
                let mut s = bun_core::String::empty();
                v.json_stringify_fast(global, &mut s)?;
                let s = bun_core::OwnedString::new(s);
                s.to_utf8().slice().to_vec()
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "credentials must be a service-account / authorized_user key object or its JSON string"
                )));
            };
            out.source = CredentialSource::Inline(Arc::from(json.into_boxed_slice()));
        }
        if let Some(a) = audience_from_js(global, value)? {
            out.audience = Some(a);
        }
        if let Some(scopes) = value.get_truthy(global, "scopes")? {
            out.scopes = scopes_from_js(global, scopes)?;
        }
        Ok(out.finish())
    }
}

#[bun_jsc::JsClass]
pub struct GCPClient {
    pub(crate) options: Arc<ClientOptions>,
}

impl GCPClient {
    pub(crate) fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<Self>> {
        let arg = frame
            .arguments()
            .first()
            .copied()
            .unwrap_or(JSValue::UNDEFINED);
        if !arg.is_undefined_or_null() && !arg.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "GCPClient options must be an object like {{ keyFile, credentials, scopes, audience }}"
            )));
        }
        Ok(Box::new(GCPClient {
            options: Arc::new(ClientOptions::from_js(global, arg)?),
        }))
    }

    /// `Bun.gcp`.
    pub fn default(global: &JSGlobalObject) -> JsResult<Box<Self>> {
        Ok(Box::new(GCPClient {
            options: Arc::new(ClientOptions::from_js(global, JSValue::UNDEFINED)?),
        }))
    }

    /// `client.fetch(input, init?)` — `fetch()` with a bearer token attached.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fetch(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        fetch_with_auth(global, frame, FetchAuth::Gcp(Arc::clone(&this.options)))
    }

    /// `client.accessToken({ scopes?, refresh? })`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn access_token(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let opts = frame.arguments().first().copied();
        if let Some(v) = opts {
            if !v.is_undefined_or_null() && !v.is_object() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "accessToken() expects an options object like {{ scopes?: string | string[] }}"
                )));
            }
        }
        let scopes = match opts.filter(|o| o.is_object()) {
            Some(o) => match o.get_truthy(global, "scopes")? {
                Some(scopes) => scopes_from_js(global, scopes)?,
                None => this.options.scopes.clone(),
            },
            None => this.options.scopes.clone(),
        };
        let refresh = refresh_from(global, opts)?;
        this.start(global, TokenRequest::Access { scopes }, refresh)
    }

    /// `client.idToken(audience | { audience, refresh? })`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn id_token(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arg = frame
            .arguments()
            .first()
            .copied()
            .unwrap_or(JSValue::UNDEFINED);
        let audience: Box<[u8]> = if arg.is_string() {
            let s = bun_core::OwnedString::new(bun_core::String::from_js(arg, global)?);
            checked_audience(global, s.to_utf8().slice())?
        } else if arg.is_object()
            && let Some(a) = audience_from_js(global, arg)?
        {
            a
        } else {
            this.options.audience.clone().unwrap_or_default()
        };
        if audience.is_empty() {
            return Err(global.throw_invalid_arguments(format_args!(
                "idToken() needs an audience: idToken(\"https://my-service.run.app\") or idToken({{ audience }})"
            )));
        }
        let refresh = refresh_from(global, Some(arg))?;
        this.start(global, TokenRequest::Identity { audience }, refresh)
    }

    fn start(
        &self,
        global: &JSGlobalObject,
        request: TokenRequest,
        refresh: bool,
    ) -> JsResult<JSValue> {
        let provider = provider_for(request, &self.options.source);
        if refresh {
            provider.mark_stale();
        }
        flight::promise(global, &provider, provider_error_to_js, |global, t| {
            token_to_js(global, t)
        })
    }
}

pub fn token_to_js(global: &JSGlobalObject, t: &Token) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, 6);
    obj.put(
        global,
        b"token".as_slice(),
        create_utf8_for_js(global, &t.token)?,
    );
    obj.put(
        global,
        b"expiration".as_slice(),
        JSValue::from_date_number(global, t.expiration as f64 * 1000.0),
    );
    obj.put(
        global,
        b"source".as_slice(),
        create_utf8_for_js(global, t.source.as_str().as_bytes())?,
    );
    if let Some(e) = &t.email {
        obj.put(global, b"email".as_slice(), create_utf8_for_js(global, e)?);
    }
    if let Some(p) = &t.project_id {
        obj.put(
            global,
            b"projectId".as_slice(),
            create_utf8_for_js(global, p)?,
        );
    }
    if let Some(q) = &t.quota_project_id {
        obj.put(
            global,
            b"quotaProjectId".as_slice(),
            create_utf8_for_js(global, q)?,
        );
    }
    Ok(obj)
}

fn is_valid_scope(s: &[u8]) -> bool {
    !s.is_empty() && s.iter().all(|c| c.is_ascii_graphic() && *c != b',')
}

/// `options.audience`, checked.
fn audience_from_js(global: &JSGlobalObject, options: JSValue) -> JsResult<Option<Box<[u8]>>> {
    match get_truthy_string_utf8(options, global, b"audience", true)? {
        Some(a) => checked_audience(global, a.slice()).map(Some),
        None => Ok(None),
    }
}

fn checked_audience(global: &JSGlobalObject, audience: &[u8]) -> JsResult<Box<[u8]>> {
    if crate::webcore::s3::credentials_jsc::contains_newline_or_cr(audience) {
        return Err(
            global.throw_invalid_arguments(format_args!("audience must not contain newlines"))
        );
    }
    Ok(Box::from(audience))
}

/// A `scopes: string | string[]` value → space-joined scope URLs.
pub fn scopes_from_js(global: &JSGlobalObject, v: JSValue) -> JsResult<Box<[u8]>> {
    let bad = || {
        global.throw_invalid_arguments(format_args!(
            "scopes must be a scope URL string or an array of them"
        ))
    };
    let mut joined: Vec<u8> = Vec::new();
    let push = |global: &JSGlobalObject, item: JSValue, joined: &mut Vec<u8>| -> JsResult<bool> {
        if !item.is_string() {
            return Ok(false);
        }
        let s = bun_core::OwnedString::new(bun_core::String::from_js(item, global)?);
        let utf8 = s.to_utf8();
        for scope in bun_core::strings::split_any(utf8.slice(), b" ,") {
            if scope.is_empty() {
                continue;
            }
            if !is_valid_scope(scope) {
                return Ok(false);
            }
            if !joined.is_empty() {
                joined.push(b' ');
            }
            // Bare names like "cloud-platform" expand to the googleapis.com URL.
            if !scope.starts_with(b"https://")
                && !scope.starts_with(b"openid")
                && scope != b"email"
                && scope != b"profile"
            {
                joined.extend_from_slice(b"https://www.googleapis.com/auth/");
            }
            joined.extend_from_slice(scope);
        }
        Ok(true)
    };
    if v.is_string() {
        if !push(global, v, &mut joined)? {
            return Err(bad());
        }
    } else if v.is_array() {
        let mut iter = v.array_iterator(global)?;
        while let Some(item) = iter.next()? {
            if !push(global, item, &mut joined)? {
                return Err(bad());
            }
        }
    } else {
        return Err(bad());
    }
    if joined.is_empty() {
        return Ok(Box::from(DEFAULT_SCOPE));
    }
    Ok(joined.into_boxed_slice())
}

/// The per-request view: which token this `fetch()` should carry.
pub struct GcpFetchOptions {
    pub provider: Arc<TokenProvider>,
}

impl GcpFetchOptions {
    /// `inits`: the call's init dicts; the last one naming an `audience` or
    /// `scopes` decides the token, otherwise the client's default.
    pub fn from_js_with_base(
        global: &JSGlobalObject,
        inits: &[JSValue],
        base: &ClientOptions,
    ) -> JsResult<Self> {
        let mut request = None;
        for value in inits.iter().copied().filter(|v| v.is_object()) {
            let scopes = value.get_truthy(global, "scopes")?;
            if let Some(audience) = audience_from_js(global, value)? {
                if scopes.is_some() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "audience (an ID token) and scopes (an access token) are mutually exclusive"
                    )));
                }
                request = Some(TokenRequest::Identity { audience });
            } else if let Some(scopes) = scopes {
                request = Some(TokenRequest::Access {
                    scopes: scopes_from_js(global, scopes)?,
                });
            }
        }
        Ok(Self {
            provider: match request {
                Some(request) => provider_for(request, &base.source),
                None => Arc::clone(&base.default_provider),
            },
        })
    }

    pub fn needs_resolution(&self) -> bool {
        self.provider.cached_usable().is_none()
    }
}

fn refresh_from(global: &JSGlobalObject, opts: Option<JSValue>) -> JsResult<bool> {
    match opts.filter(|o| o.is_object()) {
        Some(o) => Ok(o.get_boolean_strict(global, "refresh")?.unwrap_or(false)),
        None => Ok(false),
    }
}
