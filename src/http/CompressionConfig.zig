const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const Encoding = @import("./Encoding.zig").Encoding;

/// EASY DEFAULT TOGGLE: Change this to switch compression on/off by default
/// NOTE: Compression is OPT-IN because it requires caching for performance.
/// Enable explicitly with `compression: true` or `compression: { ... }` in Bun.serve()
pub const COMPRESSION_ENABLED_BY_DEFAULT = false;

/// Compression Configuration for Bun.serve()
///
/// ## Current Implementation:
/// - **Static routes only** - Only compresses Response objects defined in routes
/// - **Lazy caching** - First request compresses and caches, subsequent requests serve cached version
/// - **Per-encoding cache** - Stores separate compressed variant for EACH encoding client requests
/// - **Memory cost** - Each static route stores original + up to 4 compressed variants
///   - Small files (< 10KB): negligible extra memory (~200 bytes total for all variants)
///   - Large files (1MB+): significant extra memory (~300-400KB for all variants)
///
/// ## Memory Implications:
/// Static routes already cache the original file data. This adds compressed variants:
/// - If you have 100 static routes with 1MB files = ~40MB extra for compression cache
/// - Only caches variants that clients actually request (lazy)
/// - Compression often makes files smaller, but we store BOTH original and compressed
///
/// ## Not Supported (Yet):
/// - **Dynamic routes** - Responses from fetch() handlers (would need LRU cache with TTL)
/// - **Streaming responses** - ReadableStream bodies are rejected from static routes (see StaticRoute.zig:160)
/// - **Cache enforcement** - Cache config exists but limits not enforced yet (TODO)
///   - cache.maxSize, cache.ttl, cache.minEntrySize, cache.maxEntrySize are parsed but not checked
///   - Setting cache: false disables caching immediately
///   - --smol mode uses smaller defaults which will matter once enforcement is added
/// - **Per-route control** - Can only enable/disable globally or per-algorithm
///
/// ## Usage:
/// ```js
/// Bun.serve({
///   compression: true, // Use defaults (br=4, gzip=6, zstd=3, 50MB cache, 24h TTL)
///   compression: {
///     brotli: 6,
///     gzip: false, // Disable specific algorithm
///     cache: false, // Disable caching entirely (compress on-demand)
///     cache: {
///       maxSize: 100 * 1024 * 1024, // 100MB total cache
///       ttl: 3600, // 1 hour (seconds)
///       minEntrySize: 512, // Don't cache < 512 bytes
///       maxEntrySize: 5 * 1024 * 1024, // Don't cache > 5MB
///     }
///   },
///   compression: false, // Disable (default)
/// })
/// ```
///
/// ## --smol Mode:
/// When `bun --smol` is used, compression defaults to more conservative limits:
/// - maxSize: 5MB (vs 50MB normal)
/// - ttl: 1 hour (vs 24 hours normal)
/// - maxEntrySize: 1MB (vs 10MB normal)
pub const CompressionConfig = struct {
    pub const CacheConfig = struct {
        /// Maximum total size of all cached compressed variants (bytes)
        max_size: usize,
        /// Time-to-live for cached variants (milliseconds), 0 = infinite
        ttl_ms: u64,
        /// Minimum size of entry to cache (bytes)
        min_entry_size: usize,
        /// Maximum size of single entry to cache (bytes)
        max_entry_size: usize,

        pub const DEFAULT = CacheConfig{
            .max_size = 50 * 1024 * 1024, // 50MB total cache
            .ttl_ms = 24 * 60 * 60 * 1000, // 24 hours
            .min_entry_size = 128, // Don't cache tiny files
            .max_entry_size = 10 * 1024 * 1024, // Don't cache > 10MB
        };

        pub const SMOL = CacheConfig{
            .max_size = 5 * 1024 * 1024, // 5MB total cache for --smol
            .ttl_ms = 60 * 60 * 1000, // 1 hour
            .min_entry_size = 512, // Higher threshold
            .max_entry_size = 1 * 1024 * 1024, // Max 1MB per entry
        };

        pub fn fromJS(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) bun.JSError!CacheConfig {
            var config = CacheConfig.DEFAULT;

            if (try value.getOptional(globalThis, "maxSize", i32)) |max_size| {
                config.max_size = @intCast(@max(0, max_size));
            }
            if (try value.getOptional(globalThis, "ttl", i32)) |ttl_seconds| {
                config.ttl_ms = @intCast(@max(0, ttl_seconds) * 1000);
            }
            if (try value.getOptional(globalThis, "minEntrySize", i32)) |min_size| {
                config.min_entry_size = @intCast(@max(0, min_size));
            }
            if (try value.getOptional(globalThis, "maxEntrySize", i32)) |max_size| {
                config.max_entry_size = @intCast(@max(0, max_size));
            }

            return config;
        }
    };

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
    cache: ?CacheConfig,

    pub const DEFAULT_THRESHOLD: usize = 1024;

    /// Default compression configuration - modify these values to change defaults
    pub const DEFAULT = CompressionConfig{
        .brotli = .{ .level = 4, .threshold = DEFAULT_THRESHOLD }, // Sweet spot for speed/compression
        .gzip = .{ .level = 6, .threshold = DEFAULT_THRESHOLD }, // Standard default
        .zstd = .{ .level = 3, .threshold = DEFAULT_THRESHOLD }, // Fast default
        .deflate = null, // Disabled by default (obsolete)
        .threshold = DEFAULT_THRESHOLD,
        .disable_for_localhost = true,
        .cache = CacheConfig.DEFAULT,
    };

    /// Parse compression config from JavaScript
    /// Supports:
    /// - true: use defaults
    /// - false: disable compression (returns null)
    /// - { brotli: 4, gzip: 6, zstd: false, ... }: custom config
    pub fn fromJS(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) bun.JSError!?*CompressionConfig {
        // Check if --smol mode is enabled
        const is_smol = globalThis.bunVM().smol;

        if (value.isBoolean()) {
            if (!value.toBoolean()) {
                // compression: false -> return null to indicate disabled
                return null;
            }
            // compression: true -> use defaults (smol-aware)
            const config = bun.handleOom(bun.default_allocator.create(CompressionConfig));
            config.* = DEFAULT;
            if (is_smol and config.cache != null) {
                config.cache = CacheConfig.SMOL;
            }
            return config;
        }

        if (!value.isObject()) {
            return globalThis.throwInvalidArguments("compression must be a boolean or object", .{});
        }

        const config = bun.handleOom(bun.default_allocator.create(CompressionConfig));
        errdefer bun.default_allocator.destroy(config);

        // Start with defaults (smol-aware)
        config.* = DEFAULT;
        if (is_smol and config.cache != null) {
            config.cache = CacheConfig.SMOL;
        }

        // Parse brotli config (supports false, number, or object)
        if (try value.get(globalThis, "brotli")) |brotli_val| {
            if (brotli_val.isBoolean()) {
                if (!brotli_val.toBoolean()) {
                    config.brotli = null; // Explicitly disabled
                }
                // If true, keep default
            } else {
                config.brotli = try AlgorithmConfig.fromJS(globalThis, brotli_val, 0, 11, 4);
            }
        }

        // Parse gzip config
        if (try value.get(globalThis, "gzip")) |gzip_val| {
            if (gzip_val.isBoolean()) {
                if (!gzip_val.toBoolean()) {
                    config.gzip = null;
                }
            } else {
                config.gzip = try AlgorithmConfig.fromJS(globalThis, gzip_val, 1, 9, 6);
            }
        }

        // Parse zstd config
        if (try value.get(globalThis, "zstd")) |zstd_val| {
            if (zstd_val.isBoolean()) {
                if (!zstd_val.toBoolean()) {
                    config.zstd = null;
                }
            } else {
                config.zstd = try AlgorithmConfig.fromJS(globalThis, zstd_val, 1, 22, 3);
            }
        }

        // Parse deflate config
        if (try value.get(globalThis, "deflate")) |deflate_val| {
            if (deflate_val.isBoolean()) {
                if (!deflate_val.toBoolean()) {
                    config.deflate = null;
                }
            } else {
                config.deflate = try AlgorithmConfig.fromJS(globalThis, deflate_val, 1, 9, 6);
            }
        }

        // Parse threshold
        if (try value.get(globalThis, "threshold")) |threshold_val| {
            if (threshold_val.isNumber()) {
                config.threshold = @intCast(try threshold_val.coerce(i32, globalThis));
            }
        }

        // Parse disableForLocalhost
        if (try value.get(globalThis, "disableForLocalhost")) |disable_val| {
            if (disable_val.isBoolean()) {
                config.disable_for_localhost = disable_val.toBoolean();
            }
        }

        // Parse cache config
        if (try value.get(globalThis, "cache")) |cache_val| {
            if (cache_val.isBoolean()) {
                if (!cache_val.toBoolean()) {
                    config.cache = null; // false = disable caching
                }
            } else if (cache_val.isObject()) {
                config.cache = try CacheConfig.fromJS(globalThis, cache_val);
            }
        }

        return config;
    }

    const Preference = struct {
        encoding: Encoding,
        quality: f32,
    };

    /// Select best encoding based on Accept-Encoding header and available config
    /// Returns null if no compression should be used
    pub fn selectBestEncoding(this: *const CompressionConfig, accept_encoding: []const u8) ?Encoding {
        var preferences: [8]Preference = undefined;
        var pref_count: usize = 0;

        // Parse Accept-Encoding header
        var iter = std.mem.splitScalar(u8, accept_encoding, ',');
        while (iter.next()) |token| {
            if (pref_count >= preferences.len) break;

            const trimmed = std.mem.trim(u8, token, " \t");
            if (trimmed.len == 0) continue;

            var quality: f32 = 1.0;
            var encoding_name = trimmed;

            // Parse quality value
            if (std.mem.indexOf(u8, trimmed, ";q=")) |q_pos| {
                encoding_name = std.mem.trim(u8, trimmed[0..q_pos], " \t");
                const q_str = std.mem.trim(u8, trimmed[q_pos + 3 ..], " \t");
                quality = std.fmt.parseFloat(f32, q_str) catch 1.0;
            } else if (std.mem.indexOf(u8, trimmed, "; q=")) |q_pos| {
                encoding_name = std.mem.trim(u8, trimmed[0..q_pos], " \t");
                const q_str = std.mem.trim(u8, trimmed[q_pos + 4 ..], " \t");
                quality = std.fmt.parseFloat(f32, q_str) catch 1.0;
            }

            // Skip if quality is 0 (explicitly disabled)
            if (quality <= 0.0) continue;

            // Map to encoding enum
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
                null // wildcard
            else
                continue; // unknown encoding

            if (encoding) |enc| {
                preferences[pref_count] = .{ .encoding = enc, .quality = quality };
                pref_count += 1;
            }
        }

        // Sort by quality (descending)
        std.mem.sort(Preference, preferences[0..pref_count], {}, struct {
            fn lessThan(_: void, a: Preference, b: Preference) bool {
                return a.quality > b.quality;
            }
        }.lessThan);

        // Select first available encoding that's enabled
        for (preferences[0..pref_count]) |pref| {
            switch (pref.encoding) {
                .brotli => if (this.brotli != null) return .brotli,
                .zstd => if (this.zstd != null) return .zstd,
                .gzip => if (this.gzip != null) return .gzip,
                .deflate => if (this.deflate != null) return .deflate,
                .identity => return null, // Client wants no compression
                else => continue,
            }
        }

        // Fallback: use server preference if no quality specified or all equal
        if (pref_count == 0 or allQualitiesEqual(preferences[0..pref_count])) {
            if (this.brotli != null) return .brotli;
            if (this.zstd != null) return .zstd;
            if (this.gzip != null) return .gzip;
            if (this.deflate != null) return .deflate;
        }

        return null;
    }

    fn allQualitiesEqual(prefs: []const Preference) bool {
        if (prefs.len == 0) return true;
        const first = prefs[0].quality;
        for (prefs[1..]) |p| {
            if (p.quality != first) return false;
        }
        return true;
    }

    pub fn deinit(this: *CompressionConfig) void {
        bun.default_allocator.destroy(this);
    }
};
