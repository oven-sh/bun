//! `Bun.CSRF.generate` / `Bun.CSRF.verify` host fns. The pure
//! `generate()`/`verify()` halves stay in `src/csrf/`.

use bun_boringssl_sys as boring;
use bun_core::zig_string::Slice as ZigStringSlice;
use bun_csrf as csrf;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, Local, Scope};

use crate::api::crypto::evp::Algorithm as EvpAlgorithm;
use crate::crypto::evp;
use crate::node::Encoding as NodeEncoding;

// `bun_jsc::comptime_string_map_jsc` only exposes the case-sensitive `from_js`;
// map keys are all lower-case ASCII, so lower the probe and do a direct lookup
// (mirrors PBKDF2.rs / CryptoHasher.rs).
fn algorithm_from_js_case_insensitive(
    global: &JSGlobalObject,
    input: JSValue,
) -> JsResult<Option<EvpAlgorithm>> {
    let slice = input.to_slice(global)?;
    Ok(evp::lookup_ignore_case(slice.slice()))
}

/// Validates an optional integer property in `[0, MAX_SAFE_INTEGER]`.
/// Differs from `JSValue::get_optional_int::<u64>` in rejecting NaN and in
/// the error message wording expected by existing tests.
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
#[bun_jsc::host_fn(scoped)]
pub(crate) fn csrf__generate<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    let global = scope.unscoped_global();
    bun_analytics::features::csrf_generate.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

    // We should have at least one argument (secret)
    let args = frame.arguments();
    let mut secret: Option<ZigStringSlice> = None;
    if args.len() >= 1 {
        let js_secret = args[0];
        // Extract the secret (required)
        if js_secret.is_empty_or_undefined_or_null() {
            return Err(scope.throw_invalid_arguments(format_args!("Secret is required")));
        }
        if !js_secret.is_string() || js_secret.get_length(global)? == 0 {
            return Err(
                scope.throw_invalid_arguments(format_args!("Secret must be a non-empty string"))
            );
        }
        secret = Some(js_secret.to_slice(global)?);
    }
    // Default values
    let mut expires_in: u64 = csrf::DEFAULT_EXPIRATION_MS;
    let mut encoding: csrf::TokenFormat = csrf::TokenFormat::Base64Url;
    let mut algorithm: EvpAlgorithm = csrf::DEFAULT_ALGORITHM;
    let mut session_id: Option<ZigStringSlice> = None;

    // Check if we have options object
    if args.len() > 1 && args[1].is_object() {
        let options_value = args[1];

        // Extract expiresIn (optional)
        if let Some(expires_in_js) = get_optional_int_u64(options_value, global, "expiresIn")? {
            expires_in = expires_in_js;
        }

        // Extract sessionId (optional)
        if let Some(session_id_slice) = options_value.get_optional_slice(global, b"sessionId")? {
            if session_id_slice.slice().is_empty() {
                return Err(scope.throw_invalid_arguments(format_args!(
                    "sessionId must be a non-empty string"
                )));
            }
            session_id = Some(session_id_slice);
        }

        // Extract encoding (optional)
        if let Some(encoding_js) = options_value.get(global, "encoding")? {
            let Some(encoding_enum) = NodeEncoding::from_js_with_default_on_empty(
                encoding_js,
                global,
                NodeEncoding::Base64url,
            )?
            else {
                return Err(scope.throw_invalid_arguments(format_args!(
                    "Invalid format: must be 'base64', 'base64url', or 'hex'"
                )));
            };
            encoding = match encoding_enum {
                NodeEncoding::Base64 => csrf::TokenFormat::Base64,
                NodeEncoding::Base64url => csrf::TokenFormat::Base64Url,
                NodeEncoding::Hex => csrf::TokenFormat::Hex,
                _ => {
                    return Err(scope.throw_invalid_arguments(format_args!(
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
                return Err(scope.throw_invalid_arguments(format_args!("Algorithm not supported")));
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
                        scope.throw_invalid_arguments(format_args!("Algorithm not supported"))
                    );
                }
            }
        }
    }

    // Buffer for token generation
    let mut token_buffer: [u8; 512] = [0u8; 512];

    // Generate the token
    let token_bytes = match csrf::generate(
        &csrf::GenerateOptions {
            secret: match &secret {
                Some(s) => s.slice(),
                // SAFETY: `bun_vm()` never returns null for a Bun-owned global; we are
                // on the JS thread so the VM singleton is exclusively reachable here.
                None => scope.bun_vm().as_mut().rare_data().default_csrf_secret(),
            },
            session_id: session_id.as_ref().map(|s| s.slice()).unwrap_or(b""),
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
                    scope.throw(format_args!("Failed to create CSRF token"))
                }
                _ => scope.throw(format_args!("{err} Failed to generate CSRF token")),
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
    let v = node_encoding.encode_with_max_size(
        global,
        boring::EVP_MAX_MD_SIZE as usize + 32,
        token_bytes,
    )?;
    Ok(scope.local(v))
}

/// JS binding function for verifying CSRF tokens
/// First argument is token (required), second is options (optional)
#[bun_jsc::host_fn(scoped)]
pub(crate) fn csrf__verify<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    let global = scope.unscoped_global();
    bun_analytics::features::csrf_verify.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
    // We should have at least one argument (token)
    let args = frame.arguments();
    if args.len() < 1 {
        return Err(scope.throw_invalid_arguments(format_args!("Missing required token parameter")));
    }
    let js_token: JSValue = args[0];
    // Extract the token (required)
    if js_token.is_undefined_or_null() {
        return Err(scope.throw_invalid_arguments(format_args!("Token is required")));
    }
    if !js_token.is_string() || js_token.get_length(global)? == 0 {
        return Err(scope.throw_invalid_arguments(format_args!("Token must be a non-empty string")));
    }
    let token = js_token.to_slice(global)?;

    // Default values
    let mut secret: Option<ZigStringSlice> = None;
    // `secret` is freed by Drop.
    let mut max_age: u64 = csrf::DEFAULT_EXPIRATION_MS;
    let mut encoding: csrf::TokenFormat = csrf::TokenFormat::Base64Url;
    let mut session_id: Option<ZigStringSlice> = None;

    let mut algorithm: EvpAlgorithm = csrf::DEFAULT_ALGORITHM;

    // Check if we have options object
    if args.len() > 1 && args[1].is_object() {
        let options_value = args[1];

        // Extract the secret (required)
        if let Some(secret_slice) = options_value.get_optional_slice(global, b"secret")? {
            if secret_slice.slice().is_empty() {
                return Err(scope
                    .throw_invalid_arguments(format_args!("Secret must be a non-empty string")));
            }
            secret = Some(secret_slice);
        }

        // Extract sessionId (optional)
        if let Some(session_id_slice) = options_value.get_optional_slice(global, b"sessionId")? {
            if session_id_slice.slice().is_empty() {
                return Err(scope.throw_invalid_arguments(format_args!(
                    "sessionId must be a non-empty string"
                )));
            }
            session_id = Some(session_id_slice);
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
                return Err(scope.throw_invalid_arguments(format_args!(
                    "Invalid format: must be 'base64', 'base64url', or 'hex'"
                )));
            };
            encoding = match encoding_enum {
                NodeEncoding::Base64 => csrf::TokenFormat::Base64,
                NodeEncoding::Base64url => csrf::TokenFormat::Base64Url,
                NodeEncoding::Hex => csrf::TokenFormat::Hex,
                _ => {
                    return Err(scope.throw_invalid_arguments(format_args!(
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
                return Err(scope.throw_invalid_arguments(format_args!("Algorithm not supported")));
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
                        scope.throw_invalid_arguments(format_args!("Algorithm not supported"))
                    );
                }
            }
        }
    }
    // Verify the token
    let is_valid = csrf::verify(&csrf::VerifyOptions {
        token: token.slice(),
        secret: match &secret {
            Some(s) => s.slice(),
            // SAFETY: `bun_vm()` never returns null for a Bun-owned global; we are
            // on the JS thread so the VM singleton is exclusively reachable here.
            None => scope.bun_vm().as_mut().rare_data().default_csrf_secret(),
        },
        session_id: session_id.as_ref().map(|s| s.slice()).unwrap_or(b""),
        max_age_ms: max_age,
        encoding,
        algorithm,
    });

    Ok(scope.boolean(is_valid))
}
