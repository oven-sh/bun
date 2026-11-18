use bun_engine_macros::cell;
use bun_engine_text::Text;

use crate::{Cx, FieldArray, Gc, JsObject, JsObjectInit, JsResult, JsString, Value};

#[cell(name = "String Iterator", cell_type = StringIterator)]
pub struct JsStringIterator {
    base: JsObject,
    pub(self) fields: FieldArray<Value, 2>,
}

impl JsStringIterator {
    /// An int32, which is -1 once it is done.
    pub const INDEX: usize = 0;
    pub const ITERATED_STRING: usize = 1;

    pub fn create(cx: &Cx, string: Gc<JsString>) -> Gc<JsStringIterator> {
        cx.allocate::<JsStringIterator>(JsStringIteratorInit {
            base: JsObjectInit::new(cx, cx.string_iterator_shape()),
            fields: [Value::ZERO, string.into()],
        })
    }

    /// One that is where this one is.
    pub fn duplicate(&self, cx: &Cx) -> Gc<JsStringIterator> {
        let copy = Self::create(cx, self.iterated_string());
        (copy.fields()).set(Self::INDEX, self.fields().at(Self::INDEX));
        copy
    }

    #[inline(always)]
    pub fn iterated_string(&self) -> Gc<JsString> {
        self.fields().at(Self::ITERATED_STRING).cast()
    }

    /// Past any string once it is done.
    #[inline(always)]
    pub(crate) fn index(&self) -> u32 {
        self.fields().at(Self::INDEX).to_bits() as u32
    }

    #[inline(always)]
    pub(super) fn set_index(&self, index: u32) {
        self.fields().set(Self::INDEX, Value::int32(index as i32));
    }

    /// `%StringIteratorPrototype%.next`, without the object for the result.
    #[inline]
    pub fn next(&self, cx: &Cx) -> JsResult<Option<Gc<JsString>>> {
        let step = code_point_string_at(cx, &self.iterated_string(), self.index())?;
        self.set_index(step.map_or(u32::MAX, |(_, next)| next));
        Ok(step.map(|(string, _)| string))
    }
}

/// And the index after it. `None` past the end.
#[inline(always)]
pub(super) fn code_point_string_at(
    cx: &Cx,
    string: &JsString,
    index: u32,
) -> JsResult<Option<(Gc<JsString>, u32)>> {
    if index >= string.len() {
        return Ok(None);
    }
    let view = string.view(cx)?;
    Ok(Some(match view.text() {
        Text::Latin1(characters) => {
            let character = characters[index as usize];
            (cx.small_strings.single_character(character), index + 1)
        }
        text => {
            let code_point = text.code_point_at(index as usize);
            let next = index + 1 + u32::from(code_point > 0xffff);
            (JsString::from_code_point(cx, code_point), next)
        }
    }))
}
