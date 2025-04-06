const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const strings = bun.strings;

const S3SuccessfullyDeleted = struct {
    key: []const u8,
    deleteMarker: ?bool,
    deleteMarkerVersionId: ?[]const u8,
    versionId: ?[]const u8,
};

const S3DeleteObjectsPartialError = struct {
    key: ?[]const u8,
    versionId: ?[]const u8,
    code: ?[]const u8,
    message: ?[]const u8,
};

pub const S3DeleteObjectsSuccessResult = struct {
    deleted: ?std.ArrayList(S3SuccessfullyDeleted),
    errors: ?std.ArrayList(S3DeleteObjectsPartialError),

    pub fn deinit(this: @This()) void {
        if (this.deleted) |deleted| {
            deleted.deinit();
        }
        if (this.errors) |errors| {
            errors.deinit();
        }
    }

    pub fn toJS(this: @This(), globalObject: *JSGlobalObject) JSValue {
        const jsResult = JSValue.createEmptyObject(globalObject, 2);

        if (this.deleted) |del| {
            const array = JSValue.createEmptyArray(globalObject, del.items.len);

            for (del.items, 0..) |item, i| {
                const deletedObject = JSValue.createEmptyObject(globalObject, 1);

                deletedObject.put(globalObject, JSC.ZigString.static("key"), bun.String.createUTF8ForJS(globalObject, item.key));

                if (item.versionId) |version_id| {
                    deletedObject.put(globalObject, JSC.ZigString.static("versionId"), bun.String.createUTF8ForJS(globalObject, version_id));
                }

                if (item.deleteMarker) |deleteMarker| {
                    deletedObject.put(globalObject, JSC.ZigString.static("deleteMarker"), JSValue.jsBoolean(deleteMarker));
                }

                if (item.deleteMarkerVersionId) |deleteMarkerVersionId| {
                    deletedObject.put(globalObject, JSC.ZigString.static("deleteMarkerVersionId"), bun.String.createUTF8ForJS(globalObject, deleteMarkerVersionId));
                }

                array.putIndex(globalObject, @intCast(i), deletedObject);
            }

            jsResult.put(globalObject, JSC.ZigString.static("deleted"), array);
        }

        if (this.errors) |errors| {
            const array = JSValue.createEmptyArray(globalObject, errors.items.len);

            for (errors.items, 0..) |item, i| {
                const failedObject = JSValue.createEmptyObject(globalObject, 1);

                if (item.key) |key| {
                    failedObject.put(globalObject, JSC.ZigString.static("key"), bun.String.createUTF8ForJS(globalObject, key));
                }

                if (item.versionId) |version_id| {
                    failedObject.put(globalObject, JSC.ZigString.static("versionId"), bun.String.createUTF8ForJS(globalObject, version_id));
                }

                if (item.code) |code| {
                    failedObject.put(globalObject, JSC.ZigString.static("code"), bun.String.createUTF8ForJS(globalObject, code));
                }

                if (item.message) |message| {
                    failedObject.put(globalObject, JSC.ZigString.static("message"), bun.String.createUTF8ForJS(globalObject, message));
                }

                array.putIndex(globalObject, @intCast(i), failedObject);
            }

            jsResult.put(globalObject, JSC.ZigString.static("errors"), array);
        }

        return jsResult;
    }
};

pub fn parseS3DeleteObjectsSuccessResult(xml: []u8) !S3DeleteObjectsSuccessResult {
    var result: S3DeleteObjectsSuccessResult = .{ .deleted = null, .errors = null };

    var succesfullyDeleted = std.ArrayList(S3SuccessfullyDeleted).init(bun.default_allocator);
    var partialErrors = std.ArrayList(S3DeleteObjectsPartialError).init(bun.default_allocator);

    // we dont use trailing ">" as it may finish with xmlns=...
    if (strings.indexOf(xml, "<DeleteResult")) |delete_result_pos| {
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

                if (strings.eql(tagName, "Deleted")) {
                    var looking_for_end_tag = true;

                    var object_key: ?[]const u8 = null;
                    var object_versionId: ?[]const u8 = null;
                    var object_deleteMarker: ?bool = null;
                    var object_deleteMarkerVersionId: ?[]const u8 = null;

                    while (looking_for_end_tag) {
                        if (i >= xml.len) {
                            break;
                        }

                        if (xml[i] == '<') {
                            if (strings.indexOf(xml[i + 1 ..], ">")) |__end| {
                                const inner_tag_name_or_tag_end = xml[i + 1 .. i + 1 + __end];

                                i = i + 2 + __end;

                                if (strings.eql(inner_tag_name_or_tag_end, "/Deleted")) {
                                    looking_for_end_tag = false;
                                } else if (strings.eql(inner_tag_name_or_tag_end, "Key")) {
                                    if (strings.indexOf(xml[i..], "</Key>")) |__tag_end| {
                                        object_key = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 6;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "VersionId")) {
                                    if (strings.indexOf(xml[i..], "</VersionId>")) |__tag_end| {
                                        object_versionId = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 12;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "DeleteMarker")) {
                                    if (strings.indexOf(xml[i..], "</DeleteMarker>")) |__tag_end| {
                                        const deleteMarker = xml[i .. i + __tag_end];

                                        if (strings.eql(deleteMarker, "true")) {
                                            object_deleteMarker = true;
                                            i = i + __tag_end + 15;
                                        } else if (strings.eql(deleteMarker, "false")) {
                                            object_deleteMarker = false;
                                            i = i + __tag_end + 15;
                                        }
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "DeleteMarkerVersionId")) {
                                    if (strings.indexOf(xml[i..], "</DeleteMarkerVersionId>")) |__tag_end| {
                                        object_deleteMarkerVersionId = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 24;
                                    }
                                }
                            } else {
                                i += 1;
                            }
                        } else {
                            i += 1;
                        }
                    }

                    if (object_key) |object_key_val| {
                        succesfullyDeleted.append(.{
                            .key = object_key_val,
                            .versionId = object_versionId,
                            .deleteMarker = object_deleteMarker,
                            .deleteMarkerVersionId = object_deleteMarkerVersionId,
                        }) catch bun.outOfMemory();
                    }
                } else if (strings.eql(tagName, "Error")) {
                    var looking_for_end_tag = true;

                    var error_key: ?[]const u8 = null;
                    var error_versionId: ?[]const u8 = null;
                    var error_message: ?[]const u8 = null;
                    var error_code: ?[]const u8 = null;

                    while (looking_for_end_tag) {
                        if (i >= xml.len) {
                            break;
                        }

                        if (xml[i] == '<') {
                            if (strings.indexOf(xml[i + 1 ..], ">")) |__end| {
                                const inner_tag_name_or_tag_end = xml[i + 1 .. i + 1 + __end];

                                i = i + 2 + __end;

                                if (strings.eql(inner_tag_name_or_tag_end, "/Error")) {
                                    looking_for_end_tag = false;
                                } else if (strings.eql(inner_tag_name_or_tag_end, "Key")) {
                                    if (strings.indexOf(xml[i..], "</Key>")) |__tag_end| {
                                        error_key = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 6;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "VersionId")) {
                                    if (strings.indexOf(xml[i..], "</VersionId>")) |__tag_end| {
                                        error_versionId = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 12;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "Code")) {
                                    if (strings.indexOf(xml[i..], "</Code>")) |__tag_end| {
                                        error_code = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 7;
                                    }
                                } else if (strings.eql(inner_tag_name_or_tag_end, "Message")) {
                                    if (strings.indexOf(xml[i..], "</Message>")) |__tag_end| {
                                        error_message = xml[i .. i + __tag_end];
                                        i = i + __tag_end + 10;
                                    }
                                }
                            } else {
                                i += 1;
                            }
                        } else {
                            i += 1;
                        }
                    }

                    if (error_key != null or error_code != null or error_message != null or error_versionId != null) {
                        partialErrors.append(.{
                            .key = error_key,
                            .versionId = error_versionId,
                            .code = error_code,
                            .message = error_message,
                        }) catch bun.outOfMemory();
                    }
                } else {
                    i += 1;
                }
            } else {
                i += 1;
            }
        }

        if (succesfullyDeleted.items.len != 0) {
            result.deleted = succesfullyDeleted;
        } else {
            succesfullyDeleted.deinit();
        }

        if (partialErrors.items.len != 0) {
            result.errors = partialErrors;
        } else {
            partialErrors.deinit();
        }
    }

    return result;
}

pub fn getS3DeleteObjectsOptionsFromJs(allocator: std.mem.Allocator, globalThis: *JSC.JSGlobalObject, object_keys: JSValue, extra_options: ?JSValue) !bun.BabyList(u8) {
    var delete_objects_request_body: bun.ByteList = .{};
    errdefer delete_objects_request_body.deinitWithAllocator(allocator);

    delete_objects_request_body.append(allocator, "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Delete xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">") catch bun.outOfMemory();

    const iter = JSC.JSArrayIterator.init(object_keys, globalThis);
    var length_iter = iter;

    while (length_iter.next()) |object_identifier_js| {
        if (object_identifier_js.isString()) {
            const str = try bun.String.fromJS(object_identifier_js, globalThis);

            if (str.tag != .Empty and str.tag != .Dead) {
                const utfStr = str.toUTF8(allocator);
                delete_objects_request_body.appendFmt(allocator, "<Object><Key>{s}</Key></Object>", .{utfStr.slice()}) catch bun.outOfMemory();
                utfStr.deinit();
            }
        } else if (object_identifier_js.isObject()) {
            if (try object_identifier_js.getTruthyComptime(globalThis, "key")) |object_key_js| {
                if (!object_key_js.isString()) {
                    return globalThis.throwInvalidArguments("S3Client.deleteObjects() needs an array of S3DeleteObjectsObjectIdentifier as it's first argument. 'key' at index {d} is not a string.", .{length_iter.i - 1});
                }

                const str = try bun.String.fromJS(object_key_js, globalThis);

                if (str.tag != .Empty and str.tag != .Dead) {
                    const utfStr = str.toUTF8(allocator);
                    delete_objects_request_body.appendFmt(allocator, "<Object><Key>{s}</Key>", .{utfStr.slice()}) catch bun.outOfMemory();
                    utfStr.deinit();
                }

                if (try object_identifier_js.getTruthyComptime(globalThis, "versionId")) |version_id_js| {
                    if (!version_id_js.isEmptyOrUndefinedOrNull() and !version_id_js.isString()) {
                        return globalThis.throwInvalidArguments("S3Client.deleteObjects() needs an array of S3DeleteObjectsObjectIdentifier as it's first argument. Optional 'versionId' at index {d} is not a string.", .{length_iter.i - 1});
                    }

                    const _str = try bun.String.fromJS(version_id_js, globalThis);

                    if (_str.tag != .Empty and _str.tag != .Dead) {
                        const utfStr = _str.toUTF8(allocator);
                        delete_objects_request_body.appendFmt(allocator, "<VersionId>{s}</VersionId>", .{utfStr.slice()}) catch bun.outOfMemory();
                        utfStr.deinit();
                    }
                }

                if (try object_identifier_js.getTruthyComptime(globalThis, "eTag")) |etag_js| {
                    if (!etag_js.isEmptyOrUndefinedOrNull() and !etag_js.isString()) {
                        return globalThis.throwInvalidArguments("S3Client.deleteObjects() needs an array of S3DeleteObjectsObjectIdentifier as it's first argument. Optional 'eTag' at index {d} is not a string.", .{length_iter.i - 1});
                    }

                    const _str = try bun.String.fromJS(etag_js, globalThis);

                    if (_str.tag != .Empty and _str.tag != .Dead) {
                        const utfStr = _str.toUTF8(allocator);
                        delete_objects_request_body.appendFmt(allocator, "<ETag>{s}</ETag>", .{utfStr.slice()}) catch bun.outOfMemory();
                        utfStr.deinit();
                    }
                }

                if (try object_identifier_js.getTruthyComptime(globalThis, "lastModifiedTime")) |last_modified_time_js| {
                    if (!last_modified_time_js.isEmptyOrUndefinedOrNull() and !last_modified_time_js.isString()) {
                        return globalThis.throwInvalidArguments("S3Client.deleteObjects() needs an array of S3DeleteObjectsObjectIdentifier as it's first argument. Optional 'lastModifiedTime' at index {d} is not a string.", .{length_iter.i - 1});
                    }

                    const _str = try bun.String.fromJS(last_modified_time_js, globalThis);

                    if (_str.tag != .Empty and _str.tag != .Dead) {
                        const utfStr = _str.toUTF8(allocator);
                        delete_objects_request_body.appendFmt(allocator, "<LastModifiedTime>{s}</LastModifiedTime>", .{utfStr.slice()}) catch bun.outOfMemory();
                        utfStr.deinit();
                    }
                }

                if (try object_identifier_js.getTruthyComptime(globalThis, "size")) |size_js| {
                    if (!size_js.isEmptyOrUndefinedOrNull() and !size_js.isNumber()) {
                        return globalThis.throwInvalidArguments("S3Client.deleteObjects() needs an array of S3DeleteObjectsObjectIdentifier as it's first argument. Optional 'size' at index {d} is not a number.", .{length_iter.i - 1});
                    }

                    const _str = try bun.String.fromJS(size_js, globalThis);

                    if (_str.tag != .Empty and _str.tag != .Dead) {
                        const utfStr = _str.toUTF8(allocator);
                        delete_objects_request_body.appendFmt(allocator, "<Size>{s}</Size>", .{utfStr.slice()}) catch bun.outOfMemory();
                        utfStr.deinit();
                    }
                }

                delete_objects_request_body.append(allocator, "</Object>") catch bun.outOfMemory();
            } else {
                return globalThis.throwInvalidArguments("S3Client.deleteObjects() needs an array of S3DeleteObjectsObjectIdentifier as it's first argument. Field 'key' at index {d} is required.", .{length_iter.i - 1});
            }
        } else {
            return globalThis.throwInvalidArguments("S3Client.deleteObjects() needs an array of S3DeleteObjectsObjectIdentifier as it's first argument. Element at index {d} is not a string.", .{length_iter.i - 1});
        }
    }

    if (extra_options) |opt| {
        if (opt.isObject()) {
            if (try opt.getBooleanLoose(globalThis, "quiet")) |quiet| {
                if (quiet == true) {
                    delete_objects_request_body.append(allocator, "<Quiet>true</Quiet>") catch bun.outOfMemory();
                }
            }
        }
    }

    delete_objects_request_body.append(allocator, "</Delete>") catch bun.outOfMemory();

    return delete_objects_request_body;
}
