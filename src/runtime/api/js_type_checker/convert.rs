//! Native snapshot data -> JS conversion for `Bun.TypeChecker`.

use bun_jsc::bindgen::{JsHeap, JsLocal, Result as BindgenResult};
use bun_jsc::JSValue;
use bun_type_checker::{AdapterError, ChainData, DiagnosticData, Location};

pub(crate) fn adapter_error_value(error: &AdapterError, global: &bun_jsc::JSGlobalObject) -> JSValue {
    match error {
        AdapterError::Incomplete(path) => bun_jsc::ErrorCode::BUN_TYPE_CHECKER_INCOMPLETE.fmt(
            global,
            format_args!(
                "Bun.TypeChecker: the check did not complete for '{}'",
                bstr::BStr::new(path)
            ),
        ),
        AdapterError::ReadFailed(path) => bun_jsc::ErrorCode::BUN_TYPE_CHECKER_READ_FAILED.fmt(
            global,
            format_args!(
                "Bun.TypeChecker: could not read '{}'",
                bstr::BStr::new(path)
            ),
        ),
    }
}

// ── JS materialization ────────────────────────────────────────────────────

/// `fileName` when there is one, then `pos` and `end`, which are `0` without a source range, and the line and column
/// fields only with one.
fn put_location(
    global: &bun_jsc::JSGlobalObject,
    obj: JSValue,
    location: &Location,
) -> bun_jsc::JsResult<()> {
    if let Some(file_name) = &location.file_name {
        obj.put(
            global,
            b"fileName",
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, file_name)?,
        );
    }
    let pos = location.pos.unwrap_or(0);
    obj.put(global, b"pos", JSValue::js_number(pos as f64));
    obj.put(
        global,
        b"end",
        JSValue::js_number(location.end.unwrap_or(pos) as f64),
    );
    if location.pos.is_some() {
        obj.put(
            global,
            b"line",
            JSValue::js_number(location.line.unwrap_or(0) as f64),
        );
        obj.put(
            global,
            b"column",
            JSValue::js_number(location.column.unwrap_or(0) as f64),
        );
        obj.put(
            global,
            b"endLine",
            JSValue::js_number(location.end_line.unwrap_or(0) as f64),
        );
        obj.put(
            global,
            b"endColumn",
            JSValue::js_number(location.end_column.unwrap_or(0) as f64),
        );
    }
    Ok(())
}

fn chain_to_js<'a>(heap: &JsHeap<'a>, chain: &ChainData) -> BindgenResult<'a, JsLocal<'a>> {
    // SAFETY: `heap` belongs to this call; allocating runs no JavaScript.
    let global = unsafe { heap.global() };
    let obj = JSValue::create_empty_object(global, 11);
    put_location(global, obj, &chain.location)?;
    obj.put(global, b"code", JSValue::js_number(chain.code as f64));
    obj.put(
        global,
        b"category",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, chain.category.as_bytes())?,
    );
    obj.put(
        global,
        b"text",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, &chain.text)?,
    );
    if !chain.message_chain.is_empty() {
        let arr = JSValue::create_empty_array(global, chain.message_chain.len())?;
        for (i, child) in chain.message_chain.iter().enumerate() {
            arr.put_index(global, i as u32, chain_to_js(heap, child)?.to_js())?;
        }
        obj.put(global, b"messageChain", arr);
    }
    Ok(JsLocal::new(heap, obj))
}

pub(crate) fn diagnostic_to_js<'a>(
    heap: &JsHeap<'a>,
    diagnostic: &DiagnosticData,
) -> BindgenResult<'a, JsLocal<'a>> {
    // SAFETY: as above.
    let global = unsafe { heap.global() };
    let obj = JSValue::create_empty_object(global, 11);
    put_location(global, obj, &diagnostic.location)?;
    obj.put(global, b"code", JSValue::js_number(diagnostic.code as f64));
    obj.put(
        global,
        b"category",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, diagnostic.category.as_bytes())?,
    );
    obj.put(
        global,
        b"text",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, &diagnostic.text)?,
    );
    if !diagnostic.message_chain.is_empty() {
        let arr = JSValue::create_empty_array(global, diagnostic.message_chain.len())?;
        for (i, child) in diagnostic.message_chain.iter().enumerate() {
            arr.put_index(global, i as u32, chain_to_js(heap, child)?.to_js())?;
        }
        obj.put(global, b"messageChain", arr);
    }
    if !diagnostic.related.is_empty() {
        let arr = JSValue::create_empty_array(global, diagnostic.related.len())?;
        for (i, child) in diagnostic.related.iter().enumerate() {
            arr.put_index(global, i as u32, diagnostic_to_js(heap, child)?.to_js())?;
        }
        obj.put(global, b"relatedInformation", arr);
    }
    Ok(JsLocal::new(heap, obj))
}
