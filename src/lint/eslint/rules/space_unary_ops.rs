use bun_lint::prelude::*;

/// Enforce consistent spacing before or after unary operators.
pub struct SpaceUnaryOps {
    words: bool,
    nonwords: bool,
    overrides: Vec<(Vec<u8>, bool)>,
}

const UNEXPECTED_BEFORE: Message = Message::new(
    "unexpectedBefore",
    "Unexpected space before unary operator '{{operator}}'.",
);
const UNEXPECTED_AFTER: Message = Message::new(
    "unexpectedAfter",
    "Unexpected space after unary operator '{{operator}}'.",
);
const UNEXPECTED_AFTER_WORD: Message = Message::new(
    "unexpectedAfterWord",
    "Unexpected space after unary word operator '{{word}}'.",
);
const WORD_OPERATOR: Message = Message::new(
    "wordOperator",
    "Unary word operator '{{word}}' must be followed by whitespace.",
);
const OPERATOR: Message = Message::new(
    "operator",
    "Unary operator '{{operator}}' must be followed by whitespace.",
);
const BEFORE_UNARY_EXPRESSIONS: Message = Message::new(
    "beforeUnaryExpressions",
    "Space is required before unary expressions '{{token}}'.",
);

/// ESLint's `canTokensBeAdjacent` for the tokens that start at `first` and at `second`.
fn can_be_adjacent<'a>(file: &'a File<'a>, first: u32, second: u32) -> bool {
    match (file.token_at(first), file.token_at(second)) {
        (Some(first), Some(second)) => ast_utils::can_tokens_be_adjacent(first, second),
        _ => false,
    }
}

impl SpaceUnaryOps {
    /// What the override for `operator` says, or else `default`.
    fn wants_space(&self, operator: &str, default: bool) -> bool {
        let mut overrides = self.overrides.iter().rev();
        overrides.find(|it| it.0 == operator.as_bytes()).map_or(default, |it| it.1)
    }

    /// ESLint's `checkUnaryWordOperatorForSpaces`. `e` starts with `word`.
    fn check_word<'a>(&self, e: Expr<'a>, word: &'static str, cx: &Cx<'a, Self>) {
        let start = e.span().start;
        let first = Span::new(start, start + word.len() as u32);
        let second = skip_trivia(cx.text(), first.end);
        if self.wants_space(word, self.words) {
            if second == first.end {
                cx.report(e, WORD_OPERATOR)
                    .data("word", word)
                    .fix(|fixer| fixer.insert_after(first, " "));
            }
        } else if second > first.end && can_be_adjacent(cx.file(), first.start, second) {
            cx.report(e, UNEXPECTED_AFTER_WORD)
                .data("word", word)
                .fix(|fixer| fixer.remove(Span::new(first.end, second)));
        }
    }

    fn check_prefix<'a>(&self, e: Expr<'a>, op: UnOp, operand: Expr<'a>, cx: &Cx<'a, Self>) {
        let operator = un_op_text(op);
        let start = e.span().start;
        let first = Span::new(start, start + operator.len() as u32);
        let second = skip_trivia(cx.text(), first.end);
        if self.wants_space(operator, self.nonwords) {
            // ESLint's `isFirstBangInBangBangExpression`, which does not look at the first operator.
            let is_before_bang = !matches!(op, UnOp::PreInc | UnOp::PreDec)
                && matches!(operand.kind(), ExprKind::Unary { op: UnOp::Not, .. });
            if !is_before_bang && second == first.end {
                cx.report(e, OPERATOR)
                    .data("operator", operator)
                    .fix(|fixer| fixer.insert_after(first, " "));
            }
        } else if second > first.end {
            cx.report(e, UNEXPECTED_AFTER).data("operator", operator).fix(|fixer| {
                can_be_adjacent(fixer.file(), first.start, second)
                    .then(|| fixer.remove(Span::new(first.end, second)))
            });
        }
    }

    fn check_postfix<'a>(&self, e: Expr<'a>, op: UnOp, operand: Expr<'a>, cx: &Cx<'a, Self>) {
        let Some(second) = e.operator_span() else {
            return;
        };
        let operator = un_op_text(op);
        let first_end = operand.outer_span().end;
        if self.wants_space(operator, self.nonwords) {
            if second.start == first_end {
                cx.report(e, BEFORE_UNARY_EXPRESSIONS)
                    .data("token", operator)
                    .fix(|fixer| fixer.insert_before(second, " "));
            }
        } else if second.start > first_end {
            cx.report(e, UNEXPECTED_BEFORE)
                .data("operator", operator)
                .fix(|fixer| fixer.remove(Span::new(first_end, second.start)));
        }
    }

    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.kind() {
            ExprKind::Unary { op, operand } => match op {
                UnOp::Typeof | UnOp::Void | UnOp::Delete => self.check_word(e, un_op_text(op), cx),
                UnOp::PostInc | UnOp::PostDec => self.check_postfix(e, op, operand, cx),
                _ => self.check_prefix(e, op, operand, cx),
            },
            ExprKind::New(_) => self.check_word(e, "new", cx),
            ExprKind::Yield {
                value: Some(_),
                star: false,
            } => self.check_word(e, "yield", cx),
            ExprKind::Await(_) => self.check_word(e, "await", cx),
            _ => {}
        }
    }
}

impl Rule for SpaceUnaryOps {
    const META: Meta = Meta::eslint("space-unary-ops", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let overrides = options.object("overrides").entries().iter();
        SpaceUnaryOps {
            words: options.bool_or("words", true),
            nonwords: options.bool_or("nonwords", false),
            overrides: overrides
                .map(|(operator, value)| (operator.clone(), value.as_bool().unwrap_or(false)))
                .collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs(
            [ExprTag::Unary, ExprTag::New, ExprTag::Yield, ExprTag::Await],
            Self::check,
        );
    }
}
