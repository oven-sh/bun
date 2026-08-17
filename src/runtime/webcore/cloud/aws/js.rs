//! `Bun.AWSClient` (and `Bun.aws`, an instance with default options):
//! `fetch()`, `presign()`, `credentials()`.

use std::sync::Arc;

use bun_core::String as BunString;
use bun_http_jsc::method_jsc;
use bun_jsc::bun_string_jsc::create_utf8_for_js;
use bun_jsc::{CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, StringJsc as _};
use bun_s3_signing::AwsCredentials;
use bun_s3_signing::sigv4;

use super::fetch_signing::provider_error_to_js;
use super::sign_options::{AwsSignOptions, Credentials};
use crate::webcore::cloud::flight;
use crate::webcore::fetch::{FetchAuth, fetch_with_auth};

/// A set of AWS request-signing defaults: credentials (static, a profile, or
/// the ambient chain), region, service, endpoint. `Bun.aws` is one with no
/// overrides; `new Bun.AWSClient({...})` makes more.
#[bun_jsc::JsClass]
pub struct AWSClient {
    pub(crate) options: Arc<AwsSignOptions>,
}

impl AWSClient {
    pub(crate) fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<Self>> {
        let arg = frame
            .arguments()
            .first()
            .copied()
            .unwrap_or(JSValue::UNDEFINED);
        Ok(Box::new(AWSClient {
            options: Arc::new(AwsSignOptions::ambient().with_overrides(global, &[arg])?),
        }))
    }

    /// `Bun.aws`.
    pub fn default(_global: &JSGlobalObject) -> JsResult<Box<Self>> {
        Ok(Box::new(AWSClient {
            options: Arc::new(AwsSignOptions::ambient()),
        }))
    }

    /// `client.fetch(input, init?)` — `fetch()` with the request SigV4-signed
    /// using this client's defaults overlaid with `init`.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fetch(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        fetch_with_auth(global, frame, FetchAuth::Aws(Arc::clone(&this.options)))
    }

    /// `client.credentials({ refresh? })` → `Promise<AWSCredentials>`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn credentials(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arg = frame
            .arguments()
            .first()
            .copied()
            .unwrap_or(JSValue::UNDEFINED);
        let options = this.options.with_overrides(global, &[arg])?;
        let refresh =
            arg.is_object() && arg.get_boolean_strict(global, "refresh")?.unwrap_or(false);
        if refresh && let Credentials::Provider(p) = &options.credentials {
            p.mark_stale();
        }
        with_credentials(global, options.credentials, |global, creds| {
            credentials_to_js(global, creds)
        })
    }

    /// `client.presign(url, { expiresIn?, method?, ...overrides })` → `Promise<string>`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn presign(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = frame.arguments();
        let Some(url_value) = args.first().copied() else {
            return Err(global.throw_invalid_arguments(format_args!("presign() expects a URL")));
        };
        let options_value = args.get(1).copied().unwrap_or(JSValue::UNDEFINED);
        let opts = this.options.with_overrides(global, &[options_value])?;

        let href = if url_value.is_string() {
            BunString::from_js(url_value, global)?
        } else {
            bun_jsc::URL::href_from_js(url_value, global)?
        };
        let href = bun_core::OwnedString::new(href);
        let href_bytes: Vec<u8> = href.to_utf8().slice().to_vec();
        if !href_bytes.starts_with(b"/") {
            let url = bun_url::URL::parse(&href_bytes);
            if !(url.is_http() || url.is_https()) || url.host.is_empty() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "presign() expects an http: or https: URL, or a path with the service option"
                )));
            }
        }
        let mut method = bun_http::Method::GET;
        if options_value.is_object()
            && let Some(m) = options_value.get_truthy(global, "method")?
        {
            method = match method_jsc::from_js(global, m)? {
                Some(m) => m,
                None => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "presign() method must be a valid HTTP method"
                    )));
                }
            };
        }

        with_credentials(global, opts.credentials.clone(), move |global, creds| {
            let mut href_bytes = href_bytes;
            if href_bytes.starts_with(b"/") {
                match opts.default_endpoint(global) {
                    Ok(mut origin) => {
                        origin.extend_from_slice(&href_bytes);
                        href_bytes = origin;
                    }
                    Err(e) => {
                        return Err(global.throw_invalid_arguments(format_args!("presign() {e}")));
                    }
                }
            }
            let url = bun_url::URL::parse(&href_bytes);
            if !(url.is_http() || url.is_https()) || url.host.is_empty() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "presign() expects an http: or https: URL"
                )));
            }
            let (service, region) = match opts.scope_for(global, url.host, creds) {
                Ok(v) => v,
                Err(message) => {
                    return Err(global.throw_invalid_arguments(format_args!("{message}")));
                }
            };
            let query = url.search();
            let query = query.strip_prefix(b"?".as_slice()).unwrap_or(query);
            let signed = sigv4::presign(
                &creds.sigv4(),
                &sigv4::Request {
                    method: method.as_str().as_bytes(),
                    host: url.host,
                    path: url.raw_pathname(),
                    query,
                    headers: &[],
                    payload: if opts.unsigned_payload || sigv4::is_s3_service(&service) {
                        sigv4::Payload::Unsigned
                    } else {
                        sigv4::Payload::Bytes(b"")
                    },
                    scope: sigv4::Scope {
                        service: &service,
                        region: &region,
                    },
                    datetime: opts.datetime,
                    s3_path_semantics: None,
                },
                if url.is_https() { b"https" } else { b"http" },
                opts.expires_in,
            );
            match signed {
                Ok(p) => create_utf8_for_js(global, &p.url),
                Err(e) => Err(global.throw(format_args!("presign() failed: {e:?}"))),
            }
        })
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_region(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match this.options.configured_region(global) {
            Some(r) => create_utf8_for_js(global, &r),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_profile(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match this.options.profile_label() {
            Some(p) => create_utf8_for_js(global, p),
            None => Ok(JSValue::UNDEFINED),
        }
    }
}

/// A promise for `build(credentials)`: settled now when the credentials are
/// static or cached, else once the client's provider has resolved them. A
/// JS exception `build` leaves pending becomes the rejection.
fn with_credentials(
    global: &JSGlobalObject,
    credentials: Credentials,
    build: impl FnOnce(&JSGlobalObject, &AwsCredentials) -> JsResult<JSValue> + 'static,
) -> JsResult<JSValue> {
    match credentials {
        Credentials::Static(c) => {
            let mut promise = JSPromiseStrong::init(global);
            let value = promise.value();
            let built = build(global, &c);
            promise.settle(global, built)?;
            Ok(value)
        }
        Credentials::Provider(provider) => {
            flight::promise(global, &provider, provider_error_to_js, build)
        }
    }
}

pub fn credentials_to_js(global: &JSGlobalObject, c: &AwsCredentials) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, 7);
    obj.put(
        global,
        b"accessKeyId".as_slice(),
        create_utf8_for_js(global, &c.access_key_id)?,
    );
    obj.put(
        global,
        b"secretAccessKey".as_slice(),
        create_utf8_for_js(global, &c.secret_access_key)?,
    );
    if let Some(t) = c.session_token() {
        obj.put(
            global,
            b"sessionToken".as_slice(),
            create_utf8_for_js(global, t)?,
        );
    }
    if let Some(exp) = c.expiration {
        obj.put(
            global,
            b"expiration".as_slice(),
            JSValue::from_date_number(global, exp as f64 * 1000.0),
        );
    }
    if let Some(r) = &c.region {
        obj.put(global, b"region".as_slice(), create_utf8_for_js(global, r)?);
    }
    if let Some(a) = &c.account_id {
        obj.put(
            global,
            b"accountId".as_slice(),
            create_utf8_for_js(global, a)?,
        );
    }
    obj.put(
        global,
        b"source".as_slice(),
        create_utf8_for_js(global, c.source.as_str().as_bytes())?,
    );
    Ok(obj)
}
