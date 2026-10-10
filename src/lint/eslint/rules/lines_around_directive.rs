use bun_core::strings;
use bun_lint::prelude::*;

/// Require or disallow newlines around directives.
pub struct LinesAroundDirective {
    /// `Some(true)` for `"always"`, `Some(false)` for `"never"`.
    expects_line_before: Option<bool>,
    expects_line_after: Option<bool>,
}

const EXPECTED: Message = Message::new(
    "expected",
    "Expected newline {{location}} \"{{value}}\" directive.",
);
const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Unexpected newline {{location}} \"{{value}}\" directive.",
);

#[derive(Copy, Clone)]
enum Location {
    Before,
    /// With the end of ESLint's `getLastTokenOnLine`.
    After(u32),
}

/// What ESLint's `getDirectivePrologue` collects.
fn is_directive(statement: Stmt) -> bool {
    matches!(statement.kind(), StmtKind::Expr(e) if ast_utils::is_literal(e))
}

/// The end of ESLint's `getLastTokenOnLine`: of the last token of the directive, or of the one
/// before it if the last is a semicolon on a later line.
fn end_of_last_token_on_line(directive: Stmt) -> u32 {
    let file = directive.file();
    match (directive.kind(), directive.semicolon()) {
        (StmtKind::Expr(e), Some(semicolon))
            if file.line_of(semicolon.start) > file.line_of(e.outer_span().end) =>
        {
            e.outer_span().end
        }
        _ => directive.span().end,
    }
}

fn expectation(value: Option<&str>) -> Option<bool> {
    match value {
        Some("always") => Some(true),
        Some("never") => Some(false),
        _ => None,
    }
}

impl LinesAroundDirective {
    fn report<'a>(cx: &Cx<'a, Self>, directive: Stmt<'a>, location: Location, is_expected: bool) {
        let StmtKind::Expr(e) = directive.kind() else {
            return;
        };
        cx.report(directive, if is_expected { EXPECTED } else { UNEXPECTED })
            .data("value", ast_utils::get_static_string_value(e).unwrap_or_default())
            .data(
                "location",
                match location {
                    Location::Before => "before",
                    Location::After(_) => "after",
                },
            )
            .fix(|fixer| match (location, is_expected) {
                (Location::Before, true) => fixer.insert_before(directive, "\n"),
                (Location::After(end), true) => fixer.insert_after(Span::empty(end), "\n"),
                (Location::Before, false) => {
                    let directive = directive.span();
                    let before = text::last_code_point(fixer.file().slice(Span::before(0, directive)));
                    let len = before.and_then(char::from_u32).map_or(1, char::len_utf8) as u32;
                    fixer.remove(Span::before(directive.start.saturating_sub(len), directive))
                }
                (Location::After(at), false) => {
                    let after = fixer.file().slice(Span::new(at, fixer.file().span().end));
                    fixer.remove(Span::new(at, at + strings::wtf8_offset_of_utf16_index(after, 1) as u32))
                }
            });
    }

    fn check<'a>(&self, statements: List<'a, Stmt<'a>>, is_program: bool, cx: &Cx<'a, Self>) {
        let mut directives = statements.iter().take_while(|it| is_directive(*it));
        let Some(first) = directives.next() else {
            return;
        };
        let last = directives.last().unwrap_or(first);
        let file = cx.file();

        // Without a comment before it, only the start of the file is checked, and only for
        // `"never"`: no line is required there, and `padded-blocks` has a say about the others.
        let line_before = match file.comments_before(first).next_back() {
            Some(comment) => Some(file.line_of(comment.end())),
            None => (is_program && self.expects_line_before == Some(false)).then_some(0),
        };
        if let Some(line_before) = line_before {
            let has_newline_before = file.line_of(first.span().start) - line_before >= 2;
            if self.expects_line_before == Some(!has_newline_before) {
                Self::report(cx, first, Location::Before, !has_newline_before);
            }
        }

        if statements.last() == Some(last) {
            return;
        }
        let end = end_of_last_token_on_line(last);
        let next = match file.comments_after(Span::empty(end)).next() {
            Some(comment) => comment.start(),
            None => skip_trivia(file.text(), end),
        };
        let has_newline_after = file.line_of(next) - file.line_of(end) >= 2;
        if self.expects_line_after == Some(!has_newline_after) {
            Self::report(cx, last, Location::After(end), !has_newline_after);
        }
    }
}

impl Rule for LinesAroundDirective {
    const META: Meta = Meta::eslint("lines-around-directive", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new().funcs().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        let (before, after) = match options.get(0).and_then(Json::as_object) {
            Some(_) => (options.object(0).str("before"), options.object(0).str("after")),
            None => {
                let config = options.str(0).unwrap_or("always");
                (Some(config), Some(config))
            }
        };
        LinesAroundDirective {
            expects_line_before: expectation(before),
            expects_line_after: expectation(after),
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if func.kind() != FnKind::StaticBlock
            && let Some(statements) = func.body_statements()
        {
            self.check(statements, false, cx);
        }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        self.check(cx.file().body(), true, cx);
    }
}
