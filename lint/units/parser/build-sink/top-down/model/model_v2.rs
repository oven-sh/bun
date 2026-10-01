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

pub struct P<'a, const TS: bool> {
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

#[cfg(p2)]
pub type Pos<S> = <<S as TypeSink>::Nested as PartSink>::Pos;
#[cfg(p2)]
pub type Types<S> = <<S as TypeSink>::Nested as PartSink>::Types;
#[cfg(p2)]
pub type TypeArgs<S> = <<S as TypeSink>::Nested as PartSink>::TypeArgs;
#[cfg(p2)]
pub type Params<S> = <<S as TypeSink>::Nested as PartSink>::Params;
#[cfg(p2)]
pub type Members<S> = <<S as TypeSink>::Nested as PartSink>::Members;
#[cfg(p2)]
pub type NestedOut<S> = <<S as TypeSink>::Nested as TypeSink>::Out;

pub trait TypeSink: Sized {
    type Out: Default;
    const STRICT: bool;

    #[cfg(p2)]
    type Nested: PartSink;
    /// Whether this sink keeps the parts of a type. The grammar tests it before every call added for `Build`.
    #[cfg(p2)]
    const KEEPS: bool = false;

    fn literal(out: &mut Self::Out, literal: TypeLiteral);
    fn keyword(out: &mut Self::Out, keyword: TypeKeyword);
    fn function_type(out: &mut Self::Out);
    fn parenthesized(out: &mut Self::Out, #[cfg(p2)] arena: &Arena, inner: Self::Out);
    fn typeof_query(out: &mut Self::Out);
    fn tuple_type(out: &mut Self::Out);
    fn object_type(out: &mut Self::Out);
    fn reference<'n, E>(
        out: &mut Self::Out,
        #[cfg(p2)] arena: &Arena,
        name: &'n [u8],
        find: impl FnOnce(&'n [u8]) -> Result<Ref, E>,
    ) -> Result<(), E>;
    fn member<'n, E>(
        out: &mut Self::Out,
        #[cfg(p2)] arena: &Arena,
        name: &'n [u8],
        is_name: bool,
        find: impl FnOnce(&'n [u8]) -> Result<Ref, E>,
    ) -> Result<(), E>;
    fn index_or_array(out: &mut Self::Out, #[cfg(p2)] arena: &Arena, has_index: bool);
    fn union_left<'n>(out: &mut Self::Out, load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<Self::Out>;
    fn union_right(out: &mut Self::Out, #[cfg(p2)] arena: &Arena, left: Self::Out);
    fn conditional_true<'n>(
        out: &mut Self::Out,
        when_true: Self::Out,
        load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<Self::Out>;
    fn conditional_false(out: &mut Self::Out, left: Self::Out);

    // ── added for the sink that builds nodes: every body is empty here ──
    #[cfg(p2)]
    #[inline]
    fn span(_out: &mut Self::Out, _start: Pos<Self>, _end: Pos<Self>) {}
    #[cfg(p2)]
    #[inline]
    fn end_at(_out: &mut Self::Out, _end: Pos<Self>) {}
    #[cfg(p2)]
    #[inline]
    fn leading_operator(_out: &mut Self::Out, _is_union: bool, _start: Pos<Self>) {}
    #[cfg(p2)]
    #[inline]
    fn type_arguments(_out: &mut Self::Out, _args: TypeArgs<Self>, _arena: &Arena) {}
    #[cfg(p2)]
    #[inline]
    fn tuple_elements(_out: &mut Self::Out, _elements: Types<Self>, _arena: &Arena) {}
    #[cfg(p2)]
    #[inline]
    fn index_type(_out: &mut Self::Out, _index: NestedOut<Self>, _arena: &Arena) {}
    #[cfg(p2)]
    #[inline]
    fn conditional_extends(_out: &mut Self::Out, _extends: &mut Self::Out, _arena: &Arena) {}
    #[cfg(p2)]
    #[inline]
    fn function_parts(_out: &mut Self::Out, _params: Params<Self>, _ret: NestedOut<Self>, _start: Pos<Self>, _arena: &Arena) {}
    #[cfg(p2)]
    #[inline]
    fn finish(_out: &mut Self::Out, _arena: &Arena) {}
    #[cfg(p2)]
    #[inline]
    fn object_members(_out: &mut Self::Out, _members: Members<Self>, _start: Pos<Self>, _arena: &Arena) {}
}

/// A sink that also keeps the parts of a type.
#[cfg(p2)]
pub trait PartSink: TypeSink<Nested = Self> {
    const NO_TYPE: Self::Out;
    type Pos: Copy;
    const NO_POS: Self::Pos;
    type Types;
    const NO_TYPES: Self::Types;
    /// What `skip_type_arguments` returns: `bool` in the sink that keeps nothing.
    type TypeArgs;
    const NO_TYPE_ARGS: Self::TypeArgs;
    const SKIPPED_TYPE_ARGS: Self::TypeArgs;
    type Params;
    const NO_PARAMS: Self::Params;
    type Members;
    const NO_MEMBERS: Self::Members;
    /// What an attempt at arrow arguments returns: `bool` in the sink that keeps nothing.
    type ArrowArgs;
    const SKIPPED_ARROW_ARGS: Self::ArrowArgs;

    fn attempt_arrow_args<'a, const TS: bool>(p: &mut P<'a, TS>) -> Self::ArrowArgs;
    fn is_arrow(args: &Self::ArrowArgs) -> bool;
    fn arrow_args(params: Self::Params) -> Self::ArrowArgs;
    fn arrow_params(args: Self::ArrowArgs) -> Self::Params;

    fn start(lexer: &Lexer<'_>) -> Self::Pos;
    fn end(lexer: &Lexer<'_>) -> Self::Pos;
    fn after_first_char(lexer: &Lexer<'_>) -> Self::Pos;
    fn push_type(list: &mut Self::Types, item: &mut Self::Out, arena: &Arena);
    fn type_args(items: Self::Types, lt_end: Self::Pos, gt_end: Self::Pos) -> Self::TypeArgs;
    fn members(items: Self::Params, end: Self::Pos) -> Self::Members;
    fn push_param(list: &mut Self::Params, name: &[u8], name_start: Self::Pos, name_end: Self::Pos, ty: Self::Out, arena: &Arena);
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
    fn parenthesized(_out: &mut (), #[cfg(p2)] _arena: &Arena, _inner: ()) {}
    #[inline]
    fn typeof_query(_out: &mut ()) {}
    #[inline]
    fn tuple_type(_out: &mut ()) {}
    #[inline]
    fn object_type(_out: &mut ()) {}
    #[inline]
    fn reference<'n, E>(_out: &mut (), #[cfg(p2)] _arena: &Arena, _name: &'n [u8], _find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn member<'n, E>(_out: &mut (), #[cfg(p2)] _arena: &Arena, _name: &'n [u8], _is_name: bool, _find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn index_or_array(_out: &mut (), #[cfg(p2)] _arena: &Arena, _has_index: bool) {}
    #[inline]
    fn union_left<'n>(_out: &mut (), _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<()> {
        Operand::Open(())
    }
    #[inline]
    fn union_right(_out: &mut (), #[cfg(p2)] _arena: &Arena, _left: ()) {}
    #[inline]
    fn conditional_true<'n>(_out: &mut (), _when_true: (), _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<()> {
        Operand::Open(())
    }
    #[inline]
    fn conditional_false(_out: &mut (), _left: ()) {}
}

#[cfg(p2)]
impl PartSink for Discard {
    const NO_TYPE: () = ();
    type Pos = ();
    const NO_POS: () = ();
    type Types = ();
    const NO_TYPES: () = ();
    type TypeArgs = bool;
    const NO_TYPE_ARGS: bool = false;
    const SKIPPED_TYPE_ARGS: bool = true;
    type Params = ();
    const NO_PARAMS: () = ();
    type Members = ();
    const NO_MEMBERS: () = ();
    type ArrowArgs = bool;
    const SKIPPED_ARROW_ARGS: bool = true;

    #[inline]
    fn attempt_arrow_args<'a, const TS: bool>(p: &mut P<'a, TS>) -> bool {
        p.try_skip_arrow_args_with_backtracking()
    }
    #[inline]
    fn is_arrow(args: &bool) -> bool {
        *args
    }
    #[inline]
    fn arrow_args(_params: ()) -> bool {
        true
    }
    #[inline]
    fn arrow_params(_args: bool) {}

    #[inline]
    fn start(_lexer: &Lexer<'_>) {}
    #[inline]
    fn end(_lexer: &Lexer<'_>) {}
    #[inline]
    fn after_first_char(_lexer: &Lexer<'_>) {}
    #[inline]
    fn push_type(_list: &mut (), _item: &mut (), _arena: &Arena) {}
    #[inline]
    fn type_args(_items: (), _lt_end: (), _gt_end: ()) -> bool {
        true
    }
    #[inline]
    fn members(_items: (), _end: ()) {}
    #[inline]
    fn push_param(_list: &mut (), _name: &[u8], _name_start: (), _name_end: (), _ty: (), _arena: &Arena) {}
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
    fn parenthesized(out: &mut Metadata, #[cfg(p2)] _arena: &Arena, inner: Metadata) {
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
    fn reference<'n, E>(out: &mut Metadata, #[cfg(p2)] _arena: &Arena, name: &'n [u8], find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
        *out = Metadata::MIdentifier(find(name)?);
        Ok(())
    }
    #[inline]
    fn member<'n, E>(out: &mut Metadata, #[cfg(p2)] _arena: &Arena, name: &'n [u8], is_name: bool, find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
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
    fn index_or_array(out: &mut Metadata, #[cfg(p2)] _arena: &Arena, has_index: bool) {
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
    fn union_right(out: &mut Metadata, #[cfg(p2)] _arena: &Arena, left: Metadata) {
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
include!("grammar_v2.rs");
#[cfg(all(p2, build))]
include!("build_v2.rs");
