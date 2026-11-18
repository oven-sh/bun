//! `Runtime.RemoteObject`

use bun_engine_text::{StringRef, Text, names, symbols};
use bun_engine_vm::{
    CellType, Cx, Gc, JsFunction, JsMap, JsObject, JsResult, JsSet, JsWeakMap, JsWeakRef,
    JsWeakSet, Value,
};

use super::by_value::primitive_to_json;
use super::preview::Role;
use super::{Remote, as_value_of_language, attempt};
use crate::protocol::{Json, Object, object};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Subtype {
    Array,
    Null,
    RegExp,
    Date,
    Error,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Iterator,
    Class,
    Proxy,
    WeakRef,
}

impl Subtype {
    const ALL: [(Subtype, &'static str); 13] = [
        (Subtype::Array, "array"),
        (Subtype::Null, "null"),
        (Subtype::RegExp, "regexp"),
        (Subtype::Date, "date"),
        (Subtype::Error, "error"),
        (Subtype::Map, "map"),
        (Subtype::Set, "set"),
        (Subtype::WeakMap, "weakmap"),
        (Subtype::WeakSet, "weakset"),
        (Subtype::Iterator, "iterator"),
        (Subtype::Class, "class"),
        (Subtype::Proxy, "proxy"),
        (Subtype::WeakRef, "weakref"),
    ];

    pub(super) fn name(self) -> &'static str {
        Self::ALL[self as usize].1
    }

    fn named(name: Text<'_>) -> Option<Subtype> {
        let found = Self::ALL.iter().find(|it| name.eq_ascii(it.1));
        found.map(|it| it.0)
    }

    pub(super) fn has_entries(self) -> bool {
        use Subtype::{Iterator, Map, Set, WeakMap, WeakSet};
        matches!(self, Map | Set | WeakMap | WeakSet | Iterator)
    }

    fn of_builtin(object: Gc<JsObject>) -> Option<Subtype> {
        Some(match object.cell_type() {
            CellType::ErrorInstance => Subtype::Error,
            CellType::Function if object.cast::<JsFunction>().is_class_constructor() => {
                Subtype::Class
            }
            CellType::Array
            | CellType::DerivedArray
            | CellType::DirectArguments
            | CellType::ScopedArguments => Subtype::Array,
            CellType::Date => Subtype::Date,
            CellType::RegExpObject => Subtype::RegExp,
            CellType::Proxy => Subtype::Proxy,
            CellType::Map => Subtype::Map,
            CellType::Set => Subtype::Set,
            CellType::WeakMap => Subtype::WeakMap,
            CellType::WeakSet => Subtype::WeakSet,
            CellType::StringIterator
            | CellType::ArrayIterator
            | CellType::MapIterator
            | CellType::SetIterator => Subtype::Iterator,
            other if CellType::TYPED_ARRAYS.contains(other) => Subtype::Array,
            _ if object.is::<JsWeakRef>() => Subtype::WeakRef,
            _ => return None,
        })
    }
}

/// How much is said of the content of an object.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Detail {
    None,
    Preview,
    /// For `console.table`.
    Table,
}

impl Detail {
    pub(crate) fn preview_if(is_wanted: bool) -> Detail {
        if is_wanted {
            Detail::Preview
        } else {
            Detail::None
        }
    }
}

/// What a `RemoteObject` and an `ObjectPreview` have in common.
pub(super) struct Summary {
    pub(super) kind: &'static str,
    pub(super) subtype: Option<Subtype>,
    pub(super) description: Option<StringRef>,
    pub(super) size: Option<f64>,
}

/// `typeof`
pub(super) fn kind_of(cx: &Cx, value: Value) -> &'static str {
    match value.as_cell() {
        None if value.is_number() => "number",
        None if value.is_boolean() => "boolean",
        None if value.is_null() => "object",
        None => "undefined",
        Some(cell) if cell.is_string() => "string",
        Some(cell) if cell.is_symbol() => "symbol",
        Some(cell) if cell.is_bigint() => "bigint",
        Some(cell) if cell.masquerades_as_undefined(cx) => "undefined",
        Some(_) if value.is_callable() => "function",
        Some(_) => "object",
    }
}

/// Whether it is described in full, without an id.
pub(super) fn is_plain(cx: &Cx, value: Value) -> bool {
    !matches!(kind_of(cx, value), "symbol" | "function" | "object") || value.is_null()
}

/// `String(value)`
pub(super) fn to_text(cx: &mut Cx, value: Value) -> JsResult<StringRef> {
    match value.as_symbol() {
        Some(symbol) => cx.or_out_of_memory(symbol.descriptive_string()),
        None => value.to_string_ref(cx),
    }
}

/// As it would be written.
pub(super) fn to_literal(cx: &mut Cx, value: Value) -> JsResult<StringRef> {
    if value
        .as_double()
        .is_some_and(bun_engine_number::is_negative_zero)
    {
        return Ok(StringRef::from_literal("-0"));
    }
    let text = to_text(cx, value)?;
    if !value.is_bigint() {
        return Ok(text);
    }
    cx.or_out_of_memory(StringRef::try_concat(&[text.text(), Text::from_ascii("n")]))
}

pub(super) fn is_finite(cx: &mut Cx, value: Value) -> JsResult<bool> {
    Ok(value.to_number(cx)?.is_finite())
}

fn looks_like_array(cx: &mut Cx, object: &JsObject) -> JsResult<bool> {
    if !object.get(cx, names::splice)?.is_callable() {
        return Ok(false);
    }
    let length = object.get(cx, names::length)?;
    is_finite(cx, length)
}

impl Remote<'_> {
    pub(super) fn subtype(self, cx: &mut Cx, value: Value) -> JsResult<Option<Subtype>> {
        let Some(object) = value.as_object().filter(|_| !is_plain(cx, value)) else {
            return Ok(value.is_null().then_some(Subtype::Null));
        };
        if let Some(subtype) = Subtype::of_builtin(object) {
            return Ok(Some(subtype));
        }
        if let Some(name) = self.controller.host.subtype(cx, value).as_string() {
            return Ok(Subtype::named(name.view(cx)?.text()));
        }
        let result = looks_like_array(cx, &object);
        let is_array = attempt(cx, result)?.unwrap_or(false);
        Ok(is_array.then_some(Subtype::Array))
    }

    /// Of a symbol or an object. `text` is what it has been converted to already.
    pub(super) fn describe(
        self,
        cx: &mut Cx,
        value: Value,
        subtype: Option<Subtype>,
        text: Option<&StringRef>,
    ) -> JsResult<StringRef> {
        let Some(object) = value.as_object() else {
            return to_text(cx, value);
        };
        match subtype {
            Some(Subtype::RegExp | Subtype::Date | Subtype::Error) => {
                return text.cloned().map_or_else(|| to_text(cx, value), Ok);
            }
            Some(Subtype::Proxy) => return Ok(StringRef::from_literal("Proxy")),
            Some(Subtype::WeakRef) => return Ok(StringRef::from_literal("WeakRef")),
            Some(Subtype::Array) => return Ok(object.calculated_class_name(cx)),
            Some(Subtype::Iterator) => {
                if let Some(tag) = object.get(cx, symbols::toStringTag)?.as_string() {
                    return tag.to_string_ref(cx);
                }
            }
            _ => {}
        }
        if object.is_callable() {
            if let Some(text) = text {
                return Ok(text.clone());
            }
            let source = cx.invoke(value, names::toString, &[])?;
            return to_text(cx, source);
        }
        let class_name = object.calculated_class_name(cx);
        if class_name.text() == names::Object.text() {
            let constructor = object.get(cx, names::constructor)?;
            if !constructor.is_undefined_or_null()
                && let Some(name) = constructor.get(cx, names::name)?.as_string()
                && !name.is_empty()
            {
                return name.to_string_ref(cx);
            }
        }
        Ok(class_name)
    }

    fn size(cx: &mut Cx, object: Gc<JsObject>, subtype: Subtype) -> JsResult<Option<f64>> {
        Ok(Some(match subtype {
            Subtype::Array => (object.get(cx, names::length)?.as_number()).unwrap_or(0.0),
            Subtype::Map | Subtype::Set => match object.get(cx, names::size)?.as_number() {
                Some(size) => size,
                None => match object.downcast::<JsMap>() {
                    Some(map) => map.size().into(),
                    None => object.downcast::<JsSet>().map_or(0, |it| it.size()).into(),
                },
            },
            Subtype::WeakMap => (object.downcast::<JsWeakMap>().map_or(0, |it| it.size())).into(),
            Subtype::WeakSet => (object.downcast::<JsWeakSet>().map_or(0, |it| it.size())).into(),
            _ => return Ok(None),
        }))
    }

    pub(super) fn summarize(
        self,
        cx: &mut Cx,
        value: Value,
        text: Option<&StringRef>,
    ) -> JsResult<Summary> {
        let (kind, subtype) = (kind_of(cx, value), self.subtype(cx, value)?);
        let description = if !is_plain(cx, value) {
            Some(self.describe(cx, value, subtype, text)?)
        } else if value.is_number() || value.is_bigint() {
            Some(to_literal(cx, value)?)
        } else {
            None
        };
        let size = match value.as_object().zip(subtype) {
            Some((object, subtype)) => Self::size(cx, object, subtype)?,
            None => None,
        };
        Ok(Summary {
            kind,
            subtype,
            description,
            size,
        })
    }

    fn try_wrap(
        self,
        cx: &mut Cx,
        value: Value,
        group: &StringRef,
        detail: Detail,
        text: Option<&StringRef>,
    ) -> JsResult<Object> {
        cx.check_stack()?;
        if is_plain(cx, value) {
            let summary = self.summarize(cx, value, None)?;
            let has_value = summary.kind != "undefined";
            return Ok(object! {
                "type": summary.kind,
                "value" => primitive_to_json(cx, value)?.filter(|_| has_value),
                "subtype" => summary.subtype.map(Subtype::name),
                "description" => summary.description,
            });
        }
        let id = self.registry.bind(value, group);
        let summary = self.summarize(cx, value, text)?;
        let mut class_name = value.to_object(cx)?.calculated_class_name(cx);
        let mut class_prototype = None;
        if summary.subtype == Some(Subtype::Class) {
            let prototype = value.get(cx, names::prototype)?;
            class_prototype = Some(self.wrap(cx, prototype, group, Detail::None)?);
            if let Some(name) = value.get(cx, names::name)?.as_string() {
                class_name = name.to_string_ref(cx)?;
            }
        }
        let preview = match detail {
            _ if summary.kind != "object" => None,
            Detail::None => None,
            Detail::Preview => Some(self.preview_content(cx, value, &summary, Role::Ordinary)?),
            Detail::Table => Some(self.preview_content(cx, value, &summary, Role::Table)?),
        };
        Ok(object! {
            "type": summary.kind,
            "objectId": self.registry.id_text(id),
            "subtype" => summary.subtype.map(Subtype::name),
            "className": class_name,
            "description" => summary.description,
            "size" => summary.size,
            "classPrototype" => class_prototype,
            "preview" => preview.map(|it| it.into_json()),
        })
    }

    /// What cannot be described comes as a string that says why. Fails only if execution ends.
    pub(crate) fn wrap_with_text(
        self,
        cx: &mut Cx,
        value: Value,
        group: &StringRef,
        detail: Detail,
        text: Option<&StringRef>,
    ) -> JsResult<Object> {
        let result = self.try_wrap(cx, as_value_of_language(value), group, detail, text);
        let error = match attempt(cx, result)? {
            Ok(object) => return Ok(object),
            Err(error) => error,
        };
        if is_plain(cx, error) {
            return Ok(object! { "type": "object", "value": Json::Null, "subtype": "null" });
        }
        let subtype = self.subtype(cx, error);
        let description = subtype.and_then(|subtype| self.describe(cx, error, subtype, None));
        let description = attempt(cx, description)?
            .unwrap_or_else(|_| StringRef::from_literal("<failed to convert exception to string>"));
        Ok(object! { "type": "string", "value": description })
    }

    pub(crate) fn wrap(
        self,
        cx: &mut Cx,
        value: Value,
        group: &StringRef,
        detail: Detail,
    ) -> JsResult<Object> {
        self.wrap_with_text(cx, value, group, detail, None)
    }
}
