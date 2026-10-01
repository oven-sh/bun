// Model of the sink protocol of the type grammar. `--cfg p2` adds what the Build sink needs.
// The crate is named bun_js_parser so that fnasm.py and fncmp.py read its symbols.
#![allow(dead_code, unexpected_cfgs, clippy::all)]
use std::hint::black_box;

#[derive(Debug)]
pub enum Error {
    Syntax,
    Backtrack,
    StackOverflow,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum T {
    EndOfFile,
    Number,
    Str,
    OpenBracket,
    CloseBracket,
    OpenParen,
    CloseParen,
    OpenBrace,
    CloseBrace,
    Bar,
    Ampersand,
    Dot,
    DotDotDot,
    LessThan,
    GreaterThan,
    GreaterThanGreaterThan,
    GreaterThanGreaterThanGreaterThan,
    GreaterThanEquals,
    GreaterThanGreaterThanEquals,
    Equals,
    EqualsGreaterThan,
    Comma,
    Semicolon,
    Question,
    Colon,
    Minus,
    Exclamation,
    // identifiers and keywords last, as in the lexer
    Identifier,
    Extends,
    Void,
    This,
    Typeof,
}

pub struct Arena;
impl Arena {
    #[allow(clippy::mut_from_ref)]
    pub fn alloc<V>(&self, v: V) -> &'static mut V {
        Box::leak(Box::new(v))
    }
}

pub struct Lexer<'a> {
    pub contents: &'a [u8],
    pub current: usize,
    pub start: usize,
    pub end: usize,
    pub token: T,
    pub has_newline_before: bool,
    pub is_log_disabled: bool,
    pub identifier: &'a [u8],
    pub number: f64,
    pub arena: &'a Arena,
    pub all_comments: Vec<(u32, u32)>,
    pub errors: u32,
}

impl<'a> Lexer<'a> {
    pub fn new(contents: &'a [u8], arena: &'a Arena) -> Self {
        Lexer {
            contents,
            current: 0,
            start: 0,
            end: 0,
            token: T::EndOfFile,
            has_newline_before: false,
            is_log_disabled: false,
            identifier: b"",
            number: 0.0,
            arena,
            all_comments: Vec::new(),
            errors: 0,
        }
    }
    #[inline(never)]
    pub fn next(&mut self) -> Result<(), Error> {
        let c = self.contents;
        let mut i = self.end;
        self.has_newline_before = false;
        loop {
            if i >= c.len() {
                self.start = c.len();
                self.end = c.len();
                self.token = T::EndOfFile;
                return Ok(());
            }
            match c[i] {
                b' ' | b'\t' => i += 1,
                b'\n' => {
                    self.has_newline_before = true;
                    i += 1
                }
                b'/' if c.get(i + 1) == Some(&b'*') => {
                    let s = i;
                    i += 2;
                    while i + 1 < c.len() && !(c[i] == b'*' && c[i + 1] == b'/') {
                        i += 1;
                    }
                    i = (i + 2).min(c.len());
                    self.all_comments.push((s as u32, i as u32));
                }
                _ => break,
            }
        }
        self.start = i;
        let b = c[i];
        let (tok, len) = match b {
            b'[' => (T::OpenBracket, 1),
            b']' => (T::CloseBracket, 1),
            b'(' => (T::OpenParen, 1),
            b')' => (T::CloseParen, 1),
            b'{' => (T::OpenBrace, 1),
            b'}' => (T::CloseBrace, 1),
            b'|' => (T::Bar, 1),
            b'&' => (T::Ampersand, 1),
            b',' => (T::Comma, 1),
            b';' => (T::Semicolon, 1),
            b'?' => (T::Question, 1),
            b':' => (T::Colon, 1),
            b'-' => (T::Minus, 1),
            b'!' => (T::Exclamation, 1),
            b'<' => (T::LessThan, 1),
            b'.' => {
                if c[i..].starts_with(b"...") {
                    (T::DotDotDot, 3)
                } else {
                    (T::Dot, 1)
                }
            }
            b'=' => {
                if c.get(i + 1) == Some(&b'>') {
                    (T::EqualsGreaterThan, 2)
                } else {
                    (T::Equals, 1)
                }
            }
            b'>' => {
                let r = &c[i..];
                if r.starts_with(b">>>") {
                    (T::GreaterThanGreaterThanGreaterThan, 3)
                } else if r.starts_with(b">>=") {
                    (T::GreaterThanGreaterThanEquals, 3)
                } else if r.starts_with(b">>") {
                    (T::GreaterThanGreaterThan, 2)
                } else if r.starts_with(b">=") {
                    (T::GreaterThanEquals, 2)
                } else {
                    (T::GreaterThan, 1)
                }
            }
            b'0'..=b'9' => {
                let mut j = i;
                let mut v = 0f64;
                while j < c.len() && c[j].is_ascii_digit() {
                    v = v * 10.0 + (c[j] - b'0') as f64;
                    j += 1;
                }
                self.number = v;
                (T::Number, j - i)
            }
            b'"' => {
                let mut j = i + 1;
                while j < c.len() && c[j] != b'"' {
                    j += 1;
                }
                self.identifier = &c[i + 1..j.min(c.len())];
                (T::Str, (j + 1).min(c.len()) - i)
            }
            _ if b.is_ascii_alphabetic() || b == b'_' || b == b'$' => {
                let mut j = i;
                while j < c.len() && (c[j].is_ascii_alphanumeric() || c[j] == b'_' || c[j] == b'$') {
                    j += 1;
                }
                let word = &c[i..j];
                self.identifier = word;
                let tok = match word {
                    b"extends" => T::Extends,
                    b"void" => T::Void,
                    b"this" => T::This,
                    b"typeof" => T::Typeof,
                    _ => T::Identifier,
                };
                (tok, j - i)
            }
            _ => return Err(Error::Syntax),
        };
        self.token = tok;
        self.end = i + len;
        self.current = self.end;
        Ok(())
    }
    #[cold]
    #[inline(never)]
    pub fn expected(&mut self, _token: T) -> Result<(), Error> {
        if self.is_log_disabled {
            return Err(Error::Backtrack);
        }
        self.errors += 1;
        Ok(())
    }
    #[cold]
    #[inline(never)]
    pub fn unexpected(&mut self) -> Result<(), Error> {
        if !self.is_log_disabled {
            self.errors += 1;
        }
        Ok(())
    }
    #[inline]
    pub fn expect(&mut self, token: T) -> Result<(), Error> {
        if self.token != token {
            self.expected(token)?;
        }
        self.next()
    }
    #[inline(never)]
    pub fn expect_greater_than(&mut self) -> Result<(), Error> {
        match self.token {
            T::GreaterThan => self.next()?,
            T::GreaterThanEquals => {
                self.token = T::Equals;
                self.start += 1;
                if self.contents.get(self.end) == Some(&b'>') {
                    self.token = T::EqualsGreaterThan;
                    self.end += 1;
                }
            }
            T::GreaterThanGreaterThanEquals => {
                self.token = T::GreaterThanEquals;
                self.start += 1;
            }
            T::GreaterThanGreaterThan => {
                self.token = T::GreaterThan;
                self.start += 1;
            }
            T::GreaterThanGreaterThanGreaterThan => {
                self.token = T::GreaterThanGreaterThan;
                self.start += 1;
            }
            _ => self.expected(T::GreaterThan)?,
        }
        Ok(())
    }
    #[inline]
    pub fn is_identifier_or_keyword(&self) -> bool {
        (self.token as u8) >= (T::Identifier as u8)
    }
    #[inline(always)]
    pub fn raw(&self) -> &'a [u8] {
        &self.contents[self.start..self.end]
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd)]
#[repr(u8)]
pub enum Level {
    Lowest,
    BitwiseOr,
    BitwiseAnd,
    Prefix,
}

// ---------------------------------------------------------------- nodes (stand-in for bun_ast::ts)
pub mod ts {
    #[derive(Clone, Copy, Debug)]
    pub struct Type {
        pub start: u32,
        pub end: u32,
        pub data: TypeData,
    }
    #[derive(Clone, Copy, Debug)]
    pub struct NodeList<V: 'static> {
        pub items: &'static [V],
        pub end: u32,
    }
    #[derive(Clone, Copy, Debug)]
    pub struct Identifier {
        pub start: u32,
        pub end: u32,
        pub text: &'static [u8],
    }
    #[derive(Clone, Copy, Debug)]
    pub enum EntityName {
        Identifier(Identifier),
        Qualified(&'static QualifiedName),
    }
    impl EntityName {
        pub fn start(&self) -> u32 {
            match self {
                EntityName::Identifier(i) => i.start,
                EntityName::Qualified(q) => q.start,
            }
        }
        pub fn end(&self) -> u32 {
            match self {
                EntityName::Identifier(i) => i.end,
                EntityName::Qualified(q) => q.end,
            }
        }
    }
    #[derive(Debug)]
    pub struct QualifiedName {
        pub start: u32,
        pub end: u32,
        pub left: EntityName,
        pub right: Identifier,
    }
    #[derive(Debug)]
    pub struct TypeReference {
        pub type_name: EntityName,
        pub type_arguments: Option<NodeList<Type>>,
    }
    #[derive(Debug)]
    pub struct Conditional {
        pub check: Type,
        pub extends: Type,
        pub when_true: Type,
        pub when_false: Type,
    }
    #[derive(Debug)]
    pub struct NamedTupleMember {
        pub dot_dot_dot: Option<u32>,
        pub name: Identifier,
        pub question: Option<u32>,
        pub type_node: Type,
    }
    #[derive(Debug)]
    pub struct PropertySignature {
        pub start: u32,
        pub end: u32,
        pub name: Identifier,
        pub question: Option<u32>,
        pub type_node: Option<Type>,
    }
    #[derive(Clone, Copy, Debug)]
    pub enum TypeData {
        Keyword(u8),
        This,
        Number(f64),
        Negative(f64, u32),
        Str(&'static [u8]),
        TypeReference(&'static TypeReference),
        TypeQuery(&'static TypeReference),
        Array(&'static Type),
        IndexedAccess(&'static (Type, Type)),
        Tuple(&'static NodeList<Type>),
        NamedTupleMember(&'static NamedTupleMember),
        Rest(&'static Type),
        Optional(&'static Type),
        Union(&'static NodeList<Type>),
        Intersection(&'static NodeList<Type>),
        Conditional(&'static Conditional),
        Parenthesized(&'static Type),
        NonNull(&'static Type),
        Nullable(&'static Type),
        TypeLiteral(&'static NodeList<PropertySignature>),
        Operator(u8, &'static Type),
    }
}

// ---------------------------------------------------------------- the sink
pub enum TypeLiteral {
    Number,
    String,
}
pub enum TypeKeyword {
    Any,
    Number,
    String,
    Void,
    This,
}
pub enum Operand<V> {
    Decided,
    Open(V),
}

#[derive(Clone, Default, Debug, PartialEq)]
pub enum Metadata {
    #[default]
    MNone,
    MAny,
    MVoid,
    MArray,
    MString,
    MObject,
    MNumber,
    MFunction,
    MIdentifier(u32),
    MDot(Vec<u32>),
}

/// A child type as the parent keeps it.
pub type Kept<S> = <<S as TypeSink>::Sub as TypeSink>::Out;
/// `V` in the sink that builds nodes, nothing in the others.
#[cfg(p2)]
pub type KK<S, V> = <<S as TypeSink>::Sub as TypeSink>::K<V>;
/// A value to start from that costs no code.
pub trait ConstDefault {
    const DEFAULT: Self;
}
impl ConstDefault for () {
    const DEFAULT: () = ();
}
impl ConstDefault for u32 {
    const DEFAULT: u32 = 0;
}
impl<V> ConstDefault for Option<V> {
    const DEFAULT: Option<V> = None;
}

pub trait TypeSink {
    type Out: Default;
    const STRICT: bool;
    /// No type read yet.
    const NONE: Self::Out;
    /// True in the sink that builds nodes.
    #[cfg(p2)]
    const BUILDS: bool;

    fn literal(out: &mut Self::Out, literal: TypeLiteral);
    fn keyword(out: &mut Self::Out, keyword: TypeKeyword);
    fn parenthesized(out: &mut Self::Out, inner: Self::Out);
    fn keyof_type(out: &mut Self::Out);
    fn typeof_query(out: &mut Self::Out);
    fn tuple_type(out: &mut Self::Out);
    fn object_type(out: &mut Self::Out);
    fn reference<'a, E>(out: &mut Self::Out, name: &'a [u8], find: impl FnOnce(&'a [u8]) -> Result<u32, E>) -> Result<(), E>;
    fn member<'a, E>(out: &mut Self::Out, name: &'a [u8], is_name: bool, find: impl FnOnce(&'a [u8]) -> Result<u32, E>) -> Result<(), E>;
    fn index_or_array(out: &mut Self::Out, has_index: bool);
    fn union_left(out: &mut Self::Out, load_name: impl Fn(u32) -> u32) -> Operand<Self::Out>;
    fn union_right(out: &mut Self::Out, left: Self::Out);
    fn intersection_left(out: &mut Self::Out, load_name: impl Fn(u32) -> u32) -> Operand<Self::Out>;
    fn intersection_right(out: &mut Self::Out, left: Self::Out);
    fn conditional_true(out: &mut Self::Out, when_true: Self::Out, load_name: impl Fn(u32) -> u32) -> Operand<Self::Out>;
    fn conditional_false(out: &mut Self::Out, left: Self::Out);

    // ------------------------------------------------------------ what `--cfg p2` adds
    /// The sink that reads a part of which this sink keeps only what `Sub` keeps.
    type Sub: TypeSink<Sub = Self::Sub>;
    /// `V` in the sink that builds nodes, nothing in the others.
    #[cfg(p2)]
    type K<V: ConstDefault>: ConstDefault;

    #[cfg(p2)]
    #[inline]
    fn start(_lx: &Lexer<'_>) -> KK<Self, u32> {
        ConstDefault::DEFAULT
    }
    #[cfg(p2)]
    #[inline]
    fn tok(_lx: &Lexer<'_>) -> KK<Self, Option<u32>> {
        ConstDefault::DEFAULT
    }
    #[cfg(p2)]
    #[inline]
    fn node(_out: &Self::Out) -> Kept<Self> {
        <Self::Sub as TypeSink>::NONE
    }
    #[cfg(p2)]
    #[inline]
    fn b_token_type(_lx: &Lexer<'_>, _out: &mut Self::Out) {}
    #[cfg(p2)]
    #[inline]
    fn b_string(_lx: &mut Lexer<'_>, _out: &mut Self::Out) -> Result<(), Error> {
        Ok(())
    }
    #[cfg(p2)]
    #[inline]
    fn b_negative(_lx: &Lexer<'_>, _out: &mut Self::Out, _start: &KK<Self, u32>) {}
    #[cfg(p2)]
    #[inline]
    fn b_name(_lx: &Lexer<'_>, _name: &mut KK<Self, b::Name>) {}
    #[cfg(p2)]
    #[inline]
    fn b_reference(_out: &mut Self::Out, _name: KK<Self, b::Name>, _args: KK<Self, Option<b::Closed<ts::Type>>>, _query: KK<Self, Option<u32>>) {}
    #[cfg(p2)]
    #[inline]
    fn b_wrap(_lx: &Lexer<'_>, _out: &mut Self::Out, _start: &KK<Self, u32>, _kind: b::Wrap, _inner: Kept<Self>) {}
    #[cfg(p2)]
    #[inline]
    fn b_postfix(_lx: &Lexer<'_>, _out: &mut Self::Out, _index: Kept<Self>) {}
    #[cfg(p2)]
    #[inline]
    fn list<V>(_lx: &Lexer<'_>) -> KK<Self, b::List<V>> {
        ConstDefault::DEFAULT
    }
    #[cfg(p2)]
    #[inline]
    #[cfg(p2)]
    #[inline]
    fn push_type(_list: &mut KK<Self, b::List<ts::Type>>, _item: Kept<Self>) {}
    #[cfg(p2)]
    #[inline]
    fn sep<V>(_lx: &Lexer<'_>, _list: &mut KK<Self, b::List<V>>) {}
    #[cfg(p2)]
    #[inline]
    fn close<V>(_lx: &Lexer<'_>, _list: KK<Self, b::List<V>>) -> KK<Self, Option<b::Closed<V>>> {
        ConstDefault::DEFAULT
    }
    #[cfg(p2)]
    #[inline]
    fn b_tuple(_out: &mut Self::Out, _start: &KK<Self, u32>, _list: KK<Self, Option<b::Closed<ts::Type>>>) {}
    #[cfg(p2)]
    #[inline]
    fn b_tuple_member(_lx: &Lexer<'_>, _out: &mut Self::Out, _start: &KK<Self, u32>, _dots: KK<Self, Option<u32>>, _name: KK<Self, b::Name>, _question: KK<Self, Option<u32>>, _ty: Kept<Self>) {}
    #[cfg(p2)]
    #[inline]
    fn b_set(_out: &mut Self::Out, _start: &KK<Self, u32>, _list: KK<Self, b::List<ts::Type>>, _union: bool) {}
    #[cfg(p2)]
    #[inline]
    fn b_conditional(_out: &mut Self::Out, _check: Kept<Self>, _extends: Kept<Self>, _when_true: Kept<Self>) {}
    #[cfg(p2)]
    #[inline]
    fn b_member_start(_lx: &Lexer<'_>) -> KK<Self, b::Decl> {
        ConstDefault::DEFAULT
    }
    #[cfg(p2)]
    #[inline]
    fn b_member_question(_lx: &Lexer<'_>, _decl: &mut KK<Self, b::Decl>) {}
    #[cfg(p2)]
    #[inline]
    fn b_member_type(_decl: &mut KK<Self, b::Decl>, _ty: Kept<Self>) {}
    #[cfg(p2)]
    #[inline]
    fn b_member_end(_lx: &Lexer<'_>, _decl: &mut KK<Self, b::Decl>) {}
    #[cfg(p2)]
    #[inline]
    fn b_member(_list: &mut KK<Self, b::List<ts::PropertySignature>>, _decl: KK<Self, b::Decl>) {}
    #[cfg(p2)]
    #[inline]
    fn b_object(_out: &mut Self::Out, _start: &KK<Self, u32>, _list: KK<Self, Option<b::Closed<ts::PropertySignature>>>) {}
}

pub struct Discard;
impl TypeSink for Discard {
    type Out = ();
    const STRICT: bool = false;
    const NONE: () = ();
    #[cfg(p2)]
    const BUILDS: bool = false;
    type Sub = Discard;
    #[cfg(p2)]
    type K<V: ConstDefault> = ();

    #[inline]
    fn literal(_out: &mut (), _literal: TypeLiteral) {}
    #[inline]
    fn keyword(_out: &mut (), _keyword: TypeKeyword) {}
    #[inline]
    fn parenthesized(_out: &mut (), _inner: ()) {}
    #[inline]
    fn keyof_type(_out: &mut ()) {}
    #[inline]
    fn typeof_query(_out: &mut ()) {}
    #[inline]
    fn tuple_type(_out: &mut ()) {}
    #[inline]
    fn object_type(_out: &mut ()) {}
    #[inline]
    fn reference<'a, E>(_out: &mut (), _name: &'a [u8], _find: impl FnOnce(&'a [u8]) -> Result<u32, E>) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn member<'a, E>(_out: &mut (), _name: &'a [u8], _is_name: bool, _find: impl FnOnce(&'a [u8]) -> Result<u32, E>) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn index_or_array(_out: &mut (), _has_index: bool) {}
    #[inline]
    fn union_left(_out: &mut (), _load_name: impl Fn(u32) -> u32) -> Operand<()> {
        Operand::Open(())
    }
    #[inline]
    fn union_right(_out: &mut (), _left: ()) {}
    #[inline]
    fn intersection_left(_out: &mut (), _load_name: impl Fn(u32) -> u32) -> Operand<()> {
        Operand::Open(())
    }
    #[inline]
    fn intersection_right(_out: &mut (), _left: ()) {}
    #[inline]
    fn conditional_true(_out: &mut (), _when_true: (), _load_name: impl Fn(u32) -> u32) -> Operand<()> {
        Operand::Open(())
    }
    #[inline]
    fn conditional_false(_out: &mut (), _left: ()) {}
}

pub struct DecoratorMetadata;
impl TypeSink for DecoratorMetadata {
    type Out = Metadata;
    const STRICT: bool = false;
    const NONE: Metadata = Metadata::MNone;
    #[cfg(p2)]
    const BUILDS: bool = false;
    type Sub = Discard;
    #[cfg(p2)]
    type K<V: ConstDefault> = ();

    #[inline]
    fn literal(out: &mut Metadata, literal: TypeLiteral) {
        *out = match literal {
            TypeLiteral::Number => Metadata::MNumber,
            TypeLiteral::String => Metadata::MString,
        };
    }
    #[inline]
    fn keyword(out: &mut Metadata, keyword: TypeKeyword) {
        *out = match keyword {
            TypeKeyword::Any => Metadata::MAny,
            TypeKeyword::Number => Metadata::MNumber,
            TypeKeyword::String => Metadata::MString,
            TypeKeyword::Void => Metadata::MVoid,
            TypeKeyword::This => Metadata::MObject,
        };
    }
    #[inline]
    fn parenthesized(out: &mut Metadata, inner: Metadata) {
        *out = inner;
    }
    #[inline]
    fn keyof_type(out: &mut Metadata) {
        *out = Metadata::MObject;
    }
    #[inline]
    fn typeof_query(out: &mut Metadata) {
        *out = Metadata::MObject;
    }
    #[inline]
    fn tuple_type(out: &mut Metadata) {
        *out = Metadata::MArray;
    }
    #[inline]
    fn object_type(out: &mut Metadata) {
        *out = Metadata::MObject;
    }
    #[inline]
    fn reference<'a, E>(out: &mut Metadata, name: &'a [u8], find: impl FnOnce(&'a [u8]) -> Result<u32, E>) -> Result<(), E> {
        *out = Metadata::MIdentifier(find(name)?);
        Ok(())
    }
    #[inline]
    fn member<'a, E>(out: &mut Metadata, name: &'a [u8], is_name: bool, find: impl FnOnce(&'a [u8]) -> Result<u32, E>) -> Result<(), E> {
        match out {
            Metadata::MIdentifier(id) => {
                let id = *id;
                let mut dot: Vec<u32> = Vec::with_capacity(2);
                dot.push(id);
                dot.push(find(name)?);
                *out = Metadata::MDot(dot);
            }
            Metadata::MDot(dot) => {
                if is_name {
                    dot.push(find(name)?);
                }
            }
            _ => {}
        }
        Ok(())
    }
    #[inline]
    fn index_or_array(out: &mut Metadata, has_index: bool) {
        *out = if has_index && !matches!(*out, Metadata::MNone) { Metadata::MObject } else { Metadata::MArray };
    }
    #[inline]
    fn union_left(out: &mut Metadata, load_name: impl Fn(u32) -> u32) -> Operand<Metadata> {
        let left = out.clone();
        match left {
            Metadata::MAny | Metadata::MObject => {
                *out = Metadata::MObject;
                Operand::Decided
            }
            Metadata::MIdentifier(r) if load_name(r) == 7 => {
                *out = Metadata::MObject;
                Operand::Decided
            }
            _ => Operand::Open(left),
        }
    }
    #[inline]
    fn union_right(out: &mut Metadata, left: Metadata) {
        if !matches!(left, Metadata::MNone) && core::mem::discriminant(out) != core::mem::discriminant(&left) {
            *out = Metadata::MObject;
        }
    }
    #[inline]
    fn intersection_left(out: &mut Metadata, load_name: impl Fn(u32) -> u32) -> Operand<Metadata> {
        Self::union_left(out, load_name)
    }
    #[inline]
    fn intersection_right(out: &mut Metadata, left: Metadata) {
        Self::union_right(out, left)
    }
    #[inline]
    fn conditional_true(out: &mut Metadata, when_true: Metadata, load_name: impl Fn(u32) -> u32) -> Operand<Metadata> {
        let mut left = when_true;
        match Self::union_left(&mut left, load_name) {
            Operand::Decided => {
                *out = left;
                Operand::Decided
            }
            Operand::Open(l) => Operand::Open(l),
        }
    }
    #[inline]
    fn conditional_false(out: &mut Metadata, left: Metadata) {
        Self::union_right(out, left)
    }
}

// ---------------------------------------------------------------- the Build sink (p2 only)
#[cfg(p2)]
pub mod b {
    use super::{Lexer, T, ts};
    pub trait Ranged {
        fn end(&self) -> u32;
    }
    impl Ranged for ts::Type {
        fn end(&self) -> u32 {
            self.end
        }
    }
    impl Ranged for ts::PropertySignature {
        fn end(&self) -> u32 {
            self.end
        }
    }
    /// An entity name being read.
    pub struct Name(pub Option<ts::EntityName>);
    impl super::ConstDefault for Name {
        const DEFAULT: Name = Name(None);
    }
    /// The elements read so far and the offset after the last token of the list.
    pub struct List<V> {
        pub items: Vec<V>,
        pub end: u32,
    }
    impl<V> super::ConstDefault for List<V> {
        const DEFAULT: List<V> = List { items: Vec::new(), end: 0 };
    }
    /// A list between brackets and the offset after its closing token.
    pub struct Closed<V: 'static> {
        pub list: ts::NodeList<V>,
        pub close_end: u32,
    }
    #[derive(Clone, Copy)]
    pub enum Wrap {
        Parenthesized,
        KeyOf,
        Rest,
        NonNull,
    }
    impl super::ConstDefault for Decl {
        const DEFAULT: Decl = Decl { start: 0, end: 0, name: None, question: None, type_node: None };
    }
    pub struct Decl {
        pub start: u32,
        pub end: u32,
        pub name: Option<ts::Identifier>,
        pub question: Option<u32>,
        pub type_node: Option<ts::Type>,
    }
    pub fn ident(lx: &Lexer<'_>) -> ts::Identifier {
        // SAFETY: model only, the source outlives the nodes.
        let text: &'static [u8] = unsafe { core::mem::transmute::<&[u8], &'static [u8]>(lx.raw()) };
        ts::Identifier { start: lx.start as u32, end: lx.end as u32, text }
    }
    pub fn leak<V>(v: Vec<V>) -> &'static [V] {
        Vec::leak(v)
    }
    pub fn token_type(lx: &Lexer<'_>) -> Option<ts::Type> {
        let (start, end) = (lx.start as u32, lx.end as u32);
        let data = match lx.token {
            T::Number => ts::TypeData::Number(lx.number),
            T::Str => ts::TypeData::Str(ident(lx).text),
            T::Void => ts::TypeData::Keyword(1),
            T::This => ts::TypeData::This,
            T::Identifier => match lx.identifier {
                b"any" => ts::TypeData::Keyword(2),
                b"number" => ts::TypeData::Keyword(3),
                b"string" => ts::TypeData::Keyword(4),
                _ => return None,
            },
            _ => return None,
        };
        Some(ts::Type { start, end, data })
    }
}

#[cfg(p2)]
pub struct Build;
#[cfg(p2)]
impl TypeSink for Build {
    type Out = Option<ts::Type>;
    const STRICT: bool = true;
    const NONE: Option<ts::Type> = None;
    const BUILDS: bool = true;
    type Sub = Build;
    type K<V: ConstDefault> = V;

    #[inline]
    fn literal(_out: &mut Self::Out, _literal: TypeLiteral) {}
    #[inline]
    fn keyword(_out: &mut Self::Out, _keyword: TypeKeyword) {}
    #[inline]
    fn parenthesized(_out: &mut Self::Out, _inner: Self::Out) {}
    #[inline]
    fn keyof_type(_out: &mut Self::Out) {}
    #[inline]
    fn typeof_query(_out: &mut Self::Out) {}
    #[inline]
    fn tuple_type(_out: &mut Self::Out) {}
    #[inline]
    fn object_type(_out: &mut Self::Out) {}
    #[inline]
    fn reference<'a, E>(_out: &mut Self::Out, _name: &'a [u8], _find: impl FnOnce(&'a [u8]) -> Result<u32, E>) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn member<'a, E>(_out: &mut Self::Out, _name: &'a [u8], _is_name: bool, _find: impl FnOnce(&'a [u8]) -> Result<u32, E>) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn index_or_array(_out: &mut Self::Out, _has_index: bool) {}
    #[inline]
    fn union_left(out: &mut Self::Out, _load_name: impl Fn(u32) -> u32) -> Operand<Self::Out> {
        Operand::Open(*out)
    }
    #[inline]
    fn union_right(_out: &mut Self::Out, _left: Self::Out) {}
    #[inline]
    fn intersection_left(out: &mut Self::Out, _load_name: impl Fn(u32) -> u32) -> Operand<Self::Out> {
        Operand::Open(*out)
    }
    #[inline]
    fn intersection_right(_out: &mut Self::Out, _left: Self::Out) {}
    #[inline]
    fn conditional_true(_out: &mut Self::Out, when_true: Self::Out, _load_name: impl Fn(u32) -> u32) -> Operand<Self::Out> {
        Operand::Open(when_true)
    }
    #[inline]
    fn conditional_false(_out: &mut Self::Out, _left: Self::Out) {}

    fn start(lx: &Lexer<'_>) -> u32 {
        lx.start as u32
    }
    fn tok(lx: &Lexer<'_>) -> Option<u32> {
        Some(lx.start as u32)
    }
    fn node(out: &Self::Out) -> Option<ts::Type> {
        *out
    }
    fn b_token_type(lx: &Lexer<'_>, out: &mut Self::Out) {
        *out = b::token_type(lx);
    }
    fn b_string(lx: &mut Lexer<'_>, out: &mut Self::Out) -> Result<(), Error> {
        if lx.raw().contains(&b'\\') {
            lx.errors += 1;
            return Err(Error::Syntax);
        }
        *out = b::token_type(lx);
        Ok(())
    }
    fn b_negative(lx: &Lexer<'_>, out: &mut Self::Out, start: &u32) {
        *out = Some(ts::Type { start: *start, end: lx.end as u32, data: ts::TypeData::Negative(lx.number, lx.start as u32) });
    }
    fn b_name(lx: &Lexer<'_>, name: &mut b::Name) {
        let right = b::ident(lx);
        name.0 = Some(match name.0 {
            None => ts::EntityName::Identifier(right),
            Some(left) => ts::EntityName::Qualified(lx.arena.alloc(ts::QualifiedName { start: left.start(), end: right.end, left, right })),
        });
    }
    fn b_reference(out: &mut Self::Out, name: b::Name, args: Option<b::Closed<ts::Type>>, query: Option<u32>) {
        let Some(type_name) = name.0 else { return };
        let end = args.as_ref().map_or(type_name.end(), |a| a.close_end);
        let r: &'static ts::TypeReference = Box::leak(Box::new(ts::TypeReference { type_name, type_arguments: args.map(|a| a.list) }));
        *out = Some(match query {
            Some(start) => ts::Type { start, end, data: ts::TypeData::TypeQuery(r) },
            None => ts::Type { start: type_name.start(), end, data: ts::TypeData::TypeReference(r) },
        });
    }
    fn b_wrap(lx: &Lexer<'_>, out: &mut Self::Out, start: &u32, kind: b::Wrap, inner: Option<ts::Type>) {
        let Some(inner) = inner else { return };
        let inner_ref: &'static ts::Type = lx.arena.alloc(inner);
        *out = Some(match kind {
            b::Wrap::Parenthesized => ts::Type { start: *start, end: lx.end as u32, data: ts::TypeData::Parenthesized(inner_ref) },
            b::Wrap::KeyOf => ts::Type { start: *start, end: inner.end, data: ts::TypeData::Operator(0, inner_ref) },
            b::Wrap::Rest => ts::Type { start: *start, end: inner.end, data: ts::TypeData::Rest(inner_ref) },
            b::Wrap::NonNull => ts::Type { start: inner.start, end: lx.end as u32, data: ts::TypeData::NonNull(inner_ref) },
        });
    }
    fn b_postfix(lx: &Lexer<'_>, out: &mut Self::Out, index: Option<ts::Type>) {
        let Some(object) = *out else { return };
        let end = lx.end as u32;
        *out = Some(match index {
            Some(index) => ts::Type { start: object.start, end, data: ts::TypeData::IndexedAccess(lx.arena.alloc((object, index))) },
            None => ts::Type { start: object.start, end, data: ts::TypeData::Array(lx.arena.alloc(object)) },
        });
    }
    fn list<V>(lx: &Lexer<'_>) -> b::List<V> {
        b::List { items: Vec::new(), end: lx.start as u32 + 1 }
    }
    fn push_type(list: &mut b::List<ts::Type>, item: Option<ts::Type>) {
        if let Some(item) = item {
            list.end = item.end;
            list.items.push(item);
        }
    }
    fn sep<V>(lx: &Lexer<'_>, list: &mut b::List<V>) {
        list.end = lx.end as u32;
    }
    fn close<V>(lx: &Lexer<'_>, list: b::List<V>) -> Option<b::Closed<V>> {
        // `>` may be the first character of a longer token: its end is one past its start.
        let close_end = lx.start as u32 + 1;
        Some(b::Closed { list: ts::NodeList { items: b::leak(list.items), end: list.end }, close_end })
    }
    fn b_tuple(out: &mut Self::Out, start: &u32, list: Option<b::Closed<ts::Type>>) {
        let Some(list) = list else { return };
        *out = Some(ts::Type { start: *start, end: list.close_end, data: ts::TypeData::Tuple(Box::leak(Box::new(list.list))) });
    }
    fn b_tuple_member(lx: &Lexer<'_>, out: &mut Self::Out, start: &u32, dots: Option<u32>, name: b::Name, question: Option<u32>, ty: Option<ts::Type>) {
        let (Some(ts::EntityName::Identifier(name)), Some(type_node)) = (name.0, ty) else { return };
        *out = Some(ts::Type { start: *start, end: type_node.end, data: ts::TypeData::NamedTupleMember(lx.arena.alloc(ts::NamedTupleMember { dot_dot_dot: dots, name, question, type_node })) });
    }
    fn b_set(out: &mut Self::Out, start: &u32, list: b::List<ts::Type>, union: bool) {
        let end = list.end;
        let nodes: &'static ts::NodeList<ts::Type> = Box::leak(Box::new(ts::NodeList { items: b::leak(list.items), end }));
        *out = Some(ts::Type { start: *start, end, data: if union { ts::TypeData::Union(nodes) } else { ts::TypeData::Intersection(nodes) } });
    }
    fn b_conditional(out: &mut Self::Out, check: Option<ts::Type>, extends: Option<ts::Type>, when_true: Option<ts::Type>) {
        let (Some(check), Some(extends), Some(when_true), Some(when_false)) = (check, extends, when_true, *out) else { return };
        *out = Some(ts::Type { start: check.start, end: when_false.end, data: ts::TypeData::Conditional(Box::leak(Box::new(ts::Conditional { check, extends, when_true, when_false }))) });
    }
    fn b_member_start(lx: &Lexer<'_>) -> b::Decl {
        b::Decl { start: lx.start as u32, end: lx.end as u32, name: Some(b::ident(lx)), question: None, type_node: None }
    }
    fn b_member_question(lx: &Lexer<'_>, decl: &mut b::Decl) {
        decl.question = Some(lx.start as u32);
        decl.end = lx.end as u32;
    }
    fn b_member_type(decl: &mut b::Decl, ty: Option<ts::Type>) {
        if let Some(ty) = ty {
            decl.end = ty.end;
        }
        decl.type_node = ty;
    }
    fn b_member_end(lx: &Lexer<'_>, decl: &mut b::Decl) {
        decl.end = lx.end as u32;
    }
    fn b_member(list: &mut b::List<ts::PropertySignature>, decl: b::Decl) {
        let Some(name) = decl.name else { return };
        list.end = decl.end;
        list.items.push(ts::PropertySignature { start: decl.start, end: decl.end, name, question: decl.question, type_node: decl.type_node });
    }
    fn b_object(out: &mut Self::Out, start: &u32, list: Option<b::Closed<ts::PropertySignature>>) {
        let Some(list) = list else { return };
        *out = Some(ts::Type { start: *start, end: list.close_end, data: ts::TypeData::TypeLiteral(Box::leak(Box::new(list.list))) });
    }
}

// ---------------------------------------------------------------- the parser and the grammar
// Everything that only the building sink needs sits in `build!` (a block under `if S::BUILDS`) or is a
// `state!` local that starts from an associated constant. Without `--cfg p2` both expand to nothing.
pub struct P<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> {
    pub lexer: Lexer<'a>,
    pub stack_limit: usize,
    pub symbols: Vec<&'a [u8]>,
}

#[cfg(p2)]
macro_rules! build {
    ($S:ident, $($body:tt)*) => {
        if <$S as TypeSink>::BUILDS {
            $($body)*
        }
    };
}
#[cfg(not(p2))]
macro_rules! build {
    ($S:ident, $($body:tt)*) => {};
}
#[cfg(p2)]
macro_rules! state {
    ($S:ident, $name:ident: $ty:ty) => {
        let mut $name: KK<$S, $ty> = ConstDefault::DEFAULT;
    };
}
#[cfg(not(p2))]
macro_rules! state {
    ($S:ident, $name:ident: $ty:ty) => {};
}
#[cfg(p2)]
macro_rules! child {
    ($S:ident, $name:ident) => {
        let mut $name: Kept<$S> = <<$S as TypeSink>::Sub as TypeSink>::NONE;
    };
}
#[cfg(not(p2))]
macro_rules! child {
    ($S:ident, $name:ident) => {};
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline(never)]
    pub fn find_symbol(&mut self, name: &'a [u8]) -> Result<u32, Error> {
        if let Some(i) = self.symbols.iter().position(|s| *s == name) {
            return Ok(i as u32);
        }
        self.symbols.push(name);
        Ok(self.symbols.len() as u32 - 1)
    }
    #[inline]
    pub fn is_safe_to_recurse(&self) -> bool {
        let here = 0u8;
        (core::ptr::from_ref(&here) as usize) > self.stack_limit
    }
    #[inline]
    pub fn load_name_from_ref(&self, r: u32) -> u32 {
        self.symbols.get(r as usize).map_or(0, |s| s.len() as u32)
    }

    pub fn skip_type_script_type_arguments<S: TypeSink>(
        &mut self,
        #[cfg(p2)] out: &mut KK<S, Option<b::Closed<ts::Type>>>,
    ) -> Result<bool, Error> {
        if self.lexer.token != T::LessThan {
            return Ok(false);
        }
        state!(S, list: b::List<ts::Type>);
        build!(S, list = S::list(&self.lexer););
        self.lexer.next()?;
        loop {
            let mut item = S::NONE;
            self.skip_type_script_type_with_opts::<S>(Level::Lowest, 0, &mut item)?;
            build!(S, S::push_type(&mut list, S::node(&item)););
            if self.lexer.token != T::Comma {
                break;
            }
            build!(S, S::sep(&self.lexer, &mut list););
            self.lexer.next()?;
        }
        build!(S, *out = S::close(&self.lexer, list););
        self.lexer.expect_greater_than()?;
        Ok(true)
    }

    pub fn skip_type_script_object_type<S: TypeSink>(
        &mut self,
        #[cfg(p2)] out: &mut KK<S, Option<b::Closed<ts::PropertySignature>>>,
    ) -> Result<(), Error> {
        state!(S, list: b::List<ts::PropertySignature>);
        build!(S, list = S::list(&self.lexer););
        self.lexer.expect(T::OpenBrace)?;
        while self.lexer.token != T::CloseBrace {
            if !self.lexer.is_identifier_or_keyword() {
                self.lexer.unexpected()?;
                return Err(Error::Syntax);
            }
            state!(S, decl: b::Decl);
            build!(S, decl = S::b_member_start(&self.lexer););
            self.lexer.next()?;
            if self.lexer.token == T::Question {
                build!(S, S::b_member_question(&self.lexer, &mut decl););
                self.lexer.next()?;
            }
            if self.lexer.token == T::Colon {
                self.lexer.next()?;
                let mut ty = S::NONE;
                self.skip_type_script_type_with_opts::<S>(Level::Lowest, 0, &mut ty)?;
                build!(S, S::b_member_type(&mut decl, S::node(&ty)););
            }
            match self.lexer.token {
                T::CloseBrace => {}
                T::Comma | T::Semicolon => {
                    build!(S, S::b_member_end(&self.lexer, &mut decl););
                    self.lexer.next()?;
                }
                _ => {
                    if !self.lexer.has_newline_before {
                        self.lexer.unexpected()?;
                        return Err(Error::Syntax);
                    }
                }
            }
            build!(S, S::b_member(&mut list, decl););
        }
        build!(S, *out = S::close(&self.lexer, list););
        self.lexer.expect(T::CloseBrace)?;
        Ok(())
    }

    pub fn skip_type_script_type_with_opts<S: TypeSink>(&mut self, level: Level, opts: u8, out: &mut S::Out) -> Result<(), Error> {
        if !self.is_safe_to_recurse() {
            return Err(Error::StackOverflow);
        }
        state!(S, start: u32);
        state!(S, intersection_start: u32);
        state!(S, primary_start: u32);
        build!(S, start = S::start(&self.lexer););
        // a leading "|" belongs to the union level, a leading "&" to the intersection level
        let leading_bar = level < Level::BitwiseOr && self.lexer.token == T::Bar;
        if leading_bar {
            self.lexer.next()?;
        }
        build!(S, intersection_start = S::start(&self.lexer););
        let leading_ampersand = level < Level::BitwiseAnd && self.lexer.token == T::Ampersand;
        if leading_ampersand {
            self.lexer.next()?;
        }
        build!(S, primary_start = S::start(&self.lexer););
        match self.lexer.token {
            T::Number => {
                build!(S, S::b_token_type(&self.lexer, out););
                self.lexer.next()?;
                S::literal(out, TypeLiteral::Number);
            }
            T::Str => {
                build!(S, S::b_string(&mut self.lexer, out)?;);
                self.lexer.next()?;
                S::literal(out, TypeLiteral::String);
            }
            T::Void => {
                build!(S, S::b_token_type(&self.lexer, out););
                self.lexer.next()?;
                S::keyword(out, TypeKeyword::Void);
            }
            T::This => {
                build!(S, S::b_token_type(&self.lexer, out););
                self.lexer.next()?;
                S::keyword(out, TypeKeyword::This);
            }
            T::Minus => {
                self.lexer.next()?;
                build!(S, S::b_negative(&self.lexer, out, &primary_start););
                self.lexer.expect(T::Number)?;
                S::literal(out, TypeLiteral::Number);
            }
            T::OpenParen => {
                self.lexer.next()?;
                let mut inner = S::NONE;
                self.skip_type_script_type_with_opts::<S>(Level::Lowest, 0, &mut inner)?;
                child!(S, kept);
                build!(S, kept = S::node(&inner););
                S::parenthesized(out, inner);
                build!(S, S::b_wrap(&self.lexer, out, &primary_start, b::Wrap::Parenthesized, kept););
                self.lexer.expect(T::CloseParen)?;
            }
            T::Typeof => {
                state!(S, query: Option<u32>);
                build!(S, query = S::tok(&self.lexer););
                self.lexer.next()?;
                S::typeof_query(out);
                if !self.lexer.is_identifier_or_keyword() {
                    self.lexer.expected(T::Identifier)?;
                }
                state!(S, name: b::Name);
                build!(S, S::b_name(&self.lexer, &mut name););
                self.lexer.next()?;
                while self.lexer.token == T::Dot {
                    self.lexer.next()?;
                    if !self.lexer.is_identifier_or_keyword() {
                        self.lexer.expected(T::Identifier)?;
                    }
                    build!(S, S::b_name(&self.lexer, &mut name););
                    self.lexer.next()?;
                }
                state!(S, args: Option<b::Closed<ts::Type>>);
                if !self.lexer.has_newline_before {
                    #[cfg(not(p2))]
                    let _ = self.skip_type_script_type_arguments::<S::Sub>()?;
                    #[cfg(p2)]
                    let _ = self.skip_type_script_type_arguments::<S::Sub>(&mut args)?;
                }
                build!(S, S::b_reference(out, name, args, query););
            }
            T::OpenBracket => {
                state!(S, list: b::List<ts::Type>);
                build!(S, list = S::list(&self.lexer););
                self.lexer.next()?;
                S::tuple_type(out);
                while self.lexer.token != T::CloseBracket {
                    let mut element = <S::Sub as TypeSink>::NONE;
                    self.skip_tuple_element::<S::Sub>(&mut element)?;
                    build!(S, S::push_type(&mut list, element););
                    if self.lexer.token != T::Comma {
                        break;
                    }
                    build!(S, S::sep(&self.lexer, &mut list););
                    self.lexer.next()?;
                }
                build!(S, S::b_tuple(out, &primary_start, S::close(&self.lexer, list)););
                self.lexer.expect(T::CloseBracket)?;
            }
            T::OpenBrace => {
                state!(S, members: Option<b::Closed<ts::PropertySignature>>);
                #[cfg(not(p2))]
                self.skip_type_script_object_type::<S::Sub>()?;
                #[cfg(p2)]
                self.skip_type_script_object_type::<S::Sub>(&mut members)?;
                build!(S, S::b_object(out, &primary_start, members););
                S::object_type(out);
            }
            T::Identifier => {
                let word = self.lexer.identifier;
                if word == b"keyof" {
                    self.lexer.next()?;
                    let mut operand = <S::Sub as TypeSink>::NONE;
                    self.skip_type_script_type_with_opts::<S::Sub>(Level::Prefix, 0, &mut operand)?;
                    S::keyof_type(out);
                    build!(S, S::b_wrap(&self.lexer, out, &primary_start, b::Wrap::KeyOf, operand););
                } else if word == b"any" || word == b"number" || word == b"string" {
                    build!(S, S::b_token_type(&self.lexer, out););
                    self.lexer.next()?;
                    S::keyword(out, if word == b"any" { TypeKeyword::Any } else if word == b"number" { TypeKeyword::Number } else { TypeKeyword::String });
                } else {
                    S::reference(out, word, |name| self.find_symbol(name))?;
                    state!(S, name: b::Name);
                    build!(S, S::b_name(&self.lexer, &mut name););
                    self.lexer.next()?;
                    while self.lexer.token == T::Dot {
                        self.lexer.next()?;
                        if !self.lexer.is_identifier_or_keyword() {
                            self.lexer.expect(T::Identifier)?;
                        }
                        let is_name = self.lexer.is_identifier_or_keyword();
                        S::member(out, self.lexer.identifier, is_name, |name| self.find_symbol(name))?;
                        build!(S, S::b_name(&self.lexer, &mut name););
                        self.lexer.next()?;
                    }
                    state!(S, args: Option<b::Closed<ts::Type>>);
                    if !self.lexer.has_newline_before {
                        #[cfg(not(p2))]
                        let _ = self.skip_type_script_type_arguments::<S::Sub>()?;
                        #[cfg(p2)]
                        let _ = self.skip_type_script_type_arguments::<S::Sub>(&mut args)?;
                    }
                    build!(S, S::b_reference(out, name, args, ConstDefault::DEFAULT););
                }
            }
            _ => {
                self.lexer.unexpected()?;
                if S::STRICT {
                    return Err(Error::Syntax);
                }
            }
        }

        // postfix
        loop {
            match self.lexer.token {
                T::Exclamation => {
                    if self.lexer.has_newline_before {
                        break;
                    }
                    build!(S, let inner = S::node(out); S::b_wrap(&self.lexer, out, &primary_start, b::Wrap::NonNull, inner););
                    self.lexer.next()?;
                }
                T::OpenBracket => {
                    if self.lexer.has_newline_before {
                        break;
                    }
                    self.lexer.next()?;
                    let mut skipped = false;
                    let mut index = <S::Sub as TypeSink>::NONE;
                    if self.lexer.token != T::CloseBracket {
                        skipped = true;
                        self.skip_type_script_type_with_opts::<S::Sub>(Level::Lowest, 0, &mut index)?;
                    }
                    build!(S, S::b_postfix(&self.lexer, out, index););
                    self.lexer.expect(T::CloseBracket)?;
                    S::index_or_array(out, skipped);
                }
                _ => break,
            }
        }

        // intersection
        if level < Level::BitwiseAnd && (leading_ampersand || self.lexer.token == T::Ampersand) {
            state!(S, list: b::List<ts::Type>);
            build!(S, S::push_type(&mut list, S::node(out)););
            while self.lexer.token == T::Ampersand {
                self.lexer.next()?;
                match S::intersection_left(out, |r| self.load_name_from_ref(r)) {
                    Operand::Decided => self.skip_type_script_type_with_opts::<Discard>(Level::BitwiseAnd, opts, &mut ())?,
                    Operand::Open(left) => {
                        self.skip_type_script_type_with_opts::<S>(Level::BitwiseAnd, opts, out)?;
                        build!(S, S::push_type(&mut list, S::node(out)););
                        S::intersection_right(out, left);
                    }
                }
            }
            build!(S, S::b_set(out, &intersection_start, list, false););
        }
        // union
        if level < Level::BitwiseOr && (leading_bar || self.lexer.token == T::Bar) {
            state!(S, list: b::List<ts::Type>);
            build!(S, S::push_type(&mut list, S::node(out)););
            while self.lexer.token == T::Bar {
                self.lexer.next()?;
                match S::union_left(out, |r| self.load_name_from_ref(r)) {
                    Operand::Decided => self.skip_type_script_type_with_opts::<Discard>(Level::BitwiseOr, opts, &mut ())?,
                    Operand::Open(left) => {
                        self.skip_type_script_type_with_opts::<S>(Level::BitwiseOr, opts, out)?;
                        build!(S, S::push_type(&mut list, S::node(out)););
                        S::union_right(out, left);
                    }
                }
            }
            build!(S, S::b_set(out, &start, list, true););
        }
        // conditional
        if self.lexer.token == T::Extends && level == Level::Lowest && opts == 0 && !self.lexer.has_newline_before {
            self.lexer.next()?;
            child!(S, check);
            child!(S, extends);
            child!(S, kept_true);
            build!(S, check = S::node(out););
            let mut extends_out = S::Out::default();
            self.skip_type_script_type_with_opts::<S>(Level::Lowest, 1, &mut extends_out)?;
            build!(S, extends = S::node(&extends_out););
            self.lexer.expect(T::Question)?;
            let mut when_true = S::Out::default();
            self.skip_type_script_type_with_opts::<S>(Level::Lowest, 0, &mut when_true)?;
            build!(S, kept_true = S::node(&when_true););
            self.lexer.expect(T::Colon)?;
            match S::conditional_true(out, when_true, |r| self.load_name_from_ref(r)) {
                Operand::Decided => self.skip_type_script_type_with_opts::<Discard>(Level::Lowest, 0, &mut ())?,
                Operand::Open(left) => {
                    self.skip_type_script_type_with_opts::<S>(Level::Lowest, 0, out)?;
                    S::conditional_false(out, left);
                    build!(S, S::b_conditional(out, check, extends, kept_true););
                }
            }
        }
        Ok(())
    }

    fn skip_tuple_element<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        state!(S, start: u32);
        state!(S, dots: Option<u32>);
        build!(S, start = S::start(&self.lexer););
        let mut rest = false;
        if self.lexer.token == T::DotDotDot {
            build!(S, dots = S::tok(&self.lexer););
            rest = true;
            self.lexer.next()?;
        }
        // a name followed by ":" or "?:" is a label
        if self.lexer.is_identifier_or_keyword() && self.is_tuple_label() {
            state!(S, name: b::Name);
            state!(S, question: Option<u32>);
            build!(S, S::b_name(&self.lexer, &mut name););
            self.lexer.next()?;
            if self.lexer.token == T::Question {
                build!(S, question = S::tok(&self.lexer););
                self.lexer.next()?;
            }
            self.lexer.expect(T::Colon)?;
            let mut ty = S::NONE;
            self.skip_type_script_type_with_opts::<S>(Level::Lowest, 0, &mut ty)?;
            build!(S, S::b_tuple_member(&self.lexer, out, &start, dots, name, question, S::node(&ty)););
            return Ok(());
        }
        self.skip_type_script_type_with_opts::<S>(Level::Lowest, 0, out)?;
        if rest {
            build!(S, let inner = S::node(out); S::b_wrap(&self.lexer, out, &start, b::Wrap::Rest, inner););
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn is_tuple_label(&mut self) -> bool {
        let save = (self.lexer.current, self.lexer.start, self.lexer.end, self.lexer.token, self.lexer.has_newline_before, self.lexer.identifier, self.lexer.all_comments.len());
        let mut ok = false;
        if self.lexer.next().is_ok() {
            if self.lexer.token == T::Colon {
                ok = true;
            } else if self.lexer.token == T::Question && self.lexer.next().is_ok() {
                ok = self.lexer.token == T::Colon;
            }
        }
        (self.lexer.current, self.lexer.start, self.lexer.end, self.lexer.token, self.lexer.has_newline_before, self.lexer.identifier) = (save.0, save.1, save.2, save.3, save.4, save.5);
        self.lexer.all_comments.truncate(save.6);
        ok
    }
}

include!("model_main.rs");
