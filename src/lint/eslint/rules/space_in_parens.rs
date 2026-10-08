use bun_lint::prelude::*;

/// Enforce consistent spacing inside parentheses.
pub struct SpaceInParens {
    is_always: bool,
    has_brace_exception: bool,
    has_bracket_exception: bool,
    has_paren_exception: bool,
    has_empty_exception: bool,
}

const MISSING_OPENING_SPACE: Message =
    Message::new("missingOpeningSpace", "There must be a space after this paren.");
const MISSING_CLOSING_SPACE: Message =
    Message::new("missingClosingSpace", "There must be a space before this paren.");
const REJECTED_OPENING_SPACE: Message =
    Message::new("rejectedOpeningSpace", "There should be no space after this paren.");
const REJECTED_CLOSING_SPACE: Message =
    Message::new("rejectedClosingSpace", "There should be no space before this paren.");

/// ESLint's `token.value`.
fn value(token: Token<'_>) -> &[u8] {
    match token.is_comment() {
        true => token.comment_value(),
        false => token.text(),
    }
}

impl SpaceInParens {
    fn is_opener_exception(&self, token: Token) -> bool {
        match value(token) {
            b"{" => self.has_brace_exception,
            b"[" => self.has_bracket_exception,
            b"(" => self.has_paren_exception,
            b")" => self.has_empty_exception,
            _ => false,
        }
    }

    fn is_closer_exception(&self, token: Token) -> bool {
        match value(token) {
            b"}" => self.has_brace_exception,
            b"]" => self.has_bracket_exception,
            b")" => self.has_paren_exception,
            b"(" => self.has_empty_exception,
            _ => false,
        }
    }

    fn check_opener<'a>(&self, paren: Token<'a>, next: Token<'a>, cx: &Cx<'a, Self>) {
        let is_exception = self.is_opener_exception(next);
        if paren.end() == next.start() {
            let is_empty = !self.has_empty_exception && next.is_punctuator(")");
            if !is_empty && self.is_always != is_exception {
                cx.report(paren, MISSING_OPENING_SPACE).fix(|fixer| fixer.insert_after(paren, " "));
            }
        } else if self.is_always == is_exception
            && next.kind() != TokenKind::Line
            && ast_utils::is_token_on_same_line(cx.file(), paren, next)
        {
            let space = paren.span().between(next.span());
            cx.report(space, REJECTED_OPENING_SPACE).fix(|fixer| fixer.remove(space));
        }
    }

    fn check_closer<'a>(&self, previous: Token<'a>, paren: Token<'a>, cx: &Cx<'a, Self>) {
        let is_exception = self.is_closer_exception(previous);
        if previous.end() == paren.start() {
            let is_empty = !self.has_empty_exception && previous.is_punctuator("(");
            if !is_empty && self.is_always != is_exception {
                cx.report(paren, MISSING_CLOSING_SPACE).fix(|fixer| fixer.insert_before(paren, " "));
            }
        } else if self.is_always == is_exception
            && ast_utils::is_token_on_same_line(cx.file(), previous, paren)
        {
            let space = previous.span().between(paren.span());
            cx.report(space, REJECTED_CLOSING_SPACE).fix(|fixer| fixer.remove(space));
        }
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut tokens = cx.file().tokens().with_comments().peekable();
        let mut previous = None;
        while let Some(token) = tokens.next() {
            if token.is_punctuator("(")
                && let Some(&next) = tokens.peek()
            {
                self.check_opener(token, next, cx);
            } else if token.is_punctuator(")")
                && let Some(previous) = previous
            {
                self.check_closer(previous, token, cx);
            }
            previous = Some(token);
        }
    }
}

impl Rule for SpaceInParens {
    const META: Meta = Meta::eslint("space-in-parens", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let exceptions = options.object(1).strings("exceptions");
        SpaceInParens {
            is_always: options.str(0) == Some("always"),
            has_brace_exception: exceptions.contains(&"{}"),
            has_bracket_exception: exceptions.contains(&"[]"),
            has_paren_exception: exceptions.contains(&"()"),
            has_empty_exception: exceptions.contains(&"empty"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}
