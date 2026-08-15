//! `Bun.gcp`: `accessToken()` / `idToken()`, and the `{ gcp }` fetch option.

use bun_jsc::bun_string_jsc::create_utf8_for_js;
use bun_jsc::{
    CallFrame, GlobalRef, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, StringJsc as _,
};

use super::chain::{DEFAULT_SCOPE, Token, TokenRequest};
use super::provider::{TokenProvider, provider_for, resolve_async};
use crate::webcore::cloud::aws::fetch_signing::provider_error_to_js;
use crate::webcore::s3::credentials_jsc::get_truthy_string_utf8;

pub fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(
        global,
        &[
            ("accessToken", __jsc_host_access_token, 1),
            ("idToken", __jsc_host_id_token, 1),
        ],
    )
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

/// `scopes: string | string[]` → space-joined; default cloud-platform.
pub fn scopes_from_js(global: &JSGlobalObject, options: Option<JSValue>) -> JsResult<Box<[u8]>> {
    let Some(opts) = options.filter(|o| o.is_object()) else {
        return Ok(Box::from(DEFAULT_SCOPE));
    };
    let Some(v) = opts.get_truthy(global, "scopes")? else {
        return Ok(Box::from(DEFAULT_SCOPE));
    };
    let bad = || {
        global.throw_invalid_arguments(format_args!(
            "gcp.scopes must be a scope URL string or an array of them"
        ))
    };
    let mut joined: Vec<u8> = Vec::new();
    let push = |global: &JSGlobalObject, item: JSValue, joined: &mut Vec<u8>| -> JsResult<bool> {
        if !item.is_string() {
            return Ok(false);
        }
        let s = bun_core::OwnedString::new(bun_core::String::from_js(item, global)?);
        let utf8 = s.to_utf8();
        for scope in utf8.slice().split(|c| *c == b' ' || *c == b',') {
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

pub struct GcpFetchOptions {
    pub provider: std::sync::Arc<TokenProvider>,
}

impl GcpFetchOptions {
    /// `gcp: true | { scopes?, audience? }`; `None` for false/undefined.
    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Self>> {
        if value.is_undefined_or_null() || (value.is_boolean() && !value.as_boolean()) {
            return Ok(None);
        }
        if value.is_boolean() {
            return Ok(Some(Self {
                provider: provider_for(TokenRequest::Access {
                    scopes: Box::from(DEFAULT_SCOPE),
                }),
            }));
        }
        if !value.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "gcp must be true or an object like {{ scopes }} or {{ audience }}"
            )));
        }
        let request = if let Some(aud) = get_truthy_string_utf8(value, global, b"audience", true)? {
            if value.get_truthy(global, "scopes")?.is_some() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "gcp.audience (an ID token) and gcp.scopes (an access token) are mutually exclusive"
                )));
            }
            TokenRequest::Identity {
                audience: Box::from(aud.slice()),
            }
        } else {
            TokenRequest::Access {
                scopes: scopes_from_js(global, Some(value))?,
            }
        };
        Ok(Some(Self {
            provider: provider_for(request),
        }))
    }

    pub fn needs_resolution(&self) -> bool {
        self.provider.cached_fresh().is_none()
    }
}

fn start(global: &JSGlobalObject, request: TokenRequest, refresh: bool) -> JsResult<JSValue> {
    let provider = provider_for(request);
    if refresh {
        provider.forget();
    }
    let promise = JSPromiseStrong::init(global);
    let value = promise.value();
    let global_ref = GlobalRef::from(global);
    resolve_async(
        global,
        &provider,
        Box::new(move |result| {
            let global: &JSGlobalObject = &global_ref;
            let mut promise = promise;
            if !global.bun_vm().script_allowed() {
                return Ok(());
            }
            match result {
                Ok(t) => {
                    let js = token_to_js(global, &t)?;
                    promise.resolve(global, js)
                }
                Err(e) => promise.reject(global, Ok(provider_error_to_js(global, &e))),
            }
        }),
    )?;
    Ok(value)
}

fn refresh_from(global: &JSGlobalObject, opts: Option<JSValue>) -> JsResult<bool> {
    match opts.filter(|o| o.is_object()) {
        Some(o) => Ok(o.get_boolean_strict(global, "refresh")?.unwrap_or(false)),
        None => Ok(false),
    }
}

/// `Bun.gcp.accessToken({ scopes?, refresh? })`
#[bun_jsc::host_fn]
fn access_token(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let opts = frame.arguments().first().copied();
    if let Some(v) = opts {
        if !v.is_undefined_or_null() && !v.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "accessToken() expects an options object like {{ scopes?: string | string[] }}"
            )));
        }
    }
    let scopes = scopes_from_js(global, opts)?;
    let refresh = refresh_from(global, opts)?;
    start(global, TokenRequest::Access { scopes }, refresh)
}

/// `Bun.gcp.idToken({ audience, refresh? })` / `Bun.gcp.idToken(audience)`
#[bun_jsc::host_fn]
fn id_token(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arg = frame
        .arguments()
        .first()
        .copied()
        .unwrap_or(JSValue::UNDEFINED);
    let audience: Box<[u8]> = if arg.is_string() {
        let s = bun_core::OwnedString::new(bun_core::String::from_js(arg, global)?);
        Box::from(s.to_utf8().slice())
    } else if arg.is_object() {
        match get_truthy_string_utf8(arg, global, b"audience", true)? {
            Some(a) => Box::from(a.slice()),
            None => Box::default(),
        }
    } else {
        Box::default()
    };
    if audience.is_empty() {
        return Err(global.throw_invalid_arguments(format_args!(
            "idToken() needs an audience: idToken(\"https://my-service.run.app\") or idToken({{ audience }})"
        )));
    }
    if bun_core::strings::index_of_any(&audience, b"\r\n").is_some() {
        return Err(
            global.throw_invalid_arguments(format_args!("audience must not contain newlines"))
        );
    }
    let refresh = refresh_from(global, Some(arg))?;
    start(global, TokenRequest::Identity { audience }, refresh)
}
