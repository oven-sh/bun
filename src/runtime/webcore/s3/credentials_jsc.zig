//! `S3Credentials.getCredentialsWithOptions` — parses a JS options object into
//! `S3CredentialsWithOptions`. Lives in `runtime/webcore/s3/` because it walks
//! a `jsc.JSValue`; `s3_signing/` is JSC-free.

pub fn getCredentialsWithOptions(this: S3Credentials, default_options: MultiPartUploadOptions, options: ?jsc.JSValue, default_acl: ?ACL, default_storage_class: ?StorageClass, default_request_payer: bool, globalObject: *jsc.JSGlobalObject) bun.JSError!S3CredentialsWithOptions {
    bun.analytics.Features.s3 += 1;
    // get ENV config
    var new_credentials = S3CredentialsWithOptions{
        .credentials = this,
        .options = default_options,
        .acl = default_acl,
        .storage_class = default_storage_class,
        .request_payer = default_request_payer,
    };
    errdefer {
        new_credentials.deinit();
    }

    if (options) |opts| {
        if (opts.isObject()) {
            if (try opts.getTruthyComptime(globalObject, "accessKeyId")) |js_value| {
                if (!js_value.isEmptyOrUndefinedOrNull()) {
                    if (js_value.isString()) {
                        const str = try bun.String.fromJS(js_value, globalObject);
                        defer str.deref();
                        if (str.tag != .Empty and str.tag != .Dead) {
                            new_credentials._accessKeyIdSlice = str.toUTF8(bun.default_allocator);
                            new_credentials.credentials.accessKeyId = new_credentials._accessKeyIdSlice.?.slice();
                            new_credentials.changed_credentials = true;
                        }
                    } else {
                        return globalObject.throwInvalidArgumentTypeValue("accessKeyId", "string", js_value);
                    }
                }
            }
            if (try opts.getTruthyComptime(globalObject, "secretAccessKey")) |js_value| {
                if (!js_value.isEmptyOrUndefinedOrNull()) {
                    if (js_value.isString()) {
                        const str = try bun.String.fromJS(js_value, globalObject);
                        defer str.deref();
                        if (str.tag != .Empty and str.tag != .Dead) {
                            new_credentials._secretAccessKeySlice = str.toUTF8(bun.default_allocator);
                            new_credentials.credentials.secretAccessKey = new_credentials._secretAccessKeySlice.?.slice();
                            new_credentials.changed_credentials = true;
                        }
                    } else {
                        return globalObject.throwInvalidArgumentTypeValue("secretAccessKey", "string", js_value);
                    }
                }
            }
            if (try opts.getTruthyComptime(globalObject, "region")) |js_value| {
                if (!js_value.isEmptyOrUndefinedOrNull()) {
                    if (js_value.isString()) {
                        const str = try bun.String.fromJS(js_value, globalObject);
                        defer str.deref();
                        if (str.tag != .Empty and str.tag != .Dead) {
                            new_credentials._regionSlice = str.toUTF8(bun.default_allocator);
                            new_credentials.credentials.region = new_credentials._regionSlice.?.slice();
                            new_credentials.changed_credentials = true;
                        }
                    } else {
                        return globalObject.throwInvalidArgumentTypeValue("region", "string", js_value);
                    }
                }
            }
            if (try opts.getTruthyComptime(globalObject, "endpoint")) |js_value| {
                if (!js_value.isEmptyOrUndefinedOrNull()) {
                    if (js_value.isString()) {
                        const str = try bun.String.fromJS(js_value, globalObject);
                        defer str.deref();
                        if (str.tag != .Empty and str.tag != .Dead) {
                            new_credentials._endpointSlice = str.toUTF8(bun.default_allocator);
                            const endpoint = new_credentials._endpointSlice.?.slice();
                            const url = bun.URL.parse(endpoint);
                            const normalized_endpoint = url.hostWithPath();
                            if (normalized_endpoint.len > 0) {
                                new_credentials.credentials.endpoint = normalized_endpoint;

                                // Default to https://
                                // Only use http:// if the endpoint specifically starts with 'http://'
                                new_credentials.credentials.insecure_http = url.isHTTP();

                                new_credentials.changed_credentials = true;
                            } else if (endpoint.len > 0) {
                                // endpoint is not a valid URL
                                return globalObject.throwInvalidArgumentTypeValue("endpoint", "string", js_value);
                            }
                        }
                    } else {
                        return globalObject.throwInvalidArgumentTypeValue("endpoint", "string", js_value);
                    }
                }
            }
            if (try opts.getTruthyComptime(globalObject, "bucket")) |js_value| {
                if (!js_value.isEmptyOrUndefinedOrNull()) {
                    if (js_value.isString()) {
                        const str = try bun.String.fromJS(js_value, globalObject);
                        defer str.deref();
                        if (str.tag != .Empty and str.tag != .Dead) {
                            new_credentials._bucketSlice = str.toUTF8(bun.default_allocator);
                            new_credentials.credentials.bucket = new_credentials._bucketSlice.?.slice();
                            new_credentials.changed_credentials = true;
                        }
                    } else {
                        return globalObject.throwInvalidArgumentTypeValue("bucket", "string", js_value);
                    }
                }
            }

            if (try opts.getBooleanStrict(globalObject, "virtualHostedStyle")) |virtual_hosted_style| {
                new_credentials.credentials.virtual_hosted_style = virtual_hosted_style;
                new_credentials.changed_credentials = true;
            }

            if (try opts.getTruthyComptime(globalObject, "sessionToken")) |js_value| {
                if (!js_value.isEmptyOrUndefinedOrNull()) {
                    if (js_value.isString()) {
                        const str = try bun.String.fromJS(js_value, globalObject);
                        defer str.deref();
                        if (str.tag != .Empty and str.tag != .Dead) {
                            new_credentials._sessionTokenSlice = str.toUTF8(bun.default_allocator);
                            new_credentials.credentials.sessionToken = new_credentials._sessionTokenSlice.?.slice();
                            new_credentials.changed_credentials = true;
                        }
                    } else {
                        return globalObject.throwInvalidArgumentTypeValue("bucket", "string", js_value);
                    }
                }
            }

            if (try opts.getOptional(globalObject, "pageSize", i64)) |pageSize| {
                if (pageSize < MultiPartUploadOptions.MIN_SINGLE_UPLOAD_SIZE or pageSize > MultiPartUploadOptions.MAX_SINGLE_UPLOAD_SIZE) {
                    return globalObject.throwRangeError(pageSize, .{
                        .min = @intCast(MultiPartUploadOptions.MIN_SINGLE_UPLOAD_SIZE),
                        .max = @intCast(MultiPartUploadOptions.MAX_SINGLE_UPLOAD_SIZE),
                        .field_name = "pageSize",
                    });
                } else {
                    new_credentials.options.partSize = @intCast(pageSize);
                }
            }
            if (try opts.getOptional(globalObject, "partSize", i64)) |partSize| {
                if (partSize < MultiPartUploadOptions.MIN_SINGLE_UPLOAD_SIZE or partSize > MultiPartUploadOptions.MAX_SINGLE_UPLOAD_SIZE) {
                    return globalObject.throwRangeError(partSize, .{
                        .min = @intCast(MultiPartUploadOptions.MIN_SINGLE_UPLOAD_SIZE),
                        .max = @intCast(MultiPartUploadOptions.MAX_SINGLE_UPLOAD_SIZE),
                        .field_name = "partSize",
                    });
                } else {
                    new_credentials.options.partSize = @intCast(partSize);
                }
            }

            if (try opts.getOptional(globalObject, "queueSize", i32)) |queueSize| {
                if (queueSize < 1) {
                    return globalObject.throwRangeError(queueSize, .{
                        .min = 1,
                        .field_name = "queueSize",
                    });
                } else {
                    new_credentials.options.queueSize = @intCast(@min(queueSize, std.math.maxInt(u8)));
                }
            }

            if (try opts.getOptional(globalObject, "retry", i32)) |retry| {
                if (retry < 0 or retry > 255) {
                    return globalObject.throwRangeError(retry, .{
                        .min = 0,
                        .max = 255,
                        .field_name = "retry",
                    });
                } else {
                    new_credentials.options.retry = @intCast(retry);
                }
            }
            if (try opts.getOptionalEnum(globalObject, "acl", ACL)) |acl| {
                new_credentials.acl = acl;
            }

            if (try opts.getOptionalEnum(globalObject, "storageClass", StorageClass)) |storage_class| {
                new_credentials.storage_class = storage_class;
            }

            if (try opts.getTruthyComptime(globalObject, "contentDisposition")) |js_value| {
                if (!js_value.isEmptyOrUndefinedOrNull()) {
                    if (js_value.isString()) {
                        const str = try bun.String.fromJS(js_value, globalObject);
                        defer str.deref();
                        if (str.tag != .Empty and str.tag != .Dead) {
                            new_credentials._contentDispositionSlice = str.toUTF8(bun.default_allocator);
                            const slice = new_credentials._contentDispositionSlice.?.slice();
                            if (containsNewlineOrCR(slice)) {
                                return globalObject.throwInvalidArguments("contentDisposition must not contain newline characters (CR/LF)", .{});
                            }
                            new_credentials.content_disposition = slice;
                        }
                    } else {
                        return globalObject.throwInvalidArgumentTypeValue("contentDisposition", "string", js_value);
                    }
                }
            }

            if (try opts.getTruthyComptime(globalObject, "type")) |js_value| {
                if (!js_value.isEmptyOrUndefinedOrNull()) {
                    if (js_value.isString()) {
                        const str = try bun.String.fromJS(js_value, globalObject);
                        defer str.deref();
                        if (str.tag != .Empty and str.tag != .Dead) {
                            new_credentials._contentTypeSlice = str.toUTF8(bun.default_allocator);
                            const slice = new_credentials._contentTypeSlice.?.slice();
                            if (containsNewlineOrCR(slice)) {
                                return globalObject.throwInvalidArguments("type must not contain newline characters (CR/LF)", .{});
                            }
                            new_credentials.content_type = slice;
                        }
                    } else {
                        return globalObject.throwInvalidArgumentTypeValue("type", "string", js_value);
                    }
                }
            }

            if (try opts.getTruthyComptime(globalObject, "contentEncoding")) |js_value| {
                if (!js_value.isEmptyOrUndefinedOrNull()) {
                    if (js_value.isString()) {
                        const str = try bun.String.fromJS(js_value, globalObject);
                        defer str.deref();
                        if (str.tag != .Empty and str.tag != .Dead) {
                            new_credentials._contentEncodingSlice = str.toUTF8(bun.default_allocator);
                            const slice = new_credentials._contentEncodingSlice.?.slice();
                            if (containsNewlineOrCR(slice)) {
                                return globalObject.throwInvalidArguments("contentEncoding must not contain newline characters (CR/LF)", .{});
                            }
                            new_credentials.content_encoding = slice;
                        }
                    } else {
                        return globalObject.throwInvalidArgumentTypeValue("contentEncoding", "string", js_value);
                    }
                }
            }

            if (try opts.getBooleanStrict(globalObject, "requestPayer")) |request_payer| {
                new_credentials.request_payer = request_payer;
            }
        }
    }
    return new_credentials;
}

fn containsNewlineOrCR(value: []const u8) bool {
    return strings.indexOfAny(value, "\r\n") != null;
}

const std = @import("std");
const MultiPartUploadOptions = @import("./multipart_options.zig").MultiPartUploadOptions;

const bun = @import("bun");
const jsc = bun.jsc;
const strings = bun.strings;

const ACL = bun.S3.ACL;
const S3Credentials = bun.S3.S3Credentials;
const S3CredentialsWithOptions = bun.S3.S3CredentialsWithOptions;
const StorageClass = bun.S3.StorageClass;
