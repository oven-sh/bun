use bun_lint::prelude::*;

/// Disallow constant expressions in conditions.
pub struct NoConstantCondition {
    check_loops: CheckLoops,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum CheckLoops {
    All,
    AllExceptWhileTrue,
    None,
}

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected constant condition.");

/// Whether the generator that `statement` is in can be suspended between `from` and the end of
/// `statement`.
fn has_yield_from(statement: Stmt, from: u32) -> bool {
    let within = Span::new(from, statement.span().end);
    Node::Stmt(statement)
        .enclosing_function()
        .filter(|func| func.is_generator())
        .is_some_and(|func| func.yields().any(|it| within.contains(it.span())))
}

/// For oxlint the parentheses around a test are part of it.
fn place(test: Expr) -> Span {
    if test.file().language().is_oxlint { test.outer_span() } else { test.span() }
}

impl NoConstantCondition {
    fn check_loop<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        // A `yield` in the `init` of a `for` is evaluated once, before the loop.
        let (test, from) = match statement.kind() {
            StmtKind::While { test, .. } => {
                if self.check_loops == CheckLoops::AllExceptWhileTrue && test.tag() == ExprTag::True {
                    return;
                }
                (test, statement.span().start)
            }
            StmtKind::DoWhile { test, .. } => (test, statement.span().start),
            StmtKind::For { test: Some(test), .. } => (test, test.span().start),
            _ => return,
        };
        // oxlint looks for a `yield` only with the default option.
        let looks_for_yield = !cx.language().is_oxlint || self.check_loops == CheckLoops::AllExceptWhileTrue;
        if ast_utils::is_constant(test, true) && !(looks_for_yield && has_yield_from(statement, from)) {
            cx.report(place(test), UNEXPECTED);
        }
    }
}

impl Rule for NoConstantCondition {
    const META: Meta = Meta::eslint("no-constant-condition", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let check_loops = options.object(0).get("checkLoops");
        NoConstantCondition {
            check_loops: match check_loops.map(|it| (it.as_bool(), it.as_str())) {
                Some((Some(true), _) | (_, Some(b"all"))) => CheckLoops::All,
                Some((Some(false), _) | (_, Some(b"none"))) => CheckLoops::None,
                _ => CheckLoops::AllExceptWhileTrue,
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Cond], |_, e, cx| {
            if let ExprKind::Cond { test, .. } = e.kind()
                && ast_utils::is_constant(test, true)
            {
                cx.report(place(test), UNEXPECTED);
            }
        });
        on.stmts([StmtTag::If], |_, statement, cx| {
            if let StmtKind::If { test, .. } = statement.kind()
                && ast_utils::is_constant(test, true)
            {
                cx.report(place(test), UNEXPECTED);
            }
        });
        if self.check_loops != CheckLoops::None {
            on.stmts([StmtTag::While, StmtTag::DoWhile, StmtTag::For], Self::check_loop);
        }
    }
}
