use bun_lint::prelude::*;

/// Disallow unnecessary labels.
pub struct NoExtraLabel;

const UNEXPECTED: Message = Message::new("unexpected", "This label '{{name}}' is unnecessary.");

/// Whether the innermost loop or `switch` around `statement` has the label `label`, and no other
/// statement in between has.
fn is_unnecessary<'a>(statement: Stmt<'a>, label: Name<'a>) -> bool {
    for ancestor in Node::Stmt(statement).ancestors() {
        let Node::Stmt(ancestor) = ancestor else {
            continue;
        };
        if ast_utils::is_breakable_statement(ancestor) {
            return matches!(ancestor.parent(), Node::Stmt(parent)
                if matches!(parent.kind(), StmtKind::Labeled { label: it, .. } if it == label));
        }
        if matches!(ancestor.kind(), StmtKind::Labeled { label: it, .. } if it == label) {
            return false;
        }
    }
    false
}

impl Rule for NoExtraLabel {
    const META: Meta = Meta::eslint("no-extra-label", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoExtraLabel
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Break, StmtTag::Continue], |_, statement, cx| {
            let Some(label) = statement.label() else {
                return;
            };
            if !is_unnecessary(statement, label.name()) {
                return;
            }
            cx.report(label, UNEXPECTED).data("name", label).fix(|fixer| {
                let keyword_len = if statement.tag() == StmtTag::Break { "break".len() } else { "continue".len() };
                let after_keyword = Span::empty(statement.span().start + keyword_len as u32);
                (!fixer.file().comments_exist_between(after_keyword, label))
                    .then(|| fixer.remove(after_keyword.to(label.span())))
            });
        });
    }
}
