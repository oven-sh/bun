//! Type syntax.

use super::stmt::tags;
use super::{
    Expr, File, Func, Ident, Keyword, List, MappedModifier, Member, Name, Node, TypeParam, handle,
};
use crate::span::Span;
use bun_sema::hir;

handle! {
    /// A type as it is written. Parentheses around it are not part of it.
    TypeNode, TypeNodeId, types, TypeNode
}

#[derive(Copy, Clone, Debug)]
pub enum TypeKind<'a> {
    /// Syntax the parser failed on.
    Error,
    /// An element of `extends` or `implements` that is not a name, which is an error:
    /// `extends f()<Args>`.
    Heritage {
        expr: Expr<'a>,
        args: List<'a, TypeNode<'a>>,
    },
    Keyword(Keyword),
    /// `A.B.C<Args>`
    Ref {
        name: EntityName<'a>,
        args: List<'a, TypeNode<'a>>,
    },
    StringLit(Name<'a>),
    NumberLit(f64),
    BigIntLit {
        text: Name<'a>,
        negative: bool,
    },
    BoolLit(bool),
    /// `` `a${T}b` ``
    Template(List<'a, TypeNode<'a>>),
    /// `T[]`
    Array(TypeNode<'a>),
    Tuple(List<'a, TupleElem<'a>>),
    Union(List<'a, TypeNode<'a>>),
    Intersection(List<'a, TypeNode<'a>>),
    /// `(a: A) => R`, `new (a: A) => R`
    Fn(Func<'a>),
    /// `{ a: A }`
    Object(List<'a, Member<'a>>),
    Cond {
        check: TypeNode<'a>,
        extends: TypeNode<'a>,
        yes: TypeNode<'a>,
        no: TypeNode<'a>,
    },
    Infer(TypeParam<'a>),
    Mapped(Mapped<'a>),
    /// `obj[index]`
    IndexedAccess {
        obj: TypeNode<'a>,
        index: TypeNode<'a>,
    },
    Keyof(TypeNode<'a>),
    Readonly(TypeNode<'a>),
    UniqueSymbol,
    /// `typeof a.b.c<Args>`. `expr` is the name as an expression.
    Typeof {
        expr: Expr<'a>,
        args: List<'a, TypeNode<'a>>,
    },
    /// `import("spec").A.B<Args>`, `typeof import("spec")`
    Import {
        spec: Option<Name<'a>>,
        name: EntityName<'a>,
        args: List<'a, TypeNode<'a>>,
        is_typeof: bool,
    },
    /// `x is T`, `asserts x`, `asserts x is T`, `this is T`
    Predicate {
        param: Name<'a>,
        ty: Option<TypeNode<'a>>,
        asserts: bool,
    },
}

tags! {
    /// The kind of a type without what it holds. This is what a rule listens for.
    TypeTag of TypeNodeKind {
        Error unit,
        Heritage fields,
        Keyword tuple,
        Ref fields,
        StringLit tuple,
        NumberLit tuple,
        BigIntLit fields,
        BoolLit tuple,
        Template fields,
        Array tuple,
        Tuple tuple,
        Union tuple,
        Intersection tuple,
        Fn tuple,
        Object tuple,
        Cond fields,
        Infer tuple,
        Mapped tuple,
        IndexedAccess fields,
        Keyof tuple,
        Readonly tuple,
        UniqueSymbol unit,
        Unique tuple,
        JSDoc fields,
        Typeof fields,
        Import fields,
        Predicate fields,
    }
}

impl<'a> TypeNode<'a> {
    /// `None` if the HIR leaves `id` empty, or if the type is from a JSDoc comment.
    #[inline]
    pub(crate) fn written(file: &'a File<'a>, id: hir::TypeNodeId) -> Option<Self> {
        TypeNode::some(file, id).filter(|ty| !super::Handle::is_synthetic(*ty))
    }

    pub fn kind(self) -> TypeKind<'a> {
        let file = self.file;
        let t = |id| TypeNode::new(file, id);
        let Some(raw) = self.try_raw() else {
            return TypeKind::Error;
        };
        match raw.kind {
            hir::TypeNodeKind::Error
            | hir::TypeNodeKind::Unique(_)
            | hir::TypeNodeKind::JSDoc { .. } => TypeKind::Error,
            hir::TypeNodeKind::Heritage { expr, args } => TypeKind::Heritage {
                expr: Expr::new(file, expr),
                args: List::ids(file, args),
            },
            hir::TypeNodeKind::Keyword(keyword) => TypeKind::Keyword(keyword),
            hir::TypeNodeKind::Ref { name, args } => TypeKind::Ref {
                name: EntityName { file, names: name },
                args: List::ids(file, args),
            },
            hir::TypeNodeKind::StringLit(text) => TypeKind::StringLit(file.name(text)),
            hir::TypeNodeKind::NumberLit(at) => {
                TypeKind::NumberLit(file.hir.numbers.get(at as usize).copied().unwrap_or(f64::NAN))
            }
            hir::TypeNodeKind::BigIntLit { text, negative } => TypeKind::BigIntLit {
                text: file.name(text),
                negative,
            },
            hir::TypeNodeKind::BoolLit(value) => TypeKind::BoolLit(value),
            hir::TypeNodeKind::Template { types, .. } => TypeKind::Template(List::ids(file, types)),
            hir::TypeNodeKind::Array(element) => TypeKind::Array(t(element)),
            hir::TypeNodeKind::Tuple(elements) => TypeKind::Tuple(List::run(file, elements)),
            hir::TypeNodeKind::Union(types) => TypeKind::Union(List::ids(file, types)),
            hir::TypeNodeKind::Intersection(types) => {
                TypeKind::Intersection(List::ids(file, types))
            }
            hir::TypeNodeKind::Fn(f) => TypeKind::Fn(Func::new(file, f)),
            hir::TypeNodeKind::Object(members) => TypeKind::Object(List::run(file, members)),
            hir::TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => TypeKind::Cond {
                check: t(check),
                extends: t(extends),
                yes: t(yes),
                no: t(no),
            },
            hir::TypeNodeKind::Infer(param) => TypeKind::Infer(TypeParam::new(file, param)),
            hir::TypeNodeKind::Mapped(id) => TypeKind::Mapped(Mapped { file, id }),
            hir::TypeNodeKind::IndexedAccess { obj, index } => TypeKind::IndexedAccess {
                obj: t(obj),
                index: t(index),
            },
            hir::TypeNodeKind::Keyof(operand) => TypeKind::Keyof(t(operand)),
            hir::TypeNodeKind::Readonly(operand) => TypeKind::Readonly(t(operand)),
            hir::TypeNodeKind::UniqueSymbol => TypeKind::UniqueSymbol,
            hir::TypeNodeKind::Typeof { args, expr, .. } => TypeKind::Typeof {
                expr: Expr::new(file, expr),
                args: List::ids(file, args),
            },
            hir::TypeNodeKind::Import {
                spec,
                name,
                args,
                is_typeof,
                ..
            } => TypeKind::Import {
                spec: file.name_if_some(spec),
                name: EntityName { file, names: name },
                args: List::ids(file, args),
                is_typeof,
            },
            hir::TypeNodeKind::Predicate { param, ty, asserts } => TypeKind::Predicate {
                param: file.name(param),
                ty: TypeNode::some(file, ty),
                asserts,
            },
        }
    }

    #[inline]
    pub fn tag(self) -> TypeTag {
        (self.try_raw()).map_or(TypeTag::Error, |raw| TypeTag::of(&raw.kind))
    }

    /// Without the parentheses around it.
    #[inline]
    pub fn span(self) -> Span {
        (self.try_raw()).map_or(Span::default(), |raw| Span::new(raw.pos, raw.end))
    }

    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::Type(self).parent()
    }

    #[inline]
    pub fn is_keyword(self, keyword: Keyword) -> bool {
        matches!(self.kind(), TypeKind::Keyword(it) if it == keyword)
    }
}

/// `A`, `A.B.C`: a name in a type that is not an expression.
#[derive(Copy, Clone)]
pub struct EntityName<'a> {
    file: &'a File<'a>,
    names: hir::Span<hir::NameId>,
}

impl std::fmt::Debug for EntityName<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.parts()).finish()
    }
}

impl<'a> EntityName<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, names: hir::Span<hir::NameId>) -> Self {
        EntityName { file, names }
    }

    /// The names between the dots.
    pub fn parts(self) -> impl DoubleEndedIterator<Item = Ident<'a>> + ExactSizeIterator + 'a {
        let file = self.file;
        let names = file.hir.names.get(self.names.range()).unwrap_or_default();
        names.iter().map(move |name| file.ident(name.text, name.pos()))
    }

    #[inline]
    pub fn len(self) -> usize {
        self.names.len()
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.names.is_empty()
    }

    /// The `A` of `A.B.C`, which is what is looked up in the scope.
    #[inline]
    pub fn first(self) -> Option<Ident<'a>> {
        self.parts().next()
    }

    #[inline]
    pub fn last(self) -> Option<Ident<'a>> {
        self.parts().next_back()
    }

    /// The name, if there are no dots.
    pub fn as_ident(self) -> Option<Ident<'a>> {
        (self.len() == 1).then(|| self.first()).flatten()
    }

    /// Whether it is the single name `name`.
    pub fn is(self, name: &str) -> bool {
        self.as_ident().is_some_and(|it| it.name().is(name))
    }

    pub fn span(self) -> Span {
        match (self.first(), self.last()) {
            (Some(first), Some(last)) => first.span().to(last.span()),
            _ => Span::default(),
        }
    }

    /// The first of the HIR nodes of the names.
    #[inline]
    pub(crate) fn first_id(self) -> hir::NameId {
        hir::NameId(self.names.start)
    }
}

handle! {
    /// `T`, `T?`, `...T`, `name: T`, `name?: T`, `...name: T` in a tuple type.
    TupleElem, TupleElemId, tuple_elems, TupleElem
}

impl<'a> TupleElem<'a> {
    #[inline]
    fn raw(self) -> &'a hir::TupleElem {
        &self.file.hir.tuple_elems[self.id.idx()]
    }

    /// The `T`.
    #[inline]
    pub fn ty(self) -> TypeNode<'a> {
        TypeNode::new(self.file, self.raw().written)
    }

    pub fn name(self) -> Option<Ident<'a>> {
        let raw = self.raw();
        let start = match raw.has_dots {
            true => crate::tokens::skip_trivia(self.file.text(), raw.start + 3),
            false => raw.start,
        };
        self.file.ident_if_some(raw.name, start)
    }

    #[inline]
    pub fn is_optional(self) -> bool {
        self.raw().optional
    }

    #[inline]
    pub fn is_rest(self) -> bool {
        self.raw().has_dots
    }

    #[inline]
    pub fn span(self) -> Span {
        Span::new(self.raw().start, self.raw().end)
    }

    /// The tuple type.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::TupleElem(self).parent()
    }
}

/// `{ readonly [K in C as N]?: T }`
#[derive(Copy, Clone)]
pub struct Mapped<'a> {
    file: &'a File<'a>,
    id: hir::MappedId,
}

impl std::fmt::Debug for Mapped<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Mapped({})", self.id.0)
    }
}

impl<'a> Mapped<'a> {
    #[inline]
    fn raw(self) -> &'a hir::Mapped {
        &self.file.hir.mapped[self.id.idx()]
    }

    /// The `K in C`: `C` is its constraint.
    #[inline]
    pub fn param(self) -> TypeParam<'a> {
        TypeParam::new(self.file, self.raw().param)
    }

    /// The `N`.
    #[inline]
    pub fn name_type(self) -> Option<TypeNode<'a>> {
        TypeNode::some(self.file, self.raw().name_ty)
    }

    /// The `T`.
    #[inline]
    pub fn ty(self) -> Option<TypeNode<'a>> {
        TypeNode::some(self.file, self.raw().ty)
    }

    #[inline]
    pub fn readonly(self) -> MappedModifier {
        self.raw().readonly
    }

    #[inline]
    pub fn optional(self) -> MappedModifier {
        self.raw().optional
    }

    /// `+readonly`, as opposed to `readonly`.
    #[inline]
    pub fn is_readonly_with_plus(self) -> bool {
        self.raw().is_readonly_with_plus
    }

    /// `+?`, as opposed to `?`.
    #[inline]
    pub fn is_optional_with_plus(self) -> bool {
        self.raw().is_optional_with_plus
    }
}
