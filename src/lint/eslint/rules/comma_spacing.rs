use bun_lint::prelude::*;

/// Enforce consistent spacing before and after commas.
pub struct CommaSpacing {
    before: bool,
    after: bool,
}

const MISSING: Message = Message::new("missing", "A space is required {{loc}} ','.");
const UNEXPECTED: Message = Message::new("unexpected", "There should be no space {{loc}} ','.");

/// ESLint's `addNullElementsToIgnoreList`. `elements`: the range of each element of `array`, `None`
/// for a hole. `ignored` gets where the commas start whose leading whitespace is not checked.
fn add_null_elements_to_ignore_list<'a>(
    file: &'a File<'a>,
    array: Span,
    elements: impl Iterator<Item = Option<Span>>,
    ignored: &mut Vec<u32>,
) {
    let mut previous = file.first_token(array);
    for element in elements {
        let token = match (element, previous) {
            (Some(element), _) => file.token_after(element),
            (None, Some(previous)) => {
                let token = file.token_after(previous);
                ignored.extend(token.filter(ast_utils::is_comma_token).map(Token::start));
                token
            }
            (None, None) => return,
        };
        previous = token;
    }
}

impl CommaSpacing {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        cx.state.sort_unstable();
        let mut tokens = file.tokens().with_comments().peekable();
        let mut previous: Option<Token<'a>> = None;
        while let Some(token) = tokens.next() {
            if ast_utils::is_comma_token(&token) {
                if let Some(previous) = previous
                    && !ast_utils::is_comma_token(&previous)
                    && self.before != (previous.end() < token.start())
                    && ast_utils::is_token_on_same_line(file, previous, token)
                    && cx.state.binary_search(&token.start()).is_err()
                {
                    self.report_before(token, previous, cx);
                }
                if let Some(&next) = tokens.peek()
                    && !(next.kind() == TokenKind::Punctuator && matches!(next.text(), b"," | b")" | b"]" | b"}"))
                    && (self.after || next.kind() != TokenKind::Line)
                    && self.after != (token.end() < next.start())
                    && ast_utils::is_token_on_same_line(file, token, next)
                {
                    self.report_after(token, next, cx);
                }
            }
            previous = Some(token);
        }
    }

    fn report_before<'a>(&self, comma: Token<'a>, previous: Token<'a>, cx: &Cx<'a, Self>) {
        let is_required = self.before;
        cx.report(comma, if is_required { MISSING } else { UNEXPECTED })
            .data("loc", "before")
            .fix(|fixer| match is_required {
                true => fixer.insert_before(comma, " "),
                false => fixer.remove(previous.span().between(comma.span())),
            });
    }

    fn report_after<'a>(&self, comma: Token<'a>, next: Token<'a>, cx: &Cx<'a, Self>) {
        let is_required = self.after;
        cx.report(comma, if is_required { MISSING } else { UNEXPECTED })
            .data("loc", "after")
            .fix(|fixer| match is_required {
                true => fixer.insert_after(comma, " "),
                false => fixer.remove(comma.span().between(next.span())),
            });
    }
}

impl Rule for CommaSpacing {
    const META: Meta = Meta::eslint("comma-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    /// Where the commas start that end a hole in an array.
    type State<'a> = Vec<u32>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        CommaSpacing {
            before: options.bool_or("before", false),
            after: options.bool_or("after", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Vec<u32> {
        on.exprs([ExprTag::Array], |_, e, cx| {
            let ExprKind::Array(elements) = e.kind() else {
                return;
            };
            if elements.iter().any(Expr::is_missing) {
                let spans = elements.iter().map(|it| (!it.is_missing()).then(|| it.span()));
                add_null_elements_to_ignore_list(cx.file(), e.span(), spans, &mut cx.state);
            }
        });
        on.pats([PatTag::Array], |_, pat, cx| {
            let PatKind::Array(elements) = pat.kind() else {
                return;
            };
            if elements.iter().any(|it| it.pat().is_none()) {
                let spans = elements.iter().map(|it| it.pat().map(|_| it.span()));
                add_null_elements_to_ignore_list(cx.file(), pat.span(), spans, &mut cx.state);
            }
        });
        on.finish(Self::check);
        Vec::new()
    }
}
