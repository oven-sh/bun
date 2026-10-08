use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::tokens::next_token;

/// Require or disallow spacing between function identifiers and their invocations.
pub struct FuncCallSpacing {
    is_never: bool,
    allows_newlines: bool,
}

const UNEXPECTED_WHITESPACE: Message = Message::new(
    "unexpectedWhitespace",
    "Unexpected whitespace between function name and paren.",
);
const UNEXPECTED_NEWLINE: Message = Message::new(
    "unexpectedNewline",
    "Unexpected newline between function name and paren.",
);
const MISSING: Message = Message::new("missing", "Missing space between function name and paren.");

/// Whether there is whitespace, and whether there is a line break, in
/// `between.replace(/\/\*.*?\*\//gu, "")`: a comment of several lines stays.
fn whitespace_in(between: &[u8]) -> (bool, bool) {
    let (mut has_whitespace, mut has_newline) = (false, false);
    let mut comment_end = 0;
    for (at, c) in text::code_points(between) {
        if at < comment_end {
            continue;
        }
        if let Some(inside) = between.get(at..).and_then(|rest| rest.strip_prefix(b"/*"))
            && let Some(len) = strings::index_of(inside, b"*/")
            && !text::has_line_break(&inside[..len])
        {
            comment_end = at + len + 4;
            continue;
        }
        has_whitespace |= text::is_js_whitespace(c);
        has_newline |= text::is_line_terminator(c);
    }
    (has_whitespace, has_newline)
}

impl FuncCallSpacing {
    /// `left`: the end of the last token of the callee, which may be a `)` or the `>` of type
    /// arguments. `right`: the start of the `(` of the arguments.
    fn check_spacing<'a>(&self, is_optional: bool, left: u32, right: u32, cx: &Cx<'a, Self>) {
        if left == right && self.is_never {
            return;
        }
        let between = Span::new(left, right);
        let (has_whitespace, has_newline) = whitespace_in(cx.slice(between));
        let has_comments =
            |fixer: Fixer<'a>| fixer.file().comments_exist_between(Span::empty(left), Span::empty(right));

        if self.is_never && has_whitespace {
            let end = cx.position(right);
            let report = match end.column.checked_sub(1) {
                Some(column) => {
                    let end = cx.offset(Position { line: end.line, column });
                    cx.report(Span::new(left, end), UNEXPECTED_WHITESPACE)
                }
                // Upstream's column is -1.
                None => cx.report(between, UNEXPECTED_WHITESPACE).end_at(Position {
                    line: end.line,
                    column: u32::MAX,
                }),
            };
            report.fix(|fixer| {
                if has_comments(fixer) {
                    return None;
                }
                if is_optional {
                    return Some(fixer.replace(between, "?."));
                }
                (!has_newline).then(|| fixer.remove(between))
            });
        } else if !self.is_never && !has_whitespace {
            let start = cx.position(left);
            let start = cx.offset(Position {
                line: start.line,
                column: start.column.saturating_sub(1),
            });
            cx.report(Span::new(start, right), MISSING)
                .fix(|fixer| (!is_optional).then(|| fixer.insert_before(Span::empty(right), " ")));
        } else if !self.is_never && !self.allows_newlines && has_newline {
            cx.report(between, UNEXPECTED_NEWLINE).fix(|fixer| {
                if !is_optional || has_comments(fixer) {
                    return None;
                }
                let question_dot = next_token(fixer.file().text(), left);
                Some(fixer.replace(
                    between,
                    if question_dot.start == left {
                        "?. "
                    } else if question_dot.end == right {
                        " ?."
                    } else {
                        " ?. "
                    },
                ))
            });
        }
    }

    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Call(call) | ExprKind::New(call)) = e.kind() else {
            return;
        };
        // `new C`
        if call.close_paren().is_none() {
            return;
        }
        let (callee, file) = (call.callee(), cx.file());
        let (left, right) = match call.type_args().angle_brackets_span() {
            None => {
                let left = callee.outer_span().end;
                let mut right = skip_trivia(file.text(), left);
                if call.is_optional() {
                    right = skip_trivia(file.text(), right + 2);
                }
                (left, right)
            }
            Some(type_args) if !strings::contains_char(file.slice(type_args), b'(') => {
                (type_args.end, skip_trivia(file.text(), type_args.end))
            }
            // Upstream takes the first `(` after the callee, also if it is in the type arguments.
            Some(_) => {
                let (Some(last_of_callee), Some(last)) = (file.last_token(callee), file.last_token(e)) else {
                    return;
                };
                let Some(paren) = file.tokens_between(last_of_callee, last).find(ast_utils::is_opening_paren_token)
                else {
                    return;
                };
                let Some(before) = file.tokens_before(paren).find(ast_utils::is_not_question_dot_token) else {
                    return;
                };
                (before.end(), paren.start())
            }
        };
        self.check_spacing(call.is_optional(), left, right, cx);
    }

    fn check_import<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let left = e.span().start + "import".len() as u32;
        self.check_spacing(false, left, skip_trivia(cx.text(), left), cx);
    }
}

impl Rule for FuncCallSpacing {
    const META: Meta = Meta::eslint("func-call-spacing", Kind::Layout).fixable(Fixable::Whitespace).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let is_never = options.str(0) != Some("always");
        FuncCallSpacing {
            is_never,
            allows_newlines: !is_never && options.object(1).bool_or("allowNewlines", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call, ExprTag::New], Self::check_call);
        on.exprs([ExprTag::ImportCall], Self::check_import);
    }
}
