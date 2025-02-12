const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const strings = bun.strings;

pub const S3ListObjectsOptions = struct {
    continuation_token: ?[]const u8,
    delimiter: ?[]const u8,
    encoding_type: ?[]const u8,
    fetch_owner: ?bool,
    max_keys: ?i64,
    prefix: ?[]const u8,
    start_after: ?[]const u8,
};

const ObjectOwner = struct {
    id: ?[]const u8,
    display_name: ?[]const u8,
};

const ObjectRestoreStatus = struct {
    is_restore_in_progress: ?bool,
    restore_expiry_date: ?[]const u8,
};

const S3ListObjectsContents = struct {
    key: []const u8,
    etag: ?[]const u8,
    checksum_type: ?[]const u8,
    checksum_algorithme: ?[]const u8,
    last_modified: ?[]const u8,
    object_size: ?i64,
    storage_class: ?[]const u8,
    owner: ?ObjectOwner,
    restore_status: ?ObjectRestoreStatus,
};

pub const S3ListObjectsV2Result = struct {
    name: ?[]const u8,
    prefix: ?[]const u8,
    key_count: ?i64,
    max_keys: ?i64,
    delimiter: ?[]const u8,
    encoding_type: ?[]const u8,
    is_truncated: ?bool,
    continuation_token: ?[]const u8,
    next_continuation_token: ?[]const u8,
    start_after: ?[]const u8,
    common_prefixes: ?std.ArrayList([]const u8),
    contents: ?std.ArrayList(S3ListObjectsContents),

    pub fn deinit(this: @This()) void {
        if (this.contents) |contents| {
            contents.deinit();
        }
        if (this.common_prefixes) |common_prefixes| {
            common_prefixes.deinit();
        }
    }

    pub fn toJS(this: @This(), globalObject: *JSGlobalObject) JSValue {
        const jsResult = JSValue.createEmptyObject(globalObject, 12);

        if (this.name) |name| {
            jsResult.put(globalObject, JSC.ZigString.static("Name"), bun.String.init(name).toJS(globalObject));
        }

        if (this.prefix) |prefix| {
            jsResult.put(globalObject, JSC.ZigString.static("Prefix"), bun.String.init(prefix).toJS(globalObject));
        }

        if (this.delimiter) |delimiter| {
            jsResult.put(globalObject, JSC.ZigString.static("Delimiter"), bun.String.init(delimiter).toJS(globalObject));
        }

        if (this.start_after) |start_after| {
            jsResult.put(globalObject, JSC.ZigString.static("StartAfter"), bun.String.init(start_after).toJS(globalObject));
        }
        if (this.encoding_type) |encoding_type| {
            jsResult.put(globalObject, JSC.ZigString.static("EncodingType"), bun.String.init(encoding_type).toJS(globalObject));
        }

        if (this.continuation_token) |continuation_token| {
            jsResult.put(globalObject, JSC.ZigString.static("ContinuationToken"), bun.String.init(continuation_token).toJS(globalObject));
        }

        if (this.next_continuation_token) |next_continuation_token| {
            jsResult.put(globalObject, JSC.ZigString.static("NextContinuationToken"), bun.String.init(next_continuation_token).toJS(globalObject));
        }

        if (this.is_truncated) |is_truncated| {
            jsResult.put(globalObject, JSC.ZigString.static("IsTruncated"), JSValue.jsBoolean(is_truncated));
        }

        if (this.key_count) |key_count| {
            jsResult.put(globalObject, JSC.ZigString.static("KeyCount"), JSValue.jsNumber(key_count));
        }

        if (this.max_keys) |max_keys| {
            jsResult.put(globalObject, JSC.ZigString.static("MaxKeys"), JSValue.jsNumber(max_keys));
        }

        if (this.contents) |contents| {
            const jsContents = JSValue.createEmptyArray(globalObject, contents.items.len);

            for (contents.items, 0..) |item, i| {
                const objectInfo = JSValue.createEmptyObject(globalObject, 1);
                objectInfo.put(globalObject, JSC.ZigString.static("Key"), bun.String.init(item.key).toJS(globalObject));

                if (item.etag) |etag| {
                    objectInfo.put(globalObject, JSC.ZigString.static("ETag"), bun.String.init(etag).toJS(globalObject));
                }

                if (item.checksum_algorithme) |checksum_algorithme| {
                    objectInfo.put(globalObject, JSC.ZigString.static("ChecksumAlgorithme"), bun.String.init(checksum_algorithme).toJS(globalObject));
                }

                if (item.checksum_type) |checksum_type| {
                    objectInfo.put(globalObject, JSC.ZigString.static("ChecksumType"), bun.String.init(checksum_type).toJS(globalObject));
                }

                if (item.last_modified) |last_modified| {
                    objectInfo.put(globalObject, JSC.ZigString.static("LastModified"), bun.String.init(last_modified).toJS(globalObject));
                }

                if (item.object_size) |object_size| {
                    objectInfo.put(globalObject, JSC.ZigString.static("Size"), JSValue.jsNumber(object_size));
                }

                if (item.storage_class) |storage_class| {
                    objectInfo.put(globalObject, JSC.ZigString.static("StorageClass"), bun.String.init(storage_class).toJS(globalObject));
                }

                if (item.owner) |owner| {
                    const jsOwner = JSValue.createEmptyObject(globalObject, 2);
                    if (owner.id) |id| {
                        jsOwner.put(globalObject, JSC.ZigString.static("Id"), bun.String.init(id).toJS(globalObject));
                    }

                    if (owner.display_name) |display_name| {
                        jsOwner.put(globalObject, JSC.ZigString.static("DisplayName"), bun.String.init(display_name).toJS(globalObject));
                    }

                    objectInfo.put(globalObject, JSC.ZigString.static("Owner"), jsOwner);
                }

                jsContents.putIndex(globalObject, @intCast(i), objectInfo);
            }

            jsResult.put(globalObject, JSC.ZigString.static("Contents"), jsContents);
        }

        if (this.common_prefixes) |common_prefixes| {
            const jsCommonPrefixes = JSValue.createEmptyArray(globalObject, common_prefixes.items.len);

            for (common_prefixes.items, 0..) |prefix, i| {
                const jsPrefix = JSValue.createEmptyObject(globalObject, 1);
                jsPrefix.put(globalObject, JSC.ZigString.static("Prefix"), bun.String.init(prefix).toJS(globalObject));
                jsCommonPrefixes.putIndex(globalObject, @intCast(i), jsPrefix);
            }

            jsResult.put(globalObject, JSC.ZigString.static("CommonPrefixes"), jsCommonPrefixes);
        }

        return jsResult;
    }
};

pub fn parseS3ListObjectsResult(xml: []const u8) !S3ListObjectsV2Result {
    var result: S3ListObjectsV2Result = .{
        .contents = null,
        .common_prefixes = null,
        .continuation_token = null,
        .delimiter = null,
        .encoding_type = null,
        .is_truncated = null,
        .key_count = null,
        .max_keys = null,
        .name = null,
        .next_continuation_token = null,
        .prefix = null,
        .start_after = null,
    };

    var contents = std.ArrayList(S3ListObjectsContents).init(bun.default_allocator);
    var common_prefixes = std.ArrayList([]const u8).init(bun.default_allocator);

    // we dont use trailing ">" as it may finish with xmlns=...
    if (strings.indexOf(xml, "<ListBucketResult")) |delete_result_pos| {
        var i: usize = 0;
        while (i < xml[delete_result_pos..].len) {
            if (xml[i] != '<') {
                i += 1;
                continue;
            }

            if (strings.indexOf(xml[i + 1 ..], ">")) |end| {
                i = i + 1;
                const tag_name_end_pos = i + end; // +1 for <

                const tagName = xml[i..tag_name_end_pos];
                i = tag_name_end_pos + 1; // +1 for >

                if (strings.eql(tagName, "Contents")) {
                    var looking_for_end_tag = true;

                    var object_key: ?[]const u8 = null;
                    var last_modified: ?[]const u8 = null;
                    var object_size: ?i64 = null;
                    var storage_class: ?[]const u8 = null;
                    var etag: ?[]const u8 = null;
                    var checksum_type: ?[]const u8 = null;
                    var checksum_algorithme: ?[]const u8 = null;
                    var owner_id: ?[]const u8 = null;
                    var owner_display_name: ?[]const u8 = null;
                    var is_restore_in_progress: ?bool = null;
                    var restore_expiry_date: ?[]const u8 = null;

                    while (looking_for_end_tag) {
                        if (i >= xml.len) {
                            break;
                        }

                        if (xml[i] == '<') {
                            if (strings.indexOf(xml[i + 1 ..], ">")) |__end| {
                                const inner_tag_name_or_tag_end = xml[i + 1 .. i + 1 + __end];

                                i = i + 2 + __end;

                                if (strings.eql(inner_tag_name_or_tag_end, "/Contents")) {
                                    looking_for_end_tag = false;
                                } else if (strings.eql(inner_tag_name_or_tag_end, "Key")) {
                                    if (strings.indexOf(xml[i..], "</Key>")) |__tag_end| {
                                        object_key = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 6;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "LastModified")) {
                                    if (strings.indexOf(xml[i..], "</LastModified>")) |__tag_end| {
                                        last_modified = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 15;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "Size")) {
                                    if (strings.indexOf(xml[i..], "</Size>")) |__tag_end| {
                                        const size = xml[i .. i + __tag_end];

                                        object_size = std.fmt.parseInt(i64, size, 10) catch null;
                                        i = i + __tag_end + 7;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "StorageClass")) {
                                    if (strings.indexOf(xml[i..], "</StorageClass>")) |__tag_end| {
                                        storage_class = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 15;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "ChecksumType")) {
                                    if (strings.indexOf(xml[i..], "</ChecksumType>")) |__tag_end| {
                                        checksum_type = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 15;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "ChecksumAlgorithm")) {
                                    if (strings.indexOf(xml[i..], "</ChecksumAlgorithm>")) |__tag_end| {
                                        checksum_algorithme = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 20;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "ETag")) {
                                    if (strings.indexOf(xml[i..], "</ETag>")) |__tag_end| {
                                        const input = xml[i .. i + __tag_end];

                                        const size = std.mem.replacementSize(u8, input, "&quot;", "\"");
                                        var output = try bun.default_allocator.alloc(u8, size);

                                        const len = std.mem.replace(u8, input, "&quot;", "\"", output);

                                        if (len != 0) {
                                            etag = output[0 .. input.len - len * 5]; // 5 = "&quot;".len - 1 for replacement "
                                        } else {
                                            etag = input;
                                        }

                                        i = i + __tag_end + 7;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "Owner")) {
                                    if (strings.indexOf(xml[i..], "</Owner>")) |__tag_end| {
                                        const owner = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 8;

                                        if (strings.indexOf(owner, "<ID>")) |id_start| {
                                            const id_start_pos = id_start + 4;
                                            if (strings.indexOf(owner, "</ID>")) |id_end| {
                                                const isNotEmpty = id_start_pos < id_end;
                                                if (isNotEmpty) {
                                                    owner_id = owner[id_start_pos..id_end];
                                                }
                                            }
                                        }

                                        if (strings.indexOf(owner, "<DisplayName>")) |id_start| {
                                            const id_start_pos = id_start + 13;
                                            if (strings.indexOf(owner, "</DisplayName>")) |id_end| {
                                                const isNotEmpty = id_start_pos < id_end;
                                                if (isNotEmpty) {
                                                    owner_display_name = owner[id_start_pos..id_end];
                                                }
                                            }
                                        }
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "RestoreStatus")) {
                                    if (strings.indexOf(xml[i..], "</RestoreStatus>")) |__tag_end| {
                                        const restore_status = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 16;

                                        if (strings.indexOf(restore_status, "<IsRestoreInProgress>")) |start| {
                                            const start_pos = start + 21;
                                            if (strings.indexOf(restore_status, "</IsRestoreInProgress>")) |_end| {
                                                const isNotEmpty = start_pos < _end;
                                                if (isNotEmpty) {
                                                    const is_restore_in_progress_string = restore_status[start_pos.._end];

                                                    if (strings.eql(is_restore_in_progress_string, "true")) {
                                                        is_restore_in_progress = true;
                                                    } else if (strings.eql(is_restore_in_progress_string, "false")) {
                                                        is_restore_in_progress = false;
                                                    }
                                                }
                                            }
                                        }

                                        if (strings.indexOf(restore_status, "<RestoreExpiryDate>")) |start| {
                                            const start_pos = start + 19;
                                            if (strings.indexOf(restore_status, "</RestoreExpiryDate>")) |_end| {
                                                const isNotEmpty = start_pos < _end;
                                                if (isNotEmpty) {
                                                    restore_expiry_date = restore_status[start_pos.._end];
                                                }
                                            }
                                        }
                                    }
                                }
                            } else { // char is not >
                                i += 1;
                            }
                        } else { // char is not <
                            i += 1;
                        }
                    }

                    if (object_key) |object_key_val| {
                        var owner: ?ObjectOwner = null;

                        if (owner_id != null or owner_display_name != null) {
                            owner = .{
                                .id = owner_id,
                                .display_name = owner_display_name,
                            };
                        }

                        var restore_status: ?ObjectRestoreStatus = null;

                        if (is_restore_in_progress != null or restore_expiry_date != null) {
                            restore_status = .{
                                .is_restore_in_progress = is_restore_in_progress,
                                .restore_expiry_date = restore_expiry_date,
                            };
                        }

                        try contents.append(.{
                            .key = object_key_val,
                            .etag = etag,
                            .checksum_type = checksum_type,
                            .checksum_algorithme = checksum_algorithme,
                            .last_modified = last_modified,
                            .object_size = object_size,
                            .storage_class = storage_class,
                            .owner = owner,
                            .restore_status = restore_status,
                        });
                    }
                } else if (strings.eql(tagName, "Name")) {
                    if (strings.indexOf(xml[i..], "</Name>")) |_end| {
                        result.name = xml[i .. i + _end];
                        i = i + _end;
                    }
                } else if (strings.eql(tagName, "Delimiter")) {
                    if (strings.indexOf(xml[i..], "</Delimiter>")) |_end| {
                        result.delimiter = xml[i .. i + _end];
                        i = i + _end;
                    }
                } else if (strings.eql(tagName, "NextContinuationToken")) {
                    if (strings.indexOf(xml[i..], "</NextContinuationToken>")) |_end| {
                        result.next_continuation_token = xml[i .. i + _end];
                        i = i + _end;
                    }
                } else if (strings.eql(tagName, "ContinuationToken")) {
                    if (strings.indexOf(xml[i..], "</ContinuationToken>")) |_end| {
                        result.continuation_token = xml[i .. i + _end];
                        i = i + _end;
                    }
                } else if (strings.eql(tagName, "StartAfter")) {
                    if (strings.indexOf(xml[i..], "</StartAfter>")) |_end| {
                        result.start_after = xml[i .. i + _end];
                        i = i + _end;
                    }
                } else if (strings.eql(tagName, "EncodingType")) {
                    if (strings.indexOf(xml[i..], "</EncodingType>")) |_end| {
                        result.encoding_type = xml[i .. i + _end];
                        i = i + _end;
                    }
                } else if (strings.eql(tagName, "KeyCount")) {
                    if (strings.indexOf(xml[i..], "</KeyCount>")) |_end| {
                        const key_count = xml[i .. i + _end];
                        result.key_count = std.fmt.parseInt(i64, key_count, 10) catch null;

                        i = i + _end;
                    }
                } else if (strings.eql(tagName, "MaxKeys")) {
                    if (strings.indexOf(xml[i..], "</MaxKeys>")) |_end| {
                        const max_keys = xml[i .. i + _end];
                        result.max_keys = std.fmt.parseInt(i64, max_keys, 10) catch null;

                        i = i + _end;
                    }
                } else if (strings.eql(tagName, "Prefix")) {
                    if (strings.indexOf(xml[i..], "</Prefix>")) |_end| {
                        const prefix = xml[i .. i + _end];

                        if (prefix.len != 0) {
                            result.prefix = prefix;
                        }

                        i = i + _end;
                    }
                } else if (strings.eql(tagName, "IsTruncated")) {
                    if (strings.indexOf(xml[i..], "</IsTruncated>")) |_end| {
                        const is_truncated = xml[i .. i + _end];

                        if (strings.eql(is_truncated, "true")) {
                            result.is_truncated = true;
                        } else if (strings.eql(is_truncated, "false")) {
                            result.is_truncated = false;
                        }

                        i = i + _end;
                    }
                } else if (strings.eql(tagName, "CommonPrefixes")) {
                    if (strings.indexOf(xml[i..], "</CommonPrefixes>")) |_end| {
                        const common_prefixes_string = xml[i .. i + _end];
                        i = i + _end;

                        var j: usize = 0;
                        while (j < common_prefixes_string.len) {
                            if (strings.indexOf(common_prefixes_string[j..], "<Prefix>")) |start| {
                                j = j + start + 8;

                                if (strings.indexOf(common_prefixes_string[j..], "</Prefix>")) |__end| {
                                    try common_prefixes.append(common_prefixes_string[j .. j + __end]);
                                    j = j + __end;
                                }
                            } else {
                                break;
                            }
                        }
                    }
                } else {
                    i += 1;
                }
            } else {
                i += 1;
            }
        }

        if (contents.items.len != 0) {
            result.contents = contents;
        } else {
            contents.deinit();
        }

        if (common_prefixes.items.len != 0) {
            result.common_prefixes = common_prefixes;
        } else {
            common_prefixes.deinit();
        }
    }

    return result;
}

pub fn getListObjectsOptionsFromJS(globalThis: *JSC.JSGlobalObject, listOptions: JSValue) !S3ListObjectsOptions {
    var listObjectsOptions: S3ListObjectsOptions = .{
        .continuation_token = null,
        .delimiter = null,
        .encoding_type = null,
        .fetch_owner = null,
        .max_keys = null,
        .prefix = null,
        .start_after = null,
    };

    if (!listOptions.isObject()) {
        return listObjectsOptions;
    }

    if (try listOptions.getTruthyComptime(globalThis, "ContinuationToken")) |val| {
        if (val.isString()) {
            var zig_val: JSC.ZigString = JSC.ZigString.Empty;
            val.toZigString(&zig_val, globalThis);

            listObjectsOptions.continuation_token = zig_val.slice();
        }
    }

    if (try listOptions.getTruthyComptime(globalThis, "Delimiter")) |val| {
        if (val.isString()) {
            var zig_val: JSC.ZigString = JSC.ZigString.Empty;
            val.toZigString(&zig_val, globalThis);

            listObjectsOptions.delimiter = zig_val.slice();
        }
    }

    if (try listOptions.getTruthyComptime(globalThis, "EncodingType")) |val| {
        if (val.isString()) {
            var zig_val: JSC.ZigString = JSC.ZigString.Empty;
            val.toZigString(&zig_val, globalThis);

            listObjectsOptions.encoding_type = zig_val.slice();
        }
    }

    if (try listOptions.getBooleanLoose(globalThis, "FetchOwner")) |val| {
        listObjectsOptions.fetch_owner = val;
    }

    if (try listOptions.getTruthyComptime(globalThis, "MaxKeys")) |val| {
        if (val.isNumber()) {
            listObjectsOptions.max_keys = val.toInt32();
        }
    }

    if (try listOptions.getTruthyComptime(globalThis, "Prefix")) |val| {
        if (val.isString()) {
            var zig_val: JSC.ZigString = JSC.ZigString.Empty;
            val.toZigString(&zig_val, globalThis);

            listObjectsOptions.prefix = zig_val.slice();
        }
    }

    if (try listOptions.getTruthyComptime(globalThis, "StartAfter")) |val| {
        if (val.isString()) {
            var zig_val: JSC.ZigString = JSC.ZigString.Empty;
            val.toZigString(&zig_val, globalThis);

            listObjectsOptions.start_after = zig_val.slice();
        }
    }

    return listObjectsOptions;
}
