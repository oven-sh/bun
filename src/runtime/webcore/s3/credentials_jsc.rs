//! `S3Credentials.getCredentialsWithOptions` — parses a JS options object into
//! `S3CredentialsWithOptions`. Lives in `runtime/webcore/s3/` because it walks
//! a `jsc.JSValue`; `s3_signing/` is JSC-free.

use core::sync::atomic::Ordering;

use bun_core::{String as BunString, Tag as BunStringTag, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, RangeErrorOptions, StringJsc as _};

use bun_s3_signing::{
    ACL, MultiPartUploadOptions, S3Credentials, S3CredentialsWithOptions, SseCustomerKey,
    StorageClass,
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

const ACL_ONE_OF: &str = "\"private\", \"public-read\", \"public-read-write\", \"aws-exec-read\", \
\"authenticated-read\", \"bucket-owner-read\", \"bucket-owner-full-control\", \"log-delivery-write\"";

const STORAGE_CLASS_ONE_OF: &str = "\"STANDARD\", \"STANDARD_IA\", \"INTELLIGENT_TIERING\", \"EXPRESS_ONEZONE\", \
\"ONEZONE_IA\", \"GLACIER\", \"GLACIER_IR\", \"REDUCED_REDUNDANCY\", \"OUTPOSTS\", \"DEEP_ARCHIVE\", \"SNOW\"";

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

            if let Some(page_size) = opts.get_optional::<i64>(global_object, "pageSize")? {
                if page_size < MultiPartUploadOptions::MIN_SINGLE_UPLOAD_SIZE as i64
                    || page_size > MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE as i64
                {
                    return Err(global_object.throw_range_error(
                        page_size,
                        RangeErrorOptions {
                            min: MultiPartUploadOptions::MIN_SINGLE_UPLOAD_SIZE as i64,
                            max: MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE as i64,
                            field_name: b"pageSize",
                            ..Default::default()
                        },
                    ));
                } else {
                    new_credentials.options.part_size = page_size as u64;
                }
            }
            if let Some(part_size) = opts.get_optional::<i64>(global_object, "partSize")? {
                if part_size < MultiPartUploadOptions::MIN_SINGLE_UPLOAD_SIZE as i64
                    || part_size > MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE as i64
                {
                    return Err(global_object.throw_range_error(
                        part_size,
                        RangeErrorOptions {
                            min: MultiPartUploadOptions::MIN_SINGLE_UPLOAD_SIZE as i64,
                            max: MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE as i64,
                            field_name: b"partSize",
                            ..Default::default()
                        },
                    ));
                } else {
                    new_credentials.options.part_size = part_size as u64;
                }
            }

            if let Some(queue_size) = opts.get_optional::<i32>(global_object, "queueSize")? {
                if queue_size < 1 {
                    return Err(global_object.throw_range_error(
                        queue_size as i64,
                        RangeErrorOptions {
                            min: 1,
                            field_name: b"queueSize",
                            ..Default::default()
                        },
                    ));
                } else {
                    new_credentials.options.queue_size = queue_size.min(i32::from(u8::MAX)) as u8;
                }
            }

            if let Some(retry) = opts.get_optional::<i32>(global_object, "retry")? {
                if !(0..=255).contains(&retry) {
                    return Err(global_object.throw_range_error(
                        retry as i64,
                        RangeErrorOptions {
                            min: 0,
                            max: 255,
                            field_name: b"retry",
                            ..Default::default()
                        },
                    ));
                } else {
                    new_credentials.options.retry = retry as u8;
                }
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

            if let Some(sse) = opts.get_truthy(global_object, "sse")? {
                if !sse.is_object() {
                    return Err(
                        global_object.throw_invalid_argument_type_value(b"sse", b"object", sse)
                    );
                }
                new_credentials.credentials.sse_customer_key =
                    Some(Box::new(get_sse_customer_key(sse, global_object)?));
                new_credentials.changed_credentials = true;
            }
        }
    }
    Ok(new_credentials)
}

/// `sse: { type: "customer", algorithm?: "AES256", key }`. `key` is the
/// 32-byte customer key, as bytes or as base64.
fn get_sse_customer_key(sse: JSValue, global: &JSGlobalObject) -> JsResult<SseCustomerKey> {
    match get_truthy_string_utf8(sse, global, b"type", true)? {
        Some(kind) if kind.slice() == b"customer" => {}
        _ => {
            return Err(
                global.throw_invalid_arguments(format_args!("sse.type must be \"customer\""))
            );
        }
    }
    if let Some(algorithm) = get_truthy_string_utf8(sse, global, b"algorithm", true)? {
        if algorithm.slice() != SseCustomerKey::ALGORITHM {
            return Err(
                global.throw_invalid_arguments(format_args!("sse.algorithm must be \"AES256\""))
            );
        }
    }

    let Some(key) = sse.get_truthy(global, "key")? else {
        return Err(global.throw_invalid_arguments(format_args!(
            "sse.key is required. It is the {}-byte customer key, as bytes or as base64",
            SseCustomerKey::KEY_LEN
        )));
    };
    let mut raw = [0u8; SseCustomerKey::KEY_LEN];
    if key.is_string() {
        let encoded = key.to_utf8(global)?;
        let mut decoded = match bun_base64::decode_alloc(encoded.slice()) {
            Ok(decoded) if decoded.len() == raw.len() => decoded,
            _ => return Err(throw_invalid_sse_key_length(global)),
        };
        raw.copy_from_slice(&decoded);
        bun_core::secure_zero(&mut decoded);
    } else if let Some(buffer) = key.as_array_buffer(global) {
        let bytes = buffer.byte_slice();
        if bytes.len() != raw.len() {
            return Err(throw_invalid_sse_key_length(global));
        }
        raw.copy_from_slice(bytes);
    } else {
        return Err(global.throw_invalid_argument_type_value(
            b"sse.key",
            b"Uint8Array, ArrayBuffer or string",
            key,
        ));
    }
    let customer_key = SseCustomerKey::new(&raw);
    bun_core::secure_zero(&mut raw);
    Ok(customer_key)
}

fn throw_invalid_sse_key_length(global: &JSGlobalObject) -> bun_jsc::JsError {
    global.throw_invalid_arguments(format_args!(
        "sse.key must be {} bytes, or the base64 of {} bytes",
        SseCustomerKey::KEY_LEN,
        SseCustomerKey::KEY_LEN
    ))
}

fn contains_newline_or_cr(value: &[u8]) -> bool {
    strings::index_of_any(value, b"\r\n").is_some()
}
