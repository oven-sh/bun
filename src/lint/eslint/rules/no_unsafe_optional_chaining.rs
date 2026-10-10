use bun_lint::prelude::*;
use rustc_hash::FxHashMap;

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
enum Usage<'a> {
    /// It is the value of this expression, or can be.
    ValueOf(Expr<'a>),
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
fn usage_of(e: Expr<'_>, is_oxlint: bool) -> Usage<'_> {
    let unsafe_if = |is_unsafe: bool| if is_unsafe { Usage::Unsafe } else { Usage::Safe };
    match e.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Binary { op, left, right } => match op {
                BinOp::And => Usage::ValueOf(parent),
                BinOp::Or | BinOp::Nullish | BinOp::Comma if right == e => Usage::ValueOf(parent),
                BinOp::In if is_oxlint && left.tag() == ExprTag::PrivateIdentifier => Usage::Safe,
                BinOp::In | BinOp::Instanceof => unsafe_if(right == e),
                _ if is_arithmetic(op) => Usage::Arithmetic,
                _ => Usage::Safe,
            },
            ExprKind::Cond { test, .. } if test != e => Usage::ValueOf(parent),
            ExprKind::Await(_) => Usage::ValueOf(parent),
            ExprKind::As { .. }
            | ExprKind::AsConst(_)
            | ExprKind::Satisfies { .. }
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
                if is_oxlint =>
            {
                Usage::ValueOf(parent)
            }
            // Also the default value of a pattern in the target of an assignment.
            ExprKind::Assign { op, target, value } if value == e => match op {
                None => unsafe_if(matches!(target.tag(), ExprTag::Object | ExprTag::Array)),
                Some(op) if is_arithmetic(op) => Usage::Arithmetic,
                Some(_) => Usage::Safe,
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
            ExprKind::Unary { op: UnOp::Plus | UnOp::Minus, .. } => Usage::Arithmetic,
            _ => Usage::Safe,
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
            _ => Usage::Safe,
        },
        _ => Usage::Safe,
    }
}

/// What becomes of the value of an expression in the end.
#[derive(Copy, Clone)]
pub enum Outcome {
    Unsafe,
    Arithmetic,
    Safe,
}

type State<'a> = FxHashMap<Expr<'a>, Outcome>;

/// How far up the way is before it is remembered. Otherwise every operand of a long `a?.b && c?.d && ..` goes all of it.
const MANY_STEPS: u32 = 32;

fn outcome_of<'a>(chain: Expr<'a>, is_oxlint: bool, remembered: &mut State<'a>) -> Outcome {
    let (mut at, mut steps, mut far) = (chain, 0, None);
    let outcome = loop {
        if steps >= MANY_STEPS {
            if let Some(&known) = remembered.get(&at) {
                break known;
            }
            far.get_or_insert(at);
        }
        match usage_of(at, is_oxlint) {
            Usage::ValueOf(parent) => at = parent,
            Usage::Unsafe => break Outcome::Unsafe,
            Usage::Arithmetic => break Outcome::Arithmetic,
            Usage::Safe => break Outcome::Safe,
        }
        steps += 1;
    };
    while let Some(e) = far {
        remembered.insert(e, outcome);
        far = match usage_of(e, is_oxlint) {
            Usage::ValueOf(parent) if e != at => Some(parent),
            _ => None,
        };
    }
    outcome
}

impl NoUnsafeOptionalChaining {
    fn check<'a>(&self, chain: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !chain.is_chain_root() {
            return;
        }
        match outcome_of(chain, cx.language().is_oxlint, &mut cx.state) {
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
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoUnsafeOptionalChaining {
            disallow_arithmetic_operators: options.object(0).bool_or("disallowArithmeticOperators", false),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(FxHashMap::default())
    }

    fn expr<'a>(&self, chain: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(chain, cx);
    }

    fn optional_chain<'a>(&self, chain: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(chain, cx);
    }
}
