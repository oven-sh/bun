//! `S3Credentials.getCredentialsWithOptions` — parses a JS options object into
//! `S3CredentialsWithOptions`. Lives in `runtime/webcore/s3/` because it walks
//! a `jsc.JSValue`; `s3_signing/` is JSC-free.

use core::sync::atomic::Ordering;

use bun_core::{String as BunString, Tag as BunStringTag, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, RangeErrorOptions, StringJsc as _};

use bun_s3_signing::{
    ACL, MultiPartUploadOptions, S3Credentials, S3CredentialsWithOptions, StorageClass,
    encode_uri_component,
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

/// The per-client or per-file settings that an S3 options object overrides.
#[derive(Default)]
pub(crate) struct S3Defaults<'a> {
    pub options: MultiPartUploadOptions,
    pub acl: Option<ACL>,
    pub storage_class: Option<StorageClass>,
    pub request_payer: bool,
    pub tagging: Option<&'a [u8]>,
}

pub(crate) fn get_credentials_with_options(
    this: &S3Credentials,
    defaults: S3Defaults<'_>,
    options: Option<JSValue>,
    global_object: &JSGlobalObject,
) -> JsResult<S3CredentialsWithOptions> {
    bun_analytics::features::s3.fetch_add(1, Ordering::Relaxed);
    // get ENV config
    // `S3Credentials`
    // carries an intrusive ref-count and is not `Copy`; `Clone` performs a
    // deep field copy with a fresh ref-count.
    let mut new_credentials = S3CredentialsWithOptions {
        credentials: this.clone(),
        options: defaults.options,
        acl: defaults.acl,
        storage_class: defaults.storage_class,
        request_payer: defaults.request_payer,
        tagging: defaults.tagging.map(Box::<[u8]>::from),
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

            get_tagging(opts, global_object, &mut new_credentials.tagging)?;
        }
    }
    Ok(new_credentials)
}

fn contains_newline_or_cr(value: &[u8]) -> bool {
    strings::index_of_any(value, b"\r\n").is_some()
}

/// Sets `tagging` from `opts.tagging`: a record, URL-encoded here as `k=v&k2=v2`,
/// or that string. An absent option keeps the default. An empty record clears it.
fn get_tagging(
    opts: JSValue,
    global: &JSGlobalObject,
    tagging: &mut Option<Box<[u8]>>,
) -> JsResult<()> {
    let Some(value) = opts.get_truthy(global, "tagging")? else {
        return Ok(());
    };
    if value.is_empty_or_undefined_or_null() {
        return Ok(());
    }
    if value.is_string() {
        let utf8 = value.to_utf8(global)?;
        let bytes = utf8.slice();
        // S3 collapses whitespace before it verifies, so such a value can never sign.
        if !bytes.iter().all(|b| b.is_ascii_graphic()) {
            return Err(global.throw_invalid_arguments(format_args!(
                "tagging must be a URL-encoded query string (\"key=value&key2=value2\") \
                 without whitespace or control characters"
            )));
        }
        *tagging = Some(Box::<[u8]>::from(bytes));
        return Ok(());
    }
    let Some(object) = value.get_object() else {
        return Err(global.throw_invalid_argument_type_value(
            b"tagging",
            b"object or string",
            value,
        ));
    };
    let iter = bun_jsc::JSPropertyIterator::init(
        global,
        object,
        bun_jsc::PropertyIteratorOptions {
            skip_empty_name: false,
            include_value: true,
        },
    )?;
    let mut encoded: Vec<u8> = Vec::new();
    while let Some((key, tag_value)) = iter.next()? {
        if !tag_value.is_string() {
            return Err(global
                .throw_invalid_arguments(format_args!("tagging[\"{}\"] must be a string", key)));
        }
        let key = key.to_utf8();
        let tag_value = tag_value.to_utf8(global)?;
        if !encoded.is_empty() {
            encoded.push(b'&');
        }
        push_uri_encoded(&mut encoded, key.slice());
        encoded.push(b'=');
        push_uri_encoded(&mut encoded, tag_value.slice());
    }
    *tagging = (!encoded.is_empty()).then(|| encoded.into_boxed_slice());
    Ok(())
}

fn push_uri_encoded(out: &mut Vec<u8>, input: &[u8]) {
    let start = out.len();
    out.resize(start + input.len() * 3, 0);
    let written = encode_uri_component::<true>(input, &mut out[start..])
        .expect("buffer holds three bytes per input byte")
        .len();
    out.truncate(start + written);
}
