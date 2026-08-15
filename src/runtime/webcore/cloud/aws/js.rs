//! `Bun.aws`: `credentials()` and `presign()`.

use bstr::BStr;
use bun_core::String as BunString;
use bun_http_jsc::method_jsc;
use bun_jsc::bun_string_jsc::create_utf8_for_js;
use bun_jsc::{
    CallFrame, GlobalRef, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, StringJsc as _,
};
use bun_s3_signing::AwsCredentials;
use bun_s3_signing::sigv4;

use super::fetch_signing::provider_error_to_js;
use super::sign_options::AwsSignOptions;
use crate::webcore::s3::credentials_jsc::get_truthy_string_utf8;

pub fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(
        global,
        &[
            ("fetch", __jsc_host_aws_fetch, 2),
            ("credentials", __jsc_host_credentials, 1),
            ("presign", __jsc_host_presign, 2),
        ],
    )
}

/// `Bun.aws.fetch(input, { service?, region?, profile?, ..., ...RequestInit })`
#[bun_jsc::host_fn]
fn aws_fetch(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    crate::webcore::fetch::fetch_with_auth(global, frame, crate::webcore::fetch::FetchAuth::Aws)
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

/// `Bun.aws.credentials({ profile?, refresh? })` → `Promise<AWSCredentials>`
#[bun_jsc::host_fn]
fn credentials(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    let opts = args.first().copied().filter(|v| v.is_object());
    let mut profile = None;
    let mut refresh = false;
    if let Some(o) = opts {
        profile = get_truthy_string_utf8(o, global, b"profile", true)?;
        refresh = o.get_boolean_strict(global, "refresh")?.unwrap_or(false);
    } else if let Some(v) = args.first() {
        if !v.is_undefined_or_null() {
            return Err(global.throw_invalid_arguments(format_args!(
                "credentials() expects an options object like {{ profile?: string, refresh?: boolean }}"
            )));
        }
    }
    let provider = super::default_provider(profile.as_ref().map(|p| p.slice()));
    if refresh {
        provider.forget();
    }

    let promise = JSPromiseStrong::init(global);
    let value = promise.value();
    let global_ref = GlobalRef::from(global);
    super::resolve_async(
        global,
        &provider,
        Box::new(move |result| {
            let global: &JSGlobalObject = &global_ref;
            let mut promise = promise;
            if !global.bun_vm().script_allowed() {
                return Ok(());
            }
            match result {
                Ok(c) => {
                    let js = credentials_to_js(global, &c)?;
                    promise.resolve(global, js)
                }
                Err(e) => promise.reject(global, Ok(provider_error_to_js(global, &e))),
            }
        }),
    )?;
    Ok(value)
}

/// `Bun.aws.presign(url, { expiresIn?, method?, service?, region?, ...credentials })` → `string`
#[bun_jsc::host_fn]
fn presign(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    let Some(url_value) = args.first().copied() else {
        return Err(global.throw_invalid_arguments(format_args!("presign() expects a URL")));
    };
    let href = if url_value.is_string() {
        BunString::from_js(url_value, global)?
    } else {
        bun_jsc::URL::href_from_js(url_value, global)?
    };
    let href = bun_core::OwnedString::new(href);
    let href_utf8 = href.to_utf8();
    let url = bun_url::URL::parse(href_utf8.slice());
    if !(url.is_http() || url.is_https()) || url.host.is_empty() {
        return Err(global
            .throw_invalid_arguments(format_args!("presign() expects an http: or https: URL")));
    }

    let options_value = args.get(1).copied().unwrap_or(JSValue::TRUE);
    let options_value = if options_value.is_undefined_or_null() {
        JSValue::TRUE
    } else {
        options_value
    };
    let Some(opts) = AwsSignOptions::from_js(global, options_value)? else {
        return Err(
            global.throw_invalid_arguments(format_args!("presign() options must be an object"))
        );
    };
    let mut method = bun_http::Method::GET;
    if options_value.is_object() {
        if let Some(m) = options_value.get_truthy(global, "method")? {
            method = match method_jsc::from_js(global, m)? {
                Some(m) => m,
                None => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "presign() method must be a valid HTTP method"
                    )));
                }
            };
        }
    }

    let creds = match opts.resolve_credentials() {
        Ok(c) => c,
        Err(message) => {
            return Err(global.throw(format_args!("{}", BStr::new(&message))));
        }
    };
    let (service, region) = match opts.scope_for(url.host, &creds) {
        Ok(v) => v,
        Err(message) => return Err(global.throw_invalid_arguments(format_args!("{message}"))),
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
}
