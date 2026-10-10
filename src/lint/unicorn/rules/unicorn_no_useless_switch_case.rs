use crate::unicorn::is_empty_stmt;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows useless `default` cases in `switch` statements.
pub struct NoUselessSwitchCase;

const NO_USELESS_SWITCH_CASE: Message = Message::new("", "Useless case in switch statement.");
const REMOVE_THIS_CASE: Message = Message::new("", "Remove this case.");

impl Rule for NoUselessSwitchCase {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-useless-switch-case", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().stmts(&[StmtTag::Switch]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUselessSwitchCase
    }

    fn stmt<'a>(&self, switch_statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Switch { cases, .. } = switch_statement.kind() else {
            return;
        };
        // The only `default` is the last case.
        if !cases.last().is_some_and(|it| it.test().is_none()) || cases.iter().filter(|it| it.test().is_none()).count() != 1 {
            return;
        }
        for useless_case in cases.iter().rev().skip(1).take_while(|it| it.body().iter().all(is_empty_stmt)) {
            cx.report(useless_case, NO_USELESS_SWITCH_CASE).suggest(REMOVE_THIS_CASE, |fixer| fixer.remove(useless_case));
        }
    }
}
