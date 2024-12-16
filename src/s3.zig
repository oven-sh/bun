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

    pub fn signRequest(this: *const @This(), full_path: []const u8, method: bun.http.Method, content_hash: ?[]const u8, signQueryOption: ?SignQueryOptions) !SignResult {
        if (this.accessKeyId.len == 0 or this.secretAccessKey.len == 0) return error.MissingCredentials;
        const signQuery = signQueryOption != null;
        const expires = if (signQueryOption) |options| options.expires else 0;
        const method_name = switch (method) {
            .GET => "GET",
            .POST, .PUT => "PUT",
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
                const canonical = try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, host, aws_content_hash, amz_date, signedHeaders, aws_content_hash });

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
            const canonical = try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, host, aws_content_hash, amz_date, signedHeaders, aws_content_hash });

            var sha_digest = std.mem.zeroes(bun.sha.SHA256.Digest);
            bun.sha.SHA256.hash(canonical, &sha_digest, JSC.VirtualMachine.get().rareData().boringEngine());

            const signValue = try std.fmt.bufPrint(&tmp_buffer, "AWS4-HMAC-SHA256\n{s}\n{s}/{s}/{s}/aws4_request\n{s}", .{ amz_date, amz_day, region, service_name, bun.fmt.bytesToHex(sha_digest[0..bun.sha.SHA256.digest], .lower) });

            const signature = bun.hmac.generate(sigDateRegionServiceReq, signValue, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;

            break :brk try std.fmt.allocPrint(
                bun.default_allocator,
                "AWS4-HMAC-SHA256 Credential={s}/{s}/{s}/{s}/aws4_request, SignedHeaders={s}, Signature={s}",
                .{ this.accessKeyId, amz_day, region, service_name, signedHeaders, bun.fmt.bytesToHex(signature[0..DIGESTED_HMAC_256_LEN], .lower) },
            );
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
            .url = try std.fmt.allocPrint(bun.default_allocator, "https://{s}{s}", .{ host, normalizedPath }),
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

            pub fn fail(this: @This(), code: []const u8, message: []const u8, context: *anyopaque) void {
                switch (this) {
                    inline .upload, .download, .stat, .delete => |callback| callback(.{
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

        fn fail(this: @This()) void {
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
            }
        }

        pub fn http_callback(this: *@This(), async_http: *bun.http.AsyncHTTP, result: bun.http.HTTPClientResult) void {
            const is_done = !result.has_more;
            this.result = result;
            this.http = async_http.*;
            this.http.response_buffer = async_http.response_buffer;
            if (is_done) {
                this.vm.eventLoop().enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
            }
        }
    };

    pub fn executeSimpleS3Request(this: *const @This(), path: []const u8, method: bun.http.Method, callback: S3HttpSimpleTask.Callback, callback_context: *anyopaque, proxy_url: ?[]const u8, body: []const u8, range: ?[]const u8) void {
        var result = this.signRequest(path, method, null, null) catch |sign_err| {
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
            },
        );
        // queue http request
        bun.http.HTTPThread.init(&.{});
        var batch = bun.ThreadPool.Batch{};
        task.http.schedule(bun.default_allocator, &batch);
        bun.http.http_thread.schedule(batch);
    }

    pub fn s3Stat(this: *const @This(), path: []const u8, callback: *const fn (S3StatResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(path, .HEAD, .{ .stat = callback }, callback_context, proxy_url, "", null);
    }

    pub fn s3Download(this: *const @This(), path: []const u8, callback: *const fn (S3DownloadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(path, .GET, .{ .download = callback }, callback_context, proxy_url, "", null);
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

        this.executeSimpleS3Request(path, .GET, .{ .download = callback }, callback_context, proxy_url, "", range);
    }

    pub fn s3Delete(this: *const @This(), path: []const u8, callback: *const fn (S3DeleteResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(path, .DELETE, .{ .delete = callback }, callback_context, proxy_url, "", null);
    }

    pub fn s3Upload(this: *const @This(), path: []const u8, content: []const u8, callback: *const fn (S3UploadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(path, .POST, .{ .upload = callback }, callback_context, proxy_url, content, null);
    }

    pub const S3HttpStreamUpload = struct {
        http: bun.http.AsyncHTTP,
        vm: *JSC.VirtualMachine,
        sign_result: SignResult,
        headers: JSC.WebCore.Headers,
        callback_context: *anyopaque,
        callback: *const fn (S3UploadResult, *anyopaque) void,
        response_buffer: bun.MutableString = .{
            .allocator = bun.default_allocator,
            .list = .{
                .items = &.{},
                .capacity = 0,
            },
        },
        result: bun.http.HTTPClientResult = .{},
        concurrent_task: JSC.ConcurrentTask = .{},
        stream_started: bool = false,
        stream_ended: bool = false,
        ended: bool = false,
        sink: ?*FetchTaskletStream.JSSink = null,
        readable_stream_ref: JSC.WebCore.ReadableStream.Strong = .{},
        signal_store: bun.http.Signals.Store = .{},

        ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),
        request_body: bun.ByteList = .{},
        poll_ref: bun.Async.KeepAlive = bun.Async.KeepAlive.init(),

        pub usingnamespace bun.NewThreadSafeRefCounted(S3HttpStreamUpload, S3HttpStreamUpload.deinit);
        pub const FetchTaskletStream = JSC.WebCore.FetchTaskletChunkedRequestSink;

        pub fn sendRequestData(this: *@This(), data: []const u8, ended: bool) void {
            this.stream_ended = ended;
            if (this.stream_started) {
                if (this.ended and data.len != 3) {
                    bun.default_allocator.free(data);
                    return;
                }
                bun.http.http_thread.scheduleRequestWrite(&this.http, data, ended);
            } else {
                // we need to buffer because the stream did not start yet this can only happen if someone is writing in the JS writable
                this.request_body.append(bun.default_allocator, data) catch bun.outOfMemory();
            }
        }

        pub fn deinit(this: *@This()) void {
            this.poll_ref.unref(this.vm);

            if (this.request_body.cap > 0) {
                this.request_body.deinitWithAllocator(bun.default_allocator);
            }
            if (this.result.certificate_info) |*certificate| {
                certificate.deinit(bun.default_allocator);
            }

            this.response_buffer.deinit();
            this.headers.deinit();
            this.sign_result.deinit();
            this.http.clearData();

            if (this.result.metadata) |*metadata| {
                metadata.deinit(bun.default_allocator);
            }
            this.destroy();
        }

        fn fail(this: @This()) void {
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
            this.callback(.{
                .failure = .{
                    .code = code,
                    .message = message,
                },
            }, this.callback_context);
            if (this.sink) |wrapper| {
                wrapper.sink.abort();
                return;
            }
        }

        fn failWithJSValue(this: *@This(), reason: JSC.JSValue, globalThis: *JSC.JSGlobalObject) void {
            if (!this.ended) {
                this.ended = true;
                reason.ensureStillAlive();
                if (reason.toStringOrNull(globalThis)) |message| {
                    var slice = message.toSlice(globalThis, bun.default_allocator);
                    defer slice.deinit();
                    this.callback(.{
                        .failure = .{
                            .code = "ERR_ABORTED",
                            .message = slice.slice(),
                        },
                    }, this.callback_context);
                } else {
                    // TODO: do better
                    this.fail();
                }
            }
            this.abortTask();
            if (this.sink) |wrapper| {
                wrapper.sink.abort();
                return;
            }
        }
        pub fn abortTask(this: *@This()) void {
            this.signal_store.aborted.store(true, .monotonic);
            bun.http.http_thread.scheduleShutdown(&this.http);
        }

        fn clearSink(this: *@This()) void {
            if (this.sink) |wrapper| {
                this.sink = null;

                wrapper.sink.done = true;
                wrapper.sink.ended = true;
                wrapper.sink.finalize();
                wrapper.detach();
                wrapper.sink.finalizeAndDestroy();
            }
        }
        pub fn onResolveRequestStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            var args = callframe.arguments_old(2);
            var this: *@This() = args.ptr[args.len - 1].asPromisePtr(@This());
            defer this.deref();
            var readable_stream_ref = this.readable_stream_ref;
            this.readable_stream_ref = .{};
            defer readable_stream_ref.deinit();
            if (readable_stream_ref.get()) |stream| {
                stream.done(globalThis);
                this.clearSink();
            }

            return .undefined;
        }

        pub fn onRejectRequestStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const args = callframe.arguments_old(2);
            var this = args.ptr[args.len - 1].asPromisePtr(@This());
            defer this.deref();
            const err = args.ptr[0];
            var readable_stream_ref = this.readable_stream_ref;
            this.readable_stream_ref = .{};
            defer readable_stream_ref.deinit();
            if (readable_stream_ref.get()) |stream| {
                stream.cancel(globalThis);
                this.clearSink();
            }

            this.failWithJSValue(err, globalThis);

            return .undefined;
        }
        pub const shim = JSC.Shimmer("Bun", "S3HttpStreamUpload", @This());

        pub const Export = shim.exportFunctions(.{
            .onResolveRequestStream = onResolveRequestStream,
            .onRejectRequestStream = onRejectRequestStream,
        });
        comptime {
            const jsonResolveRequestStream = JSC.toJSHostFunction(onResolveRequestStream);
            @export(jsonResolveRequestStream, .{ .name = Export[0].symbol_name });
            const jsonRejectRequestStream = JSC.toJSHostFunction(onRejectRequestStream);
            @export(jsonRejectRequestStream, .{ .name = Export[1].symbol_name });
        }

        fn startRequestStream(this: *@This()) void {
            this.stream_started = true;
            if (this.request_body.len > 0) {
                // we have buffered data lets allow it to flow
                var body = this.request_body;
                this.request_body = .{};
                this.sendRequestData(body.slice(), this.stream_ended);
            }
            if (this.readable_stream_ref.get()) |stream| {
                var response_stream = brk: {
                    if (this.sink) |s| break :brk s;
                    this.ref(); // + 1 for the stream

                    var response_stream = S3HttpStreamUpload.FetchTaskletStream.new(.{
                        .task = .{ .s3_upload = this },
                        .buffer = .{},
                        .globalThis = this.readable_stream_ref.globalThis().?,
                    }).toSink();
                    var signal = &response_stream.sink.signal;
                    this.sink = response_stream;

                    signal.* = S3HttpStreamUpload.FetchTaskletStream.JSSink.SinkSignal.init(.zero);

                    // explicitly set it to a dead pointer
                    // we use this memory address to disable signals being sent
                    signal.clear();
                    bun.assert(signal.isDead());
                    break :brk response_stream;
                };
                const globalThis = this.readable_stream_ref.globalThis().?;
                const signal = &response_stream.sink.signal;
                // We are already corked!
                const assignment_result = FetchTaskletStream.JSSink.assignToStream(
                    globalThis,
                    stream.value,
                    response_stream,
                    @as(**anyopaque, @ptrCast(&signal.ptr)),
                );

                assignment_result.ensureStillAlive();

                // assert that it was updated
                bun.assert(!signal.isDead());

                if (assignment_result.toError()) |err_value| {
                    response_stream.detach();
                    this.sink = null;
                    response_stream.sink.finalizeAndDestroy();
                    return this.failWithJSValue(err_value, globalThis);
                }

                if (!assignment_result.isEmptyOrUndefinedOrNull()) {
                    this.vm.drainMicrotasks();

                    assignment_result.ensureStillAlive();
                    // it returns a Promise when it goes through ReadableStreamDefaultReader
                    if (assignment_result.asAnyPromise()) |promise| {
                        switch (promise.status(globalThis.vm())) {
                            .pending => {
                                this.ref(); // + 1 for the promise
                                assignment_result.then(
                                    globalThis,
                                    this,
                                    onResolveRequestStream,
                                    onRejectRequestStream,
                                );
                            },
                            .fulfilled => {
                                var readable_stream_ref = this.readable_stream_ref;
                                this.readable_stream_ref = .{};
                                defer {
                                    stream.done(globalThis);
                                    this.clearSink();
                                    readable_stream_ref.deinit();
                                }
                            },
                            .rejected => {
                                var readable_stream_ref = this.readable_stream_ref;
                                this.readable_stream_ref = .{};

                                defer {
                                    stream.cancel(globalThis);
                                    this.clearSink();
                                    readable_stream_ref.deinit();
                                }

                                this.failWithJSValue(promise.result(globalThis.vm()), globalThis);
                            },
                        }
                        return;
                    } else {
                        // if is not a promise we treat it as Error
                        response_stream.detach();
                        this.sink = null;
                        response_stream.sink.finalizeAndDestroy();
                        this.ended = true;
                        return this.failWithJSValue(assignment_result, globalThis);
                    }
                }
            }
        }

        pub fn onResponse(this: *@This()) void {
            const result = this.result;
            const has_more = result.has_more;
            if (has_more) {
                if (result.can_stream and !this.stream_started and !this.ended) {
                    // start streaming
                    this.startRequestStream();
                }
            } else {
                defer this.deref();
                if (this.ended) {
                    // if the stream rejects we do not call the callback again just ignore the result and deref
                    return;
                }

                this.ended = true;
                if (!result.isSuccess()) {
                    this.fail();
                } else {
                    bun.assert(result.metadata != null);
                    const response = result.metadata.?.response;

                    switch (response.status_code) {
                        200 => {
                            this.callback(.{ .success = {} }, this.callback_context);
                        },
                        else => {
                            this.fail();
                        },
                    }
                }
            }
        }

        pub fn http_callback(this: *@This(), async_http: *bun.http.AsyncHTTP, result: bun.http.HTTPClientResult) void {
            const is_done = !result.has_more;
            this.result = result;
            this.http = async_http.*;
            // at this point we always have 2 refs at least, we only deref the main thread when this task is received and processed
            if (is_done) this.deref();
            this.vm.eventLoop().enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
        }
    };

    /// consumes the readable stream and upload to s3
    pub fn s3UploadStream(this: *const @This(), path: []const u8, readable_stream: *JSC.WebCore.ReadableStream, globalThis: *JSC.JSGlobalObject, callback: *const fn (S3UploadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        var result = this.signRequest(path, .PUT, null, null) catch |sign_err| {
            return switch (sign_err) {
                error.MissingCredentials => callback.fail("MissingCredentials", "missing s3 credentials", callback_context),
                error.InvalidMethod => callback.fail("MissingCredentials", "method must be GET, PUT, DELETE or HEAD when using s3 protocol", callback_context),
                error.InvalidPath => callback.fail("InvalidPath", "invalid s3 bucket, key combination", callback_context),
                else => callback.fail("SignError", "failed to retrieve s3 content check your credentials", callback_context),
            };
        };

        const headers = JSC.WebCore.Headers.fromPicoHttpHeaders(&result.headers, bun.default_allocator) catch bun.outOfMemory();
        const task = S3HttpStreamUpload.new(.{
            .http = undefined,
            .sign_result = result,
            .readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(readable_stream, globalThis),
            .callback_context = callback_context,
            .callback = callback,
            .headers = headers,
            .vm = JSC.VirtualMachine.get(),
        });
        task.poll_ref.ref(task.vm);

        const url = bun.URL.parse(result.url);

        task.http = bun.http.AsyncHTTP.init(
            bun.default_allocator,
            .PUT,
            url,
            task.headers.entries,
            task.headers.buf.items,
            &task.response_buffer,
            "",
            bun.http.HTTPClientResult.Callback.New(
                *S3HttpStreamUpload,
                S3HttpStreamUpload.http_callback,
            ).init(task),
            .follow,
            .{
                .http_proxy = if (proxy_url) |proxy| bun.URL.parse(proxy) else null,
            },
        );
        task.http.client.flags.is_streaming_request_body = true;
        task.http.request_body = .{
            .stream = .{
                .buffer = .{},
                .ended = false,
            },
        };
        // queue http request
        bun.http.HTTPThread.init(&.{});
        var batch = bun.ThreadPool.Batch{};
        task.http.schedule(bun.default_allocator, &batch);
        task.ref(); // +1 for the http thread
        bun.http.http_thread.schedule(batch);
    }
    /// returns a writable stream that writes to the s3 path
    pub fn s3WritableStream(this: *const @This(), path: []const u8, globalThis: *JSC.JSGlobalObject, proxy_url: ?[]const u8) bun.JSError!JSC.JSValue {
        var result = this.signRequest(path, .PUT, null, null) catch |sign_err| {
            return switch (sign_err) {
                error.MissingCredentials => globalThis.throwError(sign_err, "missing s3 credentials"),
                error.InvalidMethod => globalThis.throwError(sign_err, "method must be GET, PUT, DELETE or HEAD when using s3 protocol"),
                error.InvalidPath => globalThis.throwError(sign_err, "invalid s3 bucket, key combination"),
                else => globalThis.throwError(error.SignError, "failed to retrieve s3 content check your credentials"),
            };
        };
        const headers = JSC.WebCore.Headers.fromPicoHttpHeaders(&result.headers, bun.default_allocator) catch bun.outOfMemory();
        // we dont really care about the callback it self, we only care about the WritableStream
        const Wrapper = struct {
            pub fn callback(_: S3UploadResult, _: *anyopaque) void {}
        };
        const task = S3HttpStreamUpload.new(.{
            .http = undefined,
            .sign_result = result,
            .readable_stream_ref = .{},
            .callback_context = undefined,
            .callback = Wrapper.callback,
            .headers = headers,
            .vm = JSC.VirtualMachine.get(),
        });
        task.poll_ref.ref(task.vm);

        task.ref(); // + 1 for the stream
        var response_stream = S3HttpStreamUpload.FetchTaskletStream.new(.{
            .task = .{ .s3_upload = task },
            .buffer = .{},
            .globalThis = globalThis,
        }).toSink();
        var signal = &response_stream.sink.signal;
        task.sink = response_stream;

        signal.* = S3HttpStreamUpload.FetchTaskletStream.JSSink.SinkSignal.init(.zero);

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        signal.clear();
        bun.assert(signal.isDead());

        const url = bun.URL.parse(result.url);

        task.http = bun.http.AsyncHTTP.init(
            bun.default_allocator,
            .PUT,
            url,
            task.headers.entries,
            task.headers.buf.items,
            &task.response_buffer,
            "",
            bun.http.HTTPClientResult.Callback.New(
                *S3HttpStreamUpload,
                S3HttpStreamUpload.http_callback,
            ).init(task),
            .follow,
            .{
                .http_proxy = if (proxy_url) |proxy| bun.URL.parse(proxy) else null,
                .verbose = .headers,
            },
        );
        task.http.client.flags.is_streaming_request_body = true;
        task.http.request_body = .{
            .stream = .{
                .buffer = .{},
                .ended = false,
            },
        };
        // queue http request
        bun.http.HTTPThread.init(&.{});
        var batch = bun.ThreadPool.Batch{};
        task.http.schedule(bun.default_allocator, &batch);
        task.ref(); // +1 for the http thread
        bun.http.http_thread.schedule(batch);

        return response_stream.sink.toJS(globalThis);
    }
};
