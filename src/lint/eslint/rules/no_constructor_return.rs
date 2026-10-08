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
        on.funcs(|_, func, cx| {
            // `static constructor() {}` is a method.
            if func.kind() != FnKind::Constructor || func.flags().contains(Flags::STATIC) {
                return;
            }
            for stmt in func.returns() {
                if matches!(stmt.kind(), StmtKind::Return(Some(_))) {
                    cx.report(stmt, UNEXPECTED);
                }
            }
        });
    }
}
