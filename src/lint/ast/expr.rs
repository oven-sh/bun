//! Expressions.

use super::{Class, File, Func, Ident, List, Name, Node, Prop, TypeNode, handle};
use crate::span::Span;
use crate::tokens::{skip_trivia, skip_trivia_back};
use bun_sema::hir::{self, BinOp, Chain, ExprTag, UnOp};

handle! {
    /// An expression. Parentheses around it are not part of it.
    Expr, ExprId, exprs, Expr
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
    /// Its value. In JSX also the text between elements, and a tag name such as `a-b` or `a:b`.
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
    /// `expr!`
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
        let file = self.file;
        let e = |id| Expr::new(file, id);
        let Some(raw) = self.try_raw() else {
            return ExprKind::Missing;
        };
        match raw.kind {
            hir::ExprKind::Missing => ExprKind::Missing,
            hir::ExprKind::Ident(name) => ExprKind::Ident(file.name(name)),
            hir::ExprKind::PrivateIdentifier(name) => ExprKind::PrivateIdentifier(file.name(name)),
            hir::ExprKind::This => ExprKind::This,
            hir::ExprKind::Super => ExprKind::Super,
            hir::ExprKind::Null => ExprKind::Null,
            hir::ExprKind::True => ExprKind::True,
            hir::ExprKind::False => ExprKind::False,
            hir::ExprKind::Number(at) => {
                ExprKind::Number(file.hir.numbers.get(at as usize).copied().unwrap_or(f64::NAN))
            }
            hir::ExprKind::String(text) => ExprKind::String(file.name(text)),
            hir::ExprKind::BigInt(text) => ExprKind::BigInt(file.name(text)),
            hir::ExprKind::Regex => ExprKind::Regex(Regex { expr: self }),
            hir::ExprKind::Template { exprs } => ExprKind::Template(Template { expr: self, exprs }),
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
            } => ExprKind::Dot {
                obj: e(obj),
                name: file.ident(name, name_pos),
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
            hir::ExprKind::Cond { test, yes, no } => ExprKind::Cond {
                test: e(test),
                yes: e(yes),
                no: e(no),
            },
            hir::ExprKind::Spread(operand) => ExprKind::Spread(e(operand)),
            hir::ExprKind::Await(operand) => ExprKind::Await(e(operand)),
            hir::ExprKind::Yield { value, star } => ExprKind::Yield {
                value: Expr::some(file, value),
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

    /// The kind without what it holds. This is what a rule listens for.
    #[inline]
    pub fn tag(self) -> ExprTag {
        self.try_raw().map_or(ExprTag::Missing, |raw| raw.kind.tag())
    }

    /// Without the parentheses around it.
    #[inline]
    pub fn span(self) -> Span {
        match self.try_raw() {
            // Its decorators are part of it.
            Some(&hir::Expr {
                kind: hir::ExprKind::Class(c),
                end,
                ..
            }) => Span::new(Class::new(self.file, c).start(), end),
            Some(raw) => Span::new(raw.pos, raw.end),
            None => Span::default(),
        }
    }

    /// The parentheses around it, the innermost first.
    pub fn parens(self) -> impl DoubleEndedIterator<Item = Span> + ExactSizeIterator + 'a {
        let parens = self.file.hir.parens;
        let first = parens.partition_point(|p| p.0.0 < self.id.0);
        let count = parens[first..].partition_point(|p| p.0 == self.id);
        parens[first..first + count]
            .iter()
            .map(|p| Span::new(p.1, p.2))
    }

    #[inline]
    pub fn is_parenthesized(self) -> bool {
        self.parens().len() != 0
    }

    /// With all the parentheses around it.
    #[inline]
    pub fn outer_span(self) -> Span {
        self.parens().next_back().unwrap_or_else(|| self.span())
    }

    /// What it is directly part of.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::Expr(self).parent()
    }

    #[inline]
    pub fn is_missing(self) -> bool {
        self.tag() == ExprTag::Missing
    }

    /// The name, if it is an identifier.
    #[inline]
    pub fn as_ident(self) -> Option<Name<'a>> {
        match self.kind() {
            ExprKind::Ident(name) => Some(name),
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
        match self.kind() {
            ExprKind::String(value) => Some(value),
            _ => None,
        }
    }

    #[inline]
    pub fn as_call(self) -> Option<Call<'a>> {
        match self.kind() {
            ExprKind::Call(call) => Some(call),
            _ => None,
        }
    }

    #[inline]
    pub fn as_fn(self) -> Option<Func<'a>> {
        match self.kind() {
            ExprKind::Fn(func) => Some(func),
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
    pub fn is_optional(self) -> bool {
        self.chain() == Chain::Start
    }

    /// Its place in an optional chain.
    pub fn chain(self) -> Chain {
        match self.kind() {
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain,
            ExprKind::Call(call) => call.chain(),
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

    /// The braces of the `{e}` in JSX whose entire content it is.
    pub fn jsx_container_span(self) -> Option<Span> {
        let braces = self.file.hir.jsx_expressions;
        let at = braces.binary_search_by_key(&self.id.0, |it| it.0.0).ok()?;
        Some(Span::new(braces[at].1, braces[at].2))
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
    pub fn cooked(self, i: usize) -> Option<Name<'a>> {
        let file = self.expr.file;
        let at = self.exprs.start as usize + self.exprs.len() + i;
        if i >= self.quasi_count() {
            return None;
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
        let end = match self.exprs().get(i) {
            Some(after) => skip_trivia_back(text, after.outer_span().start),
            None => whole.end,
        };
        Span::new(start, end)
    }

    /// The piece of text at `i` as it is written, without its delimiters.
    pub fn raw(self, i: usize) -> &'a [u8] {
        let is_last = i + 1 == self.quasi_count();
        let span = self.quasi_span(i).shrink(1, if is_last { 1 } else { 2 });
        self.expr.file.slice(span)
    }

    /// The value, if there are no substitutions.
    pub fn as_static(self) -> Option<Name<'a>> {
        self.exprs.is_empty().then(|| self.cooked(0)).flatten()
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

    /// Text is a `String`. What is in braces has a [`Expr::jsx_container_span`], and `{}` is
    /// `Missing`.
    #[inline]
    pub fn children(self) -> List<'a, Expr<'a>> {
        match self.raw() {
            Some(jsx) => List::ids(self.file, jsx.children),
            None => List::empty(self.file),
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
    pub fn closing_span(self) -> Option<Span> {
        let jsx = self.raw()?;
        (jsx.close_pos != u32::MAX).then(|| Span::new(jsx.close_pos, jsx.end))
    }
}
