use bun_jsc::{JSGlobalObject, JSValue};

/// End `span` for a query that failed with the JS error `err`
/// (`PostgresError`/`MySQLError`: `errno` is the SQLSTATE / server error
/// number, `code` the `ERR_*` name).
pub fn end_with_js_error(
    span: bun_telemetry::NativeSpan,
    statement: &[u8],
    global: &JSGlobalObject,
    err: JSValue,
) -> bun_jsc::JsResult<()> {
    let mut code: Option<Vec<u8>> = None;
    let mut message = None;
    if err.is_object() {
        for key in ["errno", "code"] {
            if let Some(c) = err.get(global, key)? {
                if c.is_string() {
                    code = Some(c.to_slice(global)?.slice().to_vec());
                } else if c.is_number() {
                    let mut buf = bun_core::fmt::ItoaBuf::new();
                    code = Some(bun_core::fmt::itoa(&mut buf, c.to_int32()).to_vec());
                }
            }
            if code.is_some() {
                break;
            }
        }
        if let Some(m) = err.get(global, "message")? {
            if m.is_string() {
                message = Some(m.to_slice(global)?);
            }
        }
    }
    bun_telemetry::db::end(
        span,
        statement,
        None,
        Some((
            code.as_deref().unwrap_or(b"_OTHER"),
            message.as_ref().map(|m| m.slice()).unwrap_or(b""),
        )),
    );
    Ok(())
}
