//! `S3Credentials.getCredentialsWithOptions` — parses a JS options object into
//! `S3CredentialsWithOptions`. Lives in `runtime/webcore/s3/` because it walks
//! a `jsc.JSValue`; `s3_signing/` is JSC-free.

use core::sync::atomic::Ordering;

use bun_core::{String as BunString, Tag as BunStringTag, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, RangeErrorOptions, StringJsc as _};
use bun_ptr::RefPtr;

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

const ACL_ONE_OF: &str = "\"private\", \"public-read\", \"public-read-write\", \"aws-exec-read\", \
\"authenticated-read\", \"bucket-owner-read\", \"bucket-owner-full-control\", \"log-delivery-write\"";

const STORAGE_CLASS_ONE_OF: &str = "\"STANDARD\", \"STANDARD_IA\", \"INTELLIGENT_TIERING\", \"EXPRESS_ONEZONE\", \
\"ONEZONE_IA\", \"GLACIER\", \"GLACIER_IR\", \"REDUCED_REDUNDANCY\", \"OUTPOSTS\", \"DEEP_ARCHIVE\", \"SNOW\"";

/// Copies `base` on the first override. Later overrides write to that copy.
fn copy_on_override<'a>(
    copy: &'a mut Option<S3Credentials>,
    base: &S3Credentials,
) -> &'a mut S3Credentials {
    copy.get_or_insert_with(|| base.clone())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn get_credentials_with_options(
    this: &RefPtr<S3Credentials>,
    default_options: MultiPartUploadOptions,
    options: Option<JSValue>,
    default_acl: Option<ACL>,
    default_storage_class: Option<StorageClass>,
    default_request_payer: bool,
    global_object: &JSGlobalObject,
) -> JsResult<S3CredentialsWithOptions> {
    bun_analytics::features::s3.fetch_add(1, Ordering::Relaxed);
    let mut new_credentials = S3CredentialsWithOptions {
        options: default_options,
        acl: default_acl,
        storage_class: default_storage_class,
        request_payer: default_request_payer,
        ..S3CredentialsWithOptions::new(this.clone())
    };
    let mut copy: Option<S3Credentials> = None;

    if let Some(opts) = options {
        if opts.is_object() {
            if let Some(utf8) = get_truthy_string_utf8(opts, global_object, b"accessKeyId", true)? {
                copy_on_override(&mut copy, this).access_key_id =
                    utf8.into_vec().into_boxed_slice();
            }
            if let Some(utf8) =
                get_truthy_string_utf8(opts, global_object, b"secretAccessKey", true)?
            {
                copy_on_override(&mut copy, this).secret_access_key =
                    utf8.into_vec().into_boxed_slice();
            }
            if let Some(utf8) = get_truthy_string_utf8(opts, global_object, b"region", true)? {
                copy_on_override(&mut copy, this).region = utf8.into_vec().into_boxed_slice();
            }
            if let Some(js_value) = opts.get_truthy(global_object, "endpoint")? {
                if !js_value.is_empty_or_undefined_or_null() {
                    if js_value.is_string() {
                        let str = BunString::from_js(js_value, global_object)?;
                        if str.tag() != BunStringTag::Empty && str.tag() != BunStringTag::Dead {
                            let utf8 = str.into_utf8();
                            let endpoint = utf8.slice();
                            if let Some(parsed) = URL::parse_s3_endpoint(endpoint) {
                                let credentials = copy_on_override(&mut copy, this);
                                credentials.endpoint = parsed.host_with_path;

                                // Default to https://
                                // Only use http:// if the endpoint specifically starts with 'http://'
                                credentials.insecure_http = parsed.is_http;
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
                copy_on_override(&mut copy, this).bucket = utf8.into_vec().into_boxed_slice();
            }

            if let Some(virtual_hosted_style) =
                opts.get_boolean_strict(global_object, "virtualHostedStyle")?
            {
                copy_on_override(&mut copy, this).virtual_hosted_style = virtual_hosted_style;
            }

            if let Some(utf8) = get_truthy_string_utf8(opts, global_object, b"sessionToken", true)?
            {
                copy_on_override(&mut copy, this).session_token =
                    utf8.into_vec().into_boxed_slice();
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
        }
    }
    if let Some(copy) = copy {
        new_credentials.credentials = RefPtr::new(copy);
    }
    Ok(new_credentials)
}

fn contains_newline_or_cr(value: &[u8]) -> bool {
    strings::index_of_any(value, b"\r\n").is_some()
}
