//! Data that goes to another process, or comes from one: what JSON has, and what `structuredClone` copies.

use core::fmt::Write as _;
use std::rc::Rc;

use bun_core::strings;

#[derive(Clone, Default)]
pub(crate) enum Value {
    #[default]
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    Text(Box<str>),
    /// A string with a lone surrogate.
    Units(Box<[u16]>),
    BigInt(Box<str>),
    List(Vec<Value>),
    Record(Vec<(Value, Value)>),
    Map(Vec<(Value, Value)>),
    Set(Vec<Value>),
    /// The name of the constructor of the view, unless it is an `ArrayBuffer`.
    Bytes(Option<Box<str>>, Rc<[u8]>),
    Date(f64),
    RegExp(Box<[Value; 2]>),
    /// The name, the message and the stack.
    Error(Box<[Value; 3]>),
    /// Names an object that stays where it is.
    Handle(Vec<Value>),
    /// It gets the list of the arguments.
    Function(Rc<dyn Fn(Value)>),
    /// An object that is in the message again.
    Shared(u32, Box<Value>),
    Again(u32),
}

macro_rules! record {
    ($($name:literal: $value:expr),* $(,)?) => {
        $crate::value::Value::Record(vec![$(($name.into(), Into::<$crate::value::Value>::into($value))),*])
    };
}

macro_rules! list {
    ($($value:expr),* $(,)?) => {
        $crate::value::Value::List(vec![$($crate::value::Value::from($value)),*])
    };
}

macro_rules! from_numbers {
    ($($type:ty),*) => {$(
        impl From<$type> for Value {
            fn from(it: $type) -> Value {
                Value::Number(it as f64)
            }
        }
    )*};
}
from_numbers!(u8, i32, u32, usize, f32, f64);

impl From<bool> for Value {
    fn from(it: bool) -> Value {
        Value::Bool(it)
    }
}

impl From<&str> for Value {
    fn from(it: &str) -> Value {
        Value::Text(it.into())
    }
}

impl From<String> for Value {
    fn from(it: String) -> Value {
        Value::Text(it.into())
    }
}

impl From<&Value> for Value {
    fn from(it: &Value) -> Value {
        it.clone()
    }
}

impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(it: Option<T>) -> Value {
        it.map_or(Value::Undefined, Into::into)
    }
}

impl<T: Into<Value>> FromIterator<T> for Value {
    fn from_iter<I: IntoIterator<Item = T>>(items: I) -> Value {
        Value::List(items.into_iter().map(Into::into).collect())
    }
}

impl core::ops::Index<&str> for Value {
    type Output = Value;

    fn index(&self, name: &str) -> &Value {
        let found = self.members().iter().find(|it| it.0.is(name));
        found.map_or(&Value::Undefined, |it| it.1.itself())
    }
}

impl core::ops::Index<usize> for Value {
    type Output = Value;

    fn index(&self, index: usize) -> &Value {
        self.items()
            .get(index)
            .map_or(&Value::Undefined, Value::itself)
    }
}

impl Value {
    pub(crate) fn empty() -> Value {
        Value::Record(Vec::new())
    }

    pub(crate) fn buffer(bytes: &[u8]) -> Value {
        Value::Bytes(Some("Buffer".into()), bytes.into())
    }

    pub(crate) fn error(message: impl Into<Value>) -> Value {
        Value::Error(Box::new(["Error".into(), message.into(), Value::Undefined]))
    }

    fn itself(&self) -> &Value {
        match self {
            Value::Shared(_, it) => it,
            it => it,
        }
    }

    pub(crate) fn is(&self, text: &str) -> bool {
        self.as_text() == Some(text)
    }

    pub(crate) fn as_text(&self) -> Option<&str> {
        match self {
            Value::Text(it) => Some(it),
            _ => None,
        }
    }

    /// Empty if it is something else.
    pub(crate) fn text(&self) -> &str {
        self.as_text().unwrap_or_default()
    }

    pub(crate) fn as_number(&self) -> Option<f64> {
        match self {
            Value::Number(it) => Some(*it),
            _ => None,
        }
    }

    /// 0 if it is something else.
    pub(crate) fn number(&self) -> f64 {
        self.as_number().filter(|it| !it.is_nan()).unwrap_or(0.)
    }

    pub(crate) fn int(&self) -> i32 {
        self.number() as i32
    }

    pub(crate) fn as_bytes(&self) -> Option<&Rc<[u8]>> {
        match self {
            Value::Bytes(_, it) => Some(it),
            _ => None,
        }
    }

    pub(crate) fn items(&self) -> &[Value] {
        match self.itself() {
            Value::List(it) => it,
            _ => &[],
        }
    }

    pub(crate) fn members(&self) -> &[(Value, Value)] {
        match self.itself() {
            Value::Record(it) => it,
            _ => &[],
        }
    }

    pub(crate) fn is_list(&self) -> bool {
        matches!(self.itself(), Value::List(_))
    }

    pub(crate) fn is_nothing(&self) -> bool {
        matches!(self, Value::Undefined | Value::Null)
    }

    pub(crate) fn is_truthy(&self) -> bool {
        match self {
            Value::Undefined | Value::Null => false,
            Value::Bool(it) => *it,
            Value::Number(it) => *it != 0. && !it.is_nan(),
            Value::Text(it) => !it.is_empty(),
            _ => true,
        }
    }

    pub(crate) fn into_items(self) -> Vec<Value> {
        match self {
            Value::List(it) => it,
            Value::Shared(_, it) => it.into_items(),
            _ => Vec::new(),
        }
    }

    /// Of a record. What it had under that name goes.
    pub(crate) fn set(&mut self, name: &str, value: impl Into<Value>) {
        match self {
            Value::Record(members) => match members.iter_mut().find(|it| it.0.is(name)) {
                Some(member) => member.1 = value.into(),
                None => members.push((name.into(), value.into())),
            },
            Value::Shared(_, it) => it.set(name, value.into()),
            _ => {}
        }
    }

    pub(crate) fn with(mut self, name: &str, value: impl Into<Value>) -> Value {
        self.set(name, value.into());
        self
    }

    /// `{ ...self, ...more }`
    pub(crate) fn and(mut self, more: &Value) -> Value {
        for (name, value) in more.members() {
            self.set(name.text(), value);
        }
        self
    }

    pub(crate) fn take(&mut self, name: &str) -> Value {
        match self {
            Value::Record(members) => (members.iter().position(|it| it.0.is(name)))
                .map_or(Value::Undefined, |at| members.remove(at).1),
            Value::Shared(_, it) => it.take(name),
            _ => Value::Undefined,
        }
    }

    /// Only the members with these names.
    pub(crate) fn pick(&self, names: &[&str]) -> Value {
        Value::Record(
            names
                .iter()
                .map(|it| ((*it).into(), self[*it].clone()))
                .collect(),
        )
    }

    /// `String(value)` of a primitive.
    pub(crate) fn display(&self) -> String {
        match self {
            Value::Text(it) | Value::BigInt(it) => it.to_string(),
            Value::Units(it) => String::from_utf16_lossy(it),
            Value::Undefined => "undefined".to_owned(),
            Value::Number(it) => number_to_string(*it),
            Value::Error(it) => format!("{}: {}", it[0].display(), it[1].display()),
            other => other.to_json(),
        }
    }

    pub(crate) fn call(&self, arguments: Value) {
        if let Value::Function(function) = self {
            function(arguments);
        }
    }

    /// Whether it counts among the objects of a message.
    pub(crate) fn is_object(&self) -> bool {
        use Value::*;
        matches!(
            self,
            List(_)
                | Record(_)
                | Map(_)
                | Set(_)
                | Bytes(..)
                | Date(_)
                | RegExp(_)
                | Error(_)
                | Handle(_)
        )
    }

    /// `repeated` is sorted, and has the places, among the objects in the order in which they start, that an `Again` names.
    pub(crate) fn mark_shared(&mut self, repeated: &[u32], count: &mut u32) {
        if !self.is_object() {
            return;
        }
        let place = *count;
        *count += 1;
        match self {
            Value::List(items) | Value::Set(items) | Value::Handle(items) => {
                items
                    .iter_mut()
                    .for_each(|it| it.mark_shared(repeated, count));
            }
            Value::Record(pairs) | Value::Map(pairs) => {
                for (name, value) in pairs {
                    name.mark_shared(repeated, count);
                    value.mark_shared(repeated, count);
                }
            }
            _ => {}
        }
        if repeated.binary_search(&place).is_ok() {
            *self = Value::Shared(place, Box::new(core::mem::take(self)));
        }
    }
}

pub(crate) fn number_to_string(number: f64) -> String {
    let mut buffer = [0; 124];
    crate::text::string(bun_core::fmt::FormatDouble::dtoa(&mut buffer, number))
}

// ── JSON ──

pub(crate) const DEEPEST: u32 = 1000;

pub(crate) fn write_text(text: &str, out: &mut String) {
    let _ = bun_core::fmt::encode_json_string(out, text.as_bytes());
}

pub(crate) fn quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    write_text(text, &mut out);
    out
}

pub(crate) fn write_units(units: &[u16], out: &mut String) {
    out.push('"');
    for unit in units {
        let _ = write!(out, "\\u{unit:04x}");
    }
    out.push('"');
}

impl Value {
    /// `JSON.stringify()`
    pub(crate) fn to_json(&self) -> String {
        let mut out = String::new();
        self.write_json(&mut out);
        out
    }

    fn write_json(&self, out: &mut String) {
        match self.itself() {
            Value::Bool(it) => out.push_str(if *it { "true" } else { "false" }),
            Value::Number(it) if it.is_finite() => out.push_str(&number_to_string(*it)),
            Value::Text(it) => write_text(it, out),
            Value::Units(it) => write_units(it, out),
            Value::List(items) => {
                out.push('[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    item.write_json(out);
                }
                out.push(']');
            }
            Value::Record(members) => {
                out.push('{');
                let defined = members
                    .iter()
                    .filter(|it| !matches!(it.1, Value::Undefined));
                for (index, (name, value)) in defined.enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    name.write_json(out);
                    out.push(':');
                    value.write_json(out);
                }
                out.push('}');
            }
            _ => out.push_str("null"),
        }
    }

    pub(crate) fn parse(json: &[u8]) -> Option<Value> {
        let mut parser = Parser { json, at: 0 };
        let value = parser.value(0)?;
        parser.peek().is_none().then_some(value)
    }
}

struct Parser<'a> {
    json: &'a [u8],
    at: usize,
}

impl Parser<'_> {
    fn peek(&mut self) -> Option<u8> {
        while self.json.get(self.at)?.is_ascii_whitespace() {
            self.at += 1;
        }
        Some(self.json[self.at])
    }

    fn eat(&mut self, byte: u8) -> bool {
        let is_next = self.peek() == Some(byte);
        self.at += usize::from(is_next);
        is_next
    }

    fn word(&mut self, word: &[u8], value: Value) -> Option<Value> {
        let is_next = self.json[self.at..].starts_with(word);
        self.at += word.len();
        is_next.then_some(value)
    }

    /// Up to `end`, with commas between them.
    fn each(&mut self, end: u8, item: &mut dyn FnMut(&mut Self) -> Option<()>) -> Option<()> {
        self.at += 1;
        if self.eat(end) {
            return Some(());
        }
        loop {
            item(self)?;
            if !self.eat(b',') {
                return self.eat(end).then_some(());
            }
        }
    }

    fn value(&mut self, depth: u32) -> Option<Value> {
        // A message is nested twice as deeply as its handles are.
        if depth > 2 * DEEPEST + 8 {
            return None;
        }
        match self.peek()? {
            b'"' => self.text(),
            b'[' => {
                let mut items = Vec::new();
                self.each(b']', &mut |it| it.value(depth + 1).map(|it| items.push(it)))?;
                Some(Value::List(items))
            }
            b'{' => {
                let mut members = Vec::new();
                self.each(b'}', &mut |it| {
                    let name = if it.peek()? == b'"' {
                        it.text()?
                    } else {
                        return None;
                    };
                    let value = if it.eat(b':') {
                        it.value(depth + 1)?
                    } else {
                        return None;
                    };
                    members.push((name, value));
                    Some(())
                })?;
                Some(Value::Record(members))
            }
            b't' => self.word(b"true", Value::Bool(true)),
            b'f' => self.word(b"false", Value::Bool(false)),
            b'n' => self.word(b"null", Value::Null),
            _ => {
                let rest = &self.json[self.at..];
                let is_part =
                    |it: &&u8| matches!(it, b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E');
                let digits = &rest[..rest.iter().take_while(is_part).count()];
                self.at += digits.len();
                core::str::from_utf8(digits)
                    .ok()?
                    .parse()
                    .ok()
                    .map(Value::Number)
            }
        }
    }

    fn unit(&mut self) -> Option<u16> {
        let digits = core::str::from_utf8(self.json.get(self.at..self.at + 4)?).ok()?;
        self.at += 4;
        u16::from_str_radix(digits, 16).ok()
    }

    fn text(&mut self) -> Option<Value> {
        self.at += 1;
        let (mut text, mut units) = (String::new(), Vec::new());
        loop {
            let rest = &self.json[self.at..];
            let plain = strings::index_of_any(rest, b"\"\\")?;
            text.push_str(core::str::from_utf8(&rest[..plain]).ok()?);
            self.at += plain + 1;
            if rest[plain] == b'"' {
                break;
            }
            self.at += 1;
            text.push(match *rest.get(plain + 1)? {
                b'b' => '\u{8}',
                b'f' => '\u{c}',
                b'n' => '\n',
                b'r' => '\r',
                b't' => '\t',
                b'u' => {
                    let unit = self.unit()?;
                    match char::from_u32(unit.into()) {
                        Some(character) => character,
                        None => {
                            units.extend(text.encode_utf16().chain([unit]));
                            text.clear();
                            continue;
                        }
                    }
                }
                other @ (b'"' | b'\\' | b'/') => other.into(),
                _ => return None,
            });
        }
        if units.is_empty() {
            return Some(text.into());
        }
        units.extend(text.encode_utf16());
        Some(String::from_utf16(&units).map_or_else(|_| Value::Units(units.into()), Value::from))
    }
}
