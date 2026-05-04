//! `Bun.CSRF.generate` / `Bun.CSRF.verify` host fns. The pure
//! `generate()`/`verify()` halves stay in `src/csrf/`.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_str::zig_string::Slice as ZigStringSlice;
use bun_boringssl_sys as boring;
use bun_csrf as csrf;

use crate::api::crypto::evp::Algorithm as EvpAlgorithm;
use crate::node::Encoding as NodeEncoding;

/// JS binding function for generating CSRF tokens
/// First argument is secret (required), second is options (optional)
#[bun_jsc::host_fn]
pub fn csrf__generate(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    if bun_analytics::Features::csrf_generate() < usize::MAX {
        bun_analytics::Features::csrf_generate_add(1);
    }

    // We should have at least one argument (secret)
    let args = frame.arguments();
    let mut secret: Option<ZigStringSlice> = None;
    if args.len() >= 1 {
        let js_secret = args[0];
        // Extract the secret (required)
        if js_secret.is_empty_or_undefined_or_null() {
            return global.throw_invalid_arguments(format_args!("Secret is required"));
        }
        if !js_secret.is_string() || js_secret.get_length(global)? == 0 {
            return global.throw_invalid_arguments(format_args!("Secret must be a non-empty string"));
        }
        secret = Some(js_secret.to_slice(global)?);
    }
    // `defer if (secret) |s| s.deinit();` — handled by Drop on ZigStringSlice

    // Default values
    let mut expires_in: u64 = csrf::DEFAULT_EXPIRATION_MS;
    let mut encoding: csrf::TokenFormat = csrf::TokenFormat::Base64url;
    let mut algorithm: EvpAlgorithm = csrf::DEFAULT_ALGORITHM;

    // Check if we have options object
    if args.len() > 1 && args[1].is_object() {
        let options_value = args[1];

        // Extract expiresIn (optional)
        if let Some(expires_in_js) = options_value.get_optional_int::<u64>(global, "expiresIn")? {
            expires_in = expires_in_js;
        }

        // Extract encoding (optional)
        if let Some(encoding_js) = options_value.get(global, "encoding")? {
            let Some(encoding_enum) =
                NodeEncoding::from_js_with_default_on_empty(encoding_js, global, NodeEncoding::Base64url)?
            else {
                return global.throw_invalid_arguments(format_args!(
                    "Invalid format: must be 'base64', 'base64url', or 'hex'"
                ));
            };
            encoding = match encoding_enum {
                NodeEncoding::Base64 => csrf::TokenFormat::Base64,
                NodeEncoding::Base64url => csrf::TokenFormat::Base64url,
                NodeEncoding::Hex => csrf::TokenFormat::Hex,
                _ => {
                    return global.throw_invalid_arguments(format_args!(
                        "Invalid format: must be 'base64', 'base64url', or 'hex'"
                    ));
                }
            };
        }

        if let Some(algorithm_js) = options_value.get(global, "algorithm")? {
            if !algorithm_js.is_string() {
                return global.throw_invalid_argument_type_value("algorithm", "string", algorithm_js);
            }
            let Some(algo) = EvpAlgorithm::map().from_js_case_insensitive(global, algorithm_js)? else {
                return global.throw_invalid_arguments(format_args!("Algorithm not supported"));
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
                    return global.throw_invalid_arguments(format_args!("Algorithm not supported"));
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
                None => global.bun_vm().rare_data().default_csrf_secret(),
            },
            expires_in_ms: expires_in,
            encoding,
            algorithm,
        },
        &mut token_buffer,
    ) {
        Ok(v) => v,
        Err(err) => {
            return match err {
                csrf::Error::TokenCreationFailed => {
                    global.throw(format_args!("Failed to create CSRF token"))
                }
                _ => global.throw_error(err, "Failed to generate CSRF token"),
            };
        }
    };

    // Encode the token
    encoding
        .to_node_encoding()
        .encode_with_max_size(global, boring::EVP_MAX_MD_SIZE + 32, token_bytes)
}

/// JS binding function for verifying CSRF tokens
/// First argument is token (required), second is options (optional)
#[bun_jsc::host_fn]
pub fn csrf__verify(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    if bun_analytics::Features::csrf_verify() < usize::MAX {
        bun_analytics::Features::csrf_verify_add(1);
    }
    // We should have at least one argument (token)
    let args = frame.arguments();
    if args.len() < 1 {
        return global.throw_invalid_arguments(format_args!("Missing required token parameter"));
    }
    let js_token: JSValue = args[0];
    // Extract the token (required)
    if js_token.is_undefined_or_null() {
        return global.throw_invalid_arguments(format_args!("Token is required"));
    }
    if !js_token.is_string() || js_token.get_length(global)? == 0 {
        return global.throw_invalid_arguments(format_args!("Token must be a non-empty string"));
    }
    let token = js_token.to_slice(global)?;
    // `defer token.deinit();` — handled by Drop on ZigStringSlice

    // Default values
    let mut secret: Option<ZigStringSlice> = None;
    // `defer if (secret) |s| s.deinit();` — handled by Drop
    let mut max_age: u64 = csrf::DEFAULT_EXPIRATION_MS;
    let mut encoding: csrf::TokenFormat = csrf::TokenFormat::Base64url;

    let mut algorithm: EvpAlgorithm = csrf::DEFAULT_ALGORITHM;

    // Check if we have options object
    if args.len() > 1 && args[1].is_object() {
        let options_value = args[1];

        // Extract the secret (required)
        if let Some(secret_slice) = options_value.get_optional::<ZigStringSlice>(global, "secret")? {
            if secret_slice.len() == 0 {
                return global.throw_invalid_arguments(format_args!("Secret must be a non-empty string"));
            }
            secret = Some(secret_slice);
        }

        // Extract maxAge (optional)
        if let Some(max_age_js) = options_value.get_optional_int::<u64>(global, "maxAge")? {
            max_age = max_age_js;
        }

        // Extract encoding (optional)
        if let Some(encoding_js) = options_value.get(global, "encoding")? {
            let Some(encoding_enum) =
                NodeEncoding::from_js_with_default_on_empty(encoding_js, global, NodeEncoding::Base64url)?
            else {
                return global.throw_invalid_arguments(format_args!(
                    "Invalid format: must be 'base64', 'base64url', or 'hex'"
                ));
            };
            encoding = match encoding_enum {
                NodeEncoding::Base64 => csrf::TokenFormat::Base64,
                NodeEncoding::Base64url => csrf::TokenFormat::Base64url,
                NodeEncoding::Hex => csrf::TokenFormat::Hex,
                _ => {
                    return global.throw_invalid_arguments(format_args!(
                        "Invalid format: must be 'base64', 'base64url', or 'hex'"
                    ));
                }
            };
        }
        if let Some(algorithm_js) = options_value.get(global, "algorithm")? {
            if !algorithm_js.is_string() {
                return global.throw_invalid_argument_type_value("algorithm", "string", algorithm_js);
            }
            let Some(algo) = EvpAlgorithm::map().from_js_case_insensitive(global, algorithm_js)? else {
                return global.throw_invalid_arguments(format_args!("Algorithm not supported"));
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
                    return global.throw_invalid_arguments(format_args!("Algorithm not supported"));
                }
            }
        }
    }
    // Verify the token
    let is_valid = csrf::verify(csrf::VerifyOptions {
        token: token.slice(),
        secret: match &secret {
            Some(s) => s.slice(),
            None => global.bun_vm().rare_data().default_csrf_secret(),
        },
        max_age_ms: max_age,
        encoding,
        algorithm,
    });

    Ok(JSValue::from(is_valid))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/csrf_jsc.zig (176 lines)
//   confidence: medium
//   todos:      0
//   notes:      analytics counter API, EvpAlgorithm/NodeEncoding paths, and csrf option-struct names are guessed; verify in Phase B
// ──────────────────────────────────────────────────────────────────────────
