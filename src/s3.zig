const bun = @import("root").bun;
const picohttp = bun.picohttp;
const std = @import("std");
const DotEnv = @import("./env_loader.zig");
pub const RareData = @import("./bun.js/rare_data.zig");

const JSC = bun.JSC;
const strings = bun.strings;

pub const AWSCredentials = struct {
    accessKeyId: []const u8,
    secretAccessKey: []const u8,
    region: []const u8,
    endpoint: []const u8,
    bucket: []const u8,

    ref_count: u32 = 1,
    pub usingnamespace bun.NewRefCounted(@This(), @This().deinit);

    pub fn estimatedSize(this: *const @This()) usize {
        return @sizeOf(AWSCredentials) + this.accessKeyId.len + this.region.len + this.secretAccessKey.len + this.endpoint.len + this.bucket.len;
    }

    pub const AWSCredentialsWithOptions = struct {
        credentials: AWSCredentials,
        options: MultiPartUpload.MultiPartUploadOptions = .{},

        _accessKeyIdSlice: ?JSC.ZigString.Slice = null,
        _secretAccessKeySlice: ?JSC.ZigString.Slice = null,
        _regionSlice: ?JSC.ZigString.Slice = null,
        _endpointSlice: ?JSC.ZigString.Slice = null,
        _bucketSlice: ?JSC.ZigString.Slice = null,

        pub fn deinit(this: *@This()) void {
            if (this._accessKeyIdSlice) |slice| slice.deinit();
            if (this._secretAccessKeySlice) |slice| slice.deinit();
            if (this._regionSlice) |slice| slice.deinit();
            if (this._endpointSlice) |slice| slice.deinit();
            if (this._bucketSlice) |slice| slice.deinit();
        }
    };
    pub fn getCredentialsWithOptions(this: AWSCredentials, options: ?JSC.JSValue, globalObject: *JSC.JSGlobalObject) bun.JSError!AWSCredentialsWithOptions {
        // get ENV config
        var new_credentials = AWSCredentialsWithOptions{
            .credentials = this,
            .options = .{},
        };
        errdefer {
            new_credentials.deinit();
        }

        if (options) |opts| {
            if (opts.isObject()) {
                if (try opts.getTruthyComptime(globalObject, "accessKeyId")) |js_value| {
                    if (!js_value.isEmptyOrUndefinedOrNull()) {
                        if (js_value.isString()) {
                            const str = bun.String.fromJS(js_value, globalObject);
                            defer str.deref();
                            if (str.tag != .Empty and str.tag != .Dead) {
                                new_credentials._accessKeyIdSlice = str.toUTF8(bun.default_allocator);
                                new_credentials.credentials.accessKeyId = new_credentials._accessKeyIdSlice.?.slice();
                            }
                        } else {
                            return globalObject.throwInvalidArgumentTypeValue("accessKeyId", "string", js_value);
                        }
                    }
                }
                if (try opts.getTruthyComptime(globalObject, "secretAccessKey")) |js_value| {
                    if (!js_value.isEmptyOrUndefinedOrNull()) {
                        if (js_value.isString()) {
                            const str = bun.String.fromJS(js_value, globalObject);
                            defer str.deref();
                            if (str.tag != .Empty and str.tag != .Dead) {
                                new_credentials._secretAccessKeySlice = str.toUTF8(bun.default_allocator);
                                new_credentials.credentials.secretAccessKey = new_credentials._secretAccessKeySlice.?.slice();
                            }
                        } else {
                            return globalObject.throwInvalidArgumentTypeValue("secretAccessKey", "string", js_value);
                        }
                    }
                }
                if (try opts.getTruthyComptime(globalObject, "region")) |js_value| {
                    if (!js_value.isEmptyOrUndefinedOrNull()) {
                        if (js_value.isString()) {
                            const str = bun.String.fromJS(js_value, globalObject);
                            defer str.deref();
                            if (str.tag != .Empty and str.tag != .Dead) {
                                new_credentials._regionSlice = str.toUTF8(bun.default_allocator);
                                new_credentials.credentials.region = new_credentials._regionSlice.?.slice();
                            }
                        } else {
                            return globalObject.throwInvalidArgumentTypeValue("region", "string", js_value);
                        }
                    }
                }
                if (try opts.getTruthyComptime(globalObject, "endpoint")) |js_value| {
                    if (!js_value.isEmptyOrUndefinedOrNull()) {
                        if (js_value.isString()) {
                            const str = bun.String.fromJS(js_value, globalObject);
                            defer str.deref();
                            if (str.tag != .Empty and str.tag != .Dead) {
                                new_credentials._endpointSlice = str.toUTF8(bun.default_allocator);
                                const normalized_endpoint = bun.URL.parse(new_credentials._endpointSlice.?.slice()).host;
                                if (normalized_endpoint.len > 0) {
                                    new_credentials.credentials.endpoint = normalized_endpoint;
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
                            const str = bun.String.fromJS(js_value, globalObject);
                            defer str.deref();
                            if (str.tag != .Empty and str.tag != .Dead) {
                                new_credentials._bucketSlice = str.toUTF8(bun.default_allocator);
                                new_credentials.credentials.bucket = new_credentials._bucketSlice.?.slice();
                            }
                        } else {
                            return globalObject.throwInvalidArgumentTypeValue("bucket", "string", js_value);
                        }
                    }
                }

                if (try opts.getOptional(globalObject, "pageSize", i32)) |pageSize| {
                    if (pageSize < MultiPartUpload.MIN_SINGLE_UPLOAD_SIZE_IN_MiB and pageSize > MultiPartUpload.MAX_SINGLE_UPLOAD_SIZE_IN_MiB) {
                        return globalObject.throwRangeError(pageSize, .{
                            .min = @intCast(MultiPartUpload.MIN_SINGLE_UPLOAD_SIZE_IN_MiB),
                            .max = @intCast(MultiPartUpload.MAX_SINGLE_UPLOAD_SIZE_IN_MiB),
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
            }
        }
        return new_credentials;
    }
    pub fn dupe(this: *const @This()) *AWSCredentials {
        return AWSCredentials.new(.{
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
        });
    }
    pub fn deinit(this: *@This()) void {
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
        this.destroy();
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

        content_disposition: []const u8,
        _headers: [5]picohttp.Header,
        _headers_len: u8 = 4,

        pub fn headers(this: *const @This()) []const picohttp.Header {
            return this._headers[0..this._headers_len];
        }

        pub fn deinit(this: *const @This()) void {
            if (this.amz_date.len > 0) {
                bun.default_allocator.free(this.amz_date);
            }

            if (this.content_disposition.len > 0) {
                bun.default_allocator.free(this.content_disposition);
            }

            if (this.host.len > 0) {
                bun.default_allocator.free(this.host);
            }

            if (this.authorization.len > 0) {
                bun.default_allocator.free(this.authorization);
            }

            if (this.url.len > 0) {
                bun.default_allocator.free(this.url);
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
        search_params: ?[]const u8 = null,
        content_disposition: ?[]const u8 = null,
    };
    fn guessRegion(endpoint: []const u8) []const u8 {
        if (endpoint.len > 0) {
            if (strings.endsWith(endpoint, ".r2.cloudflarestorage.com")) return "auto";
            if (strings.indexOf(endpoint, ".amazonaws.com")) |end| {
                if (strings.indexOf(endpoint, "s3.")) |start| {
                    return endpoint[start + 3 .. end];
                }
            }
        }
        return "us-east-1";
    }
    fn toHexChar(value: u8) !u8 {
        return switch (value) {
            0...9 => value + '0',
            10...15 => (value - 10) + 'A',
            else => error.InvalidHexChar,
        };
    }
    fn encodeURIComponent(input: []const u8, buffer: []u8) ![]const u8 {
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

    const ErrorCodeAndMessage = struct {
        code: []const u8,
        message: []const u8,
    };
    fn getSignErrorMessage(comptime err: anyerror) [:0]const u8 {
        return switch (err) {
            error.MissingCredentials => return "missing s3 credentials",
            error.InvalidMethod => return "method must be GET, PUT, DELETE or HEAD when using s3 protocol",
            error.InvalidPath => return "invalid s3 bucket, key combination",
            error.InvalidEndpoint => return "invalid s3 endpoint",
            else => return "failed to retrieve s3 content check your credentials",
        };
    }
    pub fn getJSSignError(err: anyerror, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return switch (err) {
            error.MissingCredentials => return globalThis.ERR_AWS_MISSING_CREDENTIALS(getSignErrorMessage(error.MissingCredentials), .{}).toJS(),
            error.InvalidMethod => return globalThis.ERR_AWS_INVALID_METHOD(getSignErrorMessage(error.InvalidMethod), .{}).toJS(),
            error.InvalidPath => return globalThis.ERR_AWS_INVALID_PATH(getSignErrorMessage(error.InvalidPath), .{}).toJS(),
            error.InvalidEndpoint => return globalThis.ERR_AWS_INVALID_ENDPOINT(getSignErrorMessage(error.InvalidEndpoint), .{}).toJS(),
            else => return globalThis.ERR_AWS_INVALID_SIGNATURE(getSignErrorMessage(error.SignError), .{}).toJS(),
        };
    }
    pub fn throwSignError(err: anyerror, globalThis: *JSC.JSGlobalObject) bun.JSError {
        return switch (err) {
            error.MissingCredentials => globalThis.ERR_AWS_MISSING_CREDENTIALS(getSignErrorMessage(error.MissingCredentials), .{}).throw(),
            error.InvalidMethod => globalThis.ERR_AWS_INVALID_METHOD(getSignErrorMessage(error.InvalidMethod), .{}).throw(),
            error.InvalidPath => globalThis.ERR_AWS_INVALID_PATH(getSignErrorMessage(error.InvalidPath), .{}).throw(),
            error.InvalidEndpoint => globalThis.ERR_AWS_INVALID_ENDPOINT(getSignErrorMessage(error.InvalidEndpoint), .{}).throw(),
            else => globalThis.ERR_AWS_INVALID_SIGNATURE(getSignErrorMessage(error.SignError), .{}).throw(),
        };
    }
    pub fn getSignErrorCodeAndMessage(err: anyerror) ErrorCodeAndMessage {
        return switch (err) {
            error.MissingCredentials => .{ .code = "MissingCredentials", .message = getSignErrorMessage(error.MissingCredentials) },
            error.InvalidMethod => .{ .code = "InvalidMethod", .message = getSignErrorMessage(error.InvalidMethod) },
            error.InvalidPath => .{ .code = "InvalidPath", .message = getSignErrorMessage(error.InvalidPath) },
            error.InvalidEndpoint => .{ .code = "InvalidEndpoint", .message = getSignErrorMessage(error.InvalidEndpoint) },
            else => .{ .code = "SignError", .message = getSignErrorMessage(error.SignError) },
        };
    }
    pub fn signRequest(this: *const @This(), signOptions: SignOptions, signQueryOption: ?SignQueryOptions) !SignResult {
        const method = signOptions.method;
        const request_path = signOptions.path;
        const content_hash = signOptions.content_hash;
        const search_params = signOptions.search_params;

        var content_disposition = signOptions.content_disposition;
        if (content_disposition != null and content_disposition.?.len == 0) {
            content_disposition = null;
        }

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
        if (strings.startsWith(full_path, "/")) {
            full_path = full_path[1..];
        }
        var path: []const u8 = full_path;
        var bucket: []const u8 = this.bucket;

        if (bucket.len == 0) {
            //TODO: r2 supports bucket in the endpoint

            // guess bucket using path
            if (strings.indexOf(full_path, "/")) |end| {
                bucket = full_path[0..end];
                path = full_path[end + 1 ..];
            } else {
                return error.InvalidPath;
            }
        }
        if (strings.endsWith(path, "/")) {
            path = path[0..path.len];
        }
        if (strings.startsWith(path, "/")) {
            path = path[1..];
        }

        // if we allow path.len == 0 it will list the bucket for now we disallow
        if (path.len == 0) return error.InvalidPath;

        var path_buffer: [1024 + 63 + 2]u8 = undefined; // 1024 max key size and 63 max bucket name

        const normalizedPath = std.fmt.bufPrint(&path_buffer, "/{s}/{s}", .{ bucket, path }) catch return error.InvalidPath;

        const date_result = getAMZDate(bun.default_allocator);
        const amz_date = date_result.date;
        errdefer bun.default_allocator.free(amz_date);

        const amz_day = amz_date[0..8];
        const signed_headers = if (signQuery) "host" else brk: {
            if (content_disposition != null) {
                break :brk "content-disposition;host;x-amz-content-sha256;x-amz-date";
            } else {
                break :brk "host;x-amz-content-sha256;x-amz-date";
            }
        };
        // detect service name and host from region or endpoint
        var encoded_host_buffer: [512]u8 = undefined;
        var encoded_host: []const u8 = "";
        const host = brk_host: {
            if (this.endpoint.len > 0) {
                encoded_host = encodeURIComponent(this.endpoint, &encoded_host_buffer) catch return error.InvalidEndpoint;
                break :brk_host try bun.default_allocator.dupe(u8, this.endpoint);
            } else {
                break :brk_host try std.fmt.allocPrint(bun.default_allocator, "s3.{s}.amazonaws.com", .{region});
            }
        };
        const service_name = "s3";

        errdefer bun.default_allocator.free(host);

        const aws_content_hash = if (content_hash) |hash| hash else ("UNSIGNED-PAYLOAD");
        var tmp_buffer: [2048]u8 = undefined;

        const authorization = brk: {
            // we hash the hash so we need 2 buffers
            var hmac_sig_service: [bun.BoringSSL.EVP_MAX_MD_SIZE]u8 = undefined;
            var hmac_sig_service2: [bun.BoringSSL.EVP_MAX_MD_SIZE]u8 = undefined;

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
                const canonical = try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nX-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, this.accessKeyId, amz_day, region, service_name, amz_date, expires, if (encoded_host.len > 0) encoded_host else host, signed_headers, aws_content_hash });
                var sha_digest = std.mem.zeroes(bun.sha.SHA256.Digest);
                bun.sha.SHA256.hash(canonical, &sha_digest, JSC.VirtualMachine.get().rareData().boringEngine());

                const signValue = try std.fmt.bufPrint(&tmp_buffer, "AWS4-HMAC-SHA256\n{s}\n{s}/{s}/{s}/aws4_request\n{s}", .{ amz_date, amz_day, region, service_name, bun.fmt.bytesToHex(sha_digest[0..bun.sha.SHA256.digest], .lower) });

                const signature = bun.hmac.generate(sigDateRegionServiceReq, signValue, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;
                break :brk try std.fmt.allocPrint(
                    bun.default_allocator,
                    "https://{s}{s}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&X-Amz-Signature={s}",
                    .{ host, normalizedPath, this.accessKeyId, amz_day, region, service_name, amz_date, expires, bun.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
                );
            } else {
                var encoded_content_disposition_buffer: [255]u8 = undefined;
                const encoded_content_disposition: []const u8 = if (content_disposition) |cd| encodeURIComponent(cd, &encoded_content_disposition_buffer) catch return error.ContentTypeIsTooLong else "";
                const canonical = brk_canonical: {
                    if (content_disposition != null) {
                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\ncontent-disposition:{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", encoded_content_disposition, if (encoded_host.len > 0) encoded_host else host, aws_content_hash, amz_date, signed_headers, aws_content_hash });
                    } else {
                        break :brk_canonical try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (search_params) |p| p[1..] else "", if (encoded_host.len > 0) encoded_host else host, aws_content_hash, amz_date, signed_headers, aws_content_hash });
                    }
                };
                var sha_digest = std.mem.zeroes(bun.sha.SHA256.Digest);
                bun.sha.SHA256.hash(canonical, &sha_digest, JSC.VirtualMachine.get().rareData().boringEngine());

                const signValue = try std.fmt.bufPrint(&tmp_buffer, "AWS4-HMAC-SHA256\n{s}\n{s}/{s}/{s}/aws4_request\n{s}", .{ amz_date, amz_day, region, service_name, bun.fmt.bytesToHex(sha_digest[0..bun.sha.SHA256.digest], .lower) });

                const signature = bun.hmac.generate(sigDateRegionServiceReq, signValue, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;

                break :brk try std.fmt.allocPrint(
                    bun.default_allocator,
                    "AWS4-HMAC-SHA256 Credential={s}/{s}/{s}/{s}/aws4_request, SignedHeaders={s}, Signature={s}",
                    .{ this.accessKeyId, amz_day, region, service_name, signed_headers, bun.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
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
                .url = authorization,
                .content_disposition = "",
                ._headers = .{
                    .{ .name = "", .value = "" },
                    .{ .name = "", .value = "" },
                    .{ .name = "", .value = "" },
                    .{ .name = "", .value = "" },
                    .{ .name = "", .value = "" },
                },
                ._headers_len = 0,
            };
        }

        if (content_disposition) |cd| {
            const content_disposition_value = bun.default_allocator.dupe(u8, cd) catch bun.outOfMemory();
            return SignResult{
                .amz_date = amz_date,
                .host = host,
                .authorization = authorization,
                .url = try std.fmt.allocPrint(bun.default_allocator, "https://{s}{s}{s}", .{ host, normalizedPath, if (search_params) |s| s else "" }),
                .content_disposition = content_disposition_value,
                ._headers = .{
                    .{ .name = "x-amz-content-sha256", .value = aws_content_hash },
                    .{ .name = "x-amz-date", .value = amz_date },
                    .{ .name = "Authorization", .value = authorization[0..] },
                    .{ .name = "Host", .value = host },
                    .{ .name = "Content-Disposition", .value = content_disposition_value },
                },
                ._headers_len = 5,
            };
        }
        return SignResult{
            .amz_date = amz_date,
            .host = host,
            .authorization = authorization,
            .url = try std.fmt.allocPrint(bun.default_allocator, "https://{s}{s}{s}", .{ host, normalizedPath, if (search_params) |s| s else "" }),
            .content_disposition = "",
            ._headers = .{
                .{ .name = "x-amz-content-sha256", .value = aws_content_hash },
                .{ .name = "x-amz-date", .value = amz_date },
                .{ .name = "Authorization", .value = authorization[0..] },
                .{ .name = "Host", .value = host },
                .{ .name = "", .value = "" },
            },
            ._headers_len = 4,
        };
    }
    pub const S3Error = struct {
        code: []const u8,
        message: []const u8,

        pub fn toJS(err: *const @This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            const js_err = globalObject.createErrorInstance("{s}", .{err.message});
            js_err.put(globalObject, JSC.ZigString.static("code"), JSC.ZigString.init(err.code).toJS(globalObject));
            return js_err;
        }
    };
    pub const S3StatResult = union(enum) {
        success: struct {
            size: usize = 0,
            /// etag is not owned and need to be copied if used after this callback
            etag: []const u8 = "",
        },
        not_found: void,

        /// failure error is not owned and need to be copied if used after this callback
        failure: S3Error,
    };
    pub const S3DownloadResult = union(enum) {
        success: struct {
            /// etag is not owned and need to be copied if used after this callback
            etag: []const u8 = "",
            /// body is owned and dont need to be copied, but dont forget to free it
            body: bun.MutableString,
        },
        not_found: void,
        /// failure error is not owned and need to be copied if used after this callback
        failure: S3Error,
    };
    pub const S3UploadResult = union(enum) {
        success: void,
        /// failure error is not owned and need to be copied if used after this callback
        failure: S3Error,
    };
    pub const S3DeleteResult = union(enum) {
        success: void,
        not_found: void,

        /// failure error is not owned and need to be copied if used after this callback
        failure: S3Error,
    };
    // commit result also fails if status 200 but with body containing an Error
    pub const S3CommitResult = union(enum) {
        success: void,
        /// failure error is not owned and need to be copied if used after this callback
        failure: S3Error,
    };
    // commit result also fails if status 200 but with body containing an Error
    pub const S3PartResult = union(enum) {
        etag: []const u8,
        /// failure error is not owned and need to be copied if used after this callback
        failure: S3Error,
    };
    pub const S3HttpSimpleTask = struct {
        http: bun.http.AsyncHTTP,
        vm: *JSC.VirtualMachine,
        sign_result: SignResult,
        headers: JSC.WebCore.Headers,
        callback_context: *anyopaque,
        callback: Callback,
        response_buffer: bun.MutableString = .{
            .allocator = bun.default_allocator,
            .list = .{
                .items = &.{},
                .capacity = 0,
            },
        },
        result: bun.http.HTTPClientResult = .{},
        concurrent_task: JSC.ConcurrentTask = .{},
        range: ?[]const u8,
        poll_ref: bun.Async.KeepAlive = bun.Async.KeepAlive.init(),

        usingnamespace bun.New(@This());
        pub const Callback = union(enum) {
            stat: *const fn (S3StatResult, *anyopaque) void,
            download: *const fn (S3DownloadResult, *anyopaque) void,
            upload: *const fn (S3UploadResult, *anyopaque) void,
            delete: *const fn (S3DeleteResult, *anyopaque) void,
            commit: *const fn (S3CommitResult, *anyopaque) void,
            part: *const fn (S3PartResult, *anyopaque) void,

            pub fn fail(this: @This(), code: []const u8, message: []const u8, context: *anyopaque) void {
                switch (this) {
                    inline .upload,
                    .download,
                    .stat,
                    .delete,
                    .commit,
                    .part,
                    => |callback| callback(.{
                        .failure = .{
                            .code = code,
                            .message = message,
                        },
                    }, context),
                }
            }
        };
        pub fn deinit(this: *@This()) void {
            if (this.result.certificate_info) |*certificate| {
                certificate.deinit(bun.default_allocator);
            }
            this.poll_ref.unref(this.vm);
            this.response_buffer.deinit();
            this.headers.deinit();
            this.sign_result.deinit();
            this.http.clearData();
            if (this.range) |range| {
                bun.default_allocator.free(range);
            }
            if (this.result.metadata) |*metadata| {
                metadata.deinit(bun.default_allocator);
            }
            this.destroy();
        }

        fn fail(this: *@This()) void {
            var code: []const u8 = "UnknownError";
            var message: []const u8 = "an unexpected error has occurred";
            if (this.result.fail) |err| {
                code = @errorName(err);
            } else if (this.result.body) |body| {
                const bytes = body.list.items;
                if (bytes.len > 0) {
                    message = bytes[0..];
                    if (strings.indexOf(bytes, "<Code>")) |start| {
                        if (strings.indexOf(bytes, "</Code>")) |end| {
                            code = bytes[start + "<Code>".len .. end];
                        }
                    }
                    if (strings.indexOf(bytes, "<Message>")) |start| {
                        if (strings.indexOf(bytes, "</Message>")) |end| {
                            message = bytes[start + "<Message>".len .. end];
                        }
                    }
                }
            }
            this.callback.fail(code, message, this.callback_context);
        }

        fn failIfContainsError(this: *@This(), status: u32) bool {
            var code: []const u8 = "UnknownError";
            var message: []const u8 = "an unexpected error has occurred";

            if (this.result.fail) |err| {
                code = @errorName(err);
            } else if (this.result.body) |body| {
                const bytes = body.list.items;
                var has_error = false;
                if (bytes.len > 0) {
                    message = bytes[0..];
                    if (strings.indexOf(bytes, "<Error>") != null) {
                        has_error = true;
                        if (strings.indexOf(bytes, "<Code>")) |start| {
                            if (strings.indexOf(bytes, "</Code>")) |end| {
                                code = bytes[start + "<Code>".len .. end];
                            }
                        }
                        if (strings.indexOf(bytes, "<Message>")) |start| {
                            if (strings.indexOf(bytes, "</Message>")) |end| {
                                message = bytes[start + "<Message>".len .. end];
                            }
                        }
                    }
                }
                if (!has_error and status == 200 or status == 206) {
                    return false;
                }
            } else if (status == 200 or status == 206) {
                return false;
            }
            this.callback.fail(code, message, this.callback_context);
            return true;
        }

        pub fn onResponse(this: *@This()) void {
            defer this.deinit();
            if (!this.result.isSuccess()) {
                this.fail();
                return;
            }
            bun.assert(this.result.metadata != null);
            const response = this.result.metadata.?.response;
            switch (this.callback) {
                .stat => |callback| {
                    switch (response.status_code) {
                        404 => {
                            callback(.{ .not_found = {} }, this.callback_context);
                        },
                        200 => {
                            callback(.{
                                .success = .{
                                    .etag = response.headers.get("etag") orelse "",
                                    .size = if (response.headers.get("content-length")) |content_len| (std.fmt.parseInt(usize, content_len, 10) catch 0) else 0,
                                },
                            }, this.callback_context);
                        },
                        else => {
                            this.fail();
                        },
                    }
                },
                .delete => |callback| {
                    switch (response.status_code) {
                        404 => {
                            callback(.{ .not_found = {} }, this.callback_context);
                        },
                        200, 204 => {
                            callback(.{ .success = {} }, this.callback_context);
                        },
                        else => {
                            this.fail();
                        },
                    }
                },
                .upload => |callback| {
                    switch (response.status_code) {
                        200 => {
                            callback(.{ .success = {} }, this.callback_context);
                        },
                        else => {
                            this.fail();
                        },
                    }
                },
                .download => |callback| {
                    switch (response.status_code) {
                        404 => {
                            callback(.{ .not_found = {} }, this.callback_context);
                        },
                        200, 204, 206 => {
                            const body = this.response_buffer;
                            this.response_buffer = .{
                                .allocator = bun.default_allocator,
                                .list = .{
                                    .items = &.{},
                                    .capacity = 0,
                                },
                            };
                            callback(.{
                                .success = .{
                                    .etag = response.headers.get("etag") orelse "",
                                    .body = body,
                                },
                            }, this.callback_context);
                        },
                        else => {
                            //error
                            this.fail();
                        },
                    }
                },
                .commit => |callback| {
                    // commit multipart upload can fail with status 200
                    if (!this.failIfContainsError(response.status_code)) {
                        callback(.{ .success = {} }, this.callback_context);
                    }
                },
                .part => |callback| {
                    if (!this.failIfContainsError(response.status_code)) {
                        if (response.headers.get("etag")) |etag| {
                            callback(.{ .etag = etag }, this.callback_context);
                        } else {
                            this.fail();
                        }
                    }
                },
            }
        }

        pub fn http_callback(this: *@This(), async_http: *bun.http.AsyncHTTP, result: bun.http.HTTPClientResult) void {
            const is_done = !result.has_more;
            this.result = result;
            this.http = async_http.*;
            this.response_buffer = async_http.response_buffer.*;
            if (is_done) {
                this.vm.eventLoop().enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
            }
        }
    };

    pub const S3HttpDownloadStreamingTask = struct {
        http: bun.http.AsyncHTTP,
        vm: *JSC.VirtualMachine,
        sign_result: SignResult,
        headers: JSC.WebCore.Headers,
        callback_context: *anyopaque,
        // this transfers ownership from the chunk
        callback: *const fn (chunk: bun.MutableString, has_more: bool, err: ?S3Error, *anyopaque) void,
        has_schedule_callback: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
        signal_store: bun.http.Signals.Store = .{},
        signals: bun.http.Signals = .{},
        poll_ref: bun.Async.KeepAlive = bun.Async.KeepAlive.init(),

        response_buffer: bun.MutableString = .{
            .allocator = bun.default_allocator,
            .list = .{
                .items = &.{},
                .capacity = 0,
            },
        },
        reported_response_lock: bun.Lock = .{},
        reported_response_buffer: bun.MutableString = .{
            .allocator = bun.default_allocator,
            .list = .{
                .items = &.{},
                .capacity = 0,
            },
        },
        state: State.AtomicType = State.AtomicType.init(0),

        concurrent_task: JSC.ConcurrentTask = .{},
        range: ?[]const u8,
        proxy_url: []const u8,

        usingnamespace bun.New(@This());
        pub const State = packed struct(u64) {
            pub const AtomicType = std.atomic.Value(u64);
            status_code: u32 = 0,
            request_error: u16 = 0,
            has_more: bool = false,
            _reserved: u15 = 0,
        };

        pub fn getState(this: @This()) State {
            const state: State = @bitCast(this.state.load(.acquire));
            return state;
        }

        pub fn setState(this: *@This(), state: State) void {
            this.state.store(@bitCast(state), .monotonic);
        }

        pub fn deinit(this: *@This()) void {
            this.poll_ref.unref(this.vm);
            this.response_buffer.deinit();
            this.reported_response_buffer.deinit();
            this.headers.deinit();
            this.sign_result.deinit();
            this.http.clearData();
            if (this.range) |range| {
                bun.default_allocator.free(range);
            }
            if (this.proxy_url.len > 0) {
                bun.default_allocator.free(this.proxy_url);
            }

            this.destroy();
        }

        fn reportProgress(this: *@This()) bool {
            var has_more = true;
            var err: ?S3Error = null;
            var failed = false;
            this.reported_response_lock.lock();
            defer this.reported_response_lock.unlock();
            const chunk = brk: {
                const state = this.getState();
                has_more = state.has_more;
                switch (state.status_code) {
                    200, 204, 206 => {
                        failed = state.request_error != 0;
                    },
                    else => {
                        failed = true;
                    },
                }
                if (failed) {
                    if (!has_more) {
                        var has_body_code = false;
                        var has_body_message = false;

                        var code: []const u8 = "UnknownError";
                        var message: []const u8 = "an unexpected error has occurred";
                        if (state.request_error != 0) {
                            const req_err = @errorFromInt(state.request_error);
                            code = @errorName(req_err);
                            has_body_code = true;
                        } else {
                            const bytes = this.reported_response_buffer.list.items;
                            if (bytes.len > 0) {
                                message = bytes[0..];

                                if (strings.indexOf(bytes, "<Code>")) |start| {
                                    if (strings.indexOf(bytes, "</Code>")) |end| {
                                        code = bytes[start + "<Code>".len .. end];
                                        has_body_code = true;
                                    }
                                }
                                if (strings.indexOf(bytes, "<Message>")) |start| {
                                    if (strings.indexOf(bytes, "</Message>")) |end| {
                                        message = bytes[start + "<Message>".len .. end];
                                        has_body_message = true;
                                    }
                                }
                            }
                        }
                        if (state.status_code == 404) {
                            if (!has_body_code) {
                                code = "FileNotFound";
                            }
                            if (!has_body_message) {
                                message = "File not found";
                            }
                        }
                        err = .{
                            .code = code,
                            .message = message,
                        };
                    }
                    break :brk bun.MutableString{ .allocator = bun.default_allocator, .list = .{} };
                } else {
                    const buffer = this.reported_response_buffer;
                    break :brk buffer;
                }
            };
            log("reportProgres failed: {} has_more: {} len: {d}", .{ failed, has_more, chunk.list.items.len });
            if (failed) {
                if (!has_more) {
                    this.callback(chunk, false, err, this.callback_context);
                }
            } else {
                // dont report empty chunks if we have more data to read
                if (!has_more or chunk.list.items.len > 0) {
                    this.callback(chunk, has_more, null, this.callback_context);
                    this.reported_response_buffer.reset();
                }
            }

            return has_more;
        }

        pub fn onResponse(this: *@This()) void {
            this.has_schedule_callback.store(false, .monotonic);
            const has_more = this.reportProgress();
            if (!has_more) this.deinit();
        }

        pub fn http_callback(this: *@This(), async_http: *bun.http.AsyncHTTP, result: bun.http.HTTPClientResult) void {
            const is_done = !result.has_more;
            var state = this.getState();

            var wait_until_done = false;
            {
                state.has_more = !is_done;

                state.request_error = if (result.fail) |err| @intFromError(err) else 0;
                if (state.status_code == 0) {
                    if (result.certificate_info) |*certificate| {
                        certificate.deinit(bun.default_allocator);
                    }
                    if (result.metadata) |m| {
                        var metadata = m;
                        state.status_code = metadata.response.status_code;
                        metadata.deinit(bun.default_allocator);
                    }
                }
                switch (state.status_code) {
                    200, 204, 206 => wait_until_done = state.request_error != 0,
                    else => wait_until_done = true,
                }
                this.setState(state);
                this.http = async_http.*;
            }
            // if we got a error or fail wait until we are done buffering the response body to report
            const should_enqueue = !wait_until_done or is_done;
            log("state err: {} status_code: {} has_more: {} should_enqueue: {}", .{ state.request_error, state.status_code, state.has_more, should_enqueue });
            if (should_enqueue) {
                if (result.body) |body| {
                    this.reported_response_lock.lock();
                    defer this.reported_response_lock.unlock();
                    this.response_buffer = body.*;
                    if (body.list.items.len > 0) {
                        _ = this.reported_response_buffer.write(body.list.items) catch bun.outOfMemory();
                    }
                    this.response_buffer.reset();
                    if (this.reported_response_buffer.list.items.len == 0 and !is_done) {
                        return;
                    }
                } else if (!is_done) {
                    return;
                }
                if (this.has_schedule_callback.cmpxchgStrong(false, true, .acquire, .monotonic)) |has_schedule_callback| {
                    if (has_schedule_callback) {
                        return;
                    }
                }
                this.vm.eventLoop().enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
            }
        }
    };

    pub const S3SimpleRequestOptions = struct {
        // signing options
        path: []const u8,
        method: bun.http.Method,
        search_params: ?[]const u8 = null,
        content_type: ?[]const u8 = null,
        content_disposition: ?[]const u8 = null,

        // http request options
        body: []const u8,
        proxy_url: ?[]const u8 = null,
        range: ?[]const u8 = null,
    };

    pub fn executeSimpleS3Request(
        this: *const @This(),
        options: S3SimpleRequestOptions,
        callback: S3HttpSimpleTask.Callback,
        callback_context: *anyopaque,
    ) void {
        var result = this.signRequest(.{
            .path = options.path,
            .method = options.method,
            .search_params = options.search_params,
            .content_disposition = options.content_disposition,
        }, null) catch |sign_err| {
            if (options.range) |range_| bun.default_allocator.free(range_);
            const error_code_and_message = getSignErrorCodeAndMessage(sign_err);
            callback.fail(error_code_and_message.code, error_code_and_message.message, callback_context);
            return;
        };

        const headers = brk: {
            if (options.range) |range_| {
                const _headers = result.headers();
                var headersWithRange: [5]picohttp.Header = .{
                    _headers[0],
                    _headers[1],
                    _headers[2],
                    _headers[3],
                    .{ .name = "range", .value = range_ },
                };
                break :brk JSC.WebCore.Headers.fromPicoHttpHeaders(&headersWithRange, bun.default_allocator) catch bun.outOfMemory();
            } else {
                if (options.content_type) |content_type| {
                    if (content_type.len > 0) {
                        const _headers = result.headers();
                        if (_headers.len > 4) {
                            var headersWithContentType: [6]picohttp.Header = .{
                                _headers[0],
                                _headers[1],
                                _headers[2],
                                _headers[3],
                                _headers[4],
                                .{ .name = "Content-Type", .value = content_type },
                            };
                            break :brk JSC.WebCore.Headers.fromPicoHttpHeaders(&headersWithContentType, bun.default_allocator) catch bun.outOfMemory();
                        }

                        var headersWithContentType: [5]picohttp.Header = .{
                            _headers[0],
                            _headers[1],
                            _headers[2],
                            _headers[3],
                            .{ .name = "Content-Type", .value = content_type },
                        };
                        break :brk JSC.WebCore.Headers.fromPicoHttpHeaders(&headersWithContentType, bun.default_allocator) catch bun.outOfMemory();
                    }
                }

                break :brk JSC.WebCore.Headers.fromPicoHttpHeaders(result.headers(), bun.default_allocator) catch bun.outOfMemory();
            }
        };
        const task = S3HttpSimpleTask.new(.{
            .http = undefined,
            .sign_result = result,
            .callback_context = callback_context,
            .callback = callback,
            .range = options.range,
            .headers = headers,
            .vm = JSC.VirtualMachine.get(),
        });
        task.poll_ref.ref(task.vm);

        const url = bun.URL.parse(result.url);
        const proxy = options.proxy_url orelse "";
        task.http = bun.http.AsyncHTTP.init(
            bun.default_allocator,
            options.method,
            url,
            task.headers.entries,
            task.headers.buf.items,
            &task.response_buffer,
            options.body,
            bun.http.HTTPClientResult.Callback.New(
                *S3HttpSimpleTask,
                S3HttpSimpleTask.http_callback,
            ).init(task),
            .follow,
            .{
                .http_proxy = if (proxy.len > 0) bun.URL.parse(proxy) else null,
                .verbose = .none,
                .reject_unauthorized = task.vm.getTLSRejectUnauthorized(),
            },
        );
        // queue http request
        bun.http.HTTPThread.init(&.{});
        var batch = bun.ThreadPool.Batch{};
        task.http.schedule(bun.default_allocator, &batch);
        bun.http.http_thread.schedule(batch);
    }

    pub fn s3Stat(this: *const @This(), path: []const u8, callback: *const fn (S3StatResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(.{
            .path = path,
            .method = .HEAD,
            .proxy_url = proxy_url,
            .body = "",
        }, .{ .stat = callback }, callback_context);
    }

    pub fn s3Download(this: *const @This(), path: []const u8, callback: *const fn (S3DownloadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(.{
            .path = path,
            .method = .GET,
            .proxy_url = proxy_url,
            .body = "",
        }, .{ .download = callback }, callback_context);
    }

    pub fn s3DownloadSlice(this: *const @This(), path: []const u8, offset: usize, size: ?usize, callback: *const fn (S3DownloadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        const range = brk: {
            if (size) |size_| {
                if (offset == 0) break :brk null;

                var end = (offset + size_);
                if (size_ > 0) {
                    end -= 1;
                }
                break :brk std.fmt.allocPrint(bun.default_allocator, "bytes={}-{}", .{ offset, end }) catch bun.outOfMemory();
            }
            if (offset == 0) break :brk null;
            break :brk std.fmt.allocPrint(bun.default_allocator, "bytes={}-", .{offset}) catch bun.outOfMemory();
        };

        this.executeSimpleS3Request(.{
            .path = path,
            .method = .GET,
            .proxy_url = proxy_url,
            .body = "",
            .range = range,
        }, .{ .download = callback }, callback_context);
    }

    pub fn s3StreamDownload(this: *@This(), path: []const u8, offset: usize, size: ?usize, proxy_url: ?[]const u8, callback: *const fn (chunk: bun.MutableString, has_more: bool, err: ?S3Error, *anyopaque) void, callback_context: *anyopaque) void {
        const range = brk: {
            if (size) |size_| {
                if (offset == 0) break :brk null;

                var end = (offset + size_);
                if (size_ > 0) {
                    end -= 1;
                }
                break :brk std.fmt.allocPrint(bun.default_allocator, "bytes={}-{}", .{ offset, end }) catch bun.outOfMemory();
            }
            if (offset == 0) break :brk null;
            break :brk std.fmt.allocPrint(bun.default_allocator, "bytes={}-", .{offset}) catch bun.outOfMemory();
        };

        var result = this.signRequest(.{
            .path = path,
            .method = .GET,
        }, null) catch |sign_err| {
            if (range) |range_| bun.default_allocator.free(range_);
            const error_code_and_message = getSignErrorCodeAndMessage(sign_err);
            callback(.{ .allocator = bun.default_allocator, .list = .{} }, false, .{ .code = error_code_and_message.code, .message = error_code_and_message.message }, callback_context);
            return;
        };

        const headers = brk: {
            if (range) |range_| {
                const _headers = result.headers();
                var headersWithRange: [5]picohttp.Header = .{
                    _headers[0],
                    _headers[1],
                    _headers[2],
                    _headers[3],
                    .{ .name = "range", .value = range_ },
                };
                break :brk JSC.WebCore.Headers.fromPicoHttpHeaders(&headersWithRange, bun.default_allocator) catch bun.outOfMemory();
            } else {
                break :brk JSC.WebCore.Headers.fromPicoHttpHeaders(result.headers(), bun.default_allocator) catch bun.outOfMemory();
            }
        };
        const proxy = proxy_url orelse "";
        const owned_proxy = if (proxy.len > 0) bun.default_allocator.dupe(u8, proxy) catch bun.outOfMemory() else "";
        const task = S3HttpDownloadStreamingTask.new(.{
            .http = undefined,
            .sign_result = result,
            .proxy_url = owned_proxy,
            .callback_context = callback_context,
            .callback = callback,
            .range = range,
            .headers = headers,
            .vm = JSC.VirtualMachine.get(),
        });
        task.poll_ref.ref(task.vm);

        const url = bun.URL.parse(result.url);

        task.signals = task.signal_store.to();

        task.http = bun.http.AsyncHTTP.init(
            bun.default_allocator,
            .GET,
            url,
            task.headers.entries,
            task.headers.buf.items,
            &task.response_buffer,
            "",
            bun.http.HTTPClientResult.Callback.New(
                *S3HttpDownloadStreamingTask,
                S3HttpDownloadStreamingTask.http_callback,
            ).init(task),
            .follow,
            .{
                .http_proxy = if (owned_proxy.len > 0) bun.URL.parse(owned_proxy) else null,
                .verbose = .none,
                .signals = task.signals,
                .reject_unauthorized = task.vm.getTLSRejectUnauthorized(),
            },
        );
        // enable streaming
        task.http.enableBodyStreaming();
        // queue http request
        bun.http.HTTPThread.init(&.{});
        var batch = bun.ThreadPool.Batch{};
        task.http.schedule(bun.default_allocator, &batch);
        bun.http.http_thread.schedule(batch);
    }

    pub fn s3ReadableStream(this: *@This(), path: []const u8, offset: usize, size: ?usize, proxy_url: ?[]const u8, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        var reader = JSC.WebCore.ByteStream.Source.new(.{
            .context = undefined,
            .globalThis = globalThis,
        });

        reader.context.setup();
        const readable_value = reader.toReadableStream(globalThis);

        this.s3StreamDownload(path, offset, size, proxy_url, @ptrCast(&S3DownloadStreamWrapper.callback), S3DownloadStreamWrapper.new(.{
            .readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(.{
                .ptr = .{ .Bytes = &reader.context },
                .value = readable_value,
            }, globalThis),
        }));
        return readable_value;
    }

    const S3DownloadStreamWrapper = struct {
        readable_stream_ref: JSC.WebCore.ReadableStream.Strong,
        pub usingnamespace bun.New(@This());

        pub fn callback(chunk: bun.MutableString, has_more: bool, request_err: ?S3Error, this: *@This()) void {
            defer if (!has_more) this.deinit();

            if (this.readable_stream_ref.get()) |readable| {
                if (readable.ptr == .Bytes) {
                    const globalThis = this.readable_stream_ref.globalThis().?;

                    if (request_err) |err| {
                        log("S3DownloadStreamWrapper.callback .temporary", .{});

                        readable.ptr.Bytes.onData(
                            .{
                                .err = .{ .JSValue = err.toJS(globalThis) },
                            },
                            bun.default_allocator,
                        );
                        return;
                    }
                    if (has_more) {
                        log("S3DownloadStreamWrapper.callback .temporary", .{});

                        readable.ptr.Bytes.onData(
                            .{
                                .temporary = bun.ByteList.initConst(chunk.list.items),
                            },
                            bun.default_allocator,
                        );
                        return;
                    }
                    log("S3DownloadStreamWrapper.callback .temporary_and_done", .{});

                    readable.ptr.Bytes.onData(
                        .{
                            .temporary_and_done = bun.ByteList.initConst(chunk.list.items),
                        },
                        bun.default_allocator,
                    );
                    return;
                }
            }
            log("S3DownloadStreamWrapper.callback invalid readable stream", .{});
        }

        pub fn deinit(this: *@This()) void {
            this.readable_stream_ref.deinit();
            this.destroy();
        }
    };

    pub fn s3Delete(this: *const @This(), path: []const u8, callback: *const fn (S3DeleteResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(.{
            .path = path,
            .method = .DELETE,
            .proxy_url = proxy_url,
            .body = "",
        }, .{ .delete = callback }, callback_context);
    }

    pub fn s3Upload(this: *const @This(), path: []const u8, content: []const u8, content_type: ?[]const u8, proxy_url: ?[]const u8, callback: *const fn (S3UploadResult, *anyopaque) void, callback_context: *anyopaque) void {
        this.executeSimpleS3Request(.{
            .path = path,
            .method = .PUT,
            .proxy_url = proxy_url,
            .body = content,
            .content_type = content_type,
        }, .{ .upload = callback }, callback_context);
    }

    const S3UploadStreamWrapper = struct {
        readable_stream_ref: JSC.WebCore.ReadableStream.Strong,
        sink: *JSC.WebCore.FetchTaskletChunkedRequestSink,
        callback: ?*const fn (S3UploadResult, *anyopaque) void,
        callback_context: *anyopaque,
        ref_count: u32 = 1,
        pub usingnamespace bun.NewRefCounted(@This(), @This().deinit);
        pub fn resolve(result: S3UploadResult, self: *@This()) void {
            const sink = self.sink;
            defer self.deref();

            if (sink.endPromise.globalObject()) |globalObject| {
                switch (result) {
                    .success => sink.endPromise.resolve(globalObject, JSC.jsNumber(0)),
                    .failure => |err| {
                        if (!sink.done) {
                            sink.abort();
                            return;
                        }
                        sink.endPromise.rejectOnNextTick(globalObject, err.toJS(globalObject));
                    },
                }
            }
            if (self.callback) |callback| {
                callback(result, self.callback_context);
            }
        }

        pub fn deinit(self: *@This()) void {
            self.readable_stream_ref.deinit();
            self.sink.finalize();
            self.sink.destroy();
            self.destroy();
        }
    };
    pub fn onUploadStreamResolveRequestStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        var args = callframe.arguments_old(2);
        var this = args.ptr[args.len - 1].asPromisePtr(S3UploadStreamWrapper);
        defer this.deref();
        if (this.sink.endPromise.hasValue()) {
            this.sink.endPromise.resolve(globalThis, JSC.jsNumber(0));
        }
        if (this.readable_stream_ref.get()) |stream| {
            stream.done(globalThis);
        }
        this.readable_stream_ref.deinit();

        return .undefined;
    }

    pub fn onUploadStreamRejectRequestStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const args = callframe.arguments_old(2);
        var this = args.ptr[args.len - 1].asPromisePtr(S3UploadStreamWrapper);
        defer this.deref();
        const err = args.ptr[0];
        if (this.sink.endPromise.hasValue()) {
            this.sink.endPromise.rejectOnNextTick(globalThis, err);
        }

        if (this.readable_stream_ref.get()) |stream| {
            stream.cancel(globalThis);
            this.readable_stream_ref.deinit();
        }
        if (this.sink.task) |task| {
            if (task == .s3_upload) {
                task.s3_upload.fail(.{
                    .code = "UnknownError",
                    .message = "ReadableStream ended with an error",
                });
            }
        }
        return .undefined;
    }
    pub const shim = JSC.Shimmer("Bun", "S3UploadStream", @This());

    pub const Export = shim.exportFunctions(.{
        .onResolveRequestStream = onUploadStreamResolveRequestStream,
        .onRejectRequestStream = onUploadStreamRejectRequestStream,
    });
    comptime {
        const jsonResolveRequestStream = JSC.toJSHostFunction(onUploadStreamResolveRequestStream);
        @export(jsonResolveRequestStream, .{ .name = Export[0].symbol_name });
        const jsonRejectRequestStream = JSC.toJSHostFunction(onUploadStreamRejectRequestStream);
        @export(jsonRejectRequestStream, .{ .name = Export[1].symbol_name });
    }

    /// consumes the readable stream and upload to s3
    pub fn s3UploadStream(this: *@This(), path: []const u8, readable_stream: JSC.WebCore.ReadableStream, globalThis: *JSC.JSGlobalObject, options: MultiPartUpload.MultiPartUploadOptions, content_type: ?[]const u8, proxy: ?[]const u8, callback: ?*const fn (S3UploadResult, *anyopaque) void, callback_context: *anyopaque) JSC.JSValue {
        this.ref(); // ref the credentials
        const proxy_url = (proxy orelse "");

        const task = MultiPartUpload.new(.{
            .credentials = this,
            .path = bun.default_allocator.dupe(u8, path) catch bun.outOfMemory(),
            .proxy = if (proxy_url.len > 0) bun.default_allocator.dupe(u8, proxy_url) catch bun.outOfMemory() else "",
            .content_type = if (content_type) |ct| bun.default_allocator.dupe(u8, ct) catch bun.outOfMemory() else null,
            .callback = @ptrCast(&S3UploadStreamWrapper.resolve),
            .callback_context = undefined,
            .globalThis = globalThis,
            .options = options,
            .vm = JSC.VirtualMachine.get(),
        });

        task.poll_ref.ref(task.vm);

        task.ref(); // + 1 for the stream

        var response_stream = JSC.WebCore.FetchTaskletChunkedRequestSink.new(.{
            .task = .{ .s3_upload = task },
            .buffer = .{},
            .globalThis = globalThis,
            .encoded = false,
            .endPromise = JSC.JSPromise.Strong.init(globalThis),
        }).toSink();
        const endPromise = response_stream.sink.endPromise.value();
        const ctx = S3UploadStreamWrapper.new(.{
            .readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(readable_stream, globalThis),
            .sink = &response_stream.sink,
            .callback = callback,
            .callback_context = callback_context,
        });
        task.callback_context = @ptrCast(ctx);
        var signal = &response_stream.sink.signal;

        signal.* = JSC.WebCore.FetchTaskletChunkedRequestSink.JSSink.SinkSignal.init(.zero);

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        signal.clear();
        bun.assert(signal.isDead());

        // We are already corked!
        const assignment_result: JSC.JSValue = JSC.WebCore.FetchTaskletChunkedRequestSink.JSSink.assignToStream(
            globalThis,
            readable_stream.value,
            response_stream,
            @as(**anyopaque, @ptrCast(&signal.ptr)),
        );

        assignment_result.ensureStillAlive();

        // assert that it was updated
        bun.assert(!signal.isDead());

        if (assignment_result.toError()) |err| {
            readable_stream.cancel(globalThis);
            if (response_stream.sink.endPromise.hasValue()) {
                response_stream.sink.endPromise.rejectOnNextTick(globalThis, err);
            }
            task.fail(.{
                .code = "UnknownError",
                .message = "ReadableStream ended with an error",
            });
            return endPromise;
        }

        if (!assignment_result.isEmptyOrUndefinedOrNull()) {
            task.vm.drainMicrotasks();

            assignment_result.ensureStillAlive();
            // it returns a Promise when it goes through ReadableStreamDefaultReader
            if (assignment_result.asAnyPromise()) |promise| {
                switch (promise.status(globalThis.vm())) {
                    .pending => {
                        ctx.ref();
                        assignment_result.then(
                            globalThis,
                            task.callback_context,
                            onUploadStreamResolveRequestStream,
                            onUploadStreamRejectRequestStream,
                        );
                    },
                    .fulfilled => {
                        readable_stream.done(globalThis);
                        if (response_stream.sink.endPromise.hasValue()) {
                            response_stream.sink.endPromise.resolve(globalThis, JSC.jsNumber(0));
                        }
                    },
                    .rejected => {
                        readable_stream.cancel(globalThis);
                        if (response_stream.sink.endPromise.hasValue()) {
                            response_stream.sink.endPromise.rejectOnNextTick(globalThis, promise.result(globalThis.vm()));
                        }
                        task.fail(.{
                            .code = "UnknownError",
                            .message = "ReadableStream ended with an error",
                        });
                    },
                }
            } else {
                readable_stream.cancel(globalThis);
                if (response_stream.sink.endPromise.hasValue()) {
                    response_stream.sink.endPromise.rejectOnNextTick(globalThis, assignment_result);
                }
                task.fail(.{
                    .code = "UnknownError",
                    .message = "ReadableStream ended with an error",
                });
            }
        }
        return endPromise;
    }
    /// returns a writable stream that writes to the s3 path
    pub fn s3WritableStream(this: *@This(), path: []const u8, globalThis: *JSC.JSGlobalObject, options: MultiPartUpload.MultiPartUploadOptions, content_type: ?[]const u8, proxy: ?[]const u8) bun.JSError!JSC.JSValue {
        const Wrapper = struct {
            pub fn callback(result: S3UploadResult, sink: *JSC.WebCore.FetchTaskletChunkedRequestSink) void {
                if (sink.endPromise.globalObject()) |globalObject| {
                    const event_loop = globalObject.bunVM().eventLoop();
                    event_loop.enter();
                    defer event_loop.exit();
                    switch (result) {
                        .success => {
                            sink.endPromise.resolve(globalObject, JSC.jsNumber(0));
                        },
                        .failure => |err| {
                            if (!sink.done) {
                                sink.abort();
                                return;
                            }

                            sink.endPromise.rejectOnNextTick(globalObject, err.toJS(globalObject));
                        },
                    }
                }
                sink.finalize();
            }
        };
        const proxy_url = (proxy orelse "");
        this.ref(); // ref the credentials
        const task = MultiPartUpload.new(.{
            .credentials = this,
            .path = bun.default_allocator.dupe(u8, path) catch bun.outOfMemory(),
            .proxy = if (proxy_url.len > 0) bun.default_allocator.dupe(u8, proxy_url) catch bun.outOfMemory() else "",
            .content_type = if (content_type) |ct| bun.default_allocator.dupe(u8, ct) catch bun.outOfMemory() else null,

            .callback = @ptrCast(&Wrapper.callback),
            .callback_context = undefined,
            .globalThis = globalThis,
            .options = options,
            .vm = JSC.VirtualMachine.get(),
        });

        task.poll_ref.ref(task.vm);

        task.ref(); // + 1 for the stream
        var response_stream = JSC.WebCore.FetchTaskletChunkedRequestSink.new(.{
            .task = .{ .s3_upload = task },
            .buffer = .{},
            .globalThis = globalThis,
            .encoded = false,
            .endPromise = JSC.JSPromise.Strong.init(globalThis),
        }).toSink();

        task.callback_context = @ptrCast(response_stream);
        var signal = &response_stream.sink.signal;

        signal.* = JSC.WebCore.FetchTaskletChunkedRequestSink.JSSink.SinkSignal.init(.zero);

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        signal.clear();
        bun.assert(signal.isDead());
        return response_stream.sink.toJS(globalThis);
    }
};

pub const MultiPartUpload = struct {
    pub const OneMiB: usize = 1048576;
    pub const MAX_SINGLE_UPLOAD_SIZE_IN_MiB: usize = 5120; // we limit to 5 GiB
    pub const MAX_SINGLE_UPLOAD_SIZE: usize = MAX_SINGLE_UPLOAD_SIZE_IN_MiB * OneMiB; // we limit to 5 GiB
    pub const MIN_SINGLE_UPLOAD_SIZE_IN_MiB: usize = 5;
    pub const DefaultPartSize = OneMiB * MIN_SINGLE_UPLOAD_SIZE_IN_MiB;
    const MAX_QUEUE_SIZE = 64; // dont make sense more than this because we use fetch anything greater will be 64
    const AWS = AWSCredentials;
    queue: std.ArrayListUnmanaged(UploadPart) = .{},
    available: bun.bit_set.IntegerBitSet(MAX_QUEUE_SIZE) = bun.bit_set.IntegerBitSet(MAX_QUEUE_SIZE).initFull(),

    currentPartNumber: u16 = 1,
    ref_count: u16 = 1,
    ended: bool = false,

    options: MultiPartUploadOptions = .{},
    credentials: *AWSCredentials,
    poll_ref: bun.Async.KeepAlive = bun.Async.KeepAlive.init(),
    vm: *JSC.VirtualMachine,
    globalThis: *JSC.JSGlobalObject,

    buffered: std.ArrayListUnmanaged(u8) = .{},
    offset: usize = 0,

    path: []const u8,
    proxy: []const u8,
    content_type: ?[]const u8 = null,
    upload_id: []const u8 = "",
    uploadid_buffer: bun.MutableString = .{ .allocator = bun.default_allocator, .list = .{} },

    multipart_etags: std.ArrayListUnmanaged(UploadPart.UploadPartResult) = .{},
    multipart_upload_list: bun.ByteList = .{},

    state: enum {
        not_started,
        multipart_started,
        multipart_completed,
        singlefile_started,
        finished,
    } = .not_started,

    callback: *const fn (AWS.S3UploadResult, *anyopaque) void,
    callback_context: *anyopaque,

    pub usingnamespace bun.NewRefCounted(@This(), @This().deinit);

    const log = bun.Output.scoped(.S3MultiPartUpload, true);
    pub const MultiPartUploadOptions = struct {
        /// more than 255 dont make sense http thread cannot handle more than that
        queueSize: u8 = 5,
        /// in s3 client sdk they set it in bytes but the min is still 5 MiB
        /// var params = {Bucket: 'bucket', Key: 'key', Body: stream};
        /// var options = {partSize: 10 * 1024 * 1024, queueSize: 1};
        /// s3.upload(params, options, function(err, data) {
        ///   console.log(err, data);
        /// });
        /// See. https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property
        /// The value is in MiB min is 5 and max 5120 (but we limit to 4 GiB aka 4096)
        partSize: u16 = 5,
        /// default is 3 max 255
        retry: u8 = 3,
    };

    pub const UploadPart = struct {
        data: []const u8,
        state: enum {
            pending,
            started,
            completed,
            canceled,
        },
        owns_data: bool,
        partNumber: u16, // max is 10,000
        retry: u8, // auto retry, decrement until 0 and fail after this
        index: u8,
        ctx: *MultiPartUpload,

        pub const UploadPartResult = struct {
            number: u16,
            etag: []const u8,
        };
        fn sortEtags(_: *MultiPartUpload, a: UploadPart.UploadPartResult, b: UploadPart.UploadPartResult) bool {
            return a.number < b.number;
        }

        pub fn onPartResponse(result: AWS.S3PartResult, this: *@This()) void {
            if (this.state == .canceled) {
                log("onPartResponse {} canceled", .{this.partNumber});
                if (this.owns_data) bun.default_allocator.free(this.data);
                this.ctx.deref();
                return;
            }

            this.state = .completed;

            switch (result) {
                .failure => |err| {
                    if (this.retry > 0) {
                        log("onPartResponse {} retry", .{this.partNumber});
                        this.retry -= 1;
                        // retry failed
                        this.perform();
                        return;
                    } else {
                        log("onPartResponse {} failed", .{this.partNumber});
                        if (this.owns_data) bun.default_allocator.free(this.data);
                        defer this.ctx.deref();
                        return this.ctx.fail(err);
                    }
                },
                .etag => |etag| {
                    log("onPartResponse {} success", .{this.partNumber});

                    if (this.owns_data) bun.default_allocator.free(this.data);
                    // we will need to order this
                    this.ctx.multipart_etags.append(bun.default_allocator, .{
                        .number = this.partNumber,
                        .etag = bun.default_allocator.dupe(u8, etag) catch bun.outOfMemory(),
                    }) catch bun.outOfMemory();

                    defer this.ctx.deref();
                    // mark as available
                    this.ctx.available.set(this.index);
                    // drain more
                    this.ctx.drainEnqueuedParts();
                },
            }
        }

        fn perform(this: *@This()) void {
            var params_buffer: [2048]u8 = undefined;
            const search_params = std.fmt.bufPrint(&params_buffer, "?partNumber={}&uploadId={s}&x-id=UploadPart", .{
                this.partNumber,
                this.ctx.upload_id,
            }) catch unreachable;
            this.ctx.credentials.executeSimpleS3Request(.{
                .path = this.ctx.path,
                .method = .PUT,
                .proxy_url = this.ctx.proxyUrl(),
                .body = this.data,
                .search_params = search_params,
            }, .{ .part = @ptrCast(&onPartResponse) }, this);
        }
        pub fn start(this: *@This()) void {
            if (this.state != .pending or this.ctx.state != .multipart_completed) return;
            this.ctx.ref();
            this.state = .started;
            this.perform();
        }
        pub fn cancel(this: *@This()) void {
            const state = this.state;
            this.state = .canceled;

            switch (state) {
                .pending => {
                    if (this.owns_data) bun.default_allocator.free(this.data);
                },
                // if is not pending we will free later or is already freed
                else => {},
            }
        }
    };

    fn deinit(this: *@This()) void {
        log("deinit", .{});
        if (this.queue.capacity > 0)
            this.queue.deinit(bun.default_allocator);
        this.poll_ref.unref(this.vm);
        bun.default_allocator.free(this.path);
        if (this.proxy.len > 0) {
            bun.default_allocator.free(this.proxy);
        }
        if (this.content_type) |ct| {
            if (ct.len > 0) {
                bun.default_allocator.free(ct);
            }
        }
        this.credentials.deref();
        this.uploadid_buffer.deinit();
        for (this.multipart_etags.items) |tag| {
            bun.default_allocator.free(tag.etag);
        }
        if (this.multipart_etags.capacity > 0)
            this.multipart_etags.deinit(bun.default_allocator);
        if (this.multipart_upload_list.cap > 0)
            this.multipart_upload_list.deinitWithAllocator(bun.default_allocator);
        this.destroy();
    }

    pub fn singleSendUploadResponse(result: AWS.S3UploadResult, this: *@This()) void {
        switch (result) {
            .failure => |err| {
                if (this.options.retry > 0) {
                    log("singleSendUploadResponse {} retry", .{this.options.retry});
                    this.options.retry -= 1;
                    // retry failed
                    this.credentials.executeSimpleS3Request(.{
                        .path = this.path,
                        .method = .PUT,
                        .proxy_url = this.proxyUrl(),
                        .body = this.buffered.items,
                        .content_type = this.content_type,
                    }, .{ .upload = @ptrCast(&singleSendUploadResponse) }, this);

                    return;
                } else {
                    log("singleSendUploadResponse failed", .{});
                    return this.fail(err);
                }
            },
            .success => {
                log("singleSendUploadResponse success", .{});
                this.done();
            },
        }
    }

    fn getCreatePart(this: *@This(), chunk: []const u8, owns_data: bool) ?*UploadPart {
        const index = this.available.findFirstSet() orelse {
            // this means that the queue is full and we cannot flush it
            return null;
        };

        if (index >= this.options.queueSize) {
            // ops too much concurrency wait more
            return null;
        }
        this.available.unset(index);
        defer this.currentPartNumber += 1;

        if (this.queue.items.len <= index) {
            this.queue.append(bun.default_allocator, .{
                .data = chunk,
                .partNumber = this.currentPartNumber,
                .owns_data = owns_data,
                .ctx = this,
                .index = @truncate(index),
                .retry = this.options.retry,
                .state = .pending,
            }) catch bun.outOfMemory();
            return &this.queue.items[index];
        }
        this.queue.items[index] = .{
            .data = chunk,
            .partNumber = this.currentPartNumber,
            .owns_data = owns_data,
            .ctx = this,
            .index = @truncate(index),
            .retry = this.options.retry,
            .state = .pending,
        };
        return &this.queue.items[index];
    }

    fn drainEnqueuedParts(this: *@This()) void {
        // check pending to start or transformed buffered ones into tasks
        if (this.state == .multipart_completed) {
            for (this.queue.items) |*part| {
                if (part.state == .pending) {
                    // lets start the part request
                    part.start();
                }
            }
        }
        const partSize = this.partSizeInBytes();
        if (this.ended or this.buffered.items.len >= partSize) {
            this.processMultiPart(partSize);
        }

        if (this.ended and this.available.mask == std.bit_set.IntegerBitSet(MAX_QUEUE_SIZE).initFull().mask) {
            // we are done
            this.done();
        }
    }
    pub fn fail(this: *@This(), _err: AWS.S3Error) void {
        log("fail {s}:{s}", .{ _err.code, _err.message });
        for (this.queue.items) |*task| {
            task.cancel();
        }
        if (this.state != .finished) {
            this.callback(.{ .failure = _err }, this.callback_context);
            this.state = .finished;
            if (this.state == .multipart_completed) {
                // will deref after rollback
                this.rollbackMultiPartRequest();
            } else {
                this.deref();
            }
        }
    }

    fn done(this: *@This()) void {
        if (this.state == .multipart_completed) {
            this.state = .finished;

            std.sort.block(UploadPart.UploadPartResult, this.multipart_etags.items, this, UploadPart.sortEtags);
            this.multipart_upload_list.append(bun.default_allocator, "<?xml version=\"1.0\" encoding=\"UTF-8\"?><CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">") catch bun.outOfMemory();
            for (this.multipart_etags.items) |tag| {
                this.multipart_upload_list.appendFmt(bun.default_allocator, "<Part><PartNumber>{}</PartNumber><ETag>{s}</ETag></Part>", .{ tag.number, tag.etag }) catch bun.outOfMemory();

                bun.default_allocator.free(tag.etag);
            }
            this.multipart_etags.deinit(bun.default_allocator);
            this.multipart_etags = .{};
            this.multipart_upload_list.append(bun.default_allocator, "</CompleteMultipartUpload>") catch bun.outOfMemory();
            // will deref and ends after commit
            this.commitMultiPartRequest();
        } else {
            this.callback(.{ .success = {} }, this.callback_context);
            this.state = .finished;
            this.deref();
        }
    }
    pub fn startMultiPartRequestResult(result: AWS.S3DownloadResult, this: *@This()) void {
        switch (result) {
            .failure => |err| {
                log("startMultiPartRequestResult {s} failed {s}: {s}", .{ this.path, err.message, err.message });
                this.fail(err);
            },
            .success => |response| {
                const slice = response.body.list.items;
                this.uploadid_buffer = result.success.body;

                if (strings.indexOf(slice, "<UploadId>")) |start| {
                    if (strings.indexOf(slice, "</UploadId>")) |end| {
                        this.upload_id = slice[start + 10 .. end];
                    }
                }
                if (this.upload_id.len == 0) {
                    // Unknown type of response error from AWS
                    log("startMultiPartRequestResult {s} failed invalid id", .{this.path});
                    this.fail(.{
                        .code = "UnknownError",
                        .message = "Failed to initiate multipart upload",
                    });
                    return;
                }
                log("startMultiPartRequestResult {s} success id: {s}", .{ this.path, this.upload_id });
                this.state = .multipart_completed;
                this.drainEnqueuedParts();
            },
            // this is "unreachable" but we cover in case AWS returns 404
            .not_found => this.fail(.{
                .code = "UnknownError",
                .message = "Failed to initiate multipart upload",
            }),
        }
    }

    pub fn onCommitMultiPartRequest(result: AWS.S3CommitResult, this: *@This()) void {
        log("onCommitMultiPartRequest {s}", .{this.upload_id});
        switch (result) {
            .failure => |err| {
                if (this.options.retry > 0) {
                    this.options.retry -= 1;
                    // retry commit
                    this.commitMultiPartRequest();
                    return;
                }
                this.callback(.{ .failure = err }, this.callback_context);
                this.deref();
            },
            .success => {
                this.callback(.{ .success = {} }, this.callback_context);
                this.state = .finished;
                this.deref();
            },
        }
    }

    pub fn onRollbackMultiPartRequest(result: AWS.S3UploadResult, this: *@This()) void {
        log("onRollbackMultiPartRequest {s}", .{this.upload_id});
        switch (result) {
            .failure => {
                if (this.options.retry > 0) {
                    this.options.retry -= 1;
                    // retry rollback
                    this.rollbackMultiPartRequest();
                    return;
                }
                this.deref();
            },
            .success => {
                this.deref();
            },
        }
    }

    fn commitMultiPartRequest(this: *@This()) void {
        log("commitMultiPartRequest {s}", .{this.upload_id});
        var params_buffer: [2048]u8 = undefined;
        const searchParams = std.fmt.bufPrint(&params_buffer, "?uploadId={s}", .{
            this.upload_id,
        }) catch unreachable;

        this.credentials.executeSimpleS3Request(.{
            .path = this.path,
            .method = .POST,
            .proxy_url = this.proxyUrl(),
            .body = this.multipart_upload_list.slice(),
            .search_params = searchParams,
        }, .{ .commit = @ptrCast(&onCommitMultiPartRequest) }, this);
    }
    fn rollbackMultiPartRequest(this: *@This()) void {
        log("rollbackMultiPartRequest {s}", .{this.upload_id});
        var params_buffer: [2048]u8 = undefined;
        const search_params = std.fmt.bufPrint(&params_buffer, "?uploadId={s}", .{
            this.upload_id,
        }) catch unreachable;

        this.credentials.executeSimpleS3Request(.{
            .path = this.path,
            .method = .DELETE,
            .proxy_url = this.proxyUrl(),
            .body = "",
            .search_params = search_params,
        }, .{ .upload = @ptrCast(&onRollbackMultiPartRequest) }, this);
    }
    fn enqueuePart(this: *@This(), chunk: []const u8, owns_data: bool) bool {
        const part = this.getCreatePart(chunk, owns_data) orelse return false;

        if (this.state == .not_started) {
            // will auto start later
            this.state = .multipart_started;
            this.credentials.executeSimpleS3Request(.{
                .path = this.path,
                .method = .POST,
                .proxy_url = this.proxyUrl(),
                .body = "",
                .search_params = "?uploads=",
                .content_type = this.content_type,
            }, .{ .download = @ptrCast(&startMultiPartRequestResult) }, this);
        } else if (this.state == .multipart_completed) {
            part.start();
        }
        return true;
    }

    fn processMultiPart(this: *@This(), part_size: usize) void {
        // need to split in multiple parts because of the size
        var buffer = this.buffered.items[this.offset..];
        var queue_full = false;
        defer if (!this.ended and queue_full == false) {
            this.buffered = .{};
            this.offset = 0;
        };

        while (buffer.len > 0) {
            const len = @min(part_size, buffer.len);
            const slice = buffer[0..len];
            buffer = buffer[len..];
            // its one big buffer lets free after we are done with everything, part dont own the data
            if (this.enqueuePart(slice, this.ended)) {
                this.offset += len;
            } else {
                queue_full = true;
                break;
            }
        }
    }

    pub fn proxyUrl(this: *@This()) ?[]const u8 {
        return this.proxy;
    }
    fn processBuffered(this: *@This(), part_size: usize) void {
        if (this.ended and this.buffered.items.len < this.partSizeInBytes() and this.state == .not_started) {
            log("processBuffered {s} singlefile_started", .{this.path});
            this.state = .singlefile_started;
            // we can do only 1 request
            this.credentials.executeSimpleS3Request(.{
                .path = this.path,
                .method = .PUT,
                .proxy_url = this.proxyUrl(),
                .body = this.buffered.items,
                .content_type = this.content_type,
            }, .{ .upload = @ptrCast(&singleSendUploadResponse) }, this);
        } else {
            // we need to split
            this.processMultiPart(part_size);
        }
    }

    pub fn partSizeInBytes(this: *@This()) usize {
        return this.options.partSize * OneMiB;
    }

    pub fn sendRequestData(this: *@This(), chunk: []const u8, is_last: bool) void {
        if (this.ended) return;

        if (is_last) {
            this.ended = true;
            if (chunk.len > 0) {
                this.buffered.appendSlice(bun.default_allocator, chunk) catch bun.outOfMemory();
            }
            this.processBuffered(this.partSizeInBytes());
        } else {
            // still have more data and receive empty, nothing todo here
            if (chunk.len == 0) return;
            this.buffered.appendSlice(bun.default_allocator, chunk) catch bun.outOfMemory();
            const partSize = this.partSizeInBytes();
            if (this.buffered.items.len >= partSize) {
                // send the part we have enough data
                this.processBuffered(partSize);
                return;
            }

            // wait for more
        }
    }
};
