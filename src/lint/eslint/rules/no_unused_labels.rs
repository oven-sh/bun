use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow unused labels.
pub struct NoUnusedLabels;

const UNUSED: Message = Message::new("unused", "'{{name}}:' is defined but never used.");

#[derive(Default)]
pub struct Labels<'a> {
    all: Vec<Stmt<'a>>,
    /// Where the labeled statements start that something jumps to.
    used: Vec<u32>,
}

/// Whether the label of `statement` can be removed: no comment is lost, `body` does not become a
/// directive, and it does not continue the statement before.
///
/// `known`: whether what is around a statement and its labels can have directives.
fn is_fixable<'a>(
    statement: Stmt<'a>,
    label: Ident<'a>,
    body: Stmt<'a>,
    known: &mut AncestorMemo<'a, bool>,
) -> bool {
    let file = statement.file();
    if file.tokens_after(label).with_comments().next() != file.tokens_before(body).with_comments().next() {
        return false;
    }

    let has_directives = known.find(Node::Stmt(statement), |_, ancestor| match ancestor {
        Node::Stmt(it) if it.tag() == StmtTag::Labeled => None,
        Node::File(_) => Some(true),
        Node::Func(func) => Some(func.kind() != FnKind::StaticBlock),
        _ => Some(false),
    });
    if has_directives == Some(true)
        && let StmtKind::Expr(e) = body.kind()
        && (e.as_string().is_some() || ast_utils::is_static_template_literal(e))
    {
        return false;
    }

    let is_safe_before = file.token_before(statement).is_none_or(|it| matches!(it.text(), b":" | b";" | b"{"));
    let is_unsafe_first = file
        .first_token(body)
        .is_some_and(|it| matches!(it.text().first(), Some(b'(' | b'[' | b'-' | b'+' | b'/' | b'`')));
    is_safe_before || !is_unsafe_first
}

impl Rule for NoUnusedLabels {
    const META: Meta = Meta::eslint("no-unused-labels", Kind::Suggestion)
        .fixable(Fixable::Code)
        .recommended();
    type State<'a> = Labels<'a>;

    fn new(_: &Options) -> Self {
        NoUnusedLabels
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Labels<'a> {
        on.stmts([StmtTag::Labeled], |_, statement, cx| cx.state.all.push(statement));
        on.stmts([StmtTag::Break, StmtTag::Continue], |_, jump, cx| {
            let (StmtKind::Break(Some(name)) | StmtKind::Continue(Some(name))) = jump.kind() else {
                return;
            };
            let target = Node::Stmt(jump).ancestors().filter_map(Node::as_stmt).find(
                |it| matches!(it.kind(), StmtKind::Labeled { label, .. } if label == name),
            );
            if let Some(target) = target {
                cx.state.used.push(target.span().start);
            }
        });
        on.finish(|_, cx| {
            cx.state.used.sort_unstable();
            let mut known = AncestorMemo::default();
            for &statement in &cx.state.all {
                if cx.state.used.binary_search(&statement.span().start).is_ok() {
                    continue;
                }
                let (StmtKind::Labeled { body, .. }, Some(label)) = (statement.kind(), statement.label()) else {
                    continue;
                };
                cx.report(label, UNUSED).data("name", label).fix(|fixer| {
                    is_fixable(statement, label, body, &mut known)
                        .then(|| fixer.remove(Span::new(statement.span().start, body.span().start)))
                });
            }
        });
        Labels::default()
    }
}
