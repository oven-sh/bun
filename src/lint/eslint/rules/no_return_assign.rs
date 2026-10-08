use bun_lint::prelude::*;

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
        let mut child = Node::Expr(e);
        let (at, message) = loop {
            match child.parent() {
                Node::Stmt(statement) if statement.tag() == StmtTag::Return => {
                    break (statement.span(), RETURN_ASSIGNMENT);
                }
                Node::Func(func) if matches!(func.body(), FnBody::Expr(body) if Node::Expr(body) == child) => {
                    break (func.estree_span(), ARROW_ASSIGNMENT);
                }
                Node::Stmt(_) | Node::Func(_) | Node::Class(_) | Node::File(_) => return,
                parent => child = parent,
            }
        };
        if !self.is_always && ast_utils::is_parenthesised(e) {
            return;
        }
        // The default in a destructuring assignment is an `AssignmentPattern`.
        if utils::is_assignment_target(e) {
            return;
        }
        cx.report(at, message);
    }
}

impl Rule for NoReturnAssign {
    const META: Meta = Meta::eslint("no-return-assign", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoReturnAssign {
            is_always: options.str(0).is_some_and(|mode| mode != "except-parens"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Assign], Self::check);
    }
}
