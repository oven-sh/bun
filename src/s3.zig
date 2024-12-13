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
    threadlocal var SIGNATURE_CACHE: bun.StringArrayHashMap([DIGESTED_HMAC_256_LEN]u8) = undefined;
    threadlocal var SIGNATURE_CACHE_DATE: u64 = 0;

    pub const SignResult = struct {
        amz_date: []const u8,
        host: []const u8,
        authorization: []const u8,
        url: []const u8,
        headers: [4]picohttp.Header,

        pub fn deinit(this: *const SignResult) void {
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
    pub fn signRequest(this: *const @This(), bucket: []const u8, path: []const u8, method: bun.http.Method, content_hash: ?[]const u8, signQueryOption: ?SignQueryOptions) !SignResult {
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

        if (bucket.len == 0) return error.InvalidPath;
        // if we allow path.len == 0 it will list the bucket for now we disallow
        if (path.len == 0) return error.InvalidPath;

        var path_buffer: [1024 + 63 + 2]u8 = undefined; // 1024 max key size and 63 max bucket name

        const normalizedPath = std.fmt.bufPrint(&path_buffer, "/{s}{s}", .{ bucket, if (strings.endsWith(path, "/")) path[0 .. path.len - 1] else path }) catch return error.InvalidPath;

        const date_result = getAMZDate(bun.default_allocator);
        const amz_date = date_result.date;
        errdefer bun.default_allocator.free(amz_date);

        const amz_day = amz_date[0..8];
        const signedHeaders = if (signQuery) "host" else "host;x-amz-content-sha256;x-amz-date";
        const region = if (this.region.len > 0) this.region else "us-east-1";

        // detect service name and host from region or endpoint
        const host = try std.fmt.allocPrint(bun.default_allocator, "s3.{s}.amazonaws.com", .{region});
        const service_name = "s3";

        errdefer bun.default_allocator.free(host);

        const aws_content_hash = if (content_hash) |hash| hash else "UNSIGNED-PAYLOAD";
        var tmp_buffer: [2048]u8 = undefined;

        const authorization = brk: {
            // we hash the hash so we need 2 buffers
            var hmac_sig_service: [bun.BoringSSL.EVP_MAX_MD_SIZE]u8 = undefined;
            var hmac_sig_service2: [bun.BoringSSL.EVP_MAX_MD_SIZE]u8 = undefined;

            const sigDateRegionServiceReq = brk_sign: {
                const key = try std.fmt.bufPrint(&tmp_buffer, "{s}{s}{s}", .{ region, service_name, this.secretAccessKey });

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
                // not cached yet lets generate a new one
                const sigDate = bun.hmac.generate(try std.fmt.bufPrint(&tmp_buffer, "AWS4{s}", .{this.secretAccessKey}), amz_day, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;
                const sigDateRegion = bun.hmac.generate(sigDate, region, .sha256, &hmac_sig_service2) orelse return error.FailedToGenerateSignature;
                const sigDateRegionService = bun.hmac.generate(sigDateRegion, service_name, .sha256, &hmac_sig_service) orelse return error.FailedToGenerateSignature;
                const result = bun.hmac.generate(sigDateRegionService, "aws4_request", .sha256, &hmac_sig_service2) orelse return error.FailedToGenerateSignature;

                try SIGNATURE_CACHE.put(try bun.default_allocator.dupe(u8, key), hmac_sig_service2[0..DIGESTED_HMAC_256_LEN].*);
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

    pub const S3StatResult = union(enum) {
        success: struct {
            size: usize = 0,
            /// etag is not owned and need to be copied if used after this callback
            etag: []const u8 = "",
        },
        not_found: void,

        /// failure error is not owned and need to be copied if used after this callback
        failure: struct {
            code: []const u8,
            message: []const u8,
        },
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
        failure: struct {
            code: []const u8,
            message: []const u8,
        },
    };
    pub const S3UploadResult = union(enum) {
        success: void,
        /// failure error is not owned and need to be copied if used after this callback
        failure: struct {
            code: []const u8,
            message: []const u8,
        },
    };
    pub const S3DeleteResult = union(enum) {
        success: void,
        not_found: void,

        /// failure error is not owned and need to be copied if used after this callback
        failure: struct {
            code: []const u8,
            message: []const u8,
        },
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
            if (this.result.body) |body| {
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

    pub fn executeSimpleS3Request(this: *const @This(), bucket: []const u8, path: []const u8, method: bun.http.Method, callback: S3HttpSimpleTask.Callback, callback_context: *anyopaque, proxy_url: ?[]const u8, body: []const u8, range: ?[]const u8) void {
        var result = this.signRequest(bucket, path, method, null, null) catch |sign_err| {
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

    pub fn s3Stat(this: *const @This(), bucket: []const u8, path: []const u8, callback: *const fn (S3StatResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(bucket, path, .HEAD, .{ .stat = callback }, callback_context, proxy_url, "", null);
    }

    pub fn s3Download(this: *const @This(), bucket: []const u8, path: []const u8, callback: *const fn (S3DownloadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(bucket, path, .GET, .{ .download = callback }, callback_context, proxy_url, "", null);
    }

    pub fn s3DownloadSlice(this: *const @This(), bucket: []const u8, path: []const u8, offset: usize, len: ?usize, callback: *const fn (S3DownloadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        const range = if (len != null) std.fmt.allocPrint(bun.default_allocator, "bytes={}-{}", .{ offset, offset + len.? }) catch bun.outOfMemory() else std.fmt.allocPrint(bun.default_allocator, "bytes={}-", .{offset}) catch bun.outOfMemory();
        this.executeSimpleS3Request(bucket, path, .GET, .{ .download = callback }, callback_context, proxy_url, "", range);
    }

    pub fn s3Delete(this: *const @This(), bucket: []const u8, path: []const u8, callback: *const fn (S3DeleteResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(bucket, path, .DELETE, .{ .delete = callback }, callback_context, proxy_url, "", null);
    }

    pub fn s3Upload(this: *const @This(), bucket: []const u8, path: []const u8, content: []const u8, callback: *const fn (S3UploadResult, *anyopaque) void, callback_context: *anyopaque, proxy_url: ?[]const u8) void {
        this.executeSimpleS3Request(bucket, path, .POST, .{ .upload = callback }, callback_context, proxy_url, content, null);
    }
};
