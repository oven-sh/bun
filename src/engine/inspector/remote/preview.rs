//! `Runtime.ObjectPreview`

use core::ops::ControlFlow::{self, Break, Continue};

use bun_engine_text::{StringRef, Text, names, parse_array_index};
use bun_engine_vm::heap::RootSet;
use bun_engine_vm::{
    Cx, DontEnumMode, Gc, JsObject, JsResult, JsWeakRef, PropertyNameMode, ProxyObject, Value,
};

use super::object::{Subtype, Summary, is_plain, kind_of, to_literal, to_text};
use super::properties::{Content, Property, Selection};
use super::{Remote, as_value_of_language, attempt, settle};
use crate::protocol::{Object, Outcome, object};

/// What an object is shown as. The parts of a table are shown with all that they have.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Role {
    Ordinary,
    Table,
    Row,
    Cell,
}

impl Role {
    /// Of a value in the object, if that is a part of the table.
    fn of_member(self) -> Option<Role> {
        match self {
            Role::Table => Some(Role::Row),
            Role::Row => Some(Role::Cell),
            Role::Cell | Role::Ordinary => None,
        }
    }
}

pub(super) struct Preview {
    kind: &'static str,
    subtype: Option<Subtype>,
    description: StringRef,
    size: Option<f64>,
    is_lossless: bool,
    overflows: Option<bool>,
    properties: Option<Vec<Object>>,
    entries: Option<Vec<Object>>,
}

impl Preview {
    fn new(cx: &mut Cx, value: Value, summary: &Summary) -> JsResult<Preview> {
        let has_content = summary.subtype.is_some_and(|it| it != Subtype::Null);
        let description = match &summary.description {
            Some(description) if !description.is_empty() => description.clone(),
            _ if is_plain(cx, value) => to_text(cx, value)?,
            _ => StringRef::from_literal("undefined"),
        };
        Ok(Preview {
            kind: summary.kind,
            subtype: summary.subtype,
            description,
            size: summary.size,
            is_lossless: true,
            overflows: has_content.then_some(false),
            properties: has_content.then(Vec::new),
            entries: None,
        })
    }

    fn overflow(&mut self) {
        self.overflows = Some(true);
        self.is_lossless = false;
    }

    pub(super) fn into_json(self) -> Object {
        object! {
            "type": self.kind,
            "description": self.description,
            "lossless": self.is_lossless,
            "subtype" => self.subtype.map(Subtype::name),
            "overflow" => self.overflows,
            "properties" => self.properties,
            "size" => self.size,
            "entries" => self.entries,
        }
    }
}

/// How many more properties there is room for.
struct Room {
    names: u32,
    indices: u32,
}

const MAX_TEXT_LENGTH: usize = 100;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Cut {
    Middle,
    End,
}

fn abbreviated(text: StringRef, cut: Cut) -> StringRef {
    if text.len() <= MAX_TEXT_LENGTH {
        return text;
    }
    let (kept, rest) = match cut {
        Cut::Middle => (MAX_TEXT_LENGTH / 2, MAX_TEXT_LENGTH / 2 - 1),
        Cut::End => (MAX_TEXT_LENGTH, 0),
    };
    let (text, ellipsis) = (text.text(), Text::Utf16(&[0x2026]));
    let end = text.slice_from(text.len() - rest);
    StringRef::try_concat(&[text.slice(0..kept), ellipsis, end]).unwrap_or_default()
}

fn is_uint32(name: Text<'_>) -> bool {
    parse_array_index(name).is_some() || name.eq_ascii("4294967295")
}

/// What is behind all proxies, or behind all weak references.
fn final_target(cx: &Cx, value: Value, subtype: Option<Subtype>) -> Value {
    let step = |value: &Value| match subtype {
        Some(Subtype::Proxy) => Some(value.downcast::<ProxyObject>()?.target().into()),
        Some(Subtype::WeakRef) => {
            let target = value.downcast::<JsWeakRef>()?.deref_target(cx);
            Some(target.map_or_default(Value::from))
        }
        _ => None,
    };
    let chain = core::iter::successors(Some(value), step);
    chain.last().unwrap_or(value)
}

impl Remote<'_> {
    pub(crate) fn preview(self, cx: &mut Cx, value: Value) -> JsResult<Object> {
        let preview = self.preview_value(cx, value, Some(Role::Ordinary))?;
        Ok(preview.into_json())
    }

    /// The error is what was thrown.
    pub(crate) fn preview_by_id(self, cx: &mut Cx, id: Option<u32>) -> Outcome {
        let result = self.preview(cx, self.registry.find(id).unwrap_or_default());
        match settle(cx, attempt(cx, result)).ok_or("Internal error")? {
            Ok(preview) => Ok(preview),
            Err(thrown) => {
                let text = thrown.to_string_ref(cx);
                Err(settle(cx, text).unwrap_or_default().into())
            }
        }
    }

    /// Without `content` it does not look inside.
    fn preview_value(self, cx: &mut Cx, value: Value, content: Option<Role>) -> JsResult<Preview> {
        cx.check_stack()?;
        let value = as_value_of_language(value);
        let summary = self.summarize(cx, value, None)?;
        if let Some(role) = content.filter(|_| summary.kind == "object" && !value.is_null()) {
            return self.preview_content(cx, value, &summary, role);
        }
        let mut preview = Preview::new(cx, value, &summary)?;
        if summary.subtype.is_some_and(Subtype::has_entries)
            && (summary.size).is_some_and(|size| size != 0.0 && !size.is_nan())
        {
            preview.entries = Some(Vec::new());
            preview.overflow();
        }
        Ok(preview)
    }

    pub(super) fn preview_content(
        self,
        cx: &mut Cx,
        value: Value,
        summary: &Summary,
        role: Role,
    ) -> JsResult<Preview> {
        let mut preview = Preview::new(cx, value, summary)?;
        let target = final_target(cx, value, summary.subtype);
        let stands_in = target != value;
        let role = if stands_in { Role::Ordinary } else { role };
        let result = self.fill_preview(cx, target, &mut preview, role);
        preview.is_lossless &= attempt(cx, result)?.is_ok() && !stands_in;
        Ok(preview)
    }

    fn fill_preview(
        self,
        cx: &mut Cx,
        value: Value,
        preview: &mut Preview,
        role: Role,
    ) -> JsResult<()> {
        let (names, indices) = match role {
            Role::Ordinary => (5, 10),
            _ => (1000, 1000),
        };
        let mut room = Room { names, indices };
        if let Some(subtype) = preview.subtype.filter(|it| it.has_entries()) {
            self.preview_entries(cx, value, subtype, preview)?;
        }
        preview.properties = Some(Vec::new());
        let has_entries = preview.entries.is_some();
        let mut add = |cx: &mut Cx, property: &Property| {
            self.preview_property(cx, value, property, preview, &mut room, role)
        };
        for property in self.internal_properties(cx, value)?.iter() {
            if add(cx, property)?.is_break() {
                return Ok(());
            }
        }
        match value.as_object().filter(|_| !has_entries) {
            Some(object) => self.for_each_property(cx, object, Selection::Preview, true, &mut add),
            None => Ok(()),
        }
    }

    fn preview_entries(
        self,
        cx: &mut Cx,
        value: Value,
        subtype: Subtype,
        preview: &mut Preview,
    ) -> JsResult<()> {
        const MAX_ENTRIES: usize = 5;
        const MAX_NESTING: u32 = 50;
        const MAX_NESTED_PREVIEWS: u32 = 5000;
        let Some(mut entries) = Self::entries(cx, value, subtype, 0, MAX_ENTRIES + 1)? else {
            return Ok(());
        };
        if entries.len() > MAX_ENTRIES {
            entries.truncate(MAX_ENTRIES);
            preview.overflow();
        }
        if self.nesting == 0 {
            self.registry.nested_previews().set(0);
        }
        let nesting = self.nesting + 1;
        let (inner, mut previews) = (Remote { nesting, ..self }, Vec::new());
        let mut preview_part = |cx: &mut Cx, part: Value| {
            let count = self.registry.nested_previews().get().saturating_add(1);
            self.registry.nested_previews().set(count);
            let has_room = nesting <= MAX_NESTING && count <= MAX_NESTED_PREVIEWS;
            let content = (has_room && part != value).then_some(Role::Ordinary);
            let part = inner.preview_value(cx, part, content)?;
            preview.is_lossless &= part.is_lossless;
            Ok(part.into_json())
        };
        for &(key, value) in &entries {
            let value = preview_part(cx, value)?;
            let key = key.map(|key| preview_part(cx, key)).transpose()?;
            previews.push(object! { "key" => key, "value": value });
        }
        preview.entries = Some(previews);
        Ok(())
    }

    /// One that is not may have methods which are worth a look.
    fn is_basic_prototype(cx: &mut Cx, prototype: Value) -> JsResult<bool> {
        if !prototype.to_boolean(cx) {
            return Ok(true);
        }
        let constructor = prototype.get(cx, names::constructor)?;
        Ok(!constructor.to_boolean(cx)
            || constructor == cx.object_constructor().into()
            || constructor == cx.array_constructor().into()
            || constructor == cx.regexp_constructor().into())
    }

    fn preview_property(
        self,
        cx: &mut Cx,
        holder: Value,
        property: &Property,
        preview: &mut Preview,
        room: &mut Room,
        role: Role,
    ) -> JsResult<ControlFlow<()>> {
        let (name, subtype) = (&property.name, preview.subtype);
        if property.was_thrown {
            preview.is_lossless = false;
            return Ok(Continue(()));
        }
        if name.text() == names::__proto__.text() {
            if let Content::Value(prototype) = property.content {
                preview.is_lossless &= Self::is_basic_prototype(cx, prototype)?;
            }
            return Ok(Continue(()));
        }
        let (is_array, is_index) = (subtype == Some(Subtype::Array), is_uint32(name.text()));
        let is_shown = property.is_enumerable()
            || property.is_own
            || is_array
            || (property.is_native_getter && subtype != Some(Subtype::RegExp));
        if !is_shown || (is_array && !is_index) {
            return Ok(Continue(()));
        }
        let mut json = object! { "name": name };
        match property.content {
            Content::Accessor { .. } => {
                preview.is_lossless = false;
                json.add("type", "accessor");
            }
            Content::Value(value) if value.is_callable() && !property.is_enumerable() => {
                return Ok(Continue(()));
            }
            Content::Value(value) => {
                self.preview_property_value(cx, holder, value, &mut json, preview, role)?;
            }
        }
        let left = if is_index {
            &mut room.indices
        } else {
            &mut room.names
        };
        let Some(rest) = left.checked_sub(1) else {
            preview.overflow();
            return Ok(Break(()));
        };
        *left = rest;
        json.add_if_true("isPrivate", property.is_private);
        json.add_if_true("internal", property.is_internal);
        preview.properties.get_or_insert_default().push(json);
        Ok(Continue(()))
    }

    fn preview_property_value(
        self,
        cx: &mut Cx,
        holder: Value,
        value: Value,
        json: &mut Object,
        preview: &mut Preview,
        role: Role,
    ) -> JsResult<()> {
        let value = as_value_of_language(value);
        let (kind, subtype) = (kind_of(cx, value), self.subtype(cx, value)?);
        json.add("type", kind);
        json.add_if_any("subtype", subtype.map(Subtype::name));
        if is_plain(cx, value) || value.is_symbol() {
            let mut text = to_literal(cx, value)?;
            if text.len() > MAX_TEXT_LENGTH && !value.is_bigint() {
                text = abbreviated(text, Cut::Middle);
                preview.is_lossless = false;
            }
            json.add("value", text);
            return Ok(());
        }
        let mut seen = RootSet::default();
        seen.extend(holder.as_object());
        if role.of_member().is_some() || self.is_simple(cx, value, &mut seen, 1)? {
            let role = role.of_member().unwrap_or(Role::Ordinary);
            let inner = self.preview_value(cx, value, (value != holder).then_some(role))?;
            preview.is_lossless &= inner.is_lossless;
            if inner.overflows == Some(true) {
                preview.overflows = Some(true);
            }
            json.add("valuePreview", inner.into_json());
            return Ok(());
        }
        let description = if subtype == Some(Subtype::Class) {
            let name = value.get(cx, names::name)?.to_string_ref(cx)?;
            let parts = [Text::from_ascii("class "), name.text()];
            cx.or_out_of_memory(StringRef::try_concat(&parts))?
        } else if kind == "function" {
            StringRef::empty()
        } else {
            self.describe(cx, value, subtype, None)?
        };
        let cut = match subtype {
            Some(Subtype::RegExp) => Cut::Middle,
            _ => Cut::End,
        };
        json.add("value", abbreviated(description, cut));
        preview.is_lossless = false;
        Ok(())
    }

    /// Whether it is small enough to be shown inside the preview of another object.
    fn is_simple(
        self,
        cx: &mut Cx,
        value: Value,
        seen: &mut RootSet<Gc<JsObject>>,
        depth: u32,
    ) -> JsResult<bool> {
        const MAX_DEPTH: u32 = 3;
        const MAX_ELEMENTS: f64 = 5.0;
        const MAX_PROPERTIES: usize = 3;
        if depth > MAX_DEPTH {
            return Ok(false);
        }
        let Some(object) = value.as_object().filter(|_| !is_plain(cx, value)) else {
            return Ok(true);
        };
        if !seen.insert(object) {
            return Ok(false);
        }
        if self.subtype(cx, value)? == Some(Subtype::Array) {
            let length = object.get(cx, names::length)?.to_number(cx)?;
            if length > MAX_ELEMENTS {
                return Ok(false);
            }
            for index in 0..length.ceil() as u64 {
                let element = object.get_index(cx, index)?;
                if !self.is_simple(cx, element, seen, depth + 1)? {
                    return Ok(false);
                }
            }
            return Ok(true);
        }
        let prototype = object.get(cx, names::__proto__)?;
        if prototype.to_boolean(cx) && prototype.get(cx, names::__proto__)?.to_boolean(cx) {
            return Ok(false);
        }
        let names = object.own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Include)?;
        if names.len() > MAX_PROPERTIES {
            return Ok(false);
        }
        for name in names.iter() {
            let descriptor = object.get_own_property_descriptor(cx, name.name())?;
            if descriptor.is_some_and(|it| !it.is_data()) {
                return Ok(false);
            }
            let member = object.get(cx, name.name())?;
            if !self.is_simple(cx, member, seen, depth + 1)? {
                return Ok(false);
            }
        }
        Ok(true)
    }
}
