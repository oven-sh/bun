use bun_lint::prelude::*;

/// Disallow unnecessary `return await`.
pub struct NoReturnAwait;

const REMOVE_AWAIT: Message = Message::new("removeAwait", "Remove redundant `await`.");
const REDUNDANT_USE_OF_AWAIT: Message = Message::new(
    "redundantUseOfAwait",
    "Redundant use of `await` on a return value.",
);

/// ESLint's `hasErrorHandler`: what `node` throws is caught in the same function.
fn has_error_handler(node: Node) -> bool {
    let mut inner = node;
    for ancestor in node.ancestors() {
        match ancestor {
            Node::Func(func) if ast_utils::is_function_with_body(func) => return false,
            Node::Stmt(statement) => {
                // What is neither the block nor the finalizer is in the `catch` clause.
                if let StmtKind::Try { block, finalizer, .. } = statement.kind()
                    && (inner == Node::Stmt(block) || finalizer.is_some_and(|it| inner != Node::Stmt(it)))
                {
                    return true;
                }
            }
            _ => {}
        }
        inner = ancestor;
    }
    false
}

/// ESLint's `isInTailCallPosition`.
fn is_in_tail_call_position(e: Expr) -> bool {
    let mut at = e;
    loop {
        match at.parent() {
            Node::Func(func) => return func.is_arrow(),
            Node::Stmt(statement) => {
                return statement.tag() == StmtTag::Return && !has_error_handler(statement.into());
            }
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Cond { yes, no, .. } if at == yes || at == no => at = parent,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    right,
                    ..
                } if at == right => at = parent,
                _ => return false,
            },
            _ => return false,
        }
    }
}

impl Rule for NoReturnAwait {
    const META: Meta = Meta::eslint("no-return-await", Kind::Suggestion).has_suggestions().deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoReturnAwait
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Await], |_, e, cx| {
            if !is_in_tail_call_position(e) || has_error_handler(e.into()) {
                return;
            }
            cx.report(e, REDUNDANT_USE_OF_AWAIT).suggest(REMOVE_AWAIT, |fixer| {
                let file = fixer.file();
                let start = e.span().start;
                let end = start + "await".len() as u32;
                if !file.is_on_same_line(start, skip_trivia(file.text(), end)) {
                    return None;
                }
                let space = u32::from(file.text().get(end as usize) == Some(&b' '));
                Some(fixer.remove(Span::new(start, end + space)))
            });
        });
    }
}
