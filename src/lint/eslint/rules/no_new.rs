use bun_lint::prelude::*;

/// Disallow `new` operators outside of assignments or comparisons.
pub struct NoNew;

const NO_NEW_STATEMENT: Message =
    Message::new("noNewStatement", "Do not use 'new' for side effects.");

impl Rule for NoNew {
    const META: Meta = Meta::eslint("no-new", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNew
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::New], |_, e, cx| {
            if let Node::Stmt(statement) = e.parent()
                && statement.tag() == StmtTag::Expr
            {
                cx.report(statement, NO_NEW_STATEMENT);
            }
        });
    }
}
