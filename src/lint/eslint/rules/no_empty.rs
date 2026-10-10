use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow empty block statements.
pub struct NoEmpty {
    allow_empty_catch: bool,
}

const UNEXPECTED: Message = Message::new("unexpected", "Empty {{type}} statement.");
const SUGGEST_COMMENT: Message =
    Message::new("suggestComment", "Add comment inside empty {{type}} statement.");

impl NoEmpty {
    /// `braces`: a `{ }` without statements or cases. All that can be in it is whitespace and
    /// comments. `place`: where it is reported. `removed`: what oxlint suggests to remove.
    fn check(braces: Span, place: Span, kind: &'static str, removed: Option<Span>, cx: &Cx<'_, Self>) {
        let inside = braces.shrink(1, 1);
        if !strings::is_all_js_whitespace(cx.slice(inside)) {
            return;
        }
        let report = cx.report(place, UNEXPECTED).data("type", kind);
        if cx.language().is_oxlint {
            report.fix(|fixer| removed.map(|it| fixer.remove(it)));
            return;
        }
        report.suggest_with(
            SUGGEST_COMMENT,
            &[("type", kind.as_bytes())],
            |fixer| fixer.replace(inside, " /* empty */ "),
        );
    }

    fn block<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if stmt.as_block().is_none_or(|body| !body.is_empty()) {
            return;
        }
        if self.allow_empty_catch
            && let Node::Stmt(parent) = stmt.parent()
            && let StmtKind::Try { handler, .. } = parent.kind()
            && handler == Some(stmt)
        {
            return;
        }
        let removed = if cx.language().is_oxlint { removed_by_oxlint(stmt) } else { None };
        Self::check(stmt.span(), stmt.span(), "block", removed, cx);
    }

    fn switch<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Switch { expr, cases } = stmt.kind() else {
            return;
        };
        if !cases.is_empty() {
            return;
        }
        let source = cx.text();
        let close_paren = skip_trivia(source, expr.outer_span().end);
        let open_brace = skip_trivia(source, close_paren + 1);
        let braces = Span::new(open_brace, stmt.span().end);
        if !cx.language().is_oxlint {
            return Self::check(braces, braces, "switch", None, cx);
        }
        // oxlint points at the whole statement, which a comment does not fill.
        if strings::is_all_js_whitespace(cx.slice(braces.shrink(1, 1))) {
            Self::check(braces, stmt.span(), "switch", Some(stmt.span()), cx);
        } else {
            cx.report(stmt, UNEXPECTED).data("type", "switch").fix(|fixer| fixer.remove(stmt));
        }
    }
}

/// What oxlint suggests to remove for the empty `block`: what the block is in. Of a `try` statement the `finally` with
/// its block; nothing for the block of a `catch`.
fn removed_by_oxlint(block: Stmt) -> Option<Span> {
    let parent = match block.parent() {
        Node::Stmt(parent) => parent,
        Node::Case(case) => return Some(case.span()),
        // All of the file, or the body of a function.
        _ => return None,
    };
    let StmtKind::Try { handler, finalizer, .. } = parent.kind() else {
        return Some(parent.span());
    };
    if handler == Some(block) {
        return None;
    }
    if finalizer != Some(block) {
        return Some(parent.span());
    }
    let file = block.file();
    let keyword = file.tokens_before(block).with_comments().next().filter(|it| it.is_keyword("finally"))?;
    // It counts characters where it has an offset in bytes.
    let is_found = file.text().get(..keyword.start() as usize).is_some_and(<[u8]>::is_ascii);
    is_found.then(|| Span::new(keyword.start(), block.span().end))
}

impl Rule for NoEmpty {
    const META: Meta = Meta::eslint("no-empty", Kind::Suggestion)
        .has_suggestions()
        .recommended();
    const ON: On = On::new().stmts(&[StmtTag::Block, StmtTag::Switch]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoEmpty {
            allow_empty_catch: options.object(0).bool_or("allowEmptyCatch", false),
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::Block => self.block(stmt, cx),
            StmtTag::Switch => self.switch(stmt, cx),
            _ => {}
        }
    }
}
