use bun_lint::prelude::*;

/// Enforce the use of `for-of` loop over the standard `for` loop where possible.
pub struct PreferForOf;

const PREFER_FOR_OF: Message = Message::new(
    "preferForOf",
    "Expected a `for-of` loop instead of a `for` loop with this simple iteration.",
);

fn is_literal(e: Expr, value: f64) -> bool {
    matches!(e.kind(), ExprKind::Number(n) if n == value)
}

fn is_matching_identifier<'a>(e: Expr<'a>, name: Name<'a>) -> bool {
    e.as_ident() == Some(name)
}

/// Returns the `arr` in `name < arr.length`.
fn is_less_than_length_expression<'a>(test: Expr<'a>, name: Name<'a>) -> Option<Expr<'a>> {
    let ExprKind::Binary {
        op: BinOp::Lt,
        left,
        right,
    } = test.kind()
    else {
        return None;
    };
    if !is_matching_identifier(left, name) {
        return None;
    }
    let object = match right.kind() {
        ExprKind::Dot { obj, name, .. } if name.name().is("length") => obj,
        // oxlint also accepts `a["length"]`, but not `a[length]`.
        ExprKind::Index { obj, index, .. } if test.file().language().is_oxlint => {
            match index.kind() {
                ExprKind::String(key) if key.is("length") => obj,
                ExprKind::Template(key) if key.as_static().is_some_and(|it| it.is("length")) => obj,
                _ => return None,
            }
        }
        ExprKind::Index { obj, index, .. } if index.is_ident("length") => obj,
        _ => return None,
    };
    // typescript-eslint has a `ChainExpression` there.
    (!right.is_chain_root()).then_some(object)
}

/// oxlint only checks a loop whose array is a name or a member expression that doesn't use the index: `a`, `a.b`,
/// `a[b]`.
fn oxlint_checks_array<'a>(array: Expr<'a>, index_var: Symbol<'a>) -> bool {
    !array.is_parenthesized()
        && matches!(array.tag(), ExprTag::Ident | ExprTag::Dot | ExprTag::Index)
        && !index_var
            .references()
            .any(|it| array.span().contains(it.span()))
}

/// True if a part of the loop header that oxlint matches is parenthesized. oxlint doesn't look through parentheses,
/// except around an assignment target.
fn oxlint_rejects_parentheses<'a>(init: Expr<'a>, test: Expr<'a>, update: Expr<'a>) -> bool {
    let value = update.as_assign().map(|(_, _, value)| value);
    let right = test.right();
    let parts = [
        Some(init),
        Some(test),
        test.left(),
        right,
        right.and_then(Expr::index),
        Some(update),
        value,
        value.and_then(Expr::left),
        value.and_then(Expr::right),
    ];
    parts.into_iter().flatten().any(Expr::is_parenthesized)
}

/// The kind of a node's parent in oxc's AST, as far as oxlint distinguishes them.
#[derive(Copy, Clone, PartialEq, Eq)]
enum ParentKind {
    Delete,
    Update,
    /// An assignment to the node.
    Assignment,
    /// `ArrayAssignmentTarget`, `ObjectAssignmentTarget`
    Pattern,
    Member,
    Other,
}

/// Returns the kind of `at`'s oxc parent, the parent itself, and whether `at` is assigned to there. `at` is an
/// expression or a property of a pattern.
fn oxc_parent(at: Node<'_>) -> Option<(ParentKind, Node<'_>, bool)> {
    let is_pattern = |it: Node| matches!(it, Node::Expr(it) if it.is_assignment_target());
    let parent = at.parent();
    Some(match (at, parent) {
        (Node::Expr(e), Node::Expr(parent_expr)) => match parent_expr.kind() {
            ExprKind::Unary {
                op: UnOp::Delete, ..
            } => (ParentKind::Delete, parent, false),
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => (ParentKind::Update, parent, true),
            ExprKind::Assign { target, .. } if target == e && !is_pattern(parent) => {
                (ParentKind::Assignment, parent, true)
            }
            ExprKind::Assign { target, .. } => (ParentKind::Other, parent, target == e),
            ExprKind::Array(_) if is_pattern(parent) => (ParentKind::Pattern, parent, true),
            ExprKind::Spread(_) => (ParentKind::Other, parent, is_pattern(parent)),
            ExprKind::Dot { .. } | ExprKind::Index { .. } => (ParentKind::Member, parent, false),
            _ => (ParentKind::Other, parent, false),
        },
        (Node::Expr(e), Node::Prop(prop)) if is_pattern(prop.parent()) => match prop.kind() {
            // In oxc a shorthand property and its default are one node.
            PropKind::Shorthand => (ParentKind::Pattern, prop.parent(), true),
            _ => (ParentKind::Other, parent, prop.value() == Some(e)),
        },
        (Node::Prop(_), _) => (ParentKind::Pattern, parent, true),
        _ => return None,
    })
}

/// oxlint's test for an assignment to `member`, which looks at the two nearest ancestors. Parentheses count as
/// ancestors, except around an assignment target.
fn oxlint_is_assignee(member: Expr) -> bool {
    let mut ancestor_kinds = [ParentKind::Other; 2];
    let (mut at, mut parentheses) = (Node::Expr(member), 0);
    for it in &mut ancestor_kinds {
        let Some((kind, parent, is_assigned_to)) = oxc_parent(at) else {
            break;
        };
        if !is_assigned_to && matches!(at, Node::Expr(e) if e.parens().len() > parentheses) {
            parentheses += 1;
            continue;
        }
        (*it, at, parentheses) = (kind, parent, 0);
    }
    let [first, second] = ancestor_kinds;
    !matches!(first, ParentKind::Member | ParentKind::Other)
        || second == ParentKind::Pattern && first != ParentKind::Member
}

fn is_increment<'a>(update: Expr<'a>, name: Name<'a>) -> bool {
    match update.kind() {
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PostInc,
            operand,
        } => is_matching_identifier(operand, name),
        ExprKind::Assign { op, target, value } if is_matching_identifier(target, name) => {
            match op {
                Some(BinOp::Add) => is_literal(value, 1.0),
                None => match value.kind() {
                    ExprKind::Binary {
                        op: BinOp::Add,
                        left,
                        right,
                    } => {
                        (is_matching_identifier(left, name) && is_literal(right, 1.0))
                            || (is_literal(left, 1.0) && is_matching_identifier(right, name))
                    }
                    _ => false,
                },
                _ => false,
            }
        }
        _ => false,
    }
}

fn is_index_only_used_with_array<'a>(
    body: Stmt<'a>,
    index_var: Symbol<'a>,
    array: Expr<'a>,
) -> bool {
    let (body, array_text) = (body.span(), array.text());
    let is_oxlint = array.file().language().is_oxlint;
    index_var.references().all(|reference| {
        if !body.contains(reference.span()) {
            return true;
        }
        let Some(id) = reference.expr() else {
            return false;
        };
        let Node::Expr(node) = id.parent() else {
            return false;
        };
        matches!(node.kind(), ExprKind::Index { obj, index, .. }
            if index == id && obj.tag() != ExprTag::This && obj.text() == array_text)
            && match is_oxlint {
                true => !id.is_parenthesized() && !oxlint_is_assignee(node),
                false => !ts_utils::is_assignee(node),
            }
    })
}

impl Rule for PreferForOf {
    const META: Meta = Meta::typescript("prefer-for-of", Kind::Suggestion)
        .presets(Presets::STYLISTIC)
        .reports_on_exit();
    const ON: On = On::new().stmts(&[StmtTag::For]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferForOf
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::For {
            init: Some(init),
            test: Some(test),
            update: Some(update),
            body,
        } = stmt.kind()
        else {
            return;
        };
        let StmtKind::Var(declarations) = init.kind() else {
            return;
        };
        let Some(declarator) = declarations.first() else {
            return;
        };
        if declarations.len() != 1
            || declarator.var_kind() == VarKind::Const
            || !declarator.init().is_some_and(|init| is_literal(init, 0.0))
        {
            return;
        }
        let Some(index_name) = declarator.pat().as_ident() else {
            return;
        };
        let Some(array) = is_less_than_length_expression(test, index_name) else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        if !is_increment(update, index_name) {
            return;
        }
        let Some(index_var) = declarator.pat().symbol() else {
            return;
        };
        if is_oxlint
            && (!oxlint_checks_array(array, index_var)
                || declarator
                    .init()
                    .is_some_and(|init| oxlint_rejects_parentheses(init, test, update)))
        {
            return;
        }
        if is_index_only_used_with_array(body, index_var, array) {
            // oxlint reports everything between the parentheses.
            let report_span = if is_oxlint {
                Span::new(init.span().start, update.span().end)
            } else {
                stmt.span()
            };
            cx.report(report_span, PREFER_FOR_OF).called_with(stmt);
        }
    }
}
