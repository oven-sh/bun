use bun_core::strings;
use bun_lint::prelude::*;
use std::borrow::Cow;

/// Enforce consistent linebreak style for operators.
pub struct OperatorLinebreak {
    global_style: Style,
    overrides: Vec<(Box<[u8]>, Style)>,
}

#[derive(Copy, Clone, PartialEq)]
enum Style {
    After,
    Before,
    None,
    Ignore,
}

impl Style {
    fn of(name: &str) -> Option<Style> {
        Some(match name {
            "after" => Style::After,
            "before" => Style::Before,
            "none" => Style::None,
            "ignore" => Style::Ignore,
            _ => return None,
        })
    }
}

const OPERATOR_AT_BEGINNING: Message = Message::new(
    "operatorAtBeginning",
    "'{{operator}}' should be placed at the beginning of the line.",
);
const OPERATOR_AT_END: Message = Message::new(
    "operatorAtEnd",
    "'{{operator}}' should be placed at the end of the line.",
);
const BAD_LINEBREAK: Message = Message::new(
    "badLinebreak",
    "Bad line breaking before and after '{{operator}}'.",
);
const NO_LINEBREAK: Message = Message::new(
    "noLinebreak",
    "There should be no line break before or after '{{operator}}'.",
);

/// `written`, or without its line breaks if it has nothing else but whitespace and `keeps` is not
/// set.
fn without_linebreaks(written: &[u8], keeps: bool) -> Cow<'_, [u8]> {
    match keeps || !strings::is_all_js_whitespace(written) || !strings::contains_js_line_break(written) {
        true => Cow::Borrowed(written),
        false => Cow::Owned(strings::js_lines(written).collect::<Vec<_>>().concat()),
    }
}

/// ESLint's `getFixer`. `before` and `after` are the tokens around `operator`.
fn fix<'a>(
    fixer: Fixer<'a>,
    style: Style,
    before: Token<'a>,
    operator: Token<'a>,
    after: Token<'a>,
) -> Option<Fix> {
    let file = fixer.file();
    let text_before = file.slice(Span::new(before.end(), operator.start()));
    let text_after = file.slice(Span::new(operator.end(), after.start()));
    let has_linebreak_before = !ast_utils::is_token_on_same_line(file, before, operator);
    let has_linebreak_after = !ast_utils::is_token_on_same_line(file, operator, after);

    let (new_before, new_after) = if has_linebreak_before != has_linebreak_after && style != Style::None {
        if file.tokens_before(operator).with_comments().next() != Some(before)
            && file.tokens_after(operator).with_comments().next() != Some(after)
        {
            return None;
        }
        // The only line break is on the wrong side of the operator.
        (Cow::Borrowed(text_after), Cow::Borrowed(text_before))
    } else {
        let new_before = without_linebreaks(text_before, style == Style::Before);
        let new_after = without_linebreaks(text_after, style == Style::After);
        if matches!((&new_before, &new_after), (Cow::Borrowed(_), Cow::Borrowed(_))) {
            return None;
        }
        (new_before, new_after)
    };

    let mut replaced = new_before.into_owned();
    replaced.extend_from_slice(operator.text());
    replaced.extend_from_slice(&new_after);
    // No `++` or `--` must come of it.
    if new_after.is_empty()
        && after.kind() == TokenKind::Punctuator
        && matches!(operator.text(), b"+" | b"-")
        && after.text() == operator.text()
    {
        replaced.push(b' ');
    }
    Some(fixer.replace(Span::new(before.end(), after.start()), replaced))
}

impl OperatorLinebreak {
    /// ESLint's `validateNode`. `left_end`: a position that is not after the end of the token
    /// before the operator. Without a line break from there to `right`, there is nothing to report.
    fn validate<'a>(&self, left_end: u32, right: Expr<'a>, operator: &'static str, cx: &Cx<'a, Self>) {
        if !strings::contains_js_line_break(cx.slice(Span::before(left_end, right.outer_span()))) {
            return;
        }
        let file = cx.file();
        let Some(token) = file.tokens_before(right).find(|it| it.is(operator)) else {
            return;
        };
        let (Some(left), Some(right)) = (file.token_before(token), file.token_after(token)) else {
            return;
        };
        let style_override = (self.overrides.iter())
            .find(|it| *it.0 == *operator.as_bytes())
            .map(|it| it.1);
        let style = style_override.unwrap_or(self.global_style);
        let is_after_left = ast_utils::is_token_on_same_line(file, left, token);
        let is_before_right = ast_utils::is_token_on_same_line(file, token, right);
        let message = match (is_after_left, is_before_right) {
            (true, true) => return,
            (false, false) if style_override != Some(Style::Ignore) => BAD_LINEBREAK,
            (true, _) if style == Style::Before => OPERATOR_AT_BEGINNING,
            (_, true) if style == Style::After => OPERATOR_AT_END,
            _ if style == Style::None => NO_LINEBREAK,
            _ => return,
        };
        cx.report(token, message)
            .data("operator", operator)
            .fix(|fixer| fix(fixer, style, left, token, right));
    }
}

impl Rule for OperatorLinebreak {
    const META: Meta = Meta::eslint("operator-linebreak", Kind::Layout)
        .fixable(Fixable::Code)
        .deprecated();
    const ON: On = On::new()
        .exprs(&[ExprTag::Binary, ExprTag::Assign, ExprTag::Cond])
        .members()
        .var_decls();
    no_state!();

    fn new(options: &Options) -> Self {
        let global_style = options.str(0).and_then(Style::of);
        let mut overrides: Vec<(Box<[u8]>, Style)> = (options.object(1).object("overrides").entries().iter())
            .filter_map(|(operator, style)| {
                let style = Style::of(std::str::from_utf8(style.as_str()?).ok()?)?;
                Some((operator.as_slice().into(), style))
            })
            .collect();
        if global_style.is_none() {
            for operator in [b"?", b":"] {
                if !overrides.iter().any(|it| *it.0 == *operator) {
                    overrides.push((operator.as_slice().into(), Style::Before));
                }
            }
        }
        OperatorLinebreak {
            global_style: global_style.unwrap_or(Style::After),
            overrides,
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.kind() {
            ExprKind::Binary { op, left, right } if op != BinOp::Comma => {
                self.validate(left.outer_span().end, right, bin_op_text(op), cx);
            }
            ExprKind::Assign { op, target, value } => {
                let left_end = target.outer_span().end;
                // The default value in a pattern is not an `AssignmentExpression`.
                if strings::contains_js_line_break(cx.slice(Span::before(left_end, value.outer_span())))
                    && (op.is_some() || !utils::is_assignment_target(e))
                {
                    self.validate(left_end, value, assign_op_text(op), cx);
                }
            }
            ExprKind::Cond { test, yes, no } => {
                self.validate(test.outer_span().end, yes, "?", cx);
                self.validate(yes.outer_span().end, no, ":", cx);
            }
            _ => {}
        }
    }

    fn var_decl<'a>(&self, declaration: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(init) = declaration.init() {
            self.validate(declaration.pat().span().end, init, "=", cx);
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        // A `PropertyDefinition`, not an `AccessorProperty`.
        if member.kind() == MemberKind::Property
            && let Some(value) = member.init()
            && !member.flags().contains(Flags::ACCESSOR)
            && let Some(key) = member.key()
        {
            self.validate(key.span(cx.file()).end, value, "=", cx);
        }
    }
}
