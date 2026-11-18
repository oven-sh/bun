//! For the engine.

use bun_jsc::JSGlobalObject;
use bun_web::exec;

use super::*;

/// What `WebAssembly.compileStreaming()` reads.
#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__streamOfModule(realm: &JSGlobalObject, response: JSValue) -> JSValue {
    exec::with_realm(realm, |cx| {
        let response = JsLocal::new(&cx.heap, response);
        bun_jsc::HostReturn::or_pending_exception(
            stream_of_module(cx, response).map_err(|it| it.into_js_error(realm)),
        )
    })
}

fn stream_of_module<'a>(cx: Cx<'_, 'a>, response: JsLocal<'a>) -> Result<'a, JSValue> {
    let response = Response::from_js(&cx.heap, response.to_js())
        .ok_or_else(|| type_error(&cx.heap, "The argument has to be a Response."))?;
    if !response
        .headers
        .list()
        .get_or_empty(b"content-type")
        .eq_ignore_ascii_case(b"application/wasm")
    {
        return Err(type_error(
            &cx.heap,
            "Incorrect response MIME type. Expected 'application/wasm'.",
        ));
    }
    if !response.get_ok() {
        return Err(type_error(&cx.heap, "The response is not ok."));
    }
    response.check_usable(&cx.heap)?;
    Ok(response.stream(cx)?.unwrap_or(JSValue::NULL))
}
