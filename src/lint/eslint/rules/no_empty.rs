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
    /// `braces` is a `{ }` with no statements or cases, so it can only contain whitespace and comments. `place` is where to
    /// report. `removed` returns what oxlint suggests removing. `is_handler` returns whether it's the block of a `catch`.
    fn check(
        braces: Span,
        place: Span,
        kind: &'static str,
        (removed, is_handler): (&dyn Fn() -> Option<Span>, &dyn Fn() -> bool),
        cx: &Cx<'_, Self>,
    ) {
        let inside = braces.shrink(1, 1);
        if !strings::is_all_js_whitespace(cx.slice(inside)) {
            return;
        }
        let report = cx
            .report(place, UNEXPECTED)
            .data("type", kind)
            .hint(match is_handler() {
                true => "Handle the error, or put a comment in it that says why the error is ignored.",
                false => "Remove it, or put a comment in it that says why it is empty.",
            });
        if cx.language().is_oxlint {
            report.fix(|fixer| removed().map(|it| fixer.remove(it)));
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
        let is_handler = || {
            matches!(stmt.parent(), Node::Stmt(parent)
                if matches!(parent.kind(), StmtKind::Try { handler, .. } if handler == Some(stmt)))
        };
        if self.allow_empty_catch && is_handler() {
            return;
        }
        Self::check(stmt.span(), stmt.span(), "block", (&|| removed_by_oxlint(stmt), &is_handler), cx);
    }

    fn switch<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some((expr, cases)) = stmt.as_switch() else {
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
            return Self::check(braces, braces, "switch", (&|| None, &|| false), cx);
        }
        // oxlint points at the whole statement, which a comment does not fill.
        if strings::is_all_js_whitespace(cx.slice(braces.shrink(1, 1))) {
            Self::check(braces, stmt.span(), "switch", (&|| Some(stmt.span()), &|| false), cx);
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
        .recommended()
        .hints();
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
