const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const Encoding = @import("./Encoding.zig").Encoding;

pub const CompressionConfig = struct {
    pub const AlgorithmConfig = struct {
        level: u8,
        threshold: usize,

        pub fn fromJS(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue, comptime min_level: u8, comptime max_level: u8, default_level: u8) bun.JSError!AlgorithmConfig {
            if (value.isNumber()) {
                const level = try value.coerce(i32, globalThis);
                if (level < min_level or level > max_level) {
                    return globalThis.throwInvalidArguments("compression level must be between {d} and {d}", .{ min_level, max_level });
                }
                return .{ .level = @intCast(level), .threshold = DEFAULT_THRESHOLD };
            }
            if (value.isObject()) {
                const level_val = try value.get(globalThis, "level") orelse return .{ .level = default_level, .threshold = DEFAULT_THRESHOLD };
                const level = try level_val.coerce(i32, globalThis);
                if (level < min_level or level > max_level) {
                    return globalThis.throwInvalidArguments("compression level must be between {d} and {d}", .{ min_level, max_level });
                }

                const threshold_val = try value.get(globalThis, "threshold");
                const threshold = if (threshold_val) |t| @as(usize, @intCast(try t.coerce(i32, globalThis))) else DEFAULT_THRESHOLD;

                return .{ .level = @intCast(level), .threshold = threshold };
            }
            return .{ .level = default_level, .threshold = DEFAULT_THRESHOLD };
        }
    };

    brotli: ?AlgorithmConfig,
    gzip: ?AlgorithmConfig,
    zstd: ?AlgorithmConfig,
    deflate: ?AlgorithmConfig,

    threshold: usize,
    disable_for_localhost: bool,

    pub const DEFAULT_THRESHOLD: usize = 1024;

    pub const DEFAULT = CompressionConfig{
        .brotli = .{ .level = 4, .threshold = DEFAULT_THRESHOLD },
        .gzip = .{ .level = 6, .threshold = DEFAULT_THRESHOLD },
        .zstd = .{ .level = 3, .threshold = DEFAULT_THRESHOLD },
        .deflate = null,
        .threshold = DEFAULT_THRESHOLD,
        .disable_for_localhost = true,
    };

    pub fn fromJS(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) bun.JSError!?*CompressionConfig {
        if (value.isBoolean()) {
            if (!value.toBoolean()) return null;
            const config = bun.handleOom(bun.default_allocator.create(CompressionConfig));
            config.* = DEFAULT;
            return config;
        }

        if (!value.isObject()) {
            return globalThis.throwInvalidArguments("compression must be a boolean or object", .{});
        }

        const config = bun.handleOom(bun.default_allocator.create(CompressionConfig));
        errdefer bun.default_allocator.destroy(config);

        config.* = DEFAULT;

        if (try value.get(globalThis, "brotli")) |brotli_val| {
            if (brotli_val.isBoolean()) {
                if (!brotli_val.toBoolean()) config.brotli = null;
            } else {
                config.brotli = try AlgorithmConfig.fromJS(globalThis, brotli_val, 0, 11, 4);
            }
        }

        if (try value.get(globalThis, "gzip")) |gzip_val| {
            if (gzip_val.isBoolean()) {
                if (!gzip_val.toBoolean()) config.gzip = null;
            } else {
                config.gzip = try AlgorithmConfig.fromJS(globalThis, gzip_val, 1, 9, 6);
            }
        }

        if (try value.get(globalThis, "zstd")) |zstd_val| {
            if (zstd_val.isBoolean()) {
                if (!zstd_val.toBoolean()) config.zstd = null;
            } else {
                config.zstd = try AlgorithmConfig.fromJS(globalThis, zstd_val, 1, 22, 3);
            }
        }

        if (try value.get(globalThis, "deflate")) |deflate_val| {
            if (deflate_val.isBoolean()) {
                if (!deflate_val.toBoolean()) config.deflate = null;
            } else {
                config.deflate = try AlgorithmConfig.fromJS(globalThis, deflate_val, 1, 9, 6);
            }
        }

        if (try value.get(globalThis, "threshold")) |threshold_val| {
            if (threshold_val.isNumber()) {
                config.threshold = @intCast(try threshold_val.coerce(i32, globalThis));
            }
        }

        if (try value.get(globalThis, "disableForLocalhost")) |disable_val| {
            if (disable_val.isBoolean()) {
                config.disable_for_localhost = disable_val.toBoolean();
            }
        }

        return config;
    }

    const Preference = struct {
        encoding: Encoding,
        quality: f32,
    };

    pub fn selectBestEncoding(this: *const CompressionConfig, accept_encoding: []const u8) ?Encoding {
        var preferences: [8]Preference = undefined;
        var pref_count: usize = 0;

        var iter = std.mem.splitScalar(u8, accept_encoding, ',');
        while (iter.next()) |token| {
            if (pref_count >= preferences.len) break;

            const trimmed = std.mem.trim(u8, token, " \t");
            if (trimmed.len == 0) continue;

            var quality: f32 = 1.0;
            var encoding_name = trimmed;

            if (std.mem.indexOf(u8, trimmed, ";q=")) |q_pos| {
                encoding_name = std.mem.trim(u8, trimmed[0..q_pos], " \t");
                const q_str = std.mem.trim(u8, trimmed[q_pos + 3 ..], " \t");
                quality = std.fmt.parseFloat(f32, q_str) catch 1.0;
            } else if (std.mem.indexOf(u8, trimmed, "; q=")) |q_pos| {
                encoding_name = std.mem.trim(u8, trimmed[0..q_pos], " \t");
                const q_str = std.mem.trim(u8, trimmed[q_pos + 4 ..], " \t");
                quality = std.fmt.parseFloat(f32, q_str) catch 1.0;
            }

            if (quality <= 0.0) continue;

            const encoding: ?Encoding = if (bun.strings.eqlComptime(encoding_name, "br"))
                .brotli
            else if (bun.strings.eqlComptime(encoding_name, "gzip"))
                .gzip
            else if (bun.strings.eqlComptime(encoding_name, "zstd"))
                .zstd
            else if (bun.strings.eqlComptime(encoding_name, "deflate"))
                .deflate
            else if (bun.strings.eqlComptime(encoding_name, "identity"))
                .identity
            else if (bun.strings.eqlComptime(encoding_name, "*"))
                null
            else
                continue;

            if (encoding) |enc| {
                preferences[pref_count] = .{ .encoding = enc, .quality = quality };
                pref_count += 1;
            }
        }

        std.mem.sort(Preference, preferences[0..pref_count], {}, struct {
            fn lessThan(_: void, a: Preference, b: Preference) bool {
                return a.quality > b.quality;
            }
        }.lessThan);

        for (preferences[0..pref_count]) |pref| {
            switch (pref.encoding) {
                .brotli => if (this.brotli != null) return .brotli,
                .zstd => if (this.zstd != null) return .zstd,
                .gzip => if (this.gzip != null) return .gzip,
                .deflate => if (this.deflate != null) return .deflate,
                .identity => return null,
                else => continue,
            }
        }

        return null;
    }

    pub fn deinit(this: *CompressionConfig) void {
        bun.default_allocator.destroy(this);
    }
};
