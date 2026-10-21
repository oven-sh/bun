//! Functions, classes and other declarations, and their parts.

use super::{
    EntityName, Expr, File, Flags, FnKind, Ident, ImportAttributes, List, MemberKind, Name, Node,
    Pat, PropKind, Stmt, TypeNode, handle,
};
use crate::span::Span;
use crate::tokens::skip_trivia;
use bun_collections::ByteSet;
use bun_sema::bind::{ClassOwner, FnOwner, MemberOwner};
use bun_sema::hir::{self, NameKind};

// ───────────────────────────── functions ─────────────────────────────

handle! {
    /// Anything with parameters and a return type: a function declaration or expression, an arrow
    /// function, a method, an accessor, a constructor, a static block, a signature, a function
    /// type.
    ///
    /// It isn't a separate node in the source. It belongs to its [`Func::owner`], which is a `Stmt`, an `Expr`, a
    /// `Member` or a `TypeNode`.
    Func, FnId, fns, Func
}

#[derive(Copy, Clone, Debug)]
pub enum FnBody<'a> {
    /// An overload, an ambient or abstract declaration, a signature.
    None,
    Block(List<'a, Stmt<'a>>),
    /// An arrow function's expression body.
    Expr(Expr<'a>),
}

impl<'a> Func<'a> {
    #[inline]
    fn raw(self) -> &'a hir::Func {
        &self.file.hir.fns[self.id.idx()]
    }

    #[inline]
    pub fn kind(self) -> FnKind {
        self.raw().kind
    }

    /// `ASYNC`, `GENERATOR`, and the declaration's modifiers.
    #[inline]
    pub fn flags(self) -> Flags {
        match self.file.has_synthetic_nodes() {
            true => self.source_flags(),
            false => self.raw().flags,
        }
    }

    #[inline(never)]
    fn source_flags(self) -> Flags {
        match self.owner() {
            Node::Member(member) => self.file.source_flags(self.raw().flags, member.modifiers()),
            _ => self.raw().flags,
        }
    }

    #[inline]
    pub fn is_async(self) -> bool {
        self.flags().contains(Flags::ASYNC)
            || self.kind() == FnKind::Constructor && self.is_async_constructor()
    }

    /// The HIR doesn't flag the `async` in `static async constructor() {}`.
    #[inline(never)]
    fn is_async_constructor(self) -> bool {
        matches!(self.owner(), Node::Member(member)
            if member.modifiers().iter().any(|it| it.flag() == Flags::ASYNC))
    }

    #[inline]
    pub fn is_generator(self) -> bool {
        self.flags().contains(Flags::GENERATOR)
    }

    #[inline]
    pub fn is_arrow(self) -> bool {
        self.kind() == FnKind::Arrow
    }

    /// The name of a function declaration or expression. A method's name is its owner's [`Member::key`] or
    /// [`Prop::key`].
    #[inline]
    pub fn name(self) -> Option<Ident<'a>> {
        match self.kind() {
            FnKind::Decl | FnKind::Expr => self
                .file
                .ident_if_some(self.raw().name, self.raw().name_pos),
            _ => None,
        }
    }

    #[inline]
    pub fn type_params(self) -> List<'a, TypeParam<'a>> {
        List::run(self.file, self.raw().type_params)
    }

    /// Excludes the `this` parameter.
    #[inline]
    pub fn params(self) -> List<'a, Param<'a>> {
        List::run(self.file, self.raw().params)
    }

    /// `this: T`, which always comes first.
    #[inline]
    pub fn this_param(self) -> Option<Param<'a>> {
        Param::some(self.file, self.raw().this_param).filter(|p| !super::Handle::is_synthetic(*p))
    }

    #[inline]
    pub fn return_type(self) -> Option<TypeNode<'a>> {
        TypeNode::in_source(self.file, self.raw().ret)
    }

    #[inline]
    pub fn body(self) -> FnBody<'a> {
        match self.raw().body {
            hir::FnBody::None => FnBody::None,
            hir::FnBody::Block(statements) => FnBody::Block(List::ids(self.file, statements)),
            hir::FnBody::Expr(e) => FnBody::Expr(Expr::new(self.file, e)),
        }
    }

    #[inline]
    pub fn has_body(self) -> bool {
        !matches!(self.raw().body, hir::FnBody::None)
    }

    /// TypeScript's `NodeFlags.HasImplicitReturn` for a block body: the binder's flow reaches the end of the block.
    /// tsgolint's rules use this where ESLint's use [`Func::is_end_reachable`].
    #[inline]
    pub fn has_implicit_return(self) -> bool {
        let info = self.file.bound.fns.get(self.id.idx());
        info.is_some_and(|info| info.end != bun_sema::bind::UNREACHABLE)
    }

    /// The statements of a block body.
    #[inline]
    pub fn body_statements(self) -> Option<List<'a, Stmt<'a>>> {
        match self.body() {
            FnBody::Block(statements) => Some(statements),
            _ => None,
        }
    }

    /// The `{ .. }` of a block body.
    pub fn body_span(self) -> Option<Span> {
        if !matches!(self.raw().body, hir::FnBody::Block(_)) {
            return None;
        }
        let start = match self.kind() {
            FnKind::StaticBlock => self.raw().anchor,
            _ => {
                let starts = self.file.hir.body_starts;
                let at = starts.binary_search_by_key(&self.id.0, |it| it.0.0).ok()?;
                starts[at].1
            }
        };
        Some(Span::new(start, self.span().end))
    }

    /// The position of the parameter list's `(`. `None` for an arrow function, which may not have one.
    pub fn open_paren(self) -> Option<u32> {
        (!self.is_arrow() && self.kind() != FnKind::StaticBlock).then(|| self.raw().anchor)
    }

    /// The `=>` of an arrow function.
    #[inline]
    pub fn arrow_span(self) -> Option<Span> {
        let at = self.raw().anchor;
        self.is_arrow().then(|| Span::new(at, at + 2))
    }

    /// The node it belongs to.
    #[inline]
    pub fn owner(self) -> Node<'a> {
        let file = self.file;
        match file.bound.fns.get(self.id.idx()).map(|info| info.owner) {
            Some(FnOwner::Expr(e)) => Node::Expr(Expr::new(file, e)),
            Some(FnOwner::Stmt(s)) => Node::Stmt(Stmt::new(file, s)),
            Some(FnOwner::Member(m)) => Node::Member(Member::new(file, m)),
            Some(FnOwner::Type(t)) => Node::Type(TypeNode::new(file, t)),
            Some(FnOwner::None) | None => Node::File(file),
        }
    }

    /// The enclosing function.
    #[inline]
    pub fn enclosing(self) -> Option<Func<'a>> {
        Func::some(self.file, self.file.bound.fns.get(self.id.idx())?.enclosing)
    }

    /// From its first token, which can be a modifier or a decorator, to its end. A method's or accessor's span starts
    /// where the member starts. See also [`Func::span_from_params`].
    pub fn span(self) -> Span {
        let end = match self.owner() {
            Node::File(_) => self.raw().start,
            Node::Expr(e) => e.span().end,
            Node::Stmt(statement) => statement.span().end,
            Node::Member(member) => member.span().end,
            owner => owner.span().end,
        };
        Span::new(self.raw().start, end)
    }

    /// Starts at the type parameters or the `(`. For a method or an accessor, this is the range of ESLint's
    /// `FunctionExpression`, the `value` of the `MethodDefinition` or `Property`.
    pub fn span_from_params(self) -> Span {
        Span::new(self.start_of_params(), self.span().end)
    }

    /// The position of the type parameters' `<`, or of the `(` if there are none.
    pub(super) fn start_of_params(self) -> u32 {
        match self.type_params().first() {
            Some(first) => self
                .file
                .end_of_token_before(first.span().start)
                .saturating_sub(1),
            None => self.raw().anchor,
        }
    }

    /// The range of ESLint's node for it:
    /// - a `FunctionDeclaration` or a `TSDeclareFunction`: the statement without `export` and
    ///   `export default`,
    /// - a `FunctionExpression` or an `ArrowFunctionExpression`: the expression,
    /// - the `FunctionExpression` or `TSEmptyBodyFunctionExpression` that is the `value` of a
    ///   method, an accessor or a constructor: [`Func::span_from_params`],
    /// - a signature, a static block or a function type: the member or the type.
    pub fn estree_span(self) -> Span {
        match (self.owner(), self.kind()) {
            (Node::Stmt(statement), _) => statement.span_without_export(),
            (
                Node::Member(member),
                FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor,
            ) if !member.is_signature() => self.span_from_params(),
            (Node::Expr(_), FnKind::Method | FnKind::Getter | FnKind::Setter) => {
                self.span_from_params()
            }
            (Node::Expr(e), _) => e.span(),
            (owner, _) => owner.span(),
        }
    }

    /// Everything between the parentheses: the `this` parameter, if any, then the other parameters.
    #[inline]
    pub fn params_with_this(self) -> impl Iterator<Item = Param<'a>> + 'a {
        self.this_param().into_iter().chain(self.params())
    }

    /// The position of the parameter list's `)`. `None` for an arrow function without parentheses and for a static
    /// block.
    pub fn close_paren(self) -> Option<u32> {
        let text = self.file.text();
        let last = self.params().last().or_else(|| self.this_param());
        let mut at = match (last, self.open_paren()) {
            (Some(last), _) => skip_trivia(text, last.span().end),
            (None, Some(open)) => skip_trivia(text, open + 1),
            // `() => ..`, `<T>() => ..`, `async () => ..`
            (None, None) if self.is_arrow() => {
                let before = match self.return_type() {
                    Some(ty) => ty.annotation_span().start,
                    None => self.raw().anchor,
                };
                return Some(self.file.end_of_token_before(before).saturating_sub(1));
            }
            (None, None) => return None,
        };
        if text.get(at as usize) == Some(&b',') {
            at = skip_trivia(text, at + 1);
        }
        let close = if self.kind() == FnKind::IndexSignature {
            b']'
        } else {
            b')'
        };
        (text.get(at as usize) == Some(&close)).then_some(at)
    }

    /// The parameter list from `(` to `)`. For an arrow function without parentheses, the parameter. For an index
    /// signature, the brackets.
    pub fn params_span(self) -> Option<Span> {
        let Some(close) = self.close_paren() else {
            return self.params().first().map(Param::span);
        };
        let open = match self.open_paren() {
            Some(open) => open,
            None => {
                let first = self
                    .params_with_this()
                    .next()
                    .map_or(close, |first| first.span().start);
                self.file.end_of_token_before(first).saturating_sub(1)
            }
        };
        Some(Span::new(open, close + 1))
    }

    /// Its `return` statements, excluding those in nested functions.
    pub fn returns(self) -> impl Iterator<Item = Stmt<'a>> + 'a {
        let file = self.file;
        let list = (file.bound.fns.get(self.id.idx())).map_or(hir::IdList::EMPTY, |f| f.returns);
        let ids = file.bound.ids.get(list.range()).unwrap_or_default();
        ids.iter().map(move |&s| Stmt::new(file, hir::StmtId(s)))
    }

    /// Its `yield` expressions, excluding those in nested functions.
    pub fn yields(self) -> impl Iterator<Item = Expr<'a>> + 'a {
        let file = self.file;
        let list = (file.bound.fns.get(self.id.idx())).map_or(hir::IdList::EMPTY, |f| f.yields);
        let ids = file.bound.ids.get(list.range()).unwrap_or_default();
        ids.iter().map(move |&e| Expr::new(file, hir::ExprId(e)))
    }
}

handle! {
    /// `pat: ty = default`, `...pat`, `pat?`, `private pat`
    Param, ParamId, params, Param
}

impl<'a> Param<'a> {
    #[inline]
    fn raw(self) -> &'a hir::Param {
        &self.file.hir.params[self.id.idx()]
    }

    #[inline]
    pub fn pat(self) -> Pat<'a> {
        Pat::new(self.file, self.raw().pat)
    }

    #[inline]
    pub fn ty(self) -> Option<TypeNode<'a>> {
        TypeNode::in_source(self.file, self.raw().ty)
    }

    #[inline]
    pub fn default(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().default)
    }

    /// `REST`, `OPTIONAL`, `PARAMETER_PROPERTY`, and the modifiers.
    #[inline]
    pub fn flags(self) -> Flags {
        self.raw().flags
    }

    #[inline]
    pub fn is_rest(self) -> bool {
        self.flags().contains(Flags::REST)
    }

    #[inline]
    pub fn is_optional(self) -> bool {
        self.flags().contains(Flags::OPTIONAL) && !self.flags().contains(Flags::REPARSED)
    }

    /// `constructor(private x)`, which also declares a class property.
    #[inline]
    pub fn is_parameter_property(self) -> bool {
        self.flags().contains(Flags::PARAMETER_PROPERTY)
    }

    /// Keywords and decorators, in source order.
    #[inline]
    pub fn modifiers(self) -> List<'a, Modifier<'a>> {
        match self.file.hir.modifiers_of_params.get(self.id.idx()) {
            Some(&list) => List::run(self.file, list),
            None => List::empty(self.file),
        }
    }

    /// Starts at its first token, which can be a decorator, a modifier or the `...`.
    pub fn span(self) -> Span {
        let raw = self.raw();
        let end = match raw.loc.end {
            0 => [
                Some(self.pat().span().end),
                self.ty().map(|ty| ty.span().end),
                self.default().map(|e| e.outer_span().end),
            ]
            .into_iter()
            .flatten()
            .max()
            .unwrap_or(raw.pos),
            // The HIR's end is too early for a name written with an escape.
            end => end.max(self.pat().span().end),
        };
        Span::new(raw.pos, end)
    }

    pub fn decorators(self) -> impl Iterator<Item = Expr<'a>> + 'a {
        self.modifiers().iter().filter_map(Modifier::decorator)
    }

    /// The pattern, the `?` and the type annotation. This is the range of ESLint's `Identifier`, `ObjectPattern` or
    /// `ArrayPattern` for the parameter, because typescript-eslint includes the `?` and the annotation in that node.
    pub fn binding_span(self) -> Span {
        let pat = self.pat().span();
        let end = match self.ty() {
            Some(ty) => ty.outer_span().end,
            None if self.is_optional() => skip_trivia(self.file.text(), pat.end) + 1,
            None => pat.end,
        };
        Span::new(pat.start, end)
    }

    /// Excludes decorators and modifiers. This is the range of ESLint's node for the parameter, or of the `parameter`
    /// of a `TSParameterProperty`: the `AssignmentPattern` of `a = 1`, the `RestElement` of `...a`, otherwise
    /// [`Param::binding_span`].
    pub fn span_without_modifiers(self) -> Span {
        let whole = self.span();
        let start = match self.modifiers().last() {
            Some(last) => skip_trivia(self.file.text(), last.span().end),
            None => whole.start,
        };
        Span::new(start, whole.end)
    }

    #[inline]
    pub fn func(self) -> Option<Func<'a>> {
        Func::some(self.file, *self.file.bound.param_fn.get(self.id.idx())?)
    }
}

handle! {
    /// `const in out T extends C = D`
    TypeParam, TypeParamId, type_params, TypeParam
}

impl<'a> TypeParam<'a> {
    #[inline]
    fn raw(self) -> &'a hir::TypeParam {
        &self.file.hir.type_params[self.id.idx()]
    }

    #[inline]
    pub fn name(self) -> Ident<'a> {
        self.file.ident(self.raw().name, self.raw().pos)
    }

    #[inline]
    pub fn constraint(self) -> Option<TypeNode<'a>> {
        TypeNode::some(self.file, self.raw().constraint)
    }

    #[inline]
    pub fn default(self) -> Option<TypeNode<'a>> {
        TypeNode::some(self.file, self.raw().default)
    }

    /// `CONST`, `IN`, `OUT`
    #[inline]
    pub fn flags(self) -> Flags {
        self.raw().flags
    }

    #[inline]
    pub fn span(self) -> Span {
        Span::new(self.raw().start, self.raw().end)
    }

    /// The node that declares it: a `Func`, a `Class`, the `Stmt` of an interface or a type alias, or the `TypeNode` of
    /// an `infer` or a mapped type.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::TypeParam(self).parent()
    }
}

// ───────────────────────────── member names ─────────────────────────────

/// The name of a member of a class, an interface, a type literal, an object literal, an object
/// pattern or an enum.
#[derive(Copy, Clone, Debug)]
pub struct Key<'a> {
    kind: KeyKind<'a>,
    start: u32,
    /// True for a JSX attribute name.
    is_jsx: bool,
}

#[derive(Copy, Clone, Debug)]
pub enum KeyKind<'a> {
    /// `a`. In JSX also `a-b` and `a:b`.
    Ident(Name<'a>),
    /// `"a"`. The name is the string's value.
    String(Name<'a>),
    /// `0`, `1e3`, `0x10`, `1n`. The name is the number as `String(n)` formats it.
    Number(Name<'a>),
    /// `#a`. The name includes the `#`.
    Private(Name<'a>),
    /// `["a"]`, `` [`a`] ``. The name is the string's value.
    ComputedString(Name<'a>),
    /// `[0]`. The name is the number as `String(n)` formats it.
    ComputedNumber(Name<'a>),
    /// `[e]`, where `e` isn't a bare string or number.
    Computed(Expr<'a>),
}

impl<'a> KeyKind<'a> {
    /// For a `bigint` key the HIR stores no name, or in a binding pattern the literal's source text.
    #[inline(never)]
    fn from_bigint(file: &'a File<'a>, start: u32) -> Option<KeyKind<'a>> {
        let rest = file.text().get(start as usize..)?;
        let literal = rest.get(..crate::tokens::token_len(rest))?;
        (rest.first()?.is_ascii_digit() && literal.ends_with(b"n"))
            .then(|| KeyKind::Number(file.name(file.atoms.intern(&decimal_digits(literal)))))
    }

    /// The HIR also stores no name for a `#name` outside a class, since it declares nothing.
    #[inline(never)]
    fn from_unnamed(file: &'a File<'a>, start: u32) -> Option<KeyKind<'a>> {
        let rest = file.text().get(start as usize..)?;
        match rest.first()? {
            b'#' => Some(KeyKind::Private(
                file.intern(rest.get(..crate::tokens::token_len(rest))?),
            )),
            _ => KeyKind::from_bigint(file, start),
        }
    }
}

impl<'a> Key<'a> {
    #[inline]
    pub(crate) fn new(
        file: &'a File<'a>,
        key: hir::PropKey,
        name_kind: NameKind,
        start: u32,
    ) -> Option<Key<'a>> {
        match (key, name_kind, file.text().get(start as usize)) {
            (_, _, None | Some(b'"' | b'\'' | b'0'..=b'9')) => {
                Key::new_slow(file, key, name_kind, start)
            }
            (hir::PropKey::Name(name), NameKind::Identifier, _) => Some(Key {
                kind: KeyKind::Ident(file.name(name)),
                start,
                is_jsx: false,
            }),
            _ => Key::new_slow(file, key, name_kind, start),
        }
    }

    #[inline(never)]
    fn new_slow(
        file: &'a File<'a>,
        key: hir::PropKey,
        name_kind: NameKind,
        start: u32,
    ) -> Option<Key<'a>> {
        let bigint = || KeyKind::from_bigint(file, start);
        let kind = match key {
            hir::PropKey::None => KeyKind::from_unnamed(file, start)?,
            hir::PropKey::Private(name) => KeyKind::Private(file.private_name(name)),
            hir::PropKey::Computed(e) => KeyKind::Computed(Expr::new(file, e)),
            hir::PropKey::Name(name) => {
                let name = file.name(name);
                match name_kind {
                    // The HIR marks the string keys of `with { "type": "json" }` as identifiers.
                    NameKind::Identifier
                        if matches!(file.text().get(start as usize), Some(b'"' | b'\'')) =>
                    {
                        KeyKind::String(name)
                    }
                    NameKind::Identifier
                        if file
                            .text()
                            .get(start as usize)
                            .is_some_and(u8::is_ascii_digit) =>
                    {
                        bigint().unwrap_or(KeyKind::Ident(name))
                    }
                    NameKind::Identifier | NameKind::Jsx => KeyKind::Ident(name),
                    NameKind::StringLiteral => KeyKind::String(name),
                    NameKind::NumericLiteral => KeyKind::Number(name),
                    NameKind::ComputedString => KeyKind::ComputedString(name),
                    NameKind::ComputedNumber => KeyKind::ComputedNumber(name),
                }
            }
        };
        Some(Key {
            kind,
            start,
            is_jsx: name_kind == NameKind::Jsx,
        })
    }

    #[inline]
    pub fn kind(self) -> KeyKind<'a> {
        self.kind
    }

    /// True if it's written in brackets.
    #[inline]
    pub fn is_computed(self) -> bool {
        matches!(
            self.kind,
            KeyKind::Computed(_) | KeyKind::ComputedString(_) | KeyKind::ComputedNumber(_)
        )
    }

    #[inline]
    pub fn is_private(self) -> bool {
        matches!(self.kind, KeyKind::Private(_))
    }

    /// True for a JSX attribute name.
    #[inline]
    pub fn is_jsx(self) -> bool {
        self.is_jsx
    }

    /// The property's name, or `None` if finding it would take evaluating an expression. The name of `#a` includes the
    /// `#`.
    pub fn name(self) -> Option<Name<'a>> {
        match self.kind {
            KeyKind::Ident(name)
            | KeyKind::String(name)
            | KeyKind::Number(name)
            | KeyKind::Private(name)
            | KeyKind::ComputedString(name)
            | KeyKind::ComputedNumber(name) => Some(name),
            KeyKind::Computed(_) => None,
        }
    }

    /// True if the property is named `name`.
    #[inline]
    pub fn is(self, name: &str) -> bool {
        self.name().is_some_and(|it| it.is(name))
    }

    /// Fast path for a plain ASCII name, which most keys are.
    #[inline]
    fn span_of_ascii_name(self, file: &File<'a>) -> Option<Span> {
        match self.kind {
            KeyKind::Ident(_) if !self.is_jsx => {
                let len = ascii_name_len(file.text().get(self.start as usize..)?)?;
                Some(Span::new(self.start, self.start + len as u32))
            }
            _ => None,
        }
    }

    /// Excludes the brackets. This is the range of ESLint's `key`.
    #[inline]
    pub fn inner_span(self, file: &File<'a>) -> Span {
        match self.span_of_ascii_name(file) {
            Some(span) => span,
            None => self.inner_span_slow(file),
        }
    }

    #[inline(never)]
    fn inner_span_slow(self, file: &File<'a>) -> Span {
        let text = file.text();
        match self.kind {
            KeyKind::Computed(e) => e.span(),
            KeyKind::ComputedString(_) | KeyKind::ComputedNumber(_) => {
                let literal = skip_trivia(text, self.start + 1);
                let rest = text.get(literal as usize..).unwrap_or_default();
                Span::new(literal, literal + crate::tokens::token_len(rest) as u32)
            }
            _ => self.span_slow(file),
        }
    }

    /// Includes the brackets or quotes.
    #[inline]
    pub fn span(self, file: &File<'a>) -> Span {
        match self.span_of_ascii_name(file) {
            Some(span) => span,
            None => self.span_slow(file),
        }
    }

    #[inline(never)]
    fn span_slow(self, file: &File<'a>) -> Span {
        let text = file.text();
        let end = match self.kind {
            KeyKind::Computed(e) => skip_trivia(text, e.outer_span().end) + 1,
            KeyKind::ComputedString(_) | KeyKind::ComputedNumber(_) => {
                let literal = skip_trivia(text, self.start + 1);
                let rest = text.get(literal as usize..).unwrap_or_default();
                skip_trivia(text, literal + crate::tokens::token_len(rest) as u32) + 1
            }
            _ if self.is_jsx => {
                let end = jsx_identifier_end(text, self.start);
                let colon = skip_trivia(text, end);
                match text.get(colon as usize) {
                    Some(b':') => jsx_identifier_end(text, skip_trivia(text, colon + 1)),
                    _ => end,
                }
            }
            _ => {
                let rest = text.get(self.start as usize..).unwrap_or_default();
                self.start + crate::tokens::token_len(rest) as u32
            }
        };
        Span::new(self.start, end)
    }
}

/// [`Key::is_computed`] for the HIR's `key` and `name_kind`, without building a [`Key`].
#[inline]
pub(super) fn is_computed(key: hir::PropKey, name_kind: NameKind) -> bool {
    match key {
        hir::PropKey::Computed(_) => true,
        hir::PropKey::Name(_) => {
            matches!(
                name_kind,
                NameKind::ComputedString | NameKind::ComputedNumber
            )
        }
        hir::PropKey::None | hir::PropKey::Private(_) => false,
    }
}

/// The length of the identifier at the start of `text`, or `None` unless it and the byte after it are ASCII and not a
/// `\\`. Same answer as `token_len`, without checking for the other kinds of token.
#[inline]
fn ascii_name_len(text: &[u8]) -> Option<usize> {
    static PART: ByteSet = ByteSet::of(b"_$")
        .with_range(b'0', b'9')
        .with_range(b'A', b'Z')
        .with_range(b'a', b'z');
    let is_part = |b: &u8| PART.has(*b);
    if !text
        .first()
        .is_some_and(|b| is_part(b) && !b.is_ascii_digit())
    {
        return None;
    }
    let len = text.iter().take_while(|b| is_part(b)).count();
    match text.get(len) {
        Some(b'\\' | 0x80..) => None,
        _ => Some(len),
    }
}

/// The value of the `bigint` literal `raw` in decimal.
fn decimal_digits(raw: &[u8]) -> Vec<u8> {
    let digits = raw.strip_suffix(b"n").unwrap_or(raw);
    let (radix, digits) = match digits {
        [b'0', b'x' | b'X', rest @ ..] => (16, rest),
        [b'0', b'o' | b'O', rest @ ..] => (8, rest),
        [b'0', b'b' | b'B', rest @ ..] => (2, rest),
        _ => (10, digits),
    };
    // Least significant digit first.
    let mut decimal: Vec<u8> = vec![0];
    for digit in digits.iter().filter_map(|b| (*b as char).to_digit(radix)) {
        let mut carry = digit;
        for place in &mut decimal {
            let value = u32::from(*place) * radix + carry;
            *place = (value % 10) as u8;
            carry = value / 10;
        }
        while carry > 0 {
            decimal.push((carry % 10) as u8);
            carry /= 10;
        }
    }
    while decimal.len() > 1 && decimal.last() == Some(&0) {
        decimal.pop();
    }
    decimal.iter().rev().map(|digit| b'0' + digit).collect()
}

impl File<'_> {
    /// The `a` and `b` of the JSX name `a:b` starting at `start`, which are the `namespace` and `name` of ESLint's
    /// `JSXNamespacedName`. `None` if the name has no colon.
    pub fn jsx_namespace_and_name(&self, start: u32) -> Option<(Span, Span)> {
        let text = self.text();
        let namespace = Span::new(start, jsx_identifier_end(text, start));
        let colon = skip_trivia(text, namespace.end);
        if text.get(colon as usize) != Some(&b':') {
            return None;
        }
        let name = skip_trivia(text, colon + 1);
        Some((namespace, Span::new(name, jsx_identifier_end(text, name))))
    }
}

/// The end of the JSX identifier that starts at `at`. It can contain `-`.
fn jsx_identifier_end(text: &[u8], at: u32) -> u32 {
    let mut rest = text.get(at as usize..).unwrap_or_default();
    let mut end = at;
    // In oxc's lexer, an escape after a `-` ends the name.
    let mut is_past_dash = false;
    while let [b, after @ ..] = rest
        && !(*b == b'\\' && is_past_dash)
        && (b.is_ascii_alphanumeric()
            || matches!(b, b'_' | b'$' | b'-' | b'\\')
            || (*b >= 0x80 && bun_core::strings::js_whitespace_len(rest) == 0))
    {
        is_past_dash |= *b == b'-';
        // `\u{61}`. Only oxc accepts an escape here.
        let in_braces = match (b, after) {
            (b'\\', [b'u', b'{', ..]) => {
                bun_core::strings::index_of_char_usize(after, b'}').map_or(0, |it| it + 1)
            }
            _ => 0,
        };
        rest = &after[in_braces..];
        end += 1 + in_braces as u32;
    }
    end
}

// ───────────────────────────── classes ─────────────────────────────

handle! {
    /// A class declaration or expression. Like a [`Func`], it belongs to its [`Class::owner`].
    Class, ClassId, classes, Class
}

impl<'a> Class<'a> {
    #[inline]
    fn raw(self) -> &'a hir::Class {
        &self.file.hir.classes[self.id.idx()]
    }

    #[inline]
    pub fn name(self) -> Option<Ident<'a>> {
        self.file
            .ident_if_some(self.raw().name, self.raw().name_pos)
    }

    /// `ABSTRACT`, `AMBIENT`, `EXPORT`, `DEFAULT`
    #[inline]
    pub fn flags(self) -> Flags {
        self.raw().flags
    }

    #[inline]
    pub fn type_params(self) -> List<'a, TypeParam<'a>> {
        List::run(self.file, self.raw().type_params)
    }

    /// The `B` of `extends B<Args>`.
    #[inline]
    pub fn extends(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().extends)
    }

    /// The `Args` of `extends B<Args>`.
    #[inline]
    pub fn extends_args(self) -> List<'a, TypeNode<'a>> {
        List::ids(self.file, self.raw().extends_args)
    }

    #[inline]
    pub fn implements(self) -> List<'a, TypeNode<'a>> {
        List::ids(self.file, self.raw().implements)
    }

    #[inline]
    pub fn members(self) -> List<'a, Member<'a>> {
        List::run(self.file, self.raw().members)
    }

    /// Keywords and decorators, in source order.
    #[inline]
    pub fn modifiers(self) -> List<'a, Modifier<'a>> {
        List::run(self.file, self.raw().modifiers)
    }

    pub fn decorators(self) -> impl Iterator<Item = Expr<'a>> + 'a {
        self.modifiers().iter().filter_map(Modifier::decorator)
    }

    #[inline]
    pub(crate) fn start(self) -> u32 {
        self.raw().start
    }

    /// Its `Stmt` or `Expr`.
    #[inline]
    pub fn owner(self) -> Node<'a> {
        match self.file.bound.class_owner.get(self.id.idx()) {
            Some(&ClassOwner::Expr(e)) => Node::Expr(Expr::new(self.file, e)),
            Some(&ClassOwner::Stmt(s)) => Node::Stmt(Stmt::new(self.file, s)),
            None => Node::File(self.file),
        }
    }

    /// Starts at its first token, which can be a decorator or a modifier.
    pub fn span(self) -> Span {
        let end = match self.file.bound.class_owner.get(self.id.idx()) {
            Some(&ClassOwner::Expr(e)) => self.file.hir.exprs.get(e.idx()).map_or(0, |e| e.end),
            Some(&ClassOwner::Stmt(s)) => self.file.hir.stmts.get(s.idx()).map_or(0, |s| s.loc.end),
            None => 0,
        };
        Span::new(self.raw().start, end.max(self.raw().start))
    }

    /// The range of ESLint's `ClassDeclaration` or `ClassExpression`, which excludes `export`, `export default` and any
    /// decorators before them.
    pub fn estree_span(self) -> Span {
        match self.owner() {
            Node::Stmt(statement) => statement.span_without_export(),
            _ => self.span(),
        }
    }

    /// The `class` keyword.
    pub fn keyword_span(self) -> Span {
        let start = match self.modifiers().last() {
            Some(last) => skip_trivia(self.file.text(), last.span().end),
            None => self.raw().start,
        };
        Span::new(start, start + "class".len() as u32)
    }

    /// The `{ .. }` around the members.
    pub fn body_span(self) -> Span {
        // The last thing before the `{`.
        let head_end = (self.implements().last().map(|ty| ty.span().end))
            .or_else(|| self.flow_mixins().last().map(|ty| ty.span().end))
            .or_else(|| self.extends_args().angle_brackets_span().map(|it| it.end))
            .or_else(|| self.extends().map(|e| e.outer_span().end))
            .or_else(|| self.type_params().angle_brackets_span().map(|it| it.end))
            .or_else(|| self.name().map(|name| name.span().end))
            .unwrap_or_else(|| self.keyword_span().end);
        let text = self.file.text();
        let mut start = skip_trivia(text, head_end);
        // `class A extends B, {}`: TypeScript's parser accepts the comma and its checker reports it.
        if text.get(start as usize) == Some(&b',') {
            start = skip_trivia(text, start + 1);
        }
        Span::new(start, self.span().end)
    }
}

handle! {
    /// A member of a class, an interface or a type literal.
    Member, MemberId, members, Member
}

impl<'a> Member<'a> {
    #[inline]
    fn raw(self) -> &'a hir::Member {
        &self.file.hir.members[self.id.idx()]
    }

    /// `static constructor() {}` is also a `Constructor`, but ESLint treats it as a method. See
    /// [`Member::is_constructor`].
    #[inline]
    pub fn kind(self) -> MemberKind {
        self.raw().kind
    }

    /// ESLint's `kind === "constructor"`: a `Constructor` that isn't `static`, or a class method named with the string
    /// `"constructor"` that TypeScript's parser doesn't treat as the constructor, like `"constructor"<T>() {}` or
    /// `*"constructor"() {}`.
    pub fn is_constructor(self) -> bool {
        let raw = self.raw();
        if raw.flags.contains(Flags::STATIC) {
            return false;
        }
        match raw.kind {
            MemberKind::Constructor => true,
            MemberKind::Method => {
                raw.flags.contains(Flags::STRING_NAME)
                    && !raw.flags.contains(Flags::COMPUTED_NAME)
                    && !self.is_signature()
                    && self.key().is_some_and(|key| key.is("constructor"))
            }
            _ => false,
        }
    }

    /// `None` for a constructor, a static block and a signature without a name.
    pub fn key(self) -> Option<Key<'a>> {
        let raw = self.raw();
        if !matches!(
            raw.kind,
            MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter
        ) {
            return None;
        }
        let is_string = raw.flags.contains(Flags::STRING_NAME);
        let name_kind = match raw.flags.contains(Flags::COMPUTED_NAME) {
            true if is_string => NameKind::ComputedString,
            true => NameKind::ComputedNumber,
            false if is_string => NameKind::StringLiteral,
            false if raw.flags.contains(Flags::LITERAL_NAME) => NameKind::NumericLiteral,
            false => NameKind::Identifier,
        };
        Key::new(self.file, raw.key, name_kind, raw.name_pos)
    }

    /// The `e` of a [`KeyKind::Computed`] key.
    #[inline]
    pub fn computed_key(self) -> Option<Expr<'a>> {
        match self.raw() {
            &hir::Member {
                kind:
                    MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter,
                key: hir::PropKey::Computed(e),
                ..
            } => Some(Expr::new(self.file, e)),
            _ => None,
        }
    }

    /// `STATIC`, `READONLY`, `OPTIONAL`, `DEFINITE`, `ABSTRACT`, `OVERRIDE`, `ACCESSOR`,
    /// `AMBIENT`, `PUBLIC`, `PROTECTED`, `PRIVATE`
    #[inline]
    pub fn flags(self) -> Flags {
        match self.file.has_synthetic_nodes() {
            true => self.file.source_flags(self.raw().flags, self.modifiers()),
            false => self.raw().flags,
        }
    }

    #[inline]
    pub fn is_static(self) -> bool {
        self.flags().contains(Flags::STATIC)
    }

    /// True if it's in an interface or a type literal rather than a class.
    #[inline]
    pub fn is_signature(self) -> bool {
        matches!(
            self.file.bound.member_owner.get(self.id.idx()),
            Some(MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_))
        )
    }

    /// A constructor's `constructor` token, which is its `key` in ESLint. It can be written as a string.
    #[inline]
    pub fn constructor_keyword(self) -> Option<Ident<'a>> {
        let raw = self.raw();
        match (raw.kind, raw.key) {
            (MemberKind::Constructor, hir::PropKey::Name(name)) => {
                Some(self.file.ident(name, raw.name_pos))
            }
            _ => None,
        }
    }

    /// A property's type annotation.
    #[inline]
    pub fn ty(self) -> Option<TypeNode<'a>> {
        match self.raw().func.is_some() {
            true => None,
            false => TypeNode::in_source(self.file, self.raw().ty),
        }
    }

    /// A property's initializer.
    #[inline]
    pub fn init(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().init)
    }

    /// The function, for anything but a property.
    #[inline]
    pub fn func(self) -> Option<Func<'a>> {
        Func::some(self.file, self.raw().func)
    }

    /// Keywords and decorators, in source order.
    #[inline]
    pub fn modifiers(self) -> List<'a, Modifier<'a>> {
        List::run(self.file, self.raw().modifiers)
    }

    pub fn decorators(self) -> impl Iterator<Item = Expr<'a>> + 'a {
        self.modifiers().iter().filter_map(Modifier::decorator)
    }

    /// Starts at its first token, which can be a decorator or a modifier. Includes its `;` or `,`.
    #[inline]
    pub fn span(self) -> Span {
        Span::new(self.raw().start, self.raw().loc.end)
    }

    /// The `Class`, the `Stmt` of the interface, or the `TypeNode` of the type literal.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        match self.file.bound.member_owner.get(self.id.idx()) {
            Some(&MemberOwner::Class(class)) => Node::Class(Class::new(self.file, class)),
            Some(&MemberOwner::TypeLiteral(ty)) => Node::Type(TypeNode::new(self.file, ty)),
            _ => Node::Member(self).parent_of_other_node(),
        }
    }
}

handle! {
    /// A keyword before a declaration, or a decorator.
    Modifier, ModifierId, modifiers, Modifier
}

impl<'a> Modifier<'a> {
    #[inline]
    fn raw(self) -> &'a hir::Modifier {
        &self.file.hir.modifiers[self.id.idx()]
    }

    /// A keyword's flag. Empty for a decorator.
    #[inline]
    pub fn flag(self) -> Flags {
        self.raw().kind.flag()
    }

    /// The `e` of `@e`.
    #[inline]
    pub fn decorator(self) -> Option<Expr<'a>> {
        match self.raw().kind {
            hir::ModifierKind::Decorator(e) => Some(Expr::new(self.file, e)),
            hir::ModifierKind::Keyword(_) => None,
        }
    }

    pub fn span(self) -> Span {
        let start = self.raw().pos;
        match self.raw().kind {
            hir::ModifierKind::Decorator(e) => {
                Span::new(start, Expr::new(self.file, e).outer_span().end)
            }
            hir::ModifierKind::Keyword(flag) => {
                Span::new(start, start + hir::modifier_text(flag).len() as u32)
            }
        }
    }
}

// ───────────────────────────── object literals and JSX attributes ─────────────────────────────

handle! {
    /// A property of an object literal, or an attribute of a JSX element.
    Prop, PropId, props, Prop
}

impl<'a> Prop<'a> {
    #[inline]
    fn raw(self) -> &'a hir::Prop {
        &self.file.hir.props[self.id.idx()]
    }

    #[inline]
    pub fn kind(self) -> PropKind {
        self.raw().kind
    }

    /// `None` for a spread.
    pub fn key(self) -> Option<Key<'a>> {
        let raw = self.raw();
        if raw.kind == PropKind::Spread {
            return None;
        }
        Key::new(self.file, raw.key, raw.name_kind, raw.pos)
    }

    /// Same as [`Key::is_computed`] on its key.
    #[inline]
    pub fn has_computed_key(self) -> bool {
        let raw = self.raw();
        raw.kind != PropKind::Spread && is_computed(raw.key, raw.name_kind)
    }

    /// The `e` of a [`KeyKind::Computed`] key.
    #[inline]
    pub fn computed_key(self) -> Option<Expr<'a>> {
        match self.raw() {
            hir::Prop {
                kind: PropKind::Spread,
                ..
            } => None,
            &hir::Prop {
                key: hir::PropKey::Computed(e),
                ..
            } => Some(Expr::new(self.file, e)),
            _ => None,
        }
    }

    /// - `Init`: the value. `None` for a JSX attribute without one.
    /// - `Shorthand`: the identifier. In a destructuring assignment `{ a = 1 }` it's an `Assign` of the default to the
    ///   identifier.
    /// - `Spread`: the spread expression.
    /// - `Method`, `Getter`, `Setter`: an `ExprKind::Fn`.
    #[inline]
    pub fn value(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().value)
    }

    /// A method's or accessor's function.
    pub fn func(self) -> Option<Func<'a>> {
        match self.kind() {
            PropKind::Method | PropKind::Getter | PropKind::Setter => self.value()?.as_fn(),
            _ => None,
        }
    }

    /// `a?() {}`, which is an error.
    #[inline]
    pub fn is_optional(self) -> bool {
        let at = self.raw().postfix_token;
        at != 0 && self.file.text().get(at as usize) == Some(&b'?')
    }

    #[inline]
    pub fn is_jsx_attribute(self) -> bool {
        self.raw().name_kind == NameKind::Jsx
    }

    /// True for a `key: "value"` entry of the `with { .. }` after a module specifier or in an import type (see
    /// [`ImportAttributes::entries`]). The entry isn't a node in the tree, but its value is.
    #[inline]
    pub fn is_import_attribute(self) -> bool {
        self.file.is_import_attribute(self.id)
    }

    /// Keywords and decorators, in source order. Everything but a method's `async` is an error.
    pub fn modifiers(self) -> List<'a, Modifier<'a>> {
        let all = self.file.hir.modifiers_of_props;
        match all.binary_search_by_key(&self.id.0, |it| it.0.0) {
            Ok(at) => List::run(self.file, all[at].1),
            Err(_) => List::empty(self.file),
        }
    }

    /// Starts at its first token: `async`, `get`, `set`, `*`, `...`, or the name.
    pub fn span(self) -> Span {
        let raw = self.raw();
        let end = match raw.end {
            0 => self.value().map_or(raw.pos, |value| value.outer_span().end),
            end => end,
        };
        Span::new(raw.start, end)
    }

    /// The object literal or the JSX element. For an [import attribute](Prop::is_import_attribute),
    /// the `Stmt` of the import or the export, or the `TypeNode` of the import type.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        match self.file.bound.prop_owner.get(self.id.idx()) {
            Some(&owner) if owner.is_some() && self.file.hir.import_attributes.is_empty() => {
                Node::Expr(Expr::new(self.file, owner))
            }
            _ => Node::Prop(self).parent_of_other_node(),
        }
    }
}

// ───────────────────────────── type declarations ─────────────────────────────

/// Declares a handle for a declaration that the HIR stores in a side table, linked to its statement.
macro_rules! declaration {
    ($(#[$doc:meta])* $name:ident, $id:ident, $field:ident, $raw:ident) => {
        $(#[$doc])*
        #[derive(Copy, Clone)]
        pub struct $name<'a> {
            file: &'a File<'a>,
            id: hir::$id,
        }

        impl std::fmt::Debug for $name<'_> {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}({})", stringify!($name), self.id.0)
            }
        }

        impl PartialEq for $name<'_> {
            #[inline]
            fn eq(&self, other: &Self) -> bool {
                self.id == other.id
            }
        }
        impl Eq for $name<'_> {}

        impl<'a> $name<'a> {
            #[inline]
            pub(crate) fn new(file: &'a File<'a>, id: hir::$id) -> Self {
                $name { file, id }
            }

            #[inline]
            fn raw(self) -> &'a hir::$raw {
                &self.file.hir.$field[self.id.idx()]
            }

            #[inline]
            pub fn id(self) -> hir::$id {
                self.id
            }

            #[inline]
            pub fn stmt(self) -> Stmt<'a> {
                Stmt::new(self.file, self.raw().stmt)
            }

            #[inline]
            pub fn span(self) -> Span {
                self.stmt().span()
            }
        }
    };
}

declaration! {
    /// `interface I<T> extends A, B { .. }`
    Interface, InterfaceId, interfaces, Interface
}

impl<'a> Interface<'a> {
    #[inline]
    pub fn name(self) -> Ident<'a> {
        self.file.ident(self.raw().name, self.raw().name_pos)
    }

    #[inline]
    pub fn flags(self) -> Flags {
        self.raw().flags
    }

    #[inline]
    pub fn type_params(self) -> List<'a, TypeParam<'a>> {
        List::run(self.file, self.raw().type_params)
    }

    #[inline]
    pub fn extends(self) -> List<'a, TypeNode<'a>> {
        List::ids(self.file, self.raw().extends)
    }

    #[inline]
    pub fn members(self) -> List<'a, Member<'a>> {
        List::run(self.file, self.raw().members)
    }

    /// The `{ .. }` around the members.
    pub fn body_span(self) -> Span {
        let head_end = (self.extends().last().map(|ty| ty.span().end))
            .or_else(|| self.type_params().angle_brackets_span().map(|it| it.end))
            .unwrap_or_else(|| self.name().span().end);
        Span::new(skip_trivia(self.file.text(), head_end), self.span().end)
    }
}

declaration! {
    /// `type A<T> = ..`
    Alias, AliasId, aliases, Alias
}

impl<'a> Alias<'a> {
    #[inline]
    pub fn name(self) -> Ident<'a> {
        self.file.ident(self.raw().name, self.raw().name_pos)
    }

    #[inline]
    pub fn flags(self) -> Flags {
        self.raw().flags
    }

    #[inline]
    pub fn type_params(self) -> List<'a, TypeParam<'a>> {
        List::run(self.file, self.raw().type_params)
    }

    #[inline]
    pub fn ty(self) -> TypeNode<'a> {
        TypeNode::new(self.file, self.raw().ty)
    }
}

declaration! {
    /// `enum E { .. }`, `const enum E { .. }`
    Enum, EnumId, enums, Enum
}

impl<'a> Enum<'a> {
    #[inline]
    pub fn name(self) -> Ident<'a> {
        self.file.ident(self.raw().name, self.raw().name_pos)
    }

    /// `CONST`, `AMBIENT`, `EXPORT`
    #[inline]
    pub fn flags(self) -> Flags {
        self.raw().flags
    }

    #[inline]
    pub fn members(self) -> List<'a, EnumMember<'a>> {
        List::run(self.file, self.raw().members)
    }

    /// The `{ .. }` around the members.
    pub fn body_span(self) -> Span {
        Span::new(
            skip_trivia(self.file.text(), self.name().span().end),
            self.span().end,
        )
    }
}

handle! {
    /// `A = init`
    EnumMember, EnumMemberId, enum_members, EnumMember
}

impl<'a> EnumMember<'a> {
    #[inline]
    fn raw(self) -> &'a hir::EnumMember {
        &self.file.hir.enum_members[self.id.idx()]
    }

    pub fn key(self) -> Option<Key<'a>> {
        let raw = self.raw();
        let key = match raw.computed_name.is_some() {
            true => hir::PropKey::Computed(raw.computed_name),
            false => hir::PropKey::Name(raw.name),
        };
        Key::new(self.file, key, raw.name_kind, raw.pos)
    }

    /// The `e` of a [`KeyKind::Computed`] key.
    #[inline]
    pub fn computed_key(self) -> Option<Expr<'a>> {
        let name = self.raw().computed_name;
        name.is_some().then(|| Expr::new(self.file, name))
    }

    #[inline]
    pub fn init(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().init)
    }

    #[inline]
    pub fn span(self) -> Span {
        Span::new(self.raw().pos, self.raw().loc.end)
    }

    /// The `Stmt` of the enum.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::EnumMember(self).parent()
    }
}

declaration! {
    /// `namespace N { .. }`, `module N { .. }`, `declare module "m" { .. }`, `declare global { .. }`
    ///
    /// `namespace A.B { .. }` is stored as a namespace `A` whose only statement is `B { .. }` (see [`Module::nested`]).
    /// That statement isn't a node, because ESLint has a single `TSModuleDeclaration` whose `id` is a
    /// `TSQualifiedName`. So no listener is called with it, the statements between the braces have `A` as their parent,
    /// and [`Module::body`] returns them for both `A` and `B`.
    Module, ModuleId, modules, Module
}

#[derive(Copy, Clone, Debug)]
pub enum ModuleName<'a> {
    /// `namespace N`
    Ident(Ident<'a>),
    /// `declare module "m"`
    String(Ident<'a>),
    /// `declare global`
    Global,
}

impl<'a> Module<'a> {
    pub fn name(self) -> ModuleName<'a> {
        let pos = self.raw().name_pos;
        match self.raw().name {
            hir::ModuleName::Ident(name) => ModuleName::Ident(self.file.ident(name, pos)),
            hir::ModuleName::String(name) => ModuleName::String(self.file.ident(name, pos)),
            hir::ModuleName::Global => ModuleName::Global,
        }
    }

    /// The statements between the braces. It's the same list for the `A`, `B` and `C` of `namespace A.B.C { .. }`.
    #[inline]
    pub fn body(self) -> List<'a, Stmt<'a>> {
        self.innermost().stored_body()
    }

    /// For the `A` of `namespace A.B { .. }`, this is `B { .. }`.
    #[inline]
    fn stored_body(self) -> List<'a, Stmt<'a>> {
        List::ids(self.file, self.raw().body)
    }

    /// False for `declare module "m";`.
    #[inline]
    pub fn has_body(self) -> bool {
        self.raw().has_body
    }

    /// True if it's written with the `module` keyword instead of `namespace`.
    #[inline]
    pub fn uses_module_keyword(self) -> bool {
        self.raw().specifies_module
    }

    /// The span of the name. For `declare global`, the `global` keyword.
    pub fn name_span(self) -> Span {
        match self.name() {
            ModuleName::Ident(name) | ModuleName::String(name) => name.span(),
            ModuleName::Global => {
                let start = self.raw().name_pos;
                Span::new(start, start + "global".len() as u32)
            }
        }
    }

    /// The `{ .. }`. It's the same span for the `A`, `B` and `C` of `namespace A.B.C { .. }`.
    pub fn body_span(self) -> Option<Span> {
        let last = self.innermost();
        last.has_body().then(|| {
            Span::new(
                skip_trivia(self.file.text(), last.name_span().end),
                last.span().end,
            )
        })
    }

    /// The `C` of `namespace A.B.C { .. }`. Returns itself if its name has no dots.
    pub fn innermost(self) -> Module<'a> {
        let mut at = self;
        while let Some(nested) = at.nested() {
            at = nested;
        }
        at
    }

    /// The `A` of `namespace A.B.C { .. }`, which is the node. Returns itself if it's already the outermost.
    pub fn outermost(self) -> Module<'a> {
        let outer = match self.file.is_nested_namespace(self.raw().stmt) {
            true => self.stmt().parent().as_stmt().and_then(Stmt::as_module),
            false => None,
        };
        outer.unwrap_or(self)
    }

    /// The `B` of `namespace A.B`.
    pub fn nested(self) -> Option<Module<'a>> {
        let stored = self.stored_body();
        let only = stored.first().filter(|_| stored.len() == 1)?;
        match only.as_module() {
            Some(nested) if self.file.is_nested_namespace(only.id()) => Some(nested),
            _ => None,
        }
    }
}

// ───────────────────────────── imports and exports ─────────────────────────────

declaration! {
    /// `import default, * as namespace from "spec"`, `import default, { named } from "spec"`,
    /// `import "spec"`
    Import, ImportId, imports, Import
}

impl<'a> Import<'a> {
    /// The module specifier.
    #[inline]
    pub fn spec(self) -> Name<'a> {
        self.file.name(self.raw().spec)
    }

    #[inline]
    pub fn default(self) -> Option<Ident<'a>> {
        self.file
            .ident_if_some(self.raw().default, self.raw().default_pos)
    }

    #[inline]
    pub fn namespace(self) -> Option<Ident<'a>> {
        self.file
            .ident_if_some(self.raw().namespace, self.raw().namespace_pos)
    }

    /// `* as namespace`
    pub fn namespace_span(self) -> Option<Span> {
        let name = self.namespace()?;
        Some(Span::new(self.raw().namespace_start, name.span().end))
    }

    #[inline]
    pub fn named(self) -> List<'a, ImportSpec<'a>> {
        List::run(self.file, self.raw().named)
    }

    /// True if it has `{ }`, even if they're empty.
    #[inline]
    pub fn has_named_imports(self) -> bool {
        self.raw().has_named_imports
    }

    /// `import type ..`
    #[inline]
    pub fn is_type_only(self) -> bool {
        self.raw().type_only
    }

    /// `import defer ..`
    #[inline]
    pub fn is_deferred(self) -> bool {
        self.phase() == Some("defer")
    }

    /// `"defer"` for `import defer ..`, `"source"` for `import source ..`.
    pub fn phase(self) -> Option<&'static str> {
        let raw = self.raw();
        raw.is_deferred
            .then(|| self.file.phase_at(raw.clause_start))
    }

    /// `import "spec"`
    #[inline]
    pub fn is_side_effect(self) -> bool {
        let raw = self.raw();
        raw.default.is_none() && raw.namespace.is_none() && !raw.has_named_imports
    }

    /// The module specifier with its quotes.
    #[inline]
    pub fn spec_span(self) -> Option<Span> {
        self.stmt().module_specifier_span()
    }

    /// `with { type: "json" }`
    #[inline]
    pub fn attributes(self) -> Option<ImportAttributes<'a>> {
        self.stmt().import_attributes()
    }

    /// Everything between `import` and `from`.
    #[inline]
    pub fn clause_span(self) -> Span {
        Span::new(self.raw().clause_start, self.raw().clause_end)
    }
}

handle! {
    /// `imported as local`, `local`, `type local`
    ImportSpec, ImportSpecId, import_specs, ImportSpec
}

impl<'a> ImportSpec<'a> {
    #[inline]
    fn raw(self) -> &'a hir::ImportSpec {
        &self.file.hir.import_specs[self.id.idx()]
    }

    /// The name in the other module. It can be written as a string.
    #[inline]
    pub fn imported(self) -> Ident<'a> {
        self.file
            .ident(self.raw().imported, self.raw().imported_pos)
    }

    #[inline]
    pub fn local(self) -> Ident<'a> {
        self.file.ident(self.raw().local, self.raw().pos)
    }

    /// True if it has an `as`.
    #[inline]
    pub fn is_renamed(self) -> bool {
        self.raw().imported_pos != self.raw().pos
    }

    /// `{ type a }`
    #[inline]
    pub fn is_type_only(self) -> bool {
        self.raw().type_only
    }

    #[inline]
    pub fn import(self) -> Import<'a> {
        Import::new(self.file, self.raw().import)
    }

    #[inline]
    pub fn span(self) -> Span {
        Span::new(self.raw().start, self.raw().end)
    }
}

declaration! {
    /// `import name = require("spec")`, `import name = A.B.C`
    ImportEquals, ImportEqualsId, import_equals, ImportEquals
}

#[derive(Copy, Clone, Debug)]
pub enum ImportEqualsTarget<'a> {
    Require(Option<Name<'a>>),
    Entity(EntityName<'a>),
}

impl<'a> ImportEquals<'a> {
    #[inline]
    pub fn name(self) -> Ident<'a> {
        self.file.ident(self.raw().name, self.raw().name_pos)
    }

    pub fn target(self) -> ImportEqualsTarget<'a> {
        match self.raw().target {
            hir::ImportEqualsTarget::Require(spec) => {
                ImportEqualsTarget::Require(self.file.name_if_some(spec))
            }
            hir::ImportEqualsTarget::Entity(names) => {
                ImportEqualsTarget::Entity(EntityName::new(self.file, names))
            }
        }
    }

    /// `EXPORT`, `TYPE_ONLY`
    #[inline]
    pub fn flags(self) -> Flags {
        self.raw().flags
    }

    /// `require("spec")`, the range of ESLint's `TSExternalModuleReference`.
    pub fn require_span(self) -> Option<Span> {
        let spec = self.stmt().module_specifier_span()?;
        let text = self.file.text();
        let open = self.file.end_of_token_before(spec.start).saturating_sub(1);
        let keyword_end = self.file.end_of_token_before(open);
        Some(Span::new(
            keyword_end.saturating_sub("require".len() as u32),
            skip_trivia(text, spec.end) + 1,
        ))
    }
}

declaration! {
    /// `export { a as b }`, `export { a as b } from "spec"`
    Export, ExportId, exports, Export
}

impl<'a> Export<'a> {
    /// The module specifier after `from`.
    #[inline]
    pub fn spec(self) -> Option<Name<'a>> {
        self.file.name_if_some(self.raw().spec)
    }

    #[inline]
    pub fn has_from(self) -> bool {
        self.raw().has_module_specifier
    }

    #[inline]
    pub fn items(self) -> List<'a, ExportSpec<'a>> {
        List::run(self.file, self.raw().items)
    }

    /// `export type { .. }`
    #[inline]
    pub fn is_type_only(self) -> bool {
        self.raw().type_only
    }

    /// The module specifier with its quotes.
    #[inline]
    pub fn spec_span(self) -> Option<Span> {
        self.stmt().module_specifier_span()
    }

    /// `with { type: "json" }`
    #[inline]
    pub fn attributes(self) -> Option<ImportAttributes<'a>> {
        self.stmt().import_attributes()
    }
}

handle! {
    /// `local as exported`, `local`, `type local`
    ExportSpec, ExportSpecId, export_specs, ExportSpec
}

impl<'a> ExportSpec<'a> {
    #[inline]
    fn raw(self) -> &'a hir::ExportSpec {
        &self.file.hir.export_specs[self.id.idx()]
    }

    #[inline]
    pub fn local(self) -> Ident<'a> {
        self.file.ident(self.raw().local, self.raw().local_pos)
    }

    #[inline]
    pub fn exported(self) -> Ident<'a> {
        self.file.ident(self.raw().exported, self.raw().pos)
    }

    /// True if it has an `as`.
    #[inline]
    pub fn is_renamed(self) -> bool {
        self.raw().local_pos != self.raw().pos
    }

    /// `{ type a }`
    #[inline]
    pub fn is_type_only(self) -> bool {
        self.raw().type_only
    }

    #[inline]
    pub fn export(self) -> Export<'a> {
        Export::new(self.file, self.raw().export)
    }

    #[inline]
    pub fn span(self) -> Span {
        Span::new(self.raw().start, self.raw().end)
    }
}
