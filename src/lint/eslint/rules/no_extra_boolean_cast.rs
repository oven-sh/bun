use bun_lint::prelude::*;

/// Disallow unnecessary boolean casts.
pub struct NoExtraBooleanCast {
    enforce_for_logical_operands: bool,
    enforce_for_inner_expressions: bool,
}

const UNEXPECTED_CALL: Message = Message::new("unexpectedCall", "Redundant Boolean call.");
const UNEXPECTED_NEGATION: Message =
    Message::new("unexpectedNegation", "Redundant double negation.");

/// The callee is the global `Boolean`.
fn calls_boolean(call: Call) -> bool {
    call.callee().is_ident("Boolean") && ast_utils::is_global_reference(call.callee())
}

fn is_sequence(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Binary { op: BinOp::Comma, .. })
}

/// ESLint's `isInBooleanContext`. `parent`: the parent of `e`.
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

/// ESLint's `needsParens`: whether `node` needs parentheses where it replaces `previous`.
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
        // That of an `AssignmentExpression`.
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

fn has_comments_inside(e: Expr) -> bool {
    e.file().comments_in(e).next().is_some()
}

/// A space, if `replacement` cannot directly follow the token that `replaced` directly follows.
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

impl NoExtraBooleanCast {
    /// ESLint's `isInFlaggedContext`.
    fn is_in_flagged_context(&self, mut e: Expr) -> bool {
        let inner = self.enforce_for_inner_expressions;
        let logical = inner || self.enforce_for_logical_operands;
        loop {
            let parent = utils::estree_parent(Node::Expr(e));
            let is_passed_on = match parent {
                Node::Expr(parent) => match parent.kind() {
                    ExprKind::Binary { op: BinOp::Or | BinOp::And, .. } => logical,
                    // Of a sequence it is the last expression.
                    ExprKind::Binary { op: BinOp::Nullish | BinOp::Comma, right, .. } => {
                        inner && right == e
                    }
                    ExprKind::Cond { yes, no, .. } => inner && (yes == e || no == e),
                    _ => false,
                },
                _ => false,
            };
            match parent {
                Node::Expr(parent) if is_passed_on => e = parent,
                _ => return is_in_boolean_context(e, parent),
            }
        }
    }

    /// `e`: `!!argument`
    fn check_negation<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Unary { op: UnOp::Not, operand } = e.kind() else {
            return;
        };
        let ExprKind::Unary { op: UnOp::Not, operand: argument } = operand.kind() else {
            return;
        };
        if !self.is_in_flagged_context(e) {
            return;
        }
        cx.report(e, UNEXPECTED_NEGATION).fix(|fixer| {
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

    /// `e`: `Boolean(..)`
    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        if !call.callee().is_ident("Boolean") || !self.is_in_flagged_context(e) || !calls_boolean(call) {
            return;
        }
        cx.report(e, UNEXPECTED_CALL).fix(|fixer| {
            let mut args = call.args().iter();
            let (Some(argument), None) = (args.next(), args.next()) else {
                if !call.args().is_empty() {
                    return None;
                }
                // `!Boolean()` is `true`. The parent of `Boolean?.()` is a `ChainExpression`.
                if !call.is_optional()
                    && let Node::Expr(parent) = e.parent()
                    && matches!(parent.kind(), ExprKind::Unary { op: UnOp::Not, .. })
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
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoExtraBooleanCast {
            enforce_for_logical_operands: options.bool_or("enforceForLogicalOperands", false),
            enforce_for_inner_expressions: options.bool_or("enforceForInnerExpressions", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.unaries([UnOp::Not], Self::check_negation);
        if file.mentions("Boolean") {
            on.exprs([ExprTag::Call], Self::check_call);
        }
    }
}
