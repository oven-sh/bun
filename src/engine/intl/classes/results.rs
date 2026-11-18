use bun_engine_text::StringRef;
use bun_engine_vm::{Attributes, JsFinalObject, ValueVec};

use super::prelude::*;
use crate::{Named, Part, Parts};

pub(super) fn initialize(cx: &Cx) {
    let global = cx.global();
    let shape = |names: &[PropertyName<'_>]| record_shape(cx, names);
    global.init_intl_part_shape(shape(&[names::r#type, names::value]));
    global.init_intl_part_with_unit_shape(shape(&[names::r#type, names::value, names::unit]));
    global.init_intl_part_with_source_shape(shape(&[names::r#type, names::value, names::source]));
}

/// Of ordinary objects with these data properties.
pub(super) fn record_shape(cx: &Cx, names: &[PropertyName<'_>]) -> Gc<Shape> {
    let prototype = cx.object_prototype().into();
    let empty = JsFinalObject::create_shape(cx, cx.global(), prototype, names.len());
    names.iter().fold(empty, |shape, &name| {
        (shape.add_property_transition(cx, name, Attributes::empty())).0
    })
}

pub(super) fn named(cx: &Cx, value: impl Named) -> Value {
    JsString::from_impl_cached(cx, &value.to_string_ref()).into()
}

pub(super) fn strings_to_array(
    cx: &Cx,
    strings: impl IntoIterator<Item = StringRef>,
) -> JsResult<Value> {
    values_to_array(
        cx,
        (strings.into_iter()).map(|string| Ok(JsString::new(cx, string).into())),
    )
}

pub(super) fn values_to_array(
    cx: &Cx,
    values: impl Iterator<Item = JsResult<Value>>,
) -> JsResult<Value> {
    let mut list = ValueVec::new();
    for value in values {
        cx.or_out_of_memory(list.try_push(value?))?;
    }
    Ok(cx.new_array_from(&list)?.into())
}

pub(super) fn parts_to_array(cx: &Cx, parts: &Parts) -> JsResult<Value> {
    values_to_array(
        cx,
        parts.iter().map(|item| {
            let (part, value) = item.or_throw(cx)?;
            Ok(part_to_object(cx, part, JsString::new(cx, value).into()))
        }),
    )
}

pub(super) fn part_to_object(cx: &Cx, part: Part, value: Value) -> Value {
    let kind = named(cx, part.kind);
    let create = |shape, values: &[Value]| JsFinalObject::create_with_values(cx, shape, values);
    match (part.unit, part.source) {
        (Some(unit), _) => create(
            cx.intl_part_with_unit_shape(),
            &[kind, value, named(cx, unit)],
        ),
        (None, Some(source)) => create(
            cx.intl_part_with_source_shape(),
            &[kind, value, named(cx, source)],
        ),
        (None, None) => create(cx.intl_part_shape(), &[kind, value]),
    }
    .into()
}

/// A new ordinary object that gets one data property after another.
pub(super) struct Record<'a> {
    cx: &'a Cx,
    object: Gc<JsObject>,
}

impl<'a> Record<'a> {
    pub(super) fn new(cx: &'a Cx) -> Record<'a> {
        let object = cx.new_object();
        Record { cx, object }
    }

    /// The start of a result of `resolvedOptions`.
    pub(super) fn with_locale(cx: &'a Cx, locale: StringRef) -> Record<'a> {
        let record = Record::new(cx);
        record.put_string(names::locale, locale);
        record
    }

    pub(super) fn put(&self, name: PropertyName<'_>, value: impl Into<Value>) {
        (self.object).put_direct(self.cx, name, value.into(), Attributes::empty());
    }

    pub(super) fn put_string(&self, name: PropertyName<'_>, value: StringRef) {
        self.put(name, JsString::new(self.cx, value));
    }

    pub(super) fn put_named(&self, name: PropertyName<'_>, value: impl Named) {
        self.put(name, named(self.cx, value));
    }

    pub(super) fn finish(self) -> Value {
        self.object.into()
    }
}
