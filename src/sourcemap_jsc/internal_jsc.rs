//! JS testing bindings for `InternalSourceMap`. Keeps `src/sourcemap/` free of JSC types.

use bun_core::MutableString;
use bun_jsc::{ArrayBuffer, CallFrame, JSGlobalObject, JSValue, JsResult, bun_string_jsc};
use bun_sourcemap::Ordinal;
use bun_sourcemap::internal_source_map::{self, InternalSourceMap};

pub(crate) struct TestingAPIs;

impl TestingAPIs {
    pub(crate) fn from_vlq(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let vlq_str = bun_core::OwnedString::new(frame.argument(0).to_bun_string(global)?);
        let vlq = vlq_str.to_utf8();

        let Ok(blob) = internal_source_map::from_vlq(vlq.slice(), 0) else {
            return Err(global.throw(format_args!("InternalSourceMap.fromVLQ: invalid VLQ input")));
        };
        ArrayBuffer::create_uint8_array(global, &blob)
    }

    pub(crate) fn to_vlq(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let Some(ab) = frame.argument(0).as_array_buffer(global) else {
            return Err(global.throw(format_args!("InternalSourceMap.toVLQ: expected Uint8Array")));
        };
        let bytes = ab.byte_slice();
        if !internal_source_map::is_valid_blob(bytes) {
            return Err(global.throw(format_args!("InternalSourceMap.toVLQ: invalid blob")));
        }
        let ism = InternalSourceMap {
            data: bytes.as_ptr(),
        };
        let mut out = MutableString::init_empty();
        ism.append_vlq_to(&mut out);
        bun_string_jsc::create_utf8_for_js(global, out.list.as_slice())
    }

    pub(crate) fn find(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let Some(ab) = frame.argument(0).as_array_buffer(global) else {
            return Err(global.throw(format_args!("InternalSourceMap.find: expected Uint8Array")));
        };
        let bytes = ab.byte_slice();
        if !internal_source_map::is_valid_blob(bytes) {
            return Err(global.throw(format_args!("InternalSourceMap.find: invalid blob")));
        }
        let line = frame.argument(1).to_int32();
        let col = frame.argument(2).to_int32();
        if line < 0 || col < 0 {
            return Ok(JSValue::NULL);
        }
        let ism = InternalSourceMap {
            data: bytes.as_ptr(),
        };
        let Some(mapping) = ism.find(
            Ordinal::from_zero_based(line),
            Ordinal::from_zero_based(col),
        ) else {
            return Ok(JSValue::NULL);
        };

        let obj = JSValue::create_empty_object(global, 5);
        obj.put(
            global,
            b"generatedLine",
            JSValue::js_number(mapping.generated.lines.zero_based() as f64),
        );
        obj.put(
            global,
            b"generatedColumn",
            JSValue::js_number(mapping.generated.columns.zero_based() as f64),
        );
        obj.put(
            global,
            b"originalLine",
            JSValue::js_number(mapping.original.lines.zero_based() as f64),
        );
        obj.put(
            global,
            b"originalColumn",
            JSValue::js_number(mapping.original.columns.zero_based() as f64),
        );
        obj.put(
            global,
            b"sourceIndex",
            JSValue::js_number(mapping.source_index as f64),
        );
        Ok(obj)
    }
}

/// Free-fn aliases of the [`TestingAPIs`] associated fns so
/// `bun_runtime::dispatch::js2native` can `pub use` them (associated fns
/// aren't importable items).
#[inline]
pub fn testing_from_vlq(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    TestingAPIs::from_vlq(global, frame)
}
#[inline]
pub fn testing_to_vlq(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    TestingAPIs::to_vlq(global, frame)
}
#[inline]
pub fn testing_find(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    TestingAPIs::find(global, frame)
}
