use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow confusing multiline expressions.
pub struct NoUnexpectedMultiline;

const FUNCTION: Message = Message::new(
    "function",
    "Unexpected newline between function and ( of function call.",
);
const PROPERTY: Message = Message::new(
    "property",
    "Unexpected newline between object and [ of property access.",
);
const TAGGED_TEMPLATE: Message = Message::new(
    "taggedTemplate",
    "Unexpected newline between template tag and template literal.",
);
const DIVISION: Message = Message::new(
    "division",
    "Unexpected newline between numerator and division operator.",
);

/// The token after `e` and its parentheses, which is one character long, if it is on another line
/// than what is before it.
fn break_after(e: Expr) -> Option<Span> {
    let file = e.file();
    let before = e.outer_span();
    // Nearly always the token follows at once.
    if !matches!(file.text().get(before.end as usize), Some(b'\t'..=b'\r' | b' ' | b'/' | 0x80..)) {
        return None;
    }
    let open = skip_trivia(file.text(), before.end);
    strings::contains_js_line_break(file.slice(Span::after(before, open))).then(|| Span::new(open, open + 1))
}

/// The `(` of a call with type arguments, if it is on another line than their `>`: where oxlint looks.
fn break_after_type_args<'a>(call: Call<'a>, file: &'a File<'a>) -> Option<Span> {
    let text = file.text();
    let is = |at: u32, byte: u8| text.get(at as usize) == Some(&byte);
    // Nearly always `>(` follows the last of them, and it takes no tokens of the file to see that.
    let mut close = skip_trivia(text, call.type_args().last()?.span().end);
    while is(close, b')') || is(close, b',') {
        close = skip_trivia(text, close + 1);
    }
    let open = skip_trivia(text, close + 1);
    if is(close, b'>') && is(open, b'(') {
        let between = file.slice(Span::new(close + 1, open));
        return strings::contains_js_line_break(between).then(|| Span::new(open, open + 1));
    }
    let open = file.token_before(call.args().first()?.outer_span())?.span();
    let close = file.token_before(open)?.span();
    strings::contains_js_line_break(file.slice(close.between(open))).then_some(open)
}

/// With `--fix-dangerously` oxlint puts a `;` before it.
fn report<'a>(at: Span, message: Message, cx: &Cx<'a, NoUnexpectedMultiline>) {
    let report = cx.report(at, message).hint("This line continues the one before. End that one with a semicolon.");
    if cx.language().is_oxlint {
        report.fix_dangerously(|fixer| fixer.insert_before(at, ";"));
    }
}

impl NoUnexpectedMultiline {
    fn check_index<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some((obj, _, chain)) = e.as_index()
            && chain != Chain::Start
            && let Some(open) = break_after(obj)
        {
            report(open, PROPERTY, cx);
        }
    }

    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // oxlint looks at a call without arguments too, and not at the last call of an optional chain.
        let is_oxlint = cx.language().is_oxlint;
        if let Some(call) = e.as_call()
            && !call.is_optional()
            && match is_oxlint {
                true => !e.is_chain_root(),
                false => !call.args().is_empty(),
            }
            && let Some(open) = match is_oxlint && !call.type_args().is_empty() {
                true => break_after_type_args(call, cx.file()),
                false => break_after(call.callee()),
            }
        {
            report(open, FUNCTION, cx);
        }
    }

    fn check_tagged_template<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::TaggedTemplate(call) = e.kind() else {
            return;
        };
        let Some(template) = call.template().map(|it| it.span()) else {
            return;
        };
        if !strings::contains_js_line_break(cx.slice(call.callee().outer_span().between(template))) {
            return;
        }
        if !call.type_args().is_empty() {
            let Some(before) = cx.file().token_before(Span::empty(template.start)) else {
                return;
            };
            if !strings::contains_js_line_break(cx.slice(before.span().between(template))) {
                return;
            }
        }
        report(Span::new(template.start, template.start + 1), TAGGED_TEMPLATE, cx);
    }

    /// `a / b / c` where `/ b /c` looks like a regular expression with the flags `c`.
    fn check_division<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary {
            op: BinOp::Div,
            left: inner,
            ..
        } = e.kind()
        else {
            return;
        };
        let ExprKind::Binary {
            op: BinOp::Div,
            left,
            ..
        } = inner.kind()
        else {
            return;
        };
        let Some(first_slash) = break_after(left) else {
            return;
        };
        let Some(second_slash) = e.operator_span() else {
            return;
        };
        // oxlint compares how far behind `a` the line ends with where `a` starts in the file.
        if cx.language().is_oxlint
            && strings::index_of_char_usize(cx.slice(Span::new(left.span().end, e.span().end)), b'\n')
                .is_none_or(|newline| newline >= inner.span().start as usize)
        {
            return;
        }
        if let Some(after) = cx.file().token_after(second_slash)
            && after.kind() == TokenKind::Identifier
            && after.start() == second_slash.end
            && after.value().iter().all(|c| match c {
                b'g' | b'i' | b'm' | b's' | b'u' | b'y' => true,
                // oxlint does not know these flags.
                b'd' | b'v' => !cx.language().is_oxlint,
                _ => false,
            })
        {
            report(first_slash, DIVISION, cx);
        }
    }
}

impl Rule for NoUnexpectedMultiline {
    const META: Meta = Meta::eslint("no-unexpected-multiline", Kind::Problem).recommended().hints();
    const ON: On = On::new()
        .exprs(&[ExprTag::Index, ExprTag::Call, ExprTag::TaggedTemplate])
        .binaries(&[BinOp::Div]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUnexpectedMultiline
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Index => self.check_index(e, cx),
            ExprTag::Call => self.check_call(e, cx),
            ExprTag::TaggedTemplate => self.check_tagged_template(e, cx),
            _ => {}
        }
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check_division(e, cx);
    }
}
