//! CommandTag.to_js_tag / to_js_number.

use crate::jsc::{JSGlobalObject, JSValue, JsResult, bun_string_jsc};
use bun_sql::postgres::CommandTag;

pub trait CommandTagJsc {
    fn to_js_tag(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn to_js_number(&self) -> JSValue;
}

impl<'a> CommandTagJsc for CommandTag<'a> {
    fn to_js_tag(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match self {
            CommandTag::Insert(_) => JSValue::js_number(1.0),
            CommandTag::Delete(_) => JSValue::js_number(2.0),
            CommandTag::Update(_) => JSValue::js_number(3.0),
            CommandTag::Merge(_) => JSValue::js_number(4.0),
            CommandTag::Select(_) => JSValue::js_number(5.0),
            CommandTag::Move(_) => JSValue::js_number(6.0),
            CommandTag::Fetch(_) => JSValue::js_number(7.0),
            CommandTag::Copy(_) => JSValue::js_number(8.0),
            CommandTag::Other(tag) => bun_string_jsc::create_utf8_for_js(global, tag)?,
        })
    }

    fn to_js_number(&self) -> JSValue {
        match self {
            CommandTag::Other(_) => JSValue::js_number(0.0),
            CommandTag::Insert(val)
            | CommandTag::Delete(val)
            | CommandTag::Update(val)
            | CommandTag::Merge(val)
            | CommandTag::Select(val)
            | CommandTag::Move(val)
            | CommandTag::Fetch(val)
            | CommandTag::Copy(val) => JSValue::js_number(*val as f64),
        }
    }
}

// ported from: src/sql_jsc/postgres/command_tag_jsc.zig
