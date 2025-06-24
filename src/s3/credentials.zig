const bun = @import("bun");
const picohttp = bun.picohttp;
const std = @import("std");

const MultiPartUploadOptions = @import("./multipart_options.zig").MultiPartUploadOptions;
const ACL = @import("./acl.zig").ACL;
const StorageClass = @import("./storage_class.zig").StorageClass;

const JSC = bun.JSC;
const strings = bun.strings;

pub const S3Credentials = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    accessKeyId: []const u8,
    secretAccessKey: []const u8,
    region: []const u8,
    endpoint: []const u8,
    bucket: []const u8,
    sessionToken: []const u8,
    storage_class: ?StorageClass = null,
    /// Important for MinIO support.
    insecure_http: bool = false,
    /// indicates if the endpoint is a virtual hosted style bucket
    virtual_hosted_style: bool = false,

    pub fn estimatedSize(this: *const @This()) usize {
        return @sizeOf(S3Credentials) + this.accessKeyId.len + this.region.len + this.secretAccessKey.len + this.endpoint.len + this.bucket.len;
    }

    fn hashConst(acl: []const u8) u64 {
        var hasher = std.hash.Wyhash.init(0);
        var remain = acl;

        var buf: [@sizeOf(@TypeOf(hasher.buf))]u8 = undefined;

        while (remain.len > 0) {
            const end = @min(hasher.buf.len, remain.len);

            hasher.update(strings.copyLowercaseIfNeeded(remain[0..end], &buf));
            remain = remain[end..];
        }

        return hasher.final();
    }
    pub fn getCredentialsWithOptions(this: S3Credentials, default_options: MultiPartUploadOptions, options: ?JSC.JSValue, default_acl: ?ACL, default_storage_class: ?StorageClass, globalObject: *JSC.JSGlobalObject) bun.JSError!S3CredentialsWithOptions {
        bun.analytics.Features.s3 += 1;
        // get ENV config
        var new_credentials = S3CredentialsWithOptions{
            .credentials = this,
            .options = default_options,
            .acl = default_acl,
            .storage_class = default_storage_class,
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
                    if (pageSize < MultiPartUploadOptions.MIN_SINGLE_UPLOAD_SIZE and pageSize > MultiPartUploadOptions.MAX_SINGLE_UPLOAD_SIZE) {
                        return globalObject.throwRangeError(pageSize, .{
                            .min = @intCast(MultiPartUploadOptions.MIN_SINGLE_UPLOAD_SIZE),
                            .max = @intCast(MultiPartUploadOptions.MAX_SINGLE_UPLOAD_SIZE),
                            .field_name = "pageSize",
                        });
                    } else {
                        new_credentials.options.partSize = @intCast(pageSize);
                    }
                }

                if (try opts.getOptional(globalObject, "queueSize", i32)) |queueSize| {
                    if (queueSize < 1) {
                        return globalObject.throwRangeError(queueSize, .{
                            .min = 1,
                            .field_name = "queueSize",
                        });
                    } else {
                        new_credentials.options.queueSize = @intCast(@max(queueSize, std.math.maxInt(u8)));
                    }
                }

                if (try opts.getOptional(globalObject, "retry", i32)) |retry| {
                    if (retry < 0 and retry > 255) {
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
            }
        }
        return new_credentials;
    }
    pub fn dupe(this: *const @This()) *S3Credentials {
        return bun.new(S3Credentials, .{
            .ref_count = .init(),
            .accessKeyId = if (this.accessKeyId.len > 0)
                bun.default_allocator.dupe(u8, this.accessKeyId) catch bun.outOfMemory()
            else
                "",

            .secretAccessKey = if (this.secretAccessKey.len > 0)
                bun.default_allocator.dupe(u8, this.secretAccessKey) catch bun.outOfMemory()
            else
                "",

            .region = if (this.region.len > 0)
                bun.default_allocator.dupe(u8, this.region) catch bun.outOfMemory()
            else
                "",

            .endpoint = if (this.endpoint.len > 0)
                bun.default_allocator.dupe(u8, this.endpoint) catch bun.outOfMemory()
            else
                "",

            .bucket = if (this.bucket.len > 0)
                bun.default_allocator.dupe(u8, this.bucket) catch bun.outOfMemory()
            else
                "",

            .sessionToken = if (this.sessionToken.len > 0)
                bun.default_allocator.dupe(u8, this.sessionToken) catch bun.outOfMemory()
            else
                "",

            .insecure_http = this.insecure_http,
            .virtual_hosted_style = this.virtual_hosted_style,
        });
    }
    fn deinit(this: *@This()) void {
        if (this.accessKeyId.len > 0) {
            bun.default_allocator.free(this.accessKeyId);
        }
        if (this.secretAccessKey.len > 0) {
            bun.default_allocator.free(this.secretAccessKey);
        }
        if (this.region.len > 0) {
            bun.default_allocator.free(this.region);
        }
        if (this.endpoint.len > 0) {
            bun.default_allocator.free(this.endpoint);
        }
        if (this.bucket.len > 0) {
            bun.default_allocator.free(this.bucket);
        }
        if (this.sessionToken.len > 0) {
            bun.default_allocator.free(this.sessionToken);
        }
        bun.destroy(this);
    }

    const log = bun.Output.scoped(.AWS, false);

    const DateResult = struct {
        // numeric representation of year, month and day (excluding time components)
        numeric_day: u64,
        date: []const u8,
    };

    fn getAMZDate(allocator: std.mem.Allocator) DateResult {
        // We can also use Date.now() but would be slower and would add JSC dependency
        // var buffer: [28]u8 = undefined;
        // the code bellow is the same as new Date(Date.now()).toISOString()
        // JSC.JSValue.getDateNowISOString(globalObject, &buffer);

        // Create UTC timestamp
        const secs: u64 = @intCast(@divFloor(std.time.milliTimestamp(), 1000));
        const utc_seconds = std.time.epoch.EpochSeconds{ .secs = secs };
        const utc_day = utc_seconds.getEpochDay();
        const year_and_day = utc_day.calculateYearDay();
        const month_and_day = year_and_day.calculateMonthDay();
        // Get UTC date components
        const year = year_and_day.year;
        const day = @as(u32, month_and_day.day_index) + 1; // this starts in 0
        const month = month_and_day.month.numeric(); // starts in 1

        // Get UTC time components
        const time = utc_seconds.getDaySeconds();
        const hours = time.getHoursIntoDay();
        const minutes = time.getMinutesIntoHour();
        const seconds = time.getSecondsIntoMinute();

        // Format the date
        return .{
            .numeric_day = secs - time.secs,
            .date = std.fmt.allocPrint(allocator, "{d:0>4}{d:0>2}{d:0>2}T{d:0>2}{d:0>2}{d:0>2}Z", .{
                year,
                month,
                day,
                hours,
                minutes,
                seconds,
            }) catch bun.outOfMemory(),
        };
    }

    const DIGESTED_HMAC_256_LEN = 32;
    pub const SignResult = struct {
        amz_date: []const u8,
        host: []const u8,
        authorization: []const u8,
        url: []const u8,

        content_disposition: []const u8 = "",
        content_md5: []const u8 = "",
        session_token: []const u8 = "",
        acl: ?ACL = null,
        storage_class: ?StorageClass = null,
        _headers: [8]picohttp.Header = .{
            .{ .name = "", .value = "" },
            .{ .name = "", .value = "" },
            .{ .name = "", .value = "" },
            .{ .name = "", .value = "" },
            .{ .name = "", .value = "" },
            .{ .name = "", .value = "" },
            .{ .name = "", .value = "" },
            .{ .name = "", .value = "" },
        },
        _headers_len: u8 = 0,

        pub fn headers(this: *const @This()) []const picohttp.Header {
            return this._headers[0..this._headers_len];
        }

        pub fn mixWithHeader(this: *const @This(), headers_buffer: []picohttp.Header, header: picohttp.Header) []const picohttp.Header {
            // copy the headers to buffer
            const len = this._headers_len;
            for (this._headers[0..len], 0..len) |existing_header, i| {
                headers_buffer[i] = existing_header;
            }
            headers_buffer[len] = header;
            return headers_buffer[0 .. len + 1];
        }

        pub fn deinit(this: *const @This()) void {
            if (this.amz_date.len > 0) {
                bun.freeSensitive(bun.default_allocator, this.amz_date);
            }

            if (this.session_token.len > 0) {
                bun.freeSensitive(bun.default_allocator, this.session_token);
            }

            if (this.content_disposition.len > 0) {
                bun.freeSensitive(bun.default_allocator, this.content_disposition);
            }

            if (this.host.len > 0) {
                bun.freeSensitive(bun.default_allocator, this.host);
            }

            if (this.authorization.len > 0) {
                bun.freeSensitive(bun.default_allocator, this.authorization);
            }

            if (this.url.len > 0) {
                bun.freeSensitive(bun.default_allocator, this.url);
            }

            if (this.content_md5.len > 0) {
                bun.default_allocator.free(this.content_md5);
            }
        }
    };

    pub const SignQueryOptions = struct {
        expires: usize = 86400,
    };
    pub const SignOptions = struct {
        path: []const u8,
        method: bun.http.Method,
        content_hash: ?[]const u8 = null,
        content_md5: ?[]const u8 = null,
        search_params: ?[]const u8 = null,
        content_disposition: ?[]const u8 = null,
        acl: ?ACL = null,
        storage_class: ?StorageClass = null,
    };
    /// This is not used for signing but for console.log output, is just nice to have
    pub fn guessBucket(endpoint: []const u8) ?[]const u8 {
        // check if is amazonaws.com
        if (strings.indexOf(endpoint, ".amazonaws.com")) |_| {
            // check if is .s3. virtual host style
            if (strings.indexOf(endpoint, ".s3.")) |end| {
                // its https://bucket-name.s3.region-code.amazonaws.com/key-name
                const start = strings.indexOf(endpoint, "/") orelse {
                    return endpoint[0..end];
                };
                return endpoint[start + 1 .. end];
            }
        } else if (strings.indexOf(endpoint, ".r2.cloudflarestorage.com")) |r2_start| {
            // check if is <BUCKET>.<ACCOUNT_ID>.r2.cloudflarestorage.com
            const end = strings.indexOf(endpoint, ".") orelse return null; // actually unreachable
            if (end > 0 and r2_start == end) {
                // its https://<ACCOUNT_ID>.r2.cloudflarestorage.com
                return null;
            }
            // ok its virtual host style
            const start = strings.indexOf(endpoint, "/") orelse {
                return endpoint[0..end];
            };
            return endpoint[start + 1 .. end];
        }
        return null;
    }
    pub fn guessRegion(endpoint: []const u8) []const u8 {
        if (endpoint.len > 0) {
            if (strings.endsWith(endpoint, ".r2.cloudflarestorage.com")) return "auto";
            if (strings.indexOf(endpoint, ".amazonaws.com")) |end| {
                if (strings.indexOf(endpoint, "s3.")) |start| {
                    return endpoint[start + 3 .. end];
                }
            }
            // endpoint is informed but is not s3 so auto detect
            return "auto";
        }

        // no endpoint so we default to us-east-1 because s3.us-east-1.amazonaws.com is the default endpoint
        return "us-east-1";
    }
    fn toHexChar(value: u8) !u8 {
        return switch (value) {
            0...9 => value + '0',
            10...15 => (value - 10) + 'A',
            else => error.InvalidHexChar,
        };
    }
    pub fn encodeURIComponent(input: []const u8, buffer: []u8, comptime encode_slash: bool) ![]const u8 {
        var written: usize = 0;

        for (input) |c| {
            switch (c) {
                // RFC 3986 Unreserved Characters (do not encode)
                'A'...'Z', 'a'...'z', '0'...'9', '-', '_', '.', '~' => {
                    if (written >= buffer.len) return error.BufferTooSmall;
                    buffer[written] = c;
                    written += 1;
                },
                // All other characters need to be percent-encoded
                else => {
                    if (!encode_slash and (c == '/' or c == '\\')) {
                        if (written >= buffer.len) return error.BufferTooSmall;
                        buffer[written] = if (c == '\\') '/' else c;
                        written += 1;
                        continue;
                    }
                    if (written + 3 > buffer.len) return error.BufferTooSmall;
                    buffer[written] = '%';
                    // Convert byte to hex
                    const high_nibble: u8 = (c >> 4) & 0xF;
                    const low_nibble: u8 = c & 0xF;
                    buffer[written + 1] = try toHexChar(high_nibble);
                    buffer[written + 2] = try toHexChar(low_nibble);
                    written += 3;
                },
            }
        }

        return buffer[0..written];
    }

    pub fn signRequest(this: *const @This(), signOptions: SignOptions, comptime allow_empty_path: bool, signQueryOption: ?SignQueryOptions) !SignResult {
        const method = signOptions.method;
        const request_path = signOptions.path;
        const content_hash = signOptions.content_hash;
        var content_md5 = signOptions.content_md5;

        if (content_md5) |content_md5_val| {
            const len = bun.base64.encodeLen(content_md5_val);
            const content_md5_as_base64 = bun.default_allocator.alloc(u8, len) catch bun.outOfMemory();
            content_md5 = content_md5_as_base64[0..bun.base64.encode(content_md5_as_base64, content_md5_val)];
        }

        const search_params = signOptions.search_params;

        var content_disposition = signOptions.content_disposition;
        if (content_disposition != null and content_disposition.?.len == 0) {
            content_disposition = null;
        }
        const session_token: ?[]const u8 = if (this.sessionToken.len == 0) null else this.sessionToken;

        const acl: ?[]const u8 = if (signOptions.acl) |acl_value| acl_value.toString() else null;

        const storage_class: ?[]const u8 = if (signOptions.storage_class) |storage_class| storage_class.toString() else null;

        if (this.accessKeyId.len == 0 or this.secretAccessKey.len == 0) return error.MissingCredentials;
        const signQuery = signQueryOption != null;
        const expires = if (signQueryOption) |options| options.expires else 0;
        const method_name = switch (method) {
            .GET => "GET",
            .POST => "POST",
            .PUT => "PUT",
            .DELETE => "DELETE",
            .HEAD => "HEAD",
            else => return error.InvalidMethod,
        };

        const region = if (this.region.len > 0) this.region else guessRegion(this.endpoint);
        var full_path = request_path;
        // handle \\ on bucket name
        if (strings.startsWith(full_path, "/")) {
            full_path = full_path[1..];
        } else if (strings.startsWith(full_path, "\\")) {
            full_path = full_path[1..];
        }

        var path: []const u8 = full_path;
        var bucket: []const u8 = this.bucket;

        if (!this.virtual_hosted_style) {
            if (bucket.len == 0) {
                // guess bucket using path
                if (strings.indexOf(full_path, "/")) |end| {
                    if (strings.indexOf(full_path, "\\")) |backslash_index| {
                        if (backslash_index < end) {
                            bucket = full_path[0..backslash_index];
                            path = full_path[backslash_index + 1 ..];
                        }
                    }
                    bucket = full_path[0..end];
                    path = full_path[end + 1 ..];
                } else if (strings.indexOf(full_path, "\\")) |backslash_index| {
                    bucket = full_path[0..backslash_index];
                    path = full_path[backslash_index + 1 ..];
                } else {
                    return error.InvalidPath;
                }
            }
        }

        if (strings.endsWith(path, "/")) {
            path = path[0 .. path.len - 1];
        } else if (strings.endsWith(path, "\\")) {
            path = path[0 .. path.len - 1];
        }
        if (strings.startsWith(path, "/")) {
            path = path[1..];
        } else if (strings.startsWith(path, "\\")) {
            path = path[1..];
        }

        // if we allow path.len == 0 it will list the bucket for now we disallow
        if (!allow_empty_path and path.len == 0) return error.InvalidPath;

        var normalized_path_buffer: [1024 + 63 + 2]u8 = undefined; // 1024 max key size and 63 max bucket name
        var path_buffer: [1024]u8 = undefined;
        var bucket_buffer: [63]u8 = undefined;
        bucket = encodeURIComponent(bucket, &bucket_buffer, false) catch return error.InvalidPath;
        path = encodeURIComponent(path, &path_buffer, false) catch return error.InvalidPath;
        // Default to https. Only use http if they explicit pass "http://" as the endpoint.
        const protocol = if (this.insecure_http) "http" else "https";

        // detect service name and host from region or endpoint
        var endpoint = this.endpoint;
        var extra_path: []const u8 = "";
        const host = brk_host: {
            if (this.endpoint.len > 0) {
                if (this.endpoint.len >= 2048) return error.InvalidEndpoint;
                var host = this.endpoint;
                if (bun.strings.indexOf(this.endpoint, "/")) |index| {
                    host = this.endpoint[0..index];
                    extra_path = this.endpoint[index..];
                }
                // only the host part is needed here
                break :brk_host try bun.default_allocator.dupe(u8, host);
            } else {
                if (this.virtual_hosted_style) {
                    // virtual hosted style requires a bucket name if an endpoint is not provided
                    if (bucket.len == 0) {
                        return error.InvalidEndpoint;
                    }
                    // default to https://<BUCKET_NAME>.s3.<REGION>.amazonaws.com/
                    endpoint = try std.fmt.allocPrint(bun.default_allocator, "{s}.s3.{s}.amazonaws.com", .{ bucket, region });
                    break :brk_host endpoint;
                }
                endpoint = try std.fmt.allocPrint(bun.default_allocator, "s3.{s}.amazonaws.com", .{region});
                break :brk_host endpoint;
            }
        };
        errdefer bun.default_allocator.free(host);
        const normalizedPath = brk: {
            if (this.virtual_hosted_style) {
                break :brk std.fmt.bufPrint(&normalized_path_buffer, "{s}/{s}", .{ extra_path, path }) catch return error.InvalidPath;
            } else {
                break :brk std.fmt.bufPrint(&normalized_path_buffer, "{s}/{s}/{s}", .{ extra_path, bucket, path }) catch return error.InvalidPath;
            }
        };

        const date_result = getAMZDate(bun.default_allocator);
        const amz_date = date_result.date;
        errdefer bun.default_allocator.free(amz_date);

        const amz_day = amz_date[0..8];
        const signed_headers = if (signQuery) "host" else brk: {
            if (content_md5 != null) {
                if (storage_class != null) {
                    if (acl != null) {
                        if (content_disposition != null) {
                            if (session_token != null) {
                                break :brk "content-disposition;content-md5;host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-storage-class";
                            } else {
                                break :brk "content-disposition;content-md5;host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-storage-class";
                            }
                        } else {
                            if (session_token != null) {
                                break :brk "content-md5;host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-storage-class";
                            } else {
                                break :brk "content-md5;host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-storage-class";
                            }
                        }
                    } else {
                        if (content_disposition != null) {
                            if (session_token != null) {
                                break :brk "content-disposition;content-md5;host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-storage-class";
                            } else {
                                break :brk "content-disposition;content-md5;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class";
                            }
                        } else {
                            if (session_token != null) {
                                break :brk "content-md5;host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-storage-class";
                            } else {
                                break :brk "content-md5;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class";
                            }
                        }
                    }
                } else {
                    if (acl != null) {
                        if (content_disposition != null) {
                            if (session_token != null) {
                                break :brk "content-disposition;content-md5;host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-security-token";
                            } else {
                                break :brk "content-disposition;content-md5;host;x-amz-acl;x-amz-content-sha256;x-amz-date";
                            }
                        } else {
                            if (session_token != null) {
                                break :brk "content-md5;host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-security-token";
                            } else {
                                break :brk "content-md5;host;x-amz-acl;x-amz-content-sha256;x-amz-date";
                            }
                        }
                    } else {
                        if (content_disposition != null) {
                            if (session_token != null) {
                                break :brk "content-disposition;content-md5;host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
                            } else {
                                break :brk "content-disposition;content-md5;host;x-amz-content-sha256;x-amz-date";
                            }
                        } else {
                            if (session_token != null) {
                                break :brk "content-md5;host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
                            } else {
                                break :brk "content-md5;host;x-amz-content-sha256;x-amz-date";
                            }
                        }
                    }
                }
            } else {
                if (storage_class != null) {
                    if (acl != null) {
                        if (content_disposition != null) {
                            if (session_token != null) {
                                break :brk "content-disposition;host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-storage-class";
                            } else {
                                break :brk "content-disposition;host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-storage-class";
                            }
                        } else {
                            if (session_token != null) {
                                break :brk "host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-storage-class";
                            } else {
                                break :brk "host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-storage-class";
                            }
                        }
                    } else {
                        if (content_disposition != null) {
                            if (session_token != null) {
                                break :brk "content-disposition;host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-storage-class";
                            } else {
                                break :brk "content-disposition;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class";
                            }
                        } else {
                            if (session_token != null) {
                                break :brk "host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-storage-class";
                            } else {
                                break :brk "host;x-amz-content-sha256;x-amz-date;x-amz-storage-class";
                            }
                        }
                    }
                } else {
                    if (acl != null) {
                        if (content_disposition != null) {
                            if (session_token != null) {
                                break :brk "content-disposition;host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-security-token";
                            } else {
                                break :brk "content-disposition;host;x-amz-acl;x-amz-content-sha256;x-amz-date";
                            }
                        } else {
                            if (session_token != null) {
                                break :brk "host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-security-token";
                            } else {
                                break :brk "host;x-amz-acl;x-amz-content-sha256;x-amz-date";
                            }
                        }
                    } else {
                        if (content_disposition != null) {
                            if (session_token != null) {
                                break :brk "content-disposition;host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
                            } else {
                                break :brk "content-disposition;host;x-amz-content-sha256;x-amz-date";
                            }
                        } else {
                            if (session_token != null) {
                                break :brk "host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
                            } else {
                                break :brk "host;x-amz-content-sha256;x-amz-date";
                            }
                        }
                    }
                }
            }
        };

        const service_name = "s3";

        const aws_content_hash = if (content_hash) |hash| hash else ("UNSIGNED-PAYLOAD");
        var tmp_buffer: [4096]u8 = undefined;

        const authorization = brk: {
            // we hash the hash so we need 2 buffers
            var hmac_sig_service: [bun.BoringSSL.c.EVP_MAX_MD_SIZE]u8 = undefined;
            var hmac_sig_service2: [bun.BoringSSL.c.EVP_MAX_MD_SIZE]u8 = undefined;

            const sigDateRegionServiceReq = brk_sign: {
                const key = try std.fmt.bufPrint(&tmp_buffer, "{s}{s}{s}", .{ region, service_name, this.secretAccessKey });
                var cache = (JSC.VirtualMachine.getMainThreadVM() orelse JSC.VirtualMachine.get()).rareData().awsCache();
                if (cache.get(date_result.numeric_day, key)) |cached| {
                    break :brk_sign cached;
                }
                // not cached yet lets generate a new one
                const sigDate = bun.hmac.generate(try std.fmt.bufPrint(&tmp_buffer, "AWS4{s}", .{this.secretAccessKey}), amz_day, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;
                const sigDateRegion = bun.hmac.generate(sigDate, region, .sha256, &hmac_sig_service2) orelse return error.FailedToGenerateSignature;
                const sigDateRegionService = bun.hmac.generate(sigDateRegion, service_name, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;
                const result = bun.hmac.generate(sigDateRegionService, "aws4_request", .sha256, &hmac_sig_service2) orelse return error.FailedToGenerateSignature;

                cache.set(date_result.numeric_day, key, hmac_sig_service2[0..DIGESTED_HMAC_256_LEN].*);
                break :brk_sign result;
            };
            if (signQuery) {
                var token_encoded_buffer: [2048]u8 = undefined; // token is normaly like 600-700 but can be up to 2k
                var encoded_session_token: ?[]const u8 = null;
                if (session_token) |token| {
                    encoded_session_token = encodeURIComponent(token, &token_encoded_buffer, true) catch return error.InvalidSessionToken;
                }

                var content_md5_encoded_buffer: [128]u8 = undefined; // MD5 as base64 (which is required for AWS SigV4) is always 44, when encoded its always 46 (44 + ==)
                var encoded_content_md5: ?[]const u8 = null;

                if (content_md5) |content_md5_value| {
                    encoded_content_md5 = encodeURIComponent(content_md5_value, &content_md5_encoded_buffer, true) catch return error.FailedToGenerateSignature;
                }

                const canonical = brk_canonical: {
                    if (encoded_content_md5) |encoded_content_md5_value| {
                        if (storage_class) |storage_class_value| {
                            if (acl) |acl_value| {
                                if (encoded_session_token) |token| {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nContent-MD5={s}&X-Amz-Acl={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&x-amz-storage-class={s}\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, encoded_content_md5_value, acl_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, storage_class_value, host, signed_headers, aws_content_hash });
                                } else {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nContent-MD5={s}&X-Amz-Acl={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&x-amz-storage-class={s}\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, encoded_content_md5_value, acl_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, storage_class_value, host, signed_headers, aws_content_hash });
                                }
                            } else {
                                if (encoded_session_token) |token| {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nContent-MD5={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&x-amz-storage-class={s}\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, storage_class_value, host, signed_headers, aws_content_hash });
                                } else {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nContent-MD5={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&x-amz-storage-class={s}\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, storage_class_value, host, signed_headers, aws_content_hash });
                                }
                            }
                        } else {
                            if (acl) |acl_value| {
                                if (encoded_session_token) |token| {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nContent-MD5={s}&X-Amz-Acl={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, encoded_content_md5_value, acl_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, host, signed_headers, aws_content_hash });
                                } else {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nContent-MD5={s}&X-Amz-Acl={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, encoded_content_md5_value, acl_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, host, signed_headers, aws_content_hash });
                                }
                            } else {
                                if (encoded_session_token) |token| {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nContent-MD5={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, host, signed_headers, aws_content_hash });
                                } else {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nContent-MD5={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, host, signed_headers, aws_content_hash });
                                }
                            }
                        }
                    } else {
                        if (storage_class) |storage_class_value| {
                            if (acl) |acl_value| {
                                if (encoded_session_token) |token| {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nX-Amz-Acl={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&x-amz-storage-class={s}\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, acl_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, storage_class_value, host, signed_headers, aws_content_hash });
                                } else {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nX-Amz-Acl={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&x-amz-storage-class={s}\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, acl_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, storage_class_value, host, signed_headers, aws_content_hash });
                                }
                            } else {
                                if (encoded_session_token) |token| {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nX-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&x-amz-storage-class={s}\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, storage_class_value, host, signed_headers, aws_content_hash });
                                } else {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nX-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&x-amz-storage-class={s}\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, this.accessKeyId, amz_day, region, service_name, amz_date, expires, storage_class_value, host, signed_headers, aws_content_hash });
                                }
                            }
                        } else {
                            if (acl) |acl_value| {
                                if (encoded_session_token) |token| {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nX-Amz-Acl={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, acl_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, host, signed_headers, aws_content_hash });
                                } else {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nX-Amz-Acl={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, acl_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, host, signed_headers, aws_content_hash });
                                }
                            } else {
                                if (encoded_session_token) |token| {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nX-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, host, signed_headers, aws_content_hash });
                                } else {
                                    break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nX-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, this.accessKeyId, amz_day, region, service_name, amz_date, expires, host, signed_headers, aws_content_hash });
                                }
                            }
                        }
                    }
                };
                var sha_digest = std.mem.zeroes(bun.sha.SHA256.Digest);
                bun.sha.SHA256.hash(canonical, &sha_digest, JSC.VirtualMachine.get().rareData().boringEngine());

                const signValue = try std.fmt.bufPrint(&tmp_buffer, "AWS4-HMAC-SHA256\n{s}\n{s}/{s}/{s}/aws4_request\n{s}", .{ amz_date, amz_day, region, service_name, std.fmt.bytesToHex(sha_digest[0..bun.sha.SHA256.digest], .lower) });

                const signature = bun.hmac.generate(sigDateRegionServiceReq, signValue, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;

                if (encoded_content_md5) |encoded_content_md5_value| {
                    if (storage_class) |storage_class_value| {
                        if (acl) |acl_value| {
                            if (encoded_session_token) |token| {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Acl={s}&x-amz-storage-class={s}&Content-MD5={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, acl_value, storage_class_value, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            } else {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Acl={s}&x-amz-storage-class={s}&Content-MD5={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, acl_value, storage_class_value, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            }
                        } else {
                            if (encoded_session_token) |token| {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?x-amz-storage-class={s}&Content-MD5={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, storage_class_value, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            } else {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?x-amz-storage-class={s}&Content-MD5={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, storage_class_value, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            }
                        }
                    } else {
                        if (acl) |acl_value| {
                            if (encoded_session_token) |token| {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Acl={s}&Content-MD5={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, acl_value, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            } else {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Acl={s}&Content-MD5={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, acl_value, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            }
                        } else {
                            if (encoded_session_token) |token| {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Algorithm=AWS4-HMAC-SHA256&Content-MD5={s}&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            } else {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Algorithm=AWS4-HMAC-SHA256&Content-MD5={s}&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, encoded_content_md5_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            }
                        }
                    }
                } else {
                    if (storage_class) |storage_class_value| {
                        if (acl) |acl_value| {
                            if (encoded_session_token) |token| {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Acl={s}&x-amz-storage-class={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, acl_value, storage_class_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            } else {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Acl={s}&x-amz-storage-class={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, acl_value, storage_class_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            }
                        } else {
                            if (encoded_session_token) |token| {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?x-amz-storage-class={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, storage_class_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            } else {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?x-amz-storage-class={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, storage_class_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            }
                        }
                    } else {
                        if (acl) |acl_value| {
                            if (encoded_session_token) |token| {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Acl={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, acl_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            } else {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Acl={s}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, acl_value, this.accessKeyId, amz_day, region, service_name, amz_date, expires, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            }
                        } else {
                            if (encoded_session_token) |token| {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-Security-Token={s}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, this.accessKeyId, amz_day, region, service_name, amz_date, expires, token, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            } else {
                                break :brk try std.fmt.allocPrint(
                                    bun.default_allocator,
                                    "{s}://{s}{s}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                                    .{ protocol, host, normalizedPath, this.accessKeyId, amz_day, region, service_name, amz_date, expires, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                                );
                            }
                        }
                    }
                }
            } else {
                var encoded_content_disposition_buffer: [255]u8 = undefined;
                const encoded_content_disposition: []const u8 = if (content_disposition) |cd| encodeURIComponent(cd, &encoded_content_disposition_buffer, true) catch return error.ContentTypeIsTooLong else "";
                const canonical = brk_canonical: {
                    if (content_md5) |content_md5_value| {
                        if (storage_class) |storage_class_value| {
                            if (acl) |acl_value| {
                                if (content_disposition != null) {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, content_md5_value, host, acl_value, aws_content_hash, amz_date, token, storage_class_value, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, content_md5_value, host, acl_value, aws_content_hash, amz_date, storage_class_value, signed_headers, aws_content_hash });
                                    }
                                } else {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", content_md5_value, host, acl_value, aws_content_hash, amz_date, token, storage_class_value, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", content_md5_value, host, acl_value, aws_content_hash, amz_date, storage_class_value, signed_headers, aws_content_hash });
                                    }
                                }
                            } else {
                                if (content_disposition != null) {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, content_md5_value, host, aws_content_hash, amz_date, token, storage_class_value, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, content_md5_value, host, aws_content_hash, amz_date, storage_class_value, signed_headers, aws_content_hash });
                                    }
                                } else {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", content_md5_value, host, aws_content_hash, amz_date, token, storage_class_value, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", content_md5_value, host, aws_content_hash, amz_date, storage_class_value, signed_headers, aws_content_hash });
                                    }
                                }
                            }
                        } else {
                            if (acl) |acl_value| {
                                if (content_disposition != null) {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, content_md5_value, host, acl_value, aws_content_hash, amz_date, token, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, content_md5_value, host, acl_value, aws_content_hash, amz_date, signed_headers, aws_content_hash });
                                    }
                                } else {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", content_md5_value, host, acl_value, aws_content_hash, amz_date, token, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", content_md5_value, host, acl_value, aws_content_hash, amz_date, signed_headers, aws_content_hash });
                                    }
                                }
                            } else {
                                if (content_disposition != null) {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, content_md5_value, host, aws_content_hash, amz_date, token, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, content_md5_value, host, aws_content_hash, amz_date, signed_headers, aws_content_hash });
                                    }
                                } else {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", content_md5_value, host, aws_content_hash, amz_date, token, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-md5:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{
                                            method_name,
                                            normalizedPath,
                                            if (search_params) |p| p[1..] else "",
                                            content_md5_value,
                                            host,
                                            aws_content_hash,
                                            amz_date,
                                            signed_headers,
                                            aws_content_hash,
                                        });
                                    }
                                }
                            }
                        }
                    } else {
                        if (storage_class) |storage_class_value| {
                            if (acl) |acl_value| {
                                if (content_disposition != null) {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, host, acl_value, aws_content_hash, amz_date, token, storage_class_value, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, host, acl_value, aws_content_hash, amz_date, storage_class_value, signed_headers, aws_content_hash });
                                    }
                                } else {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", host, acl_value, aws_content_hash, amz_date, token, storage_class_value, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", host, acl_value, aws_content_hash, amz_date, storage_class_value, signed_headers, aws_content_hash });
                                    }
                                }
                            } else {
                                if (content_disposition != null) {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, host, aws_content_hash, amz_date, token, storage_class_value, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, host, aws_content_hash, amz_date, storage_class_value, signed_headers, aws_content_hash });
                                    }
                                } else {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", host, aws_content_hash, amz_date, token, storage_class_value, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-storage-class:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", host, aws_content_hash, amz_date, storage_class_value, signed_headers, aws_content_hash });
                                    }
                                }
                            }
                        } else {
                            if (acl) |acl_value| {
                                if (content_disposition != null) {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, host, acl_value, aws_content_hash, amz_date, token, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, host, acl_value, aws_content_hash, amz_date, signed_headers, aws_content_hash });
                                    }
                                } else {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", host, acl_value, aws_content_hash, amz_date, token, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\nhost:{s}\nx-amz-acl:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", host, acl_value, aws_content_hash, amz_date, signed_headers, aws_content_hash });
                                    }
                                }
                            } else {
                                if (content_disposition != null) {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, host, aws_content_hash, amz_date, token, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, host, aws_content_hash, amz_date, signed_headers, aws_content_hash });
                                    }
                                } else {
                                    if (session_token) |token| {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\nx-amz-security-token:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", host, aws_content_hash, amz_date, token, signed_headers, aws_content_hash });
                                    } else {
                                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", host, aws_content_hash, amz_date, signed_headers, aws_content_hash });
                                    }
                                }
                            }
                        }
                    }
                };
                var sha_digest = std.mem.zeroes(bun.sha.SHA256.Digest);
                bun.sha.SHA256.hash(canonical, &sha_digest, JSC.VirtualMachine.get().rareData().boringEngine());

                const signValue = try std.fmt.bufPrint(&tmp_buffer, "AWS4-HMAC-SHA256\n{s}\n{s}/{s}/{s}/aws4_request\n{s}", .{ amz_date, amz_day, region, service_name, std.fmt.bytesToHex(sha_digest[0..bun.sha.SHA256.digest], .lower) });

                const signature = bun.hmac.generate(sigDateRegionServiceReq, signValue, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;

                break :brk try std.fmt.allocPrint(
                    bun.default_allocator,
                    "AWS4-HMAC-SHA256 Credential={s}/{s}/{s}/{s}/aws4_request, SignedHeaders={s}, Signature={s}",
                    .{ this.accessKeyId, amz_day, region, service_name, signed_headers, std.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                );
            }
        };
        errdefer bun.default_allocator.free(authorization);

        if (signQuery) {
            defer bun.default_allocator.free(host);
            defer bun.default_allocator.free(amz_date);

            return SignResult{
                .amz_date = "",
                .host = "",
                .authorization = "",
                .acl = signOptions.acl,
                .url = authorization,
                .storage_class = signOptions.storage_class,
            };
        }

        var result = SignResult{
            .amz_date = amz_date,
            .host = host,
            .authorization = authorization,
            .acl = signOptions.acl,
            .storage_class = signOptions.storage_class,
            .url = try std.fmt.allocPrint(bun.default_allocator, "{s}://{s}{s}{s}", .{ protocol, host, normalizedPath, if (search_params) |s| s else "" }),
            ._headers = [_]picohttp.Header{
                .{ .name = "x-amz-content-sha256", .value = aws_content_hash },
                .{ .name = "x-amz-date", .value = amz_date },
                .{ .name = "Host", .value = host },
                .{ .name = "Authorization", .value = authorization[0..] },
                .{ .name = "", .value = "" },
                .{ .name = "", .value = "" },
                .{ .name = "", .value = "" },
                .{ .name = "", .value = "" },
            },
            ._headers_len = 4,
        };

        if (acl) |acl_value| {
            result._headers[result._headers_len] = .{ .name = "x-amz-acl", .value = acl_value };
            result._headers_len += 1;
        }

        if (session_token) |token| {
            const session_token_value = bun.default_allocator.dupe(u8, token) catch bun.outOfMemory();
            result.session_token = session_token_value;
            result._headers[result._headers_len] = .{ .name = "x-amz-security-token", .value = session_token_value };
            result._headers_len += 1;
        }

        if (content_disposition) |cd| {
            const content_disposition_value = bun.default_allocator.dupe(u8, cd) catch bun.outOfMemory();
            result.content_disposition = content_disposition_value;
            result._headers[result._headers_len] = .{ .name = "Content-Disposition", .value = content_disposition_value };
            result._headers_len += 1;
        }

        if (storage_class) |storage_class_value| {
            result._headers[result._headers_len] = .{ .name = "x-amz-storage-class", .value = storage_class_value };
            result._headers_len += 1;
        }

        if (content_md5) |c_md5| {
            const content_md5_value = bun.default_allocator.dupe(u8, c_md5) catch bun.outOfMemory();
            result.content_md5 = content_md5_value;
            result._headers[result._headers_len] = .{ .name = "content-md5", .value = content_md5_value };
            result._headers_len += 1;
        }

        return result;
    }
};

pub const S3CredentialsWithOptions = struct {
    credentials: S3Credentials,
    options: MultiPartUploadOptions = .{},
    acl: ?ACL = null,
    storage_class: ?StorageClass = null,
    /// indicates if the credentials have changed
    changed_credentials: bool = false,
    /// indicates if the virtual hosted style is used
    virtual_hosted_style: bool = false,
    _accessKeyIdSlice: ?JSC.ZigString.Slice = null,
    _secretAccessKeySlice: ?JSC.ZigString.Slice = null,
    _regionSlice: ?JSC.ZigString.Slice = null,
    _endpointSlice: ?JSC.ZigString.Slice = null,
    _bucketSlice: ?JSC.ZigString.Slice = null,
    _sessionTokenSlice: ?JSC.ZigString.Slice = null,

    pub fn deinit(this: *@This()) void {
        if (this._accessKeyIdSlice) |slice| slice.deinit();
        if (this._secretAccessKeySlice) |slice| slice.deinit();
        if (this._regionSlice) |slice| slice.deinit();
        if (this._endpointSlice) |slice| slice.deinit();
        if (this._bucketSlice) |slice| slice.deinit();
        if (this._sessionTokenSlice) |slice| slice.deinit();
    }
};
