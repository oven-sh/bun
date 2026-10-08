use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::tokens::next_token;
use smallvec::SmallVec;

/// Enforce consistent line breaks inside function parentheses.
pub struct FunctionParenNewline {
    mode: Mode,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Multiline,
    MultilineArguments,
    Consistent,
    /// `"always"` is 0, `"never"` is more than there can be.
    MinItems(usize),
}

const EXPECTED_BEFORE: Message = Message::new("expectedBefore", "Expected newline before ')'.");
const EXPECTED_AFTER: Message = Message::new("expectedAfter", "Expected newline after '('.");
const EXPECTED_BETWEEN: Message =
    Message::new("expectedBetween", "Expected newline between arguments/params.");
const UNEXPECTED_BEFORE: Message = Message::new("unexpectedBefore", "Unexpected newline before ')'.");
const UNEXPECTED_AFTER: Message = Message::new("unexpectedAfter", "Unexpected newline after '('.");

#[derive(Copy, Clone)]
struct Parens {
    left: Span,
    right: Span,
    /// Where the token before `right` ends.
    before_right: u32,
}

/// Where the last token of a list ends whose last element ends at `last_end`: there, or after a
/// trailing comma.
fn end_of_list(text: &[u8], last_end: u32) -> u32 {
    let at = skip_trivia(text, last_end);
    if text.get(at as usize) == Some(&b',') { at + 1 } else { last_end }
}

/// The `(` at `at`.
fn opening_paren_at(text: &[u8], at: u32) -> Option<Span> {
    (text.get(at as usize) == Some(&b'(')).then(|| Span::new(at, at + 1))
}

/// Whether there is a `(` between the angle brackets, which upstream takes for the one it looks
/// for.
fn has_paren(file: &File, angle_brackets: Option<Span>) -> bool {
    angle_brackets.is_some_and(|it| strings::contains_char(file.slice(it), b'('))
}

/// The first `(` after the callee.
fn opening_paren_of_call<'a>(file: &'a File<'a>, call: Call<'a>) -> Option<Span> {
    let (text, callee) = (file.text(), call.callee());
    let type_args = call.type_args().angle_brackets_span();
    if has_paren(file, type_args) {
        return file.tokens_after(callee).find(ast_utils::is_opening_paren_token).map(Token::span);
    }
    let mut at = skip_trivia(text, type_args.map_or_else(|| callee.outer_span().end, |it| it.end));
    if text.get(at as usize..).is_some_and(|it| it.starts_with(b"?.")) {
        at = skip_trivia(text, at + 2);
    }
    opening_paren_at(text, at)
}

/// The first `(` of a function that is not an arrow function.
fn opening_paren_of_function<'a>(file: &'a File<'a>, func: Func<'a>) -> Option<Span> {
    if has_paren(file, func.type_params().angle_brackets_span()) {
        return file.tokens_in(func.estree_span()).find(ast_utils::is_opening_paren_token).map(Token::span);
    }
    opening_paren_at(file.text(), func.open_paren()?)
}

/// The first token of an arrow function, after `async`, if it is a `(`.
fn opening_paren_of_arrow_function(file: &File, func: Func) -> Option<Span> {
    let (text, start) = (file.text(), func.estree_span().start);
    let first = if func.is_async() { skip_trivia(text, start + "async".len() as u32) } else { start };
    opening_paren_at(text, first)
}

/// Whether there is no line break in `span`. The start of it is looked at, where most that have one have the first. What is
/// left of a long one is asked of the lines of the file, which does not take time in proportion to its length.
#[inline]
pub(crate) fn is_on_one_line(file: &File<'_>, span: Span) -> bool {
    const LOOKED_AT: u32 = 512;
    if span.len() <= LOOKED_AT {
        return !text::has_line_break(file.slice(span));
    }
    let middle = span.start + LOOKED_AT;
    !text::has_line_break(file.slice(Span::new(span.start, middle))) && file.is_on_same_line(middle, span.end)
}

impl FunctionParenNewline {
    /// `count`: how many `elements` there are.
    fn validate<'a>(
        &self,
        cx: &Cx<'a, Self>,
        parens: Parens,
        count: usize,
        elements: &mut dyn Iterator<Item = Span>,
    ) {
        let file = cx.file();
        let Parens {
            left,
            right,
            before_right,
        } = parens;
        let is_on_one_line = is_on_one_line(file, left.between(right));
        if is_on_one_line && !matches!(self.mode, Mode::MinItems(min_items) if count >= min_items) {
            return;
        }

        let after_left = Span::after(left, skip_trivia(file.text(), left.end));
        let before_right = Span::before(before_right, right);
        let has_left_newline = text::has_line_break(file.slice(after_left));
        let has_right_newline = text::has_line_break(file.slice(before_right));
        let elements: SmallVec<[Span; 8]> = elements.collect();
        let pairs = || elements.iter().zip(elements.iter().skip(1));
        let needs_newlines = match self.mode {
            Mode::MultilineArguments if elements.len() == 1 => has_left_newline,
            Mode::Multiline | Mode::MultilineArguments => {
                pairs().any(|(current, next)| !ast_utils::is_token_on_same_line(file, current, next))
            }
            Mode::Consistent => has_left_newline,
            Mode::MinItems(min_items) => elements.len() >= min_items,
        };
        // Not if there is a comment.
        let remove = |fixer: Fixer<'a>, space: Span| text::trim(file.slice(space)).is_empty().then(|| fixer.remove(space));

        if has_left_newline && !needs_newlines {
            cx.report(left, UNEXPECTED_AFTER).fix(|fixer| remove(fixer, after_left));
        } else if !has_left_newline && needs_newlines {
            cx.report(left, EXPECTED_AFTER).fix(|fixer| fixer.insert_after(left, "\n"));
        }

        if has_right_newline && !needs_newlines {
            cx.report(right, UNEXPECTED_BEFORE).fix(|fixer| remove(fixer, before_right));
        } else if !has_right_newline && needs_newlines {
            cx.report(right, EXPECTED_BEFORE).fix(|fixer| fixer.insert_before(right, "\n"));
        }

        if self.mode == Mode::MultilineArguments && needs_newlines {
            for (&current, &next) in pairs() {
                if ast_utils::is_token_on_same_line(file, current, next) {
                    cx.report(current, EXPECTED_BETWEEN).fix(|fixer| fixer.insert_before(next, "\n"));
                }
            }
        }
    }

    fn check_function<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !func.has_body() {
            return;
        }
        let (file, text) = (cx.file(), cx.text());
        let left = match func.kind() {
            FnKind::Arrow => opening_paren_of_arrow_function(file, func),
            FnKind::Decl | FnKind::Expr | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
                opening_paren_of_function(file, func)
            }
            _ => None,
        };
        let Some(left) = left else {
            return;
        };
        let params = func.params();
        let parens = match params.last().or_else(|| func.this_param()) {
            Some(last) => {
                let before_right = end_of_list(text, last.span().end);
                let right = skip_trivia(text, before_right);
                if text.get(right as usize) != Some(&b')') {
                    return;
                }
                Parens {
                    left,
                    right: Span::new(right, right + 1),
                    before_right,
                }
            }
            // Upstream takes the token after `left`, whatever it is.
            None => Parens {
                left,
                right: next_token(text, left.end),
                before_right: left.end,
            },
        };
        let count = params.len() + usize::from(func.this_param().is_some());
        let mut elements = func.params_with_this().map(|it| utils::estree_span(Node::Param(it)));
        self.validate(cx, parens, count, &mut elements);
    }

    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (file, text) = (cx.file(), cx.text());
        let before_right = |args: List<'a, Expr<'a>>, right: u32| match args.last() {
            Some(last) => end_of_list(text, last.outer_span().end),
            None => file.end_of_token_before(right),
        };
        match e.kind() {
            ExprKind::Call(call) | ExprKind::New(call) => {
                // `new C` has none.
                let Some(right) = call.close_paren() else {
                    return;
                };
                let Some(left) = opening_paren_of_call(file, call) else {
                    return;
                };
                let args = call.args();
                let parens = Parens {
                    left,
                    right: Span::new(right, right + 1),
                    before_right: before_right(args, right),
                };
                self.validate(cx, parens, args.len(), &mut args.iter().map(|it| it.span()));
            }
            ExprKind::ImportCall { args } => {
                let whole = e.span();
                let right = whole.end.saturating_sub(1);
                let parens = Parens {
                    left: next_token(text, whole.start + "import".len() as u32),
                    right: Span::new(right, whole.end),
                    before_right: before_right(args, right),
                };
                // Only the source counts.
                self.validate(cx, parens, 1, &mut args.first().into_iter().map(|it| it.span()));
            }
            _ => {}
        }
    }
}

impl Rule for FunctionParenNewline {
    const META: Meta = Meta::eslint("function-paren-newline", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let mode = match options.str(0) {
            Some("always") => Mode::MinItems(0),
            Some("never") => Mode::MinItems(usize::MAX),
            Some("consistent") => Mode::Consistent,
            Some("multiline-arguments") => Mode::MultilineArguments,
            Some(_) => Mode::Multiline,
            None if options.get(0).is_some_and(|it| it.as_object().is_some()) => {
                Mode::MinItems(options.object(0).usize("minItems").unwrap_or(usize::MAX))
            }
            None => Mode::Multiline,
        };
        FunctionParenNewline { mode }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(Self::check_function);
        on.exprs([ExprTag::Call, ExprTag::New, ExprTag::ImportCall], Self::check_call);
    }
}
