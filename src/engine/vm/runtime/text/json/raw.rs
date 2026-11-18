use bun_engine_macros::cell;
use bun_engine_text::{CodeUnit, StringBuilder, names, with_text};

use super::Source;
use super::syntax_error::{Expected, SyntaxError};
use super::token::{Token, lex};
use crate::{
    Attributes, Cx, DeferredFire, Gc, JsObject, JsObjectInit, JsResult, JsString, PropertyOffset,
    Shape, ShapeSpec, TransitionKind, Value,
};

/// What `JSON.rawJSON` returns.
#[cell(name = "Object")]
pub struct RawJson {
    base: JsObject,
    text: Gc<JsString>,
}

fn check_primitive<T: CodeUnit>(units: &[T]) -> Result<(), SyntaxError> {
    let first = lex(units, 0);
    let (at, expected) = if first.token != Ok(Token::Primitive) {
        (0, Expected::Value)
    } else if first.end != units.len() {
        (first.end, Expected::EndOfPrimitive)
    } else {
        return Ok(());
    };
    Err(SyntaxError { at, expected })
}

impl RawJson {
    pub fn create_shape(cx: &Cx) -> Gc<Shape> {
        let spec = ShapeSpec::of::<RawJson>();
        let empty = Shape::create(cx, Some(cx.global()), Value::NULL, spec);
        let (shape, _) = empty.add_property_transition(cx, names::rawJSON, Attributes::NONE);
        shape.non_property_transition(cx, TransitionKind::Freeze, &mut DeferredFire::new(cx))
    }

    /// Throws unless `text` is the JSON text of a primitive, with nothing around it.
    pub fn create(cx: &Cx, text: Gc<JsString>) -> JsResult<Gc<RawJson>> {
        let view = text.view(cx)?;
        let characters = view.text();
        let Some(last) = characters.len().checked_sub(1) else {
            return Err(cx.throw_syntax_error("JSON.rawJSON cannot accept empty string"));
        };
        for (at, position) in [(0, "starting"), (last, "ending")] {
            let unit = characters.at(at);
            if matches!(unit, 0x09 | 0x0a | 0x0d | 0x20) {
                let mut message = StringBuilder::new();
                message.push_ascii("JSON.rawJSON cannot accept string ");
                message.push_ascii(position);
                message.push_ascii(" with '");
                message.push_unit(unit);
                message.push_latin1(b'\'');
                return Err(cx.throw_syntax_error(message));
            }
        }
        with_text!(characters, |units| check_primitive(units))
            .map_err(|error| error.throw(cx, Source::Text(characters)))?;
        let base = JsObjectInit::new(cx, cx.raw_json_shape());
        let object = cx.allocate::<RawJson>(RawJsonInit { base, text });
        object.put_direct_at(cx, PropertyOffset::for_slot(0, 0), text.into());
        Ok(object)
    }

    pub fn text(&self) -> Gc<JsString> {
        self.text
    }
}
