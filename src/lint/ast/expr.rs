//! Expressions.

use super::{Class, File, Func, Ident, List, Name, Node, Prop, TypeNode, handle};
use crate::span::Span;
use crate::tokens::skip_trivia;
use bun_sema::atom::Atom;
use bun_sema::hir::{self, BinOp, Chain, ExprTag, UnOp};
use smallvec::SmallVec;

handle! {
    /// An expression. Parentheses around it are not part of it.
    Expr, ExprId, exprs, Expr, |file: &File, id| file.written_expr(id)
}

#[derive(Copy, Clone, Debug)]
pub enum ExprKind<'a> {
    /// A hole in an array literal, the empty `{}` of JSX, or what is missing from `import()`.
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
    /// `"a"`, `'a'`: its value. In JSX also the value of an attribute, in which `&amp;` and the like
    /// are replaced and `\` means nothing, the text between elements ([`Expr::is_jsx_text`]), and a
    /// tag name such as `a-b` or `a:b`.
    String(Name<'a>),
    BigInt(Name<'a>),
    Regex(Regex<'a>),
    Template(Template<'a>),
    /// The tag is the callee, the substitutions are the arguments.
    TaggedTemplate(Call<'a>),
    /// A hole is `Missing`.
    Array(List<'a, Expr<'a>>),
    Object(List<'a, Prop<'a>>),
    /// A function expression or an arrow function. Also the value of a method or an accessor of
    /// an object literal.
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
    /// `expr as ty`, `<ty>expr`: [`Expr::is_angle_bracket_assertion`]
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
    /// `expr!`. Also `expr!!` and so on, which is one expression that ends with the last `!`: see
    /// [`Expr::inner_non_null_spans`]. `(expr!)!` is two.
    NonNull(Expr<'a>),
    /// `f<T>` that is not called.
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
    #[inline]
    pub fn kind(self) -> ExprKind<'a> {
        match self.try_raw() {
            None => ExprKind::Missing,
            Some(raw) if self.file.hides_casts => self.kind_without_casts(raw),
            Some(raw) => self.kind_of::<false>(raw),
        }
    }

    #[inline(never)]
    fn kind_without_casts(self, raw: &hir::Expr) -> ExprKind<'a> {
        self.kind_of::<true>(raw)
    }

    /// `HIDES_CASTS`: an operand can be a cast that is synthesized from a JSDoc comment. What few
    /// expressions need is not in here but in functions of its own, so that this one calls nothing.
    #[inline(always)]
    fn kind_of<const HIDES_CASTS: bool>(self, raw: &hir::Expr) -> ExprKind<'a> {
        let file = self.file;
        let e = |id| match HIDES_CASTS {
            true => Expr::new(file, id),
            false => Expr { file, id },
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
            hir::ExprKind::Number(at) => {
                ExprKind::Number(file.hir.numbers.get(at as usize).copied().unwrap_or(f64::NAN))
            }
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
                obj,
                name,
                name_pos,
                chain,
            } => match file.spells_private_names_apart() && file.hir.text.get(name_pos as usize) == Some(&b'#') {
                true => self.kind_of_private_member(obj, name, name_pos, chain),
                false => ExprKind::Dot {
                    obj: e(obj),
                    name: file.ident(name, name_pos),
                    chain,
                },
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
            hir::ExprKind::Cond { test, yes, no } => ExprKind::Cond {
                test: e(test),
                yes: e(yes),
                no: e(no),
            },
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
                type_args: List::ids(file, type_args),
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

    #[inline(never)]
    fn kind_of_private_member(self, obj: hir::ExprId, name: Atom, name_pos: u32, chain: Chain) -> ExprKind<'a> {
        ExprKind::Dot {
            obj: Expr::new(self.file, obj),
            name: self.file.ident(self.file.private_name(name).atom(), name_pos),
            chain,
        }
    }

    /// The kind of what the HIR has as the string `text` and is not plainly one.
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
        ExprKind::String(match super::entities::unescape(value.bytes()) {
            std::borrow::Cow::Borrowed(_) => value,
            std::borrow::Cow::Owned(decoded) => file.name(file.atoms.intern(&decoded)),
        })
    }

    /// The kind without what it holds. This is what a rule listens for.
    #[inline]
    pub fn tag(self) -> ExprTag {
        self.try_raw().map_or(ExprTag::Missing, |raw| self.file.expr_tag(self.id, raw))
    }

    /// It is text between the tags of a JSX element: ESLint's `JSXText`. Its kind is `String`, with
    /// the value that the text has at run time: without the whitespace around line breaks, and
    /// with what `&amp;` and the like stand for. [`Expr::text`] is the text as it is written.
    #[inline]
    pub fn is_jsx_text(self) -> bool {
        self.file.is_jsx_text(self.id)
    }

    /// ESLint's `value` of a `JSXText`: the text as it is written, all whitespace included, with
    /// what `&amp;` and the like stand for. `None` if it is not [JSX text](Expr::is_jsx_text).
    pub fn jsx_text_value(self) -> Option<std::borrow::Cow<'a, [u8]>> {
        self.is_jsx_text().then(|| super::entities::unescape(self.text()))
    }

    /// It is the name in a tag of a JSX element, or a part of it: the `a`, the `a.b` and the `a.b.c`
    /// of `<a.b.c>`. ESLint has a `JSXIdentifier`, a `JSXMemberExpression` or a `JSXNamespacedName`
    /// there, not an `Identifier` or a `MemberExpression`.
    pub fn is_jsx_tag_name(self) -> bool {
        if self.file.hir.jsx.is_empty() {
            return false;
        }
        let mut at = self;
        loop {
            let Node::Expr(parent) = at.parent() else {
                return false;
            };
            match parent.kind() {
                ExprKind::Dot { .. } => at = parent,
                ExprKind::Jsx(jsx) => return jsx.tag() == Some(at) || jsx.close_tag() == Some(at),
                _ => return false,
            }
        }
    }

    /// Without the parentheses around it.
    #[inline]
    pub fn span(self) -> Span {
        let file = self.file;
        let Some(raw) = self.try_raw() else {
            return Span::default();
        };
        let is_as_in_the_hir = match raw.kind {
            hir::ExprKind::Ident(_) | hir::ExprKind::Dot { .. } => file.has_no_unicode_escapes(),
            hir::ExprKind::Spread(_) | hir::ExprKind::String(_) => file.hir.jsx.is_empty(),
            hir::ExprKind::Class(_) | hir::ExprKind::Fn(_) => false,
            _ => true,
        };
        match is_as_in_the_hir {
            true => Span::new(raw.pos, raw.end),
            false => self.span_that_the_hir_may_not_have(),
        }
    }

    #[inline(never)]
    fn span_that_the_hir_may_not_have(self) -> Span {
        match self.try_raw() {
            // The HIR does not position the `...e` of the child `{...e}` of a JSX element.
            Some(&hir::Expr {
                kind: hir::ExprKind::Spread(_),
                pos,
                end,
            }) if self.file.hir.text.get(pos as usize) != Some(&b'.') => {
                let start = self.jsx_container_span().map_or(pos, |it| skip_trivia(self.file.hir.text, it.start + 1));
                Span::new(start, end)
            }
            Some(&hir::Expr {
                kind: hir::ExprKind::Ident(_),
                pos,
                end,
            }) => Span::new(pos, self.file.end_of_identifier(pos, end)),
            Some(&hir::Expr {
                kind: hir::ExprKind::Dot { name_pos, .. },
                pos,
                end,
            }) => Span::new(pos, self.file.end_of_identifier(name_pos, end)),
            // Its decorators are part of it.
            Some(&hir::Expr {
                kind: hir::ExprKind::Class(c),
                end,
                ..
            }) => Span::new(Class::new(self.file, c).start(), end),
            // The function of a method starts with its type parameters. The HIR has it start at
            // the `(`.
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
            // The HIR takes the `\"` at the end of the value of a JSX attribute for an escape.
            Some(&hir::Expr {
                kind: hir::ExprKind::String(_),
                pos,
                end,
            }) if !self.file.hir.jsx.is_empty()
                && !matches!(self.file.hir.text.get(pos as usize), Some(b'"' | b'\''))
                && self.file.is_jsx_attribute_string(self.id) =>
            {
                let text = self.file.hir.text;
                let quote = text.get(end.wrapping_sub(1) as usize).copied().unwrap_or(b'"');
                let before = text.get(..pos as usize).unwrap_or_default();
                let start = bun_core::strings::last_index_of_char(before, quote).map_or(pos, |it| it as u32);
                Span::new(start, end)
            }
            Some(raw) => Span::new(raw.pos, raw.end),
            None => Span::default(),
        }
    }

    /// The parentheses around it, the innermost first.
    pub fn parens(self) -> impl DoubleEndedIterator<Item = Span> + ExactSizeIterator + 'a {
        let parens = self.file.hir.parens;
        let mut all: SmallVec<[Span; 2]> = SmallVec::new();
        let mut id = self.id;
        loop {
            let first = parens.partition_point(|p| p.0.0 < id.0);
            let around = parens[first..].iter().take_while(|p| p.0 == id);
            all.extend(around.map(|p| Span::new(p.1, p.2)));
            // The HIR has those after a JSDoc cast around the cast.
            match self.file.jsdoc_cast_around(id) {
                Some(cast) => id = cast,
                None => return all.into_iter(),
            }
        }
    }

    #[inline]
    pub fn is_parenthesized(self) -> bool {
        self.file.is_parenthesized(self.id)
    }

    /// With all the parentheses around it.
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

    /// The name, if it is an identifier.
    #[inline]
    pub fn as_ident(self) -> Option<Name<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::Ident(name) => Some(self.file.name(name)),
            _ => None,
        }
    }

    /// Whether it is the identifier `name`.
    #[inline]
    pub fn is_ident(self, name: &str) -> bool {
        self.as_ident().is_some_and(|it| it.is(name))
    }

    /// The value, if it is a string literal.
    #[inline]
    pub fn as_string(self) -> Option<Name<'a>> {
        match self.try_raw()?.kind {
            hir::ExprKind::String(_) => match self.kind() {
                ExprKind::String(value) => Some(value),
                _ => None,
            },
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

    /// `<T>e` or `<const>e`, as opposed to `e as T`.
    pub fn is_angle_bracket_assertion(self) -> bool {
        match self.kind() {
            ExprKind::As { expr, .. } | ExprKind::AsConst(expr) => {
                self.span().start < expr.outer_span().start
            }
            _ => false,
        }
    }

    /// `a?.b`, `a?.[b]`, `a?.()`: the `?.` is in this expression itself.
    #[inline]
    pub fn is_optional(self) -> bool {
        self.chain() == Chain::Start
    }

    /// Its place in an optional chain.
    #[inline]
    pub fn chain(self) -> Chain {
        match self.try_raw().map(|raw| raw.kind) {
            Some(hir::ExprKind::Dot { chain, .. } | hir::ExprKind::Index { chain, .. }) => chain,
            Some(hir::ExprKind::Call(call)) => Call::new(self.file, call).chain(),
            _ => Chain::No,
        }
    }

    /// The operator of a `Unary`, a `Binary` or an `Assign`, where it is written.
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

    /// The braces of the `{e}` in JSX whose entire content it is. Those of `{...e}` belong to the
    /// `Spread`, those of `{}` to the `Missing`.
    pub fn jsx_container_span(self) -> Option<Span> {
        let braces = self.file.hir.jsx_expressions;
        let at = braces.binary_search_by_key(&self.id.0, |it| it.0.0).ok()?;
        Some(Span::new(braces[at].1, braces[at].2))
    }

    /// It is part of an optional chain: it is not evaluated if a `?.` to its left, or its own,
    /// finds `null` or `undefined`. In `a?.b.c!` that is `a?.b`, `a?.b.c` and `a?.b.c!`. In
    /// `(a?.b).c` it is only `a?.b`: parentheses end a chain.
    #[inline]
    pub fn is_in_optional_chain(self) -> bool {
        let mut at = self;
        while let Some(hir::Expr { kind: hir::ExprKind::NonNull(operand), .. }) = at.try_raw() {
            at = Expr::new(self.file, *operand);
            if at.is_parenthesized() {
                return false;
            }
        }
        at.chain() != Chain::No
    }

    /// It is the whole of an optional chain: where ESLint has a `ChainExpression`, with the same
    /// range, around the `MemberExpression`, the `CallExpression` or the `TSNonNullExpression`.
    #[inline]
    pub fn is_chain_root(self) -> bool {
        self.is_in_optional_chain() && self.ends_optional_chain()
    }

    /// Whether the optional chain that it is part of goes no further.
    fn ends_optional_chain(self) -> bool {
        let Node::Expr(parent) = self.parent() else {
            return true;
        };
        let continues = match parent.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj == self,
            ExprKind::Call(call) => call.callee() == self,
            ExprKind::NonNull(_) => true,
            _ => false,
        };
        !continues || self.is_parenthesized()
    }

    /// It is assigned to by destructuring, or is part of what is: the `[a, b]` of `[a, b] = c`, the
    /// `{ a }` of `for ({ a } of b)`, and in these the `a = 1` that is a default and the `...a`.
    /// Such an `Array`, `Object`, `Assign` or `Spread` is ESLint's `ArrayPattern`, `ObjectPattern`,
    /// `AssignmentPattern` or `RestElement`. Parentheses make what is in them an ordinary
    /// expression.
    pub fn is_assignment_target(self) -> bool {
        let mut at = self;
        loop {
            if at.is_parenthesized() {
                return false;
            }
            at = match at.parent() {
                Node::Expr(parent) => match parent.kind() {
                    ExprKind::Assign { target, .. } => return target == at,
                    ExprKind::Array(_) | ExprKind::Spread(_) => parent,
                    _ => return false,
                },
                Node::Prop(prop) if prop.value() == Some(at) && !prop.is_jsx_attribute() => match prop.parent() {
                    Node::Expr(object) => object,
                    _ => return false,
                },
                Node::Stmt(parent) => {
                    return match parent.kind() {
                        super::StmtKind::ForIn { left, .. } | super::StmtKind::ForOf { left, .. } => {
                            matches!(left.kind(), super::StmtKind::Expr(head) if head == at)
                        }
                        _ => false,
                    };
                }
                _ => return false,
            };
        }
    }

    /// It is the `a.b.c` of the type `typeof a.b.c`, or a part of it. ESLint has a
    /// `TSQualifiedName` there, not a `MemberExpression`.
    #[inline]
    pub fn is_in_type_query(self) -> bool {
        let operands = self.file.bound.type_query_operands;
        !operands.is_empty() && operands.binary_search(&self.id).is_ok()
    }

    /// `x!!!` is one `NonNull` of `x`. ESLint has a `TSNonNullExpression` for each `!`, one in the
    /// other. These are the ranges of those in this one, the innermost first: `x!`, `x!!`. The `!`
    /// of each is its last character. Empty for `x!`, as it almost always is, and for anything that
    /// is not a `NonNull`.
    pub fn inner_non_null_spans(self) -> impl DoubleEndedIterator<Item = Span> + ExactSizeIterator + 'a {
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

    /// The number of `!` of a `NonNull`: 2 for `x!!`. 0 for anything else.
    #[inline]
    pub fn non_null_count(self) -> usize {
        match self.tag() {
            ExprTag::NonNull => self.inner_non_null_spans().len() + 1,
            _ => 0,
        }
    }

    /// Without the syntax around it that only concerns types: `e as T`, `<T>e`, `e as const`,
    /// `e satisfies T`, `e!`. Parentheses are not nodes, so `(e as T)!` is `e` too.
    pub fn skip_type_wrappers(self) -> Expr<'a> {
        let mut at = self;
        loop {
            match at.kind() {
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr) => at = expr,
                _ => return at,
            }
        }
    }

    /// The `const` of `e as const` or `<const>e`, which ESLint has as a `TSTypeReference`.
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
    pub fn is_deferred_import_call(self) -> bool {
        let deferred = self.file.hir.deferred_import_calls;
        if deferred.is_empty() {
            return false;
        }
        match self.kind() {
            ExprKind::ImportCall { args } => {
                args.first().is_some_and(|first| deferred.iter().any(|it| it.0 == first.id))
            }
            _ => false,
        }
    }

    /// The operands of the comma operators: `a`, `b` and `c` of `a, b, c`, which ESLint has as
    /// the `expressions` of one `SequenceExpression`. `(a, b), c` is `(a, b)` and `c`. Anything
    /// else is itself.
    pub fn sequence(self) -> SmallVec<[Expr<'a>; 4]> {
        let mut items = SmallVec::new();
        let mut at = self;
        while let ExprKind::Binary {
            op: BinOp::Comma,
            left,
            right,
        } = at.kind()
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

impl File<'_> {
    /// The kind of the expression `id`, which is `raw`.
    #[inline]
    pub(super) fn expr_tag(&self, id: hir::ExprId, raw: &hir::Expr) -> ExprTag {
        match raw.kind {
            hir::ExprKind::String(_) if self.is_backtick_string(id, raw) => ExprTag::Template,
            kind => kind.tag(),
        }
    }

    /// Whether `id`, which is `raw` and a string in the HIR, is a template without substitutions.
    #[inline]
    fn is_backtick_string(&self, id: hir::ExprId, raw: &hir::Expr) -> bool {
        self.hir.text.get(raw.pos as usize) == Some(&b'`') && !self.is_jsx_text(id)
    }

    /// Whether the string `id` is the value of a JSX attribute, without braces.
    fn is_jsx_attribute_string(&self, id: hir::ExprId) -> bool {
        if self.hir.jsx.is_empty() {
            return false;
        }
        let Some(&bun_sema::bind::Parent::Prop(prop)) = self.bound.expr_parent.get(id.idx()) else {
            return false;
        };
        let is_attribute = |it: &hir::Prop| it.name_kind == hir::NameKind::Jsx && it.kind != hir::PropKind::Spread;
        self.hir.props.get(prop.idx()).is_some_and(is_attribute)
            && self.hir.jsx_expressions.binary_search_by_key(&id.0, |it| it.0.0).is_err()
    }

    fn is_jsx_text(&self, id: hir::ExprId) -> bool {
        if self.hir.jsx.is_empty()
            || !matches!(self.hir.exprs.get(id.idx()), Some(hir::Expr { kind: hir::ExprKind::String(_), .. }))
        {
            return false;
        }
        let Some(&bun_sema::bind::Parent::Expr(parent)) = self.bound.expr_parent.get(id.idx()) else {
            return false;
        };
        let Some(&hir::Expr { kind: hir::ExprKind::Jsx(jsx), .. }) = self.hir.exprs.get(parent.idx()) else {
            return false;
        };
        let is_name = self.hir.jsx.get(jsx.idx()).is_some_and(|it| it.tag == id || it.close_tag == id);
        !is_name && self.hir.jsx_expressions.binary_search_by_key(&id.0, |it| it.0.0).is_err()
    }
}

/// The operator as it is written.
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

/// The operator as it is written.
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

    /// As it is written between the slashes.
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
    /// The text of a template without substitutions, which the HIR has as a string.
    only_text: Option<bun_sema::atom::Atom>,
}

impl<'a> Template<'a> {
    /// The substitutions.
    #[inline]
    pub fn exprs(self) -> List<'a, Expr<'a>> {
        List::ids(self.expr.file, self.exprs)
    }

    /// The number of pieces of text: one more than there are substitutions.
    #[inline]
    pub fn quasi_count(self) -> usize {
        self.exprs.len() + 1
    }

    /// The value of the piece of text at `i`. `None` if it has an invalid escape, which a tagged
    /// template allows.
    #[inline]
    pub fn cooked(self, i: usize) -> Option<Name<'a>> {
        self.text_of_scanner(i).filter(|_| !has_invalid_escape(self.raw(i)))
    }

    /// The same, where TypeScript's scanner leaves an invalid escape as it is written.
    pub(crate) fn text_of_scanner(self, i: usize) -> Option<Name<'a>> {
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

    /// The piece of text at `i` with its delimiters: `` `a${ ``, `}b${`, `` }c` ``.
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

    /// The piece of text at `i` as it is written, without its delimiters.
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

/// Whether the text `raw` of a template has an escape that is not one: `\u` and `\x` without their
/// digits, `\1` to `\9`, `\0` before a digit.
fn has_invalid_escape(raw: &[u8]) -> bool {
    let is_hex = |bytes: Option<&[u8]>| bytes.is_some_and(|it| !it.is_empty() && it.iter().all(u8::is_ascii_hexdigit));
    let mut rest = raw;
    while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'\\') {
        let after = rest.get(at + 2..).unwrap_or_default();
        let is_valid = match rest.get(at + 1) {
            Some(b'x') => is_hex(after.get(..2)),
            Some(b'u') if after.first() == Some(&b'{') => {
                let digits = bun_core::strings::index_of_char_usize(after, b'}').and_then(|end| after.get(1..end));
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

/// From `at`, which is inside the text of a template: the position after the next `${`.
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
    pub fn id(self) -> hir::CallId {
        self.id
    }

    #[inline]
    pub fn callee(self) -> Expr<'a> {
        Expr::new(self.file, self.raw().map_or(hir::ExprId::NONE, |c| c.callee))
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
            Some(call) => List::ids(self.file, call.type_args),
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
        Expr::some(self.file, self.raw()?.template)
    }
}

/// What is between the tags of a JSX element.
#[derive(Copy, Clone, Debug)]
pub enum JsxChild<'a> {
    Expr(Expr<'a>),
    /// Whitespace with a line break in it. ESLint has it as a `JSXText`.
    Whitespace(Span),
}

/// See [`Jsx::children_with_whitespace`].
#[derive(Copy, Clone)]
pub struct JsxChildren<'a> {
    /// Where what has been returned ends.
    at: u32,
    /// Where the closing tag starts.
    end: u32,
    children: super::ListIter<'a, Expr<'a>>,
    /// The child after the whitespace that has been returned.
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
        let before = Span::new(self.at, span.start);
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

    /// Text is a `String` ([`Expr::is_jsx_text`]). What is in braces has a
    /// [`Expr::jsx_container_span`]: `{}` is `Missing`, `{...e}` is a `Spread`.
    ///
    /// Text that is only whitespace and has a line break in it means nothing, and is left out. See
    /// [`Jsx::children_with_whitespace`].
    #[inline]
    pub fn children(self) -> List<'a, Expr<'a>> {
        match self.raw() {
            Some(jsx) => List::ids(self.file, jsx.children),
            None => List::empty(self.file),
        }
    }

    /// The children, and the whitespace between them that is not among [`Jsx::children`]: all that
    /// ESLint has as `children`.
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
