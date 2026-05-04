//! `Bun.CSRF.generate` / `Bun.CSRF.verify` host fns. The pure
//! `generate()`/`verify()` halves stay in `src/csrf/`.

/// JS binding function for generating CSRF tokens
/// First argument is secret (required), second is options (optional)
pub fn csrf__generate(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (bun.analytics.Features.csrf_generate < std.math.maxInt(usize))
        bun.analytics.Features.csrf_generate += 1;

    // We should have at least one argument (secret)
    const args = callframe.arguments();
    var secret: ?jsc.ZigString.Slice = null;
    if (args.len >= 1) {
        const jsSecret = args[0];
        // Extract the secret (required)
        if (jsSecret.isEmptyOrUndefinedOrNull()) {
            return globalObject.throwInvalidArguments("Secret is required", .{});
        }
        if (!jsSecret.isString() or try jsSecret.getLength(globalObject) == 0) {
            return globalObject.throwInvalidArguments("Secret must be a non-empty string", .{});
        }
        secret = try jsSecret.toSlice(globalObject, bun.default_allocator);
    }
    defer if (secret) |s| s.deinit();

    // Default values
    var expires_in: u64 = csrf.DEFAULT_EXPIRATION_MS;
    var encoding: csrf.TokenFormat = .base64url;
    var algorithm: jsc.API.Bun.Crypto.EVP.Algorithm = csrf.DEFAULT_ALGORITHM;

    // Check if we have options object
    if (args.len > 1 and args[1].isObject()) {
        const options_value = args[1];

        // Extract expiresIn (optional)
        if (try options_value.getOptionalInt(globalObject, "expiresIn", u64)) |expires_in_js| {
            expires_in = expires_in_js;
        }

        // Extract encoding (optional)
        if (try options_value.get(globalObject, "encoding")) |encoding_js| {
            const encoding_enum = try jsc.Node.Encoding.fromJSWithDefaultOnEmpty(encoding_js, globalObject, .base64url) orelse {
                return globalObject.throwInvalidArguments("Invalid format: must be 'base64', 'base64url', or 'hex'", .{});
            };
            encoding = switch (encoding_enum) {
                .base64 => .base64,
                .base64url => .base64url,
                .hex => .hex,
                else => return globalObject.throwInvalidArguments("Invalid format: must be 'base64', 'base64url', or 'hex'", .{}),
            };
        }

        if (try options_value.get(globalObject, "algorithm")) |algorithm_js| {
            if (!algorithm_js.isString()) {
                return globalObject.throwInvalidArgumentTypeValue("algorithm", "string", algorithm_js);
            }
            algorithm = try jsc.API.Bun.Crypto.EVP.Algorithm.map.fromJSCaseInsensitive(globalObject, algorithm_js) orelse {
                return globalObject.throwInvalidArguments("Algorithm not supported", .{});
            };
            switch (algorithm) {
                .blake2b256, .blake2b512, .sha256, .sha384, .sha512, .@"sha512-256" => {},
                else => return globalObject.throwInvalidArguments("Algorithm not supported", .{}),
            }
        }
    }

    // Buffer for token generation
    var token_buffer: [512]u8 = .{0} ** 512;

    // Generate the token
    const token_bytes = csrf.generate(.{
        .secret = if (secret) |s| s.slice() else globalObject.bunVM().rareData().defaultCSRFSecret(),
        .expires_in_ms = expires_in,
        .encoding = encoding,
        .algorithm = algorithm,
    }, &token_buffer) catch |err| {
        return switch (err) {
            csrf.Error.TokenCreationFailed => globalObject.throw("Failed to create CSRF token", .{}),
            else => globalObject.throwError(err, "Failed to generate CSRF token"),
        };
    };

    // Encode the token
    return encoding.toNodeEncoding().encodeWithMaxSize(globalObject, boring.EVP_MAX_MD_SIZE + 32, token_bytes);
}

/// JS binding function for verifying CSRF tokens
/// First argument is token (required), second is options (optional)
pub fn csrf__verify(globalObject: *jsc.JSGlobalObject, call_frame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (bun.analytics.Features.csrf_verify < std.math.maxInt(usize)) {
        bun.analytics.Features.csrf_verify += 1;
    }
    // We should have at least one argument (token)
    const args = call_frame.arguments();
    if (args.len < 1) {
        return globalObject.throwInvalidArguments("Missing required token parameter", .{});
    }
    const jsToken: jsc.JSValue = args[0];
    // Extract the token (required)
    if (jsToken.isUndefinedOrNull()) {
        return globalObject.throwInvalidArguments("Token is required", .{});
    }
    if (!jsToken.isString() or try jsToken.getLength(globalObject) == 0) {
        return globalObject.throwInvalidArguments("Token must be a non-empty string", .{});
    }
    const token = try jsToken.toSlice(globalObject, bun.default_allocator);
    defer token.deinit();

    // Default values
    var secret: ?jsc.ZigString.Slice = null;
    defer if (secret) |s| s.deinit();
    var max_age: u64 = csrf.DEFAULT_EXPIRATION_MS;
    var encoding: csrf.TokenFormat = .base64url;

    var algorithm: jsc.API.Bun.Crypto.EVP.Algorithm = csrf.DEFAULT_ALGORITHM;

    // Check if we have options object
    if (args.len > 1 and args[1].isObject()) {
        const options_value = args[1];

        // Extract the secret (required)
        if (try options_value.getOptional(globalObject, "secret", jsc.ZigString.Slice)) |secretSlice| {
            if (secretSlice.len == 0) {
                return globalObject.throwInvalidArguments("Secret must be a non-empty string", .{});
            }
            secret = secretSlice;
        }

        // Extract maxAge (optional)
        if (try options_value.getOptionalInt(globalObject, "maxAge", u64)) |max_age_js| {
            max_age = max_age_js;
        }

        // Extract encoding (optional)
        if (try options_value.get(globalObject, "encoding")) |encoding_js| {
            const encoding_enum = try jsc.Node.Encoding.fromJSWithDefaultOnEmpty(encoding_js, globalObject, .base64url) orelse {
                return globalObject.throwInvalidArguments("Invalid format: must be 'base64', 'base64url', or 'hex'", .{});
            };
            encoding = switch (encoding_enum) {
                .base64 => .base64,
                .base64url => .base64url,
                .hex => .hex,
                else => return globalObject.throwInvalidArguments("Invalid format: must be 'base64', 'base64url', or 'hex'", .{}),
            };
        }
        if (try options_value.get(globalObject, "algorithm")) |algorithm_js| {
            if (!algorithm_js.isString()) {
                return globalObject.throwInvalidArgumentTypeValue("algorithm", "string", algorithm_js);
            }
            algorithm = try jsc.API.Bun.Crypto.EVP.Algorithm.map.fromJSCaseInsensitive(globalObject, algorithm_js) orelse {
                return globalObject.throwInvalidArguments("Algorithm not supported", .{});
            };
            switch (algorithm) {
                .blake2b256, .blake2b512, .sha256, .sha384, .sha512, .@"sha512-256" => {},
                else => return globalObject.throwInvalidArguments("Algorithm not supported", .{}),
            }
        }
    }
    // Verify the token
    const is_valid = csrf.verify(.{
        .token = token.slice(),
        .secret = if (secret) |s| s.slice() else globalObject.bunVM().rareData().defaultCSRFSecret(),
        .max_age_ms = max_age,
        .encoding = encoding,
        .algorithm = algorithm,
    });

    return jsc.JSValue.jsBoolean(is_valid);
}

const csrf = @import("../../csrf/csrf.zig");
const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const boring = bun.BoringSSL.c;
