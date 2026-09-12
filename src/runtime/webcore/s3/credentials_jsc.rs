//! `S3Credentials.getCredentialsWithOptions` — parses a JS options object into
//! `S3CredentialsWithOptions`. Lives in `runtime/webcore/s3/` because it walks
//! a `jsc.JSValue`; `s3_signing/` is JSC-free.

use core::sync::atomic::Ordering;

use bun_core::{String as BunString, Tag as BunStringTag, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, RangeErrorOptions, StringJsc as _};

use bun_s3_signing::{
    ACL, MultiPartUploadOptions, S3Credentials, S3CredentialsWithOptions, StorageClass,
};
use bun_url::URL;

/// `opts.{key}` → owned UTF-8 slice when the property is present, truthy, a
/// JS string, and non-empty. Shared ladder for the S3 option parsers
/// (`get_credentials_with_options`, `get_list_objects_options_from_js`):
///
///   get_truthy → is_string → BunString::from_js → tag ∉ {Empty,Dead} → into_utf8
///
/// `into_utf8()` moves the string's ref into the returned `Utf8Bytes` (or
/// transcodes into an owned buffer).
///
/// * `strict = true`  — non-string throws `ERR_INVALID_ARG_TYPE` keyed on `key`.
/// * `strict = false` — non-string is silently ignored.
pub(crate) fn get_truthy_string_utf8(
    opts: JSValue,
    global: &JSGlobalObject,
    key: &[u8],
    strict: bool,
) -> JsResult<Option<bun_core::Utf8Bytes<'static>>> {
    let Some(js_value) = opts.get_truthy(global, key)? else {
        return Ok(None);
    };
    if js_value.is_empty_or_undefined_or_null() {
        return Ok(None);
    }
    if !js_value.is_string() {
        if strict {
            return Err(global.throw_invalid_argument_type_value(key, b"string", js_value));
        }
        return Ok(None);
    }
    let str = BunString::from_js(js_value, global)?;
    if str.tag() == BunStringTag::Empty || str.tag() == BunStringTag::Dead {
        return Ok(None);
    }
    Ok(Some(str.into_utf8()))
}

/// `opts.{name}` via ToNumber, truncated, checked against `min..=max` before narrowing.
fn get_optional_int_in_range(
    opts: JSValue,
    global: &JSGlobalObject,
    name: &'static [u8],
    min: i64,
    max: Option<i64>,
) -> JsResult<Option<i64>> {
    let Some(value) = opts.get(global, name)? else {
        return Ok(None);
    };
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    let number = value.to_number(global)?;
    if number.is_nan() {
        return Err(global.throw_range_error(
            number,
            RangeErrorOptions {
                field_name: name,
                msg: b"an integer",
                ..Default::default()
            },
        ));
    }
    let truncated = number.trunc();
    if truncated < min as f64 || max.is_some_and(|max| truncated > max as f64) {
        return Err(global.throw_range_error(
            number,
            RangeErrorOptions {
                min,
                max: max.unwrap_or(i64::MAX),
                field_name: name,
                ..Default::default()
            },
        ));
    }
    // `as` saturates, so an unbounded `Infinity` becomes `i64::MAX`.
    Ok(Some(truncated as i64))
}

const ACL_ONE_OF: &str = "\"private\", \"public-read\", \"public-read-write\", \"aws-exec-read\", \
\"authenticated-read\", \"bucket-owner-read\", \"bucket-owner-full-control\", \"log-delivery-write\"";

const STORAGE_CLASS_ONE_OF: &str = "\"STANDARD\", \"STANDARD_IA\", \"INTELLIGENT_TIERING\", \"EXPRESS_ONEZONE\", \
\"ONEZONE_IA\", \"GLACIER\", \"GLACIER_IR\", \"REDUCED_REDUNDANCY\", \"OUTPOSTS\", \"DEEP_ARCHIVE\", \"SNOW\"";

#[allow(clippy::too_many_arguments)]
pub(crate) fn get_credentials_with_options(
    this: &S3Credentials,
    default_options: MultiPartUploadOptions,
    options: Option<JSValue>,
    default_acl: Option<ACL>,
    default_storage_class: Option<StorageClass>,
    default_request_payer: bool,
    global_object: &JSGlobalObject,
) -> JsResult<S3CredentialsWithOptions> {
    bun_analytics::features::s3.fetch_add(1, Ordering::Relaxed);
    // get ENV config
    // `S3Credentials`
    // carries an intrusive ref-count and is not `Copy`; `Clone` performs a
    // deep field copy with a fresh ref-count.
    let mut new_credentials = S3CredentialsWithOptions {
        credentials: this.clone(),
        options: default_options,
        acl: default_acl,
        storage_class: default_storage_class,
        request_payer: default_request_payer,
        ..Default::default()
    };

    if let Some(opts) = options {
        if opts.is_object() {
            if let Some(utf8) = get_truthy_string_utf8(opts, global_object, b"accessKeyId", true)? {
                new_credentials.credentials.access_key_id = utf8.into_vec().into_boxed_slice();
                new_credentials.changed_credentials = true;
            }
            if let Some(utf8) =
                get_truthy_string_utf8(opts, global_object, b"secretAccessKey", true)?
            {
                new_credentials.credentials.secret_access_key = utf8.into_vec().into_boxed_slice();
                new_credentials.changed_credentials = true;
            }
            if let Some(utf8) = get_truthy_string_utf8(opts, global_object, b"region", true)? {
                new_credentials.credentials.region = utf8.into_vec().into_boxed_slice();
                new_credentials.changed_credentials = true;
            }
            if let Some(js_value) = opts.get_truthy(global_object, "endpoint")? {
                if !js_value.is_empty_or_undefined_or_null() {
                    if js_value.is_string() {
                        let str = BunString::from_js(js_value, global_object)?;
                        if str.tag() != BunStringTag::Empty && str.tag() != BunStringTag::Dead {
                            let utf8 = str.into_utf8();
                            let endpoint = utf8.slice();
                            if let Some(parsed) = URL::parse_s3_endpoint(endpoint) {
                                new_credentials.credentials.endpoint = parsed.host_with_path;

                                // Default to https://
                                // Only use http:// if the endpoint specifically starts with 'http://'
                                new_credentials.credentials.insecure_http = parsed.is_http;

                                new_credentials.changed_credentials = true;
                            } else if !endpoint.is_empty() {
                                // endpoint is not a valid URL
                                return Err(global_object.throw_invalid_argument_type_value(
                                    b"endpoint",
                                    b"string",
                                    js_value,
                                ));
                            }
                        }
                    } else {
                        return Err(global_object.throw_invalid_argument_type_value(
                            b"endpoint",
                            b"string",
                            js_value,
                        ));
                    }
                }
            }
            if let Some(utf8) = get_truthy_string_utf8(opts, global_object, b"bucket", true)? {
                new_credentials.credentials.bucket = utf8.into_vec().into_boxed_slice();
                new_credentials.changed_credentials = true;
            }

            if let Some(virtual_hosted_style) =
                opts.get_boolean_strict(global_object, "virtualHostedStyle")?
            {
                new_credentials.credentials.virtual_hosted_style = virtual_hosted_style;
                new_credentials.changed_credentials = true;
            }

            if let Some(utf8) = get_truthy_string_utf8(opts, global_object, b"sessionToken", true)?
            {
                new_credentials.credentials.session_token = utf8.into_vec().into_boxed_slice();
                new_credentials.changed_credentials = true;
            }

            // `pageSize` is the deprecated alias. `partSize` is applied last and wins.
            for name in [b"pageSize".as_slice(), b"partSize".as_slice()] {
                if let Some(part_size) = get_optional_int_in_range(
                    opts,
                    global_object,
                    name,
                    MultiPartUploadOptions::MIN_SINGLE_UPLOAD_SIZE as i64,
                    Some(MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE as i64),
                )? {
                    new_credentials.options.part_size = part_size as u64;
                }
            }

            // Values above 255 clamp to the u8 field instead of throwing.
            if let Some(queue_size) =
                get_optional_int_in_range(opts, global_object, b"queueSize", 1, None)?
            {
                new_credentials.options.queue_size = queue_size.min(i64::from(u8::MAX)) as u8;
            }

            if let Some(retry) =
                get_optional_int_in_range(opts, global_object, b"retry", 0, Some(255))?
            {
                new_credentials.options.retry = retry as u8;
            }
            if let Some(acl) =
                opts.get_optional_enum_from_map(global_object, "acl", &ACL::MAP, ACL_ONE_OF)?
            {
                new_credentials.acl = Some(acl);
            }

            if let Some(storage_class) = opts.get_optional_enum_from_map(
                global_object,
                "storageClass",
                &StorageClass::MAP,
                STORAGE_CLASS_ONE_OF,
            )? {
                new_credentials.storage_class = Some(storage_class);
            }

            if let Some(utf8) =
                get_truthy_string_utf8(opts, global_object, b"contentDisposition", true)?
            {
                if contains_newline_or_cr(utf8.slice()) {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "contentDisposition must not contain newline characters (CR/LF)"
                    )));
                }
                new_credentials.content_disposition = Some(utf8);
            }

            if let Some(utf8) = get_truthy_string_utf8(opts, global_object, b"type", true)? {
                if contains_newline_or_cr(utf8.slice()) {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "type must not contain newline characters (CR/LF)"
                    )));
                }
                new_credentials.content_type = Some(utf8);
            }

            if let Some(utf8) =
                get_truthy_string_utf8(opts, global_object, b"contentEncoding", true)?
            {
                if contains_newline_or_cr(utf8.slice()) {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "contentEncoding must not contain newline characters (CR/LF)"
                    )));
                }
                new_credentials.content_encoding = Some(utf8);
            }

            if let Some(request_payer) = opts.get_boolean_strict(global_object, "requestPayer")? {
                new_credentials.request_payer = request_payer;
            }
        }
    }
    Ok(new_credentials)
}

fn contains_newline_or_cr(value: &[u8]) -> bool {
    strings::index_of_any(value, b"\r\n").is_some()
}
