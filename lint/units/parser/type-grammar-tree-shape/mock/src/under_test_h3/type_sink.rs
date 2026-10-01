use crate::Error;
use crate::lexer::Lexer;
use bun_ast::Ref;
use bun_ast::ts;
use bun_ast::ts::Metadata;
#[allow(unused_imports)]
use bun_ast::op::Level;

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

