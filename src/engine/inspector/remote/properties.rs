//! `Runtime.PropertyDescriptor`

use core::ops::ControlFlow::{self, Break, Continue};

use bun_engine_text::{Identifier, PropertyName, StringRef, Text, names};
use bun_engine_vm::{
    Cx, DontEnumMode, FastHashSet, Gc, JsFunction, JsObject, JsPromise, JsResult,
    PropertyDescriptor, PropertyNameMode, Value,
};

use super::internals::private_methods;
use super::object::{Detail, Subtype, is_finite, is_plain, to_text};
use super::{MAX_LISTED, Remote, attempt};
use crate::protocol::{Object, object};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Selection {
    Own,
    All,
    /// Own properties, and what native getters on the prototype chain return.
    Displayable,
    /// All, with what native getters return.
    Preview,
}

impl Selection {
    fn calls_native_getters(self) -> bool {
        matches!(self, Selection::Displayable | Selection::Preview)
    }

    fn includes(self, is_own: bool, has_native_getter: bool) -> bool {
        match self {
            Selection::All | Selection::Preview => true,
            Selection::Own => is_own,
            Selection::Displayable => is_own || has_native_getter,
        }
    }
}

#[derive(Clone, Copy)]
pub(super) enum Content {
    Value(Value),
    Accessor { getter: Value, setter: Value },
}

pub(super) struct Property {
    pub(super) name: StringRef,
    pub(super) content: Content,
    symbol: Option<Value>,
    writable: Option<bool>,
    enumerable: Option<bool>,
    configurable: Option<bool>,
    pub(super) is_own: bool,
    pub(super) is_private: bool,
    pub(super) is_internal: bool,
    pub(super) is_native_getter: bool,
    pub(super) was_thrown: bool,
}

impl Property {
    fn new(name: StringRef, content: Content, is_own: bool) -> Property {
        Property {
            name,
            content,
            symbol: None,
            writable: None,
            enumerable: None,
            configurable: None,
            is_own,
            is_private: false,
            is_internal: false,
            is_native_getter: false,
            was_thrown: false,
        }
    }

    pub(super) fn internal(name: StringRef, value: Value) -> Property {
        Property {
            is_internal: true,
            ..Property::new(name, Content::Value(value), true)
        }
    }

    pub(super) fn private_method(name: StringRef, content: Content, is_own: bool) -> Property {
        Property {
            is_private: true,
            ..Property::new(name, content, is_own)
        }
    }

    pub(super) fn is_enumerable(&self) -> bool {
        self.enumerable == Some(true)
    }
}

type Visit<'a> = &'a mut dyn FnMut(&mut Cx, &Property) -> JsResult<ControlFlow<()>>;

struct Walk<'a> {
    object: Gc<JsObject>,
    selection: Selection,
    /// Those of functions and prototypes need an instance, or are there to throw.
    is_fit_for_native_getters: bool,
    seen: FastHashSet<Identifier>,
    visit: Visit<'a>,
}

fn own_value(cx: &mut Cx, object: &JsObject, name: PropertyName<'_>) -> JsResult<Option<Value>> {
    Ok((object.get_own_property_descriptor(cx, name)?).and_then(|it| it.value()))
}

fn is_prototype(cx: &mut Cx, object: Gc<JsObject>) -> JsResult<bool> {
    let constructor = own_value(cx, &object, names::constructor)?.and_then(Value::as_object);
    match constructor.filter(|it| it.is_callable()) {
        Some(it) => Ok(own_value(cx, &it, names::prototype)? == Some(object.into())),
        None => Ok(false),
    }
}

fn has_native_getter(cx: &Cx, descriptor: &PropertyDescriptor) -> JsResult<bool> {
    let Some(getter) = descriptor.getter_object() else {
        return Ok(descriptor.is_accessor() && descriptor.setter_object().is_none());
    };
    let Some(function) = getter.downcast::<JsFunction>() else {
        return Ok(true);
    };
    let text = function.source_text(cx)?.view(cx)?;
    Ok((text.text()).ends_with(Text::from_ascii("[native code] }")))
}

macro_rules! go_on {
    ($flow:expr) => {
        if $flow?.is_break() {
            return Ok(Break(()));
        }
    };
}

impl Walk<'_> {
    fn offer(
        &mut self,
        cx: &mut Cx,
        property: &Property,
        has_native_getter: bool,
    ) -> JsResult<ControlFlow<()>> {
        if self.selection.includes(property.is_own, has_native_getter) {
            return (self.visit)(cx, property);
        }
        Ok(Continue(()))
    }

    fn property(
        &mut self,
        cx: &mut Cx,
        holder: Gc<JsObject>,
        name: PropertyName<'_>,
    ) -> JsResult<ControlFlow<()>> {
        if !self.seen.insert(name.to_identifier()) {
            return Ok(Continue(()));
        }
        cx.check_traps()?;
        let symbol = (name.is_symbol()).then(|| Value::from_name(cx, name));
        let text = match symbol {
            Some(symbol) => to_text(cx, symbol)?,
            None => StringRef::retain(name.string()),
        };
        let unknown = Content::Value(Value::UNDEFINED);
        let mut property = Property::new(text, unknown, holder == self.object);
        property.symbol = symbol;
        let Some(descriptor) = holder.get_own_property_descriptor(cx, name)? else {
            let result = self.object.get(cx, name);
            let result = attempt(cx, result)?;
            property.was_thrown = result.is_err();
            property.content = Content::Value(result.unwrap_or_else(|thrown| thrown));
            return self.offer(cx, &property, false);
        };
        let is_native =
            self.selection.calls_native_getters() && has_native_getter(cx, &descriptor)?;
        if is_native && self.is_fit_for_native_getters {
            let result = self.object.get(cx, name);
            if let Ok(value) = attempt(cx, result)? {
                silence_rejection_of_receiver(value);
                property.content = Content::Value(value);
                property.enumerable = descriptor.enumerable().then_some(true);
                property.configurable = descriptor.configurable().then_some(true);
                property.is_native_getter = true;
                return self.offer(cx, &property, true);
            }
        }
        describe(&mut property, &descriptor);
        self.offer(cx, &property, is_native)
    }

    fn private_elements(&mut self, cx: &mut Cx, holder: Gc<JsObject>) -> JsResult<ControlFlow<()>> {
        let is_own = holder == self.object;
        for (name, ..) in holder.shape().properties().iter() {
            if name.is_private()
                && name.text().starts_with(Text::from_ascii("#"))
                && let Some((value, attributes)) = holder.get_direct_with_attributes(name)
            {
                let text = StringRef::from_text(name.text());
                let mut property = Property::new(text, Content::Value(value), is_own);
                describe(&mut property, &PropertyDescriptor::data(value, attributes));
                property.is_private = true;
                go_on!(self.offer(cx, &property, false));
            }
        }
        for method in private_methods(holder, is_own).iter() {
            go_on!(self.offer(cx, method, false));
        }
        Ok(Continue(()))
    }

    /// In place of all names, which are not made for the many that nobody asks for.
    fn elements(&mut self, cx: &mut Cx) -> JsResult<ControlFlow<()>> {
        const MAX_HOLES: u32 = 1 << 12;
        let (object, mut holes) = (self.object, 0);
        for index in 0..u32::MAX {
            if f64::from(index) >= object.get(cx, names::length)?.to_number(cx)? {
                break;
            }
            if object.has_index(cx, index.into())? {
                go_on!(self.property(cx, object, Identifier::from_index(index).name()));
                continue;
            }
            holes += 1;
            if holes > MAX_HOLES {
                let names =
                    object.own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Include)?;
                for name in names.iter().filter(|it| it.name().as_index().is_some()) {
                    go_on!(self.property(cx, object, name.name()));
                }
                break;
            }
        }
        Ok(Continue(()))
    }

    fn named(
        &mut self,
        cx: &mut Cx,
        holder: Gc<JsObject>,
        kind: PropertyNameMode,
    ) -> JsResult<ControlFlow<()>> {
        for name in holder.own_keys(cx, kind, DontEnumMode::Include)?.iter() {
            go_on!(self.property(cx, holder, name.name()));
        }
        Ok(Continue(()))
    }

    fn chain(&mut self, cx: &mut Cx, has_elements: bool) -> JsResult<ControlFlow<()>> {
        let mut holder = self.object;
        for _ in 0..JsObject::MAX_PROTOTYPE_CHAIN_DEPTH {
            go_on!(self.private_elements(cx, holder));
            if has_elements && holder == self.object {
                go_on!(self.elements(cx));
            } else {
                go_on!(self.named(cx, holder, PropertyNameMode::Strings));
            }
            go_on!(self.named(cx, holder, PropertyNameMode::Symbols));
            if self.selection == Selection::Own {
                break;
            }
            match holder.get_prototype_of(cx)?.as_object() {
                Some(prototype) => holder = prototype,
                None => break,
            }
        }
        Ok(Continue(()))
    }
}

fn describe(property: &mut Property, descriptor: &PropertyDescriptor) {
    property.enumerable = Some(descriptor.enumerable());
    property.configurable = Some(descriptor.configurable());
    if descriptor.is_accessor() {
        property.content = Content::Accessor {
            getter: descriptor.getter().unwrap_or_default(),
            setter: descriptor.setter().unwrap_or_default(),
        };
    } else {
        property.content = Content::Value(descriptor.value().unwrap_or_default());
        property.writable = Some(descriptor.writable());
    }
}

/// A getter that returns promises refuses a receiver by rejecting.
fn silence_rejection_of_receiver(value: Value) {
    if let Some(promise) = value.downcast::<JsPromise>()
        && let Some(error) = promise.result().downcast::<bun_engine_vm::ErrorInstance>()
        && error.is_native_getter_type_error()
    {
        promise.mark_as_handled();
    }
}

fn has_positive_length(cx: &mut Cx, object: &JsObject) -> JsResult<bool> {
    let length = object.get(cx, names::length)?;
    Ok(is_finite(cx, length)? && length.to_number(cx)? > 0.0)
}

impl Remote<'_> {
    /// `__proto__` comes last, also if `visit` has had enough.
    pub(super) fn for_each_property(
        self,
        cx: &mut Cx,
        object: Gc<JsObject>,
        selection: Selection,
        includes_prototype: bool,
        visit: Visit<'_>,
    ) -> JsResult<()> {
        let subtype = self.subtype(cx, object.into())?;
        if let Some(Subtype::Proxy | Subtype::WeakRef) = subtype {
            return Ok(());
        }
        let mut walk = Walk {
            object,
            selection,
            is_fit_for_native_getters: selection.calls_native_getters()
                && !object.is_callable()
                && !is_prototype(cx, object)?,
            seen: FastHashSet::default(),
            visit,
        };
        walk.seen.insert(names::__proto__.to_identifier());
        let has_elements = subtype == Some(Subtype::Array) && {
            let result = has_positive_length(cx, &object);
            attempt(cx, result)?.unwrap_or(false)
        };
        let _ = walk.chain(cx, has_elements)?;
        if includes_prototype {
            let result = Self::visit_prototype(cx, object, walk.visit);
            let _ = attempt(cx, result)?;
        }
        Ok(())
    }

    fn visit_prototype(cx: &mut Cx, object: Gc<JsObject>, visit: Visit<'_>) -> JsResult<()> {
        let prototype = object.get(cx, names::__proto__)?;
        if prototype.to_boolean(cx) {
            let name = StringRef::retain(names::__proto__.string());
            let mut property = Property::new(name, Content::Value(prototype), true);
            (property.writable, property.configurable) = (Some(true), Some(true));
            let _ = visit(cx, &property)?;
        }
        Ok(())
    }

    fn wrap_property(
        self,
        cx: &mut Cx,
        property: &Property,
        group: &StringRef,
        detail: Detail,
    ) -> JsResult<Object> {
        let mut json = object! { "name": &property.name };
        match property.content {
            Content::Value(value) => json.add("value", self.wrap(cx, value, group, detail)?),
            Content::Accessor { getter, setter } => {
                json.add("get", self.wrap(cx, getter, group, Detail::None)?);
                json.add("set", self.wrap(cx, setter, group, Detail::None)?);
            }
        }
        if property.is_internal {
            return Ok(json);
        }
        json.add_if_any("writable", property.writable);
        json.add_if_any("enumerable", property.enumerable);
        json.add_if_any("configurable", property.configurable);
        json.add_if_true("wasThrown", property.was_thrown);
        json.add_if_true("nativeGetter", property.is_native_getter);
        json.add_if_true("isOwn", property.is_own);
        if let Some(symbol) = property.symbol {
            json.add("symbol", self.wrap(cx, symbol, group, Detail::None)?);
        }
        json.add_if_true("isPrivate", property.is_private);
        Ok(json)
    }

    /// The result of `Runtime.getProperties`. A `count` of zero asks for all. `None` if there is no such object.
    pub(crate) fn properties(
        self,
        cx: &mut Cx,
        id: Option<u32>,
        selection: Selection,
        (start, count): (usize, usize),
        detail: Detail,
    ) -> JsResult<Option<Object>> {
        let object = self.registry.find(id).and_then(Value::as_object);
        let Some(object) = object.filter(|&it| !is_plain(cx, it.into())) else {
            return Ok(None);
        };
        let group = self.registry.group_of(id);
        let (mut properties, mut to_skip) = (Vec::new(), start);
        let limit = if count == 0 {
            MAX_LISTED
        } else {
            count.min(MAX_LISTED)
        };
        self.for_each_property(cx, object, selection, start == 0, &mut |cx, property| {
            if let Some(rest) = to_skip.checked_sub(1) {
                to_skip = rest;
                return Ok(Continue(()));
            }
            properties.push(self.wrap_property(cx, property, &group, detail)?);
            Ok(match properties.len() >= limit {
                true => Break(()),
                false => Continue(()),
            })
        })?;
        let mut internal = Vec::new();
        if start == 0 {
            let result = self.internal_properties(cx, object.into());
            for property in attempt(cx, result)?.iter().flatten() {
                internal.push(self.wrap_property(cx, property, &group, detail)?);
            }
        }
        Ok(Some(object! {
            "properties": properties,
            "internalProperties" => (!internal.is_empty()).then_some(internal),
        }))
    }
}
