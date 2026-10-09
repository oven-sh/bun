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
    text::has_line_break(file.slice(Span::after(before, open))).then(|| Span::new(open, open + 1))
}

/// With `--fix-dangerously` oxlint puts a `;` before it.
fn report<'a>(at: Span, message: Message, cx: &Cx<'a, NoUnexpectedMultiline>) {
    let report = cx.report(at, message);
    if cx.language().is_oxlint {
        report.fix_dangerously(|fixer| fixer.insert_before(at, ";"));
    }
}

impl NoUnexpectedMultiline {
    fn check_index<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Index { obj, chain, .. } = e.kind()
            && chain != Chain::Start
            && let Some(open) = break_after(obj)
        {
            report(open, PROPERTY, cx);
        }
    }

    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Call(call) = e.kind()
            && !call.is_optional()
            && !call.args().is_empty()
            && let Some(open) = break_after(call.callee())
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
        if !text::has_line_break(cx.slice(call.callee().outer_span().between(template))) {
            return;
        }
        if !call.type_args().is_empty() {
            let Some(before) = cx.file().token_before(Span::empty(template.start)) else {
                return;
            };
            if !text::has_line_break(cx.slice(before.span().between(template))) {
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
    const META: Meta = Meta::eslint("no-unexpected-multiline", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnexpectedMultiline
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Index], Self::check_index);
        on.exprs([ExprTag::Call], Self::check_call);
        on.exprs([ExprTag::TaggedTemplate], Self::check_tagged_template);
        on.binaries([BinOp::Div], Self::check_division);
    }
}
