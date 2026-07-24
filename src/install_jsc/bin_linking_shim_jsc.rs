//! JSC bridge for `bun_install::windows_shim::Shebang` testing APIs.
//!
//! The Windows bin-shim shebang parser only runs on Windows at install time,
//! so this binding lets `bun:internal-for-testing` exercise `Shebang::parse`
//! directly on any platform.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc};

pub fn js_parse_shebang(go: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    use bun_core::String as BunString;
    use bun_install::windows_shim::Shebang;

    let contents_value = callframe.argument(0);
    if !contents_value.is_string() {
        return Err(go.throw(format_args!(
            "parseShebang: first argument (contents) must be a string"
        )));
    }
    let bin_path_value = callframe.argument(1);
    if !bin_path_value.is_string() {
        return Err(go.throw(format_args!(
            "parseShebang: second argument (binPath) must be a string"
        )));
    }

    let contents = contents_value.to_slice(go)?;
    let bin_path_slice = bin_path_value.to_slice(go)?;
    let bin_path: Vec<u16> = core::str::from_utf8(bin_path_slice.slice())
        .unwrap_or("")
        .encode_utf16()
        .collect();

    match Shebang::parse(contents.slice(), &bin_path) {
        Ok(None) => Ok(JSValue::NULL),
        Ok(Some(shebang)) => {
            let obj = JSValue::create_empty_object(go, 2);
            obj.put(
                go,
                b"launcher",
                BunString::from_bytes(shebang.launcher).to_js(go)?,
            );
            obj.put(
                go,
                b"isNodeOrBun",
                JSValue::js_boolean(shebang.is_node_or_bun),
            );
            Ok(obj)
        }
        Err(err) => Err(go.throw(format_args!("parseShebang failed: {err:?}"))),
    }
}
