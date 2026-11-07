#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum OutKind {
    Stdout,
    Stderr,
}

// The user-facing stdio type from `crate::api::bun_spawn::stdio`, NOT the
// low-level `PosixStdio`/`WindowsStdio` spawn-option shape that the
// `bun_spawn` *crate* re-exports under the same name.
pub(crate) use crate::api::bun_spawn::stdio::Stdio;

/// Throws for a `Response` body a `<` redirect cannot take: stream, used, failed or S3-backed.
pub(crate) fn throw_if_body_unavailable(
    global: &crate::jsc::JSGlobalObject,
    body: &mut crate::webcore::body::Value,
) -> crate::jsc::JsResult<()> {
    use crate::jsc::ErrorCode;
    use crate::webcore::body::Value;

    if matches!(body, Value::Locked(_)) {
        body.to_blob_if_possible();
    }
    let already_used = || {
        global
            .err(
                ErrorCode::BODY_ALREADY_USED,
                format_args!("Body already used"),
            )
            .throw()
    };
    match body {
        Value::Locked(locked) => {
            let stream = locked.readable.get();
            // A read is in flight (`.text()`, `Bun.write`), or the stream gave out bytes.
            if !locked.action.is_none()
                || locked.promise.is_some()
                || locked.on_receive_value.is_some()
                || stream.is_some_and(|stream| stream.is_disturbed(global))
            {
                return Err(already_used());
            }
            if stream.is_some_and(|stream| stream.is_locked(global)) {
                return Err(global
                    .err(
                        ErrorCode::INVALID_STATE_TypeError,
                        format_args!("Invalid state: ReadableStream is locked"),
                    )
                    .throw());
            }
            Err(global.throw(format_args!(
                "A Response with a ReadableStream body is not supported as a shell redirect yet. Buffer it first, e.g. `< ${{await response.blob()}}`, or use Bun.spawn({{ stdin: response }})"
            )))
        }
        Value::Used => Err(already_used()),
        Value::Error(err) => Err(global.throw_value(err.to_js(global))),
        Value::Blob(blob) if blob.is_s3() => Err(global.throw(format_args!(
            "A Response with an S3-backed body is not supported as a shell redirect yet. To redirect from it, pass its bytes: `< ${{await response.bytes()}}`"
        ))),
        Value::Blob(_)
        | Value::WTFStringImpl(_)
        | Value::InternalBlob(_)
        | Value::Empty
        | Value::Null => Ok(()),
    }
}
