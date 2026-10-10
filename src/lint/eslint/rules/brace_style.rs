use bun_core::strings;
use super::function_paren_newline::is_on_one_line;
use bun_lint::prelude::*;

/// Enforce consistent brace style for blocks.
pub struct BraceStyle {
    style: Style,
    allow_single_line: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Style {
    OneTbs,
    Stroustrup,
    Allman,
}

const NEXT_LINE_OPEN: Message = Message::new(
    "nextLineOpen",
    "Opening curly brace does not appear on the same line as controlling statement.",
);
const SAME_LINE_OPEN: Message = Message::new(
    "sameLineOpen",
    "Opening curly brace appears on the same line as controlling statement.",
);
const BLOCK_SAME_LINE: Message =
    Message::new("blockSameLine", "Statement inside of curly braces should be on next line.");
const NEXT_LINE_CLOSE: Message = Message::new(
    "nextLineClose",
    "Closing curly brace does not appear on the same line as the subsequent block.",
);
const SINGLE_LINE_CLOSE: Message = Message::new(
    "singleLineClose",
    "Closing curly brace should be on the same line as opening curly brace or on the line after the previous block.",
);
const SAME_LINE_CLOSE: Message = Message::new(
    "sameLineClose",
    "Closing curly brace appears on the same line as the subsequent block.",
);

/// Whether the token before the one at `at` ends on the line that `at` is on.
fn is_token_before_on_same_line<'a>(file: &'a File<'a>, at: u32) -> bool {
    let before = file.text().get(..at as usize).unwrap_or_default();
    let end = strings::trim_js_whitespace_end(before).len();
    if end == 0 || strings::contains_js_line_break(&before[end..]) {
        return false;
    }
    // What is before a token on its line is a token too, or a block comment.
    if !before[..end].ends_with(b"*/") {
        return true;
    }
    let here = Span::empty(at);
    file.token_before(here).is_some_and(|token| ast_utils::is_token_on_same_line(file, token, here))
}

/// ESLint's `removeNewlineBetween`, for what is between the two tokens.
/// There is no fix if a comment is between them.
fn remove_newline_between(fixer: Fixer<'_>, between: Span) -> Option<Fix> {
    strings::is_all_js_whitespace(fixer.file().slice(between)).then(|| fixer.replace(between, " "))
}

impl BraceStyle {
    /// ESLint's `validateCurlyPair`, for the positions of the two braces.
    fn validate_curly_pair(&self, open: u32, close: u32, cx: &Cx<'_, Self>) {
        let (file, source) = (cx.file(), cx.text());
        if source.get(open as usize) != Some(&b'{') || source.get(close as usize) != Some(&b'}') {
            return;
        }
        let (opening, closing) = (Span::new(open, open + 1), Span::new(close, close + 1));
        let after_opening = skip_trivia(source, opening.end);
        let is_empty = after_opening == close;
        let is_single_line_exception = self.allow_single_line && is_on_one_line(file, Span::after(opening, close));
        let is_opening_on_same_line = is_token_before_on_same_line(file, open);

        if self.style != Style::Allman && !is_opening_on_same_line {
            cx.report(opening, NEXT_LINE_OPEN)
                .fix(|fixer| remove_newline_between(fixer, file.token_before(opening)?.span().between(opening)));
        }
        if self.style == Style::Allman && is_opening_on_same_line && !is_single_line_exception {
            cx.report(opening, SAME_LINE_OPEN).fix(|fixer| fixer.insert_before(opening, "\n"));
        }
        if is_empty || is_single_line_exception {
            return;
        }
        if !strings::contains_js_line_break(file.slice(Span::after(opening, after_opening))) {
            cx.report(opening, BLOCK_SAME_LINE).fix(|fixer| fixer.insert_after(opening, "\n"));
        }
        if is_token_before_on_same_line(file, close) {
            cx.report(closing, SINGLE_LINE_CLOSE).fix(|fixer| fixer.insert_before(closing, "\n"));
        }
    }

    fn validate_braces_of(&self, braces: Span, cx: &Cx<'_, Self>) {
        self.validate_curly_pair(braces.start, braces.end.saturating_sub(1), cx);
    }

    /// ESLint's `validateCurlyBeforeKeyword`, for the block that ends with the brace.
    fn validate_curly_before_keyword<'a>(&self, block: Stmt<'a>, cx: &Cx<'a, Self>) {
        let end = block.span().end;
        let curly = Span::new(end.saturating_sub(1), end);
        let before_keyword = Span::after(curly, skip_trivia(cx.text(), end));
        let is_on_same_line = !strings::contains_js_line_break(cx.slice(before_keyword));
        if self.style == Style::OneTbs && !is_on_same_line {
            cx.report(curly, NEXT_LINE_CLOSE).fix(|fixer| remove_newline_between(fixer, before_keyword));
        }
        if self.style != Style::OneTbs && is_on_same_line {
            cx.report(curly, SAME_LINE_CLOSE).fix(|fixer| fixer.insert_after(curly, "\n"));
        }
    }
}

impl Rule for BraceStyle {
    const META: Meta = Meta::eslint("brace-style", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new().stmts(&[StmtTag::Block, StmtTag::Switch, StmtTag::Try]).funcs().classes().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        BraceStyle {
            style: match options.str(0) {
                Some("stroustrup") => Style::Stroustrup,
                Some("allman") => Style::Allman,
                _ => Style::OneTbs,
            },
            allow_single_line: options.object(1).bool_or("allowSingleLine", false),
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.kind() {
            StmtKind::Block(_) => {
                if !ast_utils::is_statement_list_parent(statement.parent()) {
                    self.validate_braces_of(statement.span(), cx);
                }
            }
            StmtKind::Switch { expr, .. } => {
                let close_paren = skip_trivia(cx.text(), expr.outer_span().end);
                let open = skip_trivia(cx.text(), close_paren + 1);
                self.validate_curly_pair(open, statement.span().end.saturating_sub(1), cx);
            }
            StmtKind::If { yes, no: Some(_), .. } => {
                if matches!(yes.kind(), StmtKind::Block(_)) {
                    self.validate_curly_before_keyword(yes, cx);
                }
            }
            StmtKind::Try { block, handler, finalizer, .. } => {
                self.validate_curly_before_keyword(block, cx);
                if let (Some(handler), Some(_)) = (handler, finalizer) {
                    self.validate_curly_before_keyword(handler, cx);
                }
            }
            _ => {}
        }
    }

    // The body of a function, and a static block.
    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(body) = func.body_span() {
            self.validate_braces_of(body, cx);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        self.validate_braces_of(class.body_span(), cx);
    }

    // What an `if` reports at the `}` before its `else` comes after what the block reports there.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for statement in cx.file().stmts_of_kind(StmtTag::If) {
            self.stmt(statement, cx);
        }
    }
}
