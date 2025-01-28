const std = @import("std");
const bun = @import("root").bun;
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
