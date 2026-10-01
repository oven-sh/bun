// Model of the type grammar: `--cfg p2` adds what the Build sink needs. The asm of the Discard and
// DecoratorMetadata instantiations must not change between the two compilations.
#![allow(dead_code)]
#![allow(unexpected_cfgs)]

pub enum Error {
    Syntax,
    StackOverflow,
    Backtrack,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum T {
    Eof,
    Number,
    Str,
    Void,
    Bar,
    Amp,
    Lt,
    Gt,
    GtGt,
    GtEq,
    Eq,
    OpenParen,
    CloseParen,
    OpenBracket,
    CloseBracket,
    OpenBrace,
    CloseBrace,
    Comma,
    Semi,
    Colon,
    Question,
    Dot,
    Arrow,
    DotDotDot,
    Excl,
    Typeof,
    Extends,
    Ident,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Level {
    Lowest,
    BitwiseOr,
    BitwiseAnd,
    Prefix,
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
    pub errors: u32,
}

#[derive(Clone, Copy)]
pub struct LexerSnapshot<'a> {
    current: usize,
    start: usize,
    end: usize,
    token: T,
    has_newline_before: bool,
    identifier: &'a [u8],
    pad: [u64; 20],
}

impl<'a> Lexer<'a> {
    #[inline(never)]
    pub fn next(&mut self) -> Result<(), Error> {
        self.has_newline_before = false;
        let c = self.contents;
        loop {
            self.start = self.current;
            if self.current >= c.len() {
                self.token = T::Eof;
                self.end = self.current;
                return Ok(());
            }
            let b = c[self.current];
            self.current += 1;
            self.token = match b {
                b' ' => continue,
                b'\n' => {
                    self.has_newline_before = true;
                    continue;
                }
                b'|' => T::Bar,
                b'&' => T::Amp,
                b'<' => T::Lt,
                b'>' => {
                    if self.current < c.len() && c[self.current] == b'>' {
                        self.current += 1;
                        T::GtGt
                    } else if self.current < c.len() && c[self.current] == b'=' {
                        self.current += 1;
                        T::GtEq
                    } else {
                        T::Gt
                    }
                }
                b'=' => {
                    if self.current < c.len() && c[self.current] == b'>' {
                        self.current += 1;
                        T::Arrow
                    } else {
                        T::Eq
                    }
                }
                b'(' => T::OpenParen,
                b')' => T::CloseParen,
                b'[' => T::OpenBracket,
                b']' => T::CloseBracket,
                b'{' => T::OpenBrace,
                b'}' => T::CloseBrace,
                b',' => T::Comma,
                b';' => T::Semi,
                b':' => T::Colon,
                b'?' => T::Question,
                b'!' => T::Excl,
                b'.' => {
                    if self.current + 1 < c.len() && c[self.current] == b'.' {
                        self.current += 2;
                        T::DotDotDot
                    } else {
                        T::Dot
                    }
                }
                b'0'..=b'9' => {
                    while self.current < c.len() && c[self.current].is_ascii_digit() {
                        self.current += 1;
                    }
                    T::Number
                }
                b'"' => {
                    while self.current < c.len() && c[self.current] != b'"' {
                        self.current += 1;
                    }
                    self.current += 1;
                    T::Str
                }
                _ => {
                    while self.current < c.len() && c[self.current].is_ascii_alphanumeric() {
                        self.current += 1;
                    }
                    self.identifier = &c[self.start..self.current];
                    match self.identifier {
                        b"void" => T::Void,
                        b"typeof" => T::Typeof,
                        b"extends" => T::Extends,
                        _ => T::Ident,
                    }
                }
            };
            self.end = self.current;
            return Ok(());
        }
    }

    #[inline]
    pub fn expect(&mut self, token: T) -> Result<(), Error> {
        if self.token != token {
            self.expected(token)?;
        }
        self.next()
    }

    #[cold]
    #[inline(never)]
    pub fn expected(&mut self, _token: T) -> Result<(), Error> {
        if self.is_log_disabled {
            return Err(Error::Backtrack);
        }
        self.errors += 1;
        Err(Error::Syntax)
    }

    #[cold]
    #[inline(never)]
    pub fn unexpected(&mut self) -> Result<(), Error> {
        if self.is_log_disabled {
            return Ok(());
        }
        self.errors += 1;
        Err(Error::Syntax)
    }

    pub fn expect_greater_than(&mut self) -> Result<(), Error> {
        match self.token {
            T::Gt => self.next()?,
            T::GtGt => {
                self.token = T::Gt;
                self.start += 1;
            }
            T::GtEq => {
                self.token = T::Eq;
                self.start += 1;
            }
            _ => self.expected(T::Gt)?,
        }
        Ok(())
    }

    #[inline]
    pub fn is_identifier_or_keyword(&self) -> bool {
        (self.token as u8) >= (T::Typeof as u8)
    }

    pub fn snapshot(&self) -> LexerSnapshot<'a> {
        LexerSnapshot {
            current: self.current,
            start: self.start,
            end: self.end,
            token: self.token,
            has_newline_before: self.has_newline_before,
            identifier: self.identifier,
            pad: [self.current as u64; 20],
        }
    }

    pub fn restore(&mut self, s: &LexerSnapshot<'a>) {
        self.current = s.current;
        self.start = s.start;
        self.end = s.end;
        self.token = s.token;
        self.has_newline_before = s.has_newline_before;
        self.identifier = s.identifier;
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Ref(pub u32);

#[derive(Clone, Default)]
pub enum Metadata {
    #[default]
    MNone,
    MNever,
    MUnknown,
    MAny,
    MVoid,
    MNull,
    MUndefined,
    MFunction,
    MArray,
    MBoolean,
    MString,
    MObject,
    MNumber,
    MIdentifier(Ref),
    MDot(Vec<Ref>),
}

impl Metadata {
    pub fn finish_union<'b, F: Fn(Ref) -> &'b [u8]>(&mut self, load_name: F) -> Option<Self> {
        match self {
            Metadata::MIdentifier(r) => {
                if load_name(*r) == b"Object" {
                    return Some(Metadata::MObject);
                }
                None
            }
            Metadata::MUnknown | Metadata::MAny | Metadata::MObject => Some(Metadata::MObject),
            Metadata::MNever | Metadata::MNull | Metadata::MUndefined => {
                *self = Metadata::MNone;
                None
            }
            _ => None,
        }
    }
    pub fn merge_union(&mut self, left: Self) {
        if !matches!(left, Metadata::MNone) {
            if core::mem::discriminant(self) != core::mem::discriminant(&left) {
                *self = match self {
                    Metadata::MNever | Metadata::MUndefined | Metadata::MNull => left,
                    _ => Metadata::MObject,
                };
            } else if let Metadata::MIdentifier(r) = self {
                let r = *r;
                if let Metadata::MIdentifier(l) = left {
                    if r != l {
                        *self = Metadata::MObject;
                    }
                }
            }
        }
    }
}

pub struct Arena {
    pub bytes: core::cell::Cell<usize>,
}
impl Arena {
    #[inline(never)]
    pub fn alloc<V>(&self, v: V) -> &mut V {
        self.bytes.set(self.bytes.get() + core::mem::size_of::<V>());
        Box::leak(Box::new(v))
    }
    #[inline(never)]
    pub fn alloc_slice_copy<V: Copy>(&self, v: &[V]) -> &mut [V] {
        self.bytes.set(self.bytes.get() + core::mem::size_of_val(v));
        Box::leak(v.to_vec().into_boxed_slice())
    }
}

#[derive(Default)]
pub struct Side {
    pub starts: Vec<u32>,
    #[cfg(all(p2, build))]
    pub build: Scratch,
}

pub struct P<'a, const TS: bool> {
    pub side: Option<Box<Side>>,
    pub lexer: Lexer<'a>,
    pub arena: &'a Arena,
    pub depth: u32,
    pub names: Vec<&'a [u8]>,
}

// ───────────────────────────── the sink ─────────────────────────────

pub enum Operand<V> {
    Decided,
    Open(V),
}

pub enum TypeLiteral {
    Number,
    String,
}

pub enum TypeKeyword {
    Void,
    Any,
}

pub trait TypeSink: Sized {
    type Out: Default;
    const STRICT: bool;

    /// The sink that reads the parts of a type that only a sink that builds keeps.
    #[cfg(p2)]
    type Nested: TypeSink<Nested = Self::Nested>;

    fn literal(out: &mut Self::Out, literal: TypeLiteral);
    fn keyword(out: &mut Self::Out, keyword: TypeKeyword);
    fn function_type(out: &mut Self::Out);
    fn parenthesized(out: &mut Self::Out, inner: Self::Out);
    fn typeof_query(out: &mut Self::Out);
    fn tuple_type(out: &mut Self::Out);
    fn object_type(out: &mut Self::Out);
    fn reference<'n, E>(
        out: &mut Self::Out,
        name: &'n [u8],
        find: impl FnOnce(&'n [u8]) -> Result<Ref, E>,
    ) -> Result<(), E>;
    fn member<'n, E>(
        out: &mut Self::Out,
        name: &'n [u8],
        is_name: bool,
        find: impl FnOnce(&'n [u8]) -> Result<Ref, E>,
    ) -> Result<(), E>;
    fn index_or_array(out: &mut Self::Out, has_index: bool);
    fn union_left<'n>(out: &mut Self::Out, load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<Self::Out>;
    fn union_right(out: &mut Self::Out, left: Self::Out);
    fn conditional_true<'n>(
        out: &mut Self::Out,
        when_true: Self::Out,
        load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<Self::Out>;
    fn conditional_false(out: &mut Self::Out, left: Self::Out);

    // ── added for the sink that builds nodes. Every body is empty here, and every hook reads the lexer as it is when called ──
    /// The lexer is on the first token of the type that `out` receives.
    #[cfg(p2)]
    #[inline]
    fn begin<'a, const TS: bool>(_p: &mut P<'a, TS>, _out: &mut Self::Out) {}
    /// The lexer is on the last token of the type in `out`.
    #[cfg(p2)]
    #[inline]
    fn end<'a, const TS: bool>(_p: &mut P<'a, TS>, _out: &mut Self::Out) {}
    /// The lexer is on a token that is the whole type in `out`.
    #[cfg(p2)]
    #[inline]
    fn token<'a, const TS: bool>(_p: &mut P<'a, TS>, _out: &mut Self::Out) {}
    /// The lexer is on a "|" or "&" that leads a type.
    #[cfg(p2)]
    #[inline]
    fn leading_operator<'a, const TS: bool>(_p: &mut P<'a, TS>, _out: &mut Self::Out) {}
    /// A list of type arguments was read, or none: it belongs to the type in `out`.
    #[cfg(p2)]
    #[inline]
    fn type_arguments<'a, const TS: bool>(_p: &mut P<'a, TS>, _out: &mut Self::Out) {}
    #[cfg(p2)]
    #[inline]
    fn list_open<'a, const TS: bool>(_p: &mut P<'a, TS>) {}
    #[cfg(p2)]
    #[inline]
    fn list_type<'a, const TS: bool>(_p: &mut P<'a, TS>, _item: &mut Self::Out) {}
    #[cfg(p2)]
    #[inline]
    fn type_arguments_close<'a, const TS: bool>(_p: &mut P<'a, TS>) {}
    #[cfg(p2)]
    #[inline]
    fn tuple_close<'a, const TS: bool>(_p: &mut P<'a, TS>, _out: &mut Self::Out) {}
    #[cfg(p2)]
    #[inline]
    fn index_type<'a, const TS: bool>(_p: &mut P<'a, TS>, _out: &mut Self::Out, _index: &mut <Self::Nested as TypeSink>::Out) {}
    #[cfg(p2)]
    #[inline]
    fn conditional_extends<'a, const TS: bool>(_p: &mut P<'a, TS>, _out: &mut Self::Out, _extends: &mut Self::Out) {}
    #[cfg(p2)]
    #[inline]
    fn parameter_name<'a, const TS: bool>(_p: &mut P<'a, TS>) {}
    #[cfg(p2)]
    #[inline]
    fn parameter<'a, const TS: bool>(_p: &mut P<'a, TS>, _ty: &mut Self::Out) {}
    #[cfg(p2)]
    #[inline]
    fn function_parts<'a, const TS: bool>(_p: &mut P<'a, TS>, _out: &mut Self::Out, _ret: &mut <Self::Nested as TypeSink>::Out) {}
    #[cfg(p2)]
    #[inline]
    fn object_close<'a, const TS: bool>(_p: &mut P<'a, TS>) {}
    #[cfg(p2)]
    #[inline]
    fn object_members<'a, const TS: bool>(_p: &mut P<'a, TS>, _out: &mut Self::Out) {}
    /// An attempt that may put the lexer back starts.
    #[cfg(p2)]
    #[inline]
    fn attempt_begin<'a, const TS: bool>(_p: &mut P<'a, TS>) {}
    /// The attempt ended: when `kept` is false the lexer is back where it was.
    #[cfg(p2)]
    #[inline]
    fn attempt_end<'a, const TS: bool>(_p: &mut P<'a, TS>, _kept: bool) {}
    /// The type in `out` is complete: nothing more is read into it.
    #[cfg(p2)]
    #[inline]
    fn close<'a, const TS: bool>(_p: &mut P<'a, TS>, _out: &mut Self::Out) {}
}

pub struct Discard;

impl TypeSink for Discard {
    type Out = ();
    const STRICT: bool = false;
    #[cfg(p2)]
    type Nested = Discard;

    #[inline]
    fn literal(_out: &mut (), _literal: TypeLiteral) {}
    #[inline]
    fn keyword(_out: &mut (), _keyword: TypeKeyword) {}
    #[inline]
    fn function_type(_out: &mut ()) {}
    #[inline]
    fn parenthesized(_out: &mut (), _inner: ()) {}
    #[inline]
    fn typeof_query(_out: &mut ()) {}
    #[inline]
    fn tuple_type(_out: &mut ()) {}
    #[inline]
    fn object_type(_out: &mut ()) {}
    #[inline]
    fn reference<'n, E>(_out: &mut (), _name: &'n [u8], _find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn member<'n, E>(_out: &mut (), _name: &'n [u8], _is_name: bool, _find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn index_or_array(_out: &mut (), _has_index: bool) {}
    #[inline]
    fn union_left<'n>(_out: &mut (), _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<()> {
        Operand::Open(())
    }
    #[inline]
    fn union_right(_out: &mut (), _left: ()) {}
    #[inline]
    fn conditional_true<'n>(_out: &mut (), _when_true: (), _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<()> {
        Operand::Open(())
    }
    #[inline]
    fn conditional_false(_out: &mut (), _left: ()) {}
}

pub struct DecoratorMetadata;

impl TypeSink for DecoratorMetadata {
    type Out = Metadata;
    const STRICT: bool = false;
    #[cfg(p2)]
    type Nested = Discard;

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
            TypeKeyword::Void => Metadata::MVoid,
            TypeKeyword::Any => Metadata::MAny,
        };
    }
    #[inline]
    fn function_type(out: &mut Metadata) {
        *out = Metadata::MFunction;
    }
    #[inline]
    fn parenthesized(out: &mut Metadata, inner: Metadata) {
        *out = inner;
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
    fn reference<'n, E>(out: &mut Metadata, name: &'n [u8], find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
        *out = Metadata::MIdentifier(find(name)?);
        Ok(())
    }
    #[inline]
    fn member<'n, E>(out: &mut Metadata, name: &'n [u8], is_name: bool, find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
        match out {
            Metadata::MIdentifier(id) => {
                let id = *id;
                let mut dot: Vec<Ref> = Vec::with_capacity(2);
                dot.push(id);
                let member = find(name)?;
                dot.push(member);
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
        if matches!(*out, Metadata::MNone) {
            *out = Metadata::MArray;
        } else if has_index {
            *out = Metadata::MObject;
        } else {
            *out = Metadata::MArray;
        }
    }
    #[inline]
    fn union_left<'n>(out: &mut Metadata, load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<Metadata> {
        let mut left = out.clone();
        match left.finish_union(load_name) {
            Some(done) => {
                *out = done;
                Operand::Decided
            }
            None => Operand::Open(left),
        }
    }
    #[inline]
    fn union_right(out: &mut Metadata, left: Metadata) {
        out.merge_union(left);
    }
    #[inline]
    fn conditional_true<'n>(out: &mut Metadata, when_true: Metadata, load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<Metadata> {
        let mut left = when_true;
        match left.finish_union(load_name) {
            Some(done) => {
                *out = done;
                Operand::Decided
            }
            None => Operand::Open(left),
        }
    }
    #[inline]
    fn conditional_false(out: &mut Metadata, left: Metadata) {
        out.merge_union(left);
    }
}

#[cfg(not(p2))]
include!("grammar_p1.rs");
#[cfg(p2)]
include!("grammar_v3.rs");
#[cfg(all(p2, build))]
include!("build_v3.rs");
