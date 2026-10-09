use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent `break`/`return`/`continue`/`throw` position in `case` clauses.
pub struct SwitchCaseBreakPosition;

const SWITCH_CASE_BREAK_POSITION: Message = Message::new("", "Move `{{keyword}}` inside the block statement.");

impl Rule for SwitchCaseBreakPosition {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "switch-case-break-position", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        SwitchCaseBreakPosition
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.cases(|_, switch_case, cx| {
            let consequent = switch_case.body();
            if consequent.len() != 2 {
                return;
            }
            let (Some(StmtKind::Block(body)), Some(last_statement)) =
                (consequent.first().map(Stmt::kind), consequent.last())
            else {
                return;
            };
            let keyword = match last_statement.tag() {
                StmtTag::Break => "break",
                StmtTag::Return => "return",
                StmtTag::Continue => "continue",
                StmtTag::Throw => "throw",
                _ => return,
            };
            if !body.is_empty() {
                cx.report(last_statement, SWITCH_CASE_BREAK_POSITION).data("keyword", keyword);
            }
        });
    }
}
