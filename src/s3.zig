const bun = @import("root").bun;
const picohttp = bun.picohttp;
const std = @import("std");
const DotEnv = @import("./env_loader.zig");

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
    const ENABLE_SIGNATURE_CACHE = false;
    threadlocal var SIGNATURE_CACHE: bun.StringArrayHashMap([DIGESTED_HMAC_256_LEN]u8) = undefined;
    threadlocal var SIGNATURE_CACHE_DATE: u64 = 0;

    pub const SignResult = struct {
        amz_date: []const u8,
        host: []const u8,
        authorization: []const u8,
        url: []const u8,
        headers: [4]picohttp.Header,

        pub fn deinit(this: *const @This()) void {
            if (this.amz_date.len > 0) {
                bun.default_allocator.free(this.amz_date);
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

    pub fn signRequest(this: *const @This(), full_path: []const u8, method: bun.http.Method, content_hash: ?[]const u8, searchParams: ?[]const u8, signQueryOption: ?SignQueryOptions) !SignResult {
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
        // if we allow path.len == 0 it will list the bucket for now we disallow
        if (path.len == 0) return error.InvalidPath;

        var path_buffer: [1024 + 63 + 2]u8 = undefined; // 1024 max key size and 63 max bucket name

        const normalizedPath = std.fmt.bufPrint(&path_buffer, "/{s}{s}", .{ bucket, if (strings.endsWith(path, "/")) path[0 .. path.len - 1] else path }) catch return error.InvalidPath;

        const date_result = getAMZDate(bun.default_allocator);
        const amz_date = date_result.date;
        errdefer bun.default_allocator.free(amz_date);

        const amz_day = amz_date[0..8];
        const signedHeaders = if (signQuery) "host" else "host;x-amz-content-sha256;x-amz-date";

        // detect service name and host from region or endpoint
        const host = brk_host: {
            if (this.endpoint.len > 0) {
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

                if (comptime ENABLE_SIGNATURE_CACHE) {
                    if (SIGNATURE_CACHE_DATE == date_result.numeric_day) {
                        if (SIGNATURE_CACHE.getKey(key)) |cached| {
                            break :brk_sign cached;
                        }
                    } else {
                        if (SIGNATURE_CACHE_DATE == 0) {
                            // first request we need a new map instance
                            SIGNATURE_CACHE = bun.StringArrayHashMap([DIGESTED_HMAC_256_LEN]u8).init(bun.default_allocator);
                        } else {
                            // day changed so we clean the old cache
                            for (SIGNATURE_CACHE.keys()) |cached_key| {
                                bun.default_allocator.free(cached_key);
                            }
                            SIGNATURE_CACHE.clearRetainingCapacity();
                        }
                        SIGNATURE_CACHE_DATE = date_result.numeric_day;
                    }
                }
                // not cached yet lets generate a new one
                const sigDate = bun.hmac.generate(try std.fmt.bufPrint(&tmp_buffer, "AWS4{s}", .{this.secretAccessKey}), amz_day, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;
                const sigDateRegion = bun.hmac.generate(sigDate, region, .sha256, &hmac_sig_service2) orelse return error.FailedToGenerateSignature;
                const sigDateRegionService = bun.hmac.generate(sigDateRegion, service_name, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;
                const result = bun.hmac.generate(sigDateRegionService, "aws4_request", .sha256, &hmac_sig_service2) orelse return error.FailedToGenerateSignature;

                if (comptime ENABLE_SIGNATURE_CACHE) {
                    try SIGNATURE_CACHE.put(try bun.default_allocator.dupe(u8, key), hmac_sig_service2[0..DIGESTED_HMAC_256_LEN].*);
                }
                break :brk_sign result;
            };
            if (signQuery) {
                const canonical = try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\nX-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={s}%2F{s}%2F{s}%2F{s}%2Faws4_request&X-Amz-Date={s}&X-Amz-Expires={}&X-Amz-SignedHeaders=host\nhost:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, this.accessKeyId, amz_day, region, service_name, amz_date, expires, host, signedHeaders, aws_content_hash });
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
                const canonical = try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, if (searchParams) |p| p[1..] else "", host, aws_content_hash, amz_date, signedHeaders, aws_content_hash });

                var sha_digest = std.mem.zeroes(bun.sha.SHA256.Digest);
                bun.sha.SHA256.hash(canonical, &sha_digest, JSC.VirtualMachine.get().rareData().boringEngine());

                const signValue = try std.fmt.bufPrint(&tmp_buffer, "AWS4-HMAC-SHA256\n{s}\n{s}/{s}/{s}/aws4_request\n{s}", .{ amz_date, amz_day, region, service_name, bun.fmt.bytesToHex(sha_digest[0..bun.sha.SHA256.digest], .lower) });

                const signature = bun.hmac.generate(sigDateRegionServiceReq, signValue, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;

                break :brk try std.fmt.allocPrint(
                    bun.default_allocator,
                    "AWS4-HMAC-SHA256 Credential={s}/{s}/{s}/{s}/aws4_request, SignedHeaders={s}, Signature={s}",
                    .{ this.accessKeyId, amz_day, region, service_name, signedHeaders, bun.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
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
                .headers = .{
                    .{ .name = "x-amz-content-sha256", .value = "" },
                    .{ .name = "x-amz-date", .value = "" },
                    .{ .name = "Authorization", .value = "" },
                    .{ .name = "Host", .value = "" },
                },
            };
        }
        return SignResult{
            .amz_date = amz_date,
            .host = host,
            .authorization = authorization,
            .url = try std.fmt.allocPrint(bun.default_allocator, "https://{s}{s}{s}", .{ host, normalizedPath, if (searchParams) |s| s else "" }),
            .headers = .{
                .{ .name = "x-amz-content-sha256", .value = aws_content_hash },
                .{ .name = "x-amz-date", .value = amz_date },
                .{ .name = "Authorization", .value = authorization[0..] },
                .{ .name = "Host", .value = host },
            },
        };
    }
    pub const S3Error = struct {
        code: []const u8,
        message: []const u8,
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
                if (bytes.len > 0) {
                    message = bytes[0..];
                    if (strings.indexOf(bytes, "<Error>") != null) {
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
                    } else if (status == 200 or status == 206) {
                        return false;
                    }
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
                        200 => {
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
                        200, 206 => {
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
                    // commit multipart upload can fail with status 200
                    if (!this.failIfContainsError(response.status_code)) {
                        callback(response.headers.get("etag"), this.callback_context);
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

    pub fn executeSimpleS3Request(this: *const @This(), path: []const u8, method: bun.http.Method, callback: S3HttpSimpleTask.Callback, callback_context: *anyopaque, proxy_url: ?[]const u8, body: []const u8, range: ?[]const u8, searchParams: ?[]const u8) void {
        var result = this.signRequest(path, method, null, searchParams, null) catch |sign_err| {
            if (range) |range_| bun.default_allocator.free(range_);

            return switch (sign_err) {
                error.MissingCredentials => callback.fail("MissingCredentials", "missing s3 credentials", callback_context),
                error.InvalidMethod => callback.fail("MissingCredentials", "method must be GET, PUT, DELETE or HEAD when using s3 protocol", callback_context),
                error.InvalidPath => callback.fail("InvalidPath", "invalid s3 bucket, key combination", callback_context),
                else => callback.fail("SignError", "failed to retrieve s3 content check your credentials", callback_context),
            };
        };

        const headers = brk: {
            if (range) |range_| {
                var headersWithRange: [5]picohttp.Header = .{
                    result.headers[0],
                    result.headers[1],
                    result.headers[2],
                    result.headers[3],
                    .{ .name = "range", .value = range_ },
                };
                break :brk JSC.WebCore.Headers.fromPicoHttpHeaders(&headersWithRange, bun.default_allocator) catch bun.outOfMemory();
            } else {
                break :brk JSC.WebCore.Headers.fromPicoHttpHeaders(&result.headers, bun.default_allocator) catch bun.outOfMemory();
            }
        };
        const task = S3HttpSimpleTask.new(.{
            .http = undefined,
            .sign_result = result,
            .callback_context = callback_context,
            .callback = callback,
            .range = range,
            .headers = headers,
            .vm = JSC.VirtualMachine.get(),
        });

        const url = bun.URL.parse(result.url);

        task.http = bun.http.AsyncHTTP.init(
            bun.default_allocator,
            method,
            url,
            task.headers.entries,
            task.headers.buf.items,
            &task.response_buffer,
            body,
            bun.http.HTTPClientResult.Callback.New(
                *S3HttpSimpleTask,
                S3HttpSimpleTask.http_callback,
            ).init(task),
            .follow,
            .{
                .http_proxy = if (proxy_url) |proxy| bun.URL.parse(proxy) else null,
                .verbose = .headers,
            },
        );
        // queue http request
        bun.http.HTTPThread.init(&.{});
        var batch = bun.ThreadPool.Batch{};
        task.http.schedule(bun.default_allocator, &batch);
        bun.http.http_thread.schedule(batch);
    }

    pub fn s3Stat(this: *const @This(), path: []const u8, callback: *const fn (S3StatResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(path, .HEAD, .{ .stat = callback }, callback_context, proxy_url, "", null, null);
    }

    pub fn s3Download(this: *const @This(), path: []const u8, callback: *const fn (S3DownloadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(path, .GET, .{ .download = callback }, callback_context, proxy_url, "", null, null);
    }

    pub fn s3DownloadSlice(this: *const @This(), path: []const u8, offset: usize, size: ?usize, callback: *const fn (S3DownloadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        const range = brk: {
            if (size) |size_| {
                var end = (offset + size_);
                if (size_ > 0) {
                    end -= 1;
                }
                break :brk std.fmt.allocPrint(bun.default_allocator, "bytes={}-{}", .{ offset, end }) catch bun.outOfMemory();
            }
            break :brk std.fmt.allocPrint(bun.default_allocator, "bytes={}-", .{offset}) catch bun.outOfMemory();
        };

        this.executeSimpleS3Request(path, .GET, .{ .download = callback }, callback_context, proxy_url, "", range, null);
    }

    pub fn s3Delete(this: *const @This(), path: []const u8, callback: *const fn (S3DeleteResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(path, .DELETE, .{ .delete = callback }, callback_context, proxy_url, "", null, null);
    }

    pub fn s3Upload(this: *const @This(), path: []const u8, content: []const u8, callback: *const fn (S3UploadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(path, .PUT, .{ .upload = callback }, callback_context, proxy_url, content, null, null);
    }

    /// consumes the readable stream and upload to s3
    // pub fn s3UploadStream(this: *const @This(), path: []const u8, readable_stream: *JSC.WebCore.ReadableStream, globalThis: *JSC.JSGlobalObject, callback: *const fn (S3UploadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
    //     var result = this.signRequest(path, .PUT, null, null) catch |sign_err| {
    //         return switch (sign_err) {
    //             error.MissingCredentials => callback.fail("MissingCredentials", "missing s3 credentials", callback_context),
    //             error.InvalidMethod => callback.fail("MissingCredentials", "method must be GET, PUT, DELETE or HEAD when using s3 protocol", callback_context),
    //             error.InvalidPath => callback.fail("InvalidPath", "invalid s3 bucket, key combination", callback_context),
    //             else => callback.fail("SignError", "failed to retrieve s3 content check your credentials", callback_context),
    //         };
    //     };

    //     const headers = JSC.WebCore.Headers.fromPicoHttpHeaders(&result.headers, bun.default_allocator) catch bun.outOfMemory();
    //     const task = S3HttpStreamUpload.new(.{
    //         .http = undefined,
    //         .sign_result = result,
    //         .readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(readable_stream, globalThis),
    //         .callback_context = callback_context,
    //         .callback = callback,
    //         .headers = headers,
    //         .vm = JSC.VirtualMachine.get(),
    //     });
    //     task.poll_ref.ref(task.vm);

    //     const url = bun.URL.parse(result.url);

    //     task.http = bun.http.AsyncHTTP.init(
    //         bun.default_allocator,
    //         .PUT,
    //         url,
    //         task.headers.entries,
    //         task.headers.buf.items,
    //         &task.response_buffer,
    //         "",
    //         bun.http.HTTPClientResult.Callback.New(
    //             *S3HttpStreamUpload,
    //             S3HttpStreamUpload.http_callback,
    //         ).init(task),
    //         .follow,
    //         .{
    //             .http_proxy = if (proxy_url) |proxy| bun.URL.parse(proxy) else null,
    //         },
    //     );
    //     task.http.client.flags.is_streaming_request_body = true;
    //     task.http.request_body = .{
    //         .stream = .{
    //             .buffer = .{},
    //             .ended = false,
    //         },
    //     };
    //     // queue http request
    //     bun.http.HTTPThread.init(&.{});
    //     var batch = bun.ThreadPool.Batch{};
    //     task.http.schedule(bun.default_allocator, &batch);
    //     task.ref(); // +1 for the http thread
    //     bun.http.http_thread.schedule(batch);
    // }
    /// returns a writable stream that writes to the s3 path
    pub fn s3WritableStream(this: *@This(), path: []const u8, globalThis: *JSC.JSGlobalObject) bun.JSError!JSC.JSValue {
        const Wrapper = struct {
            pub fn callback(result: S3UploadResult, sink: *JSC.WebCore.FetchTaskletChunkedRequestSink) void {
                const globalObject = sink.endPromise.strong.globalThis.?;
                switch (result) {
                    .success => sink.endPromise.resolve(globalObject, JSC.jsNumber(0)),
                    .failure => |err| {
                        if (!sink.done) {
                            sink.abort();
                            return;
                        }
                        const js_err = globalObject.createErrorInstance("{s}", .{err.message});
                        js_err.put(globalObject, JSC.ZigString.static("code"), JSC.ZigString.init(err.code).toJS(globalObject));
                        sink.endPromise.rejectOnNextTick(globalObject, js_err);
                    },
                }
                sink.finalize();
                sink.destroy();
            }
        };
        this.ref(); // ref the credentials
        const task = MultiPartUpload.new(.{
            .options = .{},
            .credentials = this,
            .path = bun.default_allocator.dupe(u8, path) catch bun.outOfMemory(),
            .callback = @ptrCast(&Wrapper.callback),
            .callback_context = undefined,
            .globalThis = globalThis,
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
    pub const MAX_SINGLE_UPLOAD_SIZE: usize = 4294967296; // we limit to 4 GiB
    const OneMiB: usize = 1048576;
    const MAX_QUEUE_SIZE = 64; // dont make sense more than this because we use fetch anything greater will be 64
    const AWS = AWSCredentials;
    queue: std.ArrayListUnmanaged(UploadPart) = .{},

    available: std.bit_set.IntegerBitSet(MAX_QUEUE_SIZE) = std.bit_set.IntegerBitSet(MAX_QUEUE_SIZE).initFull(),

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
    upload_id: []const u8 = "",
    uploadid_buffer: bun.MutableString = .{ .allocator = bun.default_allocator, .list = .{} },

    multipart_etags: std.ArrayListUnmanaged(MultiPartUpload.UploadPart.UploadPartResult) = .{},
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

    pub const MultiPartUploadOptions = struct {
        queueSize: u8 = 5, // more than 64 dont make sense so limit to 64
        // in s3 client sdk they set it in bytes but the min is still 5 MiB
        // var params = {Bucket: 'bucket', Key: 'key', Body: stream};
        // var options = {partSize: 10 * 1024 * 1024, queueSize: 1};
        // s3.upload(params, options, function(err, data) {
        //   console.log(err, data);
        // });
        // See. https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property
        partSize: u16 = 5, // in MiB min is 5 and max 5120 (but we limit to 4 GiB aka 4096)
        retry: u8 = 3, // default is 3 max 255
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
        fn sortEtags(_: *anyopaque, a: UploadPart.UploadPartResult, b: UploadPart.UploadPartResult) bool {
            return a.number < b.number;
        }

        pub fn onPartResponse(result: AWS.S3PartResult, this: *@This()) void {
            if (this.owns_data) bun.default_allocator.free(this.data);

            if (this.state == .canceled) {
                this.ctx.deref();
                return;
            }

            this.state = .completed;

            switch (result) {
                .failure => {
                    if (this.retry > 0) {
                        this.retry -= 1;
                        // retry failed
                        this.perform();
                        return;
                    } else {
                        return this.ctx.fail(if (result == .not_found) .{
                            .code = "UnknownError",
                            .message = "Failed to send part of multipart upload",
                        } else result.failure);
                    }
                },
                .etag => |etag| {

                    // we will need to order this
                    this.ctx.multipart_etags.append(bun.default_allocator, .{
                        .number = this.partNumber,
                        .etag = bun.default_allocator.dupe(etag),
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
            const searchParams = std.fmt.bufPrint(&params_buffer, "?partNumber={}&uploadId={s}&x-id=UploadPart", .{
                this.partNumber,
                this.ctx.upload_id,
            }) catch unreachable;
            this.ctx.credentials.executeSimpleS3Request(this.ctx.path, .PUT, .{ .upload = @ptrCast(&onPartResponse) }, this, this.ctx.proxyUrl(), this.data, null, searchParams);
        }
        pub fn start(this: *@This()) void {
            if (this.state != .pending) return;
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
        if (this.queue.capacity > 0)
            this.queue.deinit(bun.default_allocator);
        this.poll_ref.unref(this.vm);
        bun.default_allocator.free(this.path);
        this.credentials.deref();
        this.uploadid_buffer.deinit();
        for (this.multipart_etags) |tag| {
            bun.default_allocator.free(tag.etag);
        }
        if (this.multipart_upload_list.cap > 0)
            this.multipart_upload_list.deinitWithAllocator(bun.default_allocator);
        if (this.multipart_upload_list.cap > 0)
            this.multipart_upload_list.deinitWithAllocator(bun.default_allocator);
        this.destroy();
    }

    pub fn singleSendUploadResponse(result: AWS.S3UploadResult, this: *@This()) void {
        switch (result) {
            .failure => |err| {
                if (this.options.retry > 0) {
                    this.options.retry -= 1;
                    // retry failed
                    this.credentials.executeSimpleS3Request(this.path, .PUT, .{ .upload = @ptrCast(&singleSendUploadResponse) }, this, this.proxyUrl(), this.buffered.items, null, null);

                    return;
                } else {
                    return this.fail(err);
                }
            },
            .success => this.done(),
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
        for (this.queue.items) |*part| {
            if (part.state == .pending) {
                // lets start the part request
                part.start();
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
    fn fail(this: *@This(), _err: AWS.S3Error) void {
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
            this.multipart_upload_list.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?><CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">");
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
            .failure => |err| this.fail(err),
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
                    this.fail(.{
                        .code = "UnknownError",
                        .message = "Failed to initiate multipart upload",
                    });
                    return;
                }
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
        var params_buffer: [2048]u8 = undefined;
        const searchParams = std.fmt.bufPrint(&params_buffer, "?uploadId={s}", .{
            this.upload_id,
        }) catch unreachable;

        this.credentials.executeSimpleS3Request(this.path, .POST, .{ .commit = @ptrCast(&onCommitMultiPartRequest) }, this, this.proxyUrl(), this.multipart_upload_list.slice(), null, searchParams);
    }
    fn rollbackMultiPartRequest(this: *@This()) void {
        var params_buffer: [2048]u8 = undefined;
        const searchParams = std.fmt.bufPrint(&params_buffer, "?uploadId={s}", .{
            this.upload_id,
        }) catch unreachable;

        this.credentials.executeSimpleS3Request(this.path, .DELETE, .{ .upload = @ptrCast(&onRollbackMultiPartRequest) }, this, this.proxyUrl(), "", null, searchParams);
    }
    fn enqueuePart(this: *@This(), chunk: []const u8, owns_data: bool) bool {
        const part = this.getCreatePart(chunk, owns_data) orelse return false;

        if (this.state == .not_started) {
            // will auto start later
            this.state = .multipart_started;
            this.credentials.executeSimpleS3Request(this.path, .POST, .{ .download = @ptrCast(&startMultiPartRequestResult) }, this, this.proxyUrl(), "", null, "?uploads=");
        } else {
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
        const proxy_url = this.vm.bundler.env.getHttpProxy(true, null);
        return if (proxy_url) |url| url.href else null;
    }
    fn processBuffered(this: *@This(), part_size: usize) void {
        if (this.ended and this.buffered.items.len < this.partSizeInBytes() and this.state == .not_started) {
            this.state = .singlefile_started;
            // we can do only 1 request
            this.credentials.executeSimpleS3Request(this.path, .PUT, .{ .upload = @ptrCast(&singleSendUploadResponse) }, this, this.proxyUrl(), this.buffered.items, null, null);
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
