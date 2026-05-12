//! `Bun.CSRF.generate` / `Bun.CSRF.verify` host fns. The pure
//! `generate()`/`verify()` halves stay in `src/csrf/`.

use bun_boringssl_sys as boring;
use bun_core::zig_string::Slice as ZigStringSlice;
use bun_csrf as csrf;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::api::crypto::evp::Algorithm as EvpAlgorithm;
use crate::crypto::evp;
use crate::node::Encoding as NodeEncoding;

// ── local shims ──────────────────────────────────────────────────────────
// `bun.ComptimeStringMap.fromJSCaseInsensitive` — the upstream
// `bun_jsc::comptime_string_map_jsc` only exposes the case-sensitive `from_js`;
// the case-insensitive variant is still cfg-gated. Map keys are all lower-case
// ASCII, so lower the probe and do a direct phf lookup (mirrors PBKDF2.rs).
fn algorithm_from_js_case_insensitive(
    global: &JSGlobalObject,
    input: JSValue,
) -> JsResult<Option<EvpAlgorithm>> {
    let slice = input.to_slice(global)?;
    Ok(evp::lookup_ignore_case(slice.slice()))
}

/// `JSValue.getOptional(_, _, ZigString.Slice)` — local shim until `bun_jsc`
/// grows a typed `get_optional`. Returns `None` for missing/null/undefined.
fn get_optional_slice(
    target: JSValue,
    global: &JSGlobalObject,
    property: &'static [u8],
) -> JsResult<Option<ZigStringSlice>> {
    match target.get(global, property)? {
        Some(v) if !v.is_undefined_or_null() => {
            if !v.is_string() {
                // SAFETY: `property` is a `&'static [u8]` literal supplied by
                // the call-site (`b"algorithm"` etc.) — always ASCII.
                let prop = unsafe { core::str::from_utf8_unchecked(property) };
                return Err(global.throw_invalid_argument_type_value(prop, "string", v));
            }
            Ok(Some(v.to_slice(global)?))
        }
        _ => Ok(None),
    }
}

/// `JSValue.getOptionalInt(_, _, u64)` — local shim. Spec (`JSValue.zig:1896`)
/// delegates to `validateIntegerRange` with `[0, MAX_SAFE_INTEGER]`; that
/// helper is defined on the cfg-gated `JSGlobalObject` impl, so inline the
/// minimal u64 path here.
fn get_optional_int_u64(
    target: JSValue,
    global: &JSGlobalObject,
    property: &'static str,
) -> JsResult<Option<u64>> {
    let Some(value) = target.get(global, property)? else {
        return Ok(None);
    };
    if value.is_undefined() || value.is_empty() {
        return Ok(Some(0));
    }
    if !value.is_number() {
        return Err(global.throw_invalid_argument_type_value(property, "number", value));
    }
    let num: f64 = value.as_number();
    const MAX_SAFE_INTEGER: f64 = 9007199254740991.0;
    if num.fract() != 0.0 || num < 0.0 || num > MAX_SAFE_INTEGER {
        return Err(global.throw_invalid_arguments(format_args!(
            "{property} must be an integer between 0 and {MAX_SAFE_INTEGER}"
        )));
    }
    Ok(Some(num as u64))
}

/// JS binding function for generating CSRF tokens
/// First argument is secret (required), second is options (optional)
#[bun_jsc::host_fn]
pub fn csrf__generate(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_analytics::features::csrf_generate.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

    // We should have at least one argument (secret)
    let args = frame.arguments();
    let mut secret: Option<ZigStringSlice> = None;
    if args.len() >= 1 {
        let js_secret = args[0];
        // Extract the secret (required)
        if js_secret.is_empty_or_undefined_or_null() {
            return Err(global.throw_invalid_arguments(format_args!("Secret is required")));
        }
        if !js_secret.is_string() || js_secret.get_length(global)? == 0 {
            return Err(
                global.throw_invalid_arguments(format_args!("Secret must be a non-empty string"))
            );
        }
        secret = Some(js_secret.to_slice(global)?);
    }
    // `defer if (secret) |s| s.deinit();` — handled by Drop on ZigStringSlice

    // Default values
    let mut expires_in: u64 = csrf::DEFAULT_EXPIRATION_MS;
    let mut encoding: csrf::TokenFormat = csrf::TokenFormat::Base64Url;
    let mut algorithm: EvpAlgorithm = csrf::DEFAULT_ALGORITHM;

    // Check if we have options object
    if args.len() > 1 && args[1].is_object() {
        let options_value = args[1];

        // Extract expiresIn (optional)
        if let Some(expires_in_js) = get_optional_int_u64(options_value, global, "expiresIn")? {
            expires_in = expires_in_js;
        }

        // Extract encoding (optional)
        if let Some(encoding_js) = options_value.get(global, "encoding")? {
            let Some(encoding_enum) = NodeEncoding::from_js_with_default_on_empty(
                encoding_js,
                global,
                NodeEncoding::Base64url,
            )?
            else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Invalid format: must be 'base64', 'base64url', or 'hex'"
                )));
            };
            encoding = match encoding_enum {
                NodeEncoding::Base64 => csrf::TokenFormat::Base64,
                NodeEncoding::Base64url => csrf::TokenFormat::Base64Url,
                NodeEncoding::Hex => csrf::TokenFormat::Hex,
                _ => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Invalid format: must be 'base64', 'base64url', or 'hex'"
                    )));
                }
            };
        }

        if let Some(algorithm_js) = options_value.get(global, "algorithm")? {
            if !algorithm_js.is_string() {
                return Err(global.throw_invalid_argument_type_value(
                    "algorithm",
                    "string",
                    algorithm_js,
                ));
            }
            let Some(algo) = algorithm_from_js_case_insensitive(global, algorithm_js)? else {
                return Err(global.throw_invalid_arguments(format_args!("Algorithm not supported")));
            };
            algorithm = algo;
            match algorithm {
                EvpAlgorithm::Blake2b256
                | EvpAlgorithm::Blake2b512
                | EvpAlgorithm::Sha256
                | EvpAlgorithm::Sha384
                | EvpAlgorithm::Sha512
                | EvpAlgorithm::Sha512_256 => {}
                _ => {
                    return Err(
                        global.throw_invalid_arguments(format_args!("Algorithm not supported"))
                    );
                }
            }
        }
    }

    // Buffer for token generation
    let mut token_buffer: [u8; 512] = [0u8; 512];

    // Generate the token
    let token_bytes = match csrf::generate(
        csrf::GenerateOptions {
            secret: match &secret {
                Some(s) => s.slice(),
                // SAFETY: `bun_vm()` never returns null for a Bun-owned global; we are
                // on the JS thread so the VM singleton is exclusively reachable here.
                None => global.bun_vm().as_mut().rare_data().default_csrf_secret(),
            },
            expires_in_ms: expires_in,
            encoding,
            algorithm,
        },
        &mut token_buffer,
    ) {
        Ok(v) => v,
        Err(err) => {
            return Err(match err {
                csrf::Error::TokenCreationFailed => {
                    global.throw(format_args!("Failed to create CSRF token"))
                }
                _ => global.throw_error(err.into(), "Failed to generate CSRF token"),
            });
        }
    };

    // Encode the token
    // `csrf::TokenFormat::to_node_encoding()` returns the cycle-broken
    // `bun_core::NodeEncoding`, not `crate::node::Encoding` (which owns
    // `encode_with_max_size`). Map locally to the runtime enum instead.
    let node_encoding = match encoding {
        csrf::TokenFormat::Base64 => NodeEncoding::Base64,
        csrf::TokenFormat::Base64Url => NodeEncoding::Base64url,
        csrf::TokenFormat::Hex => NodeEncoding::Hex,
    };
    node_encoding.encode_with_max_size(global, boring::EVP_MAX_MD_SIZE as usize + 32, token_bytes)
}

/// JS binding function for verifying CSRF tokens
/// First argument is token (required), second is options (optional)
#[bun_jsc::host_fn]
pub fn csrf__verify(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_analytics::features::csrf_verify.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
    // We should have at least one argument (token)
    let args = frame.arguments();
    if args.len() < 1 {
        return Err(
            global.throw_invalid_arguments(format_args!("Missing required token parameter"))
        );
    }
    let js_token: JSValue = args[0];
    // Extract the token (required)
    if js_token.is_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!("Token is required")));
    }
    if !js_token.is_string() || js_token.get_length(global)? == 0 {
        return Err(
            global.throw_invalid_arguments(format_args!("Token must be a non-empty string"))
        );
    }
    let token = js_token.to_slice(global)?;
    // `defer token.deinit();` — handled by Drop on ZigStringSlice

    // Default values
    let mut secret: Option<ZigStringSlice> = None;
    // `defer if (secret) |s| s.deinit();` — handled by Drop
    let mut max_age: u64 = csrf::DEFAULT_EXPIRATION_MS;
    let mut encoding: csrf::TokenFormat = csrf::TokenFormat::Base64Url;

    let mut algorithm: EvpAlgorithm = csrf::DEFAULT_ALGORITHM;

    // Check if we have options object
    if args.len() > 1 && args[1].is_object() {
        let options_value = args[1];

        // Extract the secret (required)
        if let Some(secret_slice) = get_optional_slice(options_value, global, b"secret")? {
            if secret_slice.slice().is_empty() {
                return Err(global
                    .throw_invalid_arguments(format_args!("Secret must be a non-empty string")));
            }
            secret = Some(secret_slice);
        }

        // Extract maxAge (optional)
        if let Some(max_age_js) = get_optional_int_u64(options_value, global, "maxAge")? {
            max_age = max_age_js;
        }

        // Extract encoding (optional)
        if let Some(encoding_js) = options_value.get(global, "encoding")? {
            let Some(encoding_enum) = NodeEncoding::from_js_with_default_on_empty(
                encoding_js,
                global,
                NodeEncoding::Base64url,
            )?
            else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Invalid format: must be 'base64', 'base64url', or 'hex'"
                )));
            };
            encoding = match encoding_enum {
                NodeEncoding::Base64 => csrf::TokenFormat::Base64,
                NodeEncoding::Base64url => csrf::TokenFormat::Base64Url,
                NodeEncoding::Hex => csrf::TokenFormat::Hex,
                _ => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Invalid format: must be 'base64', 'base64url', or 'hex'"
                    )));
                }
            };
        }
        if let Some(algorithm_js) = options_value.get(global, "algorithm")? {
            if !algorithm_js.is_string() {
                return Err(global.throw_invalid_argument_type_value(
                    "algorithm",
                    "string",
                    algorithm_js,
                ));
            }
            let Some(algo) = algorithm_from_js_case_insensitive(global, algorithm_js)? else {
                return Err(global.throw_invalid_arguments(format_args!("Algorithm not supported")));
            };
            algorithm = algo;
            match algorithm {
                EvpAlgorithm::Blake2b256
                | EvpAlgorithm::Blake2b512
                | EvpAlgorithm::Sha256
                | EvpAlgorithm::Sha384
                | EvpAlgorithm::Sha512
                | EvpAlgorithm::Sha512_256 => {}
                _ => {
                    return Err(
                        global.throw_invalid_arguments(format_args!("Algorithm not supported"))
                    );
                }
            }
        }
    }
    // Verify the token
    let is_valid = csrf::verify(csrf::VerifyOptions {
        token: token.slice(),
        secret: match &secret {
            Some(s) => s.slice(),
            // SAFETY: `bun_vm()` never returns null for a Bun-owned global; we are
            // on the JS thread so the VM singleton is exclusively reachable here.
            None => global.bun_vm().as_mut().rare_data().default_csrf_secret(),
        },
        max_age_ms: max_age,
        encoding,
        algorithm,
    });

    Ok(JSValue::from(is_valid))
}

// ported from: src/runtime/api/csrf_jsc.zig
