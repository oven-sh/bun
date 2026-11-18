//! `packages/bun-desktop/src/webview/wire.js` is the other end.

use core::fmt::Write as _;

use bun_collections::HashMap;
use bun_jsc::{JSMap, JSType, MarkedArgumentBuffer, StringJsc as _, from_js_host_call};

use crate::prelude::*;
use crate::realm::Realm;
use crate::value::{DEEPEST, Value, number_to_string, write_text, write_units};

const LONGEST: usize = 1 << 30;

#[derive(Default)]
struct Writer {
    json: String,
    bytes: Vec<u8>,
    objects: u32,
    shared: Vec<(u32, u32)>,
}

impl Writer {
    fn tagged<'a>(&mut self, tag: char, items: impl Iterator<Item = &'a Value>) {
        let _ = write!(self.json, "[\"{tag}\"");
        for item in items {
            self.json.push(',');
            self.value(item);
        }
        self.json.push(']');
    }

    fn value(&mut self, value: &Value) {
        self.objects += u32::from(value.is_object());
        match value {
            Value::Undefined | Value::Function(_) => self.json.push_str("[\"u\"]"),
            Value::Null => self.json.push_str("null"),
            Value::Bool(it) => self.json.push_str(if *it { "true" } else { "false" }),
            Value::Number(it) if *it == 0. && it.is_sign_negative() => {
                self.json.push_str("[\"n\",\"-0\"]")
            }
            Value::Number(it) if it.is_finite() => self.json.push_str(&number_to_string(*it)),
            Value::Number(it) => self.tagged('n', [&number_to_string(*it).into()].into_iter()),
            Value::Text(it) => write_text(it, &mut self.json),
            Value::Units(it) => write_units(it, &mut self.json),
            Value::BigInt(it) => self.tagged('i', [&(**it).into()].into_iter()),
            Value::List(it) => self.tagged('a', it.iter()),
            Value::Set(it) => self.tagged('s', it.iter()),
            Value::Record(it) => self.tagged('o', it.iter().flat_map(|it| [&it.0, &it.1])),
            Value::Map(it) => self.tagged('m', it.iter().flat_map(|it| [&it.0, &it.1])),
            Value::Bytes(view, bytes) => {
                let place = [self.bytes.len().into(), bytes.len().into()];
                self.bytes.extend_from_slice(bytes);
                match view {
                    Some(name) => self.tagged('v', [&(**name).into()].into_iter().chain(&place)),
                    None => self.tagged('b', place.iter()),
                }
            }
            Value::Date(it) => self.tagged('d', [&Value::Number(*it)].into_iter()),
            Value::RegExp(it) => self.tagged('x', it.iter()),
            Value::Error(it) => self.tagged('e', it.iter()),
            Value::Handle(it) => {
                self.json.push_str("[\"h\",");
                self.tagged('a', it.iter());
                self.json.push(']');
            }
            Value::Shared(key, it) => {
                self.shared.push((*key, self.objects));
                self.value(it);
            }
            Value::Again(key) => match self.shared.iter().rfind(|it| it.0 == *key) {
                Some(&(_, place)) => self.tagged('r', [&place.into()].into_iter()),
                None => self.value(&Value::Undefined),
            },
        }
    }
}

/// With its length.
pub(crate) fn encode(value: &Value) -> Vec<u8> {
    let mut writer = Writer::default();
    writer.value(value);
    let Writer { json, bytes, .. } = writer;
    let lengths = [4 + json.len() + bytes.len(), json.len()].map(|it| (it as u32).to_le_bytes());
    [lengths.as_flattened(), json.as_bytes(), &bytes].concat()
}

fn length_at_start(bytes: &[u8]) -> Option<usize> {
    Some(u32::from_le_bytes(*bytes.first_chunk()?) as usize)
}

struct Reader<'a> {
    bytes: &'a [u8],
    repeated: Vec<u32>,
}

impl Reader<'_> {
    fn all(&mut self, items: Vec<Value>) -> Option<Vec<Value>> {
        items.into_iter().map(|it| self.value(it)).collect()
    }

    fn pairs(&mut self, items: Vec<Value>) -> Option<Vec<(Value, Value)>> {
        let mut items = self.all(items)?.into_iter();
        Some(core::iter::from_fn(|| Some((items.next()?, items.next()?))).collect())
    }

    fn bytes(&self, offset: &Value, length: &Value) -> Option<&[u8]> {
        self.bytes
            .get(offset.number() as usize..)?
            .get(..length.number() as usize)
    }

    fn value(&mut self, json: Value) -> Option<Value> {
        let Value::List(mut items) = json else {
            return (!matches!(json, Value::Record(_))).then_some(json);
        };
        if items.is_empty() {
            return None;
        }
        let tag = items.remove(0);
        Some(match (tag.text(), &*items) {
            ("a", _) => Value::List(self.all(items)?),
            ("o", _) => Value::Record(self.pairs(items)?),
            ("m", _) => Value::Map(self.pairs(items)?),
            ("s", _) => Value::Set(self.all(items)?),
            ("u", _) => Value::Undefined,
            ("n", [text]) => Value::Number(text.text().parse().unwrap_or(f64::NAN)),
            ("i", [text]) => Value::BigInt(text.text().into()),
            ("h", [_]) => match self.value(items.pop()?)? {
                Value::List(handle) => Value::Handle(handle),
                _ => return None,
            },
            ("r", [place]) => {
                self.repeated.push(place.number() as u32);
                Value::Again(place.number() as u32)
            }
            ("b", [offset, length]) => Value::Bytes(None, self.bytes(offset, length)?.into()),
            ("v", [name, offset, length]) => {
                Value::Bytes(Some(name.text().into()), self.bytes(offset, length)?.into())
            }
            ("d", [_]) => Value::Date(self.value(items.pop()?)?.as_number()?),
            ("x", [_, _]) => Value::RegExp(Box::new(items.try_into().ok()?)),
            ("e", [_, _, _]) => Value::Error(Box::new(self.all(items)?.try_into().ok()?)),
            _ => return None,
        })
    }
}

/// Without its length.
pub(crate) fn decode(message: &[u8]) -> Option<Value> {
    let (json, bytes) = message
        .get(4..)?
        .split_at_checked(length_at_start(message)?)?;
    let mut reader = Reader {
        bytes,
        repeated: Vec::new(),
    };
    let mut value = reader.value(Value::parse(json)?)?;
    if !reader.repeated.is_empty() {
        reader.repeated.sort_unstable();
        value.mark_shared(&reader.repeated, &mut 0);
    }
    Some(value)
}

/// What [`encode`] has made.
pub(crate) fn decode_whole(bytes: &Value) -> Option<Value> {
    decode(bytes.as_bytes()?.get(4..)?)
}

/// Takes the first message, without its length, out of what a stream has read from `at` on.
pub(crate) fn next_message<'a>(read: &'a [u8], at: &mut usize) -> Option<&'a [u8]> {
    let rest = &read[*at..];
    let message = rest.get(4..)?.get(..length_at_start(rest)?)?;
    *at += 4 + message.len();
    Some(message)
}

pub(crate) fn is_too_long(read: &[u8]) -> bool {
    length_at_start(read).is_some_and(|it| it > LONGEST)
}

#[repr(u8)]
enum Kind {
    Error,
    RegExp,
    Set,
    View,
}

unsafe extern "C" {
    safe fn Bun__Desktop__create(global: &Realm, kind: Kind, a: JSValue, b: JSValue) -> JSValue;
    safe fn Bun__Desktop__addToSet(global: &Realm, set: JSValue, item: JSValue);
    safe fn Bun__Desktop__itemsOf(global: &Realm, collection: JSValue) -> JSValue;
    safe fn JSBuffer__isBuffer(global: &Realm, value: JSValue) -> bool;
}

fn create(kind: Kind, a: JSValue, b: JSValue) -> JsResult<JSValue> {
    from_js_host_call(global(), || Bun__Desktop__create(global(), kind, a, b))
}

pub(crate) fn create_set() -> JsResult<JSValue> {
    create(Kind::Set, JSValue::UNDEFINED, JSValue::UNDEFINED)
}

/// An array of what a `Set` has, or of the keys and values of a `Map`.
pub(crate) fn items_of(collection: JSValue) -> JsResult<JSValue> {
    from_js_host_call(global(), || Bun__Desktop__itemsOf(global(), collection))
}

/// What a handle names.
pub(crate) type Find<'a> = &'a dyn Fn(&[Value]) -> JsResult<JSValue>;
/// The handle of an object, if it is to stay.
pub(crate) type Name<'a> = &'a dyn Fn(JSValue) -> JsResult<Option<Vec<Value>>>;

struct ToJs<'a> {
    find: Find<'a>,
    shared: Option<JSValue>,
}

impl ToJs<'_> {
    fn shared(&mut self) -> &'static mut JSMap {
        map_in(*self.shared.get_or_insert_with(|| JSMap::create(global())))
    }

    fn value(&mut self, value: &Value, key: Option<u32>) -> JsResult<JSValue> {
        let created = match value {
            Value::Undefined => return Ok(JSValue::UNDEFINED),
            Value::Null => return Ok(JSValue::NULL),
            Value::Bool(it) => return Ok((*it).into()),
            Value::Number(it) => return Ok(JSValue::js_number(JSValue::purify_nan(*it))),
            Value::Text(it) => return js(&**it),
            Value::Units(it) => return bun_core::String::clone_utf16(it).into_js(global()),
            Value::BigInt(it) => {
                let number = JSValue::big_int_from_decimal(global(), it.as_bytes())?;
                return Ok(number.unwrap_or(JSValue::UNDEFINED));
            }
            Value::Handle(it) => return (self.find)(it),
            Value::Function(it) => {
                let function = std::rc::Rc::clone(it);
                return procedure(move |arguments| {
                    super::engine::list_from_js(arguments).map(&*function)
                });
            }
            Value::Shared(key, it) => return self.value(it, Some(*key)),
            Value::Again(key) => return self.shared().get(global(), js(*key)?),
            Value::List(it) => JSValue::create_empty_array(global(), it.len())?,
            Value::Record(it) => JSValue::create_empty_object(global(), it.len().min(32)),
            Value::Map(_) => JSMap::create(global()),
            Value::Set(_) => create_set()?,
            Value::Bytes(Some(name), bytes) if &**name == "Buffer" => buffer(bytes)?,
            Value::Bytes(name, bytes) => {
                let whole =
                    bun_jsc::ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global(), bytes)?;
                match name {
                    Some(name) => create(Kind::View, js(&**name)?, whole)?,
                    None => whole,
                }
            }
            Value::Date(it) => JSValue::from_date_number(global(), *it),
            Value::RegExp(it) => create(
                Kind::RegExp,
                self.value(&it[0], None)?,
                self.value(&it[1], None)?,
            )?,
            Value::Error(it) => {
                let name = self.value(&it[0], None)?;
                let error = create(Kind::Error, name, self.value(&it[1], None)?)?;
                error.put(global(), b"name", name);
                if !matches!(it[2], Value::Undefined) {
                    assign(error, "stack", self.value(&it[2], None)?)?;
                }
                error
            }
        };
        if let Some(key) = key {
            self.shared().set(global(), js(key)?, created)?;
        }
        match value {
            Value::List(items) => {
                for (index, item) in items.iter().enumerate() {
                    created.put_index(global(), index as u32, self.value(item, None)?)?;
                }
            }
            Value::Record(members) => {
                for (name, member) in members {
                    let (name, member) = (self.value(name, None)?, self.value(member, None)?);
                    JSValue::put_to_property_key(created, global(), name, member)?;
                }
            }
            Value::Map(entries) => {
                for (key, entry) in entries {
                    let (key, entry) = (self.value(key, None)?, self.value(entry, None)?);
                    map_in(created).set(global(), key, entry)?;
                }
            }
            Value::Set(items) => {
                for item in items {
                    let item = self.value(item, None)?;
                    bun_jsc::from_js_host_call_generic(global(), || {
                        Bun__Desktop__addToSet(global(), created, item)
                    })?;
                }
            }
            _ => {}
        }
        Ok(created)
    }
}

pub(crate) fn to_js(value: &Value, find: Find<'_>) -> JsResult<JSValue> {
    let mut converter = ToJs { find, shared: None };
    let result = converter.value(value, None);
    converter.shared.unwrap_or_default().ensure_still_alive();
    result
}

#[unsafe(no_mangle)]
fn __bun_desktop_data_to_js(value: &Value) -> JsResult<JSValue> {
    to_js(value, &|_| Ok(JSValue::UNDEFINED))
}

struct FromJs<'a> {
    name: Name<'a>,
    places: HashMap<usize, u32>,
    objects: u32,
    repeated: Vec<u32>,
    roots: &'a mut MarkedArgumentBuffer,
}

fn text_from_js(value: JSValue) -> JsResult<Value> {
    let text = value.to_bun_string(global())?;
    Ok(match text.is_utf16() {
        true => String::from_utf16(text.utf16())
            .map_or_else(|_| Value::Units(text.utf16().into()), Value::from),
        false => string(&text.to_utf8()).into(),
    })
}

fn objects_in(value: &Value) -> u32 {
    match value {
        Value::List(items) | Value::Handle(items) => 1 + items.iter().map(objects_in).sum::<u32>(),
        other => other.is_object().into(),
    }
}

impl FromJs<'_> {
    fn each(&mut self, array: JSValue, depth: u32) -> JsResult<Vec<Value>> {
        (0..array.get_length(global())? as u32)
            .map(|index| self.value(array.get_index(global(), index)?, depth + 1))
            .collect()
    }

    fn value(&mut self, value: JSValue, depth: u32) -> JsResult<Value> {
        if value.is_undefined() {
            return Ok(Value::Undefined);
        } else if value.is_null() {
            return Ok(Value::Null);
        } else if value.is_boolean() {
            return Ok(Value::Bool(value.as_boolean()));
        } else if value.is_number() {
            return Ok(Value::Number(value.as_number()));
        } else if value.is_string_literal() {
            return text_from_js(value);
        } else if value.is_big_int() {
            return Ok(Value::BigInt(text_of(value)?.into()));
        }
        if value.is_object()
            && let Some(handle) = (self.name)(value)?.map(Value::Handle)
        {
            self.objects += objects_in(&handle);
            return Ok(handle);
        }
        if !value.is_object() || value.is_callable() || depth > DEEPEST {
            return Err(error(format_args!("An object could not be cloned.")));
        }
        if let Some(&place) = self.places.get(&value.0) {
            self.repeated.push(place);
            return Ok(Value::Again(place));
        }
        self.places.insert(value.0, self.objects);
        self.objects += 1;
        self.roots.append(value);
        if value.is_array() {
            return self.each(value, depth).map(Value::List);
        }
        if let Some(view) = value.as_array_buffer(global()) {
            let name = match value.js_type() {
                JSType::ArrayBuffer => None,
                _ if JSBuffer__isBuffer(global(), value) => Some("Buffer".into()),
                other => Some(string(other.typed_array_name()).into()),
            };
            return Ok(Value::Bytes(name, view.byte_slice().into()));
        }
        let member = |name: &str| text_from_js(get(value, name)?);
        Ok(match value.js_type() {
            JSType::JSDate => Value::Date(value.get_unix_timestamp()),
            JSType::RegExpObject => Value::RegExp(Box::new([member("source")?, member("flags")?])),
            JSType::Set => Value::Set(self.each(items_of(value)?, depth)?),
            JSType::Map => {
                let mut items = self.each(items_of(value)?, depth)?.into_iter();
                Value::Map(core::iter::from_fn(|| Some((items.next()?, items.next()?))).collect())
            }
            JSType::ErrorInstance => Value::Error(Box::new([
                member("name")?,
                member("message")?,
                member("stack")?,
            ])),
            _ => {
                let (names, mut members) = (value.keys(global())?, Vec::new());
                for index in 0..names.get_length(global())? as u32 {
                    let name = names.get_index(global(), index)?;
                    let member = self.value(get_by_value(global(), value, name)?, depth + 1)?;
                    members.push((text_from_js(name)?, member));
                }
                Value::Record(members)
            }
        })
    }
}

fn convert(name: Name<'_>, steps: &dyn Fn(&mut FromJs<'_>) -> JsResult<Value>) -> JsResult<Value> {
    MarkedArgumentBuffer::new(|roots| {
        let (places, repeated) = Default::default();
        let mut converter = FromJs {
            name,
            places,
            objects: 0,
            repeated,
            roots,
        };
        let mut value = steps(&mut converter)?;
        if !converter.repeated.is_empty() {
            converter.repeated.sort_unstable();
            value.mark_shared(&converter.repeated, &mut 0);
        }
        Ok(value)
    })
}

pub(crate) fn from_js(value: JSValue, name: Name<'_>) -> JsResult<Value> {
    convert(name, &|it| it.value(value, 0))
}

pub(crate) fn list_from_js(values: &[JSValue], name: Name<'_>) -> JsResult<Value> {
    convert(name, &|it| {
        it.objects = 1;
        values.iter().map(|value| it.value(*value, 1)).collect()
    })
}

/// Of what has no handles.
pub(crate) fn data_from_js(value: JSValue) -> JsResult<Value> {
    from_js(value, &|_| Ok(None))
}
