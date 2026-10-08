use bun_lint::prelude::*;

/// Require `for-in` loops to include an `if` statement.
pub struct GuardForIn;

const WRAP: Message = Message::new(
    "wrap",
    "The body of a for-in should be wrapped in an if statement to filter unwanted properties from the prototype.",
);

/// `continue`, or a block that contains only a `continue`.
fn is_continue(stmt: Stmt) -> bool {
    match stmt.kind() {
        StmtKind::Continue(_) => true,
        StmtKind::Block(statements) => {
            statements.len() == 1 && statements.first().is_some_and(|it| it.tag() == StmtTag::Continue)
        }
        _ => false,
    }
}

fn is_guarded(body: Stmt) -> bool {
    match body.kind() {
        StmtKind::Empty | StmtKind::If { .. } => true,
        StmtKind::Block(statements) => match statements.first().map(Stmt::kind) {
            None => true,
            Some(StmtKind::If { yes, .. }) => statements.len() == 1 || is_continue(yes),
            Some(_) => false,
        },
        _ => false,
    }
}

impl Rule for GuardForIn {
    const META: Meta = Meta::eslint("guard-for-in", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        GuardForIn
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::ForIn], |_, stmt, cx| {
            if let StmtKind::ForIn { body, .. } = stmt.kind()
                && !is_guarded(body)
            {
                cx.report(stmt, WRAP);
            }
        });
    }
}
