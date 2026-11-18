//! What scripts cannot enumerate.

use bun_engine_bytecode::{FunctionKind, Origin, ScopeKind, SlotFlags, SlotKind};
use bun_engine_text::{Identifier, StringRef, names};
use bun_engine_vm::{
    Attributes, CellType, Cx, Environment, Gc, IterationKind, JsArrayIterator, JsBoundFunction,
    JsCell, JsFinalizationRegistry, JsFunction, JsMap, JsMapIterator, JsObject, JsPromise,
    JsRemoteFunction, JsResult, JsSet, JsSetIterator, JsString, JsStringIterator, JsWeakMap,
    JsWeakRef, JsWeakSet, PromiseStatus, ProxyObject, Registration, RootVec, Value, ValueVec,
    root_vec,
};

use super::object::{Detail, Subtype, kind_of, to_text};
use super::properties::{Content, Property};
use super::{MAX_LISTED, Remote};
use crate::debugger::Location;
use crate::protocol::{Object, object};

fn environments(scope: Gc<JsCell>) -> impl Iterator<Item = Gc<Environment>> {
    let first = scope.downcast::<Environment>();
    first.into_iter().flat_map(|first| first.chain())
}

fn name_of_kind(cx: &Cx, kind: IterationKind) -> Value {
    let name = match kind {
        IterationKind::Keys => names::keys,
        IterationKind::Values => names::values,
        IterationKind::Entries => names::entries,
    };
    Value::from_name(cx, name)
}

fn registrations(cx: &Cx, all: &[Registration], are_live: bool) -> JsResult<Value> {
    let mut objects = ValueVec::new();
    for registration in all.iter().filter(|it| it.target.is_some() == are_live) {
        let object = cx.new_object();
        for (name, value) in [
            ("target", registration.target.map(Value::from)),
            ("heldValue", Some(registration.held_value)),
            (
                "unregisterToken",
                registration.unregister_token.map(Value::from),
            ),
        ] {
            if let Some(value) = value {
                let name = Identifier::from_literal(name);
                object.put_direct(cx, name.name(), value, Attributes::NONE);
            }
        }
        objects.push(object.into());
    }
    cx.new_array_from(&objects).map(Value::from)
}

fn is_arrow(function: Gc<JsFunction>) -> bool {
    function.script_executable().is_some_and(|it| {
        it.info().kind() == FunctionKind::Arrow && !it.info().is_async() && !it.is_builtin()
    })
}

fn for_each_builtin_internal(
    cx: &Cx,
    value: Value,
    mut add: impl FnMut(&'static str, Value),
) -> JsResult<()> {
    if let Some(promise) = value.downcast::<JsPromise>() {
        let status = match promise.status() {
            PromiseStatus::Pending => "pending",
            PromiseStatus::Fulfilled => "fulfilled",
            PromiseStatus::Rejected => "rejected",
        };
        add("status", JsString::from_literal(cx, status).into());
        if !promise.is_pending() {
            add("result", promise.result());
        }
    } else if let Some(bound) = value.downcast::<JsBoundFunction>() {
        add("targetFunction", bound.target_function().into());
        add("boundThis", bound.bound_this());
        if bound.argument_count() != 0 {
            let mut arguments = ValueVec::new();
            bound.for_each_argument(|argument| arguments.push(argument));
            add("boundArgs", cx.new_array_from(&arguments)?.into());
        }
    } else if let Some(remote) = value.downcast::<JsRemoteFunction>() {
        add("targetFunction", remote.target_function().into());
    } else if let Some(arrow) = value.downcast::<JsFunction>().filter(|&it| is_arrow(it)) {
        let this = environments(arrow.scope())
            .find_map(|it| Some(it.get(it.template().scope().this_slot()?)));
        add("boundThis", this.flatten().unwrap_or_default());
    } else if let Some(proxy) = value.downcast::<ProxyObject>() {
        add("target", proxy.target().into());
        add("handler", proxy.handler().map_or(Value::NULL, Value::from));
    } else if let Some(reference) = value.downcast::<JsWeakRef>() {
        let target = reference.deref_target(cx);
        add("target", target.map_or_default(Value::from));
    } else if let Some(registry) = value.downcast::<JsFinalizationRegistry>() {
        let all = registry.snapshot(cx);
        add("cleanupCallback", registry.callback().into());
        add("live", registrations(cx, &all, true)?);
        add("dead", registrations(cx, &all, false)?);
    } else if let Some(iterator) = value.downcast::<JsArrayIterator>() {
        add("array", iterator.iterated_object().into());
        add("kind", name_of_kind(cx, iterator.kind()));
    } else if let Some(iterator) = value.downcast::<JsMapIterator>() {
        add("map", iterator.iterated_object().into());
        add("kind", name_of_kind(cx, iterator.kind()));
    } else if let Some(iterator) = value.downcast::<JsSetIterator>() {
        add("set", iterator.iterated_object().into());
        add("kind", name_of_kind(cx, iterator.kind()));
    } else if let Some(iterator) = value.downcast::<JsStringIterator>() {
        add("string", iterator.iterated_string().into());
    }
    Ok(())
}

/// The key, if it has one, and the value.
type Entry = (Option<Value>, Value);

/// What the iterator would yield. `None` if that takes more than reading a list.
fn upcoming(cx: &mut Cx, iterator: Value, limit: usize) -> JsResult<Option<RootVec<Entry>>> {
    fn collect(
        limit: usize,
        mut next: impl FnMut() -> JsResult<Option<Value>>,
    ) -> JsResult<Option<RootVec<Entry>>> {
        let mut entries = root_vec();
        while entries.len() < limit
            && let Some(value) = next()?
        {
            entries.push((None, value));
        }
        Ok(Some(entries))
    }
    if let Some(iterator) = iterator.downcast::<JsMapIterator>() {
        let copy = iterator.duplicate(cx);
        return collect(limit, || copy.next(cx));
    }
    if let Some(iterator) = iterator.downcast::<JsSetIterator>() {
        let copy = iterator.duplicate(cx);
        return collect(limit, || copy.next(cx));
    }
    if let Some(iterator) = iterator.downcast::<JsStringIterator>() {
        let copy = iterator.duplicate(cx);
        return collect(limit, || Ok(copy.next(cx)?.map(Value::from)));
    }
    let Some(iterator) = iterator.downcast::<JsArrayIterator>() else {
        return Ok(None);
    };
    let list = iterator.iterated_object();
    if !matches!(list.cell_type(), CellType::Array | CellType::DerivedArray)
        && !CellType::ARGUMENTS.contains(list.cell_type())
    {
        return Ok(None);
    }
    let copy = JsArrayIterator::create(cx, list, iterator.kind());
    copy.set_index(iterator.index());
    collect(limit, || copy.next(cx))
}

impl Remote<'_> {
    pub(super) fn internal_properties(
        self,
        cx: &mut Cx,
        value: Value,
    ) -> JsResult<RootVec<Property>> {
        let mut properties = root_vec();
        let Some(list) = self.controller.host.internal_properties(cx, value)? else {
            for_each_builtin_internal(cx, value, |name, value| {
                properties.push(Property::internal(StringRef::from_literal(name), value));
            })?;
            return Ok(properties);
        };
        let list = list.to_object(cx)?;
        for index in 0..list.length_of_array_like(cx)? {
            let property = list.get_index(cx, index)?;
            let name = property.get(cx, names::name)?;
            let value = property.get(cx, names::value)?;
            properties.push(Property::internal(to_text(cx, name)?, value));
        }
        Ok(properties)
    }

    /// Only ordered collections have a `start`.
    pub(super) fn entries(
        cx: &mut Cx,
        value: Value,
        subtype: Subtype,
        start: usize,
        limit: usize,
    ) -> JsResult<Option<RootVec<Entry>>> {
        let with_key = |(key, value)| (Some(key), value);
        let without_key = |value| (None, value);
        let mut entries = root_vec();
        if subtype == Subtype::Iterator {
            return upcoming(cx, value, limit);
        }
        let no_gc = cx.no_gc();
        if let Some(map) = value.downcast::<JsMap>() {
            entries.extend(map.items(&no_gc).skip(start).take(limit).map(with_key));
        } else if let Some(set) = value.downcast::<JsSet>() {
            entries.extend(set.items(&no_gc).skip(start).take(limit).map(without_key));
        } else if let Some(map) = value.downcast::<JsWeakMap>() {
            entries.extend(map.items(&no_gc).take(limit).map(with_key));
        } else if let Some(set) = value.downcast::<JsWeakSet>() {
            entries.extend(set.items(&no_gc).take(limit).map(without_key));
        } else {
            return Ok(None);
        }
        Ok(Some(entries))
    }

    /// `Runtime.CollectionEntry` for each. A `count` of zero asks for all. `None` if there is no such collection.
    pub(crate) fn collection_entries(
        self,
        cx: &mut Cx,
        id: Option<u32>,
        group: Option<StringRef>,
        (start, count): (usize, usize),
    ) -> JsResult<Option<Vec<Object>>> {
        /// What it goes over may grow meanwhile.
        const MAX_UPCOMING: usize = 1000;
        let value = self.registry.find(id);
        let Some(value) = value.filter(|&it| kind_of(cx, it) == "object") else {
            return Ok(None);
        };
        let Some(subtype) = self.subtype(cx, value)? else {
            return Ok(None);
        };
        let limit = match (count, subtype) {
            (0, Subtype::Iterator) => MAX_UPCOMING,
            (0, _) => MAX_LISTED,
            _ => count.min(MAX_LISTED),
        };
        let Some(entries) = Self::entries(cx, value, subtype, start, limit)? else {
            return Ok(None);
        };
        let group = group.filter(|it| !it.is_empty());
        let group = group.unwrap_or_else(|| self.registry.group_of(id));
        let mut wrapped = Vec::new();
        for &(key, value) in &entries {
            let value = self.wrap(cx, value, &group, Detail::Preview)?;
            let key = key.map(|key| self.wrap(cx, key, &group, Detail::Preview));
            wrapped.push(object! { "key" => key.transpose()?, "value": value });
        }
        Ok(Some(wrapped))
    }
}

fn add_private_methods(
    class: Gc<Environment>,
    are_static: bool,
    is_own: bool,
    out: &mut RootVec<Property>,
) {
    let (template, first) = (class.template(), out.len());
    for slot in template.scope().slots() {
        if slot.flags.contains(SlotFlags::STATIC) != are_static {
            continue;
        }
        let at = |offset| class.get(slot.index + offset).unwrap_or_default();
        let content = match slot.kind {
            SlotKind::PrivateMethod => Content::Value(at(0)),
            SlotKind::PrivateAccessor => Content::Accessor {
                getter: at(0),
                setter: at(1),
            },
            _ => continue,
        };
        let name = StringRef::from_text(template.scope().text_of(slot));
        out.push(Property::private_method(name, content, is_own));
    }
    out[first..].sort_unstable_by(|a, b| a.name.text().cmp(&b.name.text()));
}

fn classes_around(function: Gc<JsFunction>) -> impl Iterator<Item = Gc<Environment>> {
    environments(function.scope()).filter(|it| it.template().scope().kind() == ScopeKind::Class)
}

fn add_static_methods(constructor: Gc<JsFunction>, out: &mut RootVec<Property>) {
    let class = classes_around(constructor).find(|class| {
        let brand = class.template().scope().static_brand_slot();
        brand.and_then(|slot| class.get(slot)) == Some(constructor.into())
    });
    if let Some(class) = class {
        add_private_methods(class, true, true, out);
    }
}

fn constructor_of(prototype: &JsObject) -> Option<Gc<JsFunction>> {
    prototype.get_direct(names::constructor)?.downcast()
}

/// They are in the scope of the class. Those that are static are not inherited, and show on the prototype too.
pub(super) fn private_methods(object: Gc<JsObject>, is_own: bool) -> RootVec<Property> {
    let mut methods = root_vec();
    if is_own {
        if let Some(function) = object.downcast::<JsFunction>() {
            add_static_methods(function, &mut methods);
            return methods;
        }
        if let Some(constructor) = constructor_of(&object)
            && constructor.get_direct(names::prototype) == Some(object.into())
        {
            add_static_methods(constructor, &mut methods);
        }
    }
    let mut classes = root_vec();
    let constructors = object.chain_direct().skip(1);
    for class in (constructors.filter_map(|it| constructor_of(&it))).flat_map(classes_around) {
        let brand = class.template().scope().brand_slot();
        let brand = brand.and_then(|slot| class.get(slot)?.as_symbol());
        if brand.is_some_and(|it| object.has_private_element(it.name()))
            && !classes.contains(&class)
        {
            classes.push(class);
        }
    }
    for &class in classes.iter().rev() {
        add_private_methods(class, false, is_own, &mut methods);
    }
    methods
}

/// `Debugger.FunctionDetails`. `None` if it has no source.
pub(crate) fn function_details(function: Gc<JsFunction>) -> Option<Object> {
    let chain = core::iter::successors(Some(function), |it| {
        (it.downcast::<JsBoundFunction>()?.target_function()).downcast()
    });
    let executable = chain.last()?.script_executable()?;
    let info = executable.info();
    if executable.is_builtin() {
        return None;
    }
    let start = match info.origin().contains(Origin::DEFAULT_CONSTRUCTOR) {
        true => info.text_range().start,
        false => info.parameters_start(),
    };
    let display_name = (function.get_direct(names::displayName)).and_then(Value::as_string);
    let display_name = display_name.map(|it| it.to_string_without_resolving());
    Some(object! {
        "location": Location::of(executable.provider(), start).to_json(),
        "name" => Some(function.name()).filter(|it| !it.is_empty()),
        "displayName" => display_name.filter(|it| !it.is_empty()),
    })
}
