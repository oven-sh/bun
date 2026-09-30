use crate::Error;
use crate::lexer::{Lexer, T};
use crate::p::P;
use crate::parser::ParseBindingOptions;
use crate::typescript::{SkipTypeOptions, SkipTypeOptionsBitset};
use bun_ast::op::Level;
use bun_ast::ts;
use bun_ast::ts::{IntoTypeData as _, Metadata};
use bun_ast::{B, Expr, Ref, StoreRef, StoreSlice};

/// What the type grammar keeps of the syntax it reads.
pub(crate) trait TypeSink {
    /// What one type leaves behind.
    type Out: Default;

    /// No type read yet.
    const NONE: Self::Out;
    /// Whether what the other sinks let pass is an error.
    const STRICT: bool;
    /// Whether the sink builds nodes: the grammar calls the `b_` hooks only where this holds.
    const BUILDS: bool;
    /// The sink that reads a part of a type of which this sink keeps only what `Sub` keeps.
    type Sub: TypeSink<Sub = Self::Sub>;
    /// `V` in a sink that builds, nothing in the others.
    type K<V: ConstDefault>: ConstDefault;

    fn literal(out: &mut Self::Out, literal: TypeLiteral);
    fn keyword(out: &mut Self::Out, keyword: TypeKeyword);
    fn function_type(out: &mut Self::Out);
    fn parenthesized(out: &mut Self::Out, inner: Self::Out);
    fn keyof_type(out: &mut Self::Out);
    fn readonly_type(out: &mut Self::Out);
    fn typeof_query(out: &mut Self::Out);
    fn tuple_type(out: &mut Self::Out);
    fn object_type(out: &mut Self::Out);
    fn template_literal_type(out: &mut Self::Out);
    /// `name` at the start of a type. `find` is `P::find_symbol`.
    fn reference<'a, E>(
        out: &mut Self::Out,
        name: &'a [u8],
        find: impl FnOnce(&'a [u8]) -> Result<Ref, E>,
    ) -> Result<(), E>;
    /// `.name` after a type. `is_name` is false when the lexer logged that it is not on a name.
    fn member<'a, E>(
        out: &mut Self::Out,
        name: &'a [u8],
        is_name: bool,
        find: impl FnOnce(&'a [u8]) -> Result<Ref, E>,
    ) -> Result<(), E>;
    /// `[]` or `[index]` after a type.
    fn index_or_array(out: &mut Self::Out, has_index: bool);
    /// Left side of `|`, before the right side is parsed. `load_name` is `P::load_name_from_ref`.
    fn union_left<'n>(
        out: &mut Self::Out,
        load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<Self::Out>;
    fn union_right(out: &mut Self::Out, left: Self::Out);
    fn intersection_left<'n>(
        out: &mut Self::Out,
        load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<Self::Out>;
    fn intersection_right(out: &mut Self::Out, left: Self::Out);
    /// The type between "?" and ":" of a conditional type, before the type after ":" is parsed.
    fn conditional_true<'n>(
        out: &mut Self::Out,
        when_true: Self::Out,
        load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<Self::Out>;
    fn conditional_false(out: &mut Self::Out, left: Self::Out);

    /// The type in `out`, as a parent keeps it.
    #[inline]
    fn node(_out: &Self::Out) -> Kept<Self> {
        <Self::Sub as TypeSink>::NONE
    }
    /// The type in `out`, which starts anew.
    #[inline]
    fn b_take(_out: &mut Self::Out) -> Kept<Self> {
        <Self::Sub as TypeSink>::NONE
    }
    /// A type that the grammar read in one piece.
    #[inline]
    fn b_node(_out: &mut Self::Out, _node: ts::Type) {}
    /// The offset of the token the lexer is on.
    #[inline]
    fn b_start(_lx: &Lexer<'_>) -> KK<Self, u32> {
        ConstDefault::DEFAULT
    }
    /// The token the lexer is on, as a node.
    #[inline]
    fn b_tok(_lx: &Lexer<'_>, _kind: ts::TokenKind) -> KK<Self, Option<ts::Token>> {
        ConstDefault::DEFAULT
    }
    /// The name the lexer is on, if it is on one.
    #[inline]
    fn b_ident(_lx: &Lexer<'_>) -> KK<Self, Option<ts::Name>> {
        ConstDefault::DEFAULT
    }
    /// The lexer is on a token that is a whole type: a literal, `void`, `this` or the name of a keyword type.
    #[inline]
    fn b_token(_lx: &mut Lexer<'_>, _out: &mut Self::Out) -> Result<(), Error> {
        Ok(())
    }
    /// The lexer is on the literal after the "-" at `start`.
    #[inline]
    fn b_negative(
        _lx: &mut Lexer<'_>,
        _out: &mut Self::Out,
        _start: &KK<Self, u32>,
    ) -> Result<(), Error> {
        Ok(())
    }
    /// The lexer is on a name that starts a type reference.
    #[inline]
    fn b_reference(_lx: &Lexer<'_>, _out: &mut Self::Out) {}
    /// The lexer is on the name after the "." that follows the type in `out`.
    #[inline]
    fn b_member(_lx: &mut Lexer<'_>, _out: &mut Self::Out) -> Result<(), Error> {
        Ok(())
    }
    /// The type arguments that follow the reference in `out`, if any were read.
    #[inline]
    fn b_type_arguments(
        _lx: &mut Lexer<'_>,
        _out: &mut Self::Out,
        _arguments: KK<Self, Option<b::Closed>>,
    ) -> Result<(), Error> {
        Ok(())
    }
    /// The reference in `out` is the operand of the `typeof` at `start`.
    #[inline]
    fn b_query(_lx: &Lexer<'_>, _out: &mut Self::Out, _start: &KK<Self, u32>) {}
    /// The lexer is on the "]" after the type in `out`, with `index` between the brackets or nothing.
    #[inline]
    fn b_index(_lx: &Lexer<'_>, _out: &mut Self::Out, _index: Kept<Self>) {}
    /// The lexer is on the "!" after the type in `out`.
    #[inline]
    fn b_non_null(_lx: &Lexer<'_>, _out: &mut Self::Out) {}
    /// `operand` follows the operator at `start`.
    #[inline]
    fn b_operator(
        _lx: &Lexer<'_>,
        _out: &mut Self::Out,
        _start: &KK<Self, u32>,
        _operator: ts::TypeOperatorKind,
        _operand: Kept<Self>,
    ) {
    }
    /// `name` and its constraint follow the `infer` at `start`.
    #[inline]
    fn b_infer(
        _lx: &Lexer<'_>,
        _out: &mut Self::Out,
        _start: &KK<Self, u32>,
        _name: KK<Self, Option<ts::Name>>,
        _constraint: Kept<Self>,
    ) {
    }
    /// The type after ":" is in `out`: the three other parts of the conditional type were read before.
    #[inline]
    fn b_conditional(
        _lx: &Lexer<'_>,
        _out: &mut Self::Out,
        _check: Kept<Self>,
        _extends: Kept<Self>,
        _when_true: Kept<Self>,
    ) {
    }
    /// The name or `this` in `out` is the subject of a type predicate: after `asserts`, before `is type_node`, or both.
    #[inline]
    fn b_predicate(
        _lx: &mut Lexer<'_>,
        _out: &mut Self::Out,
        _asserts: KK<Self, Option<ts::Token>>,
        _type_node: Kept<Self>,
    ) -> Result<(), Error> {
        Ok(())
    }
    /// The lexer is on the head, on a middle or on the tail of a template.
    #[inline]
    fn b_template_piece(_lx: &mut Lexer<'_>) -> Result<KK<Self, Option<ts::TemplatePiece>>, Error> {
        Ok(ConstDefault::DEFAULT)
    }
    /// A type between two pieces of a template, and the piece after it.
    #[inline]
    fn b_template_span(
        _spans: &mut KK<Self, b::List<ts::TemplateLiteralTypeSpan>>,
        _type_node: Kept<Self>,
        _literal: KK<Self, Option<ts::TemplatePiece>>,
    ) {
    }
    /// The template literal type of `head` and `spans`.
    #[inline]
    fn b_template(
        _lx: &Lexer<'_>,
        _out: &mut Self::Out,
        _head: KK<Self, Option<ts::TemplatePiece>>,
        _spans: KK<Self, b::List<ts::TemplateLiteralTypeSpan>>,
    ) {
    }
    /// The lexer is on the "<" that opens type arguments.
    #[inline]
    fn b_list(_lx: &Lexer<'_>) -> KK<Self, b::List<ts::Type>> {
        ConstDefault::DEFAULT
    }
    /// A type argument.
    #[inline]
    fn b_push_type(_list: &mut KK<Self, b::List<ts::Type>>, _item: Kept<Self>) {}
    /// The lexer is on the "," after a type argument.
    #[inline]
    fn b_separator(_lx: &Lexer<'_>, _list: &mut KK<Self, b::List<ts::Type>>) {}
    /// The lexer is on the ">" that closes type arguments.
    #[inline]
    fn b_close(_lx: &Lexer<'_>, _list: KK<Self, b::List<ts::Type>>) -> KK<Self, Option<b::Closed>> {
        ConstDefault::DEFAULT
    }
    /// The lexer is on a "|" or "&" that leads a type.
    #[inline]
    fn b_leading(_lx: &Lexer<'_>, _lead: &mut KK<Self, b::Lead>) {}
    /// The type in `out` is the left operand of the "|" or "&" that was just read.
    #[inline]
    fn b_operand(
        _lx: &Lexer<'_>,
        _out: &mut Self::Out,
        _set: &mut KK<Self, b::Set>,
        _lead: &mut KK<Self, b::Lead>,
        _is_union: bool,
    ) {
    }
    /// The type in `out` is the right operand of the operator that `b_operand` saw.
    #[inline]
    fn b_operand_end(_out: &mut Self::Out, _set: &mut KK<Self, b::Set>) {}
    /// No operand follows: `out` takes the union or intersection read so far.
    #[inline]
    fn b_finish(
        _lx: &Lexer<'_>,
        _out: &mut Self::Out,
        _set: &mut KK<Self, b::Set>,
        _lead: &mut KK<Self, b::Lead>,
    ) {
    }
}

/// What a sink decided from the left operand.
pub(crate) enum Operand<T> {
    /// The result is final. The grammar reads the rest with `Discard`.
    Decided,
    /// The right operand is read into the same `out`, which keeps the left value when that operand is `infer T`.
    Open(T),
}

pub(crate) enum TypeLiteral {
    Number,
    Bigint,
    String,
    Boolean,
}

pub(crate) enum TypeKeyword {
    Any,
    Never,
    Unknown,
    Undefined,
    Object,
    Number,
    String,
    Boolean,
    Bigint,
    Symbol,
    Null,
    Void,
    This,
}

/// Reads a type and keeps nothing.
pub(crate) struct Discard;

impl TypeSink for Discard {
    type Out = ();

    const NONE: () = ();
    const STRICT: bool = false;
    const BUILDS: bool = false;
    type Sub = Discard;
    type K<V: ConstDefault> = ();

    #[inline]
    fn literal(_out: &mut (), _literal: TypeLiteral) {}
    #[inline]
    fn keyword(_out: &mut (), _keyword: TypeKeyword) {}
    #[inline]
    fn function_type(_out: &mut ()) {}
    #[inline]
    fn parenthesized(_out: &mut (), _inner: ()) {}
    #[inline]
    fn keyof_type(_out: &mut ()) {}
    #[inline]
    fn readonly_type(_out: &mut ()) {}
    #[inline]
    fn typeof_query(_out: &mut ()) {}
    #[inline]
    fn tuple_type(_out: &mut ()) {}
    #[inline]
    fn object_type(_out: &mut ()) {}
    #[inline]
    fn template_literal_type(_out: &mut ()) {}
    #[inline]
    fn reference<'a, E>(
        _out: &mut (),
        _name: &'a [u8],
        _find: impl FnOnce(&'a [u8]) -> Result<Ref, E>,
    ) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn member<'a, E>(
        _out: &mut (),
        _name: &'a [u8],
        _is_name: bool,
        _find: impl FnOnce(&'a [u8]) -> Result<Ref, E>,
    ) -> Result<(), E> {
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
    fn intersection_left<'n>(_out: &mut (), _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<()> {
        Operand::Open(())
    }
    #[inline]
    fn intersection_right(_out: &mut (), _left: ()) {}
    #[inline]
    fn conditional_true<'n>(
        _out: &mut (),
        _when_true: (),
        _load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<()> {
        Operand::Open(())
    }
    #[inline]
    fn conditional_false(_out: &mut (), _left: ()) {}
}

/// Computes the `design:type` tag of `emitDecoratorMetadata`.
pub(crate) struct DecoratorMetadata;

impl TypeSink for DecoratorMetadata {
    type Out = Metadata;

    const NONE: Metadata = Metadata::MNone;
    const STRICT: bool = false;
    const BUILDS: bool = false;
    type Sub = Discard;
    type K<V: ConstDefault> = ();

    #[inline]
    fn literal(out: &mut Metadata, literal: TypeLiteral) {
        *out = match literal {
            TypeLiteral::Number => Metadata::MNumber,
            TypeLiteral::Bigint => Metadata::MBigint,
            TypeLiteral::String => Metadata::MString,
            TypeLiteral::Boolean => Metadata::MBoolean,
        };
    }

    #[inline]
    fn keyword(out: &mut Metadata, keyword: TypeKeyword) {
        *out = match keyword {
            TypeKeyword::Any => Metadata::MAny,
            TypeKeyword::Never => Metadata::MNever,
            TypeKeyword::Unknown => Metadata::MUnknown,
            TypeKeyword::Undefined => Metadata::MUndefined,
            TypeKeyword::Object | TypeKeyword::This => Metadata::MObject,
            TypeKeyword::Number => Metadata::MNumber,
            TypeKeyword::String => Metadata::MString,
            TypeKeyword::Boolean => Metadata::MBoolean,
            TypeKeyword::Bigint => Metadata::MBigint,
            TypeKeyword::Symbol => Metadata::MSymbol,
            TypeKeyword::Null => Metadata::MNull,
            TypeKeyword::Void => Metadata::MVoid,
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
    fn keyof_type(out: &mut Metadata) {
        *out = Metadata::MObject;
    }

    #[inline]
    fn readonly_type(out: &mut Metadata) {
        // assume array or tuple literal
        *out = Metadata::MArray;
    }

    #[inline]
    fn typeof_query(out: &mut Metadata) {
        // always `Object`
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
    fn template_literal_type(out: &mut Metadata) {
        *out = Metadata::MString;
    }

    #[inline]
    fn reference<'a, E>(
        out: &mut Metadata,
        name: &'a [u8],
        find: impl FnOnce(&'a [u8]) -> Result<Ref, E>,
    ) -> Result<(), E> {
        *out = Metadata::MIdentifier(find(name)?);
        Ok(())
    }

    #[inline]
    fn member<'a, E>(
        out: &mut Metadata,
        name: &'a [u8],
        is_name: bool,
        find: impl FnOnce(&'a [u8]) -> Result<Ref, E>,
    ) -> Result<(), E> {
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
        } else {
            // if something was skipped, it is object type
            if has_index {
                *out = Metadata::MObject;
            } else {
                *out = Metadata::MArray;
            }
        }
    }

    #[inline]
    fn union_left<'n>(
        out: &mut Metadata,
        load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<Metadata> {
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
    fn intersection_left<'n>(
        out: &mut Metadata,
        load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<Metadata> {
        let mut left = out.clone();
        match left.finish_intersection(load_name) {
            Some(done) => {
                *out = done;
                Operand::Decided
            }
            None => Operand::Open(left),
        }
    }

    #[inline]
    fn intersection_right(out: &mut Metadata, left: Metadata) {
        out.merge_intersection(left);
    }

    #[inline]
    fn conditional_true<'n>(
        out: &mut Metadata,
        when_true: Metadata,
        load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<Metadata> {
        let mut left = when_true;
        match left.finish_intersection(load_name) {
            Some(done) => {
                *out = done;
                Operand::Decided
            }
            None => Operand::Open(left),
        }
    }

    #[inline]
    fn conditional_false(out: &mut Metadata, left: Metadata) {
        out.merge_intersection(left);
    }
}

/// A value to start from that costs no code.
pub(crate) trait ConstDefault {
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

/// A child type as its parent keeps it.
pub(crate) type Kept<S> = <<S as TypeSink>::Sub as TypeSink>::Out;

/// `V` in a sink that builds, nothing in the others.
pub(crate) type KK<S, V> = <<S as TypeSink>::Sub as TypeSink>::K<V>;

/// What `Build` holds between two hooks.
pub(crate) mod b {
    use super::ConstDefault;
    use bun_ast::ts;

    /// The items read so far of a list that is still open.
    pub(crate) struct List<V> {
        pub(crate) items: Vec<V>,
        pub(crate) start: u32,
        pub(crate) end: u32,
    }

    impl<V> ConstDefault for List<V> {
        const DEFAULT: List<V> = List {
            items: Vec::new(),
            start: 0,
            end: 0,
        };
    }

    /// A list in the arena and the offset after the token that closes it.
    #[derive(Clone, Copy)]
    pub(crate) struct Closed {
        pub(crate) list: ts::List<ts::Type>,
        pub(crate) close_end: u32,
    }

    /// The union or intersection that the turns of one operator loop add to.
    pub(crate) struct Set {
        pub(crate) items: Vec<ts::Type>,
        pub(crate) is_union: bool,
        pub(crate) is_open: bool,
        pub(crate) start: u32,
    }

    impl ConstDefault for Set {
        const DEFAULT: Set = Set {
            items: Vec::new(),
            is_union: false,
            is_open: false,
            start: 0,
        };
    }

    /// The "|" and the "&" that lead a type.
    pub(crate) struct Lead {
        pub(crate) bar: Option<u32>,
        pub(crate) ampersand: Option<u32>,
    }

    impl ConstDefault for Lead {
        const DEFAULT: Lead = Lead {
            bar: None,
            ampersand: None,
        };
    }
}

/// Builds the nodes of `bun_ast::ts`, in the arena of the parse.
pub(crate) struct Build;

/// The name that the token the lexer is on spells.
fn name_of(lx: &Lexer<'_>) -> ts::Name {
    let text = if lx.is_identifier_or_keyword() || lx.token == T::TPrivateIdentifier {
        lx.identifier
    } else {
        lx.raw()
    };
    ts::Name::new(text, lx.start as u32, lx.end as u32)
}

/// The token the lexer is on, as a node.
fn token_of(lx: &Lexer<'_>, kind: ts::TokenKind) -> ts::Token {
    ts::Token {
        start: lx.start as u32,
        end: lx.end as u32,
        kind,
    }
}

/// The literal that the token the lexer is on spells, or nothing for another token.
fn literal_of(lx: &mut Lexer<'_>) -> Result<Option<ts::Literal>, Error> {
    let data = match lx.token {
        T::TNumericLiteral => ts::LiteralData::number(lx.number),
        T::TBigIntegerLiteral => ts::LiteralData::bigint(lx.arena, lx.identifier),
        T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => {
            let is_template = lx.token == T::TNoSubstitutionTemplateLiteral;
            let value = lx.to_e_string()?;
            ts::LiteralData::string(lx.arena, value, is_template)
        }
        T::TTrue => ts::LiteralData::True,
        T::TFalse => ts::LiteralData::False,
        T::TNull => ts::LiteralData::Null,
        _ => return Ok(None),
    };
    Ok(Some(ts::Literal {
        start: lx.start as u32,
        end: lx.end as u32,
        data,
    }))
}

/// The keyword type that `word` names.
fn keyword_of(word: &[u8]) -> Option<ts::KeywordKind> {
    Some(match word {
        b"any" => ts::KeywordKind::Any,
        b"unknown" => ts::KeywordKind::Unknown,
        b"string" => ts::KeywordKind::String,
        b"number" => ts::KeywordKind::Number,
        b"bigint" => ts::KeywordKind::BigInt,
        b"symbol" => ts::KeywordKind::Symbol,
        b"boolean" => ts::KeywordKind::Boolean,
        b"undefined" => ts::KeywordKind::Undefined,
        b"never" => ts::KeywordKind::Never,
        b"object" => ts::KeywordKind::Object,
        _ => return None,
    })
}

/// The word that a keyword type spells.
fn keyword_text(kind: ts::KeywordKind) -> &'static [u8] {
    match kind {
        ts::KeywordKind::Any => b"any",
        ts::KeywordKind::Unknown => b"unknown",
        ts::KeywordKind::String => b"string",
        ts::KeywordKind::Number => b"number",
        ts::KeywordKind::BigInt => b"bigint",
        ts::KeywordKind::Symbol => b"symbol",
        ts::KeywordKind::Boolean => b"boolean",
        ts::KeywordKind::Undefined => b"undefined",
        ts::KeywordKind::Never => b"never",
        ts::KeywordKind::Object => b"object",
        ts::KeywordKind::Void => b"void",
        ts::KeywordKind::Intrinsic => b"intrinsic",
    }
}

/// Logs that the token the lexer is on cannot stand where it is, unless an attempt is running.
#[cold]
fn reject(lx: &mut Lexer<'_>) -> Error {
    match lx.unexpected() {
        Ok(()) => Error::SyntaxError,
        Err(err) => err.into(),
    }
}

/// The union or the intersection of what `set` holds.
fn close_set(lx: &Lexer<'_>, set: &mut b::Set) -> ts::Type {
    let (start, end) = (
        set.start,
        set.items.last().map_or(set.start, |last| last.end),
    );
    let types = ts::List::from_slice(lx.arena, &set.items, start, end);
    set.is_open = false;
    set.items.clear();
    if set.is_union {
        ts::Type::alloc(lx.arena, ts::UnionType { types }, start, end)
    } else {
        ts::Type::alloc(lx.arena, ts::IntersectionType { types }, start, end)
    }
}

/// The union or the intersection of `node` alone, which an operator at `start` leads.
fn led(lx: &Lexer<'_>, node: ts::Type, start: u32, is_union: bool) -> ts::Type {
    let types = ts::List::from_slice(lx.arena, &[node], start, node.end);
    if is_union {
        ts::Type::alloc(lx.arena, ts::UnionType { types }, start, node.end)
    } else {
        ts::Type::alloc(lx.arena, ts::IntersectionType { types }, start, node.end)
    }
}

impl TypeSink for Build {
    type Out = Option<ts::Type>;

    const NONE: Option<ts::Type> = None;
    const STRICT: bool = true;
    const BUILDS: bool = true;
    type Sub = Build;
    type K<V: ConstDefault> = V;

    #[inline]
    fn literal(_out: &mut Self::Out, _literal: TypeLiteral) {}
    #[inline]
    fn keyword(_out: &mut Self::Out, _keyword: TypeKeyword) {}
    #[inline]
    fn function_type(_out: &mut Self::Out) {}
    #[inline]
    fn parenthesized(_out: &mut Self::Out, _inner: Self::Out) {}
    #[inline]
    fn keyof_type(_out: &mut Self::Out) {}
    #[inline]
    fn readonly_type(_out: &mut Self::Out) {}
    #[inline]
    fn typeof_query(_out: &mut Self::Out) {}
    #[inline]
    fn tuple_type(_out: &mut Self::Out) {}
    #[inline]
    fn object_type(_out: &mut Self::Out) {}
    #[inline]
    fn template_literal_type(_out: &mut Self::Out) {}
    #[inline]
    fn reference<'a, E>(
        _out: &mut Self::Out,
        _name: &'a [u8],
        _find: impl FnOnce(&'a [u8]) -> Result<Ref, E>,
    ) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn member<'a, E>(
        _out: &mut Self::Out,
        _name: &'a [u8],
        _is_name: bool,
        _find: impl FnOnce(&'a [u8]) -> Result<Ref, E>,
    ) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn index_or_array(_out: &mut Self::Out, _has_index: bool) {}
    #[inline]
    fn union_left<'n>(
        out: &mut Self::Out,
        _load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<Self::Out> {
        Operand::Open(*out)
    }
    #[inline]
    fn union_right(_out: &mut Self::Out, _left: Self::Out) {}
    #[inline]
    fn intersection_left<'n>(
        out: &mut Self::Out,
        _load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<Self::Out> {
        Operand::Open(*out)
    }
    #[inline]
    fn intersection_right(_out: &mut Self::Out, _left: Self::Out) {}
    #[inline]
    fn conditional_true<'n>(
        _out: &mut Self::Out,
        when_true: Self::Out,
        _load_name: impl Fn(Ref) -> &'n [u8],
    ) -> Operand<Self::Out> {
        Operand::Open(when_true)
    }
    #[inline]
    fn conditional_false(_out: &mut Self::Out, _left: Self::Out) {}

    #[inline]
    fn node(out: &Self::Out) -> Option<ts::Type> {
        *out
    }

    fn b_take(out: &mut Self::Out) -> Option<ts::Type> {
        out.take()
    }

    fn b_node(out: &mut Self::Out, node: ts::Type) {
        *out = Some(node);
    }

    fn b_start(lx: &Lexer<'_>) -> u32 {
        lx.start as u32
    }

    fn b_tok(lx: &Lexer<'_>, kind: ts::TokenKind) -> Option<ts::Token> {
        Some(token_of(lx, kind))
    }

    fn b_ident(lx: &Lexer<'_>) -> Option<ts::Name> {
        if lx.is_identifier_or_keyword() {
            Some(name_of(lx))
        } else {
            None
        }
    }

    fn b_token(lx: &mut Lexer<'_>, out: &mut Self::Out) -> Result<(), Error> {
        let (start, end) = (lx.start as u32, lx.end as u32);
        *out = match lx.token {
            T::TVoid => Some(ts::Type::keyword(ts::KeywordKind::Void, start, end)),
            T::TThis => Some(ts::Type::this(start, end)),
            T::TIdentifier => {
                keyword_of(lx.identifier).map(|kind| ts::Type::keyword(kind, start, end))
            }
            _ => literal_of(lx)?.map(|literal| {
                let payload = ts::LiteralType {
                    literal,
                    negative: false,
                };
                ts::Type::alloc(lx.arena, payload, start, end)
            }),
        };
        Ok(())
    }

    fn b_negative(lx: &mut Lexer<'_>, out: &mut Self::Out, start: &u32) -> Result<(), Error> {
        let end = lx.end as u32;
        *out = match lx.token {
            T::TNumericLiteral | T::TBigIntegerLiteral => literal_of(lx)?.map(|literal| {
                let payload = ts::LiteralType {
                    literal,
                    negative: true,
                };
                ts::Type::alloc(lx.arena, payload, *start, end)
            }),
            _ => None,
        };
        Ok(())
    }

    fn b_reference(lx: &Lexer<'_>, out: &mut Self::Out) {
        let name = name_of(lx);
        let payload = ts::TypeReference {
            type_name: ts::EntityName::Identifier(name),
            type_arguments: None,
        };
        *out = Some(ts::Type::alloc(lx.arena, payload, name.start, name.end));
    }

    fn b_member(lx: &mut Lexer<'_>, out: &mut Self::Out) -> Result<(), Error> {
        let right = name_of(lx);
        let Some(node) = out else {
            return Err(reject(lx));
        };
        match node.data {
            ts::TypeData::TypeReference(mut reference) if reference.type_arguments.is_none() => {
                reference.type_name =
                    ts::EntityName::qualified(lx.arena, reference.type_name, right);
            }
            ts::TypeData::Import(mut import) if import.type_arguments.is_none() => {
                import.qualifier = Some(match import.qualifier {
                    Some(left) => ts::EntityName::qualified(lx.arena, left, right),
                    None => ts::EntityName::Identifier(right),
                });
            }
            ts::TypeData::Keyword(kind) => {
                let left = ts::Name::new(keyword_text(kind), node.start, node.end);
                let payload = ts::TypeReference {
                    type_name: ts::EntityName::qualified(
                        lx.arena,
                        ts::EntityName::Identifier(left),
                        right,
                    ),
                    type_arguments: None,
                };
                node.data = payload.into_type_data(lx.arena);
            }
            _ => return Err(reject(lx)),
        }
        node.end = right.end;
        Ok(())
    }

    fn b_type_arguments(
        lx: &mut Lexer<'_>,
        out: &mut Self::Out,
        arguments: Option<b::Closed>,
    ) -> Result<(), Error> {
        let Some(arguments) = arguments else {
            return Ok(());
        };
        let Some(node) = out else {
            return Err(reject(lx));
        };
        match node.data {
            ts::TypeData::TypeReference(mut reference) => {
                reference.type_arguments = Some(arguments.list);
            }
            ts::TypeData::Import(mut import) => import.type_arguments = Some(arguments.list),
            ts::TypeData::TypeQuery(mut query) => query.type_arguments = Some(arguments.list),
            _ => return Err(reject(lx)),
        }
        node.end = arguments.close_end;
        Ok(())
    }

    fn b_query(lx: &Lexer<'_>, out: &mut Self::Out, start: &u32) {
        let Some(node) = *out else {
            return;
        };
        if let ts::TypeData::TypeReference(reference) = node.data {
            let payload = ts::TypeQuery {
                expr_name: reference.type_name,
                type_arguments: reference.type_arguments,
            };
            *out = Some(ts::Type::alloc(lx.arena, payload, *start, node.end));
        }
    }

    fn b_index(lx: &Lexer<'_>, out: &mut Self::Out, index: Option<ts::Type>) {
        let Some(object_type) = *out else {
            return;
        };
        let (start, end) = (object_type.start, lx.end as u32);
        *out = Some(match index {
            Some(index_type) => {
                let payload = ts::IndexedAccessType {
                    object_type,
                    index_type,
                };
                ts::Type::alloc(lx.arena, payload, start, end)
            }
            None => {
                let payload = ts::ArrayType {
                    element_type: object_type,
                };
                ts::Type::alloc(lx.arena, payload, start, end)
            }
        });
    }

    fn b_non_null(lx: &Lexer<'_>, out: &mut Self::Out) {
        let Some(type_node) = *out else {
            return;
        };
        let payload = ts::JSDocNonNullableType { type_node };
        *out = Some(ts::Type::alloc(
            lx.arena,
            payload,
            type_node.start,
            lx.end as u32,
        ));
    }

    fn b_operator(
        lx: &Lexer<'_>,
        out: &mut Self::Out,
        start: &u32,
        operator: ts::TypeOperatorKind,
        operand: Option<ts::Type>,
    ) {
        *out = operand.map(|type_node| {
            let payload = ts::TypeOperator {
                operator,
                type_node,
            };
            ts::Type::alloc(lx.arena, payload, *start, type_node.end)
        });
    }

    fn b_infer(
        lx: &Lexer<'_>,
        out: &mut Self::Out,
        start: &u32,
        name: Option<ts::Name>,
        constraint: Option<ts::Type>,
    ) {
        *out = name.map(|name| {
            let end = constraint.map_or(name.end, |constraint| constraint.end);
            let type_parameter = ts::TypeParameter {
                start: name.start,
                end,
                modifiers: StoreSlice::EMPTY,
                name,
                constraint,
                expression: None,
                default_type: None,
            };
            ts::Type::alloc(lx.arena, ts::InferType { type_parameter }, *start, end)
        });
    }

    fn b_conditional(
        lx: &Lexer<'_>,
        out: &mut Self::Out,
        check: Option<ts::Type>,
        extends: Option<ts::Type>,
        when_true: Option<ts::Type>,
    ) {
        let (Some(check_type), Some(extends_type), Some(true_type), Some(false_type)) =
            (check, extends, when_true, *out)
        else {
            return;
        };
        let payload = ts::ConditionalType {
            check_type,
            extends_type,
            true_type,
            false_type,
        };
        let (start, end) = (check_type.start, false_type.end);
        *out = Some(ts::Type::alloc(lx.arena, payload, start, end));
    }

    fn b_predicate(
        lx: &mut Lexer<'_>,
        out: &mut Self::Out,
        asserts: Option<ts::Token>,
        type_node: Option<ts::Type>,
    ) -> Result<(), Error> {
        let Some(node) = *out else {
            return Err(reject(lx));
        };
        let parameter_name = match node.data {
            ts::TypeData::This => ts::TypePredicateParameterName::This {
                start: node.start,
                end: node.end,
            },
            ts::TypeData::TypeReference(reference) if reference.type_arguments.is_none() => {
                match reference.type_name {
                    ts::EntityName::Identifier(name) => {
                        ts::TypePredicateParameterName::Identifier(name)
                    }
                    ts::EntityName::QualifiedName(_) => return Err(reject(lx)),
                }
            }
            ts::TypeData::Keyword(kind) => {
                let name = ts::Name::new(keyword_text(kind), node.start, node.end);
                ts::TypePredicateParameterName::Identifier(name)
            }
            ts::TypeData::TypePredicate(mut predicate) if predicate.type_node.is_none() => {
                if let (Some(type_node), Some(node)) = (type_node, out.as_mut()) {
                    predicate.type_node = Some(type_node);
                    node.end = type_node.end;
                }
                return Ok(());
            }
            _ => return Err(reject(lx)),
        };
        let start = asserts.map_or(node.start, |asserts| asserts.start);
        let end = type_node.map_or(node.end, |type_node| type_node.end);
        let payload = ts::TypePredicate {
            asserts_modifier: asserts,
            parameter_name,
            type_node,
        };
        *out = Some(ts::Type::alloc(lx.arena, payload, start, end));
        Ok(())
    }

    fn b_template_piece(lx: &mut Lexer<'_>) -> Result<Option<ts::TemplatePiece>, Error> {
        let kind = match lx.token {
            T::TTemplateHead => ts::TemplatePieceKind::Head,
            T::TTemplateMiddle => ts::TemplatePieceKind::Middle,
            T::TTemplateTail => ts::TemplatePieceKind::Tail,
            _ => return Ok(None),
        };
        let text = lx.to_e_string()?;
        Ok(Some(ts::TemplatePiece {
            start: lx.start as u32,
            end: lx.end as u32,
            kind,
            text: StoreRef::from_bump(lx.arena.alloc(text)),
        }))
    }

    fn b_template_span(
        spans: &mut b::List<ts::TemplateLiteralTypeSpan>,
        type_node: Option<ts::Type>,
        literal: Option<ts::TemplatePiece>,
    ) {
        let (Some(type_node), Some(literal)) = (type_node, literal) else {
            return;
        };
        spans.end = literal.end;
        spans.items.push(ts::TemplateLiteralTypeSpan {
            start: type_node.start,
            end: literal.end,
            type_node,
            literal,
        });
    }

    fn b_template(
        lx: &Lexer<'_>,
        out: &mut Self::Out,
        head: Option<ts::TemplatePiece>,
        spans: b::List<ts::TemplateLiteralTypeSpan>,
    ) {
        *out = head.map(|head| {
            let end = spans.end.max(head.end);
            let template_spans = ts::List::from_slice(lx.arena, &spans.items, head.end, end);
            let payload = ts::TemplateLiteralType {
                head,
                template_spans,
            };
            ts::Type::alloc(lx.arena, payload, head.start, end)
        });
    }

    fn b_list(lx: &Lexer<'_>) -> b::List<ts::Type> {
        // "<" may be the first character of a longer token
        let start = lx.start as u32 + 1;
        b::List {
            items: Vec::new(),
            start,
            end: start,
        }
    }

    fn b_push_type(list: &mut b::List<ts::Type>, item: Option<ts::Type>) {
        if let Some(item) = item {
            list.end = item.end;
            list.items.push(item);
        }
    }

    fn b_separator(lx: &Lexer<'_>, list: &mut b::List<ts::Type>) {
        list.end = lx.end as u32;
    }

    fn b_close(lx: &Lexer<'_>, list: b::List<ts::Type>) -> Option<b::Closed> {
        Some(b::Closed {
            list: ts::List::from_slice(lx.arena, &list.items, list.start, list.end),
            // ">" may be the first character of a longer token
            close_end: lx.start as u32 + 1,
        })
    }

    fn b_leading(lx: &Lexer<'_>, lead: &mut b::Lead) {
        let at = lx.start as u32;
        if lx.token == T::TBar {
            lead.bar.get_or_insert(at);
        } else {
            lead.ampersand.get_or_insert(at);
        }
    }

    fn b_operand(
        lx: &Lexer<'_>,
        out: &mut Self::Out,
        set: &mut b::Set,
        lead: &mut b::Lead,
        is_union: bool,
    ) {
        let Some(mut left) = out.take() else {
            return;
        };
        if set.is_open {
            if set.is_union == is_union {
                return;
            }
            left = close_set(lx, set);
        } else if is_union {
            // a "&" that leads belongs to the intersection that ends where "|" starts
            if let Some(start) = lead.ampersand.take() {
                left = led(lx, left, start, false);
            }
        }
        let leading = if is_union {
            lead.bar.take()
        } else {
            lead.ampersand.take()
        };
        set.start = leading.unwrap_or(left.start);
        set.is_union = is_union;
        set.is_open = true;
        set.items.push(left);
    }

    fn b_operand_end(out: &mut Self::Out, set: &mut b::Set) {
        if let (true, Some(right)) = (set.is_open, *out) {
            set.items.push(right);
        }
    }

    fn b_finish(lx: &Lexer<'_>, out: &mut Self::Out, set: &mut b::Set, lead: &mut b::Lead) {
        if set.is_open {
            *out = Some(close_set(lx, set));
        }
        let Some(mut node) = *out else {
            return;
        };
        if let Some(start) = lead.ampersand.take() {
            node = led(lx, node, start, false);
        }
        if let Some(start) = lead.bar.take() {
            node = led(lx, node, start, true);
        }
        *out = Some(node);
    }
}

/// The productions that `Build` reads the way typescript-go reads them, where the other sinks read more loosely.
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Reads one type at `level` and builds its node.
    #[cold]
    pub fn build_type_script_type(&mut self, level: Level) -> Result<ts::Type, Error> {
        self.build_type_with_opts(level, SkipTypeOptionsBitset::empty())
    }

    fn build_type_with_opts(
        &mut self,
        level: Level,
        opts: SkipTypeOptionsBitset,
    ) -> Result<ts::Type, Error> {
        let mut out = None;
        self.skip_type_script_type_with_opts::<Build>(level, opts, &mut out)?;
        match out {
            Some(node) => Ok(node),
            None => Err(reject(&mut self.lexer)),
        }
    }

    /// parseTypeOrTypePredicate: reads a return type and builds its node.
    #[cold]
    pub fn build_typescript_return_type(&mut self) -> Result<ts::Type, Error> {
        let is_predicate = self.lexer.token == T::TIdentifier
            && self.build_look_ahead(|p| {
                p.lexer.next()?;
                Ok(p.lexer.is_contextual_keyword(b"is") && !p.lexer.has_newline_before)
            });
        if is_predicate {
            let name = name_of(&self.lexer);
            self.lexer.next()?;
            self.lexer.next()?;
            let type_node = self.build_type_script_type(Level::Lowest)?;
            let payload = ts::TypePredicate {
                asserts_modifier: None,
                parameter_name: ts::TypePredicateParameterName::Identifier(name),
                type_node: Some(type_node),
            };
            return Ok(ts::Type::alloc(
                self.arena,
                payload,
                name.start,
                type_node.end,
            ));
        }
        self.build_type_with_opts(
            Level::Lowest,
            SkipTypeOptionsBitset::only(SkipTypeOptions::IsReturnType),
        )
    }

    /// Reads type arguments, if "<" starts them here, and builds their list. The offset is the one after ">".
    #[cold]
    pub fn build_type_script_type_arguments<
        const IS_INSIDE_JSX_ELEMENT: bool,
        const IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION: bool,
    >(
        &mut self,
    ) -> Result<Option<(ts::List<ts::Type>, u32)>, Error> {
        let (_, arguments) = self.skip_type_script_type_arguments_in::<
            Build,
            IS_INSIDE_JSX_ELEMENT,
            IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION,
        >()?;
        Ok(arguments.map(|closed| (closed.list, closed.close_end)))
    }

    /// parseTypeParameters: reads type parameters, if "<" starts them here, and builds their list. The offset is the one after ">".
    #[cold]
    pub fn build_type_script_type_parameters(
        &mut self,
    ) -> Result<Option<(ts::List<ts::TypeParameter>, u32)>, Error> {
        if self.lexer.token != T::TLessThan {
            return Ok(None);
        }
        let start = self.lexer.end as u32;
        let mut items = Vec::new();
        let mut end = start;
        self.lexer.next()?;
        while !self.build_is_greater_than() {
            let parameter = self.build_type_parameter()?;
            end = parameter.end;
            items.push(parameter);
            if self.lexer.token != T::TComma {
                break;
            }
            end = self.lexer.end as u32;
            self.lexer.next()?;
        }
        // ">" may be the first character of a longer token
        let close_end = self.lexer.start as u32 + 1;
        self.lexer.expect_greater_than::<false>()?;
        let list = ts::List::from_slice(self.arena, &items, start, end);
        Ok(Some((list, close_end)))
    }

    /// Whether `test` holds from the token the lexer is on. Nothing moves.
    fn build_look_ahead(&mut self, test: impl FnOnce(&mut Self) -> Result<bool, Error>) -> bool {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let holds = test(self).unwrap_or(false);
        self.lexer.restore(&old_lexer);
        holds
    }

    /// Whether `token` follows the token the lexer is on.
    pub(crate) fn build_next_token_is(&mut self, token: T) -> bool {
        self.build_look_ahead(|p| {
            p.lexer.next()?;
            Ok(p.lexer.token == token)
        })
    }

    pub(crate) fn build_is_greater_than(&self) -> bool {
        matches!(
            self.lexer.token,
            T::TGreaterThan
                | T::TGreaterThanEquals
                | T::TGreaterThanGreaterThan
                | T::TGreaterThanGreaterThanEquals
                | T::TGreaterThanGreaterThanGreaterThan
                | T::TGreaterThanGreaterThanGreaterThanEquals
        )
    }

    /// Runs `read`, which may read expressions, and keeps what it returns and the offset after it: what it declared goes away.
    fn build_in_type<R>(
        &mut self,
        read: impl FnOnce(&mut Self) -> Result<R, Error>,
    ) -> Result<(R, u32), Error> {
        let errors = self.log().errors;
        let msgs_len = self.log().msgs.len();
        let has_import_meta = self.has_import_meta;
        let has_with_scope = self.has_with_scope;
        let has_es_module_syntax = self.has_es_module_syntax;
        let needs_jsx_import = self.needs_jsx_import;
        let top_level_await_keyword = self.top_level_await_keyword;
        // A name in what is read here is no use of an import.
        let parse_pass_symbol_uses = self.parse_pass_symbol_uses.take();
        let names_len = self.allocated_names.len();
        let comments_len = self.lexer.all_comments.len();
        let is_log_disabled = self.lexer.is_log_disabled;
        let snapshot = self.parser_snapshot();

        self.allow_in = true;
        self.allow_private_identifiers = true;
        self.fn_or_arrow_data_parse.allow_super_call = true;
        self.fn_or_arrow_data_parse.allow_super_property = true;
        let result = read(self);

        let has_failed = result.is_err() || self.log().errors != errors;
        let mut end = self.lexer.snapshot();
        let names: Vec<&'a [u8]> = self
            .allocated_names
            .iter()
            .skip(names_len)
            .copied()
            .collect();
        let comments: Vec<bun_ast::Range> = self
            .lexer
            .all_comments
            .iter()
            .skip(comments_len)
            .copied()
            .collect();
        let log = self.log();
        let (errors_after, warnings_after) = (log.errors, log.warnings);
        let logged: Vec<bun_ast::Msg> = if has_failed && log.msgs.len() > msgs_len {
            log.msgs.drain(msgs_len..).collect()
        } else {
            Vec::new()
        };

        self.restore_parser_snapshot(snapshot);
        self.parse_pass_symbol_uses = parse_pass_symbol_uses;
        self.has_import_meta = has_import_meta;
        self.has_with_scope = has_with_scope;
        self.has_es_module_syntax = has_es_module_syntax;
        self.needs_jsx_import = needs_jsx_import;
        self.top_level_await_keyword = top_level_await_keyword;
        // The tree that stays names them by index.
        for name in names {
            self.allocated_names.push(name);
        }

        if has_failed {
            let log = self.log();
            log.msgs.extend(logged);
            log.errors = errors_after;
            log.warnings = warnings_after;
            return Err(match result {
                Err(err) => err,
                Ok(_) => Error::SyntaxError,
            });
        }

        self.lexer.all_comments.extend(comments);
        end.is_log_disabled = is_log_disabled;
        end.prev_error_loc = self.lexer.prev_error_loc;
        end.all_comments_len = self.lexer.all_comments.len();
        end.comments_to_preserve_before_len = self.lexer.comments_to_preserve_before.len();
        self.lexer.restore(&end);
        let end = ts::full_start(
            self.lexer.contents,
            &self.lexer.all_comments,
            self.lexer.start as u32,
        );
        result.map(|read| (read, end))
    }

    /// An expression inside a type.
    fn build_expr_in_type(&mut self, level: Level) -> Result<(Expr, u32), Error> {
        self.build_in_type(|p| p.parse_expr(level))
    }

    /// The modifier that the token the lexer is on spells.
    fn build_modifier_kind(&self) -> Option<ts::ModifierKind> {
        match self.lexer.token {
            T::TIn => Some(ts::ModifierKind::In),
            T::TConst => Some(ts::ModifierKind::Const),
            T::TIdentifier => Some(match self.lexer.raw() {
                b"abstract" => ts::ModifierKind::Abstract,
                b"accessor" => ts::ModifierKind::Accessor,
                b"async" => ts::ModifierKind::Async,
                b"declare" => ts::ModifierKind::Declare,
                b"private" => ts::ModifierKind::Private,
                b"protected" => ts::ModifierKind::Protected,
                b"public" => ts::ModifierKind::Public,
                b"readonly" => ts::ModifierKind::Readonly,
                b"out" => ts::ModifierKind::Out,
                b"override" => ts::ModifierKind::Override,
                b"static" => ts::ModifierKind::Static,
                _ => return None,
            }),
            _ => None,
        }
    }

    /// isLiteralPropertyName
    fn build_is_literal_property_name(&self) -> bool {
        self.lexer.is_identifier_or_keyword()
            || matches!(
                self.lexer.token,
                T::TStringLiteral | T::TNumericLiteral | T::TBigIntegerLiteral
            )
    }

    /// canFollowModifier
    fn build_can_follow_modifier(&self) -> bool {
        matches!(
            self.lexer.token,
            T::TOpenBracket | T::TOpenBrace | T::TAsterisk | T::TDotDotDot
        ) || self.build_is_literal_property_name()
    }

    /// parseModifiers: the words that are modifiers of what follows them.
    fn build_modifiers(
        &mut self,
        modifiers: &mut Vec<ts::Modifier>,
        permit_const: bool,
    ) -> Result<(), Error> {
        let mut has_static = false;
        while let Some(kind) = self.build_modifier_kind() {
            let is_static = kind == ts::ModifierKind::Static;
            if (is_static && has_static) || (kind == ts::ModifierKind::Const && !permit_const) {
                break;
            }
            // nextTokenCanFollowModifier: only "static" may stand before a line break
            let can_follow = self.build_look_ahead(|p| {
                p.lexer.next()?;
                Ok((is_static || !p.lexer.has_newline_before) && p.build_can_follow_modifier())
            });
            if !can_follow {
                break;
            }
            has_static |= is_static;
            modifiers.push(ts::Modifier::keyword(
                kind,
                self.lexer.start as u32,
                self.lexer.end as u32,
            ));
            self.lexer.next()?;
        }
        Ok(())
    }

    fn build_modifier_slice(
        &mut self,
        permit_const: bool,
    ) -> Result<StoreSlice<ts::Modifier>, Error> {
        let mut modifiers = Vec::new();
        self.build_modifiers(&mut modifiers, permit_const)?;
        Ok(StoreSlice::new_mut(self.arena.alloc_slice_copy(&modifiers)))
    }

    /// parseTypeParameter
    fn build_type_parameter(&mut self) -> Result<ts::TypeParameter, Error> {
        let start = self.lexer.start as u32;
        let modifiers = self.build_modifier_slice(true)?;
        if self.lexer.token != T::TIdentifier {
            self.lexer.expected(T::TIdentifier)?;
            return Err(Error::SyntaxError);
        }
        let name = name_of(&self.lexer);
        let mut end = name.end;
        self.lexer.next()?;
        let mut constraint = None;
        if self.lexer.token == T::TExtends {
            self.lexer.next()?;
            let type_node = self.build_type_script_type(Level::Lowest)?;
            end = type_node.end;
            constraint = Some(type_node);
        }
        let mut default_type = None;
        if self.lexer.token == T::TEquals {
            self.lexer.next()?;
            let type_node = self.build_type_script_type(Level::Lowest)?;
            end = type_node.end;
            default_type = Some(type_node);
        }
        Ok(ts::TypeParameter {
            start,
            end,
            modifiers,
            name,
            constraint,
            expression: None,
            default_type,
        })
    }

    /// The parameters between `open` and `close`, and the offset after `close`.
    fn build_parameter_list(
        &mut self,
        open: T,
        close: T,
    ) -> Result<(ts::List<ts::Parameter>, u32), Error> {
        let start = self.lexer.end as u32;
        let mut items = Vec::new();
        let mut end = start;
        self.lexer.expect(open)?;
        while self.lexer.token != close {
            let parameter = self.build_parameter()?;
            end = parameter.end;
            items.push(parameter);
            if self.lexer.token != T::TComma {
                break;
            }
            end = self.lexer.end as u32;
            self.lexer.next()?;
        }
        let close_end = self.lexer.end as u32;
        self.lexer.expect(close)?;
        Ok((
            ts::List::from_slice(self.arena, &items, start, end),
            close_end,
        ))
    }

    /// parseParameter
    fn build_parameter(&mut self) -> Result<ts::Parameter, Error> {
        let start = self.lexer.start as u32;
        let modifiers = self.build_modifier_slice(false)?;
        let mut dot_dot_dot_token = None;
        let mut question_token = None;
        let is_this = self.lexer.token == T::TThis;
        let (name, mut end) = if is_this {
            let loc = self.lexer.loc();
            let r#ref = self.store_name_in_ref(self.lexer.raw());
            let end = self.lexer.end as u32;
            self.lexer.next()?;
            (self.b(B::Identifier { r#ref }, loc), end)
        } else {
            if self.lexer.token == T::TDotDotDot {
                dot_dot_dot_token = Some(token_of(&self.lexer, ts::TokenKind::DotDotDot));
                self.lexer.next()?;
            }
            self.build_in_type(|p| p.parse_binding(ParseBindingOptions::default()))?
        };
        if !is_this && self.lexer.token == T::TQuestion {
            question_token = Some(token_of(&self.lexer, ts::TokenKind::Question));
            end = self.lexer.end as u32;
            self.lexer.next()?;
        }
        let mut type_node = None;
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            let annotation = self.build_type_script_type(Level::Lowest)?;
            end = annotation.end;
            type_node = Some(annotation);
        }
        let mut initializer = None;
        if !is_this && self.lexer.token == T::TEquals {
            self.lexer.next()?;
            let (value, value_end) = self.build_expr_in_type(Level::Comma)?;
            end = value_end;
            initializer = Some(value);
        }
        Ok(ts::Parameter {
            start,
            end,
            modifiers,
            dot_dot_dot_token,
            name,
            question_token,
            type_node,
            initializer,
        })
    }

    /// nextIsUnambiguouslyStartOfFunctionType, at "(".
    fn build_next_is_start_of_fn_type(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        if self.lexer.token == T::TCloseParen || self.lexer.token == T::TDotDotDot {
            return Ok(true);
        }
        // skipParameterStart
        let mut modifiers = Vec::new();
        self.build_modifiers(&mut modifiers, false)?;
        if self.lexer.token == T::TDotDotDot {
            self.lexer.next()?;
        }
        match self.lexer.token {
            T::TIdentifier | T::TThis => self.lexer.next()?,
            T::TOpenBracket | T::TOpenBrace => {
                let pattern =
                    self.build_in_type(|p| p.parse_binding(ParseBindingOptions::default()));
                if pattern.is_err() {
                    return Ok(false);
                }
            }
            _ => return Ok(false),
        }
        if matches!(
            self.lexer.token,
            T::TColon | T::TComma | T::TQuestion | T::TEquals
        ) {
            return Ok(true);
        }
        if self.lexer.token == T::TCloseParen {
            self.lexer.next()?;
            return Ok(self.lexer.token == T::TEqualsGreaterThan);
        }
        Ok(false)
    }

    /// parseFunctionOrConstructorType, at `abstract`, `new`, "<" or "(".
    pub(crate) fn build_type_script_fn_type(&mut self) -> Result<ts::Type, Error> {
        let start = self.lexer.start as u32;
        let mut modifiers = Vec::new();
        if self.lexer.token == T::TIdentifier {
            let end = self.lexer.end as u32;
            modifiers.push(ts::Modifier::keyword(
                ts::ModifierKind::Abstract,
                start,
                end,
            ));
            self.lexer.next()?;
        }
        let is_constructor = self.lexer.token == T::TNew;
        if is_constructor {
            self.lexer.next()?;
        }
        let type_parameters = self
            .build_type_script_type_parameters()?
            .map(|(list, _)| list);
        let (parameters, _) = self.build_parameter_list(T::TOpenParen, T::TCloseParen)?;
        self.lexer.expect(T::TEqualsGreaterThan)?;
        let type_node = self.build_typescript_return_type()?;
        let end = type_node.end;
        Ok(if is_constructor {
            let payload = ts::ConstructorType {
                modifiers: StoreSlice::new_mut(self.arena.alloc_slice_copy(&modifiers)),
                type_parameters,
                parameters,
                type_node: Some(type_node),
            };
            ts::Type::alloc(self.arena, payload, start, end)
        } else {
            let payload = ts::FunctionType {
                type_parameters,
                parameters,
                type_node: Some(type_node),
            };
            ts::Type::alloc(self.arena, payload, start, end)
        })
    }

    /// A function type or parseParenthesizedType, at "(".
    pub(crate) fn build_type_script_paren_or_fn_type(&mut self) -> Result<ts::Type, Error> {
        if self.build_look_ahead(Self::build_next_is_start_of_fn_type) {
            return self.build_type_script_fn_type();
        }
        let start = self.lexer.start as u32;
        self.lexer.next()?;
        let type_node = self.build_type_script_type(Level::Lowest)?;
        let end = self.lexer.end as u32;
        self.lexer.expect(T::TCloseParen)?;
        let payload = ts::ParenthesizedType { type_node };
        Ok(ts::Type::alloc(self.arena, payload, start, end))
    }

    /// parseTupleType, at "[".
    pub(crate) fn build_type_script_tuple_type(&mut self) -> Result<ts::Type, Error> {
        let start = self.lexer.start as u32;
        let list_start = self.lexer.end as u32;
        let mut items = Vec::new();
        let mut list_end = list_start;
        self.lexer.next()?;
        while self.lexer.token != T::TCloseBracket {
            let element = self.build_tuple_element()?;
            list_end = element.end;
            items.push(element);
            if self.lexer.token != T::TComma {
                break;
            }
            list_end = self.lexer.end as u32;
            self.lexer.next()?;
        }
        let end = self.lexer.end as u32;
        self.lexer.expect(T::TCloseBracket)?;
        let elements = ts::List::from_slice(self.arena, &items, list_start, list_end);
        Ok(ts::Type::alloc(
            self.arena,
            ts::TupleType { elements },
            start,
            end,
        ))
    }

    /// parseTupleElementNameOrTupleElementType
    fn build_tuple_element(&mut self) -> Result<ts::Type, Error> {
        // scanStartOfNamedTupleElement
        let is_named = self.build_look_ahead(|p| {
            if p.lexer.token == T::TDotDotDot {
                p.lexer.next()?;
            }
            if !p.lexer.is_identifier_or_keyword() {
                return Ok(false);
            }
            p.lexer.next()?;
            if p.lexer.token == T::TQuestion {
                p.lexer.next()?;
            }
            Ok(p.lexer.token == T::TColon)
        });
        if !is_named {
            return self.build_tuple_element_type();
        }
        let start = self.lexer.start as u32;
        let mut dot_dot_dot_token = None;
        if self.lexer.token == T::TDotDotDot {
            dot_dot_dot_token = Some(token_of(&self.lexer, ts::TokenKind::DotDotDot));
            self.lexer.next()?;
        }
        let name = name_of(&self.lexer);
        self.lexer.next()?;
        let mut question_token = None;
        if self.lexer.token == T::TQuestion {
            question_token = Some(token_of(&self.lexer, ts::TokenKind::Question));
            self.lexer.next()?;
        }
        self.lexer.expect(T::TColon)?;
        let type_node = self.build_tuple_element_type()?;
        let payload = ts::NamedTupleMember {
            dot_dot_dot_token,
            name,
            question_token,
            type_node,
        };
        Ok(ts::Type::alloc(self.arena, payload, start, type_node.end))
    }

    /// parseTupleElementType: `...type`, `type?` or a type.
    fn build_tuple_element_type(&mut self) -> Result<ts::Type, Error> {
        let start = self.lexer.start as u32;
        let is_rest = self.lexer.token == T::TDotDotDot;
        if is_rest {
            self.lexer.next()?;
        }
        let mut type_node = self.build_type_script_type(Level::Lowest)?;
        if self.lexer.token == T::TQuestion {
            let (inner_start, end) = (type_node.start, self.lexer.end as u32);
            self.lexer.next()?;
            type_node = if is_rest {
                ts::Type::alloc(
                    self.arena,
                    ts::JSDocNullableType { type_node },
                    inner_start,
                    end,
                )
            } else {
                ts::Type::alloc(self.arena, ts::OptionalType { type_node }, inner_start, end)
            };
        }
        if is_rest {
            let end = type_node.end;
            type_node = ts::Type::alloc(self.arena, ts::RestType { type_node }, start, end);
        }
        Ok(type_node)
    }

    /// parseTypeLiteral or parseMappedType, at "{".
    pub(crate) fn build_type_script_object_type(&mut self) -> Result<ts::Type, Error> {
        let start = self.lexer.start as u32;
        if self.build_look_ahead(Self::build_next_is_start_of_mapped_type) {
            return self.build_mapped_type(start);
        }
        let list_start = self.lexer.end as u32;
        self.lexer.next()?;
        let members = self.build_type_member_list(list_start)?;
        let end = self.lexer.end as u32;
        self.lexer.expect(T::TCloseBrace)?;
        Ok(ts::Type::alloc(
            self.arena,
            ts::TypeLiteral { members },
            start,
            end,
        ))
    }

    /// The members up to "}", in a list that starts at `start`.
    fn build_type_member_list(&mut self, start: u32) -> Result<ts::List<ts::Member>, Error> {
        let mut items = Vec::new();
        let mut end = start;
        while self.lexer.token != T::TCloseBrace && self.lexer.token != T::TEndOfFile {
            let member = self.build_type_member()?;
            end = member.end;
            items.push(member);
        }
        Ok(ts::List::from_slice(self.arena, &items, start, end))
    }

    /// parseTypeMember
    fn build_type_member(&mut self) -> Result<ts::Member, Error> {
        let start = self.lexer.start as u32;
        if self.lexer.token == T::TOpenParen || self.lexer.token == T::TLessThan {
            return self.build_signature_member(start, false);
        }
        if self.lexer.token == T::TNew
            && self.build_look_ahead(|p| {
                p.lexer.next()?;
                Ok(p.lexer.token == T::TOpenParen || p.lexer.token == T::TLessThan)
            })
        {
            self.lexer.next()?;
            return self.build_signature_member(start, true);
        }
        let modifiers = self.build_modifier_slice(false)?;
        // parseContextualModifier for "get" and "set"
        let is_get = self.lexer.is_contextual_keyword(b"get");
        if (is_get || self.lexer.is_contextual_keyword(b"set"))
            && self.build_look_ahead(|p| {
                p.lexer.next()?;
                Ok(p.lexer.token == T::TOpenBracket || p.build_is_literal_property_name())
            })
        {
            self.lexer.next()?;
            return self.build_accessor(start, modifiers, is_get);
        }
        if self.lexer.token == T::TOpenBracket
            && self.build_look_ahead(Self::build_next_is_index_signature)
        {
            return self.build_index_signature(start, modifiers);
        }
        self.build_property_or_method_signature(start, modifiers)
    }

    /// Type parameters, parameters and the type after ":", and the offset after the last of them.
    fn build_signature(
        &mut self,
    ) -> Result<
        (
            Option<ts::List<ts::TypeParameter>>,
            ts::List<ts::Parameter>,
            Option<ts::Type>,
            u32,
        ),
        Error,
    > {
        let type_parameters = self
            .build_type_script_type_parameters()?
            .map(|(list, _)| list);
        let (parameters, mut end) = self.build_parameter_list(T::TOpenParen, T::TCloseParen)?;
        let mut type_node = None;
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            let return_type = self.build_typescript_return_type()?;
            end = return_type.end;
            type_node = Some(return_type);
        }
        Ok((type_parameters, parameters, type_node, end))
    }

    /// parseTypeMemberSemicolon: the offset after the separator, or `end` where a line break or "}" stands for it.
    fn build_type_member_semicolon(&mut self, end: u32) -> Result<u32, Error> {
        match self.lexer.token {
            T::TComma | T::TSemicolon => {
                let end = self.lexer.end as u32;
                self.lexer.next()?;
                Ok(end)
            }
            T::TCloseBrace | T::TEndOfFile => Ok(end),
            _ if self.lexer.has_newline_before => Ok(end),
            _ => {
                self.lexer.expected(T::TSemicolon)?;
                Err(Error::SyntaxError)
            }
        }
    }

    /// parseSignatureMember, after `new` for a construct signature.
    fn build_signature_member(
        &mut self,
        start: u32,
        is_construct: bool,
    ) -> Result<ts::Member, Error> {
        let (type_parameters, parameters, type_node, end) = self.build_signature()?;
        let end = self.build_type_member_semicolon(end)?;
        Ok(if is_construct {
            let payload = ts::ConstructSignature {
                type_parameters,
                parameters,
                type_node,
            };
            ts::Member::alloc(self.arena, payload, start, end)
        } else {
            let payload = ts::CallSignature {
                type_parameters,
                parameters,
                type_node,
            };
            ts::Member::alloc(self.arena, payload, start, end)
        })
    }

    /// parsePropertyName
    fn build_property_name(&mut self) -> Result<ts::PropertyName, Error> {
        match self.lexer.token {
            T::TStringLiteral | T::TNumericLiteral | T::TBigIntegerLiteral => {
                let literal = literal_of(&mut self.lexer)?;
                self.lexer.next()?;
                literal
                    .map(ts::PropertyName::Literal)
                    .ok_or(Error::SyntaxError)
            }
            T::TOpenBracket => {
                let start = self.lexer.start as u32;
                self.lexer.next()?;
                let (expression, _) = self.build_expr_in_type(Level::Lowest)?;
                let end = self.lexer.end as u32;
                self.lexer.expect(T::TCloseBracket)?;
                Ok(ts::PropertyName::computed(
                    self.arena, expression, start, end,
                ))
            }
            _ if self.lexer.is_identifier_or_keyword()
                || self.lexer.token == T::TPrivateIdentifier =>
            {
                let name = name_of(&self.lexer);
                self.lexer.next()?;
                Ok(ts::PropertyName::Identifier(name))
            }
            _ => {
                self.lexer.expected(T::TIdentifier)?;
                Err(Error::SyntaxError)
            }
        }
    }

    /// parsePropertyOrMethodSignature
    fn build_property_or_method_signature(
        &mut self,
        start: u32,
        modifiers: StoreSlice<ts::Modifier>,
    ) -> Result<ts::Member, Error> {
        let name = self.build_property_name()?;
        let mut end = name.end();
        let mut postfix_token = None;
        if self.lexer.token == T::TQuestion {
            postfix_token = Some(token_of(&self.lexer, ts::TokenKind::Question));
            end = self.lexer.end as u32;
            self.lexer.next()?;
        }
        if self.lexer.token == T::TOpenParen || self.lexer.token == T::TLessThan {
            let (type_parameters, parameters, type_node, end) = self.build_signature()?;
            let end = self.build_type_member_semicolon(end)?;
            let payload = ts::MethodSignature {
                modifiers,
                name,
                postfix_token,
                type_parameters,
                parameters,
                type_node,
            };
            return Ok(ts::Member::alloc(self.arena, payload, start, end));
        }
        let mut type_node = None;
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            let annotation = self.build_type_script_type(Level::Lowest)?;
            end = annotation.end;
            type_node = Some(annotation);
        }
        let mut initializer = None;
        if self.lexer.token == T::TEquals {
            self.lexer.next()?;
            let (value, value_end) = self.build_expr_in_type(Level::Comma)?;
            end = value_end;
            initializer = Some(value);
        }
        let end = self.build_type_member_semicolon(end)?;
        let payload = ts::PropertySignature {
            modifiers,
            name,
            postfix_token,
            type_node,
            initializer,
        };
        Ok(ts::Member::alloc(self.arena, payload, start, end))
    }

    /// parseAccessorDeclaration of a type member, after `get` or `set`.
    fn build_accessor(
        &mut self,
        start: u32,
        modifiers: StoreSlice<ts::Modifier>,
        is_get: bool,
    ) -> Result<ts::Member, Error> {
        let name = self.build_property_name()?;
        let (type_parameters, parameters, type_node, end) = self.build_signature()?;
        let end = self.build_type_member_semicolon(end)?;
        Ok(if is_get {
            let payload = ts::GetAccessor {
                modifiers,
                name,
                type_parameters,
                parameters,
                type_node,
                body: None,
            };
            ts::Member::alloc(self.arena, payload, start, end)
        } else {
            let payload = ts::SetAccessor {
                modifiers,
                name,
                type_parameters,
                parameters,
                type_node,
                body: None,
            };
            ts::Member::alloc(self.arena, payload, start, end)
        })
    }

    /// nextIsUnambiguouslyIndexSignature, at "[".
    fn build_next_is_index_signature(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        if self.lexer.token == T::TDotDotDot || self.lexer.token == T::TCloseBracket {
            return Ok(true);
        }
        if self.build_modifier_kind().is_some() {
            self.lexer.next()?;
            if self.lexer.token == T::TIdentifier {
                return Ok(true);
            }
        } else if self.lexer.token != T::TIdentifier {
            return Ok(false);
        } else {
            self.lexer.next()?;
        }
        if self.lexer.token == T::TColon || self.lexer.token == T::TComma {
            return Ok(true);
        }
        if self.lexer.token != T::TQuestion {
            return Ok(false);
        }
        self.lexer.next()?;
        Ok(matches!(
            self.lexer.token,
            T::TColon | T::TComma | T::TCloseBracket
        ))
    }

    /// parseIndexSignatureDeclaration, at "[".
    fn build_index_signature(
        &mut self,
        start: u32,
        modifiers: StoreSlice<ts::Modifier>,
    ) -> Result<ts::Member, Error> {
        let (parameters, mut end) = self.build_parameter_list(T::TOpenBracket, T::TCloseBracket)?;
        let mut type_node = None;
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            let annotation = self.build_type_script_type(Level::Lowest)?;
            end = annotation.end;
            type_node = Some(annotation);
        }
        let end = self.build_type_member_semicolon(end)?;
        let payload = ts::IndexSignature {
            modifiers,
            parameters,
            type_node,
        };
        Ok(ts::Member::alloc(self.arena, payload, start, end))
    }

    /// nextIsStartOfMappedType, at "{".
    fn build_next_is_start_of_mapped_type(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        if self.lexer.token == T::TPlus || self.lexer.token == T::TMinus {
            self.lexer.next()?;
            return Ok(self.lexer.is_contextual_keyword(b"readonly"));
        }
        if self.lexer.is_contextual_keyword(b"readonly") {
            self.lexer.next()?;
        }
        if self.lexer.token != T::TOpenBracket {
            return Ok(false);
        }
        self.lexer.next()?;
        if self.lexer.token != T::TIdentifier {
            return Ok(false);
        }
        self.lexer.next()?;
        Ok(self.lexer.token == T::TIn)
    }

    /// parseMappedType, at the "{" at `start`.
    fn build_mapped_type(&mut self, start: u32) -> Result<ts::Type, Error> {
        self.lexer.next()?;
        let mut readonly_token = None;
        if self.lexer.token == T::TPlus || self.lexer.token == T::TMinus {
            let kind = if self.lexer.token == T::TPlus {
                ts::TokenKind::Plus
            } else {
                ts::TokenKind::Minus
            };
            readonly_token = Some(token_of(&self.lexer, kind));
            self.lexer.next()?;
            self.lexer.expect_contextual_keyword(b"readonly")?;
        } else if self.lexer.is_contextual_keyword(b"readonly") {
            readonly_token = Some(token_of(&self.lexer, ts::TokenKind::Readonly));
            self.lexer.next()?;
        }
        self.lexer.expect(T::TOpenBracket)?;
        // parseMappedTypeParameter
        if !self.lexer.is_identifier_or_keyword() {
            self.lexer.expected(T::TIdentifier)?;
            return Err(Error::SyntaxError);
        }
        let name = name_of(&self.lexer);
        self.lexer.next()?;
        self.lexer.expect(T::TIn)?;
        let constraint = self.build_type_script_type(Level::Lowest)?;
        let type_parameter = ts::TypeParameter {
            start: name.start,
            end: constraint.end,
            modifiers: StoreSlice::EMPTY,
            name,
            constraint: Some(constraint),
            expression: None,
            default_type: None,
        };
        let mut name_type = None;
        if self.lexer.is_contextual_keyword(b"as") {
            self.lexer.next()?;
            name_type = Some(self.build_type_script_type(Level::Lowest)?);
        }
        let mut after = self.lexer.end as u32;
        self.lexer.expect(T::TCloseBracket)?;
        let mut question_token = None;
        if matches!(self.lexer.token, T::TQuestion | T::TPlus | T::TMinus) {
            let kind = match self.lexer.token {
                T::TQuestion => ts::TokenKind::Question,
                T::TPlus => ts::TokenKind::Plus,
                _ => ts::TokenKind::Minus,
            };
            question_token = Some(token_of(&self.lexer, kind));
            self.lexer.next()?;
            if kind != ts::TokenKind::Question {
                self.lexer.expect(T::TQuestion)?;
            }
            after = ts::full_start(
                self.lexer.contents,
                &self.lexer.all_comments,
                self.lexer.start as u32,
            );
        }
        let mut type_node = None;
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            let annotation = self.build_type_script_type(Level::Lowest)?;
            after = annotation.end;
            type_node = Some(annotation);
        }
        // parseSemicolon
        if self.lexer.token == T::TSemicolon {
            after = self.lexer.end as u32;
            self.lexer.next()?;
        } else if self.lexer.token != T::TCloseBrace && !self.lexer.has_newline_before {
            self.lexer.expected(T::TSemicolon)?;
            return Err(Error::SyntaxError);
        }
        let members = self.build_type_member_list(after)?;
        let end = self.lexer.end as u32;
        self.lexer.expect(T::TCloseBrace)?;
        let payload = ts::MappedType {
            readonly_token,
            type_parameter,
            name_type,
            question_token,
            type_node,
            members,
        };
        Ok(ts::Type::alloc(self.arena, payload, start, end))
    }

    /// parseImportType up to ")", at `import` or at the `typeof` before it: a qualifier and type arguments follow as for a reference.
    pub(crate) fn build_type_script_import_type(&mut self) -> Result<ts::Type, Error> {
        let start = self.lexer.start as u32;
        let is_type_of = self.lexer.token == T::TTypeof;
        if is_type_of {
            self.lexer.next()?;
        }
        self.lexer.expect(T::TImport)?;
        self.lexer.expect(T::TOpenParen)?;
        let argument = self.build_type_script_type(Level::Lowest)?;
        let mut attributes = None;
        if self.lexer.token == T::TComma {
            self.lexer.next()?;
            self.lexer.expect(T::TOpenBrace)?;
            let token = if self.lexer.token == T::TWith {
                ts::ImportAttributesToken::With
            } else if self.lexer.is_contextual_keyword(b"assert") {
                ts::ImportAttributesToken::Assert
            } else {
                self.lexer.expected(T::TWith)?;
                return Err(Error::SyntaxError);
            };
            self.lexer.next()?;
            self.lexer.expect(T::TColon)?;
            attributes = Some(self.build_import_attributes(token)?);
            if self.lexer.token == T::TComma {
                self.lexer.next()?;
            }
            self.lexer.expect(T::TCloseBrace)?;
        }
        let end = self.lexer.end as u32;
        self.lexer.expect(T::TCloseParen)?;
        let payload = ts::ImportType {
            is_type_of,
            argument,
            attributes,
            qualifier: None,
            type_arguments: None,
        };
        Ok(ts::Type::alloc(self.arena, payload, start, end))
    }

    /// parseImportAttributes, at "{".
    fn build_import_attributes(
        &mut self,
        token: ts::ImportAttributesToken,
    ) -> Result<StoreRef<ts::ImportAttributes>, Error> {
        let start = self.lexer.start as u32;
        let list_start = self.lexer.end as u32;
        self.lexer.expect(T::TOpenBrace)?;
        let multi_line = self.lexer.has_newline_before;
        let mut items = Vec::new();
        let mut list_end = list_start;
        while self.lexer.token != T::TCloseBrace {
            let attribute_start = self.lexer.start as u32;
            let name = if self.lexer.is_identifier_or_keyword() {
                ts::ImportAttributeName::Identifier(name_of(&self.lexer))
            } else if let Some(literal) = literal_of(&mut self.lexer)?
                .filter(|literal| matches!(literal.data, ts::LiteralData::String(_)))
            {
                ts::ImportAttributeName::String(literal)
            } else {
                self.lexer.expected(T::TIdentifier)?;
                return Err(Error::SyntaxError);
            };
            self.lexer.next()?;
            self.lexer.expect(T::TColon)?;
            let (value, end) = self.build_expr_in_type(Level::Comma)?;
            list_end = end;
            items.push(ts::ImportAttribute {
                start: attribute_start,
                end,
                name,
                value,
            });
            if self.lexer.token != T::TComma {
                break;
            }
            list_end = self.lexer.end as u32;
            self.lexer.next()?;
        }
        let end = self.lexer.end as u32;
        self.lexer.expect(T::TCloseBrace)?;
        let payload = ts::ImportAttributes {
            start,
            end,
            token,
            attributes: ts::List::from_slice(self.arena, &items, list_start, list_end),
            multi_line,
        };
        Ok(StoreRef::from_bump(self.arena.alloc(payload)))
    }
}
