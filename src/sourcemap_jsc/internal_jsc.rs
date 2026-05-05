//! JS testing bindings for `InternalSourceMap`. Keeps `src/sourcemap/` free of JSC types.

use bun_jsc::{ArrayBuffer, CallFrame, JSGlobalObject, JSValue};
use bun_sourcemap::internal_source_map::{self, InternalSourceMap};
use bun_sourcemap::Ordinal;
use bun_str::MutableString;

// TODO(b2-blocked): bun_jsc::JsResult — real `Result<T, JsError>` alias is gated in
// bun_jsc; local shim keeps signatures stable for downstream callers / codegen.
type JsResult<T> = Result<T, bun_core::Error>;

pub struct TestingAPIs;

impl TestingAPIs {
    // TODO(b2-blocked): bun_jsc::host_fn — proc-macro attribute not yet implemented.
    pub fn from_vlq(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::CallFrame::argument
            // TODO(b2-blocked): bun_jsc::JSValue::to_bun_string
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw
            // TODO(b2-blocked): bun_jsc::ArrayBuffer::create_uint8_array
            let vlq_str = frame.argument(0).to_bun_string(global)?;
            let vlq = vlq_str.to_utf8();

            let Ok(blob) = internal_source_map::from_vlq(vlq.slice(), 0) else {
                return global.throw(format_args!("InternalSourceMap.fromVLQ: invalid VLQ input"));
            };
            return Ok(ArrayBuffer::create_uint8_array(global, &blob));
        }
        let _ = (global, frame);
        todo!("bun_jsc method surface gated")
    }

    pub fn to_vlq(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::JSValue::as_array_buffer
            // TODO(b2-blocked): bun_jsc::ArrayBuffer::byte_slice
            // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw
            // TODO(b2-blocked): bun_string::String::create_utf8_for_js
            let Some(ab) = frame.argument(0).as_array_buffer(global) else {
                return global.throw(format_args!("InternalSourceMap.toVLQ: expected Uint8Array"));
            };
            let bytes = ab.byte_slice();
            if !internal_source_map::is_valid_blob(bytes) {
                return global.throw(format_args!("InternalSourceMap.toVLQ: invalid blob"));
            }
            let ism = InternalSourceMap { data: bytes.as_ptr() };
            let mut out = MutableString::init_empty();
            ism.append_vlq_to(&mut out);
            return bun_str::String::create_utf8_for_js(global, out.list.as_slice());
        }
        let _ = (global, frame);
        todo!("bun_jsc method surface gated")
    }

    pub fn find(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::CallFrame::argument
            // TODO(b2-blocked): bun_jsc::JSValue::{to_int32, NULL, create_empty_object, put, js_number}
            // TODO(b2-blocked): bun_jsc::ZigString::static_
            let Some(ab) = frame.argument(0).as_array_buffer(global) else {
                return global.throw(format_args!("InternalSourceMap.find: expected Uint8Array"));
            };
            let bytes = ab.byte_slice();
            if !internal_source_map::is_valid_blob(bytes) {
                return global.throw(format_args!("InternalSourceMap.find: invalid blob"));
            }
            let line = frame.argument(1).to_int32();
            let col = frame.argument(2).to_int32();
            if line < 0 || col < 0 {
                return Ok(JSValue::NULL);
            }
            let ism = InternalSourceMap { data: bytes.as_ptr() };
            let Some(mapping) =
                ism.find(Ordinal::from_zero_based(line), Ordinal::from_zero_based(col))
            else {
                return Ok(JSValue::NULL);
            };

            let obj = JSValue::create_empty_object(global, 5);
            obj.put(global, bun_jsc::ZigString::static_(b"generatedLine"), JSValue::js_number(mapping.generated.lines.zero_based()));
            obj.put(global, bun_jsc::ZigString::static_(b"generatedColumn"), JSValue::js_number(mapping.generated.columns.zero_based()));
            obj.put(global, bun_jsc::ZigString::static_(b"originalLine"), JSValue::js_number(mapping.original.lines.zero_based()));
            obj.put(global, bun_jsc::ZigString::static_(b"originalColumn"), JSValue::js_number(mapping.original.columns.zero_based()));
            obj.put(global, bun_jsc::ZigString::static_(b"sourceIndex"), JSValue::js_number(mapping.source_index));
            return Ok(obj);
        }
        let _ = (global, frame);
        todo!("bun_jsc method surface gated")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sourcemap_jsc/internal_jsc.zig (59 lines)
//   confidence: medium
//   todos:      3 fn bodies gated on bun_jsc method surface
//   notes:      Ordinal newtype confirmed; create_utf8_for_js lives on tier-6 ext trait
// ──────────────────────────────────────────────────────────────────────────
