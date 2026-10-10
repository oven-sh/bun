use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow unnecessary labels.
pub struct NoExtraLabel;

const UNEXPECTED: Message = Message::new("unexpected", "This label '{{name}}' is unnecessary.");

/// Whether the innermost loop or `switch` around `statement` has the label `label`. Then no statement in between has it: a label
/// cannot be declared twice.
fn is_unnecessary<'a>(statement: Stmt<'a>, label: Name<'a>, cx: &mut Cx<'a, NoExtraLabel>) -> bool {
    let breakable = cx.state.find(Node::Stmt(statement), |_, ancestor| match ancestor {
        Node::Stmt(ancestor) => ast_utils::is_breakable_statement(ancestor).then_some(Some(ancestor)),
        Node::Func(_) => Some(None),
        _ => None,
    });
    matches!(breakable.flatten().map(Stmt::parent), Some(Node::Stmt(parent))
        if matches!(parent.kind(), StmtKind::Labeled { label: it, .. } if it == label))
}

impl Rule for NoExtraLabel {
    const META: Meta = Meta::eslint("no-extra-label", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::Break, StmtTag::Continue]);
    /// The innermost loop or `switch` around a node, in its function.
    type State<'a> = AncestorMemo<'a, Option<Stmt<'a>>>;

    fn new(_: &Options) -> Self {
        NoExtraLabel
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some(label) = statement.label() else {
            return;
        };
        if !is_unnecessary(statement, label.name(), cx) {
            return;
        }
        cx.report(label, UNEXPECTED).data("name", label).fix(|fixer| {
            let keyword_len = if statement.tag() == StmtTag::Break { "break".len() } else { "continue".len() };
            let after_keyword = Span::empty(statement.span().start + keyword_len as u32);
            (!fixer.file().comments_exist_between(after_keyword, label))
                .then(|| fixer.remove(after_keyword.to(label.span())))
        });
    }
}
