use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow assignment operators in `return` statements.
pub struct NoReturnAssign {
    is_always: bool,
}

const RETURN_ASSIGNMENT: Message =
    Message::new("returnAssignment", "Return statement should not contain assignment.");
const ARROW_ASSIGNMENT: Message =
    Message::new("arrowAssignment", "Arrow function should not return assignment.");

impl NoReturnAssign {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // Nothing above a statement, a function or a class can be a `return` or an arrow function
        // without one of ESLint's sentinels in between.
        let found = cx.state.find(Node::Expr(e), |child, parent| match parent {
            Node::Stmt(statement) if statement.tag() == StmtTag::Return => Some(Some((statement.span(), false))),
            Node::Func(func) if matches!(func.body(), FnBody::Expr(body) if Node::Expr(body) == child) => {
                Some(Some((func.estree_span(), true)))
            }
            Node::Stmt(_) | Node::Func(_) | Node::Class(_) | Node::File(_) => Some(None),
            _ => None,
        });
        let Some(Some((at, is_arrow))) = found else {
            return;
        };
        if !self.is_always && ast_utils::is_parenthesised(e) {
            return;
        }
        // The default in a destructuring assignment is an `AssignmentPattern`.
        if utils::is_assignment_target(e) {
            return;
        }
        cx.report(at, if is_arrow { ARROW_ASSIGNMENT } else { RETURN_ASSIGNMENT });
    }
}

impl Rule for NoReturnAssign {
    const META: Meta = Meta::eslint("no-return-assign", Kind::Suggestion);
    /// The `return` statement or the arrow function that an expression is returned by, with whether it
    /// is an arrow function.
    type State<'a> = AncestorMemo<'a, Option<(Span, bool)>>;

    fn new(options: &Options) -> Self {
        NoReturnAssign {
            is_always: options.str(0).is_some_and(|mode| mode != "except-parens"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        on.exprs([ExprTag::Assign], Self::check);
        AncestorMemo::default()
    }
}
