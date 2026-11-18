//! What a simple comparator would look at, so that a sort need not call it.

use bun_engine_bytecode::{Comparator, SortKey, Specialization};
use bun_engine_text::{PropertyName, names};

use crate::{Attributes, Cx, JsFunction, JsResult, PropertyOffset, ShapeId, Value};

/// Remembers where the last object had the property.
struct OwnProperty<'a> {
    name: PropertyName<'a>,
    shape: ShapeId,
    offset: PropertyOffset,
}

impl OwnProperty<'_> {
    #[inline(always)]
    fn of(&mut self, value: Value) -> Option<Value> {
        let object = value.as_object()?;
        if object.shape_id() != self.shape {
            let (offset, attributes) = object.shape().get(self.name)?;
            if object.overrides_get_own_property_slot()
                || attributes.intersects(Attributes::ANY_ACCESSOR)
            {
                return None;
            }
            (self.shape, self.offset) = (object.shape_id(), offset);
        }
        // SAFETY: from the shape, which nothing has changed since.
        Some(unsafe { object.get_direct_unchecked(self.offset) })
    }
}

#[inline(always)]
fn fill(keys: &mut [Value], values: &[Value], mut key: impl FnMut(Value) -> Option<Value>) -> bool {
    (keys.iter_mut().zip(values))
        .all(|(target, &value)| key(value).map(|it| *target = it).is_some())
}

/// `None` unless `function` only compares, and getting the key of each value has no effect.
pub fn find_sort_keys(
    cx: &mut Cx,
    function: Value,
    values: &[Value],
    keys: &mut [Value],
) -> JsResult<Option<Comparator>> {
    let function = function.downcast::<JsFunction>();
    let Some((function, executable)) = function.and_then(|it| Some((it, it.script_executable()?)))
    else {
        return Ok(None);
    };
    let realm = cx.in_realm(function.function_realm());
    let code = executable.unlinked_code(realm, Specialization::Call)?;
    let Some(comparator) = code.as_comparator() else {
        return Ok(None);
    };
    let own_property = |name| OwnProperty {
        name,
        shape: ShapeId::NONE,
        offset: PropertyOffset::INVALID,
    };
    let has_all = match comparator.key {
        SortKey::Whole => fill(keys, values, Some),
        SortKey::Property(name) => {
            let mut property = own_property(code.identifiers[name.index()].name());
            fill(keys, values, |value| property.of(value))
        }
        SortKey::Length => {
            let mut property = own_property(names::length);
            fill(keys, values, |value| match value.as_string() {
                Some(string) => Some(string.len().into()),
                None => (value.as_exact_array().map(|it| it.length().into()))
                    .or_else(|| property.of(value)),
            })
        }
        SortKey::Element(index) => fill(keys, values, |value| {
            value.as_object()?.try_get_dense(index)
        }),
    };
    Ok(has_all.then_some(comparator))
}
