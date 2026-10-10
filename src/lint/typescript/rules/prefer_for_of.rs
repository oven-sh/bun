use bun_lint::prelude::*;
use rustc_hash::FxHashMap;

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
    let ExprKind::Binary { op: BinOp::Lt, left, right } = test.kind() else {
        return None;
    };
    if !is_matching_identifier(left, name) {
        return None;
    }
    let object = match right.kind() {
        ExprKind::Dot { obj, name, .. } if name.name().is("length") => obj,
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
        && !index_var.references().any(|it| array.span().contains(it.span()))
}

fn is_increment<'a>(update: Expr<'a>, name: Name<'a>) -> bool {
    match update.kind() {
        ExprKind::Unary { op: UnOp::PreInc | UnOp::PostInc, operand } => is_matching_identifier(operand, name),
        ExprKind::Assign { op, target, value } if is_matching_identifier(target, name) => match op {
            Some(BinOp::Add) => is_literal(value, 1.0),
            None => match value.kind() {
                ExprKind::Binary { op: BinOp::Add, left, right } => {
                    (is_matching_identifier(left, name) && is_literal(right, 1.0))
                        || (is_literal(left, 1.0) && is_matching_identifier(right, name))
                }
                _ => false,
            },
            _ => false,
        },
        _ => false,
    }
}

/// The references to the variables that have many, in the order of the source.
type References<'a> = FxHashMap<Symbol<'a>, Vec<Reference<'a>>>;

fn is_index_only_used_with_array<'a>(body: Stmt<'a>, index_var: Symbol<'a>, array: Expr<'a>, references: &mut References<'a>) -> bool {
    let (body, array_text) = (body.span(), array.text());
    // A `var` can be the index of many loops.
    let is_many = index_var.references().len() > 16;
    let in_body: &[Reference<'a>] = match is_many {
        true => {
            let all = references.entry(index_var).or_insert_with(|| {
                let mut all: Vec<Reference<'a>> = index_var.references().collect();
                utils::sort::sort_unstable_by_key(&mut all, |it| it.span().start);
                all
            });
            let first = all.partition_point(|it| it.span().start < body.start);
            &all[first..first + all[first..].partition_point(|it| it.span().start < body.end)]
        }
        false => &[],
    };
    let few = index_var.references().take(if is_many { 0 } else { usize::MAX });
    in_body.iter().copied().chain(few).all(|reference| {
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
            && !ts_utils::is_assignee(node)
    })
}

impl Rule for PreferForOf {
    const META: Meta =
        Meta::typescript("prefer-for-of", Kind::Suggestion).presets(Presets::STYLISTIC)
        .reports_on_exit();
    const ON: On = On::new().stmts(&[StmtTag::For]);
    type State<'a> = References<'a>;

    fn new(_: &Options) -> Self {
        PreferForOf
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<References<'a>> {
        Some(References::default())
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
        if is_oxlint && !oxlint_looks_at(array, index_var) {
            return;
        }
        if is_index_only_used_with_array(body, index_var, array, &mut cx.state) {
            // oxlint points at what is between the parentheses.
            let place = if is_oxlint { Span::new(init.span().start, update.span().end) } else { stmt.span() };
            cx.report(place, PREFER_FOR_OF);
        }
    }
}
