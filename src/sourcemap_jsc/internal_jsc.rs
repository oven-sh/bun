//! JS testing bindings for `InternalSourceMap`. Keeps `src/sourcemap/` free of JSC types.

use bun_jsc::{ArrayBuffer, CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_sourcemap::InternalSourceMap;
use bun_str::{MutableString, ZigString};

pub struct TestingAPIs;

impl TestingAPIs {
    #[bun_jsc::host_fn]
    pub fn from_vlq(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let vlq_str = frame.argument(0).to_bun_string(global)?;
        let vlq = vlq_str.to_utf8();

        let Ok(blob) = InternalSourceMap::from_vlq(vlq.slice(), 0) else {
            return global.throw(format_args!("InternalSourceMap.fromVLQ: invalid VLQ input"));
        };
        Ok(ArrayBuffer::create_uint8_array(global, &blob))
    }

    #[bun_jsc::host_fn]
    pub fn to_vlq(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let Some(ab) = frame.argument(0).as_array_buffer(global) else {
            return global.throw(format_args!("InternalSourceMap.toVLQ: expected Uint8Array"));
        };
        let bytes = ab.byte_slice();
        if !InternalSourceMap::is_valid_blob(bytes) {
            return global.throw(format_args!("InternalSourceMap.toVLQ: invalid blob"));
        }
        let ism = InternalSourceMap { data: bytes.as_ptr() };
        let mut out = MutableString::init_empty();
        ism.append_vlq_to(&mut out);
        bun_str::String::create_utf8_for_js(global, out.list.as_slice())
    }

    #[bun_jsc::host_fn]
    pub fn find(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let Some(ab) = frame.argument(0).as_array_buffer(global) else {
            return global.throw(format_args!("InternalSourceMap.find: expected Uint8Array"));
        };
        let bytes = ab.byte_slice();
        if !InternalSourceMap::is_valid_blob(bytes) {
            return global.throw(format_args!("InternalSourceMap.find: invalid blob"));
        }
        let line = frame.argument(1).to_int32();
        let col = frame.argument(2).to_int32();
        if line < 0 || col < 0 {
            return Ok(JSValue::NULL);
        }
        let ism = InternalSourceMap { data: bytes.as_ptr() };
        // TODO(port): decl-literal arg types — confirm Line/Column newtype names in bun_sourcemap
        let Some(mapping) = ism.find(
            bun_sourcemap::Line::from_zero_based(line),
            bun_sourcemap::Column::from_zero_based(col),
        ) else {
            return Ok(JSValue::NULL);
        };

        let obj = JSValue::create_empty_object(global, 5);
        obj.put(global, ZigString::static_(b"generatedLine"), JSValue::js_number(mapping.generated.lines.zero_based()));
        obj.put(global, ZigString::static_(b"generatedColumn"), JSValue::js_number(mapping.generated.columns.zero_based()));
        obj.put(global, ZigString::static_(b"originalLine"), JSValue::js_number(mapping.original.lines.zero_based()));
        obj.put(global, ZigString::static_(b"originalColumn"), JSValue::js_number(mapping.original.columns.zero_based()));
        obj.put(global, ZigString::static_(b"sourceIndex"), JSValue::js_number(mapping.source_index));
        Ok(obj)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sourcemap_jsc/internal_jsc.zig (59 lines)
//   confidence: medium
//   todos:      1
//   notes:      Line/Column newtype names guessed; create_utf8_for_js may live on StringJsc ext trait
// ──────────────────────────────────────────────────────────────────────────
