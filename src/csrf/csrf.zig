/// CSRF Token implementation for Bun
/// It provides protection against Cross-Site Request Forgery attacks
/// by generating and validating tokens using HMAC signatures
pub const CSRF = @This();

/// Default expiration time for tokens (24 hours)
pub const DEFAULT_EXPIRATION_MS: u64 = 24 * 60 * 60 * 1000;

/// Default HMAC algorithm used for token signing
pub const DEFAULT_ALGORITHM: jsc.API.Bun.Crypto.EVP.Algorithm = .sha256;

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
    expires_in_ms: u64 = DEFAULT_EXPIRATION_MS,
    /// Format to encode the token in
    encoding: TokenFormat = .base64url,
    /// Algorithm to use for signing
    algorithm: jsc.API.Bun.Crypto.EVP.Algorithm = DEFAULT_ALGORITHM,
};

/// Options for validating CSRF tokens
pub const VerifyOptions = struct {
    /// The token to verify
    token: []const u8,
    /// Secret key used to sign the token
    secret: []const u8,
    /// Maximum age of the token in milliseconds
    max_age_ms: u64 = DEFAULT_EXPIRATION_MS,
    /// Encoding to use for the token
    encoding: TokenFormat = .base64url,
    /// Algorithm to use for signing
    algorithm: jsc.API.Bun.Crypto.EVP.Algorithm = DEFAULT_ALGORITHM,
};

/// Token encoding format
pub const TokenFormat = enum {
    base64,
    base64url,
    hex,

    pub fn toNodeEncoding(self: TokenFormat) jsc.Node.Encoding {
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
/// - vm: The jsc virtual machine context
///
/// Returns: A string.Slice containing the encoded token
pub fn generate(
    options: GenerateOptions,
    out_buffer: *[512]u8,
) ![]u8 {
    // Generate nonce from entropy
    var nonce: [16]u8 = .{0} ** 16;
    bun.csprng(&nonce);

    // Current timestamp in milliseconds
    const timestamp = std.time.milliTimestamp();
    const timestamp_u64: u64 = @bitCast(@as(i64, timestamp));

    // Write timestamp to out_buffer
    var timestamp_bytes: [8]u8 = .{0} ** 8;
    std.mem.writeInt(u64, &timestamp_bytes, timestamp_u64, .big);
    var expires_in_bytes: [8]u8 = .{0} ** 8;
    std.mem.writeInt(u64, &expires_in_bytes, options.expires_in_ms, .big);
    // Prepare payload for signing: timestamp|nonce
    var payload_buf: [32]u8 = .{0} ** 32; // 8 (timestamp) + 16 (nonce)
    @memcpy(payload_buf[0..8], &timestamp_bytes);
    @memcpy(payload_buf[8..24], &nonce);
    @memcpy(payload_buf[24..32], &expires_in_bytes);

    // Sign the payload
    var digest_buf: [boring.EVP_MAX_MD_SIZE]u8 = .{0} ** boring.EVP_MAX_MD_SIZE;
    const digest = hmac.generate(options.secret, &payload_buf, options.algorithm, &digest_buf) orelse
        return Error.TokenCreationFailed;

    // Create the final token: timestamp|nonce|expires_in|signature in out_buffer
    @memcpy(out_buffer[0..8], &timestamp_bytes);
    @memcpy(out_buffer[8..24], &nonce);
    @memcpy(out_buffer[24..32], &expires_in_bytes);
    @memcpy(out_buffer[32 .. 32 + digest.len], digest);

    // Return slice of the output buffer with the final token
    return out_buffer[0 .. 32 + digest.len];
}

/// Validate a CSRF token
///
/// Parameters:
/// - options: Configuration for token validation
///
/// Returns: true if valid, false if invalid
pub fn verify(options: VerifyOptions) bool {
    // Detect the encoding format
    const encoding: TokenFormat = options.encoding;

    // Allocate output buffer for decoded data
    var buf: [boring.EVP_MAX_MD_SIZE + 32]u8 = .{0} ** (boring.EVP_MAX_MD_SIZE + 32);
    var token = options.token;
    // check if ends with \0
    if (token.len > 0 and token[token.len - 1] == 0) {
        token = token[0 .. token.len - 1];
    }

    const decoded: []const u8 = brk: switch (encoding) {
        // shares same decoder but encoder is different see encoding.zig
        .base64url, .base64 => {
            // do the same as Buffer.from(token, "base64url" | "base64")
            const slice = bun.strings.trim(token, "\r\n\t " ++ [_]u8{std.ascii.control_code.vt});
            if (slice.len == 0) return false;

            const outlen = bun.base64.decodeLen(slice);
            if (outlen > buf.len) return false;
            const wrote = bun.base64.decode(buf[0..outlen], slice).count;
            break :brk buf[0..wrote];
        },
        .hex => {
            if (token.len % 2 != 0) return false;
            // decoded len
            const decoded_len = token.len / 2;
            if (decoded_len > buf.len) return false;
            const result = bun.strings.decodeHexToBytesTruncate(buf[0..decoded_len], u8, token);
            if (result == decoded_len) {
                break :brk buf[0..decoded_len];
            }
            return false;
        },
    };

    // Minimum token length: 8 (timestamp) + 16 (nonce) + 8 (expires_in) + 32 (minimum HMAC-SHA256 size)
    if (decoded.len < 64) {
        return false;
    }
    // We successfully decoded the token but it could be a bad token
    // base64 and hex can have ambiguity so we need to check for weird cases and reject them
    // it could also be a handcrafted token that is invalid

    // Extract timestamp (first 8 bytes)
    const timestamp = std.mem.readInt(u64, decoded[0..8], .big);

    // Check if token has expired
    const current_time = @as(u64, @bitCast(std.time.milliTimestamp()));
    // Extract expires_in (last 8 bytes)
    const expires_in = std.mem.readInt(u64, decoded[24..32], .big);
    {
        // respect the token's expiration time
        if (expires_in > 0) {
            // handle overflow for invalid expiry, which means bad token
            if (std.math.maxInt(u64) - timestamp < expires_in) {
                return false;
            }
            if (current_time > timestamp + expires_in) {
                return false;
            }
        }
    }
    {
        // repect options.max_age_ms
        const expiry = options.max_age_ms;
        if (expiry > 0) {
            // handle overflow for invalid expiry, which means bad token
            if (std.math.maxInt(u64) - timestamp < expiry) {
                return false;
            }
            if (current_time > timestamp + expiry) {
                return false;
            }
        }
    }
    // Extract the parts
    const payload = decoded[0..32]; // timestamp + nonce + expires_in
    const received_signature = decoded[32..];

    // Verify the signature
    var expected_signature: [boring.EVP_MAX_MD_SIZE]u8 = .{0} ** boring.EVP_MAX_MD_SIZE;
    const signature = hmac.generate(options.secret, payload, options.algorithm, &expected_signature) orelse
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

pub const csrf__generate = @import("../runtime/api/csrf_jsc.zig").csrf__generate;
pub const csrf__verify = @import("../runtime/api/csrf_jsc.zig").csrf__verify;

const hmac = @import("../sha_hmac/hmac.zig");
const std = @import("std");
const string = @import("../string/string.zig");

const bun = @import("bun");
const jsc = bun.jsc;
const boring = bun.BoringSSL.c;
