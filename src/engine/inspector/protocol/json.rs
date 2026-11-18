use bun_engine_number::{JsonNumber, NumberText, parse_json_number};
use bun_engine_text::{CodeUnit, StringBuilder, StringImpl, StringRef, Text, with_text};
use bun_engine_vm::Vm;
use bun_engine_vm::heap::stack::stack_pointer;

#[derive(Clone)]
pub(crate) enum Json {
    Null,
    Boolean(bool),
    Number(f64),
    Literal(&'static str),
    String(StringRef),
    Array(Vec<Json>),
    Object(Object),
    /// Text that is JSON.
    Written(StringRef),
}

#[derive(Clone)]
enum Name {
    Literal(&'static str),
    String(StringRef),
}

impl Name {
    fn text(&self) -> Text<'_> {
        match self {
            Name::Literal(name) => Text::from_ascii(name),
            Name::String(name) => name.text(),
        }
    }
}

/// Of members with the same name the last counts.
#[derive(Clone, Default)]
pub(crate) struct Object(Vec<(Name, Json)>);

/// `object! { "name": value, "other" => option }`
macro_rules! object {
    ($($name:literal $(: $value:expr)? $(=> $option:expr)?),* $(,)?) => {{
        #[allow(unused_mut)]
        let mut object = $crate::protocol::Object::default();
        $(
            $(object.add($name, $value);)?
            $(object.add_if_any($name, $option);)?
        )*
        object
    }};
}

pub(crate) use object;

impl Object {
    pub(super) const EMPTY: Object = Object(Vec::new());

    pub(crate) fn add(&mut self, name: &'static str, value: impl Into<Json>) {
        self.0.push((Name::Literal(name), value.into()));
    }

    pub(crate) fn add_if_any(&mut self, name: &'static str, value: Option<impl Into<Json>>) {
        if let Some(value) = value {
            self.add(name, value);
        }
    }

    pub(crate) fn add_if_true(&mut self, name: &'static str, value: bool) {
        self.add_if_any(name, value.then_some(true));
    }

    fn add_named(&mut self, name: StringRef, value: Json) {
        self.0.push((Name::String(name), value));
    }

    pub(crate) fn replace(&mut self, name: &'static str, value: impl Into<Json>) {
        match self.0.iter_mut().rfind(|it| it.0.text().eq_ascii(name)) {
            Some((_, old)) => *old = value.into(),
            None => self.add(name, value),
        }
    }

    pub(crate) fn members(&self) -> impl Iterator<Item = (Text<'_>, &Json)> {
        self.0.iter().map(|(name, value)| (name.text(), value))
    }

    pub(crate) fn get(&self, name: &str) -> Option<&Json> {
        let (_, value) = self.0.iter().rfind(|it| it.0.text().eq_ascii(name))?;
        Some(value)
    }

    pub(crate) fn boolean(&self, name: &str) -> Option<bool> {
        self.get(name)?.as_boolean()
    }

    pub(crate) fn integer(&self, name: &str) -> Option<i32> {
        self.get(name)?.as_integer()
    }

    pub(crate) fn string(&self, name: &str) -> Option<&StringRef> {
        self.get(name)?.as_string()
    }

    fn write(&self, out: &mut StringBuilder) {
        out.push_latin1(b'{');
        for (index, (name, value)) in self.members().enumerate() {
            if index != 0 {
                out.push_latin1(b',');
            }
            out.push_json_quoted(name);
            out.push_latin1(b':');
            value.write(out);
        }
        out.push_latin1(b'}');
    }

    /// `None` if it is too long for a string.
    pub(crate) fn to_text(&self) -> Option<StringRef> {
        let mut out = StringBuilder::with_capacity(256);
        self.write(&mut out);
        out.finish().ok()
    }
}

impl Json {
    pub(crate) const MAX_DEPTH: u32 = 1000;

    pub(crate) fn parse(vm: &Vm, text: Text<'_>) -> Option<Json> {
        let stack_limit = vm.hard_stack_limit();
        with_text!(text, |units| Parser { units, stack_limit }.document())
    }

    pub(crate) fn as_boolean(&self) -> Option<bool> {
        match *self {
            Json::Boolean(value) => Some(value),
            _ => None,
        }
    }

    /// Any number will do. What is out of range reads as the lowest.
    pub(crate) fn as_integer(&self) -> Option<i32> {
        match *self {
            Json::Number(value) => Some(i32::try_from(value as i64).unwrap_or(i32::MIN)),
            _ => None,
        }
    }

    /// Of what has been parsed.
    pub(crate) fn as_string(&self) -> Option<&StringRef> {
        match self {
            Json::String(value) => Some(value),
            _ => None,
        }
    }

    pub(crate) fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(value) => Some(value),
            _ => None,
        }
    }

    pub(crate) fn as_object(&self) -> Option<&Object> {
        match self {
            Json::Object(value) => Some(value),
            _ => None,
        }
    }

    pub(crate) fn write(&self, out: &mut StringBuilder) {
        match self {
            Json::Number(value) if value.is_finite() => {
                out.push_text(NumberText::from(*value).text());
            }
            Json::Null | Json::Number(_) => out.push_ascii("null"),
            Json::Boolean(true) => out.push_ascii("true"),
            Json::Boolean(false) => out.push_ascii("false"),
            Json::Literal(value) => out.push_json_quoted(Text::from_ascii(value)),
            Json::String(value) => out.push_json_quoted(value.text()),
            Json::Array(values) => {
                out.push_latin1(b'[');
                for (index, value) in values.iter().enumerate() {
                    if index != 0 {
                        out.push_latin1(b',');
                    }
                    value.write(out);
                }
                out.push_latin1(b']');
            }
            Json::Object(object) => object.write(out),
            Json::Written(text) => out.push_text(text.text()),
        }
    }
}

macro_rules! from {
    ($($type:ty, |$value:ident| $json:expr;)*) => {$(
        impl From<$type> for Json {
            fn from($value: $type) -> Json {
                $json
            }
        }
    )*};
}

from! {
    bool, |value| Json::Boolean(value);
    i32, |value| Json::Number(value.into());
    u32, |value| Json::Number(value.into());
    usize, |value| Json::Number(value as f64);
    f64, |value| Json::Number(value);
    &'static str, |value| Json::Literal(value);
    StringRef, |value| Json::String(value);
    &StringRef, |value| Json::String(value.clone());
    &StringImpl, |value| Json::String(StringRef::retain(value));
    Object, |value| Json::Object(value);
    Vec<Json>, |value| Json::Array(value);
    Vec<Object>, |value| Json::Array(value.into_iter().map(Json::Object).collect());
}

/// Also takes `\v`, `\xNN` and control characters in strings.
struct Parser<'a, T> {
    units: &'a [T],
    stack_limit: usize,
}

impl<T: CodeUnit> Parser<'_, T> {
    fn document(mut self) -> Option<Json> {
        let value = self.value(0)?;
        self.peek().is_none().then_some(value)
    }

    /// After white space.
    fn peek(&mut self) -> Option<u16> {
        let spaces = bun_engine_text::scan::json_white_space_len(self.units);
        self.units = &self.units[spaces..];
        self.units.first().map(|unit| unit.to_u16())
    }

    fn eat(&mut self, character: u8) -> bool {
        let is_next = self.peek() == Some(character.into());
        self.units = &self.units[usize::from(is_next)..];
        is_next
    }

    fn take(&mut self, count: usize) -> Option<&[T]> {
        self.units.split_off(..count)
    }

    fn word(&mut self, word: &str, value: Json) -> Option<Json> {
        (T::text(self.take(word.len())?).eq_ascii(word)).then_some(value)
    }

    fn value(&mut self, depth: u32) -> Option<Json> {
        if depth > Json::MAX_DEPTH || stack_pointer() < self.stack_limit {
            return None;
        }
        match u8::try_from(self.peek()?).ok()? {
            b'n' => self.word("null", Json::Null),
            b't' => self.word("true", Json::Boolean(true)),
            b'f' => self.word("false", Json::Boolean(false)),
            b'"' => self.string().map(Json::String),
            b'[' => {
                let mut values = Vec::new();
                self.list(b']', |parser| {
                    values.push(parser.value(depth + 1)?);
                    Some(())
                })?;
                Some(Json::Array(values))
            }
            b'{' => {
                let mut object = Object::default();
                self.list(b'}', |parser| {
                    let name = parser.string()?;
                    parser.eat(b':').then_some(())?;
                    object.add_named(name, parser.value(depth + 1)?);
                    Some(())
                })?;
                Some(Json::Object(object))
            }
            _ => {
                let (number, length) = parse_json_number(self.units).ok()?;
                self.take(length)?;
                Some(match number {
                    JsonNumber::Int32(value) => value.into(),
                    JsonNumber::Double(value) => value.into(),
                })
            }
        }
    }

    /// At the opening bracket.
    fn list(&mut self, close: u8, mut item: impl FnMut(&mut Self) -> Option<()>) -> Option<()> {
        self.take(1)?;
        if self.eat(close) {
            return Some(());
        }
        loop {
            item(self)?;
            if !self.eat(b',') {
                return self.eat(close).then_some(());
            }
        }
    }

    fn string(&mut self) -> Option<StringRef> {
        self.eat(b'"').then_some(())?;
        let mut string = StringBuilder::new();
        loop {
            let is_special = |unit| unit == u16::from(b'"') || unit == u16::from(b'\\');
            let plain = bun_engine_text::scan::position(self.units, is_special)?;
            string.push_units(self.take(plain)?);
            if self.take(1)?[0].is(b'"') {
                return string.finish().ok();
            }
            string.push_unit(match u8::try_from(self.take(1)?[0].to_u16()).ok()? {
                itself @ (b'"' | b'/' | b'\\') => itself.into(),
                b'b' => 0x08,
                b't' => 0x09,
                b'n' => 0x0a,
                b'v' => 0x0b,
                b'f' => 0x0c,
                b'r' => 0x0d,
                b'x' => self.hex(2)?,
                b'u' => self.hex(4)?,
                _ => return None,
            });
        }
    }

    fn hex(&mut self, digits: usize) -> Option<u16> {
        let mut digits = self.take(digits)?.iter();
        digits.try_fold(0, |value, digit| {
            Some(value << 4 | digit.digit_value(16)? as u16)
        })
    }
}
