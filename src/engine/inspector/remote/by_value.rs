//! Between values and JSON, without asking them how they would like to look.

use bun_engine_text::{Identifier, StringBuilder};
use bun_engine_vm::{
    CellType, Cx, DontEnumMode, JsArray, JsResult, JsString, PropertyNameMode, Value, ValueVec,
};

use crate::protocol::Json;

/// `None` if it has a symbol or a BigInt in it, or nests deeper than `depth`.
pub(super) fn to_json(cx: &mut Cx, value: Value, depth: u32) -> JsResult<Option<Json>> {
    let mut out = StringBuilder::new();
    if !write(cx, value, depth, &mut out)? {
        return Ok(None);
    }
    Ok(Some(Json::Written(cx.or_out_of_memory(out.finish())?)))
}

fn check_room(cx: &mut Cx, out: &StringBuilder, more: usize) -> JsResult<()> {
    const MAX_LENGTH: usize = 1 << 28;
    if out.has_overflowed() || out.len().saturating_add(more) > MAX_LENGTH {
        return Err(cx.throw_out_of_memory());
    }
    cx.check_traps()
}

/// False if it cannot be written.
fn write(cx: &mut Cx, value: Value, depth: u32, out: &mut StringBuilder) -> JsResult<bool> {
    let Some(depth) = depth.checked_sub(1) else {
        return Ok(false);
    };
    let Some(object) = value.as_object() else {
        let json = primitive_to_json(cx, value)?;
        return Ok(json.map(|it| it.write(out)).is_some());
    };
    cx.check_stack()?;
    if object.cell_type() == CellType::Array {
        let array = object.cast::<JsArray>();
        out.push_latin1(b'[');
        let length = array.length();
        for index in 0..length {
            check_room(cx, out, (length - index) as usize)?;
            if index != 0 {
                out.push_latin1(b',');
            }
            let element = array.get_index(cx, index.into())?;
            if !write(cx, element, depth, out)? {
                return Ok(false);
            }
        }
        out.push_latin1(b']');
        return Ok(true);
    }
    let names = object.own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Exclude)?;
    out.push_latin1(b'{');
    for (index, name) in names.iter().enumerate() {
        check_room(cx, out, 0)?;
        if index != 0 {
            out.push_latin1(b',');
        }
        out.push_json_quoted(name.name().text());
        out.push_latin1(b':');
        let member = object.get(cx, name.name())?;
        if !write(cx, member, depth, out)? {
            return Ok(false);
        }
    }
    out.push_latin1(b'}');
    Ok(true)
}

pub(super) fn primitive_to_json(cx: &Cx, value: Value) -> JsResult<Option<Json>> {
    if let Some(string) = value.as_string() {
        return Ok(Some(string.to_string_ref(cx)?.into()));
    }
    Ok((value.as_number().map(Json::from))
        .or_else(|| value.as_boolean().map(Json::from))
        .or_else(|| value.is_undefined_or_null().then_some(Json::Null)))
}

pub(super) fn from_json(cx: &mut Cx, json: &Json) -> JsResult<Value> {
    cx.check_stack()?;
    Ok(match json {
        Json::Null => Value::NULL,
        &Json::Boolean(value) => value.into(),
        &Json::Number(value) => Value::number(value),
        Json::Literal(value) => JsString::from_literal(cx, value).into(),
        Json::String(value) | Json::Written(value) => JsString::new(cx, value.clone()).into(),
        Json::Array(elements) => {
            let mut values = ValueVec::new();
            for element in elements {
                values.push(from_json(cx, element)?);
            }
            cx.new_array_from(&values)?.into()
        }
        Json::Object(members) => {
            let object = cx.new_object();
            for (name, member) in members.members() {
                let member = from_json(cx, member)?;
                object.create_data_property(cx, Identifier::new(name).name(), member, false)?;
            }
            object.into()
        }
    })
}
