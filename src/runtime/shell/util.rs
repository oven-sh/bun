#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum OutKind {
    Stdout,
    Stderr,
}

// The user-facing stdio type from `crate::api::bun_spawn::stdio`, NOT the
// low-level `PosixStdio`/`WindowsStdio` spawn-option shape that the
// `bun_spawn` *crate* re-exports under the same name.
pub use crate::api::bun_spawn::stdio::Stdio;

/// Reject a Request/Response body that cannot be used as a shell redirect.
///
/// Called after `from_request_or_response`; runs `to_blob_if_possible()` so a
/// native-backed stream (Bun.file, Blob.stream()) is converted first. After
/// that, `Locked` (a JS-driven ReadableStream), `Used` and `Error` all have no
/// synchronous bytes to hand to the command, and `use_as_any_blob()` / `use_()`
/// would substitute an empty `Blob` for each of them, so the command would run
/// on zero bytes and succeed. The stdin hint is only appended for a stdin
/// redirect; a stream body can never be a write target, so stdout/stderr gets
/// the bare sentence.
pub fn check_body_for_redirect(
    body: &mut crate::webcore::body::Value,
    global: &crate::jsc::JSGlobalObject,
    stdin: bool,
) -> crate::jsc::JsResult<()> {
    body.to_blob_if_possible();
    match body {
        crate::webcore::body::Value::Locked(_) => {
            Err(global.throw_invalid_arguments(format_args!(
                "Request/Response body is a ReadableStream, which cannot be redirected in \
                 Bun Shell yet{}",
                if stdin {
                    ". Read it first: $`cmd < ${await response.bytes()}`"
                } else {
                    ""
                }
            )))
        }
        crate::webcore::body::Value::Used => Err(global
            .err(
                crate::jsc::ErrorCode::BODY_ALREADY_USED,
                format_args!("Body already used"),
            )
            .throw()),
        // Reached via fetch()-driven bodies whose transport failed
        // (Body::to_error_instance), not via user-constructed `new Response()`.
        crate::webcore::body::Value::Error(err) => Err(global.throw_value(err.to_js(global))),
        _ => Ok(()),
    }
}
