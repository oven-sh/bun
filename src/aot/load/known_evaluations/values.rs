use std::rc::Rc;

use bun_sema::atom::number_to_string;
use bun_sema::hir::FnId;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) struct ObjectId(pub(super) usize);

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) struct EnvironmentId(pub(super) usize);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Global {
    Object,
    Array,
    String,
    RegExp,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) struct Pattern {
    pub(super) literal: Rc<[u8]>,
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
    Function(FnId, EnvironmentId),
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
            Value::Object(_) | Value::Pattern(_) | Value::Function(..) | Value::Global(_) => {
                Some(true)
            }
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
            Value::String(text) => Some(Rc::clone(text)),
            Value::Number(number) => Some(number_to_string(*number).into()),
            Value::Boolean(true) => Some((*b"true").into()),
            Value::Boolean(false) => Some((*b"false").into()),
            Value::Undefined => Some((*b"undefined").into()),
            Value::Null => Some((*b"null").into()),
            Value::Unknown
            | Value::Object(_)
            | Value::Pattern(_)
            | Value::Function(..)
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
            None if is_object_prototype_name(key) => Value::Unknown,
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
        if self.is_open {
            return None;
        }
        if self.is_array {
            let keys = 0..self.elements.len();
            return Some(keys.map(|it| it.to_string().into_bytes().into()).collect());
        }
        let has_index = |it: &(Rc<[u8]>, Value)| Object::index_of_key(&it.0).is_some();
        if self.properties.iter().any(has_index) {
            return None;
        }
        Some(self.properties.iter().map(|it| Rc::clone(&it.0)).collect())
    }
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
