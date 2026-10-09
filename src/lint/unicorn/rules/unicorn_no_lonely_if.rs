use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow `if` statements as the only statement in `if` blocks without `else`.
pub struct NoLonelyIf;

const NO_LONELY_IF: Message = Message::new("", "Unexpected `if` as the only statement in a `if` block without `else`.");

impl Rule for NoLonelyIf {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-lonely-if", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoLonelyIf
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::If], |_, if_stmt, cx| {
            let has_no_else = |it: Stmt| matches!(it.kind(), StmtKind::If { no: None, .. });
            let Node::Stmt(parent) = if_stmt.parent() else {
                return;
            };
            let is_lonely = has_no_else(if_stmt)
                && match parent.as_block() {
                    Some(body) => body.len() == 1 && matches!(parent.parent(), Node::Stmt(outer) if has_no_else(outer)),
                    None => has_no_else(parent),
                };
            if is_lonely {
                let keyword = |start: u32| Span::new(start, start + 2);
                let outer = if parent.as_block().is_some() { parent.parent().span() } else { parent.span() };
                cx.report(keyword(if_stmt.span().start), NO_LONELY_IF).label(keyword(outer.start), "");
            }
        });
    }
}
