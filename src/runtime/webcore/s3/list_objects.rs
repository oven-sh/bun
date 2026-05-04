use std::borrow::Cow;

use bun_jsc::{JSGlobalObject, JSValue, JsResult, ZigString};
use bun_str::{self as bstr, strings, Utf8Slice};

pub struct S3ListObjectsOptions {
    // TODO(port): self-referential — these view fields borrow from the
    // corresponding `_field: Utf8Slice` below. In Zig the slice and its
    // backing storage are separate; in Rust callers should read
    // `self._field.as_ref().map(|s| s.slice())` instead. Kept as raw
    // pointers to preserve field order/structure for Phase-B diffing.
    pub continuation_token: Option<*const [u8]>,
    pub delimiter: Option<*const [u8]>,
    pub encoding_type: Option<*const [u8]>,
    pub fetch_owner: Option<bool>,
    pub max_keys: Option<i64>,
    pub prefix: Option<*const [u8]>,
    pub start_after: Option<*const [u8]>,

    // TODO(port): Utf8Slice<'_> lifetime — Zig's ZigString.Slice owns or
    // ref-holds its backing WTFStringImpl; model as 'static here and let
    // Phase B pick the real lifetime / collapse the dual fields.
    pub _continuation_token: Option<Utf8Slice<'static>>,
    pub _delimiter: Option<Utf8Slice<'static>>,
    pub _encoding_type: Option<Utf8Slice<'static>>,
    pub _prefix: Option<Utf8Slice<'static>>,
    pub _start_after: Option<Utf8Slice<'static>>,
}

// Zig deinit only forwarded to each Utf8Slice field's deinit; Rust handles
// that via field Drop, so no explicit `impl Drop` is needed here.

// PORT NOTE: result structs borrow slices out of the input `xml: &[u8]`
// passed to `parse_s3_list_objects_result`. The Zig code never frees these
// (they alias the request body buffer). Represented with an explicit `'a`
// even though PORTING.md prefers avoiding struct lifetimes in Phase A —
// the borrow is unambiguous and any other encoding (Box / raw ptr) would
// misrepresent ownership. Phase B: confirm caller keeps `xml` alive for
// the result's lifetime (it does — result is consumed by toJS before the
// response body is freed).

struct ObjectOwner<'a> {
    id: Option<&'a [u8]>,
    display_name: Option<&'a [u8]>,
}

struct ObjectRestoreStatus<'a> {
    is_restore_in_progress: Option<bool>,
    restore_expiry_date: Option<&'a [u8]>,
}

struct S3ListObjectsContents<'a> {
    key: &'a [u8],
    // Zig: ?bun.ptr.OwnedIn([]const u8, MaybeOwned(DefaultAllocator)) —
    // i.e. a maybe-owned slice. Cow<'a, [u8]> is the direct equivalent.
    etag: Option<Cow<'a, [u8]>>,
    checksum_type: Option<&'a [u8]>,
    checksum_algorithme: Option<&'a [u8]>,
    last_modified: Option<&'a [u8]>,
    object_size: Option<i64>,
    storage_class: Option<&'a [u8]>,
    owner: Option<ObjectOwner<'a>>,
    restore_status: Option<ObjectRestoreStatus<'a>>,
}

// Zig deinit only freed `etag` when owned; Cow handles that in Drop.

pub struct S3ListObjectsV2Result<'a> {
    pub name: Option<&'a [u8]>,
    pub prefix: Option<&'a [u8]>,
    pub key_count: Option<i64>,
    pub max_keys: Option<i64>,
    pub delimiter: Option<&'a [u8]>,
    pub encoding_type: Option<&'a [u8]>,
    pub is_truncated: Option<bool>,
    pub continuation_token: Option<&'a [u8]>,
    pub next_continuation_token: Option<&'a [u8]>,
    pub start_after: Option<&'a [u8]>,
    pub common_prefixes: Option<Vec<&'a [u8]>>,
    pub contents: Option<Vec<S3ListObjectsContents<'a>>>,
}

// Zig deinit freed `contents` items (etag) + the two ArrayLists. All handled
// by Drop on Vec / Cow; no explicit Drop impl needed.

impl<'a> S3ListObjectsV2Result<'a> {
    pub fn to_js(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let js_result = JSValue::create_empty_object(global_object, 0);

        if let Some(name) = self.name {
            js_result.put(
                global_object,
                ZigString::static_(b"name"),
                bstr::String::create_utf8_for_js(global_object, name)?,
            );
        }

        if let Some(prefix) = self.prefix {
            js_result.put(
                global_object,
                ZigString::static_(b"prefix"),
                bstr::String::create_utf8_for_js(global_object, prefix)?,
            );
        }

        if let Some(delimiter) = self.delimiter {
            js_result.put(
                global_object,
                ZigString::static_(b"delimiter"),
                bstr::String::create_utf8_for_js(global_object, delimiter)?,
            );
        }

        if let Some(start_after) = self.start_after {
            js_result.put(
                global_object,
                ZigString::static_(b"startAfter"),
                bstr::String::create_utf8_for_js(global_object, start_after)?,
            );
        }
        if let Some(encoding_type) = self.encoding_type {
            js_result.put(
                global_object,
                ZigString::static_(b"encodingType"),
                bstr::String::create_utf8_for_js(global_object, encoding_type)?,
            );
        }

        if let Some(continuation_token) = self.continuation_token {
            js_result.put(
                global_object,
                ZigString::static_(b"continuationToken"),
                bstr::String::create_utf8_for_js(global_object, continuation_token)?,
            );
        }

        if let Some(next_continuation_token) = self.next_continuation_token {
            js_result.put(
                global_object,
                ZigString::static_(b"nextContinuationToken"),
                bstr::String::create_utf8_for_js(global_object, next_continuation_token)?,
            );
        }

        if let Some(is_truncated) = self.is_truncated {
            js_result.put(
                global_object,
                ZigString::static_(b"isTruncated"),
                JSValue::from(is_truncated),
            );
        }

        if let Some(key_count) = self.key_count {
            js_result.put(
                global_object,
                ZigString::static_(b"keyCount"),
                JSValue::js_number(key_count),
            );
        }

        if let Some(max_keys) = self.max_keys {
            js_result.put(
                global_object,
                ZigString::static_(b"maxKeys"),
                JSValue::js_number(max_keys),
            );
        }

        if let Some(contents) = &self.contents {
            let js_contents = JSValue::create_empty_array(global_object, contents.len())?;

            for (i, item) in contents.iter().enumerate() {
                let object_info = JSValue::create_empty_object(global_object, 0);
                object_info.put(
                    global_object,
                    ZigString::static_(b"key"),
                    bstr::String::create_utf8_for_js(global_object, item.key)?,
                );

                if let Some(etag) = &item.etag {
                    object_info.put(
                        global_object,
                        ZigString::static_(b"eTag"),
                        bstr::String::create_utf8_for_js(global_object, etag.as_ref())?,
                    );
                }

                if let Some(checksum_algorithme) = item.checksum_algorithme {
                    object_info.put(
                        global_object,
                        ZigString::static_(b"checksumAlgorithme"),
                        bstr::String::create_utf8_for_js(global_object, checksum_algorithme)?,
                    );
                }

                if let Some(checksum_type) = item.checksum_type {
                    object_info.put(
                        global_object,
                        ZigString::static_(b"checksumType"),
                        bstr::String::create_utf8_for_js(global_object, checksum_type)?,
                    );
                }

                if let Some(last_modified) = item.last_modified {
                    object_info.put(
                        global_object,
                        ZigString::static_(b"lastModified"),
                        bstr::String::create_utf8_for_js(global_object, last_modified)?,
                    );
                }

                if let Some(object_size) = item.object_size {
                    object_info.put(
                        global_object,
                        ZigString::static_(b"size"),
                        JSValue::js_number(object_size),
                    );
                }

                if let Some(storage_class) = item.storage_class {
                    object_info.put(
                        global_object,
                        ZigString::static_(b"storageClass"),
                        bstr::String::create_utf8_for_js(global_object, storage_class)?,
                    );
                }

                if let Some(owner) = &item.owner {
                    let js_owner = JSValue::create_empty_object(global_object, 0);
                    if let Some(id) = owner.id {
                        js_owner.put(
                            global_object,
                            ZigString::static_(b"id"),
                            bstr::String::create_utf8_for_js(global_object, id)?,
                        );
                    }

                    if let Some(display_name) = owner.display_name {
                        js_owner.put(
                            global_object,
                            ZigString::static_(b"displayName"),
                            bstr::String::create_utf8_for_js(global_object, display_name)?,
                        );
                    }

                    object_info.put(global_object, ZigString::static_(b"owner"), js_owner);
                }

                js_contents.put_index(global_object, u32::try_from(i).unwrap(), object_info)?;
            }

            js_result.put(global_object, ZigString::static_(b"contents"), js_contents);
        }

        if let Some(common_prefixes) = &self.common_prefixes {
            let js_common_prefixes =
                JSValue::create_empty_array(global_object, common_prefixes.len())?;

            for (i, prefix) in common_prefixes.iter().enumerate() {
                let js_prefix = JSValue::create_empty_object(global_object, 0);
                js_prefix.put(
                    global_object,
                    ZigString::static_(b"prefix"),
                    bstr::String::create_utf8_for_js(global_object, prefix)?,
                );
                js_common_prefixes.put_index(global_object, u32::try_from(i).unwrap(), js_prefix)?;
            }

            js_result.put(
                global_object,
                ZigString::static_(b"commonPrefixes"),
                js_common_prefixes,
            );
        }

        Ok(js_result)
    }
}

// PORT NOTE: Zig signature was `!S3ListObjectsV2Result` but the only `try`
// sites were allocations (Vec::push / alloc) which abort on OOM in Rust, so
// this is now infallible.
pub fn parse_s3_list_objects_result(xml: &[u8]) -> S3ListObjectsV2Result<'_> {
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

    let mut contents: Vec<S3ListObjectsContents<'_>> = Vec::new();
    let mut common_prefixes: Vec<&[u8]> = Vec::new();

    // we dont use trailing ">" as it may finish with xmlns=...
    if let Some(delete_result_pos) = strings::index_of(xml, b"<ListBucketResult") {
        let mut i: usize = 0;
        while i < xml[delete_result_pos..].len() {
            if xml[i] != b'<' {
                i += 1;
                continue;
            }

            if let Some(end) = strings::index_of(&xml[i + 1..], b">") {
                i = i + 1;
                let tag_name_end_pos = i + end; // +1 for <

                let tag_name = &xml[i..tag_name_end_pos];
                i = tag_name_end_pos + 1; // +1 for >

                if tag_name == b"Contents" {
                    let mut looking_for_end_tag = true;

                    let mut object_key: Option<&[u8]> = None;
                    let mut last_modified: Option<&[u8]> = None;
                    let mut object_size: Option<i64> = None;
                    let mut storage_class: Option<&[u8]> = None;
                    let mut etag: Option<&[u8]> = None;
                    let mut etag_owned: Option<Vec<u8>> = None;
                    let mut checksum_type: Option<&[u8]> = None;
                    let mut checksum_algorithme: Option<&[u8]> = None;
                    let mut owner_id: Option<&[u8]> = None;
                    let mut owner_display_name: Option<&[u8]> = None;
                    let mut is_restore_in_progress: Option<bool> = None;
                    let mut restore_expiry_date: Option<&[u8]> = None;

                    while looking_for_end_tag {
                        if i >= xml.len() {
                            break;
                        }

                        if xml[i] == b'<' {
                            if let Some(__end) = strings::index_of(&xml[i + 1..], b">") {
                                let inner_tag_name_or_tag_end = &xml[i + 1..i + 1 + __end];

                                i = i + 2 + __end;

                                if inner_tag_name_or_tag_end == b"/Contents" {
                                    looking_for_end_tag = false;
                                } else if inner_tag_name_or_tag_end == b"Key" {
                                    if let Some(__tag_end) = strings::index_of(&xml[i..], b"</Key>")
                                    {
                                        object_key = Some(&xml[i..i + __tag_end]);
                                        i = i + __tag_end + 6;
                                    }
                                } else if inner_tag_name_or_tag_end == b"LastModified" {
                                    if let Some(__tag_end) =
                                        strings::index_of(&xml[i..], b"</LastModified>")
                                    {
                                        last_modified = Some(&xml[i..i + __tag_end]);
                                        i = i + __tag_end + 15;
                                    }
                                } else if inner_tag_name_or_tag_end == b"Size" {
                                    if let Some(__tag_end) =
                                        strings::index_of(&xml[i..], b"</Size>")
                                    {
                                        let size = &xml[i..i + __tag_end];

                                        object_size = parse_i64(size);
                                        i = i + __tag_end + 7;
                                    }
                                } else if inner_tag_name_or_tag_end == b"StorageClass" {
                                    if let Some(__tag_end) =
                                        strings::index_of(&xml[i..], b"</StorageClass>")
                                    {
                                        storage_class = Some(&xml[i..i + __tag_end]);
                                        i = i + __tag_end + 15;
                                    }
                                } else if inner_tag_name_or_tag_end == b"ChecksumType" {
                                    if let Some(__tag_end) =
                                        strings::index_of(&xml[i..], b"</ChecksumType>")
                                    {
                                        checksum_type = Some(&xml[i..i + __tag_end]);
                                        i = i + __tag_end + 15;
                                    }
                                } else if inner_tag_name_or_tag_end == b"ChecksumAlgorithm" {
                                    if let Some(__tag_end) =
                                        strings::index_of(&xml[i..], b"</ChecksumAlgorithm>")
                                    {
                                        checksum_algorithme = Some(&xml[i..i + __tag_end]);
                                        i = i + __tag_end + 20;
                                    }
                                } else if inner_tag_name_or_tag_end == b"ETag" {
                                    if let Some(__tag_end) =
                                        strings::index_of(&xml[i..], b"</ETag>")
                                    {
                                        let input = &xml[i..i + __tag_end];

                                        // std.mem.replacementSize / std.mem.replace
                                        // for "&quot;" → "\""
                                        // TODO(port): consider bun_str helper for byte-slice replace
                                        let needle: &[u8] = b"&quot;";
                                        let mut count = 0usize;
                                        {
                                            let mut k = 0usize;
                                            while let Some(p) =
                                                strings::index_of(&input[k..], needle)
                                            {
                                                count += 1;
                                                k += p + needle.len();
                                            }
                                        }
                                        let size = input.len() - count * (needle.len() - 1);
                                        let mut output = vec![0u8; size];
                                        // perform replacement
                                        {
                                            let mut src = 0usize;
                                            let mut dst = 0usize;
                                            while src < input.len() {
                                                if input[src..].starts_with(needle) {
                                                    output[dst] = b'"';
                                                    dst += 1;
                                                    src += needle.len();
                                                } else {
                                                    output[dst] = input[src];
                                                    dst += 1;
                                                    src += 1;
                                                }
                                            }
                                        }
                                        let len = count;

                                        if len != 0 {
                                            // 5 = "&quot;".len - 1 for replacement "
                                            output.truncate(input.len() - len * 5);
                                            etag_owned = Some(output);
                                            etag = None; // sentinel: owned path uses etag_owned
                                        } else {
                                            drop(output);
                                            etag = Some(input);
                                        }

                                        i = i + __tag_end + 7;
                                    }
                                } else if inner_tag_name_or_tag_end == b"Owner" {
                                    if let Some(__tag_end) =
                                        strings::index_of(&xml[i..], b"</Owner>")
                                    {
                                        let owner = &xml[i..i + __tag_end];
                                        i = i + __tag_end + 8;

                                        if let Some(id_start) = strings::index_of(owner, b"<ID>") {
                                            let id_start_pos = id_start + 4;
                                            if let Some(id_end) =
                                                strings::index_of(owner, b"</ID>")
                                            {
                                                let is_not_empty = id_start_pos < id_end;
                                                if is_not_empty {
                                                    owner_id = Some(&owner[id_start_pos..id_end]);
                                                }
                                            }
                                        }

                                        if let Some(id_start) =
                                            strings::index_of(owner, b"<DisplayName>")
                                        {
                                            let id_start_pos = id_start + 13;
                                            if let Some(id_end) =
                                                strings::index_of(owner, b"</DisplayName>")
                                            {
                                                let is_not_empty = id_start_pos < id_end;
                                                if is_not_empty {
                                                    owner_display_name =
                                                        Some(&owner[id_start_pos..id_end]);
                                                }
                                            }
                                        }
                                    }
                                } else if inner_tag_name_or_tag_end == b"RestoreStatus" {
                                    if let Some(__tag_end) =
                                        strings::index_of(&xml[i..], b"</RestoreStatus>")
                                    {
                                        let restore_status = &xml[i..i + __tag_end];
                                        i = i + __tag_end + 16;

                                        if let Some(start) = strings::index_of(
                                            restore_status,
                                            b"<IsRestoreInProgress>",
                                        ) {
                                            let start_pos = start + 21;
                                            if let Some(_end) = strings::index_of(
                                                restore_status,
                                                b"</IsRestoreInProgress>",
                                            ) {
                                                let is_not_empty = start_pos < _end;
                                                if is_not_empty {
                                                    let is_restore_in_progress_string =
                                                        &restore_status[start_pos.._end];

                                                    if is_restore_in_progress_string == b"true" {
                                                        is_restore_in_progress = Some(true);
                                                    } else if is_restore_in_progress_string
                                                        == b"false"
                                                    {
                                                        is_restore_in_progress = Some(false);
                                                    }
                                                }
                                            }
                                        }

                                        if let Some(start) = strings::index_of(
                                            restore_status,
                                            b"<RestoreExpiryDate>",
                                        ) {
                                            let start_pos = start + 19;
                                            if let Some(_end) = strings::index_of(
                                                restore_status,
                                                b"</RestoreExpiryDate>",
                                            ) {
                                                let is_not_empty = start_pos < _end;
                                                if is_not_empty {
                                                    restore_expiry_date =
                                                        Some(&restore_status[start_pos.._end]);
                                                }
                                            }
                                        }
                                    }
                                }
                            } else {
                                // char is not >
                                i += 1;
                            }
                        } else {
                            // char is not <
                            i += 1;
                        }
                    }

                    if let Some(object_key_val) = object_key {
                        let mut owner: Option<ObjectOwner<'_>> = None;

                        if owner_id.is_some() || owner_display_name.is_some() {
                            owner = Some(ObjectOwner {
                                id: owner_id,
                                display_name: owner_display_name,
                            });
                        }

                        let mut restore_status: Option<ObjectRestoreStatus<'_>> = None;

                        if is_restore_in_progress.is_some() || restore_expiry_date.is_some() {
                            restore_status = Some(ObjectRestoreStatus {
                                is_restore_in_progress,
                                restore_expiry_date,
                            });
                        }

                        contents.push(S3ListObjectsContents {
                            key: object_key_val,
                            etag: match (etag_owned, etag) {
                                (Some(owned), _) => Some(Cow::Owned(owned)),
                                (None, Some(borrowed)) => Some(Cow::Borrowed(borrowed)),
                                (None, None) => None,
                            },
                            checksum_type,
                            checksum_algorithme,
                            last_modified,
                            object_size,
                            storage_class,
                            owner,
                            restore_status,
                        });
                    }
                } else if tag_name == b"Name" {
                    if let Some(_end) = strings::index_of(&xml[i..], b"</Name>") {
                        result.name = Some(&xml[i..i + _end]);
                        i = i + _end;
                    }
                } else if tag_name == b"Delimiter" {
                    if let Some(_end) = strings::index_of(&xml[i..], b"</Delimiter>") {
                        result.delimiter = Some(&xml[i..i + _end]);
                        i = i + _end;
                    }
                } else if tag_name == b"NextContinuationToken" {
                    if let Some(_end) = strings::index_of(&xml[i..], b"</NextContinuationToken>") {
                        result.next_continuation_token = Some(&xml[i..i + _end]);
                        i = i + _end;
                    }
                } else if tag_name == b"ContinuationToken" {
                    if let Some(_end) = strings::index_of(&xml[i..], b"</ContinuationToken>") {
                        result.continuation_token = Some(&xml[i..i + _end]);
                        i = i + _end;
                    }
                } else if tag_name == b"StartAfter" {
                    if let Some(_end) = strings::index_of(&xml[i..], b"</StartAfter>") {
                        result.start_after = Some(&xml[i..i + _end]);
                        i = i + _end;
                    }
                } else if tag_name == b"EncodingType" {
                    if let Some(_end) = strings::index_of(&xml[i..], b"</EncodingType>") {
                        result.encoding_type = Some(&xml[i..i + _end]);
                        i = i + _end;
                    }
                } else if tag_name == b"KeyCount" {
                    if let Some(_end) = strings::index_of(&xml[i..], b"</KeyCount>") {
                        let key_count = &xml[i..i + _end];
                        result.key_count = parse_i64(key_count);

                        i = i + _end;
                    }
                } else if tag_name == b"MaxKeys" {
                    if let Some(_end) = strings::index_of(&xml[i..], b"</MaxKeys>") {
                        let max_keys = &xml[i..i + _end];
                        result.max_keys = parse_i64(max_keys);

                        i = i + _end;
                    }
                } else if tag_name == b"Prefix" {
                    if let Some(_end) = strings::index_of(&xml[i..], b"</Prefix>") {
                        let prefix = &xml[i..i + _end];

                        if !prefix.is_empty() {
                            result.prefix = Some(prefix);
                        }

                        i = i + _end;
                    }
                } else if tag_name == b"IsTruncated" {
                    if let Some(_end) = strings::index_of(&xml[i..], b"</IsTruncated>") {
                        let is_truncated = &xml[i..i + _end];

                        if is_truncated == b"true" {
                            result.is_truncated = Some(true);
                        } else if is_truncated == b"false" {
                            result.is_truncated = Some(false);
                        }

                        i = i + _end;
                    }
                } else if tag_name == b"CommonPrefixes" {
                    if let Some(_end) = strings::index_of(&xml[i..], b"</CommonPrefixes>") {
                        let common_prefixes_string = &xml[i..i + _end];
                        i = i + _end;

                        let mut j: usize = 0;
                        while j < common_prefixes_string.len() {
                            if let Some(start) =
                                strings::index_of(&common_prefixes_string[j..], b"<Prefix>")
                            {
                                j = j + start + 8;

                                if let Some(__end) =
                                    strings::index_of(&common_prefixes_string[j..], b"</Prefix>")
                                {
                                    common_prefixes.push(&common_prefixes_string[j..j + __end]);
                                    j = j + __end;
                                }
                            } else {
                                break;
                            }
                        }
                    }
                }
            } else {
                i += 1;
            }
        }

        if !contents.is_empty() {
            result.contents = Some(contents);
        }
        // else branch: Vec drops itself (Zig: contents.deinit())

        if !common_prefixes.is_empty() {
            result.common_prefixes = Some(common_prefixes);
        }
        // else branch: Vec drops itself
    }

    result
}

#[inline]
fn parse_i64(bytes: &[u8]) -> Option<i64> {
    // std.fmt.parseInt(i64, _, 10) catch null
    // Input is ASCII digit text from XML; from_utf8 failure maps to None just
    // like a Zig parse error would.
    core::str::from_utf8(bytes).ok()?.parse::<i64>().ok()
}

pub fn get_list_objects_options_from_js(
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

        _continuation_token: None,
        _delimiter: None,
        _encoding_type: None,
        _prefix: None,
        _start_after: None,
    };

    if !list_options.is_object() {
        return Ok(list_objects_options);
    }

    if let Some(val) = list_options.get_truthy(global_this, b"continuationToken")? {
        if val.is_string() {
            let str = bstr::String::from_js(val, global_this)?;

            // TODO(port): bun_str::String tag accessors (Empty/Dead)
            if !str.is_empty() && !str.is_dead() {
                let slice = str.to_utf8();
                list_objects_options.continuation_token = Some(slice.slice() as *const [u8]);
                list_objects_options._continuation_token = Some(slice);
            }
        }
    }

    if let Some(val) = list_options.get_truthy(global_this, b"delimiter")? {
        if val.is_string() {
            let str = bstr::String::from_js(val, global_this)?;

            if !str.is_empty() && !str.is_dead() {
                let slice = str.to_utf8();
                list_objects_options.delimiter = Some(slice.slice() as *const [u8]);
                list_objects_options._delimiter = Some(slice);
            }
        }
    }

    if let Some(val) = list_options.get_truthy(global_this, b"encodingType")? {
        if val.is_string() {
            let str = bstr::String::from_js(val, global_this)?;

            if !str.is_empty() && !str.is_dead() {
                let slice = str.to_utf8();
                list_objects_options.encoding_type = Some(slice.slice() as *const [u8]);
                list_objects_options._encoding_type = Some(slice);
            }
        }
    }

    if let Some(val) = list_options.get_boolean_loose(global_this, b"fetchOwner")? {
        list_objects_options.fetch_owner = Some(val);
    }

    if let Some(val) = list_options.get_truthy(global_this, b"maxKeys")? {
        if val.is_number() {
            list_objects_options.max_keys = Some(val.to_int32() as i64);
        }
    }

    if let Some(val) = list_options.get_truthy(global_this, b"prefix")? {
        if val.is_string() {
            let str = bstr::String::from_js(val, global_this)?;

            if !str.is_empty() && !str.is_dead() {
                let slice = str.to_utf8();
                list_objects_options.prefix = Some(slice.slice() as *const [u8]);
                list_objects_options._prefix = Some(slice);
            }
        }
    }

    if let Some(val) = list_options.get_truthy(global_this, b"startAfter")? {
        if val.is_string() {
            let str = bstr::String::from_js(val, global_this)?;

            if !str.is_empty() && !str.is_dead() {
                let slice = str.to_utf8();
                list_objects_options.start_after = Some(slice.slice() as *const [u8]);
                list_objects_options._start_after = Some(slice);
            }
        }
    }

    Ok(list_objects_options)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/s3/list_objects.zig (598 lines)
//   confidence: medium
//   todos:      4
//   notes:      S3ListObjectsOptions has self-referential view+backing field pairs (raw ptr placeholder); result structs use <'a> borrowing from xml input; std.mem.replace inlined for &quot; handling
// ──────────────────────────────────────────────────────────────────────────
