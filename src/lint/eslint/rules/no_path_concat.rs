use bun_lint::prelude::*;

/// Disallow string concatenation with `__dirname` and `__filename`.
pub struct NoPathConcat;

const USE_PATH_FUNCTIONS: Message = Message::new(
    "usePathFunctions",
    "Use path.join() or path.resolve() instead of + to create paths.",
);

fn is_path_variable(e: Expr) -> bool {
    e.as_ident().is_some_and(|name| name.is_any(&["__dirname", "__filename"]))
}

impl Rule for NoPathConcat {
    const META: Meta = Meta::eslint("no-path-concat", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoPathConcat
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], |_, e, cx| {
            if let ExprKind::Binary { op: BinOp::Add, left, right } = e.kind()
                && (is_path_variable(left) || is_path_variable(right))
            {
                cx.report(e, USE_PATH_FUNCTIONS);
            }
        });
    }
}
