//! JSON, for the commands from JavaScript and the events to it.

use std::borrow::Borrow;
use std::fmt::{self, Display, Write as _};
use std::ops::{Index, IndexMut};
use std::path::PathBuf;

use crate::error::{Context as _, Result, bail, ensure};

#[derive(Clone, Debug, Default)]
pub enum Value {
    #[default]
    Null,
    Bool(bool),
    Unsigned(u64),
    Negative(i64),
    Float(f64),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

static NULL: Value = Value::Null;

/// 1.0 is written as 1.
impl PartialEq for Value {
    fn eq(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Null, Value::Null) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Unsigned(a), Value::Unsigned(b)) => a == b,
            (Value::String(a), Value::String(b)) => a == b,
            (Value::Array(a), Value::Array(b)) => a == b,
            (Value::Object(a), Value::Object(b)) => a == b,
            _ => self.as_f64().is_some_and(|it| Some(it) == other.as_f64()),
        }
    }
}

impl Value {
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }

    pub fn is_array(&self) -> bool {
        matches!(self, Value::Array(_))
    }

    pub fn is_u64(&self) -> bool {
        matches!(self, Value::Unsigned(_))
    }

    pub fn as_bool(&self) -> Option<bool> {
        if let Value::Bool(it) = self {
            Some(*it)
        } else {
            None
        }
    }

    pub fn as_u64(&self) -> Option<u64> {
        if let Value::Unsigned(it) = self {
            Some(*it)
        } else {
            None
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match *self {
            Value::Unsigned(it) => it.try_into().ok(),
            Value::Negative(it) => Some(it),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match *self {
            Value::Unsigned(it) => Some(it as f64),
            Value::Negative(it) => Some(it as f64),
            Value::Float(it) => Some(it),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        if let Value::String(it) = self {
            Some(it)
        } else {
            None
        }
    }

    pub fn as_array(&self) -> Option<&Vec<Value>> {
        if let Value::Array(it) = self {
            Some(it)
        } else {
            None
        }
    }

    pub fn as_object(&self) -> Option<&Vec<(String, Value)>> {
        if let Value::Object(it) = self {
            Some(it)
        } else {
            None
        }
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.as_object()?
            .iter()
            .rfind(|it| it.0 == key)
            .map(|it| &it.1)
    }

    pub fn take(&mut self) -> Value {
        std::mem::take(self)
    }

    /// The member whose name is that of a Rust field in camel case.
    pub fn field(&self, name: &str) -> &Value {
        let found = self
            .as_object()
            .and_then(|it| it.iter().rfind(|it| it.0.chars().eq(camel_case(name))));
        found.map_or(&NULL, |it| &it.1)
    }
}

pub fn camel_case(name: &str) -> impl Iterator<Item = char> {
    let mut starts_word = false;
    name.chars().filter_map(move |it| {
        let it = if std::mem::replace(&mut starts_word, it == '_') {
            it.to_ascii_uppercase()
        } else {
            it
        };
        (it != '_').then_some(it)
    })
}

impl Index<&str> for Value {
    type Output = Value;

    fn index(&self, key: &str) -> &Value {
        self.get(key).unwrap_or(&NULL)
    }
}

impl Index<usize> for Value {
    type Output = Value;

    fn index(&self, index: usize) -> &Value {
        self.as_array()
            .and_then(|it| it.get(index))
            .unwrap_or(&NULL)
    }
}

impl IndexMut<&str> for Value {
    fn index_mut(&mut self, key: &str) -> &mut Value {
        if self.is_null() {
            *self = Value::Object(Vec::new());
        }
        let Value::Object(members) = self else {
            panic!("it is not an object")
        };
        let index = members
            .iter()
            .rposition(|it| it.0 == key)
            .unwrap_or_else(|| {
                members.push((key.into(), Value::Null));
                members.len() - 1
            });
        &mut members[index].1
    }
}

impl IndexMut<usize> for Value {
    fn index_mut(&mut self, index: usize) -> &mut Value {
        let Value::Array(items) = self else {
            panic!("it is not an array")
        };
        &mut items[index]
    }
}

macro_rules! compares_with {
    ($($type:ty: $getter:ident),+) => {$(
        impl PartialEq<$type> for Value {
            fn eq(&self, other: &$type) -> bool {
                self.$getter() == Some(*other)
            }
        }
    )+};
}

compares_with!(bool: as_bool, &str: as_str, u64: as_u64);

impl PartialEq<bool> for &Value {
    fn eq(&self, other: &bool) -> bool {
        **self == *other
    }
}

impl PartialEq<str> for Value {
    fn eq(&self, other: &str) -> bool {
        self.as_str() == Some(other)
    }
}

fn write_string(text: &str, to: &mut fmt::Formatter) -> fmt::Result {
    to.write_char('"')?;
    let mut rest = text;
    while let Some(at) = rest
        .bytes()
        .position(|it| it < 0x20 || it == b'"' || it == b'\\')
    {
        to.write_str(&rest[..at])?;
        match rest.as_bytes()[at] {
            byte @ (b'"' | b'\\') => write!(to, "\\{}", byte as char)?,
            byte => write!(to, "\\u{byte:04x}")?,
        }
        rest = &rest[at + 1..];
    }
    to.write_str(rest)?;
    to.write_char('"')
}

impl Display for Value {
    fn fmt(&self, to: &mut fmt::Formatter) -> fmt::Result {
        let comma = |index: usize| if index > 0 { "," } else { "" };
        match self {
            Value::Bool(it) => it.fmt(to),
            Value::Unsigned(it) => it.fmt(to),
            Value::Negative(it) => it.fmt(to),
            Value::Float(it) if it.is_finite() => it.fmt(to),
            Value::Null | Value::Float(_) => to.write_str("null"),
            Value::String(it) => write_string(it, to),
            Value::Array(items) => {
                to.write_char('[')?;
                for (index, item) in items.iter().enumerate() {
                    to.write_str(comma(index))?;
                    item.fmt(to)?;
                }
                to.write_char(']')
            }
            Value::Object(members) => {
                to.write_char('{')?;
                for (index, (key, value)) in members.iter().enumerate() {
                    to.write_str(comma(index))?;
                    write_string(key, to)?;
                    to.write_char(':')?;
                    value.fmt(to)?;
                }
                to.write_char('}')
            }
        }
    }
}

struct Parser<'a>(&'a str);

impl Parser<'_> {
    fn eat(&mut self, token: &str) -> bool {
        self.0 = self.0.trim_ascii_start();
        self.0
            .strip_prefix(token)
            .map(|rest| self.0 = rest)
            .is_some()
    }

    fn list<T>(
        &mut self,
        end: &str,
        mut item: impl FnMut(&mut Self) -> Option<T>,
    ) -> Option<Vec<T>> {
        let mut items = Vec::new();
        while !self.eat(end) {
            (items.is_empty() || self.eat(",")).then_some(())?;
            items.push(item(self)?);
        }
        Some(items)
    }

    fn unit(&mut self) -> Option<u16> {
        let (digits, rest) = self.0.split_at_checked(4)?;
        self.0 = rest;
        u16::from_str_radix(digits, 16).ok()
    }

    fn string(&mut self) -> Option<String> {
        self.eat("\"").then_some(())?;
        let mut text = String::new();
        loop {
            let at = self.0.bytes().position(|it| it == b'"' || it == b'\\')?;
            text.push_str(&self.0[..at]);
            if self.0.as_bytes()[at] == b'"' {
                self.0 = &self.0[at + 1..];
                return Some(text);
            }
            let escape = *self.0.as_bytes().get(at + 1)?;
            self.0 = self.0.get(at + 2..)?;
            text.push(match escape {
                b'n' => '\n',
                b'r' => '\r',
                b't' => '\t',
                b'b' => '\u{8}',
                b'f' => '\u{c}',
                b'"' | b'\\' | b'/' => escape.into(),
                b'u' => {
                    let first = self.unit()?;
                    let second = self.0.strip_prefix("\\u").filter(|it| {
                        (0xd800..0xdc00).contains(&first) && it.starts_with(['d', 'D'])
                    });
                    let second = second.and_then(|rest| {
                        self.0 = rest;
                        self.unit()
                    });
                    char::decode_utf16([first].into_iter().chain(second))
                        .next()?
                        .unwrap_or(char::REPLACEMENT_CHARACTER)
                }
                _ => return None,
            });
        }
    }

    fn value(&mut self, depth: u8) -> Option<Value> {
        let depth = depth.checked_sub(1)?;
        self.0 = self.0.trim_ascii_start();
        Some(match self.0.as_bytes().first()? {
            b'"' => Value::String(self.string()?),
            b'[' if self.eat("[") => Value::Array(self.list("]", |it| it.value(depth))?),
            b'{' if self.eat("{") => Value::Object(self.list("}", |it| {
                Some((it.string()?, it.eat(":").then(|| it.value(depth))??))
            })?),
            b'n' if self.eat("null") => Value::Null,
            b't' if self.eat("true") => Value::Bool(true),
            b'f' if self.eat("false") => Value::Bool(false),
            _ => {
                let len = self
                    .0
                    .bytes()
                    .take_while(|it| matches!(it, b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E'))
                    .count();
                let (number, rest) = self.0.split_at(len);
                self.0 = rest;
                (number.parse().map(Value::Unsigned).ok())
                    .or_else(|| number.parse().map(Value::Negative).ok())
                    .or_else(|| number.parse().map(Value::Float).ok())?
            }
        })
    }
}

pub fn parse(source: &[u8]) -> Result<Value> {
    let mut parser = Parser(std::str::from_utf8(source)?);
    parser
        .value(128)
        .filter(|_| parser.0.trim_ascii().is_empty())
        .context("it is not JSON")
}

pub trait Serialize {
    fn to_json(&self) -> Value;
}

pub trait Deserialize: Sized {
    fn from_json(value: &Value) -> Result<Self>;

    fn deserialize(value: impl Borrow<Value>) -> Result<Self> {
        Self::from_json(value.borrow())
    }
}

macro_rules! from {
    ($($type:ty, $it:ident => $value:expr;)+) => {$(
        impl From<$type> for Value {
            fn from($it: $type) -> Value {
                $value
            }
        }
    )+};
}

from! {
    (), _it => Value::Null;
    bool, it => Value::Bool(it);
    f32, it => Value::Float(it.into());
    f64, it => Value::Float(it);
    &str, it => Value::String(it.into());
    String, it => Value::String(it);
    std::borrow::Cow<'_, str>, it => Value::String(it.into_owned());
}

impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(value: Option<T>) -> Value {
        value.map_or(Value::Null, Into::into)
    }
}

impl<T: Into<Value>> From<Vec<T>> for Value {
    fn from(items: Vec<T>) -> Value {
        items.into_iter().collect()
    }
}

impl<T: Into<Value>> FromIterator<T> for Value {
    fn from_iter<I: IntoIterator<Item = T>>(items: I) -> Value {
        Value::Array(items.into_iter().map(Into::into).collect())
    }
}

macro_rules! integers {
    ($($type:ty)+) => {$(
        impl From<$type> for Value {
            fn from(value: $type) -> Value {
                u64::try_from(value).map_or(Value::Negative(value as i64), Value::Unsigned)
            }
        }

        impl Deserialize for $type {
            fn from_json(value: &Value) -> Result<Self> {
                let wide = value.as_u64().map(i128::from).or(value.as_i64().map(i128::from));
                Ok(wide.context("expected an integer")?.try_into()?)
            }
        }
    )+};
}

integers!(u8 u16 u32 u64 usize i16 i32 i64 isize);

macro_rules! scalars {
    ($($type:ty)+) => {$(
        impl Serialize for $type {
            fn to_json(&self) -> Value {
                self.clone().into()
            }
        }
    )+};
}

scalars!(() bool u8 u16 u32 u64 usize i16 i32 i64 isize f32 f64 String std::borrow::Cow<'_, str> Value);

impl Serialize for str {
    fn to_json(&self) -> Value {
        self.into()
    }
}

impl Serialize for u128 {
    fn to_json(&self) -> Value {
        self.to_string().into()
    }
}

impl Serialize for PathBuf {
    fn to_json(&self) -> Value {
        self.to_string_lossy().into()
    }
}

impl<T: Serialize + ?Sized> Serialize for &T {
    fn to_json(&self) -> Value {
        (**self).to_json()
    }
}

impl<T: Serialize> Serialize for Option<T> {
    fn to_json(&self) -> Value {
        self.as_ref().map_or(Value::Null, T::to_json)
    }
}

impl<T: Serialize> Serialize for [T] {
    fn to_json(&self) -> Value {
        self.iter().map(T::to_json).collect()
    }
}

impl<T: Serialize, const N: usize> Serialize for [T; N] {
    fn to_json(&self) -> Value {
        self[..].to_json()
    }
}

impl<T: Serialize> Serialize for Vec<T> {
    fn to_json(&self) -> Value {
        self[..].to_json()
    }
}

macro_rules! read {
    ($($type:ty, $it:ident => $value:expr;)+) => {$(
        impl Deserialize for $type {
            fn from_json($it: &Value) -> Result<Self> {
                $value.context(concat!("expected ", stringify!($type)))
            }
        }
    )+};
}

read! {
    Value, it => Some(it.clone());
    bool, it => it.as_bool().or(it.is_null().then_some(false));
    f32, it => it.as_f64().map(|it| it as f32);
    f64, it => it.as_f64();
    u128, it => it.as_str().and_then(|it| it.parse().ok());
    String, it => it.as_str().map(String::from);
    PathBuf, it => it.as_str().map(PathBuf::from);
}

impl<T: Deserialize> Deserialize for Option<T> {
    fn from_json(value: &Value) -> Result<Self> {
        (!value.is_null()).then(|| T::from_json(value)).transpose()
    }
}

impl<T: Deserialize> Deserialize for Vec<T> {
    fn from_json(value: &Value) -> Result<Self> {
        value
            .as_array()
            .context("expected an array")?
            .iter()
            .map(T::from_json)
            .collect()
    }
}

impl<T: Deserialize, const N: usize> Deserialize for [T; N] {
    fn from_json(value: &Value) -> Result<Self> {
        match Vec::from_json(value)?.try_into() {
            Ok(items) => Ok(items),
            Err(_) => bail!("expected {N} items"),
        }
    }
}

macro_rules! tuples {
    ($($len:literal: $($type:ident $index:tt),+;)+) => {$(
        impl<$($type: Serialize),+> Serialize for ($($type,)+) {
            fn to_json(&self) -> Value {
                Value::Array(vec![$(self.$index.to_json()),+])
            }
        }

        impl<$($type: Deserialize),+> Deserialize for ($($type,)+) {
            fn from_json(value: &Value) -> Result<Self> {
                ensure!(value.as_array().is_some_and(|it| it.len() == $len), "expected {} items", $len);
                Ok(($($type::from_json(&value[$index])?,)+))
            }
        }
    )+};
}

tuples! {
    2: A 0, B 1;
    3: A 0, B 1, C 2;
    4: A 0, B 1, C 2, D 3;
}

/// A struct that is an object. With `default`, members may be missing. Fields after `..` are not members.
macro_rules! record {
    (@read default, $type:ty, $value:expr) => { Option::<$type>::from_json($value).map(Option::unwrap_or_default) };
    (@read required, $type:ty, $value:expr) => { <$type>::from_json($value) };
    (
        $mode:ident $(#[$meta:meta])* $visibility:vis struct $name:ident {
            $($(#[$field_meta:meta])* $field_visibility:vis $field:ident: $type:ty,)+
            $(.. $($other_visibility:vis $other:ident: $other_type:ty,)+)?
        }
    ) => {
        $(#[$meta])* $visibility struct $name {
            $($(#[$field_meta])* $field_visibility $field: $type,)+
            $($($other_visibility $other: $other_type,)+)?
        }

        impl $crate::json::Serialize for $name {
            fn to_json(&self) -> $crate::json::Value {
                $crate::json::Value::Object(vec![$(($crate::json::camel_case(stringify!($field)).collect(), self.$field.to_json())),+])
            }
        }

        impl $crate::json::Deserialize for $name {
            fn from_json(value: &$crate::json::Value) -> $crate::error::Result<Self> {
                use $crate::error::Context as _;
                Ok($name {
                    $($field: $crate::json::record!(@read $mode, $type, value.field(stringify!($field))).context(stringify!($field))?,)+
                    $($($other: Default::default(),)+)?
                })
            }
        }
    };
}

macro_rules! json {
    (@array [$($done:expr,)*] []) => { vec![$($done),*] };
    (@array [$($done:expr,)*] [$($item:tt)+]) => { vec![$($done,)* $crate::json::json!($($item)+)] };
    (@array [$($done:expr,)*] [$($item:tt)+] , $($rest:tt)*) => {
        $crate::json::json!(@array [$($done,)* $crate::json::json!($($item)+),] [] $($rest)*)
    };
    (@array $done:tt [$($item:tt)*] $next:tt $($rest:tt)*) => { $crate::json::json!(@array $done [$($item)* $next] $($rest)*) };
    (@object [$($done:expr,)*]) => { vec![$($done),*] };
    (@object $done:tt $key:tt : $($rest:tt)+) => { $crate::json::json!(@member $done $key [] $($rest)+) };
    (@member [$($done:expr,)*] $key:tt [$($value:tt)+] $(, $($rest:tt)*)?) => {
        $crate::json::json!(@object [$($done,)* (String::from($key), $crate::json::json!($($value)+)),] $($($rest)*)?)
    };
    (@member $done:tt $key:tt [$($value:tt)*] $next:tt $($rest:tt)*) => {
        $crate::json::json!(@member $done $key [$($value)* $next] $($rest)*)
    };
    (null) => { $crate::json::Value::Null };
    ([$($items:tt)*]) => { $crate::json::Value::Array($crate::json::json!(@array [] [] $($items)*)) };
    ({$($members:tt)*}) => { $crate::json::Value::Object($crate::json::json!(@object [] $($members)*)) };
    ($value:expr) => { $crate::json::Serialize::to_json(&$value) };
}

pub(crate) use {json, record};
