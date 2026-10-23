use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::oxlint::is_global_by_name;
use bun_lint::utils::visible::{is_global, visible_value};

/// Disallow unnecessary boolean casts.
pub struct NoExtraBooleanCast {
    enforce_for_logical_operands: bool,
    enforce_for_inner_expressions: bool,
}

const UNEXPECTED_CALL: Message = Message::new("unexpectedCall", "Redundant Boolean call.");
const UNEXPECTED_NEGATION: Message =
    Message::new("unexpectedNegation", "Redundant double negation.");

/// True if the callee is the global `Boolean`.
fn calls_boolean(call: Call) -> bool {
    call.callee().is_ident("Boolean") && is_global_by_name(call.callee())
}

fn is_sequence(e: Expr) -> bool {
    e.binary_op() == Some(BinOp::Comma)
}

/// ESLint's `isInBooleanContext`. `parent` is `e`'s parent.
fn is_in_boolean_context<'a>(e: Expr<'a>, parent: Node<'a>) -> bool {
    match parent {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Call(call) | ExprKind::New(call) => {
                call.args().first() == Some(e) && calls_boolean(call)
            }
            ExprKind::Cond { test, .. } => test == e,
            ExprKind::Unary { op, .. } => op == UnOp::Not,
            _ => false,
        },
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::If { test, .. }
            | StmtKind::While { test, .. }
            | StmtKind::DoWhile { test, .. } => test == e,
            StmtKind::For { test, .. } => test == Some(e),
            _ => false,
        },
        _ => false,
    }
}

/// ESLint's `needsParens`: true if `node` needs parentheses where it replaces `previous`.
fn needs_parens<'a>(previous: Expr<'a>, node: Expr<'a>) -> bool {
    if previous.is_parenthesized() {
        return false;
    }
    let Node::Expr(parent) = utils::estree_parent(Node::Expr(previous)) else {
        return false;
    };
    let precedence = ast_utils::get_precedence;
    match parent.kind() {
        ExprKind::Call(_) | ExprKind::New(_) => is_sequence(node),
        ExprKind::Cond { test, .. } if test == previous => precedence(node) <= precedence(parent),
        // 1 is the precedence of an `AssignmentExpression`.
        ExprKind::Cond { .. } => precedence(node) < 1,
        ExprKind::Unary { .. } => precedence(node) < precedence(parent),
        ExprKind::Binary { op: BinOp::Comma, .. } => false,
        ExprKind::Binary { left, .. } => {
            ast_utils::is_mixed_logical_and_coalesce_expressions(node, parent)
                || match previous == left {
                    true => precedence(node) < precedence(parent),
                    false => precedence(node) <= precedence(parent),
                }
        }
        _ => false,
    }
}

/// oxlint doesn't check for comments.
fn has_comments_inside(e: Expr) -> bool {
    !e.file().language().is_oxlint && e.file().comments_in(e).next().is_some()
}

/// Returns a space if `replacement` can't directly follow the token that `replaced` directly follows.
fn prefix<'a>(replaced: Expr<'a>, replacement: ast_utils::TokenOrText<'a>) -> &'static [u8] {
    match replaced.file().token_before(replaced) {
        Some(before)
            if before.end() == replaced.span().start
                && !ast_utils::can_tokens_be_adjacent(before, replacement) =>
        {
            b" "
        }
        _ => b"",
    }
}

/// Returns the function that `callee` always refers to: a function declaration, or a variable that is initialized with
/// a function and never reassigned.
fn visible_function(callee: Expr<'_>) -> Option<Func<'_>> {
    match callee.symbol()?.declarations().next()? {
        Declaration::Fn(func) => Some(func),
        _ => visible_value(callee).as_fn(),
    }
}

/// True for `new Promise(..)` or a call to an `async` function.
fn is_visibly_promise(e: Expr) -> bool {
    match e.kind() {
        ExprKind::New(call) => is_global(call.callee(), "Promise"),
        ExprKind::Call(call) => visible_function(call.callee()).is_some_and(|it| it.is_async() && !it.is_generator()),
        _ => false,
    }
}

/// True if TypeScript would reject `argument` in place of `cast`, which is `!!argument` or `Boolean(argument)`.
/// TypeScript reports `if (a)`, `a ? b : c` and `a && b` when `a` is always a function (TS2774), a promise (TS2801) or
/// an enum member (TS2845), and a cast is how people silence that. Deciding what `a` is needs type information, so this
/// only returns `true` when the file's syntax shows that it's one of these.
fn is_rejected_by_typescript<'a>(cast: Expr<'a>, argument: Expr<'a>) -> bool {
    let is_checked = match utils::estree_parent(Node::Expr(cast)) {
        Node::Stmt(parent) => parent.tag() == StmtTag::If,
        Node::Expr(parent) => matches!(parent.tag(), ExprTag::Cond | ExprTag::Binary),
        _ => false,
    };
    if !is_checked || cast.file().is_javascript() {
        return false;
    }
    let is_called = |it: Reference<'a>| {
        it.expr().is_some_and(|e| matches!(e.parent(), Node::Expr(parent) if parent.as_call().is_some_and(|it| it.callee() == e)))
    };
    let declaration_of = |e: Expr<'a>| e.symbol().and_then(|it| it.declarations().next());
    match argument.kind() {
        ExprKind::Ident(_) => match declaration_of(argument) {
            Some(Declaration::ImportDefault(_) | Declaration::ImportSpec(_)) => {
                argument.symbol().is_some_and(|it| it.references().any(is_called))
            }
            _ => visible_function(argument).is_some() || is_visibly_promise(visible_value(argument)),
        },
        ExprKind::Dot { obj, .. } => matches!(declaration_of(obj), Some(Declaration::Enum(_))),
        _ => is_visibly_promise(argument),
    }
}

impl NoExtraBooleanCast {
    /// ESLint's `isInFlaggedContext`.
    fn is_in_flagged_context<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) -> bool {
        // oxlint treats the two options as one.
        let is_oxlint = cx.language().is_oxlint;
        let inner = self.enforce_for_inner_expressions || self.enforce_for_logical_operands && is_oxlint;
        let logical = inner || self.enforce_for_logical_operands;
        let is_flagged = cx.state.find(Node::Expr(e), |child, parent| {
            let e = child.as_expr()?;
            let is_passed_on = match parent.as_expr().map(Expr::kind) {
                Some(ExprKind::Binary { op: BinOp::Or | BinOp::And, .. }) => logical,
                Some(ExprKind::Binary { op: BinOp::Nullish, right, .. }) => inner && right == e,
                // In a sequence, only the last expression counts.
                Some(ExprKind::Binary { op: BinOp::Comma, right, .. }) => {
                    if !(inner && right == e && parent.as_expr().is_some_and(utils::is_sequence_root)) {
                        return Some(false);
                    }
                    true
                }
                Some(ExprKind::Cond { yes, no, .. }) => inner && (yes == e || no == e),
                _ => false,
            };
            (!is_passed_on).then(|| is_in_boolean_context(e, utils::estree_parent(child)))
        });
        is_flagged == Some(true)
    }

    /// `e` is `!!argument`.
    fn check_negation<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_negation = |it: &Expr| it.unary_op() == Some(UnOp::Not);
        let operand = Some(e).filter(is_negation).and_then(Expr::operand);
        let Some(argument) = operand.filter(is_negation).and_then(Expr::operand) else {
            return;
        };
        if !self.is_in_flagged_context(e, cx) {
            return;
        }
        cx.report(e, UNEXPECTED_NEGATION).fix_where_safe(|| !is_rejected_by_typescript(e, argument), |fixer| {
            if has_comments_inside(e) {
                return None;
            }
            if needs_parens(e, argument) {
                return Some(fixer.replace(e, [&b"("[..], argument.text(), b")"].concat()));
            }
            let first = fixer.file().first_token(argument)?;
            Some(fixer.replace(e, [prefix(e, first.into()), argument.text()].concat()))
        });
    }

    /// `e` is `Boolean(..)`.
    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        if !call.callee().is_ident("Boolean") || !self.is_in_flagged_context(e, cx) || !calls_boolean(call) {
            return;
        }
        let is_safe = || !call.args().first().is_some_and(|argument| is_rejected_by_typescript(e, argument));
        cx.report(e, UNEXPECTED_CALL).fix_where_safe(is_safe, |fixer| {
            let mut args = call.args().iter();
            let (Some(argument), None) = (args.next(), args.next()) else {
                if !call.args().is_empty() {
                    return None;
                }
                // `!Boolean()` is `true`. The parent of `Boolean?.()` is a `ChainExpression`.
                if !call.is_optional()
                    && let Node::Expr(parent) = e.parent()
                    && parent.unary_op() == Some(UnOp::Not)
                {
                    if has_comments_inside(parent) {
                        return None;
                    }
                    return Some(fixer.replace(parent, [prefix(parent, "true".into()), b"true"].concat()));
                }
                if has_comments_inside(e) {
                    return None;
                }
                return Some(fixer.replace(e, "false"));
            };
            if argument.tag() == ExprTag::Spread || has_comments_inside(e) {
                return None;
            }
            Some(match needs_parens(e, argument) {
                true => fixer.replace(e, [&b"("[..], argument.text(), b")"].concat()),
                false => fixer.replace(e, argument.text()),
            })
        });
    }
}

impl Rule for NoExtraBooleanCast {
    const META: Meta = Meta::eslint("no-extra-boolean-cast", Kind::Suggestion)
        .fixable(Fixable::Code)
        .recommended();
    const ON: On = On::new().unaries(&[UnOp::Not]).function_calls(&["Boolean"]);
    /// Caches whether an expression is in a flagged context.
    type State<'a> = AncestorMemo<'a, bool>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoExtraBooleanCast {
            enforce_for_logical_operands: options.bool_or("enforceForLogicalOperands", false),
            enforce_for_inner_expressions: options.bool_or("enforceForInnerExpressions", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().unaries(&[UnOp::Not]);
        if file.mentions("Boolean") {
            on = on.function_calls(&["Boolean"]);
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check_call(e, cx);
    }

    fn unary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check_negation(e, cx);
    }
}
