use bun_lint::prelude::*;
use bun_lint::types::TypeFlags;
use bun_lint::types::tsutils::{is_thenable_type, union_constituents};

/// Disallow the `void` operator except when used to discard a value.
pub struct NoMeaninglessVoidOperator {
    check_never: bool,
}

const MEANINGLESS_VOID_ON_NON_CALL: Message = Message::new(
    "meaninglessVoidOnNonCall",
    "void operator is useless here; it should only discard a call's return value",
);
const MEANINGLESS_VOID_OPERATOR: Message = Message::new(
    "meaninglessVoidOperator",
    "void operator shouldn't be used on {{type}}; it should convey that a return value is being ignored",
);
const REMOVE_VOID: Message = Message::new("removeVoid", "Remove 'void'");

fn unwrap_void_argument(node: Expr<'_>) -> Expr<'_> {
    let mut current = node;
    loop {
        current = match current.kind() {
            ExprKind::As { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Satisfies { expr, .. } => expr,
            // The last of the expressions.
            ExprKind::Binary { op: BinOp::Comma, right, .. } => right,
            _ => return current,
        };
    }
}

/// Removes the `void` that `node` starts with, and what is before the next token.
fn fix(fixer: Fixer, node: Expr) -> Fix {
    let start = node.span().start;
    fixer.remove(Span::new(start, skip_trivia(fixer.file().text(), start + 4)))
}

impl NoMeaninglessVoidOperator {
    fn check<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Unary { op: UnOp::Void, operand: argument } = node.kind() else {
            return;
        };
        match unwrap_void_argument(argument).kind() {
            ExprKind::Call(_) => {}
            // `void 0` is a common way to write `undefined`.
            ExprKind::Number(value) if value == 0.0 => return,
            // `() => void (x = 1)` discards the value of the assignment.
            ExprKind::Assign { .. } => return,
            _ => {
                let arg_type = argument.ty();
                // `void promise` is what `no-floating-promises` asks for.
                if arg_type.is_unresolved() || is_thenable_type(argument, arg_type) {
                    return;
                }
                let is_statement =
                    matches!(node.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::Expr);
                cx.report(node, MEANINGLESS_VOID_ON_NON_CALL)
                    .fix(|fixer| is_statement.then(|| fix(fixer, node)));
                return;
            }
        }

        let arg_type = argument.ty();
        let every_part_is = |flags: TypeFlags| {
            union_constituents(arg_type).iter().all(|part| part.has_flags(flags))
        };
        if every_part_is(TypeFlags::VOID | TypeFlags::UNDEFINED) {
            cx.report(node, MEANINGLESS_VOID_OPERATOR)
                .data("type", arg_type.to_text())
                .fix(|fixer| fix(fixer, node));
        } else if self.check_never
            && every_part_is(TypeFlags::VOID | TypeFlags::UNDEFINED | TypeFlags::NEVER)
        {
            cx.report(node, MEANINGLESS_VOID_OPERATOR)
                .data("type", arg_type.to_text())
                .suggest(REMOVE_VOID, |fixer| fix(fixer, node));
        }
    }
}

impl Rule for NoMeaninglessVoidOperator {
    const META: Meta = Meta::typescript("no-meaningless-void-operator", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoMeaninglessVoidOperator {
            check_never: options.object(0).bool_or("checkNever", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Unary], Self::check);
    }
}
