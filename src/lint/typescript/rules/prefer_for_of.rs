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

/// The `arr` of `name < arr.length`.
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
        // For oxlint `a["length"]`, not `a[length]`.
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

/// oxlint looks at a loop only if the array is a name or a member in which the index is not used: `a`, `a.b`, `a[b]`.
fn oxlint_looks_at<'a>(array: Expr<'a>, index_var: Symbol<'a>) -> bool {
    !array.is_parenthesized()
        && matches!(array.tag(), ExprTag::Ident | ExprTag::Dot | ExprTag::Index)
        && !index_var
            .references()
            .any(|it| array.span().contains(it.span()))
}

/// For oxlint what is in parentheses is nothing that it knows, unless it is assigned to.
fn oxlint_minds_parentheses<'a>(init: Expr<'a>, test: Expr<'a>, update: Expr<'a>) -> bool {
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

/// What oxc has around a node, as far as oxlint asks.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Around {
    Delete,
    Update,
    /// An assignment to the node.
    Assignment,
    /// `ArrayAssignmentTarget`, `ObjectAssignmentTarget`
    Pattern,
    Member,
    Other,
}

/// What is around `at`, which is an expression or a property of a pattern, and whether `at` is assigned to there.
fn oxc_parent(at: Node<'_>) -> Option<(Around, Node<'_>, bool)> {
    let is_pattern = |it: Node| matches!(it, Node::Expr(it) if it.is_assignment_target());
    let parent = at.parent();
    Some(match (at, parent) {
        (Node::Expr(e), Node::Expr(around)) => match around.kind() {
            ExprKind::Unary {
                op: UnOp::Delete, ..
            } => (Around::Delete, parent, false),
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => (Around::Update, parent, true),
            ExprKind::Assign { target, .. } if target == e && !is_pattern(parent) => {
                (Around::Assignment, parent, true)
            }
            ExprKind::Assign { target, .. } => (Around::Other, parent, target == e),
            ExprKind::Array(_) if is_pattern(parent) => (Around::Pattern, parent, true),
            ExprKind::Spread(_) => (Around::Other, parent, is_pattern(parent)),
            ExprKind::Dot { .. } | ExprKind::Index { .. } => (Around::Member, parent, false),
            _ => (Around::Other, parent, false),
        },
        (Node::Expr(e), Node::Prop(prop)) if is_pattern(prop.parent()) => match prop.kind() {
            // With its default it is one node.
            PropKind::Shorthand => (Around::Pattern, prop.parent(), true),
            _ => (Around::Other, parent, prop.value() == Some(e)),
        },
        (Node::Prop(_), _) => (Around::Pattern, parent, true),
        _ => return None,
    })
}

/// What oxlint takes for an assignment to `member`: it looks at the two nodes around it. There parentheses are nodes, but
/// for those around what is assigned to.
fn oxlint_is_assignee(member: Expr) -> bool {
    let mut around = [Around::Other; 2];
    let (mut at, mut parentheses) = (Node::Expr(member), 0);
    for it in &mut around {
        let Some((kind, parent, is_assigned_to)) = oxc_parent(at) else {
            break;
        };
        if !is_assigned_to && matches!(at, Node::Expr(e) if e.parens().len() > parentheses) {
            parentheses += 1;
            continue;
        }
        (*it, at, parentheses) = (kind, parent, 0);
    }
    let [first, second] = around;
    !matches!(first, Around::Member | Around::Other)
        || second == Around::Pattern && first != Around::Member
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
            && (!oxlint_looks_at(array, index_var)
                || declarator
                    .init()
                    .is_some_and(|init| oxlint_minds_parentheses(init, test, update)))
        {
            return;
        }
        if is_index_only_used_with_array(body, index_var, array) {
            // oxlint points at what is between the parentheses.
            let place = if is_oxlint {
                Span::new(init.span().start, update.span().end)
            } else {
                stmt.span()
            };
            cx.report(place, PREFER_FOR_OF).called_with(stmt);
        }
    }
}
