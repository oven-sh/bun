use std::rc::Rc;

use bun_sema::atom::number_to_string;
use bun_sema::hir::FnId;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) struct ObjectId(pub(super) usize);

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) struct EnvironmentId(pub(super) usize);

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) enum Global {
    Object,
    ObjectPrototype,
    HasOwnProperty,
    Array,
    ArrayPrototype,
    Date,
    DatePrototype,
    Number,
    NumberPrototype,
    String,
    StringPrototype,
    RegExp,
    Url,
    UrlModule,
    Require,
    RequireResolve,
    ImportMeta,
    FileSystem,
    ReadFileSync,
    Path,
    PathDirname,
    PathJoin,
    FileUrlToPath,
}

impl Global {
    pub(super) fn of_module(specifier: &[u8]) -> Option<Global> {
        match specifier.strip_prefix(b"node:").unwrap_or(specifier) {
            b"fs" => Some(Global::FileSystem),
            b"path" => Some(Global::Path),
            b"url" => Some(Global::UrlModule),
            _ => None,
        }
    }

    pub(super) fn is_function(self) -> bool {
        !matches!(
            self,
            Global::ObjectPrototype
                | Global::ImportMeta
                | Global::FileSystem
                | Global::Path
                | Global::UrlModule
        ) && !self.is_prototype_of_class()
    }

    pub(super) fn is_prototype_of_class(self) -> bool {
        matches!(
            self,
            Global::ArrayPrototype
                | Global::DatePrototype
                | Global::NumberPrototype
                | Global::StringPrototype
        )
    }

    pub(super) fn takes_properties(self) -> bool {
        let is_class = matches!(
            self,
            Global::Array | Global::Date | Global::Number | Global::String
        );
        is_class || self.is_prototype_of_class()
    }

    pub(super) fn property(self, key: &[u8]) -> Option<Global> {
        match (self, key) {
            (Global::Object, b"prototype") => Some(Global::ObjectPrototype),
            (Global::ObjectPrototype, b"hasOwnProperty") => Some(Global::HasOwnProperty),
            (Global::Array, b"prototype") => Some(Global::ArrayPrototype),
            (Global::Date, b"prototype") => Some(Global::DatePrototype),
            (Global::Number, b"prototype") => Some(Global::NumberPrototype),
            (Global::String, b"prototype") => Some(Global::StringPrototype),
            (Global::Require, b"resolve") => Some(Global::RequireResolve),
            (Global::FileSystem, b"default") => Some(Global::FileSystem),
            (Global::FileSystem, b"readFileSync") => Some(Global::ReadFileSync),
            (Global::Path, b"default" | b"posix") => Some(Global::Path),
            (Global::Path, b"dirname") => Some(Global::PathDirname),
            (Global::Path, b"join" | b"resolve") => Some(Global::PathJoin),
            (Global::UrlModule, b"default") => Some(Global::UrlModule),
            (Global::UrlModule, b"URL") => Some(Global::Url),
            (Global::UrlModule, b"fileURLToPath") => Some(Global::FileUrlToPath),
            _ => None,
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) struct Pattern {
    pub(super) literal: Rc<[u8]>,
    pub(super) is_global: bool,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) enum Matcher {
    Start(Rc<[u8]>),
    End(Rc<[u8]>),
    Blanks,
    Characters(CharacterPattern),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) struct CharacterPattern {
    pub(super) characters: Rc<[u8]>,
    pub(super) is_captured: bool,
    pub(super) is_global: bool,
}

#[derive(Clone, PartialEq, Debug)]
pub(super) enum Value {
    Unknown,
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    String(Rc<[u8]>),
    Object(ObjectId),
    Pattern(Rc<Pattern>),
    Matcher(Rc<Matcher>),
    Path(Rc<[u8]>),
    Contents(Rc<[u8]>),
    Function(FnId, EnvironmentId),
    Evaluated,
    Prototype(FnId),
    Global(Global),
}

impl Value {
    pub(super) fn string(text: &[u8]) -> Value {
        Value::String(text.into())
    }

    pub(super) fn is_known(&self) -> bool {
        *self != Value::Unknown
    }

    pub(super) fn to_boolean(&self) -> Option<bool> {
        match self {
            Value::Unknown => None,
            Value::Undefined | Value::Null => Some(false),
            Value::Boolean(value) => Some(*value),
            Value::Number(number) => Some(*number != 0.0 && !number.is_nan()),
            Value::String(text) => Some(!text.is_empty()),
            Value::Object(_)
            | Value::Pattern(_)
            | Value::Matcher(_)
            | Value::Path(_)
            | Value::Contents(_)
            | Value::Function(..)
            | Value::Evaluated
            | Value::Prototype(_)
            | Value::Global(_) => Some(true),
        }
    }

    pub(super) fn as_number(&self) -> Option<f64> {
        match self {
            Value::Number(number) => Some(*number),
            _ => None,
        }
    }

    pub(super) fn as_string(&self) -> Option<&Rc<[u8]>> {
        match self {
            Value::String(text) => Some(text),
            _ => None,
        }
    }

    pub(super) fn to_text(&self) -> Option<Rc<[u8]>> {
        match self {
            Value::String(text) | Value::Contents(text) => Some(Rc::clone(text)),
            Value::Number(number) => Some(number_to_string(*number).into()),
            Value::Boolean(true) => Some((*b"true").into()),
            Value::Boolean(false) => Some((*b"false").into()),
            Value::Undefined => Some((*b"undefined").into()),
            Value::Null => Some((*b"null").into()),
            Value::Unknown
            | Value::Object(_)
            | Value::Pattern(_)
            | Value::Matcher(_)
            | Value::Path(_)
            | Value::Function(..)
            | Value::Evaluated
            | Value::Prototype(_)
            | Value::Global(_) => None,
        }
    }

    pub(super) fn is_identical(&self, other: &Value) -> Option<bool> {
        match (self, other) {
            (Value::Unknown, _) | (_, Value::Unknown) => None,
            (Value::Number(left), Value::Number(right)) => Some(left == right),
            _ => Some(self == other),
        }
    }
}

#[derive(Clone, PartialEq, Debug, Default)]
pub(super) struct Object {
    pub(super) is_array: bool,
    pub(super) is_open: bool,
    pub(super) is_unseen: bool,
    pub(super) parent: Option<ObjectId>,
    pub(super) constructor: Option<FnId>,
    pub(super) elements: Vec<Value>,
    pub(super) properties: Vec<(Rc<[u8]>, Value)>,
}

impl Object {
    pub(super) fn array(elements: Vec<Value>) -> Object {
        Object {
            is_array: true,
            elements,
            ..Object::default()
        }
    }

    pub(super) fn unseen() -> Object {
        Object {
            is_unseen: true,
            ..Object::default()
        }
    }

    pub(super) fn instance(constructor: FnId) -> Object {
        Object {
            constructor: Some(constructor),
            ..Object::default()
        }
    }

    pub(super) fn merge(self, other: &Object) -> Object {
        let merged = Object {
            is_array: self.is_array,
            is_open: true,
            is_unseen: self.is_unseen,
            parent: self.parent,
            ..Object::default()
        };
        let Some(constructor) = self.constructor else {
            return merged;
        };
        if self.is_open || other.is_open || other.constructor != self.constructor {
            return merged;
        }
        let mut merged = Object::instance(constructor);
        for (index, (key, value)) in self.properties.iter().enumerate() {
            let value = match other.property_at(index, key) {
                Some(same) if same == value => value.clone(),
                _ => Value::Unknown,
            };
            merged.properties.push((Rc::clone(key), value));
        }
        for (index, (key, _)) in other.properties.iter().enumerate() {
            if self.property_at(index, key).is_none() {
                merged.properties.push((Rc::clone(key), Value::Unknown));
            }
        }
        merged
    }

    fn property_at(&self, index: usize, key: &[u8]) -> Option<&Value> {
        let is_found = |it: &&(Rc<[u8]>, Value)| *it.0 == *key;
        let probable = self.properties.get(index).filter(is_found);
        let property = probable.or_else(|| self.properties.iter().find(is_found));
        property.map(|it| &it.1)
    }

    pub(super) fn size(&self) -> usize {
        self.elements.len() + self.properties.len()
    }

    pub(super) fn index_of_key(key: &[u8]) -> Option<usize> {
        let is_index = !key.is_empty()
            && key.len() < 10
            && key.iter().all(u8::is_ascii_digit)
            && (key.len() == 1 || key[0] != b'0');
        let digits = std::str::from_utf8(key).ok().filter(|_| is_index)?;
        digits.parse().ok()
    }

    pub(super) fn get(&self, key: &[u8]) -> Value {
        if self.is_open {
            return Value::Unknown;
        }
        if self.is_array {
            if key == b"length" {
                return Value::Number(self.elements.len() as f64);
            }
            if let Some(index) = Object::index_of_key(key) {
                return self
                    .elements
                    .get(index)
                    .cloned()
                    .unwrap_or(Value::Undefined);
            }
            return Value::Unknown;
        }
        match self.properties.iter().find(|it| *it.0 == *key) {
            Some((_, value)) => value.clone(),
            None if self.is_unseen || is_object_prototype_name(key) => Value::Unknown,
            None => Value::Undefined,
        }
    }

    pub(super) fn set(&mut self, key: &[u8], value: Value) {
        if self.is_array {
            match Object::index_of_key(key) {
                Some(index) if index < self.elements.len() => self.elements[index] = value,
                Some(index) if index == self.elements.len() => self.elements.push(value),
                _ => self.is_open = true,
            }
            return;
        }
        match self.properties.iter_mut().find(|it| *it.0 == *key) {
            Some(property) => property.1 = value,
            None => self.properties.push((key.into(), value)),
        }
    }

    pub(super) fn keys(&self) -> Option<Vec<Rc<[u8]>>> {
        if self.is_open || self.is_unseen {
            return None;
        }
        if self.is_array {
            let keys = 0..self.elements.len();
            return Some(keys.map(|it| it.to_string().into_bytes().into()).collect());
        }
        if self.properties.iter().any(|it| is_array_index(&it.0)) {
            return None;
        }
        Some(self.properties.iter().map(|it| Rc::clone(&it.0)).collect())
    }
}

fn is_array_index(key: &[u8]) -> bool {
    let is_canonical = key == b"0" || key.first().is_some_and(|&first| first != b'0');
    is_canonical
        && key.iter().all(u8::is_ascii_digit)
        && (key.len() < 10 || key.len() == 10 && key <= &b"4294967294"[..])
}

fn is_object_prototype_name(key: &[u8]) -> bool {
    matches!(
        key,
        b"constructor"
            | b"hasOwnProperty"
            | b"isPrototypeOf"
            | b"propertyIsEnumerable"
            | b"toLocaleString"
            | b"toString"
            | b"valueOf"
            | b"__proto__"
            | b"__defineGetter__"
            | b"__defineSetter__"
            | b"__lookupGetter__"
            | b"__lookupSetter__"
    )
}
