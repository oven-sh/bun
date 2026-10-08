//! The values of JavaScript that following a path from a node leads to, and what JavaScript's
//! operators make of them.

use super::program::{JsType, Key, Literal, Names, Property};
use crate::ast::File;
use crate::estree::{Dialect, FieldEntry, Nodes, Object, VNode, Value};
use crate::span::Span;
use crate::utils::text;
use std::cmp::Ordering;

#[derive(Copy, Clone)]
pub(super) enum Val<'a> {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    Str(&'a [u8]),
    /// A string that is not written anywhere.
    Short(Short),
    /// In decimal.
    BigInt(&'a [u8]),
    Regex {
        pattern: &'a [u8],
        flags: &'a [u8],
    },
    Object(Object<'a>),
    Node(VNode<'a>),
    /// The list that this field of this node is. It is computed again when it is looked at: a list is several times the size of
    /// everything else here, and few selectors look at one.
    List(VNode<'a>, &'static FieldEntry),
    /// `node.range`
    Range(VNode<'a>),
    /// `node.loc`
    Loc(VNode<'a>),
    /// `node.loc.start`, `node.loc.end`
    Position(&'a File<'a>, u32),
}

/// A string of at most eight bytes.
#[derive(Copy, Clone, Default)]
pub(super) struct Short {
    bytes: [u8; 8],
    len: u8,
}

impl Short {
    fn new(text: &[u8]) -> Short {
        let mut short = Short::default();
        for (to, from) in short.bytes.iter_mut().zip(text) {
            *to = *from;
            short.len += 1;
        }
        short
    }

    #[inline]
    fn as_bytes(&self) -> &[u8] {
        self.bytes.get(..self.len as usize).unwrap_or_default()
    }

    /// The UTF-16 code unit `unit`, in WTF-8.
    fn of_unit(unit: u32) -> Short {
        match unit {
            0..0x80 => Short::new(&[unit as u8]),
            0x80..0x800 => Short::new(&[0xC0 | (unit >> 6) as u8, 0x80 | (unit & 0x3F) as u8]),
            _ => Short::new(&[
                0xE0 | ((unit >> 12) & 0x0F) as u8,
                0x80 | ((unit >> 6) & 0x3F) as u8,
                0x80 | (unit & 0x3F) as u8,
            ]),
        }
    }

    /// `regex.flags`, which has them in alphabetical order.
    fn of_flags(flags: &[u8]) -> Short {
        let mut short = Short::new(flags);
        short.bytes[..short.len as usize].sort_unstable();
        short
    }
}

/// `offset` as ESLint counts: in UTF-16 code units, without a byte order mark.
fn utf16_offset(file: &File, offset: u32) -> f64 {
    let units = text::utf16_len(file.slice(Span::new(0, offset)));
    f64::from(units.saturating_sub(u32::from(file.has_bom())))
}

/// `text[index]`
fn unit_at(text: &[u8], index: u32) -> Option<Short> {
    let mut at = 0;
    for (_, c) in text::code_points(text) {
        let width = text::utf16_width(c);
        if index < at + width {
            return Some(Short::of_unit(match (width, index - at) {
                (1, _) => c,
                (_, 0) => 0xD800 + ((c - 0x1_0000) >> 10),
                _ => 0xDC00 + ((c - 0x1_0000) & 0x3FF),
            }));
        }
        at += width;
    }
    None
}

impl<'a> Val<'a> {
    /// The value of the field of `entry` in `node`, which is of the type that `entry` is of.
    #[inline]
    pub(super) fn of_field(
        node: VNode<'a>,
        entry: &'static FieldEntry,
        dialect: Dialect,
    ) -> Val<'a> {
        if !entry.is_in(dialect) {
            return Val::Undefined;
        }
        match (entry.get)(node) {
            Value::Undefined => Val::Undefined,
            Value::Null => Val::Null,
            Value::Bool(value) => Val::Bool(value),
            Value::Number(value) => Val::Number(value),
            Value::Str(value) => Val::Str(value),
            Value::Regex { pattern, flags } => Val::Regex { pattern, flags },
            Value::BigInt(digits) => Val::BigInt(digits),
            Value::Object(object) => Val::Object(object),
            Value::Node(node) => Val::Node(node),
            Value::Nodes(_) => Val::List(node, entry),
        }
    }

    /// The elements, if it is a list.
    pub(super) fn elements(self) -> Option<Nodes<'a>> {
        match self {
            Val::List(node, entry) => match (entry.get)(node) {
                Value::Nodes(nodes) => Some(nodes),
                _ => None,
            },
            _ => None,
        }
    }

    /// `value == null`
    #[inline]
    pub(super) fn is_nullish(self) -> bool {
        matches!(self, Val::Undefined | Val::Null)
    }

    /// `typeof value`
    pub(super) fn js_type(self) -> JsType {
        match self {
            Val::Undefined => JsType::Undefined,
            Val::Bool(_) => JsType::Boolean,
            Val::Number(_) => JsType::Number,
            Val::Str(_) | Val::Short(_) => JsType::String,
            Val::BigInt(_) => JsType::BigInt,
            _ => JsType::Object,
        }
    }

    /// `value[key]`, for a value that is not nullish.
    pub(super) fn get(self, key: Key, dialect: Dialect) -> Val<'a> {
        use Property as P;
        let is_espree = dialect == Dialect::Espree;
        let string = |text: &[u8]| match key.property {
            P::Length => Val::Number(f64::from(text::utf16_len(text))),
            P::Index(index) => unit_at(text, index).map_or(Val::Undefined, Val::Short),
            _ => Val::Undefined,
        };
        match (self, key.property) {
            (Val::Node(node), P::Type) => Val::Str(node.node_type().name().as_bytes()),
            (Val::Node(node), P::Parent) => node.parent().map_or(Val::Null, Val::Node),
            (Val::Node(node), P::Range) => Val::Range(node),
            (Val::Node(node), P::Loc) => Val::Loc(node),
            (Val::Node(node), P::Start) if is_espree => {
                Val::Number(utf16_offset(node.file(), node.span().start))
            }
            (Val::Node(node), P::End) if is_espree => {
                Val::Number(utf16_offset(node.file(), node.span().end))
            }
            (Val::Node(node), _) => {
                let entry = key.field.and_then(|field| node.node_type().field(field));
                entry.map_or(Val::Undefined, |entry| Val::of_field(node, entry, dialect))
            }

            (Val::List(..), P::Length) => Val::Number(self.elements().map_or(0, Nodes::len) as f64),
            (Val::List(..), P::Index(index)) => {
                match self.elements().and_then(|it| it.get(index as usize)) {
                    Some(Some(node)) => Val::Node(node),
                    Some(None) => Val::Null,
                    None => Val::Undefined,
                }
            }

            (Val::Str(text), _) => string(text),
            (Val::Short(text), _) => string(text.as_bytes()),

            (Val::Object(Object::Template { cooked, .. }), P::Cooked) => {
                cooked.map_or(Val::Null, Val::Str)
            }
            (Val::Object(Object::Template { raw, .. }), P::Raw) => Val::Str(raw),
            (Val::Object(Object::Regex { pattern, .. }), P::Pattern) => Val::Str(pattern),
            (Val::Object(Object::Regex { flags, .. }), P::Flags) => Val::Str(flags),

            (Val::Regex { pattern, .. }, P::Source) => Val::Str(pattern),
            (Val::Regex { flags, .. }, P::Flags) => Val::Short(Short::of_flags(flags)),
            (Val::Regex { flags, .. }, P::HasFlag(flag)) => {
                Val::Bool(bun_core::strings::contains_char(flags, flag))
            }
            (Val::Regex { .. }, P::LastIndex) => Val::Number(0.0),

            (Val::Range(node), P::Index(0)) => {
                Val::Number(utf16_offset(node.file(), node.span().start))
            }
            (Val::Range(node), P::Index(1)) => {
                Val::Number(utf16_offset(node.file(), node.span().end))
            }
            (Val::Range(_), P::Length) => Val::Number(2.0),
            (Val::Loc(node), P::Start) => Val::Position(node.file(), node.span().start),
            (Val::Loc(node), P::End) => Val::Position(node.file(), node.span().end),
            (Val::Position(file, offset), P::Line) => {
                Val::Number(f64::from(file.position(offset).line))
            }
            (Val::Position(file, offset), P::Column) => {
                Val::Number(f64::from(file.position(offset).column))
            }
            _ => Val::Undefined,
        }
    }

    /// Calls `then` with `String(value)`.
    pub(super) fn with_string<R>(self, then: impl FnOnce(&[u8]) -> R) -> R {
        match self {
            Val::Undefined => then(b"undefined"),
            Val::Null => then(b"null"),
            Val::Bool(true) => then(b"true"),
            Val::Bool(false) => then(b"false"),
            Val::Number(value) => then(&text::number_to_string(value)),
            Val::Str(text) | Val::BigInt(text) => then(text),
            Val::Short(text) => then(text.as_bytes()),
            Val::Object(_) | Val::Node(_) | Val::Loc(_) | Val::Position(..) => {
                then(b"[object Object]")
            }
            Val::Regex { pattern, flags } => {
                then(&[b"/", pattern, b"/", Short::of_flags(flags).as_bytes()].concat())
            }
            Val::List(..) | Val::Range(_) => then(&self.joined()),
        }
    }

    /// `String(value)` of an array.
    fn joined(self) -> Vec<u8> {
        if let Val::Range(node) = self {
            let (file, span) = (node.file(), node.span());
            let mut joined = text::number_to_string(utf16_offset(file, span.start));
            joined.push(b',');
            joined.extend_from_slice(&text::number_to_string(utf16_offset(file, span.end)));
            return joined;
        }
        let mut joined = Vec::new();
        for (i, node) in self.elements().into_iter().flatten().enumerate() {
            if i > 0 {
                joined.push(b',');
            }
            if node.is_some() {
                joined.extend_from_slice(b"[object Object]");
            }
        }
        joined
    }

    /// `String(value) === String(literal)`
    pub(super) fn equals(self, literal: &Literal) -> bool {
        match self {
            Val::Str(text) | Val::BigInt(text) => *text == *literal.text,
            Val::Undefined => literal.names == Names::Undefined,
            Val::Null => literal.names == Names::Null,
            Val::Bool(value) => literal.names == Names::Bool(value),
            Val::Number(value) => {
                literal.names == Names::Number
                    && (value == literal.number || value.is_nan() && literal.number.is_nan())
            }
            Val::Object(_) | Val::Node(_) | Val::Loc(_) | Val::Position(..) => {
                literal.names == Names::Object
            }
            Val::Short(_) | Val::Regex { .. } | Val::List(..) | Val::Range(_) => {
                self.with_string(|text| *text == *literal.text)
            }
        }
    }

    /// How `value` compares to `literal` for `<` and the like. `None` if one of them is `NaN`.
    pub(super) fn compare(self, literal: &Literal) -> Option<Ordering> {
        let number = match self {
            Val::Undefined => f64::NAN,
            Val::Null => 0.0,
            Val::Bool(value) => f64::from(u8::from(value)),
            Val::Number(value) => value,
            Val::BigInt(digits) => text::string_to_number(digits),
            // Objects are converted to strings first.
            _ if literal.is_number => self.with_string(text::string_to_number),
            _ => return Some(self.with_string(|text| text::compare(text, &literal.text))),
        };
        number.partial_cmp(&literal.number)
    }
}
