//! `Bun.CSRF`: `csrf_jsc.bind.ts`. The pure `generate()`/`verify()` halves stay in `src/csrf/`.

use bun_boringssl_sys as boring;
use bun_csrf as csrf;
use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;

use crate::api::crypto::evp::Algorithm as EvpAlgorithm;
use crate::crypto::evp;
use crate::generated_bindgen::csrf_jsc::{CSRFGenerateOptions, CSRFVerifyOptions};
use crate::node::Encoding as NodeEncoding;

fn non_empty<'a>(
    heap: &JsHeap<'a>,
    value: Option<&'a [u8]>,
    message: &str,
) -> bindgen::Result<'a, Option<&'a [u8]>> {
    match value {
        Some([]) => Err(heap.invalid_arguments(format_args!("{message}"))),
        value => Ok(value),
    }
}

/// Parsed as a Buffer encoding name ("" selects base64url), of which only the three token formats are accepted.
fn token_format<'a>(
    heap: &JsHeap<'a>,
    encoding: Option<&[u8]>,
) -> bindgen::Result<'a, csrf::TokenFormat> {
    match encoding {
        None | Some([]) => Ok(csrf::TokenFormat::Base64Url),
        Some(name) => match NodeEncoding::from(name) {
            Some(NodeEncoding::Base64) => Ok(csrf::TokenFormat::Base64),
            Some(NodeEncoding::Base64url) => Ok(csrf::TokenFormat::Base64Url),
            Some(NodeEncoding::Hex) => Ok(csrf::TokenFormat::Hex),
            _ => Err(heap.invalid_arguments(format_args!(
                "Invalid format: must be 'base64', 'base64url', or 'hex'"
            ))),
        },
    }
}

fn algorithm<'a>(heap: &JsHeap<'a>, name: Option<&[u8]>) -> bindgen::Result<'a, EvpAlgorithm> {
    let Some(name) = name else {
        return Ok(csrf::DEFAULT_ALGORITHM);
    };
    match evp::lookup_ignore_case(name) {
        Some(
            algorithm @ (EvpAlgorithm::Blake2b256
            | EvpAlgorithm::Blake2b512
            | EvpAlgorithm::Sha256
            | EvpAlgorithm::Sha384
            | EvpAlgorithm::Sha512
            | EvpAlgorithm::Sha512_256),
        ) => Ok(algorithm),
        _ => Err(heap.invalid_arguments(format_args!("Algorithm not supported"))),
    }
}

fn default_secret<'a>() -> &'a [u8] {
    VirtualMachine::get()
        .as_mut()
        .rare_data()
        .default_csrf_secret()
}

pub(crate) fn generate<'a>(
    cx: &mut JsScope<'a>,
    secret: Option<&'a [u8]>,
    options: &CSRFGenerateOptions<'a>,
) -> bindgen::Result<'a, JSValue> {
    bun_analytics::features::csrf_generate.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

    let heap = &cx.heap;
    let secret = non_empty(heap, secret, "Secret must be a non-empty string")?;
    let session_id = non_empty(
        heap,
        options.session_id,
        "sessionId must be a non-empty string",
    )?;
    let encoding = token_format(heap, options.encoding)?;
    let algorithm = algorithm(heap, options.algorithm)?;

    let mut token_buffer: [u8; 512] = [0u8; 512];
    let token_bytes = match csrf::generate(
        &csrf::GenerateOptions {
            secret: secret.unwrap_or_else(default_secret),
            session_id: session_id.unwrap_or_default(),
            expires_in_ms: options.expires_in,
            algorithm,
        },
        &mut token_buffer,
    ) {
        Ok(v) => v,
        Err(csrf::Error::TokenCreationFailed) => {
            return Err(heap.error(format_args!("Failed to create CSRF token")));
        }
    };

    // `bun_csrf` sits below `crate::node::Encoding` (which owns `encode_with_max_size`), so `TokenFormat` is mapped
    // back to it here.
    let node_encoding = match encoding {
        csrf::TokenFormat::Base64 => NodeEncoding::Base64,
        csrf::TokenFormat::Base64Url => NodeEncoding::Base64url,
        csrf::TokenFormat::Hex => NodeEncoding::Hex,
    };
    Ok(node_encoding.encode_with_max_size(
        cx.global(),
        boring::EVP_MAX_MD_SIZE as usize + 32,
        token_bytes,
    )?)
}

pub(crate) fn verify<'a>(
    heap: &JsHeap<'a>,
    token: &'a [u8],
    options: &CSRFVerifyOptions<'a>,
) -> bindgen::Result<'a, bool> {
    bun_analytics::features::csrf_verify.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

    if token.is_empty() {
        return Err(heap.invalid_arguments(format_args!("Token must be a non-empty string")));
    }
    let secret = non_empty(heap, options.secret, "Secret must be a non-empty string")?;
    let session_id = non_empty(
        heap,
        options.session_id,
        "sessionId must be a non-empty string",
    )?;

    Ok(csrf::verify(&csrf::VerifyOptions {
        token,
        secret: secret.unwrap_or_else(default_secret),
        session_id: session_id.unwrap_or_default(),
        max_age_ms: options.max_age,
        encoding: token_format(heap, options.encoding)?,
        algorithm: algorithm(heap, options.algorithm)?,
    }))
}
