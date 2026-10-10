//! Type syntax.

use super::stmt::tags;
use super::{
    Expr, File, Func, Ident, Keyword, List, MappedModifier, Member, Name, Node, Prop, TypeParam,
    handle,
};
use crate::span::Span;
use crate::tokens::skip_trivia;
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
    /// `unique T`, where `T` is not the keyword `symbol`, which is an error.
    Unique(TypeNode<'a>),
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

    #[inline]
    pub fn kind(self) -> TypeKind<'a> {
        match self.try_raw() {
            None => TypeKind::Error,
            Some(raw) if self.file.hides_casts => self.kind_without_casts(raw),
            Some(raw) => self.kind_of::<false>(raw),
        }
    }

    #[inline(never)]
    fn kind_without_casts(self, raw: &hir::TypeNode) -> TypeKind<'a> {
        self.kind_of::<true>(raw)
    }

    /// See `Expr::kind_of`.
    #[inline(always)]
    fn kind_of<const HIDES_CASTS: bool>(self, raw: &hir::TypeNode) -> TypeKind<'a> {
        let file = self.file;
        let t = |id| TypeNode::new(file, id);
        let e = |id| match HIDES_CASTS {
            true => Expr::new(file, id),
            false => Expr { file, id },
        };
        match raw.kind {
            hir::TypeNodeKind::Error | hir::TypeNodeKind::JSDoc { .. } => TypeKind::Error,
            hir::TypeNodeKind::Heritage { expr, args } => TypeKind::Heritage {
                expr: e(expr),
                args: List::ids(file, args),
            },
            hir::TypeNodeKind::Keyword(keyword) => TypeKind::Keyword(keyword),
            hir::TypeNodeKind::Ref { name, args } => TypeKind::Ref {
                name: EntityName { file, names: name },
                args: List::ids(file, args),
            },
            hir::TypeNodeKind::StringLit(text) => TypeKind::StringLit(file.name(text)),
            hir::TypeNodeKind::NumberLit(at) => TypeKind::NumberLit(
                file.hir
                    .numbers
                    .get(at as usize)
                    .copied()
                    .unwrap_or(f64::NAN),
            ),
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
            hir::TypeNodeKind::Unique(operand) => TypeKind::Unique(t(operand)),
            hir::TypeNodeKind::Typeof { args, expr, .. } => TypeKind::Typeof {
                expr: e(expr),
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
        (self.try_raw()).map_or_else(Span::default, |raw| Span::new(raw.pos, raw.end))
    }

    /// With all the parentheses around it. The HIR does not record them: they are found in the
    /// text next to the type.
    pub fn outer_span(self) -> Span {
        let text = self.file.text();
        let mut span = self.span();
        loop {
            let before = self.file.end_of_token_before(span.start) as usize;
            if before == 0 || text.get(before - 1) != Some(&b'(') {
                return span;
            }
            let after = skip_trivia(text, span.end);
            if text.get(after as usize) != Some(&b')') {
                return span;
            }
            span = Span::new(before as u32 - 1, after + 1);
        }
    }

    #[inline]
    pub fn is_parenthesized(self) -> bool {
        self.outer_span() != self.span()
    }

    /// The range of ESLint's `TSTypeAnnotation` around it, if it is the type of a variable, a
    /// parameter or a property, or a return type: from the `:`, or the `=>` of a function type,
    /// to the end of the type and its parentheses.
    pub fn annotation_span(self) -> Span {
        let (text, outer) = (self.file.text(), self.outer_span());
        let before = self.file.end_of_token_before(outer.start);
        let is_arrow = text
            .get(..before as usize)
            .is_some_and(|it| it.ends_with(b"=>"));
        Span::new(
            before.saturating_sub(if is_arrow { 2 } else { 1 }),
            outer.end,
        )
    }

    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::Type(self).parent()
    }

    #[inline]
    pub fn is_keyword(self, keyword: Keyword) -> bool {
        matches!(self.kind(), TypeKind::Keyword(it) if it == keyword)
    }

    /// The pieces of a `Template`.
    pub fn as_template(self) -> Option<TypeTemplate<'a>> {
        match self.try_raw()?.kind {
            hir::TypeNodeKind::Template { types, texts } => Some(TypeTemplate {
                ty: self,
                types,
                texts,
            }),
            _ => None,
        }
    }

    /// The `x` of the `Predicate` `x is T` or `asserts x`, where it is written. It can be `this`.
    pub fn predicate_param(self) -> Option<Ident<'a>> {
        let hir::TypeNodeKind::Predicate { param, asserts, .. } = self.try_raw()?.kind else {
            return None;
        };
        let start = self.span().start;
        let at = match asserts {
            true => skip_trivia(self.file.text(), start + "asserts".len() as u32),
            false => start,
        };
        Some(self.file.ident(param, at))
    }

    /// The `symbol` of `unique symbol`.
    pub fn unique_symbol_keyword_span(self) -> Option<Span> {
        let end = self.span().end;
        (self.tag() == TypeTag::UniqueSymbol).then(|| Span::new(end.saturating_sub(6), end))
    }

    /// Of an `Import`: from the `import`, without a `typeof` before it. ESLint has
    /// `typeof import("m")` as a `TSTypeQuery` of a `TSImportType` with this range.
    pub fn import_span(self) -> Option<Span> {
        let hir::TypeNodeKind::Import { is_typeof, .. } = self.try_raw()?.kind else {
            return None;
        };
        let whole = self.span();
        Some(match is_typeof {
            true => Span::new(
                skip_trivia(self.file.text(), whole.start + "typeof".len() as u32),
                whole.end,
            ),
            false => whole,
        })
    }

    /// Of an `Import`: the module specifier with its quotes.
    pub fn import_source_span(self) -> Option<Span> {
        let text = self.file.text();
        let open = skip_trivia(text, self.import_span()?.start + "import".len() as u32);
        let start = skip_trivia(text, open + 1);
        let rest = text.get(start as usize..).unwrap_or_default();
        Some(Span::new(
            start,
            start + crate::tokens::token_len(rest) as u32,
        ))
    }

    /// Of an `Import`: the `with: { .. }` of `import("m", { with: { .. } })`.
    pub fn import_attributes(self) -> Option<ImportAttributes<'a>> {
        let hir::TypeNodeKind::Import { attributes, .. } = self.try_raw()?.kind else {
            return None;
        };
        if attributes == hir::ImportAttributesToken::None {
            return None;
        }
        ImportAttributes::within(self.file, self.span())
    }
}

/// `` `text${T}text` `` in a type.
#[derive(Copy, Clone, Debug)]
pub struct TypeTemplate<'a> {
    ty: TypeNode<'a>,
    types: hir::IdList<hir::TypeNodeId>,
    texts: hir::IdList<bun_sema::atom::Atom>,
}

impl<'a> TypeTemplate<'a> {
    /// The substitutions.
    #[inline]
    pub fn types(self) -> List<'a, TypeNode<'a>> {
        List::ids(self.ty.file, self.types)
    }

    /// The number of pieces of text: one more than there are substitutions.
    #[inline]
    pub fn quasi_count(self) -> usize {
        self.types.len() + 1
    }

    /// The value of the piece of text at `i`.
    pub fn cooked(self, i: usize) -> Option<Name<'a>> {
        let file = self.ty.file;
        if i >= self.texts.len() {
            return None;
        }
        let at = self.texts.start as usize + i;
        file.name_if_some(bun_sema::atom::Atom(*file.hir.ids.get(at)?))
    }

    /// The piece of text at `i` with its delimiters: `` `a${ ``, `}b${`, `` }c` ``.
    pub fn quasi_span(self, i: usize) -> Span {
        let (text, whole) = (self.ty.file.text(), self.ty.span());
        let start = match i.checked_sub(1).and_then(|before| self.types().get(before)) {
            Some(before) => skip_trivia(text, before.outer_span().end),
            None => whole.start,
        };
        let end = match i < self.types.len() {
            true => super::expr::template_text_end(text, start + 1),
            false => whole.end,
        };
        Span::new(start, end)
    }

    /// The piece of text at `i` as it is written, without its delimiters.
    #[inline]
    pub fn raw(self, i: usize) -> &'a [u8] {
        let is_last = i + 1 == self.quasi_count();
        let span = self.quasi_span(i).shrink(1, if is_last { 1 } else { 2 });
        self.ty.file.slice(span)
    }
}

impl<'a> List<'a, TypeNode<'a>> {
    /// The `<..>` around type arguments: the range of ESLint's `TSTypeParameterInstantiation`.
    /// `None` if the list is empty.
    pub fn angle_brackets_span(self) -> Option<Span> {
        let (first, last) = (self.first()?, self.last()?);
        Some(angle_brackets(
            first.file,
            first.outer_span().start,
            last.outer_span().end,
        ))
    }
}

impl<'a> List<'a, TypeParam<'a>> {
    /// The `<..>` around type parameters: the range of ESLint's `TSTypeParameterDeclaration`.
    /// `None` if the list is empty.
    pub fn angle_brackets_span(self) -> Option<Span> {
        let (first, last) = (self.first()?, self.last()?);
        Some(angle_brackets(
            first.file(),
            first.span().start,
            last.span().end,
        ))
    }
}

/// From the `<` before `start` to the `>` after `end`, which a `,` may precede.
fn angle_brackets<'a>(file: &'a File<'a>, start: u32, end: u32) -> Span {
    let text = file.text();
    let mut close = skip_trivia(text, end);
    if text.get(close as usize) == Some(&b',') {
        close = skip_trivia(text, close + 1);
    }
    Span::new(file.end_of_token_before(start).saturating_sub(1), close + 1)
}

/// `with { type: "json" }` after the module specifier of an import or an export, and the
/// `with: { .. }` in the second argument of an import type.
#[derive(Copy, Clone, Debug)]
pub struct ImportAttributes<'a> {
    keyword: u32,
    object: Expr<'a>,
}

impl<'a> ImportAttributes<'a> {
    /// The first that start in `span`.
    pub(crate) fn within(file: &'a File<'a>, span: Span) -> Option<Self> {
        let all = file.hir.import_attributes;
        let &(keyword, object) = all.get(all.partition_point(|it| it.0 < span.start))?;
        (keyword < span.end).then(|| ImportAttributes {
            keyword,
            object: Expr::new(file, object),
        })
    }

    /// `with`, or the deprecated `assert`.
    pub fn keyword_span(self) -> Span {
        let rest = self
            .object
            .file()
            .text()
            .get(self.keyword as usize..)
            .unwrap_or_default();
        Span::new(
            self.keyword,
            self.keyword + crate::tokens::token_len(rest) as u32,
        )
    }

    /// The `{ .. }`.
    #[inline]
    pub fn braces_span(self) -> Span {
        self.object.span()
    }

    /// In an import type: the `{ with: { .. } }` that is the second argument.
    pub fn options_span(self) -> Span {
        let text = self.object.file().text();
        let mut close = skip_trivia(text, self.object.span().end);
        if text.get(close as usize) == Some(&b',') {
            close = skip_trivia(text, close + 1);
        }
        Span::new(
            self.object
                .file()
                .end_of_token_before(self.keyword)
                .saturating_sub(1),
            close + 1,
        )
    }

    /// `key: "value"`. The key is a name or a string.
    pub fn entries(self) -> List<'a, Prop<'a>> {
        match self.object.kind() {
            super::ExprKind::Object(entries) => entries,
            _ => List::empty(self.object.file()),
        }
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
        names
            .iter()
            .map(move |name| file.ident(name.text, name.pos()))
    }

    /// The file, and what the HIR calls the names between the dots.
    #[inline]
    pub(crate) fn ids(self) -> (&'a File<'a>, impl Iterator<Item = hir::NameId>) {
        (self.file, self.names.iter())
    }

    /// The name at `i`, counted from the left.
    #[inline]
    pub fn get(self, i: usize) -> Option<Ident<'a>> {
        let name = (i < self.names.len())
            .then(|| self.file.hir.names.get(self.names.start as usize + i))??;
        Some(self.file.ident(name.text, name.pos()))
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
    #[inline]
    pub fn is(self, name: &str) -> bool {
        self.as_ident().is_some_and(|it| it.name().is(name))
    }

    pub fn span(self) -> Span {
        match (self.first(), self.last()) {
            (Some(first), Some(last)) => first.span().to(last.span()),
            _ => Span::default(),
        }
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
