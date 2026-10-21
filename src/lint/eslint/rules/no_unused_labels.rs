use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Disallow unused labels.
pub struct NoUnusedLabels;

const UNUSED: Message = Message::new("unused", "'{{name}}:' is defined but never used.");

#[derive(Default)]
pub struct Labels<'a> {
    all: Vec<Stmt<'a>>,
    /// The start offset of each labeled `break` and `continue`, with its label.
    jumps: Vec<(u32, Name<'a>)>,
}

/// True if `statement`'s label can be removed: no comment is lost, `body` doesn't become a directive, and it doesn't
/// continue the previous statement.
///
/// `known` remembers whether the parent of a statement and its labels can have directives.
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
        && let Some(e) = body.as_expr()
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
        .recommended()
        .reports_on_exit();
    const ON: On = On::new()
        .stmts(&[StmtTag::Labeled, StmtTag::Break, StmtTag::Continue])
        .finish();
    type State<'a> = Labels<'a>;

    fn new(_: &Options) -> Self {
        NoUnusedLabels
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Labels<'a>> {
        Some(Labels::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.tag() {
            StmtTag::Labeled => cx.state.all.push(statement),
            StmtTag::Break | StmtTag::Continue => {
                let jump = statement;
                if let StmtKind::Break(Some(name)) | StmtKind::Continue(Some(name)) = jump.kind() {
                    cx.state.jumps.push((jump.span().start, name));
                }
            }
            _ => {}
        }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let Labels { mut all, mut jumps } = std::mem::take(&mut cx.state);
        utils::sort::sort_unstable_by_key(&mut all, |it| it.span().start);
        utils::sort::sort_unstable_by_key(&mut jumps, |it| it.0);
        let label_of = |statement: Stmt<'a>| match statement.kind() {
            StmtKind::Labeled { label, .. } => Some(label),
            _ => None,
        };
        // One pass over the labeled statements and the jumps, in source order.
        let mut is_used = vec![false; all.len()];
        // `enclosing` has the indexes of the labeled statements enclosing the current position, outermost first.
        // `with_label` has the same indexes, by label.
        let mut enclosing: Vec<usize> = Vec::new();
        let mut with_label: FxHashMap<Name<'a>, Vec<usize>> = FxHashMap::default();
        let mut rest = all.iter().copied().enumerate().peekable();
        for (jump, name) in jumps {
            loop {
                let next = rest.next_if(|it| it.1.span().start <= jump);
                let position = next.map_or(jump, |it| it.1.span().start);
                while let Some(ended) = enclosing.last().and_then(|&it| all.get(it)).filter(|it| it.span().end <= position) {
                    enclosing.pop();
                    if let Some(same) = label_of(*ended).and_then(|it| with_label.get_mut(&it)) {
                        same.pop();
                    }
                }
                let Some((index, statement)) = next else {
                    break;
                };
                enclosing.push(index);
                if let Some(label) = label_of(statement) {
                    with_label.entry(label).or_default().push(index);
                }
            }
            let target = with_label.get(&name).and_then(|it| it.last());
            if let Some(is_used) = target.and_then(|&it| is_used.get_mut(it)) {
                *is_used = true;
            }
        }
        let mut known = AncestorMemo::default();
        for (&statement, is_used) in all.iter().zip(is_used) {
            if is_used {
                continue;
            }
            let (Some((_, body)), Some(label)) = (statement.as_labeled(), statement.label()) else {
                continue;
            };
            cx.report(label, UNUSED).data("name", label).fix(|fixer| {
                // oxlint always replaces the statement with its body.
                if fixer.file().language().is_oxlint {
                    return Some(fixer.replace(statement, body.text()));
                }
                is_fixable(statement, label, body, &mut known)
                    .then(|| fixer.remove(Span::new(statement.span().start, body.span().start)))
            });
        }
    }
}
