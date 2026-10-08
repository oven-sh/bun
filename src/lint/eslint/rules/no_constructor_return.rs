use bun_lint::prelude::*;

/// Disallow returning value from constructor.
pub struct NoConstructorReturn;

const UNEXPECTED: Message =
    Message::new("unexpected", "Unexpected return statement in constructor.");

impl Rule for NoConstructorReturn {
    const META: Meta = Meta::eslint("no-constructor-return", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConstructorReturn
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Return], |_, stmt, cx| {
            if matches!(stmt.kind(), StmtKind::Return(Some(_)))
                && let Some(func) = Node::Stmt(stmt).enclosing_function()
                && func.kind() == FnKind::Constructor
                // `static constructor() {}` is a method.
                && !func.flags().contains(Flags::STATIC)
            {
                cx.report(stmt, UNEXPECTED);
            }
        });
    }
}
