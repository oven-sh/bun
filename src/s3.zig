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

    pub fn s3Request(this: *const @This(), bucket: []const u8, path: []const u8, method: bun.http.Method, content_hash: ?[]const u8) !SignResult {
        const method_name = switch (method) {
            .GET => "GET",
            .POST, .PUT => "PUT",
            .DELETE => "DELETE",
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
        const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
        const region = if (this.region.len > 0) this.region else "us-east-1";

        // detect service name and host from region or endpoint

        const host = try std.fmt.allocPrint(bun.default_allocator, "s3.{s}.amazonaws.com", .{region});
        const service_name = "s3";

        errdefer bun.default_allocator.free(host);

        const aws_content_hash = if (content_hash) |hash| hash else "UNSIGNED-PAYLOAD";
        const authorization = brk: {
            // we hash the hash so we need 2 buffers
            var hmac_sig_service: [bun.BoringSSL.EVP_MAX_MD_SIZE]u8 = undefined;
            var hmac_sig_service2: [bun.BoringSSL.EVP_MAX_MD_SIZE]u8 = undefined;

            var tmp_buffer: [2048]u8 = undefined;

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

            const searchParams = "";
            const canonical = try std.fmt.bufPrint(&tmp_buffer, "{s}\n{s}\n{s}\nhost:{s}\nx-amz-content-sha256:{s}\nx-amz-date:{s}\n\n{s}\n{s}", .{ method_name, normalizedPath, searchParams, host, aws_content_hash, amz_date, signedHeaders, aws_content_hash });

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
};
