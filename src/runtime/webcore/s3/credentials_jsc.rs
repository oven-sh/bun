//! `S3Credentials.getCredentialsWithOptions` — parses a JS options object into
//! `S3CredentialsWithOptions`. Lives in `runtime/webcore/s3/` because it walks
//! a `jsc.JSValue`; `s3_signing/` is JSC-free.

use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_str::{self as bstr, strings};

use bun_s3_signing::{S3Credentials, S3CredentialsWithOptions, ACL, StorageClass};
use super::multipart_options::MultiPartUploadOptions;
// TODO(port): verify crate path for bun.URL (src/url.zig)
use bun_url::URL;

// TODO(port): the Zig stores `str.toUTF8()` results in `_*_slice` fields and then
// borrows `.slice()` into `credentials.*` — a self-referential struct. Phase B must
// decide whether `Utf8Slice` owns its buffer (safe) or borrows from the dropped
// `bun_str::String` (would need restructuring).

pub fn get_credentials_with_options(
    this: S3Credentials,
    default_options: MultiPartUploadOptions,
    options: Option<JSValue>,
    default_acl: Option<ACL>,
    default_storage_class: Option<StorageClass>,
    default_request_payer: bool,
    global_object: &JSGlobalObject,
) -> JsResult<S3CredentialsWithOptions> {
    // TODO(port): analytics counter increment (`bun.analytics.Features.s3 += 1`)
    bun_analytics::Features::s3_add(1);
    // get ENV config
    let mut new_credentials = S3CredentialsWithOptions {
        credentials: this,
        options: default_options,
        acl: default_acl,
        storage_class: default_storage_class,
        request_payer: default_request_payer,
        ..Default::default()
    };
    // errdefer new_credentials.deinit() — handled by Drop on early return

    if let Some(opts) = options {
        if opts.is_object() {
            if let Some(js_value) = opts.get_truthy(global_object, "accessKeyId")? {
                if !js_value.is_empty_or_undefined_or_null() {
                    if js_value.is_string() {
                        let str = bstr::String::from_js(js_value, global_object)?;
                        if str.tag != bstr::Tag::Empty && str.tag != bstr::Tag::Dead {
                            new_credentials._access_key_id_slice = Some(str.to_utf8());
                            new_credentials.credentials.access_key_id =
                                new_credentials._access_key_id_slice.as_ref().unwrap().slice();
                            new_credentials.changed_credentials = true;
                        }
                    } else {
                        return Err(global_object.throw_invalid_argument_type_value("accessKeyId", "string", js_value));
                    }
                }
            }
            if let Some(js_value) = opts.get_truthy(global_object, "secretAccessKey")? {
                if !js_value.is_empty_or_undefined_or_null() {
                    if js_value.is_string() {
                        let str = bstr::String::from_js(js_value, global_object)?;
                        if str.tag != bstr::Tag::Empty && str.tag != bstr::Tag::Dead {
                            new_credentials._secret_access_key_slice = Some(str.to_utf8());
                            new_credentials.credentials.secret_access_key =
                                new_credentials._secret_access_key_slice.as_ref().unwrap().slice();
                            new_credentials.changed_credentials = true;
                        }
                    } else {
                        return Err(global_object.throw_invalid_argument_type_value("secretAccessKey", "string", js_value));
                    }
                }
            }
            if let Some(js_value) = opts.get_truthy(global_object, "region")? {
                if !js_value.is_empty_or_undefined_or_null() {
                    if js_value.is_string() {
                        let str = bstr::String::from_js(js_value, global_object)?;
                        if str.tag != bstr::Tag::Empty && str.tag != bstr::Tag::Dead {
                            new_credentials._region_slice = Some(str.to_utf8());
                            new_credentials.credentials.region =
                                new_credentials._region_slice.as_ref().unwrap().slice();
                            new_credentials.changed_credentials = true;
                        }
                    } else {
                        return Err(global_object.throw_invalid_argument_type_value("region", "string", js_value));
                    }
                }
            }
            if let Some(js_value) = opts.get_truthy(global_object, "endpoint")? {
                if !js_value.is_empty_or_undefined_or_null() {
                    if js_value.is_string() {
                        let str = bstr::String::from_js(js_value, global_object)?;
                        if str.tag != bstr::Tag::Empty && str.tag != bstr::Tag::Dead {
                            new_credentials._endpoint_slice = Some(str.to_utf8());
                            let endpoint = new_credentials._endpoint_slice.as_ref().unwrap().slice();
                            let url = URL::parse(endpoint);
                            let normalized_endpoint = url.host_with_path();
                            if !normalized_endpoint.is_empty() {
                                new_credentials.credentials.endpoint = normalized_endpoint;

                                // Default to https://
                                // Only use http:// if the endpoint specifically starts with 'http://'
                                new_credentials.credentials.insecure_http = url.is_http();

                                new_credentials.changed_credentials = true;
                            } else if !endpoint.is_empty() {
                                // endpoint is not a valid URL
                                return Err(global_object.throw_invalid_argument_type_value("endpoint", "string", js_value));
                            }
                        }
                    } else {
                        return Err(global_object.throw_invalid_argument_type_value("endpoint", "string", js_value));
                    }
                }
            }
            if let Some(js_value) = opts.get_truthy(global_object, "bucket")? {
                if !js_value.is_empty_or_undefined_or_null() {
                    if js_value.is_string() {
                        let str = bstr::String::from_js(js_value, global_object)?;
                        if str.tag != bstr::Tag::Empty && str.tag != bstr::Tag::Dead {
                            new_credentials._bucket_slice = Some(str.to_utf8());
                            new_credentials.credentials.bucket =
                                new_credentials._bucket_slice.as_ref().unwrap().slice();
                            new_credentials.changed_credentials = true;
                        }
                    } else {
                        return Err(global_object.throw_invalid_argument_type_value("bucket", "string", js_value));
                    }
                }
            }

            if let Some(virtual_hosted_style) = opts.get_boolean_strict(global_object, "virtualHostedStyle")? {
                new_credentials.credentials.virtual_hosted_style = virtual_hosted_style;
                new_credentials.changed_credentials = true;
            }

            if let Some(js_value) = opts.get_truthy(global_object, "sessionToken")? {
                if !js_value.is_empty_or_undefined_or_null() {
                    if js_value.is_string() {
                        let str = bstr::String::from_js(js_value, global_object)?;
                        if str.tag != bstr::Tag::Empty && str.tag != bstr::Tag::Dead {
                            new_credentials._session_token_slice = Some(str.to_utf8());
                            new_credentials.credentials.session_token =
                                new_credentials._session_token_slice.as_ref().unwrap().slice();
                            new_credentials.changed_credentials = true;
                        }
                    } else {
                        return Err(global_object.throw_invalid_argument_type_value("bucket", "string", js_value));
                    }
                }
            }

            if let Some(page_size) = opts.get_optional::<i64>(global_object, "pageSize")? {
                if page_size < i64::try_from(MultiPartUploadOptions::MIN_SINGLE_UPLOAD_SIZE).unwrap()
                    || page_size > i64::try_from(MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE).unwrap()
                {
                    // TODO(port): RangeErrorOptions struct shape
                    return Err(global_object.throw_range_error(
                        page_size,
                        bun_jsc::RangeErrorOptions {
                            min: Some(i64::try_from(MultiPartUploadOptions::MIN_SINGLE_UPLOAD_SIZE).unwrap()),
                            max: Some(i64::try_from(MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE).unwrap()),
                            field_name: "pageSize",
                        },
                    ));
                } else {
                    new_credentials.options.part_size = page_size.try_into().unwrap();
                }
            }
            if let Some(part_size) = opts.get_optional::<i64>(global_object, "partSize")? {
                if part_size < i64::try_from(MultiPartUploadOptions::MIN_SINGLE_UPLOAD_SIZE).unwrap()
                    || part_size > i64::try_from(MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE).unwrap()
                {
                    return Err(global_object.throw_range_error(
                        part_size,
                        bun_jsc::RangeErrorOptions {
                            min: Some(i64::try_from(MultiPartUploadOptions::MIN_SINGLE_UPLOAD_SIZE).unwrap()),
                            max: Some(i64::try_from(MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE).unwrap()),
                            field_name: "partSize",
                        },
                    ));
                } else {
                    new_credentials.options.part_size = part_size.try_into().unwrap();
                }
            }

            if let Some(queue_size) = opts.get_optional::<i32>(global_object, "queueSize")? {
                if queue_size < 1 {
                    return Err(global_object.throw_range_error(
                        queue_size,
                        bun_jsc::RangeErrorOptions {
                            min: Some(1),
                            max: None,
                            field_name: "queueSize",
                        },
                    ));
                } else {
                    new_credentials.options.queue_size =
                        queue_size.min(i32::from(u8::MAX)).try_into().unwrap();
                }
            }

            if let Some(retry) = opts.get_optional::<i32>(global_object, "retry")? {
                if retry < 0 || retry > 255 {
                    return Err(global_object.throw_range_error(
                        retry,
                        bun_jsc::RangeErrorOptions {
                            min: Some(0),
                            max: Some(255),
                            field_name: "retry",
                        },
                    ));
                } else {
                    new_credentials.options.retry = retry.try_into().unwrap();
                }
            }
            if let Some(acl) = opts.get_optional_enum::<ACL>(global_object, "acl")? {
                new_credentials.acl = Some(acl);
            }

            if let Some(storage_class) = opts.get_optional_enum::<StorageClass>(global_object, "storageClass")? {
                new_credentials.storage_class = Some(storage_class);
            }

            if let Some(js_value) = opts.get_truthy(global_object, "contentDisposition")? {
                if !js_value.is_empty_or_undefined_or_null() {
                    if js_value.is_string() {
                        let str = bstr::String::from_js(js_value, global_object)?;
                        if str.tag != bstr::Tag::Empty && str.tag != bstr::Tag::Dead {
                            new_credentials._content_disposition_slice = Some(str.to_utf8());
                            let slice = new_credentials._content_disposition_slice.as_ref().unwrap().slice();
                            if contains_newline_or_cr(slice) {
                                return Err(global_object.throw_invalid_arguments(
                                    "contentDisposition must not contain newline characters (CR/LF)",
                                ));
                            }
                            new_credentials.content_disposition = slice;
                        }
                    } else {
                        return Err(global_object.throw_invalid_argument_type_value("contentDisposition", "string", js_value));
                    }
                }
            }

            if let Some(js_value) = opts.get_truthy(global_object, "type")? {
                if !js_value.is_empty_or_undefined_or_null() {
                    if js_value.is_string() {
                        let str = bstr::String::from_js(js_value, global_object)?;
                        if str.tag != bstr::Tag::Empty && str.tag != bstr::Tag::Dead {
                            new_credentials._content_type_slice = Some(str.to_utf8());
                            let slice = new_credentials._content_type_slice.as_ref().unwrap().slice();
                            if contains_newline_or_cr(slice) {
                                return Err(global_object.throw_invalid_arguments(
                                    "type must not contain newline characters (CR/LF)",
                                ));
                            }
                            new_credentials.content_type = slice;
                        }
                    } else {
                        return Err(global_object.throw_invalid_argument_type_value("type", "string", js_value));
                    }
                }
            }

            if let Some(js_value) = opts.get_truthy(global_object, "contentEncoding")? {
                if !js_value.is_empty_or_undefined_or_null() {
                    if js_value.is_string() {
                        let str = bstr::String::from_js(js_value, global_object)?;
                        if str.tag != bstr::Tag::Empty && str.tag != bstr::Tag::Dead {
                            new_credentials._content_encoding_slice = Some(str.to_utf8());
                            let slice = new_credentials._content_encoding_slice.as_ref().unwrap().slice();
                            if contains_newline_or_cr(slice) {
                                return Err(global_object.throw_invalid_arguments(
                                    "contentEncoding must not contain newline characters (CR/LF)",
                                ));
                            }
                            new_credentials.content_encoding = slice;
                        }
                    } else {
                        return Err(global_object.throw_invalid_argument_type_value("contentEncoding", "string", js_value));
                    }
                }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/s3/credentials_jsc.zig (263 lines)
//   confidence: medium
//   todos:      4
//   notes:      self-referential struct (Utf8Slice stored + borrowed); throw_range_error options shape & analytics counter need Phase B wiring
// ──────────────────────────────────────────────────────────────────────────
