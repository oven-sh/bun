//! Expressions.

use super::{Class, File, Func, Ident, List, Name, Node, Prop, TypeNode, handle};
use crate::language::Parser;
use crate::span::Span;
use crate::tokens::skip_trivia;
use bun_sema::atom::Atom;
use bun_sema::hir::{self, BinOp, Chain, ExprTag, UnOp};
use smallvec::SmallVec;

handle! {
    /// An expression, excluding any parentheses around it.
    Expr, ExprId, exprs, Expr, |file: &File, id| file.unwrap_jsdoc_casts(id)
}

#[derive(Copy, Clone, Debug)]
pub enum ExprKind<'a> {
    /// A hole in an array literal, the empty `{}` of JSX, or the missing argument of `import()`.
    Missing,
    Ident(Name<'a>),
    /// The `#x` of `#x in a`. The name includes the `#`.
    PrivateIdentifier(Name<'a>),
    This,
    Super,
    Null,
    True,
    False,
    Number(f64),
    /// The value of `"a"` or `'a'`. In JSX it's also an attribute value (with `&amp;` and the like decoded, and `\` not
    /// an escape), the text between elements ([`Expr::is_jsx_text`]), and a tag name such as `a-b` or `a:b`.
    String(Name<'a>),
    BigInt(Name<'a>),
    Regex(Regex<'a>),
    Template(Template<'a>),
    /// The tag is the callee and the substitutions are the arguments.
    TaggedTemplate(Call<'a>),
    /// A hole is `Missing`.
    Array(List<'a, Expr<'a>>),
    Object(List<'a, Prop<'a>>),
    /// A function expression or an arrow function. Also the value of an object literal's method or accessor.
    Fn(Func<'a>),
    Class(Class<'a>),
    /// `obj.name`, `obj?.name`, `obj.#name`
    Dot {
        obj: Expr<'a>,
        name: Ident<'a>,
        chain: Chain,
    },
    /// `obj[index]`, `obj?.[index]`
    Index {
        obj: Expr<'a>,
        index: Expr<'a>,
        chain: Chain,
    },
    Call(Call<'a>),
    New(Call<'a>),
    /// Includes `++` and `--`, `typeof`, `void` and `delete`.
    Unary {
        op: UnOp,
        operand: Expr<'a>,
    },
    /// Includes `&&`, `||`, `??`, `in`, `instanceof` and the comma operator.
    Binary {
        op: BinOp,
        left: Expr<'a>,
        right: Expr<'a>,
    },
    /// `op` is `None` for plain `=`. A destructuring target is an `Array` or an `Object`.
    Assign {
        op: Option<BinOp>,
        target: Expr<'a>,
        value: Expr<'a>,
    },
    Cond {
        test: Expr<'a>,
        yes: Expr<'a>,
        no: Expr<'a>,
    },
    Spread(Expr<'a>),
    Await(Expr<'a>),
    Yield {
        value: Option<Expr<'a>>,
        star: bool,
    },
    /// `expr as ty` or `<ty>expr`. [`Expr::is_angle_bracket_assertion`] distinguishes them.
    As {
        expr: Expr<'a>,
        ty: TypeNode<'a>,
    },
    Satisfies {
        expr: Expr<'a>,
        ty: TypeNode<'a>,
    },
    /// `expr as const`, `<const>expr`
    AsConst(Expr<'a>),
    /// `expr!`. `expr!!` and so on is also a single expression, ending at the last `!` (see
    /// [`Expr::inner_non_null_spans`]). `(expr!)!` is two.
    NonNull(Expr<'a>),
    /// `f<T>` without a call.
    Instantiation {
        expr: Expr<'a>,
        type_args: List<'a, TypeNode<'a>>,
    },
    Jsx(Jsx<'a>),
    /// `import(specifier, options)`
    ImportCall {
        args: List<'a, Expr<'a>>,
    },
    ImportMeta,
    NewTarget,
}

impl<'a> Expr<'a> {
    /// If you only care about one or two kinds, prefer [`Expr::tag`] or `as_call()`, `as_binary()` and so on. Those
    /// inline to a few loads, while this is a real call.
    #[inline(never)]
    pub fn kind(self) -> ExprKind<'a> {
        match self.file.plain_exprs.get(self.id.idx()) {
            Some(raw) => self.kind_of::<true>(raw),
            None => self.kind_slow(),
        }
    }

    #[inline(never)]
    fn kind_slow(self) -> ExprKind<'a> {
        match self.try_raw() {
            Some(raw) => self.kind_of::<false>(raw),
            None => ExprKind::Missing,
        }
    }

    /// `PLAIN` means it's one of `File::plain_exprs`. The rare cases live in separate `#[inline(never)]` functions to
    /// keep the common path free of calls.
    #[inline(always)]
    fn kind_of<const PLAIN: bool>(self, raw: &hir::Expr) -> ExprKind<'a> {
        let file = self.file;
        let e = |id| match PLAIN {
            true => Expr { file, id },
            false => Expr::new(file, id),
        };
        match raw.kind {
            hir::ExprKind::Missing => ExprKind::Missing,
            hir::ExprKind::Ident(name) => ExprKind::Ident(file.name(name)),
            hir::ExprKind::PrivateIdentifier(name) => self.kind_of_private_identifier(name),
            hir::ExprKind::This => ExprKind::This,
            hir::ExprKind::Super => ExprKind::Super,
            hir::ExprKind::Null => ExprKind::Null,
            hir::ExprKind::True => ExprKind::True,
            hir::ExprKind::False => ExprKind::False,
            hir::ExprKind::Number(at) => ExprKind::Number(file.number(at)),
            hir::ExprKind::String(text) => match file.hir.text.get(raw.pos as usize) {
                Some(b'"' | b'\'') if file.hir.jsx.is_empty() => ExprKind::String(file.name(text)),
                _ => self.kind_of_string(raw, text),
            },
            hir::ExprKind::BigInt(text) => ExprKind::BigInt(file.name(text)),
            hir::ExprKind::Regex => ExprKind::Regex(Regex { expr: self }),
            hir::ExprKind::Template { exprs } => ExprKind::Template(Template {
                expr: self,
                exprs,
                only_text: None,
            }),
            hir::ExprKind::TaggedTemplate(call) => ExprKind::TaggedTemplate(Call::new(file, call)),
            hir::ExprKind::Array(elements) => ExprKind::Array(List::ids(file, elements)),
            hir::ExprKind::Object(props) => ExprKind::Object(List::run(file, props)),
            hir::ExprKind::Fn(f) => ExprKind::Fn(Func::new(file, f)),
            hir::ExprKind::Class(c) => ExprKind::Class(Class::new(file, c)),
            hir::ExprKind::Dot {
                obj, name, chain, ..
            } => ExprKind::Dot {
                obj: e(obj),
                name: file.member_name(name, file.hir.name_pos(self.id)),
                chain,
            },
            hir::ExprKind::Index { obj, index, chain } => ExprKind::Index {
                obj: e(obj),
                index: e(index),
                chain,
            },
            hir::ExprKind::Call(call) => ExprKind::Call(Call::new(file, call)),
            hir::ExprKind::New(call) => ExprKind::New(Call::new(file, call)),
            hir::ExprKind::Unary { op, operand } => ExprKind::Unary {
                op,
                operand: e(operand),
            },
            hir::ExprKind::Binary { op, left, right } => ExprKind::Binary {
                op,
                left: e(left),
                right: e(right),
            },
            hir::ExprKind::Assign { op, target, value } => ExprKind::Assign {
                op,
                target: e(target),
                value: e(value),
            },
            hir::ExprKind::Cond { test, branches } => {
                let hir::Branches { yes, no } = file.hir.branches(branches);
                ExprKind::Cond {
                    test: e(test),
                    yes: e(yes),
                    no: e(no),
                }
            }
            hir::ExprKind::Spread(operand) => ExprKind::Spread(e(operand)),
            hir::ExprKind::Await(operand) => ExprKind::Await(e(operand)),
            hir::ExprKind::Yield { value, star } => ExprKind::Yield {
                value: (value.idx() < file.hir.exprs.len()).then(|| e(value)),
                star,
            },
            hir::ExprKind::As { expr, ty } => ExprKind::As {
                expr: e(expr),
                ty: TypeNode::new(file, ty),
            },
            hir::ExprKind::Satisfies { expr, ty } => ExprKind::Satisfies {
                expr: e(expr),
                ty: TypeNode::new(file, ty),
            },
            hir::ExprKind::AsConst(operand) => ExprKind::AsConst(e(operand)),
            hir::ExprKind::NonNull(operand) => ExprKind::NonNull(e(operand)),
            hir::ExprKind::Instantiation { expr, type_args } => ExprKind::Instantiation {
                expr: e(expr),
                type_args: List::ids(file, file.hir.list_at(type_args)),
            },
            hir::ExprKind::Jsx(jsx) => ExprKind::Jsx(Jsx::new(file, jsx, self)),
            hir::ExprKind::ImportCall { args } => ExprKind::ImportCall {
                args: List::ids(file, args),
            },
            hir::ExprKind::ImportMeta => ExprKind::ImportMeta,
            hir::ExprKind::NewTarget(_) => ExprKind::NewTarget,
        }
    }

    #[inline(never)]
    fn kind_of_private_identifier(self, name: Atom) -> ExprKind<'a> {
        ExprKind::PrivateIdentifier(self.file.private_name(name))
    }

    /// The kind of an expression that the HIR stores as the string `text` but that may not be a plain string literal.
    #[inline(never)]
    fn kind_of_string(self, raw: &hir::Expr, text: Atom) -> ExprKind<'a> {
        let file = self.file;
        if file.is_backtick_string(self.id, raw) {
            return ExprKind::Template(Template {
                expr: self,
                exprs: hir::IdList::EMPTY,
                only_text: Some(text),
            });
        }
        let value = file.name(text);
        if !file.is_jsx_attribute_string(self.id) {
            return ExprKind::String(value);
        }
        let is_espree = file.language().parser == Parser::Espree;
        ExprKind::String(match super::entities::unescape(value.bytes(), is_espree) {
            std::borrow::Cow::Borrowed(_) => value,
            std::borrow::Cow::Owned(decoded) => file.name(file.atoms.intern(&decoded)),
        })
    }

    /// The kind without its payload. Rules listen for tags.
    #[inline]
    pub fn tag(self) -> ExprTag {
        self.try_raw()
            .map_or(ExprTag::Missing, |raw| self.file.expr_tag(self.id, raw))
    }

    /// True for text between a JSX element's tags, which is ESLint's `JSXText`. Its kind is `String` and its value is
    /// the text's runtime value: whitespace around line breaks is removed, and `&amp;` and the like are decoded.
    /// [`Expr::text`] is the source text.
    #[inline]
    pub fn is_jsx_text(self) -> bool {
        self.file.is_jsx_text(self.id)
    }

    /// True for a string that's a JSX attribute's value, without braces. Its value has `&amp;` and the like decoded,
    /// which oxlint doesn't do.
    #[inline]
    pub fn is_jsx_attribute_string(self) -> bool {
        self.as_string().is_some() && self.file.is_jsx_attribute_string(self.id)
    }

    /// The `value` of ESLint's `JSXText`: the source text, including all whitespace, with `&amp;` and the like decoded.
    /// `None` if it isn't [JSX text](Expr::is_jsx_text). espree replaces each `\r\n` with `\n`.
    pub fn jsx_text_value(self) -> Option<std::borrow::Cow<'a, [u8]>> {
        let is_espree = self.file.language().parser == Parser::Espree;
        (self.is_jsx_text()).then(|| jsx_text_value_of(self.text(), is_espree))
    }

    /// True for the name in a JSX tag, or a part of it: the `a`, `a.b` and `a.b.c` of `<a.b.c>`. In ESLint that's a
    /// `JSXIdentifier`, `JSXMemberExpression` or `JSXNamespacedName`, not an `Identifier` or `MemberExpression`.
    pub fn is_jsx_tag_name(self) -> bool {
        if self.file.hir.jsx.is_empty() {
            return false;
        }
        let Node::Expr(parent) = self.parent() else {
            return false;
        };
        match parent.kind() {
            ExprKind::Dot { .. } => self
                .try_raw()
                .is_some_and(|raw| self.file.is_in_jsx_tag_with_dots(raw.pos)),
            ExprKind::Jsx(jsx) => jsx.tag() == Some(self) || jsx.close_tag() == Some(self),
            _ => false,
        }
    }

    /// Excludes the parentheses around it.
    #[inline]
    pub fn span(self) -> Span {
        let file = self.file;
        let Some(raw) = self.try_raw() else {
            return Span::default();
        };
        const fn kind(tag: ExprTag) -> u64 {
            1 << tag as u8
        }
        let tag_bit = kind(raw.kind.tag());
        // This is inlined into every caller, so it's a few bit tests instead of a jump table over the kinds.
        let is_hir_span_exact = if tag_bit & (kind(ExprTag::Ident) | kind(ExprTag::Dot)) != 0 {
            file.has_no_unicode_escape_in(raw.pos, raw.end)
        } else if tag_bit & (kind(ExprTag::Spread) | kind(ExprTag::String)) != 0 {
            file.hir.jsx.is_empty()
        } else {
            tag_bit & (kind(ExprTag::Class) | kind(ExprTag::Fn)) == 0
        };
        match is_hir_span_exact {
            true => Span::new(raw.pos, raw.end),
            false => self.corrected_span(),
        }
    }

    #[inline(never)]
    fn corrected_span(self) -> Span {
        match self.try_raw() {
            // The HIR doesn't record where the `...e` of a JSX child `{...e}` starts.
            Some(&hir::Expr {
                kind: hir::ExprKind::Spread(_),
                pos,
                end,
            }) if self.file.hir.text.get(pos as usize) != Some(&b'.') => {
                let start = self
                    .jsx_container_span()
                    .map_or(pos, |it| skip_trivia(self.file.hir.text, it.start + 1));
                Span::new(start, end)
            }
            Some(&hir::Expr {
                kind: hir::ExprKind::Ident(_),
                pos,
                end,
            }) => Span::new(pos, self.file.end_of_identifier(pos, end)),
            Some(&hir::Expr {
                kind: hir::ExprKind::Dot { .. },
                pos,
                end,
            }) => {
                let name_pos = self.file.hir.name_pos(self.id);
                Span::new(pos, self.file.end_of_identifier(name_pos, end))
            }
            // A class expression includes its decorators.
            Some(&hir::Expr {
                kind: hir::ExprKind::Class(c),
                end,
                ..
            }) => Span::new(Class::new(self.file, c).start(), end),
            // A method's function starts at its type parameters, but the HIR starts it at the `(`.
            Some(&hir::Expr {
                kind: hir::ExprKind::Fn(f),
                pos,
                end,
            }) => match self.file.hir.fns.get(f.idx()) {
                Some(func) if !func.type_params.is_empty() && func.anchor == pos => {
                    Span::new(Func::new(self.file, f).start_of_params(), end)
                }
                _ => Span::new(pos, end),
            },
            // The HIR treats the `\"` at the end of a JSX attribute value as an escape.
            Some(&hir::Expr {
                kind: hir::ExprKind::String(_),
                pos,
                end,
            }) if !self.file.hir.jsx.is_empty()
                && !matches!(self.file.hir.text.get(pos as usize), Some(b'"' | b'\''))
                && self.file.is_jsx_attribute_string(self.id) =>
            {
                let text = self.file.hir.text;
                let quote = text
                    .get(end.wrapping_sub(1) as usize)
                    .copied()
                    .unwrap_or(b'"');
                let before = text.get(..pos as usize).unwrap_or_default();
                let start = bun_core::strings::last_index_of_char(before, quote)
                    .map_or(pos, |it| it as u32);
                Span::new(start, end)
            }
            Some(raw) => Span::new(raw.pos, raw.end),
            None => Span::default(),
        }
    }

    /// The parentheses around it, innermost first.
    pub fn parens(self) -> impl DoubleEndedIterator<Item = Span> + ExactSizeIterator + 'a {
        let parens = self.file.hir.parens;
        let mut all: SmallVec<[Span; 2]> = SmallVec::new();
        let mut id = self.id;
        loop {
            let first = parens.partition_point(|p| p.0.0 < id.0);
            let own_parens = parens[first..].iter().take_while(|p| p.0 == id);
            all.extend(own_parens.map(|p| Span::new(p.1, p.2)));
            // The HIR attaches the parentheses after a JSDoc cast to the cast.
            match self.file.enclosing_jsdoc_cast(id) {
                Some(cast) => id = cast,
                None => return all.into_iter(),
            }
        }
    }

    #[inline]
    pub fn is_parenthesized(self) -> bool {
        self.file.is_parenthesized(self.id)
    }

    /// True for the `e` of `/** @type {T} */ (e)` or `/** @satisfies {T} */ (e)` in JavaScript, so [its type](Self::ty)
    /// can't be inferred from its syntax.
    #[inline]
    pub fn has_jsdoc_cast(self) -> bool {
        self.file.enclosing_jsdoc_cast(self.id).is_some()
    }

    /// TypeScript 7 and tsgolint treat JavaScript's `/** @type {T} */ (e)` as `(e as T)`. Given the `e`, this returns
    /// that `e as T`: an [`ExprKind::As`] in place of `e`, which no other accessor returns. Type-aware rules call it
    /// before they inspect an operand's syntax, for example to descend into a `&&`, recognize a literal or walk up to a
    /// test.
    ///
    /// For nested casts it returns the outermost one, whose `expr` is the `e` again, so calling this on that `expr` in
    /// a loop never terminates. Returns `self` if there's no cast, and always with an ESLint config.
    #[inline]
    pub fn with_jsdoc_cast(self) -> Expr<'a> {
        match self.file.types_follow_jsdoc_casts() {
            true => Expr {
                file: self.file,
                id: self.file.with_jsdoc_casts(self.id),
            },
            false => self,
        }
    }

    /// Includes all the parentheses around it.
    #[inline]
    pub fn outer_span(self) -> Span {
        match self.is_parenthesized() {
            true => self.parens().next_back().unwrap_or_else(|| self.span()),
            false => self.span(),
        }
    }

    #[inline]
    pub fn is_missing(self) -> bool {
        self.tag() == ExprTag::Missing
    }

    /// True if its kind never has children.
    #[inline]
    pub(super) fn is_name_or_literal(self) -> bool {
        const fn kind(tag: ExprTag) -> u64 {
            1 << tag as u8
        }
        // A string in the HIR can be a template, but only one without substitutions.
        const KINDS: u64 = kind(ExprTag::Missing)
            | kind(ExprTag::Ident)
            | kind(ExprTag::PrivateIdentifier)
            | kind(ExprTag::This)
            | kind(ExprTag::Super)
            | kind(ExprTag::Null)
            | kind(ExprTag::True)
            | kind(ExprTag::False)
            | kind(ExprTag::Number)
            | kind(ExprTag::String)
            | kind(ExprTag::BigInt)
            | kind(ExprTag::Regex)
            | kind(ExprTag::ImportMeta)
            | kind(ExprTag::NewTarget);
        self.try_raw()
            .is_none_or(|raw| KINDS & kind(raw.kind.tag()) != 0)
    }

    /// The name, if it's an identifier.
    #[inline]
    pub fn as_ident(self) -> Option<Name<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Ident(name) => Some(self.file.name(name)),
            _ => None,
        }
    }

    /// True if it's the identifier `name`.
    #[inline]
    pub fn is_ident(self, name: &str) -> bool {
        self.as_ident().is_some_and(|it| it.is(name))
    }

    /// The value, if it's a string literal.
    #[inline]
    pub fn as_string(self) -> Option<Name<'a>> {
        let (file, raw) = (self.file, self.try_raw()?);
        match raw.kind {
            hir::ExprKind::String(text) => match file.hir.text.get(raw.pos as usize) {
                Some(b'"' | b'\'') if file.hir.jsx.is_empty() => Some(file.name(text)),
                _ => self.as_string_slow(raw, text),
            },
            _ => None,
        }
    }

    #[inline(never)]
    fn as_string_slow(self, raw: &hir::Expr, text: Atom) -> Option<Name<'a>> {
        match self.kind_of_string(raw, text) {
            ExprKind::String(value) => Some(value),
            _ => None,
        }
    }

    #[inline]
    pub fn as_call(self) -> Option<Call<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Call(call) => Some(Call::new(self.file, call)),
            _ => None,
        }
    }

    #[inline]
    pub fn as_fn(self) -> Option<Func<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Fn(func) => Some(Func::new(self.file, func)),
            _ => None,
        }
    }

    #[inline]
    pub fn as_class(self) -> Option<Class<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Class(class) => Some(Class::new(self.file, class)),
            _ => None,
        }
    }

    /// The call of a `New`.
    #[inline]
    pub fn as_new(self) -> Option<Call<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::New(call) => Some(Call::new(self.file, call)),
            _ => None,
        }
    }

    /// The call of a `TaggedTemplate`.
    #[inline]
    pub fn as_tagged_template(self) -> Option<Call<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::TaggedTemplate(call) => Some(Call::new(self.file, call)),
            _ => None,
        }
    }

    /// The `obj`, `name` and `chain` of a `Dot`.
    #[inline]
    pub fn as_dot(self) -> Option<(Expr<'a>, Ident<'a>, Chain)> {
        match self.try_raw()?.kind {
            hir::ExprKind::Dot {
                obj, name, chain, ..
            } => Some((
                Expr::new(self.file, obj),
                self.file.member_name(name, self.file.hir.name_pos(self.id)),
                chain,
            )),
            _ => None,
        }
    }

    /// The `obj`, `index` and `chain` of an `Index`.
    #[inline]
    pub fn as_index(self) -> Option<(Expr<'a>, Expr<'a>, Chain)> {
        match self.try_raw()?.kind {
            hir::ExprKind::Index { obj, index, chain } => Some((
                Expr::new(self.file, obj),
                Expr::new(self.file, index),
                chain,
            )),
            _ => None,
        }
    }

    /// The `op` and `operand` of a `Unary`.
    #[inline]
    pub fn as_unary(self) -> Option<(UnOp, Expr<'a>)> {
        match self.try_raw()?.kind {
            hir::ExprKind::Unary { op, operand } => Some((op, Expr::new(self.file, operand))),
            _ => None,
        }
    }

    /// The `op`, `left` and `right` of a `Binary`.
    #[inline]
    pub fn as_binary(self) -> Option<(BinOp, Expr<'a>, Expr<'a>)> {
        match self.try_raw()?.kind {
            hir::ExprKind::Binary { op, left, right } => {
                Some((op, Expr::new(self.file, left), Expr::new(self.file, right)))
            }
            _ => None,
        }
    }

    /// The `op`, `target` and `value` of an `Assign`.
    #[inline]
    pub fn as_assign(self) -> Option<(Option<BinOp>, Expr<'a>, Expr<'a>)> {
        match self.try_raw()?.kind {
            hir::ExprKind::Assign { op, target, value } => Some((
                op,
                Expr::new(self.file, target),
                Expr::new(self.file, value),
            )),
            _ => None,
        }
    }

    /// The `test`, `yes` and `no` of a `Cond`.
    #[inline]
    pub fn as_cond(self) -> Option<(Expr<'a>, Expr<'a>, Expr<'a>)> {
        match self.try_raw()?.kind {
            hir::ExprKind::Cond { test, branches } => {
                let hir::Branches { yes, no } = self.file.hir.branches(branches);
                Some((
                    Expr::new(self.file, test),
                    Expr::new(self.file, yes),
                    Expr::new(self.file, no),
                ))
            }
            _ => None,
        }
    }

    /// The elements of an `Array`.
    #[inline]
    pub fn as_array(self) -> Option<List<'a, Expr<'a>>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Array(elements) => Some(List::ids(self.file, elements)),
            _ => None,
        }
    }

    /// The properties of an `Object`.
    #[inline]
    pub fn as_object(self) -> Option<List<'a, Prop<'a>>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Object(props) => Some(List::run(self.file, props)),
            _ => None,
        }
    }

    /// The import, export or import type whose attributes are this `{ .. }`, like the `import a from "a" with {}`
    /// around the `{}`. Such an object isn't a node in the tree, and its [parent](Expr::parent) is the file.
    pub fn owner_of_import_attributes(self) -> Option<Node<'a>> {
        if self.file.hir.import_attributes.is_empty() {
            return None;
        }
        (self.file.parents()).of_import_attributes(self.file, self.id)
    }

    #[inline]
    pub fn as_template(self) -> Option<Template<'a>> {
        let raw = self.try_raw()?;
        let (exprs, only_text) = match raw.kind {
            hir::ExprKind::Template { exprs } => (exprs, None),
            hir::ExprKind::String(text) if self.file.is_backtick_string(self.id, raw) => {
                (hir::IdList::EMPTY, Some(text))
            }
            _ => return None,
        };
        Some(Template {
            expr: self,
            exprs,
            only_text,
        })
    }

    #[inline]
    pub fn as_number(self) -> Option<f64> {
        match self.try_raw()?.kind {
            hir::ExprKind::Number(at) => Some(self.file.number(at)),
            _ => None,
        }
    }

    #[inline]
    pub fn as_regex(self) -> Option<Regex<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Regex => Some(Regex { expr: self }),
            _ => None,
        }
    }

    /// The `args` of an `ImportCall`.
    #[inline]
    pub fn as_import_call(self) -> Option<List<'a, Expr<'a>>> {
        match self.try_raw()?.kind {
            hir::ExprKind::ImportCall { args } => Some(List::ids(self.file, args)),
            _ => None,
        }
    }

    /// The name of a `PrivateIdentifier`, including the `#`.
    #[inline]
    pub fn as_private_identifier(self) -> Option<Name<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::PrivateIdentifier(name) => Some(self.file.private_name(name)),
            _ => None,
        }
    }

    /// The operand of a `Spread`.
    #[inline]
    pub fn as_spread(self) -> Option<Expr<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Spread(operand) => Some(Expr::new(self.file, operand)),
            _ => None,
        }
    }

    /// The `expr` and `ty` of a `Satisfies`.
    #[inline]
    pub fn as_satisfies(self) -> Option<(Expr<'a>, TypeNode<'a>)> {
        match self.try_raw()?.kind {
            hir::ExprKind::Satisfies { expr, ty } => {
                Some((Expr::new(self.file, expr), TypeNode::new(self.file, ty)))
            }
            _ => None,
        }
    }

    #[inline]
    pub fn as_bigint(self) -> Option<Name<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::BigInt(text) => Some(self.file.name(text)),
            _ => None,
        }
    }

    /// The `value` and `star` of a `Yield`.
    #[inline]
    pub fn as_yield(self) -> Option<(Option<Expr<'a>>, bool)> {
        match self.try_raw()?.kind {
            hir::ExprKind::Yield { value, star } => Some((Expr::some(self.file, value), star)),
            _ => None,
        }
    }

    /// The call, if it's a `Call` or a `New`.
    #[inline]
    pub fn as_call_or_new(self) -> Option<Call<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Call(call) | hir::ExprKind::New(call) => {
                Some(Call::new(self.file, call))
            }
            _ => None,
        }
    }

    /// The call, if it's a `Call`, a `New` or a `TaggedTemplate`.
    #[inline]
    pub fn as_call_like(self) -> Option<Call<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Call(call)
            | hir::ExprKind::New(call)
            | hir::ExprKind::TaggedTemplate(call) => Some(Call::new(self.file, call)),
            _ => None,
        }
    }

    /// The callee of a `Call` or a `New`.
    #[inline]
    pub fn callee(self) -> Option<Expr<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Call(call) | hir::ExprKind::New(call) => {
                Some(Call::new(self.file, call).callee())
            }
            _ => None,
        }
    }

    /// The `obj` of a `Dot` or an `Index`.
    #[inline]
    pub fn object(self) -> Option<Expr<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Dot { obj, .. } | hir::ExprKind::Index { obj, .. } => {
                Some(Expr::new(self.file, obj))
            }
            _ => None,
        }
    }

    /// The `index` of an `Index`.
    #[inline]
    pub fn index(self) -> Option<Expr<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Index { index, .. } => Some(Expr::new(self.file, index)),
            _ => None,
        }
    }

    /// The `name` of a `Dot`.
    #[inline]
    pub fn member_name(self) -> Option<Ident<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Dot { name, .. } => {
                Some(self.file.member_name(name, self.file.hir.name_pos(self.id)))
            }
            _ => None,
        }
    }

    /// The start of a `Dot`'s `name`.
    #[inline]
    pub fn member_name_start(self) -> Option<u32> {
        match self.try_raw()?.kind {
            hir::ExprKind::Dot { .. } => Some(self.file.hir.name_pos(self.id)),
            _ => None,
        }
    }

    /// `obj.#name`
    #[inline]
    pub fn is_private_member(self) -> bool {
        matches!(self.try_raw(), Some(hir::Expr { kind: hir::ExprKind::Dot { .. }, .. })
            if self.file.hir.text.get(self.file.hir.name_pos(self.id) as usize) == Some(&b'#'))
    }

    /// The operator of a `Binary`.
    #[inline]
    pub fn binary_op(self) -> Option<BinOp> {
        match self.try_raw()?.kind {
            hir::ExprKind::Binary { op, .. } => Some(op),
            _ => None,
        }
    }

    /// The operator of a `Unary`.
    #[inline]
    pub fn unary_op(self) -> Option<UnOp> {
        match self.try_raw()?.kind {
            hir::ExprKind::Unary { op, .. } => Some(op),
            _ => None,
        }
    }

    /// The operator of an `Assign`. `Some(None)` for plain `=`.
    #[inline]
    pub fn assign_op(self) -> Option<Option<BinOp>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Assign { op, .. } => Some(op),
            _ => None,
        }
    }

    /// The `left` of a `Binary`, the `target` of an `Assign`.
    #[inline]
    pub fn left(self) -> Option<Expr<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Binary { left, .. } | hir::ExprKind::Assign { target: left, .. } => {
                Some(Expr::new(self.file, left))
            }
            _ => None,
        }
    }

    /// The `right` of a `Binary`, the `value` of an `Assign`.
    #[inline]
    pub fn right(self) -> Option<Expr<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Binary { right, .. } | hir::ExprKind::Assign { value: right, .. } => {
                Some(Expr::new(self.file, right))
            }
            _ => None,
        }
    }

    /// The single operand of a `Unary`, an `Await`, a `Spread`, a `NonNull`, an `As`, an `AsConst`, a `Satisfies` or an
    /// `Instantiation`.
    #[inline]
    pub fn operand(self) -> Option<Expr<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Unary { operand, .. }
            | hir::ExprKind::Await(operand)
            | hir::ExprKind::Spread(operand)
            | hir::ExprKind::NonNull(operand)
            | hir::ExprKind::AsConst(operand)
            | hir::ExprKind::As { expr: operand, .. }
            | hir::ExprKind::Satisfies { expr: operand, .. }
            | hir::ExprKind::Instantiation { expr: operand, .. } => {
                Some(Expr::new(self.file, operand))
            }
            _ => None,
        }
    }

    /// `<T>e` or `<const>e`, as opposed to `e as T`.
    pub fn is_angle_bracket_assertion(self) -> bool {
        match self.kind() {
            ExprKind::As { expr, .. } | ExprKind::AsConst(expr) => {
                self.span().start < expr.outer_span().start
            }
            _ => false,
        }
    }

    /// `a?.b`, `a?.[b]`, `a?.()`: this expression itself has the `?.`.
    #[inline]
    pub fn is_optional(self) -> bool {
        self.chain() == Chain::Start
    }

    /// Its position in an optional chain.
    #[inline]
    pub fn chain(self) -> Chain {
        match self.try_raw().map(|raw| raw.kind) {
            Some(hir::ExprKind::Dot { chain, .. } | hir::ExprKind::Index { chain, .. }) => chain,
            Some(hir::ExprKind::Call(call)) => Call::new(self.file, call).chain(),
            _ => Chain::No,
        }
    }

    /// The span of the operator of a `Unary`, a `Binary` or an `Assign`.
    pub fn operator_span(self) -> Option<Span> {
        let text = self.file.text();
        let after = |left: Expr, len: usize| {
            let start = skip_trivia(text, left.outer_span().end);
            Span::new(start, start + len as u32)
        };
        match self.kind() {
            ExprKind::Unary {
                op: op @ (UnOp::PostInc | UnOp::PostDec),
                operand,
            } => Some(after(operand, un_op_text(op).len())),
            ExprKind::Unary { op, .. } => {
                let start = self.span().start;
                Some(Span::new(start, start + un_op_text(op).len() as u32))
            }
            ExprKind::Binary { op, left, .. } => Some(after(left, bin_op_text(op).len())),
            ExprKind::Assign { op, target, .. } => {
                Some(after(target, op.map_or(0, |op| bin_op_text(op).len()) + 1))
            }
            _ => None,
        }
    }

    /// The span of the JSX `{e}` that wraps it. The braces of `{...e}` belong to the `Spread`, and those of `{}` to the
    /// `Missing`.
    pub fn jsx_container_span(self) -> Option<Span> {
        let braces = self.file.hir.jsx_expressions;
        let at = braces.binary_search_by_key(&self.id.0, |it| it.0.0).ok()?;
        Some(Span::new(braces[at].1, braces[at].2))
    }

    /// True if it's part of an optional chain, meaning it isn't evaluated when its own `?.` or one to its left finds
    /// `null` or `undefined`. In `a?.b.c!` that's `a?.b`, `a?.b.c` and `a?.b.c!`. In `(a?.b).c` it's only `a?.b`,
    /// because parentheses end a chain.
    #[inline]
    pub fn is_in_optional_chain(self) -> bool {
        let mut at = self;
        while let Some(hir::Expr {
            kind: hir::ExprKind::NonNull(operand),
            ..
        }) = at.try_raw()
        {
            at = Expr::new(self.file, *operand);
            if at.is_parenthesized() {
                return false;
            }
        }
        at.chain() != Chain::No
    }

    /// True if it's a whole optional chain. That's where ESLint wraps the `MemberExpression`, `CallExpression` or
    /// `TSNonNullExpression` in a `ChainExpression` with the same range.
    #[inline]
    pub fn is_chain_root(self) -> bool {
        self.is_in_optional_chain() && self.ends_optional_chain()
    }

    /// True if the optional chain it's part of ends here.
    fn ends_optional_chain(self) -> bool {
        let Node::Expr(parent) = self.parent() else {
            return true;
        };
        let continues = match parent.tag() {
            ExprTag::Dot | ExprTag::Index => parent.object() == Some(self),
            ExprTag::Call => parent.callee() == Some(self),
            ExprTag::NonNull => true,
            _ => false,
        };
        !continues || self.is_parenthesized()
    }

    /// True if it's a destructuring assignment target or part of one: the `[a, b]` of `[a, b] = c`, the `{ a }` of
    /// `for ({ a } of b)`, and inside these a default like `a = 1` and a rest like `...a`. ESLint calls such an
    /// `Array`, `Object`, `Assign` or `Spread` an `ArrayPattern`, `ObjectPattern`, `AssignmentPattern` or
    /// `RestElement`. Anything in parentheses is an ordinary expression.
    pub fn is_assignment_target(self) -> bool {
        let mut container = None;
        let answer = self.is_assignment_target_uncached(&mut container);
        // The enclosing array or object has the same answer, and so does everything else in it. Caching it keeps nested
        // elements from walking up to the root every time.
        if let Some(container) = container {
            let last = &self.file.lazy.last_assignment_target;
            last.set(Some((container, answer)));
        }
        answer
    }

    /// `container` is set to the enclosing array or object.
    #[inline(always)]
    fn is_assignment_target_uncached(self, container: &mut Option<hir::ExprId>) -> bool {
        let mut at = self;
        loop {
            if container.is_some()
                && let Some((last, answer)) = self.file.lazy.last_assignment_target.get()
                && last == at.id
            {
                return answer;
            }
            if at.is_parenthesized() {
                return false;
            }
            at = match at.parent() {
                Node::Expr(parent) => match parent.tag() {
                    ExprTag::Assign => return parent.left() == Some(at),
                    ExprTag::Array | ExprTag::Spread => parent,
                    _ => return false,
                },
                Node::Prop(prop) if prop.value() == Some(at) && !prop.is_jsx_attribute() => {
                    match prop.parent() {
                        Node::Expr(object) => object,
                        _ => return false,
                    }
                }
                Node::Stmt(parent) => {
                    return match parent.try_raw().map(|raw| raw.kind) {
                        Some(
                            hir::StmtKind::ForIn { left, .. } | hir::StmtKind::ForOf { left, .. },
                        ) => super::Stmt::new(self.file, left).as_expr() == Some(at),
                        _ => false,
                    };
                }
                _ => return false,
            };
            container.get_or_insert(at.id);
        }
    }

    /// True for the `a.b.c` of the type `typeof a.b.c`, or a part of it. In ESLint that's a `TSQualifiedName`, not a
    /// `MemberExpression`.
    #[inline]
    pub fn is_in_type_query(self) -> bool {
        let operands = self.file.bound.type_query_operands;
        !operands.is_empty() && operands.binary_search(&self.id).is_ok()
    }

    /// `x!!!` is a single `NonNull` of `x`, but ESLint nests one `TSNonNullExpression` per `!`. This returns the ranges
    /// of the inner ones, innermost first: `x!`, `x!!`. Each range ends with its `!`. Empty for `x!`, which is nearly
    /// always the case, and for anything that isn't a `NonNull`.
    pub fn inner_non_null_spans(
        self,
    ) -> impl DoubleEndedIterator<Item = Span> + ExactSizeIterator + 'a {
        let all = self.file.hir.non_null_ends;
        let ends = match all.is_empty() {
            true => all,
            false => {
                let first = all.partition_point(|it| it.0.0 < self.id.0);
                let count = all[first..].partition_point(|it| it.0 == self.id);
                &all[first..first + count]
            }
        };
        let start = self.span().start;
        ends.iter().map(move |it| Span::new(start, it.1))
    }

    /// The number of `!` in a `NonNull`, so 2 for `x!!`. 0 for anything else.
    #[inline]
    pub fn non_null_count(self) -> usize {
        match self.tag() {
            ExprTag::NonNull => self.inner_non_null_spans().len() + 1,
            _ => 0,
        }
    }

    /// Strips type-only wrappers: `e as T`, `<T>e`, `e as const`, `e satisfies T`, `e!`. Parentheses aren't nodes, so
    /// `(e as T)!` also gives `e`.
    pub fn skip_type_wrappers(self) -> Expr<'a> {
        let mut at = self;
        while let Some(
            hir::ExprKind::As { expr, .. }
            | hir::ExprKind::Satisfies { expr, .. }
            | hir::ExprKind::AsConst(expr)
            | hir::ExprKind::NonNull(expr),
        ) = at.try_raw().map(|raw| raw.kind)
        {
            at = Expr::new(self.file, expr);
        }
        at
    }

    /// The `const` of `e as const` or `<const>e`, which is a `TSTypeReference` in ESLint.
    pub fn const_keyword_span(self) -> Option<Span> {
        let ExprKind::AsConst(_) = self.kind() else {
            return None;
        };
        let whole = self.span();
        Some(match self.is_angle_bracket_assertion() {
            true => {
                let start = skip_trivia(self.file.text(), whole.start + 1);
                Span::new(start, start + 5)
            }
            false => Span::new(whole.end.saturating_sub(5), whole.end),
        })
    }

    /// The two names of `import.meta` or `new.target`: ESLint's `meta` and `property`.
    pub fn meta_property_spans(self) -> Option<(Span, Span)> {
        let keyword = match self.tag() {
            ExprTag::ImportMeta => "import",
            ExprTag::NewTarget => "new",
            _ => return None,
        };
        let (text, whole) = (self.file.text(), self.span());
        let meta = Span::new(whole.start, whole.start + keyword.len() as u32);
        let dot = skip_trivia(text, meta.end);
        Some((meta, Span::new(skip_trivia(text, dot + 1), whole.end)))
    }

    /// `import.defer(..)`, as opposed to `import(..)`.
    #[inline]
    pub fn is_deferred_import_call(self) -> bool {
        self.import_call_phase() == Some("defer")
    }

    /// `"defer"` for `import.defer(..)`, `"source"` for `import.source(..)`.
    pub fn import_call_phase(self) -> Option<&'static str> {
        let deferred = self.file.hir.deferred_import_calls;
        if deferred.is_empty() {
            return None;
        }
        let ExprKind::ImportCall { args } = self.kind() else {
            return None;
        };
        let first = args.first()?;
        let text = self.file.text();
        let dot = skip_trivia(text, self.span().start + "import".len() as u32);
        (deferred.iter().any(|it| it.0 == first.id))
            .then(|| self.file.phase_at(skip_trivia(text, dot + 1)))
    }

    /// The comma operator's operands: `a`, `b` and `c` for `a, b, c`, which are the `expressions` of a single
    /// `SequenceExpression` in ESLint. `(a, b), c` gives `(a, b)` and `c`. Anything else gives just itself.
    pub fn sequence(self) -> SmallVec<[Expr<'a>; 4]> {
        let mut items = SmallVec::new();
        let mut at = self;
        while let Some((BinOp::Comma, left, right)) = at.as_binary()
            && (at == self || !at.is_parenthesized())
        {
            items.push(right);
            at = left;
        }
        items.push(at);
        items.reverse();
        items
    }
}

impl<'a> File<'a> {
    /// The `name` of a `Dot`, which starts at `start`.
    #[inline]
    fn member_name(&'a self, name: Atom, start: u32) -> Ident<'a> {
        match self.mangles_private_names() && self.hir.text.get(start as usize) == Some(&b'#') {
            true => self.private_member_name(name, start),
            false => self.ident(name, start),
        }
    }

    #[inline(never)]
    fn private_member_name(&'a self, name: Atom, start: u32) -> Ident<'a> {
        self.ident(self.private_name(name).atom(), start)
    }
}

impl File<'_> {
    /// The HIR has a single flag for both import phases. The word at `pos` tells which one it is.
    pub(super) fn phase_at(&self, pos: u32) -> &'static str {
        let rest = self.hir.text.get(pos as usize..).unwrap_or_default();
        match rest.get(..crate::tokens::token_len(rest)) {
            Some(b"source") => "source",
            _ => "defer",
        }
    }

    /// The HIR's number at index `at`.
    #[inline]
    fn number(&self, at: u32) -> f64 {
        (self.hir.numbers.get(at as usize).copied()).unwrap_or(f64::NAN)
    }

    /// The tag of the expression `id`, whose HIR node is `raw`.
    #[inline]
    pub(super) fn expr_tag(&self, id: hir::ExprId, raw: &hir::Expr) -> ExprTag {
        match raw.kind {
            hir::ExprKind::String(_) if self.is_backtick_string(id, raw) => ExprTag::Template,
            kind => kind.tag(),
        }
    }

    /// True if `id`, which the HIR stores as the string `raw`, is a template without substitutions.
    #[inline]
    fn is_backtick_string(&self, id: hir::ExprId, raw: &hir::Expr) -> bool {
        self.hir.text.get(raw.pos as usize) == Some(&b'`') && !self.is_jsx_text(id)
    }

    /// True if the string `id` is a JSX attribute's value, without braces.
    fn is_jsx_attribute_string(&self, id: hir::ExprId) -> bool {
        if self.hir.jsx.is_empty() {
            return false;
        }
        let bun_sema::bind::Parent::Prop(prop) = self.bound.parent_of_expr(id) else {
            return false;
        };
        let is_attribute =
            |it: &hir::Prop| it.name_kind == hir::NameKind::Jsx && it.kind != hir::PropKind::Spread;
        self.hir.props.get(prop.idx()).is_some_and(is_attribute)
            && self
                .hir
                .jsx_expressions
                .binary_search_by_key(&id.0, |it| it.0.0)
                .is_err()
    }

    #[inline(never)]
    fn is_jsx_text(&self, id: hir::ExprId) -> bool {
        if self.hir.jsx.is_empty()
            || !matches!(
                self.hir.exprs.get(id.idx()),
                Some(hir::Expr {
                    kind: hir::ExprKind::String(_),
                    ..
                })
            )
        {
            return false;
        }
        let bun_sema::bind::Parent::Expr(parent) = self.bound.parent_of_expr(id) else {
            return false;
        };
        let Some(&hir::Expr {
            kind: hir::ExprKind::Jsx(jsx),
            ..
        }) = self.hir.exprs.get(parent.idx())
        else {
            return false;
        };
        let is_name = self
            .hir
            .jsx
            .get(jsx.idx())
            .is_some_and(|it| it.tag == id || it.close_tag == id);
        !is_name
            && self
                .hir
                .jsx_expressions
                .binary_search_by_key(&id.0, |it| it.0.0)
                .is_err()
    }
}

/// The operator's source text.
pub fn bin_op_text(op: BinOp) -> &'static str {
    match op {
        BinOp::Add => "+",
        BinOp::Sub => "-",
        BinOp::Mul => "*",
        BinOp::Div => "/",
        BinOp::Rem => "%",
        BinOp::Pow => "**",
        BinOp::Shl => "<<",
        BinOp::Shr => ">>",
        BinOp::UShr => ">>>",
        BinOp::BitAnd => "&",
        BinOp::BitOr => "|",
        BinOp::BitXor => "^",
        BinOp::Lt => "<",
        BinOp::Le => "<=",
        BinOp::Gt => ">",
        BinOp::Ge => ">=",
        BinOp::EqEq => "==",
        BinOp::NotEq => "!=",
        BinOp::EqEqEq => "===",
        BinOp::NotEqEq => "!==",
        BinOp::In => "in",
        BinOp::Instanceof => "instanceof",
        BinOp::And => "&&",
        BinOp::Or => "||",
        BinOp::Nullish => "??",
        BinOp::Comma => ",",
    }
}

/// The operator's source text.
pub fn un_op_text(op: UnOp) -> &'static str {
    match op {
        UnOp::Plus => "+",
        UnOp::Minus => "-",
        UnOp::BitNot => "~",
        UnOp::Not => "!",
        UnOp::Typeof => "typeof",
        UnOp::Void => "void",
        UnOp::Delete => "delete",
        UnOp::PreInc | UnOp::PostInc => "++",
        UnOp::PreDec | UnOp::PostDec => "--",
    }
}

/// `=`, `+=`, `&&=`, ..
pub fn assign_op_text(op: Option<BinOp>) -> &'static str {
    match op {
        None => "=",
        Some(BinOp::Add) => "+=",
        Some(BinOp::Sub) => "-=",
        Some(BinOp::Mul) => "*=",
        Some(BinOp::Div) => "/=",
        Some(BinOp::Rem) => "%=",
        Some(BinOp::Pow) => "**=",
        Some(BinOp::Shl) => "<<=",
        Some(BinOp::Shr) => ">>=",
        Some(BinOp::UShr) => ">>>=",
        Some(BinOp::BitAnd) => "&=",
        Some(BinOp::BitOr) => "|=",
        Some(BinOp::BitXor) => "^=",
        Some(BinOp::And) => "&&=",
        Some(BinOp::Or) => "||=",
        Some(BinOp::Nullish) => "??=",
        Some(_) => "=",
    }
}

/// `/pattern/flags`
#[derive(Copy, Clone, Debug)]
pub struct Regex<'a> {
    expr: Expr<'a>,
}

impl<'a> Regex<'a> {
    fn split(self) -> (&'a [u8], &'a [u8]) {
        let text = self.expr.text();
        let slash = bun_core::strings::last_index_of_char(text, b'/').unwrap_or(0);
        (
            text.get(1..slash).unwrap_or_default(),
            text.get(slash + 1..).unwrap_or_default(),
        )
    }

    /// The source text between the slashes.
    #[inline]
    pub fn pattern(self) -> &'a [u8] {
        self.split().0
    }

    #[inline]
    pub fn flags(self) -> &'a [u8] {
        self.split().1
    }
}

/// `` `text${expr}text` ``
#[derive(Copy, Clone, Debug)]
pub struct Template<'a> {
    expr: Expr<'a>,
    exprs: hir::IdList<hir::ExprId>,
    /// The text of a template without substitutions, which the HIR stores as a string.
    only_text: Option<bun_sema::atom::Atom>,
}

impl<'a> Template<'a> {
    /// The substitutions.
    #[inline]
    pub fn exprs(self) -> List<'a, Expr<'a>> {
        List::ids(self.expr.file, self.exprs)
    }

    /// The number of text pieces, which is one more than the number of substitutions.
    #[inline]
    pub fn quasi_count(self) -> usize {
        self.exprs.len() + 1
    }

    /// The cooked value of text piece `i`. `None` if it has an invalid escape, which a tagged template allows.
    #[inline]
    pub fn cooked(self, i: usize) -> Option<Name<'a>> {
        self.scanner_text(i)
            .filter(|_| !has_invalid_escape(self.raw(i)))
    }

    /// Like [`Template::cooked`], but keeps an invalid escape as written, the way TypeScript's scanner does.
    pub(crate) fn scanner_text(self, i: usize) -> Option<Name<'a>> {
        let file = self.expr.file;
        let at = self.exprs.start as usize + self.exprs.len() + i;
        if i >= self.quasi_count() {
            return None;
        }
        if let Some(text) = self.only_text {
            return file.name_if_some(text);
        }
        file.name_if_some(bun_sema::atom::Atom(*file.hir.ids.get(at)?))
    }

    /// Text piece `i` with its delimiters: `` `a${ ``, `}b${`, `` }c` ``.
    pub fn quasi_span(self, i: usize) -> Span {
        let (text, whole) = (self.expr.file.text(), self.expr.span());
        let start = match i.checked_sub(1).and_then(|before| self.exprs().get(before)) {
            Some(before) => skip_trivia(text, before.outer_span().end),
            None => whole.start,
        };
        let end = match i < self.exprs.len() {
            true => template_text_end(text, start + 1),
            false => whole.end,
        };
        Span::new(start, end)
    }

    /// The source text of piece `i`, without its delimiters.
    #[inline]
    pub fn raw(self, i: usize) -> &'a [u8] {
        let is_last = i + 1 == self.quasi_count();
        let span = self.quasi_span(i).shrink(1, if is_last { 1 } else { 2 });
        self.expr.file.slice(span)
    }

    /// The value, if there are no substitutions.
    #[inline]
    pub fn as_static(self) -> Option<Name<'a>> {
        self.exprs.is_empty().then(|| self.cooked(0)).flatten()
    }
}

/// True if the template text `raw` has an invalid escape: `\u` or `\x` without its digits, `\1` to `\9`, or `\0` before
/// a digit.
fn has_invalid_escape(raw: &[u8]) -> bool {
    let is_hex = |bytes: Option<&[u8]>| {
        bytes.is_some_and(|it| !it.is_empty() && it.iter().all(u8::is_ascii_hexdigit))
    };
    let mut rest = raw;
    while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'\\') {
        let after = rest.get(at + 2..).unwrap_or_default();
        let is_valid = match rest.get(at + 1) {
            Some(b'x') => is_hex(after.get(..2)),
            Some(b'u') if after.first() == Some(&b'{') => {
                let digits = bun_core::strings::index_of_char_usize(after, b'}')
                    .and_then(|end| after.get(1..end));
                is_hex(digits)
                    && digits.is_some_and(|it| {
                        let digits = it.iter().skip_while(|b| **b == b'0').count();
                        digits < 6 || digits == 6 && it[it.len() - 6..].starts_with(b"10")
                    })
            }
            Some(b'u') => is_hex(after.get(..4)),
            Some(b'0') => !after.first().is_some_and(u8::is_ascii_digit),
            Some(b'1'..=b'9') => false,
            _ => true,
        };
        if !is_valid {
            return true;
        }
        rest = after;
    }
    false
}

/// The position just past the next `${` or closing backtick, searching from `at` inside a template's text.
pub(super) fn template_text_end(text: &[u8], mut at: u32) -> u32 {
    loop {
        let rest = text.get(at as usize..).unwrap_or_default();
        let Some(found) = bun_core::strings::index_of_any(rest, b"\\$`") else {
            return text.len() as u32;
        };
        at += found as u32;
        match rest[found] {
            b'\\' => at += 2,
            b'$' if rest.get(found + 1) == Some(&b'{') => return at + 2,
            b'$' => at += 1,
            _ => return at + 1,
        }
    }
}

/// `callee(args)`, `new callee(args)`, `` tag`template` ``
#[derive(Copy, Clone)]
pub struct Call<'a> {
    file: &'a File<'a>,
    id: hir::CallId,
}

impl std::fmt::Debug for Call<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Call({})", self.id.0)
    }
}

impl<'a> Call<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, id: hir::CallId) -> Self {
        Call { file, id }
    }

    #[inline]
    fn raw(self) -> Option<&'a hir::Call> {
        self.file.hir.calls.get(self.id.idx())
    }

    #[inline]
    pub fn callee(self) -> Expr<'a> {
        Expr::new(
            self.file,
            self.raw().map_or(hir::ExprId::NONE, |c| c.callee),
        )
    }

    #[inline]
    pub fn args(self) -> List<'a, Expr<'a>> {
        match self.raw() {
            Some(call) => List::ids(self.file, call.args),
            None => List::empty(self.file),
        }
    }

    #[inline]
    pub fn type_args(self) -> List<'a, TypeNode<'a>> {
        match self.raw() {
            Some(call) => List::ids(self.file, self.file.hir.list_at(call.type_args)),
            None => List::empty(self.file),
        }
    }

    #[inline]
    pub fn chain(self) -> Chain {
        self.raw().map_or(Chain::No, |call| call.chain)
    }

    /// `callee?.(args)`
    #[inline]
    pub fn is_optional(self) -> bool {
        self.chain() == Chain::Start
    }

    /// The position of the `)`. `None` for `new C` and for a tagged template.
    #[inline]
    pub fn close_paren(self) -> Option<u32> {
        self.raw()
            .map(|call| call.close_pos)
            .filter(|&pos| pos < hir::INCOMPLETE_TEMPLATE)
    }

    /// The template of a tagged template.
    #[inline]
    pub fn template(self) -> Option<Expr<'a>> {
        Expr::some(
            self.file,
            hir::template_in(self.file.hir.tagged_templates, self.id),
        )
    }
}

/// A child between a JSX element's tags.
#[derive(Copy, Clone, Debug)]
pub enum JsxChild<'a> {
    Expr(Expr<'a>),
    /// Whitespace containing a line break. It's a `JSXText` in ESLint.
    Whitespace(Span),
}

impl<'a> JsxChild<'a> {
    /// The `value` of ESLint's `JSXText`. `None` if it isn't text.
    pub fn text_value(self, file: &'a File<'a>) -> Option<std::borrow::Cow<'a, [u8]>> {
        match self {
            JsxChild::Expr(e) => e.jsx_text_value(),
            JsxChild::Whitespace(span) => Some(std::borrow::Cow::Borrowed(file.slice(span))),
        }
    }
}

/// See [`Jsx::children_with_whitespace`].
#[derive(Copy, Clone)]
pub struct JsxChildren<'a> {
    /// The end of what's been returned so far.
    at: u32,
    /// The start of the closing tag.
    end: u32,
    children: super::ListIter<'a, Expr<'a>>,
    /// The child that follows the whitespace just returned.
    pending: Option<Expr<'a>>,
}

impl<'a> Iterator for JsxChildren<'a> {
    type Item = JsxChild<'a>;

    fn next(&mut self) -> Option<JsxChild<'a>> {
        if let Some(child) = self.pending.take() {
            return Some(JsxChild::Expr(child));
        }
        let Some(child) = self.children.next() else {
            let rest = Span::new(self.at, self.end);
            self.at = self.end;
            return (!rest.is_empty()).then_some(JsxChild::Whitespace(rest));
        };
        let span = child.jsx_container_span().unwrap_or_else(|| child.span());
        let before = Span::before(self.at, span);
        self.at = span.end;
        if before.is_empty() {
            return Some(JsxChild::Expr(child));
        }
        self.pending = Some(child);
        Some(JsxChild::Whitespace(before))
    }
}

/// `<tag attrs>children</tag>`, `<tag attrs />`, `<>children</>`
#[derive(Copy, Clone)]
pub struct Jsx<'a> {
    file: &'a File<'a>,
    id: hir::JsxId,
    expr: Expr<'a>,
}

impl std::fmt::Debug for Jsx<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Jsx({})", self.id.0)
    }
}

impl<'a> Jsx<'a> {
    #[inline]
    fn new(file: &'a File<'a>, id: hir::JsxId, expr: Expr<'a>) -> Self {
        Jsx { file, id, expr }
    }

    #[inline]
    fn raw(self) -> Option<&'a hir::Jsx> {
        self.file.hir.jsx.get(self.id.idx())
    }

    /// The name in the opening tag: an `Ident`, a `Dot`, `This`, or a `String` for `a-b` and
    /// `a:b`. `None` for a fragment.
    #[inline]
    pub fn tag(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw()?.tag)
    }

    /// The name in the closing tag.
    #[inline]
    pub fn close_tag(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw()?.close_tag)
    }

    #[inline]
    pub fn is_fragment(self) -> bool {
        self.tag().is_none()
    }

    #[inline]
    pub fn is_self_closing(self) -> bool {
        self.raw().is_some_and(|jsx| jsx.close_pos == u32::MAX)
    }

    /// `name="value"`, `name={value}`, `name`, `{...value}`
    #[inline]
    pub fn attrs(self) -> List<'a, Prop<'a>> {
        match self.raw() {
            Some(jsx) => List::run(self.file, jsx.attrs),
            None => List::empty(self.file),
        }
    }

    /// Text is a `String` ([`Expr::is_jsx_text`]). A child in braces has a [`Expr::jsx_container_span`]: `{}` is
    /// `Missing`, `{...e}` is a `Spread`.
    ///
    /// Whitespace-only text containing a line break is insignificant and is skipped. See
    /// [`Jsx::children_with_whitespace`].
    #[inline]
    pub fn children(self) -> List<'a, Expr<'a>> {
        match self.raw() {
            Some(jsx) => List::ids(self.file, jsx.children),
            None => List::empty(self.file),
        }
    }

    /// The children plus the whitespace between them that [`Jsx::children`] skips. Together they're ESLint's
    /// `children`.
    pub fn children_with_whitespace(self) -> JsxChildren<'a> {
        let at = self.opening_span().end;
        JsxChildren {
            at,
            end: self.closing_span().map_or(at, |it| it.start),
            children: self.children().iter(),
            pending: None,
        }
    }

    #[inline]
    pub fn type_args(self) -> List<'a, TypeNode<'a>> {
        match self.raw() {
            Some(jsx) => List::ids(self.file, jsx.type_args),
            None => List::empty(self.file),
        }
    }

    /// `<tag attrs>`, `<tag attrs />`, `<>`
    pub fn opening_span(self) -> Span {
        let end = self.raw().map_or(0, |jsx| jsx.opening_end);
        Span::new(self.expr.span().start, end)
    }

    /// `</tag>`, `</>`
    #[inline]
    pub fn closing_span(self) -> Option<Span> {
        let jsx = self.raw()?;
        (jsx.close_pos != u32::MAX).then(|| Span::new(jsx.close_pos, jsx.end))
    }
}

/// [`Expr::jsx_text_value`] for the given `source_text`.
pub(crate) fn jsx_text_value_of(source_text: &[u8], is_espree: bool) -> std::borrow::Cow<'_, [u8]> {
    use bun_core::strings;
    if !is_espree || !strings::contains(source_text, b"\r\n") {
        return super::entities::unescape(source_text, is_espree);
    }
    let mut normalized = Vec::with_capacity(source_text.len());
    for (at, line) in strings::split(source_text, b"\r\n").enumerate() {
        if at > 0 {
            normalized.push(b'\n');
        }
        normalized.extend_from_slice(line);
    }
    let value = super::entities::unescape(&normalized, is_espree);
    value.into_owned().into()
}
