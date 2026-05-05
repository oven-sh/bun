//! CommandTag.to_js_tag / to_js_number.

use crate::jsc::{JSGlobalObject, JSValue};
use bun_sql::postgres::CommandTag;

pub trait CommandTagJsc {
    fn to_js_tag(&self, global: &JSGlobalObject) -> JSValue;
    fn to_js_number(&self) -> JSValue;
}

impl<'a> CommandTagJsc for CommandTag<'a> {
    fn to_js_tag(&self, global: &JSGlobalObject) -> JSValue {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::JSValue::js_number
            // TODO(b2-blocked): bun_string::String::create_utf8_for_js
            return match self {
                CommandTag::Insert(_) => JSValue::js_number(1),
                CommandTag::Delete(_) => JSValue::js_number(2),
                CommandTag::Update(_) => JSValue::js_number(3),
                CommandTag::Merge(_) => JSValue::js_number(4),
                CommandTag::Select(_) => JSValue::js_number(5),
                CommandTag::Move(_) => JSValue::js_number(6),
                CommandTag::Fetch(_) => JSValue::js_number(7),
                CommandTag::Copy(_) => JSValue::js_number(8),
                CommandTag::Other(tag) => bun_string::String::create_utf8_for_js(global, tag),
            };
        }
        #[cfg(not(any()))]
        {
            let _ = global;
            unimplemented!("b2-blocked: bun_jsc::JSValue::js_number")
        }
    }

    fn to_js_number(&self) -> JSValue {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::JSValue::js_number
            return match self {
                CommandTag::Other(_) => JSValue::js_number(0),
                CommandTag::Insert(val) => JSValue::js_number(*val),
                CommandTag::Delete(val) => JSValue::js_number(*val),
                CommandTag::Update(val) => JSValue::js_number(*val),
                CommandTag::Merge(val) => JSValue::js_number(*val),
                CommandTag::Select(val) => JSValue::js_number(*val),
                CommandTag::Move(val) => JSValue::js_number(*val),
                CommandTag::Fetch(val) => JSValue::js_number(*val),
                CommandTag::Copy(val) => JSValue::js_number(*val),
            };
        }
        #[cfg(not(any()))]
        unimplemented!("b2-blocked: bun_jsc::JSValue::js_number")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/command_tag_jsc.zig (30 lines)
//   confidence: medium
//   todos:      see TODO(b2-blocked)
//   notes:      CommandTag variant names/payloads inferred (Zig SCREAMING_CASE → PascalCase); `inline else` expanded by hand.
// ──────────────────────────────────────────────────────────────────────────
