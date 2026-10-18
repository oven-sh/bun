use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow use of optional chaining in contexts where the `undefined` value is not allowed.
pub struct NoUnsafeOptionalChaining {
    disallow_arithmetic_operators: bool,
}

const UNSAFE_OPTIONAL_CHAIN: Message = Message::new(
    "unsafeOptionalChain",
    "Unsafe usage of optional chaining. If it short-circuits with 'undefined' the evaluation will throw TypeError.",
);
const UNSAFE_ARITHMETIC: Message = Message::new(
    "unsafeArithmetic",
    "Unsafe arithmetic operation on optional chaining. It can result in NaN.",
);

/// What becomes of the value of an expression.
#[derive(Copy, Clone)]
pub enum Outcome {
    /// `undefined` throws a `TypeError`.
    Unsafe,
    /// `undefined` makes `NaN`.
    Arithmetic,
    Safe,
}

fn is_arithmetic(op: BinOp) -> bool {
    matches!(op, BinOp::Add | BinOp::Sub | BinOp::Div | BinOp::Mul | BinOp::Rem | BinOp::Pow)
}

fn is_destructuring_pattern(pattern: Pat) -> bool {
    matches!(pattern.tag(), PatTag::Object | PatTag::Array)
}

/// Upstream goes down from each of these places to the optional chains. This is the way up.
///
/// oxlint 1.87 sees through what only concerns types, as in `(a?.b as T).c` and `(a?.b)!.c`. It says nothing about a
/// spread among arguments, about the default value of a parameter and about `#a in b?.c`.
///
/// `None`: it is the value of the parent, or can be.
fn usage_of(e: Expr<'_>, is_oxlint: bool) -> Option<Outcome> {
    let unsafe_if = |is_unsafe: bool| Some(if is_unsafe { Outcome::Unsafe } else { Outcome::Safe });
    match e.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Binary { op, left, right } => match op {
                BinOp::And => None,
                BinOp::Or | BinOp::Nullish | BinOp::Comma if right == e => None,
                BinOp::In if is_oxlint && left.tag() == ExprTag::PrivateIdentifier => Some(Outcome::Safe),
                BinOp::In | BinOp::Instanceof => unsafe_if(right == e),
                _ if is_arithmetic(op) => Some(Outcome::Arithmetic),
                _ => Some(Outcome::Safe),
            },
            ExprKind::Cond { test, .. } if test != e => None,
            ExprKind::Await(_) => None,
            ExprKind::As { .. }
            | ExprKind::AsConst(_)
            | ExprKind::Satisfies { .. }
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
                if is_oxlint =>
            {
                None
            }
            // Also the default value of a pattern in the target of an assignment.
            ExprKind::Assign { op, target, value } if value == e => match op {
                None => unsafe_if(matches!(target.tag(), ExprTag::Object | ExprTag::Array)),
                Some(op) if is_arithmetic(op) => Some(Outcome::Arithmetic),
                Some(_) => Some(Outcome::Safe),
            },
            ExprKind::Call(call) => unsafe_if(call.callee() == e && !call.is_optional()),
            ExprKind::New(call) | ExprKind::TaggedTemplate(call) => unsafe_if(call.callee() == e),
            ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
                unsafe_if(obj == e && chain != Chain::Start)
            }
            // In an array or among arguments, not among the children of a JSX element.
            ExprKind::Spread(_) if is_oxlint => {
                unsafe_if(matches!(parent.parent(), Node::Expr(list) if list.tag() == ExprTag::Array))
            }
            ExprKind::Spread(_) => unsafe_if(parent.jsx_container_span().is_none()),
            ExprKind::Unary { op: UnOp::Plus | UnOp::Minus, .. } => Some(Outcome::Arithmetic),
            _ => Some(Outcome::Safe),
        },
        Node::Class(class) => unsafe_if(class.extends() == Some(e)),
        Node::VarDecl(declaration) => unsafe_if(is_destructuring_pattern(declaration.pat())),
        Node::Param(param) => {
            unsafe_if(!is_oxlint && param.default() == Some(e) && is_destructuring_pattern(param.pat()))
        }
        Node::PatProp(property) => {
            unsafe_if(property.default() == Some(e) && is_destructuring_pattern(property.value()))
        }
        Node::PatElem(element) => unsafe_if(element.pat().is_some_and(is_destructuring_pattern)),
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::ForOf { expr, .. } => unsafe_if(expr == e),
            StmtKind::With { object, .. } => unsafe_if(object == e),
            _ => Some(Outcome::Safe),
        },
        _ => Some(Outcome::Safe),
    }
}

impl NoUnsafeOptionalChaining {
    /// `chain` is the whole of an optional chain.
    #[inline(never)]
    fn check<'a>(&self, chain: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let outcome = cx.state.find(chain.into(), |child, _| child.as_expr().and_then(|it| usage_of(it, is_oxlint)));
        match outcome.unwrap_or(Outcome::Safe) {
            Outcome::Unsafe => {
                cx.report(chain, UNSAFE_OPTIONAL_CHAIN);
            }
            Outcome::Arithmetic if self.disallow_arithmetic_operators => {
                cx.report(chain, UNSAFE_ARITHMETIC);
            }
            Outcome::Arithmetic | Outcome::Safe => {}
        }
    }
}

impl Rule for NoUnsafeOptionalChaining {
    const META: Meta = Meta::eslint("no-unsafe-optional-chaining", Kind::Problem).recommended();
    const ON: On = On::new().optional_chains().exprs(&[ExprTag::NonNull]);
    type State<'a> = AncestorMemo<'a, Outcome>;

    fn new(options: &Options) -> Self {
        NoUnsafeOptionalChaining {
            disallow_arithmetic_operators: options.object(0).bool_or("disallowArithmeticOperators", false),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn expr<'a>(&self, chain: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if chain.is_chain_root() {
            self.check(chain, cx);
        }
    }

    fn optional_chain<'a>(&self, chain: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if chain.is_chain_root() {
            self.check(chain, cx);
        }
    }
}
