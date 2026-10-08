use bun_lint::prelude::*;

/// Require template literals instead of string concatenation.
pub struct PreferTemplate;

const UNEXPECTED_STRING_CONCATENATION: Message = Message::new(
    "unexpectedStringConcatenation",
    "Unexpected string concatenation.",
);

/// ESLint's `isConcatenation`: the operands of a `+`.
fn as_concatenation(e: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    match e.kind() {
        ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } => Some((left, right)),
        _ => None,
    }
}

/// Whether `test` holds for one of the things that `e` concatenates.
fn any_operand<'a>(mut e: Expr<'a>, test: fn(Expr<'a>) -> bool) -> bool {
    // `left` is deeper than `right` normally.
    while let Some((left, right)) = as_concatenation(e) {
        if any_operand(right, test) {
            return true;
        }
        e = left;
    }
    test(e)
}

fn has_string_literal(e: Expr<'_>) -> bool {
    any_operand(e, ast_utils::is_string_literal)
}

fn has_non_string_literal(e: Expr<'_>) -> bool {
    any_operand(e, |it| !ast_utils::is_string_literal(it))
}

fn has_octal_or_non_octal_decimal_escape_sequence(e: Expr<'_>) -> bool {
    any_operand(e, |it| {
        it.as_string().is_some() && ast_utils::has_octal_or_non_octal_decimal_escape_sequence(it.text())
    })
}

/// The operands of ESLint's `BinaryExpression`.
fn as_binary_expression(e: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    match e.kind() {
        ExprKind::Binary { op, left, right }
            if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma) =>
        {
            Some((left, right))
        }
        _ => None,
    }
}

/// Whether `e` starts with `${` once it is a template. Upstream asks of a template whether the range
/// of its first `TemplateElement` is empty, which it never is: it includes the delimiters.
fn starts_with_template_curly(mut e: Expr<'_>) -> bool {
    while let Some((left, _)) = as_binary_expression(e) {
        e = left;
    }
    !ast_utils::is_string_literal(e)
}

fn ends_with_template_curly(e: Expr<'_>) -> bool {
    match as_binary_expression(e) {
        Some((_, right)) => starts_with_template_curly(right),
        None => !ast_utils::is_string_literal(e),
    }
}

/// ESLint remembers which concatenations it has checked by where they start, and comes to the
/// literals in source order. So in `'a' + b - c + 'd'` the inner one hides the outer one.
fn starts_with_checked_concatenation(top: Expr<'_>) -> bool {
    let start = top.span().start;
    let mut at = top;
    loop {
        let first = match at.kind() {
            ExprKind::Binary { left, .. } => left,
            ExprKind::Cond { test, .. } => test,
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr) => expr,
            _ => return false,
        };
        if first.span().start != start {
            return false;
        }
        if as_concatenation(at).is_none() && as_concatenation(first).is_some() && has_string_literal(first) {
            return true;
        }
        at = first;
    }
}

/// The text between `a` and `b` that is not in a token: whitespace and comments.
fn get_text_between<'a>(file: &'a File<'a>, a: Span, b: Span) -> Vec<u8> {
    let mut text = Vec::new();
    let mut at = a.end;
    for token in file.tokens_between(a, b) {
        text.extend_from_slice(file.slice(Span::new(at, token.start())));
        at = token.end();
    }
    text.extend_from_slice(file.slice(Span::new(at, b.start)));
    text
}

/// The string literal `raw` as a template.
fn string_literal_to_template(raw: &[u8]) -> Vec<u8> {
    let [quote, content @ .., _] = raw else {
        return raw.to_vec();
    };
    // A `${` or a backtick needs a backslash, unless it is escaped for some reason.
    let mut escaped = Vec::with_capacity(content.len() + 2);
    let mut backslashes = 0;
    for (i, &byte) in content.iter().enumerate() {
        let opens = byte == b'`' || (byte == b'$' && content.get(i + 1) == Some(&b'{'));
        if opens && backslashes % 2 == 0 {
            escaped.push(b'\\');
        }
        backslashes = if byte == b'\\' { backslashes + 1 } else { 0 };
        escaped.push(byte);
    }
    // The quotes no longer need one.
    let mut template = Vec::with_capacity(escaped.len() + 2);
    template.push(b'`');
    let mut at = 0;
    while let Some(&byte) = escaped.get(at) {
        if byte == b'\\' && escaped.get(at + 1) == Some(quote) {
            at += 1;
        } else {
            template.push(byte);
            at += 1;
        }
    }
    template.push(b'`');
    template
}

/// `e` as a template, or as a sum of templates. `text_before` and `text_after` go into the braces
/// with it.
fn get_template_literal<'a>(
    file: &'a File<'a>,
    e: Expr<'a>,
    text_before: &[u8],
    text_after: &[u8],
) -> Vec<u8> {
    match e.kind() {
        ExprKind::String(_) => return string_literal_to_template(e.text()),
        ExprKind::Template(_) => return e.text().to_vec(),
        _ => {}
    }
    if let Some((left, right)) = as_concatenation(e)
        && has_string_literal(e)
        && let Some(plus) = e.operator_span()
    {
        let text_before_plus = get_text_between(file, left.span(), plus);
        let text_after_plus = get_text_between(file, plus, right.span());
        let (left_text, right_text) = if ends_with_template_curly(left) {
            // `foo${bar}` /* comment */ + 'baz' --> `foo${bar /* comment */  }${baz}`
            let around_plus = [&text_before_plus[..], &text_after_plus[..]].concat();
            (
                get_template_literal(file, left, text_before, &around_plus),
                get_template_literal(file, right, b"", text_after),
            )
        } else if starts_with_template_curly(right) {
            // 'foo' /* comment */ + `${bar}baz` --> `foo${ /* comment */  bar}baz`
            let around_plus = [&text_before_plus[..], &text_after_plus[..]].concat();
            (
                get_template_literal(file, left, text_before, b""),
                get_template_literal(file, right, &around_plus, text_after),
            )
        } else {
            // There is nowhere to put the text between them.
            return [
                &get_template_literal(file, left, text_before, b"")[..],
                &text_before_plus[..],
                &b"+"[..],
                &text_after_plus[..],
                &get_template_literal(file, right, text_after, b"")[..],
            ]
            .concat();
        };
        let left_text = left_text.strip_suffix(b"`").unwrap_or(&left_text);
        let right_text = right_text.strip_prefix(b"`").unwrap_or(&right_text);
        return [left_text, right_text].concat();
    }
    [&b"`${"[..], text_before, e.text(), text_after, b"}`"].concat()
}

impl PreferTemplate {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if as_concatenation(e).is_none()
            || matches!(e.parent(), Node::Expr(parent) if as_concatenation(parent).is_some())
            || !has_string_literal(e)
            || !has_non_string_literal(e)
            || starts_with_checked_concatenation(e)
        {
            return;
        }
        cx.report(e, UNEXPECTED_STRING_CONCATENATION).fix(|fixer| {
            if has_octal_or_non_octal_decimal_escape_sequence(e) {
                return None;
            }
            let needs_semicolon =
                ast_utils::is_start_of_expression_statement(e) && ast_utils::needs_preceding_semicolon(e);
            let template = get_template_literal(fixer.file(), e, b"", b"");
            Some(match needs_semicolon {
                true => fixer.replace(e, [&b";"[..], &template[..]].concat()),
                false => fixer.replace(e, template),
            })
        });
    }
}

impl Rule for PreferTemplate {
    const META: Meta = Meta::eslint("prefer-template", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferTemplate
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], Self::check);
    }
}
