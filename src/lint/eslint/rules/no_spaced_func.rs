use bun_lint::prelude::*;

/// Disallow spacing between function identifiers and their applications (deprecated).
pub struct NoSpacedFunc;

const NO_SPACED_FUNCTION: Message = Message::new(
    "noSpacedFunction",
    "Unexpected space between function name and paren.",
);

impl NoSpacedFunc {
    fn detect_open_spaces<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Call(call) | ExprKind::New(call)) = e.kind() else {
            return;
        };
        let callee = call.callee().span();
        if cx.text().get(callee.end as usize) == Some(&b'(') {
            return;
        }
        let (file, end) = (cx.file(), e.span().end);
        let Some(last_callee_token) = file.last_token(callee) else {
            return;
        };
        let mut prev_token = last_callee_token;
        let mut paren_token = None;
        for token in file.tokens_after(last_callee_token) {
            if token.end() >= end {
                return;
            }
            if token.is("(") {
                paren_token = Some(token);
                break;
            }
            prev_token = token;
        }
        let Some(paren_token) = paren_token else {
            return;
        };
        if file.is_space_between(prev_token, paren_token) {
            cx.report_at(last_callee_token.start(), NO_SPACED_FUNCTION)
                .fix(|fixer| fixer.remove(Span::new(prev_token.end(), paren_token.start())));
        }
    }
}

impl Rule for NoSpacedFunc {
    const META: Meta = Meta::eslint("no-spaced-func", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoSpacedFunc
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call, ExprTag::New], Self::detect_open_spaces);
    }
}
