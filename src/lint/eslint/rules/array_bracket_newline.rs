use super::function_paren_newline::is_on_one_line;
use bun_lint::prelude::*;

/// Enforce linebreaks after opening and before closing array brackets.
pub struct ArrayBracketNewline {
    is_consistent: bool,
    is_multiline: bool,
    /// `usize::MAX`: no number of elements requires linebreaks.
    min_items: usize,
}

const UNEXPECTED_OPENING_LINEBREAK: Message = Message::new(
    "unexpectedOpeningLinebreak",
    "There should be no linebreak after '['.",
);
const UNEXPECTED_CLOSING_LINEBREAK: Message = Message::new(
    "unexpectedClosingLinebreak",
    "There should be no linebreak before ']'.",
);
const MISSING_OPENING_LINEBREAK: Message =
    Message::new("missingOpeningLinebreak", "A linebreak is required after '['.");
const MISSING_CLOSING_LINEBREAK: Message =
    Message::new("missingClosingLinebreak", "A linebreak is required before ']'.");

impl ArrayBracketNewline {
    /// `span`: the range of ESLint's `ArrayExpression` or `ArrayPattern`.
    fn check<'a>(&self, span: Span, len: usize, cx: &Cx<'a, Self>) -> Option<()> {
        let file = cx.file();
        if len < self.min_items && is_on_one_line(file, span) {
            return None;
        }
        let open_bracket = file.first_token(span)?;
        let close_bracket = file.last_token(span)?;
        let first_inc_comment = file.tokens_after(open_bracket).with_comments().next()?;
        let last_inc_comment = file.tokens_before(close_bracket).with_comments().next()?;
        let first = file.token_after(open_bracket)?;
        let last = file.token_before(close_bracket)?;

        let is_opening_on_same_line = ast_utils::is_token_on_same_line(file, open_bracket, first);
        let is_closing_on_same_line = ast_utils::is_token_on_same_line(file, last, close_bracket);
        let spans_lines = || file.line_of(first_inc_comment.start()) != file.line_of(last_inc_comment.end());
        let needs_linebreaks = len >= self.min_items
            || (self.is_multiline && len > 0 && spans_lines())
            || (len == 0
                && first_inc_comment.kind() == TokenKind::Block
                && first_inc_comment == last_inc_comment
                && spans_lines())
            || (self.is_consistent && !is_opening_on_same_line);

        if needs_linebreaks {
            if is_opening_on_same_line {
                cx.report(open_bracket, MISSING_OPENING_LINEBREAK)
                    .fix(|fixer| fixer.insert_after(open_bracket, "\n"));
            }
            if is_closing_on_same_line {
                cx.report(close_bracket, MISSING_CLOSING_LINEBREAK)
                    .fix(|fixer| fixer.insert_before(close_bracket, "\n"));
            }
        } else {
            if !is_opening_on_same_line {
                cx.report(open_bracket, UNEXPECTED_OPENING_LINEBREAK).fix(|fixer| {
                    (!first_inc_comment.is_comment())
                        .then(|| fixer.remove(open_bracket.span().between(first_inc_comment.span())))
                });
            }
            if !is_closing_on_same_line {
                cx.report(close_bracket, UNEXPECTED_CLOSING_LINEBREAK).fix(|fixer| {
                    (!last_inc_comment.is_comment())
                        .then(|| fixer.remove(last_inc_comment.span().between(close_bracket.span())))
                });
            }
        }
        Some(())
    }
}

impl Rule for ArrayBracketNewline {
    const META: Meta = Meta::eslint("array-bracket-newline", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let (is_consistent, is_multiline, min_items) = match options.str(0) {
            _ if options.is_empty() => (false, true, usize::MAX),
            Some("consistent") => (true, false, usize::MAX),
            Some("always") => (false, false, 0),
            Some("never") => (false, false, usize::MAX),
            _ => match object.usize("minItems") {
                Some(0) => (false, false, 0),
                min_items => (false, object.bool_or("multiline", false), min_items.unwrap_or(usize::MAX)),
            },
        };
        ArrayBracketNewline {
            is_consistent,
            is_multiline,
            min_items,
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Array], |rule, e, cx| {
            if let ExprKind::Array(elements) = e.kind() {
                rule.check(e.span(), elements.len(), cx);
            }
        });
        on.pats([PatTag::Array], |rule, pat, cx| {
            if let PatKind::Array(elements) = pat.kind() {
                rule.check(utils::estree_span(pat.into()), elements.len(), cx);
            }
        });
    }
}
