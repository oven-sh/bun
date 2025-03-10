const bun = @import("root").bun;
const std = @import("std");
const JSC = bun.JSC;
const boring = bun.BoringSSL.c;
const hmac = @import("hmac.zig");
const string = @import("string.zig");
const gen = bun.gen.csrf;

/// CSRF Token implementation for Bun
/// It provides protection against Cross-Site Request Forgery attacks
/// by generating and validating tokens using HMAC signatures
pub const CSRF = @This();

/// Default expiration time for tokens (30 minutes)
pub const DEFAULT_EXPIRATION_MS: u64 = 30 * 60 * 1000;

/// Default HMAC algorithm used for token signing
pub const DEFAULT_ALGORITHM: JSC.API.Bun.Crypto.EVP.Algorithm = .sha256;

/// Error types for CSRF operations
pub const Error = error{
    InvalidToken,
    ExpiredToken,
    TokenCreationFailed,
    DecodingFailed,
};

/// Options for generating CSRF tokens
pub const GenerateOptions = struct {
    /// Secret key to use for signing
    secret: []const u8,
    /// How long the token should be valid (in milliseconds)
    expires_in_ms: ?u64 = null,
    /// Format to encode the token in
    format: TokenFormat = .base64url,
};

/// Options for validating CSRF tokens
pub const VerifyOptions = struct {
    /// The token to verify
    token: []const u8,
    /// Secret key used to sign the token
    secret: []const u8,
    /// Maximum age of the token in milliseconds
    max_age_ms: ?u64 = null,
};

/// Token encoding format
pub const TokenFormat = enum {
    base64,
    base64url,
    hex,

    pub fn toNodeEncoding(self: TokenFormat) JSC.Node.Encoding {
        return switch (self) {
            .base64 => .base64,
            .base64url => .base64url,
            .hex => .hex,
        };
    }
};

/// Generate a new CSRF token
///
/// Parameters:
/// - options: Configuration for token generation
/// - vm: The JSC virtual machine context
///
/// Returns: A string.Slice containing the encoded token
pub fn generate(
    options: GenerateOptions,
    out_buffer: *[512]u8,
) ![]u8 {
    // Generate nonce from entropy
    var nonce: [16]u8 = undefined;
    bun.rand(&nonce);

    // Current timestamp in milliseconds
    const timestamp = std.time.milliTimestamp();
    const timestamp_u64: u64 = @bitCast(@as(i64, timestamp));

    // Write timestamp to out_buffer
    var timestamp_bytes: [8]u8 = undefined;
    std.mem.writeInt(u64, &timestamp_bytes, timestamp_u64, .big);

    // Prepare payload for signing: timestamp|nonce
    var payload_buf: [24]u8 = undefined; // 8 (timestamp) + 16 (nonce)
    @memcpy(payload_buf[0..8], &timestamp_bytes);
    @memcpy(payload_buf[8..24], &nonce);

    // Sign the payload
    var digest_buf: [boring.EVP_MAX_MD_SIZE]u8 = undefined;
    const digest = hmac.generate(options.secret, &payload_buf, DEFAULT_ALGORITHM, &digest_buf) orelse
        return Error.TokenCreationFailed;

    // Create the final token: timestamp|nonce|signature in out_buffer
    @memcpy(out_buffer[0..8], &timestamp_bytes);
    @memcpy(out_buffer[8..24], &nonce);
    @memcpy(out_buffer[24 .. 24 + digest.len], digest);

    // Return slice of the output buffer with the final token
    return out_buffer[0 .. 24 + digest.len];
}

/// Validate a CSRF token
///
/// Parameters:
/// - options: Configuration for token validation
///
/// Returns: true if valid, false if invalid
pub fn verify(options: VerifyOptions) bool {
    // Detect the encoding format
    var encoding: JSC.Node.Encoding = .hex;
    if (std.mem.indexOf(u8, options.token, "-") != null or std.mem.indexOf(u8, options.token, "_") != null) {
        encoding = .base64url;
    } else if (std.mem.indexOf(u8, options.token, "+") != null or std.mem.indexOf(u8, options.token, "/") != null) {
        encoding = .base64;
    } else if (std.ascii.isHexDigit(options.token[0])) {
        encoding = .hex;
    } else {
        // If we can't determine the format, assume base64
        encoding = .base64;
    }

    // Allocate output buffer for decoded data
    var buf: [boring.EVP_MAX_MD_SIZE]u8 = undefined;
    const decoded_len = switch (encoding) {
        .base64 => bun.base64.decode(&buf, options.token) catch return false,
        .base64url => bun.base64.decodeUrl(&buf, options.token) catch return false,
        .hex => blk: {
            if (options.token.len % 2 != 0) return false;

            var len: usize = 0;
            var i: usize = 0;
            while (i < options.token.len) : (i += 2) {
                const high = std.fmt.charToDigit(options.token[i], 16) catch return false;
                const low = std.fmt.charToDigit(options.token[i + 1], 16) catch return false;
                buf[len] = (high << 4) | low;
                len += 1;
            }
            break :blk len;
        },
        else => return false, // Unsupported encoding
    };

    const decoded = buf[0..decoded_len];

    // Minimum token length: 8 (timestamp) + 16 (nonce) + 32 (minimum HMAC-SHA256 size)
    if (decoded.len < 56) {
        return false;
    }

    // Extract timestamp (first 8 bytes)
    const timestamp = std.mem.readInt(u64, decoded[0..8], .big);

    // Check if token has expired
    const current_time = @as(u64, @bitCast(std.time.milliTimestamp()));
    const expiry = options.max_age_ms orelse DEFAULT_EXPIRATION_MS;

    if (timestamp + expiry < current_time) {
        return false;
    }

    // Extract the parts
    const payload = decoded[0..24]; // timestamp + nonce
    const received_signature = decoded[24..];

    // Verify the signature
    var expected_signature: [boring.EVP_MAX_MD_SIZE]u8 = undefined;
    const signature = hmac.generate(options.secret, payload, DEFAULT_ALGORITHM, &expected_signature) orelse
        return false;

    // Compare signatures in constant time
    if (received_signature.len != signature.len) {
        return false;
    }

    // Use BoringSSL's constant-time comparison to prevent timing attacks
    return boring.CRYPTO_memcmp(
        received_signature.ptr,
        signature.ptr,
        signature.len,
    ) == 0;
}

/// JS binding function for generating CSRF tokens
/// First argument is secret (required), second is options (optional)
pub fn csrf__generate_impl(global_obj: *JSC.JSGlobalObject, call_frame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    bun.Analytics.Features.@"Bun.CSRF.generate" += 1;

    // We should have at least one argument (secret)
    const args = call_frame.arguments(null);
    if (args.len < 1) {
        return global_obj.throwException("Missing required secret parameter", .{});
    }

    // Extract the secret (required)
    if (args[0].isEmpty() or args[0].isUndefinedOrNull()) {
        return global_obj.throwException("Secret is required", .{});
    }
    const secret = args[0].toStringOrNull(global_obj) orelse {
        return global_obj.throwException("Secret must be a string", .{});
    };
    defer secret.deref();

    // Default values
    var expires_in: ?u64 = null;
    var format: TokenFormat = .base64url;

    // Check if we have options object
    if (args.len > 1 and args[1].isObject()) {
        const options_value = args[1];

        // Extract expiresIn (optional)
        if (try options_value.get(global_obj, "expiresIn")) |expires_in_js| {
            expires_in = @intCast(try global_obj.validateIntegerRange(expires_in_js, i64, 0, .{ .min = 0, .max = JSC.MAX_SAFE_INTEGER }));
        }

        // Extract format (optional)
        if (try options_value.get(global_obj, "encoding")) |format_js| {
            format = switch (try JSC.Node.Encoding.fromJSWithDefaultOnEmpty(format_js, global_obj, .base64url)) {
                .base64 => .base64,
                .base64url => .base64url,
                .hex => .hex,
                else => return global_obj.throwInvalidArguments("Invalid format: must be 'base64', 'base64url', or 'hex'", .{}),
            };
        }

        if (try options_value.get(global_obj, "algorithm")) |algorithm_js| {
            algorithm = switch (try JSC.API.Bun.Crypto.EVP.Algorithm.map.fromJSCaseInsensitive(algorithm_js, global_obj)) {
                .sha256 => .sha256,
                .sha384 => .sha384,
                .sha512 => .sha512,
                else => return global_obj.throwInvalidArguments("Invalid algorithm: must be 'sha256', 'sha384', or 'sha512'", .{}),
            };
    }

    // Buffer for token generation
    var token_buffer: [512]u8 = undefined;

    // Generate the token
    const token_bytes = generate(.{
        .secret = secret.slice(),
        .expires_in_ms = expires_in,
        .format = format,
    }, &token_buffer) catch |err| {
        return switch (err) {
            Error.TokenCreationFailed => global_obj.throw("Failed to create CSRF token", .{}),
            else => global_obj.throwError(err, "Failed to generate CSRF token"),
        };
    };

    // Encode the token
    return format.toNodeEncoding().encodeWithMaxSize(global_obj, boring.EVP_MAX_MD_SIZE, token_bytes);
}

pub const csrf__generate: JSC.JSHostFunctionType = JSC.toJSHostFunction(csrf__generate_impl);

/// JS binding function for verifying CSRF tokens
/// First argument is token (required), second is options (optional)
pub fn csrf__verify_impl(global_obj: *JSC.JSGlobalObject, call_frame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    bun.Analytics.Features.@"Bun.CSRF.verify" += 1;

    // We should have at least one argument (token)
    const args = call_frame.arguments(null);
    if (args.len < 1) {
        return global_obj.throwException("Missing required token parameter", .{});
    }

    // Extract the token (required)
    if (args[0].isEmpty() or args[0].isUndefinedOrNull()) {
        return global_obj.throwException("Token is required", .{});
    }
    const token = args[0].toStringOrNull(global_obj) orelse {
        return global_obj.throwException("Token must be a string", .{});
    };
    defer token.deref();

    // Default values
    var secret: ?JSC.StringImpl = null;
    var max_age: u64 = DEFAULT_EXPIRATION_MS;

    // Check if we have options object
    if (args.len > 1 and args[1].isObject()) {
        const options_value = args[1];

        // Extract the secret (required)
        const secret_js = options_value.get(global_obj, "secret");
        if (!secret_js.isEmpty() and !secret_js.isUndefinedOrNull()) {
            secret = secret_js.toStringOrNull(global_obj) orelse {
                return global_obj.throwException("Secret must be a string", .{});
            };
        } else {
            return global_obj.throwException("Missing required 'secret' parameter in options", .{});
        }

        // Extract maxAge (optional)
        const max_age_js = options_value.get(global_obj, "maxAge");
        if (!max_age_js.isEmpty() and !max_age_js.isUndefinedOrNull()) {
            if (max_age_js.isNumber()) {
                const ms = max_age_js.asNumber();
                if (ms > 0) {
                    max_age = @as(u64, @intFromFloat(ms));
                }
            } else {
                defer if (secret) |s| s.deref();
                return global_obj.throwException("maxAge must be a number", .{});
            }
        }
    } else {
        return global_obj.throwException("Missing required options parameter with secret", .{});
    }

    // Verify the token
    const is_valid = verify(.{
        .token = token.slice(),
        .secret = secret.?.slice(),
        .max_age_ms = max_age,
    });

    // Cleanup
    secret.?.deref();

    return JSC.JSValue.jsBoolean(is_valid);
}

pub const csrf__verify: JSC.JSHostFunctionType = JSC.toJSHostFunction(csrf__verify_impl);
