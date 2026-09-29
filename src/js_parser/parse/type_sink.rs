use bun_ast::Ref;
use bun_ast::op::Level;
use bun_ast::ts::Metadata;

/// What the type grammar keeps of the syntax it reads.
pub(crate) trait TypeSink {
    /// What one type leaves behind.
    type Out: Default;

    /// Binding level of the type after the ":" of a conditional type.
    const CONDITIONAL_FALSE_LEVEL: Level;

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

    const CONDITIONAL_FALSE_LEVEL: Level = Level::Lowest;

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

    const CONDITIONAL_FALSE_LEVEL: Level = Level::BitwiseAnd;

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
