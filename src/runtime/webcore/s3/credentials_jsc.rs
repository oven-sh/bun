//! `S3Credentials.getCredentialsWithOptions` — parses a JS options object into
//! `S3CredentialsWithOptions`. Lives in `runtime/webcore/s3/` because
//! `s3_signing/` is JSC-free.

use core::sync::atomic::Ordering;

use bun_core::comptime_string_map::ComptimeStringMap;
use bun_core::strings;
use bun_jsc::{JSGlobalObject, JsResult, RangeErrorOptions, bun_string_jsc};

use bun_s3_signing::{
    ACL, MultiPartUploadOptions, S3Credentials, S3CredentialsWithOptions, StorageClass,
};
use bun_url::URL;

use crate::generated_bindgen::blob::{OptionText, S3Options};

/// `opts.{key}` → owned UTF-8 slice when the property is present, truthy, a
/// JS string, and non-empty. A non-string throws `ERR_INVALID_ARG_TYPE` keyed on `key`.
///
/// `into_utf8()` moves the string's ref into the returned `Utf8Bytes` (or
/// transcodes into an owned buffer).
fn truthy_string_utf8(
    global: &JSGlobalObject,
    key: &[u8],
    value: OptionText<'_>,
) -> JsResult<Option<bun_core::Utf8Bytes<'static>>> {
    match crate::webcore::blob::truthy_string(value) {
        Ok(str) => Ok(str
            .filter(|str| !str.is_empty())
            .map(bun_core::String::into_utf8)),
        Err(js_value) => {
            Err(global.throw_invalid_argument_type_value(key, b"string", js_value.to_js()))
        }
    }
}

const ACL_ONE_OF: &str = "\"private\", \"public-read\", \"public-read-write\", \"aws-exec-read\", \
\"authenticated-read\", \"bucket-owner-read\", \"bucket-owner-full-control\", \"log-delivery-write\"";

const STORAGE_CLASS_ONE_OF: &str = "\"STANDARD\", \"STANDARD_IA\", \"INTELLIGENT_TIERING\", \"EXPRESS_ONEZONE\", \
\"ONEZONE_IA\", \"GLACIER\", \"GLACIER_IR\", \"REDUCED_REDUNDANCY\", \"OUTPOSTS\", \"DEEP_ARCHIVE\", \"SNOW\"";

pub(crate) fn get_credentials_with_options(
    this: &S3Credentials,
    default_options: MultiPartUploadOptions,
    options: Option<S3Options<'_>>,
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
        if let Some(utf8) = truthy_string_utf8(
            global_object,
            b"accessKeyId",
            opts.access_key_id(global_object)?,
        )? {
            new_credentials.credentials.access_key_id = utf8.into_vec().into_boxed_slice();
            new_credentials.changed_credentials = true;
        }
        if let Some(utf8) = truthy_string_utf8(
            global_object,
            b"secretAccessKey",
            opts.secret_access_key(global_object)?,
        )? {
            new_credentials.credentials.secret_access_key = utf8.into_vec().into_boxed_slice();
            new_credentials.changed_credentials = true;
        }
        if let Some(utf8) =
            truthy_string_utf8(global_object, b"region", opts.region(global_object)?)?
        {
            new_credentials.credentials.region = utf8.into_vec().into_boxed_slice();
            new_credentials.changed_credentials = true;
        }
        if let Some(utf8) =
            truthy_string_utf8(global_object, b"endpoint", opts.endpoint(global_object)?)?
        {
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
                    bun_string_jsc::create_utf8_for_js(global_object, endpoint)?,
                ));
            }
        }
        if let Some(utf8) =
            truthy_string_utf8(global_object, b"bucket", opts.bucket(global_object)?)?
        {
            new_credentials.credentials.bucket = utf8.into_vec().into_boxed_slice();
            new_credentials.changed_credentials = true;
        }

        if let Some(virtual_hosted_style) = opts.virtual_hosted_style(global_object)? {
            new_credentials.credentials.virtual_hosted_style = virtual_hosted_style;
            new_credentials.changed_credentials = true;
        }

        if let Some(utf8) = truthy_string_utf8(
            global_object,
            b"sessionToken",
            opts.session_token(global_object)?,
        )? {
            new_credentials.credentials.session_token = utf8.into_vec().into_boxed_slice();
            new_credentials.changed_credentials = true;
        }

        if let Some(page_size) = opts.page_size(global_object)? {
            let page_size = page_size.to_js().coerce::<i64>(global_object)?;
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
        if let Some(part_size) = opts.part_size(global_object)? {
            let part_size = part_size.to_js().coerce::<i64>(global_object)?;
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

        if let Some(queue_size) = opts.queue_size(global_object)? {
            let queue_size = queue_size.to_js().coerce::<i32>(global_object)?;
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

        if let Some(retry) = opts.retry(global_object)? {
            let retry = retry.to_js().coerce::<i32>(global_object)?;
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
        if let Some(acl) = enum_from_map(
            global_object,
            opts.acl(global_object)?,
            "acl",
            &ACL::MAP,
            ACL_ONE_OF,
        )? {
            new_credentials.acl = Some(acl);
        }

        if let Some(storage_class) = enum_from_map(
            global_object,
            opts.storage_class(global_object)?,
            "storageClass",
            &StorageClass::MAP,
            STORAGE_CLASS_ONE_OF,
        )? {
            new_credentials.storage_class = Some(storage_class);
        }

        if let Some(utf8) = truthy_string_utf8(
            global_object,
            b"contentDisposition",
            opts.content_disposition(global_object)?,
        )? {
            if contains_newline_or_cr(utf8.slice()) {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "contentDisposition must not contain newline characters (CR/LF)"
                )));
            }
            new_credentials.content_disposition = Some(utf8);
        }

        if let Some(utf8) = truthy_string_utf8(global_object, b"type", opts.r#type(global_object)?)?
        {
            if contains_newline_or_cr(utf8.slice()) {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "type must not contain newline characters (CR/LF)"
                )));
            }
            new_credentials.content_type = Some(utf8);
        }

        if let Some(utf8) = truthy_string_utf8(
            global_object,
            b"contentEncoding",
            opts.content_encoding(global_object)?,
        )? {
            if contains_newline_or_cr(utf8.slice()) {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "contentEncoding must not contain newline characters (CR/LF)"
                )));
            }
            new_credentials.content_encoding = Some(utf8);
        }

        if let Some(request_payer) = opts.request_payer(global_object)? {
            new_credentials.request_payer = request_payer;
        }
    }
    Ok(new_credentials)
}

fn enum_from_map<E: Copy + 'static, M: ComptimeStringMap<Value = E>>(
    global_object: &JSGlobalObject,
    name: Option<bun_core::Utf8Bytes<'static>>,
    property_name: &str,
    map: &'static M,
    one_of: &str,
) -> JsResult<Option<E>> {
    let Some(name) = name else {
        return Ok(None);
    };
    match map.lookup(name.slice()) {
        Some(value) => Ok(Some(*value)),
        None => Err(global_object
            .throw_invalid_arguments(format_args!("{property_name} must be one of {one_of}"))),
    }
}

fn contains_newline_or_cr(value: &[u8]) -> bool {
    strings::index_of_any(value, b"\r\n").is_some()
}
