use bun_lint::prelude::*;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Always,
    Never,
    Consistent,
}

/// Enforce line breaks between arguments of a function call.
pub struct FunctionCallArgumentNewline {
    mode: Mode,
}

const UNEXPECTED_LINE_BREAK: Message =
    Message::new("unexpectedLineBreak", "There should be no line break here.");
const MISSING_LINE_BREAK: Message =
    Message::new("missingLineBreak", "There should be a line break after this argument.");

impl Rule for FunctionCallArgumentNewline {
    const META: Meta = Meta::eslint("function-call-argument-newline", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new().exprs(&[ExprTag::Call, ExprTag::New]);
    no_state!();

    fn new(options: &Options) -> Self {
        FunctionCallArgumentNewline {
            mode: match options.str(0) {
                Some("never") => Mode::Never,
                Some("consistent") => Mode::Consistent,
                _ => Mode::Always,
            },
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Call(call) | ExprKind::New(call)) = e.kind() else {
            return;
        };
        let args = call.args();
        let (Some(first), Some(second)) = (args.get(0), args.get(1)) else {
            return;
        };
        let is_on_same_line =
            |previous: Expr<'a>, current: Expr<'a>| cx.line_of(previous.span().end) == cx.line_of(current.span().start);
        let wants_line_breaks = match self.mode {
            Mode::Always => true,
            Mode::Never => false,
            Mode::Consistent => !is_on_same_line(first, second),
        };
        for (previous, current) in args.iter().zip(args.iter().skip(1)) {
            if is_on_same_line(previous, current) != wants_line_breaks {
                continue;
            }
            let Some(before) = cx.file().tokens_before(current).with_comments().next() else {
                continue;
            };
            let between = Span::before(before.end(), current.span());
            let (message, separator) = match wants_line_breaks {
                true => (MISSING_LINE_BREAK, "\n"),
                false => (UNEXPECTED_LINE_BREAK, " "),
            };
            cx.report(between, message)
                .fix(|fixer| (before.kind() != TokenKind::Line).then(|| fixer.replace(between, separator)));
        }
    }
}
