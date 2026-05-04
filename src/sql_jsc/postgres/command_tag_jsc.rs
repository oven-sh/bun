//! CommandTag.to_js_tag / to_js_number.

use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_sql::postgres::CommandTag;

pub trait CommandTagJsc {
    fn to_js_tag(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn to_js_number(&self) -> JSValue;
}

impl CommandTagJsc for CommandTag {
    fn to_js_tag(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            CommandTag::Insert(_) => Ok(JSValue::js_number(1)),
            CommandTag::Delete(_) => Ok(JSValue::js_number(2)),
            CommandTag::Update(_) => Ok(JSValue::js_number(3)),
            CommandTag::Merge(_) => Ok(JSValue::js_number(4)),
            CommandTag::Select(_) => Ok(JSValue::js_number(5)),
            CommandTag::Move(_) => Ok(JSValue::js_number(6)),
            CommandTag::Fetch(_) => Ok(JSValue::js_number(7)),
            CommandTag::Copy(_) => Ok(JSValue::js_number(8)),
            CommandTag::Other(tag) => bun_str::String::create_utf8_for_js(global, tag),
        }
    }

    fn to_js_number(&self) -> JSValue {
        match self {
            CommandTag::Other(_) => JSValue::js_number(0),
            CommandTag::Insert(val) => JSValue::js_number(*val),
            CommandTag::Delete(val) => JSValue::js_number(*val),
            CommandTag::Update(val) => JSValue::js_number(*val),
            CommandTag::Merge(val) => JSValue::js_number(*val),
            CommandTag::Select(val) => JSValue::js_number(*val),
            CommandTag::Move(val) => JSValue::js_number(*val),
            CommandTag::Fetch(val) => JSValue::js_number(*val),
            CommandTag::Copy(val) => JSValue::js_number(*val),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/command_tag_jsc.zig (30 lines)
//   confidence: medium
//   todos:      0
//   notes:      CommandTag variant names/payloads inferred (Zig SCREAMING_CASE → PascalCase); `inline else` expanded by hand.
// ──────────────────────────────────────────────────────────────────────────
