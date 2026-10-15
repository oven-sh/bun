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
    #[inline(never)]
    fn report<'a>(test: Expr<'a>, cx: &Cx<'a, Self>) {
        cx.report(place(test), UNEXPECTED);
    }

    #[inline(never)]
    fn check_loop<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        // A `yield` in the `init` of a `for` is evaluated once, before the loop.
        let (test, from) = match statement.kind() {
            StmtKind::While { test, .. } => {
                // For oxlint `(true)` is a ParenthesizedExpression, not the BooleanLiteral it exempts.
                if self.check_loops == CheckLoops::AllExceptWhileTrue
                    && test.tag() == ExprTag::True
                    && !(cx.language().is_oxlint && test.is_parenthesized())
                {
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
    const ON: On = On::new()
        .exprs(&[ExprTag::Cond])
        .stmts(&[StmtTag::If, StmtTag::While, StmtTag::DoWhile, StmtTag::For]);
    no_state!();

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

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new().exprs(&[ExprTag::Cond]).stmts(&[StmtTag::If]);
        if self.check_loops != CheckLoops::None {
            on = on.stmts(&[StmtTag::While, StmtTag::DoWhile, StmtTag::For]);
        }
        on
    }

    #[inline]
    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some((test, ..)) = e.as_cond()
            && ast_utils::is_constant(test, true)
        {
            Self::report(test, cx);
        }
    }

    #[inline]
    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.as_if() {
            Some((test, ..)) if ast_utils::is_constant(test, true) => Self::report(test, cx),
            Some(_) => {}
            None => self.check_loop(statement, cx),
        }
    }
}
