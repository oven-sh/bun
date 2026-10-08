//! Functions, classes and the other declarations, and what they consist of.

use super::{
    EntityName, Expr, File, Flags, FnKind, Ident, ImportAttributes, List, MemberKind, Name, Node,
    Pat, PropKind, Stmt, TypeNode, handle,
};
use crate::span::Span;
use crate::tokens::skip_trivia;
use bun_sema::bind::{ClassOwner, FnOwner, MemberOwner};
use bun_sema::hir::{self, NameKind};

// ───────────────────────────── functions ─────────────────────────────

handle! {
    /// Anything with parameters and a return type: a function declaration or expression, an arrow
    /// function, a method, an accessor, a constructor, a static block, a signature, a function
    /// type.
    ///
    /// It is not a node of its own in the source. It belongs to its [`Func::owner`]: a `Stmt`, an
    /// `Expr`, a `Member` or a `TypeNode`.
    Func, FnId, fns, Func
}

#[derive(Copy, Clone, Debug)]
pub enum FnBody<'a> {
    /// An overload, an ambient or abstract declaration, a signature.
    None,
    Block(List<'a, Stmt<'a>>),
    /// Of an arrow function.
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

    /// `ASYNC`, `GENERATOR`, and the modifiers of the declaration.
    #[inline]
    pub fn flags(self) -> Flags {
        self.raw().flags
    }

    #[inline]
    pub fn is_async(self) -> bool {
        self.flags().contains(Flags::ASYNC)
    }

    #[inline]
    pub fn is_generator(self) -> bool {
        self.flags().contains(Flags::GENERATOR)
    }

    #[inline]
    pub fn is_arrow(self) -> bool {
        self.kind() == FnKind::Arrow
    }

    /// The name of a function declaration or expression. The name of a method is the
    /// [`Member::key`] or the [`Prop::key`] of its owner.
    #[inline]
    pub fn name(self) -> Option<Ident<'a>> {
        match self.kind() {
            FnKind::Decl | FnKind::Expr => {
                self.file.ident_if_some(self.raw().name, self.raw().name_pos)
            }
            _ => None,
        }
    }

    #[inline]
    pub fn type_params(self) -> List<'a, TypeParam<'a>> {
        List::run(self.file, self.raw().type_params)
    }

    /// Without the `this` parameter.
    #[inline]
    pub fn params(self) -> List<'a, Param<'a>> {
        List::run(self.file, self.raw().params)
    }

    /// `this: T`, which is written first.
    #[inline]
    pub fn this_param(self) -> Option<Param<'a>> {
        Param::some(self.file, self.raw().this_param).filter(|p| !super::Handle::is_synthetic(*p))
    }

    #[inline]
    pub fn return_type(self) -> Option<TypeNode<'a>> {
        TypeNode::written(self.file, self.raw().ret)
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

    /// The statements of a body that is a block.
    #[inline]
    pub fn body_statements(self) -> Option<List<'a, Stmt<'a>>> {
        match self.body() {
            FnBody::Block(statements) => Some(statements),
            _ => None,
        }
    }

    /// The `{ .. }` of a body that is a block.
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

    /// The position of the `(` of the parameters. `None` for an arrow function, which may have
    /// none.
    pub fn open_paren(self) -> Option<u32> {
        (!self.is_arrow() && self.kind() != FnKind::StaticBlock).then(|| self.raw().anchor)
    }

    /// The `=>` of an arrow function.
    pub fn arrow_span(self) -> Option<Span> {
        let at = self.raw().anchor;
        self.is_arrow().then(|| Span::new(at, at + 2))
    }

    /// What it belongs to.
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

    /// The same as [`Func::owner`].
    #[inline]
    pub fn parent(self) -> Node<'a> {
        self.owner()
    }

    /// The function that encloses it.
    pub fn enclosing(self) -> Option<Func<'a>> {
        Func::some(self.file, self.file.bound.fns.get(self.id.idx())?.enclosing)
    }

    /// From its first token, which can be a modifier or a decorator, to its end. That of a method
    /// or an accessor starts with the member: see [`Func::span_from_params`].
    pub fn span(self) -> Span {
        let end = match self.owner() {
            Node::File(_) => self.raw().start,
            owner => owner.span().end,
        };
        Span::new(self.raw().start, end)
    }

    /// From the type parameters or the `(`. For a method or an accessor, this is what ESLint
    /// calls the `FunctionExpression` that is the `value` of the `MethodDefinition` or the
    /// `Property`.
    pub fn span_from_params(self) -> Span {
        Span::new(self.start_of_params(), self.span().end)
    }

    /// The position of the `<` of the type parameters, or of the `(`.
    pub(super) fn start_of_params(self) -> u32 {
        match self.type_params().first() {
            Some(first) => crate::tokens::skip_trivia_back(self.file.text(), first.span().start)
                .saturating_sub(1),
            None => self.raw().anchor,
        }
    }

    /// The range of the node that ESLint has for it:
    /// - a `FunctionDeclaration` or a `TSDeclareFunction`: the statement without `export` and
    ///   `export default`,
    /// - a `FunctionExpression` or an `ArrowFunctionExpression`: the expression,
    /// - the `FunctionExpression` or `TSEmptyBodyFunctionExpression` that is the `value` of a
    ///   method, an accessor or a constructor: [`Func::span_from_params`],
    /// - a signature, a static block or a function type: the member or the type.
    pub fn estree_span(self) -> Span {
        match (self.owner(), self.kind()) {
            (Node::Stmt(statement), _) => statement.span_without_export(),
            (Node::Member(member), FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor)
                if !member.is_signature() =>
            {
                self.span_from_params()
            }
            (Node::Expr(_), FnKind::Method | FnKind::Getter | FnKind::Setter) => self.span_from_params(),
            (owner, _) => owner.span(),
        }
    }

    /// The `this` parameter, if there is one, and the others: all that is written between the
    /// parentheses.
    pub fn params_with_this(self) -> impl Iterator<Item = Param<'a>> + 'a {
        self.this_param().into_iter().chain(self.params())
    }

    /// The position of the `)` of the parameters. `None` for an arrow function without
    /// parentheses, and for a static block.
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
                return Some(crate::tokens::skip_trivia_back(text, before).saturating_sub(1));
            }
            (None, None) => return None,
        };
        if text.get(at as usize) == Some(&b',') {
            at = skip_trivia(text, at + 1);
        }
        let close = if self.kind() == FnKind::IndexSignature { b']' } else { b')' };
        (text.get(at as usize) == Some(&close)).then_some(at)
    }

    /// From the `(` to the `)` of the parameters. For an arrow function without parentheses, the
    /// parameter. For an index signature, the brackets.
    pub fn params_span(self) -> Option<Span> {
        let Some(close) = self.close_paren() else {
            return self.params().first().map(Param::span);
        };
        let open = match self.open_paren() {
            Some(open) => open,
            None => {
                let first = self.params_with_this().next().map_or(close, |first| first.span().start);
                crate::tokens::skip_trivia_back(self.file.text(), first).saturating_sub(1)
            }
        };
        Some(Span::new(open, close + 1))
    }

    /// The `return` statements in it, not those in nested functions.
    pub fn returns(self) -> impl Iterator<Item = Stmt<'a>> + 'a {
        let file = self.file;
        let list = (file.bound.fns.get(self.id.idx())).map_or(hir::IdList::EMPTY, |f| f.returns);
        let ids = file.bound.ids.get(list.range()).unwrap_or_default();
        ids.iter().map(move |&s| Stmt::new(file, hir::StmtId(s)))
    }

    /// The `yield` expressions in it, not those in nested functions.
    pub fn yields(self) -> impl Iterator<Item = Expr<'a>> + 'a {
        let file = self.file;
        let list = (file.bound.fns.get(self.id.idx())).map_or(hir::IdList::EMPTY, |f| f.yields);
        let ids = file.bound.ids.get(list.range()).unwrap_or_default();
        ids.iter().map(move |&e| Expr::new(file, hir::ExprId(e)))
    }

    /// It contains a `this`, possibly inside arrow functions.
    pub fn contains_this(self) -> bool {
        (self.file.bound.fns.get(self.id.idx())).is_some_and(|info| info.contains_this)
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
        TypeNode::written(self.file, self.raw().ty)
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

    /// `constructor(private x)`: it also declares a property of the class.
    #[inline]
    pub fn is_parameter_property(self) -> bool {
        self.flags().contains(Flags::PARAMETER_PROPERTY)
    }

    /// Keywords and decorators, in source order.
    pub fn modifiers(self) -> List<'a, Modifier<'a>> {
        match self.file.hir.modifiers_of_params.get(self.id.idx()) {
            Some(&list) => List::run(self.file, list),
            None => List::empty(self.file),
        }
    }

    /// From its first token, which can be a decorator, a modifier or the `...`.
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
            end => end,
        };
        Span::new(raw.pos, end)
    }

    pub fn decorators(self) -> impl Iterator<Item = Expr<'a>> + 'a {
        self.modifiers().iter().filter_map(Modifier::decorator)
    }

    /// The pattern, the `?` and the type annotation. This is the range of ESLint's `Identifier`,
    /// `ObjectPattern` or `ArrayPattern` for the parameter: typescript-eslint has `?` and the
    /// annotation as parts of it.
    pub fn binding_span(self) -> Span {
        let pat = self.pat().span();
        let end = match self.ty() {
            Some(ty) => ty.outer_span().end,
            None if self.is_optional() => skip_trivia(self.file.text(), pat.end) + 1,
            None => pat.end,
        };
        Span::new(pat.start, end)
    }

    /// Without decorators and modifiers. This is the range of ESLint's node for the parameter,
    /// or of the `parameter` of a `TSParameterProperty`: the `AssignmentPattern` of `a = 1`, the
    /// `RestElement` of `...a`, otherwise [`Param::binding_span`].
    pub fn span_without_modifiers(self) -> Span {
        let whole = self.span();
        let start = match self.modifiers().last() {
            Some(last) => skip_trivia(self.file.text(), last.span().end),
            None => whole.start,
        };
        Span::new(start, whole.end)
    }

    pub fn func(self) -> Option<Func<'a>> {
        Func::some(self.file, *self.file.bound.param_fn.get(self.id.idx())?)
    }

    /// The function.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::Param(self).parent()
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

    /// What declares it: a `Func`, a `Class`, the `Stmt` of an interface or a type alias, or the
    /// `TypeNode` of an `infer` or a mapped type.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::TypeParam(self).parent()
    }
}

// ───────────────────────────── names of members ─────────────────────────────

/// The name of a member of a class, an interface, a type literal, an object literal, an object
/// pattern or an enum.
#[derive(Copy, Clone, Debug)]
pub struct Key<'a> {
    kind: KeyKind<'a>,
    start: u32,
    /// It is the name of a JSX attribute.
    is_jsx: bool,
}

#[derive(Copy, Clone, Debug)]
pub enum KeyKind<'a> {
    /// `a`. In JSX also `a-b` and `a:b`.
    Ident(Name<'a>),
    /// `"a"`: its value.
    String(Name<'a>),
    /// `0`, `1e3`, `0x10`, `1n`: the number as `String(n)` formats it.
    Number(Name<'a>),
    /// `#a`. The name includes the `#`.
    Private(Name<'a>),
    /// `["a"]`, `` [`a`] ``: the value of the string.
    ComputedString(Name<'a>),
    /// `[0]`: the number as `String(n)` formats it.
    ComputedNumber(Name<'a>),
    /// `[e]`, where `e` is not a bare string or number.
    Computed(Expr<'a>),
}

impl<'a> Key<'a> {
    pub(crate) fn new(
        file: &'a File<'a>,
        key: hir::PropKey,
        name_kind: NameKind,
        start: u32,
    ) -> Option<Key<'a>> {
        // The HIR has no name for a `bigint`, or in a binding pattern the literal as it is written.
        let bigint = || {
            let rest = file.text().get(start as usize..)?;
            let literal = rest.get(..crate::tokens::token_len(rest))?;
            (rest.first()?.is_ascii_digit() && literal.ends_with(b"n"))
                .then(|| KeyKind::Number(file.name(file.atoms.intern(&decimal_digits(literal)))))
        };
        let kind = match key {
            hir::PropKey::None => bigint()?,
            hir::PropKey::Private(name) => KeyKind::Private(file.private_name(name)),
            hir::PropKey::Computed(e) => KeyKind::Computed(Expr::new(file, e)),
            hir::PropKey::Name(name) => {
                let name = file.name(name);
                match name_kind {
                    // The HIR does not tell for the keys of `with { "type": "json" }`.
                    NameKind::Identifier if matches!(file.text().get(start as usize), Some(b'"' | b'\'')) => {
                        KeyKind::String(name)
                    }
                    NameKind::Identifier if file.text().get(start as usize).is_some_and(u8::is_ascii_digit) => {
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

    /// It is written in brackets.
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

    /// It is the name of a JSX attribute.
    #[inline]
    pub fn is_jsx(self) -> bool {
        self.is_jsx
    }

    /// The name of the property, unless it takes evaluating an expression to know it. That of
    /// `#a` includes the `#`.
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

    /// Whether the property is named `name`.
    #[inline]
    pub fn is(self, name: &str) -> bool {
        self.name().is_some_and(|it| it.is(name))
    }

    /// Without the brackets: the range of ESLint's `key`.
    pub fn inner_span(self, file: &File<'a>) -> Span {
        let text = file.text();
        match self.kind {
            KeyKind::Computed(e) => e.span(),
            KeyKind::ComputedString(_) | KeyKind::ComputedNumber(_) => {
                let literal = skip_trivia(text, self.start + 1);
                let rest = text.get(literal as usize..).unwrap_or_default();
                Span::new(literal, literal + crate::tokens::token_len(rest) as u32)
            }
            _ => self.span(file),
        }
    }

    /// With the brackets or the quotes.
    pub fn span(self, file: &File<'a>) -> Span {
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

/// The value of the `bigint` literal `raw` in decimal.
fn decimal_digits(raw: &[u8]) -> Vec<u8> {
    let digits = raw.strip_suffix(b"n").unwrap_or(raw);
    let (radix, digits) = match digits {
        [b'0', b'x' | b'X', rest @ ..] => (16, rest),
        [b'0', b'o' | b'O', rest @ ..] => (8, rest),
        [b'0', b'b' | b'B', rest @ ..] => (2, rest),
        _ => (10, digits),
    };
    // The least significant first.
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

/// Where the identifier of JSX that starts at `at` ends. It can contain `-`.
fn jsx_identifier_end(text: &[u8], at: u32) -> u32 {
    let rest = text.get(at as usize..).unwrap_or_default();
    let is_part = |b: &u8| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'$' | b'-') || *b >= 0x80;
    at + rest.iter().take_while(|b| is_part(b)).count() as u32
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
        self.file.ident_if_some(self.raw().name, self.raw().name_pos)
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

    /// The `Stmt` or the `Expr` that it is.
    pub fn owner(self) -> Node<'a> {
        match self.file.bound.class_owner.get(self.id.idx()) {
            Some(&ClassOwner::Expr(e)) => Node::Expr(Expr::new(self.file, e)),
            Some(&ClassOwner::Stmt(s)) => Node::Stmt(Stmt::new(self.file, s)),
            None => Node::File(self.file),
        }
    }

    /// The same as [`Class::owner`].
    #[inline]
    pub fn parent(self) -> Node<'a> {
        self.owner()
    }

    /// From its first token, which can be a decorator or a modifier.
    pub fn span(self) -> Span {
        let end = match self.file.bound.class_owner.get(self.id.idx()) {
            Some(&ClassOwner::Expr(e)) => self.file.hir.exprs.get(e.idx()).map_or(0, |e| e.end),
            Some(&ClassOwner::Stmt(s)) => self.file.hir.stmts.get(s.idx()).map_or(0, |s| s.loc.end),
            None => 0,
        };
        Span::new(self.raw().start, end.max(self.raw().start))
    }

    /// The range of ESLint's `ClassDeclaration` or `ClassExpression`: without `export` and
    /// `export default`, and without the decorators before them.
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
            .or_else(|| self.extends_args().angle_brackets_span().map(|it| it.end))
            .or_else(|| self.extends().map(|e| e.outer_span().end))
            .or_else(|| self.type_params().angle_brackets_span().map(|it| it.end))
            .or_else(|| self.name().map(|name| name.span().end))
            .unwrap_or_else(|| self.keyword_span().end);
        Span::new(skip_trivia(self.file.text(), head_end), self.span().end)
    }

    /// The constructor, not its overloads.
    pub fn constructor(self) -> Option<Member<'a>> {
        self.members().iter().find(|m| m.is_constructor() && m.func().is_some_and(Func::has_body))
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

    /// `static constructor() {}` is a `Constructor` too, which for ESLint is a method: see
    /// [`Member::is_constructor`].
    #[inline]
    pub fn kind(self) -> MemberKind {
        self.raw().kind
    }

    /// ESLint's `kind === "constructor"`.
    #[inline]
    pub fn is_constructor(self) -> bool {
        self.raw().kind == MemberKind::Constructor && !self.raw().flags.contains(Flags::STATIC)
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

    /// `STATIC`, `READONLY`, `OPTIONAL`, `DEFINITE`, `ABSTRACT`, `OVERRIDE`, `ACCESSOR`,
    /// `AMBIENT`, `PUBLIC`, `PROTECTED`, `PRIVATE`
    #[inline]
    pub fn flags(self) -> Flags {
        self.raw().flags
    }

    #[inline]
    pub fn is_static(self) -> bool {
        self.flags().contains(Flags::STATIC)
    }

    /// It is in an interface or a type literal, not in a class.
    pub fn is_signature(self) -> bool {
        matches!(
            self.file.bound.member_owner.get(self.id.idx()),
            Some(MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_))
        )
    }

    /// The `constructor` of a constructor, which ESLint has as its `key`. It can be written as a
    /// string.
    pub fn constructor_keyword(self) -> Option<Ident<'a>> {
        let raw = self.raw();
        match (raw.kind, raw.key) {
            (MemberKind::Constructor, hir::PropKey::Name(name)) => Some(self.file.ident(name, raw.name_pos)),
            _ => None,
        }
    }

    /// The type annotation of a property.
    pub fn ty(self) -> Option<TypeNode<'a>> {
        match self.raw().func.is_some() {
            true => None,
            false => TypeNode::written(self.file, self.raw().ty),
        }
    }

    /// The initializer of a property.
    #[inline]
    pub fn init(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().init)
    }

    /// The function of anything but a property.
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

    /// From its first token, which can be a decorator or a modifier. Its `;` or `,` is part of
    /// it.
    #[inline]
    pub fn span(self) -> Span {
        Span::new(self.raw().start, self.raw().loc.end)
    }

    /// The `Class`, the `Stmt` of the interface, or the `TypeNode` of the type literal.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::Member(self).parent()
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

    /// The flag of a keyword. Empty for a decorator.
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

    /// - `Init`: the value. `None` for a JSX attribute without one.
    /// - `Shorthand`: the identifier. In a destructuring assignment `{ a = 1 }` it is an
    ///   `Assign` of the default to the identifier.
    /// - `Spread`: what is spread.
    /// - `Method`, `Getter`, `Setter`: an `ExprKind::Fn`.
    #[inline]
    pub fn value(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().value)
    }

    /// `async`, and keywords that are errors here. `get`, `set` and `*` are not modifiers.
    pub fn modifiers(self) -> List<'a, Modifier<'a>> {
        let all = self.file.hir.modifiers_of_props;
        match all.binary_search_by_key(&self.id.0, |it| it.0.0) {
            Ok(at) => List::run(self.file, all[at].1),
            Err(_) => List::empty(self.file),
        }
    }

    /// The function of a method or an accessor.
    pub fn func(self) -> Option<Func<'a>> {
        match self.kind() {
            PropKind::Method | PropKind::Getter | PropKind::Setter => self.value()?.as_fn(),
            _ => None,
        }
    }

    /// `a?() {}`, which is an error.
    pub fn is_optional(self) -> bool {
        let at = self.raw().postfix_token;
        at != 0 && self.file.text().get(at as usize) == Some(&b'?')
    }

    #[inline]
    pub fn is_jsx_attribute(self) -> bool {
        self.raw().name_kind == NameKind::Jsx
    }

    /// It is a `key: "value"` of `with { .. }` after a module specifier or in an import type:
    /// [`ImportAttributes::entries`]. It is not a node of the tree, its value is.
    #[inline]
    pub fn is_import_attribute(self) -> bool {
        self.file.is_import_attribute(self.id)
    }

    /// From its first token: `async`, `get`, `set`, `*`, `...`, or the name.
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
        Node::Prop(self).parent()
    }
}

// ───────────────────────────── type declarations ─────────────────────────────

/// Declares a handle for a declaration that is stored beside its statement.
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

            /// The statement that it is.
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
        Span::new(skip_trivia(self.file.text(), self.name().span().end), self.span().end)
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
    /// `namespace A.B { .. }` is a namespace `A` whose body is the one statement `B { .. }`:
    /// [`Module::nested`]. That statement is not a node: ESLint has one `TSModuleDeclaration` whose
    /// `id` is a `TSQualifiedName`. No listener is called with it, a walk goes from `A` to the
    /// statements between the braces ([`Module::innermost`]), and their parent is `A`.
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

    #[inline]
    pub fn flags(self) -> Flags {
        self.raw().flags
    }

    #[inline]
    pub fn body(self) -> List<'a, Stmt<'a>> {
        List::ids(self.file, self.raw().body)
    }

    /// `declare module "m";` has none.
    #[inline]
    pub fn has_body(self) -> bool {
        self.raw().has_body
    }

    /// It is written with the keyword `module`, not `namespace`.
    #[inline]
    pub fn uses_module_keyword(self) -> bool {
        self.raw().specifies_module
    }

    /// The name, where it is written. For `declare global`, the keyword.
    pub fn name_span(self) -> Span {
        match self.name() {
            ModuleName::Ident(name) | ModuleName::String(name) => name.span(),
            ModuleName::Global => {
                let start = self.raw().name_pos;
                Span::new(start, start + "global".len() as u32)
            }
        }
    }

    /// The `{ .. }`. For the `A` of `namespace A.B { .. }` there is none.
    pub fn body_span(self) -> Option<Span> {
        if !self.has_body() || self.nested().is_some() {
            return None;
        }
        Some(Span::new(skip_trivia(self.file.text(), self.name_span().end), self.span().end))
    }

    /// The `C` of `namespace A.B.C { .. }`, whose body is what is between the braces. Itself, if its
    /// name has no dots.
    pub fn innermost(self) -> Module<'a> {
        let mut at = self;
        while let Some(nested) = at.nested() {
            at = nested;
        }
        at
    }

    /// The `B` of `namespace A.B`.
    pub fn nested(self) -> Option<Module<'a>> {
        let only = self.body().first().filter(|_| self.body().len() == 1)?;
        match only.kind() {
            super::StmtKind::Module(nested) if self.file.is_nested_namespace(only.id()) => Some(nested),
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
        self.file.ident_if_some(self.raw().default, self.raw().default_pos)
    }

    #[inline]
    pub fn namespace(self) -> Option<Ident<'a>> {
        self.file.ident_if_some(self.raw().namespace, self.raw().namespace_pos)
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

    /// It has `{ }`, which can be empty.
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
        self.raw().is_deferred
    }

    /// `import "spec"`
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

    /// What is between `import` and `from`.
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
        self.file.ident(self.raw().imported, self.raw().imported_pos)
    }

    #[inline]
    pub fn local(self) -> Ident<'a> {
        self.file.ident(self.raw().local, self.raw().pos)
    }

    /// It has an `as`.
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

    /// The `Stmt` of the import.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::ImportSpec(self).parent()
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

    /// `require("spec")`: the range of ESLint's `TSExternalModuleReference`.
    pub fn require_span(self) -> Option<Span> {
        let spec = self.stmt().module_specifier_span()?;
        let text = self.file.text();
        let open = crate::tokens::skip_trivia_back(text, spec.start).saturating_sub(1);
        let keyword_end = crate::tokens::skip_trivia_back(text, open);
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

    /// It has an `as`.
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

    /// The `Stmt` of the export.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::ExportSpec(self).parent()
    }
}
