use bun_lint::prelude::*;

/// Disallow unused labels.
pub struct NoUnusedLabels;

const UNUSED: Message = Message::new("unused", "'{{name}}:' is defined but never used.");

#[derive(Default)]
pub struct Labels<'a> {
    all: Vec<Stmt<'a>>,
    used: Vec<Stmt<'a>>,
}

/// Whether the label of `statement` can be removed: no comment is lost, `body` does not become a
/// directive, and it does not continue the statement before.
fn is_fixable<'a>(statement: Stmt<'a>, label: Ident<'a>, body: Stmt<'a>) -> bool {
    let file = statement.file();
    if file.tokens_after(label).with_comments().next() != file.tokens_before(body).with_comments().next() {
        return false;
    }

    let ancestor = Node::Stmt(statement).ancestors().find(|it| !matches!(it, Node::Stmt(s) if s.tag() == StmtTag::Labeled));
    let has_directives = match ancestor {
        Some(Node::File(_)) => true,
        Some(Node::Func(func)) => func.kind() != FnKind::StaticBlock,
        _ => false,
    };
    if has_directives
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
                cx.state.used.push(target);
            }
        });
        on.finish(|_, cx| {
            for &statement in &cx.state.all {
                if cx.state.used.contains(&statement) {
                    continue;
                }
                let (StmtKind::Labeled { body, .. }, Some(label)) = (statement.kind(), statement.label()) else {
                    continue;
                };
                cx.report(label, UNUSED).data("name", label).fix(|fixer| {
                    is_fixable(statement, label, body)
                        .then(|| fixer.remove(Span::new(statement.span().start, body.span().start)))
                });
            }
        });
        Labels::default()
    }
}
