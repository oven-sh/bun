#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum OutKind {
    Stdout,
    Stderr,
}

// The user-facing stdio type from `crate::api::bun_spawn::stdio`, NOT the
// low-level `PosixStdio`/`WindowsStdio` spawn-option shape that the
// `bun_spawn` *crate* re-exports under the same name.
pub(crate) use crate::api::bun_spawn::stdio::Stdio;

/// A `< ${response}` redirect takes the whole body when the command starts, so
/// the bytes have to be in memory by then. For a body that is not,
/// `use_as_any_blob()` and `use_()` hand back an empty `Blob`, and the command
/// reads zero bytes and exits 0. Throws for such a body and leaves it unread.
pub(crate) fn throw_if_body_not_in_memory(
    global: &crate::jsc::JSGlobalObject,
    body: &mut crate::webcore::body::Value,
) -> crate::jsc::JsResult<()> {
    use crate::webcore::body::Value;

    body.to_blob_if_possible();
    match body {
        Value::Locked(locked) if locked.action.is_none() && !locked.is_disturbed2(global) => {
            Err(global.throw(format_args!(
                "A Response with a ReadableStream body is not supported as a shell redirect yet. Buffer it first, e.g. `< ${{await response.blob()}}`, or use Bun.spawn({{ stdin: response }})"
            )))
        }
        Value::Locked(_) | Value::Used => Err(global
            .err(
                crate::jsc::ErrorCode::BODY_ALREADY_USED,
                format_args!("Body already used"),
            )
            .throw()),
        Value::Error(err) => Err(global.throw_value(err.to_js(global))),
        Value::Blob(_)
        | Value::WTFStringImpl(_)
        | Value::InternalBlob(_)
        | Value::Empty
        | Value::Null => Ok(()),
    }
}
