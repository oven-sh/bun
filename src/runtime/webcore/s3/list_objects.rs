use bun_jsc::bun_string_jsc::create_utf8_for_js;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
// Shared S3 option-string ladder (get_truthy → is_string → from_js → to_utf8).
use super::__s3_credentials_jsc::get_truthy_string_utf8;
use super::s3::xml_response;
use bun_core::ZigStringSlice as Utf8Slice;

pub struct S3ListObjectsOptions {
    // Each `Utf8Slice` owns (or ref-holds) its backing storage; readers go
    // through `.slice()`.
    pub(crate) continuation_token: Option<Utf8Slice>,
    pub(crate) delimiter: Option<Utf8Slice>,
    pub(crate) encoding_type: Option<Utf8Slice>,
    pub(crate) fetch_owner: Option<bool>,
    pub(crate) max_keys: Option<i64>,
    pub(crate) prefix: Option<Utf8Slice>,
    pub(crate) start_after: Option<Utf8Slice>,
}

// Each Utf8Slice field cleans up via Drop, so no explicit `impl Drop` is
// needed here.

// The result structs borrow from the parsed response document handed to
// `parse_s3_list_objects_result`; the caller consumes them (toJS) inside
// that document's scope.

struct ObjectOwner<'a> {
    id: Option<&'a [u8]>,
    display_name: Option<&'a [u8]>,
}

pub struct S3ListObjectsContents<'a> {
    key: &'a [u8],
    etag: Option<&'a [u8]>,
    checksum_type: Option<&'a [u8]>,
    checksum_algorithm: Option<&'a [u8]>,
    last_modified: Option<&'a [u8]>,
    object_size: Option<i64>,
    storage_class: Option<&'a [u8]>,
    owner: Option<ObjectOwner<'a>>,
}

pub struct S3ListObjectsV2Result<'a> {
    pub name: Option<&'a [u8]>,
    pub(crate) prefix: Option<&'a [u8]>,
    pub(crate) key_count: Option<i64>,
    pub(crate) max_keys: Option<i64>,
    pub(crate) delimiter: Option<&'a [u8]>,
    pub(crate) encoding_type: Option<&'a [u8]>,
    pub(crate) is_truncated: Option<bool>,
    pub(crate) continuation_token: Option<&'a [u8]>,
    pub(crate) next_continuation_token: Option<&'a [u8]>,
    pub(crate) start_after: Option<&'a [u8]>,
    pub(crate) common_prefixes: Option<Vec<&'a [u8]>>,
    pub(crate) contents: Option<Vec<S3ListObjectsContents<'a>>>,
}

impl<'a> S3ListObjectsV2Result<'a> {
    pub(crate) fn to_js(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let js_result = JSValue::create_empty_object(global_object, 0);

        js_result.put_optional_utf8(global_object, b"name", self.name)?;
        js_result.put_optional_utf8(global_object, b"prefix", self.prefix)?;
        js_result.put_optional_utf8(global_object, b"delimiter", self.delimiter)?;
        js_result.put_optional_utf8(global_object, b"startAfter", self.start_after)?;
        js_result.put_optional_utf8(global_object, b"encodingType", self.encoding_type)?;
        js_result.put_optional_utf8(
            global_object,
            b"continuationToken",
            self.continuation_token,
        )?;
        js_result.put_optional_utf8(
            global_object,
            b"nextContinuationToken",
            self.next_continuation_token,
        )?;
        js_result.put_optional(global_object, b"isTruncated", self.is_truncated);
        js_result.put_optional(global_object, b"keyCount", self.key_count.map(|n| n as f64));
        js_result.put_optional(global_object, b"maxKeys", self.max_keys.map(|n| n as f64));

        if let Some(contents) = &self.contents {
            let js_contents = JSValue::create_empty_array(global_object, contents.len())?;

            for (i, item) in contents.iter().enumerate() {
                let object_info = JSValue::create_empty_object(global_object, 0);
                object_info.put(
                    global_object,
                    b"key",
                    create_utf8_for_js(global_object, item.key)?,
                );

                object_info.put_optional_utf8(global_object, b"eTag", item.etag)?;
                if let Some(algorithm) = item.checksum_algorithm {
                    let js_algorithm = create_utf8_for_js(global_object, algorithm)?;
                    object_info.put(global_object, b"checksumAlgorithm", js_algorithm);
                    // Back-compat alias for the original misspelling (#19142).
                    object_info.put_non_enumerable(
                        global_object,
                        b"checksumAlgorithme",
                        js_algorithm,
                    );
                }
                object_info.put_optional_utf8(
                    global_object,
                    b"checksumType",
                    item.checksum_type,
                )?;
                object_info.put_optional_utf8(
                    global_object,
                    b"lastModified",
                    item.last_modified,
                )?;
                object_info.put_optional(
                    global_object,
                    b"size",
                    item.object_size.map(|n| n as f64),
                );
                object_info.put_optional_utf8(
                    global_object,
                    b"storageClass",
                    item.storage_class,
                )?;

                if let Some(owner) = &item.owner {
                    let js_owner = JSValue::create_empty_object(global_object, 0);
                    js_owner.put_optional_utf8(global_object, b"id", owner.id)?;
                    js_owner.put_optional_utf8(
                        global_object,
                        b"displayName",
                        owner.display_name,
                    )?;
                    object_info.put(global_object, b"owner", js_owner);
                }

                js_contents.put_index(
                    global_object,
                    u32::try_from(i).expect("int cast"),
                    object_info,
                )?;
            }

            js_result.put(global_object, b"contents", js_contents);
        }

        if let Some(common_prefixes) = &self.common_prefixes {
            let js_common_prefixes =
                JSValue::create_empty_array(global_object, common_prefixes.len())?;

            for (i, prefix) in common_prefixes.iter().enumerate() {
                let js_prefix = JSValue::create_empty_object(global_object, 0);
                js_prefix.put(
                    global_object,
                    b"prefix",
                    create_utf8_for_js(global_object, prefix)?,
                );
                js_common_prefixes.put_index(
                    global_object,
                    u32::try_from(i).expect("int cast"),
                    js_prefix,
                )?;
            }

            js_result.put(global_object, b"commonPrefixes", js_common_prefixes);
        }

        Ok(js_result)
    }
}

/// Reads a `ListObjectsV2` response's `<ListBucketResult>`; the result
/// borrows from it.
pub(crate) fn parse_s3_list_objects_result<'a>(
    root: xml_response::Node<'a>,
) -> S3ListObjectsV2Result<'a> {
    let mut result = S3ListObjectsV2Result {
        contents: None,
        common_prefixes: None,
        continuation_token: None,
        delimiter: None,
        encoding_type: None,
        is_truncated: None,
        key_count: None,
        max_keys: None,
        name: None,
        next_continuation_token: None,
        prefix: None,
        start_after: None,
    };
    result.name = root.child_text(b"Name");
    result.prefix = root.child_text(b"Prefix").filter(|p| !p.is_empty());
    result.delimiter = root.child_text(b"Delimiter");
    result.start_after = root.child_text(b"StartAfter");
    result.encoding_type = root.child_text(b"EncodingType");
    result.continuation_token = root.child_text(b"ContinuationToken");
    result.next_continuation_token = root.child_text(b"NextContinuationToken");
    result.is_truncated = root.child_bool(b"IsTruncated");
    result.key_count = root.child_i64(b"KeyCount");
    result.max_keys = root.child_i64(b"MaxKeys");

    let contents: Vec<S3ListObjectsContents<'a>> = root
        .children(b"Contents")
        .filter_map(|object| {
            Some(S3ListObjectsContents {
                key: object.child_text(b"Key")?,
                etag: object.child_text(b"ETag"),
                checksum_type: object.child_text(b"ChecksumType"),
                checksum_algorithm: object.child_text(b"ChecksumAlgorithm"),
                last_modified: object.child_text(b"LastModified"),
                object_size: object.child_i64(b"Size"),
                storage_class: object.child_text(b"StorageClass"),
                owner: object.child(b"Owner").and_then(|owner| {
                    let id = owner.child_text(b"ID").filter(|s| !s.is_empty());
                    let display_name = owner.child_text(b"DisplayName").filter(|s| !s.is_empty());
                    (id.is_some() || display_name.is_some())
                        .then_some(ObjectOwner { id, display_name })
                }),
            })
        })
        .collect();
    if !contents.is_empty() {
        result.contents = Some(contents);
    }

    let common_prefixes: Vec<&'a [u8]> = root
        .children(b"CommonPrefixes")
        .flat_map(|entry| entry.children(b"Prefix"))
        .map(xml_response::Node::text)
        .filter(|prefix| !prefix.is_empty())
        .collect();
    if !common_prefixes.is_empty() {
        result.common_prefixes = Some(common_prefixes);
    }
    result
}

pub(crate) fn get_list_objects_options_from_js(
    global_this: &JSGlobalObject,
    list_options: JSValue,
) -> JsResult<S3ListObjectsOptions> {
    let mut list_objects_options = S3ListObjectsOptions {
        continuation_token: None,
        delimiter: None,
        encoding_type: None,
        fetch_owner: None,
        max_keys: None,
        prefix: None,
        start_after: None,
    };

    if !list_options.is_object() {
        return Ok(list_objects_options);
    }

    if let Some(slice) =
        get_truthy_string_utf8(list_options, global_this, b"continuationToken", false)?
    {
        list_objects_options.continuation_token = Some(slice);
    }

    if let Some(slice) = get_truthy_string_utf8(list_options, global_this, b"delimiter", false)? {
        list_objects_options.delimiter = Some(slice);
    }

    if let Some(slice) = get_truthy_string_utf8(list_options, global_this, b"encodingType", false)?
    {
        list_objects_options.encoding_type = Some(slice);
    }

    // `JSValue::get_boolean_loose` is not yet exposed in bun_jsc; emulate via
    // `get_truthy` + `to_boolean()`.
    if let Some(val) = list_options.get_truthy(global_this, b"fetchOwner")? {
        list_objects_options.fetch_owner = Some(val.to_boolean());
    }

    if let Some(val) = list_options.get_truthy(global_this, b"maxKeys")? {
        if val.is_number() {
            list_objects_options.max_keys = Some(val.to_int32() as i64);
        }
    }

    if let Some(slice) = get_truthy_string_utf8(list_options, global_this, b"prefix", false)? {
        list_objects_options.prefix = Some(slice);
    }

    if let Some(slice) = get_truthy_string_utf8(list_options, global_this, b"startAfter", false)? {
        list_objects_options.start_after = Some(slice);
    }

    Ok(list_objects_options)
}
