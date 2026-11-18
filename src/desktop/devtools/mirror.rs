//! Values, as the domain `Runtime` describes them.

use std::rc::Rc;

use bun_jsc::{Strong, from_js_host_call};
use bun_ui::dom;

use super::runtime::{Context, Runtime};
use super::{Failure, Outcome};
use crate::prelude::*;
use crate::realm::Realm;
use crate::renderer::preload::has_node;
use crate::value::{Value, number_to_string, quote};

#[repr(C)]
#[derive(Clone, Copy)]
struct Wanted {
    own_only: bool,
    accessors_only: bool,
    skips_indices: bool,
    most: u32,
}

#[derive(Clone, Copy)]
struct Traits(i32);

#[derive(Clone, Copy)]
enum Trait {
    Enumerable = 1,
    Configurable = 2,
    Writable = 4,
    Own = 8,
    HasValue = 16,
    Accessor = 32,
    Thrown = 64,
    Private = 128,
    Index = 256,
}

impl Traits {
    fn has(self, it: Trait) -> bool {
        self.0 & it as i32 != 0
    }
}

unsafe extern "C" {
    safe fn Bun__Inspector__describe(
        realm: &Realm,
        object: JSValue,
        texts: &mut [bun_core::String; 3],
    );
    safe fn Bun__Inspector__properties(realm: &Realm, object: JSValue, wanted: Wanted) -> JSValue;
    safe fn Bun__Inspector__slots(realm: &Realm, object: JSValue) -> JSValue;
    safe fn Bun__Inspector__entries(realm: &Realm, object: JSValue, most: u32) -> JSValue;
    safe fn Bun__IsolatedWorld__isShared(object: JSValue) -> bool;
    safe fn Bun__IsolatedWorld__mayHold(realm: &Realm, value: JSValue, has_node: bool) -> bool;
    safe fn Bun__Inspector__placeOfFunction(function: JSValue, place: &mut [u32; 3]) -> bool;
}

/// What the inspector has made an object for.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Role {
    Itself,
    Entries,
    Entry,
    Scope,
}

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Form {
    Reference,
    Preview,
    Table,
    Copy,
}

impl Form {
    pub(super) fn asked_for(params: &Value) -> Form {
        match () {
            () if params["returnByValue"].is_truthy() => Form::Copy,
            () if params["generatePreview"].is_truthy() => Form::Preview,
            () => Form::Reference,
        }
    }
}

struct Object {
    id: u32,
    value: Strong,
    context: Context,
    group: Rc<str>,
    role: Role,
}

pub(super) struct Objects {
    document: u32,
    all: RefCell<Vec<Object>>,
    last: Cell<u32>,
}

pub(super) struct Found {
    pub(super) value: JSValue,
    pub(super) context: Context,
    pub(super) group: Rc<str>,
    role: Role,
}

impl Objects {
    pub(super) fn new(document: u32) -> Objects {
        Objects {
            document,
            all: RefCell::default(),
            last: Cell::default(),
        }
    }

    fn position(&self, objects: &[Object], id: &Value) -> Option<usize> {
        let (document, id) = crate::text::split_once(id.text(), ".")?;
        let id = (id.parse().ok()).filter(|_| document.parse() == Ok(self.document))?;
        objects.binary_search_by_key(&id, |it| it.id).ok()
    }

    fn add(&self, value: JSValue, context: &Context, group: &Rc<str>, role: Role) -> String {
        self.last.update(|it| it + 1);
        self.all.borrow_mut().push(Object {
            id: self.last.get(),
            value: keep(value),
            context: context.clone(),
            group: Rc::clone(group),
            role,
        });
        format!("{}.{}", self.document, self.last.get())
    }

    pub(super) fn find(&self, id: &Value) -> Result<Found, Failure> {
        let all = self.all.borrow();
        let found = self.position(&all, id).map(|at| &all[at]);
        let found = found.ok_or("Could not find object with given id")?;
        Ok(Found {
            value: found.value.get(),
            context: found.context.clone(),
            group: Rc::clone(&found.group),
            role: found.role,
        })
    }

    pub(super) fn find_for_scripts(&self, id: &Value) -> Result<Found, Failure> {
        let found = Some(self.find(id)?).filter(|it| it.role != Role::Scope);
        Ok(found.ok_or("A scope is not a value")?)
    }

    pub(super) fn release(&self, id: &Value) {
        let mut all = self.all.borrow_mut();
        if let Some(at) = self.position(&all, id) {
            all.remove(at);
        }
    }

    pub(super) fn release_group(&self, group: &str) {
        self.all.borrow_mut().retain(|it| *it.group != *group);
    }

    pub(super) fn release_all(&self) {
        self.all.take();
    }
}

pub(super) fn text_in(realm: &Realm, value: JSValue) -> JsResult<String> {
    Ok(string(&value.to_utf8(realm)?))
}

fn by_json(realm: &Realm, value: JSValue) -> JsResult<Value> {
    let json = value.json_stringify_fast(realm)?;
    Ok(Value::parse(&json.to_utf8()).unwrap_or_default())
}

fn describe_symbol(symbol: JSValue) -> String {
    let description = symbol.get_description(global());
    format!("Symbol({})", string(&description.to_utf8()))
}

fn abbreviate(mut text: String) -> String {
    if let Some((at, _)) = text.char_indices().nth(99) {
        text.truncate(at);
        text.push('…');
    }
    text
}

struct About {
    kind: String,
    subtype: Option<String>,
    class: Option<String>,
    description: String,
}

impl About {
    fn is(&self, subtype: &str) -> bool {
        self.subtype.as_deref() == Some(subtype)
    }
}

fn primitive(realm: &Realm, value: JSValue, about: About) -> JsResult<Value> {
    let is_odd = |it: f64| !it.is_finite() || (it == 0. && it.is_sign_negative());
    let remote = record! { "type": &*about.kind, "subtype": about.subtype };
    Ok(match &*about.kind {
        "undefined" => remote,
        "object" => remote.with("value", Value::Null),
        "string" | "boolean" => remote.with("value", by_json(realm, value)?),
        _ => match value.get_number().filter(|it| !is_odd(*it)) {
            Some(number) => remote.with("value", number),
            None => remote.with("unserializableValue", &*about.description),
        }
        .with("description", about.description),
    })
}

/// The script, the line and the column, or zeros.
pub(super) fn place_of_function(function: JSValue) -> [u32; 3] {
    let mut place = [0; 3];
    Bun__Inspector__placeOfFunction(function, &mut place);
    place
}

fn location([script, line, column]: [u32; 3]) -> Value {
    record! {
        "type": "object",
        "subtype": "internal#location",
        "description": "Object",
        "value": record! { "scriptId": script.to_string(), "lineNumber": line, "columnNumber": column },
    }
}

fn each_property<T>(
    realm: &Realm,
    object: JSValue,
    wanted: Wanted,
    mut visit: impl FnMut(String, Traits, &[JSValue; 5]) -> JsResult<Option<T>>,
) -> JsResult<Vec<T>> {
    let all = from_js_host_call(realm, || Bun__Inspector__properties(realm, object, wanted))?;
    with_elements(all, |all| {
        let mut visited = Vec::new();
        for it in all.as_chunks::<5>().0 {
            let name = match it[0].is_symbol() {
                true => describe_symbol(it[0]),
                false => text_of(it[0])?,
            };
            visited.extend(visit(name, Traits(it[1].to_int32()), it)?);
        }
        Ok(visited)
    })
}

fn each_slot<T>(
    realm: &Realm,
    object: JSValue,
    mut visit: impl FnMut(String, JSValue) -> JsResult<Option<T>>,
) -> JsResult<Vec<T>> {
    let all = from_js_host_call(realm, || Bun__Inspector__slots(realm, object))?;
    with_elements(all, |all| {
        let mut visited = Vec::new();
        for [name, value] in all.as_chunks().0 {
            visited.extend(visit(text_of(*name)?, *value)?);
        }
        Ok(visited)
    })
}

fn entries_of(realm: &Realm, object: JSValue, most: u32) -> JsResult<Option<JSValue>> {
    let all = from_js_host_call(realm, || Bun__Inspector__entries(realm, object, most))?;
    Ok(Some(all).filter(|it| it.is_object()))
}

impl Runtime {
    fn about(&self, value: JSValue, context: &Context) -> JsResult<About> {
        let world = self.world(context)?;
        let kind = string(&value.js_type_string(world.realm).to_utf8());
        if !value.is_object() {
            let description = match value.get_number() {
                Some(it) if it == 0. && it.is_sign_negative() => "-0".into(),
                Some(it) => number_to_string(it),
                None if value.is_symbol() => describe_symbol(value),
                None if kind == "bigint" => text_in(world.realm, value)? + "n",
                None => text_in(world.realm, value)?,
            };
            return Ok(About {
                kind,
                subtype: value.is_null().then(|| "null".into()),
                class: None,
                description,
            });
        }
        let mut texts = Default::default();
        Bun__Inspector__describe(world.realm, value, &mut texts);
        let [subtype, class, description] = texts.map(|it| string(&it.to_utf8()));
        let node = match subtype.is_empty() && Bun__IsolatedWorld__isShared(value) {
            true => dom::Node(world.carry(value, self.world_numbered(0)?)?).label(),
            false => None,
        };
        Ok(About {
            // `document.all`
            kind: if kind == "undefined" {
                "object".into()
            } else {
                kind
            },
            subtype: match node {
                Some(_) => Some("node".into()),
                None => Some(subtype).filter(|it| !it.is_empty()),
            },
            class: Some(class),
            description: node.unwrap_or(description),
        })
    }

    fn describe_entry(&self, entry: JSValue, context: &Context) -> JsResult<String> {
        let realm = self.world(context)?.realm;
        let part = |it: JSValue| {
            let text = abbreviate(self.about(it, context)?.description);
            JsResult::Ok(if it.is_string() { quote(&text) } else { text })
        };
        let value = part(entry.get(realm, "value")?.unwrap_or(JSValue::UNDEFINED))?;
        Ok(
            match entry.get_own(realm, &bun_core::String::static_("key"))? {
                Some(key) => format!("{{{} => {value}}}", part(key)?),
                None => value,
            },
        )
    }

    pub(super) fn remote(
        &self,
        value: JSValue,
        context: &Context,
        group: &Rc<str>,
        form: Form,
    ) -> JsResult<Value> {
        self.remote_as(Role::Itself, value, context, group, form)
    }

    pub(super) fn remote_as(
        &self,
        role: Role,
        value: JSValue,
        context: &Context,
        group: &Rc<str>,
        form: Form,
    ) -> JsResult<Value> {
        let realm = self.world(context)?.realm;
        if role == Role::Itself && !Bun__IsolatedWorld__mayHold(realm, value, has_node(realm)) {
            return Ok(
                record! { "type": "object", "className": "Object", "description": "Object" },
            );
        }
        if form == Form::Copy && (value.is_object() || value.is_symbol()) {
            let kind = string(&value.js_type_string(global()).to_utf8());
            let copy = match kind == "object" {
                true => by_json(realm, value)?,
                false => Value::empty(),
            };
            return Ok(record! { "type": kind, "value": copy });
        }
        let mut about = self.about(value, context)?;
        if !value.is_object() && !value.is_symbol() {
            return primitive(realm, value, about);
        }
        if role == Role::Scope {
            (about.subtype, about.class) = (None, Some("Object".into()));
            about.description = "Object".into();
        }
        if role == Role::Entry {
            about.subtype = Some("internal#entry".into());
            about.description = self.describe_entry(value, context)?;
        }
        let has_preview = form != Form::Reference && about.kind == "object" && !about.is("node");
        let preview = has_preview.then(|| self.preview(value, &about, context, form, 1));
        Ok(record! {
            "type": about.kind,
            "subtype": about.subtype,
            "className": about.class,
            "description": about.description,
            "objectId": self.objects.add(value, context, group, role),
            "preview": preview.transpose()?,
        })
    }

    fn preview_member(
        &self,
        name: String,
        value: JSValue,
        context: &Context,
        is_row: bool,
    ) -> JsResult<Value> {
        let about = self.about(value, context)?;
        let has_cells = is_row && value.is_object();
        let cells = has_cells.then(|| self.preview(value, &about, context, Form::Table, 0));
        let text = match &*about.kind {
            "function" => String::new(),
            _ => abbreviate(about.description),
        };
        Ok(record! {
            "name": name,
            "type": about.kind,
            "subtype": about.subtype,
            "value": text,
            "valuePreview": cells.transpose()?,
        })
    }

    fn preview_entry(&self, entry: JSValue, context: &Context) -> JsResult<Value> {
        let realm = self.world(context)?.realm;
        let part = |it| self.preview(it, &self.about(it, context)?, context, Form::Preview, 0);
        let key = entry.get_own(realm, &bun_core::String::static_("key"))?;
        let value = entry.get(realm, "value")?.unwrap_or(JSValue::UNDEFINED);
        Ok(record! { "key": key.map(part).transpose()?, "value": part(value)? })
    }

    fn preview(
        &self,
        value: JSValue,
        about: &About,
        context: &Context,
        form: Form,
        depth: u8,
    ) -> JsResult<Value> {
        let preview = record! {
            "type": &*about.kind,
            "subtype": about.subtype.as_deref(),
            "description": abbreviate(about.description.clone()),
        };
        if !value.is_object() || about.kind != "object" || about.is("node") {
            return Ok(preview.with("overflow", false).with("properties", list![]));
        }
        let (realm, is_table) = (self.world(context)?.realm, form == Form::Table);
        let mut room = if is_table { [1000; 2] } else { [5, 100] };
        let (mut overflows, mut target, mut is_wrapper) = (false, value, false);
        let mut members = each_slot(realm, value, |name, it| match &*name {
            "[[Target]]" if it.is_object() => {
                target = it;
                Ok(None)
            }
            "[[PromiseState]]" | "[[PromiseResult]]" | "[[PrimitiveValue]]" => {
                is_wrapper = it.is_string() && name == "[[PrimitiveValue]]";
                self.preview_member(name, it, context, false).map(Some)
            }
            _ => Ok(None),
        })?;
        let left_out: &[&str] = match about.subtype.as_deref() {
            Some("array") => &["length"],
            Some("typedarray") => &["length", "buffer", "byteLength", "byteOffset"],
            Some("map" | "set") => &["size"],
            _ if is_wrapper => &["length"],
            _ => &[],
        };
        let wanted = Wanted {
            own_only: false,
            accessors_only: false,
            skips_indices: is_wrapper,
            most: room[1] + 1,
        };
        members.extend(each_property(realm, target, wanted, |name, traits, it| {
            let room = &mut room[usize::from(traits.has(Trait::Index))];
            if !traits.has(Trait::HasValue)
                || !(traits.has(Trait::Own) || traits.has(Trait::Accessor))
                || traits.has(Trait::Thrown)
                || name == "constructor"
                || left_out.contains(&&*name)
            {
                return Ok(None);
            }
            overflows |= *room == 0;
            if overflows {
                return Ok(None);
            }
            *room -= 1;
            (self.preview_member(name, it[2], context, is_table && depth > 0)).map(Some)
        })?);
        let entries = match entries_of(realm, value, 6)?.filter(|_| depth > 0) {
            Some(all) => with_elements(all, |all| {
                overflows |= all.len() > 5;
                let all = all
                    .iter()
                    .take(5)
                    .map(|it| self.preview_entry(*it, context));
                all.collect::<JsResult<Value>>()
            })?,
            None => Value::Undefined,
        };
        Ok(preview.and(&record! {
            "overflow": overflows,
            "properties": Value::List(members),
            "entries": entries,
        }))
    }

    pub(super) fn properties(&self, params: &Value) -> Outcome {
        let Found {
            value: object,
            context,
            group,
            role,
        } = self.objects.find(&params["objectId"])?;
        let (realm, form) = (self.world(&context)?.realm, Form::asked_for(params));
        let remote = |it, form| self.remote(it, &context, &group, form);
        let wanted = Wanted {
            own_only: params["ownProperties"].is_truthy() || role == Role::Scope,
            accessors_only: params["accessorPropertiesOnly"].is_truthy(),
            skips_indices: params["nonIndexedPropertiesOnly"].is_truthy(),
            most: u32::MAX,
        };
        let mut private = Vec::new();
        let mut describe = |name: String, traits: Traits, it: &[JSValue; 5]| {
            let [key, _, value, getter, setter] = *it;
            if role == Role::Scope && name == "arguments" {
                return Ok(None);
            }
            let has_value = traits.has(Trait::HasValue);
            let role = match role == Role::Entries && traits.has(Trait::Index) {
                true => Role::Entry,
                false => Role::Itself,
            };
            let value = has_value.then(|| self.remote_as(role, value, &context, &group, form));
            if traits.has(Trait::Private) {
                private.push(record! { "name": name, "value": value.transpose()? });
                return Ok(None);
            }
            let accessor = |it| {
                (!has_value)
                    .then(|| remote(it, Form::Reference))
                    .transpose()
            };
            Ok(Some(record! {
                "name": name,
                "enumerable": traits.has(Trait::Enumerable),
                "configurable": traits.has(Trait::Configurable),
                "writable": has_value.then_some(traits.has(Trait::Writable)),
                "isOwn": traits.has(Trait::Own),
                "wasThrown": traits.has(Trait::Thrown).then_some(true),
                "value": value.transpose()?,
                "get": accessor(getter)?,
                "set": accessor(setter)?,
                "symbol": key.is_symbol().then(|| remote(key, Form::Reference)).transpose()?,
            }))
        };
        let result = match role {
            Role::Scope => with_elements(object, |parts| {
                let parts = parts
                    .iter()
                    .map(|it| each_property(realm, *it, wanted, &mut describe));
                Ok(parts.collect::<JsResult<Vec<_>>>()?.concat())
            })?,
            _ => each_property(realm, object, wanted, describe)?,
        };
        let result = record! { "result": Value::List(result) };
        if wanted.accessors_only || !object.is_object() || role != Role::Itself {
            return Ok(result);
        }
        let (mut internal, mut place) = (Vec::new(), [0; 3]);
        if let Some(all) = entries_of(realm, object, u32::MAX)? {
            let all = self.remote_as(Role::Entries, all, &context, &group, Form::Reference)?;
            internal.push(record! { "name": "[[Entries]]", "value": all });
        }
        if Bun__Inspector__placeOfFunction(object, &mut place) {
            internal.push(record! { "name": "[[FunctionLocation]]", "value": location(place) });
        }
        internal.extend(each_slot(realm, object, |name, it| {
            let form = if name == "[[Prototype]]" {
                Form::Reference
            } else {
                form
            };
            Ok(Some(record! { "name": name, "value": remote(it, form)? }))
        })?);
        Ok((result.with("internalProperties", Value::List(internal)))
            .with("privateProperties", Value::List(private)))
    }
}
